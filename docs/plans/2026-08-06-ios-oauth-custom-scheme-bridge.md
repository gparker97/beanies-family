# Plan: Fix the iOS native OAuth return via a custom-scheme bridge

> Date: 2026-08-06
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-08-06-ios-oauth-custom-scheme-bridge.md`

## User Story

As an iPhone/iPad user signing in to the beanies.family app, I want the Google sign-in to return me straight into the app, so that I land on my family's home screen inside the real app — instead of a 404 page, a second forced sign-in, and then the rest of my session running inside a Safari sheet.

## Context

The first-ever iOS TestFlight builds (7 and 8) have two on-device symptoms:

- **Bug A** — after completing the Google consent screen, the first screen is always the app's 404 page, which then bounces back to the welcome gate. A second sign-in lands correctly on `/nook`.
- **Bug B** — after that, tapping any item causes Safari-style controls to appear over the app (top and bottom chrome). The app switcher still shows the beanies icon.

**These are ONE bug, now confirmed.** On 2026-08-06 greg observed that the top bar in that state displays the domain **`app.beanies.family`**. A native `WKWebView` has no URL display, so a visible domain proves the app is running inside `SFSafariViewController`. It has been since the OAuth return; `SFSafariViewController` presents modally _inside_ the host app (hence the beanies icon in the app switcher, never a separate Safari card) and auto-hides its bars, so the "first tap" merely revealed chrome that was already there. Fixing the OAuth return is therefore expected to fix both symptoms.

A previous session diagnosed this as a WebView origin mismatch and parked `iosScheme: 'https'` as the fix. **That is disproven.** Capacitor's `CAPInstanceDescriptor.normalize()` (`node_modules/@capacitor/ios/Capacitor/Capacitor/CAPInstanceDescriptor.swift:166-176`) accepts a scheme only when `WKWebView.handlesURLScheme(scheme) == false`. `https` is reserved by WKWebView, so the value is silently discarded and reset to `InstanceDescriptorDefaults.scheme` = `capacitor`. The iOS origin is, and must remain, `capacitor://app.beanies.family`. It shipped as build 8 (`28545343`) and changed nothing; it has been reverted with a do-not-retry note in `capacitor.config.ts`.

### The actual root cause

**Apple fires Universal Links only on user-initiated taps.** A server-side redirect to a Universal Link inside `SFSafariViewController` does not hand off to the app — the page just loads in the browser. This is long-documented (AppAuth-iOS #328, rdar://51091611, Apple DTS forum 43397).

The verified chain:

1. `startRedirectAuth` (`src/services/google/googleAuth.ts`, native branch, line 1863+) calls `Browser.open({ url: authUrl })`. `@capacitor/browser` uses `SFSafariViewController` (`node_modules/@capacitor/browser/ios/Sources/BrowserPlugin/Browser.swift:20`) — **not** the `ASWebAuthenticationSession` that ADR-029 claims. That documentation error is part of why this bug was not predicted, and the ADR amendment must correct it.
2. Google redirects to `NATIVE_REDIRECT_URI` = `https://beanies.family/oauth/native` (`googleAuth.ts:48`) — the apex.
3. **No handoff** — it is a redirect, not a tap.
4. The apex 301s it away: `/oauth` is in `APP_PATHS` in `infrastructure/modules/web/functions/apex-cutover.js`, so the request 301s to `https://app.beanies.family/oauth/native`. Verified live.
5. The Vue app loads inside the browser sheet. `src/router/index.ts` has `/oauth/callback` (line 263) but **no `/oauth/native`** → the `:pathMatch(.*)*` NotFound route → App.vue's unauthenticated-boot branch (`src/App.vue:871-886`) `router.replace('/welcome')`. **That is Bug A** — and because the app is now hosted in that sheet, everything after it is **Bug B**.

### Key discovery: the fallback page already exists but is unreachable

`web/src/pages/oauth/native.astro` already exists — purpose-built as the ADR-029 A2 deep-link fallback ("open the beanies.family app to finish signing in"). **It has never rendered in production**, because step 4's 301 shadows it. This plan un-shadows and enhances that existing page rather than creating a new one.

### Why a custom-scheme bridge (and not the alternatives)

- **`ASWebAuthenticationSession` with an https callback** is Apple's supported OAuth path, but `Callback.https` is **iOS 17.4+** and we target **15.0** (`ios/App/App.xcodeproj/project.pbxproj`). It additionally requires `webcredentials:beanies.family` in `App.entitlements` (we have only `applinks`; `webcredentials` was deliberately retired in ADR-029 with the passkey pivot), a matching `webcredentials` AASA section, and a custom Swift plugin. Rejected for this change as too costly and version-exclusionary; recorded as a possible future migration.
- **Registering a custom scheme directly with Google** is closed: Google no longer accepts custom-scheme redirect URIs, and our client is a Web client whose confidential proxy adds `client_secret`.
- **A tap on the https Universal Link from the interstitial does not work either** — Apple does not fire Universal Links for links whose host matches the host of the page the user is already on. The interstitial _is_ served from `beanies.family`, so a same-domain link is inert. This is why the visible fallback link must be the custom scheme, not the https URL.
- **The bridge** keeps Google redirecting to the https URI it already has registered, then hops to a custom scheme _from our own page_. Custom schemes **do** escape `SFSafariViewController`, and Capacitor already converts them into the same `appUrlOpen` event the existing handler consumes (`ios/App/App/AppDelegate.swift:35` → `ApplicationDelegateProxy.application(_:open:)`; `node_modules/@capacitor/app/ios/Sources/AppPlugin/AppPlugin.swift:20` observes `capacitorOpenURL` → `notifyListeners("appUrlOpen")` — both verified). Works on **iOS 12+**, needs no plugin, no entitlement change, and no deployment-target bump. `getRedirectUri()` is untouched, so the `redirect_uri` sent at authorization and at token exchange stay identical — the bridge is invisible to Google.

### Security consequence of registering a custom scheme (read before implementing)

Today `handleNativeAuthRedirect` is only reachable via a **verified** App Link / Universal Link: the OS will only route `https://beanies.family/oauth/native` to us because we host the association files. After this change the same handler is also reachable via `family.beanies.app://oauth/native?…`, which **any installed app or any web page can invoke with arbitrary parameters**.

Nothing in the handler's logic changes, but its threat model does:

- The `state` CSRF check stops being "defense-in-depth atop the verified link" and becomes the **primary** authenticity control. That framing appears in **two** places — `handleNativeAuthRedirect`'s inline comment and `startRedirectAuth`'s native branch (`googleAuth.ts:1866`) — and **both** must be updated, or the two comments will disagree and a future reader will consider the check removable.
- The `if (!stateJson) return` guard is what makes a cold-launch spoof benign, and must not be relaxed.
- `const stored: RedirectAuthState = JSON.parse(stateJson)` (`googleAuth.ts:2137`) is currently **unguarded**. A corrupt or attacker-influenced stash throws, and the call site is `void handleNativeAuthRedirect(...)` — an unhandled promise rejection. This was tolerable when only a verified link could get here; it is not once the door is wider. §5 hardens it.

## Requirements

1. Register the custom URL scheme `family.beanies.app` (= the bundle ID, verified in `capacitor.config.ts:4` and `project.pbxproj:315`) in `ios/App/App/Info.plist` (`CFBundleURLTypes` — verified currently absent).
2. Register the same scheme in `android/app/src/main/AndroidManifest.xml` so both platforms take **one** code path and Android's unverified-App-Link case recovers instead of dead-ending.
3. Stop the apex CloudFront function from 301ing `/oauth/native` to `app.beanies.family`, so the existing Astro interstitial actually serves. All other `/oauth/*` paths (notably `/oauth/callback`) must keep redirecting exactly as today.
4. Introduce **one** small, zero-dependency module that owns the native-OAuth URL contract (`src/constants/nativeOAuth.ts`) and have every consumer — `googleAuth.ts`, the Vue backstop, and the Astro interstitial — import from it. No string is written twice, and the module exposes the **smallest** API that serves those three callers.
5. Enhance `web/src/pages/oauth/native.astro` to auto-redirect to `family.beanies.app://oauth/native?<original query string>` on load, preserving the query string verbatim, with the constants injected at build time (no runtime JS bundle).
6. Keep the existing "almost there" copy, and make a "Return to beanies" link the page's **primary** action — present in the static HTML so a JS failure, a blocked hop, or a dismissed OS prompt cannot leave the user stranded.
7. Widen the deep-link guard in `handleNativeAuthRedirect` so it accepts **both** the https Universal Link and the custom-scheme URL, via the shared matcher, and harden the stash parse. All existing CSRF `state` validation, PKCE handling, and the calendar-grant branch preserved unchanged.
8. Add an `/oauth/native` route to the Vue router as a **loud** backstop — it must never render the 404 page, must report the fact that it was reached, must offer the same bridge hop, and must **actually stay on screen** (see §6a: App.vue would otherwise bounce it to `/welcome`). It must contain **no timers and no navigation races**.
9. Exclude `/oauth/` from the Astro sitemap (`web/astro.config.mjs` currently filters only `/og/`).
10. Do not regress Android, which shares `NATIVE_REDIRECT_URI` and currently works via verified App Links; and do not regress the **native calendar grant**, which shares `getRedirectUri()` (`src/services/calendar/calendarAuth.ts:134,231,398`).
11. Emit diagnostics using the **existing** allowlisted `action` context key — no new context key, therefore no store-privacy re-declaration.
12. Guard the three places the scheme string is unavoidably duplicated (TS constant, `Info.plist`, `AndroidManifest.xml`) with an automated drift tripwire.
13. Add tests for `apex-cutover.js` **without modifying the production function file** — its content must stay byte-identical to what CloudFront executes.

## Important Notes & Caveats

- **The auth `code` transits the interstitial page's URL.** It must never be logged, sent to analytics, or left in history. The page is standalone HTML with no `BaseLayout` import, so it currently loads **no Plausible/analytics** — this must stay true. Use `location.replace()` for the hop so the code-bearing URL does not become a back-stop entry.
- **Cached 301s are a non-issue, but only because the URL carries a unique query.** The existing `redirect()` helper sets `cache-control: public, max-age=3600` on a 301 (verified), and browsers cache 301s aggressively. Redirect caching is keyed on the full URL including the query string, and every real OAuth return carries a fresh `code`/`state`, so no real sign-in can hit a stale cached 301. The bare `https://beanies.family/oauth/native` (no query) **can** stay cached on a device that visited it before the fix — which is exactly why the Vue backstop must not bounce back to the apex (see §6). State this explicitly so nobody re-derives it during build-10 triage.
- **`/oauth/callback` must keep 301ing.** The web/PWA flow uses `${window.location.origin}/oauth/callback` (`googleAuth.ts:433`), which is already on the app origin; the apex redirect is a safety net that should not be removed.
- **The exemption is an exact-path match, not a prefix.** `/oauth/native/*` does not exist; a prefix exemption would let `/oauth/native/anything` fall through to the `.html` rewrite and 403 from S3. Match `'/oauth/native'` and `'/oauth/native/'` only — the trailing-slash form is then 301'd to the canonical form by the existing step 3.
- **`new URL()` parses non-special schemes differently.** For `family.beanies.app://oauth/native?code=x`, `host` is `oauth` and `pathname` is `/native` — _not_ what the https URL yields. We sidestep this entirely by extracting the query substring and feeding `URLSearchParams` directly, which is simpler and cannot throw. Unit-tested for both transports.
- **iOS may prompt** with an "Open in beanies.family?" confirmation on custom-scheme navigation from a browser sheet, and may refuse a non-gesture navigation outright. Both cases are why the visible link is the page's _primary_ action rather than a footnote, and why the inline script is placed at the **end of `<body>`** — the fallback markup must have parsed and painted before the hop is attempted. Confirm actual behavior on-device.
- **iOS is live-only.** Each iteration costs a full TestFlight build plus a reinstall. Verify mechanisms in platform source _before_ dispatching a build — this is exactly what was skipped when `iosScheme` shipped.
- **Do NOT retry `iosScheme: 'https'`.** See the note now in `capacitor.config.ts`.
- **Bug B needs no separate fix, but does need separate verification.** The URL-bar evidence (`app.beanies.family` visible in the top bar) confirms the app was hosted in `SFSafariViewController`, so closing the OAuth return should close both symptoms. If the Safari chrome somehow survives build 9, that falsifies the shared-cause conclusion and Bug B becomes a genuinely separate defect — treat it as a new investigation rather than patching around it.
- **There is one intermediate window in the rollout** (after §Implementation-Order step 5, before build 9 installs): a real iOS OAuth return reaches the interstitial and the hop fails because the scheme is not yet registered. The user sees "almost there" with a dead link. That is **no worse than today's 404**, it affects only greg's TestFlight device, and it closes as soon as build 9 lands. Stated so nobody treats it as a regression.
- **`reportError` at `severity: 'error'` does not page Slack** — verified at `src/utils/errorReporter.ts:275` (`if (input.severity !== 'critical') return;`). It lands in the telemetry firehose only, which is what the backstop wants.
- **`logEvent` rate-limits on `(surface, normalized message)`** (`src/services/telemetry/logEvent.ts:74-102`), 50/minute. The native-OAuth events are once-per-sign-in, so this never bites; noted only so nobody expects per-`action` bucketing.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. ~~`ios/App/App/Info.plist` is tracked in git~~ — **verified** (`git check-ignore` returns non-zero; only `App/App/capacitor.config.json` is ignored). It currently has no `CFBundleURLTypes` (verified).
2. The Google Cloud OAuth client keeps `https://beanies.family/oauth/native` as a registered redirect URI; no Google console change is needed. (`getRedirectUri()` is untouched by this plan, so this must hold.)
3. The apex AASA remains valid and covers `/oauth/native` — **verified**: `web/public/.well-known/apple-app-site-association` carries the real appID `V2CKCNM3S7.family.beanies.app`. (Note: the comment in `ios/App/App/App.entitlements` still claims the AASA holds an `<APPLE_TEAM_ID>` placeholder. It is stale; correct it in the docs step so nobody re-chases it.)
4. iOS still has zero installed users beyond greg's TestFlight, so scheme changes carry no migration risk.
5. `mobile-ios-release.yml` runs `npx cap sync ios` (verified, line 87), so `Info.plist` changes reach the build without a committed generated file.
6. Android App Links for `beanies.family/oauth/native` are currently verified and working (`AndroidManifest.xml:33`, verified).
7. `oauth/native.html` is already present in the apex S3 bucket from a prior `deploy-web` run. **Verify before applying the CloudFront change** — if it is not there, the exemption turns a working 301 into a 403. The deploy ordering in §Implementation Order makes this safe either way.
8. Astro's `@` alias resolves to the Vue app's `src` (verified, `web/astro.config.mjs`), and the marketing site already imports Vue-app data modules through it, so a shared constants module is an established pattern rather than a new coupling.
9. The repo root `package.json` declares `"type": "module"` (**verified**) — this is load-bearing for §8's test strategy.

## Approach

### 0. One small module owns the URL contract — `src/constants/nativeOAuth.ts` (new, zero imports)

This is the DRY spine of the change. Three call sites need the same URLs and the same matching rule; none of them may hold a literal.

**API-surface discipline is the point.** An earlier draft sketched six exports, two of which (`isNativeOAuthRedirect` and `nativeOAuthTransport`) were two independent implementations of the same "is this our URL?" question — the exact kind of near-duplicate that drifts. They collapse into one. The final surface is five exports, and every one has a distinct caller:

```ts
/** The https Universal Link / App Link Google redirects to. Registered on the
 *  Web OAuth client — this is the value that must match at token exchange. */
export const NATIVE_REDIRECT_URI = 'https://beanies.family/oauth/native';

/** Custom-scheme bridge target. The scheme IS the bundle id (family.beanies.app),
 *  declared in ios/App/App/Info.plist CFBundleURLTypes and in AndroidManifest.xml.
 *  Exists because Apple does not fire Universal Links on server-side redirects
 *  inside SFSafariViewController — see docs/adr/029.
 *
 *  DRIFT GUARD: the two native manifests can't import this. A tripwire test
 *  (src/constants/__tests__/nativeOAuth.manifests.test.ts) reads both files and
 *  asserts they declare exactly this scheme. */
export const NATIVE_BRIDGE_URI = 'family.beanies.app://oauth/native';

/** The query params that mean "an OAuth result actually arrived". Shared with
 *  the Astro interstitial via define:vars so the two can't disagree. */
export const OAUTH_RESULT_PARAMS = ['code', 'error'] as const;

/**
 * Single matcher AND classifier: `null` means "not our OAuth return" (use it as
 * the guard), a non-null value is the transport (use it as the `action` telemetry
 * value). One function so a guard and a label can never disagree about what
 * counts as our URL.
 *
 * Exact-match on the base plus an optional `?`/`#` — a `startsWith` would also
 * match a look-alike such as `.../oauth/nativexyz`.
 */
export function nativeOAuthTransport(url: string): 'universal' | 'custom_scheme' | null { … }

/**
 * Query extraction that works identically for both schemes. Deliberately does
 * NOT use `new URL()`: for the custom scheme it yields host='oauth',
 * pathname='/native', which is a trap. Slices from the first '?' (stopping at
 * '#') and hands the substring to URLSearchParams. Cannot throw.
 */
export function nativeOAuthParams(url: string): URLSearchParams { … }

/**
 * `?code=…&state=…` → `family.beanies.app://oauth/native?code=…&state=…`.
 * Verbatim pass-through; never re-encoded. Takes a *search string* (leading '?'
 * optional), not a URL — see the units note below.
 */
export function nativeBridgeUrl(search: string): string { … }

/**
 * True when a search string carries an OAuth result worth delivering. A bare
 * visit (no code, no error) must NOT hop — it would arrive at the app with no
 * `state` and fire a spurious `native-oauth-state-mismatch` error report.
 */
export function hasOAuthResult(search: string): boolean { … }
```

**Units note (a real footgun, so it is stated once, here):** `nativeOAuthTransport` / `nativeOAuthParams` take a **full URL**; `nativeBridgeUrl` / `hasOAuthResult` take a **search string**. That split is inherent — the first pair inspects an inbound deep link, the second pair builds an outbound hop from `location.search`. Keep the two pairs verbally distinct (`…OAuth…(url)` vs `…(search)`) and cover the mis-call in tests; do not "unify" them by making everything take a URL, because the browser side never has one.

`googleAuth.ts` deletes its local `NATIVE_REDIRECT_URI` (line 48) and imports it from here, moving its explanatory comment along with it. `getRedirectUri()` is otherwise untouched — which is what keeps `calendarAuth.ts`'s three `getRedirectUri()` call sites correct for free.

**Zero imports is a hard constraint, not a preference.** The Astro marketing site imports this module, and it must not drag in Vue, Capacitor, or `vue-router` types. This is why the constants do **not** go in `src/constants/deepLinks.ts`, which imports `RouteLocationRaw`. A tripwire test asserts the file's source has no module-level `import`/`export … from`/`require(` (regex-anchored, §9.2), so the constraint fails in the fast unit gate rather than in the Astro build.

### 1. iOS — register the custom scheme

`ios/App/App/Info.plist`: add `CFBundleURLTypes` with one entry — `CFBundleURLName` = `family.beanies.app`, role `Editor`, `CFBundleURLSchemes` = `["family.beanies.app"]`. This is what makes iOS route the scheme to the app and lets `AppDelegate.application(_:open:options:)` → `ApplicationDelegateProxy` fire `appUrlOpen` (both verified present). No `LSApplicationQueriesSchemes` is needed (that governs outbound `canOpenURL`, which we do not use). Dots in a scheme are legal per RFC 3986 and are the iOS reverse-DNS convention.

### 2. Android — register the same scheme

`android/app/src/main/AndroidManifest.xml`: add a second `intent-filter` on the existing `.MainActivity` with `VIEW` + `DEFAULT` + `BROWSABLE` and `<data android:scheme="family.beanies.app" android:host="oauth" />`.

Rationale: without it, the two platforms diverge — an Android device whose App Link verification has lapsed lands on the interstitial and the bridge hop dead-ends with an unhandled-scheme error. With it, both platforms run the identical bridge path and Android gains a recovery route it does not have today. It is additive, cannot shadow the existing verified App Link filter (which stays first), and a unique scheme has exactly one handler so no disambiguation dialog appears. `launchMode="singleTask"` (already set) delivers it to the running instance.

### 3. Infrastructure — un-shadow the interstitial

`infrastructure/modules/web/functions/apex-cutover.js`. Do **not** add a new early-return block before the `isAppPath` check — an early `return request` skips the `.html` rewrite in step 3 and 403s from S3. The minimal, order-proof edit is a single guard on the existing branch.

Express the exemption as **data, not a boolean clause**, so the next exemption is a one-line list edit rather than another `&& !isSomething(uri)` accreting onto the branch condition:

```js
// Paths under an APP_PATHS prefix that the APEX must nonetheless serve itself.
// /oauth/native is the OAuth return the native apps use: Apple does not fire
// Universal Links on server-side redirects, so the request must reach the bridge
// interstitial (oauth/native.html) rather than 301 to app.beanies.family.
// EXACT match only (plus the trailing-slash form, which step 3 canonicalises) —
// a prefix would 403 on /oauth/native/<anything>, which does not exist.
// prettier-ignore
var APEX_OWNED_PATHS = [
  '/oauth/native',
];

function isApexOwned(path) {
  for (var i = 0; i < APEX_OWNED_PATHS.length; i++) {
    var p = APEX_OWNED_PATHS[i];
    if (path === p || path === p + '/') return true;
  }
  return false;
}
…
// 2. Authenticated PWA paths → app.beanies.family (except apex-owned ones,
//    which fall through to the .html rewrite below).
if (isAppPath(uri) && !isApexOwned(uri)) {
  return redirect('https://app.beanies.family' + uri + qs);
}
```

This cannot be mis-ordered and adds no new control flow to `handler`. `/oauth/native/` then hits the existing trailing-slash 301 → `/oauth/native` → rewrite to `/oauth/native.html`. The `/.well-known/` passthrough at step 0 is untouched and still runs first.

**This is the only edit to the file.** No test-only export is added — see §8.

Ship via `terraform apply` plus a CloudFront invalidation of `/oauth/native*`. Per project convention, read **every** resource change in the plan output, not just the intended one — manual console edits show as drift that Terraform will silently revert.

### 4. Marketing site — the bridge page

`web/src/pages/oauth/native.astro`:

- Frontmatter: `import { NATIVE_BRIDGE_URI, OAUTH_RESULT_PARAMS } from '@/constants/nativeOAuth'`.
- The "Return to beanies" anchor becomes the page's **primary action** (button treatment using the existing `--orange` token), rendered **statically** with `href={NATIVE_BRIDGE_URI}` (build-time interpolation) so it exists even if scripting is off or the script throws. On load, the script rewrites its `href` to include the live query string. It is primary, not secondary, because on iOS the manual tap is a realistic path: the OS may prompt, or may refuse a non-gesture custom-scheme navigation.
- `<script is:inline define:vars={{ bridge: NATIVE_BRIDGE_URI, resultParams: OAUTH_RESULT_PARAMS }}>` — `define:vars` implies `is:inline`, so both values are inlined at build time and **no JS bundle file is emitted**. A page whose entire job is to redirect in <100 ms must not block on a network fetch for its own logic.
- **Place the script at the end of `<body>`**, after the markup. If the hop triggers an OS prompt the user dismisses, or is refused, the fallback UI has already parsed and painted.

**Acknowledged duplication, deliberately bounded.** An `is:inline` script cannot import the shared module at runtime, so the _decision_ logic (`hasOAuthResult` / `nativeBridgeUrl`) exists in two forms: TypeScript in `nativeOAuth.ts`, and a handful of inline lines here. That is unavoidable; what is avoidable is letting the duplicated part grow. Two containment rules:

1. Every **value** the script needs (the bridge URI, the result-param names) is injected from the module via `define:vars` — never retyped. Only the three-line control flow is restated.
2. The inline script stays small enough to read at a glance. If it ever needs more than this, that is the signal to stop using `is:inline` and reconsider, not to keep growing it.

- Logic, all inside one `try`:
  - `const search = location.search;`
  - `const params = new URLSearchParams(search); const hit = resultParams.some((p) => params.has(p));` — if `!hit`, do **not** hop; just show the copy.
  - Update the anchor's `href` to `bridge + search`.
  - `location.replace(bridge + search)`.
  - `catch (e)`: `console.error('[oauth/native] bridge hop to ' + bridge + ' failed — the visible "Return to beanies" link is the fallback. Check that this scheme is declared in ios/App/App/Info.plist CFBundleURLTypes and android/app/src/main/AndroidManifest.xml.', e)` — note the scheme is **interpolated from `bridge`**, never retyped, so §9.3's tripwire stays true — and reveal an extra "if nothing happened, tap the link below" line that is otherwise `hidden`. Never swallow.
  - No analytics, no `logEvent` — the query string carries the auth `code` and nothing on this page may transmit it. This is the deliberate reason the page is un-instrumented; the app-side `action` event is the proxy signal.
- Keep all existing copy and the existing inline `<style>` tokens.

`web/astro.config.mjs`: `filter: (page) => !page.includes('/og/') && !page.includes('/oauth/')`.

### 5. App — accept both transports, and harden the now-wider door

`src/services/google/googleAuth.ts`, in `handleNativeAuthRedirect`:

- Replace `if (!url.startsWith(NATIVE_REDIRECT_URI)) return;` with:
  ```ts
  const transport = nativeOAuthTransport(url);
  if (!transport) return;
  ```
  One call yields both the guard and the telemetry label, and it closes the existing look-alike-prefix hole (`.../oauth/nativexyz`).
- Replace the `new URL(url).searchParams` + `try/catch` with `nativeOAuthParams(url)`, which is scheme-agnostic and cannot throw — deleting a `catch` rather than adding one.
- **Harden the stash parse.** `const stored: RedirectAuthState = JSON.parse(stateJson)` currently throws into a `void`-ed promise. Wrap it and treat an unparseable stash exactly like "no pending auth" (`await clearGoogleSessionState()`, `logEvent` at `info` with `action: 'stash_unparseable'`, return). This is required by the widened attack surface described in §Context, and it is the only behavioural change to the function's body.
- Update **both** "defense-in-depth atop the verified link" comments — the one on the `state` CSRF check in `handleNativeAuthRedirect`, and the one in `startRedirectAuth`'s native branch (`googleAuth.ts:1866`). Post-change the `state` check is the **primary** authenticity control, because a custom scheme is invokable by anyone. Say so in both, so nobody prunes it later.
- `await Browser.close().catch(() => {})` stays exactly where it is: on iOS the `SFSafariViewController` is still presented over the app when the custom-scheme hop lands, so this is what dismisses it.
- Everything else downstream — the state-mismatch `reportError`, the missing-`code` `reportError`, the calendar-grant stash under `REDIRECT_AUTH_CODE_KEY_CALENDAR`, `completeRedirectAuth()` and its `catch` → `reportError` → `onComplete(returnPath)` recovery — is **unchanged**.

Also update the module comment at `googleAuth.ts:2065-2066` ("returns via the verified App Link") to describe both transports.

### 6. App — a loud, race-free router backstop

`src/router/index.ts`. A silent "redirect to `/welcome`" would drop the code and re-create Bug A with no signal. Bouncing back to the apex (via the existing `externalRedirect` helper, line 36) is worse — if the apex exemption ever regresses, that is an infinite redirect loop.

**No `beforeEnter`, no timers.** An earlier draft attempted a scheme hop then armed a `setTimeout(2000)` to `location.replace('/welcome?authError=nativeBridge')` and `return false`. Three problems, all miserable to support:

- **The timer races the hop it is meant to backstop.** On a successful hop the app backgrounds; the timer is not cancelled and fires when the WebView resumes — navigating a _successful_ sign-in away to an error surface. There is no reliable, cheap way to distinguish "scheme unhandled" from "scheme handled, app backgrounded".
- **`return false` aborts the navigation**, leaving the router on its previous location with a `location.replace` in flight.
- It required a **timer-mocked** test for a path that should never execute, and it pulled `LoginPage.vue`, `uiStrings.ts` and a `npm run translate` run into the change purely to deliver one toast.

Instead: make the backstop a **real, tiny page** — the Vue-side twin of the Astro interstitial. Same contract (explain, offer the scheme link, attempt the hop once), so there is exactly one recovery UX across both surfaces, no timers, no `return false`, no navigation race.

```ts
// Placed immediately after the existing '/oauth/callback' route (~line 263),
// well before the ':pathMatch(.*)*' catch-all.
{
  path: '/oauth/native',
  name: 'OAuthNativeBridge',
  component: () => import('@/pages/OAuthNativeBridgePage.vue'),
  meta: { requiresAuth: false, hideQuickAdd: true, noChrome: true },
},
```

`src/pages/OAuthNativeBridgePage.vue` — small and single-purpose:

```ts
// Reaching this URL in the Vue app means the apex exemption for /oauth/native
// regressed (see infrastructure/modules/web/functions/apex-cutover.js) or a
// stale bare-URL 301 was cached on-device. It is never expected. Report it,
// then behave exactly like the Astro interstitial: offer the bridge and say so.
onMounted(() => {
  reportError({
    surface: 'native-oauth',
    severity: 'error',
    message:
      'OAuth native return reached the Vue app — apex /oauth/native exemption is not serving',
    context: { action: 'web_backstop', route_path: window.location.pathname },
  });
  if (hasOAuthResult(window.location.search)) {
    window.location.replace(nativeBridgeUrl(window.location.search));
  }
});
```

The template is the same three elements as the interstitial: title, one line of explanation, and an `<a :href="bridgeHref">` "Return to beanies" link (rendered whether or not the hop is attempted, so a blocked or dismissed hop leaves a working manual path). Three `uiStrings` keys (`oauth.nativeBridgeTitle`, `oauth.nativeBridgeBody`, `oauth.nativeBridgeAction`), `en` + `beanie`, brand voice ("we couldn't hand you back to the app"), then `npm run translate`. i18n is CI-enforced (`vue/no-bare-strings-in-template`, CLAUDE.md §270), so hardcoding is not an option. Because §6a bails out of App.vue init before settings hydrate, `t()` will resolve against the `en` defaults on this page — acceptable for a diagnostic surface that should never render.

`severity: 'error'` (not `critical`): the user can still recover by signing in again, and — verified at `errorReporter.ts:275` — `error` is telemetry-only, so this lands in the CloudWatch firehose without paging Slack.

**`src/pages/LoginPage.vue` is out of scope.** An earlier draft generalised its single `if (route.query.authError === 'storage')` branch into an `AUTH_ERROR_TOASTS` table to accommodate a second key. With the recovery surface owning its own copy, that second key does not exist — so the table would be a lookup map with one entry, added for a caller that was designed away. Leave the existing `if` alone.

### 6a. App.vue — stop the boot logic bouncing the backstop to `/welcome` (required, not optional)

**Without this, §6 does not work.** `src/App.vue:871-886` redirects any route whose `name` is not in the `authPages` list to `/welcome` when `authStore.needsAuth` — and the backstop is by definition reached by an _unauthenticated_ user mid-sign-in. `OAuthNativeBridge` is not in that list, so the page would mount, fire its `reportError`, and then be replaced by the welcome gate: Bug A again, with a log line.

There is an exact precedent for the fix, and it sits **before** the `needsAuth` block: the `if (route.name === 'OAuthCallback') { … return; }` early bail at `src/App.vue:719`. Extend it rather than adding a second mechanism:

```ts
// Terminal OAuth surfaces — bail before ANY heavy init.
//   OAuthCallback     : a pure bounce route; the page is unloading, so an
//                       in-flight `await import()` can resolve to null and throw
//                       (the iPhone crash of 2026-06-20).
//   OAuthNativeBridge : the /oauth/native backstop. It must NOT run the
//                       unauthenticated `router.replace('/welcome')` below —
//                       the whole point of the page is to stay on screen and
//                       explain, with the auth code intact in the URL.
if (route.name === 'OAuthCallback' || route.name === 'OAuthNativeBridge') {
  initBreadcrumbs.push(`${String(route.name)}: terminal oauth surface — skipping heavy init`);
  return;
}
```

The existing `finally` still dismisses the boot spinner. No change is needed to `authPages`, `publicOnlyPages`, or `PODLESS_EXPECTED_ROUTE_NAMES` (that last one keys on authenticated-but-podless, which this route can never be). A unit test asserts the bail: with `authStore.needsAuth === true` and `route.name === 'OAuthNativeBridge'`, `router.replace` is never called with `/welcome`.

### 7. Observability — reuse `action`, add no new key

`ALLOWED_CONTEXT_KEYS` already carries a generic `action` key (`src/utils/diagnosticContext.ts:61`, verified; mirrored in `infrastructure/lambda/telemetry/index.mjs:47` and pinned by `infrastructure/lambda/telemetry/__tests__/handler.test.mjs:285`). It is the established vehicle for exactly this — see `syncService.ts` (`action: 'skipped' | 'deleted' | 'failed'`) and the biometric surface (`action: 'user_cancel' | 'ok' | …`). The key is allowlisted; values are not schema-validated, so the convention (short `snake_case` slug) is what keeps the field a flat enum for CloudWatch consumers.

Reusing it removes a **seven-place coupled change**: the client allowlist, the Lambda mirror, the Lambda pinned test, `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, the Play Data-Safety / App-Privacy answers, and `privacy.astro`. All become no-ops. No new data category is collected, so no store re-declaration is required.

Values use `snake_case` throughout, matching every existing `action` value in the codebase — **not** a `return:universal` colon form, which would force CloudWatch consumers to substring-parse a field that is otherwise a flat enum.

Events, all `surface: 'native-oauth'` (one CloudWatch filter isolates the whole flow):

| Where                                                            | level                       | `action`                                    | Why                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startRedirectAuth` native branch, after `Browser.open` resolves | `info`                      | `start`                                     | Started-vs-returned pairing. A started flow with no matching return is Bug A, visible as an absence. This is the signal that would have caught it on build 7.                        |
| `handleNativeAuthRedirect`, after the transport guard            | `info`                      | `return_universal` / `return_custom_scheme` | The one thing two failed blind builds could not tell us: which transport delivered the link, or whether anything arrived at all. Value comes straight from `nativeOAuthTransport()`. |
| after a successful `completeRedirectAuth()`                      | `info`                      | `complete`                                  | Success counter — without it the failure _rate_ is unmeasurable.                                                                                                                     |
| existing "no pending auth" branch                                | `info`                      | `no_pending`                                | Add the `action` to the existing event; no new event.                                                                                                                                |
| existing "oauth declined/error" branch                           | `info`                      | `declined`                                  | Same — annotate, don't duplicate.                                                                                                                                                    |
| new unparseable-stash branch (§5)                                | `info`                      | `stash_unparseable`                         | Distinguishes "nothing in flight" from "something in flight but corrupt".                                                                                                            |
| `OAuthNativeBridgePage` mount                                    | `error` (via `reportError`) | `web_backstop`                              | Apex exemption regressed.                                                                                                                                                            |

Preserved unchanged: the `native-oauth-state-mismatch` `reportError` (severity `error`), the neither-code-nor-error `reportError`, and the exchange-failure `reportError`. No bare `catch {}` is introduced anywhere. Nothing above warrants `severity: 'critical'` — sign-in failure is retryable and risks no data.

The auth `code` must never appear in any `message` or `context` field; only the transport class and the branch name are logged.

### 8. Make the CloudFront function testable — without touching the production file

`apex-cutover.js` is production-critical, hand-written ES5, and has **zero tests** today — while this plan's single largest hazard is getting its branch order wrong. It must gain tests.

An earlier draft proposed appending a guarded `if (typeof module !== 'undefined') module.exports = {…}` to the function. **That does not work in this repo.** The root `package.json` declares `"type": "module"` (verified), so under vitest `apex-cutover.js` is loaded as ESM, `module` is undefined, the guard is dead code, and the test imports nothing. It also introduced a pre-apply `aws cloudfront test-function` step that is chicken-and-egg (you cannot test-function code that has not been published) and it edited a file that `eslint.config.js:347` explicitly ignores with the comment "not ESM".

Do the boring, correct thing instead: **load the file's source and evaluate it in a sandbox.** The production file stays byte-identical to what CloudFront runs, so the test can never disagree with reality about the file's shape, and there is no runtime-compatibility question to verify.

`infrastructure/modules/web/functions/__tests__/apexCutover.test.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

// apex-cutover.js is a CloudFront Functions script: a bare ES5 file with a
// global `handler(event)` and NO module system (the runtime has neither
// `require` nor `module`, and this repo is "type": "module" so a `module.exports`
// sniff would be dead code). Evaluating the real source in a fresh VM context is
// the only way to test the SHIPPED bytes without adding anything to them.
const src = readFileSync(fileURLToPath(new URL('../apex-cutover.js', import.meta.url)), 'utf8');
const { handler, isAppPath, isApexOwned } = runInNewContext(
  `${src}\n;({ handler, isAppPath, isApexOwned })`
);
```

`node:vm` (not `new Function`) because it is stdlib, gives a clean global, and reads as intent rather than as a trick. This directory is eslint-ignored (`eslint.config.js:347`), so no `no-new-func`/security-rule exemption is needed either way.

Extend `vitest.config.ts`'s `include` (currently three globs, lines 17-21) with `'infrastructure/modules/web/functions/**/*.{test,spec}.mjs'` so it runs in the standard gate.

Cases: `/oauth/native` → rewritten to `/oauth/native.html`, not a 301; `/oauth/native?code=x&state=y` → same, query preserved; `/oauth/native/` → 301 to `https://beanies.family/oauth/native`; `/oauth/native/extra` → still 301s to the app; `/oauth/nativexyz` → still 301s to the app (proves exact-match, not prefix); `/oauth/callback` → 301 to `app.beanies.family`; `/dashboard` → 301; `/.well-known/apple-app-site-association` → passthrough (must stay ahead of everything); `/beanstalk/x` → 301 to `/blog/x`; `/home` → 301 to `/`; `/blog/foo` → `.html` rewrite; `/` → `/index.html`.

After `terraform apply` publishes the function (CloudFront validates the code at publish time, so a bad file fails the apply rather than production), run `aws cloudfront test-function` against the live function for `/oauth/native` and `/oauth/callback` as a belt-and-braces confirmation that the deployed bytes behave like the tested ones.

### 9. Drift tripwires (three cheap tests, all in the normal unit gate)

The scheme string genuinely cannot be single-sourced — `Info.plist` and `AndroidManifest.xml` cannot import TypeScript. So guard it instead of hoping. All three live in `src/constants/__tests__/nativeOAuth.manifests.test.ts` and are `readFileSync` assertions.

1. **Manifests declare the scheme.** Derive `scheme = NATIVE_BRIDGE_URI.split('://')[0]`; assert `ios/App/App/Info.plist` contains `<string>${scheme}</string>` within a `CFBundleURLSchemes` array, and that `android/app/src/main/AndroidManifest.xml` contains `android:scheme="${scheme}"`. If someone renames the bundle id, this fails in seconds instead of in a TestFlight build.
2. **Zero-dependency constraint.** Assert `src/constants/nativeOAuth.ts`'s source does not match `/^\s*(import\s|export\s[\s\S]*?\sfrom\s|.*\brequire\()/m` — regex-anchored, not a naive `includes('import')`, which any doc comment mentioning the word would trip.
3. **The Astro page consumes the module rather than restating it.** Assert `web/src/pages/oauth/native.astro` contains **no** occurrence of the literal `family.beanies.app://`. One crisp assertion. (An earlier draft also banned the literals `'code'`/`'error'`, which is both brittle — those words appear in prose and comments — and self-contradictory with §4's `console.error` guidance. §4 now interpolates `bridge` into that message, so this assertion holds.)

These cost nothing to run and they are the only thing standing between this design and slow, expensive drift.

## Implementation Order (sequencing matters)

1. `src/constants/nativeOAuth.ts` + unit tests + the §9 tripwires (pure, no dependencies).
2. `googleAuth.ts` rewire (transport guard, `nativeOAuthParams`, stash hardening, **both** comment updates) + telemetry; `OAuthNativeBridgePage.vue` + router entry + **the App.vue §6a bail** + `uiStrings` + `npm run translate`.
3. `web/src/pages/oauth/native.astro` + `astro.config.mjs`.
4. **Run `deploy-web` (`workflow_dispatch`) FIRST.** This puts the bridge-enabled `oauth/native.html` in the apex bucket. Doing it after the CloudFront change would expose a window in which the exemption serves a stale (or absent) page.
5. `apex-cutover.js` (exemption only) + `apexCutover.test.mjs` + the `vitest.config.ts` include → `terraform plan` (read every resource) → `apply` → `aws cloudfront test-function` sanity check → invalidate `/oauth/native*`. Then `curl -I` assert: 200 on `/oauth/native`, 301 on `/oauth/callback`.
6. `Info.plist` + `AndroidManifest.xml`, then dispatch TestFlight build 9 (`npx cap sync ios` runs in the workflow).
7. Docs: ADR-029 amendment (including the `ASWebAuthenticationSession` → `SFSafariViewController` correction), the stale AASA-placeholder comment in `ios/App/App/App.entitlements`, `docs/STATUS.md`, `CHANGELOG.md`, `docs/prompts/`, and save this plan to `docs/plans/`.

## Rollback

One line per irreversible-looking step, so a bad build 9 does not become an incident:

- **Steps 1-3 (app + marketing code)** — revert the commit; `deploy-web` / `deploy-app` restore the previous artefacts. The interstitial reverts to inert copy, which is its pre-change behaviour.
- **Step 5 (CloudFront)** — revert `apex-cutover.js` and `terraform apply` + invalidate `/oauth/native*`. `/oauth/native` returns to 301ing, i.e. exactly today's (broken but known) state. Roughly 5 minutes. A syntax error cannot reach production: CloudFront validates function code at publish, so the apply fails first.
- **Step 6 (native manifests)** — no rollback needed and none possible mid-flight: an unused registered scheme is inert. If build 9 is bad, ship build 10; do not attempt to unregister.
- **The combination is safe to leave half-applied.** Every intermediate state degrades to "user sees the 'almost there' page", never to data loss and never to a redirect loop.

## Files Affected

- `src/constants/nativeOAuth.ts` — **new**: single source of truth for both URIs, the transport matcher/classifier, the param extractor, the bridge-URL builder, and the result-param names (zero imports so Astro can consume it)
- `src/constants/__tests__/nativeOAuth.test.ts` — **new**
- `src/constants/__tests__/nativeOAuth.manifests.test.ts` — **new**: the three §9 drift tripwires
- `src/services/google/googleAuth.ts` — import the constant from its new home; single transport guard; scheme-agnostic param extraction; hardened stash parse; updated CSRF comments in **both** `handleNativeAuthRedirect` and `startRedirectAuth`; updated module comment; `action` telemetry
- `src/router/index.ts` — `/oauth/native` route, placed beside `/oauth/callback`
- `src/pages/OAuthNativeBridgePage.vue` — **new**: the Vue-side twin of the interstitial (report, offer, hop once — no timers)
- `src/App.vue` — **required**: extend the existing `OAuthCallback` terminal-surface bail (line 719) to cover `OAuthNativeBridge`, so the boot logic cannot `router.replace('/welcome')` the backstop away (§6a)
- `src/services/translation/uiStrings.ts` — 3 keys (`en` + `beanie`)
- `src/services/google/__tests__/googleAuth.native.test.ts` — extend for the custom-scheme transport + the unparseable-stash branch
- `src/services/google/__tests__/googleAuth.calendarGrant.native.test.ts` — one custom-scheme case, so the shared `getRedirectUri()` path is covered on both transports
- `src/__tests__/` (App.vue boot suite) — one case asserting the `OAuthNativeBridge` bail
- `web/src/pages/oauth/native.astro` — build-time-inlined bridge + static primary fallback link, script at end of `<body>`
- `web/astro.config.mjs` — sitemap filter excludes `/oauth/`
- `infrastructure/modules/web/functions/apex-cutover.js` — `APEX_OWNED_PATHS` data-driven exemption on the `isAppPath` branch. **Nothing else** — no test export
- `infrastructure/modules/web/functions/__tests__/apexCutover.test.mjs` — **new**, `node:vm` source-load harness
- `vitest.config.ts` — include the CF-function test dir
- `ios/App/App/Info.plist` — `CFBundleURLTypes`
- `android/app/src/main/AndroidManifest.xml` — custom-scheme `intent-filter`
- `ios/App/App/App.entitlements` — comment-only: the AASA no longer holds an `<APPLE_TEAM_ID>` placeholder (verified `V2CKCNM3S7`)
- `docs/adr/029-capacitor-native-app-store-distribution.md` — amend: record why the bridge is now required, that `state` validation is now the primary authenticity control, and correct §47's claim that iOS uses `ASWebAuthenticationSession` (it is `SFSafariViewController` via `@capacitor/browser`)

**Deliberately NOT touched** (and why — so a reviewer does not think they were forgotten): `src/utils/diagnosticContext.ts`, `infrastructure/lambda/telemetry/index.mjs`, `docs/runbooks/native-store-submission.md`, `ios/App/App/PrivacyInfo.xcprivacy`, `web/src/pages/privacy.astro` — no new context key is introduced. `googleAuth.getRedirectUri()` and all of `src/services/calendar/calendarAuth.ts` — the `redirect_uri` contract with Google is unchanged, so the calendar grant inherits the fix. `src/pages/LoginPage.vue` — its single `authError` branch is left alone rather than generalised for a case this plan no longer creates. `capacitor.config.ts` — the `iosScheme` do-not-retry note stays. `App.entitlements`' `applinks` association — the Universal Link stays useful for genuine user taps.

## Acceptance Criteria

- [ ] `family.beanies.app` is registered in `Info.plist` **and** `AndroidManifest.xml`, and the built apps are launchable via that scheme on both platforms
- [ ] Exactly one definition of each native-OAuth URL exists in the repo (`src/constants/nativeOAuth.ts`); `grep -rn "family.beanies.app://" src web` returns one source line
- [ ] The drift tripwires pass and genuinely fail when broken: flipping the scheme in `Info.plist`, adding an `import` to `nativeOAuth.ts`, or hardcoding the scheme URI in `native.astro` each turn the suite red
- [ ] `src/constants/nativeOAuth.ts` exports exactly the five documented symbols — no `isNativeOAuthRedirect`, no second matcher
- [ ] `https://beanies.family/oauth/native` serves the Astro interstitial (HTTP 200, not a 301); `.../oauth/native/` 301s to the canonical form; `.../oauth/nativexyz` still 301s to the app
- [ ] `https://beanies.family/oauth/callback` still 301s to `app.beanies.family` exactly as before, and `/.well-known/apple-app-site-association` still passes through
- [ ] The interstitial auto-redirects to the custom scheme via `location.replace`, preserving the full query string, and emits **no** network request for its own script
- [ ] The interstitial does **not** hop on a bare visit (no `code`, no `error`)
- [ ] The interstitial's "Return to beanies" link is the page's primary action, present in the static HTML, above the inline script, and works with JS disabled
- [ ] A thrown bridge script logs an actionable `console.error` that names the scheme **by interpolating the injected value** and points at `Info.plist`/`AndroidManifest.xml`, and reveals the manual-tap hint — nothing is swallowed
- [ ] The interstitial loads no analytics and never logs the auth `code`
- [ ] `handleNativeAuthRedirect` accepts both URLs and rejects look-alikes (`.../oauth/nativexyz`); `state` mismatch, missing `code`, and calendar-grant behaviour are unchanged; an unparseable stash is handled as a benign no-op rather than an unhandled rejection
- [ ] Both "defense-in-depth atop the verified link" comments (handler + `startRedirectAuth`) now describe `state` as the primary authenticity control
- [ ] `/oauth/native` in the Vue app never renders the 404 page, **is not replaced by `/welcome`** for an unauthenticated visitor, fires a `reportError` at `error`, renders translated explanatory copy with a working manual bridge link, and contains **no `setTimeout`** — its test needs no fake timers
- [ ] `/oauth/` is excluded from the sitemap
- [ ] `apex-cutover.js` has automated tests covering the ordering hazard, they run in `npm run test:run`, and **the production file contains no test-only code** — the harness loads its real source via `node:vm`
- [ ] Telemetry uses only the existing `action` key — `ALLOWED_CONTEXT_KEYS` and the Lambda mirror are unmodified and their pinned tests still pass — and every value is `snake_case`
- [ ] `action` fires with the right value at flow start, on both return transports, and on the success path
- [ ] **On-device (TestFlight build 9, fresh reinstall): first sign-in lands directly on `/nook`** — no 404, no bounce to the welcome gate, no second sign-in needed
- [ ] **On-device: no Safari chrome anywhere in the session, and no domain visible in a top bar** — this is the direct test of the confirmed shared cause. If chrome survives, stop and re-investigate rather than patching around it
- [ ] Android sign-in re-verified as non-regressed on a production build
- [ ] Native calendar connect (the `grant: 'calendar'` path) re-verified on the same build

## Testing Plan

1. **Unit — `nativeOAuth.ts`**: `nativeOAuthTransport` returns `'universal'`/`'custom_scheme'` for exactly the two bases, with and without a query/fragment, and `null` for `.../oauth/nativexyz`, `https://evil.com/oauth/native`, `family.beanies.app://something-else`, and unrelated deep links. `nativeOAuthParams` returns identical `code`/`state` for the https and custom-scheme forms — asserting explicitly that we never depend on `host`/`pathname` (which differ). `nativeBridgeUrl` passes the query through byte-for-byte, with and without a leading `?`. `hasOAuthResult` is false for `''` and `'?foo=1'`, true for `?code=…` and `?error=access_denied`.
2. **Unit — `googleAuth.native.test.ts`**: the existing suite already covers the https transport, state mismatch, missing code, unrelated links, and the calendar grant. Extend by parameterising the happy-path and state-mismatch cases over both transports, adding the unparseable-stash case, and asserting the `action` values on the start/return/complete events. Do not duplicate the suite.
3. **Unit — `googleAuth.calendarGrant.native.test.ts`**: one custom-scheme case proving the calendar branch stashes under `REDIRECT_AUTH_CODE_KEY_CALENDAR` on the new transport too.
4. **Unit — `OAuthNativeBridgePage`**: mounts → `reportError` called once with `action: 'web_backstop'`; with `?code=…` it calls `location.replace` with the bridge URL; with no result params it does not; the manual link renders in both cases. No timer mocking anywhere.
5. **Unit — App.vue boot**: with `needsAuth === true` and `route.name === 'OAuthNativeBridge'`, init returns early and `router.replace` is never called with `/welcome`. (Regression guard for §6a — the failure this catches is invisible in every other test.)
6. **Unit — `apexCutover.test.mjs`**: the routing table above, driven off the real file's source via `node:vm`.
7. **Local** — `npm run dev:web`; confirm `/oauth/native?code=x&state=y` renders, the fallback link carries the query string, `location.replace` is attempted, and a bare `/oauth/native` does not attempt a hop. Confirm the built `dist/oauth/native.html` contains the scheme inline, references no external `.js`, and has the `<script>` after the `<a>`.
8. **Infra** — `terraform plan` (read every resource change) → apply → `aws cloudfront test-function` on the published function → invalidate → `curl -I` the assertions in §Acceptance.
9. **Gates** — `npm run type-check`, `npm run lint`, `npm run test:run`, `npm run test:lambda` (proves the allowlist mirror is untouched), production build.
10. **On-device (TestFlight build 9, fresh reinstall)** — full first-sign-in flow; confirm landing on `/nook` first time; note whether an "Open in beanies.family?" prompt appears; then confirm no Safari chrome and no domain in any top bar for the rest of the session; then connect a calendar to exercise the `grant: 'calendar'` return.
11. **Regression** — Android production-build sign-in (verified App Link path, should never see the interstitial); web/PWA sign-in via the unchanged `/oauth/callback`; the existing `?authError=storage` toast still fires (unmodified, but confirm the untouched branch).
12. **Post-build triage query** — confirm the CloudWatch filter `surface = "native-oauth"` returns the `start` → `return_*` → `complete` triple for greg's device. If it does not, the plan's own premise is falsified and that is the next thing to read.

## Review Passes

- **Pass 1 (Initial draft)**: drafted the custom-scheme bridge from the verified root cause; discovered the existing unreachable `native.astro` interstitial and scoped the change around reusing it.
- **Pass 2 (DRY / error handling / simplicity)**: extracted `src/constants/nativeOAuth.ts` as the single owner of both URIs (the draft would have written the custom scheme in three files); swapped the proposed new `link_transport` telemetry key for the already-allowlisted `action` key, deleting a seven-place coupled change including the Lambda allowlist mirror and its pinned test; replaced the draft's early-return exemption in `apex-cutover.js` with a single exact-match guard (an early return skips the `.html` rewrite and 403s, and the draft's `/oauth/native/*` prefix would 403 on sub-paths); replaced the silent router redirect with a reporting bridge-retry backstop and rejected `externalRedirect()` as loop-forming; generalised `LoginPage`'s `authError` branch into a table; added a `shouldBridge` guard against false state-mismatch reports; added try/catch + actionable console guidance + a static no-JS fallback link; added tests for the untested prod-critical CloudFront function; added the Android manifest entry so both platforms share one path; added deploy sequencing and a "deliberately not touched" list.
- **Mid-plan evidence update (greg, on-device)**: the top bar in the broken state shows `app.beanies.family`. A native `WKWebView` has no URL display, so this **confirms** the app was running inside `SFSafariViewController` and that Bugs A and B share one cause. Context, caveats and acceptance criteria updated from "Bug B unconfirmed, re-check after" to "Bug B expected fixed by this change; its persistence would falsify the shared-cause conclusion".
- **Pass 3 (Sustainability / maintainability / reliability)**: cut the shared module's API from six exports to five by collapsing `isNativeOAuthRedirect` and `nativeOAuthTransport` — two independent implementations of "is this our URL?" that would inevitably drift — into one function whose `null` is the guard and whose value is the telemetry label, and documented the URL-vs-search-string units split as a named footgun. **Removed the router backstop's `setTimeout(2000)` race**, which could not distinguish "scheme unhandled" from "scheme handled, app backgrounded" and would have navigated successful sign-ins to an error surface; replaced the `beforeEnter: () => false` abort with a small real page (`OAuthNativeBridgePage.vue`) that mirrors the Astro interstitial's contract, needs no fake timers, and cannot strand the user. That in turn **removed `LoginPage.vue` from the change entirely** — Pass 2's `AUTH_ERROR_TOASTS` table was speculative generality for a second key this design no longer creates. Turned the CloudFront exemption from a boolean clause (`&& !isNativeOAuthPath`) into an `APEX_OWNED_PATHS` data list so future exemptions are a one-line list edit rather than accreting `&&` conditions. Replaced the `new Function` source-eval test harness with a `typeof module !== 'undefined'` guarded export plus a mandatory `aws cloudfront test-function` verification. Normalised `action` values to `snake_case` (`return_universal`, `web_backstop`) instead of the colon-composite `return:universal`, which would have forced substring parsing of an otherwise-flat enum. Added a **security-consequence section**: registering a custom scheme makes `handleNativeAuthRedirect` invokable by any app or web page, promoting the `state` check from defense-in-depth to primary control and making the currently-unguarded `JSON.parse(stateJson)` an unhandled-rejection path worth closing. Added three cheap `readFileSync` **drift tripwires** for the one string that genuinely cannot be single-sourced, plus guards on the zero-import constraint and on the Astro page re-stating constants. Bounded the unavoidable Astro-inline-script duplication with two explicit containment rules and by injecting `OAUTH_RESULT_PARAMS` through `define:vars`. Added a **Rollback** section, an explicit note about the benign intermediate window between the CloudFront apply and build 9, and calendar-grant coverage.
- **Pass 4 (Fresh eyes / final sweep)**: found three blockers and fixed them. **(1) The router backstop could not have worked.** `src/App.vue:871-886` `router.replace('/welcome')`s any route whose name is absent from its `authPages` list whenever `authStore.needsAuth` — which is precisely the state the backstop is reached in — so §6's page would have mounted, logged, and then been bounced, re-creating Bug A with a log line. Added **§6a**, which extends the _existing_ `route.name === 'OAuthCallback'` terminal-surface bail at `App.vue:719` (already positioned before the `needsAuth` block) rather than introducing a second mechanism, plus a regression test for a failure mode no other test would see. **(2) Pass 3's CloudFront test export was dead code in this repo.** Root `package.json` is `"type": "module"` (verified), so under vitest `apex-cutover.js` loads as ESM, `typeof module === 'undefined'`, the guard never fires and the test imports nothing; the mandated pre-apply `aws cloudfront test-function` was also chicken-and-egg (you cannot test unpublished code), and the edit targeted a file `eslint.config.js:347` ignores as explicitly "not ESM". Reverted to loading the real source — via stdlib `node:vm.runInNewContext`, not `new Function` — so the production function stays byte-identical to what CloudFront runs, no compatibility question needs verifying, and the `test-function` call becomes a post-apply sanity check instead of a prerequisite. **(3) §4 and §9.3 directly contradicted each other**: the catch-block `console.error` hardcoded `family.beanies.app`, which the tripwire forbade. Fixed by interpolating the injected `bridge` value into the message, and narrowed the tripwire to one crisp assertion (no `family.beanies.app://` literal), dropping the brittle `'code'`/`'error'` clause that prose and comments would trip. Smaller corrections: the "defense-in-depth atop the verified link" framing exists in **two** places (`handleNativeAuthRedirect` _and_ `startRedirectAuth:1866`) and both must change or they will disagree; tightened tripwire #2 to an anchored regex over `import`/`export … from`/`require(` instead of a naive substring test; specified that the Astro inline script sits at the **end of `<body>`** and that the fallback anchor is the page's **primary** action, because a refused or dismissed custom-scheme navigation makes the manual tap a realistic path rather than a footnote; verified and recorded that `severity: 'error'` is telemetry-only (`errorReporter.ts:275`) and that `logEvent` rate-limits per `(surface, normalized message)`; softened the "fixed-enum" claim about `action` (the key is allowlisted, values are convention-only); confirmed the AASA carries the real Team ID `V2CKCNM3S7`, making Assumption 3 verified and the contrary comment in `App.entitlements` stale (queued as a comment-only fix); noted that ADR-029 §47 wrongly states iOS uses `ASWebAuthenticationSession` when `@capacitor/browser` uses `SFSafariViewController` — a documentation error that materially contributed to this bug going unpredicted, and now part of the ADR amendment; and added `/oauth/nativexyz` and the `/.well-known/` passthrough to the CloudFront test table so the exact-match and branch-order guarantees are both pinned.

## Prompt Log

> **No GitHub issue created.** This plan was approved for direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial context — `/good-morning` (session start)

Session opened with the standard start-of-day ritual. The top pending item in `docs/STATUS.md` was a parked fix from the previous session: _"FIRST THING NEXT SESSION — set `iosScheme: 'https'` in `capacitor.config.ts`"_, described there as the diagnosed root cause of two on-device iOS TestFlight nav bugs.

### Follow-up 1

> yes, start with the iosScheme fix

### Follow-up 2 — `/deploy-prod-auto`

> no release note and dispatch ios build directly

Shipped `28545343` (the `iosScheme` change) + `55339a39` (APP_VERSION 0.9.9R3). Web prod deploy and iOS TestFlight **build 8** both green.

### Follow-up 3 — the fix did not work

> Have installed build v8 and still seeing the same issue. Symptoms are as below:
>
> - App opens to welcome gate (full screen - no safari controls)
> - after choosing welcome back and completing google consent screen, FIRST screen is always the 404 screen, which then quickly redirects back to welcome gate
> - after SECOND sign in from the google consent flow, sign in correctly lands at /nook
> - after pressing the first item (navigating or tapping any item) the safari controls appear

This triggered the investigation that found the real root cause: `iosScheme: 'https'` is a silent no-op (Capacitor rejects any scheme WKWebView natively handles), and the actual failure is that Apple does not fire Universal Links on server-side redirects inside `SFSafariViewController`.

### Follow-up 4 — `/end-session`

> please capture all context and information and recommendations to restart in a new session. i am leaning towards A but wondering how we could do B if it won't work on older iphones (requires iOS 17.4+ which excludes a huge segment of iphone users - if that's the case what is teh alternative) - let's capture this and all relevant context so we can restart next session cleanly

This question is what produced **Option D** (the custom-scheme bridge) — the approach this plan implements. B's https callback is iOS 17.4+; the bridge works on iOS 12+ with no plugin, entitlement, or deployment-target change.

### Follow-up 5

> let's continue the session - do you recommend we move directly to fix or prepare /beanies-plan to prepare the fix you proposed for the ios app

Recommendation was to plan it, given the change spans three subsystems, touches the OAuth flow's documented invariants, and iOS is live-only (each iteration costs a TestFlight build).

### Follow-up 6 — `/beanies-plan`

> ok kick off the plan

### Follow-up 7 — clarifying answers (AskUserQuestion)

- **Bug B scope**: _"When you say 'the safari card' i'm not sure exactly what you mean, but while using the beanies app, after the safari overlay controls appear, when i swipe the app up to bring up the app cards, the card showing is still the beanies app icon, however it has safari overlay controls at the top and bottom. i can confirm the app didn't switch to safari, but the controls appeared on the app"_
  (The proposed discriminator was flawed — `SFSafariViewController` presents modally inside the host app and never yields its own app-switcher card, so "no Safari card" could never have been evidence either way.)
- **Interstitial behaviour**: auto-redirect, with the tap link as fallback
- **Custom scheme**: `family.beanies.app` (matches the bundle ID)

### Follow-up 8 — the conclusive evidence (mid-plan)

> the top bar shows "app.beanies.family"

A native `WKWebView` has no URL display, so a visible domain proves the app was running inside `SFSafariViewController`. This **confirmed Bugs A and B share one cause** and was folded into the plan before Pass 3.

</details>
