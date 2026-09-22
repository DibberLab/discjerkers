'use strict';

const express = require('express');
const config = require('../config');
const printify = require('../lib/printify');
const store = require('../lib/store');
const { client: stripe } = require('../lib/stripe');

const router = express.Router();

/**
 * Stripe webhook. Must receive the RAW body, so this router is mounted before
 * express.json() in server/index.js.
 *
 * checkout.session.completed is the moment money is confirmed — that's when the
 * order is handed to Printify. Everything is idempotent on the session id so a
 * replayed event never double-orders.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe not configured');

  let event;
  try {
    if (config.stripe.webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], config.stripe.webhookSecret);
    } else {
      // No secret set (local tinkering only). Never run production this way.
      console.warn('[webhook] STRIPE_WEBHOOK_SECRET is unset — signature NOT verified');
      event = JSON.parse(req.body.toString('utf8'));
    }
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Acknowledge fast; Stripe retries on timeout and we don't want a slow
  // Printify call to cause a duplicate delivery.
  res.json({ received: true });

  if (event.type !== 'checkout.session.completed') return;

  const session = event.data.object;
  try {
    await fulfill(session);
  } catch (err) {
    console.error('[webhook] fulfillment failed for session', session.id, err);
    store.recordOrder({
      id: session.id,
      status: 'failed',
      error: err.message,
      printifyBody: err.body || null,
    });
  }
});

async function fulfill(session) {
  const existing = store.getOrder(session.id);
  if (existing && existing.status === 'submitted') {
    console.log('[webhook] session already fulfilled, skipping', session.id);
    return;
  }

  const cartToken = session.metadata?.cart_token || session.client_reference_id;
  const cart = cartToken ? store.getCart(cartToken) : null;
  if (!cart) throw new Error(`No stored cart for session ${session.id} (token ${cartToken})`);

  const shipping = extractShipping(session);
  if (!shipping) throw new Error(`No shipping address on session ${session.id}`);

  const [firstName, ...rest] = String(shipping.name || 'Customer').trim().split(/\s+/);
  const addressTo = {
    first_name: firstName || 'Customer',
    last_name: rest.join(' ') || '-',
    email: session.customer_details?.email || '',
    phone: session.customer_details?.phone || '',
    country: shipping.address.country,
    region: shipping.address.state || '',
    address1: shipping.address.line1 || '',
    address2: shipping.address.line2 || '',
    city: shipping.address.city || '',
    zip: shipping.address.postal_code || '',
  };

  const lineItems = cart.lines.map((l) => ({
    product_id: l.productId,
    variant_id: Number(l.variantId),
    quantity: l.quantity,
  }));

  const order = await printify.createOrder({
    externalId: session.id,
    label: `DJ-${String(session.id).slice(-8).toUpperCase()}`,
    lineItems,
    addressTo,
    shippingMethod: 1,
  });

  const printifyOrderId = order?.id || order;
  console.log('[webhook] Printify order created:', printifyOrderId);

  let production = 'on-hold';
  if (config.printify.autoProduction) {
    await printify.sendToProduction(printifyOrderId);
    production = 'sent-to-production';
    console.log('[webhook] sent to production:', printifyOrderId);
  }

  store.recordOrder({
    id: session.id,
    status: 'submitted',
    production,
    printifyOrderId,
    email: session.customer_details?.email || null,
    amountTotal: session.amount_total,
    currency: session.currency,
    lines: cart.lines,
    addressTo,
  });
}

/** Stripe moved shipping_details under collected_information in newer API versions. */
function extractShipping(session) {
  const s = session.collected_information?.shipping_details || session.shipping_details || session.shipping;
  if (!s || !s.address) return null;
  return { name: s.name || session.customer_details?.name, address: s.address };
}

module.exports = router;
