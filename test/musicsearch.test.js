'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const { createSearcher, parseResults, about, words, seconds } = require('../server/lib/musicsearch');
const { createMusicRouter } = require('../server/routes/music');

// a YouTube results page, as far as the parser cares: the JSON in ytInitialData
const pageOf = (items) => `<html><script>var ytInitialData = ${JSON.stringify({ contents: { items } })};</script></html>`;
const playlist = (id, title, count) => ({ playlistRenderer: { playlistId: id, title: { simpleText: title }, videoCount: String(count) } });
const video = (id, title, len) => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ...(len ? { lengthText: { simpleText: len } } : {}) } });

// a YouTube that answers from a table: results pages by their filter, and the embed check by a list of ids it refuses
function fakeYouTube({ playlists = [], videos = [], blocked = [] } = {}) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/oembed') {
      const target = decodeURIComponent(u.searchParams.get('url'));
      return { ok: !blocked.some((b) => target.includes(b)) };
    }
    const sp = u.searchParams.get('sp');
    return { ok: true, text: async () => pageOf(sp.includes('Aw') ? playlists : videos) };
  };
  return { fetchFn, calls };
}

test('the parser finds playlists and videos in a results page, once each, and reads lengths', () => {
  const out = parseResults(pageOf([playlist('PL1', 'Best of X', 30), playlist('PL1', 'Best of X', 30), video('abcdefghijk', 'X - Song', '3:45'), video('live1234567', 'X live', null)]));
  assert.deepStrictEqual(out.map((r) => [r.type, r.id]), [['playlist', 'PL1'], ['video', 'abcdefghijk'], ['video', 'live1234567']]);
  assert.strictEqual(out[0].count, 30);
  assert.strictEqual(out[1].secs, 225);
  assert.strictEqual(out[2].live, true);
  assert.deepStrictEqual(parseResults('<html>nothing</html>'), []);
  assert.strictEqual(seconds('1:02:03'), 3723);
});

test('a playlist counts as about the search when it shares half the words that carry meaning', () => {
  assert.ok(about('steely dan', 'Steely Dan - The Very Best Of'));
  assert.ok(about('khruangbin', 'Khruangbin Playlist - The Best of Khruangbin'));
  assert.ok(!about('steely dan', 'Fleetwood Mac Greatest Hits'));
  assert.ok(about('rainy day jazz', 'Rainy Jazz Cafe'));
  assert.deepStrictEqual(words('The Best of Ween!'), ['ween']);
});

test('a playlist that is about the search, and can be embedded, is played; else a mix of the top videos', async () => {
  const yt = fakeYouTube({ playlists: [playlist('PLnope', 'Other Band', 50), playlist('PLgood', 'Ween - Best Of', 60)], videos: [video('v1________', 'Ween - Push th Little Daisies', '3:00')] });
  const hit = await createSearcher({ fetchFn: yt.fetchFn }).search('ween');
  assert.deepStrictEqual(hit, { kind: 'playlist', list: 'PLgood', n: 60, title: 'Ween - Best Of' });
  // the playlist is not embeddable: the videos
  const blocked = fakeYouTube({ playlists: [playlist('PLgood', 'Ween - Best Of', 60)], videos: [video('v1________', 'Ween - A', '3:00'), video('v2________', 'Ween - B', '4:00'), video('v3________', 'Ween - C', '4:10')], blocked: ['PLgood', 'v2________'] });
  const mix = await createSearcher({ fetchFn: blocked.fetchFn }).search('ween');
  assert.strictEqual(mix.kind, 'videos');
  assert.deepStrictEqual(mix.ids, ['v1________', 'v3________'], 'the one that cannot be embedded is left out, the top one stays first');
  assert.strictEqual(mix.title, 'Ween - A');
});

test('lives, tiny clips and ten-hour loops are not picked, and nothing found is null', async () => {
  const yt = fakeYouTube({ videos: [video('live1234567', 'live', null), video('short123456', 'clip', '0:30'), video('loop1234567', 'loop', '10:00:00'), video('good1234567', 'a song', '3:30')] });
  const r = await createSearcher({ fetchFn: yt.fetchFn }).search('whatever');
  assert.deepStrictEqual(r.ids, ['good1234567']);
  assert.strictEqual(await createSearcher({ fetchFn: fakeYouTube().fetchFn }).search('zzz qqq'), null);
  assert.strictEqual(await createSearcher({ fetchFn: fakeYouTube().fetchFn }).search('   '), null);
  assert.strictEqual(await createSearcher({ fetchFn: async () => { throw new Error('down'); } }).search('anything'), null, 'YouTube being down is just nothing found');
});

test('the same words are answered from the cache, not asked of YouTube again', async () => {
  const yt = fakeYouTube({ videos: [video('good1234567', 'a song', '3:30')] });
  let t = 1000;
  const s = createSearcher({ fetchFn: yt.fetchFn, now: () => t });
  await s.search('Cached Words');
  const n = yt.calls.length;
  await s.search('cached   words');
  assert.strictEqual(yt.calls.length, n, 'the second time costs nothing');
  t += 7 * 3600_000;
  await s.search('cached words');
  assert.ok(yt.calls.length > n, 'after six hours it asks again');
});

test('the route: a search needs words, is limited per visitor, and says when nothing was found', async () => {
  const yt = fakeYouTube({ videos: [video('good1234567', 'a song', '3:30')] });
  const app = express();
  app.use('/api/music', createMusicRouter({ searcher: createSearcher({ fetchFn: yt.fetchFn }), limits: { windowMs: 60_000, max: 3 } }));
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = (q) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: `/api/music/search${q}` }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    }).on('error', reject);
  });
  try {
    assert.strictEqual((await get('')).status, 400);
    assert.strictEqual((await get(`?q=${'x'.repeat(81)}`)).status, 400, 'eighty letters at most');
    const ok = await get('?q=a+song');
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(ok.body.ids, ['good1234567']);
    assert.strictEqual((await get('?q=nothing')).status, 200);
    assert.strictEqual((await get('?q=third+one')).status, 200, 'three searches are allowed');
    assert.strictEqual((await get('?q=again')).status, 429, 'the fourth search in a minute is turned away');
  } finally { server.close(); }
});
