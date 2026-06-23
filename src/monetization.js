// Monetization abstraction layer.
//
// This ships with a MOCK provider so the game economy and ad placements can be
// designed and tested now. To go live, you have two options:
//
//   1. Replace the mock bodies below (quick + dirty), OR
//   2. Inject a real provider at startup via `Monetization.setProvider(...)`
//      (preferred — keeps this file untouched and swappable per platform).
//
// A provider is any object that may implement `showRewardedAd(label) -> bool`,
// `showInterstitial() -> any`, and/or `purchase(productId) -> { ok }`. Any
// method it omits falls back to the built-in mock on web/dev only, so a provider
// can override just the surfaces a given platform supports. Until the real ad
// SDK is installed, native builds also allow an explicit development fallback
// for opt-in rewarded ads so gameplay gates like revive remain testable.
// Purchases and forced interstitials still fail closed without a provider.
// The manager always owns *policy* — ad cadence, new-player grace, the
// ads-removed gate, and persisting the remove-ads flag — so swapping providers
// can never change when ads show or how purchases are recorded. The rest of the
// game code stays unchanged.
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
    // Optional real ad/IAP provider; null = use the built-in mock.
    this.provider = null;
    this.developmentRewardedFallback = true;
  }

  init() {
    this.overlay = document.getElementById("ad-overlay");
    this.sub = document.getElementById("ad-sub");
  }

  // Inject a real ad/IAP provider. Pass null (or call clearProvider) to revert
  // to the built-in mock. The provider only needs the methods it can support;
  // any it omits falls through to the mock implementation.
  setProvider(provider) {
    this.provider = provider || null;
  }

  clearProvider() {
    this.provider = null;
  }

  setDevelopmentRewardedFallback(enabled) {
    this.developmentRewardedFallback = !!enabled;
  }

  // True when a provider supplies a usable implementation of `method`.
  _providerCan(method) {
    return !!(this.provider && typeof this.provider[method] === "function");
  }

  _isNativePlatform() {
    const cap = globalThis.Capacitor;
    if (!cap) return false;
    if (typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
    if (typeof cap.getPlatform === "function") return cap.getPlatform() !== "web";
    return false;
  }

  _canUseMock() {
    return !this._isNativePlatform();
  }

  _canUseRewardedFallback() {
    return this._canUseMock() || this.developmentRewardedFallback;
  }

  canShowRewardedAd() {
    return this._providerCan("showRewardedAd") || this._canUseRewardedFallback();
  }

  canPurchase() {
    return this._providerCan("purchase") || this._canUseMock();
  }

  canShowInterstitial() {
    return this._providerCan("showInterstitial") || this._canUseMock();
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
  // Delegates to a real provider when one is installed.
  async showRewardedAd(rewardLabel = "your reward") {
    if (this._providerCan("showRewardedAd")) {
      return !!(await this.provider.showRewardedAd(rewardLabel));
    }
    if (!this.canShowRewardedAd()) return false;
    await this._showAdOverlay(`Loading ${rewardLabel}…`, 2.2);
    return true; // mock: always grant
  }

  // Forced full-screen ad between levels. Respects cadence + ads-removed.
  // New players are protected: forced interstitials never show before
  // `adsStartLevel` (pass the just-finished campaign level id as `level`).
  // The cadence/grace policy lives here; only the actual ad surface is
  // delegated to a real provider when present.
  async maybeShowInterstitial(level = Infinity) {
    if (this.isAdsRemoved()) return false;
    if (typeof level === "number" && level < this.adsStartLevel) return false;
    this.levelWinCount++;
    const now = Date.now() / 1000;
    if (
      this.levelWinCount % this.interstitialEvery === 0 &&
      now - this._lastInterstitial > this.minSeconds
    ) {
      if (this._providerCan("showInterstitial")) {
        this._lastInterstitial = now;
        await this.provider.showInterstitial();
      } else if (this._canUseMock()) {
        this._lastInterstitial = now;
        await this._showAdOverlay("Advertisement", 2.5);
      } else {
        return false;
      }
      return true;
    }
    return false;
  }

  // One-time purchases. Delegates the transaction to a real provider when
  // present; otherwise the mock confirms known products immediately. Either
  // way the manager owns the side-effect of persisting the ads-removed flag,
  // so that contract holds no matter which provider is installed.
  async purchase(productId) {
    let result;
    if (this._providerCan("purchase")) {
      result = await this.provider.purchase(productId);
    } else if (this._canUseMock()) {
      result = this._mockPurchase(productId);
    } else {
      result = { ok: false, nativeProviderRequired: true };
    }
    if (result && result.ok && productId === "remove_ads") {
      Storage.set("adsRemoved", true);
    }
    return result || { ok: false };
  }

  // The built-in mock transaction: succeeds for every known product id.
  // Granting the *contents* of bundles/passes/pets remains the caller's job;
  // here we only confirm the (mock) purchase succeeded.
  _mockPurchase(productId) {
    if (productId === "remove_ads") return { ok: true };
    if (productId === "coins_med") return { ok: true };
    if (productId === "coins_large") return { ok: true };
    if (productId === "starter_pack") return { ok: true };
    if (productId === "season_premium") return { ok: true };
    if (productId === "piggy_crack") return { ok: true };
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

