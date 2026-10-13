'use strict';

/**
 * Accounts and bags for the flight guide. A username and a password, nothing else: no email, no
 * reset link. Passwords are stored as scrypt hashes (node:crypto, no dependencies); a login hands
 * out a random session token, and only a hash of that token is kept on disk.
 *
 * Same storage idea as changes.js and store.js: one JSON file in data/, written atomically. It
 * shares the Node process with checkout, so an unreadable file makes accounts read-only instead
 * of failing startup, and a failed save leaves nothing half-done in memory.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tidy } = require('./text');

const LIMITS = {
  usernameMin: 3,
  usernameMax: 24,
  passwordMin: 8,
  passwordMax: 128,
  bagName: 40,
  bagsPerUser: 25,
  discsPerBag: 80,
  plastic: 30,
  weightMin: 20,
  weightMax: 250,
  photoBytes: 400 * 1024,
  photosPerUser: 150,
  maxUsers: 5000,
  sessionsPerUser: 8,
  sessionDays: 30,
};

class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AccountError';
    this.status = status;
  }
}

const USERNAME = /^[A-Za-z0-9_.-]+$/;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// scrypt with Node's defaults (N=16384, r=8, p=1), done off the main thread so a login never stalls checkout.
// Only a couple run at once and a short queue waits behind them, so a flood of sign-in attempts can use up
// the hashing allowance but never the thread pool the rest of the server needs.
const MAX_HASHING = 2;
const MAX_WAITING = 20;
let hashing = 0;
const waiting = [];

async function derive(password, salt) {
  if (hashing >= MAX_HASHING) {
    if (waiting.length >= MAX_WAITING) throw new AccountError('Busy right now. Try again in a moment.', 503);
    await new Promise((resolve) => waiting.push(resolve));
  }
  hashing += 1;
  try {
    return await new Promise((resolve, reject) => {
      crypto.scrypt(password.normalize('NFKC'), salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
    });
  } finally {
    hashing -= 1;
    waiting.shift()?.();
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkPassword(password, stored) {
  const [version, salt, key] = String(stored).split('$');
  if (version !== 's1' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const PHOTO_NAME = /^[a-f0-9]{24}\.jpg$/;
const isJpeg = (buf) => Buffer.isBuffer(buf) && buf.length >= 128 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

function createAccountStore(file, { now = () => Date.now(), photoDir = path.join(path.dirname(file), 'photos') } = {}) {
  let unavailable = false;

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { seq: 0, users: [], sessions: [] };
      console.error('[accounts] could not read the accounts file, leaving it alone:', err.message);
      unavailable = true;
      return { seq: 0, users: [], sessions: [] };
    }
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.users)) {
        const top = d.users.reduce((m, u) => Math.max(m, u.n || 0), 0);
        return {
          seq: Math.max(Number.isInteger(d.seq) ? d.seq : 0, top),
          users: d.users,
          sessions: Array.isArray(d.sessions) ? d.sessions : [],
        };
      }
    } catch { /* fall through to quarantine */ }
    // Unreadable file: keep it for a human instead of overwriting it on the next save.
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    return { seq: 0, users: [], sessions: [] };
  }

  let db = load();

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  const writable = () => {
    if (unavailable) throw new AccountError('Accounts are unavailable right now. Try again later.', 503);
  };

  // Run a change against a copy of one user; only keep it if it saved.
  function changeUser(userId, fn) {
    writable();
    const i = db.users.findIndex((u) => u.id === userId);
    if (i < 0) throw new AccountError('Sign in first.', 401);
    const old = db.users[i];
    const draft = structuredClone(old);
    fn(draft);
    db.users[i] = draft;
    try {
      save();
    } catch {
      db.users[i] = old;
      throw new AccountError('Could not save that. Try again.', 500);
    }
    return draft;
  }

  const findByName = (key) => db.users.find((u) => u.key === key);
  // a bag lists disc ids; `items` holds what the owner says about each one: { color, plastic, photo }
  const bagsView = (u) => u.bags.map((b) => ({ id: b.id, name: b.name, main: !!b.main, discs: b.discs.slice(), items: structuredClone(b.items || {}) }));

  // photos live in data/photos/<user id>/<random>.jpg and are only ever read back by their owner
  const photoPath = (userId, name) => (PHOTO_NAME.test(String(name)) && /^u\d+$/.test(String(userId)) ? path.join(photoDir, userId, name) : null);
  const dropPhotos = (userId, names) => {
    for (const name of names) {
      const f = photoPath(userId, name);
      if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    }
  };
  const photosOf = (bag) => Object.values(bag.items || {}).map((it) => it.photo).filter(Boolean);
  const view = (u) => ({ name: u.name, bags: bagsView(u) });

  function cleanName(label, value, max) {
    const v = tidy(value);
    if (!v) throw new AccountError(`${label} is required.`);
    if (v.length > max) throw new AccountError(`${label} is too long (max ${max} characters).`);
    return v;
  }

  function findBag(user, bagId) {
    const bag = user.bags.find((b) => b.id === bagId);
    if (!bag) throw new AccountError('No such bag.', 404);
    return bag;
  }

  function sameName(user, name, exceptId) {
    return user.bags.some((b) => b.id !== exceptId && b.name.toLowerCase() === name.toLowerCase());
  }

  // a dummy hash, so a login for a name that doesn't exist takes as long as one that does
  let dummy;

  return {
    view,

    hasUser: (username) => !!findByName(String(username ?? '').trim().toLowerCase()),

    async signup(username, password) {
      writable();
      const name = String(username ?? '').trim();
      if (name.length < LIMITS.usernameMin || name.length > LIMITS.usernameMax || !USERNAME.test(name)) {
        throw new AccountError(`Pick a username of ${LIMITS.usernameMin}-${LIMITS.usernameMax} letters, numbers, dots, dashes or underscores.`);
      }
      const pw = String(password ?? '');
      if (pw.length < LIMITS.passwordMin) throw new AccountError(`Password needs at least ${LIMITS.passwordMin} characters.`);
      if (pw.length > LIMITS.passwordMax) throw new AccountError(`Password is too long (max ${LIMITS.passwordMax} characters).`);
      if (db.users.length >= LIMITS.maxUsers) throw new AccountError('Sign-ups are full right now. Tell the team.', 503);
      if (findByName(name.toLowerCase())) throw new AccountError('That username is taken.', 409);

      const pass = await hashPassword(pw);
      if (findByName(name.toLowerCase())) throw new AccountError('That username is taken.', 409); // two people raced for it

      const at = new Date(now()).toISOString();
      db.seq += 1;
      const user = {
        id: `u${db.seq}`,
        n: db.seq,
        name,
        key: name.toLowerCase(),
        pass,
        createdAt: at,
        bags: [{ id: crypto.randomBytes(4).toString('hex'), name: 'Main bag', main: true, discs: [], createdAt: at }],
      };
      db.users.push(user);
      try {
        save();
      } catch {
        db.users.pop();
        db.seq -= 1;
        throw new AccountError('Could not save that. Try again.', 500);
      }
      return { id: user.id, ...view(user) };
    },

    async login(username, password) {
      const user = findByName(String(username ?? '').trim().toLowerCase());
      const pw = String(password ?? '').slice(0, LIMITS.passwordMax);
      if (!user) {
        dummy ||= await hashPassword('not-a-real-password');
        await checkPassword(pw, dummy);
        throw new AccountError('Wrong username or password.', 401);
      }
      if (!(await checkPassword(pw, user.pass))) throw new AccountError('Wrong username or password.', 401);
      return { id: user.id, ...view(user) };
    },

    // Sessions: the browser holds a random token; the file holds only its hash.
    startSession(userId) {
      writable();
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const before = db.sessions;
      const live = db.sessions.filter((s) => s.exp > t);
      const mine = live.filter((s) => s.uid === userId).sort((a, b) => a.exp - b.exp);
      const drop = new Set(mine.slice(0, Math.max(0, mine.length - (LIMITS.sessionsPerUser - 1))).map((s) => s.t));
      db.sessions = [...live.filter((s) => !drop.has(s.t)), { t: sha256(token), uid: userId, exp: t + LIMITS.sessionDays * 86_400_000 }];
      try {
        save();
      } catch {
        db.sessions = before;
        throw new AccountError('Could not save that. Try again.', 500);
      }
      return token;
    },

    userForSession(token) {
      if (!token) return null;
      const h = sha256(String(token));
      const s = db.sessions.find((x) => x.t === h);
      if (!s || s.exp <= now()) return null;
      const u = db.users.find((x) => x.id === s.uid);
      return u ? { id: u.id, ...view(u) } : null;
    },

    endSession(token) {
      if (!token || unavailable) return;
      const h = sha256(String(token));
      const before = db.sessions;
      if (!before.some((s) => s.t === h)) return;
      db.sessions = before.filter((s) => s.t !== h);
      try { save(); } catch { db.sessions = before; }
    },

    createBag(userId, name) {
      let bagId;
      const user = changeUser(userId, (u) => {
        if (u.bags.length >= LIMITS.bagsPerUser) throw new AccountError(`That's ${LIMITS.bagsPerUser} bags. Time to throw something out.`, 409);
        const n = cleanName('Bag name', name, LIMITS.bagName);
        if (sameName(u, n)) throw new AccountError('You already have a bag with that name.', 409);
        bagId = crypto.randomBytes(4).toString('hex');
        u.bags.push({ id: bagId, name: n, main: false, discs: [], createdAt: new Date(now()).toISOString() });
      });
      return { bagId, bags: bagsView(user) };
    },

    updateBag(userId, bagId, { name, main } = {}) {
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        if (name !== undefined) {
          const n = cleanName('Bag name', name, LIMITS.bagName);
          if (sameName(u, n, bag.id)) throw new AccountError('You already have a bag with that name.', 409);
          bag.name = n;
        }
        if (main === true) u.bags.forEach((b) => { b.main = b.id === bag.id; });
        else if (main === false && bag.main) throw new AccountError('Make another bag your main bag instead.', 409);
      });
      return bagsView(user);
    },

    deleteBag(userId, bagId) {
      let photos = [];
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        if (bag.main) throw new AccountError('That is your main bag. Make another bag main before deleting it.', 409);
        photos = photosOf(bag);
        u.bags = u.bags.filter((b) => b.id !== bag.id);
      });
      dropPhotos(userId, photos);
      return bagsView(user);
    },

    addDisc(userId, bagId, discId) {
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        if (bag.discs.includes(discId)) return; // already in there: nothing to do
        if (bag.discs.length >= LIMITS.discsPerBag) throw new AccountError(`A bag holds ${LIMITS.discsPerBag} discs. That is already a lot of plastic.`, 409);
        bag.discs.push(discId);
      });
      return bagsView(user);
    },

    removeDisc(userId, bagId, discId) {
      let photos = [];
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        bag.discs = bag.discs.filter((d) => d !== discId);
        photos = [bag.items?.[discId]?.photo].filter(Boolean);
        if (bag.items) delete bag.items[discId];
      });
      dropPhotos(userId, photos);
      return bagsView(user);
    },

    // What the owner says about a disc in one bag: its color, plastic and weight in grams. Photos are separate.
    setItem(userId, bagId, discId, { color, plastic, weight } = {}) {
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        if (!bag.discs.includes(discId)) throw new AccountError('That disc is not in this bag.', 404);
        bag.items ||= {};
        const item = { ...(bag.items[discId] || {}) };
        if (color !== undefined) {
          if (color === null || color === '') delete item.color;
          else if (/^#[0-9a-f]{6}$/i.test(String(color))) item.color = String(color).toLowerCase();
          else throw new AccountError('That is not a color.');
        }
        if (plastic !== undefined) {
          const p = tidy(plastic);
          if (p.length > LIMITS.plastic) throw new AccountError(`Plastic is too long (max ${LIMITS.plastic} characters).`);
          if (p) item.plastic = p; else delete item.plastic;
        }
        if (weight !== undefined) {
          if (weight === null || weight === '') {
            delete item.weight;
          } else {
            const w = Math.round(Number(weight) * 10) / 10;
            if (!Number.isFinite(w) || w < LIMITS.weightMin || w > LIMITS.weightMax) {
              throw new AccountError(`Weight should be between ${LIMITS.weightMin} and ${LIMITS.weightMax} grams.`);
            }
            item.weight = w;
          }
        }
        if (Object.keys(item).length) bag.items[discId] = item; else delete bag.items[discId];
      });
      return bagsView(user);
    },

    // The browser sends a small JPEG it made itself (resized, location data gone). We only check it looks like one.
    setPhoto(userId, bagId, discId, buffer) {
      writable();
      if (!isJpeg(buffer)) throw new AccountError('Send a JPEG photo.', 415);
      if (buffer.length > LIMITS.photoBytes) throw new AccountError('That photo is too big.', 413);

      const name = `${crypto.randomBytes(12).toString('hex')}.jpg`;
      const target = photoPath(userId, name);
      if (!target) throw new AccountError('Sign in first.', 401);
      let old;
      let user;
      try {
        user = changeUser(userId, (u) => {
          const bag = findBag(u, bagId);
          if (!bag.discs.includes(discId)) throw new AccountError('That disc is not in this bag.', 404);
          bag.items ||= {};
          const item = (bag.items[discId] ||= {});
          old = item.photo;
          if (!old && u.bags.reduce((n, b) => n + photosOf(b).length, 0) >= LIMITS.photosPerUser) {
            throw new AccountError(`That is ${LIMITS.photosPerUser} photos. Remove some first.`, 409);
          }
          item.photo = name;
          // write the file as part of the change: if it cannot be written, the change does not happen
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(`${target}.tmp`, buffer, { mode: 0o600 });
          fs.renameSync(`${target}.tmp`, target);
        });
      } catch (err) {
        try { fs.unlinkSync(target); } catch { /* never written */ }
        try { fs.unlinkSync(`${target}.tmp`); } catch { /* never written */ }
        if (err instanceof AccountError) throw err;
        throw new AccountError('Could not save that photo. Try again.', 500);
      }
      dropPhotos(userId, [old].filter(Boolean));
      return bagsView(user);
    },

    clearPhoto(userId, bagId, discId) {
      let old;
      const user = changeUser(userId, (u) => {
        const bag = findBag(u, bagId);
        const item = bag.items?.[discId];
        old = item?.photo;
        if (item) {
          delete item.photo;
          if (!Object.keys(item).length) delete bag.items[discId];
        }
      });
      dropPhotos(userId, [old].filter(Boolean));
      return bagsView(user);
    },

    photoPath,
  };
}

module.exports = { createAccountStore, AccountError, LIMITS };
