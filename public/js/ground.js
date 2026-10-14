/* What the ground looks like, for the map and for the 3D view: the colour of each patch of a hole (lit from the north-west, so a hill
   has a bright side and a dark side), and the map's overlay of shading, contour lines, mown stripes and grass flecks.
   Nothing here is a rule: the hills themselves are in course.js and terrain.js, and gamecore.js is what plays on them. */

import { surfaceAt, routePosition } from './course.js?v=10';
import { fieldAt } from './terrain.js?v=1';

export const PALETTE = { // r, g, b of each kind of ground
  rough: [24, 52, 31], fairway: [38, 84, 48], tee: [48, 108, 59], water: [27, 75, 102], oob: [74, 32, 12],
};
const KINDS = ['rough', 'fairway', 'tee', 'water', 'oob'];

const SUN = (() => { const v = [-0.55, 0.55, 0.62]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
const FLAT = SUN[2]; // how bright level ground is
// how brightly a slope is lit: 1 on the level, more facing the sun (north-west), less turned from it. gx, gy are feet of rise per foot east and north.
export function lightOf(gx, gy) {
  const l = Math.hypot(gx, gy, 1);
  const lam = (-gx * SUN[0] - gy * SUN[1] + SUN[2]) / l;
  return Math.max(0.55, Math.min(1.45, 1 + 1.9 * (lam - FLAT)));
}

const hash = (a, b, c = 0) => { const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return n - Math.floor(n); };

/* ---------- the colour of each cell of the grid ---------- */

const cache = new WeakMap();
// For a hole with ground: { cols, cls, nx, ny } where cols is r, g, b (0..255) of each cell of the field (a cell is the square between four
// grid points) with its kind of ground, its slope's light, its mown stripe and a little noise already in; cls is the kind of ground
// it mostly is (index into KINDS). Made once per hole, on first use.
export function groundCells(hole) {
  const hit = cache.get(hole);
  if (hit) return hit;
  const f = hole.field;
  const nx = f.nx - 1;
  const ny = f.ny - 1;
  const cols = new Uint8ClampedArray(nx * ny * 3);
  const cls = new Uint8Array(nx * ny);
  const subs = [0.17, 0.5, 0.83];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = f.x0 + i * f.step;
      const y0 = f.y0 + j * f.step;
      const count = [0, 0, 0, 0, 0];
      for (const u of subs) for (const v of subs) count[KINDS.indexOf(surfaceAt(hole, x0 + u * f.step, y0 + v * f.step))]++;
      let top = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 5; k++) {
        if (count[k] > count[top]) top = k;
        const c = PALETTE[KINDS[k]];
        r += c[0] * count[k];
        g += c[1] * count[k];
        b += c[2] * count[k];
      }
      r /= 9; g /= 9; b /= 9;
      // the slope: where the four corners are
      const z00 = f.z[j * f.nx + i];
      const z10 = f.z[j * f.nx + i + 1];
      const z01 = f.z[(j + 1) * f.nx + i];
      const z11 = f.z[(j + 1) * f.nx + i + 1];
      const gx = (z10 + z11 - z00 - z01) / (2 * f.step);
      const gy = (z01 + z11 - z00 - z10) / (2 * f.step);
      let light = top === 3 ? 1 : lightOf(gx, gy); // water is level
      if (top === 1 || top === 2) { // mown in stripes along the hole
        const s = routePosition(hole, x0 + f.step / 2, y0 + f.step / 2).s;
        light *= Math.floor(s / 16) % 2 ? 1.1 : 0.94;
      }
      if (top !== 3) light *= 1 + (hash(i, j) - 0.5) * 0.1; // a little unevenness
      const o = (j * nx + i) * 3;
      cols[o] = r * light;
      cols[o + 1] = g * light;
      cols[o + 2] = b * light;
      cls[o / 3] = top;
    }
  }
  const out = { cols, cls, nx, ny };
  cache.set(hole, out);
  return out;
}
export const KIND = { rough: 0, fairway: 1, tee: 2, water: 3, oob: 4 };

/* ---------- the map: shading, contours, stripes and flecks, drawn once into a picture ---------- */

const K = 2; // pixels of the picture per foot
const seeded = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// contour segments of the field: [x0, y0, x1, y1, level] every `every` feet of height (marching squares)
export function contours(hole, every = 4) {
  const f = hole.field;
  const out = [];
  for (let j = 0; j < f.ny - 1; j++) {
    for (let i = 0; i < f.nx - 1; i++) {
      const x0 = f.x0 + i * f.step;
      const y0 = f.y0 + j * f.step;
      const c = [
        [x0, y0, f.z[j * f.nx + i]],
        [x0 + f.step, y0, f.z[j * f.nx + i + 1]],
        [x0 + f.step, y0 + f.step, f.z[(j + 1) * f.nx + i + 1]],
        [x0, y0 + f.step, f.z[(j + 1) * f.nx + i]],
      ];
      const lo = Math.min(c[0][2], c[1][2], c[2][2], c[3][2]);
      const hi = Math.max(c[0][2], c[1][2], c[2][2], c[3][2]);
      if (hi - lo < 0.02) continue;
      for (let lv = Math.ceil(lo / every) * every; lv <= hi; lv += every) {
        const pts = [];
        for (let e = 0; e < 4; e++) {
          const a = c[e];
          const b = c[(e + 1) % 4];
          if ((a[2] < lv) !== (b[2] < lv)) {
            const t = (lv - a[2]) / (b[2] - a[2]);
            pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        if (pts.length >= 2) out.push([...pts[0], ...pts[1], lv]);
        if (pts.length === 4) out.push([...pts[2], ...pts[3], lv]);
      }
    }
  }
  return out;
}

const layers = new WeakMap();
/**
 * The picture laid over the map's flat colours: hill shading (light from the north-west), mown stripes, grass flecks and contour lines.
 * Returns { canvas, minX, maxY, w, h } (feet), or null where there is no screen to draw on (or the hole is flat).
 */
export function mapLayer(hole) {
  if (!hole.field || typeof document === 'undefined') return null;
  const hit = layers.get(hole);
  if (hit) return hit;
  const b = hole.bounds;
  const f = hole.field;
  const wFt = b.maxX - b.minX;
  const hFt = b.maxY - b.minY;
  const k = Math.min(K, 2400 / Math.max(wFt, hFt));
  const W = Math.ceil(wFt * k);
  const H = Math.ceil(hFt * k);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const cx = canvas.getContext('2d');
  const U = (x) => (x - b.minX) * k;
  const V = (y) => (b.maxY - y) * k;
  // hill shading, pixel by pixel from the field, at half a pixel per foot (it is smooth) and then stretched over the picture
  const ks = 0.5;
  const sw = Math.ceil(wFt * ks);
  const sh = Math.ceil(hFt * ks);
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const sx = small.getContext('2d');
  const img = sx.createImageData(sw, sh);
  const d = f.step * 0.75;
  for (let py = 0; py < sh; py++) {
    const y = b.maxY - (py + 0.5) / ks;
    for (let px = 0; px < sw; px++) {
      const x = b.minX + (px + 0.5) / ks;
      const gx = (fieldAt(f, x + d, y) - fieldAt(f, x - d, y)) / (2 * d);
      const gy = (fieldAt(f, x, y + d) - fieldAt(f, x, y - d)) / (2 * d);
      const l = lightOf(gx, gy) - 1;
      const o = (py * sw + px) * 4;
      if (l >= 0) { img.data[o] = 255; img.data[o + 1] = 250; img.data[o + 2] = 205; img.data[o + 3] = Math.min(120, l * 330); } else { img.data[o] = 3; img.data[o + 1] = 10; img.data[o + 2] = 6; img.data[o + 3] = Math.min(150, -l * 400); }
    }
  }
  sx.putImageData(img, 0, 0);
  cx.imageSmoothingEnabled = true;
  cx.drawImage(small, 0, 0, W, H);
  // mown stripes along the fairway: the outline is the left edge out and the right edge back
  const fp = hole.fairwayPoly;
  const n = fp.length / 2;
  const left = fp.slice(0, n);
  const right = fp.slice(n).reverse();
  cx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i + 2 < n; i += 4) {
    cx.beginPath();
    for (const q of [...left.slice(i, i + 3), ...right.slice(i, i + 3).reverse()]) cx.lineTo(U(q[0]), V(q[1]));
    cx.closePath();
    cx.fill();
  }
  // grass: flecks, thicker and darker in the rough, a few light ones on the fairway
  const rnd = seeded((hole.id || 1) * 977);
  const cnt = Math.floor((wFt * hFt) / 7);
  for (let a = 0; a < cnt; a++) {
    const x = b.minX + rnd() * wFt;
    const y = b.minY + rnd() * hFt;
    const kind = surfaceAt(hole, x, y);
    if (kind === 'water' || kind === 'oob') continue;
    const u = rnd();
    if (kind === 'rough') cx.fillStyle = u < 0.55 ? 'rgba(6,20,10,0.3)' : u < 0.9 ? 'rgba(96,150,70,0.16)' : 'rgba(220,200,90,0.2)';
    else cx.fillStyle = u < 0.7 ? 'rgba(255,255,255,0.07)' : 'rgba(0,16,4,0.13)';
    const s = (0.5 + rnd() * 0.9) * k;
    cx.fillRect(U(x), V(y), s * 1.3, s * 0.8);
  }
  // contour lines: every 4 ft, and a heavier one every 12
  const lines = contours(hole, 4);
  for (const heavy of [false, true]) {
    cx.beginPath();
    for (const [x0, y0, x1, y1, lv] of lines) {
      if ((Math.round(lv / 4) % 3 === 0) !== heavy) continue;
      cx.moveTo(U(x0), V(y0));
      cx.lineTo(U(x1), V(y1));
    }
    cx.strokeStyle = heavy ? 'rgba(10,22,12,0.5)' : 'rgba(10,22,12,0.26)';
    cx.lineWidth = heavy ? 1.7 : 1.1;
    cx.stroke();
  }
  const out = { canvas, minX: b.minX, maxY: b.maxY, w: wFt, h: hFt };
  layers.set(hole, out);
  return out;
}
