# ADR-029: Capacitor for native iOS/Android app-store distribution (wrap the existing PWA, don't rewrite)

> Date: 2026-05-22
> Status: **Proposed** (pending the `spike/capacitor-mobile` validation of the three risk points in "To validate" below; promote to Accepted once the spike confirms the wrap builds, system-browser OAuth round-trips, and Automerge WASM runs in a real WebView).
> Related: ADR-026 (iOS redirect OAuth), ADR-012 (responsive mobile layout), ADR-022 (pod architecture).

## Context

beanies.family is a mobile-first, local-first family app meant to be opened repeatedly throughout the day by **non-technical users**. Today the only "install" path is the PWA add-to-home-screen flow, which most non-technical users don't understand and can't discover (iOS in particular buries it behind Share → Add to Home Screen). For real pilot- and growth-scale adoption the app needs to be **in the major app stores** (Apple App Store, Google Play) so it appears as a normally-installed native app, and ideally in select minor / local-first channels too. Secondary goals: home-screen widgets (e.g. a calendar widget) and native-API access (filesystem; Bluetooth later for IoT child-trackers). The non-negotiable day-0 goal is **store presence**; widgets and deep native features are explicitly nice-to-have.

### The decision space

| Approach                             | Reuses the Vue code    | Effort to day-0 | Apple Store                         | Google Play | Native APIs | Widgets          |
| ------------------------------------ | ---------------------- | --------------- | ----------------------------------- | ----------- | ----------- | ---------------- |
| **Capacitor** (wrap the PWA)         | ~100%                  | Low             | ✅ real native binary               | ✅          | ✅ plugins  | ✅ native bridge |
| PWA→store wrapper (PWABuilder / TWA) | 100%                   | Lowest          | ❌ rejected (4.2.2 "web clippings") | ✅ TWA      | ❌          | ❌               |
| React Native                         | ~0% (rewrite in React) | High            | ✅                                  | ✅          | ✅          | ✅               |
| Flutter                              | ~0% (rewrite in Dart)  | High            | ✅                                  | ✅          | ✅          | ✅               |
| Native (Swift + Kotlin)              | ~0% (two codebases)    | Highest         | ✅                                  | ✅          | ✅ best     | ✅ best          |

### What makes this an easy call for beanies specifically

The app is already an unusually well-prepared PWA, so a rewrite would discard a large, hand-architected codebase (Vue 3 + MVO + Automerge CRDT + Web-Crypto encryption) to solve what is fundamentally a _packaging_ problem. Concretely, the hard parts are done:

- **Standalone-mode PWA** (`vite.config.ts`: `display: 'standalone'`) → Capacitor inherits a clean isolated app context.
- **Redirect OAuth already implemented** for iOS + standalone PWAs (ADR-026, `shouldUseRedirectAuth()` in `src/services/google/googleAuth.ts`) → most of the way to the system-browser OAuth pattern WebViews require.
- **WebAuthn biometric unlock already shipped** (`src/services/auth/passkeyService.ts`, Face ID / Touch ID) → works in iOS/Android WebViews **and** is exactly the kind of native-feeling capability that clears Apple's Guideline 4.2 "minimum functionality" bar.
- **Automerge 3.x already compiled to WASM and pre-bundled** (`vite-plugin-wasm` + `vite-plugin-top-level-await`; precache budget already raised to 4 MiB for the ~2.65 MB blob) → no data-layer rework.
- **Local-file gap already handled gracefully** — the File System Access API is Chromium-only and we already steer non-Chromium users to Google Drive; in a WebView we swap that path to `@capacitor/filesystem` and Drive sync is unaffected.
- **No existing native/Cordova/RN baggage** — clean slate.

### Validated external facts (mid-2026, see Sources)

- **Apple does not accept PWAs.** Guidelines 4.2 / 4.2.2 reject "repackaged websites" and "web clippings." A real native binary with app-like native features is required — which Capacitor produces and a pure PWA-wrapper does not. (This kills the PWABuilder/TWA option as a _cross-platform_ answer.)
- **Google Play accepts both** TWAs and Capacitor apps. New **personal** developer accounts (created after 2023-11-13) must run a closed test with **≥12 testers for 14 consecutive days** before production. **Organization accounts are exempt** (re-validated 2026-05-22 against multiple sources after a contradictory third-party claim; the official policy is scoped explicitly to _personal_ accounts).
- **Organization enrollment on both platforms requires a D-U-N-S number** (not a local company-registration number such as a Singapore UEN). Free from Dun & Bradstreet, supports Singapore, can take **up to ~30 days**. One D-U-N-S serves both Apple and Google org enrollment. Registering the existing Singapore Pte Ltd as an Organization therefore (a) **skips the Google 12-tester gate entirely** and (b) gives a real publisher identity.
- **beanies is fully open source** (public repo, `gparker97/beanies-family`) → F-Droid is eligible, but the Google Drive + Google OAuth dependencies will likely earn an F-Droid "NonFreeNet" anti-feature tag. **Obtainium** (installs directly from GitHub Releases, no gatekeeping) is the frictionless local-first channel; F-Droid is a labelled nice-to-have.

### Build-environment constraint

The dev machine is **WSL2 / Linux with no Java, no Android SDK, and (necessarily) no Xcode**. Android can be built on Linux/CI; **iOS builds require macOS — they cannot run on Linux at all.** This makes _where we build_ the one genuine open decision (see Consequences → Open questions).

## Decision

1. **Adopt Capacitor** to wrap the existing built web app into native iOS and Android binaries. We keep one codebase (the Vue PWA) and add `ios/` and `android/` native projects on top. No rewrite, no second UI framework.

2. **OAuth runs in the system browser, not the WebView.** Google blocks embedded-WebView OAuth (`disallowed_useragent`). We route Google sign-in through `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android) via `@capacitor/browser` (or a dedicated Capacitor OAuth plugin), returning to the app through a deep link / custom URL scheme. The existing ADR-026 redirect flow is the foundation; the redirect _target_ becomes the system browser and the _return_ becomes a deep link. **This is the highest-risk integration and is validated first in the spike.**

3. **Local-file storage uses `@capacitor/filesystem`** in the native build (the Chromium-only File System Access API does not exist in WebViews). Drive sync — the primary path — is unchanged. The existing capability detection (`src/services/sync/capabilities.ts`) gains a Capacitor-native branch rather than steering to "use Chrome."

4. **Lean on the already-shipped WebAuthn biometric unlock** as the primary "app-like native feature" to satisfy Apple Guideline 4.2; add native push notifications (`@capacitor/push-notifications`) as reinforcement. We do **not** ship a bare WebView with no native value.

5. **Enroll both stores as an Organization** using the Singapore company + a D-U-N-S number, to skip the Google 12-tester gate and establish a publisher identity. Start the D-U-N-S application immediately (it gates everything downstream and takes weeks).

6. **Distribution tiers:** Phase 0 — Apple App Store (via TestFlight → review) + Google Play. Phase 2 — Obtainium (signed APKs on GitHub Releases), then Amazon/Samsung/Huawei and optionally F-Droid. iOS stays App-Store-only (plus EU DMA marketplaces, out of scope).

7. **Home-screen widgets and Bluetooth are explicitly Phase 2+.** Widgets require native UI (SwiftUI WidgetKit / Android Glance) with a shared-state bridge (`capacitor-widget-bridge` / `@capgo/capacitor-widget-kit`); a calendar widget is a focused per-platform mini-project, not day-0. Bluetooth (`@capacitor-community/bluetooth-le`) is for the future IoT child-tracker idea and is not day-0/1/2.

## Consequences

### Expected outputs

- **Android:** a debug `.apk` (sideloadable onto a phone for trial), and a release `.aab` (the format Google Play requires; the store derives per-device APKs).
- **iOS:** an `.ipa`, delivered to devices via **TestFlight** (or a cabled Xcode dev build). No sideloadable APK-equivalent exists on iOS.

### Trade-offs / risks accepted

- One extra layer (native shell + CI) to maintain alongside the web app.
- iOS builds force a macOS dependency (local Mac or cloud-Mac CI).
- App-store review + signing/provisioning + the D-U-N-S wait are manual ops no AI tool fully automates.

### Open questions (to resolve before/inside the spike)

- **Build & distribution mechanics** (the one fork given WSL + no Mac): **decided 2026-05-22 — GitHub Actions** (not a third-party service), since the repo is already GitHub-native and, being **public, gets free standard runners — including the macOS runners iOS requires** (the 2026 per-minute Actions charge excludes public repos). Android builds on `ubuntu-latest` (a debug APK needs no signing); iOS builds on a `macos` runner via Fastlane (the one extra-effort piece vs a managed service is wiring iOS code-signing ourselves). Sequencing: **Android-first** (free, no Apple account) to de-risk on-device, iOS once the Apple Org account exists.
- **Apple Guideline 4.8 ("Sign in with Apple"):** beanies uses Google as an encrypted-_storage_ provider, not a social identity provider, so 4.8 likely does not apply — but it's a known grey area; adding Sign in with Apple is the safe fallback if review pushes back.

### To validate (the spike's purpose — gates promotion to Accepted)

1. The Capacitor wrap of the existing `dist/` builds into a runnable Android app.
2. **System-browser OAuth round-trips** (Google consent → deep-link back → token in memory → decrypt) in the native context.
3. **Automerge WASM initializes inside a real WebView** (verify the WebView serves `.wasm` with `application/wasm` and the bundled path resolves).

If any of (1)–(3) fails in a way Capacitor can't bridge, this ADR is revised before committing to a full implementation plan.

## Spike findings (2026-05-22, branch `spike/capacitor-mobile`)

What the first scaffolding pass confirmed (the parts verifiable without a device build):

1. **Capacitor 8.3.4 installs cleanly** into the existing Vue 3 / Vite 6 project — no dependency conflicts, no peer-range fights.
2. **`cap init` + `cap add android` + `cap add ios` all succeed on Linux/WSL.** iOS scaffolds too because **Capacitor 8 uses Swift Package Manager** (`ios/App/CapApp-SPM`, `App.xcodeproj`), not CocoaPods — so no macOS is needed to _generate_ the iOS project (building it still requires Xcode/macOS, i.e. cloud CI).
3. **The existing `npm run build` output (192 precache entries, ~16 MB) copies cleanly into both native projects** via `cap sync`. The copied `app/src/main/assets/public` dir is auto-gitignored, so committing the native projects stays lean (CI regenerates assets).
4. **Risk point 3 — static half PASSES.** The 2.7 MB `automerge_wasm_bg-*.wasm` is physically bundled into the Android assets (`android/app/src/main/assets/public/assets/`). The remaining runtime half — does the Capacitor WebView serve `.wasm` with `application/wasm` so `WebAssembly.instantiateStreaming` succeeds — still needs a device build to confirm (Automerge's non-streaming fallback should cover it even if the MIME map doesn't include `.wasm`).
5. **New integration point found AND fixed: the PWA service worker bundled into the native assets** (`sw.js`, `workbox-*.js`, `manifest.webmanifest`). A web-PWA service worker should _not_ run inside a Capacitor WebView (the app is already served from local assets; the SW + auto-update/reload machinery fights Capacitor's local server). Verified `useRegisterSW` in `usePwaUpdater()` is the **only** registration path (no auto-injected script in `index.html`, no `registerSW.js`), so `usePwaUpdater()` now early-returns when `Capacitor.isNativePlatform()` — SW stays unregistered on iOS/Android, web behavior unchanged.
6. **Plugins wired for both platforms:** `@capacitor/app` (deep-link `appUrlOpen`), `@capacitor/browser` (system-browser OAuth), `@capacitor/filesystem` (local `.beanpod`) — detected by both `cap add` runs, ready for the code adaptations.
7. **Risk point 1 — PASSES.** The `mobile-android-build.yml` workflow builds a valid 17 MB debug APK on a clean `ubuntu-latest` runner in ~3m13s, no signing/secrets/Apple account needed. Verified the artifact contains the Capacitor shell (`classes.dex`), the web app (`assets/public/index.html`), and the 2.75 MB `automerge_wasm_bg-*.wasm`.
8. **Remaining validations** (need the APK running on a real device): risk point 2 (system-browser OAuth round-trip) and risk point 3's runtime half (WASM actually initializes in the WebView — a rendered welcome screen confirms it, since Automerge is core). Next code tasks: the OAuth deep-link branch and the `@capacitor/filesystem` branch (neither storage path works in the native build yet). Next ops task (gated on D-U-N-S): the iOS / Fastlane → TestFlight workflow.

## Key files (anticipated; spike will confirm)

- `capacitor.config.ts` — new; app id (e.g. `family.beanies.app`), `webDir: 'dist'`, deep-link scheme.
- `src/services/google/googleAuth.ts` — add a Capacitor-native branch (system browser + deep-link return) alongside `shouldUseRedirectAuth()`.
- `src/services/sync/capabilities.ts` / `connectStorage.ts` / `providers/localProvider.ts` — `@capacitor/filesystem` branch for local `.beanpod` files.
- `vite.config.ts` — confirm WASM asset emission survives the Capacitor copy step.
- `src/composables/usePwaUpdater.ts` — native-platform early-return that disables the SW in the Capacitor build (done).
- `ios/`, `android/` — generated native projects (kept on the spike branch; their fate decided by the build-mechanics choice).
- `.github/workflows/mobile-android-build.yml` — Android debug-APK build (done, spike-scoped). A sibling iOS / Fastlane → TestFlight workflow follows once the Apple Org account exists.
