'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = async () => ({ ...(await import('../public/js/gamecore.js')), ...(await import('../public/js/course.js')) });

const DRIVER = { id: 1, speed: 12, glide: 5, turn: -1, fade: 3 };
const PUTTER = { id: 2, speed: 3, glide: 3, turn: 0, fade: 1 };
const RIGHT = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
const CLEAN = { pf: 1, over: 0, o: 0, pure: false, sloppy: 0, grade: 'Good' };

// a bare field: a long fairway, nothing in the way, calm air
async function field(extra = {}) {
  const { makeHole } = await load();
  return makeHole({ id: 9, name: 'Test', par: 4, fairway: [[0, 0, 60], [0, 600, 60]], basket: { x: 0, y: 900 }, wind: { mph: 0, from: 0 }, ...extra });
}

test('the meter: the power zone, early and late, and how a throw is graded', async () => {
  const G = await load();
  const setup = G.meterSetup(56);
  assert.ok(setup.power.w > 0.04 && setup.release.w > 0.07);
  assert.ok(G.meterSetup(88).power.w < G.meterSetup(40).power.w, 'a harder arm has a narrower zone');
  assert.ok(G.meterSetup(88).power.period < G.meterSetup(40).power.period, '...and a faster marker');

  const z = setup.power;
  assert.strictEqual(G.readPower(z.c, z).pf, 1);
  assert.ok(G.readPower(z.c, z).inZone);
  assert.ok(G.readPower(0.4, z).pf < 0.8, 'a weak pull is a slow throw');
  assert.strictEqual(G.readPower(0, z).pf, 0.3);
  const over = G.readPower(1, z);
  assert.ok(over.over > 0.9 && over.pf === 1 && !over.inZone, 'overswinging keeps the power and loses the control');

  assert.ok(G.readRelease(0.05, setup.release.w).inZone);
  assert.ok(!G.readRelease(0.6, setup.release.w).inZone);
  assert.strictEqual(G.combine(G.readPower(z.c, z), G.readRelease(0, setup.release.w)).grade, 'Pure');
  assert.strictEqual(G.combine(G.readPower(z.c, z), G.readRelease(0.9, setup.release.w)).grade, 'Shank');
  assert.strictEqual(G.combine(G.readPower(0.5, z), G.readRelease(0, setup.release.w)).pure, false);

  // the markers sweep 0..1 and -1..1
  assert.strictEqual(G.powerAt(0, setup), 0);
  assert.ok(Math.abs(G.powerAt(setup.power.period / 2, setup) - 1) < 1e-9);
  assert.strictEqual(G.releaseAt(0, setup), -1);
});

test('wind is felt relative to where you throw', async () => {
  const G = await load();
  const hole = await field({ wind: { mph: 10, from: 270 } }); // from the west
  const north = G.windFor(hole, 0);
  assert.ok(Math.abs(north.head) < 1e-9 && Math.abs(north.cross - 10) < 1e-9, 'a west wind pushes a north throw to the right');
  const west = G.windFor(hole, 270);
  assert.ok(Math.abs(west.head - 10) < 1e-9, 'throwing into it is a headwind');
  assert.strictEqual(G.windFor({ ...hole, wind: { mph: 0, from: 0 } }, 33).mph, 0);
});

test('a throw goes where it is aimed, for about as far as the guide says, and the same every time', async () => {
  const G = await load();
  const M = await import('../public/js/flightmodel.js');
  const hole = await field();
  const a = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(a.kind, 'landed');
  const guide = M.carryRaw(DRIVER, { mph: 0, head: 0, cross: 0 }, RIGHT);
  assert.ok(Math.abs(a.plan.feet - guide) < 1e-6);
  assert.ok(a.pts.at(-1).y > guide * 0.8, 'it goes north');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }))));

  const east = G.resolveThrow(hole, DRIVER, RIGHT, 90, CLEAN, { x: 0, y: 0 });
  assert.ok(east.pts.at(-1).x > 200 && Math.abs(east.pts.at(-1).y) < 120, 'aim east and it goes east');
});

test('a late release pulls a right-hander left; an early one goes right; a weak pull is short', async () => {
  const G = await load();
  const hole = await field();
  const end = (ex) => G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...CLEAN, ...ex }, { x: 0, y: 0 }).end;
  const flat = end({});
  assert.ok(end({ o: 0.8, sloppy: 0.8 }).x < flat.x - 5, 'late: left');
  assert.ok(end({ o: -0.8, sloppy: 0.8 }).x > flat.x + 5, 'early: right');
  assert.ok(end({ pf: 0.5 }).y < flat.y * 0.7, 'weak: short');
  // a left-hander is the mirror
  const lefty = (ex) => G.resolveThrow(hole, DRIVER, { ...RIGHT, hand: 'left' }, 0, { ...CLEAN, ...ex }, { x: 0, y: 0 }).end;
  assert.ok(lefty({ o: 0.8, sloppy: 0.8 }).x > lefty({}).x + 5, 'late for a lefty: right');
});

test('trees stop a low throw and are cleared by a high one', async () => {
  const G = await load();
  const hole = await field();
  const open = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  const mid = open.pts[Math.floor(open.pts.length / 2)];

  const tall = await field({ trees: [{ x: mid.x, y: mid.y, r: 4, h: 200 }] });
  const hit = G.resolveThrow(tall, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(hit.kind, 'tree');
  assert.strictEqual(hit.strokes, 1);
  assert.ok(Math.hypot(hit.lie.x - mid.x, hit.lie.y - mid.y) < 14, 'it settles beside the tree');
  assert.ok(hit.lie.y < mid.y + 1, 'on the near side');

  const shrub = await field({ trees: [{ x: mid.x, y: mid.y, r: 4, h: 3 }] });
  assert.strictEqual(G.resolveThrow(shrub, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'landed', 'a shrub is flown over');

  const aside = await field({ trees: [{ x: mid.x + 30, y: mid.y, r: 4, h: 200 }] });
  assert.strictEqual(G.resolveThrow(aside, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'landed', 'a tree off the line is no problem');
});

test('a tree is never a trap: you play on from beside it, and the same trunk does not stop the next throw', async () => {
  const G = await load();
  const hole0 = await field();
  const open = G.resolveThrow(hole0, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  const mid = open.pts[Math.floor(open.pts.length / 2)];
  const tree = { x: mid.x, y: mid.y, r: 4.8, h: 200 };
  const hole = await field({ trees: [tree], basket: { x: 0, y: 1500 }, bounds: { minX: -300, maxX: 300, minY: -50, maxY: 1600 } });

  const hit = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(hit.kind, 'tree');
  // from where it dropped, the very same throw goes on past
  const again = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, hit.lie);
  assert.ok(!(again.kind === 'tree' && again.hit.tree === tree), 'not the same tree again');
  assert.ok(again.end.y > hit.lie.y + 100, 'and it is a real throw');
  // and when you are standing beside a tree, even a tree right in front of you is behind you
  const close = await field({ trees: [{ x: 0, y: 6, r: 4, h: 200 }] });
  assert.strictEqual(G.resolveThrow(close, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'landed');

  // three throws in a row from a bad spot always get somewhere
  let lie = { x: 0, y: 0 };
  let farthest = 0;
  for (let i = 0; i < 3; i++) {
    const r = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, lie);
    lie = r.lie;
    farthest = Math.max(farthest, lie.y);
  }
  assert.ok(farthest > tree.y + 40, `three throws and still behind the tree: ${farthest}`);
});

test('water is out of bounds: the throw and a stroke, and you throw again from where you were', async () => {
  const G = await load();
  const open = G.resolveThrow(await field(), DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  const e = open.end;
  const pond = await field({ water: [[[e.x - 30, e.y - 30], [e.x + 30, e.y - 30], [e.x + 30, e.y + 60], [e.x - 30, e.y + 60]]] });
  const wet = G.resolveThrow(pond, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(wet.kind, 'water');
  assert.strictEqual(wet.strokes, 2);
  assert.deepStrictEqual(wet.lie, { x: 0, y: 0 });
  assert.ok(wet.penalty);

  const far = await field({ bounds: { minX: -50, maxX: 50, minY: -50, maxY: e.y - 20 } });
  assert.strictEqual(G.resolveThrow(far, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'oob');
});

test('a disc that lands on the basket holes out', async () => {
  const G = await load();
  const e = G.resolveThrow(await field(), DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).end;
  const hole = await field({ basket: { x: e.x, y: e.y } });
  const r = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(r.kind, 'basket');
  assert.strictEqual(r.strokes, 1);
});

test('putting: given inside three feet, and the zone narrows with distance and with a faster disc', async () => {
  const G = await load();
  const hole = await field({ basket: { x: 0, y: 40 } });
  assert.ok(G.puttZone(10, PUTTER) > G.puttZone(30, PUTTER));
  assert.ok(G.puttZone(20, PUTTER) > G.puttZone(20, DRIVER));
  assert.ok(G.puttZone(500, DRIVER) >= 0.04, 'never impossible');

  const near = G.resolvePutt(hole, { x: 0, y: 38 }, PUTTER, 0.95);
  assert.ok(near.made && near.gimme, 'a tap-in is a tap-in even with a bad needle');

  const lie = { x: 0, y: 20 };
  const zone = G.puttZone(20, PUTTER);
  assert.ok(G.resolvePutt(hole, lie, PUTTER, zone * 0.9).made);
  const miss = G.resolvePutt(hole, lie, PUTTER, Math.min(1, zone + 0.2));
  assert.ok(!miss.made && miss.kind === 'landed');
  const d = G.distance(miss.lie, hole.basket);
  assert.ok(d >= 3 && d <= 14.5, `a miss leaves a short comebacker: ${d}`);
  assert.ok(G.resolvePutt(hole, lie, PUTTER, -(zone + 0.2)).lie.x !== miss.lie.x, 'the other side of the needle misses the other way');
});

test('scoring, and Marebear: she comes once, at a triple bogey, for the disc you just threw', async () => {
  const G = await load();
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => G.scoreName(s, 4)), ['Ace!', 'Eagle', 'Birdie', 'Par', 'Bogey', 'Double bogey', 'Triple bogey', '+4', '+5']);
  assert.strictEqual(G.scoreName(2, 3), 'Birdie');
  assert.ok(!G.atTripleBogey(6, 4) && G.atTripleBogey(7, 4));

  const hole = await field();
  const round = G.newRound(hole);
  const landed = (id) => ({ kind: 'landed', strokes: 1, lie: { x: 5, y: 50 }, end: { x: 5, y: 50 }, plan: { feet: 100 } });
  const out = [];
  for (let i = 1; i <= 7; i++) out.push(G.applyResult(round, { id: i }, landed(i)));
  assert.deepStrictEqual(out.slice(0, 6).map((o) => !!o.bear), [false, false, false, false, false, false], 'not before the triple bogey');
  assert.strictEqual(out[6].bear.discId, 7, 'the seventh throw on a par 4 is the triple');
  assert.deepStrictEqual(round.eaten, [7]);
  assert.ok(!G.applyResult(round, { id: 8 }, landed(8)).bear, 'once per hole');
  assert.strictEqual(round.strokes, 8);

  // an out-of-bounds throw costs two strokes and can be the one that gets her
  const wet = G.newRound(hole);
  for (let i = 1; i <= 4; i++) G.applyResult(wet, { id: i }, landed(i));
  const six = G.applyResult(wet, { id: 5 }, { kind: 'water', strokes: 2, lie: { x: 0, y: 50 }, end: { x: 40, y: 80 }, plan: { feet: 150 } });
  assert.ok(!six.bear && wet.strokes === 6, 'a double bogey is not enough');
  const seven = G.applyResult(wet, { id: 6 }, { kind: 'water', strokes: 2, lie: { x: 0, y: 50 }, end: { x: 40, y: 80 }, plan: { feet: 150 } });
  assert.ok(seven.bear && seven.bear.discId === 6 && wet.strokes === 8);

  // holing out ends the hole and she never shows
  const good = G.newRound(hole);
  for (let i = 1; i <= 5; i++) G.applyResult(good, { id: i }, landed(i));
  const done = G.applyResult(good, { id: 6 }, { kind: 'basket', strokes: 1, lie: hole.basket, dist: 5 });
  assert.ok(good.done && good.holed && !done.bear && good.eaten.length === 0);
});

test('hole one: it can be played, it has teeth, and nothing goes missing', async () => {
  const G = await load();
  const hole = G.HOLES[0];
  assert.strictEqual(hole.par, 4);
  assert.strictEqual(G.surfaceAt(hole, 0, 0), 'tee');
  assert.strictEqual(G.surfaceAt(hole, 0, 100), 'fairway');
  assert.strictEqual(G.surfaceAt(hole, -100, 100), 'rough');
  assert.strictEqual(G.surfaceAt(hole, 150, 320), 'water');
  assert.strictEqual(G.surfaceAt(hole, 0, 600), 'oob');

  const kinds = new Set();
  for (let aim = -50; aim <= 50; aim += 2) {
    for (const mph of [50, 62, 74]) {
      const r = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, aim, CLEAN, hole.tee);
      assert.ok(Number.isFinite(r.end.x) && Number.isFinite(r.end.y) && Number.isFinite(r.plan.feet));
      kinds.add(r.kind);
    }
  }
  for (const k of ['landed', 'tree', 'water']) assert.ok(kinds.has(k), `a drive on this hole can end up: ${k} (saw ${[...kinds]})`);
});

test('hole one can be solved: a careful player with a clean meter makes par or better', async () => {
  const G = await load();
  const hole = G.HOLES[0];
  const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
  let lie = { ...hole.tee };
  let strokes = 0;

  // the drive: the best landing on the grass that is not in trouble, as close to the basket as it can get
  let best = null;
  for (let aim = -25; aim <= 25; aim += 1) {
    for (const angle of [-3, -2, -1, 0, 1, 2, 3]) {
      for (let mph = 44; mph <= 80; mph += 4) {
        const r = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph, angle }, aim, CLEAN, lie);
        if (r.kind !== 'landed') continue;
        const d = G.distance(r.lie, hole.basket);
        if (!best || d < best.d) best = { d, r, aim, angle, mph };
      }
    }
  }
  assert.ok(best && best.d < 150, `a drive can get close: ${best && Math.round(best.d)} ft`);
  strokes += 1;
  lie = best.r.lie;

  // the approach, if it is not a putt already
  if (G.distance(lie, hole.basket) > G.PUTT_RANGE) {
    const base = G.headingTo(lie, hole.basket);
    let next = null;
    for (let off = -15; off <= 15; off += 1) {
      for (let mph = 10; mph <= 60; mph += 2) {
        const r = G.resolveThrow(hole, MID, { ...RIGHT, mph, angle: 0 }, base + off, CLEAN, lie);
        if (r.kind !== 'landed' && r.kind !== 'basket') continue;
        const d = G.distance(r.lie, hole.basket);
        if (!next || d < next.d) next = { d, r };
      }
    }
    assert.ok(next && next.d <= G.PUTT_RANGE, `an approach can reach putting range: ${next && Math.round(next.d)} ft`);
    strokes += 1;
    lie = next.r.lie;
  }
  if (G.distance(lie, hole.basket) > 3) {
    const made = G.resolvePutt(hole, lie, { id: 4, speed: 3 }, 0);
    assert.ok(made.made, 'a centered needle holes it');
    strokes += 1;
  }
  assert.ok(strokes <= hole.par, `par or better with a clean meter: ${strokes}`);
});

test('hole one: after hitting a tree, no throw from where it dropped hits that same tree again', async () => {
  const G = await load();
  const hole = G.HOLES[0];
  const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
  let checked = 0;
  for (let aim = -50; aim <= 50; aim += 2) {
    for (const mph of [50, 62, 74]) {
      const first = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, aim, CLEAN, hole.tee);
      if (first.kind !== 'tree') continue;
      for (const disc of [DRIVER, MID]) {
        for (let aim2 = -40; aim2 <= 40; aim2 += 4) {
          for (const mph2 of [20, 40, 62]) {
            const second = G.resolveThrow(hole, disc, { ...RIGHT, mph: mph2 }, G.headingTo(first.lie, hole.basket) + aim2, CLEAN, first.lie);
            checked++;
            assert.ok(!(second.kind === 'tree' && second.hit.tree === first.hit.tree), `stuck behind the same tree (aim ${aim}, then ${aim2})`);
          }
        }
      }
    }
  }
  assert.ok(checked > 100, `the sweep actually tested things: ${checked}`);
});
