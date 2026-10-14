/* The player: the ghost of a person who throws the disc in the 3D view. This is only the maths of the body (no drawing, no clock): given what kind
   of throw it is (backhand, forehand, putt), which hand, and how many milliseconds since the throw began, `poseAt` says where every joint is.
   The frame is the player's own, in feet: x to their right, y forward (toward the target), z up, the origin on the ground between the feet.
   The disc leaves the hand at `LEAD[kind]` milliseconds; the follow-through goes on for `FOLLOW` after that. Before 0 it is the stance. */

export const LEAD = { backhand: 560, forehand: 520, putt: 480 };
export const FOLLOW = 480;
export const kindFor = (putt, style) => (putt ? 'putt' : style === 'forehand' ? 'forehand' : 'backhand');

const UPPER = 1.05; // upper arm
const FORE = 1.3; // forearm and hand
const THIGH = 1.62;
const SHIN = 1.62;
const HALF_SHOULDER = 0.7;
const HALF_HIP = 0.38;
const TORSO = 1.85;
const DEG = Math.PI / 180;

const ease = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.max(0, Math.min(1, u));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Keyframes, for a right-hander. `t` is in units of the lead (1 is the release); the last is the end of the follow-through.
// twist: how far the shoulders are turned (degrees; plus is the right shoulder forward), lean: the torso forward, hip: [forward, height],
// hand: the throwing hand, off: the other hand, lf and rf: the left and right foot.
const KEYS = {
  backhand: [
    { t: 0, twist: -12, lean: 8, hip: [0, 2.85], hand: [0.4, 0.5, 3.65], off: [-0.4, 0.55, 3.55], lf: [-0.45, 0.15, 0], rf: [0.55, -0.3, 0] },
    { t: 0.48, twist: -62, lean: 4, hip: [-0.55, 2.8], hand: [1.3, -1.3, 3.85], off: [-0.95, 0.35, 3.9], lf: [-0.45, 0.35, 0], rf: [0.2, -0.9, 0] }, // the reach back
    { t: 0.82, twist: -18, lean: 10, hip: [0.25, 2.75], hand: [0.15, 0.5, 3.85], off: [-0.8, 0.2, 3.7], lf: [-0.5, 1.2, 0], rf: [0.35, -0.9, 0.05] }, // pulled in to the chest
    { t: 1, twist: 22, lean: 12, hip: [0.6, 2.7], hand: [1.35, 2.6, 3.95], off: [-1.0, -0.3, 3.5], lf: [-0.5, 1.4, 0], rf: [0.35, -0.7, 0.15] }, // the release, out front
    { t: 2, twist: 58, lean: 8, hip: [0.75, 2.8], hand: [-0.2, 2.0, 4.6], off: [-0.6, -0.3, 3.2], lf: [-0.5, 1.4, 0], rf: [0.3, 0.5, 0] }, // the follow-through, across
  ],
  forehand: [
    { t: 0, twist: 5, lean: 8, hip: [0, 2.85], hand: [0.55, 0.45, 3.1], off: [-0.35, 0.45, 3.2], lf: [-0.45, 0.15, 0], rf: [0.55, -0.3, 0] },
    { t: 0.5, twist: -30, lean: 4, hip: [-0.4, 2.8], hand: [1.35, -0.6, 3.2], off: [-0.9, 0.3, 3.8], lf: [-0.45, 0.4, 0], rf: [0.3, -0.7, 0] }, // cocked back, low
    { t: 0.82, twist: -5, lean: 9, hip: [0.2, 2.75], hand: [0.95, 0.5, 3.35], off: [-0.9, 0.1, 3.6], lf: [-0.5, 1.1, 0], rf: [0.35, -0.8, 0.05] },
    { t: 1, twist: 18, lean: 11, hip: [0.5, 2.7], hand: [1.3, 2.3, 3.55], off: [-1.0, -0.2, 3.4], lf: [-0.5, 1.3, 0], rf: [0.35, -0.6, 0.12] },
    { t: 2, twist: 40, lean: 8, hip: [0.65, 2.8], hand: [0.3, 1.9, 4.0], off: [-0.6, -0.2, 3.2], lf: [-0.5, 1.3, 0], rf: [0.3, 0.3, 0] },
  ],
  putt: [
    { t: 0, twist: 0, lean: 18, hip: [0, 2.45], hand: [0.3, 0.45, 2.9], off: [-0.3, 0.5, 2.85], lf: [-0.55, 0.05, 0], rf: [0.55, -0.05, 0] },
    { t: 0.55, twist: 0, lean: 18, hip: [-0.1, 2.45], hand: [0.3, 0.1, 2.85], off: [-0.3, 0.2, 2.8], lf: [-0.55, 0.05, 0], rf: [0.55, -0.05, 0] },
    { t: 0.85, twist: 2, lean: 21, hip: [0.1, 2.43], hand: [0.32, 1.0, 3.05], off: [-0.35, 0.65, 2.95], lf: [-0.55, 0.05, 0], rf: [0.55, -0.05, 0] },
    { t: 1, twist: 3, lean: 22, hip: [0.15, 2.42], hand: [0.33, 1.6, 3.2], off: [-0.4, 0.85, 3.0], lf: [-0.55, 0.05, 0], rf: [0.55, -0.05, 0] },
    { t: 2, twist: 4, lean: 24, hip: [0.2, 2.45], hand: [0.33, 2.0, 3.6], off: [-0.45, 0.9, 3.0], lf: [-0.55, 0.05, 0], rf: [0.55, -0.05, 0] },
  ],
};

// the keyframes at a moment, smoothly between the two either side
function frameAt(kind, ms) {
  const keys = KEYS[kind] || KEYS.backhand;
  const lead = LEAD[kind] || LEAD.backhand;
  const total = 1 + FOLLOW / lead;
  const u = ms <= 0 ? 0 : Math.min(total, ms / lead);
  const last = keys.at(-1);
  const tt = u <= 1 ? u : 1 + ((u - 1) / (total - 1)) * (last.t - 1); // the follow-through is the last key
  let i = 1;
  while (i < keys.length - 1 && keys[i].t < tt) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const f = ease(clamp01((tt - a.t) / (b.t - a.t || 1)));
  return {
    twist: lerp(a.twist, b.twist, f), lean: lerp(a.lean, b.lean, f), hip: [lerp(a.hip[0], b.hip[0], f), lerp(a.hip[1], b.hip[1], f)],
    hand: lerp3(a.hand, b.hand, f), off: lerp3(a.off, b.off, f), lf: lerp3(a.lf, b.lf, f), rf: lerp3(a.rf, b.rf, f),
  };
}

// two-bone limb: where the middle joint (elbow, knee) goes so that the ends meet at `to`, bending toward `pole`
function limb(from, to, l1, l2, pole) {
  const d0 = sub(to, from);
  const d = Math.min(len(d0), l1 + l2 - 0.01);
  const dir = unit(d0);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = sub(pole, mul(dir, dot(pole, dir)));
  const side = unit(len(p) < 1e-6 ? [0, 0, -1] : p);
  const mid = add(add(from, mul(dir, a)), mul(side, h));
  const end = add(from, mul(dir, d)); // (a target out of reach is reached as far as it goes)
  return { mid, end };
}

/**
 * Where everything is, `ms` after the throw began (negative: standing ready). `hand` is 'right' or 'left' (a left-hander is the mirror image).
 * Returns { joints: { head, neck, chest, hip, lsho, rsho, lelb, relb, lhand, rhand, lhip, rhip, lknee, rknee, lfoot, rfoot }, grip (the hand that throws:
 * 'rhand' or 'lhand'), held (the disc is still in the hand), release (where the disc leaves, in this frame), kind }.
 */
export function poseAt(kind, ms, hand = 'right') {
  const k = frameAt(kind, ms);
  const m = hand === 'left' ? -1 : 1;
  const fl = (p) => [p[0] * m, p[1], p[2]]; // mirror for a left-hander
  const twist = k.twist * m * DEG;
  const lean = k.lean * DEG;
  const hip = [0, k.hip[0], k.hip[1]];
  const chest = add(hip, [0, Math.sin(lean) * TORSO, Math.cos(lean) * TORSO]);
  const shoulderDir = [Math.cos(twist), Math.sin(twist), 0];
  const rsho = add(chest, add(mul(shoulderDir, HALF_SHOULDER), [0, 0, -0.1]));
  const lsho = add(chest, add(mul(shoulderDir, -HALF_SHOULDER), [0, 0, -0.1]));
  const neck = add(chest, [0, Math.sin(lean) * 0.3, Math.cos(lean) * 0.3]);
  const head = add(neck, [0, Math.sin(lean) * 0.3, 0.62]);
  const hipTwist = twist * 0.45;
  const hipDir = [Math.cos(hipTwist), Math.sin(hipTwist), 0];
  const rhip = add(hip, mul(hipDir, HALF_HIP));
  const lhip = add(hip, mul(hipDir, -HALF_HIP));
  // the throwing hand is the right in the keyframes (the left, mirrored, for a left-hander); the other one balances
  const throwing = fl(k.hand);
  const other = fl(k.off);
  const rTarget = m === 1 ? throwing : other;
  const lTarget = m === 1 ? other : throwing;
  const rarm = limb(rsho, rTarget, UPPER, FORE, [0.5, -0.2, -1]);
  const larm = limb(lsho, lTarget, UPPER, FORE, [-0.5, -0.2, -1]);
  const rfoot = fl(m === 1 ? k.rf : k.lf);
  const lfoot = fl(m === 1 ? k.lf : k.rf);
  const rleg = limb(rhip, rfoot, THIGH, SHIN, [0, 1, 0.2]);
  const lleg = limb(lhip, lfoot, THIGH, SHIN, [0, 1, 0.2]);
  const lead = LEAD[kind] || LEAD.backhand;
  const grip = m === 1 ? 'rhand' : 'lhand';
  const release = fl(KEYS[kind || 'backhand'].find((q) => q.t === 1).hand);
  return {
    kind,
    joints: { head, neck, chest, hip, lsho, rsho, lelb: larm.mid, relb: rarm.mid, lhand: larm.end, rhand: rarm.end, lhip, rhip, lknee: lleg.mid, rknee: rleg.mid, lfoot: lleg.end, rfoot: rleg.end },
    grip,
    held: ms < lead,
    release,
  };
}

// the hand's own place where the disc leaves, in the player's frame, and how high that is (feet)
export const releasePoint = (kind, hand = 'right') => poseAt(kind, LEAD[kind] || LEAD.backhand, hand).joints[hand === 'left' ? 'lhand' : 'rhand'];
