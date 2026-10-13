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

export const HOLES = [holeOne()];
