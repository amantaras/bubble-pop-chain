// Monetization abstraction layer.
//
// This is a MOCK provider for development. All ad/purchase calls resolve
// locally so the game economy and ad placements can be designed and tested
// now. To go live, replace the bodies of `showRewardedAd`, `showInterstitial`
// and `purchase` with a real provider (web ad SDK, or AdMob/native IAP when
// wrapped with Capacitor) — the rest of the game code stays unchanged.
import { Storage } from "./storage.js";

class MonetizationManager {
  constructor() {
    this.overlay = null;
    this.sub = null;
    this.levelWinCount = 0;
    this.interstitialEvery = 3; // show after every N level wins
    this.minSeconds = 25; // and at most this often
    this.adsStartLevel = 7; // no forced interstitials before this campaign level
    this._lastInterstitial = 0;
  }

  init() {
    this.overlay = document.getElementById("ad-overlay");
    this.sub = document.getElementById("ad-sub");
  }

  isAdsRemoved() {
    return !!Storage.get("adsRemoved");
  }

  _showAdOverlay(message, seconds) {
    return new Promise((resolve) => {
      if (!this.overlay) return resolve(true);
      if (this.sub) this.sub.textContent = message;
      this.overlay.classList.remove("hidden");
      setTimeout(() => {
        this.overlay.classList.add("hidden");
        resolve(true);
      }, seconds * 1000);
    });
  }

  // Opt-in rewarded ad. Resolves true if the reward should be granted.
  async showRewardedAd(rewardLabel = "your reward") {
    await this._showAdOverlay(`Loading ${rewardLabel}…`, 2.2);
    return true; // mock: always grant
  }

  // Forced full-screen ad between levels. Respects cadence + ads-removed.
  // New players are protected: forced interstitials never show before
  // `adsStartLevel` (pass the just-finished campaign level id as `level`).
  async maybeShowInterstitial(level = Infinity) {
    if (this.isAdsRemoved()) return false;
    if (typeof level === "number" && level < this.adsStartLevel) return false;
    this.levelWinCount++;
    const now = Date.now() / 1000;
    if (
      this.levelWinCount % this.interstitialEvery === 0 &&
      now - this._lastInterstitial > this.minSeconds
    ) {
      this._lastInterstitial = now;
      await this._showAdOverlay("Advertisement", 2.5);
      return true;
    }
    return false;
  }

  // One-time purchases. Mock: succeeds immediately.
  async purchase(productId) {
    if (productId === "remove_ads") {
      Storage.set("adsRemoved", true);
      return { ok: true };
    }
    // Premium pet companions (productId "pet_<id>") and the premium Legendary
    // Crate ("crate_legendary"). Granting the item itself is the caller's job;
    // here we just confirm the (mock) purchase succeeded.
    if (
      typeof productId === "string" &&
      (productId.startsWith("pet_") || productId.startsWith("crate_"))
    ) {
      return { ok: true };
    }
    return { ok: false };
  }
}

export const Monetization = new MonetizationManager();
