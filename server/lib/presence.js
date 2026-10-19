'use strict';

/**
 * Who is on the game right now: a count of anonymous page ids that have said hello lately.
 * No names, no addresses, nothing kept but a random id and when it was last seen; an id is forgotten
 * after `ttlMs` of silence (the page says hello every 20 seconds while it is open) or when it says goodbye.
 */
function createPresence({ ttlMs = 45_000, max = 5000, now = Date.now } = {}) {
  const seen = new Map(); // id -> last seen (ms)
  const prune = () => {
    const cutoff = now() - ttlMs;
    for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
  };
  return {
    ping(id) {
      if (!seen.has(id) && seen.size >= max) prune();
      if (!seen.has(id) && seen.size >= max) return; // (full of live visitors: do not grow without end)
      seen.set(id, now());
    },
    leave(id) { seen.delete(id); },
    count() { prune(); return seen.size; },
  };
}

module.exports = { createPresence };
