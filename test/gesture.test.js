'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../public/js/gesture.js');
const smooth = (u) => u * u * (3 - 2 * u);
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };

// a swing at 8 ms per sample: down for downMs, (stalling), then back up for upMs, with some noise
function swing({ downMs, upMs, depth = 150, jx = 0, jy = 0, stall = 0, wob = 0 }) {
  const pts = [];
  let t = 0;
  const seg = (ms, f) => { for (let k = 0; k <= ms / 8; k++) { const u = k / (ms / 8); const p = f(u); pts.push({ x: 200 + p.x + rnd() * jx, y: 300 + p.y + rnd() * jy, t }); t += 8; } };
  seg(downMs, (u) => ({ x: Math.sin(u * 9) * wob, y: depth * smooth(u) }));
  t += stall;
  seg(upMs, (u) => ({ x: Math.sin(u * 11) * wob, y: depth * (1 - smooth(u)) }));
  return pts;
}

test('the speed of a swing: a quicker stroke is faster, and the same stroke at the same pace measures the same', async () => {
  const G = await load();
  const slow = G.peakSpeed(swing({ downMs: 600, upMs: 1200 }), 0);
  const natural = G.peakSpeed(swing({ downMs: 450, upMs: 500 }), 0);
  const quick = G.peakSpeed(swing({ downMs: 300, upMs: 250 }), 0);
  assert.ok(slow < natural && natural < quick, `${slow} < ${natural} < ${quick}`);
  assert.strictEqual(G.peakSpeed([], 0), 0);
  assert.strictEqual(G.peakSpeed([{ x: 0, y: 0, t: 0 }], 0), 0);
  // jitter in the sampling (points a few ms apart) does not look like speed: it is measured over 60 ms or more
  const steady = G.peakSpeed(swing({ downMs: 400, upMs: 500 }), 0);
  const noisy = G.peakSpeed(swing({ downMs: 400, upMs: 500, jy: 3 }), 0);
  assert.ok(Math.abs(noisy - steady) / steady < 0.25, `a little noise changes little: ${steady} vs ${noisy}`);
});

test('the smoothness of a swing: a clean one is smooth, and a stall, a wobble or a stutter each make it rough', async () => {
  const G = await load();
  const q = (o) => G.gestureQuality(swing(o), 18);
  const clean = q({ downMs: 350, upMs: 450 });
  assert.ok(clean.rough < 0.05, `a clean swing: ${clean.rough}`);
  assert.ok(q({ downMs: 350, upMs: 450, jy: 4 }).rough < 0.1, 'a touch of hand noise is free');
  assert.ok(q({ downMs: 350, upMs: 450, stall: 450 }).rough > 0.2, 'a stall at the bottom is rough');
  assert.ok(q({ downMs: 350, upMs: 450, wob: 22 }).rough > 0.35, 'a wobbly stroke is rough');
  assert.ok(q({ downMs: 350, upMs: 450, jy: 12 }).rough > 0.3, 'a stuttering stroke is rough');
  assert.ok(q({ downMs: 350, upMs: 450, jx: 14, jy: 14 }).rough > 0.3, 'jerking about is rough');
  // hesitating part way up, or a start-stop way up, is rough too
  const stages = (list) => { const pts = []; let t = 0; let y = 300; for (const [ms, dy] of list) { const y0 = y; for (let k = 0; k <= ms / 8; k++) { pts.push({ x: 200, y: y0 + dy * smooth(k / (ms / 8)), t }); t += 8; } y = y0 + dy; } return pts; };
  assert.ok(G.gestureQuality(stages([[350, 150], [200, -70], [200, 0], [200, -80]]), 18).rough > 0.3, 'a hesitation on the way up');
  assert.ok(G.gestureQuality(stages([[350, 150], [150, -50], [150, 10], [150, -50], [150, 10], [150, -60]]), 18).rough > 0.4, 'a start-stop way up');
  assert.ok(G.gestureQuality(stages([[350, 150], [450, -150]]), 18).rough < 0.05, 'one rise and fall is clean');
  for (const o of [{ downMs: 300, upMs: 200 }, { downMs: 600, upMs: 1200, wob: 5 }]) {
    const r = q(o).rough;
    assert.ok(r >= 0 && r <= 1, `always 0 to 1: ${r}`);
  }
  // too little to judge: a middling answer, not a crash
  assert.ok(G.gestureQuality([], 18).rough > 0 && G.gestureQuality([{ x: 0, y: 0, t: 0 }], 18).rough < 1);
  // which way it bowed
  const bowRight = swing({ downMs: 350, upMs: 450 }).map((p, i, a) => ({ ...p, x: p.x + (i > a.length / 2 ? 14 * Math.sin(((i - a.length / 2) / (a.length / 2)) * Math.PI) : 0) }));
  const bowLeft = bowRight.map((p) => ({ ...p, x: 400 - p.x }));
  assert.notStrictEqual(G.gestureQuality(bowRight, 18).bias, G.gestureQuality(bowLeft, 18).bias, 'the sign says which way');
});
