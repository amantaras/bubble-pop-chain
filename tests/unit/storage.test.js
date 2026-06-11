import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
  });

  it("provides sane defaults", () => {
    expect(Storage.get("coins")).toBe(0);
    expect(Storage.get("maxUnlockedLevel")).toBe(1);
    expect(Storage.get("currentTheme")).toBe("aurora");
    expect(Storage.get("ownedThemes")).toContain("aurora");
    expect(Storage.get("adsRemoved")).toBe(false);
  });

  it("persists set() values to localStorage", () => {
    Storage.set("coins", 500);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.coins).toBe(500);
  });

  it("recordLevelResult only upgrades stars and unlocks the next level", () => {
    Storage.recordLevelResult(1, 2);
    expect(Storage.getStars(1)).toBe(2);
    expect(Storage.get("maxUnlockedLevel")).toBe(2);
    // a worse later attempt does not lower the record
    Storage.recordLevelResult(1, 1);
    expect(Storage.getStars(1)).toBe(2);
    // a better attempt upgrades it
    Storage.recordLevelResult(1, 3);
    expect(Storage.getStars(1)).toBe(3);
  });

  it("totalStars sums all recorded stars", () => {
    Storage.recordLevelResult(1, 3);
    Storage.recordLevelResult(2, 2);
    expect(Storage.totalStars()).toBe(5);
  });

  it("reset restores a complete default save", () => {
    Storage.set("coins", 999);
    Storage.reset();
    // Every documented default key must be present after a reset.
    for (const key of [
      "version",
      "maxUnlockedLevel",
      "stars",
      "highScoreEndless",
      "coins",
      "ownedThemes",
      "currentTheme",
      "adsRemoved",
      "muted",
      "powerups",
      "daily",
    ]) {
      expect(Storage.get(key)).not.toBeUndefined();
    }
    expect(Storage.get("coins")).toBe(0);
  });

  it("activeSession defaults to null and round-trips an object snapshot", () => {
    expect(Storage.get("activeSession")).toBeNull();
    const snap = {
      mode: "campaign",
      levelId: 3,
      score: 420,
      movesLeft: 7,
      revived: false,
      ended: false,
      grid: [[0, 1], [-1, 2]],
    };
    Storage.set("activeSession", snap);
    const raw = JSON.parse(localStorage.getItem("bpc_save_v1"));
    expect(raw.activeSession).toEqual(snap);
    // Clearing it stores null again.
    Storage.set("activeSession", null);
    expect(Storage.get("activeSession")).toBeNull();
  });
});
