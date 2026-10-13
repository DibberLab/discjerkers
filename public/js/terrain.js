/* A hole's ground as a grid of heights, and nothing else: no rules, no drawing. course.js fills one in from a hole's description
   (hills, hollows, a rise along the fairway), gamecore.js asks it how high the ground is under a disc, and the map and the 3D view
   draw it. Feet; x is east, y is north, z is up. A height is always feet above the tee. */

export const STEP = 8; // feet between grid points: finer than any hill we make, coarse enough to keep a hole to a few thousand

export const smoothstep = (u) => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };

// an empty field covering a box
export function makeField(box, step = STEP) {
  const x0 = Math.floor(box.minX / step) * step;
  const y0 = Math.floor(box.minY / step) * step;
  const nx = Math.ceil((box.maxX - x0) / step) + 1;
  const ny = Math.ceil((box.maxY - y0) / step) + 1;
  return { x0, y0, step, nx, ny, z: new Float32Array(nx * ny) };
}
export const fieldIndex = (f, i, j) => j * f.nx + i;

// the height at a point: the four grid points around it, blended (a point off the grid takes its nearest edge)
export function fieldAt(f, x, y) {
  const gx = Math.max(0, Math.min(f.nx - 1.001, (x - f.x0) / f.step));
  const gy = Math.max(0, Math.min(f.ny - 1.001, (y - f.y0) / f.step));
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const u = gx - i;
  const v = gy - j;
  const k = j * f.nx + i;
  const z = f.z;
  return z[k] * (1 - u) * (1 - v) + z[k + 1] * u * (1 - v) + z[k + f.nx] * (1 - u) * v + z[k + f.nx + 1] * u * v;
}

// which way is down, and how steeply: feet of rise per foot east (gx) and north (gy)
export function fieldSlope(f, x, y, d = f.step * 0.75) {
  return { gx: (fieldAt(f, x + d, y) - fieldAt(f, x - d, y)) / (2 * d), gy: (fieldAt(f, x, y + d) - fieldAt(f, x, y - d)) / (2 * d) };
}

// soften the field: a few passes of a 3-point average each way. Hills made from the route have creases where the nearest part of
// the route jumps from one leg to another, and this rounds them off.
export function blurField(f, passes = 3) {
  const { nx, ny } = f;
  let a = f.z;
  let b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) b[j * nx + i] = (a[j * nx + Math.max(0, i - 1)] + a[j * nx + i] + a[j * nx + Math.min(nx - 1, i + 1)]) / 3;
    }
    [a, b] = [b, a];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) b[j * nx + i] = (a[Math.max(0, j - 1) * nx + i] + a[j * nx + i] + a[Math.min(ny - 1, j + 1) * nx + i]) / 3;
    }
    [a, b] = [b, a];
  }
  f.z = a;
  return f;
}

// feet from a point to the edge of a polygon, negative when it is inside
export function polyDistance(poly, x, y) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (xi + dx * t), y - (yi + dy * t)));
  }
  return inside ? -best : best;
}

// A profile from knots [[s, z], ...]: eased (flat at every knot), so a hill is a hill and not a tent.
export function profileAt(knots, s) {
  if (s <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    if (s <= knots[i][0]) {
      const [s0, z0] = knots[i - 1];
      const [s1, z1] = knots[i];
      const u = (s - s0) / (s1 - s0 || 1);
      return z0 + (z1 - z0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    }
  }
  return knots.at(-1)[1];
}
