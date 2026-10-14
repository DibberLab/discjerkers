'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('Marebear pops up like a jack-in-the-box: up, held, and back down, for as long as her words take to read', async () => {
  const M = await import('../public/js/marebear.js');
  assert.strictEqual(M.popRise(-5, 3000), 0);
  assert.ok(M.popRise(100, 3000) > 0.2 && M.popRise(100, 3000) < 1.1, 'on her way up');
  assert.strictEqual(M.popRise(1500, 3000), 1, 'held up in the middle');
  assert.ok(M.popRise(2995, 3000) < 0.1 && M.popRise(2900, 3000) < M.popRise(2800, 3000), 'and sinking away at the end');
  assert.strictEqual(M.popRise(3100, 3000), 0);
  let max = 0;
  for (let t = 0; t < 400; t += 10) max = Math.max(max, M.popRise(t, 3000));
  assert.ok(max > 1.0 && max < 1.12, `she overshoots a little: ${max}`);
  assert.ok(M.popDuration('Ha.') >= 2400 && M.popDuration('x'.repeat(500)) <= 6200 && M.popDuration('x'.repeat(100)) > M.popDuration('x'.repeat(20)), 'longer words, longer stay');
});

test('her words are broken into lines that fit the balloon', async () => {
  const M = await import('../public/js/marebear.js');
  const c = { measureText: (t) => ({ width: t.length * 8 }) };
  const lines = M.wrap(c, 'You threw a perfectly good disc into a pond. I will remember this.', 160);
  assert.ok(lines.length >= 3 && lines.every((l) => l.length * 8 <= 160), JSON.stringify(lines));
  assert.strictEqual(lines.join(' '), 'You threw a perfectly good disc into a pond. I will remember this.');
  assert.deepStrictEqual(M.wrap(c, '', 100), []);
});

test('she can be drawn in every mood, with and without legs, and never throws', async () => {
  const M = await import('../public/js/marebear.js');
  let calls = 0;
  const ctx = new Proxy({}, { get: (_, k) => () => { calls++; }, set: () => true });
  for (const mood of ['laugh', 'grudge', 'sly', 'wave']) {
    for (const full of [false, true]) {
      for (const t of [0, 77, 1234]) assert.doesNotThrow(() => M.drawMarebear(ctx, 100, 200, 1.2, { mood, t, full, purse: full ? 0.5 : -1, walk: t / 1000, facing: t % 2 ? 1 : -1 }));
    }
  }
  assert.ok(calls > 2000, `something was drawn: ${calls}`);
});

test('sound: every sound can be made without a hitch, and nothing plays when it is off or unavailable', async () => {
  const S = await import('../public/js/sound.js');
  assert.ok(['laugh', 'chains', 'splash', 'thunk', 'throw', 'clank', 'fanfare', 'snap'].every((n) => S.NAMES.includes(n)));
  assert.doesNotThrow(() => S.play('laugh')); // no browser: a no-op
  // a stand-in for the browser's audio: every part accepts anything
  const node = () => new Proxy(function () {}, { get: (t, k) => (k === 'gain' || k === 'frequency' || k === 'Q' ? param : k === 'connect' ? () => node() : () => {}), set: () => true });
  const param = new Proxy({}, { get: () => () => {}, set: () => true });
  let made = 0;
  global.window = { AudioContext: function () { return { state: 'running', currentTime: 0, sampleRate: 8000, destination: {}, createGain: () => { made++; return node(); }, createOscillator: () => { made++; return node(); }, createBiquadFilter: () => { made++; return node(); }, createDynamicsCompressor: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(12000) }), createBufferSource: () => { made++; return node(); } }; } };
  try {
    S.setOn(true);
    for (const n of S.NAMES) assert.doesNotThrow(() => S.play(n, 0.5), n);
    assert.ok(made > 100, `sounds were built: ${made}`);
    S.setOn(false);
    const before = made;
    S.play('laugh');
    assert.strictEqual(made, before, 'off means silent');
    assert.strictEqual(S.isOn(), false);
  } finally { delete global.window; }
});

test('rivalry screens: the daily course, the standings, a throw to watch, and the closest to the pin', async () => {
  const P = await import('../public/js/gamepanels.js');
  const plan = { day: '2026-10-13', holes: [{ id: 1, name: 'Fairway Opener', par: 4 }, { id: 5, name: 'Water Carry', par: 3 }] };
  const signedOut = P.dailyHtml({ plan, data: null, signedIn: false, loading: false, msg: '', closesIn: 3 * 3600000 + 5 * 60000 });
  assert.match(signedOut, /Daily course/);
  assert.match(signedOut, /data-daily-play/);
  assert.match(signedOut, /data-signin/, 'sign in to post');
  assert.match(signedOut, /3h 05m/);
  assert.match(signedOut, /Fairway Opener/);
  const data = { board: { entries: 2, top: [{ rank: 1, name: 'Ben <b>', total: 30, par: 33, you: false }, { rank: 2, name: 'Ana', total: 34, par: 33, you: true }], you: { rank: 2, total: 34, par: 33 } } };
  const signedIn = P.dailyHtml({ plan, data, signedIn: true, loading: false, msg: '', closesIn: 0 });
  assert.match(signedIn, /Your score today: <b>34<\/b> \(\+1\), <b>2<\/b> of 2/);
  assert.match(signedIn, /Ben &lt;b&gt;/, 'names are escaped');
  assert.match(signedIn, /Play it again/);
  assert.match(signedIn, /data-standings/);
  assert.doesNotMatch(signedIn, /data-signin/);
  const s = P.standingsHtml({ data: { month: '2026-10', table: [{ rank: 1, name: 'Ana', points: 7, wins: 2, ties: 1, played: 4, perHole: -0.2, you: true }] }, loading: false, msg: '' });
  assert.match(s, /October 2026/);
  assert.match(s, /2W 1T 1L/);
  assert.match(P.standingsHtml({ data: { month: '2026-10', table: [] }, loading: false, msg: '' }), /No finished matches/);
  assert.strictEqual(P.highlightLabel({ kind: 'basket', putt: false, feet: 311.4 }, 'The Gate'), 'a hole in one from 311 ft on The Gate');
  assert.strictEqual(P.highlightLabel({ kind: 'basket', putt: true, made: true, dist: 38.2 }), 'a 38 ft putt');
  assert.strictEqual(P.highlightLabel({ kind: 'landed', putt: false, feet: 402 }, 'Prairie'), 'a 402 ft drive on Prairie');
  const names = { a: 'Ana', b: 'Ben', c: 'Cal' };
  assert.deepStrictEqual(P.closestToPin([{ uid: 'a', kp: 22.5 }, { uid: 'b', kp: 9.1 }, { uid: 'c', kp: null }], (u) => names[u]), { uid: 'b', name: 'Ben', feet: 9.1 });
  assert.strictEqual(P.closestToPin([{ uid: 'a', kp: 9.1 }, { uid: 'b', kp: 9.12 }], (u) => names[u]), null, 'a dead heat is nobody\'s');
  assert.strictEqual(P.closestToPin([{ uid: 'a', kp: null }], (u) => names[u]), null);
  assert.strictEqual(P.countdown(59 * 60000), '59m');
});

test('her bets: three kinds, each with a price, and a clear rule for who won', async () => {
  const T = await import('../public/js/trash.js');
  for (const k of Object.keys(T.BETS)) {
    const b = T.BETS[k];
    assert.ok(b.win > 0 && b.lose > 0 && b.text && b.offer.length >= 2, k);
    assert.ok(T.betOffer(k, () => 0.4).length > 10);
  }
  assert.ok(T.BETS.birdie.win > T.BETS.par.win && T.BETS.par.win > T.BETS.bogey.win, 'the harder the bet, the better the pay');
  assert.ok(T.BETS.bogey.lose > T.BETS.par.lose && T.BETS.par.lose > T.BETS.birdie.lose, 'and the cheaper the loss');
  const kinds = new Set();
  for (let i = 0; i < 100; i++) kinds.add(T.betKind(4, () => i / 100));
  assert.strictEqual(kinds.size, 3);
  assert.strictEqual(T.betWon('par', 4, 4), true);
  assert.strictEqual(T.betWon('par', 5, 4), false);
  assert.strictEqual(T.betWon('bogey', 5, 4), true);
  assert.strictEqual(T.betWon('bogey', 6, 4), false);
  assert.strictEqual(T.betWon('birdie', 3, 4), true);
  assert.strictEqual(T.betWon('birdie', 4, 4), false);
  assert.strictEqual(T.betWon('par', 3, 4, false), false, 'a hole not holed out never wins');
  for (const w of ['taken', 'declined', 'won', 'lost']) assert.ok(T.betRemark(w, () => 0.2).length > 5, w);
});

test('trophies: goals, skins you can wear or buy, and how worn in your discs are', async () => {
  const P = await import('../public/js/gamepanels.js');
  const R = await import('../public/js/progress.js');
  const game = R.emptyGame();
  game.stats.throws = 40; game.stats.discs[7] = 80; game.stats.discs[9] = 3; game.unlocked = ['ace']; game.owned = ['classic', 'gold']; game.skin = 'gold';
  const html = P.trophiesHtml({ game, bucks: 17, goals: R.ACHIEVEMENTS, skins: R.SKINS, discName: (id) => `Disc <${id}>`, breakIn: R.BREAK_IN_THROWS, msg: 'Nice.' });
  assert.match(html, /✓ Hole in one/);
  assert.match(html, /Gold/);
  assert.match(html, /<b>worn<\/b>/);
  assert.match(html, /data-skin="classic">Wear/);
  assert.match(html, /data-skin="neon">Buy 15</, 'affordable with 17 bucks');
  assert.match(html, /data-skin="leopard"[^>]*disabled>Buy 30/, 'not affordable with 17');
  assert.match(html, /Disc &lt;7&gt;/, 'names are escaped');
  assert.match(html, /50%/, '80 throws of 160');
  assert.match(html, /Nice\./);
  assert.match(P.trophiesHtml({ game: R.emptyGame(), bucks: 0, goals: R.ACHIEVEMENTS, skins: R.SKINS, discName: String, breakIn: 160 }), /No throws yet/);
});
