# `app.beanies.family` well-known files — native biometric (passkey) association

These files associate the native beanies.family app with the **`app.beanies.family`**
Relying Party so device biometrics (passkeys) registered on the PWA can be used
inside the native WebView. Served from the Vue app's S3 bucket / CloudFront
(`app.beanies.family`), deployed by `.github/workflows/deploy.yml`. See ADR-029
and `docs/plans/2026-05-23-native-pwa-biometric-login.md`.

> **Deploy note:** `deploy.yml` sets `include-hidden-files: true` on the
> build-artifact upload so `dist/.well-known/` survives the artifact round-trip
> and reaches S3 (`upload-artifact` strips dotfiles by default; `aws s3 sync`
> itself preserves them). Without it these files 404 and association silently
> fails. Verify after deploy:
> `curl -sI https://app.beanies.family/.well-known/assetlinks.json` → 200, JSON.

## `assetlinks.json` — Android (WebAuthn `get_login_creds`)

Authorizes the Android app to assert WebAuthn credentials for RP ID
`app.beanies.family` (RP ID is set in `src/services/auth/passkeyService.ts`
`getRpId()`). Routed through the Android Credential Manager once the WebView
enables WebAuthn (`MainActivity.enableWebAuthnIfSupported`).

## `apple-app-site-association` — iOS (`webcredentials`)

Authorizes the iOS app to use passkeys for `app.beanies.family` in WKWebView
(iOS 16+), paired with the `webcredentials:app.beanies.family` Associated
Domains entitlement.

> **`<APPLE_TEAM_ID>` is a placeholder.** No iOS build exists yet. A placeholder
> AASA on the live origin is harmless (iOS won't match it), but iOS biometric
> association silently never works until the real Apple Team ID replaces the
> placeholder when the iOS app is built. Serve with `Content-Type: application/json`
> and **no `.json` extension** (already the filename).

## ⚠️ Two assetlinks files exist — keep their fingerprints in sync

There are **two** Android Digital Asset Links files on **two origins**, both for
package `family.beanies.app`:

| File | Origin | Relation | Purpose |
| --- | --- | --- | --- |
| `web/public/.well-known/assetlinks.json` | `beanies.family` (Astro, `deploy-web.yml`) | `handle_all_urls` | OAuth App Link (`/oauth/native`) |
| `public/.well-known/assetlinks.json` (this dir) | `app.beanies.family` (Vue app, `deploy.yml`) | `get_login_creds` | WebAuthn / biometric |

They share the **same package + SHA-256 cert fingerprint(s)**. At **every
signing-key event** — debug keystore rotation, adding the release/upload key,
Play App Signing re-sign, or a second native app — **both files must be updated
together**, or native auth breaks silently on the un-updated origin (App Links on
one, biometrics on the other). Treat the fingerprint list as one logical value
maintained in two places. Both currently list only the **debug** fingerprint
(`19:E4:…`); add the **release** fingerprint to **both** when the Play release
lane (A6) is activated. Get fingerprints per `web/public/.well-known/README.md`.
