import { describe, it, expect } from "vitest";
import {
  EVENT_GIFT,
  EVENT_PROBLEM,
  EVENT_MIN_DELAY,
  EVENT_MAX_DELAY,
  GIFT_COIN_MIN,
  GIFT_COIN_MAX,
  GIFT_POWERUP_POOL,
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
});

// Deterministic rand that returns the given values in order.
function seq(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
