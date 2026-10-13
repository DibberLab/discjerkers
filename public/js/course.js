/* Course data. Feet. x is east, y is north; the tee is the origin and you throw north.
   A hole is data: the fairway (a centerline with half-widths), trees, water, and the basket. Adding a hole is adding
   an entry to HOLES. */

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

// centerline: [[x, y, half-width], ...] with y increasing
export function along(line, y) {
  if (y <= line[0][1]) return { x: line[0][0], hw: line[0][2] };
  for (let i = 1; i < line.length; i++) {
    if (y <= line[i][1]) {
      const [x0, y0, w0] = line[i - 1];
      const [x1, y1, w1] = line[i];
      const f = (y - y0) / (y1 - y0);
      return { x: x0 + (x1 - x0) * f, hw: w0 + (w1 - w0) * f };
    }
  }
  const last = line.at(-1);
  return { x: last[0], hw: last[2] };
}

export function pointInPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Fill in what a hole needs to be drawn and played from its spec.
export function makeHole(spec) {
  const hole = { wind: { mph: 0, from: 0 }, water: [], trees: [], bounds: { minX: -160, maxX: 240, minY: -50, maxY: 530 }, tee: { x: 0, y: 0 }, ...spec };
  const line = hole.fairway;
  // the fairway outline, for drawing: offset the centerline both ways
  const left = [];
  const right = [];
  const top = line.at(-1)[1];
  for (let y = line[0][1]; y <= top; y += 8) {
    const a = along(line, y);
    const b = along(line, Math.min(top, y + 8));
    const dx = b.x - a.x;
    const dy = 8;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len; // normal to the right of the line
    const ny = -dx / len;
    left.push([a.x - nx * a.hw, y - ny * a.hw]);
    right.push([a.x + nx * a.hw, y + ny * a.hw]);
  }
  hole.fairwayPoly = [...left, ...right.reverse()];
  hole.tee.pad = { minX: -9, maxX: 9, minY: -5, maxY: 9 };
  return hole;
}

// 'tee', 'fairway', 'rough', 'water' (out of bounds), or 'oob'
export function surfaceAt(hole, x, y) {
  const b = hole.bounds;
  if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return 'oob';
  for (const w of hole.water) if (pointInPoly(w, x, y)) return 'water';
  const p = hole.tee.pad;
  if (x >= p.minX && x <= p.maxX && y >= p.minY && y <= p.maxY) return 'tee';
  const top = hole.fairway.at(-1)[1];
  if (y >= hole.fairway[0][1] && y <= top) {
    const c = along(hole.fairway, y);
    if (Math.abs(x - c.x) <= c.hw) return 'fairway';
  }
  if (Math.hypot(x - hole.basket.x, y - hole.basket.y) <= 24) return 'fairway'; // a trimmed circle around the basket
  return 'rough';
}

/* ---------- hole 1: the dogleg ---------- */

function holeOne() {
  const line = [[0, 0, 34], [0, 140, 31], [28, 230, 27], [64, 320, 25], [75, 430, 22]];
  const rnd = seeded(7);
  const trees = [];
  const tree = (x, y, r = 3.6 + rnd() * 1.8, h = 48 + rnd() * 18) => trees.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 10) / 10, h: Math.round(h) });

  // the left edge of the fairway is woods, all the way up
  for (let y = 30; y <= 345; y += 20 + rnd() * 6) {
    const c = along(line, y);
    tree(c.x - c.hw - 8 - rnd() * 8, y + rnd() * 8);
  }
  // the right edge until the pond, with a window through it
  for (let y = 30; y <= 235; y += 20 + rnd() * 6) {
    if (y > 140 && y < 200) continue; // the window: a way out right for a big anhyzer
    const c = along(line, y);
    tree(c.x + c.hw + 8 + rnd() * 8, y + rnd() * 8);
  }
  // a tall guard tree on the bend: the straight line to the basket goes through it
  tree(31, 262, 4.8, 70);
  // thick woods on the outside of the bend
  tree(6, 266, 4.4, 62);
  tree(-2, 282, 5, 66);
  tree(14, 294, 4, 58);
  tree(-12, 250, 5.2, 64);
  // a backstop behind the basket, and shrubs guarding the front left
  for (const [x, y] of [[46, 452], [60, 464], [75, 469], [90, 464], [104, 452], [36, 436]]) tree(x, y, 4.4, 60);
  tree(53, 398, 2.8, 9);
  tree(47, 413, 2.6, 8);
  tree(100, 410, 4, 55);

  return makeHole({
    id: 1,
    name: 'The Dogleg',
    par: 4,
    fairway: line,
    basket: { x: 75, y: 430 },
    wind: { mph: 7, from: 270 }, // a breeze from the west
    water: [[[100, 252], [160, 240], [196, 288], [190, 352], [150, 402], [110, 378], [97, 322]]],
    trees,
  });
}

/* ---------- the other seventeen ---------- */

// Smoothly between control points: [[fraction of the hole, sideways offset in feet], ...], right is positive
function bendAt(points, f) {
  if (f <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (f <= points[i][0]) {
      const [f0, x0] = points[i - 1];
      const [f1, x1] = points[i];
      const t = (f - f0) / (f1 - f0);
      return x0 + (x1 - x0) * t * t * (3 - 2 * t);
    }
  }
  return points.at(-1)[1];
}

/**
 * A hole from a short description, so the course is a table and not seventeen pages of coordinates.
 *   len: tee to basket, feet     bend: where the fairway goes     hw: half-width at the tee and at the basket
 *   woods: 0..1 on each side (how thick)       gaps: [side, fromY, toY] windows through the woods
 *   guards: lone trees [fraction, offset, radius, height]         ponds: [fraction, side, offset, rx, ry]
 *   creek: [fraction, thickness]  water right across the fairway  front: shrubs and trees guarding the basket
 */
function build(spec) {
  const { id, name, par, len, bend = [[0, 0], [1, 0]], hw = [32, 24], woods = [0.7, 0.7], gaps = [], guards = [], ponds = [], creek = null, wind, front = 2, seed = id * 97 } = spec;
  const rnd = seeded(seed);
  const line = [];
  for (let y = 0; y < len; y += 10) line.push([bendAt(bend, y / len), y, hw[0] + (hw[1] - hw[0]) * (y / len)]);
  line.push([bendAt(bend, 1), len, hw[1]]);
  const basket = { x: line.at(-1)[0], y: len };
  const trees = [];
  const tree = (x, y, r = 3.6 + rnd() * 1.8, h = 48 + rnd() * 18) => trees.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round(r * 10) / 10, h: Math.round(h) });

  // the woods along each side
  [-1, 1].forEach((side, k) => {
    const thick = woods[k];
    if (thick <= 0) return;
    for (let y = 26; y < len - 16; y += 15 + (1 - thick) * 26 + rnd() * 7) {
      if (gaps.some(([sd, a, b]) => sd === side && y >= a && y <= b)) continue;
      const c = along(line, y);
      tree(c.x + side * (c.hw + 7 + rnd() * 9), y + rnd() * 8);
      if (thick > 0.75) tree(c.x + side * (c.hw + 19 + rnd() * 9), y + 6 + rnd() * 8); // a second row
    }
  });
  for (const [f, off, r, h] of guards) {
    const y = f * len;
    tree(along(line, y).x + off, y, r, h);
  }
  // a backstop behind the basket, and a few trees and shrubs in front of it
  for (let k = -3; k <= 3; k++) tree(basket.x + k * 14 + rnd() * 6, len + 18 + Math.abs(k) * 2 + rnd() * 8, 4.2 + rnd(), 58);
  for (let k = 0; k < front; k++) {
    const side = rnd() < 0.5 ? -1 : 1;
    tree(basket.x + side * (13 + rnd() * 12), len - 22 - rnd() * 24, 2.7 + rnd() * 0.4, 8 + rnd() * 2);
  }

  // water
  const water = [];
  for (const [f, side, off, rx, ry] of ponds) {
    const cy = f * len;
    const cx = along(line, cy).x + side * off;
    water.push(Array.from({ length: 11 }, (_, i) => {
      const a = (i / 11) * Math.PI * 2;
      const k = 0.85 + rnd() * 0.3;
      return [Math.round((cx + Math.cos(a) * rx * k) * 10) / 10, Math.round((cy + Math.sin(a) * ry * k) * 10) / 10];
    }));
  }
  const xs = line.map((p) => p[0]);
  const bounds = { minX: Math.min(...xs) - 120, maxX: Math.max(...xs) + 120, minY: -50, maxY: len + 95 };
  if (creek) {
    const cy = creek[0] * len;
    const t = creek[1];
    const lo = bounds.minX + 4;
    const hi = bounds.maxX - 4;
    const top = [];
    const bottom = [];
    for (let x = lo; x <= hi; x += 20) {
      top.push([x, cy + t / 2 + Math.sin(x * 0.05) * 5]);
      bottom.push([x, cy - t / 2 + Math.sin(x * 0.05 + 1) * 5]);
    }
    water.push([...top, ...bottom.reverse()]);
  }

  // no trees growing in a pond
  const dry = trees.filter((t) => !water.some((w) => pointInPoly(w, t.x, t.y)));
  return makeHole({ id, name, par, fairway: line, basket, wind, water, trees: dry, bounds });
}

const HOLE_SPECS = [
  { id: 2, name: 'Short and Sweet', par: 3, len: 235, bend: [[0, 0], [1, 6]], hw: [30, 26], woods: [0.5, 0.45], ponds: [[0.68, 1, 52, 26, 30]], wind: { mph: 5, from: 200 } },
  { id: 3, name: 'The Gauntlet', par: 4, len: 390, bend: [[0, 0], [0.55, -4], [1, -26]], hw: [22, 20], woods: [0.95, 0.95], guards: [[0.62, 4, 3.6, 62]], wind: { mph: 6, from: 90 } },
  { id: 4, name: 'Triple Crown', par: 5, len: 590, bend: [[0, 0], [0.3, 30], [0.65, -20], [1, 18]], hw: [38, 30], woods: [0.5, 0.5], creek: [0.56, 26], guards: [[0.25, 8, 4.4, 60]], wind: { mph: 8, from: 310 } },
  { id: 5, name: 'Island Green', par: 3, len: 265, bend: [[0, 0], [1, 14]], hw: [28, 30], woods: [0.4, 0.4], ponds: [[0.97, 1, 52, 38, 52], [1.05, -1, 52, 30, 38]], wind: { mph: 9, from: 250 } },
  { id: 6, name: 'The Cut', par: 4, len: 365, bend: [[0, 0], [0.42, 0], [1, -78]], hw: [30, 24], woods: [0.55, 0.9], gaps: [[1, 150, 230]], guards: [[0.62, -22, 4.6, 66], [0.7, -6, 4.2, 64]], wind: { mph: 7, from: 60 } },
  { id: 7, name: 'Spring Chicken', par: 3, len: 205, bend: [[0, 0], [0.5, 8], [1, 0]], hw: [26, 20], woods: [0.85, 0.85], guards: [[0.55, 0, 3.8, 60]], front: 3, wind: { mph: 4, from: 180 } },
  { id: 8, name: 'Long Haul', par: 5, len: 640, bend: [[0, 0], [0.5, 10], [1, 4]], hw: [42, 36], woods: [0.3, 0.3], guards: [[0.45, 20, 4.2, 58], [0.8, -16, 4.6, 64]], wind: { mph: 12, from: 0 } },
  { id: 9, name: 'Homecoming', par: 4, len: 450, bend: [[0, 0], [0.4, 0], [1, 70]], hw: [34, 24], woods: [0.8, 0.5], ponds: [[0.62, 1, 62, 36, 46]], guards: [[0.3, -14, 4.4, 60]], wind: { mph: 8, from: 270 } },
  { id: 10, name: 'Lone Pine', par: 3, len: 250, bend: [[0, 0], [1, -10]], hw: [32, 26], woods: [0.35, 0.35], ponds: [[0.6, -1, 56, 30, 40]], guards: [[0.52, -3, 5, 74]], wind: { mph: 6, from: 30 } },
  { id: 11, name: 'Crosswind', par: 4, len: 410, bend: [[0, 0], [1, 0]], hw: [46, 38], woods: [0.25, 0.25], ponds: [[0.78, 1, 70, 34, 60]], wind: { mph: 15, from: 90 } },
  { id: 12, name: 'The Chute', par: 4, len: 345, bend: [[0, 0], [0.4, 6], [0.8, -4], [1, 0]], hw: [17, 26], woods: [1, 1], gaps: [[-1, 215, 290], [1, 215, 290]], wind: { mph: 5, from: 150 } },
  { id: 13, name: "Marebear's Den", par: 3, len: 225, bend: [[0, 0], [1, -12]], hw: [24, 22], woods: [0.95, 0.95], guards: [[0.45, -8, 4.4, 66], [0.6, 12, 4.4, 62], [0.78, -2, 4.6, 70]], front: 3, wind: { mph: 3, from: 270 } },
  { id: 14, name: 'Fairway to Heaven', par: 5, len: 565, bend: [[0, 0], [0.3, -36], [0.62, 34], [1, 0]], hw: [36, 28], woods: [0.55, 0.5], ponds: [[0.5, 1, 76, 40, 50]], wind: { mph: 7, from: 120 } },
  { id: 15, name: 'Creek Crossing', par: 4, len: 380, bend: [[0, 0], [1, 22]], hw: [34, 30], woods: [0.45, 0.45], creek: [0.6, 22], guards: [[0.3, 10, 4.2, 58]], wind: { mph: 8, from: 330 } },
  { id: 16, name: 'The Elbow', par: 4, len: 420, bend: [[0, 0], [0.62, 0], [0.8, -42], [1, -86]], hw: [32, 24], woods: [0.7, 0.9], guards: [[0.66, 18, 4.6, 68], [0.76, 8, 4.4, 64]], wind: { mph: 9, from: 45 } },
  { id: 17, name: 'Last Gasp', par: 3, len: 280, bend: [[0, 0], [1, 0]], hw: [34, 28], woods: [0.3, 0.3], ponds: [[0.42, -1, 18, 34, 56], [0.42, 1, 48, 24, 40]], wind: { mph: 10, from: 300 } },
  { id: 18, name: 'Finishing Stretch', par: 4, len: 460, bend: [[0, 0], [0.5, 0], [1, 58]], hw: [36, 24], woods: [0.75, 0.6], ponds: [[0.9, 1, 52, 30, 44]], guards: [[0.7, 24, 4.8, 70]], wind: { mph: 11, from: 220 } },
];

// Holes 1-9 are the front nine, 10-18 the back; a nine-hole round is the front nine.
export const HOLES = [holeOne(), ...HOLE_SPECS.map(build)];
export const holeById = (id) => HOLES.find((h) => h.id === id);
export const holesFor = (length) => HOLES.slice(0, length === 9 ? 9 : length === 18 ? 18 : 1);
