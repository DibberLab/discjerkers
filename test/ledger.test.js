'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createMatchStore, loadGameplay } = require('../server/lib/matches');
const { createGameRouter } = require('../server/routes/game');
const { createAccountStore } = require('../server/lib/accounts');
const { createAccountRouter } = require('../server/routes/account');
const { createLedger } = require('../server/lib/ledger');

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-ledger-')), name);
const DAY = 86_400_000;

test('the daily plan: one nine-hole round per day, the same for everyone, different every day', async () => {
  const D = await import('../public/js/daily.js');
  const a = D.dailyPlan('2026-10-13');
  assert.deepStrictEqual(a, D.dailyPlan('2026-10-13'));
  assert.strictEqual(a.holeIds.length, 9);
  assert.strictEqual(new Set(a.holeIds).size, 9);
  assert.ok(a.holeIds.every((id) => id >= 1 && id <= 18));
  assert.ok(a.seed > 0 && Number.isInteger(a.seed));
  const days = new Set();
  for (let d = 1; d <= 20; d++) days.add(D.dailyPlan(`2026-11-${String(d).padStart(2, '0')}`).holeIds.join(','));
  assert.ok(days.size >= 19, 'a new course most days');
  assert.strictEqual(D.dayKey(new Date('2026-10-13T23:59:59Z')), '2026-10-13');
  assert.strictEqual(D.dayKey(new Date('2026-10-14T00:00:01Z')), '2026-10-14');
  assert.ok(D.isDayKey('2026-10-13') && !D.isDayKey('2026-13-45') && !D.isDayKey('today'));
  assert.strictEqual(D.nextDailyAt(Date.parse('2026-10-13T12:00:00Z')), Date.parse('2026-10-14T00:00:00Z'));
});

test('the daily board: one score each, best first, and you are found', async () => {
  const file = tmp('ledger.json');
  let clock = Date.parse('2026-10-13T12:00:00Z');
  const L = createLedger(file, { now: () => clock });
  assert.deepStrictEqual(L.board('2026-10-13', 'u1'), { entries: 0, top: [], you: null });
  assert.ok(L.addDaily('2026-10-13', { uid: 'u1', name: 'Ana', total: 36, par: 33, card: [4, 4, 4, 4, 4, 4, 4, 4, 4] }).ok);
  clock += 1000;
  assert.ok(L.addDaily('2026-10-13', { uid: 'u2', name: 'Ben', total: 33, par: 33, card: [] }).ok);
  clock += 1000;
  assert.ok(L.addDaily('2026-10-13', { uid: 'u3', name: 'Cal', total: 36, par: 33, card: [] }).ok);
  assert.strictEqual(L.addDaily('2026-10-13', { uid: 'u1', name: 'Ana', total: 20, par: 33, card: [] }).reason, 'already', 'the first run counts');
  const b = L.board('2026-10-13', 'u3');
  assert.deepStrictEqual(b.top.map((e) => [e.rank, e.name]), [[1, 'Ben'], [2, 'Ana'], [3, 'Cal']], 'a tie goes to whoever posted first');
  assert.strictEqual(b.you.rank, 3);
  assert.ok(b.top[2].you && !b.top[0].you);
  assert.ok(L.hasPlayed('2026-10-13', 'u2') && !L.hasPlayed('2026-10-14', 'u2'));
  // it is on disk, and old days go
  const again = createLedger(file, { now: () => clock });
  assert.strictEqual(again.board('2026-10-13', 'u1').entries, 3);
  clock += 60 * DAY;
  L.addDaily('2026-12-12', { uid: 'u1', name: 'Ana', total: 30, par: 33, card: [] });
  assert.strictEqual(L.board('2026-10-13', 'u1').entries, 0, 'a day older than 45 days is forgotten');
});

test('standings: finished matches are on the season\'s record once, and rank by wins', async () => {
  const L = createLedger(tmp('ledger.json'), { now: () => Date.parse('2026-10-20T12:00:00Z') });
  const match = (id, scores, winners, extra = {}) => ({
    id, status: 'done', endedBy: 'finished', winners,
    players: Object.keys(scores).map((uid) => ({ uid, name: uid.toUpperCase() })),
    cards: Object.fromEntries(Object.entries(scores).map(([uid, t]) => [uid, Array.from({ length: 9 }, (_, i) => ({ score: i === 0 ? t - 32 : 4, par: 4 }))])),
    ...extra,
  });
  assert.ok(L.recordMatch(match('M1', { a: 33, b: 36 }, ['a'])));
  assert.ok(!L.recordMatch(match('M1', { a: 33, b: 36 }, ['a'])), 'only once');
  L.recordMatch(match('M2', { a: 40, b: 38, c: 41 }, ['b']));
  L.recordMatch(match('M3', { a: 35, b: 35 }, ['a', 'b']));
  assert.ok(!L.recordMatch(match('M4', { a: 33, b: 36 }, ['a'], { endedBy: 'forfeit' })), 'a forfeit is not a result');
  assert.ok(!L.recordMatch(match('M5', { a: 33 }, ['a'])), 'nor is a match of one');
  const t = L.standings('2026-10');
  assert.deepStrictEqual(t.map((r) => [r.name, r.points, r.wins, r.ties, r.played]), [['A', 4, 1, 1, 3], ['B', 4, 1, 1, 3], ['C', 0, 0, 0, 1]]);
  assert.deepStrictEqual(L.standings('2026-09'), []);
});

async function serve() {
  const accountStore = createAccountStore(tmp('accounts.json'));
  const ledger = createLedger(tmp('ledger.json'));
  const game = createGameRouter({ accounts: accountStore, matches: createMatchStore(tmp('matches.json')), gameplay: loadGameplay(), ledger });
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/account', createAccountRouter({ store: accountStore }));
  app.use('/api/game', game);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const browser = (ip) => {
    let cookie = '';
    return async (method, suffix, body) => {
      const res = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, json: await res.json().catch(() => ({})) };
    };
  };
  return { browser, ledger, close: () => { game.closeStreams(); server.closeAllConnections(); server.close(); } };
}

test('over HTTP: today\'s daily course, posting a card, one score a day, and the board', async () => {
  const { browser, close } = await serve();
  try {
    const D = await import('../public/js/daily.js');
    const C = await import('../public/js/course.js');
    const ana = browser('10.1.0.1');
    const ben = browser('10.1.0.2');
    assert.strictEqual((await ana('GET', '/game/daily')).status, 401, 'sign in first');
    for (const [b, n] of [[ana, 'Ana'], [ben, 'Ben']]) assert.strictEqual((await b('POST', '/account/signup', { username: n, password: 'correct horse battery' })).status, 201);
    const today = await ana('GET', '/game/daily');
    assert.strictEqual(today.status, 200);
    const plan = D.dailyPlan(D.dayKey());
    assert.deepStrictEqual(today.json.holeIds, plan.holeIds);
    assert.strictEqual(today.json.seed, plan.seed);
    assert.strictEqual(today.json.played, false);
    const card = (extra = 0) => plan.holeIds.map((id) => ({ hole: id, strokes: C.holeById(id).par + extra, holed: true }));
    // nonsense is refused
    assert.strictEqual((await ana('POST', '/game/daily/score', { day: '2020-01-01', card: card() })).status, 400, 'not a day you can post to');
    assert.strictEqual((await ana('POST', '/game/daily/score', { day: plan.day, card: card().slice(1) })).status, 400, 'a short card');
    assert.strictEqual((await ana('POST', '/game/daily/score', { day: plan.day, card: [...card().slice(1), { hole: 99, strokes: 3, holed: true }] })).status, 400, 'the wrong holes');
    assert.strictEqual((await ana('POST', '/game/daily/score', { day: plan.day, card: card().map((c, i) => (i ? c : { ...c, strokes: 0 })) })).status, 400, 'no such score');
    // a real one
    const par = card().reduce((n, c) => n + C.holeById(c.hole).par, 0);
    const posted = await ana('POST', '/game/daily/score', { day: plan.day, card: card(1) });
    assert.strictEqual(posted.status, 201);
    assert.strictEqual(posted.json.total, par + 9);
    assert.strictEqual(posted.json.board.you.rank, 1);
    assert.strictEqual((await ana('POST', '/game/daily/score', { day: plan.day, card: card() })).status, 409, 'one a day');
    assert.strictEqual((await ben('POST', '/game/daily/score', { day: plan.day, card: card(-1) })).status, 201);
    const board = (await ana('GET', '/game/daily')).json;
    assert.strictEqual(board.played, true);
    assert.deepStrictEqual(board.board.top.map((e) => e.name), ['Ben', 'Ana']);
    // a hole you did not finish scores the worst a hole can be, whatever the card says
    const cal = browser('10.1.0.3');
    await cal('POST', '/account/signup', { username: 'Cal', password: 'correct horse battery' });
    const unfinished = card(0).map((c, i) => (i === 0 ? { ...c, strokes: 2, holed: false } : c));
    const r = await cal('POST', '/game/daily/score', { day: plan.day, card: unfinished });
    assert.strictEqual(r.json.total, par - C.holeById(plan.holeIds[0]).par + (C.holeById(plan.holeIds[0]).par + 4), 'an unfinished hole counts as par + 4');
    const season = await ana('GET', '/game/standings');
    assert.strictEqual(season.status, 200);
    assert.deepStrictEqual(season.json.table, []);
  } finally { close(); }
});

test('the throw of the match is kept: an ace is the best, then a long putt, then a long pure drive', async () => {
  const G = await import('../public/js/gamecore.js');
  assert.ok(G.highlightScore({ kind: 'basket', putt: false, feet: 280 }) > G.highlightScore({ kind: 'basket', putt: true, made: true, dist: 45 }), 'an ace beats a long putt');
  assert.ok(G.highlightScore({ kind: 'basket', putt: true, made: true, dist: 45 }) > G.highlightScore({ kind: 'landed', putt: false, feet: 400, ex: { pure: true } }));
  assert.strictEqual(G.highlightScore({ kind: 'basket', putt: true, made: true, gimme: true, dist: 1 }), 0, 'a tap-in is not a highlight');
  assert.strictEqual(G.highlightScore({ kind: 'water' }), 0);
});
