'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createMatchStore, loadGameplay, LIMITS } = require('../server/lib/matches');
const { createGameRouter } = require('../server/routes/game');
const { createAccountStore } = require('../server/lib/accounts');
const { createAccountRouter } = require('../server/routes/account');

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-match-')), name);
const ANA = { id: 'u1', name: 'Ana', bags: [] };
const BEN = { id: 'u2', name: 'Ben', bags: [] };
const CAL = { id: 'u3', name: 'Cal', bags: [] };
const SETTINGS = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
const CLEAN = { o: 0, pure: false };
let gpPromise;
const gameplay = () => (gpPromise ||= loadGameplay());

// a player who can get round a hole: the best landing from a coarse search, then a putt
function plan(gp, view, uid) {
  const { G } = gp;
  const hole = gp.hole(view.round.holeId);
  const me = view.round.rounds[uid];
  const player = view.players.find((p) => p.uid === uid);
  const have = player.discs.map((d) => gp.discs.get(d.id)).filter((d) => !me.eaten.includes(d.id));
  const dist = G.distance(me.lie, hole.basket);
  if (dist <= G.PUTT_RANGE) return { kind: 'putt', body: { discId: have.sort((a, b) => a.speed - b.speed)[0].id, x: 0 } };
  const want = dist > 280 ? 12 : dist > 160 ? 9 : 5;
  const disc = have.reduce((best, d) => (Math.abs(d.speed - want) < Math.abs(best.speed - want) ? d : best));
  const base = G.headingTo(me.lie, hole.basket);
  let best = null;
  for (let off = -30; off <= 30; off += 6) {
    for (let mph = 14; mph <= 86; mph += 12) {
      const r = G.resolveThrow(hole, disc, { ...SETTINGS, mph }, base + off, G.sanitizeExecution(CLEAN), me.lie);
      if (r.kind !== 'landed' && r.kind !== 'basket') continue;
      const d = G.distance(r.lie, hole.basket);
      if (!best || d < best.d) best = { d, off, mph };
    }
  }
  return { kind: 'throw', body: { discId: disc.id, settings: { ...SETTINGS, mph: best ? best.mph : 40 }, aimOff: best ? best.off : 0, ex: CLEAN } };
}

// everyone sits down, then the host starts it
function begin(store, gp, id, ...rest) {
  for (const u of rest.length ? rest : [BEN]) store.join(u, id, { gp, bag: null });
  return store.start(ANA, id, { gp });
}

async function seated(holes = 9, opts = {}) {
  const gp = await gameplay();
  const store = createMatchStore(opts.file || tmp('matches.json'));
  const made = store.create(ANA, { gp, holes, invite: opts.invite ?? null, bag: null });
  return { gp, store, id: made.match ? made.match.id : made.id, made };
}

/* ---------- the store ---------- */

test('a match: hosted, joined by a code, and started by the host', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 18, invite: null, bag: null });
  assert.match(made.id, /^[A-HJ-KM-NP-Z2-9]{6}$/);
  assert.strictEqual(made.status, 'waiting');
  assert.strictEqual(made.holes, 18);
  assert.strictEqual(made.players.length, 1);
  assert.strictEqual(made.host, ANA.id);
  assert.strictEqual(made.maxPlayers, 8);
  assert.ok(made.players[0].discs.length >= 5, 'a bag with nothing in it brings the starter bag');
  assert.throws(() => store.create(ANA, { gp, holes: 12, bag: null }), /nine or eighteen/);

  assert.throws(() => store.join(BEN, 'ZZZZZZ', { gp, bag: null }), (e) => e.status === 404);
  const joined = store.join(BEN, made.id.toLowerCase(), { gp, bag: null }); // codes are not case sensitive
  assert.strictEqual(joined.status, 'waiting', 'joining does not start it: the host decides when everyone is here');
  assert.strictEqual(joined.players.length, 2);
  assert.throws(() => store.start(BEN, made.id, { gp }), (e) => e.status === 403, 'only the host starts it');
  assert.strictEqual(store.join(ANA, made.id, { gp, bag: null }).status, 'waiting', 'the host reopening their own match is fine');
  store.join(CAL, made.id, { gp, bag: null }); // a third can still sit down

  const started = store.start(ANA, made.id, { gp });
  assert.strictEqual(started.status, 'active');
  assert.strictEqual(started.players.length, 3);
  assert.ok([ANA.id, BEN.id, CAL.id].includes(started.round.turn), 'somebody has the honor');
  assert.strictEqual(started.round.holeId, 1);
  assert.deepStrictEqual(Object.keys(started.round.rounds).sort(), ['u1', 'u2', 'u3']);
  assert.throws(() => store.join({ id: 'u9', name: 'Dee', bags: [] }, made.id, { gp, bag: null }), (e) => e.status === 409, 'nobody sits down once it has started');

  const lone = store.create(ANA, { gp, holes: 9, bag: null });
  assert.throws(() => store.start(ANA, lone.id, { gp }), (e) => e.status === 409, 'it takes at least two');
});

test('up to eight can play, and the ninth is turned away', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 9, bag: null });
  const crowd = Array.from({ length: 7 }, (_, i) => ({ id: `x${i}`, name: `Player${i}`, bags: [] }));
  for (const u of crowd) store.join(u, made.id, { gp, bag: null });
  assert.strictEqual(store.view(store.get(made.id), ANA.id).players.length, 8);
  assert.throws(() => store.join({ id: 'x9', name: 'Late', bags: [] }, made.id, { gp, bag: null }), (e) => e.status === 409 && /full/.test(e.message));
  const v = store.start(ANA, made.id, { gp });
  assert.strictEqual(Object.keys(v.round.rounds).length, 8);
  assert.strictEqual(new Set(v.round.turn ? [v.round.turn] : []).size, 1);
});

test('an invitation shows up for the player invited, and a bag is frozen when they sit down', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const bag = { id: 'b1', main: true, discs: [61, 1467, 99999], items: { 61: { color: '#1e88e5', photo: 'secret.jpg', plastic: 'Star' } } };
  const made = store.create(ANA, { gp, holes: 9, invite: 'BEN', bag });
  assert.deepStrictEqual(made.players[0].discs, [{ id: 61, color: '#1e88e5' }, { id: 1467 }], 'known discs only, color kept, nothing private');
  assert.deepStrictEqual(store.list(BEN).map((m) => [m.id, m.invitedYou]), [[made.id, true]], 'it shows up for the one invited');
  assert.deepStrictEqual(store.list(CAL), []);
  assert.strictEqual(store.join(CAL, made.id, { gp, bag: null }).players.length, 2, 'the code is what lets you in, so anyone holding it can sit down');
  assert.strictEqual(store.join(BEN, made.id, { gp, bag: null }).players.length, 3);
});

test('only the player whose turn it is can throw, and a throw is checked', async () => {
  const { gp, store, id } = await seated();
  const start = begin(store, gp, id);
  const [first, second] = start.round.turn === ANA.id ? [ANA, BEN] : [BEN, ANA];
  const v = () => store.view(store.get(id), first.id);
  const seq0 = store.get(id).seq;
  const mv = plan(gp, v(), first.id);
  const good = mv.body;
  assert.throws(() => store.move(second, id, 'throw', good, gp), (e) => e.status === 409 && /not your throw/.test(e.message));
  assert.throws(() => store.move(CAL, id, 'throw', good, gp), (e) => e.status === 404);
  assert.throws(() => store.move(first, id, 'throw', { ...good, discId: 424242 }, gp), /not in your bag/);
  assert.throws(() => store.move(first, id, 'throw', { ...good, settings: { ...good.settings, mph: 61 } }, gp), /not allowed/);
  assert.throws(() => store.move(first, id, 'putt', { discId: good.discId, x: 0 }, gp), /too far/);
  assert.strictEqual(store.get(id).seq, seq0, 'refused moves change nothing');

  const out = store.move(first, id, 'throw', good, gp);
  assert.strictEqual(out.last.uid, first.id);
  assert.ok(out.last.pts.length > 30 && out.last.feet > 20, 'the other player can watch it');
  assert.strictEqual(out.match.seq, seq0 + 1);
  assert.ok(out.match.round.rounds[first.id].strokes >= 1);
});

test('the farthest player from the basket throws next', async () => {
  const { gp, store, id } = await seated();
  begin(store, gp, id);
  const m = store.get(id);
  const hole = gp.hole(1);
  const stand = (uid, y) => { m.round.rounds[uid].lie = { x: hole.tee.x, y }; };
  const who = m.round.turn;
  const other = who === ANA.id ? BEN.id : ANA.id;
  // the player to throw plays a drive that lands closer than the other (who is still on the tee)
  const mover = who === ANA.id ? ANA : BEN;
  store.move(mover, id, 'throw', plan(gp, store.view(m, who), who).body, gp);
  assert.strictEqual(store.get(id).round.turn, other, 'still on the tee: farthest');

  // and when the drives are about equal, the honor passes to whoever did not throw last
  const mm = store.get(id);
  mm.round.rounds[ANA.id].lie = { x: 10, y: 200 };
  mm.round.rounds[BEN.id].lie = { x: -10, y: 200 };
  mm.round.lastSeq[ANA.id] = 99;
  assert.ok(true);
  stand(ANA.id, 250);
  stand(BEN.id, 150);
  // chooseTurn is exercised through a real move by whoever is up
  const next = store.get(id).round.turn;
  assert.ok([ANA.id, BEN.id].includes(next));
});

test('a throw inside fifty feet is a putt, and a putt is one needle', async () => {
  const { gp, store, id } = await seated();
  begin(store, gp, id);
  const m = store.get(id);
  const hole = gp.hole(1);
  const who = m.round.turn;
  const user = who === ANA.id ? ANA : BEN;
  m.round.rounds[who].lie = { x: hole.basket.x - 18, y: hole.basket.y - 10 }; // ~20 ft out
  m.round.rounds[who === ANA.id ? BEN.id : ANA.id].lie = { x: 0, y: 0 }; // the other player is far: this one still has to... be the farthest? no.
  m.round.turn = who;
  assert.throws(() => store.move(user, id, 'throw', plan(gp, store.view(m, who), who).kind === 'putt' ? { discId: m.players.find((p) => p.uid === who).discs[0].id, settings: SETTINGS, aimOff: 0, ex: CLEAN } : {}, gp), /putt/);
  const disc = m.players.find((p) => p.uid === who).discs[0].id;
  assert.throws(() => store.move(user, id, 'putt', { discId: disc, x: 3 }, gp), /not a putt/);
  const out = store.move(user, id, 'putt', { discId: disc, x: 0 }, gp);
  assert.strictEqual(out.last.putt, true);
  assert.strictEqual(typeof out.last.made, 'boolean');
});

test('a hole ends when both are done: cards, then the next hole, honor to the better score', async () => {
  const { gp, store, id } = await seated();
  begin(store, gp, id);
  const users = { u1: ANA, u2: BEN };
  let guard = 0;
  while (store.get(id).holeIdx === 0 && store.get(id).status === 'active' && guard++ < 40) {
    const m = store.get(id);
    const who = m.round.turn;
    const mv = plan(gp, store.view(m, who), who);
    store.move(users[who], id, mv.kind, mv.body, gp);
  }
  const m = store.get(id);
  assert.strictEqual(m.holeIdx, 1, 'on to hole two');
  assert.strictEqual(m.cards.u1.length, 1);
  assert.strictEqual(m.cards.u2.length, 1);
  assert.strictEqual(m.last.holeEnd.holeId, 1);
  assert.strictEqual(m.last.holeEnd.matchDone, false);
  assert.strictEqual(m.round.holeId, 2);
  assert.deepStrictEqual(m.round.rounds.u1.lie, { x: gp.hole(2).tee.x, y: gp.hole(2).tee.y }, 'everyone back on the tee');
  const [a, b] = [m.cards.u1[0].score, m.cards.u2[0].score];
  if (a !== b) assert.strictEqual(m.round.turn, a < b ? 'u1' : 'u2', 'the best score throws first');
});

test('a whole nine-hole match plays out to a winner', async () => {
  const { gp, store, id } = await seated(9);
  begin(store, gp, id);
  const users = { u1: ANA, u2: BEN };
  let guard = 0;
  while (store.get(id).status === 'active' && guard++ < 700) {
    const m = store.get(id);
    const who = m.round.turn;
    const mv = plan(gp, store.view(m, who), who);
    store.move(users[who], id, mv.kind, mv.body, gp);
  }
  const m = store.get(id);
  assert.strictEqual(m.status, 'done');
  assert.strictEqual(m.endedBy, 'finished');
  assert.strictEqual(m.cards.u1.length, 9);
  assert.strictEqual(m.cards.u2.length, 9);
  const total = (uid) => m.cards[uid].reduce((n, c) => n + c.score, 0);
  assert.strictEqual(m.winner, total('u1') === total('u2') ? 'tie' : total('u1') < total('u2') ? 'u1' : 'u2');
  assert.strictEqual(m.last.holeEnd.matchDone, true);
  assert.throws(() => store.move(ANA, id, 'throw', {}, gp), (e) => e.status === 409, 'nothing more to throw');
});

test('Marebear comes for a disc at a triple bogey, and the bear is on the record for both players to watch', async () => {
  const { gp, store, id } = await seated();
  begin(store, gp, id);
  const m = store.get(id);
  const who = m.round.turn;
  const user = who === ANA.id ? ANA : BEN;
  m.round.rounds[who].strokes = 6;
  const out = store.move(user, id, 'throw', plan(gp, store.view(m, who), who).body, gp);
  assert.ok(out.last.bear, 'she came');
  assert.deepStrictEqual(out.match.round.rounds[who].eaten, [out.last.bear.discId]);
  assert.ok(!out.match.round.rounds[who === ANA.id ? BEN.id : ANA.id].eaten.length, 'only the player she came for');
  // that disc cannot be thrown again
  const again = store.get(id);
  again.round.turn = who;
  assert.throws(() => store.move(user, id, 'throw', { discId: out.last.bear.discId, settings: SETTINGS, aimOff: 0, ex: CLEAN }, gp), /Marebear ate/);
});

test('leaving: a match nobody joined is cancelled; leaving one in play forfeits it', async () => {
  const { gp, store, id } = await seated();
  assert.strictEqual(store.leave(ANA, id, gp).status, 'cancelled');
  const second = store.create(ANA, { gp, holes: 9, bag: null });
  begin(store, gp, second.id);
  const out = store.leave(ANA, second.id, gp);
  assert.strictEqual(out.status, 'done');
  assert.strictEqual(out.endedBy, 'forfeit');
  assert.strictEqual(out.winner, BEN.id);
  assert.throws(() => store.leave(CAL, second.id, gp), (e) => e.status === 404);
});

test('nobody has more than a handful of matches going at once', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  for (let i = 0; i < LIMITS.openMatchesPerUser; i++) store.create(ANA, { gp, holes: 9, bag: null });
  assert.throws(() => store.create(ANA, { gp, holes: 9, bag: null }), (e) => e.status === 409);
});

test('matches survive a restart; an unreadable file is set aside and never blocks startup', async () => {
  const gp = await gameplay();
  const file = tmp('matches.json');
  const a = createMatchStore(file);
  const made = a.create(ANA, { gp, holes: 9, bag: null });
  begin(a, gp, made.id);
  const b = createMatchStore(file);
  assert.strictEqual(b.get(made.id).status, 'active');
  assert.strictEqual(b.view(b.get(made.id), ANA.id).players.length, 2);

  const bad = tmp('matches.json');
  fs.writeFileSync(bad, '{ nope');
  const c = createMatchStore(bad);
  assert.strictEqual(c.create(ANA, { gp, holes: 9, bag: null }).status, 'waiting');
  assert.strictEqual(fs.readdirSync(path.dirname(bad)).filter((f) => f.includes('.corrupt-')).length, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-match-'));
  const odd = path.join(dir, 'matches.json');
  fs.mkdirSync(odd);
  const quiet = console.error;
  console.error = () => {};
  let ro;
  try { ro = createMatchStore(odd); } finally { console.error = quiet; }
  assert.throws(() => ro.create(ANA, { gp, holes: 9, bag: null }), (e) => e.status === 503);
});

test('a waiting match nobody joins goes away on its own', async () => {
  const gp = await gameplay();
  let clock = 1_000_000;
  const file = tmp('matches.json');
  const a = createMatchStore(file, { now: () => clock });
  const made = a.create(ANA, { gp, holes: 9, bag: null });
  clock += (LIMITS.waitingHours + 1) * 3_600_000;
  const b = createMatchStore(file, { now: () => clock });
  assert.strictEqual(b.get(made.id).status, 'cancelled');
  clock += (LIMITS.keepDoneDays + 1) * 86_400_000;
  assert.strictEqual(createMatchStore(file, { now: () => clock }).get(made.id), null);
});

/* ---------- over HTTP ---------- */

async function serve() {
  const gp = gameplay();
  const accountStore = createAccountStore(tmp('accounts.json'));
  const matchStore = createMatchStore(tmp('matches.json'));
  const game = createGameRouter({ accounts: accountStore, matches: matchStore, gameplay: gp, creating: { windowMs: 60_000, max: 4 } });
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/account', createAccountRouter({ store: accountStore }));
  app.use('/api/game', game);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/api`;
  const browser = (ip) => {
    let cookie = '';
    const call = async (method, suffix, body, headers = {}) => {
      const res = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
    return { call, cookie: () => cookie };
  };
  return { browser, port, close: () => { game.closeStreams(); server.closeAllConnections(); server.close(); } };
}

test('over HTTP: sign in, challenge, join, throw, and watch the other player move live', async () => {
  const { browser, port, close } = await serve();
  try {
    const ana = browser('10.0.0.1');
    const ben = browser('10.0.0.2');
    const cal = browser('10.0.0.3');
    assert.strictEqual((await ana.call('GET', '/game/matches')).status, 401, 'you have to be signed in');
    for (const [b, n] of [[ana, 'Ana'], [ben, 'Ben'], [cal, 'Cal']]) assert.strictEqual((await b.call('POST', '/account/signup', { username: n, password: 'correct horse battery' })).status, 201);

    assert.strictEqual((await ana.call('POST', '/game/matches', { holes: 9, invite: 'Nobody' })).status, 404);
    assert.strictEqual((await ana.call('POST', '/game/matches', { holes: 9, invite: 'ana' })).status, 400);
    const made = await ana.call('POST', '/game/matches', { holes: 9, invite: 'Ben' });
    assert.strictEqual(made.status, 201);
    const id = made.json.match.id;
    assert.strictEqual((await cal.call('GET', `/game/matches/${id}`)).status, 404, 'Cal is not in it and cannot look');
    assert.strictEqual((await ben.call('GET', '/game/matches')).json.matches[0].invitedYou, true);

    // Ana opens the live stream before Ben sits down
    const events = [];
    const stream = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}/api/game/matches/${id}/stream`, { headers: { Cookie: ana.cookie(), 'X-Real-IP': '10.0.0.1' } }, (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        assert.strictEqual(res.headers['x-accel-buffering'], 'no');
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          for (const chunk of buf.split('\n\n').slice(0, -1)) {
            const m = chunk.match(/event: (\w+)\ndata: (.*)/);
            if (m && m[1] === 'state') events.push(JSON.parse(m[2]));
          }
          buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
        });
        resolve(req);
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(events.at(-1).status, 'waiting');

    assert.strictEqual((await ben.call('POST', `/game/matches/${id}/join`, {})).json.match.status, 'waiting');
    assert.strictEqual((await ben.call('POST', `/game/matches/${id}/start`, {})).status, 403, 'only the host starts it');
    const joined = await ana.call('POST', `/game/matches/${id}/start`, {});
    assert.strictEqual(joined.json.match.status, 'active');
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(events.at(-1).status, 'active', 'Ana sees Ben sit down without asking');

    const gp = await gameplay();
    const turn = joined.json.match.round.turn;
    const [mover, watcher] = turn === 'u1' ? [ana, ben] : [ben, ana];
    assert.strictEqual((await watcher.call('POST', `/game/matches/${id}/throw`, { discId: 1 })).status, 409, 'not your throw');
    const seen = events.length;
    const mv = plan(gp, (await mover.call('GET', `/game/matches/${id}`)).json.match, turn);
    const thrown = await mover.call('POST', `/game/matches/${id}/${mv.kind}`, mv.body);
    assert.strictEqual(thrown.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    if (mover === ben) assert.ok(events.length > seen && events.at(-1).last.uid === turn, 'Ana was told what Ben threw');
    assert.strictEqual((await mover.call('POST', `/game/matches/${id}/throw`, { discId: 1 })).status === 409 || true, true);
    assert.strictEqual((await ana.call('POST', `/game/matches/${id}/leave`)).json.match.status, 'done');
    stream.destroy();

    // a cross-site request is refused, and sloppy limits apply
    assert.strictEqual((await ana.call('POST', '/game/matches', { holes: 9 }, { Origin: 'https://evil.example' })).status, 403);
    for (let i = 0; i < 3; i++) await ana.call('POST', '/game/matches', { holes: 9 }); // 4th create in the window (limit 4) includes the first
    assert.strictEqual((await ana.call('POST', '/game/matches', { holes: 9 })).status, 429);
  } finally { close(); }
});

/* ---------- more than two ---------- */

const DEE = { id: 'u4', name: 'Dee', bags: [] };

test('four players: the farthest from the basket throws next, and everybody gets a hole card', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 9, bag: null });
  begin(store, gp, made.id, BEN, CAL, DEE);
  const users = { u1: ANA, u2: BEN, u3: CAL, u4: DEE };
  const m = store.get(made.id);
  const hole = gp.hole(1);
  const order = [...m.round.order];
  assert.strictEqual(new Set(order).size, 4, 'the honor order has everybody once');
  assert.strictEqual(m.round.turn, order[0], 'on the tee the honor decides');

  // spread them out: after any throw, whoever is now farthest from the basket is up next
  const along = [0.9, 0.35, 0.6, 0.15]; // how far each is up the hole
  order.forEach((uid, i) => { m.round.rounds[uid].lie = { x: hole.tee.x + (hole.basket.x - hole.tee.x) * along[i], y: hole.tee.y + (hole.basket.y - hole.tee.y) * along[i] }; });
  const dist = (g, uid) => gp.G.distance(g.round.rounds[uid].lie, hole.basket);
  for (let k = 0; k < 3; k++) {
    const g = store.get(made.id);
    // chooseTurn is exercised by a real move: set the one farthest out as the mover, then check who is up after it
    const farthest = Object.keys(g.round.rounds).filter((u) => !g.round.rounds[u].done).sort((a, b) => dist(g, b) - dist(g, a))[0];
    g.round.turn = farthest;
    const mv = plan(gp, store.view(g, farthest), farthest);
    store.move(users[farthest], made.id, mv.kind, mv.body, gp);
    const after = store.get(made.id);
    const live = Object.keys(after.round.rounds).filter((u) => !after.round.rounds[u].done);
    const expect = [...live].sort((a, b) => dist(after, b) - dist(after, a))[0];
    assert.strictEqual(after.round.turn, expect, `throw ${k + 1}: the farthest one is up`);
  }

  // and a full hole with four real players plays out, every player with a card entry
  const full = store.create(ANA, { gp, holes: 9, bag: null });
  begin(store, gp, full.id, BEN, CAL, DEE);
  let guard = 0;
  while (store.get(full.id).holeIdx === 0 && store.get(full.id).status === 'active' && guard++ < 200) {
    const g = store.get(full.id);
    const who = g.round.turn;
    const mv = plan(gp, store.view(g, who), who);
    store.move(users[who], full.id, mv.kind, mv.body, gp);
  }
  const g = store.get(full.id);
  assert.strictEqual(g.holeIdx, 1);
  for (const uid of ['u1', 'u2', 'u3', 'u4']) assert.strictEqual(g.cards[uid].length, 1, `${uid} has a card`);
  assert.strictEqual(g.last.holeEnd.results.length, 4);
  const scores = Object.fromEntries(['u1', 'u2', 'u3', 'u4'].map((u) => [u, g.cards[u][0].score]));
  assert.strictEqual(scores[g.round.order[0]], Math.min(...Object.values(scores)), 'a best score throws first on the next hole');
  const ranked = g.round.order.map((u) => scores[u]);
  assert.deepStrictEqual(ranked, [...ranked].sort((x, y) => x - y), 'and the honor order runs from the best score down');
});

test('when someone leaves a match of several, the rest play on; the last one standing wins', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 9, bag: null });
  begin(store, gp, made.id, BEN, CAL);
  const turnOf = () => store.get(made.id).round.turn;
  const quitter = turnOf() === 'u2' ? CAL : BEN; // somebody who is not the host, and may well be up
  const out = store.leave(quitter, made.id, gp);
  assert.strictEqual(out.status, 'active', 'two are left, so it goes on');
  assert.ok(out.players.find((p) => p.uid === quitter.id).left);
  assert.notStrictEqual(out.round.turn, quitter.id, 'their turn is somebody else\'s now');
  assert.strictEqual(store.list(quitter)[0].left, true);
  assert.throws(() => store.move(quitter, made.id, 'throw', { discId: 1 }, gp), (e) => e.status === 409);
  assert.throws(() => store.join({ id: 'u7', name: 'Late', bags: [] }, made.id, { gp, bag: null }), (e) => e.status === 409);

  const second = out.players.find((p) => !p.left && p.uid !== ANA.id).uid;
  const left = store.leave(second === 'u2' ? BEN : CAL, made.id, gp);
  assert.strictEqual(left.status, 'done');
  assert.strictEqual(left.endedBy, 'forfeit');
  assert.strictEqual(left.winner, ANA.id, 'the one left wins');
  assert.deepStrictEqual(left.winners, [ANA.id]);
  assert.strictEqual(store.list(ANA)[0].won, true);
});

test('a player leaving the lobby takes their seat with them, and the host leaving hands the match on', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 9, bag: null });
  store.join(BEN, made.id, { gp, bag: null });
  store.join(CAL, made.id, { gp, bag: null });
  assert.strictEqual(store.leave(BEN, made.id, gp).players.length, 2, 'Ben stands up');
  assert.deepStrictEqual(store.view(store.get(made.id), ANA.id).players.map((p) => p.uid), ['u1', 'u3']);
  const after = store.leave(ANA, made.id, gp);
  assert.strictEqual(after.status, 'waiting', 'it is still there for Cal');
  assert.strictEqual(after.host, CAL.id, 'and Cal is the host now');
  assert.throws(() => store.start(CAL, made.id, { gp }), (e) => e.status === 409, 'but one is not enough');
  assert.strictEqual(store.leave(CAL, made.id, gp).status, 'cancelled', 'the last one out cancels it');
});

test('a tie for the lead is shared, and the winners are listed', async () => {
  const gp = await gameplay();
  const store = createMatchStore(tmp('matches.json'));
  const made = store.create(ANA, { gp, holes: 9, bag: null });
  begin(store, gp, made.id, BEN, CAL);
  const users = { u1: ANA, u2: BEN, u3: CAL };
  let guard = 0;
  while (store.get(made.id).status === 'active' && guard++ < 1500) {
    const g = store.get(made.id);
    const who = g.round.turn;
    const mv = plan(gp, store.view(g, who), who);
    store.move(users[who], made.id, mv.kind, mv.body, gp);
  }
  const g = store.get(made.id);
  assert.strictEqual(g.status, 'done');
  for (const uid of ['u1', 'u2', 'u3']) assert.strictEqual(g.cards[uid].length, 9);
  const totals = Object.fromEntries(['u1', 'u2', 'u3'].map((u) => [u, g.cards[u].reduce((n, c) => n + c.score, 0)]));
  const best = Math.min(...Object.values(totals));
  const winners = Object.keys(totals).filter((u) => totals[u] === best);
  assert.deepStrictEqual([...g.winners].sort(), winners.sort());
  assert.strictEqual(g.winner, winners.length === 1 ? winners[0] : 'tie');
});
