/* What a putt looks like. A putt is decided by the rules (made, rimmed out, missed, a nasty roll); this turns that into a short film:
   where the disc is at every millisecond, and the moments around it (chains and confetti when it drops, a slow lap of the rim
   when it does not, a long run away when it takes a nasty roll). Nothing here decides anything. Pure functions plus a drawing
   routine, so a test can walk a script frame by frame. Feet and milliseconds; x east, y north, h up. */

import { project, ZS, RING_H, TRAY_H } from './cam3d.js?v=7';

const RING_R = 1.45; // how far the top band is from the middle
const REST_H = TRAY_H - 0.12; // where a disc that has gone in sits: in the tray, about three feet up
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;

/**
 * The film of one putt.
 *   from: where it was thrown     basket: where it is going      lie: where a miss ends up
 *   result: { made, finish ('swish' | 'rattle' | 'tapin' | 'rim' | 'miss' | 'nasty'), rim, nasty, dist, miss }
 * Returns { total (ms the disc moves), tail (ms of reaction after), at(ms) -> { x, y, h, phase }, marks: { dropAt?, rimAt?, spitAt?, rollAt?, landAt } }.
 */
export function puttScript({ from, basket, lie, result }) {
  const { made, finish } = result;
  const dist = result.dist ?? Math.hypot(basket.x - from.x, basket.y - from.y);
  const back = { x: from.x - basket.x, y: from.y - basket.y };
  const bl = Math.hypot(back.x, back.y) || 1;
  const toward = { x: back.x / bl, y: back.y / bl }; // from the basket toward the thrower
  const flightMs = result.finish === 'tapin' ? 520 : clamp(650 + dist * 17, 900, 1700);
  const peak = 2.5 + dist * 0.15;
  const h0 = 3.2;
  const spot = (p, r, h) => ({ x: p.x, y: p.y, h, r });

  // where the first flight ends: on the rim, or the grass
  const nasty = !!result.nasty;
  const touchdown = nasty ? { x: lerp(basket.x, lie.x, 0.28), y: lerp(basket.y, lie.y, 0.28) } : lie;
  const rimSide = (toward.x * (lie.y - basket.y) - toward.y * (lie.x - basket.x)) >= 0 ? 1 : -1; // which way it circles
  const a0 = Math.atan2(toward.y, toward.x);
  const onRim = (a, r = RING_R) => ({ x: basket.x + Math.cos(a) * r, y: basket.y + Math.sin(a) * r });

  const segs = []; // [{ ms, phase, f(u) -> {x,y,h} }]
  const flightTo = (e, hEnd, phase = 'flight') => segs.push({ ms: flightMs, phase, f: (u) => ({ x: lerp(from.x, e.x, u), y: lerp(from.y, e.y, u), h: lerp(h0, hEnd, u) + peak * 4 * u * (1 - u) * (hEnd > 1 ? 1 : 1.2) }) });
  const marks = {};
  let t = 0;
  const mark = (name) => { marks[name] = t; };
  const push = (seg) => { segs.push(seg); };

  if (finish === 'tapin') {
    flightTo({ x: basket.x, y: basket.y }, 3.8);
    t += flightMs; mark('dropAt');
    push({ ms: 320, phase: 'drop', f: (u) => ({ x: basket.x, y: basket.y, h: lerp(3.8, REST_H, easeIn(u)) }) });
    t += 320;
  } else if (made && finish === 'swish') {
    flightTo({ x: basket.x, y: basket.y }, RING_H + 0.2);
    t += flightMs; mark('dropAt');
    push({ ms: 420, phase: 'drop', f: (u) => ({ x: basket.x, y: basket.y, h: lerp(RING_H, REST_H, easeIn(u)) + 0.25 * Math.sin(u * Math.PI * 2) * (1 - u) }) });
    t += 420;
  } else if (made) { // a rattle: it clips the cage, bounces round the rim, and drops
    const e = onRim(a0, RING_R * 0.9);
    flightTo(e, RING_H);
    t += flightMs; mark('rimAt');
    push({ ms: 420, phase: 'rattle', f: (u) => { const a = a0 + rimSide * easeOut(u) * TAU * 0.4; const r = lerp(RING_R * 0.9, 0.7, u); const q = onRim(a, r); return { ...q, h: RING_H - 0.9 * u + 0.5 * Math.sin(u * Math.PI * 3) * (1 - u) }; } });
    t += 420; mark('dropAt');
    push({ ms: 380, phase: 'drop', f: (u) => { const a = a0 + rimSide * TAU * 0.4; const q = onRim(a, 0.7); return { x: lerp(q.x, basket.x, u), y: lerp(q.y, basket.y, u), h: lerp(RING_H - 0.9, REST_H, easeIn(u)) }; } });
    t += 380;
  } else if (result.rim) { // a lap of the rim, and out
    const e = onRim(a0);
    flightTo(e, RING_H);
    t += flightMs; mark('rimAt');
    const lapMs = 1500;
    const turn = rimSide * TAU * 1.3;
    push({ ms: lapMs, phase: 'rim', f: (u) => { const q = onRim(a0 + turn * easeOut(u)); return { ...q, h: lerp(RING_H, 3.7, u) + 0.12 * Math.sin(u * Math.PI * 9) * (1 - u) }; } });
    t += lapMs; mark('spitAt');
    const exit = onRim(a0 + turn);
    push({ ms: 520, phase: 'spit', f: (u) => ({ x: lerp(exit.x, touchdown.x, u), y: lerp(exit.y, touchdown.y, u), h: lerp(3.7, 0, u) + 2.4 * 4 * u * (1 - u) }) });
    t += 520; mark('landAt');
  } else { // a miss: it lands, hops, and sits (or runs)
    flightTo(touchdown, 0);
    t += flightMs; mark('landAt');
    push({ ms: 380, phase: 'hop', f: (u) => ({ x: touchdown.x, y: touchdown.y, h: 1.3 * Math.abs(Math.sin(u * Math.PI * 2)) * (1 - u) }) });
    t += 380;
  }
  if (nasty) { // and then it runs
    const run = Math.hypot(lie.x - touchdown.x, lie.y - touchdown.y);
    const ms = clamp(run * 38, 800, 1900);
    mark('rollAt');
    push({ ms, phase: 'roll', f: (u) => ({ x: lerp(touchdown.x, lie.x, easeOut(u)), y: lerp(touchdown.y, lie.y, easeOut(u)), h: 0 }) });
    t += ms;
  }
  const total = t;
  const tail = made ? (finish === 'rattle' ? 1500 : finish === 'tapin' ? 500 : 1300) : result.rim ? 1900 : nasty ? 1500 : 800;
  const end = made ? { x: basket.x, y: basket.y, h: REST_H } : { x: lie.x, y: lie.y, h: 0 };

  return {
    total,
    tail,
    marks,
    finish,
    at(ms) {
      let left = clamp(ms, 0, total);
      for (const s of segs) {
        if (left <= s.ms) return { ...s.f(s.ms ? left / s.ms : 1), phase: s.phase };
        left -= s.ms;
      }
      return { ...end, phase: 'done' };
    },
  };
}

/* ---------- the reaction ---------- */

const rand = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const FONT = '"Anton", "Archivo Black", Impact, sans-serif';

function bigText(ctx, W, H, text, sub, { color, glow, y = 0.27, scale = 1, alpha = 1, dy = 0, shake = 0 }) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  const size = Math.min(W * 0.2, 104) * scale;
  const x = W / 2 + (shake ? (Math.random() - 0.5) * shake : 0);
  const yy = H * y + dy + (shake ? (Math.random() - 0.5) * shake : 0);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `400 ${size}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(4, size * 0.09);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.shadowColor = glow;
  ctx.shadowBlur = glow === 'transparent' ? 0 : size * 0.35;
  ctx.strokeText(text, x, yy);
  ctx.fillStyle = color;
  ctx.fillText(text, x, yy);
  if (sub) {
    ctx.shadowBlur = 0;
    ctx.font = `700 ${Math.max(11, size * 0.17)}px "Space Mono", monospace`;
    ctx.fillStyle = 'rgba(238,241,232,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(sub, x, yy + size * 0.62);
    ctx.fillText(sub, x, yy + size * 0.62);
  }
  ctx.restore();
}

// confetti thrown up from the basket: the same every time for the same moment
function confetti(ctx, px, py, e, n) {
  const life = 1800;
  if (e < 0 || e > life) return;
  const sec = e / 1000;
  const colors = ['#a3e635', '#eef1e8', '#d35400', '#f2c14e', '#7fd1e8'];
  for (let i = 0; i < n; i++) {
    const vx = (rand(i, 1) - 0.5) * 520;
    const vy = -(260 + rand(i, 2) * 520);
    const x = px + vx * sec + Math.sin(sec * 6 + i) * 8;
    const y = py + vy * sec + 0.5 * 980 * sec * sec;
    const a = 1 - clamp((e - life * 0.6) / (life * 0.4), 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    ctx.rotate(rand(i, 3) * TAU + sec * (3 + rand(i, 4) * 8));
    ctx.fillStyle = colors[i % colors.length];
    const w = 4 + rand(i, 5) * 6;
    ctx.fillRect(-w / 2, -w / 4, w, w / 2);
    ctx.restore();
  }
}

/**
 * Draw the reaction to a putt on top of the scene.
 *   scene: { cam, view, hole, W, H }   script: from puttScript   ms: time since the putt was thrown   result: the rules' answer
 * Returns the camera tweaks to use this frame: { fov, drop, pull }.
 */
export function drawPuttFx(ctx, scene, script, ms, result) {
  const { cam, view, hole, W, H } = scene;
  const m = script.marks;
  const ring = project(cam, view, hole.basket.x, hole.basket.y, RING_H);
  const camTweak = { fov: 0, drop: 0 };
  if (result.made && m.dropAt !== undefined) {
    const e = ms - m.dropAt;
    if (e >= 0) {
      const long = (result.dist || 0) > 30;
      if (ring) {
        // rings spreading from the cage
        for (const k of [0, 160]) {
          const u = clamp((e - k) / 700, 0, 1);
          if (u <= 0 || u >= 1) continue;
          ctx.strokeStyle = `rgba(190,255,90,${0.85 * (1 - u)})`;
          ctx.lineWidth = 5 * (1 - u) + 1;
          ctx.beginPath();
          ctx.ellipse(ring.x, ring.y, (10 + 150 * u) * Math.max(0.5, ring.s / 12), (4 + 60 * u) * Math.max(0.5, ring.s / 12), 0, 0, TAU);
          ctx.stroke();
        }
        confetti(ctx, ring.x, ring.y, e - 40, result.finish === 'tapin' ? 30 : long ? 110 : 70);
      }
      const flash = 0.42 * Math.max(0, 1 - e / 420);
      if (flash > 0) { ctx.fillStyle = `rgba(190,255,90,${flash})`; ctx.fillRect(0, 0, W, H); }
      if (result.finish !== 'tapin') {
        const pop = e < 300 ? 0.4 + 0.75 * easeOut(e / 300) : 1.15 - 0.15 * clamp((e - 300) / 200, 0, 1);
        const out = clamp(1 - (e - 1150) / 350, 0, 1);
        const word = result.finish === 'rattle' ? 'RATTLED IN!' : 'CHAINS!';
        bigText(ctx, W, H, word, long ? `FROM ${Math.round(result.dist)} FEET` : '', { color: '#c8ff5a', glow: 'rgba(163,230,53,0.95)', scale: pop, alpha: out });
      }
      camTweak.fov = -0.12 * easeOut(clamp(e / 500, 0, 1)) * clamp(1 - (e - 900) / 700, 0, 1); // a punch in
    }
  } else if (!result.made && (m.rimAt !== undefined || m.landAt !== undefined)) {
    const spit = m.spitAt !== undefined ? m.spitAt : m.landAt;
    if (m.rimAt !== undefined && ms >= m.rimAt && ms < spit) camTweak.fov = -0.1 * easeOut(clamp((ms - m.rimAt) / 700, 0, 1)); // it holds its breath
    const e = ms - (m.spitAt !== undefined ? m.spitAt : m.landAt);
    if (e >= 0) {
      const sad = result.rim ? clamp(e / 400, 0, 1) * clamp(1 - (e - 1300) / 700, 0, 1) : 0;
      if (sad > 0) { // a cold wash and a darkening at the edges
        ctx.fillStyle = `rgba(28,40,58,${0.36 * sad})`;
        ctx.fillRect(0, 0, W, H);
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${0.55 * sad})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      if (result.nasty) {
        const alpha = clamp(1 - (e - 1200) / 400, 0, 1) * clamp(e / 120, 0, 1);
        bigText(ctx, W, H, 'NASTY ROLL', 'it just kept going', { color: '#ff7a2b', glow: 'rgba(211,84,0,0.9)', alpha, shake: e < 500 ? 10 * (1 - e / 500) : 0 });
      } else if (result.rim) {
        const alpha = clamp(e / 200, 0, 1) * clamp(1 - (e - 1250) / 500, 0, 1);
        bigText(ctx, W, H, 'RIMMED OUT', 'so close', { color: '#a9bccb', glow: 'transparent', alpha, dy: easeIn(clamp(e / 1700, 0, 1)) * H * 0.08, scale: 0.95 });
      } else {
        const alpha = clamp(e / 150, 0, 1) * clamp(1 - (e - 550) / 350, 0, 1);
        const words = { weak: ['TOO SOFT', 'it died short'], strong: ['TOO HARD', 'it blew right past'], left: ['PULLED LEFT', 'off line'], right: ['PUSHED RIGHT', 'off line'] }[result.why];
        bigText(ctx, W, H, words ? words[0] : 'MISSED', words ? words[1] : '', { color: '#d8ddd2', glow: 'transparent', alpha: words ? clamp(e / 150, 0, 1) * clamp(1 - (e - 900) / 500, 0, 1) : alpha, scale: words ? 0.85 : 0.7 });
      }
    }
  }
  return camTweak;
}

export { RING_H, RING_R, REST_H, ZS };
