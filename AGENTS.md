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
  meter enables a double‑tap Charged Blast (`grid.blastArea`, diamond AoE). The
  moment charge becomes ready, a persistent on-board **blast target cue**
  highlights the best double-tap cell while charge remains full, choosing the
  location that would clear the most bubbles after special lightning/bomb chains;
  the target visibly shakes with a pulsing bullseye/glow so availability is
  obvious and actionable by sight.
  blast has its own punchy descending **`Audio.blast()`** SFX (and Fever entry
  its own rising **`Audio.fever()`** fanfare) — distinct from the generic
  `Audio.powerup()` blip so each moment reads by ear.
- **Fever mode** (`scoring.js` `feverGain`/`feverPoints`/`FEVER_DURATION`): a
  second HUD bar under the charge meter. Quick chains fill the Fever gauge
  (`feverGain` scales with combo); when it tops out the player enters **Fever**
  for `FEVER_DURATION` (6s), during which **every point earned is doubled**
  (`feverPoints`, applied in `popAt`/`chargedBlast`/`applyPowerup`). The bar
  glows hot and drains over the duration (`Game.update`), then resets. Fever
  state (`fever`/`feverActive`/`feverTimer`) lives on the session; the tutorial
  demos it via `tutorialGrant("fever")` → `_startFever`.
- **Combo escalator** (`scoring.js` `comboTier`/`COMBO_TIERS`, `ui.js`
  `showCombo`): back-to-back pops build `session.combo`, and the on-screen combo
  banner **escalates through named tiers** as the chain climbs — `comboTier(n)`
  (pure) maps the combo count to the highest reached tier (Nice ×2, Great ×4,
  Awesome ×6, Amazing ×9, Unstoppable ×13) and returns its `className`
  (`ct-1..ct-5`). `UI.showCombo(text, cls)` swaps that class so higher combos
  read bigger/hotter (ct-5 gets its own punchier `comboPopBig` animation). This
  amplifies the existing combo loop (no new gesture) and reuses the tutorial's
  **combo** step — **no extra tutorial step**.
- **Cascade chain bonus** (`scoring.js` `cascadeBonus`/`cascadeTier`/
  `CASCADE_TIERS`, `main.js` `popAt`): sustaining a chain (popping again before
  the combo window closes) pays a **flat, escalating bonus on top of** the
  multiplicative combo score. Where the combo multiplier rewards *big* groups,
  the cascade rewards *keeping the chain alive*, so stringing together many
  small pops is worthwhile too. `cascadeBonus(chain)` (pure) is `0` until the
  chain reaches `CASCADE_MIN` (2), then adds `CASCADE_STEP` (30) per extra link,
  capped at `CASCADE_CAP` (360); `chain` is `session.combo + 1` (the count
  before this pop is folded into `points` alongside the combo points, so it also
  benefits from Fever and pet score buffs). A distinct **chain-reaction callout**
  floats above the pop — `🔗 <tier> +<bonus>` keyed to `cascadeTier(chain)`
  (Cascade / Chain Reaction / Avalanche / Meltdown) — separate from the centre
  combo banner so the two reward layers read differently. `session.stats.
  bestCascade` tracks the longest chain. Auto mechanic, no new gesture — **no
  tutorial step**. (Exposed for tests via `__bpc.cascade`.)
- **Per-theme background music** (`audio.js` `MUSIC_PROFILES`/`musicProfile`/
  `startMusic`/`stopMusic`/`musicState`, `main.js` lifecycle): every visual
  theme has its own **fully procedural** backing track (no audio files — same
  Web Audio approach as the SFX). `musicProfile(themeId)` (pure) maps a theme to
  a profile (melodic `scale`, `bass` figure, `tempo`, oscillator `wave`/
  `bassWave`, gentle per-voice gains), falling back to the **aurora** track for
  unknown ids. The engine plays a single quiet voice — a melody that wanders the
  scale over a four-beat bass pulse (`_musicStep` on a `setInterval`) — routed
  through a dedicated `_musicGain` sub-bus under the master gain, so muting
  (master gain → 0) silences it **without stopping** the sequence. `_enterSession`
  calls `Audio.startMusic(this.theme.id)` (a no-op when the same theme is already
  playing, so the groove survives level restarts); `onThemeChange` swaps the
  track live when a session is active; `quitToMenu` and `finishTutorial` call
  `stopMusic`. Meta audio feature — **no tutorial step**. (Exposed for tests via
  `__bpc.Audio`.)
- **Weekly tournament** (`tournament.js` pure + `main.js` `startTournament`/
  `_finish`, `rng.js` `weekKey`): a replayable high-score chase on **one seeded
  board per ISO week** (`getTournamentLevel` keyed off `weekKey()`), with a
  deterministic weekly **modifier** (`TOURNAMENT_MODIFIERS`) and a local-only
  **rank ladder** (`TOURNAMENT_RANKS`: Bronze→Diamond) earned against four
  ascending score goals (`getTournamentGoals` → `tournamentRank`). Unlike the
  daily (once/day), it can be replayed all week to beat your own weekly best,
  tracked in `Storage` key `tournament` `{weekKey,best,plays}` via
  `recordTournament` (rolls over / resets when a new week starts;
  `getTournamentBest` ignores a stale week). Mode `tournament` runs through the
  generic `_newSession` with `movesLeft = 9999`, ends on board deadlock
  (`afterMove` → `_scheduleEnd(true,"tournament")`), and `_finish` awards coins
  (`floor(score/150)·coinMult`) + 40 season XP and shows the rank + weekly best
  on the win modal. Menu **Cup** tile (`#btn-tournament`) + `#tournament-summary`
  (modifier, best, days-left). No leaderboard, **no tutorial step** (meta mode).
  (Exposed for tests via `__bpc.tournament`.)
- **Time Attack** (`main.js` `startTimeAttack`/`update` countdown/`_finish`,
  `grid.js` `refill`): a **60-second** (`TIME_ATTACK_SECONDS`) score-rush on an
  endlessly-refilling board — the clock is the only limit. Mode `timeattack`
  runs through the generic `_newSession` (`session.timeLeft` seeded to 60); the
  `update` loop drains `timeLeft` each frame and calls
  `_scheduleEnd(true,"timeattack")` at zero. There is **no move limit and the
  board never ends play**: a deadlock in `afterMove` calls `board.refill()`
  (regenerates a full, solvable board, dropping fresh bubbles in) instead of
  failing. The HUD shows a live `Time` countdown (`Math.ceil(timeLeft)+"s"`) in
  the moves slot with a draining progress bar. `_finish` banks the run's score
  as `Storage.highScoreTimeAttack` (personal best, "🏆 New Best!" on improve),
  awards coins (`floor(score/150)·coinMult`) + 30 season XP, and shows a "Time's
  Up!" win modal. Menu **Rush** tile (`#btn-timeattack`). High-score meta mode —
  **no tutorial step**. (Exposed for tests via `__bpc.timeattack`.)
  **Power-ups** (`economy.js` `POWERUP_INFO`, armed from the HUD): **Bomb** (3×3),
  **Color Clear** (one colour), **Shuffle**, **Paint** (`grid.suggestRecolors`/
  `recolorCell` — tap one recolourable bubble, then choose from the three
  impact-ranked colour swatches that create the strongest next group),
  **Chain Bolt** (`grid.crossCells`, full row + column), **Pick** (single bubble; when aimed at a special bubble it
  also triggers that bubble's effect — lightning strike, bomb blast, multiplier,
  coin payout, vine cue), and the premium **Magnet**
  (`grid.magnetGather`) — arm it, tap a plain bubble, then lock a **circular
  strength dial** that pops up centred over the board (`#magnet-gauge`, a needle
  sweeping a 270° arc, swept in `Game.update`; the overlay is pointer-events:none
  Any tool-driven clear (bomb/color-clear/chain-bolt/pick) and Charged Blast now
  applies the full special set in the final cleared cells — lightning and bomb
  strike expansion plus multiplier score scaling, coin payouts, and vine cue.
  so the locking board tap still registers). The **green sweet spot is
  randomised** each use (`magnet.sweet` ≈ 0.22–0.78; the `.mg-ring` is rotated to
  match) so the player can't just lock dead-centre; strength tapers from full on
  the sweet spot to zero `MAGNET_HALF` away. The closer to green, the more of
  that colour is pulled into one connected blob (a perfect hit gathers the whole
  colour). The pull is a **real relocation**: `magnetGather` swaps the actual
  sprite objects between cells (not just their colour fields) and starts a slow
  `MAGNET_GLIDE` (~0.6s) ease on each moved bubble (`_startGlide`, animated in
  `Board.update`), so the player sees the coloured bubbles physically travel
  across the board and the displaced ones drift out. Gravity/collapse cancel any
  in-flight glide (`glideDur = 0`) so settling stays snappy. The grid/colour
  model ends up identical to before, so the blob is immediately poppable.
  Magnet aiming resolves taps against the **visible bubble position** too (not
  just the static grid cell): if a bubble is mid-animation and drawn offset,
  the target picker snaps to the nearest visible plain bubble near the tap,
  avoiding false "aim at a plain bubble" rejects.
  While aiming, the **target-colour bubbles shake** harder the nearer
  the needle is to green (`Renderer.drawBubbles` `aim` jitter). The Magnet is the
  dearest power-up (500 coins) and is deliberately saved for the late tool ramp.
- **Progressive tool unlocks** (`economy.js` `POWERUP_UNLOCKS`/
  `powerupsUnlockedBetween`, `ui.js` `showToolUnlock`, `main.js`
  `_grantToolUnlock`): new players start with **no tools at all** — the first
  five campaign levels keep the HUD quick-access rail, loadout picker, and tool
  shop quiet. Tools then unlock one at a time as campaign progress opens the
  next level: Undo at Level 6, Shuffle at 8,
  Bomb at 10, Color Clear at 13, Pick at 16, Paint at 18, Chain Bolt at 20, and Magnet at 24. The shop and
  loadout picker only list unlocked tools; before Level 6 they show a small
  "Tools unlock after Level 5" empty state, and the Starter Pack describes its
  locked contents as a future tool stash instead of spoiling the full toolbox.
  The level map also shows one compact **Next unlock** teaser (`.next-unlock-teaser`) for the nearest upcoming tool or pet feature, using the same unlock schedules so players can anticipate what is coming without seeing the whole toolbox at once.
  When a campaign clear crosses an unlock threshold, the game grants a starter
  charge if the player does not already own that newly unlocked tool, auto-slots
  it into the first empty HUD slot, and queues the dedicated **New Tool
  Unlocked!** modal (`#tool-unlock`) with the tool icon, unlock level, and a
  short use lesson. The modal appears automatically once the win reward chest
  flow has settled (after any Pick a bonus claim), with the Next button still
  acting as a fallback; pressing **Try it next level** starts the next campaign level. Normal shop
  purchases, HUD arming, and lone-bubble rescue offers are blocked while locked,
  so Pick is never recommended or sold before its Level 16 unlock. Meta rewards
  also pass through the same unlock rule: if a calendar/season/quest/gift/chest/
  treasure reward rolls a tool the player cannot use yet, `resolveRewardForUnlocks`
  / `_grantPowerupReward` convert it into coins instead of stockpiling a locked
  Bomb/Shuffle/etc. in the inventory.
- **Lone-bubble rescue** (`main.js` `_offerIsolatedRescue`/`_canRescue`/
  `_showIsolatedHelp`/`_rescueWithPick`/`_giveUpRescue`; `ui.js`
  `showIsolatedHelp`/`hideIsolatedHelp`, `#isolated` modal): single bubbles of
  different colours can't be popped on their own (a group of 2+ is required), so
  a board can **jam** with bubbles still on it. Instead of stranding or instantly
  failing the player, the deadlock is intercepted in `afterMove` (only when it
  would otherwise be a **loss** — campaign score < target, boss fail, or endless
  game-over; **daily** still completes as a win) and a friendly **"Oh no! Lone
  bubbles"** prompt steers the player to the **Pick 🔨** tool, but only after Pick
  has unlocked in the tool progression. Before Level 16 the same deadlock resolves
  normally instead of recommending a locked tool. The modal adapts:
  **Use Pick** if owned, **Buy Pick** (`POWERUP_INFO.pick.price`) if affordable,
  or informational if neither. Choosing Pick arms it (`armPowerup("pick")`) and
  keeps the level alive (`session.rescuing`); popping a lone bubble can make
  others fall into fresh matches (gravity in `settle`), which clears the rescue
  state so a later jam re-prompts. **Give Up** (`session.gaveUp`) declines the
  rescue and lets the level end normally. Power-ups never cost a move, so the
  Pick rescues even at `movesLeft === 0`.
- **Swipe-aware deadlock detection** (`main.js` `_isDeadlocked`; `grid.js`
  `hasShiftMove`/`_gridHasMoves`/`_simShiftRow`/`_simSettle`): a row **swipe** is
  a real move, so the board is only **deadlocked** when there is no tap-match
  (`Board.hasMoves`) **AND** no swipe the player can still afford would realign
  bubbles into a fresh match. `_isDeadlocked` first checks `hasMoves`, then — if
  the player can still shift (`movesLeft > 0` in campaign, `shiftTokens > 0` in
  endless/daily) — checks `Board.hasShiftMove`, which clones the grid/types and
  simulates each row shifted left/right (`_simShiftRow` + `_simSettle`, no
  sprites) to see whether any resulting board has a tap-match. `afterMove` uses
  `_isDeadlocked()` (not the raw `hasMoves`) so a level never finishes early with
  poppable-after-swipe bubbles still on the board. `_gridHasMoves` is the pure
  tap-match scan shared by `hasMoves` and the swipe lookahead; it guards against
  `types` being unpopulated during `_generate` (`types[c]?.[r] === RAINBOW`).
- **Last-bubble finale** (`animations.js` `BubbleFinale`/`BUBBLE_FINALE_VARIANTS`;
  `grid.js` `firstFilledCell`/`forceRemove`; `main.js`
  `_startLastBubbleFinale`/`_lastBubbleExplode`/`_finaleParticles`/
  `_lastBubbleResolve`): a board can be whittled down to a **single un-poppable
  bubble** (a lone bubble can never form a group of 2+). Instead of stranding the
  player, `afterMove` intercepts `countRemaining() === 1` (after pet help, before
  the deadlock/win checks) and plays a celebratory **glow-then-explode finale**
  that clears the board, then re-runs `afterMove` so the normal clear logic
  resolves the level (campaign/daily **win** since clearing the board always
  wins; endless **refill**). `BubbleFinale` is a purely cosmetic animator (ticked
  in `update`, drawn in `render` like the other transients): a charge-up glow
  phase, then **one of five random explosion styles** (`variant` 0–4: Supernova,
  Shockwave, Starburst, Flash-bloom, Firework) chosen via
  `Math.random()*BUBBLE_FINALE_VARIANTS`. It exposes two callbacks — `onExplode`
  fires once at the glow→blast boundary (the game does
  `Board.forceRemove` + `settle` + a variant-flavoured particle burst, shake,
  haptics and sound there) and `onDone` fires when the whole finale completes
  (resolution). The finale is deferred with `session.pendingFinale` until
  `Board.isIdle()` when the last bubble is reached while older pop/fall sprites
  are still visibly animating, so the screen never auto-clears ahead of what the
  player can see. While it plays, `session.finishing` is set and input is disabled
  (`afterMove` early-returns on `finishing`); the chosen style is stored on
  `session.finaleVariant` for inspection/tests. `Board.forceRemove(c,r)` clears a
  single cell **regardless of type** (ice cleared outright, unlike `removeCells`
  which only cracks ice); `firstFilledCell()` locates the lone bubble. This only
  triggers at **exactly one** bubble, so the multi-bubble lone-bubble rescue
  (`#isolated`) still handles 2+ stranded bubbles. Like other auto-mechanic
  visuals it gets **no tutorial step**.
- **HUD loadout** (`ui.js`, `storage.js` `loadout`): once tools are unlocked, the
  HUD shows **three quick-access slots** instead of one button per power-up (so
  it never grows as tools are added). Before the first tool unlock, the whole
  quick-access rail is hidden so fresh players don't see dead empty buttons. A
  short **tap** arms that slot's power-up; a **long-press**
  (>450ms) opens the loadout picker (`#loadout`) listing every currently
  unlocked tool — choosing one assigns it to the held slot via
  `Storage.setLoadoutSlot`, which keeps the three slots distinct (swapping if
  the tool is already equipped). New saves start with `[null,null,null]` until
  progression unlocks a tool. The loadout deep-merges into existing saves.
  The picker includes a **Suggest loadout** action (`.loadout-suggest`) during a
  live campaign level; `Game.suggestLoadout()` ranks the current level's boss,
  specials, move budget, and bonus objective, then fills the three slots with
  unlocked tools that fit that board (falling back to Undo/Shuffle/Bomb).
  Tapping a slot the player has **no charges of** (`armPowerup` sees
  `Economy.getPowerup(type) <= 0`) doesn't just toast — it opens the shop
  focused on that tool (`UI.openShopForPowerup`: pauses the live level, scrolls
  to + glows the matching `.shop-item[data-pu]`). `shop-back` routes through
  `UI.closeShop`, which resumes the paused level when the shop was opened
  mid-game (`_shopOverGame`) instead of dropping to the menu.
- **In-game pause + HUD status** (`ui.js` `openPauseOverlay`/`closePauseOverlay`/
  `updateHudStatus`, `main.js` `_hudStatus`): the HUD back button is now a
  **Pause** button (`#btn-back`, labelled `Ⅱ`) rather than an immediate quit.
  Opening `#pause` calls the existing `pauseForOverlay()` path (input disabled,
  falling events frozen), shows a compact run summary, and offers Resume, Shop,
  Settings, Retry, and Menu. Shop/Settings opened from pause remember that they
  are over a live level (`_shopOverGame`/`_themesOverGame`) so their Back button
  resumes the board instead of returning to the main menu. `refreshHud()` also
  feeds a compact `#hud-status` strip with existing session facts (Blast ready /
  charge close, Fever, hint on, undo count, shift tokens, pet soon). Display
  polish only — no save field, no tutorial step.
- **Undo tool** (`economy.js` `POWERUP_INFO.undo`, `main.js` `_pushUndo`/
  `canUndo`/`undoMove`): Undo is now a normal loadout tool, unlocked at Level 6
  and consumed from the player's power-up inventory (`Economy.usePowerup("undo")`).
  It lets the player take back their last committed move. Each session keeps a
  bounded `undoStack` (capped at `UNDO_STACK_LIMIT = 3`, oldest shifted out), but
  the available uses come from owned Undo charges rather than a separate per-level
  budget. `_pushUndo(refund)` snapshots
  the full board + scoring state (`board.serialize()`/`serializeTypes()`,
  `score`, `movesLeft`, `combo`/`comboTimer`, `power`, `fever`/`feverActive`/
  `feverTimer`, `shiftTokens`, `petTimer`, `objectiveMet`, `usedPowerup`, a copy
  of `stats`, and an optional `refund`) **before** every committed move — wired
  into `popAt`, `handleSwipe` (snapshot discarded if the row shift is a no-op),
  `chargedBlast`, `applyPowerup`, `lockMagnet`, and the shuffle branch of
  `armPowerup`. `undoMove()` (no-op + "Nothing to undo" toast when `canUndo()`
  is false — i.e. no session, ended, finishing, magnet aiming, pet picking, or
  empty stack) pops the snapshot, restores the board and
  every scalar/stat, **refunds** a consumed power-up/magnet/shuffle charge
  (`snap.refund.powerup` → `Economy.addPowerup(type, 1)`; refunds are `null` in
  the tutorial so practice stock is untouched), clears any preview/armed/magnet/
  hint state, updates the tool stock display, refreshes the HUD, re-persists the
  session (campaign), and toasts the remaining Undo stock. The tutorial teaches
  it with a gated **undo** step (after **combo**) whose `grant: "undo"` ensures a
  snapshot exists and equips practice Undo stock, and the game emits `_tut("undo")`
  on a successful undo.
- **Hold-to-buy** (`ui.js` `_attachHoldRepeat`/`_buyHoldMs`/`_buyHoldMax`): power-up buy
  buttons buy once on a tap and **keep buying while held** at a configurable
  rate — `settings.buyRepeatMs` (default **500ms = 2/sec**; override at runtime
  via `UI.buyHoldInterval`) — and a per-held-press safety cap,
  `settings.buyBatchMax` (default **10**, hard-clamped to 10; override at runtime
  via `UI.buyHoldMax`). Both preferences are exposed on the Themes/settings
  screen as segmented controls. During a held repeat, the shop/crate buy button
  shows live `Buying N / max` feedback and then `Limit N/max` when the safety cap
  is reached. The repeat fires immediately on `pointerdown`, then
  on an interval, and stops on `pointerup`/`pointerleave`/`pointercancel`, when
  the batch cap is reached, or when a purchase fails (out of coins). To survive a hold, the buy updates the item's
  `.si-owned` count + coin balance **in place** (it must NOT call `buildShop`,
  which would tear down the held button). Power-up rows now expose affordability
  visually with `.cannot-afford` on the row and `.need-coins` on the buy button,
  updating those classes in place after each successful purchase so a held buy
  can naturally stop when the player runs out of coins. IAP/coin-pack/remove-ads/
  theme buttons stay single-press (real-money or one-time buys never auto-repeat).
  Keyboard Enter/Space buys once.
- **Special bubbles** (`grid.js` `types` layer): **Rainbow** = colour wildcard
  that bridges regions; **Ice** = needs two hits (cracks, then clears);
  **Lightning** (`LIGHTNING`) = a charged coloured bubble — popping a group that
  contains one **discharges along its whole row + column**
  (`grid.lightningStrike` expands the cleared set via `crossCells`, deduped;
  strike resolution then re-checks the enlarged cleared set so specials hit by
  the strike can chain (for example lightning↔bomb cascades) before scoring;
  `popAt` scores the full strike and emits `_tut("lightning")`); **Stone**
  (`STONE`) = a **locked** bubble you can't tap (`getGroupAt` returns `[]` on it,
  and it never joins a colour group), but any **orthogonally adjacent pop**
  (tap, blast, AoE, or lightning) shatters it — `grid.removeCells` runs a second
  pass over the cells it actually cleared, breaking neighbouring stones once
  each (no chaining) and tagging the returned fx array with `fx.stonesBroken`;
  `_popCells` reads that flag to emit `_tut("stone")`. **Bomb** (`BOMB`) = an
  explosive coloured bubble — popping a group that contains one **detonates a
  3×3 area** around each bomb cell (`grid.bombStrike` expands the cleared set via
  the existing `bombArea` 3×3 square, deduped; strike resolution then re-checks
  the enlarged cleared set so specials hit by the blast can chain (for example
  bomb→lightning→more blast cells) before scoring; `popAt` scores the full blast,
  shows a `💥 BOOM!` flourish and emits `_tut("bombbubble")`). Like lightning,
  bombs are ordinary colour bubbles that join groups normally. **Multiplier**
  (`MULTIPLIER`, the gold bubble) = popping a group that contains one
  **multiplies that pop's score** by `min(8, 2^N)` for `N` gold bubbles in the
  set (computed inline in `popAt` → `scoreMult`/`finalPoints`); no AoE, no
  power/Fever feed — a pure score reward with a `✨ ×N!` flourish and
  `_tut("multiplier")`. **Coin** (`COIN`, the treasure bubble) = popping a group
  that contains one **drops bonus coins** straight into the wallet
  (`COIN_BUBBLE_VALUE = 12` per coin bubble cleared, counted across the full
  cleared set so AoE that hits a coin also pays out; `Economy.addCoins`,
  **skipped in the tutorial** which never touches the real economy), with a
  `🪙 +N` flourish and `_tut("coinbubble")`. **Vine** (`VINE`, the creeping
  threat) = a green coloured bubble that **spreads to one orthogonally-adjacent
  ordinary bubble on every resolved move** until its cluster is popped
  (`grid.spreadVines` sprouts exactly one new vine per call into a `NORMAL`
  neighbour, deterministic via the board rng so growth stays bounded and the
  board solvable; `vineCount()`/`isVine()` query it; `main._spreadVines` is
  called once per move from `afterMove` — after the pet/finale guards so it never
  double-spreads, and never in the tutorial sandbox — dropping a small `🌿` cue
  at the new cell). Vines pop like any coloured bubble (they join groups); popping
  a group that contains one emits `_tut("vine")` (captured before `_popCells` so
  a grant-driven board rebuild can't misfire it). `_gridHasMoves`
  excludes stones as both move origin and same-colour neighbour so
  generation/deadlock detection stay correct (the coloured specials —
  lightning/bomb/multiplier/coin/vine — need no exclusion). Seeded spawn rates
  ramp in by level (rainbow ≥6, coin ≥8, ice ≥10, multiplier ≥12, lightning ≥14,
  bomb ≥16, stone ≥18, vine ≥20 — see `levels.js specialsForLevel`; bosses force
  `specials.ice`/`specials.stone`/`specials.vine` to 0, but allow
  lightning/bomb/multiplier/coin). Lightning draws a glowing pulsing bolt glyph,
  Stone a grey padlock shell, Bomb a dark fused shell with a pulsing lit spark,
  Multiplier a pulsing gold ring with a "×2" glyph, Coin a shiny gold disc with a
  "$" glyph, and Vine curling green tendrils + leaf dots (`renderer.js`). These
  procedural marks are now reinforced with local white SVG overlays from
  **Game-icons.net** (`assets/icons/game-icons/`, CC BY 3.0 attribution recorded
  in that folder's `README.txt`; no remote runtime loading) so special bubbles
  read more clearly on mobile while retaining a fallback if an icon is still
  decoding. All
  types are part of the save/resume snapshot. The tutorial
  teaches Lightning (`grant: "lightning"` → `Game._placeTutorialLightning`),
  Stone (`grant: "stone"` → `Game._placeTutorialStone`, advancing on
  `_tut("stone")`), Bomb (`grant: "bombbubble"` →
  `Game._placeTutorialBomb`, advancing on `_tut("bombbubble")`), Multiplier
  (`grant: "multiplier"` → `Game._placeTutorialMultiplier`, advancing on
  `_tut("multiplier")`), Coin (`grant: "coinbubble"` →
  `Game._placeTutorialCoin`, advancing on `_tut("coinbubble")`) and Vine
  (`grant: "vine"` → `Game._placeTutorialVine`, advancing on `_tut("vine")`)
  with gated steps. (The bomb **bubble** uses the `bombbubble` step/grant/action
  id to avoid colliding with the bomb **power-up** step's `grant: "bomb"`.)
- **Downpour** (the Tetris-style advanced-level modifier) drops a fresh row of
  ordinary bubbles in from the **top** every N resolved moves; with gravity
  settling **downward**, each column's new bubble rests directly on top of its
  stack so the board climbs toward the ceiling, and the player is **buried** only
  when a rain tick finds **every column** already blocked at the top edge **while
  the score target is still unmet** (level lost, fail title `"Buried!"`). If the
  score target has already been reached, downpour no longer triggers a buried loss
  (it remains a pre-target pressure mechanic, not a post-target steal).
  It's **move-driven, not realtime**, so the tap-to-pop core is untouched.
  `levels.downpourForLevel(n)` arms it only on campaign levels ≥
  `DOWNPOUR_MIN_LEVEL` (30) and returns `null` on boss/treasure milestones
  (`milestoneType` suppresses it), with the cadence tightening from every 6 moves
  to a floor of every 3 as difficulty ramps to the cap (`{interval}`); `getLevel`
  carries it as `level.downpour`. `grid.dropRow()` places one `NORMAL` bubble at
  the cell above each column's stack (sprites start above the board so they
  visibly fall in), choosing the colour that yields the **largest immediate
  connected group at that landing cell** (ties resolved by seeded RNG) so rain
  tends to create playable opportunities instead of pure punishment, and returns
  `{added:[{c,r}], buried:[c,...]}`. Downpour sprites also use a slower follow
  multiplier + wider row stagger than normal bubble motion, plus a dedicated
  slow settle duration, so rain reads as a deliberate hazard beat instead of a
  sudden, hard-to-react snap;
  `grid.topFilledRow()` (0 = a bubble on the very top edge, `rows` = empty) drives
  the warning cue. `main._downpour()` is called once per move from `afterMove`
  (after the win guard, before deadlock detection; campaign-only, skipped during
  finale), counts `session.movesSinceDrop` and on reaching `interval` resets it
  and calls `dropRow` — playing a `🌧️ Downpour!` cue on a successful rain and
  granting **one extra move per successful rain tick** before checking for loss
  (`+1` per drop event, regardless of how many balls were added),
  then `_scheduleEnd(false, "buried")` when any column overflowed.
  End-of-level modals now wait for pending pop animation frames to settle
  (with a timeout guard) before `_finish`, so the screen never cuts away while
  bubbles are still visually exploding.
  `movesSinceDrop`
  is part of the save/resume snapshot. `renderer.drawDangerLine` paints a pulsing
  dashed red line `dangerRows` (2) cells down from the top once the stack climbs
  into that zone, brightening/quickening with proximity; `main` only draws it
  when `session.downpour` is set and `topFilledRow() <= dangerRows`. No tutorial
  step (it's an advanced meta-threat, like gems).
- **Ads gating** (`monetization.js`): forced interstitials only from
  `adsStartLevel` (7) onward; rewarded ads always available. The manager owns
  all **policy** (cadence, new-player grace, the ads-removed gate, and
  persisting the `adsRemoved` flag after any successful `remove_ads` purchase),
  and the actual ad/IAP surface is **pluggable**: ship a real SDK by injecting a
  provider via `Monetization.setProvider(p)` (revert with `clearProvider()`/
  `setProvider(null)`). A provider may implement `showRewardedAd(label)`,
  `showInterstitial()`, and/or `purchase(productId)`; any method it omits falls
  back to the built-in mock on web/dev only (`_providerCan` gates per-method), so
  a platform can override just the surfaces it supports. Native Capacitor builds
  fail closed without a real provider: no fake purchases, no fake rewarded ads.
  Swapping providers can never change
  *when* ads show or *whether* the ads-removed flag is recorded — that contract
  stays in the manager.
- **Coin economy** (`scoring.coinReward`, `economy.js`): level payout is
  `floor(score/100) + stars*20`, tuned so a ~2-star player affords a cheap
  power-up (100–150) every 2–3 levels without ads. The shop's **Free Coins**
  item is a daily-capped rewarded ad (`Economy.adCoinState`/`claimAdCoins`):
  `AD_COIN_REWARDS = [150, 250, 400]`, **3 grants/day** that escalate then lock
  until the next day (`adRewards` tracker resets on `todayKey` rollover). Paid
  IAP packs (`COIN_PACKS`) are coins-only: Bag 1500/$1.99, Chest 5000/$4.99 —
  there is no longer an unlimited "watch ad for coins" pouch.
- **Starter Pack** (`economy.js` `STARTER_PACK`, `storage.js` `starterPack`,
  `monetization.js`, `main.js` `buyStarterPack`, `ui.js`
  `_buildStarterPackItem`): a one-time value bundle shown at the **top of the
  shop** (`.shop-starter`, "BEST VALUE" badge). `STARTER_PACK` is
  `{ id:"starter_pack", price:"$1.99", coins:2000, powerups:{bomb:3,colorClear:2,
  shuffle:2,magnet:1}, crates:1 }`. `Game.buyStarterPack()` goes through the
  (mock) IAP (`Monetization.purchase("starter_pack")`), then grants the coins,
  every bundled power-up, and the pet crate, and flags `starterPack: true` in the
  save so it is **one-time only** (a second buy returns `{ ok:false, owned:true }`
  and the shop renders "Owned ✓"). `starterPack` deep-merges into old saves. Meta
  IAP — **no tutorial step**.
- **Win-screen reward chest** (`ui.js` `showWin`/`openWinChest`, `#win`): coins
  are credited to `Economy` *before* `showWin`, so the chest is purely
  presentational. On show, the reward block (`#win-reward-reveal`) starts
  **sealed** (`.is-sealed`, hidden) and a fully local CSS-built treasure chest
  (`#win-chest-art`) **shakes** (`@keyframes wc-shake` on the inner art, never on
  the clickable `#win-chest` button — transforms on clickable elements flake
  Playwright clicks) with a "Tap to open!" hint. The chest art is layered CSS
  (wood gradients, metal bands, jewel insets, glow) so it never depends on remote
  graphics or CDN runtime loads. Tapping the chest →
  `openWinChest` (idempotent via `_winChestOpened`): lid flips
  (`.open` → `rotateX`), `_spawnChestBurst` flings coin/sparkle glyphs, the
  reward reveals (`.revealed`, `wc-reveal` fade-up), the coins count up
  (`_animateCoins` from 0 to `_winCoinsPending`), and the **Double coins**
  rewarded-ad offer (`#win-double`) is shown only if `_winShowDouble`. The
  reward text still lives in `#win-reward` inside the sealed block, so
  `toContainText` assertions read it regardless of visibility.
  Campaign wins also reveal a one-time **Pick a bonus** row after the chest opens
  (`#win-choice`): up to three additive options such as extra coins, Season XP,
  a suggested tool charge, pet XP, Pet Dust, or an occasional crate depending on progression.
  `Game.claimWinChoice(id)` grants exactly one choice per win and refreshes the
  visible economy/loadout state.
- **Daily retention** (`daily.js`): rotating seeded modifier, three tiered
  goals → daily stars, a 7‑day reward cycle, and a streak‑freeze token that
  rescues one missed day. The daily can be **completed only once per day**:
  `recordDaily` stamps `lastDate`, `Game.startDaily` refuses to open a fresh
  board when `alreadyPlayedToday()` (toasts "back tomorrow" instead), and the
  menu's Daily tile is **locked** (`updateDailySummary` toggles `.locked`).
- **Login calendar / daily gifts** (`calendar.js`, pure; `storage.js`
  `loginCalendar`): a rolling **7-day login reward cycle** that advances **once
  per calendar day** the player claims. `CALENDAR_REWARDS` is the 7-day table
  (escalating coins, two free power-ups, and a **day-7 grand prize** of big
  coins + a pet crate). The module is pure/deterministic: `calendarStatus(state,
  key)` returns `{ claimable, index, reward, day, claimedToday }` (the reward to
  claim next is `day % CALENDAR_CYCLE`), and `advanceCalendar(state, key)`
  produces the post-claim state (`{ lastClaim, day+1 }`). State lives in
  `storage.js` `loginCalendar: { lastClaim, day }` (deep-merges into old saves).
  `Game.claimCalendar()` (idempotent per `todayKey()`) grants the reward via
  `Economy.addCoins`/unlock-aware power-up conversion + `Storage.addCrates`,
  advances the state, and
  refreshes the UI. The **Gifts screen** (`ui.js` `buildCalendar`, `#calendar`,
  menu **Gifts** tile) renders the 7 day cells (collected / today / upcoming,
  with the grand prize spanning the last row) and a Claim button; a menu tile
  badge (`refreshCalendarBadge`, `#cal-badge`) shows when today's gift is
  unclaimed. Like other meta/reward displays this gets **no tutorial step**.
- **Falling events** (`events.js`, `main.js` `_updateEvents`/`_spawnEvent`,
  `ui.js` `spawnFallingEvent`): every ~12–20s **during recent board play** a 🎁 **gift** or ⚠️ **problem**
  token drifts down the screen (`#events-layer`, `pointer-events:none` so it
  never blocks board taps; the token itself is tappable). The event clock does
  not start before the player interacts with the board and pauses again after a
  short idle grace (`EVENT_BOARD_IDLE_GRACE`), so waiting cannot farm gifts;
  tapping the falling token itself does **not** count as board activity. Tap a gift to collect
  coins (`GIFT_COIN_MIN..MAX`) or, ~40% of the time (`GIFT_POWERUP_CHANCE`), a
  free power-up (`GIFT_POWERUP_POOL`, excludes magnet) — tools land often enough
  to feel like a real drop, not just coins; locked tool rolls are converted to
  coins until that tool unlocks. Tap a problem to **defuse** it for a
  small coin reward; if it falls off-screen untouched it rolls one of five
  `PROBLEM_EFFECTS`: scatter nearby bubbles (`board.scatterArea`), scramble the
  board (`board.shuffle`), drain moves/seconds, freeze a few normal bubbles, or
  seed a creeping vine threat. Suspended during the tutorial (auto-spawns gated)
  and once a session ends. Campaign, puzzle, daily and tournament boards also
  carry a visible status-chip countdown (`screenTimeLeft`, persisted for
  campaign resume and undo snapshots) so a screen cannot be held open forever;
  campaign/puzzle timeouts fail the board, while daily/tournament timeouts bank
  the run like their normal end conditions. Also **paused** while the player is off the playing
  window: `pauseForOverlay`/`resumeFromOverlay` (used by the pet manager and the
  mid-level shop) call `UI.pauseFallingEvents`/`resumeFallingEvents`, which add a
  `paused` class to `#events-layer` that freezes the token's CSS fall (so it
  can't silently miss) and hides it until the player returns. `events.js` is
  pure/seedable; `game.spawnEvent(type)` is an E2E hook.
- **Achievements** (`achievements.js`, pure): 8 **tiered categories** that
  reward lifetime play (Popper, Combo Master, Big Bang, Fever Pitch,
  Trailblazer, Star Collector, Bomb Squad, High Roller). Each category tracks
  one lifetime metric and has an escalating ladder of 5 tiers (e.g. Popper:
  1 → 100 → 500 → 1000 → 5000 pops). Clearing a tier fills its **progress bar**
  and makes a **collectible chest** claimable. The module is pure —
  `mergeProgress` folds a delta into a lifetime `progress` object (sum, or max
  for best‑fields), `ACHIEVEMENT_CATEGORIES`/`getCategory` describe the ladders,
  `categoryStatus(cat, progress, claims)` returns the current tier + progress +
  `claimable` flag, `claimableCount`/`claimableCategories` summarise what's
  ready, and `rollChest(rng, {tierIndex, coins})` rolls seeded chest contents
  (`{ coins, bonusCoins, powerups[], petRoll }`). State lives in `storage.js`
  `achievements: { progress, claims }` where `claims` maps a category id → how
  many tiers have been collected (`getAchievementState`/`setAchievementState`).
  `Game._recordProgress(delta)` is called from `popAt`, `_startFever`, the
  defuse handler and `_finish`; it accrues progress and toasts when a new chest
  becomes claimable (coins are **not** auto‑paid). `Game.claimAchievement(id)`
  validates a claimable tier, rolls the chest (seeded, like crate opens),
  grants coins + power‑ups (`Economy.addPowerup`) + a rare pet (`rollCrate` +
  `Storage.grantPet`, ~4% chance), and advances the category. **Tutorial play
  never counts** (guarded). The **Achievements screen** (`ui.js`
  `buildAchievements`, `#achievements`, menu button) renders each category as a
  card with a tier badge, progress bar and a "Collect 🎁" button on claimable
  tiers; collecting opens the `#chest` reveal modal listing every reward. A
  badge on the menu Trophies tile (`refreshAchievementsBadge`) shows the chest
  count. A **Collect All 🎁** button (`#achv-collect-all`, shown only when ≥1
  chest is ready) batch‑collects **every ready chest** in a single tap via
  `Game.claimAllAchievements()`, which **loops** `claimAchievement` over
  `claimableCategories` until nothing is claimable — so a category that has
  several earned‑but‑uncollected tiers stacked up (a metric that blew past
  multiple thresholds) is fully drained in one press, not tier‑by‑tier (the
  loop always terminates: each claim advances a category's claimed count, so the
  claimable set strictly shrinks). `aggregateChestRewards(rewards)` (pure, in
  `achievements.js`) merges the results into one summary (`{count, coins,
  powerups[] merged by id, pets[], categories[]}`). The model is granted
  synchronously; the UI then plays a **cosmetic flying‑gift sweep**
  (`_playCollectAllSweep`: a `.caf-token` 🎁 flies from each collected row up to
  the screen top via the Web Animations API, staggered, with a `.caf-burst`)
  and shows the **aggregate reveal** (`_showCollectAllReveal`) reusing the
  `#chest` modal ("Collected N chest(s)!").
- **Colourblind mode** (`renderer.js` `CB_SYMBOLS`, `storage.js`
  `settings.colorblind`): an accessibility toggle that stamps a **distinct
  symbol per colour** on plain bubbles so colours are readable by shape, not
  just hue. The renderer holds a `colorblind` flag (`Renderer.colorblind`),
  drawn in `drawBubbles` for `NORMAL` bubbles only (Rainbow/Ice keep their own
  look). The flag is applied at startup from `Storage.get("settings")` and
  updated live via the `onColorblindChange` UI callback. The toggle lives on the
  **Themes screen** (`#cb-toggle`); the setting deep-merges into existing saves.
- **Reduced motion / accessibility** (`storage.js` `settings.reducedMotion`,
  `animations.js` `ScreenShake.motionScale`, `particles.js`
  `ParticleSystem.motionScale`, `main.js` `_applyReducedMotion`, `ui.js`
  `_refreshReducedMotionToggle`/`_motionOff`, `styles.css`): an accessibility
  toggle that **calms motion** for players sensitive to vestibular triggers. When
  on it disables **screen shake** (`ScreenShake.motionScale` → 0, applied at the
  single `add()` chokepoint so all shake is gated), thins **particle bursts**
  (`ParticleSystem.motionScale` → 0.45 scales `burst`/`sparkle` counts and skips
  expanding shockwave `ring`s below a 0.6 threshold), suppresses purely
  decorative UI bursts (`_motionOff` gates `_playPetConfetti`/`_spawnChestBurst`),
  and adds a `body.reduced-motion` class that **neutralises large CSS
  animations/transitions** (blanket rule in `styles.css`). The CSS also honours
  the OS `@media (prefers-reduced-motion: reduce)` preference independently (free,
  no JS); the JS runtime flag stays driven solely by the explicit setting for
  deterministic tests. `_applyReducedMotion(on)` (called at startup from the saved
  setting and live via the `onReducedMotionChange` UI callback) sets
  `Game.reducedMotion`, both `motionScale`s, the body class, and `UI.reducedMotion`.
  The toggle lives on the **Themes screen** (`#rm-toggle`, default **off**);
  `settings.reducedMotion` deep-merges into existing saves. Like colourblind/hints
  it is a **settings/accessibility toggle, not a gesture**, so it gets **no
  tutorial step**. Also tightened core ARIA: the `#game-canvas` is `role="img"`
  with an `aria-label`, `#toast` is an `aria-live="polite"` `role="status"` region,
  and key overlays (`#win`/`#lose`/`#pause`/`#pet-confirm`/`#pet-reveal`/
  `#isolated`/`#loadout`/`#tool-unlock`/`#chest`) are `role="dialog"
  aria-modal="true"`.
- **Idle move hint** (`grid.js` `findHint`, `renderer.js` `drawHint`, `main.js`
  `_updateHint`/`_noteActivity`/`HINT_DELAY`, `storage.js` `settings.hints`): a
  player-friendly assist that nudges a stuck player. After `HINT_DELAY` (5s) of
  **inactivity** the largest poppable group (`Board.findHint`, a pure scan that
  mirrors the autoplay flood-fill: dedup via a `seen` set, keep the longest
  `getGroupAt` group ≥ 2, or `null` when there's no tap-move) is promoted into
  `session.hint` and drawn as a **marching-ants cyan ring** plus a subtle fill
  and inner white contrast ring (`Renderer.drawHint`, purely cosmetic) around
  those cells. `_updateHint(dt)` (ticked from
  `update(dt)` inside the live-session block) accrues `session.idleTime` but
  **suppresses** the hint while the player is mid-gesture (`armed`/`preview`/
  magnet `aiming`/`combo > 0`), when hints are off, in the tutorial, or once the
  session ends. Any input (`handleTap`/`handleDoubleTap`/`previewAt`/
  `handleSwipe`) and every resolved move (`afterMove`) call `_noteActivity()`,
  which resets the timer and clears the hint. `render()` draws the hint only
  when there is no active `preview` (preview takes precedence). The assist is
  toggleable on the **Themes screen** (`#hints-toggle`, default **on**) wired
  like colourblind — `settings.hints` persists (deep-merges into old saves),
  flips `Game.hintsEnabled` via the `onHintsChange` UI callback, and refreshes
  through `_refreshHintsToggle`. Like colourblind/themes/achievements, this is a
  **settings/assist toggle, not a gesture**, so it deliberately gets **no gated
  tutorial step** (consistent precedent — the tutorial teaches gestures &
  mechanics, not display/assist settings or meta displays).
- **Performance — capped particle pool** (`particles.js` `MAX_PARTICLES = 600`,
  `ParticleSystem._cap`): the canvas runs a single rAF loop (`Game.loop`) and
  every effect system (`particles`, `floating`, `petAnim`, `finale`, `shake`)
  self-expires its items, so there is **no per-frame leak**. The one
  unbounded cost was the particle pool: rapid high-level **combo/Fever pop
  storms** stacked thousands of additively-blended (`"lighter"`) particles
  before the old ones faded, and per-frame `draw` cost climbed into a
  **superlinear cliff** (~0.9ms at 1k → ~1.4ms at 2k on desktop, far worse on
  mobile) — the "slowdown after progressing". `burst`/`sparkle` now call
  `_cap()`, which trims the **oldest** (already-fading) particles once the pool
  exceeds 600. A single big clear stays well under the cap (so the look is
  unchanged); only runaway storms are bounded, holding worst-case draw cost flat.
- **Performance — memoized bubble colour helpers** (`renderer.js` `hexToRgb`/
  `shade`/`lighten`): `drawBubbles` runs every frame and computes several derived
  colour strings **per bubble** (body-gradient stops, rim and highlight shades,
  including the liquid-candy depth ramp added to the base orb rendering). Each
  call previously re-parsed the hex and allocated a fresh `rgb(...)` string,
  so a busy 56-bubble board churned **thousands of hex-parses + string
  allocations per second** (≈4 calls × bubbles × 60fps). These three helpers are
  **pure** over a tiny finite key space — a theme's palette (~6–8 colours)
  crossed with the handful of literal factor constants used in the draw code —
  so they are now **memoized** (`Map` caches keyed by `hex` / `hex|factor`),
  collapsing the per-frame colour work to cache hits (~0.01ms/frame in a
  micro-benchmark over the real palettes). Outputs are **byte-identical** (unit
  tests pin the exact `rgb(...)` strings and prove the cache returns stable
  results), and `hexToRgb`/`shade`/`lighten` are exported so the memoization is
  unit-testable. Behaviour-preserving render optimization → **no tutorial step**.
- **Base bubble rendering polish** (`renderer.js` `drawBubbles`): the ordinary
  bubble body is still fully procedural Canvas (no asset files or rendering
  package), but now layers a tight contact shadow, a brighter crown-to-dark-edge
  radial fill, a clipped upper wash, crisp double rims, a lower refraction
  crescent, and two specular highlights. This gives the orbs more depth and
  shine while avoiding the old blurry halo problem, keeps colourblind symbols and
  special-bubble overlays on top, and adds no new tutorial step because it is
  cosmetic only.
- **Group-pop explosion styles** (`particles.js` `popStyleForGroup` +
  `ParticleSystem.ring`/`spriteBurst`, `main.js` `_popCells`): every group pop plays **one of
  five escalating explosion animations** — the bigger the group, the more
  impactful the effect. The pure `popStyleForGroup(size)` returns a style
  descriptor `{ style: 0-4, name, perCell, power, rings, flash, sparkle }` keyed
  by group size (2-3 `fizz` → 4-5 `pop` → 6-7 `burst` → 8-11 `blast` → 12+
  `supernova`); higher tiers throw **more particles per cell**, then **expanding
  shockwave rings** at the group centre, and at the top a **white flash bloom**
  plus a **sparkle shower** (shake is also boosted on flash tiers). A small local
  sprite layer from the **Kenney Particle Pack** (CC0; selected PNGs vendored in
  `assets/vfx/kenney-particles/`, no remote loading) rides on top of the
  procedural particles via `ParticleSystem.spriteBurst`, with `MAX_SPRITES = 180`
  and reduced-motion scaling just like the base particle lane. `_popCells`
  picks the style by `groupSize`, bursts per cleared cell, emits sprite particles
  per cleared cell, then emits the centroid rings/flash/sparkle. `ParticleSystem.ring(x,y,color,{maxRadius,width,
  life,fill})` is an expanding additively-blended arc (`fill` = soft flash);
  rings live in `this.rings`, self-expire in `update`, draw in `draw`, and are
  bounded by `MAX_RINGS = 48` (same anti-storm cap as particles) and cleared on
  session reset. `main.js` records `game._lastPopStyle` and exposes
  `__bpc.popStyle = popStyleForGroup` for inspection/tests. Purely cosmetic
  auto-mechanic → **no tutorial step** (consistent with the last-bubble finale).
- **Per-level best score** (`storage.js` `levelScores`/`getLevelScore`/
  `recordLevelScore`, `main.js` `_finish`, `ui.js` `buildLevelMap`): each
  campaign level tracks a **personal best**. On a campaign win `_finish` calls
  `Storage.recordLevelScore(levelId, score)`, which keeps only the highest and
  returns `{ best, isNewBest }` — `isNewBest` is true **only when the run beats a
  pre-existing best** (a first clear sets the best but is not celebrated). A
  genuine new best pushes a **"🏆 New best score!"** line into the win recap's
  `rewardBits` (`#win-reward`). The **level map** (`buildLevelMap`) shows the
  stored best (`🏆 <score>`, `.lvl-best`) under the stars on every cleared cell.
  Tapping an unlocked map cell opens a compact **level briefing** (`#level-brief`)
  before play starts: target, moves, colors, bonus objective, board traits, and
  unlocked suggested tools. Replays also show the stored stars/best score in
  `#brief-replay` and relabel the primary action to **Replay**. `#brief-start` is the only path that calls
  `startLevel`, so map clicks now preview instead of launching immediately.
  `levelScores` is a new `DEFAULT_SAVE` field, so old saves auto-default to `{}`.
  Like stars/achievements this meta-progression display gets **no tutorial
  step**.
- **Endless / generative campaign** (`levels.js` `LEVEL_COUNT`/
  `DIFFICULTY_CAP`/`AUTHORED_LEVELS`, `milestones.js` `BOSS_TIER_CAP`, `ui.js`
  `buildLevelMap`): the campaign no longer stops at 40 — `LEVEL_COUNT = 9999`
  (a clamp bound, effectively endless) and every level is **generated** by the
  pure per-level helpers. The first `AUTHORED_LEVELS` (= `CHAPTERS.length *
  CHAPTER_SIZE` = **40**) keep their **exact original tuning** (difficulty input
  `d === n` there), so the hand-tuned 1–40 arc is unchanged. Beyond that,
  difficulty **ramps then plateaus**: `getLevel`/`objectiveForLevel` clamp the
  difficulty input to `d = min(n, DIFFICULTY_CAP)` (= **60**), so cols/rows/
  colors/cells/moves/target/specials/objective goals all stop growing at a fair
  peak and levels stay **winnable forever** (without the cap, target grew
  linearly while moves floored at 6 → eventually impossible). Identity fields —
  `seed` (`level-${n}-bpc`), `chapter`, milestone type — still use the real `n`,
  so each high level is a distinct seeded board even though two capped levels
  share scaling (e.g. `getLevel(61)` and `getLevel(9991)` have identical
  cols/rows/colors/moves/target/specials). Boss objectives are likewise capped
  via `BOSS_TIER_CAP = 8` (`tier = min(idx, 8)`) so deep bosses' frozen
  cores/stone vaults/extra-moves stay board-sized; the boss *archetype* still
  rotates on the real `idx`. `main.js` `showNext` (`s.level.id < LEVEL_COUNT`)
  lets the player advance indefinitely, and `maxUnlockedLevel` just increments.
  Generative levels are **not** a player gesture/mechanic → **no tutorial step**.
- **World map chapters** (`levels.js` `CHAPTERS`/`CHAPTER_SIZE`/
  `PROC_CHAPTERS`/`romanize`/`chapterForLevel`, `ui.js` `buildLevelMap`): the
  campaign is grouped into **themed chapters of 8 levels**. The first 5 are the
  authored worlds (Bubble Meadow 🌱, Frosty Peaks ❄️, Thunder Valley ⚡, Crystal
  Caverns 💎, Cosmic Finale 🌌); past level 40 chapters are **procedurally
  named** from `PROC_CHAPTERS` (8 worlds: Aurora Reach 🌠, Ember Hollow 🔥,
  Tidal Expanse 🌊, Verdant Wilds 🍃, Obsidian Depths 🪨, Solar Spire ☀️, Nebula
  Drift 🌫️, Mirage Sands 🏜️), cycling with a Roman-numeral suffix
  (`romanize(cycle+1)`) on repeats so names stay distinct forever. `CHAPTERS`/
  `PROC_CHAPTERS` are pure presentation/flavour metadata (they do **not** alter
  difficulty, which the per-level helpers drive); `chapterForLevel(id)` resolves
  the chapter (authored or procedural) + `startLevel`/`endLevel` range and is
  folded into `getLevel(id).chapter`. `buildLevelMap` renders a **bounded
  window** — every authored/cleared level plus one preview chapter beyond the
  player's progress (`renderEnd = min(LEVEL_COUNT, max(AUTHORED_LEVELS,
  (ceil(maxUnlocked/CHAPTER_SIZE)+1)*CHAPTER_SIZE))`), so the DOM grows with
  progress, not to 9999 — inserting a full-width `.chapter-header` (icon, name,
  level range, plus a `done ✓` / `locked` state from `maxUnlockedLevel`) before
  the first level of each chapter (via `chapterForLevel(i)`, so procedural
  chapters render). Like other map/meta displays this gets **no tutorial step**.
- **Bonus objectives** (`levels.js` `objectiveForLevel`, `main.js`
  `_trackObjective`/`_markPowerupUsed`, `ui.js` `updateObjective`): every
  ordinary campaign level carries an **optional bonus objective** layered on top
  of the score target — `combo` (reach a ×N combo), `group` (pop a single group
  of N+), or `nopowerup` (clear without spending a power-up tool). It is
  **purely additive**: meeting it pays bonus coins on the win screen (a
  `🎯 Objective` `rewardBit`) but **never changes the win/star outcome** (ordinary
  campaign levels must still clear all bubbles; score target alone no longer
  completes a board with bubbles remaining). Objectives are deterministic per
  level (`objectiveForLevel(n)`, derived from the level number) and are skipped
  on levels 1–2 and on milestone (treasure/boss) beats, which already carry
  their own identity. `getLevel(id).objective` exposes `{ type, goal, bonus,
  label }`. The session tracks `objective`/`objectiveMet`/`usedPowerup` (all in
  the resume snapshot): combo/group latch as soon as reached during `popAt`
  (`_trackObjective`); `usedPowerup` is set whenever a tool is spent
  (`applyPowerup`/`lockMagnet`/shuffle via `_markPowerupUsed`) and `nopowerup`
  resolves at `_finish`. The HUD shows a **🎯 objective chip** (`#hud-objective`,
  hidden on boss/non-campaign, lit `.met` with a ✓ when achieved) and a brief
  intro toast at level start. Like other meta/challenge displays it gets **no
  tutorial step**.
- **Season Pass / Battle Pass** (`season.js`, pure; `storage.js` `season`;
  `monetization.js` `season_premium` product; `main.js`
  `_awardSeasonXp`/`claimSeasonTier`/`buySeasonPremium`; `ui.js`
  `buildSeason`/`refreshSeasonBadge`): a meta progression track of **10 tiers**,
  each `100` XP apart (`SEASON_XP_PER_TIER`). Clearing levels grants season XP
  (campaign `30 + stars*15`, endless `min(60, 10+floor(score/800))`, daily `40`;
  **tutorial play never counts**). Every unlocked tier offers a **free** reward
  (everyone) and a richer **premium** reward (only after buying the
  `season_premium` pass via the mock IAP). Rewards reuse the calendar shape
  (`{ coins | powerup | crate }`) and are **claimed explicitly + idempotently**;
  locked power-up rewards display/claim as coin fallbacks until their tool unlocks:
  `claimTier(state, i, track)` records the claim, `tierReward(i, track)` is what
  gets granted; `seasonStatus(state)` drives the XP bar (`progress`), tier label,
  and the **claimable count** badge on the menu Season tile (`#season-badge`).
  `season.js` is **pure** (no DOM/storage) — `tiersUnlocked`, `tierReward`,
  `canClaim`, `seasonStatus`, `addSeasonXp`, `claimTier`, `unlockPremium` all
  return new state without mutating input. It is **purely additive** (never
  affects win/star outcomes) and, like other meta displays, gets **no tutorial
  step**.

- **Daily & weekly quests** (`quests.js`, pure; `storage.js` `quests`; `main.js`
  `_recordQuestProgress`/`claimQuestReward`; `ui.js`
  `buildQuests`/`refreshQuestsBadge`): a rotating set of small goals that refresh
  **once per day** (3 daily quests from `DAILY_QUESTS`) and **once per week** (1
  weekly quest from `WEEKLY_QUESTS`). The active set is chosen by a **seeded
  Fisher–Yates** keyed on the day/week (`pickQuests` → `makeRng(hashSeed(...))`),
  so it is stable for the period and reproducible. Each quest watches a gameplay
  **metric** (`bubbles`/`levelsWon`/`fevers`/`combo`/`group`/`specials`) in one of
  two modes — `count` accumulates the metric, `max` tracks the best single value
  — capped at its `goal`. Gameplay emits deltas via `game._recordQuestProgress`:
  `popAt` reports `{ bubbles, combo, group, specials }` (special-bubble membership
  is captured **before** `_popCells` clears the cells), `_startFever` reports
  `{ fevers: 1 }`, and a campaign win reports `{ levelsWon: 1 }`. **Tutorial play
  never counts.** A complete quest is **claimable** and grants its reward
  (`{ coins | powerup | crate | seasonXp }`) **explicitly + idempotently** via
  `claimQuest(state, scope, index)`; locked power-up rewards are shown/paid as
  coins until usable, and `questsClaimable(state)` drives the claimable-count
  badge on the menu Quests tile (`#quests-badge`). `quests.js` is
  **pure** (no DOM/storage) — `ensureQuests`, `applyQuestProgress`, `claimQuest`,
  `questsClaimable` all return new state without mutating input. Like other meta
  features it never affects win/star outcomes and gets **no tutorial step**.

- **Stats / Profile dashboard** (`stats.js`, pure; `ui.js` `buildStats`): a
  **read-only** menu screen that surfaces the player's progress. Two sections —
  a **Profile** snapshot (level reached, coins, Endless/Time-Attack bests, pets
  collected, themes unlocked, daily streak + best streak) and **Lifetime Totals**
  (the eight achievement-progress counters: bubbles popped, best combo, biggest
  group, fevers, levels cleared, stars, bombs defused, coins earned). `stats.js`
  is **pure** — `lifetimeStats(save)`/`profileStats(save)`/`buildStats(save)` map a
  plain save object to display-ready rows (`{ key, icon, label, value }`) and
  `formatStat(n)` adds locale-independent thousands separators. It reuses data
  already tracked elsewhere (it never writes), so it adds no new save fields and,
  as a meta display, gets **no tutorial step**.- **Piggy Bank** (`piggy.js`, pure; `storage.js` `piggyBank`; `main.js`
  `_depositPiggy`/`crackPiggy`; `ui.js` `_buildPiggyItem`): a passive coin vault
  that fills a little every time a board ends. `piggyEarn(score)` banks
  `floor(score / PIGGY_RATE)` coins on **every** `_finish` (all modes, skipped
  during the tutorial), `piggyDeposit(balance, score)` adds them while clamping to
  `PIGGY_CAP`, `canCrackPiggy(balance)` gates cracking on a `PIGGY_MIN_CRACK`
  minimum, and `piggyFillPct(balance)` drives the shop progress bar. The vault is
  emptied into the wallet only by a one-time **purchase** (`piggy_crack`, via
  `Monetization.purchase`) — `crackPiggy()` grants the whole balance with
  `Economy.addCoins` and resets `piggyBank` to `0`. As a monetization/meta
  feature it never affects win/star outcomes and gets **no tutorial step**.
- **Puzzle Mode** (`puzzle.js`, pure; `storage.js` `puzzle.stars`; `main.js`
  `startPuzzle`/`_finishPuzzleStragglers`; `ui.js` `buildPuzzles`/`refreshPuzzleBadge`):
  a fixed ladder of hand-tuned "clear the whole board within N moves" boards.
  `PUZZLES` defines 12 configs (`cols`/`rows`/`colors`/`seed`/`moves`/`specials`),
  `getPuzzle(i)` clamps + shapes a level object (`mode === "puzzle"`),
  `puzzleStars(movesLeft, total)` rates 1–3 stars by the fraction of the budget
  left (`PUZZLE_STAR_RATIOS`), `isPuzzleUnlocked(i, starsMap)` gates each rung on
  ≥1 star of the previous, and `puzzlesSolved(starsMap)` counts cleared rungs.
  Puzzle shares campaign's move economy: `shiftTokens = 0` and **both** taps and
  swipes spend `movesLeft` (the `handleSwipe` guard and the two move-decrement
  lines all treat `puzzle` like `campaign`); `_isDeadlocked` likewise counts
  `movesLeft` as shift fuel for puzzle. Clearing the board wins; running out of
  moves first **loses**; a genuine jam with moves to spare (no pop, no productive
  shift) triggers `_finishPuzzleStragglers`, which bursts the un-poppable leftovers
  in a sweep and awards the clear — so every board is always completable.
  `_finish` records stars via `Storage.recordPuzzleResult`, pays
  `floor(score/200) + stars*25` coins (×coinMult) + season XP, and surfaces a
  "Puzzle Solved!" recap (`🔓 Puzzle N unlocked` on first solve, `🏆 New best!` on
  an improved star count). New module → added to `sw.js` ASSETS + cache bump.
  Gestures are already tutorialised, so Puzzle gets **no tutorial step** (a start
  toast states the goal).
- **Pet companions** (`pets.js`, pure; `storage.js` `pets`): collectible helper
  pets that support the player both **passively** and with **active board
  powers**. Pet systems are **progressively introduced** so new players are not
  hit with the full RPG layer on day one: fresh saves start with no owned pet,
  no equipped pet, and zero crates; clearing into Level 12 unlocks **Pets** and
  grants/equips Sparky, Level 14 unlocks **Crates & Pet Store** and grants the
  first crate, Level 16 enables **active abilities**, Level 18 unlocks the
  **party/support** slots, Level 22 unlocks **gems & sockets**, and Level 26
  unlocks the **pet technology tree**. Each unlock queues the same celebratory
  feature modal flow as tool unlocks. `PET_CATALOG` holds 22 pets across four rarities
  (`common`/`rare`/`epic`/`legendary`). **Passive pets** carry an `ability`
  (`scoreMult`/`coinMult`/`powerMult`/`feverMult`/`startCharge`) that scales per
  level (`petBuffs`/`abilityValue`). **Active pets** carry an `active` config and
  manipulate the board on a cooldown (`petActive`): **Rover 🐶** gathers the
  dominant colour into a blob (`grid.dominantColor`/`firstCellOfColor` →
  `magnetGather`), **Whiskers 🐱** zaps isolated single bubbles all at once
  (`grid.isolatedCells`), **Comet ☄️** blasts the longest same-colour **diagonal**
  streak off the board (`grid.diagonalRun` → `_petDiagonal`) — a line the
  orthogonal flood-fill behind tapping can never clear on its own — and
  **Talon 🦅** (a `pick`) hunts the **most isolated** bubbles (walled in by edges,
  gaps or other colours — `grid.mostIsolatedCells`) and **picks them off one by
  one** (`_petPick`): each bubble stays on the board until the hawk's beak
  actually reaches it, then it's destroyed in that beat's `onHit(i)` callback —
  so Talon never stabs at an empty cell. Gravity settles and the board is
  re-evaluated **once**, in the animation's `onDone`, which flips
  `session.petPicking` off and re-runs `afterMove`; while the flourish is live
  `afterMove` early-returns on `session.petPicking` (no premature win/deadlock
  check, no overlapping pet action). Because this `onDone` (like the last-bubble
  finale's) resolves on a **later frame**, `afterMove` guards `if (!s || s.ended)
  return` **first thing** and both `quitToMenu`/`_scheduleEnd` call
  `petAnim.clear()` + `finale.cancel()` — so a flourish still in flight when the
  player quits or the level ends can never re-enter `afterMove` on a null/next
  session. Its `count` scales 2→6 across the longer level curve. **Luma 🖌️**
  (`paint`, rare) recolours nearby awkward bubbles to match a tricky anchor,
  creating a new cluster for the player's next pop (`grid.paintArea` →
  `_petPaint`) without clearing anything directly. **Archer 🏹** (`archer`, epic)
  readies a **player-aimed skill shot** instead of resolving automatically:
  when its move cooldown fires, `main._startArcherAim` stores
  `session.archerAim`, pauses normal end-of-move checks, and prompts the player
  to drag an arrow from a chosen bubble. Drag start re-anchors the shot to the
  bubble under the finger; drag length feeds a compact power gauge with a green
  sweet band, drag angle sets the direction, and release resolves a deterministic
  grid ray (`grid.arrowRay`) that pierces a level-scaled number of filled cells
  (`main.fireArcherArrow`) through the normal pop/score/settle path. Four **elemental** active board pets round out the free roster:
  **Quake 🌍** (`quake`, rare) is a *match-maker* — a board-wide tremor that
  resettles every bubble so identical colours land together in big connected
  groups (`grid.quakeRegroup` → `_petQuake`; colours are conserved, it creates
  matches rather than clearing); **Cyclone 🌪️** (`cyclone`, epic) sorts each
  column by colour into tall vertical runs (`grid.cycloneSort` → `_petCyclone`,
  also non-destructive); **Magma 🌋** (`magma`, epic) erupts under the fullest
  lane(s) and clears whole **vertical columns** (`grid.fullestColumns`/
  `columnCells` → `_petMagma`; lanes cleared scale with level via the `active`
  `count`); and **Tidal 🌊** (`tidal`, legendary) floods away **every bubble of
  the dominant colour** in one wave (`grid.dominantColor`/`cellsOfColor` →
  `_petTidal`). One **premium**
  active pet, **Nova 🛸** (a `shooter`), is an autonomous alien **gunship** that
  patrols the base of the board in real time (`AlienShip` in `animations.js`),
  bounces off the walls and auto-blasts the lowest bubble in its column(s) via
  `grid.bottomBubble`/`bottomBlock` → game hooks `_shipHitColumn`/`_shipNuke`
  (which destroy through the normal pop/score path). Its firepower scales with
  pet level through pure `shooterStats(level)` milestone anchors, interpolated
  across Lv.1→12 — faster cannons → parallel fire → board-clearing **nukes**.
  The ship is deployed/retired by
  `_syncAlienShip` in `_enterSession`, ticked in `update(dt)` and drawn in
  `render`; it never flies in the tutorial and stops on level end/quit. The
  companion
  runs in `main.js` via
  `_equippedBuffs`/`_equippedActive` (folded into `popAt`/`chargedBlast`/
  `applyPowerup`/`_finish` scoring and the meters) and `_maybePetAction`/
  `_petGather`/`_petCleanse`/`_petDiagonal`/`_petPick`/`_petQuake`/`_petCyclone`/
  `_petMagma`/`_petTidal`/`_startArcherAim` (ticked from `afterMove` on
  `session.petTimer`).
  When an active pet fires, it plays an on-board **ability animation** (`PetAnim`
  in `animations.js`, ticked/drawn from the game loop via `game.petAnim`): the
  equipped pet's emoji flies in and performs its move — **Rover 🐶** dashes in
  and reels the colour together with a sparkle "leash" (`gather`), **Whiskers
  🐱** pounces and claw-slashes the lone bubbles (`cleanse`), **Comet ☄️**
  streaks in diagonally and fires a bright beam along the popped streak
  (`diagonal`), and **Talon 🦅** swoops down and pecks each isolated bubble in
  sequence (`pick`, destroying each bubble in its `onHit` as the beak lands and
  settling/re-evaluating in `onDone`). **Archer 🏹** draws a live arrow line,
  predicted hit rings, and green-band power gauge (`renderer.drawArcherAim`) while
  the player stretches the shot. The other pets' board change happens
  immediately when triggered (the animation is cosmetic); Talon's pick is the
  exception — it removes each bubble in step with the peck so nothing is pecked
  after it has already vanished.
  Pets gain XP each level clear (`_awardPetXp`, `PET_XP_PER_LEVEL`) and follow a
  long-form `MAX_PET_LEVEL = 12` curve (`xpForLevel`): early levels arrive
  quickly, while late levels require sustained play instead of maxing in a few
  clears. Passive and active scaling is normalized across that arc
  (`abilityValue`, `petActive`), and active `count` is rounded at the source so
  UI labels and board targeting stay integer. **Not pay-to-win**: pets are won from **crates**
  (`rollCrate`, seeded; `buyCrate` for `CRATE_COST` coins, treasure milestones
  drop a free crate, falling 🎁 gifts can drop a crate `GIFT_CRATE_CHANCE`,
  starter save grants Sparky + 1 crate); duplicates convert
  to XP (`DUP_XP`) **and Pet Dust** (`dustValue(rarity)`, `DUST_PER_DUP`) — the
  duplicate currency. Dust is **not** spent on pets (there is no pet-crafting);
  it is the sole currency for the **gem system** (crafting + embuing gems —
  see Gems & sockets below). Crate pulls also run a **pity timer** (`pets.js` `PITY_EPIC`=10/
  `PITY_LEGENDARY`=30, pure `pityRarityFloor`/`nextPity`; counters in
  `storage.js` `pets.pity {sinceEpic,sinceLegendary}`): a dry streak guarantees
  an epic by the 10th open and a legendary by the 30th. `openCrate`/
  `buyLegendaryCrate` read `Storage.getPity()`, pass the `{floor}` to `rollCrate`
  (which bumps a low roll up to the floor), then `Storage.setPity(nextPity(...))`.
  Dust + pity deep-merge into old saves (`Storage.getDust`/`addDust`/`spendDust`/
  `getPity`/`setPity`); the Pets crate panel shows the live dust balance
  (`#dust-count`). Meta
  acquisition economy — **no tutorial step**. Every pet also rolls a permanent
  **personality trait** the moment it joins the collection (`pets.js` `TRAITS`
  table — Balanced 🔘 / Swift ⚡ / Mighty 💪 / Lucky 🍀 / Keen 🎯 / Fiery 🔥;
  pure `rollTrait(rng)` / `getTrait(id)` with a Balanced fallback for old saves).
  A trait is a small flavourful modifier layered onto the pet's own ability:
  `cooldownDelta`/`countDelta`/`strengthMult` nudge an **active** pet's board
  move, while `scoreMult`/`coinMult`/`powerMult`/`feverMult` are passive buffs
  that apply to **any** pet — so even an active-only pet earns value from a Lucky
  trait. `petBuffs(petId, level, traitId)` applies the pet's ability first then
  stacks the trait mults; `petActive(petId, level, traitId)` clamps cooldown ≥1.
  The trait is stored per owned entry (`storage.js` `grantPet(id, trait)`,
  `getPetTrait(id)`; rolled via `main.js` `_rollPetTrait()` at every grant site
  and surfaced in `_equippedBuffs`/`_equippedActive`). The detail pane shows the
  owned pet's trait badge (`.pd-trait`) and the reveal modal appends it to the
  flavour line. **Party & set synergies** (`pets.js` `partyBuffs` /
  `activeSynergies` / `partyTotalBuffs`, `storage.js` `party.supports`): besides
  the single **lead** (equipped) pet you may roster up to `SUPPORT_SLOTS` (2)
  **support** pets. Supports don't take a board turn — only the lead's `active`
  move runs — but each lends a `SUPPORT_FRACTION` (0.35) slice of its passive
  buffs, aggregated multiplicatively in `partyBuffs(members)` (lead full,
  supports fractional; `startCharge` clamped ≤1). The full roster is then checked
  against the `SYNERGIES` table (Full Party 🎉 ≥3 members → +8% all; Legendary
  Might 👑 ≥2 legendaries → +12% score; Fortune Hunters 💰 ≥2 coin pets → +25%
  coins; Strike Team 🌐 ≥2 active pets → +15% power & fever) and any match is
  folded on by `applySynergies`; `partyTotalBuffs` is what `main.js`
  `_equippedBuffs` captures into `session.petBuffs`. Supports are managed in
  storage (`getPartySupports`, `toggleSupport(id)` — owned-only, non-lead,
  capped at 2; equipping a support pulls it out of the slots) and the Pets screen
  renders a party panel (`ui.js` `_buildPetParty`, `#pet-party` — lead + support
  slots + active synergy chips) plus an **Add to Party / In Party ✓ / Party Full**
  toggle in the detail pane (`#pet-support`, `cb.toggleSupport` → `main.js`
  `toggleSupport`, which live-refreshes `session.petBuffs` without a restart since
  supports add no board move). Party/synergies are meta progression — **no
  tutorial step**. The **premium** pets (Aurora 🌈 /
  Gizmo 🤖 are passive
  side-grades; **Nova 🛸** is the one premium *active* gunship — IAP `pet_*` via
  `monetization.purchase`). The strongest score booster (Draco, legendary) and
  all four free active board helpers stay free/earnable. Premiums are bought
  directly in the **Pet Store**, or — very rarely (`PREMIUM_DROP_CHANCE` ≈ 0.8%)
  — surprise you out of an ordinary crate (`rollCrate`'s premium roll, which
  draws from `cratePremiumPets`). **Nova is flagged `storeOnly`** so it is
  excluded from `cratePremiumPets` and can be obtained **only with real money**
  in the store (never a crate drop). The store also sells a real-money
  **Legendary Crate** (`LEGENDARY_CRATE`, `crate_legendary` IAP, boosted odds
  via `rollLegendaryCrate` → always legendary, often premium;
  `game.buyLegendaryCrate`). Cosmetic tints (`COSMETICS`, hue-rotate) are
  coin-bought. The
  **Pets screen** (`ui.js` `buildPets`, `#pets`, menu button) shows the crate
  panel with local layered `.crate-art` CSS (standard and legendary variants),
  the **Pet Store** (`_buildPetStore`, `#pet-store` — premium pets + Legendary
  Crate), the catalog grid (`.pet-card`, locked/owned/equipped), and a detail
  pane (XP bar, equip, premium buy, cosmetics). Pet cards and detail panes also
  explain acquisition clearly: normal pets say they come from their rarity's Pet
  Crates and can be crafted with Pet Dust, premium pets say they are premium and
  may rarely appear in crates, and Nova's store-only copy says it never drops
  from crates. A HUD badge (`#hud-pet`,
  `updatePetHud`) shows the equipped pet during play (hidden in the tutorial).
  Winning a **brand-new** companion (crate open, Legendary Crate, or premium
  store buy) fires a celebration modal (`#pet-reveal`, `ui.js`
  `showPetReveal(res)`): "🎉 New Companion!" (louder "LEGENDARY" headline for
  legendary/premium), a big animated pet emoji with a rarity-coloured glow + ray
  burst + WAAPI confetti, the pet name + rarity badge + its **ability label**
  (`pet.ability.label || pet.active.label`) + flavour `desc`, and an **Equip &
  Play** CTA (routes through `_requestEquip`, so a mid-level swap still confirms
  the restart) plus a dismiss button. **Duplicates skip the reveal** and just
  toast +XP — the fanfare is reserved for genuinely new pets. The reveal's
  animations live on non-clickable layers (confetti/glow/rays/icon) so the
  buttons stay click-stable for Playwright.
  **Pet manager overlay** (`ui.js` `openPetOverlay`/`closePetOverlay`): `#pets`
  is a **solid-background overlay** (not a routed `.screen`) reached two ways —
  the menu **Pets** tile, or by **tapping the in-game `#hud-pet` badge** (now a
  `<button>` with a ⇄ swap glyph). Opening it over a live level **pauses** the
  game (`main.js` `pauseForOverlay`/`resumeFromOverlay` toggle `Game.paused`,
  checked in `update(dt)`; input is disabled) so you can activate/buy/upgrade a
  companion without leaving the board; closing resumes play. **Switching the
  equipped pet mid-level restarts the level** (the new buffs apply to a fresh
  board), so the Equip button routes through a confirm modal (`#pet-confirm`,
  `_requestEquip`/`_confirmEquip`/`_cancelEquip`): **accept** →
  `equipPetAndRestart(id)` (equip + `retryLevel`) and close; **cancel** → keep
  playing. Equipping from the **menu** (no active level) equips immediately with
  no warning. `isLevelActive()` (non-null, non-ended, non-tutorial session)
  gates the warn-and-restart behaviour.
  Save state lives in `storage.js` `pets: { owned, equipped, crates }` with
  helpers (`getPetState`/`grantPet`/`addPetXp`/`equipPet`/`addCrates`/
  `consumeCrate`/`grantCosmetic`/`setCosmetic`); it deep-merges into old saves.
- **Gems & sockets** (`gems.js`, pure; `storage.js` `gems` + per-pet
  `owned[id].sockets`; `main.js` `craftGem`/`socketGem`/`unsocketGem`/
  `_grantRolledGem`/`_refreshPetSession`; `ui.js`
  `_buildSocketRow`/`_buildPetGems`): an RPG customization layer that lets the
  player **socket gems into pets** to tune their buffs. `GEM_CATALOG` holds 6
  gems (ruby🔴 score, citrine🟡 coins, sapphire🔵 charge, amber🟠 fever,
  emerald🟢 active-cooldown, diamond💎 a little of everything) across 3 quality
  `GEM_TIERS` (chipped→polished→brilliant, ×1/×2/×3). A gem is the compact key
  `"type:tier"` (`gemKey`/`parseGemKey`/`gemLabel`/`gemValue`). `gems.js` is
  **pure**: `socketsForLevel(level)` gates how many sockets a pet has unlocked
  (0 at L1, 1 at L2–3, 2 at L4+, capped at `MAX_SOCKETS`=2), and a parallel
  **tier ladder** gates how *strong* a gem a pet may wear — `maxGemTierForLevel`
  / `levelForGemTier` / `canSocketGemAtLevel` enforce `GEM_TIER_MIN_LEVEL`
  (chipped→Lv.2, polished→Lv.4, brilliant→Lv.5) so a fresh low-level pet can
  only socket weak gems and must grow before it can hold the strongest ones.
  `socketBuffs(keys)`
  aggregates the **passive** multipliers (diamond's `allMult` lifts all four
  axes; emerald contributes none here) and `socketActiveMods(keys)` aggregates
  the **active** mods (only emerald's `cooldownDelta` today). The fold happens in
  `pets.js` `petBuffs(petId, level, traitId, sockets)` /
  `petActive(petId, level, traitId, sockets)` (new optional 4th param, so
  `partyBuffs` naturally includes each member's `m.sockets`); active cooldown is
  clamped ≥1. Gems are **acquired** by crafting with Pet Dust
  (`gemDustCost(tier)` = 40/120/300, `Game.craftGem(type,tier)` →
  `Storage.spendDust` + `addGem`), from crate opens (~35% drop, biased higher
  for rarer pulls; the premium Legendary crate always includes one), and from
  **falling gift events** (`events.js` `GIFT_GEM_CHANCE`=0.12, a new
  `{type:"gem"}` reward). `rollGem(rng, {tierBias})` is seeded/deterministic.
  Storage owns the inventory + sockets (`getGems`/`gemCount`/`addGem`/
  `spendGem`/`getSockets`/`socketGem`(displaced gem returns to inventory)/
  `unsocketGem`); the new top-level `gems:{}` field and per-pet `sockets:[]`
  deep-merge into old saves. **Embuing (socketing) costs Pet Dust** —
  `socketDustCost(tier)` = 20/60/150 (cheaper than crafting); `Game.socketGem`
  rejects when the player can't afford it and `spendDust`s on success. **Removing
  a gem shatters it**: `Storage.unsocketGem` destroys the gem (it does NOT return
  to the bag) and `Game.unsocketGem` returns `{key, dust}`, refunding
  `unsocketDustRefund(tier)` = `floor(socketDustCost*0.4)` = 8/24/60 (always less
  than was paid). `socketGem`/`unsocketGem` live-refresh the running
  session's buffs/active stats (`_refreshPetSession`) so a socket swap applies
  without a restart. Gem crafting/fusing/browsing lives in a **dedicated Gem
  Forge destination** (`#gem-forge` overlay, `ui.js`
  `openGemForge`/`closeGemForge`/`_renderGemManager`) — a separate screen layered
  over the Pets overlay, mirroring how mobile RPGs keep the crafting bench apart
  from the contextual inventory/equip flow (Genshin's synthesis bench, Diablo
  Immortal's jeweler). The Pets screen itself only shows a **compact launcher
  card** (`#gem-launch`, `_buildPetGems` normal mode) reading
  `💎 Gem Forge · N gems · ✨ dust · craft, fuse & manage` that opens it; this
  keeps gems from crowding the pet roster. Inside the Gem Forge body
  (`#gemforge-body`) is the **tabbed manager** (`_renderGemManager` →
  `_buildGemBag`/`_buildGemForge`) built to a **market-standard inventory
  pattern** so it never becomes the old wall of 18 big labelled cards: the
  **🎒 Bag** tab (`.pg-tabs`/`.pg-tab[data-tab]`) shows a
  **dense 5-column grid of small gem icons** (`.pg-grid2` › `.pg-cell
  [data-gem="type:tier"]`, each a tier-colour-bordered square with a count badge
  (`.pg-cell-count`), the gem icon and **tier stars** ★/★★/★★★
  (`.pg-cell-stars`)). Tapping a cell **selects** it (`.pg-cell.sel`, persisted in
  `this._gemSel`, auto-defaulting to the strongest owned gem) and a single
  **detail/action panel** below (`.pg-sel`) shows that gem's big icon, name +
  stars, its concrete `gemBuffLabel`, the embue hint, count, and a **fusion
  action row** (`.pg-fuse-row`): fusible gems get a `.pg-fuse-btn[data-gem=...]`
  reading `⬆ Fuse 3` + the ladder (`3× <tier> → 1 <next>`, disabled below 3 with
  a `.pg-fuse-note`), top-tier gems show `.pg-fuse-top`. A successful fuse follows
  the upgraded gem (`_gemSel = res.to`) and rebuilds in place
  (`_renderGemManager`).
  The **⚒️ Forge** tab shows a 6-icon **type selector** (`.pg-forge-type`)
  whose selection (`_gemForgeType`, defaults to the first type) reveals that
  gem's description, a short forging **hint** (`.pg-forge-hint`), and its three
  tiers laid out as a **left-to-right ladder** (`.pg-cc-ladder`): chipped → ★
  polished → ★★ brilliant → ★★★, with `.pg-ladder-arrow` `→` separators so the
  upgrade path reads at a glance. Each ladder node is a one-tap **smart forge
  button** (`.pg-craft-btn[data-gem][data-tier]`) that makes one gem of that tier
  via the cheapest source: it **prefers to FUSE** `FUSE_COUNT` (3) of the tier
  directly below when the player owns them (free, `via:"fuse"`, the button shows
  a green `⬆ 3 <tier>` label + `.can-fuse` highlight), and otherwise **falls back
  to spending Dust** (`via:"dust"`, `✨cost` label) — so clicking *Brilliant*
  consumes 3 *Polished* when available, else dust. Driven by
  `Game.forgeTier(type, tier)` (`gems.js prevGemTier` resolves the tier below);
  the button is disabled only when **neither** fusion nor dust is affordable.
  Tap again to make more. The three tiers are drawn with **distinct CSS gem
  visuals** (`_gemVis(type, tier)` → `.gemv[data-tier]`, also used in the Bag
  grid/detail) so they read clearly differently — a small matte **chip**
  (chipped), a glossy rounded **gem** (polished), and a faceted sparkling
  **diamond** (brilliant) — rather than the same emoji with stars. The Pets
  screen also shows a compact `#pet-gem-tip` guidance strip so the socket flow is
  visible before the player opens a pet detail. The pet detail renders a
  clickable socket row;
  each gem advertises its concrete effect via `gemBuffLabel(key)`
  (e.g. `+12% Score`, `+6% all stats`, `-3 move ability cooldown`), shown both on
  the picker's selection detail (`.pg-pd-buff`) and as a buff caption under filled
  slots (`.pd-socket-buffs`). **Socketing stays contextual on the Pets screen**:
  tapping an empty slot opens the gem **picker** (rendered into `#pet-gems` in
  picker mode, `_gemPicker = {petId, slot}` / `_gemPickSel`). Because the
  `#pet-gems` host sits **above** the pet detail in the DOM, the picker promotes it
  to a centered overlay (`.pet-gems.pg-picking`) so it can't render off-screen. The
  picker is a **select→confirm** flow built for clarity: a **dense 4-column grid**
  of small selectable cells (`.pg-pick-cell[data-gem]`) using the distinct
  `_gemVis` tier visuals (matte chip / glossy gem / faceted diamond) + tier pips
  (◆/◆◆/◆◆◆) + a count badge, **sorted strongest-first** (tier desc, then buff
  magnitude) with a **★ BEST** badge (`.pg-pc-best`) on the strongest gem the pet
  can actually socket. Tapping a cell **selects** it (`.pg-pick-cell.sel`,
  highlighted, persisted in `_gemPickSel`); the selection defaults to that BEST
  gem so one tap on **Embue** equips it. A fixed **detail panel**
  (`.pg-pick-detail`) below the scrolling grid shows the selected gem's big visual,
  name + tier pips, exact buff (`.pg-pd-buff`), and a **power bar** (`.pg-pd-fill`,
  tier/3 width, gem-coloured) with the tier label (`.pg-pd-tier`); a prominent
  **Embue** button (`#gem-picker-embue`) confirms the embue showing the dust cost.
  Gems above the pet's unlocked tier appear **locked** (`.locked`, 🔒 + required
  level, excluded from BEST/default selection), and gems the player can't afford
  show the Embue button disabled with the shortfall. A successful embue plays a
  celebratory `_playSocketMagic()`
  flourish — one of **5 random variants** (`.socket-magic[data-variant]`, ring +
  glyph + sparks, recorded as `_lastSocketMagic`, skipped under reduced motion).
  Tapping a **filled** slot opens the `#gem-remove` warning modal
  (`_requestUnsocket`/`_confirmUnsocket`) that explains the gem will be shattered
  for a partial dust refund before it's destroyed. **Gem fusion**
  (`gems.js` `FUSE_COUNT`/`nextGemTier`/`canFuseTier`/`fusedGemKey`, `storage.js`
  `fuseGems`, `main.js` `fuseGem`, `ui.js` gem inventory `.pg-fuse-btn`): a
  dust-free way to upgrade a pile of weak duplicates — combining `FUSE_COUNT`
  (**3**) identical gems of one tier yields **1 gem of the next tier up** (3
  chipped ruby → 1 polished ruby; 3 polished → 1 brilliant; brilliant is the top
  tier and **cannot** fuse further). The pure helpers resolve the ladder
  (`nextGemTier(tier)` → next tier id or `null` at the top; `fusedGemKey(key)` →
  the produced "type:tier" key or `null`); `Storage.fuseGems(key, upKey, count)`
  is atomic (only proceeds with ≥`count` in the bag, spends `count`, adds one
  `upKey`); `Game.fuseGem(key)` validates and returns `{ ok, from, to }` or
  `{ ok:false, reason }` (`"top"` at the top tier, `"count"` below the
  threshold). On the **🎒 Bag** tab the selected gem's detail panel renders the
  **⬆ Fuse 3** button (`.pg-fuse-btn[data-gem="type:tier"]`, disabled below 3 in
  the bag); clicking it merges and rebuilds the panel in place (the tab/selection
  state survives the rebuild). Meta/RPG customization
  — **no tutorial step** (consistent with traits, party & synergies). (Exposed for
  tests via `__bpc.gems`.)
- **Pet technology tree** (`tech.js`, pure; `storage.js` per-pet `owned[id].tech`;
  `main.js` `pickPetTech`/`petHasPendingTech`; `ui.js`
  `_buildPetTech`/`refreshPetsBadge`): an RPG **ability tree** that lets the
  player permanently customize a pet by spending the **level-up picks** it earns
  as it grows (purely XP-driven — no currency, no IAP, deliberately **not**
  pay-to-win). `TECH_TREE` is `MAX_TECH_TIERS` (**10**) tiers, each unlocked at a
  milestone level (`minLevel` 2/3/4/5/6/7/8/9/10/12) and offering a **choice of
  two nodes** that is a genuine trade-off, not a strict upgrade. Early tiers keep
  the score/coins/charge/fever/cooldown choices; later tiers add specialization
  nodes like Combo Instinct, Treasure Sense, Wide Arc, Overcharge, Patron,
  Reflex Loop, Force Bloom, Ascendant, and Legend Bond. Each node's `mods` fold into the pet exactly like
  traits/gems: `techBuffs(chosen)` aggregates the **passive** axes (`scoreMult`/
  `coinMult`/`powerMult`/`feverMult` as `1+sum`, `startCharge` additive) and
  `techActiveMods(chosen)` the **active** mods (`cooldownDelta`/`countDelta` summed,
  `strengthMult` multiplied), both consumed by `pets.js`
  `petBuffs(petId, level, traitId, sockets, tech)` /
  `petActive(..., tech)` (new optional 5th param → neutral when undefined, so it's
  backward compatible; `partyBuffs` passes each member's `m.tech`). `tech.js` is
  **pure** (imports nothing from pets — pets imports tech one-way): `techTiersUnlocked(level)`
  counts unlocked tiers, `pendingTechTier(chosen, level)` is the first unlocked
  tier with no chosen node (`-1` when none pending), `canPickTech(chosen, nodeId,
  level)` enforces that a pick is in the currently-pending tier (no skipping
  ahead, no re-picking a tier). State lives per-pet in `storage.js`
  `owned[id].tech` (an array of node ids; seeded `[]` on `grantPet` and on starter
  Sparky, deep-merge safe) via `getPetTech`/`addPetTech`. `Game.pickPetTech(petId,
  nodeId)` validates with the pet's level, records the pick, and live-refreshes
  the running session (`_refreshPetSession`) so the buff applies without a
  restart; `petHasPendingTech(id)` drives badges. A level-up that unlocks a new
  tier appends "— pick an upgrade in Pets!" to the `_awardPetXp` toast. The
  **Pets screen** renders the tree in the pet detail (`_buildPetTech`, `#pet-detail
  .pd-tech`): chosen nodes show locked-in with a ✓, the pending tier's two
  options are clickable, and locked future tiers show "reach Lv.X". A menu Pets
  tile badge (`#pets-badge`, `refreshPetsBadge`) and a per-card `🧬` badge
  (`.pet-techbadge`) flag pets with a pick ready. Meta/RPG progression —
  **no tutorial step** (consistent with traits, party, synergies & gems).
  (Exposed for tests via `__bpc.tech`.)
- **Interactive tutorial** (`tutorial.js`): a gated, step‑by‑step onboarding that
  auto‑opens on first run (and re‑playable via the menu's **How to Play**
  button). Each action step **blocks until the player actually performs the
  gesture** (tap, combo, preview, swipe, charged blast, power‑up, magnet, and
  tapping a falling gift/problem `event`). The practice board **auto-refills**
  when popped low or out of moves (`_refillTutorialBoard`, called from
  `afterMove` in tutorial mode) so the player never runs out of bubbles. The
  **pets** step explains how companions are acquired (crates, gifts,
  milestones, the Pet Store). On entry the tutorial **loads a generous practice
  inventory** (≥10 of every power-up plus all catalog pets) so the player can
  freely experiment; the real inventory (power-ups, loadout, pets) is
  snapshotted into `tutorialBackup` (persisted, so a mid-tutorial reload still
  recovers it via `_restoreTutorialInventory` on `init`) and restored verbatim
  on finish/skip — the tutorial **never overwrites what the player owns** and
  larger real stashes are never reduced (see `_stockTutorialInventory` /
  `_restoreTutorialInventory`, `TUTORIAL_TOOL_STOCK`). It must stay in sync with
  the game's features — see §11.
- **Live production URL**: https://amantaras.github.io/bubble-pop-chain/
  (GitHub Pages, served under the `/bubble-pop-chain/` subpath).
- **Repo**: `amantaras/bubble-pop-chain`, default branch `master` (private).

## 2. Project structure

```
index.html          # markup: menu, level map, shop, themes, HUD, modals
styles.css          # all styling (neon-on-dark theme)
manifest.json       # PWA manifest (RELATIVE paths — see §7)
sw.js               # service worker, NETWORK-FIRST strategy
capacitor.config.json # Capacitor native wrapper config (Android/iOS use dist/web)
scripts/
  copy-web.mjs      # copies the static web app into dist/web for Pages + native sync
icons/              # icon.svg, maskable.svg (procedural SVG)
src/
  main.js           # Game orchestrator: canvas loop, state machine, sessions
  grid.js           # Board model: flood-fill, gravity, collapse, serialize/restore
  renderer.js       # Canvas drawing
  particles.js      # Particle FX (capped pool — see Performance below)
  animations.js     # ScreenShake, FloatingText
  input.js          # Pointer input + vibrate() (guarded for iOS)
  audio.js          # WebAudio (unlocked on first pointerdown); pop/powerup/fever/blast/click/win/lose/coin SFX + per-theme music
  storage.js        # Storage singleton over localStorage (bpc_save_v1)
  themes.js         # Theme catalog + unlock logic + applyThemeCss
  levels.js         # LEVEL_COUNT=9999 (endless), getLevel(id) generative + DIFFICULTY_CAP, world/proc chapters
  scoring.js        # groupScore, comboMultiplier, clearBonus, starsForScore
  rng.js            # mulberry32 seeded RNG, todayKey
  economy.js        # Coins + power-up inventory/prices
  daily.js          # Daily challenge + streak logic
  calendar.js       # Login calendar / daily gifts (pure: 7-day reward cycle)
  season.js         # Season Pass / Battle Pass (pure: 10-tier free+premium track)
  quests.js         # Daily & weekly quests (pure: rotating goals + claimable rewards)
  stats.js          # Stats / Profile dashboard (pure: read-only progress aggregation)
  piggy.js          # Piggy Bank (pure: passive coin vault + crack-open purchase)
  puzzle.js         # Puzzle Mode ladder (pure: clear-the-board-in-N-moves + star ratings)
  events.js         # Falling gift/problem events (pure: delay/type/reward rolls)
  pets.js           # Pet companions (pure: catalog, buffs, active actions, crate rolls)
  gems.js           # Gems & sockets (pure: gem catalog, tiers, socket buffs, gem rolls)
  monetization.js   # F2P abstraction (ads/IAP) — MOCK provider, pluggable  tutorial.js       # Gated step-by-step onboarding: TUTORIAL_STEPS + Tutorial class  ui.js             # All DOM UI: screens, level map, shop, themes, HUD, modals
tests/
  unit/*.test.js    # Vitest unit tests (real modules, jsdom)
  e2e/game.spec.js  # Playwright E2E (real browser, real input)
  server.mjs        # zero-dep static server (port arg, default 4173)
  setup.js          # deterministic in-memory localStorage for unit tests
  SKILL.md          # testing + CI/CD reference doc
.github/workflows/
  ci.yml            # unit + e2e on every push/PR
  deploy.yml        # after CI success on master, builds Android+iOS artifacts, then deploys dist/web to Pages
  mobile.yml        # manual/PR native Android APK + unsigned iOS build validation
android/            # Capacitor Android project (run npm run native:sync before building)
ios/                # Capacitor iOS project (requires Xcode for local/device/App Store builds)
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
7. **Release automation is part of the task**: commit, push to `master`, then
  **verify CI and the deploy both pass** (see §6). Do not stop after local
  tests when the user asked for implementation unless they explicitly say not
  to push/deploy. Production is gated on CI — never bypass it.

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
  npm run build:web        # generate dist/web from the static app
  npm run native:sync      # sync dist/web into Android/iOS Capacitor projects
  npm run android:sync     # sync only Android; does not require Xcode
  npm run ios:sync         # sync only iOS; requires full Xcode + CocoaPods
  npm run android:build    # local debug APK
  npm run android:apk:release # signed release APK; requires Android signing env vars
  npm run android:bundle   # release AAB; signing configured in Android Studio/Play Console
  npm run ios:build        # unsigned iOS build; requires full Xcode install
  ```
- **Determinism**: levels/daily use seeded RNG (`rng.js`). Assert on seeds and
  derived values, not random outcomes. Unit tests get a clean in-memory
  `localStorage` via `tests/setup.js` (reset before each test).
- **Current baseline (keep growing, never shrink)**: 617 unit tests + 500 E2E
  tests, all passing. New features must add tests, not remove coverage.

## 5. CI/CD — production is gated on tests

- `.github/workflows/ci.yml`: runs `unit` (Vitest) and `e2e` (Playwright on
  Chromium) on every push and PR; uploads the Playwright HTML report.
- `.github/workflows/deploy.yml`: triggered by `workflow_run` on **completion of
  CI for `master`** and only proceeds when `conclusion == 'success'`. It always
  builds and uploads a signed Android release APK and an unsigned iOS app bundle
  first, then runs `npm run build:web`, adds the APK to
  `dist/web/downloads/bubblit.apk`, and publishes `dist/web` to GitHub Pages.
  The Android sideload URL is stable:
  `https://amantaras.github.io/bubble-pop-chain/downloads/bubblit.apk`.
  **A red test suite or failed mobile build means no production deploy — keep it
  that way.** The deploy workflow self-enables Pages; do not remove that step.
- `.github/workflows/mobile.yml`: native target validation, run manually or on
  PRs that touch mobile files. Android builds a debug APK artifact; iOS performs
  an unsigned Xcode build on macOS. Store signing/distribution still happens in
  Android Studio / Play Console and Xcode / App Store Connect.
- `.github/workflows/store-release.yml`: manual signed store packaging. It builds
  a signed Android AAB and a signed iOS IPA when the required GitHub Secrets are
  configured, optionally submitting Android to the Play internal track and iOS to
  TestFlight. Store-account setup, compliance metadata, and real monetization SDK
  behavior are tracked in `docs/store-release.md`.
- Node 20 in current workflows. (GitHub deprecation warning about Node 20
  actions is non-blocking; bump action versions only when asked.)

## 6. How to verify a deploy (always do this after pushing to master)

```bash
gh run list --limit 6                       # see CI + Deploy status
gh run watch <ci_run_id> --exit-status      # wait for CI first
gh run list --limit 6                       # find the Deploy run triggered by CI
gh run watch <deploy_run_id> --exit-status  # wait for the deploy to finish
curl -s -o /dev/null -w "%{http_code}\n" https://amantaras.github.io/bubble-pop-chain/
```
The CI run and deploy run must both end in **success**, and the live URL must
return 200. If CI is red, the deploy is correctly skipped — fix CI first.

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
- **Native targets**: Capacitor wraps the same static app for Android/iOS.
  Always run `npm run native:sync` after changing web files and before opening
  native IDEs or producing store builds. The generated web bundle lives in
  `dist/web` and is intentionally ignored; the native platform directories are
  committed project targets. Use `android:sync` when validating Android on a
  machine without Xcode; iOS sync/build requires full Xcode selected with
  `xcode-select`, not only Command Line Tools.
- **Native local prerequisites**: Android builds require JDK 21 plus Android SDK
  platform 35 with `ANDROID_HOME`/`ANDROID_SDK_ROOT` set. iOS builds require full
  Xcode, CocoaPods, and an Apple Developer signing team for devices/TestFlight.

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
- **Boss 👹** (`bossReward` + `bossConfig`): bosses rotate through **three
  archetypes** by boss number (`BOSS_ARCHETYPES = ["frozen","stone","color"]`,
  `kind = BOSS_ARCHETYPES[(idx-1) % 3]` → lvl10 frozen, lvl20 stone, lvl30 color,
  lvl40 frozen). Each `bossConfig` shape carries `kind`, `label`, `hudLabel`,
  `extraMoves`:
  - **frozen** 🧊 — seeds a centred **frozen core** of ice bubbles
    (`Board.placeFrozenCore`, sizing `coreW`/`coreH`); clear it via two-hit pops.
  - **stone** 🪨 — seeds a centred 2-row **stone vault** (`Board.placeStoneVault`,
    `vaultW`/`vaultH`); the 2-row height keeps every stone reachable by an
    adjacent pop (stones only break when a neighbour is popped).
  - **color** 🎨 — picks `Board.dominantColor()` at session start and the player
    must **purge every bubble of that colour** from the board; the renderer tags
    each target bubble with a pip (`drawBubbles(..., markColor)`).
  The remaining-count for any archetype comes from `main.js`
  `_bossObjectiveRemaining()` (`stoneRemaining()` / `colorCells(target).length` /
  `frozenRemaining()`); the win fires when it hits 0 before moves run out. Boss
  levels suppress random ice **and** stone and get extra moves (`getLevel`).
  First defeat pays a coin jackpot (`250 + idx*75`) and unlocks the next cosmetic
  theme. Bosses have **no tutorial step** (the start toast explains the goal).
- **Wiring**: `getLevel` tags `level.milestone` / `level.boss`; `main.js`
  `_newSession` dispatches on `cfg.kind` to place the objective and tracks
  `bossCoreTotal` / `bossKind` / `bossTargetColor` (all persisted in the session
  snapshot); the boss objective is evaluated in `afterMove` via
  `_bossObjectiveRemaining()`, and the one-time rewards are paid in `_finish`. The
  level map (`ui.js buildLevelMap`) and the boss HUD (`hudLabel`:
  `Core`/`Stone`/`Left`) surface the beats; the recap window shows the reward
  lines via `win-reward`.

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
- [ ] CI passed, the production deploy succeeded, and the live URL returns 200.

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
     `blast`, `powerup`, `magnet`, `event`, `lightning`, `stone`, `bombbubble`,
     `multiplier`, `coinbubble`, `vine`.
     `hint` is the nudge
     text shown while
     waiting. (The `fever` step is informational — `advance: "button"` — with a
     `grant: "fever"` that fires Fever as a live demo.)
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
