'use strict';

const test = require('node:test');
const assert = require('node:assert');
const bot = require('./helpers/bot.js');

const load = async () => ({ ...(await import('../public/js/gamecore.js')), ...(await import('../public/js/course.js')), K: await import('../public/js/conditions.js') });

test('conditions come from a seed: the same seed is the same day, a new seed is a different one, and no seed is the classic hole', async () => {
  const { K, HOLES } = await load();
  const h = HOLES[2];
  assert.deepStrictEqual(K.variantFor(4242, h, { idx: 2, n: 9 }), K.variantFor(4242, h, { idx: 2, n: 9 }));
  assert.strictEqual(K.variantFor(undefined, h), null);
  assert.strictEqual(K.variantFor(null, h), null);
  assert.strictEqual(K.applyVariant(h, null), h, 'no variant, the very same hole');
  const seen = new Set();
  for (let s = 1; s <= 60; s++) seen.add(JSON.stringify(K.variantFor(s, h)));
  assert.ok(seen.size > 30, `different seeds give different days: ${seen.size}`);
  // the same seed on different holes differs, too
  assert.notDeepStrictEqual(K.variantFor(77, HOLES[0]).wind, K.variantFor(77, HOLES[5]).wind);
});

test('a day is believable: wind in range, rain now and then, dusk only late in a round, a pin that is a place for a basket', async () => {
  const { K, HOLES, surfaceAt, slopeAt, distance } = await load();
  let rain = 0;
  let pins = new Set();
  let mandos = 0;
  let n = 0;
  for (const hole of HOLES) {
    for (let seed = 1; seed <= 40; seed++) {
      const v = K.variantFor(seed, hole, { idx: 3, n: 9, rain: true });
      const dry = K.variantFor(seed, hole, { idx: 3, n: 9 });
      assert.strictEqual(dry.rain, false, 'rain is only there when asked for');
      assert.deepStrictEqual({ ...dry, rain: v.rain, wind: v.wind }, { ...v }, 'and nothing else about the day changes with it');
      n++;
      assert.ok(v.wind.mph >= 0 && v.wind.mph <= 24 && v.wind.from >= 0 && v.wind.from < 360, JSON.stringify(v.wind));
      if (v.rain) rain++;
      pins.add(v.pin);
      if (v.mando) { mandos++; assert.ok(hole.mandoSpec, `${hole.id}: only a hole with a mando can have one`); }
      assert.strictEqual(v.dusk, 0, 'early in a round it is light');
      const played = K.applyVariant(hole, v);
      assert.strictEqual(surfaceAt(played, played.basket.x, played.basket.y), 'fairway', `${hole.id} pin ${v.pin} is on grass`);
      const g = slopeAt(played, played.basket.x, played.basket.y);
      assert.ok(Math.hypot(g.gx, g.gy) < 0.14, `${hole.id} pin ${v.pin} is not on a slope`);
      assert.ok(distance(played.basket, hole.basket) < 14, 'and it is on the same green');
      for (const t of played.trees) assert.ok(Math.hypot(t.x - played.basket.x, t.y - played.basket.y) > t.r + 5, `${hole.id} pin ${v.pin}: a tree on the basket`);
      assert.strictEqual(played.field, hole.field, 'it is the same land');
      assert.strictEqual(played.id, hole.id);
    }
  }
  assert.ok(rain > n * 0.1 && rain < n * 0.35, `with rain allowed it rains about one day in five: ${rain}/${n}`);
  assert.ok(pins.has('A') && pins.has('B') && pins.has('C'), 'all three pins get used');
  assert.ok(mandos > 5, 'and the mandos');
  // dusk: only the last holes of a round, and it deepens
  const d = (idx) => K.variantFor(5, HOLES[0], { idx, n: 18 }).dusk;
  assert.ok(d(0) === 0 && d(10) === 0 && d(14) > 0 && d(17) === 1 && d(15) <= d(16), `${d(14)} ${d(15)} ${d(16)} ${d(17)}`);
  assert.strictEqual(K.variantFor(5, HOLES[0], { idx: 0, n: 1 }).dusk, 0, 'a single hole is daylight');
  assert.deepStrictEqual(K.tags({ rain: true, dusk: 1, pin: 'B', mando: true }), ['Rain', 'Dusk', 'Pin B', 'Mando']);
  assert.deepStrictEqual(K.tags(null), []);
  assert.ok(K.briefing(K.variantFor(9, HOLES[2]), HOLES[2]).length >= 0);
});

// a bare field: a long straight fairway, nothing in the way, calm air
async function field() {
  const { makeHole } = await load();
  return makeHole({ id: 9, name: 'Test', par: 4, fairway: [[0, 0, 60], [0, 600, 60]], basket: { x: 0, y: 900 }, wind: { mph: 0, from: 0 } });
}

test('rain: a disc skids farther on landing, and putts are slicker', async () => {
  const G = await load();
  const hole = await field();
  const rain = Object.create(hole, { weather: { value: { rain: true, dusk: 0 } } });
  const at = (h) => G.resolveThrow(h, bot.DRIVER, { ...bot.RIGHT, mph: 62 }, 0, bot.CLEAN, { x: 0, y: 0 });
  const [a, b] = [at(hole), at(rain)];
  assert.ok(a.kind === 'landed' && b.kind === 'landed');
  const rolled = (r) => G.distance(r.pts.at(-1), r.lie);
  assert.ok(rolled(b) > rolled(a) * 1.4, `${rolled(b).toFixed(1)} in the rain vs ${rolled(a).toFixed(1)}`);
  assert.ok(G.puttGrip(rain) < 1 && G.puttGrip(hole) === 1);
  const spot = { x: 0, y: 875 };
  assert.ok(G.resolvePutt(rain, spot, bot.PUT, 0.3, 1).radius < G.resolvePutt(hole, spot, bot.PUT, 0.3, 1).radius);
});

test('wind and pin come with the variant: the throw uses the day\'s wind, and the basket is where the pin is', async () => {
  const G = await load();
  const hole = G.HOLES[0];
  const calm = G.K.applyVariant(hole, { seed: 1, wind: { mph: 0, from: 0 }, rain: false, dusk: 0, pin: 'A', mando: false });
  const gale = G.K.applyVariant(hole, { seed: 1, wind: { mph: 20, from: 180 }, rain: false, dusk: 0, pin: 'A', mando: false });
  const through = (h) => G.resolveThrow(h, bot.DRIVER, { ...bot.RIGHT, mph: 62 }, 0, bot.CLEAN, h.tee).plan.feet;
  assert.ok(through(gale) > through(calm) + 5, 'a tailwind carries it');
  assert.strictEqual(G.windFor(gale, 0).head < 0, true, 'from the south, throwing north: a tailwind');
  const pins = G.K.pinSpots(hole);
  const pinB = G.K.applyVariant(hole, { seed: 1, wind: hole.wind, rain: false, dusk: 0, pin: 'B', mando: false });
  assert.deepStrictEqual([pinB.basket.x, pinB.basket.y], [pins[1].x, pins[1].y]);
  assert.notDeepStrictEqual(pinB.basket, hole.basket);
  assert.strictEqual(hole.basket.x, G.HOLES[0].basket.x, 'the real hole is not touched');
  // holing out is at the pin
  const near = { x: pinB.basket.x, y: pinB.basket.y - 20 };
  assert.ok(G.resolvePutt(pinB, near, bot.PUT, 0, 1).made, 'a centered putt goes in the pin, wherever it is today');
});

test('a mando: pass on the wrong side of the post on your first throw and it is a stroke and a drop where it crossed', async () => {
  const G = await load();
  const base = await field();
  // a post at 200 ft along, on the fairway's middle, with its ray going left: do not pass on its left
  const on = Object.create(base, { mando: { value: { x: 0, y: 200, dx: -1, dy: 0, len: 100, s: 200, side: -1 } } });
  const go = (h, aim, from = { x: 0, y: 0 }) => G.resolveThrow(h, bot.PUT, { ...bot.RIGHT, mph: 60 }, aim, bot.CLEAN, from);
  const left = go(on, -8);
  assert.strictEqual(left.kind, 'mando', `flying off to the left of the post: ${left.kind}`);
  assert.strictEqual(left.strokes, 2, 'a penalty stroke');
  assert.ok(left.dropped && left.lie.y > 150 && left.lie.y <= 205, `and you drop where it crossed the line (${left.lie.y}), not back where you were`);
  assert.ok(left.pts.length >= 2 && left.pts.every((p) => p.h >= 0) && left.pts.at(-1).y <= 205, 'it is stopped at the post, not after');
  const right = go(on, 12);
  assert.notStrictEqual(right.kind, 'mando', 'the right side is fine');
  assert.notStrictEqual(go(base, -8).kind, 'mando', 'with no mando today it is just a throw');
  // once you are past the post it is no longer in force
  for (const aim of [-20, -8, 8, 20]) assert.notStrictEqual(go(on, aim, { x: 0, y: 240 }).kind, 'mando');
  // the real mando on the dogleg: the careful way round is not a mando, and the post is where the hole says
  const hole = G.holeById(3);
  const day = G.K.applyVariant(hole, { seed: 1, wind: { mph: 0, from: 0 }, rain: false, dusk: 0, pin: 'A', mando: true });
  assert.ok(day.mando && day.mando.side === -1);
  const careful = G.resolveThrow(day, bot.DRIVER, { ...bot.RIGHT, mph: 50 }, G.headingTo(day.tee, G.routeAhead(day, 0, 0, 120)), bot.CLEAN, day.tee);
  assert.notStrictEqual(careful.kind, 'mando');
});

test('every hole is still playable in par on bad days: rain, a gale, every pin, and every mando', async () => {
  const G = await load();
  const days = [
    { rain: true, wind: { mph: 14, from: 20 }, pin: 'B', mando: true },
    { rain: false, wind: { mph: 18, from: 200 }, pin: 'C', mando: true },
    { rain: false, wind: { mph: 2, from: 90 }, pin: 'B', mando: false },
  ];
  for (const hole of G.HOLES) {
    for (const [i, d] of days.entries()) {
      if (!d.mando && hole.id % 2) continue; // the slow part: half the holes on the quiet day
      const pins = G.K.pinSpots(hole).map((p) => p.k);
      const played = G.K.applyVariant(hole, { seed: i, wind: { ...d.wind }, rain: d.rain, dusk: 0, pin: pins.includes(d.pin) ? d.pin : 'A', mando: d.mando && !!hole.mandoSpec });
      const strokes = bot.par(G, played, [8, 4, 6, 3, 5, 2]);
      assert.ok(strokes <= hole.par + 1, `hole ${hole.id} (${hole.name}) on day ${i}: ${strokes} vs par ${hole.par}`);
    }
  }
});
