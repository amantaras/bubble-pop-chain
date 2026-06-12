import { describe, it, expect } from "vitest";
import { getLevel, starThresholds, LEVEL_COUNT } from "../../src/levels.js";

describe("levels", () => {
  it("exposes a positive level count", () => {
    expect(LEVEL_COUNT).toBeGreaterThan(0);
  });

  it("clamps ids into the valid range", () => {
    expect(getLevel(0).id).toBe(1);
    expect(getLevel(-5).id).toBe(1);
    expect(getLevel(LEVEL_COUNT + 99).id).toBe(LEVEL_COUNT);
  });

  it("is deterministic (same seed per id)", () => {
    expect(getLevel(7).seed).toBe(getLevel(7).seed);
    expect(getLevel(7).seed).not.toBe(getLevel(8).seed);
  });

  it("difficulty curve scales up across all 4 colour tiers", () => {
    expect(getLevel(1).colors).toBe(3);
    expect(getLevel(6).colors).toBe(4);
    expect(getLevel(15).colors).toBe(5);
    expect(getLevel(30).colors).toBe(6);
  });

  it("board grows and stays within sane bounds", () => {
    const early = getLevel(1);
    const late = getLevel(LEVEL_COUNT);
    expect(late.cols).toBeGreaterThanOrEqual(early.cols);
    expect(late.rows).toBeGreaterThanOrEqual(early.rows);
    for (let n = 1; n <= LEVEL_COUNT; n++) {
      const lvl = getLevel(n);
      expect(lvl.cols).toBeGreaterThanOrEqual(6);
      expect(lvl.rows).toBeGreaterThanOrEqual(8);
      expect(lvl.moves).toBeGreaterThanOrEqual(6);
      expect(lvl.target).toBeGreaterThan(0);
    }
  });

  it("targets rise with level number", () => {
    expect(getLevel(20).target).toBeGreaterThan(getLevel(2).target);
  });

  it("star thresholds are strictly increasing", () => {
    const t = starThresholds(getLevel(10));
    expect(t.two).toBeGreaterThan(t.one);
    expect(t.three).toBeGreaterThan(t.two);
  });

  it("lightning bubbles ramp in from level 14 and not before", () => {
    expect(getLevel(13).specials.lightning || 0).toBe(0);
    expect(getLevel(14).specials.lightning).toBeGreaterThan(0);
    // Rate climbs with level but stays capped.
    expect(getLevel(40).specials.lightning).toBeGreaterThanOrEqual(
      getLevel(14).specials.lightning
    );
    expect(getLevel(40).specials.lightning).toBeLessThanOrEqual(0.04);
  });
});
