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
- **Planning the flight** (replaces the power, nose and angle meters for every non-putt throw; `PLAN`, `planRows`, `planText`, `setDisc` in `game.js`): three slim sliders beside the Throw
  button (a fourth tab, Flight, on a phone) set the **hyzer or anhyzer**, the **nose** and the **arm speed** directly (the same `settings.angle`, `nose`, `mph` the meters used, so the server
  and its range checks are unchanged), and the aim line over the ground (3D, or the map) is the throw as planned from a clean release (`previewThrow(..., plan)`), with a label for how far
  it goes, and the shaded band is where a mistimed release lands. A new disc brings the arm that gets it fully up to speed (`typicalArm`). Throw then goes **straight to the swing** (no release meter any more; a slow
  arm can still slip: the slip % is on the arm speed row). **A drive is judged on the gesture itself** (`gesture.js`, pure: `peakSpeed`, `gestureQuality`; `drivePower`, `releaseFrom` in `game.js`): how
  **fast the swing goes through** is the power (`drivePower`: the peak speed over 60+ ms against `driveSpeedNeed()`, which is the speed that matches the planned arm: harder arms need a faster swing;
  100% is exactly right; slower than about 75% is shorter, down to half; a swing at or past the planned arm speed is **full power** (`softSpeed` is `min(v, 1)`: the most the arm you set can give, never more and never loose; the guide says MAX, and the toast says full power, instead of a percentage over 100); a very short stroke or wind-up costs a little), and how **smooth the whole motion** was (a big wobble off straight, a speed
  that stutters instead of rising and falling once, a long stall at the bottom: each is free up to what a normal mouse, trackpad or finger does, then costs) is the release (`gestureQuality().rough`, signed by
  which way it bowed, times 0.55, fed to `readRelease`/`combine` with the arm's own zone, so a harder arm is harder to release *pure*; an ordinary hand comes out Pure or Good). The swing's own aim only steers
  past a 10 degree dead zone (`driveAim`). After the throw the toast and the result panel say what happened (`S.feel`: "Pure · 104% speed · 96% smooth", or what went wrong: wandered, stuttered, stalled, slow, hard). That makes the same `{ aim, power }` swipe and the same `ex` the rules and the server always took, so nothing server-side changed; keys and a stick
  have no motion to judge (a Good release, and the stick's own pull is the power). The old power/nose/angle/release meter code is still there but nothing reaches it. Putts are unchanged (the radar
  and a swipe whose length is the power).
- **The throw: meters, now the only way** (`metersOn()` is always true; there is no style choice any more, so the "Planning the flight" and swing paragraphs above, and the old four-meter flow below, describe code that is still in `game.js` but dormant, reached only if `metersOn` is ever made false again). A drive keeps the old
  meter machinery under `S.meter.classic` (`tapMeters` is its tap). A drive: you aim, press Throw, and first the **timing window** (`#gm-mini`, `syncMini`, `drawDial`, `updateDials`) pops up over the 3D view with three instruments, one at a time, each tap keeps its
  dial where it stopped: a **nose** dial (a disc seen from the side that pitches, nose marked, sweet arc from `sweetFor('nose')`), a **hyzer** dial (a disc seen from behind that tilts: hyzer drops the **left** edge for a right-hander, the right for a left-hander; sweet arc from `sweetFor('angle')`) and a **release** ring (it closes on the green ring and opens again; white is
  early, orange is late; the zone is `m.rel.w`, from the typical arm). Then **aim and power**: the aim wedge fills and drains with your arm speed (`wedgeMeter`; `powerOverlay` over the 3D aim view, `drawPowerMeter` on the map when 3D is off). `buildRuler` plays a throw at each arm speed (10-90, `previewThrow`
  with the nose and hyzer chosen), the wedge keeps the **curve the aim line had when you pressed Throw** (`refPath` is captured in `startMeter`, before the timing window changes anything; `refAt` walks along it, carrying on straight past its end, and it turns with the aim if you drag), and how far along it each arm speed gets is that speed's carry with the nose and hyzer chosen; it is widened like the aim band (`wedgeGeom`). In the 3D view the drive's wedge is drawn **flat on the screen, bottom to top** (`screenWedge`: a straight distance scale with a tick every 100 ft, the BASKET mark, the sweet spot, the fill and its readout; the ground in perspective squashed the far end to a sliver), keeping the curve sideways to scale; its outline is sampled every 3 ft along the (lightly smoothed) reference curve rather than joined from the ruler's ticks, and the dashed flight blends between the two nearest arm speeds, so nothing steps; on the map and for putts it is drawn on the ground (`wedgeMeter`), the sweet spot (`sweetFor('arm')`, the arm stage of `sweetJob`, which knows the chosen nose and hyzer) is a lit stretch, the fill is `G.mphAt(G.powerAt(sec))`, and the
  dashed flight is the throw at the speed the fill has reached. On a phone the dock under the timing window shows only the steps and the title (the window carries its own instruction line, two lines tall whatever it says), so the window and its Tap button never move between stages, and **Back out** takes two taps ("Sure?") so a thumb that misses Tap cannot throw the whole throw away. **A drag on the hole aims** (the wedge and its sweet spot follow: `rebuildWedge`), **a plain tap throws** (Space, Enter or the button too): the release's grade and the arm speed are the whole throw, no swipe (solo rolls the slip; a match server rolls it).
  **A putt** is its own mini-game (`S.meter.stage` h, v, power): first the **line** and then the **height**, drawn **on the scene itself** (`puttAim`: over the 3D putting view, centred on the basket's chains, or on the map when 3D is off, at a fixed size on the
  screen so a far putt is as readable as a near one: a green window around the chains, and a line sweeps across, you stop it, then another sweeps up and down; the green is `1/K` of the sweep, `K` is 1.6 + 0.08 per foot to 15 ft, then +0.22 per foot, capped 8, so it thins fast past 15 ft;
  the lines sweep faster too, `pH`/`pV`, and the push is judged `pk` times stricter, all from 15 ft out), then the **push** on the wedge (`buildPuttRuler`, drawn in the 3D putt view's `overlay`: it fills along the line to the basket, the lit stretch is `puttPush` give or take
  `swipeTolerance(...).power`). The tap is `puttDisc({ x: 0, y: u.v * K * radius }, { aim: u.h * K * tol.aim, power: 1 + (feet / push - 1) * pk })`: the line is the swipe's aim, the height is the radar's short or long (high is long), the push is the swipe's power, so all three have to be inside their green
  (a miss goes the way the resolver already sends it; no radar). A tap-in (inside 2 ft) is the wedge alone. 
  are hidden in this style, and each new pick starts flat at the typical arm. The server and rules are untouched (same settings, `ex` and swipe).
- (The old throw meter, kept for reference.) The throw meter was four taps for every full throw, in order: **power, nose, angle, release**. Arm speed, nose angle and hyzer are NOT settings: where the marker stops on each of the first three bars is the value (spin just follows the arm speed). The **nose angle** (-5..5 steps of 2.5 degrees, `settings.nose`) tips the front of the disc: up lifts the arc (over a shrub or low branch) and spends distance, down keeps it low and short. Woods are 68+ ft tall, above the highest lob. Hand, style and aim are set first;
  a putt is one tap on a swirling circular green (the dot's path is seeded and never repeats, and a miss goes the way
  the dot was). Only the release is a skill test (`sanitizeExecution` is what a server accepts back for it); the other
  three are choices, and `sanitizeSettings` range-checks them.
- **Backing out** (`backOut` in `game.js`): every meter and the swipe have a small "Back out" button beside the title (also Escape, or the B button; in the swipe the first Escape clears a swing
  in progress). It puts the settings back as they were when the throw began (`S.meter.before`) and returns to the disc, with nothing thrown or sent.
- The power, nose and angle bars each show a **sweet spot** (`sweetSpots`/`sweetBands` in `gamecore.js`): the values that
  land within 20 ft of the best landing there is, from here, for the aim and the bars already set (power assumes the best
  angle and a level nose). It plays candidates through `resolveThrow`, so trees and water count. It is only a guide
  drawn on the bar: nothing about it is sent to or trusted by the server.
- A slow arm can slip (`slipChance`/`rollSlip`/`applySlip` in `gamecore.js`): below 66 mph (Intermediate Plus) there is a
  growing chance of a **grip lock** (short, hooks to the fade side) or an **early release** (flat, to the turn side);
  more for fast discs, extreme nose angles and extreme release angles. The core never rolls: solo rolls in the browser, and in a match the
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
- **Timberline Peak, the third course** (ids 201-218, `HOLES3`, `HOLE_SPECS3`; `WARMUP3`): mountain golf. Broad fairways (half-widths 40 to 70 ft against 30 to 38 elsewhere), mostly pine (`pine` is the
  share of the forest that is pine), big height (climbs of 20 to 30 ft, drops of 20), tarns and streams, and two new things: **rocks** (`boulders: { s, o, n, spread, r, h }` fields and `rocks: [s, o, r, h]`
  singles; trees with `k: 'r'`, 3 to 14 ft tall, so a lofted throw clears them and a low one or a roll hits them like a tree: the lie remembers them, and the result says "rock"; drawn by `foliage.js`
  as grey boulders with moss) and **mandatories that are always there** (`mandoAlways: true` in the spec, `mandoAlways` on the hole: `variantFor` always turns the mando on, a classic hole has
  `hole.mando` from the start). The post goes on the line you must not take (a tarn's corner, a boulder field); the note on each hole says which side to pass.
- **Two courses** (the first two; `COURSES` in `course.js`): **Pinewood Park** (holes 1-18) and **Quarry Ridge** (ids 101-118, `HOLES2`, built from `HOLE_SPECS2`: a limestone quarry and its ridge, with
  bigger drops, pits of water, a blind crest, an orchard, a narrow ridge with a drop both sides, and the technical features throughout). A hole's id is its name everywhere (the ground, the
  day's conditions, the match), so the second course is 101+; `hole.n` (1-18) is the number on the card and `hole.course` says which course. `holeById` finds either, `holesFor(length, course)`
  and `courseById` pick a course's holes. The menu has a card for each course (`courseChooser`, `S.courseId`, remembered as `dj_course`; the match lobby shares the choice); solo rounds, the
  warm-up (`WARMUP2`), the practice list and best scores (`_c2`) all follow it. A **match** carries its course (`m.course`, `POST /matches { course }`, in every view, older matches are
  the first course) and the server plays that course's holes in order. The **daily course** is always Pinewood Park (it shuffles ids 1-18). Tests that loop over holes cover both courses
  (`[...G.HOLES, ...G.HOLES2]`): a new hole on either must stay playable in par by the careful bot.
- **What makes a hole technical** (from what players and designers say about the best courses: risk and reward with a real choice, shots that need shaping, variety of shape,
  elevation, guarded targets, fairness for a miss; see UDisc, Innova's course-development notes, Disc Golf Magazine and DGCourseReview): in `build()`, `staggers` put tall trees reaching in
  from the edge on alternating sides (or only listed ones) so the line is an S, `guards` put tall trees beside the line in to the basket so the approach is shaped, and the ground gives
  raised greens (a mound centred on the basket) or a hollow behind it, so a miss rolls off. Elevated tees are `rise` drops of 10-12 ft in the first 70-80 ft (keep the fairway under 1 in 4).
  Every change must stay playable by the test's careful bot (`every hole can be played`) and fair (a way round, no trap): the test `technical holes` checks the features exist.
  Variety to keep when adding a hole: open and wooded, pars 3/4/5, left, right and straight, a water carry with a bail-out, a split fairway, and the last four holes the most strategic.
- **The forest.** Wherever a side of a hole has `woods`, everything outside the fairway on that side, out to the course
  edge, is forest (`build()` in `course.js`): white pine (`k: 'p'`, narrow and tallest), maple (`'m'`, round, a fifth turning
  orange) and oak (`'o'`, broad), with low bushes (`'b'`) and taller shrubs (`'s'`) under and between them. A side or a stretch
  with no woods, or a `gap`, stays open ground, which is how the designed clearings (the inside of a dogleg, a window) work.
  Trees are looked up through a grid (`treesIn()`), because a hole has 450-1100 of them. They are drawn per species on the
  map (`drawTrees`) and in the 3D view (`cam3d.js`).
- **Aiming in 3D** (`aimIn3D`, `drawAim3D`, `aimCamWant`, `headingAtPixel`, `aimOverlay` in `game.js`): with 3D on, setting up any throw that is not a putt (the pick screen, the four meters and
  the swipe) is in 3D too: the camera stands 18 ft behind the disc looking along the aim (it eases round as the aim changes), with the aim line, the band a mistimed release can
  reach and the landing ring laid over the ground. Drag or tap to aim: the heading of the ground under your finger, through the camera as it was when the finger landed (so it does not
  run away). **Find pin** (chip bottom left on a desktop, behind the toasts and the key hints and gone while Marebear's balloon is up; on a phone it is the fourth chip down the right, clear of her balloon; or V) lifts it to a 3/4 view up and back, looking along the line to the basket, so a dogleg's pin can be found; aiming works there too. In that view the **trees shrink as the camera climbs** (`treeScale` in `drawScene`, from the camera's height over the ground) so they never hide the hole, and you can **look around**: a drag swings the camera round the middle of the hole and tilts it (`S.orbit`, `pinMove`; a plain tap still aims), the wheel zooms, Q and E swing it; it starts square behind the disc each time.
  The world is drawn into a picture of its own when the camera moves and stamped while it is still (`S.aimPic`); the aim line, the pin marker and the fade are drawn over it each frame.
  Any drawing mistake falls back to the map (`S.aimFail`). A result screen, a hole's end and the menus are still the map.
- **The ghost** (`player.js` is the body, pure; `drawPlayer` in `cam3d.js` draws it; `playerFig`, `leadFor` in `game.js`): in the 3D view a translucent, glowing figure of a person stands at the
  lie and throws. `poseAt(kind, ms, hand)` gives every joint in the player's own frame (feet; x right, y forward, z up) for a **backhand**, **forehand** or **putt**, either hand (the
  left-hander is the mirror image), by keyframes (reach back, pull in, release, follow through) and two-bone arm and leg solving. The thrower takes `LEAD[kind]` ms (about half a second) to
  let go: a flight's `t0` is `now() + lead`, so everything that already keyed off `t0` just starts a little later (sounds are set back by the lead; the map, with 3D off, has no lead).
  It stands so the throwing hand lets go **at the lie itself, about 4 ft up** for a drive (3.2 ft for a putt, the putt film's own start); the ride's disc is drawn at that height and
  settles into the flight's own over the first tenth of it (a view-only offset: the flight itself still starts at 0, so the physics did not change). The aim and putt cameras sit over the
  thrower's right shoulder so the ghost is to one side. In a match everybody's throw is a ghost throwing (others as right-handed backhands, as their style is not sent).
- **The pin marker** (`drawPin` in `cam3d.js`): in every 3D view a small orange triangle hangs over the basket from 70 ft out (and an arrow at the edge of the picture when it is to the side or behind you).
  The flag on the staff is small now.
- **3D putting (preview):** with the 3D preview on, once you are within putting range the view stays in 3D (camera behind your disc,
  looking at the basket and its chains) through setting up, the meter, the putt and any miss, until the hole is done. A drawing
  mistake falls back to the map (`draw()` catches it) and `frame()` can never stop the loop.
- **The woods are solid.** A disc is a point and a trunk stops it within 0.9 of its radius, so `woods` put a tree every
  6-8 ft (a wall) and the tee is boxed in behind: you play down the fairway, not any way you like. Only features you
  design (`gaps`, `shrubs`, low guard trees) are ways through. **A patch of trees you have been in is out of the way of your next throw**: the lie remembers the tree you hit, or the nearest real trunk when you
  came to rest within 14 ft of one, as `t`, and the next throw ignores every tree within `PATCH` (30 ft) of it, once; the next patch down the hole (a stagger row, a grove, the forest
  past 30 ft) still stops it. The pick panel says so ("You are in a patch of trees"). Nobody is stuck. `test/gamecore.test.js` throws every way off the tee and checks the
  woods stop nearly all of it.
- **Hills.** Every hole has ground (`terrain.js`, `buildField` in `course.js`): a grid of heights every 8 ft, in feet above the tee, made
  from `GROUNDS` (per hole): a `rise` profile along the route (`[s, z]` knots, flat at the tee and at the basket), `mounds` (hills and
  hollows), a `bowl` (the land climbs away from the fairway, up to 18 ft), `shelves` (a cliff or bank at the edge) and water, which is
  level (`hole.waterLevel`) with the land cut to meet it (a pond in a basin, a creek in a gully). The grid is blurred before mounds go
  on, because the nearest part of the route jumps from leg to leg at a bend. `elevAt(hole, x, y)` and `slopeAt` are how anything asks;
  a hole without `field` (a test's bare hole) is level and everything behaves as it did. Trees carry `z` (the ground they stand on).
  **Keep the fairway under about 1 foot in 4**, and a new hole must still be playable in par (`test/gamecore.test.js`: the bot, with a few grains of power).
  - *Flight* (`samplePath(plan, from, n, hole)`): a point has `h` (above the ground under it) and `z` (above the tee). The flight carries on
    past where level ground would have stopped it until it meets the ground, so a disc goes **farther downhill and shorter uphill**,
    and comes down early on a ridge. Trees are compared by altitude (`z` against the tree's `z + h`), the basket by height over its ground.
  - *Roll* (`rollOut`): the roll has a budget; uphill spends it faster, downhill slower (up to 70 ft), and on a steep slope it is pulled downhill.
  - *Putting*: `riseTo` is how far the basket is above you. `puttDist` is how hard the putt is (a little shorter uphill, longer
    downhill: radar size and speed, swipe tolerance, nasty chance) and `puttPush` is how far the swipe must carry (more uphill). Downhill misses run
    away more. The page shows "▲ 12 ft uphill" with the distance (HUD, pick panel) and a note about what it does.
  - *Seen* (`ground.js`): the map gets a picture laid over it per hole (`mapLayer`): hill shading lit from the north-west, mown stripes,
    grass flecks and contour lines (every 4 ft, heavier every 12). The 3D view draws the land as a mesh of coloured quads (`drawTerrain` in
    `cam3d.js`) farthest first, with blocks of 2 and 4 cells at a distance, so a hill hides what is behind it. Colours per cell (`groundCells`)
    include the slope's light, a mown stripe and noise; close up there are patches (`mottle`), tufts and flowers (`drawGrass`), all
    from a hash of the cell so nothing flickers. Everything that stands on the ground (trees, basket, disc, trail, camera) is placed at `groundAt`.
- **Marebear** is a big, loud older woman from Minnesota (everything she says is in a crude Minnesota voice: "ya", "hon", "uff da", "oh for cripes' sake", hotdish, Hamm's, the cabin, Fleet Farm; swears at the level of damn, hell, ass, crap, shit and piss, never the f-word, slurs or anything about a real person; keep new lines in it, light on the spelling) (leopard print, lavender bouffant, a great deal of make-up), drawn in `marebear.js`; she is not a bear.
  When she has something to say about a throw (`say(text, mood)` in `game.js`) she **pops up from the bottom of the screen** like the dog
  in Duck Hunt: she cackles at a bad throw (`laugh`), sulks with her arms crossed at a good one (`grudge`), smirks at a middling one
  (`sly`), with her words in a balloon (`popUp`/`drawPop`; on a phone she comes up from behind the controls). At a triple bogey she waddles
  on, takes a disc into her handbag and cackles (`drawBearScene`); internally those discs are still `eaten`. Keep her crude and cheeky, never cruel.
- **Her body business** (`actOf`, `drawMarebear`'s `act`, `sound.js`): a line can have *asterisks* in it, `*cough cough*`, `*wheeeeze*`, `*hhhk, ptoo*` / `*spits in a Hamm's can*`
  or `*adjusts bra strap*`. Only what is between asterisks counts. She does it first (a fist to her mouth, a hand on her chest, a glob she spits, a pink strap she yanks, each with
  its own sound: `cough`, `wheeze`, `spit`, `snap`) and then laughs. About a line in three has one.
- **She does not repeat herself** (`pick` in `trash.js`): the page gives her a memory (`useMemory`, `dj_said` in localStorage, short hashes) and she says every line of a
  list before any line of it again, and never the one she just said. With no memory (tests, server) she only avoids the last line.
- **Sound** (`sound.js`): all synthesized with Web Audio, no files: throw, land, skip, thunk, splash, chains, clank, womp, fanfare, her cackle,
  rain. A chip over the hole turns it off (`dj_sound`). Nothing plays before the first touch; every sound call is a no-op without audio.
- **Conditions** (`conditions.js`, pure): a seed gives each hole a day: wind (shifted from the hole's own), rain (1 day in 5: discs skid
  1.7x farther, putts have a 8% smaller target and run away more), dusk (the last 40% of a round of 9 or 18), a pin (A as built, or B/C a
  few feet short and left/right, checked to be grass, clear of water and trees, and level) and, on holes with a `mandoSpec`
  (holes 3, 4 and 12), a mando. `applyVariant(hole, v)` returns `Object.create(hole, ...)`, so the day's hole shares the land and trees with the real
  one but has its own `wind`, `basket`, `weather` and `mando`. **Never spread (`{...hole}`) a hole**: that drops `field`. Solo rounds get a random seed
  (a menu checkbox, `dj_cond`, asks for the classic course); a **match has a `seed`** (made by the server at create; the server and every page
  derive the same day with `holeFor(m, id)` / `matchHole`; a match with no seed is classic, so older matches go on as they were).
  A **mando** is a post with a ray on its forbidden side: a first throw (from before the post) that crosses the ray is `kind: 'mando'`: a
  penalty stroke and a re-throw (`resolveThrow`, like out of bounds). The test bot plays every hole on rain, gale, pin and mando days.
- **The daily course** (`daily.js`, shared): one 9-hole round per UTC day, the same for everyone: `dailyPlan(day)` shuffles nine of the eighteen
  holes by a seed made from the date, and that seed is the round's conditions seed (so everyone gets the same wind, rain, pins and mandos).
  `GET /api/game/daily` gives the plan and the board; `POST /api/game/daily/score` takes `{ day, card: [{ hole, strokes, holed }] }`: the card is
  checked for sense (right holes, 1-14 strokes each; an unfinished hole counts as par + 4), **the first run each day counts**, today's or
  yesterday's day only. The meters are honor system, so this is a board for friends, not proof. Scores live in `data/game-ledger.json`
  (`server/lib/ledger.js`, gitignored, atomic, kept 45 days). Not signed in you can still play it; you just cannot post.
- **Standings**: finished matches (not forfeits) are put in the ledger once (`recordMatch`, hooked on the match store's `change`), kept 130 days;
  `GET /api/game/standings?month=YYYY-MM`: a win is 3 points, a tie 1, ranked by points then strokes under par per hole.
- **Throw of the match** (`highlightScore` in `gamecore.js`: an ace > a long putt going in > a long pure drive): the server keeps the best move of a
  match as `best` (in the view when the match is done) and the page replays it (`replayMove`, which reuses `buildMoveAnim`); a solo round keeps its own
  (`S.course.best`) and shows it on the scorecard.
- **Closest to the pin** on a par 3 in a match: each hole's results carry `kp` (how near a clean first throw finished), the page names the winner
  (`closestToPin` in `gamepanels.js`) and keeps a tally. (Marebear used to borrow the leader's fastest disc for a hole; that is gone.)
- **Marebear's bets** (`BETS`, `betKind`, `betWon` in `trash.js`): before your first throw on a hole she bets you cannot make par (+3/-2),
  cannot make bogey (+1/-3) or cannot birdie (+8/-1) and you can take it or not. The stake is Marebear Bucks (`dj_bucks`, in this browser only,
  never negative). It is a game of its own: it does not change the match or the score.
- **Progress** (`progress.js`, shared): stats, goals (`ACHIEVEMENTS`), disc skins (`SKINS`: a colour for your own discs in flight; won by a goal or bought with
  Marebear Bucks) and **break-in**: `brokenIn(disc, throws)` makes a disc you have thrown a lot turn up to 1 more and fade 0.25 less (full at 160 throws).
  Kept in `localStorage` (`dj_progress`) and, signed in, on the account (`GET/PUT /api/account/game`, shape-checked by `sanitizeGame`, merged with
  `mergeGame`, saved a few seconds after a change). Honor system, like the meters. In a **match** the server freezes each disc's wear into the bag
  snapshot (`w`) and plays it that way (`playDisc`), and the page does the same from the seat, so both agree. Goals fire from `trackThrow`/`trackHole` and
  the round/daily/bet hooks in `game.js`; Marebear grudgingly congratulates (`announce`). "Trophies and skins" in the menu shows it all.
- **Trees and bushes are drawn, not shapes** (`foliage.js`, browser only): per kind (maple, turning maple, oak, white pine, shrub, bush) four pictures made once at start in 5 ms slices
  (`start`), a side view for the 3D camera and a view from above for the map: leaf clumps lit from the upper left, speckled leaves, bark with furrows and limbs, pines in ragged tiers,
  berries on some bushes, each with smaller copies for distance (`levels`) and a haze-washed copy per eighth of fog (`tint`). `side`/`top` return null until ready and the callers
  (`drawTree` in `cam3d.js`, `drawTrees` in `game.js`) then draw the old flat shapes, so nothing waits. The picture of a tree is stretched to its own radius and height.
- **Marebear on/off** (`BEAR`, chip `#gm-bear` beside Sound and 3D, `dj_bear`): off means no pop-ups or remarks, no scene, and in your own round no disc taken
  (`applyResult(..., { bear: false })`); in a match the disc is still taken (the server's rule, the same for all) with a toast instead of the scene.
- **Frame cost** (no freezes, no flicker): anything that takes more than a few ms is done in slices. `warm(hole)` in `ground.js` makes a hole's colours and
  map picture in the background, 6 ms at a time, when the hole begins (the map overlay fades in when ready); the sweet-spot bands are a job (`sweetJob`,
  `next(n)`) the page pumps between frames; the aim preview is cached until something about the throw changes (`previewNow`); and the map's still parts
  (ground, then trees) are drawn once into pictures of their own when the camera settles (`drawStill`), so only the water ripples, the trail and the throw
  are drawn each frame. A day's hole (`Object.create(hole)`) shares its ground cache with the real hole (`baseOf`). A 3D view that first meets a hole whose
  colours are not ready builds them on the spot, which is the one long frame left: warm early.
- **Switched off (kept in the code): Marebear's bets** (`BETTING_ON` in `game.js`; no offer, no Bucks, no skin buying: skins come from goals) and
  the **rain sound** (gone). **Rain is opt-in**: `variantFor(seed, hole, { rain: true })` only; the menu has an "Allow rain" checkbox (`dj_rain`, off), a match
  never has rain unless its `m.rain` is set (nothing sets it), the daily course has none. The seed's other dice are the same with or without rain.
- **Input: touch, mouse, keyboard, controller.** One throw takes `{ aim, power }` whichever made it (`finishSwipe`). A finger **draws back and swipes**. A mouse, trackpad or pen
  **swings** like Disc Golf Masters ("pull back and swing forward"): press on the disc (either button), drag straight down to wind up (the gold mark is the depth that is a full
  throw), then drag back up and let go. The depth of the wind-up is the power, the way back up is the aim (`swingStats`/`commitSwing`; a crooked or wobbly way back, or one that stops
  short of the start, costs power). A trackpad can **click once, swing with no button held, and click again** (`swing.armed`). A controller's **right stick** does the same (pull back,
  push forward: `padSwing` in `pollPad`; the left stick and keys still set aim and power for a plain throw). `pullInput()` says which (the last pointer used). Keys and a controller go
  through `act(name)` (left, right, up, down, confirm, back, prev, next, catPrev, catNext): on the pick screen left/right aim, up/down change disc, **A/D change disc and W/S change the
  kind of disc (putter, mid, fairway, distance)** as in Disc Golf Masters, Enter or A throws; on the meters Space, Enter or A taps; in the swipe, left/right aim and up/down power (`m.kb`) and
  Enter or A throws; in menus a controller's d-pad or stick moves focus and A presses it. `pollPad` reads the Gamepad API every frame (stick aim, d-pad repeat, right trigger throws,
  LB/RB discs). A strip over the hole (`#gm-keys`) says what the keys do once they are used. The canvas swallows `contextmenu` so a right click can throw.
- **Quick start**: "Quick warm-up" is three holes (`WARMUP` in `course.js`: 1, 2, 5); "Play a friend now" signs in if need be, makes a 9-hole match
  and opens the share sheet (or copies the link).
- **Slow motion**: an ace (drive) or a long putt going in is slowed (flight 1.5x, the putt's film 1.4x) with letterbox bars (`drawCine`); a landing
  skips (`hopH`, visual only).
- **Marebear heckles** (`public/js/trash.js`): the game talking, not a chat. `eventFor` turns a throw into an event (shank,
  splash, tree, grip lock, ace...), `remark`/`holeRemark`/`matchRemark` pick a line; she never repeats the last one. The
  owner's own lines live in `public/data/heckles.json` (from their Heckles.csv; categories Birdie, Par, Bogey, Double Bogey,
  Eagle, Going in the Water, Hitting a Tree) and are used for those events; they are second person, so on somebody else's
  throw they are shown "to" that player by name. Everything else (shanks, slips, out of bounds, match results) still uses the
  built-in lines in trash.js. To change her mind about a category, edit the JSON (`test/trash.test.js` checks its shape).
- **Aim goes any way** (`AIM_MAX` 180 in game.js, ±180 on the server): some holes turn away from the basket.
- **Phone layout** (≤900px; audited at 320, 360, 390, 430 px and sideways): the site header steps aside while you play (`gm-playing`, `syncTop`), reading screens
  (menu, daily, trophies, summary...) get a tall panel, controls are at least 40px, the meter and swipe hints shrink to one line once the tip has been seen, the
  bet is a single line, the 3D and sound chips ride at the top right, the zoom buttons hide when under 300px of hole is left (`is-tight`), and Marebear's balloon sits low.
  **Sideways** (`max-height: 520px`) the panel is a column beside the hole, not a dock (`isDock()` is false, `S.dock` is 0). The screen is kept awake while playing
  (wake lock), taps give a small buzz, and the page cannot be pulled to refresh mid-throw.
- **Phone layout, the original notes** (≤900px): the hole fills the screen and the controls are a dock along the bottom (`.gm-panel` is an
  overlay; `S.dock` is its height and `midY()` centers the camera in what is left). A throw is set up in steps (Disc, Grip,
  Aim, then the four meters); caddy notes and Marebear's remarks float over the hole (`#gm-bubble`) instead of sitting in
  the panel. Desktop keeps the one side panel.
- **3D camera** (`public/js/cam3d.js`): a thrown disc is watched from behind it, in perspective, on the same canvas: ground shapes
  (fairway stripes, water, out of bounds) are projected polygons clipped at the near plane, trees (drawn per species), bushes and
  the basket (with a tall flag, and chains up close) are billboards sorted by depth, and a chase camera (`follow`) eases after
  the disc and banks into turns. **On for everyone**, with a "3D on/off" chip over the hole (remembered in localStorage `dj_cam`;
  `/game?cam=off` and `?cam=3d` set it). In a match of two everyone's throws are watched in 3D; in a bigger group the others'
  stay on the map so it keeps moving. Tapping the hole skips a ride. A drawing mistake falls back to the map (`draw()` catches it)
  and `frame()` can never stop the loop.
- **The putt has two steps**: the swirling radar (where the putt wants to go), then a **swipe** (phase `swipe`) toward the basket. A
  swipe (draw back, then swipe forward) has an aim (degrees off straight up the screen, + right) and a power (its length against what
  this distance needs, `swipeNeed()`; 1 is just enough). `swipeTolerance(dist)` is how far either may be off (26 deg and 50% inside 10 ft, about 20 deg and 40% at 15, 6.5 deg and 16% at 25, 3 deg and
  10% from 50 ft). **Close putts go in**: inside 10 ft the radar's target is 0.94 of the green (`CLOSE_RADIUS`, `closeEase` in `gamecore.js`), so about 95% go in even for a blind tap and a sloppy swipe,
  10 to 15 ft about 90 to 95%, easing down to the mid-range target by 22 ft (measured with a bot: 4-10 ft 96-97%, 12 ft 95%, 15 ft 92%); outside it the putt **cannot go in**: `resolvePutt(..., swipe)` adds the swipe's error to the radar's, so it
  misses short (`why: 'weak'`), long (`'strong'`, and more likely a nasty roll), left or right, or lips out if only just off. A
  swipe near the limit still counts as true, and tap-ins need none. With no swipe (an older page, a test) it counts as true.
  The server takes `body.swipe` (`sanitizeSwipe`) and, like the meters, trusts the player about the gesture.
- **A swipe is a draw back and then a swipe forward**, in one smooth motion (`SWIPE`, `beginSwipe`/`moveSwipe`/`tickSwipe` in `game.js`):
  pull down the screen (at least 30 px), turn, and flick up it. Only the forward stroke is judged: its aim is the angle of the
  stroke from where you turned round (0 is straight up), its power is its length against `swipeNeed()`, and a draw back shorter than
  60% of the forward stroke costs up to 40% of the power (`swipePower`). Forward first is "DRAW BACK FIRST", holding still at the
  bottom for 0.7 s cancels it. The forward stroke is judged where the motion ends, and it ends the moment you stop: a pause of
  ~110 ms commits it where you paused (checked every frame by `tickSwipe`, so a held finger counts too), pulling back more than 14
  px commits it at the farthest point reached, and one whose peak speed never reached 260 px/s is thrown out ("TOO SLOW"), so
  nobody can crawl and adjust. The guide (the wedge, the band, a mark for how far to draw back) stays at a fixed place, 66% down
  the free part of the screen, wherever the finger lands. Timing uses `performance.now()`, not the game clock. The server only ever
  sees `{ aim, power }`, so the gesture can change without touching it.
- **A drive ends with a swipe too** (phase `swipe`, after the release tap): a draw back and a flick up the screen as long as the arm speed needs
  (`swipeNeed()`). It is **graded**, not pass or fail (`withSwipe` in `gamecore.js`): inside `DRIVE_SWIPE` (12 deg, 25% power) it
  changes nothing; past it, off line steers the throw the same way (`swipeAim`, up to 25 deg), too soft slows it (`swipeSpeed`,
  down to half) and too hard makes it loose. The page sends `ex.swipe` and `sanitizeExecution` applies it, so the server does the
  steering itself. An older page sends none and gets none. The basket in the 3D view has a catch tray about 3 ft up (`TRAY_H`),
  and a made putt drops into it and rests there.
- **The basket is modelled on a PDGA-certified one** (constants at the top of `cam3d.js`; the PDGA lists baskets in cm, e.g. the DGA Mach X,
  pdga.com/node/257161): tray rim 79 cm up (here 2.65 ft), 66 cm across inside (r 1.08 ft), 24.5 cm deep; the chains hang from a band 56 cm
  wide (r 0.92 ft, so it is narrower than the tray), 16 outer and 8 inner, over a zone 50 cm tall (1.64 ft); the pole is 4.8 cm across.
  A flag on a staff is the game's own addition so you can find the basket from far off; up close it is only a short staff.
- **A disc does not go through a hoop.** In `puttScript` a putt that goes in flies to the side of the chain curtain (about 0.8 ft out,
  halfway down the chains), is stopped dead by the chains, and falls into the tray; a rattle kicks back out and sideways first. A rim-out clips the
  chains and runs round the lip of the tray. The basket is drawn in three layers (`base`, `back`, `front` in `cam3d.js`) so the
  near chains cross in front of a disc that has gone in.
- **Putting** (`public/js/puttfx.js`): within putting range the 3D view stays up (camera behind the disc, looking at the basket)
  from setup to the end of the hole. `resolvePutt` decides: `finish` is `swish` (dead center), `rattle` (near the edge), `tapin`,
  `rim` (just outside: it laps the rim and spits out), `miss`, or `nasty` (a miss that runs 14-46 ft away; the dice are passed in,
  the server rolls them in a match; into water it costs a stroke). `puttScript` turns that into a film (where the disc is every
  millisecond, with marks for the drop, the rim lap, the spit and the roll) and `drawPuttFx` draws the reaction: CHAINS! with
  rings and confetti, a cold-washed RIMMED OUT, NASTY ROLL with the camera following the disc.
- Modules import each other with `?v=N` (now `course.js` 14, `gamecore.js` 35, `gesture.js` 2, `cam3d.js` 23, `puttfx.js` 19, `player.js` 1, `foliage.js` 2, `ground.js` 8, `sound.js` 4, `marebear.js` 2, `conditions.js` 6, `daily.js` 1, `gamepanels.js` 3, `progress.js` 2, `trash.js` 11, `terrain.js` 1): bump it when a module changes, or cached copies mix with new ones.
  `public/js/package.json` says `type: module` so Node can import these files in tests.

## Deploy

Droplet, `/var/www/discjerkers`, docker compose behind nginx on 127.0.0.1:3040.
Follow the dibberlab server-ops discipline: `nginx -t` → reload → commit and
push `/etc/nginx` **from the server**. See README.md for the full sequence.
