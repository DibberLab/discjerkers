'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the quick-play page (/play) is walled off: no site header, no links out, no cart script, and not indexed', () => {
  const html = read('public/play.html');
  assert.match(html, /<body[^>]*data-quick/);
  assert.match(html, /name="robots" content="noindex/);
  assert.doesNotMatch(html, /masthead/);
  assert.doesNotMatch(html, /site\.js/);
  assert.doesNotMatch(html, /<a\s/i, 'nothing on the page links to the rest of the site');
  // it runs the same game, at the same version as the main page
  const ver = (h) => h.match(/\/js\/game\.js\?v=(\d+)/)[1];
  assert.strictEqual(ver(html), ver(read('public/game.html')));
});

test('the quick bag: a putter, a midrange, two fairway drivers and two distance drivers, all in the disc list', () => {
  const guide = JSON.parse(read('public/data/flightguide.json'));
  const src = read('public/js/game.js');
  const names = src.match(/const QUICK_BAG = \[([^\]]*)\]/)[1].split(',').map((n) => n.trim().replace(/'/g, ''));
  assert.strictEqual(names.length, 6);
  const speeds = names.map((n) => {
    const rows = guide.discs.filter((r) => r[1] === n);
    assert.strictEqual(rows.length, 1, `${n} is one disc in the list`);
    return rows[0][4];
  });
  const kinds = speeds.map((s) => (s <= 4 ? 'putter' : s <= 6 ? 'mid' : s <= 9 ? 'fairway' : 'distance'));
  assert.deepStrictEqual(kinds.sort(), ['distance', 'distance', 'fairway', 'fairway', 'mid', 'putter']);
});
