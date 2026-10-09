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
};

let DATA, discs, brands, LETTERS, weights, lastFocus;

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

function discHTML(d) {
  const b = brands[d.b];
  const pc = paint(d);
  const n = d.name.length;
  const fs = n <= 5 ? 1 : n <= 7 ? 0.88 : n <= 9 ? 0.68 : n <= 11 ? 0.6 : 0.52;
  const nums = `${d.speed} / ${d.glide} / ${fmtTurn(d.turn)} / ${d.fade}`;
  return `<button class="disc" type="button" data-id="${d.id}" style="--c:${pc.c};--t:${pc.t};--fs:${fs}" aria-pressed="${state.selected === d.id}" title="${esc(b.n)} ${esc(d.name)} · ${nums}" aria-label="${esc(b.n)} ${esc(d.name)}, flight numbers ${nums}"><span class="disc__n">${esc(d.name)}</span></button>`;
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
      h += `<div class="fg-cell" data-alt="${g.band % 2}">${items.map(discHTML).join('')}</div>`;
    });
  }

  const floor = !grades ? '116px' : L.fit ? `calc(var(--disc) + ${FIT_PAD}px)` : 'calc(var(--disc) + 22px)';
  const cols = `${ROWHEAD}px ${w.map((x) => `minmax(${floor},${x.toFixed(2)}fr)`).join(' ')}`;
  const scrollMin = grades && !L.fit ? `;min-width:calc(${ROWHEAD}px + ${w.length} * (var(--disc) + 22px))` : '';
  chart.innerHTML = `<div class="fg-grid${L.size < BARE_BELOW ? ' is-bare' : ''}${L.fit ? ' is-fit' : ''}" style="--disc:${L.size}px;grid-template-columns:${cols}${scrollMin}">${h}</div>`;
}

/* ---------- drawer ---------- */

function flightPath(d, color) {
  const x0 = 110, y0 = 188;
  const len = Math.min(164, 64 + d.speed * 6 + d.glide * 3);
  const turnX = -d.turn * 13;
  const fadeX = -Math.max(0, d.fade) * 11;
  const clampX = (x) => Math.max(20, Math.min(200, x));
  const y1 = y0 - len;
  const p1 = [x0, y0 - len * 0.32];
  const p2 = [clampX(x0 + turnX), y0 - len * 0.72];
  const p3 = [clampX(x0 + turnX * 0.85 + fadeX), y1];
  return `<svg viewBox="0 0 220 204" role="img" aria-label="Stylized flight path">
    <line x1="${x0}" y1="${y0}" x2="${x0}" y2="14" stroke="rgba(238,241,232,.12)" stroke-dasharray="3 7"/>
    <rect x="${x0 - 20}" y="${y0 + 2}" width="40" height="10" rx="3" fill="#26472a"/>
    <path d="M${x0} ${y0} C${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]}" fill="none" stroke="#d35400" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${p3[0]}" cy="${p3[1]}" r="13" fill="${color}" stroke="rgba(255,255,255,.35)" stroke-width="1.5"/>
    <circle cx="${p3[0]}" cy="${p3[1]}" r="6.5" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.6"/>
  </svg>`;
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

  $('#fg-d-body').innerHTML = `
    <div class="fg-d-top">
      ${discHTML(d).replace('class="disc"', 'class="disc" tabindex="-1"')}
      <div>
        <p class="fg-d-brand">${esc(b.n)}</p>
        <h2 class="fg-d-name" id="fg-d-name">${esc(d.name)}</h2>
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
    <div class="fg-path">${flightPath(d, paint(d).c)}<p>Stylized flight · right-hand backhand · not to scale</p></div>
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
}

function closeDrawer() {
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
