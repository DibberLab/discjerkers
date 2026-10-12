'use strict';

const express = require('express');
const { AccountError, LIMITS } = require('../lib/accounts');
const { createLimiter } = require('../lib/ratelimit');

const HOUR = 60 * 60 * 1000;
const COOKIE = 'dj_session';

// nginx sets X-Real-IP from the Cloudflare-restored client address; a visitor can't forge it.
const who = (req) => req.get('x-real-ip') || req.ip || 'unknown';

function cookieOf(req, name) {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

// A browser sending a cross-site request names the site it came from. Ours must match the host it asked for.
function sameOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.get('x-forwarded-host') || req.get('host'));
  } catch {
    return false;
  }
}

/**
 * Accounts and bags. Mounted at /api/account.
 *   GET    /me                          who am I, and my bags
 *   POST   /signup  /login  /logout
 *   POST   /bags                        new bag
 *   PATCH  /bags/:id                    rename, or make it the main bag
 *   DELETE /bags/:id
 *   PUT    /bags/:id/discs/:disc        add a disc
 *   DELETE /bags/:id/discs/:disc        take it out
 * Every response is no-store: it is about one person.
 */
function createAccountRouter({
  store,
  knownDiscs = null,
  signup = { windowMs: HOUR, max: 5 },
  login = { windowMs: 15 * 60 * 1000, max: 10 },
  acting = { windowMs: HOUR, max: 600 },
}) {
  const router = express.Router();
  const signupLimit = createLimiter(signup);
  const loginByIp = createLimiter(login);
  const loginByName = createLimiter({ ...login, max: Math.max(5, login.max - 2) });
  const actingLimit = createLimiter(acting);

  const gate = (limiter, key, message) => {
    const verdict = limiter.peek(key);
    if (!verdict.ok) {
      const err = new AccountError(`${message} Try again in ${Math.ceil(verdict.retryAfterSec / 60)} min.`, 429);
      err.retryAfter = verdict.retryAfterSec;
      throw err;
    }
  };

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && !sameOrigin(req)) return next(new AccountError('Cross-site request refused.', 403));
    next();
  });

  const setCookie = (req, res, token, maxAgeSec) => {
    const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`];
    if (req.secure) flags.push('Secure');
    res.append('Set-Cookie', `${COOKIE}=${token}; ${flags.join('; ')}`);
  };

  const startSession = (req, res, user) => {
    const token = store.startSession(user.id);
    setCookie(req, res, token, LIMITS.sessionDays * 86_400);
  };

  const wrap = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
      next(err);
    }
  };

  // routes that need someone signed in
  const needUser = (req) => {
    const user = store.userForSession(cookieOf(req, COOKIE));
    if (!user) throw new AccountError('Sign in first.', 401);
    return user;
  };

  const writing = (fn) => wrap(async (req, res) => {
    const user = needUser(req);
    gate(actingLimit, `u:${user.id}`, 'Easy. That is a lot of bag changes.');
    actingLimit.hit(`u:${user.id}`);
    await fn(req, res, user);
  });

  const discId = (raw) => {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1 || id > 1_000_000 || (knownDiscs && !knownDiscs.has(id))) {
      throw new AccountError('No such disc.', 404);
    }
    return id;
  };

  router.get('/me', wrap(async (req, res) => {
    const user = store.userForSession(cookieOf(req, COOKIE));
    res.json(user ? { user: { name: user.name }, bags: user.bags } : { user: null, bags: [] });
  }));

  router.post('/signup', wrap(async (req, res) => {
    const body = req.body || {};
    if (body.website) return res.status(201).json({ user: null, bags: [] }); // honeypot: bots get a fake success
    gate(signupLimit, who(req), 'That is plenty of new accounts from one place.');
    const user = await store.signup(body.username, body.password);
    signupLimit.hit(who(req));
    startSession(req, res, user);
    res.status(201).json({ user: { name: user.name }, bags: user.bags });
  }));

  router.post('/login', wrap(async (req, res) => {
    const body = req.body || {};
    const name = String(body.username ?? '').trim().toLowerCase();
    gate(loginByIp, who(req), 'Too many wrong passwords.');
    gate(loginByName, `n:${name}`, 'Too many wrong passwords for that account.');
    let user;
    try {
      user = await store.login(body.username, body.password);
    } catch (err) {
      if (err.status === 401) { loginByIp.hit(who(req)); loginByName.hit(`n:${name}`); }
      throw err;
    }
    startSession(req, res, user);
    res.json({ user: { name: user.name }, bags: user.bags });
  }));

  router.post('/logout', wrap(async (req, res) => {
    store.endSession(cookieOf(req, COOKIE));
    setCookie(req, res, '', 0);
    res.json({ user: null, bags: [] });
  }));

  router.post('/bags', writing(async (req, res, user) => {
    const made = store.createBag(user.id, (req.body || {}).name);
    res.status(201).json({ bags: made.bags, bagId: made.bagId });
  }));

  router.patch('/bags/:id', writing(async (req, res, user) => {
    const { name, main } = req.body || {};
    res.json({ bags: store.updateBag(user.id, req.params.id, { name, main }) });
  }));

  router.delete('/bags/:id', writing(async (req, res, user) => {
    res.json({ bags: store.deleteBag(user.id, req.params.id) });
  }));

  router.put('/bags/:id/discs/:disc', writing(async (req, res, user) => {
    res.json({ bags: store.addDisc(user.id, req.params.id, discId(req.params.disc)) });
  }));

  router.delete('/bags/:id/discs/:disc', writing(async (req, res, user) => {
    res.json({ bags: store.removeDisc(user.id, req.params.id, discId(req.params.disc)) });
  }));

  return router;
}

module.exports = { createAccountRouter };
