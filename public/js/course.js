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
 *   creeks: { s, w, gap }  water straight across, with an optional dry ford [o0, o1]           oob: { s0, s1, o0, o1 }
 */
function build(spec) {
  const { id, name, note, par, path, wind, woods = [], trees: explicit = [], shrubs = [], groves = [], walls = [], rows = [], ponds = [], creeks = [], oob = [], backstop = true, teeWall = true, forest = true, front = 0, padBottom = 60, seed = id * 131, ground = GROUNDS[id] || {}, mando = null } = spec;
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
    const pickKind = () => { const u = rnd(); return u < 0.4 ? 'p' : u < 0.7 ? 'm' : 'o'; };
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
  return makeHole({ id, name, note, par, fairway: line, basket, wind, water, oob: zones, trees: dry, bounds, terrain, mandoSpec });
}

/* ---------- the ground of each hole ---------- */
// How the land lies (see buildField): rise is feet above the tee along the route, in [s, z] pairs, and s, o in a mound are feet along
// and to the right of it. Steepest anywhere is about one foot in five. Holes that do not say get a gentle bowl and nothing else.
const GROUNDS = {
  1: { rise: [[100, -3], [200, 2], [290, -4], [390, -2]], bowl: 0.06, mounds: [{ s: 232, o: 24, r: 26, h: 3 }] }, // a rolling start
  2: { rise: [[110, 4], [235, 13]], bowl: 0.1, mounds: [{ s: 112, o: -3, r: 18, h: 3 }] }, // uphill to the pin, a knoll under the middle tree
  3: { rise: [[120, -12], [250, -16], [426, -9]], bowl: 0.08 }, // down off the tee, up to the green
  4: { rise: [[120, 4], [240, -9], [330, -9], [470, 6], [614, 10]], bowl: 0.09 }, // the creek runs along the bottom of a valley
  5: { rise: [[40, -4], [110, -16], [252, -18]], bowl: 0.07 }, // a tee on a bluff over the pond
  6: { rise: [[90, 5], [180, -3], [290, 7], [380, 0], [445, -5]], bowl: 0.03, mounds: [{ s: 150, o: -34, r: 30, h: 4 }, { s: 330, o: 30, r: 30, h: -3 }] }, // open rolling prairie
  7: { rise: [[200, 5], [405, 9]], bowl: 0.09, shelves: [{ side: 1, off: 46, drop: 42, width: 26, from: 30, to: 430 }] }, // the cliff on the right is real
  8: { rise: [[125, -5], [250, -10], [375, 4], [496, 10]], bowl: 0.08 }, // down the first bend, up the last
  9: { rise: [[120, 4], [215, 10], [300, 2], [400, -4]], bowl: 0.08, mounds: [{ s: 215, o: 0, r: 44, h: 5 }] }, // the stand of trees is on a ridge
  10: { rise: [[70, 3], [118, 8], [190, -2], [255, -8]], bowl: 0.09 }, // the oak is on the crest, the green is down by the water
  11: { rise: [[200, 3], [390, 8], [608, -2]], bowl: 0.08 }, // out and over a low hill, home down the other side
  12: { rise: [[210, -6], [330, -4], [426, 6]], bowl: 0.08 }, // up to the green
  13: { rise: [[90, 3], [190, -3], [285, 1]], bowl: 0.1 }, // low and wet
  14: { rise: [[200, -5], [421, -3]], bowl: 0.08, mounds: [{ s: 130, o: 6, r: 20, h: 3 }] }, // the land falls away toward the lake
  15: { rise: [[100, 4], [250, 6], [420, 3], [591, -3]], bowl: 0.05, shelves: [{ side: 1, off: 38, drop: 7, width: 16, from: 150, to: 520 }, { side: -1, off: 38, drop: 7, width: 16, from: 150, to: 520 }] }, // a causeway above the lakes
  16: { rise: [[130, -6], [200, -8], [290, 4], [400, 9]], bowl: 0.08 }, // a valley, then up
  17: { rise: [[110, 6], [225, 14]], bowl: 0.14 }, // the den is on the hill
  18: { rise: [[120, -8], [262, -14], [380, -6], [483, 4]], bowl: 0.08 }, // down into the valley and home up the far side
};

/* ---------- the eighteen ---------- */

const HOLE_SPECS = [
  // 1: a gentle opener: wide fairway, an S bend, one tree to think about and a pond that only the greedy find
  { id: 1, note: "A wide-open start. Mind the lone tree in the fairway, and keep clear of the pond by the basket.", name: 'Fairway Opener', par: 4, path: trail(0, 36, [[120, 6, 36], [140, -10, 34], [130, 6, 30]]), wind: { mph: 4, from: 200 },
    woods: [{ side: -1, dense: 0.45 }, { side: 1, dense: 0.45 }], trees: [[232, -16, 4.4, 60]], shrubs: [[170, 40], [190, 44]],
    ponds: [{ s: 318, o: 58, rx: 28, ry: 36 }], front: 2 },
  // 2: a narrow corridor through the pines: a tree in the middle you throw over, a gap in the right wall
  { id: 2, note: "A tunnel of pines. Throw over the tree in the middle, or shape it down the lane.", name: 'The Tunnel', par: 3, path: trail(35, 15, [[110, -6, 13], [125, 12, 12]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2, d: 5 }, { side: 1, dense: 0.95, rows: 2, d: 5, gaps: [[120, 150]] }],
    trees: [[112, -3, 3.4, 36]], front: 1 },
  // 3: a dogleg left: the inside of the corner is low shrubs you can cut over, the outside is wall to wall pine
  { id: 3, note: "A dogleg left. Follow the fairway round, or fly the shrubs on the inside of the corner.", name: 'Left Bender', par: 4, path: trail(0, 32, [[200, 0, 30], [220, -62, 24]]), wind: { mph: 7, from: 90 },
    woods: [{ side: 1, dense: 0.9, rows: 2, to: 330 }, { side: -1, dense: 0.75, from: 26, to: 150 }, { side: -1, dense: 0.7, from: 270 }],
    shrubs: [[188, -30], [198, -34], [208, -29], [218, -36], [204, -44]], trees: [[236, -18, 4.6, 66]],
    mando: { s: 196, o: -33, side: -1 } }, // some days, no flying the shrubs: the post is on the inside of the corner
  // 4: a long S, a creek across the middle with one dry ford on the right
  { id: 4, note: "A long S with a creek across it. The only dry crossing is the ford on the right.", name: 'Ford Crossing', par: 5, path: trail(0, 38, [[160, 0, 38], [170, 28, 34], [150, -50, 34], [130, 22, 30]]), wind: { mph: 8, from: 310 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], creeks: [{ s: 300, w: 24, gap: [8, 30] }],
    trees: [[110, 14, 4.4, 60], [420, -12, 4.2, 58]], groves: [{ s: 360, o: 40, n: 4, spread: 14 }], mando: { s: 168, o: 38, side: 1 } },
  // 5: a pond between you and the basket: carry it, or play the long way round the right
  { id: 5, note: "The pond is in front of the basket. Carry it, or bend the throw out round the right.", name: 'Water Carry', par: 3, path: trail(-20, 28, [[115, 0, 28], [135, 38, 24]]), wind: { mph: 9, from: 250 },
    woods: [{ side: -1, dense: 0.4 }, { side: 1, dense: 0.4 }], ponds: [{ s: 170, o: -30, rx: 48, ry: 46 }], front: 2 },
  // 6: wide open prairie running northeast into a headwind, with groves to play around
  { id: 6, note: "Open prairie into the wind. Plan around the groves and keep the disc low.", name: 'Prairie', par: 4, path: trail(48, 50, [[220, -8, 50], [225, 10, 44]]), wind: { mph: 14, from: 45 },
    woods: [{ side: -1, d: 22, dense: 0.5 }, { side: 1, d: 22, dense: 0.5 }], groves: [{ s: 120, o: -34, n: 6, spread: 20 }, { s: 250, o: 26, n: 7, spread: 24 }, { s: 350, o: -22, n: 5, spread: 16 }], trees: [[190, 0, 5.6, 78]] },
  // 7: a cliff down the right: miss that way and it is out of bounds
  { id: 7, note: "The cliff is on your right: anything out there is out of bounds. Play left of the line.", name: 'Cliffside', par: 4, path: trail(5, 32, [[200, -6, 30], [205, -10, 28]]), wind: { mph: 9, from: 270 },
    woods: [{ side: -1, dense: 0.85, rows: 2 }], oob: [{ s0: 40, s1: 420, o0: 46, o1: 170 }], shrubs: [[240, 36]], trees: [[260, -8, 4.4, 62]] },
  // 8: a zig-zag through the pines: three bends, three shaped throws
  { id: 8, note: "A lazy S through the pines. Shape one left, then one right, or cut the corners over the shrubs.", name: 'Pinball', par: 4, path: trail(-18, 38, [[125, 0, 38], [125, 44, 36], [125, -68, 34], [115, 46, 32]]), wind: { mph: 5, from: 160 },
    woods: [{ side: -1, dense: 0.7, rows: 1 }, { side: 1, dense: 0.7, rows: 1 }],
    // low shrubs on the inside of each bend: you can fly the corner if you dare
    shrubs: [[130, 50], [141, 54], [152, 50], [250, -52], [262, -56], [274, -52]], front: 2 },
  // 9: a stand of trees splits the fairway: the left is longer and safe, the right is a shortcut beside the water
  { id: 9, note: "A stand of trees splits the fairway. Left is long and safe, right is short beside the water.", name: 'Split Decision', par: 4, path: trail(28, 40, [[200, -6, 40], [200, 8, 38]]), wind: { mph: 6, from: 120 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], groves: [{ s: 215, o: 0, n: 11, spread: 24, h: [52, 70] }],
    ponds: [{ s: 235, o: 76, rx: 36, ry: 52 }], front: 2 },
  // 10: one giant oak guards the front, and water waits behind the basket
  { id: 10, note: "One giant oak guards the front and water waits behind. Land it soft.", name: 'Big Oak', par: 3, path: trail(-35, 26, [[130, 4, 24], [125, -4, 24]]), wind: { mph: 6, from: 30 },
    woods: [{ side: -1, dense: 0.35 }, { side: 1, dense: 0.35 }], trees: [[118, 2, 7, 96]], shrubs: [[200, -14], [206, 12], [214, -6]],
    ponds: [{ s: 300, o: 0, rx: 70, ry: 24 }], backstop: false },
  // 11: out, around and back: the basket is close to the tee but a wall of woods stands between
  { id: 11, note: "The basket looks close, but a wall of trees runs between. Go out, round and back.", name: 'Switchback', par: 5, path: trail(0, 34, [[200, 0, 34], [175, 90, 30], [215, 90, 26]]), wind: { mph: 7, from: 90 },
    woods: [{ side: -1, dense: 0.6, from: 26, to: 190 }, { side: 1, dense: 0.85, rows: 2, from: 0, to: 195 }, { side: 1, dense: 0.8, rows: 2, from: 380 }],
    // a row of trees from the edge of the course up the middle: the short way across to the basket is not a way
    padBottom: 150, rows: [{ s0: -150, s1: 60, o: 90 }, { s0: 60, s1: 190, o: 74 }], groves: [{ s: 200, o: 0, n: 5, spread: 20 }, { s: 520, o: 60, n: 6, spread: 26 }] },
  // 12: a dogleg right with the pond on the inside of the corner: bite it off or play the safe line out left
  { id: 12, note: "A dogleg right with the pond on the inside of the corner. Bite it off, or play out left.", name: 'Right Hook', par: 4, path: trail(0, 34, [[210, 0, 32], [210, 64, 26]]), wind: { mph: 8, from: 280 },
    woods: [{ side: -1, dense: 0.85, rows: 2 }, { side: 1, dense: 0.6, from: 26, to: 150 }, { side: 1, dense: 0.8, from: 300 }],
    ponds: [{ s: 222, o: 56, rx: 46, ry: 44 }], trees: [[250, -14, 4.6, 64]], mando: { s: 214, o: 34, side: 1 } },
  // 13: ponds all down the hole: pick the dry lane
  { id: 13, note: "Ponds all down the hole. Pick the dry lane and commit.", name: 'Archipelago', par: 3, path: trail(15, 40, [[140, 6, 38], [145, -6, 36]]), wind: { mph: 10, from: 330 },
    woods: [{ side: -1, dense: 0.3 }, { side: 1, dense: 0.3 }],
    ponds: [{ s: 90, o: -26, rx: 22, ry: 30 }, { s: 150, o: 24, rx: 26, ry: 32 }, { s: 215, o: -22, rx: 24, ry: 26 }, { s: 262, o: 28, rx: 20, ry: 24 }] },
  // 14: a long lake runs down the left; the wind pushes you toward it
  { id: 14, note: "The lake runs down the left and the wind pushes you into it. Hold your line right.", name: 'Creekside', par: 4, path: trail(0, 34, [[140, 0, 34], [150, -24, 30], [130, 20, 28]]), wind: { mph: 6, from: 90 },
    woods: [{ side: 1, dense: 0.7, rows: 2 }], ponds: [{ s: 200, o: -52, rx: 22, ry: 130, n: 16 }], trees: [[130, 6, 4.4, 60]], front: 2 },
  // 15: a causeway between lakes: stay on the grass for three shots
  { id: 15, note: "A causeway between two lakes. Stay on the grass for three shots.", name: 'Peninsula', par: 5, path: trail(0, 34, [[170, 0, 34], [150, -20, 28], [150, 22, 26], [120, 0, 30]]), wind: { mph: 9, from: 200 },
    woods: [{ side: -1, dense: 0.6, from: 26, to: 100 }, { side: 1, dense: 0.6, from: 26, to: 100 }],
    ponds: [{ s: 250, o: -72, rx: 58, ry: 80, n: 14 }, { s: 250, o: 74, rx: 58, ry: 80, n: 14 }, { s: 420, o: -66, rx: 50, ry: 60, n: 14 }, { s: 420, o: 68, rx: 50, ry: 60, n: 14 }] },
  // 16: a wall of trees across the hole with two gates: wide and long to the left, tight and straight on the right
  { id: 16, note: "A wall of trees with two gates: wide and long on the left, tight and straight on the right.", name: 'The Gate', par: 4, path: trail(-25, 36, [[200, 10, 36], [200, -6, 36]]), wind: { mph: 5, from: 180 },
    woods: [{ side: -1, dense: 0.7 }, { side: 1, dense: 0.7 }], walls: [{ s: 200, from: -90, to: 90, gaps: [[-58, -30], [26, 36]], h: [72, 94] }], shrubs: [[320, 20], [330, -22]], front: 2 },
  // 17: Marebear's parlor: little room, lots of pine
  { id: 17, note: "Marebear's parlor. Not much room and a lot of pine. Be patient.", name: "Marebear's Parlor", par: 3, path: trail(-8, 22, [[225, 10, 20]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2 }, { side: 1, dense: 0.95, rows: 2 }], trees: [[100, -8, 4.4, 66], [135, 12, 4.4, 62], [175, -2, 4.6, 70]], front: 3 },
  // 18: home: a big pond in the valley. Play round the left, or have a go over the water
  { id: 18, note: "A big pond fills the valley. Play round the left, or have a go over the water.", name: 'Valley Home', par: 4, path: trail(0, 40, [[170, 0, 40], [160, -35, 34], [150, 35, 26]]), wind: { mph: 12, from: 235 },
    woods: [{ side: -1, dense: 0.7, rows: 2 }, { side: 1, dense: 0.5, from: 26, to: 120 }, { side: 1, dense: 0.7, from: 380 }],
    ponds: [{ s: 262, o: 66, rx: 58, ry: 62, n: 14 }], oob: [{ s0: 420, s1: 600, o0: -80, o1: -45 }], trees: [[320, 10, 4.6, 66]] },
];

// Holes 1-9 are the front nine, 10-18 the back; a nine-hole round is the front nine.
export const HOLES = HOLE_SPECS.map(build);
export const holeById = (id) => HOLES.find((h) => h.id === id);
// a warm-up is three of the gentler holes: an open start, a short climb and the bluff over the pond
export const WARMUP = [1, 2, 5];
export const holesFor = (length) => (length === 3 ? WARMUP.map((id) => holeById(id)) : HOLES.slice(0, length === 9 ? 9 : length === 18 ? 18 : 1));
