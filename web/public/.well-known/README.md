# App-link association files on `beanies.family`

Two files here make **both** platforms route the OAuth redirect
`https://beanies.family/oauth/native` into the installed beanies.family app instead
of opening it in the browser (ADR-029 A2):

| File | Platform | Purpose |
| --- | --- | --- |
| `assetlinks.json` | Android | App Link verification (`handle_all_urls`) |
| `apple-app-site-association` | iOS | Universal Link verification (`applinks`) |

Without a verified file, the link opens the website (the `/oauth/native` fallback
page) and native Google sign-in cannot complete on that platform.

> **Note — two origins.** These files (on **beanies.family**) handle the OAuth
> return. A separate pair on **app.beanies.family** (`public/.well-known/`) handles
> passkeys (`get_login_creds` / `webcredentials`). Don't confuse them; see that
> directory's README and the sync table in `public/.well-known/README.md`.

## `apple-app-site-association` — iOS Universal Link (OAuth return)

Authorizes the iOS app to claim `https://beanies.family/oauth/native` as a Universal
Link, paired with the `applinks:beanies.family` Associated Domains entitlement in
`ios/App/App/App.entitlements`. Uses the modern `applinks.details[].appIDs` +
`components` schema. Served extensionless with `Content-Type: application/json`.

> **`<APPLE_TEAM_ID>` is a placeholder.** No iOS build exists yet. Substitute the
> real 10-char Apple Team ID (`grep -rn '<APPLE_TEAM_ID>'` finds every file that
> needs it — this one plus the passkey AASA on app.beanies.family) once the Apple
> Developer Organization account is verified. iOS won't match the placeholder, so
> the OAuth Universal Link silently falls back to the website until it's replaced.
> See the Tranche-2 substitution checklist in `docs/runbooks/native-store-submission.md`.

## `assetlinks.json` — Android App Link (OAuth return)

## What needs doing before native OAuth works on a device

1. **Get the signing-key SHA-256 fingerprints** and replace the two placeholders
   in `assetlinks.json`:
   - **Debug** (the APK from the CI debug lane): requires a _stable_ debug
     keystore committed/configured in `android/app/build.gradle` (the default
     per-machine debug keystore changes fingerprint every CI run and won't
     verify). Get it with:
     `keytool -list -v -keystore <debug.keystore> -alias androiddebugkey -storepass android`
   - **Release** (the Play AAB, A6): from the upload/app-signing key —
     `keytool -list -v -keystore <release.keystore> -alias <alias>`, or copy the
     SHA-256 from Play Console → Setup → App integrity → App signing.
   Both are the `SHA256:` line, colon-separated hex.

2. **Deploy the marketing site** so this file is live at
   `https://beanies.family/.well-known/assetlinks.json` (greg-driven; the web
   deploy is separate from the app).

3. Verify on device: `adb shell pm get-app-links family.beanies.app` should show
   `beanies.family: verified` after install + a network round-trip.

The matching Android intent-filter lives in
`android/app/src/main/AndroidManifest.xml` (`android:autoVerify="true"`).
