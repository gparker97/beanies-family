---
date: 2026-05-23
category: feature
issue: none
plan: docs/plans/2026-05-23-native-pwa-biometric-login.md
tags: [auth, security, passkey, webauthn, biometric, capacitor, native, pwa, adr-029]
---

# Native biometric (passkey) login

## Prompts

**[bug report — on native APK]**

> I've installed the new app and confirmed that the consent screen appears properly after clicking on google drive, but now the issue is that the sign in fails… [resolved separately: OAuth-proxy CORS]. … One issue however is that I was not prompted to login with my biometric credentials, which i had saved before on the PWA. In addition, if I navigate to settings → account, under the biometric login section, I get the message: "your browser does not support biometric login (webauthn)"

**[plan — /beanies-plan]**

> make a plan to implement biometric login on the native app while ensuring biometric login remains clean and robust on the PWA and browser, and ensure biometric login should work seamlessly across all platforms, including android, iOS, and other relevant platforms. also please ensure that biometric login should work across both newer and older devices ensuring the necessary code paths, polyfills, etc are in place to ensure biometric login works consistently across all android and iOS devices, both newer and older.

**[approval]** Plan approved via ExitPlanMode (4-pass review).

**[sequencing]** Merge the OAuth branch to main first, then start biometric on a fresh branch off main.

**[go]** "go ahead to merge 221 to main and then continue with plan implementation"

**[troubleshooting — at computer]** "let me know the steps to continue the troubleshooting for biometrics" — then reported, across successive APK builds: `SecurityError` → `NotReadableError` (looping 3×) persisting; "let's try your top candidate guess first" (residentKey `preferred`), still failed.

**[research request]** Shared a Gemini response advocating a plugin/shim (correct route) but a **server-side key-release model incompatible with beanies' zero-knowledge design**: "are we at a dead end? what can be learned… should we ask more LLMs… research how others solve this problem."

**[design question]** "is it the correct/appropriate approach to use FOR_BROWSER… will we hit the same limitations… leverage the native app capabilities to reduce errors" — instinct proved right (FOR_BROWSER crashed the WebView).

**[approval]** Approved stabilizing the crash, reading the plugin source, then running the `@capgo/capacitor-passkey` trial.

**[trial results]** Native prompt appeared (plugin reaches Credential Manager). 1Password interfered first; after preferring Google Password Manager → "no create options available", then definitively `Auth.Api.Credentials: cjij: [50152] RP ID cannot be validated`. `adb shell pm get-app-links` confirmed the signing cert IS `19:E4:…` and `beanies.family` App Link is verified — ruling out a cert mismatch.

**[decision — defer + ship]** "let's defer to the play build when ready, and ensure it works for the actual app launch. we're still in testing, and just want the app to work in full before launch, for both android and ios. can you merge what we've built into a stable build and push/deploy everything?"

## Outcome

Root cause (two compounding): the native WebView didn't expose `window.PublicKeyCredential`
(WebAuthn off by default in Capacitor's WebView), and `rpId = window.location.hostname`
resolved to `localhost`, which can't match the PWA passkey RP ID (`app.beanies.family`).

Fix (branch `feat/native-biometric-passkeys`, WebView-WebAuthn approach — reuse the
existing JS passkey/PRF stack, no native plugin):

1. `passkeyService.ts`: new `getRpId()` (native → fixed `WEBAUTHN_RP_ID = 'app.beanies.family'`,
   web → `window.location.hostname` unchanged so existing passkeys aren't orphaned); replaced
   the 3 `window.location.hostname` sites; added the service's only `reportError()` breadcrumb
   in the `formatCredentialManagerError` fallthrough (severity warning).
2. Reworded `passkey.unsupported` to surface-neutral copy (no "browser"); zh regenerated.
3. Android: `androidx.webkit` dep + feature-detected `setWebAuthenticationSupport(FOR_APP)` in
   `MainActivity` (Log.w on failure, never crash); new WebAuthn `assetlinks.json`
   (`get_login_creds`) on the app origin; `deploy.yml` `include-hidden-files: true` (the
   unfixed half of the ADR-029 deploy-strip bug — would have silently 404'd the assetlinks).
4. iOS readiness: AASA with `<APPLE_TEAM_ID>` placeholder + README documenting the two-origin
   fingerprint-sync discipline. iOS entitlement + on-device validation deferred to the iOS build.
5. Help Center: new `security/biometric-login` article.

`npm run validate` green (2591 tests, +2 getRpId). Pending greg: Vue prod deploy (so the
assetlinks is live) + APK rebuild + on-device verification.

### Update — final outcome (end of session): WebView approach abandoned, plugin reaches Google FIDO, native biometric DEFERRED to the Play build

The WebView-WebAuthn approach above (`a30fa0c`) **failed on-device** and was abandoned:
`setWebAuthenticationSupport(FOR_APP)` → opaque `CreateCredentialUnknownException`;
`FOR_BROWSER` → hard native Chromium WebView crash. The device creates passkeys fine via
Chrome and the installed PWA, so the limitation was the Capacitor WebView ↔ Credential
Manager bridge specifically.

Pivoted to the originally-rejected alternative — the **`@capgo/capacitor-passkey` plugin**
(`autoShimWebAuthn()` in `main.ts`, `isNative()`-gated; PRF/family-key stack reused
unchanged). It reaches Google's native FIDO `RegistrationActivity`, but registration ends in
GMS **`[50152] "RP ID cannot be validated"`** on the **sideloaded debug build** — despite the
signing cert confirmed `19:E4` (`pm get-app-links`) and the `get_login_creds` assetlinks
validated by Google's own checker (`linked:true`). This is the known, murky on-device DAL
failure for debug/sideloaded apps.

**Decision (greg): defer native biometric to the Play-signed internal-testing build** — the
real Play App Signing cert goes in assetlinks, GMS DAL validation is reliable there, and it's
required for store launch anyway. The foundation (plugin shim, `getRpId()`, assetlinks, CI
versionCode/SHA, bare `MainActivity`, native `residentKey:'preferred'`) was squash-merged from
`trial/native-passkey-plugin` into `main`, validated green (2591 tests), and the Vue app + APK
were rebuilt/deployed. Native today = password sign-in; PWA/browser biometric unchanged; iOS
biometric deferred (plugin returns empty `clientExtensionResults` / no PRF, no iOS build yet).
Full record: ADR-029 → "Native auth follow-ups (2026-05-23)" + STATUS (2026-05-23) + the plan's
Outcome section.
