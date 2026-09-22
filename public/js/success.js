import { api, clearCart, money } from './site.js?v=2';

const root = document.querySelector('[data-success]');
const sessionId = new URLSearchParams(location.search).get('session_id');

clearCart();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function poll(attempt = 0) {
  if (!sessionId) {
    root.innerHTML = '<p class="muted">No order reference found. If you were charged, check your email for the receipt.</p>';
    return;
  }
  try {
    const data = await api(`/api/orders/by-session/${encodeURIComponent(sessionId)}`);
    if (data.status === 'submitted') {
      root.innerHTML = `
        <p class="lede">It's at the printer${data.email ? `, and a receipt is on its way to <strong>${esc(data.email)}</strong>` : ''}. Rule 6 says we shouldn't email you. We broke rule 6.</p>
        ${data.items?.length ? `<ul style="margin:20px 0;padding-left:20px">${data.items.map((i) => `<li>${esc(i.title)} — ${esc(i.variantTitle)} × ${i.quantity}</li>`).join('')}</ul>` : ''}
        ${data.total != null ? `<p><strong>Total paid: ${money(data.total, data.currency)}</strong></p>` : ''}
        <p class="muted" style="font-size:0.9rem">Order reference: ${esc(sessionId.slice(-12))}</p>`;
      return;
    }
    if (data.status === 'failed') {
      root.innerHTML = `<div class="notice"><strong>Payment went through, but handing it to the printer did not.</strong> We've been alerted and will sort it out. Reply to your receipt email and we'll confirm.</div>`;
      return;
    }
  } catch { /* retry below */ }

  if (attempt < 10) {
    setTimeout(() => poll(attempt + 1), 1500);
  } else {
    root.innerHTML = '<p class="muted">Payment received. Your confirmation email is on the way — it can take a minute for the order to appear.</p>';
  }
}

root.innerHTML = '<p class="muted">Confirming your order…</p>';
poll();
