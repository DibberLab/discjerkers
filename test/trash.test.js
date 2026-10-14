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
  assert.strictEqual(T.eventFor({ kind: 'landed', putt: true, made: false, dist: 12, nasty: true }), 'nasty', 'a nasty roll gets its own remark');
  assert.strictEqual(T.eventFor({ kind: 'landed', putt: true, made: false, dist: 12, rim: true }), 'rim');
  assert.ok(T.remark('nasty', { who: 'me' }, () => 0).text.length > 10 && /Dee/.test(T.remark('nasty', { who: 'them', name: 'Dee' }, () => 0).text));

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
  assert.deepStrictEqual(Object.keys(data).sort(), ['Birdie', 'Bogey', 'Double Bogey', 'Eagle', 'Early Releases', 'Going in the Water', 'Grip Locks', 'Hitting a Tree', 'Match Results', 'Out of Bounds', 'Par', 'Rimmed Putts', 'Shanks']);
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
    for (const [event, cat] of [['shank', 'Shanks'], ['grip', 'Grip Locks'], ['early', 'Early Releases'], ['oob', 'Out of Bounds'], ['rim', 'Rimmed Putts']]) {
      assert.ok(data[cat].includes(T.remark(event, { who: 'me' }, () => 0).text), `${event}: from the CSV`);
      assert.strictEqual(T.remark(event, { who: 'them', name: 'Dee' }, () => 0).to, 'Dee', `${event}: aimed at whoever threw`);
    }
    assert.ok(data['Match Results'].includes(T.matchRemark('lose', { name: 'Dee' }, () => 0)), 'losing a match: from the CSV');
    assert.ok(!data['Match Results'].includes(T.matchRemark('win', { name: 'Dee' }, () => 0)), 'but winning is not an insult');
    assert.strictEqual(T.remark('longMiss', { who: 'me' }, () => 0).text.length > 0, true, 'and the events the CSV does not cover still get her own lines');
  } finally { T.useHeckles({}); }
});

test('she does not repeat herself: with a memory, she says every line of a list before saying any again', async () => {
  const T = await load();
  const list = Array.from({ length: 9 }, (_, i) => `Line number ${i} of the list.`);
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  T.useMemory([]);
  try {
    let last = '';
    for (let round = 0; round < 4; round++) {
      const got = [];
      for (let i = 0; i < list.length; i++) { const l = T.pick(list, {}, rnd, last); got.push(l); last = l; }
      assert.strictEqual(new Set(got).size, list.length, `round ${round}: every line once, none twice: ${got.map((g) => g.slice(12, 14)).join(',')}`);
    }
    // never the line she just said, even when the list starts over
    T.useMemory([]);
    let prev = '';
    for (let i = 0; i < 60; i++) { const l = T.pick(list, {}, rnd, prev); assert.notStrictEqual(l, prev); prev = l; }
    // a memory can be kept between visits
    T.useMemory([]);
    const first = T.pick(list, {}, () => 0);
    const kept = T.memory();
    assert.strictEqual(kept.length, 1);
    T.useMemory(kept);
    const rest = new Set(Array.from({ length: 8 }, () => T.pick(list, {}, rnd)));
    assert.ok(!rest.has(first) && rest.size === 8, 'a fresh page remembers what she said');
    T.useMemory(['junk', null, 5]);
    assert.deepStrictEqual(T.memory(), [5]);
    // a real list, through the real functions: ten holes' worth of remarks about the water, no line twice
    T.useMemory([]);
    T.useHeckles(heckles());
    const pool = heckles()['Going in the Water'].length;
    const seen = [];
    for (let i = 0; i < pool; i++) { const r = T.remark('water', { who: 'me' }, () => 0.3 + (i % 3) * 0.2, seen.at(-1) || ''); if (r.text) seen.push(r.text); }
    assert.strictEqual(new Set(seen).size, seen.length, `no repeats until her ${pool} lines about water have all been said`);
    assert.ok(seen.length >= pool - 1);
    T.useHeckles({});
  } finally { T.forget(); }
  // with no memory (a test, the server) she still never says the line she just said
  const a = T.pick(['one a', 'two b'], {}, () => 0, 'one a');
  assert.strictEqual(a, 'two b');
});

test('she has plenty to say: deep pools for every event, and her own lines for goals', async () => {
  const T = await load();
  for (const [k, v] of Object.entries(T.LINES.MINE)) assert.ok(v.length >= 8, `${k}: ${v.length} lines of hers about your throw`);
  for (const [k, v] of Object.entries(T.LINES.THEIRS)) assert.ok(v.length >= 6, `${k}: ${v.length} lines about theirs`);
  for (const [k, v] of Object.entries(T.LINES.HOLE)) assert.ok(v.length >= 6, `hole ${k}: ${v.length}`);
  for (const [k, v] of Object.entries(T.LINES.MATCH)) assert.ok(v.length >= 5, `match ${k}: ${v.length}`);
  for (const [k, v] of Object.entries(T.LINES.BETTING)) assert.ok(v.length >= 8, `betting ${k}: ${v.length}`);
  for (const [k, b] of Object.entries(T.BETS)) assert.ok(b.offer.length >= 5, `bet offers ${k}`);
  const every = [...T.GOAL_SKIN, ...T.GOAL_PLAIN];
  assert.strictEqual(new Set(every).size, every.length);
  for (const l of every) {
    assert.ok(l.length > 12 && l.length < 140, l);
    for (const m of l.matchAll(/\{(\w+)\}/g)) assert.ok(['title', 'skin'].includes(m[1]), l);
  }
  assert.match(T.goalLine('Eagle', 'Gold', () => 0), /Eagle/);
  assert.match(T.goalLine('Eagle', 'Gold', () => 0), /Gold/);
  assert.doesNotMatch(T.goalLine('Eagle', null, () => 0), /\{/);
  // the owner's lines and hers are one pool, so on a throw with both she draws from all of them
  T.useHeckles({ 'Going in the Water': ['Your owner line number one.'] });
  const got = new Set();
  for (let i = 0; i < 200; i++) got.add(T.remark('water', { who: 'me' }, () => (i * 0.137) % 1).text);
  assert.ok(got.has('Your owner line number one.') && got.size > 8, `owner lines and hers: ${got.size}`);
  const them = T.remark('water', { who: 'them', name: 'Ben' }, () => 0);
  assert.ok(them.text.length > 10);
  T.useHeckles({});
});
