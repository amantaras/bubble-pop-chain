import { describe, it, expect } from "vitest";
import { CB_SYMBOLS, Renderer, SPECIAL_ICON_ASSETS, hexToRgb, shade, lighten, themeMotif } from "../../src/renderer.js";
import { THEMES } from "../../src/themes.js";
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

describe("special bubble icon assets", () => {
  it("uses only local vendored SVG icons", () => {
    const values = Object.values(SPECIAL_ICON_ASSETS);
    expect(values.length).toBeGreaterThanOrEqual(7);
    for (const asset of values) {
      expect(asset).toMatch(/^\.\/assets\/icons\/(game-icons|special)\/.+\.svg$/);
      expect(asset).not.toMatch(/^https?:/);
    }
    expect(SPECIAL_ICON_ASSETS[4]).toBe("./assets/icons/special/lightning-mark.svg");
  });
});

describe("theme background motifs", () => {
  it("assigns every visual theme a motif profile", () => {
    const kinds = new Set();
    for (const theme of THEMES) {
      const motif = themeMotif(theme.id);
      expect(motif).toBeTruthy();
      expect(motif.count).toBeGreaterThan(0);
      expect(motif.alpha).toBeGreaterThan(0);
      kinds.add(motif.kind);
    }
    expect(kinds.size).toBeGreaterThan(6);
  });

  it("drawBackground handles motifs in normal and reduced-motion modes", () => {
    const calls = [];
    const gradient = { addColorStop: (...args) => calls.push(["addColorStop", ...args]) };
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
          if (
            [
              "save",
              "restore",
              "fillRect",
              "beginPath",
              "moveTo",
              "lineTo",
              "bezierCurveTo",
              "quadraticCurveTo",
              "stroke",
              "fill",
              "arc",
              "ellipse",
              "translate",
              "rotate",
              "closePath",
            ].includes(prop)
          ) return (...args) => calls.push([prop, ...args]);
          return undefined;
        },
        set: () => true,
      }
    );
    const renderer = new Renderer(ctx);
    expect(() => renderer.drawBackground(360, 640, THEMES[0], 1234)).not.toThrow();
    renderer.reducedMotion = true;
    expect(() => renderer.drawBackground(360, 640, THEMES[6], 5678)).not.toThrow();
    expect(calls.some(([name]) => name === "stroke" || name === "fill")).toBe(true);
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

// The Archer power gauge is drawn beside wherever the player starts the pull,
// which can be anywhere on the board — including right at an edge or the top
// row. Without clamping, the gauge (and its "PULL"/"POWER"/"BULLSEYE" label)
// could render partly off-canvas or hidden behind the HUD, which is a real
// readability regression on small phones. These tests drive the real
// drawArcherAim() against a small fake canvas and assert the gauge rectangle
// always stays fully on-screen and clear of the board's top edge.
describe("Archer aim power gauge (on-screen clamp)", () => {
  function fakeCtx(clientWidth, clientHeight) {
    const fillRects = [];
    const canvas = { clientWidth, clientHeight };
    const handler = {
      get(_t, prop) {
        if (prop === "canvas") return canvas;
        if (prop === "fillRect") return (x, y, w, h) => fillRects.push({ x, y, w, h });
        if (prop === "createLinearGradient" || prop === "createRadialGradient")
          return () => ({ addColorStop: () => {} });
        if (
          [
            "save", "restore", "beginPath", "moveTo", "lineTo", "arc", "stroke",
            "fill", "fillText", "strokeRect", "closePath",
          ].includes(prop)
        )
          return () => {};
        return undefined;
      },
      set: () => true,
    };
    return { ctx: new Proxy({}, handler), fillRects };
  }

  function baseAim(start, end) {
    return { start, end, power: 0.5, sweet: 0.68, cells: [] };
  }

  it("keeps the gauge fully inside a small canvas when pulling near the top-left corner", () => {
    const { ctx, fillRects } = fakeCtx(360, 640);
    const renderer = new Renderer(ctx);
    const board = { cell: 40, originY: 168 };
    // Pull origin right at the top-left of the board — an unclamped gauge
    // would compute a negative x/y here (off-canvas, and above the HUD).
    renderer.drawArcherAim(board, baseAim({ x: 10, y: 172 }, { x: 40, y: 172 }), 0);

    expect(fillRects.length).toBeGreaterThan(0);
    const gauge = fillRects[0]; // the background bar is drawn first
    expect(gauge.x).toBeGreaterThanOrEqual(0);
    expect(gauge.y).toBeGreaterThanOrEqual(0);
    expect(gauge.x + gauge.w).toBeLessThanOrEqual(360);
    // The gauge (plus its label above it) must not draw above the board's
    // top edge, so it never hides behind the HUD.
    expect(gauge.y).toBeGreaterThanOrEqual(board.originY - 24);
  });

  it("keeps the gauge fully inside a small canvas when pulling near the bottom-right corner", () => {
    const { ctx, fillRects } = fakeCtx(360, 640);
    const renderer = new Renderer(ctx);
    const board = { cell: 40, originY: 168 };
    renderer.drawArcherAim(board, baseAim({ x: 350, y: 630 }, { x: 320, y: 600 }), 0);

    const gauge = fillRects[0];
    const gw = board.cell * 2.3;
    const gh = Math.max(8, board.cell * 0.16);
    expect(gauge.x + gw).toBeLessThanOrEqual(360 + 0.001);
    expect(gauge.y + gh).toBeLessThanOrEqual(640 + 0.001);
  });

  it("draws the gauge at its natural position when there is plenty of room", () => {
    const { ctx, fillRects } = fakeCtx(800, 1200);
    const renderer = new Renderer(ctx);
    const board = { cell: 40, originY: 168 };
    const start = { x: 400, y: 500 };
    renderer.drawArcherAim(board, baseAim(start, { x: 420, y: 480 }), 0);

    const gauge = fillRects[0];
    expect(gauge.x).toBeCloseTo(start.x - board.cell * 1.15, 5);
    expect(gauge.y).toBeCloseTo(start.y - board.cell * 1.25, 5);
  });

  it("never throws when the canvas dimensions are unavailable (defensive fallback)", () => {
    const { ctx } = fakeCtx(undefined, undefined);
    const renderer = new Renderer(ctx);
    const board = { cell: 40, originY: 168 };
    expect(() =>
      renderer.drawArcherAim(board, baseAim({ x: 10, y: 172 }, { x: 40, y: 172 }), 0)
    ).not.toThrow();
  });
});

