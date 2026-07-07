import { describe, it, expect } from "vitest";
import { makeRng } from "../../src/rng.js";
import {
  WHEEL_REWARDS,
  WHEEL_WEIGHT_TOTAL,
  wheelStatus,
  spinWheel,
  advanceWheel,
} from "../../src/wheel.js";

describe("wheel rewards table", () => {
  it("has at least a handful of distinct segments", () => {
    expect(WHEEL_REWARDS.length).toBeGreaterThanOrEqual(6);
  });

  it("every segment has a positive weight and grants something", () => {
    WHEEL_REWARDS.forEach((r) => {
      expect(r.weight).toBeGreaterThan(0);
      expect(r.coins || r.powerup || r.crate || r.dust).toBeTruthy();
      expect(r.label).toBeTruthy();
      expect(r.icon).toBeTruthy();
    });
  });

  it("WHEEL_WEIGHT_TOTAL is the sum of every segment's weight", () => {
    const sum = WHEEL_REWARDS.reduce((s, r) => s + r.weight, 0);
    expect(WHEEL_WEIGHT_TOTAL).toBe(sum);
  });

  it("has a rare jackpot segment with a much smaller weight than the common ones", () => {
    const jackpot = WHEEL_REWARDS.find((r) => r.id === "jackpot");
    expect(jackpot).toBeTruthy();
    const commonMax = Math.max(
      ...WHEEL_REWARDS.filter((r) => r.id !== "jackpot").map((r) => r.weight)
    );
    expect(jackpot.weight).toBeLessThan(commonMax);
  });
});

describe("wheelStatus", () => {
  it("a fresh save is claimable", () => {
    const st = wheelStatus({ lastSpin: null }, "2024-01-01");
    expect(st.claimable).toBe(true);
    expect(st.lastSpin).toBe(null);
  });

  it("is not claimable again the same day", () => {
    const st = wheelStatus({ lastSpin: "2024-01-01" }, "2024-01-01");
    expect(st.claimable).toBe(false);
  });

  it("becomes claimable again the next day", () => {
    const st = wheelStatus({ lastSpin: "2024-01-01" }, "2024-01-02");
    expect(st.claimable).toBe(true);
  });

  it("handles a missing/undefined state", () => {
    const st = wheelStatus(undefined, "2024-01-01");
    expect(st.claimable).toBe(true);
    expect(st.lastSpin).toBe(null);
  });
});

describe("spinWheel", () => {
  it("is pure and seedable: the same rng sequence always resolves the same segment", () => {
    const a = spinWheel(makeRng(42));
    const b = spinWheel(makeRng(42));
    expect(a).toEqual(b);
  });

  it("rng() === 0 always resolves the very first segment", () => {
    const { reward, index } = spinWheel(() => 0);
    expect(index).toBe(0);
    expect(reward).toBe(WHEEL_REWARDS[0]);
  });

  it("rng() just under 1 resolves the very last segment", () => {
    const { reward, index } = spinWheel(() => 0.999999);
    expect(index).toBe(WHEEL_REWARDS.length - 1);
    expect(reward).toBe(WHEEL_REWARDS[WHEEL_REWARDS.length - 1]);
  });

  it("every returned index is a valid segment index", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const { index } = spinWheel(rng);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(WHEEL_REWARDS.length);
    }
  });

  it("over many spins, every segment can be reached (odds roughly track weight)", () => {
    const rng = makeRng(1234);
    const hits = new Array(WHEEL_REWARDS.length).fill(0);
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const { index } = spinWheel(rng);
      hits[index]++;
    }
    WHEEL_REWARDS.forEach((r, i) => {
      // Every segment (even the rare jackpot) should land at least a few
      // times across 20k spins, and never wildly more than its weight share.
      const expected = (r.weight / WHEEL_WEIGHT_TOTAL) * n;
      expect(hits[i]).toBeGreaterThan(0);
      expect(hits[i]).toBeLessThan(expected * 2.5);
    });
  });
});

describe("advanceWheel", () => {
  it("stamps the spin day key", () => {
    expect(advanceWheel("2024-01-01")).toEqual({ lastSpin: "2024-01-01" });
  });

  it("after spinning, status reports not claimable that day", () => {
    const state = advanceWheel("2024-01-01");
    const st = wheelStatus(state, "2024-01-01");
    expect(st.claimable).toBe(false);
  });

  it("supports a multi-day walk-through", () => {
    let state = { lastSpin: null };
    for (let i = 1; i <= 5; i++) {
      const key = `2024-01-0${i}`;
      const st = wheelStatus(state, key);
      expect(st.claimable).toBe(true);
      state = advanceWheel(key);
      expect(wheelStatus(state, key).claimable).toBe(false);
    }
  });
});
