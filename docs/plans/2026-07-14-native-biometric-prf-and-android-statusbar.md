# Plan: Native biometric passkey (unified PRF, web/Android/iOS) + Android edge-to-edge status-bar background

> Date: 2026-07-14
> Related issues: Notion #52 (biometric passkey can't be enabled on native — High) + Notion #53 (Android black status-bar band — Normal). No GitHub issues (both rows: do not create).
> Plan file: `docs/plans/2026-07-14-native-biometric-prf-and-android-statusbar.md`

## User Story

- **#52** — As a family member using the installed iOS or Android app, I want to enable biometric (passkey) unlock and have it work the first time and every time afterward — the same as on the web app — so I never get bounced to a password or shown a confusing error after I've turned it on.
- **#53** — As an Android app user, I want the top status-bar area to show the app's own background (light or dark, matching my theme) instead of a black band, so the app looks finished and trustworthy.

## Context

Two native-only defects, batched into one mobile build so both validate together on-device (native testing is **live-only** for greg — no local/dev iOS/Android; verification happens on a deployed store/TestFlight build). Neither affects web/PWA.

### #52 — root causes (verified against code 2026-07-14)

Biometric passkey **registration fails on native** ("no create options available"), and the underlying PRF machinery is broken on native in several independent ways:

1. **Salt serialization (Android).** `buildPRFExtension()` (`passkeyCrypto.ts:110-123`) returns the PRF eval salt as a raw `Uint8Array`. The `@capgo/capacitor-passkey@8.3.9` shim's `cloneExtensions` (`node_modules/@capgo/capacitor-passkey/dist/esm/webauthn.js:312-317`) does `JSON.parse(JSON.stringify(extensions))` (**confirmed**), which turns the `Uint8Array` into an index-keyed object `{"0":98,…}` instead of the base64url string the WebAuthn JSON serialization requires. The native Credential Manager request is malformed. (Web is unaffected — the real browser WebAuthn API accepts a `BufferSource` directly.)
2. **eval-at-create is unreliable on Google Password Manager (Android).** Even with a correct salt, GMS does not reliably support evaluating PRF _at creation_. The reliable, spec-endorsed pattern is **enable PRF at create (`prf: {}`, check `prf.enabled`), then evaluate at each assertion**. The current code evals at create and wraps the family key from the create-time PRF output.
3. **iOS: PRF is entirely unsupported by the plugin (confirmed).** `CapacitorPasskeyPlugin.swift` does **not decode the `extensions` field** and **hard-codes `"clientExtensionResults": JSObject()`** on both create (`:349`) and assertion (`:370`). So on iOS, `prf.enabled` / `prf.results.first` are always empty — PRF cannot work without a native-code patch.
4. **`getPRFOutput` / `isPRFSupported` assume an `ArrayBuffer`, but native returns a string (confirmed, required fix — was understated as "verify").** `isPRFSupported` (`passkeyCrypto.ts:18-25`) tests `prf.results.first.byteLength`; `getPRFOutput` (`:30-36`) returns it as-is. On native the shim serializes `results.first` to a **base64url string**, which has no `byteLength` → `isPRFSupported` returns `false` even when PRF succeeded, and the wrap/unwrap `deriveWrappingKey` gets a string not an `ArrayBuffer`. These two helpers MUST normalize `results.first` (string → `ArrayBuffer` via the shared decoder) before use.
5. **Raw error leaks to the user (confirmed).** `formatCredentialManagerError` (`passkeyService.ts:671-701`) already fires a `reportError` (surface `passkey-assertion`) in its default branch, but it **returns `err.message` — the raw platform string — to the caller**, which is toasted. There is no case for `NoCreateCredentialException` / "no create options available". The registration path (`:173-180`) similarly joins raw `attemptErrors` into telemetry (correct) but the _user_ string comes from `formatCredentialManagerError(err)` (raw fallthrough).
6. **Silent wrap swallow (confirmed).** The register wrap block (`passkeyService.ts:211-224`) has a bare `catch {}` ("PRF wrap failed — non-critical") that returns `success: true` with **no** `passkeySecret` — a silent failure producing exactly the "registered but unusable" limbo greg rejected.
7. **`retryRegistrationWithFallbacks` drops PRF as a last resort (confirmed, `:544-556`).** Fallback 2 deletes `publicKeyOptions.extensions` and creates a non-PRF passkey — useless for unlock under the new require-PRF model.
8. **Offer shown where it can't work.** `isPlatformAuthenticatorAvailable()` (`:62-69`) checks only that a platform authenticator exists, not that a passkey can be created + PRF-wrapped. On iOS < 18.4 (no usable PRF) the offer would still appear.
9. **`registration.prfSupported` is derived from the wrong signal under the new create shape (fresh-eyes, confirmed).** Today `registration.prfSupported = isPRFSupported(extensionResults)` where `extensionResults` come from `create()` (`passkeyService.ts:189-199`). Under the new **enable-only** create (`{prf:{}}`), the create-time extension results carry `prf.enabled === true` but **no `results.first`**, so `isPRFSupported()` (which tests `results.first`) would return **false** and the record would be persisted (and copied to synced devices via `registerSyncedCredential`, `:453`) as `prfSupported:false`. The record's `prfSupported` MUST instead be sourced from `prf.enabled` at create (equivalently, from wrap success). This is a correctness bug the enable-only switch would otherwise introduce.

Verified reusable machinery (do NOT rebuild):

- The wrap chain `PRF output → deriveWrappingKey (HKDF, info 'beanies.family-passkey-dek-wrap') → wrapDEK (AES-KW) → passkeySecret` (`passkeyCrypto.ts`) is correct and platform-agnostic.
- `passkeySecret` persistence via `syncStore.addPasskeySecret` (`syncStore.ts:2971`) → envelope `passkeyWrappedKeys`; `effectivePasskeySecrets` (`:2951`) merges ref + envelope so cold-session unlock works. Persist call-site `App.vue:225` is a plain `if (result.passkeySecret)` — unchanged by this plan.
- Sync merge unions `passkeyWrappedKeys` across devices (`envelopeMerge.ts:26-57` `mergeKeyDict` = `{...remote, ...local}`) — device B's secret never clobbers device A's.
- `tryUnwrapFamilyKeyFromPRF` (`passkeyService.ts:413-435`) re-derives the wrapping key from the **assertion** PRF output + stored `hkdfSalt` and unwraps. The **fixed** app-wide salt (`'beanies.family-prf-salt-v1'`, `passkeyCrypto.ts:112`) guarantees create-time and assertion-time PRF outputs match for the same credential.
- **Existing web passkeys stay compatible**: unwrap only needs `(assertion PRF output, stored hkdfSalt, stored blob)` — unaffected by moving _new_ wraps to assertion time, as long as the fixed salt is unchanged. Verified at `passkeyService.ts:208-224` that existing web secrets were wrapped at create time from the fixed-salt PRF output; the deterministic PRF property means the same fixed salt at assertion reproduces the identical output → they unwrap unchanged. The shared `normalizePRFOutput` passes a web `ArrayBuffer` through untouched, so the web unwrap byte-path is identical to today.
- **Error display is already centralized** — `useToast` (`showToast('error', …)`, with `silent`/`critical` options + built-in `reportError`) and callers (`App.vue:handleEnablePasskey`) already render passkey errors. **No new error modal/component is needed**; this plan only changes the _strings returned_ and the _telemetry_, not the display path.
- `registerPasskeyForCurrentUser` (`authStore.ts:1034-1060`) already guards `!syncStore.familyKey` (`:1048`) — the in-memory key is present whenever register runs, so it can be wrapped during the enable ceremony.

### #53 — root cause (verified)

`MainActivity.java` already opts into edge-to-edge (`setDecorFitsSystemWindows(false)`, `setStatusBarContrastEnforced(false)`, `setNavigationBarContrastEnforced(false)` — **confirmed**) and `useNativeShell.ts` calls `StatusBar.setOverlaysWebView({overlay:true})` + `setStyle` (icon contrast only, never a background paint — **confirmed**).

Crucially, **the running-app root already carries a theme-aware background**: `App.vue:1380` is `<div class="min-h-screen bg-gray-50 dark:bg-slate-900">`, and `useNativeShell`'s own comment states the design relies on it ("let the page background paint behind a transparent bar — the root `bg-gray-50 dark:bg-slate-900` blends + tracks the theme for free"). So the band is **not** a missing running-app root paint.

The real gaps are two:

- **(a) No native window background for the pre-paint / inset region.** The activity theme is `AppTheme.NoActionBarLaunch` (parent `Theme.SplashScreen`, `android:background=@drawable/splash`); `AppTheme.NoActionBar` sets `android:background=@null`. There is **no `colors.xml` and no `values-night/`** (confirmed: `res/values/` has only `capacitor-passkey.xml`, `ic_launcher_background.xml`, `strings.xml`, `styles.xml`). On SDK 36 the deprecated `StatusBar.setBackgroundColor` is a no-op, so whenever the WebView is inset or hasn't painted, the strip behind the status bar exposes the window/decor (splash/black) → the band.
- **(b) Color-match trap (must not introduce a seam).** The running root paints Tailwind `bg-gray-50` (`#F9FAFB`) light / `slate-900` (`#0f172a`) dark. If the native `windowBackground` is set to _different_ values (e.g. the brand `#F8F9FA`/`#1a252f`), the pre-paint strip and the WebView will show **two slightly different colors** — a visible seam. The native color and the root color must be a single source of truth.

targetSdk/compileSdk = 36, minSdk = 24. `styles.xml` references `@color/colorPrimary`/`colorPrimaryDark`/`colorAccent` that resolve from AppCompat (app builds today); our change only ADDS window-background colors.

## Requirements

### #52 (native biometric passkey — unified PRF)

1. Native passkey **registration succeeds** on Android and iOS (18.4+).
2. Biometric unlock works **immediately after enabling** and on every subsequent unlock — no "first-time doesn't work" gap, on all platforms.
3. Use the reliable **enable-at-create + eval-at-assertion** PRF pattern; PRF eval salt encoded as **base64url string on native**, `BufferSource` on web; PRF _output_ normalized string→`ArrayBuffer` on native before HKDF.
4. Patch the `@capgo` plugin's **iOS Swift** to wire PRF (decode `extensions`, build registration/assertion PRF inputs, emit `clientExtensionResults.prf`), gated to **iOS 18.4+**; applied via `patch-package`, plugin version pinned.
5. Preserve the PRF family-key wrap + cross-device unlock; **do not orphan existing web-registered passkeys** (keep the fixed salt + HKDF info).
6. **Never surface a raw platform string.** Map `NoCreateCredentialException` / "no create options available" + a generic Credential Manager / ASAuthorization fallback to friendly copy (i18n en/beanie/zh); raw string only to telemetry. Fix the existing raw-`err.message` fallthrough.
7. **Gate the offer** so biometric is not offered where it can't be delivered (iOS < 18.4, no PRF support, or a prior device-local enable failure) — with a **defined, non-permanent reset path** for that suppression (Req 15).
8. **No silent failures**: the register wrap `catch {}` is removed; a failed/cancelled wrap/assert rolls the registration back and reports a `warning`.
9. Full unit-test + observability coverage so on-device (live-only) failures are triageable from CloudWatch without a local repro.
10. **The "enable failed" offer-suppression is recoverable, not sticky-forever** — it must clear on a condition the user can actually reach (see A6), so a transient failure (e.g. biometric not yet enrolled) never permanently hides the feature.
11. **The persisted registration record's `prfSupported` reflects the enable-only create + successful wrap** (sourced from `prf.enabled`/wrap success, never from a `results.first` check on the create response) so it stays `true` on native and propagates correctly to synced devices.

### #53 (Android status-bar band)

10. The top status-bar area shows the app background (theme-aware), not black, on the installed Android app.
11. Handle SDK ≥ 35 forced edge-to-edge correctly (do not fight it).
12. Keep status-bar icon contrast legible in both themes (preserve `setStyle`).
13. Preserve the existing safe-area (`env(safe-area-inset-*)`) + edge-to-edge groundwork.
14. **Native `windowBackground` and the web root background use one shared set of color values** — no seam between the pre-paint strip and the WebView — with a cross-reference comment in each location so the two never silently drift.

## Important Notes & Caveats

- **Live-only native testing.** No fix can be locally verified on device; the design must be correct-by-construction, unit-tested at the JS boundary, and observable. Greg verifies on the deployed build.
- **#52 enable flow — register(enable) → immediate assert(eval) → wrap → persist, at enable time.** Because eval-at-create is unreliable and PRF output is only reliably available at assertion, the ONLY way to guarantee biometric works on the _first_ unlock is to obtain the PRF output during the enable ceremony via an immediate assertion right after `create()`. This produces the `passkeySecret` at enable time, so the persist call-site (`App.vue:225`) is **unchanged** — the change is internal to `registerPasskeyForMember`. Cost: **one extra biometric prompt at enable** ("confirm once more to finish setting up"). The deferred-wrap alternative reintroduces the confusing "first biometric login fails to a password" UX greg rejected — explicitly NOT chosen.
- **Persist-after-success ordering (fresh-eyes robustness).** `savePasskeyRegistration` is deferred until **after** `establishPasskeyWrap` succeeds. This removes the current window where a registration is persisted (`:204`) before the wrap and would need to be reversed on failure — under the new flow nothing local is written unless the passkey is proven PRF-usable, so there is no partial-persist state and rollback of the app's local record becomes a no-op (see next note).
- **Rollback-on-wrap-failure invariant — precise scope.** If the immediate post-create assertion fails, is cancelled, or yields no PRF output, the enable is treated as **failed** and returns `{ success: false, error }` (friendly). With persist-after-success, there is normally **no local record to remove**; we still call `removePasskey(credentialId)` defensively (reuse existing, `passkeyService.ts:475`) to clear any local record if one was written. **Note the true scope:** `removePasskey` only clears the app's _local_ registration record — the actual platform credential created in Google Password Manager / iCloud Keychain **cannot be programmatically deleted by the app** (a WebAuthn platform limitation) and remains as a benign, unused passkey. The invariant is therefore precisely: **the app never retains a record of, nor offers unlock via, a passkey that is not PRF-usable** — no in-app limbo state. The orphaned platform credential is harmless (it is simply never referenced again).
- **iOS 18.4+ only** for PRF (data-loss bug in 18.0–18.3; PRF APIs are iOS 18+). Below 18.4 → no PRF → offer suppressed → password. Honest degradation, not breakage.
- **patch-package fragility is loud, not silent** — a failed patch fails the build (CI). Pin `@capgo/capacitor-passkey` to the exact installed version (`8.3.9`); open an upstream PR so the patch can eventually be dropped. **Keep the patch minimal and purely additive** (no reformatting of the vendor file, no touching unrelated lines) so it re-applies cleanly and reviews easily; put the upstream PR link + intent in a comment header at the top of the patched Swift block.
- **Sustainability boundary — one wrap helper, one salt source, one PRF-support predicate.** The enable-time wrap and the assertion-time unwrap must NOT each grow their own copy of the assert→eval→derive logic; the salt-encoding branch (native string vs web `BufferSource`) and the PRF-output normalization (string vs buffer) each live in exactly one function. This is a hard rule for this change — see A1/A2.
- **Do NOT change the fixed PRF salt** or the HKDF `info` — doing so orphans every existing web passkey.
- **#53 single source of truth for the background color.** Whatever value the native `windowBackground` uses MUST equal the running root's painted color. Recommended: keep the existing root (`bg-gray-50` → `#F9FAFB` light / `slate-900` → `#0f172a` dark) and set `colors.xml` to those exact hexes — zero web churn, zero seam. (If greg prefers the brand `#F8F9FA`/`#1a252f`, change the root class AND `colors.xml` together in the same commit.) Do not leave two different values. Because the value is physically duplicated (Tailwind class ↔ Android XML) and cannot be literally shared across the native/web boundary, **each site carries a short "keep in sync with <other file>" comment** so a future editor is warned before creating a seam.
- **Do NOT adopt `@capawesome/capacitor-android-edge-to-edge-support`** (greg's decision) — solve with native resources + the existing shell.

## Assumptions

> Review before implementation.

1. `@capgo/capacitor-passkey` is at `8.3.9` (installed, confirmed); its iOS Swift layer lacks `extensions` decoding (confirmed) — re-verify against the pinned version before patching.
2. The in-memory family key (`syncStore.familyKey`) is present whenever registration runs (guarded at `authStore.ts:1048`, confirmed).
3. Android Credential Manager accepts `extensions: { prf: {} }` (enable-only) at create and `{ prf: { eval: { first: "<base64url>" } } }` at get, returning `clientExtensionResults.prf` — per research, the reliable GMS path.
4. iOS 18.4+ `ASAuthorization` PRF APIs behave per Apple docs; on registration `ASAuthorizationPlatformPublicKeyCredentialRegistration.prf` exposes support (mapped to `clientExtensionResults.prf.enabled`) and on assertion `…Assertion.prf.first` exposes the eval output; the vast majority of active iPhones at launch are ≥ 18.4.
5. `styles.xml`'s existing `@color/colorPrimary` etc. resolve from AppCompat today (app builds); the fix only ADDS window-background colors (confirmed no local `colors.xml` to collide with).

## Approach

### Part A — #52 unified PRF biometric

**A1. Platform-aware PRF extension builders + single-source normalization (`passkeyCrypto.ts`).** Replace the single `buildPRFExtension()` with intent-specific, platform-aware helpers (one salt source, DRY):

- A private `prfSaltBytes()` returns the fixed 32-byte salt (unchanged value/derivation) — the **only** place the salt is constructed.
- `buildPRFEnableExtension()` → `{ prf: {} }` (used at create; no eval).
- `buildPRFEvalExtension()` → `{ prf: { eval: { first } } }` where `first` is a **base64url string on native** (`isNative()`), **`Uint8Array` on web**. The native/web branch lives **only here** — no caller re-decides encoding.
- **Single normalization function.** Add one private `normalizePRFOutput(raw: unknown): ArrayBuffer | null`: string → `base64urlToBuffer`; `ArrayBuffer`/`Uint8Array` → as-is (or `.buffer`); anything else → `null`. **Both** `getPRFOutput` and `isPRFSupported` call it (isPRFSupported = `normalizePRFOutput(...)?.byteLength ? true : false`). This kills the two-copy risk called out in root cause #4 and keeps the string↔buffer rule in one place.
- **DRY / no circular import:** import `bufferToBase64url` / `base64urlToBuffer` from the canonical **`@/utils/encoding.ts`** (exports confirmed present), NOT from `passkeyService.ts` (which imports `passkeyCrypto.ts` — reusing its copy would create a circular dependency). While editing this file, drop `passkeyCrypto.ts`'s private `bufferToBase64`/`base64ToBuffer` (`:127-143`) in favor of the shared `@/utils/encoding.ts` exports so we don't keep a 3rd/4th copy. (`passkeyService.ts:623-649`'s exported copies are consumed by other callers — leave those for the separately-tracked consolidation; do not add to them.)

**A2. Registration = enable → immediate assert → wrap → persist, via one extracted helper (`registerPasskeyForMember`).**

- **Extract the wrap ceremony into a single private helper** `establishPasskeyWrap(credentialId: base64url, familyKey: CryptoKey): Promise<PasskeySecret | null>` that: does the immediate `navigator.credentials.get` with `buildPRFEvalExtension()` restricted to the just-created credential (`allowCredentials: [{ id: rawId, type: 'public-key' }]`), reads + normalizes the PRF output, runs `deriveWrappingKey → wrapDEK`, and returns the `PasskeySecret` or `null` (null on cancel/no-PRF/throw — it returns null and lets the caller decide + report, swallowing nothing silently). This keeps `registerPasskeyForMember` **flat**: create → check `prf.enabled` → `establishPasskeyWrap` → branch once on the result. It also gives a single reusable unit under test and a future re-wrap seam.
- `registerPasskeyForMember` body (guard-clause style, no new nesting depth):
  1. Create with `extensions: buildPRFEnableExtension()`; existing `NotAllowedError`→cancelled handling unchanged.
  2. If `getClientExtensionResults().prf?.enabled !== true` → rollback + `warning` + friendly failure (guard/return).
  3. `secret = await establishPasskeyWrap(credentialId, familyKey)`; if `null` → rollback + `warning` + friendly failure (guard/return).
  4. **Only now** build the `PasskeyRegistration` record with **`prfSupported: true`** (sourced from the confirmed `prf.enabled` + successful wrap — **not** from `isPRFSupported()` on the create response, which under enable-only create lacks `results.first`; root cause #9 / Req 16) and `await passkeyRepo.savePasskeyRegistration(registration)`.
  5. Return `{ success: true, prfSupported: true, passkeySecret: secret }`.
- **Remove the silent `catch {}`** (root cause #6). The single failure/rollback path is: `removePasskey(credentialId)` (defensive; normally a no-op because persist is deferred), `reportError({ surface:'passkey-register', severity:'warning', context:{ os, stage, os_version, detail } })`, return `{ success:false, error: <friendly> }`. **One** rollback block, reached from both guard points — not duplicated.
- **Second-prompt cancel is a first-class failure, not a crash.** If the user cancels the immediate assertion, `establishPasskeyWrap` returns `null` → the same rollback path runs (reliability: no half-registered credential recorded, no unhandled rejection).
- `retryRegistrationWithFallbacks`: keep the drop-`authenticatorAttachment` retry (fallback 1); **remove the drop-PRF retry (fallback 2)** — a non-PRF passkey is now useless, so exhausting PRF is a clean failure + password fallback, never a silent non-PRF passkey. (Removing fallback 2 also _reduces_ this function's branching — a net simplification.)

**A3. Assertion unchanged in shape** — `authenticateWithPasskey` continues to eval PRF at get (now via `buildPRFEvalExtension()`) and unwrap via `tryUnwrapFamilyKeyFromPRF`. Existing web passkeys unwrap exactly as before (fixed salt + `normalizePRFOutput` passes `ArrayBuffer` through unchanged). The `NotReadableError → retry without extensions` branch (`:290-299`) stays (web/Android resilience) but on the retry path PRF is simply absent → falls through to password, which is correct.

**A4. iOS Swift patch (`patch-package`).** Add `patches/@capgo+capacitor-passkey+8.3.9.patch`:

- Decode an `extensions` object (typed PRF sub-struct) on `PasskeyRegistrationRequestJSON` / `PasskeyAssertionRequestJSON`.
- Registration: if `extensions.prf` present and `#available(iOS 18.4, *)`, set the registration PRF input **enable-only** (`.checkForSupport`) on the request built in `buildRegistrationRequest` (`:270-300`) — mirroring the existing `#available(iOS 17.4)` origin pattern at `:283`.
- Assertion: if `extensions.prf.eval.first` (base64url) present and `#available(iOS 18.4, *)`, decode + set the assertion PRF **eval** input salt on the request built in `buildAssertionRequest` (`:302-329`).
- `serializeRegistration` (`:343-355`): emit `clientExtensionResults.prf.enabled` from the registration's PRF support output (replacing the hard-coded empty `JSObject()` at `:349`).
- `serializeAssertion` (`:357-373`): emit `clientExtensionResults.prf.results.first` as base64url from the assertion PRF output (replacing `:370`).
- Below iOS 18.4 / unsupported: leave `clientExtensionResults` empty → app treats as PRF-unavailable → offer suppressed.
- **Keep the diff minimal and additive** (no reformatting/reordering of untouched vendor code) so it survives minor plugin bumps and is reviewable; header-comment the upstream PR link + rationale. Add `patch-package` dev dep + `postinstall`; **pin** the plugin to `8.3.9` exactly. File an upstream PR referencing this patch.

**A5. Error mapping (`passkeyService.ts` + `uiStrings.ts`).** In `formatCredentialManagerError`: add a `NoCreateCredentialException` / "no create options available" case, keep the existing `NotReadableError`/`NotSupportedError`/`SecurityError` cases, and **change the default branch to return a friendly generic Credential Manager / ASAuthorization string (via `t()`) instead of `err.message`** — the raw string goes only to `reportError` `context.detail`. Reuse the _existing_ single `reportError` in this function (do not add a parallel report). All new copy via `t()` (en + beanie + zh). Errors reach the user only through the existing `useToast` call sites — no new UI.

**A6. Offer gating with a recoverable suppression (`canOfferBiometric()` helper + one PRF-support predicate + `App.vue` gate).**

- Extract a single predicate `platformSupportsPRF(): boolean` — the **only** place the "Android, or iOS ≥ 18.4" rule lives (mirrors the Swift `#available(iOS 18.4)` gate; keep them commented as a matched pair). Do not inline the version check anywhere else.
- `canOfferBiometric()` (testable helper in `passkeyService.ts`): offer only when `isPlatformAuthenticatorAvailable()` AND `platformSupportsPRF()` AND the per-device suppression is not active. `App.vue:1358` calls this instead of `isPlatformAuthenticatorAvailable()` directly. Web unchanged.
- **Suppression is recoverable, not sticky-forever (Req 15).** On a native enable failure, persist a per-device suppression record in localStorage (do NOT sync) as `{ suppressedUntil: <timestamp> }` rather than a permanent boolean. `canOfferBiometric()` treats it as active only while `now < suppressedUntil`. Use a short cool-off (e.g. 24h) so a transient cause (biometric not yet enrolled, one-off Credential Manager hiccup) self-heals and the user is offered biometric again next day, without a hidden reset gesture or a support ticket. A successful enable clears the record entirely. This avoids the classic "feature silently disappeared forever and no one knows why" supportability trap. Document the key name + shape in a comment next to the helper. (Security note: this record only _hides an offer_; it can never grant access, is not synced, and tampering with it at worst re-shows or hides the offer — no security surface.)

### Part B — #53 Android status-bar background (theme-aware)

**B1. Native cold-start / inset default (the actual fix).** Add `android/app/src/main/res/values/colors.xml` (`windowBackground` = the light hex) + `android/app/src/main/res/values-night/colors.xml` (the dark hex), using the **same values the web root paints** (recommended `#F9FAFB` / `#0f172a`; see caveat). Set `android:windowBackground = @color/windowBackground` on `AppTheme.NoActionBar` (currently `android:background=@null`) — its `DayNight` parent auto-selects `values-night`. This paints the correct color during splash→app transition and any inset/unpainted region, following **system** dark mode. Each `colors.xml` carries a comment: `<!-- keep in sync with App.vue root bg-gray-50 / dark:bg-slate-900 -->`.

**B2. Running-app correctness — already in place (verify, don't rebuild).** The root element already carries the theme-aware background (`App.vue:1380` `bg-gray-50 dark:bg-slate-900`, driven by the in-app `dark` class), so the edge-to-edge WebView already paints the app color behind the status bar and tracks the **in-app** theme. No new CSS/native bridge is needed here — only confirm the root remains full-bleed (safe-area `padding-top` stays on the inner content column) and add the reciprocal `<!-- keep in sync with android .../colors.xml -->` comment on the root class. If the color source-of-truth is changed per the caveat, update this class + both `colors.xml` in the same commit.

**B3. Preserve** `MainActivity` edge-to-edge + `useNativeShell` `setOverlaysWebView` + `setStyle` (icon contrast). No regression to safe-area.

**B4. Residual-mismatch caveat.** If greg's on-device diagnostic shows the WebView is **inset** (not drawing under the status bar) AND a user picks an in-app theme opposite to system, a residual mismatch could remain (strip = system-selected `values-night` color; app = in-app-overridden color). Documented as a known follow-up; the increment would be a minimal native `setWindowBackgroundColor(hex)` method wired into `useNativeShell`'s existing theme observer. Not built now unless the diagnostic proves it necessary. (Deliberately deferred to avoid adding a native theme-sync bridge the app doesn't yet need — keep the surface small until evidence demands it.)

## Files Affected

**#52**

- `src/services/auth/passkeyCrypto.ts` — platform-aware PRF builders (single salt source + single native/web encoding branch); one shared `normalizePRFOutput` feeding both `getPRFOutput`/`isPRFSupported`; import encoders from `@/utils/encoding.ts` (drop private copies).
- `src/services/auth/passkeyService.ts` — extract `establishPasskeyWrap` helper; register(enable)→assert(eval)→wrap→**persist-after-success** flat/guard-clause flow with one rollback path (incl. second-prompt-cancel); set record `prfSupported` from `prf.enabled`/wrap success (Req 16); remove silent wrap `catch`; rollback via existing `removePasskey`; remove drop-PRF fallback; friendly default in `formatCredentialManagerError`; `platformSupportsPRF()` + `canOfferBiometric()` (recoverable suppression); telemetry.
- `src/App.vue` — offer gate at `:1358` uses `canOfferBiometric()` (persist site `:225` unchanged).
- `src/services/translation/uiStrings.ts` (+ `zh.json`) — friendly error copy (en/beanie/zh).
- `patches/@capgo+capacitor-passkey+8.3.9.patch` (NEW) — iOS PRF wiring (minimal/additive).
- `package.json` — pin plugin to `8.3.9`; add `patch-package` + `postinstall`.
- `src/services/auth/__tests__/passkeyService.test.ts` + NEW `passkeyCrypto.test.ts` — see Testing.
- `src/utils/diagnosticContext.ts` `ALLOWED_CONTEXT_KEYS` — new context keys (see Observability).
- **Lambda-side context allowlist + its pinned test** — MIRROR the new keys (the repeated in-repo instruction: "MIRROR this in the Lambda allowlist + its pinned test when adding a key here").
- `docs/runbooks/native-store-submission.md` + store-declaration consumers (`PrivacyInfo.xcprivacy`, store Data-Safety/App-Privacy, `privacy.astro`) — declare the new diagnostics keys.

**#53**

- `android/app/src/main/res/values/colors.xml` (NEW) + `android/app/src/main/res/values-night/colors.xml` (NEW) — each with keep-in-sync comment.
- `android/app/src/main/res/values/styles.xml` — `android:windowBackground` on `AppTheme.NoActionBar`.
- `App.vue:1380` root class — add reciprocal keep-in-sync comment (and, only if the color source-of-truth is changed per the caveat, the class values themselves).
- `CHANGELOG.md` — #53 is user-facing (Fixed).

## Observability Coverage

New/changed diagnostics so live-only failures are triageable from CloudWatch alone:

- **Surface `passkey-prf`** (kebab-case, new), `logEvent` info on the decision/outcome path:
  - `prf_enable_result` at create — `context: { os, prf_enabled }`.
  - `prf_eval_result` at the enable-time assertion and at each unlock — `context: { os, has_prf_output, credential_source }`.
  - `wrap_established` at enable — success counter (enable-success _rate_ measurable), `context: { os }`.
  - `unwrap_result` at unlock — `context: { os, unwrap_ok }` (success path emitted too).
- **`reportError` `warning`** (firehose, no page — password fallback exists) on: enable-but-`prf.enabled===false`; immediate-assert/wrap failed or cancelled → rolled back (`context: { os, stage, os_version, detail }`); unwrap failed → password fallback. Raw platform error string goes in `context.detail`, never to the user. Reuse the **existing** `reportError` call sites (`passkey-register` `:173`, `passkey-assertion` `:688`) — do not add parallel reporters.
- **`detail` is length-capped and content-bounded.** `context.detail` carries only `Name: message`-shaped strings (via the existing `describeAuthError`), **truncated to ~300 chars**, never raw objects/PII/tokens — so a free-form string key can't silently become a leak vector or a log-bloat source over time. Note this bound in the allowlist comment.
- **Reserve `severity: 'critical'`** for none of these (biometric always has a password fallback; no data loss).
- **Context-key allowlisting (corrected).** Reuse the already-allowlisted **`os`** for platform (do NOT introduce a separate `platform` key — note `platform` is passed by _existing_ passkey `reportError` calls but is **not** in `ALLOWED_CONTEXT_KEYS`, so it is silently stripped today; this plan standardizes on `os`). Add the genuinely new keys to `ALLOWED_CONTEXT_KEYS` in `diagnosticContext.ts`: `prf_enabled`, `has_prf_output`, `wrap_established`, `unwrap_ok`, `credential_source`, `stage`, `os_version`, `detail`. All are booleans / enums / os-version / bounded string — no secrets/tokens/PII. **MIRROR every added key in the Lambda allowlist + its pinned test** (per the in-repo instruction), AND declare them in `docs/runbooks/native-store-submission.md` + its consumers.
- **Existing surfaces** `passkey-register` / `passkey-assertion` / `passkey-shim-init` retained; the new events add the success/rate signal they lack today.
- **#53** is a native resource + (already-present) CSS change with no runtime JS decision path → no new telemetry; it preserves the existing (untelemetried) `useNativeShell` calls. (Noted per the always-assess rule.)

## Acceptance Criteria

- [ ] Fresh Play-signed Android build AND iOS (18.4+) build: enabling biometric succeeds; unlock works on the **first** attempt and every attempt after.
- [ ] PRF family-key wrap is correct; cross-device unlock preserved; existing web passkeys still unlock (fixed salt + info unchanged).
- [ ] `getPRFOutput`/`isPRFSupported` share one `normalizePRFOutput` and correctly handle a base64url-string `results.first` (native) and an `ArrayBuffer` (web).
- [ ] The persisted registration record has `prfSupported: true` on a successful native enable (sourced from `prf.enabled`/wrap success), and that value propagates to synced credentials.
- [ ] Registration is persisted only after a successful wrap; a failed/cancelled wrap leaves no local record (rollback is a no-op locally) and never an offered-but-unusable passkey.
- [ ] No raw Credential Manager / ASAuthorization string ever shown — friendly copy + password fallback (en/beanie/zh); the `err.message` fallthrough is gone.
- [ ] No silent failure on enable: wrap/assert failure OR second-prompt cancel rolls back (one code path) and reports a `warning`.
- [ ] Offer hidden on iOS < 18.4 and during an active per-device suppression; suppression is time-boxed and **auto-clears** (and clears on next successful enable) — never permanent.
- [ ] iOS Swift patch applies via `patch-package`; build fails loudly if it doesn't; patch is minimal/additive; plugin pinned to `8.3.9`; upstream PR opened.
- [ ] #53: on a fresh Android build the status-bar area shows the app background (theme-aware), not black; **no seam** between the pre-paint strip and the WebView (matched colors + keep-in-sync comments present); icon contrast legible in both themes; safe-area preserved.
- [ ] Full unit suite green; type-check + lint + Lambda tests + `npm run translate` clean.
- [ ] New context keys allowlisted **in both the client and Lambda allowlists** (+ pinned tests), `detail` bounded, and store-declared; failure modes triageable from CloudWatch without a local repro.
- [ ] greg-verified on device (Android + iOS) on the deployed build.

## Testing Plan

1. **`passkeyCrypto.test.ts` (NEW):** `buildPRFEvalExtension` returns a **base64url string** salt on native and a `Uint8Array` on web (mock `isNative()`); `buildPRFEnableExtension` returns `{prf:{}}`; salt value/length is the fixed 32 bytes; `normalizePRFOutput`/`getPRFOutput` normalize a base64url-string `results.first` to the same `ArrayBuffer` as a native round-trip, and pass an `ArrayBuffer` through unchanged; `isPRFSupported` is true for both string and buffer inputs, false for empty/absent (drives the _same_ shared normalizer); wrap→unwrap round-trip with a known PRF output.
2. **`passkeyService.test.ts` (extend):** `establishPasskeyWrap` returns a `PasskeySecret` on the happy path and `null` on assert-throw / no-PRF / second-prompt-cancel; register happy path produces a `passkeySecret`, persists the record **only after** wrap success, and the persisted record has `prfSupported:true` even though the create response carries no `results.first`; the single rollback path calls `removePasskey` + reports `warning` + returns `success:false` (no local record persisted, no silent `success:true`) when `establishPasskeyWrap` returns null or `prf.enabled` is false; drop-PRF fallback is gone; `NoCreateCredentialException` maps to friendly copy (not raw) and the default branch never returns `err.message`; `platformSupportsPRF()` is false on iOS<18.4/true on Android; `canOfferBiometric()` suppresses while `now < suppressedUntil` and **re-offers once the cool-off elapses** and after a successful enable; existing web passkey still unwraps at assertion with the unchanged salt. Mock the `navigator.credentials` shim boundary.
3. **i18n:** `npm run translate`; assert all new error keys have en/beanie/zh.
4. **iOS Swift patch:** cannot be JS-unit-tested; verified by (a) build applies the patch, (b) observability events on-device, (c) greg's on-device enable+unlock on iOS 18.4+.
5. **#53:** greg installs the fresh Android build, confirms no black band in light + dark (in-app toggle), confirms **no seam** + icon contrast + safe-area intact; optionally runs the chrome://inspect diagnostic to record WebView-inset vs edge-to-edge for the B4 caveat.
6. Full `npm run test:unit`, `type-check`, `lint`, Lambda tests green pre-push.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the unified-PRF approach (enable→immediate-assert→wrap at enable time, base64url native salt, iOS Swift patch, error mapping, offer gating, observability) + the theme-aware Android window/root-background fix.
- **Pass 2 (DRY + error handling)**: Verified reuse against code. Corrected encoder-reuse to `@/utils/encoding.ts` (circular-import + duplicate removal); elevated `getPRFOutput`/`isPRFSupported` native-string normalization to a required fix; made the silent wrap `catch {}` removal + rollback (existing `removePasskey`) explicit; fixed the raw-`err.message` fallthrough; established #53's running-root paint is already theme-aware (B2 verify-only) + added the color source-of-truth/seam guard (Req 14); added the missing Lambda-allowlist mirror + corrected `platform`→`os`; pinned reuse of `useToast` (no new error UI).
- **Pass 3 (Sustainability)**: De-nested register via one `establishPasskeyWrap` helper + single rollback path; collapsed string↔buffer logic into one shared `normalizePRFOutput`; centralized the salt native/web branch and the "Android/iOS≥18.4" rule in a single `platformSupportsPRF()` predicate; replaced the sticky-forever suppression boolean with a self-healing time-boxed `suppressedUntil` (new Req 15) + made second-prompt-cancel a first-class rollback; bounded the `detail` telemetry key; constrained the iOS patch to minimal/additive with an upstream-link header; added reciprocal keep-in-sync comments for the duplicated #53 colors. Net includes _removing_ branching (drop-PRF fallback 2).
- **Pass 4 (Fresh-eyes sweep)**: Re-verified the four highest-risk areas directly against source (immediate assertability + deterministic PRF; no existing-web-passkey regression with byte-path evidence; correct iOS enable-vs-eval wiring against the actual Swift; no security surface for the localStorage suppression). Caught two real gaps the enable-only-create switch introduces: (1) `registration.prfSupported` was still derived from `isPRFSupported()` on the create response, which under `{prf:{}}` lacks `results.first` → would persist/propagate `false` (added root cause #9, Req 16, and the explicit source-from-`prf.enabled` step in A2.4); (2) tightened the flow to persist-after-wrap-success so no partial local record exists on failure, and clarified the precise rollback-invariant scope (the platform credential in GMS/Keychain cannot be app-deleted — the invariant is about the app's records/offers). Added matching acceptance + test assertions. Rest of the plan is solid.

## Prompt Log

> No GitHub issue created — direct implementation. Full prompt history:

<details>
<summary>Full prompt history</summary>

### Initial (pre-plan handoff, /beanies-plan)

"go ahead with a plan to implement both issues" — batched joint prompt for Notion #52 + #53 (assembled by /beanies-pre-plan; both native-only, next mobile build).

### Follow-up — approach clarification

"what is the difference between approach 1 and approach 2?" (for #52)

### Follow-up — decision

"let's go wth plan 2 because authentication is critical and not being able to open the app with biometric on login just because it's your first time to open (especially if you've opened before) is a confusing UX. Confusing, from a security perspective = lose trust. we should avoid this. let's do the proper comprehensive and holistic research to understand the feasibility and details of implementing option 2 so that biometrics works consistently and reliably across all devices and scenarios"

### Follow-up — iOS feasibility discussion

"not sure, it should work on both, which approach do you recommend?"

### Follow-up — final direction

"go with A, fold both issues into one plan, and also ok with the theme aware background paint for #53"

### Follow-up — approve + implement

"approve and implement"

</details>
