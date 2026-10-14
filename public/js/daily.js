/* The daily course: one nine-hole round, the same for everybody on a given day (UTC): the same holes in the same order, on the same
   seed, so the same wind, rain, pins and mandos. Pure and shared: the page plays it and the server checks a posted score against it. */

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DAILY_HOLES = 9;
// "2026-10-13": the day (UTC) a moment falls on
export const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
export const isDayKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// the day's plan: its seed, and nine of the eighteen holes in a shuffled order
export function dailyPlan(day) {
  const seed = (hash(`djdaily:${day}`) % 2147483646) + 1;
  const rnd = rngOf(seed);
  const ids = Array.from({ length: 18 }, (_, i) => i + 1);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return { day, seed, holeIds: ids.slice(0, DAILY_HOLES) };
}

// the moment the next daily course opens (midnight UTC), for a countdown
export const nextDailyAt = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };
