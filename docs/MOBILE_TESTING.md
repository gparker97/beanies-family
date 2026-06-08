# Mobile on-device test checklist

A repeatable smoke-test pass for the native builds (Capacitor, ADR-029). The web bundle is
identical across web / Android / iOS, so an **Android** pass validates ~all the app logic; only the
three "native-only" sections at the bottom are platform-specific and must be re-confirmed on iOS
(via TestFlight) once the Apple account exists.

**Get the latest Android debug APK:** open
`https://github.com/gparker97/beanies-family/releases/download/spike-android-latest/beanies-family-android-debug.apk`
on the phone and tap to install (allow "install from unknown sources" the first time). Each build
bumps the `versionCode`, so it installs cleanly over the previous one.

> Tip: confirm the build you're testing — Settings → (about) build SHA, or the `versionName`
> (`0.0.0-debug.<run>+<sha>`), matches the commit you expect. Errors also report the build SHA to
> `#beanies-errors`, so anything that breaks is traceable.

## Core flows (run every build)

- [ ] **First launch / onboarding** — welcome screen renders; onboarding steps advance; finishes cleanly.
- [ ] **Create pod — local file** — create a new family with a local `.beanpod`; data persists across an app restart.
- [ ] **Create pod — Google Drive** — create with Drive sync; the native Google sign-in completes in the system browser and returns to the app; pod saves to Drive.
- [ ] **Load existing pod from Drive** — sign in and load a `.beanpod` that already exists in Drive; decrypts and opens.
- [ ] **App restart / resume** — background and reopen the app; state restored, no re-login loop, no blank screen.

## Feature flows

- [ ] **Planner / calendar** — add an activity manually; it shows on the calendar; edit + delete work.
- [ ] **AI: photo → activity** — "Magic beans" on an invite photo; consent prompt → extracted activity prefilled; prep details land in the **Notes** field (one per line); category is sensible.
- [ ] **AI: duplicate detection** — scan the _same_ invite again → the "Already on your calendar?" prompt appears → "Update existing" merges into the existing activity (no duplicate); "Add anyway" creates a new one.
- [ ] **AI: document → trip** — "Magic beans" on a travel booking (image or PDF) → trip/segments extracted and reviewable.
- [ ] **Notifications** — the in-app bell shows what's-new / nudges; (native push is separate — see below).
- [ ] **Other tabs** — Piggy Bank (accounts/transactions), Treehouse, Family — each opens and renders without error.

## Native-only — must also be confirmed on iOS later (TestFlight)

- [ ] **System-browser OAuth round-trip** — Google consent opens in the system browser (not an embedded webview) and deep-links back into the app with a working session. (Android: confirmed working; iOS: via the Universal Link `https://beanies.family/oauth/native`, pending the Apple Team ID + AASA file.)
- [ ] **Local-file storage** — `.beanpod` create/load via `@capacitor/filesystem` (Android confirmed; iOS pending).
- [ ] **Biometric unlock (Face ID / Touch ID / fingerprint)** — deferred to the **Play-signed** build (debug build hits the known GMS `50152` DAL issue per ADR-029); re-test at the Play internal-testing milestone. iOS biometric pending the first iOS build.

## Logging issues

For anything that breaks: note the **build SHA / versionName**, the exact step, and whether it errored
silently or showed a toast. Errors auto-report to `#beanies-errors` with the build SHA — cross-reference
there. File real breakage as a GitHub issue with the `bug` + `area: pwa` labels.
