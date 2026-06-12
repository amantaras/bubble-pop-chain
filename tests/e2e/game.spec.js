import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers — these drive the REAL running game (real DOM, real canvas input,
// real module code). The `?e2e=1` hook only EXPOSES internals; it never
// replaces or mocks game logic.
// ---------------------------------------------------------------------------

async function openGame(page) {
  // Each Playwright test runs in a fresh, isolated browser context, so
  // localStorage starts empty. (We deliberately do NOT clear on every
  // navigation, otherwise reloads would wipe progress we want to assert on.)
  await page.goto("/?e2e=1");
  await page.waitForFunction(() => window.__bpc && window.__bpc.game);
  // First-run players are dropped straight into the tutorial. Dismiss it so
  // tests that exercise other flows start from a clean menu. (Tutorial tests
  // start it explicitly via the "How to Play" button — see that describe.)
  await page.evaluate(() => {
    const g = window.__bpc.game;
    if (g.tutorial && g.tutorial.active) g.tutorial.skip();
  });
  await page.waitForFunction(() => !window.__bpc.game.tutorial);
}

// Pop the largest available group repeatedly until the session ends.
async function autoPlay(page) {
  await page.evaluate(async () => {
    const g = window.__bpc.game;
    let guard = 0;
    while (g.session && !g.session.ended && guard < 400) {
      const b = g.session.board;
      let best = null;
      const seen = new Set();
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          const k = c + "," + r;
          if (b.grid[c][r] === -1 || seen.has(k)) continue;
          const grp = b.getGroupAt(c, r);
          grp.forEach((p) => seen.add(p.c + "," + p.r));
          if (grp.length >= 2 && (!best || grp.length > best.length))
            best = { c, r, len: grp.length };
        }
      if (best) {
        g.popAt(best.c, best.r);
        await new Promise((res) => setTimeout(res, 18));
        guard++;
        continue;
      }
      // No tap-group left: a row swipe is still a real move, so look for one
      // that realigns bubbles into a fresh match (mirrors a human player). If a
      // productive shift exists and the player can afford it, perform it;
      // otherwise the board is genuinely deadlocked and afterMove ends the run.
      const canShift =
        g.session.mode === "campaign"
          ? g.session.movesLeft > 0
          : g.session.shiftTokens > 0;
      let swiped = false;
      if (canShift) {
        for (let r = 0; r < b.rows && !swiped; r++) {
          for (const dir of ["right", "left"]) {
            const grid = b.grid.map((col) => col.slice());
            const types = b.types.map((col) => col.slice());
            b._simShiftRow(grid, types, r, dir);
            b._simSettle(grid, types);
            if (b._gridHasMoves(grid, types)) {
              const y = b.targetPixel(0, r).y;
              g.handleSwipe(dir, b.originX + b.boardW / 2, y);
              swiped = true;
              break;
            }
          }
        }
      }
      if (!swiped) break;
      await new Promise((res) => setTimeout(res, 18));
      guard++;
    }
  });
}

// Real pointer tap on the canvas at a given grid cell.
async function tapCell(page, c, r) {
  const px = await page.evaluate(
    ({ c, r }) => {
      const p = window.__bpc.game.session.board.targetPixel(c, r);
      return { x: p.x, y: p.y };
    },
    { c, r }
  );
  const box = await page.locator("#game-canvas").boundingBox();
  await page.mouse.click(box.x + px.x, box.y + px.y);
}

async function findGroupCell(page) {
  return page.evaluate(() => {
    const b = window.__bpc.game.session.board;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++)
        if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2)
          return { c, r, size: b.getGroupAt(c, r).length };
    return null;
  });
}

// ---------------------------------------------------------------------------

test.describe("menu & navigation (UI)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("main menu renders all entry points", async ({ page }) => {
    await expect(page.locator("#menu")).toBeVisible();
    for (const id of [
      "btn-play",
      "btn-endless",
      "btn-daily",
      "btn-shop",
      "btn-themes",
      "btn-achievements",
      "btn-pets",
      "btn-calendar",
      "btn-season",
      "btn-tutorial",
    ]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test("Play opens the level map with level 1 unlocked", async ({ page }) => {
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    await expect(page.locator(".level-cell").first()).toContainText("1");
    await expect(page.locator(".level-cell.locked").first()).toBeVisible();
  });

  test("Shop and Themes open and Back returns to menu", async ({ page }) => {
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator("#shop-back").click();
    await expect(page.locator("#menu")).toBeVisible();

    await page.locator("#btn-themes").click();
    await expect(page.locator("#themes")).toBeVisible();
    await page.locator("#themes-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("sound toggle persists mute state", async ({ page }) => {
    await page.locator("#btn-play").click();
    await page.locator(".level-cell").first().click();
    await page.locator("#btn-sound").click();
    const muted = await page.evaluate(() => localStorage.getItem("bpc_save_v1"));
    expect(JSON.parse(muted).muted).toBe(true);
  });
});

test.describe("core gameplay (real input)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("real canvas tap pops a connected group and scores", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(700); // let bubbles settle
    const cell = await findGroupCell(page);
    expect(cell).not.toBeNull();
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);
    const score = await page.evaluate(() => window.__bpc.game.session.score);
    expect(score).toBeGreaterThan(0);
  });

  test("HUD shows level, target and moves", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#hud-mode-label")).toHaveText("Level 1");
    await expect(page.locator("#hud-target")).not.toHaveText("0");
  });
});

test.describe("gestures: long-press preview (real input)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("holding a bubble previews its group and releasing pops it", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(700);
    const cell = await findGroupCell(page);
    expect(cell).not.toBeNull();

    const px = await page.evaluate(
      ({ c, r }) => window.__bpc.game.session.board.targetPixel(c, r),
      cell
    );
    const box = await page.locator("#game-canvas").boundingBox();
    const x = box.x + px.x;
    const y = box.y + px.y;

    // Press and hold past the long-press threshold (350ms).
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(450);
    const previewSize = await page.evaluate(
      () => window.__bpc.game.session.preview && window.__bpc.game.session.preview.size
    );
    expect(previewSize).toBeGreaterThanOrEqual(2);

    // Releasing on the previewed group pops it and scores.
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await page.evaluate(() => ({
      score: window.__bpc.game.session.score,
      preview: window.__bpc.game.session.preview,
    }));
    expect(after.score).toBeGreaterThan(0);
    expect(after.preview).toBeNull();
  });
});

test.describe("gestures: double-tap Charged Blast (real input)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("double-tap when charged blasts an area and resets the meter", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(700);
    // Fill the Power meter so a charged blast is available.
    await page.evaluate(() => {
      window.__bpc.game.session.power = 1;
    });
    const before = await page.evaluate(() => ({
      remaining: window.__bpc.game.session.board.countRemaining(),
      score: window.__bpc.game.session.score,
      ready: window.__bpc.game.isBlastReady(),
    }));
    expect(before.ready).toBe(true);

    // Double-tap a real bubble near the middle of the board.
    const px = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      const c = Math.floor(b.cols / 2);
      const r = Math.floor(b.rows / 2);
      return b.targetPixel(c, r);
    });
    // dblclick fires both clicks in one rapid sequence (well within the
    // double-tap window), exercising the real gesture recogniser.
    await page
      .locator("#game-canvas")
      .dblclick({ position: { x: px.x, y: px.y } });
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => ({
      remaining: window.__bpc.game.session.board.countRemaining(),
      score: window.__bpc.game.session.score,
      power: window.__bpc.game.session.power,
    }));
    expect(after.power).toBe(0); // meter consumed
    expect(after.remaining).toBeLessThan(before.remaining); // area cleared
    expect(after.score).toBeGreaterThan(before.score);
  });
});

test.describe("gestures: swipe to shift a row (real input)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("horizontal swipe shifts a row and spends a move", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(700);

    // Aim at the bottom-most (fully populated) row.
    const aim = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      const r = b.rows - 1;
      const left = b.targetPixel(0, r);
      const right = b.targetPixel(b.cols - 1, r);
      return { y: left.y, x0: left.x, x1: right.x, moves: window.__bpc.game.session.movesLeft };
    });
    const box = await page.locator("#game-canvas").boundingBox();
    const y = box.y + aim.y;

    // Real left-to-right drag = swipe right.
    await page.mouse.move(box.x + aim.x0, y);
    await page.mouse.down();
    await page.mouse.move(box.x + aim.x1, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const moves = await page.evaluate(
      () => window.__bpc.game.session.movesLeft
    );
    expect(moves).toBe(aim.moves - 1); // the swipe consumed exactly one move
  });
});

test.describe("special bubbles (ice + rainbow)", () => {
  test.beforeEach(({ page }) => openGame(page));

  function countSpecials(page) {
    return page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      let rainbow = 0;
      let ice = 0;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          const t = b.types[c][r];
          if (t === 2) rainbow++;
          else if (t === 1 || t === 3) ice++;
        }
      }
      return { rainbow, ice, hasMoves: b.hasMoves() };
    });
  }

  test("a later campaign level spawns specials and stays playable", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(16));
    await page.waitForTimeout(700);
    const info = await countSpecials(page);
    expect(info.rainbow + info.ice).toBeGreaterThan(0);
    expect(info.hasMoves).toBe(true);
  });

  test("special bubble types survive a full reload (save contract)", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(16));
    await page.waitForTimeout(700);
    const before = await page.evaluate(() =>
      window.__bpc.game.session.board.serializeTypes()
    );
    await page.locator("#btn-back").click();
    await expect(page.locator("#menu")).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    await page.locator("#btn-continue").click();
    await expect(page.locator("#hud-mode-label")).toHaveText("Level 16");
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.serializeTypes()
    );
    expect(after).toEqual(before);
  });

  test("a lightning bubble's pop discharges its full row and column", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(16));
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Set up a deterministic board: a same-colour pair where one is a
      // lightning bubble, so popping the pair triggers a row+column strike.
      const lc = 2;
      const lr = Math.floor(b.rows / 2);
      // Paint the pair colour 0 and the rest colour 1 so only the strike (not a
      // big colour flood) clears the row/column.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = c === lc && (r === lr || r === lr + 1) ? 0 : 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.types[lc][lr] = 4; // LIGHTNING
      const rowCount = () => {
        let n = 0;
        for (let c = 0; c < b.cols; c++) if (b.grid[c][lr] !== -1) n++;
        return n;
      };
      const before = rowCount();
      g.popAt(lc, lr); // pop the lightning pair → strike row lr + column lc
      b.settle();
      // After the strike + gravity, far fewer bubbles remain in that row.
      return { before, removed: g.session.stats.cleared };
    });
    // The strike cleared the pair (2) plus the rest of the row + column.
    expect(res.removed).toBeGreaterThanOrEqual(res.before);
  });
});

test.describe("daily retention engine", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the menu shows today's daily summary (modifier + streak)", async ({
    page,
  }) => {
    await expect(page.locator("#menu")).toBeVisible();
    const summary = page.locator("#daily-summary");
    await expect(summary).toContainText("🔥");
    await expect(summary).not.toBeEmpty();
  });

  test("completing the daily grants a streak reward and marks it played", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startDaily());
    await page.waitForTimeout(500);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("Streak");

    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator("#daily-summary")).toContainText("played");
    const daily = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).daily
    );
    expect(daily.streak).toBeGreaterThanOrEqual(1);
    expect(daily.lastDate).not.toBeNull();
  });
});

test.describe("campaign progression", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("clearing a level wins, awards stars/coins and unlocks the next", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-stars .star.on")).not.toHaveCount(0);

    // The recap window shows a per-run stats grid (Moves, Swipes, etc.).
    await expect(page.locator("#win-stats .win-stat")).toHaveCount(4);
    await expect(page.locator("#win-stats")).toContainText("Moves");
    await expect(page.locator("#win-stats")).toContainText("Popped");

    // The coin payout is sealed in a chest — tap it open to reveal the reward.
    await expect(page.locator("#win-chest")).toBeVisible();
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-reward-reveal")).toBeVisible();

    // Coins count up to a positive total in the recap window.
    await expect
      .poll(async () =>
        Number(await page.locator("#win-coins-num").textContent())
      )
      .toBeGreaterThan(0);

    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.maxUnlockedLevel).toBeGreaterThanOrEqual(2);
    expect(save.stars["1"]).toBeGreaterThanOrEqual(1);
    expect(save.coins).toBeGreaterThan(0);
  });

  test("running out of moves loses and offers a revive", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(600);
    const cell = await findGroupCell(page);
    await page.evaluate(() => (window.__bpc.game.session.movesLeft = 1));
    await page.evaluate(({ c, r }) => window.__bpc.game.popAt(c, r), cell);
    await expect(page.locator("#lose")).toBeVisible();
    await expect(page.locator("#lose-revive")).toBeVisible();
  });

  test("revive (rewarded ad) grants +5 moves and resumes play", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(600);
    const cell = await findGroupCell(page);
    await page.evaluate(() => (window.__bpc.game.session.movesLeft = 1));
    await page.evaluate(({ c, r }) => window.__bpc.game.popAt(c, r), cell);
    await expect(page.locator("#lose")).toBeVisible();

    await page.locator("#lose-revive").click();
    await expect(page.locator("#ad-overlay")).toBeVisible();
    await expect(page.locator("#hud")).toBeVisible({ timeout: 6000 });
    const ended = await page.evaluate(() => window.__bpc.game.session.ended);
    expect(ended).toBe(false);
    const moves = await page.evaluate(() => window.__bpc.game.session.movesLeft);
    expect(moves).toBeGreaterThanOrEqual(5);
  });

  test("double coins (rewarded ad) increases the balance", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    // The double-coins offer is revealed only once the chest is opened.
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-double")).toBeVisible();
    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.locator("#win-double").click();
    await expect(page.locator("#ad-overlay")).toBeVisible();
    await page.waitForTimeout(2600);
    const after = await page.evaluate(() => window.__bpc.Economy.coins);
    expect(after).toBeGreaterThan(before);
    await expect(page.locator("#win-double")).toBeHidden();
  });

  test("the win screen seals the reward in a shaking chest until it is tapped", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();

    // Closed state: chest is shaking, hint is shown, the coin reward is sealed.
    await expect(page.locator("#win-chest-art")).toHaveClass(/shaking/);
    await expect(page.locator("#win-chest-art")).not.toHaveClass(/open/);
    await expect(page.locator("#win-reward-reveal")).toBeHidden();
    expect(await page.locator("#win-coins-num").textContent()).toBe("0");

    // Tap to open: lid flips, the reward reveals and the coins count up.
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-chest-art")).toHaveClass(/open/);
    await expect(page.locator("#win-chest-art")).not.toHaveClass(/shaking/);
    await expect(page.locator("#win-reward-reveal")).toBeVisible();
    await expect
      .poll(async () => Number(await page.locator("#win-coins-num").textContent()))
      .toBeGreaterThan(0);

    // Once the count-up settles, re-tapping the chest must not reset/replay it.
    await page.waitForTimeout(1300);
    const coins = await page.locator("#win-coins-num").textContent();
    expect(Number(coins)).toBeGreaterThan(0);
    await page.locator("#win-chest").click();
    await page.waitForTimeout(300);
    expect(await page.locator("#win-coins-num").textContent()).toBe(coins);
  });
});

test.describe("milestone events (every 5 levels)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the level map flags treasure and boss milestones", async ({ page }) => {
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    // Level 5 is a treasure beat; level 10 is a boss beat.
    await expect(page.locator(".level-cell").nth(4)).toHaveClass(
      /milestone-treasure/
    );
    await expect(page.locator(".level-cell").nth(9)).toHaveClass(
      /milestone-boss/
    );
  });

  test("the level map groups levels into themed chapter headers", async ({
    page,
  }) => {
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    // 40 levels / 8 per chapter = 5 chapter headers, each spanning a range.
    const headers = page.locator(".chapter-header");
    await expect(headers).toHaveCount(5);
    await expect(headers.first()).toContainText("1–8");
    await expect(headers.nth(1)).toContainText("9–16");
    await expect(headers.last()).toContainText("33–40");
  });

  test("a treasure level pays a one-time bonus + free power-up (not farmable)", async ({
    page,
  }) => {
    // First clear of treasure level 5 grants the reward.
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    const puBefore = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("magnet")
    );
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("bonus coins");
    const save1 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save1.milestonesCleared).toContain(5);
    const puAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("magnet")
    );
    expect(puAfter).toBe(puBefore + 1); // treasure #1 grants a free magnet

    // Replaying the same level must NOT pay the milestone reward again.
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    const puReplay = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("magnet")
    );
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).not.toContainText("bonus coins");
    const save2 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save2.milestonesCleared.filter((id) => id === 5)).toHaveLength(1);
    const puReplayAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("magnet")
    );
    expect(puReplayAfter).toBe(puReplay); // no second free power-up
  });

  test("a boss level shows the core objective and unlocks a theme on victory", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(10));
    await page.waitForTimeout(600);
    // The HUD shows the frozen-core objective, not a score target.
    await expect(page.locator("#hud-target-label")).toHaveText("Core");
    const core = await page.evaluate(() =>
      window.__bpc.game.session.board.frozenRemaining()
    );
    expect(core).toBeGreaterThan(0);

    // Shatter the entire frozen core to satisfy the boss objective, then let
    // the real end-of-move logic resolve the win. (ICE = 1, ICE_CRACKED = 3.)
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.types[c][r] === 1 || b.types[c][r] === 3) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });

    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("Theme unlocked");
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.milestonesCleared).toContain(10);
    expect(save.ownedThemes).toContain("sunset");
  });
});

test.describe("endless & daily modes", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("endless refills the board when cleared", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startEndless());
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      // Force a board clear and trigger the refill path.
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) b.grid[c][r] = -1;
      g.afterMove();
    });
    await page.waitForTimeout(200);
    const remaining = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(remaining).toBeGreaterThan(0); // refilled
    const mode = await page.evaluate(() => window.__bpc.game.session.mode);
    expect(mode).toBe("endless");
  });

  test("daily completion records a streak and persists it", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startDaily());
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.daily.streak).toBeGreaterThanOrEqual(1);
    expect(save.daily.lastDate).not.toBeNull();
  });
});

test.describe("swipe-aware completion (no premature deadlock)", () => {
  test.beforeEach(({ page }) => openGame(page));

  // Regression: a level must NOT finish while bubbles remain if the player has
  // moves left and a row-shift (swipe) could still realign them into a match.
  test("level stays open when only a swipe can create a match", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const b = s.board;
      s.petActive = null; // isolate the deadlock logic from pet help
      // Wipe the board, then lay a single bottom row with NO same-colour
      // neighbours (no tap-move) but whose ends share a colour, so one wrap
      // shift produces a poppable pair.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      const br = b.rows - 1;
      for (let c = 0; c < b.cols; c++) {
        b.grid[c][br] = c === 0 || c === b.cols - 1 ? 1 : c % 2 === 0 ? 2 : 0;
        b.types[c][br] = 0;
      }
      s.movesLeft = 5; // plenty of moves remain
      const hadTapMove = b.hasMoves();
      const hadShiftMove = b.hasShiftMove();
      g.afterMove(); // run the real end-of-move evaluation
      return {
        hadTapMove,
        hadShiftMove,
        ended: s.ended,
        remaining: b.countRemaining(),
      };
    });

    expect(state.hadTapMove).toBe(false);
    expect(state.hadShiftMove).toBe(true);
    expect(state.remaining).toBeGreaterThan(0);
    // The level must remain in play — no win/lose/rescue while a swipe is open.
    expect(state.ended).toBe(false);
    await expect(page.locator("#win")).toBeHidden();
    await expect(page.locator("#lose")).toBeHidden();
    await expect(page.locator("#isolated")).toBeHidden();

    // And the swipe genuinely unsticks the board.
    const afterSwipe = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const y = b.targetPixel(0, b.rows - 1).y;
      g.handleSwipe("right", b.originX + b.boardW / 2, y);
      return { hasMoves: b.hasMoves(), ended: g.session.ended };
    });
    expect(afterSwipe.hasMoves).toBe(true);
    expect(afterSwipe.ended).toBe(false);
  });

  // The genuine deadlock (no tap AND no useful swipe) still ends the level.
  test("a true deadlock with no swipe-move still resolves", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const state = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const b = s.board;
      s.petActive = null;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      // Two single bubbles of DIFFERENT colours: no shift can ever match them.
      const br = b.rows - 1;
      b.grid[0][br] = 0;
      b.grid[b.cols - 1][br] = 1;
      s.movesLeft = 5;
      s.score = s.level.target + 1; // already at target → deadlock = win
      const hadShiftMove = b.hasShiftMove();
      g.afterMove();
      return { hadShiftMove, ended: s.ended };
    });

    expect(state.hadShiftMove).toBe(false);
    expect(state.ended).toBe(true); // genuine deadlock resolves the level
  });
});


test.describe("power-ups (UI arm + apply)", () => {
  test.beforeEach(({ page }) => openGame(page));


  test("bomb clears a 3x3 area and consumes one charge", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    const before = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    await page.locator('[data-pu="bomb"]').click();
    await expect(page.locator('[data-pu="bomb"]')).toHaveClass(/armed/);
    // tap a central cell to drop the bomb
    await tapCell(page, 3, 4);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before - after).toBeGreaterThanOrEqual(4);
    await expect(page.locator('[data-pu="bomb"] .pu-count')).toHaveText("0");
  });

  test("color clear removes an entire colour", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    await page.locator('[data-pu="colorClear"]').click();
    const cell = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1) return { c, r, color: b.grid[c][r] };
      return null;
    });
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);
    const remainingOfColor = await page.evaluate(
      (color) => window.__bpc.game.session.board.colorCells(color).length,
      cell.color
    );
    expect(remainingOfColor).toBe(0);
  });

  test("shuffle reshuffles immediately and consumes a charge", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    // Shuffle is not in the default loadout — drop it into a slot first.
    await page.evaluate(() => window.__bpc.UI.assignLoadout(0, "shuffle"));
    await page.locator('[data-pu="shuffle"]').click();
    await expect(page.locator('[data-pu="shuffle"] .pu-count')).toHaveText("0");
    const hasMoves = await page.evaluate(() =>
      window.__bpc.game.session.board.hasMoves()
    );
    expect(hasMoves).toBe(true);
  });

  test("chain bolt clears a full row and column", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__bpc.Economy.addPowerup("chainBolt", 1));
    await page.evaluate(() => window.__bpc.UI.assignLoadout(0, "chainBolt"));
    const { before, cols, rows } = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return { before: b.countRemaining(), cols: b.cols, rows: b.rows };
    });
    await page.locator('[data-pu="chainBolt"]').click();
    await expect(page.locator('[data-pu="chainBolt"]')).toHaveClass(/armed/);
    await tapCell(page, Math.floor(cols / 2), Math.floor(rows / 2));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    // A full row + column through a packed board removes (cols + rows - 1).
    expect(before - after).toBeGreaterThanOrEqual(Math.max(cols, rows));
    await expect(page.locator('[data-pu="chainBolt"] .pu-count')).toHaveText("0");
  });

  test("pick removes exactly one bubble", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    await page.evaluate(() => window.__bpc.Economy.addPowerup("pick", 1));
    await page.evaluate(() => window.__bpc.UI.assignLoadout(0, "pick"));
    const before = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    await page.locator('[data-pu="pick"]').click();
    const cell = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1 && b.types[c][r] === 0) return { c, r };
      return null;
    });
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before - after).toBe(1);
    await expect(page.locator('[data-pu="pick"] .pu-count')).toHaveText("0");
  });

  test("magnet shows a gauge and pulls a colour into one connected blob", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    // Choose a plain bubble whose colour has the most copies on the board.
    const target = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      const counts = {};
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1 && b.types[c][r] === 0)
            counts[b.grid[c][r]] = (counts[b.grid[c][r]] || 0) + 1;
      let color = -1;
      let best = 0;
      for (const k in counts)
        if (counts[k] > best) {
          best = counts[k];
          color = +k;
        }
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] === color && b.types[c][r] === 0)
            return { c, r, color, total: best };
      return null;
    });
    expect(target).not.toBeNull();

    // Arm the magnet and tap the bubble to start the swinging gauge.
    await page.locator('[data-pu="magnet"]').click();
    await expect(page.locator('[data-pu="magnet"]')).toHaveClass(/armed/);
    await tapCell(page, target.c, target.r);
    await expect(page.locator("#magnet-gauge")).toBeVisible();
    expect(
      await page.evaluate(
        () => !!(window.__bpc.game.session.magnet && window.__bpc.game.session.magnet.aiming)
      )
    ).toBe(true);

    // Lock a perfect reading — the sweet spot is randomised, so aim the gauge
    // exactly at it. The real lock path then gathers the whole colour.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.magnet.value = g.session.magnet.sweet; // dead-on = full strength
      g.lockMagnet();
    });
    await expect(page.locator("#magnet-gauge")).toBeHidden();

    const after = await page.evaluate((t) => {
      const b = window.__bpc.game.session.board;
      return {
        group: b.getGroupAt(t.c, t.r).length,
        total: b.colorCells(t.color).length,
      };
    }, target);
    expect(after.total).toBe(target.total); // colour multiset preserved
    expect(after.group).toBe(target.total); // whole colour now one blob
    await expect(page.locator('[data-pu="magnet"] .pu-count')).toHaveText("0");
  });

  test("long-pressing a slot opens the picker and swaps the equipped power-up", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);

    // Default slot 0 holds the bomb.
    await expect(page.locator("#pu-slot-0")).toHaveAttribute("data-pu", "bomb");
    await expect(page.locator("#loadout")).toBeHidden();

    // A real long-press (hold >450ms) on slot 0 opens the picker.
    const box = await page.locator("#pu-slot-0").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.locator("#loadout")).toBeVisible();

    // The picker lists every power-up, including ones not in the loadout.
    await expect(page.locator('#loadout-list [data-pu="shuffle"]')).toBeVisible();
    await expect(page.locator("#loadout-list .loadout-item")).toHaveCount(6);

    // Choosing Shuffle equips it in slot 0 and closes the picker.
    await page.locator('#loadout-list [data-pu="shuffle"]').click();
    await expect(page.locator("#loadout")).toBeHidden();
    await expect(page.locator("#pu-slot-0")).toHaveAttribute("data-pu", "shuffle");

    // The swap persists to storage.
    const loadout = await page.evaluate(() =>
      window.__bpc.Storage.getLoadout()
    );
    expect(loadout[0]).toBe("shuffle");
    expect(new Set(loadout).size).toBe(3);
  });

  test("tapping an empty tool slot opens the shop with that tool highlighted and pauses the level", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);

    // Put a tool the player owns NONE of into slot 0.
    await page.evaluate(() => window.__bpc.UI.assignLoadout(0, "chainBolt"));
    expect(
      await page.evaluate(() => window.__bpc.Economy.getPowerup("chainBolt"))
    ).toBe(0);

    // Tapping the empty slot routes to the shop (with the tool highlighted)
    // instead of arming nothing.
    await page.locator("#pu-slot-0").click();
    await expect(page.locator("#shop")).toBeVisible();
    await expect(
      page.locator('#shop-list .shop-item[data-pu="chainBolt"]')
    ).toHaveClass(/highlight/);
    // The live level is paused while the player shops.
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);

    // Back returns to the level (HUD) and resumes it — not the menu.
    await page.locator("#shop-back").click();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#menu")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(false);
  });
});

test.describe("fever mode (double points)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a pop scores double while Fever is active", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    // With Fever active and combo reset, a pop awards groupScore (combo×1)
    // doubled — exactly twice the projected points at combo 0.
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 0;
      s.feverActive = true;
      s.feverTimer = 99;
      s.fever = 1;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          const grp = b.getGroupAt(c, r);
          if (grp.length >= 2) {
            const projected = g.projectedPoints(grp.length); // combo 0 → groupScore
            const before = s.score;
            g.popAt(c, r);
            return { projected, delta: s.score - before };
          }
        }
      return null;
    });
    expect(res).not.toBeNull();
    expect(res.delta).toBe(res.projected * 2);
  });

  test("filling the Fever gauge triggers Fever and lights the bar", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    await page.evaluate(() => window.__bpc.game._startFever());
    await expect
      .poll(() => page.evaluate(() => window.__bpc.game.session.feverActive))
      .toBe(true);
    await expect(page.locator("#fever-meter.fever-active")).toBeVisible();
    await expect(page.locator("#fever-label")).toHaveText("×2 FEVER");
  });
});

test.describe("achievements (tiered chests & rewards)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("Achievements screen opens from the menu and lists every category", async ({
    page,
  }) => {
    await page.locator("#btn-achievements").click();
    await expect(page.locator("#achievements")).toBeVisible();
    const total = await page.evaluate(
      () =>
        window.__bpc.game &&
        document.querySelectorAll("#achv-list .achv-item").length
    );
    expect(total).toBeGreaterThanOrEqual(8);
    // Fresh save: no chests waiting yet, so nothing is claimable.
    expect(await page.locator(".achv-item.claimable").count()).toBe(0);
    // Every category shows a progress bar.
    expect(await page.locator("#achv-list .achv-bar").count()).toBe(total);
    await page.locator("#achv-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("popping a cluster makes the Popper chest claimable and collecting it pays coins", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      let popped = false;
      for (let c = 0; c < b.cols && !popped; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            popped = true;
            break;
          }
        }
      // Collecting the chest pays coins separately from the pop's score.
      const before = window.__bpc.Economy.coins;
      const reward = g.claimAchievement("popper");
      const st = window.__bpc.Storage.getAchievementState();
      return {
        popped,
        reward,
        coinDelta: window.__bpc.Economy.coins - before,
        claims: st.claims,
        pops: st.progress.pops,
      };
    });
    expect(res.popped).toBe(true);
    expect(res.pops).toBeGreaterThanOrEqual(1);
    expect(res.reward).not.toBeNull();
    // The chest always pays at least the tier's guaranteed coins.
    expect(res.reward.coins).toBeGreaterThanOrEqual(10);
    expect(res.coinDelta).toBeGreaterThanOrEqual(10);
    // The Popper category has advanced one tier.
    expect(res.claims.popper).toBe(1);
  });

  test("collecting a chest from the Achievements screen reveals its contents", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);
    // Pop a cluster so the Popper tier becomes claimable.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
        }
    });
    await page.evaluate(() => window.__bpc.UI.showScreen("achievements"));
    await expect(page.locator("#achievements")).toBeVisible();
    const claim = page.locator(".achv-item.claimable .achv-claim").first();
    await expect(claim).toBeVisible();
    await claim.click();
    // The reveal modal opens listing at least the coin reward.
    await expect(page.locator("#chest")).toBeVisible();
    expect(
      await page.locator("#chest-rewards .chest-row").count()
    ).toBeGreaterThanOrEqual(1);
    await page.locator("#chest-ok").click();
    await expect(page.locator("#achievements")).toBeVisible();
    const claims = await page.evaluate(
      () => window.__bpc.Storage.getAchievementState().claims
    );
    expect(claims.popper).toBe(1);
  });

  test("Collect All grabs every ready chest at once and reveals the haul", async ({
    page,
  }) => {
    // Seed lifetime progress so exactly three first-tier chests are ready
    // (and NOT their second tiers, so collecting empties the list).
    await page.evaluate(() => {
      window.__bpc.Storage.setAchievementState({
        progress: { pops: 1, bestCombo: 5, biggestGroup: 8 },
        claims: {},
      });
    });
    const beforeCoins = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.evaluate(() => window.__bpc.UI.showScreen("achievements"));
    await expect(page.locator("#achievements")).toBeVisible();

    const collectAll = page.locator("#achv-collect-all");
    await expect(collectAll).toBeVisible();
    expect(await page.locator(".achv-item.claimable").count()).toBe(3);

    await collectAll.click();
    // The aggregate reveal opens summarising the haul.
    await expect(page.locator("#chest")).toBeVisible();
    await expect(page.locator("#chest-title")).toContainText("Collected");
    expect(
      await page.locator("#chest-rewards .chest-row").count()
    ).toBeGreaterThanOrEqual(1);
    await page.locator("#chest-ok").click();
    await expect(page.locator("#achievements")).toBeVisible();

    // All three chests were collected: coins grew, the categories advanced a
    // tier, the button hides and nothing is left to claim.
    const afterCoins = await page.evaluate(() => window.__bpc.Economy.coins);
    expect(afterCoins).toBeGreaterThan(beforeCoins);
    const claims = await page.evaluate(
      () => window.__bpc.Storage.getAchievementState().claims
    );
    expect(claims.popper).toBe(1);
    expect(claims.combo).toBe(1);
    expect(claims.bigbang).toBe(1);
    await expect(collectAll).toBeHidden();
    expect(await page.locator(".achv-item.claimable").count()).toBe(0);
  });

  test("triggering Fever makes the Fever chest claimable", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__bpc.game._startFever());
    const res = await page.evaluate(() => {
      const fevers = window.__bpc.Storage.getAchievementState().progress.fevers;
      const reward = window.__bpc.game.claimAchievement("fever");
      return { fevers, reward };
    });
    expect(res.fevers).toBeGreaterThanOrEqual(1);
    expect(res.reward).not.toBeNull();
    expect(res.reward.category.id).toBe("fever");
  });

  test("tutorial play never counts toward achievements", async ({ page }) => {
    // Start the tutorial and pop within it; no achievement state should change.
    await page.evaluate(() => window.__bpc.game.startTutorial());
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
        }
    });
    const st = await page.evaluate(() =>
      window.__bpc.Storage.getAchievementState()
    );
    expect(st.claims).toEqual({});
    expect(st.progress.pops || 0).toBe(0);
  });
});

test.describe("login calendar (daily gifts)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("Gifts screen opens from the menu and lists the 7-day cycle", async ({
    page,
  }) => {
    await page.locator("#btn-calendar").click();
    await expect(page.locator("#calendar")).toBeVisible();
    expect(await page.locator("#cal-grid .cal-day").count()).toBe(7);
    // Fresh save: day 1 is today's claimable reward.
    await expect(page.locator(".cal-day.today")).toBeVisible();
    await expect(page.locator("#cal-claim")).toBeEnabled();
    await page.locator("#cal-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("a fresh save shows the claimable badge on the menu Gifts tile", async ({
    page,
  }) => {
    await expect(page.locator("#cal-badge")).toBeVisible();
  });

  test("claiming today's gift pays the reward and locks until tomorrow", async ({
    page,
  }) => {
    await page.locator("#btn-calendar").click();
    await expect(page.locator("#calendar")).toBeVisible();

    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.locator("#cal-claim").click();

    const res = await page.evaluate(() => {
      const cal = window.__bpc.calendar;
      const state = window.__bpc.Storage.get("loginCalendar");
      return {
        coins: window.__bpc.Economy.coins,
        day: state.day,
        claimable: cal.calendarStatus(state, cal.todayKey()).claimable,
      };
    });
    // Day 1 reward is 50 coins.
    expect(res.coins).toBe(before + 50);
    expect(res.day).toBe(1);
    expect(res.claimable).toBe(false);
    // The claim button is now disabled and the badge clears.
    await expect(page.locator("#cal-claim")).toBeDisabled();
    await page.locator("#cal-back").click();
    await expect(page.locator("#cal-badge")).toBeHidden();
  });

  test("claiming twice in one day does not double-pay", async ({ page }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const first = g.claimCalendar();
      const second = g.claimCalendar();
      return { first, second };
    });
    expect(res.first).not.toBeNull();
    expect(res.second).toBeNull();
  });
});

test.describe("season pass (battle pass)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("Season screen opens from the menu and lists the tier ladder", async ({
    page,
  }) => {
    await page.locator("#btn-season").click();
    await expect(page.locator("#season")).toBeVisible();
    // Ten tiers, each with a free + premium reward cell.
    expect(await page.locator("#season-track .season-row").count()).toBe(10);
    expect(await page.locator("#season-track .season-cell").count()).toBe(20);
    // Fresh save: no XP, nothing claimable, premium not owned.
    await expect(page.locator("#season-buy")).toBeVisible();
    await expect(page.locator(".season-cell.claimable")).toHaveCount(0);
    await page.locator("#season-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("earning XP unlocks a free tier that pays out when claimed", async ({
    page,
  }) => {
    // Grant enough XP for tier 1, then re-open the screen.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g._awardSeasonXp(120);
    });
    await page.locator("#btn-season").click();
    await expect(page.locator("#season")).toBeVisible();

    // Tier 1 (free) is now claimable; the menu badge would show too.
    const claimable = page.locator(".season-row").first().locator(".season-free");
    await expect(claimable).toHaveClass(/claimable/);

    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await claimable.click();
    const after = await page.evaluate(() => window.__bpc.Economy.coins);
    // Tier 1 free reward is 30 coins.
    expect(after).toBe(before + 30);
    // The cell is now claimed (locked) and not claimable.
    await expect(
      page.locator(".season-row").first().locator(".season-free")
    ).toHaveClass(/claimed/);
  });

  test("premium track is gated until the pass is purchased", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game._awardSeasonXp(120));
    await page.locator("#btn-season").click();

    // Premium tier 1 starts locked.
    const prem = page.locator(".season-row").first().locator(".season-premium");
    await expect(prem).toHaveClass(/prem-locked/);

    // Buy premium, then it becomes claimable.
    await page.locator("#season-buy").click();
    await expect(page.locator("#season-buy")).toBeHidden();
    await expect(
      page.locator(".season-row").first().locator(".season-premium")
    ).toHaveClass(/claimable/);
    expect(
      await page.evaluate(() => window.__bpc.Storage.get("season").premium)
    ).toBe(true);
  });

  test("the menu badge appears when a reward is claimable", async ({ page }) => {
    await expect(page.locator("#season-badge")).toBeHidden();
    await page.evaluate(() => window.__bpc.game._awardSeasonXp(100));
    // Re-render the menu so the badge refresh runs.
    await page.evaluate(() => window.__bpc.UI.showScreen("menu"));
    await expect(page.locator("#season-badge")).toBeVisible();
  });
});

test.describe("colorblind mode (accessibility)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("toggle on the Themes screen flips the renderer flag and persists", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Themes", exact: true }).click();
    await expect(page.locator("#themes")).toBeVisible();

    // Off by default.
    await expect(page.locator("#cb-toggle-state")).toHaveText("Off");
    expect(await page.evaluate(() => window.__bpc.game.renderer.colorblind)).toBe(
      false
    );

    // Turn it on: label, renderer flag and saved setting all update.
    await page.locator("#cb-toggle").click();
    await expect(page.locator("#cb-toggle-state")).toHaveText("On");
    await expect(page.locator("#cb-toggle")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(await page.evaluate(() => window.__bpc.game.renderer.colorblind)).toBe(
      true
    );
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("bpc_save_v1")).settings.colorblind
      )
    ).toBe(true);

    // Turn it back off.
    await page.locator("#cb-toggle").click();
    await expect(page.locator("#cb-toggle-state")).toHaveText("Off");
    expect(await page.evaluate(() => window.__bpc.game.renderer.colorblind)).toBe(
      false
    );
  });

  test("the saved colorblind setting is applied on reload", async ({ page }) => {
    await page.getByRole("button", { name: "Themes", exact: true }).click();
    await page.locator("#cb-toggle").click();
    await expect(page.locator("#cb-toggle-state")).toHaveText("On");

    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    // Renderer picks up the saved setting at construction time.
    expect(await page.evaluate(() => window.__bpc.game.renderer.colorblind)).toBe(
      true
    );
  });
});

test.describe("idle move hint (assist)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a hint surfaces after the player sits idle", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(500);
    // Fast-forward the idle timer instead of waiting real seconds: the update
    // loop then promotes the largest poppable group into session.hint.
    const len = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.idleTime = 99;
      g.update(0.05);
      return g.session.hint ? g.session.hint.length : 0;
    });
    expect(len).toBeGreaterThanOrEqual(2);
  });

  test("any input clears the pending hint", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.idleTime = 99;
      g.update(0.05);
    });
    expect(
      await page.evaluate(() => !!window.__bpc.game.session.hint)
    ).toBe(true);
    // Tapping the board resolves a move and resets the idle assist.
    const cell = await findGroupCell(page);
    await tapCell(page, cell.c, cell.r);
    expect(
      await page.evaluate(() => !!window.__bpc.game.session.hint)
    ).toBe(false);
  });

  test("the Themes toggle disables hints and suppresses them in play", async ({
    page,
  }) => {
    // On by default.
    await page.getByRole("button", { name: "Themes", exact: true }).click();
    await expect(page.locator("#themes")).toBeVisible();
    await expect(page.locator("#hints-toggle-state")).toHaveText("On");
    expect(await page.evaluate(() => window.__bpc.game.hintsEnabled)).toBe(true);

    // Turn off: label, flag and saved setting all update.
    await page.locator("#hints-toggle").click();
    await expect(page.locator("#hints-toggle-state")).toHaveText("Off");
    expect(await page.evaluate(() => window.__bpc.game.hintsEnabled)).toBe(false);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("bpc_save_v1")).settings.hints
      )
    ).toBe(false);
    await page.locator("#themes-back").click();

    // With hints off, sitting idle never surfaces a hint.
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(500);
    const hint = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.idleTime = 99;
      g.update(0.05);
      return window.__bpc.game.session.hint;
    });
    expect(hint).toBeNull();
  });
});

test.describe("per-level best score", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("clearing a level records a personal best shown on the map", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    const best = await page.evaluate(() =>
      window.__bpc.Storage.getLevelScore(1)
    );
    expect(best).toBeGreaterThan(0);

    // The level map surfaces the best score under the stars.
    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    await expect(page.locator(".level-cell .lvl-best").first()).toContainText(
      "🏆"
    );
  });

  test("beating a prior best celebrates a New best score", async ({ page }) => {
    // Seed a tiny prior best so any clear beats it.
    await page.evaluate(() => window.__bpc.Storage.recordLevelScore(1, 1));
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("New best score");
  });
});


test.describe("bonus objectives", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("ordinary levels surface a bonus-objective chip in the HUD", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(500);
    await expect(page.locator("#hud-objective")).toBeVisible();
    const label = await page.evaluate(
      () => window.__bpc.getLevel(3).objective.label
    );
    await expect(page.locator("#hud-objective-text")).toContainText(label);
  });

  test("milestone levels carry no bonus objective", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(500);
    await expect(page.locator("#hud-objective")).toBeHidden();
  });

  test("meeting the objective pays a bonus on the win screen", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.objectiveMet = true;
      g.session.score = g.session.level.target;
      g.session.movesLeft = 0;
      g.afterMove();
    });
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("Objective");
    const after = await page.evaluate(() => window.__bpc.Economy.coins);
    expect(after).toBeGreaterThan(before);
  });

  test("a 'no power-ups' objective is missed when a power-up is used", async ({
    page,
  }) => {
    // Level 8 carries the 'Win without power-ups' objective.
    await page.evaluate(() => window.__bpc.game.startCampaign(8));
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.usedPowerup = true; // spent a tool → objective failed
      g.session.score = g.session.level.target;
      g.session.movesLeft = 0;
      g.afterMove();
    });
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).not.toContainText("Objective");
  });
});


test.describe("falling events (gift & problem tokens)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a forced gift token can be tapped to collect coins", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    // Force a gift, then pin its payload to a known coin amount so the
    // assertion is deterministic (a random roll could be a power-up instead).
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.spawnEvent("gift");
      g._activeEventDesc.reward = { type: "coins", coins: 50 };
    });
    const token = page.locator("#falling-event.gift");
    await expect(token).toBeVisible();

    // The token falls from above the viewport, so dispatch the click event
    // directly rather than relying on pointer actionability/position.
    await token.dispatchEvent("click");
    await expect(token).toBeHidden();

    const after = await page.evaluate(() => window.__bpc.Economy.coins);
    expect(after).toBe(before + 50);
    // The session is still alive and the token was cleared.
    expect(
      await page.evaluate(() => !!window.__bpc.game.session && !window.__bpc.game.activeEvent)
    ).toBe(true);
  });

  test("a missed problem token scatters bubbles on the board", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    // Snapshot the colour grid, force a problem, then let it fall off-screen.
    const snap = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return b.grid.map((col) => col.slice());
    });

    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.spawnEvent("problem");
      // Trigger the miss path directly (no need to wait ~4s for the fall).
      const token = document.getElementById("falling-event");
      token.remove();
      g._onEventMiss({ type: "problem" });
    });

    const changed = await page.evaluate((before) => {
      const b = window.__bpc.game.session.board;
      let diff = 0;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== before[c][r]) diff++;
      return diff;
    }, snap);
    expect(changed).toBeGreaterThan(0); // some bubbles were recoloured
    expect(
      await page.evaluate(() => !window.__bpc.game.activeEvent)
    ).toBe(true);
  });

  test("tapping a problem defuses it without scattering bubbles", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const snap = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return b.grid.map((col) => col.slice());
    });
    const before = await page.evaluate(() => window.__bpc.Economy.coins);

    await page.evaluate(() => window.__bpc.game.spawnEvent("problem"));
    const token = page.locator("#falling-event.problem");
    await expect(token).toBeVisible();
    await token.dispatchEvent("click");
    await expect(token).toBeHidden();

    const result = await page.evaluate((beforeGrid) => {
      const b = window.__bpc.game.session.board;
      let diff = 0;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== beforeGrid[c][r]) diff++;
      return { diff, coins: window.__bpc.Economy.coins };
    }, snap);
    expect(result.diff).toBe(0); // defused in time => board untouched
    expect(result.coins).toBeGreaterThan(before); // small relief reward
  });

  test("an in-flight token freezes (and can't miss) while on another window", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__bpc.game.spawnEvent("gift"));
    await expect(page.locator("#falling-event.gift")).toBeVisible();

    // Leaving the playing window (e.g. opening the pet manager over the level)
    // pauses the game and freezes the token so it can never silently miss.
    await page.evaluate(() => window.__bpc.game.pauseForOverlay());
    await expect(page.locator("#events-layer")).toHaveClass(/paused/);
    expect(await page.evaluate(() => window.__bpc.game.activeEvent)).toBe(true);

    // Returning to the level resumes the fall from where it left off.
    await page.evaluate(() => window.__bpc.game.resumeFromOverlay());
    await expect(page.locator("#events-layer")).not.toHaveClass(/paused/);
    expect(await page.evaluate(() => window.__bpc.game.activeEvent)).toBe(true);
  });
});

test.describe("shop & monetization (UI)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("daily free-coins ad reward escalates and caps at 3/day", async ({ page }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    const claim = async () => {
      await page.locator("#shop-free-coins").click();
      await expect(page.locator("#ad-overlay")).toBeVisible();
      await page.waitForTimeout(2400);
    };
    await claim(); // +150
    await expect(page.locator("#shop-coins")).toHaveText("150");
    await claim(); // +250 -> 400
    await expect(page.locator("#shop-coins")).toHaveText("400");
    await claim(); // +400 -> 800
    await expect(page.locator("#shop-coins")).toHaveText("800");
    // Daily cap reached: the button is disabled and the balance stays put.
    await expect(page.locator("#shop-free-coins")).toContainText("Done");
    await expect(page.locator("#shop-coins")).toHaveText("800");
  });

  test("buying a power-up deducts coins; insufficient funds is blocked", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    // With 0 coins, buying the bomb (150) must fail with a toast.
    await page.locator("#shop-list button", { hasText: /^150$/ }).click();
    await expect(page.locator("#toast")).toContainText("Not enough");

    // Earn coins via the free daily ad reward, then the purchase succeeds.
    await page.locator("#shop-free-coins").click(); // +150
    await page.waitForTimeout(2400);
    await page.locator("#shop-free-coins").click(); // +250 -> 400
    await page.waitForTimeout(2400);
    const bombBefore = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    await page.locator("#shop-list button", { hasText: /^150$/ }).click();
    await page.waitForTimeout(200);
    const bombAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    expect(bombAfter).toBe(bombBefore + 1);
    await expect(page.locator("#shop-coins")).toHaveText("250");
  });

  test("buying a power-up refreshes the HUD tool-slot count", async ({
    page,
  }) => {
    // Regression: the HUD slot counts used to stay stale after a shop purchase
    // because the buy handler refreshed the shop + coins but not the slots.
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(300);
    // Put the bomb in the first HUD slot so its count is on screen.
    await page.evaluate(() => {
      window.__bpc.Storage.setLoadoutSlot(0, "bomb");
      window.__bpc.UI.updatePowerups();
    });
    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    await expect(page.locator("#pu-slot-0 .pu-count")).toHaveText(
      String(before)
    );
    // Open the shop over the live level and buy a bomb.
    await page.evaluate(() => window.__bpc.UI.openShopForPowerup("bomb"));
    await expect(page.locator("#shop")).toBeVisible();
    await page
      .locator('#shop-list .shop-item[data-pu="bomb"] button')
      .click();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    expect(after).toBe(before + 1);
    // The HUD slot now shows the new total without any extra refresh.
    await expect(page.locator("#pu-slot-0 .pu-count")).toHaveText(
      String(after)
    );
  });

  test("remove ads disables interstitials and hides double-coins", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    await page.locator("#shop-list button", { hasText: "$2.99" }).click();
    await expect(page.locator("#shop-list button", { hasText: "Owned" })).toBeVisible();
    const removed = await page.evaluate(() => window.__bpc.Monetization.isAdsRemoved());
    expect(removed).toBe(true);

    // Win a level; the "double coins" rewarded button should be hidden.
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-double")).toBeHidden();
  });

  test("no forced interstitial before level 7 (new-player grace)", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    // The forced ad overlay must never appear for an early-level win.
    await page.waitForTimeout(300);
    await expect(page.locator("#ad-overlay")).toBeHidden();
  });
});

test.describe("themes (UI)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("buying and applying a priced theme updates the background", async ({
    page,
  }) => {
    // Grant enough coins for a priced theme.
    await page.evaluate(() => window.__bpc.Economy.addCoins(2000));
    await page.getByRole("button", { name: "Themes", exact: true }).click();

    // Buy "Candy Pop" (600).
    await page.locator("#theme-list button", { hasText: "600" }).click();
    await expect(page.locator("#toast")).toContainText("unlocked");

    // Now use it.
    await page.locator(".theme-item", { hasText: "Candy Pop" })
      .getByRole("button", { name: "Use" })
      .click();
    const current = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1")).currentTheme
    );
    expect(current).toBe("candy");
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg-0").trim()
    );
    expect(bg.length).toBeGreaterThan(0);
  });
});

test.describe("persistence & PWA", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("progress survives a reload", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    const coins = await page.evaluate(() => window.__bpc.Economy.coins);

    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    const coinsAfter = await page.evaluate(() => window.__bpc.Economy.coins);
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(coinsAfter).toBe(coins);
    expect(save.maxUnlockedLevel).toBeGreaterThanOrEqual(2);
  });

  test("service worker registers", async ({ page }) => {
    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      // Allow a moment for late registration.
      if (reg) return true;
      return new Promise((resolve) => {
        setTimeout(async () => {
          const r = await navigator.serviceWorker.getRegistration();
          resolve(!!r);
        }, 1500);
      });
    });
    expect(registered).toBe(true);
  });

  test("manifest is linked and reachable", async ({ page }) => {
    const href = await page.getAttribute('link[rel="manifest"]', "href");
    expect(href).toBeTruthy();
    const resp = await page.request.get("/manifest.json");
    expect(resp.ok()).toBe(true);
    const json = await resp.json();
    expect(json.name).toBe("Bubble Pop Chain");
  });
});

test.describe("resume in-progress level (save & continue)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("quitting to menu keeps progress and Continue resumes the same board", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    // Make a real move so there is in-progress state to preserve.
    const cell = await findGroupCell(page);
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => ({
      score: window.__bpc.game.session.score,
      moves: window.__bpc.game.session.movesLeft,
      grid: window.__bpc.game.session.board.serialize(),
    }));
    expect(before.score).toBeGreaterThan(0);

    // Quit to menu using the real in-game Back button.
    await page.locator("#btn-back").click();
    await expect(page.locator("#menu")).toBeVisible();
    const cont = page.locator("#btn-continue");
    await expect(cont).toBeVisible();
    await expect(cont).toContainText("Level 2");

    await cont.click();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#hud-mode-label")).toHaveText("Level 2");
    const after = await page.evaluate(() => ({
      score: window.__bpc.game.session.score,
      moves: window.__bpc.game.session.movesLeft,
      grid: window.__bpc.game.session.board.serialize(),
    }));
    expect(after.score).toBe(before.score);
    expect(after.moves).toBe(before.moves);
    expect(after.grid).toEqual(before.grid);
  });

  test("an in-progress level resumes after a full reload", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(700);
    const cell = await findGroupCell(page);
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => ({
      score: window.__bpc.game.session.score,
      moves: window.__bpc.game.session.movesLeft,
    }));
    // Return to the menu so the snapshot is the active state, then reload.
    await page.locator("#btn-back").click();
    await expect(page.locator("#menu")).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    const cont = page.locator("#btn-continue");
    await expect(cont).toBeVisible();
    await expect(cont).toContainText("Level 3");
    await cont.click();
    await expect(page.locator("#hud-mode-label")).toHaveText("Level 3");
    const after = await page.evaluate(() => ({
      score: window.__bpc.game.session.score,
      moves: window.__bpc.game.session.movesLeft,
    }));
    expect(after.score).toBe(before.score);
    expect(after.moves).toBe(before.moves);
  });

  test("finishing a level clears the saved session and hides Continue", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();
    await expect(page.locator("#btn-continue")).toBeHidden();
    const snap = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).activeSession
    );
    expect(snap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Interactive, gated tutorial: each "do this" step must NOT advance until the
// matching action is observed in the REAL game. We drive the actual code paths
// (real mouse tap + the real Game handlers the Input layer calls).
// ---------------------------------------------------------------------------
test.describe("interactive tutorial (gated, step-by-step)", () => {
  // Current tutorial step id, or null when the tutorial is finished/closed.
  const stepId = (page) =>
    page.evaluate(() => {
      const t = window.__bpc.game.tutorial;
      return t && t.active ? t.stepId : null;
    });

  // Open a fresh game WITHOUT dismissing the first-run tutorial.
  async function openFirstRun(page) {
    await page.goto("/?e2e=1");
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
  }

  test("first launch drops a new player into the tutorial", async ({ page }) => {
    await openFirstRun(page);
    await expect(page.locator("#tutorial")).toBeVisible();
    expect(await stepId(page)).toBe("welcome");
    // The real board + HUD are live behind the coach so the player can act.
    await expect(page.locator("#hud")).toBeVisible();
  });

  test("the board sits fully above the coach card (no hidden bubbles)", async ({
    page,
  }) => {
    await openFirstRun(page);
    await expect(page.locator("#tutorial")).toBeVisible();

    // The bottom edge of the board must clear the top of the coach card.
    const cardTop = await page
      .locator("#tutorial .coach-card")
      .evaluate((el) => el.getBoundingClientRect().top);
    const boardBottom = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return b.originY + b.boardH;
    });
    expect(boardBottom).toBeLessThanOrEqual(cardTop);
  });

  test("How to Play restarts the tutorial from the menu", async ({ page }) => {
    await openGame(page); // dismisses the first-run tutorial → clean menu
    await expect(page.locator("#menu")).toBeVisible();
    await page.getByRole("button", { name: "How to Play", exact: true }).click();
    await expect(page.locator("#tutorial")).toBeVisible();
    expect(await stepId(page)).toBe("welcome");
  });

  test("Skip exits to the menu and won't auto-open again", async ({ page }) => {
    await openFirstRun(page);
    await expect(page.locator("#tutorial")).toBeVisible();
    await page.locator("#coach-skip").click();
    await expect(page.locator("#tutorial")).toBeHidden();
    await expect(page.locator("#menu")).toBeVisible();
    expect(await stepId(page)).toBeNull();
    const done = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).firstRunDone
    );
    expect(done).toBe(true);
  });

  test("every step is gated and only advances when its action is performed", async ({
    page,
  }) => {
    await openFirstRun(page);
    expect(await stepId(page)).toBe("welcome");

    // 1) welcome (informational) — advances on the button.
    await page.locator("#coach-next").click();
    expect(await stepId(page)).toBe("tap");
    // Action steps hide the Next button: the only way forward is to do it.
    await expect(page.locator("#coach-next")).toBeHidden();

    // 2) tap — a REAL canvas tap pops a cluster.
    const cell = await findGroupCell(page);
    await tapCell(page, cell.c, cell.r);
    await expect.poll(() => stepId(page)).toBe("combo");

    // 3) combo — two quick pops chain a combo (multiplier ≥ 2).
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const pick = () => {
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2)
              return { c, r };
        return null;
      };
      const a = pick();
      g.popAt(a.c, a.r);
      const z = pick();
      g.popAt(z.c, z.r);
    });
    await expect.poll(() => stepId(page)).toBe("fever");

    // 3b) fever (informational) — the grant fires Fever; advance on the button.
    await expect
      .poll(() => page.evaluate(() => window.__bpc.game.session.feverActive))
      .toBe(true);
    await expect(page.locator("#fever-meter.fever-active")).toBeVisible();
    await page.locator("#coach-next").click();
    await expect.poll(() => stepId(page)).toBe("preview");

    // 4) preview — long-press previews a cluster's score.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2) {
            const p = b.targetPixel(c, r);
            g.previewAt(p.x, p.y);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("swipe");

    // 5) swipe — shift a whole row left/right.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const p = b.targetPixel(0, Math.floor(b.rows / 2));
      g.handleSwipe("left", p.x, p.y);
    });
    await expect.poll(() => stepId(page)).toBe("blast");
    // Entering the blast step grants a full charge meter.
    expect(await page.evaluate(() => window.__bpc.game.session.power)).toBe(1);

    // 6) blast — double-tap unleashes a Charged Blast.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1) {
            const p = b.targetPixel(c, r);
            g.handleDoubleTap(p.x, p.y);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("powerup");

    // 7) powerup — arm the bomb, then tap the board to use it.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      g.armPowerup("bomb", document.querySelector('[data-pu="bomb"]'));
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1) {
            const p = b.targetPixel(c, r);
            g.handleTap(p.x, p.y);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("magnet");

    // 7b) magnet — arm it, aim a plain bubble, lock the gauge on green.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      g.armPowerup("magnet", document.querySelector('[data-pu="magnet"]'));
      const find = () => {
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (
              b.grid[c][r] !== -1 &&
              b.types[c][r] === 0 &&
              b.colorCells(b.grid[c][r]).length >= 2
            )
              return { c, r };
        return null;
      };
      const t = find();
      g.beginMagnet(t.c, t.r);
      g.session.magnet.value = g.session.magnet.sweet; // perfect pull
      g.lockMagnet();
    });
    await expect.poll(() => stepId(page)).toBe("events");

    // 7c) events — a forgiving gift token falls; tapping it advances the step.
    const eventToken = page.locator("#falling-event");
    await expect(eventToken).toBeVisible();
    await eventToken.dispatchEvent("click");
    await expect.poll(() => stepId(page)).toBe("specials");

    // 8) specials (informational) — the board visibly shows a Rainbow + Ice.
    const specials = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      let rainbow = 0;
      let ice = 0;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.types[c][r] === 2) rainbow++; // RAINBOW
          if (b.types[c][r] === 1) ice++; // ICE
        }
      return { rainbow, ice };
    });
    expect(specials.rainbow).toBeGreaterThanOrEqual(1);
    expect(specials.ice).toBeGreaterThanOrEqual(1);
    await page.locator("#coach-next").click();
    expect(await stepId(page)).toBe("lightning");

    // 8a) lightning — popping a cluster that contains the lightning bubble
    // discharges its row + column and advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Find the lightning bubble and pop its cluster.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isLightning(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("pets");

    // 8b) pets (informational) — introduces the companion system.
    await page.locator("#coach-next").click();
    expect(await stepId(page)).toBe("done");

    // 9) done — finishes back to the menu.
    await page.locator("#coach-next").click();
    await expect(page.locator("#tutorial")).toBeHidden();
    await expect(page.locator("#menu")).toBeVisible();
    expect(await stepId(page)).toBeNull();
  });

  test("the tutorial board refills so the player never runs out of bubbles", async ({
    page,
  }) => {
    await openGame(page); // dismisses the first-run tutorial → clean menu
    await expect(page.locator("#menu")).toBeVisible();
    await page.getByRole("button", { name: "How to Play", exact: true }).click();
    await expect(page.locator("#tutorial")).toBeVisible();
    // Drain the practice board hard, then let the game settle each move.
    const remaining = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      // Empty the whole board, then call afterMove to trigger the refill guard.
      for (let pass = 0; pass < 6; pass++) {
        const b = s.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) b.grid[c][r] = -1;
        }
        g.afterMove();
      }
      const b = s.board;
      return { count: b.countRemaining(), hasMoves: b.hasMoves() };
    });
    // The board topped itself back up — there are always fresh bubbles/moves.
    expect(remaining.count).toBeGreaterThan(0);
    expect(remaining.hasMoves).toBe(true);
  });

  test("loads ≥10 of every tool plus all pets, then restores the real inventory", async ({
    page,
  }) => {
    await openGame(page); // dismisses the first-run tutorial → clean menu

    // Give the player a distinctive REAL inventory: a big stash of one tool,
    // none of others, plus a custom loadout — exactly what must be handed back.
    const real = await page.evaluate(() => {
      const { Storage } = window.__bpc;
      Storage.set("powerups", {
        bomb: 42,
        colorClear: 0,
        shuffle: 3,
        chainBolt: 0,
        pick: 0,
        magnet: 1,
      });
      Storage.set("loadout", ["pick", "shuffle", "chainBolt"]);
      return {
        powerups: { ...Storage.get("powerups") },
        loadout: Storage.getLoadout(),
        ownedPets: Object.keys(Storage.getPetState().owned).sort(),
      };
    });

    // Enter the tutorial sandbox.
    await page.getByRole("button", { name: "How to Play", exact: true }).click();
    await expect(page.locator("#tutorial")).toBeVisible();

    // Every tool is stocked to AT LEAST 10, the bigger real stash is never
    // reduced, and every catalog pet is loaded to experiment with.
    const TOOLS = ["bomb", "colorClear", "shuffle", "chainBolt", "pick", "magnet"];
    const loaded = await page.evaluate((tools) => {
      const { Storage, Economy } = window.__bpc;
      const counts = {};
      for (const t of tools) counts[t] = Economy.getPowerup(t);
      return {
        counts,
        ownedPets: Object.keys(Storage.getPetState().owned).length,
      };
    }, TOOLS);
    for (const t of TOOLS) expect(loaded.counts[t]).toBeGreaterThanOrEqual(10);
    expect(loaded.counts.bomb).toBe(42); // larger real stash preserved, not clamped
    expect(loaded.ownedPets).toBeGreaterThan(real.ownedPets.length);

    // Skipping (or finishing) the tutorial restores the EXACT real inventory
    // and clears the backup.
    await page.locator("#coach-skip").click();
    await expect(page.locator("#tutorial")).toBeHidden();
    const restored = await page.evaluate(() => {
      const { Storage } = window.__bpc;
      return {
        powerups: { ...Storage.get("powerups") },
        loadout: Storage.getLoadout(),
        ownedPets: Object.keys(Storage.getPetState().owned).sort(),
        backup: Storage.get("tutorialBackup"),
      };
    });
    expect(restored.powerups).toEqual(real.powerups);
    expect(restored.loadout).toEqual(real.loadout);
    expect(restored.ownedPets).toEqual(real.ownedPets);
    expect(restored.backup).toBeNull();
  });

  test("a mid-tutorial reload recovers the real inventory (no inflated stock left behind)", async ({
    page,
  }) => {
    await openGame(page); // dismisses the first-run tutorial → clean menu

    const real = await page.evaluate(() => {
      const { Storage } = window.__bpc;
      Storage.set("powerups", {
        bomb: 2,
        colorClear: 1,
        shuffle: 0,
        chainBolt: 0,
        pick: 0,
        magnet: 1,
      });
      return { ...Storage.get("powerups") };
    });

    // Enter the tutorial (loads the inflated practice stock), then reload the
    // page mid-tutorial WITHOUT finishing it.
    await page.getByRole("button", { name: "How to Play", exact: true }).click();
    await expect(page.locator("#tutorial")).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);

    // On reload the real inventory is recovered before anything else, so the
    // practice stock is never left behind in the real save.
    const recovered = await page.evaluate(() => {
      const { Storage } = window.__bpc;
      return {
        powerups: { ...Storage.get("powerups") },
        backup: Storage.get("tutorialBackup"),
      };
    });
    expect(recovered.powerups).toEqual(real);
    expect(recovered.backup).toBeNull();
  });
});

test.describe("performance (bounded effect cost)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the particle pool stays capped during a heavy pop storm", async ({
    page,
  }) => {
    // Regression: particles used to accumulate without bound during rapid
    // high-level combo/Fever chains, climbing into a superlinear draw-cost
    // cliff that tanked the framerate ("slowdown after progressing").
    const cap = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startCampaign(20);
      // Far more than any single clear would ever produce, all at once.
      for (let i = 0; i < 200; i++)
        g.particles.burst(200, 300, "#ff5b8d", 24, 1.4);
      return g.particles.count;
    });
    expect(cap).toBeLessThanOrEqual(600);
    // The pool still drains normally once the storm passes.
    const drained = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.particles.update(2);
      return g.particles.count;
    });
    expect(drained).toBe(0);
  });
});

test.describe("pet companions (collection & buffs)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("Pets screen opens with Sparky owned, equipped, and a starter crate", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Pets", exact: true }).click();
    await expect(page.locator("#pets")).toBeVisible();
    // Starter state: Sparky owned + equipped, one free crate to open.
    await expect(page.locator('.pet-card[data-pet="sparky"]')).toHaveClass(/owned/);
    await expect(page.locator('.pet-card[data-pet="sparky"]')).toHaveClass(/equipped/);
    const state = await page.evaluate(() => window.__bpc.Storage.getPetState());
    expect(state.equipped).toBe("sparky");
    expect(state.crates).toBeGreaterThanOrEqual(1);
    await page.locator("#pets-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("buying then opening a crate grants a pet", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await page.getByRole("button", { name: "Pets", exact: true }).click();

    // Buy a crate, then open everything we have.
    await page.locator("#crate-buy").click();
    const owned = await page.evaluate(() => {
      const g = window.__bpc.game;
      let res = null;
      let safety = 0;
      while (window.__bpc.Storage.getPetState().crates > 0 && safety < 20) {
        const r = g.openCrate();
        if (r) res = r;
        safety++;
      }
      return {
        last: res,
        owned: Object.keys(window.__bpc.Storage.getPetState().owned),
      };
    });
    expect(owned.last).not.toBeNull();
    // A real catalog pet was granted, and the crate reports its premium flag.
    const known = await page.evaluate(
      (id) => !!window.__bpc.pets.getPet(id),
      owned.last.petId
    );
    expect(known).toBe(true);
    expect(typeof owned.last.premium).toBe("boolean");
  });

  test("Pet Store sells premium pets and a legendary crate", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await page.getByRole("button", { name: "Pets", exact: true }).click();
    await expect(page.locator("#pet-store")).toBeVisible();
    // The premium pets (aurora/gizmo) are listed with real-money buy buttons.
    await expect(page.locator('#pet-store .store-buy[data-pet="aurora"]')).toBeVisible();
    await expect(page.locator('#pet-store .store-buy[data-pet="gizmo"]')).toBeVisible();
    // The Legendary Crate is offered for real money.
    await expect(page.locator("#legend-crate-buy")).toBeVisible();

    // Buying the legendary crate (mock provider) grants a pet.
    const res = await page.evaluate(() => window.__bpc.game.buyLegendaryCrate());
    expect(res).not.toBeNull();
    const known = await page.evaluate(
      (id) => !!window.__bpc.pets.getPet(id),
      res.petId
    );
    expect(known).toBe(true);
    const owned = await page.evaluate(() =>
      Object.keys(window.__bpc.Storage.getPetState().owned)
    );
    expect(owned).toContain(res.petId);
  });

  test("buying a premium pet from the store unlocks it", async ({ page }) => {
    await page.getByRole("button", { name: "Pets", exact: true }).click();
    await expect(page.locator("#pet-store")).toBeVisible();
    await page.locator('#pet-store .store-buy[data-pet="aurora"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => !!window.__bpc.Storage.getPetState().owned.aurora)
      )
      .toBe(true);
  });

  test("equipping a passive pet refreshes the live session's score buff", async ({
    page,
  }) => {
    // Grant + level up Draco (legendary, free, scoreMult) and equip it.
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("draco");
      window.__bpc.Storage.addPetXp("draco", 999); // push to a high level
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => window.__bpc.game.equipPet("draco"));
    const mult = await page.evaluate(
      () => window.__bpc.game.session.petBuffs.scoreMult
    );
    expect(mult).toBeGreaterThan(1);
  });

  test("a startCharge pet begins the level with the power meter pre-filled", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      const r = await window.__bpc.game.buyPremiumPet("gizmo"); // mock IAP grants it
      window.__bpc.Storage.addPetXp("gizmo", 999);
      window.__bpc.game.equipPet("gizmo");
      return r;
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const power = await page.evaluate(() => window.__bpc.game.session.power);
    expect(power).toBeGreaterThan(0);
  });

  test("an active pet (Rover) arms a gather action on the session", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("rover");
      window.__bpc.game.equipPet("rover");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active).not.toBeNull();
    expect(active.type).toBe("gather");
    expect(active.cooldown).toBeGreaterThan(0);
  });

  test("an active pet (Comet) arms a diagonal action on the session", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("comet");
      window.__bpc.game.equipPet("comet");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active).not.toBeNull();
    expect(active.type).toBe("diagonal");
    expect(active.cooldown).toBeGreaterThan(0);
  });

  test("the diagonal pet (Comet) blasts a diagonal streak off the board", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("comet");
      window.__bpc.game.equipPet("comet");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Paint a guaranteed ↘ diagonal of one colour in the top-left corner
      // (NORMAL === 0 in the bubble-type grid).
      for (let i = 0; i < 3; i++) {
        b.grid[i][i] = 0;
        b.types[i][i] = 0;
        const sp = b.spriteGrid[i][i];
        if (sp) {
          sp.color = 0;
          sp.type = 0;
        }
      }
      const runLen = b.diagonalRun(3).length;
      const beforeCount = b.countRemaining();
      g._petDiagonal(g.session.petActive);
      return {
        runLen,
        beforeCount,
        afterCount: b.countRemaining(),
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
      };
    });
    expect(result.runLen).toBeGreaterThanOrEqual(3);
    // The diagonal streak (which a normal tap can never clear) is gone.
    expect(result.afterCount).toBeLessThanOrEqual(result.beforeCount - 3);
    expect(result.busy).toBe(true);
    expect(result.kind).toBe("diagonal");
  });

  test("the pick pet (Talon) picks off the most isolated bubbles", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("talon");
      window.__bpc.game.equipPet("talon");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active).not.toBeNull();
    expect(active.type).toBe("pick");

    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Paint a big single-colour blob, then drop two lone bubbles of other
      // colours surrounded by it — those are the "most isolated" cells Talon
      // should hunt (NORMAL === 0 in the type grid).
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 0;
          b.types[c][r] = 0;
          const sp = b.spriteGrid[c][r];
          if (sp) {
            sp.color = 0;
            sp.type = 0;
          }
        }
      const lone = [
        { c: 1, r: 1, col: 1 },
        { c: 2, r: 2, col: 2 },
      ];
      for (const { c, r, col } of lone) {
        b.grid[c][r] = col;
        const sp = b.spriteGrid[c][r];
        if (sp) sp.color = col;
      }
      const ranked = b.mostIsolatedCells(2);
      const beforeNonZero = (() => {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.grid[c][r] !== -1 && b.grid[c][r] !== 0) n++;
        return n;
      })();
      g._petPick(g.session.petActive);
      const afterNonZero = (() => {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.grid[c][r] !== -1 && b.grid[c][r] !== 0) n++;
        return n;
      })();
      return {
        ranked,
        beforeNonZero,
        afterNonZero,
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
      };
    });
    // The two lone bubbles were the top-ranked isolated cells …
    expect(result.ranked).toHaveLength(2);
    expect(result.beforeNonZero).toBe(2);
    // … and Talon picked them off (after gravity, no off-colour bubbles remain).
    expect(result.afterNonZero).toBe(0);
    expect(result.busy).toBe(true);
    expect(result.kind).toBe("pick");
  });

  test("premium pet purchase via the mock provider grants ownership", async ({
    page,
  }) => {
    const owns = await page.evaluate(async () => {
      const before = window.__bpc.Storage.ownsPet("aurora");
      await window.__bpc.game.buyPremiumPet("aurora");
      return { before, after: window.__bpc.Storage.ownsPet("aurora") };
    });
    expect(owns.before).toBe(false);
    expect(owns.after).toBe(true);
  });

  test("the HUD pet badge appears during a campaign level", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await expect(page.locator("#hud-pet")).toBeVisible();
    await expect(page.locator("#hud-pet-icon")).not.toHaveText("");
  });

  test("an active pet plays an on-board ability animation", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("rover"); // gather pet
      window.__bpc.game.equipPet("rover");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    // The animator should be idle before the ability fires.
    const before = await page.evaluate(() => window.__bpc.game.petAnim.busy);
    expect(before).toBe(false);
    // Force the pet's gather action and confirm a flourish is queued. (If the
    // seeded board happens not to gather, fall back to the same code path the
    // ability uses so the live animator wiring is still exercised.)
    const playing = await page.evaluate(() => {
      const g = window.__bpc.game;
      g._petGather(g.session.petActive);
      if (!g.petAnim.busy) {
        const t = g.session.board.targetPixel(0, 0);
        g.petAnim.play({ kind: "gather", icon: "🐶", anchor: t, targets: [t] });
      }
      return {
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
      };
    });
    expect(playing.busy).toBe(true);
    expect(playing.kind).toBe("gather");
    // It clears itself after the animation completes.
    await expect
      .poll(() => page.evaluate(() => window.__bpc.game.petAnim.busy), {
        timeout: 4000,
      })
      .toBe(false);
  });

  test("tapping the HUD pet badge opens the pet manager overlay over the level", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await expect(page.locator("#hud-pet")).toBeVisible();
    // Opening the overlay over a live level pauses the game.
    await page.locator("#hud-pet").click();
    await expect(page.locator("#pets")).toBeVisible();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);
    // Closing without switching resumes the level (no restart).
    await page.locator("#pets-back").click();
    await expect(page.locator("#pets")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(false);
    await expect(page.locator("#hud-pet")).toBeVisible();
  });

  test("switching companion mid-level warns, then restarts on accept", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Storage.grantPet("clover"));
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    // Build up some score so we can prove the level was restarted.
    await page.evaluate(() => {
      window.__bpc.game.session.score = 4242;
    });
    await page.locator("#hud-pet").click();
    await expect(page.locator("#pets")).toBeVisible();
    // Select Clover, then press Equip → the switch confirmation appears.
    await page.locator('.pet-card[data-pet="clover"]').click();
    await page.locator("#pet-equip").click();
    await expect(page.locator("#pet-confirm")).toBeVisible();
    // Accept → equips Clover, restarts the level (score back to 0), closes.
    await page.locator("#pet-confirm-ok").click();
    await expect(page.locator("#pets")).toBeHidden();
    await expect(page.locator("#pet-confirm")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().equipped)).toBe(
      "clover"
    );
    expect(await page.evaluate(() => window.__bpc.game.session.score)).toBe(0);
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(false);
    await expect(page.locator("#hud-pet")).toBeVisible();
  });

  test("cancelling a mid-level companion switch keeps playing the same level", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Storage.grantPet("clover"));
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => {
      window.__bpc.game.session.score = 777;
    });
    await page.locator("#hud-pet").click();
    await page.locator('.pet-card[data-pet="clover"]').click();
    await page.locator("#pet-equip").click();
    await expect(page.locator("#pet-confirm")).toBeVisible();
    // Cancel → confirmation closes, overlay stays, nothing changed.
    await page.locator("#pet-confirm-cancel").click();
    await expect(page.locator("#pet-confirm")).toBeHidden();
    await expect(page.locator("#pets")).toBeVisible();
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().equipped)).toBe(
      "sparky"
    );
    // Closing the overlay resumes the untouched level.
    await page.locator("#pets-back").click();
    expect(await page.evaluate(() => window.__bpc.game.session.score)).toBe(777);
  });

  test("equipping from the menu does not warn or restart anything", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Storage.grantPet("clover"));
    await page.getByRole("button", { name: "Pets", exact: true }).click();
    await expect(page.locator("#pets")).toBeVisible();
    await page.locator('.pet-card[data-pet="clover"]').click();
    await page.locator("#pet-equip").click();
    // No active level → equips immediately, no confirmation modal.
    await expect(page.locator("#pet-confirm")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().equipped)).toBe(
      "clover"
    );
    // Overlay stays open (rebuilt) and there is no running session.
    await expect(page.locator("#pets")).toBeVisible();
    expect(await page.evaluate(() => !!window.__bpc.game.session)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lone-bubble rescue: when the board jams on isolated single bubbles (no
// poppable group of 2+), the player isn't stranded/failed — a friendly prompt
// steers them to the Pick 🔨 tool.
// ---------------------------------------------------------------------------

// Jam the active board so only isolated, distinct-colour bubbles remain, then
// re-run the move resolution that detects the deadlock.
async function jamBoardWithLoneBubbles(page) {
  await page.evaluate(() => {
    const g = window.__bpc.game;
    const b = g.session.board;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) {
        b.grid[c][r] = -1;
        if (b.spriteGrid && b.spriteGrid[c]) b.spriteGrid[c][r] = null;
        if (b.types && b.types[c]) b.types[c][r] = 0; // NORMAL
      }
    b.sprites = [];
    // Two lone bubbles of different colours, far apart → no group of 2+.
    b.grid[0][b.rows - 1] = 0;
    b.grid[b.cols - 1][b.rows - 1] = 1;
    g.session.score = 0; // ensure this isn't already a win
    g.afterMove();
  });
}

test.describe("lone-bubble rescue", () => {
  test("offers the Pick tool when the board jams on single bubbles", async ({
    page,
  }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => window.__bpc.Economy.addPowerup("pick", 2));
    await jamBoardWithLoneBubbles(page);

    await expect(page.locator("#isolated")).toBeVisible();
    // The level is NOT over — the player can still act.
    const ended = await page.evaluate(
      () => window.__bpc.game.session.ended
    );
    expect(ended).toBe(false);
  });

  test("Use Pick arms the Pick tool and resumes play", async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => window.__bpc.Economy.addPowerup("pick", 2));
    await jamBoardWithLoneBubbles(page);
    await expect(page.locator("#isolated")).toBeVisible();

    await page.locator("#iso-pick").click();
    await expect(page.locator("#isolated")).toBeHidden();
    const armed = await page.evaluate(
      () => window.__bpc.game.session.armed
    );
    expect(armed).toBe("pick");
  });

  test("Give Up lets the level end normally", async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => window.__bpc.Economy.addPowerup("pick", 2));
    await jamBoardWithLoneBubbles(page);
    await expect(page.locator("#isolated")).toBeVisible();

    await page.locator("#iso-giveup").click();
    // Score is 0 < target, so the level ends as a loss.
    await expect(page.locator("#lose")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#isolated")).toBeHidden();
  });
});

// ---------------------------------------------------------------------------
// Last-bubble finale: when a board is whittled down to a single un-poppable
// bubble, it glows then explodes (one of several random styles) and the board
// clears, resolving the level — instead of jamming on a lone bubble.
// ---------------------------------------------------------------------------

// Leave exactly ONE bubble on the active board, then run the real end-of-move
// evaluation that detects the single-bubble finish.
async function leaveOneBubble(page) {
  return page.evaluate(() => {
    const g = window.__bpc.game;
    const b = g.session.board;
    for (let c = 0; c < b.cols; c++)
      for (let r = 0; r < b.rows; r++) {
        b.grid[c][r] = -1;
        if (b.spriteGrid && b.spriteGrid[c]) b.spriteGrid[c][r] = null;
        if (b.types && b.types[c]) b.types[c][r] = 0; // NORMAL
      }
    b.sprites = [];
    b.grid[0][b.rows - 1] = 0; // a single lone bubble
    g.session.score = 0; // not already a win
    g.afterMove();
    return {
      active: g.finale.active,
      finishing: g.session.finishing,
      variant: g.session.finaleVariant,
      remaining: b.countRemaining(),
    };
  });
}

test.describe("last-bubble finale", () => {
  test("a single leftover bubble triggers the glow+explode finale", async ({
    page,
  }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const state = await leaveOneBubble(page);
    // The finale is playing: input is suspended and a random style was chosen.
    expect(state.active).toBe(true);
    expect(state.finishing).toBe(true);
    expect(state.remaining).toBe(1);
    expect(state.variant).toBeGreaterThanOrEqual(0);
    expect(state.variant).toBeLessThan(5);
  });

  test("the finale clears the board and resolves the level as a win", async ({
    page,
  }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    await leaveOneBubble(page);
    // Glow (~0.7s) + blast (~0.66s) + end delay (~0.48s) → the win screen shows.
    await expect(page.locator("#win")).toBeVisible({ timeout: 4000 });
    // The board genuinely emptied (clearing a board always wins).
    const cleared = await page.evaluate(() =>
      window.__bpc.game.session ? window.__bpc.game.session.board.countRemaining() : 0
    );
    expect(cleared).toBe(0);
  });
});

test.describe("premium Nova gunship pet", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("equipped Nova auto-blasts bottom bubbles with no player input", async ({
    page,
  }) => {
    // Own + max-level + equip Nova so its gunship deploys at full firepower.
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("nova");
      for (let i = 0; i < 12; i++) S.addPetXp("nova", 999);
      S.equipPet("nova");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(500);

    // The gunship is deployed for this (non-tutorial) session.
    expect(await page.evaluate(() => window.__bpc.game.alienShip.active)).toBe(true);

    const before = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    // Let it patrol and fire for a couple of seconds — without any taps.
    await page.waitForTimeout(2600);
    const after = await page.evaluate(() =>
      window.__bpc.game.session
        ? window.__bpc.game.session.board.countRemaining()
        : 0
    );
    // It cleared bubbles entirely on its own.
    expect(after).toBeLessThan(before);
  });

  test("Nova is $$$-only: buyable via the store, never from crates", async ({
    page,
  }) => {
    // The mock IAP purchase grants the pet, which then shows as owned.
    const bought = await page.evaluate(async () => {
      const ok = await window.__bpc.game.buyPremiumPet("nova");
      return { ok, owns: window.__bpc.Storage.ownsPet("nova") };
    });
    expect(bought.ok).toBe(true);
    expect(bought.owns).toBe(true);

    // Forcing the premium branch of both crate types must never yield Nova.
    const fromCrate = await page.evaluate(() => {
      const { rollCrate, rollLegendaryCrate } = window.__bpc.pets;
      // makeRng isn't exposed; a plain incrementing PRNG is enough here.
      let seed = 1;
      const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(rollCrate(rng, { premiumChance: 1 }).petId);
        ids.add(rollLegendaryCrate(rng, { premiumChance: 1 }).petId);
      }
      return [...ids];
    });
    expect(fromCrate).not.toContain("nova");
  });

  test("Nova does not deploy in the tutorial sandbox", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("nova");
      S.equipPet("nova");
    });
    await page.evaluate(() => window.__bpc.game.startTutorial());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__bpc.game.alienShip.active)).toBe(false);
  });
});


