/* The conditions of a hole on the day: the wind, whether it is raining, how late it is, where the pin is and whether there is a mando.
   They come from a seed (a round's, a match's, or the daily course's), so everyone playing the same seed gets the same hole, and the
   server, which re-plays every throw, finds the same basket and the same wind as the page. Nothing here rolls dice: a seed in, a
   description out. A hole with no seed is the classic hole. Feet; x east, y north. */

import { surfaceAt, treesIn, slopeAt } from './course.js?v=11';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function rngOf(seed) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ----- the pin: the basket can be in one of three places on its green ----- */

// The three places: A is where the hole was built, B a little short and left, C a little short and right. A place has to be a place
// you could put a basket: grass, no water or trees close, and not on a slope.
export function pinSpots(hole) {
  const P = hole.route.pts;
  const [bx, by] = P.at(-1);
  const [ax, ay] = P.at(-2);
  const l = Math.hypot(bx - ax, by - ay) || 1;
  const t = { x: (bx - ax) / l, y: (by - ay) / l }; // the way the hole runs into the basket
  const n = { x: t.y, y: -t.x }; // to the right of it
  const spot = (k, back, side) => ({ k, x: Math.round((bx - t.x * back + n.x * side) * 10) / 10, y: Math.round((by - t.y * back + n.y * side) * 10) / 10 });
  const ok = (p) => {
    if (surfaceAt(hole, p.x, p.y) !== 'fairway') return false;
    for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
      const s = surfaceAt(hole, p.x + dx, p.y + dy);
      if (s === 'water' || s === 'oob') return false;
    }
    if (treesIn(hole, { x: p.x - 20, y: p.y - 20 }, { x: p.x + 20, y: p.y + 20 }).some((tr) => Math.hypot(tr.x - p.x, tr.y - p.y) < tr.r + 7)) return false;
    const g = slopeAt(hole, p.x, p.y);
    return Math.hypot(g.gx, g.gy) < 0.14;
  };
  return [{ k: 'A', x: hole.basket.x, y: hole.basket.y }, ...[spot('B', 6, -11), spot('C', 6, 11)].filter(ok)];
}

/* ----- a seed's conditions on one hole ----- */

// `idx` of `n`: how far through the round this hole is, for the light (the last holes are played at dusk)
// Rain is only possible when asked for (`rain: true`): plenty of people do not play in the rain, so it is a choice, off by default.
export function variantFor(seed, hole, { idx = 0, n = 1, rain: allowRain = false } = {}) {
  if (seed === undefined || seed === null || !Number.isFinite(Number(seed))) return null;
  const rnd = rngOf(Number(seed) * 7919 + hole.id * 104729);
  const base = hole.wind || { mph: 0, from: 0 };
  const calm = rnd() < 0.12;
  const mph = calm ? Math.round(rnd() * 3) : clamp(Math.round(base.mph + (rnd() - 0.35) * 9), 1, 20);
  const from = Math.round((base.from + (rnd() - 0.5) * 180 + 720) % 360);
  const rain = rnd() < 0.2 && allowRain; // (the dice are thrown either way, so the rest of a seed's day is the same with or without rain)
  const dusk = n >= 6 ? clamp(idx / (n - 1) - 0.6, 0, 0.4) / 0.4 : 0;
  const pins = pinSpots(hole);
  const pin = pins[Math.floor(rnd() * pins.length)].k;
  const mando = !!hole.mandoSpec && rnd() < 0.55;
  return { seed: Number(seed), wind: { mph: rain ? mph + 3 : mph, from }, rain, dusk: Math.round(dusk * 100) / 100, pin, mando };
}

// the hole as it is on that day: the same hole, with its own wind, basket and weather (and mando, if it has one today)
export function applyVariant(hole, v) {
  if (!v) return hole;
  const pin = pinSpots(hole).find((p) => p.k === v.pin) || { x: hole.basket.x, y: hole.basket.y };
  const props = {
    wind: { value: v.wind, enumerable: true },
    basket: { value: { x: pin.x, y: pin.y }, enumerable: true },
    weather: { value: { rain: v.rain, dusk: v.dusk }, enumerable: true },
    variant: { value: v, enumerable: true },
  };
  if (v.mando && hole.mandoSpec) props.mando = { value: hole.mandoSpec, enumerable: true };
  return Object.create(hole, props);
}
export const holeOn = (seed, hole, where) => applyVariant(hole, variantFor(seed, hole, where));

// short words for the HUD: what is different about today
export function tags(v) {
  if (!v) return [];
  const out = [];
  if (v.rain) out.push('Rain');
  if (v.dusk >= 0.5) out.push('Dusk');
  else if (v.dusk > 0) out.push('Late light');
  if (v.pin && v.pin !== 'A') out.push(`Pin ${v.pin}`);
  if (v.mando) out.push('Mando');
  return out;
}

// what the player is told, once, on the first throw of a hole
export function briefing(v, hole) {
  if (!v) return '';
  const bits = [];
  if (v.rain) bits.push('It is raining: discs skid on landing and putts are slicker.');
  if (v.dusk >= 0.5) bits.push('It is getting dark.');
  if (v.pin !== 'A') bits.push(`The pin is in position ${v.pin} today, ${v.pin === 'B' ? 'short and left' : 'short and right'}.`);
  if (v.mando && hole.mandoSpec) bits.push(`Mando: your first throw has to pass ${hole.mandoSpec.side > 0 ? 'left' : 'right'} of the red post, or it is a stroke and you throw again.`);
  return bits.join(' ');
}
