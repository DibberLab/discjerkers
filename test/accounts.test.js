'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createAccountStore, LIMITS } = require('../server/lib/accounts');
const { createAccountRouter } = require('../server/routes/account');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-accounts-')), 'accounts.json');
const PW = 'correct horse battery';
const jpeg = (n = 300) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);

/* ---------- the store ---------- */

test('signing up makes the user a main bag, and the password is not stored as typed', async () => {
  const file = tmpFile();
  const store = createAccountStore(file);
  const user = await store.signup('Dana', PW);
  assert.strictEqual(user.name, 'Dana');
  assert.strictEqual(user.bags.length, 1);
  assert.deepStrictEqual([user.bags[0].name, user.bags[0].main, user.bags[0].discs], ['Main bag', true, []]);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PW));
  assert.match(JSON.parse(raw).users[0].pass, /^s1\$/);
});

test('usernames and passwords are checked, and a name can only be taken once (any capitalization)', async () => {
  const store = createAccountStore(tmpFile());
  for (const bad of ['', 'ab', 'x'.repeat(LIMITS.usernameMax + 1), 'has space', 'semi;colon', '<b>hi</b>']) {
    await assert.rejects(store.signup(bad, PW), /username/i, bad);
  }
  await assert.rejects(store.signup('Dana', 'short'), /at least 8/);
  await assert.rejects(store.signup('Dana', 'x'.repeat(LIMITS.passwordMax + 1)), /too long/);
  await store.signup('Dana', PW);
  await assert.rejects(store.signup('dANA', PW), (e) => e.status === 409 && /taken/.test(e.message));
});

test('login accepts the right password and refuses everything else the same way', async () => {
  const store = createAccountStore(tmpFile());
  await store.signup('Dana', PW);
  assert.strictEqual((await store.login('dana', PW)).name, 'Dana');
  const wrong = await store.login('Dana', 'nope nope nope').catch((e) => e);
  const nobody = await store.login('Nobody', PW).catch((e) => e);
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.message, nobody.message); // no hint about which names exist
});

test('sessions: the file keeps only a hash, logout ends it, and expiry is honored', async () => {
  const file = tmpFile();
  let clock = 1_000_000;
  const store = createAccountStore(file, { now: () => clock });
  const user = await store.signup('Dana', PW);
  const token = store.startSession(user.id);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
  assert.strictEqual(store.userForSession(token).name, 'Dana');
  assert.strictEqual(store.userForSession('not a token'), null);
  assert.strictEqual(store.userForSession(''), null);

  store.endSession(token);
  assert.strictEqual(store.userForSession(token), null);

  const t2 = store.startSession(user.id);
  clock += (LIMITS.sessionDays + 1) * 86_400_000;
  assert.strictEqual(store.userForSession(t2), null);
});

test('a user keeps at most a handful of live sessions; the oldest go first', async () => {
  let clock = 1_000_000;
  const store = createAccountStore(tmpFile(), { now: () => clock });
  const user = await store.signup('Dana', PW);
  const tokens = [];
  for (let i = 0; i < LIMITS.sessionsPerUser + 2; i++) { tokens.push(store.startSession(user.id)); clock += 1000; }
  assert.strictEqual(store.userForSession(tokens[0]), null);
  assert.strictEqual(store.userForSession(tokens[1]), null);
  assert.ok(store.userForSession(tokens.at(-1)));
});

test('bags: create, rename, make main, delete; the main bag cannot be deleted or un-mained', async () => {
  const store = createAccountStore(tmpFile());
  const { id } = await store.signup('Dana', PW);
  const made = store.createBag(id, '  Tournament   bag ');
  assert.strictEqual(made.bags.find((b) => b.id === made.bagId).name, 'Tournament bag');
  assert.throws(() => store.createBag(id, 'tournament BAG'), (e) => e.status === 409);
  assert.throws(() => store.createBag(id, '   '), /required/);
  assert.throws(() => store.createBag(id, 'x'.repeat(LIMITS.bagName + 1)), /too long/);

  const main = made.bags.find((b) => b.main);
  assert.throws(() => store.deleteBag(id, main.id), /main bag/);
  assert.throws(() => store.updateBag(id, main.id, { main: false }), /another bag/);

  let bags = store.updateBag(id, made.bagId, { name: 'Tourney', main: true });
  assert.deepStrictEqual(bags.map((b) => [b.name, b.main]), [['Main bag', false], ['Tourney', true]]);
  bags = store.deleteBag(id, main.id);
  assert.strictEqual(bags.length, 1);
  assert.throws(() => store.updateBag(id, 'nope', { name: 'x' }), (e) => e.status === 404);
});

test('discs go in once, come out cleanly, and a bag has a ceiling', async () => {
  const store = createAccountStore(tmpFile());
  const { id, bags } = await store.signup('Dana', PW);
  const bag = bags[0].id;
  store.addDisc(id, bag, 7);
  const again = store.addDisc(id, bag, 7);
  assert.deepStrictEqual(again[0].discs, [7]);
  assert.deepStrictEqual(store.removeDisc(id, bag, 7)[0].discs, []);
  assert.deepStrictEqual(store.removeDisc(id, bag, 7)[0].discs, []); // taking out what is not there is fine
  for (let d = 1; d <= LIMITS.discsPerBag; d++) store.addDisc(id, bag, d);
  assert.throws(() => store.addDisc(id, bag, 9999), (e) => e.status === 409);
});

test('people only ever see and change their own bags', async () => {
  const store = createAccountStore(tmpFile());
  const a = await store.signup('Dana', PW);
  const b = await store.signup('Sam', PW);
  assert.throws(() => store.addDisc(b.id, a.bags[0].id, 3), (e) => e.status === 404);
  assert.throws(() => store.deleteBag(b.id, a.bags[0].id), (e) => e.status === 404);
  assert.deepStrictEqual(store.userForSession(store.startSession(a.id)).bags[0].discs, []);
});

test('accounts survive a restart, and numbering carries on', async () => {
  const file = tmpFile();
  const first = createAccountStore(file);
  const u = await first.signup('Dana', PW);
  first.addDisc(u.id, u.bags[0].id, 12);
  const token = first.startSession(u.id);
  const second = createAccountStore(file);
  assert.deepStrictEqual(second.userForSession(token).bags[0].discs, [12]);
  assert.strictEqual((await second.login('Dana', PW)).name, 'Dana');
  assert.notStrictEqual((await second.signup('Sam', PW)).id, u.id);
});

test('an unreadable file is set aside, never overwritten, and never blocks startup', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  const store = createAccountStore(file);
  await store.signup('Dana', PW);
  assert.strictEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.corrupt-')).length, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-accounts-'));
  const odd = path.join(dir, 'accounts.json');
  fs.mkdirSync(odd); // a directory where the file should be
  const quiet = console.error;
  console.error = () => {};
  let ro;
  try { ro = createAccountStore(odd); } finally { console.error = quiet; }
  await assert.rejects(ro.signup('Dana', PW), (e) => e.status === 503);
  assert.ok(fs.statSync(odd).isDirectory());
});

test('a failed save leaves nothing half-done', async () => {
  const file = tmpFile();
  const store = createAccountStore(file);
  const { id, bags } = await store.signup('Dana', PW);
  fs.mkdirSync(`${file}.tmp`); // makes every save fail
  assert.throws(() => store.addDisc(id, bags[0].id, 5), /Could not save/);
  assert.throws(() => store.createBag(id, 'Nope'), /Could not save/);
  fs.rmdirSync(`${file}.tmp`);
  const now = store.userForSession(store.startSession(id));
  assert.deepStrictEqual(now.bags.map((b) => [b.name, b.discs.length]), [['Main bag', 0]]);
});

test('a burst of logins all finish, and extras past the queue are turned away instead of piling up', async () => {
  const store = createAccountStore(tmpFile());
  await store.signup('Dana', PW);
  const results = await Promise.allSettled(Array.from({ length: 40 }, () => store.login('Dana', 'wrong wrong')));
  const codes = results.map((r) => (r.status === 'rejected' ? r.reason.status : 200));
  assert.ok(codes.includes(401));
  assert.ok(codes.every((c) => c === 401 || c === 503));
  assert.strictEqual((await store.login('Dana', PW)).name, 'Dana'); // and it still works afterwards
});


test('a disc in a bag can have a color and a plastic; both can be cleared; junk is refused', async () => {
  const store = createAccountStore(tmpFile());
  const { id, bags } = await store.signup('Dana', PW);
  const bag = bags[0].id;
  assert.throws(() => store.setItem(id, bag, 7, { color: '#ff0000' }), (e) => e.status === 404); // not in the bag yet
  store.addDisc(id, bag, 7);
  let b = store.setItem(id, bag, 7, { color: '#FF8A3D', plastic: '  Star   Champion ' })[0];
  assert.deepStrictEqual(b.items['7'], { color: '#ff8a3d', plastic: 'Star Champion' });
  assert.throws(() => store.setItem(id, bag, 7, { color: 'red' }), /not a color/);
  assert.throws(() => store.setItem(id, bag, 7, { color: '#12345' }), /not a color/);
  assert.throws(() => store.setItem(id, bag, 7, { plastic: 'x'.repeat(LIMITS.plastic + 1) }), /too long/);
  b = store.setItem(id, bag, 7, { color: null })[0];
  assert.deepStrictEqual(b.items['7'], { plastic: 'Star Champion' });
  b = store.setItem(id, bag, 7, { plastic: '' })[0];
  assert.deepStrictEqual(b.items, {}); // nothing left to remember
});

test('photos: stored per user, replaced cleanly, and removed with the disc or the bag', async () => {
  const file = tmpFile();
  const store = createAccountStore(file);
  const { id, bags } = await store.signup('Dana', PW);
  const dir = path.join(path.dirname(file), 'photos', id);
  const mainBag = bags[0].id;
  store.addDisc(id, mainBag, 7);
  assert.throws(() => store.setPhoto(id, mainBag, 9, jpeg()), (e) => e.status === 404);
  assert.throws(() => store.setPhoto(id, mainBag, 7, Buffer.from('<html>not a jpeg at all, but long enough to pass the size check............................................................................................</html>')), (e) => e.status === 415);
  assert.throws(() => store.setPhoto(id, mainBag, 7, jpeg(LIMITS.photoBytes + 10)), (e) => e.status === 413);
  assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0);

  const first = store.setPhoto(id, mainBag, 7, jpeg())[0].items['7'].photo;
  assert.match(first, /^[a-f0-9]{24}\.jpg$/);
  assert.ok(fs.existsSync(store.photoPath(id, first)));
  const second = store.setPhoto(id, mainBag, 7, jpeg(400))[0].items['7'].photo;
  assert.notStrictEqual(first, second);
  assert.ok(!fs.existsSync(store.photoPath(id, first))); // the old one is gone
  assert.deepStrictEqual(fs.readdirSync(dir), [second]);

  store.clearPhoto(id, mainBag, 7);
  assert.deepStrictEqual(fs.readdirSync(dir), []);

  // taking a disc out of a bag, or deleting a bag, takes its photos with it
  store.setPhoto(id, mainBag, 7, jpeg());
  store.removeDisc(id, mainBag, 7);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  const other = store.createBag(id, 'Putters').bagId;
  store.addDisc(id, other, 3);
  store.setPhoto(id, other, 3, jpeg());
  assert.strictEqual(fs.readdirSync(dir).length, 1);
  store.deleteBag(id, other);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
  assert.strictEqual(store.photoPath(id, '../../etc/passwd'), null);
});

test('a user has a photo allowance, and a failed save keeps no stray file', async () => {
  const file = tmpFile();
  const store = createAccountStore(file);
  const { id, bags } = await store.signup('Dana', PW);
  const bagA = bags[0].id;
  const bagB = store.createBag(id, 'More').bagId;
  const dir = path.join(path.dirname(file), 'photos', id);
  for (let d = 1; d <= LIMITS.photosPerUser; d++) {
    const bag = d <= LIMITS.discsPerBag ? bagA : bagB; // a bag holds fewer discs than the photo allowance
    store.addDisc(id, bag, d);
    store.setPhoto(id, bag, d, jpeg(150));
  }
  assert.strictEqual(fs.readdirSync(dir).length, LIMITS.photosPerUser);
  store.addDisc(id, bagB, 9000);
  assert.throws(() => store.setPhoto(id, bagB, 9000, jpeg()), (e) => e.status === 409);
  assert.strictEqual(fs.readdirSync(dir).length, LIMITS.photosPerUser);
  store.setPhoto(id, bagA, 1, jpeg(200)); // replacing one is still fine at the limit
  assert.strictEqual(fs.readdirSync(dir).length, LIMITS.photosPerUser);

  fs.mkdirSync(`${file}.tmp`); // every save fails now
  assert.throws(() => store.setPhoto(id, bagA, 2, jpeg(250)), /Could not save/);
  fs.rmdirSync(`${file}.tmp`);
  assert.strictEqual(fs.readdirSync(dir).length, LIMITS.photosPerUser);
});

/* ---------- the HTTP layer ---------- */

async function serve(options = {}) {
  const store = createAccountStore(tmpFile());
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/account', createAccountRouter({ store, knownDiscs: new Set([1, 2, 3, 4, 5]), ...options }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/account`;

  // a tiny browser: keeps its cookie
  const browser = (ip = '10.0.0.1') => {
    let cookie = '';
    const call = async (method, suffix, body, headers = {}) => {
      const res = await fetch(base + suffix, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, headers: res.headers, json: await res.json().catch(() => ({})), set };
    };
    return { call, cookie: () => cookie };
  };
  return { browser, port: server.address().port, close: () => { server.closeAllConnections(); server.close(); } };
}

test('sign up, stay signed in, bag things, sign out', async () => {
  const { browser, close } = await serve();
  try {
    const b = browser();
    assert.deepStrictEqual((await b.call('GET', '/me')).json, { user: null, bags: [] });

    const up = await b.call('POST', '/signup', { username: 'Dana', password: PW });
    assert.strictEqual(up.status, 201);
    assert.match(up.set, /HttpOnly/);
    assert.match(up.set, /SameSite=Lax/);
    assert.strictEqual(up.headers.get('cache-control'), 'no-store');

    const me = (await b.call('GET', '/me')).json;
    assert.strictEqual(me.user.name, 'Dana');
    const main = me.bags[0].id;

    assert.deepStrictEqual((await b.call('PUT', `/bags/${main}/discs/2`)).json.bags[0].discs, [2]);
    assert.strictEqual((await b.call('PUT', `/bags/${main}/discs/99`)).status, 404); // not a disc
    assert.strictEqual((await b.call('PUT', `/bags/${main}/discs/abc`)).status, 404);

    const made = await b.call('POST', '/bags', { name: 'Putters' });
    assert.strictEqual(made.status, 201);
    const patch = await b.call('PATCH', `/bags/${made.json.bagId}`, { main: true });
    assert.deepStrictEqual(patch.json.bags.map((x) => x.main), [false, true]);
    assert.strictEqual((await b.call('DELETE', `/bags/${made.json.bagId}`)).status, 409); // it is main now

    await b.call('POST', '/logout');
    assert.deepStrictEqual((await b.call('GET', '/me')).json, { user: null, bags: [] });
    assert.strictEqual((await b.call('PUT', `/bags/${main}/discs/2`)).status, 401);
  } finally { close(); }
});

test('login works from a fresh browser, and a stolen-looking token does nothing', async () => {
  const { browser, close } = await serve();
  try {
    await browser().call('POST', '/signup', { username: 'Dana', password: PW });
    const other = browser('10.0.0.2');
    assert.strictEqual((await other.call('POST', '/login', { username: 'dana', password: 'wrong wrong' })).status, 401);
    assert.strictEqual((await other.call('POST', '/login', { username: 'dana', password: PW })).status, 200);
    assert.strictEqual((await other.call('GET', '/me')).json.user.name, 'Dana');
    const fake = browser();
    const res = await fake.call('GET', '/me', null, { Cookie: 'dj_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    assert.strictEqual(res.json.user, null);
  } finally { close(); }
});

test('someone else\'s bag is a 404, and cross-site requests are refused', async () => {
  const { browser, port, close } = await serve();
  try {
    const a = browser('10.0.0.1');
    const mineBag = (await a.call('POST', '/signup', { username: 'Dana', password: PW })).json.bags[0].id;
    const s = browser('10.0.0.2');
    await s.call('POST', '/signup', { username: 'Sam', password: PW });
    assert.strictEqual((await s.call('PUT', `/bags/${mineBag}/discs/1`)).status, 404);
    assert.strictEqual((await s.call('DELETE', `/bags/${mineBag}`)).status, 404);

    const cross = await a.call('POST', '/bags', { name: 'Evil' }, { Origin: 'https://evil.example' });
    assert.strictEqual(cross.status, 403);
    const ours = await a.call('POST', '/bags', { name: 'Fine' }, { Origin: `http://127.0.0.1:${port}` });
    assert.strictEqual(ours.status, 201);
  } finally { close(); }
});

test('the honeypot fakes a signup and creates nothing', async () => {
  const { browser, close } = await serve();
  try {
    const b = browser();
    const res = await b.call('POST', '/signup', { username: 'Botty', password: PW, website: 'http://spam.example' });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.set, null);
    assert.strictEqual((await b.call('POST', '/login', { username: 'Botty', password: PW })).status, 401);
  } finally { close(); }
});

test('wrong passwords are rate limited per address and per account; sign-ups are limited too', async () => {
  const { browser, close } = await serve({
    login: { windowMs: 60_000, max: 6 },
    signup: { windowMs: 60_000, max: 2 },
  });
  try {
    await browser('10.9.9.9').call('POST', '/signup', { username: 'Dana', password: PW });

    // per account: a different address each time still runs into the account's own limit
    let last;
    for (let i = 0; i < 8; i++) last = await browser(`10.1.0.${i}`).call('POST', '/login', { username: 'Dana', password: 'wrong wrong' });
    assert.strictEqual(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    // ...and the real password is refused too while locked out
    assert.strictEqual((await browser('10.1.1.1').call('POST', '/login', { username: 'Dana', password: PW })).status, 429);

    // per address: one place guessing at many accounts
    const one = browser('10.2.0.1');
    let status;
    for (let i = 0; i < 8; i++) status = (await one.call('POST', '/login', { username: `ghost${i}`, password: 'wrong wrong' })).status;
    assert.strictEqual(status, 429);

    const s = browser('10.3.0.1');
    assert.strictEqual((await s.call('POST', '/signup', { username: 'One', password: PW })).status, 201);
    assert.strictEqual((await s.call('POST', '/signup', { username: 'Two', password: PW })).status, 201);
    assert.strictEqual((await s.call('POST', '/signup', { username: 'Three', password: PW })).status, 429);
  } finally { close(); }
});

test('over HTTP: color, plastic and a photo for a bagged disc, and only the owner can see the photo', async () => {
  const { browser, close, port } = await serve();
  try {
    const a = browser('10.0.0.1');
    const bag = (await a.call('POST', '/signup', { username: 'Dana', password: PW })).json.bags[0].id;
    await a.call('PUT', `/bags/${bag}/discs/2`);

    const patched = await a.call('PATCH', `/bags/${bag}/discs/2`, { color: '#38c8e8', plastic: 'Z' });
    assert.deepStrictEqual(patched.json.bags[0].items['2'], { color: '#38c8e8', plastic: 'Z' });
    assert.strictEqual((await a.call('PATCH', `/bags/${bag}/discs/2`, { color: 'nope' })).status, 400);

    const put = (token, type = 'image/jpeg', body = jpeg()) => fetch(`http://127.0.0.1:${port}/api/account/bags/${bag}/discs/2/photo`, {
      method: 'PUT', headers: { 'Content-Type': type, 'X-Real-IP': '10.0.0.1', Cookie: token }, body,
    });
    const cookie = a.cookie();
    assert.strictEqual((await put(cookie, 'text/plain')).status, 415);
    assert.strictEqual((await put(cookie, 'image/jpeg', jpeg(LIMITS.photoBytes + 50))).status, 413);
    assert.strictEqual((await put('')).status, 401);
    const up = await put(cookie);
    assert.strictEqual(up.status, 200);
    const name = (await up.json()).bags[0].items['2'].photo;

    const read = (token) => fetch(`http://127.0.0.1:${port}/api/account/photos/${name}`, { headers: { Cookie: token } });
    const mine = await read(cookie);
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.headers.get('content-type'), 'image/jpeg');
    assert.strictEqual(mine.headers.get('x-content-type-options'), 'nosniff');
    assert.match(mine.headers.get('cache-control'), /private/);
    assert.strictEqual((await mine.arrayBuffer()).byteLength, jpeg().length);
    assert.strictEqual((await read('')).status, 401);

    const s = browser('10.0.0.2');
    await s.call('POST', '/signup', { username: 'Sam', password: PW });
    assert.strictEqual((await read(s.cookie())).status, 404); // someone else's photo does not exist for Sam
    assert.strictEqual((await read(cookie).then(() => fetch(`http://127.0.0.1:${port}/api/account/photos/..%2f..%2fx.jpg`, { headers: { Cookie: cookie } }))).status, 404);

    const gone = await a.call('DELETE', `/bags/${bag}/discs/2/photo`);
    assert.strictEqual(gone.json.bags[0].items['2'].photo, undefined);
    assert.strictEqual((await read(cookie)).status, 404);
  } finally { close(); }
});
