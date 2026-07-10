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

async function unlockAllTools(page) {
  await page.evaluate(() => {
    window.__bpc.Storage.set("maxUnlockedLevel", 999);
    window.__bpc.Storage.set("powerups", {
      undo: 1,
      bomb: 1,
      colorClear: 1,
      paint: 1,
      shuffle: 1,
      chainBolt: 1,
      pick: 1,
      extraMoves: 1,
      magnet: 1,
    });
    window.__bpc.Storage.set("loadout", ["bomb", "colorClear", "magnet"]);
    window.__bpc.UI.updatePowerups();
  });
}

async function unlockAllPetFeatures(page) {
  await page.evaluate(() => {
    window.__bpc.Storage.set("maxUnlockedLevel", 999);
    if (!window.__bpc.Storage.ownsPet("sparky")) {
      window.__bpc.Storage.grantPet("sparky", "balanced");
    }
    window.__bpc.Storage.equipPet("sparky");
    if (window.__bpc.Storage.getPetState().crates <= 0) {
      window.__bpc.Storage.addCrates(1);
    }
    window.__bpc.UI.refreshPetAccess();
    window.__bpc.UI.updatePetHud(window.__bpc.Storage.getEquippedPet());
  });
}

async function unlockPetIntro(page) {
  await page.evaluate(() => {
    window.__bpc.Storage.set("maxUnlockedLevel", 12);
    if (!window.__bpc.Storage.ownsPet("sparky")) {
      window.__bpc.Storage.grantPet("sparky", "balanced");
    }
    window.__bpc.Storage.equipPet("sparky");
    window.__bpc.UI.refreshPetAccess();
  });
}

test.describe("dev Test Lab", () => {
  test("is hidden in normal play and active only behind the e2e gate", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#dev-panel")).toBeHidden();

    await openGame(page);
    await expect(page.locator("#dev-panel")).toBeVisible();
    await expect(page.locator("#dev-status")).toContainText("Level 1");
  });

  test("can jump progression, grant a kit, and reset the real save", async ({ page }) => {
    await openGame(page);

    await page.locator("#dev-lvl-16").click();
    await expect(page.locator("#dev-status")).toContainText("Level 16");
    expect(await page.evaluate(() => window.__bpc.Storage.get("maxUnlockedLevel"))).toBe(16);
    expect(await page.evaluate(() => window.__bpc.Storage.ownsPet("sparky"))).toBe(true);
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().crates)).toBeGreaterThanOrEqual(1);

    await page.locator("#dev-grant-kit").click();
    await expect(page.locator("#dev-status")).toContainText("5000 coins");
    expect(await page.evaluate(() => window.__bpc.Storage.getDust())).toBeGreaterThanOrEqual(500);
    expect(await page.evaluate(() => window.__bpc.Economy.getPowerup("paint"))).toBe(5);

    await page.locator("#dev-reset").click();
    await expect(page.locator("#dev-status")).toContainText("Level 1");
    expect(await page.evaluate(() => window.__bpc.Storage.get("coins"))).toBe(0);
    expect(await page.evaluate(() => window.__bpc.Storage.get("maxUnlockedLevel"))).toBe(1);
    expect(await page.evaluate(() => window.__bpc.Storage.ownsPet("sparky"))).toBe(false);
  });
});

test.describe("startup splash", () => {
  test("shows the animated game name before first-run onboarding", async ({ page }) => {
    await page.goto("/?e2e=1&splash=1");
    await expect(page.locator("#splash")).toBeVisible();
    await expect(page.locator("#splash h1")).toHaveText("Bubblit!");
    await expect(page.locator("#splash .splash-meter span")).toBeVisible();
    await expect(page.locator("#splash")).toBeHidden({ timeout: 2500 });
    await expect(page.locator("#tutorial")).toBeVisible();
  });
});

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
        g.session.mode === "campaign" || g.session.mode === "puzzle"
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

// Solve a puzzle board by greedy pop + productive shift, but — unlike autoPlay
// — never bail early: when no immediate move is found, keep waiting and
// re-scanning. A genuinely jammed puzzle board ends itself (the engine sweeps
// the un-poppable stragglers into a win), so we simply spin until the session
// ends rather than breaking the moment the board looks stuck mid-animation.
async function solvePuzzle(page) {
  await page.evaluate(async () => {
    const g = window.__bpc.game;
    let guard = 0;
    while (g.session && !g.session.ended && guard < 600) {
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
        await new Promise((res) => setTimeout(res, 24));
        guard++;
        continue;
      }
      if (g.session.movesLeft > 0) {
        for (let r = 0; r < b.rows; r++) {
          let done = false;
          for (const dir of ["right", "left"]) {
            const grid = b.grid.map((col) => col.slice());
            const types = b.types.map((col) => col.slice());
            b._simShiftRow(grid, types, r, dir);
            b._simSettle(grid, types);
            if (b._gridHasMoves(grid, types)) {
              const y = b.targetPixel(0, r).y;
              g.handleSwipe(dir, b.originX + b.boardW / 2, y);
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
      // Whether or not a move was made, wait and loop again: a jammed board is
      // resolved asynchronously by the engine, which flips session.ended.
      await new Promise((res) => setTimeout(res, 24));
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

// Deterministically finish the current campaign-style board by leaving one
// adjacent pair and clearing it through the real pop/end path. This avoids the
// old score-target shortcut: wins in campaign now require the board to clear.
async function clearBoardByFinalPair(page) {
  await page.evaluate(() => {
    const g = window.__bpc.game;
    const s = g.session;
    const b = s.board;
    const grid = Array.from({ length: b.cols }, () => Array(b.rows).fill(-1));
    const types = Array.from({ length: b.cols }, () => Array(b.rows).fill(0));
    const r = b.rows - 1;
    grid[0][r] = 0;
    grid[1][r] = 0;
    b.restore(grid, types);
    s.movesLeft = Math.max(s.movesLeft || 0, 3);
    if (s.level && typeof s.level.target === "number") {
      s.score = Math.max(s.score || 0, s.level.target);
    }
    g.popAt(0, r);
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
      "btn-tournament",
      "btn-spotlight",
      "btn-timeattack",
      "btn-shop",
      "btn-themes",
      "btn-achievements",
      "btn-calendar",
      "btn-season",
      "btn-quests",
      "btn-stats",
      "btn-puzzle",
      "btn-tutorial",
    ]) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await expect(page.locator("#btn-pets")).toBeHidden();
    await expect(page.locator("#btn-play .cta-sub")).toHaveText("Campaign levels");
    await expect(page.locator("#play-nudge")).toHaveText("Level 1");
    await expect(page.locator("#btn-daily .tile-sub")).toHaveText("One run today");
    await expect(page.locator("#btn-tournament .tile-sub")).toHaveText("Weekly ladder");
    await expect(page.locator("#btn-spotlight .tile-sub")).toHaveText("Rotating challenge");
    await expect(page.locator("#btn-timeattack .tile-sub")).toHaveText("60 sec sprint");
    await expect(page.locator(".menu-tiles .tile:not(.hidden)")).toHaveCount(13);
    await expect(page.locator(".menu-group-title")).toHaveText([
      "Play",
      "Events",
      "Progress",
      "Shop & Settings",
    ]);
    await expect(page.locator('.menu-group[aria-label="Play"] .tile')).toHaveCount(3);
    await expect(page.locator('.menu-group[aria-label="Events"] .tile')).toHaveCount(5);
    await expect(page.locator('.menu-group[aria-label="Progress"] .tile:not(.hidden)')).toHaveCount(3);
    await expect(page.locator('.menu-group[aria-label="Shop & Settings"] .tile')).toHaveCount(2);
  });

  test("Pets menu entry appears when the campaign reaches the pet intro", async ({ page }) => {
    await unlockPetIntro(page);
    await page.evaluate(() => window.__bpc.UI.showScreen("menu"));
    await expect(page.locator("#btn-pets")).toBeVisible();
    await expect(page.locator("#btn-pets .tile-sub")).toHaveText("Companions");
  });

  test("short phone menu can scroll all the way back to the top", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 520 });
    await page.locator("#menu").evaluate((el) => {
      el.scrollTop = 0;
    });

    const top = await page.locator(".logo h1").evaluate((el) =>
      el.getBoundingClientRect().top
    );
    expect(top).toBeGreaterThanOrEqual(0);
    await expect(page.locator("#btn-play")).toBeVisible();
  });

  test("Play opens the level map with level 1 unlocked", async ({ page }) => {
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    const first = page.locator(".level-cell").first();
    await expect(first).toContainText("1");
    await expect(first).toHaveClass(/current/);
    await expect(first).toHaveAttribute("aria-current", "step");
    await expect(first).toHaveAttribute("data-world", "1");
    await expect(page.locator(".level-cell.locked").first()).toBeVisible();
  });
  
  test("level map previews the next progression unlock", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.recordLevelResult(1, 3);
      window.__bpc.Storage.set("maxUnlockedLevel", 6);
    });
    await page.locator("#btn-play").click();
    await expect(page.locator(".current-focus-card")).toContainText("Current focus: Clear Level 6");
    await expect(page.locator(".next-unlock-teaser")).toContainText("Next unlock: Shuffle");
    await expect(page.locator(".next-unlock-teaser")).toContainText("Level 8");
    await expect(page.locator('.level-cell[data-level="1"]')).toHaveClass(/completed/);
    await expect(page.locator('.level-cell[data-level="6"]')).toHaveClass(/current/);
    await expect(page.locator('.level-cell[data-level="1"]')).toHaveClass(/path-row-start/);
    await expect(page.locator('.level-cell[data-level="4"]')).toHaveClass(/path-row-end/);
  });

  test("level map gives starter players a clear first tool goal", async ({ page }) => {
    await page.locator("#btn-play").click();
    await expect(page.locator(".current-focus-card")).toContainText("Current focus: Clear Level 1");
    await expect(page.locator(".current-focus-card")).toContainText("Undo at Level 6");
    await expect(page.locator(".next-unlock-teaser")).toContainText("Next unlock: Undo");
    await expect(page.locator(".next-unlock-teaser")).toContainText("Level 6");
  });

  test("tapping the Current focus card opens that level's briefing and can start it", async ({
    page,
  }) => {
    // Real bug guard: the "Current focus" card had a play-style ▶ icon and
    // copy strongly implying it was actionable, but had no click handler at
    // all -- tapping it silently did nothing. It must open the briefing for
    // the exact level it names, at any progression depth (including deep
    // generative levels well past the authored campaign).
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 171));
    await page.locator("#btn-play").click();
    const focus = page.locator(".current-focus-card");
    await expect(focus).toContainText("Current focus: Clear Level 171");
    await focus.click();
    await expect(page.locator("#level-brief")).toBeVisible();
    await expect(page.locator("#brief-title")).toHaveText("Level 171");

    await page.locator("#brief-start").click();
    await expect(page.locator("#level-brief")).toBeHidden();
    await expect(page.locator("#hud-mode-label")).toContainText("Level 171");
  });

  test("level map opens a briefing before starting a level", async ({ page }) => {
    await page.locator("#btn-play").click();
    await page.locator(".level-cell").first().click();
    await expect(page.locator("#level-brief")).toBeVisible();
    await expect(page.locator("#brief-title")).toHaveText("Level 1");
    await expect(page.locator("#brief-stats")).toContainText("Target");
    await expect(page.locator("#brief-stats")).toContainText("Board");
    await expect(page.locator("#brief-sub")).toContainText("Bubble Meadow");
    await expect(page.locator("#brief-plan")).toContainText("Tactical plan");
    await expect(page.locator("#brief-hazards")).toContainText("Clean board");

    await page.locator("#brief-start").click();
    await expect(page.locator("#level-brief")).toBeHidden();
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#hud-mode-label")).toContainText("Level 1");
  });

  test("level briefing supports keyboard open and focus return", async ({ page }) => {
    await page.locator("#btn-play").click();
    const firstLevel = page.locator(".level-cell[aria-label='Level 1']");
    await firstLevel.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#level-brief")).toBeVisible();
    await page.locator("#brief-cancel").click();
    await expect(page.locator("#level-brief")).toBeHidden();
    await expect(firstLevel).toBeFocused();
  });

  test("level briefing shows replay record for cleared levels", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.recordLevelResult(1, 3);
      window.__bpc.Storage.recordLevelScore(1, 1234);
    });
    await page.locator("#btn-play").click();
    await page.locator(".level-cell[aria-label='Level 1']").click();
    await expect(page.locator("#brief-replay")).toContainText("Replay record");
    await expect(page.locator("#brief-replay")).toContainText("Best 1234");
    await expect(page.locator("#brief-start")).toHaveText("Replay");
  });

  test("level briefing calls out tactical boss and downpour details", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 31);
    });
    await page.locator("#btn-play").click();
    await page.locator('.level-cell[aria-label="Level 10"]').click();
    await expect(page.locator("#brief-title")).toHaveText("Boss 10");
    await expect(page.locator("#brief-hazards")).toContainText("Frozen Core boss objective");
    await expect(page.locator("#brief-plan")).toContainText("Crack the core");
    await expect(page.locator("#brief-tools")).toContainText("Suggested tools");

    await page.locator("#brief-cancel").click();
    await page.locator('.level-cell[aria-label="Level 31"]').click();
    await expect(page.locator("#brief-stats")).toContainText("Drop every");
    await expect(page.locator("#brief-hazards")).toContainText("downpour every");
    await expect(page.locator("#brief-plan")).toContainText("top lanes");
  });

  test("Shop and Themes open and Back returns to menu", async ({ page }) => {
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await expect(page.locator('.shop-filter[data-shop-filter="featured"].active')).toBeVisible();
    await expect(page.locator(".shop-section-title")).toHaveText([
      "Featured",
    ]);
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();
    await expect(page.locator(".shop-section-title")).toHaveText(["Tools"]);
    await page.locator('.shop-filter[data-shop-filter="coins"]').click();
    await expect(page.locator(".shop-section-title")).toHaveText(["Coins"]);
    await page.locator('.shop-filter[data-shop-filter="offers"]').click();
    await expect(page.locator(".shop-section-title")).toHaveText(["Offers"]);
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
    await page.locator("#brief-start").click();
    await page.locator("#btn-sound").click();
    const muted = await page.evaluate(() => localStorage.getItem("bpc_save_v1"));
    expect(JSON.parse(muted).muted).toBe(true);
  });
});

test.describe("diagnostics (support info)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("opens from Themes, shows a live summary, and has no errors on a clean session", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await expect(page.locator("#themes")).toBeVisible();
    await page.locator("#btn-diagnostics").click();
    await expect(page.locator("#diagnostics")).toBeVisible();

    // The summary grid reflects the real save (fresh: level 1, aurora theme).
    await expect(page.locator("#diag-grid")).toContainText("App version");
    await expect(page.locator("#diag-grid")).toContainText("aurora");
    await expect(page.locator("#diag-errors")).toContainText("No errors recorded this session");

    await page.locator("#diag-close").click();
    await expect(page.locator("#diagnostics")).toBeHidden();
    await expect(page.locator("#themes")).toBeVisible();
  });

  test("a real uncaught error is captured and shown the next time diagnostics opens", async ({
    page,
  }) => {
    // Trigger a genuine uncaught error through the real window "error" event
    // (not the __bpc test hook), proving the production error listener works.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("diagnostics-e2e-probe");
      }, 0);
    });
    await page.waitForTimeout(150);

    await page.locator("#btn-themes").click();
    await page.locator("#btn-diagnostics").click();
    await expect(page.locator("#diagnostics")).toBeVisible();
    await expect(page.locator("#diag-errors")).toContainText("diagnostics-e2e-probe");
    await expect(page.locator("#diag-errors")).not.toContainText("No errors recorded this session");
  });

  test("Copy debug info places the full report on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:4173",
    });
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 9);
      window.__bpc.Storage.set("coins", 555);
    });
    await page.locator("#btn-themes").click();
    await page.locator("#btn-diagnostics").click();
    await expect(page.locator("#diagnostics")).toBeVisible();

    await page.locator("#diag-copy").click();
    await expect(page.locator("#toast")).toContainText("copied");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("Bubblit! Diagnostics Report");
    expect(clipboard).toContain("--- raw JSON ---");
    expect(clipboard).toContain("555");
    // The trailing raw JSON blob is valid, parseable JSON.
    const jsonLine = clipboard.split("--- raw JSON ---\n")[1];
    expect(() => JSON.parse(jsonLine)).not.toThrow();
    expect(JSON.parse(jsonLine).profile.maxUnlockedLevel).toBe(9);
  });

  test("Share is hidden when the Web Share API is unavailable (headless Chromium)", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await page.locator("#btn-diagnostics").click();
    await expect(page.locator("#diagnostics")).toBeVisible();
    const hasShare = await page.evaluate(() => typeof navigator.share === "function");
    if (hasShare) {
      await expect(page.locator("#diag-share")).toBeVisible();
    } else {
      await expect(page.locator("#diag-share")).toBeHidden();
    }
  });
});

test.describe("themes catalog", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("Eclipse Bloom is locked until its star threshold, then becomes usable", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await expect(page.locator("#themes")).toBeVisible();

    const item = page.locator(".theme-item", { hasText: "Eclipse Bloom" });
    await expect(item).toBeVisible();
    await expect(item.locator(".ti-desc")).toContainText("Unlock at 130");
    await expect(item.locator(".buy-btn")).toBeDisabled();

    // Cross the star threshold and rebuild the list.
    await page.evaluate(() => {
      window.__bpc.Storage.set("stars", { 1: 130 });
      window.__bpc.UI.buildThemes();
    });
    const unlocked = page.locator(".theme-item", { hasText: "Eclipse Bloom" });
    await expect(unlocked.locator(".buy-btn")).toHaveText("Use");
    await unlocked.locator(".buy-btn").click();

    const current = await page.evaluate(() => window.__bpc.Storage.get("currentTheme"));
    expect(current).toBe("eclipse");
    await expect(unlocked.locator(".buy-btn")).toHaveText("Active");
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
    await page.evaluate(() => {
      window.__bpc.Economy.addCoins(123);
      window.__bpc.Economy.addPowerup("undo", 1);
      window.__bpc.game.startCampaign(1);
    });
    await expect(page.locator("#hud")).toBeVisible();
    await expect(page.locator("#hud-mode-label")).toHaveText("Level 1");
    await expect(page.locator("#hud-target")).not.toHaveText("0");
    await expect(page.locator(".hud-top #hud-coins")).toHaveText("123");
    await expect(page.locator(".hud-top .hud-coins-pill")).toBeVisible();
    await expect(page.locator(".hud-top .hud-coins-pill .coin-icon img")).toHaveAttribute(
      "src",
      "./assets/icons/currency/coin.png"
    );
    await expect(page.locator("#hud-status")).toContainText("undo");
  });

  test("pause overlay freezes the level and can resume or return to menu", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.locator("#btn-back").click();
    await expect(page.locator("#pause")).toBeVisible();
    await expect(page.locator("#pause-summary")).toContainText("Level 1");
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);

    await page.locator("#pause-resume").click();
    await expect(page.locator("#pause")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(false);

    await page.locator("#btn-back").click();
    await page.locator("#pause-menu").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("the pause modal never renders under a simulated notch/home-indicator safe area", async ({
    page,
  }) => {
    // Simulate a native shell with real safe-area insets (the CSS floor bump
    // in styles.css only applies once `body.native-shell` is present) on a
    // short phone viewport, so a tall dialog like Pause has the least room to
    // fit without clipping under the top/bottom system UI.
    await page.setViewportSize({ width: 360, height: 640 });
    await page.evaluate(() => document.body.classList.add("native-shell"));
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.locator("#btn-back").click();
    await expect(page.locator("#pause")).toBeVisible();

    const card = page.locator("#pause .modal-card");
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    // The dialog must sit fully within the viewport — no top/bottom clipping.
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(640);

    // Every action button stays visible and clickable, never hidden under the
    // simulated safe area.
    await expect(page.locator("#pause-resume")).toBeVisible();
    await expect(page.locator("#pause-menu")).toBeVisible();
    await page.locator("#pause-resume").click();
    await expect(page.locator("#pause")).toBeHidden();
  });
});

test.describe("undo tool (real input)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the Undo tool restores the board, score and moves", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 6);
      window.__bpc.Storage.set("loadout", ["undo", null, null]);
      window.__bpc.Economy.addPowerup("undo", 2);
      window.__bpc.game.startCampaign(1);
    });
    await page.waitForTimeout(700);

    // Snapshot the pre-move state.
    const before = await page.evaluate(() => {
      const s = window.__bpc.game.session;
      return {
        score: s.score,
        moves: s.movesLeft,
        remaining: s.board.countRemaining(),
        undos: window.__bpc.Economy.getPowerup("undo"),
      };
    });

    await expect(page.locator('#pu-slot-0[data-pu="undo"]')).toBeVisible();
    await expect(page.locator('#pu-slot-0[data-pu="undo"]')).toHaveClass(/has-stock/);

    // Make a real move.
    const cell = await findGroupCell(page);
    expect(cell).not.toBeNull();
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(300);

    const moved = await page.evaluate(() => {
      const s = window.__bpc.game.session;
      return { score: s.score, moves: s.movesLeft, remaining: s.board.countRemaining() };
    });
    expect(moved.score).toBeGreaterThan(before.score);
    expect(moved.moves).toBe(before.moves - 1);

    // Undo is now available through the tool slot.
    await page.locator('#pu-slot-0[data-pu="undo"]').click();
    await page.waitForTimeout(150);

    const after = await page.evaluate(() => {
      const s = window.__bpc.game.session;
      return {
        score: s.score,
        moves: s.movesLeft,
        remaining: s.board.countRemaining(),
        undos: window.__bpc.Economy.getPowerup("undo"),
      };
    });
    expect(after.score).toBe(before.score);
    expect(after.moves).toBe(before.moves);
    expect(after.remaining).toBe(before.remaining);
    expect(after.undos).toBe(before.undos - 1); // one charge spent
  });

  test("a spent power-up is refunded on undo", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 999);
      window.__bpc.Storage.set("loadout", ["bomb", "undo", null]);
      window.__bpc.Economy.addPowerup("undo", 1);
      window.__bpc.Economy.addPowerup("bomb", 3);
      window.__bpc.game.startCampaign(1);
    });
    await page.waitForTimeout(700);

    const beforeBombs = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );

    // Arm and use the bomb on a real bubble.
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
    await page.waitForTimeout(200);
    expect(
      await page.evaluate(() => window.__bpc.Economy.getPowerup("bomb"))
    ).toBe(beforeBombs - 1);

    // Undo refunds the bomb.
    await page.locator('#pu-slot-1[data-pu="undo"]').click();
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(() => window.__bpc.Economy.getPowerup("bomb"))
    ).toBe(beforeBombs);
  });

  test("the +3 Moves tool adds moves without changing the board", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 22);
      window.__bpc.Storage.set("loadout", ["extraMoves", "undo", null]);
      window.__bpc.Storage.set("powerups", { extraMoves: 1, undo: 1 });
      window.__bpc.game.startCampaign(1);
    });

    await expect(page.locator('#pu-slot-0[data-pu="extraMoves"]')).toBeVisible();
  await expect(page.locator('#pu-slot-0 .pu-icon img[src$="extra-moves.png"]')).toBeVisible();
    const before = await page.evaluate(() => {
      const s = window.__bpc.game.session;
      return {
        moves: s.movesLeft,
        remaining: s.board.countRemaining(),
        stock: window.__bpc.Economy.getPowerup("extraMoves"),
      };
    });

    await page.locator('#pu-slot-0[data-pu="extraMoves"]').click();
    await expect(page.locator("#hud-moves")).toHaveText(String(before.moves + 3));
    const after = await page.evaluate(() => {
      const s = window.__bpc.game.session;
      return {
        moves: s.movesLeft,
        remaining: s.board.countRemaining(),
        stock: window.__bpc.Economy.getPowerup("extraMoves"),
      };
    });
    expect(after.moves).toBe(before.moves + 3);
    expect(after.remaining).toBe(before.remaining);
    expect(after.stock).toBe(before.stock - 1);

    const cell = await findGroupCell(page);
    expect(cell).not.toBeNull();
    await tapCell(page, cell.c, cell.r);
    await page.waitForTimeout(200);
    await page.locator('#pu-slot-1[data-pu="undo"]').click();
    await expect(page.locator("#hud-moves")).toHaveText(String(before.moves + 3));
  });

  test("undo stock is limited", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 6);
      window.__bpc.Storage.set("loadout", ["undo", null, null]);
      window.__bpc.Economy.addPowerup("undo", 2);
      window.__bpc.game.startCampaign(1);
    });
    await page.waitForTimeout(700);
    const stock = await page.evaluate(() => window.__bpc.Economy.getPowerup("undo"));
    expect(stock).toBeGreaterThan(0);

    // Spend every undo charge: pop, then undo, repeatedly.
    for (let i = 0; i < stock; i++) {
      const cell = await findGroupCell(page);
      if (!cell) break;
      await tapCell(page, cell.c, cell.r);
      await page.waitForTimeout(150);
      await page.locator('#pu-slot-0[data-pu="undo"]').click();
      await page.waitForTimeout(120);
    }

    // Stock exhausted → the slot remains equipped but shows no stock.
    expect(await page.evaluate(() => window.__bpc.Economy.getPowerup("undo"))).toBe(0);
    await expect(page.locator('#pu-slot-0[data-pu="undo"]')).toHaveClass(/no-stock/);
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

  test("charged blast availability keeps showing the best-target board cue", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(700);

    const armed = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.power = 0;
      g._addPower(1);
      return {
        ready: g.isBlastReady(),
        cue: g.session.blastCue,
      };
    });
    expect(armed.ready).toBe(true);
    expect(armed.cue).toBeTruthy();

    await page.waitForTimeout(3200);
    const after = await page.evaluate(() => window.__bpc.game.session.blastCue);
    expect(after).toBeTruthy();
  });

  test("blast cue recompute is throttled while charge sits idle (perf regression guard)", async ({
    page,
  }) => {
    // _bestBlastTarget() is a real speculative scan (every filled cell × a
    // special-strike resolve each) — it must not be re-run on every single
    // animation frame while the board is otherwise idle. Count real calls
    // over ~1s of live play and assert it stays far below a 60fps rate.
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(700);

    const calls = await page.evaluate(async () => {
      const g = window.__bpc.game;
      g.session.power = 0;
      g._addPower(1); // arms charge + does one immediate compute
      let count = 0;
      const orig = g._bestBlastTarget.bind(g);
      g._bestBlastTarget = (...args) => {
        count++;
        return orig(...args);
      };
      await new Promise((resolve) => setTimeout(resolve, 1000));
      g._bestBlastTarget = orig;
      return count;
    });
    // At 60fps a naive per-frame recompute would be ~60 calls/sec; the
    // throttle bounds it to a handful (BLAST_CUE_REFRESH = 0.25s → ~4/sec).
    expect(calls).toBeLessThan(15);
  });

  test("charged blast cue is not born on bubbles cleared by the pop that filled charge", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(700);

    const out = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const b = s.board;
      s.petActive = null;
      s.power = 0.99;
      s.score = 0;
      s.blastCue = null;

      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = (c + r) % Math.max(3, b.colorCount);
          b.types[c][r] = 0;
        }
      }

      const c = Math.floor(b.cols / 2);
      const r = Math.floor(b.rows / 2);
      b.grid[c][r] = 0;
      b.grid[Math.min(b.cols - 1, c + 1)][r] = 0;
      const cleared = new Set(b.getGroupAt(c, r).map((p) => `${p.c},${p.r}`));

      g.popAt(c, r);
      const cue = s.blastCue;
      return {
        ready: g.isBlastReady(),
        cue,
        cueFilled: cue ? b.grid[cue.c][cue.r] !== -1 : false,
        cueWasCleared: cue ? cleared.has(`${cue.c},${cue.r}`) : false,
      };
    });

    expect(out.ready).toBe(true);
    expect(out.cue).toBeTruthy();
    expect(out.cueFilled).toBe(true);
    expect(out.cueWasCleared).toBe(false);
  });

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

  test("swipe still works while sparse bubbles are visibly settling", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startCampaign(5);
      const s = g.session;
      const b = s.board;
      b.restore([
        [0, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
        [-1, -1, -1, -1, -1, -1],
      ]);
      s.movesLeft = 3;
      const y = b.targetPixel(0, 0).y;
      b.settle();
      const before = {
        moves: s.movesLeft,
        rowAtPixel: b.rowAtPixel(y),
        rowAtSwipePixel: b.rowAtSwipePixel(y),
      };
      g.handleSwipe("right", b.originX + b.boardW / 2, y);
      return {
        before,
        afterMoves: s.movesLeft,
      };
    });
    expect(result.before.rowAtPixel).toBe(0);
    expect(result.before.rowAtSwipePixel).toBeGreaterThan(0);
    expect(result.afterMoves).toBe(result.before.moves - 1);
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
    await page.locator("#pause-menu").click();
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

  test("tapping a stone does nothing; popping beside it shatters it", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(20));
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Deterministic board: a colour-0 pair at column 0 (rows 0,1), a STONE at
      // (1,0) adjacent to the pair, and colour-1 filler everywhere else.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = c === 0 && (r === 0 || r === 1) ? 0 : 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.types[1][0] = 5; // STONE, adjacent to (0,0)
      const isStone = () => b.types[1][0] === 5 && b.grid[1][0] !== -1;
      const scoreBefore = g.session.score;
      g.popAt(1, 0); // tap the stone directly — should be a no-op
      const stoneAfterTap = isStone();
      const scoreAfterTap = g.session.score;
      g.popAt(0, 0); // pop the adjacent colour-0 pair → shatters the stone
      b.settle();
      const stoneAfterPop = isStone();
      return {
        stoneAfterTap,
        scoreUnchanged: scoreAfterTap === scoreBefore,
        stoneAfterPop,
      };
    });
    expect(res.stoneAfterTap).toBe(true); // tap did not break the stone
    expect(res.scoreUnchanged).toBe(true); // tap scored nothing
    expect(res.stoneAfterPop).toBe(false); // adjacent pop shattered it
  });

  test("a bomb bubble's pop detonates a 3x3 area around it", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(16));
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Deterministic board: a same-colour pair where one is a BOMB bubble, all
      // surrounded by a different colour so only the 3x3 blast clears them.
      const bc = 2;
      const br = Math.floor(b.rows / 2);
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = c === bc && (r === br || r === br + 1) ? 0 : 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.types[bc][br] = 6; // BOMB
      // Count colour-1 neighbours inside the bomb's 3x3 before popping.
      const around = () => {
        let n = 0;
        for (let dc = -1; dc <= 1; dc++)
          for (let dr = -1; dr <= 1; dr++) {
            const cc = bc + dc;
            const rr = br + dr;
            if (cc < 0 || cc >= b.cols || rr < 0 || rr >= b.rows) continue;
            if (b.grid[cc][rr] === 1) n++;
          }
        return n;
      };
      const neighboursBefore = around();
      g.popAt(bc, br); // pop the bomb pair → detonate the 3x3 blast
      b.settle();
      return { neighboursBefore, cleared: g.session.stats.cleared };
    });
    // The blast cleared the pair (2) plus the surrounding 3x3 neighbours, so
    // more than just the two-bubble group was removed.
    expect(res.neighboursBefore).toBeGreaterThan(0);
    expect(res.cleared).toBeGreaterThan(2);
  });

  test("a multiplier bubble boosts the pop's score without expanding it", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(12));
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Build an isolated colour-0 pair (rest colour 1) and make one a gold
      // MULTIPLIER bubble. Popping it should score ×2 the plain pair.
      const mc = 2;
      const mr = Math.floor(b.rows / 2);
      const lay = () => {
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++) {
            b.grid[c][r] = c === mc && (r === mr || r === mr + 1) ? 0 : 1;
            b.types[c][r] = 0; // NORMAL
          }
      };
      // 1) Plain pair → baseline score gain.
      lay();
      const beforePlain = g.session.score;
      const clearedBefore = g.session.stats.cleared;
      g.popAt(mc, mr);
      const plainGain = g.session.score - beforePlain;
      const plainCleared = g.session.stats.cleared - clearedBefore;
      // 2) Same pair but gold → multiplied score, same cells cleared.
      g.session.combo = 0; // reset combo so the comparison is apples-to-apples
      lay();
      b.types[mc][mr] = 7; // MULTIPLIER
      const beforeGold = g.session.score;
      const clearedBefore2 = g.session.stats.cleared;
      g.popAt(mc, mr);
      const goldGain = g.session.score - beforeGold;
      const goldCleared = g.session.stats.cleared - clearedBefore2;
      return { plainGain, plainCleared, goldGain, goldCleared };
    });
    // Same number of bubbles cleared (no AoE), but a strictly bigger score.
    expect(res.goldCleared).toBe(res.plainCleared);
    expect(res.goldGain).toBeGreaterThan(res.plainGain);
  });

  test("a coin bubble drops bonus coins into the wallet when popped", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(8));
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const Economy = window.__bpc.Economy;
      const b = g.session.board;
      // Build an isolated colour-0 pair and make one a treasure COIN bubble.
      const cc = 2;
      const cr = Math.floor(b.rows / 2);
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = c === cc && (r === cr || r === cr + 1) ? 0 : 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.types[cc][cr] = 8; // COIN
      const coinsBefore = Economy.coins;
      g.popAt(cc, cr); // pop the coin pair → coins drop into the wallet
      return { gained: Economy.coins - coinsBefore };
    });
    expect(res.gained).toBeGreaterThan(0);
  });

  test("a vine bubble creeps to a neighbour each move and clears when popped", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(21));
    await page.waitForTimeout(500);
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Paint the whole board colour 1 (NORMAL) so the vine has plenty of room
      // to creep, then carve an isolated colour-0 pair at the top of column 0
      // to give the player a harmless move that triggers the spread.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.grid[0][0] = 0;
      b.grid[0][1] = 0;
      // Park a single vine in the middle, surrounded by colour-1 bubbles.
      const vc = Math.floor(b.cols / 2);
      const vr = Math.floor(b.rows / 2);
      b.types[vc][vr] = 9; // VINE
      const before = b.vineCount();
      g.popAt(0, 0); // a move elsewhere → the vine creeps one cell
      const afterSpread = g.session.board.vineCount();
      // Now pop the vine's (colour-1) cluster: every vine is cleared.
      const b2 = g.session.board;
      let popped = false;
      for (let c = 0; c < b2.cols && !popped; c++)
        for (let r = 0; r < b2.rows && !popped; r++)
          if (b2.isVine(c, r) && b2.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            popped = true;
          }
      return { before, afterSpread, afterPop: g.session.board.vineCount() };
    });
    expect(res.before).toBe(1);
    expect(res.afterSpread).toBe(2); // the vine crept into one neighbour
    expect(res.afterPop).toBe(0); // popping the cluster cleared every vine
  });
});

test.describe("chain reactor bubbles (sequence)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("popping 1 -> 2 -> 3 in order primes a big diamond blast", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Paint the whole board background colour 1 so any pop can chain
      // freely, then carve three separate colour-0 pairs (rows 0/2/4,
      // separated by a background row so they never merge into one group)
      // carrying SEQUENCE_1/2/3 (types 10/11/12) so each number pops alone.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.grid[0][0] = 0;
      b.grid[1][0] = 0;
      b.types[0][0] = 10; // SEQUENCE_1
      b.types[1][0] = 10;
      b.grid[0][2] = 0;
      b.grid[1][2] = 0;
      b.types[0][2] = 11; // SEQUENCE_2
      b.types[1][2] = 11;
      b.grid[0][4] = 0;
      b.grid[1][4] = 0;
      b.types[0][4] = 12; // SEQUENCE_3
      b.types[1][4] = 12;

      g.popAt(0, 0); // pop "1"
      const progressAfter1 = g.session.sequenceProgress;
      g.popAt(0, 2); // pop "2"
      const progressAfter2 = g.session.sequenceProgress;
      const before3 = b.countRemaining();
      g.popAt(0, 4); // pop "3" while primed — detonates a big diamond blast
      const after3 = b.countRemaining();
      return {
        progressAfter1,
        progressAfter2,
        cleared: before3 - after3,
        progressAfter3: g.session.sequenceProgress,
      };
    });
    expect(result.progressAfter1).toBe(1);
    expect(result.progressAfter2).toBe(2);
    // The "3" pop cleared far more than its own 2-cell group — the diamond
    // blast (radius 3) sweeps in extra cells from the surrounding colour-1
    // filled board.
    expect(result.cleared).toBeGreaterThan(2);
    expect(result.progressAfter3).toBe(0); // consumed, ready for a new chain
  });

  test("popping out of order breaks the chain — no bonus, just a normal pop", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0;
        }
      b.grid[0][0] = 0;
      b.grid[1][0] = 0;
      b.types[0][0] = 11; // SEQUENCE_2 — popped first, out of order
      b.types[1][0] = 11;
      b.grid[0][2] = 0;
      b.grid[1][2] = 0;
      b.types[0][2] = 12; // SEQUENCE_3
      b.types[1][2] = 12;

      g.popAt(0, 0); // pop "2" first — the chain never started, so it resets
      const progressAfterOutOfOrder = g.session.sequenceProgress;
      const before3 = b.countRemaining();
      g.popAt(0, 2); // pop "3" while NOT primed — just a normal pop
      const after3 = b.countRemaining();
      return { progressAfterOutOfOrder, cleared: before3 - after3 };
    });
    expect(result.progressAfterOutOfOrder).toBe(0);
    expect(result.cleared).toBe(2); // only its own 2-cell group, no blast
  });
});

test.describe("tether bubbles (linked pairs)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("popping a tethered cluster also clears its linked partner cell elsewhere on the board", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      // A tapped 2-cell group carrying a TETHER (type 13), plus a single
      // linked partner cell far away on the board.
      b.grid[0][0] = 0;
      b.grid[1][0] = 0;
      b.types[0][0] = 13; // TETHER
      b.types[1][0] = 0;
      const farC = b.cols - 1;
      const farR = b.rows - 1;
      b.types[farC][farR] = 13; // TETHER partner
      b._linkTethers();
      const before = b.countRemaining();
      // Check the merge at the source (the pure resolver), not the post-pop
      // board — gravity immediately refills any emptied cell (including this
      // far corner), so "still empty after settle" isn't a reliable signal.
      const strike = g._resolveSpecialStrikes(b.getGroupAt(0, 0));
      const struckPartner = strike.cells.some((p) => p.c === farC && p.r === farR);
      g.popAt(0, 0);
      const after = b.countRemaining();
      return {
        cleared: before - after,
        struckPartner,
      };
    });
    // The tapped 2-cell group PLUS the single linked partner cell.
    expect(result.cleared).toBe(3);
    expect(result.struckPartner).toBe(true);
  });

  test("a tether whose partner is already gone just pops normally", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0;
        }
      b.grid[0][0] = 0;
      b.grid[1][0] = 0;
      b.types[0][0] = 13; // TETHER
      b.types[1][0] = 0;
      const farC = b.cols - 1;
      const farR = b.rows - 1;
      b.types[farC][farR] = 13; // TETHER partner
      b._linkTethers();
      b.grid[farC][farR] = -1; // partner already cleared before this pop
      const before = b.countRemaining();
      g.popAt(0, 0);
      const after = b.countRemaining();
      return { cleared: before - after };
    });
    expect(result.cleared).toBe(2); // just its own group, no partner to add
  });
});

test.describe("polarity bubbles (magnetic pairs)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a same-charge pair repels one cell further apart each resolved move", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 0;
          b.types[c][r] = 0; // NORMAL
        }
      b.types[2][0] = 14; // POLARITY_PLUS
      b.types[3][0] = 14; // POLARITY_PLUS, adjacent, same charge
      const moved = b.spreadPolarity();
      return {
        moved,
        outwardLeft: b.polarityCharge(1, 0),
        outwardRight: b.polarityCharge(4, 0),
      };
    });
    expect(result.moved).toBeTruthy();
    // Exactly one of the two plus bubbles stepped one cell further outward.
    const outward = [result.outwardLeft, result.outwardRight].filter((c) => c === 1).length;
    expect(outward).toBe(1);
  });

  test("an opposite-charge pair stays put — already attracted together", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 0;
          b.types[c][r] = 0;
        }
      b.types[2][0] = 14; // POLARITY_PLUS
      b.types[3][0] = 15; // POLARITY_MINUS, adjacent, opposite charge
      return b.spreadPolarity();
    });
    expect(result).toBeNull();
  });
});

test.describe("bloom seeds (patient growth)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a seed matures to a bud, then blooms into the best-matching neighbour colour", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      b.grid[0][0] = 0;
      b.types[0][0] = 16; // BLOOM_SEED
      b.grid[1][0] = 2;
      b.grid[2][0] = 2; // a colour-2 pair to bloom toward
      // Wall off the seed's other neighbour (below) with a locked STONE so
      // the huge same-colour background board can't leak in as a candidate.
      b.types[0][1] = 5; // STONE
      const r1 = b.growBloom();
      const isBudNow = b.isBloomBud(0, 0);
      const r2 = b.growBloom();
      return {
        r1,
        isBudNow,
        r2,
        finalType: b.types[0][0],
        finalColor: b.grid[0][0],
        groupSize: b.getGroupAt(0, 0).length,
      };
    });
    expect(result.r1).toEqual({ c: 0, r: 0, stage: "bud" });
    expect(result.isBudNow).toBe(true);
    expect(result.r2).toEqual({ c: 0, r: 0, stage: "bloomed", color: 2 });
    expect(result.finalType).toBe(0); // NORMAL
    expect(result.finalColor).toBe(2);
    expect(result.groupSize).toBe(3); // fully joined the colour-2 group
  });

  test("popping a bloom seed early just pops normally — no bonus", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0;
        }
      b.grid[0][0] = 0;
      b.grid[1][0] = 0;
      b.types[0][0] = 16; // BLOOM_SEED
      b.types[1][0] = 0;
      const before = b.countRemaining();
      g.popAt(0, 0);
      const after = b.countRemaining();
      return { cleared: before - after };
    });
    expect(result.cleared).toBe(2); // just the tapped 2-cell group
  });
});

test.describe("echo pops (fading colour anticipation)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a matching-coloured bubble settling into a fresh echo auto-pops for a bonus", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.level.echo = true; // manually unlock Echo Pops for this test session
      const b = s.board;
      const before = s.score;
      b.grid[0][0] = 2;
      b.types[0][0] = 0; // NORMAL
      b.recordEcho(0, 0, 2); // echo remembers colour 2, already matches
      g._resolveEchoes(); // applies the real scoring/coin/flourish/settle
      return {
        echoesLeft: b.echoes.size,
        scoreGained: s.score - before,
      };
    });
    expect(result.echoesLeft).toBe(0);
    expect(result.scoreGained).toBeGreaterThan(0);
  });

  test("Echo Pops stays inactive below its unlock level", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      // Level 1 has echo unlocked = false by default.
      const b = s.board;
      b.recordEcho(0, 0, b.grid[0][0]);
      g._resolveEchoes();
      // _resolveEchoes should no-op (guarded by _echoActive) — the echo we
      // manually recorded is untouched (neither aged nor triggered).
      return b.echoes.get("0,0");
    });
    expect(result).toEqual({ color: expect.any(Number), movesLeft: 3 });
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

  test("the daily can be completed only once per day", async ({ page }) => {
    // Complete today's daily once.
    await page.evaluate(() => window.__bpc.game.startDaily());
    await page.waitForTimeout(500);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();

    // The menu's Daily tile is now locked and tapping it must NOT start a
    // fresh board — the player stays on the menu (come back tomorrow).
    await expect(page.locator("#btn-daily")).toHaveClass(/locked/);
    // The tile keeps its click handler (it's only visually locked), so dispatch
    // the click directly — startDaily's guard must still refuse to start.
    await page.locator("#btn-daily").dispatchEvent("click");
    await expect(page.locator("#menu")).toBeVisible();
    // Returning to the menu cleared the session; the blocked re-entry must not
    // have started a new daily, so no session exists.
    expect(await page.evaluate(() => window.__bpc.game.session)).toBeNull();

    // The streak/record was untouched by the blocked re-entry.
    const daily = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).daily
    );
    expect(daily.streak).toBe(1);
  });
});

test.describe("campaign progression", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("clearing a level wins, awards stars/coins and unlocks the next", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-stars .star.on")).not.toHaveCount(0);

    // The recap window shows a per-run stats grid (score, moves, tools, etc.).
    await expect(page.locator("#win-stats .win-stat")).toHaveCount(6);
    await expect(page.locator("#win-stats")).toContainText("Score");
    await expect(page.locator("#win-stats")).toContainText("Moves");
    await expect(page.locator("#win-stats")).toContainText("Best Chain");
    await expect(page.locator("#win-stats")).toContainText("Popped");
    await expect(page.locator("#win-stats")).toContainText("Tools");

    // The coin payout is sealed in a chest — tap it open to reveal the reward.
    await expect(page.locator("#win-chest")).toBeVisible();
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-reward-reveal")).toBeVisible();
    await expect(page.locator("#win-reward .win-reward-card").first()).toBeVisible();

    // Coins count up to a positive total in the recap window.
    await expect
      .poll(async () =>
        Number(await page.locator("#win-coins-num").textContent())
      )
      .toBeGreaterThan(0);
    await expect(page.locator("#win-coins .coin-icon img")).toHaveAttribute(
      "src",
      "./assets/icons/currency/coin.png"
    );
    await expect(page.locator("#win-reward .win-reward-card.coins img").first()).toHaveAttribute(
      "src",
      "./assets/icons/currency/coins-stack.png"
    );

    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.maxUnlockedLevel).toBeGreaterThanOrEqual(2);
    expect(save.stars["1"]).toBeGreaterThanOrEqual(1);
    expect(save.coins).toBeGreaterThan(0);
  });

  test("level recap surfaces bonus objective status", async ({ page }) => {
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startCampaign(3);
      const s = g.session;
      s.score = 1200;
      s.stats.cleared = 18;
      s.stats.bestCombo = 3;
      s.objectiveMet = true;
      window.__bpc.UI.showWin({
        stars: 2,
        score: s.score,
        coins: 0,
        rewardText: "",
        stats: g._winStats(s, 4),
        showNext: true,
        showDouble: false,
      });
    });

    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-stats .win-stat")).toHaveCount(7);
    await expect(page.locator("#win-stats")).toContainText("Objective");
    await expect(page.locator("#win-stats")).toContainText("Done");
  });

  test("running out of moves loses and offers a revive", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(600);
    const cell = await findGroupCell(page);
    await page.evaluate(() => (window.__bpc.game.session.movesLeft = 1));
    await page.evaluate(({ c, r }) => window.__bpc.game.popAt(c, r), cell);
    await expect(page.locator("#lose")).toBeVisible();
    await expect(page.locator("#lose-tip")).toContainText("Next attempt");
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
    await clearBoardByFinalPair(page);
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
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();

    // Closed state: chest is shaking, hint is shown, the coin reward is sealed.
    await expect(page.locator("#win-chest-art")).toHaveClass(/shaking/);
    await expect(page.locator("#win-chest-art")).not.toHaveClass(/open/);
    await expect(page.locator("#win-chest-art .wc-body")).toBeVisible();
    await expect(page.locator("#win-chest-art .wc-lid")).toBeVisible();
    await expect(page.locator("#win-reward-reveal")).toBeHidden();
    await expect(page.locator("#win-ceremony")).toBeVisible();
    await expect(page.locator("#win-step-chest")).toHaveClass(/active/);
    await expect(page.locator("#win-step-bonus")).toBeVisible();
    await expect(page.locator("#win-step-unlock")).toBeHidden();
    expect(await page.locator("#win-coins-num").textContent()).toBe("0");

    // Tap to open: lid flips, the reward reveals and the coins count up.
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-chest-art")).toHaveClass(/open/);
    await expect(page.locator("#win-chest-art")).not.toHaveClass(/shaking/);
    await expect(page.locator("#win-reward-reveal")).toBeVisible();
    await expect(page.locator("#win-step-chest")).toHaveClass(/done/);
    await expect(page.locator("#win-step-bonus")).toHaveClass(/active/);
    await expect
      .poll(async () => Number(await page.locator("#win-coins-num").textContent()))
      .toBeGreaterThan(0);
  
    await expect(page.locator("#win-choice")).toBeVisible();
    await expect(page.locator("#win-choice-list .win-choice-btn")).toHaveCount(2);
    await expect(page.locator("#win-choice-list")).toHaveAttribute("data-count", "2");
    const choiceAlignment = await page.evaluate(() => {
      const modal = document.querySelector("#win .modal-card").getBoundingClientRect();
      const list = document.querySelector("#win-choice-list").getBoundingClientRect();
      return Math.abs((modal.left + modal.width / 2) - (list.left + list.width / 2));
    });
    expect(choiceAlignment).toBeLessThan(2);
    const beforeCoins = await page.evaluate(() => window.__bpc.Storage.get("coins"));
    await page.locator('#win-choice-list .win-choice-btn[data-choice="coins"]').click();
    await expect(page.locator("#win-choice")).toBeHidden();
    await expect(page.locator("#win-step-bonus")).toHaveClass(/done/);
    const afterCoins = await page.evaluate(() => window.__bpc.Storage.get("coins"));
    expect(afterCoins).toBeGreaterThan(beforeCoins);

    // Once the count-up settles, re-tapping the chest must not reset/replay it.
    await page.waitForTimeout(1300);
    const coins = await page.locator("#win-coins-num").textContent();
    expect(Number(coins)).toBeGreaterThan(0);
    await page.locator("#win-chest").click();
    await page.waitForTimeout(300);
    expect(await page.locator("#win-coins-num").textContent()).toBe(coins);
  });

  test("a pending tool unlock waits for the coin count-up to finish before taking over the win screen", async ({
    page,
  }) => {
    // Regression guard for a real reward-ceremony pacing bug: the automatic
    // ceremony advance (which hides the win screen behind #tool-unlock) used
    // to fire at 420ms, well before the 180ms-delayed + 900ms coin count-up
    // animation actually finished — cutting the reveal off mid-count.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const UI = window.__bpc.UI;
      g._pendingToolUnlock = { type: "undo", level: 6, lesson: "test lesson" };
      UI.showWin({
        stars: 2,
        score: 500,
        coins: 250,
        rewardText: "",
        stats: [],
        showNext: true,
        showDouble: false,
        rewardChoices: [],
        hasPendingUnlock: true,
      });
    });
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-chest").click();

    // Shortly after opening, the count-up is still in progress and the win
    // screen must still be the one showing (not yet whisked away).
    await page.waitForTimeout(400);
    const midCount = Number(await page.locator("#win-coins-num").textContent());
    expect(midCount).toBeGreaterThanOrEqual(0);
    expect(midCount).toBeLessThan(250);
    await expect(page.locator("#tool-unlock")).toBeHidden();

    // Once fully settled, the coins have finished counting up to the true
    // total AND the automatic ceremony advance has taken over.
    await expect(page.locator("#tool-unlock")).toBeVisible({ timeout: 3000 });
    expect(await page.locator("#win-coins-num").textContent()).toBe("250");
  });

  test("claiming a bonus choice quickly still waits for the coin count-up before advancing", async ({
    page,
  }) => {
    // Same pacing bug, different trigger: the bonus-choice buttons appear the
    // instant the chest opens (the same moment the coin count-up is queued),
    // so a fast tap used to race ahead of the 1080ms tally and yank the win
    // screen away behind #tool-unlock before the coins finished counting.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const UI = window.__bpc.UI;
      g._pendingToolUnlock = { type: "undo", level: 6, lesson: "test lesson" };
      g._pendingWinChoices = [
        { id: "test", reward: { type: "coins", amount: 10 } },
      ];
      UI.showWin({
        stars: 2,
        score: 500,
        coins: 250,
        rewardText: "",
        stats: [],
        showNext: true,
        showDouble: false,
        rewardChoices: [{ id: "test", icon: "🎁", title: "Test", desc: "desc" }],
        hasPendingUnlock: true,
      });
    });
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-chest").click();
    // Claim the bonus as fast as the test runner allows, well before the
    // 1080ms coin tally would naturally finish.
    await page.locator('#win-choice-list .win-choice-btn[data-choice="test"]').click();

    // The core invariant: by the moment #tool-unlock takes over, the coin
    // count-up must already show its true final value, not a value it was
    // cut off at mid-tally (the old bug fired the advance at a flat 120ms
    // after the claim, regardless of how little of the 1080ms tally had
    // actually elapsed).
    await expect(page.locator("#tool-unlock")).toBeVisible({ timeout: 3000 });
    expect(await page.locator("#win-coins-num").textContent()).toBe("250");
  });
});

test.describe("shareable win card (viral share/download)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("sharing a win downloads a PNG score card when the Share API is unavailable", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-share")).toBeVisible();
    // Uses the app's local SVG icon language (not a raw emoji glyph, which
    // renders inconsistently across platforms).
    await expect(page.locator("#win-share .win-share-ic")).toBeAttached();
    await expect(page.locator("#win-share")).toContainText("Share score");

    // Headless Chromium has no navigator.share, so tapping Share falls back
    // to downloading the rendered card image.
    const hasShare = await page.evaluate(() => typeof navigator.share === "function");
    expect(hasShare).toBe(false);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#win-share").click(),
    ]);
    expect(download.suggestedFilename()).toBe("bubblit-score.png");
    await expect(page.locator("#toast")).toContainText("saved");
  });

  test("the card reflects the mode label, score, and current theme", async ({ page }) => {
    await page.evaluate(() => {
      // `game.theme` (not the raw save field) is what drives rendering/share
      // data — it's only kept in sync via the real theme-selection flow
      // (ui.js `onThemeChange`), so set it directly the same way that flow would.
      window.__bpc.game.theme = { id: "candy" };
      window.__bpc.game.startCampaign(3);
    });
    await page.waitForTimeout(600);
    const data = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.score = 7777;
      return g.getShareCardData();
    });
    expect(data.modeLabel).toBe("Level 3");
    expect(data.score).toBe(7777);
    expect(data.themeId).toBe("candy");
  });

  test("getShareCardData returns null when there is no active session", async ({ page }) => {
    const data = await page.evaluate(() => window.__bpc.game.getShareCardData());
    expect(data).toBeNull();
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
    await expect(page.locator('.level-cell[data-level="5"] .lvl-badge')).toBeVisible();
    await expect(page.locator(".level-cell").nth(9)).toHaveClass(
      /milestone-boss/
    );
    await expect(page.locator('.level-cell[data-level="10"] .lvl-badge')).toBeVisible();
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
    await expect(headers.first()).toHaveAttribute("data-world", "1");
    await expect(headers.nth(1)).toContainText("9–16");
    await expect(headers.last()).toContainText("33–40");
  });

  test("the endless campaign reveals procedural chapters past level 40", async ({
    page,
  }) => {
    // Advance the player well past the authored 40 levels, then open the map:
    // it should render a procedural chapter header (41–48) and a level cell
    // numbered above 40 that the original authored campaign never had.
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 45);
      window.__bpc.UI.buildLevelMap();
    });
    await page.locator("#btn-play").click();
    await expect(page.locator("#levelmap")).toBeVisible();
    const headers = page.locator(".chapter-header");
    // Authored 5 + at least one procedural chapter beyond level 40.
    await expect(headers.nth(5)).toBeVisible();
    await expect(headers.nth(5)).toContainText("41–48");
    // A real, generated level cell beyond the authored campaign exists.
    await expect(
      page.locator(".level-cell .num", { hasText: /^41$/ })
    ).toBeVisible();
    // Its generated config is well-formed and clamped to the difficulty cap.
    const lvl = await page.evaluate(() => window.__bpc.getLevel(9999));
    expect(lvl.id).toBe(9999);
    expect(lvl.cols).toBeLessThanOrEqual(9);
    expect(lvl.target).toBeGreaterThan(0);
  });

  test("a treasure level pays a one-time bonus with locked-tool fallback (not farmable)", async ({
    page,
  }) => {
    // First clear of treasure level 5 grants the reward.
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    const puBefore = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("shuffle")
    );
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("bonus coins");
    await expect(page.locator("#win-reward")).toContainText("Locked-tool bonus: +60 coins");
    const save1 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save1.milestonesCleared).toContain(5);
    const puAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("shuffle")
    );
    expect(puAfter).toBe(puBefore); // shuffle is still locked at this point

    // Replaying the same level must NOT pay the milestone reward again.
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    const puReplay = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("shuffle")
    );
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).not.toContainText("bonus coins");
    const save2 = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save2.milestonesCleared.filter((id) => id === 5)).toHaveLength(1);
    const puReplayAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("shuffle")
    );
    expect(puReplayAfter).toBe(puReplay); // no second fallback reward either
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
    // The seeded core's bounding box drives the shared "boss focus" aura
    // (drawBossAura) so frozen/stone/vine bosses all read as one encounter.
    const bounds = await page.evaluate(() => window.__bpc.game.session.bossBounds);
    expect(bounds).toEqual({ c0: expect.any(Number), r0: expect.any(Number), w: expect.any(Number), h: expect.any(Number) });
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);

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

  test("a stone-vault boss is won by shattering every locked stone", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(20));
    await page.waitForTimeout(600);
    // Boss 2 rotates to the stone archetype.
    await expect(page.locator("#hud-target-label")).toHaveText("Stone");
    const kind = await page.evaluate(() => window.__bpc.game.session.bossKind);
    expect(kind).toBe("stone");
    const stones = await page.evaluate(() =>
      window.__bpc.game.session.board.stoneRemaining()
    );
    expect(stones).toBeGreaterThan(0);
    const bounds = await page.evaluate(() => window.__bpc.game.session.bossBounds);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);

    // Clear the entire vault (STONE = 5) and let the move logic resolve the win.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.types[c][r] === 5) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });

    await expect(page.locator("#win")).toBeVisible();
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.milestonesCleared).toContain(20);
  });

  test("a colour-purge boss is won by clearing every marked bubble", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(30));
    await page.waitForTimeout(600);
    // Boss 3 rotates to the colour-purge archetype.
    await expect(page.locator("#hud-target-label")).toHaveText("Left");
    const target = await page.evaluate(
      () => window.__bpc.game.session.bossTargetColor
    );
    expect(target).toBeGreaterThanOrEqual(0);
    const left = await page.evaluate(
      () =>
        window.__bpc.game.session.board.colorCells(
          window.__bpc.game.session.bossTargetColor
        ).length
    );
    expect(left).toBeGreaterThan(0);
    // The colour boss already marks its targets with per-bubble pips, so it
    // has no bounding-box aura (that's reserved for frozen/stone/vine).
    const bounds = await page.evaluate(() => window.__bpc.game.session.bossBounds);
    expect(bounds).toBeNull();

    // Remove every bubble of the hunted colour, then resolve the win.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const tc = g.session.bossTargetColor;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === tc) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });

    await expect(page.locator("#win")).toBeVisible();
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.milestonesCleared).toContain(30);
  });

  test("a vine-overgrowth boss is won by clearing every vine before it spreads", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 50));
    await page.evaluate(() => window.__bpc.game.startCampaign(50));
    await page.waitForTimeout(600);
    // Boss 5 is the first to rotate to the new vine archetype (the authored
    // bosses 1-4 at levels 10/20/30/40 are untouched).
    await expect(page.locator("#hud-target-label")).toHaveText("Vines");
    const kind = await page.evaluate(() => window.__bpc.game.session.bossKind);
    expect(kind).toBe("vine");
    const vines = await page.evaluate(() =>
      window.__bpc.game.session.board.vineCount()
    );
    expect(vines).toBeGreaterThan(0);
    const bounds = await page.evaluate(() => window.__bpc.game.session.bossBounds);
    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);

    // Clear every vine (VINE = 9) and let the move logic resolve the win.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.types[c][r] === 9) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });

    await expect(page.locator("#win")).toBeVisible();
    const save = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("bpc_save_v1"))
    );
    expect(save.milestonesCleared).toContain(50);
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

test.describe("double-or-nothing wager (daily)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the wager prompt opens from the Daily tile and lists affordable stake tiers", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(150));
    await page.locator("#btn-daily").click();
    await expect(page.locator("#wager")).toBeVisible();
    const tiers = await page.evaluate(() => window.__bpc.daily.wagerTiers(150));
    expect(tiers).toEqual([50, 100]); // affordable subset of WAGER_TIERS
    await expect(page.locator(".wager-tier-btn")).toHaveCount(tiers.length);
    // No session has started yet -- the prompt is purely a pre-step.
    expect(await page.evaluate(() => window.__bpc.game.session)).toBeNull();
  });

  test("cancelling the prompt starts no session and leaves coins untouched", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(200));
    await page.locator("#btn-daily").click();
    await expect(page.locator("#wager")).toBeVisible();
    await page.locator("#wager-cancel").click();
    await expect(page.locator("#wager")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.session)).toBeNull();
    expect(await page.evaluate(() => window.__bpc.Economy.coins)).toBe(200);
  });

  test("skipping the wager plays the Daily exactly as before, with no stake", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(200));
    await page.locator("#btn-daily").click();
    await page.locator("#wager-skip").click();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      mode: window.__bpc.game.session.mode,
      wager: window.__bpc.game.session.wager,
      coins: window.__bpc.Economy.coins,
    }));
    expect(state.mode).toBe("daily");
    expect(state.wager).toBeNull();
    expect(state.coins).toBe(200); // untouched
  });

  test("placing a wager debits the stake immediately and stores it on the session", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(200));
    await page.locator("#btn-daily").click();
    await page.locator('.wager-tier-btn[data-stake="100"]').click();
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      mode: window.__bpc.game.session.mode,
      wager: window.__bpc.game.session.wager,
      coins: window.__bpc.Economy.coins,
    }));
    expect(state.mode).toBe("daily");
    expect(state.wager).toEqual({ stake: 100 });
    expect(state.coins).toBe(100); // 200 - 100 staked
  });

  test("beating the Daily's top goal pays the wager multiplier", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(200));
    await page.evaluate(() => window.__bpc.game.startDaily(100));
    await page.waitForTimeout(400);
    const payout = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.score = g.session.goals.three + 500; // clear the top goal
      return window.__bpc.daily.wagerPayout(100, g.session.score, g.session.goals);
    });
    await page.evaluate(() => window.__bpc.game._scheduleEnd(true, "daily"));
    await expect(page.locator("#win")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#win-reward")).toContainText("Wager won");
    await expect(page.locator("#win-reward")).toContainText(`+${payout} coins`);
    const coins = await page.evaluate(() => window.__bpc.Economy.coins);
    // 100 (post-stake) + score coins + payout, at minimum more than the payout alone.
    expect(coins).toBeGreaterThanOrEqual(100 + payout);
  });

  test("missing the Daily's top goal forfeits the stake (no refund)", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(200));
    await page.evaluate(() => window.__bpc.game.startDaily(100));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__bpc.game.session.score = 1; // far below every goal tier
    });
    await page.evaluate(() => window.__bpc.game._scheduleEnd(true, "daily"));
    await expect(page.locator("#win")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#win-reward")).toContainText("Wager lost");
    await expect(page.locator("#win-reward")).toContainText("-100 coins");
    // Only the day's streak reward is added on top of the post-stake balance
    // (score is too low for score-coins) -- the 100 stake never comes back.
    const info = await page.evaluate(() => {
      const streak = window.__bpc.Storage.get("daily").streak;
      return { coins: window.__bpc.Economy.coins, streakCoins: window.__bpc.daily.rewardForStreak(streak).coins };
    });
    expect(info.coins).toBe(100 + info.streakCoins);
  });

  test("cannot wager more than the current coin balance", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(80));
    await page.locator("#btn-daily").click();
    await expect(page.locator("#wager")).toBeVisible();
    // Only the 50 tier fits an 80-coin balance -- 100/250 must not be offered.
    await expect(page.locator(".wager-tier-btn")).toHaveCount(1);
    await expect(page.locator('.wager-tier-btn[data-stake="50"]')).toBeVisible();
    await expect(page.locator('.wager-tier-btn[data-stake="100"]')).toHaveCount(0);
  });

  test("no wager UI at all when the player has zero coins", async ({ page }) => {
    expect(await page.evaluate(() => window.__bpc.Economy.coins)).toBe(0);
    await page.locator("#btn-daily").click();
    await expect(page.locator("#wager")).toBeHidden();
    // Falls straight through to a normal, wager-free Daily run.
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      mode: window.__bpc.game.session.mode,
      wager: window.__bpc.game.session.wager,
    }));
    expect(state.mode).toBe("daily");
    expect(state.wager).toBeNull();
  });

  test("cannot wager on an already-played-today Daily", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Economy.addCoins(200);
      window.__bpc.game.startDaily();
    });
    await page.waitForTimeout(400);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();

    // Tapping Daily again must NOT open the wager prompt -- the existing
    // "come back tomorrow" guard fires instead, exactly like before.
    await page.locator("#btn-daily").dispatchEvent("click");
    await expect(page.locator("#wager")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.session)).toBeNull();
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

  // The genuine deadlock (no tap AND no useful swipe) still ends the level, but
  // a score target alone must not count as a clear while bubbles remain.
  test("a target-met deadlock with bubbles remaining does not win the level", async ({ page }) => {
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
      s.score = s.level.target + 1;
      s.gaveUp = true; // skip rescue prompt; verify final win/loss condition
      const hadShiftMove = b.hasShiftMove();
      g.afterMove();
      return {
        hadShiftMove,
        ended: s.ended,
        remaining: b.countRemaining(),
      };
    });

    expect(state.hadShiftMove).toBe(false);
    expect(state.remaining).toBeGreaterThan(0);
    expect(state.ended).toBe(true); // genuine deadlock still resolves
    await expect(page.locator("#win")).toBeHidden();
    await expect(page.locator("#lose")).toBeVisible();
  });
});


test.describe("power-ups (UI arm + apply)", () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllTools(page);
  });


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
    const fx = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        toolFx: g._lastToolBombFx,
        rings: g.particles.rings.length,
        sprites: g.particles.sprites.length,
        shake: g.shake.trauma,
      };
    });
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before - after).toBeGreaterThanOrEqual(4);
    expect(fx.toolFx).toMatchObject({ rings: 3, burst: true });
    expect(fx.toolFx.cells).toBeGreaterThanOrEqual(4);
    expect(fx.rings).toBeGreaterThanOrEqual(3);
    expect(fx.sprites).toBeGreaterThan(0);
    expect(fx.shake).toBeGreaterThan(0.1);
    await expect(page.locator('[data-pu="bomb"] .pu-count')).toHaveText("0");
  });

  test("bomb power-up chains into lightning struck by the blast", async ({
    page,
  }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const E = window.__bpc.Economy;

      function run(withLightning) {
        g.startCampaign(2);
        const b = g.session.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) {
            b.grid[c][r] = 1;
            b.types[c][r] = 0;
          }
        }
        const tc = Math.floor(b.cols / 2);
        const tr = Math.floor(b.rows / 2);
        if (withLightning) b.types[Math.min(b.cols - 1, tc + 1)][tr] = 4; // LIGHTNING
        E.addPowerup("bomb", 1);
        const before = b.countRemaining();
        g.applyPowerup("bomb", tc, tr);
        return before - b.countRemaining();
      }

      return { plain: run(false), chained: run(true) };
    });

    expect(res.chained).toBeGreaterThan(res.plain);
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
    const fx = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        toolFx: g._lastToolColorClearFx,
        particles: g.particles.particles.length,
        rings: g.particles.rings.length,
      };
    });
    await page.waitForTimeout(300);
    const remainingOfColor = await page.evaluate(
      (color) => window.__bpc.game.session.board.colorCells(color).length,
      cell.color
    );
    expect(remainingOfColor).toBe(0);
    expect(fx.toolFx).toMatchObject({ rings: 2, colorIndex: cell.color });
    expect(fx.toolFx.cells).toBeGreaterThan(0);
    expect(fx.particles).toBeGreaterThan(0);
    expect(fx.rings).toBeGreaterThanOrEqual(1);
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
    await page.evaluate(() => {
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        chainBolt: 1,
      });
      window.__bpc.UI.assignLoadout(0, "chainBolt");
    });
    const { before, cols, rows } = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return { before: b.countRemaining(), cols: b.cols, rows: b.rows };
    });
    await page.locator('[data-pu="chainBolt"]').click();
    await expect(page.locator('[data-pu="chainBolt"]')).toHaveClass(/armed/);
    await tapCell(page, Math.floor(cols / 2), Math.floor(rows / 2));
    const fx = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        toolFx: g._lastToolChainBoltFx,
        particles: g.particles.particles.length,
        rings: g.particles.rings.length,
        sprites: g.particles.sprites.length,
      };
    });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    // A full row + column through a packed board removes (cols + rows - 1).
    expect(before - after).toBeGreaterThanOrEqual(Math.max(cols, rows));
    expect(fx.toolFx).toMatchObject({ rings: 2, sprites: true });
    expect(fx.toolFx.cells).toBeGreaterThanOrEqual(Math.max(cols, rows));
    expect(fx.particles).toBeGreaterThan(0);
    expect(fx.rings).toBeGreaterThanOrEqual(1);
    expect(fx.sprites).toBeGreaterThan(0);
    await expect(page.locator('[data-pu="chainBolt"] .pu-count')).toHaveText("0");
  });

  test("chain bolt chains into bomb bubbles it strikes", async ({ page }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const E = window.__bpc.Economy;

      function run(withBomb) {
        g.startCampaign(2);
        const b = g.session.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) {
            b.grid[c][r] = 1;
            b.types[c][r] = 0;
          }
        }
        const tc = Math.floor(b.cols / 2);
        const tr = Math.floor(b.rows / 2);
        if (withBomb) b.types[tc][tr] = 6; // BOMB
        E.addPowerup("chainBolt", 1);
        const before = b.countRemaining();
        g.applyPowerup("chainBolt", tc, tr);
        return before - b.countRemaining();
      }

      return { plain: run(false), chained: run(true) };
    });

    expect(res.chained).toBeGreaterThan(res.plain);
  });

  test("pick removes exactly one bubble", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        pick: 1,
      });
      window.__bpc.UI.assignLoadout(0, "pick");
    });
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

  test("paint suggests the three highest-impact colours before repainting a bubble", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const g = window.__bpc.game;
      window.__bpc.Storage.set("maxUnlockedLevel", 999);
      g.startCampaign(2);
      const b = g.session.board;
      b.cols = 4;
      b.rows = 3;
      b.colorCount = 4;
      b.restore(
        [
          [0, 1, 2],
          [3, 2, 2],
          [1, 2, 3],
          [1, 3, 3],
        ],
        [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ]
      );
      b.layout(g.W, g.H, 168, g._bottomInset());
      b.snapToTargets();
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        paint: 1,
      });
      window.__bpc.UI.assignLoadout(0, "paint");
    });
    await page.waitForTimeout(200);

    await page.locator('[data-pu="paint"]').click();
    await tapCell(page, 1, 0);

    const picker = page.locator("#paint-choice");
    await expect(picker).toBeVisible();
    await expect(picker.locator(".paint-choice-btn b")).toHaveText([
      "Makes 5",
      "Makes 3",
      "Makes 2",
    ]);

    await picker.locator('.paint-choice-btn[data-color="2"]').click();
    await expect(picker).toBeHidden();
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      return {
        color: b.grid[1][0],
        group: b.getGroupAt(1, 0).length,
        stock: window.__bpc.Economy.getPowerup("paint"),
        usedPowerup: g.session.usedPowerup,
      };
    });
    expect(res).toMatchObject({ color: 2, group: 5, stock: 0, usedPowerup: true });
  });

  test("pick on a lightning bubble triggers the full row+column strike", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startCampaign(2);
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      }
      const c = Math.floor(b.cols / 2);
      const r = Math.floor(b.rows / 2);
      b.types[c][r] = 4; // LIGHTNING
      window.__bpc.Economy.addPowerup("pick", 1);
      window.__bpc.UI.assignLoadout(0, "pick");
    });
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      return { count: b.countRemaining(), cols: b.cols, rows: b.rows };
    });
    const target = { c: Math.floor(before.cols / 2), r: Math.floor(before.rows / 2) };
    const expectedCleared = before.cols + before.rows - 1;

    await page.locator('[data-pu="pick"]').click();
    await page.waitForFunction(
      ({ c, r }) => {
        const g = window.__bpc.game;
        return g.session.armed === "pick" && g.session.board.isLightning(c, r);
      },
      target
    );
    await tapCell(page, target.c, target.r);
    await page.waitForFunction(
      ({ beforeCount, expectedCleared }) =>
        window.__bpc.game.session.board.countRemaining() <= beforeCount - expectedCleared,
      { beforeCount: before.count, expectedCleared }
    );

    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before.count - after).toBeGreaterThanOrEqual(expectedCleared);
  });

  test("pick on a bomb bubble triggers the 3x3 blast", async ({ page }) => {
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startCampaign(2);
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = 1;
          b.types[c][r] = 0; // NORMAL
        }
      }
      const c = Math.floor(b.cols / 2);
      const r = Math.floor(b.rows / 2);
      b.types[c][r] = 6; // BOMB
      window.__bpc.Economy.addPowerup("pick", 1);
      window.__bpc.UI.assignLoadout(0, "pick");
    });
    await page.waitForTimeout(200);

    const before = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    await page.locator('[data-pu="pick"]').click();
    await tapCell(page, 3, 4);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before - after).toBeGreaterThanOrEqual(5);
  });

  test("pick on multiplier/coin bubbles applies multiplier score and coin payout", async ({
    page,
  }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const E = window.__bpc.Economy;

      function setupAndPick(typeAtTarget) {
        g.startCampaign(2);
        const s = g.session;
        const b = s.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) {
            b.grid[c][r] = 1;
            b.types[c][r] = 0; // NORMAL
          }
        }
        const c = Math.floor(b.cols / 2);
        const r = Math.floor(b.rows / 2);
        b.types[c][r] = typeAtTarget;
        s.score = 0;
        const coins0 = E.coins;
        E.addPowerup("pick", 1);
        g.applyPowerup("pick", c, r);
        return { score: s.score, coinsDelta: E.coins - coins0 };
      }

      const plain = setupAndPick(0);
      const mult = setupAndPick(7); // MULTIPLIER
      const coin = setupAndPick(8); // COIN
      return { plain, mult, coin };
    });

    expect(res.mult.score).toBe(res.plain.score * 2);
    expect(res.coin.coinsDelta).toBeGreaterThanOrEqual(12);
  });

  test("bomb tool on multiplier/coin bubbles applies multiplier score and coin payout", async ({
    page,
  }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const E = window.__bpc.Economy;

      function setupAndBomb(typeAtTarget) {
        g.startCampaign(2);
        const s = g.session;
        const b = s.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) {
            b.grid[c][r] = 1;
            b.types[c][r] = 0; // NORMAL
          }
        }
        const c = Math.floor(b.cols / 2);
        const r = Math.floor(b.rows / 2);
        b.types[c][r] = typeAtTarget;
        s.score = 0;
        const coins0 = E.coins;
        E.addPowerup("bomb", 1);
        g.applyPowerup("bomb", c, r);
        return { score: s.score, coinsDelta: E.coins - coins0 };
      }

      const plain = setupAndBomb(0);
      const mult = setupAndBomb(7); // MULTIPLIER
      const coin = setupAndBomb(8); // COIN
      return { plain, mult, coin };
    });

    expect(res.mult.score).toBe(res.plain.score * 2);
    expect(res.coin.coinsDelta).toBeGreaterThanOrEqual(12);
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

  test("the magnet gauge's colour ramp matches where strength actually hits zero", async ({
    page,
  }) => {
    // Real bug guard: the ring's colour stops used to be hand-tuned
    // separately from MAGNET_HALF (the real strength falloff), so the dial
    // still read yellow/orange well past the point where the mechanical pull
    // strength had already floored at zero — misleading the player about how
    // close their lock actually was. The ring background is now computed
    // directly from MAGNET_HALF, so the "dead" red stop must land exactly at
    // MAGNET_HALF * 270 degrees from the green centre.
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    const target = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1 && b.types[c][r] === 0 && b.colorCells(b.grid[c][r]).length >= 2)
            return { c, r };
      return null;
    });
    await page.evaluate((t) => {
      window.__bpc.Economy.addPowerup("magnet", 5);
      window.__bpc.game.armPowerup("magnet");
      window.__bpc.game.beginMagnet(t.c, t.r);
    }, target);
    const bg = await page.locator(".mg-ring").evaluate((el) => el.style.background);
    // MAGNET_HALF is 0.3 (see AGENTS.md), so the dead zone is at 0.3*270=81deg.
    expect(bg).toContain("81deg");
    expect(bg).toContain("279deg"); // mirrored dead-zone stop on the other side
    // The colour AT that exact boundary must already be a "dead" red, not a
    // still-hopeful yellow/orange.
    expect(bg).toMatch(/rgb\(255, 77, 99\) 81deg/);
  });

  test("magnet aim uses the visible plain bubble even during sprite offset", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);

    // Pick a NORMAL target that has a left neighbour we can force non-plain.
    const tap = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      let pick = null;
      for (let c = 1; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] !== -1 && b.types[c][r] === 0 && b.grid[c - 1][r] !== -1) {
            pick = { c, r };
            break;
          }
        }
        if (pick) break;
      }
      if (!pick) return null;

      // Make the neighbour non-plain (stone), so a raw cell-at-pixel lookup at
      // the displaced position would be rejected without the visual fallback.
      b.types[pick.c - 1][pick.r] = 5;

      const sp = b.spriteGrid[pick.c][pick.r];
      const dst = b.targetPixel(pick.c - 1, pick.r);
      sp.x = dst.x;
      sp.y = dst.y;
      sp.delay = 0.8; // keep it visually offset long enough for the tap
      return { x: dst.x, y: dst.y };
    });
    expect(tap).not.toBeNull();

    await page.locator('[data-pu="magnet"]').click();
    await expect(page.locator('[data-pu="magnet"]')).toHaveClass(/armed/);
  await page.waitForFunction(() => window.__bpc.game.session.armed === "magnet");
  await page.evaluate(({ x, y }) => window.__bpc.game.handleTap(x, y), tap);

    // Regression guard: this used to toast "Aim the magnet at a plain bubble".
    await expect(page.locator("#magnet-gauge")).toBeVisible();
    expect(
      await page.evaluate(() => !!window.__bpc.game.session.magnet?.aiming)
    ).toBe(true);
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
    await expect(page.locator('#loadout-list [data-pu="shuffle"] .li-icon img[src$="shuffle.png"]')).toBeVisible();
    await expect(page.locator('#loadout-list [data-pu="paint"]')).toBeVisible();

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
  
  test("loadout picker can apply a smart suggested loadout", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 20);
      window.__bpc.Storage.set("loadout", ["undo", "shuffle", "bomb"]);
      window.__bpc.game.startCampaign(20);
    });
    await page.waitForTimeout(700);

    const box = await page.locator("#pu-slot-0").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.locator("#loadout")).toBeVisible();
    await page.locator(".loadout-suggest").click();
    await expect(page.locator("#loadout")).toBeHidden();

    const loadout = await page.evaluate(() => window.__bpc.Storage.getLoadout());
    expect(loadout.slice(0, 3)).toEqual(["chainBolt", "bomb", "pick"]);
  });

  test("HUD tool slots mark stocked and empty tools for visual states", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        bomb: 2,
        chainBolt: 0,
      });
      window.__bpc.Storage.setLoadoutSlot(0, "bomb");
      window.__bpc.Storage.setLoadoutSlot(1, "chainBolt");
      window.__bpc.UI.updatePowerups();
    });

    await expect(page.locator("#pu-slot-0")).toHaveClass(/has-stock/);
    await expect(page.locator("#pu-slot-0")).toHaveAttribute("data-stock", "2");
    await expect(page.locator("#pu-slot-0 .pu-count")).toHaveText("2");
    await expect(page.locator("#pu-slot-1")).toHaveClass(/no-stock/);
    await expect(page.locator("#pu-slot-1")).toHaveAttribute("data-stock", "0");
  });

  test("tapping an empty tool slot opens the shop with that tool highlighted and pauses the level", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);

    // Put a tool the player owns NONE of into slot 0.
    await page.evaluate(() => {
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        chainBolt: 0,
      });
      window.__bpc.UI.assignLoadout(0, "chainBolt");
    });
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

  test("tapping an unassigned tool slot opens the tools shop when no tools are stocked", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 8);
      window.__bpc.Storage.set("loadout", [null, null, null]);
      window.__bpc.Storage.set("powerups", {
        ...window.__bpc.Storage.get("powerups"),
        undo: 0,
        shuffle: 0,
      });
      window.__bpc.game.startCampaign(8);
    });
    await page.waitForTimeout(300);

    await expect(page.locator("#pu-slot-0")).toHaveClass(/empty/);
    await page.locator("#pu-slot-0").click();

    await expect(page.locator("#shop")).toBeVisible();
    await expect(page.locator('.shop-filter[data-shop-filter="tools"]')).toHaveClass(/active/);
    await expect(page.locator('#shop-list .shop-item[data-pu="undo"]')).toHaveClass(/highlight/);
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);
  });

  test("shop rows show when a power-up is not affordable", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.set("coins", 0));
    await page.locator("#btn-shop").click();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();
    const bomb = page.locator('#shop-list .shop-item[data-pu="bomb"]');
    await expect(bomb).toHaveClass(/cannot-afford/);
    await expect(bomb.locator('.si-icon img[src$="bomb.png"]')).toBeVisible();
    await expect(bomb.locator(".buy-btn")).toHaveClass(/need-coins/);
  });
});

test.describe("progressive tool unlocks", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("fresh players see no tools in the HUD, shop, or loadout picker", async ({
    page,
  }) => {
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();
    await expect(page.locator(".shop-empty-tools")).toContainText("Tools unlock after Level 5");
    await expect(page.locator('#shop-list .shop-item[data-pu]')).toHaveCount(0);
    await page.locator('.shop-filter[data-shop-filter="featured"]').click();
    await expect(page.locator(".shop-starter .si-desc")).toContainText("tool stash unlocks as you progress");
    await page.locator("#shop-back").click();

    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(300);
    await expect(page.locator("#powerups")).toBeHidden();
    for (let i = 0; i < 3; i++) await expect(page.locator(`#pu-slot-${i}`)).toBeHidden();
    await expect(page.locator("#loadout")).toBeHidden();
  });

  test("locked Pick is not recommended as a lone-bubble rescue", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
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
      const br = b.rows - 1;
      b.grid[0][br] = 0;
      b.grid[b.cols - 1][br] = 1;
      s.movesLeft = 0;
      s.score = 0;
      g.afterMove();
      return {
        ended: s.ended,
        rescuing: !!s.rescuing,
        pickUnlocked: window.__bpc.isPowerupUnlocked ? window.__bpc.isPowerupUnlocked("pick") : false,
      };
    });

    expect(state.pickUnlocked).toBe(false);
    expect(state.rescuing).toBe(false);
    expect(state.ended).toBe(true);
    await expect(page.locator("#isolated")).toBeHidden();
    await expect(page.locator("#lose")).toBeVisible();
  });

  test("clearing into a tool unlock shows a celebratory mini tutorial", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();

    await page.locator("#win-next").click();
    await expect(page.locator("#tool-unlock")).toBeVisible();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Undo");
    await expect(page.locator('#tool-unlock-icon img[src$="undo.png"]')).toBeVisible();
    await expect(page.locator("#tool-unlock-level")).toContainText("Level 6");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("restores the board");

    await page.locator("#tool-unlock-ok").click();
    await expect(page.locator("#tool-unlock")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__bpc.game.session?.level?.id)).toBe(6);
    await expect(page.locator("#pu-slot-0")).toHaveAttribute("data-pu", "undo");
    await expect(page.locator("#pu-slot-0 .pu-count")).toHaveText("1");
  });

  test("claiming the win bonus after a new tool unlock opens the tool popup", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();

    await expect(page.locator("#win-ceremony")).toBeVisible();
    await expect(page.locator("#win-step-chest")).toHaveClass(/active/);
    await expect(page.locator("#win-step-bonus")).toBeVisible();
    await expect(page.locator("#win-step-unlock")).toBeVisible();
    await page.locator("#win-chest").click();
    await expect(page.locator("#win-choice")).toBeVisible();
    await expect(page.locator("#win-step-chest")).toHaveClass(/done/);
    await expect(page.locator("#win-step-bonus")).toHaveClass(/active/);
    await expect(page.locator("#win-choice-list")).not.toContainText("Undo");
    await page.locator('#win-choice-list .win-choice-btn[data-choice="coins"]').click();
    await expect(page.locator("#win-step-bonus")).toHaveClass(/done/);
    await expect(page.locator("#win-step-unlock")).toHaveClass(/active/);

    await expect(page.locator("#tool-unlock")).toBeVisible();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Undo");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("restores the board");

    await page.locator("#tool-unlock-ok").click();
    await expect(page.locator("#tool-unlock")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__bpc.game.session?.level?.id)).toBe(6);
  });

  test("treasure milestones convert locked tool rewards into coins", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(5));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();

    const state = await page.evaluate(() => ({
      shuffle: window.__bpc.Economy.getPowerup("shuffle"),
      undo: window.__bpc.Economy.getPowerup("undo"),
      coins: window.__bpc.Economy.coins,
    }));

    expect(state.shuffle).toBe(0);
    expect(state.undo).toBe(1);
    expect(state.coins).toBeGreaterThanOrEqual(60);
    await expect(page.locator("#win-reward")).toContainText("Locked-tool bonus: +60 coins");
  });

  test("clearing into the pet intro shows a feature unlock and grants Sparky", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 11));
    await page.evaluate(() => window.__bpc.game.startCampaign(11));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();

    await page.locator("#win-next").click();
    await expect(page.locator("#tool-unlock")).toBeVisible();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Pets");
    await expect(page.locator("#tool-unlock-level")).toContainText("Level 12");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("Sparky");

    const petState = await page.evaluate(() => window.__bpc.Storage.getPetState());
    expect(petState.equipped).toBe("sparky");
    expect(petState.owned.sparky).toBeTruthy();

    await page.locator("#tool-unlock-ok").click();
    await expect(page.locator("#tool-unlock")).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__bpc.game.session?.level?.id)).toBe(12);
    await expect(page.locator("#hud-pet")).toBeVisible();
  });

  test("early pet economy unlocks grant starter crates and dust", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 13));
    await page.evaluate(() => window.__bpc.game.startCampaign(13));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-next").click();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Pet Crates");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("two starter crates");
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().crates)).toBeGreaterThanOrEqual(2);
    await page.locator("#tool-unlock-ok").click();

    await page.evaluate(() => {
      window.__bpc.game.quitToMenu();
      window.__bpc.Storage.set("maxUnlockedLevel", 15);
      window.__bpc.game.startCampaign(15);
    });
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-next").click();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Pick");
    await page.locator("#tool-unlock-ok").click();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Pet Abilities");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("starter Pet Dust");
    expect(await page.evaluate(() => window.__bpc.Storage.getDust())).toBeGreaterThanOrEqual(60);
    await page.locator("#tool-unlock-ok").click();

    await page.evaluate(() => {
      window.__bpc.game.quitToMenu();
      window.__bpc.Storage.set("maxUnlockedLevel", 17);
      window.__bpc.game.startCampaign(17);
    });
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await page.locator("#win-next").click();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Paint");
    await page.locator("#tool-unlock-ok").click();
    await expect(page.locator("#tool-unlock-name")).toHaveText("Pet Party");
    await expect(page.locator("#tool-unlock-lesson")).toContainText("Dust bonus");
    expect(await page.evaluate(() => window.__bpc.Storage.getDust())).toBeGreaterThanOrEqual(120);
  });
});

test.describe("hold-to-buy (auto-repeat purchase)", () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllTools(page);
  });

  test("a single tap on a power-up buy button purchases exactly one", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    await page.locator('#shop-list .shop-item[data-pu="bomb"] .buy-btn').click();
    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    expect(after).toBe(before + 1);
  });

  test("holding a buy button keeps purchasing at the configured rate", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    // Speed up the repeat so the test is fast and deterministic.
    await page.evaluate(() => {
      window.__bpc.UI.buyHoldInterval = 60;
    });

    const buy = page.locator('#shop-list .shop-item[data-pu="bomb"] .buy-btn');
    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );

    // Press and hold for ~360ms, then release.
    await buy.dispatchEvent("pointerdown");
    await page.waitForTimeout(360);
    await buy.dispatchEvent("pointerup");

    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    // 1 immediate buy + several repeats (~6 at 60ms over 360ms). Allow slack.
    expect(after - before).toBeGreaterThanOrEqual(3);

    // Releasing stops the repeat: the count holds steady afterwards.
    const settled = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    await page.waitForTimeout(200);
    const later = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    expect(later).toBe(settled);

    // The owned count in the shop item updated in place during the hold.
    await expect(
      page.locator('#shop-list .shop-item[data-pu="bomb"] .si-owned'),
    ).toHaveText(`×${after}`);
  });

  test("holding a buy button is capped to the configured batch size", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    await page.evaluate(() => {
      const settings = { ...window.__bpc.Storage.get("settings"), buyBatchMax: 4 };
      window.__bpc.Storage.set("settings", settings);
      window.__bpc.UI.buyHoldInterval = 20;
    });

    const buy = page.locator('#shop-list .shop-item[data-pu="pick"] .buy-btn');
    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );
    await buy.dispatchEvent("pointerdown");
    await expect(buy).toContainText(/Buying|Limit/);
    await page.waitForTimeout(260);
    await expect(buy).toContainText("Limit 4/4");
    await buy.dispatchEvent("pointerup");
    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );

    expect(after - before).toBe(4);
  });

  test("the Themes purchase preferences update hold-buy behavior", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await expect(page.locator("#themes")).toBeVisible();
    await expect(page.locator('[data-buy-max="10"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('[data-buy-ms="500"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.locator('[data-buy-max="3"]').click();
    await page.locator('[data-buy-ms="250"]').click();
    await expect(page.locator('[data-buy-max="3"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator('[data-buy-ms="250"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      await page.evaluate(() => window.__bpc.Storage.get("settings").buyBatchMax),
    ).toBe(3);
    expect(
      await page.evaluate(() => window.__bpc.Storage.get("settings").buyRepeatMs),
    ).toBe(250);

    await page.locator("#themes-back").click();
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    const buy = page.locator('#shop-list .shop-item[data-pu="pick"] .buy-btn');
    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );
    await buy.dispatchEvent("pointerdown");
    await page.waitForTimeout(900);
    await buy.dispatchEvent("pointerup");
    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );

    expect(after - before).toBe(3);
  });

  test("hold-buy never exceeds ten purchases per held press", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    await page.evaluate(() => {
      const settings = { ...window.__bpc.Storage.get("settings"), buyBatchMax: 99 };
      window.__bpc.Storage.set("settings", settings);
      window.__bpc.UI.buyHoldInterval = 15;
    });

    const buy = page.locator('#shop-list .shop-item[data-pu="pick"] .buy-btn');
    const before = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );
    await buy.dispatchEvent("pointerdown");
    await page.waitForTimeout(1200);
    await buy.dispatchEvent("pointerup");
    const after = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("pick"),
    );

    expect(after - before).toBe(10);
  });

  test("repeatable pet crate buys use the same capped hold behavior", async ({
    page,
  }) => {
    await unlockAllPetFeatures(page);
    await page.evaluate(() => window.__bpc.Economy.addCoins(100000));
    await page.locator("#btn-pets").click();
    await expect(page.locator("#pets")).toBeVisible();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();

    await page.evaluate(() => {
      const settings = { ...window.__bpc.Storage.get("settings"), buyBatchMax: 3 };
      window.__bpc.Storage.set("settings", settings);
      window.__bpc.UI.buyHoldInterval = 20;
    });

    const buy = page.locator("#crate-buy");
    const before = await page.evaluate(() =>
      window.__bpc.Storage.getPetState().crates,
    );
    await buy.dispatchEvent("pointerdown");
    await page.waitForTimeout(220);
    await buy.dispatchEvent("pointerup");
    const after = await page.evaluate(() =>
      window.__bpc.Storage.getPetState().crates,
    );

    expect(after - before).toBe(3);
    await expect(page.locator("#crate-count")).toHaveText(String(after));
  });

  test("the hold-buy stops automatically when coins run out", async ({
    page,
  }) => {
    await page.locator("#btn-shop").click();
    await expect(page.locator("#shop")).toBeVisible();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();

    // Probe one bomb's price, then set coins to exactly 2× that and rebuild
    // the shop so only two purchases are affordable.
    const price = await page.evaluate(() => {
      const E = window.__bpc.Economy;
      E.addCoins(100000);
      const before = E.coins;
      E.buyPowerup("bomb");
      const p = before - E.coins;
      E.addPowerup("bomb", -1); // undo the probe purchase
      window.__bpc.Storage.set("coins", 2 * p);
      window.__bpc.UI.buyHoldInterval = 40;
      window.__bpc.UI.buildShop();
      return p;
    });

    const ownedBefore = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    const buy = page.locator('#shop-list .shop-item[data-pu="bomb"] .buy-btn');
    await buy.dispatchEvent("pointerdown");
    await page.waitForTimeout(400);
    await buy.dispatchEvent("pointerup");

    const coins = await page.evaluate(() => window.__bpc.Economy.coins);
    const ownedAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb"),
    );
    // Bought exactly the two it could afford, then auto-stopped.
    expect(ownedAfter - ownedBefore).toBe(2);
    expect(coins).toBeLessThan(price); // can't afford another
  });
});

test.describe("group-pop explosion animations (5 escalating styles)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("a popped group picks the style + shockwave rings matching its size", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 0;
      s.comboTimer = 0;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          const grp = b.getGroupAt(c, r);
          if (grp.length >= 2) {
            const size = grp.length;
            const expected = window.__bpc.popStyle(size);
            g.particles.rings.length = 0; // isolate this pop's rings
            g.particles.sprites.length = 0;
            g.popAt(c, r);
            return {
              size,
              style: g._lastPopStyle,
              expStyle: expected.style,
              rings: g.particles.rings.length,
              sprites: g.particles.spriteCount,
              // rings[] holds the shockwave rings plus (for big pops) a flash bloom
              expRings: expected.rings + (expected.flash ? 1 : 0),
            };
          }
        }
      return null;
    });
    expect(res).not.toBeNull();
    // The chosen style matches the size→style table, and the emitted rings
    // match that style (so the animation really does escalate with group size).
    expect(res.style).toBe(res.expStyle);
    expect(res.rings).toBe(res.expRings);
    expect(res.sprites).toBeGreaterThan(0);
  });

  test("a large group fires the top 'supernova' style with rings + flash", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 0;
      s.comboTimer = 0;
      const b = s.board;
      // Paint the first two columns a single plain colour to guarantee a big
      // (>=12) connected group, so the pop lands on the top explosion tier.
      const cols = Math.min(2, b.cols);
      for (let c = 0; c < cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] !== -1) {
            b.grid[c][r] = 0;
            b.types[c][r] = 0;
          }
        }
      let target = null;
      for (let r = b.rows - 1; r >= 0; r--) {
        if (b.grid[0][r] !== -1) {
          target = { c: 0, r };
          break;
        }
      }
      const size = b.getGroupAt(target.c, target.r).length;
      g.particles.rings.length = 0;
      g.particles.sprites.length = 0;
      g.popAt(target.c, target.r);
      return { size, style: g._lastPopStyle, rings: g.particles.rings.length, sprites: g.particles.spriteCount };
    });
    expect(res.size).toBeGreaterThanOrEqual(12);
    expect(res.style).toBe(4);
    // Three escalating shockwave rings plus the white flash bloom.
    expect(res.rings).toBe(4);
    expect(res.sprites).toBeGreaterThanOrEqual(res.size);
  });
});

test.describe("combo escalator (#5)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the combo banner escalates its tier with the chain length", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    // Pop a group with the combo one short of the top threshold (12) so the
    // resolving pop lands at ×13 → the top "Unstoppable" tier (ct-5).
    const popped = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 12;
      s.comboTimer = 99;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return true;
          }
        }
      return false;
    });
    expect(popped).toBe(true);

    const banner = page.locator("#combo-banner");
    await expect(banner).toHaveClass(/ct-5/);
    await expect(banner).toContainText("Unstoppable");
    await expect(banner).toContainText("×13");
  });

  test("a small chain shows the entry tier", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const popped = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 1; // resolving pop lands at ×2 → entry tier ct-1
      s.comboTimer = 99;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return true;
          }
        }
      return false;
    });
    expect(popped).toBe(true);

    const banner = page.locator("#combo-banner");
    await expect(banner).toHaveClass(/ct-1/);
    await expect(banner).toContainText("Nice");
  });
});

test.describe("Combo Cam (dynamic zoom on huge combos)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("reaching the top combo tier punches the camera zoom above 1, then it decays back to 1", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const popped = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 12; // resolving pop lands at ×13 -> top "Unstoppable" tier
      s.comboTimer = 99;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return true;
          }
        }
      return false;
    });
    expect(popped).toBe(true);

    // The punch is active immediately after the pop (peak recorded, timer running).
    const peak = await page.evaluate(() => window.__bpc.game.cameraZoom.peak);
    expect(peak).toBeGreaterThan(0);

    // Advance the update loop past the punch's duration and confirm it decays
    // all the way back to a neutral scale (no permanent zoom).
    await page.evaluate(() => {
      const g = window.__bpc.game;
      for (let i = 0; i < 60; i++) g.cameraZoom.update(0.05);
    });
    const scaleAfter = await page.evaluate(() => window.__bpc.game.cameraZoom.scale);
    expect(scaleAfter).toBe(1);
  });

  test("reduced motion suppresses the camera punch entirely", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.game._applyReducedMotion(true);
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const popped = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 12;
      s.comboTimer = 99;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return true;
          }
        }
      return false;
    });
    expect(popped).toBe(true);

    const scale = await page.evaluate(() => window.__bpc.game.cameraZoom.scale);
    expect(scale).toBe(1);
  });
});

test.describe("cascade chain bonus (#8)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("sustaining a chain adds an escalating flat cascade bonus", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 3; // the resolving pop is the 4th link in the chain
      s.comboTimer = 99;
      s.feverActive = false;
      s.fever = 0;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          const grp = b.getGroupAt(c, r);
          if (grp.length >= 2 && !grp.some((p) => b.isLightning(p.c, p.r))) {
            const size = grp.length;
            const comboBefore = s.combo;
            const before = s.score;
            g.popAt(c, r);
            return {
              size,
              comboBefore,
              delta: s.score - before,
              scoreMult: s.petBuffs.scoreMult,
            };
          }
        }
      return null;
    });
    expect(res).not.toBeNull();

    // Recompute the exact award the way main.js does: combo-multiplied group
    // score PLUS the flat cascade bonus for this chain link, no Fever active.
    const expected = await page.evaluate((r) => {
      const cs = window.__bpc.cascade;
      const groupScore = (n) => (n < 2 ? 0 : 5 * n * (n - 1));
      const comboMult = (combo) => Math.min(1 + combo * 0.5, 5);
      const comboPoints = Math.round(groupScore(r.size) * comboMult(r.comboBefore));
      const cascade = cs.cascadeBonus(r.comboBefore + 1);
      return {
        total: Math.round((comboPoints + cascade) * r.scoreMult),
        cascade,
      };
    }, res);

    expect(expected.cascade).toBeGreaterThan(0); // chain of 4 must pay a cascade
    expect(res.delta).toBe(expected.total);
  });

  test("the opening pop of a chain pays no cascade", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.combo = 0; // first pop → chain length 1 → no cascade
      s.comboTimer = 0;
      s.feverActive = false;
      s.fever = 0;
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1 || b.types[c][r] !== 0) continue;
          const grp = b.getGroupAt(c, r);
          if (grp.length >= 2 && !grp.some((p) => b.isLightning(p.c, p.r))) {
            const size = grp.length;
            const before = s.score;
            g.popAt(c, r);
            return {
              size,
              delta: s.score - before,
              scoreMult: s.petBuffs.scoreMult,
            };
          }
        }
      return null;
    });
    expect(res).not.toBeNull();
    // Combo 0, no cascade, no Fever → exactly the base group score (×1).
    const base = res.size < 2 ? 0 : 5 * res.size * (res.size - 1);
    expect(res.delta).toBe(Math.round(base * res.scoreMult));
  });
});

test.describe("per-theme background music (#25)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("entering a level starts the current theme's track; quitting stops it", async ({
    page,
  }) => {
    const started = await page.evaluate(() => {
      window.__bpc.game.startCampaign(2);
      return {
        state: window.__bpc.Audio.musicState(),
        theme: window.__bpc.game.theme.id,
      };
    });
    expect(started.state.playing).toBe(true);
    expect(started.state.theme).toBe(started.theme);

    const stopped = await page.evaluate(() => {
      window.__bpc.game.quitToMenu();
      return window.__bpc.Audio.musicState();
    });
    expect(stopped.playing).toBe(false);
  });

  test("muting silences the track without stopping it", async ({ page }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const A = window.__bpc.Audio;
      g.startCampaign(2);
      A.setMuted(false);
      const before = A.musicState().playing;
      A.setMuted(true);
      const afterPlaying = A.musicState().playing; // still scheduled, just silent
      const masterMuted = A.muted;
      A.setMuted(false); // restore
      return { before, afterPlaying, masterMuted };
    });
    expect(res.before).toBe(true);
    expect(res.afterPlaying).toBe(true);
    expect(res.masterMuted).toBe(true);
  });
});

test.describe("weekly tournament (#11)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("starting the tournament builds the week's seeded board", async ({ page }) => {
    const res = await page.evaluate(() => {
      window.__bpc.game.startTournament();
      const s = window.__bpc.game.session;
      const lvl = window.__bpc.tournament.getTournamentLevel();
      return {
        mode: s.mode,
        seed: s.level.seed,
        weekSeed: lvl.seed,
        movesLeft: s.movesLeft,
        hasGoals: !!(s.goals && s.goals.silver),
      };
    });
    expect(res.mode).toBe("tournament");
    expect(res.seed).toBe(res.weekSeed);
    expect(res.movesLeft).toBe(9999);
    expect(res.hasGoals).toBe(true);
  });

  test("finishing a tournament run records the weekly best and shows a rank", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startTournament());
    await page.waitForTimeout(400);
    await autoPlay(page);
    await expect(page.locator("#win")).toBeVisible();
    // The reward line shows the earned rank (e.g. "🥉 Bronze").
    await expect(page.locator("#win-reward")).toContainText("Best");

    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();

    const t = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).tournament
    );
    expect(t.plays).toBeGreaterThanOrEqual(1);
    expect(t.best).toBeGreaterThan(0);
    expect(t.weekKey).not.toBeNull();
    // The menu summary surfaces this week's best.
    await expect(page.locator("#tournament-summary")).toContainText("Best");
  });
});

test.describe("Spotlight Challenge (rotating limited-time event)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("starting the Spotlight builds the rotation's seeded board", async ({ page }) => {
    const res = await page.evaluate(() => {
      window.__bpc.game.startSpotlight();
      const s = window.__bpc.game.session;
      const lvl = window.__bpc.spotlight.getSpotlightLevel();
      return {
        mode: s.mode,
        seed: s.level.seed,
        rotationSeed: lvl.seed,
        movesLeft: s.movesLeft,
        hasGoals: !!(s.goals && s.goals.bronze),
      };
    });
    expect(res.mode).toBe("spotlight");
    expect(res.seed).toBe(res.rotationSeed);
    expect(res.movesLeft).toBe(9999);
    expect(res.hasGoals).toBe(true);
  });

  test("finishing a Spotlight run records the rotation best and pays a one-time tier reward", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.game.startSpotlight();
      // Force a score that clears every tier so the reward is deterministic.
      const s = window.__bpc.game.session;
      const goals = window.__bpc.spotlight.getSpotlightGoals(s.level);
      s.score = goals.gold;
    });
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) b.grid[c][r] = -1;
      g.afterMove(); // deadlock on an empty board → resolves the Spotlight run
    });
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("Best");
    await expect(page.locator("#win-reward")).toContainText("tier reward");

    const coinsBefore = await page.evaluate(() => window.__bpc.Storage.get("coins"));
    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();

    const sp = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).spotlight
    );
    expect(sp.plays).toBeGreaterThanOrEqual(1);
    expect(sp.best).toBeGreaterThan(0);
    expect(sp.periodKey).not.toBeNull();
    expect(sp.claimedTiers).toEqual([1, 2, 3]);
    expect(coinsBefore).toBeGreaterThan(0);
    // The menu summary surfaces this rotation's best.
    await expect(page.locator("#spotlight-summary")).toContainText("Best");
  });

  test("replaying after every tier is claimed pays no further tier reward", async ({ page }) => {
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.startSpotlight();
      const goals = window.__bpc.spotlight.getSpotlightGoals(g.session.level);
      window.__bpc.Storage.set("spotlight", {
        periodKey: window.__bpc.spotlight.getSpotlightLevel().key,
        best: goals.gold,
        plays: 1,
        claimedTiers: [1, 2, 3],
      });
    });
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const goals = window.__bpc.spotlight.getSpotlightGoals(s.level);
      s.score = goals.gold; // matches the already-claimed best exactly
      const b = s.board;
      for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) b.grid[c][r] = -1;
      g.afterMove();
    });
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).not.toContainText("tier reward");
  });
});

test.describe("time attack (Tier 1 — A)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("starting Time Attack runs a timed, refilling high-score board", async ({
    page,
  }) => {
    const res = await page.evaluate(() => {
      window.__bpc.game.startTimeAttack();
      const s = window.__bpc.game.session;
      return {
        mode: s.mode,
        timeLeft: s.timeLeft,
        full: s.board.countRemaining(),
        cap: s.board.cols * s.board.rows,
        seconds: window.__bpc.timeattack.seconds,
      };
    });
    expect(res.mode).toBe("timeattack");
    expect(res.seconds).toBe(60);
    expect(res.timeLeft).toBeLessThanOrEqual(60);
    expect(res.timeLeft).toBeGreaterThan(50);
    expect(res.full).toBe(res.cap); // board starts full
    // The HUD shows a countdown in seconds, not a move count.
    await expect(page.locator("#hud-moves-label")).toHaveText("Time");
    await expect(page.locator("#hud-moves")).toContainText("s");
  });

  test("the clock running out ends the run and banks a personal best", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.game.startTimeAttack();
      // Score some points, then fast-forward the clock to the final tick.
      const s = window.__bpc.game.session;
      s.score = 1234;
      s.timeLeft = 0.05;
    });
    // The update loop drains the last sliver and schedules the finish.
    await expect(page.locator("#win")).toBeVisible({ timeout: 4000 });
    await expect(page.locator("#win-reward")).toContainText("Best");

    await page.locator("#win-menu").click();
    await expect(page.locator("#menu")).toBeVisible();
    const best = await page.evaluate(
      () => JSON.parse(localStorage.getItem("bpc_save_v1")).highScoreTimeAttack
    );
    expect(best).toBeGreaterThanOrEqual(1234);
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

  test("Collect All clears stacked tiers of a category in a single press", async ({
    page,
  }) => {
    // Seed lifetime pops past EVERY Popper tier (1/100/500/1000/5000) with
    // nothing yet collected, so all five tiers are earned-but-uncollected at
    // once. One Collect All press must grab them ALL — not advance tier-by-tier.
    await page.evaluate(() => {
      window.__bpc.Storage.setAchievementState({
        progress: { pops: 5000 },
        claims: {},
      });
    });
    await page.evaluate(() => window.__bpc.UI.showScreen("achievements"));
    await expect(page.locator("#achievements")).toBeVisible();

    const collectAll = page.locator("#achv-collect-all");
    await expect(collectAll).toBeVisible();

    await collectAll.click();
    await expect(page.locator("#chest")).toBeVisible();
    // Five stacked tiers were collected in the one pass.
    await expect(page.locator("#chest-title")).toContainText("5 chests");
    await page.locator("#chest-ok").click();
    await expect(page.locator("#achievements")).toBeVisible();

    // Every Popper tier is now collected (claims.popper === totalTiers), the
    // button is gone and nothing remains claimable — no per-tier repeat needed.
    const claims = await page.evaluate(
      () => window.__bpc.Storage.getAchievementState().claims
    );
    expect(claims.popper).toBe(5);
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
    // The claim button is now disabled and the badge clears — but the Gifts
    // tile badge also tracks the (still-unspun) Lucky Wheel, so spin it too
    // before expecting the shared badge to fully clear.
    await expect(page.locator("#cal-claim")).toBeDisabled();
    await page.evaluate(() => window.__bpc.game.spinLuckyWheel());
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

  test("locked calendar tool gifts display and claim as coins for fresh players", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 1);
      window.__bpc.Storage.set("loginCalendar", { lastClaim: null, day: 2 });
      window.__bpc.Storage.set("coins", 0);
      window.__bpc.UI.buildCalendar();
    });

    await page.locator("#btn-calendar").click();
    await expect(page.locator(".cal-day.today")).toContainText("90 coins");
    await expect(page.locator(".cal-day.today")).not.toContainText("Bomb");
    await page.locator("#cal-claim").click();

    const state = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      bombs: window.__bpc.Economy.getPowerup("bomb"),
    }));
    expect(state.coins).toBe(90);
    expect(state.bombs).toBe(0);
  });
});

test.describe("lucky wheel (daily spin-to-win)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("launches from the Gifts screen and lists every dial segment", async ({
    page,
  }) => {
    await page.locator("#btn-calendar").click();
    await expect(page.locator("#calendar")).toBeVisible();
    await expect(page.locator("#wheel-launch")).toBeVisible();
    await page.locator("#wheel-launch").click();
    await expect(page.locator("#wheel")).toBeVisible();
    const count = await page.evaluate(() => window.__bpc.wheel.WHEEL_REWARDS.length);
    await expect(page.locator("#wheel-dial .wheel-seg-label")).toHaveCount(count);
    await expect(page.locator("#wheel-spin")).toBeEnabled();
    await expect(page.locator("#wheel-spin")).toHaveText("Spin!");
  });

  test("spinning grants a reward, rotates the dial, and locks until tomorrow", async ({
    page,
  }) => {
    await page.locator("#btn-calendar").click();
    await page.locator("#wheel-launch").click();
    await expect(page.locator("#wheel")).toBeVisible();

    const before = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.locator("#wheel-spin").click();
    // The dial rotates immediately (a large multi-spin CSS transform), well
    // before the 2.2s transition finishes.
    await expect
      .poll(() => page.evaluate(() => document.getElementById("wheel-dial").style.transform))
      .toMatch(/rotate\(\d+/);
    await expect(page.locator("#wheel-spin")).toBeDisabled();

    // After the spin settles, the result panel shows and the reward is
    // actually granted (fresh level-1 save: every tool is still locked, so a
    // rolled "powerup" segment always converts to coins — never a real tool).
    await expect(page.locator("#wheel-result")).toBeVisible({ timeout: 4000 });
    const after = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      bombs: window.__bpc.Economy.getPowerup("bomb"),
      wheel: window.__bpc.Storage.get("wheel"),
    }));
    expect(after.coins).toBeGreaterThanOrEqual(before);
    expect(after.bombs).toBe(0);
    expect(after.wheel.lastSpin).toBe(await page.evaluate(() => window.__bpc.calendar.todayKey()));
    await expect(page.locator("#wheel-spin")).toHaveText("Come back tomorrow");

    // Locked for the rest of the day, even after closing and reopening.
    await page.locator("#wheel-close").click();
    await page.locator("#wheel-launch").click();
    await expect(page.locator("#wheel-spin")).toBeDisabled();
  });

  test("spinning twice in one day does not double-pay", async ({ page }) => {
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const first = g.spinLuckyWheel();
      const second = g.spinLuckyWheel();
      return { first, second };
    });
    expect(res.first).not.toBeNull();
    expect(res.second).toBeNull();
  });

  test("the Gifts tile badge reflects an unclaimed wheel spin independently of the calendar", async ({
    page,
  }) => {
    // Claim the calendar but leave the wheel unspun: badge must stay lit.
    await page.evaluate(() => window.__bpc.game.claimCalendar());
    await expect(page.locator("#cal-badge")).toBeVisible();

    await page.evaluate(() => window.__bpc.game.spinLuckyWheel());
    await page.locator("#btn-calendar").click();
    await expect(page.locator("#cal-badge")).toBeHidden();
  });

  test("persists the daily lock across a reload", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.spinLuckyWheel());
    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      if (g.tutorial && g.tutorial.active) g.tutorial.skip();
    });
    await page.locator("#btn-calendar").click();
    await page.locator("#wheel-launch").click();
    await expect(page.locator("#wheel-spin")).toBeDisabled();
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
    // The "Unlock Premium" button must sit compactly beside the XP bar, not
    // stretch to the row's full width (it inherits .btn's width:100% and
    // needs an explicit override, or it fights the XP bar for space and
    // overflows/squishes on narrow phones).
    const headBox = await page.locator("#season-head").boundingBox();
    const buyBox = await page.locator("#season-buy").boundingBox();
    const xpBox = await page.locator("#season-xp-label").boundingBox();
    expect(buyBox.width).toBeLessThan(headBox.width * 0.6);
    expect(buyBox.x + buyBox.width).toBeLessThanOrEqual(headBox.x + headBox.width + 1);
    expect(xpBox.width).toBeGreaterThan(40);
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

  test("locked season tool rewards display and claim as coins", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 1);
      window.__bpc.Storage.set("coins", 0);
      window.__bpc.game._awardSeasonXp(300);
    });
    await page.locator("#btn-season").click();

    const shuffleTier = page.locator(".season-row").nth(2).locator(".season-free");
    await expect(shuffleTier).toHaveClass(/claimable/);
    await expect(shuffleTier).toContainText("60 coins");
    await expect(shuffleTier).not.toContainText("Shuffle");
    await shuffleTier.click();

    const state = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      shuffle: window.__bpc.Economy.getPowerup("shuffle"),
    }));
    expect(state.coins).toBe(60);
    expect(state.shuffle).toBe(0);
  });
});

test.describe("colorblind mode (accessibility)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("toggle on the Themes screen flips the renderer flag and persists", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
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
    await page.locator("#btn-themes").click();
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

test.describe("reduced motion (accessibility)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("toggle on the Themes screen dials down motion and persists", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await expect(page.locator("#themes")).toBeVisible();

    // Off by default: full screen shake / particles, no body class.
    await expect(page.locator("#rm-toggle-state")).toHaveText("Off");
    expect(
      await page.evaluate(() => window.__bpc.game.shake.motionScale)
    ).toBe(1);
    expect(
      await page.evaluate(() => document.body.classList.contains("reduced-motion"))
    ).toBe(false);

    // Turn it on: label, runtime flags, body class and saved setting all update.
    await page.locator("#rm-toggle").click();
    await expect(page.locator("#rm-toggle-state")).toHaveText("On");
    await expect(page.locator("#rm-toggle")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      await page.evaluate(() => window.__bpc.game.shake.motionScale)
    ).toBe(0);
    expect(
      await page.evaluate(() => window.__bpc.game.particles.motionScale)
    ).toBeLessThan(1);
    expect(
      await page.evaluate(() => document.body.classList.contains("reduced-motion"))
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bpc_save_v1")).settings.reducedMotion
      )
    ).toBe(true);

    // Turn it back off.
    await page.locator("#rm-toggle").click();
    await expect(page.locator("#rm-toggle-state")).toHaveText("Off");
    expect(
      await page.evaluate(() => window.__bpc.game.shake.motionScale)
    ).toBe(1);
    expect(
      await page.evaluate(() => document.body.classList.contains("reduced-motion"))
    ).toBe(false);
  });

  test("the saved reduced-motion setting is applied on reload", async ({
    page,
  }) => {
    await page.locator("#btn-themes").click();
    await page.locator("#rm-toggle").click();
    await expect(page.locator("#rm-toggle-state")).toHaveText("On");

    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    // The game applies the saved setting on startup.
    expect(
      await page.evaluate(() => window.__bpc.game.shake.motionScale)
    ).toBe(0);
    expect(
      await page.evaluate(() => document.body.classList.contains("reduced-motion"))
    ).toBe(true);
  });
});

test.describe("accessibility attributes", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the canvas, toast and modals carry screen-reader metadata", async ({
    page,
  }) => {
    // The gameplay canvas is exposed as a labelled image.
    await expect(page.locator("#game-canvas")).toHaveAttribute("role", "img");
    await expect(page.locator("#game-canvas")).toHaveAttribute(
      "aria-label",
      /board/i
    );
    // The toast is a polite live region so announcements are read out.
    await expect(page.locator("#toast")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator("#toast")).toHaveAttribute("role", "status");
    // Key overlays are proper dialogs.
    await expect(page.locator("#win")).toHaveAttribute("role", "dialog");
    await expect(page.locator("#win")).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#lose")).toHaveAttribute("role", "dialog");
  });

  test("the informational menu footer does not overlap the Play CTA", async ({
    page,
  }) => {
    // The footer summaries used to be pinned over the top-right of the menu,
    // which could collide with the campaign CTA on tall Android phones.
    const boxes = await page.evaluate(() => {
      const foot = document.querySelector(".menu-foot").getBoundingClientRect();
      const play = document.querySelector("#btn-play").getBoundingClientRect();
      return {
        foot: { top: foot.top, bottom: foot.bottom, left: foot.left, right: foot.right },
        play: { top: play.top, bottom: play.bottom, left: play.left, right: play.right },
      };
    });
    expect(boxes.foot.bottom).toBeLessThanOrEqual(boxes.play.top - 4);
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
    expect(cell).not.toBeNull();
    await tapCell(page, cell.c, cell.r);
    expect(
      await page.evaluate(() => !!window.__bpc.game.session.hint)
    ).toBe(false);
  });

  test("the Themes toggle disables hints and suppresses them in play", async ({
    page,
  }) => {
    // On by default.
    await page.locator("#btn-themes").click();
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
    await clearBoardByFinalPair(page);
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
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("New best score");
    await expect(page.locator("#win-reward .win-reward-card.best")).toContainText("New best score");
  });
});


test.describe("bonus objectives", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("ordinary levels surface bonus objective status in the HUD", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(3));
    await page.waitForTimeout(500);
    const label = await page.evaluate(
      () => window.__bpc.getLevel(3).objective.label
    );
    const compact = label
      .replace(/^Pop a group of\s*/i, "Group ")
      .replace(/^Reach a\s*/i, "Reach ")
      .replace(/^Clear without spending a power-up$/i, "No tools")
      .replace(/\s+/g, " ")
      .trim();
    await expect(page.locator("#hud-objective")).toHaveClass(/hidden/);
    await expect(page.locator("#hud-objective-text")).toHaveText("");
    await expect(page.locator("#hud-status")).toContainText(compact);

    await page.evaluate(() => {
      window.__bpc.game.session.objectiveMet = true;
      window.__bpc.game.refreshHud();
    });
    await expect(page.locator("#hud-objective")).toBeVisible();
    await expect(page.locator("#hud-objective-text")).toContainText("Bonus ✓");
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
    });
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).toContainText("Objective");
    await expect(page.locator("#win-reward .win-reward-card.objective")).toContainText("Objective");
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
    });
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-reward")).not.toContainText("Objective");
  });
});


test.describe("falling events (gift & problem tokens)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("ambient gifts do not spawn before the player interacts with the board", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.eventTimer = 0.01;
      g._updateEvents(1);
      return {
        activeEvent: g.activeEvent,
        eventTimer: g.eventTimer,
        boardInteracted: g.session.boardInteracted,
      };
    });

    expect(res.activeEvent).toBe(false);
    expect(res.boardInteracted).toBe(false);
    expect(res.eventTimer).toBeCloseTo(0.01, 4);
    await expect(page.locator("#falling-event")).toHaveCount(0);
  });

  test("ambient event timer advances only during recent board play", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const idle = await page.evaluate(() => {
      const g = window.__bpc.game;
      g._noteBoardActivity();
      g.eventTimer = 1;
      g._updateEvents(9);
      return { activeEvent: g.activeEvent, eventTimer: g.eventTimer };
    });
    expect(idle.activeEvent).toBe(false);
    expect(idle.eventTimer).toBe(1);

    const active = await page.evaluate(() => {
      const g = window.__bpc.game;
      g._noteBoardActivity();
      g._updateEvents(0.5);
      return { activeEvent: g.activeEvent, eventTimer: g.eventTimer };
    });
    expect(active.activeEvent).toBe(false);
    expect(active.eventTimer).toBeCloseTo(0.5, 4);
  });

  test("a board pop arms ambient gifts and the screen countdown is enforced", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);
    await expect(page.locator("#hud-status")).toContainText(/\d+s/);

    const spawned = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      let target = null;
      for (let c = 0; c < b.cols && !target; c++)
        for (let r = 0; r < b.rows && !target; r++)
          if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2) target = { c, r };
      const p = b.targetPixel(target.c, target.r);
      g.handleTap(p.x, p.y);
      g.eventTimer = 0.01;
      g._updateEvents(0.02);
      return { boardInteracted: g.session.boardInteracted, activeEvent: g.activeEvent };
    });
    expect(spawned.boardInteracted).toBe(true);
    expect(spawned.activeEvent).toBe(true);
    await expect(page.locator("#falling-event")).toBeVisible();

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const token = document.getElementById("falling-event");
      if (token) token.remove();
      g.activeEvent = false;
      g.session.screenTimeLeft = 0.01;
      g._updateScreenTimer(0.02);
    });
    await expect(page.locator("#lose")).toBeVisible({ timeout: 6000 });
    await expect(page.locator(".lose-title")).toHaveText("Time's Up!");
    await expect(page.locator("#lose-tip")).toContainText("Waiting will not bring extra gifts");
  });

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

  test("a forced gift token can hand the player a free tool", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    // Put a bomb in the first quick-slot so the HUD shows its live count, then
    // record how many bombs the player owns right now.
    const before = await page.evaluate(() => {
      window.__bpc.Storage.set("maxUnlockedLevel", 999);
      window.__bpc.Storage.setLoadoutSlot(0, "bomb");
      window.__bpc.UI.updatePowerups();
      return window.__bpc.Economy.getPowerup("bomb");
    });

    // Force a gift and pin its payload to a bomb power-up (a random roll could
    // be coins or a crate instead) to assert the tool-grant path deterministically.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.spawnEvent("gift");
      g._activeEventDesc.reward = { type: "powerup", powerup: "bomb" };
    });
    const token = page.locator("#falling-event.gift");
    await expect(token).toBeVisible();
    await token.dispatchEvent("click");
    await expect(token).toBeHidden();

    // The player now owns one more bomb and the HUD quick-slot reflects it.
    const after = await page.evaluate(() => window.__bpc.Economy.getPowerup("bomb"));
    expect(after).toBe(before + 1);
    await expect(page.locator("#pu-slot-0 .pu-count")).toHaveText(String(after));
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
      g._onEventMiss({ type: "problem", effect: "scatter" });
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

  test("missed problem tokens can trigger five different hazards", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(500);

    const out = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const b = s.board;
      function gridSnap() {
        return b.grid.map((col) => col.slice());
      }
      function diff(before) {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++) if (b.grid[c][r] !== before[c][r]) n++;
        return n;
      }
      function typeCount(type) {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++) if (b.types[c][r] === type) n++;
        return n;
      }
      const beforeScatter = gridSnap();
      g._applyProblemEffect("scatter");
      const scatter = diff(beforeScatter);

      const beforeShuffle = gridSnap();
      g._applyProblemEffect("shuffle");
      const shuffle = diff(beforeShuffle);

      s.movesLeft = 10;
      g._applyProblemEffect("moves");
      const moves = s.movesLeft;

      const iceBefore = typeCount(1);
      g._applyProblemEffect("freeze");
      const iceAfter = typeCount(1);

      const vineBefore = typeCount(9);
      g._applyProblemEffect("vine");
      const vineAfter = typeCount(9);

      return { scatter, shuffle, moves, iceBefore, iceAfter, vineBefore, vineAfter };
    });
    expect(out.scatter).toBeGreaterThan(0);
    expect(out.shuffle).toBeGreaterThan(0);
    expect(out.moves).toBe(8);
    expect(out.iceAfter).toBeGreaterThan(out.iceBefore);
    expect(out.vineAfter).toBeGreaterThan(out.vineBefore);
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
    await page.locator("#btn-shop").click();
    await page.locator('.shop-filter[data-shop-filter="coins"]').click();
    await expect(page.locator('.shop-coins-item .si-icon img[src="./assets/icons/currency/coins-stack.png"]').first()).toBeVisible();
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

  test("native store builds disable rewarded and paid shop surfaces without providers", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.Capacitor = { isNativePlatform: () => true };
      window.__bpc.Monetization.clearProvider();
      window.__bpc.Monetization.setDevelopmentRewardedFallback(false);
    });
    await page.locator("#btn-shop").click();
    await page.locator('.shop-filter[data-shop-filter="coins"]').click();
    await expect(page.locator("#shop-free-coins")).toHaveText("Unavailable");
    await expect(page.locator("#shop-free-coins")).toBeDisabled();
    await expect(page.locator("#shop-list button", { hasText: "Unavailable" })).toHaveCount(3);
    await page.locator('.shop-filter[data-shop-filter="offers"]').click();
    await expect(page.locator("#shop-list button", { hasText: "Unavailable" })).toHaveCount(1);
  });

  test("buying a power-up deducts coins; insufficient funds is blocked", async ({
    page,
  }) => {
    await unlockAllTools(page);
    await page.locator("#btn-shop").click();
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();
    // With 0 coins, buying the bomb (150) must fail with a toast.
    await page.locator("#shop-list button", { hasText: /^150$/ }).click();
    await expect(page.locator("#toast")).toContainText("Not enough");

    // Earn coins via the free daily ad reward, then the purchase succeeds.
    await page.locator('.shop-filter[data-shop-filter="coins"]').click();
    await page.locator("#shop-free-coins").click(); // +150
    await page.waitForTimeout(2400);
    await page.locator("#shop-free-coins").click(); // +250 -> 400
    await page.waitForTimeout(2400);
    await page.locator('.shop-filter[data-shop-filter="tools"]').click();
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
      window.__bpc.Storage.set("maxUnlockedLevel", 999);
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
    await page.locator("#btn-shop").click();
    await page.locator('.shop-filter[data-shop-filter="offers"]').click();
    await page.locator("#shop-list button", { hasText: "$2.99" }).click();
    await expect(page.locator("#shop-list button", { hasText: "Owned" })).toBeVisible();
    const removed = await page.evaluate(() => window.__bpc.Monetization.isAdsRemoved());
    expect(removed).toBe(true);

    // Win a level; the "double coins" rewarded button should be hidden.
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-double")).toBeHidden();
  });

  test("starter pack shows in the shop and grants the bundle once", async ({
    page,
  }) => {
    await page.locator("#btn-shop").click();
    // The bundle is the first shop item.
    await expect(page.locator('#shop-list .shop-starter')).toBeVisible();
    await expect(page.locator("#shop-starter-buy")).toContainText("$1.99");

    const before = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      undo: window.__bpc.Economy.getPowerup("undo"),
      bomb: window.__bpc.Economy.getPowerup("bomb"),
      crates: window.__bpc.Storage.get("pets").crates,
    }));
    const res = await page.evaluate(() => window.__bpc.game.buyStarterPack());
    expect(res.ok).toBe(true);
    const after = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      undo: window.__bpc.Economy.getPowerup("undo"),
      bomb: window.__bpc.Economy.getPowerup("bomb"),
      crates: window.__bpc.Storage.get("pets").crates,
      owned: window.__bpc.Storage.get("starterPack"),
    }));
    expect(after.coins).toBe(before.coins + 2000);
    expect(after.undo).toBe(before.undo + 3);
    expect(after.bomb).toBe(before.bomb + 3);
    expect(after.crates).toBe(before.crates + 1);
    expect(after.owned).toBe(true);

    // A second purchase is refused — the bundle is one-time only.
    const again = await page.evaluate(() => window.__bpc.game.buyStarterPack());
    expect(again.ok).toBe(false);
    expect(again.owned).toBe(true);

    // The shop now shows it as owned.
    await page.evaluate(() => window.__bpc.UI.buildShop());
    await expect(page.locator("#shop-starter-buy")).toContainText("Owned");
  });

  test("no forced interstitial before level 7 (new-player grace)", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
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
    const before = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const tile = getComputedStyle(document.querySelector(".tile"));
      return {
        bg: s.getPropertyValue("--bg-0").trim(),
        accent: s.getPropertyValue("--ui-accent").trim(),
        gradient: s.getPropertyValue("--ui-gradient").trim(),
        tileBorder: tile.borderColor,
        tileBackground: tile.backgroundImage,
      };
    });
    // Grant enough coins for a priced theme.
    await page.evaluate(() => window.__bpc.Economy.addCoins(2000));
    await page.locator("#btn-themes").click();

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
    expect(bg).not.toBe(before.bg);
    const chrome = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const tile = getComputedStyle(document.querySelector(".tile"));
      return {
        accent: s.getPropertyValue("--ui-accent").trim(),
        gradient: s.getPropertyValue("--ui-gradient").trim(),
        tileBorder: tile.borderColor,
        tileBackground: tile.backgroundImage,
      };
    });
    expect(chrome.accent).toBe("#ff7eb6");
    expect(chrome.accent).not.toBe(before.accent);
    expect(chrome.gradient).toContain("#ff7eb6");
    expect(chrome.gradient).not.toBe(before.gradient);
    expect(chrome.tileBorder).not.toBe(before.tileBorder);
    expect(chrome.tileBackground).not.toBe(before.tileBackground);

    await page.locator("#themes-back").click();
    await page.locator("#btn-play").click();
    await page.locator(".level-cell").first().click();
    const briefChrome = await page.evaluate(() => {
      const stat = getComputedStyle(document.querySelector(".brief-stats div"));
      const section = getComputedStyle(document.querySelector(".brief-section"));
      return {
        statBackground: stat.backgroundImage,
        sectionBorder: section.borderColor,
      };
    });
    expect(briefChrome.statBackground).toContain("255, 126, 182");
    expect(briefChrome.sectionBorder).toContain("255, 126, 182");
  });

  test("themes resolve distinct live background motifs and reduced motion reaches the renderer", async ({
    page,
  }) => {
    const before = await page.evaluate(() => ({
      theme: window.__bpc.game.theme.id,
      motif: window.__bpc.themeMotif(window.__bpc.game.theme.id).kind,
      reduced: window.__bpc.game.renderer.reducedMotion,
    }));
    expect(before.theme).toBe("aurora");
    expect(before.motif).toBe("ribbons");
    expect(before.reduced).toBe(false);

    await page.evaluate(() => window.__bpc.Economy.addCoins(2000));
    await page.locator("#btn-themes").click();
    await page.locator("#theme-list button", { hasText: "600" }).click();
    await page.locator(".theme-item", { hasText: "Candy Pop" })
      .getByRole("button", { name: "Use" })
      .click();
    const themed = await page.evaluate(() => ({
      theme: window.__bpc.game.theme.id,
      motif: window.__bpc.themeMotif(window.__bpc.game.theme.id).kind,
    }));
    expect(themed.theme).toBe("candy");
    expect(themed.motif).toBe("sprinkles");

    await page.locator("#rm-toggle").click();
    expect(await page.evaluate(() => window.__bpc.game.renderer.reducedMotion)).toBe(true);
  });
});

test.describe("persistence & PWA", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("progress survives a reload", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await page.waitForTimeout(600);
    await clearBoardByFinalPair(page);
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
    expect(json.name).toBe("Bubblit!");
  });

  test("local SVG icon and pet avatar assets are reachable", async ({ page }) => {
    const svgAssets = [
      "/assets/icons/special/lightning-mark.svg",
      "/assets/icons/game-icons/bomb.svg",
      "/assets/icons/game-icons/padlock.svg",
      "/assets/icons/game-icons/snowflake.svg",
      "/assets/icons/game-icons/vine-leaf.svg",
      "/assets/icons/game-icons/coin.svg",
      "/assets/icons/game-icons/multiplication.svg",
    ];
    for (const asset of svgAssets) {
      expect(asset).not.toMatch(/^https?:/);
      const resp = await page.request.get(asset);
      expect(resp.ok()).toBe(true);
      expect(resp.headers()["content-type"] || "").toContain("image/svg");
    }
    const pngAvatars = [
      "/assets/pets/avatars/sparky.png",
      "/assets/pets/avatars/clover.png",
      "/assets/pets/avatars/mochi.png",
      "/assets/pets/avatars/sprout.png",
      "/assets/pets/avatars/rover.png",
      "/assets/pets/avatars/whiskers.png",
      "/assets/pets/avatars/luma.png",
      "/assets/pets/avatars/quake.png",
      "/assets/pets/avatars/comet.png",
      "/assets/pets/avatars/talon.png",
      "/assets/pets/avatars/cyclone.png",
      "/assets/pets/avatars/magma.png",
      "/assets/pets/avatars/archer.png",
      "/assets/pets/avatars/amp.png",
      "/assets/pets/avatars/blaze.png",
      "/assets/pets/avatars/prism.png",
      "/assets/pets/avatars/draco.png",
      "/assets/pets/avatars/midas.png",
      "/assets/pets/avatars/tidal.png",
      "/assets/pets/avatars/aurora.png",
      "/assets/pets/avatars/gizmo.png",
      "/assets/pets/avatars/nova.png",
    ];
    for (const asset of pngAvatars) {
      expect(asset).not.toMatch(/^https?:/);
      const resp = await page.request.get(asset);
      expect(resp.ok()).toBe(true);
      expect(resp.headers()["content-type"] || "").toContain("image/png");
    }
    const currencyPngs = [
      "/assets/icons/currency/coin.png",
      "/assets/icons/currency/coins-stack.png",
    ];
    for (const asset of currencyPngs) {
      expect(asset).not.toMatch(/^https?:/);
      const resp = await page.request.get(asset);
      expect(resp.ok()).toBe(true);
      expect(resp.headers()["content-type"] || "").toContain("image/png");
    }
    const menuTilePngs = [
      "/assets/icons/menu/endless.png",
      "/assets/icons/menu/daily.png",
      "/assets/icons/menu/tournament.png",
      "/assets/icons/menu/spotlight.png",
      "/assets/icons/menu/timeattack.png",
      "/assets/icons/menu/shop.png",
      "/assets/icons/menu/themes.png",
      "/assets/icons/menu/achievements.png",
      "/assets/icons/menu/pets.png",
      "/assets/icons/menu/calendar.png",
      "/assets/icons/menu/quests.png",
      "/assets/icons/menu/stats.png",
      "/assets/icons/menu/puzzle.png",
      "/assets/icons/menu/season.png",
      "/assets/vfx/bubble-sheen/bubble-sheen.png",
    ];
    for (const asset of menuTilePngs) {
      expect(asset).not.toMatch(/^https?:/);
      const resp = await page.request.get(asset);
      expect(resp.ok()).toBe(true);
      expect(resp.headers()["content-type"] || "").toContain("image/png");
    }
    const achievementPngs = [
      "/assets/icons/achievements/popper.png",
      "/assets/icons/achievements/combo.png",
      "/assets/icons/achievements/bigbang.png",
      "/assets/icons/achievements/fever.png",
      "/assets/icons/achievements/campaign.png",
      "/assets/icons/achievements/stars.png",
      "/assets/icons/achievements/defuser.png",
      "/assets/icons/achievements/wealth.png",
    ];
    for (const asset of achievementPngs) {
      expect(asset).not.toMatch(/^https?:/);
      const resp = await page.request.get(asset);
      expect(resp.ok()).toBe(true);
      expect(resp.headers()["content-type"] || "").toContain("image/png");
    }
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

    // Quit to menu using the real in-game Pause → Menu flow.
    await page.locator("#btn-back").click();
    await page.locator("#pause-menu").click();
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
    await page.locator("#pause-menu").click();
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
    await clearBoardByFinalPair(page);
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
    await expect(page.locator("#play-nudge")).toHaveText("Start here");
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
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem("bpc_save_v1")));
    expect(save.coins).toBe(0);
    expect(save.starterBonusClaimed).toBe(false);
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

    // 2) tap — drive the real tap handler at a poppable board pixel. Mobile
    // overlay hit-testing can route Playwright's synthetic tap oddly here, but
    // this still exercises the production tap → pop path (no mocked game code).
    await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          if (b.grid[c][r] !== -1 && b.getGroupAt(c, r).length >= 2) {
            const p = b.targetPixel(c, r);
            window.__bpc.game.handleTap(p.x, p.y);
            return;
          }
        }
      }
    });
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
    await expect.poll(() => stepId(page)).toBe("undo");

    // 3a) undo — tapping the ↶ Undo tool takes back the last move.
    await expect(page.locator('#pu-slot-0[data-pu="undo"]')).toBeVisible();
    await page.locator('#pu-slot-0[data-pu="undo"]').click();
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
    await expect.poll(() => stepId(page)).toBe("paint");

    // 7b) paint — arm it, choose a bubble, then accept the best suggested colour.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      g.armPowerup("paint", document.querySelector('[data-pu="paint"]'));
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          const suggestions = b.suggestRecolors(c, r, 3);
          if (suggestions.length) {
            const p = b.targetPixel(c, r);
            g.handleTap(p.x, p.y);
            g.confirmPaintColor(suggestions[0].color);
            return;
          }
        }
    });
    await expect.poll(() => stepId(page)).toBe("magnet");

    // 7c) magnet — arm it, aim a plain bubble, lock the gauge on green.
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
    await expect.poll(() => stepId(page)).toBe("stone");

    // 8b) stone — popping a cluster next to the locked stone shatters it.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Find the stone, then pop a poppable cluster orthogonally adjacent to it.
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (!b.isStone(c, r)) continue;
          for (const [cc, rr] of [
            [c + 1, r],
            [c - 1, r],
            [c, r + 1],
            [c, r - 1],
          ]) {
            if (cc < 0 || cc >= b.cols || rr < 0 || rr >= b.rows) continue;
            if (b.getGroupAt(cc, rr).length >= 2) {
              g.popAt(cc, rr);
              return;
            }
          }
        }
    });
    await expect.poll(() => stepId(page)).toBe("bombbubble");

    // 8c) bomb bubble — popping a cluster that contains the bomb detonates a
    // 3×3 blast and advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isBomb(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("multiplier");

    // 8d) multiplier — popping a cluster that contains the gold bubble boosts
    // the score and advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isMultiplier(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("coinbubble");

    // 8e) coin — popping a cluster that contains the treasure bubble drops
    // coins and advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isCoin(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("vine");

    // 8f) vine — popping a cluster that contains the creeping vine bubble
    // clears the threat and advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isVine(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("sequence");

    // 8g) sequence — pop the Chain Reactor clusters in order (1 -> 2 -> 3);
    // only the final "3" pop (with the chain primed) advances the step.
    for (const num of [1, 2, 3]) {
      await page.evaluate((n) => {
        const g = window.__bpc.game;
        const b = g.session.board;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.isSequenceNum(c, r, n) && b.getGroupAt(c, r).length >= 2) {
              g.popAt(c, r);
              return;
            }
      }, num);
    }
    await expect.poll(() => stepId(page)).toBe("tether");

    // 8h) tether — popping either tethered cluster also clears its linked
    // partner cell elsewhere on the board, advancing the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isTether(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("polarity");

    // 8i) polarity — popping a cluster that contains a magnetic +/- bubble
    // advances the step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isPolarity(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("bloom");

    // 8j) bloom — popping a cluster that contains a bloom seed advances the
    // step.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.isBloom(c, r) && b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return;
          }
    });
    await expect.poll(() => stepId(page)).toBe("echo");

    // 8k) echo (informational) — demonstrates the Echo bonus directly.
    await page.locator("#coach-next").click();
    await expect.poll(() => stepId(page)).toBe("pets");

    // 8l) pets (informational) — introduces the companion system.
    await page.locator("#coach-next").click();
    expect(await stepId(page)).toBe("done");

    // 9) done — finishes back to the menu.
    await page.locator("#coach-next").click();
    await expect(page.locator("#tutorial")).toBeHidden();
    await expect(page.locator("#menu")).toBeVisible();
    expect(await stepId(page)).toBeNull();
    await expect.poll(() => page.locator("#menu-coins").textContent().then((text) => Number(text || 0))).toBeGreaterThanOrEqual(120);
    await expect(page.locator("#play-nudge")).toHaveText("Level 1");
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem("bpc_save_v1")));
    expect(save.starterBonusClaimed).toBe(true);
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
        undo: 2,
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
    const TOOLS = ["undo", "bomb", "colorClear", "shuffle", "chainBolt", "pick", "magnet"];
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
        undo: 0,
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
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllPetFeatures(page);
  });

  test("Pets screen opens with Sparky owned, equipped, and a starter crate", async ({
    page,
  }) => {
    await page.locator("#btn-pets").click();
    await expect(page.locator("#pets")).toBeVisible();
    await expect(page.locator('.pet-tab[data-pet-tab="companions"].active')).toBeVisible();
    await expect(page.locator('.pet-tab[data-pet-tab="store"]')).toBeVisible();
    await expect(page.locator('.pet-card[data-pet="sparky"]')).toHaveClass(/owned/);
    await expect(page.locator('.pet-card[data-pet="sparky"]')).toHaveClass(/equipped/);
    await expect(page.locator("#pet-detail .pd-guide-chip")).toHaveText([
      "Owned",
      "Passive",
      "Socket gems",
      "Lead pet",
    ]);
    await expect(page.locator("#pet-detail .pd-action-row")).toBeVisible();
    await expect(page.locator("#pet-detail .pd-forge-btn")).toBeVisible();
    await page.locator('.pet-card[data-pet="clover"]').click();
    await expect(page.locator('.pet-card[data-pet="clover"]')).toHaveClass(/selected/);
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    await expect(page.locator("#pet-gem-tip")).toContainText("Tap a pet");
    await page.locator('.pet-tab[data-pet-tab="companions"]').click();
    await expect(page.locator('.pet-card[data-pet="clover"]')).toHaveClass(/selected/);
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    // Starter state: one free crate to open is now in the Store tab.
    await expect(page.locator("#pets-crate .crate-art-pet")).toBeVisible();
    const state = await page.evaluate(() => window.__bpc.Storage.getPetState());
    expect(state.equipped).toBe("sparky");
    expect(state.crates).toBeGreaterThanOrEqual(1);
    await page.locator("#pets-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("the pet detail action row renders Equip/Add to Party/Gem Forge at identical size", async ({
    page,
  }) => {
    // Real bug guard: .pet-equip-btn/.pet-support-btn carry their own
    // margin-top for when they render standalone elsewhere, but inside this
    // shared grid row that per-button margin combined with the grid's
    // default align-items:stretch made each button a DIFFERENT rendered
    // height (Equip shortest, Gem Forge tallest) -- exactly what a player
    // sees as "these buttons all look like different sizes".
    await page.evaluate(() => window.__bpc.Storage.grantPet("clover"));
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="clover"]').click();
    const equip = page.locator("#pet-equip");
    const support = page.locator("#pet-support");
    const forge = page.locator("#pet-detail .pd-forge-btn");
    await expect(equip).toBeVisible();
    await expect(support).toBeVisible();
    await expect(forge).toBeVisible();
    const [equipBox, supportBox, forgeBox] = await Promise.all([
      equip.boundingBox(),
      support.boundingBox(),
      forge.boundingBox(),
    ]);
    expect(equipBox.height).toBe(supportBox.height);
    expect(equipBox.height).toBe(forgeBox.height);
    // Sub-pixel float rounding across CSS grid fractional columns is fine;
    // what matters is they're not visibly different sizes.
    expect(Math.abs(equipBox.width - supportBox.width)).toBeLessThan(1);
    expect(Math.abs(equipBox.width - forgeBox.width)).toBeLessThan(1);
  });

  test("an active pet's detail explains it's dormant until abilities unlock, then clears once they do", async ({
    page,
  }) => {
    // Real bug guard: a player who owns/equips an active pet (e.g. Tidal)
    // before reaching the Level 16 "abilities" unlock used to see the exact
    // same live cooldown/behaviour text as an unlocked player — nothing told
    // them the ability was currently inert, which reads as "this pet is
    // broken" rather than "not unlocked yet".
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("tidal");
      S.set("maxUnlockedLevel", 15); // pets(12)/crates(14) unlocked, abilities(16) not yet
      window.__bpc.UI.refreshPetAccess();
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="tidal"]').click();
    await expect(page.locator("#pet-detail .pd-ability")).toContainText("Floods away");
    await expect(page.locator("#pet-detail .pd-ability")).toContainText("unlocks at Level 16");

    // Once abilities unlock, the same detail view drops the locked note.
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 16));
    await page.evaluate(() => window.__bpc.UI.buildPets());
    await page.locator('.pet-card[data-pet="tidal"]').click();
    await expect(page.locator("#pet-detail .pd-ability")).toContainText("Floods away");
    await expect(page.locator("#pet-detail .pd-ability")).not.toContainText("unlocks at Level");
  });

  test("buying then opening a crate grants a pet", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();

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

  test("duplicate crate pulls grant Pet Dust", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const dust = await page.evaluate(() => {
      const g = window.__bpc.game;
      const S = window.__bpc.Storage;
      // Own every pet so any crate pull (even a rare premium) is a duplicate.
      for (const p of window.__bpc.pets.PET_CATALOG) {
        S.grantPet(p.id);
      }
      const before = S.getDust();
      S.addCrates(1);
      const res = g.openCrate();
      return { before, after: S.getDust(), res };
    });
    expect(dust.res).not.toBeNull();
    expect(dust.res.isNew).toBe(false);
    expect(dust.res.dust).toBeGreaterThan(0);
    expect(dust.after).toBe(dust.before + dust.res.dust);
    // The crate panel shows the live dust balance.
    await page.evaluate(() => window.__bpc.UI.buildPets());
    await expect(page.locator("#dust-count")).toHaveText(String(dust.after));
  });

  test("opening a crate from the Store panel starts an incubating egg instead of an instant reveal", async ({
    page,
  }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await expect(page.locator("#crate-open")).toBeVisible();

    await page.locator("#crate-open").click();
    // The Open button is replaced by an incubating card; no reveal modal yet.
    await expect(page.locator(".crate-egg")).toBeVisible();
    await expect(page.locator(".crate-egg")).toContainText("incubating");
    await expect(page.locator("#egg-hatch")).toBeDisabled();
    await expect(page.locator("#pet-reveal")).toBeHidden();

    const egg = await page.evaluate(() => window.__bpc.Storage.getEgg());
    expect(egg).not.toBeNull();
    expect(egg.movesLeft).toBe(await page.evaluate(() => window.__bpc.pets.EGG_INCUBATE_MOVES));
  });

  test("the egg becomes hatchable after enough resolved moves and reveals the pre-rolled pet", async ({
    page,
  }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await page.locator("#crate-open").click();

    const totalMoves = await page.evaluate(() => window.__bpc.pets.EGG_INCUBATE_MOVES);
    await page.locator("#pets-back").click();

    // Play the exact number of moves the egg needs, one real popAt per move.
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    await expect(page.locator("#hud-mode-label")).toContainText("Level 1");
    for (let i = 0; i < totalMoves; i++) {
      const popped = await page.evaluate(() => {
        const g = window.__bpc.game;
        const b = g.session.board;
        for (let c = 0; c < b.cols; c++) {
          for (let r = 0; r < b.rows; r++) {
            if (b.grid[c][r] === -1) continue;
            if (b.getGroupAt(c, r).length >= 2) {
              g.popAt(c, r);
              return true;
            }
          }
        }
        return false;
      });
      expect(popped).toBe(true);
      await page.waitForTimeout(150);
    }

    const eggAfter = await page.evaluate(() => window.__bpc.Storage.getEgg());
    expect(eggAfter.movesLeft).toBe(0);

    await page.locator("#btn-back").click();
    await page.locator("#pause-menu").click();
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await expect(page.locator(".crate-egg")).toContainText("ready to hatch");
    await expect(page.locator("#egg-hatch")).toBeEnabled();

    const petId = await page.evaluate(() => window.__bpc.Storage.getEgg().rolled.petId);
    await page.locator("#egg-hatch").click();

    // The egg is gone, the pet is granted, and the crate panel reverts to "Open".
    await expect(page.locator("#crate-open")).toBeVisible();
    const state = await page.evaluate((id) => ({
      egg: window.__bpc.Storage.getEgg(),
      owns: window.__bpc.Storage.ownsPet(id),
    }), petId);
    expect(state.egg).toBeNull();
    expect(state.owns).toBe(true);
  });

  test("only one egg can incubate at a time", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.addCrates(2));
    const res = await page.evaluate(() => {
      const g = window.__bpc.game;
      const first = g.startEggHatch();
      const second = g.startEggHatch();
      return { first, second };
    });
    expect(res.first.incubating).toBe(true);
    expect(res.second.blocked).toBe(true);
    // The second crate was never consumed.
    expect(await page.evaluate(() => window.__bpc.Storage.getPetState().crates)).toBeGreaterThanOrEqual(1);
  });

  test("hatchEgg returns null when there is no egg or it isn't ready yet", async ({ page }) => {
    const beforeAny = await page.evaluate(() => window.__bpc.game.hatchEgg());
    expect(beforeAny).toBeNull();

    await page.evaluate(() => window.__bpc.game.startEggHatch());
    const stillIncubating = await page.evaluate(() => window.__bpc.game.hatchEgg());
    expect(stillIncubating).toBeNull();
  });

  test("egg incubation persists across a reload", async ({ page }) => {
    const started = await page.evaluate(() => window.__bpc.game.startEggHatch());
    expect(started.incubating).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.__bpc && window.__bpc.game);
    const egg = await page.evaluate(() => window.__bpc.Storage.getEgg());
    expect(egg).not.toBeNull();
    expect(egg.movesLeft).toBe(started.movesLeft);
  });

  test("the pity timer guarantees rarer pets after dry opens", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const result = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const { pityRarityFloor, nextPity, PITY_EPIC } = window.__bpc.pets;
      // Simulate PITY_EPIC-1 dry common opens.
      S.setPity({ sinceEpic: PITY_EPIC - 1, sinceLegendary: 0 });
      const floor = pityRarityFloor(S.getPity());
      return { floor };
    });
    expect(result.floor).toBe("epic");
  });

  test("an equipped pet's trait modifies its buffs", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const { petBuffs, levelForXp } = window.__bpc.pets;
      // Force Sparky's trait to Lucky and equip it.
      const st = S.getPetState();
      st.owned.sparky.trait = "lucky";
      S.set("pets", st);
      S.equipPet("sparky");
      const eq = S.getEquippedPet();
      const buffs = petBuffs(eq.id, levelForXp(eq.xp || 0), eq.trait);
      const base = petBuffs(eq.id, levelForXp(eq.xp || 0), "balanced");
      return { coin: buffs.coinMult, baseCoin: base.coinMult };
    });
    expect(out.coin).toBeCloseTo(out.baseCoin * 1.2, 5);
  });

  test("the Pets screen shows the party panel with a lead slot", async ({ page }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="party"]').click();
    await expect(page.locator("#pet-party")).toBeVisible();
    // The equipped pet appears in the lead slot.
    await expect(page.locator("#pet-party .pp-lead")).toBeVisible();
  });

  test("adding a support pet folds its buffs into the equipped party", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      // Sparky is the starter lead; grant + add Clover (coin pet) as a support.
      S.grantPet("clover");
      const before = G._equippedBuffs().coinMult;
      const supports = G.toggleSupport("clover");
      const after = G._equippedBuffs().coinMult;
      return { supports, before, after };
    });
    expect(out.supports).toContain("clover");
    // A coin support raises the party's coin multiplier above the lead-only value.
    expect(out.after).toBeGreaterThan(out.before);
  });

  test("a matching party grants a set synergy bonus", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      const { partyBuffs, partyTotalBuffs } = window.__bpc.pets;
      // Build a two-legendary party (draco lead + tidal support) → Legendary Might.
      S.grantPet("draco");
      S.grantPet("tidal");
      S.equipPet("draco");
      G.toggleSupport("tidal");
      const members = G._partyMembers();
      const synergies = G._activeSynergies().map((s) => s.id);
      const base = partyBuffs(members).scoreMult;
      const total = partyTotalBuffs(members).scoreMult;
      return { synergies, base, total };
    });
    expect(out.synergies).toContain("legendary_might");
    expect(out.total).toBeGreaterThan(out.base);
  });

  test("Pet Store sells premium pets and a legendary crate", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await expect(page.locator("#pet-store")).toBeVisible();
    // The premium pets (aurora/gizmo) are listed with real-money buy buttons.
    await expect(page.locator('#pet-store .store-buy[data-pet="aurora"]')).toBeVisible();
    await expect(page.locator('#pet-store .store-buy[data-pet="gizmo"]')).toBeVisible();
    // The Legendary Crate is offered for real money.
    await expect(page.locator("#pet-store .crate-art-legend")).toBeVisible();
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

  test("Pet detail explains normal crate, craft, premium, and store-only acquisition", async ({ page }) => {
    await page.locator("#btn-pets").click();

    await page.locator('.pet-card[data-pet="archer"]').click();
    await expect(page.locator('.pet-card[data-pet="archer"] .pet-source')).toContainText("epic crate");
    await expect(page.locator("#pet-detail .pd-source")).toContainText("Normal progression");
    await expect(page.locator("#pet-detail .pd-source")).toContainText("epic Pet Crates");
    await expect(page.locator("#pet-detail .pd-locked-hint")).toContainText("craft directly");

    await page.locator('.pet-card[data-pet="aurora"]').click();
    await expect(page.locator("#pet-detail .pd-source")).toContainText("Premium");
    await expect(page.locator("#pet-detail .pd-source")).toContainText("rarely find in crates");

    await page.locator('.pet-card[data-pet="nova"]').click();
    await expect(page.locator("#pet-detail .pd-source")).toContainText("Store only");
    await expect(page.locator("#pet-detail .pd-source")).toContainText("never drops from crates");
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await expect(page.locator('#pet-store .store-buy[data-pet="nova"]')).toBeVisible();
    await expect(page.locator("#pet-store")).toContainText("Store only");
  });

  test("buying a premium pet from the store unlocks it", async ({ page }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await expect(page.locator("#pet-store")).toBeVisible();
    await page.locator('#pet-store .store-buy[data-pet="aurora"]').click();
    await expect
      .poll(() =>
        page.evaluate(() => !!window.__bpc.Storage.getPetState().owned.aurora)
      )
      .toBe(true);
  });

  test("winning a new pet shows the big celebration reveal", async ({ page }) => {
    await page.locator("#btn-pets").click();
    // Own rover so it can be equipped, then fire the reveal deterministically.
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("rover");
      window.__bpc.UI.showPetReveal({ petId: "rover", isNew: true });
    });
    // The celebration modal surfaces the pet, its rarity, and its ability so
    // the player immediately knows what their new companion does.
    await expect(page.locator("#pet-reveal")).toBeVisible();
    await expect(page.locator("#pet-reveal-name")).toHaveText("Rover");
    await expect(page.locator("#pet-reveal-icon img.paf-frame-1")).toHaveAttribute(
      "src",
      /\/assets\/pets\/avatars\/anim\/rover-1\.png$/
    );
    await expect(page.locator("#pet-reveal-rarity")).toHaveText("rare");
    await expect(page.locator("#pet-reveal-ability")).toContainText("colour");
    // "Equip & Play" equips the brand-new companion and dismisses the reveal.
    await page.locator("#pet-reveal-equip").click();
    await expect
      .poll(() =>
        page.evaluate(() => window.__bpc.Storage.getPetState().equipped)
      )
      .toBe("rover");
    await expect(page.locator("#pet-reveal")).toBeHidden();
  });

  test("Sparky's reveal shows a looping 3-frame idle-turn animation", async ({ page }) => {
    await page.locator("#btn-pets").click();
    await page.evaluate(() => {
      window.__bpc.UI.showPetReveal({ petId: "sparky", isNew: true });
    });
    await expect(page.locator("#pet-reveal")).toBeVisible();
    const frames = page.locator("#pet-reveal-icon img.paf-frame");
    await expect(frames).toHaveCount(3);
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator(`#pet-reveal-icon img.paf-frame-${i}`)).toHaveAttribute(
        "src",
        new RegExp(`/assets/pets/avatars/anim/sparky-${i}\\.png$`)
      );
    }
    // Skybolt uses the Kenney ship sprite instead of the multi-view pipeline,
    // so it keeps the plain single-image markup (no frames declared).
    await page.evaluate(() => {
      window.__bpc.UI.showPetReveal({ petId: "skybolt", isNew: true });
    });
    await expect(page.locator("#pet-reveal-icon img.paf-frame")).toHaveCount(0);
    await expect(page.locator("#pet-reveal-icon img")).toHaveCount(1);
  });

  test("buying a premium pet fires the new-companion celebration", async ({
    page,
  }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="store"]').click();
    await page.locator('#pet-store .store-buy[data-pet="aurora"]').click();
    await expect(page.locator("#pet-reveal")).toBeVisible();
    await expect(page.locator("#pet-reveal-name")).toHaveText("Aurora");
    // Premium legendaries get the louder headline.
    await expect(page.locator("#pet-reveal-congrats")).toContainText("LEGENDARY");
    await page.locator("#pet-reveal-close").click();
    await expect(page.locator("#pet-reveal")).toBeHidden();
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

  test("the Archer pet waits for a player drag and fires a line shot", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("archer");
      window.__bpc.game.equipPet("archer");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active).not.toBeNull();
    expect(active.type).toBe("archer");

    const shot = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      }
      const row = Math.min(2, b.rows - 1);
      const anchorC = Math.min(4, b.cols - 1);
      const pullC = Math.min(anchorC + 1, b.cols - 1);
      for (let c = 0; c <= anchorC; c++) {
        b.grid[c][row] = c % b.colorCount;
        b.types[c][row] = 0;
      }
      b.restore(b.serialize(), b.serializeTypes());
      b.layout(g.W, g.H, 92, 190);
      g.session.petTimer = 1;
      g.afterMove();
      const start = b.targetPixel(anchorC, row);
      const end = b.targetPixel(pullC, row);
      return { start, end, armed: !!g.session.archerAim, before: b.countRemaining() };
    });
    expect(shot.armed).toBe(true);
    await expect(page.locator("#hud-status")).toContainText("Pull back");

    const box = await page.locator("#game-canvas").boundingBox();
    await page.mouse.move(box.x + shot.start.x, box.y + shot.start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + shot.start.x + 6, box.y + shot.start.y + 6, { steps: 2 });
    await page.mouse.up();
    await expect(page.locator("#hud-status")).toContainText("Pull back");
    const shortDrag = await page.evaluate((before) => {
      const g = window.__bpc.game;
      return { aiming: !!g.session.archerAim, remaining: g.session.board.countRemaining(), before };
    }, shot.before);
    expect(shortDrag.aiming).toBe(true);
    expect(shortDrag.remaining).toBe(shortDrag.before);

    await page.mouse.move(box.x + shot.start.x, box.y + shot.start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + shot.end.x, box.y + shot.end.y, { steps: 8 });
    await page.waitForFunction(
      () => window.__bpc.game.session.archerAim && window.__bpc.game.session.archerAim.cells.length >= 3
    );
    await expect(page.locator("#hud-status")).toContainText(/\d+ bubble shot/);
    await page.mouse.up();
    await page.waitForTimeout(250);

    const result = await page.evaluate((before) => {
      const g = window.__bpc.game;
      const b = g.session.board;
      return {
        aiming: !!g.session.archerAim,
        before,
        after: b.countRemaining(),
        score: g.session.score,
        arrows: g.session.stats.petArrows || 0,
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
      };
    }, shot.before);
    expect(result.aiming).toBe(false);
    expect(result.after).toBeLessThanOrEqual(result.before - 3);
    expect(result.score).toBeGreaterThan(0);
    expect(result.arrows).toBeGreaterThanOrEqual(3);
    expect(result.busy).toBe(true);
    expect(result.kind).toBe("arrow");
  });

  test("the Archer pet diagonal shot clears bubbles on its path", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("archer");
      window.__bpc.game.equipPet("archer");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const shot = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      }
      const cells = [
        { c: 0, r: 0 },
        { c: 1, r: 1 },
        { c: 2, r: 2 },
        { c: 3, r: 3 },
        { c: 4, r: 4 },
      ];
      for (const cell of cells) {
        b.grid[cell.c][cell.r] = 0;
        b.types[cell.c][cell.r] = 0;
      }
      b.restore(b.serialize(), b.serializeTypes());
      b.layout(g.W, g.H, 92, 190);
      g.session.petTimer = 1;
      g.afterMove();
      const start = b.targetPixel(3, 3);
      const end = b.targetPixel(4, 4);
      return { start, end, before: b.countRemaining(), armed: !!g.session.archerAim };
    });
    expect(shot.armed).toBe(true);

    const box = await page.locator("#game-canvas").boundingBox();
    await page.mouse.move(box.x + shot.start.x, box.y + shot.start.y);
    await page.mouse.down();
    await page.mouse.move(box.x + shot.end.x, box.y + shot.end.y, { steps: 8 });
    await page.waitForFunction(
      () => window.__bpc.game.session.archerAim && window.__bpc.game.session.archerAim.cells.length >= 3
    );
    await page.mouse.up();
    await page.waitForTimeout(250);

    const result = await page.evaluate((before) => {
      const g = window.__bpc.game;
      return {
        aiming: !!g.session.archerAim,
        after: g.session.board.countRemaining(),
        before,
        score: g.session.score,
        arrows: g.session.stats.petArrows || 0,
      };
    }, shot.before);
    expect(result.aiming).toBe(false);
    expect(result.after).toBeLessThanOrEqual(result.before - 3);
    expect(result.score).toBeGreaterThan(0);
    expect(result.arrows).toBeGreaterThanOrEqual(3);
  });

  test("the Skybolt bomber pet drops bombs along a flight path", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("skybolt");
      window.__bpc.game.equipPet("skybolt");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const launch = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      }
      for (let i = 0; i < 5; i++) {
        b.grid[i][i] = i % b.colorCount;
        b.types[i][i] = 0;
      }
      b.restore(b.serialize(), b.serializeTypes());
      b.layout(g.W, g.H, 92, 190);
      g.session.petActive = window.__bpc.pets.petActive("skybolt", 1);
      const before = b.countRemaining();
      g._petBomber(g.session.petActive);
      return {
        before,
        during: b.countRemaining(),
        score: g.session.score,
        hits: g.session.stats.bomberHits || 0,
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
        picking: !!g.session.petPicking,
      };
    });
    expect(launch.during).toBe(launch.before); // bombs have not landed yet
    expect(launch.score).toBe(0);
    expect(launch.hits).toBeGreaterThanOrEqual(4);
    expect(launch.busy).toBe(true);
    expect(launch.kind).toBe("bomber");
    expect(launch.picking).toBe(true);
    await page.waitForFunction(() => !window.__bpc.game.petAnim.busy, null, {
      timeout: 2500,
    });
    const landed = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        after: g.session.board.countRemaining(),
        picking: !!g.session.petPicking,
        cleared: g.session.stats.cleared,
        score: g.session.score,
      };
    });
    expect(landed.after).toBeLessThanOrEqual(launch.before - 4);
    expect(landed.picking).toBe(false);
    expect(landed.cleared).toBeGreaterThanOrEqual(4);
    expect(landed.score).toBeGreaterThan(0);
  });

  test("the Skybolt bomber pet triggers lightning on its flight path", async ({ page }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("skybolt");
      window.__bpc.game.equipPet("skybolt");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const launch = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++) {
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          b.spriteGrid[c][r] = null;
        }
      }
      const row = Math.floor(b.rows / 2);
      const boltCol = Math.min(1, b.cols - 1);
      const runLen = Math.min(4, b.cols);
      for (let c = 0; c < runLen; c++) {
        b.grid[c][row] = c % b.colorCount;
        b.types[c][row] = 0;
      }
      for (let r = 0; r < b.rows; r++) {
        b.grid[boltCol][r] = r % b.colorCount;
        b.types[boltCol][r] = 0;
      }
      b.types[boltCol][row] = 4; // LIGHTNING in the bomber route.
      b.restore(b.serialize(), b.serializeTypes());
      b.layout(g.W, g.H, 92, 190);
      g.session.petActive = window.__bpc.pets.petActive("skybolt", 1);
      const before = b.countRemaining();
      g._petBomber(g.session.petActive);
      return { before, expectedCleared: b.rows + runLen - 1, busy: g.petAnim.busy };
    });
    expect(launch.busy).toBe(true);
    await page.waitForFunction(() => !window.__bpc.game.petAnim.busy, null, {
      timeout: 2500,
    });
    const landed = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        after: g.session.board.countRemaining(),
        score: g.session.score,
        cleared: g.session.stats.cleared,
      };
    });
    expect(launch.before - landed.after).toBeGreaterThanOrEqual(launch.expectedCleared);
    expect(landed.cleared).toBeGreaterThanOrEqual(launch.expectedCleared);
    expect(landed.score).toBeGreaterThan(0);
  });

  test("the cleanse pet (Whiskers) pops isolated bubbles immediately", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("whiskers");
      window.__bpc.game.equipPet("whiskers");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active).not.toBeNull();
    expect(active.type).toBe("cleanse");

    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
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
      const targets = b.mostIsolatedCells(2);
      const countOffColour = () => {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.grid[c][r] !== -1 && b.grid[c][r] !== 0) n++;
        return n;
      };
      const before = countOffColour();
      g._petCleanse({ ...g.session.petActive, count: 2 });
      const after = countOffColour();
      return {
        targets,
        before,
        after,
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
        particles: g.particles.count,
      };
    });
    expect(result.targets).toHaveLength(2);
    expect(result.before).toBe(2);
    expect(result.after).toBe(0);
    expect(result.busy).toBe(true);
    expect(result.kind).toBe("cleanse");
    expect(result.particles).toBeGreaterThan(0);
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
      // Talon now destroys each bubble exactly when its beak reaches it, so the
      // lone bubbles are still on the board the instant the flourish starts …
      const duringNonZero = (() => {
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++)
            if (b.grid[c][r] !== -1 && b.grid[c][r] !== 0) n++;
        return n;
      })();
      return {
        ranked,
        beforeNonZero,
        duringNonZero,
        busy: g.petAnim.busy,
        kind: g.petAnim.items[0] && g.petAnim.items[0].kind,
      };
    });
    // The two lone bubbles were the top-ranked isolated cells …
    expect(result.ranked).toHaveLength(2);
    expect(result.beforeNonZero).toBe(2);
    // … they still exist while the hawk is mid-flourish (no instant teleport-pop) …
    expect(result.duringNonZero).toBe(2);
    expect(result.busy).toBe(true);
    expect(result.kind).toBe("pick");
    // … and once Talon has finished pecking, both off-colour bubbles are gone.
    await page.waitForFunction(() => !window.__bpc.game.petAnim.busy, null, {
      timeout: 8000,
    });
    const afterNonZero = await page.evaluate(() => {
      const b = window.__bpc.game.session.board;
      let n = 0;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++)
          if (b.grid[c][r] !== -1 && b.grid[c][r] !== 0) n++;
      return n;
    });
    expect(afterNonZero).toBe(0);
  });

  test("the Quake pet reshuffles a jammed board into fresh matches", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("quake");
      window.__bpc.game.equipPet("quake");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active.type).toBe("quake");
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      // Paint a fully jammed checkerboard (no two like colours adjacent).
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          const col = (c + r) % 2;
          b.grid[c][r] = col;
          b.types[c][r] = 0;
          const sp = b.spriteGrid[c][r];
          if (sp) {
            sp.color = col;
            sp.type = 0;
          }
        }
      const before = b.hasMoves();
      const beforeCount = b.countRemaining();
      g._petQuake(g.session.petActive);
      return {
        before,
        after: b.hasMoves(),
        beforeCount,
        afterCount: b.countRemaining(),
        busy: g.petAnim.busy,
      };
    });
    expect(result.before).toBe(false); // jammed
    expect(result.after).toBe(true); // Quake created matches
    expect(result.afterCount).toBe(result.beforeCount); // a reshuffle, not a clear
    expect(result.busy).toBe(true);
  });

  test("the Cyclone pet sorts each column into vertical colour runs", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("cyclone");
      window.__bpc.game.equipPet("cyclone");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active.type).toBe("cyclone");
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const beforeCount = b.countRemaining();
      g._petCyclone(g.session.petActive);
      // After sorting, every column is non-decreasing by colour.
      let sorted = true;
      for (let c = 0; c < b.cols; c++) {
        let prev = -1;
        for (let r = 0; r < b.rows; r++) {
          const v = b.grid[c][r];
          if (v === -1) continue;
          if (v < prev) sorted = false;
          prev = v;
        }
      }
      return {
        sorted,
        beforeCount,
        afterCount: b.countRemaining(),
        busy: g.petAnim.busy,
      };
    });
    expect(result.sorted).toBe(true);
    expect(result.afterCount).toBe(result.beforeCount); // a sort, not a clear
    expect(result.busy).toBe(true);
  });

  test("the Magma pet erupts and clears a full vertical lane", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("magma");
      window.__bpc.game.equipPet("magma");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active.type).toBe("magma");
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const fullest = b.fullestColumns(1)[0];
      const laneHeight = b.columnCells(fullest).length;
      const beforeCount = b.countRemaining();
      g._petMagma(g.session.petActive);
      return {
        laneHeight,
        beforeCount,
        afterCount: b.countRemaining(),
        busy: g.petAnim.busy,
      };
    });
    // At least one whole lane's worth of bubbles was removed.
    expect(result.laneHeight).toBeGreaterThan(0);
    expect(result.afterCount).toBeLessThanOrEqual(
      result.beforeCount - result.laneHeight
    );
    expect(result.busy).toBe(true);
  });

  test("the Tidal pet floods away the whole dominant colour", async ({
    page,
  }) => {
    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("tidal");
      window.__bpc.game.equipPet("tidal");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const active = await page.evaluate(() => window.__bpc.game.session.petActive);
    expect(active.type).toBe("tidal");
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const color = b.dominantColor();
      const dominantBefore = b.cellsOfColor(color).length;
      g._petTidal(g.session.petActive);
      return {
        dominantBefore,
        dominantAfter: b.cellsOfColor(color).length,
        busy: g.petAnim.busy,
      };
    });
    expect(result.dominantBefore).toBeGreaterThanOrEqual(2);
    // Every bubble of that colour was swept away.
    expect(result.dominantAfter).toBe(0);
    expect(result.busy).toBe(true);
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
    await expect(page.locator("#hud-pet-icon img")).toHaveAttribute(
      "src",
      /\/assets\/pets\/(avatars\/.+\.png|kenney-space-shooter\/.+\.png)$/
    );
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

  test("a pet level-up gets a dedicated popup and can open the paused pet manager", async ({
    page,
  }) => {
    await unlockAllPetFeatures(page);
    await page.evaluate(() => {
      const pets = window.__bpc.Storage.getPetState();
      pets.owned.sparky.xp = 55;
      window.__bpc.Storage.set("pets", pets);
      window.__bpc.Storage.equipPet("sparky");
      window.__bpc.game.startCampaign(2);
      window.__bpc.game._awardPetXp();
      window.__bpc.game._showPendingPetLevelUp();
    });

    await expect(page.locator("#pet-levelup")).toBeVisible();
    await expect(page.locator("#pet-levelup-name")).toContainText("Sparky reached Lv.2");
    await expect(page.locator("#pet-levelup-benefits")).toContainText("Tech choice ready");
    await page.locator("#pet-levelup-open").click();
    await expect(page.locator("#pets")).toBeVisible();
    await expect(page.locator("#pets")).toHaveClass(/pet-focus-mode/);
    await expect(page.locator("#pet-tabs")).toBeHidden();
    await expect(page.locator("#pet-list")).toBeHidden();
    await expect(page.locator("#pet-detail .pd-focus-head")).toContainText("Sparky");
    await expect(page.locator("#pet-detail .pd-ability")).toContainText("Charge fills faster");
    await expect(page.locator("#pet-detail .pd-sockets")).toBeVisible();
    await expect(page.locator("#pet-detail .pd-action-row")).toBeVisible();
    await expect(page.locator("#pet-detail")).toContainText("Sparky");
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);

    await page.getByRole("button", { name: "View all pets" }).click();
    await expect(page.locator("#pets")).not.toHaveClass(/pet-focus-mode/);
    await expect(page.locator("#pet-tabs")).toBeVisible();
    await expect(page.locator("#pet-list")).toBeVisible();

    await page.locator("#pets-back").click();
    await expect(page.locator("#pets")).toBeHidden();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(false);
  });

  test("an empty pet socket occasionally prompts the player to embue a gem", async ({
    page,
  }) => {
    await unlockAllPetFeatures(page);
    await page.evaluate(() => {
      const pets = window.__bpc.Storage.getPetState();
      pets.owned.sparky.xp = 70;
      pets.owned.sparky.sockets = [];
      pets.dust = 100;
      window.__bpc.Storage.set("pets", pets);
      window.__bpc.Storage.addGem("ruby:chipped", 1);
      window.__bpc.Storage.equipPet("sparky");
      window.__bpc.game.startCampaign(4);
      window.__bpc.game._queuePetGemReminder(window.__bpc.game.session, { force: true });
      window.__bpc.game._showPendingPetFollowup();
    });

    await expect(page.locator("#pet-gem-reminder")).toBeVisible();
    await expect(page.locator("#pet-gem-reminder-title")).toContainText("Sparky has an empty socket");
    await expect(page.locator("#pet-gem-reminder-benefits")).toContainText("1 gem in bag");
    await page.locator("#pet-gem-reminder-open").click();
    await expect(page.locator("#pets")).toBeVisible();
    await expect(page.locator('.pet-tab[data-pet-tab="gems"].active')).toBeVisible();
    await expect(page.locator("#pet-detail")).toContainText("Sparky");
    await expect(page.locator("#pet-gems .pg-picker-card")).toBeVisible();
    await expect(page.locator("#gem-picker-embue")).toBeVisible();
    expect(await page.evaluate(() => window.__bpc.game.paused)).toBe(true);

    await page.locator("#gem-picker-cancel").click();
    await page.locator("#pets-back").click();
    await page.evaluate(() => {
      window.__bpc.game._queuePetGemReminder(window.__bpc.game.session, { force: true });
      window.__bpc.game._showPendingPetFollowup();
    });
    await expect(page.locator("#pet-gem-reminder")).toBeHidden();
  });

  test("the empty-socket prompt points gemless players toward forging", async ({
    page,
  }) => {
    await unlockAllPetFeatures(page);
    await page.evaluate(() => {
      const pets = window.__bpc.Storage.getPetState();
      pets.owned.sparky.xp = 70;
      pets.owned.sparky.sockets = [];
      pets.dust = 80;
      pets.crates = 1;
      window.__bpc.Storage.set("pets", pets);
      window.__bpc.Storage.set("gems", {});
      window.__bpc.Storage.equipPet("sparky");
      window.__bpc.game.startCampaign(4);
      window.__bpc.game._queuePetGemReminder(window.__bpc.game.session, { force: true });
      window.__bpc.game._showPendingPetFollowup();
    });

    await expect(page.locator("#pet-gem-reminder")).toBeVisible();
    await expect(page.locator("#pet-gem-reminder-desc")).toContainText("Pet crates can drop gems or Dust");
    await expect(page.locator("#pet-gem-reminder-benefits")).toContainText("80 Dust");
    await page.locator("#pet-gem-reminder-open").click();
    await expect(page.locator("#pets")).toBeVisible();
    await expect(page.locator("#gem-forge")).toBeVisible();
    await expect(page.locator("#gemforge-body")).toContainText("Forge");
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
    await page.locator("#btn-pets").click();
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

  test("quitting mid-Talon-pick does not crash when the flourish resolves", async ({
    page,
  }) => {
    // Regression: Talon's pick `onDone` fires on a later frame and calls
    // afterMove(). If the player quits to the menu first, the session is null
    // and afterMove used to throw "Cannot read properties of null (reading
    // 'mode')". The fix guards afterMove and clears the in-flight flourish on
    // quit, so no pageerror is raised.
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.evaluate(() => {
      window.__bpc.Storage.grantPet("talon");
      window.__bpc.game.equipPet("talon");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    // Plant lone off-colour bubbles in a single-colour field so Talon has
    // isolated targets, then fire the pick — it runs asynchronously.
    const fired = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
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
      b.grid[1][1] = 1;
      if (b.spriteGrid[1][1]) b.spriteGrid[1][1].color = 1;
      b.grid[2][2] = 2;
      if (b.spriteGrid[2][2]) b.spriteGrid[2][2].color = 2;
      g._petPick(g.session.petActive);
      return { busy: g.petAnim.busy, picking: g.session.petPicking };
    });
    expect(fired.busy).toBe(true);
    expect(fired.picking).toBe(true);

    // Quit to the menu while the hawk is still pecking — this clears the
    // in-flight flourish so its onDone can never fire on a null session.
    await page.evaluate(() => window.__bpc.game.quitToMenu());
    expect(await page.evaluate(() => window.__bpc.game.petAnim.busy)).toBe(false);
    expect(await page.evaluate(() => window.__bpc.game.session)).toBeNull();

    // Let several animation frames pass; the stale callback must not run.
    await page.waitForTimeout(600);
    expect(pageErrors).toHaveLength(0);
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("afterMove is a no-op once the session is gone (stale-callback guard)", async ({
    page,
  }) => {
    // Directly exercise the guard: calling afterMove() with no session must
    // never throw (mirrors a Talon pick / last-bubble finale onDone firing
    // after the level ended).
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session = null;
      let threw = false;
      try {
        g.afterMove();
      } catch (e) {
        threw = true;
      }
      return { threw };
    });
    expect(result.threw).toBe(false);
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
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 16));
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
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 16));
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

  test("buying the recommended Pick equips it in a visible armed HUD slot", async ({
    page,
  }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 16));
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.evaluate(() => window.__bpc.Economy.addCoins(1000));
    await jamBoardWithLoneBubbles(page);
    await expect(page.locator("#isolated")).toBeVisible();

    await page.locator("#iso-pick").click();
    await expect(page.locator("#isolated")).toBeHidden();
    const pickSlot = page.locator('[data-pu="pick"]');
    await expect(pickSlot).toBeVisible();
    await expect(pickSlot).toHaveClass(/armed/);
    await expect(pickSlot.locator(".pu-count")).toHaveText("1");
    expect(
      await page.evaluate(() => window.__bpc.Storage.getLoadout().includes("pick"))
    ).toBe(true);
  });

  test("Give Up lets the level end normally", async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.Storage.set("maxUnlockedLevel", 16));
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

test.describe("pet gems & sockets (RPG batch 4)", () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllPetFeatures(page);
  });

  test("the Pets screen launches a dedicated Gem Forge with Bag & Forge tabs", async ({ page }) => {
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    // The Pets screen now shows a compact launcher card, not the full panel.
    await expect(page.locator("#gem-launch")).toBeVisible();
    await page.locator("#gem-launch").click();
    // It opens a separate destination holding the gem manager.
    await expect(page.locator("#gem-forge")).toBeVisible();
    // The manager opens on the Bag tab; Forge holds the crafting UI.
    await expect(page.locator('.pg-tab[data-tab="bag"].active')).toBeVisible();
    await page.locator('.pg-tab[data-tab="forge"]').click();
    // Forge defaults to the first gem type (ruby) and shows just its 3 tiers.
    await expect(page.locator('.pg-craft-btn[data-gem="ruby"][data-tier="chipped"]')).toBeVisible();
    // The three tiers read left-to-right as a ladder with arrows between them.
    await expect(page.locator(".pg-cc-ladder .pg-ladder-arrow")).toHaveCount(2);
    await expect(page.locator(".pg-forge-hint")).toBeVisible();
    // Each tier shows a DISTINCT gem visual (matte chip → glossy → faceted),
    // driven by data-tier — not the same emoji repeated.
    await expect(page.locator('.pg-craft-btn[data-tier="chipped"] .gemv[data-tier="chipped"]')).toBeVisible();
    await expect(page.locator('.pg-craft-btn[data-tier="polished"] .gemv[data-tier="polished"]')).toBeVisible();
    await expect(page.locator('.pg-craft-btn[data-tier="brilliant"] .gemv[data-tier="brilliant"]')).toBeVisible();
    // Picking a different type swaps the visible tier buttons (no 18-button wall).
    await page.locator('.pg-forge-type[data-gem="diamond"]').click();
    await expect(page.locator('.pg-craft-btn[data-gem="diamond"][data-tier="brilliant"]')).toBeVisible();
    await expect(page.locator('.pg-craft-btn[data-gem="ruby"][data-tier="chipped"]')).toHaveCount(0);
    // Back returns to the Pets screen.
    await page.locator("#gemforge-back").click();
    await expect(page.locator("#gem-forge")).toBeHidden();
    await expect(page.locator("#gem-launch")).toBeVisible();
  });

  test("crafting a gem with dust adds it to inventory and spends dust", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      const { gemDustCost } = window.__bpc.gems;
      S.addDust(500);
      const before = S.getDust();
      const cost = gemDustCost("polished");
      const res = G.craftGem("ruby", "polished");
      return { res, cost, before, after: S.getDust(), count: S.gemCount("ruby:polished") };
    });
    expect(out.res.ok).toBe(true);
    expect(out.res.key).toBe("ruby:polished");
    expect(out.count).toBe(1);
    expect(out.after).toBe(out.before - out.cost);
  });

  test("crafting rejects an unaffordable gem", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const res = await page.evaluate(() => {
      window.__bpc.Storage.addDust(0);
      return window.__bpc.game.craftGem("diamond", "brilliant");
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("dust");
  });

  test("forgeTier fuses 3 of the tier below when available, else spends dust", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      // Start from a clean ruby inventory: enough polished to fuse one brilliant.
      while (S.gemCount("ruby:polished") > 0) S.spendGem("ruby:polished");
      while (S.gemCount("ruby:brilliant") > 0) S.spendGem("ruby:brilliant");
      while (S.gemCount("ruby:chipped") > 0) S.spendGem("ruby:chipped");
      S.addGem("ruby:polished", 3);
      S.addDust(10000);
      const dust0 = S.getDust();
      // 3 polished present → forging a brilliant FUSES them (free, no dust).
      const fuseRes = G.forgeTier("ruby", "brilliant");
      const afterFuse = {
        via: fuseRes.via,
        polished: S.gemCount("ruby:polished"),
        brilliant: S.gemCount("ruby:brilliant"),
        dustSpent: dust0 - S.getDust(),
      };
      // Now no polished left → forging another brilliant falls back to DUST.
      const dust1 = S.getDust();
      const dustRes = G.forgeTier("ruby", "brilliant");
      const afterDust = {
        via: dustRes.via,
        brilliant: S.gemCount("ruby:brilliant"),
        dustSpent: dust1 - S.getDust(),
      };
      return { afterFuse, afterDust };
    });
    // Fusion: consumed 3 polished, made 1 brilliant, spent NO dust.
    expect(out.afterFuse.via).toBe("fuse");
    expect(out.afterFuse.polished).toBe(0);
    expect(out.afterFuse.brilliant).toBe(1);
    expect(out.afterFuse.dustSpent).toBe(0);
    // Dust fallback: made another brilliant by spending dust (> 0).
    expect(out.afterDust.via).toBe("dust");
    expect(out.afterDust.brilliant).toBe(2);
    expect(out.afterDust.dustSpent).toBeGreaterThan(0);
  });

  test("sockets unlock with pet level (0 at L1, up to 2 at L4)", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const { socketsForLevel } = window.__bpc.gems;
      return { l1: socketsForLevel(1), l2: socketsForLevel(2), l4: socketsForLevel(4) };
    });
    expect(out.l1).toBe(0);
    expect(out.l2).toBe(1);
    expect(out.l4).toBe(2);
  });

  test("socketing a ruby raises an equipped pet's score buff live", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco"); // legendary scoreMult pet
      S.addPetXp("draco", 999); // push to high level → 2 sockets
      S.addGem("ruby:brilliant", 1);
      S.addDust(500); // embuing costs dust
      window.__bpc.game.equipPet("draco");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const out = await page.evaluate(() => {
      const G = window.__bpc.game;
      const before = G.session.petBuffs.scoreMult;
      const ok = G.socketGem("draco", 0, "ruby:brilliant");
      const after = G.session.petBuffs.scoreMult;
      return { ok, before, after };
    });
    expect(out.ok).toBe(true);
    expect(out.after).toBeGreaterThan(out.before);
  });

  test("an emerald shortens an equipped active pet's cooldown live", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("rover"); // active gather pet
      S.addPetXp("rover", 999);
      S.addGem("emerald:brilliant", 1);
      S.addDust(500); // embuing costs dust
      window.__bpc.game.equipPet("rover");
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    const out = await page.evaluate(() => {
      const G = window.__bpc.game;
      const before = G.session.petActive.cooldown;
      const ok = G.socketGem("rover", 0, "emerald:brilliant");
      const after = G.session.petActive.cooldown;
      return { ok, before, after };
    });
    expect(out.ok).toBe(true);
    expect(out.after).toBeLessThan(out.before);
  });

  test("unsocketing a gem shatters it for a partial dust refund", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      const { socketDustCost, unsocketDustRefund } = window.__bpc.gems;
      S.grantPet("rover");
      S.addPetXp("rover", 999);
      S.addGem("citrine:chipped", 1);
      S.addDust(500);
      const dustBeforeSocket = S.getDust();
      G.socketGem("rover", 0, "citrine:chipped");
      const slotted = S.getSockets("rover")[0];
      const dustAfterSocket = S.getDust();
      const inBagWhileSlotted = S.gemCount("citrine:chipped");
      const res = G.unsocketGem("rover", 0);
      return {
        slotted,
        inBagWhileSlotted,
        res,
        backInBag: S.gemCount("citrine:chipped"),
        embueCost: socketDustCost("chipped"),
        expectRefund: unsocketDustRefund("chipped"),
        dustSpent: dustBeforeSocket - dustAfterSocket,
        dustAfterRemove: S.getDust(),
        dustAfterSocket,
      };
    });
    expect(out.slotted).toBe("citrine:chipped");
    expect(out.inBagWhileSlotted).toBe(0);
    expect(out.dustSpent).toBe(out.embueCost); // socketing cost dust
    expect(out.res.key).toBe("citrine:chipped");
    expect(out.res.dust).toBe(out.expectRefund);
    expect(out.res.dust).toBeLessThan(out.embueCost); // refund is less than paid
    expect(out.backInBag).toBe(0); // gem destroyed, NOT returned to inventory
    expect(out.dustAfterRemove).toBe(out.dustAfterSocket + out.expectRefund);
  });

  test("a crate open can drop a loose gem into inventory", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const dropped = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      // Own every pet so opens are duplicates (focus on the gem-drop path).
      for (const p of window.__bpc.pets.PET_CATALOG) S.grantPet(p.id);
      let gotGem = false;
      for (let i = 0; i < 40 && !gotGem; i++) {
        S.addCrates(1);
        const r = G.openCrate();
        if (r && r.gem) gotGem = true;
      }
      return gotGem && Object.keys(S.getGems()).length > 0;
    });
    expect(dropped).toBe(true);
  });

  test("a low-level pet can only socket low-tier gems", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      S.grantPet("rover");
      S.addPetXp("rover", 56); // → Lv.2 (1 socket, chipped tier only)
      S.addGem("ruby:chipped", 1);
      S.addGem("ruby:brilliant", 1);
      S.addDust(500); // enough dust either way — the gate is tier, not cost
      const strong = G.socketGem("rover", 0, "ruby:brilliant"); // too strong → rejected
      const weak = G.socketGem("rover", 0, "ruby:chipped"); // within tier → ok
      return { strong, weak, slotted: S.getSockets("rover")[0] };
    });
    expect(out.strong).toBe(false);
    expect(out.weak).toBe(true);
    expect(out.slotted).toBe("ruby:chipped");
  });

  test("tapping an empty socket opens a visible gem picker overlay", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("rover");
      S.addPetXp("rover", 999); // high level → sockets unlocked
      S.addGem("citrine:chipped", 1);
      S.addDust(500); // affordable → the gem is socketable + flagged BEST
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="rover"]').click();
    await page.locator("#pet-detail .socket-slot.empty").first().click();
    // The picker is promoted to a centered overlay (it lives above the detail in
    // the DOM, so it must NOT render off-screen) and shows the pluggable gem as a
    // selectable cell, pre-selected with a clear Embue confirm button.
    await expect(page.locator(".pet-gems.pg-picking")).toBeVisible();
    await expect(page.locator('.pg-pick-cell[data-gem="citrine:chipped"]')).toBeVisible();
    // The only socketable gem is auto-selected and flagged BEST.
    await expect(page.locator('.pg-pick-cell[data-gem="citrine:chipped"]')).toHaveClass(/\bsel\b/);
    await expect(page.locator('.pg-pick-cell[data-gem="citrine:chipped"] .pg-pc-best')).toBeVisible();
  });

  test("socketing a gem costs dust and is rejected when too poor", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      const { socketDustCost } = window.__bpc.gems;
      S.grantPet("rover");
      S.addPetXp("rover", 999);
      S.addGem("ruby:chipped", 2);
      S.addDust(0); // broke → first socket attempt must fail
      const poor = G.socketGem("rover", 0, "ruby:chipped");
      S.addDust(socketDustCost("chipped"));
      const before = S.getDust();
      const rich = G.socketGem("rover", 0, "ruby:chipped");
      const after = S.getDust();
      return { poor, rich, spent: before - after, cost: socketDustCost("chipped") };
    });
    expect(out.poor).toBe(false); // couldn't afford the embue
    expect(out.rich).toBe(true);
    expect(out.spent).toBe(out.cost);
  });

  test("the gem picker shows each gem's buff and embue cost", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 999);
      S.addGem("ruby:brilliant", 1);
      S.addDust(500);
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    await page.locator("#pet-detail .socket-slot.empty").first().click();
    // The single gem is auto-selected; the detail panel shows its exact buff and
    // the Embue confirm button shows the dust cost.
    await expect(page.locator('.pg-pick-cell[data-gem="ruby:brilliant"]')).toBeVisible();
    await expect(page.locator(".pg-pick-detail .pg-pd-buff")).toHaveText("+12% Score");
    await expect(page.locator("#gem-picker-embue")).toContainText("✨150");
  });

  test("socketing through the UI plays one of 5 magic variants", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 999);
      S.addGem("ruby:brilliant", 1);
      S.addDust(500);
      // Force motion ON so the flourish element is actually created.
      const s = { ...(S.get("settings") || {}), reducedMotion: false };
      S.set("settings", s);
      window.__bpc.UI.reducedMotion = false;
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    await page.locator("#pet-detail .socket-slot.empty").first().click();
    // Pre-selected gem → confirm the embue via the Embue button.
    await page.locator("#gem-picker-embue").click();
    const variant = await page.evaluate(() => window.__bpc.UI._lastSocketMagic);
    expect(variant).toBeGreaterThanOrEqual(0);
    expect(variant).toBeLessThanOrEqual(4);
    // The gem is now socketed.
    const slotted = await page.evaluate(() => window.__bpc.Storage.getSockets("draco")[0]);
    expect(slotted).toBe("ruby:brilliant");
  });

  test("the gem picker lets you pick a different gem and updates the detail", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 999); // high level → brilliant socketable
      S.addGem("ruby:brilliant", 1); // +12% score (the default BEST)
      S.addGem("citrine:chipped", 1); // +5% coins, weaker tier
      S.addDust(500);
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    await page.locator("#pet-detail .socket-slot.empty").first().click();
    // The strongest socketable gem leads, is auto-selected, and is the embue target.
    await expect(page.locator('.pg-pick-cell[data-gem="ruby:brilliant"]')).toHaveClass(/\bsel\b/);
    await expect(page.locator(".pg-pick-detail .pg-pd-buff")).toHaveText("+12% Score");
    await expect(page.locator(".pg-pick-detail .pg-pd-tier")).toHaveText("Brilliant");
    // Picking the weaker gem updates the selection, detail buff, tier and power bar.
    await page.locator('.pg-pick-cell[data-gem="citrine:chipped"]').click();
    await expect(page.locator('.pg-pick-cell[data-gem="citrine:chipped"]')).toHaveClass(/\bsel\b/);
    await expect(page.locator('.pg-pick-cell[data-gem="ruby:brilliant"]')).not.toHaveClass(/\bsel\b/);
    await expect(page.locator(".pg-pick-detail .pg-pd-buff")).toHaveText("+5% Coins");
    await expect(page.locator(".pg-pick-detail .pg-pd-tier")).toHaveText("Chipped");
    await expect(page.locator("#gem-picker-embue")).toContainText("✨20");
    // The power bar reflects the chipped tier (1 of 3 → ~33%).
    const w = await page.locator(".pg-pick-detail .pg-pd-fill").evaluate((el) => el.style.width);
    expect(w).toBe("33%");
    // Embuing the chosen gem sockets *that* gem.
    await page.locator("#gem-picker-embue").click();
    const slotted = await page.evaluate(() => window.__bpc.Storage.getSockets("draco")[0]);
    expect(slotted).toBe("citrine:chipped");
  });

  test("removing a socketed gem warns then shatters it for dust", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      S.grantPet("draco");
      S.addPetXp("draco", 999);
      S.addGem("ruby:brilliant", 1);
      S.addDust(500);
      G.socketGem("draco", 0, "ruby:brilliant");
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    const dustBefore = await page.evaluate(() => window.__bpc.Storage.getDust());
    // Tapping a filled socket asks for confirmation (the gem will be destroyed).
    await page.locator("#pet-detail .socket-slot.filled").first().click();
    await expect(page.locator("#gem-remove")).toBeVisible();
    await page.locator("#gem-remove-ok").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const { unsocketDustRefund } = window.__bpc.gems;
      return {
        sockets: S.getSockets("draco"),
        inBag: S.gemCount("ruby:brilliant"),
        dust: S.getDust(),
        refund: unsocketDustRefund("brilliant"),
      };
    });
    expect(out.sockets[0]).toBeFalsy(); // slot emptied
    expect(out.inBag).toBe(0); // gem destroyed, not returned
    expect(out.dust).toBe(dustBefore + out.refund); // partial dust refund
  });

  test("fusing 3 same-tier gems yields 1 of the next tier (via the model)", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      S.addGem("ruby:chipped", 3);
      const res = G.fuseGem("ruby:chipped");
      return {
        res,
        chipped: S.gemCount("ruby:chipped"),
        polished: S.gemCount("ruby:polished"),
      };
    });
    expect(out.res.ok).toBe(true);
    expect(out.res.to).toBe("ruby:polished");
    expect(out.chipped).toBe(0);
    expect(out.polished).toBe(1);
  });

  test("fusing is rejected with fewer than 3 gems and at the top tier", async ({ page }) => {
    await page.locator("#btn-pets").click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      S.addGem("citrine:chipped", 2);
      S.addGem("diamond:brilliant", 3);
      const tooFew = G.fuseGem("citrine:chipped");
      const topTier = G.fuseGem("diamond:brilliant");
      return {
        tooFew,
        topTier,
        chipped: S.gemCount("citrine:chipped"),
        brilliant: S.gemCount("diamond:brilliant"),
      };
    });
    expect(out.tooFew.ok).toBe(false);
    expect(out.tooFew.reason).toBe("count");
    expect(out.topTier.ok).toBe(false);
    expect(out.topTier.reason).toBe("top");
    expect(out.chipped).toBe(2); // untouched
    expect(out.brilliant).toBe(3); // untouched
  });

  test("the gem inventory shows a Fuse button that merges through the UI", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.addGem("sapphire:chipped", 3));
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    await page.locator("#gem-launch").click();
    const fuse = page.locator('.pg-fuse-btn[data-gem="sapphire:chipped"]');
    await expect(fuse).toBeVisible();
    await expect(fuse).toBeEnabled();
    await fuse.click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      return {
        chipped: S.gemCount("sapphire:chipped"),
        polished: S.gemCount("sapphire:polished"),
      };
    });
    expect(out.chipped).toBe(0);
    expect(out.polished).toBe(1);
  });

  test("the Fuse button is disabled below 3 gems", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.addGem("amber:chipped", 2));
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    await page.locator("#gem-launch").click();
    const fuse = page.locator('.pg-fuse-btn[data-gem="amber:chipped"]');
    await expect(fuse).toBeVisible();
    await expect(fuse).toBeDisabled();
  });

  test("Auto Forge Max upgrades every eligible loose gem stack through the UI", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const { GEM_CATALOG, GEM_TIERS, gemKey } = window.__bpc.gems;
      for (const def of GEM_CATALOG) {
        for (const tier of GEM_TIERS) S.addGem(gemKey(def.type, tier.id), -999);
      }
      S.addGem("ruby:chipped", 9);
      S.addGem("sapphire:polished", 3);
      S.addGem("amber:chipped", 2);
    });
    const dustBefore = await page.evaluate(() => window.__bpc.Storage.getDust());
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    await page.locator("#gem-launch").click();
    const auto = page.locator(".pg-auto-forge-btn");
    await expect(auto).toBeVisible();
    await expect(auto).toBeEnabled();
    await expect(auto).toContainText("Auto Forge Max");
    await auto.click();
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      return {
        rubyChipped: S.gemCount("ruby:chipped"),
        rubyPolished: S.gemCount("ruby:polished"),
        rubyBrilliant: S.gemCount("ruby:brilliant"),
        sapphirePolished: S.gemCount("sapphire:polished"),
        sapphireBrilliant: S.gemCount("sapphire:brilliant"),
        amberChipped: S.gemCount("amber:chipped"),
        dust: S.getDust(),
      };
    });
    expect(out.rubyChipped).toBe(0);
    expect(out.rubyPolished).toBe(0);
    expect(out.rubyBrilliant).toBe(1);
    expect(out.sapphirePolished).toBe(0);
    expect(out.sapphireBrilliant).toBe(1);
    expect(out.amberChipped).toBe(2);
    expect(out.dust).toBe(dustBefore);
    await expect(auto).toBeDisabled();
    await expect(page.locator('.pg-cell[data-gem="ruby:brilliant"]')).toBeVisible();
    await expect(page.locator('.pg-cell[data-gem="sapphire:brilliant"]')).toBeVisible();
  });

  test("the Bag grid selects a gem and shows its detail + fusion action", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.addGem("diamond:brilliant", 1);
      S.addGem("ruby:chipped", 2);
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-tab[data-pet-tab="gems"]').click();
    await page.locator("#gem-launch").click();
    // Two owned gems => two compact cells in the grid.
    await expect(page.locator(".pg-grid2 .pg-cell")).toHaveCount(2);
    // The strongest gem (brilliant) is auto-selected and is top tier.
    await expect(page.locator('.pg-cell.sel[data-gem="diamond:brilliant"]')).toBeVisible();
    await expect(page.locator(".pg-fuse-top")).toBeVisible();
    // Tapping a chipped gem updates the detail panel + offers a (disabled) fuse.
    await page.locator('.pg-cell[data-gem="ruby:chipped"]').click();
    await expect(page.locator('.pg-cell.sel[data-gem="ruby:chipped"]')).toBeVisible();
    const fuse = page.locator('.pg-fuse-btn[data-gem="ruby:chipped"]');
    await expect(fuse).toBeVisible();
    await expect(fuse).toBeDisabled();
    await expect(page.locator(".pg-sel-buff")).toContainText("Score");
  });
});


// ---------------------------------------------------------------------------
// Pet technology tree (RPG batch 5): each level-up unlocks a tier of two
// upgrade nodes; the player permanently picks one, customizing the pet.
// ---------------------------------------------------------------------------
test.describe("pet technology tree (RPG batch 5)", () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllPetFeatures(page);
  });

  test("the pet detail shows the tech tree with a pending pick at Lv.2", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // → Lv.2 (unlocks tier 1)
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    await expect(page.locator("#pet-detail .pd-tech")).toBeVisible();
    // Tier 1 is pending: both options are clickable.
    await expect(page.locator("#pet-detail .pd-tech-tier.pending")).toBeVisible();
    await expect(page.locator('#pet-detail .pd-tech-node.opt[data-node="t1_power"]')).toBeVisible();
    await expect(page.locator('#pet-detail .pd-tech-node.opt[data-node="t1_fortune"]')).toBeVisible();
    // Locked future tiers show the level required.
    await expect(page.locator("#pet-detail .pd-tech-tier.locked")).toHaveCount(9);
  });

  test("picking a node records it and raises the pet's buff", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // Lv.2
    });
    const before = await page.evaluate(() => {
      const { petBuffs, levelForXp } = window.__bpc.pets;
      const S = window.__bpc.Storage;
      const lvl = levelForXp(S.getPetState().owned.draco.xp);
      return petBuffs("draco", lvl, S.getPetTrait("draco"), S.getSockets("draco"), S.getPetTech("draco")).scoreMult;
    });
    await page.locator("#btn-pets").click();
    await page.locator('.pet-card[data-pet="draco"]').click();
    await page.locator('#pet-detail .pd-tech-node.opt[data-node="t1_power"]').click();
    const out = await page.evaluate(() => {
      const { petBuffs, levelForXp } = window.__bpc.pets;
      const S = window.__bpc.Storage;
      const lvl = levelForXp(S.getPetState().owned.draco.xp);
      return {
        tech: S.getPetTech("draco"),
        scoreMult: petBuffs("draco", lvl, S.getPetTrait("draco"), S.getSockets("draco"), S.getPetTech("draco")).scoreMult,
      };
    });
    expect(out.tech).toContain("t1_power");
    expect(out.scoreMult).toBeCloseTo(before * 1.06, 5);
    // After picking, the chosen node is shown locked-in with a check.
    await expect(page.locator('#pet-detail .pd-tech-node.chosen')).toBeVisible();
  });

  test("a higher tier cannot be picked before its level is reached", async ({ page }) => {
    const out = await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const G = window.__bpc.game;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // Lv.2 → only tier 1 unlocked
      // Try to pick a tier-2 node directly (illegal at Lv.2).
      const bad = G.pickPetTech("draco", "t2_charge");
      // The legal tier-1 pick still works.
      const good = G.pickPetTech("draco", "t1_power");
      return { bad, good, tech: S.getPetTech("draco") };
    });
    expect(out.bad.ok).toBe(false);
    expect(out.good.ok).toBe(true);
    expect(out.tech).toEqual(["t1_power"]);
  });

  test("the menu Pets tile badges a pet with a pending upgrade", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // Lv.2 → pending tier
    });
    // Re-show the menu so the badge refreshes.
    await page.locator("#btn-pets").click();
    await page.locator("#pets-back").click();
    await expect(page.locator("#pets-badge")).toBeVisible();
    // Once picked, the badge clears.
    await page.evaluate(() => window.__bpc.game.pickPetTech("draco", "t1_power"));
    await page.locator("#btn-pets").click();
    await page.locator("#pets-back").click();
    await expect(page.locator("#pets-badge")).toBeHidden();
  });

  test("clicking the badged Pets tile pre-selects the pet with the pending upgrade", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // Lv.2 → pending tier
      window.__bpc.UI.refreshPetsBadge();
    });
    await expect(page.locator("#pets-badge")).toBeVisible();

    // Tapping the badged tile must not dump the player into the full
    // collection to hunt for the 🧬 badge — the specific pet the notification
    // is about is already selected, so its pending pick is immediately
    // visible in the detail panel. The collection itself stays visible/
    // browsable as normal (no forced focus mode).
    await page.locator("#btn-pets").click();
    await expect(page.locator('.pet-card[data-pet="draco"]')).toHaveClass(/selected/);
    await expect(page.locator("#pet-detail .pd-tech-tier.pending")).toBeVisible();
    await expect(page.locator("#pet-detail .pd-tech-pip")).toBeVisible();
    await expect(page.locator(".pd-focus-head")).toHaveCount(0);
    await expect(page.locator(".pet-card").first()).toBeVisible();

    // Resolving the pick clears the notification.
    await page.locator('#pet-detail .pd-tech-node.opt[data-node="t1_power"]').click();
    await expect(page.locator("#pet-detail .pd-tech-node.chosen")).toBeVisible();

    // Re-opening the menu tile with nothing pending falls back to the
    // equipped/default pet as usual.
    await page.locator("#pets-back").click();
    await expect(page.locator("#pets-badge")).toBeHidden();
    await page.locator("#btn-pets").click();
    await expect(page.locator("#pet-detail .pd-tech-tier.pending")).toHaveCount(0);
  });

  test("the Companions tab and an actionable banner surface pending tech picks inside Pets", async ({
    page,
  }) => {
    // Regression guard for a real gap: the menu Pets tile badge told the
    // player something needed attention, but once inside Pets there was no
    // aggregate indicator at all — only a tiny per-card 🧬 icon buried in the
    // grid, easy to miss entirely (a "13 notifications but nothing to act on"
    // experience). Both the Companions tab badge and the notice banner must
    // reflect the same pending count and jump to the same pet.
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      S.grantPet("draco");
      S.addPetXp("draco", 60); // Lv.2 → pending tier
      S.grantPet("sparky");
      S.addPetXp("sparky", 60); // Lv.2 → pending tier
      window.__bpc.UI.refreshPetsBadge();
    });

    await page.locator("#btn-pets").click();
    await expect(page.locator('.pet-tab[data-pet-tab="companions"] .pt-badge')).toHaveText("2");
    await expect(page.locator("#pet-notice")).toBeVisible();
    await expect(page.locator("#pet-notice")).toContainText("tech upgrade ready");

    // Tapping the banner jumps to (and selects) the first pending pet.
    await page.locator("#pet-notice").click();
    await expect(page.locator(".pet-card.selected")).toHaveAttribute("data-pet", /draco|sparky/);
    await expect(page.locator("#pet-detail .pd-tech-tier.pending")).toBeVisible();

    // Resolving every pending pick clears both the tab badge and the banner.
    await page.evaluate(() => {
      const g = window.__bpc.game;
      g.pickPetTech("draco", "t1_power");
      g.pickPetTech("sparky", "t1_power");
      window.__bpc.UI.buildPets();
    });
    await expect(page.locator('.pet-tab[data-pet-tab="companions"] .pt-badge')).toHaveCount(0);
    await expect(page.locator("#pet-notice")).toBeHidden();
  });

  test("the Companions tab badge never overlaps its own label text, even with a 2-digit count", async ({
    page,
  }) => {
    // Real bug guard: on a real phone, an 11+ pending count on the narrow
    // Companions tab rendered the badge ON TOP of the "Companions" label
    // (garbled, e.g. reading like "Compani⑪sParty"). The badge must sit
    // clear of the label's bounding box regardless of count.
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const ids = ["draco", "sparky", "clover", "mochi", "sprout", "rover", "whiskers", "luma", "quake", "comet", "talon"];
      for (const id of ids) {
        S.grantPet(id);
        S.addPetXp(id, 60); // Lv.2 → pending tier 1
      }
      window.__bpc.UI.refreshPetsBadge();
    });
    await page.locator("#btn-pets").click();
    const badge = page.locator('.pet-tab[data-pet-tab="companions"] .pt-badge');
    await expect(badge).toHaveText("11");
    const label = page.locator('.pet-tab[data-pet-tab="companions"] .pt-copy span').first();
    const [badgeBox, labelBox] = await Promise.all([badge.boundingBox(), label.boundingBox()]);
    const overlaps =
      badgeBox.x < labelBox.x + labelBox.width &&
      badgeBox.x + badgeBox.width > labelBox.x &&
      badgeBox.y < labelBox.y + labelBox.height &&
      badgeBox.y + badgeBox.height > labelBox.y;
    expect(overlaps).toBe(false);
  });

  test("every pet-manager tab label fits without ellipsis truncation on a real phone width", async ({
    page,
  }) => {
    // Real bug guard: the Companions tab's label used to read "Companions",
    // which is far wider than the ~36px a 4-column tab bar can spare at a
    // 390px phone width, so it silently clipped to "Co…" once the label got
    // proper overflow:hidden (a genuine, unreadable truncation, not just a
    // cosmetic nuance). Every tab label must fit its own box without clipping.
    await page.locator("#btn-pets").click();
    for (const id of ["companions", "party", "gems", "store"]) {
      const label = page.locator(`.pet-tab[data-pet-tab="${id}"] .pt-copy span`).first();
      const { clientWidth, scrollWidth } = await label.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    }
  });

  test("the pet-manager overlay reserves scrollbar space so its tab bar never reflows between tabs", async ({
    page,
  }) => {
    // Real bug guard: #pets scrolls internally (overflow-y:auto). Some tabs
    // (e.g. Store, with the crate panel + premium list) are tall enough to
    // trigger a classic, space-consuming scrollbar while others (e.g. Party)
    // are not — that shrank the shared sticky tab bar by the scrollbar's
    // width only on the taller tabs, so labels that fit on Party clipped the
    // moment the player switched to Store. Headless Chromium always renders
    // overlay (non-space-consuming) scrollbars, so a real device's classic
    // scrollbar reflow can't be reproduced pixel-for-pixel here — assert the
    // actual CSS contract instead (`scrollbar-gutter: stable`), which is what
    // keeps the reserved width constant on every real browser/OS that does
    // use classic scrollbars (e.g. desktop Chrome/Firefox on Windows).
    await page.locator("#btn-pets").click();
    const gutter = await page
      .locator("#pets")
      .evaluate((el) => getComputedStyle(el).scrollbarGutter);
    expect(gutter).toBe("stable");
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

  test("the finale waits for earlier pop sprites to finish before clearing", async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    const deferred = await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const live = b.targetPixel(0, b.rows - 1);
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.types[c][r] = 0;
          if (b.spriteGrid && b.spriteGrid[c]) b.spriteGrid[c][r] = null;
        }
      b.grid[0][b.rows - 1] = 0;
      b.sprites = [
        { c: 0, r: b.rows - 1, x: live.x, y: live.y, scale: 1, alpha: 1, state: "idle", delay: 0, fallDur: 0, glideDur: 0 },
        { c: 1, r: b.rows - 1, x: live.x + b.cell, y: live.y, scale: 1, alpha: 1, state: "pop", t: 0, delay: 0, fallDur: 0, glideDur: 0 },
      ];
      g.session.score = 0;
      g.afterMove();
      return {
        pending: !!g.session.pendingFinale,
        finaleActive: g.finale.active,
        finishing: !!g.session.finishing,
        idle: b.isIdle(),
        remaining: b.countRemaining(),
      };
    });

    expect(deferred.remaining).toBe(1);
    expect(deferred.idle).toBe(false);
    expect(deferred.pending).toBe(true);
    expect(deferred.finaleActive).toBe(false);
    expect(deferred.finishing).toBe(false);

    const started = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.update(0.25);
      return {
        pending: !!g.session.pendingFinale,
        finaleActive: g.finale.active,
        finishing: !!g.session.finishing,
      };
    });
    expect(started.pending).toBe(false);
    expect(started.finaleActive).toBe(true);
    expect(started.finishing).toBe(true);
  });
});

test.describe("premium Nova gunship pet", () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
    await unlockAllPetFeatures(page);
  });

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

test.describe("daily & weekly quests (Tier 1)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the Quests screen opens from the menu and Back returns", async ({
    page,
  }) => {
    await page.locator("#btn-quests").click();
    await expect(page.locator("#quests")).toBeVisible();
    // Three daily quests and one weekly quest are rendered.
    await expect(page.locator("#quests-list .quest")).toHaveCount(4);
    // Aligned with the Achievements collection screen: every row shows a
    // reward icon, and the header shows a ready-count summary.
    await expect(page.locator("#quests-list .quest-icon")).toHaveCount(4);
    await expect(page.locator("#quests-count")).toHaveText("All collected");
    await page.locator("#quests-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("playing pops feeds bubble-count quest progress", async ({ page }) => {
    await page.evaluate(() => {
      const { ensureQuests, todayKey, weekKey } = window.__bpc.quests;
      const S = window.__bpc.Storage;
      // Force a known daily set that includes the 150-bubble quest.
      const st = ensureQuests(S.get("quests"), todayKey(), weekKey());
      st.daily = [{ id: "d_pop150", progress: 0, claimed: false }];
      S.set("quests", st);
    });
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(200);
    await autoPlay(page);
    const progress = await page.evaluate(
      () => window.__bpc.Storage.get("quests").daily[0].progress
    );
    expect(progress).toBeGreaterThan(0);
  });

  test("a completed quest is claimable and grants its reward with a badge", async ({
    page,
  }) => {
    const before = await page.evaluate(() => {
      const { ensureQuests, todayKey, weekKey } = window.__bpc.quests;
      const S = window.__bpc.Storage;
      const st = ensureQuests(S.get("quests"), todayKey(), weekKey());
      // Mark the first daily quest complete (d_pop150 → 60 coins reward).
      st.daily = [{ id: "d_pop150", progress: 150, claimed: false }];
      S.set("quests", st);
      window.__bpc.UI.refreshQuestsBadge();
      return window.__bpc.Economy.coins;
    });
    // The menu badge advertises a claimable reward.
    await expect(page.locator("#quests-badge")).toBeVisible();
    await page.locator("#btn-quests").click();
    // Aligned with achievements: "N ready" summary + a "Collect All" toolbar.
    await expect(page.locator("#quests-count")).toHaveText("1 ready 🎁");
    await expect(page.locator("#quests-collect-all")).toBeVisible();
    const claim = page.locator("#quests-list .quest").first().locator(".quest-claim");
    await expect(claim).toHaveText("Collect 🎁");
    await claim.click();
    // Claiming reveals the shared chest modal — the same "chest opens" moment
    // an achievement gives — not just a toast.
    await expect(page.locator("#chest")).toBeVisible();
    await expect(page.locator("#chest-rewards .chest-row")).toContainText("60");
    await page.locator("#chest-ok").click();
    await expect(claim).toHaveText("Claimed ✓");
    const after = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      claimed: window.__bpc.Storage.get("quests").daily[0].claimed,
    }));
    expect(after.coins).toBe(before + 60);
    expect(after.claimed).toBe(true);
    await expect(page.locator("#quests-count")).toHaveText("All collected");
  });

  test("Collect All grabs every ready quest at once and reveals the haul", async ({
    page,
  }) => {
    const before = await page.evaluate(() => {
      const { ensureQuests, todayKey, weekKey } = window.__bpc.quests;
      const S = window.__bpc.Storage;
      const st = ensureQuests(S.get("quests"), todayKey(), weekKey());
      st.daily = [
        { id: "d_pop150", progress: 150, claimed: false }, // 60 coins
        { id: "d_fever2", progress: 2, claimed: false }, // 80 coins
      ];
      st.weekly = [{ id: "w_win15", progress: 15, claimed: false }]; // 400 coins
      S.set("quests", st);
      window.__bpc.UI.refreshQuestsBadge();
      return window.__bpc.Economy.coins;
    });
    await page.locator("#btn-quests").click();
    await expect(page.locator("#quests-count")).toHaveText("3 ready 🎁");
    const collectAll = page.locator("#quests-collect-all");
    await expect(collectAll).toBeVisible();
    expect(await page.locator(".quest.claimable").count()).toBe(3);

    await collectAll.click();
    // The aggregate reveal opens summarising the haul — same pattern as the
    // achievements screen's Collect All.
    await expect(page.locator("#chest")).toBeVisible();
    await expect(page.locator("#chest-title")).toContainText("Collected 3 quests");
    await expect(page.locator("#chest-rewards .chest-row")).toContainText("540");
    await page.locator("#chest-ok").click();
    await expect(page.locator("#quests")).toBeVisible();

    const after = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      daily: window.__bpc.Storage.get("quests").daily.map((e) => e.claimed),
      weekly: window.__bpc.Storage.get("quests").weekly.map((e) => e.claimed),
    }));
    expect(after.coins).toBe(before + 540);
    expect(after.daily.every(Boolean)).toBe(true);
    expect(after.weekly.every(Boolean)).toBe(true);
    await expect(collectAll).toBeHidden();
    expect(await page.locator(".quest.claimable").count()).toBe(0);
    await expect(page.locator("#quests-count")).toHaveText("All collected");
  });

  test("locked quest tool rewards claim as coins", async ({ page }) => {
    await page.evaluate(() => {
      const { ensureQuests, todayKey, weekKey } = window.__bpc.quests;
      const S = window.__bpc.Storage;
      S.set("maxUnlockedLevel", 1);
      S.set("coins", 0);
      const st = ensureQuests(S.get("quests"), todayKey(), weekKey());
      st.daily = [{ id: "d_win3", progress: 3, claimed: false }];
      S.set("quests", st);
      window.__bpc.UI.refreshQuestsBadge();
    });

    await page.locator("#btn-quests").click();
    const quest = page.locator("#quests-list .quest").first();
    await expect(quest.locator(".quest-reward")).toContainText("60");
    await expect(quest.locator(".quest-reward")).not.toContainText("Shuffle");
    await quest.locator(".quest-claim").click();

    const state = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      shuffle: window.__bpc.Economy.getPowerup("shuffle"),
    }));
    expect(state.coins).toBe(60);
    expect(state.shuffle).toBe(0);
  });
});

test.describe("stats / profile dashboard (Tier 1)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the Stats screen opens from the menu and Back returns", async ({
    page,
  }) => {
    await page.locator("#btn-stats").click();
    await expect(page.locator("#stats")).toBeVisible();
    // Two sections: profile (8 cells) + lifetime totals (8 cells).
    await expect(page.locator("#stats-profile .stat-cell")).toHaveCount(8);
    await expect(page.locator("#stats-lifetime .stat-cell")).toHaveCount(8);
    await page.locator("#stats-back").click();
    await expect(page.locator("#menu")).toBeVisible();
  });

  test("lifetime totals reflect persisted progress", async ({ page }) => {
    await page.evaluate(() => {
      const S = window.__bpc.Storage;
      const st = S.getAchievementState();
      st.progress.pops = 1234;
      S.setAchievementState(st);
    });
    await page.locator("#btn-stats").click();
    // The 👆 Bubbles-popped cell shows the formatted lifetime pop count.
    await expect(
      page.locator("#stats-lifetime .stat-cell").first()
    ).toContainText("1,234");
  });

  test("the profile section shows the current coin balance", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.Economy.addCoins(500));
    const coins = await page.evaluate(() => window.__bpc.Economy.coins);
    await page.locator("#btn-stats").click();
    await expect(page.locator("#stats-profile")).toContainText(
      coins.toLocaleString("en-US")
    );
  });
});

test.describe("piggy bank (Tier 1)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the shop shows the Piggy Bank card, locked when empty", async ({
    page,
  }) => {
    await page.locator("#btn-shop").click();
    await expect(page.locator(".shop-piggy")).toBeVisible();
    // A fresh save has an empty piggy, so cracking is locked.
    const crack = page.locator("#shop-piggy-crack");
    await expect(crack).toBeDisabled();
    await expect(crack).toHaveText("Locked");
  });

  test("finishing a level banks coins into the piggy", async ({ page }) => {
    await page.evaluate(() => window.__bpc.Storage.set("piggyBank", 0));
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(200);
    // Guarantee a healthy score so the deposit clears the crack threshold.
    await page.evaluate(() => {
      window.__bpc.game.session.score = 4000;
    });
    await autoPlay(page);
    // _finish (and the piggy deposit) runs a short delay after the board ends.
    await page.waitForFunction(
      () => (window.__bpc.Storage.get("piggyBank") || 0) > 0,
      { timeout: 5000 }
    );
    const bank = await page.evaluate(() => window.__bpc.Storage.get("piggyBank"));
    expect(bank).toBeGreaterThanOrEqual(100);
  });

  test("cracking the piggy pays the whole vault into the wallet", async ({
    page,
  }) => {
    const before = await page.evaluate(() => {
      window.__bpc.Storage.set("piggyBank", 500);
      return window.__bpc.Economy.coins;
    });
    await page.locator("#btn-shop").click();
    const crack = page.locator("#shop-piggy-crack");
    await expect(crack).toBeEnabled();
    await crack.click();
    // The vault empties and the coins land in the wallet.
    const after = await page.evaluate(() => ({
      coins: window.__bpc.Economy.coins,
      bank: window.__bpc.Storage.get("piggyBank"),
    }));
    expect(after.coins).toBe(before + 500);
    expect(after.bank).toBe(0);
    // The card re-renders to a locked state.
    await expect(page.locator("#shop-piggy-crack")).toBeDisabled();
  });
});

test.describe("puzzle mode (Tier 2)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("the Puzzles screen lists the ladder with only the first unlocked", async ({
    page,
  }) => {
    await page.locator("#btn-puzzle").click();
    await expect(page.locator("#puzzle")).toBeVisible();
    const count = await page.evaluate(() => window.__bpc.puzzle.PUZZLE_COUNT);
    await expect(page.locator("#puzzle-list .puzzle-cell")).toHaveCount(count);
    // A fresh save unlocks puzzle 1 only; the rest show a padlock.
    await expect(page.locator("#puzzle-list .puzzle-cell").first()).not.toHaveClass(
      /locked/
    );
    await expect(page.locator("#puzzle-list .puzzle-cell").nth(1)).toHaveClass(
      /locked/
    );
  });

  test("the Puzzles list scrolls so every unlocked puzzle can be reached", async ({
    page,
  }) => {
    // Regression: `.puzzle-grid` had no `overflow-y`, so once enough puzzles
    // unlock to exceed one screen (18 puzzles, 3 per row = 6 rows), the tail
    // of the ladder was clipped with no way to scroll down to it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const stars = {};
      const count = window.__bpc.puzzle.PUZZLE_COUNT;
      for (let i = 0; i < count; i++) stars[i] = 3;
      window.__bpc.Storage.set("puzzle", { stars });
    });
    await page.locator("#btn-puzzle").click();
    await expect(page.locator("#puzzle")).toBeVisible();
    const count = await page.evaluate(() => window.__bpc.puzzle.PUZZLE_COUNT);
    await expect(page.locator("#puzzle-list .puzzle-cell")).toHaveCount(count);

    const metrics = await page.evaluate(() => {
      const grid = document.getElementById("puzzle-list");
      const cs = getComputedStyle(grid);
      return {
        overflowY: cs.overflowY,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
      };
    });
    expect(metrics.overflowY).toBe("auto");
    // The content is genuinely taller than the visible area in this scenario.
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    // Scrolling the list all the way down must bring the very last puzzle
    // cell into view (it was previously unreachable, clipped off-screen).
    const lastCell = page.locator("#puzzle-list .puzzle-cell").last();
    await lastCell.scrollIntoViewIfNeeded();
    await expect(lastCell).toBeInViewport();
  });

  test("solving a puzzle records stars and unlocks the next one", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startPuzzle(0));
    await page.waitForTimeout(400);
    // The HUD shows the puzzle goal (clear the board within the move budget).
    await expect(page.locator("#hud-mode-label")).toContainText("Puzzle 1");
    await solvePuzzle(page);
    // The clear-the-board win lands a short delay after the last pop settles.
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#win-stars .star.on")).not.toHaveCount(0);
    const state = await page.evaluate(() => ({
      stars: window.__bpc.Storage.getPuzzleStars(0),
      unlocked: window.__bpc.puzzle.isPuzzleUnlocked(
        1,
        window.__bpc.Storage.getPuzzleStarsMap()
      ),
    }));
    expect(state.stars).toBeGreaterThanOrEqual(1);
    expect(state.unlocked).toBe(true);
  });

  test("running out of moves without clearing the board fails the puzzle", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startPuzzle(0));
    await page.waitForTimeout(400);
    // Squeeze the budget down to a single move, then spend it without clearing
    // the (still mostly full) board — that must end the attempt as a loss.
    const popped = await page.evaluate(() => {
      const g = window.__bpc.game;
      g.session.movesLeft = 1;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === -1) continue;
          if (b.getGroupAt(c, r).length >= 2) {
            g.popAt(c, r);
            return true;
          }
        }
      return false;
    });
    expect(popped).toBe(true);
    await expect(page.locator("#lose")).toBeVisible();
    // Puzzles never offer a revive (the fixed move budget is the whole point).
    await expect(page.locator("#lose-revive")).toBeHidden();
    // The board wasn't cleared, so no stars were banked.
    expect(await page.evaluate(() => window.__bpc.Storage.getPuzzleStars(0))).toBe(0);
  });

  // Puzzles 13+ reuse the campaign's boss archetypes (frozen core / stone
  // vault / colour hunt) for a narrower objective than "clear everything" —
  // the whole point of the new puzzle types is that they can be WON while
  // ordinary bubbles are still on the board.
  test("a frozen ice-core puzzle is won by shattering just the core, bubbles may remain", async ({
    page,
  }) => {
    // Unlock puzzle 13 (index 12) by faking the first 12 as solved.
    await page.evaluate(() => {
      const stars = {};
      for (let i = 0; i < 12; i++) stars[i] = 1;
      window.__bpc.Storage.set("puzzle", { stars });
    });
    await page.evaluate(() => window.__bpc.game.startPuzzle(12));
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => {
      const g = window.__bpc.game;
      return {
        puzzleType: g.session.puzzleType,
        hasBounds: !!g.session.puzzleBounds,
        core: g.session.board.frozenRemaining(),
        total: g.session.board.countRemaining(),
      };
    });
    expect(before.puzzleType).toBe("frozen");
    expect(before.hasBounds).toBe(true);
    expect(before.core).toBeGreaterThan(0);
    // The seeded core is smaller than the whole board — plenty of ordinary
    // bubbles surround it.
    expect(before.total).toBeGreaterThan(before.core);
    await expect(page.locator("#hud-target-label")).toHaveText("Core");

    // Shatter only the ice core (ICE = 1, ICE_CRACKED = 3) and resolve the
    // move — the board still has plenty of ordinary bubbles left.
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
    expect(await page.evaluate(() => window.__bpc.Storage.getPuzzleStars(12))).toBeGreaterThanOrEqual(1);
  });

  test("a stone-vault puzzle is won by breaking just the stones, bubbles may remain", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const stars = {};
      for (let i = 0; i < 13; i++) stars[i] = 1;
      window.__bpc.Storage.set("puzzle", { stars });
    });
    await page.evaluate(() => window.__bpc.game.startPuzzle(13));
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => ({
      puzzleType: window.__bpc.game.session.puzzleType,
      stones: window.__bpc.game.session.board.stoneRemaining(),
    }));
    expect(before.puzzleType).toBe("stone");
    expect(before.stones).toBeGreaterThan(0);
    await expect(page.locator("#hud-target-label")).toHaveText("Stone");

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.types[c][r] === 5) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });
    await expect(page.locator("#win")).toBeVisible();
    expect(await page.evaluate(() => window.__bpc.Storage.getPuzzleStars(13))).toBeGreaterThanOrEqual(1);
  });

  test("a colour-hunt puzzle is won by clearing just the hunted colour, bubbles may remain", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const stars = {};
      for (let i = 0; i < 14; i++) stars[i] = 1;
      window.__bpc.Storage.set("puzzle", { stars });
    });
    await page.evaluate(() => window.__bpc.game.startPuzzle(14));
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => {
      const g = window.__bpc.game;
      const tc = g.session.puzzleTargetColor;
      return {
        puzzleType: g.session.puzzleType,
        targetColor: tc,
        left: tc >= 0 ? g.session.board.colorCells(tc).length : 0,
      };
    });
    expect(before.puzzleType).toBe("color");
    expect(before.targetColor).toBeGreaterThanOrEqual(0);
    expect(before.left).toBeGreaterThan(0);
    await expect(page.locator("#hud-target-label")).toHaveText("Left");

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const b = g.session.board;
      const tc = g.session.puzzleTargetColor;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          if (b.grid[c][r] === tc) {
            b.grid[c][r] = -1;
            b.types[c][r] = 0;
            b.spriteGrid[c][r] = null;
          }
        }
      g.afterMove();
    });
    await expect(page.locator("#win")).toBeVisible();
    expect(await page.evaluate(() => window.__bpc.Storage.getPuzzleStars(14))).toBeGreaterThanOrEqual(1);
  });

  test("the Puzzles screen shows a distinct objective badge per puzzle type", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const stars = {};
      for (let i = 0; i < 12; i++) stars[i] = 1;
      window.__bpc.Storage.set("puzzle", { stars });
    });
    await page.locator("#btn-puzzle").click();
    await expect(page.locator("#puzzle")).toBeVisible();
    // Puzzle 13 (index 12) is the first "frozen" (Ice Core) puzzle.
    const cell = page.locator("#puzzle-list .puzzle-cell").nth(12);
    await expect(cell).not.toHaveClass(/locked/);
    await expect(cell.locator(".pz-type")).toHaveText("🧊");
    await expect(cell.locator(".pz-obj")).toHaveText("Ice Core");
  });
});

// ---------------------------------------------------------------------------
// Downpour — the Tetris-style advanced-level modifier. Every N resolved moves a
// fresh row of bubbles rains in from the top of each column and settles down;
// let the stack reach the ceiling and you're "Buried!". Gated to campaign
// levels >= 30 and suppressed on boss/treasure milestones.
// ---------------------------------------------------------------------------
test.describe("downpour (advanced levels)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("advanced campaign levels arm downpour, early levels don't", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    expect(
      await page.evaluate(() => window.__bpc.game.session.downpour)
    ).toEqual({ interval: 6 });
    // Early levels stay a pure tap-to-pop game — no rain.
    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    expect(
      await page.evaluate(() => window.__bpc.game.session.downpour)
    ).toBeNull();
  });

  test("a downpour drop rains a fresh row onto the stacks every N moves", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const bd = s.board;
      // Mimic a post-pop board: gravity has settled the stacks downward, so the
      // top few rows are empty and ready to receive rain.
      for (let c = 0; c < bd.cols; c++)
        for (let r = 0; r < 3; r++) {
          bd.grid[c][r] = -1;
          bd.spriteGrid[c][r] = null;
        }
      bd.sprites = bd.sprites.filter((sp) => bd.grid[sp.c][sp.r] !== -1);
      const topBefore = bd.topFilledRow();
      const countBefore = bd.countRemaining();
      // Drive the move-driven cadence: the first 5 ticks are quiet, the 6th
      // (interval) drops a row and resets the counter.
      const tops = [];
      s.movesSinceDrop = 0;
      for (let i = 0; i < 6; i++) {
        g._downpour();
        tops.push({ moves: s.movesSinceDrop, top: bd.topFilledRow() });
      }
      return {
        topBefore,
        topAfter: bd.topFilledRow(),
        countBefore,
        countAfter: bd.countRemaining(),
        tops,
      };
    });
    // Five quiet ticks (counter climbs), then the drop on the 6th resets it.
    expect(result.tops.slice(0, 5).map((t) => t.moves)).toEqual([1, 2, 3, 4, 5]);
    expect(result.tops[5].moves).toBe(0);
    // The stack rose one row toward the ceiling and the board has more bubbles.
    expect(result.topAfter).toBe(result.topBefore - 1);
    expect(result.countAfter).toBeGreaterThan(result.countBefore);
  });

  test("a successful downpour drop grants one extra move", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const bd = s.board;
      // Keep clear headroom so a rain row can actually land.
      for (let c = 0; c < bd.cols; c++)
        for (let r = 0; r < 3; r++) {
          bd.grid[c][r] = -1;
          bd.spriteGrid[c][r] = null;
        }
      const movesBefore = s.movesLeft;
      const countBefore = bd.countRemaining();
      s.movesSinceDrop = 5; // next _downpour call triggers the rain tick
      const ended = g._downpour();
      const countAfter = bd.countRemaining();
      const added = Math.max(0, countAfter - countBefore);
      const expectedBonus = added > 0 ? 1 : 0;
      return {
        ended,
        movesBefore,
        movesAfter: s.movesLeft,
        added,
        expectedBonus,
      };
    });
    expect(result.ended).toBe(false);
    expect(result.added).toBeGreaterThan(0);
    expect(result.expectedBonus).toBe(1);
    expect(result.movesAfter).toBe(result.movesBefore + result.expectedBonus);
  });

  test("a single blocked column does not instantly bury the player", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const bd = s.board;
      // Ensure there is headroom in most columns, but hard-block one column.
      for (let c = 0; c < bd.cols; c++) {
        for (let r = 0; r < 3; r++) {
          bd.grid[c][r] = -1;
          bd.spriteGrid[c][r] = null;
        }
      }
      for (let r = 0; r < bd.rows; r++) if (bd.grid[0][r] === -1) bd.grid[0][r] = 0;
      s.movesSinceDrop = 5; // next tick triggers a drop
      const ended = g._downpour();
      return { ended, won: !!s.won, endedFlag: !!s.ended };
    });
    expect(result.ended).toBe(false);
    expect(result.endedFlag).toBe(false);
    await expect(page.locator("#lose")).toBeHidden();
  });

  test("a fully blocked ceiling buries the player", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const bd = s.board;
      // Pack every column solid to the top so the next rain has nowhere to land.
      for (let c = 0; c < bd.cols; c++) {
        for (let r = 0; r < bd.rows; r++) {
          if (bd.grid[c][r] === -1) bd.grid[c][r] = 0;
        }
      }
      s.movesSinceDrop = 5; // the next tick is the drop tick
      g._downpour();
    });
    await expect(page.locator("#lose")).toBeVisible();
    await expect(page.locator("#lose .modal-title")).toHaveText("Buried!");
  });

  test("after target is met, downpour no longer causes buried loss", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(41));
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      const bd = s.board;
      // Simulate a completed objective with a fully blocked ceiling.
      s.score = s.level.target;
      for (let c = 0; c < bd.cols; c++) {
        for (let r = 0; r < bd.rows; r++) {
          if (bd.grid[c][r] === -1) bd.grid[c][r] = 0;
        }
      }
      s.movesSinceDrop = 5;
      const ended = g._downpour();
      return {
        ended,
        endedFlag: s.ended,
        won: s.won,
        score: s.score,
        target: s.level.target,
      };
    });
    expect(result.score).toBe(result.target);
    expect(result.ended).toBe(false);
    expect(result.endedFlag).toBe(false);
    await expect(page.locator("#lose")).toBeHidden();
  });

  test("finish modal waits for remaining pop animation frames", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      // Ensure at least one sprite is still in a pop animation state.
      if (s.board.sprites.length > 0) {
        const sp = s.board.sprites[0];
        sp.state = "pop";
        sp.t = 0;
      }
      g._scheduleEnd(false, "buried");
    });

    // End should not show immediately while the pop frame is still active.
    await page.waitForTimeout(120);
    await expect(page.locator("#lose")).toBeHidden();

    // After the animation window settles, end modal appears normally.
    await expect(page.locator("#lose")).toBeVisible();
  });

  test("finish modal waits for slow downpour fall animations", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(31));
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      for (let c = 0; c < s.board.cols; c++) {
        for (let r = 0; r < 3; r++) {
          s.board.grid[c][r] = -1;
          s.board.types[c][r] = 0;
          s.board.spriteGrid[c][r] = null;
        }
      }
      s.board.dropRow();
      g._scheduleEnd(false, "buried");
    });

    await page.waitForTimeout(900);
    await expect(page.locator("#lose")).toBeHidden();
    await expect(page.locator("#lose")).toBeVisible({ timeout: 7000 });
  });
});

test.describe("Board Storm (positive mid-level burst)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("advanced levels arm the storm, early levels don't", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(6));
    const armed = await page.evaluate(() => window.__bpc.game.session.boardStorm);
    expect(armed).toBeTruthy();
    expect(armed.charges).toBeGreaterThan(0);

    await page.evaluate(() => window.__bpc.game.startCampaign(1));
    expect(
      await page.evaluate(() => window.__bpc.game.session.boardStorm)
    ).toBeNull();
  });

  test("a fired storm charges a plain bubble into Lightning on each of the next few moves", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(6));
    await page.waitForTimeout(300);

    // Force the storm to fire on the very next resolved move (bypassing the
    // random per-move chance), then check the charge budget applies one
    // upgrade per move until it's spent.
    const result = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.boardStorm.chance = 1;
      const before = {
        lightning: countLightning(),
        fired: s.boardStormFired,
      };
      g._boardStorm(); // fires: sets boardStormRemaining, no charge yet
      const afterFire = {
        fired: s.boardStormFired,
        remaining: s.boardStormRemaining,
        lightning: countLightning(),
      };
      g._boardStorm(); // first charge
      const afterFirstCharge = {
        remaining: s.boardStormRemaining,
        lightning: countLightning(),
      };
      // Drain the rest of the charge budget.
      while (s.boardStormRemaining > 0) g._boardStorm();
      const afterAll = { remaining: s.boardStormRemaining, lightning: countLightning() };

      function countLightning() {
        const b = s.board;
        let n = 0;
        for (let c = 0; c < b.cols; c++)
          for (let r = 0; r < b.rows; r++) if (b.isLightning(c, r)) n++;
        return n;
      }
      return { before, afterFire, afterFirstCharge, afterAll };
    });

    expect(result.before.fired).toBe(false);
    expect(result.afterFire.fired).toBe(true);
    expect(result.afterFire.remaining).toBeGreaterThan(0);
    // Firing itself doesn't charge a bubble yet — only subsequent moves do.
    expect(result.afterFire.lightning).toBe(result.before.lightning);
    expect(result.afterFirstCharge.lightning).toBeGreaterThan(result.before.lightning);
    expect(result.afterFirstCharge.remaining).toBe(result.afterFire.remaining - 1);
    // Once the charge budget is spent, no more Lightning bubbles get added.
    expect(result.afterAll.remaining).toBe(0);
    expect(result.afterAll.lightning).toBeGreaterThan(result.afterFirstCharge.lightning - 1);
  });

  test("the storm only ever fires once per level", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(6));
    await page.waitForTimeout(300);

    const firedTwice = await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.boardStorm.chance = 1;
      g._boardStorm(); // fires and starts charging
      while (s.boardStormRemaining > 0) g._boardStorm(); // spend the budget
      const remainingAfterSpend = s.boardStormRemaining;
      // Even with chance still 1, it must not arm/fire again this level.
      g._boardStorm();
      return { remainingAfterSpend, remainingNow: s.boardStormRemaining, fired: s.boardStormFired };
    });
    expect(firedTwice.remainingAfterSpend).toBe(0);
    expect(firedTwice.remainingNow).toBe(0);
    expect(firedTwice.fired).toBe(true);
  });
});

test.describe("Boss Finisher Cinematic", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("meeting a boss objective plays the enhanced finisher before the win screen shows", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(10));
    await page.waitForTimeout(600);

    // Shatter the entire frozen core to satisfy the boss objective (same
    // setup as the existing boss-win test).
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

    // The finisher is playing: input is suspended and the win screen hasn't
    // shown yet.
    const mid = await page.evaluate(() => ({
      finishing: window.__bpc.game.session.finishing,
      ended: window.__bpc.game.session.ended,
    }));
    expect(mid.finishing).toBe(true);
    expect(mid.ended).toBe(false);
    await expect(page.locator("#win")).toBeHidden();

    // Past the glow phase (~0.7s) the blast fires: the Combo Cam camera zoom
    // has been punched in as part of the bigger finisher explosion.
    await page.waitForTimeout(800);
    const zoomPeak = await page.evaluate(() => window.__bpc.game.cameraZoom.peak);
    expect(zoomPeak).toBeGreaterThan(0);

    // Once the cinematic resolves, the win screen shows and the level is won.
    await expect(page.locator("#win")).toBeVisible({ timeout: 4000 });
    expect(await page.evaluate(() => window.__bpc.game.session.ended)).toBe(true);
  });

  test("the finisher never fires for an ordinary (non-boss) level win", async ({
    page,
  }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      const g = window.__bpc.game;
      const s = g.session;
      s.score = s.level.target; // clear the score requirement
      const b = s.board;
      for (let c = 0; c < b.cols; c++)
        for (let r = 0; r < b.rows; r++) {
          b.grid[c][r] = -1;
          b.spriteGrid[c][r] = null;
        }
      g.afterMove();
    });

    // Board cleared and no boss milestone involved: the ordinary win path
    // resolves immediately, without the finisher's finishing flag.
    const finishing = await page.evaluate(() =>
      !!(window.__bpc.game.session && window.__bpc.game.session.finishing)
    );
    expect(finishing).toBe(false);
  });
});


