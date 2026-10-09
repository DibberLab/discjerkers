# discjerkers — notes for Claude

Storefront for discjerkers.com. Node 22 + Express, **no build step and no
framework** — the front-end is plain ES modules served from `public/`. Keep it
that way; don't introduce React/Vite/Tailwind here.

## Ground rules

- **Never trust client-supplied prices.** `priceCart()` in `server/routes/api.js`
  re-reads every line item from the live Printify catalog and prices it
  server-side. Any new checkout path must go through it.
- **The webhook is the only thing that creates Printify orders.** Not the
  success page, not the client. It is idempotent on the Stripe session id
  (`store.getOrder(session.id)`), because Stripe retries.
- `server/routes/webhook.js` must stay mounted **before** `express.json()` in
  `server/index.js` — signature verification needs the raw body.
- Secrets live in `.env` only. `.env` is gitignored; `.env.example` documents
  the keys with no values. Never paste a real token into a file that gets
  committed.
- No native dependencies (no better-sqlite3 etc.) — this repo is developed on
  macOS and runs in an Alpine container, and `data/*.json` via `lib/store.js` is
  enough for carts and order records at this volume.

## Modes

- **Demo mode** — no `PRINTIFY_API_TOKEN`. Serves `DEMO_PRODUCTS` from
  `server/lib/catalog.js` and refuses checkout. This is what makes the site
  reviewable before credentials exist; don't remove it.
- **Live** — token present. Products are cached in memory for 5 minutes
  (`printify.invalidateCache()` clears it).

## Printify shapes worth remembering

- Prices are **integer cents**.
- Variant titles are `"Color / Size"`; `public/js/product.js` splits on `/` to
  build the option pickers and disables combinations that don't exist.
- Only variants with `is_enabled` are sellable; only `visible` products are
  listed.
- Order line items use `variant_id` as a **number**, and `product_id` as a
  string.
- Orders land `on-hold` unless sent to production (`PRINTIFY_AUTO_PRODUCTION`).

## Brand rules

- Dark base only. The hero art (`public/img/death-by-disc.png`) is **white line
  art on transparency** — it disappears on a light surface. Don't introduce a
  light theme without replacing the art.
- Glow Lime `#a3e635` is an accent: eyebrows, stat numbers, hovers, selected
  chips. It is never a background for a large area and never body text.
- Rust `#d35400` carries actions (buttons, prices, rule numbers). Pine is
  structure and glow, not type.
- Anton for display (always uppercase), Archivo for body, Space Mono for
  labels/nav/prices.
- No crew member names on the site. The brand doc has a roster; it stays off.
- Rule 6 ("the store must crash at checkout") is a joke. The store works and
  sends receipts. Copy may reference it; code must never implement it.

## Change-control log (/change-control)

- A public, **unauthenticated** page: anyone can file a request and approve, deny, or
  reopen one. Names are self-reported (honor system). `server/routes/changes.js`,
  `server/lib/changes.js`; records live in `data/changes.json` (gitignored, in the data
  volume, so back it up like orders).
- It shares the Node process with checkout, so it must never be able to take the store
  down: an unreadable log goes read-only instead of failing startup. Keep it that way.
- Abuse guards: hourly per-visitor limits (X-Real-IP from nginx), length caps, a honeypot
  field, and text-only rendering. Never put user text in `innerHTML` without `esc()`.
- Live updates are server-sent events. Keep `X-Accel-Buffering: no` and the `ping` event:
  the page's watchdog reconnects if pings stop, because a dead connection can look healthy.
- No delete in the UI. To remove an entry, edit `data/changes.json` and restart the container
  (the server holds the log in memory).

## Deploy

Droplet, `/var/www/discjerkers`, docker compose behind nginx on 127.0.0.1:3040.
Follow the dibberlab server-ops discipline: `nginx -t` → reload → commit and
push `/etc/nginx` **from the server**. See README.md for the full sequence.
