/* A perspective view of the course, drawn on the same 2D canvas: no library, no models. The ground is the course's own flat
   shapes (fairway, water, out of bounds) projected through a camera; trees, the basket and the disc are drawn as billboards
   sorted by depth. Used to ride behind a thrown disc, so a throw is something you fly through instead of a line on a map.
   Feet; x is east, y is north, z is up (a point of a flight is x, y and its height h). Nothing here knows about the game's
   state: callers hand it a hole, a camera and a disc. */

export const ZS = 0.72; // heights are drawn a little squashed: a real arc looks like a rocket when you ride it
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

const autumn = (t) => ((Math.abs(Math.sin(t.x * 12.9898 + t.y * 78.233)) * 43758.5453) % 1) < 0.2; // the same fifth of the maples are turning, as on the map

// white pine (a narrow cone of boughs), maple (round, some turning), oak (broad with a thick trunk), shrubs and bushes (low blobs)
function drawTree(ctx, cam, b, view, t) {
  const base = project(cam, view, t.x, t.y, 0);
  if (!base || base.d > FAR) return;
  const sx = base.x;
  if (sx < -250 || sx > view.W + 250) return;
  const fog = fogAt(base.d);
  const k = t.k || (t.h < 20 ? 's' : 'm');
  const th = t.h * ZS;
  const s = base.s;
  const blob = (color, cx, cy, rx, ry) => { ctx.fillStyle = mixTo(hex(color), HAZE, fog); ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1.2, rx), Math.max(1.2, ry), 0, 0, Math.PI * 2); ctx.fill(); };
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
  const g = project(cam, view, x, y, 0);
  if (!g || g.d > 2500) return;
  const near = g.d < 220;
  if (part !== 'all' && !near) { if (part === 'base') part = 'all'; else return; } // far off, the base layer draws everything
  const top = project(cam, view, x, y, RING_H + 0.12);
  // a flag on a staff so you can find it from far off; standing at the basket, it is only a short staff
  const staffH = RING_H + 0.3 + Math.min(24, Math.max(0, (g.d - 40) * 0.12));
  const flagTop = project(cam, view, x, y, staffH * ZS + (RING_H + 0.3) * (1 - ZS));
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
      const fl = Math.max(5, Math.min(9, 0.7 + g.d * 0.05) * g.s * ZS);
      ctx.fillStyle = '#d35400';
      ctx.beginPath();
      ctx.moveTo(flagTop.x, flagTop.y);
      ctx.lineTo(flagTop.x + fl * 1.5, flagTop.y + fl * 0.5);
      ctx.lineTo(flagTop.x, flagTop.y + fl);
      ctx.closePath();
      ctx.fill();
    }
    // the tray: a steel dish, 66 cm across and 24.5 cm deep, with radial rods and a bright lip
    const lip = g.d < 700 ? ringAt(cam, view, x, y, TRAY_R, TRAY_H) : null;
    const floor = lip ? ringAt(cam, view, x, y, TRAY_R * 0.8, TRAY_FLOOR) : null;
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
      const up = project(cam, view, x + Math.cos(a) * rTop, y + Math.sin(a) * rTop, RING_H);
      const dn = project(cam, view, x + Math.cos(a) * rBot + sway, y + Math.sin(a) * rBot - sway * 0.6, CHAIN_BOTTOM);
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
    const band = g.d < 700 ? ringAt(cam, view, x, y, BAND_R, RING_H, 20) : null;
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

function drawDisc(ctx, cam, view, p, color, t, dz = ZS) {
  const g = project(cam, view, p.x, p.y, 0);
  const a = project(cam, view, p.x, p.y, Math.max(0.4, p.h * dz));
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
function drawTrail(ctx, cam, view, pts, dz = ZS) {
  const n = pts.length;
  let prev = null;
  for (let i = 0; i < n; i++) {
    const q = project(cam, view, pts[i].x, pts[i].y, pts[i].h * dz);
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
  const dz = scene.dz ?? ZS; // a putt is drawn at its true height, so it meets the cage where the cage is
  drawTrail(ctx, cam, view, trail, dz);
  if (scene.splash) drawSplash(ctx, cam, view, scene.splash.at, scene.splash.age);
  // everything that stands up, farthest first
  const things = [];
  for (const tr of hole.trees) {
    const c = toCam(cam, b, tr.x, tr.y, 0);
    if (c[2] >= NEAR && c[2] <= FAR) things.push({ d: c[2], draw: () => drawTree(ctx, cam, b, view, tr) });
  }
  const dB = toCam(cam, b, hole.basket.x, hole.basket.y, 0)[2];
  things.push({ d: dB + 1.6, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'base') });
  things.push({ d: dB + 1.4, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'back') });
  things.push({ d: dB - 1.4, draw: () => drawBasket(ctx, cam, b, view, hole, scene.chain || 0, t, 'front') });
  things.push({ d: toCam(cam, b, disc.x, disc.y, 0)[2], draw: () => drawDisc(ctx, cam, view, disc, color, t, dz) });
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
