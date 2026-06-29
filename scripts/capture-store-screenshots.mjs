import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_PORT = 4183;
const DEFAULT_OUT = "artifacts/store-screenshots";

const PROFILES = {
  phone: {
    label: "phone",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  tablet: {
    label: "tablet",
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

const DEFAULT_SCREENS = [
  "first-run",
  "campaign-board",
  "pets",
  "shop",
  "skybolt",
  "achievements",
  "settings",
];

function parseArgs(argv) {
  const opts = {
    baseUrl: null,
    port: DEFAULT_PORT,
    out: DEFAULT_OUT,
    devices: ["phone", "tablet"],
    screens: DEFAULT_SCREENS,
  };

  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) opts.baseUrl = arg.slice("--base-url=".length).replace(/\/$/, "");
    else if (arg.startsWith("--port=")) opts.port = Number(arg.slice("--port=".length));
    else if (arg.startsWith("--out=")) opts.out = arg.slice("--out=".length);
    else if (arg.startsWith("--device=")) {
      const value = arg.slice("--device=".length);
      opts.devices = value === "all" ? Object.keys(PROFILES) : value.split(",").filter(Boolean);
    } else if (arg.startsWith("--screens=")) {
      opts.screens = arg.slice("--screens=".length).split(",").filter(Boolean);
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const device of opts.devices) {
    if (!PROFILES[device]) throw new Error(`Unknown device profile: ${device}`);
  }
  for (const screen of opts.screens) {
    if (!DEFAULT_SCREENS.includes(screen)) throw new Error(`Unknown screen: ${screen}`);
  }
  if (!Number.isFinite(opts.port) || opts.port <= 0) throw new Error("--port must be a positive number");
  return opts;
}

function usage() {
  console.log(`Capture store-listing screenshots from the real Bubblit app.\n\nUsage:\n  npm run screenshots:store -- [options]\n\nOptions:\n  --device=phone|tablet|all     Device profile(s), comma-separated. Default: phone,tablet\n  --screens=a,b,c               Screens to capture. Default: ${DEFAULT_SCREENS.join(",")}\n  --out=path                    Output folder. Default: ${DEFAULT_OUT}\n  --port=4183                   Local server port when --base-url is omitted\n  --base-url=http://...         Reuse an already-running app URL\n`);
}

async function waitForServer(baseUrl, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/index.html`);
      if (res.ok) return;
    } catch (e) {
      // Retry until the local server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

function startServer(port) {
  const child = spawn(process.execPath, ["tests/server.mjs", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  return child;
}

async function openGame(page, baseUrl, { fresh = false } = {}) {
  if (fresh) await page.goto(`${baseUrl}/?e2e=1&capture=${Date.now()}`);
  else await page.goto(`${baseUrl}/?e2e=1`);
  await page.waitForFunction(() => window.__bpc && window.__bpc.game && window.__bpc.UI);
  await page.evaluate(() => {
    const game = window.__bpc.game;
    if (game.tutorial && game.tutorial.active) game.tutorial.skip();
  });
  await page.waitForFunction(() => !window.__bpc.game.tutorial);
}

async function seedShowcase(page) {
  await page.evaluate(() => {
    const { Storage, Economy, UI } = window.__bpc;
    Storage.set("firstRunDone", true);
    Storage.set("starterBonusClaimed", true);
    Storage.set("maxUnlockedLevel", 36);
    Storage.set("coins", 8420);
    Storage.set("ownedThemes", ["aurora", "sunset", "forest", "candy", "ember", "tidal"]);
    Storage.set("currentTheme", "ember");
    Storage.set("highScoreEndless", 18420);
    Storage.set("highScoreTimeAttack", 9750);
    Storage.set("season", { xp: 760, claimedFree: [0, 1, 2], claimedPrem: [], premium: false });
    Storage.set("achievements", {
      claims: { popper: 2, combo: 1, bigbang: 1 },
      progress: {
        pops: 1320,
        bestCombo: 9,
        biggestGroup: 16,
        fevers: 11,
        levelsCleared: 34,
        totalStars: 88,
        defuses: 7,
        coinsEarned: 22400,
      },
    });
    Storage.set("powerups", {
      undo: 4,
      bomb: 5,
      colorClear: 4,
      paint: 3,
      shuffle: 5,
      chainBolt: 3,
      pick: 4,
      extraMoves: 2,
      magnet: 2,
    });
    Storage.set("loadout", ["bomb", "colorClear", "magnet"]);
    for (let level = 1; level <= 35; level += 1) {
      Storage.recordLevelResult(level, level % 5 === 0 ? 3 : 2);
      Storage.recordLevelScore(level, 1000 + level * 231);
    }
    for (const [id, trait, xp] of [
      ["sparky", "swift", 720],
      ["skybolt", "mighty", 920],
      ["draco", "lucky", 640],
      ["luma", "keen", 420],
    ]) {
      if (!Storage.ownsPet(id)) Storage.grantPet(id, trait);
      Storage.addPetXp(id, xp);
    }
    Storage.equipPet("skybolt");
    const supports = Storage.getPartySupports();
    if (!supports.includes("sparky")) Storage.toggleSupport("sparky");
    if (!Storage.getPartySupports().includes("draco")) Storage.toggleSupport("draco");
    Storage.addDust(760);
    for (const [key, count] of [
      ["ruby:brilliant", 1],
      ["citrine:polished", 2],
      ["sapphire:polished", 3],
      ["diamond:chipped", 4],
      ["emerald:chipped", 5],
    ]) {
      Storage.addGem(key, count);
    }
    Economy.addCoins(0);
    UI.refreshCoins();
    UI.refreshPetAccess();
    UI.updatePowerups();
    UI.updatePetHud(Storage.getEquippedPet());
    UI.showScreen("menu");
  });
}

async function settle(page) {
  await page.waitForTimeout(450);
}

async function screenshot(page, outDir, profile, screen) {
  await settle(page);
  const file = path.join(outDir, `${profile.label}-${screen}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured ${file}`);
}

async function captureFirstRun(page, baseUrl, outDir, profile) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${baseUrl}/?e2e=1&splash=1&capture=${Date.now()}`);
  await page.waitForSelector("#splash:not(.hidden)");
  await screenshot(page, outDir, profile, "first-run");
  await openGame(page, baseUrl, { fresh: true });
  await seedShowcase(page);
}

async function captureCampaignBoard(page, outDir, profile) {
  await page.evaluate(() => {
    window.__bpc.game.startCampaign(24);
    const session = window.__bpc.game.session;
    session.score = 4280;
    session.power = 1;
    session.fever = 0.72;
    session.combo = 4;
    session.movesLeft = Math.max(6, session.movesLeft - 4);
    window.__bpc.game.refreshHud();
  });
  await page.waitForSelector("#hud:not(.hidden)");
  await screenshot(page, outDir, profile, "campaign-board");
}

async function capturePets(page, outDir, profile) {
  await page.evaluate(() => {
    window.__bpc.game.quitToMenu();
    window.__bpc.UI.openPetOverlay({ petId: "skybolt" });
  });
  await page.waitForSelector("#pets:not(.hidden)");
  await screenshot(page, outDir, profile, "pets");
}

async function captureShop(page, outDir, profile) {
  await page.evaluate(() => window.__bpc.UI.showScreen("shop"));
  await page.waitForSelector("#shop:not(.hidden)");
  await screenshot(page, outDir, profile, "shop");
}

async function captureSkybolt(page, outDir, profile) {
  await page.evaluate(() => {
    window.__bpc.UI.closePetOverlay();
    window.__bpc.game.startCampaign(32);
    const session = window.__bpc.game.session;
    session.petTimer = 999;
    window.__bpc.game.refreshHud();
  });
  await page.waitForSelector("#hud:not(.hidden)");
  await page.waitForTimeout(900);
  await screenshot(page, outDir, profile, "skybolt");
}

async function captureAchievements(page, outDir, profile) {
  await page.evaluate(() => {
    window.__bpc.game.quitToMenu();
    window.__bpc.UI.showScreen("achievements");
  });
  await page.waitForSelector("#achievements:not(.hidden)");
  await screenshot(page, outDir, profile, "achievements");
}

async function captureSettings(page, outDir, profile) {
  await page.evaluate(() => window.__bpc.UI.showScreen("themes"));
  await page.waitForSelector("#themes:not(.hidden)");
  await screenshot(page, outDir, profile, "settings");
}

const CAPTURES = {
  "first-run": captureFirstRun,
  "campaign-board": captureCampaignBoard,
  pets: capturePets,
  shop: captureShop,
  skybolt: captureSkybolt,
  achievements: captureAchievements,
  settings: captureSettings,
};

async function captureProfile(browser, baseUrl, outRoot, profile, screens) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  const outDir = path.resolve(ROOT, outRoot, profile.label);
  await mkdir(outDir, { recursive: true });
  await openGame(page, baseUrl, { fresh: true });
  await seedShowcase(page);

  for (const screen of screens) {
    const fn = CAPTURES[screen];
    if (screen === "first-run") await fn(page, baseUrl, outDir, profile);
    else await fn(page, outDir, profile);
  }

  await context.close();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }

  const baseUrl = opts.baseUrl || `http://127.0.0.1:${opts.port}`;
  const server = opts.baseUrl ? null : startServer(opts.port);
  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    for (const device of opts.devices) {
      await captureProfile(browser, baseUrl, opts.out, PROFILES[device], opts.screens);
    }
    await browser.close();
  } finally {
    if (server && !server.killed) server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});