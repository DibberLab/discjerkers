/* The flight model: how far a disc goes and how it bends, from its numbers and how it is thrown.
   Shared by the flight guide and the game, so a throw means the same thing in both. Not physics: a way to compare
   discs. Distances are feet. `t` is a throw: { hand, style, mph, spin, angle } (angle is a step on ANGLE_DEG; the game
   can add `angleExtra` degrees for a sloppy release). `wind` is { mph, head, cross }: head > 0 is into your face,
   cross > 0 pushes the disc to the right. */

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Arm speed is release speed in mph, in 2 mph steps. Spin is release rpm. Both match what a Tech Disc reports.
export const MPH = { min: 30, max: 90, step: 2 };
export const SPIN = { min: 400, max: 1600, step: 50 };
export const RPM_PER_MPH = 15; // a typical throw spins about this many rpm for every mph it leaves the hand at

// mph -> cap (the disc speed that arm can get fully up to speed) and power (the distance the arm adds on top);
// a straight line between these points. Below 30 mph only the game goes (finesse throws, approaches).
export const ARM_ANCHORS = [[10, 1.5, 0.12], [16, 2.5, 0.28], [20, 3, 0.4], [30, 4, 0.62], [40, 6, 0.74], [48, 8, 0.87], [56, 10, 1], [62, 11.5, 1.05], [70, 13, 1.1], [78, 15, 1.14], [90, 15, 1.16]];
export function armAt(mph) {
  const pts = ARM_ANCHORS;
  if (mph <= pts[0][0]) return { cap: pts[0][1], power: pts[0][2] };
  for (let i = 1; i < pts.length; i++) {
    if (mph === pts[i][0]) return { cap: pts[i][1], power: pts[i][2] };
    if (mph < pts[i][0]) {
      const [m0, c0, p0] = pts[i - 1];
      const [m1, c1, p1] = pts[i];
      const f = (mph - m0) / (m1 - m0);
      return { cap: c0 + (c1 - c0) * f, power: p0 + (p1 - p0) * f };
    }
  }
  const last = pts.at(-1);
  return { cap: last[1], power: last[2] };
}
export const TIERS = [[44, 'Beginner'], [52, 'Beginner Plus'], [59, 'Intermediate'], [66, 'Intermediate Plus'], [74, 'Advanced'], [Infinity, 'Pro']];
export const tierName = (mph) => TIERS.find(([max]) => mph < max)[1];
export const typicalSpin = (mph) => Math.round((mph * RPM_PER_MPH) / SPIN.step) * SPIN.step;
export const spinOf = (t) => (t.spin == null ? typicalSpin(t.mph) : t.spin);

// RHBH and LHFH spin clockwise (fade finishes left); LHBH and RHFH spin counter-clockwise (fade finishes right)
export const spinsClockwise = (t) => (t.hand === 'right') === (t.style === 'backhand');

// Release angle. Hyzer tips the disc onto its fade side, anhyzer onto its turn side. `angle` walks this ladder
// either way: the last two rungs are the extreme throws.
export const ANGLE_DEG = [0, 5, 10, 15, 20, 35, 55];
export const ANGLE_MAX = ANGLE_DEG.length - 1;
export const angleDeg = (t) => Math.sign(t.angle) * ANGLE_DEG[Math.abs(t.angle)] + (t.angleExtra || 0);
export function angleName(t) {
  const a = angleDeg(t);
  if (!a) return 'Flat';
  const hyzer = a > 0;
  const big = Math.abs(a);
  if (big === 55) return hyzer ? 'Spike hyzer' : 'Over anhyzer';
  if (big === 35) return hyzer ? 'Hard hyzer' : 'Hard anhyzer';
  return `${hyzer ? 'Hyzer' : 'Anhyzer'} ${big}°`;
}

// How this arm, this spin and this disc get along. A disc faster than the arm can power never gets up to speed: it
// carries less and fades early. A slow disc on a strong arm is overpowered: it turns over more. Spin past what
// the throw would normally have steadies the disc (less turn and fade, a touch farther); less lets it wobble.
export function armEffects(d, t) {
  const a = armAt(t.mph);
  const ratio = Math.min(1, a.cap / d.speed);
  const over = clamp(a.cap / d.speed, 1, 2);
  const q = t.spin == null ? 1 : clamp(t.spin / (RPM_PER_MPH * t.mph), 0.5, 1.7);
  const steady = q ** -0.7;
  return {
    ratio,
    cap: a.cap,
    power: a.power,
    carry: clamp(0.82 + 0.18 * q, 0.85, 1.07),
    turn: (0.4 + 0.6 * ratio) * (1 + (over - 1) * 0.25) * steady,
    fade: (1 + (1 - ratio) * 1.5) * (1 - (over - 1) * 0.15) * steady,
  };
}

export const estFeet = (d, t) => {
  const { ratio, cap, power, carry } = armEffects(d, t);
  return Math.round(((140 + Math.min(d.speed, cap) * 16 + d.glide * 6) * power * (0.85 + 0.15 * ratio) * carry) / 10) * 10;
};

// Headwind costs more than a tailwind gives back. The guide rounds this to 10 ft and keeps it between 60 ft and
// the edge of its chart; the game uses the raw number.
export function carryRaw(d, wind, t) {
  const factor = wind.head >= 0 ? 1 - 0.011 * wind.head : 1 + 0.007 * -wind.head;
  const a = angleDeg(t);
  // hyzer shortens a throw (and a spike dives); a little anhyzer rides flat for more, but past that it falls out of the sky
  const tilt = a >= 0 ? 1 - 0.004 * a - 0.00004 * a * a : 1 + 0.0025 * Math.min(-a, 20) - 0.006 * Math.max(0, -a - 20);
  return estFeet(d, t) * factor * tilt;
}
export const carryFeet = (d, wind, t, gridFt = 500) => clamp(Math.round(carryRaw(d, wind, t) / 10) * 10, 60, gridFt - 10);

const GUIDE_PX_PER_FT = 0.74; // the release-angle aim was tuned in the guide's chart pixels at this scale

// The line a throw bends along, as sideways offsets (feet, right is positive) from the straight line at 32%, 72% and
// 100% of the way. A guide for drawing a smooth curve through them.
export function flightCurve(d, wind, t, feet = carryRaw(d, wind, t)) {
  const dir = spinsClockwise(t) ? 1 : -1; // counter-clockwise spin mirrors the disc's own turn and fade (not the wind)
  // a headwind makes any disc act more overstable; a tailwind makes it act more understable
  const arm = armEffects(d, t);
  const a = angleDeg(t);
  // hyzer holds the line (less turn, harder fade); anhyzer lets it turn and softens the fade
  const turnMul = clamp((1 - 0.04 * wind.head) * arm.turn * clamp(1 - 0.03 * a, 0.25, 1.7), 0.15, 2.4);
  const fadeMul = clamp((1 + 0.04 * wind.head) * arm.fade * clamp(1 + 0.025 * a, 0.3, 1.6), 0.2, 2.6);
  const turn = -d.turn * turnMul * 33 * dir;
  const fade = -Math.max(0, d.fade) * fadeMul * 28 * dir;
  // crosswind pushes the disc downwind for as long as it hangs in the air, so the push builds toward the end
  const drift = wind.cross * 3.2 * (feet / 300);
  // The release angle bends the line. Anhyzer starts toward the turn side and comes back (so its push is up front).
  // Hyzer starts near the line and bends toward the fade side more and more as the disc slows (so its push is at the end).
  const aim = (-dir * Math.sign(a) * (Math.abs(a) * 0.9 + 0.012 * a * a)) / GUIDE_PX_PER_FT; // extreme angles aim harder than they look
  const [w1, w2, w3] = a > 0 ? [0.04, 0.4, 0.85] : [1, 0.8, 0.3];
  return {
    feet,
    dir,
    lat: [drift * 0.1 + aim * w1, turn + drift * 0.45 + aim * w2, turn * 0.85 + fade + drift + aim * w3],
  };
}
