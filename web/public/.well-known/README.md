# Android App Links — `assetlinks.json`

This file makes Android route the OAuth redirect `https://beanies.family/oauth/native`
into the installed beanies.family app instead of opening it in the browser
(ADR-029 A2). Without a verified `assetlinks.json`, the link opens the website
(the `/oauth/native` fallback page) and native Google sign-in cannot complete.

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
