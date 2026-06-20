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
    Monetization.clearProvider();
    delete globalThis.Capacitor;
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

describe("monetization provider seam (real ad/IAP SDK injection)", () => {
  beforeEach(() => {
    localStorage.clear();
    Storage.reset();
    Monetization.levelWinCount = 0;
    Monetization._lastInterstitial = 0;
    Monetization.clearProvider();
    delete globalThis.Capacitor;
  });

  it("setProvider/clearProvider toggle the active provider", () => {
    expect(Monetization.provider).toBe(null);
    const p = { purchase: () => ({ ok: true }) };
    Monetization.setProvider(p);
    expect(Monetization.provider).toBe(p);
    Monetization.clearProvider();
    expect(Monetization.provider).toBe(null);
    // setProvider(null) is equivalent to clearing.
    Monetization.setProvider(p);
    Monetization.setProvider(null);
    expect(Monetization.provider).toBe(null);
  });

  it("rewarded ads delegate to the provider's result", async () => {
    Monetization.setProvider({ showRewardedAd: async () => false });
    await expect(Monetization.showRewardedAd("coins")).resolves.toBe(false);
    Monetization.setProvider({ showRewardedAd: async () => true });
    await expect(Monetization.showRewardedAd("coins")).resolves.toBe(true);
  });

  it("rewarded ad passes the reward label to the provider", async () => {
    let seen = null;
    Monetization.setProvider({
      showRewardedAd: async (label) => {
        seen = label;
        return true;
      },
    });
    await Monetization.showRewardedAd("100 coins");
    expect(seen).toBe("100 coins");
  });

  it("interstitial delegates the ad surface to the provider but keeps cadence policy", async () => {
    let shown = 0;
    Monetization.setProvider({ showInterstitial: async () => shown++ });
    // Cadence policy still lives in the manager: 2 skipped, 3rd shows.
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(true);
    expect(shown).toBe(1); // provider surface invoked exactly once
  });

  it("provider interstitial still respects the new-player grace and ads-removed gate", async () => {
    let shown = 0;
    Monetization.setProvider({ showInterstitial: async () => shown++ });
    // Before adsStartLevel: never shows, counter never advances.
    for (let i = 0; i < 6; i++) {
      expect(await Monetization.maybeShowInterstitial(2)).toBe(false);
    }
    expect(shown).toBe(0);
    expect(Monetization.levelWinCount).toBe(0);
    // Ads removed: suppressed even with a provider installed.
    Storage.set("adsRemoved", true);
    for (let i = 0; i < 6; i++) {
      expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    }
    expect(shown).toBe(0);
  });

  it("purchase delegates the transaction to the provider", async () => {
    let seen = null;
    Monetization.setProvider({
      purchase: async (id) => {
        seen = id;
        return { ok: true, receipt: "abc" };
      },
    });
    const res = await Monetization.purchase("starter_pack");
    expect(seen).toBe("starter_pack");
    expect(res.ok).toBe(true);
    expect(res.receipt).toBe("abc");
  });

  it("a failed provider purchase does not record the ads-removed flag", async () => {
    Monetization.setProvider({ purchase: async () => ({ ok: false }) });
    const res = await Monetization.purchase("remove_ads");
    expect(res.ok).toBe(false);
    expect(Monetization.isAdsRemoved()).toBe(false);
  });

  it("the ads-removed side-effect is owned by the manager across any provider", async () => {
    // Provider succeeds but does NOT touch storage; manager must persist it.
    Monetization.setProvider({ purchase: async () => ({ ok: true }) });
    expect(Monetization.isAdsRemoved()).toBe(false);
    const res = await Monetization.purchase("remove_ads");
    expect(res.ok).toBe(true);
    expect(Monetization.isAdsRemoved()).toBe(true);
  });

  it("falls back to the mock for any method the provider omits", async () => {
    // Provider only does purchases; rewarded ads fall back to the mock (true).
    Monetization.setProvider({ purchase: async () => ({ ok: true }) });
    await expect(Monetization.showRewardedAd("x")).resolves.toBe(true);
    // And the mock purchase logic is bypassed entirely when provider handles it:
    // an unknown product the mock would reject is accepted by the provider.
    const res = await Monetization.purchase("totally_unknown");
    expect(res.ok).toBe(true);
  });

  it("with no provider, mock purchase rules still apply", async () => {
    expect((await Monetization.purchase("season_premium")).ok).toBe(true);
    expect((await Monetization.purchase("pet_aurora")).ok).toBe(true);
    expect((await Monetization.purchase("crate_legendary")).ok).toBe(true);
    expect((await Monetization.purchase("nope")).ok).toBe(false);
  });

  it("native builds do not fall back to mock ads or purchases", async () => {
    globalThis.Capacitor = { isNativePlatform: () => true };
    await expect(Monetization.showRewardedAd("coins")).resolves.toBe(false);

    const purchase = await Monetization.purchase("starter_pack");
    expect(purchase.ok).toBe(false);
    expect(purchase.nativeProviderRequired).toBe(true);

    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(Monetization._lastInterstitial).toBe(0);
  });

  it("native builds still use an injected real provider", async () => {
    globalThis.Capacitor = { getPlatform: () => "ios" };
    let interstitials = 0;
    Monetization.setProvider({
      showRewardedAd: async () => true,
      showInterstitial: async () => interstitials++,
      purchase: async () => ({ ok: true, receipt: "native" }),
    });

    await expect(Monetization.showRewardedAd("coins")).resolves.toBe(true);
    expect((await Monetization.purchase("starter_pack")).receipt).toBe("native");
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(false);
    expect(await Monetization.maybeShowInterstitial(9)).toBe(true);
    expect(interstitials).toBe(1);
  });
});

