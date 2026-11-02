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

The hero mark is `public/img/disc-jerkers-logo.png` (and `-sm.png` for
phones): the Disc Jerkers logo recoloured to **white line art on
transparency**, which is why it only works on a dark surface. The logo comes
as black art; to regenerate the web copies from it, keep its alpha and paint
the lines white:

```bash
convert logo-black.png -fill white -colorize 100 -resize 1100x -strip PNG32:public/img/disc-jerkers-logo.png
convert logo-black.png -fill white -colorize 100 -resize 480x  -strip PNG32:public/img/disc-jerkers-logo-sm.png
```

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
ssh dibberlab-droplet "cd /etc/nginx && git add -A && git commit -m 'add discjerkers.com' && git push origin main"
ssh dibberlab-droplet "cd /var/www/discjerkers && docker compose up -d"
```

Check `3040` is free on the box first, and check whether discjerkers.com should
use a Cloudflare origin cert or certbot — match whatever the other external
domains there already do.

## Auto-deploy

Every push to `main` runs `.github/workflows/deploy.yml`: the tests, then (only
if they pass) an SSH to the droplet that runs `discjerkers-deploy`. That script
(`deploy/discjerkers-deploy`) pulls `main`, runs `docker compose up -d --build`
and waits for `/healthz`; the run goes red if the site does not come back.
`.env` and `data/` are gitignored, so a deploy never touches orders, accounts,
photos or matches. nginx is not part of it. It can also be run by hand from
the Actions tab (*Run workflow*). Same pattern as DibberLab/budget.

One-time setup on the droplet (as root):

```bash
# 1. Make the app folder a git checkout (it was rsynced). .env and data/ stay.
cd /var/www/discjerkers
git init -b main && git remote add origin https://github.com/DibberLab/discjerkers.git
git fetch origin main && git reset --hard origin/main

# 2. Install the deploy script.
install -m 755 deploy/discjerkers-deploy /usr/local/bin/discjerkers-deploy

# 3. A key that can only ever run that script.
ssh-keygen -t ed25519 -N '' -C discjerkers-deploy -f /root/.ssh/discjerkers_deploy
echo "command=\"/usr/local/bin/discjerkers-deploy\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat /root/.ssh/discjerkers_deploy.pub)" >> /root/.ssh/authorized_keys
cat /root/.ssh/discjerkers_deploy   # -> DEPLOY_SSH_KEY secret, then delete it from the server
rm /root/.ssh/discjerkers_deploy
```

Then in GitHub, repo Settings → Secrets and variables → Actions, add:

- `DEPLOY_SSH_KEY`: the private key printed above.
- `DEPLOY_HOST`: the droplet's IP or hostname.
- `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan -t ed25519 <host>`, run from
  your own machine.

If budget's secrets already point at the same droplet, `DEPLOY_HOST` and
`DEPLOY_KNOWN_HOSTS` can be the same values; the key must be the new one,
since each key is locked to one script. If the deploy script ever changes,
re-run step 2 (the server runs its installed copy, not the repo's).

## Cloudflare notes

- Keep the proxy **on** (orange cloud) for normal traffic.
- `/webhook/stripe` must reach the origin unmodified. Cloudflare passes POST
  bodies through fine, but if you ever add a WAF rule or "Bot Fight Mode" that
  challenges it, Stripe's webhook will start failing silently — exclude that
  path.
