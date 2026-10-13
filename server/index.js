'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const printify = require('./lib/printify');
const { createChangeStore } = require('./lib/changes');
const { createChangesRouter } = require('./routes/changes');
const { createAccountStore } = require('./lib/accounts');
const { createAccountRouter } = require('./routes/account');
const { createMatchStore, loadGameplay } = require('./lib/matches');
const { createGameRouter } = require('./routes/game');

const changes = createChangesRouter({ store: createChangeStore(path.join(__dirname, '..', 'data', 'changes.json')) });

// the flight guide's disc ids, so a bag can only hold discs that exist (if the file can't be read, any id passes)
let knownDiscs = null;
try {
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'flightguide.json'), 'utf8'));
  knownDiscs = new Set(guide.discs.map((row) => row[0]));
} catch (err) {
  console.error('[accounts] could not read the disc list:', err.message);
}
const accountStore = createAccountStore(path.join(__dirname, '..', 'data', 'accounts.json'));
const accounts = createAccountRouter({ store: accountStore, knownDiscs });

// head-to-head matches: the rules and course are the browser's own modules, loaded once
const gameplay = loadGameplay();
gameplay.catch((err) => console.error('[game] could not load the game rules:', err.message));
const game = createGameRouter({ accounts: accountStore, matches: createMatchStore(path.join(__dirname, '..', 'data', 'matches.json')), gameplay });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Webhook first — it needs the raw request body.
app.use('/webhook', require('./routes/webhook'));

app.use(express.json({ limit: '128kb' }));
app.use('/api/changes', changes);
app.use('/api/account', accounts);
app.use('/api/game', game);
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
  process.on(sig, () => {
    changes.closeStreams();
    game.closeStreams();
    server.close(() => process.exit(0));
  });
}

module.exports = app;
