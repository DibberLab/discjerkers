'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = async () => ({ F: await import('../public/js/puttfx.js'), G: await import('../public/js/gamecore.js'), C: await import('../public/js/course.js'), K: await import('../public/js/cam3d.js') });
const PUTTER = { id: 2, speed: 3, glide: 3, turn: 0, fade: 1 };
const DRIVER = { id: 1, speed: 12, glide: 5, turn: -1, fade: 3 };

async function field(extra = {}) {
  const { C } = await load();
  return C.makeHole({ id: 9, name: 'Test', par: 4, fairway: [[0, 0, 60], [0, 600, 60]], basket: { x: 0, y: 40 }, wind: { mph: 0, from: 0 }, bounds: { minX: -300, maxX: 300, minY: -50, maxY: 300 }, ...extra });
}

test('a putt is a swish, a rattle, a rim-out, a miss or a nasty roll, depending on where the dot was and the dice', async () => {
  const { G } = await load();
  const hole = await field();
  const lie = { x: 0, y: 20 }; // 20 ft out
  const radius = G.puttRadius(20, PUTTER);
  const at = (frac) => G.resolvePutt(hole, lie, PUTTER, { x: radius * frac, y: 0 });
  assert.strictEqual(at(0.1).finish, 'swish', 'dead center is a clean swish');
  assert.strictEqual(at(0.9).finish, 'rattle', 'near the edge it rattles in');
  assert.ok(at(0.9).made && at(0.1).made);
  const rim = at(1.25);
  assert.ok(!rim.made && rim.rim && rim.finish === 'rim', 'just outside: it hits the cage and spits out');
  const far = at(3);
  assert.ok(!far.made && !far.rim && far.finish === 'miss', 'well outside: a plain miss');
  assert.strictEqual(G.resolvePutt(hole, { x: 0, y: 39 }, PUTTER, { x: 0.99, y: 0 }).finish, 'tapin', 'a tap-in is a tap-in');

  // the dice: by default never, and a low one makes a miss run away
  assert.ok(!far.nasty);
  const nasty = G.resolvePutt(hole, lie, PUTTER, { x: radius * 3, y: 0 }, 0);
  assert.ok(nasty.nasty && nasty.finish === 'nasty', 'a low roll on a miss is a nasty roll');
  assert.ok(nasty.miss > far.miss * 1.8, `it runs: ${far.miss.toFixed(1)} ft became ${nasty.miss.toFixed(1)}`);
  assert.ok(G.distance(nasty.lie, hole.basket) > G.distance(far.lie, hole.basket) * 1.8, 'and it ends up much farther away');
  assert.ok(!G.resolvePutt(hole, lie, PUTTER, { x: radius * 3, y: 0 }, 0.99).nasty, 'a high roll does not');
  assert.ok(G.resolvePutt(hole, lie, PUTTER, { x: radius * 0.2, y: 0 }, 0).made, 'a putt that goes in does not roll away');
  const rimNasty = G.resolvePutt(hole, lie, PUTTER, { x: radius * 1.2, y: 0 }, 0);
  assert.ok(rimNasty.rim && rimNasty.nasty, 'a lip-out can run away too');

  // how often: more from far out, for a fast disc, and for a lip-out
  assert.ok(G.nastyChance(45, PUTTER, false) > G.nastyChance(10, PUTTER, false));
  assert.ok(G.nastyChance(20, DRIVER, false) > G.nastyChance(20, PUTTER, false));
  assert.ok(G.nastyChance(20, PUTTER, true) > G.nastyChance(20, PUTTER, false));
  assert.ok(G.nastyChance(50, DRIVER, true) <= 0.3 && G.nastyChance(1, PUTTER, false) > 0.015 && G.nastyChance(1, PUTTER, false) < G.nastyChance(30, PUTTER, false), 'sometimes, not always, and rarely from close');
});

test('a nasty roll into the water costs a stroke on top', async () => {
  const { G } = await load();
  const hole = await field({ water: [[[-80, 55], [80, 55], [80, 140], [-80, 140]]] }); // a pond behind the basket
  const lie = { x: 0, y: 10 }; // 30 ft out
  const long = G.resolvePutt(hole, lie, PUTTER, { x: 0, y: 0.5 }, 0); // long and nasty
  assert.ok(long.nasty && long.strokes === 2, `the stroke counts: ${long.strokes}`);
  assert.ok(G.distance(long.lie, hole.basket) < 5, 'and it is put back by the basket');
  assert.strictEqual(G.resolvePutt(hole, lie, PUTTER, { x: 0, y: 0.5 }, 1).strokes, 1, 'without the roll, a plain putt is one stroke');
});

test('the film of a putt: continuous, the right length, and it ends where the rules say', async () => {
  const { F, G } = await load();
  const hole = await field();
  const from = { x: 3, y: 12 };
  const basket = hole.basket;
  const radius = G.puttRadius(G.distance(from, basket), PUTTER);
  const cases = {
    swish: G.resolvePutt(hole, from, PUTTER, { x: 0, y: 0 }),
    rattle: G.resolvePutt(hole, from, PUTTER, { x: radius * 0.9, y: 0 }),
    rim: G.resolvePutt(hole, from, PUTTER, { x: radius * 1.25, y: 0 }),
    miss: G.resolvePutt(hole, from, PUTTER, { x: radius * 3, y: 0 }),
    nasty: G.resolvePutt(hole, from, PUTTER, { x: radius * 3, y: 0 }, 0),
    rimNasty: G.resolvePutt(hole, from, PUTTER, { x: radius * 1.25, y: 0 }, 0),
  };
  for (const [name, result] of Object.entries(cases)) {
    const s = F.puttScript({ from, basket, lie: result.lie, result });
    assert.ok(s.total > 800 && s.total < 7000, `${name}: ${Math.round(s.total)} ms of motion`);
    assert.ok(s.tail >= 500, `${name}: a reaction after`);
    const start = s.at(0);
    assert.ok(Math.hypot(start.x - from.x, start.y - from.y) < 0.01 && Math.abs(start.h - 3.2) < 0.3, `${name}: it starts in the hand`);
    let prev = start;
    let worst = 0;
    for (let ms = 16; ms <= s.total; ms += 16) { const p = s.at(ms); worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y, p.h - prev.h)); prev = p; assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.h) && p.h >= -0.01, `${name}: sane at ${ms}`); }
    assert.ok(worst < 2.2, `${name}: no jumps (${worst.toFixed(2)} ft in a frame)`);
    const end = s.at(s.total + 5000);
    if (result.made) assert.ok(Math.hypot(end.x - basket.x, end.y - basket.y) < 0.3 && end.h > 1.8 && end.h < 2.4, `${name}: ends on the floor of the tray, about two feet up (${end.h.toFixed(2)})`);
    else assert.ok(Math.hypot(end.x - result.lie.x, end.y - result.lie.y) < 0.3 && end.h < 0.2, `${name}: ends on the grass where the lie is`);
  }
  // a rim-out really goes round the rim: close to the ring, at the height of the cage, for a good while
  const r = cases.rim;
  const rs = F.puttScript({ from, basket, lie: r.lie, result: r });
  const lap = [];
  for (let ms = rs.marks.rimAt + 100; ms < rs.marks.spitAt - 100; ms += 50) lap.push(rs.at(ms));
  assert.ok(lap.length > 20, 'a long lap');
  assert.ok(lap.every((p) => Math.abs(Math.hypot(p.x - basket.x, p.y - basket.y) - F.LIP_R) < 0.25 && p.h > 2.55 && p.h < 3.4), 'round the lip of the tray');
  assert.ok(rs.marks.spitAt - rs.marks.rimAt > 1200, 'slowly');
  // a nasty roll has a run along the ground
  const ns = F.puttScript({ from, basket, lie: cases.nasty.lie, result: cases.nasty });
  assert.ok(ns.marks.rollAt !== undefined && ns.at(ns.marks.rollAt + 100).phase === 'roll' && ns.at(ns.marks.rollAt + 100).h === 0);
  // the made ones drop in after the flight
  assert.ok(F.puttScript({ from, basket, lie: basket, result: cases.swish }).marks.dropAt > 800);
});

test('the celebration, the heartbreak and the roll all draw, at every moment of every finish, without a hitch', async () => {
  const { F, G, K } = await load();
  const hole = await field();
  const from = { x: 3, y: 12 };
  const radius = G.puttRadius(G.distance(from, hole.basket), PUTTER);
  let calls = 0;
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => grad : k === 'measureText' ? () => ({ width: 10 }) : () => { calls++; }), set: () => true });
  const cam = K.newCamera(2, -1, 5.2, 0.1, -0.1);
  const view = K.viewOf(390, 780, cam, 280);
  for (const shot of [[0, 0, 1], [radius * 0.9, 0, 1], [radius * 1.25, 0, 1], [radius * 3, 0, 1], [radius * 3, 0, 0], [radius * 1.25, 0, 0]]) {
    const result = G.resolvePutt(hole, from, PUTTER, { x: shot[0], y: shot[1] }, shot[2]);
    const s = F.puttScript({ from, basket: hole.basket, lie: result.lie, result });
    let fov = 0;
    for (let ms = 0; ms <= s.total + s.tail; ms += 40) {
      assert.doesNotThrow(() => { fov = F.drawPuttFx(ctx, { cam, view, hole, W: 390, H: 780 }, s, ms, result).fov; });
      assert.ok(Math.abs(fov) < 0.3);
    }
  }
  assert.ok(calls > 500, `something was drawn: ${calls}`);
});

test('the swipe: a true one leaves it to the radar, and one off in aim or power is always a miss, in the direction it was off', async () => {
  const { G } = await load();
  const hole = await field();
  const lie = { x: 0, y: 15 }; // 25 ft out
  const dist = 25;
  const tol = G.swipeTolerance(dist);
  assert.ok(G.swipeTolerance(10).aim > G.swipeTolerance(50).aim && G.swipeTolerance(10).power > G.swipeTolerance(50).power, 'the farther out, the tighter');
  assert.ok(tol.aim >= 3 && tol.aim <= 10 && tol.power >= 0.1 && tol.power <= 0.22);
  const dead = { x: 0, y: 0 }; // a perfect radar
  const go = (swipe, shot = dead, roll = 1) => G.resolvePutt(hole, lie, PUTTER, shot, roll, swipe);

  // true swipes: made, same as no swipe at all
  for (const swipe of [{ aim: 0, power: 1 }, { aim: tol.aim * 0.9, power: 1 }, { aim: -tol.aim * 0.9, power: 1 - tol.power * 0.9 }, { aim: 0, power: 1 + tol.power * 0.95 }]) {
    assert.ok(go(swipe).made, `a true swipe goes in: ${JSON.stringify(swipe)}`);
  }
  assert.ok(go(null).made && G.resolvePutt(hole, lie, PUTTER, dead).made, 'no swipe counts as true (older pages)');
  // a bad radar still misses with a perfect swipe
  assert.ok(!go({ aim: 0, power: 1 }, { x: 0.9, y: 0 }).made);

  // off in power: a miss, short or long
  const soft = go({ aim: 0, power: 0.7 });
  assert.ok(!soft.made && soft.why === 'weak', 'too soft');
  assert.ok(soft.lie.y < hole.basket.y && G.distance(soft.lie, hole.basket) > 2, 'and it comes up short of the basket');
  const hard = go({ aim: 0, power: 1.45 });
  assert.ok(!hard.made && hard.why === 'strong', 'too hard');
  assert.ok(hard.lie.y > hole.basket.y, 'and it goes long');
  // off in aim: a miss, left or right
  const right = go({ aim: 9, power: 1 });
  const left = go({ aim: -9, power: 1 });
  assert.ok(!right.made && right.why === 'right' && right.lie.x > hole.basket.x, 'pushed right');
  assert.ok(!left.made && left.why === 'left' && left.lie.x < hole.basket.x, 'pulled left');
  // a swipe just off is a near miss (it lips out); one way off is a clean miss
  assert.ok(go({ aim: tol.aim * 1.15, power: 1 }).rim, 'just off: it lips out');
  const wild = go({ aim: tol.aim * 4, power: 1 });
  assert.ok(!wild.rim && wild.finish === 'miss', 'way off: a plain miss');
  // hit too hard it runs away more often
  assert.ok(go({ aim: 0, power: 1.5 }, dead, 0.2).nasty, 'a hard putt takes the nasty roll on a roll that a soft one would not');
  assert.ok(!go({ aim: 0, power: 0.6 }, dead, 0.2).nasty);
  // a tap-in needs no swipe
  assert.ok(G.resolvePutt(hole, { x: 0, y: 39 }, PUTTER, dead, 1, { aim: 40, power: 0.1 }).made);

  // what a server accepts
  assert.deepStrictEqual(G.sanitizeSwipe({ aim: 3.5, power: 0.98 }), { aim: 3.5, power: 0.98 });
  assert.deepStrictEqual(G.sanitizeSwipe({ aim: 500, power: 99 }), { aim: 60, power: 2.5 });
  for (const bad of [null, 'x', {}, { aim: 'a', power: 1 }, { aim: 1 }, { aim: NaN, power: 1 }]) assert.strictEqual(G.sanitizeSwipe(bad), null, JSON.stringify(bad));
});
