'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { createPresence } = require('../server/lib/presence');
const { createPresenceRouter } = require('../server/routes/presence');

test('presence counts the pages that said hello lately, and forgets the silent ones', () => {
  let t = 1000;
  const p = createPresence({ ttlMs: 45_000, now: () => t });
  p.ping('aaaaaaaa'); p.ping('bbbbbbbb'); p.ping('aaaaaaaa');
  assert.strictEqual(p.count(), 2, 'the same page twice is one');
  t += 30_000;
  p.ping('aaaaaaaa'); // still here
  t += 30_000; // bbbbbbbb has been quiet for 60 s
  assert.strictEqual(p.count(), 1);
  p.leave('aaaaaaaa');
  assert.strictEqual(p.count(), 0);
});

test('presence does not grow without end', () => {
  const p = createPresence({ max: 3 });
  for (const id of ['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd', 'eeeeeeee']) p.ping(id);
  assert.strictEqual(p.count(), 3);
});

test('the presence route: hello, goodbye, a bad id, and a hammering visitor', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/presence', createPresenceRouter({ limits: { windowMs: 60_000, max: 6 } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/presence`;
  const send = (body) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepStrictEqual(await (await send({ id: 'abcdefgh1' })).json(), { online: 1 });
    assert.deepStrictEqual(await (await send({ id: 'zzzzzzzz2' })).json(), { online: 2 });
    assert.strictEqual((await send({ id: 'no spaces allowed' })).status, 400);
    assert.deepStrictEqual(await (await send({ id: 'abcdefgh1', leave: true })).json(), { online: 1 });
    assert.deepStrictEqual(await (await fetch(base)).json(), { online: 1 });
    assert.strictEqual((await fetch(base)).status, 200);
    assert.strictEqual((await fetch(base)).status, 429, 'the seventh hello in a minute is turned away');
  } finally {
    server.close();
  }
});
