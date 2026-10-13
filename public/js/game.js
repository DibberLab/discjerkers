/* The game: bring your bag, pick a disc, set your flight, then time the throw.
   The rules are in gamecore.js (and the flight in flightmodel.js, shared with the flight guide); this file is what you
   see and touch: the hole drawn from above, the panel, the throw meter, the animation, and Marebear. */

import { account, activeBag, loadAccount, onAccountChange, openSignIn, photoUrl, setActive } from './fgaccount.js?v=3';
import { clamp, SPIN, spinOf, typicalSpin, tierName, ANGLE_MAX, angleName, angleDeg } from './flightmodel.js?v=1';
import { HOLES } from './course.js?v=1';
import * as G from './gamecore.js?v=1';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const ft = (n) => `${nf.format(Math.round(n))} ft`;

/* ---------- the clock ---------- */
// one clock for everything that moves, so a test (or a hidden tab) can wind it forward
const clock = { offset: 0 };
const now = () => performance.now() + clock.offset;

/* ---------- discs and bags ---------- */

const MPH = { min: 10, max: 90, step: 2 }; // the guide stops at 30; a hole needs soft approaches too
const STARTER = ['AviarX3', 'Zone OS', 'Roc3', 'Buzzz OS', 'Leopard3', 'Teebird3', 'Destroyer'];
const DISCS = new Map();
let DATA;

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}
function lum(hex) {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ink = (hex) => (lum(hex) > 0.35 ? '#0b0f0b' : '#f4f6ef');
const gradeColor = (col) => hslHex(4 + 254 * (col / 16), 76, 64); // the flight guide's stability colors
const splitName = (name) => {
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return m && m[1] ? m[1] : name;
};

// the discs you can throw: your active bag, or a starter bag when you are signed out or the bag is empty
function buildBag() {
  const bag = account.user ? activeBag() : null;
  const mine = bag && bag.discs.length ? bag.discs.map((id) => DISCS.get(id)).filter(Boolean) : null;
  const list = mine || STARTER.map((n) => [...DISCS.values()].find((d) => d.name === n)).filter(Boolean);
  const fallback = list.length ? list : [...DISCS.values()].sort((a, b) => b.speed - a.speed).filter((_, i) => i % 200 === 0).slice(0, 6);
  return {
    starter: !mine,
    discs: fallback.map((disc) => ({ disc, item: mine ? bag.items?.[disc.id] || null : null })).sort((a, b) => b.disc.speed - a.disc.speed || a.disc.name.localeCompare(b.disc.name)),
  };
}

function discChip(disc, item) {
  const c = item?.color || gradeColor(disc.col);
  const photo = item?.photo ? `;--fill:url('${photoUrl(item.photo)}') center/cover` : '';
  const label = splitName(disc.name);
  const n = label.length;
  const fs = n <= 5 ? 1 : n <= 7 ? 0.88 : n <= 9 ? 0.68 : n <= 11 ? 0.6 : 0.52;
  return `<span class="disc"${photo ? ' data-photo' : ''} style="--c:${c};--t:${ink(c)};--fs:${fs}${photo}" aria-hidden="true"><span class="disc__n">${esc(label)}</span></span>`;
}

/* ---------- state ---------- */

const S = {
  hole: HOLES[0],
  round: null,
  phase: 'loading', // pick | power | release | putt | flight | result | bear | done
  bag: { starter: true, discs: [] },
  discId: null,
  settings: loadSettings(),
  aimOff: 0, // degrees to the right of the line to the basket
  showLine: true,
  meter: null,
  anim: null,
  last: null,
  trail: [],
  fx: [],
  bear: null,
  toast: { text: '', until: 0 },
  best: null,
};

function loadSettings() {
  const base = { hand: 'right', style: 'backhand', mph: 56, spin: null, angle: 0 };
  try {
    const t = JSON.parse(localStorage.getItem('dj_game_throw')) || JSON.parse(localStorage.getItem('dj_fg_throw')) || {};
    if (['right', 'left'].includes(t.hand)) base.hand = t.hand;
    if (['backhand', 'forehand'].includes(t.style)) base.style = t.style;
    if (Number.isInteger(t.mph) && t.mph >= MPH.min && t.mph <= MPH.max && t.mph % MPH.step === 0) base.mph = t.mph;
    if (Number.isInteger(t.spin) && t.spin >= SPIN.min && t.spin <= SPIN.max) base.spin = t.spin;
  } catch { /* defaults */ }
  return base;
}
function saveSettings() {
  try { localStorage.setItem('dj_game_throw', JSON.stringify(S.settings)); } catch { /* not saved */ }
}
const bestKey = () => `dj_game_best_${S.hole.id}`;

const lieOf = () => S.round.lie;
const toBasket = () => G.distance(lieOf(), S.hole.basket);
const inPutt = () => toBasket() <= G.PUTT_RANGE;
const baseHeading = () => G.headingTo(lieOf(), S.hole.basket);
const heading = () => baseHeading() + S.aimOff;
const curDisc = () => DISCS.get(S.discId);
const itemOf = (id) => S.bag.discs.find((x) => x.disc.id === id)?.item || null;
const available = () => S.bag.discs.filter((x) => !S.round.eaten.includes(x.disc.id));

// the disc to suggest for where you are: a putter on the green, a driver from the tee
function suggest() {
  const list = available();
  if (!list.length) return null;
  const dist = toBasket();
  const want = dist <= G.PUTT_RANGE ? 2 : dist > 300 ? 12 : dist > 220 ? 9 : dist > 130 ? 6 : 4;
  return list.reduce((best, x) => (Math.abs(x.disc.speed - want) < Math.abs(best.disc.speed - want) ? x : best)).disc.id;
}

function startRound() {
  S.round = G.newRound(S.hole);
  S.trail = [];
  S.fx = [];
  S.bear = null;
  S.last = null;
  S.aimOff = 0;
  S.bag = buildBag();
  S.discId = suggest();
  try { S.best = Number(localStorage.getItem(bestKey())) || null; } catch { S.best = null; }
  setPhase('pick');
  retarget(true);
}

function setPhase(phase, focusSel) {
  S.phase = phase;
  renderPanel(focusSel);
  updateHud();
}

/* ---------- the panel ---------- */

const panel = () => $('#gm-panel');

function bagBar() {
  if (!account.user) {
    return `<div class="gm-bagbar"><span>Starter bag</span><button class="chip" type="button" data-signin>Sign in to bring your bag</button></div>`;
  }
  const options = account.bags.map((b) => `<option value="${esc(b.id)}"${b.id === account.activeId ? ' selected' : ''}>${b.main ? '★ ' : ''}${esc(b.name)} (${b.discs.length})</option>`).join('');
  return `<div class="gm-bagbar"><label><span class="sr-only">Bag</span><select data-bag aria-label="Which bag">${options}</select></label>${S.bag.starter ? '<span>That bag is empty: playing the starter bag</span>' : ''}</div>`;
}

function discRow() {
  return `<div class="gm-discs" role="group" aria-label="Your discs">${S.bag.discs.map(({ disc, item }) => {
    const eaten = S.round.eaten.includes(disc.id);
    return `<button class="gm-disc" type="button" data-disc="${disc.id}" aria-pressed="${disc.id === S.discId}"${eaten ? ' disabled' : ''} title="${esc(disc.name)}${eaten ? ' (eaten by Marebear)' : ''}">${discChip(disc, item)}<small>${esc(splitName(disc.name))}${eaten ? ' 🐻' : ''}</small></button>`;
  }).join('')}</div>`;
}

function pickInfo(d, plan, putting) {
  const brand = DATA.brands[d.b].n;
  const nums = `${d.speed} / ${d.glide} / ${d.turn > 0 ? `+${d.turn}` : d.turn} / ${d.fade}`;
  const out = putting
    ? `${Math.round(G.puttZone(toBasket(), d) * 100)}%<small>sweet zone</small>`
    : `${ft(plan.feet)}<small>${plan.wind.mph ? `${plan.wind.head > 1 ? 'headwind' : plan.wind.head < -1 ? 'tailwind' : 'crosswind'} ${Math.round(plan.wind.mph)} mph` : 'calm'}</small>`;
  return `<div class="gm-pick"><b>${esc(d.name)}</b><output>${out}</output><small>${esc(brand)} · ${nums}</small></div>`;
}

function rangeRow({ key, label, text, value, min, max, step, auto = false, aria = label, dec = '−', inc = '+' }) {
  return `<div class="fg-rng" role="group" aria-label="${esc(label)}">
      <div class="fg-rng__top"><span class="fg-wind__l">${esc(label)}</span>${auto ? '<button class="fg-rng__auto" type="button" data-spin-auto title="Use the typical spin for this arm speed">Auto</button>' : ''}<output aria-live="polite">${text}</output></div>
      <div class="fg-rng__bar fg-mph">
        <button type="button" data-gstep="${key}" data-dir="-1" aria-label="Less ${esc(aria)}"${value <= min ? ' disabled' : ''}>${dec}</button>
        <input type="range" data-gr="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(aria)}">
        <button type="button" data-gstep="${key}" data-dir="1" aria-label="More ${esc(aria)}"${value >= max ? ' disabled' : ''}>${inc}</button>
      </div>
    </div>`;
}

const mphText = (mph) => `${mph} mph<small>${tierName(Math.max(30, mph))}</small>`;
const spinText = (t) => (t.spin == null ? `Auto<small>${typicalSpin(t.mph)} rpm</small>` : `${t.spin} rpm`);
const aimText = (off) => (off === 0 ? 'At the basket' : `${Math.abs(off)}° ${off > 0 ? 'right' : 'left'}`);

function settingsBlock() {
  const t = S.settings;
  const chip = (key, val, label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${t[key] === val}">${label}</button>`;
  const a = angleDeg(t);
  const name = angleName(t);
  const dir = (t.hand === 'right') === (t.style === 'backhand') ? 1 : -1;
  const tilt = (-dir * Math.sign(a) * Math.min(Math.abs(a) * 1.5, 80)).toFixed(1);
  return `<div class="gm-block gm-settings">
      <p class="gm-h">Your throw</p>
      <div class="fg-throw" role="group" aria-label="How you throw">
        <div class="fg-seg">${chip('hand', 'right', 'Right')}${chip('hand', 'left', 'Left')}</div>
        <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
      </div>
      ${rangeRow({ key: 'mph', label: 'Arm speed', text: mphText(t.mph), value: t.mph, min: MPH.min, max: MPH.max, step: MPH.step, aria: 'arm speed' })}
      ${rangeRow({ key: 'spin', label: 'Spin', text: spinText(t), value: spinOf(t), min: SPIN.min, max: SPIN.max, step: SPIN.step, auto: t.spin != null, aria: 'spin' })}
      <div class="fg-arm fg-angle" role="group" aria-label="Release angle">
        <span class="fg-wind__l">Angle</span>
        <div class="fg-mph fg-mph--angle">
          <button type="button" data-angle-step="-1" aria-label="More anhyzer"${t.angle === -ANGLE_MAX ? ' disabled' : ''}>‹</button>
          <output aria-live="polite"><svg viewBox="-20 -9 40 18" aria-hidden="true"><g transform="rotate(${tilt})"><ellipse class="fg-angle__disc" rx="16" ry="3.6"/><ellipse class="fg-angle__top" rx="11" ry="1.6" cy="-1.1"/></g></svg><span>${name}</span></output>
          <button type="button" data-angle-step="1" aria-label="More hyzer"${t.angle === ANGLE_MAX ? ' disabled' : ''}>›</button>
        </div>
      </div>
      ${rangeRow({ key: 'aim', label: 'Aim', text: aimText(S.aimOff), value: S.aimOff, min: -60, max: 60, step: 1, aria: 'aim', dec: '‹', inc: '›' })}
    </div>`;
}

const tipSeen = () => { try { return localStorage.getItem('dj_game_tip') === '1'; } catch { return false; } };
const tipHtml = () => (tipSeen() ? '' : `<div class="gm-tip"><p><b>How to play:</b> pick a disc, set your throw, and aim (drag on the hole). Then <b>Throw</b>: tap once to stop the power, once more to release. Trees stop low throws, water costs a stroke, and a triple bogey draws Marebear.</p><button type="button" data-tip-close aria-label="Got it">×</button></div>`);

function panelPick() {
  const d = curDisc();
  if (!d) return panelNoDiscs();
  const putting = inPutt();
  const plan = G.planThrow(S.hole, d, S.settings, heading());
  const dist = toBasket();
  const strokes = S.round.strokes;
  return `${tipHtml()}${bagBar()}
    <div class="gm-block">
      <p class="gm-h">Your disc <span>· ${available().length} left in the bag</span></p>
      ${discRow()}
      ${pickInfo(d, plan, putting)}
    </div>
    ${putting
      ? `<p class="gm-sub"><b>${ft(dist)}</b> from the basket. One tap: stop the needle in the green. Short putts get a wide zone; a faster disc narrows it.</p>`
      : settingsBlock()}
    <div class="gm-go">
      <button class="btn" type="button" data-go>${putting ? 'Putt' : 'Throw'}</button>
      <p class="gm-go__line">Stroke <b>${strokes + 1}</b> · Par <b>${S.hole.par}</b> · ${putting ? `${ft(dist)} out` : `${ft(dist)} to the basket`}</p>
    </div>`;
}

function panelNoDiscs() {
  return `<div class="gm-card"><h2 class="is-bad">No discs left</h2><p>Marebear ate your whole bag. Round over.</p><button class="btn" type="button" data-again>Play again</button></div>`;
}

function barMarkup(kind) {
  const m = S.meter;
  if (kind === 'power') {
    const z = m.setup.power;
    return `<div class="gm-bar" id="gm-bar"><i class="gm-zone" style="left:${(z.c - z.w) * 100}%;width:${z.w * 200}%"></i><i class="gm-over" style="width:${(1 - (z.c + z.w)) * 100}%"></i><b class="gm-mark" id="gm-mark" style="left:0%"></b></div>
      <div class="gm-ends"><span>Weak</span><span>Overswing</span></div>`;
  }
  const w = kind === 'putt' ? m.zone : m.setup.release.w;
  return `<div class="gm-bar" id="gm-bar"><i class="gm-zone" style="left:${(0.5 - w / 2) * 100}%;width:${w * 100}%"></i><b class="gm-mark" id="gm-mark" style="left:0%"></b></div>
    <div class="gm-ends"><span>${kind === 'putt' ? 'Short' : 'Early'}</span><span>${kind === 'putt' ? 'Long' : 'Late'}</span></div>`;
}

function panelMeter() {
  const kind = S.phase;
  const d = curDisc();
  const title = kind === 'power' ? '<span>1 ·</span> Power' : kind === 'release' ? '<span>2 ·</span> Release' : 'Putt';
  const hint = kind === 'power' ? 'Tap when the marker is in the green. Too early is weak; past the green you overswing.'
    : kind === 'release' ? 'Tap when the needle crosses the middle. Early goes toward the turn side, late toward the fade side.'
      : `Tap when the needle is in the green. ${d ? esc(d.name) : ''}, ${ft(toBasket())}.`;
  return `<div class="gm-meter">
      <div class="gm-steps" aria-hidden="true"><i class="is-on"></i><i class="${kind === 'release' ? 'is-on' : ''}"></i></div>
      <p class="gm-meter__t">${title}</p>
      <p class="gm-meter__h">${hint}</p>
      ${barMarkup(kind)}
      <button class="gm-tap" type="button" data-tap>Tap</button>
    </div>`;
}

const panelFlight = () => `<div class="gm-card"><h2>${esc(S.last?.ex?.grade ?? '')}</h2><p>${S.last?.ex ? describeExecution(S.last.ex) : 'Here it goes…'}</p></div>`;

function describeExecution(ex) {
  const timing = ex.o < -0.08 ? 'released early' : ex.o > 0.08 ? 'released late' : 'released on time';
  return `${Math.round(ex.pf * 100)}% power${ex.over > 0.05 ? ' (overswung)' : ''}, ${timing}.`;
}

function surfaceName(s) {
  return { fairway: 'On the fairway', rough: 'In the rough', tee: 'Back at the tee', water: 'In the water', oob: 'Out of bounds' }[s] || 'Down';
}

function resultCopy(r) {
  const dist = toBasket();
  if (r.kind === 'water' || r.kind === 'oob') {
    return { h: r.kind === 'water' ? 'Splash!' : 'Out of bounds', tone: 'bad', p: 'That is a penalty stroke. You throw again from the same spot.' };
  }
  if (r.kind === 'tree') return { h: 'Thunk!', tone: 'bad', p: `It hit a tree and dropped at the base. ${ft(dist)} to the basket.` };
  if (r.made === false) return { h: 'Missed', tone: 'bad', p: `It rattled out and sits ${ft(dist)} from the basket.` };
  return { h: surfaceName(r.surface), tone: r.surface === 'rough' ? 'bad' : 'good', p: `${ft(dist)} to the basket.` };
}

function panelResult() {
  const { result, ex, disc } = S.last;
  const c = resultCopy(result);
  const where = result.plan ? `The ${esc(splitName(disc.name))} went ${ft(result.plan.feet)}. ` : '';
  return `<div class="gm-card">
      <h2 class="${c.tone === 'good' ? 'is-good' : c.tone === 'bad' ? 'is-bad' : ''}">${c.h}</h2>
      <p>${where}${c.p}</p>
      ${ex ? `<p>${esc(ex.grade)} throw: ${describeExecution(ex)}</p>` : ''}
      <button class="btn" type="button" data-next>Next throw</button>
    </div>`;
}

function panelBear() {
  const disc = DISCS.get(S.bear.discId);
  return `<div class="gm-card"><h2 class="is-bad">Marebear!</h2><p>Triple bogey, and Marebear smelled it. She is eating your ${esc(splitName(disc.name))}.</p></div>`;
}

function panelDone() {
  const r = S.round;
  const name = r.holed ? G.scoreName(r.strokes, S.hole.par) : 'No discs left';
  const diff = r.strokes - S.hole.par;
  const best = S.best;
  const log = r.throws.map((t, i) => {
    const d = DISCS.get(t.disc);
    return `<li><b>${i + 1}</b> · ${esc(splitName(d.name))} · ${t.kind === 'basket' ? 'in the basket' : t.kind === 'water' || t.kind === 'oob' ? 'out of bounds (+1)' : t.kind === 'tree' ? 'hit a tree' : `${ft(t.feet)}`}</li>`;
  }).join('');
  return `<div class="gm-card">
      <h2 class="${r.holed && diff <= 0 ? 'is-good' : 'is-bad'}">${name}</h2>
      <div class="gm-score"><div><b>${r.strokes}</b><span>Strokes</span></div><div><b>${S.hole.par}</b><span>Par</span></div><div><b>${diff > 0 ? '+' : ''}${diff}</b><span>To par</span></div></div>
      ${best ? `<p>Best on this hole: <b>${best}</b>${r.holed && r.strokes <= best ? ' (that is you, right now)' : ''}</p>` : ''}
      <ol class="gm-log">${log}</ol>
      ${r.eaten.length ? `<p>Marebear ate ${r.eaten.map((id) => esc(splitName(DISCS.get(id).name))).join(', ')}. She does not give them back.</p>` : ''}
      <button class="btn" type="button" data-again>Play the hole again</button>
    </div>`;
}

function renderPanel(focusSel) {
  const p = panel();
  if (!p) return;
  const keepScroll = p.dataset.phase === S.phase ? p.scrollTop : 0;
  const views = { pick: panelPick, power: panelMeter, release: panelMeter, putt: panelMeter, flight: panelFlight, result: panelResult, bear: panelBear, done: panelDone };
  p.innerHTML = (views[S.phase] || (() => ''))();
  p.dataset.phase = S.phase;
  p.scrollTop = keepScroll;
  if (focusSel) $(focusSel, p)?.focus({ preventScroll: true });
  else if (S.phase === 'power' || S.phase === 'release' || S.phase === 'putt') $('[data-tap]', p)?.focus({ preventScroll: true });
}

/* ---------- the HUD ---------- */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function updateHud() {
  const h = S.hole;
  const r = S.round;
  if (!r) return;
  $('#gm-hud').innerHTML = `<span>Hole ${h.id} · ${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small><span>Strokes <b>${r.strokes}</b></span><small>${ft(G.distance(r.lie, h.basket))} to the basket</small>`;
  const from = COMPASS[Math.round(h.wind.from / 45) % 8];
  $('#gm-wind').innerHTML = h.wind.mph
    ? `<svg viewBox="-10 -10 20 20" style="transform:rotate(${h.wind.from + 180}deg)"><path d="M0 -8 L4.5 5 L0 2.5 L-4.5 5 Z"/></svg><span>${h.wind.mph} mph<br>from ${from}</span>`
    : '<span>Calm</span>';
}

function toast(text, tone = '', ms = 1700) {
  const el = $('#gm-toast');
  el.textContent = text;
  el.dataset.tone = tone;
  el.classList.add('is-on');
  S.toast = { text, until: now() + ms };
}

/* ---------- the throw ---------- */

function startMeter() {
  const d = curDisc();
  if (!d) return;
  if (inPutt()) {
    S.meter = { kind: 'putt', start: now(), zone: G.puttZone(toBasket(), d), period: G.puttMeter(toBasket()).period };
    setPhase('putt');
  } else {
    S.meter = { kind: 'power', start: now(), setup: G.meterSetup(S.settings.mph), power: null };
    setPhase('power');
  }
}

function tap() {
  const m = S.meter;
  if (!m) return;
  const t = (now() - m.start) / 1000;
  if (S.phase === 'power') {
    m.power = G.readPower(G.powerAt(t, m.setup), m.setup.power);
    m.start = now();
    setPhase('release');
    toast(m.power.inZone ? 'Full power' : m.power.over > 0 ? 'Overswing' : `${Math.round(m.power.pf * 100)}% power`, m.power.inZone ? 'good' : 'bad', 900);
  } else if (S.phase === 'release') {
    const x = G.releaseAt(t, m.setup);
    const ex = G.combine(m.power, G.readRelease(x, m.setup.release.w));
    throwDisc(ex);
  } else if (S.phase === 'putt') {
    puttDisc(G.releaseAt(t, { release: { period: m.period } }));
  }
}

function throwDisc(ex) {
  try { localStorage.setItem('dj_game_tip', '1'); } catch { /* shown again */ }
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolveThrow(S.hole, disc, S.settings, heading(), ex, from);
  S.last = { result, ex, disc, from };
  const flightMs = clamp(900 + result.plan.feet * 4.2, 1200, 3300);
  S.anim = { type: 'flight', t0: now(), dur: flightMs, pts: result.pts, roll: result.roll, result };
  toast(ex.grade, ex.pure ? 'good' : ex.grade === 'Shank' ? 'bad' : '', 1300);
  setPhase('flight');
  retarget(false, result.pts);
}

function puttDisc(x) {
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolvePutt(S.hole, from, disc, x);
  S.last = { result, ex: null, disc, from };
  const to = result.made ? S.hole.basket : result.lie;
  const pts = Array.from({ length: 21 }, (_, i) => {
    const s = i / 20;
    return { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s, h: 3 + 5 * 4 * s * (1 - s), s };
  });
  S.anim = { type: 'flight', t0: now(), dur: 750, pts, roll: [], result };
  toast(result.made ? (result.gimme ? 'Tap-in' : 'Chains!') : 'Rimmed out', result.made ? 'good' : 'bad', 1100);
  setPhase('flight');
  retarget(false, pts);
}

function finishThrow() {
  const { result, disc, from } = S.last;
  const out = G.applyResult(S.round, disc, result);
  S.trail.push({ pts: [...result.pts ?? [], ...(result.roll ?? [])], kind: result.kind, n: S.round.throws.length, from });
  const at = result.end ?? result.lie;
  if (result.kind === 'water' || result.kind === 'oob') S.fx.push({ type: 'splash', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'tree') S.fx.push({ type: 'thunk', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'basket') S.fx.push({ type: 'chains', x: S.hole.basket.x, y: S.hole.basket.y, t0: now() });
  if (navigator.vibrate && ['tree', 'water', 'oob', 'basket'].includes(result.kind)) navigator.vibrate(result.kind === 'basket' ? [30, 40, 30] : 40);
  S.anim = null;
  S.aimOff = 0;

  if (result.kind === 'basket') {
    finishRound();
  } else if (out.bear) {
    startBear(out.bear);
  } else {
    setPhase('result');
    retarget(false);
  }
}

function finishRound() {
  const r = S.round;
  r.done = true;
  if (r.holed) {
    try {
      if (!S.best || r.strokes < S.best) localStorage.setItem(bestKey(), String(r.strokes));
      S.best = Math.min(S.best || Infinity, r.strokes);
    } catch { /* not saved */ }
    toast(G.scoreName(r.strokes, S.hole.par), r.strokes <= S.hole.par ? 'good' : 'bad', 2600);
  }
  setPhase('done');
  retarget(false);
}

function next() {
  if (S.round.done) { finishRound(); return; }
  S.discId = suggest(); // a driver from the tee, a putter on the green: you can change it
  S.aimOff = 0;
  setPhase('pick');
  retarget(false);
}

/* ---------- Marebear ---------- */

const BEAR_PARTS = { enter: 1700, chomp: 1300, burp: 900, leave: 1300 };
function startBear(info) {
  S.bear = { t0: now(), at: { ...info.at }, discId: info.discId };
  toast('Marebear!', 'bad', 1800);
  setPhase('bear');
  retarget(false);
}
function bearPhase(ms) {
  let t = ms;
  for (const [name, len] of Object.entries(BEAR_PARTS)) {
    if (t < len) return { name, p: t / len };
    t -= len;
  }
  return null;
}
function endBear() {
  const eatenLast = !available().length;
  S.bear = null;
  if (eatenLast) {
    S.round.done = true;
    S.round.holed = false;
    setPhase('done');
  } else {
    setPhase('result');
  }
  retarget(false);
}

/* ---------- the camera ---------- */

const cv = $('#gm-canvas');
const ctx = cv.getContext('2d');
let W = 0;
let H = 0;
let dpr = 1;
const cam = { x: 0, y: 200, s: 0.6, tx: 0, ty: 200, ts: 0.6 };

function resize() {
  const r = $('#gm-stage').getBoundingClientRect();
  W = Math.max(1, r.width);
  H = Math.max(1, r.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  if (S.round) retarget(true);
}

// frame the lie and the basket, with room to see where the throw goes
function retarget(snap, extra = []) {
  if (!S.round) return;
  const lie = lieOf();
  const b = S.hole.basket;
  const putting = inPutt();
  const pts = [lie, b, ...extra.filter((_, i) => i % 6 === 0)];
  if (S.phase === 'pick' && !putting && curDisc()) {
    const plan = G.planThrow(S.hole, curDisc(), S.settings, heading());
    pts.push(G.samplePath(plan, lie, 12).at(-1));
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = putting ? 16 : 36;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = Math.max(maxX - minX, putting ? 60 : 120);
  const h = Math.max(maxY - minY, putting ? 70 : 140);
  cam.tx = (minX + maxX) / 2;
  cam.ty = (minY + maxY) / 2;
  cam.ts = Math.min(W / w, H / h);
  if (snap) { cam.x = cam.tx; cam.y = cam.ty; cam.s = cam.ts; }
}

const P = (x, y) => [W / 2 + (x - cam.x) * cam.s, H / 2 - (y - cam.y) * cam.s];
const toWorld = (px, py) => ({ x: cam.x + (px - W / 2) / cam.s, y: cam.y - (py - H / 2) / cam.s });

/* ---------- drawing ---------- */

const images = new Map();
function image(url) {
  let im = images.get(url);
  if (!im) {
    im = new Image();
    im.src = url;
    images.set(url, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

function poly(points, close = true) {
  ctx.beginPath();
  points.forEach(([x, y], i) => { const [sx, sy] = P(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
  if (close) ctx.closePath();
}

function drawCourse(t) {
  const h = S.hole;
  ctx.fillStyle = '#060d08';
  ctx.fillRect(0, 0, W, H);
  // in bounds: the rough
  const b = h.bounds;
  const [bx0, by0] = P(b.minX, b.maxY);
  const [bx1, by1] = P(b.maxX, b.minY);
  ctx.fillStyle = '#16301d';
  ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
  ctx.strokeStyle = '#d35400';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
  ctx.setLineDash([]);
  // the fairway, mown in stripes
  ctx.save();
  poly(h.fairwayPoly);
  ctx.fillStyle = '#25502e';
  ctx.fill();
  ctx.clip();
  const top = h.fairway.at(-1)[1];
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let wy = 0, i = 0; wy < top; wy += 36, i++) {
    if (!(i % 2)) continue;
    const [, y1] = P(0, wy + 36);
    const [, y0] = P(0, wy);
    ctx.fillRect(0, y1, W, y0 - y1);
  }
  ctx.restore();
  // the circle around the basket
  const [cx, cy] = P(h.basket.x, h.basket.y);
  ctx.beginPath();
  ctx.arc(cx, cy, 24 * cam.s, 0, Math.PI * 2);
  ctx.fillStyle = '#25502e';
  ctx.fill();
  // the tee pad
  const p = h.tee.pad;
  const [tx0, ty0] = P(p.minX, p.maxY);
  const [tx1, ty1] = P(p.maxX, p.minY);
  ctx.fillStyle = '#2f6a3a';
  ctx.fillRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
  // water
  for (const w of h.water) {
    poly(w);
    ctx.fillStyle = '#1b4b66';
    ctx.fill();
    ctx.strokeStyle = '#4a93b4';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    poly(w);
    ctx.clip();
    ctx.strokeStyle = 'rgba(190,230,245,0.18)';
    ctx.lineWidth = 1;
    const xs = w.map((q) => q[0]);
    const ys = w.map((q) => q[1]);
    for (let y = Math.min(...ys); y < Math.max(...ys); y += 14) {
      ctx.beginPath();
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += 6) {
        const [sx, sy] = P(x, y + Math.sin(x * 0.12 + t / 700 + y) * 2);
        if (x === Math.min(...xs)) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTrees() {
  for (const tr of S.hole.trees) {
    const [x, y] = P(tr.x, tr.y);
    const R = tr.r * 1.9 * cam.s;
    const shrub = tr.h < 20;
    ctx.beginPath();
    ctx.ellipse(x + R * 0.28, y + R * 0.28, R, R * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = shrub ? '#4a8f45' : '#1f5a2a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - R * 0.12, y - R * 0.12, R * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = shrub ? '#63ad57' : '#2c7a38';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, tr.r * cam.s * 0.7), 0, Math.PI * 2); // the part that stops a disc
    ctx.fillStyle = shrub ? '#3f7a3a' : '#123a1b';
    ctx.fill();
  }
}

function drawBasket() {
  const [x, y] = P(S.hole.basket.x, S.hole.basket.y);
  const r = Math.max(5, 2.6 * cam.s);
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#d35400';
  ctx.lineWidth = Math.max(2, r * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#eef1e8';
  ctx.fill();
}

function drawTrail() {
  S.trail.forEach((t, i) => {
    if (t.pts.length < 2) return;
    poly(t.pts.map((p) => [p.x, p.y]), false);
    ctx.strokeStyle = t.kind === 'water' || t.kind === 'oob' ? 'rgba(211,84,0,0.55)' : 'rgba(238,241,232,0.3)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const e = t.pts.at(-1);
    const [x, y] = P(e.x, e.y);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11,15,11,0.75)';
    ctx.fill();
    ctx.fillStyle = '#eef1e8';
    ctx.font = '700 9px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 0.5);
  });
}

function drawPreview() {
  if (S.phase !== 'pick' || !S.showLine || !curDisc()) return;
  const lie = lieOf();
  if (inPutt()) {
    poly([lie, S.hole.basket].map((p) => [p.x, p.y]), false);
  } else {
    const pts = G.samplePath(G.planThrow(S.hole, curDisc(), S.settings, heading()), lie, 48);
    poly(pts.map((p) => [p.x, p.y]), false);
  }
  ctx.strokeStyle = 'rgba(163,230,53,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.setLineDash([]);
  if (!inPutt()) {
    const end = G.samplePath(G.planThrow(S.hole, curDisc(), S.settings, heading()), lie, 8).at(-1);
    const [x, y] = P(end.x, end.y);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(163,230,53,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// a disc seen from above: raised by its height, with its shadow on the ground
function drawDisc(wx, wy, h, discId, size = 1) {
  const look = discLook(discId);
  const [gx, gy] = P(wx, wy);
  const r = Math.max(6, 3.2 * cam.s) * size * (1 + h / 120);
  const lift = h * 0.3 * cam.s;
  ctx.beginPath();
  ctx.ellipse(gx, gy, r * 0.9, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  const x = gx;
  const y = gy - lift;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = look.color;
  ctx.fill();
  const im = look.photo ? image(look.photo) : null;
  if (im) {
    ctx.clip();
    ctx.drawImage(im, x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (!im) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
  }
}

function discLook(id) {
  const d = DISCS.get(id);
  const it = itemOf(id);
  return { color: it?.color || gradeColor(d.col), photo: it?.photo ? photoUrl(it.photo) : '' };
}

function drawLie(t) {
  if (!['pick', 'power', 'release', 'putt', 'result'].includes(S.phase) || !curDisc() || S.phase === 'result') return;
  const lie = lieOf();
  const [x, y] = P(lie.x, lie.y);
  ctx.beginPath();
  ctx.arc(x, y, 14 + Math.sin(t / 260) * 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(238,241,232,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawDisc(lie.x, lie.y, 0, S.discId);
}

function drawFx(t) {
  S.fx = S.fx.filter((f) => t - f.t0 < 1200);
  for (const f of S.fx) {
    const age = (t - f.t0) / 1200;
    const [x, y] = P(f.x, f.y);
    if (f.type === 'splash') {
      for (let k = 0; k < 3; k++) {
        const a = clamp(age * 1.4 - k * 0.2, 0, 1);
        if (a <= 0 || a >= 1) continue;
        ctx.beginPath();
        ctx.arc(x, y, 4 + a * 26, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(210,240,255,${0.8 * (1 - a)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (f.type === 'thunk') {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const d = 4 + age * 16;
        ctx.fillStyle = `rgba(150,220,100,${1 - age})`;
        ctx.fillRect(x + Math.cos(ang) * d - 1.5, y + Math.sin(ang) * d - 1.5, 3, 3);
      }
    } else if (f.type === 'chains') {
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2;
        const d = 6 + age * 26;
        ctx.fillStyle = `rgba(238,241,232,${1 - age})`;
        ctx.fillRect(x + Math.cos(ang) * d - 1, y + Math.sin(ang) * d - 1, 2.5, 2.5);
      }
    }
  }
}

// Marebear: a big brown bear who has noticed you are having a bad hole
function drawBear(x, y, scale, opts) {
  const { mouth = 0, run = 0, facing = 1, burp = 0 } = opts;
  const bob = Math.sin(run * 16) * 2.2 * scale;
  ctx.save();
  ctx.translate(x, y + bob);
  ctx.scale(scale * facing, scale);
  const fill = (c, fn) => { ctx.beginPath(); fn(); ctx.fillStyle = c; ctx.fill(); };
  fill('rgba(0,0,0,0.3)', () => ctx.ellipse(0, 20, 22, 7, 0, 0, Math.PI * 2));
  // legs
  const leg = Math.sin(run * 16) * 5;
  fill('#4e3118', () => ctx.ellipse(-9 + leg * 0.3, 17, 6, 8, 0, 0, Math.PI * 2));
  fill('#4e3118', () => ctx.ellipse(9 - leg * 0.3, 17, 6, 8, 0, 0, Math.PI * 2));
  // body
  fill('#6b4423', () => ctx.ellipse(0, 4, 20, 19, 0, 0, Math.PI * 2));
  fill('#8a5d34', () => ctx.ellipse(0, 7, 12, 12, 0, 0, Math.PI * 2));
  // arms
  fill('#5b3a1e', () => ctx.ellipse(-19, 3 - leg * 0.4, 6, 10, 0.3, 0, Math.PI * 2));
  fill('#5b3a1e', () => ctx.ellipse(19, 3 + leg * 0.4, 6, 10, -0.3, 0, Math.PI * 2));
  // head
  fill('#6b4423', () => ctx.arc(0, -17, 15, 0, Math.PI * 2));
  fill('#6b4423', () => ctx.arc(-11, -29, 6, 0, Math.PI * 2));
  fill('#6b4423', () => ctx.arc(11, -29, 6, 0, Math.PI * 2));
  fill('#c9966a', () => ctx.arc(-11, -29, 3, 0, Math.PI * 2));
  fill('#c9966a', () => ctx.arc(11, -29, 3, 0, Math.PI * 2));
  fill('#c9966a', () => ctx.ellipse(0, -12, 9, 7, 0, 0, Math.PI * 2));
  // mouth, open as wide as it is chewing
  const open = 1 + mouth * 6;
  fill('#2b0f0f', () => ctx.ellipse(0, -9 + open * 0.3, 6, open, 0, 0, Math.PI * 2));
  if (mouth > 0.2) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-4, -9 - open * 0.7, 2, 3);
    ctx.fillRect(2, -9 - open * 0.7, 2, 3);
  }
  fill('#1a0d05', () => ctx.ellipse(0, -16, 3.2, 2.4, 0, 0, Math.PI * 2));
  fill('#fff', () => ctx.arc(-6, -22, 3, 0, Math.PI * 2));
  fill('#fff', () => ctx.arc(6, -22, 3, 0, Math.PI * 2));
  fill('#d35400', () => ctx.arc(-6, -22, 1.4, 0, Math.PI * 2));
  fill('#d35400', () => ctx.arc(6, -22, 1.4, 0, Math.PI * 2));
  if (burp) {
    ctx.fillStyle = `rgba(163,230,53,${burp})`;
    ctx.beginPath();
    ctx.arc(14, -12, 5 + (1 - burp) * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBearScene(t) {
  const b = S.bear;
  if (!b) return;
  const part = bearPhase(t - b.t0);
  if (!part) { endBear(); return; }
  const [dx, dy] = P(b.at.x, b.at.y);
  const side = b.at.x > cam.x ? 1 : -1; // she comes from the side with more room
  const sc = clamp(cam.s * 1.6, 0.9, 1.6);
  const stand = dx - side * 26 * sc;
  const startX = side > 0 ? -50 : W + 50;
  let x = stand;
  let mouth = 0;
  let run = 0;
  let burp = 0;
  let facing = side;
  const discVisible = part.name === 'enter' || (part.name === 'chomp' && part.p < 0.85);
  if (part.name === 'enter') {
    const e = 1 - (1 - part.p) ** 2;
    x = startX + (stand - startX) * e;
    run = part.p * 6;
    facing = stand > startX ? 1 : -1;
  } else if (part.name === 'chomp') {
    mouth = Math.abs(Math.sin(part.p * Math.PI * 3));
  } else if (part.name === 'burp') {
    burp = 1 - part.p;
    mouth = 0.5 * (1 - part.p);
  } else {
    const e = part.p * part.p;
    x = stand + (startX - stand) * e;
    run = part.p * 6;
    facing = startX > stand ? 1 : -1;
  }
  if (discVisible) {
    const shrink = part.name === 'chomp' ? clamp(1 - part.p / 0.85, 0, 1) : 1;
    drawDisc(b.at.x, b.at.y, 0, b.discId, 1.1 * shrink);
  }
  drawBear(x, dy - 6, sc, { mouth, run, facing, burp });
  if (part.name === 'chomp') {
    ctx.fillStyle = '#eef1e8';
    ctx.font = `400 ${Math.round(22 * sc)}px Anton, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('CHOMP', dx, dy - 52 * sc - part.p * 12);
  }
  if (part.name === 'burp') {
    ctx.fillStyle = `rgba(163,230,53,${1 - part.p})`;
    ctx.font = `400 ${Math.round(26 * sc)}px Anton, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('BURP', dx, dy - 58 * sc - part.p * 16);
  }
  if (part.name === 'enter' && part.p > 0.15) {
    ctx.fillStyle = 'rgba(238,241,232,0.92)';
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MAREBEAR', x, dy - 46 * sc);
  }
}

function drawFlight(t) {
  const a = S.anim;
  if (!a) return;
  const p = clamp((t - a.t0) / a.dur, 0, 1);
  const eased = 1 - (1 - p) ** 2.2;
  const idx = eased * (a.pts.length - 1);
  const i = Math.min(a.pts.length - 2, Math.floor(idx));
  const f = idx - i;
  const A = a.pts[i];
  const B = a.pts[i + 1] || A;
  const pos = { x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, h: A.h + (B.h - A.h) * f };
  // the trail so far
  poly([...a.pts.slice(0, i + 1), pos].map((q) => [q.x, q.y]), false);
  ctx.strokeStyle = 'rgba(238,241,232,0.7)';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const rollP = a.roll.length ? clamp((t - a.t0 - a.dur) / 500, 0, 1) : 0;
  let shown = pos;
  if (p >= 1 && a.roll.length) {
    const ri = Math.min(a.roll.length - 1, Math.floor(rollP * a.roll.length));
    shown = { ...a.roll[ri], h: 0 };
    poly([a.pts.at(-1), ...a.roll.slice(0, ri + 1)].map((q) => [q.x, q.y]), false);
    ctx.stroke();
  }
  drawDisc(shown.x, shown.y, p >= 1 ? 0 : pos.h, S.last.disc.id);
  const doneAt = a.dur + (a.roll.length ? 500 : 0) + 250;
  if (t - a.t0 >= doneAt) finishThrow();
}

function draw(t) {
  if (!S.round) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawCourse(t);
  drawTrail();
  drawTrees();
  drawBasket();
  drawPreview();
  drawLie(t);
  drawFlight(t);
  drawFx(t);
  drawBearScene(t);
}

/* ---------- the loop ---------- */

function update(t) {
  cam.x += (cam.tx - cam.x) * 0.14;
  cam.y += (cam.ty - cam.y) * 0.14;
  cam.s += (cam.ts - cam.s) * 0.14;
  if (S.toast.until && t > S.toast.until) { $('#gm-toast').classList.remove('is-on'); S.toast.until = 0; }
  const m = S.meter;
  const mark = $('#gm-mark');
  if (mark && m && (S.phase === 'power' || S.phase === 'release' || S.phase === 'putt')) {
    const sec = (t - m.start) / 1000;
    const v = S.phase === 'power' ? G.powerAt(sec, m.setup) : (G.releaseAt(sec, S.phase === 'putt' ? { release: { period: m.period } } : m.setup) + 1) / 2;
    mark.style.left = `${v * 100}%`;
  }
}

function frame() {
  const t = now();
  update(t);
  draw(t);
  requestAnimationFrame(frame);
}

/* ---------- input ---------- */

function setAimFromPointer(e) {
  if (S.phase !== 'pick' || inPutt()) return;
  const r = cv.getBoundingClientRect();
  const w = toWorld(e.clientX - r.left, e.clientY - r.top);
  let off = G.headingTo(lieOf(), w) - baseHeading();
  off = ((off + 540) % 360) - 180;
  setAim(Math.round(off));
}

function setAim(v) {
  S.aimOff = clamp(Math.round(v), -60, 60);
  const input = $('[data-gr="aim"]');
  if (input) {
    input.value = S.aimOff;
    const rng = input.closest('.fg-rng');
    rng.querySelector('output').textContent = aimText(S.aimOff);
    rng.querySelectorAll('[data-gstep]').forEach((b) => { b.disabled = (b.dataset.dir === '-1' && S.aimOff <= -60) || (b.dataset.dir === '1' && S.aimOff >= 60); });
  }
  retarget(false);
}

const RNG = { mph: MPH, spin: SPIN, aim: { min: -60, max: 60, step: 1 } };

function rangeEvent(e) {
  const stepBtn = e.type === 'click' ? e.target.closest('[data-gstep]') : null;
  const input = e.type === 'change' ? e.target.closest('[data-gr]') : null;
  const auto = e.type === 'click' ? e.target.closest('[data-spin-auto]') : null;
  const src = stepBtn || input || auto;
  if (!src) return false;
  const key = auto ? 'spin' : stepBtn ? stepBtn.dataset.gstep : input.dataset.gr;
  const cfg = RNG[key];
  if (auto) {
    S.settings.spin = null;
  } else {
    const cur = key === 'mph' ? S.settings.mph : key === 'spin' ? spinOf(S.settings) : S.aimOff;
    const next = stepBtn ? cur + Number(stepBtn.dataset.dir) * cfg.step : Number(input.value);
    const v = clamp(Math.round(next / cfg.step) * cfg.step, cfg.min, cfg.max);
    if (key === 'mph') S.settings.mph = v;
    else if (key === 'spin') S.settings.spin = v;
    else S.aimOff = v;
  }
  saveSettings();
  renderPanel(`[data-gr="${key}"]`);
  retarget(false);
  return true;
}

function onPanelClick(e) {
  if (rangeEvent(e)) return;
  const t = e.target;
  const hand = t.closest('[data-hand]');
  const style = t.closest('[data-style]');
  const angle = t.closest('[data-angle-step]');
  if (hand || style) {
    const key = hand ? 'hand' : 'style';
    S.settings[key] = (hand || style).dataset[key];
    saveSettings();
    renderPanel(`[data-${key}="${S.settings[key]}"]`);
  } else if (angle) {
    S.settings.angle = clamp(S.settings.angle + Number(angle.dataset.angleStep), -ANGLE_MAX, ANGLE_MAX);
    renderPanel(`[data-angle-step="${angle.dataset.angleStep}"]`);
    retarget(false);
  } else if (t.closest('[data-disc]')) {
    const id = Number(t.closest('[data-disc]').dataset.disc);
    if (!S.round.eaten.includes(id)) { S.discId = id; renderPanel(`[data-disc="${id}"]`); retarget(false); }
  } else if (t.closest('[data-go]')) {
    startMeter();
  } else if (t.closest('[data-next]')) {
    next();
  } else if (t.closest('[data-again]')) {
    startRound();
  } else if (t.closest('[data-tip-close]')) {
    try { localStorage.setItem('dj_game_tip', '1'); } catch { /* shown again */ }
    renderPanel();
  } else if (t.closest('[data-signin]')) {
    openSignIn({ onDone: () => {} });
  }
}

function onPanelChange(e) {
  if (rangeEvent(e)) return;
  if (e.target.matches('[data-bag]')) setActive(e.target.value);
}

function onPanelInput(e) {
  const r = e.target.closest?.('[data-gr]');
  if (!r) return;
  const v = Number(r.value);
  const out = r.closest('.fg-rng').querySelector('output');
  const key = r.dataset.gr;
  if (key === 'mph') out.innerHTML = mphText(v);
  else if (key === 'spin') out.textContent = `${v} rpm`;
  else { S.aimOff = v; out.textContent = aimText(v); retarget(false); }
}

function onKey(e) {
  if (e.target.closest?.('input, select, textarea') && e.key !== 'Enter') return;
  if (['power', 'release', 'putt'].includes(S.phase) && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    tap();
  } else if (S.phase === 'pick' && !inPutt() && !e.target.closest?.('input, select, textarea, button')) {
    if (e.key === 'ArrowLeft') setAim(S.aimOff - (e.shiftKey ? 5 : 1));
    else if (e.key === 'ArrowRight') setAim(S.aimOff + (e.shiftKey ? 5 : 1));
  }
}

/* ---------- boot ---------- */

async function boot() {
  const top = $('.masthead')?.offsetHeight || 66;
  document.documentElement.style.setProperty('--gm-top', `${top}px`);
  const res = await fetch('/data/flightguide.json?v=1');
  DATA = await res.json();
  for (const r of DATA.discs) DISCS.set(r[0], { id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] });

  new ResizeObserver(resize).observe($('#gm-stage'));
  resize();

  const p = panel();
  p.addEventListener('click', onPanelClick);
  p.addEventListener('change', onPanelChange);
  p.addEventListener('input', onPanelInput);
  // the meter answers the moment a finger lands, not when it lifts
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-tap], .gm-bar') && ['power', 'release', 'putt'].includes(S.phase)) { e.preventDefault(); tap(); } });
  p.addEventListener('keydown', (e) => { if (e.target.matches('[data-tap]') && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture?.(e.pointerId); setAimFromPointer(e); });
  cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setAimFromPointer(e); });

  onAccountChange(() => {
    if (!S.round) return;
    S.bag = buildBag();
    if (!S.bag.discs.some((x) => x.disc.id === S.discId)) S.discId = suggest();
    if (S.phase === 'pick') renderPanel();
  });
  await loadAccount();
  startRound();
  window.__gm = { S, G, clock, tap, throwDisc, startMeter, next, retarget, cam, DISCS, startRound, startBear, finishThrow };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const p = panel();
  if (p) p.innerHTML = `<div class="gm-card"><h2 class="is-bad">Couldn't load</h2><p>${esc(err.message)}</p></div>`;
});
