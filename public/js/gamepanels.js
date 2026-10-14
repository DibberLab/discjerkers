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
