# Bubblit! Store Listing Pack

Draft store metadata and screenshot plan for first Google Play / App Store submission. Keep this aligned with the shipped build and the real monetization provider posture before review.

## Screenshot Capture

Use the scripted capture flow to generate repeatable screenshots from the real app:

```bash
npm run screenshots:store
```

Output goes to `artifacts/store-screenshots/` and is intentionally ignored by git. Useful variants:

```bash
npm run screenshots:store -- --device=phone
npm run screenshots:store -- --device=tablet --screens=campaign-board,pets,shop
npm run screenshots:store -- --base-url=http://127.0.0.1:4173
```

Default captures:

- `first-run`: Bubblit! startup splash.
- `campaign-board`: live campaign board with HUD, tools, charge, Fever, and pet badge.
- `pets`: companion manager focused on Skybolt.
- `shop`: featured shop / power-up economy surface.
- `skybolt`: campaign board with the aircraft companion equipped.
- `achievements`: lifetime achievement chest progression.
- `settings`: themes and accessibility settings.

Use these as raw source images. Crop/export to the exact store-required dimensions after choosing the final listing layout.

## App Metadata Draft

App name: `Bubblit!`

Short description:

```text
Pop bubble chains, trigger combos, and grow clever companions in a fast puzzle adventure.
```

Google Play long description:

```text
Bubblit! is a bright chain-pop puzzle game built for quick mobile sessions. Tap connected bubbles, plan bigger clears, trigger charged blasts, and chase high scores across campaign levels, daily challenges, time attack, tournaments, and hand-built puzzles.

Every board gives you tactical choices. Swipe rows to set up matches, use tools like Bomb, Paint, Pick, Magnet, and Chain Bolt, and watch special bubbles reshape the board with lightning, treasure, vines, ice, stones, and score multipliers.

Companion pets add long-term strategy without slowing the action. Collect pets from crates, equip a lead companion, build a support party, socket gems, pick tech upgrades, and tune your team around score, coins, Fever, charge, or active board-clearing powers. Skybolt can even fly across the board and drop bombs along the strongest route.

Play your way:
- Campaign levels with evolving objectives and boss challenges
- Daily gifts, quests, achievements, and season rewards
- Puzzle Mode for fixed clear-the-board challenges
- Time Attack for a 60-second score rush
- Weekly tournament boards with local rank goals
- Optional colorblind symbols, hints, reduced motion, and mute controls

Bubblit! stores progress locally on your device. It is designed as a colorful, readable puzzle game with no account required.
```

App Store subtitle:

```text
Chain-pop puzzle adventure
```

App Store keywords draft:

```text
bubble,puzzle,match,chain,combo,pets,offline,arcade,casual,blast
```

Support URL: `https://amantaras.github.io/bubble-pop-chain/support.html`

Privacy URL: `https://amantaras.github.io/bubble-pop-chain/privacy.html`

## Review And Compliance Draft

Current build posture:

- No account system and no cloud sync.
- Progress is stored locally with `localStorage` / native web storage.
- Web/dev monetization surfaces use the built-in mock provider for testing.
- Native builds fail closed for purchases unless a real provider is injected.
- Rewarded ads can use the explicit development fallback while native ad SDK work is in progress; turn that off before a store build that should require real ads.
- No analytics or crash telemetry is currently implemented.

Store disclosures to finalize after the monetization decision:

- Ads: disclose only if real ad SDKs are enabled in the submitted native build.
- In-app purchases: disclose if real Play Billing / StoreKit products are enabled, or hide/disable paid surfaces before review.
- Data collection: update privacy labels if ads, billing, analytics, crash reporting, or support diagnostics collect data.
- Child-directed posture: decide before enabling personalized ads.
- Content rating: casual puzzle gameplay, no user-generated content, no chat, no gambling cash-out.

## Asset Checklist

- [ ] Google Play feature graphic.
- [ ] Android phone screenshots from `artifacts/store-screenshots/phone/`.
- [ ] Android tablet screenshots from `artifacts/store-screenshots/tablet/` if tablet support is listed.
- [ ] iPhone screenshots from `artifacts/store-screenshots/phone/` or an App Store-specific run.
- [ ] iPad screenshots from `artifacts/store-screenshots/tablet/` if iPad support is listed.
- [ ] Final short description.
- [ ] Final long description.
- [ ] Final App Store subtitle.
- [ ] Final App Store keywords.
- [ ] Google Play Data Safety answers from the submitted build behavior.
- [ ] Apple App Privacy labels from the submitted build behavior.
- [ ] Google Play content rating questionnaire.
- [ ] Apple age rating questionnaire.
- [ ] Ads and IAP disclosures matching the submitted build.