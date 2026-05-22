# Plan: Unify Google Drive OAuth on the redirect transport for native + installed PWA (fix sign-in / load hang)

> Date: 2026-05-22
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-05-22-native-pwa-drive-oauth-redirect-unification.md`

## User Story

As someone signing in to beanies.family on the **native Android app** (or an **installed PWA**), I want to load my existing pod from Google Drive and have the sign-in complete — so I can actually open my family's data instead of watching a spinner hang for two minutes and time out.

## Context

During the A1–A6 Capacitor native-app build (ADR-029), the **create-pod** storage flow was migrated to the native deep-link OAuth transport, but the **load / sign-in-and-pick-a-pod** flow was not. greg tested the CI debug APK on his Android device and the Google Drive sign-in fails with two symptoms:

1. Tapping "Google Drive" opens a **blank browser tab** (no consent screen); progress stops. Switching back to the app triggers a _second_ redirect that finally shows the Google consent screen.
2. After choosing the account with his `.beanpod`, the app's spinner **hangs indefinitely and times out after exactly 120 seconds**.

### Confirmed root cause (investigated this session)

The load path authenticates through the **popup** OAuth transport, which cannot work inside a Capacitor WebView or an installed PWA:

- `LoadPodView.handleLoadFromGoogleDrive()` → `syncStore.listGoogleDriveFiles()` (`syncStore.ts:2442`) → `requestAccessToken()` (`googleAuth.ts:469`).
- `requestAccessToken()` has **no `isNative()` / redirect branch**. It unconditionally:
  1. `openBlankPopup()` (`googleAuth.ts:503`) → `window.open('')`. In the Android WebView this is shunted to the system browser as a **blank tab** ⇒ **symptom 1**. The second open is `waitForAuthCode` navigating that popup to the real consent URL.
  2. `performPopupAuth` → `waitForAuthCode` (`googleAuth.ts:1349`) waits for `postMessage('oauth-callback')` from `OAuthCallbackPage` back to `window.opener`. On native, Google redirects to the verified App Link `https://beanies.family/oauth/native`, which the OS routes **back into the app** via `appUrlOpen` — _not_ into the popup's `OAuthCallbackPage`. No message ever arrives.
  3. The 120 s `POPUP_AUTH_TIMEOUT_MS` (`googleAuth.ts:1340`) fires ⇒ **symptom 2**.
- The returning `appUrlOpen` event _does_ fire `handleNativeAuthRedirect`, but it finds **no `beanies_redirect_auth` key in sessionStorage** (the popup path never set it), logs `"deep link with no pending auth — ignored"`, and discards the authorization code.
- Separately, `shouldUseRedirectAuth()` (`googleAuth.ts:220`) keys only off iOS / standalone-PWA heuristics, so it returns **false on native Android**. Any site that gates redirect-vs-popup on it — notably `useGoogleReconnect` (the one-tap reconnect) — would hit the same popup wall on native.

### What already works (the proven pattern to mirror)

- The **create-pod** path: `connectDriveStorage` (`connectStorage.ts:77`, redirect gate at line 86) does
  `if ((shouldUseRedirectAuth() || isNative()) && !isTokenValid()) { await startRedirectAuth(RESUME_SETUP_PATH, …); return { status: 'redirecting' }; }`.
- `startRedirectAuth` (`googleAuth.ts:1482`) stores `{ codeVerifier, returnPath, state }` in sessionStorage under `beanies_redirect_auth`; on native it `Browser.open({ url: authUrl })`, on web it `window.location.href = authUrl`.
- **Native completion** (`googleAuth.ts:1601-1704`): `installNativeAuthListener` → `appUrlOpen` → `handleNativeAuthRedirect` validates the CSRF `state`, runs `completeRedirectAuth()`, then calls `onComplete(returnPath)` → `App.vue:1092` `router.replace(returnPath)`.
- **Web completion**: Google → `${origin}/oauth/callback` → `OAuthCallbackPage` (redirect mode) stores the code and `window.location.href = state.returnPath` → app reboots at `returnPath` → `App.vue:679-718` (non-native) consumes the code via `completeRedirectAuth()`.
- **Post-redirect resume** is reactive: `LoginPage`'s `watchEffect` (`LoginPage.vue:99-106`) flips `activeView` to `resume-setup` whenever `route.query.resume === 'setup'`. This is SPA-nav-safe — **critical**, because on native `router.replace(returnPath)` does **not** remount `LoginPage`, so an `onMounted`-only resume would never fire.
- The **reconnect-to-load** path (2026-05-21 one-tap reconnect) already redirect-aware: `LoadPodView` calls `reconnect()` then `if (shouldUseRedirectAuth()) return;` — "the page is navigating away; LoginPage re-runs the silent auto-load on return" (`LoadPodView.vue:510-514`). This loads a _known_ `driveFileId` directly; the picker case (greg's repro) instead needs to _re-open the file list_.

## Requirements

1. On native (Capacitor) and installed-PWA / iOS surfaces, tapping **Google Drive** on the load/sign-in screen must use the **redirect / deep-link** OAuth transport — never the popup.
2. After the user consents and the deep link (native) or callback (web) returns with a valid token, the app must **automatically re-open the Drive file picker** (list `.beanpod` files) so the user can choose their pod — with no extra tap and no second OAuth prompt (the token is now cached).
3. `shouldUseRedirectAuth()` must return `true` on native, becoming the single source of truth for "use the redirect transport." Redundant `|| isNative()` checks that exist only to compensate for its current blind spot must be collapsed (DRY).
4. The **one-tap reconnect** path (`useGoogleReconnect`) must use the redirect transport on native (it already does on iOS/PWA) — fixed for free by requirement 3, but must be verified.
5. Every other `requestAccessToken()` caller must be audited and explicitly classified as either (a) only ever called **post-auth with a cached/valid token** (safe — no change) or (b) able to fire **pre-token on a redirect surface** (must take the redirect branch or be otherwise handled). No caller may be left able to silently hang.
6. No silent failures: a redirect that can't start, a returning code that fails to exchange, or a resume that lands with no valid token must each surface an actionable message (UI + console/Slack as appropriate), never a dead spinner.
7. Behavior on **desktop web (popup transport)** must be entirely unchanged.

## Important Notes & Caveats

- **Do not run `completeRedirectAuth()` at boot on native** — `App.vue:679` already guards `if (!isNative())` because the `appUrlOpen` listener owns native completion; racing them double-consumes the one-time code. Preserve this.
- **Native `router.replace` does not remount `LoginPage` _or_ `LoadPodView`.** Both the `LoginPage` resume dispatch (watch on `route.query`, not `onMounted`) AND the `LoadPodView` flag consumption (`watch(..., { immediate: true })`, not `onMounted`) must be reactive. `LoadPodView` is `v-else-if="activeView==='load-pod'"` and `activeView` is already `'load-pod'` across the redirect, so it never remounts. This is the single most likely place to introduce a "works on web, hangs on native" bug.
- **Router guard `ALREADY_AUTH_REDIRECT_FROM` (Pass 4).** `router/index.ts:309-318` rewrites any `/welcome` nav with `isAuthenticated && podCreated===false && resume!=='setup'` to `resume=setup`. greg's fresh-sign-in repro is _unauthenticated_, so it's unaffected — but an **authenticated-but-podless** return (recovery / re-pick) would lose `load-drive` and land on resume-setup instead of the picker. Extend the guard's escape (line 315) to `if (to.query.resume === 'setup' || to.query.resume === 'load-drive') return;`.
- **The CSRF `state` is native-only** by design (`startRedirectAuth` sets `state` only when `isNative()`). The web redirect carries none and `handleNativeAuthRedirect` is native-only. Do not add `state` to the web path.
- **`prompt=consent` invariant** (`googleAuth.ts:1501-1508`): `startRedirectAuth` always forces `prompt=consent` so Google returns a refresh token. The load-picker redirect must go through `startRedirectAuth` (which preserves this), not a hand-rolled auth URL. The picker historically uses `forceConsent: options?.forceNewAccount` (i.e. NOT always consent); switching the redirect-surface path to always-consent is acceptable and consistent with every other redirect caller (reconnect, create) — and is in fact required for refresh-token persistence.
- **`forceNewAccount` / switch-account — DECIDED (Pass 2 verified).** The picker has three entry handlers — `handleLoadFromGoogleDrive` (forceNewAccount = `props.forceNewGoogleAccount`), `handleDriveRetry` (no force), `handleDriveSwitchAccount` (force = true). `startRedirectAuth` **cannot** express `prompt=select_account` — it hard-codes `prompt=consent` (`googleAuth.ts:1509`, enforced invariant 1501-1508) and exposes no `prompt` parameter. This is fine: on the redirect transport, switch-account is satisfied by the existing `prompt=consent`, which re-shows Google's account chooser. This is exactly what `SettingsPage.vue:294-296` already relies on (it calls `startRedirectAuth` with no `select_account`). **Do NOT add a `select_account` parameter.** On the redirect path, `handleDriveSwitchAccount` and `handleLoadFromGoogleDrive` collapse to the same redirect — `forceNewAccount` only affects the popup-path `forceConsent`, which is irrelevant once a token is cached.
- **Folder side-effects**: `listGoogleDriveFiles` deliberately uses a Drive-wide search (`searchBeanpodFilesGlobal`) to avoid creating an empty `beanies.family` folder at listing time (`syncStore.ts:2448-2454`). The redirect refactor must not move file-listing ahead of that guarantee.
- The native app is **not publicly launched** — this is a pre-launch correctness fix. No production web-app behavior changes for existing users (desktop popup unchanged; iOS-PWA users currently reach the picker rarely because returning members use the reconnect path).

## Assumptions

> All four were **verified during Pass 2** against the source. Re-check only if the relevant code moved before implementation.

1. **CONFIRMED — family context survives full reload.** `activeFamilyId` derives from `activeFamily` (`familyContextStore.ts:14`), restored on `initialize()` via `getLastActiveFamily()` → `globalSettings.lastActiveFamilyId`, persisted in IndexedDB (`familyContext.ts:56-65`). **But note:** greg's repro is a _fresh sign-in with zero local families_ — there is no family to restore, so the continuation must NOT depend on one (see Part 3, fresh-sign-in sub-step). The restore matters only for returning users.
2. **CONFIRMED — picker is family-agnostic at listing time.** `listGoogleDriveFiles` (`syncStore.ts:2442-2456`) → `searchBeanpodFilesGlobal(token)` (Drive-wide, no family). `loadFromGoogleDrive(fileId, name)` (`syncStore.ts:2126`) maps the chosen file to a family afterward. The resume needs no pre-selected family to _show the list_. The folder-avoidance comment (2448-2455) is real — don't move listing ahead of it.
3. **CONFIRMED — no import cycle.** `googleAuth.ts:26` already imports `isNative` from `capabilities.ts`; `capabilities.ts` imports only `@capacitor/core` + `@/config/features` (no path back to `googleAuth`). The Part 1 one-liner is safe.
4. **CONFIRMED — token is cached before the resume fires, both transports.** Web: `App.vue:679` (`if (!isNative())`) runs `completeRedirectAuth()` at boot before `LoginPage` resumes. Native: `handleNativeAuthRedirect` runs `completeRedirectAuth()` (`googleAuth.ts:1684`) _before_ `onComplete(returnPath)` → `router.replace` (`App.vue:1092-1093`).

## Approach

### Part 1 — Make `isNative()` a first-class redirect signal (single source of truth)

- In `shouldUseRedirectAuth()` (`googleAuth.ts:220`), add `if (isNative()) return true;` after the `typeof window` guard (line 221). One line; `isNative` is already imported. Pass 2 confirmed no import cycle (Assumption 3).
- Collapse the now-redundant `(shouldUseRedirectAuth() || isNative())` in `connectDriveStorage` (`connectStorage.ts:86`) to `shouldUseRedirectAuth()`. Pass 2 grep confirmed this is the **only** `|| isNative()` paired with `shouldUseRedirectAuth()` in the codebase — there are no others to collapse. The `isNative` import in `connectStorage.ts` **stays** — `connectLocalStorage` (line 131) still uses it.
- Net effect: `useGoogleReconnect` (requirement 4), `usePickBeanpodFile`, and `SettingsPage` (each already redirect-gated via inline `shouldUseRedirectAuth()`) now pick the deep-link transport on native automatically — no per-site change needed.

### Part 2 — Redirect-aware Drive-auth gate, shared by create + load (DRY)

Extract the "do we need to bounce through a redirect to get Drive auth?" decision into one helper so create, load, and any future caller agree. Proposed location: `connectStorage.ts` (already the home of the create-path redirect decision and `RESUME_SETUP_PATH`).

```ts
/** Returns true if it kicked off a redirect/deep-link auth (caller must return early,
 *  treating it as "redirecting"); false if a token is already in hand / popup is fine. */
export async function beginDriveAuthRedirectIfNeeded(
  returnPath: string,
  loginHint?: string
): Promise<boolean> {
  if (shouldUseRedirectAuth() && !isTokenValid()) {
    await startRedirectAuth(returnPath, loginHint);
    return true;
  }
  return false;
}
```

- Rework `connectDriveStorage` to call `beginDriveAuthRedirectIfNeeded(RESUME_SETUP_PATH, opts.googleEmail)` instead of its inline branch (behavior identical; DRY).
- **`LOAD_DRIVE_PATH` placement (Pass 3):** do NOT co-locate it with `RESUME_SETUP_PATH` in `connectStorage.ts`. That module owns _create/connect-new-storage_ concerns (its header: "wire up a storage provider for a brand-new pod") — `RESUME_SETUP_PATH` is in-domain there; a _load-existing-pod_ return path is not. Co-locating it would set a "dump every OAuth return path in connectStorage" precedent for the next surface. Define `LOAD_DRIVE_PATH` in the module that owns the load/resume continuation — `LoginPage.vue`, or a tiny shared `src/pages/login/resumePaths.ts` if both `LoginPage` and `LoadPodView` need it — and pass it into the helper at the call site. The helper stays return-path-agnostic (it only takes a `returnPath` argument).

**DRY scope decision (Pass 2 — record explicitly so a future reader doesn't "finish" it and break semantics):** there are four inline `shouldUseRedirectAuth() + startRedirectAuth(returnPath)` blocks — `connectStorage.ts:86`, `useGoogleReconnect.ts:32-37`, `usePickBeanpodFile.ts:79-86`, `SettingsPage.vue:294-296`. The new helper gates on `!isTokenValid()`; the other three gate on **different** conditions (force-consent / try-silent-first / no token-check). `beginDriveAuthRedirectIfNeeded` therefore covers only the **create + load symmetry** (identical `!isTokenValid()` gate, same `RESUME_SETUP_PATH`/`LOAD_DRIVE_PATH` shape). The other three keep their inline gate — they're already correct once Part 1 makes `isNative()` flow through `shouldUseRedirectAuth()`. Do not fold `usePickBeanpodFile`'s silent-token-first path into the helper.

### Part 3 — Load-picker redirect branch + continuation

**Trigger — route the gate through `syncStore`, not a direct view→service call (Pass 3 / MVO).** `LoadPodView` already mediates every Drive op through `syncStore` (`listGoogleDriveFiles`, `loadFromGoogleDrive`). Add a thin store action `syncStore.beginDriveAuthRedirect(returnPath, loginHint)` that delegates to `connectStorage.beginDriveAuthRedirectIfNeeded` — so the view's whole Drive surface stays uniformly store-mediated and a future reader doesn't have to learn that one helper is view-called and the rest store-called. (Aside: `LoadPodView` _does_ already import `shouldUseRedirectAuth` directly at `:514` for the reconnect branch; that's an accepted pre-existing spot, but we don't add a second one.)

Inside the consolidated `openDrivePicker`, before listing files:

```ts
if (
  await syncStore.beginDriveAuthRedirect(
    LOAD_DRIVE_PATH,
    syncStore.providerAccountEmail ?? undefined
  )
) {
  return; // redirecting away (native: browser opened; web: page navigating). Continuation re-opens the picker.
}
// existing listGoogleDriveFiles() path (now reached only with a valid/cached token or on desktop popup)
```

Consolidate the three near-identical handlers — `handleLoadFromGoogleDrive`, `handleDriveRetry`, `handleDriveSwitchAccount` (`LoadPodView.vue:549-626`) — into one internal `openDrivePicker({ forceNewAccount })` holding the redirect-gate + list + show-picker logic; the three public handlers become thin wrappers. **Guard placement (Pass 3):** the `isGoogleDriveAvailable` guard currently only in `handleLoadFromGoogleDrive` (`:550-557`) moves into the shared `openDrivePicker` body so retry/switch-account inherit it (they currently lack it). Confirm this is a strict improvement, not a behavior change — those entries are only reachable after a successful Drive-availability check, so the guard can only ever pass there. `loginHint` is best-effort: `syncStore.providerAccountEmail` is `null` on a fresh first sign-in (greg's repro), which is correct — no hint means the user picks any account.

Per the switch-account decision (Caveats): on the redirect transport `forceNewAccount` is moot (the cached token / `prompt=consent` chooser handles it), so on a redirect surface all three wrappers funnel to the same redirect. Keep `forceNewAccount` only for the desktop popup path.

**Continuation (in `LoginPage`) — one self-stopping watch, but `load-drive` is gated BEFORE `isAuthenticated` (Pass 4 — BLOCKER fix).** `LoginPage` already has a self-stopping `resume=setup` watchEffect with a 16-line TDZ-guard cautionary comment (`LoginPage.vue:88-106`) — born from a real Android `vue-render` crash. Keep ONE watch (don't add a second; that couples two watches through shared `route.query` reactivity). **But `load-drive` must NOT share `resume=setup`'s `isAuthenticated` gate:** greg's repro is a _fresh install with zero local families_, and `authStore.initializeAuth()` only restores a session when `families.length > 0` (`authStore.ts:273` — "if a family exists in registry, auth happens after file load"). With zero families the user is **unauthenticated while picking the pod** — loading the pod is what _produces_ the family/auth. `resume=setup` only ever runs post-signup (authenticated), so it can keep its auth gate; `load-drive` is the first resume mode that legitimately returns unauthenticated, so it is handled before that gate:

```ts
if (!authStore.isInitialized) return;
// load-drive returns DURING a fresh sign-in (zero families ⇒ not yet authenticated,
// authStore.ts:273). It must NOT sit behind the isAuthenticated gate resume=setup uses.
if (route.query.resume === 'load-drive') {
  activeView.value = 'load-pod';
  autoOpenDrivePicker.value = true;
  isInitializing.value = false;
  stopResumeWatch();
  return;
}
if (!authStore.isAuthenticated) return;
if (route.query.resume === 'setup') {
  activeView.value = 'resume-setup';
  isInitializing.value = false;
  stopResumeWatch();
  return;
}
```

One self-stopping watch, one (already battle-tested) TDZ guard, the full set of resume modes greppable in one place — and `load-drive`'s auth-independence is enforced by structure, not a comment. When the next OAuth surface needs a resume mode, it's one more branch (decide its auth gate explicitly).

1. **Query-clear is optional and narrow.** The one-shot `autoOpenDrivePicker` flag already prevents in-page re-trigger. The only case a query-clear defends is a _literal browser refresh_ re-firing `load-drive`. On native `router.replace` doesn't reload (flag suffices); on web a refresh re-boots `App.vue`, which re-consumes nothing (the code was already exchanged). If kept, it must use `router.replace` (not push) and preserve any non-`resume` query keys — but with the single-dispatcher design above there's no cross-watch coupling to worry about, so a clear is safe-by-construction. Decide during implementation; lean toward NOT clearing unless the refresh case proves real.
2. **Fresh-sign-in case (explicit):** greg's repro has **zero local families**, so single-family auto-select (`LoginPage.vue:180-195`) won't fire and there is no family to restore. The continuation must NOT depend on a restored family — it leans on Assumption 2 (picker lists Drive-wide). The resumed `openDrivePicker()` runs with `forceNewAccount: false` (token already cached — forcing consent would bounce through a _second_ redirect).

- `LoadPodView` consumes the flag (a prop, like `autoLoad` / `reconnectDriveFile`) via a **`watch(() => props.autoOpenDrivePicker, v => { if (v) openDrivePicker({ forceNewAccount: false }); }, { immediate: true })`** — **NOT `onMounted`** (Pass 4). On native the deep-link `router.replace` is an SPA nav: `activeView` is already `'load-pod'`, `LoadPodView` (`v-else-if="activeView==='load-pod'"`, `LoginPage.vue:550`) stays mounted and never remounts, so `onMounted` would never re-fire — the exact "works on web, hangs on native" trap. `{ immediate: true }` covers both the web full-page-reload first-mount and the native already-mounted nav. **Resume-no-token guard (Pass 3):** `openDrivePicker` checks `isTokenValid()` at the top and, if false, sets `formError = t('googleDrive.authFailed')` and returns — surfacing the failure directly rather than relying on `requestAccessToken` _throwing_ on a redirect surface (a behavior this very plan classifies as a bug elsewhere; a future redirect-aware `requestAccessToken` would otherwise turn the no-token resume into a consent loop). On success: cached token, instant list, picker shows. **No popup, no second consent.**

**Why a URL resume signal (not sessionStorage):** reuses the existing `?resume=` query convention. This differs from `resume=setup` in one way — `resume=setup` is _sticky_ (`ResumePodSetup` lives at that URL for its lifetime; `App.vue` even routes there on every zombie-state cold boot), whereas `load-drive` is a _one-shot trigger_. That divergence is deliberate, not a mirror. The URL approach survives the web full-page reload and is reactive-watch-friendly for the native SPA-nav case. The family id is intentionally **not** in the URL (Assumptions 1–2 confirm it's unnecessary).

### Part 4 — Audit every other `requestAccessToken()` caller (requirement 5)

**Pass 2 verified every call site against the source.** Only (b) callers need a change. Conclusion: the **only in-scope (b) caller is `listGoogleDriveFiles`@2445**, fixed by Part 3.

| Caller (file:line)                          | When it runs                                            | Verdict                                | Evidence                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `syncStore.listGoogleDriveFiles` 2445       | load-picker, pre-token, `forceConsent: forceNewAccount` | **(b)** — fixed by Part 3              | the only true in-scope (b)                                                                                                                                                                                                                                                |
| `syncStore.loadFromGoogleDrive` 2161        | after a file is picked / silent-gated                   | **(a)** in every reachable in-app path | LoadPodView@648 (post-picker); useJoinFlow@417 (gated by `tryGetSilentToken` first, `useJoinFlow.ts:413-414`); recoverFromMissingFile@2272 (post-reconnect). See `OpenFromDrivePage` caveat below.                                                                        |
| `syncStore.handleCreateFailure` 1045        | post-`createNew` cleanup, `forceConsent:false`          | **(a)**                                | runs only after a connect+create attempt; cached token                                                                                                                                                                                                                    |
| `googleAuth.getValidToken` 1083             | internal interactive helper (tries silent first)        | **(a)** / internal                     | not a UI entry point                                                                                                                                                                                                                                                      |
| `useGoogleReconnect` 43                     | interactive reconnect                                   | **(a)**                                | already redirect-gated (`useGoogleReconnect.ts:32`); fixed by Part 1                                                                                                                                                                                                      |
| `usePickBeanpodFile` 87                     | re-pick a `.beanpod`                                    | **(a)**                                | already redirect-gated (`usePickBeanpodFile.ts:79`); only reaches `requestAccessToken` on popup transport                                                                                                                                                                 |
| `SettingsPage` 298                          | Settings → switch account                               | **(a)**                                | redirect-gated (`SettingsPage.vue:294`); fixed by Part 1                                                                                                                                                                                                                  |
| `googleAccountAssertion` 165                | account-mismatch re-consent                             | **(a)** w/ caveat                      | fires inside an `onTokenAcquired` subscriber _after_ a token exists; the rare mismatch path can call popup-`requestAccessToken` on a redirect surface, but the failure is caught + `console.warn`'d (`.ts:172-176`) → falls through to "retry via Settings". Cannot hang. |
| `googleDriveProvider.createNew` 345         | create-pod                                              | **(a)**                                | safe because `connectDriveStorage`'s redirect gate (line 86) fires _before_ `createNew`                                                                                                                                                                                   |
| `googleDriveProvider.requestAccess` 254     | `requestPermission` re-grant                            | **(a)**                                | provider already installed; refresh token usually present → silent refresh wins; failure returns false (`.ts:256-258`), no hang                                                                                                                                           |
| `useEnsurePhotosPublic` 64, `photoStore` ×8 | photo ops mid-session                                   | **(a)**                                | deep in an authenticated session                                                                                                                                                                                                                                          |

**Out-of-scope but flagged (requirement 5 — "no caller silently hangs", answered honestly):** `OpenFromDrivePage.vue:78` → `loadFromGoogleDrive` → `requestAccessToken`@2161 is a genuine (b) caller that will hit the same blank-tab/hang on native (its current mitigation is a _popup_-blocked "Continue" button, `OpenFromDrivePage.vue:23-35`, which doesn't help native). Drive "Open with…" is **not a launch path on native**, so it's out of scope here — but it must later route through `beginDriveAuthRedirectIfNeeded(currentPath)` before `loadFromGoogleDrive`. **Tracked as a follow-up; not silently ignored.**

### Error handling (requirement 6)

- `beginDriveAuthRedirectIfNeeded`: if `startRedirectAuth` throws (e.g. `Browser.open` rejects on native, or no client id), do not swallow — let it propagate to the caller's existing `try/catch` (`handleLoadFromGoogleDrive` already sets `formError` + `console.error`). Confirm the message is actionable.
- Resume-with-no-token: **Pass 2 confirmed this path is real on native** — `handleNativeAuthRedirect`'s `catch` still calls `onComplete(returnPath)` (`googleAuth.ts:1695`) on exchange failure, so the `load-drive` resume watch **will** fire with `isTokenValid() === false`. **Pass 3 hardening:** `openDrivePicker` checks `isTokenValid()` at the top and, if false, sets `formError = t('googleDrive.authFailed')` + returns — surfacing the failure **directly** rather than relying on `requestAccessToken` _throwing_ (popup-blocked) on the redirect surface. That throw is incidental and is itself a behavior this plan classifies as a bug elsewhere; a future redirect-aware `requestAccessToken` would otherwise turn the no-token resume into a consent loop. The existing `try/catch/finally` (`LoadPodView.vue:574-578`) remains the backstop for any other throw. `App.vue`'s `app.redirectAuthCompletion` (web) and `handleNativeAuthRedirect`'s `native-oauth` reportError (native) already log the upstream exchange failure to Slack.
- Keep the existing `isDriveLoading` / `isLoadingFile` spinners; ensure they are cleared on every exit path of the new `openDrivePicker` (`finally`).

## Files Affected

- `src/services/google/googleAuth.ts` — `shouldUseRedirectAuth()` gains `isNative()` (Part 1).
- `src/services/sync/connectStorage.ts` — new return-path-agnostic `beginDriveAuthRedirectIfNeeded(returnPath, loginHint)`; `connectDriveStorage` collapsed to use it (Parts 2, 3). `LOAD_DRIVE_PATH` does **not** live here (Pass 3).
- `src/stores/syncStore.ts` — new thin action `beginDriveAuthRedirect(returnPath, loginHint)` delegating to the connectStorage helper, so `LoadPodView`'s Drive surface stays store-mediated (Pass 3 / MVO).
- `src/pages/LoginPage.vue` (or new `src/pages/login/resumePaths.ts`) — defines `LOAD_DRIVE_PATH`; the **existing** resume watchEffect extended to a `switch (route.query.resume)` dispatcher with the `load-drive` case; passes `autoOpenDrivePicker` to `LoadPodView` (Part 3, Pass 3).
- `src/components/login/LoadPodView.vue` — three Drive handlers consolidated into one `openDrivePicker({ forceNewAccount })` with the store-mediated redirect gate, the hoisted `isGoogleDriveAvailable` guard, and the top-of-function `isTokenValid()` resume guard; consumes the `autoOpenDrivePicker` prop via a `watch(..., { immediate: true })` — not `onMounted` (Part 3, Pass 3, Pass 4).
- `src/router/index.ts` — extend the `ALREADY_AUTH_REDIRECT_FROM` guard escape (line 315) to let `resume=load-drive` through, not just `resume=setup` (Pass 4).
- `src/composables/useGoogleReconnect.ts` — no change expected (verify it's fixed by Part 1).
- (audit only — Pass 2 verdict (a), no change) `src/composables/usePickBeanpodFile.ts`, `src/pages/SettingsPage.vue`, `src/services/auth/googleAccountAssertion.ts`.
- Tests: `src/services/google/__tests__/googleAuth.native.test.ts`, `src/services/google/__tests__/googleAuth.test.ts`, `src/services/sync/__tests__/connectStorage.test.ts`, `src/components/login/__tests__/LoadPodView.test.ts`, and a new continuation test for the `resume=load-drive` watch in `LoginPage` (note: STATUS records LoginPage/LoadPodView have no unit-mount harness — favor logic-level tests on `beginDriveAuthRedirectIfNeeded` + `shouldUseRedirectAuth` + the handler branch).

## Acceptance Criteria

- [ ] `shouldUseRedirectAuth()` returns `true` when `isNative()` is true; unit test added.
- [ ] On native + iOS-PWA, tapping Google Drive opens the consent screen via the system browser / redirect (no blank tab, no popup), and after consent the Drive file picker appears automatically with no second prompt.
- [ ] Selecting a `.beanpod` from the picker proceeds to decrypt/load — the full greg repro now succeeds end-to-end on the Android APK.
- [ ] Switch-account and retry from the picker still work on the redirect transport.
- [ ] One-tap reconnect works on native (verified, even though it's fixed indirectly).
- [ ] The `requestAccessToken()` caller audit table is completed; every (b) caller is handled; no caller can hang pre-token on a redirect surface.
- [ ] Desktop web popup sign-in/load is byte-for-byte unchanged (regression check).
- [ ] No silent failures: redirect-start failure, exchange failure, and resume-without-token all surface an actionable message + console/Slack breadcrumb.
- [ ] `npm run validate` clean (type-check + lint + format + unit + build); new + existing native auth tests green.

## Testing Plan

1. **Unit**: `shouldUseRedirectAuth()` true under `isNative()` mock; `beginDriveAuthRedirectIfNeeded` returns true (and calls `startRedirectAuth` with the right path) when `shouldUseRedirectAuth() && !isTokenValid()`, false otherwise; `connectDriveStorage` still returns `{status:'redirecting'}` on the redirect surface (no behavior change).
2. **Unit (native deep-link)**: extend `googleAuth.native.test.ts` — after a load-picker-initiated `startRedirectAuth`, a valid `appUrlOpen` deep link completes the exchange and `onComplete(LOAD_DRIVE_PATH)` is invoked (state present in sessionStorage now, so it's no longer "ignored").
3. **Unit (continuation)**: a `LoginPage`-level test (logic or mounted, per harness availability) that `route.query.resume === 'load-drive'` → `autoOpenDrivePicker` set + `activeView==='load-pod'`.
   3b. **Unit (regression — Pass 4 blocker)**: the `load-drive` dispatch fires with **`authStore.isAuthenticated === false`** (the fresh-sign-in / zero-families case) — guards against a future reader re-folding `load-drive` behind the `isAuthenticated` gate that `resume=setup` uses.
4. **Manual — Android APK (greg, on-device)**: install latest CI debug APK → Sign In → Google Drive → consent → pick `.beanpod` → decrypt → lands in app. Confirm no blank tab, no 120 s hang. Re-run with "switch account."
5. **Manual — iOS installed PWA (if available)**: same picker-load flow end-to-end.
6. **Manual — desktop web**: popup sign-in/load unchanged (no redirect introduced).
7. **Manual — native reconnect**: force token expiry, confirm one-tap reconnect uses the redirect (no popup/hang).

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the two-part fix (isNative→shouldUseRedirectAuth single-source-of-truth + load-picker redirect branch with a reactive `resume=load-drive` continuation mirroring `resume=setup`), a shared `beginDriveAuthRedirectIfNeeded` helper for DRY across create/load, the full requestAccessToken caller audit, error-handling enumeration, and the test/acceptance plan.
- **Pass 2 (DRY + error handling)**: Verified all 11 `requestAccessToken` call sites against source — only `listGoogleDriveFiles`@2445 is a true in-scope (b); corrected the function name (`connectDriveStorage`), the `usePickBeanpodFile`/`googleAccountAssertion` verdicts, and the switch-account caveat (redirect uses `prompt=consent`, not `select_account`); confirmed Assumptions 1-4 + no import cycle; flagged `OpenFromDrivePage` as the one uncovered (b) caller (follow-up) and recorded the four inline redirect-gates as a deliberate DRY boundary; made the fresh-sign-in (zero-families) continuation explicit.
- **Pass 3 (Sustainability)**: Folded the two resume modes into one `switch`-based dispatcher (not a second TDZ-guarded watchEffect); routed the redirect gate through a thin `syncStore.beginDriveAuthRedirect` action to keep `LoadPodView`'s Drive surface uniformly store-mediated (MVO); moved `LOAD_DRIVE_PATH` out of `connectStorage.ts` to the load-flow owner; made the resume-no-token guard an explicit `isTokenValid()` check instead of relying on a downstream throw; specified the `isGoogleDriveAvailable` guard hoist; corrected the false "matches `resume=setup` exactly" claim (the one-shot query-clear is a divergence, not a mirror).
- **Pass 4 (Fresh-eyes sweep)**: Architecture/security verified sound, but caught a BLOCKER the Pass-3 consolidation introduced — `load-drive` was routed behind the `isAuthenticated` gate, which is `false` in greg's exact zero-families fresh-sign-in repro (loading the pod is what _produces_ auth, `authStore.ts:273`), so the picker would never re-open. Fixed: `load-drive` now dispatches before the `isAuthenticated` gate (needs only `isInitialized`); `LoadPodView` consumes the flag via `watch(..., {immediate:true})` not `onMounted` (never remounts on the native SPA nav); and the `ALREADY_AUTH_REDIRECT_FROM` router guard must let `load-drive` through. Added a regression test pinning the unauthenticated dispatch.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (greg, on-device repro)

Today we've build out a capacitor-based app and generated the android apk. I've tested in on my device now and encountered an issue signing in via google drive. the steps to replicate the issue are below:

- install app via the latest app apk generated on github
- Open app and go to sign in
- Click on google drive (now enabled)
- i get redirected to a blank tab - no google consent screen. progress has stopped
- I switch tasks back to the app - before i land in the app, i am redirected again to a new tab, this time the google consent screen is loaded
- i select the account with my beanpod file
- i am redirected back to the app, however the spinner spins indefinitely with no progress. after 120s the spinner times out and i get a timeout error messages on the sign in page on the app

### Follow-up 1 (scope decision)

Q: Should the fix cover the iOS-PWA picker-load hang too, or stay native-only?
A: **Unify redirect transport** — fix the picker-load path for ALL redirect-transport surfaces (native + iOS PWA) via shouldUseRedirectAuth(). One code path.

</details>
