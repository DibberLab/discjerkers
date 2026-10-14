'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createAccountStore } = require('../server/lib/accounts');
const { createAccountRouter } = require('../server/routes/account');
const { createMatchStore, loadGameplay } = require('../server/lib/matches');

const load = () => import('../public/js/progress.js');

test('goals: each is reached by playing, once, and unlocks its skin', async () => {
  const P = await load();
  const g = P.emptyGame();
  assert.deepStrictEqual(g.owned, ['classic']);
  assert.deepStrictEqual(P.recordThrow(g, { discId: 7, putt: false, kind: 'landed', feet: 320 }), []);
  assert.strictEqual(g.stats.throws, 1);
  assert.strictEqual(g.stats.bestDrive, 320);
  assert.deepStrictEqual(P.recordThrow(g, { discId: 7, putt: true, made: true, dist: 38 }), [], '38 feet is not enough');
  assert.deepStrictEqual(P.recordThrow(g, { discId: 7, putt: true, made: true, dist: 41 }), ['longputt']);
  assert.ok(g.owned.includes('chrome'), 'the skin comes with it');
  assert.deepStrictEqual(P.recordThrow(g, { discId: 7, putt: true, made: true, dist: 45 }), [], 'only once');
  assert.deepStrictEqual(P.recordThrow(g, { discId: 7, putt: true, made: true, gimme: true, dist: 1 }), []);
  assert.deepStrictEqual(P.recordThrow(g, { discId: 8, putt: false, kind: 'basket', feet: 300 }), ['ace']);
  assert.ok(g.owned.includes('gold') && g.stats.aces === 1);
  // a streak of three holes under par, broken by a par
  assert.deepStrictEqual(P.recordHole(g, { strokes: 3, par: 4, holed: true }), []);
  assert.deepStrictEqual(P.recordHole(g, { strokes: 3, par: 4, holed: true }), []);
  assert.deepStrictEqual(P.recordHole(g, { strokes: 2, par: 4, holed: true }).sort(), ['eagle', 'streak3'], 'an eagle that is also the third in a row');
  assert.strictEqual(g.stats.bestStreak, 3);
  P.recordHole(g, { strokes: 4, par: 4, holed: true });
  assert.strictEqual(g.stats.streak, 0);
  assert.deepStrictEqual(P.recordHole(g, { strokes: 5, par: 4, holed: true, rain: true }), []);
  assert.deepStrictEqual(P.recordHole(g, { strokes: 4, par: 4, holed: true, rain: true }), ['rainy']);
  assert.deepStrictEqual(P.recordRound(g, { holes: 3, penalties: 0 }), [], 'a warm-up is not a round');
  assert.deepStrictEqual(P.recordRound(g, { holes: 9, penalties: 1 }), []);
  assert.deepStrictEqual(P.recordRound(g, { holes: 9, penalties: 0 }), ['clean']);
  assert.deepStrictEqual(P.recordDaily(g), ['daily']);
  assert.deepStrictEqual(P.recordBetWon(g), ['bettor']);
  // a disc thrown a hundred times
  for (let i = 0; i < 100; i++) P.recordThrow(g, { discId: 9, putt: false, kind: 'landed', feet: 100 });
  assert.ok(g.unlocked.includes('veteran'));
  assert.ok(P.ACHIEVEMENTS.every((a) => g.unlocked.includes(a.id) || a.id === 'regular'), 'all but the 25 holes');
  // skins can be bought with bucks, and worn once owned
  const h = P.emptyGame();
  assert.deepStrictEqual(P.buySkin(h, 'neon', 10), { ok: false, reason: 'poor', cost: 15 });
  assert.deepStrictEqual(P.buySkin(h, 'neon', 15), { ok: true, cost: 15 });
  assert.strictEqual(P.buySkin(h, 'neon', 99).reason, 'owned');
  assert.strictEqual(P.equipSkin(h, 'ice'), false);
  assert.strictEqual(P.equipSkin(h, 'neon'), true);
  assert.strictEqual(h.skin, 'neon');
  assert.strictEqual(P.skinOf('nonsense').id, 'classic');
});

test('break-in: a disc you have thrown a lot turns more, up to a limit, and a new one is untouched', async () => {
  const P = await load();
  const disc = { id: 1, speed: 9, glide: 5, turn: -1, fade: 2 };
  assert.strictEqual(P.brokenIn(disc, 0), disc, 'the very same disc');
  assert.strictEqual(P.brokenIn(disc, undefined), disc);
  const half = P.brokenIn(disc, 80);
  assert.ok(half.turn < disc.turn && half.turn > disc.turn - 1 && half.fade < disc.fade);
  const worn = P.brokenIn(disc, 160);
  assert.strictEqual(worn.turn, -2);
  assert.strictEqual(P.brokenIn(disc, 5000).turn, -2, 'it stops at a point');
  assert.strictEqual(worn.speed, 9, 'and nothing else changes');
  assert.strictEqual(P.wearOf({ stats: { discs: { 4: 12 } } }, 4), 12);
  assert.strictEqual(P.wearOf(null, 4), 0);
});

test('a stored game is checked for shape, and two copies merge without losing anything', async () => {
  const P = await load();
  assert.strictEqual(P.sanitizeGame(null), null);
  assert.strictEqual(P.sanitizeGame({ v: 2 }), null);
  const messy = P.sanitizeGame({ v: 1, stats: { throws: -5, holes: 1e12, aces: 'lots', bestPutt: 999, discs: { 5: 12, abc: 3, '-1': 4, 6: 1e9 } }, unlocked: ['ace', 'nonsense', 'ace'], owned: ['gold', 'fake'], skin: 'fake' });
  assert.strictEqual(messy.stats.throws, 0);
  assert.strictEqual(messy.stats.holes, 1e6);
  assert.strictEqual(messy.stats.aces, 0);
  assert.strictEqual(messy.stats.bestPutt, 60);
  assert.deepStrictEqual(messy.stats.discs, { 5: 12, 6: 1e5 });
  assert.deepStrictEqual(messy.unlocked, ['ace']);
  assert.deepStrictEqual(messy.owned, ['classic', 'gold']);
  assert.strictEqual(messy.skin, 'classic', 'a skin you do not own is not worn');
  const a = P.emptyGame(); a.stats.throws = 50; a.stats.discs[3] = 40; a.unlocked = ['ace']; a.owned = ['classic', 'gold']; a.skin = 'gold';
  const b = P.emptyGame(); b.stats.throws = 80; b.stats.discs[3] = 10; b.stats.discs[4] = 7; b.unlocked = ['daily']; b.owned = ['classic', 'leopard'];
  const m = P.mergeGame(a, b);
  assert.strictEqual(m.stats.throws, 80);
  assert.deepStrictEqual(m.stats.discs, { 3: 40, 4: 7 });
  assert.deepStrictEqual([...m.unlocked].sort(), ['ace', 'daily']);
  assert.deepStrictEqual([...m.owned].sort(), ['classic', 'gold', 'leopard']);
  assert.strictEqual(m.skin, 'gold');
  assert.ok(P.mergeGame(null, null).owned.includes('classic'));
});

const tmp = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-prog-')), name);

test('over HTTP: a signed-in player\'s progress is stored, checked and handed back; and it follows them into a match as wear', async () => {
  const accountStore = createAccountStore(tmp('accounts.json'));
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/account', createAccountRouter({ store: accountStore }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/account`;
  let cookie = '';
  const call = async (method, suffix, body) => {
    const res = await fetch(base + suffix, { method, headers: { 'Content-Type': 'application/json', 'X-Real-IP': '10.2.0.1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  try {
    const P = await load();
    assert.strictEqual((await call('GET', '/game')).status, 401);
    assert.strictEqual((await call('POST', '/signup', { username: 'Dana', password: 'correct horse battery' })).status, 201);
    assert.deepStrictEqual((await call('GET', '/game')).json, { game: null });
    assert.strictEqual((await call('PUT', '/game', { game: { v: 9 } })).status, 400);
    const g = P.emptyGame();
    g.stats.throws = 130; g.stats.discs[3] = 130; g.unlocked = ['ace', 'bogus']; g.owned = ['classic', 'gold', 'nope']; g.skin = 'gold';
    const put = await call('PUT', '/game', { game: g });
    assert.strictEqual(put.status, 200);
    assert.deepStrictEqual(put.json.game.unlocked, ['ace'], 'what it keeps is checked');
    const back = (await call('GET', '/game')).json.game;
    assert.strictEqual(back.stats.discs['3'], 130);
    assert.strictEqual(back.skin, 'gold');
    // in a match: the bag is frozen with the wear, and a worn disc plays differently
    const gp = await loadGameplay();
    const store = createMatchStore(tmp('matches.json'));
    const dana = { ...accountStore.userForSession(cookie.split('=')[1]), id: 'u-dana' };
    assert.ok(dana.game && dana.game.stats.discs[3] === 130, 'the session carries it');
    const discId = [...gp.discs.keys()][0];
    const bag = { discs: [discId], items: {} };
    const user = { id: 'u-dana', name: 'Dana', bags: [], game: { stats: { discs: { [discId]: 130 } } } };
    const made = store.create(user, { gp, holes: 9, bag });
    const snap = store.get(made.id).players[0].discs[0];
    assert.strictEqual(snap.id, discId);
    assert.strictEqual(snap.w, 130, 'the wear is on the seat');
    const fresh = store.create({ id: 'u-ben', name: 'Ben', bags: [] }, { gp, holes: 9, bag: null });
    assert.ok(store.get(fresh.id).players[0].discs.every((d) => d.w === undefined), 'no wear, nothing recorded');
  } finally { server.closeAllConnections(); server.close(); }
});
