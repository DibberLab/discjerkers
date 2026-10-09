/* Change-control log: file a request; approve, deny, or reopen one with your name on it.
   Live: the server pushes every change over server-sent events, with a slow poll as a safety net. */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ACTIONS = { approve: 'Approve', deny: 'Deny', reopen: 'Reopen' };
const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['denied', 'Denied']];
const STATUS = { pending: 'Pending', approved: 'Approved', denied: 'Denied' };
const FIELD_LABEL = { name: 'Your name', change: 'Proposed change', impact: 'Impact', rollback: 'Rollback plan' };

const state = { requests: new Map(), filter: 'all', loaded: false };
let acting = null; // { id, action } while the dialog is open

const rememberedName = () => { try { return localStorage.getItem('dj_cc_name') || ''; } catch { return ''; } };
const rememberName = (n) => { try { localStorage.setItem('dj_cc_name', n); } catch { /* private mode: fine */ } };

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/changes${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
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

function ago(iso) {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ---------- rendering ---------- */

function buildCard(r) {
  const trail = r.history.map((h) =>
    `<li data-a="${esc(h.action)}"><b>${esc(h.action)}</b> by ${esc(h.by)} <time data-at="${esc(h.at)}" datetime="${esc(h.at)}" title="${esc(new Date(h.at).toLocaleString())}">${ago(h.at)}</time>${h.note ? ` <em>&ldquo;${esc(h.note)}&rdquo;</em>` : ''}</li>`
  ).join('');
  const actions = r.status === 'pending'
    ? '<button class="chip" type="button" data-act="approve">Approve</button><button class="chip" type="button" data-act="deny">Deny</button>'
    : '<button class="chip" type="button" data-act="reopen">Reopen</button>';

  const el = document.createElement('article');
  el.className = 'cr';
  el.dataset.id = r.id;
  el.dataset.status = r.status;
  el.dataset.sig = `${r.status}|${r.updatedAt}|${r.history.length}`;
  el.innerHTML = `
    <div class="cr__top"><span class="cr__id">${esc(r.id)}</span><span class="cr__status">${STATUS[r.status]}</span></div>
    <h3 class="cr__change">${esc(r.change)}</h3>
    <dl><dt>Impact</dt><dd>${esc(r.impact)}</dd><dt>Rollback plan</dt><dd>${esc(r.rollback)}</dd></dl>
    <ol class="cr__trail">${trail}</ol>
    <div class="cr__actions">${actions}</div>`;
  return el;
}

function renderFilters() {
  const box = $('#cc-filters');
  if (!box.children.length) {
    box.innerHTML = FILTERS
      .map(([key, label]) => `<button class="chip" type="button" data-filter="${key}" aria-pressed="false">${label}<small></small></button>`)
      .join('');
  }
  const counts = { all: state.requests.size, pending: 0, approved: 0, denied: 0 };
  state.requests.forEach((r) => { counts[r.status]++; });
  box.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.querySelector('small').textContent = counts[btn.dataset.filter];
    btn.setAttribute('aria-pressed', String(state.filter === btn.dataset.filter));
  });
}

function renderList(fresh = new Set()) {
  renderFilters();
  const rows = [...state.requests.values()]
    .sort((a, b) => b.n - a.n)
    .filter((r) => state.filter === 'all' || r.status === state.filter);

  const list = $('#cc-list');
  const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
  let prev = null;
  for (const r of rows) {
    const sig = `${r.status}|${r.updatedAt}|${r.history.length}`;
    let el = existing.get(r.id);
    if (!el || el.dataset.sig !== sig) {
      const next = buildCard(r);
      if (fresh.has(r.id)) next.classList.add('is-fresh');
      if (el) el.replaceWith(next);
      el = next;
    }
    existing.delete(r.id);
    const want = prev ? prev.nextElementSibling : list.firstElementChild;
    if (want !== el) list.insertBefore(el, want);
    prev = el;
  }
  existing.forEach((el) => el.remove());

  const empty = $('#cc-empty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.textContent = state.requests.size
      ? `Nothing is ${state.filter} right now. Enjoy it.`
      : 'Nothing filed yet. Which, honestly, is the problem.';
  }
  updateNext();
}

function updateNext() {
  const top = [...state.requests.values()].reduce((m, r) => Math.max(m, r.n), 0);
  $('#cc-next').textContent = `CR-${String(top + 1).padStart(4, '0')}`;
}

/* ---------- state ---------- */

function upsert(r, { live = false } = {}) {
  const prev = state.requests.get(r.id);
  if (prev && Date.parse(prev.updatedAt) > Date.parse(r.updatedAt)) return; // an older event arriving late
  state.requests.set(r.id, r);
  const changed = !prev || prev.updatedAt !== r.updatedAt || prev.history.length !== r.history.length;
  renderList(live && changed ? new Set([r.id]) : new Set());
}

async function sync({ announce = false } = {}) {
  const { requests } = await api('/');
  const fresh = new Set();
  const next = new Map();
  for (const r of requests) {
    next.set(r.id, r);
    const prev = state.requests.get(r.id);
    if (announce && state.loaded && (!prev || prev.updatedAt !== r.updatedAt)) fresh.add(r.id);
  }
  state.requests = next;
  state.loaded = true;
  renderList(fresh);
}

/* ---------- live connection ---------- */

function setLive(mode) {
  const el = $('#cc-live');
  el.dataset.state = mode;
  el.querySelector('b').textContent = { live: 'Live', connecting: 'Reconnecting', offline: 'Offline' }[mode];
}

let stream = null;
let lastBeat = 0;
let retryTimer = null;
const SILENCE_LIMIT_MS = 45_000; // the server pings every 15s; three misses means the line is dead

function connect() {
  clearTimeout(retryTimer);
  if (stream) stream.close();
  if (!('EventSource' in window)) { setLive('offline'); return; }

  const es = new EventSource('/api/changes/stream');
  stream = es;
  lastBeat = Date.now();
  const beat = () => { lastBeat = Date.now(); };

  es.addEventListener('hello', () => { beat(); setLive('live'); sync({ announce: true }).catch(() => {}); });
  es.addEventListener('ping', beat);
  es.addEventListener('upsert', (e) => {
    beat();
    try { upsert(JSON.parse(e.data), { live: true }); } catch { /* ignore a bad frame */ }
  });
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) { // the browser gave up; try again ourselves
      setLive('offline');
      retryTimer = setTimeout(connect, 10_000);
    } else {
      setLive('connecting');
    }
  };
}

// a connection can die without the browser noticing (sleeping laptops, proxies, bad networks): reconnect if it goes quiet
setInterval(() => {
  if (stream && Date.now() - lastBeat > SILENCE_LIMIT_MS) { setLive('connecting'); connect(); }
}, 10_000);
window.addEventListener('online', () => { connect(); sync({ announce: true }).catch(() => {}); });

/* ---------- filing a request ---------- */

function say(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('is-error', isError);
}

function wireForm() {
  const form = $('#cc-form');
  const msg = $('#cc-msg');
  form.elements.name.value = rememberedName();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    const missing = Object.keys(FIELD_LABEL).find((k) => !String(body[k] || '').trim());
    if (missing) {
      say(msg, `${FIELD_LABEL[missing]} is required.`, true);
      form.elements[missing].focus();
      return;
    }
    const btn = $('#cc-submit');
    btn.disabled = true;
    say(msg, 'Filing...');
    try {
      const { request } = await api('/', { method: 'POST', body });
      rememberName(body.name.trim());
      if (request) upsert(request, { live: true });
      ['change', 'impact', 'rollback'].forEach((k) => { form.elements[k].value = ''; });
      msg.classList.remove('is-error');
      msg.innerHTML = `Filed${request ? ` as <a href="#log">${esc(request.id)}</a>` : ''}. Now wait for the team.`;
    } catch (err) {
      say(msg, err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- approve / deny / reopen ---------- */

function wireDialog() {
  const dialog = $('#cc-dialog');
  const form = $('#cc-act-form');
  const msg = $('#cc-dlg-msg');

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.cr').dataset.id;
    acting = { id, action: btn.dataset.act };
    $('#cc-dlg-title').textContent = `${ACTIONS[acting.action]} ${id}`;
    $('#cc-dlg-sub').textContent = state.requests.get(id)?.change || '';
    $('#cc-dlg-ok').textContent = ACTIONS[acting.action];
    form.elements.name.value = rememberedName() || $('#cc-form').elements.name.value.trim();
    form.elements.note.value = '';
    say(msg, '');
    dialog.showModal();
    (form.elements.name.value ? form.elements.note : form.elements.name).focus();
  });

  $('#cc-dlg-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // the backdrop

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    if (!name) { say(msg, 'Log your name first.', true); form.elements.name.focus(); return; }
    const ok = $('#cc-dlg-ok');
    ok.disabled = true;
    try {
      const { request } = await api(`/${acting.id}/${acting.action}`, {
        method: 'POST',
        body: { name, note: form.elements.note.value },
      });
      rememberName(name);
      upsert(request, { live: true });
      dialog.close();
    } catch (err) {
      say(msg, err.message, true);
      if (err.status === 409) sync().catch(() => {}); // someone got there first: show what really happened
    } finally {
      ok.disabled = false;
    }
  });
}

/* ---------- boot ---------- */

$('#cc-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  renderList();
});

wireForm();
wireDialog();
renderFilters();

sync()
  .then(connect)
  .catch(() => {
    setLive('offline');
    $('#cc-empty').hidden = false;
    $('#cc-empty').textContent = "Couldn't load the log. Reload to try again.";
    connect();
  });

// safety nets: relative times tick, and a quiet re-sync catches anything a dropped connection missed
setInterval(() => {
  document.querySelectorAll('.cr__trail time[data-at]').forEach((t) => { t.textContent = ago(t.dataset.at); });
}, 30_000);
setInterval(() => { if (!document.hidden) sync({ announce: true }).catch(() => {}); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync({ announce: true }).catch(() => {}); });
