'use strict';

/**
 * Fixed-window, in-memory limiter. One process, resets on restart — plenty for
 * keeping a public form from being hammered. `peek` checks without counting so
 * only successful actions use up a visitor's allowance.
 */
function createLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, h] of hits) if (h.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000));
  sweep.unref();

  const current = (key, now) => {
    const h = hits.get(key);
    return h && h.resetAt > now ? h : null;
  };

  return {
    peek(key, now = Date.now()) {
      const h = current(key, now);
      const used = h ? h.count : 0;
      return { ok: used < max, retryAfterSec: h ? Math.max(1, Math.ceil((h.resetAt - now) / 1000)) : 0 };
    },
    hit(key, now = Date.now()) {
      let h = current(key, now);
      if (!h) {
        h = { count: 0, resetAt: now + windowMs };
        hits.set(key, h);
      }
      h.count += 1;
    },
  };
}

module.exports = { createLimiter };
