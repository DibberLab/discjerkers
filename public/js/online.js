// The "playing now" footnote: a random id for this page says hello to the server every 20 seconds, and the server says how many ids it has heard from lately.
// Nothing about the visitor is sent or kept: not a name, not an address (the id lives only as long as the tab).
const EVERY = 20_000;

function newId() {
  const bytes = new Uint8Array(12);
  (globalThis.crypto || { getRandomValues: (b) => b.fill(Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
}

export const wording = (n) => `${n} playing`;

export function initOnline(el) {
  if (!el) return;
  let id;
  try { id = sessionStorage.getItem('dj_here') || ''; } catch { id = ''; }
  if (!/^[a-z0-9]{8,40}$/i.test(id)) {
    id = newId();
    try { sessionStorage.setItem('dj_here', id); } catch { /* the id lasts as long as this page */ }
  }
  const say = async (leave) => {
    try {
      const res = await fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(leave ? { id, leave: true } : { id }), keepalive: !!leave });
      if (!res.ok || leave) return;
      const { online } = await res.json();
      if (Number.isFinite(online) && online > 0) { el.textContent = wording(online); el.hidden = false; }
    } catch { el.hidden = true; /* no server to ask: no footnote */ }
  };
  say();
  setInterval(() => { if (document.visibilityState === 'visible') say(); }, EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') say(); });
  addEventListener('pagehide', () => { try { navigator.sendBeacon('/api/presence', new Blob([JSON.stringify({ id, leave: true })], { type: 'application/json' })); } catch { /* it times out on its own */ } });
}
