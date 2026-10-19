'use strict';

const express = require('express');
const { MatchError } = require('../lib/matches');
const { createLimiter } = require('../lib/ratelimit');
const { SESSION_COOKIE, cookieOf, sameOrigin } = require('../lib/http');

const HOUR = 60 * 60 * 1000;
const MAX_WATCHERS = 400;
const MAX_STREAMS_PER_USER = 8;
const KEEPALIVE_MS = 15_000;

/**
 * Head-to-head matches. Mounted at /api/game. Everything needs a signed-in player.
 *   GET  /matches               my matches, and invitations to me
 *   POST /matches               start one: { holes: 9|18, course?: 1|2, invite?: username, bagId? }
 *   POST /matches/:id/join      sit down at a match by its code: { bagId? }  (two to eight players)
 *   POST /matches/:id/start     the host starts it once two or more are seated
 *   GET  /matches/:id           where it stands
 *   GET  /matches/:id/stream    server-sent events: the match, pushed as it changes
 *   POST /matches/:id/throw     { discId, settings, aimOff, ex }   (only on your turn)
 *   POST /matches/:id/putt      { discId, x, y }   where the dot was when you tapped, on the unit circle
 *   POST /matches/:id/drop      { discId }         off in the woods too far: a drop back on the fairway for a stroke (the server places it)
 *   POST /matches/:id/leave     forfeit, or leave one that has not started
 * Every response is no-store: it is about two people.
 */
function createGameRouter({
  accounts,
  matches,
  gameplay,
  ledger = null,
  posting = { windowMs: HOUR, max: 20 },
  creating = { windowMs: HOUR, max: 20 },
  joining = { windowMs: HOUR, max: 60 },
  moving = { windowMs: HOUR, max: 800 },
}) {
  const router = express.Router();
  const createLimit = createLimiter(creating);
  const joinLimit = createLimiter(joining);
  const moveLimit = createLimiter(moving);
  const postLimit = createLimiter(posting);
  const watchers = new Map(); // match id -> Set of { res, uid }
  let watching = 0;

  const send = (w, event, data) => {
    try { w.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { drop(w); }
  };
  function drop(w) {
    for (const [id, set] of watchers) {
      if (set.delete(w)) { watching -= 1; if (!set.size) watchers.delete(id); }
    }
  }

  matches.on('change', (m) => {
    if (ledger && m.status === 'done') ledger.recordMatch(m); // finished matches go on the season's record, once
    const set = watchers.get(m.id);
    if (!set) return;
    for (const w of [...set]) send(w, 'state', matches.view(m, w.uid));
  });
  const keepalive = setInterval(() => {
    for (const set of watchers.values()) for (const w of set) { try { w.res.write('event: ping\ndata: {}\n\n'); } catch { drop(w); } }
  }, KEEPALIVE_MS);
  keepalive.unref();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !sameOrigin(req)) return next(new MatchError('Cross-site request refused.', 403));
    next();
  });

  const wrap = (fn) => async (req, res, next) => {
    try {
      const user = accounts.userForSession(cookieOf(req, SESSION_COOKIE));
      if (!user) throw new MatchError('Sign in first.', 401);
      const gp = await gameplay.catch(() => null);
      if (!gp) throw new MatchError('The game is unavailable right now.', 503);
      await fn(req, res, user, gp);
    } catch (err) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      next(err);
    }
  };

  const gate = (limiter, key, message) => {
    const verdict = limiter.peek(key);
    if (!verdict.ok) {
      const err = new MatchError(`${message} Try again in ${Math.ceil(verdict.retryAfterSec / 60)} min.`, 429);
      err.retryAfter = verdict.retryAfterSec;
      throw err;
    }
    limiter.hit(key);
  };

  // the bag a player brings to a match: the one they pick, else their main bag
  const bagFor = (user, bagId) => user.bags.find((b) => b.id === bagId) || user.bags.find((b) => b.main) || user.bags[0] || null;

  router.get('/matches', wrap(async (req, res, user) => {
    res.json({ matches: matches.list(user) });
  }));

  router.post('/matches', wrap(async (req, res, user, gp) => {
    gate(createLimit, user.id, 'That is a lot of new matches.');
    const body = req.body || {};
    const invite = String(body.invite ?? '').trim();
    if (invite) {
      if (invite.toLowerCase() === user.name.toLowerCase()) throw new MatchError('You cannot challenge yourself.');
      if (!accounts.hasUser(invite)) throw new MatchError('No player has that username.', 404);
    }
    res.status(201).json({ match: matches.create(user, { gp, holes: Number(body.holes), course: body.course === undefined ? 1 : Number(body.course), invite: invite || null, bag: bagFor(user, body.bagId) }) });
  }));

  router.post('/matches/:id/join', wrap(async (req, res, user, gp) => {
    gate(joinLimit, user.id, 'Too many join attempts.');
    res.json({ match: matches.join(user, req.params.id, { gp, bag: bagFor(user, (req.body || {}).bagId) }) });
  }));

  router.post('/matches/:id/start', wrap(async (req, res, user, gp) => {
    res.json({ match: matches.start(user, req.params.id, { gp }) });
  }));

  router.get('/matches/:id', wrap(async (req, res, user) => {
    const m = matches.get(req.params.id);
    if (!m || !matches.isMember(m, user.id)) throw new MatchError('No such match.', 404);
    res.json({ match: matches.view(m, user.id) });
  }));

  router.get('/matches/:id/stream', wrap(async (req, res, user) => {
    const m = matches.get(req.params.id);
    if (!m || !matches.isMember(m, user.id)) throw new MatchError('No such match.', 404);
    const mine = [...(watchers.get(m.id) || [])].filter((w) => w.uid === user.id).length;
    if (watching >= MAX_WATCHERS || mine >= MAX_STREAMS_PER_USER) throw new MatchError('Too many open connections. Try again shortly.', 503);
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tells nginx not to hold events back
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const w = { res, uid: user.id };
    if (!watchers.has(m.id)) watchers.set(m.id, new Set());
    watchers.get(m.id).add(w);
    watching += 1;
    send(w, 'state', matches.view(m, user.id));
    req.on('close', () => drop(w));
  }));

  for (const kind of ['throw', 'putt', 'drop']) {
    router.post(`/matches/:id/${kind}`, wrap(async (req, res, user, gp) => {
      gate(moveLimit, user.id, 'Easy. That is a lot of throws.');
      res.json(matches.move(user, req.params.id, kind, req.body, gp));
    }));
  }

  router.post('/matches/:id/leave', wrap(async (req, res, user, gp) => {
    res.json({ match: matches.leave(user, req.params.id, gp) });
  }));

  /* ----- the daily course and the standings ----- */

  // today's course, and who has done best
  router.get('/daily', wrap(async (req, res, user, gp) => {
    if (!ledger) throw new MatchError('Not available.', 404);
    const plan = gp.daily.dailyPlan(gp.daily.dayKey());
    res.json({ ...plan, closesAt: gp.daily.nextDailyAt(), played: ledger.hasPlayed(plan.day, user.id), board: ledger.board(plan.day, user.id) });
  }));

  // post a finished run: the first one each day counts. The meters are honor system, so the card is checked for sense, not for proof.
  router.post('/daily/score', wrap(async (req, res, user, gp) => {
    if (!ledger) throw new MatchError('Not available.', 404);
    gate(postLimit, user.id, 'That is a lot of scores.');
    const { G, daily } = gp;
    const body = req.body || {};
    const today = daily.dayKey();
    const yesterday = daily.dayKey(new Date(Date.now() - 24 * 3600 * 1000));
    if (![today, yesterday].includes(body.day)) throw new MatchError('That is not a course you can post to.');
    const plan = daily.dailyPlan(body.day);
    const card = Array.isArray(body.card) ? body.card : [];
    if (card.length !== plan.holeIds.length) throw new MatchError('A daily card has nine holes.');
    let total = 0;
    let par = 0;
    const strokes = [];
    for (const [i, c] of card.entries()) {
      const hole = gp.hole(plan.holeIds[i]);
      const s = Number(c && c.strokes);
      if (Number(c && c.hole) !== hole.id || !Number.isInteger(s) || s < 1 || s > 14) throw new MatchError('That card does not add up.');
      const score = G.holeScore(s, hole.par, !!c.holed);
      total += score;
      par += hole.par;
      strokes.push(score);
    }
    if (ledger.hasPlayed(body.day, user.id)) throw new MatchError('You already posted a score for that day.', 409);
    const r = ledger.addDaily(body.day, { uid: user.id, name: user.name, total, par, card: strokes });
    if (!r.ok) throw new MatchError(r.reason === 'already' ? 'You already posted a score for that day.' : 'Scores are unavailable right now.', r.reason === 'already' ? 409 : 503);
    res.status(201).json({ day: body.day, total, par, board: ledger.board(body.day, user.id) });
  }));

  // the season (a calendar month): who has won the most matches
  router.get('/standings', wrap(async (req, res, user, gp) => {
    if (!ledger) throw new MatchError('Not available.', 404);
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : gp.daily.dayKey().slice(0, 7);
    res.json({ month, table: ledger.standings(month).slice(0, 25).map((t, i) => ({ rank: i + 1, ...t, you: t.uid === user.id, uid: undefined })) });
  }));

  // on shutdown, release open streams so the container can stop promptly (browsers reconnect on their own)
  router.closeStreams = () => {
    clearInterval(keepalive);
    for (const set of watchers.values()) for (const w of set) { try { w.res.end(); } catch { /* already gone */ } }
    watchers.clear();
    watching = 0;
  };

  return router;
}

module.exports = { createGameRouter };
