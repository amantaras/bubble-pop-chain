import { describe, it, expect } from "vitest";
import {
  EVENT_GIFT,
  EVENT_PROBLEM,
  EVENT_MIN_DELAY,
  EVENT_MAX_DELAY,
  GIFT_COIN_MIN,
  GIFT_COIN_MAX,
  GIFT_POWERUP_POOL,
  GIFT_POWERUP_CHANCE,
  GIFT_CRATE_CHANCE,
  nextEventDelay,
  pickEventType,
  rollGiftReward,
} from "../../src/events.js";

describe("events / falling gift & problem logic", () => {
  it("nextEventDelay stays within the configured window", () => {
    expect(nextEventDelay(() => 0)).toBe(EVENT_MIN_DELAY);
    expect(nextEventDelay(() => 1)).toBe(EVENT_MAX_DELAY);
    expect(nextEventDelay(() => 0.5)).toBeCloseTo(
      (EVENT_MIN_DELAY + EVENT_MAX_DELAY) / 2,
    );
  });

  it("pickEventType splits gifts and problems by chance", () => {
    expect(pickEventType(() => 0)).toBe(EVENT_GIFT);
    expect(pickEventType(() => 0.99)).toBe(EVENT_PROBLEM);
  });

  it("rollGiftReward returns coins in range when no power-up rolls", () => {
    const lo = rollGiftReward(seq([0.9, 0]));
    expect(lo).toEqual({ type: "coins", coins: GIFT_COIN_MIN });
    const hi = rollGiftReward(seq([0.9, 1]));
    expect(hi).toEqual({ type: "coins", coins: GIFT_COIN_MAX });
    const mid = rollGiftReward(seq([0.9, 0.5]));
    expect(mid.type).toBe("coins");
    expect(mid.coins).toBeGreaterThanOrEqual(GIFT_COIN_MIN);
    expect(mid.coins).toBeLessThanOrEqual(GIFT_COIN_MAX);
  });

  it("rollGiftReward can grant a power-up from the pool", () => {
    const first = rollGiftReward(seq([0.1, 0]));
    expect(first).toEqual({ type: "powerup", powerup: GIFT_POWERUP_POOL[0] });
    const last = rollGiftReward(seq([0.1, 0.99]));
    expect(last.type).toBe("powerup");
    expect(GIFT_POWERUP_POOL).toContain(last.powerup);
  });

  it("rollGiftReward can grant a rare pet crate", () => {
    expect(GIFT_CRATE_CHANCE).toBeGreaterThan(0);
    const crate = rollGiftReward(seq([0]));
    expect(crate).toEqual({ type: "crate" });
    // Just above the crate slice should not be a crate.
    const notCrate = rollGiftReward(seq([GIFT_CRATE_CHANCE + 0.001, 0]));
    expect(notCrate.type).not.toBe("crate");
  });

  it("hands out a tool on a meaningful share of gifts (not just coins)", () => {
    // Sweep the whole roll space and confirm the empirical power-up share
    // matches GIFT_POWERUP_CHANCE and is a healthy fraction, so players see
    // tools drop "from time to time" rather than almost always getting coins.
    const N = 2000;
    let powerups = 0;
    for (let i = 0; i < N; i++) {
      const r = (i + 0.5) / N;
      if (rollGiftReward(seq([r, 0])).type === "powerup") powerups++;
    }
    const share = powerups / N;
    expect(share).toBeCloseTo(GIFT_POWERUP_CHANCE, 2);
    expect(GIFT_POWERUP_CHANCE).toBeGreaterThanOrEqual(0.35);
  });
});

// Deterministic rand that returns the given values in order.
function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
