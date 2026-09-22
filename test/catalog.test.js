'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeProduct, stripHtml, DEMO_PRODUCTS } = require('../server/lib/catalog');

const RAW = {
  id: '5d39b159e7c48c000728c89f',
  title: 'Ace Run Tee',
  description: '<p>Heavyweight <b>cotton</b> tee.</p><p>Runs true.</p>',
  visible: true,
  tags: ['Tees'],
  options: [{ name: 'Color', type: 'color', values: [] }, { name: 'Size', type: 'size', values: [] }],
  images: [
    { src: 'https://img/1.png', variant_ids: [1, 2], is_default: true },
    { src: 'https://img/2.png', variant_ids: [3] },
  ],
  variants: [
    { id: 1, title: 'Black / S', price: 2800, sku: 'a', is_enabled: true, is_available: true },
    { id: 2, title: 'Black / M', price: 2800, sku: 'b', is_enabled: true, is_available: true },
    { id: 3, title: 'Black / 3XL', price: 3200, sku: 'c', is_enabled: true, is_available: true },
    { id: 4, title: 'Black / L', price: 2800, sku: 'd', is_enabled: false, is_available: true },
    { id: 5, title: 'Black / XL', price: 2800, sku: 'e', is_enabled: true, is_available: false },
  ],
};

test('drops variants that are disabled or unavailable', () => {
  const p = normalizeProduct(RAW);
  assert.deepStrictEqual(p.variants.map((v) => v.id), [1, 2, 3]);
});

test('price range comes from sellable variants only', () => {
  const p = normalizeProduct(RAW);
  assert.strictEqual(p.minPrice, 2800);
  assert.strictEqual(p.maxPrice, 3200);
});

test('id is stringified and images keep their default flag', () => {
  const p = normalizeProduct(RAW);
  assert.strictEqual(typeof p.id, 'string');
  assert.strictEqual(p.images[0].isDefault, true);
  assert.strictEqual(p.images[1].isDefault, false);
});

test('description is flattened to readable text', () => {
  const p = normalizeProduct(RAW);
  assert.strictEqual(p.description, 'Heavyweight cotton tee.\n\nRuns true.');
});

test('stripHtml unescapes entities', () => {
  assert.strictEqual(stripHtml('<p>Tees &amp; hats &quot;now&quot;</p>'), 'Tees & hats "now"');
});

test('a product with no sellable variants has no price', () => {
  const p = normalizeProduct({ ...RAW, variants: [] });
  assert.strictEqual(p.minPrice, null);
  assert.strictEqual(p.variants.length, 0);
});

test('demo catalog is well formed', () => {
  assert.ok(DEMO_PRODUCTS.length > 0);
  for (const p of DEMO_PRODUCTS) {
    assert.ok(p.id && p.title, 'has id and title');
    assert.ok(p.variants.length > 0, `${p.id} has variants`);
    assert.ok(p.variants.every((v) => Number.isInteger(v.price)), `${p.id} prices are integer cents`);
    // variant titles must split into as many parts as there are options,
    // otherwise the product page can never resolve a full selection
    const parts = p.variants[0].title.split('/').length;
    assert.strictEqual(parts, p.options.length, `${p.id} option columns match variant title parts`);
  }
});

test('demo variant ids are unique within a product', () => {
  for (const p of DEMO_PRODUCTS) {
    const ids = p.variants.map((v) => v.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${p.id} has unique variant ids`);
  }
});
