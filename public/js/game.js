/* The game: bring your bag, pick a disc, set your flight, then time the throw.
   The rules are in gamecore.js (and the flight in flightmodel.js, shared with the flight guide); this file is what you
   see and touch: the hole drawn from above, the panel, the throw meter, the animation, and Marebear. */

import { account, activeBag, loadAccount, onAccountChange, openSignIn, photoUrl, setActive } from './fgaccount.js?v=3';
import { clamp, tierName, angleName } from './flightmodel.js?v=1';
import { HOLES, holeById, holesFor } from './course.js?v=11';
import * as G from './gamecore.js?v=28';
import * as T from './trash.js?v=10';
import * as C3 from './cam3d.js?v=16';
import * as PF from './puttfx.js?v=12';
import * as GR from './ground.js?v=5';
import * as SND from './sound.js?v=3';
import * as MB from './marebear.js?v=1';
import * as K from './conditions.js?v=3';
import * as DLY from './daily.js?v=1';
import * as GP from './gamepanels.js?v=3';
import * as PR from './progress.js?v=2';

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
  game: loadGame(), // what playing has left behind: stats, goals, skins (progress.js)
  trophyMsg: '',
  daily: { data: null, loading: false, msg: '' }, // the daily course screen
  standings: { data: null, loading: false, msg: '' },
  dailyPost: null, // what happened when a finished daily run was posted
  bet: null, // Marebear's bet on this hole: { key, holeId, kind, text, status: 'offer' | 'taken' | 'declined', settled }
  replay: null, // a throw being watched again: { phase, hole }
  pop: null, // Marebear popping up from the bottom of the screen to comment: { t0, text, to, mood, dur, side }
  toast: { text: '', until: 0 },
  best: null,
  zoom: 1,
};

// the player's progress: kept in this browser, and (signed in) on their account too
function loadGame() {
  try { return PR.sanitizeGame(JSON.parse(localStorage.getItem('dj_progress'))) || PR.emptyGame(); } catch { return PR.emptyGame(); }
}
let gameSaveTimer = null;
function saveGame() {
  try { localStorage.setItem('dj_progress', JSON.stringify(S.game)); } catch { /* not saved */ }
  if (!account.user) return;
  clearTimeout(gameSaveTimer);
  gameSaveTimer = setTimeout(() => { // a few seconds after the last change, so a round of throws is one save
    fetch('/api/account/game', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ game: S.game }) }).catch(() => {});
  }, 4000);
}
// signed in: take what the account has, merge it with what this browser has, and keep both
async function syncGame() {
  if (!account.user) return;
  try {
    const res = await fetch('/api/account/game', { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return;
    const { game } = await res.json();
    S.game = PR.mergeGame(S.game, game);
    saveGame();
    if (S.phase === 'trophies') renderPanel();
  } catch { /* offline: the local copy is fine */ }
}
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
const puttDd = () => G.puttDist(S.hole, lieOf()); // how hard the putt is: the hill counts
// how the basket sits against you: nothing on the level, else "▲ 12 ft uphill" or "▼ 8 ft downhill"
const slopeBit = (hole, lie) => { const t = slopeText(hole, lie); return t ? ` · ${t}` : ''; };
// a line for the pick panel about the hill, with what it does to this throw or putt
function slopeNote() {
  const t = slopeText(S.hole, lieOf());
  if (!t) return '';
  if (isPhone()) return `<p class="gm-note">${t}.</p>`;
  return `<p class="gm-note">${t}. ${inPutt() ? (G.riseTo(S.hole, lieOf()) > 0 ? 'Uphill putts are easier, but swipe a little harder.' : 'Downhill putts are harder and run away: swipe softer.') : (G.riseTo(S.hole, lieOf()) > 0 ? 'The basket is above you: throws come down short.' : 'The basket is below you: throws run on.')}</p>`;
}
const slopeText = (hole, lie) => { const r = G.riseTo(hole, lie); return Math.abs(r) < 1 ? '' : `${r > 0 ? '▲' : '▼'} ${Math.round(Math.abs(r))} ft ${r > 0 ? 'uphill' : 'downhill'}`; };
const baseHeading = () => G.headingTo(lieOf(), S.hole.basket);
const heading = () => baseHeading() + S.aimOff;
// the disc as you play it: one you have thrown a lot has broken in (progress.js), in a match by the wear the server froze with your bag
const wearFor = (id) => (S.mode === 'match' && S.mp ? myself(S.mp.view)?.discs.find((d) => d.id === id)?.w || 0 : PR.wearOf(S.game, id));
const curDisc = () => { const d = DISCS.get(S.discId); return d ? PR.brokenIn(d, wearFor(d.id)) : d; };
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

// a new hole: a fresh round of it, with the discs Marebear has already pocketed staying gone
function startHole() {
  S.hole = holeNow(S.course.holes[S.course.idx]); // the day's conditions on this hole
  S.bet = null;
  GR.warm(S.hole); // the ground's colours and the map's picture, made in the background
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

/* ----- Marebear Bucks and her bets ----- */

// Her bets are a game of their own: a stake in Marebear Bucks (kept in this browser), won or lost on how a hole goes. They do not touch the match.
// Marebear's bets are switched off for now (the code is all here): no offer, no stakes, no Bucks to earn or spend
const BETTING_ON = false;
const GOALS = PR.ACHIEVEMENTS.filter((a) => BETTING_ON || !a.retired);
const bucks = () => { try { return Math.max(0, Number(localStorage.getItem('dj_bucks')) || 0); } catch { return 0; } };
const setBucks = (n) => { try { localStorage.setItem('dj_bucks', String(Math.max(0, Math.round(n)))); } catch { /* not saved */ } };
const betKey = () => (S.mode === 'match' && S.mp ? `m${S.mp.view.id}:${S.mp.view.holeIdx}` : `s${S.course?.seed ?? 'c'}:${S.course?.idx ?? 0}:${S.hole.id}`);
// this hole's bet (made the first time it is looked at, before your first throw)
function betNow() {
  if (!BETTING_ON || !S.round || !S.course) return null;
  const key = betKey();
  if (S.bet?.key === key) return S.bet;
  if (S.round.strokes > 0 || S.round.throws.length) return null;
  const kind = T.betKind(S.hole.par);
  S.bet = { key, holeId: S.hole.id, kind, text: T.betOffer(kind, Math.random, S.lastQuip), status: 'offer', settled: false };
  return S.bet;
}
function betHtml() {
  const b = betNow();
  if (!b || b.status === 'declined') return '';
  const t = T.BETS[b.kind];
  if (b.status === 'offer' && isPhone()) { // on a phone it is a single line, so the hole stays in view
    return `<div class="gm-bet gm-bet--tight"><p><b>Marebear:</b> you ${t.text}? <small>+${t.win} / −${t.lose}</small></p><div class="gm-bet__go"><button class="chip" type="button" data-bet="take">Bet</button><button class="chip" type="button" data-bet="no">No</button></div></div>`;
  }
  if (b.status === 'taken') return `<p class="gm-note gm-bet-on">Bet on with Marebear: you ${t.text}. Win +${t.win}, lose −${t.lose}.</p>`;
  return `<div class="gm-bet"><p><b>Marebear's bet:</b> “${esc(b.text)}”<small>You ${t.text}: win +${t.win}, lose −${t.lose} (you have ${bucks()} Marebear Bucks).</small></p><div class="gm-bet__go"><button class="chip" type="button" data-bet="take">Take it</button><button class="chip" type="button" data-bet="no">No thanks</button></div></div>`;
}
function answerBet(take) {
  const b = S.bet;
  if (!b || b.status !== 'offer') return;
  b.status = take ? 'taken' : 'declined';
  say(T.betRemark(take ? 'taken' : 'declined', Math.random, S.lastQuip), 'bad');
  renderPanel();
}
// the hole is over: who won the bet
function settleBet(strokes, par, holed, holeId) {
  const b = S.bet;
  if (!b || b.status !== 'taken' || b.settled || b.holeId !== holeId) return;
  b.settled = true;
  const t = T.BETS[b.kind];
  const won = T.betWon(b.kind, strokes, par, holed);
  const before = bucks();
  if (won) announce(PR.recordBetWon(S.game));
  const delta = won ? t.win : -Math.min(t.lose, before);
  setBucks(before + delta);
  toast(won ? `Bet won: +${t.win} Marebear Bucks` : `Bet lost: −${-delta} Marebear Bucks`, won ? 'good' : 'bad', 2600);
  setTimeout(() => { if (S.round) say(T.betRemark(won ? 'won' : 'lost', Math.random, S.lastQuip), won ? 'good' : 'bad'); }, 2800); // after her word on the hole itself
  SND.play(won ? 'ding' : 'womp');
}

/* ----- conditions: the day's wind, rain, light, pin and mando (conditions.js) come from a seed ----- */

// "Varied conditions" is on unless the player has asked for the classic course (remembered)
const condOn = () => { try { return localStorage.getItem('dj_cond') !== 'classic'; } catch { return true; } };
// rain is a choice (off unless the player turns it on): plenty of disc golfers do not play in the rain
const rainOn = () => { try { return localStorage.getItem('dj_rain') === 'on'; } catch { return false; } };
const newSeed = () => Math.floor(Math.random() * 2e9) + 1;
// the hole as this round plays it (the base hole, if it is the classic course)
const holeNow = (base) => (S.course?.seed ? K.holeOn(S.course.seed, base, { idx: S.course.idx, n: S.course.holes.length, rain: !!S.course.rain }) : base);
const matchDays = new Map();
function matchHole(id, view = S.mp?.view) {
  const base = holeById(id);
  if (!view || view.seed === undefined || view.seed === null) return base;
  const key = `${view.seed}:${id}:${view.holeIdx}:${view.holes}:${view.rain ? 'r' : ''}`;
  if (!matchDays.has(key)) { if (matchDays.size > 60) matchDays.clear(); matchDays.set(key, K.holeOn(view.seed, base, { idx: view.holeIdx, n: view.holes, rain: !!view.rain })); }
  return matchDays.get(key);
}
const tagBit = (h) => { const t = K.tags(h.variant); return t.length ? ` · ${t.join(' · ')}` : ''; };

// a round: one practice hole, the front nine, or all eighteen
function startSolo(length, practiceId) {
  const holes = length === 1 ? [holeById(practiceId) || HOLES[0]] : holesFor(length);
  S.mode = 'solo';
  S.course = { length, holes, idx: 0, card: [], eaten: [], seed: condOn() ? newSeed() : null, rain: condOn() && rainOn() };
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
  keepAwake(PLAYING.has(phase) || phase === 'mwait'); // a phone should not dim in the middle of a throw, or while you wait for a friend
  document.body.classList.toggle('gm-playing', PLAYING.has(phase)); // on a phone the site's header steps aside while you play
  syncTop();
  renderPanel(focusSel);
  updateHud();
  showKeys();
}

/* ---------- the panel ---------- */

// keep the screen on while playing (where the browser allows it)
let wakeLock = null;
let wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; /* not allowed: the screen may dim, that is all */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wantAwake) keepAwake(true); });
const panel = () => $('#gm-panel');
// where the game starts below the site's header: nowhere, on a phone mid-round (the header is hidden then)
function syncTop() {
  const mast = $('.masthead');
  const h = !mast ? 66 : S.mastH || (S.mastH = mast.offsetHeight || 66);
  document.documentElement.style.setProperty('--gm-top', `${isPhone() && PLAYING.has(S.phase) ? 0 : h}px`);
}

function bagBar() {
  if (S.mode === 'match') return '';
  if (!account.user) {
    return `<div class="gm-bagbar"><span>Starter bag</span><button class="chip" type="button" data-signin>Sign in to bring your bag</button></div>`;
  }
  const options = account.bags.map((b) => `<option value="${esc(b.id)}"${b.id === account.activeId ? ' selected' : ''}>${b.main ? '★ ' : ''}${esc(b.name)} (${b.discs.length})</option>`).join('');
  return `<div class="gm-bagbar"><label><span class="sr-only">Bag</span><select data-bag aria-label="Which bag">${options}</select></label>${S.bag.starter ? '<span>That bag is empty: playing the starter bag</span>' : ''}</div>`;
}

function discRow() {
  return `<div class="gm-discs" role="group" aria-label="Your discs, all ${S.bag.discs.length}">${S.bag.discs.map(({ disc, item }) => {
    const eaten = S.round.eaten.includes(disc.id);
    return `<button class="gm-disc" type="button" data-disc="${disc.id}" aria-pressed="${disc.id === S.discId}"${eaten ? ' disabled' : ''} title="${esc(disc.name)}${eaten ? ' (in Marebear\'s handbag)' : ''}">${discChip(disc, item)}<small>${esc(splitName(disc.name))}${eaten ? ' 🐻' : ''}</small></button>`;
  }).join('')}</div><p class="gm-more" aria-hidden="true">↕ Scroll for all ${S.bag.discs.length} discs</p>`;
}

function pickInfo(d, plan, putting) { // plan: { wind }
  const brand = DATA.brands[d.b].n;
  const r1 = (n) => Math.round(n * 10) / 10;
  const nums = `${d.speed} / ${d.glide} / ${d.turn > 0 ? `+${r1(d.turn)}` : r1(d.turn)} / ${r1(d.fade)}${d.worn ? ` · broken in ${d.worn}%` : ''}`;
  const out = putting
    ? `${Math.round(G.puttRadius(puttDd(), d) * G.puttGrip(S.hole) * 100)}%<small>target size</small>`
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
const tipHtml = () => (tipSeen() ? '' : `<div class="gm-tip"><p><b>How to play:</b> pick a disc, choose forehand or backhand, and aim (drag on the hole). Then <b>Throw</b> and tap four times: where you stop the power, nose and angle bars is your arm speed, how high the nose is tipped and your hyzer; the last tap is the release. A slow arm can grip lock or let go early, so watch the slip percentage. Trees stop low throws, water costs a stroke, and a triple bogey brings Marebear, who takes a disc.</p><button type="button" data-tip-close aria-label="Got it">×</button></div>`);

// Marebear's remark, in a card of its own under whatever it is about
function say(r, mood = 'bad') { // mood: 'bad' (she laughs), 'good' (she sulks, grudgingly) or 'sly'
  const text = typeof r === 'string' ? r : r?.text || '';
  S.quip = text;
  S.quipTo = (typeof r === 'object' && r?.to) || '';
  if (text) { S.lastQuip = text; popUp(text, S.quipTo, mood); try { localStorage.setItem('dj_said', JSON.stringify(T.memory())); } catch { /* not kept */ } }
}
const GOOD_EVENTS = new Set(['pure', 'ace', 'chains', 'sunk']);
const holeMood = (strokes, par, holed) => (!holed || strokes > par ? 'bad' : strokes === par ? 'sly' : 'good');
const phoneQuery = window.matchMedia('(max-width: 900px)');
const isPhone = () => phoneQuery.matches;
// a phone held sideways: the controls are a column beside the hole, not a dock under it
const landscapeQuery = window.matchMedia('(max-width: 900px) and (max-height: 520px)');
const isDock = () => phoneQuery.matches && !landscapeQuery.matches;
const PLAYING = new Set(['pick', 'power', 'nose', 'angle', 'release', 'putt', 'swipe', 'flight', 'result', 'bear', 'done', 'mturn', 'mhole']);
// (her remarks are Marebear herself, in a balloon: there is no text box of her quote in the panel)
const quipHtml = () => '';

/* ----- a phone: the hole fills the screen and the shot is set up a step at a time along the bottom ----- */

// how much of the screen the controls cover, so the camera frames the hole in what is left
function measureDock() {
  const d = isDock() ? Math.round(panel().getBoundingClientRect().height) : 0;
  const stage = $('#gm-stage');
  stage.classList.toggle('is-tight', isDock() && stage.clientHeight - d < 300); // so little hole is left that the zoom buttons would sit on the scoreboard
  if (d === S.dock) return;
  S.dock = d;
  stage.style.setProperty('--dock', `${d}px`);
  if (S.round) retarget(false);
}

// the caddy's note and Marebear's remarks float over the hole on a phone, and fade
function updateBubble() {
  const b = $('#gm-bubble');
  if (!b) return;
  let html = '';
  let key = '';
  if (isPhone() && !isMeter() && S.round) {
    if (S.phase === 'pick' && S.round.strokes === 0 && S.hole.note) { key = `c${S.hole.id}`; html = `<b>${esc(S.hole.name)}.</b> ${esc(S.hole.note)}${K.briefing(S.hole.variant, S.hole) ? ` <b>Today:</b> ${esc(K.briefing(S.hole.variant, S.hole))}` : ''}`; }
    // (her remarks come up as Marebear herself, in a balloon: no second copy here)
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
    body = `${betHtml()}${discRow()}${pickInfo(d, { wind: G.windFor(S.hole, heading()) }, putting)}${putting && puttDd() > G.LONG_PUTT ? '<p class="gm-note">Past 30 feet the target is a pinprick.</p>' : ''}${slopeNote()}`;
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
  const caddy = S.round.strokes === 0 && S.hole.note ? `<p class="gm-caddy"><b>${esc(S.hole.name)}.</b> ${esc(S.hole.note)}${K.briefing(S.hole.variant, S.hole) ? ` <b>Today:</b> ${esc(K.briefing(S.hole.variant, S.hole))}` : ''}</p>` : '';
  return `${roundBar()}${caddy || quipHtml()}${betHtml()}${S.mode === 'match' ? boardHtml() : tipHtml()}${bagBar()}
    <div class="gm-block">
      <p class="gm-h">Your disc <span>· ${available().length} left in the bag</span></p>
      ${discRow()}
      ${pickInfo(d, plan, putting)}
      ${slopeNote()}
    </div>
    ${putting
      ? `<p class="gm-sub"><b>${ft(dist)}</b> from the basket. One tap: catch the dot inside the green circle as it swirls past. Short putts get a big target and a slow dot; a faster disc shrinks it.${dist > G.LONG_PUTT ? ' <b>Past 30 feet it is a long shot: the target is a pinprick and the dot flies.</b>' : ''}</p>`
      : settingsBlock()}
    <div class="gm-go">
      <button class="btn" type="button" data-go>${putting ? 'Putt' : 'Throw'}</button>
      <p class="gm-go__line">Stroke <b>${strokes + 1}</b> · Par <b>${S.hole.par}</b> · ${putting ? `${ft(dist)} out` : `${ft(dist)} to the basket`}${slopeBit(S.hole, lieOf())}</p>
    </div>`;
}

function panelMenu() {
  const options = HOLES.map((h) => `<option value="${h.id}"${h.id === S.hole.id ? ' selected' : ''}>${h.id}. ${esc(h.name)} · par ${h.par}</option>`).join('');
  return `${bagBar()}
    <div class="gm-card">
      <h2>Play the course</h2>
      <p>Eighteen holes of woods, hills, water and wind. Pick a round, bring your bag, and try not to triple bogey: Marebear is watching, and she has a handbag.</p>
      <button class="btn" type="button" data-daily>Daily course<small>nine holes, the same for everyone today · a leaderboard</small></button>
      <button class="btn btn--ghost" type="button" data-trophies>Trophies and skins<small>${S.game.unlocked.filter((id) => GOALS.some((a) => a.id === id)).length} of ${GOALS.length} goals · break-in · disc skins</small></button>
      <button class="btn" type="button" data-solo="3">Quick warm-up<small>3 holes, about 5 minutes</small></button>
      <button class="btn btn--ghost" type="button" data-quick-friend>Play a friend now<small>one tap: a 9-hole match and a link to send</small></button>
      <div class="gm-menu">
        <button class="btn" type="button" data-solo="9">Front 9<small>par ${parTotal(HOLES.slice(0, 9))}</small></button>
        <button class="btn" type="button" data-solo="18">Full 18<small>par ${parTotal(HOLES)}</small></button>
      </div>
      <button class="btn btn--ghost" type="button" data-versus>Play with friends <small>up to 8 players, turn by turn</small></button>
      ${BETTING_ON ? `<p class="gm-note">Marebear Bucks: <b>${bucks()}</b> · she bets on every hole.</p>` : ''}
      <label class="gm-check"><input type="checkbox" data-cond${condOn() ? ' checked' : ''}> <span>Varied conditions: each round has its own wind, pin positions, a mando here and there, and dusk on the last holes.</span></label>
      <label class="gm-check"><input type="checkbox" data-rain${rainOn() ? ' checked' : ''}> <span>Allow rain: wet days where discs skid on landing and putts are slicker (off, unless you want it).</span></label>
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
  return `<div class="gm-card"><h2 class="is-bad">No discs left</h2><p>Marebear has your whole bag in her handbag. Round over.</p><button class="btn" type="button" data-again>Play again</button></div>`;
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
    putt: `Tap when the dot is in the green circle; a miss goes the way the dot was.${puttDd() > G.LONG_PUTT ? ' Past 30 ft the target is a pinprick.' : ''} ${d ? esc(d.name) : ''}, ${ft(toBasket())}.`,
  };
  const brief = (h) => (isPhone() && tipSeen() ? `${String(h).split('. ')[0].replace(/\.$/, '')}.` : h); // once you know the game, a phone gets the first sentence and keeps its screen
  const hint = `<div class="gm-meter__h">${Object.entries(hints).filter(([k]) => (k === 'putt') === (kind === 'putt')).map(([k, h]) => `<p${k === kind ? '' : ' aria-hidden="true"'}${k === kind ? '' : ' class="is-off"'}>${brief(h)}</p>`).join('')}<p class="is-off" aria-hidden="true">${brief(releaseHint(40))}</p></div>`;
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
  if (r.kind === 'mando') return { h: 'Missed the mando', tone: 'bad', p: 'You went the wrong side of the red post. That is a penalty stroke, and you throw again from the same spot.' };
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
    return `<div class="gm-card"><h2 class="is-bad">Marebear!</h2><p>${esc(name)} is at a triple bogey, and Marebear heard about it. She is slipping their ${esc(splitName(disc.name))} into her handbag.</p></div>`;
  }
  return `<div class="gm-card"><h2 class="is-bad">Marebear!</h2><p>Triple bogey, and Marebear heard about it. She is slipping your ${esc(splitName(disc.name))} into her handbag.</p></div>`;
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
    return `<li><b>${i + 1}</b> · ${esc(splitName(d.name))} · ${t.kind === 'basket' ? 'in the basket' : t.kind === 'water' || t.kind === 'oob' ? 'out of bounds (+1)' : t.kind === 'mando' ? 'missed the mando (+1)' : t.kind === 'tree' ? 'hit a tree' : `${ft(t.feet)}`}</li>`;
  }).join('');
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const par = c.card.reduce((n, h) => n + h.par, 0);
  return `<div class="gm-card">
      <h2 class="${r.holed && diff <= 0 ? 'is-good' : 'is-bad'}">${name}</h2>
      ${quipHtml()}
      <div class="gm-score"><div><b>${r.holed ? r.strokes : entry.score}</b><span>${r.holed ? 'Strokes' : 'Scored'}</span></div><div><b>${S.hole.par}</b><span>Par</span></div><div><b>${vsPar(entry.score - S.hole.par)}</b><span>To par</span></div></div>
      ${c.length > 1 ? `<p>Round so far: <b>${total}</b> (${vsPar(total - par)}) after ${c.card.length} ${c.card.length === 1 ? 'hole' : 'holes'}.</p>` : (S.best ? `<p>Best on this hole: <b>${S.best}</b></p>` : '')}
      <ol class="gm-log">${log}</ol>
      ${r.eaten.length ? `<p>Marebear has pocketed ${r.eaten.map((id) => esc(splitName(DISCS.get(id).name))).join(', ')}. She does not give them back.</p>` : ''}
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
      <h2 class="${total <= par ? 'is-good' : 'is-bad'}">${c.daily ? 'Daily course' : c.length === 1 ? 'Hole done' : c.length === 3 ? 'Warm-up done' : c.length === 9 ? 'Front nine' : 'Round complete'}</h2>
      <div class="gm-score"><div><b>${total}</b><span>Strokes</span></div><div><b>${par}</b><span>Par</span></div><div><b>${vsPar(total - par)}</b><span>To par</span></div></div>
      ${c.daily ? dailyPostHtml() : ''}
      ${highlightHtml(c.best && { move: c.best.move, hole: c.best.hole.name })}
      ${best ? `<p>Best ${c.length === 1 ? 'on this hole' : `${c.length}-hole round`}: <b>${best}</b>${!unfinished && total <= best ? ' (that is you, right now)' : ''}</p>` : ''}
      <ol class="gm-card-list">${rows}</ol>
      ${unfinished ? '<p>* Marebear took your bag, so the rest of the round does not count for much.</p>' : ''}
      <button class="btn" type="button" data-again>Play it again</button>
      ${c.daily ? '<button class="btn btn--ghost" type="button" data-daily>The daily board</button>' : ''}
      <button class="btn btn--ghost" type="button" data-menu>Back to the menu</button>
    </div>`;
}

function renderPanel(focusSel) {
  const p = panel();
  if (!p) return;
  const keepScroll = p.dataset.phase === S.phase ? p.scrollTop : 0;
  const views = { menu: panelMenu, pick: panelPick, power: panelMeter, nose: panelMeter, angle: panelMeter, release: panelMeter, putt: panelMeter, swipe: panelSwipe, flight: panelFlight, result: panelResult, bear: panelBear, done: panelDone, summary: panelSummary, lobby: panelLobby, mwait: panelMwait, mturn: panelMturn, mhole: panelMhole, mdone: panelMdone, daily: panelDaily, standings: panelStandings, trophies: panelTrophies };
  p.innerHTML = (views[S.phase] || (() => ''))();
  p.dataset.phase = S.phase;
  p.scrollTop = keepScroll;
  const dr = $('.gm-discs', p); // a bag with more discs than fit says so, and shows the edge of the next row
  if (dr) dr.classList.toggle('is-more', dr.scrollHeight > dr.clientHeight + 4);
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
    $('#gm-hud').innerHTML = `<span>Hole ${v.holeIdx + 1}/${v.holes} · ${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}${tagBit(h)}</small><span>You <b>${r.strokes}</b>${rivals}</span><small>${turn}${turn ? ' · ' : ''}${ft(G.distance(r.lie, h.basket))} to the basket${slopeBit(h, r.lie)}</small>`;
  } else if (!c && S.phase === 'menu' && h.id !== HOLES[0].id) { // the menu is previewing the hole picked for practice
    $('#gm-hud').innerHTML = `<span>${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small>`;
  } else if (!c) {
    $('#gm-hud').innerHTML = `<span>Disc Jerkers Golf Club</span><small>Eighteen holes · par ${parTotal(HOLES)}</small>`;
  } else {
    const total = c.card.reduce((n, x) => n + x.score, 0);
    const par = c.card.reduce((n, x) => n + x.par, 0);
    $('#gm-hud').innerHTML = `<span>${c.length > 1 ? `Hole ${c.idx + 1}/${c.holes.length} · ` : ''}${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}${tagBit(h)}</small><span>Strokes <b>${r.strokes}</b>${c.length > 1 && c.card.length ? ` · Round ${vsPar(total - par)}` : ''}</span><small>${ft(G.distance(r.lie, h.basket))} to the basket${slopeBit(h, r.lie)}</small>`;
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
    S.meter = { kind: 'putt', start: now(), radius: G.puttRadius(puttDd(), d) * G.puttGrip(S.hole), speed: G.puttSpeed(puttDd()), params: G.makePuttSeed(Math.random) };
    setPhase('putt');
  } else {
    // four taps: power, nose and angle each choose a value of the throw, then the release is graded
    S.meter = { kind: 'power', start: now(), mph: null, rel: null, sweet: {} };
    sweetFor('power');
    setPhase('power');
  }
}

// where a bar's sweet spot is, given what the earlier bars set: worked out as a bar begins, then drawn on it
// The sweet spots take hundreds of trial throws to find, so they are worked out a few milliseconds at a time between frames (the meter
// is on screen at once, and the lime bands appear when they are ready) instead of freezing the game for a moment at each stage.
function sweetFor(stage) {
  const d = curDisc();
  const meter = S.meter;
  if (!d || !meter) return;
  const base = { hand: S.settings.hand, style: S.settings.style, mph: S.settings.mph, spin: null, nose: stage === 'angle' ? S.settings.nose : 0, angle: 0 };
  const job = G.sweetJob(S.hole, d, base, heading(), lieOf(), stage);
  meter.sweet[stage] = [];
  const pump = () => {
    if (S.meter !== meter) return; // the throw moved on
    const t0 = performance.now();
    while (!job.done() && performance.now() - t0 < 5) job.next(2);
    if (!job.done()) { setTimeout(pump, 0); return; }
    meter.sweet[stage] = G.sweetBands(job.result());
    const bar = $('#gm-bar');
    if (bar && S.phase === stage) { bar.querySelectorAll('.gm-zone--sweet').forEach((e) => e.remove()); bar.insertAdjacentHTML('afterbegin', sweetMarkup(stage)); }
  };
  setTimeout(pump, 0);
}

function tap() {
  const m = S.meter;
  if (!m) return;
  SND.play('tap');
  if (navigator.vibrate) navigator.vibrate(8); // a small click under the thumb
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
  const ace = result.kind === 'basket';
  const flightMs = camDur(clamp(900 + result.plan.feet * 4.2, 1200, 3300)) * (ace ? 1.5 : 1);
  S.anim = { type: 'flight', t0: now(), dur: flightMs, pts: result.pts, roll: result.roll, result, cine: ace };
  SND.play('throw', clamp(S.settings.mph / 90, 0.2, 1));
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

// the same film, slower: every moment later, and each one longer
function slowScript(sc, k) {
  const marks = {};
  for (const [n, v] of Object.entries(sc.marks)) marks[n] = v * k;
  return { ...sc, total: sc.total * k, tail: sc.tail * k, marks, at: (ms) => sc.at(ms / k) };
}

// the sounds of a putt, at the moments of its film (or all at once on the map)
function puttSounds(sc, result) {
  const at = (ms, name, arg) => setTimeout(() => SND.play(name, arg), Math.max(0, ms));
  at(0, 'throw', 0.25);
  const m = sc?.marks || {};
  if (result.made) {
    at(m.dropAt ?? 500, 'chains', result.finish === 'swish' ? 1 : 0.8);
    at((m.dropAt ?? 500) + 200, 'clunk');
    if (result.finish === 'swish' && result.dist > 30) at((m.dropAt ?? 500) + 450, 'ding');
  } else if (result.rim) {
    at(m.rimAt ?? m.dropAt ?? 600, 'clank');
    at((m.spitAt ?? ((m.rimAt ?? 600) + 700)) + 250, 'womp');
  } else {
    at(m.landAt ?? 700, 'land');
    if (result.nasty) at((m.rollAt ?? 800) + 150, 'womp');
  }
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
  const long = result.made && !result.gimme && result.dist > 30; // a long one going in is worth slowing down for
  const sc = film && long ? slowScript(script, 1.4) : script;
  puttSounds(film ? sc : null, result);
  if (S.last) S.last.sfx = true;
  return { type: 'flight', t0: now(), dur: film ? sc.total : 750, pts, roll: [], result, putt: true, script: sc, tail: film ? sc.tail : 350, cine: long };
}

/* ----- the swipe: after the radar, DRAW BACK and then SWIPE FORWARD toward the basket, in one smooth motion. True in aim and in power, or it misses. ----- */

// How far the forward stroke must run, in pixels, to be exactly enough: longer for a longer putt, or a harder arm.
const swipeNeed = () => (H - S.dock) * (S.meter?.throwEx ? 0.2 + 0.0035 * S.settings.mph : 0.15 + 0.0055 * G.puttPush(S.hole, lieOf())); // uphill takes more push
const swipeTol = () => (S.meter?.throwEx ? G.DRIVE_SWIPE : G.swipeTolerance(puttDd()));
// where the disc is on the screen for the guide: high enough that there is room below it to draw back
const swipeAnchor = () => ({ x: W / 2, y: (H - S.dock) * 0.66 });

function startSwipe(shot = null, throwEx = null) {
  S.meter = { kind: 'swipe', shot, throwEx, drag: null };
  setPhase('swipe');
}
function panelSwipe() {
  const drive = !!S.meter?.throwEx;
  const brief = isPhone() && tipSeen(); // once you know it, a phone gets one line, so the hole (and your swipe) has the room
  const text = pullInput()
    ? `Press on the disc (either mouse button), drag straight down to wind up (how far is the power: reach the gold mark for full power), then drag back up and let go. Where your way back up leaves from decides the aim, so keep it straight; a wobbly or short way back loses power. On a trackpad you can click once, wind up and swing back with no button held, and click again. Or use the arrow keys and Enter, or a controller: right stick back then forward.`
    : brief
    ? 'Draw back, then swipe up in one motion. Stay in the lime lines and stop in the band.'
    : drive
      ? 'Draw back down the screen, then swipe forward up it, in one smooth motion, from anywhere. The forward swipe is the throw: stay inside the lime lines and stop in the lime band. A short draw back costs power; off line steers the throw, too soft loses distance, too hard makes it loose.'
      : 'Draw back down the screen, then swipe forward up it, in one smooth motion, from anywhere. The forward swipe is the putt: stay inside the lime lines and stop in the lime band. A short draw back costs power; too soft dies short, too hard runs long, and off line misses.';
  return `<div class="gm-meter ${drive ? '' : 'gm-meter--putt'}">
      <p class="gm-meter__t"><span>${drive ? 5 : 2} ·</span> ${pullInput() ? 'Wind up, swing' : 'Draw back, swipe'}</p>
      <div class="gm-meter__h"><p>${text}</p></div>
    </div>`;
}
function swipePoint(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
/* One smooth motion, in two strokes. You draw back (down the screen), turn, and swipe forward (up it). The forward stroke is judged where
   it ends, and it ends the moment you stop moving, pull back, or lift: you cannot stop at the end and nudge it. A pause of about a tenth
   of a second commits it where you paused; pulling back commits it at the farthest point you reached; a forward stroke too slow to be a
   swipe is thrown out; and holding at the bottom of the draw back gets you nothing but another try. */
const SWIPE = { minBack: 30, minLen: 28, minPeak: 260, slow: 150, pauseMs: 110, backPx: 14, turnPx: 12, holdMs: 700 }; // px, px per second, ms
const now2 = () => performance.now();
const swipeNote = (text) => { if (S.meter) S.meter.note = { text, until: now2() + 1600 }; };
function beginSwipe(e) {
  const p = swipePoint(e);
  const t = now2();
  const m = S.meter;
  const swing = e.pointerType === 'mouse' || e.pointerType === 'pen'; // a mouse or trackpad swings down and back up; a finger draws back and swipes
  if (swing && m.swing?.armed) { // the second click of a click-swing-click throw (for a trackpad, where holding and dragging is awkward)
    const sw = m.swing;
    sw.pts.push({ x: p.x, y: p.y });
    m.swing = null;
    commitSwing(sw.pts);
    return;
  }
  if (swing) {
    const an = swipeAnchor();
    if (Math.hypot(p.x - an.x, p.y - an.y) > SWING.startR) { swipeNote('PRESS ON THE DISC'); return; }
    m.swing = { pts: [{ x: p.x, y: p.y }], held: true, armed: false };
    S.meter.drag = { mode: 'swing', x0: p.x, y0: p.y, x: p.x, y: p.y, lastMove: t };
    try { cv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    return;
  }
  S.meter.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, mode: 'swipe', phase: 'start', samples: [{ x: p.x, y: p.y, t }], backLen: 0, backPt: { x: p.x, y: p.y }, fwdLen: 0, fwdPt: null, peak: 0, speed: 0, slowPt: null, slowT: 0, lastMove: t };
  try { cv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
}
function moveSwipe(e) {
  const d = S.meter?.drag;
  if (!d) { // armed (clicked once): the swing follows the pointer without a button held
    const sw = S.meter?.swing;
    if (sw?.armed) { const q = swipePoint(e); addSwingPoint(sw, q); }
    return;
  }
  const p = swipePoint(e);
  const t = now2();
  d.x = p.x;
  d.y = p.y;
  d.lastMove = t;
  if (d.mode === 'swing') { addSwingPoint(S.meter.swing, p); return; } // a swing has no timing: only where it goes
  d.samples.push({ x: p.x, y: p.y, t });
  while (d.samples.length > 2 && t - d.samples[0].t > 400) d.samples.shift();
  const fromStart = Math.hypot(p.x - d.x0, p.y - d.y0);
  if (d.phase === 'start' && fromStart >= 18) d.phase = p.y > d.y0 ? 'back' : 'wrong'; // down first, or it is not a draw back
  if (d.phase === 'back') {
    if (fromStart > d.backLen) { d.backLen = fromStart; d.backPt = { x: p.x, y: p.y }; } // the farthest you have drawn back
    else if (d.backLen >= SWIPE.minBack && fromStart < d.backLen - SWIPE.turnPx) { // turned round: the forward stroke begins
      d.phase = 'forward';
      d.fwdLen = 0;
      d.fwdPt = { x: d.backPt.x, y: d.backPt.y };
      d.samples = [{ x: p.x, y: p.y, t }];
    }
  }
  if (d.phase === 'forward') {
    const fl = Math.hypot(p.x - d.backPt.x, p.y - d.backPt.y);
    if (fl > d.fwdLen) { d.fwdLen = fl; d.fwdPt = { x: p.x, y: p.y }; }
    // how fast the finger is going: over the last 60 to 120 ms
    const ref = [...d.samples].reverse().find((q) => t - q.t >= 60) || d.samples[0];
    const speed = t - ref.t > 0 ? (Math.hypot(p.x - ref.x, p.y - ref.y) / (t - ref.t)) * 1000 : 0;
    d.speed = speed;
    if (speed > d.peak) d.peak = speed;
    if (d.peak >= SWIPE.minPeak && speed < SWIPE.slow) { if (!d.slowPt) { d.slowPt = { x: p.x, y: p.y }; d.slowT = t; } } else d.slowPt = null;
    if (d.fwdLen > SWIPE.minLen && fl < d.fwdLen - SWIPE.backPx) commitSwipe(d.fwdPt); // pulling back: it counts where it got to
  }
}
// every frame: a finger that has stopped (or is holding still, so sends nothing) ends the forward stroke where it stopped
function tickSwipe() {
  const d = S.phase === 'swipe' ? S.meter?.drag : null;
  if (!d || d.mode === 'swing') return;
  const t = now2();
  if (d.phase === 'back' && t - d.lastMove > SWIPE.holdMs) { S.meter.drag = null; swipeNote('NO HOLDING: DRAW BACK AND GO'); return; }
  if (d.phase !== 'forward' || d.peak < SWIPE.minPeak) return;
  if (d.slowPt && t - d.slowT > SWIPE.pauseMs) commitSwipe(d.slowPt);
  else if (t - d.lastMove > SWIPE.pauseMs + 30) commitSwipe({ x: d.x, y: d.y });
}
function endSwipe() {
  const d = S.meter?.drag;
  if (S.phase !== 'swipe' || !d) return;
  S.meter.drag = null;
  if (d.mode === 'swing') { // let go: the swing is done; a plain click (no movement) arms it instead, for a trackpad
    const sw = S.meter.swing;
    if (sw && sw.pts.length < 6 && Math.hypot(d.x - d.x0, d.y - d.y0) < 12) { sw.armed = true; sw.held = false; swipeNote('NOW DRAG DOWN AND BACK UP, THEN CLICK'); return; }
    S.meter.swing = null;
    if (sw) commitSwing(sw.pts);
    return;
  }
  if (d.phase === 'forward') {
    if (d.peak < SWIPE.minPeak) { if (d.fwdLen > SWIPE.minLen) swipeNote('TOO SLOW: ONE QUICK SWIPE'); return; } // a drag, not a swipe: try again
    S.meter.drag = d;
    commitSwipe(d.fwdLen > Math.hypot(d.x - d.backPt.x, d.y - d.backPt.y) + SWIPE.backPx ? d.fwdPt : { x: d.x, y: d.y });
  } else if (d.phase === 'wrong') swipeNote('DRAW BACK FIRST, THEN SWIPE UP');
  else if (d.phase === 'back') swipeNote('NOW SWIPE FORWARD');
}
function commitSwipe(pt) {
  const m = S.meter;
  const d = m?.drag;
  if (S.phase !== 'swipe' || !d || d.phase !== 'forward') return;
  m.drag = null;
  const dx = pt.x - d.backPt.x;
  const dy = pt.y - d.backPt.y;
  const len = Math.hypot(dx, dy);
  if (len < SWIPE.minLen) return; // a tap, not a swipe: try again
  finishSwipe({ aim: Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) * 10) / 10, power: Math.round(swipePower(len, d.backLen) * 1000) / 1000 });
}
/* The mouse swing (a mouse, a trackpad, a pen): press on the disc, drag straight down to wind up, then drag back up and let go. How far down you went is
   the power; where your stroke comes back up (the line from the bottom of the wind-up to where it gets back level with the disc) is the aim, so a crooked way
   back sends it crooked; a wobbly way back and a stroke that does not get all the way back up both lose power. There is no timing. It is the way Disc Golf
   Masters' mouse throw is described (press the ball, drag it down and back up). The same {aim, power} goes to the rules as a swipe does. */
const SWING = { startR: 90, minBack: 30, ratio: 0.8, step: 2 }; // ratio: a wind-up this fraction of the swipe's length is exactly enough
const swingHalfWidth = () => clamp(swipeNeed() * 0.07, 12, 24); // how far off the straight way back still counts as straight, in pixels
function addSwingPoint(sw, p) {
  const last = sw.pts.at(-1);
  if (Math.hypot(p.x - last.x, p.y - last.y) >= SWING.step) sw.pts.push({ x: p.x, y: p.y });
}
// how a swing comes out: { depth, phase ('back' while still winding up, 'up' once on the way back), aim, power, reach, wobble, bottom, top }
function swingStats(pts) {
  const a = pts[0];
  let bi = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].y > pts[bi].y) bi = i;
  const bottom = pts[bi];
  const depth = bottom.y - a.y;
  const end = pts.at(-1);
  const turned = depth >= SWING.minBack && bottom.y - end.y > 10; // it has come back up from the bottom
  if (!turned) return { depth, phase: 'back', bottom, top: bottom, aim: 0, power: Math.round((Math.max(0, depth) / (swipeNeed() * SWING.ratio)) * 1000) / 1000, reach: 0, wobble: 0 };
  let top = end;
  for (let i = bi + 1; i < pts.length; i++) { // where the way back gets level with the disc
    if (pts[i].y <= a.y) { const q = pts[i - 1]; const f = (q.y - a.y) / Math.max(0.001, q.y - pts[i].y); top = { x: q.x + (pts[i].x - q.x) * f, y: a.y }; break; }
  }
  const reach = clamp((bottom.y - top.y) / depth, 0, 1); // 1: all the way back up to where it started
  const aim = Math.round(((Math.atan2(top.x - bottom.x, Math.max(1, bottom.y - top.y)) * 180) / Math.PI) * 10) / 10;
  const chord = Math.hypot(top.x - bottom.x, top.y - bottom.y) || 1;
  let sq = 0;
  let n = 0;
  for (let i = bi; i < pts.length; i++) {
    const q = pts[i];
    if (q.y < top.y - 2) break;
    const dev = Math.abs((top.x - bottom.x) * (bottom.y - q.y) - (bottom.x - q.x) * (top.y - bottom.y)) / chord; // off the straight way back
    sq += dev * dev;
    n++;
  }
  const wobble = Math.sqrt(sq / Math.max(1, n));
  const steady = clamp(wobble / swingHalfWidth() - 0.4, 0, 1); // a little wander is free; a lot costs up to a quarter of the power
  const power = Math.max(0, (depth / (swipeNeed() * SWING.ratio)) * (reach < 1 ? reach : 1) * (1 - 0.25 * steady));
  return { depth, phase: 'up', bottom, top, aim, power: Math.round(power * 1000) / 1000, reach, wobble };
}
function commitSwing(pts) {
  if (!pts || pts.length < 2) return;
  const r = swingStats(pts);
  if (r.depth < SWING.minBack) { swipeNote('DRAG DOWN FIRST'); return; }
  if (r.phase === 'back') { swipeNote('NOW DRAG BACK UP, THEN LET GO'); return; }
  if (Math.abs(r.aim) > 60) { swipeNote('DRAG STRAIGHT BACK UP'); return; }
  finishSwipe({ aim: r.aim, power: r.power });
}
// the throw (or putt) itself, from an aim and a power however they were made
function finishSwipe(swipe) {
  const m = S.meter;
  if (!m || S.phase !== 'swipe') return;
  m.drag = null;
  m.kb = null;
  m.swing = null;
  m.padSwing = null;
  if (m.throwEx) {
    const ex = G.withSwipe(m.throwEx, swipe);
    // solo rolls the slip here; in a match the server does, and the throw comes back with it
    throwDisc(S.mode === 'match' ? ex : G.applySlip(ex, G.rollSlip(curDisc(), S.settings, Math.random())));
  } else {
    puttDisc(m.shot, swipe);
  }
}
// the power of a swipe: how far the forward stroke ran against what is needed, and a short draw back (under 60% of the forward stroke) costs up to 40% of it
const swipePower = (fwd, back) => (fwd / swipeNeed()) * (0.6 + 0.4 * Math.min(1, back / (0.6 * fwd)));

// the guide you swipe by: the cone to stay inside, the band to stop in, a marker for how far to draw back, and your own two strokes
function drawSwipeGuide() {
  tickSwipe();
  const m = S.meter;
  if (!m || m.kind !== 'swipe' || S.phase !== 'swipe') return;
  const need = swipeNeed();
  const tol = swipeTol();
  const d = m.drag;
  const { x: ax, y: ay } = swipeAnchor(); // the guide stays where it is, wherever on the screen the finger lands: your swipe is drawn inside it
  const rad = (deg) => (deg * Math.PI) / 180;
  const label = (text, x, y, color = '#eef1e8', size = 26, align = 'center') => {
    ctx.font = `400 ${size}px "Anton", Impact, sans-serif`;
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 5;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };
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
  // how far to draw back: a mark below the disc
  const backTo = ay + 0.6 * need;
  if (!pullInput()) { // (a mouse winds up and swings back with its own gold mark, and has no draw back to mark here)
    ctx.strokeStyle = 'rgba(242,193,78,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ax, ay + 6);
    ctx.lineTo(ax, backTo);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax - 16, backTo);
    ctx.lineTo(ax + 16, backTo);
    ctx.stroke();
  }
  // a swipe set with the keys or a stick: shown as the throw it would make, coloured by how true it is
  const vec = m.kb ? { aim: m.kb.aim, power: m.kb.power } : null;
  const sw = m.swing;
  if (vec) {
    const q = Math.max(Math.abs(vec.aim) / tol.aim, Math.abs(vec.power - 1) / tol.power);
    const c = q <= 1 ? '#a3e635' : q <= 1.5 ? '#f2c14e' : '#ff6a3a';
    const ex = ax + Math.sin(rad(vec.aim)) * need * vec.power;
    const ey = ay - Math.cos(rad(vec.aim)) * need * vec.power;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.strokeStyle = c;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, ey, 11, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(`${Math.round(vec.power * 100)}%`, ex + 18, ey + 5);
    ctx.fillText(`${Math.round(vec.power * 100)}%`, ex + 18, ey + 5);
    label('ENTER OR A TO THROW', W / 2, Math.min(backTo + 44, H - S.dock - 14), '#eef1e8', Math.min(22, W / 15));
    ctx.restore();
    return;
  }
  if (sw || pullInput()) { // the mouse swing: down to wind up, back up to throw; shown as the throw it is making, coloured by how true it is
    const hw = swingHalfWidth();
    const sx = sw ? sw.pts[0].x : ax;
    const sy = sw ? sw.pts[0].y : ay;
    const target = sy + need * SWING.ratio; // how far down is exactly enough
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(163,230,53,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - need * 0.2);
    ctx.lineTo(sx, target + 14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(242,193,78,0.95)'; // the gold mark: wind up this far for full power
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - hw - 12, target);
    ctx.lineTo(sx + hw + 12, target);
    ctx.stroke();
    if (!sw) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      ctx.beginPath();
      ctx.arc(ax, ay, SWING.startR * 0.5 + pulse * 4, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(238,241,232,${0.35 + 0.4 * pulse})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      if (m.note && m.note.until > now2()) label(m.note.text, W / 2, Math.min(target + 44, H - S.dock - 14), '#f2c14e', 22);
      else label('PRESS THE DISC, DRAG DOWN, THEN UP', W / 2, Math.min(target + 44, H - S.dock - 14), '#eef1e8', Math.min(22, W / 17));
      ctx.restore();
      return;
    }
    const st = swingStats(sw.pts);
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    for (let i = 1; i < sw.pts.length; i++) {
      const a0 = sw.pts[i - 1];
      const b0 = sw.pts[i];
      const way = st.phase === 'up' && b0.y <= st.bottom.y && i > sw.pts.indexOf(st.bottom); // the way back up is graded; the wind-up is just drawn
      let col = 'rgba(242,193,78,0.85)';
      if (way) {
        const chord = Math.hypot(st.top.x - st.bottom.x, st.top.y - st.bottom.y) || 1;
        const dev = Math.abs((st.top.x - st.bottom.x) * (st.bottom.y - b0.y) - (st.bottom.x - b0.x) * (st.top.y - st.bottom.y)) / chord;
        col = dev > hw ? '#ff6a3a' : '#a3e635';
      }
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(b0.x, b0.y);
      ctx.strokeStyle = col;
      ctx.stroke();
    }
    const e = sw.pts.at(-1);
    const q = st.phase === 'up' ? Math.max(Math.abs(st.aim) / tol.aim, Math.abs(st.power - 1) / tol.power) : Math.abs(st.power - 1) / tol.power;
    const c = q <= 1 ? '#a3e635' : q <= 1.5 ? '#f2c14e' : '#ff6a3a';
    if (st.phase === 'up') { // what the throw would be, from the disc
      const ex = ax + Math.sin(rad(st.aim)) * need * st.power;
      const ey = ay - Math.cos(rad(st.aim)) * need * st.power;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = c;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, ey, 11, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(e.x, e.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(238,241,232,0.9)';
    ctx.fill();
    ctx.font = '700 14px "Space Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeText(`${Math.round(st.power * 100)}%`, e.x + 16, e.y + 5);
    ctx.fillText(`${Math.round(st.power * 100)}%`, e.x + 16, e.y + 5);
    const hint = sw.armed ? 'CLICK TO LET GO' : st.depth < SWING.minBack ? 'DRAG DOWN' : st.phase === 'back' ? 'NOW BACK UP' : 'LET GO';
    label(hint, W / 2, Math.min(target + 44, H - S.dock - 14), '#f2c14e', Math.min(22, W / 15));
    ctx.restore();
    return;
  }
  if (m.padSwing && m.padSwing.peak > 0.1) { // a controller: the stick pulled back sets the power
    const mark = ay + m.padSwing.peak * need;
    ctx.strokeStyle = 'rgba(242,193,78,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax, mark);
    ctx.stroke();
    ctx.fillStyle = '#f2c14e';
    ctx.beginPath();
    ctx.arc(ax, mark, 9, 0, Math.PI * 2);
    ctx.fill();
    label(`${Math.round((m.padSwing.peak / PAD_SWING_RATIO) * 100)}%  NOW PUSH FORWARD`, W / 2, Math.min(ay + need + 44, H - S.dock - 14), '#f2c14e', Math.min(22, W / 15));
  }
  if (!d) {
    const pulse = (performance.now() / 700) % 1;
    for (let i = 0; i < 3; i++) { // chevrons run down (draw back), then up (swipe): the order to do it in
      const k = (i + pulse) % 3;
      const y = ay + 18 + k * 20;
      ctx.beginPath();
      ctx.moveTo(ax - 11, y - 6);
      ctx.lineTo(ax, y + 5);
      ctx.lineTo(ax + 11, y - 6);
      ctx.strokeStyle = `rgba(242,193,78,${0.9 - k * 0.28})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    if (m.note && m.note.until > now2()) label(m.note.text, W / 2, Math.min(backTo + 44, H - S.dock - 14), '#f2c14e', 24);
    else label('DRAW BACK, THEN SWIPE UP', W / 2, Math.min(backTo + 44, H - S.dock - 14), '#eef1e8', Math.min(24, W / 14));
  } else {
    const color = (aim, power) => { const q = Math.max(Math.abs(aim) / tol.aim, Math.abs(power - 1) / tol.power); return q <= 1 ? '#a3e635' : q <= 1.5 ? '#f2c14e' : '#ff6a3a'; };
    // where the finger really is, faintly
    ctx.beginPath();
    ctx.moveTo(d.x0, d.y0);
    ctx.lineTo(d.x, d.y);
    ctx.strokeStyle = 'rgba(238,241,232,0.22)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(d.x, d.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(238,241,232,0.28)';
    ctx.fill();
    if (d.phase === 'start' || d.phase === 'wrong') {
      if (d.phase === 'wrong') label('DRAW BACK FIRST', W / 2, ay + 0.6 * need + 44, '#ff6a3a', 24);
    } else {
      // the draw back, as a band pulled out below the disc
      const bx = ax + (d.backPt.x - d.x0);
      const by = ay + (d.backPt.y - d.y0);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.strokeStyle = d.phase === 'back' ? '#f2c14e' : 'rgba(242,193,78,0.55)';
      ctx.lineWidth = 6;
      ctx.stroke();
      if (d.phase === 'back') {
        ctx.beginPath();
        ctx.arc(bx, by, 11, 0, Math.PI * 2);
        ctx.fillStyle = '#f2c14e';
        ctx.fill();
        if (d.backLen >= SWIPE.minBack) label('NOW SWIPE UP!', W / 2, Math.min(by + 44, H - S.dock - 14), '#f2c14e', 24);
      } else {
        // the forward stroke, drawn from the disc, coloured by how true it is right now
        const fx = d.x - d.backPt.x;
        const fy = d.y - d.backPt.y;
        const len = Math.hypot(fx, fy);
        const aim = (Math.atan2(fx, -fy) * 180) / Math.PI;
        const power = len > 0 ? swipePower(len, d.backLen) : 0;
        const c = color(aim, power);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + fx, ay + fy);
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 11;
        ctx.stroke();
        ctx.strokeStyle = c;
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ax + fx, ay + fy, 11, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.font = '700 14px "Space Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 4;
        ctx.strokeText(`${Math.round(power * 100)}%`, ax + fx + 18, ay + fy + 5);
        ctx.fillText(`${Math.round(power * 100)}%`, ax + fx + 18, ay + fy + 5);
      }
    }
  }
  ctx.restore();
}

// what a landing sounds like (a putt has its own film sounds, already scheduled)
function landSounds(result, ev) {
  if (S.last?.sfx) return;
  if (result.kind === 'tree') SND.play('thunk');
  else if (result.kind === 'water' || result.kind === 'oob') SND.play('splash');
  else if (result.kind === 'mando') SND.play('womp');
  else if (result.kind === 'basket') { SND.play('chains'); if (!result.gimme) setTimeout(() => SND.play('fanfare'), 350); }
  else { SND.play('land'); if ((result.roll || []).length >= 3) setTimeout(() => SND.play('skip'), 90); }
  if (ev === 'pure') setTimeout(() => SND.play('ding'), 200);
}

// a disc that lands skips and hops along before it settles: how high it is a fraction p of the way through its roll
const hopH = (p, n) => (n >= 3 ? 2.6 * (1 - p) ** 1.5 * Math.abs(Math.sin(p * Math.PI * 3)) : 0);

// the letterbox bars for a moment worth watching: an ace, a long putt going in
function drawCine(t) {
  const a = S.anim;
  if (!a?.cine) return;
  const k = clamp((t - a.t0) / 450, 0, 1);
  const bar = Math.round(H * 0.085 * (1 - (1 - k) ** 3));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  ctx.fillRect(0, 0, W, bar);
  ctx.fillRect(0, H - bar, W, bar);
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
  if (S.replay) { endReplay(); return; }
  if (S.mode === 'match') { finishMove(); return; }
  const { result, disc, from } = S.last;
  const out = G.applyResult(S.round, disc, result);
  const ev = T.eventFor({ kind: result.kind, putt: !result.plan, made: result.made, gimme: result.gimme, ex: S.last.ex, strokes: S.round.strokes, dist: result.dist, surface: result.surface, rim: result.rim, nasty: result.nasty, why: result.why });
  landSounds(result, ev);
  trackThrow({ discId: disc.id, putt: !result.plan, made: result.made, gimme: result.gimme, dist: result.dist, kind: result.kind, feet: result.plan?.feet });
  if (S.course && result.strokes > 1) S.course.penalties = (S.course.penalties || 0) + 1;
  if (S.course) { // keep the best throw of the round, to watch again
    const mv = moveOf(result, disc, from, S.last.ex);
    const sc = G.highlightScore(mv);
    if (sc > (S.course.best?.score || 0)) S.course.best = { score: sc, move: mv, hole: S.hole };
  }
  say(T.remark(ev, { who: 'me' }, Math.random, S.lastQuip), GOOD_EVENTS.has(ev) ? 'good' : 'bad');
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
  say(T.holeRemark(r.strokes, S.hole.par, r.holed, Math.random, S.lastQuip), holeMood(r.strokes, S.hole.par, r.holed));
  settleBet(r.strokes, S.hole.par, r.holed, S.hole.id);
  trackHole({ strokes: r.strokes, par: S.hole.par, holed: r.holed, rain: !!S.hole.weather?.rain });
  if (r.holed && r.strokes <= S.hole.par - 2) SND.play('fanfare'); else if (r.holed && r.strokes < S.hole.par) SND.play('ding');
  setPhase('done');
  retarget(false);
}

// the round is over: remember the best, and show the card
function finishCourse() {
  const c = S.course;
  const total = c.card.reduce((n, h) => n + h.score, 0);
  const complete = c.card.length === c.holes.length && c.card.every((h) => h.holed);
  announce(PR.recordRound(S.game, { holes: c.card.length, penalties: c.penalties || 0 }));
  if (c.daily) { postDaily(); S.best = null; setPhase('summary'); retarget(false); return; } // the daily has a board, not a personal best
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
let ctx = cv.getContext('2d'); // (let: the still parts of the picture are drawn into a picture of their own, see drawStill)
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

function drawCourse() {
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
  }
  ctx.restore();
  // the lay of the land over all of it: hill shading, mown stripes, grass flecks and contour lines
  const layer = GR.mapLayer(h);
  if (layer) {
    const [lx, ly] = P(layer.minX, layer.maxY);
    ctx.save();
    ctx.globalAlpha = clamp((performance.now() - layer.readyAt) / 500, 0, 1); // it fades in when it is ready, instead of popping
    ctx.drawImage(layer.canvas, lx, ly, layer.w * cam.s, layer.h * cam.s);
    ctx.restore();
  }
}

// the ripples on the water, which are the one part of the ground that moves: drawn on top of the still picture, only where they can be seen
function drawWaves(t) {
  const h = S.hole;
  if (!h.water.length) return;
  const lo = toWorld(0, H);
  const hi = toWorld(W, 0);
  const bb = h.bounds;
  const [bx0, by0] = P(bb.minX, bb.maxY);
  const [bx1, by1] = P(bb.maxX, bb.minY);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bx0, by0, bx1 - bx0, by1 - by0); // a creek runs on past the edge of the course, so it is cut off there
  ctx.clip();
  ctx.strokeStyle = 'rgba(190,230,245,0.18)';
  ctx.lineWidth = 1;
  for (const w of h.water) {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const q of w) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    if (x1 < lo.x || x0 > hi.x || y1 < lo.y || y0 > hi.y) continue; // off the screen
    ctx.save();
    poly(w);
    ctx.clip();
    for (let y = Math.max(y0, Math.floor(lo.y / 14) * 14); y < Math.min(y1, hi.y); y += 14) {
      ctx.beginPath();
      let first = true;
      for (let x = Math.max(x0, lo.x - 6); x <= Math.min(x1, hi.x + 6); x += 6) {
        const [sx, sy] = P(x, y + Math.sin(x * 0.12 + t / 700 + y) * 2);
        if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/* ----- the parts of the picture that do not move are drawn once ----- */

// The ground and the trees (a thousand of them on some holes) are the same picture frame after frame while the camera is still, which is
// most of the time. So once the camera has settled they are drawn into pictures of their own, and each frame just lays those down.
const still = { key: '', n: 0, ground: null, trees: null };
const stillKey = () => [S.hole.id, S.hole.variant?.seed ?? '', S.hole.basket.x, S.hole.basket.y, W, H, dpr, cam.x.toFixed(2), cam.y.toFixed(2), cam.s.toFixed(4), GR.mapLayer(S.hole) ? 1 : 0].join('|');
function drawStill(which, draw) {
  const key = stillKey();
  if (still.key !== key) { still.key = key; still.n = 0; still.ground = still.trees = null; } else still.n += which === 'ground' ? 1 : 0;
  if (still[which]) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(still[which], 0, 0); ctx.restore(); return; }
  const layer = GR.mapLayer(S.hole);
  const fading = !!layer && performance.now() - layer.readyAt < 520; // the map's shading is fading in: wait until it has
  if (still.n >= 3 && !fading) { // the camera has settled: draw this part into a picture, once
    const off = document.createElement('canvas');
    off.width = cv.width;
    off.height = cv.height;
    const main = ctx;
    ctx = off.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { draw(); still[which] = off; } finally { ctx = main; }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();
    return;
  }
  draw();
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

// a mando on the map: a red post, the line you may not cross dashed out from it, and an arrow for the way round
function drawMandoMap() {
  const m = S.hole.mando;
  if (!m) return;
  const [px, py] = P(m.x, m.y);
  const [ex, ey] = P(m.x + m.dx * m.len, m.y + m.dy * m.len);
  ctx.save();
  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = 'rgba(255,90,70,0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#d6342a';
  ctx.strokeStyle = '#f4f1e6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(5, 2.2 * cam.s), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // the way round: away from the dashed line (world y runs up the screen, so it is flipped)
  const tipX = px - m.dx * 28;
  const tipY = py + m.dy * 28;
  ctx.strokeStyle = '#f4f1e6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(tipX, tipY);
  const a0 = Math.atan2(tipY - py, tipX - px);
  ctx.lineTo(tipX - Math.cos(a0 - 0.5) * 9, tipY - Math.sin(a0 - 0.5) * 9);
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - Math.cos(a0 + 0.5) * 9, tipY - Math.sin(a0 + 0.5) * 9);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#f4f1e6';
  ctx.font = '700 10px "Space Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MANDO', px, py - Math.max(10, 3.4 * cam.s));
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

// the aim line and its band only change when something about the throw does, not every frame
function previewNow(lie) {
  const d = curDisc();
  const key = [S.hole.id, S.hole.wind.mph, S.hole.wind.from, S.hole.basket.x, S.hole.basket.y, d.id, d.turn, S.settings.hand, S.settings.style, heading(), lie.x, lie.y].join('|');
  if (S.previewKey !== key) {
    S.previewKey = key;
    S.preview = { pv: G.previewThrow(S.hole, d, S.settings, heading(), lie), end: G.previewThrow(S.hole, d, S.settings, heading(), lie, 8).end };
  }
  return S.preview;
}
function drawPreview() {
  if (S.phase !== 'pick' || !S.showLine || !curDisc()) return;
  const lie = lieOf();
  if (inPutt()) {
    poly([lie, S.hole.basket].map((p) => [p.x, p.y]), false);
  } else {
    // a typical throw with this disc, and the shaded ground a mistimed release can reach; the meters decide the real one
    const { pv, end } = previewNow(lie);
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
    const { end } = previewNow(lie);
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
  const skin = PR.skinOf(S.game.skin); // a skin overrides the colour of your own discs in flight
  return { color: skin.color || it?.color || gradeColor(d.col), photo: skin.color ? '' : it?.photo ? photoUrl(it.photo) : '' };
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

// Marebear on the hole: when you are at a triple bogey she waddles on, slips your disc into her handbag, cackles and struts off
function drawBearScene(t) {
  const b = S.bear;
  if (!b) return;
  const part = bearPhase(t - b.t0);
  if (!part) { endBear(); return; }
  const [dx, dy] = P(b.at.x, b.at.y);
  const side = b.at.x > cam.x ? 1 : -1; // she comes from the side with more room
  const sc = clamp(cam.s * 0.5, 0.3, 0.62);
  const stand = dx - side * 70 * sc;
  const startX = side > 0 ? -90 : W + 90;
  const waist = dy - 100 * sc;
  let x = stand;
  let facing = side;
  let walk = 0;
  let purse = 0;
  let mood = 'sly';
  if (part.name === 'enter') {
    const e = 1 - (1 - part.p) ** 2;
    x = startX + (stand - startX) * e;
    walk = part.p * 5;
    facing = stand > startX ? 1 : -1;
    purse = 0;
  } else if (part.name === 'chomp') { // the grab: the bag opens, the disc goes in
    purse = Math.min(1, part.p * 4);
    if (part.p > 0.8 && !b.snapped) { b.snapped = true; SND.play('snap'); }
    if (part.p > 0.82) purse = Math.max(0, 1 - (part.p - 0.82) / 0.1);
  } else if (part.name === 'burp') { // the cackle
    mood = 'laugh';
    if (!b.laughed) { b.laughed = true; SND.play('laugh'); }
  } else {
    const e = part.p * part.p;
    x = stand + (startX - stand) * e;
    walk = part.p * 5;
    facing = startX > stand ? 1 : -1;
    mood = 'laugh';
  }
  const discVisible = part.name === 'enter' || (part.name === 'chomp' && part.p < 0.8);
  if (discVisible) {
    const lift = part.name === 'chomp' ? clamp(part.p / 0.8, 0, 1) : 0;
    drawDisc(b.at.x, b.at.y, 16 * lift, b.discId, 1.1 * (1 - lift * 0.7), b.owner);
  }
  MB.drawMarebear(ctx, x, waist, sc, { mood, t: t - b.t0, facing, full: true, purse, walk });
  const label = (text, color, size, yOff) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 5;
    ctx.font = `400 ${Math.round(size * clamp(sc * 1.8, 0.8, 1.3))}px Anton, sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeText(text, x, waist - yOff);
    ctx.fillText(text, x, waist - yOff);
  };
  if (part.name === 'chomp') label('SNATCH!', '#eef1e8', 24, 150 * sc + part.p * 10);
  if (part.name === 'burp') label('HA HA HA HA!', '#f2c14e', 26, 150 * sc + Math.sin(part.p * 20) * 3);
  if (part.name === 'enter' && part.p > 0.15) {
    ctx.fillStyle = 'rgba(238,241,232,0.92)';
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MAREBEAR', x, waist - 150 * sc);
  }
}

/* ----- Marebear pops up: from behind the bottom of the screen, laughing, with something to say (the dog in Duck Hunt) ----- */

function popUp(text, to, mood) {
  if (!S.round && S.mode !== 'match') return;
  $('#gm-bubble')?.classList.remove('is-on'); // her balloon has the stage: the caddy's note gets out of the way
  S.popSide = -(S.popSide || -1);
  S.pop = { t0: now(), text, to, mood, dur: MB.popDuration(text), side: S.popSide, sounded: false };
}
function drawPop(t) {
  const p = S.pop;
  if (!p) return;
  const ms = t - p.t0;
  if (ms > p.dur) { S.pop = null; return; }
  if (!p.sounded && ms > 120) { p.sounded = true; SND.play(p.mood === 'bad' ? (p.text.length > 70 ? 'laugh' : 'snicker') : p.mood === 'good' ? 'hmph' : 'snicker'); }
  const rise = MB.popRise(ms, p.dur);
  if (rise <= 0) return;
  const bottom = H - S.dock; // on a phone she comes up from behind the controls
  const sc = clamp(Math.min(W / 520, bottom / 520), 0.45, 1.1);
  const reach = 112 * sc; // how far her pointing arm reaches toward the middle: the balloon has to stay clear of it
  const x = isDock() ? (p.side > 0 ? W - 62 * sc : 62 * sc) : W * (p.side > 0 ? 0.76 : 0.24); // on a phone she stands at the edge, so the words get the width
  const waist = bottom - 62 * sc + (1 - rise) * 280 * sc;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, W, bottom);
  ctx.clip();
  MB.drawMarebear(ctx, x, waist, sc, { mood: p.mood === 'bad' ? 'laugh' : p.mood === 'good' ? 'grudge' : 'sly', t: ms, facing: p.side > 0 ? -1 : 1 });
  // her words, in a balloon beside her head (only once she is up)
  if (rise > 0.8) {
    const fs = clamp(Math.round(15 * sc + 5), 13, 17);
    ctx.font = `600 ${fs}px Archivo, system-ui, sans-serif`;
    const lo = isDock() ? 58 : 8; // (on a phone, clear of the zoom buttons)
    const hi = isDock() ? W - 106 : W - 8; // (and clear of the 3D and sound chips down the right)
    const room = p.side > 0 ? x - reach - 10 - lo : hi - (x + reach + 10); // the width between the edge and her arm
    const bw = clamp(Math.min(W * 0.62, 330), 150, Math.max(150, room));
    const lines = MB.wrap(ctx, p.text, bw - 24);
    const bh = lines.length * (fs + 5) + 20 + (p.to ? 14 : 0);
    const headY = waist - 150 * sc;
    const bx = clamp(p.side > 0 ? x - reach - 10 - bw : x + reach + 10, lo, hi - bw);
    const by = isDock() ? Math.max(8, bottom - bh - 8) : clamp(headY - bh * 0.55, 8, bottom - bh - 8); // on a phone the scoreboard owns the top, so it sits low
    ctx.globalAlpha = clamp((rise - 0.8) / 0.2, 0, 1) * (ms > p.dur - 260 ? clamp((p.dur - ms) / 260, 0, 1) : 1);
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#d4122a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 14);
    const tailX = p.side > 0 ? bx + bw : bx;
    const dir = p.side > 0 ? 1 : -1;
    ctx.moveTo(tailX, by + bh * 0.55 - 10);
    ctx.lineTo(tailX + dir * 22, headY + 8);
    ctx.lineTo(tailX, by + bh * 0.55 + 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(tailX - dir * 1.5 - 1, by + bh * 0.55 - 8.5, 3, 17); // hide the seam where the tail joins
    ctx.fillStyle = '#2a1020';
    ctx.textAlign = 'left';
    lines.forEach((ln, i) => ctx.fillText(ln, bx + 12, by + 10 + fs + i * (fs + 5) - 2));
    if (p.to) { ctx.font = '700 10px "Space Mono", monospace'; ctx.fillStyle = '#b31a2a'; ctx.fillText(`MAREBEAR TO ${String(p.to).toUpperCase()}`, bx + 12, by + bh - 7); }
  }
  ctx.restore();
}

// the day's weather over the whole picture: rain, and the dusk of the last holes
function drawWeather(t) {
  const w = S.round && S.mode !== 'menu' ? S.hole.weather : null;
  if (!w) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (w.dusk > 0) {
    ctx.fillStyle = `rgba(44,22,76,${0.5 * w.dusk})`; // a plain tint (a multiply blend is slow on a phone)
    ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(8,4,24,0)');
    g.addColorStop(1, `rgba(8,4,24,${0.5 * w.dusk})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (w.rain) {
    ctx.fillStyle = 'rgba(60,85,120,0.16)';
    ctx.fillRect(0, 0, W, H);
    const slant = clamp((S.hole.wind?.mph || 0) * 0.9, 2, 16) * (Math.sin(((S.hole.wind?.from || 0) * Math.PI) / 180) > 0 ? -1 : 1);
    ctx.strokeStyle = 'rgba(200,220,240,0.38)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const sp = 0.7 + ((i * 37) % 10) / 14;
      const x = (((i * 97.3) % W) + (t * 0.02 * slant)) % W;
      const y = (((i * 61.7) % H) + t * 0.55 * sp) % H;
      ctx.moveTo(x, y);
      ctx.lineTo(x + slant * 0.9, y + 16 * sp);
    }
    ctx.stroke();
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
    shown = { ...a.roll[ri], h: hopH(rollP, a.roll.length) };
    poly([a.pts.at(-1), ...a.roll.slice(0, ri + 1)].map((q) => [q.x, q.y]), false);
    ctx.stroke();
  }
  drawDisc(shown.x, shown.y, p >= 1 ? shown.h : pos.h, S.last.disc.id, 1, S.last.who);
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
  const gnd = (x, y) => C3.groundAt(S.hole, x, y); // the land under the camera and under the basket: putts are often up or down a slope
  const camZ = gnd(lie.x - dir.x * 13, lie.y - dir.y * 13) + 5.2;
  const want = { x: lie.x - dir.x * 13, y: lie.y - dir.y * 13, z: camZ, yaw: Math.atan2(dir.x, dir.y), pitch: Math.atan2(gnd(b.x, b.y) + 3.2 - camZ, l + 13) };
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
      want.pitch = Math.atan2(gnd(at.x, at.y) + 0.6 - c.z, Math.hypot(at.x - c.x, at.y - c.y));
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
  C3.drawScene(ctx, { hole: S.hole, cam: c, view, disc, trail, dz: 1, chain, dusk: S.hole.weather?.dusk || 0, color: (a ? discLook(S.last.disc.id, S.last.who) : discLook(curDisc()?.id ?? S.last?.disc.id, 'me')).color, t });
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
    a.cam = C3.startCamera(a.pts[0], { x: d0.x / l, y: d0.y / l }, C3.groundAt(S.hole, a.pts[0].x, a.pts[0].y));
    a.prev = t;
  }
  const dt = clamp((t - a.prev) / 1000, 0.001, 0.05);
  a.prev = t;
  let disc = { x: pos.x, y: pos.y, h: p >= 1 ? 0 : pos.h };
  const trail = a.pts.slice(0, i + 1);
  if (p >= 1 && a.roll.length) {
    const ri = Math.min(a.roll.length - 1, Math.floor(clamp((t - a.t0 - a.dur) / 500, 0, 1) * a.roll.length));
    disc = { x: a.roll[ri].x, y: a.roll[ri].y, h: hopH(clamp((t - a.t0 - a.dur) / 500, 0, 1), a.roll.length) };
    trail.push(...a.pts.slice(i + 1), ...a.roll.slice(0, ri + 1).map((q) => ({ x: q.x, y: q.y, h: 0 })));
  } else {
    trail.push({ x: pos.x, y: pos.y, h: pos.h });
  }
  C3.follow(a.cam, { ...disc, h: disc.h * C3.ZS, g: C3.groundAt(S.hole, disc.x, disc.y) }, dir, dt, { back: 15 + 7 * (1 - Math.abs(p - 0.5) * 2), lift: 3.5, ahead: 70, ground: (x, y) => C3.groundAt(S.hole, x, y) });
  const kind = a.result.kind;
  const landed = Math.max(0, (t - a.t0 - a.dur) / 700);
  C3.drawScene(ctx, {
    hole: S.hole, cam: a.cam, view: C3.viewOf(W, H, a.cam, S.dock), disc, trail, dusk: S.hole.weather?.dusk || 0,
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
  drawWeather(t);
  drawCine(t);
  drawPop(t);
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
  drawStill('ground', drawCourse);
  drawWaves(t);
  drawTrail();
  drawStill('trees', drawTrees);
  drawMandoMap();
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
    pollPad(performance.now());
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
  } else if (t.closest('[data-trophies]')) {
    openTrophies();
  } else if (t.closest('[data-skin]')) {
    chooseSkin(t.closest('[data-skin]').dataset.skin);
  } else if (t.closest('[data-daily-play]')) {
    playDaily();
  } else if (t.closest('[data-daily]')) {
    openDaily();
  } else if (t.closest('[data-standings]')) {
    openStandings();
  } else if (t.closest('[data-bet]')) {
    answerBet(t.closest('[data-bet]').dataset.bet === 'take');
  } else if (t.closest('[data-replay]')) {
    replayBest();
  } else if (t.closest('[data-quick-friend]')) {
    quickFriend();
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
    if (S.course?.daily) playDaily(); else startSolo(S.course?.length || 18, S.course?.holes[0].id);
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
  else if (e.target.matches('[data-rain]')) { try { localStorage.setItem('dj_rain', e.target.checked ? 'on' : 'off'); } catch { /* not saved */ } }
  else if (e.target.matches('[data-cond]')) { try { localStorage.setItem('dj_cond', e.target.checked ? 'varied' : 'classic'); } catch { /* not saved */ } }
}

// the menu shows whichever hole is picked for practice
function previewHole(id) {
  GR.warm(holeById(id));
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

/* ----- keyboard and controller: the same few actions, whichever made them ----- */

// A mouse or trackpad (or a pen) pulls back and lets go; a finger draws back and swipes. Before anything has been used, a phone is a finger.
const pullInput = () => {
  const k = S.pointerKind || (window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse');
  return k === 'mouse' || k === 'pen';
};
function setInput(kind) { // 'touch' | 'mouse' | 'key' | 'pad': what the player is using now (the hint strip shows for the last two)
  if (S.input === kind) return;
  S.input = kind;
  showKeys();
}
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back', PageUp: 'prev', PageDown: 'next', '[': 'prev', ']': 'next', a: 'prev', d: 'next', w: 'catPrev', s: 'catNext' }; // (A and D change disc, W and S change kind of disc, as in Disc Golf Masters)

// the first disc of the next (or previous) kind in the bag: putters, midranges, fairway and distance drivers
function selectKind(step) {
  const list = available().map((x) => x.disc).sort((p, q) => p.speed - q.speed || p.name.localeCompare(q.name));
  if (!list.length) return;
  const cur = DISCS.get(S.discId);
  const kinds = [...new Set(list.map((d) => (d.speed <= 4 ? 'p' : d.speed <= 6 ? 'm' : d.speed <= 9 ? 'f' : 'd')))];
  const kindOf = (d) => (d.speed <= 4 ? 'p' : d.speed <= 6 ? 'm' : d.speed <= 9 ? 'f' : 'd');
  const i = kinds.indexOf(kindOf(cur));
  const k = kinds[(i + step + kinds.length) % kinds.length];
  S.discId = list.find((d) => kindOf(d) === k).id;
  renderPanel(`[data-disc="${S.discId}"]`);
  retarget(false);
}
function selectDisc(step) {
  const list = available();
  if (!list.length) return;
  const i = list.findIndex((x) => x.disc.id === S.discId);
  S.discId = list[(i + step + list.length) % list.length].disc.id;
  renderPanel(`[data-disc="${S.discId}"]`);
  retarget(false);
}
const panelButtons = () => [...panel().querySelectorAll('button:not([disabled]), select, input')].filter((el) => el.offsetParent !== null);
function focusMove(step) {
  const items = panelButtons();
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  items[(i + step + items.length) % items.length].focus({ preventScroll: false });
}
function pressFocused() {
  const el = document.activeElement;
  if (el && panel().contains(el) && el.matches('button')) el.click();
  else panel().querySelector('.btn:not(.btn--ghost):not([disabled]), .gm-tap')?.click(); // nothing chosen: the main button of the screen
}

/**
 * Do something: left, right, up, down, confirm, back, prev, next. What each means depends on where the game is. Returns whether it did anything.
 * (o.amount: how far an aim or power step goes; o.pad: it came from a controller, which also moves round menus.)
 */
function act(name, o = {}) {
  const amt = o.amount ?? 1;
  if (S.replay) return false;
  if (S.phase === 'flight') { // a ride can be skipped
    if ((name === 'confirm' || name === 'back') && S.anim && riding()) { S.anim.t0 -= 1e7; return true; }
    return false;
  }
  if (isMeter()) { if (name === 'confirm') { tap(); return true; } return false; }
  if (S.phase === 'swipe') { // the swipe, made with keys or a stick: aim and power, then throw
    const m = S.meter;
    if (!m) return false;
    const kb = () => (m.kb ||= { aim: 0, power: 1 });
    if (name === 'left') kb().aim = clamp(kb().aim - amt, -45, 45);
    else if (name === 'right') kb().aim = clamp(kb().aim + amt, -45, 45);
    else if (name === 'up') kb().power = clamp(Math.round((kb().power + 0.03 * amt) * 100) / 100, 0.15, 2);
    else if (name === 'down') kb().power = clamp(Math.round((kb().power - 0.03 * amt) * 100) / 100, 0.15, 2);
    else if (name === 'confirm') { finishSwipe({ aim: kb().aim, power: kb().power }); return true; }
    else if (name === 'back') { m.kb = null; m.swing = null; m.padSwing = null; return true; }
    else return false;
    return true;
  }
  if (S.phase === 'pick') {
    if (name === 'left' || name === 'right') { if (inPutt()) return false; setAim(S.aimOff + (name === 'left' ? -amt : amt)); return true; }
    if (name === 'up' || name === 'prev') { selectDisc(-1); return true; }
    if (name === 'down' || name === 'next') { selectDisc(1); return true; }
    if (name === 'catPrev' || name === 'catNext') { selectKind(name === 'catPrev' ? -1 : 1); return true; }
    if (name === 'confirm') { panel().querySelector('[data-go], [data-next-step]')?.click(); return true; }
    if (name === 'back' && isPhone() && S.step !== 'disc') { S.step = S.step === 'aim' ? 'grip' : 'disc'; renderPanel(); return true; }
    return false;
  }
  // everywhere else (menus, results, scorecards)
  if (o.pad && (name === 'up' || name === 'down')) { focusMove(name === 'down' ? 1 : -1); return true; }
  if (name === 'confirm') { pressFocused(); return true; }
  return false;
}

function onKey(e) {
  if (e.key === 'Enter' && S.phase === 'lobby' && e.target.matches?.('[data-lobby-code]')) { e.preventDefault(); mpJoin(S.lobby.code); return; }
  if (e.key === 'Enter' && S.phase === 'lobby' && e.target.matches?.('[data-lobby-invite]')) { e.preventDefault(); mpCreate(); return; }
  if (e.target.closest?.('input, select, textarea') && e.key !== 'Enter') return;
  const name = KEYMAP[e.key];
  if (!name || e.ctrlKey || e.metaKey || e.altKey) return;
  // a focused button does its own thing on Enter or Space, except on the meters and the swipe, where it is the tap or the throw
  if (name === 'confirm' && e.target.closest?.('button, a') && !isMeter() && S.phase !== 'swipe') return;
  if (act(name, { amount: e.shiftKey ? 5 : 1 })) { e.preventDefault(); setInput('key'); }
}

// a controller, polled every frame: buttons act once, the d-pad repeats while held, and a stick moves things smoothly
const pad = { prev: {}, hold: {}, last: 0, aimF: 0, name: '' };
const PAD_SWING_RATIO = 0.8; // the stick pulled this far back (0 to 1) is exactly enough power
const PAD_BUTTONS = { confirm: 0, back: 1, prev: 4, next: 5, up: 12, down: 13, left: 14, right: 15 };
function pollPad(t) {
  const list = navigator.getGamepads ? navigator.getGamepads() : [];
  const g = [...list].find((x) => x && x.connected);
  if (!g) return;
  const dt = clamp((t - pad.last) / 1000, 0.001, 0.05);
  pad.last = t;
  let used = false;
  for (const [name, i] of Object.entries(PAD_BUTTONS)) {
    const down = !!g.buttons[i]?.pressed;
    const repeats = i >= 12; // the d-pad repeats while held
    const h = pad.hold[name];
    if (down && !pad.prev[name]) { act(name, { pad: true }); used = true; pad.hold[name] = { next: t + 350 }; }
    else if (down && repeats && h && t >= h.next) { act(name, { pad: true }); used = true; h.next = t + 80; }
    pad.prev[name] = down;
  }
  const rt = (g.buttons[7]?.value || 0) > 0.6; // the right trigger throws too
  if (rt && !pad.prev.rt) { act('confirm', { pad: true }); used = true; }
  pad.prev.rt = rt;
  // the left stick: aim in the pick phase, aim and power in the swipe; in menus, up and down
  const lx = Math.abs(g.axes[0]) > 0.3 ? g.axes[0] : 0;
  const ly = Math.abs(g.axes[1]) > 0.3 ? g.axes[1] : 0;
  const rx = Math.abs(g.axes[2] ?? 0) > 0.2 ? g.axes[2] : 0;
  const ry = Math.abs(g.axes[3] ?? 0) > 0.2 ? g.axes[3] : 0;
  const rmag = Math.hypot(rx, ry);
  if (lx || ly || rmag) used = true;
  if (S.phase === 'swipe' && S.meter && !S.meter.swing && !S.meter.drag) { // the right stick swings: pull it back (down), then push it forward (up): the pull is the power, the side it points on the way up is the aim
    const m = S.meter;
    const ps = (m.padSwing ||= { peak: 0 });
    if (ry > 0.3) ps.peak = Math.max(ps.peak, ry);
    else if (rmag < 0.12) ps.peak = 0; // let go without pushing forward: start again
    if (ps.peak > 0.3 && ry < -0.35) {
      const aim = clamp(Math.round(rx * 35 * 10) / 10, -45, 45);
      const power = Math.round((ps.peak / PAD_SWING_RATIO) * 1000) / 1000;
      m.padSwing = null;
      finishSwipe({ aim, power });
      return;
    }
  }
  if (S.phase === 'pick' && lx && !inPutt()) {
    pad.aimF += lx * dt * 45;
    if (Math.abs(pad.aimF) >= 1) { const n = Math.trunc(pad.aimF); pad.aimF -= n; setAim(S.aimOff + n); }
  } else if (S.phase === 'swipe' && S.meter && (lx || ly) && !S.meter.swing && !S.meter.padSwing?.peak) {
    const kb = (S.meter.kb ||= { aim: 0, power: 1 });
    kb.aim = clamp(kb.aim + lx * dt * 40, -45, 45);
    kb.power = clamp(kb.power - ly * dt * 0.7, 0.15, 2);
  } else if (ly && !isMeter() && S.phase !== 'pick' && S.phase !== 'flight') {
    const h = pad.hold.stick;
    if (!h || t >= h.next) { act(ly > 0 ? 'down' : 'up', { pad: true }); pad.hold.stick = { next: t + (h ? 160 : 380) }; }
  } else pad.hold.stick = null;
  if (used) setInput('pad');
}

// what the keys or the controller do right now, in a strip over the hole
function showKeys() {
  const el = $('#gm-keys');
  if (!el) return;
  const isPad = S.input === 'pad';
  if (!(S.input === 'key' || isPad) || !S.round) { el.hidden = true; return; }
  const [L, R, U, D, OK] = isPad ? ['◀', '▶', '▲', '▼', 'A'] : ['←', '→', '↑', '↓', 'Enter'];
  const text = isMeter() ? `${isPad ? 'A' : 'Space or Enter'}: tap`
    : S.phase === 'swipe' ? (isPad ? `right stick: pull back, push forward · left stick: aim, power · ${OK}: throw` : `${L} ${R} aim · ${U} ${D} power · ${OK}: throw`)
      : S.phase === 'pick' ? `${L} ${R} aim · ${U} ${D} disc · ${OK}: ${inPutt() ? 'putt' : 'next / throw'}`
        : S.phase === 'flight' ? `${OK}: skip` : isPad ? `${U} ${D} choose · A: select` : '';
  el.textContent = text;
  el.hidden = !text;
}
window.addEventListener('gamepadconnected', (e) => { toast('Controller connected', 'good', 1600); pad.name = e.gamepad.id; });

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

/* ----- goals, skins, and discs that break in ----- */

function announce(ids) {
  for (const id of ids) {
    const a = PR.ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) continue;
    const skin = a.skin ? PR.skinOf(a.skin) : null;
    toast(`Goal reached: ${a.title}${skin ? `. New skin: ${skin.name}` : ''}`, 'good', 3200);
    SND.play('fanfare');
    setTimeout(() => { if (S.round) popUp(T.goalLine(a.title, skin?.name, Math.random, S.lastQuip), '', 'good'); }, 1600);
  }
  if (ids.length) saveGame();
}
const trackThrow = (t) => { announce(PR.recordThrow(S.game, t)); saveGame(); };
const trackHole = (h) => { announce(PR.recordHole(S.game, h)); saveGame(); };
function openTrophies() {
  resetStage();
  S.mode = 'lobby';
  S.trophyMsg = '';
  setPhase('trophies');
  retarget(true);
  syncGame();
}
const panelTrophies = () => GP.trophiesHtml({ game: S.game, bucks: bucks(), canBuy: BETTING_ON, goals: GOALS, skins: PR.SKINS, discName: (id) => splitName(DISCS.get(Number(id))?.name || `Disc ${id}`), breakIn: PR.BREAK_IN_THROWS, msg: S.trophyMsg });
function chooseSkin(id) {
  const skin = PR.skinOf(id);
  if (S.game.owned.includes(id)) { PR.equipSkin(S.game, id); S.trophyMsg = `${skin.name} is on your discs.`; } else {
    const r = PR.buySkin(S.game, id, bucks());
    if (r.ok) { setBucks(bucks() - r.cost); PR.equipSkin(S.game, id); S.trophyMsg = `Bought ${skin.name} for ${r.cost} Marebear Bucks. It is on your discs.`; SND.play('ding'); } else S.trophyMsg = `${skin.name} costs ${skin.cost} Marebear Bucks and you have ${bucks()}.`;
  }
  saveGame();
  renderPanel();
}

/* ----- the daily course, and the season ----- */

const dailyPlanNow = () => { const plan = DLY.dailyPlan(DLY.dayKey()); return { ...plan, holes: plan.holeIds.map((id) => holeById(id)) }; };

function openDaily() {
  resetStage();
  S.mode = 'lobby';
  S.daily = { data: null, loading: !!account.user, msg: '' };
  setPhase('daily');
  retarget(true);
  if (account.user) refreshDaily();
}
async function refreshDaily() {
  try { S.daily.data = await gapi('/daily'); S.daily.msg = ''; } catch (err) { S.daily.msg = err.message; }
  S.daily.loading = false;
  if (S.phase === 'daily') renderPanel();
}
const panelDaily = () => {
  const plan = dailyPlanNow();
  return GP.dailyHtml({ plan: { day: plan.day, holes: plan.holes }, data: S.daily.data, signedIn: !!account.user, loading: S.daily.loading, msg: S.daily.msg, closesIn: DLY.nextDailyAt() - Date.now() });
};
// play today's nine: the same holes, in the same order, on the same seed, for everyone
function playDaily() {
  const plan = dailyPlanNow();
  S.mode = 'solo';
  S.dailyPost = null;
  S.course = { length: 9, holes: plan.holes, idx: 0, card: [], eaten: [], seed: plan.seed, daily: plan.day };
  S.hole = plan.holes[0];
  startHole();
}
// a finished daily run goes on the board (the first one each day counts)
async function postDaily() {
  const c = S.course;
  if (!account.user) { S.dailyPost = { state: 'signin' }; return; }
  const card = c.holes.map((h, i) => { const e = c.card[i]; return { hole: h.id, strokes: e ? e.strokes : 1, holed: e ? e.holed : false }; }); // a hole not played is the worst a hole can be
  S.dailyPost = { state: 'posting' };
  try {
    const r = await gapi('/daily/score', { method: 'POST', body: { day: c.daily, card } });
    S.dailyPost = { state: 'done', ...r };
    announce(PR.recordDaily(S.game));
  } catch (err) {
    S.dailyPost = { state: err.status === 409 ? 'already' : 'error', msg: err.message };
  }
  if (S.phase === 'summary') renderPanel();
}
const dailyPostHtml = () => {
  const d = S.dailyPost;
  if (!d) return '';
  if (d.state === 'posting') return '<p class="gm-note">Posting your score…</p>';
  if (d.state === 'signin') return '<p class="gm-note">Sign in and play again to post a score to the board. <button class="chip" type="button" data-signin>Sign in</button></p>';
  if (d.state === 'already') return '<p class="gm-note">You already have a score on today\'s board: your first run counts.</p>';
  if (d.state === 'error') return `<p class="gm-error">${esc(d.msg)}</p>`;
  const you = d.board.you;
  return `<p>Posted: <b>${d.total}</b>, <b>${you.rank}</b> of ${d.board.entries} on today's board.</p>${GP.dailyHtml ? `<ol class="gm-vs-list gm-board">${d.board.top.slice(0, 5).map((e) => `<li class="${e.you ? 'is-me' : ''}"><span>${e.rank}. ${esc(e.name)}${e.you ? ' (you)' : ''}</span><span>${vsPar(e.total - e.par)}</span><b>${e.total}</b></li>`).join('')}</ol>` : ''}`;
};

function openStandings() {
  resetStage();
  S.mode = 'lobby';
  S.standings = { data: null, loading: true, msg: '' };
  setPhase('standings');
  retarget(true);
  gapi('/standings').then((d) => { S.standings.data = d; }).catch((err) => { S.standings.msg = err.message; }).finally(() => { S.standings.loading = false; if (S.phase === 'standings') renderPanel(); });
}
const panelStandings = () => GP.standingsHtml(S.standings);

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

// "Play a friend now": a nine-hole match made in one tap, and the share sheet (or a copied link) so it can go straight to them
async function quickFriend() {
  if (!account.user) { openSignIn({ onDone: quickFriend }); return; }
  S.lobby.holes = 9;
  S.lobby.invite = '';
  await mpCreate();
  const id = S.mp?.view?.id;
  if (!id) return;
  const url = `${location.origin}/game?match=${id}`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Disc golf on Disc Jerkers', text: 'Play nine holes with me:', url }); return; }
  } catch { /* they closed the sheet: the link is still on the page */ }
  copyLink();
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
    S.hole = matchHole(view.round.holeId, view);
    GR.warm(S.hole);
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
  if (matchPhase() === 'mdone' && mp.endQuip !== `${view.status}${view.seq}`) { mp.endQuip = `${view.status}${view.seq}`; say(matchEndRemark(view), (view.winners || []).includes(S.mp.me) ? 'good' : 'bad'); }
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
// the animation of a move the server recorded (or one of ours kept for a replay): where the disc goes, and the result it comes to
function buildMoveAnim(last, hole, who) {
  const disc = DISCS.get(last.discId);
  const to = last.made ? hole.basket : last.lie;
  const pts = last.putt
    ? Array.from({ length: 21 }, (_, i) => { const t = i / 20; return { x: last.from.x + (to.x - last.from.x) * t, y: last.from.y + (to.y - last.from.y) * t, h: 3 + 5 * 4 * t * (1 - t), s: t }; })
    : last.pts.map(([x, y, h]) => ({ x, y, h }));
  const roll = last.roll.map(([x, y]) => ({ x, y }));
  const result = { kind: last.kind, pts, roll, end: last.end, lie: last.lie, strokes: last.strokes, made: last.made, gimme: last.gimme, finish: last.finish, rim: last.rim, nasty: last.nasty, why: last.why, dist: last.dist, plan: last.putt ? undefined : { feet: last.feet } };
  S.last = { result, ex: last.ex, disc, from: last.from, who };
  if (last.putt) {
    S.anim = puttAnim(last.from, result, last.lie, who);
  } else {
    S.anim = { type: 'flight', t0: now(), dur: camDur(clamp(900 + last.feet * 4.2, 1200, 3300)) * (last.kind === 'basket' ? 1.5 : 1), pts, roll, result, putt: false, cine: last.kind === 'basket' };
    SND.play('throw', 0.6);
  }
  return { result, pts };
}

function startMoveAnim(view, last, who) {
  const mp = S.mp;
  mp.shownSeq = last.seq;
  mp.view = view;
  const hole = matchHole(last.holeId, view);
  S.hole = hole;
  const { result, pts } = buildMoveAnim(last, hole, who);
  const name = who === 'me' ? '' : `${playerOf(who, view).name}: `;
  if (last.putt) puttReaction(result, who, name);
  else toast(`${name}${last.ex?.grade || ''}`, last.ex?.pure ? 'good' : last.ex?.slip || last.ex?.grade === 'Shank' ? 'bad' : '', 1400);
  setPhase('flight');
  retarget(false, pts);
}

/* ----- the throw of the round (or the match), to watch again ----- */

const r1n = (n) => Math.round(n * 10) / 10;
// one of my throws, in the shape a match records, so it can be kept and played back the same way
function moveOf(result, disc, from, ex) {
  const putt = !result.plan;
  const at = result.end ?? result.lie;
  return {
    seq: 0, discId: disc.id, holeId: S.hole.id, from: { x: from.x, y: from.y }, kind: result.kind, putt,
    ex: ex ? { grade: ex.grade, pure: ex.pure, slip: ex.slip, swipe: ex.swipe, swipeAim: ex.swipeAim, swipeSpeed: ex.swipeSpeed } : null,
    feet: putt ? null : Math.round(result.plan.feet), pts: putt ? [] : result.pts.map((p) => [r1n(p.x), r1n(p.y), r1n(p.h)]), roll: (result.roll || []).map((p) => [r1n(p.x), r1n(p.y)]),
    end: { x: r1n(at.x), y: r1n(at.y) }, lie: { x: r1n(result.lie.x), y: r1n(result.lie.y) }, strokes: result.strokes, made: result.made, gimme: result.gimme, zone: result.zone, finish: result.finish, rim: result.rim, nasty: result.nasty, why: result.why, dist: result.dist,
  };
}
function highlightHtml(h) {
  if (!h?.move || !G.highlightScore(h.move)) return '';
  return `<p class="gm-note gm-replay">Throw of the ${S.mode === 'match' ? 'match' : 'round'}: ${h.who ? `${esc(h.who)}, ` : ''}${esc(GP.highlightLabel(h.move, h.hole))}. <button class="chip" type="button" data-replay>Watch it</button></p>`;
}
function replayBest() {
  if (S.mode === 'match' && S.mp?.view.best) {
    const v = S.mp.view;
    const b = v.best.last;
    replayMove(b, K.holeOn(v.seed, holeById(b.holeId), { idx: b.holeId - 1, n: v.holes, rain: !!v.rain }));
  } else if (S.course?.best) {
    replayMove(S.course.best.move, S.course.best.hole);
  }
}
function replayMove(last, hole) {
  if (S.anim) return;
  S.replay = { phase: S.phase, hole: S.hole };
  S.hole = hole;
  const { pts } = buildMoveAnim(last, hole, 'me');
  setPhase('flight');
  retarget(false, pts);
}
function endReplay() {
  const r = S.replay;
  S.replay = null;
  if (S.last) landSounds(S.last.result, null);
  S.anim = null;
  S.last = null;
  S.hole = r.hole;
  setPhase(r.phase);
  retarget(true);
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
  const ev = T.eventFor({ kind: last.kind, putt: last.putt, made: last.made, gimme: last.gimme, ex: last.ex, strokes: total, dist: G.distance(last.from, S.hole.basket), surface: S.last.result.surface, rim: last.rim, nasty: last.nasty, why: last.why });
  landSounds(result, ev);
  if (L.who === 'me') {
    trackThrow({ discId: last.discId, putt: last.putt, made: last.made, gimme: last.gimme, dist: last.dist, kind: last.kind, feet: last.feet });
    if (last.strokes > 1) mp.penalties = (mp.penalties || 0) + 1;
  }
  say(T.remark(ev, { who: L.who === 'me' ? 'me' : 'them', name: mover.name }, Math.random, S.lastQuip), L.who === 'me' ? (GOOD_EVENTS.has(ev) ? 'good' : 'bad') : (GOOD_EVENTS.has(ev) ? 'sly' : 'bad'));
  if (last.bear) { startBear({ discId: last.bear.discId, at: last.bear.at, owner: L.who }); return; }
  afterMove();
}

// the move is over: if it ended the hole, show the hole; either way, then the state as it now is
function afterMove() {
  const mp = S.mp;
  const last = mp.view.last;
  if (last && last.holeEnd && mp.holeSeen !== last.seq) {
    mp.holeSeen = last.seq;
    const he = last.holeEnd;
    const kp = he.par === 3 ? GP.closestToPin(he.results, (u) => playerOf(u, mp.view)?.name || '') : null;
    if (kp) { mp.kps = mp.kps || {}; mp.kps[kp.uid] = (mp.kps[kp.uid] || 0) + 1; }
    const mineHole = he.results.find((r) => r.uid === mp.me);
    if (mineHole) { settleBet(mineHole.strokes, he.par, mineHole.holed, he.holeId); trackHole({ strokes: mineHole.strokes, par: he.par, holed: mineHole.holed, rain: !!matchHole(he.holeId, mp.view).weather?.rain }); }
    if (he.matchDone && myself(mp.view) && !myself(mp.view).left) announce(PR.recordRound(S.game, { holes: mp.view.holes, penalties: mp.penalties || 0 }));
    say(matchHoleRemark(last.holeEnd, mp.view), 'sly');
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
  return `${bar}<ol class="gm-board" aria-label="Scoreboard"><li class="gm-board__h"><span>Player</span><span>To basket</span><span>Strokes</span><span>Round</span></li>${rows}</ol>`;
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

// closest to the pin, on a par 3
function kpLine(he, v) {
  const kp = he.par === 3 ? GP.closestToPin(he.results, (u) => playerOf(u, v)?.name || '') : null;
  return kp ? `<p class="gm-note">Closest to the pin: <b>${esc(kp.name)}</b>, ${Math.round(kp.feet)} ft.</p>` : '';
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
      ${kpLine(he, v)}
      ${quipHtml()}
      <ol class="gm-vs-list">${rows}</ol>
      ${he.matchDone
        ? '<button class="btn" type="button" data-mp-continue>See the result</button>'
        : `<button class="btn" type="button" data-mp-continue>Next: hole ${v.holeIdx + 1}, ${esc(next.name)} <small>par ${next.par}</small></button>`}
    </div>`;
}

function kpTally(v) {
  const k = S.mp?.kps;
  if (!k || !Object.keys(k).length) return '';
  const parts = Object.entries(k).sort((a, b) => b[1] - a[1]).map(([uid, n]) => `${esc(playerOf(uid, v)?.name || '?')} ${n}`);
  return `<p class="gm-note">Closest to the pin on the par 3s: ${parts.join(' · ')}.</p>`;
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
      ${highlightHtml(v.best && { move: v.best.last, hole: holeById(v.best.last.holeId).name, who: playerOf(v.best.last.uid, v)?.name })}
      ${kpTally(v)}
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
  S.mastH = $('.masthead')?.offsetHeight || 66;
  syncTop();
  const res = await fetch('/data/flightguide.json?v=1');
  DATA = await res.json();
  try { T.useHeckles(await (await fetch('/data/heckles.json?v=3')).json()); } catch { /* her own lines are enough */ }
  try { T.useMemory(JSON.parse(localStorage.getItem('dj_said'))); } catch { T.useMemory([]); } // what she has already said, so she does not say it again
  for (const r of DATA.discs) DISCS.set(r[0], { id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] });

  document.addEventListener('pointerdown', SND.unlock);
  const sndBtn = $('#gm-sound');
  const showSnd = () => { sndBtn.setAttribute('aria-pressed', String(SND.isOn())); sndBtn.textContent = SND.isOn() ? 'Sound on' : 'Sound off'; };
  showSnd();
  sndBtn.addEventListener('click', () => { SND.setOn(!SND.isOn()); showSnd(); SND.play('tap'); });
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
  phoneQuery.addEventListener('change', () => { syncTop(); renderPanel(); measureDock(); });
  landscapeQuery.addEventListener('change', () => { syncTop(); renderPanel(); measureDock(); });
  p.addEventListener('input', onPanelInput);
  // the meter answers the moment a finger lands, not when it lifts
  p.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-tap], .gm-bar, #gm-putt') && isMeter()) { e.preventDefault(); tap(); } });
  p.addEventListener('keydown', (e) => { if (e.target.matches('[data-tap]') && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  cv.addEventListener('contextmenu', (e) => e.preventDefault()); // a right click is a throw, not a menu
  document.addEventListener('pointerdown', (e) => { S.pointerKind = e.pointerType; setInput(e.pointerType === 'touch' ? 'touch' : 'mouse'); }, true);
  cv.addEventListener('pointerdown', (e) => {
    if (riding()) { S.anim.t0 -= 1e7; return; } // tap to skip the ride
    if (S.phase === 'swipe') { beginSwipe(e); return; }
    try { cv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    setAimFromPointer(e);
  });
  cv.addEventListener('pointermove', (e) => { if (S.phase === 'swipe') { moveSwipe(e); return; } if (e.buttons || e.pointerType === 'touch') setAimFromPointer(e); });
  cv.addEventListener('pointerup', endSwipe);
  cv.addEventListener('pointercancel', () => { if (S.meter) S.meter.drag = null; });

  onAccountChange(() => {
    syncGame();
    if (S.phase === 'daily') { if (account.user) { S.daily.loading = true; refreshDaily(); } renderPanel(); return; }
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
  GR.warm(HOLES[0]);
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
  window.__gm = { popUp, say, SND, startSwipe, puttDisc, S, G, clock, tap, throwDisc, startMeter, next, retarget, cam, DISCS, showMenu, startSolo, startHole, startBear, finishThrow, finishHole, finishCourse, openLobby, enterMatch, applyView, onMatchState, finishMove, mpCreate, mpJoin, step: () => { const t = now(); update(t); draw(t); } };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const p = panel();
  if (p) p.innerHTML = `<div class="gm-card"><h2 class="is-bad">Couldn't load</h2><p>${esc(err.message)}</p></div>`;
});
