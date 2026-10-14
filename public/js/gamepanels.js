/* HTML for the game's rivalry screens: the daily course, the season's standings, a throw to watch again, and who was closest to the
   pin. Pure functions of what the server sent (so a test can look at what comes out); game.js decides when to show them. */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vs = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : String(n));

export const countdown = (ms) => {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

const boardRows = (top, empty) => (top.length
  ? `<ol class="gm-vs-list gm-board">${top.map((e) => `<li class="${e.you ? 'is-me' : ''}"><span>${e.rank}. ${esc(e.name)}${e.you ? ' (you)' : ''}</span><span>${vs(e.total - e.par)}</span><b>${e.total}</b></li>`).join('')}</ol>`
  : `<p class="gm-note">${empty}</p>`);

/**
 * The daily course.
 *   plan: { day, holes: [{ id, name, par }] }   data: what GET /daily sent (or null)   signedIn   loading   msg   closesIn (ms)
 */
export function dailyHtml({ plan, data, signedIn, loading, msg, closesIn }) {
  const par = plan.holes.reduce((n, h) => n + h.par, 0);
  const holes = plan.holes.map((h, i) => `<li><span>${i + 1}. ${esc(h.name)}</span><span>par ${h.par}</span></li>`).join('');
  const you = data?.board?.you;
  const mine = you
    ? `<p>Your score today: <b>${you.total}</b> (${vs(you.total - you.par)}), <b>${you.rank}</b>${data.board.entries > 1 ? ` of ${data.board.entries}` : ''}. Your first run counts; play it again for fun.</p>`
    : data && signedIn ? '<p>You have not posted a score today. Your first complete run counts.</p>' : '';
  return `<div class="gm-card">
      <h2>Daily course</h2>
      <p>${esc(plan.day)}: nine holes in a set order, with the same wind, weather and pins for everyone. Closes in ${countdown(closesIn)}.</p>
      <ol class="gm-card-list">${holes}</ol>
      <p class="gm-note">Par ${par}. ${signedIn ? '' : 'Sign in to post your score and see the board. '}Marebear plays favorites.</p>
      ${mine}
      <button class="btn" type="button" data-daily-play>${you ? 'Play it again (for fun)' : 'Play today\'s course'}</button>
      ${signedIn ? '' : '<button class="btn btn--ghost" type="button" data-signin>Sign in or create an account</button>'}
    </div>
    <div class="gm-card">
      <p class="gm-h">Today's board${data ? ` <span>· ${data.board.entries} ${data.board.entries === 1 ? 'score' : 'scores'}</span>` : ''}</p>
      ${loading ? '<p class="gm-note">Loading…</p>' : signedIn ? boardRows(data?.board?.top || [], 'Nobody has posted yet. Be first.') : '<p class="gm-note">Sign in to see the board.</p>'}
    </div>
    ${msg ? `<p class="gm-error" role="alert">${esc(msg)}</p>` : ''}
    ${signedIn ? '<button class="btn btn--ghost" type="button" data-standings>Season standings</button>' : ''}
    <button class="btn btn--ghost" type="button" data-menu>Back</button>`;
}

// the season (a month) of match results
export function standingsHtml({ data, loading, msg }) {
  const month = data?.month ? new Date(`${data.month}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const rows = data?.table?.length
    ? `<ol class="gm-vs-list gm-board gm-standings">${data.table.map((t) => `<li class="${t.you ? 'is-me' : ''}"><span>${t.rank}. ${esc(t.name)}${t.you ? ' (you)' : ''}<small>${t.wins}W ${t.ties}T ${t.played - t.wins - t.ties}L · ${vs(t.perHole)} a hole</small></span><b>${t.points}</b></li>`).join('')}</ol>`
    : '<p class="gm-note">No finished matches this month yet. Play a friend, and win.</p>';
  return `<div class="gm-card">
      <h2>Season standings</h2>
      <p>${esc(month)}. A win in a match is 3 points, a tie is 1. Matches you forfeit do not count.</p>
      ${loading ? '<p class="gm-note">Loading…</p>' : rows}
    </div>
    ${msg ? `<p class="gm-error" role="alert">${esc(msg)}</p>` : ''}
    <button class="btn btn--ghost" type="button" data-daily>Back to the daily course</button>
    <button class="btn btn--ghost" type="button" data-menu>Menu</button>`;
}

// a throw worth watching again, in words
export function highlightLabel(move, holeName = '') {
  if (!move) return '';
  const where = holeName ? ` on ${holeName}` : '';
  if (move.kind === 'basket' && !move.putt) return `a hole in one from ${Math.round(move.feet || 0)} ft${where}`;
  if (move.putt && move.made) return `a ${Math.round(move.dist || 0)} ft putt${where}`;
  return `a ${Math.round(move.feet || 0)} ft drive${where}`;
}

/**
 * Closest to the pin on a hole (a par 3): who finished nearest with a clean first throw.
 *   results: [{ uid, kp }]   nameOf(uid) -> string
 * Returns { uid, name, feet } or null (no clean first throw at all).
 */
export function closestToPin(results, nameOf) {
  const clean = results.filter((r) => typeof r.kp === 'number');
  if (!clean.length) return null;
  const best = clean.reduce((a, b) => (b.kp < a.kp ? b : a));
  if (clean.filter((r) => Math.abs(r.kp - best.kp) < 0.05).length > 1) return null; // a dead heat is nobody's
  return { uid: best.uid, name: nameOf(best.uid), feet: best.kp };
}

/**
 * Trophies: goals reached, skins to wear or buy, and how worn in each disc is.
 *   game: the player's progress   bucks: Marebear Bucks   goals: ACHIEVEMENTS   skins: SKINS   discName(id) -> string   breakIn: throws for fully broken in
 */
export function trophiesHtml({ game, bucks, canBuy = true, goals, skins, discName, breakIn, msg }) {
  const done = new Set(game.unlocked);
  const goalRows = goals.map((a) => `<li class="${done.has(a.id) ? 'is-me' : ''}"><span>${done.has(a.id) ? '✓ ' : ''}${esc(a.title)}<small>${esc(a.desc)}</small></span><b>${done.has(a.id) ? 'done' : ''}</b></li>`).join('');
  const skinRows = skins.map((s) => {
    const own = game.owned.includes(s.id);
    const worn = game.skin === s.id;
    const swatch = `<i class="gm-swatch" style="--c:${s.color || '#8a9a86'}"></i>`;
    const action = worn ? '<b>worn</b>' : own ? `<button class="chip" type="button" data-skin="${s.id}">Wear</button>` : canBuy ? `<button class="chip" type="button" data-skin="${s.id}"${bucks < s.cost ? ' disabled' : ''}>Buy ${s.cost}</button>` : '<b>locked</b>';
    return `<li class="${worn ? 'is-me' : ''}"><span>${swatch}${esc(s.name)}<small>${own ? 'yours' : canBuy ? `${esc(s.how)}, or ${s.cost} Marebear Bucks` : esc(s.how)}</small></span>${action}</li>`;
  }).join('');
  const discs = Object.entries(game.stats.discs).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const wearRows = discs.length
    ? discs.map(([id, n]) => `<li><span>${esc(discName(id))}<small>${n} ${n === 1 ? 'throw' : 'throws'}</small></span><b>${Math.min(100, Math.round((n / breakIn) * 100))}%</b></li>`).join('')
    : '<li><span>No throws yet<small>A disc you throw a lot turns a little more.</small></span><b></b></li>';
  const s = game.stats;
  return `<div class="gm-card">
      <h2>Trophies</h2>
      <p>${s.throws} throws · ${s.holes} holes · ${s.aces} ${s.aces === 1 ? 'ace' : 'aces'} · best putt ${s.bestPutt} ft · best drive ${s.bestDrive} ft.${canBuy ? ` You have <b>${bucks}</b> Marebear Bucks.` : ''}</p>
      ${msg ? `<p class="gm-note" role="status">${esc(msg)}</p>` : ''}
      <p class="gm-h">Goals</p>
      <ol class="gm-vs-list gm-board">${goalRows}</ol>
      <p class="gm-h">Disc skins <span>· for your own discs in flight</span></p>
      <ol class="gm-vs-list gm-board">${skinRows}</ol>
      <p class="gm-h">Broken in</p>
      <ol class="gm-vs-list gm-board">${wearRows}</ol>
    </div>
    <button class="btn btn--ghost" type="button" data-menu>Back</button>`;
}
