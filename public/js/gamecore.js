/* The game's rules, with nothing drawn: the throw meter, where a throw goes, what it hits, putting, and keeping score.
   Everything here is a plain function of its inputs (no clock, no randomness), so the same throw always lands in the
   same place and the whole thing can be tested without a screen. The flight itself comes from flightmodel.js, the
   same model the flight guide uses. Feet; x is east, y is north; heading 0 is north, positive is clockwise. */

import { clamp, carryRaw, flightCurve, spinOf, spinsClockwise, angleDeg, armAt, ANGLE_MAX } from './flightmodel.js?v=1';
import { surfaceAt, treesIn, elevAt, slopeAt, routePosition } from './course.js?v=11';

const DEG = Math.PI / 180;
export const PUTT_RANGE = 50; // inside this you putt
export const GIMME = 2; // inside this the putt is given

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

// Four taps, and the player's own throw comes out of them. Power, nose and angle are each a bar with a marker that
// sweeps back and forth: where you stop it IS the arm speed, the nose angle, the hyzer angle. Then the release is the test:
// stop the needle in the middle. Each bar has its own speed so there is no rhythm to carry from one to the next.
export const METER = {
  power: { period: 2.2 },
  nose: { period: 1.75 },
  angle: { period: 2.05 },
};
// a harder arm is harder to time on the release: a faster needle and a narrower zone
export function releaseSetup(mph) {
  const hard = clamp((mph - 40) / 50, 0, 1);
  return { w: 0.14 - 0.07 * hard, period: 1.9 - 0.6 * hard };
}
const triangle = (sec, period) => {
  const u = (((sec % period) + period) % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
};
// The power marker speeds up toward the end of the bar (POWER_EASE), and the top speeds are squeezed into the last stretch
// of it (past POWER_KNEE, and thinner toward the very end), so a fast arm is a fast marker and a thin target: the harder you swing, the harder to land.
export const POWER_KNEE = 0.58; // the last 42% of the bar is the hard zone
export const POWER_KNEE_MPH = 50;
const POWER_EASE = 2.1;
const POWER_CURVE = 2.4; // inside the hard zone each step of bar is worth more mph the nearer the end
export const powerAt = (sec) => triangle(sec, METER.power.period) ** POWER_EASE; // 0..1: where the marker is on the bar
export const needleAt = (sec, period) => triangle(sec, period) * 2 - 1; // -1 .. 1
export const releaseAt = (sec, setup) => needleAt(sec, setup.period); // -1 (early) .. 1 (late)

export const ARM = { min: 10, max: 90, step: 2 }; // the guide stops at 30; a hole needs soft approaches too
const snap = (v, step) => Math.round(v / step) * step;
// the arm speed a position on the power bar (0..1) stands for
export const mphAt = (m) => {
  const raw = m <= POWER_KNEE
    ? ARM.min + (POWER_KNEE_MPH - ARM.min) * (m / POWER_KNEE)
    : POWER_KNEE_MPH + (ARM.max - POWER_KNEE_MPH) * ((m - POWER_KNEE) / (1 - POWER_KNEE)) ** POWER_CURVE;
  return clamp(snap(raw, ARM.step), ARM.min, ARM.max);
};
// The nose angle: how far the front of the disc is tipped up (+) or down (-) as it leaves the hand, in steps of 2.5 degrees.
// Nose up lifts the disc higher (over a shrub or a low branch) but spends distance; nose down keeps it low and flat and
// also shortens it. Level is the usual throw. A needle position (-1..1) stands for a whole step.
export const NOSE_MAX = 5;
export const NOSE_DEG = 2.5;
export const noseAt = (x) => clamp(Math.round(x * NOSE_MAX), -NOSE_MAX, NOSE_MAX);
export const noseDeg = (n) => n * NOSE_DEG;
export const noseCarry = (n) => (n >= 0 ? 1 - 0.008 * n - 0.0055 * n * n : 1 - 0.045 * -n); // nose up: a little, then more; nose down: steadily less
export const noseHeight = (n) => (n >= 0 ? 1 + 0.11 * n : Math.max(0.25, 1 + 0.15 * n));
export const noseName = (n) => (n === 0 ? 'Level' : `Nose ${n > 0 ? 'up' : 'down'} ${noseDeg(Math.abs(n))}°`);
// the release angle a needle position (-1 anhyzer .. 1 hyzer) stands for: whole steps, 0 is flat
export const angleAt = (x) => clamp(Math.round(x * ANGLE_MAX), -ANGLE_MAX, ANGLE_MAX);

export function readRelease(x, zoneW) {
  const inZone = Math.abs(x) <= zoneW;
  return { x, o: inZone ? x * 0.3 : x, inZone };
}
export function combine(release) {
  const sloppy = clamp(Math.abs(release.o), 0, 1.4);
  const pure = release.inZone;
  const grade = pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  return { o: release.o, pure, sloppy, grade };
}

// A slow arm can lose the disc: it sticks to the fingers (a grip lock) or slips out early. Below Intermediate Plus the
// chance grows as the arm slows, more for a fast disc, and a little more when the nose angle or the release angle is
// extreme. Nothing here rolls the dice: the caller supplies the roll (0..1), so it stays testable
// and a match server can roll for both players.
export const SLIP_BELOW = 66; // mph: Intermediate Plus and under
export function slipChance(disc, settings) {
  const arm = clamp((SLIP_BELOW - settings.mph) / (SLIP_BELOW - ARM.min), 0, 1);
  if (!arm) return 0;
  const fast = 0.6 + 0.4 * clamp(disc.speed / 12, 0, 1);
  const noseOff = clamp(Math.abs(settings.nose || 0) / NOSE_MAX, 0, 1);
  const edge = Math.abs(settings.angle) >= 5 ? 1 : 0;
  return clamp(0.3 * arm ** 1.5 * fast + arm * (0.06 * noseOff + 0.04 * edge), 0, 0.4);
}
// 'grip' (a grip lock), 'early' (an early release), or null for a clean throw
export function rollSlip(disc, settings, roll) {
  const c = slipChance(disc, settings);
  return roll < c ? (roll < c / 2 ? 'grip' : 'early') : null;
}
// the throw as it comes out when it slips: a grip lock comes out late, short and hooked; an early release goes
// toward the turn side, flat and a little short
export function applySlip(ex, kind) {
  if (kind === 'grip') return { ...ex, o: 0.9, sloppy: 1, pure: false, grade: 'Grip lock', slip: 'grip' };
  if (kind === 'early') return { ...ex, o: -0.9, sloppy: 1, pure: false, grade: 'Early release', slip: 'early' };
  return ex;
}

/* The swipe on a drive, after the release: a flick up the screen, as long as this arm speed needs. It is graded, not pass or fail: off line
   steers the throw the same way, too soft loses speed, too hard makes the throw loose. Within the tolerance it changes nothing. */
export const DRIVE_SWIPE = { aim: 12, power: 0.25 };
export function withSwipe(ex, swipe) {
  if (!swipe) return ex;
  const aimOver = Math.max(0, Math.abs(swipe.aim) - DRIVE_SWIPE.aim); // degrees past what is forgiven
  const weak = Math.max(0, 1 - DRIVE_SWIPE.power - swipe.power);
  const strong = Math.max(0, swipe.power - 1 - DRIVE_SWIPE.power);
  const swipeAim = clamp(Math.sign(swipe.aim) * aimOver * 0.9, -25, 25);
  const swipeSpeed = 1 - Math.min(0.5, weak * 1.3);
  const sloppy = clamp(ex.sloppy + Math.min(0.8, strong * 0.9) + Math.min(0.5, aimOver / 60), 0, 1.4);
  const pure = ex.pure && Math.abs(swipe.aim) <= DRIVE_SWIPE.aim && Math.abs(swipe.power - 1) <= DRIVE_SWIPE.power;
  const grade = ex.slip ? ex.grade : pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  return { ...ex, swipe, swipeAim, swipeSpeed, sloppy, pure, grade };
}

// How the release changes the throw: an early one goes toward the turn side and flattens, a late one goes toward the
// fade side and tips onto hyzer, and a sloppy one loses spin and a little speed.
export function applyExecution(settings, aimDeg, ex) {
  const dir = spinsClockwise(settings) ? 1 : -1;
  return {
    t2: {
      hand: settings.hand,
      style: settings.style,
      mph: settings.mph * (1 - 0.06 * ex.sloppy) * (ex.slip === 'grip' ? 0.7 : ex.slip === 'early' ? 0.85 : 1) * (ex.swipeSpeed ?? 1),
      spin: Math.round(spinOf(settings) * (1 - 0.38 * clamp(ex.sloppy - 0.08, 0, 1.2))),
      nose: settings.nose || 0,
      angle: settings.angle,
      angleExtra: ex.o * 8,
    },
    headingDeg: aimDeg - dir * ex.o * 14 + (ex.swipeAim || 0),
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
  const nose = raw.nose === undefined || raw.nose === null ? 0 : num(raw.nose, NaN); // older pages do not send one
  if (!['right', 'left'].includes(raw.hand) || !['backhand', 'forehand'].includes(raw.style)) return null;
  if (!Number.isInteger(mph) || mph < 10 || mph > 90 || mph % 2) return null;
  if (!Number.isInteger(angle) || angle < -6 || angle > 6) return null;
  if (spin !== null && (!Number.isInteger(spin) || spin < 400 || spin > 1600)) return null;
  if (!Number.isInteger(nose) || nose < -NOSE_MAX || nose > NOSE_MAX) return null;
  return { hand: raw.hand, style: raw.style, mph, spin, angle, nose };
}
export function sanitizeExecution(raw = {}) {
  const o = clamp(num(raw.o, 0), -1, 1);
  const sloppy = clamp(Math.abs(o), 0, 1.4);
  const pure = !!raw.pure && Math.abs(o) <= 0.05;
  const grade = pure ? 'Pure' : sloppy < 0.25 ? 'Good' : sloppy < 0.55 ? 'Loose' : 'Shank';
  const base = { o, pure, sloppy, grade };
  return withSwipe(base, sanitizeSwipe(raw.swipe)); // a drive's swipe, if the page sent one
}

const PERFECT = { o: 0, pure: false, sloppy: 0, grade: 'Preview' };

/* ---------- the sweet spots ---------- */

// Each bar can show where its sweet spot is: the settings that put the disc closest to the basket from here, given the
// aim and whatever the earlier bars already set. Power looks at every arm speed (with a level nose, and the best angle
// for each); nose looks at every nose angle at the arm speed you chose; angle looks at every angle at that speed and nose.
// A value is in the sweet spot when it lands within SWEET_SLACK feet of the best landing there is, so on a long hole it
// is "as close as this disc can get" and near the basket it is "a putt you can make". Trees and water count: it plays
// each candidate through resolveThrow with a clean release.
export const SWEET_SLACK = 20;
const SWEET_RELEASE = { o: 0, pure: false, sloppy: 0, grade: 'Sweet' };
export const ANGLES = Array.from({ length: ANGLE_MAX * 2 + 1 }, (_, i) => i - ANGLE_MAX);
// The sweet spots are worked out by playing candidates through resolveThrow, which is a lot of throws (hundreds), so it is a job that can be done
// a few at a time (`next(n)`), and the page does it between frames instead of in one go. A guide does not need a fine path: 36 samples.
const SWEET_SAMPLES = 36;
export function sweetJob(hole, disc, base, aimDeg, from, stage) {
  const away = (t) => distance(resolveThrow(hole, disc, t, aimDeg, SWEET_RELEASE, from, SWEET_SAMPLES).lie, hole.basket);
  const angles = ANGLES.filter((a) => a % 2 === 0); // every other angle: it is a guide
  let values;
  let tasks; // [value index, settings to try]
  if (stage === 'power') {
    values = Array.from({ length: (ARM.max - ARM.min) / ARM.step + 1 }, (_, i) => ARM.min + i * ARM.step);
    tasks = values.flatMap((mph, vi) => angles.map((angle) => [vi, { ...base, mph, nose: 0, angle }]));
  } else if (stage === 'nose') {
    values = Array.from({ length: NOSE_MAX * 2 + 1 }, (_, i) => i - NOSE_MAX);
    tasks = values.flatMap((nose, vi) => angles.map((angle) => [vi, { ...base, nose, angle }]));
  } else {
    values = ANGLES;
    tasks = values.map((angle, vi) => [vi, { ...base, angle }]);
  }
  const dist = values.map(() => Infinity);
  let at = 0;
  return {
    total: tasks.length,
    done: () => at >= tasks.length,
    next(count = 1) {
      for (let k = 0; k < count && at < tasks.length; k++, at++) {
        const [vi, t] = tasks[at];
        dist[vi] = Math.min(dist[vi], away(t));
      }
    },
    result() {
      const best = Math.min(...dist);
      return { stage, values, dist: [...dist], best, ok: dist.map((d) => d <= best + SWEET_SLACK) };
    },
  };
}
export function sweetSpots(hole, disc, base, aimDeg, from, stage) {
  const job = sweetJob(hole, disc, base, aimDeg, from, stage);
  job.next(Infinity);
  return job.result();
}
// where a value sits on its bar (0..1): the inverse of what each bar reads
export function powerPos(mph) {
  if (mph <= POWER_KNEE_MPH) return POWER_KNEE * clamp((mph - ARM.min) / (POWER_KNEE_MPH - ARM.min), 0, 1);
  return POWER_KNEE + (1 - POWER_KNEE) * clamp((mph - POWER_KNEE_MPH) / (ARM.max - POWER_KNEE_MPH), 0, 1) ** (1 / POWER_CURVE);
}
export const noseBarPos = (n) => clamp((n / NOSE_MAX + 1) / 2, 0, 1);
export const angleBarPos = (a) => clamp((a / ANGLE_MAX + 1) / 2, 0, 1);
// the runs of sweet values as stretches of their bar: [{ from, to }] in 0..1 (each value owns half a step either side)
export function sweetBands(sweet) {
  const { stage, values, ok } = sweet;
  const half = stage === 'power' ? ARM.step / 2 : 0.5;
  const pos = stage === 'power' ? powerPos : stage === 'nose' ? noseBarPos : angleBarPos;
  const bands = [];
  for (let i = 0; i < values.length; i++) {
    if (!ok[i]) continue;
    const from = pos(values[i] - half);
    const to = pos(values[i] + half);
    const last = bands.at(-1);
    if (last && ok[i - 1]) last.to = to; else bands.push({ from, to });
  }
  return bands;
}

/* ---------- the aim preview ---------- */

// The arm speed a typical player throws this disc at: the slowest arm that gets it fully up to speed (30 mph and up).
export function typicalArm(disc) {
  for (let mph = 30; mph <= 90; mph += 2) if (armAt(mph).cap >= disc.speed) return mph;
  return 90;
}
// What the aim line shows before the meters: a typical throw (not perfect, not terrible) as a line, and the ground a
// mistimed release can reach as a shaded band either side of it. Trees and water are not considered: it is a guide.
export function previewThrow(hole, disc, settings, aimDeg, from, n = 40) {
  const mph = typicalArm(disc);
  const base = { hand: settings.hand, style: settings.style, mph, spin: null, angle: 0, nose: 0 };
  const path = (o) => samplePath(planThrow(hole, disc, base, aimDeg, { o, pure: false, sloppy: Math.abs(o), grade: 'Preview' }), from, n, hole);
  const line = path(0.1);
  const early = path(-0.4);
  const late = path(0.4);
  return { mph, line, band: [...late, ...early.reverse()], end: line.at(-1) };
}

/* ---------- the flight ---------- */

// Plan a throw: how far, and the bend, before anything is in the way.
export function planThrow(hole, disc, settings, aimDeg, ex = PERFECT) {
  const { t2, headingDeg, bonus } = applyExecution(settings, aimDeg, ex);
  const wind = windFor(hole, headingDeg);
  const nose = settings.nose || 0;
  const feet = clamp(carryRaw(disc, wind, t2) * bonus * noseCarry(nose), 12, 560);
  const curve = flightCurve(disc, wind, t2, feet);
  const scale = Math.min(1, feet / 260); // the guide's bends are sized for a long throw; a short one bends less
  // how high the disc gets: more with glide and speed, less on a short throw
  const apex = (14 + disc.glide * 3.2 + disc.speed * 0.8) * clamp(feet / 300, 0.15, 1) ** 0.6 * noseHeight(nose);
  return { headingDeg, feet, lat: curve.lat.map((v) => v * scale), apex, t2, wind, ex, dir: curve.dir };
}

// the flight as points: world x and y, height off the ground (h) and above the tee (z), and how far along (0..1)
// On a hole with hills the disc comes down where the ground meets it, not where level ground would have: farther if the land falls
// away, shorter if it rises. The flight carries on past where it would have landed until it does, or ends early at a ridge.
const S_MAX = 1.5;
export function samplePath(plan, from, n = 72, hole = null) {
  const { ux, uy, rx, ry } = headingVec(plan.headingDeg);
  const f = plan.feet;
  const P = [[0, 0], [plan.lat[0], f * 0.32], [plan.lat[1], f * 0.72], [plan.lat[2], f]]; // [right, forward]
  const at = (s) => { // s past 1 is the same curve carrying on
    const a = (1 - s) ** 3;
    const b = 3 * (1 - s) ** 2 * s;
    const c = 3 * (1 - s) * s * s;
    const d = s ** 3;
    const right = a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0];
    const fwd = a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1];
    return { x: from.x + ux * fwd + rx * right, y: from.y + uy * fwd + ry * right, h: 4 * (1 - s) + (plan.apex - 4) * 4 * s * (1 - s) };
  };
  const hilly = !!hole?.field;
  const z0 = hilly ? elevAt(hole, from.x, from.y) : 0;
  let sEnd = 1;
  if (hilly) {
    const step = 1 / (n * 2);
    let prev = z0 + 4 - elevAt(hole, from.x, from.y); // how far above the ground it is
    sEnd = S_MAX;
    for (let s = step; s <= S_MAX + 1e-9; s += step) {
      const q = at(s);
      const gap = z0 + q.h - elevAt(hole, q.x, q.y);
      if (gap <= 0) { sEnd = s - step + (step * prev) / (prev - gap); break; }
      prev = gap;
    }
  }
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const q = at((sEnd * i) / n);
    if (!hilly) { pts.push({ x: q.x, y: q.y, h: q.h, z: q.h, s: i / n }); continue; }
    const z = z0 + q.h;
    pts.push({ x: q.x, y: q.y, h: i === n ? 0 : Math.max(0, z - elevAt(hole, q.x, q.y)), z: i === n ? elevAt(hole, q.x, q.y) : z, s: i / n });
  }
  return pts;
}

// where (0..1) the segment a-b crosses a mando's ray (from its post, along its direction, for its length), or null
function rayCross(a, b, m) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = m.dx * m.len;
  const sy = m.dy * m.len;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((m.x - a.x) * sy - (m.y - a.y) * sx) / den;
  const v = ((m.x - a.x) * ry - (m.y - a.y) * rx) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? u : null;
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
export const TREE_FORGIVE = 0.9; // a trunk stops a disc within this share of the tree's radius
const CLEAR_OF = 2; // a tree touching where you stand does not count (woods are otherwise solid)
const BASKET_RADIUS = 1.5;
const BASKET_TOP = 5.5;

// How far a disc runs on landing. On the flat it is a few feet; the hill matters: it runs on downhill, and stops short going uphill.
const ROLL_CAP = 70;
function rollOut(hole, disc, plan, from, tangent, surface) {
  const a = angleDeg(plan.t2);
  const flip = clamp(1 - 0.015 * a, 0.5, 1.7); // hyzer discs stick; anhyzer discs run
  const feet = (2 + 0.8 * disc.speed) * flip * (ROLL[surface] ?? 0.35) * clamp(plan.feet / 200, 0.3, 1) * (hole.weather?.rain ? 1.7 : 1); // wet grass: a disc skids on
  const pts = [];
  let p = { ...from };
  let walked = 0;
  let budget = feet;
  const hilly = !!hole.field;
  const dirAt = (q, t) => { // the way it is rolling: its own way, pulled downhill where the ground is steep
    if (!hilly) return t;
    const g = slopeAt(hole, q.x, q.y);
    const gm = Math.hypot(g.gx, g.gy);
    if (gm < 0.05) return t;
    const k = Math.min(0.6, (gm - 0.05) * 4);
    const x = t.x * (1 - k) - (g.gx / gm) * k;
    const y = t.y * (1 - k) - (g.gy / gm) * k;
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  };
  let dir = tangent;
  while (budget >= 1 && walked < ROLL_CAP) {
    dir = dirAt(p, dir);
    const q = { x: p.x + dir.x, y: p.y + dir.y };
    if (distance(q, hole.basket) <= BASKET_RADIUS) return { pts: [...pts, q], kind: 'basket', end: q };
    const s = surfaceAt(hole, q.x, q.y);
    if (s === 'water' || s === 'oob') return { pts: [...pts, q], kind: s, end: q };
    const tr = hole.trees.find((t) => Math.hypot(q.x - t.x, q.y - t.y) < t.r * TREE_FORGIVE * 0.7);
    if (tr) break; // stopped by the trunk
    pts.push(q);
    const rise = hilly ? elevAt(hole, q.x, q.y) - elevAt(hole, p.x, p.y) : 0; // feet gained in that one foot of run
    budget -= clamp(1 + 6 * rise, 0.15, 3); // uphill costs more of what it has left; downhill costs less
    walked++;
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
export function resolveThrow(hole, disc, settings, aimDeg, ex, from, samples = 72) {
  const plan = planThrow(hole, disc, settings, aimDeg, ex);
  const all = samplePath(plan, from, samples, hole);
  const zBasket = elevAt(hole, hole.basket.x, hole.basket.y);
  // the trees that could matter: not the one you just bounced off (a lie remembers it as `t`), nor one touching you, and only those near the path
  const skip = from.t !== undefined ? hole.trees[from.t] : null;
  const lo = { x: Math.min(...all.map((p) => p.x)) - 10, y: Math.min(...all.map((p) => p.y)) - 10 };
  const hi = { x: Math.max(...all.map((p) => p.x)) + 10, y: Math.max(...all.map((p) => p.y)) + 10 };
  const trees = treesIn(hole, lo, hi).filter((tr) => tr !== skip && distance(from, tr) >= tr.r + CLEAR_OF && tr.x >= lo.x && tr.x <= hi.x && tr.y >= lo.y && tr.y <= hi.y);
  // a mando (on the days there is one): a first throw has to go on the right side of the post, or it is a stroke and a re-throw
  let mandoHit = null;
  const md = hole.mando;
  if (md && routePosition(hole, from.x, from.y).s < md.s - 4) {
    for (let i = 1; i < all.length && !mandoHit; i++) {
      const u = rayCross(all[i - 1], all[i], md);
      if (u !== null) mandoHit = { i, u, at: i + u };
    }
  }
  let hit = null;
  let basket = null;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1];
    const b = all[i];
    for (const tr of trees) {
      const { d, u } = nearest(tr, a, b);
      if (d < tr.r * TREE_FORGIVE && a.z + (b.z - a.z) * u < (tr.z || 0) + tr.h && (!hit || i + u < hit.at)) hit = { tree: tr, at: i + u, i, u };
    }
    if (b.z - zBasket < BASKET_TOP && i > all.length * 0.5) {
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
    return { pts: [...all.slice(0, g.i), { ...p, h: a.h + (b.h - a.h) * g.u, z: a.z + (b.z - a.z) * g.u, s: a.s + (b.s - a.s) * g.u }], p };
  };

  if (mandoHit && (!hit || mandoHit.at < hit.at) && (!basket || mandoHit.at < basket.at)) {
    const { pts, p } = cut(mandoHit);
    return penalty(plan, pts, 'mando', p, from, { at: p });
  }

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
    return { kind: 'tree', plan, pts, roll: [], end: drop, lie: { x: drop.x, y: drop.y, t: hole.trees.indexOf(hit.tree) }, strokes: 1, surface: s, hit: { tree: hit.tree, at: p } }; // the tree you hit is out of the way of the next throw
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
// Past 30 feet a putt is a long shot: the target keeps shrinking toward a pinprick and the dot speeds up, so holing one is rare.
export const LONG_PUTT = 30;
const beyond = (dist) => clamp((dist - LONG_PUTT) / (PUTT_RANGE - LONG_PUTT), 0, 1);
// A short putt should go in unless you really mess it up: inside about 30 feet the target is much bigger than the long-range curve says
// (a bit over half the green at 10 ft, a third at 20), and it settles into the old size by the time the long putts begin.
const closeBoost = (dist) => clamp(0.36 * (1 - dist / 32), 0, 0.36);
export const puttRadius = (dist, disc) => Math.max(0.022, Math.min(0.62, clamp(puttZone(dist, disc) * 0.9, 0.05, 0.34) + closeBoost(dist)) * (1 - 0.82 * beyond(dist))); // of the grid's radius
export const puttSpeed = (dist) => 1.2 + 1.1 * clamp(dist / PUTT_RANGE, 0, 1) + 1.7 * beyond(dist);

// The wandering dot: it spirals out from the middle and back through it, its distance from the center the size of two slow
// waves added together, and the direction it faces speeding up, slowing and even reversing. Every pass through the middle
// comes at an irregular time and from a new direction, so there is no rhythm to learn, but the green is always reached.
// `rand` supplies the randomness (the browser gives it Math.random); the same seed always traces the same path, which is
// what lets it be tested.
export function makePuttSeed(rand) {
  const between = (lo, hi) => lo + (hi - lo) * rand();
  return {
    f: [between(0.7, 1.0), between(1.5, 2.1), between(3.2, 4.4)], // the last is a quick twitch on top of the two slow waves
    p: [between(0, 6.2832), between(0, 6.2832), between(0, 6.2832)],
    w: between(1.3, 2.1) * (rand() < 0.5 ? -1 : 1),
    g: between(0.5, 0.9),
    gp: between(0, 6.2832),
    th0: between(0, 6.2832),
  };
}
export function puttCursorAt(seed, sec, speed = 1) {
  const t = sec * speed;
  const wave = 0.62 * Math.sin(seed.f[0] * t + seed.p[0]) + 0.28 * Math.sin(seed.f[1] * t + seed.p[1]) + 0.12 * Math.sin(seed.f[2] * t + seed.p[2]);
  const r = Math.min(1, Math.abs(wave) * 1.05);
  const th = seed.th0 + seed.w * t + 1.1 * Math.sin(seed.g * t + seed.gp);
  return { x: r * Math.cos(th), y: r * Math.sin(th) }; // x across the green (left/right), y along the putt (short/long)
}

// How likely a missed putt is to take a nasty roll and run away from the basket: more from far out, more for a fast disc, and more
// when it has just lipped out (it is already on its way).
export const nastyChance = (dist, disc, rim) => clamp((0.06 + 0.1 * clamp(dist / PUTT_RANGE, 0, 1) + 0.01 * Math.max(0, disc.speed - 3)) * (rim ? 1.5 : 1) * clamp(dist / 30, 0.35, 1), 0, 0.3); // a short putt that misses rarely runs away

/* The swipe that follows the radar: a flick toward the basket. How true it was (aim: degrees off the line, + is right) and how hard
   (power: 1 is just enough). Outside these tolerances it cannot go in; the tolerance tightens the farther out you are. */
// (inside 25 ft it is more forgiving still: about 14 degrees and 30% at 10 ft, so a short putt is only missed by a swipe that is really off)
export const swipeTolerance = (dist) => ({ aim: clamp(10 - dist * 0.14, 3.2, 10) + Math.max(0, 25 - dist) * 0.34, power: clamp(0.22 - dist * 0.0025, 0.1, 0.22) + Math.max(0, 25 - dist) * 0.006 });
export function swipeQuality(dist, swipe) {
  const tol = swipeTolerance(dist);
  const aimErr = swipe.aim;
  const powErr = swipe.power - 1;
  const aimN = Math.abs(aimErr) / tol.aim;
  const powN = Math.abs(powErr) / tol.power;
  return { tol, aimErr, powErr, aimN, powN, q: Math.max(aimN, powN) }; // q of 1 or less is a true swipe
}
// what a server accepts for a swipe: two real numbers in a believable range, or nothing (an older page: counted as a true swipe)
export function sanitizeSwipe(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const aim = Number(raw.aim);
  const power = Number(raw.power);
  if (!Number.isFinite(aim) || !Number.isFinite(power)) return null;
  return { aim: clamp(aim, -60, 60), power: clamp(power, 0, 2.5) };
}

/* The lay of the land at the basket. `rise` is how many feet the basket is above you (negative: below). Uphill a putt is easier (the
   disc comes in on a climb and stays in the basket) and needs more push; downhill it is harder, needs less push, and runs away more. */
// wet grass is slicker: the target is a little smaller
export const puttGrip = (hole) => (hole.weather?.rain ? 0.92 : 1);
export const riseTo = (hole, lie) => elevAt(hole, hole.basket.x, hole.basket.y) - elevAt(hole, lie.x, lie.y);
// how hard the putt is, as a distance: the real one, a little shorter uphill and longer downhill
export function puttDist(hole, lie) {
  const d = distance(lie, hole.basket);
  return clamp(d - 0.9 * riseTo(hole, lie), d * 0.7, d * 1.4);
}
// how far the swipe has to carry the disc: the real distance and then some uphill, less downhill
export function puttPush(hole, lie) {
  const d = distance(lie, hole.basket);
  return clamp(d + 1.8 * riseTo(hole, lie), d * 0.5, d * 1.8);
}

// `shot` is where the dot was when you tapped: { x, y } in the grid's units (a bare number is just x). `roll` is the dice
// (0..1) for a nasty roll: the caller supplies it (the server, in a match), and the default never rolls one. `swipe` is the flick
// after the radar ({ aim, power }, see above); without one the swipe counts as true.
export function resolvePutt(hole, lie, disc, shot, roll = 1, swipe = null) {
  const dist = distance(lie, hole.basket);
  const rise = riseTo(hole, lie);
  const dd = puttDist(hole, lie); // how hard it is: the hill counts
  let v = typeof shot === 'number' ? { x: shot, y: 0 } : { x: Number(shot?.x) || 0, y: Number(shot?.y) || 0 };
  const radius = puttRadius(dd, disc) * puttGrip(hole);
  const zone = puttZone(dd, disc);
  let why = null;
  if (swipe && dist > GIMME) {
    const sq = swipeQuality(dd, swipe);
    if (sq.q > 1) { // the swipe was off: it cannot go in, and the radar's miss is joined by the swipe's own
      v = { x: v.x + (sq.aimErr / sq.tol.aim) * radius, y: v.y + (sq.powErr / sq.tol.power) * radius };
      const m = Math.hypot(v.x, v.y);
      if (m < radius * 1.08) v = m ? { x: (v.x / m) * radius * 1.08, y: (v.y / m) * radius * 1.08 } : { x: radius * 1.08, y: 0 };
      why = sq.powN >= sq.aimN ? (sq.powErr < 0 ? 'weak' : 'strong') : (sq.aimErr > 0 ? 'right' : 'left');
    }
  }
  const off = Math.hypot(v.x, v.y);
  if (dist <= GIMME || off <= radius) {
    // dead center is a clean swish; nearer the edge it rattles the chains before it drops
    const gimme = dist <= GIMME && off > radius;
    return { kind: 'basket', made: true, gimme, finish: gimme ? 'tapin' : off <= radius * 0.55 ? 'swish' : 'rattle', strokes: 1, lie: hole.basket, dist, zone, radius, rise };
  }
  // a miss: a few feet from the basket, on the side the dot was: across is left or right, up is long, down is short
  const rim = off <= radius * 1.45; // just outside the target: it hits the cage and spits out
  const nasty = roll < nastyChance(dd, disc, rim) + (why === 'strong' ? 0.22 : 0) + clamp(-rise * 0.012, 0, 0.1) + (hole.weather?.rain ? 0.05 : 0); // downhill, or in the rain, a miss runs away more // a putt hit too hard runs away more
  let miss = clamp(2.5 + off * 10, 3, 14);
  if (nasty) miss = clamp((miss * 2.4 + 6) * (rise < -1 ? 1 + Math.min(0.5, -rise * 0.05) : 1), 14, 56); // and then it runs, farther downhill
  const hv = headingVec(headingTo(lie, hole.basket));
  const along = (v.y / off) * miss;
  const across = (v.x / off) * miss;
  const spot = {
    x: hole.basket.x + hv.ux * along + hv.rx * across,
    y: hole.basket.y + hv.uy * along + hv.ry * across,
  };
  const s = surfaceAt(hole, spot.x, spot.y);
  const wet = s === 'water' || s === 'oob';
  const lieAfter = wet ? { x: hole.basket.x - hv.ux * 3, y: hole.basket.y - hv.uy * 3 } : spot;
  // a nasty roll into the water costs a stroke on top of the putt
  return { kind: 'landed', made: false, finish: nasty ? 'nasty' : rim ? 'rim' : 'miss', rim, nasty, why, strokes: nasty && wet ? 2 : 1, lie: lieAfter, dist, zone, radius, miss, rise };
}

/* ---------- highlights ---------- */

// How good a throw was to watch, for the "throw of the match": an ace is the best, then a long putt going in, then a long pure drive.
// `move` is what a match records of a throw ({ kind, putt, made, gimme, feet, dist, ex }), or the same from a solo throw.
export function highlightScore(move) {
  if (!move || move.gimme) return 0;
  if (move.kind === 'basket' && !move.putt) return 1000 + (move.feet || 0);
  if (move.putt) return move.made ? 100 + (move.dist || 0) * 6 : move.nasty ? 20 : 0;
  if (move.kind === 'landed') return (move.feet || 0) * 0.5 + (move.ex?.pure ? 40 : 0);
  return 0;
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
  return { hole, lie: { x: hole.tee.x, y: hole.tee.y }, strokes: 0, throws: [], eaten: [], bearCame: false, done: false, holed: false };
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
