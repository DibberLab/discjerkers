'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const model = () => import('../public/js/flightmodel.js');

// 400 throws captured from the flight guide before its model moved into flightmodel.js: the guide and the game must
// keep agreeing with what the guide has always drawn.
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'flightmodel-golden.json'), 'utf8'));

test('the shared model reproduces what the flight guide drew: carry and the curve, for 400 throws', async () => {
  const M = await model();
  const FP = { x0: 200, y0: 392, k: 0.74, left: 52, right: 352 }; // the guide's chart
  const clampX = (x) => M.clamp(x, FP.left + 10, FP.right - 10);
  for (const [i, c] of golden.entries()) {
    const carry = M.carryFeet(c.d, c.wind, c.t, 500);
    assert.strictEqual(carry, c.carry, `carry, case ${i}`);
    assert.strictEqual(M.estFeet(c.d, c.t), c.est, `est, case ${i}`);
    const len = carry * FP.k;
    const { lat } = M.flightCurve(c.d, c.wind, c.t, carry);
    const p1 = [FP.x0 + lat[0] * FP.k, FP.y0 - len * 0.32];
    const p2 = [clampX(FP.x0 + lat[1] * FP.k), FP.y0 - len * 0.72];
    const p3 = [clampX(FP.x0 + lat[2] * FP.k), FP.y0 - len];
    for (const [got, want, name] of [[p1, c.p.p1, 'p1'], [p2, c.p.p2, 'p2'], [p3, c.p.p3, 'p3']]) {
      assert.ok(Math.abs(got[0] - want[0]) < 1e-9 && Math.abs(got[1] - want[1]) < 1e-9, `${name}, case ${i}: ${got} vs ${want}`);
    }
  }
});

test('a release angle can be nudged by degrees without touching the steps, and arm speed can go below 30', async () => {
  const M = await model();
  const d = { speed: 12, glide: 5, turn: -1, fade: 3 };
  const t = { hand: 'right', style: 'backhand', mph: 56, spin: null, angle: 0 };
  const wind = { mph: 0, head: 0, cross: 0 };
  assert.strictEqual(M.angleDeg(t), 0);
  assert.strictEqual(M.angleDeg({ ...t, angle: 2, angleExtra: 3 }), 13);
  const flat = M.flightCurve(d, wind, t).lat[2];
  const hyzer = M.flightCurve(d, wind, { ...t, angleExtra: 10 }).lat[2];
  assert.ok(hyzer < flat, 'a hyzer ends farther toward the fade side (left for a right-hand backhand)');
  const soft = M.carryRaw(d, wind, { ...t, mph: 16 });
  const strong = M.carryRaw(d, wind, { ...t, mph: 56 });
  assert.ok(soft > 10 && soft < strong / 2, `a finesse throw is short: ${soft} vs ${strong}`);
  assert.deepStrictEqual(M.armAt(30), { cap: 4, power: 0.62 }); // the guide's lowest setting is untouched
});
