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
    await page.locator("#pu-bomb").click();
    await expect(page.locator("#pu-bomb")).toHaveClass(/armed/);
    // tap a central cell to drop the bomb
    await tapCell(page, 3, 4);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() =>
      window.__bpc.game.session.board.countRemaining()
    );
    expect(before - after).toBeGreaterThanOrEqual(4);
    await expect(page.locator("#pu-bomb-count")).toHaveText("0");
  });

  test("color clear removes an entire colour", async ({ page }) => {
    await page.evaluate(() => window.__bpc.game.startCampaign(2));
    await page.waitForTimeout(700);
    await page.locator("#pu-color").click();
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
    await page.locator("#pu-shuffle").click();
    await expect(page.locator("#pu-shuffle-count")).toHaveText("0");
    const hasMoves = await page.evaluate(() =>
      window.__bpc.game.session.board.hasMoves()
    );
    expect(hasMoves).toBe(true);
  });
});

test.describe("shop & monetization (UI)", () => {
  test.beforeEach(({ page }) => openGame(page));

  test("rewarded ad grants coins", async ({ page }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    await page.locator("#shop-list button", { hasText: "Watch ad" }).click();
    await expect(page.locator("#ad-overlay")).toBeVisible();
    await page.waitForTimeout(2600);
    await expect(page.locator("#shop-coins")).toHaveText("500");
  });

  test("buying a power-up deducts coins; insufficient funds is blocked", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Shop", exact: true }).click();
    // With 0 coins, buying the bomb (150) must fail with a toast.
    await page.locator("#shop-list button", { hasText: "150" }).click();
    await expect(page.locator("#toast")).toContainText("Not enough");

    // Earn coins, then the purchase succeeds.
    await page.locator("#shop-list button", { hasText: "Watch ad" }).click();
    await page.waitForTimeout(2600);
    const bombBefore = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    await page.locator("#shop-list button", { hasText: "150" }).click();
    await page.waitForTimeout(200);
    const bombAfter = await page.evaluate(() =>
      window.__bpc.Economy.getPowerup("bomb")
    );
    expect(bombAfter).toBe(bombBefore + 1);
    await expect(page.locator("#shop-coins")).toHaveText("350");
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
