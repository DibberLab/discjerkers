/* A perspective view of the course, drawn on the same 2D canvas: no library, no models. The ground is the course's own flat
   shapes (fairway, water, out of bounds) projected through a camera; trees, the basket and the disc are drawn as billboards
   sorted by depth. Used to ride behind a thrown disc, so a throw is something you fly through instead of a line on a map.
   Feet; x is east, y is north, z is up (a point of a flight is x, y and its height h). Nothing here knows about the game's
   state: callers hand it a hole, a camera and a disc. */

const NEAR = 1; // nothing nearer than this (feet) is drawn
const FAR = 1500; // and nothing farther than this is drawn as a tree

/* ---------- the camera ---------- */

export const newCamera = (x = 0, y = 0, z = 6, yaw = 0, pitch = 0, fov = 64 * (Math.PI / 180)) => ({ x, y, z, yaw, pitch, fov, roll: 0 });

// the camera's own axes: where it looks, which way is right, which way is up
export function basis(cam) {
  const cy = Math.cos(cam.yaw);
  const sy = Math.sin(cam.yaw);
  const cp = Math.cos(cam.pitch);
  const sp = Math.sin(cam.pitch);
  return { fwd: [sy * cp, cy * cp, sp], right: [cy, -sy, 0], up: [-sy * sp, -cy * sp, cp] };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// a world point in the camera's terms: [across, up, ahead]
export function toCam(cam, b, x, y, z) {
  const rel = [x - cam.x, y - cam.y, z - cam.z];
  return [dot(rel, b.right), dot(rel, b.up), dot(rel, b.fwd)];
}

// the view: the size of the picture, where its middle is, and how strongly it zooms (from the smaller side, so a phone held upright still sees wide)
export const viewOf = (W, H, cam, bottomCover = 0) => ({ W, H, cx: W / 2, cy: (H - bottomCover) / 2, focal: Math.min(W, H - bottomCover) / 2 / Math.tan(cam.fov / 2) });

export function screenOf(view, c) {
  return [view.cx + (c[0] / c[2]) * view.focal, view.cy - (c[1] / c[2]) * view.focal];
}

// a world point on the screen (or null if it is behind the camera)
export function project(cam, view, x, y, z = 0) {
  const c = toCam(cam, basis(cam), x, y, z);
  if (c[2] < NEAR) return null;
  const [sx, sy] = screenOf(view, c);
  return { x: sx, y: sy, d: c[2], s: view.focal / c[2] }; // s: pixels per foot at that distance
}

// cut a polygon (in camera space) to what is in front of the camera
export function clipNear(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = a[2] >= NEAR;
    const bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
    }
  }
  return out;
}

/* ---------- following a disc ---------- */

const wrap = (a) => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

// Where the camera starts: a little behind and above the thrower, looking the way the disc is about to go.
export function startCamera(from, dir) {
  const yaw = Math.atan2(dir.x, dir.y);
  return newCamera(from.x - dir.x * 20, from.y - dir.y * 20, 6.5, yaw, -0.03);
}

/**
 * One step of the chase camera. `disc` is { x, y, h }, `dir` the unit way it is travelling (x, y), `dt` seconds. The camera
 * sits behind and above the disc and looks ahead of it; position and aim ease toward that, so it swings round bends in the
 * flight instead of snapping, and it banks into a turn.
 */
export function follow(cam, disc, dir, dt, { back = 16, lift = 4, ahead = 70 } = {}) {
  const k = 1 - Math.exp(-dt * 10);
  const ky = 1 - Math.exp(-dt * 4.2);
  const wantX = disc.x - dir.x * back;
  const wantY = disc.y - dir.y * back;
  const wantZ = Math.max(4.5, disc.h + lift);
  cam.x += (wantX - cam.x) * k;
  cam.y += (wantY - cam.y) * k;
  cam.z += (wantZ - cam.z) * k;
  const lookX = disc.x + dir.x * ahead - cam.x;
  const lookY = disc.y + dir.y * ahead - cam.y;
  const lookZ = disc.h * 0.8 - cam.z;
  const yawWant = Math.atan2(lookX, lookY);
  const turn = wrap(yawWant - cam.yaw);
  cam.yaw = wrap(cam.yaw + turn * ky);
  const pitchWant = Math.atan2(lookZ, Math.hypot(lookX, lookY));
  cam.pitch += (pitchWant - cam.pitch) * ky;
  cam.roll += (Math.max(-0.14, Math.min(0.14, -turn * 0.9)) - cam.roll) * k; // lean into the turn
  return cam;
}

/* ---------- colors ---------- */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixTo = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
const HAZE = hex('#5f8a7c');
const fogAt = (d) => Math.max(0, Math.min(0.85, (d - 120) / 1300)); // how far toward haze something is

const COLORS = {
  beyond: '#0b140d', rough: '#16301d', fairway: '#25502e', stripe: 'rgba(255,255,255,0.05)', tee: '#2f6a3a',
  water: '#1b4b66', waterEdge: '#6bb0cc', oob: '#4a200c',
};

/* ---------- the scene ---------- */

function groundPoly(ctx, cam, b, view, pts, z = 0) {
  const c = clipNear(pts.map(([x, y]) => toCam(cam, b, x, y, z)));
  if (c.length < 3) return false;
  ctx.beginPath();
  c.forEach((p, i) => { const [sx, sy] = screenOf(view, p); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
  ctx.closePath();
  return true;
}
const fillGround = (ctx, cam, b, view, pts, color) => { if (groundPoly(ctx, cam, b, view, pts)) { ctx.fillStyle = color; ctx.fill(); } };

function circle(cx, cy, r, n = 28) {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
}

// the ground: mown stripes along the fairway, water, out of bounds, the tee, the green around the basket
function drawGround(ctx, cam, b, view, hole) {
  const near = [cam.x, cam.y];
  fillGround(ctx, cam, b, view, [[near[0] - 5000, near[1] - 5000], [near[0] + 5000, near[1] - 5000], [near[0] + 5000, near[1] + 5000], [near[0] - 5000, near[1] + 5000]], COLORS.beyond);
  const bd = hole.bounds;
  fillGround(ctx, cam, b, view, [[bd.minX, bd.minY], [bd.maxX, bd.minY], [bd.maxX, bd.maxY], [bd.minX, bd.maxY]], COLORS.rough);
  fillGround(ctx, cam, b, view, hole.fairwayPoly, COLORS.fairway);
  // stripes: the fairway outline is the left edge going out and the right edge coming back
  const n = hole.fairwayPoly.length / 2;
  const left = hole.fairwayPoly.slice(0, n);
  const right = hole.fairwayPoly.slice(n).reverse();
  for (let i = 5; i + 5 < n; i += 10) fillGround(ctx, cam, b, view, [...left.slice(i, i + 6), ...right.slice(i, i + 6).reverse()], COLORS.stripe);
  fillGround(ctx, cam, b, view, circle(hole.basket.x, hole.basket.y, 24), COLORS.fairway);
  const p = hole.tee.pad;
  fillGround(ctx, cam, b, view, [[p.minX, p.minY], [p.maxX, p.minY], [p.maxX, p.maxY], [p.minX, p.maxY]], COLORS.tee);
  for (const z of hole.oob) fillGround(ctx, cam, b, view, z, COLORS.oob);
  for (const w of hole.water) {
    if (groundPoly(ctx, cam, b, view, w)) {
      ctx.fillStyle = COLORS.water;
      ctx.fill();
      ctx.strokeStyle = COLORS.waterEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function sky(ctx, cam, b, view) {
  const { W, H } = view;
  // the horizon is where a far point straight ahead lands
  const far = project(cam, view, cam.x + b.fwd[0] * 6000, cam.y + b.fwd[1] * 6000, 0);
  const hy = far ? far.y : view.cy - Math.tan(cam.pitch) * view.focal;
  const g = ctx.createLinearGradient(0, hy - H * 0.9, 0, hy);
  g.addColorStop(0, '#09131c');
  g.addColorStop(0.6, '#1b3a46');
  g.addColorStop(1, '#6f9a8a');
  ctx.fillStyle = g;
  ctx.fillRect(-W, -H, W * 3, H * 3);
  return hy;
}

function haze(ctx, view, hy) {
  const g = ctx.createLinearGradient(0, hy - 6, 0, hy + view.H * 0.22);
  g.addColorStop(0, 'rgba(111,154,138,0.85)');
  g.addColorStop(1, 'rgba(111,154,138,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-view.W, hy - 6, view.W * 3, view.H * 0.22 + 6);
}

function drawTree(ctx, cam, b, view, t) {
  const base = project(cam, view, t.x, t.y, 0);
  if (!base || base.d > FAR) return;
  const sx = base.x;
  if (sx < -200 || sx > view.W + 200) return;
  const fog = fogAt(base.d);
  const shrub = t.h < 20;
  const rx = Math.max(1.5, t.r * (shrub ? 1.5 : 1.35) * base.s);
  if (shrub) {
    ctx.fillStyle = mixTo(hex('#4a8f45'), HAZE, fog);
    ctx.beginPath();
    ctx.ellipse(sx, base.y - t.h * 0.45 * base.s, rx, Math.max(1.5, t.h * 0.55 * base.s), 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // trunk, then a tall oval of branches with a lighter side
  ctx.fillStyle = mixTo(hex('#2a1d12'), HAZE, fog);
  ctx.fillRect(sx - Math.max(0.7, t.r * 0.18 * base.s), base.y - t.h * 0.42 * base.s, Math.max(1.4, t.r * 0.36 * base.s), t.h * 0.42 * base.s);
  const cy = base.y - (t.h * 0.34 + (t.h * 0.66) / 2) * base.s;
  const ry = (t.h * 0.66 * base.s) / 2;
  ctx.fillStyle = mixTo(hex('#164a24'), HAZE, fog);
  ctx.beginPath();
  ctx.ellipse(sx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mixTo(hex('#2a7a38'), HAZE, fog);
  ctx.beginPath();
  ctx.ellipse(sx - rx * 0.22, cy - ry * 0.12, rx * 0.62, ry * 0.78, 0, 0, Math.PI * 2);
  ctx.fill();
}

// the basket, with a tall flag so you can find it from a long way off
function drawBasket(ctx, cam, b, view, hole) {
  const g = project(cam, view, hole.basket.x, hole.basket.y, 0);
  if (!g || g.d > 2500) return;
  const top = project(cam, view, hole.basket.x, hole.basket.y, 30);
  const ring = project(cam, view, hole.basket.x, hole.basket.y, 4.4);
  ctx.strokeStyle = 'rgba(238,241,232,0.85)';
  ctx.lineWidth = Math.max(1, 0.18 * g.s);
  ctx.beginPath();
  ctx.moveTo(g.x, g.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  ctx.fillStyle = '#d35400';
  const fl = Math.max(5, 9 * g.s);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(top.x + fl * 1.5, top.y + fl * 0.5);
  ctx.lineTo(top.x, top.y + fl);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d35400';
  ctx.lineWidth = Math.max(1.5, 0.35 * g.s);
  ctx.beginPath();
  ctx.ellipse(ring.x, ring.y, Math.max(3, 1.6 * g.s), Math.max(1.2, 0.5 * g.s), 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDisc(ctx, cam, view, p, color, t) {
  const g = project(cam, view, p.x, p.y, 0);
  const a = project(cam, view, p.x, p.y, Math.max(0.4, p.h));
  if (g) { // the shadow on the grass
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.4 - p.h * 0.004)})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, Math.max(3, 1.7 * g.s), Math.max(1.2, 0.5 * g.s), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!a) return;
  const w = Math.max(6, 3.1 * a.s); // drawn bigger than life, or it would be a speck
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(a.x, a.y, w, w * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const spin = (t / 90) % (Math.PI * 2); // a glint going round the rim
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(a.x + Math.cos(spin) * w * 0.8, a.y + Math.sin(spin) * w * 0.27, Math.max(1, w * 0.12), 0, Math.PI * 2);
  ctx.fill();
}

// the flight so far, as a ribbon that fades behind the disc
function drawTrail(ctx, cam, view, pts) {
  const n = pts.length;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const q = project(cam, view, pts[i].x, pts[i].y, pts[i].h);
    if (q && prev) {
      ctx.strokeStyle = `rgba(238,241,232,${0.15 + 0.6 * (i / n)})`;
      ctx.lineWidth = Math.max(1.5, 0.28 * q.s);
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
    }
    prev = q;
  }
}

// a ring that spreads where the disc went in the water
function drawSplash(ctx, cam, view, at, age) {
  const g = project(cam, view, at.x, at.y, 0);
  if (!g || age < 0) return;
  for (const k of [0, 0.25, 0.5]) {
    const u = Math.max(0, Math.min(1, age - k));
    if (u <= 0 || u >= 1) continue;
    ctx.strokeStyle = `rgba(200,235,250,${0.8 * (1 - u)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, (2 + 14 * u) * g.s * 0.5, (1 + 6 * u) * g.s * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Draw the whole scene for one frame.
 *   scene: { hole, cam, view, disc: {x, y, h}, trail: [{x, y, h}], color, t (ms), splash?: { at, age }, shake?: number }
 */
export function drawScene(ctx, scene) {
  const { hole, cam, view, disc, trail, color, t } = scene;
  const b = basis(cam);
  ctx.save();
  if (scene.shake) ctx.translate((Math.random() - 0.5) * scene.shake, (Math.random() - 0.5) * scene.shake);
  ctx.translate(view.cx, view.cy);
  ctx.rotate(cam.roll);
  ctx.translate(-view.cx, -view.cy);
  const hy = sky(ctx, cam, b, view);
  drawGround(ctx, cam, b, view, hole);
  haze(ctx, view, hy);
  drawTrail(ctx, cam, view, trail);
  if (scene.splash) drawSplash(ctx, cam, view, scene.splash.at, scene.splash.age);
  // everything that stands up, farthest first
  const things = [];
  for (const tr of hole.trees) {
    const c = toCam(cam, b, tr.x, tr.y, 0);
    if (c[2] >= NEAR && c[2] <= FAR) things.push({ d: c[2], draw: () => drawTree(ctx, cam, b, view, tr) });
  }
  things.push({ d: toCam(cam, b, hole.basket.x, hole.basket.y, 0)[2], draw: () => drawBasket(ctx, cam, b, view, hole) });
  things.push({ d: toCam(cam, b, disc.x, disc.y, 0)[2] - 0.5, draw: () => drawDisc(ctx, cam, view, disc, color, t) });
  things.sort((p, q) => q.d - p.d);
  for (const th of things) th.draw();
  ctx.restore();
}

/** What to draw at a moment of a flight: the disc's place along its path (with the same easing the map uses). */
export function discAt(pts, p) {
  const eased = 1 - (1 - p) ** 2.2;
  const idx = eased * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(idx));
  const f = idx - i;
  const A = pts[i];
  const B = pts[i + 1] || A;
  const pos = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, h: A.h + (B.h - A.h) * f };
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  // which way it is going (looking a little ahead, so it does not twitch)
  const C = pts[Math.min(pts.length - 1, i + 4)];
  const dl = Math.hypot(C.x - A.x, C.y - A.y) || len;
  return { pos, i, dir: { x: (C.x - A.x) / dl || 0, y: (C.y - A.y) / dl || 1 } };
}
