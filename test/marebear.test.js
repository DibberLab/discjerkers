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
