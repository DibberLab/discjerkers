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

test('putting: given inside three feet, and the target narrows with distance and with a faster disc', async () => {
  const G = await load();
  const hole = await field({ basket: { x: 0, y: 40 } });
  assert.ok(G.puttZone(10, PUTTER) > G.puttZone(30, PUTTER));
  assert.ok(G.puttZone(20, PUTTER) > G.puttZone(20, DRIVER));
  assert.ok(G.puttZone(500, DRIVER) >= 0.04, 'never impossible');
  assert.ok(G.puttRadius(10, PUTTER) > G.puttRadius(40, PUTTER));
  assert.ok(G.puttRadius(40, DRIVER) >= 0.07, 'a target you can still see');
  assert.ok(G.puttSpeed(45) > G.puttSpeed(5), 'the dot moves faster on a long putt');

  const near = G.resolvePutt(hole, { x: 0, y: 38 }, PUTTER, { x: 0.9, y: 0.4 });
  assert.ok(near.made && near.gimme, 'a tap-in is a tap-in even with a bad tap');

  const lie = { x: 0, y: 20 };
  const radius = G.puttRadius(20, PUTTER);
  assert.ok(G.resolvePutt(hole, lie, PUTTER, { x: radius * 0.6, y: -radius * 0.6 }).made, 'inside the target holes it, from any direction');
  assert.ok(G.resolvePutt(hole, lie, PUTTER, { x: 0, y: radius * 0.95 }).made);
  const right = G.resolvePutt(hole, lie, PUTTER, { x: 0.7, y: 0 });
  const left = G.resolvePutt(hole, lie, PUTTER, { x: -0.7, y: 0 });
  const long = G.resolvePutt(hole, lie, PUTTER, { x: 0, y: 0.7 });
  const short = G.resolvePutt(hole, lie, PUTTER, { x: 0, y: -0.7 });
  for (const m of [right, left, long, short]) {
    assert.ok(!m.made && m.kind === 'landed');
    const d = G.distance(m.lie, hole.basket);
    assert.ok(d >= 3 && d <= 14.5, `a miss leaves a short comebacker: ${d}`);
  }
  assert.ok(right.lie.x > hole.basket.x + 2 && left.lie.x < hole.basket.x - 2, 'across the green: right of the basket or left of it');
  assert.ok(long.lie.y > hole.basket.y + 2, 'the dot above the target is a long putt');
  assert.ok(short.lie.y < hole.basket.y - 2, 'and below it a short one');
});

test('the putting dot wanders: it stays on the green, never repeats, and keeps coming back through the target', async () => {
  const G = await load();
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const paths = [];
  for (let k = 0; k < 40; k++) {
    const s = G.makePuttSeed(rand);
    let closest = Infinity;
    const trace = [];
    for (let sec = 0; sec < 20; sec += 0.02) {
      const p = G.puttCursorAt(s, sec, 1.4);
      assert.ok(Math.hypot(p.x, p.y) <= 1.000001, 'never off the grid');
      closest = Math.min(closest, Math.hypot(p.x, p.y));
      if (Math.abs(sec - Math.round(sec)) < 0.01) trace.push([+p.x.toFixed(2), +p.y.toFixed(2)]);
    }
    assert.ok(closest < 0.07, `it comes through the middle (seed ${k}: ${closest})`);
    paths.push(trace);
    // the same seed is the same path; and a later stretch is not a copy of an earlier one
    assert.deepStrictEqual(G.puttCursorAt(s, 3.3, 1), G.puttCursorAt(s, 3.3, 1));
    const a = G.puttCursorAt(s, 2, 1);
    const b = G.puttCursorAt(s, 2 + 1.7, 1);
    const c = G.puttCursorAt(s, 2 + 9.3, 1);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 0.01 || Math.hypot(a.x - c.x, a.y - c.y) > 0.01, 'no short repeat');
  }
  assert.notDeepStrictEqual(paths[0], paths[1], 'every putt is its own path');
});

test('scoring, and Marebear: she comes once, at a triple bogey, for the disc you just threw', async () => {
  const G = await load();
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => G.scoreName(s, 4)), ['Ace!', 'Eagle', 'Birdie', 'Par', 'Bogey', 'Double bogey', 'Triple bogey', '+4', '+5']);
  assert.strictEqual(G.scoreName(2, 3), 'Birdie');
  assert.ok(!G.atTripleBogey(6, 4) && G.atTripleBogey(7, 4));
  assert.deepStrictEqual([G.holeScore(4, 4, true), G.holeScore(3, 4, false), G.holeScore(9, 4, false)], [4, 8, 10], 'a hole you could not finish is a bad one');

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


test('the course: eighteen holes, each laid out sensibly', async () => {
  const G = await load();
  assert.strictEqual(G.HOLES.length, 18);
  assert.deepStrictEqual(G.HOLES.map((h) => h.id), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.strictEqual(G.holesFor(9).length, 9);
  assert.strictEqual(G.holesFor(18).length, 18);
  assert.strictEqual(G.holesFor(1).length, 1);
  assert.ok(G.holeById(7).name);
  assert.ok(new Set(G.HOLES.map((h) => h.name)).size === 18, 'every hole has its own name');
  const par = G.HOLES.reduce((n, h) => n + h.par, 0);
  assert.ok(par >= 60 && par <= 76, `a believable par: ${par}`);
  for (const h of G.HOLES) {
    assert.ok([3, 4, 5].includes(h.par), `${h.id} par`);
    assert.strictEqual(G.surfaceAt(h, h.tee.x, h.tee.y), 'tee', `${h.id}: the tee is a tee`);
    assert.strictEqual(G.surfaceAt(h, h.basket.x, h.basket.y), 'fairway', `${h.id}: the basket is on grass`);
    assert.ok(G.distance(h.tee, h.basket) > 150 && G.distance(h.tee, h.basket) < 700, `${h.id}: length`);
    for (const t of h.trees) {
      assert.notStrictEqual(G.surfaceAt(h, t.x, t.y), 'water', `${h.id}: a tree in the water at ${t.x},${t.y}`);
      assert.ok(Math.hypot(t.x - h.tee.x, t.y - h.tee.y) > t.r + 8, `${h.id}: a tree on the tee`);
      assert.ok(Math.hypot(t.x - h.basket.x, t.y - h.basket.y) > t.r + 6, `${h.id}: a tree on the basket`);
    }
  }
});

test('every hole can be played: a careful player with a clean meter makes par or better', async () => {
  const G = await load();
  const FW = { id: 2, speed: 9, glide: 5, turn: -2, fade: 2 };
  const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
  const PUT = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
  for (const hole of G.HOLES) {
    let lie = { ...hole.tee };
    let strokes = 0;
    for (let n = 0; n < 9 && strokes < 99; n++) {
      const dist = G.distance(lie, hole.basket);
      if (dist <= G.PUTT_RANGE) { strokes += 1; break; } // a clean putt goes in
      const discs = dist > 280 ? [DRIVER, FW] : dist > 160 ? [FW, MID, DRIVER] : [MID, PUT, FW];
      const base = G.headingTo(lie, hole.basket);
      let best = null;
      for (const disc of discs) {
        for (let off = -45; off <= 45; off += 5) {
          for (const angle of [-1, 0, 1]) {
            for (let mph = 12; mph <= 86; mph += 8) {
              const r = G.resolveThrow(hole, disc, { ...RIGHT, mph, angle }, base + off, CLEAN, lie);
              if (r.kind !== 'landed' && r.kind !== 'basket') continue;
              const d = G.distance(r.lie, hole.basket);
              if (!best || d < best.d) best = { d, r };
            }
          }
        }
      }
      assert.ok(best, `hole ${hole.id} (${hole.name}): there is always a way to play on`);
      strokes += 1;
      if (best.r.kind === 'basket') break;
      lie = best.r.lie;
    }
    assert.ok(strokes <= hole.par, `hole ${hole.id} (${hole.name}) can be played in par: ${strokes} vs ${hole.par}`);
  }
});


test('what a server accepts: settings in range, and a meter reading that is a real reading', async () => {
  const G = await load();
  const good = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
  assert.deepStrictEqual(G.sanitizeSettings(good), good);
  assert.deepStrictEqual(G.sanitizeSettings({ ...good, spin: 1100, mph: 10, angle: -6 }), { ...good, spin: 1100, mph: 10, angle: -6 });
  for (const bad of [null, 'x', { ...good, hand: 'both' }, { ...good, style: 'sidearm' }, { ...good, mph: 63 }, { ...good, mph: 94 }, { ...good, mph: 8 }, { ...good, mph: 'fast' }, { ...good, angle: 7 }, { ...good, angle: 1.5 }, { ...good, spin: 100 }, { ...good, spin: 5000 }, { ...good, spin: 'lots' }]) {
    assert.strictEqual(G.sanitizeSettings(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(G.sanitizeExecution({ pf: 5, over: -3, o: 9 }).pf, 1, 'clamped');
  assert.strictEqual(G.sanitizeExecution({ pf: 0, o: -9 }).o, -1);
  assert.strictEqual(G.sanitizeExecution({ pf: 'abc' }).pf, 1);
  assert.ok(G.sanitizeExecution({ pf: 1, over: 0, o: 0, pure: true }).pure);
  assert.ok(!G.sanitizeExecution({ pf: 1, over: 0, o: 0.3, pure: true }).pure, 'a sloppy release cannot claim to be pure');
  assert.ok(!G.sanitizeExecution({ pf: 0.9, over: 0, o: 0, pure: true }).pure);
  assert.strictEqual(G.sanitizeExecution({ pf: 1, over: 0, o: 0.9 }).grade, 'Shank');
});


test('a drive has four sliders: power, spin, angle and release, and each one changes the flight', async () => {
  const G = await load();
  const setup = G.meterSetup(62);
  assert.ok(setup.spin.w > 0.05 && setup.angle.w > 0.05);
  assert.ok(G.meterSetup(88).spin.w < G.meterSetup(40).spin.w, 'a harder arm has narrower zones on every slider');
  assert.notStrictEqual(setup.spin.period, setup.angle.period);
  assert.strictEqual(G.needleAt(0, setup.spin.period), -1);

  // spin: the green keeps it all; a lazy snap or an overcooked one loses some
  assert.strictEqual(G.readSpin(0.05, setup.spin.w).spinF, 1);
  assert.ok(G.readSpin(-0.9, setup.spin.w).spinF < 0.7);
  assert.ok(G.readSpin(0.9, setup.spin.w).spinF < 0.7);
  assert.ok(G.readSpin(-0.9, setup.spin.w).spinF >= 0.55, 'never worse than a floor');
  // angle: left is flatter, right is more hyzer
  assert.ok(Math.abs(G.readAngle(0.05, setup.angle.w).angleD) < 1);
  assert.ok(G.readAngle(0.8, setup.angle.w).angleD > 8 && G.readAngle(-0.8, setup.angle.w).angleD < -8);

  const power = G.readPower(setup.power.c, setup.power);
  const power2 = G.readPower(setup.power.c, setup.power.zone || setup.power);
  assert.ok(power.inZone && power2);
  const perfect = G.combineDrive(G.readPower(0.9, setup.power), G.readSpin(0, setup.spin.w), G.readAngle(0, setup.angle.w), G.readRelease(0, setup.release.w));
  assert.strictEqual(perfect.grade, 'Pure');
  assert.strictEqual(perfect.spinF, 1);
  const bad = G.combineDrive(G.readPower(0.9, setup.power), G.readSpin(0.95, setup.spin.w), G.readAngle(-0.9, setup.angle.w), G.readRelease(0, setup.release.w));
  assert.ok(!bad.pure && bad.sloppy > 0.4);

  // what each slider does to a real throw
  const hole = await field();
  const flat = G.resolveThrow(hole, DRIVER, RIGHT, 0, perfect, { x: 0, y: 0 });
  const hyzer = G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...perfect, pure: false, angleD: 12 }, { x: 0, y: 0 });
  const anhyzer = G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...perfect, pure: false, angleD: -12 }, { x: 0, y: 0 });
  assert.ok(hyzer.end.x < flat.end.x - 5, 'the angle slider tips it onto hyzer: left for a right-hand backhand');
  assert.ok(anhyzer.end.x > hyzer.end.x + 10, 'and flatter goes the other way');
  assert.ok(hyzer.plan.feet < flat.plan.feet);
  const lazy = G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...perfect, pure: false, spinF: 0.55 }, { x: 0, y: 0 });
  assert.ok(lazy.plan.feet < flat.plan.feet, 'a lazy snap is a shorter throw');
  const weak = G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...perfect, pure: false, pf: 0.6 }, { x: 0, y: 0 });
  assert.ok(weak.plan.feet < flat.plan.feet * 0.8, 'the power slider is the speed');

  // the server takes the extra readings, clamps them, and will not take a claim of a pure throw it can see is not
  const ok = G.sanitizeExecution({ pf: 1, over: 0, o: 0, spinF: 1, angleD: 0.4, pure: true });
  assert.ok(ok.pure && ok.spinF === 1);
  assert.ok(!G.sanitizeExecution({ pf: 1, over: 0, o: 0, spinF: 0.9, angleD: 0, pure: true }).pure);
  assert.ok(!G.sanitizeExecution({ pf: 1, over: 0, o: 0, spinF: 1, angleD: 5, pure: true }).pure);
  assert.strictEqual(G.sanitizeExecution({ spinF: 0.1, angleD: 99 }).spinF, 0.55);
  assert.strictEqual(G.sanitizeExecution({ spinF: 0.1, angleD: 99 }).angleD, 14);
  assert.strictEqual(G.sanitizeExecution({ pf: 1 }).spinF, undefined, 'a throw without the drive sliders is the classic two');
});
