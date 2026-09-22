'use strict';

const path = require('node:path');

// Node 22 reads .env natively. Ignore if the file isn't there yet.
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env yet */ }

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d) => (String(v ?? '').trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

const config = {
  port: int(process.env.PORT, 3030),
  siteUrl: (process.env.SITE_URL || 'http://localhost:3030').replace(/\/+$/, ''),
  siteName: process.env.SITE_NAME || 'Disc Jerkers',

  printify: {
    token: process.env.PRINTIFY_API_TOKEN || '',
    shopId: process.env.PRINTIFY_SHOP_ID || '',
    autoProduction: bool(process.env.PRINTIFY_AUTO_PRODUCTION, false),
    base: 'https://api.printify.com/v1',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    automaticTax: bool(process.env.STRIPE_AUTOMATIC_TAX, false),
  },

  currency: (process.env.CURRENCY || 'usd').toLowerCase(),
  fallbackShippingCents: int(process.env.FALLBACK_SHIPPING_CENTS, 595),
};

// Demo mode: no Printify token means we serve a sample catalog so the site is
// browsable before any credentials exist.
config.demoMode = !config.printify.token;
config.checkoutEnabled = Boolean(config.stripe.secretKey);

module.exports = config;
