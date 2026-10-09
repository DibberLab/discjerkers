'use strict';

const express = require('express');
const { ChangeError, LIMITS } = require('../lib/changes');
const { createLimiter } = require('../lib/ratelimit');

const HOUR = 60 * 60 * 1000;
const MAX_WATCHERS = 300;
const KEEPALIVE_MS = 15_000;

// nginx sets X-Real-IP from the Cloudflare-restored client address; a visitor can't forge it.
const who = (req) => req.get('x-real-ip') || req.ip || 'unknown';

/**
 * Change-control routes. Mounted at /api/changes.
 *   GET  /            the whole log
 *   GET  /stream      server-sent events: every change, pushed as it happens
 *   POST /            file a request
 *   POST /:id/:action approve | deny | reopen
 */
function createChangesRouter({ store, filing = { windowMs: HOUR, max: 6 }, acting = { windowMs: HOUR, max: 40 } }) {
  const router = express.Router();
  const filingLimit = createLimiter(filing);
  const actingLimit = createLimiter(acting);
  const watchers = new Set();

  const send = (res, chunk) => {
    try {
      res.write(chunk);
    } catch {
      watchers.delete(res);
    }
  };

  store.on('change', (request) => {
    const chunk = `event: upsert\ndata: ${JSON.stringify(request)}\n\n`;
    for (const res of watchers) send(res, chunk);
  });

  // keeps proxies from timing out an idle stream, and gives each page something it can see:
  // comments are invisible to EventSource, so a silent-but-dead connection would look healthy
  const keepalive = setInterval(() => {
    for (const res of watchers) send(res, 'event: ping\ndata: {}\n\n');
  }, KEEPALIVE_MS);
  keepalive.unref();

  const gate = (limiter, req, message) => {
    const verdict = limiter.peek(who(req));
    if (!verdict.ok) {
      const err = new ChangeError(`${message} Try again in ${Math.ceil(verdict.retryAfterSec / 60)} min.`, 429);
      err.retryAfter = verdict.retryAfterSec;
      throw err;
    }
  };

  router.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ requests: store.list(), limits: LIMITS });
  });

  router.get('/stream', (req, res) => {
    if (watchers.size >= MAX_WATCHERS) {
      return res.status(503).json({ error: 'Too many people are watching the log. Try again shortly.' });
    }
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // tells nginx not to hold events back
    });
    res.flushHeaders();
    res.write('retry: 3000\n\nevent: hello\ndata: {}\n\n');
    watchers.add(res);
    req.on('close', () => watchers.delete(res));
  });

  router.post('/', (req, res, next) => {
    try {
      const body = req.body || {};
      if (body.website) return res.status(201).json({ ok: true }); // honeypot: bots get a fake success
      gate(filingLimit, req, "Easy. That's plenty of change requests for one hour.");
      const request = store.create({
        name: body.name,
        change: body.change,
        impact: body.impact,
        rollback: body.rollback,
      });
      filingLimit.hit(who(req));
      res.status(201).json({ request });
    } catch (err) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      next(err);
    }
  });

  router.post('/:id/:action', (req, res, next) => {
    try {
      if (!/^CR-\d{4,}$/.test(req.params.id)) throw new ChangeError('No such change request.', 404);
      gate(actingLimit, req, 'You have been busy.');
      const body = req.body || {};
      const request = store.act(req.params.id, req.params.action, { name: body.name, note: body.note });
      actingLimit.hit(who(req));
      res.json({ request });
    } catch (err) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      next(err);
    }
  });

  // on shutdown, release open streams so the container can stop promptly (browsers reconnect on their own)
  router.closeStreams = () => {
    clearInterval(keepalive);
    for (const res of watchers) {
      try { res.end(); } catch { /* already gone */ }
    }
    watchers.clear();
  };

  return router;
}

module.exports = { createChangesRouter };
