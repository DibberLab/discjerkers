/* Course data. Feet. x is east, y is north; every hole starts with the tee at the origin, but a hole can run any way it
   likes from there: it follows a route (a centerline with half-widths) that bends, switches back and crosses water.
   A hole is data: the route, trees, water, out-of-bounds, and the basket. Adding a hole is adding an entry to HOLE_SPECS. */

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

// Fill in what a hole needs to be drawn and played from its spec.
export function makeHole(spec) {
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
  const { id, name, note, par, path, wind, woods = [], trees: explicit = [], shrubs = [], groves = [], walls = [], rows = [], ponds = [], creeks = [], oob = [], backstop = true, teeWall = true, front = 0, padBottom = 60, seed = id * 131 } = spec;
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
    const { side, from = -20, to = L - 10, d = 7, rows = 1, dense = 0.7, gaps = [], h = [48, 66] } = w;
    // a tree every 6 to 8 feet is a wall: a disc is a point, and a trunk stops it within 0.9 of its radius (4.4 and up here)
    const space = 8.5 - 3 * dense;
    for (let sAt = from; sAt <= to; sAt += space * (0.92 + rnd() * 0.16)) {
      if (gaps.some(([a, b]) => sAt >= a && sAt <= b)) continue;
      const f = frame(sAt);
      for (let k = 0; k < rows; k++) treeAt(sAt + rnd() * 3 + k * 4, side * (f.hw + d + k * 10 + rnd() * 5), 4.4 + rnd() * 1.3, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const [sAt, o, r, h] of explicit) treeAt(sAt, o, r, h);
  for (const [sAt, o] of shrubs) treeAt(sAt, o, 2.6 + rnd() * 0.5, 8 + rnd() * 3);
  for (const g of groves) {
    const { s: sAt, o, n = 5, spread = 18, h = [44, 64] } = g;
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * spread;
      treeAt(sAt + Math.sin(a) * rr, o + Math.cos(a) * rr, undefined, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const w of walls) {
    const { s: sAt, from, to, gaps = [], h = [56, 72], gap = 5.2 } = w;
    for (let o = from; o <= to; o += gap + rnd() * 0.5) {
      if (gaps.some(([a, b]) => o >= a && o <= b)) continue;
      treeAt(sAt + rnd() * 6 - 3, o, 4 + rnd() * 1.5, h[0] + rnd() * (h[1] - h[0]));
    }
  }
  for (const r of rows) {
    const { s0, s1, o, h = [56, 74], gap = 5.2 } = r; // a disc is a point and a trunk stops it within 3/4 of its radius, so a solid row is a tree every 5 feet
    for (let sAt = s0; sAt <= s1; sAt += gap + rnd() * 0.5) treeAt(sAt, o + rnd() * 4 - 2, 4 + rnd() * 1.5, h[0] + rnd() * (h[1] - h[0]));
  }
  // the tee is boxed in behind: you play down the hole, not out of the back of the tee
  if (teeWall) for (let o = -(path[0][2] + 26); o <= path[0][2] + 26; o += 5.2 + rnd() * 0.4) treeAt(-26, o, 4.4 + rnd() * 1.3, 56 + rnd() * 16);
  // a backstop behind the basket, and shrubs and trees in front of it
  if (backstop) for (let k = -3; k <= 3; k++) { const f = frame(L + 14 + Math.abs(k) * 2 + rnd() * 8, k * 14 + rnd() * 6); tree(f.x + end.tx * 14, f.y + end.ty * 14, 4.2 + rnd(), 58); }
  for (let k = 0; k < front; k++) { const side = rnd() < 0.5 ? -1 : 1; treeAt(L - 22 - rnd() * 24, side * (13 + rnd() * 12), 2.7 + rnd() * 0.4, 8 + rnd() * 2); }

  // water: ponds are wobbly ellipses in the route's own frame, creeks cross it
  const water = [];
  for (const p of ponds) {
    const n = p.n || 12;
    water.push(Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      const k = 0.86 + rnd() * 0.28;
      const f = frame(p.s + Math.sin(a) * p.ry * k, p.o + Math.cos(a) * p.rx * k);
      return [r1(f.x), r1(f.y)];
    }));
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
    if (c.gap) { water.push(bank(-REACH, c.gap[0])); water.push(bank(c.gap[1], REACH)); } else water.push(bank(-REACH, REACH));
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
  // no trees growing in a pond, in out of bounds, or on the tee or basket
  const dry = trees.filter((t) => !water.some((w) => pointInPoly(w, t.x, t.y)) && !zones.some((w) => pointInPoly(w, t.x, t.y)) && Math.hypot(t.x, t.y) > t.r + 10 && Math.hypot(t.x - basket.x, t.y - basket.y) > t.r + 8);
  return makeHole({ id, name, note, par, fairway: line, basket, wind, water, oob: zones, trees: dry, bounds });
}

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
    shrubs: [[188, -30], [198, -34], [208, -29], [218, -36], [204, -44]], trees: [[236, -18, 4.6, 66]] },
  // 4: a long S, a creek across the middle with one dry ford on the right
  { id: 4, note: "A long S with a creek across it. The only dry crossing is the ford on the right.", name: 'Ford Crossing', par: 5, path: trail(0, 38, [[160, 0, 38], [170, 28, 34], [150, -50, 34], [130, 22, 30]]), wind: { mph: 8, from: 310 },
    woods: [{ side: -1, dense: 0.5 }, { side: 1, dense: 0.5 }], creeks: [{ s: 300, w: 24, gap: [8, 30] }],
    trees: [[110, 14, 4.4, 60], [420, -12, 4.2, 58]], groves: [{ s: 360, o: 40, n: 4, spread: 14 }] },
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
  { id: 8, note: "Three bends through the pines. Each throw needs a different shape.", name: 'Pinball', par: 4, path: trail(-20, 30, [[100, 0, 28], [110, 75, 26], [110, -115, 24], [100, 85, 24]]), wind: { mph: 5, from: 160 },
    woods: [{ side: -1, dense: 0.9, rows: 2 }, { side: 1, dense: 0.9, rows: 2 }], front: 2 },
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
    ponds: [{ s: 222, o: 56, rx: 46, ry: 44 }], trees: [[250, -14, 4.6, 64]] },
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
    woods: [{ side: -1, dense: 0.7 }, { side: 1, dense: 0.7 }], walls: [{ s: 200, from: -90, to: 90, gaps: [[-58, -30], [26, 36]], h: [60, 76] }], shrubs: [[320, 20], [330, -22]], front: 2 },
  // 17: Marebear's den: little room, lots of pine
  { id: 17, note: "Marebear's den. Not much room and a lot of pine. Be patient.", name: "Marebear's Den", par: 3, path: trail(-8, 22, [[225, 10, 20]]), wind: { mph: 3, from: 270 },
    woods: [{ side: -1, dense: 0.95, rows: 2 }, { side: 1, dense: 0.95, rows: 2 }], trees: [[100, -8, 4.4, 66], [135, 12, 4.4, 62], [175, -2, 4.6, 70]], front: 3 },
  // 18: home: a big pond in the valley. Play round the left, or have a go over the water
  { id: 18, note: "A big pond fills the valley. Play round the left, or have a go over the water.", name: 'Valley Home', par: 4, path: trail(0, 40, [[170, 0, 40], [160, -35, 34], [150, 35, 26]]), wind: { mph: 12, from: 235 },
    woods: [{ side: -1, dense: 0.7, rows: 2 }, { side: 1, dense: 0.5, from: 26, to: 120 }, { side: 1, dense: 0.7, from: 380 }],
    ponds: [{ s: 262, o: 66, rx: 58, ry: 62, n: 14 }], oob: [{ s0: 420, s1: 600, o0: -80, o1: -45 }], trees: [[320, 10, 4.6, 66]] },
];

// Holes 1-9 are the front nine, 10-18 the back; a nine-hole round is the front nine.
export const HOLES = HOLE_SPECS.map(build);
export const holeById = (id) => HOLES.find((h) => h.id === id);
export const holesFor = (length) => HOLES.slice(0, length === 9 ? 9 : length === 18 ? 18 : 1);
