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
  arm: 2, // index into ARM
  panel: 'disc', // what the side panel is showing: one disc, or the comparison
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
    if (t && Number.isInteger(t.arm) && t.arm >= 0 && t.arm < ARM.length) state.arm = t.arm;
  } catch { /* private mode / blocked storage: keep the defaults */ }
}
function saveThrow() {
  try { localStorage.setItem('dj_fg_throw', JSON.stringify({ hand: state.hand, style: state.style, arm: state.arm })); } catch { /* not persisted */ }
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
  markCompared();
}

/* ---------- drawer ---------- */

// Flight drawn on a measured field. Carry is a rough estimate from speed and glide, scaled by the thrower's
// arm, and the grid is 100 ft a square. Not physics: a way to compare discs.
const FP = { w: 360, h: 417, x0: 200, y0: 392, k: 0.74, left: 52, right: 352 };
const GRID_FT = 500; // far enough for nearly every throw; the longest are held just inside it
// cap: the disc speed this arm can get fully up to speed. power: how much distance the arm adds on top.
const ARM = [
  { name: 'Beginner', cap: 6, power: 0.74 },
  { name: 'Beginner Plus', cap: 8, power: 0.87 },
  { name: 'Intermediate', cap: 10, power: 1 },
  { name: 'Intermediate Plus', cap: 11.5, power: 1.05 },
  { name: 'Advanced', cap: 13, power: 1.1 },
  { name: 'Pro', cap: 15, power: 1.14 },
];

// How this arm and this disc get along. A disc faster than the arm can power never gets up to speed: it carries
// less and fades early. A slow disc on a strong arm is overpowered: it turns over more.
function armEffects(d, t = state) {
  const a = ARM[t.arm];
  const ratio = Math.min(1, a.cap / d.speed);
  const over = clamp(a.cap / d.speed, 1, 2);
  return {
    ratio,
    turn: (0.4 + 0.6 * ratio) * (1 + (over - 1) * 0.25),
    fade: (1 + (1 - ratio) * 1.5) * (1 - (over - 1) * 0.15),
  };
}
const estFeet = (d, t = state) => {
  const a = ARM[t.arm];
  const { ratio } = armEffects(d, t);
  return Math.round(((140 + Math.min(d.speed, a.cap) * 16 + d.glide * 6) * a.power * (0.85 + 0.15 * ratio)) / 10) * 10;
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

// Arm speed: a stepper like the wind's, with a pip for each of the six levels.
function armControls() {
  const last = ARM.length - 1;
  const pips = ARM.map((_, i) => `<i${i <= state.arm ? ' class="is-on"' : ''}></i>`).join('');
  return `<div class="fg-arm" role="group" aria-label="Arm speed">
      <span class="fg-wind__l">Arm speed</span>
      <div class="fg-mph fg-mph--arm">
        <button type="button" data-arm-step="-1" aria-label="Slower arm"${state.arm === 0 ? ' disabled' : ''}>−</button>
        <output aria-live="polite"><span>${ARM[state.arm].name}</span><span class="fg-pips" aria-hidden="true">${pips}</span></output>
        <button type="button" data-arm-step="1" aria-label="Faster arm"${state.arm === last ? ' disabled' : ''}>+</button>
      </div>
    </div>`;
}

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

function armNote(d, t = state) {
  const { ratio } = armEffects(d, t);
  const over = ARM[t.arm].cap / d.speed;
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
function flightRun(d, t, wind, pathColor, discColor, { run = 0, badge = '', stroke = 5.5, r = 15, labelDy = 0 } = {}) {
  const { x0, y0 } = FP;
  const f = (n) => n.toFixed(1);
  const cw = spinsClockwise(t);
  const { p1, p2, p3 } = flightGeometry(d, cw, wind, t);
  const feet = carryFeet(d, wind, t);
  const side = p3[0] >= x0 ? -1 : 1; // keep the distance label on the roomy side of the disc
  const body = `<path class="fg-fp" data-run="${run}" data-ms="${1500 + feet * 2}" data-spin="${cw ? 1 : -1}" d="M${x0} ${y0} C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}" fill="none" stroke="${pathColor}" stroke-width="${stroke}" stroke-linecap="round"/>
    <g class="fg-fp-disc" data-run="${run}" transform="translate(${f(p3[0])} ${f(p3[1])})">
      <g class="fg-fp-spin">
        <circle r="${r}" fill="${discColor}" stroke="rgba(255,255,255,.4)" stroke-width="1.8"/>
        <circle r="${f(r * 0.53)}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.8"/>
        <circle cy="${f(-r * 0.77)}" r="2.3" fill="rgba(0,0,0,.5)"/>
      </g>
      ${badge ? `<text class="fg-fp-badge" y="4.5" text-anchor="middle" fill="${bestInk(discColor)}">${badge}</text>` : ''}
    </g>`;
  // returned apart so a comparison can draw every label on top of every path
  const label = `<text class="fg-fp__dist" data-run="${run}" x="${f(p3[0] + side * (r + 10))}" y="${f(p3[1] + 4 + labelDy)}" text-anchor="${side < 0 ? 'end' : 'start'}">≈${feet} ft</text>`;
  return { body, label };
}

function flightPath(d, color, wind) {
  const feet = carryFeet(d, wind);
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight path, about ${feet} feet">
    ${fieldMarkup(wind)}
    ${(({ body, label }) => body + label)(flightRun(d, state, wind, '#d35400', color))}
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
  const runs = [...rows].reverse().map((r) => flightRun(r.d, r.e, wind, SLOT[r.i], SLOT[r.i], { run: r.i, badge: r.i + 1, stroke: 4.5, r: 13, labelDy: r.dy }));
  const summary = rows.map((r) => `${r.i + 1}: ${r.d.name} about ${carryFeet(r.d, wind, r.e)} feet`).join('; ');
  return `<svg class="fg-fp-svg" viewBox="0 0 ${FP.w} ${FP.h}" role="img" aria-label="Flight paths compared. ${esc(summary)}">
    ${fieldMarkup(wind)}
    ${runs.map((x) => x.body).join('')}
    ${runs.map((x) => x.label).join('')}
  </svg>`;
}

// Throws the discs down the line. Plays on open, on every change of hand or throw, and on Replay.
let flightFrame = 0;
function playFlight(root = '#fg-path-wrap') {
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
    r.tag.style.opacity = String(Math.max(0, Math.min(1, (t - 0.85) / 0.15)));
  };

  // nobody to watch (background tab), or someone who asked for less motion: just show where they land
  if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { runs.forEach((r) => draw(r, 1)); return; }

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

function pathSection(d) {
  const cw = spinsClockwise();
  const wind = windVector();
  const chip = (key, val, label, title = label) => `<button class="chip" type="button" data-${key}="${val}" aria-pressed="${state[key] === val}" title="${title}">${label}</button>`;
  return `
    <div class="fg-path">
      ${flightPath(d, paint(d).c, wind)}
      <div class="fg-throw" role="group" aria-label="How you throw">
        <div class="fg-seg">${chip('hand', 'right', 'Right', 'Right hand')}${chip('hand', 'left', 'Left', 'Left hand')}</div>
        <div class="fg-seg">${chip('style', 'backhand', 'Backhand')}${chip('style', 'forehand', 'Forehand')}</div>
        <button class="chip fg-replay" type="button" data-replay aria-label="Replay the throw" title="Replay">↻</button>
      </div>
      ${windControls()}
      ${armControls()}
      ${angleControls()}
      <p>${cw ? 'Spins clockwise · fade finishes left' : 'Spins counter-clockwise · fade finishes right'}${windNote(wind)}${armNote(d)}${angleNote(d)}</p>
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
  state.panel = 'disc';
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
    <div class="fg-d-cmp" id="fg-cmp-btn" aria-live="polite">${cmpButtons()}</div>
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
  playFlight();
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
  state.cmp.push({ uid: ++cmpUid, id, hand: state.hand, style: state.style, arm: state.arm, angle: state.angle });
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
        <button type="button" data-cact="${kind}" data-cval="-1" aria-label="${kind === 'arm' ? 'Slower arm' : 'More anhyzer'}"${e[kind] <= min ? ' disabled' : ''}>${kind === 'arm' ? '−' : '‹'}</button>
        <output aria-live="polite">${text}</output>
        <button type="button" data-cact="${kind}" data-cval="1" aria-label="${kind === 'arm' ? 'Faster arm' : 'More hyzer'}"${e[kind] >= max ? ' disabled' : ''}>${kind === 'arm' ? '+' : '›'}</button>
      </div>
    </div>`;
  const notes = [armNote(d, e), angleNote(d, e)].map((n) => n.replace(/^ · /, '')).filter(Boolean);
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
    <div class="fg-ccard__steps">
      ${step('arm', 'Arm', ARM[e.arm].name, 0, ARM.length - 1)}
      ${step('angle', 'Angle', angleName(e), -ANGLE_MAX, ANGLE_MAX)}
    </div>
    <p class="fg-ccard__note"><b>≈${carryFeet(d, wind, e)} ft</b>${notes.length ? ` · ${esc(notes.join(' · '))}` : ''}</p>
  </article>`;
}

function renderCompare(focusSel) {
  const drawer = $('#fg-drawer');
  const scroll = drawer.scrollTop;
  const wind = windVector();
  $('#fg-d-body').innerHTML = `
    <div class="fg-cmp-head">
      <p class="fg-d-brand">Side by side</p>
      <h2 class="fg-d-name" id="fg-d-name">Compare</h2>
    </div>
    <div id="fg-cmp-wrap">
      <div class="fg-path">
        ${comparePath(wind)}
        <div class="fg-throw fg-throw--bar"><span class="fg-wind__l">Same wind for everyone</span><button class="chip fg-replay" type="button" data-replay aria-label="Replay the throws" title="Replay">↻</button></div>
        ${windControls()}
        ${windNoteLine(wind)}
      </div>
      <div class="fg-cmp-cards">${state.cmp.map(compareCard).join('')}</div>
      <div class="fg-d-cmp">
        ${state.cmp.length < MAX_CMP ? '<button class="chip fg-cmpbtn" type="button" data-cmp-more>+ Add another disc</button>' : ''}
        <button class="fg-tray__clear" type="button" data-cmp-clear>Clear all</button>
      </div>
    </div>`;
  drawer.scrollTop = scroll;
  if (focusSel) refocus($('#fg-cmp-wrap'), focusSel);
}

const windNoteLine = (wind) => (wind.mph ? `<p>${windNote(wind).replace(/^ · /, '')}</p>` : '');

// put focus back on the control that was just used; if it has hit its limit and is disabled, on its partner
function refocus(root, sel) {
  const el = root.querySelector(sel);
  const target = el && !el.disabled ? el : (el?.closest('.fg-mph')?.querySelector('button:not([disabled])') || root.querySelector('.fg-ccard button'));
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
    } else if (kind === 'arm') {
      entry.arm = clamp(entry.arm + Number(val), 0, ARM.length - 1);
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
    if (state.panel === 'compare') { handleCompareClick(e); return; }
    if (e.target.closest('[data-cmp-add]')) {
      addToCompare(state.selected);
      $('#fg-cmp-btn').querySelector('[data-cmp-add],[data-cmp-open]')?.focus({ preventScroll: true });
      return;
    }
    if (e.target.closest('[data-cmp-open]')) { openCompare($('#fg-cmp-btn')); return; }
    const pick = e.target.closest('[data-hand],[data-style]');
    if (pick) {
      const key = pick.dataset.hand ? 'hand' : 'style';
      state[key] = pick.dataset[key];
      saveThrow();
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        $('#fg-path-wrap').innerHTML = pathSection(d);
        $('#fg-path-wrap').querySelector(`[data-${key}="${state[key]}"]`)?.focus({ preventScroll: true });
        playFlight();
      }
      return;
    }
    const windBtn = e.target.closest('[data-wind-dir],[data-wind-step]');
    if (windBtn) {
      const same = stepWind(windBtn);
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        const wrap = $('#fg-path-wrap');
        wrap.innerHTML = pathSection(d);
        const next = wrap.querySelector(same);
        // a stepper button that just hit its limit is disabled now: hand focus to its partner, not the page
        (next && !next.disabled
          ? next
          : wrap.querySelector('[data-wind-step]:not([disabled])') || wrap.querySelector(`[data-wind-dir="${state.windDir}"]`))?.focus({ preventScroll: true });
        playFlight();
      }
      return;
    }
    const armBtn = e.target.closest('[data-arm-step]');
    if (armBtn) {
      state.arm = clamp(state.arm + Number(armBtn.dataset.armStep), 0, ARM.length - 1);
      saveThrow();
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        const wrap = $('#fg-path-wrap');
        wrap.innerHTML = pathSection(d);
        const same = wrap.querySelector(`[data-arm-step="${armBtn.dataset.armStep}"]`);
        // the button that just hit its limit is disabled now: hand focus to its partner, not the page
        (same && !same.disabled ? same : wrap.querySelector('[data-arm-step]:not([disabled])'))?.focus({ preventScroll: true });
        playFlight();
      }
      return;
    }
    const angleBtn = e.target.closest('[data-angle-step]');
    if (angleBtn) {
      state.angle = clamp(state.angle + Number(angleBtn.dataset.angleStep), -ANGLE_MAX, ANGLE_MAX);
      const d = discs.find((x) => x.id === state.selected);
      if (d) {
        const wrap = $('#fg-path-wrap');
        wrap.innerHTML = pathSection(d);
        const same = wrap.querySelector(`[data-angle-step="${angleBtn.dataset.angleStep}"]`);
        (same && !same.disabled ? same : wrap.querySelector('[data-angle-step]:not([disabled])'))?.focus({ preventScroll: true });
        playFlight();
      }
      return;
    }
    if (e.target.closest('[data-replay]')) {
      const d = discs.find((x) => x.id === state.selected);
      if (d) playFlight();
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
