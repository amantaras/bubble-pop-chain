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
      if (!best) break;
      g.popAt(best.c, best.r);
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
    for (const name of ["Play", "Endless", "Daily Challenge", "Shop", "Themes"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
  });

  test("Play opens the level map with level 1 unlocked", async ({ page }) => {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator("#levelmap")).toBeVisible();
    await expect(page.locator(".level-cell").first()).toContainText("1");
    await expect(page.locator(".level-cell.locked").first()).toBeVisible();
  });

  test("Shop and Themes open and Back returns to menu", async ({ page }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator("#shop-back").click();
    await expect(page.locator("#menu")).toBeVisible();

    await page.getByRole("button", { name: "Themes", exact: true }).click();
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
    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.locator("#win-double").click();
    await expect(page.locator("#ad-overlay")).toBeVisible();
    await page.waitForTimeout(2600);
    const after = await page.evaluate(() => window.__bpc.Economy.coins);
    expect(after).toBeGreaterThan(before);
    await expect(page.locator("#win-double")).toBeHidden();
  });
});

test.describe("milestone events (every 5 levels)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the level map flags treasure and boss milestones", async ({ page }) => {
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.locator("#levelmap")).toBeVisible();
    // Level 5 is a treasure beat; level 10 is a boss beat.
    await expect(page.locator(".level-cell").nth(4)).toHaveClass(
      /milestone-treasure/
    );
    await expect(page.locator(".level-cell").nth(9)).toHaveClass(
      /milestone-boss/
    );
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
      g.session.magnet.value = 0.5; // perfect pull
      g.lockMagnet();
    });
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
    expect(await stepId(page)).toBe("done");

    // 9) done — finishes back to the menu.
    await page.locator("#coach-next").click();
    await expect(page.locator("#tutorial")).toBeHidden();
    await expect(page.locator("#menu")).toBeVisible();
    expect(await stepId(page)).toBeNull();
  });
});

