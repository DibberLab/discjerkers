'use strict';

/* Find something to play for a search. A browser cannot ask YouTube for search results (no key, no CORS), so the server reads YouTube's public search page the way a
   browser would and picks: a playlist that is really about the words searched (if there is a good one), else the top few videos that can be embedded, played as a
   mix (the one searched for first, then what is close to it). Nothing here is stored but a short-lived cache, and everything it returns has passed YouTube's own embed
   check. It has no key and no account, so it can break if YouTube changes its page: then the route says nothing was found and the game goes on. */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const PLAYLISTS = 'EgIQAw%253D%253D'; // YouTube's own filters: playlists only, and videos only
const VIDEOS = 'EgIQAQ%253D%253D';
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'music', 'song', 'songs', 'playlist', 'best', 'mix', 'full', 'official', 'video', 'new', 'top', 'greatest', 'hits']);

const words = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
const text = (t) => (t?.simpleText ?? (t?.runs || []).map((r) => r.text).join('')) || '';
const seconds = (len) => String(len || '').split(':').reduce((n, p) => n * 60 + (Number(p) || 0), 0);

/** Everything in a YouTube results page that is a playlist or a video: [{ type, id, title, count?, secs? }]. */
function parseResults(html) {
  const m = /var ytInitialData = (\{.*?\});<\/script>/s.exec(html || '');
  if (!m) return [];
  let data;
  try { data = JSON.parse(m[1]); } catch { return []; }
  const out = [];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    if (o.playlistRenderer?.playlistId) out.push({ type: 'playlist', id: o.playlistRenderer.playlistId, title: text(o.playlistRenderer.title), count: Number(String(o.playlistRenderer.videoCount || '').replace(/,/g, '')) || 0 });
    if (o.videoRenderer?.videoId) out.push({ type: 'video', id: o.videoRenderer.videoId, title: text(o.videoRenderer.title), secs: seconds(o.videoRenderer.lengthText?.simpleText), live: !o.videoRenderer.lengthText });
    Object.values(o).forEach(walk);
  };
  walk(data);
  const seen = new Set();
  return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

// is a playlist's title about what was searched? (at least half of the words that carry meaning)
const about = (query, title) => {
  const want = words(query);
  if (!want.length) return false;
  const have = new Set(words(title));
  return want.filter((w) => have.has(w)).length >= Math.max(1, Math.ceil(want.length / 2));
};

function createSearcher({ fetchFn = globalThis.fetch, now = Date.now } = {}) {
  const get = async (url) => {
    const res = await fetchFn(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US' }, signal: AbortSignal.timeout(7000) });
    return res.ok ? res.text() : '';
  };
  const page = (q, sp) => get(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}`).catch(() => '');
  // YouTube's embed check: 200 when it may be played in someone else's page
  const embeddable = async (kind, id) => {
    const url = kind === 'video' ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/playlist?list=${id}`;
    try {
      const res = await fetchFn(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) });
      return res.ok;
    } catch { return false; }
  };
  const cache = new Map(); // query -> { at, result }
  const TTL = 6 * 3600_000;

  /** { kind: 'playlist', list, n, title } | { kind: 'videos', ids, title } | null */
  async function search(raw) {
    const q = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!q) return null;
    const key = q.toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL) return hit.result;
    const [pl, vd] = await Promise.all([page(q, PLAYLISTS), page(q, VIDEOS)]);
    let result = null;
    for (const p of parseResults(pl).filter((r) => r.type === 'playlist').slice(0, 6)) {
      if (!about(q, p.title) || p.count < 8) continue;
      if (await embeddable('playlist', p.id)) { result = { kind: 'playlist', list: p.id, n: p.count, title: p.title }; break; }
    }
    if (!result) {
      const vids = parseResults(vd).filter((r) => r.type === 'video' && !r.live && r.secs >= 60 && r.secs <= 3 * 3600).slice(0, 16);
      const ok = await Promise.all(vids.map((v) => embeddable('video', v.id)));
      const good = vids.filter((_, i) => ok[i]).slice(0, 12);
      if (good.length) result = { kind: 'videos', ids: good.map((v) => v.id), title: good[0].title };
    }
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), result });
    return result;
  }
  return { search };
}

module.exports = { createSearcher, parseResults, about, words, seconds };
