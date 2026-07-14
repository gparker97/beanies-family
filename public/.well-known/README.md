# `app.beanies.family` well-known files

Served from the Vue app's S3 bucket / CloudFront (`app.beanies.family`), deployed by
`.github/workflows/deploy.yml`.

> **Native biometric no longer uses WebAuthn (ADR-029, 2026-07-14).** The installed
> apps now unlock via the hardware Keystore (`BiometricKeystorePlugin`), which has no
> RP-ID / assetlinks / `webcredentials` dependency. The passkey-only association files
> here were retired: the app-origin `apple-app-site-association` (`webcredentials`) was
> deleted, and the `get_login_creds` relation was removed from `assetlinks.json`. Only
> the OAuth-relevant `handle_all_urls` relation remains. Web/PWA still uses WebAuthn-PRF
> (its RP ID is the origin host — no association file needed).

> **Deploy note:** `deploy.yml` sets `include-hidden-files: true` on the
> build-artifact upload so `dist/.well-known/` survives the artifact round-trip
> and reaches S3 (`upload-artifact` strips dotfiles by default; `aws s3 sync`
> itself preserves them). Without it these files 404 and association silently
> fails. Verify after deploy:
> `curl -sI https://app.beanies.family/.well-known/assetlinks.json` → 200, JSON.

## `assetlinks.json` — Android (`handle_all_urls`)

Retains only the `handle_all_urls` relation for package `family.beanies.app`. The
former `get_login_creds` relation (WebAuthn / Credential Manager) was removed with the
native-biometric Keystore pivot (ADR-029, 2026-07-14). There is no longer an
`apple-app-site-association` on this origin (it was `webcredentials`-only).

## ⚠️ Two assetlinks files exist — keep their fingerprints in sync

There are **two** Android Digital Asset Links files on **two origins**, both for
package `family.beanies.app`:

| File | Origin | Relation | Purpose |
| --- | --- | --- | --- |
| `web/public/.well-known/assetlinks.json` | `beanies.family` (Astro, `deploy-web.yml`) | `handle_all_urls` | OAuth App Link (`/oauth/native`) |
| `public/.well-known/assetlinks.json` (this dir) | `app.beanies.family` (Vue app, `deploy.yml`) | `handle_all_urls` | App-origin deep-link association |

They share the **same package + SHA-256 cert fingerprint(s)**. At **every
signing-key event** — debug keystore rotation, adding the release/upload key,
Play App Signing re-sign, or a second native app — **both files must be updated
together**, or native auth breaks silently on the un-updated origin (App Links on
one, biometrics on the other). Treat the fingerprint list as one logical value
maintained in two places. Both list the **debug** fingerprint (`19:E4:…`) and,
as of the first Play upload (2026-07-12), the **Play App Signing** fingerprint
(`18:76:CB:…`, the app signing key certificate SHA-256 from Play Console →
Protected with Play → App signing). Add any further **release** fingerprints to
**both** on any future signing-key event. Get fingerprints per
`web/public/.well-known/README.md`.
