/* What playing leaves behind: stats, achievements, disc skins, and discs that break in. Pure and shared (the page keeps and shows it, the
   server stores it for a signed-in player and uses the wear when it plays their throws). It is honor system, like the meters: the
   server only checks that a stored blob has the right shape and sane sizes. */

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// the skins a disc can wear: a colour for your own discs in flight (and a name to brag with)
export const SKINS = [
  { id: 'classic', name: 'Classic', color: null, cost: 0, how: 'Always yours' },
  { id: 'gold', name: 'Gold', color: '#f2c14e', cost: 25, how: 'Make a hole in one' },
  { id: 'chrome', name: 'Chrome', color: '#cfd6e0', cost: 20, how: 'Sink a 40 ft putt' },
  { id: 'neon', name: 'Neon', color: '#39ff88', cost: 15, how: 'Go under par three holes running' },
  { id: 'ice', name: 'Ice', color: '#8ae8ff', cost: 15, how: 'Finish nine holes without a penalty' },
  { id: 'sunset', name: 'Sunset', color: '#ff7a3a', cost: 18, how: 'Make an eagle' },
  { id: 'storm', name: 'Storm', color: '#6a7bd8', cost: 15, how: 'Make par in the rain' },
  { id: 'leopard', name: 'Marebear', color: '#d89a4a', cost: 30, how: 'Post a daily score' },
];
export const skinOf = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

// the goals. `skin` is the skin it unlocks, if any (the skin can also be bought with Marebear Bucks).
export const ACHIEVEMENTS = [
  { id: 'ace', title: 'Hole in one', desc: 'Ace a hole.', skin: 'gold' },
  { id: 'longputt', title: 'Long arm', desc: 'Sink a putt from 40 feet or more.', skin: 'chrome' },
  { id: 'streak3', title: 'Hot streak', desc: 'Go under par on three holes in a row.', skin: 'neon' },
  { id: 'clean', title: 'Clean card', desc: 'Finish a round of nine or more holes with no penalty strokes.', skin: 'ice' },
  { id: 'eagle', title: 'Eagle', desc: 'Make an eagle: two under par or better.', skin: 'sunset' },
  { id: 'rainy', title: 'Rain or shine', desc: 'Make par or better on a hole in the rain.', skin: 'storm' },
  { id: 'daily', title: 'Daily driver', desc: 'Post a score to the daily board.', skin: 'leopard' },
  { id: 'veteran', title: 'Broken in', desc: 'Throw one disc 100 times: it turns a little more for you now.' },
  { id: 'regular', title: 'Regular', desc: 'Play 25 holes.' },
  { id: 'bettor', title: 'High roller', desc: 'Win a bet with Marebear.' },
];

export const emptyGame = () => ({
  v: 1,
  stats: { throws: 0, holes: 0, aces: 0, eagles: 0, birdies: 0, bestPutt: 0, bestDrive: 0, streak: 0, bestStreak: 0, betsWon: 0, discs: {} },
  unlocked: [],
  owned: ['classic'],
  skin: 'classic',
});

/* ----- discs break in ----- */

export const BREAK_IN_THROWS = 160;
// A disc you throw a lot gets more understable (turns more) and a touch less overstable: up to a point of turn and a quarter point of fade.
export function brokenIn(disc, throws) {
  const w = Math.min(1, Math.max(0, Number(throws) || 0) / BREAK_IN_THROWS);
  if (!w) return disc;
  return { ...disc, turn: disc.turn - w * 1.0, fade: Math.max(0, disc.fade - w * 0.25), worn: Math.round(w * 100) };
}
export const wearOf = (game, discId) => game?.stats?.discs?.[discId] || 0;

/* ----- what happens as you play ----- */

function unlock(game, id, out) {
  if (game.unlocked.includes(id)) return;
  game.unlocked.push(id);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (a?.skin && !game.owned.includes(a.skin)) game.owned.push(a.skin);
  out.push(id);
}

/**
 * Record one throw: { discId, putt, made, gimme, dist (a putt, feet), feet (a drive), kind }. Returns the ids of any goals just reached.
 * (The game object is changed in place.)
 */
export function recordThrow(game, t) {
  const out = [];
  const s = game.stats;
  s.throws += 1;
  if (t.discId) {
    s.discs[t.discId] = (s.discs[t.discId] || 0) + 1;
    if (s.discs[t.discId] >= 100) unlock(game, 'veteran', out);
  }
  if (t.putt && t.made && !t.gimme) {
    s.bestPutt = Math.max(s.bestPutt, Math.round(t.dist || 0));
    if ((t.dist || 0) >= 40) unlock(game, 'longputt', out);
  }
  if (!t.putt && t.kind === 'landed') s.bestDrive = Math.max(s.bestDrive, Math.round(t.feet || 0));
  if (!t.putt && t.kind === 'basket') { s.aces += 1; unlock(game, 'ace', out); }
  return out;
}

// A hole finished: { strokes, par, holed, rain }
export function recordHole(game, h) {
  const out = [];
  const s = game.stats;
  s.holes += 1;
  if (s.holes >= 25) unlock(game, 'regular', out);
  const under = h.holed && h.strokes < h.par;
  if (under) s.birdies += 1;
  s.streak = under ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  if (s.streak >= 3) unlock(game, 'streak3', out);
  if (h.holed && h.strokes <= h.par - 2 && h.strokes > 1) { s.eagles += 1; unlock(game, 'eagle', out); }
  if (h.rain && h.holed && h.strokes <= h.par) unlock(game, 'rainy', out);
  return out;
}

// A round finished: { holes, penalties }
export function recordRound(game, r) {
  const out = [];
  if (r.holes >= 9 && r.penalties === 0) unlock(game, 'clean', out);
  return out;
}
export const recordDaily = (game) => { const out = []; unlock(game, 'daily', out); return out; };
export const recordBetWon = (game) => { const out = []; game.stats.betsWon += 1; unlock(game, 'bettor', out); return out; };

// buy a skin with Marebear Bucks: { ok, cost } (the caller takes the bucks)
export function buySkin(game, id, bucks) {
  const skin = SKINS.find((s) => s.id === id);
  if (!skin || game.owned.includes(id)) return { ok: false, reason: 'owned' };
  if (bucks < skin.cost) return { ok: false, reason: 'poor', cost: skin.cost };
  game.owned.push(id);
  return { ok: true, cost: skin.cost };
}
export function equipSkin(game, id) {
  if (!game.owned.includes(id)) return false;
  game.skin = id;
  return true;
}

/* ----- keeping it: the right shape, and merging two copies ----- */

// What a server accepts back: the right shape, whole numbers in believable ranges, known ids only. Returns a clean game, or null.
export function sanitizeGame(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null;
  const g = emptyGame();
  const st = raw.stats && typeof raw.stats === 'object' ? raw.stats : {};
  for (const k of ['throws', 'holes', 'aces', 'eagles', 'birdies', 'betsWon']) g.stats[k] = clampInt(st[k], 0, 1e6);
  g.stats.bestPutt = clampInt(st.bestPutt, 0, 60);
  g.stats.bestDrive = clampInt(st.bestDrive, 0, 600);
  g.stats.streak = clampInt(st.streak, 0, 18);
  g.stats.bestStreak = clampInt(st.bestStreak, 0, 18);
  const discs = st.discs && typeof st.discs === 'object' ? Object.entries(st.discs).slice(0, 300) : [];
  for (const [id, n] of discs) {
    const k = Number(id);
    if (Number.isInteger(k) && k > 0 && k < 1_000_000) g.stats.discs[k] = clampInt(n, 0, 1e5);
  }
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  g.unlocked = [...new Set((Array.isArray(raw.unlocked) ? raw.unlocked : []).filter((x) => ids.has(x)))];
  const skins = new Set(SKINS.map((s) => s.id));
  g.owned = [...new Set(['classic', ...(Array.isArray(raw.owned) ? raw.owned : []).filter((x) => skins.has(x))])];
  g.skin = g.owned.includes(raw.skin) ? raw.skin : 'classic';
  return g;
}

// two copies of one player's progress (this browser's and the server's): the bigger count, every goal and skin either has
export function mergeGame(a, b) {
  const x = sanitizeGame(a) || emptyGame();
  const y = sanitizeGame(b) || emptyGame();
  const g = emptyGame();
  for (const k of Object.keys(g.stats)) {
    if (k === 'discs') continue;
    g.stats[k] = Math.max(x.stats[k], y.stats[k]);
  }
  for (const id of new Set([...Object.keys(x.stats.discs), ...Object.keys(y.stats.discs)])) g.stats.discs[id] = Math.max(x.stats.discs[id] || 0, y.stats.discs[id] || 0);
  g.unlocked = [...new Set([...x.unlocked, ...y.unlocked])];
  g.owned = [...new Set([...x.owned, ...y.owned])];
  g.skin = x.owned.includes(x.skin) && x.skin !== 'classic' ? x.skin : y.skin;
  return g;
}
