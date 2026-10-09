'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createChangeStore, LIMITS } = require('../server/lib/changes');
const { createChangesRouter } = require('../server/routes/changes');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dj-changes-')), 'changes.json');
const ask = (over = {}) => ({ name: 'Dana', change: 'Move the footer', impact: 'Footer moves', rollback: 'Move it back', ...over });

/* ---------- the store ---------- */

test('filing a request numbers it, opens it pending, and logs who filed it', () => {
  const store = createChangeStore(tmpFile());
  const a = store.create(ask());
  const b = store.create(ask({ change: 'Recolor the cat' }));
  assert.strictEqual(a.id, 'CR-0001');
  assert.strictEqual(b.id, 'CR-0002');
  assert.strictEqual(a.status, 'pending');
  assert.deepStrictEqual(a.history.map((h) => [h.action, h.by]), [['filed', 'Dana']]);
  assert.deepStrictEqual(store.list().map((r) => r.id), ['CR-0002', 'CR-0001']);
});

test('every field is required, and over-long ones are refused rather than trimmed', () => {
  const store = createChangeStore(tmpFile());
  for (const key of ['name', 'change', 'impact', 'rollback']) {
    assert.throws(() => store.create(ask({ [key]: '   ' })), /required/);
  }
  assert.throws(() => store.create(ask({ change: 'x'.repeat(LIMITS.change + 1) })), /too long/);
  assert.strictEqual(store.list().length, 0);
});

test('control, zero-width, and bidi characters are scrubbed and whitespace collapses', () => {
  const store = createChangeStore(tmpFile());
  const sneaky = `Da${String.fromCodePoint(0x200b)}na${String.fromCodePoint(0x202e)}  the\n\tgreat${String.fromCodePoint(0)}`;
  const r = store.create(ask({ name: sneaky }));
  assert.strictEqual(r.filedBy, 'Da na the great');
});

test('approve and deny only work on pending requests; reopen only on decided ones', () => {
  const store = createChangeStore(tmpFile());
  const { id } = store.create(ask());

  const approved = store.act(id, 'approve', { name: 'Sam', note: 'ship it' });
  assert.strictEqual(approved.status, 'approved');
  assert.strictEqual(approved.history.at(-1).note, 'ship it');

  assert.throws(() => store.act(id, 'approve', { name: 'Lee' }), (e) => e.status === 409 && /Already approved/.test(e.message));
  assert.throws(() => store.act(id, 'deny', { name: 'Lee' }), (e) => e.status === 409);

  const reopened = store.act(id, 'reopen', { name: 'Lee' });
  assert.strictEqual(reopened.status, 'pending');
  assert.throws(() => store.act(id, 'reopen', { name: 'Lee' }), (e) => e.status === 409 && /already open/.test(e.message));

  const denied = store.act(id, 'deny', { name: 'Pat', note: 'the cat stays' });
  assert.strictEqual(denied.status, 'denied');
  assert.deepStrictEqual(denied.history.map((h) => [h.action, h.by]), [
    ['filed', 'Dana'], ['approved', 'Sam'], ['reopened', 'Lee'], ['denied', 'Pat'],
  ]);
});

test('acting needs a name, a real request, and a known action', () => {
  const store = createChangeStore(tmpFile());
  const { id } = store.create(ask());
  assert.throws(() => store.act(id, 'approve', { name: '' }), /required/);
  assert.throws(() => store.act('CR-9999', 'approve', { name: 'Sam' }), (e) => e.status === 404);
  assert.throws(() => store.act(id, 'delete', { name: 'Sam' }), (e) => e.status === 400);
  assert.strictEqual(store.list()[0].status, 'pending');
});

test('the log survives a restart, and numbering carries on', () => {
  const file = tmpFile();
  const first = createChangeStore(file);
  const { id } = first.create(ask());
  first.act(id, 'deny', { name: 'Sam' });
  const second = createChangeStore(file);
  assert.strictEqual(second.list()[0].status, 'denied');
  assert.strictEqual(second.create(ask()).id, 'CR-0002');
});

test('an unreadable log file is set aside, not overwritten', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ not json');
  const store = createChangeStore(file);
  assert.strictEqual(store.list().length, 0);
  store.create(ask());
  const kept = fs.readdirSync(path.dirname(file)).filter((f) => f.includes('.corrupt-'));
  assert.strictEqual(kept.length, 1);
});

test('a failed save leaves nothing half-done in memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-changes-'));
  const file = path.join(dir, 'changes.json');
  const store = createChangeStore(file);
  store.create(ask());
  fs.mkdirSync(`${file}.tmp`); // a directory where the temp file should go makes every save fail
  assert.throws(() => store.create(ask()), /Could not save/);
  assert.throws(() => store.act('CR-0001', 'approve', { name: 'Sam' }), /Could not save/);
  fs.rmdirSync(`${file}.tmp`);
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.list()[0].status, 'pending');
  assert.strictEqual(store.list()[0].history.length, 1);
});

test('an unreadable log never blocks startup and is never overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-changes-'));
  const file = path.join(dir, 'changes.json');
  fs.mkdirSync(file); // a directory where the file should be: reading it fails with something other than "not found"
  const quiet = console.error;
  console.error = () => {};
  let store;
  try { store = createChangeStore(file); } finally { console.error = quiet; }
  assert.deepStrictEqual(store.list(), []);
  assert.throws(() => store.create(ask()), (e) => e.status === 503);
  assert.throws(() => store.act('CR-0001', 'approve', { name: 'Sam' }), (e) => e.status === 503);
  assert.ok(fs.statSync(file).isDirectory()); // untouched
});

/* ---------- the HTTP layer ---------- */

async function serve(options = {}) {
  const store = createChangeStore(tmpFile());
  const router = createChangesRouter({ store, ...options });
  const app = express();
  app.use(express.json());
  app.use('/api/changes', router);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message })); // eslint-disable-line no-unused-vars
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/changes`;
  const call = (suffix, body, ip = '10.0.0.1') =>
    fetch(base + suffix, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: body ? JSON.stringify(body) : undefined,
    });
  const close = () => { router.closeStreams(); server.closeAllConnections(); server.close(); };
  return { base, call, close };
}

test('file, list, approve, and reopen over HTTP', async () => {
  const { call, close } = await serve();
  try {
    const filed = await call('/', ask());
    assert.strictEqual(filed.status, 201);
    const { request } = await filed.json();

    const list = await (await call('/')).json();
    assert.strictEqual(list.requests.length, 1);

    const ok = await call(`/${request.id}/approve`, { name: 'Sam' });
    assert.strictEqual((await ok.json()).request.status, 'approved');

    const again = await call(`/${request.id}/approve`, { name: 'Lee' });
    assert.strictEqual(again.status, 409);
    assert.match((await again.json()).error, /Already approved/);

    const back = await call(`/${request.id}/reopen`, { name: 'Lee' });
    assert.strictEqual((await back.json()).request.status, 'pending');
  } finally { close(); }
});

test('bad input comes back as a 400 with a plain message, and ids are checked', async () => {
  const { call, close } = await serve();
  try {
    const bad = await call('/', ask({ impact: '' }));
    assert.strictEqual(bad.status, 400);
    assert.match((await bad.json()).error, /Impact is required/);
    assert.strictEqual((await call('/not-an-id/approve', { name: 'Sam' })).status, 404);
  } finally { close(); }
});

test('the honeypot field fakes success and files nothing', async () => {
  const { call, close } = await serve();
  try {
    const res = await call('/', ask({ website: 'http://spam.example' }));
    assert.strictEqual(res.status, 201);
    assert.strictEqual((await (await call('/')).json()).requests.length, 0);
  } finally { close(); }
});

test('filing is rate limited per visitor, and only successful filings count', async () => {
  const { call, close } = await serve({ filing: { windowMs: 60_000, max: 2 } });
  try {
    for (let i = 0; i < 5; i++) assert.strictEqual((await call('/', ask({ impact: '' }))).status, 400); // typos are free
    assert.strictEqual((await call('/', ask())).status, 201);
    assert.strictEqual((await call('/', ask())).status, 201);
    const blocked = await call('/', ask());
    assert.strictEqual(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.strictEqual((await call('/', ask(), '10.0.0.2')).status, 201); // someone else is unaffected
  } finally { close(); }
});

test('open streams are told about changes the moment they happen', async () => {
  const { base, call, close } = await serve();
  try {
    const seen = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no event within 3s')), 3000);
      const req = http.get(`${base}/stream`, (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        assert.strictEqual(res.headers['x-accel-buffering'], 'no');
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          if (buf.includes('event: hello') && !buf.includes('event: upsert')) call('/', ask({ change: 'Live one' }));
          if (buf.includes('event: upsert')) { clearTimeout(timer); req.destroy(); resolve(buf); }
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    });
    const data = JSON.parse(seen.split('event: upsert\ndata: ')[1].split('\n')[0]);
    assert.strictEqual(data.change, 'Live one');
    assert.strictEqual(data.status, 'pending');
  } finally { close(); }
});
