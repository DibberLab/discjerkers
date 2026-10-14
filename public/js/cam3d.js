/* A perspective view of the course, drawn on the same 2D canvas: no library, no models. The ground is the course's own flat
   shapes (fairway, water, out of bounds) projected through a camera; trees, the basket and the disc are drawn as billboards
   sorted by depth. Used to ride behind a thrown disc, so a throw is something you fly through instead of a line on a map.
   Feet; x is east, y is north, z is up (a point of a flight is x, y and its height h). Nothing here knows about the game's
   state: callers hand it a hole, a camera and a disc. */

import { fieldAt } from './terrain.js?v=1';
import { groundCells, PALETTE } from './ground.js?v=5';
import * as FO from './foliage.js?v=1';

export const ZS = 0.72; // heights are drawn a little squashed: a real arc looks like a rocket when you ride it
const NEAR = 1; // nothing nearer than this (feet) is drawn
// how high the ground is at a point (feet above the tee): everything that stands on it is drawn that much higher
export const groundAt = (hole, x, y) => (hole.field ? fieldAt(hole.field, x, y) : 0);
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
export function startCamera(from, dir, ground = 0) {
  const yaw = Math.atan2(dir.x, dir.y);
  return newCamera(from.x - dir.x * 20, from.y - dir.y * 20, ground + 6.5, yaw, -0.03);
}

/**
 * One step of the chase camera. `disc` is { x, y, h }, `dir` the unit way it is travelling (x, y), `dt` seconds. The camera
 * sits behind and above the disc and looks ahead of it; position and aim ease toward that, so it swings round bends in the
 * flight instead of snapping, and it banks into a turn. On a hill the disc carries `g`, the ground under it, and `ground(x, y)` says how
 * high the ground is anywhere, so the camera rises and falls with the land and never goes under it.
 */
export function follow(cam, disc, dir, dt, { back = 16, lift = 4, ahead = 70, ground = null } = {}) {
  const k = 1 - Math.exp(-dt * 10);
  const ky = 1 - Math.exp(-dt * 4.2);
  const wantX = disc.x - dir.x * back;
  const wantY = disc.y - dir.y * back;
  const g = disc.g || 0;
  const wantZ = g + Math.max(4.5, disc.h + lift);
  cam.x += (wantX - cam.x) * k;
  cam.y += (wantY - cam.y) * k;
  cam.z += (wantZ - cam.z) * k;
  if (ground) cam.z = Math.max(cam.z, ground(cam.x, cam.y) + 3.5);
  const lookX = disc.x + dir.x * ahead - cam.x;
  const lookY = disc.y + dir.y * ahead - cam.y;
  const lookZ = g + disc.h * 0.8 - cam.z;
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
const fillGround = (ctx, cam, b, view, pts, color, z = 0) => { if (groundPoly(ctx, cam, b, view, pts, z)) { ctx.fillStyle = color; ctx.fill(); } };

function circle(cx, cy, r, n = 28) {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
}

// the ground of a hole with no hills: mown stripes along the fairway, water, out of bounds, the tee, the green around the basket
function drawFlatGround(ctx, cam, b, view, hole) {
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

/* ---------- the ground of a hole with hills ---------- */

// The land is a grid of heights (course.js); it is drawn as a mesh of coloured quads, farthest first, so a hill hides what is behind it.
// Up close every cell is a quad; farther out, blocks of 2 and then 4 cells, so a long view costs about the same as a short one.
const LODS = [{ k: 1, from: 0, to: 150 }, { k: 2, from: 150, to: 320 }, { k: 4, from: 320, to: 640 }];
const projCache = new WeakMap();

function drawTerrain(ctx, cam, b, view, hole) {
  const f = hole.field;
  const gc = groundCells(hole);
  let pr = projCache.get(hole);
  if (!pr) { const n = f.nx * f.ny; pr = { sx: new Float32Array(n), sy: new Float32Array(n), sd: new Float32Array(n), mark: new Int32Array(n), frame: 0 }; projCache.set(hole, pr); }
  pr.frame++;
  const { right, up, fwd } = b;
  const vert = (i, j) => { // a grid point on the screen: its distance (negative if it is behind the camera), cached for the frame
    const k = j * f.nx + i;
    if (pr.mark[k] === pr.frame) return pr.sd[k];
    pr.mark[k] = pr.frame;
    const rx = f.x0 + i * f.step - cam.x;
    const ry = f.y0 + j * f.step - cam.y;
    const rz = f.z[k] - cam.z;
    const d = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
    pr.sd[k] = d < NEAR ? -1 : d;
    if (d >= NEAR) {
      pr.sx[k] = view.cx + ((rx * right[0] + ry * right[1]) / d) * view.focal;
      pr.sy[k] = view.cy - ((rx * up[0] + ry * up[1] + rz * up[2]) / d) * view.focal;
    }
    return pr.sd[k];
  };
  const fx = fwd[0];
  const fy = fwd[1];
  const fl = Math.hypot(fx, fy) || 1;
  const margin = 150;
  for (let li = LODS.length - 1; li >= 0; li--) {
    const { k, from, to } = LODS[li];
    const span = k * f.step;
    const i0 = Math.max(0, Math.floor((cam.x - to - f.x0) / span) * k);
    const i1 = Math.min(f.nx - 1 - k, Math.ceil((cam.x + to - f.x0) / span) * k);
    const j0 = Math.max(0, Math.floor((cam.y - to - f.y0) / span) * k);
    const j1 = Math.min(f.ny - 1 - k, Math.ceil((cam.y + to - f.y0) / span) * k);
    const quads = [];
    for (let j = j0; j <= j1; j += k) {
      for (let i = i0; i <= i1; i += k) {
        const mx = f.x0 + (i + k / 2) * f.step - cam.x;
        const my = f.y0 + (j + k / 2) * f.step - cam.y;
        const d = Math.hypot(mx, my);
        if (d < from || d >= to) continue;
        if ((mx * fx + my * fy) / fl < -span * 0.9) continue; // behind us
        quads.push({ i, j, d });
      }
    }
    quads.sort((p, q) => q.d - p.d);
    for (const { i, j, d } of quads) {
      const a = vert(i, j);
      const bb = vert(i + k, j);
      const c = vert(i + k, j + k);
      const e = vert(i, j + k);
      const ka = j * f.nx + i;
      const kb = j * f.nx + i + k;
      const kc = (j + k) * f.nx + i + k;
      const ke = (j + k) * f.nx + i;
      // the colour: the cell's own, or the average of the cells in the block, toward haze with distance
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let jj = j; jj < j + k; jj++) {
        for (let ii = i; ii < i + k; ii++) { const o = (jj * gc.nx + ii) * 3; r += gc.cols[o]; g += gc.cols[o + 1]; bl += gc.cols[o + 2]; }
      }
      const q = 1 / (k * k);
      const fog = fogAt(d);
      const col = `rgb(${Math.round((r * q) * (1 - fog) + HAZE[0] * fog)},${Math.round((g * q) * (1 - fog) + HAZE[1] * fog)},${Math.round((bl * q) * (1 - fog) + HAZE[2] * fog)})`;
      ctx.beginPath();
      if (a > 0 && bb > 0 && c > 0 && e > 0) {
        const xs = [pr.sx[ka], pr.sx[kb], pr.sx[kc], pr.sx[ke]];
        const ys = [pr.sy[ka], pr.sy[kb], pr.sy[kc], pr.sy[ke]];
        if (Math.max(...xs) < -margin || Math.min(...xs) > view.W + margin || Math.max(...ys) < -margin || Math.min(...ys) > view.H + margin) continue;
        ctx.moveTo(xs[0], ys[0]);
        ctx.lineTo(xs[1], ys[1]);
        ctx.lineTo(xs[2], ys[2]);
        ctx.lineTo(xs[3], ys[3]);
      } else if (a > 0 || bb > 0 || c > 0 || e > 0) { // it crosses the near plane: cut it there
        const corner = (ii, jj) => toCam(cam, b, f.x0 + ii * f.step, f.y0 + jj * f.step, f.z[jj * f.nx + ii]);
        const cut = clipNear([corner(i, j), corner(i + k, j), corner(i + k, j + k), corner(i, j + k)]);
        if (cut.length < 3) continue;
        cut.forEach((pt, n) => { const [sx, sy] = screenOf(view, pt); if (n) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      } else continue;
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.strokeStyle = col; // a hairline of the same colour hides the seams between neighbours
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      if (k === 1 && d < 95) mottle(ctx, cam, view, f, gc, i, j, 1 - smooth01((d - 40) / 55));
    }
  }
}

// Close up, a cell is not one flat colour: soft patches of lighter and darker grass in it, a different few each time, the same every frame
const smooth01 = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };
const hash2 = (a, b, c) => { const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return n - Math.floor(n); };
function mottle(ctx, cam, view, f, gc, i, j, fade) {
  if (fade <= 0.01) return;
  const kind = gc.cls[j * gc.nx + i];
  if (kind === 3 || kind === 4) return;
  const colors = kind === 0 ? ['rgba(74,132,56,0.2)', 'rgba(3,16,7,0.22)', 'rgba(110,150,60,0.14)', 'rgba(4,18,8,0.18)', 'rgba(90,140,60,0.16)', 'rgba(3,14,6,0.2)'] : ['rgba(255,255,235,0.05)', 'rgba(0,14,4,0.09)', 'rgba(255,255,235,0.035)', 'rgba(0,14,4,0.06)', 'rgba(255,255,235,0.04)', 'rgba(0,14,4,0.07)'];
  const sy = Math.sin(cam.yaw);
  const cy = Math.cos(cam.yaw);
  for (let n = 0; n < 6; n++) {
    const x = f.x0 + (i + hash2(i, j, 40 + n)) * f.step;
    const y = f.y0 + (j + hash2(i, j, 50 + n)) * f.step;
    const r = 0.8 + hash2(i, j, 60 + n) * 1.7; // feet
    const z = fieldAt(f, x, y);
    const c = project(cam, view, x, y, z);
    const e = project(cam, view, x + cy * r, y - sy * r, z); // a step to the camera's right
    const a = project(cam, view, x + sy * r, y + cy * r, z); // and a step away from it
    if (!c || !e || !a) continue;
    const rx = Math.abs(e.x - c.x) + Math.abs(e.y - c.y) * 0.3;
    const ry = Math.abs(a.y - c.y) + Math.abs(a.x - c.x) * 0.3;
    if (rx < 0.5) continue;
    ctx.globalAlpha = fade; // they melt in and out with distance, so nothing pops as the camera moves
    ctx.fillStyle = colors[n];
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rx, Math.max(0.8, ry), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Grass close up: tufts and a few flecks of colour on the cells nearest the camera, in the same places every frame
function drawGrass(ctx, cam, b, view, hole) {
  const f = hole.field;
  const gc = groundCells(hole);
  const R = 80;
  const i0 = Math.max(0, Math.floor((cam.x - R - f.x0) / f.step));
  const i1 = Math.min(f.nx - 2, Math.ceil((cam.x + R - f.x0) / f.step));
  const j0 = Math.max(0, Math.floor((cam.y - R - f.y0) / f.step));
  const j1 = Math.min(f.ny - 2, Math.ceil((cam.y + R - f.y0) / f.step));
  const blades = [[], []]; // dark, light
  const flecks = [];
  const fx = b.fwd[0];
  const fy = b.fwd[1];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const kind = gc.cls[j * gc.nx + i];
      if (kind === 3 || kind === 4) continue; // not on water or out of bounds
      const mx = f.x0 + (i + 0.5) * f.step - cam.x;
      const my = f.y0 + (j + 0.5) * f.step - cam.y;
      const dist = Math.sqrt(mx * mx + my * my);
      if (dist > R || mx * fx + my * fy < -f.step) continue;
      const fade = 1 - smooth01((dist - 30) / (R - 30)); // blades shrink away with distance instead of vanishing all at once
      const tufts = kind === 0 ? 4 : 2; // the rough is shaggier than the fairway
      for (let n = 0; n < tufts; n++) {
        if (hash2(i, j, n * 3 + 1) > (kind === 0 ? 0.9 : 0.55)) continue;
        const x = f.x0 + (i + hash2(i, j, n * 3 + 2)) * f.step;
        const y = f.y0 + (j + hash2(i, j, n * 3 + 3)) * f.step;
        const base = project(cam, view, x, y, fieldAt(f, x, y));
        if (!base) continue;
        const hh = (0.55 + hash2(i, j, n + 9) * 0.8) * (kind === 0 ? 1 : 0.55) * base.s * fade;
        if (hh < 0.6) continue;
        const lean = (hash2(i, j, n + 13) - 0.5) * hh * 0.9;
        const group = blades[hash2(i, j, n + 17) < 0.5 ? 0 : 1];
        for (let q = -2; q <= 2; q++) group.push([base.x + q * hh * 0.09, base.y, base.x + q * hh * 0.17 + lean * (1 + 0.2 * q), base.y - hh * (1 - Math.abs(q) * 0.12)]);
      }
      if (hash2(i, j, 31) < (kind === 0 ? 0.16 : 0.04)) { // a flower in the rough, a speck of dirt on the fairway
        const x = f.x0 + (i + hash2(i, j, 32)) * f.step;
        const y = f.y0 + (j + hash2(i, j, 33)) * f.step;
        const base = project(cam, view, x, y, fieldAt(f, x, y) + 0.4);
        if (base) flecks.push([base.x, base.y, Math.max(0.4, 0.22 * base.s * fade), kind === 0 ? ['#e8d44d', '#f1efe2', '#d98ad2', '#f09a3e'][Math.floor(hash2(i, j, 34) * 4)] : 'rgba(30,20,8,0.5)']);
      }
    }
  }
  ctx.lineCap = 'round';
  [['rgba(8,26,12,0.55)', 1.3], ['rgba(120,176,84,0.55)', 1.1]].forEach(([color, w], gi) => {
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of blades[gi]) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  });
  for (const [x, y, r, color] of flecks) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}

function drawGround(ctx, cam, b, view, hole) {
  if (!hole.field) { drawFlatGround(ctx, cam, b, view, hole); return; }
  const gz = groundAt(hole, cam.x, cam.y);
  const near = [cam.x, cam.y];
  const far = mixTo(PALETTE.rough, HAZE, fogAt(640));
  fillGround(ctx, cam, b, view, [[near[0] - 6000, near[1] - 6000], [near[0] + 6000, near[1] - 6000], [near[0] + 6000, near[1] + 6000], [near[0] - 6000, near[1] + 6000]], far, gz - 4);
  drawTerrain(ctx, cam, b, view, hole);
  drawGrass(ctx, cam, b, view, hole);
}

function sky(ctx, cam, b, view, dusk = 0) {
  const { W, H } = view;
  // the horizon is where a far point straight ahead lands
  const far = project(cam, view, cam.x + b.fwd[0] * 6000, cam.y + b.fwd[1] * 6000, cam.z);
  const hy = far ? far.y : view.cy - Math.tan(cam.pitch) * view.focal;
  const g = ctx.createLinearGradient(0, hy - H * 0.9, 0, hy);
  g.addColorStop(0, dusk ? mixTo(hex('#09131c'), hex('#1c1036'), dusk) : '#09131c');
  g.addColorStop(0.6, dusk ? mixTo(hex('#1b3a46'), hex('#7a3b5e'), dusk) : '#1b3a46');
  g.addColorStop(1, dusk ? mixTo(hex('#6f9a8a'), hex('#f0985a'), dusk) : '#6f9a8a');
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

const autumn = (t) => ((Math.abs(Math.sin(t.x * 12.9898 + t.y * 78.233)) * 43758.5453) % 1) < 0.2; // the same fifth of the maples are turning, as on the map

// white pine (a narrow cone of boughs), maple (round, some turning), oak (broad with a thick trunk), shrubs and bushes (low blobs)
function drawTree(ctx, cam, b, view, t) {
  const base = project(cam, view, t.x, t.y, t.z || 0); // a tree stands on the ground under it
  if (!base || base.d > FAR) return;
  const sx = base.x;
  if (sx < -250 || sx > view.W + 250) return;
  const fog = fogAt(base.d);
  const k = t.k || (t.h < 20 ? 's' : 'm');
  const th = t.h * ZS;
  const s = base.s;
  const blob = (color, cx, cy, rx, ry) => { ctx.fillStyle = mixTo(hex(color), HAZE, fog); ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1.2, rx), Math.max(1.2, ry), 0, 0, Math.PI * 2); ctx.fill(); };
  // the drawn picture of this kind of tree, when it is ready and big enough to be worth it (else the flat shapes below)
  const low = k === 's' || k === 'b';
  const pw = (low ? 2 * t.r * (k === 'b' ? 1.3 : 1.45) : 2 * t.r * (k === 'o' ? 1.8 : 1.6)) * s / 0.96;
  const ph = th * s * (low ? 1.05 : 1.02);
  if (ph >= 7 && pw >= 3) {
    const pic = FO.side(t, ph * 1.6, k === 'm' && autumn(t));
    if (pic) {
      const img = FO.tint(pic.img, fog, HAZE, pic.id);
      ctx.drawImage(img, sx - pw / 2, base.y - ph + ph * 0.02, pw, ph);
      return;
    }
  }
  if (k === 's' || k === 'b') {
    const bush = k === 'b';
    const rx = Math.max(1.5, t.r * (bush ? 1.3 : 1.45) * s);
    blob(bush ? '#2f5f35' : '#4a8f45', sx, base.y - th * 0.45 * s, rx, th * 0.55 * s);
    blob(bush ? '#3f7a3a' : '#63ad57', sx - rx * 0.25, base.y - th * 0.55 * s, rx * 0.55, th * 0.3 * s);
    return;
  }
  const trunkW = Math.max(1.4, t.r * (k === 'o' ? 0.5 : 0.34) * s);
  ctx.fillStyle = mixTo(hex(k === 'p' ? '#3a2616' : '#2a1d12'), HAZE, fog);
  ctx.fillRect(sx - trunkW / 2, base.y - th * (k === 'o' ? 0.5 : 0.4) * s, trunkW, th * (k === 'o' ? 0.5 : 0.4) * s);
  if (k === 'p') { // three tiers of boughs, narrowing to the top
    const w = Math.max(2, t.r * 1.5 * s);
    const tiers = [[0.12, 0.5, 1], [0.34, 0.75, 0.74], [0.56, 1, 0.46]];
    tiers.forEach(([from, to, wid], i) => {
      ctx.fillStyle = mixTo(hex(i % 2 ? '#1d5a3c' : '#12392a'), HAZE, fog);
      ctx.beginPath();
      ctx.moveTo(sx - w * wid, base.y - th * from * s);
      ctx.lineTo(sx + w * wid, base.y - th * from * s);
      ctx.lineTo(sx, base.y - th * to * s);
      ctx.closePath();
      ctx.fill();
    });
    return;
  }
  if (k === 'o') { // a broad crown, low and wide
    const rx = Math.max(2, t.r * 1.7 * s);
    blob('#37591f', sx, base.y - th * 0.68 * s, rx, th * 0.32 * s);
    blob('#4c7a2c', sx - rx * 0.2, base.y - th * 0.76 * s, rx * 0.7, th * 0.22 * s);
    return;
  }
  const rx = Math.max(2, t.r * 1.35 * s); // maple: a round, bright crown
  const turning = autumn(t);
  blob(turning ? '#a85a17' : '#2b7a37', sx, base.y - th * 0.66 * s, rx, th * 0.36 * s);
  blob(turning ? '#d98a2b' : '#3f9b4b', sx - rx * 0.22, base.y - th * 0.74 * s, rx * 0.65, th * 0.24 * s);
}

// A mando: a red and white post with a sign that points the way you must go round it, and a dashed line on the ground showing where
// you may not pass. (The ray goes out from the post on the side that is forbidden.)
function drawMandoLine(ctx, cam, view, hole) {
  const m = hole.mando;
  ctx.save();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = 'rgba(255,90,70,0.65)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  let pen = false;
  for (let d = 0; d <= m.len; d += 8) {
    const x = m.x + m.dx * d;
    const y = m.y + m.dy * d;
    const q = project(cam, view, x, y, groundAt(hole, x, y) + 0.2);
    if (!q) { pen = false; continue; }
    if (pen) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}
function drawMando(ctx, cam, b, view, hole) {
  const m = hole.mando;
  const zg = groundAt(hole, m.x, m.y);
  const g = project(cam, view, m.x, m.y, zg);
  const top = project(cam, view, m.x, m.y, zg + 8);
  if (!g || !top || g.d > 900) return;
  const w = Math.max(2, 0.42 * g.s);
  for (let i = 0; i < 4; i++) { // the post, in stripes
    const a = { x: g.x + (top.x - g.x) * (i / 4), y: g.y + (top.y - g.y) * (i / 4) };
    const c = { x: g.x + (top.x - g.x) * ((i + 1) / 4), y: g.y + (top.y - g.y) * ((i + 1) / 4) };
    ctx.strokeStyle = i % 2 ? '#f4f1e6' : '#d6342a';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  // the sign: an arrow pointing the way to go (away from the forbidden side)
  const tip = project(cam, view, m.x - m.dx * 4, m.y - m.dy * 4, zg + 7);
  const tail = project(cam, view, m.x + m.dx * 0.1, m.y + m.dy * 0.1, zg + 7);
  if (tip && tail) {
    const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
    const len = Math.max(10, Math.hypot(tip.x - tail.x, tip.y - tail.y));
    const hw = Math.max(5, 0.9 * g.s);
    ctx.save();
    ctx.translate(top.x, top.y - hw);
    ctx.rotate(ang);
    ctx.fillStyle = '#d6342a';
    ctx.strokeStyle = '#f4f1e6';
    ctx.lineWidth = Math.max(1, hw * 0.18);
    ctx.beginPath();
    ctx.moveTo(-len * 0.1, -hw * 0.4);
    ctx.lineTo(len * 0.55, -hw * 0.4);
    ctx.lineTo(len * 0.55, -hw);
    ctx.lineTo(len * 1.05, 0);
    ctx.lineTo(len * 0.55, hw);
    ctx.lineTo(len * 0.55, hw * 0.4);
    ctx.lineTo(-len * 0.1, hw * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

// the basket: a pole, a ring with its chains, and a tall flag so you can find it from a long way off
/* A basket to scale. The PDGA certifies baskets in centimetres; a typical championship one (the DGA Mach X, PDGA certification 13-66):
   the tray's rim is 79 cm off the ground, 66.5 cm across inside and 24.5 cm deep; the chains hang from a band 56 cm wide (16 outer and
   8 inner chains) over a zone 50 cm tall; the pole is 4.8 cm across. Here in feet. */
export const TRAY_H = 2.65; // the tray's rim, off the ground
export const TRAY_R = 1.08; // the tray's inside radius (66 cm across)
export const TRAY_FLOOR = TRAY_H - 0.8; // 24.5 cm deep
export const BAND_R = 0.92; // the top band, 56 cm across: narrower than the tray
export const CHAIN_BOTTOM = TRAY_H + 0.22; // where the chains end, just over the rim
export const RING_H = CHAIN_BOTTOM + 1.64; // the top band: the chains are 50 cm long
export const POLE_R = 0.079; // 4.8 cm across

// a circle of the given size and height around a point, projected (or null if any of it is behind the camera)
function ringAt(cam, view, x, y, r, z, n = 22) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = project(cam, view, x + Math.cos((i / n) * Math.PI * 2) * r, y + Math.sin((i / n) * Math.PI * 2) * r, z);
    if (!q) return null;
    out.push(q);
  }
  return out;
}
const fillRing = (ctx, pts, color) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); };

// The basket (see the measures above), drawn in layers (the base and the far chains, then the disc, then the near chains and the top),
// so a disc that has gone in is inside the cage, behind the front chains, not on top of them.
//   part: 'all' (a basket far away is one piece), 'base', 'back' or 'front'
function drawBasket(ctx, cam, b, view, hole, jiggle = 0, t = 0, part = 'all') {
  const { x, y } = hole.basket;
  const zb = groundAt(hole, x, y); // the basket stands on the ground
  const g = project(cam, view, x, y, zb);
  if (!g || g.d > 2500) return;
  const near = g.d < 220;
  if (part !== 'all' && !near) { if (part === 'base') part = 'all'; else return; } // far off, the base layer draws everything
  const top = project(cam, view, x, y, zb + RING_H + 0.12);
  // a flag on a staff so you can find it from far off; standing at the basket, it is only a short staff
  const staffH = RING_H + 0.3 + Math.min(5, Math.max(0, (g.d - 40) * 0.03));
  const flagTop = project(cam, view, x, y, zb + staffH * ZS + (RING_H + 0.3) * (1 - ZS));
  if (part === 'all' || part === 'base') {
    // the pole
    ctx.strokeStyle = 'rgba(214,219,225,0.95)';
    ctx.lineWidth = Math.max(1, POLE_R * 2 * g.s);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y);
    ctx.lineTo((top || g).x, (top || g).y);
    ctx.stroke();
    if (flagTop && top && staffH > RING_H + 0.35) {
      ctx.lineWidth = Math.max(1, 0.06 * g.s);
      ctx.strokeStyle = 'rgba(238,241,232,0.85)';
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(flagTop.x, flagTop.y);
      ctx.stroke();
      const fl = Math.max(4, Math.min(2.6, 0.4 + g.d * 0.012) * g.s * ZS);
      ctx.fillStyle = '#d35400';
      ctx.beginPath();
      ctx.moveTo(flagTop.x, flagTop.y);
      ctx.lineTo(flagTop.x + fl * 1.5, flagTop.y + fl * 0.5);
      ctx.lineTo(flagTop.x, flagTop.y + fl);
      ctx.closePath();
      ctx.fill();
    }
    // the tray: a steel dish, 66 cm across and 24.5 cm deep, with radial rods and a bright lip
    const lip = g.d < 700 ? ringAt(cam, view, x, y, TRAY_R, zb + TRAY_H) : null;
    const floor = lip ? ringAt(cam, view, x, y, TRAY_R * 0.8, zb + TRAY_FLOOR) : null;
    if (lip && floor) {
      ctx.fillStyle = '#262a31';
      for (let i = 0; i < lip.length; i++) {
        const j = (i + 1) % lip.length;
        ctx.beginPath();
        ctx.moveTo(lip[i].x, lip[i].y);
        ctx.lineTo(lip[j].x, lip[j].y);
        ctx.lineTo(floor[j].x, floor[j].y);
        ctx.lineTo(floor[i].x, floor[i].y);
        ctx.closePath();
        ctx.fill();
      }
      fillRing(ctx, floor, '#15181d');
      if (g.d < 160) { // the rods running down the wall
        ctx.strokeStyle = 'rgba(190,196,204,0.55)';
        ctx.lineWidth = Math.max(0.6, 0.04 * g.s);
        for (let i = 0; i < lip.length; i += 2) { ctx.beginPath(); ctx.moveTo(lip[i].x, lip[i].y); ctx.lineTo(floor[i].x, floor[i].y); ctx.stroke(); }
      }
      ctx.strokeStyle = '#d3d8de';
      ctx.lineWidth = Math.max(1, 0.09 * g.s);
      ctx.beginPath();
      lip.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(214,219,225,0.95)'; // the pole through the middle of the tray
      ctx.lineWidth = Math.max(1, POLE_R * 2 * g.s);
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo((top || g).x, (top || g).y);
      ctx.stroke();
    }
  }
  // the chains: 16 outer and 8 inner, hanging from the top band to just over the tray's rim; the far ones are drawn before the disc, the near ones after
  if (near && part !== 'base') {
    const cd = toCam(cam, b, x, y, 0)[2];
    const chain = (n, rTop, rBot, i, width) => {
      const a = (i / n) * Math.PI * 2 + (n === 8 ? Math.PI / 8 : 0);
      const isNear = toCam(cam, b, x + Math.cos(a) * rTop, y + Math.sin(a) * rTop, 0)[2] < cd; // on the camera's side of the middle
      if (part !== 'all' && (part === 'front') !== isNear) return;
      const sway = jiggle * 0.5 * Math.sin(t / 38 + i * 1.9 + n); // the chains rattle when something has gone through
      const up = project(cam, view, x + Math.cos(a) * rTop, y + Math.sin(a) * rTop, zb + RING_H);
      const dn = project(cam, view, x + Math.cos(a) * rBot + sway, y + Math.sin(a) * rBot - sway * 0.6, zb + CHAIN_BOTTOM);
      if (!up || !dn) return;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(up.x, up.y);
      ctx.lineTo(dn.x, dn.y);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(210,214,206,0.8)';
    for (let i = 0; i < 16; i++) chain(16, BAND_R * 0.96, BAND_R * 0.8, i, Math.max(0.8, 0.07 * g.s));
    ctx.strokeStyle = 'rgba(190,196,200,0.65)';
    for (let i = 0; i < 8; i++) chain(8, BAND_R * 0.45, BAND_R * 0.34, i, Math.max(0.7, 0.06 * g.s));
  }
  // the top: a band and a cap, over everything
  if (part === 'all' || part === 'front') {
    const band = g.d < 700 ? ringAt(cam, view, x, y, BAND_R, zb + RING_H, 20) : null;
    if (band) {
      fillRing(ctx, band, 'rgba(120,126,134,0.55)');
      ctx.strokeStyle = '#cfd4da';
      ctx.lineWidth = Math.max(1, 0.1 * g.s);
      ctx.beginPath();
      band.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawDisc(ctx, cam, view, p, color, t, dz = ZS, gz = 0) {
  const g = project(cam, view, p.x, p.y, gz);
  const a = project(cam, view, p.x, p.y, gz + Math.max(0.4, p.h * dz));
  if (g) { // the shadow on the grass
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.12, 0.4 - p.h * 0.004)})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, Math.max(3, 1.7 * g.s), Math.max(1.2, 0.5 * g.s), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (!a) return;
  const w = Math.max(6, Math.min(3.1, 0.72 + 0.012 * Math.max(0, a.d - 25)) * a.s); // true size (about 0.7 ft across) near; bigger than life far off, or it would be a speck
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
function drawTrail(ctx, cam, view, pts, dz = ZS, hole = null) {
  const n = pts.length;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const q = project(cam, view, pts[i].x, pts[i].y, (hole ? groundAt(hole, pts[i].x, pts[i].y) : 0) + pts[i].h * dz);
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
function drawSplash(ctx, cam, view, at, age, gz = 0) {
  const g = project(cam, view, at.x, at.y, gz);
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
// A small marker over the pin so the basket can be found from far off, or behind a tree: a little orange triangle on a hair of a line, and when
// the pin is off the side of the picture (or behind you) a small arrow at the edge showing which way to turn. Not drawn close in.
export function drawPin(ctx, cam, b, view, hole) {
  const { x, y } = hole.basket;
  const zt = groundAt(hole, x, y) + RING_H;
  const c = toCam(cam, b, x, y, zt);
  const dist = Math.hypot(c[0], c[2]);
  if (dist < 70) return;
  const orange = '#d35400';
  const rim = 'rgba(238,241,232,0.95)';
  const m = 16;
  if (c[2] < NEAR) { // behind the camera
    const side = c[0] >= 0 ? 1 : -1;
    arrowAt(ctx, side > 0 ? view.W - m : m, view.cy, side, orange, rim);
    return;
  }
  const [sx, sy] = screenOf(view, c);
  if (sx < m || sx > view.W - m) { arrowAt(ctx, sx < m ? m : view.W - m, Math.max(m + 20, Math.min(view.cy * 2 - m - 20, sy)), sx < m ? -1 : 1, orange, rim); return; }
  const base = project(cam, view, x, y, groundAt(hole, x, y));
  const top = Math.max(10, sy - 14);
  ctx.strokeStyle = 'rgba(238,241,232,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(sx, top + 7); ctx.lineTo(sx, base ? Math.max(top + 8, sy) : top + 12); ctx.stroke();
  ctx.fillStyle = orange;
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(sx - 5, top - 1); ctx.lineTo(sx + 5, top - 1); ctx.lineTo(sx, top + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
}
function arrowAt(ctx, x, y, side, fill, rim) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = rim;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x + side * 8, y); ctx.lineTo(x - side * 4, y - 7); ctx.lineTo(x - side * 4, y + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
}

export function drawScene(ctx, scene) {
  const { hole, cam, view, disc, trail, color, t } = scene;
  const b = basis(cam);
  ctx.save();
  if (scene.shake) ctx.translate((Math.random() - 0.5) * scene.shake, (Math.random() - 0.5) * scene.shake);
  ctx.translate(view.cx, view.cy);
  ctx.rotate(cam.roll);
  ctx.translate(-view.cx, -view.cy);
  const hy = sky(ctx, cam, b, view, scene.dusk || 0);
  drawGround(ctx, cam, b, view, hole);
  haze(ctx, view, hy);
  const dz = scene.dz ?? ZS; // a putt is drawn at its true height, so it meets the cage where the cage is
  if (hole.mando) drawMandoLine(ctx, cam, view, hole);
  drawTrail(ctx, cam, view, trail, dz, hole);
  if (scene.splash) drawSplash(ctx, cam, view, scene.splash.at, scene.splash.age, groundAt(hole, scene.splash.at.x, scene.splash.at.y));
  // everything that stands up, farthest first
  const things = [];
  for (const tr of hole.trees) {
    const c = toCam(cam, b, tr.x, tr.y, 0);
    if (c[2] >= NEAR && c[2] <= FAR) things.push({ d: c[2], draw: () => drawTree(ctx, cam, b, view, tr) });
  }
  if (hole.mando) things.push({ d: toCam(cam, b, hole.mando.x, hole.mando.y, 0)[2], draw: () => drawMando(ctx, cam, b, view, hole) });
  const dB = toCam(cam, b, hole.basket.x, hole.basket.y, 0)[2];
  things.push({ d: dB + 1.6, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'base') });
  things.push({ d: dB + 1.4, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'back') });
  things.push({ d: dB - 1.4, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'front') });
  things.push({ d: toCam(cam, b, disc.x, disc.y, 0)[2], draw: () => drawDisc(ctx, cam, view, disc, color, t, dz, groundAt(hole, disc.x, disc.y)) });
  things.sort((p, q) => q.d - p.d);
  for (const th of things) th.draw();
  if (scene.overlay) scene.overlay(ctx); // the caller's own marks (the aim line, say), over the world
  if (scene.pin !== false) drawPin(ctx, cam, b, view, hole);
  ctx.restore();
}

// a point along a path at a fractional index, on a smooth curve through the points (Catmull-Rom), so the disc and the camera that follows
// it do not jerk at every one of the path's 70-odd corners: those jerks were what made the whole picture shimmer
function curveAt(pts, idx) {
  const n = pts.length;
  const i = Math.max(0, Math.min(n - 2, Math.floor(idx)));
  const f = Math.max(0, Math.min(1, idx - i));
  const P0 = pts[Math.max(0, i - 1)];
  const P1 = pts[i];
  const P2 = pts[i + 1];
  const P3 = pts[Math.min(n - 1, i + 2)];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
  return { x: cr(P0.x, P1.x, P2.x, P3.x), y: cr(P0.y, P1.y, P2.y, P3.y), h: Math.max(0, cr(P0.h, P1.h, P2.h, P3.h)) };
}

/** What to draw at a moment of a flight: the disc's place along its path (with the same easing the map uses). */
export function discAt(pts, p) {
  const eased = 1 - (1 - p) ** 2.2;
  const idx = eased * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(idx));
  const pos = curveAt(pts, idx);
  // which way it is going: across a stretch of the path either side, so the heading eases instead of changing at every corner
  const A = curveAt(pts, Math.max(0, idx - 3));
  const B = curveAt(pts, Math.min(pts.length - 1, idx + 5));
  const dl = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  return { pos, i, dir: { x: (B.x - A.x) / dl || 0, y: (B.y - A.y) / dl || 1 } };
}
