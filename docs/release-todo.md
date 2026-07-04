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
- [ ] Android phone screenshots. Raw capture script ready: `npm run screenshots:store -- --device=phone`.
- [ ] Android tablet screenshots if tablet support is listed. Raw capture script ready: `npm run screenshots:store -- --device=tablet`.
- [ ] iPhone screenshots. Raw phone captures are available; final App Store framing still needs export decisions.
- [ ] iPad screenshots if iPad support is listed. Raw tablet captures are available; final App Store framing still needs export decisions.
- [ ] Short description. Drafted in `docs/store-listing.md`; final wording pending approval.
- [ ] Long description. Drafted in `docs/store-listing.md`; final wording pending approval.
- [ ] App Store subtitle. Drafted in `docs/store-listing.md`; final wording pending approval.
- [ ] App Store keywords. Drafted in `docs/store-listing.md`; final wording pending approval.
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

- [x] Script repeatable screenshot capture for key screens: first run, campaign board, Pets, Shop, Skybolt, Achievements, and Settings.
- [ ] Export screenshot artifacts for required phone/tablet sizes.
- [ ] Add a repo doc with final listing copy and disclosure answers. Draft doc exists at `docs/store-listing.md`; keep open until copy/disclosures are approved against the submitted build.

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
- [x] Archer: verify drag direction, projected ray, and power gauge are readable on small screens. Fixed a real bug: the power gauge is now clamped to the visible canvas and kept clear of the board's top edge/HUD (was previously able to render off-screen or hidden behind the HUD when pulling near an edge/top row). Drag direction and projected ray were already correct on inspection. Remaining: confirm feel on an actual device.
- [ ] Magnet: verify dial sweet spot, color-bubble shake, and lock timing on touch devices.
- [x] Reward ceremony: tune chest/choice/tool-unlock pacing so stacked rewards do not feel slow. Fixed a real bug: the automatic ceremony advance (which hides the win screen behind `#tool-unlock` when there are no bonus choices to claim) fired at 420ms, well before the 180ms-delayed + 900ms coin count-up animation actually finished, cutting the reveal off mid-count. Now waits for the count-up to actually finish (1100ms) before advancing.
- [x] Pause/shop/settings overlays: verify they do not obscure safe areas on Android/iOS. Fixed a real gap: `.modal` (Pause, win/lose, tool-unlock, pet-confirm, etc.) now reserves safe-area-aware padding and `.modal-card` scrolls internally instead of clipping when content is taller than the available space. `.screen` (Shop/Settings/etc.) already handled this correctly.

Validation:

- [x] Add or update unit tests for pure timing/selection helpers when applicable. (Archer gauge clamp: 4 new unit tests in `tests/unit/renderer.test.js`.)
- [x] Add or update E2E tests for any changed user-facing flow. (New safe-area modal e2e test in `tests/e2e/game.spec.js`.)
- [x] Run `CI=1 npm test` locally before commit.
- [x] Push and verify CI plus production deploy. (Commit `aa42d41`: CI and production deploy both green, live site verified.)

Done when:

- [ ] Real-device feel issues from Phase 4 are either fixed or tracked as explicit follow-ups.

## Phase 6 - Diagnostics And Crash Visibility

Goal: make beta/production issues diagnosable without compromising privacy.

Options:

- [x] Lightweight in-game diagnostics screen under `?e2e=1` or a dev-only gesture. Implemented as a real, always-reachable Themes screen entry (`#btn-diagnostics`), not gated behind `?e2e=1`, so real testers can reach it without DevTools.
- [x] Exportable local save/debug bundle for support. `Copy debug info` copies a full text+JSON report; `Share` uses the Web Share API when available.
- [ ] Privacy-conscious crash/error telemetry if a provider is selected. Deferred — no remote telemetry provider is wired; errors are captured only in a local, session-only, in-memory buffer.

Engineering tasks:

- [x] Define what diagnostic data is safe to collect or export. Only aggregate/non-identifying fields: save-derived profile summary, generic device/browser facts, and recent runtime errors (see `diagnostics.js` header comment).
- [x] Add an explicit user action before exporting any local save/debug data. Nothing is assembled until the screen opens, and nothing leaves the device/clipboard until Copy or Share is tapped.
- [ ] Update privacy policy and store disclosure text if telemetry is added. Not needed yet — no data leaves the device automatically; revisit if a remote telemetry provider is ever added.
- [x] Add tests for diagnostics visibility, export shape, and privacy guardrails. 13 unit tests (`tests/unit/diagnostics.test.js`) + 4 e2e tests (`tests/e2e/game.spec.js`), including a real uncaught-error capture test and a clipboard-contents test.

Done when:

- [x] A tester can provide actionable state/error information without manual DevTools work.
- [x] Privacy disclosures match the implemented behavior. (No disclosure change needed — nothing is collected/transmitted automatically.)

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