# Bubblit! New Feature Plan — Excitement Pass

Implementation plan for 6 new player-facing features. Each feature follows the
project's Golden Rule (see `AGENTS.md` §3): implement → unit tests → E2E tests
→ CI/CD asset updates → tutorial sync (if the feature needs one) → docs. No
feature is "done" until `npm test` is 100% green and the change is verified on
`master` (CI green, deploy green, live site 200).

All 6 are purely additive (never change win/star outcomes) and self-contained
enough to ship independently — pick any one and implement top-to-bottom before
moving to the next, per the existing repo convention (small, fully-tested,
fully-deployed slices).

---

## 1. Combo Cam — dynamic zoom on huge combos

**Goal**: make the biggest combo/pop moments read as visually bigger, without
adding any new game state — pure camera "juice" layered on the existing combo
escalator (`scoring.js` `comboTier`/`COMBO_TIERS`) and pop-style system
(`particles.js` `popStyleForGroup`).

**Design**:
- New lightweight `CameraZoom` helper (in `animations.js`, alongside
  `ScreenShake`), tracking a single `scale`/`focus` value driven by a short
  punch-in/ease-out curve (e.g. 1.0 → 1.06 → 1.0 over ~350ms).
- Trigger points: reaching combo tier `ct-4`/`ct-5` (Amazing/Unstoppable) in
  `comboTier()`, and/or a `supernova` pop style from `popStyleForGroup`.
- `renderer.js`/`main.js` render loop applies the zoom as a `ctx.translate` +
  `ctx.scale` centred on the board (or the pop centroid) before drawing.
- Must respect `reducedMotion` (scale the effect toward 0, matching the
  existing `ScreenShake.motionScale` / `ParticleSystem.motionScale` pattern).
- No new tutorial step — purely cosmetic, same precedent as the group-pop
  explosion styles and the last-bubble finale.

**Tasks**:
- [ ] Add `CameraZoom` class to `animations.js` (pure `update(dt)`/`draw`-style
      API mirroring `ScreenShake`).
- [ ] Wire trigger points in `main.js` (`popAt`/wherever combo tier and pop
      style are resolved).
- [ ] Apply the transform in the render path (`main.js` `render()` or
      `renderer.js`), respecting `reducedMotion`.
- [ ] Unit tests: pure zoom-curve math (`tests/unit/animations.test.js`),
      reduced-motion scaling.
- [ ] E2E test: reaching a top combo tier / supernova pop measurably changes
      the canvas transform (or exposes a testable hook via `__bpc`), and stays
      neutral under reduced motion.
- [ ] Update `AGENTS.md` feature list (§1) with a short entry.
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## 2. Lucky Wheel — daily spin-to-win

**Goal**: a once-per-day suspense/reward moment distinct from the calendar
gifts (`calendar.js`), whose rewards are fixed and known ahead of time — the
wheel's reward is genuinely random each spin.

**Design**:
- New pure module `src/wheel.js` (mirrors `calendar.js`/`season.js` shape):
  - `WHEEL_REWARDS`: a weighted table (coins tiers, Pet Dust, a crate, a rare
    chance at bonus/pity-adjacent reward).
  - `wheelStatus(state, key)` → `{ claimable, lastSpinKey }` (one spin per
    `todayKey()`, same daily-gate pattern as the daily challenge).
  - `spinWheel(rng, state, key)` → resolves the weighted pick + next state,
    pure/seedable like `rollCrate`.
- `storage.js`: new `wheel: { lastSpin }` field (deep-merge safe).
- `ui.js`: a `#wheel` modal with a CSS/canvas spinning dial (reuse the visual
  language already established by the Magnet gauge's conic-gradient dial —
  segments instead of a strength ramp), landing on the rolled reward with a
  brief spin-then-settle animation; disabled/"come back tomorrow" state once
  claimed.
- Menu entry: a new tile (or fold into the existing Gifts tile as a second
  action) surfaced once unlocked (consider gating behind a campaign level like
  other meta features, e.g. reuse the calendar's unlock precedent).
- No tutorial step — meta/reward feature, consistent with calendar/season/
  quests precedent.

**Tasks**:
- [ ] `src/wheel.js`: `WHEEL_REWARDS`, `wheelStatus`, `spinWheel` (pure).
- [ ] `storage.js`: add `wheel` default field + getters/setters.
- [ ] `ui.js`: wheel modal, spin animation, claim/lock states.
- [ ] `main.js`: `spinWheel()` action wired to Economy/Storage grants (reuse
      `_grantPowerupReward`-style locked-tool-to-coins fallback if a tool
      reward rolls before it's unlocked).
- [ ] `sw.js`: add `wheel.js` to `ASSETS` (covered by `sw-assets.test.js`).
- [ ] Unit tests: `tests/unit/wheel.test.js` (reward odds/table shape, daily
      gate, seeded determinism).
- [ ] E2E tests: spin claims a reward and locks for the day; persists across
      reload; menu badge/entry appears correctly.
- [ ] `AGENTS.md` feature entry + project-structure table row.
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## 3. Mystery Egg Hatching — delayed crate reveal

**Goal**: add anticipation to crate openings by replacing the instant reveal
with a short "incubating" beat before the pet is revealed.

**Design**:
- Extend `pets.js`/`storage.js` crate state: opening a crate now creates an
  "incubating egg" (`{ rolled, readyAtMove }` — pre-rolled immediately so the
  outcome is fixed and testable/deterministic, but not *shown* until ready) —
  ready after a small number of moves played (e.g. 5) OR a short real-time
  delay, whichever fits better with the move-driven game loop (moves-based is
  simpler to test deterministically and matches the game's existing
  move-driven mechanics like Downpour/Echo).
- `ui.js`: Pets → Store tab shows an "Egg incubating… N moves left" card
  instead of the crate immediately; once ready, tapping it plays the existing
  pet-reveal modal (`#pet-reveal`) unchanged.
- Only one egg incubates at a time to start (simplest, avoids a queue UI);
  opening another crate while one is incubating can queue or simply be
  disabled with a toast — decide during implementation, document the choice.
- No tutorial step — meta acquisition-economy feature, same precedent as
  crates/pity timer.

**Tasks**:
- [ ] `pets.js`/`storage.js`: incubating-egg state shape + advance-on-move
      helper (pure, testable like `nextPity`).
- [ ] `main.js`: advance incubation from `afterMove` (skip in tutorial, mirror
      `_spreadVines`-style one-call-per-move wiring).
- [ ] `ui.js`: incubating card + hatch transition into the existing
      `showPetReveal` flow.
- [ ] Unit tests: incubation countdown math, queueing/blocking behaviour,
      determinism of the pre-rolled outcome.
- [ ] E2E tests: open a crate → egg incubates → advance moves → hatch reveals
      the pre-rolled pet via the existing reveal modal; state survives reload.
- [ ] `AGENTS.md` feature entry (extend the existing "Pet companions" section).
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## 4. Board Storm — positive mid-level burst event

**Goal**: a rare, purely beneficial mid-level burst — the positive counterpart
to Downpour's hazard, giving occasional "something exciting just happened"
moments without any downside.

**Design**:
- Campaign-only (mirrors Downpour's `DOWNPOUR_MIN_LEVEL` gating idea, but could
  start earlier since it's a pure boon), low per-move probability once armed
  for a level (e.g. a level has a small chance to carry a storm; if it does,
  it fires once at a random point in the level).
- Effect: charges `N` random plain (`NORMAL`) bubbles into `LIGHTNING` type
  over 2-3 resolved moves (reuse `grid.js` cell-selection patterns like
  `spreadVines`/`spreadPolarity` — one upgrade per call, deterministic via the
  board rng).
- Visual: a brief on-board glow sweep + `"⚡ Board Storm!"` toast/banner,
  distinct from the Downpour danger-line cue.
- Informational-only tutorial toast at first occurrence (no gated step, same
  precedent as Downpour).

**Tasks**:
- [ ] `levels.js`: `boardStormForLevel(n)` (pure, deterministic arm/trigger
      chance, mirrors `downpourForLevel`).
- [ ] `grid.js`: a pure helper to upgrade N random plain cells to `LIGHTNING`
      over successive calls (one per move, like `spreadVines`).
- [ ] `main.js`: wire into `afterMove` (campaign-only, skip in tutorial/finale,
      similar guard structure to `_downpour()`).
- [ ] `renderer.js`: brief glow/sweep visual cue.
- [ ] Unit tests: arm/trigger probability determinism, cell-upgrade helper.
- [ ] E2E test: a storm-eligible level's storm fires and visibly upgrades
      bubbles to Lightning over subsequent moves.
- [ ] `AGENTS.md` feature entry (near the Downpour section, contrasting it).
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## 5. Boss Finisher Cinematic — bigger finale for boss clears

**Goal**: make defeating a boss milestone feel distinctly more climactic than
an ordinary level clear, reusing the existing last-bubble finale system.

**Design**:
- Extend `animations.js` `BubbleFinale`/`BUBBLE_FINALE_VARIANTS` with an
  optional "boss" mode: longer glow charge-up, a camera pull-back (via the new
  Combo Cam zoom helper if #1 ships first, or a standalone pull-back), a
  louder/layered fanfare (`Audio.js`), and a dedicated particle burst scaled up
  from the existing variants.
- Trigger: when `_bossObjectiveRemaining()` hits 0 (boss win), play the
  enhanced finisher instead of (or layered onto) the normal win flow, before
  `_finish` shows the recap modal.
- No tutorial step (bosses already have no tutorial step; this is a bigger
  version of an existing auto-mechanic).

**Tasks**:
- [ ] `animations.js`: boss-mode flag/variant on `BubbleFinale` (or a sibling
      `BossFinale` reusing its particle/timing helpers).
- [ ] `main.js`: wire boss-win detection to trigger the enhanced finisher
      before `_finish`.
- [ ] `audio.js`: a distinct boss-fanfare cue (or layer the existing win SFX).
- [ ] Unit tests: variant selection / trigger-condition logic.
- [ ] E2E test: a boss-level win plays the enhanced finisher (distinguishable
      from a normal level win, e.g. via a recorded variant/flag exposed on
      `__bpc`).
- [ ] `AGENTS.md` feature entry (extend the "Last-bubble finale" and/or
      "Milestone events" sections).
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## 6. Double-or-Nothing Wager — risk/reward stake on the Daily

**Goal**: add real stakes to the Daily challenge (currently "just clear it
once") for players who want the tension, while staying fully optional so
risk-averse players are never forced into it.

**Design**:
- Before starting the Daily, an optional wager step: choose a coin stake from
  a few preset tiers (e.g. 50/100/250, capped by current balance) for a payout
  multiplier (e.g. ×2.5) if the run's score beats the Daily's top goal tier;
  stake is forfeited if it doesn't. Skipping the wager (default) plays the
  Daily exactly as today.
- `economy.js`/`daily.js`: pure payout calculator (`wagerPayout(stake, score,
  goals)` — deterministic, unit-testable) and a debit/credit flow through the
  existing `Economy` coin APIs (debit **only** on explicit confirm, never
  automatically).
- Session: `session.wager` (stake + multiplier) persisted like other session
  fields; resolved once in the Daily's existing `_finish` path — never
  double-charged on resume/undo (debit happens once, at commit time, not on
  every snapshot).
- Must fail safe: cannot wager more than the current coin balance, cannot
  wager on a already-played-today Daily, no wager UI at all if coins are 0.
- No tutorial step — meta economy feature, optional and skippable by design.

**Tasks**:
- [ ] `daily.js`/`economy.js`: pure `wagerTiers(balance)` / `wagerPayout(...)`
      helpers + unit tests (edge cases: zero balance, exact-balance wager,
      losing forfeits the stake, winning pays the multiplier once).
- [ ] `ui.js`: optional wager-selection step before `startDaily()` (skippable),
      clearly showing stake/payout/risk.
- [ ] `main.js`: debit on confirm, resolve payout/forfeit in the Daily finish
      path exactly once.
- [ ] Unit tests for the debit-once/no-double-charge guarantee (simulate
      resume/undo paths).
- [ ] E2E tests: wager placed + goal beaten pays out; wager placed + goal
      missed forfeits the stake; skipping the wager behaves identically to
      today's Daily; cannot wager more than the balance.
- [ ] `AGENTS.md` feature entry (extend "Daily retention engine").
- [ ] `npm test` green, commit, push, verify CI + deploy + live site.

---

## Suggested Build Order

1. **Combo Cam** — smallest, purely cosmetic, no new save fields, good warm-up.
2. **Board Storm** — small, reuses existing grid-mutation patterns (vine/polarity spread).
3. **Boss Finisher Cinematic** — reuses existing finale system, moderate scope.
4. **Mystery Egg Hatching** — touches existing pet/crate flow, moderate scope.
5. **Lucky Wheel** — new module + new UI screen, larger scope.
6. **Double-or-Nothing Wager** — touches real economy/coins with fail-safe
   requirements; do last and review the debit-once guarantee carefully.

## Hands-Off Rules (same as `docs/release-todo.md`)

- Implement one feature fully (code + tests + docs) before starting the next.
- Run `CI=1 npm test` locally before every push.
- Verify GitHub CI after every push, and production deploy after every
  `master` change that affects shipped artifacts.
- Keep the tutorial in sync per `AGENTS.md` §11 — these 6 features are all
  auto-mechanics/meta systems with **no new tutorial step**, consistent with
  existing precedent (Downpour, Echo, achievements, etc.), but double-check
  this assumption during implementation in case the design changes.
