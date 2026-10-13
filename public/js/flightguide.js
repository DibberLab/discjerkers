/* Flight guide: speed rows x stability columns, every disc a round chip. */

import { account, activeBag, inBag, onAccountChange, loadAccount, mountBar, openSignIn, openBags, addDisc as bagAdd, removeDisc as bagRemove, setActive, setItem, setPhoto, clearPhoto, photoToJpeg, photoUrl } from './fgaccount.js?v=3';

const BANDS = [
  { label: 'Very overstable',  cols: [0, 1, 2],        tint: 'var(--rust)' },
  { label: 'Overstable',       cols: [3, 4, 5, 6],     tint: 'var(--rust-lift)' },
  { label: 'Stable',           cols: [7, 8, 9],        tint: 'var(--grey)' },
  { label: 'Understable',      cols: [10, 11, 12, 13], tint: 'var(--pine-lift)' },
  { label: 'Very understable', cols: [14, 15, 16],     tint: 'var(--lime)' },
];
const bandOf = (col) => BANDS.findIndex((b) => b.cols.includes(col));

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function lum(hex) {
  const m = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// some brands ship a label color that disappears on their own disc color; keep theirs only when it reads
function readableInk(bg, tx) {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(bg)) return '#0b0f0b';
  if (hex.test(tx) && contrast(bg, tx) >= 4) return tx;
  return lum(bg) > 0.35 ? '#0b0f0b' : '#f4f6ef';
}
function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const x = (v) => Math.round(255 * v).toString(16).padStart(2, '0');
  return `#${x(f(0))}${x(f(8))}${x(f(4))}`;
}
const bestInk = (bg) => (contrast(bg, '#0b0f0b') >= contrast(bg, '#f4f6ef') ? '#0b0f0b' : '#f4f6ef');
const swatch = (c) => ({ c, t: bestInk(c) });
// one smooth spectral sweep across A–Q: warm = fights the wind, cool = flips over
const GRADE = Array.from({ length: 17 }, (_, i) => swatch(hslHex(4 + (262 - 4) * (i / 16), 76, 64)));
const TYPE_HUES = [350, 24, 46, 148, 190, 266];
const TYPE = TYPE_HUES.map((h) => swatch(hslHex(h, 76, 64)));
BANDS.forEach((b) => { b.tint = GRADE[Math.round((b.cols[0] + b.cols.at(-1)) / 2)].c; });
const fmtTurn = (v) => (v > 0 ? `+${v}` : String(v));
const nf = new Intl.NumberFormat('en-US');

const state = {
  q: '',
  brands: new Set(),
  cats: new Set(),
  bands: new Set(),
  view: 'grades',
  color: 'stability',
  sizes: { bands: 52, grades: 40 },   // each view remembers its own disc size
  selected: null,
  hand: 'right',
  style: 'backhand',
  windDir: 0, // where the wind comes FROM; you always throw north, so 0 (north) is a headwind
  windMph: 0,
  mph: 56, // arm speed: release speed in mph, in 2 mph steps
  spin: null, // release spin in rpm; null = what is typical for that speed
  panel: 'disc', // what the side panel is showing: one disc, or the comparison
  fromBag: false, // the disc panel was opened from the bag view, so it can go back
  bagFilter: null, // the chart's bag filter: a bag id, ALL_BAGS for every disc in any of your bags, or null for no filter
  bagOff: new Set(), // `${bagId}:${discId}` of bag discs switched off in the bag's flight view
  cmp: [], // comparison throws, up to MAX_CMP: { uid, id, hand, style, arm, angle }
  angle: 0, // release angle in steps of ANGLE_STEP degrees: + is hyzer, - is anhyzer
};

let DATA, discs, brands, LETTERS, weights, lastFocus;

// RHBH and LHFH spin clockwise (fade finishes left); LHBH and RHFH spin counter-clockwise (fade finishes right)
const spinsClockwise = (t = state) => (t.hand === 'right') === (t.style === 'backhand');
function loadThrow() {
  try {
    const t = JSON.parse(localStorage.getItem('dj_fg_throw'));
    if (t && ['right', 'left'].includes(t.hand) && ['backhand', 'forehand'].includes(t.style)) { state.hand = t.hand; state.style = t.style; }
    if (t && Number.isInteger(t.mph) && t.mph >= MPH.min && t.mph <= MPH.max && t.mph % MPH.step === 0) state.mph = t.mph;
    else if (t && Number.isInteger(t.arm) && t.arm >= 0 && t.arm < 6) state.mph = [40, 48, 56, 62, 70, 78][t.arm]; // the old six levels
    if (t && Number.isInteger(t.spin) && t.spin >= SPIN.min && t.spin <= SPIN.max) state.spin = t.spin;
  } catch { /* private mode / blocked storage: keep the defaults */ }
}
function saveThrow() {
  try { localStorage.setItem('dj_fg_throw', JSON.stringify({ hand: state.hand, style: state.style, mph: state.mph, spin: state.spin })); } catch { /* not persisted */ }
}

async function init() {
  const res = await fetch('/data/flightguide.json?v=1');
  DATA = await res.json();
  brands = DATA.brands;
  brands.forEach((b) => { b.ink = readableInk(b.c, b.t); });
  LETTERS = DATA.cols.split('');

  discs = DATA.discs.map((r) => {
    const d = {
      id: r[0], name: r[1], b: r[2], cat: r[3], speed: r[4], glide: r[5], turn: r[6], fade: r[7],
      col: r[8], dia: r[9], h: r[10], rd: r[11], rt: r[12], mw: r[13], appr: r[14], link: r[15],
    };
    d.band = bandOf(d.col);
    d.row = Math.round(d.speed);
    d.hay = `${d.name} ${brands[d.b].n}`.toLowerCase();
    return d;
  });

  // column widths follow how crowded each column really is, softened so thin columns stay usable
  const bandCounts = BANDS.map(() => 0);
  const colCounts = LETTERS.map(() => 0);
  discs.forEach((d) => { bandCounts[d.band]++; colCounts[d.col]++; });
  // bands are softened so thin bands stay usable; A–Q columns track their crowding almost 1:1 to keep rows short
  const soft = (n) => Math.max(10, n) ** 0.62;
  const crowd = (n) => Math.max(10, n) ** 0.95;
  weights = { bands: bandCounts.map(soft), grades: colCounts.map(crowd) };

  $('#stat-molds').textContent = nf.format(discs.length);
  $('#stat-brands').textContent = nf.format(brands.length);
  const snap = new Date(`${DATA.snapshot}T00:00:00`);
  $('#fg-snap').textContent = snap.toLocaleString('en-US', { month: 'short', year: 'numeric' });

  if (document.documentElement.clientWidth < 700) {
    state.view = 'bands';
    document.querySelectorAll('.fg-seg [data-view]').forEach((el) => el.setAttribute('aria-pressed', el.dataset.view === 'bands' ? 'true' : 'false'));
  }

  loadThrow();
  buildFilters();
  wire();
  render();
}

/* ---------- filters ---------- */

function buildFilters() {
  const catCounts = DATA.cats.map(() => 0);
  discs.forEach((d) => catCounts[d.cat]++);
  $('#fg-cats').innerHTML = DATA.cats
    .map((c, i) => `<button class="chip chip--dot" type="button" data-cat="${i}" aria-pressed="false"><i style="--dot:${TYPE[i].c}"></i>${esc(c)} <small style="opacity:.55">${catCounts[i]}</small></button>`)
    .join('');

  $('#fg-stabs').innerHTML = BANDS
    .map((b, i) => `<button class="chip chip--dot" type="button" data-band="${i}" aria-pressed="false"><i style="--dot:${b.tint}"></i>${b.label}</button>`)
    .join('');

  $('#fg-brand-list').innerHTML = brands
    .map((b, i) => `<button class="fg-brand" type="button" data-b="${i}" data-name="${esc(b.n.toLowerCase())}" aria-pressed="false"><i style="--dot:${b.c}"></i><span>${esc(b.n)}</span><small>${b.k}</small></button>`)
    .join('');
}

let bagFilterIds = null; // the discs of the bag the chart is narrowed to, set at the start of each render
let wasBagFiltered = false;
const ALL_BAGS = '*';
function setBagFilter(value) {
  state.bagFilter = value;
}
// the bag (or the combined bags) the chart is narrowed to, or null
function filterBag() {
  if (!state.bagFilter || !account.user) return null;
  if (state.bagFilter === ALL_BAGS) return { id: ALL_BAGS, all: true, name: 'all your bags', discs: [...new Set(account.bags.flatMap((b) => b.discs))] };
  return account.bags.find((b) => b.id === state.bagFilter) || null;
}

function matches(d, q) {
  if (bagFilterIds && !bagFilterIds.has(d.id)) return false;
  if (state.cats.size && !state.cats.has(d.cat)) return false;
  if (state.brands.size && !state.brands.has(d.b)) return false;
  if (state.bands.size && !state.bands.has(d.band)) return false;
  if (q) {
    if (q.nums) {
      const f = [d.speed, d.glide, d.turn, d.fade];
      return q.nums.every((n, i) => f[i] === n);
    }
    return q.tokens.every((t) => d.hay.includes(t));
  }
  return true;
}

function parseQuery(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if (/^[\d.\s/-]+$/.test(q) && /\d/.test(q)) {
    const nums = q.split(/[\s/]+/).filter(Boolean).map(Number);
    if (nums.length <= 4 && nums.every((n) => !Number.isNaN(n))) return { nums };
  }
  return { tokens: q.split(/\s+/).filter(Boolean) };
}

function renderLegend() {
  const dot = (c, label) => `<span class="fg-lg"><i style="background:${c}"></i>${label}</span>`;
  let h = '';
  if (state.color === 'stability') {
    h = `<span class="fg-lg fg-lg--bar"><span>Fights the wind</span><b style="background:linear-gradient(90deg,${GRADE.map((g) => g.c).join(',')})"></b><span>Flips over</span></span>`;
  } else if (state.color === 'type') {
    h = DATA.cats.map((c, i) => dot(TYPE[i].c, c)).join('');
  } else {
    h = '<span class="fg-lg">Each manufacturer\'s own color</span>';
  }
  const styled = account.user && account.bags.some((b) => Object.values(b.items || {}).some((it) => it.color || it.photo));
  if (styled) h += '<span class="fg-lg">· Discs in your bags wear your own color or photo</span>';
  $('#fg-legend').innerHTML = `<span class="fg-label">Legend</span>${h}`;
  $('#fg-brand-list').dataset.mode = state.color;
}

/* ---------- chart ---------- */

function paint(d) {
  if (state.color === 'brand') return { c: brands[d.b].c, t: brands[d.b].ink };
  return state.color === 'type' ? TYPE[d.cat] : GRADE[d.col];
}

// How the signed-in user has dressed a disc (a color and/or a photo): from the bag the chart is narrowed to, else
// the active bag, else any bag that has something to show for it. It is used everywhere the disc is drawn.
const hasLook = (it) => (it && (it.color || it.photo) ? it : null);
function bagItem(discId) {
  if (!account.user) return null;
  const f = filterBag();
  if (f && !f.all) return hasLook(f.items?.[discId]);
  for (const b of [activeBag(), ...account.bags]) {
    const it = hasLook(b?.items?.[discId]);
    if (it) return it;
  }
  return null;
}
// a bag disc in the color its owner gave it; otherwise whatever color the chart is using
const ownPaint = (d, item) => (item?.color ? swatch(item.color) : paint(d));

// a path drawn in a dark disc color would vanish on the dark field: lighten it until it can be seen
const blend = (hex, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + 255 * t).toString(16).padStart(2, '0')).join('')}`;
function lineColor(hex) {
  let c = hex;
  for (let i = 0; i < 6 && contrast(c, '#0b0f0b') < 3; i++) c = blend(c, 0.25);
  return c;
}

function discHTML(d, label = d.name, item = bagItem(d.id)) { // not safe to pass straight to .map(): the index would become the label
  const b = brands[d.b];
  const pc = item?.color ? swatch(item.color) : paint(d); // a disc its owner has dressed wears that, whatever the chart's color mode
  const n = label.length;
  const fs = n <= 5 ? 1 : n <= 7 ? 0.88 : n <= 9 ? 0.68 : n <= 11 ? 0.6 : 0.52;
  const nums = `${d.speed} / ${d.glide} / ${fmtTurn(d.turn)} / ${d.fade}`;
  const photo = item?.photo ? `;--fill:url('${photoUrl(item.photo)}') center/cover` : '';
  const plastic = `${item?.plastic ? `, ${esc(item.plastic)}` : ''}${item?.weight ? `, ${item.weight} g` : ''}`;
  return `<button class="disc" type="button" data-id="${d.id}"${photo ? ' data-photo' : ''} style="--c:${pc.c};--t:${pc.t};--fs:${fs}${photo}" aria-pressed="${state.selected === d.id}" title="${esc(b.n)} ${esc(d.name)}${plastic} · ${nums}" aria-label="${esc(b.n)} ${esc(d.name)}${plastic}, flight numbers ${nums}"><span class="disc__n">${esc(label)}</span></button>`;
}

const GUTTER = 10;       // page margin the chart leaves, total
const ROWHEAD = 64;      // speed column
const FIT_PAD = 12;      // cell padding inside the fitted A–Q view
const BARE_BELOW = 34;   // discs smaller than this drop their names

// A–Q fits the page when it can: the chart spans the viewport and the discs shrink just enough to give all 17 columns room.
function layout(grades) {
  const vw = document.documentElement.clientWidth;
  document.documentElement.style.setProperty('--fg-vw', `${vw}px`);
  const avail = vw - GUTTER - ROWHEAD - 2;
  const fit = grades && vw >= 900;
  const cap = Math.floor(avail / 17) - FIT_PAD;
  const want = state.sizes[state.view];
  return { vw, fit, cap, size: fit ? Math.max(20, Math.min(want, cap)) : want };
}

function render() {
  renderLegend();
  const q = parseQuery(state.q);
  const inBagFilter = filterBag();
  bagFilterIds = inBagFilter ? new Set(inBagFilter.discs) : null;
  wasBagFiltered = !!inBagFilter;
  const list = discs.filter((d) => matches(d, q));
  const grades = state.view === 'grades';

  $('#fg-count').innerHTML = `Showing <b>${nf.format(list.length)}</b> of ${nf.format(discs.length)} discs${inBagFilter ? ` · in ${esc(inBagFilter.name)}` : ''}`;
  $('#fg-brand-count').textContent = state.brands.size ? `· ${state.brands.size} picked` : `· all ${brands.length}`;

  const chart = $('#fg-chart');
  const L = layout(grades);
  $('.fg-scroll').classList.toggle('is-wide', grades && !L.fit && list.length > 0);
  const slider = $('#fg-size');
  slider.max = L.fit ? Math.max(24, L.cap) : 74;
  slider.value = L.size;
  if (!list.length) {
    chart.innerHTML = inBagFilter && !inBagFilter.discs.length
      ? `<div class="fg-empty"><b>${inBagFilter.all ? 'Your bags are empty' : `${esc(inBagFilter.name)} is empty`}</b>Open any disc and tap Add to bag.</div>`
      : '<div class="fg-empty"><b>Nothing out there</b>No discs match. Blame the filters.</div>';
    return;
  }

  const groups = grades
    ? LETTERS.map((L, i) => ({ label: L, band: bandOf(i), tint: BANDS[bandOf(i)].tint }))
    : BANDS.map((b, i) => ({ label: b.label, sub: `${LETTERS[b.cols[0]]}–${LETTERS[b.cols.at(-1)]}`, band: i, tint: b.tint }));
  const w = grades ? weights.grades : weights.bands;

  const buckets = new Map();
  const rowSet = new Set();
  for (const d of list) {
    const key = `${d.row}|${grades ? d.col : d.band}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
    rowSet.add(d.row);
  }
  const rows = [...rowSet].sort((a, b) => b - a);

  let h = `<div class="fg-axis"><span style="color:${GRADE[1].c}">← Fights the wind, fades hard</span><span style="color:${GRADE[15].c}">Flips over, turns right →</span></div>`;
  h += '<div class="fg-corner">Speed ↓</div>';
  if (grades) {
    BANDS.forEach((b) => { h += `<div class="fg-colhead" style="--tint:${b.tint};grid-column:span ${b.cols.length}">${b.label}</div>`; });
    h += '<div class="fg-corner fg-corner--2"></div>';
    groups.forEach((g) => { h += `<div class="fg-letter">${g.label}</div>`; });
  } else {
    groups.forEach((g) => { h += `<div class="fg-colhead" style="--tint:${g.tint}">${g.label}<small>${g.sub}</small></div>`; });
  }

  for (const sp of rows) {
    h += `<div class="fg-rowhead"><b>${sp}</b><small>speed</small></div>`;
    groups.forEach((g, gi) => {
      const items = buckets.get(`${sp}|${gi}`) || [];
      h += `<div class="fg-cell" data-alt="${g.band % 2}">${items.map((disc) => discHTML(disc)).join('')}</div>`;
    });
  }

  const floor = !grades ? '116px' : L.fit ? `calc(var(--disc) + ${FIT_PAD}px)` : 'calc(var(--disc) + 22px)';
  const cols = `${ROWHEAD}px ${w.map((x) => `minmax(${floor},${x.toFixed(2)}fr)`).join(' ')}`;
  const scrollMin = grades && !L.fit ? `;min-width:calc(${ROWHEAD}px + ${w.length} * (var(--disc) + 22px))` : '';
  chart.innerHTML = `<div class="fg-grid${L.size < BARE_BELOW ? ' is-bare' : ''}${L.fit ? ' is-fit' : ''}" style="--disc:${L.size}px;grid-template-columns:${cols}${scrollMin}">${h}</div>`;
  markCompared();
  markBag();
}

/* ---------- drawer ---------- */

// Flight drawn on a measured field. Carry is a rough estimate from speed and glide, scaled by the thrower's
// arm, and the grid is 100 ft a square. Not physics: a way to compare discs.
const FP = { w: 360, h: 417, x0: 200, y0: 392, k: 0.74, left: 52, right: 352 };
const GRID_FT = 500; // far enough for nearly every throw; the longest are held just inside it
// Arm speed is release speed in mph, in 2 mph steps. Spin is release rpm. Both match what a Tech Disc reports.
const MPH = { min: 30, max: 90, step: 2 };
const SPIN = { min: 400, max: 1600, step: 50 };
const RPM_PER_MPH = 15; // a typical throw spins about this many rpm for every mph it leaves the hand at
// mph -> cap (the disc speed that arm can get fully up to speed) and power (the distance the arm adds on top);
// a straight line between these points
const ARM_ANCHORS = [[30, 4, 0.62], [40, 6, 0.74], [48, 8, 0.87], [56, 10, 1], [62, 11.5, 1.05], [70, 13, 1.1], [78, 15, 1.14], [90, 15, 1.16]];
function armAt(mph) {
  const pts = ARM_ANCHORS;
  if (mph <= pts[0][0]) return { cap: pts[0][1], power: pts[0][2] };
  for (let i = 1; i < pts.length; i++) {
    if (mph <= pts[i][0]) {
      const [m0, c0, p0] = pts[i - 1];
      const [m1, c1, p1] = pts[i];
      const f = (mph - m0) / (m1 - m0);
      return { cap: c0 + (c1 - c0) * f, power: p0 + (p1 - p0) * f };
    }
  }
  const last = pts.at(-1);
  return { cap: last[1], power: last[2] };
}
const TIERS = [[44, 'Beginner'], [52, 'Beginner Plus'], [59, 'Intermediate'], [66, 'Intermediate Plus'], [74, 'Advanced'], [Infinity, 'Pro']];
const tierName = (mph) => TIERS.find(([max]) => mph < max)[1];
const typicalSpin = (mph) => Math.round((mph * RPM_PER_MPH) / SPIN.step) * SPIN.step;
const spinOf = (t) => (t.spin == null ? typicalSpin(t.mph) : t.spin);

// How this arm, this spin and this disc get along. A disc faster than the arm can power never gets up to speed: it
// carries less and fades early. A slow disc on a strong arm is overpowered: it turns over more. Spin past what
// the throw would normally have steadies the disc (less turn and fade, a touch farther); less lets it wobble.
function armEffects(d, t = state) {
  const a = armAt(t.mph);
  const ratio = Math.min(1, a.cap / d.speed);
  const over = clamp(a.cap / d.speed, 1, 2);
  const q = t.spin == null ? 1 : clamp(t.spin / (RPM_PER_MPH * t.mph), 0.5, 1.7);
  const steady = q ** -0.7;
  return {
    ratio,
    cap: a.cap,
    power: a.power,
    carry: clamp(0.82 + 0.18 * q, 0.85, 1.07),
    turn: (0.4 + 0.6 * ratio) * (1 + (over - 1) * 0.25) * steady,
    fade: (1 + (1 - ratio) * 1.5) * (1 - (over - 1) * 0.15) * steady,
  };
}
const estFeet = (d, t = state) => {
  const { ratio, cap, power, carry } = armEffects(d, t);
  return Math.round(((140 + Math.min(d.speed, cap) * 16 + d.glide * 6) * power * (0.85 + 0.15 * ratio) * carry) / 10) * 10;
};

// Comparison: up to three throws, each in its own color.
const MAX_CMP = 3;
const SLOT = ['#ff8a3d', '#38c8e8', '#b8f04a'];
let cmpUid = 0;

// Release angle. Hyzer tips the disc onto its fade side, anhyzer onto its turn side.
// state.angle walks this ladder either way: the last two rungs are the extreme throws.
const ANGLE_DEG = [0, 5, 10, 15, 20, 35, 55];
const ANGLE_MAX = ANGLE_DEG.length - 1;
const angleDeg = (t = state) => Math.sign(t.angle) * ANGLE_DEG[Math.abs(t.angle)];
function angleName(t = state) {
  const a = angleDeg(t);
  if (!a) return 'Flat';
  const hyzer = a > 0;
  const big = Math.abs(a);
  if (big === 55) return hyzer ? 'Spike hyzer' : 'Over anhyzer';
  if (big === 35) return hyzer ? 'Hard hyzer' : 'Hard anhyzer';
  return `${hyzer ? 'Hyzer' : 'Anhyzer'} ${big}°`;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const WIND_STEPS = [0, 5, 10, 15, 20, 25];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// You always throw north (up the page). head > 0 is into your face; cross > 0 pushes the disc to the right.
function windVector() {
  const mph = state.windMph;
  if (!mph) return { mph: 0, head: 0, cross: 0 };
  const a = (state.windDir * Math.PI) / 4;
  return { mph, head: mph * Math.cos(a), cross: -mph * Math.sin(a) };
}

// Headwind costs more than a tailwind gives back.
function carryFeet(d, wind, t = state) {
  const factor = wind.head >= 0 ? 1 - 0.011 * wind.head : 1 + 0.007 * -wind.head;
  const a = angleDeg(t);
  // hyzer shortens a throw (and a spike dives); a little anhyzer rides flat for more, but past that it falls out of the sky
  const tilt = a >= 0 ? 1 - 0.004 * a - 0.00004 * a * a : 1 + 0.0025 * Math.min(-a, 20) - 0.006 * Math.max(0, -a - 20);
  return clamp(Math.round((estFeet(d, t) * factor * tilt) / 10) * 10, 60, GRID_FT - 10);
}

function flightGeometry(d, cw, wind, t = state) {
  const { x0, y0, k } = FP;
  const dir = cw ? 1 : -1; // counter-clockwise spin mirrors the disc's own turn and fade (not the wind)
  const feet = carryFeet(d, wind, t);
  const len = feet * k;
  const clampX = (x) => clamp(x, FP.left + 10, FP.right - 10);
  // a headwind makes any disc act more overstable; a tailwind makes it act more understable
  const arm = armEffects(d, t);
  const a = angleDeg(t);
  // hyzer holds the line (less turn, harder fade); anhyzer lets it turn and softens the fade
  const turnMul = clamp((1 - 0.04 * wind.head) * arm.turn * clamp(1 - 0.03 * a, 0.25, 1.7), 0.15, 2.4);
  const fadeMul = clamp((1 + 0.04 * wind.head) * arm.fade * clamp(1 + 0.025 * a, 0.3, 1.6), 0.2, 2.6);
  const turnX = -d.turn * turnMul * 33 * k * dir;
  const fadeX = -Math.max(0, d.fade) * fadeMul * 28 * k * dir;
  // crosswind pushes the disc downwind for as long as it hangs in the air, so the push builds toward the end
  const driftX = wind.cross * 3.2 * (feet / 300) * k;
  // the release angle aims the disc: hyzer starts toward the fade side, anhyzer toward the turn side
  const aimX = -dir * Math.sign(a) * (Math.abs(a) * 0.9 + 0.012 * a * a); // extreme angles aim harder than they look
  return {
    p1: [x0 + driftX * 0.1 + aimX, y0 - len * 0.32],
    p2: [clampX(x0 + turnX + driftX * 0.45 + aimX * 0.8), y0 - len * 0.72],
    p3: [clampX(x0 + turnX * 0.85 + fadeX + driftX + aimX * 0.3), y0 - len],
  };
}

// Faint streaks drifting the way the wind is blowing: faster and denser as it picks up.
function windStreaks(wind) {
  if (!wind.mph) return '';
  const { left, right, y0 } = FP;
  const a = (state.windDir * Math.PI) / 4;
  const ux = -Math.sin(a);
  const uy = Math.cos(a); // where the wind is going, in screen terms
  const dur = 55 / wind.mph;
  const reach = 70 + wind.mph * 2;
  const length = 9 + wind.mph * 0.5;
  const count = 10 + Math.round(wind.mph / 2);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const f = (n) => n.toFixed(1);
  let lines = '';
  for (let i = 0; i < count; i++) {
    const x = left + 8 + rnd() * (right - left - 16);
    const y = 20 + rnd() * (y0 - 36);
    lines += `<line class="fp-streak" x1="${f(x)}" y1="${f(y)}" x2="${f(x + ux * length)}" y2="${f(y + uy * length)}" style="--tx:${f(ux * reach)}px;--ty:${f(uy * reach)}px;--dur:${dur.toFixed(2)}s;--delay:-${(rnd() * dur).toFixed(2)}s"/>`;
  }
  return `<clipPath id="fp-clip"><rect x="${left}" y="${f(y0 - GRID_FT * FP.k)}" width="${right - left}" height="${f(GRID_FT * FP.k)}"/></clipPath><g class="fp-wind" clip-path="url(#fp-clip)" aria-hidden="true">${lines}</g>`;
}

function windNote(wind) {
  if (!wind.mph) return '';
  const bits = [];
  if (wind.head > 3) bits.push('shorter, more fade');
  else if (wind.head < -3) bits.push('longer, turns over more');
  if (wind.cross > 3) bits.push('drifts right');
  else if (wind.cross < -3) bits.push('drifts left');
  return ` · ${wind.mph} mph wind from the ${COMPASS[state.windDir]}${bits.length ? `: ${bits.join(', ')}` : ''}`;
}

// A compass and speed stepper, in their own row under the chart.
function windControls() {
  const mph = state.windMph;
  const dots = COMPASS.map((name, i) =>
    `<button class="fg-compass__dot" type="button" data-wind-dir="${i}" style="--a:${i * 45}deg" aria-label="Wind from the ${name}" aria-pressed="${mph > 0 && state.windDir === i}"></button>`
  ).join('');
  return `<div class="fg-wind" role="group" aria-label="Wind">
      <span class="fg-wind__l">Wind</span>
      <div class="fg-compass" data-calm="${mph === 0}" title="You are throwing north. Tap where the wind comes from.">
        ${dots}<span class="fg-compass__n" aria-hidden="true">N</span>
      </div>
      <div class="fg-mph" role="group" aria-label="Wind speed">
        <button type="button" data-wind-step="-1" aria-label="Less wind"${mph === 0 ? ' disabled' : ''}>−</button>
        <output>${mph ? `${mph} mph` : 'Calm'}</output>
        <button type="button" data-wind-step="1" aria-label="More wind"${mph === WIND_STEPS[WIND_STEPS.length - 1] ? ' disabled' : ''}>+</button>
      </div>
    </div>`;
}

// Arm speed (mph) and spin (rpm): a slider with steppers. t is the page's own throw or a comparison entry.
function rangeRow(kind, t = state) {
  const arm = kind === 'mph';
  const cfg = arm ? MPH : SPIN;
  const value = arm ? t.mph : spinOf(t);
  const text = arm
    ? `${t.mph} mph<small>${tierName(t.mph)}</small>`
    : (t.spin == null ? `Auto<small>${typicalSpin(t.mph)} rpm</small>` : `${t.spin} rpm`);
  const label = arm ? 'Arm speed' : 'Spin';
  const auto = !arm && t.spin != null ? '<button class="fg-rng__auto" type="button" data-spin-auto title="Use the typical spin for this arm speed">Auto</button>' : '';
  return `<div class="fg-rng" role="group" aria-label="${label}">
      <div class="fg-rng__top"><span class="fg-wind__l">${label}</span>${auto}<output aria-live="polite">${text}</output></div>
      <div class="fg-rng__bar fg-mph">
        <button type="button" data-rng-step="${kind}" data-dir="-1" aria-label="${arm ? 'Slower arm' : 'Less spin'}"${value <= cfg.min ? ' disabled' : ''}>−</button>
        <input type="range" data-rng="${kind}" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${value}" aria-label="${label}" aria-valuetext="${value} ${arm ? 'mph' : 'rpm'}">
        <button type="button" data-rng-step="${kind}" data-dir="1" aria-label="${arm ? 'Faster arm' : 'More spin'}"${value >= cfg.max ? ' disabled' : ''}>+</button>
      </div>
    </div>`;
}
const armControls = (t = state) => rangeRow('mph', t) + rangeRow('spin', t);

// A disc seen from behind: hyzer drops the fade-side edge, anhyzer the turn-side edge.
function angleControls() {
  const a = angleDeg();
  const dir = spinsClockwise() ? 1 : -1;
  const name = angleName();
  const tilt = (-dir * Math.sign(a) * Math.min(Math.abs(a) * 1.5, 80)).toFixed(1); // drawn at 1.5x so a few degrees still reads
  return `<div class="fg-arm fg-angle" role="group" aria-label="Release angle">
      <span class="fg-wind__l">Angle</span>
      <div class="fg-mph fg-mph--angle">
        <button type="button" data-angle-step="-1" aria-label="More anhyzer"${state.angle === -ANGLE_MAX ? ' disabled' : ''}>‹</button>
        <output aria-live="polite">
          <svg viewBox="-20 -9 40 18" aria-hidden="true"><g transform="rotate(${tilt})"><ellipse class="fg-angle__disc" rx="16" ry="3.6"/><ellipse class="fg-angle__top" rx="11" ry="1.6" cy="-1.1"/></g></svg>
          <span>${name}</span>
        </output>
        <button type="button" data-angle-step="1" aria-label="More hyzer"${state.angle === ANGLE_MAX ? ' disabled' : ''}>›</button>
      </div>
    </div>`;
}

function angleNote(d, t = state) {
  const a = angleDeg(t);
  if (!a) return '';
  if (a >= 55) return ' · spike hyzer: dive bomb, comes up short';
  if (a >= 35) return ' · hard hyzer: dives early, finishes short';
  if (a > 0) return ' · hyzer: holds the line, finishes harder';
  if (a <= -55) return ' · over anhyzer: rolls over and crashes';
  if (a <= -35) return ' · hard anhyzer: big turn, big hook back';
  if (d.turn <= -2) return ' · anhyzer: flips over';
  if (d.fade >= 3) return ' · anhyzer: flexes out, then hooks back';
  return ' · anhyzer: turns more, softer finish';
}

function spinNote(t = state) {
  if (t.spin == null) return '';
  const q = t.spin / (RPM_PER_MPH * t.mph);
  if (q < 0.8) return ' · low spin: wobbles, turns and fades more, comes up short';
  if (q > 1.25) return ' · lots of spin: holds its line, carries a touch farther';
  return '';
}

function armNote(d, t = state) {
  const { ratio } = armEffects(d, t);
  const over = armAt(t.mph).cap / d.speed;
  if (ratio < 0.8) return ' · too fast for this arm: comes up short and fades early';
  if (over >= 1.7) return ' · plenty of arm: turns over more';
  return '';
}

// Everything on the field but the throws themselves: grid, wind, the tee box, and which way the wind blows.
function fieldMarkup(wind) {
  const { x0, y0, k, left, right } = FP;
  const f = (n) => n.toFixed(1);
  const top = y0 - GRID_FT * k;

  let grid = '';
  for (let ft = 50; ft <= GRID_FT; ft += 50) {
    const y = y0 - ft * k;
    const major = ft % 100 === 0;
    grid += `<line class="fp-grid${major ? '' : ' fp-grid--minor'}" x1="${left}" y1="${f(y)}" x2="${right}" y2="${f(y)}"/>`;
    if (major) grid += `<text class="fp-axis" x="${left - 6}" y="${f(y + 3)}" text-anchor="end">${ft} ft</text>`;
  }
  for (const ft of [100, 200]) {
    for (const side of [-1, 1]) {
      const x = x0 + side * ft * k;
      grid += `<line class="fp-grid fp-grid--minor" x1="${f(x)}" y1="${f(top)}" x2="${f(x)}" y2="${y0}"/>`;
    }
  }

  // which way the wind is blowing, bottom right of the field beside the tee
  const wx = x0 + 96;
  const wy = y0 + 10;
  const windArrow = `<g class="fp-windarrow${wind.mph ? '' : ' is-calm'}" aria-hidden="true">
      <path transform="translate(${wx} ${wy}) rotate(${state.windDir * 45 + 180}) scale(1.35)" d="M0 -8 L4.5 5 L0 2.5 L-4.5 5 Z"/>
      ${wind.mph ? `<text x="${wx + 15}" y="${wy + 3.5}">${wind.mph} mph</text>` : ''}
    </g>`;

  return `${grid}
    ${windStreaks(wind)}
    <line class="fp-center" x1="${x0}" y1="${y0}" x2="${x0}" y2="${f(top)}"/>
    <rect x="${x0 - 26}" y="${y0 + 4}" width="52" height="12" rx="3" fill="#26472a"/>
    ${windArrow}`;
}

// One throw: its path, the disc at the end of it, and its distance. t is a throw: the page's own settings,
// or a comparison entry. playFlight animates whatever it finds, matched up by data-run.
function flightRun(d, t, wind, pathColor, discColor, { run = 0, badge = '', stroke = 5.5, r = 15, labelDy = 0, quiet = false, photo = '', ring = '', corner = false } = {}) {
  const { x0, y0 } = FP;
  const f = (n) => n.toFixed(1);
  const cw = spinsClockwise(t);
  const { p1, p2, p3 } = flightGeometry(d, cw, wind, t);
  const feet = carryFeet(d, wind, t);
  const side = p3[0] >= x0 ? -1 : 1; // keep the distance label on the roomy side of the disc
  // the disc itself: its color, or its owner's photo cropped round; a comparison rings it in its slot color
  const edge = ring ? `stroke="${ring}" stroke-width="3"` : 'stroke="rgba(255,255,255,.4)" stroke-width="1.8"';
  const face = photo
    ? `<clipPath id="fp-ph-${run}"><circle r="${r}"/></clipPath>
        <circle r="${r}" fill="${discColor}"/>
        <image href="${esc(photo)}" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#fp-ph-${run})"/>
        <circle r="${r}" fill="none" ${ring ? edge : 'stroke="rgba(255,255,255,.6)" stroke-width="1.8"'}/>
        <circle cy="${f(-r * 0.77)}" r="2.3" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.75)" stroke-width="1"/>`
    : `<circle r="${r}" fill="${discColor}" ${edge}/>
        <circle r="${f(r * 0.53)}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.8"/>
        <circle cy="${f(-r * 0.77)}" r="2.3" fill="rgba(0,0,0,.5)"/>`;
  // a comparison number sits on the disc, or on its corner when the disc shows its owner's look
  const tag = !badge ? '' : corner
    ? `<g transform="translate(${f(r * 0.78)} ${f(-r * 0.78)})"><circle r="6.5" fill="${ring}"/><text class="fg-fp-badge" y="3.4" text-anchor="middle" fill="${bestInk(ring)}" style="font-size:9px">${badge}</text></g>`
    : `<text class="fg-fp-badge" y="4.5" text-anchor="middle" fill="${bestInk(discColor)}">${badge}</text>`;
  const body = `<path class="fg-fp" data-run="${run}" data-ms="${1500 + feet * 2}" data-spin="${cw ? 1 : -1}" d="M${x0} ${y0} C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}" fill="none" stroke="${pathColor}" stroke-width="${stroke}" stroke-linecap="round"/>
    <g class="fg-fp-disc" data-run="${run}" transform="translate(${f(p3[0])} ${f(p3[1])})">
      <g class="fg-fp-spin">
        ${face}
      </g>
      ${tag}
    </g>`;
  // returned apart so a comparison can draw every label on top of every path
  const label = `<text class="fg-fp__dist${quiet ? ' fg-fp__dist--quiet' : ''}" data-run="${run}" x="${f(p3[0] + side * (r + 10))}" y="${f(p3[1] + 4 + labelDy)}" text-anchor="${side < 0 ? 'end' : 'start'}">≈${feet} ft</text>`;
  return { body, label };
}

function flightPath(d, wind) {
  const feet = carryFeet(d, wind);
  const look = bagItem(d.id); // the owner's color or photo, if they gave this disc one
  const color = look?.color || paint(d).c;
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight path, about ${feet} feet">
    ${fieldMarkup(wind)}
    ${(({ body, label }) => body + label)(flightRun(d, state, wind, '#d35400', color, { photo: look?.photo ? photoUrl(look.photo) : '' }))}
  </svg>`;
}

// Every throw in the comparison on one field, each in its own color and numbered to match its card.
function comparePath(wind) {
  const rows = state.cmp.map((e, i) => {
    const d = discs.find((x) => x.id === e.id);
    return { e, d, i, endY: flightGeometry(d, spinsClockwise(e), wind, e).p3[1] };
  });
  // nudge distance labels apart when two throws finish side by side
  let last = -Infinity;
  [...rows].sort((a, b) => a.endY - b.endY).forEach((r) => {
    r.dy = Math.max(0, 14 - (r.endY - last));
    last = r.endY + r.dy;
  });
  const runs = [...rows].reverse().map((r) => {
    const look = bagItem(r.d.id); // a disc its owner has dressed keeps its look; the ring and number say which throw it is
    return flightRun(r.d, r.e, wind, SLOT[r.i], look?.color || SLOT[r.i], {
      run: r.i, badge: r.i + 1, stroke: 4.5, r: 13, labelDy: r.dy,
      photo: look?.photo ? photoUrl(look.photo) : '', ring: look ? SLOT[r.i] : '', corner: !!look,
    });
  });
  const summary = rows.map((r) => `${r.i + 1}: ${r.d.name} about ${carryFeet(r.d, wind, r.e)} feet`).join('; ');
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight paths compared. ${esc(summary)}">
    ${fieldMarkup(wind)}
    ${runs.map((x) => x.body).join('')}
    ${runs.map((x) => x.label).join('')}
  </svg>`;
}

// Throws the discs down the line. Plays on open, on every change of hand or throw, and on Replay.
let flightFrame = 0;
function playFlight(root = '#fg-path-wrap', { instant = false } = {}) {
  cancelAnimationFrame(flightFrame);
  const svg = document.querySelector(`${root} .fg-fp-svg`);
  if (!svg) return;
  const runs = [...svg.querySelectorAll('.fg-fp')].map((path) => {
    const q = (sel) => svg.querySelector(`${sel}[data-run="${path.dataset.run}"]`);
    const disc = q('.fg-fp-disc');
    return { path, disc, spinEl: disc.querySelector('.fg-fp-spin'), tag: q('.fg-fp__dist'), length: path.getTotalLength(), ms: Number(path.dataset.ms), spin: Number(path.dataset.spin) };
  });

  const draw = (r, t) => {
    const pt = r.path.getPointAtLength(r.length * t);
    r.path.style.strokeDasharray = `${r.length}`;
    r.path.style.strokeDashoffset = `${r.length * (1 - t)}`;
    r.disc.setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    r.spinEl.setAttribute('transform', `rotate(${(r.spin * t * 1080).toFixed(1)})`);
    if (r.tag) r.tag.style.opacity = String(Math.max(0, Math.min(1, (t - 0.85) / 0.15)));
  };

  // nobody to watch (background tab), or someone who asked for less motion: just show where they land
  if (instant || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { runs.forEach((r) => draw(r, 1)); return; }

  const start = performance.now();
  const tick = (now) => {
    let flying = false;
    for (const r of runs) { // longer throws hang in the air longer
      const raw = Math.min(1, (now - start) / r.ms);
      draw(r, 1 - (1 - raw) ** 3); // leaves the hand fast, then hangs and settles
      if (raw < 1) flying = true;
    }
    if (flying) flightFrame = requestAnimationFrame(tick);
  };
  runs.forEach((r) => draw(r, 0));
  flightFrame = requestAnimationFrame(tick);
}

// "Name (Variant)" breaks cleanly into the name and a line of its own for the variant.
function splitName(name) {
  const m = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  return m && m[1] ? { main: m[1], variant: m[2] } : { main: name, variant: '' };
}

// Shrink text until it fits its box; if even the smallest size can't hold one long word, let it break rather than spill.
function fitText(el, minPx, { height = false } = {}) {
  el.style.fontSize = '';
  el.classList.remove('is-tight');
  let size = parseFloat(getComputedStyle(el).fontSize);
  // width is what breaks a layout: a line that wraps is fine. (Height only matters for the clipped disc face,
  // because a tight line-height makes a heading's own glyphs read as overflow.)
  const over = () => el.scrollWidth > el.clientWidth + 1 || (height && el.scrollHeight > el.clientHeight + 1);
  while (over() && size > minPx) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
  if (over()) el.classList.add('is-tight');
}

function fitDrawerText() {
  const name = document.querySelector('.fg-d-name');
  const face = document.querySelector('.fg-d-top .disc__n');
  if (name) fitText(name, 20);
  if (face) fitText(face, 8, { height: true });
}

// hand, throw, wind, arm and angle: the settings every flight view shares
function throwControls() {
  const chip = (key, val, label, title = label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${state[key] === val}" title="${title}">${label}</button>`;
  return `<div class="fg-throw" role="group" aria-label="How you throw">
        <div class="fg-seg">${chip('hand', 'right', 'Right', 'Right hand')}${chip('hand', 'left', 'Left', 'Left hand')}</div>
        <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
        <button class="chip fg-replay" type="button" data-replay aria-label="Replay the throw" title="Replay">↻</button>
      </div>
      ${windControls()}
      ${armControls()}
      ${angleControls()}`;
}

const spinLine = () => (spinsClockwise() ? 'Spins clockwise · fade finishes left' : 'Spins counter-clockwise · fade finishes right');

function pathSection(d) {
  const wind = windVector();
  return `
    <div class="fg-path">
      ${flightPath(d, wind)}
      ${throwControls()}
      <p>${spinLine()}${windNote(wind)}${armNote(d)}${spinNote()}${angleNote(d)}</p>
    </div>`;
}

// The modal's three areas: A (who or what), the chart, and B (everything else). Side by side on a wide
// screen, stacked A / chart / B on a phone.
const panelLayout = (a, chart, b) =>
  `<div class="fg-d-cols"><div class="fg-d-a">${a}</div><div class="fg-d-chart">${chart}</div><div class="fg-d-b">${b}</div></div>`;

function gauge(label, shown, pct, ring) {
  return `<div class="fg-gauge" style="--p:${pct <= 0 ? 0 : Math.max(5, Math.min(100, pct)).toFixed(0)};--ring:${ring}"><div class="fg-gauge__ring"><b>${shown}</b></div><span>${label}</span></div>`;
}

function openDrawer(id, trigger, { fromBag = false } = {}) {
  const d = discs.find((x) => x.id === id);
  if (!d) return;
  const b = brands[d.b];
  const band = BANDS[d.band];

  state.selected = id;
  state.panel = 'disc';
  state.fromBag = fromBag;
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  const chip = document.querySelector(`#fg-chart .disc[data-id="${id}"]`);
  if (chip) chip.setAttribute('aria-pressed', 'true');

  const specs = [
    ['Diameter', d.dia, 'cm'], ['Height', d.h, 'cm'], ['Rim depth', d.rd, 'cm'],
    ['Rim width', d.rt, 'cm'], ['Max weight', d.mw, 'g'], ['Approved', d.appr, ''],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  const href = d.link ? (d.link.startsWith('http') ? d.link : DATA.source + d.link) : '';

  const { main, variant } = splitName(d.name);
  $('#fg-d-body').innerHTML = panelLayout(`
    ${fromBag ? '<button class="fg-back" type="button" data-back-bag>← Your bag</button>' : ''}
    <div class="fg-d-top">
      ${discHTML(d, main).replace('class="disc"', 'class="disc" tabindex="-1"')}
      <div class="fg-d-id">
        <p class="fg-d-brand">${esc(b.n)}</p>
        <h2 class="fg-d-name" id="fg-d-name">${esc(main)}</h2>
        ${variant ? `<p class="fg-d-variant">${esc(variant)}</p>` : ''}
        <div class="fg-d-tags">
          <span class="fg-tag">${esc(DATA.cats[d.cat])}</span>
          <span class="fg-tag fg-tag--band" style="--tint:${band.tint}">${band.label} · ${LETTERS[d.col]}</span>
        </div>
      </div>
    </div>
    <div class="fg-gauges">
      ${gauge('Speed', d.speed, (d.speed / 15) * 100, 'var(--rust)')}
      ${gauge('Glide', d.glide, (d.glide / 7) * 100, 'var(--grey)')}
      ${gauge('Turn', fmtTurn(d.turn), (Math.min(5, Math.abs(d.turn)) / 5) * 100, 'var(--lime)')}
      ${gauge('Fade', d.fade, (Math.max(0, d.fade) / 6) * 100, 'var(--rust-lift)')}
    </div>`,
  `<div id="fg-path-wrap">${pathSection(d)}</div>`,
  `<div class="fg-d-save">
      <div class="fg-d-cmp" id="fg-bag-row" aria-live="polite">${bagRow(d)}</div>
      <div class="fg-own" id="fg-own">${ownSection(d)}</div>
      <div class="fg-d-cmp" id="fg-cmp-btn" aria-live="polite">${cmpButtons()}</div>
    </div>
    <ul class="fg-specs">${specs.map(([k, v, u]) => `<li><span>${k}</span><b>${esc(v)}${u ? ` ${u}` : ''}</b></li>`).join('')}</ul>
    <div class="fg-d-actions">
      ${href
        ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">See it at Marshall Street →</a>`
        : '<p class="fg-d-nolink">No store link for this one</p>'}
      <button class="btn btn--ghost" type="button" data-only-brand="${d.b}">All ${esc(b.n)} discs</button>
    </div>`);

  lastFocus = trigger || chip || null;
  $('#fg-drawer').classList.add('is-open');
  $('#fg-scrim').classList.add('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'false');
  $('#fg-drawer').focus({ preventScroll: true });
  fitDrawerText();
  document.fonts?.ready.then(() => { if (state.selected === id) fitDrawerText(); }); // measured again once the display font is in
  playFlight();
}

function closeDrawer() {
  cancelAnimationFrame(flightFrame);
  $('#fg-drawer').classList.remove('is-open');
  $('#fg-scrim').classList.remove('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  state.selected = null;
  state.fromBag = false;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

/* ---------- bags ---------- */

// the save-to-bag row in a disc's panel
function bagRow(d) {
  if (!account.ready) return '';
  if (!account.user) return '<button class="chip fg-cmpbtn" type="button" data-bag-signin>Sign in to save to a bag</button>';
  const bag = activeBag();
  const options = bagOptions();
  const has = inBag(d.id, bag);
  return `<label class="fg-bagpick"><span class="fg-wind__l">Bag</span><select data-bag-pick aria-label="Which bag">${options}</select></label>
      <button class="chip fg-cmpbtn${has ? ' fg-cmpbtn--go' : ''}" type="button" data-bag-toggle aria-pressed="${has}">${has ? '✓ In this bag · Remove' : '+ Add to bag'}</button>
      <span class="fg-d-cmp__full" id="fg-bag-msg" role="status"></span>`;
}

// What each brand sells, for the plastic picker. A brand missing here gets the general list; the field
// still takes anything typed.
const GENERIC_PLASTICS = ['Champion', 'Star', 'Pro', 'DX', 'Z', 'ESP', 'Neutron', 'Plasma', 'Proton', 'Fuzion', 'Lucid', 'Prime', 'Classic', 'Opto', 'Gold Line', 'VIP', 'K1', 'C-Line', 'S-Line', 'Frost', 'Glow', 'Burst', 'Swirl', 'Blend', 'Base'];
const PLASTICS = {
  Innova: ['DX', 'Pro', 'R-Pro', 'KC Pro', 'XT', 'Nexus', 'Champion', 'Star', 'GStar', 'Halo Star', 'Echo Star', 'Shimmer Star', 'Metal Flake Champion', 'Luster Champion', 'Blizzard Champion', 'Charge Champion', 'Glow Champion', 'Proto Glow Champion', 'Color Glow Champion', 'I-Dye'],
  Discraft: ['Pro-D', 'X', 'Elite X', 'Elite Z', 'Z', 'Z Lite', 'Z FLX', 'ESP', 'ESP FLX', 'ESP Glo', 'Swirl ESP', 'Sparkle Z', 'UV Z', 'Z Metallic', 'CryZtal', 'CryZtal FLX', 'Big Z', 'Titanium', 'Jawbreaker', 'Rubber Blend', 'Recycled ESP'],
  'Dynamic Discs': ['Classic', 'Classic Blend', 'Classic Soft', 'Classic Burst', 'Prime', 'Prime Burst', 'Fuzion', 'Fuzion Burst', 'BioFuzion', 'Lucid', 'Lucid Air', 'Lucid Ice', 'Lucid-X Chameleon', 'Moonshine', 'Fluid'],
  'Latitude 64': ['Zero Soft', 'Zero Medium', 'Zero Hard', 'Retro', 'Retro Burst', 'Frost', 'Opto', 'Opto Air', 'Opto Ice', 'Opto-X', 'Gold Line', 'Gold Orbit', 'Moonshine'],
  'Westside Discs': ['BT Soft', 'BT Medium', 'BT Hard', 'Origio', 'Origio Burst', 'Tournament', 'Tournament Burst', 'VIP', 'VIP Air', 'VIP Ice', 'VIP-X'],
  Kastaplast: ['K1', 'K1 Soft', 'K1 Glow', 'K2', 'K3', 'K3 Hard'],
  Discmania: ['Neo', 'Lux', 'Lumen', 'Horizon', 'Active', 'Active Premium', 'Exo Soft', 'Exo Hard', 'G-Line', 'C-Line', 'D-Line', 'S-Line', 'P-Line', 'Metal Flake'],
  Prodigy: ['200', '300', '300 Soft', '350G', '400', '400G', '400 Spectrum', '500', '500 Spectrum', '750', '750G', '750 Spectrum', 'Air Spectrum'],
  MVP: ['Electron Soft', 'Electron Medium', 'Electron Firm', 'Neutron', 'Cosmic Neutron', 'Prism Neutron', 'Plasma', 'Proton', 'Fission', 'Eclipse', 'Total Eclipse', 'Gyro'],
  Streamline: ['Electron', 'Neutron', 'Cosmic Neutron', 'Plasma', 'Proton', 'Fission', 'Eclipse', 'Gyro'],
  'Axiom Discs': ['Electron', 'Neutron', 'Cosmic Neutron', 'Prism Neutron', 'Plasma', 'Proton', 'Fission', 'Eclipse', 'Total Eclipse'],
  Gateway: ['Sure Grip Firm', 'Sure Grip Medium', 'Sure Grip Super Soft', 'Sure Grip Stupid Soft', 'Sure Grip Super Stupid Soft', 'Eraser', 'Diamond', 'Hyper Diamond', 'Platinum', 'Evolution'],
  Legacy: ['Icon', 'Pinnacle', 'Pinnacle Gravity', 'Excel', 'Gravity'],
  Millennium: ['Standard', 'Quantum', 'Sirius', 'Lunar', 'Omega'],
  'Infinite Discs': ['I-Blend', 'S-Blend', 'C-Blend', 'D-Blend', 'G-Blend', 'P-Blend', 'Glow C-Blend', 'Swirly S-Blend'],
  'Lone Star Discs': ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Victor'],
  'Thought Space Athletics': ['Aura', 'Ethos', 'Nebula Aura', 'Nebula Ethos', 'Ethos Glow'],
  'Clash Discs': ['Steady', 'Hardy', 'Softy'],
  'Mint Discs': ['Freshmint', 'Eterna', 'Apex', 'Sublime'],
  Vibram: ['Soft', 'Medium', 'Firm', 'Ledge'],
  DGA: ['Proline', 'SP Line', 'Signature Line', 'Rubber Blend'],
  'Doomsday Discs': ['Ration', 'Soft Ration', 'Ration Firm', 'Survival', 'Retina', 'Retina Glow', 'Isolation', 'Glow Isolation', 'Biohazard', 'Toxic Waste', 'Radioactive Waste', 'Radioactive Bologna', 'Bologna', 'Collapse', 'Landfill', 'Clandestine', 'Shockwave', 'Fatal', 'Uranium'],
};
const SWATCHES = ['#e53935', '#fb8c00', '#fdd835', '#7cb342', '#00897b', '#1e88e5', '#5e35b1', '#d81b60', '#f5f5f5', '#212121', '#9e9e9e'];

// "Your copy": the color, plastic and photo of this disc in the active bag
function ownSection(d) {
  const bag = account.user ? activeBag() : null;
  if (!bag || !inBag(d.id, bag)) return '';
  const it = bag.items?.[d.id] || {};
  const custom = it.color && !SWATCHES.includes(it.color);
  const brand = brands[d.b].n;
  const known = PLASTICS[brand];
  const plastics = known || GENERIC_PLASTICS;
  const swatches = SWATCHES.map((c) => `<button class="fg-sw${it.color === c ? ' is-on' : ''}" type="button" data-own-color="${c}" style="--c:${c}" aria-label="Color ${c}" aria-pressed="${it.color === c}"></button>`).join('');
  return `<p class="fg-own__h">Your copy <span>· ${esc(bag.name)}</span></p>
    <div class="fg-own__colors" role="group" aria-label="Disc color">
      ${swatches}
      <label class="fg-sw fg-sw--custom${custom ? ' is-on' : ''}" title="Pick any color" style="${custom ? `--c:${it.color}` : ''}"><input type="color" data-own-color-input value="${it.color || '#fb8c00'}" aria-label="Pick any color"></label>
      ${it.color ? '<button class="fg-rng__auto" type="button" data-own-color="" title="Back to the chart color">No color</button>' : ''}
    </div>
    <div class="fg-own__pw">
      <label class="fg-own__plastic"><span class="fg-wind__l">Plastic</span><input data-own-plastic list="fg-plastics" maxlength="30" value="${esc(it.plastic || '')}" placeholder="${known ? 'Pick one or type your own' : 'Type the plastic'}" autocomplete="off" spellcheck="false"></label>
      <label class="fg-own__weight"><span class="fg-wind__l">Weight</span><input data-own-weight type="number" inputmode="decimal" min="20" max="250" step="0.5" value="${it.weight ?? ''}" placeholder="172" aria-label="Weight in grams"><span class="fg-wind__l">g</span></label>
    </div>
    <datalist id="fg-plastics">${plastics.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    ${known ? `<div class="fg-plastics" role="group" aria-label="${esc(brand)} plastics">${known.map((p) => `<button class="fg-pchip${it.plastic === p ? ' is-on' : ''}" type="button" data-own-plastic-pick="${esc(p)}" aria-pressed="${it.plastic === p}">${esc(p)}</button>`).join('')}</div>` : ''}
    <div class="fg-own__photo">
      ${it.photo ? `<img src="${photoUrl(it.photo)}" alt="Your photo of this disc" width="64" height="64">` : ''}
      <label class="chip fg-cmpbtn fg-filebtn">${it.photo ? 'Change photo' : 'Add photo'}<input class="sr-only" type="file" accept="image/*" data-own-photo></label>
      ${it.photo ? '<button class="chip fg-cmpbtn" type="button" data-own-photo-clear>Remove photo</button>' : ''}
      <span class="fg-d-cmp__full" id="fg-own-msg" role="status"></span>
    </div>`;
}

const ownSay = (text) => { const el = $('#fg-own-msg'); if (el) el.textContent = text; };

// the disc's own face in the panel header, and the bag row and "your copy" box under it
function refreshBagRow() {
  const d = discs.find((x) => x.id === state.selected);
  const row = $('#fg-bag-row');
  if (!d || !row) return;
  row.innerHTML = bagRow(d);
  const own = $('#fg-own');
  if (own) own.innerHTML = ownSection(d);
  const face = $('.fg-d-top .disc');
  if (face) {
    const fresh = document.createElement('div');
    fresh.innerHTML = discHTML(d, splitName(d.name).main).replace('class="disc"', 'class="disc" tabindex="-1"');
    face.replaceWith(fresh.firstElementChild);
    fitDrawerText();
  }
  // and the flying disc: redraw the chart so the marker wears the new color or photo, landed where it was
  const svg = $('#fg-path-wrap .fg-fp-svg');
  if (svg) {
    svg.outerHTML = flightPath(d, windVector());
    playFlight('#fg-path-wrap', { instant: true });
  }
}

// edits to the disc in the panel: they go to the active bag
async function ownEdit(fn, working) {
  const id = state.selected;
  const bag = activeBag();
  if (!id || !bag) return;
  if (working) ownSay(working);
  try {
    await fn(id, bag.id);
    ownSay('');
  } catch (err) {
    ownSay(err.message);
  }
}

function handleOwnClick(e) {
  const color = e.target.closest('[data-own-color]');
  if (color) { ownEdit((id, bag) => setItem(id, { color: color.dataset.ownColor || null }, bag)); return true; }
  const pick = e.target.closest('[data-own-plastic-pick]');
  if (pick) {
    const on = pick.getAttribute('aria-pressed') === 'true'; // tapping the lit one clears it
    ownEdit((id, bag) => setItem(id, { plastic: on ? '' : pick.dataset.ownPlasticPick }, bag));
    return true;
  }
  if (e.target.closest('[data-own-photo-clear]')) { ownEdit((id, bag) => clearPhoto(id, bag)); return true; }
  return false;
}

function handleOwnChange(e) {
  const t = e.target;
  if (t.matches('[data-own-color-input]')) { ownEdit((id, bag) => setItem(id, { color: t.value }, bag)); return true; }
  if (t.matches('[data-own-plastic]')) { ownEdit((id, bag) => setItem(id, { plastic: t.value }, bag)); return true; }
  if (t.matches('[data-own-weight]')) { ownEdit((id, bag) => setItem(id, { weight: t.value === '' ? null : Number(t.value) }, bag)); return true; }
  if (t.matches('[data-own-photo]')) {
    const file = t.files?.[0];
    t.value = '';
    if (file) ownEdit(async (id, bag) => setPhoto(id, await photoToJpeg(file), bag), 'Uploading…');
    return true;
  }
  return false;
}

const bagSay = (text) => { const el = $('#fg-bag-msg'); if (el) el.textContent = text; };

// a ring on every chart disc that is in the active bag
function markBag() {
  const bag = account.user ? activeBag() : null;
  const mine = new Set(bag ? bag.discs : []);
  document.querySelectorAll('#fg-chart .disc').forEach((el) => {
    if (mine.has(Number(el.dataset.id))) el.setAttribute('data-bag', ''); else el.removeAttribute('data-bag');
  });
}

const NEW_BAG = '__new';
const bagOptions = () => account.bags.map((b) => `<option value="${esc(b.id)}"${b.id === account.activeId ? ' selected' : ''}>${b.main ? '★ ' : ''}${esc(b.name)} (${b.discs.length})</option>`).join('') + `<option value="${NEW_BAG}">+ New bag…</option>`;

const bagKey = (bag, d) => `${bag.id}:${d.id}`;
let bagShown = null; // which bag the bag view is showing, so switching bags can replay the throw

function bagRows() {
  const bag = activeBag();
  if (!bag) return [];
  const wind = windVector();
  return bag.discs
    .map((id) => discs.find((d) => d.id === id))
    .filter(Boolean)
    .sort((a, b) => b.speed - a.speed || a.name.localeCompare(b.name))
    .map((d, i) => ({ d, i, on: !state.bagOff.has(bagKey(bag, d)), feet: carryFeet(d, wind) }));
}

// every switched-on disc in the bag on one field, in its own chip color
function bagPath(rows, wind) {
  const bag = activeBag();
  const runs = rows.filter((r) => r.on).map(({ d, i }) => {
    const it = bag?.items?.[d.id];
    const c = ownPaint(d, it).c;
    return flightRun(d, state, wind, lineColor(c), c, { run: i, stroke: 3, r: 9, quiet: true, photo: it?.photo ? photoUrl(it.photo) : '' });
  });
  const total = rows.filter((r) => r.on).length;
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight paths for ${total} discs">
    ${fieldMarkup(wind)}
    ${runs.map((x) => x.body).join('')}
    ${runs.map((x) => x.label).join('')}
  </svg>`;
}

function bagRowHTML({ d, i, on, feet }) {
  const it = activeBag()?.items?.[d.id];
  const pc = ownPaint(d, it);
  const b = brands[d.b];
  const fill = it?.photo ? `;--fill:url('${photoUrl(it.photo)}') center/cover` : '';
  return `<li class="fg-bagrow${on ? '' : ' is-off'}" data-bd="${d.id}" data-run="${i}">
      <button class="fg-switch" type="button" role="switch" aria-checked="${on}" data-bag-sw aria-label="Show ${esc(d.name)} in the flight path"></button>
      <span class="fg-bagrow__thumb" style="--c:${pc.c}${fill}" aria-hidden="true"></span>
      <div class="fg-bagrow__id"><b>${esc(splitName(d.name).main)}</b><small>${esc(b.n)}${it?.plastic ? ` · ${esc(it.plastic)}` : ''}${it?.weight ? ` · ${it.weight} g` : ''} · ${d.speed} / ${d.glide} / ${fmtTurn(d.turn)} / ${d.fade}</small></div>
      <span class="fg-bagrow__ft">${on ? `≈${feet} ft` : 'off'}</span>
      <button class="fg-bagrow__edit" type="button" data-bag-edit aria-label="Edit ${esc(d.name)}: color, plastic, photo">Edit</button>
      <button class="fg-bagrow__x" type="button" data-bag-remove aria-label="Remove ${esc(d.name)} from this bag">×</button>
    </li>`;
}

function renderBag({ animate = true, focusSel } = {}) {
  const bag = activeBag();
  if (!bag) return;
  const drawer = $('#fg-drawer');
  const scroll = drawer.scrollTop;
  const listScroll = $('.fg-bag-list')?.scrollTop || 0;
  const wind = windVector();
  const rows = bagRows();
  const flying = rows.filter((r) => r.on).length;
  const options = bagOptions();

  $('#fg-d-body').innerHTML = panelLayout(`
      <p class="fg-d-brand">Your bag</p>
      <h2 class="fg-d-name" id="fg-d-name">${esc(bag.name)}</h2>
      <div class="fg-d-tags">
        <span class="fg-tag fg-tag--band" style="--tint:var(--lime)">${bag.main ? '★ Main bag' : 'Bag'}</span>
        <span class="fg-tag">${flying} of ${rows.length} flying</span>
      </div>
      <div class="fg-bag-tools">
        <label class="fg-bagpick"><span class="fg-wind__l">Bag</span><select data-bag-pick aria-label="Which bag">${options}</select></label>
        <button class="chip" type="button" data-bag-all="on"${rows.length && flying < rows.length ? '' : ' disabled'}>All on</button>
        <button class="chip" type="button" data-bag-all="off"${flying ? '' : ' disabled'}>All off</button>
      </div>`,
  `<div id="fg-bag-wrap">
      <div class="fg-path">
        ${bagPath(rows, wind)}
        ${throwControls()}
        <p>${spinLine()}${windNote(wind)}</p>
      </div>
    </div>`,
  rows.length
    ? `<ul class="fg-bag-list" aria-label="Discs in ${esc(bag.name)}">${rows.map(bagRowHTML).join('')}</ul>
       <p class="fg-d-cmp__full" id="fg-bag-msg" role="status"></p>`
    : `<p class="fg-bag-empty"><b>This bag is empty.</b> Open any disc on the chart and tap Add to bag.</p>`);

  drawer.scrollTop = scroll;
  const list = $('.fg-bag-list');
  if (list) list.scrollTop = listScroll;
  if (focusSel) refocus($('#fg-d-body'), focusSel);
  const replay = animate || bagShown !== bag.id;
  bagShown = bag.id;
  playFlight('#fg-bag-wrap', { instant: !replay });
}

function showDrawer() {
  $('#fg-drawer').classList.add('is-open');
  $('#fg-scrim').classList.add('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'false');
  $('#fg-drawer').focus({ preventScroll: true });
  $('#fg-drawer').scrollTop = 0;
}

function openBag(trigger) {
  if (!account.user || !activeBag()) return;
  state.panel = 'bag';
  state.selected = null;
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  bagShown = null;
  renderBag();
  if (trigger) lastFocus = trigger;
  showDrawer();
}

// only the bag's own buttons live here; the throw settings are handled with the single disc's
async function handleBagClick(e) {
  const bag = activeBag();
  if (!bag) return false;
  const sw = e.target.closest('[data-bag-sw]');
  if (sw) {
    const key = `${bag.id}:${sw.closest('[data-bd]').dataset.bd}`;
    if (state.bagOff.has(key)) state.bagOff.delete(key); else state.bagOff.add(key);
    renderBag({ animate: false, focusSel: `[data-bd="${sw.closest('[data-bd]').dataset.bd}"] [data-bag-sw]` });
    return true;
  }
  const all = e.target.closest('[data-bag-all]');
  if (all) {
    for (const id of bag.discs) {
      if (all.dataset.bagAll === 'on') state.bagOff.delete(`${bag.id}:${id}`); else state.bagOff.add(`${bag.id}:${id}`);
    }
    renderBag({ animate: false, focusSel: `[data-bag-all="${all.dataset.bagAll}"]` });
    return true;
  }
  const edit = e.target.closest('[data-bag-edit]');
  if (edit) { openDrawer(Number(edit.closest('[data-bd]').dataset.bd), edit, { fromBag: true }); return true; }
  const rm = e.target.closest('[data-bag-remove]');
  if (rm) {
    const id = Number(rm.closest('[data-bd]').dataset.bd);
    rm.disabled = true;
    try {
      await bagRemove(id, bag.id); // the account change redraws the view
    } catch (err) {
      rm.disabled = false;
      bagSay(err.message);
    }
    return true;
  }
  return false;
}

// highlight one disc's path while its row is hovered or focused
function focusRun(run) {
  const svg = $('#fg-bag-wrap .fg-fp-svg');
  if (!svg) return;
  svg.classList.toggle('has-focus', run !== null);
  svg.querySelectorAll('.is-focus').forEach((el) => el.classList.remove('is-focus'));
  if (run !== null) svg.querySelectorAll(`[data-run="${run}"]`).forEach((el) => el.classList.add('is-focus'));
}

// the Bags row of the filters: all your bags together, or any one bag, so one tap narrows the chart to those discs.
// Clear (only there while a bag filter is on) takes the bag filter off.
function renderBagFilter() {
  const row = $('#fg-bags-row');
  row.hidden = !account.user;
  if (!account.user) return;
  const chip = (id, label, count) => `<button class="chip" type="button" data-bagf="${esc(id)}" aria-pressed="${state.bagFilter === id}">${label} <small style="opacity:.55">${count}</small></button>`;
  const everything = new Set(account.bags.flatMap((b) => b.discs)).size;
  $('#fg-bags').innerHTML = chip(ALL_BAGS, 'All my bags', everything)
    + account.bags.map((b) => chip(b.id, `${b.main ? '★ ' : ''}${esc(b.name)}`, b.discs.length)).join('')
    + '<button class="chip" type="button" data-bagf-manage>Manage bags</button>'
    + (state.bagFilter ? '<button class="chip" type="button" data-bagf-clear title="Show every disc again">Clear</button>' : '');
}

// the account changed (sign in/out, a bag edited): keep everything that shows a bag in step
function onAccount() {
  if (state.bagFilter && !filterBag()) setBagFilter(null); // that bag is gone, or we signed out
  renderBagFilter();
  render(); // the chart follows the bags: which discs show, and how they are dressed
  markBag();
  const open = $('#fg-drawer').classList.contains('is-open');
  if (state.panel === 'disc' && state.selected) refreshBagRow();
  if (state.panel === 'bag' && open) {
    if (!account.user || !activeBag()) { closeDrawer(); return; }
    renderBag({ animate: false });
  }
}

/* ---------- comparison ---------- */

function cmpButtons() {
  const n = state.cmp.length;
  const add = n < MAX_CMP
    ? `<button class="chip fg-cmpbtn" type="button" data-cmp-add>+ Add to compare (${n}/${MAX_CMP})</button>`
    : `<span class="fg-d-cmp__full">Compare is full (${MAX_CMP}/${MAX_CMP})</span>`;
  const open = n >= 2 ? `<button class="chip fg-cmpbtn fg-cmpbtn--go" type="button" data-cmp-open>Open compare (${n}) →</button>` : '';
  return add + open;
}

// the little numbered dots on chart discs that are in the comparison
function markCompared() {
  const first = new Map();
  state.cmp.forEach((e, i) => { if (!first.has(e.id)) first.set(e.id, i); });
  document.querySelectorAll('#fg-chart .disc').forEach((el) => {
    const i = first.get(Number(el.dataset.id));
    if (i === undefined) el.removeAttribute('data-cmp'); else el.dataset.cmp = String(i + 1);
  });
}

function renderTray() {
  const tray = $('#fg-tray');
  const n = state.cmp.length;
  tray.hidden = n === 0;
  if (!n) { tray.innerHTML = ''; return; }
  const chips = state.cmp.map((e, i) => {
    const d = discs.find((x) => x.id === e.id);
    const name = splitName(d.name).main;
    return `<span class="fg-tray__chip" style="--c:${SLOT[i]}"><b>${i + 1}</b><span class="fg-tray__nm">${esc(name)}</span><button type="button" data-tray-remove="${e.uid}" aria-label="Remove ${esc(name)} from compare">×</button></span>`;
  }).join('');
  tray.innerHTML = `<span class="fg-tray__l">Compare</span>${chips}
    ${n >= 2 ? '<button class="chip fg-cmpbtn fg-cmpbtn--go" type="button" data-tray-open>Compare →</button>' : '<span class="fg-tray__hint">Pick one more</span>'}
    <button class="fg-tray__clear" type="button" data-tray-clear>Clear</button>`;
}

// anything that changes the list: keep the tray, the chart dots and the drawer button in step
function syncCompare() {
  renderTray();
  markCompared();
  const btn = $('#fg-cmp-btn');
  if (btn) btn.innerHTML = cmpButtons();
}

function addToCompare(id) {
  if (state.cmp.length >= MAX_CMP) return;
  state.cmp.push({ uid: ++cmpUid, id, hand: state.hand, style: state.style, mph: state.mph, spin: state.spin, angle: state.angle });
  syncCompare();
}

function compareCard(e, i) {
  const d = discs.find((x) => x.id === e.id);
  const b = brands[d.b];
  const band = BANDS[d.band];
  const wind = windVector();
  const { main } = splitName(d.name);
  const chip = (key, val, label) => `<button class="chip" type="button" data-cact="${key}" data-cval="${val}" aria-pressed="${e[key] === val}">${label}</button>`;
  const step = (kind, label, text, min, max) => `<div class="fg-cstep">
      <span class="fg-wind__l">${label}</span>
      <div class="fg-mph">
        <button type="button" data-cact="${kind}" data-cval="-1" aria-label="More anhyzer"${e[kind] <= min ? ' disabled' : ''}>‹</button>
        <output aria-live="polite">${text}</output>
        <button type="button" data-cact="${kind}" data-cval="1" aria-label="More hyzer"${e[kind] >= max ? ' disabled' : ''}>›</button>
      </div>
    </div>`;
  const notes = [armNote(d, e), spinNote(e), angleNote(d, e)].map((n) => n.replace(/^ · /, '')).filter(Boolean);
  return `<article class="fg-ccard" data-cu="${e.uid}" style="--c:${SLOT[i]}" aria-label="${i + 1}: ${esc(b.n)} ${esc(d.name)}">
    <header class="fg-ccard__head">
      <span class="fg-ccard__n" aria-hidden="true">${i + 1}</span>
      <div class="fg-ccard__id"><b>${esc(main)}</b><small>${esc(b.n)} · ${d.speed} / ${d.glide} / ${fmtTurn(d.turn)} / ${d.fade} · ${band.label}</small></div>
      <button class="fg-ccard__x" type="button" data-cact="remove" aria-label="Remove ${esc(main)} from compare">×</button>
    </header>
    <div class="fg-throw" role="group" aria-label="How you throw it">
      <div class="fg-seg">${chip('hand', 'right', 'Right')}${chip('hand', 'left', 'Left')}</div>
      <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
    </div>
    <div class="fg-ccard__ranges">${armControls(e)}</div>
    <div class="fg-ccard__steps">
      ${step('angle', 'Angle', angleName(e), -ANGLE_MAX, ANGLE_MAX)}
    </div>
    <p class="fg-ccard__note"><b>≈${carryFeet(d, wind, e)} ft</b>${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</p>
  </article>`;
}

function renderCompare(focusSel) {
  const drawer = $('#fg-drawer');
  const scroll = drawer.scrollTop;
  const wind = windVector();
  $('#fg-d-body').innerHTML = panelLayout(`
      <p class="fg-d-brand">Side by side</p>
      <h2 class="fg-d-name" id="fg-d-name">Compare</h2>`,
  `<div id="fg-cmp-wrap">
      <div class="fg-path">
        ${comparePath(wind)}
        <div class="fg-throw fg-throw--bar"><span class="fg-wind__l">Same wind for everyone</span><button class="chip fg-replay" type="button" data-replay aria-label="Replay the throws" title="Replay">↻</button></div>
        ${windControls()}
        ${windNoteLine(wind)}
      </div>
    </div>`,
  `<div class="fg-cmp-cards">${state.cmp.map(compareCard).join('')}</div>
      <div class="fg-d-cmp">
        ${state.cmp.length < MAX_CMP ? '<button class="chip fg-cmpbtn" type="button" data-cmp-more>+ Add another disc</button>' : ''}
        <button class="fg-tray__clear" type="button" data-cmp-clear>Clear all</button>
      </div>`);
  drawer.scrollTop = scroll;
  if (focusSel) refocus($('#fg-d-body'), focusSel);
}

const windNoteLine = (wind) => (wind.mph ? `<p>${windNote(wind).replace(/^ · /, '')}</p>` : '');

// put focus back on the control that was just used; if it has hit its limit and is disabled, on its partner
function refocus(root, sel) {
  const el = root.querySelector(sel);
  const target = el && !el.disabled ? el : (el?.closest('.fg-mph')?.querySelector('button:not([disabled])') || root.querySelector('.fg-ccard button, button'));
  target?.focus({ preventScroll: true });
}

function openCompare(trigger) {
  if (state.cmp.length < 2) return;
  state.panel = 'compare';
  state.selected = null;
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  renderCompare();
  if (trigger) lastFocus = trigger;
  $('#fg-drawer').classList.add('is-open');
  $('#fg-scrim').classList.add('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'false');
  $('#fg-drawer').focus({ preventScroll: true });
  $('#fg-drawer').scrollTop = 0;
  playFlight('#fg-cmp-wrap');
}

function handleCompareClick(e) {
  if (applyRange(e)) return;
  let focusSel = null;
  const act = e.target.closest('[data-cact]');
  const windBtn = e.target.closest('[data-wind-dir],[data-wind-step]');
  if (act) {
    const entry = state.cmp.find((x) => x.uid === Number(act.closest('[data-cu]').dataset.cu));
    if (!entry) return;
    const kind = act.dataset.cact;
    const val = act.dataset.cval;
    if (kind === 'remove') {
      state.cmp = state.cmp.filter((x) => x !== entry);
      syncCompare();
      if (state.cmp.length < 2) { closeDrawer(); return; } // one throw is not a comparison
    } else if (kind === 'hand' || kind === 'style') {
      entry[kind] = val;
    } else if (kind === 'angle') {
      entry.angle = clamp(entry.angle + Number(val), -ANGLE_MAX, ANGLE_MAX);
    }
    focusSel = kind === 'remove' ? '.fg-ccard__x' : `[data-cu="${entry.uid}"] [data-cact="${kind}"][data-cval="${val}"]`;
  } else if (windBtn) {
    focusSel = stepWind(windBtn);
  } else if (e.target.closest('[data-replay]')) {
    playFlight('#fg-cmp-wrap');
    return;
  } else if (e.target.closest('[data-cmp-more]')) {
    closeDrawer();
    return;
  } else if (e.target.closest('[data-cmp-clear]')) {
    state.cmp = [];
    syncCompare();
    closeDrawer();
    return;
  } else {
    return;
  }
  renderCompare(focusSel);
  playFlight('#fg-cmp-wrap');
}

// a wind control was used: update the wind, and say which control to hand focus back to
function stepWind(btn) {
  if (btn.dataset.windDir !== undefined) {
    state.windDir = Number(btn.dataset.windDir);
    if (!state.windMph) state.windMph = 10; // picking a direction in calm air would change nothing, so give it a breeze
    return `[data-wind-dir="${state.windDir}"]`;
  }
  const i = WIND_STEPS.indexOf(state.windMph);
  state.windMph = WIND_STEPS[clamp(i + Number(btn.dataset.windStep), 0, WIND_STEPS.length - 1)];
  return `[data-wind-step="${btn.dataset.windStep}"]`;
}

// Buttons that belong to a single disc's panel. Returns true if it handled the click.
function handleDiscClick(e) {
  if (handleOwnClick(e)) return true;
  if (e.target.closest('[data-back-bag]')) { openBag(); return true; }
  if (e.target.closest('[data-cmp-add]')) {
    addToCompare(state.selected);
    $('#fg-cmp-btn').querySelector('[data-cmp-add],[data-cmp-open]')?.focus({ preventScroll: true });
    return true;
  }
  if (e.target.closest('[data-cmp-open]')) { openCompare($('#fg-cmp-btn')); return true; }

  if (e.target.closest('[data-bag-signin]')) {
    const id = state.selected;
    // someone who signs in from a disc came to save it: do that for them
    openSignIn({ onDone: () => { if (state.selected === id && activeBag()) bagAdd(id).catch((err) => bagSay(err.message)); } });
    return true;
  }
  const toggle = e.target.closest('[data-bag-toggle]');
  if (toggle) {
    const id = state.selected;
    const bag = activeBag();
    if (!bag) return true;
    toggle.disabled = true;
    bagSay('');
    (inBag(id, bag) ? bagRemove(id, bag.id) : bagAdd(id, bag.id))
      .then(() => $('#fg-bag-row [data-bag-toggle]')?.focus({ preventScroll: true }))
      .catch((err) => { toggle.disabled = false; bagSay(err.message); });
    return true;
  }

  const only = e.target.closest('[data-only-brand]');
  if (only) {
    state.brands = new Set([Number(only.dataset.onlyBrand)]);
    syncBrandButtons();
    closeDrawer();
    render();
    $('.fg-controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  return false;
}

// Throw settings shared by a single disc and the whole bag: they live in `state`, so redraw whichever is showing.
function redrawPanel(focusSel) {
  if (state.panel === 'bag') { renderBag({ animate: true, focusSel }); return; }
  const d = discs.find((x) => x.id === state.selected);
  if (!d) return;
  const wrap = $('#fg-path-wrap');
  wrap.innerHTML = pathSection(d);
  if (focusSel) refocus(wrap, focusSel);
  playFlight();
}

// Arm speed and spin, for the page's own throw or one comparison entry. Slider releases and stepper taps both land here.
const RNG = { mph: MPH, spin: SPIN };
function applyRange(e) {
  const stepBtn = e.type === 'click' ? e.target.closest('[data-rng-step]') : null;
  const auto = e.type === 'click' ? e.target.closest('[data-spin-auto]') : null;
  const input = e.type === 'change' ? e.target.closest('[data-rng]') : null;
  const src = stepBtn || auto || input;
  if (!src) return false;
  const card = src.closest('[data-cu]');
  const t = card ? state.cmp.find((x) => x.uid === Number(card.dataset.cu)) : state;
  if (!t) return true;
  const kind = auto ? 'spin' : (stepBtn ? stepBtn.dataset.rngStep : input.dataset.rng);
  if (auto) {
    t.spin = null;
  } else {
    const cfg = RNG[kind];
    const now = kind === 'mph' ? t.mph : spinOf(t);
    const next = stepBtn ? now + Number(stepBtn.dataset.dir) * cfg.step : Number(input.value);
    const v = clamp(Math.round(next / cfg.step) * cfg.step, cfg.min, cfg.max);
    if (kind === 'mph') t.mph = v; else t.spin = v;
  }
  if (t === state) saveThrow();
  const sel = `${card ? `[data-cu="${card.dataset.cu}"] ` : ''}[data-rng="${kind}"]`;
  if (card) { renderCompare(sel); playFlight('#fg-cmp-wrap'); } else redrawPanel(sel);
  return true;
}

function handleThrowClick(e) {
  if (applyRange(e)) return;
  const pick = e.target.closest('[data-hand],[data-style]');
  if (pick) {
    const key = pick.dataset.hand ? 'hand' : 'style';
    state[key] = pick.dataset[key];
    saveThrow();
    redrawPanel(`[data-${key}="${state[key]}"]`);
    return;
  }
  const windBtn = e.target.closest('[data-wind-dir],[data-wind-step]');
  if (windBtn) { redrawPanel(stepWind(windBtn)); return; }
  const angleBtn = e.target.closest('[data-angle-step]');
  if (angleBtn) {
    state.angle = clamp(state.angle + Number(angleBtn.dataset.angleStep), -ANGLE_MAX, ANGLE_MAX);
    redrawPanel(`[data-angle-step="${angleBtn.dataset.angleStep}"]`);
    return;
  }
  if (e.target.closest('[data-replay]')) playFlight(state.panel === 'bag' ? '#fg-bag-wrap' : '#fg-path-wrap');
}

/* ---------- wiring ---------- */

function toggle(set, value, btn) {
  if (set.has(value)) set.delete(value); else set.add(value);
  btn.setAttribute('aria-pressed', set.has(value) ? 'true' : 'false');
}

function syncBrandButtons() {
  document.querySelectorAll('.fg-brand').forEach((el) => {
    el.setAttribute('aria-pressed', state.brands.has(Number(el.dataset.b)) ? 'true' : 'false');
  });
}

function wire() {
  // the comparison tray: floats at the bottom while there is anything to compare
  document.body.insertAdjacentHTML('beforeend', '<div class="fg-tray" id="fg-tray" role="region" aria-label="Compare discs" hidden></div>');
  $('#fg-tray').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-tray-remove]');
    if (rm) { state.cmp = state.cmp.filter((x) => x.uid !== Number(rm.dataset.trayRemove)); syncCompare(); return; }
    if (e.target.closest('[data-tray-clear]')) { state.cmp = []; syncCompare(); return; }
    const open = e.target.closest('[data-tray-open]');
    if (open) openCompare(open);
  });
  let lastVw = document.documentElement.clientWidth;
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const vw = document.documentElement.clientWidth;
      if (vw !== lastVw) { lastVw = vw; render(); }
    }, 150);
  });

  $('#fg-q').addEventListener('input', (e) => { state.q = e.target.value; render(); });

  $('#fg-cats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat]');
    if (btn) { toggle(state.cats, Number(btn.dataset.cat), btn); render(); }
  });
  $('#fg-stabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-band]');
    if (btn) { toggle(state.bands, Number(btn.dataset.band), btn); render(); }
  });

  document.querySelector('.fg-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (!btn) return;
    state.view = btn.dataset.view;
    document.querySelectorAll('.fg-seg [data-view]').forEach((el) => el.setAttribute('aria-pressed', el === btn ? 'true' : 'false'));
    render();
  });

  $('#fg-colorby').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    state.color = btn.dataset.color;
    document.querySelectorAll('#fg-colorby [data-color]').forEach((el) => el.setAttribute('aria-pressed', el === btn ? 'true' : 'false'));
    render();
    if (state.selected) {
      const d = discs.find((x) => x.id === state.selected);
      if (d) openDrawer(d.id, lastFocus);
    }
  });

  $('#fg-size').addEventListener('input', (e) => {
    const size = Number(e.target.value);
    state.sizes[state.view] = size;
    const grid = $('#fg-chart .fg-grid');
    if (grid) {
      grid.style.setProperty('--disc', `${size}px`);
      grid.classList.toggle('is-bare', size < BARE_BELOW);
    }
  });

  // brand popover
  const btn = $('#fg-brand-btn');
  const panel = $('#fg-brand-panel');
  const setPanel = (open) => { panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) $('#fg-brand-q').focus(); };
  btn.addEventListener('click', () => setPanel(panel.hidden));
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.fg-pop')) setPanel(false); });
  $('#fg-brand-q').addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.fg-brand').forEach((el) => { el.hidden = !!t && !el.dataset.name.includes(t); });
  });
  $('#fg-brand-list').addEventListener('click', (e) => {
    const el = e.target.closest('.fg-brand');
    if (el) { toggle(state.brands, Number(el.dataset.b), el); render(); }
  });
  $('#fg-brand-clear').addEventListener('click', () => { state.brands.clear(); syncBrandButtons(); render(); });

  $('#fg-reset').addEventListener('click', () => {
    state.q = ''; state.brands.clear(); state.cats.clear(); state.bands.clear(); setBagFilter(null);
    renderBagFilter();
    $('#fg-q').value = '';
    document.querySelectorAll('#fg-cats .chip, #fg-stabs .chip').forEach((el) => el.setAttribute('aria-pressed', 'false'));
    syncBrandButtons();
    render();
  });

  // chart + drawer
  $('#fg-chart').addEventListener('click', (e) => {
    const disc = e.target.closest('.disc');
    if (disc) openDrawer(Number(disc.dataset.id), disc);
  });
  $('#fg-d-close').addEventListener('click', closeDrawer);
  $('#fg-scrim').addEventListener('click', closeDrawer);
  const body = $('#fg-d-body');
  body.addEventListener('click', async (e) => {
    if (state.panel === 'compare') { handleCompareClick(e); return; }
    if (state.panel === 'bag' && await handleBagClick(e)) return;
    if (state.panel === 'disc' && handleDiscClick(e)) return;
    handleThrowClick(e);
  });
  body.addEventListener('change', (e) => {
    if (applyRange(e)) return;
    if (state.panel === 'disc' && handleOwnChange(e)) return;
    if (!e.target.matches('[data-bag-pick]')) return;
    if (e.target.value === NEW_BAG) {
      openBags({ focusNew: true });
      if (state.panel === 'bag') renderBag({ animate: false }); else refreshBagRow(); // put the picker back
      return;
    }
    setActive(e.target.value);
    $('[data-bag-pick]')?.focus({ preventScroll: true }); // the panel redraws around it
  });
  // while a slider is being dragged, keep its number honest; the chart redraws when it is let go
  body.addEventListener('input', (e) => {
    const r = e.target.closest && e.target.closest('[data-rng]');
    if (!r) return;
    const v = Number(r.value);
    r.closest('.fg-rng').querySelector('output').innerHTML = r.dataset.rng === 'mph' ? `${v} mph<small>${tierName(v)}</small>` : `${v} rpm`;
  });
  // hovering or tabbing to a row in the bag list lights up that disc's path
  const rowRun = (e) => {
    const row = state.panel === 'bag' && e.target.closest ? e.target.closest('.fg-bagrow') : null;
    return row && !row.classList.contains('is-off') ? row.dataset.run : null;
  };
  body.addEventListener('mouseover', (e) => { if (state.panel === 'bag') focusRun(rowRun(e)); });
  body.addEventListener('mouseleave', () => { if (state.panel === 'bag') focusRun(null); });
  body.addEventListener('focusin', (e) => { if (state.panel === 'bag') focusRun(rowRun(e)); });
  body.addEventListener('focusout', () => { if (state.panel === 'bag') focusRun(null); });

  $('#fg-bags').addEventListener('click', (e) => {
    if (e.target.closest('[data-bagf-manage]')) { openBags(); return; }
    let focus = '[data-bagf-clear]';
    if (e.target.closest('[data-bagf-clear]')) {
      setBagFilter(null);
      focus = '[data-bagf]';
    } else {
      const chip = e.target.closest('[data-bagf]');
      if (!chip) return;
      const id = chip.dataset.bagf;
      setBagFilter(state.bagFilter === id ? null : id); // tapping the lit chip turns the filter off too
      if (state.bagFilter && state.bagFilter !== ALL_BAGS) { setActive(state.bagFilter); return; } // the active bag follows; that change redraws everything
      focus = state.bagFilter ? `[data-bagf="${ALL_BAGS}"]` : '[data-bagf]';
    }
    renderBagFilter();
    render();
    $(`#fg-bags ${focus}`)?.focus({ preventScroll: true });
  });

  loadAccount();
  mountBar($('#fg-acct'), { onFly: () => openBag($('#fg-acct [data-acct="fly"]')) });
  onAccountChange(onAccount);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('dialog[open]')) return; // the dialog handles its own Escape
      if (!$('#fg-brand-panel').hidden) { $('#fg-brand-btn').click(); return; }
      if ($('#fg-drawer').classList.contains('is-open')) closeDrawer();
    }
  });
}

init().catch((err) => {
  $('#fg-chart').innerHTML = `<p class="fg-loading">Couldn't load the disc data. ${esc(err.message)}</p>`;
});
