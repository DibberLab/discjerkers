'use strict';

/**
 * The change-control log. Anyone can file a change request; anyone can approve,
 * deny, or reopen one as long as they log a name. Names are self-reported (the
 * honor system), so this is a joke with teeth, not an audit trail.
 *
 * Same storage idea as store.js: one JSON file in data/, written atomically.
 */

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const LIMITS = {
  name: 40,
  change: 300,
  impact: 500,
  rollback: 500,
  note: 200,
  maxRequests: 1000,
  maxHistory: 100,
};

class ChangeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ChangeError';
    this.status = status;
  }
}

// Single-line plain text: control, bidi-override, and zero-width characters become spaces; whitespace collapses.
const isJunk = (cp) =>
  cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) ||
  (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2069) || cp === 0xfeff;

const tidy = (v) =>
  Array.from(String(v ?? ''), (ch) => (isJunk(ch.codePointAt(0)) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

function field(label, value, max, { required = true } = {}) {
  const v = tidy(value);
  if (!v) {
    if (required) throw new ChangeError(`${label} is required.`);
    return '';
  }
  if (v.length > max) throw new ChangeError(`${label} is too long (max ${max} characters).`);
  return v;
}

const ACTIONS = {
  approve: { from: ['pending'], to: 'approved', logged: 'approved' },
  deny: { from: ['pending'], to: 'denied', logged: 'denied' },
  reopen: { from: ['approved', 'denied'], to: 'pending', logged: 'reopened' },
};

function createChangeStore(file, { now = () => new Date() } = {}) {
  const events = new EventEmitter();

  // If the file exists but can't be read, the log goes read-only instead of failing startup (this
  // must never take the storefront down) and never overwrites a file it couldn't read.
  let unavailable = false;

  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { seq: 0, requests: [] };
      console.error('[changes] could not read the log, leaving it alone:', err.message);
      unavailable = true;
      return { seq: 0, requests: [] };
    }
    try {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.requests)) {
        const top = d.requests.reduce((m, r) => Math.max(m, r.n || 0), 0);
        return { seq: Math.max(Number.isInteger(d.seq) ? d.seq : 0, top), requests: d.requests };
      }
    } catch { /* fall through to quarantine */ }
    // Unreadable file: keep it for a human instead of overwriting it on the next save.
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    return { seq: 0, requests: [] };
  }

  let db = load();

  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, file);
  }

  const copy = (r) => structuredClone(r);

  return {
    on: (event, fn) => events.on(event, fn),

    list() {
      return db.requests.slice().sort((a, b) => b.n - a.n).map(copy);
    },

    create({ name, change, impact, rollback }) {
      if (unavailable) throw new ChangeError('The log is unavailable right now. Tell the team.', 503);
      const by = field('Your name', name, LIMITS.name);
      const entry = {
        change: field('Proposed change', change, LIMITS.change),
        impact: field('Impact', impact, LIMITS.impact),
        rollback: field('Rollback plan', rollback, LIMITS.rollback),
      };
      if (db.requests.length >= LIMITS.maxRequests) {
        throw new ChangeError('The log is full. Tell the team.', 503);
      }
      const at = now().toISOString();
      db.seq += 1;
      const request = {
        id: `CR-${String(db.seq).padStart(4, '0')}`,
        n: db.seq,
        ...entry,
        filedBy: by,
        filedAt: at,
        status: 'pending',
        updatedAt: at,
        history: [{ action: 'filed', by, at }],
      };
      db.requests.push(request);
      try {
        save();
      } catch (err) {
        db.requests.pop();
        db.seq -= 1;
        throw new ChangeError('Could not save that. Try again.', 500);
      }
      events.emit('change', copy(request));
      return copy(request);
    },

    act(id, action, { name, note } = {}) {
      if (unavailable) throw new ChangeError('The log is unavailable right now. Tell the team.', 503);
      const rule = ACTIONS[action];
      if (!rule) throw new ChangeError('Unknown action.', 400);
      const request = db.requests.find((r) => r.id === id);
      if (!request) throw new ChangeError('No such change request.', 404);
      const by = field('Your name', name, LIMITS.name);
      const why = field('Note', note, LIMITS.note, { required: false });

      if (!rule.from.includes(request.status)) {
        throw new ChangeError(
          action === 'reopen' ? 'That one is already open.' : `Already ${request.status}. Reopen it first.`,
          409
        );
      }
      if (request.history.length >= LIMITS.maxHistory) {
        throw new ChangeError('This request has been argued about enough.', 409);
      }

      const at = now().toISOString();
      const before = { status: request.status, updatedAt: request.updatedAt };
      request.status = rule.to;
      request.updatedAt = at;
      request.history.push({ action: rule.logged, by, at, ...(why ? { note: why } : {}) });
      try {
        save();
      } catch (err) {
        Object.assign(request, before);
        request.history.pop();
        throw new ChangeError('Could not save that. Try again.', 500);
      }
      events.emit('change', copy(request));
      return copy(request);
    },
  };
}

module.exports = { createChangeStore, ChangeError, LIMITS };
