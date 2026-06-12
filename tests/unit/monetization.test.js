import { describe, it, expect, beforeEach } from "vitest";
import { Storage } from "../../src/storage.js";
import { Monetization } from "../../src/monetization.js";

describe("monetization (real code paths, mock provider)", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
    // Reset in-memory cadence counters between tests.
    Monetization.levelWinCount = 0;
    Monetization._lastInterstitial = 0;
  });

  it("rewarded ad resolves true (reward granted)", async () => {
    await expect(Monetization.showRewardedAd("coins")).resolves.toBe(true);
  });

  it("isAdsRemoved reflects storage", () => {
    expect(Monetization.isAdsRemoved()).toBe(false);
    Storage.set("adsRemoved", true);
    expect(Monetization.isAdsRemoved()).toBe(true);
  });

  it("purchase(remove_ads) sets the ads-removed flag", async () => {
    const res = await Monetization.purchase("remove_ads");
    expect(res.ok).toBe(true);
    expect(Monetization.isAdsRemoved()).toBe(true);
  });

  it("unknown products fail to purchase", async () => {
    const res = await Monetization.purchase("unknown");
    expect(res.ok).toBe(false);
  });

  it("purchase(starter_pack) is accepted by the provider", async () => {
    const res = await Monetization.purchase("starter_pack");
    expect(res.ok).toBe(true);
  });

  it("interstitial shows on the configured cadence and respects min interval", async () => {
    expect(await Monetization.maybeShowInterstitial()).toBe(false); // 1
    expect(await Monetization.maybeShowInterstitial()).toBe(false); // 2
    expect(await Monetization.maybeShowInterstitial()).toBe(true); // 3 -> show
    expect(await Monetization.maybeShowInterstitial()).toBe(false); // 4
    expect(await Monetization.maybeShowInterstitial()).toBe(false); // 5
    // 6th hits the cadence but is throttled by the min-seconds interval
    expect(await Monetization.maybeShowInterstitial()).toBe(false);
  });

  it("interstitials are suppressed entirely once ads are removed", async () => {
    Storage.set("adsRemoved", true);
    for (let i = 0; i < 5; i++) {
      expect(await Monetization.maybeShowInterstitial()).toBe(false);
    }
  });

  it("never shows forced interstitials before adsStartLevel (new-player grace)", async () => {
    // Levels 1..6 should never trigger an interstitial, regardless of cadence.
    for (let i = 0; i < 10; i++) {
      expect(await Monetization.maybeShowInterstitial(3)).toBe(false);
    }
    // The win counter must not advance while gated, so cadence is preserved.
    expect(Monetization.levelWinCount).toBe(0);
  });

  it("allows interstitials from adsStartLevel onward, on cadence", async () => {
    expect(await Monetization.maybeShowInterstitial(7)).toBe(false); // 1
    expect(await Monetization.maybeShowInterstitial(7)).toBe(false); // 2
    expect(await Monetization.maybeShowInterstitial(7)).toBe(true); // 3 -> show
  });
});
