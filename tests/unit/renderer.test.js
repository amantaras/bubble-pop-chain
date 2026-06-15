import { describe, it, expect } from "vitest";
import { CB_SYMBOLS, hexToRgb, shade, lighten } from "../../src/renderer.js";
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

// The colour helpers are memoized because they run several times per bubble,
// every frame, in the render loop. These tests pin the (unchanged) outputs and
// prove the cache returns a stable result so the optimization can't silently
// drift the on-screen colours.
describe("colour helpers (memoized, behaviour-preserving)", () => {
  it("hexToRgb parses channels correctly", () => {
    expect(hexToRgb("#1a2b3c")).toEqual({ r: 26, g: 43, b: 60 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("hexToRgb memoizes — repeated calls return the same object reference", () => {
    const a = hexToRgb("#123456");
    const b = hexToRgb("#123456");
    expect(a).toBe(b); // Object.is identity proves the cache hit.
  });

  it("shade scales each channel by the factor and clamps negatives to 0", () => {
    expect(shade("#ff0000", 0.5)).toBe("rgb(128, 0, 0)");
    expect(shade("#ffffff", 0.7)).toBe("rgb(179, 179, 179)");
    expect(shade("#abcdef", -2)).toBe("rgb(0, 0, 0)");
  });

  it("shade returns a stable value across repeated calls", () => {
    expect(shade("#336699", 0.42)).toBe(shade("#336699", 0.42));
  });

  it("lighten blends each channel toward white by the amount", () => {
    expect(lighten("#000000", 0.5)).toBe("rgb(128, 128, 128)");
    expect(lighten("#ffffff", 0.5)).toBe("rgb(255, 255, 255)");
    expect(lighten("#102030", 0)).toBe("rgb(16, 32, 48)");
  });

  it("lighten returns a stable value across repeated calls", () => {
    expect(lighten("#336699", 0.65)).toBe(lighten("#336699", 0.65));
  });
});

