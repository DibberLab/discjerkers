/* The game: bring your bag, pick a disc, set your flight, then time the throw.
   The rules are in gamecore.js (and the flight in flightmodel.js, shared with the flight guide); this file is what you
   see and touch: the hole drawn from above, the panel, the throw meter, the animation, and Marebear. */

import { account, activeBag, loadAccount, onAccountChange, openSignIn, photoUrl, setActive } from './fgaccount.js?v=3';
import { clamp, tierName, angleName } from './flightmodel.js?v=1';
import { HOLES, holeById, holesFor } from './course.js?v=8';
import * as G from './gamecore.js?v=19';
import * as T from './trash.js?v=3';
import * as C3 from './cam3d.js?v=7';
import * as PF from './puttfx.js?v=3';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const OPP_COLORS = ['#38c8e8', '#f0a030', '#c07cf0', '#f06292', '#5ad0a0', '#e8d84a', '#8aa4ff']; // one for each of up to seven other players
const hexRgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
const ft = (n) => `${nf.format(Math.round(n))} ft`;

/* ---------- the clock ---------- */
// one clock for everything that moves, so a test (or a hidden tab) can wind it forward
const clock = { offset: 0 };
const now = () => performance.now() + clock.offset;

/* ---------- discs and bags ---------- */

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
  mode: 'menu', // menu | solo | lobby | match
  mp: null, // the match being played (two to eight players): { id, view, me, es, shownSeq, queue, ... }
  others: [], // the other players on this hole, as I see them: [{ uid, name, color, lie, strokes, done, holed, trail }]
  quip: '', // Marebear's latest remark
  step: 'disc', // on a phone, which part of setting up the shot you are on: disc | grip | aim
  stepKey: '',
  dock: 0, // on a phone, how much of the bottom of the screen the controls cover
  bubbleKey: '',
  quipTo: '',
  lastQuip: '',
  boardOpen: null, // the scoreboard in a match: open or folded (null: open for a small group)
  lobby: { matches: [], msg: '', holes: 18, invite: '', code: '', busy: false },
  course: null, // the round being played: { length, holes, idx, card, eaten }
  phase: 'loading', // menu | lobby | pick | power | nose | angle | release | putt | swipe | flight | result | bear | done | summary | mwait | mturn | mhole | mdone
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
  zoom: 1,
};

function loadSettings() {
  // arm speed, nose and angle are not settings: each throw's meters set them (spin follows the arm speed)
  const base = { hand: 'right', style: 'backhand', mph: 56, spin: null, angle: 0, nose: 0 };
  try {
    const t = JSON.parse(localStorage.getItem('dj_game_throw')) || JSON.parse(localStorage.getItem('dj_fg_throw')) || {};
    if (['right', 'left'].includes(t.hand)) base.hand = t.hand;
    if (['backhand', 'forehand'].includes(t.style)) base.style = t.style;
  } catch { /* defaults */ }
  return base;
}
function saveSettings() {
  try { localStorage.setItem('dj_game_throw', JSON.stringify({ hand: S.settings.hand, style: S.settings.style })); } catch { /* not saved */ }
}
const bestKey = () => (S.course && S.course.length > 1 ? `dj_game_best_${S.course.length}` : `dj_game_best_h${S.hole.id}`);
const parTotal = (holes) => holes.reduce((n, h) => n + h.par, 0);
const vsPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

const METER = ['power', 'nose', 'angle', 'release', 'putt']; // the phases that wait for a tap
const isMeter = () => METER.includes(S.phase);
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

// a new hole: a fresh round of it, with the discs Marebear has already eaten staying eaten
function startHole() {
  S.quip = '';
  S.round = G.newRound(S.hole);
  S.round.eaten = [...(S.course?.eaten || [])];
  S.trail = [];
  S.fx = [];
  S.bear = null;
  S.last = null;
  S.anim = null;
  S.meter = null;
  S.aimOff = 0;
  S.bag = buildBag();
  S.discId = suggest();
  try { S.best = Number(localStorage.getItem(bestKey())) || null; } catch { S.best = null; }
  if (!S.discId) { finishCourse(); return; }
  setPhase('pick');
  retarget(true);
  if (S.course.holes.length > 1) toast(`Hole ${S.hole.id}: ${S.hole.name}`, '', 1700);
}

// a round: one practice hole, the front nine, or all eighteen
function startSolo(length, practiceId) {
  const holes = length === 1 ? [holeById(practiceId) || HOLES[0]] : holesFor(length);
  S.mode = 'solo';
  S.course = { length, holes, idx: 0, card: [], eaten: [] };
  S.hole = holes[0];
  startHole();
}

function showMenu() {
  resetStage();
  S.mode = 'menu';
  setPhase('menu');
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
  if (S.mode === 'match') return '';
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

function pickInfo(d, plan, putting) { // plan: { wind }
  const brand = DATA.brands[d.b].n;
  const nums = `${d.speed} / ${d.glide} / ${d.turn > 0 ? `+${d.turn}` : d.turn} / ${d.fade}`;
  const out = putting
    ? `${Math.round(G.puttRadius(toBasket(), d) * 100)}%<small>target size</small>`
    : plan.wind.mph ? `${Math.round(plan.wind.mph)} mph<small>${plan.wind.head > 1 ? 'headwind' : plan.wind.head < -1 ? 'tailwind' : 'crosswind'}</small>` : 'Calm<small>no wind</small>';
  return `<div class="gm-pick"><b>${esc(d.name)}</b><output>${out}</output><small>${esc(brand)} · ${nums}</small></div>`;
}

function rangeRow({ key, label, text, value, min, max, step, aria = label, dec = '−', inc = '+' }) {
  return `<div class="fg-rng" role="group" aria-label="${esc(label)}">
      <div class="fg-rng__top"><span class="fg-wind__l">${esc(label)}</span><output aria-live="polite">${text}</output></div>
      <div class="fg-rng__bar fg-mph">
        <button type="button" data-gstep="${key}" data-dir="-1" aria-label="Less ${esc(aria)}"${value <= min ? ' disabled' : ''}>${dec}</button>
        <input type="range" data-gr="${key}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${esc(aria)}">
        <button type="button" data-gstep="${key}" data-dir="1" aria-label="More ${esc(aria)}"${value >= max ? ' disabled' : ''}>${inc}</button>
      </div>
    </div>`;
}

const AIM_MAX = 180; // some holes turn away from the basket, so you can aim any way at all
const aimText = (off) => (off === 0 ? 'At the basket' : Math.abs(off) === 180 ? 'Straight back' : `${Math.abs(off)}° ${off > 0 ? 'right' : 'left'}${Math.abs(off) > 90 ? ' (backwards)' : ''}`);

function gripChips() {
  const t = S.settings;
  const chip = (key, val, label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${t[key] === val}">${label}</button>`;
  return `<div class="fg-throw" role="group" aria-label="How you throw">
        <div class="fg-seg">${chip('hand', 'right', 'Right')}${chip('hand', 'left', 'Left')}</div>
        <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
      </div>`;
}
const aimRow = () => rangeRow({ key: 'aim', label: 'Aim', text: aimText(S.aimOff), value: S.aimOff, min: -AIM_MAX, max: AIM_MAX, step: 1, aria: 'aim', dec: '‹', inc: '›' });

function settingsBlock() {
  return `<div class="gm-block gm-settings">
      <p class="gm-h">Your throw <span>· hand and aim</span></p>
      ${gripChips()}
      ${aimRow()}
      <p class="gm-note">The dotted line is a typical throw with this disc; the shaded band is where a mistimed release can land. Your meters decide the real one.</p>
    </div>`;
}

const tipSeen = () => { try { return localStorage.getItem('dj_game_tip') === '1'; } catch { return false; } };
const tipHtml = () => (tipSeen() ? '' : `<div class="gm-tip"><p><b>How to play:</b> pick a disc, choose forehand or backhand, and aim (drag on the hole). Then <b>Throw</b> and tap four times: where you stop the power, nose and angle bars is your arm speed, how high the nose is tipped and your hyzer; the last tap is the release. A slow arm can grip lock or let go early, so watch the slip percentage. Trees stop low throws, water costs a stroke, and a triple bogey draws Marebear.</p><button type="button" data-tip-close aria-label="Got it">×</button></div>`);

// Marebear's remark, in a card of its own under whatever it is about
function say(r) {
  const text = typeof r === 'string' ? r : r?.text || '';
  S.quip = text;
  S.quipTo = (typeof r === 'object' && r?.to) || '';
  if (text) S.lastQuip = text;
}
const phoneQuery = window.matchMedia('(max-width: 900px)');
const isPhone = () => phoneQuery.matches;
const quipHtml = () => (S.quip && !isPhone() ? `<p class="gm-quip">“${esc(S.quip)}”<small>Marebear${S.quipTo ? ` to ${esc(S.quipTo)}` : ''}</small></p>` : '');

/* ----- a phone: the hole fills the screen and the shot is set up a step at a time along the bottom ----- */

// how much of the screen the controls cover, so the camera frames the hole in what is left
function measureDock() {
  const d = isPhone() ? Math.round(panel().getBoundingClientRect().height) : 0;
  if (d === S.dock) return;
  S.dock = d;
  $('#gm-stage').style.setProperty('--dock', `${d}px`);
  if (S.round) retarget(false);
}

// the caddy's note and Marebear's remarks float over the hole on a phone, and fade
function updateBubble() {
  const b = $('#gm-bubble');
  if (!b) return;
  let html = '';
  let key = '';
  if (isPhone() && !isMeter() && S.round) {
    if (S.phase === 'pick' && S.round.strokes === 0 && S.hole.note) { key = `c${S.hole.id}`; html = `<b>${esc(S.hole.name)}.</b> ${esc(S.hole.note)}`; }
    else if (S.quip) { key = `q${S.quip}`; html = `“${esc(S.quip)}”<small>Marebear${S.quipTo ? ` to ${esc(S.quipTo)}` : ''}</small>`; }
  }
  if (key === S.bubbleKey) return;
  S.bubbleKey = key;
  b.classList.remove('is-on');
  b.innerHTML = html;
  if (html) { void b.offsetWidth; b.classList.add('is-on'); }
}

function panelPickPhone() {
  const d = curDisc();
  if (!d) return panelNoDiscs();
  const putting = inPutt();
  const key = `${S.mode}:${S.hole.id}:${S.round.strokes}`;
  if (S.stepKey !== key) { S.stepKey = key; S.step = 'disc'; } // each throw starts with the disc
  const steps = putting ? ['disc'] : ['disc', 'grip', 'aim'];
  if (!steps.includes(S.step)) S.step = steps[0];
  const names = { disc: 'Disc', grip: 'Grip', aim: 'Aim' };
  const i = steps.indexOf(S.step);
  const tabs = steps.length > 1
    ? `<div class="gm-tabs" role="tablist" aria-label="Set up the shot">${steps.map((k, n) => `<button class="gm-tab" type="button" role="tab" data-step="${k}" aria-selected="${k === S.step}"><b>${n + 1}</b>${names[k]}</button>`).join('')}</div>`
    : `<p class="gm-h">Putt <span>· ${ft(toBasket())} out</span></p>`;
  const leave = S.mode === 'match' ? '<button class="chip" type="button" data-mp-leave>Forfeit</button>' : '<button class="chip" type="button" data-quit>Quit</button>';
  let body;
  if (S.step === 'disc') {
    body = `${bagBar()}${discRow()}${pickInfo(d, { wind: G.windFor(S.hole, heading()) }, putting)}${putting && toBasket() > G.LONG_PUTT ? '<p class="gm-note">Past 30 feet the target is a pinprick.</p>' : ''}`;
  } else if (S.step === 'grip') {
    body = `${gripChips()}<p class="gm-note">Backhand or forehand, and which hand. The flight bends the other way for a lefty.</p>`;
  } else {
    body = `${aimRow()}<p class="gm-note">Drag on the hole to aim, or use the slider. The dotted line is a typical throw; the band is where a mistimed release can land.</p>`;
  }
  const last = i === steps.length - 1;
  const go = last ? `<button class="btn" type="button" data-go>${putting ? 'Putt' : 'Throw'}</button>` : `<button class="btn" type="button" data-next-step>${names[steps[i + 1]]} <small>next</small></button>`;
  return `<div class="gm-dock">
      <div class="gm-dock__top">${tabs}${leave}</div>
      ${S.mode === 'match' ? boardHtml() : ''}
      <div class="gm-dock__body">${body}</div>
      <div class="gm-dock__go">${go}</div>
    </div>`;
}

function panelPick() {
  if (isPhone()) return panelPickPhone();
  const d = curDisc();
  if (!d) return panelNoDiscs();
  const putting = inPutt();
  const plan = { wind: G.windFor(S.hole, heading()) };
  const dist = toBasket();
  const strokes = S.round.strokes;
  const caddy = S.round.strokes === 0 && S.hole.note ? `<p class="gm-caddy"><b>${esc(S.hole.name)}.</b> ${esc(S.hole.note)}</p>` : '';
  return `${roundBar()}${caddy || quipHtml()}${S.mode === 'match' ? boardHtml() : tipHtml()}${bagBar()}
    <div class="gm-block">
      <p class="gm-h">Your disc <span>· ${available().length} left in the bag</span></p>
      ${discRow()}
      ${pickInfo(d, plan, putting)}
    </div>
    ${putting
      ? `<p class="gm-sub"><b>${ft(dist)}</b> from the basket. One tap: catch the dot inside the green circle as it swirls past. Short putts get a big target and a slow dot; a faster disc shrinks it.${dist > G.LONG_PUTT ? ' <b>Past 30 feet it is a long shot: the target is a pinprick and the dot flies.</b>' : ''}</p>`
      : settingsBlock()}
    <div class="gm-go">
      <button class="btn" type="button" data-go>${putting ? 'Putt' : 'Throw'}</button>
      <p class="gm-go__line">Stroke <b>${strokes + 1}</b> · Par <b>${S.hole.par}</b> · ${putting ? `${ft(dist)} out` : `${ft(dist)} to the basket`}</p>
    </div>`;
}

function panelMenu() {
  const options = HOLES.map((h) => `<option value="${h.id}"${h.id === S.hole.id ? ' selected' : ''}>${h.id}. ${esc(h.name)} · par ${h.par}</option>`).join('');
  return `${bagBar()}
    <div class="gm-card">
      <h2>Play the course</h2>
      <p>Eighteen holes of woods, water and wind. Pick a round, bring your bag, and try not to triple bogey: Marebear is watching.</p>
      <div class="gm-menu">
        <button class="btn" type="button" data-solo="9">Front 9<small>par ${parTotal(HOLES.slice(0, 9))}</small></button>
        <button class="btn" type="button" data-solo="18">Full 18<small>par ${parTotal(HOLES)}</small></button>
      </div>
      <button class="btn btn--ghost" type="button" data-versus>Play with friends <small>up to 8 players, turn by turn</small></button>
      <div class="gm-row">
        <label class="gm-practice"><span class="fg-wind__l">Practice a hole</span><select data-practice aria-label="Which hole">${options}</select></label>
        <button class="chip" type="button" data-solo="1">Play it</button>
      </div>
    </div>`;
}

// where you are in the round, and a way out
function roundBar() {
  if (S.mode === 'match' && S.mp) {
    const v = S.mp.view;
    const others = v.players.filter((p) => p.uid !== S.mp.me && !p.left);
    const who = others.length === 1 ? `vs <b>${esc(others[0].name)}</b>` : others.length ? `<b>${others.length + 1}</b> players` : 'Match';
    return `<div class="gm-roundbar"><span>${who} · hole <b>${v.holeIdx + 1}</b> of ${v.holes}</span><button class="chip" type="button" data-mp-leave>Forfeit</button></div>`;
  }
  const c = S.course;
  if (!c) return '';
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const par = c.card.reduce((n, h) => n + h.par, 0);
  const left = c.length > 1
    ? `<span>Hole <b>${c.idx + 1}</b> of ${c.holes.length}${c.card.length ? ` · ${vsPar(total - par)} after ${c.card.length}` : ''}</span>`
    : '<span>Practice hole</span>';
  return `<div class="gm-roundbar">${left}<button class="chip" type="button" data-quit>Quit</button></div>`;
}

function panelNoDiscs() {
  return `<div class="gm-card"><h2 class="is-bad">No discs left</h2><p>Marebear ate your whole bag. Round over.</p><button class="btn" type="button" data-again>Play again</button></div>`;
}

// a slider with a green zone in the middle, for the stages that read "how far off the middle were you"
function centeredBar(w, left, right) {
  return `<output class="gm-read" aria-hidden="true"><b>&nbsp;</b></output>
    <div class="gm-bar" id="gm-bar"><i class="gm-zone" style="left:${(0.5 - w / 2) * 100}%;width:${w * 100}%"></i><b class="gm-mark" id="gm-mark" style="left:0%"></b></div>
    <div class="gm-ends"><span>${left}</span><span>${right}</span></div>`;
}

const METER_STAGES = ['power', 'nose', 'angle', 'release'];

// a bar with a marker that sweeps; power, nose and angle read out the value under the marker as it goes
function sweetMarkup(kind) {
  return (S.meter.sweet?.[kind] || []).map((b) => `<i class="gm-zone gm-zone--sweet" style="left:${b.from * 100}%;width:${Math.max(b.to - b.from, 0.008) * 100}%"></i>`).join('');
}

function valueBar(kind, left, right, tick) {
  const hard = kind === 'power' ? `<i class="gm-hard" style="left:${G.POWER_KNEE * 100}%"></i>` : ''; // the fast end of the power bar
  return `<output class="gm-read" id="gm-read" aria-live="off"><b>&nbsp;</b></output>
    <div class="gm-bar" id="gm-bar">${sweetMarkup(kind)}${hard}${tick == null ? '' : `<i class="gm-tick" style="left:${tick * 100}%"></i>`}<b class="gm-mark" id="gm-mark" style="left:0%"></b></div>
    <div class="gm-ends"><span>${left}</span><span>${right}</span></div>`;
}

function barMarkup(kind) {
  const m = S.meter;
  if (kind === 'power') return valueBar(kind, 'Easy', 'Full send');
  if (kind === 'putt') return '<canvas class="gm-putt" id="gm-putt" aria-label="The green: tap when the dot is inside the green circle"></canvas>';
  if (kind === 'nose') return valueBar(kind, 'Nose down', 'Nose up', 0.5);
  if (kind === 'angle') return valueBar(kind, 'Anhyzer', 'Hyzer', 0.5);
  return centeredBar(m.rel.w, 'Early', 'Late');
}

const releaseHint = (risk) => `Tap when the needle crosses the middle. Early goes toward the turn side, late toward the fade side.${risk ? ` <b>${risk}% chance the disc slips</b>: a slow arm can grip lock or let go early.` : ''}`;

function panelMeter() {
  const kind = S.phase;
  const d = curDisc();
  const stages = kind === 'putt' ? [] : METER_STAGES;
  const n = stages.indexOf(kind) + 1;
  const names = { power: 'Power', nose: 'Nose', angle: 'Angle', release: 'Release', putt: 'Putt' };
  const risk = kind === 'release' && d ? Math.round(G.slipChance(d, S.settings) * 100) : 0;
  const title = kind === 'putt' ? 'Putt' : `<span>${n} ·</span> ${names[kind]}`;
  const hints = {
    power: 'Tap to set your arm speed. The lime band is the sweet spot: the speeds that put this disc closest to the basket from here. Past the hatched end the marker flies, and fast arms are harder to time.',
    nose: 'Tap to set the nose angle. The lime band is the sweet spot for the speed you chose; the white tick is level. Nose up lifts the disc (over a shrub or a low tree) but spends distance; nose down keeps it low and flat, and shorter.',
    angle: 'Tap to set the release angle. The lime band is the sweet spot for your speed and nose angle. The middle is flat; right tips it onto hyzer, left onto anhyzer.',
    release: releaseHint(risk),
    putt: `Tap when the dot is in the green circle; a miss goes the way the dot was.${toBasket() > G.LONG_PUTT ? ' Past 30 ft the target is a pinprick.' : ''} ${d ? esc(d.name) : ''}, ${ft(toBasket())}.`,
  };
  const hint = `<div class="gm-meter__h">${Object.entries(hints).filter(([k]) => (k === 'putt') === (kind === 'putt')).map(([k, h]) => `<p${k === kind ? '' : ' aria-hidden="true"'}${k === kind ? '' : ' class="is-off"'}>${h}</p>`).join('')}<p class="is-off" aria-hidden="true">${releaseHint(40)}</p></div>`;
  // a putt shows the whole green and the Tap button first; its hint waits underneath, where it cannot cover anything
  if (kind === 'putt') {
    return `<div class="gm-meter gm-meter--putt">
      <p class="gm-meter__t">${title}</p>
      ${barMarkup(kind)}
      <button class="gm-tap" type="button" data-tap>Tap</button>
      ${hint}
    </div>`;
  }
  return `<div class="gm-meter">
      ${stages.length ? `<div class="gm-steps" aria-hidden="true">${stages.map((_, i) => `<i class="${i < n ? 'is-on' : ''}"></i>`).join('')}</div>` : ''}
      <p class="gm-meter__t">${title}</p>
      ${hint}
      ${barMarkup(kind)}
      <button class="gm-tap" type="button" data-tap>Tap</button>
    </div>`;
}

const panelFlight = () => `<div class="gm-card"><h2>${esc(S.last?.ex?.grade ?? '')}</h2><p>${S.last?.ex ? describeExecution(S.last.ex) : 'Here it goes…'}</p></div>`;

function describeExecution(ex) {
  const sw = ex.swipe ? ` ${ex.swipeSpeed < 0.97 ? 'The swipe was too soft.' : ex.swipe.power > 1 + G.DRIVE_SWIPE.power ? 'The swipe was too hard.' : ''}${Math.abs(ex.swipeAim || 0) > 1 ? ` The swipe pulled it ${ex.swipeAim < 0 ? 'left' : 'right'}.` : ''}` : '';
  return `${describeRelease(ex)}${sw}`.trim();
}
function describeRelease(ex) {
  if (ex.slip === 'grip') return 'The disc stuck to your fingers and came out late and short.';
  if (ex.slip === 'early') return 'The disc slipped out of your hand early.';
  return ex.o < -0.08 ? 'Released early.' : ex.o > 0.08 ? 'Released late.' : 'Released on time.';
}

function surfaceName(s) {
  return { fairway: 'On the fairway', rough: 'In the rough', tee: 'Back at the tee', water: 'In the water', oob: 'Out of bounds' }[s] || 'Down';
}

function resultCopy(r) {
  const dist = toBasket();
  if (r.kind === 'water' || r.kind === 'oob') {
    return { h: r.kind === 'water' ? 'Splash!' : 'Out of bounds', tone: 'bad', p: 'That is a penalty stroke. You throw again from the same spot.' };
  }
  if (r.kind === 'tree') return { h: 'Thunk!', tone: 'bad', p: `It hit a tree and kicked out beside it. ${ft(dist)} to the basket.` };
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
      ${quipHtml()}
      ${ex ? `<p>${ex.slip ? esc(ex.grade) : `${esc(ex.grade)} throw`}: ${describeExecution(ex)}</p>` : ''}
      <button class="btn" type="button" data-next>Next throw</button>
    </div>`;
}

function panelBear() {
  const disc = DISCS.get(S.bear.discId);
  if (S.bear.owner !== 'me') {
    const name = S.mp?.view.players.find((p) => p.uid === S.bear.owner)?.name || 'They';
    return `<div class="gm-card"><h2 class="is-bad">Marebear!</h2><p>${esc(name)} is at a triple bogey, and Marebear smelled it. She is eating their ${esc(splitName(disc.name))}.</p></div>`;
  }
  return `<div class="gm-card"><h2 class="is-bad">Marebear!</h2><p>Triple bogey, and Marebear smelled it. She is eating your ${esc(splitName(disc.name))}.</p></div>`;
}

function panelDone() {
  const r = S.round;
  const c = S.course;
  const diff = r.strokes - S.hole.par;
  const entry = c.card.at(-1);
  const name = r.holed ? G.scoreName(r.strokes, S.hole.par) : 'No discs left';
  const lastHole = c.idx >= c.holes.length - 1 || !available().length;
  const next = c.holes[c.idx + 1];
  const log = r.throws.map((t, i) => {
    const d = DISCS.get(t.disc);
    return `<li><b>${i + 1}</b> · ${esc(splitName(d.name))} · ${t.kind === 'basket' ? 'in the basket' : t.kind === 'water' || t.kind === 'oob' ? 'out of bounds (+1)' : t.kind === 'tree' ? 'hit a tree' : `${ft(t.feet)}`}</li>`;
  }).join('');
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const par = c.card.reduce((n, h) => n + h.par, 0);
  return `<div class="gm-card">
      <h2 class="${r.holed && diff <= 0 ? 'is-good' : 'is-bad'}">${name}</h2>
      ${quipHtml()}
      <div class="gm-score"><div><b>${r.holed ? r.strokes : entry.score}</b><span>${r.holed ? 'Strokes' : 'Scored'}</span></div><div><b>${S.hole.par}</b><span>Par</span></div><div><b>${vsPar(entry.score - S.hole.par)}</b><span>To par</span></div></div>
      ${c.length > 1 ? `<p>Round so far: <b>${total}</b> (${vsPar(total - par)}) after ${c.card.length} ${c.card.length === 1 ? 'hole' : 'holes'}.</p>` : (S.best ? `<p>Best on this hole: <b>${S.best}</b></p>` : '')}
      <ol class="gm-log">${log}</ol>
      ${r.eaten.length ? `<p>Marebear has eaten ${r.eaten.map((id) => esc(splitName(DISCS.get(id).name))).join(', ')}. She does not give them back.</p>` : ''}
      ${lastHole
        ? `<button class="btn" type="button" data-summary>${c.length > 1 ? 'See the scorecard' : 'Finish'}</button>`
        : `<button class="btn" type="button" data-next-hole>Next: hole ${next.id}, ${esc(next.name)} <small>par ${next.par}</small></button>`}
    </div>`;
}

// the whole round on one card
function panelSummary() {
  const c = S.course;
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const par = c.card.reduce((n, h) => n + h.par, 0);
  const rows = c.card.map((h) => `<li class="${h.score < h.par ? 'is-under' : h.score > h.par ? 'is-over' : ''}"><span>${h.id}. ${esc(HOLES[h.id - 1].name)}</span><span>par ${h.par}</span><b>${h.holed ? h.strokes : `${h.score}*`}</b></li>`).join('');
  const unfinished = c.card.some((h) => !h.holed) || c.card.length < c.holes.length;
  const best = S.best;
  return `<div class="gm-card">
      <h2 class="${total <= par ? 'is-good' : 'is-bad'}">${c.length === 1 ? 'Hole done' : c.length === 9 ? 'Front nine' : 'Round complete'}</h2>
      <div class="gm-score"><div><b>${total}</b><span>Strokes</span></div><div><b>${par}</b><span>Par</span></div><div><b>${vsPar(total - par)}</b><span>To par</span></div></div>
      ${best ? `<p>Best ${c.length === 1 ? 'on this hole' : `${c.length}-hole round`}: <b>${best}</b>${!unfinished && total <= best ? ' (that is you, right now)' : ''}</p>` : ''}
      <ol class="gm-card-list">${rows}</ol>
      ${unfinished ? '<p>* Marebear ate your bag, so the rest of the round does not count for much.</p>' : ''}
      <button class="btn" type="button" data-again>Play it again</button>
      <button class="btn btn--ghost" type="button" data-menu>Back to the menu</button>
    </div>`;
}

function renderPanel(focusSel) {
  const p = panel();
  if (!p) return;
  const keepScroll = p.dataset.phase === S.phase ? p.scrollTop : 0;
  const views = { menu: panelMenu, pick: panelPick, power: panelMeter, nose: panelMeter, angle: panelMeter, release: panelMeter, putt: panelMeter, swipe: panelSwipe, flight: panelFlight, result: panelResult, bear: panelBear, done: panelDone, summary: panelSummary, lobby: panelLobby, mwait: panelMwait, mturn: panelMturn, mhole: panelMhole, mdone: panelMdone };
  p.innerHTML = (views[S.phase] || (() => ''))();
  p.dataset.phase = S.phase;
  p.scrollTop = keepScroll;
  updateBubble();
  measureDock();
  if (focusSel) $(focusSel, p)?.focus({ preventScroll: true });
  else if (isMeter()) $('[data-tap]', p)?.focus({ preventScroll: true });
}

/* ---------- the HUD ---------- */

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function updateHud() {
  const h = S.hole;
  const r = S.round;
  if (!r) return;
  const c = S.course;
  if (S.mode === 'match' && S.mp && S.mp.view.round) {
    const v = S.mp.view;
    const up = v.players.find((p) => p.uid === v.round.turn);
    const turn = v.status !== 'active' || !up ? '' : up.uid === S.mp.me ? 'Your throw' : `${esc(up.name)}'s throw`;
    const rivals = S.others.length === 1 ? ` · ${esc(S.others[0].name)} <b>${S.others[0].strokes}</b>` : '';
    $('#gm-hud').innerHTML = `<span>Hole ${v.holeIdx + 1}/${v.holes} · ${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small><span>You <b>${r.strokes}</b>${rivals}</span><small>${turn}${turn ? ' · ' : ''}${ft(G.distance(r.lie, h.basket))} to the basket</small>`;
  } else if (!c && S.phase === 'menu' && h.id !== HOLES[0].id) { // the menu is previewing the hole picked for practice
    $('#gm-hud').innerHTML = `<span>${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small>`;
  } else if (!c) {
    $('#gm-hud').innerHTML = '<span>Disc Jerkers Golf Club</span><small>Eighteen holes · par 69</small>';
  } else {
    const total = c.card.reduce((n, x) => n + x.score, 0);
    const par = c.card.reduce((n, x) => n + x.par, 0);
    $('#gm-hud').innerHTML = `<span>${c.length > 1 ? `Hole ${c.idx + 1}/${c.holes.length} · ` : ''}${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small><span>Strokes <b>${r.strokes}</b>${c.length > 1 && c.card.length ? ` · Round ${vsPar(total - par)}` : ''}</span><small>${ft(G.distance(r.lie, h.basket))} to the basket</small>`;
  }
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
    S.meter = { kind: 'putt', start: now(), radius: G.puttRadius(toBasket(), d), speed: G.puttSpeed(toBasket()), params: G.makePuttSeed(Math.random) };
    setPhase('putt');
  } else {
    // four taps: power, nose and angle each choose a value of the throw, then the release is graded
    S.meter = { kind: 'power', start: now(), mph: null, rel: null, sweet: {} };
    sweetFor('power');
    setPhase('power');
  }
}

// where a bar's sweet spot is, given what the earlier bars set: worked out as a bar begins, then drawn on it
function sweetFor(stage) {
  const d = curDisc();
  if (!d || !S.meter) return;
  const base = { hand: S.settings.hand, style: S.settings.style, mph: S.settings.mph, spin: null, nose: stage === 'angle' ? S.settings.nose : 0, angle: 0 };
  S.meter.sweet[stage] = G.sweetBands(G.sweetSpots(S.hole, d, base, heading(), lieOf(), stage));
}

function tap() {
  const m = S.meter;
  if (!m) return;
  const t = (now() - m.start) / 1000;
  const next = (phase) => { m.start = now(); setPhase(phase); };
  if (S.phase === 'power') {
    m.mph = G.mphAt(G.powerAt(t));
    S.settings.mph = m.mph;
    m.rel = G.releaseSetup(m.mph);
    S.settings.spin = null; // the spin that goes with that arm speed
    sweetFor('nose');
    next('nose');
    toast(`${m.mph} mph`, '', 900);
  } else if (S.phase === 'nose') {
    S.settings.nose = G.noseAt(G.needleAt(t, G.METER.nose.period));
    sweetFor('angle');
    next('angle');
    toast(G.noseName(S.settings.nose), '', 900);
  } else if (S.phase === 'angle') {
    S.settings.angle = G.angleAt(G.needleAt(t, G.METER.angle.period));
    next('release');
    toast(angleName(S.settings), '', 900);
  } else if (S.phase === 'release') {
    startSwipe(null, G.combine(G.readRelease(G.releaseAt(t, m.rel), m.rel.w))); // the release is timed; the swipe is the throw itself
  } else if (S.phase === 'putt') {
    const shot = G.puttCursorAt(m.params, t, m.speed);
    if (toBasket() <= G.GIMME) puttDisc(shot, null); // a tap-in needs no swipe
    else startSwipe(shot); // the radar says where the putt wants to go; the swipe has to deliver it
  }
}

function throwDisc(ex) {
  try { localStorage.setItem('dj_game_tip', '1'); } catch { /* shown again */ }
  if (S.mode === 'match') { mpThrow(ex); return; }
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolveThrow(S.hole, disc, S.settings, heading(), ex, from);
  S.last = { result, ex, disc, from };
  const flightMs = camDur(clamp(900 + result.plan.feet * 4.2, 1200, 3300));
  S.anim = { type: 'flight', t0: now(), dur: flightMs, pts: result.pts, roll: result.roll, result };
  toast(ex.grade, ex.pure ? 'good' : ex.slip || ex.grade === 'Shank' ? 'bad' : '', 1300);
  setPhase('flight');
  retarget(false, result.pts);
}

function puttDisc(shot, swipe = null) {
  if (S.mode === 'match') { mpPutt(shot, swipe); return; }
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolvePutt(S.hole, from, disc, shot, Math.random(), swipe);
  S.last = { result, ex: null, disc, from };
  S.anim = puttAnim(from, result, result.lie, 'me');
  puttReaction(result, 'me');
  setPhase('flight');
  retarget(false, S.anim.pts);
}

// The film of a putt: where the disc goes and what happens around it (puttfx.js), for the 3D view; the map gets a short version of
// the same flight. `result` is what the rules said: { made, finish, rim, nasty, dist, ... }.
function puttAnim(from, result, lie, who) {
  const script = PF.puttScript({ from, basket: S.hole.basket, lie, result });
  const to = result.made ? S.hole.basket : lie;
  const pts = Array.from({ length: 21 }, (_, i) => {
    const s = i / 20;
    return { x: from.x + (to.x - from.x) * s, y: from.y + (to.y - from.y) * s, h: 3 + 5 * 4 * s * (1 - s), s };
  });
  const film = watching3D(who);
  return { type: 'flight', t0: now(), dur: film ? script.total : 750, pts, roll: [], result, putt: true, script, tail: film ? script.tail : 350 };
}

/* ----- the swipe: after the radar, a flick toward the basket. True in aim and in power, or it misses. ----- */

// how far a swipe must run, in pixels, to be exactly enough: longer for a longer putt
const swipeNeed = () => (H - S.dock) * (S.meter?.throwEx ? 0.3 + 0.0042 * S.settings.mph : 0.22 + 0.0065 * toBasket()); // a drive: harder arm, longer swipe
const swipeTol = () => (S.meter?.throwEx ? G.DRIVE_SWIPE : G.swipeTolerance(toBasket()));

function startSwipe(shot = null, throwEx = null) {
  S.meter = { kind: 'swipe', shot, throwEx, drag: null };
  setPhase('swipe');
}
function panelSwipe() {
  const drive = !!S.meter?.throwEx;
  return `<div class="gm-meter ${drive ? '' : 'gm-meter--putt'}">
      <p class="gm-meter__t"><span>${drive ? 5 : 2} ·</span> Swipe</p>
      <div class="gm-meter__h"><p>${drive
    ? 'Flick up the screen to throw. Stay inside the lime lines and stop in the lime band: off line steers the throw, too soft loses distance, too hard makes it loose.'
    : 'Flick from the disc toward the basket. Keep it straight inside the lime lines, and stop inside the lime band: too soft dies short, too hard runs long, and off line misses.'}</p></div>
    </div>`;
}
function swipePoint(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function beginSwipe(e) {
  const p = swipePoint(e);
  S.meter.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y };
  cv.setPointerCapture?.(e.pointerId);
}
function moveSwipe(e) {
  const d = S.meter?.drag;
  if (!d) return;
  const p = swipePoint(e);
  d.x = p.x;
  d.y = p.y;
}
function endSwipe() {
  const m = S.meter;
  const d = m?.drag;
  if (S.phase !== 'swipe' || !d) return;
  m.drag = null;
  const dx = d.x - d.x0;
  const dy = d.y - d.y0;
  const len = Math.hypot(dx, dy);
  if (len < 28) return; // a tap, not a swipe: try again
  const swipe = { aim: Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) * 10) / 10, power: Math.round((len / swipeNeed()) * 1000) / 1000 };
  if (m.throwEx) {
    const ex = G.withSwipe(m.throwEx, swipe);
    // solo rolls the slip here; in a match the server does, and the throw comes back with it
    throwDisc(S.mode === 'match' ? ex : G.applySlip(ex, G.rollSlip(curDisc(), S.settings, Math.random())));
  } else {
    puttDisc(m.shot, swipe);
  }
}

// the guide you swipe by: the cone to stay inside, the band to stop in, and your own line as you draw it
function drawSwipeGuide() {
  const m = S.meter;
  if (!m || m.kind !== 'swipe') return;
  const need = swipeNeed();
  const tol = swipeTol();
  const d = m.drag;
  const ax = d ? d.x0 : W / 2;
  const ay = d ? d.y0 : (H - S.dock) * 0.88;
  const rad = (deg) => (deg * Math.PI) / 180;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  // the band to stop in, between the two rays
  ctx.beginPath();
  ctx.arc(ax, ay, need * (1 + tol.power), -Math.PI / 2 - rad(tol.aim), -Math.PI / 2 + rad(tol.aim));
  ctx.arc(ax, ay, need * (1 - tol.power), -Math.PI / 2 + rad(tol.aim), -Math.PI / 2 - rad(tol.aim), true);
  ctx.closePath();
  ctx.fillStyle = 'rgba(163,230,53,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(163,230,53,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // the rays you must stay between
  ctx.setLineDash([8, 7]);
  for (const sgn of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + Math.sin(rad(tol.aim * sgn)) * need * 1.15, ay - Math.cos(rad(tol.aim * sgn)) * need * 1.15);
    ctx.strokeStyle = 'rgba(163,230,53,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!d) { // waiting: chevrons pulsing up the way to swipe
    const pulse = (performance.now() / 700) % 1;
    for (let i = 0; i < 3; i++) {
      const y = ay - 14 - ((i + pulse) % 3) * 22;
      ctx.beginPath();
      ctx.moveTo(ax - 12, y + 7);
      ctx.lineTo(ax, y - 5);
      ctx.lineTo(ax + 12, y + 7);
      ctx.strokeStyle = `rgba(238,241,232,${0.9 - ((i + pulse) % 3) * 0.28})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.font = '400 26px "Anton", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eef1e8';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 5;
    const word = m.throwEx ? 'SWIPE UP TO THROW' : 'SWIPE UP TO PUTT';
    ctx.strokeText(word, ax, ay + 34);
    ctx.fillText(word, ax, ay + 34);
  } else { // your line, coloured by how true it is right now
    const dx = d.x - d.x0;
    const dy = d.y - d.y0;
    const len = Math.hypot(dx, dy);
    const aim = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const q = Math.max(Math.abs(aim) / tol.aim, Math.abs(len / need - 1) / tol.power);
    const color = q <= 1 ? '#a3e635' : q <= 1.5 ? '#f2c14e' : '#ff6a3a';
    ctx.beginPath();
    ctx.moveTo(d.x0, d.y0);
    ctx.lineTo(d.x, d.y);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(d.x, d.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(`${Math.round((len / need) * 100)}%`, d.x + 18, d.y + 5);
    ctx.fillText(`${Math.round((len / need) * 100)}%`, d.x + 18, d.y + 5);
  }
  ctx.restore();
}

// what the player feels when a putt lands: a toast on the map (the 3D view has its own big words), and a buzz
const PUTT_WORDS = { swish: ['CHAINS!', 'good'], rattle: ['RATTLED IN!', 'good'], tapin: ['Tap-in', 'good'], rim: ['RIMMED OUT', 'bad'], nasty: ['NASTY ROLL', 'bad'], miss: ['Missed', 'bad'] };
const WHY_WORDS = { weak: 'TOO SOFT', strong: 'TOO HARD', left: 'PULLED LEFT', right: 'PUSHED RIGHT' };
function puttReaction(result, who, name = '') {
  const [word0, tone] = PUTT_WORDS[result.finish] || (result.made ? ['Chains!', 'good'] : ['Missed', 'bad']);
  const word = result.finish === 'miss' && WHY_WORDS[result.why] ? WHY_WORDS[result.why] : word0;
  if (!(CAM.on && watching3D(who))) toast(`${name}${word}`, tone, 1500);
  else if (name) toast(`${name}${word}`, tone, 1200);
  if (who === 'me' && navigator.vibrate) navigator.vibrate(result.made ? [30, 40, 30, 60, 90] : result.nasty ? [90, 50, 90] : [140, 90, 300]);
}

function finishThrow() {
  if (S.mode === 'match') { finishMove(); return; }
  const { result, disc, from } = S.last;
  const out = G.applyResult(S.round, disc, result);
  say(T.remark(T.eventFor({ kind: result.kind, putt: !result.plan, made: result.made, gimme: result.gimme, ex: S.last.ex, strokes: S.round.strokes, dist: result.dist, surface: result.surface, rim: result.rim, nasty: result.nasty, why: result.why }), { who: 'me' }, Math.random, S.lastQuip));
  S.trail.push({ pts: [...result.pts ?? [], ...(result.roll ?? [])], kind: result.kind, n: S.round.throws.length, from });
  const at = result.end ?? result.lie;
  if (result.kind === 'water' || result.kind === 'oob') S.fx.push({ type: 'splash', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'tree') S.fx.push({ type: 'thunk', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'basket') S.fx.push({ type: 'chains', x: S.hole.basket.x, y: S.hole.basket.y, t0: now() });
  if (navigator.vibrate && ['tree', 'water', 'oob', 'basket'].includes(result.kind)) navigator.vibrate(result.kind === 'basket' ? [30, 40, 30] : 40);
  S.anim = null;
  S.aimOff = 0;

  if (result.kind === 'basket') {
    finishHole();
  } else if (out.bear) {
    startBear(out.bear);
  } else {
    setPhase('result');
    retarget(false);
  }
}

// the hole is over (holed out, or no discs left): put it on the card
function finishHole() {
  const r = S.round;
  const c = S.course;
  r.done = true;
  c.card.push({ id: S.hole.id, par: S.hole.par, strokes: r.strokes, score: G.holeScore(r.strokes, S.hole.par, r.holed), holed: r.holed });
  c.eaten = [...r.eaten];
  if (r.holed) toast(G.scoreName(r.strokes, S.hole.par), r.strokes <= S.hole.par ? 'good' : 'bad', 2400);
  say(T.holeRemark(r.strokes, S.hole.par, r.holed, Math.random, S.lastQuip));
  setPhase('done');
  retarget(false);
}

// the round is over: remember the best, and show the card
function finishCourse() {
  const c = S.course;
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const complete = c.card.length === c.holes.length && c.card.every((h) => h.holed);
  try {
    const prev = Number(localStorage.getItem(bestKey())) || null;
    if (complete && (!prev || total < prev)) localStorage.setItem(bestKey(), String(total));
    S.best = complete ? Math.min(prev || Infinity, total) : prev;
  } catch { S.best = null; }
  setPhase('summary');
  retarget(false);
}

function next() {
  if (S.round.done) { finishHole(); return; }
  S.discId = suggest(); // a driver from the tee, a putter on the green: you can change it
  S.aimOff = 0;
  setPhase('pick');
  retarget(false);
}

/* ---------- Marebear ---------- */

const BEAR_PARTS = { enter: 1700, chomp: 1300, burp: 900, leave: 1300 };
function startBear(info) {
  S.bear = { t0: now(), at: { ...info.at }, discId: info.discId, owner: info.owner || 'me' };
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
  if (S.mode === 'match') { S.bear = null; afterMove(); return; }
  const eatenLast = !available().length;
  S.bear = null;
  if (eatenLast) {
    S.round.holed = false;
    finishHole(); // no discs left: the hole is over, and so is the round
  } else {
    setPhase('result');
    retarget(false);
  }
}

/* ---------- the camera ---------- */

const cv = $('#gm-canvas');
const ctx = cv.getContext('2d');
let W = 0;
let H = 0;
let dpr = 1;
const cam = { x: 0, y: 200, s: 0.6, tx: 0, ty: 200, ts: 0.6 };
const ZOOM = { min: 1, max: 3.4, step: 1.45 };

// The 3D camera is on for everyone, with a 3D switch over the hole to turn it off (remembered). /game?cam=off or ?cam=3d set it too.
const CAM = { on: true };
function loadCam() {
  try {
    const q = new URLSearchParams(location.search).get('cam');
    if (q === '3d') localStorage.setItem('dj_cam', 'on');
    else if (q === 'off') localStorage.setItem('dj_cam', 'off');
    CAM.on = localStorage.getItem('dj_cam') !== 'off';
  } catch { /* on */ }
}
// whose throws are watched in 3D: yours, and in a match of two everybody's; in a bigger group the others' stay on the map so the game keeps moving
const watching3D = (who) => CAM.on && (!who || who === 'me' || !S.mp || S.mp.view.players.filter((p) => !p.left).length <= 2);
const camDur = (ms) => (CAM.on ? Math.round(ms * 1.45) : ms); // a flight you ride is worth a little longer

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
  const lie = S.mode === 'match' && S.phase === 'mturn' && upNow() ? upNow().lie : lieOf();
  const b = S.hole.basket;
  const putting = inPutt();
  const pts = [lie, b, ...extra.filter((_, i) => i % 6 === 0)];
  if (S.phase === 'pick' && !putting && curDisc()) pts.push(G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie, 12).end);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const pad = putting ? 16 : 26;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const w = Math.max(maxX - minX, putting ? 60 : 120);
  const h = Math.max(maxY - minY, putting ? 70 : 140);
  cam.tx = (minX + maxX) / 2;
  cam.ty = (minY + maxY) / 2;
  cam.ts = Math.min(W / w, (H - S.dock) / h);
  if (S.zoom > 1 && !extra.length) { // zoomed in: stay on the next shot, halfway between where you are and where you are aiming
    const aim = putting || S.phase !== 'pick' || !curDisc() ? b : G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie, 12).end;
    cam.tx = lie.x + (aim.x - lie.x) * 0.45;
    cam.ty = lie.y + (aim.y - lie.y) * 0.45;
    cam.ts *= S.zoom;
  }
  if (snap) { cam.x = cam.tx; cam.y = cam.ty; cam.s = cam.ts; }
}

// the hole is centered in the part of the screen the controls do not cover
const midY = () => (H - S.dock) / 2;
const P = (x, y) => [W / 2 + (x - cam.x) * cam.s, midY() - (y - cam.y) * cam.s];
const toWorld = (px, py) => ({ x: cam.x + (px - W / 2) / cam.s, y: cam.y - (py - midY()) / cam.s });

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
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let wy = Math.floor(b.minY / 36) * 36, i = 0; wy < b.maxY; wy += 36, i++) {
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
  // out of bounds inside the course: hatched
  for (const z of h.oob) {
    poly(z);
    ctx.fillStyle = 'rgba(70,24,8,0.55)';
    ctx.fill();
    ctx.save();
    poly(z);
    ctx.clip();
    ctx.strokeStyle = 'rgba(211,84,0,0.35)';
    ctx.lineWidth = 2;
    const zx = z.map((q) => q[0]);
    const zy = z.map((q) => q[1]);
    const x0 = Math.min(...zx);
    const x1 = Math.max(...zx);
    const y0 = Math.min(...zy);
    const y1 = Math.max(...zy);
    for (let k = x0 - (y1 - y0); k < x1; k += 14) {
      const [ax, ay] = P(k, y0);
      const [bx, by] = P(k + (y1 - y0), y1);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.restore();
    poly(z);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#d35400';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // water (a creek runs on past the edge of the course, so it is cut off there)
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx0, by0, bx1 - bx0, by1 - by0);
  ctx.clip();
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
  ctx.restore();
}

// the trees, seen from above: white pine (dark, spiky), maple (round, some turning), oak (broad and olive), and low shrubs and bushes
const autumn = (t) => ((Math.abs(Math.sin(t.x * 12.9898 + t.y * 78.233)) * 43758.5453) % 1) < 0.2; // a fifth of the maples are turning, the same ones every time
function drawTrees() {
  for (const tr of S.hole.trees) {
    const [x, y] = P(tr.x, tr.y);
    const R = tr.r * 1.9 * cam.s;
    if (x < -R * 2 || x > W + R * 2 || y < -R * 2 || y > H + R * 2) continue; // not on the screen
    const k = tr.k || (tr.h < 20 ? 's' : 'm');
    if (k === 's' || k === 'b') {
      const bush = k === 'b';
      ctx.beginPath();
      ctx.arc(x, y, bush ? R * 0.95 : R, 0, Math.PI * 2);
      ctx.fillStyle = bush ? '#2f5f35' : '#4a8f45';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - R * 0.12, y - R * 0.12, R * (bush ? 0.55 : 0.62), 0, Math.PI * 2);
      ctx.fillStyle = bush ? '#3f7a3a' : '#63ad57';
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.ellipse(x + R * 0.28, y + R * 0.28, R, R * 0.92, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    const look = k === 'p' ? ['#12392a', '#1d5a3c'] : k === 'o' ? ['#37591f', '#4c7a2c'] : autumn(tr) ? ['#a85a17', '#d98a2b'] : ['#2b7a37', '#3f9b4b'];
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = look[0];
    ctx.fill();
    if (k === 'p' && R > 3) { // a pine from above is a star of boughs
      ctx.beginPath();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const rr = i % 2 ? R * 0.4 : R * 0.82; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      ctx.closePath();
    } else {
      ctx.beginPath();
      ctx.arc(x - R * 0.12, y - R * 0.12, R * 0.62, 0, Math.PI * 2);
    }
    ctx.fillStyle = look[1];
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.5, tr.r * G.TREE_FORGIVE * cam.s), 0, Math.PI * 2); // the part that stops a disc
    ctx.fillStyle = k === 'p' ? '#0a2619' : '#123a1b';
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
    // a typical throw with this disc, and the shaded ground a mistimed release can reach; the meters decide the real one
    const pv = G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie);
    poly(pv.band.map((p) => [p.x, p.y]));
    ctx.fillStyle = 'rgba(163,230,53,0.13)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(163,230,53,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    poly(pv.line.map((p) => [p.x, p.y]), false);
  }
  ctx.strokeStyle = 'rgba(163,230,53,0.85)';
  ctx.setLineDash([7, 6]);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.setLineDash([]);
  if (!inPutt()) {
    const end = G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie, 8).end;
    const [x, y] = P(end.x, end.y);
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(163,230,53,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// a disc seen from above: raised by its height, with its shadow on the ground
function drawDisc(wx, wy, h, discId, size = 1, owner = 'me') {
  const look = discLook(discId, owner);
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

function discLook(id, owner = 'me') {
  const d = DISCS.get(id);
  if (owner !== 'me' && S.mp) {
    const them = S.mp.view.players.find((p) => p.uid === owner);
    return { color: them?.discs.find((x) => x.id === id)?.color || gradeColor(d.col), photo: '' };
  }
  const it = itemOf(id);
  return { color: it?.color || gradeColor(d.col), photo: it?.photo ? photoUrl(it.photo) : '' };
}

function drawLie(t) {
  if (!['pick', 'mturn', ...METER].includes(S.phase) || !curDisc()) return;
  const lie = lieOf();
  const [x, y] = P(lie.x, lie.y);
  ctx.beginPath();
  ctx.arc(x, y, 14 + Math.sin(t / 260) * 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = S.mode === 'match' ? 'rgba(163,230,53,0.8)' : 'rgba(238,241,232,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawDisc(lie.x, lie.y, 0, S.discId);
}

function drawOpp(t) {
  if (S.mode !== 'match') return;
  for (const o of S.others) {
    o.trail.forEach((tr, i) => {
      if (tr.pts.length < 2) return;
      poly(tr.pts.map((p) => [p.x, p.y]), false);
      ctx.strokeStyle = tr.kind === 'water' || tr.kind === 'oob' ? 'rgba(211,84,0,0.55)' : hexRgba(o.color, 0.45);
      ctx.setLineDash([4, 5]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      const e = tr.pts.at(-1);
      const [x, y] = P(e.x, e.y);
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8,16,12,0.82)';
      ctx.fill();
      ctx.fillStyle = o.color;
      ctx.font = '700 9px "Space Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), x, y + 0.5);
    });
    if (o.done || S.anim) continue;
    const [x, y] = P(o.lie.x, o.lie.y);
    ctx.beginPath();
    ctx.arc(x, y, 13 + Math.sin(t / 300 + 1) * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = o.color;
    ctx.fill();
    ctx.fillStyle = '#eef1e8';
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(o.name.slice(0, 10), x, y - 20);
  }
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
    drawDisc(b.at.x, b.at.y, 0, b.discId, 1.1 * shrink, b.owner);
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
  drawDisc(shown.x, shown.y, p >= 1 ? 0 : pos.h, S.last.disc.id, 1, S.last.who);
  const doneAt = a.dur + (a.roll.length ? 500 : 0) + 250 + (a.putt ? a.tail || 0 : 0);
  if (t - a.t0 >= doneAt) finishThrow();
}

// A throw seen from behind the disc (the preview). The same animation as the map's, from a camera that follows it.
const riding = () => CAM.on && S.anim?.type === 'flight' && !S.anim.putt && S.anim.pts.length >= 3 && S.last && !S.anim.fail3d && watching3D(S.last.who);

// Putting stays in the 3D view from the moment you are in range until you are done: the camera stands behind your disc, looking at
// the basket, and glides to the next spot after a miss.
const puttingIn3D = () => {
  if (!CAM.on || !S.round || S.anim?.fail3d) return false;
  if (S.phase === 'flight') return !!S.anim?.putt && watching3D(S.last?.who);
  return ['pick', 'putt', 'swipe', 'result'].includes(S.phase) && !S.round.done && inPutt();
};
function drawPutt3D(t) {
  const a = S.anim;
  const lie = a ? a.pts[0] : lieOf();
  const b = S.hole.basket;
  const d = { x: b.x - lie.x, y: b.y - lie.y };
  const l = Math.hypot(d.x, d.y) || 1;
  const dir = { x: d.x / l, y: d.y / l };
  const want = { x: lie.x - dir.x * 13, y: lie.y - dir.y * 13, z: 5.2, yaw: Math.atan2(dir.x, dir.y), pitch: Math.atan2(3.2 - 5.2, l + 13) };
  if (!S.pcam) { S.pcam = C3.newCamera(want.x, want.y, want.z, want.yaw, want.pitch); S.pcamT = t; }
  const dt = clamp((t - S.pcamT) / 1000, 0.001, 0.05);
  S.pcamT = t;
  const k = 1 - Math.exp(-dt * 3.2);
  const c = S.pcam;
  c.x += (want.x - c.x) * k; c.y += (want.y - c.y) * k; c.z += (want.z - c.z) * k;
  c.yaw += (((want.yaw - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
  c.pitch += (want.pitch - c.pitch) * k;
  c.roll += (0 - c.roll) * k;
  let disc = { x: lie.x, y: lie.y, h: 0.3 };
  let trail = [];
  const sc = a?.script;
  const ms = a ? Math.max(0, t - a.t0) : 0;
  let chain = 0;
  if (sc) {
    const at = sc.at(ms);
    disc = { x: at.x, y: at.y, h: at.h };
    for (let k = 0; k < ms; k += Math.max(30, ms / 36)) trail.push(sc.at(k));
    trail.push(disc);
    const m = sc.marks;
    if (a.result.made && m.dropAt !== undefined) chain = Math.max(0, 1 - (ms - m.dropAt) / 1000) * (ms >= m.dropAt ? (a.result.finish === 'rattle' ? 1 : 0.7) : 0);
    else if (a.result.rim && m.rimAt !== undefined && ms >= m.rimAt && ms < (m.spitAt ?? m.landAt)) chain = 0.45;
    if (at.phase === 'roll') { // follow a disc that is running away
      want.yaw = Math.atan2(at.x - c.x, at.y - c.y);
      want.pitch = Math.atan2(0.6 - c.z, Math.hypot(at.x - c.x, at.y - c.y));
    }
  } else if (a) {
    const p = clamp((t - a.t0) / a.dur, 0, 1);
    const at = C3.discAt(a.pts, p);
    disc = { x: at.pos.x, y: at.pos.y, h: at.pos.h };
    trail = a.pts.slice(0, at.i + 1).concat([disc]);
  }
  S.dockV = S.dockV === undefined ? S.dock : S.dockV + (S.dock - S.dockV) * (1 - Math.exp(-dt * 7)); // the controls grow and shrink; the picture eases with them
  const view = C3.viewOf(W, H, c, S.dockV);
  const baseFov = 64 * (Math.PI / 180);
  c.fov += ((baseFov + (S.pfov || 0)) - c.fov) * (1 - Math.exp(-dt * 6));
  C3.drawScene(ctx, { hole: S.hole, cam: c, view, disc, trail, dz: 1, chain, color: (a ? discLook(S.last.disc.id, S.last.who) : discLook(curDisc()?.id ?? S.last?.disc.id, 'me')).color, t });
  S.pfov = sc ? PF.drawPuttFx(ctx, { cam: c, view, hole: S.hole, W, H }, sc, ms, a.result).fov : 0;
  if (sc) { if (ms >= sc.total + sc.tail) finishThrow(); } else if (a && t - a.t0 >= a.dur + 250) finishThrow();
}
function draw3D(t) {
  const a = S.anim;
  const p = clamp((t - a.t0) / a.dur, 0, 1);
  const { pos, i, dir } = C3.discAt(a.pts, p);
  if (!a.cam) {
    const far = a.pts[Math.min(6, a.pts.length - 1)];
    const d0 = { x: far.x - a.pts[0].x, y: far.y - a.pts[0].y };
    const l = Math.hypot(d0.x, d0.y) || 1;
    a.cam = C3.startCamera(a.pts[0], { x: d0.x / l, y: d0.y / l });
    a.prev = t;
  }
  const dt = clamp((t - a.prev) / 1000, 0.001, 0.05);
  a.prev = t;
  let disc = { x: pos.x, y: pos.y, h: p >= 1 ? 0 : pos.h };
  const trail = a.pts.slice(0, i + 1);
  if (p >= 1 && a.roll.length) {
    const ri = Math.min(a.roll.length - 1, Math.floor(clamp((t - a.t0 - a.dur) / 500, 0, 1) * a.roll.length));
    disc = { x: a.roll[ri].x, y: a.roll[ri].y, h: 0 };
    trail.push(...a.pts.slice(i + 1), ...a.roll.slice(0, ri + 1).map((q) => ({ x: q.x, y: q.y, h: 0 })));
  } else {
    trail.push({ x: pos.x, y: pos.y, h: pos.h });
  }
  C3.follow(a.cam, { ...disc, h: disc.h * C3.ZS }, dir, dt, { back: 15 + 7 * (1 - Math.abs(p - 0.5) * 2), lift: 3.5, ahead: 70 });
  const kind = a.result.kind;
  const landed = Math.max(0, (t - a.t0 - a.dur) / 700);
  C3.drawScene(ctx, {
    hole: S.hole, cam: a.cam, view: C3.viewOf(W, H, a.cam, S.dock), disc, trail,
    color: discLook(S.last.disc.id, S.last.who).color, t,
    splash: (kind === 'water' || kind === 'oob') && p >= 1 ? { at: a.pts.at(-1), age: landed } : null,
    shake: kind === 'tree' && p >= 0.97 && landed < 0.6 ? 7 * (1 - landed / 0.6) : 0,
  });
  // fade in from the map, and out to it, so the cut is soft
  const doneAt = a.dur + (a.roll.length ? 500 : 0) + 250;
  const el = t - a.t0;
  const fade = Math.max(0, 1 - el / 260, 1 - (doneAt - el) / 300);
  if (fade > 0) { ctx.fillStyle = `rgba(6,11,7,${Math.min(1, fade)})`; ctx.fillRect(0, 0, W, H); }
  if (el >= doneAt) finishThrow();
}

function draw(t) {
  drawWorld(t);
  if (S.phase === 'swipe') drawSwipeGuide();
}
function drawWorld(t) {
  if (!S.round) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const in3d = !!riding();
  const stage = $('#gm-stage');
  if (stage.classList.contains('is-3d') !== in3d) stage.classList.toggle('is-3d', in3d);
  // a drawing mistake must never freeze the game: fall back to the map for this throw
  if (in3d) {
    try { draw3D(t); return; } catch (err) { console.error('3D ride failed, using the map', err); S.anim.fail3d = true; stage.classList.remove('is-3d'); }
  } else if (CAM.on && puttingIn3D() && S.mode !== 'menu') {
    try { drawPutt3D(t); return; } catch (err) { console.error('3D putt view failed, using the map', err); CAM.on = false; S.pcam = null; }
  } else {
    S.pcam = null;
  }
  drawCourse(t);
  drawTrail();
  drawTrees();
  drawBasket();
  drawPreview();
  drawOpp(t);
  drawLie(t);
  drawFlight(t);
  drawFx(t);
  drawBearScene(t);
}

/* ---------- the loop ---------- */

// the swirling green for a putt: a rotating grid, a green target at the middle, and a dot that wanders
function drawPuttMeter(t) {
  const c = $('#gm-putt');
  const m = S.meter;
  if (!c || !m || m.kind !== 'putt') return;
  const size = c.clientWidth || 240;
  const d = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(size * d)) { c.width = Math.round(size * d); c.height = Math.round(size * d); }
  const g = c.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  g.clearRect(0, 0, size, size);
  const cx = size / 2;
  const R = size / 2 - 8;
  const sec = (t - m.start) / 1000;
  const here = G.puttCursorAt(m.params, sec, m.speed);
  const inside = Math.hypot(here.x, here.y) <= m.radius;

  g.beginPath();
  g.arc(cx, cx, R + 4, 0, Math.PI * 2);
  g.fillStyle = '#060b07';
  g.fill();
  g.strokeStyle = 'rgba(238,241,232,0.5)';
  g.lineWidth = 2;
  g.stroke();
  // the grid swirls: rings that breathe, spokes that turn, two arcs that chase each other the other way
  g.strokeStyle = 'rgba(238,241,232,0.12)';
  g.lineWidth = 1;
  for (const k of [0.25, 0.5, 0.75]) { g.beginPath(); g.arc(cx, cx, R * k * (1 + Math.sin(sec * 1.3 + k * 6) * 0.015), 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 12; i++) {
    const a = sec * 0.22 + (i * Math.PI) / 6;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * 0.12, cx + Math.sin(a) * R * 0.12);
    g.lineTo(cx + Math.cos(a) * R, cx + Math.sin(a) * R);
    g.stroke();
  }
  g.strokeStyle = 'rgba(163,230,53,0.16)';
  g.lineWidth = 2;
  for (const [rr, off, span] of [[0.62, 1, 1.1], [0.38, -1.7, 0.8]]) {
    g.beginPath();
    g.arc(cx, cx, R * rr, -sec * 0.5 * Math.sign(off) + off, -sec * 0.5 * Math.sign(off) + off + span);
    g.stroke();
  }
  // which way is which
  g.fillStyle = 'rgba(238,241,232,0.4)';
  g.font = '700 9px "Space Mono", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('LONG', cx, 12);
  g.fillText('SHORT', cx, size - 12);
  g.fillText('L', 11, cx);
  g.fillText('R', size - 11, cx);
  // the target
  g.beginPath();
  g.arc(cx, cx, Math.max(R * m.radius, 4), 0, Math.PI * 2); // a long putt's target is a pinprick, but you can still see it
  g.fillStyle = inside ? 'rgba(163,230,53,0.38)' : 'rgba(163,230,53,0.18)';
  g.fill();
  g.strokeStyle = '#a3e635';
  g.lineWidth = 2.5;
  g.stroke();
  // the dot, and where it has just been
  for (let k = 8; k >= 1; k--) {
    const q = G.puttCursorAt(m.params, sec - k * 0.028, m.speed);
    g.beginPath();
    g.arc(cx + q.x * R, cx - q.y * R, 7 * (1 - k / 10), 0, Math.PI * 2);
    g.fillStyle = `rgba(238,241,232,${0.3 * (1 - k / 9)})`;
    g.fill();
  }
  g.beginPath();
  g.arc(cx + here.x * R, cx - here.y * R, 8, 0, Math.PI * 2);
  g.fillStyle = inside ? '#a3e635' : '#eef1e8';
  g.shadowColor = inside ? '#a3e635' : '#ffffff';
  g.shadowBlur = inside ? 16 : 8;
  g.fill();
  g.shadowBlur = 0;
}

function update(t) {
  cam.x += (cam.tx - cam.x) * 0.14;
  cam.y += (cam.ty - cam.y) * 0.14;
  cam.s += (cam.ts - cam.s) * 0.14;
  if (S.toast.until && t > S.toast.until) { $('#gm-toast').classList.remove('is-on'); S.toast.until = 0; }
  const m = S.meter;
  const mark = $('#gm-mark');
  if (S.phase === 'putt') drawPuttMeter(t);
  if (mark && m && METER_STAGES.includes(S.phase)) {
    const sec = (t - m.start) / 1000;
    const v = S.phase === 'power' ? G.powerAt(sec) : S.phase === 'release' ? (G.releaseAt(sec, m.rel) + 1) / 2 : (G.needleAt(sec, G.METER[S.phase].period) + 1) / 2;
    mark.style.left = `${v * 100}%`;
    const read = $('#gm-read');
    if (read && S.phase !== 'release') {
      const [big, small] = S.phase === 'power' ? (() => { const mph = G.mphAt(v); const risk = Math.round(G.slipChance(curDisc(), { ...S.settings, mph, spin: null, angle: 0, nose: 0 }) * 100); return [`${mph} mph`, `${tierName(Math.max(30, mph))}${risk ? ` · ${risk}% slip` : ''}`]; })()
        : S.phase === 'nose' ? [G.noseName(G.noseAt(v * 2 - 1)), '']
          : [angleName({ angle: G.angleAt(v * 2 - 1) }), ''];
      const text = `${big}|${small}`;
      if (read.dataset.t !== text) { read.dataset.t = text; read.innerHTML = `<b>${big}</b>${small ? `<small>${small}</small>` : ''}`; }
    }
  }
}

function frame() {
  try {
    const t = now();
    update(t);
    draw(t);
  } catch (err) {
    console.error(err); // never let one bad frame stop the game
  } finally {
    requestAnimationFrame(frame);
  }
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
  S.aimOff = clamp(Math.round(v), -AIM_MAX, AIM_MAX);
  const input = $('[data-gr="aim"]');
  if (input) {
    input.value = S.aimOff;
    const rng = input.closest('.fg-rng');
    rng.querySelector('output').textContent = aimText(S.aimOff);
    rng.querySelectorAll('[data-gstep]').forEach((b) => { b.disabled = (b.dataset.dir === '-1' && S.aimOff <= -AIM_MAX) || (b.dataset.dir === '1' && S.aimOff >= AIM_MAX); });
  }
  retarget(false);
}

function rangeEvent(e) {
  const stepBtn = e.type === 'click' ? e.target.closest('[data-gstep]') : null;
  const input = e.type === 'change' ? e.target.closest('[data-gr]') : null;
  const src = stepBtn || input;
  if (!src) return false;
  const next = stepBtn ? S.aimOff + Number(stepBtn.dataset.dir) : Number(input.value);
  S.aimOff = clamp(Math.round(next), -AIM_MAX, AIM_MAX);
  renderPanel('[data-gr="aim"]');
  retarget(false);
  return true;
}

function onPanelClick(e) {
  if (rangeEvent(e)) return;
  const t = e.target;
  const hand = t.closest('[data-hand]');
  const style = t.closest('[data-style]');
  if (hand || style) {
    const key = hand ? 'hand' : 'style';
    S.settings[key] = (hand || style).dataset[key];
    saveSettings();
    renderPanel(`[data-${key}="${S.settings[key]}"]`);
  } else if (t.closest('[data-disc]')) {
    const id = Number(t.closest('[data-disc]').dataset.disc);
    if (!S.round.eaten.includes(id)) { S.discId = id; renderPanel(`[data-disc="${id}"]`); retarget(false); }
  } else if (t.closest('[data-step]')) {
    S.step = t.closest('[data-step]').dataset.step;
    renderPanel();
  } else if (t.closest('[data-next-step]')) {
    S.step = S.step === 'disc' ? 'grip' : 'aim';
    renderPanel();
  } else if (t.closest('[data-go]')) {
    startMeter();
  } else if (t.closest('[data-next]')) {
    next();
  } else if (t.closest('[data-versus]') || t.closest('[data-lobby]')) {
    openLobby();
  } else if (t.closest('[data-lobby-holes]')) {
    S.lobby.holes = Number(t.closest('[data-lobby-holes]').dataset.lobbyHoles);
    renderPanel();
  } else if (t.closest('[data-mp-create]')) {
    mpCreate();
  } else if (t.closest('[data-mp-join]')) {
    mpJoin(S.lobby.code);
  } else if (t.closest('[data-mp-accept]')) {
    mpJoin(t.closest('[data-mp-accept]').dataset.mpAccept);
  } else if (t.closest('[data-mp-open]')) {
    mpOpen(t.closest('[data-mp-open]').dataset.mpOpen);
  } else if (t.closest('[data-mp-copy]')) {
    copyLink();
  } else if (t.closest('[data-mp-continue]')) {
    applyView(S.mp.view);
    drainQueue();
  } else if (t.closest('[data-mp-rematch]')) {
    mpRematch();
  } else if (t.closest('[data-mp-start]')) {
    mpStart();
  } else if (t.closest('[data-board-toggle]')) {
    S.boardOpen = !boardOpen(S.mp.view);
    renderPanel();
  } else if (t.closest('[data-mp-leave]')) {
    const btn = t.closest('[data-mp-leave]');
    if (btn.dataset.armed) { mpLeave(); return; }
    btn.dataset.armed = '1'; // two taps: leaving forfeits
    btn.textContent = S.mp.view.status === 'waiting' ? 'Really leave?' : 'Really forfeit?';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = S.mp.view.status === 'waiting' ? (S.mp.view.players.length === 1 ? 'Cancel the match' : 'Leave the match') : 'Forfeit'; } }, 3000);
  } else if (t.closest('[data-solo]')) {
    const length = Number(t.closest('[data-solo]').dataset.solo);
    startSolo(length, length === 1 ? Number($('[data-practice]', panel())?.value) || 1 : undefined);
  } else if (t.closest('[data-next-hole]')) {
    S.course.idx += 1;
    S.hole = S.course.holes[S.course.idx];
    startHole();
  } else if (t.closest('[data-summary]')) {
    finishCourse();
  } else if (t.closest('[data-menu]')) {
    showMenu();
  } else if (t.closest('[data-quit]')) {
    const btn = t.closest('[data-quit]');
    if (btn.dataset.armed) { showMenu(); return; }
    btn.dataset.armed = '1'; // two taps: quitting throws the round away
    btn.textContent = 'Really?';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Quit'; } }, 3000);
  } else if (t.closest('[data-again]')) {
    startSolo(S.course?.length || 18, S.course?.holes[0].id);
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
  else if (e.target.matches('[data-practice]') && S.phase === 'menu') previewHole(Number(e.target.value));
}

// the menu shows whichever hole is picked for practice
function previewHole(id) {
  S.hole = holeById(id) || HOLES[0];
  S.round = G.newRound(S.hole);
  updateHud();
  retarget(true);
}

function onPanelInput(e) {
  if (e.target.matches?.('[data-lobby-invite]')) { S.lobby.invite = e.target.value; return; }
  if (e.target.matches?.('[data-lobby-code]')) { e.target.value = e.target.value.toUpperCase(); S.lobby.code = e.target.value; return; }
  const r = e.target.closest?.('[data-gr]');
  if (!r) return;
  const v = Number(r.value);
  const out = r.closest('.fg-rng').querySelector('output');
  const key = r.dataset.gr;
  if (key === 'aim') { S.aimOff = v; out.textContent = aimText(v); retarget(false); }
}

function onKey(e) {
  if (e.key === 'Enter' && S.phase === 'lobby' && e.target.matches?.('[data-lobby-code]')) { e.preventDefault(); mpJoin(S.lobby.code); return; }
  if (e.key === 'Enter' && S.phase === 'lobby' && e.target.matches?.('[data-lobby-invite]')) { e.preventDefault(); mpCreate(); return; }
  if (e.target.closest?.('input, select, textarea') && e.key !== 'Enter') return;
  if (isMeter() && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    tap();
  } else if (S.phase === 'pick' && !inPutt() && !e.target.closest?.('input, select, textarea, button')) {
    if (e.key === 'ArrowLeft') setAim(S.aimOff - (e.shiftKey ? 5 : 1));
    else if (e.key === 'ArrowRight') setAim(S.aimOff + (e.shiftKey ? 5 : 1));
  }
}

/* ---------- versus: two players, one course, turn by turn ---------- */

async function gapi(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/game${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const playerOf = (uid, view = S.mp.view) => view.players.find((p) => p.uid === uid) || null;
const upNow = () => (S.mp?.view.round ? S.others.find((o) => o.uid === S.mp.view.round.turn) || null : null); // the other player whose throw it is
const myself = (view = S.mp.view) => playerOf(S.mp.me, view);
const mpBusy = () => !!S.anim || S.phase === 'bear' || S.phase === 'mhole' || !!S.mp?.sending;

// back to a bare stage (the menu and the lobby share it)
function resetStage() {
  closeStream();
  S.quip = '';
  S.mp = null;
  S.others = [];
  S.course = null;
  S.hole = HOLES[0];
  S.round = G.newRound(S.hole);
  S.trail = [];
  S.fx = [];
  S.anim = null;
  S.bear = null;
  S.meter = null;
  S.last = null;
  S.bag = buildBag();
  S.discId = null;
  try { history.replaceState(null, '', '/game'); } catch { /* fine */ }
}

/* ----- the lobby ----- */

function openLobby() {
  resetStage();
  S.mode = 'lobby';
  S.lobby.msg = '';
  setPhase('lobby');
  retarget(true);
  if (account.user) refreshLobby();
}

async function refreshLobby() {
  clearTimeout(S.lobby.timer);
  try {
    const d = await gapi('/matches');
    const same = JSON.stringify(d.matches) === JSON.stringify(S.lobby.matches);
    S.lobby.matches = d.matches;
    if (!same && S.phase === 'lobby') renderPanel();
  } catch (err) {
    S.lobby.msg = err.message;
    if (S.phase === 'lobby') renderPanel();
  }
  if (S.phase === 'lobby') S.lobby.timer = setTimeout(refreshLobby, 8000);
}

const matchLine = (m) => {
  const who = m.invitedYou ? `${esc(m.host)} invited you` : m.others.length === 1 ? `vs ${esc(m.others[0])}` : m.others.length ? `${esc(m.others[0])} and ${m.others.length - 1} more` : 'Waiting for players';
  const state = m.left ? 'you left'
    : m.status === 'waiting' ? (m.invitedYou ? 'your invitation' : `waiting · ${m.players} of 8 seated`)
      : m.status === 'active' ? (m.yourTurn ? '<b>your throw</b>' : 'in play')
        : m.status === 'cancelled' ? 'cancelled'
          : m.won === true ? '<b>you won</b>' : m.won === false ? 'finished' : 'you tied';
  return `<li><span>${who}<small>${m.holes} holes${m.status === 'active' ? ` · on hole ${m.holeIdx + 1}` : ''} · ${state}</small></span>${m.invitedYou
    ? `<button class="chip" type="button" data-mp-accept="${esc(m.id)}">Accept</button>`
    : `<button class="chip" type="button" data-mp-open="${esc(m.id)}">${m.status === 'active' || m.status === 'waiting' ? 'Open' : 'Look'}</button>`}</li>`;
};

function panelLobby() {
  const L = S.lobby;
  if (!account.user) {
    return `<div class="gm-card"><h2>Play with friends</h2><p>A match needs everyone signed in, so it is yours and stays yours. It takes a username and a password, nothing else.</p>
      <button class="btn" type="button" data-signin>Sign in or create an account</button>
      <button class="btn btn--ghost" type="button" data-menu>Back</button></div>`;
  }
  const mine = L.matches.length ? `<ul class="gm-matches">${L.matches.map(matchLine).join('')}</ul>` : '<p class="gm-note">Nothing yet.</p>';
  return `${bagBar()}
    <div class="gm-card">
      <h2>Play with friends</h2>
      <p>Two to eight players, turn by turn: whoever is farthest from the basket throws next, and everyone watches every throw. You each bring your own bag. You start the match once everyone has joined.</p>
      <div class="gm-row" role="group" aria-label="Round length"><span class="fg-wind__l">Round</span>
        <div class="fg-seg"><button class="chip" type="button" data-lobby-holes="9" aria-pressed="${L.holes === 9}">Front 9</button><button class="chip" type="button" data-lobby-holes="18" aria-pressed="${L.holes === 18}">All 18</button></div>
      </div>
      <label class="gm-field"><span class="fg-wind__l">Invite a player (optional)</span><input data-lobby-invite value="${esc(L.invite)}" maxlength="24" placeholder="their username" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <button class="btn" type="button" data-mp-create${L.busy ? ' disabled' : ''}>${L.busy ? 'Opening…' : 'Open a match'}</button>
      <p class="gm-note">You get a code and a link to send to anyone, up to eight players. Naming someone puts it in their lobby too.</p>
    </div>
    <div class="gm-card">
      <p class="gm-h">Join with a code</p>
      <div class="gm-row"><input class="gm-code-in" data-lobby-code value="${esc(L.code)}" maxlength="6" placeholder="ABC123" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Match code"><button class="chip" type="button" data-mp-join>Join</button></div>
    </div>
    <div class="gm-card"><p class="gm-h">Your matches</p>${mine}</div>
    ${L.msg ? `<p class="gm-error" role="alert">${esc(L.msg)}</p>` : ''}
    <button class="btn btn--ghost" type="button" data-menu>Back</button>`;
}

const flash = (msg) => { S.lobby.msg = msg; if (S.phase === 'lobby') renderPanel(); };

async function mpCreate() {
  if (S.lobby.busy) return;
  S.lobby.busy = true;
  S.lobby.msg = '';
  renderPanel();
  try {
    const d = await gapi('/matches', { method: 'POST', body: { holes: S.lobby.holes, invite: S.lobby.invite.trim(), bagId: account.activeId } });
    S.lobby.invite = '';
    enterMatch(d.match);
  } catch (err) {
    flash(err.message);
  } finally {
    S.lobby.busy = false;
    if (S.phase === 'lobby') renderPanel();
  }
}

async function mpJoin(id) {
  const code = String(id || '').trim().toUpperCase();
  if (!code) { flash('Type the six-character code.'); return; }
  try {
    const d = await gapi(`/matches/${encodeURIComponent(code)}/join`, { method: 'POST', body: { bagId: account.activeId } });
    S.lobby.code = '';
    enterMatch(d.match);
  } catch (err) {
    if (S.mode !== 'lobby') openLobby();
    flash(err.message);
  }
}

async function mpOpen(id) {
  try {
    const d = await gapi(`/matches/${encodeURIComponent(id)}`);
    enterMatch(d.match);
  } catch (err) {
    flash(err.message);
  }
}

/* ----- a match ----- */

function enterMatch(view) {
  closeStream();
  S.quip = '';
  S.mode = 'match';
  S.mp = { id: view.id, view, me: view.you, shownSeq: view.seq, queue: [], es: null, beat: Date.now(), sending: false, holeSeen: 0 };
  S.discId = null;
  S.course = null;
  try { history.replaceState(null, '', `/game?match=${view.id}`); } catch { /* fine */ }
  connectStream();
  applyView(view);
}

function closeStream() {
  const mp = S.mp;
  if (!mp) return;
  if (mp.es) mp.es.close();
  clearInterval(mp.watch);
}

function connectStream() {
  const mp = S.mp;
  if (!mp || typeof EventSource === 'undefined') return;
  if (mp.es) mp.es.close();
  const es = new EventSource(`/api/game/matches/${encodeURIComponent(mp.id)}/stream`);
  mp.es = es;
  mp.beat = Date.now();
  es.addEventListener('state', (e) => { mp.beat = Date.now(); try { onMatchState(JSON.parse(e.data)); } catch { /* a bad frame */ } });
  es.addEventListener('ping', () => { mp.beat = Date.now(); });
  // a connection can die without the browser noticing: if the server goes quiet, reconnect; and ask now and then anyway
  clearInterval(mp.watch);
  mp.watch = setInterval(() => {
    if (S.mp !== mp) { clearInterval(mp.watch); return; }
    if (Date.now() - mp.beat > 45000) connectStream();
    if (!mpBusy()) gapi(`/matches/${encodeURIComponent(mp.id)}`).then((d) => onMatchState(d.match)).catch(() => {});
  }, 15000);
}

// the other players' colors stay with them for the whole match
const colorOf = (uid, view) => OPP_COLORS[view.players.filter((p) => p.uid !== S.mp.me).findIndex((p) => p.uid === uid) % OPP_COLORS.length];

// the whole screen from the match as the server sees it
function applyView(view) {
  const mp = S.mp;
  const before = S.hole;
  mp.view = view;
  const me = mp.me;
  if (view.round) {
    S.hole = holeById(view.round.holeId);
    const r = view.round.rounds[me] || { lie: { ...S.hole.tee }, strokes: 0, throws: [], eaten: [], bearCame: false, done: true, holed: false }; // someone who left has no place on this hole
    S.round = { hole: S.hole, lie: { ...r.lie }, strokes: r.strokes, throws: r.throws, eaten: [...r.eaten], bearCame: r.bearCame, done: r.done, holed: r.holed };
    const path = (tr) => tr.map((t) => ({ pts: t.pts.map(([x, y]) => ({ x, y })), kind: t.kind, n: t.n }));
    S.trail = path(view.round.trails[me] || []);
    S.others = view.players.filter((p) => p.uid !== me && !p.left && view.round.rounds[p.uid]).map((p) => {
      const o = view.round.rounds[p.uid];
      return { uid: p.uid, name: p.name, color: colorOf(p.uid, view), lie: { ...o.lie }, strokes: o.strokes, done: o.done, holed: o.holed, trail: path(view.round.trails[p.uid] || []) };
    });
  } else {
    S.hole = HOLES[0];
    S.round = G.newRound(S.hole);
    S.trail = [];
    S.others = [];
  }
  S.course = { length: view.holes, holes: HOLES.slice(0, view.holes), idx: view.holeIdx, card: (view.cards[me] || []).map((c) => ({ id: c.hole, par: c.par, strokes: c.strokes, score: c.score, holed: c.holed })), eaten: view.eaten[me] || [] };
  const mine = myself(view);
  S.bag = {
    starter: false,
    discs: mine.discs.map((d) => {
      const own = account.bags.flatMap((b) => (b.items?.[d.id] ? [b.items[d.id]] : [])).find((it) => it.color || it.photo);
      return { disc: DISCS.get(d.id), item: own || (d.color ? { color: d.color } : null) };
    }).filter((x) => x.disc),
  };
  if (!S.bag.discs.some((x) => x.disc.id === S.discId && !S.round.eaten.includes(x.disc.id))) S.discId = suggest();
  S.aimOff = 0;
  setPhase(matchPhase());
  retarget(true);
  if (before !== S.hole) S.quip = '';
  if (matchPhase() === 'mdone' && mp.endQuip !== `${view.status}${view.seq}`) { mp.endQuip = `${view.status}${view.seq}`; say(matchEndRemark(view)); }
  if (before !== S.hole && view.round && view.holeIdx > 0) toast(`Hole ${view.holeIdx + 1}: ${S.hole.name}`, '', 1700);
}

function matchPhase() {
  const v = S.mp.view;
  if (v.status === 'waiting') return 'mwait';
  if (v.status === 'done' || v.status === 'cancelled' || myself(v).left) return 'mdone';
  return v.round.turn === S.mp.me ? 'pick' : 'mturn';
}

// news from the server (the stream, or the answer to something I did)
function onMatchState(view) {
  const mp = S.mp;
  if (!mp || view.id !== mp.id) return;
  if (view.seq < mp.view.seq) return; // old news
  if (view.seq === mp.view.seq && view.status === mp.view.status) return; // nothing new (the echo of my own move)
  if (mpBusy()) { mp.queue.push(view); return; }
  processView(view);
}

function processView(view) {
  const mp = S.mp;
  const last = view.last;
  if (last && last.seq > mp.shownSeq) startMoveAnim(view, last, last.uid === mp.me ? 'me' : last.uid); // everyone seated sees every throw, whoever's it was
  else applyView(view);
}

function drainQueue() {
  const mp = S.mp;
  if (!mp || mpBusy() || !mp.queue.length) return;
  processView(mp.queue.shift());
}

// show a move on the course: mine the moment the server answers, theirs the moment it reaches me
function startMoveAnim(view, last, who) {
  const mp = S.mp;
  mp.shownSeq = last.seq;
  mp.view = view;
  const disc = DISCS.get(last.discId);
  const hole = holeById(last.holeId);
  S.hole = hole;
  const to = last.made ? hole.basket : last.lie;
  const pts = last.putt
    ? Array.from({ length: 21 }, (_, i) => { const t = i / 20; return { x: last.from.x + (to.x - last.from.x) * t, y: last.from.y + (to.y - last.from.y) * t, h: 3 + 5 * 4 * t * (1 - t), s: t }; })
    : last.pts.map(([x, y, h]) => ({ x, y, h }));
  const roll = last.roll.map(([x, y]) => ({ x, y }));
  const result = { kind: last.kind, pts, roll, end: last.end, lie: last.lie, strokes: last.strokes, made: last.made, gimme: last.gimme, finish: last.finish, rim: last.rim, nasty: last.nasty, why: last.why, dist: last.dist, plan: last.putt ? undefined : { feet: last.feet } };
  S.last = { result, ex: last.ex, disc, from: last.from, who };
  const name = who === 'me' ? '' : `${playerOf(who, view).name}: `;
  if (last.putt) {
    S.anim = puttAnim(last.from, result, last.lie, who);
    puttReaction(result, who, name);
  } else {
    S.anim = { type: 'flight', t0: now(), dur: camDur(clamp(900 + last.feet * 4.2, 1200, 3300)), pts, roll, result, putt: false };
    toast(`${name}${last.ex?.grade || ''}`, last.ex?.pure ? 'good' : last.ex?.slip || last.ex?.grade === 'Shank' ? 'bad' : '', 1400);
  }
  setPhase('flight');
  retarget(false, pts);
}

// the disc has landed
function finishMove() {
  const mp = S.mp;
  const L = S.last;
  const last = mp.view.last;
  const result = L.result;
  const at = result.end ?? result.lie;
  S.anim = null;
  S.aimOff = 0;
  if (result.kind === 'water' || result.kind === 'oob') S.fx.push({ type: 'splash', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'tree') S.fx.push({ type: 'thunk', x: at.x, y: at.y, t0: now() });
  if (result.kind === 'basket') S.fx.push({ type: 'chains', x: S.hole.basket.x, y: S.hole.basket.y, t0: now() });
  if (L.who === 'me' && navigator.vibrate && ['tree', 'water', 'oob', 'basket'].includes(result.kind)) navigator.vibrate(result.kind === 'basket' ? [30, 40, 30] : 40);
  const trail = L.who === 'me' ? S.trail : (S.others.find((o) => o.uid === L.who)?.trail || []);
  trail.push({ pts: [...result.pts, ...result.roll].map((p) => ({ x: p.x, y: p.y })), kind: result.kind, n: trail.length + 1 });
  const mover = playerOf(L.who === 'me' ? mp.me : L.who, mp.view);
  const total = mp.view.round?.rounds[mover.uid]?.strokes ?? 0;
  say(T.remark(T.eventFor({ kind: last.kind, putt: last.putt, made: last.made, gimme: last.gimme, ex: last.ex, strokes: total, dist: G.distance(last.from, S.hole.basket), surface: S.last.result.surface, rim: last.rim, nasty: last.nasty, why: last.why }), { who: L.who === 'me' ? 'me' : 'them', name: mover.name }, Math.random, S.lastQuip));
  if (last.bear) { startBear({ discId: last.bear.discId, at: last.bear.at, owner: L.who }); return; }
  afterMove();
}

// the move is over: if it ended the hole, show the hole; either way, then the state as it now is
function afterMove() {
  const mp = S.mp;
  const last = mp.view.last;
  if (last && last.holeEnd && mp.holeSeen !== last.seq) {
    mp.holeSeen = last.seq;
    say(matchHoleRemark(last.holeEnd, mp.view));
    setPhase('mhole');
    return;
  }
  applyView(mp.view);
  drainQueue();
}

async function mpMove(kind, body) {
  const mp = S.mp;
  mp.sending = true;
  try {
    const d = await gapi(`/matches/${encodeURIComponent(mp.id)}/${kind}`, { method: 'POST', body });
    mp.sending = false;
    startMoveAnim(d.match, d.last, 'me');
  } catch (err) {
    mp.sending = false;
    toast(err.message, 'bad', 2600);
    try { applyView((await gapi(`/matches/${encodeURIComponent(mp.id)}`)).match); } catch { setPhase(matchPhase()); }
  }
}

function mpThrow(ex) {
  const disc = curDisc();
  S.last = { result: null, ex, disc, from: { ...lieOf() }, who: 'me' };
  setPhase('flight');
  mpMove('throw', { discId: disc.id, settings: { ...S.settings }, aimOff: S.aimOff, ex: { o: ex.o, pure: ex.pure, swipe: ex.swipe } });
}

function mpPutt(shot, swipe = null) {
  const disc = curDisc();
  S.last = { result: null, ex: null, disc, from: { ...lieOf() }, who: 'me' };
  setPhase('flight');
  mpMove('putt', { discId: disc.id, x: shot.x, y: shot.y, swipe });
}

/* ----- the match screens ----- */

const boardOpen = (v) => S.boardOpen ?? (!isPhone() && v.players.length <= 4);

function boardHtml() {
  const v = S.mp.view;
  if (!v.round) return '';
  const hole = S.hole;
  const up = playerOf(v.round.turn, v);
  const open = boardOpen(v);
  const bar = `<button class="gm-boardbar" type="button" data-board-toggle aria-expanded="${open}"><span>Scoreboard · ${v.players.length} players</span><em>${up ? (up.uid === S.mp.me ? 'your throw' : `${esc(up.name)} is up`) : ''}</em><i aria-hidden="true">${open ? '−' : '+'}</i></button>`;
  if (!open) return bar;
  const rows = v.players.map((p) => {
    const r = v.round.rounds[p.uid];
    const total = (v.cards[p.uid] || []).reduce((n, c) => n + c.score, 0);
    const par = (v.cards[p.uid] || []).reduce((n, c) => n + c.par, 0);
    const dot = p.uid === S.mp.me ? '' : `<i class="gm-dot" style="--pc:${colorOf(p.uid, v)}"></i>`;
    const where = p.left ? 'left' : !r ? '–' : r.done ? (r.holed ? 'in' : 'out') : ft(G.distance(r.lie, hole.basket));
    return `<li class="${p.uid === S.mp.me ? 'is-me' : 'is-them'}${v.round.turn === p.uid ? ' is-turn' : ''}${p.left ? ' is-left' : ''}"><span>${dot}${esc(p.name)}${p.uid === S.mp.me ? ' (you)' : ''}</span><span>${where}</span><b>${r ? r.strokes : '–'}</b><span>${(v.cards[p.uid] || []).length ? vsPar(total - par) : '–'}</span></li>`;
  }).join('');
  return `${bar}<ol class="gm-board" aria-label="Scoreboard"><li class="gm-board__h"><span>Player</span><span>To basket</span><span>Hole</span><span>Round</span></li>${rows}</ol>`;
}

function panelMwait() {
  const v = S.mp.view;
  const me = S.mp.me;
  const link = `${location.origin}/game?match=${v.id}`;
  const isHost = v.host === me;
  const seats = v.players.map((p) => `<li class="${p.uid === me ? 'is-me' : ''}"><span>${p.uid !== me ? `<i class="gm-dot" style="--pc:${colorOf(p.uid, v)}"></i>` : ''}${esc(p.name)}${p.uid === me ? ' (you)' : ''}</span><small>${p.uid === v.host ? 'host' : ''}</small></li>`).join('');
  const ready = v.players.length >= 2;
  const hostName = esc(playerOf(v.host, v).name);
  return `<div class="gm-card">
      <h2>${isHost ? 'Gather your players' : 'Waiting to start'}</h2>
      <p>${v.invite ? `You invited <b>${esc(v.invite)}</b>; it is in their lobby. ` : ''}Send this code or link to up to ${v.maxPlayers - 1} friends. They need to be signed in.</p>
      <div class="gm-code" aria-label="Match code">${esc(v.id)}</div>
      <input class="gm-link" readonly value="${esc(link)}" aria-label="Match link" data-mp-link>
      <button class="btn btn--ghost" type="button" data-mp-copy>Copy the link</button>
      <p class="gm-h">Seated <span>· ${v.players.length} of ${v.maxPlayers}</span></p>
      <ul class="gm-seats">${seats}</ul>
      ${isHost
        ? `<button class="btn" type="button" data-mp-start${ready ? '' : ' disabled'}>${ready ? `Start with ${v.players.length} players` : 'Waiting for a second player'}</button>`
        : `<p class="gm-note">${hostName} starts the match once everyone is here. This page updates the moment it begins.</p>`}
      <p class="gm-note">${v.holes} holes · everyone brings their own bag · the farthest player from the basket throws next, and you all watch every throw.</p>
      <button class="btn btn--ghost" type="button" data-mp-leave>${isHost && v.players.length === 1 ? 'Cancel the match' : 'Leave the match'}</button>
      <button class="btn btn--ghost" type="button" data-lobby>Back to the lobby</button>
    </div>`;
}

function panelMturn() {
  const v = S.mp.view;
  const up = playerOf(v.round.turn, v) || { name: 'Someone', uid: null };
  const mine = v.round.rounds[S.mp.me];
  const theirs = v.round.rounds[up.uid];
  const hole = S.hole;
  const playing = v.players.filter((p) => !p.left && p.uid !== S.mp.me && v.round.rounds[p.uid] && !v.round.rounds[p.uid].done);
  const reason = mine.done
    ? `You are done with this hole. ${playing.length === 1 ? `${esc(playing[0].name)} is` : `${playing.length} players are`} still playing it.`
    : theirs ? `${esc(up.name)} is ${ft(G.distance(theirs.lie, hole.basket))} from the basket and you are ${ft(G.distance(mine.lie, hole.basket))}, so ${esc(up.name)} throws${v.players.length > 2 ? ': the farthest out is always up' : ''}.` : '';
  return `${roundBar()}${boardHtml()}
    <div class="gm-card"><h2>${esc(up.name)}'s throw</h2><p>${reason}</p>${quipHtml()}<p class="gm-note">You will see it as it happens. This page updates by itself.</p></div>`;
}

// Marebear on how a hole went in a match, and on how the match went
function matchHoleRemark(he, v) {
  const mine = he.results.find((r) => r.uid === S.mp.me);
  if (mine) return T.holeRemark(mine.strokes, he.par, mine.holed, Math.random, S.lastQuip); // the hole you just played, in her words
  const sorted = [...he.results].sort((a, b) => a.score - b.score);
  const winners = sorted.filter((r) => r.score === sorted[0].score);
  const me = S.mp.me;
  const nameOf = (uid) => playerOf(uid, v)?.name || '';
  if (winners.length > 1) return T.matchRemark('holeShare', {}, Math.random, S.lastQuip);
  if (winners[0].uid === me) return T.matchRemark('holeWin', { name: nameOf(sorted[1]?.uid) }, Math.random, S.lastQuip);
  return T.matchRemark('holeLose', { name: nameOf(winners[0].uid) }, Math.random, S.lastQuip);
}
function matchEndRemark(v) {
  const me = S.mp.me;
  const winners = v.winners || [];
  const other = v.players.find((p) => p.uid !== me && winners.includes(p.uid)) || v.players.find((p) => p.uid !== me);
  if (myself(v).left) return T.matchRemark('left', {}, Math.random, S.lastQuip);
  if (v.status !== 'done') return '';
  if (winners.length > 1) return T.matchRemark('tie', {}, Math.random, S.lastQuip);
  return T.matchRemark(winners[0] === me ? 'win' : 'lose', { name: winners[0] === me ? (other?.name || '') : playerOf(winners[0], v)?.name || '' }, Math.random, S.lastQuip);
}

function panelMhole() {
  const v = S.mp.view;
  const he = v.last.holeEnd;
  const hole = holeById(he.holeId);
  const sorted = [...he.results].sort((a, b) => a.score - b.score);
  const rows = sorted.map((r) => {
    const p = playerOf(r.uid, v);
    return `<li class="${r.uid === S.mp.me ? 'is-me' : ''}"><span>${esc(p.name)}${r.uid === S.mp.me ? ' (you)' : ''}</span><span>${r.holed ? G.scoreName(r.strokes, hole.par) : 'no discs'}</span><b>${r.holed ? r.strokes : `${r.score}*`}</b></li>`;
  }).join('');
  const next = HOLES[v.holeIdx];
  const best = sorted[0].score;
  const winners = sorted.filter((r) => r.score === best);
  const title = winners.length > 1 ? (winners.some((w) => w.uid === S.mp.me) ? 'You share the hole' : 'Shared hole') : winners[0].uid === S.mp.me ? 'You take the hole' : `${esc(playerOf(winners[0].uid, v).name)} takes the hole`;
  return `<div class="gm-card">
      <h2 class="${winners.length === 1 && winners[0].uid === S.mp.me ? 'is-good' : ''}">${title}</h2>
      <p>${esc(hole.name)}, par ${hole.par}.</p>
      ${quipHtml()}
      <ol class="gm-vs-list">${rows}</ol>
      ${he.matchDone
        ? '<button class="btn" type="button" data-mp-continue>See the result</button>'
        : `<button class="btn" type="button" data-mp-continue>Next: hole ${v.holeIdx + 1}, ${esc(next.name)} <small>par ${next.par}</small></button>`}
    </div>`;
}

function panelMdone() {
  const v = S.mp.view;
  const me = S.mp.me;
  const mine = myself(v);
  if (v.status === 'cancelled') {
    return `<div class="gm-card"><h2 class="is-bad">Match cancelled</h2><p>Nobody joined in time, or it was called off.</p><button class="btn" type="button" data-lobby>Back to the lobby</button></div>`;
  }
  const total = (uid) => (v.cards[uid] || []).reduce((n, c) => n + c.score, 0);
  const par = (v.cards[me] || []).reduce((n, c) => n + c.par, 0);
  const standing = v.players.filter((p) => !p.left).sort((a, b) => total(a.uid) - total(b.uid));
  const gone = v.players.filter((p) => p.left);
  const rivals = standing.filter((p) => p.uid !== me);
  const winners = v.winners || [];
  const finished = v.status === 'done';
  const names = (uids) => uids.map((u) => esc(playerOf(u, v).name)).join(' and ');
  const headline = !finished ? 'You left the match'
    : winners.includes(me) ? (winners.length > 1 ? 'You share the win' : 'You win!')
      : winners.length > 1 ? `${names(winners)} tie` : winners.length ? `${esc(playerOf(winners[0], v).name)} wins` : 'No winner';
  const tone = !finished ? 'is-bad' : winners.includes(me) ? 'is-good' : 'is-bad';
  const note = v.endedBy === 'forfeit' ? (mine.left ? 'You left the match.' : 'Everyone else left the match.') : !finished ? 'The others are still playing. Here is where it stood.' : '';
  const place = (p, i) => `<li class="${p.uid === me ? 'is-me' : ''}"><span>${i + 1}. ${esc(p.name)}${p.uid === me ? ' (you)' : ''}</span><span>${vsPar(total(p.uid) - (v.cards[p.uid] || []).reduce((n, c) => n + c.par, 0))}</span><b>${total(p.uid)}</b></li>`;
  const board = `<ol class="gm-vs-list">${standing.map(place).join('')}${gone.map((p) => `<li class="is-left"><span>${esc(p.name)}</span><span>left</span><b>–</b></li>`).join('')}</ol>`;
  // you against the best of the rest, hole by hole
  const rival = rivals.sort((a, b) => total(a.uid) - total(b.uid))[0];
  const rows = (v.cards[me] || []).map((c, i) => {
    const o = rival ? (v.cards[rival.uid] || [])[i] : null;
    return `<li><span>${c.hole}. ${esc(HOLES[c.hole - 1].name)}</span><span>par ${c.par}</span><b class="${c.score < (o?.score ?? 99) ? 'is-under' : ''}">${c.holed ? c.strokes : `${c.score}*`}</b><b class="${o && o.score < c.score ? 'is-under' : ''}">${o ? (o.holed ? o.strokes : `${o.score}*`) : '–'}</b></li>`;
  }).join('');
  const rematch = finished && v.players.length === 2 ? `Play ${esc(rivals[0]?.name || 'them')} again` : 'Open a new match';
  return `<div class="gm-card">
      <h2 class="${tone}">${headline}</h2>
      ${note ? `<p>${note}</p>` : ''}
      ${quipHtml()}
      <div class="gm-score"><div><b>${total(me)}</b><span>You</span></div><div><b>${rival ? total(rival.uid) : '–'}</b><span>${rival ? esc(rival.name.slice(0, 10)) : ''}${v.players.length > 2 ? ' (best of the rest)' : ''}</span></div><div><b>${vsPar(total(me) - par)}</b><span>You to par</span></div></div>
      ${board}
      ${rows ? `<ol class="gm-vs-list gm-vs-list--card"><li class="gm-vs-list__h"><span>Hole</span><span></span><b>You</b><b>${esc(rival ? rival.name.slice(0, 5) : '')}</b></li>${rows}</ol>` : ''}
      ${finished ? `<button class="btn" type="button" data-mp-rematch>${rematch}</button>` : ''}
      <button class="btn btn--ghost" type="button" data-lobby>Back to the lobby</button>
      <button class="btn btn--ghost" type="button" data-menu>Menu</button>
    </div>`;
}

async function mpLeave() {
  try {
    const d = await gapi(`/matches/${encodeURIComponent(S.mp.id)}/leave`, { method: 'POST' });
    if (d.match.status === 'cancelled' || (d.match.status === 'waiting' && !d.match.players.some((p) => p.uid === S.mp.me))) { openLobby(); return; } // out of a match that had not started
    S.mp.view = d.match;
    applyView(d.match);
  } catch (err) {
    toast(err.message, 'bad', 2400);
  }
}

async function mpRematch() {
  const v = S.mp.view;
  const others = v.players.filter((p) => p.uid !== S.mp.me);
  try {
    // two players can go again at once; a bigger group gets a fresh code to send round
    const d = await gapi('/matches', { method: 'POST', body: { holes: v.holes, invite: others.length === 1 ? others[0].name : '', bagId: account.activeId } });
    enterMatch(d.match);
  } catch (err) {
    toast(err.message, 'bad', 2600);
  }
}

async function mpStart() {
  try {
    const d = await gapi(`/matches/${encodeURIComponent(S.mp.id)}/start`, { method: 'POST' });
    S.mp.view = d.match;
    applyView(d.match);
  } catch (err) {
    toast(err.message, 'bad', 2400);
  }
}

function copyLink() {
  const input = $('[data-mp-link]');
  if (!input) return;
  const done = () => toast('Link copied', 'good', 1200);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); });
  else { input.select(); document.execCommand?.('copy'); done(); }
}

/* ---------- boot ---------- */

async function boot() {
  const top = $('.masthead')?.offsetHeight || 66;
  document.documentElement.style.setProperty('--gm-top', `${top}px`);
  const res = await fetch('/data/flightguide.json?v=1');
  DATA = await res.json();
  try { T.useHeckles(await (await fetch('/data/heckles.json?v=2')).json()); } catch { /* her own lines are enough */ }
  for (const r of DATA.discs) DISCS.set(r[0], { id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] });

  loadCam();
  const camBtn = $('#gm-cam');
  const showCam = () => { camBtn.hidden = false; camBtn.setAttribute('aria-pressed', String(CAM.on)); camBtn.textContent = CAM.on ? '3D on' : '3D off'; };
  showCam();
  camBtn.addEventListener('click', () => { CAM.on = !CAM.on; try { localStorage.setItem('dj_cam', CAM.on ? 'on' : 'off'); } catch { /* not saved */ } showCam(); });
  new ResizeObserver(resize).observe($('#gm-stage'));
  resize();

  const p = panel();
  p.addEventListener('click', onPanelClick);
  p.addEventListener('change', onPanelChange);
  const zoomBy = (f) => {
    S.zoom = clamp(S.zoom * f, ZOOM.min, ZOOM.max);
    if (S.zoom < 1.05) S.zoom = 1;
    $('#gm-zin').disabled = S.zoom >= ZOOM.max - 0.01;
    $('#gm-zout').disabled = S.zoom <= 1;
    retarget(false);
  };
  $('#gm-zin').addEventListener('click', () => zoomBy(ZOOM.step));
  $('#gm-zout').addEventListener('click', () => zoomBy(1 / ZOOM.step));
  $('#gm-zout').disabled = true;
  new ResizeObserver(measureDock).observe(p);
  phoneQuery.addEventListener('change', () => { renderPanel(); measureDock(); });
  p.addEventListener('input', onPanelInput);
  // the meter answers the moment a finger lands, not when it lifts
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-tap], .gm-bar, #gm-putt') && isMeter()) { e.preventDefault(); tap(); } });
  p.addEventListener('keydown', (e) => { if (e.target.matches('[data-tap]') && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  cv.addEventListener('pointerdown', (e) => {
    if (riding()) { S.anim.t0 -= 1e7; return; } // tap to skip the ride
    if (S.phase === 'swipe') { beginSwipe(e); return; }
    cv.setPointerCapture?.(e.pointerId);
    setAimFromPointer(e);
  });
  cv.addEventListener('pointermove', (e) => { if (S.phase === 'swipe') { moveSwipe(e); return; } if (e.buttons || e.pointerType === 'touch') setAimFromPointer(e); });
  cv.addEventListener('pointerup', endSwipe);
  cv.addEventListener('pointercancel', () => { if (S.meter) S.meter.drag = null; });

  onAccountChange(() => {
    if (!S.round) return;
    if (!account.user && (S.mode === 'match' || S.mode === 'lobby')) { showMenu(); return; }
    if (S.mode === 'match') return; // a match keeps the bag it started with
    S.bag = buildBag();
    if (!S.bag.discs.some((x) => x.disc.id === S.discId)) S.discId = suggest();
    if (S.phase === 'pick' || S.phase === 'menu' || S.phase === 'lobby') renderPanel();
  });
  // a link to a match (?match=CODE): read it before the page tidies its own address
  const code = (new URLSearchParams(location.search).get('match') || '').toUpperCase();
  await loadAccount();
  showMenu();
  if (code) {
    if (account.user) {
      mpJoin(code);
    } else {
      openLobby();
      S.lobby.code = code;
      renderPanel();
      toast('Sign in to join this match', '', 2400);
      openSignIn({ onDone: () => mpJoin(code) });
    }
  }
  window.__gm = { puttDisc, S, G, clock, tap, throwDisc, startMeter, next, retarget, cam, DISCS, showMenu, startSolo, startHole, startBear, finishThrow, finishHole, finishCourse, openLobby, enterMatch, applyView, onMatchState, finishMove, mpCreate, mpJoin, step: () => { const t = now(); update(t); draw(t); } };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const p = panel();
  if (p) p.innerHTML = `<div class="gm-card"><h2 class="is-bad">Couldn't load</h2><p>${esc(err.message)}</p></div>`;
});
