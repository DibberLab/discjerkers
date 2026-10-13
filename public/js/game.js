/* The game: bring your bag, pick a disc, set your flight, then time the throw.
   The rules are in gamecore.js (and the flight in flightmodel.js, shared with the flight guide); this file is what you
   see and touch: the hole drawn from above, the panel, the throw meter, the animation, and Marebear. */

import { account, activeBag, loadAccount, onAccountChange, openSignIn, photoUrl, setActive } from './fgaccount.js?v=3';
import { clamp, tierName, angleName } from './flightmodel.js?v=1';
import { HOLES, holeById, holesFor } from './course.js?v=4';
import * as G from './gamecore.js?v=14';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-US');
const OPP_COLOR = '#38c8e8';
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
  mp: null, // the head-to-head match being played: { id, view, me, es, shownSeq, queue, ... }
  opp: null, // the other player's lie on this hole: { name, lie, strokes, done, holed }
  oppTrail: [],
  lobby: { matches: [], msg: '', holes: 18, invite: '', code: '', busy: false },
  course: null, // the round being played: { length, holes, idx, card, eaten }
  phase: 'loading', // menu | lobby | pick | power | spin | angle | release | putt | flight | result | bear | done | summary | mwait | mturn | mhole | mdone
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
  // arm speed, spin and angle are not settings: each throw's meters set them
  const base = { hand: 'right', style: 'backhand', mph: 56, spin: null, angle: 0 };
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

const METER = ['power', 'spin', 'angle', 'release', 'putt']; // the phases that wait for a tap
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

const aimText = (off) => (off === 0 ? 'At the basket' : `${Math.abs(off)}° ${off > 0 ? 'right' : 'left'}`);

function settingsBlock() {
  const t = S.settings;
  const chip = (key, val, label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${t[key] === val}">${label}</button>`;
  return `<div class="gm-block gm-settings">
      <p class="gm-h">Your throw <span>· hand and aim</span></p>
      <div class="fg-throw" role="group" aria-label="How you throw">
        <div class="fg-seg">${chip('hand', 'right', 'Right')}${chip('hand', 'left', 'Left')}</div>
        <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
      </div>
      ${rangeRow({ key: 'aim', label: 'Aim', text: aimText(S.aimOff), value: S.aimOff, min: -60, max: 60, step: 1, aria: 'aim', dec: '‹', inc: '›' })}
      <p class="gm-note">The dotted line is a typical throw with this disc; the shaded band is where a mistimed release can land. Your meters decide the real one.</p>
    </div>`;
}

const tipSeen = () => { try { return localStorage.getItem('dj_game_tip') === '1'; } catch { return false; } };
const tipHtml = () => (tipSeen() ? '' : `<div class="gm-tip"><p><b>How to play:</b> pick a disc, choose forehand or backhand, and aim (drag on the hole). Then <b>Throw</b> and tap four times: where you stop the power, spin and angle bars is your arm speed, your spin and your hyzer; the last tap is the release. A slow arm can grip lock or let go early, so watch the slip percentage. Trees stop low throws, water costs a stroke, and a triple bogey draws Marebear.</p><button type="button" data-tip-close aria-label="Got it">×</button></div>`);

function panelPick() {
  const d = curDisc();
  if (!d) return panelNoDiscs();
  const putting = inPutt();
  const plan = { wind: G.windFor(S.hole, heading()) };
  const dist = toBasket();
  const strokes = S.round.strokes;
  const caddy = S.round.strokes === 0 && S.hole.note ? `<p class="gm-caddy"><b>${esc(S.hole.name)}.</b> ${esc(S.hole.note)}</p>` : '';
  return `${roundBar()}${caddy}${S.mode === 'match' ? boardHtml() : tipHtml()}${bagBar()}
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
      <button class="btn btn--ghost" type="button" data-versus>Play a friend <small>head to head, turn by turn</small></button>
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
    const opp = v.players.find((p) => p.uid !== S.mp.me);
    return `<div class="gm-roundbar"><span>${opp ? `vs <b>${esc(opp.name)}</b>` : 'Match'} · hole <b>${v.holeIdx + 1}</b> of ${v.holes}</span><button class="chip" type="button" data-mp-leave>Forfeit</button></div>`;
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

const METER_STAGES = ['power', 'spin', 'angle', 'release'];

// a bar with a marker that sweeps; power, spin and angle read out the value under the marker as it goes
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
  if (kind === 'spin') return valueBar(kind, 'Lazy', 'Overcooked', G.spinPos(m.mph));
  if (kind === 'angle') return valueBar(kind, 'Anhyzer', 'Hyzer', 0.5);
  return centeredBar(m.rel.w, 'Early', 'Late');
}

const releaseHint = (risk) => `Tap when the needle crosses the middle. Early goes toward the turn side, late toward the fade side.${risk ? ` <b>${risk}% chance the disc slips</b>: a slow arm can grip lock or let go early.` : ''}`;

function panelMeter() {
  const kind = S.phase;
  const d = curDisc();
  const stages = kind === 'putt' ? [] : METER_STAGES;
  const n = stages.indexOf(kind) + 1;
  const names = { power: 'Power', spin: 'Spin', angle: 'Angle', release: 'Release', putt: 'Putt' };
  const risk = kind === 'release' && d ? Math.round(G.slipChance(d, S.settings) * 100) : 0;
  const title = kind === 'putt' ? 'Putt' : `<span>${n} ·</span> ${names[kind]}`;
  const hints = {
    power: 'Tap to set your arm speed. The lime band is the sweet spot: the speeds that put this disc closest to the basket from here. Past the hatched end the marker flies, and fast arms are harder to time.',
    spin: 'Tap to set the spin. The lime band is the sweet spot for the speed you chose; the white tick is the usual spin. More spin holds the line, less lets it turn over.',
    angle: 'Tap to set the release angle. The lime band is the sweet spot for your speed and spin. The middle is flat; right tips it onto hyzer, left onto anhyzer.',
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
      ${ex ? `<p>${ex.slip ? esc(ex.grade) : `${esc(ex.grade)} throw`}: ${describeExecution(ex)}</p>` : ''}
      <button class="btn" type="button" data-next>Next throw</button>
    </div>`;
}

function panelBear() {
  const disc = DISCS.get(S.bear.discId);
  if (S.bear.owner === 'opp') {
    const name = S.mp?.view.players.find((p) => p.uid !== S.mp.me)?.name || 'They';
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
  const views = { menu: panelMenu, pick: panelPick, power: panelMeter, spin: panelMeter, angle: panelMeter, release: panelMeter, putt: panelMeter, flight: panelFlight, result: panelResult, bear: panelBear, done: panelDone, summary: panelSummary, lobby: panelLobby, mwait: panelMwait, mturn: panelMturn, mhole: panelMhole, mdone: panelMdone };
  p.innerHTML = (views[S.phase] || (() => ''))();
  p.dataset.phase = S.phase;
  p.scrollTop = keepScroll;
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
    const opp = v.players.find((p) => p.uid !== S.mp.me);
    const turn = v.status !== 'active' ? '' : v.round.turn === S.mp.me ? 'Your throw' : `${esc(opp.name)}'s throw`;
    $('#gm-hud').innerHTML = `<span>Hole ${v.holeIdx + 1}/${v.holes} · ${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small><span>You <b>${r.strokes}</b> · ${esc(opp.name)} <b>${S.opp ? S.opp.strokes : 0}</b></span><small>${turn}${turn ? ' · ' : ''}${ft(G.distance(r.lie, h.basket))} to the basket</small>`;
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
    // four taps: power, spin and angle each choose a value of the throw, then the release is graded
    S.meter = { kind: 'power', start: now(), mph: null, rel: null, sweet: {} };
    sweetFor('power');
    setPhase('power');
  }
}

// where a bar's sweet spot is, given what the earlier bars set: worked out as a bar begins, then drawn on it
function sweetFor(stage) {
  const d = curDisc();
  if (!d || !S.meter) return;
  const base = { hand: S.settings.hand, style: S.settings.style, mph: S.settings.mph, spin: S.settings.spin, angle: 0 };
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
    sweetFor('spin');
    next('spin');
    toast(`${m.mph} mph`, '', 900);
  } else if (S.phase === 'spin') {
    S.settings.spin = G.spinAt(G.needleAt(t, G.METER.spin.period) / 2 + 0.5);
    sweetFor('angle');
    next('angle');
    toast(`${S.settings.spin} rpm`, '', 900);
  } else if (S.phase === 'angle') {
    S.settings.angle = G.angleAt(G.needleAt(t, G.METER.angle.period));
    next('release');
    toast(angleName(S.settings), '', 900);
  } else if (S.phase === 'release') {
    const ex = G.combine(G.readRelease(G.releaseAt(t, m.rel), m.rel.w));
    // solo rolls the slip here; in a match the server does, and the throw comes back with it
    throwDisc(S.mode === 'match' ? ex : G.applySlip(ex, G.rollSlip(curDisc(), S.settings, Math.random())));
  } else if (S.phase === 'putt') {
    puttDisc(G.puttCursorAt(m.params, t, m.speed));
  }
}

function throwDisc(ex) {
  try { localStorage.setItem('dj_game_tip', '1'); } catch { /* shown again */ }
  if (S.mode === 'match') { mpThrow(ex); return; }
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolveThrow(S.hole, disc, S.settings, heading(), ex, from);
  S.last = { result, ex, disc, from };
  const flightMs = clamp(900 + result.plan.feet * 4.2, 1200, 3300);
  S.anim = { type: 'flight', t0: now(), dur: flightMs, pts: result.pts, roll: result.roll, result };
  toast(ex.grade, ex.pure ? 'good' : ex.slip || ex.grade === 'Shank' ? 'bad' : '', 1300);
  setPhase('flight');
  retarget(false, result.pts);
}

function puttDisc(shot) {
  if (S.mode === 'match') { mpPutt(shot); return; }
  const disc = curDisc();
  const from = { ...lieOf() };
  const result = G.resolvePutt(S.hole, from, disc, shot);
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
  if (S.mode === 'match') { finishMove(); return; }
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
  const lie = S.mode === 'match' && S.phase === 'mturn' && S.opp ? S.opp.lie : lieOf();
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
  cam.ts = Math.min(W / w, H / h);
  if (S.zoom > 1 && !extra.length) { // zoomed in: stay on the next shot, halfway between where you are and where you are aiming
    const aim = putting || S.phase !== 'pick' || !curDisc() ? b : G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie, 12).end;
    cam.tx = lie.x + (aim.x - lie.x) * 0.45;
    cam.ty = lie.y + (aim.y - lie.y) * 0.45;
    cam.ts *= S.zoom;
  }
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
    ctx.arc(x, y, Math.max(1.5, tr.r * G.TREE_FORGIVE * cam.s), 0, Math.PI * 2); // the part that stops a disc
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
  if (owner === 'opp' && S.mp) {
    const them = S.mp.view.players.find((p) => p.uid !== S.mp.me);
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

// the other player: their earlier throws in blue, and a ring where their disc is now
function drawOpp(t) {
  if (S.mode !== 'match' || !S.opp) return;
  S.oppTrail.forEach((tr, i) => {
    if (tr.pts.length < 2) return;
    poly(tr.pts.map((p) => [p.x, p.y]), false);
    ctx.strokeStyle = tr.kind === 'water' || tr.kind === 'oob' ? 'rgba(211,84,0,0.55)' : 'rgba(56,200,232,0.45)';
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const e = tr.pts.at(-1);
    const [x, y] = P(e.x, e.y);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,30,40,0.8)';
    ctx.fill();
    ctx.fillStyle = OPP_COLOR;
    ctx.font = '700 9px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x, y + 0.5);
  });
  if (S.opp.done || S.anim) return;
  const [x, y] = P(S.opp.lie.x, S.opp.lie.y);
  ctx.beginPath();
  ctx.arc(x, y, 13 + Math.sin(t / 300 + 1) * 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = OPP_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = OPP_COLOR;
  ctx.fill();
  ctx.fillStyle = '#eef1e8';
  ctx.font = '700 10px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(S.opp.name.slice(0, 10), x, y - 20);
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
  drawDisc(shown.x, shown.y, p >= 1 ? 0 : pos.h, S.last.disc.id, 1, S.last.who === 'opp' ? 'opp' : 'me');
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
      const [big, small] = S.phase === 'power' ? (() => { const mph = G.mphAt(v); const risk = Math.round(G.slipChance(curDisc(), { ...S.settings, mph, spin: null, angle: 0 }) * 100); return [`${mph} mph`, `${tierName(Math.max(30, mph))}${risk ? ` · ${risk}% slip` : ''}`]; })()
        : S.phase === 'spin' ? [`${G.spinAt(v)} rpm`, '']
          : [angleName({ angle: G.angleAt(v * 2 - 1) }), ''];
      const text = `${big}|${small}`;
      if (read.dataset.t !== text) { read.dataset.t = text; read.innerHTML = `<b>${big}</b>${small ? `<small>${small}</small>` : ''}`; }
    }
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

function rangeEvent(e) {
  const stepBtn = e.type === 'click' ? e.target.closest('[data-gstep]') : null;
  const input = e.type === 'change' ? e.target.closest('[data-gr]') : null;
  const src = stepBtn || input;
  if (!src) return false;
  const next = stepBtn ? S.aimOff + Number(stepBtn.dataset.dir) : Number(input.value);
  S.aimOff = clamp(Math.round(next), -60, 60);
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
  } else if (t.closest('[data-mp-leave]')) {
    const btn = t.closest('[data-mp-leave]');
    if (btn.dataset.armed) { mpLeave(); return; }
    btn.dataset.armed = '1'; // two taps: leaving forfeits
    btn.textContent = S.mp.view.status === 'waiting' ? 'Really cancel?' : 'Really forfeit?';
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = S.mp.view.status === 'waiting' ? 'Cancel the match' : 'Forfeit'; } }, 3000);
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

const oppPlayer = (view = S.mp.view) => view.players.find((p) => p.uid !== S.mp.me) || null;
const mpBusy = () => !!S.anim || S.phase === 'bear' || S.phase === 'mhole' || !!S.mp?.sending;

// back to a bare stage (the menu and the lobby share it)
function resetStage() {
  closeStream();
  S.mp = null;
  S.opp = null;
  S.oppTrail = [];
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
  const who = m.invitedYou ? `${esc(m.host)} challenged you` : m.opponent ? `vs ${esc(m.opponent)}` : 'Waiting for a player';
  const state = m.status === 'waiting' ? (m.invitedYou ? 'your invitation' : 'waiting')
    : m.status === 'active' ? (m.yourTurn ? '<b>your throw</b>' : 'their throw')
      : m.status === 'cancelled' ? 'cancelled'
        : m.won === true ? '<b>you won</b>' : m.won === false ? 'you lost' : 'a tie';
  return `<li><span>${who}<small>${m.holes} holes${m.status === 'active' ? ` · on hole ${m.holeIdx + 1}` : ''} · ${state}</small></span>${m.invitedYou
    ? `<button class="chip" type="button" data-mp-accept="${esc(m.id)}">Accept</button>`
    : `<button class="chip" type="button" data-mp-open="${esc(m.id)}">${m.status === 'active' || m.status === 'waiting' ? 'Open' : 'Look'}</button>`}</li>`;
};

function panelLobby() {
  const L = S.lobby;
  if (!account.user) {
    return `<div class="gm-card"><h2>Play a friend</h2><p>Head to head needs you both signed in, so the match is yours and stays yours. It takes a username and a password, nothing else.</p>
      <button class="btn" type="button" data-signin>Sign in or create an account</button>
      <button class="btn btn--ghost" type="button" data-menu>Back</button></div>`;
  }
  const mine = L.matches.length ? `<ul class="gm-matches">${L.matches.map(matchLine).join('')}</ul>` : '<p class="gm-note">Nothing yet.</p>';
  return `${bagBar()}
    <div class="gm-card">
      <h2>Play a friend</h2>
      <p>Turn by turn: the player farthest from the basket throws next. You each bring your own bag, and a coin flip picks who tees off.</p>
      <div class="gm-row" role="group" aria-label="Round length"><span class="fg-wind__l">Round</span>
        <div class="fg-seg"><button class="chip" type="button" data-lobby-holes="9" aria-pressed="${L.holes === 9}">Front 9</button><button class="chip" type="button" data-lobby-holes="18" aria-pressed="${L.holes === 18}">All 18</button></div>
      </div>
      <label class="gm-field"><span class="fg-wind__l">Challenge a player (optional)</span><input data-lobby-invite value="${esc(L.invite)}" maxlength="24" placeholder="their username" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <button class="btn" type="button" data-mp-create${L.busy ? ' disabled' : ''}>${L.busy ? 'Starting…' : 'Start a match'}</button>
      <p class="gm-note">Leave the name empty and you get a code and a link to send to anyone.</p>
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

// the whole screen from the match as the server sees it
function applyView(view) {
  const mp = S.mp;
  const before = S.hole;
  mp.view = view;
  const me = mp.me;
  const opp = oppPlayer(view);
  if (view.round) {
    S.hole = holeById(view.round.holeId);
    const r = view.round.rounds[me];
    S.round = { hole: S.hole, lie: { ...r.lie }, strokes: r.strokes, throws: r.throws, eaten: [...r.eaten], bearCame: r.bearCame, done: r.done, holed: r.holed };
    const path = (tr) => tr.map((t) => ({ pts: t.pts.map(([x, y]) => ({ x, y })), kind: t.kind, n: t.n }));
    S.trail = path(view.round.trails[me] || []);
    if (opp) {
      const o = view.round.rounds[opp.uid];
      S.opp = { name: opp.name, lie: { ...o.lie }, strokes: o.strokes, done: o.done, holed: o.holed };
      S.oppTrail = path(view.round.trails[opp.uid] || []);
    } else {
      S.opp = null;
      S.oppTrail = [];
    }
  } else {
    S.hole = HOLES[0];
    S.round = G.newRound(S.hole);
    S.trail = [];
    S.opp = null;
    S.oppTrail = [];
  }
  S.course = { length: view.holes, holes: HOLES.slice(0, view.holes), idx: view.holeIdx, card: (view.cards[me] || []).map((c) => ({ id: c.hole, par: c.par, strokes: c.strokes, score: c.score, holed: c.holed })), eaten: view.eaten[me] || [] };
  const mine = view.players.find((p) => p.uid === me);
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
  if (before !== S.hole && view.round && view.holeIdx > 0) toast(`Hole ${view.holeIdx + 1}: ${S.hole.name}`, '', 1700);
}

function matchPhase() {
  const v = S.mp.view;
  if (v.status === 'waiting') return 'mwait';
  if (v.status === 'done' || v.status === 'cancelled') return 'mdone';
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
  if (last && last.seq > mp.shownSeq) startMoveAnim(view, last, last.uid === mp.me ? 'me' : 'opp');
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
  const result = { kind: last.kind, pts, roll, end: last.end, lie: last.lie, strokes: last.strokes, made: last.made, gimme: last.gimme, plan: last.putt ? undefined : { feet: last.feet } };
  S.last = { result, ex: last.ex, disc, from: last.from, who };
  S.anim = { type: 'flight', t0: now(), dur: last.putt ? 750 : clamp(900 + last.feet * 4.2, 1200, 3300), pts, roll, result };
  const name = who === 'opp' ? `${oppPlayer(view).name}: ` : '';
  toast(`${name}${last.putt ? (last.made ? (last.gimme ? 'Tap-in' : 'Chains!') : 'Rimmed out') : last.ex?.grade || ''}`, last.putt ? (last.made ? 'good' : 'bad') : last.ex?.pure ? 'good' : last.ex?.slip || last.ex?.grade === 'Shank' ? 'bad' : '', 1400);
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
  const trail = L.who === 'me' ? S.trail : S.oppTrail;
  trail.push({ pts: [...result.pts, ...result.roll].map((p) => ({ x: p.x, y: p.y })), kind: result.kind, n: trail.length + 1 });
  if (last.bear) { startBear({ discId: last.bear.discId, at: last.bear.at, owner: L.who }); return; }
  afterMove();
}

// the move is over: if it ended the hole, show the hole; either way, then the state as it now is
function afterMove() {
  const mp = S.mp;
  const last = mp.view.last;
  if (last && last.holeEnd && mp.holeSeen !== last.seq) {
    mp.holeSeen = last.seq;
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
  mpMove('throw', { discId: disc.id, settings: { ...S.settings }, aimOff: S.aimOff, ex: { o: ex.o, pure: ex.pure } });
}

function mpPutt(shot) {
  const disc = curDisc();
  S.last = { result: null, ex: null, disc, from: { ...lieOf() }, who: 'me' };
  setPhase('flight');
  mpMove('putt', { discId: disc.id, x: shot.x, y: shot.y });
}

/* ----- the match screens ----- */

function boardHtml() {
  const v = S.mp.view;
  if (!v.round) return '';
  const hole = S.hole;
  const rows = v.players.map((p) => {
    const r = v.round.rounds[p.uid];
    const total = (v.cards[p.uid] || []).reduce((n, c) => n + c.score, 0);
    const par = (v.cards[p.uid] || []).reduce((n, c) => n + c.par, 0);
    return `<li class="${p.uid === S.mp.me ? 'is-me' : 'is-them'}${v.round.turn === p.uid ? ' is-turn' : ''}"><span>${esc(p.name)}${p.uid === S.mp.me ? ' (you)' : ''}</span><span>${r.done ? (r.holed ? 'in' : 'out') : ft(G.distance(r.lie, hole.basket))}</span><b>${r.strokes}</b><span>${(v.cards[p.uid] || []).length ? vsPar(total - par) : '–'}</span></li>`;
  }).join('');
  return `<ol class="gm-board" aria-label="Scoreboard"><li class="gm-board__h"><span>Player</span><span>To basket</span><span>Hole</span><span>Round</span></li>${rows}</ol>`;
}

function panelMwait() {
  const v = S.mp.view;
  const link = `${location.origin}/game?match=${v.id}`;
  return `<div class="gm-card">
      <h2>Waiting for a player</h2>
      <p>${v.invite ? `You challenged <b>${esc(v.invite)}</b>. It is waiting in their lobby; you can also send them the link.` : 'Send this code or link to a friend. They need to be signed in.'}</p>
      <div class="gm-code" aria-label="Match code">${esc(v.id)}</div>
      <input class="gm-link" readonly value="${esc(link)}" aria-label="Match link" data-mp-link>
      <button class="btn" type="button" data-mp-copy>Copy the link</button>
      <p class="gm-note">${v.holes} holes · each of you brings your own bag · the farthest player from the basket throws next. This page updates the moment someone joins.</p>
      <button class="btn btn--ghost" type="button" data-mp-leave>Cancel the match</button>
      <button class="btn btn--ghost" type="button" data-lobby>Back to the lobby</button>
    </div>`;
}

function panelMturn() {
  const v = S.mp.view;
  const opp = oppPlayer(v);
  const mine = v.round.rounds[S.mp.me];
  const theirs = v.round.rounds[opp.uid];
  const hole = S.hole;
  const reason = mine.done
    ? `You are done with this hole. ${esc(opp.name)} is still playing it.`
    : `${esc(opp.name)} is ${ft(G.distance(theirs.lie, hole.basket))} from the basket and you are ${ft(G.distance(mine.lie, hole.basket))}, so ${esc(opp.name)} throws.`;
  return `${roundBar()}${boardHtml()}
    <div class="gm-card"><h2>${esc(opp.name)}'s throw</h2><p>${reason}</p><p class="gm-note">You will see it as it happens. This page updates by itself.</p></div>`;
}

function panelMhole() {
  const v = S.mp.view;
  const he = v.last.holeEnd;
  const hole = holeById(he.holeId);
  const rows = he.results.map((r) => {
    const p = v.players.find((x) => x.uid === r.uid);
    return `<li class="${r.uid === S.mp.me ? 'is-me' : ''}"><span>${esc(p.name)}${r.uid === S.mp.me ? ' (you)' : ''}</span><span>${r.holed ? G.scoreName(r.strokes, hole.par) : 'no discs'}</span><b>${r.holed ? r.strokes : `${r.score}*`}</b></li>`;
  }).join('');
  const next = HOLES[v.holeIdx];
  const best = Math.min(...he.results.map((r) => r.score));
  const winners = he.results.filter((r) => r.score === best);
  const title = winners.length === 2 ? 'Halved' : winners[0].uid === S.mp.me ? 'You take the hole' : `${esc(oppPlayer(v).name)} takes the hole`;
  return `<div class="gm-card">
      <h2 class="${winners.length === 1 && winners[0].uid === S.mp.me ? 'is-good' : ''}">${title}</h2>
      <p>${esc(hole.name)}, par ${hole.par}.</p>
      <ol class="gm-vs-list">${rows}</ol>
      ${he.matchDone
        ? '<button class="btn" type="button" data-mp-continue>See the result</button>'
        : `<button class="btn" type="button" data-mp-continue>Next: hole ${v.holeIdx + 1}, ${esc(next.name)} <small>par ${next.par}</small></button>`}
    </div>`;
}

function panelMdone() {
  const v = S.mp.view;
  const me = S.mp.me;
  const opp = oppPlayer(v);
  if (v.status === 'cancelled') {
    return `<div class="gm-card"><h2 class="is-bad">Match cancelled</h2><p>Nobody joined in time, or it was called off.</p><button class="btn" type="button" data-lobby>Back to the lobby</button></div>`;
  }
  const total = (uid) => (v.cards[uid] || []).reduce((n, c) => n + c.score, 0);
  const par = (v.cards[me] || []).reduce((n, c) => n + c.par, 0);
  const headline = v.winner === 'tie' ? 'A tie' : v.winner === me ? 'You win!' : `${esc(opp.name)} wins`;
  const note = v.endedBy === 'forfeit' ? (v.winner === me ? `${esc(opp.name)} left the match.` : 'You left the match.') : '';
  const rows = (v.cards[me] || []).map((c, i) => {
    const o = (v.cards[opp.uid] || [])[i];
    return `<li><span>${c.hole}. ${esc(HOLES[c.hole - 1].name)}</span><span>par ${c.par}</span><b class="${c.score < (o?.score ?? 99) ? 'is-under' : ''}">${c.holed ? c.strokes : `${c.score}*`}</b><b class="${o && o.score < c.score ? 'is-under' : ''}">${o ? (o.holed ? o.strokes : `${o.score}*`) : '–'}</b></li>`;
  }).join('');
  return `<div class="gm-card">
      <h2 class="${v.winner === me ? 'is-good' : v.winner === 'tie' ? '' : 'is-bad'}">${headline}</h2>
      ${note ? `<p>${note}</p>` : ''}
      <div class="gm-score"><div><b>${total(me)}</b><span>You</span></div><div><b>${total(opp.uid)}</b><span>${esc(opp.name)}</span></div><div><b>${vsPar(total(me) - par)}</b><span>You to par</span></div></div>
      <ol class="gm-vs-list gm-vs-list--card"><li class="gm-vs-list__h"><span>Hole</span><span></span><b>You</b><b>${esc(opp.name.slice(0, 5))}</b></li>${rows}</ol>
      <button class="btn" type="button" data-mp-rematch>Play ${esc(opp.name)} again</button>
      <button class="btn btn--ghost" type="button" data-lobby>Back to the lobby</button>
      <button class="btn btn--ghost" type="button" data-menu>Menu</button>
    </div>`;
}

async function mpLeave() {
  try {
    const d = await gapi(`/matches/${encodeURIComponent(S.mp.id)}/leave`, { method: 'POST' });
    S.mp.view = d.match;
    applyView(d.match);
  } catch (err) {
    toast(err.message, 'bad', 2400);
  }
}

async function mpRematch() {
  const v = S.mp.view;
  const opp = oppPlayer(v);
  try {
    const d = await gapi('/matches', { method: 'POST', body: { holes: v.holes, invite: opp.name, bagId: account.activeId } });
    enterMatch(d.match);
  } catch (err) {
    toast(err.message, 'bad', 2600);
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
  for (const r of DATA.discs) DISCS.set(r[0], { id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] });

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
  p.addEventListener('input', onPanelInput);
  // the meter answers the moment a finger lands, not when it lifts
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-tap], .gm-bar, #gm-putt') && isMeter()) { e.preventDefault(); tap(); } });
  p.addEventListener('keydown', (e) => { if (e.target.matches('[data-tap]') && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture?.(e.pointerId); setAimFromPointer(e); });
  cv.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setAimFromPointer(e); });

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
  window.__gm = { S, G, clock, tap, throwDisc, startMeter, next, retarget, cam, DISCS, showMenu, startSolo, startHole, startBear, finishThrow, finishHole, finishCourse, openLobby, enterMatch, applyView, onMatchState, finishMove, mpCreate, mpJoin, step: () => { const t = now(); update(t); draw(t); } };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const p = panel();
  if (p) p.innerHTML = `<div class="gm-card"><h2 class="is-bad">Couldn't load</h2><p>${esc(err.message)}</p></div>`;
});
