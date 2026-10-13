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

- A disc golf game: bring your bag (or a starter bag), pick a disc, set the same flight settings as the
  guide, aim, then a throw meter; inside 50 ft it is a one-tap putt. Solo play is a static page: the bag comes from
  the account API, scores are in `localStorage`. Linked from the nav as the "Play now" button.
- `public/js/flightmodel.js` is the flight physics, **shared** with the flight guide. `test/flightmodel.test.js`
  holds 400 throws captured from the guide before the split; do not change a number without meaning to change the
  guide too.
- `public/js/gamecore.js` is the rules and has no clock, randomness or drawing, so a throw always lands the same way
  and `test/gamecore.test.js` can play the hole headless (it includes a bot that has to be able to make par).
  `course.js` is hole data: add a hole by adding an entry to `HOLES`. `game.js` is only the view.
- The course is 18 holes, each its own layout, built by `build()` in `course.js` from a spec in the hole's own terms: a
  route (`trail(heading, hw, legs)`: any direction, doglegs, an S, a U-turn) and features placed by `s` (feet along the
  route) and `o` (feet right of its centerline): `woods`, `trees`, `shrubs` (low, throw over), `groves`, `rows`, `walls`
  with gates, `ponds`, `creeks` with a dry ford, `oob` zones, a `note` the caddy shows on the first throw. A disc is a
  point and a trunk stops it within 3/4 of its radius, so a solid wall needs a tree every ~5 ft. `routeLeft(hole, x, y)`
  is how far is left along the route (for judging progress on a hole that turns away from the basket).
  `test/gamecore.test.js` checks every hole (trees not in ponds, tee and basket clear) and has a bot play each one around
  the route: **a new or changed hole must stay solvable in par**, and a short way across must not exist where the hole
  is meant to turn (the bot finds it). A round is a practice hole, the front nine, or all eighteen, with a scorecard;
  discs Marebear eats stay eaten for the round.
- The throw meter is four taps for every full throw, in order: **power, spin, angle, release**. Arm speed, spin and hyzer are NOT settings: where the marker stops on each of the first three bars is the value. Hand, style and aim are set first;
  a putt is one tap on a swirling circular green (the dot's path is seeded and never repeats, and a miss goes the way
  the dot was). Only the release is a skill test (`sanitizeExecution` is what a server accepts back for it); the other
  three are choices, and `sanitizeSettings` range-checks them.
- The power, spin and angle bars each show a **sweet spot** (`sweetSpots`/`sweetBands` in `gamecore.js`): the values that
  land within 20 ft of the best landing there is, from here, for the aim and the bars already set (power assumes the best
  angle and the usual spin). It plays candidates through `resolveThrow`, so trees and water count. It is only a guide
  drawn on the bar: nothing about it is sent to or trusted by the server.
- A slow arm can slip (`slipChance`/`rollSlip`/`applySlip` in `gamecore.js`): below 66 mph (Intermediate Plus) there is a
  growing chance of a **grip lock** (short, hooks to the fade side) or an **early release** (flat, to the turn side);
  more for fast discs, odd spin, extreme angles. The core never rolls: solo rolls in the browser, and in a match the
  **server rolls** (browsers cannot hand themselves or dodge a slip; `sanitizeExecution` drops it).
- Marebear eats the disc you just threw, once per hole, the first time you are at a triple bogey or worse and have
  not holed out. That rule lives in `applyResult` and is tested; the bear is drawn in `drawBear`.
- **Matches** (`/api/game`, `server/routes/game.js`, `server/lib/matches.js`): two to **eight** signed-in players. The host
  picks 9 or 18 holes, shares the 6-letter code or link (`/game?match=CODE`; naming a player also puts it in their lobby,
  but the code is what lets anyone in), and **starts** it once at least two are seated (`POST /matches/:id/start`). Turn by
  turn, the player farthest from the basket throws next; on a tie (everyone, on the tee) whoever has waited longest, then
  the honor order: shuffled on hole 1, then best score on the last hole first. **Everyone sees every throw**: each move is
  pushed to every seated player over SSE, and each browser animates the newest move whoever threw it. Leaving a match
  that has not started takes your seat (the host leaving hands it to the next player); leaving one in play forfeits your
  place and the rest play on, the last one standing wins. The **server is authoritative about the result**: it re-plans and re-resolves every throw
  with the same `flightmodel`/`gamecore`/`course` modules the browser uses (loaded by dynamic `import()` in
  `loadGameplay()`), so a client cannot report a lie about where the disc landed, and it rolls the slips. The meter itself is honor system:
  `sanitizeSettings`/`sanitizeExecution` clamp what a browser may claim, but a player can still claim perfect
  execution. Bags are snapshotted at join (ids and color only; photos stay private). Marebear applies per player.
  Live updates are SSE like the change log (keep `X-Accel-Buffering: no` and the ping).
  Matches live in `data/matches.json` (gitignored, atomic writes, fail-soft like accounts): back it up with
  `accounts.json`. Limits: 6 open matches per user, unstarted matches expire after 24h, finished ones are kept 14 days.
- **The woods are solid.** A disc is a point and a trunk stops it within 0.9 of its radius, so `woods` put a tree every
  6-8 ft (a wall) and the tee is boxed in behind: you play down the fairway, not any way you like. Only features you
  design (`gaps`, `shrubs`, low guard trees) are ways through. A tree you hit is out of the way of your next throw (the
  lie remembers it as `t`), so nobody is stuck. `test/gamecore.test.js` throws every way off the tee and checks the
  woods stop nearly all of it.
- **Marebear heckles** (`public/js/trash.js`): the game talking, not a chat. `eventFor` turns a throw into an event (shank,
  splash, tree, grip lock, ace...), `remark`/`holeRemark`/`matchRemark` pick a line; she never repeats the last one. The
  owner's own lines live in `public/data/heckles.json` (from their Heckles.csv; categories Birdie, Par, Bogey, Double Bogey,
  Eagle, Going in the Water, Hitting a Tree) and are used for those events; they are second person, so on somebody else's
  throw they are shown "to" that player by name. Everything else (shanks, slips, out of bounds, match results) still uses the
  built-in lines in trash.js. To change her mind about a category, edit the JSON (`test/trash.test.js` checks its shape).
- **Aim goes any way** (`AIM_MAX` 180 in game.js, ±180 on the server): some holes turn away from the basket.
- **Phone layout** (≤900px): the hole fills the screen and the controls are a dock along the bottom (`.gm-panel` is an
  overlay; `S.dock` is its height and `midY()` centers the camera in what is left). A throw is set up in steps (Disc, Grip,
  Aim, then the four meters); caddy notes and Marebear's remarks float over the hole (`#gm-bubble`) instead of sitting in
  the panel. Desktop keeps the one side panel.
- **3D flight camera (preview)** (`public/js/cam3d.js`): a thrown disc can be watched from behind it, in perspective, on the same
  canvas: ground shapes (fairway stripes, water, out of bounds) are projected polygons clipped at the near plane, trees and the
  basket (with a tall flag) are billboards sorted by depth, and a chase camera (`follow`) eases after the disc and banks into
  turns. It is a **preview**: off for everyone unless they open `/game?cam=3d` (remembered in localStorage `dj_cam`; a "3D on/off"
  chip then shows over the hole; `?cam=off` forgets it). Putts stay on the map. Tapping the hole skips the ride. When the
  preview is judged good, flip the default in `loadCam()` in game.js.
- Modules import each other with `?v=N`: bump it when a module changes, or cached copies mix with new ones.
  `public/js/package.json` says `type: module` so Node can import these files in tests.

## Deploy

Droplet, `/var/www/discjerkers`, docker compose behind nginx on 127.0.0.1:3040.
Follow the dibberlab server-ops discipline: `nginx -t` → reload → commit and
push `/etc/nginx` **from the server**. See README.md for the full sequence.
