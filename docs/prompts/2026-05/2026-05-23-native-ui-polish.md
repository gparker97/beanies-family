---
date: 2026-05-23
category: bugfix
issue: '#225, #226'
plan: none
tags: [capacitor, native, android, status-bar, edge-to-edge, font, textZoom, ui, adr-029]
---

# Native (Capacitor) UI polish vs the PWA — font size + status bar (+ spinner)

## Prompts

**[/frontend-design — initial]**

> Two things I noticed with the native (capacitor) app vs the PWA: (1) the font size on the native app is noticeably smaller than the PWA — ~5cm difference in info above the fold on `/nook`, and the default is already small so it's getting close to unreadable; (2) on the PWA the top of the screen (battery/time/wifi) is white and blends with light mode, but on the app the top is black so the viewable area feels smaller. Can these be fixed?

**[test 1]** Font looks better (maybe slightly bigger than the PWA now, fine). Status bar is a translucent dark bar rather than white in light mode, and stays the same in both light and dark mode.

**[test 2]** Still looks the same. Also: the spinner / disabled-buttons fix for Google Drive + local file after selecting the `.beanpod` isn't implemented in the native app either.

**[link]** "just to be sure can you give me the link to download the latest apk"

**[diagnostic + spinner detail]** Ran the console one-liner on desktop (not the phone): `{winH:1270,screenH:1440,dpr:1,colPadTop:"0px"}`. Expects the spinner exactly after selecting the beanpod file post-consent — which is needed on every new install.

**[decision]** "ok let's park and record these issues and move on. pls merge and deploy if needed"

## Outcome

**Font size — FIXED & confirmed.** Root cause: the Android System WebView scales web text by the OS font-size setting (`textZoom`); because the whole app is rem-based, a below-default OS font shrank the entire UI vs the PWA (which renders web content at a fixed 100%). `MainActivity.onStart` now pins `webView.getSettings().setTextZoom(100)`. The in-app Large reading mode remains the accessibility scale. greg confirmed it now matches the PWA.

**Status bar — PARKED ([#225](https://github.com/gparker97/beanies-family/issues/225)).** The app targets SDK 36 (Android 16), where edge-to-edge is enforced and `@capacitor/status-bar`'s painted-bar APIs are deprecated no-ops (verified in plugin source). Three approaches were tried and merged as groundwork (`setBackgroundColor`; `setOverlaysWebView` + `viewport-fit=cover` native-only + `env(safe-area-inset-top)` content inset + theme-tracked `setStyle`; native `MainActivity` `setDecorFitsSystemWindows(false)` + `setStatusBar/NavigationBarContrastEnforced(false)`), none removed the scrim. Next untried step (in the issue): paint the window background the app colour, gated on a `chrome://inspect` reading from the phone (edge-to-edge vs inset).

**Spinner — PARKED ([#226](https://github.com/gparker97/beanies-family/issues/226)).** The `d25b6d3` fix is confirmed in the running bundle (firehose `build_sha` = `e485b9d` + git ancestry) but doesn't engage on the native post-consent select-file flow; needs on-device inspection of `viewState`/`isDriveLoading`/`isLoadingFile`.

**Process note:** the telemetry firehose (`build_sha`) was the key tool — it proved the device was on the latest build and both fixes were present, ruling out a stale-APK theory and redirecting the diagnosis. Both parked issues are native-only, cosmetic/minor, web+PWA unaffected, app still in testing. Branch `fix/native-text-zoom-statusbar` merged to `main`; no prod web deploy (all native-gated).
