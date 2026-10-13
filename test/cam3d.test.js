'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = async () => ({ C: await import('../public/js/cam3d.js'), course: await import('../public/js/course.js'), G: await import('../public/js/gamecore.js') });

test('the camera: what is straight ahead lands in the middle, and what is behind is not drawn', async () => {
  const { C } = await load();
  const cam = C.newCamera(0, 0, 6, 0, 0); // looking north
  const view = C.viewOf(400, 800, cam);
  const ahead = C.project(cam, view, 0, 100, 6);
  assert.ok(Math.abs(ahead.x - 200) < 0.01 && Math.abs(ahead.y - view.cy) < 0.01, 'straight ahead and level is the middle of the picture');
  assert.strictEqual(C.project(cam, view, 0, -50, 6), null, 'behind the camera');
  const right = C.project(cam, view, 30, 100, 6);
  const left = C.project(cam, view, -30, 100, 6);
  assert.ok(right.x > ahead.x && left.x < ahead.x, 'east is on the right when looking north');
  const high = C.project(cam, view, 0, 100, 30);
  assert.ok(high.y < ahead.y, 'higher is higher on the screen');
  const near = C.project(cam, view, 0, 20, 0);
  const far = C.project(cam, view, 0, 200, 0);
  assert.ok(near.y > far.y && near.s > far.s, 'the ground slopes up toward the horizon, and near things are bigger');
  // turn to look east: east is now ahead
  const east = C.newCamera(0, 0, 6, Math.PI / 2, 0);
  const e = C.project(east, C.viewOf(400, 800, east), 100, 0, 6);
  assert.ok(e && Math.abs(e.x - 200) < 0.01);
});

test('a ground shape that crosses the camera is cut at the near plane, not smeared across the screen', async () => {
  const { C } = await load();
  const poly = [[-50, 5, 10], [50, 5, 10], [50, -5, -10], [-50, -5, -10]]; // half in front, half behind
  const out = C.clipNear(poly);
  assert.ok(out.length >= 3);
  assert.ok(out.every((p) => p[2] >= 1 - 1e-9), 'nothing behind the near plane is left');
  assert.deepStrictEqual(C.clipNear([[0, 0, -5], [1, 0, -6], [0, 1, -7]]), [], 'a shape wholly behind goes away');
  assert.strictEqual(C.clipNear([[0, 0, 5], [1, 0, 6], [0, 1, 7]]).length, 3, 'a shape wholly in front is untouched');
});

test('the chase camera settles behind a disc, looks where it is going, and does not snap', async () => {
  const { C } = await load();
  const dir = { x: 0, y: 1 };
  const cam = C.startCamera({ x: 0, y: 0 }, dir);
  assert.ok(cam.y < 0 && cam.z > 4, 'it starts behind and above the thrower');
  let disc = { x: 0, y: 0, h: 5 };
  for (let i = 0; i < 240; i++) { disc = { x: 0, y: i * 2, h: 20 }; C.follow(cam, disc, dir, 1 / 60); }
  assert.ok(disc.y - cam.y > 15 && disc.y - cam.y < 45, `it trails the disc by a sensible distance: ${Math.round(disc.y - cam.y)} ft`);
  assert.ok(Math.abs(cam.yaw) < 0.05, 'and looks straight down the flight');
  // the disc swings east: the camera turns that way, a bit at a time
  const before = cam.yaw;
  C.follow(cam, { x: 0, y: 480, h: 20 }, { x: 1, y: 0 }, 1 / 60);
  assert.ok(cam.yaw > before && cam.yaw < Math.PI / 4, 'it starts to turn east, not all at once');
});

test('a disc is found along its path, from the start to the end of the flight', async () => {
  const { C } = await load();
  const pts = Array.from({ length: 73 }, (_, i) => ({ x: i, y: i * 5, h: 30 * Math.sin((i / 72) * Math.PI) }));
  const start = C.discAt(pts, 0);
  const end = C.discAt(pts, 1);
  assert.deepStrictEqual([start.pos.x, start.pos.y], [0, 0]);
  assert.ok(Math.abs(end.pos.x - 72) < 1e-6 && Math.abs(end.pos.y - 360) < 1e-6);
  const mid = C.discAt(pts, 0.5);
  assert.ok(mid.pos.y > 100 && mid.pos.y < 360);
  assert.ok(Math.abs(Math.hypot(mid.dir.x, mid.dir.y) - 1) < 1e-6, 'a direction that is a unit');
});

test('every hole draws from the tee and from out in the fairway without a hitch', async () => {
  const { C, course, G } = await load();
  // a canvas that accepts anything and remembers how much was asked of it
  let calls = 0;
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => grad : () => { calls++; }), set: () => true });
  for (const hole of course.HOLES) {
    for (const along of [0, 150, 300]) {
      const at = course.routeAhead(hole, 0, 0, along);
      const ahead = course.routeAhead(hole, at.x, at.y, 60);
      const dir = { x: ahead.x - at.x, y: ahead.y - at.y };
      const l = Math.hypot(dir.x, dir.y) || 1;
      const cam = C.startCamera(at, { x: dir.x / l, y: dir.y / l });
      const view = C.viewOf(390, 780, cam, 280);
      assert.doesNotThrow(() => C.drawScene(ctx, { hole, cam, view, disc: { x: at.x + dir.x, y: at.y + dir.y, h: 12 }, trail: [{ x: at.x, y: at.y, h: 4 }, { x: at.x + dir.x, y: at.y + dir.y, h: 12 }], color: '#38c8e8', t: 1234, splash: { at: { x: at.x, y: at.y }, age: 0.4 }, shake: 3 }), `hole ${hole.id} at ${along}`);
    }
  }
  assert.ok(calls > 5000, `something was actually drawn: ${calls}`);
  assert.ok(G.PUTT_RANGE > 0);
});

test('no camera position crashes the scene: near the basket, over water, inside trees, looking any way', async () => {
  const { C, course } = await load();
  let calls = 0;
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => grad : () => { calls++; }), set: () => true });
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (const hole of course.HOLES) {
    const spots = [hole.basket, hole.tee, ...hole.trees.slice(0, 6), ...hole.water.map((w) => ({ x: w[0][0], y: w[0][1] }))];
    for (const at of spots) {
      for (let k = 0; k < 6; k++) {
        const cam = C.newCamera(at.x + (rnd() - 0.5) * 12, at.y + (rnd() - 0.5) * 12, rnd() * 60, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.4, 0.5 + rnd());
        cam.roll = (rnd() - 0.5) * 0.3;
        const view = C.viewOf(380, 780, cam, rnd() * 300);
        assert.doesNotThrow(() => C.drawScene(ctx, { hole, cam, view, disc: { x: at.x, y: at.y, h: rnd() * 40 }, trail: [{ x: at.x, y: at.y, h: 3 }, { x: at.x + 5, y: at.y + 5, h: 9 }], color: '#fff', t: rnd() * 5000, splash: { at, age: rnd() }, shake: rnd() * 6 }), `hole ${hole.id} near ${Math.round(at.x)},${Math.round(at.y)}`);
      }
    }
  }
  assert.ok(calls > 1000);
});

test('hills in 3D: things stand on the ground, the chase camera rides the land and never goes under it', async () => {
  const { C, course } = await load();
  const hole = course.holeById(2); // uphill to the basket
  assert.ok(C.groundAt(hole, hole.basket.x, hole.basket.y) > 8, 'the basket is up the hill');
  assert.strictEqual(C.groundAt({ ...hole, field: undefined }, hole.basket.x, hole.basket.y), 0, 'no ground described, no height');
  const ground = (x, y) => C.groundAt(hole, x, y);
  const along = (s) => course.routeAhead(hole, 0, 0, s);
  const a = along(0);
  const b = along(60);
  const dir = { x: (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y), y: (b.y - a.y) / Math.hypot(b.x - a.x, b.y - a.y) };
  const cam = C.startCamera(a, dir, ground(a.x, a.y));
  assert.ok(Math.abs(cam.z - (ground(cam.x, cam.y) + 6.5)) < 12, 'it starts above the ground');
  // fly a disc up the hill at a low height: the camera is lifted by the land and stays above it
  for (let i = 0; i < 300; i++) {
    const p = along(i);
    const g = ground(p.x, p.y);
    C.follow(cam, { x: p.x, y: p.y, h: 2, g }, dir, 1 / 60, { ground });
    assert.ok(cam.z >= ground(cam.x, cam.y) + 3.4, `above the land at step ${i}: ${cam.z.toFixed(1)} vs ${ground(cam.x, cam.y).toFixed(1)}`);
  }
  assert.ok(cam.z > 8, `it has climbed with the hill: ${cam.z.toFixed(1)}`);
});

test('hills in 3D: the land is drawn as a mesh, farthest first, and costs more to draw than flat ground but not much more', async () => {
  const { C, course } = await load();
  const grad = { addColorStop() {} };
  const count = (hole) => {
    let calls = 0;
    const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => grad : () => { calls++; }), set: () => true });
    const a = course.routeAhead(hole, 0, 0, 100);
    const cam = C.newCamera(a.x, a.y, C.groundAt(hole, a.x, a.y) + 7, 0, -0.1);
    C.drawScene(ctx, { hole, cam, view: C.viewOf(900, 560, cam), disc: { x: a.x, y: a.y + 40, h: 10 }, trail: [], color: '#fff', t: 0 });
    return calls;
  };
  const hilly = course.holeById(7);
  const flat = { ...hilly, field: undefined };
  Object.defineProperty(flat, '_grid', { value: hilly._grid, enumerable: false });
  const [h, f] = [count(hilly), count(flat)];
  assert.ok(h > f, `there is more to draw: ${h} vs ${f}`);
  assert.ok(h < 20000, `but a frame stays cheap: ${h} canvas calls`);
});

test('ground colours: lit from the north-west, every cell of a hole has a colour, and water is blue', async () => {
  const gr = await import('../public/js/ground.js');
  const course = await import('../public/js/course.js');
  assert.ok(gr.lightOf(0.2, -0.2) > gr.lightOf(0, 0) && gr.lightOf(-0.2, 0.2) < gr.lightOf(0, 0), 'a slope facing north-west is bright, the other way dark');
  assert.ok(Math.abs(gr.lightOf(0, 0) - 1) < 0.02, 'level ground is the plain colour');
  const hole = course.holeById(5);
  const g = gr.groundCells(hole);
  assert.strictEqual(g.cols.length, g.nx * g.ny * 3);
  assert.strictEqual(g.cols, gr.groundCells(hole).cols, 'made once');
  const f = hole.field;
  const water = hole.water[0];
  const wx = water.reduce((a, p) => a + p[0], 0) / water.length;
  const wy = water.reduce((a, p) => a + p[1], 0) / water.length;
  const k = Math.floor((wy - f.y0) / f.step) * g.nx + Math.floor((wx - f.x0) / f.step);
  assert.strictEqual(g.cls[k], gr.KIND.water);
  assert.ok(g.cols[k * 3 + 2] > g.cols[k * 3], 'and it is blue');
  const lines = gr.contours(hole, 4);
  assert.ok(lines.length > 50 && lines.every((s) => s.length === 5 && Number.isFinite(s[0]) && s[4] % 4 === 0), 'contour lines every 4 ft');
});
