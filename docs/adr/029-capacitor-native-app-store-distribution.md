# ADR-029: Capacitor for native iOS/Android app-store distribution (wrap the existing PWA, don't rewrite)

> Date: 2026-05-22
> Status: **Accepted** (2026-05-22). Implemented A1–A6 and merged to `main` (the `spike/capacitor-mobile` branch's work; branch deleted). Risk point 1 (the wrap builds → APK) and risk point 3 (Automerge WASM runs in the WebView) are confirmed on a physical Android device, and native local-file pod create/load is on-device-validated. Risk point 2 (system-browser OAuth) is code-complete + unit-tested; its on-device confirmation is gated on the App Link verification (hosted `assetlinks.json` with the release signing fingerprint) — a greg-side infra action. The signed-release Play lane (A6) is dormant until the keystore + Play service account + Org account (D-U-N-S) exist.
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

2. **OAuth runs in the system browser, not the WebView.** Google blocks embedded-WebView OAuth (`disallowed_useragent`). We route Google sign-in through `ASWebAuthenticationSession` (iOS) / Custom Tabs (Android) via `@capacitor/browser`, returning to the app through a **verified https App Link** (`https://beanies.family/oauth/native`), NOT a custom scheme — the existing Google OAuth client is a Web-application type, which rejects custom schemes (verified 2026-05-22), and an App Link reuses the Web client + Lambda exchange while being hijack-resistant. The existing ADR-026 redirect flow is the foundation; the redirect _target_ becomes the system browser and the _return_ becomes a verified App Link deep link. **This is the highest-risk integration and is validated first in the spike.**

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
8. **Risk point 3 — PASSES (full).** greg installed the CI APK on a physical Android phone (2026-05-22): the welcome screen renders and the create-pod flow navigates. Since Automerge is the core data layer, a rendered + navigable app confirms the WASM initializes in the WebView — the `application/wasm` MIME concern was a non-issue in practice.
9. **Only risk point 2 remains** — the system-browser OAuth round-trip. Next code tasks: the OAuth deep-link branch and the `@capacitor/filesystem` branch (neither storage path works in the native build yet), both now testable against the one-tap prerelease APK loop. Greg-side prerequisite for OAuth: register the App Link redirect `https://beanies.family/oauth/native` (https) in the Google OAuth client + host a verified `assetlinks.json` (custom schemes are rejected by the Web client). Next ops task (gated on D-U-N-S): the iOS / Fastlane → TestFlight workflow.

## Key files (anticipated; spike will confirm)

- `capacitor.config.ts` — new; app id (e.g. `family.beanies.app`), `webDir: 'dist'`, deep-link scheme.
- `src/services/google/googleAuth.ts` — add a Capacitor-native branch (system browser + deep-link return) alongside `shouldUseRedirectAuth()`.
- `src/services/sync/capabilities.ts` / `connectStorage.ts` / `providers/localProvider.ts` — `@capacitor/filesystem` branch for local `.beanpod` files.
- `vite.config.ts` — confirm WASM asset emission survives the Capacitor copy step.
- `src/composables/usePwaUpdater.ts` — native-platform early-return that disables the SW in the Capacitor build (done).
- `ios/`, `android/` — generated native projects (kept on the spike branch; their fate decided by the build-mechanics choice).
- `.github/workflows/mobile-android-build.yml` — Android debug-APK build (done, spike-scoped). A sibling iOS / Fastlane → TestFlight workflow follows once the Apple Org account exists.

## Native auth follow-ups (2026-05-23)

After the spike landed, two native auth gaps surfaced on the debug APK. Both are recorded here because they shape the native distribution story.

### Google Drive sign-in via redirect transport (RESOLVED)

The **pod-load** path (loading an existing `.beanpod` from Drive) still used a popup OAuth transport, which cannot complete inside the native WebView or an installed PWA — it opened a blank tab and hung ~120s before timing out. Fix: unify the load flow on the same **system-browser / redirect** transport the rest of the app already uses on those surfaces (`beginDriveAuthRedirectIfNeeded`, `?resume=load-drive`), reusing `completeRedirectAuth()` on return. A follow-on `TypeError: Failed to fetch` (CORS) on the OAuth proxy was traced to the WebView **document origin**: `capacitor.config.ts` now serves the local bundle under `https://app.beanies.family` (`server.hostname`), which is already CORS-allowlisted, so OAuth requests originate from an allowed origin. `https://localhost` and a `native_redirect_uris` variable were also added to the proxy's allowlist (terraform-applied). greg confirmed native sign-in works end-to-end. Desktop (popup) is unchanged.

### Native biometric (passkey) — DEFERRED to the Play-signed build

Native biometric was pursued through two transports; the root cause is now pinned and the feature is deliberately deferred.

- **WebView-WebAuthn — dead end (abandoned).** `WebSettingsCompat.setWebAuthenticationSupport(FOR_APP)` → opaque `CreateCredentialUnknownException`; `FOR_BROWSER` → hard native Chromium WebView crash (`org.chromium.base.JniAndroid$UncaughtExceptionException`) the instant `navigator.credentials.create()` runs. The device itself creates passkeys fine via Chrome and the installed PWA, so the limitation is specifically the Capacitor WebView ↔ Credential Manager bridge. (Commit `a30fa0c` shipped this approach to `main`; it is superseded by the plugin approach below — `MainActivity` is now a bare `BridgeActivity`.)
- **`@capgo/capacitor-passkey` plugin shim — the correct path.** `autoShimWebAuthn()` (native-only, installed in `main.ts`, `isNative()`-gated) routes the app's existing `navigator.credentials.create/get` calls to the native Android Credential Manager / iOS ASAuthorization. The crypto/PRF/`passkeyWrappedKeys` envelope stack is reused **unchanged**; only `getRpId()` (native → `app.beanies.family`, web → origin host) and the shim install were added. The plugin successfully reaches Google's own FIDO `RegistrationActivity` — proving the WebView bridge was the blocker, not the device, account, RP, or Digital-Asset-Links.
- **The remaining wall: GMS `[50152] "RP ID cannot be validated"` on the sideloaded DEBUG build.** This persists despite a fully correct association: signing cert **confirmed `19:E4:…`** (`adb shell pm get-app-links family.beanies.app` → `Signatures:[19:E4…]` and `beanies.family: verified`), and the `app.beanies.family` assetlinks (`delegate_permission/common.get_login_creds` + `19:E4`) **validated by Google's own checker** (`linked:true`). It is the known, murky on-device GMS DAL failure that affects **sideloaded / debug-signed** apps specifically — not a config error on our side.
- **Decision: defer native biometric to the Play-signed internal-testing build.** Rationale: (1) production native biometric must validate against the **Play App Signing** cert anyway (not the debug `19:E4`), so the definitive test belongs on the Play build; (2) GMS Credential-Manager DAL validation for passkey _creation_ is materially more reliable for Play-distributed apps, and `50152`-on-debug commonly resolves there; (3) the Play internal-testing track is required for store launch regardless. Nothing is blocked meanwhile: native works with **password sign-in**, and **PWA/browser biometric is unchanged**. **iOS biometric is also deferred** — the plugin currently returns empty `clientExtensionResults` (no PRF round-trip) and no iOS build exists yet.
- **Foundation retained in `main`** (validate on the Play build, no rework): the plugin shim + `capacitor.config.ts` origin/RP config, the `getRpId()` seam, `public/.well-known/assetlinks.json` (live), CI unique `versionCode` + build-SHA stamping, bare `MainActivity`, and `residentKey:'preferred'` on native.
- **At the Play milestone:** add the Play App Signing SHA-256 to `public/.well-known/assetlinks.json` (keep `19:E4` for debug too), re-test register → unlock, and — if it works — collapse native registration to a single create attempt (the 3-attempt progressive fallback re-prompts the chooser, fine for web/OEM quirks but poor native UX). If `50152` persists even Play-signed, gate the native biometric offer behind a flag.

### 2026-07-14 update — `50152` RESOLVED, but a second (PRF) wall → decision to abandon WebAuthn on native

Tested on the **Play-signed** closed-testing build (`0.9.5`) on a Pixel 10 Pro / Android 16 / GMS `26.25.32`, with full `adb logcat` + `dumpsys` capture. Findings, in order:

1. **The signing cert was never the issue.** `dumpsys package family.beanies.app` confirmed the installed app is signed with the **Play App Signing key `18:76:CB:BE:…`**, which was already in the assetlinks and `linked:true` per Google's DAL check API. (An earlier same-session guess that greg's install was upload-key-signed — commit `9a5e9804`, adding `D1:E7…` — was **wrong**; harmless, left in place, and it does cover Internal-App-Sharing/sideload test installs.)
2. **`50152` persisted on the Play build too** — disproving the "resolves on Play-signed" hope above. Ground-truth error in logcat: `[ValidateRpIdOperation] … cmih: [50152] RP ID cannot be validated.`
3. **Root cause of `50152`: our RP-ID assetlinks (`app.beanies.family`) declared `get_login_creds` ONLY.** Every canonical Google Credential-Manager example pairs **both** `handle_all_urls` **and** `get_login_creds`; GMS Credential Manager on this device rejected the `get_login_creds`-only statement. **Fix (deployed, commit `1d93b418`): added `handle_all_urls` to the `app.beanies.family` statement.** After Google's DAL re-fetched, `create()` **passed RP-ID validation** — `50152` gone, `prf_enable_result` telemetry now fires. This assetlinks fix is correct and permanent regardless of the mechanism decision below. (`webauthn.io` passkey creation worked on the same device throughout — proving device + Google Password Manager are fine and the failure was purely our config.)
4. **A SECOND wall immediately appeared: PRF.** With `create()` succeeding, the app cannot obtain a PRF output to wrap the family key → `enroll_declined` (`action: no-prf`) → friendly "biometric unlock isn't available." This is the well-known incompleteness of **Google Password Manager's WebAuthn-PRF** support (cf. the "Samsung Pass works, GPM fails" split in `f-23/react-native-passkey#68`). (The deciding `prf_enabled` bit was not visible in CloudWatch — the telemetry Lambda in prod predates the `#52` `passkey-prf` allowlist keys and strips them; a Lambda redeploy would be needed to see it, but the decision below makes that moot.)

**DECISION (2026-07-14, greg): abandon WebAuthn-PRF on native; pivot native biometric to `BiometricPrompt` + Android Keystore (and iOS LocalAuthentication + Keychain / Secure Enclave).** Rationale: WebAuthn-PRF on Android GPM fought us at every layer (RP-ID validation, then PRF eval); Keystore is what robust apps use for "unlock a local key with a fingerprint," has **no RP-ID / assetlinks / PRF / GPM dependency**, works offline, is hardware-backed, and also unblocks iOS (drops the never-compiling `@capgo` Swift PRF patch). The only thing PRF bought us — cross-device biometric — is a nice-to-have already covered by the encrypted `.beanpod` cloud copy (new device = re-enter password once + re-enroll). **Web/PWA keeps WebAuthn-PRF** (it works in real browsers). To be planned via `/beanies-plan` next session; native biometric falls back to password meanwhile and PWA/web biometric is unaffected. See `docs/lessons.md` (2026-07-14) for the debugging lesson.

## Store-submission readiness (2026-07-08)

Org enrolment for both stores was started 2026-07-08 (D-U-N-S obtained; Tinfoil DPA signed). A readiness audit + `docs/plans/2026-07-08-native-store-release-readiness.md` closed the remaining pre-submission code/config gaps. **Closed by that plan:**

- **iOS privacy manifest** — `ios/App/App/PrivacyInfo.xcprivacy` added + bundled (Apple auto-rejects new apps without it), declaring the app's real data collection (diagnostics + owner email; see the canonical table in `docs/runbooks/native-store-submission.md`) and required-reason APIs.
- **iOS Associated Domains** — `ios/App/App/App.entitlements` (`applinks:beanies.family` + `webcredentials:app.beanies.family`) wired into both pbxproj configs; the OAuth Universal Link AASA (`web/public/.well-known/apple-app-site-association`, `<APPLE_TEAM_ID>` placeholder) added on beanies.family (previously only the Android App Link + the app.beanies.family passkey AASA existed).
- **Export compliance** — `ITSAppUsesNonExemptEncryption = false` added to `Info.plist`.
- **Store version** — both release lanes now derive the marketing version from `APP_VERSION` via `scripts/derive-store-version.mjs` (R-suffix stripped for iOS validity), replacing the hardcoded `1.0.<run#>`.
- **Privacy-declaration honesty** — the telemetry firehose no longer ships the user-typed `family_name` (gated behind `includeEmail`); `web/src/pages/privacy.astro` + a new `web/src/pages/delete-account.astro` disclose the diagnostics/error-reporting flow (the app IS data-collecting — the old "we collect nothing" copy was a store-submission contradiction).
- **Runbook** — `docs/runbooks/native-store-submission.md` owns the per-store submission flow, the Data-Safety/App-Privacy answer sheets, and the account-gated substitution (Team ID + Play cert) + on-device validation checklists.

**Still gated on account approval** (in the runbook): real Apple Team ID → both AASA files; Play App Signing SHA-256 → both `assetlinks.json` (incl. the biometric one above); signing secrets; on-device native-OAuth validation on both platforms; native-biometric re-test on the Play-signed build.
