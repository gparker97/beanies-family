# Plan: Capacitor native iOS/Android app-store distribution

> Date: 2026-05-22
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-22-capacitor-native-app-store-distribution.md`
> Decision record: `docs/adr/029-capacitor-native-app-store-distribution.md`
> Spike branch: `spike/capacitor-mobile` (becomes the implementation branch)
>
> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded under `## Prompt Log`.

## User Story

As a **non-technical family member**, I want to **install beanies.family from the App Store / Google Play like any normal app** (and get reminders for our family events and to-dos) so that **I don't have to understand the unintuitive "add this website to your home screen" PWA flow, and the app feels like a first-class, repeatedly-used part of my phone.**

## Context

beanies.family today ships only as a PWA. Non-technical users can't discover or perform add-to-home-screen (especially on iOS), which caps adoption for a mobile-first, open-many-times-a-day app. ADR-029 decided to **wrap the existing Vue 3 PWA with Capacitor** rather than rewrite in React Native / Flutter / native — preserving the entire hand-architected codebase (MVO + Automerge CRDT + Web-Crypto + Drive sync) and solving what is fundamentally a packaging problem.

**The spike (`spike/capacitor-mobile`) has already de-risked the approach:**

- ✅ Capacitor 8.3.4 wraps the existing app cleanly (no dependency conflicts).
- ✅ Both `android/` and `ios/` native projects scaffold on Linux/WSL (iOS via Swift Package Manager — no Mac needed to _generate_).
- ✅ A **GitHub Actions** workflow (`.github/workflows/mobile-android-build.yml`) builds a valid Android debug APK on a free `ubuntu-latest` runner and publishes it to a rolling prerelease for one-tap phone install.
- ✅ **Automerge WASM initializes in the WebView** — confirmed on a physical Android device (welcome screen renders, create-pod flow navigates).
- ✅ The PWA service worker is guarded off natively (`usePwaUpdater()` early-returns when `Capacitor.isNativePlatform()`).

**The only remaining technical risk is risk point 2 — the system-browser OAuth round-trip** (Google blocks OAuth inside WebViews). Everything else in this plan is productionization: native storage, notifications, native polish, signed release builds, store enrollment, and submission.

**Decisions locked with greg (2026-05-22):**

- **Android-first**, iOS to follow (iOS is gated on D-U-N-S → Apple Org enrollment → macOS CI anyway).
- **Push at day-0**, delivered as **on-device local notifications** (see Caveat 1 — remote FCM/APNs push is architecturally constrained by the zero-knowledge model and is deferred).

## Requirements

### Functional — native app behavior

1. The app installs from **Google Play** (Phase A) and the **Apple App Store** (Phase B) and presents as a normally-installed native app.
2. **Google sign-in works natively** via the system browser (not the WebView), returning to the app through a deep link, then completing the existing encrypted-pod load/create flow.
3. **Google Drive sync** (the primary storage path) works unchanged inside the native app.
4. **Local-file `.beanpod` storage** works natively via `@capacitor/filesystem` (the Chromium-only File System Access API does not exist in WebViews), with the same create/load/save semantics users get on desktop Chrome.
5. **Local notifications** remind the user of upcoming family activities and due/overdue to-dos, scheduled on-device from already-decrypted data, with a first-run permission request and rescheduling when the underlying data changes.
6. **Biometric unlock** (existing WebAuthn) continues to work in the native WebView (Face ID / Touch ID / Android biometric).
7. Native UX polish: branded splash screen, status-bar styling, app icons, safe-area insets, and hardware **back-button** handling on Android.
8. The web PWA continues to work **identically and unaffected** — all native code paths are inert in the browser (`Capacitor.isNativePlatform()` is false).

### Functional — build, release, distribution

9. GitHub Actions builds a **signed release AAB** for Google Play (Phase A) and a **signed IPA → TestFlight** for iOS (Phase B), with app versioning derived deterministically.
10. The existing **debug-APK rolling-prerelease** lane is retained for fast on-device dev testing.
11. Apps are submitted: Google Play (internal testing → production) and App Store (TestFlight → review).

### Non-functional

12. **No silent failures** — every native plugin call (browser open, deep-link parse, filesystem I/O, notification permission/schedule) is wrapped, classified, and surfaced through the existing `errorReporter` / telemetry pipeline (toast for user-blocking, console for non-critical with a documented fallback). Mirrors the project's established error discipline.
13. **DRY** — native paths reuse the existing OAuth (PKCE/redirect/token-exchange), storage-provider, and capability-detection machinery; platform branching is centralized, not scattered.
14. The native additions must not regress the full unit suite, type-check, lint, or the production web build.

## Important Notes & Caveats

1. **"Push" at day-0 = local notifications, NOT remote push — because beanies is zero-knowledge.** No beanies server can see a user's decrypted family data (it lives only in the user's encrypted pod). So a backend cannot trigger meaningful per-user pushes ("your event is in 1 hour", "someone assigned you a to-do") without breaking the privacy model or building a metadata-leaking relay. The privacy-aligned, high-value, low-infra answer is **`@capacitor/local-notifications`**: the app schedules reminders on-device from data it already has decrypted. This also satisfies Apple Guideline 4.2 (native functionality) alongside biometric unlock. **Remote push (FCM/APNs) is deliberately deferred to Phase 2** and, when built, is scoped to broadcast announcements or a separately privacy-reviewed design. _If greg wants data-driven remote push at day-0, that is a materially larger, privacy-sensitive effort and this plan must be re-scoped._
2. **OAuth must leave the WebView.** Google returns `disallowed_useragent` for OAuth inside embedded WebViews. The native flow opens the system browser (`ASWebAuthenticationSession` on iOS / Custom Tabs on Android, both via `@capacitor/browser`) and receives the redirect back through a deep link (`@capacitor/app`'s `appUrlOpen`). This is an _extension_ of the existing ADR-026 redirect flow — reuse the PKCE + token-exchange code; only the "open browser / receive redirect" mechanism differs.
3. **Greg-side prerequisite for OAuth:** the native redirect URI must be registered in the existing Google Cloud Console OAuth client. Plan ships **both** the custom scheme (`family.beanies.app://oauth`) **and** Android App Links (verified `https://beanies.family/oauth/native` via a hosted `/.well-known/assetlinks.json`) at day-0. Custom schemes are **non-exclusive on Android** — any co-installed app can register the same scheme and intercept the OAuth `code` — so the verified App Link is the security backstop: the A2 `state` check closes CSRF, the App Link closes interception. `assetlinks.json` is one static file on the domain we already control, and `apple-app-site-association` is needed for iOS (Phase B) regardless, so the hosting work is not net-new. Custom-scheme-only is an acceptable fallback **only** with the A2 `state` validation in place — but the verified App Link is the target.
4. **D-U-N-S is the long pole (~30 days)** and gates BOTH Apple Org enrollment and the Google Play Org account. The Org route is worth it: it skips Google's 12-tester/14-day gate and gives a real "beanies" publisher identity. Start the free D-U-N-S application immediately, in parallel with all code work.
5. **iOS builds require macOS** — handled by GitHub Actions `macos` runners (free for this public repo). iOS code-signing (certs + provisioning) is the one genuinely fiddly bit; Fastlane `match` or base64 secrets is the standard tool.
6. **Apple Guideline 4.8 (Sign in with Apple)** is a grey area: beanies uses Google as an encrypted-_storage_ provider, not a social identity provider, so 4.8 likely doesn't apply. Watch for it in review; adding Sign in with Apple is the fallback if rejected. Do **not** pre-emptively build it.
7. **App-store listing copy / screenshots / marketing assets live in Notion, not the repo** (per the project's launch-content rule). This plan covers the technical + submission mechanics; the listing text is produced separately in Notion.
8. **The SW guard is already done** — do not re-implement. `usePwaUpdater()` early-returns natively; verified `useRegisterSW` is the only registration path.
9. **Do not deploy the web app or touch prod** as part of this work. Merging Capacitor to `main` does not change web behavior, but follow the project's "never deploy unless asked" rule.
10. **GitHub Actions "Node 20 deprecation" warning** — the spike's top-level actions are already current (`checkout@v4`, `setup-node@v4` on Node 24, `setup-java@v4`, `setup-android@v3`, `upload-artifact@v4`). If the warning persists it's from a _transitive_ action; identify the real offender from run logs before bumping — do not bump blind.

## Assumptions

> **Review these before implementation.** Valid at planning time; may have changed.

1. **App identity:** `appId = family.beanies.app`, `appName = beanies.family` (set during the spike). Confirm before first store submission (the bundle ID is permanent once published).
2. **OAuth redirect mechanism:** Android App Links (verified `https://beanies.family/oauth/native`) as primary + custom URL scheme `family.beanies.app://oauth` as fallback, both registered in the Google OAuth client (Caveat 3). A2's mandatory `state` validation protects whichever transport delivers the redirect.
3. **Local notifications** can be scheduled from the existing activities + to-dos data layer (due/overdue dates already drive in-app badges via `useNavBadges`/`safeDate`). The exact reactive hook points are verified in Pass 2.
4. **Org enrollment** (Apple + Google) using greg's Singapore Pte Ltd + a D-U-N-S number is the chosen account path; greg drives the registrations.
5. **Capacitor 8.x** plugin set: `@capacitor/app`, `@capacitor/browser`, `@capacitor/filesystem` (installed), plus to-add `@capacitor/local-notifications`, `@capacitor/splash-screen`, `@capacitor/status-bar`. Pinned to the Capacitor 8 major for plugin compatibility. **Upgrade policy:** keep all `@capacitor/*` on the _same_ major and bump them as a set (mismatched majors are the common breakage); Capacitor minor/patch Dependabot PRs are safe to batch once the mobile CI lanes are green; a Capacitor _major_ (8 → 9) is a deliberate scheduled effort — add it to the Dependabot `ignore` list (per `/review-dependabot-prs`) until then. Because plugin imports are confined to ~4 wrapper modules (A1), a major's blast radius is those files + the centralized test fixture.
6. **The web app's existing OAuth Lambda token-exchange proxy** (`api.beanies.family`) is reused unchanged for the native flow (same client, same PKCE exchange).
7. **Android signing keystore** and **Apple certs/profiles** will be stored as GitHub repo secrets (base64) — non-sensitive config (bundle IDs, track names) as repo variables, per the project's vars-vs-secrets lesson.

## Approach

The work runs on the existing `spike/capacitor-mobile` branch (already carries the scaffolding, SW guard, and Android CI). It merges to `main` once OAuth is validated on-device and the web build is confirmed unaffected. Three tracks: parallel prerequisites, Phase A (Android → Play), Phase B (iOS → App Store). Phase 2 items are documented but out of day-0 scope.

### Track 0 — Parallel prerequisites (greg-driven, non-code, start now)

- **D-U-N-S application** for the Singapore Pte Ltd (free; ~30 days). Gates both Org accounts.
- **Google Play Console Org account** ($25 one-time; needs D-U-N-S) — skips the 12-tester gate.
- **Apple Developer Program Org enrollment** ($99/yr; needs D-U-N-S).
- **Google Cloud Console:** add both the App Link (`https://beanies.family/oauth/native`) and the custom scheme (`family.beanies.app://oauth`) as authorized redirect URIs on the existing OAuth client.
- **Host `/.well-known/assetlinks.json`** on `beanies.family` with the release keystore's SHA-256 fingerprint (and `apple-app-site-association` with the App Store team ID for Phase B) — static-file hosting on the existing domain; does not touch the web app runtime or the deploy pipeline.
- **Store listing assets** (icon set, screenshots, descriptions, data-safety/privacy answers) — authored in Notion.

### Phase A — Android to Google Play (day-0)

**A1. Platform abstraction (DRY foundation).** Add `native: boolean` and `platform: 'web' | 'ios' | 'android'` to the existing `SyncCapabilities` interface in `src/services/sync/capabilities.ts`, populated in `getSyncCapabilities()` from `Capacitor.isNativePlatform()` / `Capacitor.getPlatform()`. Crucially, make the local-file capability native-aware. **Careful — the flag-flip alone is NOT enough:** several entry points gate on `supportsFileSystemAccess()` **directly**, not on the capability object — verified: `connectStorage.connectLocalStorage()` (the `unsupported-browser` return), `syncService.initialize()` (local-handle restore, ~line 464), and `syncService.selectSyncFile()` (~line 525). The single-source fix is to make **`supportsFileSystemAccess()` itself return `true` when `Capacitor.isNativePlatform()`** — or, cleaner, route all these sites through one new `canUseLocalFiles()` predicate (`supportsFileSystemAccess() || capabilities.native`). Change that one predicate, then confirm by grep that no `supportsFileSystemAccess()` caller is left on the web-only branch natively. The component callers that _do_ read the capability object (`CreatePodView.vue`'s `unsupported-browser` errorKind, `ResumePodSetup.vue`, `LoadPodView.vue`, `getSyncCapabilityMessage()`) then follow for free — but the storage entry points need the predicate fix or the native local-file path is dead on arrival. This is the single source of truth: `Capacitor.isNativePlatform()` must appear in `capabilities.ts` and nowhere else in `src/` (today it appears only in `usePwaUpdater.ts` — keep it that way).

**Plugin imports are likewise centralized, not scattered.** Each `@capacitor/*` plugin is imported in exactly one wrapper: `Browser`/`App` only in the `googleAuth.ts` native branch, `Filesystem` only in `capacitorFileProvider.ts`, `LocalNotifications` only in `useLocalNotifications.ts`, `SplashScreen`/`StatusBar`/`App.backButton` only in one `useNativeShell()` composable (A5). **No `*.vue` component ever imports a `@capacitor/*` plugin directly** — components consume the capability flags + composables. This bounds a future Capacitor major (8 → 9) to ~4 wrapper files. Lock it with a `no-restricted-imports` lint rule (or a unit test) asserting no `*.vue` imports `@capacitor/*`, so it can't silently regress — mirroring how the SW guard is pinned to one path.

**A2. System-browser OAuth deep-link.** In `src/services/google/googleAuth.ts`, add a native-only `startNativeAuth(returnPath, loginHint?)` that mirrors `startRedirectAuth()` exactly — same `generateCodeVerifier`/`generateCodeChallenge`, same `buildAuthUrl(clientId, codeChallenge, 'consent', loginHint)` (the `prompt=consent` invariant is load-bearing, see ADR-028), same `sessionStorage` write of `{ codeVerifier, returnPath }` under `REDIRECT_AUTH_KEY` — but instead of `window.location.href = authUrl`, set `redirect_uri = family.beanies.app://oauth` and open via `Browser.open({ url: authUrl })`.

**Reuse the existing completion — do not write a new exchange.** Register one native-guarded `@capacitor/app` `appUrlOpen` listener (registered exactly once via a module-level idempotency guard mirroring `usePwaUpdater`'s `initialized` flag and the auth-wake listener's install guard — store the returned `PluginListenerHandle` for removal in a `__resetNativeAuthForTesting()` hook, so a future `App.vue` remount can't stack a second listener that double-consumes the OAuth code) that, on a `family.beanies.app://oauth?...` URL: parses `code`/`error`, writes `code` to the shared redirect-code sessionStorage key, calls `Browser.close()`, then invokes the **existing `completeRedirectAuth()`** — which already does PKCE-verifier reload, the Lambda `exchangeCodeForTokens`, the `drive.file`-scope check, refresh-token persistence, `scheduleAutoRefresh`, and `notifyTokenAcquired`. The only web↔native difference is the _transport_ (deep link vs. full-page redirect into `OAuthCallbackPage`); the completion is shared verbatim. **Hardening:** promote the bare `'beanies_redirect_auth_code'` literal to an exported const in `googleAuth.ts` (next to `REDIRECT_AUTH_KEY`) referenced by all three touch-points — `OAuthCallbackPage.vue`, the native `appUrlOpen` handler, and `completeRedirectAuth`'s reader — so the native path can't drift from the web path on a renamed key.

**Security — `state` is mandatory for the deep-link transport (the one place the native path must NOT mirror the web path).** The existing flow carries no `state` (verified: `buildAuthUrl` never sets it; neither `completeRedirectAuth` nor `OAuthCallbackPage` validate it) — acceptable on web (the code returns via a same-origin top-level navigation) but not over a custom scheme, which is **non-exclusive on Android**: any co-installed app can register an intent-filter for `family.beanies.app://oauth` and intercept or inject the redirect. PKCE blocks an attacker from completing their own exchange, but without `state` a CSRF/code-injection variant remains (binding the victim's app to the attacker's Drive account). The native flow MUST: (a) generate a CSPRNG `state` (reuse `generateCodeVerifier()`), persist it in the `REDIRECT_AUTH_KEY` object, and pass it via a new optional `state?` param on `buildAuthUrl` (web callers pass nothing, unaffected); (b) in `appUrlOpen`, **validate the echoed `state` against the persisted value before writing the `code`** — on mismatch: discard, `clearGoogleSessionState()`, `reportError({ surface: 'native-oauth-state-mismatch' })`, never exchange. Gate validation on `state` presence so existing web flows/tests are untouched.

**Boot-path de-conflict:** both the native `appUrlOpen` handler and `App.vue`'s existing boot-time Step 2b call `completeRedirectAuth()`, which consumes the one-time code by removing its sessionStorage key. Ensure only one consumes it per auth — gate the boot-time call to skip when `capabilities.native` (the deep-link handler owns native completion), relying also on `completeRedirectAuth()`'s idempotent early-return when the key is already gone. Verify on-device that a deep-link cold launch doesn't let Step 2b race-consume the code before the handler writes it.

**Correctness fix the implementer must not miss:** `getRedirectUri()` returns `${origin}/oauth/callback`, which is wrong for the native exchange — the token exchange must echo the same `redirect_uri` Google saw. Add a native branch to `getRedirectUri()` returning `family.beanies.app://oauth` so `startNativeAuth` and `completeRedirectAuth`'s exchange agree (single touch-point; do not thread a `redirectUri` param through callers). Without this the exchange fails with `redirect_uri_mismatch`.

Add the custom scheme to `capacitor.config.ts` + Android `AndroidManifest.xml` intent-filter.

**No-silent-failure requirements (each a real gap):**

- `appUrlOpen` carrying `error=access_denied`/`error=...` (declined consent) → classify via the existing `isUserCancellation()` + `clearGoogleSessionState()` cleanup; treat as benign `cancelled`, no `reportError`. Anything else (`code` present but exchange throws, or neither `code` nor `error`) → `reportError({ surface: 'native-oauth' })` + toast steering to "try again or use a local file."
- `Browser.open()` rejection (no Custom Tabs / no browser) → caught + `reportError({ surface: 'native-oauth-browser' })` + toast (otherwise the sign-in button spins forever).
- **Deep link may never arrive** (user force-quits the browser, OS drops the callback) — the web flow is covered by page navigation; native has no equivalent backstop. Add a ~2-min timeout analogous to `POPUP_AUTH_TIMEOUT_MS` / the `withTimeout(150_000)` in `connectDriveStorage`; on expiry reject with the **same** user-facing string `waitForAuthCode`'s timeout uses ("didn't return … try again, or use a local file instead") to keep wording DRY.
- **Deep link arrives with no native auth in flight** (no `REDIRECT_AUTH_KEY` state — app cold-launched by the link, duplicate delivery, or a spoofed link). Treat as benign: do not write the code, do not exchange, log at info level, no `reportError`. Mirrors `completeRedirectAuth()`'s early-return on absent state and (with the `state` check above) closes the cold-launch injection case.

**A3. `@capacitor/filesystem` local-file branch.** The native filesystem differs structurally from `LocalStorageProvider` (which holds a `FileSystemFileHandle` and calls `createWritable`/`getFile`/`queryPermission`) — Capacitor uses path-based `Filesystem.readFile`/`writeFile`, no handle, no permission query. Rather than wedge two transports into one class, add a **sibling `CapacitorFileProvider implements StorageProvider`** under `src/services/sync/providers/` satisfying the same `StorageProvider` contract (`read`/`write`/`getLastModified`/`isReady`/`persist`/`clearPersisted`/`disconnect`/`getDisplayName`/`getFileId`/`getAccountEmail`/`supportsLocalPolling`). The sync engine is already provider-agnostic — no engine changes.

**Cold-boot restore must be specified, not stubbed.** `LocalStorageProvider` persists/restores via a `FileSystemFileHandle` in IndexedDB; `CapacitorFileProvider` has only a path string, so its `persist()`/`clearPersisted()` store/clear that path (reuse the existing provider-config IndexedDB store, not a new one), and `syncService.initialize()`'s restore path reconstructs a `CapacitorFileProvider` from the persisted path when `capabilities.native`. Confirmed (Pass 4): the local-file path today restores via `getFileHandle()` inside the `supportsFileSystemAccess()` block of `syncService.initialize()` (~line 464) and does NOT use the `PersistedProviderConfig.type` discriminator block above it (that block handles only `google_drive`). `CapacitorFileProvider` restore therefore needs a **new, explicit branch** in `initialize()`: persist a config row with `type: 'local'` + the path via `storeProviderConfig`, and reconstruct `CapacitorFileProvider.fromPath(path)` when `capabilities.native && config.type === 'local'`. Extend `PersistedProviderConfig` with a new optional `localPath?` field (do NOT overload `driveFileId`). This branch lives in `initialize()` only, behind `capabilities.native`, never in callers; web's `FileSystemFileHandle` restore is untouched and the two branches are mutually exclusive by `capabilities.native`. **Do NOT ship `persist()` as a no-op** — a pod that silently fails to reload on app restart is a reliability regression, not a missing nicety.

**Reuse the error classification — do not write a second mapping.** `localProvider.ts` exports `classifyFileError()` + `FileErrorVerdict` and reports via `errorReporter` with the existing `storage.localFile*` i18n keys. `CapacitorFileProvider` must funnel every `read`/`write` failure through the **same** `classifyFileError` → verdict → i18n-key path (mapping Capacitor's error shapes onto the existing `FileErrorKind` union) so users see identical messages and Slack sees one consistent `surface: 'local-file'` bucket. If Capacitor surfaces shapes the current `switch` doesn't cover, extend the existing table (and its test table) — never add a parallel classifier.

**Wire into the existing `connectStorage` outcome contract, not new UI.** Extend `connectLocalStorage()` so that when `capabilities.native` it constructs `CapacitorFileProvider` (save-location prompt or app-scoped default) and returns the existing `{ status: 'connected', type: 'local' }` shape. Because A1 makes the shared `supportsFileSystemAccess()`/`canUseLocalFiles()` predicate native-true (not merely the capability object), the `unsupported-browser` early-return in `connectLocalStorage()` is skipped natively and `selectSyncFile()`'s guard passes. `connectLocalStorage` must then branch on `capabilities.native` to construct `CapacitorFileProvider` instead of calling `syncService.selectSyncFile()` (which builds a `LocalStorageProvider` via the Chromium-only save-picker). `CreatePodView.vue`/`ResumePodSetup.vue` need no change. `syncStore.createNewFile()` already owns the encrypt → write → verify-load (pod-creation hardening); the provider only supplies the I/O.

**A4. Local notifications.** Add `@capacitor/local-notifications`. A single native-guarded composable (`useLocalNotifications`) requests permission at an appropriate moment and schedules/refreshes on-device reminders.

**Derive the reminder set from `useCriticalItems().criticalItems`, NOT raw store selectors or `useNavBadges`.** `useCriticalItems` is already _the_ canonical, fully-translated, audience-resolved "what needs this member's attention" computed — it merges activities (incl. dropoff/pickup duties), due/overdue to-dos (via `isTodoOverdue`), medications, and holidays into `CriticalItem { id, type, message, icon, time, occurrenceDate, completed }`. For _future-dated_ reminders ("event in 1 hour") use `activityStore.upcomingActivities` and `todoStore.scheduledTodos`. Scheduling off these gives DRY, already-i18n'd, already-privacy/audience-correct notification _copy_ for free. `useNavBadges` is the wrong layer — it emits only counts/dots, no message text. Date parsing still flows through `parseIsoDateSafely`/`isTodoOverdue`, so the `safeDate` DRY claim holds.

Reschedule reactively by `watch`-ing those computeds using **cancel-all-then-reschedule** (debounced) as the default — for a family's item volumes this is correct, has no diff-state to drift, and makes cancel-on-completion/deletion fall out for free (completed items leave the computed). Do _not_ build an ID-diffing scheduler unless on-device testing shows a concrete problem (e.g. notification flicker). The plugin requires **integer** notification IDs while `CriticalItem.id` is a string (UUIDs + synthesized `holiday-…`), so add one small pure helper mapping `CriticalItem.id` → a stable 32-bit int (unit-tested for collision-resistance across the real ID shapes); an unstable mapping would cancel the wrong reminder. Debounce the watch so a burst of edits doesn't trigger a reschedule storm. Reuse `usePollWhileVisible` (caught-and-reported cadence + native-safe teardown) for any periodic safety re-sync rather than a hand-rolled watcher.

**No-silent-failure requirements:**

- `requestPermissions()` returning `denied` is **not** an error — show a one-time dismissible explainer (or defer to the Help Center article) on how to enable reminders in OS settings; never `reportError` a user denial. A _thrown_ permission call (plugin missing/misconfigured) → `reportError({ surface: 'local-notifications-permission' })`.
- Wrap each `schedule`/`cancel`; on throw → `reportError({ surface: 'local-notifications-schedule', severity: 'warning' })` + console guidance, and **degrade to the in-app `FamilyStatusToast` briefing** (which already renders `criticalItems`) so the information is never lost silently.
- Wrap the reschedule `watch` callback (mirror the `safeRun` pattern in `usePollWhileVisible`) so a throw can't kill reactivity.

All native-only (`capabilities.native` guard); web is unaffected.

**A5. Native UX polish — one composable.** All runtime native-shell wiring (splash hide, status-bar style, Android back-button) lives in a single native-guarded `useNativeShell()` composable, called once from `App.vue` setup alongside `usePwaUpdater()` — not scattered `onMounted` blocks (`App.vue` is already 1000+ lines). It is the only module importing `@capacitor/splash-screen` / `@capacitor/status-bar` and registering the `@capacitor/app` `backButton` listener (per A1's plugin-import rule). App icons and safe-area insets (CSS `env(safe-area-inset-*)`) are static config/asset concerns, not runtime code, and stay out of the composable. On web it early-returns so `App.vue` gains one inert call. **Do not add a second back system:** `useBackGestureClose` already closes overlays/modals on the platform back gesture via a `history.pushState` marker + `popstate` (its docstring explicitly lists the Android back button), so on Android the system back button already closes overlays through `popstate`. The `@capacitor/app` `backButton` listener must be a **thin top-level fallback** for the _root_ case only (no overlay open + history at root → `App.exitApp()`; else `router.back()`), gated on `hasOpenOverlays()` (already exported from `@/utils/overlayStack`, used by `usePwaUpdater`) to avoid double-firing with `popstate`. Verify on-device that back doesn't both close an overlay and navigate. Consult the beanies theme skill for icon/splash brand rules.

**A6. Release build CI.** Add a sibling **signed release AAB** lane: inject the keystore (base64 secret), set `versionCode`/`versionName` (derived from run number / git), `./gradlew bundleRelease`, sign, upload to the Play **internal testing** track via Fastlane `supply` (or the Google Play GitHub action). Keep the debug-APK rolling-prerelease lane. **Reuse the existing build steps** (checkout → setup-node → setup-java → setup-android → `npm ci` → `npm run build` → `npx cap sync android`) — only diverge at build/sign/upload. To make "reuse" real and not copy-paste, factor the shared web-build prefix (checkout → setup-node → cache → `npm ci` → `npm run build`) into a local **composite action** (`.github/actions/build-web/action.yml`) consumed by the debug-APK, release-AAB, and (Phase B) iOS lanes — a Node/action-version bump then happens in one file, not three. Platform-specific tails (Java/Gradle; Ruby/Fastlane) stay in their respective workflows. (An acceptable lighter alternative: keep the duplication between the two Android lanes for day-0 and extract the composite action when the iOS lane lands in Phase B — the third consumer is what makes the abstraction pay. Don't block Phase A on the refactor.) The spike workflow already uses current `actions/*` (`checkout@v4`, `setup-node@v4` on Node 24, `setup-java@v4`, `setup-android@v3`, `upload-artifact@v4`); if the "Node 20 deprecation" warning persists it's from a _transitive_ action — identify the actual offender from the run logs before bumping, not blind.

**A7. Play submission.** Create the app in Play Console (Org account), complete the data-safety form, content rating, and store listing (assets from Notion), promote internal → production.

**A8. Merge to `main`.** Once OAuth is validated on a real device and `npm run validate` + the production web build are green, merge `spike/capacitor-mobile` → `main`. The native additions are inert on web; the web deploy pipeline is untouched.

### Phase B — iOS to App Store (follows Phase A; gated on Apple Org enrollment)

The OAuth, filesystem, notifications, and polish code from Phase A is **cross-platform via Capacitor** — Phase B is mostly iOS-specific config + build/sign/submit, not new app logic.

- **B1.** iOS deep-link: register the custom scheme (and/or Universal Link) in `Info.plist`; verify `appUrlOpen` delivers the OAuth redirect on iOS.
- **B2.** `Info.plist` usage strings (notifications; any future permissions) and ATS as needed.
- **B3.** iOS notification permission flow (APNs not required for _local_ notifications).
- **B4.** iOS CI: `macos` runner + Fastlane (`match` for signing, `gym` to archive, `pilot` to TestFlight). Certs/profiles from Apple Org enrollment, stored as secrets.
- **B5.** TestFlight → App Store review. Clear 4.2 via biometric + local notifications; watch 4.8 (Sign in with Apple) — fallback only if rejected.

### Phase 2 — documented, out of day-0 scope

- **Home-screen widgets** (calendar): native WidgetKit (iOS) / Glance (Android) + shared-state bridge (`capacitor-widget-bridge`).
- **Remote push (FCM/APNs):** announcement broadcasts or a privacy-reviewed notification design (see Caveat 1).
- **Alt distribution:** Obtainium (already partly enabled by the GitHub-Releases APK), F-Droid (with the "NonFreeNet" Google-dependency caveat), Amazon/Samsung/Huawei.
- **Bluetooth** (`@capacitor-community/bluetooth-le`): future IoT child-tracker pairing.

## Files Affected

**New:**

- `src/composables/useLocalNotifications.ts` — permission + schedule/refresh/cancel of on-device reminders (native-guarded; sources from `useCriticalItems`/`upcomingActivities`/`scheduledTodos`).
- `src/services/sync/providers/capacitorFileProvider.ts` — sibling `StorageProvider` for native local files (reuses `classifyFileError` from `localProvider.ts`; path-based persist/restore).
- `src/composables/useNativeShell.ts` — single home for splash / status-bar / back-button native wiring (sole importer of those plugins).
- `.github/actions/build-web/action.yml` — composite action for the shared web-build prefix, consumed by all mobile lanes.
- `src/test/stubs/capacitor.ts` — centralized typed Capacitor plugin fakes + native↔web toggle for unit tests.
- `.github/workflows/mobile-android-release.yml` (or extend the existing) — signed AAB → Play internal track.
- iOS Fastlane config (`ios/App/fastlane/`) and iOS CI workflow (Phase B).
- App icon / splash brand assets (both platforms).

**Modified:**

- `capacitor.config.ts` — deep-link scheme, plugin config, server settings.
- `src/services/sync/capabilities.ts` — native platform/capability detection (single source of truth); make `supportsFileSystemAccess()` / a new `canUseLocalFiles()` predicate native-true so the direct `supportsFileSystemAccess()` call sites follow.
- `src/services/google/googleAuth.ts` — native system-browser + deep-link OAuth branch (reusing existing PKCE/exchange); add `state` generation + validation to the deep-link path (new optional `state?` param on `buildAuthUrl`, persisted in `REDIRECT_AUTH_KEY`); native `getRedirectUri()` branch; `__resetNativeAuthForTesting()`.
- `src/services/sync/connectStorage.ts` — construct `CapacitorFileProvider` in `connectLocalStorage()` when `capabilities.native`.
- `src/services/sync/providers/localProvider.ts` — extend the `classifyFileError` table (+ its test table) only if Capacitor surfaces uncovered error shapes; no transport changes to `LocalStorageProvider`.
- `src/services/sync/syncService.ts` — new `capabilities.native` restore branch in `initialize()` reconstructing `CapacitorFileProvider.fromPath`; `selectSyncFile()` routes native to the Capacitor provider.
- `src/services/sync/fileHandleStore.ts` — extend `PersistedProviderConfig` with an optional `localPath` field for native-file restore.
- `App.vue` — one `useNativeShell()` call + native-guarded `appUrlOpen` listener init; gate boot-time `completeRedirectAuth()` to skip when `capabilities.native`.
- `android/app/src/main/AndroidManifest.xml` — deep-link intent-filter, permissions.
- `ios/App/App/Info.plist` — URL scheme, usage strings (Phase B).
- `.github/workflows/mobile-android-build.yml` — action-version bumps; coexist with the release lane.
- `package.json` — add `@capacitor/local-notifications`, `@capacitor/splash-screen`, `@capacitor/status-bar`.
- `docs/adr/029-*.md` — promote status to Accepted once OAuth validates; keep findings current.

## Help Center Coverage

This work introduces a **distinct new user-facing way to install and use the app** (native app-store install + on-device reminders), so it warrants Help Center docs, authored per `.claude/skills/beanies-help-docs/SKILL.md` and shipped in the same change.

- **Article 1 — Install beanies.family on your phone**
  - **Action:** update existing (the current install/getting-started guidance) → make app-store install the primary path, PWA add-to-home-screen the fallback.
  - **Category:** `getting-started`
  - **Article type:** `how-to`
  - **Slug:** `install-the-app` (or update the existing install article)
  - **Scope:** How to install from the App Store / Google Play, that it's the same encrypted local-first app as the web version (full data parity), and how sign-in/biometric works on mobile.
  - **Notes:** Clarify there's no separate account; the app uses the same Google Drive pod. Mention that the app and web share data through the same encrypted file.
- **Article 2 — Reminders & notifications**
  - **Action:** new article.
  - **Category:** `features`
  - **Article type:** `how-to`
  - **Slug:** `reminders-and-notifications`
  - **Scope:** How to enable notifications, what triggers a reminder (upcoming activities, due to-dos), and that reminders are generated **on your device** from your own data — beanies' servers never see your schedule.
  - **Notes:** Emphasize the privacy angle (on-device, zero-knowledge) — it's a differentiator and a YMYL-trust point. Note how to change/disable in OS settings.

## Acceptance Criteria

- [ ] Google sign-in completes natively on a physical Android device (system browser → deep link → pod loads/creates), with cancellation and malformed-redirect both handled gracefully (no silent failure).
- [ ] Google Drive sync works in the native app (create, load, save, cross-device).
- [ ] Local-file `.beanpod` create/load/save works via `@capacitor/filesystem` on Android.
- [ ] Local notifications: permission prompt appears appropriately; a reminder fires for an upcoming activity and a due to-do; reminders reschedule on data change and cancel on completion.
- [ ] Biometric unlock works in the native app.
- [ ] Splash, status bar, icon, safe areas, and Android back-button behave correctly.
- [ ] The web PWA is unaffected: `npm run validate` (type-check + lint + format + unit + build) green; existing PWA install + behavior unchanged.
- [ ] Signed release AAB builds in CI and uploads to the Play internal track; debug-APK rolling prerelease still works.
- [ ] App is live on Google Play (Phase A); on the App Store via TestFlight → review (Phase B).
- [ ] Help Center articles (Install; Reminders & notifications) added/updated and verified against shipped behavior.

## Testing Plan

1. **OAuth (device):** sign out → sign in on a physical Android phone via the rolling-prerelease APK; confirm the system browser opens, consent returns to the app, and the pod decrypts. Test cancel mid-flow and a tampered/again redirect.
2. **Storage (device):** create a pod on Drive; load it on a second device; create + load a local-file pod; force-quit mid-save and confirm no corruption (reuse pod-verify).
3. **Notifications (device):** grant permission; create an activity due soon + an overdue to-do; confirm reminders fire, reschedule on edit, cancel on completion; confirm none fire on web.
4. **Web regression:** `npm run validate`; manual smoke that PWA install + OAuth (popup/redirect) + local-file (Chrome) are unchanged; confirm `Capacitor.isNativePlatform()` is false in the browser so all native branches are dormant.
5. **Unit:** new tests for the native branches in `googleAuth`, `capabilities`/`connectStorage`, and `useLocalNotifications`, asserting web behavior is untouched and native paths classify errors. No silent-catch. **Capacitor mocks are centralized:** add one shared test fixture (`src/test/stubs/capacitor.ts`) with typed fakes for `Capacitor.isNativePlatform()`/`getPlatform()`, `Browser`, `App`, `Filesystem`, `LocalNotifications`, plus a helper to toggle native↔web per test, so a Capacitor API change updates fakes in one place (not N files) and they stay type-checked against real plugin signatures. The fixture must preserve the default `isNativePlatform() === false` that the existing `usePwaUpdater.test.ts` relies on (it uses the real `@capacitor/core`), so web-path tests are unaffected.
6. **CI:** debug-APK lane green; signed release AAB builds and reaches the Play internal track; (Phase B) IPA reaches TestFlight.
7. **Store review:** internal testing install on Play; TestFlight install on iOS; pass App Store review (4.2/4.8 watch).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the full plan — Android-first phasing, push-as-local-notifications (zero-knowledge rationale), OAuth deep-link / filesystem / notifications code work, signed-release CI, Org-account prerequisites, two Help Center articles, and Phase 2 backlog.
- **Pass 2 (DRY + error handling)**: Named exact reuse targets verified in code — A2 reuses `completeRedirectAuth()` (caught a `getRedirectUri()` `redirect_uri_mismatch` bug + added a deep-link-timeout backstop); A3 adds a sibling `CapacitorFileProvider` reusing `classifyFileError`; A4 sources notifications from `useCriticalItems` (not `useNavBadges`, which has no message text) and degrades to the in-app briefing; A1 flips capability flags native-true so call sites need no new branches; A5 reuses `useBackGestureClose`/`hasOpenOverlays`; corrected the Node-20 caveat.
- **Pass 3 (Sustainability)**: Bounded future Capacitor upgrades by confining all plugin imports to ~4 wrapper modules (+ a lint/test guard banning `@capacitor/*` in `.vue`); collapsed native polish into one `useNativeShell()`; made the OAuth `appUrlOpen` listener a guarded singleton with a reset hook + a named shared redirect-code const; specified `CapacitorFileProvider` cold-boot persist/restore (no no-op `persist()`); fixed the notifications reschedule to cancel-all + a stable string→int ID helper; added a CI composite action for the shared build prefix; added a Capacitor upgrade policy + centralized test fixture.
- **Pass 4 (Fresh-eyes sweep)**: Mandated a `state` CSRF parameter on the native deep-link OAuth path (the existing flow has none — safe on web, unsafe over a non-exclusive custom scheme); promoted Android App Links from deferred-hardening to a day-0 requirement alongside the scheme; **corrected A1's false "zero new branching" claim** — three sites gate on `supportsFileSystemAccess()` directly, not the capability object, so the fix must change that predicate (else the native local-file path is dead on arrival); specified the `CapacitorFileProvider` restore as a new explicit branch in `syncService.initialize()` with a `localPath` config field; added benign handling for stray/cold-launch deep links and de-conflicted the `appUrlOpen` vs. `App.vue` boot-time `completeRedirectAuth()` double-consume; flagged the CI composite action as optionally deferrable to Phase B.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (this planning task)

> let's do the formal /beanies-plan

### Preceding context (the conversation that shaped this plan)

The plan formalizes a multi-turn exploration in the same session:

- greg asked about options for getting beanies.family into the major (and minor) app stores — Capacitor vs React Native / Flutter / native, plus how Claude compares to AI app-builder tools — with day-0 goal "be in the major (and minor) app stores so they appear natively installed," and stretch goals of home-screen widgets (e.g. calendar) and native features (Bluetooth, filesystem).
- greg: "let's move forward with your suggestions to write the ADR and implement capacitor to build the apps — if you prefer we can do it on a branch for research / trial & error... as long as our learnings are captured and used to form a robust plan. What would the expected output be — i.e. an .apk and/or the equivalent for iOS?" Decisions: (a) Singapore company w/ UEN created 2024 — and asked to re-validate the Android 12-tester claim (ChatGPT said it applies regardless of D-U-N-S); (b) beanies is already 100% open source (public repo); (c) Bluetooth use case = future AirTag/IoT child-trackers, not day 1–2.
- greg: "Yes - let's do that" (write the Android workflow + SW guard + push the branch) "and just to confirm we are working on a branch, and once this is done we will build a robust plan to do this formally?" — then confirmed git updated to 2.50.1.
- greg asked whether the APK artifact is reachable from the GitHub mobile app or only the website → led to the rolling-prerelease step.
- greg: "sure wire that up. also, I confirmed I downloaded the zip to my phone and extracted the apk and ran it, and the welcome screen rendered ok on my phone and I can navigate to create a pod, etc" (validated risk point 3 on-device).
- greg: "let's do the formal /beanies-plan".

### Clarifying answers (this planning task)

- **Store sequencing:** Android-first, iOS follows.
- **Push scope:** Include push at day-0 (drafted as on-device local notifications per the zero-knowledge rationale; flagged for greg's confirmation at review).

</details>
