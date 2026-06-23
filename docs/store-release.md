# Bubblit! Store Release Guide

This repo can build the web/PWA, Android, and iOS targets from the same static app. The remaining store work is mostly signing, store-account setup, compliance metadata, and replacing mock commerce surfaces with real providers.

## Current Release Surface

- Web production: GitHub Pages via `.github/workflows/deploy.yml` after CI passes.
- Android direct download: every successful production deploy publishes the latest signed release APK at `https://amantaras.github.io/bubble-pop-chain/downloads/bubblit.apk` with a matching SHA-256 file at `https://amantaras.github.io/bubble-pop-chain/downloads/bubblit.apk.sha256`.
- Android validation: signed release APK in `.github/workflows/deploy.yml`; debug APK in `.github/workflows/mobile.yml`.
- iOS validation: unsigned build in `.github/workflows/deploy.yml` and `.github/workflows/mobile.yml`.
- Store release: manual `.github/workflows/store-release.yml` builds signed Android AAB and signed iOS IPA when secrets are configured.

## Local Prerequisites

- Node 24 and npm.
- Android: JDK 21, Android SDK platform 35, Android build tools 35.0.0.
- iOS: full Xcode selected with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, CocoaPods, and an Apple Developer team.

On macOS with Homebrew, the Android prerequisites can be installed with:

```bash
brew install openjdk@21
brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
yes | sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
```

`android/local.properties` is intentionally ignored by git; it is the local SDK pointer for this machine.

Useful checks:

```bash
java -version
xcodebuild -version
xcode-select -p
npm run build:web
npm run android:build
npm run android:apk:release
npm run android:bundle
npm run ios:build
```

If `npm run ios:build` reports that `xcodebuild` requires Xcode and `xcode-select -p` points at `/Library/Developer/CommandLineTools`, install full Xcode from Apple/App Store and select it. Command Line Tools alone are not enough for CocoaPods or iOS archives.

## Android Signing

Create or use a Play App Signing upload key. Keep the keystore out of git.

Local release build:

```bash
export ANDROID_KEYSTORE_PATH=/path/to/release.jks
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
npm run android:bundle:release
npm run android:apk:release
```

GitHub Secrets for the manual Store release workflow:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded keystore file.
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`
- Optional `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: service account JSON for Play internal testing upload.

The workflow uploads `android/app/build/outputs/bundle/release/app-release.aab` as `bubblit-android-release-aab`. If `submit_to_play` is selected and the service-account secret is present, it sends the AAB to the Play internal track as a draft.

## iOS Signing

Create the bundle ID `com.amantaras.bubblepopchain` in Apple Developer and an App Store Connect app record for Bubblit!.

GitHub Secrets for the manual Store release workflow:

- `APPLE_TEAM_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY`: contents of the App Store Connect API `.p8` key.
- `IOS_DISTRIBUTION_CERT_BASE64`: base64-encoded Apple Distribution `.p12` certificate.
- `IOS_DISTRIBUTION_CERT_PASSWORD`
- `IOS_BUILD_KEYCHAIN_PASSWORD`: throwaway CI keychain password.

The workflow archives `ios/App/build/Bubblit.xcarchive`, exports an IPA into `ios/App/build/export`, uploads it as `bubblit-ios-release-ipa`, and can upload it to TestFlight when `upload_testflight` is selected.

## Store Listing Assets

Prepare final assets before first submission:

- App icon at every Android/iOS required size; avoid transparency for iOS.
- Splash/launch images with the Bubblit! name if using branded splash screens.
- Google Play feature graphic.
- Phone and tablet screenshots for both stores.
- Short description, long description, keywords/subtitle, support URL, privacy-policy URL.
- Age rating answers and ads/IAP disclosures.

Public URLs shipped with the web artifact:

- Privacy policy: `https://amantaras.github.io/bubble-pop-chain/privacy.html`
- Support URL: `https://amantaras.github.io/bubble-pop-chain/support.html`

## Compliance And Review

Before submitting:

- Publish a privacy policy URL that covers local storage, ads, purchases, analytics/telemetry if added, and support contact.
- Complete Google Play Data Safety and Apple App Privacy labels from the real SDK behavior, not assumptions.
- Decide the child-directed/COPPA posture before enabling ad personalization.
- Verify all third-party assets have attribution where required.
- Keep purchase prices and product IDs aligned between code, Play Console, and App Store Connect.

## Monetization Provider Work

`src/monetization.js` is intentionally pluggable. Web/dev still uses the mock fallback for testing, but native Capacitor builds fail closed without a real provider: purchases fail, forced interstitials do not show fake ads, and paid shop buttons are disabled unless a purchase provider is available. Rewarded ads can use the explicit development fallback while native ad SDK work is in progress; call `Monetization.setDevelopmentRewardedFallback(false)` before submitting a store build that must require real rewarded ads. Before store review, either:

- inject real providers for rewarded ads, interstitials, and purchases on Android/iOS, or
- hide/disable the paid/rewarded surfaces until those SDKs are ready.

Expected native integrations:

- Android: Google Play Billing for IAP, an ads SDK such as Google Mobile Ads for rewarded/interstitial ads.
- iOS: StoreKit for IAP, the matching iOS ads SDK.

## Release Flow

1. Merge to `master`; CI must pass.
2. Confirm `.github/workflows/deploy.yml` builds web + native validation artifacts.
3. Run the manual `Store release` workflow.
4. Download and smoke-test the AAB/IPA on real devices or internal testing tracks.
5. Submit store builds only after compliance metadata, screenshots, and monetization behavior are final.
