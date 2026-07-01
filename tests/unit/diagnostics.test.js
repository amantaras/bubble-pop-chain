import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_VERSION,
  MAX_DIAGNOSTIC_ERRORS,
  recordRuntimeError,
  getRuntimeErrors,
  clearRuntimeErrors,
  buildDiagnosticsReport,
  diagnosticsRows,
  formatDiagnosticsReport,
} from "../../src/diagnostics.js";

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

describe("diagnostics — runtime error ring buffer", () => {
  beforeEach(() => {
    clearRuntimeErrors();
  });

  it("APP_VERSION stays in sync with package.json (manually bumped, like sw.js CACHE)", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("records and returns errors in order", () => {
    recordRuntimeError({ message: "first" });
    recordRuntimeError({ message: "second" });
    const errs = getRuntimeErrors();
    expect(errs).toHaveLength(2);
    expect(errs[0].message).toBe("first");
    expect(errs[1].message).toBe("second");
  });

  it("caps the buffer at MAX_DIAGNOSTIC_ERRORS, dropping the oldest first", () => {
    for (let i = 0; i < MAX_DIAGNOSTIC_ERRORS + 5; i++) {
      recordRuntimeError({ message: `err-${i}` });
    }
    const errs = getRuntimeErrors();
    expect(errs).toHaveLength(MAX_DIAGNOSTIC_ERRORS);
    // The oldest 5 were dropped, so the buffer starts at err-5.
    expect(errs[0].message).toBe("err-5");
    expect(errs[errs.length - 1].message).toBe(`err-${MAX_DIAGNOSTIC_ERRORS + 4}`);
  });

  it("returns a defensive copy, not the live internal array", () => {
    recordRuntimeError({ message: "a" });
    const errs = getRuntimeErrors();
    errs.push({ message: "mutated" });
    expect(getRuntimeErrors()).toHaveLength(1);
  });

  it("clearRuntimeErrors empties the buffer", () => {
    recordRuntimeError({ message: "a" });
    clearRuntimeErrors();
    expect(getRuntimeErrors()).toHaveLength(0);
  });

  it("caps/truncates oversized fields so a huge stack can never bloat the report unboundedly", () => {
    const huge = "x".repeat(5000);
    const entry = recordRuntimeError({ message: huge, source: huge, stack: huge });
    expect(entry.message.length).toBeLessThanOrEqual(300);
    expect(entry.source.length).toBeLessThanOrEqual(200);
    expect(entry.stack.length).toBeLessThanOrEqual(1000);
  });

  it("falls back to a safe default message and timestamp when given nothing useful", () => {
    const entry = recordRuntimeError({});
    expect(entry.message).toBe("Unknown error");
    expect(entry.time).toBeGreaterThan(0);
    expect(entry.line).toBeNull();
    expect(entry.col).toBeNull();
  });
});

describe("diagnostics — report building (pure, no DOM/storage)", () => {
  beforeEach(() => {
    clearRuntimeErrors();
  });

  it("maps a full save + env into a well-formed report", () => {
    const save = {
      maxUnlockedLevel: 12,
      stars: { 1: 3, 2: 2, 3: 1 },
      coins: 4200,
      currentTheme: "candy",
      muted: true,
      settings: { colorblind: true, hints: false, reducedMotion: true },
      adsRemoved: true,
      starterPack: true,
      daily: { streak: 5 },
      season: { xp: 340 },
      achievements: { claims: { popper: 2, combo: 1 } },
      pets: { owned: { sparky: {}, draco: {} }, equipped: "sparky" },
      puzzle: { stars: { 0: 3, 1: 2 } },
      highScoreEndless: 18000,
      highScoreTimeAttack: 9000,
      activeSession: { level: { id: 5 } },
    };
    const env = {
      now: 1000,
      version: "9.9.9",
      nativeShell: true,
      userAgent: "TestAgent/1.0",
      language: "en-US",
      screen: { width: 390, height: 844 },
      dpr: 3,
      online: true,
    };
    const report = buildDiagnosticsReport(save, env);

    expect(report.generatedAt).toBe(1000);
    expect(report.app).toEqual({ version: "9.9.9", nativeShell: true });
    expect(report.device).toEqual({
      userAgent: "TestAgent/1.0",
      language: "en-US",
      screen: { width: 390, height: 844 },
      dpr: 3,
      online: true,
    });
    expect(report.profile.maxUnlockedLevel).toBe(12);
    expect(report.profile.totalStars).toBe(6); // 3+2+1
    expect(report.profile.coins).toBe(4200);
    expect(report.profile.currentTheme).toBe("candy");
    expect(report.profile.muted).toBe(true);
    expect(report.profile.adsRemoved).toBe(true);
    expect(report.profile.starterPack).toBe(true);
    expect(report.profile.dailyStreak).toBe(5);
    expect(report.profile.seasonXp).toBe(340);
    expect(report.profile.chestsClaimed).toBe(3); // 2+1
    expect(report.profile.petsOwned).toBe(2);
    expect(report.profile.equippedPet).toBe("sparky");
    expect(report.profile.puzzlesSolved).toBe(2);
    expect(report.profile.highScoreEndless).toBe(18000);
    expect(report.profile.highScoreTimeAttack).toBe(9000);
    expect(report.profile.hasActiveSession).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it("defaults every field safely for an empty/missing save", () => {
    const report = buildDiagnosticsReport(null, {});
    expect(report.app.version).toBe(APP_VERSION);
    expect(report.app.nativeShell).toBe(false);
    expect(report.device.userAgent).toBe("unknown");
    expect(report.device.online).toBe(true); // defaults true unless explicitly false
    expect(report.profile.maxUnlockedLevel).toBe(1);
    expect(report.profile.totalStars).toBe(0);
    expect(report.profile.currentTheme).toBe("aurora");
    expect(report.profile.hasActiveSession).toBe(false);
    expect(report.errors).toEqual([]);
  });

  it("includes recorded runtime errors in the report", () => {
    recordRuntimeError({ message: "boom", source: "main.js", line: 12, col: 4 });
    const report = buildDiagnosticsReport({}, {});
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ message: "boom", source: "main.js", line: 12, col: 4 });
  });

  it("diagnosticsRows flattens the report into display-ready rows", () => {
    const report = buildDiagnosticsReport(
      { maxUnlockedLevel: 7, stars: { 1: 2 }, coins: 50, currentTheme: "sunset" },
      { screen: { width: 100, height: 200 } }
    );
    const rows = diagnosticsRows(report);
    expect(rows.length).toBeGreaterThan(0);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey.level).toBe(7);
    expect(byKey.stars).toBe(2);
    expect(byKey.coins).toBe(50);
    expect(byKey.theme).toBe("sunset");
    expect(byKey.screen).toBe("100×200");
    expect(byKey.errors).toBe(0);
    // Every row has an icon + label so the UI can render it generically.
    for (const row of rows) {
      expect(typeof row.icon).toBe("string");
      expect(typeof row.label).toBe("string");
    }
  });

  it("formatDiagnosticsReport produces readable text embedding the raw JSON", () => {
    recordRuntimeError({ message: "sample error", source: "grid.js", line: 3, col: 1 });
    const report = buildDiagnosticsReport(
      { maxUnlockedLevel: 4, coins: 10, currentTheme: "aurora" },
      { version: "1.2.3", userAgent: "UA/1" }
    );
    const text = formatDiagnosticsReport(report);
    expect(text).toContain("Bubblit! Diagnostics Report");
    expect(text).toContain("1.2.3");
    expect(text).toContain("UA/1");
    expect(text).toContain("sample error");
    expect(text).toContain("--- raw JSON ---");
    // The raw JSON blob at the end must be valid, round-trippable JSON.
    const jsonLine = text.split("--- raw JSON ---\n")[1];
    expect(() => JSON.parse(jsonLine)).not.toThrow();
  });

  it("formatDiagnosticsReport reports 'none recorded' when there are no errors", () => {
    const report = buildDiagnosticsReport({}, {});
    const text = formatDiagnosticsReport(report);
    expect(text).toContain("none recorded this session");
  });
});
