# Disc Jerkers — discjerkers.com

Retro disc golf apparel store. Node + Express, no build step. Products come
live from **Printify**, payment is **Stripe Checkout**, and a Stripe webhook
hands the paid order back to Printify for fulfillment.

```
public/          static front-end (vanilla ES modules, no bundler)
server/
  config.js      env loading + demo/live mode flags
  index.js       express app
  lib/printify.js  Printify REST client (products, shipping quote, orders)
  lib/catalog.js   raw Printify -> storefront shape, plus the demo catalog
  lib/store.js     tiny JSON store: pending carts + placed orders
  routes/api.js    /api/* storefront endpoints
  routes/webhook.js Stripe webhook -> Printify order
data/            carts.json + orders.json (gitignored)
deploy/          nginx site config and the auto-deploy script for the droplet
shirts/          brand source art (.ai + PNG) — NOT deployed, see rsync excludes
```

## Brand

Dark sticker-punk. Palette straight from the brand spec: Chain-Rust Orange
`#d35400`, Tjader Pine `#1e3a1e`, Tuna-Can Grey `#7f8c8d`, Glow-In-The-Dark
Lime `#a3e635` on a near-black `#090c09` base. **Lime is an accent only** —
eyebrows, stats, hovers, selected states. It is a 10pm night round, not a
highlighter.

Type: Anton (display, all caps), Archivo (body), Space Mono (labels, nav,
prices, anything that should read like a scorecard).

The hero mark is `public/img/disc-jerkers-logo.png`: **white line art on a
transparent background**, which is why it only works on a dark surface.

### Changing the logo (no code, just GitHub)

1. Name the new file exactly `disc-jerkers-logo.png`. It must be a PNG, white
   on transparent, about 1000 to 2000 px wide.
2. On github.com open DibberLab/discjerkers → `public` → `img`.
3. **Add file → Upload files**, drop the file in (it replaces the old one),
   choose **Commit directly to the `main` branch**, and press **Commit changes**.
4. That's the deploy: the **Actions** tab shows it running, and the site has
   the new logo a few minutes later.

The server stamps the logo's address with a hash of the file when it starts
(`server/lib/homepage.js`), so nobody gets a cached old copy.

The old reaper-cat art (`death-by-disc.png`) is still in `public/img/`, unused.

Voice: self-deprecating, in on its own joke. The home page carries the six
Official Rules and the lexicon. No member names anywhere on the site.

## Run it locally

```bash
cp .env.example .env     # optional — it runs without one
npm install
npm run dev              # http://localhost:3030
```

With no `PRINTIFY_API_TOKEN` set, the site boots in **demo mode**: six
placeholder products so the design is browsable. Checkout is disabled there on
purpose.

## Going live, in order

1. **Printify token** — dashboard → My Profile → Connections → Personal Access
   Tokens. Scopes: `shops.read`, `products.read`, `orders.read`, `orders.write`.
   Put it in `.env` as `PRINTIFY_API_TOKEN`. Restart; the boot log prints the
   shop id it picked — paste that into `PRINTIFY_SHOP_ID` so it can't drift.
   Products must be **published** in Printify to appear here.
2. **Stripe** — `STRIPE_SECRET_KEY` from the Stripe dashboard. Prices shown to
   the customer are the retail prices set on each Printify variant, read
   server-side at checkout; the browser can't influence them.
3. **Webhook** — add an endpoint at `https://discjerkers.com/webhook/stripe`
   listening for `checkout.session.completed`, and put its signing secret in
   `STRIPE_WEBHOOK_SECRET`. Locally: `stripe listen --forward-to
   localhost:3030/webhook/stripe`.
   **Without the secret the webhook does not verify signatures** — never run
   production that way.
4. **Watch the first orders.** `PRINTIFY_AUTO_PRODUCTION=false` (the default)
   leaves each order sitting in Printify as *on hold* so you can eyeball it and
   press go yourself. Flip it to `true` once a few have gone through clean.

## Money and fulfillment, concretely

- Customer pays Stripe → Stripe takes its fee → the rest lands in your balance.
- The webhook submits the order to Printify, which charges **your** Printify
  payment method for production + shipping.
- Your margin is the Printify retail price minus Printify's cost minus Stripe's
  fee. Set retail prices in Printify with that in mind; this app never marks
  anything up on its own.

## Shipping and tax

Shipping is quoted from Printify for the primary country in `SHIP_COUNTRIES`
(default `US`) and presented as one flat Stripe shipping rate. If the quote call
fails, `FALLBACK_SHIPPING_CENTS` is used. To sell internationally, add countries
to `SHIP_COUNTRIES` — but note all of them then see the same quoted rate, so
either keep it US-only or raise the flat rate to cover the spread.

Tax is off unless `STRIPE_AUTOMATIC_TAX=true`, which requires Stripe Tax to be
enabled and your registrations configured in the Stripe dashboard.

## Deploying to the droplet

First-time install (after this, pushes to `main` deploy themselves: see
**Auto-deploy** below). See `deploy/discjerkers.nginx.conf`. Short version, following the usual
dibberlab pattern:

```bash
rsync -av --exclude node_modules --exclude .env --exclude data --exclude shirts ./ dibberlab-droplet:/var/www/discjerkers/
ssh dibberlab-droplet "cd /var/www/discjerkers && cp .env.example .env"   # then fill it in
ssh dibberlab-droplet "cp /var/www/discjerkers/deploy/discjerkers.nginx.conf /etc/nginx/sites-available/discjerkers"
ssh dibberlab-droplet "ln -s /etc/nginx/sites-available/discjerkers /etc/nginx/sites-enabled/discjerkers"
ssh dibberlab-droplet "nginx -t && systemctl reload nginx"
ssh dibberlab-droplet "cd /etc/nginx && git add sites-available/discjerkers sites-enabled/discjerkers && git commit -m 'add discjerkers.com' && git push origin main"
ssh dibberlab-droplet "cd /var/www/discjerkers && docker compose up -d"
```

Check `3040` is free on the box first, and check whether discjerkers.com should
use a Cloudflare origin cert or certbot — match whatever the other external
domains there already do.

## Auto-deploy

Every push to `main` deploys (`.github/workflows/deploy.yml`, the same setup as
discform): the tests run, and if they pass GitHub Actions SSHes to the droplet
with a key that `authorized_keys` locks to `/usr/local/bin/discjerkers-deploy`
(installed from `deploy/discjerkers-deploy.sh`: `git pull --ff-only`,
`docker compose up -d --build`, wait for `/healthz`, logs on failure). `.env`,
`data/` and nginx are never touched. Manual redeploy: Actions → Deploy → Run
workflow.

**One-time setup**, on Andrew's Mac, after this is on `main`:

```bash
bash deploy/setup-from-mac.sh
```

It backs up the app folder, turns it into a git checkout (it was rsynced),
shows what differs and asks before replacing anything, installs the script,
makes the deploy key and sets the three repo secrets (`DEPLOY_HOST`,
`DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`), then runs a test deploy. Safe to
re-run. The droplet's IP is read from the Mac's ssh config and only ever goes
into a secret: never commit it.

Not automatic: nginx (the script warns if `deploy/discjerkers.nginx.conf`
changed), new `.env` keys, and data migrations (back up `data/` first). Edit
`deploy/discjerkers-deploy.sh`? Re-run the setup (or its install line): the
server runs its installed copy, so a push can't change what root runs.
Cloudflare caches static files: bump `?v=N` on any changed `public/` file.

## Cloudflare notes

- Keep the proxy **on** (orange cloud) for normal traffic.
- `/webhook/stripe` must reach the origin unmodified. Cloudflare passes POST
  bodies through fine, but if you ever add a WAF rule or "Bot Fight Mode" that
  challenges it, Stripe's webhook will start failing silently — exclude that
  path.
