'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = async () => ({ ...(await import('../public/js/gamecore.js')), ...(await import('../public/js/course.js')) });

const DRIVER = { id: 1, speed: 12, glide: 5, turn: -1, fade: 3 };
const PUTTER = { id: 2, speed: 3, glide: 3, turn: 0, fade: 1 };
const RIGHT = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
const CLEAN = { o: 0, pure: false, sloppy: 0, grade: 'Good' };

// a bare field: a long fairway, nothing in the way, calm air
async function field(extra = {}) {
  const { makeHole } = await load();
  return makeHole({ id: 9, name: 'Test', par: 4, fairway: [[0, 0, 60], [0, 600, 60]], basket: { x: 0, y: 900 }, wind: { mph: 0, from: 0 }, ...extra });
}

test('the meters: power, nose and angle set the throw; the release is graded', async () => {
  const G = await load();
  // each bar sweeps and its stop position is the value
  assert.strictEqual(G.powerAt(0), 0);
  assert.ok(Math.abs(G.powerAt(G.METER.power.period / 2) - 1) < 1e-9);
  assert.strictEqual(G.mphAt(0), 10);
  assert.strictEqual(G.mphAt(1), 90);
  assert.strictEqual(G.mphAt(0.5) % 2, 0, 'arm speed lands on a whole step');
  assert.strictEqual(G.mphAt(G.POWER_KNEE), G.POWER_KNEE_MPH);
  // the fast end is harder: the marker moves faster there, and each mph takes less of the bar
  const pace = (sec) => Math.abs(G.mphAt(G.powerAt(sec + 0.005)) - G.mphAt(G.powerAt(sec - 0.005))) / 0.01; // mph per second
  const per = G.METER.power.period;
  assert.ok(pace(per * 0.47) > pace(per * 0.2) * 2, 'the top of the bar flies by compared with the bottom');
  for (let x = 0.05; x < 1; x += 0.05) assert.ok(G.mphAt(x + 0.05) >= G.mphAt(x), 'more bar is never less speed');
  assert.ok(G.mphAt(0.7) > G.mphAt(0.4));
  assert.strictEqual(G.noseAt(-1), -5);
  assert.strictEqual(G.noseAt(0), 0);
  assert.strictEqual(G.noseAt(1), 5);
  assert.strictEqual(G.noseAt(0.5), 3, 'a needle position is a whole step');
  assert.strictEqual(G.noseAt(9), 5, 'never past the ends');
  assert.strictEqual(G.noseName(0), 'Level');
  assert.strictEqual(G.noseName(3), 'Nose up 7.5°');
  assert.strictEqual(G.noseName(-2), 'Nose down 5°');
  assert.strictEqual(G.angleAt(-1), -6);
  assert.strictEqual(G.angleAt(0), 0);
  assert.strictEqual(G.angleAt(1), 6);
  assert.strictEqual(G.angleAt(0.5), 3);
  assert.strictEqual(G.angleAt(7), 6, 'never past the ends');
  // every bar has its own speed
  assert.strictEqual(new Set([G.METER.power.period, G.METER.nose.period, G.METER.angle.period]).size, 3);
  assert.strictEqual(G.needleAt(0, G.METER.nose.period), -1);

  // the release: a harder arm is harder to time
  assert.ok(G.releaseSetup(88).w < G.releaseSetup(40).w && G.releaseSetup(88).period < G.releaseSetup(40).period);
  const rel = G.releaseSetup(56);
  assert.ok(G.readRelease(0.05, rel.w).inZone);
  assert.ok(!G.readRelease(0.6, rel.w).inZone);
  assert.strictEqual(G.combine(G.readRelease(0, rel.w)).grade, 'Pure');
  assert.strictEqual(G.combine(G.readRelease(0.9, rel.w)).grade, 'Shank');
  assert.strictEqual(G.releaseAt(0, rel), -1);
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

test('a late release pulls a right-hander left; an early one goes right', async () => {
  const G = await load();
  const hole = await field();
  const end = (ex) => G.resolveThrow(hole, DRIVER, RIGHT, 0, { ...CLEAN, ...ex }, { x: 0, y: 0 }).end;
  const flat = end({});
  assert.ok(end({ o: 0.8, sloppy: 0.8 }).x < flat.x - 5, 'late: left');
  assert.ok(end({ o: -0.8, sloppy: 0.8 }).x > flat.x + 5, 'early: right');
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
  const close = await field({ trees: [{ x: 0, y: 4.5, r: 4, h: 200 }] });
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

test('a patch of trees you have been in is out of the way once; the next patch down the hole is not', async () => {
  const G = await load();
  const hole0 = await field();
  const open = G.resolveThrow(hole0, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  const mid = open.pts[Math.floor(open.pts.length / 2)];
  const wall = (y) => Array.from({ length: 9 }, (_, i) => ({ x: -21 + i * 5.2, y, r: 4.4, h: 200 })); // a row of trunks across the fairway
  const hole = await field({ trees: [...wall(mid.y), ...wall(mid.y + 110)], basket: { x: 0, y: 1500 }, bounds: { minX: -300, maxX: 300, minY: -50, maxY: 1600 } });
  const first = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(first.kind, 'tree', 'the first throw hits the first row');
  assert.ok(Math.abs(first.hit.tree.y - mid.y) < 1, 'in the first row');
  assert.ok(first.lie.t !== undefined, 'the lie remembers the tree');
  // from there the same throw goes through the rest of that row, and the next row is where it stops
  const second = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, first.lie);
  assert.strictEqual(second.kind, 'tree', 'and it hits the next row');
  assert.ok(second.hit.tree.y > mid.y + 100, `the second row, not the first: ${second.hit.tree.y} vs ${mid.y}`);
  // it is only for one throw: from the second row's lie, the third throw goes through that one, too
  const third = G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, second.lie);
  assert.ok(!(third.kind === 'tree' && Math.abs(third.hit.tree.y - second.hit.tree.y) < 30), 'never stuck behind the patch you are in');
  // a lie with no memory (a fresh throw from the tee) meets the first row as before
  assert.strictEqual(G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'tree');
  // and coming to rest among trees counts as being in them
  const beside = { x: open.lie.x + 6.5, y: open.lie.y - 1, r: 4, h: 60 };
  const rested = await field({ trees: [beside], basket: { x: 0, y: 1500 }, bounds: { minX: -300, maxX: 300, minY: -50, maxY: 1600 } });
  const r = G.resolveThrow(rested, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  assert.strictEqual(r.kind, 'landed');
  assert.strictEqual(r.lie.t, 0, 'resting beside a real tree: the lie remembers it');
  assert.strictEqual(G.resolveThrow(hole0, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).lie.t, undefined, 'in the open it remembers nothing');
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

test('putting: given inside two feet, and the target narrows with distance and with a faster disc', async () => {
  const G = await load();
  const hole = await field({ basket: { x: 0, y: 40 } });
  assert.ok(G.puttZone(10, PUTTER) > G.puttZone(30, PUTTER));
  assert.ok(G.puttZone(20, PUTTER) > G.puttZone(20, DRIVER));
  assert.ok(G.puttZone(500, DRIVER) >= 0.04, 'never impossible');
  assert.ok(G.puttRadius(10, PUTTER) > G.puttRadius(40, PUTTER));
  assert.ok(G.puttRadius(50, DRIVER) >= 0.022, 'never nothing');
  assert.ok(G.puttRadius(30, PUTTER) > G.puttRadius(31, PUTTER) * 1.05 || G.puttRadius(30, PUTTER) > G.puttRadius(40, PUTTER) * 1.5, 'past 30 feet it collapses');
  assert.ok(G.puttRadius(45, PUTTER) < G.puttRadius(30, PUTTER) * 0.5, 'a 45 footer has under half the target of a 30 footer');
  assert.ok(G.puttSpeed(45) > G.puttSpeed(30) * 1.3, 'and the dot is much faster');
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

test('the course has teeth: across the eighteen a drive can land, hit a tree, go in the water or go out of bounds', async () => {
  const G = await load();
  const kinds = new Set();
  const surfaces = new Set();
  for (const hole of G.HOLES) {
    for (let aim = 0; aim < 360; aim += 12) {
      for (const mph of [40, 62, 78]) {
        const r = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, aim, CLEAN, hole.tee);
        assert.ok(Number.isFinite(r.end.x) && Number.isFinite(r.end.y) && Number.isFinite(r.plan.feet), `hole ${hole.id}`);
        kinds.add(r.kind);
        if (r.kind === 'landed') surfaces.add(r.surface);
      }
    }
  }
  for (const k of ['landed', 'tree', 'water']) assert.ok(kinds.has(k), `a drive can end up: ${k} (saw ${[...kinds]})`);
  assert.ok(kinds.has('oob') || kinds.has('water'), 'and there is out of bounds too');
  assert.ok(surfaces.has('fairway') && surfaces.has('rough'), `lands on both the fairway and the rough (saw ${[...surfaces]})`);
  // the holes are not all the same hole: they run different ways, and the layout features really appear
  const heading = (h) => Math.round(G.headingTo(h.tee, h.basket) / 45);
  assert.ok(new Set(G.HOLES.map(heading)).size >= 4, 'the holes point in a variety of directions');
  assert.ok(G.HOLES.some((h) => h.oob.length), 'some hole has out of bounds inside it');
  assert.ok(G.HOLES.some((h) => h.water.length >= 3), 'some hole has a string of ponds');
  assert.ok(G.HOLES.some((h) => h.route.len > G.distance(h.tee, h.basket) * 2), 'one hole doubles back on itself');
  assert.ok(G.HOLES.filter((h) => h.trees.some((t) => t.h < 20)).length >= 4, 'low shrubs you can throw over appear on several holes');
});

test('after hitting a tree, no throw from where it dropped hits that same tree again', async () => {
  const G = await load();
  const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
  let checked = 0;
  for (const id of [2, 3, 8, 11, 17]) {
    const hole = G.holeById(id);
    for (let aim = 0; aim < 360; aim += 8) {
      for (const mph of [50, 62, 74]) {
        const first = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, aim, CLEAN, hole.tee);
        if (first.kind !== 'tree') continue;
        for (const disc of [DRIVER, MID]) {
          for (let aim2 = -40; aim2 <= 40; aim2 += 8) {
            for (const mph2 of [20, 40, 62]) {
              const second = G.resolveThrow(hole, disc, { ...RIGHT, mph: mph2 }, G.headingTo(first.lie, hole.basket) + aim2, CLEAN, first.lie);
              checked++;
              assert.ok(!(second.kind === 'tree' && second.hit.tree === first.hit.tree), `hole ${id}: stuck behind the same tree (aim ${aim}, then ${aim2})`);
            }
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
  assert.deepStrictEqual(G.holesFor(3).map((h) => h.id), [1, 2, 5], 'a warm-up is three of the gentler holes');
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

test('technical holes: trees reach into the fairway on alternating sides, baskets are guarded, and greens shed a miss', async () => {
  const G = await load();
  const tall = (h) => h.trees.filter((t) => t.h >= 60);
  const inside = (h) => tall(h).filter((t) => { const p = G.routePosition(h, t.x, t.y); return p.s > 40 && p.s < h.route.len - 60 && p.d < p.hw - 6; }).length;
  for (const id of [3, 4, 7, 11, 12, 14]) assert.ok(inside(G.holeById(id)) >= 6, `hole ${id}: staggered trees in the fairway: ${inside(G.holeById(id))}`);
  // the two sides really alternate on a hole that asks for it (hole 3: right first, then left)
  const h3 = G.holeById(3);
  const sides = tall(h3).filter((t) => { const p = G.routePosition(h3, t.x, t.y); return p.s > 70 && p.s < 150 && p.d < p.hw - 6; }).map((t) => G.routePosition(h3, t.x, t.y).side);
  assert.ok(sides.includes(1) && sides.includes(-1), 'hole 3: trees reach in from the right and from the left');
  const guarded = G.HOLES.filter((h) => tall(h).some((t) => { const d = G.distance(t, h.basket); return d > 30 && d < 75 && G.routePosition(h, t.x, t.y).d < G.routePosition(h, t.x, t.y).hw; }));
  assert.ok(guarded.length >= 8, `baskets with a guard tree on the approach: ${guarded.length}`);
  const sheds = G.HOLES.filter((h) => {
    let worst = 0;
    for (let a = 0; a < 360; a += 30) { const s = G.slopeAt(h, h.basket.x + Math.cos(a * Math.PI / 180) * 14, h.basket.y + Math.sin(a * Math.PI / 180) * 14); worst = Math.max(worst, Math.hypot(s.gx, s.gy)); }
    return worst >= 0.12;
  });
  assert.ok(sheds.length >= 8, `greens that run a miss off (raised, or dropping away behind): ${sheds.length}`);
});

test('Quarry Ridge: a second eighteen, each hole laid out sensibly and numbered 1 to 18 on the card', async () => {
  const G = await load();
  assert.strictEqual(G.HOLES2.length, 18);
  assert.deepStrictEqual(G.HOLES2.map((h) => h.id), Array.from({ length: 18 }, (_, i) => 101 + i), 'ids 101 to 118');
  assert.deepStrictEqual(G.HOLES2.map((h) => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.deepStrictEqual(G.HOLES.map((h) => h.n), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.ok(G.HOLES2.every((h) => h.course === 2) && G.HOLES.every((h) => h.course === 1));
  const names = [...G.HOLES, ...G.HOLES2].map((h) => h.name);
  assert.strictEqual(new Set(names).size, 36, 'every hole on both courses has its own name');
  const par = G.HOLES2.reduce((n, h) => n + h.par, 0);
  assert.ok(par >= 62 && par <= 76, `a believable par: ${par}`);
  assert.ok([3, 4, 5].every((p) => G.HOLES2.filter((h) => h.par === p).length >= 3), 'a mix of par 3, 4 and 5');
  for (const h of G.HOLES2) {
    assert.strictEqual(G.surfaceAt(h, h.tee.x, h.tee.y), 'tee', `${h.id}: the tee is a tee`);
    assert.strictEqual(G.surfaceAt(h, h.basket.x, h.basket.y), 'fairway', `${h.id}: the basket is on grass`);
    assert.ok(G.distance(h.tee, h.basket) > 150 && G.distance(h.tee, h.basket) < 700, `${h.id}: length`);
    for (const t of h.trees) {
      assert.notStrictEqual(G.surfaceAt(h, t.x, t.y), 'water', `${h.id}: a tree in the water at ${t.x},${t.y}`);
      assert.ok(Math.hypot(t.x - h.tee.x, t.y - h.tee.y) > t.r + 8 && Math.hypot(t.x - h.basket.x, t.y - h.basket.y) > t.r + 6, `${h.id}: a tree on the tee or basket`);
    }
  }
  assert.strictEqual(G.holeById(105).name, 'Spillway');
  assert.strictEqual(G.holeById(5).name, 'Water Carry');
  assert.strictEqual(G.holesFor(18, 2).length, 18);
  assert.strictEqual(G.holesFor(9, 2)[0].id, 101);
  assert.deepStrictEqual(G.holesFor(3, 2).map((h) => h.id), [101, 102, 105]);
  assert.strictEqual(G.holesFor(9)[0].id, 1, 'the first course is the default');
  assert.strictEqual(G.courseById(2).name, 'Quarry Ridge');
  assert.strictEqual(G.courseById(99).id, 1, 'an unknown course is the first');
  assert.strictEqual(G.COURSES.length, 2);
});

test('every hole can be played: a careful player with a clean meter makes par or better', async () => {
  const G = await load();
  const FW = { id: 2, speed: 9, glide: 5, turn: -2, fade: 2 };
  const MID = { id: 3, speed: 5, glide: 4, turn: 0, fade: 3 };
  const PUT = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
  // a careful player's search is greedy, so on a hole with hills one grain of power (the bar is continuous) can matter: try a few
  const play = (hole, grain) => {
    let lie = { ...hole.tee };
    let strokes = 0;
    for (let n = 0; n < 9 && strokes < 99; n++) {
      if (G.distance(lie, hole.basket) <= G.PUTT_RANGE) { strokes += 1; break; } // a centered tap goes in
      const left = G.routeLeft(hole, lie.x, lie.y);
      const discs = left > 280 ? [DRIVER, FW] : left > 160 ? [FW, MID, DRIVER] : [MID, PUT, FW];
      // the woods are solid, so a careful player plays down the hole: aims along the route, at points further on, and at the basket
      const aims = new Set([Math.round(G.headingTo(lie, hole.basket))]);
      for (const look of [50, 90, 140, 200, 300]) {
        const h = G.headingTo(lie, G.routeAhead(hole, lie.x, lie.y, look));
        for (const off of [-9, -4.5, 0, 4.5, 9]) aims.add(Math.round(h + off));
      }
      let best = null;
      const tryAims = (list) => {
        for (const disc of discs) {
          for (const aim of list) {
            for (const angle of [-2, 0, 2]) {
              for (let mph = 12; mph <= 86; mph += grain) {
                const r = G.resolveThrow(hole, disc, { ...RIGHT, mph, angle }, aim, CLEAN, lie);
                if (r.kind !== 'landed' && r.kind !== 'basket') continue;
                const d = r.kind === 'basket' ? 0 : G.distance(r.lie, hole.basket) <= G.PUTT_RANGE ? G.distance(r.lie, hole.basket) : G.routeLeft(hole, r.lie.x, r.lie.y) + 60;
                if (!best || d < best.d) best = { d, r };
              }
            }
          }
        }
      };
      tryAims(aims);
      if (!best) tryAims(Array.from({ length: 60 }, (_, i) => i * 6)); // boxed in on the line of the hole: look every way
      assert.ok(best, `hole ${hole.id} (${hole.name}): there is always a way to play on`);
      strokes += 1;
      if (best.r.kind === 'basket') break;
      lie = best.r.lie;
    }
    return strokes;
  };
  for (const hole of [...G.HOLES, ...G.HOLES2]) {
    let strokes = Infinity;
    for (const grain of [8, 4, 6, 3, 5]) {
      strokes = Math.min(strokes, play(hole, grain));
      if (strokes <= hole.par) break;
    }
    assert.ok(strokes <= hole.par, `hole ${hole.id} (${hole.name}) can be played in par: ${strokes} vs ${hole.par}`);
  }
});

test('the woods are solid: you cannot just throw any way from the tee, the fairway is the way', async () => {
  const G = await load();
  let off = 0;
  let through = 0;
  for (const hole of [...G.HOLES, ...G.HOLES2]) {
    const first = G.headingTo(hole.tee, G.routeAhead(hole, hole.tee.x, hole.tee.y, 150)); // down the hole
    for (let aim = 0; aim < 360; aim += 6) {
      const away = Math.abs(((aim - first + 540) % 360) - 180);
      if (away < 75) continue; // along the hole is fair
      for (const [mph, nose] of [[40, 0], [62, 0], [80, 0], [80, 5], [62, 4]]) { // and a lofted throw does not clear the pines either
        const r = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph, nose }, aim, CLEAN, hole.tee);
        off++;
        // a throw that is not along the hole should be stopped by trees (or end up wet or out), not be a good shot
        if (r.kind === 'landed' && G.routeLeft(hole, r.lie.x, r.lie.y) < G.routeLeft(hole, hole.tee.x, hole.tee.y) - 60) through++;
      }
    }
  }
  assert.ok(off > 500);
  assert.ok(through / off < 0.02, `throws away from the hole that still made real progress: ${through} of ${off}`);
});

test('what a server accepts: settings in range, and a meter reading that is a real reading', async () => {
  const G = await load();
  const good = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0, nose: 0 };
  assert.deepStrictEqual(G.sanitizeSettings(good), good);
  const { nose: _omit, ...older } = good;
  assert.deepStrictEqual(G.sanitizeSettings(older), good, 'a page that does not send a nose angle throws level');
  assert.deepStrictEqual(G.sanitizeSettings({ ...good, spin: 1100, mph: 10, angle: -6, nose: -5 }), { ...good, spin: 1100, mph: 10, angle: -6, nose: -5 });
  for (const bad of [null, 'x', { ...good, hand: 'both' }, { ...good, style: 'sidearm' }, { ...good, mph: 63 }, { ...good, mph: 94 }, { ...good, mph: 8 }, { ...good, mph: 'fast' }, { ...good, angle: 7 }, { ...good, angle: 1.5 }, { ...good, spin: 100 }, { ...good, spin: 5000 }, { ...good, spin: 'lots' }, { ...good, nose: 6 }, { ...good, nose: -6 }, { ...good, nose: 1.5 }, { ...good, nose: 'up' }]) {
    assert.strictEqual(G.sanitizeSettings(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(G.sanitizeExecution({ o: 9 }).o, 1, 'clamped');
  assert.strictEqual(G.sanitizeExecution({ o: -9 }).o, -1);
  assert.strictEqual(G.sanitizeExecution({ o: 'abc' }).o, 0);
  assert.ok(G.sanitizeExecution({ o: 0, pure: true }).pure);
  assert.ok(!G.sanitizeExecution({ o: 0.3, pure: true }).pure, 'a sloppy release cannot claim to be pure');
  assert.strictEqual(G.sanitizeExecution({ o: 0.9 }).grade, 'Shank');
});


test('the settings the meters choose change the flight: faster, the nose, and the angle', async () => {
  const G = await load();
  const hole = await field();
  const go = (t) => G.resolveThrow(hole, DRIVER, { ...RIGHT, ...t }, 0, CLEAN, { x: 0, y: 0 });
  const flat = go({});
  assert.ok(go({ mph: 80 }).plan.feet > go({ mph: 50 }).plan.feet + 40, 'the power meter is the arm speed');
  assert.ok(go({ angle: 5 }).end.x < flat.end.x - 5, 'the angle meter tips it onto hyzer: left for a right-hand backhand');
  assert.ok(go({ angle: -5 }).end.x > flat.end.x + 5, 'and flatter goes the other way');
  assert.ok(go({ angle: 5 }).plan.feet < flat.plan.feet);
  // the nose angle: up goes higher, and both ways from level cost distance
  const apex = (r) => Math.max(...r.pts.map((p) => p.h));
  assert.ok(apex(go({ nose: 4 })) > apex(go({ nose: 0 })) * 1.3, 'nose up is a higher flight');
  assert.ok(apex(go({ nose: -4 })) < apex(go({ nose: 0 })) * 0.6, 'nose down is a lower one');
  assert.ok(go({ nose: 5 }).plan.feet < go({ nose: 0 }).plan.feet * 0.9, 'a lot of nose up spends distance');
  assert.ok(go({ nose: -5 }).plan.feet < go({ nose: 0 }).plan.feet * 0.85, 'and so does a lot of nose down');
  assert.ok(Math.abs(go({ nose: 1 }).plan.feet - go({ nose: 0 }).plan.feet) < go({ nose: 0 }).plan.feet * 0.03, 'a touch of nose up costs almost nothing');
});

test('a slow arm can slip: grip lock or early release, rarer as the arm speeds up, and never from a fast one', async () => {
  const G = await load();
  const chance = (disc, mph, extra = {}) => G.slipChance(disc, { ...RIGHT, mph, ...extra });
  assert.strictEqual(chance(DRIVER, 66), 0, 'Intermediate Plus is where it ends');
  assert.strictEqual(chance(DRIVER, 80), 0);
  assert.ok(chance(DRIVER, 60) > 0 && chance(DRIVER, 60) < chance(DRIVER, 40), 'slower, likelier');
  assert.ok(chance(DRIVER, 40) < chance(DRIVER, 12));
  assert.ok(chance(DRIVER, 12) <= 0.4, 'capped');
  assert.ok(chance(PUTTER, 30) < chance(DRIVER, 30), 'a fast disc is harder to hold on to');
  assert.ok(chance(DRIVER, 40, { nose: 5 }) > chance(DRIVER, 40), 'a nose angle far from level adds to it');
  assert.ok(chance(DRIVER, 40, { angle: 6 }) > chance(DRIVER, 40), 'so does an extreme angle');

  // the caller rolls: a low roll slips, a high one does not, and the two kinds split the chance
  const c = chance(DRIVER, 30);
  assert.strictEqual(G.rollSlip(DRIVER, { ...RIGHT, mph: 30 }, c / 4), 'grip');
  assert.strictEqual(G.rollSlip(DRIVER, { ...RIGHT, mph: 30 }, c * 0.75), 'early');
  assert.strictEqual(G.rollSlip(DRIVER, { ...RIGHT, mph: 30 }, c + 0.01), null);
  assert.strictEqual(G.rollSlip(DRIVER, { ...RIGHT, mph: 80 }, 0), null, 'a fast arm never slips');

  // what a slip does to the flight
  const hole = await field();
  const go = (ex, mph = 56) => G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, 0, ex, { x: 0, y: 0 });
  const clean = go(CLEAN);
  const grip = go(G.applySlip(CLEAN, 'grip'));
  const early = go(G.applySlip(CLEAN, 'early'));
  assert.strictEqual(G.applySlip(CLEAN, null), CLEAN);
  assert.strictEqual(G.applySlip(CLEAN, 'grip').grade, 'Grip lock');
  assert.strictEqual(G.applySlip(CLEAN, 'early').grade, 'Early release');
  assert.ok(grip.plan.feet < clean.plan.feet * 0.8, 'a grip lock is short');
  assert.ok(grip.end.x < clean.end.x - 5, 'and hooks to the fade side (left for a right-hand backhand)');
  assert.ok(early.end.x > clean.end.x + 5, 'an early release goes to the turn side');
  assert.ok(early.plan.feet < clean.plan.feet);
  assert.ok(!G.sanitizeExecution({ o: 0, slip: 'grip' }).slip, 'a browser cannot hand itself a slip');
});

test('the aim preview: a typical throw and a band either side of it', async () => {
  const G = await load();
  const hole = await field();
  assert.ok(G.typicalArm(PUTTER) < G.typicalArm(DRIVER), 'a faster disc wants a faster arm');
  assert.ok(G.typicalArm(DRIVER) >= 30 && G.typicalArm(DRIVER) <= 90);
  const pv = G.previewThrow(hole, DRIVER, RIGHT, 0, { x: 0, y: 0 });
  const perfect = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph: pv.mph }, 0, { ...CLEAN, pure: true }, { x: 0, y: 0 });
  assert.ok(pv.line.at(-1).y > 100 && pv.line.at(-1).y < perfect.plan.feet * 1.05, 'about as far as a clean throw at that arm speed');
  const xs = pv.band.map((p) => p.x);
  assert.ok(Math.min(...xs) < pv.line.at(-1).x - 3 && Math.max(...xs) > pv.line.at(-1).x + 3, 'the band has width either side of the line');
  assert.deepStrictEqual(pv.end, pv.line.at(-1));
  // it follows the aim and the hand
  const right = G.previewThrow(hole, DRIVER, RIGHT, 20, { x: 0, y: 0 });
  assert.ok(right.end.x > pv.end.x + 30, 'aiming right moves it right');
  const lefty = G.previewThrow(hole, DRIVER, { ...RIGHT, hand: 'left' }, 0, { x: 0, y: 0 });
  assert.notStrictEqual(Math.round(lefty.end.x), Math.round(pv.end.x), 'a left-hander finishes the other way');
});

test('the sweet spots: each bar shows where to stop to get closest to the basket, given the bars before it', async () => {
  const G = await load();
  const hole = await field({ basket: { x: 0, y: 330 } });
  const from = { x: 0, y: 0 };
  const base = { hand: 'right', style: 'backhand', mph: null, spin: null, angle: 0, nose: 0 };
  const power = G.sweetSpots(hole, DRIVER, base, 0, from, 'power');
  const okMph = power.values.filter((_, i) => power.ok[i]);
  assert.ok(okMph.length > 0 && okMph.length < power.values.length / 2, 'a stretch of speeds, not all of them');
  assert.ok(!okMph.includes(10) && !okMph.includes(90), 'neither a limp throw nor a full send reaches a basket 330 ft out');
  assert.ok(power.best < 60, 'some arm speed gets within a putt of it');
  const bands = G.sweetBands(power);
  assert.ok(bands.length >= 1 && bands.every((b) => b.from >= 0 && b.to <= 1 && b.to > b.from));
  // the bar position round-trips with what the bar reads
  for (const mph of [10, 30, 50, 62, 78, 90]) assert.strictEqual(G.mphAt(G.powerPos(mph)), mph);

  // later bars narrow it: with the arm speed chosen, the nose band depends on that speed
  const mph = okMph[Math.floor(okMph.length / 2)];
  const nose = G.sweetSpots(hole, DRIVER, { ...base, mph }, 0, from, 'nose');
  assert.strictEqual(nose.values.length, 11);
  assert.ok(nose.ok.some(Boolean) && nose.best <= power.best + 20);
  assert.ok(G.sweetBands(nose).every((b) => b.from >= 0 && b.to <= 1));
  const tooSoft = G.sweetSpots(hole, DRIVER, { ...base, mph: 30 }, 0, from, 'nose');
  assert.ok(tooSoft.best > nose.best + 50, 'a speed that is wrong for the distance has no good nose angle');

  // the angle bar: with speed and nose chosen, the best angle is a real one and the flat throw's miss shows up
  const angle = G.sweetSpots(hole, DRIVER, { ...base, mph, nose: 0 }, 0, from, 'angle');
  assert.strictEqual(angle.values.length, 13);
  assert.ok(angle.ok.some(Boolean));
  const ab = G.sweetBands(angle);
  assert.ok(ab.every((b) => b.from >= 0 && b.to <= 1));

  // on a hole too long to reach, the sweet spot is the fastest arm: as close as it gets
  const far = await field({ basket: { x: 0, y: 900 } });
  const farSweet = G.sweetSpots(far, DRIVER, base, 0, from, 'power');
  assert.ok(farSweet.ok[farSweet.ok.length - 1], 'full speed is as close as you can get');
  assert.ok(!farSweet.ok[0]);
});

test('the nose angle can lift a throw over something low, and the pines stay too tall for it', async () => {
  const G = await load();
  const hole0 = await field();
  const open = G.resolveThrow(hole0, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 });
  const mid = open.pts[Math.floor(open.pts.length / 2)];
  const low = { x: mid.x, y: mid.y, r: 4, h: 45 }; // a branch at 45 feet, right under the top of the usual arc
  const hole = await field({ trees: [low], basket: { x: 0, y: 1500 }, bounds: { minX: -300, maxX: 300, minY: -50, maxY: 1600 } });
  assert.strictEqual(G.resolveThrow(hole, DRIVER, RIGHT, 0, CLEAN, { x: 0, y: 0 }).kind, 'tree', 'a level throw hits it');
  const lob = G.resolveThrow(hole, DRIVER, { ...RIGHT, nose: 4 }, 0, CLEAN, { x: 0, y: 0 });
  assert.notStrictEqual(lob.kind, 'tree', 'nose up goes over');
  assert.ok(lob.plan.feet < open.plan.feet, 'and it cost some distance');
  // the woods on the course are taller than the highest lob can get
  const G2 = await load();
  const tallest = Math.max(...[40, 62, 86].map((mph) => Math.max(...G2.resolveThrow(hole0, DRIVER, { ...RIGHT, mph, nose: 5 }, 0, CLEAN, { x: 0, y: 0 }).pts.map((p) => p.h))));
  const woods = G2.HOLES.flatMap((h) => h.trees).filter((t) => t.h >= 60);
  assert.ok(woods.length > 1000 && tallest < 62, `the highest throw (${Math.round(tallest)} ft) is under the shortest pine`);
});

test('a forest, not a row of trees: pine, maple and oak, bushes and shrubs, and clearings where the design has them', async () => {
  const G = await load();
  const kinds = {};
  let withGrowth = 0;
  for (const h of G.HOLES) {
    const c = {};
    for (const t of h.trees) { c[t.k] = (c[t.k] || 0) + 1; kinds[t.k] = (kinds[t.k] || 0) + 1; assert.ok(['p', 'm', 'o', 's', 'b'].includes(t.k), `hole ${h.id}: a tree with a species (${t.k})`); }
    if ((c.b || 0) >= 15 && (c.s || 0) >= 1) withGrowth++;
  }
  const big = (kinds.p || 0) + (kinds.m || 0) + (kinds.o || 0);
  for (const k of ['p', 'm', 'o']) assert.ok(kinds[k] / big > 0.15, `a real mix: ${k} is ${Math.round((100 * kinds[k]) / big)}%`);
  assert.ok(kinds.b > 800 && kinds.s > 100, `bushes and shrubs: ${kinds.b} and ${kinds.s}`);
  assert.ok(withGrowth >= 15, `most holes have undergrowth: ${withGrowth}`);
  // species are sized as they should be: pines narrow and tallest, oaks broad
  const avg = (k, f) => { const l = G.HOLES.flatMap((h) => h.trees.filter((t) => t.k === k)); return l.reduce((n, t) => n + f(t), 0) / l.length; };
  assert.ok(avg('p', (t) => t.r) < avg('m', (t) => t.r) && avg('m', (t) => t.r) < avg('o', (t) => t.r), 'pines are narrowest, oaks broadest');
  assert.ok(avg('p', (t) => t.h) > avg('m', (t) => t.h), 'and pines are the tallest');
  assert.ok(G.HOLES.flatMap((h) => h.trees).filter((t) => ['p', 'm', 'o'].includes(t.k)).every((t) => t.h >= 30), 'real trees are tall');

  // the forest goes all the way out: on hole 1, away from the fairway on both sides, nearly every patch of ground has trees
  const hole = G.holeById(1);
  let cells = 0;
  let filled = 0;
  for (let x = hole.bounds.minX + 20; x < hole.bounds.maxX - 20; x += 30) {
    for (let y = hole.bounds.minY + 40; y < hole.bounds.maxY - 40; y += 30) {
      const left = G.routeAhead(hole, x, y, 0);
      if (Math.hypot(x - left.x, y - left.y) < 70) continue; // beside the fairway or on it
      cells++;
      if (hole.trees.some((t) => ['p', 'm', 'o'].includes(t.k) && Math.abs(t.x - x) < 15 && Math.abs(t.y - y) < 15)) filled++;
    }
  }
  assert.ok(cells > 40 && filled / cells > 0.85, `the whole outside is forest: ${filled} of ${cells} patches`);

  // and the clearing on the inside of hole 3's corner (no woods there by design) stays open: only low shrubs
  const bend = G.holeById(3);
  const inside = bend.trees.filter((t) => {
    if (!['p', 'm', 'o'].includes(t.k)) return false;
    const w = G.routePosition(bend, t.x, t.y);
    return w.side === -1 && w.s > 165 && w.s < 255 && w.d > w.hw + 12; // the left of the corner, past the first rows
  });
  assert.strictEqual(inside.length, 0, `the cut-the-corner clearing has no big trees: ${inside.length}`);
  // and it is not just empty because the whole side is: the rest of that side is forest
  const rest = bend.trees.filter((t) => ['p', 'm', 'o'].includes(t.k) && G.routePosition(bend, t.x, t.y).side === -1 && G.routePosition(bend, t.x, t.y).s < 120).length;
  assert.ok(rest > 50, `the rest of the left side is forest: ${rest}`);
});

test('the swipe on a drive is graded: a true one changes nothing, off line steers, too soft is short, too hard is loose', async () => {
  const G = await load();
  const hole = await field();
  const lie = { x: 0, y: 0 };
  const base = G.combine(G.readRelease(0, 0.14)); // a clean release
  const go = (swipe, mph = 62) => G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, 0, G.withSwipe(base, swipe), lie);
  const plain = G.resolveThrow(hole, DRIVER, RIGHT, 0, base, lie);

  assert.strictEqual(G.withSwipe(base, null), base, 'no swipe, no change');
  const truth = G.withSwipe(base, { aim: 8, power: 1.15 });
  assert.ok(truth.pure === base.pure && truth.sloppy === base.sloppy && truth.swipeSpeed === 1 && truth.swipeAim === 0, 'inside the tolerance it is forgiven');
  assert.ok(Math.abs(go({ aim: 8, power: 1.15 }).end.x - plain.end.x) < 0.01 && Math.abs(go({ aim: 8, power: 1.15 }).plan.feet - plain.plan.feet) < 0.01);

  // off line: steered the way the swipe went, and the more the further
  const right = go({ aim: 30, power: 1 });
  const left = go({ aim: -30, power: 1 });
  assert.ok(right.end.x > plain.end.x + 15 && left.end.x < plain.end.x - 15, 'a swipe off to the right sends it right, to the left sends it left');
  assert.ok(go({ aim: 45, power: 1 }).end.x > right.end.x, 'and more off is more');
  assert.ok(Math.abs(G.withSwipe(base, { aim: 59, power: 1 }).swipeAim) <= 25, 'but never wildly');

  // too soft: slower, so shorter
  const soft = go({ aim: 0, power: 0.4 });
  assert.ok(soft.plan.feet < plain.plan.feet * 0.8, `a soft swipe is a shorter throw: ${Math.round(soft.plan.feet)} vs ${Math.round(plain.plan.feet)}`);
  assert.ok(go({ aim: 0, power: 0.1 }).plan.feet > 40 && go({ aim: 0, power: 0.1 }).plan.feet < soft.plan.feet, 'a limp swipe is shorter still, but it still goes somewhere');
  // too hard: it goes loose, graded down
  const hard = G.withSwipe(base, { aim: 0, power: 1.9 });
  assert.ok(hard.sloppy > base.sloppy + 0.4 && ['Loose', 'Shank'].includes(hard.grade) && !hard.pure, `a hard swipe is loose: ${hard.grade}`);
  assert.ok(G.withSwipe({ ...base, pure: true, grade: 'Pure' }, { aim: 0, power: 1 }).pure, 'a pure release with a true swipe stays pure');
  assert.ok(!G.withSwipe({ ...base, pure: true, grade: 'Pure' }, { aim: 20, power: 1 }).pure, 'but not with a swipe off line');
  assert.strictEqual(G.withSwipe({ ...base, slip: 'grip', grade: 'Grip lock' }, { aim: 0, power: 1.9 }).grade, 'Grip lock', 'a slip keeps its name');

  // what a server accepts: the swipe rides along in the execution
  const server = G.sanitizeExecution({ o: 0, pure: false, swipe: { aim: 40, power: 0.5 } });
  assert.ok(server.swipe && server.swipeAim > 0 && server.swipeSpeed < 1, 'the server applies it itself');
  assert.strictEqual(G.sanitizeExecution({ o: 0, swipe: 'junk' }).swipe, undefined, 'and ignores nonsense');
  assert.strictEqual(G.sanitizeExecution({ o: 0 }).swipe, undefined, 'an older page has none');
});

/* ---------- hills ---------- */

// a long straight hole whose ground we describe
async function hill(terrain, extra = {}) {
  const { makeHole } = await load();
  return makeHole({ id: 9, name: 'Hill', par: 4, fairway: [[0, 0, 60], [0, 800, 60]], basket: { x: 0, y: 800 }, wind: { mph: 0, from: 0 }, bounds: { minX: -200, maxX: 200, minY: -80, maxY: 900 }, terrain, ...extra });
}

test('hills: the ground has a height, flat holes are flat, and a hole with no ground described is level', async () => {
  const G = await load();
  const flat = await field();
  assert.strictEqual(G.elevAt(flat, 10, 100), 0, 'a hole with no terrain is level');
  assert.deepStrictEqual(G.slopeAt(flat, 10, 100), { gx: 0, gy: 0 });
  const h = await hill({ rise: [[800, 24]], bowl: 0 });
  assert.ok(Math.abs(G.elevAt(h, 0, 0)) < 0.5, 'the tee is the zero of the height');
  assert.ok(Math.abs(G.elevAt(h, 0, 800) - 24) < 0.5, `the basket is where the profile says: ${G.elevAt(h, 0, 800)}`);
  assert.ok(G.elevAt(h, 0, 400) > 8 && G.elevAt(h, 0, 400) < 16, 'and the ground climbs between');
  assert.ok(G.slopeAt(h, 0, 400).gy > 0.03, 'uphill is positive');
  assert.ok(G.elevAt(h, 150, 400) === G.elevAt(h, -150, 400) || Math.abs(G.elevAt(h, 150, 400) - G.elevAt(h, -150, 400)) < 0.01, 'with no bowl it is the same on either side');
  assert.ok(G.elevAt(await hill({ bowl: 0.1 }), 150, 400) > 5, 'a bowl rises away from the fairway');
  // a mound is a hill, a hollow is a hollow
  const m = await hill({ bowl: 0, mounds: [{ x: 0, y: 300, r: 30, h: 8 }, { x: 0, y: 500, r: 30, h: -6 }] });
  assert.ok(G.elevAt(m, 0, 300) > 6 && G.elevAt(m, 0, 500) < -4 && Math.abs(G.elevAt(m, 0, 400)) < 1);
  // a flat hole's flight has z = h, as before
  const pts = G.samplePath({ headingDeg: 0, feet: 200, lat: [0, 0, 0], apex: 30 }, { x: 0, y: 0 }, 72, flat);
  assert.ok(pts.every((p) => p.z === p.h) && pts.length === 73 && Math.abs(pts.at(-1).y - 200) < 1e-6);
});

test('hills: a disc flies farther downhill and shorter uphill, and rolls on downhill', async () => {
  const G = await load();
  const level = await hill({ bowl: 0 });
  const up = await hill({ rise: [[800, 40]], bowl: 0 });
  const down = await hill({ rise: [[800, -40]], bowl: 0 });
  const steepUp = await hill({ rise: [[800, 160]], bowl: 0 });
  const steepDown = await hill({ rise: [[800, -160]], bowl: 0 });
  const throwIt = (hole, disc = DRIVER, mph = 62) => G.resolveThrow(hole, disc, { ...RIGHT, mph }, 0, CLEAN, { x: 0, y: 0 });
  const [l, u, d] = [level, up, down].map((h) => throwIt(h));
  assert.ok(l.kind === 'landed' && u.kind === 'landed' && d.kind === 'landed');
  assert.ok(d.lie.y > l.lie.y + 10, `downhill is farther: ${Math.round(d.lie.y)} vs ${Math.round(l.lie.y)}`);
  assert.ok(u.lie.y < l.lie.y - 10, `uphill is shorter: ${Math.round(u.lie.y)} vs ${Math.round(l.lie.y)}`);
  // every point of a flight is above the ground, and it ends on it
  for (const r of [u, d]) {
    const h = r === u ? up : down;
    for (const p of r.pts) assert.ok(p.h >= 0 && Math.abs(p.z - p.h - G.elevAt(h, p.x, p.y)) < 0.01, 'h is height above the ground, z above the tee');
    assert.strictEqual(r.pts.at(-1).h, 0);
    assert.ok(r.pts.length === 73, 'always the same number of points');
  }
  // the same on a slope, the roll goes with the hill
  const slow = (h) => G.resolveThrow(h, PUTTER, { ...RIGHT, mph: 30 }, 0, CLEAN, { x: 0, y: 0 });
  const [rl, ru, rd] = [level, steepUp, steepDown].map(slow);
  const rolled = (r) => G.distance(r.pts.at(-1), r.lie);
  assert.ok(rolled(rd) > rolled(rl) && rolled(ru) <= rolled(rl) + 1e-9, `it runs on downhill (${rolled(rd).toFixed(1)}), stops short uphill (${rolled(ru).toFixed(1)}), level is ${rolled(rl).toFixed(1)}`);
});

test('hills: a ridge in the way stops the disc short, and a tree on a hill is higher up', async () => {
  const G = await load();
  const level = await hill({ bowl: 0 });
  const ridge = await hill({ bowl: 0, mounds: [{ x: 0, y: 220, r: 40, h: 70 }] });
  const at = (h) => G.resolveThrow(h, DRIVER, { ...RIGHT, mph: 62 }, 0, CLEAN, { x: 0, y: 0 });
  const flatR = at(level);
  const ridged = at(ridge);
  assert.ok(ridged.lie.y < flatR.lie.y - 40, `it comes down on the far side of the ridge, or on it: ${Math.round(ridged.lie.y)} vs ${Math.round(flatR.lie.y)}`);
  assert.ok(ridged.pts.length === 73 && ridged.pts.every((p) => p.h >= 0));
  // a tree stands on the ground it grows from, and the disc has to be above that ground plus its height
  const knoll = await hill({ bowl: 0, mounds: [{ x: 0, y: 150, r: 30, h: 30 }] }, { trees: [{ x: 0, y: 150, r: 4, h: 20, k: 'p' }] });
  assert.ok(G.elevAt(knoll, 0, 150) > 25, 'there is a knoll');
  const tall = knoll.trees[0];
  assert.ok(tall.z > 25, `the tree is up on it: ${tall.z}`);
});

test('hills: every hole of the course has relief, and none is a cliff you cannot play', async () => {
  const G = await load();
  let steep = 0;
  for (const h of [...G.HOLES, ...G.HOLES2]) {
    assert.ok(h.field, `${h.id}: has ground`);
    const along = h.route.pts.map(([x, y]) => G.elevAt(h, x, y));
    const spread = Math.max(...along) - Math.min(...along);
    assert.ok(spread >= 4, `${h.id} (${h.name}): there are hills to play: ${spread.toFixed(1)} ft`);
    assert.ok(spread <= 40, `${h.id}: but not mountains: ${spread.toFixed(1)} ft`);
    for (const [x, y] of h.route.pts) {
      const s = G.slopeAt(h, x, y);
      steep = Math.max(steep, Math.hypot(s.gx, s.gy));
      assert.ok(Math.hypot(s.gx, s.gy) < 0.35, `${h.id}: the fairway is never steeper than about 1 in 3: ${Math.hypot(s.gx, s.gy).toFixed(2)} at ${Math.round(x)},${Math.round(y)}`);
    }
    // the tee and the basket sit on level ground
    for (const p of [h.tee, h.basket]) assert.ok(Math.hypot(G.slopeAt(h, p.x, p.y).gx, G.slopeAt(h, p.x, p.y).gy) < 0.12, `${h.id}: level-ish at the tee and basket`);
    // water is level and the land is cut to it
    h.water.forEach((poly, k) => {
      assert.ok(Number.isFinite(h.waterLevel[k]), `${h.id}: water ${k} has a level`);
      const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      if (G.surfaceAt(h, c[0], c[1]) === 'water') assert.ok(Math.abs(G.elevAt(h, c[0], c[1]) - h.waterLevel[k]) < 0.6, `${h.id}: the ground in the pond is at its level`);
    });
    // no cell of the grid is a cliff, except the ones a hole makes on purpose
    const f = h.field;
    let worst = 0;
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx - 1; i++) worst = Math.max(worst, Math.abs(f.z[j * f.nx + i + 1] - f.z[j * f.nx + i]));
    for (let j = 0; j < f.ny - 1; j++) for (let i = 0; i < f.nx; i++) worst = Math.max(worst, Math.abs(f.z[(j + 1) * f.nx + i] - f.z[j * f.nx + i]));
    assert.ok(worst < (h.id === 7 ? 14 : 9), `${h.id}: no sheer step between neighbours: ${worst.toFixed(1)} ft`);
  }
  assert.ok(steep > 0.1, 'and some are properly steep');
});

test('hills: putting uphill is easier and needs more push, downhill is harder and runs away', async () => {
  const G = await load();
  const level = await hill({ bowl: 0 });
  const up = await hill({ bowl: 0, mounds: [{ x: 0, y: 800, r: 60, h: 10 }] }); // the basket on a rise
  const down = await hill({ bowl: 0, mounds: [{ x: 0, y: 800, r: 60, h: -10 }] }); // and in a hollow
  // a putt from 40 feet short of the basket
  const spot = (h) => ({ x: 0, y: 760 });
  const rise = (h) => G.riseTo(h, spot(h));
  assert.ok(Math.abs(rise(level)) < 0.01 && rise(up) > 2 && rise(down) < -2, `${rise(up)} ${rise(down)}`);
  assert.ok(G.puttDist(up, spot(up)) < G.puttDist(level, spot(level)) && G.puttDist(down, spot(down)) > G.puttDist(level, spot(level)));
  assert.ok(G.puttPush(up, spot(up)) > 41 && G.puttPush(down, spot(down)) < 39, 'an uphill putt has to be hit harder, a downhill one softer');
  const PUT = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
  const zone = (h) => G.resolvePutt(h, spot(h), PUT, 0.5, 1).radius;
  assert.ok(zone(up) > zone(level) && zone(down) < zone(level), 'the target is bigger uphill and smaller downhill');
  assert.ok(G.resolvePutt(up, spot(up), PUT, 0, 1).rise > 0 && G.resolvePutt(down, spot(down), PUT, 5, 1).rise < 0, 'the result says which way it was');
  // a level hole behaves as it always did
  const lone = G.resolvePutt(level, spot(level), PUT, 0.5, 1);
  assert.strictEqual(lone.dist, 40);
  assert.ok(Math.abs(G.puttDist(level, spot(level)) - 40) < 1e-9 && Math.abs(G.puttPush(level, spot(level)) - 40) < 1e-9);
  // downhill, a miss runs away more often
  const nasties = (h) => { let n = 0; for (let i = 0; i < 100; i++) if (G.resolvePutt(h, spot(h), PUT, { x: 0.6, y: 0.5 }, i / 100).nasty) n++; return n; };
  assert.ok(nasties(down) > nasties(level), `${nasties(down)} vs ${nasties(level)}`);
});

test('Marebear switched off takes no disc, even at a triple bogey', async () => {
  const G = await load();
  const hole = { par: 3, tee: { x: 0, y: 0 }, basket: { x: 0, y: 300 } };
  const landed = (n) => ({ kind: 'landed', strokes: 1, lie: { x: 0, y: n * 10 }, plan: { feet: 100 } });
  for (const bear of [true, false]) {
    const round = G.newRound(hole);
    const outs = [];
    for (let i = 1; i <= 7; i++) outs.push(G.applyResult(round, { id: i }, landed(i), { bear }));
    assert.strictEqual(outs.some((o) => o.bear), bear, `bear ${bear}`);
    assert.strictEqual(round.eaten.length, bear ? 1 : 0);
  }
});

test('short putts are forgiving: inside 25 feet they go in unless you really mess up, and the long ones are as hard as they were', async () => {
  const G = await load();
  const P = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
  assert.ok(G.puttRadius(10, P) >= 0.45, `half the green at 10 ft: ${G.puttRadius(10, P)}`);
  assert.ok(G.puttRadius(20, P) >= 0.3 && G.puttRadius(25, P) >= 0.22, 'and still a good target at 20 and 25');
  assert.ok(G.puttRadius(5, P) <= 0.95, 'never more than the whole green');
  assert.ok(G.puttRadius(10, P) > G.puttRadius(20, P) && G.puttRadius(20, P) > G.puttRadius(30, P), 'smaller as it gets longer');
  assert.ok(G.puttRadius(40, P) < 0.08, 'a 40 footer is still a long shot');
  assert.ok(G.swipeTolerance(10).aim >= 13 && G.swipeTolerance(10).power >= 0.28, 'a wide swipe is fine close in');
  assert.ok(G.swipeTolerance(50).aim <= 3.3 && G.swipeTolerance(50).power <= 0.1 + 1e-9, 'the same as before from 50 ft');
  // inside 10 ft about 95% go in (a tap at a random moment, a sloppy swipe), and 10 to 15 ft is 90 to 95%
  assert.ok(G.puttRadius(10, P) >= 0.93 && G.puttRadius(15, P) >= 0.8 && G.puttRadius(15, P) < G.puttRadius(10, P), 'a big target out to 15 ft');
  assert.ok(G.swipeTolerance(10).aim >= 25 && G.swipeTolerance(10).power >= 0.49, 'and a very wide swipe');
  // a putt from 12 ft with the dot in the middle third and a sloppy-but-honest swipe goes in
  const hole = await (async () => { const { makeHole } = await load(); return makeHole({ id: 9, name: 'T', par: 3, fairway: [[0, 0, 60], [0, 300, 60]], basket: { x: 0, y: 300 }, wind: { mph: 0, from: 0 } }); })();
  const spot = { x: 0, y: 288 };
  assert.ok(G.resolvePutt(hole, spot, P, { x: 0.3, y: -0.2 }, 1, { aim: 9, power: 1.2 }).made, 'off line by 9 degrees and 20% hard: still in');
  assert.ok(!G.resolvePutt(hole, spot, P, { x: 0, y: 0 }, 1, { aim: 40, power: 1 }).made, 'but really off line misses');
  assert.ok(!G.resolvePutt(hole, spot, P, { x: 0, y: 0 }, 1, { aim: 0, power: 0.3 }).made, 'and a dead soft swipe');
});

test('a missed putt never ends up behind where it was thrown from, and a short miss stays near the basket', async () => {
  const G = await load();
  const P = { id: 4, speed: 3, glide: 3, turn: 0, fade: 1 };
  const hole = await (async () => { const { makeHole } = await load(); return makeHole({ id: 9, name: 'T', par: 3, fairway: [[0, 0, 60], [0, 300, 60]], basket: { x: 0, y: 300 }, wind: { mph: 0, from: 0 } }); })();
  for (const dist of [4, 6, 9, 14, 20, 28]) {
    const from = { x: 0, y: 300 - dist };
    for (const shot of [{ x: 0, y: -1 }, { x: 0.4, y: -0.9 }, { x: -0.9, y: -0.5 }, { x: 0, y: 1 }, { x: 1, y: 0 }]) {
      for (const swipe of [{ aim: 0, power: 0.3 }, { aim: 30, power: 1 }, { aim: 0, power: 2.2 }, { aim: -45, power: 0.5 }]) {
        for (const roll of [1, 0]) {
          const r = G.resolvePutt(hole, from, P, shot, roll, swipe);
          if (r.made) continue;
          const behind = r.lie.y - from.y; // up the hole is positive: a negative number is behind the thrower
          assert.ok(behind >= -0.01, `${dist} ft, shot ${JSON.stringify(shot)}, swipe ${JSON.stringify(swipe)}${roll ? '' : ' nasty'}: it ended ${(-behind).toFixed(1)} ft behind the thrower`);
          if (!r.nasty) assert.ok(G.distance(r.lie, hole.basket) <= 3 + dist * 0.6 + 0.01, `a ${dist} ft miss stays near the basket: ${G.distance(r.lie, hole.basket).toFixed(1)} ft`);
        }
      }
    }
  }
});
