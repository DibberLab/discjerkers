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

test('the meters: power, spin and angle set the throw; the release is graded', async () => {
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
  assert.strictEqual(G.spinAt(0), 400);
  assert.strictEqual(G.spinAt(1), 1600);
  assert.strictEqual(G.spinAt(0.5) % 50, 0);
  assert.strictEqual(G.angleAt(-1), -6);
  assert.strictEqual(G.angleAt(0), 0);
  assert.strictEqual(G.angleAt(1), 6);
  assert.strictEqual(G.angleAt(0.5), 3);
  assert.strictEqual(G.angleAt(7), 6, 'never past the ends');
  // the typical-spin tick sits where a typical throw at that speed would put it
  assert.strictEqual(G.spinAt(G.spinPos(60)), 900);
  assert.ok(G.spinPos(40) < G.spinPos(80));
  // every bar has its own speed
  assert.strictEqual(new Set([G.METER.power.period, G.METER.spin.period, G.METER.angle.period]).size, 3);
  assert.strictEqual(G.needleAt(0, G.METER.spin.period), -1);

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
              for (let mph = 12; mph <= 86; mph += 8) {
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
    assert.ok(strokes <= hole.par, `hole ${hole.id} (${hole.name}) can be played in par: ${strokes} vs ${hole.par}`);
  }
});

test('the woods are solid: you cannot just throw any way from the tee, the fairway is the way', async () => {
  const G = await load();
  let off = 0;
  let through = 0;
  for (const hole of G.HOLES) {
    const first = G.headingTo(hole.tee, G.routeAhead(hole, hole.tee.x, hole.tee.y, 150)); // down the hole
    for (let aim = 0; aim < 360; aim += 6) {
      const away = Math.abs(((aim - first + 540) % 360) - 180);
      if (away < 75) continue; // along the hole is fair
      for (const mph of [40, 62, 80]) {
        const r = G.resolveThrow(hole, DRIVER, { ...RIGHT, mph }, aim, CLEAN, hole.tee);
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
  const good = { hand: 'right', style: 'backhand', mph: 62, spin: null, angle: 0 };
  assert.deepStrictEqual(G.sanitizeSettings(good), good);
  assert.deepStrictEqual(G.sanitizeSettings({ ...good, spin: 1100, mph: 10, angle: -6 }), { ...good, spin: 1100, mph: 10, angle: -6 });
  for (const bad of [null, 'x', { ...good, hand: 'both' }, { ...good, style: 'sidearm' }, { ...good, mph: 63 }, { ...good, mph: 94 }, { ...good, mph: 8 }, { ...good, mph: 'fast' }, { ...good, angle: 7 }, { ...good, angle: 1.5 }, { ...good, spin: 100 }, { ...good, spin: 5000 }, { ...good, spin: 'lots' }]) {
    assert.strictEqual(G.sanitizeSettings(bad), null, JSON.stringify(bad));
  }
  assert.strictEqual(G.sanitizeExecution({ o: 9 }).o, 1, 'clamped');
  assert.strictEqual(G.sanitizeExecution({ o: -9 }).o, -1);
  assert.strictEqual(G.sanitizeExecution({ o: 'abc' }).o, 0);
  assert.ok(G.sanitizeExecution({ o: 0, pure: true }).pure);
  assert.ok(!G.sanitizeExecution({ o: 0.3, pure: true }).pure, 'a sloppy release cannot claim to be pure');
  assert.strictEqual(G.sanitizeExecution({ o: 0.9 }).grade, 'Shank');
});


test('the settings the meters choose change the flight: faster, more spin, and the angle', async () => {
  const G = await load();
  const hole = await field();
  const go = (t) => G.resolveThrow(hole, DRIVER, { ...RIGHT, ...t }, 0, CLEAN, { x: 0, y: 0 });
  const flat = go({});
  assert.ok(go({ mph: 80 }).plan.feet > go({ mph: 50 }).plan.feet + 40, 'the power meter is the arm speed');
  assert.ok(go({ angle: 5 }).end.x < flat.end.x - 5, 'the angle meter tips it onto hyzer: left for a right-hand backhand');
  assert.ok(go({ angle: -5 }).end.x > flat.end.x + 5, 'and flatter goes the other way');
  assert.ok(go({ angle: 5 }).plan.feet < flat.plan.feet);
  assert.ok(go({ spin: 400 }).plan.feet < go({ spin: 1400 }).plan.feet || go({ spin: 400 }).end.x !== go({ spin: 1400 }).end.x, 'the spin meter changes the flight');
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
  assert.ok(chance(DRIVER, 40, { spin: 1500 }) > chance(DRIVER, 40), 'a spin far from the usual adds to it');
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
  const base = { hand: 'right', style: 'backhand', mph: null, spin: null, angle: 0 };
  const power = G.sweetSpots(hole, DRIVER, base, 0, from, 'power');
  const okMph = power.values.filter((_, i) => power.ok[i]);
  assert.ok(okMph.length > 0 && okMph.length < power.values.length / 2, 'a stretch of speeds, not all of them');
  assert.ok(!okMph.includes(10) && !okMph.includes(90), 'neither a limp throw nor a full send reaches a basket 330 ft out');
  assert.ok(power.best < 60, 'some arm speed gets within a putt of it');
  const bands = G.sweetBands(power);
  assert.ok(bands.length >= 1 && bands.every((b) => b.from >= 0 && b.to <= 1 && b.to > b.from));
  // the bar position round-trips with what the bar reads
  for (const mph of [10, 30, 50, 62, 78, 90]) assert.strictEqual(G.mphAt(G.powerPos(mph)), mph);

  // later bars narrow it: with the arm speed chosen, the spin band depends on that speed
  const mph = okMph[Math.floor(okMph.length / 2)];
  const spin = G.sweetSpots(hole, DRIVER, { ...base, mph }, 0, from, 'spin');
  assert.ok(spin.ok.some(Boolean) && spin.best <= power.best + 20);
  const tooSoft = G.sweetSpots(hole, DRIVER, { ...base, mph: 30 }, 0, from, 'spin');
  assert.ok(tooSoft.best > spin.best + 50, 'a speed that is wrong for the distance has no good spin');

  // the angle bar: with speed and spin chosen, the best angle is a real one and the flat throw's miss shows up
  const angle = G.sweetSpots(hole, DRIVER, { ...base, mph, spin: 900 }, 0, from, 'angle');
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
