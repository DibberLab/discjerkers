/* Flight guide: speed rows x stability columns, every disc a round chip. */

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
};

let DATA, discs, brands, LETTERS, weights, lastFocus;

// RHBH and LHFH spin clockwise (fade finishes left); LHBH and RHFH spin counter-clockwise (fade finishes right)
const spinsClockwise = () => (state.hand === 'right') === (state.style === 'backhand');
function loadThrow() {
  try {
    const t = JSON.parse(localStorage.getItem('dj_fg_throw'));
    if (t && ['right', 'left'].includes(t.hand) && ['backhand', 'forehand'].includes(t.style)) { state.hand = t.hand; state.style = t.style; }
  } catch { /* private mode / blocked storage: keep the defaults */ }
}
function saveThrow() {
  try { localStorage.setItem('dj_fg_throw', JSON.stringify({ hand: state.hand, style: state.style })); } catch { /* not persisted */ }
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

function matches(d, q) {
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
  $('#fg-legend').innerHTML = `<span class="fg-label">Legend</span>${h}`;
  $('#fg-brand-list').dataset.mode = state.color;
}

/* ---------- chart ---------- */

function paint(d) {
  if (state.color === 'brand') return { c: brands[d.b].c, t: brands[d.b].ink };
  return state.color === 'type' ? TYPE[d.cat] : GRADE[d.col];
}

function discHTML(d, label = d.name) { // not safe to pass straight to .map(): the index would become the label
  const b = brands[d.b];
  const pc = paint(d);
  const n = label.length;
  const fs = n <= 5 ? 1 : n <= 7 ? 0.88 : n <= 9 ? 0.68 : n <= 11 ? 0.6 : 0.52;
  const nums = `${d.speed} / ${d.glide} / ${fmtTurn(d.turn)} / ${d.fade}`;
  return `<button class="disc" type="button" data-id="${d.id}" style="--c:${pc.c};--t:${pc.t};--fs:${fs}" aria-pressed="${state.selected === d.id}" title="${esc(b.n)} ${esc(d.name)} · ${nums}" aria-label="${esc(b.n)} ${esc(d.name)}, flight numbers ${nums}"><span class="disc__n">${esc(label)}</span></button>`;
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
  const list = discs.filter((d) => matches(d, q));
  const grades = state.view === 'grades';

  $('#fg-count').innerHTML = `Showing <b>${nf.format(list.length)}</b> of ${nf.format(discs.length)} discs`;
  $('#fg-brand-count').textContent = state.brands.size ? `· ${state.brands.size} picked` : `· all ${brands.length}`;

  const chart = $('#fg-chart');
  const L = layout(grades);
  $('.fg-scroll').classList.toggle('is-wide', grades && !L.fit && list.length > 0);
  const slider = $('#fg-size');
  slider.max = L.fit ? Math.max(24, L.cap) : 74;
  slider.value = L.size;
  if (!list.length) {
    chart.innerHTML = '<div class="fg-empty"><b>Nothing out there</b>No discs match. Blame the filters.</div>';
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
}

/* ---------- drawer ---------- */

// Flight drawn on a measured field. Carry is a rough estimate from speed and glide (an average arm,
// 160-400 ft across the catalog), and the grid is 100 ft a square. Not physics: a way to compare discs.
const FP = { w: 360, h: 230, x0: 200, y0: 205, k: 0.42, left: 52, right: 352 };
const estFeet = (d) => Math.round((140 + d.speed * 16 + d.glide * 6) / 10) * 10;

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
function carryFeet(d, wind) {
  const factor = wind.head >= 0 ? 1 - 0.011 * wind.head : 1 + 0.007 * -wind.head;
  return Math.max(60, Math.round((estFeet(d) * factor) / 10) * 10);
}

function flightGeometry(d, cw, wind) {
  const { x0, y0, k } = FP;
  const dir = cw ? 1 : -1; // counter-clockwise spin mirrors the disc's own turn and fade (not the wind)
  const feet = carryFeet(d, wind);
  const len = feet * k;
  const clampX = (x) => clamp(x, FP.left + 10, FP.right - 10);
  // a headwind makes any disc act more overstable; a tailwind makes it act more understable
  const turnMul = clamp(1 - 0.04 * wind.head, 0.2, 2);
  const fadeMul = clamp(1 + 0.04 * wind.head, 0.2, 2.2);
  const turnX = -d.turn * turnMul * 33 * k * dir;
  const fadeX = -Math.max(0, d.fade) * fadeMul * 28 * k * dir;
  // crosswind pushes the disc downwind for as long as it hangs in the air, so the push builds toward the end
  const driftX = wind.cross * 3.2 * (feet / 300) * k;
  return {
    p1: [x0 + driftX * 0.1, y0 - len * 0.32],
    p2: [clampX(x0 + turnX + driftX * 0.45), y0 - len * 0.72],
    p3: [clampX(x0 + turnX * 0.85 + fadeX + driftX), y0 - len],
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
  return `<clipPath id="fp-clip"><rect x="${left}" y="${f(y0 - 450 * FP.k)}" width="${right - left}" height="${f(450 * FP.k)}"/></clipPath><g class="fp-wind" clip-path="url(#fp-clip)" aria-hidden="true">${lines}</g>`;
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

// A small compass and speed stepper that live inside the flight box.
function windControls() {
  const mph = state.windMph;
  const dots = COMPASS.map((name, i) =>
    `<button class="fg-compass__dot" type="button" data-wind-dir="${i}" style="--a:${i * 45}deg" aria-label="Wind from the ${name}" aria-pressed="${mph > 0 && state.windDir === i}"></button>`
  ).join('');
  return `<div class="fg-wind" role="group" aria-label="Wind">
      <div class="fg-compass" data-calm="${mph === 0}" title="You are throwing north. Tap where the wind comes from.">
        ${dots}<span class="fg-compass__n" aria-hidden="true">N</span>
        <svg class="fg-compass__arrow" viewBox="-10 -10 20 20" aria-hidden="true" style="transform:rotate(${state.windDir * 45 + 180}deg)"><path d="M0 -8 L4.5 5 L0 2.5 L-4.5 5 Z"/></svg>
      </div>
      <div class="fg-mph" role="group" aria-label="Wind speed">
        <button type="button" data-wind-step="-1" aria-label="Less wind"${mph === 0 ? ' disabled' : ''}>−</button>
        <output>${mph ? `${mph} mph` : 'Calm'}</output>
        <button type="button" data-wind-step="1" aria-label="More wind"${mph === WIND_STEPS[WIND_STEPS.length - 1] ? ' disabled' : ''}>+</button>
      </div>
    </div>`;
}

function flightPath(d, color, cw, wind) {
  const { x0, y0, k, left, right } = FP;
  const { p1, p2, p3 } = flightGeometry(d, cw, wind);
  const feet = carryFeet(d, wind);
  const f = (n) => n.toFixed(1);
  const top = y0 - 450 * k;

  let grid = '';
  for (let ft = 50; ft <= 450; ft += 50) {
    const y = y0 - ft * k;
    const major = ft % 100 === 0;
    grid += `<line class="fp-grid${major ? '' : ' fp-grid--minor'}" x1="${left}" y1="${f(y)}" x2="${right}" y2="${f(y)}"/>`;
    if (major && ft <= 400) grid += `<text class="fp-axis" x="${left - 6}" y="${f(y + 3)}" text-anchor="end">${ft} ft</text>`;
  }
  for (const ft of [100, 200, 300]) {
    for (const side of [-1, 1]) {
      const x = x0 + side * ft * k;
      grid += `<line class="fp-grid fp-grid--minor" x1="${f(x)}" y1="${f(top)}" x2="${f(x)}" y2="${y0}"/>`;
    }
  }

  const side = p3[0] >= x0 ? -1 : 1; // keep the distance label on the roomy side of the disc
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight path, about ${feet} feet">
    ${grid}
    ${windStreaks(wind)}
    <line class="fp-center" x1="${x0}" y1="${y0}" x2="${x0}" y2="${f(top)}"/>
    <rect x="${x0 - 22}" y="${y0 + 3}" width="44" height="10" rx="3" fill="#26472a"/>
    <path class="fg-fp" d="M${x0} ${y0} C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}" fill="none" stroke="#d35400" stroke-width="4.5" stroke-linecap="round"/>
    <g class="fg-fp-disc" transform="translate(${f(p3[0])} ${f(p3[1])})">
      <circle r="12" fill="${color}" stroke="rgba(255,255,255,.4)" stroke-width="1.5"/>
      <circle r="6.5" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.5"/>
      <circle cy="-9.2" r="1.8" fill="rgba(0,0,0,.5)"/>
    </g>
    <text class="fg-fp__dist" x="${f(p3[0] + side * 20)}" y="${f(p3[1] + 3.5)}" text-anchor="${side < 0 ? 'end' : 'start'}">≈${feet} ft</text>
  </svg>`;
}

// Throws the disc down the line. Plays on open, on every change of hand or throw, and on Replay.
let flightFrame = 0;
function playFlight(d) {
  cancelAnimationFrame(flightFrame);
  const svg = document.querySelector('#fg-path-wrap .fg-fp-svg');
  if (!svg) return;
  const path = svg.querySelector('.fg-fp');
  const disc = svg.querySelector('.fg-fp-disc');
  const tag = svg.querySelector('.fg-fp__dist');
  const length = path.getTotalLength();
  const spin = spinsClockwise() ? 1 : -1;

  const draw = (t) => {
    const pt = path.getPointAtLength(length * t);
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length * (1 - t)}`;
    disc.setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)}) rotate(${(spin * t * 1080).toFixed(1)})`);
    tag.style.opacity = String(Math.max(0, Math.min(1, (t - 0.85) / 0.15)));
  };

  // nobody to watch (background tab), or someone who asked for less motion: just show where it lands
  if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { draw(1); return; }

  const ms = 1500 + carryFeet(d, windVector()) * 2; // longer throws hang in the air longer
  const start = performance.now();
  const tick = (now) => {
    const raw = Math.min(1, (now - start) / ms);
    draw(1 - (1 - raw) ** 3); // leaves the hand fast, then hangs and settles
    if (raw < 1) flightFrame = requestAnimationFrame(tick);
  };
  draw(0);
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

function pathSection(d) {
  const cw = spinsClockwise();
  const wind = windVector();
  const chip = (key, val, label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${state[key] === val}">${label}</button>`;
  return `
    <div class="fg-throw" role="group" aria-label="How you throw">
      <div class="fg-seg">${chip('hand', 'right', 'Right hand')}${chip('hand', 'left', 'Left hand')}</div>
      <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
      <button class="chip fg-replay" type="button" data-replay>↻ Replay</button>
    </div>
    <div class="fg-path">
      <div class="fg-stage">${flightPath(d, paint(d).c, cw, wind)}${windControls()}</div>
      <p>${cw ? 'Spins clockwise · fade finishes left' : 'Spins counter-clockwise · fade finishes right'}${windNote(wind)}</p>
    </div>`;
}

function gauge(label, shown, pct, ring) {
  return `<div class="fg-gauge" style="--p:${pct <= 0 ? 0 : Math.max(5, Math.min(100, pct)).toFixed(0)};--ring:${ring}"><div class="fg-gauge__ring"><b>${shown}</b></div><span>${label}</span></div>`;
}

function openDrawer(id, trigger) {
  const d = discs.find((x) => x.id === id);
  if (!d) return;
  const b = brands[d.b];
  const band = BANDS[d.band];

  state.selected = id;
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  const chip = document.querySelector(`#fg-chart .disc[data-id="${id}"]`);
  if (chip) chip.setAttribute('aria-pressed', 'true');

  const specs = [
    ['Diameter', d.dia, 'cm'], ['Height', d.h, 'cm'], ['Rim depth', d.rd, 'cm'],
    ['Rim width', d.rt, 'cm'], ['Max weight', d.mw, 'g'], ['Approved', d.appr, ''],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  const href = d.link ? (d.link.startsWith('http') ? d.link : DATA.source + d.link) : '';

  const { main, variant } = splitName(d.name);
  $('#fg-d-body').innerHTML = `
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
    </div>
    <div id="fg-path-wrap">${pathSection(d)}</div>
    <ul class="fg-specs">${specs.map(([k, v, u]) => `<li><span>${k}</span><b>${esc(v)}${u ? ` ${u}` : ''}</b></li>`).join('')}</ul>
    <div class="fg-d-actions">
      ${href
        ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">See it at Marshall Street →</a>`
        : '<p class="fg-d-nolink">No store link for this one</p>'}
      <button class="btn btn--ghost" type="button" data-only-brand="${d.b}">All ${esc(b.n)} discs</button>
    </div>`;

  lastFocus = trigger || chip || null;
  $('#fg-drawer').classList.add('is-open');
  $('#fg-scrim').classList.add('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'false');
  $('#fg-drawer').focus({ preventScroll: true });
  fitDrawerText();
  document.fonts?.ready.then(() => { if (state.selected === id) fitDrawerText(); }); // measured again once the display font is in
  playFlight(d);
}

function closeDrawer() {
  cancelAnimationFrame(flightFrame);
  $('#fg-drawer').classList.remove('is-open');
  $('#fg-scrim').classList.remove('is-open');
  $('#fg-drawer').setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.disc[aria-pressed="true"]').forEach((el) => el.setAttribute('aria-pressed', 'false'));
  state.selected = null;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
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
    state.q = ''; state.brands.clear(); state.cats.clear(); state.bands.clear();
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
  $('#fg-d-body').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-hand],[data-style]');
    if (pick) {
      const key = pick.dataset.hand ? 'hand' : 'style';
      state[key] = pick.dataset[key];
      saveThrow();
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        $('#fg-path-wrap').innerHTML = pathSection(d);
        $('#fg-path-wrap').querySelector(`[data-${key}="${state[key]}"]`)?.focus({ preventScroll: true });
        playFlight(d);
      }
      return;
    }
    const windBtn = e.target.closest('[data-wind-dir],[data-wind-step]');
    if (windBtn) {
      const i = WIND_STEPS.indexOf(state.windMph);
      if (windBtn.dataset.windDir !== undefined) {
        state.windDir = Number(windBtn.dataset.windDir);
        if (!state.windMph) state.windMph = 10; // picking a direction in calm air would change nothing, so give it a breeze
      } else {
        state.windMph = WIND_STEPS[clamp(i + Number(windBtn.dataset.windStep), 0, WIND_STEPS.length - 1)];
      }
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        const wrap = $('#fg-path-wrap');
        wrap.innerHTML = pathSection(d);
        const same = windBtn.dataset.windDir !== undefined
          ? `[data-wind-dir="${state.windDir}"]`
          : `[data-wind-step="${windBtn.dataset.windStep}"]`;
        const next = wrap.querySelector(same);
        // a stepper button that just hit its limit is disabled now: hand focus to its partner, not the page
        (next && !next.disabled
          ? next
          : wrap.querySelector('[data-wind-step]:not([disabled])') || wrap.querySelector(`[data-wind-dir="${state.windDir}"]`))?.focus({ preventScroll: true });
        playFlight(d);
      }
      return;
    }
    if (e.target.closest('[data-replay]')) {
      const d = discs.find((x) => x.id === state.selected);
      if (d) playFlight(d);
      return;
    }
    const only = e.target.closest('[data-only-brand]');
    if (!only) return;
    state.brands = new Set([Number(only.dataset.onlyBrand)]);
    syncBrandButtons();
    closeDrawer();
    render();
    $('.fg-controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#fg-brand-panel').hidden) { $('#fg-brand-btn').click(); return; }
      if ($('#fg-drawer').classList.contains('is-open')) closeDrawer();
    }
  });
}

init().catch((err) => {
  $('#fg-chart').innerHTML = `<p class="fg-loading">Couldn't load the disc data. ${esc(err.message)}</p>`;
});
