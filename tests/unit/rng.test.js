import { describe, it, expect } from "vitest";
import { makeRng, hashSeed, todayKey, randInt } from "../../src/rng.js";

describe("rng", () => {
  it("makeRng is deterministic for the same seed", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("makeRng produces values in [0,1)", () => {
    const r = makeRng(777);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds diverge", () => {
    const a = makeRng(1)();
    const b = makeRng(2)();
    expect(a).not.toEqual(b);
  });

  it("hashSeed is stable and returns an unsigned 32-bit int", () => {
    const h1 = hashSeed("daily-2026-06-11");
    const h2 = hashSeed("daily-2026-06-11");
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThanOrEqual(0xffffffff);
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("todayKey formats as YYYY-MM-DD", () => {
    const key = todayKey(new Date(2026, 5, 9)); // June 9, 2026
    expect(key).toBe("2026-06-09");
  });

  it("randInt stays within bounds", () => {
    const r = makeRng(42);
    for (let i = 0; i < 500; i++) {
      const v = randInt(r, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});
