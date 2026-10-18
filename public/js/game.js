/* The game: bring your bag, pick a disc, set your flight, then time the throw.
   The rules are in gamecore.js (and the flight in flightmodel.js, shared with the flight guide); this file is what you
   see and touch: the hole drawn from above, the panel, the throw meter, the animation, and Marebear. */

import { account, activeBag, loadAccount, onAccountChange, openSignIn, photoUrl, setActive } from './fgaccount.js?v=3';
import { clamp, tierName, angleName } from './flightmodel.js?v=1';
import { HOLES, COURSES, courseById, holeById, holesFor } from './course.js?v=14';
import * as G from './gamecore.js?v=35';
import * as T from './trash.js?v=11';
import * as C3 from './cam3d.js?v=23';
import * as FO from './foliage.js?v=2';
import * as PL from './player.js?v=1';
import * as GS from './gesture.js?v=2';
import { ANGLE_MAX } from './flightmodel.js?v=1';
import * as PF from './puttfx.js?v=19';
import * as GR from './ground.js?v=8';
import * as SND from './sound.js?v=4';
import * as MB from './marebear.js?v=2';
import * as K from './conditions.js?v=6';
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
  orbit: { yaw: 0, pitch: 0, zoom: 1 }, // the camera of the Find pin view: swung round, tilted, zoomed
  throwStyle: (() => { try { return localStorage.getItem('dj_tstyle') === 'meters' ? 'meters' : 'swing'; } catch { return 'swing'; } })(), // 'swing' (plan the flight, then swing) or 'meters' (the experiment: a power meter on the map, then a timing window)
  courseId: (() => { try { return courseById(localStorage.getItem('dj_course')).id; } catch { return 1; } })(), // the course picked on the menu (remembered)
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
const bestKey = () => (S.course && S.course.length > 1 ? `dj_game_best_${S.course.length}${S.course.courseId > 1 ? `_c${S.course.courseId}` : ''}` : `dj_game_best_h${S.hole.id}`);
const metersOn = () => S.throwStyle === 'meters';
function setThrowStyle(v) {
  S.throwStyle = v === 'meters' ? 'meters' : 'swing';
  try { localStorage.setItem('dj_tstyle', S.throwStyle); } catch { /* not saved */ }
  if (metersOn()) { S.settings.nose = 0; S.settings.angle = 0; }
  S.previewKey = null;
  renderPanel(`[data-tstyle="${S.throwStyle}"]`);
  if (S.round) retarget(false);
}
const parTotal = (holes) => holes.reduce((n, h) => n + h.par, 0);
// the course on the menu, and the holes of a course (a match carries its own)
const courseHoles = (id = S.courseId) => courseById(id).holes;
const holesOfView = (v) => courseHoles(v?.course ?? 1);
function setCourse(id) {
  S.courseId = courseById(id).id;
  try { localStorage.setItem('dj_course', String(S.courseId)); } catch { /* not saved */ }
}
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
// you are in a patch of trees (you hit one, or came to rest among them): this throw goes through that patch
const patchNote = () => (lieOf().t !== undefined && !inPutt() ? '<p class="gm-note">You are in a patch of trees: this throw goes through them. The next patch is still there.</p>' : '');
function slopeNote() {
  const t = slopeText(S.hole, lieOf());
  if (!t) return patchNote();
  if (isPhone()) return `<p class="gm-note">${t}.</p>${patchNote()}`;
  return `<p class="gm-note">${t}. ${inPutt() ? (G.riseTo(S.hole, lieOf()) > 0 ? 'Uphill putts are easier, but swipe a little harder.' : 'Downhill putts are harder and run away: swipe softer.') : (G.riseTo(S.hole, lieOf()) > 0 ? 'The basket is above you: throws come down short.' : 'The basket is below you: throws run on.')}</p>${patchNote()}`;
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
  setDisc(suggest());
  try { S.best = Number(localStorage.getItem(bestKey())) || null; } catch { S.best = null; }
  if (!S.discId) { finishCourse(); return; }
  setPhase('pick');
  retarget(true);
  if (S.course.holes.length > 1) toast(`Hole ${S.hole.n ?? S.hole.id}: ${S.hole.name}`, '', 1700);
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
  const holes = length === 1 ? [holeById(practiceId) || courseHoles()[0]] : holesFor(length, S.courseId);
  S.mode = 'solo';
  S.course = { length, courseId: S.courseId, holes, idx: 0, card: [], eaten: [], seed: condOn() ? newSeed() : null, rain: condOn() && rainOn() };
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
  if (phase === 'pick' && metersOn() && S.round && !inPutt()) { // the meters decide the nose, hyzer and arm each throw: the line on the ground is a typical throw
    S.settings.nose = 0;
    S.settings.angle = 0;
    const d = curDisc();
    if (d) { S.settings.mph = G.typicalArm(d); S.settings.spin = null; }
  }
  keepAwake(PLAYING.has(phase) || phase === 'mwait'); // a phone should not dim in the middle of a throw, or while you wait for a friend
  document.body.classList.toggle('gm-playing', PLAYING.has(phase)); // on a phone the site's header steps aside while you play
  syncTop();
  renderPanel(focusSel);
  syncMini();
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

// Planning a throw: the arm speed, the nose and the hyzer or anhyzer are set directly, and the flight over the ground (3D, or the map) shows what they will do
const PLAN = {
  mph: { min: G.ARM.min, max: G.ARM.max, step: G.ARM.step },
  nose: { min: -G.NOSE_MAX, max: G.NOSE_MAX, step: 1 },
  angle: { min: -ANGLE_MAX, max: ANGLE_MAX, step: 1 },
};
const planText = (key) => {
  const t = S.settings;
  if (key === 'angle') return angleName(t);
  if (key === 'nose') return G.noseName(t.nose || 0);
  const d = curDisc();
  const slip = d ? Math.round(G.slipChance(d, t) * 100) : 0;
  return `${t.mph} mph${slip ? ` · ${slip}% slip` : ''}`;
};
function planRows() {
  const t = S.settings;
  return `<div class="gm-plan">${[
    rangeRow({ key: 'angle', label: 'Hyzer', text: planText('angle'), value: t.angle, ...PLAN.angle, aria: 'release angle', dec: '‹', inc: '›' }),
    rangeRow({ key: 'nose', label: 'Nose', text: planText('nose'), value: t.nose || 0, ...PLAN.nose, aria: 'nose angle', dec: '‹', inc: '›' }),
    rangeRow({ key: 'mph', label: 'Arm speed', text: planText('mph'), value: t.mph, ...PLAN.mph, aria: 'arm speed', dec: '−', inc: '+' }),
  ].join('')}</div>`;
}
// a new disc brings the arm that gets it fully up to speed (the player can change it)
function setDisc(id) {
  S.discId = id;
  const d = DISCS.get(id);
  if (d) { S.settings.mph = G.typicalArm(d); S.settings.spin = null; }
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
      <p class="gm-note">${metersOn() ? 'Meters style: aim (drag or tap the hole), press Throw, stop the power meter on the map, then hit the sweet spots in the timing window. The dashed line is a typical throw with this disc.' : 'Plan the flight below (hyzer or anhyzer, nose, arm speed) and watch the dashed line over the ground: it is the throw you have planned from a clean release, and the shaded band is where a mistimed release can land. A faster arm is harder to release on time.'}</p>
    </div>`;
}

const tipSeen = () => { try { return localStorage.getItem('dj_game_tip') === '1'; } catch { return false; } };
const tipHtml = () => (tipSeen() ? '' : `<div class="gm-tip"><p><b>How to play:</b> pick a disc, choose forehand or backhand, and aim (drag or tap where you want it to go; Find pin lifts the camera to see the basket). Plan the flight with the sliders (arm speed, nose, hyzer or anhyzer) and watch the dashed line over the ground change. Then <b>Throw</b> and swing: how fast you swing through is how far it goes, and how smooth it is is how clean the release is. A slow arm can grip lock or let go early, so watch the slip percentage. Trees stop low throws, water costs a stroke, and a triple bogey brings Marebear, who takes a disc.</p><button type="button" data-tip-close aria-label="Got it">×</button></div>`);

// Marebear's remark, in a card of its own under whatever it is about
// Marebear can be switched off (a chip over the hole, remembered): no pop-ups, no remarks, no scene, and in your own round she takes no disc
const BEAR = { on: true };
try { BEAR.on = localStorage.getItem('dj_bear') !== 'off'; } catch { /* on */ }
function say(r, mood = 'bad') {
  if (!BEAR.on) { S.quip = ''; S.quipTo = ''; return; } // mood: 'bad' (she laughs), 'good' (she sulks, grudgingly) or 'sly'
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

const PHONE_STEPS = ['disc', 'grip', 'aim', 'flight']; // the steps of setting up a throw on a phone, in order
const phoneSteps = () => (metersOn() ? PHONE_STEPS.filter((k) => k !== 'flight') : PHONE_STEPS); // (the meters style has no sliders to plan with)
function panelPickPhone() {
  const d = curDisc();
  if (!d) return panelNoDiscs();
  const putting = inPutt();
  const key = `${S.mode}:${S.hole.id}:${S.round.strokes}`;
  if (S.stepKey !== key) { S.stepKey = key; S.step = 'disc'; } // each throw starts with the disc
  const steps = putting ? ['disc'] : phoneSteps();
  if (!steps.includes(S.step)) S.step = steps[0];
  const names = { disc: 'Disc', grip: 'Grip', aim: 'Aim', flight: 'Flight' };
  const i = steps.indexOf(S.step);
  const tabs = steps.length > 1
    ? `<div class="gm-tabs" role="tablist" aria-label="Set up the shot">${steps.map((k, n) => `<button class="gm-tab" type="button" role="tab" data-step="${k}" aria-selected="${k === S.step}"><b>${n + 1}</b>${names[k]}</button>`).join('')}</div>`
    : `<p class="gm-h">Putt <span>· ${ft(toBasket())} out</span></p>`;
  const leave = S.mode === 'match' ? '<button class="chip" type="button" data-mp-leave>Forfeit</button>' : '<button class="chip" type="button" data-quit>Quit</button>';
  let body;
  if (S.step === 'disc') {
    body = `${betHtml()}${discRow()}${pickInfo(d, { wind: G.windFor(S.hole, heading()) }, putting)}${putting && puttDd() > G.LONG_PUTT ? '<p class="gm-note">Past 30 feet the target is a pinprick.</p>' : ''}${slopeNote()}`;
  } else if (S.step === 'grip') {
    body = `${gripChips()}${styleChips()}<p class="gm-note">Backhand or forehand, and which hand. The flight bends the other way for a lefty.</p>`;
  } else if (S.step === 'aim') {
    body = `${aimRow()}<p class="gm-note">Drag on the hole to aim, or use the slider.</p>`;
  } else {
    body = `${planRows()}<p class="gm-note">The dashed line is the flight you have planned; the band is where a mistimed release can land.</p>`;
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
    ${putting ? '' : `<div class="gm-block">${styleChips()}</div>`}
    <div class="gm-block">
      <p class="gm-h">Your disc <span>· ${available().length} left in the bag</span></p>
      ${discRow()}
      ${pickInfo(d, plan, putting)}
      ${slopeNote()}
    </div>
    ${putting
      ? (metersOn() ? `<p class="gm-sub"><b>${ft(dist)}</b> from the basket. Three taps: the line (left and right) and the height on a picture of the basket, then the push on the wedge. A tap-in needs only the last. The farther out, the thinner the green.</p>` : `<p class="gm-sub"><b>${ft(dist)}</b> from the basket. One tap: catch the dot inside the green circle as it swirls past. Short putts get a big target and a slow dot; a faster disc shrinks it.${dist > G.LONG_PUTT ? ' <b>Past 30 feet it is a long shot: the target is a pinprick and the dot flies.</b>' : ''}</p>`)
      : settingsBlock()}
    <div class="gm-go${putting || metersOn() ? '' : ' gm-go--plan'}">
      ${putting || metersOn() ? '' : planRows()}
      <button class="btn" type="button" data-go>${putting ? 'Putt' : 'Throw'}</button>
      <p class="gm-go__line">Stroke <b>${strokes + 1}</b> · Par <b>${S.hole.par}</b> · ${putting ? `${ft(dist)} out` : `${ft(dist)} to the basket`}${slopeBit(S.hole, lieOf())}</p>
    </div>`;
}

// the courses, as a pair of cards to pick from (the menu and the match lobby share the choice)
function courseChooser() {
  return `<div class="gm-courses" role="group" aria-label="Course">${COURSES.map((c) => `<button class="gm-course" type="button" data-course="${c.id}" aria-pressed="${c.id === S.courseId}"><b>${esc(c.name)}</b><small>${esc(c.blurb)}</small><span>18 holes · par ${parTotal(c.holes)}</span></button>`).join('')}</div>`;
}
// how you throw: swing (plan the flight, then swing) or the meters experiment (aim, a power meter on the map, then a timing window)
const styleChips = () => `<div class="gm-row gm-style" role="group" aria-label="Throwing style"><span class="fg-wind__l">Throwing</span>
        <div class="fg-seg"><button class="chip" type="button" data-tstyle="swing" aria-pressed="${!metersOn()}">Swing</button><button class="chip" type="button" data-tstyle="meters" aria-pressed="${metersOn()}">Meters (try it)</button></div></div>`;
function panelMenu() {
  const ch = courseHoles();
  const course = courseById(S.courseId);
  const options = ch.map((h) => `<option value="${h.id}"${h.id === S.hole.id ? ' selected' : ''}>${h.n}. ${esc(h.name)} · par ${h.par}</option>`).join('');
  return `${bagBar()}
    <div class="gm-card">
      <h2>Play the course</h2>
      <p>Two courses of eighteen holes: woods, hills, water and wind. Pick yours, pick a round, bring your bag, and try not to triple bogey: Marebear is watching, and she has a handbag.</p>
      ${courseChooser()}
      <button class="btn" type="button" data-daily>Daily course<small>nine holes, the same for everyone today · a leaderboard</small></button>
      <button class="btn btn--ghost" type="button" data-trophies>Trophies and skins<small>${S.game.unlocked.filter((id) => GOALS.some((a) => a.id === id)).length} of ${GOALS.length} goals · break-in · disc skins</small></button>
      <button class="btn" type="button" data-solo="3">Quick warm-up<small>3 holes, about 5 minutes</small></button>
      <button class="btn btn--ghost" type="button" data-quick-friend>Play a friend now<small>one tap: a 9-hole match and a link to send</small></button>
      <div class="gm-menu">
        <button class="btn" type="button" data-solo="9">Front 9<small>${esc(course.name)} · par ${parTotal(ch.slice(0, 9))}</small></button>
        <button class="btn" type="button" data-solo="18">Full 18<small>${esc(course.name)} · par ${parTotal(ch)}</small></button>
      </div>
      <button class="btn btn--ghost" type="button" data-versus>Play with friends <small>up to 8 players, turn by turn</small></button>
      ${BETTING_ON ? `<p class="gm-note">Marebear Bucks: <b>${bucks()}</b> · she bets on every hole.</p>` : ''}
      ${styleChips()}
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
  if (S.meter?.classic) return panelMetersStyle();
  const kind = S.phase;
  const d = curDisc();
  const stages = kind === 'putt' ? [] : S.meter?.plan ? ['release'] : METER_STAGES;
  const n = stages.indexOf(kind) + 1;
  const names = { power: 'Power', nose: 'Nose', angle: 'Angle', release: 'Release', putt: 'Putt' };
  const risk = kind === 'release' && d ? Math.round(G.slipChance(d, S.settings) * 100) : 0;
  const title = kind === 'putt' ? 'Putt' : S.meter?.plan ? 'Release' : `<span>${n} ·</span> ${names[kind]}`;
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
      <div class="gm-meter__top"><p class="gm-meter__t">${title}</p><button class="chip gm-backout" type="button" data-back-out aria-label="Back out of this throw">Back out</button></div>
      ${barMarkup(kind)}
      <button class="gm-tap" type="button" data-tap>Tap</button>
      ${hint}
    </div>`;
  }
  return `<div class="gm-meter">
      ${stages.length ? `<div class="gm-steps" aria-hidden="true">${stages.map((_, i) => `<i class="${i < n ? 'is-on' : ''}"></i>`).join('')}</div>` : ''}
      <div class="gm-meter__top"><p class="gm-meter__t">${title}</p><button class="chip gm-backout" type="button" data-back-out aria-label="Back out of this throw">Back out</button></div>
      ${hint}
      ${barMarkup(kind)}
      <button class="gm-tap" type="button" data-tap>Tap</button>
    </div>`;
}

const panelFlight = () => `<div class="gm-card"><h2>${esc(S.last?.ex?.grade ?? '')}</h2><p>${S.last?.ex ? describeExecution(S.last.ex) : 'Here it goes…'}</p></div>`;

function describeFeel(f) {
  if (!f) return '';
  const smooth = f.smooth == null ? '' : f.reason ? { wobble: 'Your swing wandered off line.', stutter: 'The swing stuttered instead of flowing.', stall: 'You stalled at the bottom of the wind-up.' }[f.reason] : `A smooth swing (${f.smooth}%).`;
  const speed = f.speed == null ? '' : f.maxed ? 'Full power: the most the arm speed you set can give.' : f.speed < 65 ? `You swung through slowly (${f.speed}% of what this arm needs): it came up short.` : `Speed ${f.speed}%: nearly all of it.`;
  return `${smooth} ${speed}`.trim();
}
function describeExecution(ex) {
  if (S.last?.feel && !ex.slip) return describeFeel(S.last.feel);
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
  if (r.kind === 'tree') return { h: 'Thunk!', tone: 'bad', p: `It hit a ${r.hit?.tree?.k === 'r' ? 'rock' : 'tree'} and kicked out beside it. ${ft(dist)} to the basket.` };
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
  const rows = c.card.map((h) => `<li class="${h.score < h.par ? 'is-under' : h.score > h.par ? 'is-over' : ''}"><span>${holeById(h.id).n}. ${esc(holeById(h.id).name)}</span><span>par ${h.par}</span><b>${h.holed ? h.strokes : `${h.score}*`}</b></li>`).join('');
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
  } else if (!c && S.phase === 'menu' && h.id !== courseHoles()[0].id) { // the menu is previewing the hole picked for practice
    $('#gm-hud').innerHTML = `<span>${esc(h.name)}</span><small>Par ${h.par} · ${ft(G.distance(h.tee, h.basket))}</small>`;
  } else if (!c) {
    $('#gm-hud').innerHTML = `<span>${esc(courseById(S.courseId).name)}</span><small>Eighteen holes · par ${parTotal(courseHoles())}</small>`;
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

// Change your mind part way through a throw (any meter, or the swipe): the settings go back to what they were when you began, and you are back on the disc.
function backOut() {
  if (!isMeter() && S.phase !== 'swipe') return false;
  const before = S.meter?.before;
  if (before) Object.assign(S.settings, before);
  S.meter = null;
  S.pop = null;
  SND.play('tap');
  setPhase('pick');
  retarget(false);
  toast('Back to the disc', '', 900);
  return true;
}

function startMeter() {
  const d = curDisc();
  if (!d) return;
  if (inPutt() && metersOn()) {
    // the meters style putts with the same wedge as a drive: it fills and drains along the line to the basket, and you tap anywhere to putt
    // (a putt is its own little game: aim left and right, then the height, on a picture of the basket, then the wedge for the push. A tap-in is the wedge alone.)
    const dd = toBasket();
    const past = Math.max(0, dd - 15); // inside 15 ft it is friendly; past that everything tightens and speeds up with every foot
    S.meter = {
      kind: 'putt', classic: true, putt: true, before: { ...S.settings }, start: now(), ...buildPuttRuler(), // (ruler, push, maxFt, sweetRaw)
      stage: toBasket() <= G.GIMME ? 'power' : 'h', u: { h: 0, v: 0 },
      K: Math.min(1.6 + Math.min(dd, 15) * 0.08 + past * 0.22, 8), // how many times its green the line travels: 35% of the sweep at 15 ft, 20% at 25, 12% from 45
      pH: Math.max(0.8, 1.75 - Math.min(dd, 15) * 0.017 - past * 0.02), pV: Math.max(0.72, 1.5 - Math.min(dd, 15) * 0.015 - past * 0.018), // the line sweeps once in this many seconds: 1.5 at 15 ft, 0.8 from 50
      pP: Math.max(1.0, 1.9 - past * 0.03), // and the wedge fills and drains faster too
      pk: 1 + past * 0.06, // the push is judged this many times more strictly
    };
    setPhase('putt');
  } else if (inPutt()) {
    S.meter = { kind: 'putt', before: { ...S.settings }, start: now(), radius: G.puttRadius(puttDd(), d) * G.puttGrip(S.hole), speed: G.puttSpeed(puttDd()), params: G.makePuttSeed(Math.random) };
    setPhase('putt');
  } else if (metersOn()) {
    // the meters style: the power is a meter on the map, laid along the aim; the nose, hyzer and release are a timing window
    S.settings.spin = null;
    // (the timing window first: nose, hyzer and the release, each stopped on its dial; then the aim and power wedge, and its tap is the throw)
    S.meter = { kind: 'nose', classic: true, before: { ...S.settings }, start: now(), mph: S.settings.mph, rel: G.releaseSetup(S.settings.mph), sweet: {}, pos: {}, ref: refPath() };
    sweetFor('nose');
    setPhase('nose');
  } else {
    // the arm speed, nose and hyzer were planned (and shown) before this: what is left is the swing itself (how smooth it is is the release, how fast it goes is the distance)
    S.settings.spin = null;
    S.meter = { before: { ...S.settings } };
    startSwipe(null, { pending: true });
  }
}

/* ----- the meters style: a power meter laid along the aim on the map, then a timing window for the nose, the hyzer and the release ----- */

// The aim line as it was when you pressed Throw (before the timing window changed anything), in the frame of the throw: feet to the right and feet forward.
// The wedge keeps this curve for the whole of the arm stage; only how far along it you get depends on the arm speed.
function refPath() {
  const lie = lieOf();
  const { ux, uy, rx, ry } = G.headingVec(heading());
  const ref = previewNow(lie).pv.line.map((p) => ({ f: (p.x - lie.x) * ux + (p.y - lie.y) * uy, r: (p.x - lie.x) * rx + (p.y - lie.y) * ry }));
  for (let pass = 0; pass < 2; pass++) { // a light smoothing, so the curve has no corners (the ends stay put)
    const c = ref.map((q) => ({ ...q }));
    for (let i = 1; i < ref.length - 1; i++) { ref[i].f = (c[i - 1].f + 2 * c[i].f + c[i + 1].f) / 4; ref[i].r = (c[i - 1].r + 2 * c[i].r + c[i + 1].r) / 4; }
  }
  return ref;
}
// where `d` feet along that curve is (past its end it carries on straight along its last bearing)
function refAt(ref, d) {
  let run = 0;
  for (let i = 1; i < ref.length; i++) {
    const seg = Math.hypot(ref[i].f - ref[i - 1].f, ref[i].r - ref[i - 1].r);
    if (run + seg >= d && seg > 0) { const t = (d - run) / seg; return { f: ref[i - 1].f + (ref[i].f - ref[i - 1].f) * t, r: ref[i - 1].r + (ref[i].r - ref[i - 1].r) * t }; }
    run += seg;
  }
  const a = ref[Math.max(0, ref.length - 4)];
  const b = ref.at(-1);
  const l = Math.hypot(b.f - a.f, b.r - a.r) || 1;
  return { f: b.f + ((b.f - a.f) / l) * (d - run), r: b.r + ((b.r - a.r) / l) * (d - run) };
}
// how far each arm speed carries, from here (with the nose and hyzer chosen), laid along the curve the throw had before the timing window
function buildRuler() {
  const d = curDisc();
  const lie = lieOf();
  const ref = S.meter?.ref;
  const { ux, uy, rx, ry } = G.headingVec(heading());
  const R = [];
  for (let mph = G.ARM.min; mph <= G.ARM.max; mph += G.ARM.step) {
    const end = G.previewThrow(S.hole, d, S.settings, heading(), lie, 8, { mph, nose: S.settings.nose || 0, angle: S.settings.angle || 0 }).end; // with the nose and hyzer chosen in the timing window
    const ft = G.distance(lie, end);
    const q = ref ? refAt(ref, ft) : { f: ft, r: 0 };
    R.push({ mph, x: lie.x + ux * q.f + rx * q.r, y: lie.y + uy * q.f + ry * q.r, ft: Math.round(ft), pos: G.powerPos(mph) });
  }
  return R;
}
// a putt's wedge: straight at the basket and out past it; the lit stretch is the push this putt needs, give or take what the swipe allowed
function buildPuttRuler() {
  const lie = lieOf();
  const push = G.puttPush(S.hole, lie);
  const tol = G.swipeTolerance(puttDd());
  const maxFt = Math.max(push * 1.7, 20);
  const { ux, uy } = G.headingVec(G.headingTo(lie, S.hole.basket));
  const pk = 1 + Math.max(0, toBasket() - 15) * 0.06; // (the same strictness as the tap uses)
  const ruler = Array.from({ length: 90 }, (_, i) => { const ft = (maxFt * (i + 1)) / 90; return { mph: 0, x: lie.x + ux * ft, y: lie.y + uy * ft, ft: Math.round(ft), pos: (i + 1) / 90 }; });
  return { ruler, push, maxFt, sweetRaw: { ok: ruler.map((r) => Math.abs(r.ft / push - 1) * pk <= tol.power) } };
}
function rebuildWedge() { // the aim moved: the wedge goes with it (its sweet spot is worked out again when the finger lifts)
  const m = S.meter;
  m.ruler = buildRuler();
  m.wedge = null;
  m.lines = {};
  m.sweetRaw = null;
}
const rulerAt = (mph) => { const R = S.meter.ruler; return R[clamp(Math.round((mph - G.ARM.min) / G.ARM.step), 0, R.length - 1)]; };
function powerReadout(mph) {
  const risk = Math.round(G.slipChance(curDisc(), { ...S.settings, mph, spin: null }) * 100);
  return `<b>${mph} mph</b><small>${rulerAt(mph).ft} ft${risk ? ` · ${risk}% slip` : ''}</small>`;
}

// The wedge: the ruler's landing spots as a track, widened the way the aim band is (wider the farther out), so it can be filled from the disc outward.
function wedgeGeom() {
  const m = S.meter;
  if (m.wedge) return m.wedge;
  const lie = lieOf();
  const pts = [{ x: lie.x, y: lie.y, ft: 0, mph: 0, pos: 0 }, ...m.ruler.map((r) => ({ x: r.x, y: r.y, ft: r.ft, mph: r.mph, pos: r.pos }))];
  const edges = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / l;
    const dy = (b.y - a.y) / l;
    const w = i ? 2.5 + p.ft * 0.075 : 0.4;
    return { l: { x: p.x - dy * w, y: p.y + dx * w }, r: { x: p.x + dy * w, y: p.y - dx * w } };
  });
  return (m.wedge = { pts, edges });
}
// the wedge from index `a` to index `b` (either can be between two) as a closed shape
function wedgeShape(g, proj, W_, a, b) {
  const at = (f, side) => { const k = Math.min(W_.pts.length - 2, Math.max(0, Math.floor(f))); const t = f - k; const e0 = W_.edges[k][side]; const e1 = W_.edges[k + 1][side]; return { x: e0.x + (e1.x - e0.x) * t, y: e0.y + (e1.y - e0.y) * t }; };
  const idx = [a];
  for (let k = Math.floor(a) + 1; k < b; k++) idx.push(k);
  idx.push(b);
  const left = idx.map((f) => proj(at(f, 'l'))).filter(Boolean);
  const right = idx.map((f) => proj(at(f, 'r'))).filter(Boolean).reverse();
  if (left.length + right.length < 3) return false;
  g.beginPath();
  [...left, ...right].forEach((q, n) => { if (n) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); });
  g.closePath();
  return true;
}
// where the marker has got to, as an index along the wedge (fractions between the ruler's ticks, so the fill is smooth)
function fillIndex(v) {
  const pts = wedgeGeom().pts;
  for (let k = 0; k < pts.length - 1; k++) {
    if (v <= pts[k + 1].pos && pts[k + 1].pos > pts[k].pos) return Math.max(0, k + (v - pts[k].pos) / (pts[k + 1].pos - pts[k].pos));
  }
  return pts.length - 1;
}
function wedgeMeter(g, proj) {
  const m = S.meter;
  const W_ = wedgeGeom();
  const sec = (now() - m.start) / 1000;
  const v = m.putt ? (G.needleAt(sec, m.pP) + 1) / 2 : G.powerAt(sec);
  const mph = m.putt ? 0 : G.mphAt(v);
  const f = fillIndex(v);
  const ok = (i) => !!m.sweetRaw?.ok?.[i - 1];
  const last = W_.pts.length - 1;
  g.save();
  g.lineJoin = 'round';
  if (wedgeShape(g, proj, W_, 0, last)) { // the whole wedge, empty
    g.fillStyle = 'rgba(238,241,232,0.07)';
    g.fill();
    g.strokeStyle = 'rgba(238,241,232,0.4)';
    g.lineWidth = 1.6;
    g.stroke();
  }
  // the sweet spot: a lit stretch of it
  let best = null;
  for (let k = 1; k <= last; k++) {
    if (!ok(k)) continue;
    let e = k;
    while (e + 1 <= last && ok(e + 1)) e++;
    if (wedgeShape(g, proj, W_, Math.max(0, k - 0.5), Math.min(last, e + 0.5))) {
      g.fillStyle = 'rgba(163,230,53,0.3)';
      g.fill();
      g.strokeStyle = 'rgba(163,230,53,0.95)';
      g.lineWidth = 2.4;
      g.stroke();
    }
    if (!best || e - k > best.to - best.from) best = { from: k, to: e };
    k = e;
  }
  // the fill
  const inSweet = ok(Math.round(f)) || ok(Math.ceil(f)) || ok(Math.floor(f));
  if (f > 0.05 && wedgeShape(g, proj, W_, 0, f)) {
    g.fillStyle = inSweet ? 'rgba(163,230,53,0.62)' : 'rgba(238,241,232,0.42)';
    g.fill();
  }
  // the head of the fill, and what it is worth
  const k0 = Math.min(last - 1, Math.floor(f));
  const t = f - k0;
  const mix = (side) => ({ x: W_.edges[k0][side].x + (W_.edges[k0 + 1][side].x - W_.edges[k0][side].x) * t, y: W_.edges[k0][side].y + (W_.edges[k0 + 1][side].y - W_.edges[k0][side].y) * t });
  const hl = proj(mix('l'));
  const hr = proj(mix('r'));
  const word = (text, x, y, color, size, font = '"Anton", Impact, sans-serif') => {
    g.font = `400 ${size}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(6,11,7,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };
  if (hl && hr) {
    g.beginPath();
    g.moveTo(hl.x, hl.y);
    g.lineTo(hr.x, hr.y);
    g.strokeStyle = inSweet ? '#a3e635' : '#eef1e8';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.stroke();
    const feet = Math.round(W_.pts[k0].ft + (W_.pts[k0 + 1].ft - W_.pts[k0].ft) * t);
    word(m.putt ? `${feet} ft` : `${mph} mph · ${feet} ft`, (hl.x + hr.x) / 2, Math.min(hl.y, hr.y) - 8, inSweet ? '#a3e635' : '#eef1e8', 20);
  }
  if (best) {
    const k = Math.round((best.from + best.to) / 2);
    const q = proj(W_.pts[k]);
    if (q && !(hl && Math.hypot(q.x - hl.x, q.y - hl.y) < 110)) word('SWEET SPOT', q.x, q.y - 14, '#a3e635', 11, '"Space Mono", monospace');
  }
  g.restore();
}
// The arm-speed wedge in the 3D view, drawn flat on the screen from the bottom (the disc) to the top (the longest throw) with a straight distance scale, so the sweet spot
// is easy to see: seen on the ground in perspective the far end is a sliver. It keeps the throw's curve (sideways, to a scale that shows it) and its width grows with distance.
function screenWedge(g) {
  const m = S.meter;
  const W_ = wedgeGeom();
  const top = 86;
  const bottom = H - (S.dockV ?? S.dock) - 26;
  const last = W_.pts.length - 1;
  const maxFt = W_.pts[last].ft;
  const cx = W / 2;
  const yOf = (ft) => bottom - (ft / maxFt) * (bottom - top);
  const kx = ((bottom - top) / maxFt) * 1.0; // the curve, to the same scale as the length
  const half = (ft) => 9 + 44 * (ft / maxFt);
  const ftAt = (f) => { const k = Math.min(last - 1, Math.max(0, Math.floor(f))); return W_.pts[k].ft + (W_.pts[k + 1].ft - W_.pts[k].ft) * (f - k); }; // feet at a place between the ruler's ticks
  const edge = (ft, side) => ({ x: cx + (m.ref ? refAt(m.ref, ft).r : 0) * kx + side * half(ft), y: yOf(ft) });
  // the outline is sampled every few feet along the curve itself (not joined up from the ruler's coarse ticks), so it is smooth
  const shape = (a, b) => {
    const n = Math.max(2, Math.ceil((b - a) / 3));
    g.beginPath();
    for (let i = 0; i <= n; i++) { const q = edge(a + ((b - a) * i) / n, -1); if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }
    for (let i = n; i >= 0; i--) { const q = edge(a + ((b - a) * i) / n, 1); g.lineTo(q.x, q.y); }
    g.closePath();
  };
  const v = G.powerAt((now() - m.start) / 1000);
  const mph = G.mphAt(v);
  const f = fillIndex(v);
  const headFt = ftAt(f);
  const ok = (i) => !!m.sweetRaw?.ok?.[i - 1];
  const word = (text, x, y, color, size, align = 'center', font = '"Anton", Impact, sans-serif') => {
    g.font = `400 ${size}px ${font}`;
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(6,11,7,0.85)';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  };
  g.save();
  g.lineJoin = 'round';
  shape(0, maxFt); // the empty wedge
  g.fillStyle = 'rgba(6,11,7,0.38)';
  g.fill();
  g.strokeStyle = 'rgba(238,241,232,0.55)';
  g.lineWidth = 1.8;
  g.stroke();
  let best = null;
  for (let k = 1; k <= last; k++) { // the sweet spot, lit
    if (!ok(k)) continue;
    let e = k;
    while (e + 1 <= last && ok(e + 1)) e++;
    const a = ftAt(Math.max(0, k - 0.5));
    const b = ftAt(Math.min(last, e + 0.5));
    shape(a, b);
    g.fillStyle = 'rgba(163,230,53,0.34)';
    g.fill();
    g.strokeStyle = 'rgba(163,230,53,1)';
    g.lineWidth = 2.6;
    g.stroke();
    if (!best || b - a > best.b - best.a) best = { a, b };
    k = e;
  }
  const inSweet = ok(Math.round(f)) || ok(Math.ceil(f)) || ok(Math.floor(f));
  if (headFt > 2) { // the fill
    shape(0, headFt);
    g.fillStyle = inSweet ? 'rgba(163,230,53,0.66)' : 'rgba(238,241,232,0.5)';
    g.fill();
  }
  for (let ft = 100; ft < maxFt; ft += 100) { // a scale
    const q = edge(ft, -1);
    g.beginPath();
    g.moveTo(q.x - 6, q.y);
    g.lineTo(q.x + 8, q.y);
    g.strokeStyle = 'rgba(238,241,232,0.8)';
    g.lineWidth = 1.5;
    g.stroke();
    word(`${ft}`, q.x - 12, q.y, 'rgba(238,241,232,0.9)', 11, 'right', '"Space Mono", monospace');
  }
  const bdist = G.distance(lieOf(), S.hole.basket); // where the basket is along it
  if (bdist < maxFt) word('◂ BASKET', edge(bdist, 1).x + 8, yOf(bdist), '#d35400', 11, 'left', '"Space Mono", monospace');
  const hl = edge(headFt, -1);
  const hr = edge(headFt, 1);
  g.beginPath();
  g.moveTo(hl.x, hl.y);
  g.lineTo(hr.x, hr.y);
  g.strokeStyle = inSweet ? '#a3e635' : '#eef1e8';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.stroke();
  word(`${mph} mph · ${Math.round(headFt)} ft`, hr.x + 12, hr.y - 14, inSweet ? '#a3e635' : '#eef1e8', 20, 'left');
  if (best) {
    const mid = (best.a + best.b) / 2;
    word('SWEET SPOT', (edge(mid, -1).x + edge(mid, 1).x) / 2, yOf(mid), '#a3e635', 11, 'center', '"Space Mono", monospace'); // (inside the lit stretch)
  }
  g.restore();
}
// on the map (3D off) the same wedge is drawn over the hole
function drawPowerMeter() {
  const m = S.meter;
  if (!m?.classic || !(S.phase === 'power' || (S.phase === 'putt' && m.stage === 'power')) || !m.ruler) return;
  wedgeMeter(ctx, (p) => { const [x, y] = P(p.x, p.y); return { x, y }; });
}

// the panel of the meters style: the power stage, or a short note beside the timing window
function panelMetersStyle() {
  const kind = S.phase;
  const d = curDisc();
  const risk = kind === 'release' && d ? Math.round(G.slipChance(d, S.settings) * 100) : 0;
  const hints = {
    putt: S.meter?.stage === 'h' ? 'Aim left and right: the line sweeps across the basket. Tap when it is inside the green.'
      : S.meter?.stage === 'v' ? 'Now the height: the line sweeps up and down. Tap when it is inside the green. Too high runs long, too low comes up short.'
        : 'The wedge fills and drains along the line to the basket. Tap anywhere (or the button) to putt when the fill reaches the lit stretch: that is the push this putt needs (more uphill, less downhill). All three have to be right to drop it.',
    power: 'Drag the hole to aim. The wedge fills and drains with your arm speed: tap anywhere on the hole (or the button) to throw at the speed it is at. The lit stretch is the sweet spot for the nose and hyzer you chose, and the dashed line is the flight at that speed.',
    nose: 'The disc pitches up and down. Tap when it is in the lime arc. Nose up lifts the disc and spends distance; nose down keeps it low and short.',
    angle: 'The disc tilts one way and the other. Tap when it is in the lime arc: hyzer tips the outside edge down, anhyzer the other way, and level is flat.',
    release: `Tap as the ring closes on the green ring. Early (white) goes toward the turn side, late (orange) toward the fade side.${risk ? ` <b>${risk}% chance the disc slips</b>: a slow arm can grip lock or let go early.` : ''}`,
  };
  const brief = (h) => (isPhone() && tipSeen() ? `${String(h).split('. ')[0].replace(/\.$/, '')}.` : h);
  const order = ['nose', 'angle', 'release', 'power'];
  const ps = S.meter?.stage;
  const title = kind === 'putt' ? (ps === 'h' ? '<span>1 ·</span> Line' : ps === 'v' ? '<span>2 ·</span> Height' : ps === 'power' && toBasket() > G.GIMME ? '<span>3 ·</span> Push' : 'Putt') : `<span>${order.indexOf(kind) + 1} ·</span> ${{ nose: 'Nose', angle: 'Hyzer', release: 'Release', power: 'Aim and power' }[kind]}`;
  const steps = kind === 'putt' ? (toBasket() > G.GIMME ? `<div class="gm-steps" aria-hidden="true">${['h', 'v', 'power'].map((k, i) => `<i class="${i <= ['h', 'v', 'power'].indexOf(ps) ? 'is-on' : ''}"></i>`).join('')}</div>` : '') : `<div class="gm-steps" aria-hidden="true">${order.map((k, i) => `<i class="${i <= order.indexOf(kind) ? 'is-on' : ''}"></i>`).join('')}</div>`;
  return `<div class="gm-meter">
      ${steps}
      <div class="gm-meter__top"><p class="gm-meter__t">${title}</p><button class="chip gm-backout" type="button" data-back-out aria-label="Back out of this throw">Back out</button></div>
      <div class="gm-meter__h"><p>${brief(hints[kind])}</p></div>
      ${kind === 'power' || (kind === 'putt' && S.meter?.stage === 'power') ? `<output class="gm-read" id="gm-read" aria-live="off"><b>&nbsp;</b></output><button class="gm-tap" type="button" data-tap>${kind === 'putt' ? 'Putt' : 'Throw'}</button>` : ''}
    </div>`;
}

// The timing window: three little instruments over the 3D view, one for the nose, one for the hyzer, one for the release. The hyzer is a disc seen from behind
// that tilts one way and the other, the nose is a disc seen from the side that pitches up and down, and the release is a ring that closes in on the target ring and
// opens again. You stop each where its sweet arc or ring is. (They keep the same bars underneath: where the marker would have been is where the dial is.)
const MINI_ROWS = { nose: 'Nose', angle: 'Hyzer', release: 'Release' };
const DIAL_SWEEP = { nose: 40, angle: 50 }; // how far (degrees) each dial turns either way for the whole bar
function miniCell(stage) {
  const m = S.meter;
  const state = S.phase === stage ? 'on' : stage in m.pos ? 'done' : 'wait';
  const pos = m.pos[stage];
  const val = state !== 'done' ? '' : stage === 'nose' ? G.noseName(G.noseAt(pos * 2 - 1)) : stage === 'angle' ? angleName({ angle: G.angleAt(pos * 2 - 1) }) : '';
  return `<div class="gm-dialcell is-${state}"><canvas class="gm-dial" id="gm-dial-${stage}" aria-hidden="true"></canvas><span class="gm-dialcell__l">${MINI_ROWS[stage]}</span><output id="gm-read-${stage}" aria-live="off">${val}</output></div>`;
}
function syncMini() {
  const el = $('#gm-mini');
  if (!el) return;
  const m = S.meter;
  const pad = !!(m?.classic && m.putt && S.phase === 'putt' && m.stage !== 'power'); // a putt: the basket to aim at
  const on = pad || !!(m?.classic && MINI_ROWS[S.phase]);
  el.hidden = !on;
  if (!on) { el.innerHTML = ''; return; }
  if (pad) {
    el.innerHTML = `<div class="gm-mini__box" role="group" aria-label="Aim the putt">
      <p class="gm-mini__t">${m.stage === 'h' ? 'Aim left and right: tap when the line is in the green' : 'Now the height: tap when the line is in the green'}</p>
      <canvas class="gm-pad" id="gm-pad" aria-hidden="true"></canvas>
      <button class="gm-tap gm-tap--mini" type="button" data-tap>Tap</button>
    </div>`;
    return;
  }
  const hints = { nose: 'Pitch the nose: tap when the disc is in the lime arc', angle: 'Tilt the disc: tap when it is in the lime arc', release: 'Let go: tap as the ring closes on the green ring' };
  el.innerHTML = `<div class="gm-mini__box" role="group" aria-label="Timing window">
      <p class="gm-mini__t">${hints[S.phase]}</p>
      <div class="gm-dials">${Object.keys(MINI_ROWS).map(miniCell).join('')}</div>
      <button class="gm-tap gm-tap--mini" type="button" data-tap>Tap</button>
    </div>`;
}
// one dial, drawn for the marker's place on its bar (0..1; null before its turn)
function drawDial(cvs, stage, v, state) {
  const w = cvs.clientWidth;
  if (!w) return;
  const px = Math.round(w * dpr);
  if (cvs.width !== px) { cvs.width = px; cvs.height = px; }
  const g = cvs.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, w);
  const m = S.meter;
  const rad = (d) => (d * Math.PI) / 180;
  const live = state === 'on';
  const ink = state === 'done' ? '#a3e635' : '#eef1e8';
  if (stage === 'release') {
    const cx = w / 2;
    const cy = w / 2;
    const x = v == null ? 0 : v * 2 - 1;
    const tr = w * 0.15;
    const span = w * 0.31;
    const zone = Math.max(3, m.rel.w * span * 2);
    g.beginPath();
    g.arc(cx, cy, tr, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(163,230,53,0.38)';
    g.lineWidth = zone;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, tr, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(163,230,53,0.95)';
    g.lineWidth = 1.5;
    g.stroke();
    if (v != null) {
      g.beginPath();
      g.arc(cx, cy, tr + Math.abs(x) * span, 0, Math.PI * 2);
      g.strokeStyle = state === 'done' ? '#a3e635' : x < 0 ? '#eef1e8' : '#e8742a'; // closing in is early (white), opening out is late (orange)
      g.lineWidth = 3.5;
      g.stroke();
    }
    g.beginPath();
    g.ellipse(cx, cy, w * 0.07, w * 0.025, 0, 0, Math.PI * 2);
    g.fillStyle = ink;
    g.fill();
    return;
  }
  const cx = w / 2;
  const cy = w * 0.62;
  const ar = w * 0.4;
  const sweep = DIAL_SWEEP[stage];
  const sgn = stage === 'angle' && S.settings.hand !== 'left' ? -1 : 1; // hyzer drops the left edge for a right-hander (and the right for a left-hander); anhyzer the other
  const arc = (a0, a1, style, lw) => { g.beginPath(); g.arc(cx, cy, ar, rad(-90 + a0), rad(-90 + a1)); g.strokeStyle = style; g.lineWidth = lw; g.lineCap = 'butt'; g.stroke(); };
  arc(-sweep, sweep, 'rgba(238,241,232,0.2)', w * 0.07);
  for (const b of m.sweet?.[stage] || []) {
    const lo = (b.from * 2 - 1) * sweep;
    const hi = Math.max((b.to * 2 - 1) * sweep, lo + 1.5);
    if (sgn > 0) arc(lo, hi, 'rgba(163,230,53,0.95)', w * 0.07); else arc(-hi, -lo, 'rgba(163,230,53,0.95)', w * 0.07);
  }
  g.beginPath(); // the middle tick: flat, or level
  g.moveTo(cx, cy - ar - w * 0.06);
  g.lineTo(cx, cy - ar + w * 0.06);
  g.strokeStyle = 'rgba(238,241,232,0.85)';
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([3, 4]); // the level line
  g.beginPath();
  g.moveTo(cx - ar * 0.9, cy);
  g.lineTo(cx + ar * 0.9, cy);
  g.strokeStyle = 'rgba(238,241,232,0.3)';
  g.lineWidth = 1;
  g.stroke();
  g.setLineDash([]);
  const deg = v == null ? 0 : (v * 2 - 1) * sweep * sgn;
  if (v != null) { // a dot on the arc where it points
    const a = rad(-90 + deg);
    g.beginPath();
    g.arc(cx + Math.cos(a) * ar, cy + Math.sin(a) * ar, w * 0.045, 0, Math.PI * 2);
    g.fillStyle = ink;
    g.fill();
  }
  g.save();
  g.translate(cx, cy);
  g.rotate(rad(stage === 'angle' ? deg : -deg)); // (the hyzer dial's sign is already flipped for the hand); nose up lifts the front (the right)
  const len = ar * 0.78;
  const th = stage === 'angle' ? w * 0.06 : w * 0.045;
  g.beginPath();
  g.ellipse(0, 0, len, th, 0, 0, Math.PI * 2);
  g.fillStyle = state === 'wait' ? 'rgba(238,241,232,0.45)' : ink;
  g.fill();
  g.beginPath();
  g.ellipse(0, -th * 0.7, len * 0.55, th * 0.75, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(6,11,7,0.35)';
  g.fill();
  if (stage === 'nose') { // the front of the disc, so which way is up is plain
    g.beginPath();
    g.moveTo(len + w * 0.07, 0);
    g.lineTo(len - w * 0.01, -w * 0.045);
    g.lineTo(len - w * 0.01, w * 0.045);
    g.closePath();
    g.fillStyle = live ? '#d35400' : ink;
    g.fill();
  }
  g.restore();
}
// The putt's aiming pad: the basket seen from the front, with a green window around its chains that is as big as the putt is forgiving (it shrinks with distance). A line sweeps
// across (left and right), you stop it, and then another sweeps up and down (the height); both have to end up inside the green.
function drawPad(cvs, m, t) {
  const w = cvs.clientWidth;
  if (!w) return;
  const h = Math.round(w * 0.72);
  if (cvs.width !== Math.round(w * dpr) || cvs.height !== Math.round(h * dpr)) { cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr); }
  const g = cvs.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h * 0.48;
  const Rx = w * 0.43;
  const Ry = h * 0.42;
  g.fillStyle = 'rgba(6,11,7,0.55)';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(40,70,40,0.5)'; // the grass
  g.fillRect(0, cy + Ry * 0.86, w, h - (cy + Ry * 0.86));
  // the basket, from the front: pole, tray, the chains from the band down, and the cage on top
  const bw = w * 0.1;
  g.strokeStyle = 'rgba(238,241,232,0.5)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx, cy + Ry * 0.3);
  g.lineTo(cx, cy + Ry * 0.86);
  g.stroke();
  g.lineWidth = 1.4;
  for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(cx + (k * bw * 0.9) / 3, cy - Ry * 0.3); g.lineTo(cx + (k * bw * 0.55) / 3, cy + Ry * 0.18); g.stroke(); }
  for (const [y, rw] of [[cy - Ry * 0.3, bw * 0.95], [cy + Ry * 0.18, bw * 0.62]]) { g.beginPath(); g.ellipse(cx, y, rw, rw * 0.22, 0, 0, Math.PI * 2); g.stroke(); }
  g.beginPath();
  g.ellipse(cx, cy + Ry * 0.3, bw * 1.1, bw * 0.24, 0, 0, Math.PI * 2);
  g.stroke();
  // the green: how far the line may be off and still drop
  const wx = Rx / m.K;
  const wy = Ry / m.K;
  g.beginPath();
  g.roundRect(cx - wx, cy - wy, wx * 2, wy * 2, 6);
  g.fillStyle = 'rgba(163,230,53,0.2)';
  g.fill();
  g.strokeStyle = 'rgba(163,230,53,0.95)';
  g.lineWidth = 2;
  g.stroke();
  const sec = (t - m.start) / 1000;
  const uh = m.stage === 'h' ? G.needleAt(sec, m.pH) : m.u.h;
  const uv = m.stage === 'v' ? G.needleAt(sec, m.pV) : m.stage === 'power' ? m.u.v : null;
  const inH = Math.abs(uh) * m.K <= 1;
  const inV = uv != null && Math.abs(uv) * m.K <= 1;
  const x = cx + uh * Rx;
  const y = uv == null ? 0 : cy - uv * Ry;
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.strokeStyle = inH ? '#a3e635' : '#eef1e8';
  g.beginPath();
  g.moveTo(x, cy - Ry);
  g.lineTo(x, cy + Ry);
  g.stroke();
  if (uv != null) {
    g.strokeStyle = inV ? '#a3e635' : '#eef1e8';
    g.beginPath();
    g.moveTo(cx - Rx, y);
    g.lineTo(cx + Rx, y);
    g.stroke();
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fillStyle = inH && inV ? '#a3e635' : '#d35400';
    g.fill();
  }
}
function updatePad(t) {
  const cvs = $('#gm-pad');
  if (cvs) drawPad(cvs, S.meter, t);
}

// every frame the timing window is up: the live dial turns with its marker, the stopped ones stay where they were
function updateDials(t) {
  const m = S.meter;
  for (const stage of Object.keys(MINI_ROWS)) {
    const cvs = $(`#gm-dial-${stage}`);
    if (!cvs) continue;
    const live = S.phase === stage;
    const sec = (t - m.start) / 1000;
    const v = live ? (stage === 'release' ? (G.releaseAt(sec, m.rel) + 1) / 2 : (G.needleAt(sec, G.METER[stage].period) + 1) / 2) : m.pos[stage] ?? null;
    drawDial(cvs, stage, v, live ? 'on' : stage in m.pos ? 'done' : 'wait');
    const read = $(`#gm-read-${stage}`);
    if (live && read && stage !== 'release') {
      const text = stage === 'nose' ? G.noseName(G.noseAt(v * 2 - 1)) : angleName({ angle: G.angleAt(v * 2 - 1) });
      if (read.textContent !== text) read.textContent = text;
    }
  }
}

// where a bar's sweet spot is, given what the earlier bars set: worked out as a bar begins, then drawn on it
// The sweet spots take hundreds of trial throws to find, so they are worked out a few milliseconds at a time between frames (the meter
// is on screen at once, and the lime bands appear when they are ready) instead of freezing the game for a moment at each stage.
function sweetFor(stage) {
  const d = curDisc();
  const meter = S.meter;
  if (!d || !meter) return;
  const chosen = stage === 'arm'; // the last stage of the meters style knows the nose and the hyzer
  const base = { hand: S.settings.hand, style: S.settings.style, mph: S.settings.mph, spin: null, nose: stage === 'angle' || chosen ? S.settings.nose : 0, angle: chosen ? S.settings.angle : 0 };
  const job = G.sweetJob(S.hole, d, base, heading(), lieOf(), stage);
  meter.sweet[stage] = [];
  const tok = (meter.tok = (meter.tok || 0) + 1);
  const pump = () => {
    if (S.meter !== meter || meter.tok !== tok) return; // the throw moved on, or the aim did
    const t0 = performance.now();
    while (!job.done() && performance.now() - t0 < 5) job.next(2);
    if (!job.done()) { setTimeout(pump, 0); return; }
    const res = job.result();
    meter.sweet[stage] = G.sweetBands(res);
    if (stage === 'power' || stage === 'arm') meter.sweetRaw = res; // (the wedge draws its own)
    if (meter.classic) return; // (the dials draw their sweet arcs themselves)
    const bar = $('#gm-bar');
    if (bar && S.phase === stage) { bar.querySelectorAll('.gm-zone--sweet').forEach((e) => e.remove()); bar.insertAdjacentHTML('afterbegin', sweetMarkup(stage)); }
  };
  setTimeout(pump, 0);
}

// the taps of the meters style: the timing window first (nose, hyzer, release, each stopped on its dial), then the aim and power wedge, whose tap is the throw; a putt is the wedge alone
function tapMeters(m, t, next) {
  const stop = (period) => (G.needleAt(t, period) + 1) / 2; // where the dial was when you tapped, 0..1
  if (S.phase === 'nose') {
    m.pos.nose = stop(G.METER.nose.period);
    S.settings.nose = G.noseAt(m.pos.nose * 2 - 1);
    sweetFor('angle');
    next('angle');
    toast(G.noseName(S.settings.nose), '', 900);
  } else if (S.phase === 'angle') {
    m.pos.angle = stop(G.METER.angle.period);
    S.settings.angle = G.angleAt(m.pos.angle * 2 - 1);
    next('release');
    toast(angleName(S.settings), '', 900);
  } else if (S.phase === 'release') {
    m.pos.release = (G.releaseAt(t, m.rel) + 1) / 2;
    m.ex = G.combine(G.readRelease(G.releaseAt(t, m.rel), m.rel.w)); // how clean the let-go was; the arm speed is the last thing chosen
    m.ruler = buildRuler();
    sweetFor('arm');
    next('power');
    toast(`Release: ${m.ex.grade}`, m.ex.pure ? 'good' : m.ex.grade === 'Shank' ? 'bad' : '', 1100);
  } else if (S.phase === 'power') {
    m.mph = G.mphAt(G.powerAt(t));
    S.settings.mph = m.mph;
    S.settings.spin = null;
    throwDisc(S.mode === 'match' ? m.ex : G.applySlip(m.ex, G.rollSlip(curDisc(), S.settings, Math.random()))); // no swipe: the timing and the wedge are the whole throw
  } else if (S.phase === 'putt') {
    if (m.stage === 'h') {
      m.u.h = G.needleAt(t, m.pH);
      m.stage = 'v';
      next('putt');
      toast(Math.abs(m.u.h) * m.K <= 1 ? 'Line locked' : m.u.h < 0 ? 'Line: left' : 'Line: right', Math.abs(m.u.h) * m.K <= 1 ? 'good' : '', 800);
    } else if (m.stage === 'v') {
      m.u.v = G.needleAt(t, m.pV);
      m.stage = 'power';
      next('putt');
      toast(Math.abs(m.u.v) * m.K <= 1 ? 'Height locked' : m.u.v < 0 ? 'Height: low' : 'Height: high', Math.abs(m.u.v) * m.K <= 1 ? 'good' : '', 800);
    } else {
      const feet = ((G.needleAt(t, m.pP) + 1) / 2) * m.maxFt;
      const d = curDisc();
      const radius = G.puttRadius(puttDd(), d) * G.puttGrip(S.hole);
      const tol = G.swipeTolerance(puttDd());
      // the line is the swipe's aim, the height is the radar's short or long (high is long), the wedge is the push: all three have to be inside the green
      const shot = { x: 0, y: clamp(m.u.v * m.K * radius, -1, 1) };
      if (toBasket() <= G.GIMME) puttDisc({ x: 0, y: 0 }, null);
      else puttDisc(shot, { aim: m.u.h * m.K * tol.aim, power: 1 + (feet / m.push - 1) * m.pk }); // (a far putt judges the push more strictly)
    }
  }
}

function tap() {
  const m = S.meter;
  if (!m) return;
  SND.play('tap');
  if (navigator.vibrate) navigator.vibrate(8); // a small click under the thumb
  const t = (now() - m.start) / 1000;
  const next = (phase) => { m.start = now(); setPhase(phase); };
  if (m.classic) { tapMeters(m, t, next); return; }
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
  S.last = { result, ex, disc, from, feel: S.feel };
  S.feel = null;
  const ace = result.kind === 'basket';
  const flightMs = camDur(clamp(900 + result.plan.feet * 4.2, 1200, 3300)) * (ace ? 1.5 : 1);
  const kind = PL.kindFor(false, S.settings.style);
  const lead = leadFor(kind); // the thrower winds up and lets go; the disc leaves at t0
  const anim = { type: 'flight', t0: now() + lead, lead, kind, hand: S.settings.hand, relH: PL.releasePoint(kind, S.settings.hand)[2], dur: flightMs, pts: result.pts, roll: result.roll, result, cine: ace };
  S.anim = anim;
  const letGo = () => {
    if (S.anim !== anim) return;
    SND.play('throw', clamp(S.settings.mph / 90, 0.2, 1));
    const feel = S.last?.feel;
    toast(`${ex.grade}${feel?.maxed ? ' · full power' : feel?.speed != null ? ` · ${feel.speed}% speed` : ''}${feel?.smooth != null ? ` · ${feel.smooth}% smooth` : ''}`, ex.pure ? 'good' : ex.slip || ex.grade === 'Shank' ? 'bad' : '', 1700);
  };
  if (lead) setTimeout(letGo, lead); else letGo();
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
function puttSounds(sc, result, lead = 0) {
  const at = (ms, name, arg) => setTimeout(() => SND.play(name, arg), Math.max(0, ms) + lead);
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
  const lead = film ? PL.LEAD.putt : 0; // the thrower sets and pushes it before the disc leaves
  puttSounds(film ? sc : null, result, lead);
  if (S.last) S.last.sfx = true;
  return { type: 'flight', t0: now() + lead, lead, kind: 'putt', hand: handOf(who), relH: 3.2, dur: film ? sc.total : 750, pts, roll: [], result, putt: true, script: sc, tail: film ? sc.tail : 350, cine: long };
}

/* ----- the swipe: after the radar, DRAW BACK and then SWIPE FORWARD toward the basket, in one smooth motion. True in aim and in power, or it misses. ----- */

// How far the forward stroke must run, in pixels, to be exactly enough: longer for a longer putt, or a harder arm.
const swipeNeed = () => (H - S.dock) * (S.meter?.throwEx ? 0.2 + 0.0035 * S.settings.mph : 0.15 + 0.0055 * G.puttPush(S.hole, lieOf())); // uphill takes more push
const swipeTol = () => (S.meter?.throwEx ? G.DRIVE_SWIPE : G.swipeTolerance(puttDd()));
// where the disc is on the screen for the guide: high enough that there is room below it to draw back
const swipeAnchor = () => ({ x: W / 2, y: (H - S.dock) * 0.66 });

function startSwipe(shot = null, throwEx = null) {
  S.meter = { kind: 'swipe', before: S.meter?.before, shot, throwEx, drag: null };
  setPhase('swipe');
}
function panelSwipe() {
  const drive = !!S.meter?.throwEx;
  const brief = isPhone() && tipSeen(); // once you know it, a phone gets one line, so the hole (and your swipe) has the room
  const text = drive
    ? pullInput()
      ? `Press on the disc (either mouse button), drag straight down to wind up, then swing back up through it and let go. How fast you swing through is how far it goes (MAX is the arm speed you set: swinging harder gives no more, a slower swing is shorter), and how smooth the whole motion is, with no long stall at the bottom and no big wobble, is how clean the release is. The way back up only steers it if it is really crooked. On a trackpad you can click once, swing with no button held, and click again. Or the arrow keys and Enter, or a controller's right stick back then forward.`
      : brief
        ? 'Draw back, then swipe up, smooth and quick. Faster is farther, up to MAX (the arm you set); smooth is a clean release.'
        : 'Draw back down the screen, then swipe forward up it, in one smooth motion, from anywhere. How fast you swipe is how far it goes (MAX is the arm speed you set: swiping harder gives no more, a slower swipe is shorter); how smooth the whole motion is, with no long stall at the turn and no big wobble, is how clean the release is. Stay inside the lime lines: only a really crooked swipe steers the throw.'
    : pullInput()
      ? `Press on the disc (either mouse button), drag straight down to wind up (how far is the power: reach the gold mark for full power), then drag back up and let go. Where your way back up leaves from decides the aim, so keep it straight; a wobbly or short way back loses power. On a trackpad you can click once, wind up and swing back with no button held, and click again. Or use the arrow keys and Enter, or a controller: right stick back then forward.`
      : brief
        ? 'Draw back, then swipe up in one motion. Stay in the lime lines and stop in the band.'
        : 'Draw back down the screen, then swipe forward up it, in one smooth motion, from anywhere. The forward swipe is the putt: stay inside the lime lines and stop in the lime band. A short draw back costs power; too soft dies short, too hard runs long, and off line misses.';
  return `<div class="gm-meter ${drive ? '' : 'gm-meter--putt'}">
      <div class="gm-meter__top"><p class="gm-meter__t">${drive ? '' : '<span>2 ·</span> '}${pullInput() ? 'Wind up, swing' : 'Draw back, swipe'}</p><button class="chip gm-backout" type="button" data-back-out aria-label="Back out of this throw">Back out</button></div>
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
    sw.pts.push({ x: p.x, y: p.y, t: t });
    m.swing = null;
    commitSwing(sw.pts);
    return;
  }
  if (swing) {
    const an = swipeAnchor();
    if (Math.hypot(p.x - an.x, p.y - an.y) > SWING.startR) { swipeNote('PRESS ON THE DISC'); return; }
    m.swing = { pts: [{ x: p.x, y: p.y, t }], held: true, armed: false };
    S.meter.drag = { mode: 'swing', x0: p.x, y0: p.y, x: p.x, y: p.y, lastMove: t };
    try { cv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    return;
  }
  S.meter.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, mode: 'swipe', phase: 'start', samples: [{ x: p.x, y: p.y, t }], trace: [{ x: p.x, y: p.y, t }], backLen: 0, backPt: { x: p.x, y: p.y }, fwdLen: 0, fwdPt: null, peak: 0, speed: 0, slowPt: null, slowT: 0, lastMove: t };
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
  if (d.trace.length < 600) d.trace.push({ x: p.x, y: p.y, t });
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
  const power = m.throwEx ? drivePower(d.peak, len, d.backLen) : swipePower(len, d.backLen); // a drive goes as far as it is swung fast, a putt as far as it is long
  const aim = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI) * 10) / 10;
  finishSwipe({ aim: m.throwEx ? driveAim(aim) : aim, power: Math.round(power * 1000) / 1000 }, m.throwEx ? gestureQuality(d.trace) : null, m.throwEx ? driveSpeed(d.peak) : null);
}
/* ----- a drive from the gesture itself: how fast you swing through is how far it goes, how smooth the whole motion is is how clean the release is ----- */

const peakSpeed = GS.peakSpeed;
// the speed that is exactly the arm speed that was planned: a harder arm needs a faster swing through (about 1.6 to 3.6 strokes' worth of screen per second)
const driveSpeedNeed = () => swipeNeed() * (1.6 + 2.0 * clamp(((S.settings.mph || 56) - 10) / 80, 0, 1));
// the power of a drive: the speed against what the planned arm needs, and a stroke that is short, or a wind-up that is, costs some of it
// A swing at or past the planned arm speed is full power: the most that arm can give, never more and never loose; slower shortens it.
const softSpeed = (v) => Math.min(v, 1);
const driveSpeed = (peak) => peak / driveSpeedNeed(); // 1 is the speed that matches the planned arm
const drivePower = (peak, fwdLen, backLen) => {
  const need = swipeNeed();
  const lenF = clamp(0.5 + 0.5 * Math.min(1, fwdLen / (0.4 * need)), 0.5, 1);
  const backF = clamp(0.6 + 0.4 * Math.min(1, backLen / (0.6 * Math.max(1, fwdLen))), 0.6, 1);
  return softSpeed(driveSpeed(peak)) * lenF * backF;
};
// the way back up is only an aim if it is really crooked: a hand's drift of up to 10 degrees is ignored
const driveAim = (aim) => Math.sign(aim) * Math.max(0, Math.abs(aim) - 10);
const gestureQuality = (pts) => GS.gestureQuality(pts, swingHalfWidth() * 1.8);
// the release a gesture made, in the shape the rules know: how far off a perfect release it was, which way, and so its grade
function releaseFrom(quality) {
  const x = quality ? quality.bias * quality.rough * 0.55 : 0.2; // (keys and a stick have no motion to judge: a good, not a pure, release)
  return G.combine(G.readRelease(x, G.releaseSetup(S.settings.mph).w));
}

/* The mouse swing (a mouse, a trackpad, a pen): press on the disc, drag straight down to wind up, then drag back up and let go. How far down you went is
   the power; where your stroke comes back up (the line from the bottom of the wind-up to where it gets back level with the disc) is the aim, so a crooked way
   back sends it crooked; a wobbly way back and a stroke that does not get all the way back up both lose power. There is no timing. It is the way Disc Golf
   Masters' mouse throw is described (press the ball, drag it down and back up). The same {aim, power} goes to the rules as a swipe does. */
const SWING = { startR: 90, minBack: 30, ratio: 0.8, step: 2 }; // ratio: a wind-up this fraction of the swipe's length is exactly enough
const swingHalfWidth = () => clamp(swipeNeed() * 0.07, 12, 24); // how far off the straight way back still counts as straight, in pixels
function addSwingPoint(sw, p) {
  const last = sw.pts.at(-1);
  if (Math.hypot(p.x - last.x, p.y - last.y) >= SWING.step) sw.pts.push({ x: p.x, y: p.y, t: now2() });
}
// how a swing comes out: { depth, phase ('back' while still winding up, 'up' once on the way back), aim, power, reach, wobble, bottom, top }
function swingStats(pts, drive = !!S.meter?.throwEx) {
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
  // a putt: the length of the wind-up is the power. A drive: how fast the way back up goes (its length and the wind-up only have to be enough)
  const power = drive
    ? Math.max(0, drivePower(peakSpeed(pts, bi), Math.max(0, bottom.y - end.y), depth))
    : Math.max(0, (depth / (swipeNeed() * SWING.ratio)) * (reach < 1 ? reach : 1) * (1 - 0.25 * steady));
  return { depth, phase: 'up', bottom, top, aim, power: Math.round(power * 1000) / 1000, reach, wobble, speed: drive ? Math.round(driveSpeed(peakSpeed(pts, bi)) * 1000) / 1000 : undefined };
}
function commitSwing(pts) {
  if (!pts || pts.length < 2) return;
  const r = swingStats(pts);
  if (r.depth < SWING.minBack) { swipeNote('DRAG DOWN FIRST'); return; }
  if (r.phase === 'back') { swipeNote('NOW DRAG BACK UP, THEN LET GO'); return; }
  if (Math.abs(r.aim) > 60) { swipeNote('DRAG STRAIGHT BACK UP'); return; }
  const drive = !!S.meter?.throwEx;
  finishSwipe({ aim: drive ? driveAim(r.aim) : r.aim, power: r.power }, drive ? gestureQuality(pts) : null, drive ? r.speed : null);
}
// the throw (or putt) itself, from an aim and a power however they were made
function finishSwipe(swipe, quality = null, speed = null) {
  const m = S.meter;
  if (!m || S.phase !== 'swipe') return;
  m.drag = null;
  m.kb = null;
  m.swing = null;
  m.padSwing = null;
  if (m.throwEx) {
    const ex = G.withSwipe(releaseFrom(quality), swipe); // the release is how smooth the gesture was; the power, how fast it went
    S.feel = quality || speed != null ? { smooth: quality ? Math.round((1 - quality.rough) * 100) : null, speed: speed != null ? Math.min(100, Math.round(speed * 100)) : null, maxed: speed != null && speed >= 1, reason: quality?.reason || null } : null; // what to tell the player about it
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
  // the band to stop in, between the two rays (a putt: how far it goes. A drive goes as far as it is swung fast, so it has no band, only the lines)
  const driveSwing = !!m.throwEx;
  if (!driveSwing) {
    ctx.beginPath();
    ctx.arc(ax, ay, need * (1 + tol.power), -Math.PI / 2 - rad(tol.aim), -Math.PI / 2 + rad(tol.aim));
    ctx.arc(ax, ay, need * (1 - tol.power), -Math.PI / 2 + rad(tol.aim), -Math.PI / 2 - rad(tol.aim), true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(163,230,53,0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(163,230,53,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
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
      else label(driveSwing ? 'DRAG DOWN, THEN SWING UP: SMOOTH AND FAST' : 'PRESS THE DISC, DRAG DOWN, THEN UP', W / 2, Math.min(target + 44, H - S.dock - 14), '#eef1e8', Math.min(22, W / 17));
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
    const q = driveSwing && st.phase === 'up' ? Math.max(0, (0.65 - st.speed) / 0.5, (Math.abs(st.aim) - 10) / 20) : st.phase === 'up' ? Math.max(Math.abs(st.aim) / tol.aim, Math.abs(st.power - 1) / tol.power) : Math.abs(st.power - 1) / tol.power; // a drive: green unless it is slow or crooked (a hard swing is just a hard swing)
    const c = q <= 0.5 ? '#a3e635' : q <= 1 ? '#f2c14e' : '#ff6a3a';
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
    const shown = driveSwing && st.speed != null ? st.speed : st.power;
    const shownText = driveSwing && shown >= 1 ? 'MAX' : `${Math.round(shown * 100)}%`; // at or past the arm you set: that is all of it
    ctx.strokeText(shownText, e.x + 16, e.y + 5);
    ctx.fillText(shownText, e.x + 16, e.y + 5);
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
    else label(driveSwing ? 'DRAW BACK, THEN SWIPE UP: SMOOTH AND FAST' : 'DRAW BACK, THEN SWIPE UP', W / 2, Math.min(backTo + 44, H - S.dock - 14), '#eef1e8', Math.min(24, W / 14));
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
        const power = len > 0 ? (m.throwEx ? drivePower(d.peak, len, d.backLen) : swipePower(len, d.backLen)) : 0;
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
        const ptext = m.throwEx && power >= 0.995 ? 'MAX' : `${Math.round(power * 100)}%`;
        ctx.strokeText(ptext, ax + fx + 18, ay + fy + 5);
        ctx.fillText(ptext, ax + fx + 18, ay + fy + 5);
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
  const out = G.applyResult(S.round, disc, result, { bear: BEAR.on || S.mode === 'match' }); // (in a match the rule is the server's, and the same for everybody)
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
  setDisc(suggest()); // a driver from the tee, a putter on the green: you can change it
  S.aimOff = 0;
  S.view3 = 'behind';
  S.orbit = { yaw: 0, pitch: 0, zoom: 1 };
  setPhase('pick');
  retarget(false);
}

/* ---------- Marebear ---------- */

const BEAR_PARTS = { enter: 1700, chomp: 1300, burp: 900, leave: 1300 };
function startBear(info) {
  S.bear = { t0: now(), at: { ...info.at }, discId: info.discId, owner: info.owner || 'me' };
  if (!BEAR.on) { // she is switched off: a match still takes the disc (its rule), but there is no scene, only a word
    const mine = S.bear.owner === 'me';
    toast(`${mine ? 'Your' : 'A'} ${splitName(DISCS.get(info.discId)?.name || 'disc')} is out for the round`, 'bad', 2200);
    endBear();
    return;
  }
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
  if (S.meter?.classic && S.phase === 'power' && S.meter.ruler) { // the power meter on the map: room for its ruler, out to a little past the basket
    const R = S.meter.ruler;
    const want = G.distance(lie, b) * 1.3 + 40;
    pts.push(R[0], R.find((r) => r.ft >= want) || R.at(-1));
  }
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
    const pic = R >= 3 ? FO.top(tr, 2 * R * dpr, k === 'm' && autumn(tr)) : null; // the drawn crown, once it is ready (else the flat shapes below)
    if (k === 'r' && !pic) { // a rock, flat: a grey blob with a light side
      const rr = Math.max(2, tr.r * 1.15 * cam.s);
      ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fillStyle = '#5a6066'; ctx.fill();
      ctx.beginPath(); ctx.arc(x - rr * 0.18, y - rr * 0.18, rr * 0.6, 0, Math.PI * 2); ctx.fillStyle = '#8a9298'; ctx.fill();
      continue;
    }
    if (pic && k === 'r') { // a rock from above: smaller than its radius says, and a soft shadow
      const rr = tr.r * 1.15 * cam.s;
      ctx.beginPath(); ctx.ellipse(x + rr * 0.22, y + rr * 0.24, rr, rr * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
      ctx.drawImage(pic, x - rr, y - rr, rr * 2, rr * 2);
      continue;
    }
    if (pic && (k === 's' || k === 'b')) {
      const rr = k === 'b' ? R * 0.95 : R;
      ctx.beginPath(); ctx.ellipse(x + rr * 0.22, y + rr * 0.24, rr, rr * 0.9, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
      ctx.drawImage(pic, x - rr, y - rr, rr * 2, rr * 2);
      continue;
    }
    if (pic) {
      ctx.beginPath();
      ctx.ellipse(x + R * 0.28, y + R * 0.28, R, R * 0.92, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fill();
      ctx.drawImage(pic, x - R, y - R, R * 2, R * 2);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, tr.r * G.TREE_FORGIVE * cam.s), 0, Math.PI * 2); // the part that stops a disc
      ctx.fillStyle = k === 'p' ? 'rgba(10,38,25,0.75)' : 'rgba(18,58,27,0.7)';
      ctx.fill();
      continue;
    }
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
  const plan = { mph: S.settings.mph, nose: S.settings.nose || 0, angle: S.settings.angle || 0 }; // the throw as planned: it is the line you will get from a clean release
  const key = [S.hole.id, S.hole.wind.mph, S.hole.wind.from, S.hole.basket.x, S.hole.basket.y, d.id, d.turn, S.settings.hand, S.settings.style, heading(), lie.x, lie.y, plan.mph, plan.nose, plan.angle].join('|');
  if (S.previewKey !== key) {
    S.previewKey = key;
    S.preview = { pv: G.previewThrow(S.hole, d, S.settings, heading(), lie, 40, plan), end: G.previewThrow(S.hole, d, S.settings, heading(), lie, 8, plan).end };
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
  if (!BEAR.on || (!S.round && S.mode !== 'match')) return;
  $('#gm-bubble')?.classList.remove('is-on'); // her balloon has the stage: the caddy's note gets out of the way
  S.popSide = -(S.popSide || -1);
  S.pop = { t0: now(), text, to, mood, dur: MB.popDuration(text), side: S.popSide, sounded: false, act: MB.actOf(text), moodSounded: false };
}
function drawPop(t) {
  const p = S.pop;
  if (!p) return;
  const ms = t - p.t0;
  if (ms > p.dur) { S.pop = null; return; }
  const moodSound = () => SND.play(p.mood === 'bad' ? (p.text.length > 70 ? 'laugh' : 'snicker') : p.mood === 'good' ? 'hmph' : 'snicker');
  if (!p.sounded && ms > 120) { p.sounded = true; if (p.act) SND.play(p.act === 'strap' ? 'snap' : p.act); else { p.moodSounded = true; moodSound(); } } // her business first, then her laugh
  if (p.act && !p.moodSounded && ms > (p.act === 'wheeze' ? 1400 : 1000)) { p.moodSounded = true; moodSound(); }
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
  MB.drawMarebear(ctx, x, waist, sc, { mood: p.mood === 'bad' ? 'laugh' : p.mood === 'good' ? 'grudge' : 'sly', t: ms, facing: p.side > 0 ? -1 : 1, act: p.act });
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
  // over the thrower's right shoulder, a little high, so the ghost is to one side and the basket is in the clear
  const cx = lie.x - dir.x * 13 + dir.y * 1.8;
  const cy = lie.y - dir.y * 13 - dir.x * 1.8;
  const camZ = gnd(cx, cy) + 6;
  const want = { x: cx, y: cy, z: camZ, yaw: Math.atan2(b.x - cx, b.y - cy), pitch: Math.atan2(gnd(b.x, b.y) + 3.2 - camZ, Math.hypot(b.x - cx, b.y - cy)) };
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
  const puttColor = (a ? discLook(S.last.disc.id, S.last.who) : discLook(curDisc()?.id ?? S.last?.disc.id, 'me')).color;
  const player = playerFig(lie, Math.atan2(dir.x, dir.y), 'putt', a ? a.hand : S.settings.hand, a ? t - (a.t0 - (a.lead || 0)) : -1, puttColor);
  const wedge = !a && S.phase === 'putt' && S.meter?.classic && S.meter.putt && S.meter.stage === 'power' && S.meter.ruler // the meters style: the wedge along the line to the basket
    ? (g) => wedgeMeter(g, (p) => C3.project(c, view, p.x, p.y, C3.groundAt(S.hole, p.x, p.y) + 0.15))
    : null;
  C3.drawScene(ctx, { hole: S.hole, cam: c, view, disc, trail, dz: 1, chain, dusk: S.hole.weather?.dusk || 0, color: puttColor, t, player, hideDisc: !a || t < a.t0, overlay: wedge });
  S.pfov = sc ? PF.drawPuttFx(ctx, { cam: c, view, hole: S.hole, W, H }, sc, ms, a.result).fov : 0;
  if (sc) { if (ms >= sc.total + sc.tail) finishThrow(); } else if (a && t - a.t0 >= a.dur + 250) finishThrow();
}
/* ----- the ghost: a person who stands at the lie and throws (player.js has the body; cam3d.js draws it) ----- */

// which way the thrower faces on a flight: the way the disc starts out
const flightYaw = (a) => { const k = Math.min(6, a.pts.length - 1); return Math.atan2(a.pts[k].x - a.pts[0].x, a.pts[k].y - a.pts[0].y); };
// The figure, `ms` after the throw began (negative: standing ready). It stands where its hand lets go of the disc at the lie itself.
function playerFig(lie, yaw, kind, hand, ms, color, hideDisc = false) {
  const pose = PL.poseAt(kind, ms, hand);
  const rp = PL.releasePoint(kind, hand);
  const fx = Math.sin(yaw);
  const fy = Math.cos(yaw);
  return { x: lie.x - (Math.cos(yaw) * rp[0] + fx * rp[1]), y: lie.y - (-Math.sin(yaw) * rp[0] + fy * rp[1]), yaw, pose, discColor: color, hideDisc };
}
// how long the thrower takes to let go (only when the 3D view is watching), and the hand and style of whoever is throwing
const leadFor = (kind) => (CAM.on ? PL.LEAD[kind] : 0);
const handOf = (who) => (!who || who === 'me' ? S.settings.hand : 'right');
const styleOf = (who) => (!who || who === 'me' ? S.settings.style : 'backhand');

/* ----- setting up a throw in 3D: the camera stands behind the disc looking where you are aiming; drag (or tap) to aim, "Find pin" lifts it to a 3/4 view ----- */

const AIM3D_PHASES = ['pick', 'power', 'nose', 'angle', 'release', 'swipe'];
const aimIn3D = () => CAM.on && !!S.round && !S.anim && !S.aimFail && AIM3D_PHASES.includes(S.phase) && !inPutt() && S.mode !== 'menu';
const RAD = Math.PI / 180;
// where the camera wants to be: behind the disc, low, looking along the aim; or up and back, looking along the line to the basket, so both are in the picture
function aimCamWant(lie) {
  const gnd = (x, y) => C3.groundAt(S.hole, x, y);
  if (S.view3 === 'pin') {
    const b = S.hole.basket;
    const dx = b.x - lie.x;
    const dy = b.y - lie.y;
    const l = Math.hypot(dx, dy) || 1;
    const ux = dx / l;
    const uy = dy / l;
    const back = clamp(l * 0.22, 26, 80);
    const lx = lie.x + ux * l * 0.55; // the point it looks at: more than halfway to the basket
    const ly = lie.y + uy * l * 0.55;
    const lz = gnd(lx, ly);
    // the camera starts behind the disc and high; the player can swing it round that point, tilt it and move it in or out
    const o = S.orbit;
    const offX = lie.x - ux * back - lx;
    const offY = lie.y - uy * back - ly;
    const cy = Math.cos(o.yaw);
    const sy = Math.sin(o.yaw);
    const x = lx + (offX * cy - offY * sy) * o.zoom;
    const y = ly + (offX * sy + offY * cy) * o.zoom;
    const z = Math.max(gnd(x, y) + 9, gnd(x, y) + clamp(l * 0.3, 30, 120) * (1 + o.pitch) * o.zoom);
    return { x, y, z, yaw: Math.atan2(lx - x, ly - y), pitch: Math.atan2(lz - z, Math.hypot(lx - x, ly - y)), fov: 70 * RAD };
  }
  const yaw = heading() * RAD;
  const ux = Math.sin(yaw);
  const uy = Math.cos(yaw);
  const x = lie.x - ux * 20 + uy * 2; // behind the thrower and a little to their right, so the ghost is to one side and the line ahead is in the clear
  const y = lie.y - uy * 20 - ux * 2;
  const z = gnd(x, y) + 7;
  const ahead = gnd(lie.x + ux * 140, lie.y + uy * 140);
  return { x, y, z, yaw, pitch: clamp(Math.atan2(ahead + 2 - z, 160) - 0.03, -0.25, 0.1), fov: 64 * RAD };
}
// Find pin (the view from above): a drag swings the camera round the middle of the hole and tilts it, the wheel moves it in and out, Q and E swing it; a tap still aims
const pinLook = () => S.phase === 'pick' && S.view3 === 'pin' && aimIn3D();
function pinMove(e) {
  const d = S.pinDrag;
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  if (!d.moved && Math.hypot(dx, dy) > 8) d.moved = true;
  if (!d.moved) return;
  S.orbit.yaw = clamp(d.yaw0 + dx * 0.008, -1.9, 1.9);
  S.orbit.pitch = clamp(d.pitch0 - dy * 0.004, -0.5, 0.7);
  S.pinHintT = 0;
}
function toggleView3() {
  S.view3 = S.view3 === 'pin' ? 'behind' : 'pin';
  S.orbit = { yaw: 0, pitch: 0, zoom: 1 }; // each look from above starts square behind the disc
  S.pinHintT = performance.now();
  showViewBtn();
}
function showViewBtn() {
  const btn = $('#gm-view');
  if (!btn) return;
  const on = aimIn3D();
  if (btn.hidden === on) btn.hidden = !on;
  btn.classList.toggle('is-behind', !!S.pop); // Marebear's balloon is drawn on the canvas, under the chips: while she talks, the chip gets out of her way
  const pin = S.view3 === 'pin';
  const txt = pin ? 'Behind disc' : 'Find pin';
  if (btn.textContent !== txt) { btn.textContent = txt; btn.setAttribute('aria-pressed', String(pin)); }
}
// the aim line, the band a mistimed release can reach, and where it ends, laid over the 3D ground
// The power meter in the meters style is the aim wedge itself: the wedge (the ground a throw along the aim can reach, from nothing out to a full-power
// throw) fills up and drains again, the sweet spot is a lit stretch of it, and the dashed flight is the throw at the speed the fill has reached.
// Tap anywhere to throw at that speed. (`wedgeMeter` draws it, here over the 3D view and on the map when 3D is off.)
function powerOverlay(g, ground, air, lie) {
  const m = S.meter;
  if (m.putt) { wedgeMeter(g, ground); return; } // (a putt is a line on the ground)
  screenWedge(g); // a drive: the perspective squashes the far end of a wedge laid on the ground, so it is drawn flat on the screen, bottom to top
  const W_ = wedgeGeom();
  const f = fillIndex(G.powerAt((now() - m.start) / 1000));
  const k = Math.min(W_.pts.length - 2, Math.max(0, Math.floor(f)));
  const raw = W_.pts[k].mph + (W_.pts[k + 1].mph - W_.pts[k].mph) * (f - k); // the arm speed between the ruler's steps, so the flight glides instead of stepping
  const lineAt = (mph) => ((m.lines ||= {})[mph] ||= G.previewThrow(S.hole, curDisc(), S.settings, heading(), lie, 28, { mph, nose: S.settings.nose || 0, angle: S.settings.angle || 0 }).line);
  const lo = clamp(Math.floor((raw - G.ARM.min) / G.ARM.step) * G.ARM.step + G.ARM.min, G.ARM.min, G.ARM.max - G.ARM.step);
  const t = clamp((raw - lo) / G.ARM.step, 0, 1);
  const A = lineAt(lo);
  const B = lineAt(lo + G.ARM.step);
  const line = A.length !== B.length ? A : A.map((p, i) => ({ x: p.x + (B[i].x - p.x) * t, y: p.y + (B[i].y - p.y) * t, h: (p.h || 0) + ((B[i].h || 0) - (p.h || 0)) * t }));
  g.setLineDash([8, 6]);
  g.beginPath();
  let on = false;
  for (const p of line) { const a = air(p); if (!a) { on = false; continue; } if (on) g.lineTo(a.x, a.y); else g.moveTo(a.x, a.y); on = true; }
  g.strokeStyle = 'rgba(163,230,53,0.92)';
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  g.stroke();
  g.setLineDash([]);
}
function aimOverlay(c, view, lie) {
  return (g) => {
    if (!S.showLine || !curDisc()) return;
    const ground = (p) => C3.project(c, view, p.x, p.y, C3.groundAt(S.hole, p.x, p.y) + 0.15);
    const air = (p) => C3.project(c, view, p.x, p.y, C3.groundAt(S.hole, p.x, p.y) + (p.h || 0) * C3.ZS);
    if (S.meter?.classic && S.phase === 'power' && S.meter.ruler) { powerOverlay(g, ground, air, lie); return; } // the meters style: the power meter is the aim line itself
    const { pv, end } = previewNow(lie);
    if (S.phase === 'pick') {
      g.beginPath();
      let pen = false;
      for (const p of pv.band) { const q = ground(p); if (!q) { pen = false; continue; } if (pen) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); pen = true; }
      g.closePath();
      g.fillStyle = 'rgba(163,230,53,0.14)';
      g.fill();
    }
    const stroke = (pts, f, style, w, dash) => {
      g.beginPath();
      let on = false;
      for (const p of pts) { const q = f(p); if (!q) { on = false; continue; } if (on) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); on = true; }
      g.setLineDash(dash);
      g.strokeStyle = style;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.stroke();
      g.setLineDash([]);
    };
    stroke(pv.line, ground, 'rgba(238,241,232,0.28)', 1.6, [2, 6]); // where it passes over the ground
    stroke(pv.line, air, 'rgba(163,230,53,0.92)', 2.6, [8, 6]); // and the flight itself
    const e = ground(end);
    if (e) { // where it comes down, and how far that is
      g.beginPath();
      g.ellipse(e.x, e.y, Math.max(6, 9 * e.s), Math.max(3, 4.5 * e.s), 0, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(163,230,53,0.95)';
      g.lineWidth = 2;
      g.stroke();
      const label = `${Math.round(G.distance(lie, end))} ft`;
      g.font = '700 12px "Space Mono", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(6,11,7,0.8)';
      g.strokeText(label, e.x, e.y - Math.max(8, 10 * e.s));
      g.fillStyle = '#d9f99d';
      g.fillText(label, e.x, e.y - Math.max(8, 10 * e.s));
    }
  };
}
function drawAim3D(t) {
  const lie = lieOf();
  const want = aimCamWant(lie);
  const first = !S.acam;
  if (first) { S.acam = C3.newCamera(want.x, want.y, want.z, want.yaw, want.pitch, want.fov); S.acamT = t; S.aimFade = t; S.dockV = S.dock; }
  const dt = clamp((t - S.acamT) / 1000, 0.001, 0.05);
  S.acamT = t;
  const k = 1 - Math.exp(-dt * 9);
  const c = S.acam;
  c.x += (want.x - c.x) * k; c.y += (want.y - c.y) * k; c.z += (want.z - c.z) * k;
  c.yaw += (((want.yaw - c.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
  c.pitch += (want.pitch - c.pitch) * k;
  c.fov += (want.fov - c.fov) * k;
  c.roll = 0;
  S.dockV = S.dockV === undefined ? S.dock : S.dockV + (S.dock - S.dockV) * (1 - Math.exp(-dt * 7));
  const view = C3.viewOf(W, H, c, S.dockV);
  S.aimView = view;
  // The world is drawn into a picture of its own whenever the camera has moved, and that picture is simply stamped while it has not (a still
  // camera is most of the time you spend aiming, and a thousand trees and the ground are dear to draw every frame). The aim line, the pin
  // marker and the fade are drawn over it each frame.
  const color = discLook(curDisc().id, 'me').color;
  const key = [c.x.toFixed(2), c.y.toFixed(2), c.z.toFixed(2), c.yaw.toFixed(4), c.pitch.toFixed(4), c.fov.toFixed(4)].join(',') + `|${W}|${H}|${dpr}|${view.cy.toFixed(1)}|${S.hole.id}|${S.hole.variant?.seed ?? ''}|${S.hole.basket.x},${S.hole.basket.y}|${lie.x},${lie.y}|${S.hole.weather?.dusk || 0}|${color}|${FO.ready()}`;
  if (!S.aimPic || S.aimPic.key !== key) {
    const off = S.aimPic?.canvas || document.createElement('canvas');
    if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
    const g2 = off.getContext('2d');
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, W, H);
    const lift = clamp((c.z - C3.groundAt(S.hole, c.x, c.y) - 9) / 40, 0, 1); // the higher the camera, the shorter the trees are drawn, so they do not hide the hole
    C3.drawScene(g2, { hole: S.hole, cam: c, view, disc: { x: lie.x, y: lie.y, h: 0.3 }, hideDisc: true, trail: [], dz: 1, dusk: S.hole.weather?.dusk || 0, color, t, pin: false, treeScale: 1 - 0.68 * lift });
    S.aimPic = { key, canvas: off };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(S.aimPic.canvas, 0, 0);
  ctx.restore();
  C3.drawPlayer(ctx, c, view, S.hole, playerFig(lie, heading() * RAD, PL.kindFor(false, S.settings.style), S.settings.hand, -1, color), 1); // the ghost, ready to throw
  aimOverlay(c, view, lie)(ctx);
  C3.drawPin(ctx, c, C3.basis(c), view, S.hole);
  if (S.view3 === 'pin' && S.phase === 'pick' && S.pinHintT && performance.now() - S.pinHintT < 6500) { // how to look around, for a few seconds after going up
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '700 12px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(6,11,7,0.85)';
    ctx.fillStyle = '#eef1e8';
    const txt = 'DRAG TO LOOK AROUND · WHEEL OR Q E TO ZOOM AND SWING · TAP TO AIM';
    const y = Math.min(H - S.dock - 70, 96);
    ctx.strokeText(txt, W / 2, y);
    ctx.fillText(txt, W / 2, y);
    ctx.restore();
  }
  const fade = 1 - (t - S.aimFade) / 300; // a soft cut from the map (or the last throw) to the view from behind the disc
  if (fade > 0) { ctx.fillStyle = `rgba(6,11,7,${Math.min(1, fade)})`; ctx.fillRect(0, 0, W, H); }
  showViewBtn();
}
// where a screen point is on the ground, as a heading from the disc (degrees from north), seen through a camera as it was when the finger landed
function headingAtPixel(sx, sy, cam, view, lie) {
  const b = C3.basis(cam);
  const a = (sx - view.cx) / view.focal;
  const u = -(sy - view.cy) / view.focal;
  const d = [b.right[0] * a + b.up[0] * u + b.fwd[0], b.right[1] * a + b.up[1] * u + b.fwd[1], b.right[2] * a + b.up[2] * u + b.fwd[2]];
  if (d[2] < -0.004) {
    const tt = (C3.groundAt(S.hole, lie.x, lie.y) - cam.z) / d[2];
    const hx = cam.x + d[0] * tt;
    const hy = cam.y + d[1] * tt;
    if (tt > 0 && Math.hypot(hx - lie.x, hy - lie.y) > 8 && tt < 3000) return G.headingTo(lie, { x: hx, y: hy });
  }
  return (cam.yaw + Math.atan(a)) / RAD; // above the horizon: turn by the angle of the pixel
}
function draw3D(t) {
  const a = S.anim;
  const p = clamp((t - a.t0) / a.dur, 0, 1);
  const { pos, i, dir } = C3.discAt(a.pts, p);
  if (!a.cam) {
    const far = a.pts[Math.min(6, a.pts.length - 1)];
    const d0 = { x: far.x - a.pts[0].x, y: far.y - a.pts[0].y };
    const l = Math.hypot(d0.x, d0.y) || 1;
    if (S.acam) { a.cam = { ...S.acam }; a.fromAim = true; } // carry on from the camera that was aiming: no cut
    else a.cam = C3.startCamera(a.pts[0], { x: d0.x / l, y: d0.y / l }, C3.groundAt(S.hole, a.pts[0].x, a.pts[0].y));
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
  const lift = (a.relH || 0) * Math.max(0, 1 - p / 0.1) ** 2; // let go of at about head height, falling into the flight's own height
  disc.h += lift;
  C3.follow(a.cam, { ...disc, h: disc.h * C3.ZS, g: C3.groundAt(S.hole, disc.x, disc.y) }, dir, dt, { back: 15 + 7 * (1 - Math.abs(p - 0.5) * 2), lift: 3.5, ahead: 70, ground: (x, y) => C3.groundAt(S.hole, x, y) });
  const kind = a.result.kind;
  const color = discLook(S.last.disc.id, S.last.who).color;
  const player = a.kind ? playerFig(a.pts[0], flightYaw(a), a.kind, a.hand, t - (a.t0 - (a.lead || 0)), color) : null;
  const landed = Math.max(0, (t - a.t0 - a.dur) / 700);
  C3.drawScene(ctx, {
    hole: S.hole, cam: a.cam, view: C3.viewOf(W, H, a.cam, S.dock), disc, trail, dusk: S.hole.weather?.dusk || 0,
    color, t, player, hideDisc: t < a.t0,
    splash: (kind === 'water' || kind === 'oob') && p >= 1 ? { at: a.pts.at(-1), age: landed } : null,
    shake: kind === 'tree' && p >= 0.97 && landed < 0.6 ? 7 * (1 - landed / 0.6) : 0,
  });
  // fade in from the map, and out to it, so the cut is soft
  const doneAt = a.dur + (a.roll.length ? 500 : 0) + 250;
  const el = t - a.t0;
  const fade = Math.max(0, a.fromAim ? 0 : 1 - el / 260, 1 - (doneAt - el) / 300);
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
  } else if (aimIn3D()) {
    if (!stage.classList.contains('is-aim')) stage.classList.add('is-aim');
    try { drawAim3D(t); return; } catch (err) { console.error('3D aim view failed, using the map', err); S.aimFail = true; S.acam = null; stage.classList.remove('is-aim'); }
  } else {
    S.pcam = null;
    S.acam = null;
    if (stage.classList.contains('is-aim')) stage.classList.remove('is-aim');
    showViewBtn();
  }
  drawStill('ground', drawCourse);
  drawWaves(t);
  drawTrail();
  drawStill('trees', drawTrees);
  drawMandoMap();
  drawBasket();
  drawPreview();
  drawPowerMeter();
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
  if (S.phase === 'putt' && !m?.classic) drawPuttMeter(t);
  if (m?.classic && MINI_ROWS[S.phase]) updateDials(t);
  else if (m?.classic && S.phase === 'putt' && m.stage !== 'power') updatePad(t);
  else if (m?.classic && S.phase === 'putt') {
    const v = (G.needleAt((t - m.start) / 1000, m.pP) + 1) / 2;
    const ft = Math.round(v * m.maxFt);
    const near = Math.abs(ft / m.push - 1) * m.pk <= G.swipeTolerance(puttDd()).power;
    const read = $('#gm-read');
    const text = `<b>${ft} ft</b><small>${near ? 'in the lit stretch' : ft < m.push ? 'short' : 'long'}</small>`;
    if (read && read.dataset.t !== text) { read.dataset.t = text; read.innerHTML = text; }
  }
  else if (m?.classic && S.phase === 'power' && m.ruler) {
    const mph = G.mphAt(G.powerAt((t - m.start) / 1000));
    const read = $('#gm-read');
    const text = powerReadout(mph);
    if (read && read.dataset.t !== text) { read.dataset.t = text; read.innerHTML = text; }
  } else if (mark && m && METER_STAGES.includes(S.phase)) {
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

function setAimFromPointer(e, begin = false) {
  if ((S.phase !== 'pick' && !(S.meter?.classic && S.phase === 'power')) || inPutt()) return;
  const r = cv.getBoundingClientRect();
  if (aimIn3D() && S.acam && S.aimView) { // in the 3D view you aim by pointing: the heading of the ground under your finger, through the camera as it was when it landed
    if (begin || !S.aimSnap) S.aimSnap = { cam: { ...S.acam }, view: { ...S.aimView } };
    let off = headingAtPixel(e.clientX - r.left, e.clientY - r.top, S.aimSnap.cam, S.aimSnap.view, lieOf()) - baseHeading();
    off = ((off + 540) % 360) - 180;
    setAim(Math.round(off));
    return;
  }
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
  const key = stepBtn ? stepBtn.dataset.gstep : input.dataset.gr;
  if (PLAN[key]) { // a part of the planned flight: arm speed, nose or hyzer
    const sp = PLAN[key];
    const next = stepBtn ? (S.settings[key] || 0) + Number(stepBtn.dataset.dir) * sp.step : Number(input.value);
    S.settings[key] = clamp(Math.round(next / sp.step) * sp.step, sp.min, sp.max);
    S.settings.spin = null;
    renderPanel(`[data-gr="${key}"]`);
    return true;
  }
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
  const tstyle = t.closest('[data-tstyle]');
  if (tstyle) {
    setThrowStyle(tstyle.dataset.tstyle);
  } else if (hand || style) {
    const key = hand ? 'hand' : 'style';
    S.settings[key] = (hand || style).dataset[key];
    saveSettings();
    renderPanel(`[data-${key}="${S.settings[key]}"]`);
  } else if (t.closest('[data-back-out]')) {
    backOut();
  } else if (t.closest('[data-disc]')) {
    const id = Number(t.closest('[data-disc]').dataset.disc);
    if (!S.round.eaten.includes(id)) { setDisc(id); renderPanel(`[data-disc="${id}"]`); retarget(false); }
  } else if (t.closest('[data-step]')) {
    S.step = t.closest('[data-step]').dataset.step;
    renderPanel();
  } else if (t.closest('[data-next-step]')) {
    const order = phoneSteps();
    S.step = order[Math.min(order.length - 1, order.indexOf(S.step) + 1)]; // the next one (it used to know only three)
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
  } else if (t.closest('[data-course]')) {
    setCourse(Number(t.closest('[data-course]').dataset.course));
    if (S.phase === 'menu') { previewHole(courseHoles()[0].id); }
    renderPanel(`[data-course="${S.courseId}"]`);
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
  S.hole = holeById(id) || courseHoles()[0];
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
  else if (PLAN[key]) { S.settings[key] = v; S.settings.spin = null; out.textContent = planText(key); } // the line over the ground follows as you slide
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
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back', PageUp: 'prev', PageDown: 'next', '[': 'prev', ']': 'next', a: 'prev', d: 'next', w: 'catPrev', s: 'catNext', v: 'view', q: 'lookL', e: 'lookR' }; // (A and D change disc, W and S change kind of disc, as in Disc Golf Masters)

// the first disc of the next (or previous) kind in the bag: putters, midranges, fairway and distance drivers
function selectKind(step) {
  const list = available().map((x) => x.disc).sort((p, q) => p.speed - q.speed || p.name.localeCompare(q.name));
  if (!list.length) return;
  const cur = DISCS.get(S.discId);
  const kinds = [...new Set(list.map((d) => (d.speed <= 4 ? 'p' : d.speed <= 6 ? 'm' : d.speed <= 9 ? 'f' : 'd')))];
  const kindOf = (d) => (d.speed <= 4 ? 'p' : d.speed <= 6 ? 'm' : d.speed <= 9 ? 'f' : 'd');
  const i = kinds.indexOf(kindOf(cur));
  const k = kinds[(i + step + kinds.length) % kinds.length];
  setDisc(list.find((d) => kindOf(d) === k).id);
  renderPanel(`[data-disc="${S.discId}"]`);
  retarget(false);
}
function selectDisc(step) {
  const list = available();
  if (!list.length) return;
  const i = list.findIndex((x) => x.disc.id === S.discId);
  setDisc(list[(i + step + list.length) % list.length].disc.id);
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
  if (name === 'view') { if (!aimIn3D()) return false; toggleView3(); return true; } // the 3/4 view, to find the pin
  if (name === 'lookL' || name === 'lookR') { if (!pinLook()) return false; S.orbit.yaw = clamp(S.orbit.yaw + (name === 'lookL' ? -0.14 : 0.14), -1.9, 1.9); S.pinHintT = 0; return true; }
  if (S.phase === 'flight') { // a ride can be skipped
    if ((name === 'confirm' || name === 'back') && S.anim && riding()) { S.anim.t0 -= 1e7; return true; }
    return false;
  }
  if (isMeter()) { if (name === 'confirm') { tap(); return true; } if (name === 'back') return backOut(); return false; }
  if (S.phase === 'swipe') { // the swipe, made with keys or a stick: aim and power, then throw
    const m = S.meter;
    if (!m) return false;
    const kb = () => (m.kb ||= { aim: 0, power: 1 });
    if (name === 'left') kb().aim = clamp(kb().aim - amt, -45, 45);
    else if (name === 'right') kb().aim = clamp(kb().aim + amt, -45, 45);
    else if (name === 'up') kb().power = clamp(Math.round((kb().power + 0.03 * amt) * 100) / 100, 0.15, 2);
    else if (name === 'down') kb().power = clamp(Math.round((kb().power - 0.03 * amt) * 100) / 100, 0.15, 2);
    else if (name === 'confirm') { finishSwipe({ aim: kb().aim, power: kb().power }); return true; }
    else if (name === 'back') { if (!m.kb && !m.swing && !m.padSwing && !m.drag) return backOut(); m.kb = null; m.swing = null; m.padSwing = null; m.drag = null; return true; } // first clears a swing in progress, then backs out
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
      : S.phase === 'pick' ? `${L} ${R} aim · ${U} ${D} disc${inPutt() || isPad ? '' : ' · V: find pin'} · ${OK}: ${inPutt() ? 'putt' : 'next / throw'}`
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
  S.hole = courseHoles()[0];
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
  return `<li><span>${who}<small>${courseById(m.course ?? 1).name} · ${m.holes} holes${m.status === 'active' ? ` · on hole ${m.holeIdx + 1}` : ''} · ${state}</small></span>${m.invitedYou
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
      ${courseChooser()}
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
    const d = await gapi('/matches', { method: 'POST', body: { holes: S.lobby.holes, course: S.courseId, invite: S.lobby.invite.trim(), bagId: account.activeId } });
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
    S.hole = holesOfView(view)[0];
    S.round = G.newRound(S.hole);
    S.trail = [];
    S.others = [];
  }
  S.course = { length: view.holes, courseId: view.course ?? 1, holes: holesOfView(view).slice(0, view.holes), idx: view.holeIdx, card: (view.cards[me] || []).map((c) => ({ id: c.hole, par: c.par, strokes: c.strokes, score: c.score, holed: c.holed })), eaten: view.eaten[me] || [] };
  const mine = myself(view);
  S.bag = {
    starter: false,
    discs: mine.discs.map((d) => {
      const own = account.bags.flatMap((b) => (b.items?.[d.id] ? [b.items[d.id]] : [])).find((it) => it.color || it.photo);
      return { disc: DISCS.get(d.id), item: own || (d.color ? { color: d.color } : null) };
    }).filter((x) => x.disc),
  };
  if (!S.bag.discs.some((x) => x.disc.id === S.discId && !S.round.eaten.includes(x.disc.id))) setDisc(suggest());
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
  S.last = { result, ex: last.ex, disc, from: last.from, who, feel: who === 'me' ? S.mpFeel : null };
  if (last.putt) {
    S.anim = puttAnim(last.from, result, last.lie, who);
  } else {
    const kind = PL.kindFor(false, styleOf(who));
    const lead = watching3D(who) ? PL.LEAD[kind] : 0;
    const anim = { type: 'flight', t0: now() + lead, lead, kind, hand: handOf(who), relH: PL.releasePoint(kind, handOf(who))[2], dur: camDur(clamp(900 + last.feet * 4.2, 1200, 3300)) * (last.kind === 'basket' ? 1.5 : 1), pts, roll, result, putt: false, cine: last.kind === 'basket' };
    S.anim = anim;
    setTimeout(() => { if (S.anim === anim) SND.play('throw', 0.6); }, lead);
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
  else toast(`${name}${last.ex?.grade || ''}${who === 'me' && S.mpFeel?.maxed ? ' · full power' : who === 'me' && S.mpFeel?.speed != null ? ` · ${S.mpFeel.speed}% speed` : ''}${who === 'me' && S.mpFeel?.smooth != null ? ` · ${S.mpFeel.smooth}% smooth` : ''}`, last.ex?.pure ? 'good' : last.ex?.slip || last.ex?.grade === 'Shank' ? 'bad' : '', 1400);
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
    replayMove(b, K.holeOn(v.seed, holeById(b.holeId), { idx: Math.max(0, holesOfView(v).findIndex((x) => x.id === b.holeId)), n: v.holes, rain: !!v.rain }));
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
  S.mpFeel = S.feel;
  S.feel = null;
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
  const next = holesOfView(v)[v.holeIdx];
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
    return `<li><span>${holeById(c.hole).n}. ${esc(holeById(c.hole).name)}</span><span>par ${c.par}</span><b class="${c.score < (o?.score ?? 99) ? 'is-under' : ''}">${c.holed ? c.strokes : `${c.score}*`}</b><b class="${o && o.score < c.score ? 'is-under' : ''}">${o ? (o.holed ? o.strokes : `${o.score}*`) : '–'}</b></li>`;
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
  try { T.useHeckles(await (await fetch('/data/heckles.json?v=4')).json()); } catch { /* her own lines are enough */ }
  try { T.useMemory(JSON.parse(localStorage.getItem('dj_said'))); } catch { T.useMemory([]); } // what she has already said, so she does not say it again
  for (const r of DATA.discs) DISCS.set(r[0], { id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7], col: r[8] });

  document.addEventListener('pointerdown', SND.unlock);
  const sndBtn = $('#gm-sound');
  const showSnd = () => { sndBtn.setAttribute('aria-pressed', String(SND.isOn())); sndBtn.textContent = SND.isOn() ? 'Sound on' : 'Sound off'; };
  showSnd();
  sndBtn.addEventListener('click', () => { SND.setOn(!SND.isOn()); showSnd(); SND.play('tap'); });
  const bearBtn = $('#gm-bear');
  const showBear = () => { bearBtn.setAttribute('aria-pressed', String(BEAR.on)); bearBtn.textContent = BEAR.on ? 'Marebear on' : 'Marebear off'; };
  showBear();
  bearBtn.addEventListener('click', () => {
    BEAR.on = !BEAR.on;
    try { localStorage.setItem('dj_bear', BEAR.on ? 'on' : 'off'); } catch { /* not saved */ }
    if (!BEAR.on) { S.pop = null; S.quip = ''; $('#gm-bubble')?.classList.remove('is-on'); }
    showBear();
    SND.play('tap');
  });
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
  $('#gm-mini').addEventListener('pointerdown', (e) => { if (isMeter() && S.meter?.classic) { e.preventDefault(); tap(); } }); // anywhere in the timing window is the tap
  p.addEventListener('keydown', (e) => { if (e.target.matches('[data-tap]') && (e.key === ' ' || e.key === 'Enter')) e.preventDefault(); });
  document.addEventListener('keydown', onKey);
  cv.addEventListener('contextmenu', (e) => e.preventDefault()); // a right click is a throw, not a menu
  document.addEventListener('pointerdown', (e) => { S.pointerKind = e.pointerType; setInput(e.pointerType === 'touch' ? 'touch' : 'mouse'); }, true);
  cv.addEventListener('pointerdown', (e) => {
    if (riding()) { S.anim.t0 -= 1e7; return; } // tap to skip the ride
    if (S.phase === 'swipe') { beginSwipe(e); return; }
    if (S.meter?.classic && isMeter()) { // the meters style: tap anywhere on the hole to stop the marker; on the last stage a drag aims, a tap throws
      if (S.phase === 'power') { S.wedgeDown = { x: e.clientX, y: e.clientY, moved: false }; try { cv.setPointerCapture?.(e.pointerId); } catch { /* gone */ } } else tap();
      return;
    }
    try { cv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    if (pinLook()) { S.pinDrag = { x: e.clientX, y: e.clientY, moved: false, yaw0: S.orbit.yaw, pitch0: S.orbit.pitch }; return; } // from above, a drag looks around; a tap aims (on the up)
    setAimFromPointer(e, true);
  });
  cv.addEventListener('wheel', (e) => { if (!pinLook()) return; e.preventDefault(); S.orbit.zoom = clamp(S.orbit.zoom * (1 + e.deltaY * 0.0012), 0.55, 1.8); }, { passive: false });
  cv.addEventListener('pointermove', (e) => {
    if (S.phase === 'swipe') { moveSwipe(e); return; }
    const wd = S.wedgeDown;
    if (wd) {
      const first = !wd.moved && Math.hypot(e.clientX - wd.x, e.clientY - wd.y) > 9;
      if (first) wd.moved = true;
      if (wd.moved && S.meter?.classic && S.phase === 'power') {
        const before = S.aimOff;
        setAimFromPointer(e, first);
        if (S.aimOff !== before) rebuildWedge();
      }
      return;
    }
    if (S.pinDrag) { pinMove(e); return; }
    if (e.buttons || e.pointerType === 'touch') setAimFromPointer(e);
  });
  cv.addEventListener('pointerup', (e) => {
    const wd = S.wedgeDown;
    if (wd) { // the last stage of the meters style: a drag aimed (the sweet spot is worked out again), a plain tap is the throw
      S.wedgeDown = null;
      S.aimSnap = null;
      if (S.meter?.classic && S.phase === 'power') { if (wd.moved) { retarget(false); sweetFor('arm'); } else tap(); }
      return;
    }
    const d = S.pinDrag;
    S.pinDrag = null;
    if (d && !d.moved) { S.aimSnap = null; setAimFromPointer(e, true); } // a tap from above: aim there
    S.aimSnap = null;
    endSwipe(e);
  });
  cv.addEventListener('pointercancel', () => { S.wedgeDown = null; S.aimSnap = null; S.pinDrag = null; if (S.meter) S.meter.drag = null; });
  $('#gm-view').addEventListener('click', () => { toggleView3(); SND.play('tap'); });

  onAccountChange(() => {
    syncGame();
    if (S.phase === 'daily') { if (account.user) { S.daily.loading = true; refreshDaily(); } renderPanel(); return; }
    if (!S.round) return;
    if (!account.user && (S.mode === 'match' || S.mode === 'lobby')) { showMenu(); return; }
    if (S.mode === 'match') return; // a match keeps the bag it started with
    S.bag = buildBag();
    if (!S.bag.discs.some((x) => x.disc.id === S.discId)) setDisc(suggest());
    if (S.phase === 'pick' || S.phase === 'menu' || S.phase === 'lobby') renderPanel();
  });
  // a link to a match (?match=CODE): read it before the page tidies its own address
  const code = (new URLSearchParams(location.search).get('match') || '').toUpperCase();
  await loadAccount();
  GR.warm(courseHoles()[0]);
  FO.start(() => { still.trees = null; }); // the drawn trees are made in the background; the map's cached picture of them is redone once they are
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
  window.__gm = { gestureQuality, releaseFrom, drivePower, driveSpeedNeed, swingStats, popUp, say, SND, startSwipe, puttDisc, S, G, clock, tap, throwDisc, startMeter, next, retarget, cam, DISCS, showMenu, startSolo, startHole, startBear, finishThrow, finishHole, finishCourse, openLobby, enterMatch, applyView, onMatchState, finishMove, mpCreate, mpJoin, step: () => { const t = now(); update(t); draw(t); } };
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  const p = panel();
  if (p) p.innerHTML = `<div class="gm-card"><h2 class="is-bad">Couldn't load</h2><p>${esc(err.message)}</p></div>`;
});
