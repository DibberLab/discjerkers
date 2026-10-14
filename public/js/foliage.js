/* Foliage: trees and bushes drawn with leaf clumps, bark and light instead of flat shapes. Browser only (it needs canvas). Each kind of
   tree has a few drawn-once pictures (a side view for the 3D camera, a view from above for the map), made in small slices when the page
   starts (`start`), then stamped wherever a tree stands; something that is not ready yet is simply drawn the old, flat way by the caller
   (the functions here return null), so nothing ever waits on them. The pictures are lit from the upper left, like the map's hills.
   Kinds: 'm' maple, 'a' maple turning, 'o' oak, 'p' white pine, 's' shrub, 'b' bush. */

const TAU = Math.PI * 2;

const rng = (seed) => {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const PAL = {
  m: ['#12381b', '#2b7434', '#52aa4b', '#a6de7a'],
  a: ['#6b2a0c', '#ad5a18', '#e08e2c', '#f8d070'],
  o: ['#1a300e', '#375a20', '#5f8d35', '#a6c76c'],
  p: ['#08241a', '#134530', '#22674a', '#55a074'],
  s: ['#27552a', '#488c42', '#74bc62', '#b8e48e'],
  b: ['#1a3d21', '#2c6633', '#4a9044', '#88c66e'],
}; // dark, mid, lit, highlight
for (const k of Object.keys(PAL)) PAL[k] = PAL[k].map(hex);
const BARK = [hex('#7a5535'), hex('#4a3220'), hex('#241810')]; // lit, mid, shadow

const make = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
};

// a tone 0..1 (0 shadow, 1 sunlit) turned into the colours of a puffy clump
const tones = (pal, tone) => {
  const t = clamp(tone, 0, 1);
  return [mix(pal[0], pal[1], Math.min(1, t * 1.6)), mix(pal[1], pal[2], t), mix(pal[2], pal[3], t * t), mix(pal[2], pal[3], 0.5 + t * 0.5)];
};

// one lumpy puff of leaves at (x, y), radius r: a dark underside, the body, a lit top and a glint
function puff(c, x, y, r, pal, tone) {
  const [under, body, lit, glint] = tones(pal, tone);
  c.fillStyle = css(under);
  c.beginPath(); c.ellipse(x + r * 0.05, y + r * 0.14, r, r * 0.9, 0, 0, TAU); c.fill();
  c.fillStyle = css(body);
  c.beginPath(); c.ellipse(x - r * 0.06, y - r * 0.02, r * 0.92, r * 0.8, 0, 0, TAU); c.fill();
  c.fillStyle = css(lit);
  c.beginPath(); c.ellipse(x - r * 0.24, y - r * 0.22, r * 0.58, r * 0.46, -0.3, 0, TAU); c.fill();
  c.fillStyle = css(glint, 0.32);
  c.beginPath(); c.ellipse(x - r * 0.34, y - r * 0.34, r * 0.2, r * 0.14, -0.4, 0, TAU); c.fill();
}

// tiny leaves scattered over what is already drawn (only where something is: source-atop), so a crown has grain rather than smooth blobs
function speckle(c, rnd, n, box, pal, size) {
  c.save();
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < n; i++) {
    const x = box.x + rnd() * box.w;
    const y = box.y + rnd() * box.h;
    const lit = clamp(0.5 - ((x - box.x) / box.w - 0.5) * 0.5 - ((y - box.y) / box.h - 0.5) * 0.7 + (rnd() - 0.5) * 0.5, 0, 1);
    c.fillStyle = css(lit > 0.62 ? pal[3] : lit > 0.35 ? pal[2] : pal[0], 0.55 + rnd() * 0.3);
    c.beginPath(); c.ellipse(x, y, size * (0.6 + rnd() * 0.8), size * (0.35 + rnd() * 0.4), rnd() * TAU, 0, TAU); c.fill();
  }
  c.restore();
}

/* ----- the side view (the 3D camera): a picture of a tree standing on the ground, its foot at the middle of the bottom edge ----- */

function trunk(c, W, H, x, top, wBase, wTop, rnd) {
  const yb = H - 3;
  const g = c.createLinearGradient(x - wBase, 0, x + wBase, 0);
  g.addColorStop(0, css(BARK[0])); g.addColorStop(0.45, css(BARK[1])); g.addColorStop(1, css(BARK[2]));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - wBase * 1.35, yb); // flared foot
  c.quadraticCurveTo(x - wBase * 0.55, yb - (yb - top) * 0.12, x - wTop, yb - (yb - top) * 0.45);
  c.lineTo(x - wTop * 0.8, top);
  c.lineTo(x + wTop * 0.8, top);
  c.lineTo(x + wTop, yb - (yb - top) * 0.45);
  c.quadraticCurveTo(x + wBase * 0.55, yb - (yb - top) * 0.12, x + wBase * 1.35, yb);
  c.closePath();
  c.fill();
  c.strokeStyle = css(BARK[2], 0.4);
  c.lineWidth = Math.max(0.7, wBase * 0.12);
  for (let i = 0; i < 5; i++) { // furrows
    const u = (i + 0.5) / 5 - 0.5;
    c.beginPath();
    c.moveTo(x + u * wBase * 2.2, yb);
    c.bezierCurveTo(x + u * wBase * 1.7 + (rnd() - 0.5) * 2, yb - (yb - top) * 0.35, x + u * wTop * 1.8 + (rnd() - 0.5) * 2, yb - (yb - top) * 0.7, x + u * wTop * 1.5, top);
    c.stroke();
  }
}

function groundShadow(c, W, H, rx) {
  const g = c.createRadialGradient(W / 2, H - 3, 1, W / 2, H - 3, rx);
  g.addColorStop(0, 'rgba(0,0,0,0.42)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(W / 2, H - 3, rx, rx * 0.22, 0, 0, TAU); c.fill();
}

function crownSide(c, W, H, kind, rnd) {
  const pal = PAL[kind];
  const oak = kind === 'o';
  const cx = W / 2;
  const cy = H * (oak ? 0.4 : 0.36);
  const rx = W * 0.48;
  const ry = H * (oak ? 0.31 : 0.34);
  groundShadow(c, W, H, W * 0.55);
  trunk(c, W, H, cx, cy + ry * 0.2, W * (oak ? 0.07 : 0.05), W * (oak ? 0.05 : 0.035), rnd);
  c.strokeStyle = css(BARK[1]); c.lineCap = 'round'; // limbs reaching up into the crown
  for (let i = 0; i < 4; i++) {
    c.lineWidth = Math.max(1, W * 0.03 * (1 - i * 0.15));
    c.beginPath(); c.moveTo(cx, cy + ry * 0.55); c.quadraticCurveTo(cx + (i - 1.5) * rx * 0.25, cy + ry * 0.1, cx + (i - 1.5) * rx * 0.55, cy - ry * 0.4); c.stroke();
  }
  // the mass of the crown, dark, so the gaps between clumps read as shade rather than sky
  const mass = c.createRadialGradient(cx - rx * 0.25, cy - ry * 0.3, 2, cx, cy, Math.max(rx, ry));
  mass.addColorStop(0, css(pal[1])); mass.addColorStop(1, css(pal[0]));
  c.fillStyle = mass;
  c.beginPath(); c.ellipse(cx, cy, rx * 0.93, ry * 0.93, 0, 0, TAU); c.fill();
  const clumps = [];
  const n = oak ? 78 : 88;
  while (clumps.length < n) {
    const u = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * 0.86;
    const x = cx + Math.cos(u) * rr * rx;
    const y = cy + Math.sin(u) * rr * ry;
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    const tone = clamp(0.5 - nx * 0.38 - ny * 0.55 + (rnd() - 0.5) * 0.28, 0, 1); // lit from the upper left, darker underneath and on the right
    clumps.push({ x, y, r: W * (0.065 + rnd() * (oak ? 0.1 : 0.085)), tone });
  }
  clumps.sort((p, q) => p.y - q.y); // the upper ones first, so the lower overlap them
  for (const p of clumps) puff(c, p.x, p.y, p.r, pal, p.tone);
  speckle(c, rnd, Math.round(280 * H / 208), { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }, pal, Math.max(1, W * 0.022));
  // a rim of light on the upper left, and the shade under the crown
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const sh = c.createLinearGradient(0, cy - ry, 0, cy + ry);
  sh.addColorStop(0, 'rgba(255,250,200,0.1)'); sh.addColorStop(0.55, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,12,0,0.34)');
  c.fillStyle = sh;
  c.fillRect(0, 0, W, H);
  c.restore();
}

function pineSide(c, W, H, rnd) {
  const pal = PAL.p;
  const cx = W / 2;
  groundShadow(c, W, H, W * 0.6);
  trunk(c, W, H, cx, H * 0.6, W * 0.045, W * 0.028, rnd);
  const tiers = 9;
  const tierH = H * 0.2;
  for (let i = 0; i < tiers; i++) { // top to bottom, each skirt over the one above
    const t = i / (tiers - 1);
    const apexY = H * 0.01 + t * H * 0.7;
    const hw = W * (0.14 + t * 0.34) + W * 0.02 * (rnd() - 0.5);
    const yb = apexY + tierH * (0.95 + t * 0.2);
    const pts = [[cx, apexY]];
    const steps = 9;
    for (let s = 0; s <= steps; s++) { // the ragged lower edge, drooping at the tips
      const u = s / steps;
      const x = cx - hw + u * hw * 2;
      const droop = Math.abs(u - 0.5) * 2;
      pts.push([x, yb - tierH * 0.12 + droop * tierH * 0.1 + (s % 2 ? tierH * 0.1 : -tierH * 0.02) + rnd() * tierH * 0.05]);
    }
    const shade = clamp(0.2 + t * 0.15 + (rnd() - 0.5) * 0.1, 0, 1);
    c.fillStyle = css(mix(pal[0], pal[1], shade + 0.2));
    c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
    c.save();
    c.clip();
    // the lit left half, then needles
    c.fillStyle = css(mix(pal[1], pal[2], 0.5 + t * 0.2), 0.7);
    c.beginPath(); c.moveTo(cx, apexY); c.lineTo(cx - hw * 1.05, yb); c.lineTo(cx - hw * 0.1, yb); c.closePath(); c.fill();
    c.lineWidth = Math.max(0.6, W * 0.012);
    for (let k = 0; k < Math.round(46 * H / 220); k++) {
      const u = rnd();
      const x0 = cx + (u - 0.5) * hw * 1.9 * (0.2 + rnd() * 0.8);
      const y0 = apexY + rnd() * (yb - apexY);
      const lit = x0 < cx - hw * 0.1 ? 0.7 : 0.3;
      c.strokeStyle = css(rnd() < lit ? pal[3] : pal[0], 0.5);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + (x0 - cx) * 0.18, y0 + tierH * 0.2); c.stroke();
    }
    c.restore();
    c.strokeStyle = css(pal[0], 0.7); // the dark under-edge of the skirt
    c.lineWidth = Math.max(1, W * 0.025);
    c.beginPath(); pts.slice(1).forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
  }
  c.fillStyle = css(pal[1]); // the leader
  c.beginPath(); c.moveTo(cx, 0); c.lineTo(cx - W * 0.03, H * 0.07); c.lineTo(cx + W * 0.03, H * 0.07); c.closePath(); c.fill();
}

function bushSide(c, W, H, kind, rnd) {
  const pal = PAL[kind];
  groundShadow(c, W, H, W * 0.5);
  const cx = W / 2;
  const cy = H * 0.58;
  const rx = W * 0.48;
  const ry = H * 0.42;
  c.fillStyle = css(pal[0]);
  c.beginPath(); c.ellipse(cx, cy + ry * 0.1, rx, ry, 0, 0, TAU); c.fill();
  const clumps = [];
  for (let i = 0; i < 16; i++) {
    const u = rnd() * TAU;
    const rr = Math.sqrt(rnd()) * 0.8;
    const x = cx + Math.cos(u) * rr * rx;
    const y = cy + Math.sin(u) * rr * ry * 0.9;
    clumps.push({ x, y, r: W * (0.16 + rnd() * 0.1), tone: clamp(0.55 - ((x - cx) / rx) * 0.35 - ((y - cy) / ry) * 0.5 + (rnd() - 0.5) * 0.3, 0, 1) });
  }
  clumps.sort((p, q) => p.y - q.y);
  for (const p of clumps) puff(c, p.x, p.y, p.r, pal, p.tone);
  speckle(c, rnd, 90, { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 }, pal, Math.max(1, W * 0.03));
  if (kind === 'b' && rnd() < 0.5) { // some are in berry or flower
    const col = rnd() < 0.5 ? '#d6403a' : '#f2ecd8';
    c.fillStyle = col;
    for (let i = 0; i < 10; i++) { c.beginPath(); c.arc(cx + (rnd() - 0.5) * rx * 1.5, cy + (rnd() - 0.5) * ry * 1.2, Math.max(1, W * 0.025), 0, TAU); c.fill(); }
  }
}

/* ----- the view from above (the map): a round crown, lit from the upper left, its edge a little dark ----- */

function crownTop(c, S, kind, rnd) {
  const pal = PAL[kind];
  const R = S / 2;
  c.save();
  c.beginPath(); c.arc(R, R, R - 0.5, 0, TAU); c.clip();
  c.fillStyle = css(pal[0]);
  c.fillRect(0, 0, S, S);
  const small = kind === 's' || kind === 'b';
  const rings = small ? [[0.6, 10], [0.28, 5], [0.04, 2]] : [[0.78, 20], [0.54, 14], [0.3, 8], [0.06, 3]];
  for (const [rr, n] of rings) {
    const a0 = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * TAU + (rnd() - 0.5) * 0.35;
      const x = R + Math.cos(a) * rr * R;
      const y = R + Math.sin(a) * rr * R;
      const tone = clamp(0.5 - Math.cos(a) * rr * 0.4 - Math.sin(a) * rr * 0.5 + (rnd() - 0.5) * 0.3, 0, 1);
      puff(c, x, y, R * (small ? 0.3 : 0.22) * (0.8 + rnd() * 0.45), pal, tone);
    }
  }
  speckle(c, rnd, 300, { x: 0, y: 0, w: S, h: S }, pal, S * 0.014);
  c.globalCompositeOperation = 'source-atop'; // the crown is a ball: dark at the edge, lit at the upper left
  const g = c.createRadialGradient(R * 0.7, R * 0.65, R * 0.1, R, R, R);
  g.addColorStop(0, 'rgba(255,250,200,0.2)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,10,0,0.45)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.restore();
}

function pineTop(c, S, rnd) {
  const pal = PAL.p;
  const R = S / 2;
  c.save();
  const star = (rr, n, inner, rot, fill) => {
    c.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = rot + (i / (n * 2)) * TAU; const r = i % 2 ? rr * inner : rr; c.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
    c.closePath(); c.fillStyle = fill; c.fill();
  };
  star(R * 0.97, 12, 0.62, 0.1, css(pal[0]));
  star(R * 0.8, 11, 0.55, 0.4, css(mix(pal[0], pal[1], 0.7)));
  star(R * 0.58, 9, 0.5, 0.8, css(pal[1]));
  star(R * 0.34, 7, 0.5, 1.1, css(mix(pal[1], pal[2], 0.7)));
  c.lineCap = 'round';
  for (let i = 0; i < 90; i++) { // needles, radiating
    const a = rnd() * TAU;
    const r0 = R * (0.15 + rnd() * 0.7);
    const lit = clamp(0.5 - Math.cos(a) * 0.4 - Math.sin(a) * 0.5, 0, 1);
    c.strokeStyle = css(lit > 0.5 ? pal[3] : pal[0], 0.5);
    c.lineWidth = Math.max(0.6, S * 0.012);
    c.beginPath(); c.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0); c.lineTo(R + Math.cos(a) * (r0 + R * 0.16), R + Math.sin(a) * (r0 + R * 0.16)); c.stroke();
  }
  c.globalCompositeOperation = 'source-atop';
  const g = c.createRadialGradient(R * 0.7, R * 0.65, R * 0.1, R, R, R);
  g.addColorStop(0, 'rgba(200,255,220,0.14)'); g.addColorStop(0.65, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,12,6,0.4)');
  c.fillStyle = g;
  c.fillRect(0, 0, S, S);
  c.restore();
}

/* ----- the pictures: made a few at a time, then stamped ----- */

const KINDS = ['m', 'a', 'o', 'p', 's', 'b'];
const VARIANTS = 4;
const SIDE_ASPECT = { m: 0.34, a: 0.34, o: 0.4, p: 0.24, s: 1.1, b: 1.4 }; // width over height of the side pictures
const SIDE_H = { m: 340, a: 340, o: 330, p: 360, s: 130, b: 104 };
const TOP = 160;

const pics = { side: new Map(), top: new Map() };
let queue = null;
let finished = false;
let onDone = () => {};

// a picture and the smaller copies of it that are used when the tree is far away (so a distant tree does not shimmer)
const levels = (full) => {
  const out = [full];
  let cur = full;
  while (cur.width > 14 && cur.height > 14) {
    const half = make(cur.width / 2, cur.height / 2);
    const h = half.getContext('2d');
    h.imageSmoothingQuality = 'high';
    h.drawImage(cur, 0, 0, half.width, half.height);
    out.push(half);
    cur = half;
  }
  return out;
};

function build(task) {
  const [view, kind, v] = task;
  const rnd = rng((KINDS.indexOf(kind) + 1) * 1009 + v * 7919 + (view === 'top' ? 17 : 3));
  if (view === 'side') {
    const H = SIDE_H[kind];
    const cv = make(H * SIDE_ASPECT[kind], H);
    const c = cv.getContext('2d');
    if (kind === 'p') pineSide(c, cv.width, cv.height, rnd);
    else if (kind === 's' || kind === 'b') bushSide(c, cv.width, cv.height, kind, rnd);
    else crownSide(c, cv.width, cv.height, kind, rnd);
    pics.side.set(`${kind}${v}`, levels(cv));
  } else {
    const cv = make(TOP, TOP);
    const c = cv.getContext('2d');
    if (kind === 'p') pineTop(c, TOP, rnd); else crownTop(c, TOP, kind, rnd);
    pics.top.set(`${kind}${v}`, levels(cv));
  }
}

// begin making the pictures, a few milliseconds at a time (`done` is called when they are all there)
export function start(done = () => {}) {
  if (typeof document === 'undefined' || queue || finished) return;
  onDone = done;
  queue = [];
  for (let v = 0; v < VARIANTS; v++) for (const kind of KINDS) for (const view of ['side', 'top']) queue.push([view, kind, v]);
  const pump = () => {
    const t0 = performance.now();
    while (queue.length && performance.now() - t0 < 5) {
      try { build(queue.shift()); } catch { /* a picture that fails is drawn the old way */ }
    }
    if (queue.length) setTimeout(pump, 0);
    else { finished = true; queue = null; onDone(); }
  };
  setTimeout(pump, 0);
}
export const ready = () => finished;

const hash = (x, y) => Math.floor(Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 * 1000);
const kindOf = (t, turning) => {
  const k = t.k || (t.h < 20 ? 's' : 'm');
  return k === 'm' && turning ? 'a' : k;
};

// the level of a picture to use for something about `px` pixels tall
const levelFor = (list, px) => {
  let i = 0;
  while (i < list.length - 1 && list[i + 1].height >= px * 1.1) i++;
  return list[i];
};

// the same picture, washed toward the haze colour by `fog` (0..0.85) in eighths, made once each
const foggy = new Map();
export function tint(img, fog, haze, id) {
  const b = Math.round(clamp(fog, 0, 0.9) * 8);
  if (!b) return img;
  const key = `${id}|${img.width}|${b}`;
  let out = foggy.get(key);
  if (!out) {
    out = make(img.width, img.height);
    const c = out.getContext('2d');
    c.drawImage(img, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = css(haze, b / 8);
    c.fillRect(0, 0, out.width, out.height);
    foggy.set(key, out);
    if (foggy.size > 1800) foggy.delete(foggy.keys().next().value);
  }
  return out;
}

/** The side picture for a tree, or null while it is not ready: { img, id } sized by the caller. `px` is about how tall it will be drawn. */
export function side(t, px, turning = false) {
  if (!finished) return null;
  const kind = kindOf(t, turning);
  const id = `${kind}${hash(t.x, t.y) % VARIANTS}`;
  const list = pics.side.get(id);
  return list ? { img: levelFor(list, px), id } : null;
}
export const sideAspect = (t, turning = false) => SIDE_ASPECT[kindOf(t, turning)];

/** The picture from above, or null while it is not ready. `px` is about how wide it will be drawn. */
export function top(t, px, turning = false) {
  if (!finished) return null;
  const kind = kindOf(t, turning);
  const list = pics.top.get(`${kind}${hash(t.y, t.x) % VARIANTS}`);
  return list ? levelFor(list, px) : null;
}
