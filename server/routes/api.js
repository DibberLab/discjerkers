'use strict';

const express = require('express');
const config = require('../config');
const printify = require('../lib/printify');
const store = require('../lib/store');
const { client: stripe } = require('../lib/stripe');

const router = express.Router();

const SHIP_COUNTRIES = (process.env.SHIP_COUNTRIES || 'US')
  .split(',')
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

// Representative address used only to pre-quote a shipping rate before the
// customer has typed theirs. Printify's rates are flat per country.
const QUOTE_ADDRESS = {
  US: { country: 'US', region: 'CA', address1: '1 Market St', city: 'San Francisco', zip: '94105' },
  CA: { country: 'CA', region: 'ON', address1: '1 Yonge St', city: 'Toronto', zip: 'M5E1E5' },
  GB: { country: 'GB', region: '', address1: '1 High St', city: 'London', zip: 'SW1A1AA' },
};

router.get('/config', (req, res) => {
  res.json({
    siteName: config.siteName,
    currency: config.currency,
    demoMode: config.demoMode,
    checkoutEnabled: config.checkoutEnabled,
    shipCountries: SHIP_COUNTRIES,
  });
});

router.get('/products', async (req, res, next) => {
  try {
    res.json({ products: await printify.listProducts(), demoMode: config.demoMode });
  } catch (err) { next(err); }
});

router.get('/products/:id', async (req, res, next) => {
  try {
    const product = await printify.getProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) { next(err); }
});

/**
 * Validate a cart against the live catalog and price it server-side.
 * Client-supplied prices are never trusted.
 */
async function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('Cart is empty');
    err.status = 400;
    throw err;
  }
  const products = await printify.listProducts();
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];

  for (const item of items) {
    const product = byId.get(String(item.productId));
    if (!product) {
      const err = new Error(`Product ${item.productId} is no longer available`);
      err.status = 400;
      throw err;
    }
    const variant = product.variants.find((v) => String(v.id) === String(item.variantId));
    if (!variant) {
      const err = new Error(`That option of "${product.title}" is sold out`);
      err.status = 400;
      throw err;
    }
    const quantity = Math.max(1, Math.min(20, parseInt(item.quantity, 10) || 1));
    lines.push({
      productId: product.id,
      variantId: variant.id,
      quantity,
      title: product.title,
      variantTitle: variant.title,
      unitAmount: variant.price,
      image: (product.images.find((i) => i.isDefault) || product.images[0] || {}).src || null,
    });
  }
  return lines;
}

router.post('/cart/validate', async (req, res, next) => {
  try {
    const lines = await priceCart(req.body.items);
    const subtotal = lines.reduce((sum, l) => sum + l.unitAmount * l.quantity, 0);
    res.json({ lines, subtotal });
  } catch (err) { next(err); }
});

router.post('/checkout', async (req, res, next) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        error: 'Checkout is not configured yet. Add STRIPE_SECRET_KEY to .env to enable payments.',
      });
    }
    if (config.demoMode) {
      return res.status(503).json({
        error: 'Demo catalog cannot be purchased. Connect a Printify token to sell real products.',
      });
    }

    const lines = await priceCart(req.body.items);

    // Pre-quote shipping for the primary shipping country.
    const primary = SHIP_COUNTRIES[0] || 'US';
    const quote = await printify.quoteShipping(
      lines.map((l) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity })),
      QUOTE_ADDRESS[primary] || QUOTE_ADDRESS.US
    );
    const shippingCents = Number.isFinite(quote?.standard) ? quote.standard : config.fallbackShippingCents;

    const cartToken = store.saveCart({ lines, shippingCents });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: config.currency,
          unit_amount: l.unitAmount,
          product_data: {
            name: l.title,
            description: l.variantTitle,
            images: l.image && /^https?:/.test(l.image) ? [l.image] : undefined,
          },
        },
      })),
      shipping_address_collection: { allowed_countries: SHIP_COUNTRIES },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            display_name: 'Standard shipping',
            fixed_amount: { amount: shippingCents, currency: config.currency },
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 4 },
              maximum: { unit: 'business_day', value: 9 },
            },
          },
        },
      ],
      phone_number_collection: { enabled: true },
      automatic_tax: { enabled: config.stripe.automaticTax },
      client_reference_id: cartToken,
      metadata: { cart_token: cartToken },
      success_url: `${config.siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.siteUrl}/cart.html?canceled=1`,
    });

    res.json({ url: session.url, id: session.id });
  } catch (err) { next(err); }
});

/** Success page lookup — only ever returns what the buyer already knows. */
router.get('/orders/by-session/:sessionId', async (req, res, next) => {
  try {
    const record = store.getOrder(req.params.sessionId);
    if (!record) return res.json({ status: 'pending' });
    res.json({
      status: record.status,
      printifyOrderId: record.printifyOrderId || null,
      email: record.email || null,
      total: record.amountTotal ?? null,
      currency: record.currency || config.currency,
      items: (record.lines || []).map((l) => ({ title: l.title, variantTitle: l.variantTitle, quantity: l.quantity })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
