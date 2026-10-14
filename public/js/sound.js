/* The game's sound, all made in the browser (Web Audio): no files. Whooshes, thunks, splashes, the chains, the clank of a rim-out,
   a fanfare, and Marebear's cackle. Nothing here knows about the game: callers ask for a sound by name. Nothing plays until the
   player has touched the page (browsers insist), and a player can switch it off (remembered). */

let ctx = null;
let master = null;
let on = true;
try { on = localStorage.getItem('dj_sound') !== 'off'; } catch { /* on */ }

const rnd = (a, b) => a + Math.random() * (b - a);

function audio() {
  if (!on) return null;
  if (!ctx) {
    const AC = typeof window === 'undefined' ? null : window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor(); // so a pile-up of sounds never clips
      master.connect(comp);
      comp.connect(ctx.destination);
    } catch { ctx = null; return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export const isOn = () => on;
export function setOn(v) {
  on = !!v;
  try { localStorage.setItem('dj_sound', on ? 'on' : 'off'); } catch { /* not saved */ }
  if (on) audio();
}
// call from any tap or click: it is what lets the browser start the sound
export const unlock = () => { audio(); };

let noiseBuf = null;
function noise(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  return s;
}

// a gain envelope: up fast, down over `len`
function env(c, at, peak, len, attack = 0.005) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  return g;
}
function burst(c, at, { len = 0.2, peak = 0.4, type = 'bandpass', f0 = 1000, f1 = f0, q = 1 }) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + len);
  const g = env(c, at, peak, len);
  n.connect(f); f.connect(g); g.connect(master);
  n.start(at, Math.random());
  n.stop(at + len + 0.05);
}
function tone(c, at, { f0, f1 = f0, len = 0.2, peak = 0.3, type = 'sine', attack = 0.005 }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + len);
  const g = env(c, at, peak, len, attack);
  o.connect(g); g.connect(master);
  o.start(at);
  o.stop(at + len + 0.05);
}

// A "ha": a buzzy voice (a sawtooth) through two vowel filters, with a puff of breath. f is the pitch in hertz.
function ha(c, at, f, len, peak) {
  const o = c.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f * 1.12, at);
  o.frequency.exponentialRampToValueAtTime(f * 0.86, at + len);
  const vib = c.createOscillator(); // a wobble, so it sounds like a throat
  const vg = c.createGain();
  vib.frequency.value = rnd(6, 9);
  vg.gain.value = f * 0.03;
  vib.connect(vg); vg.connect(o.frequency);
  const g = env(c, at, peak, len, 0.012);
  for (const [fr, q, gain] of [[820, 5, 1], [1450, 6, 0.55], [2700, 8, 0.25]]) { // an open "ah"
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fr;
    bp.Q.value = q;
    const bg = c.createGain();
    bg.gain.value = gain;
    o.connect(bp); bp.connect(bg); bg.connect(g);
  }
  g.connect(master);
  o.start(at); vib.start(at);
  o.stop(at + len + 0.05); vib.stop(at + len + 0.05);
  burst(c, at, { len: len * 0.7, peak: peak * 0.25, type: 'highpass', f0: 3500, f1: 3500 });
}

const SOUNDS = {
  tap(c, t) { tone(c, t, { f0: 720, f1: 520, len: 0.07, peak: 0.12, type: 'triangle' }); },
  // a throw leaving the hand: a rush of air that rises and fades. `v` is how hard (0..1)
  throw(c, t, v = 0.6) {
    burst(c, t, { len: 0.7, peak: 0.25 + 0.2 * v, type: 'bandpass', f0: 500 + 600 * v, f1: 2600 + 1200 * v, q: 1.3 });
    burst(c, t + 0.05, { len: 0.9, peak: 0.1, type: 'lowpass', f0: 1500, f1: 300 });
  },
  land(c, t) { burst(c, t, { len: 0.16, peak: 0.35, type: 'lowpass', f0: 700, f1: 140 }); tone(c, t, { f0: 130, f1: 60, len: 0.14, peak: 0.25 }); },
  skip(c, t) { burst(c, t, { len: 0.05, peak: 0.2, type: 'lowpass', f0: 1200, f1: 400 }); },
  thunk(c, t) { tone(c, t, { f0: 150, f1: 55, len: 0.3, peak: 0.55 }); burst(c, t, { len: 0.12, peak: 0.4, type: 'lowpass', f0: 2200, f1: 300 }); },
  splash(c, t) {
    burst(c, t, { len: 0.55, peak: 0.5, type: 'bandpass', f0: 1800, f1: 350, q: 0.8 });
    burst(c, t + 0.12, { len: 0.5, peak: 0.25, type: 'highpass', f0: 3000, f1: 1500 });
    for (let i = 0; i < 4; i++) tone(c, t + 0.2 + i * 0.09, { f0: rnd(500, 900), f1: rnd(200, 350), len: 0.1, peak: 0.1 }); // drips
  },
  // chains: a lot of little bells and a hiss of steel
  chains(c, t, v = 1) {
    burst(c, t, { len: 0.5, peak: 0.28 * v, type: 'highpass', f0: 4500, f1: 3000 });
    for (let i = 0; i < 11; i++) tone(c, t + i * 0.022 + rnd(0, 0.02), { f0: rnd(2200, 5200), f1: rnd(1800, 3200), len: rnd(0.12, 0.3), peak: 0.1 * v, type: i % 3 ? 'triangle' : 'sine' });
    tone(c, t + 0.1, { f0: 330, f1: 280, len: 0.25, peak: 0.12 * v, type: 'triangle' }); // the basket itself
  },
  // the tray catching it
  clunk(c, t) { tone(c, t, { f0: 240, f1: 120, len: 0.18, peak: 0.3, type: 'triangle' }); burst(c, t, { len: 0.1, peak: 0.2, type: 'bandpass', f0: 1500, f1: 600 }); },
  // a rim-out: a clank, then a sad wobble
  clank(c, t) {
    for (const f of [610, 930, 1350]) tone(c, t, { f0: f, f1: f * 0.97, len: 0.35, peak: 0.16, type: 'square' });
    burst(c, t, { len: 0.06, peak: 0.3, type: 'highpass', f0: 3000, f1: 3000 });
    for (let i = 0; i < 4; i++) tone(c, t + 0.28 + i * 0.12, { f0: 520 - i * 40, f1: 480 - i * 40, len: 0.1, peak: 0.1 - i * 0.015, type: 'triangle' });
  },
  // the sad trombone, for a rim-out
  womp(c, t) { for (let i = 0; i < 4; i++) tone(c, t + i * 0.28, { f0: [233, 220, 208, 196][i], f1: [228, 214, 200, 150][i], len: i === 3 ? 0.7 : 0.26, peak: 0.16, type: 'sawtooth' }); },
  fanfare(c, t) {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => { tone(c, t + i * 0.11, { f0: f, f1: f, len: i === 6 ? 0.7 : 0.18, peak: 0.18, type: 'triangle' }); tone(c, t + i * 0.11, { f0: f * 2, f1: f * 2, len: i === 6 ? 0.5 : 0.12, peak: 0.05, type: 'sine' }); });
  },
  // a smaller good noise: a birdie, a pure throw
  ding(c, t) { tone(c, t, { f0: 1320, f1: 1320, len: 0.5, peak: 0.16, type: 'sine' }); tone(c, t + 0.09, { f0: 1760, f1: 1760, len: 0.6, peak: 0.12, type: 'sine' }); },
  // Marebear: a big cackle (a run of "ha"s that climbs, then rolls over into a wheeze)
  laugh(c, t) {
    const base = rnd(300, 340);
    let at = t;
    for (let i = 0; i < 8; i++) {
      const f = base * (1 + Math.min(i, 3) * 0.06) * (i > 5 ? 0.9 : 1);
      ha(c, at, f, 0.11 + (i > 5 ? 0.05 : 0), 0.22 - i * 0.012);
      at += 0.15 + (i > 5 ? 0.04 : 0);
    }
    // the wheeze at the end: one long gasp in
    tone(c, at + 0.05, { f0: 520, f1: 760, len: 0.35, peak: 0.07, type: 'sawtooth' });
    burst(c, at + 0.05, { len: 0.35, peak: 0.1, type: 'bandpass', f0: 2600, f1: 3400, q: 2 });
  },
  // a short, dry "heh": for the small digs
  snicker(c, t) { for (let i = 0; i < 3; i++) ha(c, t + i * 0.13, 360 - i * 14, 0.09, 0.17); },
  // a grudging "hmph": low and short, a throat noise with no joy in it
  hmph(c, t) { ha(c, t, 170, 0.22, 0.2); burst(c, t, { len: 0.18, peak: 0.1, type: 'bandpass', f0: 600, f1: 300, q: 2 }); },
  // a smoker's cough: two or three hard barks from the chest, each with a rasp
  cough(c, t) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const at = t + i * 0.19;
      ha(c, at, 130 - i * 8, 0.09, 0.26);
      burst(c, at, { len: 0.13, peak: 0.32, type: 'bandpass', f0: 900, f1: 380, q: 1.1 });
      tone(c, at, { f0: 110, f1: 70, len: 0.1, peak: 0.16, type: 'sawtooth' });
    }
    burst(c, t + n * 0.19 + 0.04, { len: 0.28, peak: 0.12, type: 'bandpass', f0: 2200, f1: 1200, q: 3 }); // and the rattle after
  },
  // a wheeze: a thin whistle on the way in and a rattle on the way out, twice
  wheeze(c, t) {
    for (let i = 0; i < 2; i++) {
      const at = t + i * 0.62;
      tone(c, at, { f0: 780, f1: 1040, len: 0.34, peak: 0.07, type: 'sawtooth', attack: 0.08 });
      burst(c, at, { len: 0.34, peak: 0.1, type: 'bandpass', f0: 2400, f1: 3200, q: 4 });
      tone(c, at + 0.34, { f0: 640, f1: 430, len: 0.26, peak: 0.07, type: 'sawtooth', attack: 0.04 });
      burst(c, at + 0.34, { len: 0.26, peak: 0.12, type: 'bandpass', f0: 1500, f1: 700, q: 2.5 });
    }
  },
  // hocking one up and spitting it: a throat scrape, then a wet "ptoo" and a splat
  spit(c, t) {
    burst(c, t, { len: 0.34, peak: 0.26, type: 'bandpass', f0: 600, f1: 1900, q: 4 });
    ha(c, t, 120, 0.3, 0.12);
    burst(c, t + 0.4, { len: 0.07, peak: 0.45, type: 'highpass', f0: 3200, f1: 2200 });
    tone(c, t + 0.4, { f0: 900, f1: 260, len: 0.08, peak: 0.2, type: 'triangle' });
    burst(c, t + 0.78, { len: 0.12, peak: 0.25, type: 'lowpass', f0: 1100, f1: 160 });
  },
  // her handbag snapping shut
  snap(c, t) { tone(c, t, { f0: 1800, f1: 900, len: 0.05, peak: 0.25, type: 'square' }); burst(c, t, { len: 0.06, peak: 0.25, type: 'highpass', f0: 2500, f1: 2500 }); },
};

// play a named sound (a no-op when the sound is off, or before the first touch, or for a name we do not have)
export function play(name, arg) {
  const c = audio();
  const f = SOUNDS[name];
  if (!c || !f) return;
  try { f(c, c.currentTime + 0.01, arg); } catch { /* a sound must never break the game */ }
}
export const NAMES = Object.keys(SOUNDS); // for tests

