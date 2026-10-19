'use strict';

/**
 * Disc golf for two to eight. A match is signed-in players, one course (nine or eighteen holes), and a turn order:
 * on each hole the farthest player from the basket throws next. The server decides every throw, using the very same
 * flight model and rules the browser has (public/js), so nobody can invent a result. What it cannot know is how well
 * someone timed their meter taps: that part is the honor system, like most casual games.
 *
 * Same storage idea as accounts and the change log: one JSON file in data/, written atomically. It shares the process
 * with checkout, so an unreadable file makes matches read-only instead of failing startup, and a failed save leaves
 * nothing half-done.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');

const LIMITS = {
  maxPlayers: 8,
  minPlayers: 2,
  openMatchesPerUser: 6, // waiting + active
  maxMatches: 3000,
  discsInBag: 80, // as many as an account's bag can hold
  waitingHours: 24,
  keepDoneDays: 14,
  trailPoints: 18,
  trailsPerHole: 12,
};

class MatchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'MatchError';
    this.status = status;
  }
}

// The game's rules and course are ES modules shared with the browser. Load them once.
const STARTER = ['AviarX3', 'Zone OS', 'Roc3', 'Buzzz OS', 'Leopard3', 'Teebird3', 'Destroyer'];
async function loadGameplay() {
  const dir = path.join(__dirname, '..', '..', 'public', 'js');
  const core = await import(pathToFileURL(path.join(dir, 'gamecore.js')).href);
  const course = await import(pathToFileURL(path.join(dir, 'course.js')).href);
  const cond = await import(pathToFileURL(path.join(dir, 'conditions.js')).href);
  const daily = await import(pathToFileURL(path.join(dir, 'daily.js')).href);
  const progress = await import(pathToFileURL(path.join(dir, 'progress.js')).href);
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'data', 'flightguide.json'), 'utf8'));
  const discs = new Map(guide.discs.map((r) => [r[0], { id: r[0], name: r[1], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] }]));
  const starter = STARTER.map((n) => [...discs.values()].find((d) => d.name === n)?.id).filter(Boolean);
  const base = (id) => course.holeById(id); // either course
  // the hole as this match plays it today: its seed gives each hole its wind, weather, pin and mando (a match with no seed is the classic course)
  const days = new Map();
  const holeFor = (m, id) => {
    if (m.seed === undefined || m.seed === null) return base(id);
    const key = `${m.seed}:${id}:${m.holeIdx}:${m.holes}:${m.rain ? 'r' : ''}`;
    if (!days.has(key)) {
      if (days.size > 200) days.clear();
      days.set(key, cond.applyVariant(base(id), cond.variantFor(m.seed, base(id), { idx: m.holeIdx, n: m.holes, rain: !!m.rain })));
    }
    return days.get(key);
  };
  return { G: { ...core, ...course, ...cond }, discs, starter, hole: base, holeFor, daily, progress };
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const r1 = (n) => Math.round(n * 10) / 10;

// the bag a player brings, frozen when they sit down: disc ids, and the color they gave each (photos stay private)
function snapshot(gp, bag, game = null) {
  const ids = bag ? bag.discs.filter((id) => gp.discs.has(id)).slice(0, LIMITS.discsInBag) : [];
  const list = ids.length ? ids : gp.starter;
  const worn = game?.stats?.discs || {}; // how many times they have thrown each disc: it breaks in
  return list.map((id) => {
    const color = ids.length ? bag.items?.[id]?.color : null;
    const w = Math.min(1000, Math.max(0, Math.round(Number(worn[id]) || 0)));
    return { id, ...(color ? { color } : {}), ...(w ? { w } : {}) };
  });
}

/* ---------- playing a hole ---------- */

const freshRound = (hole, eaten) => ({ lie: { x: hole.tee.x, y: hole.tee.y }, strokes: 0, throws: [], eaten: [...eaten], bearCame: false, done: false, holed: false });
const inPlay = (m) => m.players.filter((p) => !p.left);

function startHole(gp, m) {
  const hole = gp.hole(gp.G.courseById(m.course ?? 1).holes[m.holeIdx].id); // the course this match is on (older matches have none: the first)
  const players = inPlay(m);
  const rounds = {};
  for (const p of players) {
    rounds[p.uid] = freshRound(hole, m.eaten[p.uid] || []);
    if (!p.discs.some((d) => !rounds[p.uid].eaten.includes(d.id))) rounds[p.uid].done = true; // Marebear ate the whole bag
  }
  // the honor: the first hole's order is a shuffle; after that, the best score on the last hole tees off first, and a tie
  // keeps the order it had
  let order;
  if (m.holeIdx === 0) {
    order = players.map((p) => p.uid);
    for (let i = order.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  } else {
    const score = (uid) => m.cards[uid].at(-1).score;
    order = (m.round.order || []).filter((uid) => rounds[uid]).sort((x, y) => score(x) - score(y));
    for (const p of players) if (!order.includes(p.uid)) order.push(p.uid);
  }
  m.round = { holeId: hole.id, rounds, trails: Object.fromEntries(players.map((p) => [p.uid, []])), order, lastSeq: {}, turn: null };
  chooseTurn(gp, m);
}

// The farthest player from the basket throws next. When some are as far as each other (everyone, on the tee), it goes to
// whoever has waited longest since their last throw, and then to the honor order.
function chooseTurn(gp, m) {
  const hole = gp.holeFor(m, m.round.holeId);
  const live = inPlay(m).filter((p) => !m.round.rounds[p.uid].done);
  if (!live.length) { m.round.turn = null; return; }
  if (live.length === 1) { m.round.turn = live[0].uid; return; }
  const dist = (p) => gp.G.distance(m.round.rounds[p.uid].lie, hole.basket);
  const far = Math.max(...live.map(dist));
  const tied = live.filter((p) => far - dist(p) <= 0.5);
  const waited = (p) => m.round.lastSeq[p.uid] ?? -1;
  tied.sort((x, y) => waited(x) - waited(y) || m.round.order.indexOf(x.uid) - m.round.order.indexOf(y.uid));
  m.round.turn = tied[0].uid;
}

// the disc as this player's copy plays: one they have thrown a lot has broken in
function playDisc(gp, m, uid, discId) {
  const entry = m.players.find((x) => x.uid === uid)?.discs.find((d) => d.id === discId);
  return gp.progress.brokenIn(gp.discs.get(discId), entry?.w);
}

function discFor(m, uid, discId) {
  const p = m.players.find((x) => x.uid === uid);
  const id = Number(discId);
  if (!p.discs.some((d) => d.id === id)) throw new MatchError('That disc is not in your bag.');
  if (m.round.rounds[uid].eaten.includes(id)) throw new MatchError('Marebear has that one in her handbag.');
  return id;
}

function needTurn(m, uid) {
  if (m.status !== 'active') throw new MatchError('That match is not being played.', 409);
  if (m.round.turn !== uid) throw new MatchError('It is not your throw.', 409);
}

const trailOf = (result) => {
  const pts = [...(result.pts ?? []), ...(result.roll ?? [])];
  const keep = Math.min(pts.length, LIMITS.trailPoints);
  return Array.from({ length: keep }, (_, i) => {
    const p = pts[Math.round((i / Math.max(1, keep - 1)) * (pts.length - 1))];
    return [r1(p.x), r1(p.y)];
  });
};

// Put a resolved throw or putt into the match: strokes, lie, trail, the record the other player watches, and what comes next.
function record(gp, m, uid, disc, result, extra) {
  const { G } = gp;
  const hole = gp.holeFor(m, m.round.holeId);
  const r = m.round.rounds[uid];
  const work = { ...r, hole };
  const from = { ...r.lie };
  const out = G.applyResult(work, disc, result);
  Object.assign(r, { lie: work.lie, strokes: work.strokes, throws: work.throws, eaten: work.eaten, bearCame: work.bearCame, done: work.done, holed: work.holed });
  const trail = m.round.trails[uid];
  trail.push({ pts: trailOf(result), kind: result.kind, n: r.throws.length });
  if (trail.length > LIMITS.trailsPerHole) trail.shift();
  m.seq += 1;
  m.round.lastSeq[uid] = m.seq;

  const last = {
    seq: m.seq,
    uid,
    discId: disc.id,
    holeId: hole.id,
    from,
    kind: result.kind,
    putt: !!extra.putt,
    ex: extra.ex ?? null,
    feet: extra.putt ? null : Math.round(result.plan.feet),
    pts: extra.putt ? [] : result.pts.map((p) => [r1(p.x), r1(p.y), r1(p.h)]),
    roll: (result.roll ?? []).map((p) => [r1(p.x), r1(p.y)]),
    end: { x: r1((result.end ?? result.lie).x), y: r1((result.end ?? result.lie).y) },
    lie: { x: r1(result.lie.x), y: r1(result.lie.y) },
    strokes: result.strokes,
    made: result.made,
    gimme: result.gimme,
    zone: result.zone,
    finish: result.finish,
    rim: result.rim,
    chainout: result.chainout || undefined,
    nasty: result.nasty,
    why: result.why || undefined,
    rolled: result.nasty ? Math.round(result.miss) : undefined,
    dist: result.dist !== undefined ? r1(result.dist) : undefined,
    hitAt: result.hit?.at ? { x: r1(result.hit.at.x), y: r1(result.hit.at.y) } : undefined,
    bear: out.bear ? { discId: out.bear.discId, at: { x: r1(out.bear.at.x), y: r1(out.bear.at.y) } } : undefined,
  };
  m.last = last;
  const hl = G.highlightScore(last); // the throw of the match, kept for the replay
  if (hl > (m.best?.score ?? 0)) m.best = { score: Math.round(hl), last: { ...last } };

  // a player with no discs left is finished, whatever their score was
  const p = m.players.find((x) => x.uid === uid);
  if (!r.done && !p.discs.some((d) => !r.eaten.includes(d.id))) r.done = true;

  chooseTurn(gp, m);
  if (!m.round.turn) endHole(gp, m);
  return last;
}

// Put the hole just played on everyone's card.
function cardHole(gp, m) {
  const hole = gp.holeFor(m, m.round.holeId);
  const results = [];
  for (const p of inPlay(m)) {
    const r = m.round.rounds[p.uid];
    const score = gp.G.holeScore(r.strokes, hole.par, r.holed);
    m.cards[p.uid].push({ hole: hole.id, par: hole.par, strokes: r.strokes, score, holed: r.holed });
    m.eaten[p.uid] = [...r.eaten];
    // closest to the pin: how near the first throw (if it was a clean one) finished to the basket
    const first = r.throws[0];
    const kp = first && first.strokes === 1 ? (first.kind === 'basket' ? 0 : r1(gp.G.distance(first.lie, hole.basket))) : null;
    results.push({ uid: p.uid, strokes: r.strokes, score, holed: r.holed, kp });
  }
  return { holeId: hole.id, par: hole.par, results };
}

const totalOf = (m, uid) => m.cards[uid].reduce((n, c) => n + c.score, 0);

function finishMatch(m) {
  const ps = inPlay(m);
  const best = Math.min(...ps.map((p) => totalOf(m, p.uid)));
  const winners = ps.filter((p) => totalOf(m, p.uid) === best).map((p) => p.uid);
  m.status = 'done';
  m.endedBy = 'finished';
  m.winners = winners;
  m.winner = winners.length === 1 ? winners[0] : 'tie';
  m.round.turn = null;
}

// Everyone is done with this hole: card it, then on to the next (or the end). A hole nobody has a disc left to play is
// carded as the worst a hole can be, and skipped. `announce` puts the hole's results on the last move (a player leaving
// is not a move, so then there is nothing to hang them on).
function endHole(gp, m, announce = true) {
  const done = cardHole(gp, m);
  const finished = m.holeIdx >= m.holes - 1;
  if (announce && m.last) m.last.holeEnd = { ...done, matchDone: finished };
  for (;;) {
    if (m.holeIdx >= m.holes - 1) { finishMatch(m); return; }
    m.holeIdx += 1;
    startHole(gp, m);
    if (m.round.turn) return;
    cardHole(gp, m);
  }
}

function throwMove(gp, m, uid, body) {
  const { G } = gp;
  needTurn(m, uid);
  const hole = gp.holeFor(m, m.round.holeId);
  const r = m.round.rounds[uid];
  const discId = discFor(m, uid, body.discId);
  if (G.distance(r.lie, hole.basket) <= G.PUTT_RANGE) throw new MatchError('Inside 50 feet you putt.');
  const settings = G.sanitizeSettings(body.settings);
  if (!settings) throw new MatchError('Those throw settings are not allowed.');
  const aimOff = Math.max(-180, Math.min(180, Math.round(Number(body.aimOff) || 0))); // any way at all: some holes turn away from the basket
  const disc = playDisc(gp, m, uid, discId);
  const ex = G.applySlip(G.sanitizeExecution(body.ex), G.rollSlip(disc, settings, Math.random())); // the server rolls: a slip cannot be dodged
  const result = G.resolveThrow(hole, disc, settings, G.headingTo(r.lie, hole.basket) + aimOff, ex, r.lie);
  return record(gp, m, uid, disc, result, { ex: { o: ex.o, pure: ex.pure, grade: ex.grade, slip: ex.slip, swipe: ex.swipe, swipeAim: ex.swipeAim, swipeSpeed: ex.swipeSpeed }, putt: false });
}

function puttMove(gp, m, uid, body) {
  const { G } = gp;
  needTurn(m, uid);
  const hole = gp.holeFor(m, m.round.holeId);
  const r = m.round.rounds[uid];
  const discId = discFor(m, uid, body.discId);
  if (G.distance(r.lie, hole.basket) > G.PUTT_RANGE) throw new MatchError('You are too far out to putt.');
  const x = Number(body.x);
  const y = body.y === undefined ? 0 : Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 1.02) throw new MatchError('That is not a putt.');
  const disc = playDisc(gp, m, uid, discId);
  const result = G.resolvePutt(hole, r.lie, disc, { x, y }, Math.random(), G.sanitizeSwipe(body.swipe)); // the server rolls the dice for a nasty roll
  return record(gp, m, uid, disc, result, { putt: true });
}

/* ---------- the store ---------- */

function createMatchStore(file, { now = () => Date.now(), seed = () => crypto.randomInt(1, 2147483647) } = {}) { // (seed: tests pass one that gives the classic course, so a throw does not depend on the day's luck)
  const events = new EventEmitter();
  events.setMaxListeners(0);
  let unavailable = false;

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { matches: [] };
      console.error('[matches] could not read the matches file, leaving it alone:', err.message);
      unavailable = true;
      return { matches: [] };
    }
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.matches)) return { matches: d.matches };
    } catch { /* fall through to quarantine */ }
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    return { matches: [] };
  }

  let db = load();

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const writable = () => {
    if (unavailable) throw new MatchError('Matches are unavailable right now. Try again later.', 503);
  };

  function prune() {
    const t = now();
    const before = db.matches.length;
    for (const m of db.matches) {
      if (m.status === 'waiting' && t - m.updatedAt > LIMITS.waitingHours * 3_600_000) { m.status = 'cancelled'; }
    }
    db.matches = db.matches.filter((m) => !(['done', 'cancelled'].includes(m.status) && t - m.updatedAt > LIMITS.keepDoneDays * 86_400_000));
    return before !== db.matches.length;
  }
  prune();

  const find = (id) => db.matches.find((m) => m.id === String(id ?? '').toUpperCase());
  const isMember = (m, uid) => m.players.some((p) => p.uid === uid);

  // Run a change against a copy of one match; only keep it if it saved.
  function change(id, fn) {
    writable();
    const i = db.matches.findIndex((m) => m.id === String(id ?? '').toUpperCase());
    if (i < 0) throw new MatchError('No such match.', 404);
    const old = db.matches[i];
    const draft = structuredClone(old);
    const out = fn(draft);
    draft.updatedAt = now();
    db.matches[i] = draft;
    try {
      save();
    } catch {
      db.matches[i] = old;
      throw new MatchError('Could not save that. Try again.', 500);
    }
    events.emit('change', draft);
    return out === undefined ? draft : out;
  }

  const open = (uid) => db.matches.filter((m) => ['waiting', 'active'].includes(m.status) && m.players.some((p) => p.uid === uid && !p.left));

  // what one player is allowed to see (photos and other private things are not in a match at all)
  function view(m, uid) {
    return {
      id: m.id,
      status: m.status,
      holes: m.holes,
      course: m.course ?? 1,
      holeIdx: m.holeIdx,
      seed: m.seed,
      rain: !!m.rain,
      invite: m.invite,
      you: uid,
      host: m.players[0].uid,
      maxPlayers: LIMITS.maxPlayers,
      players: m.players.map((p) => ({ uid: p.uid, name: p.name, discs: p.discs, left: !!p.left })),
      cards: m.cards,
      round: m.round ? { holeId: m.round.holeId, turn: m.round.turn, rounds: m.round.rounds, trails: m.round.trails } : null,
      eaten: m.eaten,
      best: m.status === 'done' && m.best ? m.best : null,
      seq: m.seq,
      last: m.last,
      winner: m.winner,
      winners: m.winners || (m.winner && m.winner !== 'tie' ? [m.winner] : []),
      endedBy: m.endedBy,
      updatedAt: m.updatedAt,
    };
  }

  return {
    on: (event, fn) => events.on(event, fn),
    off: (event, fn) => events.off(event, fn),
    view,
    isMember,
    get: (id) => find(id) || null,

    list(user) {
      const mine = db.matches.filter((m) => isMember(m, user.id) || (m.status === 'waiting' && m.invite && m.invite === user.name.toLowerCase()));
      return mine
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)
        .map((m) => {
          const me = m.players.find((p) => p.uid === user.id);
          const others = m.players.filter((p) => p.uid !== user.id && !p.left).map((p) => p.name);
          const winners = m.winners || (m.winner && m.winner !== 'tie' ? [m.winner] : []);
          return {
            id: m.id,
            status: m.status,
            holes: m.holes,
            course: m.course ?? 1,
            holeIdx: m.holeIdx,
            others,
            players: m.players.length,
            invitedYou: !me && m.status === 'waiting',
            host: m.players[0].name,
            yourTurn: !!me && !me.left && m.status === 'active' && m.round.turn === user.id,
            left: !!me?.left,
            won: m.status === 'done' ? (winners.length === 1 ? winners[0] === user.id : winners.includes(user.id) ? null : false) : undefined,
            updatedAt: m.updatedAt,
          };
        });
    },

    create(user, { gp, holes, course = 1, invite, bag }) {
      writable();
      if (![9, 18].includes(holes)) throw new MatchError('Pick a nine or eighteen hole round.');
      if (!gp.G.COURSES.some((c) => c.id === course)) throw new MatchError('Pick a course that exists.');
      if (db.matches.length >= LIMITS.maxMatches && !prune()) throw new MatchError('Matches are full right now. Try later.', 503);
      if (open(user.id).length >= LIMITS.openMatchesPerUser) throw new MatchError(`You already have ${LIMITS.openMatchesPerUser} matches going. Finish or leave one first.`, 409);
      const t = now();
      let id;
      do { id = newCode(); } while (find(id));
      const m = {
        id,
        status: 'waiting',
        holes,
        course,
        holeIdx: 0,
        invite: invite ? invite.toLowerCase() : null,
        createdAt: t,
        updatedAt: t,
        players: [{ uid: user.id, name: user.name, discs: snapshot(gp, bag, user.game) }],
        cards: { [user.id]: [] },
        eaten: { [user.id]: [] },
        round: null,
        seed: seed(), // the day's conditions: wind, rain, pins and mandos come from this
        seq: 0,
        last: null,
        winner: null,
        endedBy: null,
      };
      db.matches.push(m);
      try {
        save();
      } catch {
        db.matches.pop();
        throw new MatchError('Could not save that. Try again.', 500);
      }
      events.emit('change', m);
      return view(m, user.id);
    },

    join(user, id, { gp, bag }) {
      const m = find(id);
      if (!m) throw new MatchError('No match with that code.', 404);
      if (isMember(m, user.id)) return view(m, user.id); // already in: just open it
      if (m.status !== 'waiting') throw new MatchError('That match has already started.', 409);
      if (m.players.length >= LIMITS.maxPlayers) throw new MatchError(`That match is full: ${LIMITS.maxPlayers} players.`, 409);
      if (open(user.id).length >= LIMITS.openMatchesPerUser) throw new MatchError(`You already have ${LIMITS.openMatchesPerUser} matches going. Finish or leave one first.`, 409);
      return view(change(id, (d) => {
        d.players.push({ uid: user.id, name: user.name, discs: snapshot(gp, bag, user.game) });
        d.cards[user.id] = [];
        d.eaten[user.id] = [];
        d.seq += 1;
      }), user.id);
    },

    // the host starts it once at least two are seated
    start(user, id, { gp }) {
      const m = find(id);
      if (!m || !isMember(m, user.id)) throw new MatchError('No such match.', 404);
      if (m.status !== 'waiting') return view(m, user.id);
      if (m.players[0].uid !== user.id) throw new MatchError('Only the host can start the match.', 403);
      if (m.players.length < LIMITS.minPlayers) throw new MatchError('Wait for at least one more player.', 409);
      return view(change(id, (d) => {
        d.status = 'active';
        d.seq += 1;
        startHole(gp, d);
      }), user.id);
    },

    // returns { match, last } for the player who moved
    move(user, id, kind, body, gp) {
      const m = find(id);
      if (!m || !isMember(m, user.id)) throw new MatchError('No such match.', 404);
      let last;
      const next = change(id, (d) => { last = (kind === 'putt' ? puttMove : throwMove)(gp, d, user.id, body || {}); });
      return { match: view(next, user.id), last };
    },

    // Leaving a match nobody has started takes you out of it (the host leaving hands it to the next player, or cancels it
    // if you were alone). Leaving one in play forfeits your place: the rest play on, and if one player is left they win.
    leave(user, id, gp) {
      const m = find(id);
      if (!m || !isMember(m, user.id)) throw new MatchError('No such match.', 404);
      if (['done', 'cancelled'].includes(m.status) || m.players.find((p) => p.uid === user.id).left) return view(m, user.id);
      return view(change(id, (d) => {
        if (d.status === 'waiting') {
          if (d.players.length === 1) {
            d.status = 'cancelled';
          } else {
            d.players = d.players.filter((p) => p.uid !== user.id);
            delete d.cards[user.id];
            delete d.eaten[user.id];
          }
        } else {
          d.players.find((p) => p.uid === user.id).left = true;
          if (d.round && d.round.rounds[user.id]) d.round.rounds[user.id].done = true;
          const rest = inPlay(d);
          if (rest.length < 2) {
            d.status = 'done';
            d.endedBy = 'forfeit';
            d.winner = rest[0] ? rest[0].uid : 'tie';
            d.winners = rest.map((p) => p.uid);
            if (d.round) d.round.turn = null;
          } else if (d.round) {
            chooseTurn(gp, d);
            if (!d.round.turn) endHole(gp, d, false);
          }
        }
        d.seq += 1;
      }), user.id);
    },
  };
}

module.exports = { createMatchStore, loadGameplay, MatchError, LIMITS };
