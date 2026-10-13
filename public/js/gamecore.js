/* The game's rules, with nothing drawn: the throw meter, where a throw goes, what it hits, putting, and keeping score.
   Everything here is a plain function of its inputs (no clock, no randomness), so the same throw always lands in the
   same place and the whole thing can be tested without a screen. The flight itself comes from flightmodel.js, the
   same model the flight guide uses. Feet; x is east, y is north; heading 0 is north, positive is clockwise. */

import { clamp, carryRaw, flightCurve, spinOf, spinsClockwise, angleDeg } from './flightmodel.js?v=1';
import { surfaceAt } from './course.js?v=2';

const DEG = Math.PI / 180;
export const PUTT_RANGE = 50; // inside this you putt
export const GIMME = 3; // inside this the putt is given

export const headingVec = (deg) => ({ ux: Math.sin(deg * DEG), uy: Math.cos(deg * DEG), rx: Math.cos(deg * DEG), ry: -Math.sin(deg * DEG) });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// the heading (degrees from north) of the line from a to b
export const headingTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y) / DEG;

// The hole's wind, as the disc feels it for a throw heading this way: head is into your face, cross pushes you right.
export function windFor(hole, headingDeg) {
  const { mph, from } = hole.wind;
  if (!mph) return { mph: 0, head: 0, cross: 0 };
  const rel = (from - headingDeg) * DEG;
  return { mph, head: mph * Math.cos(rel), cross: -mph * Math.sin(rel) };
}

/* ---------- the throw meter ---------- */

// Two taps. First the power bar: stop the marker in the zone. Then the release: stop the needle at the middle.
// A harder arm is harder to time: a faster marker and a narrower zone.
export function meterSetup(mph) {
  const hard = clamp((mph - 40) / 50, 0, 1);
  return {
    power: { c: 0.9, w: 0.085 - 0.04 * hard, period: 2.3 - 0.8 * hard },
    release: { w: 0.14 - 0.07 * hard, period: 1.9 - 0.6 * hard },
    // a drive also gets a spin slider and an angle slider, each its own speed so there is no rhythm to carry over
    spin: { w: 0.15 - 0.07 * hard, period: 1.75 - 0.55 * hard },
    angle: { w: 0.15 - 0.07 * hard, period: 2.05 - 0.7 * hard },
  };
}
const triangle = (sec, period) => {
  const u = (((sec % period) + period) % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
};
export const powerAt = (sec, setup) => triangle(sec, setup.power.period); // 0..1
export const needleAt = (sec, period) => triangle(sec, period) * 2 - 1; // -1 .. 1
export const releaseAt = (sec, setup) => needleAt(sec, setup.release.period); // -1 (early) .. 1 (late)

export function readPower(m, zone) {
  const lo = zone.c - zone.w;
  const hi = zone.c + zone.w;
  if (m < lo) return { m, pf: clamp(0.3 + 0.7 * (m / lo), 0.3, 1), over: 0, inZone: false };
  if (m <= hi) return { m, pf: 1, over: 0, inZone: true };
  return { m, pf: 1, over: clamp((m - hi) / (1 - hi), 0, 1), inZone: false };
}
export function readRelease(x, zoneW) {
  const inZone = Math.abs(x) <= zoneW;
  return { x, o: inZone ? x * 0.3 : x, inZone };
}
// Spin: the green holds your full spin; a lazy snap or an overcooked one both lose some.
export function readSpin(x, zoneW) {
  const inZone = Math.abs(x) <= zoneW;
  return { x, inZone, spinF: inZone ? 1 : clamp(1 - 0.45 * Math.abs(x), 0.55, 1) };
}
// Angle: the green holds the angle you chose; left of it is flatter, right of it tips onto hyzer, by up to 14 degrees.
export function readAngle(x, zoneW) {
  const inZone = Math.abs(x) <= zoneW;
  return { x, inZone, angleD: inZone ? x * 0.3 * 14 : x * 14 };
}
// a drive's four readings in one: power, spin, angle, release
export function combineDrive(power, spin, angle, release) {
  const sloppy = clamp(Math.abs(release.o) + 0.6 * power.over + 0.8 * (1 - spin.spinF) + Math.abs(angle.angleD) / 20, 0, 1.4);
  const pure = power.inZone && spin.inZone && angle.inZone && release.inZone;
  const grade = pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  return { pf: power.pf, over: power.over, o: release.o, spinF: spin.spinF, angleD: angle.angleD, pure, sloppy, grade };
}

export function combine(power, release) {
  const sloppy = clamp(Math.abs(release.o) + 0.6 * power.over, 0, 1.4);
  const pure = power.inZone && release.inZone;
  const grade = pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  return { pf: power.pf, over: power.over, o: release.o, pure, sloppy, grade };
}

// How the execution changes the throw: a weaker pull is slower, an early release goes toward the turn side and flattens,
// a late one goes toward the fade side and tips onto hyzer, and a sloppy release loses spin.
export function applyExecution(settings, aimDeg, ex) {
  const dir = spinsClockwise(settings) ? 1 : -1;
  const drive = ex.spinF !== undefined; // a drive's own spin and angle readings
  const speedF = ex.pf * (1 - 0.06 * ex.sloppy);
  const spinF = drive ? ex.pf * ex.spinF : ex.pf * (1 - 0.38 * clamp(ex.sloppy - 0.08, 0, 1.2));
  return {
    t2: {
      hand: settings.hand,
      style: settings.style,
      mph: settings.mph * speedF,
      spin: Math.round(spinOf(settings) * spinF),
      angle: settings.angle,
      angleExtra: drive ? ex.angleD + ex.o * 3 : ex.o * 8,
    },
    headingDeg: aimDeg - dir * ex.o * 14,
    bonus: ex.pure ? 1.04 : 1,
  };
}

// What a server will accept from a player: settings in range, and a meter reading that is a real reading.
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
export function sanitizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const mph = num(raw.mph, NaN);
  const angle = num(raw.angle, NaN);
  const spin = raw.spin === null || raw.spin === undefined ? null : num(raw.spin, NaN);
  if (!['right', 'left'].includes(raw.hand) || !['backhand', 'forehand'].includes(raw.style)) return null;
  if (!Number.isInteger(mph) || mph < 10 || mph > 90 || mph % 2) return null;
  if (!Number.isInteger(angle) || angle < -6 || angle > 6) return null;
  if (spin !== null && (!Number.isInteger(spin) || spin < 400 || spin > 1600)) return null;
  return { hand: raw.hand, style: raw.style, mph, spin, angle };
}
export function sanitizeExecution(raw = {}) {
  const pf = clamp(num(raw.pf, 1), 0.3, 1);
  const over = clamp(num(raw.over, 0), 0, 1);
  const o = clamp(num(raw.o, 0), -1, 1);
  const drive = raw.spinF !== undefined || raw.angleD !== undefined;
  const spinF = drive ? clamp(num(raw.spinF, 1), 0.55, 1) : undefined;
  const angleD = drive ? clamp(num(raw.angleD, 0), -14, 14) : undefined;
  const sloppy = clamp(Math.abs(o) + 0.6 * over + (drive ? 0.8 * (1 - spinF) + Math.abs(angleD) / 20 : 0), 0, 1.4);
  const pure = !!raw.pure && pf === 1 && over === 0 && Math.abs(o) <= 0.05 && (!drive || (spinF === 1 && Math.abs(angleD) <= 1.1));
  const grade = pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  return drive ? { pf, over, o, spinF, angleD, pure, sloppy, grade } : { pf, over, o, pure, sloppy, grade };
}

const PERFECT = { pf: 1, over: 0, o: 0, pure: false, sloppy: 0, grade: 'Preview' };

/* ---------- the flight ---------- */

// Plan a throw: how far, and the bend, before anything is in the way.
export function planThrow(hole, disc, settings, aimDeg, ex = PERFECT) {
  const { t2, headingDeg, bonus } = applyExecution(settings, aimDeg, ex);
  const wind = windFor(hole, headingDeg);
  const feet = clamp(carryRaw(disc, wind, t2) * bonus, 12, 560);
  const curve = flightCurve(disc, wind, t2, feet);
  const scale = Math.min(1, feet / 260); // the guide's bends are sized for a long throw; a short one bends less
  // how high the disc gets: more with glide and speed, less on a short throw
  const apex = (14 + disc.glide * 3.2 + disc.speed * 0.8) * clamp(feet / 300, 0.15, 1) ** 0.6;
  return { headingDeg, feet, lat: curve.lat.map((v) => v * scale), apex, t2, wind, ex, dir: curve.dir };
}

// the flight as points: world x and y, height off the ground, and how far along (0..1)
export function samplePath(plan, from, n = 72) {
  const { ux, uy, rx, ry } = headingVec(plan.headingDeg);
  const f = plan.feet;
  const P = [[0, 0], [plan.lat[0], f * 0.32], [plan.lat[1], f * 0.72], [plan.lat[2], f]]; // [right, forward]
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const a = (1 - s) ** 3;
    const b = 3 * (1 - s) ** 2 * s;
    const c = 3 * (1 - s) * s * s;
    const d = s ** 3;
    const right = a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0];
    const fwd = a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1];
    pts.push({
      x: from.x + ux * fwd + rx * right,
      y: from.y + uy * fwd + ry * right,
      h: 4 * (1 - s) + (plan.apex - 4) * 4 * s * (1 - s),
      s,
    });
  }
  return pts;
}

// the nearest point on segment a-b to p: { d: distance, u: how far along a-b (0..1) }
function nearest(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return { u, d: Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) };
}

const ROLL = { fairway: 1, tee: 1, rough: 0.35 };
// Trees are forgiving. Only the heart of one stops a disc (the canopy you see is wider than the part that matters),
// a tree you are standing beside is behind you, not in your way, and a disc that hits one kicks out to the open side.
export const TREE_FORGIVE = 0.75;
const CLEAR_OF = 8; // trees this close to where you stand do not count on the next throw
const BASKET_RADIUS = 1.5;
const BASKET_TOP = 5.5;

function rollOut(hole, disc, plan, from, tangent, surface) {
  const a = angleDeg(plan.t2);
  const flip = clamp(1 - 0.015 * a, 0.5, 1.7); // hyzer discs stick; anhyzer discs run
  const feet = (2 + 0.8 * disc.speed) * flip * (ROLL[surface] ?? 0.35) * clamp(plan.feet / 200, 0.3, 1);
  const pts = [];
  let p = { ...from };
  for (let walked = 1; walked <= feet; walked++) {
    const q = { x: from.x + tangent.x * walked, y: from.y + tangent.y * walked };
    if (distance(q, hole.basket) <= BASKET_RADIUS) return { pts: [...pts, q], kind: 'basket', end: q };
    const s = surfaceAt(hole, q.x, q.y);
    if (s === 'water' || s === 'oob') return { pts: [...pts, q], kind: s, end: q };
    const tr = hole.trees.find((t) => Math.hypot(q.x - t.x, q.y - t.y) < t.r * TREE_FORGIVE * 0.7);
    if (tr) break; // stopped by the trunk
    pts.push(q);
    p = q;
  }
  return { pts, kind: 'landed', end: p };
}

/**
 * Throw it. Returns what happened: where the disc went and where it ended, and what that costs.
 *   kind: 'landed' | 'tree' | 'water' | 'oob' | 'basket'
 *   pts: the flight up to the landing (or the hit); roll: the slide after it
 *   lie: where you play from next; strokes: what the throw costs (a penalty makes it 2)
 */
export function resolveThrow(hole, disc, settings, aimDeg, ex, from) {
  const plan = planThrow(hole, disc, settings, aimDeg, ex);
  const all = samplePath(plan, from);
  const trees = hole.trees.filter((tr) => distance(from, tr) >= tr.r + CLEAR_OF); // the ones beside you are behind you
  let hit = null;
  let basket = null;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const b = all[i];
    for (const tr of trees) {
      const { d, u } = nearest(tr, a, b);
      if (d < tr.r * TREE_FORGIVE && a.h + (b.h - a.h) * u < tr.h && (!hit || i + u < hit.at)) hit = { tree: tr, at: i + u, i, u };
    }
    if (b.h < BASKET_TOP && i > all.length * 0.5) {
      const { d, u } = nearest(hole.basket, a, b);
      if (d <= BASKET_RADIUS && (!basket || i + u < basket.at)) basket = { at: i + u, i, u };
    }
    if (hit && hit.i === i) break;
    if (basket && basket.i === i) break;
  }

  const cut = (g) => {
    const a = all[g.i - 1];
    const b = all[g.i];
    const p = { x: a.x + (b.x - a.x) * g.u, y: a.y + (b.y - a.y) * g.u };
    return { pts: [...all.slice(0, g.i), { ...p, h: a.h + (b.h - a.h) * g.u, s: a.s + (b.s - a.s) * g.u }], p };
  };

  if (basket && (!hit || basket.at < hit.at)) {
    const { pts, p } = cut(basket);
    return { kind: 'basket', plan, pts, roll: [], end: hole.basket, lie: hole.basket, strokes: 1, surface: 'basket', hit: { at: p } };
  }

  if (hit) {
    const { pts, p } = cut(hit);
    // It kicks off the tree and settles beside it: back along where it came from, then out to the side, the side that
    // faces the basket if that is clear, so the next throw has a way out instead of the same trunk in front of it.
    const back = all[Math.max(0, hit.i - 2)];
    const len = Math.hypot(back.x - p.x, back.y - p.y) || 1;
    const bx = (back.x - p.x) / len;
    const by = (back.y - p.y) / len;
    const core = hit.tree.r * TREE_FORGIVE;
    const base = { x: p.x + bx * (core + 2.5), y: p.y + by * (core + 2.5) };
    const sides = [{ x: -by, y: bx }, { x: by, y: -bx }].sort((m, n) => (n.x * (hole.basket.x - hit.tree.x) + n.y * (hole.basket.y - hit.tree.y)) - (m.x * (hole.basket.x - hit.tree.x) + m.y * (hole.basket.y - hit.tree.y)));
    const open = (q) => {
      const sf = surfaceAt(hole, q.x, q.y);
      return sf !== 'water' && sf !== 'oob' && !hole.trees.some((t) => t !== hit.tree && Math.hypot(q.x - t.x, q.y - t.y) < t.r * TREE_FORGIVE + 2);
    };
    const candidates = sides.map((sd) => ({ x: base.x + sd.x * (core + 3), y: base.y + sd.y * (core + 3) }));
    const drop = candidates.find(open) || (open(base) ? base : candidates[0]);
    const s = surfaceAt(hole, drop.x, drop.y);
    if (s === 'water' || s === 'oob') return penalty(plan, pts, s, drop, from, { tree: hit.tree, at: p });
    return { kind: 'tree', plan, pts, roll: [], end: drop, lie: drop, strokes: 1, surface: s, hit: { tree: hit.tree, at: p } };
  }

  const end = all.at(-1);
  const surface = surfaceAt(hole, end.x, end.y);
  if (surface === 'water' || surface === 'oob') return penalty(plan, all, surface, end, from);

  const prev = all.at(-2);
  const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
  const roll = rollOut(hole, disc, plan, end, { x: (end.x - prev.x) / len, y: (end.y - prev.y) / len }, surface);
  if (roll.kind === 'basket') return { kind: 'basket', plan, pts: all, roll: roll.pts, end: hole.basket, lie: hole.basket, strokes: 1, surface: 'basket', hit: { at: roll.end } };
  if (roll.kind === 'water' || roll.kind === 'oob') return penalty(plan, all, roll.kind, roll.end, from, null, roll.pts);
  return { kind: 'landed', plan, pts: all, roll: roll.pts, end: roll.end, lie: roll.end, strokes: 1, surface: surfaceAt(hole, roll.end.x, roll.end.y) };
}

// out of bounds: the throw counts, plus a stroke, and you play again from where you threw
function penalty(plan, pts, kind, at, from, extra = null, roll = []) {
  return { kind, plan, pts, roll, end: at, lie: { ...from }, strokes: 2, surface: kind, penalty: true, ...(extra ? { hit: extra } : {}) };
}

/* ---------- putting ---------- */

// Inside PUTT_RANGE it is one tap on a swirling green. A dot wanders over a round grid on a path that never repeats; you
// tap when it is inside the target at the center. The target shrinks with distance and with a faster disc, and the dot
// speeds up the farther out you are.
export function puttZone(dist, disc) {
  return clamp(0.36 - 0.0068 * dist - 0.012 * Math.max(0, disc.speed - 4), 0.04, 0.36);
}
export const puttRadius = (dist, disc) => clamp(puttZone(dist, disc) * 1.2, 0.07, 0.42); // of the grid's radius
export const puttSpeed = (dist) => 1 + 0.9 * clamp(dist / PUTT_RANGE, 0, 1);

// The wandering dot: it spirals out from the middle and back through it, its distance from the center the size of two slow
// waves added together, and the direction it faces speeding up, slowing and even reversing. Every pass through the middle
// comes at an irregular time and from a new direction, so there is no rhythm to learn, but the green is always reached.
// `rand` supplies the randomness (the browser gives it Math.random); the same seed always traces the same path, which is
// what lets it be tested.
export function makePuttSeed(rand) {
  const between = (lo, hi) => lo + (hi - lo) * rand();
  return {
    f: [between(0.7, 1.0), between(1.5, 2.1)],
    p: [between(0, 6.2832), between(0, 6.2832)],
    w: between(1.3, 2.1) * (rand() < 0.5 ? -1 : 1),
    g: between(0.5, 0.9),
    gp: between(0, 6.2832),
    th0: between(0, 6.2832),
  };
}
export function puttCursorAt(seed, sec, speed = 1) {
  const t = sec * speed;
  const wave = 0.7 * Math.sin(seed.f[0] * t + seed.p[0]) + 0.3 * Math.sin(seed.f[1] * t + seed.p[1]);
  const r = Math.min(1, Math.abs(wave) * 1.05);
  const th = seed.th0 + seed.w * t + 1.1 * Math.sin(seed.g * t + seed.gp);
  return { x: r * Math.cos(th), y: r * Math.sin(th) }; // x across the green (left/right), y along the putt (short/long)
}

// `shot` is where the dot was when you tapped: { x, y } in the grid's units (a bare number is just x).
export function resolvePutt(hole, lie, disc, shot) {
  const dist = distance(lie, hole.basket);
  const v = typeof shot === 'number' ? { x: shot, y: 0 } : { x: Number(shot?.x) || 0, y: Number(shot?.y) || 0 };
  const off = Math.hypot(v.x, v.y);
  const radius = puttRadius(dist, disc);
  const zone = puttZone(dist, disc);
  if (dist <= GIMME || off <= radius) {
    return { kind: 'basket', made: true, gimme: dist <= GIMME && off > radius, strokes: 1, lie: hole.basket, dist, zone, radius };
  }
  // a miss: a few feet from the basket, on the side the dot was: across is left or right, up is long, down is short
  const miss = clamp(2.5 + off * 10, 3, 14);
  const hv = headingVec(headingTo(lie, hole.basket));
  const along = (v.y / off) * miss;
  const across = (v.x / off) * miss;
  const spot = {
    x: hole.basket.x + hv.ux * along + hv.rx * across,
    y: hole.basket.y + hv.uy * along + hv.ry * across,
  };
  const s = surfaceAt(hole, spot.x, spot.y);
  const lieAfter = s === 'water' || s === 'oob' ? { x: hole.basket.x - hv.ux * 3, y: hole.basket.y - hv.uy * 3 } : spot;
  return { kind: 'landed', made: false, strokes: 1, lie: lieAfter, dist, zone, radius, miss };
}

/* ---------- the round ---------- */

export const scoreName = (strokes, par) => {
  if (strokes === 1) return 'Ace!';
  const d = strokes - par;
  return d <= -3 ? 'Albatross' : d === -2 ? 'Eagle' : d === -1 ? 'Birdie' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : d === 3 ? 'Triple bogey' : `+${d}`;
};
export const atTripleBogey = (strokes, par) => strokes - par >= 3;

// A hole you did not finish (Marebear ate your whole bag) counts as the worst a hole can: a stroke more than you took, but
// never less than par plus four.
export const holeScore = (strokes, par, holed) => (holed ? strokes : Math.max(strokes + 1, par + 4));

export function newRound(hole) {
  return { hole, lie: { ...hole.tee }, strokes: 0, throws: [], eaten: [], bearCame: false, done: false, holed: false };
}

/**
 * Put a result into the round: strokes, the lie, whether it is holed. Marebear comes for the disc you just threw the
 * first time you are at a triple bogey (or worse) and still have not holed out. Returns { bear } when she does.
 */
export function applyResult(round, disc, result) {
  round.strokes += result.strokes;
  round.lie = { ...result.lie };
  round.throws.push({ disc: disc.id, kind: result.kind, feet: result.plan?.feet ?? result.dist, strokes: round.strokes, lie: { ...result.lie } });
  if (result.kind === 'basket') {
    round.done = true;
    round.holed = true;
    return {};
  }
  if (!round.bearCame && atTripleBogey(round.strokes, round.hole.par)) {
    round.bearCame = true;
    round.eaten.push(disc.id);
    return { bear: { discId: disc.id, at: result.end ?? result.lie } };
  }
  return {};
}
