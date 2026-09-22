import { api, money, readCart, setQuantity, removeFromCart, siteConfig, productHref } from './site.js?v=2';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const root = document.querySelector('[data-cart]');
let currency = 'usd';
let cfg = null;

async function render() {
  const items = readCart();

  if (!items.length) {
    root.innerHTML = `
      <div class="empty">
        <h2>Empty bag</h2>
        <p class="muted">Nothing in here. Somehow still four putters short of fixing your form.</p>
        <p style="margin-top:28px"><a class="btn" href="/shop.html">Shop the merch</a></p>
      </div>`;
    return;
  }

  root.innerHTML = '<p class="muted">Checking prices…</p>';

  let lines, subtotal;
  try {
    const priced = await api('/api/cart/validate', { method: 'POST', body: { items } });
    lines = priced.lines;
    subtotal = priced.subtotal;
  } catch (err) {
    root.innerHTML = `<div class="notice"><strong>Couldn't price your cart.</strong> ${esc(err.message)}</div>`;
    return;
  }

  root.innerHTML = `
    <div class="cart-layout">
      <div>
        <table class="cart-table">
          <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Total</th></tr></thead>
          <tbody>
            ${lines.map((l) => `
              <tr>
                <td>
                  <div class="cart-line">
                    ${l.image ? `<img src="${esc(l.image)}" alt="">` : ''}
                    <div>
                      <a href="${productHref(l.productId)}" style="font-weight:700;color:inherit;text-decoration:none">${esc(l.title)}</a>
                      <div class="cart-line__meta">${esc(l.variantTitle)} · ${money(l.unitAmount, currency)} each</div>
                      <button class="link-btn" data-remove data-p="${esc(l.productId)}" data-v="${esc(l.variantId)}">Remove</button>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="qty">
                    <button type="button" data-step="-1" data-p="${esc(l.productId)}" data-v="${esc(l.variantId)}" aria-label="Decrease">–</button>
                    <input type="text" inputmode="numeric" value="${l.quantity}" data-qty data-p="${esc(l.productId)}" data-v="${esc(l.variantId)}" aria-label="Quantity">
                    <button type="button" data-step="1" data-p="${esc(l.productId)}" data-v="${esc(l.variantId)}" aria-label="Increase">+</button>
                  </div>
                </td>
                <td style="text-align:right;font-weight:800">${money(l.unitAmount * l.quantity, currency)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <aside class="summary">
        <h3>The damage</h3>
        <div class="summary__row"><span>Subtotal</span><span>${money(subtotal, currency)}</span></div>
        <div class="summary__row"><span>Shipping</span><span class="muted">Calculated at checkout</span></div>
        <div class="summary__row"><span>Tax</span><span class="muted">Calculated at checkout</span></div>
        <div class="summary__row summary__row--total"><span>Total</span><span>${money(subtotal, currency)}+</span></div>
        <div style="margin-top:20px">
          <button class="btn btn--full" data-checkout>Checkout</button>
        </div>
        <p class="muted" data-checkout-note style="font-size:0.8rem;margin-top:16px;font-family:var(--mono);line-height:1.7">
          Secure payment by Stripe. Printed and shipped by Printify. It will not crash. We checked.
        </p>
      </aside>
    </div>`;

  wire();

  if (!cfg?.checkoutEnabled || cfg?.demoMode) {
    const btn = root.querySelector('[data-checkout]');
    const note = root.querySelector('[data-checkout-note]');
    btn.disabled = true;
    note.innerHTML = cfg?.demoMode
      ? 'Checkout is off while the demo catalog is showing. Connect Printify and Stripe in <code>.env</code> to take real orders.'
      : 'Checkout is off until <code>STRIPE_SECRET_KEY</code> is set in <code>.env</code>.';
  }
}

function wire() {
  root.querySelectorAll('[data-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = readCart().find((i) => i.productId === btn.dataset.p && String(i.variantId) === btn.dataset.v);
      setQuantity(btn.dataset.p, btn.dataset.v, (current?.quantity || 1) + Number(btn.dataset.step));
      render();
    });
  });

  root.querySelectorAll('[data-qty]').forEach((input) => {
    input.addEventListener('change', () => {
      setQuantity(input.dataset.p, input.dataset.v, parseInt(input.value, 10) || 0);
      render();
    });
  });

  root.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeFromCart(btn.dataset.p, btn.dataset.v);
      render();
    });
  });

  const checkout = root.querySelector('[data-checkout]');
  checkout?.addEventListener('click', async () => {
    checkout.disabled = true;
    checkout.textContent = 'Starting checkout…';
    try {
      const { url } = await api('/api/checkout', { method: 'POST', body: { items: readCart() } });
      location.href = url;
    } catch (err) {
      checkout.disabled = false;
      checkout.textContent = 'Checkout';
      root.querySelector('[data-checkout-note]').innerHTML = `<span style="color:var(--rust)">${esc(err.message)}</span>`;
    }
  });
}

(async () => {
  cfg = await siteConfig().catch(() => null);
  currency = cfg?.currency || 'usd';
  if (new URLSearchParams(location.search).get('canceled')) {
    const slot = document.querySelector('[data-demo-notice]');
    if (slot) slot.insertAdjacentHTML('beforeend', '<div class="notice"><strong>Checkout canceled.</strong> Your cart survived. Take the stroke and try again.</div>');
  }
  render();
})();
