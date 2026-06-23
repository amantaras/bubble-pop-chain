# Bubblit! Release TODO Plan

This is the implementation plan for the remaining production and store-readiness work after the `4db522f` Skybolt production deploy.

## Current Baseline

- Web production deploy is green on GitHub Pages.
- CI is green on `master`.
- Production deploy builds Android signed APK, iOS unsigned validation build, and Pages successfully.
- Android Store release AAB build is green when run Android-only.
- iOS Store release IPA is blocked by missing Apple/App Store Connect signing secrets.
- Live smoke verified the deployed app, APK URL, checksum URL, privacy URL, support URL, and Skybolt bomber behavior.

## Phase 1 - iOS Store Pipeline

Goal: produce a signed iOS IPA and optionally upload it to TestFlight.

Blocked on account/secrets setup:

- [ ] Create or verify Apple Developer bundle ID `com.amantaras.bubblepopchain`.
- [ ] Create or verify the App Store Connect app record for Bubblit!.
- [ ] Create an App Store Connect API key with app management/upload permissions.
- [ ] Create/export an Apple Distribution `.p12` certificate.
- [ ] Add GitHub secrets:
  - [ ] `APPLE_TEAM_ID`
  - [ ] `APP_STORE_CONNECT_KEY_ID`
  - [ ] `APP_STORE_CONNECT_ISSUER_ID`
  - [ ] `APP_STORE_CONNECT_PRIVATE_KEY`
  - [ ] `IOS_DISTRIBUTION_CERT_BASE64`
  - [ ] `IOS_DISTRIBUTION_CERT_PASSWORD`
  - [ ] `IOS_BUILD_KEYCHAIN_PASSWORD`

Hands-off validation after secrets exist:

- [ ] Run `Store release` with `build_ios=true` and `upload_testflight=false`.
- [ ] Download and hash the `bubblit-ios-release-ipa` artifact.
- [ ] Run `Store release` with `upload_testflight=true` only after the dry-run artifact is verified.
- [ ] Confirm TestFlight processing in App Store Connect.

Done when:

- [ ] Store release run completes green with signed IPA artifact.
- [ ] Optional TestFlight upload completes and appears in App Store Connect.

## Phase 2 - Real Monetization Providers

Goal: replace mock/dev commerce surfaces with store-ready native providers or explicitly hide those surfaces before review.

Implementation options:

- [ ] Android: integrate Google Play Billing for IAP products.
- [ ] Android: integrate Google Mobile Ads or selected ads SDK for rewarded/interstitial ads.
- [ ] iOS: integrate StoreKit for IAP products.
- [ ] iOS: integrate the selected iOS ads SDK for rewarded/interstitial ads.
- [ ] If real providers are not ready, disable or hide paid/rewarded surfaces in native store builds.

Engineering tasks:

- [ ] Add a Capacitor/native monetization provider bridge without changing the web mock path.
- [ ] Keep `Monetization` as the policy owner for cadence, ads-removed state, purchase entitlement recording, and fail-closed behavior.
- [ ] Add unit tests for provider success, provider failure, missing provider, and restore/owned flows.
- [ ] Add E2E coverage for native-disabled commerce UI behavior using the existing web-safe hooks where possible.
- [ ] Update `privacy.html`, `support.html`, and `docs/store-release.md` if SDK behavior changes data collection or support flows.

Done when:

- [ ] Purchases and ads work with real providers in native builds, or store builds clearly disable those surfaces.
- [ ] Privacy/store disclosures match the real SDK behavior.
- [ ] CI and production deploy are green.

## Phase 3 - Store Listing Pack

Goal: prepare review-ready store metadata and assets.

Assets and copy:

- [ ] Google Play feature graphic.
- [ ] Android phone screenshots.
- [ ] Android tablet screenshots if tablet support is listed.
- [ ] iPhone screenshots.
- [ ] iPad screenshots if iPad support is listed.
- [ ] Short description.
- [ ] Long description.
- [ ] App Store subtitle.
- [ ] App Store keywords.
- [ ] Support URL: `https://amantaras.github.io/bubble-pop-chain/support.html`.
- [ ] Privacy URL: `https://amantaras.github.io/bubble-pop-chain/privacy.html`.

Compliance forms:

- [ ] Google Play Data Safety form.
- [ ] Apple App Privacy labels.
- [ ] Google Play content rating questionnaire.
- [ ] Apple age rating questionnaire.
- [ ] Ads disclosure.
- [ ] IAP disclosure.
- [ ] Child-directed/COPPA posture decision.

Hands-off capture tasks after metadata direction is chosen:

- [ ] Script repeatable screenshot capture for key screens: first run, campaign board, Pets, Shop, Skybolt, Achievements, and Settings.
- [ ] Export screenshot artifacts for required phone/tablet sizes.
- [ ] Add a repo doc with final listing copy and disclosure answers.

Done when:

- [ ] Store listing copy and screenshots are ready to paste/upload.
- [ ] Compliance answers match the current build behavior.

## Phase 4 - Device Smoke Matrix

Goal: verify the production build on real devices and install modes.

Targets:

- [ ] Android APK direct install from `https://amantaras.github.io/bubble-pop-chain/downloads/bubblit.apk`.
- [ ] Android AAB/internal testing install from Google Play once uploaded.
- [ ] iPhone TestFlight install once iOS signing is ready.
- [ ] Android Chrome PWA install.
- [ ] iOS Safari PWA install.

Smoke checklist per target:

- [ ] First-run splash and tutorial start correctly.
- [ ] Tutorial can be skipped and replayed.
- [ ] Campaign level starts, pops, swipes, pause/resume, and finishes.
- [ ] Shop opens and disabled/available commerce state is correct for the build.
- [ ] Pets opens, equip flow works, and Skybolt animation reads as an aircraft flyby.
- [ ] Audio unlocks after gesture and mute persists.
- [ ] Offline reload works for PWA/native cached assets.
- [ ] Privacy and support links open.

Done when:

- [ ] Smoke notes are captured with device/OS/browser/build version.
- [ ] Any device-specific blockers are fixed or explicitly deferred.

## Phase 5 - Gameplay Polish Pass

Goal: tune feel and readability after real-device testing.

Candidate polish tasks:

- [ ] Skybolt: tune aircraft scale, speed, route height, bomb spacing, and impact timing based on phone feel.
- [ ] Archer: verify drag direction, projected ray, and power gauge are readable on small screens.
- [ ] Magnet: verify dial sweet spot, color-bubble shake, and lock timing on touch devices.
- [ ] Reward ceremony: tune chest/choice/tool-unlock pacing so stacked rewards do not feel slow.
- [ ] Pause/shop/settings overlays: verify they do not obscure safe areas on Android/iOS.

Validation:

- [ ] Add or update unit tests for pure timing/selection helpers when applicable.
- [ ] Add or update E2E tests for any changed user-facing flow.
- [ ] Run `CI=1 npm test` locally before commit.
- [ ] Push and verify CI plus production deploy.

Done when:

- [ ] Real-device feel issues from Phase 4 are either fixed or tracked as explicit follow-ups.

## Phase 6 - Diagnostics And Crash Visibility

Goal: make beta/production issues diagnosable without compromising privacy.

Options:

- [ ] Lightweight in-game diagnostics screen under `?e2e=1` or a dev-only gesture.
- [ ] Exportable local save/debug bundle for support.
- [ ] Privacy-conscious crash/error telemetry if a provider is selected.

Engineering tasks:

- [ ] Define what diagnostic data is safe to collect or export.
- [ ] Add an explicit user action before exporting any local save/debug data.
- [ ] Update privacy policy and store disclosure text if telemetry is added.
- [ ] Add tests for diagnostics visibility, export shape, and privacy guardrails.

Done when:

- [ ] A tester can provide actionable state/error information without manual DevTools work.
- [ ] Privacy disclosures match the implemented behavior.

## Suggested Execution Order

1. iOS Store pipeline secrets and signed IPA dry run.
2. Android internal testing upload, if Play service account is configured.
3. Store listing screenshots/copy/compliance pack.
4. Real-device smoke matrix.
5. Gameplay polish fixes from the smoke matrix.
6. Monetization providers or native commerce-disable decision.
7. Diagnostics/crash visibility before wider beta.

## Hands-Off Rules For Implementation

- Commit and push each completed implementation slice to `master`.
- Run the narrow relevant checks first, then `CI=1 npm test` before pushing gameplay/code changes.
- Verify GitHub CI after every push.
- Verify production deploy after every `master` change that affects shipped artifacts.
- Do not submit to Play, TestFlight, or App Review automatically unless explicitly requested for that run.
- Do not handle secrets in chat; add them directly in GitHub repository secrets or the relevant store consoles.