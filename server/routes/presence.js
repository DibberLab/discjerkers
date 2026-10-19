'use strict';

const express = require('express');
const { createLimiter } = require('../lib/ratelimit');
const { who } = require('../lib/http');
const { createPresence } = require('../lib/presence');

const ID = /^[a-z0-9]{8,40}$/i;

/**
 * The "playing now" footnote. Mounted at /api/presence.
 *   POST /  { id }              -> { online }   (this page is here; says hello every 20 s)
 *   POST /  { id, leave: true } -> { online }   (this page is closing)
 *   GET  /                      -> { online }
 */
function createPresenceRouter({ presence = createPresence(), limits = { windowMs: 60_000, max: 90 } } = {}) {
  const router = express.Router();
  const limit = createLimiter(limits);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const verdict = limit.peek(who(req));
    if (!verdict.ok) { res.set('Retry-After', String(verdict.retryAfterSec)); return res.status(429).json({ error: 'Slow down.' }); }
    limit.hit(who(req));
    next();
  });
  router.get('/', (req, res) => res.json({ online: presence.count() }));
  router.post('/', (req, res) => {
    const { id, leave } = req.body || {};
    if (typeof id !== 'string' || !ID.test(id)) return res.status(400).json({ error: 'Bad id.' });
    if (leave) presence.leave(id); else presence.ping(id);
    res.json({ online: presence.count() });
  });
  return router;
}

module.exports = { createPresenceRouter };
