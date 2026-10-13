'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const path = require('node:path');

const load = () => import('../public/js/trash.js');
const heckles = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'heckles.json'), 'utf8'));

test('every line is a real sentence with its blanks filled, and nobody is named who should not be', async () => {
  const T = await load();
  const all = [];
  const walk = (o) => { for (const v of Object.values(o)) (Array.isArray(v) ? v.forEach((l) => all.push(l)) : walk(v)); };
  walk(T.LINES);
  assert.ok(all.length > 80, `a decent number of lines: ${all.length}`);
  assert.strictEqual(new Set(all).size, all.length, 'no line is written twice');
  for (const l of all) {
    assert.ok(typeof l === 'string' && l.length > 12 && l.length < 140, `a sensible line: ${l}`);
    assert.ok(!/\b(Andrew|Jon|Mike)\b/.test(l), `no crew member names: ${l}`); // the brand rule: the mascot is the only name on the site
  }
  // every {blank} is one the caller fills
  for (const l of all) for (const m of l.matchAll(/\{(\w+)\}/g)) assert.ok(['name'].includes(m[1]), `an unknown blank in: ${l}`);
  assert.strictEqual(T.pick(['hi {name}'], { name: 'Ben' }, () => 0), 'hi Ben');
});

test('a throw is classified, and only the notable ones get a remark', async () => {
  const T = await load();
  const base = { kind: 'landed', putt: false, ex: { grade: 'Good' }, strokes: 1, surface: 'fairway' };
  assert.strictEqual(T.eventFor({ ...base, ex: { slip: 'grip' } }), 'grip');
  assert.strictEqual(T.eventFor({ ...base, ex: { slip: 'early' } }), 'early');
  assert.strictEqual(T.eventFor({ ...base, ex: { grade: 'Shank' } }), 'shank');
  assert.strictEqual(T.eventFor({ ...base, kind: 'tree' }), 'tree');
  assert.strictEqual(T.eventFor({ ...base, kind: 'water' }), 'water');
  assert.strictEqual(T.eventFor({ ...base, kind: 'oob' }), 'oob');
  assert.strictEqual(T.eventFor({ ...base, kind: 'basket', strokes: 1 }), 'ace');
  assert.strictEqual(T.eventFor({ ...base, kind: 'basket', strokes: 3 }), 'chains');
  assert.strictEqual(T.eventFor({ ...base, ex: { pure: true, grade: 'Pure' } }), 'pure');
  assert.strictEqual(T.eventFor({ ...base, surface: 'rough' }), 'rough');
  assert.strictEqual(T.eventFor(base), null, 'a plain throw is nothing to talk about');
  assert.strictEqual(T.eventFor({ kind: 'landed', putt: true, made: false, dist: 20 }), 'rim');
  assert.strictEqual(T.eventFor({ kind: 'landed', putt: true, made: false, dist: 42 }), 'longMiss');
  assert.strictEqual(T.eventFor({ kind: 'basket', putt: true, made: true, dist: 42 }), 'sunk');
  assert.strictEqual(T.eventFor({ kind: 'basket', putt: true, made: true, dist: 12 }), null);
  assert.strictEqual(T.eventFor({ kind: 'basket', putt: true, made: true, gimme: true, dist: 2 }), null);

  assert.strictEqual(T.remark(null).text, '');
  assert.ok(T.remark('water', { who: 'me' }, () => 0).text.length > 0, 'a splash always gets one');
  assert.strictEqual(T.remark('rough', { who: 'me' }, () => 0.99).text, '', 'and a rough lie only now and then');
  const theirs = T.remark('tree', { who: 'them', name: 'Ben' }, () => 0);
  assert.match(theirs.text, /Ben/, 'what happens to someone else names them');
  assert.ok(!/\{/.test(theirs.text));
});

test('she does not repeat herself, and a hole and a match each have something to say', async () => {
  const T = await load();
  let last = '';
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const l = T.remark('water', { who: 'me' }, () => (i % 5) / 5, last).text;
    assert.notStrictEqual(l, last, 'never the same line twice in a row');
    seen.add(l);
    last = l;
  }
  assert.ok(seen.size >= 3, 'she varies');
  for (const [strokes, par, holed] of [[1, 3, true], [2, 4, true], [3, 4, true], [4, 4, true], [5, 4, true], [6, 4, true], [9, 4, true], [20, 4, false]]) {
    assert.ok(T.holeRemark(strokes, par, holed, () => 0).length > 10, `a hole in ${strokes} on a par ${par}`);
  }
  for (const k of ['holeWin', 'holeLose', 'holeShare', 'win', 'lose', 'tie', 'left']) assert.ok(T.matchRemark(k, { name: 'Dee' }, () => 0).length > 10, k);
  assert.match(T.bearRemark(false, 'Dee', () => 0), /Dee/);
});

test('the owner\'s own heckles (the CSV) are what she says about trees, water and the score of a hole', async () => {
  const T = await load();
  const data = heckles();
  assert.deepStrictEqual(Object.keys(data).sort(), ['Birdie', 'Bogey', 'Double Bogey', 'Eagle', 'Going in the Water', 'Hitting a Tree', 'Par']);
  for (const [cat, lines] of Object.entries(data)) {
    assert.ok(lines.length >= 25, `${cat}: ${lines.length} lines`);
    assert.strictEqual(new Set(lines).size, lines.length, `${cat}: no repeats`);
    for (const l of lines) assert.ok(typeof l === 'string' && l.length > 20 && l.length < 200 && !/\{/.test(l), `${cat}: ${l}`);
  }
  T.useHeckles(data);
  try {
    assert.ok(data['Hitting a Tree'].includes(T.remark('tree', { who: 'me' }, () => 0).text), 'a tree: from the CSV');
    assert.ok(data['Going in the Water'].includes(T.remark('water', { who: 'me' }, () => 0).text), 'water: from the CSV');
    const aimed = T.remark('tree', { who: 'them', name: 'Dee' }, () => 0);
    assert.ok(data['Hitting a Tree'].includes(aimed.text) && aimed.to === 'Dee', 'about somebody else: aimed at them by name');
    assert.strictEqual(T.remark('tree', { who: 'me' }, () => 0).to, '');
    const hole = (strokes, par) => T.holeRemark(strokes, par, true, () => 0);
    assert.ok(data.Birdie.includes(hole(3, 4)));
    assert.ok(data.Par.includes(hole(4, 4)));
    assert.ok(data.Bogey.includes(hole(5, 4)));
    assert.ok(data['Double Bogey'].includes(hole(6, 4)) && data['Double Bogey'].includes(hole(9, 4)), 'a double or worse');
    assert.ok(data.Eagle.includes(hole(2, 4)) && data.Eagle.includes(hole(1, 3)), 'an eagle or an ace');
    assert.strictEqual(T.remark('oob', { who: 'me' }, () => 0).text.length > 0, true, 'and the events the CSV does not cover still get her own lines');
  } finally { T.useHeckles({}); }
});
