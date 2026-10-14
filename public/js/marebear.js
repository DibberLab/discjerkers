/* Marebear, drawn: a big, loud, older woman in a leopard-print blouse and a lot of make-up, a bouffant of lavender hair and gold
   everywhere. She is the game's heckler. She pops up from the bottom of the screen and cackles at a bad throw, like the dog in Duck
   Hunt, and sulks when you do something good. Everything is drawn with canvas paths; nothing is a picture.
   Units are about pixels at scale 1: the waist is at the origin, she is about 210 tall with her hair. */

const TAU = Math.PI * 2;

/**
 * Draw her. (x, y) is her waist; s the size. Poses and parts (all optional):
 *   mood:  'laugh' (head back, eyes squeezed shut, mouth wide, shaking, pointing) | 'grudge' (arms crossed, one eyebrow up, a flat mouth) |
 *          'sly' (a smirk with a raised brow) | 'wave'
 *   t:     time in ms, for the shaking and the blinking
 *   mouth: 0..1 how wide the mouth is (the laugh sets its own)
 *   facing: 1 or -1 (which way she looks)
 *   full:  draw her legs and skirt too (she is only shown from the waist up when she pops out of the bottom of the screen)
 *   purse: 0..1 how open her handbag is (0 closed), or -1 for none
 *   walk:  0..1 phase of a waddle, for her walking on
 *   act:   'cough' (a fist to her mouth, shaking) | 'wheeze' (a hand on her chest, heaving) | 'spit' (hocks one up and lets it fly) | 'strap'
 *          (yanks up a bra strap, with a snap), played over the first 1.2 s or so of `t` (see `actOf`)
 */
export function drawMarebear(c, x, y, s, o = {}) {
  const { mood = 'laugh', t = 0, facing = 1, full = false, purse = -1, walk = 0, act = null } = o;
  const laugh = mood === 'laugh';
  const shake = laugh ? Math.sin(t / 38) : 0;
  const acting = act && t > 180 && t < 1500; // the business she does before (or in the middle of) the words
  const au = acting ? (t - 180) / 1320 : 0; // 0..1 through it
  const bob = laugh ? shake * 2.6 : acting && act === 'wheeze' ? Math.sin(t / 150) * 3.2 : acting && act === 'cough' ? Math.sin(t / 40) * 3 : Math.sin(t / 420) * 1.2 + (full ? Math.abs(Math.sin(walk * Math.PI * 2)) * -4 : 0);
  const mouth = o.mouth ?? (acting && act === 'cough' ? 0.55 : acting && act === 'spit' ? (au > 0.45 ? 0.25 : 0.7) : acting && act === 'wheeze' ? 0.4 : laugh ? 0.55 + 0.45 * Math.abs(Math.sin(t / 55)) : mood === 'sly' ? 0.12 : 0);
  c.save();
  c.translate(x, y + bob * s);
  c.scale(s * facing, s);
  const fill = (color, fn) => { c.beginPath(); fn(); c.fillStyle = color; c.fill(); };
  const line = (color, w, fn) => { c.beginPath(); fn(); c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); };
  const SKIN = '#f2c3a2';
  const SKIN_D = '#d99d7a';
  const LEO = '#d89a4a';

  if (full) { // legs, skirt and heels
    const sw = Math.sin(walk * Math.PI * 2) * 7;
    fill('rgba(0,0,0,0.3)', () => c.ellipse(0, 112, 54, 9, 0, 0, TAU));
    for (const side of [-1, 1]) {
      const lx = side * 17 + (side > 0 ? sw : -sw) * 0.6;
      fill(SKIN_D, () => c.roundRect(lx - 9, 52, 18, 52, 8));
      fill('#2a1020', () => c.moveTo(lx - 10, 102) || c.lineTo(lx + 11, 102) || c.lineTo(lx + 17, 112) || c.lineTo(lx - 10, 112)); // a heel
      fill('#2a1020', () => c.rect(lx + 9, 104, 4, 9));
    }
    fill('#1a1a2e', () => { c.moveTo(-46, 16); c.lineTo(46, 16); c.lineTo(58, 68); c.lineTo(-58, 68); c.closePath(); }); // a pencil skirt, tight at the hips
    fill('rgba(255,255,255,0.06)', () => c.ellipse(-16, 40, 7, 20, 0, 0, TAU));
  }

  // the handbag: a big leopard bag on her arm (behind the body when closed)
  const bag = (bx, by, open) => {
    fill('#8a5a22', () => c.roundRect(bx - 22, by, 44, 34, 8));
    fill('#c88a3a', () => c.roundRect(bx - 20, by + 3, 40, 28, 6));
    for (let i = 0; i < 7; i++) fill('#3a2410', () => c.ellipse(bx - 14 + (i % 4) * 9 + (i > 3 ? 4 : 0), by + 9 + Math.floor(i / 4) * 12, 3.4, 2.2, i, 0, TAU));
    line('#e3b43c', 3, () => { c.moveTo(bx - 12, by); c.quadraticCurveTo(bx, by - 26 - open * 6, bx + 12, by); }); // the handle
    fill('#e3b43c', () => c.arc(bx, by + 4, 3.4, 0, TAU)); // the clasp
    if (open > 0) fill('#1d0d06', () => c.ellipse(bx, by + 1, 20, 4 + open * 6, 0, 0, TAU));
  };

  // torso: a wide, soft shape in a leopard blouse
  fill(LEO, () => c.ellipse(0, -22, 66, 58, 0, 0, TAU));
  fill('rgba(0,0,0,0.12)', () => c.ellipse(0, -2, 62, 40, 0, 0, Math.PI));
  for (let i = 0; i < 26; i++) { // the spots
    const a = i * 2.4;
    const r = 18 + ((i * 37) % 44);
    const sx = Math.cos(a) * r * 1.2;
    const sy = -22 + Math.sin(a) * r * 0.85;
    c.save();
    c.translate(sx, sy);
    c.rotate(a);
    fill('#3a2410', () => c.ellipse(0, 0, 5.5, 3.2, 0, Math.PI * 0.15, Math.PI * 1.85));
    fill('#241408', () => c.ellipse(1, 0, 2.2, 1.4, 0, 0, TAU));
    c.restore();
  }
  // the V of the neck, her chest and necklaces
  fill(SKIN, () => { c.moveTo(-24, -64); c.lineTo(24, -64); c.lineTo(0, -22); c.closePath(); });
  fill('rgba(180,110,80,0.35)', () => c.ellipse(0, -36, 7, 9, 0, 0, TAU)); // the shadow in the middle
  line('#f4ecd8', 3.4, () => { c.moveTo(-26, -64); c.quadraticCurveTo(0, -30, 26, -64); }); // a rope of pearls
  for (let i = 0; i <= 10; i++) { const u = i / 10; fill('#fffdf4', () => c.arc(-26 + 52 * u, -64 + 34 * Math.sin(u * Math.PI) * 0.9, 3.2, 0, TAU)); }
  line('#e3b43c', 2, () => { c.moveTo(-18, -66); c.quadraticCurveTo(0, -46, 18, -66); }); // and a gold chain
  fill('#e3b43c', () => c.arc(0, -52, 4.5, 0, TAU));
  fill('#c4122a', () => c.arc(0, -52, 2.3, 0, TAU)); // a ruby

  // arms
  const arm = (side, kind) => {
    const sx = side * 62;
    if (kind === 'point') { // out toward the player, one long red nail wagging
      const wag = Math.sin(t / 90) * 4;
      fill(LEO, () => c.ellipse(sx, -26, 17, 28, side * 0.35, 0, TAU));
      line(SKIN, 17, () => { c.moveTo(sx + side * 6, -26); c.lineTo(sx + side * 38, -66 + wag); });
      line('#e3b43c', 4, () => { c.moveTo(sx + side * 20, -48 + wag * 0.5); c.lineTo(sx + side * 26, -54 + wag * 0.6); }); // a bangle
      line(SKIN, 7, () => { c.moveTo(sx + side * 38, -66 + wag); c.lineTo(sx + side * 52, -100 + wag * 1.6); }); // the finger
      line('#c4122a', 5, () => { c.moveTo(sx + side * 50, -95 + wag * 1.5); c.lineTo(sx + side * 53, -103 + wag * 1.6); });
    } else if (kind === 'belly') { // a hand on her belly, shaking
      fill(LEO, () => c.ellipse(sx, -18, 17, 30, side * 0.2, 0, TAU));
      line(SKIN, 15, () => { c.moveTo(sx - side * 4, 6); c.lineTo(side * 24, 14); });
      fill(SKIN, () => c.arc(side * 20, 14, 10, 0, TAU));
      line('#e3b43c', 4, () => { c.moveTo(sx - side * 8, 2); c.lineTo(sx - side * 14, 6); });
    } else if (kind === 'cross') { // folded over her chest
      fill(LEO, () => c.ellipse(sx, -22, 17, 28, side * 0.15, 0, TAU));
      line(SKIN, 15, () => { c.moveTo(sx - side * 2, 2); c.lineTo(-side * 22, -22 - side * 3); });
      fill(SKIN, () => c.arc(-side * 26, -23 - side * 3, 9, 0, TAU));
      line('#c4122a', 3, () => { c.moveTo(-side * 31, -26 - side * 3); c.lineTo(-side * 36, -29 - side * 3); });
      line('#e3b43c', 4, () => { c.moveTo(sx - side * 4, -2); c.lineTo(sx - side * 12, -4); });
    } else { // hanging, with the bag
      fill(LEO, () => c.ellipse(sx, -22, 17, 30, side * 0.12, 0, TAU));
      line(SKIN, 14, () => { c.moveTo(sx + side * 2, -2); c.lineTo(sx + side * 6, 36); });
      fill(SKIN, () => c.arc(sx + side * 6, 40, 9, 0, TAU));
      line('#e3b43c', 4, () => { c.moveTo(sx + side * 1, 20); c.lineTo(sx + side * 9, 22); });
    }
  };
  if (laugh) { arm(-1, 'belly'); arm(1, 'point'); } else if (mood === 'grudge') { arm(-1, 'cross'); arm(1, 'cross'); } else { arm(-1, 'hang'); arm(1, 'hang'); }
  if (purse >= 0) bag(facing > 0 ? 64 : -64, 20, purse);

  /* the head */
  c.save();
  c.translate(0, -92);
  const tilt = laugh ? -0.1 + shake * 0.025 : mood === 'grudge' ? 0.06 : mood === 'sly' ? -0.05 : Math.sin(t / 700) * 0.02;
  c.rotate(tilt);
  // the hair, a lavender bouffant: a cloud of curls behind and above the face
  fill('#a994e0', () => c.ellipse(0, -48, 56, 46, 0, 0, TAU));
  for (let i = 0; i < 12; i++) { const a = Math.PI + (i / 11) * Math.PI; fill(i % 2 ? '#b9a7ec' : '#9e88d8', () => c.arc(Math.cos(a) * 50, -30 + Math.sin(a) * 52, 14 + (i % 3) * 2, 0, TAU)); }
  fill('#b9a7ec', () => c.ellipse(0, -62, 34, 24, 0, 0, TAU));
  fill('rgba(255,255,255,0.22)', () => c.ellipse(-16, -70, 14, 7, -0.5, 0, TAU)); // hairspray shine
  // a neck, and the face
  fill(SKIN_D, () => c.roundRect(-16, 20, 32, 20, 8));
  fill(SKIN, () => c.ellipse(0, 0, 36, 38, 0, 0, TAU));
  fill('rgba(150,90,60,0.18)', () => c.ellipse(0, 31, 24, 7, 0, 0, Math.PI)); // a soft chin
  // her curls in front, over the forehead
  for (let i = 0; i < 6; i++) { const u = (i - 2.5) * 12; fill(i % 2 ? '#b9a7ec' : '#a994e0', () => c.arc(u, -33 + Math.abs(u) * 0.12, 11, 0, TAU)); }
  fill('#e8c84a', () => c.arc(30, -42, 4.2, 0, TAU)); // a rhinestone clip
  fill('#fff', () => c.arc(31, -43, 1.4, 0, TAU));
  // earrings: big gold hoops
  for (const side of [-1, 1]) { line('#e3b43c', 3.4, () => c.arc(side * 36, 14, 8, 0, TAU)); fill('#e3b43c', () => c.arc(side * 36, 6, 2.6, 0, TAU)); }
  // cheeks, loud
  fill('rgba(255,70,130,0.6)', () => c.ellipse(-22, 12, 11, 8, 0, 0, TAU));
  fill('rgba(255,70,130,0.6)', () => c.ellipse(22, 12, 11, 8, 0, 0, TAU));
  // eyes
  const eye = (side) => {
    const ex = side * 16;
    const ey = -6;
    if (laugh || (o.eyes === 'shut')) { // squeezed shut and crying with laughing: a pair of arches, with eyeshadow and lashes
      fill('rgba(36,170,230,0.9)', () => c.ellipse(ex, ey - 4, 15, 8, 0, 0, TAU));
      line('#1a0a14', 3, () => c.arc(ex, ey + 2, 9, Math.PI * 1.08, Math.PI * 1.92));
      for (let k = 0; k < 4; k++) line('#1a0a14', 1.8, () => { const a = Math.PI * (1.18 + k * 0.2); c.moveTo(ex + Math.cos(a) * 9, ey + 2 + Math.sin(a) * 9); c.lineTo(ex + Math.cos(a) * 14, ey + 2 + Math.sin(a) * 14); });
      if (Math.sin(t / 150 + side) > 0.2) fill('rgba(150,210,255,0.9)', () => c.ellipse(ex + side * 5, ey + 12 + ((t / 8) % 14), 2.2, 3.4, 0, 0, TAU)); // a tear
    } else {
      const lid = mood === 'grudge' ? 0.55 : mood === 'sly' ? 0.35 : 0;
      fill('rgba(36,170,230,0.92)', () => c.ellipse(ex, ey - 6, 16, 10 + lid * 4, 0, 0, TAU)); // electric blue shadow up to the brow
      fill('#fff', () => c.ellipse(ex, ey, 10, 7 * (1 - lid), 0, 0, TAU));
      fill('#2b6e5a', () => c.arc(ex + (mood === 'grudge' ? side * 0 + 3 : 0), ey, 4.6, 0, TAU));
      fill('#080408', () => c.arc(ex + (mood === 'grudge' ? 3 : 0), ey, 2.2, 0, TAU));
      line('#1a0a14', 2.6, () => { c.moveTo(ex - 11, ey - 1); c.quadraticCurveTo(ex, ey - 9 * (1 - lid * 0.6), ex + 11, ey - 1); }); // liner
      line('#1a0a14', 2.2, () => { c.moveTo(ex + side * 11, ey - 1); c.lineTo(ex + side * 17, ey - 6); }); // a wing
      for (let k = 0; k < 4; k++) line('#1a0a14', 1.7, () => { const u = (k - 1.5) / 3; c.moveTo(ex + u * 18, ey - 6); c.lineTo(ex + u * 22 + side * 1.5, ey - 12); }); // lashes
      if (lid) fill(SKIN, () => c.ellipse(ex, ey - 4 - (1 - lid) * 2, 11, 5 * lid + 1, 0, Math.PI, TAU)); // a heavy lid
    }
    // eyebrows: drawn on, very high and very arched
    const lift = mood === 'sly' && side > 0 ? -7 : mood === 'grudge' && side > 0 ? -6 : laugh ? -4 : 0;
    line('#3a1a12', 2.6, () => { c.moveTo(ex - 12, ey - 15 + lift * 0.4); c.quadraticCurveTo(ex + side * 2, ey - 28 + lift, ex + 13, ey - 16 + lift * 0.5); });
  };
  eye(-1); eye(1);
  // the nose, and the beauty mark
  line('rgba(150,90,60,0.5)', 2, () => { c.moveTo(-3, 6); c.quadraticCurveTo(0, 14, 5, 12); });
  fill('#3a1a12', () => c.arc(15, 22, 1.7, 0, TAU));
  // the mouth: red, red lipstick
  const my = 22;
  if (mouth > 0.2) {
    const w = 15 + mouth * 6;
    const hgt = 4 + mouth * 17;
    fill('#5a0814', () => c.ellipse(0, my + hgt * 0.35, w, hgt, 0, 0, TAU));
    fill('#fffaf0', () => c.ellipse(0, my + 1, w - 2, 3.6, 0, 0, Math.PI)); // teeth
    fill('#f06a7c', () => c.ellipse(0, my + hgt * 0.7, w * 0.55, hgt * 0.35, 0, 0, Math.PI)); // her tongue
    line('#d4122a', 4.4, () => c.ellipse(0, my + hgt * 0.35, w + 1, hgt + 1, 0, 0, TAU));
    line('rgba(212,18,42,0.8)', 2, () => { c.moveTo(w + 2, my); c.lineTo(w + 6, my - 5); }); // a lipstick smear at the corner
  } else if (mood === 'grudge') { // a lipsticked line, pushed to one side
    line('#d4122a', 6, () => { c.moveTo(-12, my + 2); c.quadraticCurveTo(0, my - 2, 13, my + 4); });
  } else { // a smirk
    line('#d4122a', 6, () => { c.moveTo(-13, my + 1); c.quadraticCurveTo(2, my + 9, 15, my - 3); });
  }
  // a hair-clip sparkle, and a glint on the make-up
  if (Math.sin(t / 260) > 0.75) { line('#fff', 1.6, () => { c.moveTo(30, -50); c.lineTo(30, -36); c.moveTo(23, -43); c.lineTo(37, -43); }); }
  c.restore();
  if (acting) { // the business: a hand where the thing is happening, drawn over everything
    const hand = (hx, hy, sw) => { // a forearm from her side to the hand, and a fist with red nails
      line(SKIN, 15, () => { c.moveTo(52, -20); c.lineTo(hx, hy); });
      line('#e3b43c', 4, () => { c.moveTo(52 + (hx - 52) * 0.3, -20 + (hy + 20) * 0.3); c.lineTo(52 + (hx - 52) * 0.3 - 5, -20 + (hy + 20) * 0.3 + 4); }); // a bangle
      fill(SKIN, () => c.arc(hx, hy, sw, 0, TAU));
      for (let k = 0; k < 4; k++) fill('#c4122a', () => c.arc(hx - 5 + k * 3.6, hy - sw + 2, 1.9, 0, TAU));
    };
    if (act === 'cough') hand(10 + Math.sin(t / 40) * 2, -66 + Math.sin(t / 40) * 2, 11);
    else if (act === 'wheeze') hand(8, -40 + Math.sin(t / 150) * 3, 12);
    else if (act === 'strap') {
      const tug = Math.sin(clamp01(au * 2.2) * Math.PI); // out, then it snaps back
      const mx = 47 + tug * 4;
      const my = -52 - tug * 22; // where she pinches it
      line('#f08aa8', 7, () => { c.moveTo(25, -64); c.quadraticCurveTo(mx, my, 62, -32); }); // the pink bra strap, over her shoulder and down her arm
      line('#fbc3d3', 2.2, () => { c.moveTo(26, -65); c.quadraticCurveTo(mx, my - 1, 62, -33); });
      fill('#f08aa8', () => c.arc(62, -32, 5, 0, TAU)); // the end of it, and a little lace
      hand(mx + 2, my + 2, 10);
    } else if (act === 'spit') {
      const f = clamp01((au - 0.45) / 0.45); // the glob flies after the wind-up
      if (au > 0.45 && f < 1) {
        const gx = 24 + f * 150;
        const gy = -66 - Math.sin(f * Math.PI) * 38 + f * f * 70;
        fill('rgba(240,250,235,0.92)', () => c.ellipse(gx, gy, 6.5 - f * 2, 4.6 - f * 1.4, f, 0, TAU));
        fill('rgba(240,250,235,0.7)', () => c.arc(gx - 9, gy + 2, 2.2, 0, TAU));
        fill('rgba(240,250,235,0.6)', () => c.arc(gx - 16, gy + 4, 1.4, 0, TAU));
      }
      if (au > 0.9 && au < 1) fill('rgba(240,250,235,0.55)', () => c.ellipse(176, -4, 12, 3, 0, 0, TAU)); // where it landed
    }
  }
  c.restore();
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Something she does with her body when her words call for it: asterisks in her lines (`*cough cough*`, `*hhhk, ptoo*`, `*yanks her bra strap*`,
// `*wheeze*`) become a sound and a bit of business. Null when there is none.
export function actOf(text) {
  const s = (String(text || '').toLowerCase().match(/\*[^*]+\*/g) || []).join(' '); // only what is between asterisks
  if (/bra strap|\bstrap\b/.test(s)) return 'strap';
  if (/ptoo|\bspit|\bhock|hhhk/.test(s)) return 'spit';
  if (/whe+z/.test(s)) return 'wheeze';
  if (/cough|\bhack/.test(s)) return 'cough';
  return null;
}

// where she stands and how far up she is, over the life of a pop-up (ms from her entrance): she bounces up, holds, drops back
export function popRise(ms, dur) {
  const up = 260;
  const down = 280;
  if (ms <= 0) return 0;
  if (ms < up) { const u = ms / up; return 1 - (1 - u) ** 3 + Math.sin(u * Math.PI) * 0.06; } // overshoots a touch, like a jack-in-the-box
  if (ms < dur - down) return 1;
  if (ms < dur) { const u = (ms - (dur - down)) / down; return 1 - u * u; }
  return 0;
}

// how long she stays for a remark: long enough to read, and to laugh
export const popDuration = (text) => Math.round(Math.max(2400, Math.min(6200, 1500 + String(text || '').length * 55)) + (actOf(text) ? 700 : 0));

// the words in a balloon: lines no wider than `maxW`, using the canvas's current font
export function wrap(c, text, maxW) {
  const out = [];
  let cur = '';
  for (const word of String(text || '').split(/\s+/)) {
    const test = cur ? `${cur} ${word}` : word;
    if (cur && c.measureText(test).width > maxW) { out.push(cur); cur = word; } else cur = test;
  }
  if (cur) out.push(cur);
  return out;
}
