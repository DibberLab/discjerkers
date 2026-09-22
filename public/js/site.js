/* Shared storefront helpers: cart state, formatting, header wiring. */

const CART_KEY = 'dj_cart_v1';

export const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100);

export function readCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writeCart(items) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    /* private mode — cart just won't persist */
  }
  paintCartCount();
  return items;
}

export function addToCart(entry) {
  const items = readCart();
  const found = items.find(
    (i) => i.productId === entry.productId && String(i.variantId) === String(entry.variantId)
  );
  if (found) found.quantity = Math.min(20, found.quantity + entry.quantity);
  else items.push({ ...entry, quantity: Math.min(20, entry.quantity) });
  return writeCart(items);
}

export function setQuantity(productId, variantId, quantity) {
  const items = readCart()
    .map((i) =>
      i.productId === productId && String(i.variantId) === String(variantId)
        ? { ...i, quantity: Math.max(0, Math.min(20, quantity)) }
        : i
    )
    .filter((i) => i.quantity > 0);
  return writeCart(items);
}

export function removeFromCart(productId, variantId) {
  return writeCart(
    readCart().filter((i) => !(i.productId === productId && String(i.variantId) === String(variantId)))
  );
}

export function clearCart() {
  return writeCart([]);
}

export function cartCount() {
  return readCart().reduce((n, i) => n + i.quantity, 0);
}

export function paintCartCount() {
  const n = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach((el) => {
    el.textContent = n ? `Cart (${n})` : 'Cart';
  });
}

export async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let cachedConfig = null;
export async function siteConfig() {
  if (!cachedConfig) cachedConfig = await api('/api/config');
  return cachedConfig;
}

/** Shows the "demo catalog" banner on pages that have a slot for it. */
export async function paintDemoNotice() {
  const slot = document.querySelector('[data-demo-notice]');
  if (!slot) return;
  const cfg = await siteConfig().catch(() => null);
  if (!cfg?.demoMode) return;
  slot.innerHTML =
    '<div class="notice"><strong>Demo catalog.</strong> Placeholder product art so the design is reviewable. ' +
    'Add <code>PRINTIFY_API_TOKEN</code> to <code>.env</code> and restart to pull the real Printify shop.</div>';
}

export function productHref(id) {
  return `/product.html?id=${encodeURIComponent(id)}`;
}

export function priceLabel(product, currency) {
  if (product.minPrice == null) return '—';
  if (product.maxPrice && product.maxPrice !== product.minPrice) {
    return `${money(product.minPrice, currency)}+`;
  }
  return money(product.minPrice, currency);
}

export function primaryImage(product) {
  const img = (product.images || []).find((i) => i.isDefault) || (product.images || [])[0];
  return img?.src || '';
}

document.addEventListener('DOMContentLoaded', () => {
  paintCartCount();
  paintDemoNotice();
  const path = location.pathname.replace(/index\.html$/, '') || '/';
  document.querySelectorAll('.nav a').forEach((a) => {
    const href = a.getAttribute('href');
    if (href === path || (href !== '/' && path.startsWith(href))) a.setAttribute('aria-current', 'page');
  });
});
