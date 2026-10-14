/* The maths of a swing or a swipe: how fast it went and how smooth it was. Pure (points in, numbers out), so it can be tested. A point is { x, y, t } (t in ms). */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// the fastest the pointer moved over a run of points (60+ ms each, so a jittery sampler does not make it look fast), in px per second
export function peakSpeed(pts, from = 0) {
  let best = 0;
  for (let i = from + 1; i < pts.length; i++) {
    let j = i - 1;
    while (j > from && pts[i].t - pts[j].t < 60) j--;
    const dt = pts[i].t - pts[j].t;
    if (dt >= 30) best = Math.max(best, (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) / dt) * 1000);
  }
  return best;
}

/** How smooth a whole gesture was (points from the press to the end; it goes down, then comes back up): wobble off a straight line, a speed that stutters
 * instead of rising and falling once, and a stall at the turn all make it rough. `hw` is how far off straight still counts as straight (px). Returns { rough (0..1), bias (which way it bowed), ... }. */
export function gestureQuality(pts, hw = 30) {
  if (!pts || pts.length < 6) return { rough: 0.2, bias: 1, wobble: 0, jitter: 0, dwell: 0, reason: null };
  let bi = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[bi].y) bi = i;
  const stroke = (a, b) => pts.slice(a, b + 1);
  const lateral = (seg) => { // deviation of each point from the straight line between the stroke's ends: rms, and the average sign
    if (seg.length < 3) return { rms: 0, bias: 0 };
    const p0 = seg[0];
    const p1 = seg.at(-1);
    const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    let sq = 0;
    let sum = 0;
    for (const q of seg) { const dev = ((p1.x - p0.x) * (p0.y - q.y) - (p0.x - q.x) * (p1.y - p0.y)) / chord; sq += dev * dev; sum += dev; }
    return { rms: Math.sqrt(sq / seg.length), bias: sum / seg.length };
  };
  // the speed of a stroke at its samples (over 40+ ms), lightly smoothed; how much it goes up and down beyond one rise and one fall
  const jitterOf = (seg) => {
    const v = [];
    for (let i = 1; i < seg.length; i++) {
      let j = i - 1;
      while (j > 0 && seg[i].t - seg[j].t < 40) j--;
      const dt = seg[i].t - seg[j].t;
      if (dt > 0) v.push((Math.hypot(seg[i].x - seg[j].x, seg[i].y - seg[j].y) / dt) * 1000);
    }
    if (v.length < 5) return 0;
    const sm = v.map((_, i) => (v[Math.max(0, i - 1)] + v[i] + v[Math.min(v.length - 1, i + 1)]) / 3);
    const peak = Math.max(...sm) || 1;
    let tv = 0;
    for (let i = 1; i < sm.length; i++) tv += Math.abs(sm[i] - sm[i - 1]);
    return Math.max(0, tv / (2 * peak) - 1);
  };
  const back = stroke(0, bi);
  const fwd = stroke(bi, pts.length - 1);
  const lf = lateral(fwd);
  const lb = lateral(back);
  const wobble = Math.max(lf.rms, lb.rms * 0.7) / hw;
  const jf = jitterOf(fwd);
  const jb = jitterOf(back);
  // a stall at the turn: the time spent nearly still around the bottom
  let dwell = 0;
  for (let i = Math.max(1, bi - 8); i < Math.min(pts.length, bi + 9); i++) {
    const dt = pts[i].t - pts[i - 1].t;
    const sp = (Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / Math.max(1, dt)) * 1000;
    if (sp < 60) dwell += dt;
  }
  // each part is free up to what a normal hand does (a trackpad or a mouse wanders a little and pauses a little), then costs
  const parts = {
    wobble: 0.5 * clamp((wobble - 0.45) / 0.9, 0, 1),
    stutter: 0.45 * clamp((jf - 0.3) / 0.7, 0, 1) + 0.1 * clamp((jb - 0.4) / 0.9, 0, 1),
    stall: 0.3 * clamp((dwell - 170) / 350, 0, 1),
  };
  const rough = clamp(parts.wobble + parts.stutter + parts.stall, 0, 1);
  const worst = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  return { rough, bias: lf.bias >= 0 ? 1 : -1, wobble, jitter: jf, dwell, reason: rough > 0.12 ? worst[0] : null };
}
