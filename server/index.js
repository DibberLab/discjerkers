'use strict';

const path = require('node:path');
const express = require('express');
const config = require('./config');
const printify = require('./lib/printify');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Webhook first — it needs the raw request body.
app.use('/webhook', require('./routes/webhook'));

app.use(express.json({ limit: '128kb' }));
app.use('/api', require('./routes/api'));

app.get('/healthz', (req, res) => res.json({ ok: true, demoMode: config.demoMode }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Unknown API path -> JSON 404; anything else -> the site's 404 page.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

const server = app.listen(config.port, () => {
  console.log(`\n  ${config.siteName} → http://localhost:${config.port}`);
  console.log(`  printify: ${config.demoMode ? 'DEMO CATALOG (no token set)' : 'live'}`);
  console.log(`  stripe:   ${config.checkoutEnabled ? 'enabled' : 'disabled (no secret key)'}`);
  if (!config.demoMode) {
    printify.getShopId().catch((err) => console.error('[printify] could not resolve shop id:', err.message));
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

module.exports = app;
