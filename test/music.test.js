'use strict';

const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../public/js/music.js');

test('the vibes are pools of real-looking public playlists, and one is picked at random', async () => {
  const M = await load();
  assert.ok(M.VIBES.length >= 12, 'the eleven asked for, and a shuffle');
  assert.strictEqual(new Set(M.VIBES.map((v) => v.id)).size, M.VIBES.length, 'unique ids');
  for (const v of M.VIBES) {
    assert.ok(v.name && v.sub, `${v.id}: named`);
    assert.ok(v.lists.length >= (v.id === 'tinydesk' ? 3 : 3), `${v.id}: a few playlists to pick from, so it is not the same every time`);
    for (const [list, n] of v.lists) {
      assert.match(list, /^PL[\w-]{10,40}$/, `${v.id}: a YouTube playlist id`);
      assert.ok(n >= 10, `${v.id}: ten or more videos`);
    }
  }
  for (const want of ['mix', 'jazz', 'steely', 'ween', 'hiphop', 'doom', 'altrock', 'tinydesk', 'lofi', 'khruangbin', 'indie', 'altcountry']) assert.ok(M.VIBES.some((v) => v.id === want), want);
  const real = M.VIBES.filter((v) => v.id !== 'mix');
  assert.strictEqual(new Set(real.flatMap((v) => v.lists.map((l) => l[0]))).size, real.flatMap((v) => v.lists).length, 'no playlist is in two vibes');
  assert.strictEqual(M.VIBES.find((v) => v.id === 'mix').lists.length, real.flatMap((v) => v.lists).length, 'the shuffle draws from all of them');
  // a pick is one of the vibe's own, and different rolls give different ones
  const jazz = M.vibeById('jazz');
  const seen = new Set();
  for (let i = 0; i < 40; i++) { const c = M.chooseList(jazz, () => (i * 0.37) % 1); assert.ok(jazz.lists.some((l) => l[0] === c.list)); seen.add(c.list); }
  assert.ok(seen.size > 1, 'not always the same playlist');
});

test('volume stays between 0 and 100, and an unknown vibe is the first', async () => {
  const M = await load();
  assert.strictEqual(M.clampVolume(-5), 0);
  assert.strictEqual(M.clampVolume(250), 100);
  assert.strictEqual(M.clampVolume('42.4'), 42);
  assert.strictEqual(M.clampVolume('loud'), 0);
  assert.strictEqual(M.vibeById('nope').id, M.VIBES[0].id);
  assert.strictEqual(M.vibeById('ween').id, 'ween');
});
