import { describe, it, expect } from "vitest";
import {
  PIGGY_CAP,
  PIGGY_MIN_CRACK,
  PIGGY_RATE,
  piggyEarn,
  piggyDeposit,
  canCrackPiggy,
  piggyFillPct,
} from "../../src/piggy.js";

describe("piggy bank", () => {
  it("earns one coin per PIGGY_RATE points of score (floored)", () => {
    expect(piggyEarn(0)).toBe(0);
    expect(piggyEarn(PIGGY_RATE - 1)).toBe(0);
    expect(piggyEarn(PIGGY_RATE)).toBe(1);
    expect(piggyEarn(PIGGY_RATE * 10 + 5)).toBe(10);
  });

  it("treats invalid or negative scores as zero earnings", () => {
    expect(piggyEarn(-500)).toBe(0);
    expect(piggyEarn(undefined)).toBe(0);
    expect(piggyEarn(null)).toBe(0);
  });

  it("deposits earnings and reports how much was added", () => {
    const res = piggyDeposit(100, PIGGY_RATE * 5);
    expect(res.added).toBe(5);
    expect(res.balance).toBe(105);
  });

  it("never lets the balance exceed the cap", () => {
    const res = piggyDeposit(PIGGY_CAP - 2, PIGGY_RATE * 100);
    expect(res.balance).toBe(PIGGY_CAP);
    expect(res.added).toBe(2);
  });

  it("adds nothing once the piggy is full", () => {
    const res = piggyDeposit(PIGGY_CAP, PIGGY_RATE * 50);
    expect(res.balance).toBe(PIGGY_CAP);
    expect(res.added).toBe(0);
  });

  it("clamps a corrupt over-cap balance back to the cap", () => {
    const res = piggyDeposit(PIGGY_CAP + 999, PIGGY_RATE);
    expect(res.balance).toBe(PIGGY_CAP);
    expect(res.added).toBe(0);
  });

  it("only allows cracking once the minimum is banked", () => {
    expect(canCrackPiggy(PIGGY_MIN_CRACK - 1)).toBe(false);
    expect(canCrackPiggy(PIGGY_MIN_CRACK)).toBe(true);
    expect(canCrackPiggy(PIGGY_MIN_CRACK + 500)).toBe(true);
    expect(canCrackPiggy(0)).toBe(false);
  });

  it("reports a clamped fill fraction for the progress bar", () => {
    expect(piggyFillPct(0)).toBe(0);
    expect(piggyFillPct(PIGGY_CAP / 2)).toBeCloseTo(0.5, 5);
    expect(piggyFillPct(PIGGY_CAP)).toBe(1);
    expect(piggyFillPct(PIGGY_CAP * 2)).toBe(1);
    expect(piggyFillPct(-10)).toBe(0);
  });
});
