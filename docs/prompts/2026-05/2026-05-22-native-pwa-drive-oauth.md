---
date: 2026-05-22
category: bug
issue: none
plan: docs/plans/2026-05-22-native-pwa-drive-oauth-redirect-unification.md
tags: [auth, sync, capacitor, oauth, google-drive, native, pwa, adr-029]
---

# Native + iOS-PWA Google Drive sign-in/load hang

## Prompts

**[good-morning session start]** `/good-morning`

**[bug report — on-device repro]**

> Today we've build out a capacitor-based app and generated the android apk. I've tested in on my device now and encountered an issue signing in via google drive. the steps to replicate the issue are below:
>
> - install app via the latest app apk generated on github
> - Open app and go to sign in
> - Click on google drive (now enabled)
> - i get redirected to a blank tab - no google consent screen. progress has stopped
> - I switch tasks back to the app - before i land in the app, i am redirected again to a new tab, this time the google consent screen is loaded
> - i select the account with my beanpod file
> - i am redirected back to the app, however the spinner spins indefinitely with no progress. after 120s the spinner times out and i get a timeout error messages on the sign in page on the app

**[scope decision — AskUserQuestion]** Cover iOS-PWA too, or native-only?
→ **Unify redirect transport** for all redirect-transport surfaces (native + iOS PWA). One code path.

**[plan]** Produced via `/beanies-plan` (mandatory 4-pass review). Do not implement yet.

**[approval]** `pls implement`

**[follow-up]** `commit on this branch and rebuild the APK`

## Outcome

Root cause: the load-from-Drive **picker** path used the popup OAuth transport
(`requestAccessToken` → `openBlankPopup` → `waitForAuthCode` postMessage), which
cannot bridge back into a Capacitor WebView / installed PWA — Google's redirect
goes to the verified App Link → back into the app (`appUrlOpen`), never to the
popup → blank tab + 120 s `POPUP_AUTH_TIMEOUT_MS` hang. The create-pod path was
already migrated to the deep-link transport (ADR-029); the load path was not.

Fix (branch `fix/native-pwa-drive-oauth-redirect`):

1. `shouldUseRedirectAuth()` now returns true on native — single source of truth
   (also fixes one-tap reconnect on native). Collapsed the redundant
   `|| isNative()` at the create path.
2. Shared `beginDriveAuthRedirectIfNeeded(returnPath, loginHint, { forceReauth })`
   in `connectStorage.ts`, exposed via a thin `syncStore.beginDriveAuthRedirect`
   action (MVO). Used by both create and load.
3. `LoadPodView`'s three Drive handlers consolidated into one
   `openDrivePicker({ forceNewAccount, isResume })` that redirects on a redirect
   surface; `LoginPage`'s resume watch handles `?resume=load-drive` (dispatched
   BEFORE the `isAuthenticated` gate — the fresh zero-families sign-in is
   unauthenticated until the pod loads) and re-opens the picker via an
   `immediate` watch (not `onMounted`, which never re-fires on the native SPA
   nav). Router guard `ALREADY_AUTH_REDIRECT_FROM` lets `load-drive` through.

`npm run validate` clean: type-check + lint (0 errors) + format + 2589 unit
tests + production build. +9 net new tests (incl. a regression pinning the
unauthenticated `load-drive` dispatch). `OpenFromDrivePage` flagged as a tracked
follow-up (the one remaining popup caller; not a native launch path).

On-device APK verification by greg is the final acceptance step.
