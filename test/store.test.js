'use strict';

const test = require('node:test');
const assert = require('node:assert');
const store = require('../server/lib/store');

test('a saved cart comes back by token', () => {
  const token = store.saveCart({ lines: [{ productId: 'p1', variantId: 9, quantity: 2 }], shippingCents: 595 });
  const cart = store.getCart(token);
  assert.strictEqual(cart.lines[0].productId, 'p1');
  assert.strictEqual(cart.shippingCents, 595);
});

test('an unknown token returns null rather than throwing', () => {
  assert.strictEqual(store.getCart('not-a-real-token'), null);
});

test('recording an order twice keeps one row, last write wins', () => {
  const id = `cs_test_${Date.now()}`;
  store.recordOrder({ id, status: 'failed', error: 'boom' });
  store.recordOrder({ id, status: 'submitted', printifyOrderId: 'abc123' });
  const rec = store.getOrder(id);
  assert.strictEqual(rec.status, 'submitted');
  assert.strictEqual(rec.printifyOrderId, 'abc123');
  assert.strictEqual(store.listOrders().filter((o) => o.id === id).length, 1);
});
