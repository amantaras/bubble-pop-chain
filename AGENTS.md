# AGENTS.md — Bubble Pop Chain

Operating guide for any AI agent (GitHub Copilot, etc.) working in this
repository. Read this fully before making changes. It captures how the app is
built, the non‑negotiable workflow, and the lessons already learned so they are
never re‑discovered the hard way.

---

## 1. What this project is

- **Bubble Pop Chain** — a mobile‑first HTML5 puzzle game (tap connected
  same‑colour bubbles to pop chains, build combos, clear the board).
- **No build step, no framework.** Vanilla **ES modules** + HTML5 **Canvas**.
  Files are served as‑is. Do **not** introduce a bundler, transpiler, or
  framework without explicit user approval.
- **Installable PWA**: `manifest.json` + `sw.js` (service worker) + SVG icons.
- **Persistence**: `localStorage` under the key `bpc_save_v1`.
- **Gestures** (`src/input.js`): tap to pop, **long‑press** = Preview & Plan
  (highlights a group + projected score), **double‑tap** = Charged Blast when
  the Power meter is full, **swipe left/right** = shift a whole row (2048‑style,
  costs 1 move in campaign or a shift token in endless/daily).
- **Power meter**: fills from points + combos (`scoring.powerGain`); a full
  meter enables a double‑tap Charged Blast (`grid.blastArea`, diamond AoE).
- **Power-ups** (`economy.js` `POWERUP_INFO`, armed from the HUD): **Bomb** (3×3),
  **Color Clear** (one colour), **Shuffle**, **Chain Bolt** (`grid.crossCells`,
  full row + column), **Pick** (single bubble), and the premium **Magnet**
  (`grid.magnetGather`) — arm it, tap a plain bubble, then lock a **circular
  strength dial** that pops up centred over the board (`#magnet-gauge`, a needle
  sweeping a 270° arc, swept in `Game.update`; the overlay is pointer-events:none
  so the locking board tap still registers). The **green sweet spot is
  randomised** each use (`magnet.sweet` ≈ 0.22–0.78; the `.mg-ring` is rotated to
  match) so the player can't just lock dead-centre; strength tapers from full on
  the sweet spot to zero `MAGNET_HALF` away. The closer to green, the more of
  that colour is pulled into one connected blob (a perfect hit gathers the whole
  colour). While aiming, the **target-colour bubbles shake** harder the nearer
  the needle is to green (`Renderer.drawBubbles` `aim` jitter). The Magnet is the
  dearest power-up (500 coins) and also drops from the treasure rotation.
- **HUD loadout** (`ui.js`, `storage.js` `loadout`): the HUD shows **three
  quick-access slots** instead of one button per power-up (so it never grows as
  tools are added). A short **tap** arms that slot's power-up; a **long-press**
  (>450ms) opens the loadout picker (`#loadout`) listing every `POWERUP_INFO`
  entry — choosing one assigns it to the held slot via
  `Storage.setLoadoutSlot`, which keeps the three slots distinct (swapping if
  the tool is already equipped). The loadout deep-merges into existing saves.
- **Special bubbles** (`grid.js` `types` layer): **Rainbow** = colour wildcard
  that bridges regions; **Ice** = needs two hits (cracks, then clears). Seeded
  spawn rates ramp in by level. Types are part of the save/resume snapshot.
- **Ads gating** (`monetization.js`): forced interstitials only from
  `adsStartLevel` (7) onward; rewarded ads always available.
- **Coin economy** (`scoring.coinReward`, `economy.js`): level payout is
  `floor(score/100) + stars*20`, tuned so a ~2-star player affords a cheap
  power-up (100–150) every 2–3 levels without ads. The shop's **Free Coins**
  item is a daily-capped rewarded ad (`Economy.adCoinState`/`claimAdCoins`):
  `AD_COIN_REWARDS = [150, 250, 400]`, **3 grants/day** that escalate then lock
  until the next day (`adRewards` tracker resets on `todayKey` rollover). Paid
  IAP packs (`COIN_PACKS`) are coins-only: Bag 1500/$1.99, Chest 5000/$4.99 —
  there is no longer an unlimited "watch ad for coins" pouch.
- **Daily retention** (`daily.js`): rotating seeded modifier, three tiered
  goals → daily stars, a 7‑day reward cycle, and a streak‑freeze token that
  rescues one missed day.
- **Falling events** (`events.js`, `main.js` `_updateEvents`/`_spawnEvent`,
  `ui.js` `spawnFallingEvent`): every ~12–20s a 🎁 **gift** or ⚠️ **problem**
  token drifts down the screen (`#events-layer`, `pointer-events:none` so it
  never blocks board taps; the token itself is tappable). Tap a gift to collect
  coins (`GIFT_COIN_MIN..MAX`) or, ~25% of the time, a free power-up
  (`GIFT_POWERUP_POOL`, excludes magnet). Tap a problem to **defuse** it for a
  small coin reward; if it falls off-screen untouched it calls
  `board.scatterArea`, recolouring the nearest `SCATTER_COUNT` bubbles to break
  apart connected clusters. Suspended during the tutorial (auto-spawns gated)
  and once a session ends. `events.js` is pure/seedable; `game.spawnEvent(type)`
  is an E2E hook.
- **Interactive tutorial** (`tutorial.js`): a gated, step‑by‑step onboarding that
  auto‑opens on first run (and re‑playable via the menu's **How to Play**
  button). Each action step **blocks until the player actually performs the
  gesture** (tap, combo, preview, swipe, charged blast, power‑up, magnet, and
  tapping a falling gift/problem `event`). It
  must stay in sync with the game's features — see §11.
- **Live production URL**: https://amantaras.github.io/bubble-pop-chain/
  (GitHub Pages, served under the `/bubble-pop-chain/` subpath).
- **Repo**: `amantaras/bubble-pop-chain`, default branch `master` (private).

## 2. Project structure

```
index.html          # markup: menu, level map, shop, themes, HUD, modals
styles.css          # all styling (neon-on-dark theme)
manifest.json       # PWA manifest (RELATIVE paths — see §7)
sw.js               # service worker, NETWORK-FIRST strategy
icons/              # icon.svg, maskable.svg (procedural SVG)
src/
  main.js           # Game orchestrator: canvas loop, state machine, sessions
  grid.js           # Board model: flood-fill, gravity, collapse, serialize/restore
  renderer.js       # Canvas drawing
  particles.js      # Particle FX
  animations.js     # ScreenShake, FloatingText
  input.js          # Pointer input + vibrate() (guarded for iOS)
  audio.js          # WebAudio (unlocked on first pointerdown)
  storage.js        # Storage singleton over localStorage (bpc_save_v1)
  themes.js         # Theme catalog + unlock logic + applyThemeCss
  levels.js         # LEVEL_COUNT=40, getLevel(id), star thresholds
  scoring.js        # groupScore, comboMultiplier, clearBonus, starsForScore
  rng.js            # mulberry32 seeded RNG, todayKey
  economy.js        # Coins + power-up inventory/prices
  daily.js          # Daily challenge + streak logic
  events.js         # Falling gift/problem events (pure: delay/type/reward rolls)
  monetization.js   # F2P abstraction (ads/IAP) — MOCK provider, pluggable  tutorial.js       # Gated step-by-step onboarding: TUTORIAL_STEPS + Tutorial class  ui.js             # All DOM UI: screens, level map, shop, themes, HUD, modals
tests/
  unit/*.test.js    # Vitest unit tests (real modules, jsdom)
  e2e/game.spec.js  # Playwright E2E (real browser, real input)
  server.mjs        # zero-dep static server (port arg, default 4173)
  setup.js          # deterministic in-memory localStorage for unit tests
  SKILL.md          # testing + CI/CD reference doc
.github/workflows/
  ci.yml            # unit + e2e on every push/PR
  deploy.yml        # deploys to GitHub Pages ONLY after CI success on master
```

## 3. THE GOLDEN RULE — features, tests and CI/CD move together

Whenever you add or change a feature, you MUST update **all** of the following
in the **same** change. A feature is not "done" until every box is checked:

1. **Implement** the feature in `src/` (and `index.html`/`styles.css` if UI).
2. **Unit tests** — add/extend `tests/unit/*.test.js` for any new logic
   (scoring, grid ops, storage fields, economy, etc.). Test the REAL module.
3. **E2E tests** — add/extend `tests/e2e/game.spec.js` for any new user-facing
   flow, driving the REAL game (real clicks, real canvas taps). Cover every new
   code path.
4. **CI/CD** — if the feature adds files, assets, routes, scripts, env, or build
   needs, update `.github/workflows/ci.yml` and/or `deploy.yml`, the
   `sw.js` cache `ASSETS` list, and `manifest.json` as needed.
5. **Run the full suite locally** and confirm GREEN before committing:
   ```bash
   npm test          # unit (Vitest) + e2e (Playwright) — must be 100% green
   ```
6. **Update docs** — keep `tests/SKILL.md` test-coverage list and this
   `AGENTS.md` accurate when behaviour or structure changes.
7. **Commit & push** to `master`, then **verify CI and the deploy both pass**
   (see §6). Production is gated on CI — never bypass it.

If you cannot make the tests pass, do not commit. Fix the root cause.

## 4. Testing rules (NO MOCKING of game code)

- **Real testing only.** Unit tests import and exercise the actual `src/*.js`
  modules. E2E tests drive the real running game in real Chromium. The only
  intentional stub is `src/monetization.js` (the ad/IAP provider awaiting a real
  SDK) — test the real shipped code path; do not add extra mocking on top.
- **The `?e2e=1` hook**: `src/main.js` exposes internals on `window.__bpc`
  **only** when the URL has `?e2e=1`. Use it in E2E tests to set up/inspect
  state — never to replace logic. Production never sets this param.
- **Commands**:
  ```bash
  npm install              # first time
  npm run test:install     # install Playwright Chromium (first time / CI)
  npm run test:unit        # Vitest (fast)
  npm run test:e2e         # Playwright (real browser, mobile + desktop)
  npm test                 # full gate: unit then e2e
  npm run serve            # preview at http://127.0.0.1:4173
  ```
- **Determinism**: levels/daily use seeded RNG (`rng.js`). Assert on seeds and
  derived values, not random outcomes. Unit tests get a clean in-memory
  `localStorage` via `tests/setup.js` (reset before each test).
- **Current baseline (keep growing, never shrink)**: 131 unit tests + 95 E2E
  tests, all passing. New features must add tests, not remove coverage.

## 5. CI/CD — production is gated on tests

- `.github/workflows/ci.yml`: runs `unit` (Vitest) and `e2e` (Playwright on
  Chromium) on every push and PR; uploads the Playwright HTML report.
- `.github/workflows/deploy.yml`: triggered by `workflow_run` on **completion of
  CI for `master`** and only proceeds when `conclusion == 'success'`, then
  publishes to GitHub Pages. **A red test suite means no deploy — keep it that
  way.** The deploy workflow self-enables Pages; do not remove that step.
- Node 20 in current workflows. (GitHub deprecation warning about Node 20
  actions is non-blocking; bump action versions only when asked.)

## 6. How to verify a deploy (always do this after pushing to master)

```bash
gh run list --limit 6                       # see CI + Deploy status
gh run watch <deploy_run_id> --exit-status  # wait for the deploy to finish
curl -s -o /dev/null -w "%{http_code}\n" https://amantaras.github.io/bubble-pop-chain/
```
The deploy run must end in **success** and the live URL must return 200. If CI
is red, the deploy is correctly skipped — fix CI first.

## 7. Platform / PWA gotchas (already handled — keep them handled)

- **Relative paths everywhere.** `index.html`, `manifest.json`
  (`start_url: "./index.html"`, `scope: "./"`), and `sw.js` cache entries all
  use `./...` (no leading `/`). This is REQUIRED for the GitHub Pages subpath
  `/bubble-pop-chain/`. Never switch to absolute root paths.
- **Service worker is network-first** (so updates aren't masked by stale cache).
  When you add/rename a source or asset file, add it to the `ASSETS` list in
  `sw.js`, or it won't be available offline.
- **iOS Safari**: `navigator.vibrate` is unsupported — input code guards this;
  keep haptics optional. Audio must start after a user gesture — `audio.js`
  already unlocks on first `pointerdown`. Don't autoplay audio.
- **Install/offline needs HTTPS.** Plain `http://<lan-ip>:4173` works for
  gameplay but won't register the service worker. Use the Pages HTTPS URL (or a
  tunnel) to test PWA install on a phone.
- Works on modern Android (Chrome/Edge/Firefox/Samsung) and iOS (Safari).

## 8. Persistence & save format (`bpc_save_v1`)

- `Storage` (`src/storage.js`) is the single source of truth. `deepDefault`
  merges saved data over `DEFAULT_SAVE`, so **adding a new save field is safe** —
  add it to `DEFAULT_SAVE` and existing saves get the default automatically.
- Permanent progression is written on level completion: `maxUnlockedLevel`,
  per-level `stars`, `coins`, `highScoreEndless`, `daily` streak, owned/active
  themes, power-up counts, `adsRemoved`, `muted`.
- **Save & resume**: the in-progress *campaign* level is snapshotted to
  `activeSession` (board grid + score + moves) after every move, on quit, and on
  revive. The menu shows a **"Continue • Level N"** button to resume the exact
  board; the snapshot survives reload and is cleared only when the level
  finishes. `Board.serialize()/restore()` round-trip the colour grid. If you
  change session shape, update both the snapshot writer (`_persistSession` in
  `main.js`) and `resumeCampaign`, plus the resume tests.
- Save is **per-device** (localStorage). There is no cloud sync; don't claim
  cross-device progress.
- **Milestone grants are one-time and non-farmable.** `milestonesCleared` is a
  list of level ids whose milestone reward has been paid. `Storage.recordMilestone(id)`
  returns `true` only the first time, so bonus coins / free power-ups / theme
  unlocks fire once; normal score `coinReward` still applies on every replay.
  Boss theme unlocks go through `Storage.grantTheme(id)` (idempotent).

## 8a. Milestone events (every 5 levels)

`src/milestones.js` is a pure, deterministic module (fully unit-tested) that
defines the campaign's reward/challenge rhythm. It must stay in sync with
`levels.js`:

- **Cadence**: `milestoneType(id)` returns `"treasure"` on levels 5/15/25/35 and
  `"boss"` on levels 10/20/30/40 — the two beats always alternate.
- **Treasure 🎁** (`treasureReward`): first clear pays `100 + idx*25` bonus coins
  plus one rotating free power-up (`magnet`/`bomb`/`colorClear`/`shuffle`).
- **Boss 👹** (`bossReward` + `bossConfig`): the board seeds a centred **frozen
  core** of ice bubbles (`Board.placeFrozenCore`); the objective is to shatter
  the whole core (`Board.frozenRemaining() === 0`) before moves run out. Boss
  levels suppress random ice and get extra moves (`getLevel`). First defeat pays
  a coin jackpot (`250 + idx*75`) and unlocks the next cosmetic theme.
- **Wiring**: `getLevel` tags `level.milestone` / `level.boss`; `main.js`
  `_newSession` places the core and tracks `bossCoreTotal`, the boss objective is
  evaluated in `afterMove`, and the one-time rewards are paid in `_finish`. The
  level map (`ui.js buildLevelMap`) and the boss HUD (`Core` label) surface the
  beats; the recap window shows the reward lines via `win-reward`.

## 9. Git / workflow conventions

- Branch: `master`. Commit messages: concise, imperative, with a short bullet
  body for non-trivial changes.
- **Commit with**: `git -c commit.gpgsign=false commit -m "..."` (GPG signing is
  not configured in this environment; the flag avoids a signing failure).
- Never commit `node_modules/`, `test-results/`, `playwright-report/`,
  `coverage/` (already in `.gitignore`).
- Do not force-push, reset shared history, or bypass CI hooks.
- Don't create extra markdown/docs files unless the user asks. (`tests/SKILL.md`
  and this `AGENTS.md` were explicitly requested.)

## 10. Definition of done (checklist before you say "done")

- [ ] Feature implemented with relative paths and existing patterns.
- [ ] **Tutorial updated** if the feature is player‑facing (added/changed/removed)
      — see §11.
- [ ] Unit tests added/updated and passing.
- [ ] E2E tests added/updated and passing (mobile + desktop projects).
- [ ] `sw.js` ASSETS / `manifest.json` updated if files/assets changed.
- [ ] `npm test` is 100% green locally.
- [ ] `tests/SKILL.md` and `AGENTS.md` updated if behaviour/structure changed.
- [ ] Committed and pushed to `master`.
- [ ] CI passed AND the production deploy succeeded; live URL returns 200.

## 11. Tutorial — KEEP IT IN SYNC WITH EVERY FEATURE CHANGE

The interactive tutorial (`src/tutorial.js`) teaches the live feature set by
making the player **do** each action before it advances. Because it mirrors the
game's mechanics, it goes stale the moment a feature changes. **Whenever you add,
change, or remove a player‑facing feature, you MUST adapt the tutorial in the
same change.** This is not optional — a feature is not "done" (§10) until the
tutorial reflects it.

How the tutorial is wired (touch every layer that applies):

1. **Steps** — `TUTORIAL_STEPS` in `src/tutorial.js` is the ordered script. Each
   step is `{ id, title, body, advance, cta?, hint?, grant? }`:
   - `advance: "button"` → advances when the player taps **Next** (`cta` is the
     button label). Use for informational steps.
   - `advance: "<action>"` → a **gated** step that only advances when the game
     emits that action. Current actions: `pop`, `combo`, `preview`, `swipe`,
     `blast`, `powerup`, `magnet`. `hint` is the nudge text shown while waiting.
   - `grant` → a one‑time setup applied on entering the step (e.g. fill the
     power meter, place special bubbles) via `Game.tutorialGrant(kind)`.
2. **Action emitters** — the game calls `this._tut("<action>")` from `main.js`
   right after the corresponding mechanic resolves (`popAt` → `pop`/`combo`,
   `previewAt` → `preview`, `handleSwipe` → `swipe`, `chargedBlast` → `blast`,
   `applyPowerup` → `powerup`, `lockMagnet` → `magnet`). **A new gesture/mechanic
   that the tutorial should teach needs a matching `_tut(...)` emit.**
3. **Grants** — add new setup cases to `Game.tutorialGrant(kind)` in `main.js`
   (and a `grant:` on the step) when a step needs pre‑arranged board state.
4. **Board** — `buildTutorialBoard()` / `decorateSpecials()` produce a
   deterministic teaching board (guaranteed clusters + a Rainbow + an Ice). Keep
   it valid if colour/type rules change.
5. **UI** — the coach card markup lives in `index.html` (`#tutorial`,
   `#coach-*`), styled in `styles.css` (`.tutorial-overlay`, `.coach-*`), and is
   driven by `UI.showTutorialStep()` / `UI.hideTutorial()`.
6. **Tests** — update `tests/unit/tutorial.test.js` (step‑table invariants +
   gating logic) and the `interactive tutorial` block in
   `tests/e2e/game.spec.js` (first‑run open, How to Play, skip, full gated
   walkthrough). The e2e `openGame()` helper dismisses the first‑run tutorial so
   other tests start on a clean menu — keep that intact.

Checklist when a player‑facing feature changes:

- [ ] Added a feature → add a step (and an action + `_tut` emit if it's a new
      gesture/mechanic the player must perform).
- [ ] Changed a feature → update the relevant step's `body`/`hint`/`advance`
      action and any `grant`/board setup.
- [ ] Removed a feature → delete its step, its `_tut(...)` emit, and any grant.
- [ ] Updated `tutorial.test.js` and the e2e tutorial walkthrough to match.
- [ ] `npm test` green; first‑run + How to Play still walk end‑to‑end.

The `src/tutorial.js` header carries a ⚠️ reminder pointing back to this section.
