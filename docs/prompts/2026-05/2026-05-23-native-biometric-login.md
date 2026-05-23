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
