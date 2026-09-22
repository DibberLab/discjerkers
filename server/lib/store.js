'use strict';

/**
 * Tiny JSON-file store. Deliberately dependency-free so the project runs the
 * same on macOS and in the deploy container (no native modules to rebuild).
 * Holds two things: pending carts (pre-checkout) and order records (post-pay).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CARTS_FILE = path.join(DATA_DIR, 'carts.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CART_TTL_MS = 24 * 60 * 60 * 1000;

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function read(file) {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function write(file, data) {
  ensure();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function saveCart(cart) {
  const carts = read(CARTS_FILE);
  const token = crypto.randomUUID();
  const now = Date.now();
  for (const [k, v] of Object.entries(carts)) {
    if (now - (v.createdAt || 0) > CART_TTL_MS) delete carts[k];
  }
  carts[token] = { ...cart, createdAt: now };
  write(CARTS_FILE, carts);
  return token;
}

function getCart(token) {
  return read(CARTS_FILE)[token] || null;
}

function recordOrder(record) {
  const orders = read(ORDERS_FILE);
  orders[record.id] = { ...record, recordedAt: new Date().toISOString() };
  write(ORDERS_FILE, orders);
  return orders[record.id];
}

function getOrder(id) {
  return read(ORDERS_FILE)[id] || null;
}

function listOrders() {
  return Object.values(read(ORDERS_FILE)).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
}

module.exports = { saveCart, getCart, recordOrder, getOrder, listOrders };
