import { describe, it, expect } from "vitest";
import { CB_SYMBOLS } from "../../src/renderer.js";
import { getLevel, LEVEL_COUNT } from "../../src/levels.js";

describe("colourblind symbols", () => {
  it("provides a distinct, non-empty glyph per colour index", () => {
    expect(CB_SYMBOLS.length).toBeGreaterThan(0);
    // Every entry is a unique, non-empty string.
    expect(new Set(CB_SYMBOLS).size).toBe(CB_SYMBOLS.length);
    for (const s of CB_SYMBOLS) {
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it("has at least as many symbols as any level uses colours", () => {
    let maxColors = 0;
    for (let i = 1; i <= LEVEL_COUNT; i++) {
      maxColors = Math.max(maxColors, getLevel(i).colors);
    }
    expect(CB_SYMBOLS.length).toBeGreaterThanOrEqual(maxColors);
  });
});
