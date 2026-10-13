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

## Accounts and bags (/flightguide)

- Optional sign-in for the flight guide only; checkout never touches it. Username + password, no
  email, so there is **no password reset** (a forgotten password means editing `data/accounts.json`
  by hand: delete the user, or have them make a new account). `server/lib/accounts.js`,
  `server/routes/account.js`, `public/js/fgaccount.js`; records live in `data/accounts.json`
  (gitignored, mode 0600, in the data volume: back it up like orders).
- Passwords are scrypt hashes (node:crypto, no dependency). Sessions are random tokens in an
  HttpOnly, SameSite=Lax cookie (`dj_session`, Secure behind the proxy); the file keeps only a hash
  of each token. Mutating routes also refuse a cross-site `Origin`.
- Like the change log it shares the process with checkout, so: an unreadable file makes accounts
  read-only (never fails startup), a failed save rolls back, and at most 2 password hashes run at once.
- Limits live in `LIMITS` (25 bags a user, 80 discs a bag, 5000 users). Wrong passwords are limited
  per address and per username; sign-ups per address. Never put user text in `innerHTML` without `esc()`.
- Per disc in a bag the owner can set a color, plastic type, weight (grams) and a photo (`bag.items[discId]`); a color or photo is used wherever the disc is drawn (chart, flight marker, bag view, compare).
  Photos: the page crops and re-encodes them to a ~640px JPEG (that also strips location data) and
  PUTs the bytes; the server only accepts a JPEG under 400KB (magic-byte check), keeps 150 per user,
  and stores them in `data/photos/<user id>/` (not under `public/`). They are served only to their
  owner by `GET /api/account/photos/:name`, `Cache-Control: private`. Removing a disc or deleting a
  bag deletes its photos. Back up `data/photos` along with `accounts.json`.
- A bag stores disc ids from `public/data/flightguide.json`. If that snapshot is ever regenerated,
  keep the ids stable or old bags will lose discs.

## The game (/game)

- A one-hole disc golf game: bring your bag (or a starter bag), pick a disc, set the same flight settings as the
  guide, aim, then a two-tap throw meter (power, then release); inside 50 ft it is a one-tap putt. Static page, no
  server state: the bag comes from the account API, scores are in `localStorage`. **Not linked from the nav yet.**
- `public/js/flightmodel.js` is the flight physics, **shared** with the flight guide. `test/flightmodel.test.js`
  holds 400 throws captured from the guide before the split; do not change a number without meaning to change the
  guide too.
- `public/js/gamecore.js` is the rules and has no clock, randomness or drawing, so a throw always lands the same way
  and `test/gamecore.test.js` can play the hole headless (it includes a bot that has to be able to make par).
  `course.js` is hole data: add a hole by adding an entry to `HOLES`. `game.js` is only the view.
- The course is 18 holes: hole 1 is hand-placed, 2-18 are built by `build()` in `course.js` from a short spec
  (length, bend, woods, ponds, creek, guards). A round is a practice hole, the front nine, or all eighteen, with a
  scorecard; discs Marebear eats stay eaten for the round. `test/gamecore.test.js` checks every hole (trees not in
  ponds, tee and basket clear) and has a bot play each one: **a new or changed hole must stay solvable in par.**
- The throw meter is a set of sliders: **a drive (disc speed 7+) gets four, in order: power, spin, angle, release**;
  slower discs get power and release; a putt is one tap on a swirling circular green (the dot's path is seeded and
  never repeats, and a miss goes the way the dot was). The player's own sliders plan the throw (arm speed, spin,
  angle, plus hand, style and aim); the meter is how well they pull it off. `sanitizeExecution` is what a server
  accepts back from the browser.
- Marebear eats the disc you just threw, once per hole, the first time you are at a triple bogey or worse and have
  not holed out. That rule lives in `applyResult` and is tested; the bear is drawn in `drawBear`.
- Modules import each other with `?v=N`: bump it when a module changes, or cached copies mix with new ones.
  `public/js/package.json` says `type: module` so Node can import these files in tests.

## Deploy

Droplet, `/var/www/discjerkers`, docker compose behind nginx on 127.0.0.1:3040.
Follow the dibberlab server-ops discipline: `nginx -t` → reload → commit and
push `/etc/nginx` **from the server**. See README.md for the full sequence.
