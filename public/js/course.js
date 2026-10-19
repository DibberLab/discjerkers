/* Course data. Feet. x is east, y is north; every hole starts with the tee at the origin, but a hole can run any way it
   likes from there: it follows a route (a centerline with half-widths) that bends, switches back and crosses water.
   A hole is data: the route, trees, water, out-of-bounds, and the basket. Adding a hole is adding an entry to HOLE_SPECS. */

import { STEP, makeField, fieldAt, fieldSlope, blurField, polyDistance, smoothstep, profileAt } from './terrain.js?v=1';

// a small seeded random, so a hole's trees are the same every time
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEG = Math.PI / 180;

export function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- the route ---------- */

// Cut a polyline into pieces no longer than `step`, carrying the half-width along.
function resample(line, step = 8) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [x0, y0, w0] = line[i - 1];
    const [x1, y1, w1] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, w0 + ((w1 - w0) * k) / n]);
  }
  return out;
}

// A walk from the tee: start heading (degrees clockwise from north), then legs of [length, turn in degrees, half-width].
function trail(heading, hw, legs) {
  let x = 0;
  let y = 0;
  let h = heading;
  const pts = [[0, 0, hw]];
  for (const [len, turn, w] of legs) {
    h += turn;
    x += Math.sin(h * DEG) * len;
    y += Math.cos(h * DEG) * len;
    pts.push([x, y, w]);
  }
  return pts;
}

// Round the corners: a Catmull-Rom curve through the waypoints.
function smooth(pts) {
  const p = [pts[0], ...pts, pts.at(-1)];
  const out = [pts[0]];
  for (let i = 1; i < p.length - 2; i++) {
    const [a, b, c, d] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const n = Math.max(2, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 12));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (j) => 0.5 * (2 * b[j] + (-a[j] + c[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t3);
      out.push([f(0), f(1), Math.max(8, f(2))]);
    }
  }
  return out;
}

// Where is the nearest point on a route? Returns how far along it (s), how far off it (d), and its half-width there.
function nearestOnRoute(route, x, y) {
  const P = route.pts;
  let best = { d: Infinity, s: 0, hw: 0 };
  for (let i = 1; i < P.length; i++) {
    const [x0, y0, w0] = P[i - 1];
    const [x1, y1, w1] = P[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
    if (d < best.d) best = { d, s: route.s[i - 1] + (route.s[i] - route.s[i - 1]) * t, hw: w0 + (w1 - w0) * t };
  }
  return best;
}

/* ---------- finding trees quickly: a forest is thousands of them ---------- */

const CELL = 40;
const cellKey = (cx, cy) => `${cx},${cy}`;
function buildGrid(trees) {
  const map = new Map();
  for (const t of trees) {
    const k = cellKey(Math.floor(t.x / CELL), Math.floor(t.y / CELL));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return { src: trees, map };
}
// the trees in a box (a little more than the box: whole cells)
export function treesIn(hole, lo, hi) {
  const g = hole._grid;
  if (!g || g.src !== hole.trees) return hole.trees.filter((t) => t.x >= lo.x && t.x <= hi.x && t.y >= lo.y && t.y <= hi.y);
  const out = [];
  for (let cx = Math.floor(lo.x / CELL); cx <= Math.floor(hi.x / CELL); cx++) {
    for (let cy = Math.floor(lo.y / CELL); cy <= Math.floor(hi.y / CELL); cy++) {
      const cell = g.map.get(cellKey(cx, cy));
      if (cell) out.push(...cell);
    }
  }
  return out;
}

/* ---------- the lay of the land ---------- */

// The ground of a hole is a grid of heights (terrain.js), made from a short description in the hole's own terms:
//   rise: [[s, z], ...]  how high the ground is along the route, in feet above the tee (the ends are held level: a tee and a green)
//   mounds: [{ x, y, r, h }]  a hill (h > 0) or a hollow (h < 0) about r feet across
//   bowl: how steeply the ground climbs away from the fairway on both sides (a hole in a valley)
//   shelves: [{ side, off, drop, width, from, to }]  the ground falling away at the edge: a cliff, a bank
//   water: [{ kind: 'pond' } | { kind: 'creek', s }]  one for each water shape: its surface is level and the land is cut to meet it
const BOWL_CAP = 18; // feet: the most the land climbs away from the fairway
function buildField(hole, T) {
  const f = makeField(hole.bounds, STEP);
  const L = hole.route.len;
  const user = [...(T.rise || [])].sort((a, b) => a[0] - b[0]);
  const zEnd = user.length ? user.at(-1)[1] : 0;
  const knots = [[0, 0], [14, 0], ...user.filter((k) => k[0] > 14 && k[0] < L - 14), [L - 14, zEnd], [L, zEnd]];
  const bowl = T.bowl ?? 0.08;
  for (let j = 0; j < f.ny; j++) {
    for (let i = 0; i < f.nx; i++) {
      const x = f.x0 + i * f.step;
      const y = f.y0 + j * f.step;
      const pos = routePosition(hole, x, y);
      let z = profileAt(knots, pos.s) + Math.min(BOWL_CAP, bowl * Math.max(0, pos.d - pos.hw - 6));
      for (const sh of T.shelves || []) {
        const o = sh.side * pos.side * pos.d; // feet out toward that side
        const along = smoothstep((pos.s - (sh.from ?? -60)) / 30) * smoothstep(((sh.to ?? L + 60) - pos.s) / 30);
        z -= sh.drop * smoothstep((o - sh.off) / sh.width) * along;
      }
      f.z[j * f.nx + i] = z;
    }
  }
  blurField(f, 3); // the nearest part of the route jumps from leg to leg at a bend, which leaves creases
  for (let j = 0; j < f.ny; j++) { // hills and hollows are smooth already, so they go on after
    for (let i = 0; i < f.nx; i++) {
      const x = f.x0 + i * f.step;
      const y = f.y0 + j * f.step;
      for (const m of T.mounds || []) f.z[j * f.nx + i] += m.h * Math.exp((-2 * ((x - m.x) ** 2 + (y - m.y) ** 2)) / (m.r * m.r));
    }
  }
  // water is level, and the land is cut to meet it: a pond sits in a basin, a creek in a gully
  const levels = hole.water.map((poly, k) => {
    const hint = (T.water || [])[k] || { kind: 'pond' };
    if (hint.kind === 'creek') return profileAt(knots, hint.s) - 0.4;
    return Math.min(...poly.map(([x, y]) => fieldAt(f, x, y))) - 0.3;
  });
  const boxes = hole.water.map((poly) => ({ lo: [Math.min(...poly.map((p) => p[0])) - 42, Math.min(...poly.map((p) => p[1])) - 42], hi: [Math.max(...poly.map((p) => p[0])) + 42, Math.max(...poly.map((p) => p[1])) + 42] }));
  for (let j = 0; j < f.ny; j++) {
    for (let i = 0; i < f.nx; i++) {
      const x = f.x0 + i * f.step;
      const y = f.y0 + j * f.step;
      hole.water.forEach((poly, k) => {
        const b = boxes[k];
        if (x < b.lo[0] || x > b.hi[0] || y < b.lo[1] || y > b.hi[1]) return;
        const reach = (T.water?.[k]?.kind === 'creek') ? 40 : 20; // a creek cuts a wider gully than a pond a basin
        const d = polyDistance(poly, x, y);
        if (d > reach) return;
        const w = d <= 0 ? 1 : 1 - smoothstep(d / reach);
        const k0 = j * f.nx + i;
        f.z[k0] += (levels[k] - f.z[k0]) * w;
      });
    }
  }
  return { field: f, levels };
}

// Feet above the tee at a point. A hole with no ground described is flat.
export function elevAt(hole, x, y) {
  return hole.field ? fieldAt(hole.field, x, y) : 0;
}
// Which way is down: feet of rise per foot east (gx) and north (gy).
export function slopeAt(hole, x, y) {
  return hole.field ? fieldSlope(hole.field, x, y) : { gx: 0, gy: 0 };
}

// Fill in what a hole needs to be drawn and played from its spec.
export function makeHole(specIn) {
  const { terrain, ...spec } = specIn;
  const hole = { wind: { mph: 0, from: 0 }, water: [], oob: [], trees: [], bounds: { minX: -160, maxX: 240, minY: -50, maxY: 530 }, tee: { x: 0, y: 0 }, ...spec };
  const pts = resample(hole.fairway, 8);
  hole.fairway = pts;
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  hole.route = { pts, s, len: s.at(-1) };
  // the fairway outline, for drawing: offset the route both ways along its normals
  const left = [];
  const right = [];
  pts.forEach(([x, y, w], i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / len; // normal to the right of travel
    const ny = -(b[0] - a[0]) / len;
    left.push([x - nx * w, y - ny * w]);
    right.push([x + nx * w, y + ny * w]);
  });
  hole.fairwayPoly = [...left, ...right.reverse()];
  hole.tee.pad = { minX: -9, maxX: 9, minY: -5, maxY: 9 };
  Object.defineProperty(hole, '_grid', { value: buildGrid(hole.trees), writable: true, enumerable: false });
  if (terrain) {
    const { field, levels } = buildField(hole, terrain);
    Object.defineProperty(hole, 'field', { value: field, enumerable: false });
    hole.waterLevel = levels;
    for (const t of hole.trees) t.z = Math.round(fieldAt(field, t.x, t.y) * 10) / 10; // the ground a tree stands on
  }
  return hole;
}

// 'tee', 'fairway', 'rough', 'water', or 'oob'
export function surfaceAt(hole, x, y) {
  const b = hole.bounds;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return 'oob';
  for (const w of hole.oob) if (pointInPoly(w, x, y)) return 'oob';
  for (const w of hole.water) if (pointInPoly(w, x, y)) return 'water';
  const p = hole.tee.pad;
  if (x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY) return 'tee';
  const near = nearestOnRoute(hole.route, x, y);
  if (near.d <= near.hw) return 'fairway';
  if (Math.hypot(x - hole.basket.x, y - hole.basket.y) <= 24) return 'fairway'; // a trimmed circle around the basket
  return 'rough';
}

// Where a point is in the hole's own terms: how far along the route (s), how far off it (d), which side (+1 right, -1 left) and
// the fairway's half-width there.
export function routePosition(hole, x, y) {
  const P = hole.route.pts;
  let best = { d: Infinity };
  for (let i = 1; i < P.length; i++) {
    const [x0, y0, w0] = P[i - 1];
    const [x1, y1, w1] = P[i];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
    if (d < best.d) best = { d, s: hole.route.s[i - 1] + (hole.route.s[i] - hole.route.s[i - 1]) * t, hw: w0 + (w1 - w0) * t, side: (dx * (y - y0) - dy * (x - x0)) <= 0 ? 1 : -1 };
  }
  return best;
}

// How far is left to play from here, following the route: for judging progress on a hole that turns away from the basket.
export function routeLeft(hole, x, y) {
  const near = nearestOnRoute(hole.route, x, y);
  return hole.route.len - near.s + Math.max(0, near.d - near.hw);
}

// The point on the route `feet` further along than where you are: where a careful player aims.
export function routeAhead(hole, x, y, feet) {
  const near = nearestOnRoute(hole.route, x, y);
  const target = Math.min(hole.route.len, near.s + feet);
  const { pts, s } = hole.route;
  let i = 1;
  while (i < pts.length - 1 && s[i] < target) i++;
  const f = (target - s[i - 1]) / (s[i] - s[i - 1] || 1);
  return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f };
}

/* ---------- building a hole from a description ---------- */

/**
 * A hole from a short description, in the hole's own terms: s is feet along the route from the tee, o is feet to the right
 * of its centerline (negative is left). So "a pond at s 220, o 55" is on the right side of the corner however the hole turns.
 *   path: waypoints from trail()           woods: tree lines down the edges: { side, from, to, d, rows, dense, gaps, h }
 *   trees: [s, o, radius, height]          shrubs: [s, o] low bushes you can throw over        groves: { s, o, n, spread, h }
 *   rows: { s0, s1, o }  a row of trees along the hole    walls: { s, from, to, gaps, h }  a row of trees across the hole, with gates
 *                   ponds: { s, o, rx, ry }
 *   staggers: { s0, s1, every, reach, sides }  trees reaching in from the edge, one after another on alternating sides (or only the sides listed), so the line
 *             through the hole is an S: reach is the fraction of the fairway's width each one blocks
 *   guards: { side, back, off, n }  tall trees `back` feet before the basket and `off` feet to one side of the line, so the approach has an angle
 *   boulders: { s, o, n, spread, r, h }  a field of rocks (k 'r'): low, so a lofted throw clears them and a low one or a roll does not
 *   rocks: [s, o, r, h]  one rock                         pine: the share of the forest that is pine (default 0.4: mountains are mostly pine)
 *   mandoAlways: the hole's mando (`mando`) is always there, not only on some days
 *   creeks: { s, w, gap }  water straight across, with an optional dry ford [o0, o1]           oob: { s0, s1, o0, o1 }
 */
function build(spec) {
  const { id, name, note, par, path, wind, drops = [], woods = [], trees: explicit = [], shrubs = [], groves = [], walls = [], rows = [], ponds = [], creeks = [], staggers = [], guards = [], boulders = [], rocks: rockList = [], pine = 0.4, mandoAlways = false, oob = [], backstop = true, teeWall = true, forest = true, front = 0, padBottom = 60, seed = id * 131, ground = GROUNDS[id] || {}, mando = null } = spec;
  const rnd = seeded(seed);
  const line = smooth(path);
  const route = { pts: line, s: [0] };
  for (let i = 1; i < line.length; i++) route.s.push(route.s[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const L = route.s.at(-1);

  // a point s feet along the route and o to its right, with the heading there
  const frame = (sAt, o = 0) => {
    if (sAt > L) { // past the basket: carry on in a straight line
      const e = frame(L, o);
      return { ...e, x: e.x + e.tx * (sAt - L), y: e.y + e.ty * (sAt - L) };
    }
    if (sAt < 0) { // before the tee: straight back
      const e = frame(0, o);
      return { ...e, x: e.x + e.tx * sAt, y: e.y + e.ty * sAt };
    }
    const q = sAt;
    let i = 1;
    while (i < line.length - 1 && route.s[i] < q) i++;
    const [x0, y0, w0] = line[i - 1];
    const [x1, y1, w1] = line[i];
    const f = (q - route.s[i - 1]) / (route.s[i] - route.s[i - 1] || 1);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const tx = (x1 - x0) / len;
    const ty = (y1 - y0) / len;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    const hw = w0 + (w1 - w0) * f;
    return { x: x + ty * o, y: y - tx * o, hw, tx, ty };
  };
  const basket = { x: line.at(-1)[0], y: line.at(-1)[1] };
  const end = frame(L);

  const trees = [];
  const r1 = (v) => Math.round(v * 10) / 10;
  const tree = (x, y, r = 3.6 + rnd() * 1.8, h = 48 + rnd() * 18) => trees.push({ x: r1(x), y: r1(y), r: r1(r), h: Math.round(h) });
  const treeAt = (sAt, o, r, h) => { const f = frame(sAt, o); tree(f.x, f.y, r, h); };

  // the woods along the edges
  for (const w of woods) {
    const { side, from = -20, to = L - 10, d = 7, rows = 1, dense = 0.7, gaps = [], h = [68, 96] } = w; // tall pines: even a lofted throw (nose up) does not clear them
    // a tree every 6 to 8 feet is a wall: a disc is a point, and a trunk stops it within 0.9 of its radius (4.4 and up here)
    const space = 8.5 - 3 * dense;
    for (let sAt = from; sAt <= to; sAt += space * (0.92 + rnd() * 0.16)) {
      if (gaps.some(([a, b]) => sAt >= a && sAt <= b)) continue;
      const f = frame(sAt);
      for (let k = 0; k < rows; k++) treeAt(sAt + rnd() * 3 + k * 4, side * (f.hw + d + k * 10 + rnd() * 5), 4.4 + rnd() * 1.3, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const [sAt, o, r, h] of explicit) treeAt(sAt, o, r, h);
  for (const [sAt, o] of shrubs) { treeAt(sAt, o, 2.6 + rnd() * 0.5, 8 + rnd() * 3); trees.at(-1).k = 's'; }
  for (const g of groves) {
    const { s: sAt, o, n = 5, spread = 18, h = [44, 64] } = g;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      treeAt(sAt + Math.sin(a) * rr, o + Math.cos(a) * rr, undefined, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const w of walls) {
    const { s: sAt, from, to, gaps = [], h = [70, 94], gap = 5.2 } = w;
    for (let o = from; o <= to; o += gap + rnd() * 0.5) {
      if (gaps.some(([a, b]) => o >= a && o <= b)) continue;
      treeAt(sAt + rnd() * 6 - 3, o, 4 + rnd() * 1.5, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const r of rows) {
    const { s0, s1, o, h = [70, 94], gap = 5.2 } = r; // a disc is a point and a trunk stops it within 3/4 of its radius, so a solid row is a tree every 5 feet
    for (let sAt = s0; sAt <= s1; sAt += gap + rnd() * 0.5) treeAt(sAt, o + rnd() * 4 - 2, 4 + rnd() * 1.5, h[0] + rnd() * (h[1] - h[0]));
  }
  // staggers: tall trees that reach in from one edge, then the other: a fairway that has to be shaped, left then right, to get through
  for (const g of staggers) {
    const { s0, s1, every = 60, reach = 0.42, sides = [1, -1], h = [72, 96] } = g;
    let k = 0;
    for (let sAt = s0; sAt <= s1 + 0.1; sAt += every, k++) {
      const side = sides[k % sides.length];
      const hw = frame(sAt).hw;
      for (let o = hw + 4; o >= hw - reach * 2 * hw; o -= 5.2 + rnd() * 0.4) treeAt(sAt + rnd() * 4 - 2, side * o, 4 + rnd() * 1.4, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  // rocks: one boulder (explicit), and fields of them. They are low (a few feet to a dozen), so they stop a flat throw or a roll and are flown over.
  for (const [sAt, o, r, h] of rockList) { treeAt(sAt, o, r, h); trees.at(-1).k = 'r'; }
  for (const b of boulders) {
    const { s: sAt, o, n = 6, spread = 18, r = [3.2, 7], h = [5, 12] } = b;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      treeAt(sAt + Math.sin(a) * rr, o + Math.cos(a) * rr, r[0] + rnd() * (r[1] - r[0]), h[0] + rnd() * (h[1] - h[0]));
      trees.at(-1).k = 'r';
    }
  }
  // guards: a couple of tall trees beside the line in to the basket, so the last approach is shaped and not a straight dart
  for (const g of guards) {
    const { side, back = 44, off = 14, n = 2, h = [70, 92] } = g;
    for (let k = 0; k < n; k++) treeAt(L - back + k * 7, side * (off + k * 3), 4.2 + rnd() * 1.2, h[0] + rnd() * (h[1] - h[0]));
  }
  // the tee is boxed in behind: you play down the hole, not out of the back of the tee
  if (teeWall) for (let o = -(path[0][2] + 26); o <= path[0][2] + 26; o += 5.2 + rnd() * 0.4) treeAt(-26, o, 4.4 + rnd() * 1.3, 70 + rnd() * 20);
  // a backstop behind the basket, and shrubs and trees in front of it
  if (backstop) for (let k = -3; k <= 3; k++) { const f = frame(L + 14 + Math.abs(k) * 2 + rnd() * 8, k * 14 + rnd() * 6); tree(f.x + end.tx * 14, f.y + end.ty * 14, 4.2 + rnd(), 58); }
  for (let k = 0; k < front; k++) { const side = rnd() < 0.5 ? -1 : 1; treeAt(L - 22 - rnd() * 24, side * (13 + rnd() * 12), 2.7 + rnd() * 0.4, 8 + rnd() * 2); trees.at(-1).k = 's'; }

  // water: ponds are wobbly ellipses in the route's own frame, creeks cross it
  const water = [];
  const hints = []; // what each water shape is, for the ground to be cut to meet it
  for (const p of ponds) {
    const n = p.n || 12;
    water.push(Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const k = 0.86 + rnd() * 0.28;
      const f = frame(p.s + Math.sin(a) * p.ry * k, p.o + Math.cos(a) * p.rx * k);
      return [r1(f.x), r1(f.y)];
    }));
    hints.push({ kind: 'pond' });
  }
  const REACH = 360;
  for (const c of creeks) {
    const bank = (o0, o1) => {
      const top = [];
      const bottom = [];
      for (let o = o0; o <= o1; o += 16) {
        top.push(frame(c.s + c.w / 2 + Math.sin(o * 0.05) * 5, o));
        bottom.push(frame(c.s - c.w / 2 + Math.sin(o * 0.05 + 1) * 5, o));
      }
      return [...top, ...bottom.reverse()].map((f) => [r1(f.x), r1(f.y)]);
    };
    if (c.gap) { water.push(bank(-REACH, c.gap[0])); water.push(bank(c.gap[1], REACH)); hints.push({ kind: 'creek', s: c.s }, { kind: 'creek', s: c.s }); } else { water.push(bank(-REACH, REACH)); hints.push({ kind: 'creek', s: c.s }); }
  }
  // out of bounds zones follow the route's curve
  const zones = oob.map((z) => {
    const a = [];
    const b = [];
    for (let sAt = z.s0; sAt <= z.s1 + 0.1; sAt += 14) { a.push(frame(sAt, z.o0)); b.push(frame(sAt, z.o1)); }
    return [...a, ...b.reverse()].map((f) => [r1(f.x), r1(f.y)]);
  });

  const xs = line.map((p) => p[0]);
  const ys = line.map((p) => p[1]);
  const bounds = { minX: Math.min(...xs) - 120, maxX: Math.max(...xs) + 120, minY: Math.min(...ys, 0) - padBottom, maxY: Math.max(...ys) + 120 };
  // The forest. Wherever a side has woods, everything outside the fairway on that side is forest, not just a row of trees at the
  // edge: white pine, maple and oak, with bushes between them. Where a side has no woods, or a gap in them, it is open ground.
  if (woods.length && forest) {
    const covered = (sd, sAt) => {
      const q = sAt <= 0 ? 0 : sAt >= L ? L - 10 : sAt;
      return woods.some((w) => w.side === sd && q >= (w.from ?? -20) && q <= (w.to ?? L - 10) && !(w.gaps || []).some(([a, c]) => q >= a && q <= c));
    };
    const grid = buildGrid(trees);
    const add = (t) => { trees.push(t); const k = cellKey(Math.floor(t.x / CELL), Math.floor(t.y / CELL)); if (!grid.map.has(k)) grid.map.set(k, []); grid.map.get(k).push(t); };
    const crowded = (x, y, r, gap) => {
      for (let cx = Math.floor((x - 14) / CELL); cx <= Math.floor((x + 14) / CELL); cx++) {
        for (let cy = Math.floor((y - 14) / CELL); cy <= Math.floor((y + 14) / CELL); cy++) {
          for (const t of grid.map.get(cellKey(cx, cy)) || []) if (Math.hypot(t.x - x, t.y - y) < (t.r + r) * gap) return true;
        }
      }
      return false;
    };
    const wet = (x, y) => water.some((w) => pointInPoly(w, x, y)) || zones.some((w) => pointInPoly(w, x, y));
    // where is this, in the hole's own terms: how far from the route, which side, how far along
    const where = (x, y) => {
      const n = nearestOnRoute(route, x, y);
      const f = frame(Math.max(0, Math.min(L, n.s)), 0);
      return { ...n, side: (x - f.x) * f.ty - (y - f.y) * f.tx >= 0 ? 1 : -1 };
    };
    const KINDS = { p: { r: [3.8, 4.8], h: [78, 105] }, m: { r: [5, 6.4], h: [66, 84] }, o: { r: [6, 7.8], h: [70, 92] } }; // tall: a lofted throw does not clear them
    const between = ([lo, hi]) => lo + rnd() * (hi - lo);
    const pickKind = () => { const u = rnd(); return u < pine ? 'p' : u < pine + (1 - pine) / 2 ? 'm' : 'o'; };
    const lo = { x: Math.min(...line.map((p) => p[0])) - 120, y: Math.min(...line.map((p) => p[1]), 0) - padBottom };
    const hi = { x: Math.max(...line.map((p) => p[0])) + 120, y: Math.max(...line.map((p) => p[1])) + 120 };
    for (let gx = lo.x + 6; gx < hi.x - 6; gx += 15) {
      for (let gy = lo.y + 6; gy < hi.y - 6; gy += 15) {
        const x = gx + (rnd() - 0.5) * 12;
        const y = gy + (rnd() - 0.5) * 12;
        const w = where(x, y);
        if (w.d < w.hw + 20 || !covered(w.side, w.s) || wet(x, y)) continue;
        if (Math.hypot(x, y) < 32 || Math.hypot(x - basket.x, y - basket.y) < 34) continue;
        const k = pickKind();
        const r = between(KINDS[k].r);
        if (crowded(x, y, r, 0.8)) continue;
        add({ x: r1(x), y: r1(y), r: r1(r), h: Math.round(between(KINDS[k].h)), k });
      }
    }
    // bushes in the rough and under the trees
    for (let gx = lo.x + 6; gx < hi.x - 6; gx += 21) {
      for (let gy = lo.y + 6; gy < hi.y - 6; gy += 21) {
        if (rnd() > 0.62) continue;
        const x = gx + (rnd() - 0.5) * 16;
        const y = gy + (rnd() - 0.5) * 16;
        const w = where(x, y);
        if (w.d < w.hw + 4 || !covered(w.side, w.s) || wet(x, y)) continue;
        if (Math.hypot(x, y) < 28 || Math.hypot(x - basket.x, y - basket.y) < 30) continue;
        const shrub = rnd() < 0.35; // some are taller shrubs, the rest low bushes
        const r = shrub ? 2.5 + rnd() * 1 : 2.2 + rnd() * 1.4;
        if (crowded(x, y, r, 0.7)) continue;
        add({ x: r1(x), y: r1(y), r: r1(r), h: shrub ? Math.round(8 + rnd() * 4) : Math.round((3 + rnd() * 2.8) * 10) / 10, k: shrub ? 's' : 'b' });
      }
    }
  }
  for (const t of trees) if (!t.k) t.k = t.h < 20 ? 's' : ['p', 'p', 'm', 'm', 'o', 'o'][Math.floor(rnd() * 6)]; // the edge rows get their species too

  // no trees growing in a pond, in out of bounds, or on the tee or basket
  const dry = trees.filter((t) => !water.some((w) => pointInPoly(w, t.x, t.y)) && !zones.some((w) => pointInPoly(w, t.x, t.y)) && Math.hypot(t.x, t.y) > t.r + 10 && Math.hypot(t.x - basket.x, t.y - basket.y) > t.r + 8);
  const terrain = { rise: ground.rise, bowl: ground.bowl, shelves: ground.shelves, water: hints, mounds: (ground.mounds || []).map((m) => { const f = frame(m.s, m.o); return { x: f.x, y: f.y, r: m.r, h: m.h }; }) };
  // a mando: a post you must pass on one side of (side +1: the ray goes right of the post, so you may not pass on its right). It only counts on days a seed asks.
  let mandoSpec;
  if (mando) {
    const f = frame(mando.s, mando.o);
    mandoSpec = { x: r1(f.x), y: r1(f.y), dx: Math.round(f.ty * mando.side * 1000) / 1000, dy: Math.round(-f.tx * mando.side * 1000) / 1000, len: mando.len || 140, s: mando.s, side: mando.side };
  }
  return makeHole({ id, name, note, par, fairway: line, basket, wind, water, oob: zones, trees: dry, bounds, terrain, mandoSpec, ...(drops.length ? { dropZones: drops.map(([s, o]) => { const f = frame(s, o); return { x: r1(f.x), y: r1(f.y) }; }) } : {}), ...(mandoAlways && mandoSpec ? { mando: mandoSpec, mandoAlways: true } : {}) });
}

/* ---------- the ground of each hole ---------- */
// How the land lies (see buildField): rise is feet above the tee along the route, in [s, z] pairs, and s, o in a mound are feet along
// and to the right of it. Steepest anywhere is about one foot in five. Holes that do not say get a gentle bowl and nothing else.
const GROUNDS = {
  1: { rise: [[100, -3], [200, 2], [290, -4], [390, -2]], bowl: 0.06, mounds: [{ s: 232, o: 24, r: 26, h: 3 }, { s: 420, o: 0, r: 22, h: -5 }] }, // a rolling start, and the land drops away behind the basket
  2: { rise: [[110, 4], [235, 13]], bowl: 0.1, mounds: [{ s: 112, o: -3, r: 18, h: 3 }] }, // uphill to the pin, a knoll under the middle tree
  3: { rise: [[120, -12], [250, -16], [426, -9]], bowl: 0.08, mounds: [{ s: 426, o: 0, r: 30, h: 4.5 }] }, // down off the tee, up to a raised green that sheds a miss
  4: { rise: [[120, 4], [240, -9], [330, -9], [470, 6], [614, 10]], bowl: 0.09 }, // the creek runs along the bottom of a valley
  5: { rise: [[40, -4], [110, -16], [252, -18]], bowl: 0.07 }, // a tee on a bluff over the pond
  6: { rise: [[90, 5], [180, -3], [290, 7], [380, 0], [445, -5]], bowl: 0.03, mounds: [{ s: 150, o: -34, r: 30, h: 4 }, { s: 330, o: 30, r: 30, h: -3 }, { s: 475, o: 0, r: 24, h: -5 }] }, // open rolling prairie
  7: { rise: [[200, 5], [405, 9]], bowl: 0.09, shelves: [{ side: 1, off: 46, drop: 42, width: 26, from: 30, to: 430 }] }, // the cliff on the right is real
  8: { rise: [[125, -5], [250, -10], [375, 4], [496, 10]], bowl: 0.08, mounds: [{ s: 496, o: 0, r: 30, h: 4.5 }] }, // down the first bend, up the last to a raised green
  9: { rise: [[120, 4], [215, 10], [300, 2], [400, -4]], bowl: 0.08, mounds: [{ s: 215, o: 0, r: 44, h: 5 }, { s: 430, o: 0, r: 22, h: -5 }] }, // the stand of trees is on a ridge
  10: { rise: [[70, 3], [118, 8], [190, -2], [255, -8]], bowl: 0.09 }, // the oak is on the crest, the green is down by the water
  11: { rise: [[200, 3], [390, 8], [608, -2]], bowl: 0.08 }, // out and over a low hill, home down the other side
  12: { rise: [[70, -10], [210, -8], [330, -4], [426, 6]], bowl: 0.08, mounds: [{ s: 426, o: 0, r: 30, h: 4 }] }, // off a knoll, down and up to a raised green
  13: { rise: [[90, 3], [190, -3], [285, 1]], bowl: 0.1 }, // low and wet
  14: { rise: [[80, -12], [200, -9], [421, -3]], bowl: 0.08, mounds: [{ s: 130, o: 6, r: 20, h: 3 }] }, // off a high tee, the land falls away toward the lake
  15: { rise: [[100, 4], [250, 6], [420, 3], [591, -3]], bowl: 0.05, shelves: [{ side: 1, off: 38, drop: 7, width: 16, from: 150, to: 520 }, { side: -1, off: 38, drop: 7, width: 16, from: 150, to: 520 }] }, // a causeway above the lakes
  16: { rise: [[130, -6], [200, -8], [290, 4], [400, 9]], bowl: 0.08, mounds: [{ s: 430, o: 0, r: 22, h: -5 }] }, // a valley, then up to a green with nothing behind it
  17: { rise: [[110, 6], [225, 14]], bowl: 0.14 }, // the den is on the hill
  18: { rise: [[120, -8], [262, -14], [380, -6], [483, 4]], bowl: 0.08, mounds: [{ s: 483, o: 0, r: 30, h: 4.5 }] }, // down into the valley and home up the far side to a raised green
  // ---- Quarry Ridge (the second course)
  101: { rise: [[100, -4], [220, 3], [330, -2], [400, 0]], bowl: 0.06, mounds: [{ s: 430, o: 0, r: 22, h: -4 }] }, // a rolling meadow
  102: { rise: [[60, -8], [130, -16], [240, -14]], bowl: 0.1, mounds: [{ s: 240, o: 0, r: 30, h: 4 }] }, // off a ledge, down into the pit
  103: { rise: [[130, 3], [270, -3], [400, 2]], bowl: 0.05 }, // a swale between the hedgerows
  104: { rise: [[150, -6], [340, -10], [520, 4], [650, 8]], bowl: 0.07 }, // down to the creek and up the ridge
  105: { rise: [[40, -5], [110, -11], [230, -9]], bowl: 0.08 }, // a tee on the spillway wall
  106: { rise: [[100, 2], [250, 5], [400, 0]], bowl: 0.12 },
  107: { rise: [[70, -14], [200, -12], [320, -4], [410, 2]], bowl: 0.06, shelves: [{ side: 1, off: 44, drop: 26, width: 26, from: 30, to: 400 }] }, // the overlook: a high tee and a drop on the right
  108: { rise: [[170, -4], [330, -8], [470, -2], [600, 4]], bowl: 0.06, mounds: [{ s: 610, o: 0, r: 30, h: 4 }] },
  109: { rise: [[100, 3], [180, -3], [260, 0]], bowl: 0.03, mounds: [{ s: 260, o: 0, r: 30, h: 4.5 }] }, // open meadow, a raised green
  110: { rise: [[100, 2], [250, -3], [410, 3]], bowl: 0.05 },
  111: { rise: [[120, 10], [190, 18], [260, 8], [400, -6]], bowl: 0.06, mounds: [{ s: 430, o: 0, r: 22, h: -5 }] }, // a blind crest, and down the far side
  112: { rise: [[110, 2], [240, 6], [380, 3]], bowl: 0.1 },
  113: { rise: [[60, -3], [150, -6], [290, -2]], bowl: 0.06 },
  114: { rise: [[160, 6], [300, 14], [460, 20], [600, 22]], bowl: 0.06, mounds: [{ s: 600, o: 0, r: 30, h: 4 }] }, // all the way up the ridge
  115: { rise: [[100, -3], [220, -6], [330, -4], [420, 0]], bowl: 0.05 }, // low and wet
  116: { rise: [[50, 8], [130, 12], [220, 8]], bowl: 0.05, shelves: [{ side: 1, off: 26, drop: 26, width: 26, from: 20, to: 230 }, { side: -1, off: 26, drop: 26, width: 26, from: 20, to: 230 }] }, // a ridge with a drop on both sides
  117: { rise: [[130, 3], [260, 6], [400, 2]], bowl: 0.04 },
  118: { rise: [[120, -6], [300, -12], [440, -4], [560, 6]], bowl: 0.07, mounds: [{ s: 560, o: 0, r: 30, h: 4.5 }] },
  // ---- Timberline Peak (the third course): big land, broad fairways, a lot of height
  201: { rise: [[120, 6], [260, 14], [400, 9]], bowl: 0.06, mounds: [{ s: 60, o: -40, r: 30, h: 4 }] }, // a meadow at the foot of the trail
  202: { rise: [[60, 8], [150, 18], [250, 22]], bowl: 0.1 }, // uphill through the pass
  203: { rise: [[100, 4], [220, 2], [430, 6]], bowl: 0.07 }, // a tarn in a shallow bowl
  204: { rise: [[190, 10], [350, 20], [500, 8], [660, 14]], bowl: 0.07, mounds: [{ s: 669, o: 0, r: 30, h: 4 }] }, // up and over and round
  205: { rise: [[50, -6], [140, -12], [250, -10]], bowl: 0.09 }, // down to the snowmelt stream
  206: { rise: [[120, 4], [260, 8], [410, 4]], bowl: 0.1 },
  207: { rise: [[110, 6], [230, 14], [420, 8]], bowl: 0.03, mounds: [{ s: 140, o: 30, r: 34, h: 5 }, { s: 330, o: -36, r: 30, h: -4 }, { s: 420, o: 0, r: 30, h: 4.5 }] }, // open and rolling, a raised green
  208: { rise: [[150, -8], [300, -20], [430, -10], [560, 4]], bowl: 0.05, shelves: [{ side: -1, off: 52, drop: 24, width: 26, from: 40, to: 300 }] }, // down the chute, up the far side
  209: { rise: [[60, 6], [140, 12], [230, 8]], bowl: 0.12, mounds: [{ s: 230, o: 0, r: 30, h: 4.5 }] }, // in a cirque
  210: { rise: [[100, 8], [250, 10], [410, 6]], bowl: 0.03, shelves: [{ side: 1, off: 40, drop: 22, width: 26, from: 20, to: 420 }, { side: -1, off: 40, drop: 22, width: 26, from: 20, to: 420 }] }, // a ridge with a drop on both sides
  211: { rise: [[130, -6], [270, -14], [410, -10]], bowl: 0.08 }, // down through the treeline
  212: { rise: [[190, -4], [360, -10], [520, -2], [640, 6]], bowl: 0.05, mounds: [{ s: 643, o: 0, r: 30, h: 4 }] }, // a lake in the valley
  213: { rise: [[60, -6], [130, -16], [240, -20]], bowl: 0.06 }, // down the scree
  214: { rise: [[100, 8], [220, 20], [330, 26], [430, 24]], bowl: 0.07, mounds: [{ s: 430, o: 0, r: 30, h: 4.5 }] }, // up to the pinnacle
  215: { rise: [[100, -3], [220, -6], [410, 0]], bowl: 0.06 },
  216: { rise: [[190, 6], [360, 10], [500, 4], [640, 8]], bowl: 0.1 }, // old growth on the shoulder
  217: { rise: [[40, -6], [110, -14], [210, -12]], bowl: 0.06 }, // a tee on the point
  218: { rise: [[150, 6], [320, 16], [480, 26], [630, 30]], bowl: 0.06, mounds: [{ s: 644, o: 0, r: 30, h: 4.5 }] }, // all the way up to the summit
};

/* ---------- the eighteen ---------- */

const HOLE_SPECS = [
  // 1: a gentle opener: wide fairway, an S bend, one tree to think about and a pond that only the greedy find
  { id: 1, note: "A wide-open start. Mind the lone tree in the fairway, keep clear of the pond, and do not run past the basket: the ground drops away behind it.", name: 'Fairway Opener', par: 4, path: trail(0, 36, [[120, 6, 36], [140, -10, 34], [130, 6, 30]]), wind: { mph: 4, from: 200 },
    woods: [{ side: -1, dense: 0.45 }, { side: 1, dense: 0.45 }], trees: [[232, -16, 4.4, 60]], shrubs: [[170, 40], [190, 44]],
    ponds: [{ s: 318, o: 58, rx: 28, ry: 36 }], front: 2 },
  // 2: a narrow corridor through the pines: a tree in the middle you throw over, a gap in the right wall
  { id: 2, note: "A tunnel of pines. Throw over the tree in the middle, or shape it down the lane.", name: 'The Tunnel', par: 3, path: trail(35, 15, [[110, -6, 13], [125, 12, 12]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2, d: 5 }, { side: 1, dense: 0.95, rows: 2, d: 5, gaps: [[120, 150]] }],
    trees: [[112, -3, 3.4, 36]], front: 1 },
  // 3: a dogleg left: the inside of the corner is low shrubs you can cut over, the outside is wall to wall pine
  { id: 3, note: "A dogleg left. Trees reach in from the right then the left, so shape it left and right before the corner, then follow it round or fly the shrubs. The green is raised: a miss rolls off.", name: 'Left Bender', par: 4, path: trail(0, 32, [[200, 0, 30], [220, -62, 24]]), wind: { mph: 7, from: 90 },
    woods: [{ side: 1, dense: 0.9, rows: 2, to: 330 }, { side: -1, dense: 0.75, from: 26, to: 150 }, { side: -1, dense: 0.7, from: 270 }],
    shrubs: [[188, -30], [198, -34], [208, -29], [218, -36], [204, -44]], trees: [[236, -18, 4.6, 66]],
    staggers: [{ s0: 80, s1: 140, every: 60, reach: 0.4, sides: [1, -1] }], guards: [{ side: 1, back: 60, off: 13, n: 2 }],
    mando: { s: 196, o: -33, side: -1 } }, // some days, no flying the shrubs: the post is on the inside of the corner
  // 4: a long S, a creek across the middle with one dry ford on the right
  { id: 4, note: "A long S with a creek across it. The only dry crossing is the ford on the right, and past it the trees reach in from both sides.", name: 'Ford Crossing', par: 5, path: trail(0, 38, [[160, 0, 38], [170, 28, 34], [150, -50, 34], [130, 22, 30]]), wind: { mph: 8, from: 310 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], creeks: [{ s: 300, w: 24, gap: [8, 30] }],
    trees: [[110, 14, 4.4, 60], [420, -12, 4.2, 58]], groves: [{ s: 360, o: 40, n: 4, spread: 14 }], mando: { s: 168, o: 38, side: 1 },
    staggers: [{ s0: 400, s1: 530, every: 65, reach: 0.4, sides: [-1, 1] }], guards: [{ side: -1, back: 58, off: 14, n: 2 }] },
  // 5: a pond between you and the basket: carry it, or play the long way round the right
  { id: 5, note: "The pond is in front of the basket. Carry it, or bend the throw out round the right.", name: 'Water Carry', par: 3, path: trail(-20, 28, [[115, 0, 28], [135, 38, 24]]), wind: { mph: 9, from: 250 },
    woods: [{ side: -1, dense: 0.4 }, { side: 1, dense: 0.4 }], ponds: [{ s: 170, o: -30, rx: 48, ry: 46 }], front: 2 },
  // 6: wide open prairie running northeast into a headwind, with groves to play around
  { id: 6, note: "Open prairie into the wind. Plan around the groves and keep the disc low; a tree guards the right of the basket and the land drops away behind it.", name: 'Prairie', par: 4, path: trail(48, 50, [[220, -8, 50], [225, 10, 44]]), wind: { mph: 14, from: 45 },
    woods: [{ side: -1, d: 22, dense: 0.5 }, { side: 1, d: 22, dense: 0.5 }], groves: [{ s: 120, o: -34, n: 6, spread: 20 }, { s: 250, o: 26, n: 7, spread: 24 }, { s: 350, o: -22, n: 5, spread: 16 }], trees: [[190, 0, 5.6, 78]],
    guards: [{ side: 1, back: 62, off: 18, n: 2 }] },
  // 7: a cliff down the right: miss that way and it is out of bounds
  { id: 7, note: "The cliff is on your right: anything out there is out of bounds. Trees reach in from the left, so the safe line is a narrow one down the right.", name: 'Cliffside', par: 4, path: trail(5, 32, [[200, -6, 30], [205, -10, 28]]), wind: { mph: 9, from: 270 },
    woods: [{ side: -1, dense: 0.85, rows: 2 }], oob: [{ s0: 40, s1: 420, o0: 46, o1: 170 }], shrubs: [[240, 36]], trees: [[260, -8, 4.4, 62]],
    staggers: [{ s0: 110, s1: 320, every: 70, reach: 0.4, sides: [-1] }] },
  // 8: a zig-zag through the pines: three bends, three shaped throws
  { id: 8, note: "A lazy S through the pines. Shape one left, then one right, or cut the corners over the shrubs. The green is raised and sheds a miss.", name: 'Pinball', par: 4, path: trail(-18, 38, [[125, 0, 38], [125, 44, 36], [125, -68, 34], [115, 46, 32]]), wind: { mph: 5, from: 160 },
    woods: [{ side: -1, dense: 0.7, rows: 1 }, { side: 1, dense: 0.7, rows: 1 }],
    // low shrubs on the inside of each bend: you can fly the corner if you dare
    shrubs: [[130, 50], [141, 54], [152, 50], [250, -52], [262, -56], [274, -52]], front: 2 },
  // 9: a stand of trees splits the fairway: the left is longer and safe, the right is a shortcut beside the water
  { id: 9, note: "A stand of trees splits the fairway. Left is long and safe, right is short beside the water, and the land drops away behind the basket.", name: 'Split Decision', par: 4, path: trail(28, 40, [[200, -6, 40], [200, 8, 38]]), wind: { mph: 6, from: 120 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], groves: [{ s: 215, o: 0, n: 11, spread: 24, h: [52, 70] }],
    ponds: [{ s: 235, o: 76, rx: 36, ry: 52 }], front: 2, guards: [{ side: 1, back: 52, off: 16, n: 1 }] },
  // 10: one giant oak guards the front, and water waits behind the basket
  { id: 10, note: "One giant oak guards the front and water waits behind. Land it soft.", name: 'Big Oak', par: 3, path: trail(-35, 26, [[130, 4, 24], [125, -4, 24]]), wind: { mph: 6, from: 30 },
    woods: [{ side: -1, dense: 0.35 }, { side: 1, dense: 0.35 }], trees: [[118, 2, 7, 96]], shrubs: [[200, -14], [206, 12], [214, -6]],
    ponds: [{ s: 300, o: 0, rx: 70, ry: 24 }], backstop: false, drops: [[212, 0]] }, // (water behind the basket: a designated drop zone in front of the green, so a long one does not leave you putting back from the far side)
  // 11: out, around and back: the basket is close to the tee but a wall of woods stands between
  { id: 11, note: "The basket looks close, but a wall of trees runs between. Go out, round and back.", name: 'Switchback', par: 5, path: trail(0, 34, [[200, 0, 34], [175, 90, 30], [215, 90, 26]]), wind: { mph: 7, from: 90 },
    woods: [{ side: -1, dense: 0.6, from: 26, to: 190 }, { side: 1, dense: 0.85, rows: 2, from: 0, to: 195 }, { side: 1, dense: 0.8, rows: 2, from: 380 }],
    // a row of trees from the edge of the course up the middle: the short way across to the basket is not a way
    padBottom: 150, rows: [{ s0: -150, s1: 60, o: 90 }, { s0: 60, s1: 190, o: 74 }], groves: [{ s: 200, o: 0, n: 5, spread: 20 }, { s: 520, o: 60, n: 6, spread: 26 }],
    staggers: [{ s0: 440, s1: 560, every: 60, reach: 0.4, sides: [-1] }], guards: [{ side: -1, back: 60, off: 14, n: 2 }] },
  // 12: a dogleg right with the pond on the inside of the corner: bite it off or play the safe line out left
  { id: 12, note: "Off a knoll, a dogleg right with the pond on the inside of the corner. Trees reach in from both sides before it, then bite it off or play out left. The green is raised.", name: 'Right Hook', par: 4, path: trail(0, 34, [[210, 0, 32], [210, 64, 26]]), wind: { mph: 8, from: 280 },
    woods: [{ side: -1, dense: 0.85, rows: 2 }, { side: 1, dense: 0.6, from: 26, to: 150 }, { side: 1, dense: 0.8, from: 300 }],
    ponds: [{ s: 222, o: 56, rx: 46, ry: 44 }], trees: [[250, -14, 4.6, 64]], mando: { s: 214, o: 34, side: 1 },
    staggers: [{ s0: 100, s1: 160, every: 60, reach: 0.4, sides: [-1, 1] }], guards: [{ side: -1, back: 58, off: 14, n: 2 }] },
  // 13: ponds all down the hole: pick the dry lane
  { id: 13, note: "Ponds all down the hole. Pick the dry lane and commit.", name: 'Archipelago', par: 3, path: trail(15, 40, [[140, 6, 38], [145, -6, 36]]), wind: { mph: 10, from: 330 },
    woods: [{ side: -1, dense: 0.3 }, { side: 1, dense: 0.3 }],
    ponds: [{ s: 90, o: -26, rx: 22, ry: 30 }, { s: 150, o: 24, rx: 26, ry: 32 }, { s: 215, o: -22, rx: 24, ry: 26 }, { s: 262, o: 28, rx: 20, ry: 24 }] },
  // 14: a long lake runs down the left; the wind pushes you toward it
  { id: 14, note: "Off a high tee, the lake runs down the left and the wind pushes you into it. Trees reach in from the right, so hold a narrow line between them and the water.", name: 'Creekside', par: 4, path: trail(0, 34, [[140, 0, 34], [150, -24, 30], [130, 20, 28]]), wind: { mph: 6, from: 90 },
    woods: [{ side: 1, dense: 0.7, rows: 2 }], ponds: [{ s: 200, o: -52, rx: 22, ry: 130, n: 16 }], trees: [[130, 6, 4.4, 60]], front: 2,
    staggers: [{ s0: 190, s1: 320, every: 65, reach: 0.4, sides: [1] }] },
  // 15: a causeway between lakes: stay on the grass for three shots
  { id: 15, note: "A causeway between two lakes. Stay on the grass for three shots.", name: 'Peninsula', par: 5, path: trail(0, 34, [[170, 0, 34], [150, -20, 28], [150, 22, 26], [120, 0, 30]]), wind: { mph: 9, from: 200 },
    woods: [{ side: -1, dense: 0.6, from: 26, to: 100 }, { side: 1, dense: 0.6, from: 26, to: 100 }],
    ponds: [{ s: 250, o: -72, rx: 58, ry: 80, n: 14 }, { s: 250, o: 74, rx: 58, ry: 80, n: 14 }, { s: 420, o: -66, rx: 50, ry: 60, n: 14 }, { s: 420, o: 68, rx: 50, ry: 60, n: 14 }] },
  // 16: a wall of trees across the hole with two gates: wide and long to the left, tight and straight on the right
  { id: 16, note: "A wall of trees with two gates: wide and long on the left, tight and straight on the right. Nothing behind the basket but a slope: do not go long.", name: 'The Gate', par: 4, path: trail(-25, 36, [[200, 10, 36], [200, -6, 36]]), wind: { mph: 5, from: 180 },
    woods: [{ side: -1, dense: 0.7 }, { side: 1, dense: 0.7 }], walls: [{ s: 200, from: -90, to: 90, gaps: [[-58, -30], [26, 36]], h: [72, 94] }], shrubs: [[320, 20], [330, -22]], front: 2,
    guards: [{ side: 1, back: 58, off: 14, n: 2 }] },
  // 17: Marebear's parlor: little room, lots of pine
  { id: 17, note: "Not much room and a lot of pine. Be patient, and keep an eye on her handbag.", name: "Marebear's Parlor", par: 3, path: trail(-8, 22, [[225, 10, 20]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2 }, { side: 1, dense: 0.95, rows: 2 }], trees: [[100, -8, 4.4, 66], [135, 12, 4.4, 62], [175, -2, 4.6, 70]], front: 3 },
  // 18: home: a big pond in the valley. Play round the left, or have a go over the water
  { id: 18, note: "A big pond fills the valley. Play round the left, or have a go over the water. The green is raised and trees guard its left.", name: 'Valley Home', par: 4, path: trail(0, 40, [[170, 0, 40], [160, -35, 34], [150, 35, 26]]), wind: { mph: 12, from: 235 },
    woods: [{ side: -1, dense: 0.7, rows: 2 }, { side: 1, dense: 0.5, from: 26, to: 120 }, { side: 1, dense: 0.7, from: 380 }],
    ponds: [{ s: 262, o: 66, rx: 58, ry: 62, n: 14 }], oob: [{ s0: 420, s1: 600, o0: -80, o1: -45 }], trees: [[320, 10, 4.6, 66]], guards: [{ side: -1, back: 56, off: 15, n: 2 }] },
];

// Holes 1-9 are the front nine, 10-18 the back; a nine-hole round is the front nine.
export const HOLES = HOLE_SPECS.map(build);

/* ---------- the second course: Quarry Ridge ---------- */
// Ids 101-118 (a hole's id is its name everywhere: the ground, the day's conditions, the match), numbered 1-18 on the card (`hole.n`).
// An old limestone quarry and the ridge meadows above it: bigger drops, pits of water, open meadow and tight alleys, and the technical
// features (staggered trees, guarded and raised greens) throughout.
const HOLE_SPECS2 = [
  // 101: a wide meadow to open, a lone tree, a pit pond by the green
  { id: 101, note: "A wide meadow to start. One lone tree in the fairway, a small pit pond right of the basket, and the ground drops away behind it.", name: 'Quarry Gate', par: 4, path: trail(20, 38, [[150, 0, 38], [130, 18, 34], [120, -8, 30]]), wind: { mph: 5, from: 250 },
    woods: [{ side: -1, dense: 0.45 }, { side: 1, dense: 0.45 }], trees: [[170, 14, 4.6, 62]], shrubs: [[200, -38], [212, -42]], ponds: [{ s: 330, o: 52, rx: 22, ry: 28 }], front: 2 },
  // 102: off the ledge, down into the pit: a pond short and left, a guard tree right
  { id: 102, note: "Off the ledge and down into the pit. The pond is short and left, a tree guards the right, and the green is raised.", name: 'Limestone Steps', par: 3, path: trail(-30, 26, [[130, 6, 26], [110, -4, 24]]), wind: { mph: 8, from: 100 },
    woods: [{ side: -1, dense: 0.6 }, { side: 1, dense: 0.6 }], ponds: [{ s: 150, o: -34, rx: 30, ry: 36 }], guards: [{ side: 1, back: 48, off: 14, n: 1 }], front: 1 },
  // 103: two hedgerows across the meadow, the gaps on opposite sides: an S through the gates
  { id: 103, note: "Two hedgerows cross the meadow. The first gate is on the left, the second on the right: a left-to-right S.", name: 'Hedgerow', par: 4, path: trail(60, 40, [[140, 0, 40], [140, -10, 36], [120, 12, 32]]), wind: { mph: 9, from: 300 },
    woods: [{ side: -1, dense: 0.3 }, { side: 1, dense: 0.3 }], walls: [{ s: 130, from: -80, to: 80, gaps: [[-40, -14]], h: [60, 80] }, { s: 270, from: -80, to: 80, gaps: [[16, 44]], h: [60, 80] }], shrubs: [[330, 18], [340, -20]], front: 2 },
  // 104: the long one: a cliff left, a creek with a dry ford, then trees reaching in
  { id: 104, note: "The long hole. A drop on the left, a creek with one dry ford, and past it trees that reach in from both sides.", name: 'The Long Haul', par: 5, path: trail(-10, 36, [[180, 0, 36], [170, 14, 34], [160, -18, 32], [150, 10, 30]]), wind: { mph: 11, from: 20 },
    woods: [{ side: 1, dense: 0.5 }, { side: -1, dense: 0.5, from: 200 }], creeks: [{ s: 340, w: 22, gap: [-30, -6] }], oob: [{ s0: 40, s1: 200, o0: -70, o1: -44 }],
    staggers: [{ s0: 430, s1: 560, every: 65, reach: 0.4, sides: [1, -1] }], guards: [{ side: 1, back: 60, off: 14, n: 2 }], groves: [{ s: 260, o: 30, n: 5, spread: 16 }], front: 1 },
  // 105: carry the spillway or bend it round the right
  { id: 105, note: "A tee on the spillway wall. Carry the water, or bend it out round the right; a tree guards the left of the basket.", name: 'Spillway', par: 3, path: trail(-5, 28, [[110, 0, 28], [120, 30, 24]]), wind: { mph: 7, from: 160 },
    woods: [{ side: -1, dense: 0.4 }, { side: 1, dense: 0.4 }], ponds: [{ s: 160, o: -30, rx: 44, ry: 40 }], guards: [{ side: -1, back: 40, off: 12, n: 1 }], front: 1 },
  // 106: a birch alley: trees reach in from alternating sides
  { id: 106, note: "A birch alley. The trees reach in from the left, then the right, then the left: shape every throw.", name: 'Birch Alley', par: 4, path: trail(10, 22, [[130, 0, 22], [150, 8, 20], [120, -12, 20]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2, d: 5 }, { side: 1, dense: 0.95, rows: 2, d: 5 }], staggers: [{ s0: 80, s1: 320, every: 60, reach: 0.38, sides: [1, -1] }], guards: [{ side: -1, back: 50, off: 10, n: 1 }], front: 1 },
  // 107: the overlook: a high tee, a long drop on the right
  { id: 107, note: "The overlook: a high tee, and the drop on the right is out of bounds. The wind pushes you toward it.", name: 'Overlook', par: 4, path: trail(-50, 34, [[110, 0, 34], [150, -16, 32], [150, 10, 28]]), wind: { mph: 12, from: 80 },
    woods: [{ side: -1, dense: 0.7, rows: 2 }], oob: [{ s0: 30, s1: 400, o0: 48, o1: 160 }], shrubs: [[230, 36]], trees: [[250, -8, 4.4, 62]], guards: [{ side: -1, back: 56, off: 14, n: 1 }] },
  // 108: a double dogleg with a pond on each inside corner: bite them off or play the long way
  { id: 108, note: "An S with a pond on the inside of each corner. Bite them off over the water, or play the long way round the outside.", name: 'Dogleg Dam', par: 5, path: trail(0, 34, [[180, 0, 34], [150, 48, 30], [170, -70, 30], [110, 30, 28]]), wind: { mph: 9, from: 140 },
    woods: [{ side: -1, dense: 0.6 }, { side: 1, dense: 0.6 }], ponds: [{ s: 222, o: 50, rx: 40, ry: 46 }, { s: 385, o: -52, rx: 44, ry: 48 }], guards: [{ side: 1, back: 58, off: 15, n: 2 }], front: 1 },
  // 109: open meadow into the wind: groves to play round and a raised green
  { id: 109, note: "Open meadow in a stiff wind. Play round the groves; the green is raised and a tree guards its right.", name: 'Meadow Run', par: 3, path: trail(70, 46, [[260, 6, 44]]), wind: { mph: 14, from: 250 },
    woods: [{ side: -1, d: 22, dense: 0.35 }, { side: 1, d: 22, dense: 0.35 }], groves: [{ s: 120, o: -30, n: 6, spread: 18 }, { s: 190, o: 28, n: 5, spread: 16 }], guards: [{ side: 1, back: 52, off: 16, n: 1 }] },
  // 110: pits of water down both sides of a narrow strip
  { id: 110, note: "Pits of water down both sides of a narrow strip. Keep it in the middle and do not be greedy.", name: 'Pit Boss', par: 4, path: trail(-20, 30, [[140, 0, 30], [140, 8, 28], [130, -6, 28]]), wind: { mph: 8, from: 330 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], ponds: [{ s: 120, o: -50, rx: 24, ry: 40 }, { s: 150, o: 52, rx: 22, ry: 34 }, { s: 260, o: -46, rx: 26, ry: 42 }, { s: 290, o: 50, rx: 24, ry: 36 }], guards: [{ side: 1, back: 54, off: 14, n: 1 }], front: 1 },
  // 111: a blind crest: throw over the hill and trust it; trees reach in on the way down
  { id: 111, note: "A blind crest: throw over the hill and trust it. Past the top the trees reach in from both sides, and the green has nothing behind it.", name: 'Blind Crest', par: 4, path: trail(35, 32, [[200, 0, 32], [200, -12, 30]]), wind: { mph: 6, from: 190 },
    woods: [{ side: -1, dense: 0.8 }, { side: 1, dense: 0.8 }], staggers: [{ s0: 290, s1: 350, every: 60, reach: 0.4, sides: [-1, 1] }], guards: [{ side: 1, back: 56, off: 14, n: 2 }], front: 1 },
  // 112: a cathedral of pines: find the windows between the groves
  { id: 112, note: "A cathedral of tall pines. Find the windows between the groves and shape through them.", name: 'Cathedral', par: 4, path: trail(-15, 36, [[150, 0, 36], [140, 10, 34], [110, -6, 30]]), wind: { mph: 4, from: 200 },
    woods: [{ side: -1, dense: 0.7 }, { side: 1, dense: 0.7 }], groves: [{ s: 100, o: -20, n: 8, spread: 20, h: [70, 90] }, { s: 100, o: 24, n: 8, spread: 18, h: [70, 90] }, { s: 230, o: -8, n: 9, spread: 22, h: [70, 90] }, { s: 320, o: 22, n: 6, spread: 16, h: [70, 90] }], guards: [{ side: -1, back: 56, off: 14, n: 1 }], front: 1 },
  // 113: stepping stones: ponds ring the green, the dry line is in the middle
  { id: 113, note: "Stepping stones: ponds on both sides, and the dry line down the middle. Commit to it.", name: 'Stepping Stones', par: 3, path: trail(25, 32, [[140, 0, 30], [150, -10, 26]]), wind: { mph: 7, from: 60 },
    woods: [{ side: -1, dense: 0.3 }, { side: 1, dense: 0.3 }], ponds: [{ s: 120, o: -40, rx: 36, ry: 46 }, { s: 190, o: 36, rx: 34, ry: 40 }, { s: 250, o: -30, rx: 28, ry: 28 }, { s: 250, o: 34, rx: 26, ry: 28 }] },
  // 114: all the way up the ridge, with trees reaching in as you climb
  { id: 114, note: "All the way up the ridge, into the wind. Throws come down short, and the trees reach in from both sides on the climb.", name: 'Ridgeback', par: 5, path: trail(-60, 34, [[160, 0, 34], [160, -14, 32], [150, 16, 30], [130, -8, 28]]), wind: { mph: 10, from: 240 },
    woods: [{ side: -1, dense: 0.6 }, { side: 1, dense: 0.6 }], staggers: [{ s0: 220, s1: 440, every: 75, reach: 0.4, sides: [1, -1] }], guards: [{ side: -1, back: 60, off: 15, n: 2 }], front: 1 },
  // 115: low and wet: two creeks, the fords on opposite sides
  { id: 115, note: "Low and wet. Two creeks, and the dry fords are on opposite sides: cross left, then right.", name: 'Lowlands', par: 4, path: trail(80, 36, [[140, 0, 36], [130, -12, 34], [150, 8, 30]]), wind: { mph: 6, from: 350 },
    woods: [{ side: -1, dense: 0.4 }, { side: 1, dense: 0.4 }], creeks: [{ s: 150, w: 20, gap: [-8, 22] }, { s: 290, w: 20, gap: [-30, -4] }], shrubs: [[330, 20]], front: 2 },
  // 116: a ridge with a drop on both sides: short, narrow and unforgiving
  { id: 116, note: "A narrow ridge with a drop on both sides: short, straight and unforgiving. Out of bounds both ways.", name: 'Cliffhanger', par: 3, path: trail(0, 20, [[220, 4, 20]]), wind: { mph: 6, from: 300 },
    woods: [{ side: -1, dense: 0.4 }, { side: 1, dense: 0.4 }], oob: [{ s0: 30, s1: 230, o0: -90, o1: -30 }, { s0: 30, s1: 230, o0: 30, o1: 90 }] },
  // 117: an old orchard: hedge lines and orchard rows make lanes, with trees reaching into them
  { id: 117, note: "An old orchard. Hedge lines make a lane, the orchard rows outside it are open, and trees reach into the lane.", name: 'Orchard', par: 4, path: trail(100, 34, [[140, 0, 34], [140, 6, 34], [120, -6, 30]]), wind: { mph: 7, from: 320 },
    woods: [], forest: false, rows: [{ s0: 70, s1: 380, o: -34, gap: 7 }, { s0: 70, s1: 380, o: 34, gap: 7 }, { s0: 60, s1: 390, o: -66, gap: 24 }, { s0: 60, s1: 390, o: 66, gap: 24 }],
    staggers: [{ s0: 120, s1: 320, every: 65, reach: 0.3, sides: [1, -1] }], guards: [{ side: 1, back: 54, off: 14, n: 1 }], shrubs: [[40, 30]], front: 1 },
  // 118: home: a big pond to carry or lay up short of, guard trees and a raised green
  { id: 118, note: "Home. A big pond: carry it for the shortcut, or lay up short of it. Trees reach in on the last leg and guard the left of a raised green.", name: 'Quarry Home', par: 5, path: trail(0, 38, [[170, 0, 38], [160, -30, 34], [140, 40, 30], [130, -12, 26]]), wind: { mph: 12, from: 235 },
    woods: [{ side: -1, dense: 0.6 }, { side: 1, dense: 0.5 }], ponds: [{ s: 300, o: 62, rx: 54, ry: 66, n: 14 }, { s: 430, o: -50, rx: 30, ry: 32 }], staggers: [{ s0: 440, s1: 500, every: 60, reach: 0.4, sides: [1, -1] }], guards: [{ side: -1, back: 56, off: 15, n: 2 }], front: 1 },
];
export const HOLES2 = HOLE_SPECS2.map(build);

/* ---------- the third course: Timberline Peak ---------- */
// Ids 201-218. Mountain golf: broad fairways (the half-widths are 40 to 70 feet, not 30), tall pine, boulder fields that stop a flat throw and are flown over,
// tarns and streams, and mandatories that are always there (`mandoAlways`): the red post is on the line you must not take.
const HOLE_SPECS3 = [
  // 201: the foot of the trail: a wide meadow, two lone pines, a rock garden on the left
  { id: 201, note: "The foot of the trail: a wide meadow with two lone pines to play around and a rock garden down the left.", name: 'Trailhead', par: 4, path: trail(10, 58, [[160, 0, 60], [140, 20, 56], [110, -10, 50]]), wind: { mph: 7, from: 260 }, pine: 0.7,
    woods: [{ side: -1, dense: 0.45, d: 20 }, { side: 1, dense: 0.45, d: 20 }], trees: [[170, 22, 5.2, 72], [230, -20, 5, 68]], boulders: [{ s: 190, o: -48, n: 4, spread: 12 }], shrubs: [[300, 30]], front: 2 },
  // 202: a pass between two boulder fields, a big rock in the lane, and a post that keeps you off the left
  { id: 202, note: "A pass between two boulder fields with a big rock in the lane. Mandatory: pass right of the red post.", name: 'Boulder Pass', par: 3, path: trail(-25, 46, [[250, 6, 44]]), wind: { mph: 11, from: 300 }, pine: 0.7, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 18 }, { side: 1, dense: 0.5, d: 18 }], boulders: [{ s: 120, o: -36, n: 8, spread: 18 }, { s: 150, o: 38, n: 8, spread: 18 }], rocks: [[175, 6, 5, 10]], mando: { s: 105, o: -8, side: -1, len: 110 } },
  // 203: a tarn on the outside of the corner: mandatory, you may not cut it
  { id: 203, note: "A tarn fills the outside of the corner. Mandatory: pass left of the red post, so you cannot cut over the water.", name: 'The Tarn', par: 4, path: trail(35, 54, [[170, 0, 56], [150, -32, 52], [110, 14, 46]]), wind: { mph: 8, from: 120 }, pine: 0.7, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 20 }, { side: 1, dense: 0.5, d: 20 }], ponds: [{ s: 215, o: 52, rx: 56, ry: 64 }], mando: { s: 140, o: 30, side: 1, len: 90 }, guards: [{ side: 1, back: 56, off: 16, n: 1 }], front: 1 },
  // 204: the long way round: switchbacks up the slope, a stream with a ford, boulders on the outside of each turn
  { id: 204, note: "Switchbacks up the slope. A stream with a dry ford across the middle, boulders on the outside of each turn, and a post on the first: pass right of it.", name: 'Switchbacks', par: 5, path: trail(0, 52, [[190, 0, 54], [160, 55, 50], [170, -75, 50], [140, 30, 46]]), wind: { mph: 9, from: 330 }, pine: 0.75, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 18 }, { side: 1, dense: 0.5, d: 18 }], creeks: [{ s: 330, w: 20, gap: [-20, 14] }], boulders: [{ s: 260, o: 60, n: 7, spread: 20 }, { s: 470, o: -56, n: 7, spread: 20 }], mando: { s: 195, o: -10, side: -1, len: 100 }, guards: [{ side: -1, back: 60, off: 16, n: 2 }], front: 1 },
  // 205: across the snowmelt: a dry ford on the left, a guard tree right
  { id: 205, note: "Across the snowmelt stream: the water is wide and the dry ford is on the left. Mandatory: pass left of the red post.", name: 'Snowmelt', par: 3, path: trail(60, 44, [[140, 0, 44], [120, 16, 40]]), wind: { mph: 10, from: 20 }, pine: 0.7, mandoAlways: true,
    woods: [{ side: -1, dense: 0.45, d: 18 }, { side: 1, dense: 0.45, d: 18 }], creeks: [{ s: 150, w: 18, gap: [-20, 12] }], mando: { s: 100, o: 18, side: 1, len: 90 }, guards: [{ side: 1, back: 48, off: 14, n: 1 }], front: 1 },
  // 206: a spruce alley: stands of spruce reach into a wide fairway from alternating sides
  { id: 206, note: "A spruce alley: stands of spruce reach in from the left, then the right, then the left. Plenty of room, but you have to shape it.", name: 'Spruce Alley', par: 4, path: trail(-10, 50, [[140, 0, 50], [150, 10, 48], [120, -12, 44]]), wind: { mph: 6, from: 200 }, pine: 0.9,
    woods: [{ side: -1, dense: 0.8, rows: 2, d: 14 }, { side: 1, dense: 0.8, rows: 2, d: 14 }], staggers: [{ s0: 80, s1: 300, every: 70, reach: 0.35, sides: [-1, 1] }], guards: [{ side: -1, back: 56, off: 16, n: 2 }], front: 1 },
  // 207: a high meadow in a stiff wind: boulders scattered through it and a mandatory
  { id: 207, note: "A high meadow in a stiff wind, boulders scattered through it. Mandatory: pass left of the red post. The green is raised.", name: 'High Meadow', par: 4, path: trail(70, 70, [[220, 6, 70], [200, -8, 64]]), wind: { mph: 15, from: 250 }, pine: 0.7, mandoAlways: true,
    woods: [{ side: -1, d: 30, dense: 0.3 }, { side: 1, d: 30, dense: 0.3 }], boulders: [{ s: 140, o: -40, n: 5, spread: 16 }, { s: 260, o: 36, n: 5, spread: 16 }], mando: { s: 200, o: 30, side: 1, len: 100 }, guards: [{ side: 1, back: 60, off: 18, n: 1 }] },
  // 208: the avalanche chute: a boulder field down the right, a drop on the left, a post on the line
  { id: 208, note: "The avalanche chute: a field of boulders across the right, a drop on the left that is out of bounds. Mandatory: pass right of the red post.", name: 'Avalanche Chute', par: 5, path: trail(-40, 50, [[200, 0, 50], [190, 22, 48], [170, -18, 44]]), wind: { mph: 12, from: 140 }, pine: 0.75, mandoAlways: true,
    woods: [{ side: 1, dense: 0.5, d: 18 }, { side: -1, dense: 0.5, d: 18 }], boulders: [{ s: 260, o: 30, n: 14, spread: 34, h: [6, 14] }, { s: 390, o: -34, n: 10, spread: 26 }], oob: [{ s0: 40, s1: 300, o0: -90, o1: -56 }], mando: { s: 150, o: -8, side: -1, len: 100 }, guards: [{ side: 1, back: 60, off: 16, n: 2 }], front: 1 },
  // 209: a bowl of rock and pine with a tarn right behind the basket
  { id: 209, note: "A cirque: a bowl of rock and pine with a tarn right behind the basket, so do not go long. Mandatory: pass right of the red post.", name: 'Cirque', par: 3, path: trail(30, 46, [[230, 0, 46]]), wind: { mph: 7, from: 80 }, pine: 0.8, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 16 }, { side: 1, dense: 0.5, d: 16 }], boulders: [{ s: 130, o: -44, n: 6, spread: 14 }, { s: 130, o: 46, n: 6, spread: 14 }], ponds: [{ s: 272, o: 0, rx: 56, ry: 24 }], mando: { s: 120, o: -10, side: -1, len: 100 }, guards: [{ side: -1, back: 44, off: 14, n: 1 }], backstop: false },
  // 210: the ridge: a drop and out of bounds on both sides of a good broad back
  { id: 210, note: "A ridge with a drop on both sides, out of bounds both ways. The back of it is broad, but a mistake is gone.", name: 'Ridge Walk', par: 4, path: trail(0, 40, [[150, 0, 40], [130, 12, 38], [130, -14, 36]]), wind: { mph: 14, from: 300 }, pine: 0.7,
    woods: [{ side: -1, dense: 0.3, d: 24 }, { side: 1, dense: 0.3, d: 24 }], oob: [{ s0: 30, s1: 410, o0: -130, o1: -52 }, { s0: 30, s1: 410, o0: 52, o1: 130 }], guards: [{ side: 1, back: 58, off: 14, n: 1 }] },
  // 211: down through the treeline: two gates, left then right
  { id: 211, note: "Down through the treeline. The first gate is on the left, the second on the right: a left-to-right S through tall spruce.", name: 'Treeline', par: 4, path: trail(80, 54, [[130, 0, 54], [150, 0, 50], [130, 0, 46]]), wind: { mph: 8, from: 160 }, pine: 0.9,
    woods: [{ side: -1, dense: 0.5, d: 18 }, { side: 1, dense: 0.5, d: 18 }], walls: [{ s: 150, from: -90, to: 90, gaps: [[-40, -8]], h: [70, 95] }, { s: 290, from: -90, to: 90, gaps: [[8, 40]], h: [70, 95] }], front: 1 },
  // 212: the glacier lake: the big carry, or round the left
  { id: 212, note: "A glacier lake fills the valley: carry it for the shortcut, or play round the left. Mandatory on the tee: pass left of the red post.", name: 'Glacier Lake', par: 5, path: trail(0, 56, [[190, 0, 56], [170, -28, 52], [160, 40, 48], [120, -10, 44]]), wind: { mph: 11, from: 230 }, pine: 0.7, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 20 }, { side: 1, dense: 0.4, d: 20 }], ponds: [{ s: 330, o: 76, rx: 84, ry: 110, n: 16 }], mando: { s: 170, o: 20, side: 1, len: 110 }, guards: [{ side: 1, back: 60, off: 16, n: 2 }], front: 1 },
  // 213: the scree: a short hole straight down a slope of low rock
  { id: 213, note: "Down the scree: a short hole of low rock all the way down the slope. Fly it, or pick a line through.", name: 'Scree Run', par: 3, path: trail(-20, 44, [[240, 4, 44]]), wind: { mph: 9, from: 40 }, pine: 0.7,
    woods: [{ side: -1, dense: 0.4, d: 20 }, { side: 1, dense: 0.4, d: 20 }], boulders: [{ s: 120, o: 0, n: 12, spread: 34, h: [3, 7] }, { s: 190, o: -20, n: 8, spread: 24, h: [3, 7] }], guards: [{ side: -1, back: 46, off: 14, n: 1 }] },
  // 214: the pinnacle: all uphill to a raised green on the knoll
  { id: 214, note: "The pinnacle: uphill all the way to a raised green on the knoll, so throws come down short. Mandatory: pass left of the red post.", name: 'Pinnacle', par: 4, path: trail(30, 52, [[160, 0, 54], [150, -14, 50], [120, 10, 46]]), wind: { mph: 10, from: 210 }, pine: 0.75, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 18 }, { side: 1, dense: 0.5, d: 18 }], boulders: [{ s: 280, o: -40, n: 6, spread: 16 }], mando: { s: 120, o: 14, side: 1, len: 90 }, guards: [{ side: 1, back: 56, off: 16, n: 2 }], front: 1 },
  // 215: the brook: a stream across twice, the fords on opposite sides
  { id: 215, note: "A brook crosses the hole twice, and the dry fords are on opposite sides: cross left, then right.", name: 'Brook', par: 4, path: trail(100, 54, [[140, 0, 54], [140, -12, 50], [130, 10, 46]]), wind: { mph: 6, from: 330 }, pine: 0.6,
    woods: [{ side: -1, dense: 0.4, d: 22 }, { side: 1, dense: 0.4, d: 22 }], creeks: [{ s: 140, w: 16, gap: [-30, 6] }, { s: 280, w: 16, gap: [-6, 34] }], shrubs: [[330, 22]], front: 2 },
  // 216: old growth: big groves to find the lanes between
  { id: 216, note: "Old growth: big groves of ancient pine to find the lanes between, then trees that reach in. Mandatory: pass right of the red post.", name: 'Old Growth', par: 5, path: trail(-60, 56, [[190, 0, 56], [170, -20, 52], [150, 24, 48], [130, -12, 44]]), wind: { mph: 8, from: 120 }, pine: 0.8, mandoAlways: true,
    woods: [{ side: -1, dense: 0.6, d: 20 }, { side: 1, dense: 0.6, d: 20 }], groves: [{ s: 130, o: -26, n: 9, spread: 22, h: [75, 100] }, { s: 260, o: 30, n: 9, spread: 22, h: [75, 100] }, { s: 400, o: -20, n: 8, spread: 20, h: [75, 100] }], mando: { s: 200, o: -6, side: -1, len: 100 }, staggers: [{ s0: 470, s1: 530, every: 60, reach: 0.35, sides: [1, -1] }], guards: [{ side: -1, back: 60, off: 16, n: 2 }], front: 1 },
  // 217: the point: a high tee to a green on a peninsula
  { id: 217, note: "Overlook Point: a high tee over a green on a peninsula, with water on both sides. Hold the middle.", name: 'Overlook Point', par: 3, path: trail(45, 40, [[210, 6, 40]]), wind: { mph: 12, from: 270 }, pine: 0.7,
    woods: [{ side: -1, dense: 0.4, d: 20 }, { side: 1, dense: 0.4, d: 20 }], ponds: [{ s: 140, o: -44, rx: 30, ry: 40 }, { s: 150, o: 46, rx: 30, ry: 40 }], guards: [{ side: 1, back: 44, off: 14, n: 1 }] },
  // 218: the summit: the long climb home, a tarn to carry on the way, boulders, a post and a raised green
  { id: 218, note: "The summit: a long climb home. A tarn on the way, boulders at the top, and a post on the climb: pass right of it. The green is raised.", name: 'Summit Home', par: 5, path: trail(0, 58, [[180, 0, 58], [170, 34, 54], [160, -40, 50], [130, 16, 44]]), wind: { mph: 13, from: 235 }, pine: 0.75, mandoAlways: true,
    woods: [{ side: -1, dense: 0.5, d: 20 }, { side: 1, dense: 0.5, d: 20 }], ponds: [{ s: 330, o: -60, rx: 60, ry: 70, n: 14 }], boulders: [{ s: 450, o: 36, n: 8, spread: 24 }], mando: { s: 190, o: -10, side: -1, len: 110 }, guards: [{ side: -1, back: 60, off: 16, n: 2 }], front: 1 },
];
export const HOLES3 = HOLE_SPECS3.map(build);

// Hole numbers on the card (1-18 within each course) and which course a hole belongs to
HOLES.forEach((h, i) => { h.n = i + 1; h.course = 1; });
HOLES2.forEach((h, i) => { h.n = i + 1; h.course = 2; });
HOLES3.forEach((h, i) => { h.n = i + 1; h.course = 3; });
const ALL_HOLES = [...HOLES, ...HOLES2, ...HOLES3];

/** The courses a player can pick. Each is eighteen holes; a round is a practice hole, the front nine, or all eighteen. */
export const COURSES = [
  { id: 1, name: 'Pinewood Park', blurb: 'Pines, ponds and hills. Eighteen holes of woods and wind, from a wide-open start to a pond-filled valley.', holes: HOLES },
  { id: 2, name: 'Quarry Ridge', blurb: 'An old limestone quarry and the ridge above it: big drops, pits of water, blind crests and a lot of shaping.', holes: HOLES2 },
  { id: 3, name: 'Timberline Peak', blurb: 'Mountain golf: broad fairways and big height, tall pine, boulder fields, tarns and streams, and mandatories on the line.', holes: HOLES3 },
];
export const courseById = (id) => COURSES.find((c) => c.id === Number(id)) || COURSES[0];
export const holeById = (id) => ALL_HOLES.find((h) => h.id === id);
// a warm-up is three of the gentler holes: an open start, a short climb and the bluff over the pond
export const WARMUP = [1, 2, 5];
export const WARMUP2 = [101, 102, 105];
export const WARMUP3 = [201, 202, 205];
export const holesFor = (length, course = 1) => {
  const c = courseById(course);
  return length === 3 ? (c.id === 3 ? WARMUP3 : c.id === 2 ? WARMUP2 : WARMUP).map((id) => holeById(id)) : c.holes.slice(0, length === 9 ? 9 : length === 18 ? 18 : 1);
};
