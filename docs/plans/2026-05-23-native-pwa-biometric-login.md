# Plan: Biometric (passkey) login across native apps + PWA + browser — one implementation, every platform

> Date: 2026-05-23 · Related issues: None — direct implementation
> On approval, this is saved to `docs/plans/2026-05-23-native-pwa-biometric-login.md` (project convention) and `.draft-native-biometric.md` is removed.
> Built via the 4-pass `/beanies-plan` discipline (records at the end).

## Context

Native Android biometric login is broken and Settings shows "your browser does not support biometric login (WebAuthn)". beanies already has a complete, well-built WebAuthn/passkey stack on web+PWA — PRF extension → HKDF → AES-KW unwrap of the family key, a three-tier unlock (PRF → cached family-key on a trusted device → password), cross-device sync (iCloud/Google), the Signal API, progressive registration fallbacks. **The crypto/envelope design is sound and is reused unchanged; this is about making that same machinery run inside the Capacitor WebView and hardening capability messaging so the experience is consistent everywhere.**

Two confirmed native root causes (same `https://localhost`-origin family as the just-fixed OAuth issue, ADR-029): (1) the Android WebView doesn't expose `window.PublicKeyCredential` unless the app opts in via `androidx.webkit`; (2) `rpId = window.location.hostname` resolves to `localhost`, which can't match the PWA passkey's RP ID (`app.beanies.family`). WebAuthn can't be CORS-allowlisted away — it needs platform association (Digital Asset Links on Android, AASA on iOS).

**Honest framing of "all devices, newer & older":** WebAuthn/passkeys are a platform credential API and **cannot be polyfilled**. "Consistent across all devices" = a consistent _experience_: passkey-capable devices get one-tap biometrics; every other device falls back **cleanly** to password — never a broken/confusing state. This plan defines those tiers; it does not put passkeys on platforms that lack them.

**Chosen approach: WebView-WebAuthn** — enable WebAuthn in the native WebView and reuse the existing JS passkey stack via a small `getRpId()` seam + native association. **Rejected alternative:** a native Capacitor passkey plugin (Credential Manager/ASAuthorization bridge) — it forks the `navigator.credentials` surface, likely loses the PRF extension the family-key design depends on, and adds a security-sensitive dependency. Revisit only if WebView-WebAuthn proves unworkable on target devices.

## User Story

As a member, I want to unlock my pod with device biometrics (Face ID / Touch ID / fingerprint / PIN) in the native app, the installed PWA, and the browser alike — and on devices that can't do passkeys, be cleanly returned to my password rather than hit a dead end.

## Requirements

1. Native Android biometric login works end-to-end (register in-app → unlock on next sign-in), reusing the existing PRF/family-key machinery.
2. iOS native readiness: all iOS config (Associated Domains + AASA) in place; on-device validation deferred to the first iOS build (none exists yet).
3. PWA + browser biometric unchanged — **zero regression**; existing passkeys keep working with no re-enrollment; dev (`localhost:5173`) + self-hosters keep working.
4. A cross-platform RP-ID strategy that works on web origin `app.beanies.family` AND the native `localhost` WebView origin **without invalidating existing credentials**.
5. Accurate capability tiering + graceful password fallback on every surface — never "your browser doesn't support…" inside a native app.
6. No silent failures: native-config / capability / assertion / unwrap failures each surface a user message + a developer breadcrumb.
7. PRF-uncertainty resilience on native: Android Credential Manager PRF support isn't guaranteed; the cached-key + password fallbacks must cover the no-PRF case (the existing cross-device path already does).
8. Digital Asset Links / AASA hosted on the correct origins.

## Important Notes & Caveats

- **Reuse, don't rewrite.** `passkeyService.ts`, `passkeyCrypto.ts`, the `passkeyWrappedKeys` envelope path, the three-tier unlock, cross-device handling, the Signal API all stay. The substantive JS change is a single `getRpId()` seam + a copy reword. Everything else is native project config.
- **RP ID must NOT change for existing web users.** Current passkeys registered with `rpId = window.location.hostname = 'app.beanies.family'`. `getRpId()` MUST keep returning `app.beanies.family` on the prod PWA (a no-op for web). Changing it to the apex would silently orphan every existing passkey. **(Pass 4 verified: RP-ID unchanged ⇒ no orphaned credentials.)**
- **RP ID is origin-derived on web, association-authorized on native.** Web → must be the origin's registrable domain (`app.beanies.family` prod, `localhost` dev). Native → WebView origin is `localhost` but the Digital-Asset-Links/AASA association authorizes the app to assert RP ID `app.beanies.family`. That association _is_ the mechanism.
- **WebAuthn assetlinks lives on `app.beanies.family` (the Vue app's bucket), not the apex.** The existing App-Link `assetlinks.json` is in `web/public/.well-known/` → served from `beanies.family` (Astro, `handle_all_urls`). WebAuthn needs `delegate_permission/common.get_login_creds` on the **RP-ID domain** `app.beanies.family` → a NEW `public/.well-known/assetlinks.json` in the **Vue app** (its `public/` currently holds only `security.txt`). Same package + fingerprint, different relation/origin/deploy target.
- **Two assetlinks files now exist on two origins — keep fingerprints in sync.** At every signing-key event (debug keystore rotation, release/upload key, Play App Signing, a future second app) BOTH files must be updated together or native auth breaks silently on the un-updated origin. Document in an adjacent README. (The apex file currently lists only the debug fingerprint — confirm whether release must be added there too; pre-existing, don't expand.)
- **Android WebView WebAuthn needs a recent System WebView** (`WebViewFeature.WEB_AUTHENTICATION`). Feature-detect in native code; older WebViews → graceful Tier-3 fallback, never a crash.
- **`server.hostname` is intentionally NOT changed.** Keep the WebView at `https://localhost` (preserves the just-shipped OAuth `https://localhost` CORS fix) and rely on association. Do not repoint the WebView origin.
- **`attestation: 'none'` stays** (self-relying-party, no server-side attestation). Enable WebAuthn app-scoped (`WEB_AUTHENTICATION_SUPPORT_FOR_APP`), never `…_FOR_BROWSER`.
- **iOS can't be fully validated this cycle** (no iOS build). Config is shipped + documented; iOS acceptance gates on replacing the `<APPLE_TEAM_ID>` placeholder.

## Assumptions (verify before/at implementation)

1. Prod PWA serves at `app.beanies.family`; existing passkeys' RP ID is `app.beanies.family`. Verify no users still hold passkeys under the pre-cutover apex (pre-existing concern if so; don't expand scope).
2. The app signing-cert SHA-256 fingerprints are known (debug `19:E4:…` for testing; release for prod) and match what the WebAuthn assetlinks lists.
3. **The app deploy currently does NOT ship hidden files** — `deploy.yml`'s `upload-artifact@v7` (`:176-181`) lacks `include-hidden-files: true`, so `dist/.well-known/` is silently stripped before `aws s3 sync` (the apex `deploy-web.yml:49` was fixed; the app deploy wasn't). This plan adds the fix; verify live with `curl -sI https://app.beanies.family/.well-known/assetlinks.json` → 200, `application/json`.
4. greg's Pixel 10 Pro (Android 16) supports `WebViewFeature.WEB_AUTHENTICATION` — verify on-device.
5. PRF via Android Credential Manager is **uncertain** — plan does not depend on it; verify empirically whether PRF round-trips (if yes, native gets full unwrap; if no, biometric verifies the member and cached-key/password completes — both acceptable).

## Approach

### Part 1 — JS seam: a single `getRpId()` (the only substantive JS logic change)

- Add `getRpId()` **co-located in `passkeyService.ts`** (one consumer, one file — no `webauthnConfig.ts` module).
  - **Web** (`!isNative()`): return `window.location.hostname` verbatim (zero change for web/dev/self-host).
  - **Native** (`isNative()` from `@/services/sync/capabilities`): return a module-local `const WEBAUTHN_RP_ID = 'app.beanies.family'` declared next to `RP_NAME` (`:25`). **Do NOT** source it from `features.ts` `CLOUD_HOSTS` (that gates `getDeploymentMode()` — unrelated deployment infra; coupling auth's RP-ID to it is the wrong dependency). **Do NOT** add `VITE_WEBAUTHN_RP_ID` (RP-ID is fixed product infra tied to the assetlinks/AASA we host, not a per-deploy knob). `features.ts` is **not touched**.
- Replace the three `window.location.hostname` WebAuthn sites — registration `:84`, assertion `:218`, Signal API `:444` (grep-confirmed the ONLY rpId sites) — with `getRpId()`. That is the entire RP-ID change.

### Part 2 — Capability detection & tiering (honest, native-aware)

- After Part 3 enables WebAuthn, `window.PublicKeyCredential` becomes defined on capable native devices, so the **existing** `isWebAuthnSupported()` / `isPlatformAuthenticatorAvailable()` checks Just Work — **no JS capability rewrite, no `isNative()` branch in `PasskeySettings.vue`**. The change is purely copy:
  - **Reword the existing `passkey.unsupported` key** (`uiStrings.ts:3128`, currently `'Your browser does not support biometric login (WebAuthn).'`, rendered at `PasskeySettings.vue:110` under `v-if="!supported"`) to be **surface-neutral** — e.g. en: `"Biometric unlock isn't available on this device. Use your password to sign in."` Provide `{en, beanie}` only — `zh`/other locales are auto-generated by the translation pipeline (matches the existing `passkey.*` entries); do not hand-author them. Drop the word "browser" and any hardware-capability absolute.
  - Leave `passkey.noAuthenticator` (`:3114`, "No biometric authenticator detected on this device", rendered at `:149`) — already native-safe.
- **Capability ladder (documentation of existing checks, NOT a code construct — no `Tier` enum/resolver):**
  - Tier 1 — passkey + PRF: full one-tap unwrap (modern web; native iff Credential Manager supplies PRF).
  - Tier 2 — passkey, no PRF: biometric verifies the member; family key from cached-key (trusted device) or password (the existing cross-device path).
  - Tier 3 — no platform authenticator / old WebView / iOS<16 / old browser: password only + the surface-neutral message.
  - _Consequence to accept:_ a Tier-3 native device (capable hardware, WebView lacking `WEB_AUTHENTICATION`) shows the same reworded `passkey.unsupported` copy as an old browser — intentional, hence the surface-neutral wording. New capability behavior belongs in the existing checks; reconsider an abstraction only if a genuine 4th path emerges.

### Part 3 — Android native enablement

- Add `androidx.webkit` (≥ 1.12.1) to `android/app/build.gradle`.
- In `MainActivity.java` (currently bare `BridgeActivity`): feature-detect `WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)` and, if supported, `WebSettingsCompat.setWebAuthenticationSupport(webSettings, WEB_AUTHENTICATION_SUPPORT_FOR_APP)`. If unsupported, no-op (JS sees no `PublicKeyCredential` → Tier-3 fallback). Wrap in try/catch with `Log.w(...)` on failure (developer breadcrumb — JS can't observe native enablement) — never crash the Activity.
- Add **WebAuthn Digital Asset Links** as a NEW `public/.well-known/assetlinks.json` in the Vue app: `delegate_permission/common.get_login_creds`, `package_name: family.beanies.app`, matching SHA-256 fingerprint(s) (debug `19:E4:…` for testing; release for prod). The apex App-Link file stays as-is.
- **Fix the deploy artifact strip (critical):** add `include-hidden-files: true` to the `actions/upload-artifact@v7` step in `.github/workflows/deploy.yml` (`:176-181`). Without it the new `assetlinks.json` (and the AASA) are silently dropped from the CI artifact → 404 → association silently fails → native biometrics silently never appear.

### Part 4 — iOS native readiness (config now, validate at iOS build)

- Add the **Associated Domains** entitlement `webcredentials:app.beanies.family` to the iOS project (once `npx cap add ios` scaffolding exists).
- Host an **AASA** at `https://app.beanies.family/.well-known/apple-app-site-association` (HTTP 200, no `.json` extension, `application/json`), `webcredentials.apps: ['<APPLE_TEAM_ID>.family.beanies.app']` — commit with an explicit `<APPLE_TEAM_ID>` placeholder + comment. A placeholder file on the live origin is harmless (iOS won't match it) and safe to deploy now, but iOS WebAuthn silently never associates until it's replaced — so the iOS acceptance criterion gates on substituting the real team ID. Add to the Vue app `public/.well-known/`.

### Part 5 — Error handling & messaging (no silent failures)

- Native WebView enablement failure → `Log.w(...)` in `MainActivity` + graceful Tier-3 fallback.
- **Error classification is already complete for native — do not extend it.** `formatCredentialManagerError()` (`:609`) already maps `NotReadableError`/`NotSupportedError`/`SecurityError`, and the `NotReadableError` PRF-strip retry (`:237`) was added for the Android Credential Manager case. `NotAllowedError` is deliberately handled as `cancelled` (`:118`/`:247`) and must NOT be folded in. **The one real gap:** zero developer breadcrumbs in `passkeyService.ts`. Add a single `reportError()` in `formatCredentialManagerError`'s fallthrough/unknown-error branch (`:621`): `reportError({ surface: 'passkey-assertion', message, error: err, severity: 'warning', context: { domException: (err as DOMException).name, platform: getPlatform() } })` (import `getPlatform` from `@/services/sync/capabilities`). `warning` because the password fallback still completes; `errorReporter.ts`'s reentry-guard + 60s dedup cover floods. Do NOT report the known/`cancelled` cases (de-noised, triage 2026-05-02).
- A failed family-key unwrap on native (no PRF, no cache) lands on the password prompt — the existing cross-device partial-success path (`memberId`-only result → `crossDeviceContext` + `passkey.crossDeviceNoCache` in `BiometricLoginView.vue`) is platform-agnostic and already does this; verify it triggers on native.
- Settings: reword the misleading "unsupported" copy (Part 2).

## Files Affected

- `src/services/auth/passkeyService.ts` — add `const WEBAUTHN_RP_ID` next to `RP_NAME` (`:25`); add `getRpId()`; replace 3× `window.location.hostname` (`:84/:218/:444`); add one `reportError()` in the `formatCredentialManagerError` fallthrough (`:621`).
- `src/services/translation/uiStrings.ts` — reword `passkey.unsupported` (`{en, beanie}` only).
- `android/app/build.gradle` — `androidx.webkit` dependency.
- `android/app/src/main/java/family/beanies/app/MainActivity.java` — feature-detected `setWebAuthenticationSupport` + `Log.w` on failure.
- `public/.well-known/assetlinks.json` — **NEW** (Vue app / app.beanies.family), WebAuthn `get_login_creds`.
- `public/.well-known/apple-app-site-association` — **NEW** (Vue app), iOS `webcredentials` with `<APPLE_TEAM_ID>` placeholder.
- `public/.well-known/README.md` — **NEW** documenting the two-origin assetlinks + fingerprint-sync discipline (mirror/reference `web/public/.well-known/README.md`).
- `.github/workflows/deploy.yml` — `include-hidden-files: true` on `upload-artifact@v7` (`:176-181`). _(No other workflow files; no env-var plumbing.)_
- iOS project entitlements (Associated Domains) — once iOS scaffolding exists.
- `src/config/features.ts` — **NOT touched** (RP-ID self-owned in `passkeyService.ts`).
- Tests: `passkeyService` (`getRpId()` native vs web), existing passkey suite stays green, `PasskeySettings` reworded copy renders.

## Help Center Coverage

- **Action**: update existing (or new if none) · **Category**: `security` · **Type**: how-to/explainer
- **Slug**: existing biometric/passkey article in `web/src/…/help/security/…`, or new `biometric-login`
- **Title**: "Unlock with biometrics (Face ID, fingerprint, device PIN)"
- **Scope**: how to enable biometric unlock; works in the app and the browser; it's a convenience layer over your family password (the password is always the fallback — losing the device ≠ losing the pod); honest device requirement (recent Android/iOS; older devices use the password); privacy story (biometrics never leave the device; beanies only ever sees the wrapped key); a passkey set up on one device syncs to the same platform's other devices (iCloud/Google) but not across ecosystems.

## Acceptance Criteria

- [ ] Native Android: register a passkey in-app → sign out → biometric unlock → pod opens (PRF) or falls back cleanly to password (no-PRF); no "browser unsupported" message.
- [ ] `getRpId()` → `app.beanies.family` on native, origin host on web; existing web passkeys still authenticate (no re-enrollment).
- [ ] Settings → Account on native shows accurate, surface-neutral capability copy.
- [ ] Older-WebView / feature-disabled Android: no crash, Tier-3 password fallback, honest message.
- [ ] PWA + desktop browser biometric unchanged (incl. dev `localhost:5173`).
- [ ] `https://app.beanies.family/.well-known/assetlinks.json` (WebAuthn relation) live (HTTP 200, `application/json`).
- [ ] iOS config (Associated Domains + AASA) committed with `<APPLE_TEAM_ID>` placeholder; iOS on-device acceptance gated on replacing it (deferred to iOS build).
- [ ] No silent failures: native enablement, capability, assertion, unwrap each surface user message + dev breadcrumb.
- [ ] Help Center article added/updated and matches shipped behavior.
- [ ] `npm run validate` green; new + existing passkey tests pass.

## Verification / Testing

1. **Unit** — `getRpId()`: native (`isNative()` true) → `'app.beanies.family'`; web → `window.location.hostname` (mock `isNative`). Existing passkey suite stays green. `PasskeySettings` reworded copy renders.
2. **Manual — Android APK (greg)**: Settings → enable biometric → register (Credential Manager prompt appears, proving assetlinks resolved) → sign out → biometric unlock. Capture both PRF-present and PRF-absent outcomes. If feasible, test an older-WebView path (Tier-3).
3. **Manual — PWA/desktop regression**: existing passkey on `app.beanies.family` still unlocks; dev `localhost` still works.
4. **Manual — iOS**: deferred to iOS build; now just `curl -sI https://app.beanies.family/.well-known/apple-app-site-association` reachability.
5. **Live asset check**: `curl -sI https://app.beanies.family/.well-known/assetlinks.json` → 200 + `application/json` after deploy.
6. **`#beanies-errors` watch**: native passkey breadcrumbs quiet/expected; the new `passkey-assertion` warning only fires on genuinely unrecognized failures.

## Review Passes

- **Pass 1 (Initial draft)**: WebView-WebAuthn approach (reuse JS passkey/PRF stack via `getRpId()` + native association), honest capability tiers, Android enablement (androidx.webkit + assetlinks on app.beanies.family), iOS readiness (Associated Domains + AASA), no-existing-passkey-breakage RP-ID constraint, rejected native-plugin alternative.
- **Pass 2 (DRY + error handling)**: collapsed seam to `getRpId()` in `passkeyService.ts`; reworded existing `passkey.unsupported` instead of new key; found `formatCredentialManagerError` + `NotReadableError` retry already cover native (only gap = no breadcrumb → added one); caught the critical silent failure that `deploy.yml`'s `upload-artifact` lacks `include-hidden-files` (would strip the new assetlinks).
- **Pass 3 (Sustainability)**: decoupled native RP-ID host from `features.ts` into a self-owned `WEBAUTHN_RP_ID` constant; removed stale rejected artifacts (`webauthnConfig.ts`, `VITE_WEBAUTHN_RP_ID`); corrected the impossible `zh:` instruction ({en, beanie?} + auto-gen); pinned "tiers are docs, not a class"; added two-origin fingerprint-sync discipline + iOS team-ID placeholder guard.
- **Pass 4 (Fresh-eyes sweep)**: verdict ready-with-minor-edits; verified security-correct (RP-ID unchanged ⇒ no orphaned passkeys, app-scoped WebView WebAuthn, two distinct-origin assetlinks); brought Files-Affected/Approach/Testing text into line with Pass-3 decisions; pinned breadcrumb severity/context, AASA placeholder lifecycle, fingerprint-sync README.

## Outcome (2026-05-23) — native biometric DEFERRED to the Play build

The web/PWA hardening parts of this plan landed cleanly. The native part hit a platform wall and was deferred. Full record in **ADR-029 → "Native auth follow-ups (2026-05-23)"** and **STATUS (2026-05-23)**; summary:

- **The plan's chosen approach (WebView-WebAuthn) proved unworkable on-device** — exactly the failure the plan's own "revisit only if WebView-WebAuthn proves unworkable" escape hatch anticipated. `setWebAuthenticationSupport(FOR_APP)` → opaque `CreateCredentialUnknownException`; `FOR_BROWSER` → hard Chromium WebView crash. Shipped as `a30fa0c`, now superseded (`MainActivity` reverted to bare `BridgeActivity`).
- **Pivoted to the plan's rejected alternative — a native Capacitor passkey plugin** (`@capgo/capacitor-passkey`, `autoShimWebAuthn()` in `main.ts`, `isNative()`-gated). The plan's **core reuse principle held**: the PRF/family-key/`passkeyWrappedKeys` stack is reused unchanged; only `getRpId()` + the shim install were added. The plugin reaches Google's native FIDO `RegistrationActivity`.
- **Final blocker: GMS `[50152] "RP ID cannot be validated"` on the sideloaded debug build**, despite cert confirmed `19:E4` (`pm get-app-links`) and the `get_login_creds` assetlinks validated by Google's checker (`linked:true`) — the known murky DAL failure for debug/sideloaded apps.
- **Decision: defer native biometric to the Play-signed internal-testing build** (real Play App Signing cert in assetlinks; reliable GMS DAL there; required for launch anyway). **Requirement 3 (PWA/browser zero-regression) and the RP-ID-unchanged constraint were met** — `getRpId()` is a no-op on web and existing passkeys are untouched. iOS biometric also deferred (plugin returns empty `clientExtensionResults` / no PRF; no iOS build yet).
- **Foundation consolidated into `main`** (squash of `trial/native-passkey-plugin`), ready to validate on the Play build with no rework.

## Prompt Log

- **Initial (/beanies-plan)**: "make a plan to implement biometric login on the native app while ensuring biometric login remains clean and robust on the PWA and browser, and ensure biometric login should work seamlessly across all platforms, including android, iOS, and other relevant platforms. also please ensure that biometric login should work across both newer and older devices ensuring the necessary code paths, polyfills, etc are in place to ensure biometric login works consistently across all android and iOS devices, both newer and older."
- **Preceding context**: on the native Android APK (post-OAuth-fix), login works but biometric wasn't offered despite a PWA-saved passkey, and Settings shows "your browser does not support biometric login (WebAuthn)". Diagnosis established: native WebView doesn't expose `PublicKeyCredential`, and `rpId = window.location.hostname = 'localhost'` can't match the PWA passkey's RP ID (`app.beanies.family`).
