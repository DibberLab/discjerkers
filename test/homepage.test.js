'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { homepageHtml, LOGO } = require('../server/lib/homepage');

const PUBLIC = path.join(__dirname, '..', 'public');

test('the home page stamps the logo with a hash of the file, and a new file gets a new stamp', () => {
  const html = homepageHtml(PUBLIC);
  assert.match(html, /\/img\/disc-jerkers-logo\.png\?v=[0-9a-f]{10}"/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-home-'));
  fs.mkdirSync(path.join(dir, 'img'));
  fs.copyFileSync(path.join(PUBLIC, 'index.html'), path.join(dir, 'index.html'));
  fs.writeFileSync(path.join(dir, LOGO), 'one');
  const a = homepageHtml(dir).match(/disc-jerkers-logo\.png\?v=(\w+)/)[1];
  fs.writeFileSync(path.join(dir, LOGO), 'two');
  const b = homepageHtml(dir).match(/disc-jerkers-logo\.png\?v=(\w+)/)[1];
  assert.notStrictEqual(a, b);

  fs.rmSync(path.join(dir, LOGO));
  assert.ok(homepageHtml(dir).includes('/img/disc-jerkers-logo.png'), 'no logo file: the page still serves');
});
