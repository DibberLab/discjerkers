/* Flight guide accounts: who you are, your bags, and the dialogs for signing in and managing them.
   The flight guide itself decides what to do with a bag; this file only knows how to keep one. */

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const account = { user: null, bags: [], activeId: null, ready: false };

const listeners = new Set();
export const onAccountChange = (fn) => { listeners.add(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });

const remembered = () => { try { return localStorage.getItem('dj_fg_bag'); } catch { return null; } };
const remember = (id) => { try { localStorage.setItem('dj_fg_bag', id); } catch { /* private mode: fine */ } };

export const activeBag = () => account.bags.find((b) => b.id === account.activeId) || null;
export const inBag = (discId, bag = activeBag()) => !!bag && bag.discs.includes(discId);
// what the owner has said about a disc in a bag: { color, plastic, photo }, or null
export const itemOf = (discId, bag = activeBag()) => bag?.items?.[discId] || null;
export const photoUrl = (name) => `/api/account/photos/${name}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/account${path}`, {
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

// keep the active bag pointing at a bag that exists: the remembered one, else the main bag
function settle() {
  const ids = account.bags.map((b) => b.id);
  if (ids.includes(account.activeId)) return;
  const saved = remembered();
  account.activeId = ids.includes(saved) ? saved : (account.bags.find((b) => b.main) || account.bags[0])?.id || null;
}

function apply(data) {
  account.user = data.user || null;
  account.bags = data.bags || [];
  account.ready = true;
  account.activeId = null;
  settle();
}

export async function loadAccount() {
  try {
    apply(await api('/me'));
  } catch {
    apply({}); // couldn't reach the server: behave as signed out rather than break the page
  }
  emit();
}

export function setActive(id) {
  if (!account.bags.some((b) => b.id === id)) return;
  account.activeId = id;
  remember(id);
  emit();
}

async function change(path, opts, after) {
  const data = await api(path, opts);
  account.bags = data.bags;
  if (after) after(data);
  settle();
  emit();
  return data;
}

export const addDisc = (discId, bagId = account.activeId) => change(`/bags/${bagId}/discs/${discId}`, { method: 'PUT' });
export const removeDisc = (discId, bagId = account.activeId) => change(`/bags/${bagId}/discs/${discId}`, { method: 'DELETE' });
export const setItem = (discId, fields, bagId = account.activeId) => change(`/bags/${bagId}/discs/${discId}`, { method: 'PATCH', body: fields });
export const clearPhoto = (discId, bagId = account.activeId) => change(`/bags/${bagId}/discs/${discId}/photo`, { method: 'DELETE' });

export async function setPhoto(discId, blob, bagId = account.activeId) {
  const res = await fetch(`/api/account/bags/${bagId}/discs/${discId}/photo`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 413 ? 'That photo is too big.' : data.error || `Something went wrong (${res.status}).`);
  account.bags = data.bags;
  settle();
  emit();
}

// A phone photo is several megabytes of picture plus where it was taken. Crop it to a square, shrink it, and re-encode
// it as a small JPEG in the browser; that also leaves the location data behind.
export async function photoToJpeg(file, size = 640) {
  if (!file.type.startsWith('image/')) throw new Error('Pick a photo.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That file is too big.');
  let img;
  try {
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that photo. Try a JPEG or PNG."));
      el.src = URL.createObjectURL(file);
    });
  }
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  for (const quality of [0.85, 0.72, 0.6, 0.5]) {
    const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
    if (blob && blob.size <= 380 * 1024) return blob;
  }
  throw new Error('That photo is too big.');
}

export const createBag = (name) => change('/bags', { method: 'POST', body: { name } }, (d) => { account.activeId = d.bagId; remember(d.bagId); });
export const renameBag = (id, name) => change(`/bags/${id}`, { method: 'PATCH', body: { name } });
export const makeMain = (id) => change(`/bags/${id}`, { method: 'PATCH', body: { main: true } });
export const deleteBag = (id) => change(`/bags/${id}`, { method: 'DELETE' });

export async function signOut() {
  try { await api('/logout', { method: 'POST' }); } catch { /* the cookie is gone or the server is: either way we are done here */ }
  apply({});
  emit();
}

/* ---------- sign in / create account ---------- */

let signIn;

function buildSignIn() {
  const dlg = document.createElement('dialog');
  dlg.className = 'fg-dialog';
  dlg.setAttribute('aria-labelledby', 'fg-si-title');
  dlg.innerHTML = `
    <form class="fg-dialog__form" novalidate>
      <h3 id="fg-si-title"></h3>
      <p class="fg-dialog__sub"></p>
      <label class="fg-field"><span>Username</span><input name="username" autocomplete="username" maxlength="24" autocapitalize="none" spellcheck="false"></label>
      <label class="fg-field"><span>Password</span><input name="password" type="password" maxlength="128"></label>
      <input class="fg-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="fg-dialog__msg" role="alert"></p>
      <div class="fg-dialog__actions">
        <button class="chip" type="button" data-cancel>Cancel</button>
        <button class="btn" type="submit"></button>
      </div>
      <p class="fg-dialog__switch"><button type="button" data-switch></button></p>
    </form>`;
  document.body.append(dlg);

  const form = $('form', dlg);
  const msg = $('.fg-dialog__msg', dlg);
  let mode = 'in';
  let done = null;

  const paint = () => {
    const up = mode === 'up';
    $('#fg-si-title', dlg).textContent = up ? 'Create account' : 'Sign in';
    $('.fg-dialog__sub', dlg).textContent = up
      ? 'Pick a username and a password. No email, so there is no reset: choose one you will remember.'
      : 'Sign in to save discs to your bags and fly your whole bag at once.';
    form.elements.password.autocomplete = up ? 'new-password' : 'current-password';
    form.elements.website.disabled = !up;
    $('button[type="submit"]', dlg).textContent = up ? 'Create account' : 'Sign in';
    $('[data-switch]', dlg).textContent = up ? 'Already have an account? Sign in' : 'New here? Create an account';
    msg.textContent = '';
  };

  $('[data-switch]', dlg).addEventListener('click', () => { mode = mode === 'in' ? 'up' : 'in'; paint(); form.elements.username.focus(); });
  $('[data-cancel]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // the backdrop
  dlg.addEventListener('close', () => { form.elements.password.value = ''; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    if (!username || !password) { msg.textContent = 'Enter a username and a password.'; return; }
    const btn = $('button[type="submit"]', dlg);
    btn.disabled = true;
    msg.textContent = mode === 'up' ? 'Creating...' : 'Signing in...';
    try {
      const data = await api(mode === 'up' ? '/signup' : '/login', {
        method: 'POST',
        body: { username, password, website: mode === 'up' ? form.elements.website.value : undefined },
      });
      if (!data.user) throw new Error('Something went wrong. Try again.');
      apply(data);
      emit();
      dlg.close();
      done?.();
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  return {
    open(m, cb) {
      mode = m;
      done = cb || null;
      form.reset();
      paint();
      dlg.showModal();
      form.elements.username.focus();
    },
  };
}

export function openSignIn({ mode = 'in', onDone } = {}) {
  signIn ||= buildSignIn();
  signIn.open(mode, onDone);
}

/* ---------- manage bags ---------- */

let manager;

function buildManager() {
  const dlg = document.createElement('dialog');
  dlg.className = 'fg-dialog fg-dialog--wide';
  dlg.setAttribute('aria-labelledby', 'fg-bm-title');
  dlg.innerHTML = `
    <div class="fg-dialog__form">
      <h3 id="fg-bm-title">Your bags</h3>
      <p class="fg-dialog__sub">Your main bag is the one that opens first. Tap the star to change it.</p>
      <ul class="fg-bagmgr"></ul>
      <form class="fg-bagnew" novalidate>
        <input name="name" placeholder="New bag name" maxlength="40" autocomplete="off" aria-label="New bag name">
        <button class="chip" type="submit">+ Add bag</button>
      </form>
      <p class="fg-dialog__msg" role="status"></p>
      <div class="fg-dialog__actions"><button class="btn" type="button" data-close>Done</button></div>
    </div>`;
  document.body.append(dlg);

  const list = $('.fg-bagmgr', dlg);
  const msg = $('.fg-dialog__msg', dlg);
  const say = (t) => { msg.textContent = t; };

  const draw = () => {
    const had = document.activeElement;
    const keep = had && dlg.contains(had) && had.closest('li') ? { id: had.closest('li').dataset.id, sel: had.matches('input') ? 'input' : `[data-act="${had.dataset.act}"]` } : null;
    list.innerHTML = account.bags.map((b) => `
      <li data-id="${esc(b.id)}">
        <button class="fg-star" type="button" data-act="main" aria-pressed="${b.main}" aria-label="${b.main ? `${esc(b.name)} is your main bag` : `Make ${esc(b.name)} your main bag`}" title="${b.main ? 'Main bag' : 'Make this the main bag'}">★</button>
        <input class="fg-bagmgr__name" value="${esc(b.name)}" maxlength="40" aria-label="Bag name" autocomplete="off">
        <span class="fg-bagmgr__n">${b.discs.length} ${b.discs.length === 1 ? 'disc' : 'discs'}</span>
        <button class="fg-bagmgr__del" type="button" data-act="delete"${b.main ? ' disabled title="Make another bag main to delete this one"' : ''} aria-label="Delete ${esc(b.name)}">Delete</button>
      </li>`).join('');
    if (keep) $(`li[data-id="${keep.id}"] ${keep.sel}`, list)?.focus();
  };

  const run = async (fn) => {
    say('');
    try { await fn(); } catch (err) { say(err.message); draw(); }
  };

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.closest('li').dataset.id;
    if (btn.dataset.act === 'main') { run(() => makeMain(id)); return; }
    if (btn.dataset.act === 'delete') {
      if (btn.dataset.armed) { run(() => deleteBag(id)); return; }
      btn.dataset.armed = '1'; // two taps: deleting a bag throws away its list
      btn.textContent = 'Really?';
      setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 3500);
    }
  });
  list.addEventListener('change', (e) => {
    const input = e.target.closest('.fg-bagmgr__name');
    if (input) run(() => renameBag(input.closest('li').dataset.id, input.value));
  });
  $('.fg-bagnew', dlg).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.target.elements.name;
    if (!input.value.trim()) { say('Give the bag a name.'); return; }
    run(async () => { await createBag(input.value); input.value = ''; });
  });
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  onAccountChange(() => { if (dlg.open) { if (account.user) draw(); else dlg.close(); } });

  return {
    open(focusNew) {
      say('');
      draw();
      dlg.showModal();
      if (focusNew) $('.fg-bagnew input', dlg).focus();
    },
  };
}

export function openBags({ focusNew = false } = {}) {
  manager ||= buildManager();
  manager.open(focusNew);
}

/* ---------- the bar above the chart ---------- */

export function mountBar(el, { onFly }) {
  const draw = () => {
    if (!account.ready) { el.innerHTML = ''; return; }
    if (!account.user) {
      el.innerHTML = `
        <p class="fg-acct__pitch"><b>Build your bag.</b> Sign in, save your discs, and fly the whole bag at once.</p>
        <button class="chip fg-cmpbtn--go" type="button" data-acct="signin">Sign in / create account</button>`;
      return;
    }
    const bag = activeBag();
    const options = account.bags.map((b) => `<option value="${esc(b.id)}"${b.id === account.activeId ? ' selected' : ''}>${b.main ? '★ ' : ''}${esc(b.name)} (${b.discs.length})</option>`).join('') + '<option value="__new">+ New bag…</option>';
    const n = bag ? bag.discs.length : 0;
    el.innerHTML = `
      <span class="fg-acct__who"><span class="fg-wind__l">Signed in</span> <b>${esc(account.user.name)}</b></span>
      <label class="fg-acct__bag"><span class="fg-wind__l">Bag</span><select data-acct="bag" aria-label="Active bag">${options}</select></label>
      <button class="chip fg-cmpbtn--go" type="button" data-acct="fly"${n ? '' : ' disabled title="Add a disc to this bag first"'}>Fly this bag (${n})</button>
      <button class="chip" type="button" data-acct="manage">Manage bags</button>
      <button class="fg-tray__clear" type="button" data-acct="signout">Sign out</button>`;
  };

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-acct]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.acct;
    if (act === 'signin') openSignIn({ mode: 'in' });
    else if (act === 'manage') openBags();
    else if (act === 'fly') onFly();
    else if (act === 'signout') signOut();
  });
  el.addEventListener('change', (e) => {
    if (!e.target.matches('[data-acct="bag"]')) return;
    if (e.target.value === '__new') { openBags({ focusNew: true }); draw(); return; } // draw() puts the picker back
    setActive(e.target.value);
  });
  onAccountChange(draw);
  draw();
}
