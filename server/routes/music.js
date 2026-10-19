'use strict';

const express = require('express');
const { createLimiter } = require('../lib/ratelimit');
const { who } = require('../lib/http');
const { createSearcher } = require('../lib/musicsearch');

/**
 * The game's music search. Mounted at /api/music. No sign-in (solo play has none).
 *   GET /search?q=radiohead   -> { kind: 'playlist', list, n, title } or { kind: 'videos', ids, title }; 404 when nothing playable was found
 * A visitor gets 40 searches an hour; answers are cached for six hours, so the same words do not go back to YouTube.
 */
function createMusicRouter({ searcher = createSearcher(), limits = { windowMs: 60 * 60 * 1000, max: 40 } } = {}) {
  const router = express.Router();
  const limit = createLimiter(limits);
  router.get('/search', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q || q.length > 80) return res.status(400).json({ error: 'Type something to search for (80 letters at most).' });
      const verdict = limit.peek(who(req));
      if (!verdict.ok) { res.set('Retry-After', String(verdict.retryAfterSec)); return res.status(429).json({ error: 'That is a lot of searches. Try again in a bit.' }); }
      limit.hit(who(req));
      const found = await searcher.search(q);
      if (!found) return res.status(404).json({ error: 'Nothing playable for that. Try other words.' });
      res.json(found);
    } catch (err) { next(err); }
  });
  return router;
}

module.exports = { createMusicRouter };
