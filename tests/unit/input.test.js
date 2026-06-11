import { describe, it, expect } from "vitest";
import { classifySwipe } from "../../src/input.js";

describe("input / classifySwipe", () => {
  it("returns null when movement is below the threshold", () => {
    expect(classifySwipe(5, 5)).toBeNull();
    expect(classifySwipe(0, 0)).toBeNull();
    expect(classifySwipe(30, 0, { minDist: 40 })).toBeNull();
  });

  it("classifies dominant horizontal movement as left/right", () => {
    expect(classifySwipe(80, 10)).toBe("right");
    expect(classifySwipe(-80, 10)).toBe("left");
  });

  it("classifies dominant vertical movement as up/down", () => {
    expect(classifySwipe(10, 80)).toBe("down");
    expect(classifySwipe(10, -80)).toBe("up");
  });

  it("respects a custom minimum distance", () => {
    expect(classifySwipe(50, 0, { minDist: 100 })).toBeNull();
    expect(classifySwipe(120, 0, { minDist: 100 })).toBe("right");
  });

  it("ties (equal magnitude) resolve to horizontal", () => {
    expect(classifySwipe(60, 60)).toBe("right");
    expect(classifySwipe(-60, -60)).toBe("left");
  });
});
