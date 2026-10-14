'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The game's long memory: the daily course's scores, and the results of finished matches (matches themselves are tidied away after
 * 14 days, but a season's standings should outlive them). One JSON file, written atomically; an unreadable file makes the ledger
 * read-only rather than taking anything down.
 *   daily:   { 'YYYY-MM-DD': [ { uid, name, total, par, card: [strokes...], at } ] }
 *   results: [ { id, at, players: [ { uid, name, total, par, holes } ], winners: [uid] } ]
 */
const KEEP_DAILY_DAYS = 45;
const KEEP_RESULT_DAYS = 130;
const MAX_RESULTS = 600;
const DAY = 24 * 3600 * 1000;

function createLedger(file, { now = () => Date.now() } = {}) {
  let db = { daily: {}, results: [] };
  let unavailable = false;
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d && typeof d.daily === 'object' && Array.isArray(d.results)) db = { daily: d.daily, results: d.results };
  } catch (err) {
    if (err.code !== 'ENOENT') { console.error('[ledger] could not read the ledger, leaving it alone:', err.message); unavailable = true; }
  }
  function save() {
    if (unavailable) return false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      console.error('[ledger] could not save:', err.message);
      return false;
    }
  }
  function prune() {
    const cut = new Date(now() - KEEP_DAILY_DAYS * DAY).toISOString().slice(0, 10);
    for (const day of Object.keys(db.daily)) if (day < cut) delete db.daily[day];
    db.results = db.results.filter((r) => now() - r.at < KEEP_RESULT_DAYS * DAY).slice(-MAX_RESULTS);
  }

  const rank = (list) => [...list].sort((a, b) => a.total - b.total || a.at - b.at);

  return {
    // post a score for a day: one per player per day (the first completed run counts; later ones are practice)
    addDaily(day, entry) {
      if (unavailable) return { ok: false, reason: 'unavailable' };
      const list = (db.daily[day] ||= []);
      if (list.some((e) => e.uid === entry.uid)) return { ok: false, reason: 'already' };
      list.push({ uid: entry.uid, name: entry.name, total: entry.total, par: entry.par, card: entry.card, at: now() });
      prune();
      if (!save()) { list.pop(); return { ok: false, reason: 'unavailable' }; }
      return { ok: true };
    },
    // the board for a day: the best, with who you are
    board(day, uid, limit = 20) {
      const sorted = rank(db.daily[day] || []);
      const top = sorted.slice(0, limit).map((e, i) => ({ rank: i + 1, name: e.name, total: e.total, par: e.par, card: e.card, you: e.uid === uid }));
      const i = sorted.findIndex((e) => e.uid === uid);
      return { entries: sorted.length, top, you: i < 0 ? null : { rank: i + 1, name: sorted[i].name, total: sorted[i].total, par: sorted[i].par, card: sorted[i].card } };
    },
    hasPlayed: (day, uid) => (db.daily[day] || []).some((e) => e.uid === uid),

    // a finished match goes in once
    recordMatch(m) {
      if (unavailable || m.status !== 'done' || m.endedBy !== 'finished') return false;
      if (db.results.some((r) => r.id === m.id)) return false;
      const players = m.players.filter((p) => !p.left && m.cards[p.uid]).map((p) => ({
        uid: p.uid,
        name: p.name,
        total: m.cards[p.uid].reduce((n, c) => n + c.score, 0),
        par: m.cards[p.uid].reduce((n, c) => n + c.par, 0),
        holes: m.cards[p.uid].length,
      }));
      if (players.length < 2) return false;
      db.results.push({ id: m.id, at: now(), players, winners: m.winners || [] });
      prune();
      save();
      return true;
    },
    // the standings for a month ("2026-10"): 3 points for a win, 1 for a tie, ranked by points, then by strokes under par per hole
    standings(month) {
      const table = new Map();
      for (const r of db.results) {
        if (new Date(r.at).toISOString().slice(0, 7) !== month) continue;
        for (const p of r.players) {
          const t = table.get(p.uid) || { uid: p.uid, name: p.name, played: 0, wins: 0, ties: 0, strokes: 0, par: 0, holes: 0 };
          t.name = p.name;
          t.played += 1;
          if (r.winners.includes(p.uid)) { if (r.winners.length === 1) t.wins += 1; else t.ties += 1; }
          t.strokes += p.total;
          t.par += p.par;
          t.holes += p.holes;
          table.set(p.uid, t);
        }
      }
      return [...table.values()]
        .map((t) => ({ ...t, points: t.wins * 3 + t.ties, perHole: t.holes ? Math.round(((t.strokes - t.par) / t.holes) * 100) / 100 : 0 }))
        .sort((a, b) => b.points - a.points || a.perHole - b.perHole || b.played - a.played);
    },
  };
}

module.exports = { createLedger };
