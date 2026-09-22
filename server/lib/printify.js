'use strict';

const config = require('../config');
const { normalizeProduct, DEMO_PRODUCTS } = require('./catalog');

const UA = 'DiscJerkers/0.1 (+https://discjerkers.com)';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = { products: null, fetchedAt: 0 };
let resolvedShopId = null;

class PrintifyError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'PrintifyError';
    this.status = status;
    this.body = body;
  }
}

async function api(pathname, { method = 'GET', body } = {}) {
  if (config.demoMode) throw new PrintifyError('Printify is not configured (demo mode)', 503, null);

  const res = await fetch(`${config.printify.base}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.printify.token}`,
      'Content-Type': 'application/json;charset=utf-8',
      'User-Agent': UA,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    const msg = (parsed && (parsed.message || parsed.error)) || `Printify ${method} ${pathname} failed`;
    throw new PrintifyError(msg, res.status, parsed);
  }
  return parsed;
}

async function getShopId() {
  if (config.printify.shopId) return config.printify.shopId;
  if (resolvedShopId) return resolvedShopId;
  const shops = await api('/shops.json');
  if (!Array.isArray(shops) || shops.length === 0) {
    throw new PrintifyError('No shops found on this Printify account', 404, shops);
  }
  resolvedShopId = String(shops[0].id);
  console.log(`[printify] using shop "${shops[0].title}" (id ${resolvedShopId}). Pin PRINTIFY_SHOP_ID to lock it.`);
  return resolvedShopId;
}

/** All visible, purchasable products. Cached for CACHE_TTL_MS. */
async function listProducts({ force = false } = {}) {
  if (config.demoMode) return DEMO_PRODUCTS;
  if (!force && cache.products && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.products;

  const shopId = await getShopId();
  const all = [];
  let page = 1;
  // Printify paginates at 50/page by default; walk until a short page comes back.
  while (page <= 20) {
    const res = await api(`/shops/${shopId}/products.json?limit=50&page=${page}`);
    const chunk = Array.isArray(res) ? res : res.data || [];
    all.push(...chunk);
    if (chunk.length < 50) break;
    page += 1;
  }

  const products = all
    .map(normalizeProduct)
    .filter((p) => p.visible && p.variants.length > 0);

  cache = { products, fetchedAt: Date.now() };
  return products;
}

async function getProduct(id) {
  if (config.demoMode) return DEMO_PRODUCTS.find((p) => p.id === String(id)) || null;
  const shopId = await getShopId();
  try {
    return normalizeProduct(await api(`/shops/${shopId}/products/${id}.json`));
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/**
 * Ask Printify what shipping costs for these line items to this address.
 * Returns cents for each method, or null if the quote can't be obtained.
 */
async function quoteShipping(lineItems, addressTo) {
  if (config.demoMode) return null;
  const shopId = await getShopId();
  try {
    const res = await api(`/shops/${shopId}/orders/shipping.json`, {
      method: 'POST',
      body: { line_items: lineItems, address_to: addressTo },
    });
    return res && typeof res === 'object' ? res : null;
  } catch (err) {
    console.warn('[printify] shipping quote failed, falling back to flat rate:', err.message);
    return null;
  }
}

/** Submit a paid order. lineItems: [{product_id, variant_id, quantity}] */
async function createOrder({ externalId, label, lineItems, addressTo, shippingMethod = 1 }) {
  const shopId = await getShopId();
  return api(`/shops/${shopId}/orders.json`, {
    method: 'POST',
    body: {
      external_id: externalId,
      label,
      line_items: lineItems,
      shipping_method: shippingMethod,
      is_printify_express: false,
      is_economy_shipping: false,
      send_shipping_notification: true,
      address_to: addressTo,
    },
  });
}

async function sendToProduction(orderId) {
  const shopId = await getShopId();
  return api(`/shops/${shopId}/orders/${orderId}/send_to_production.json`, { method: 'POST' });
}

function invalidateCache() { cache = { products: null, fetchedAt: 0 }; }

module.exports = {
  PrintifyError,
  listProducts,
  getProduct,
  quoteShipping,
  createOrder,
  sendToProduction,
  getShopId,
  invalidateCache,
};
