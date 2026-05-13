# Plan: Bulletproof pod creation & onboarding — fix iPhone Drive setup, kill the zombie state, make every onboarding error reach Slack

> Date: 2026-05-13
> Trigger: Shaun (Hong Kong, iPhone / Chrome-on-iOS) tried to create a pod on Google Drive, hit a Google **400 "The server cannot process the request because it is malformed. It should not be retried"**, and landed in `/nook` with **zero family members and no `.beanpod` file** — and **nothing** reached `#beanies-errors`. Same fingerprint as recent pilots whose onboarding "started" but never produced a pod (likely also iPhones).

---

## Context

Three faults compound:

1. **iPhone Google-Drive setup is fragile.** Non-standalone-PWA iOS browsers (Safari _and_ Chrome-on-iOS) run the **popup/new-tab** OAuth path: `popup.location.href = authUrl` opens `accounts.google.com` in a new tab; the chooser renders (top-level nav — fine), the user picks an account, then the OAuth _continuation_ hits iOS cookie/ITP partitioning in the new-tab context → Google's generic `invalid_request` 400. Meanwhile `waitForAuthCode()` (`googleAuth.ts:1098`) has **no timeout** and `popup.closed` is unreliable on iOS, so the call can hang forever and `isSavingStorage` sticks `true`. **Standalone-PWA iOS users already use the full-page redirect flow (`startRedirectAuth`), which works** — that's the "works on some iPhones, not others" split. `CreatePodView.handleChooseGoogleDriveStorage` → `GoogleDriveProvider.createNew` → `requestAccessToken` is a **direct** call that never consults `shouldUseRedirectAuth()`.

2. **The app can render a "logged in but no pod" zombie `/nook`.** `authStore.signUp()` (`authStore.ts:178`) builds the in-memory doc + owner member, then `persistSession()` + `isAuthenticated = true` — **before** storage is chosen (step 2). The router guard only checks `isAuthenticated`. So if step 2 fails (the iOS 400) or the user walks away, the next load restores the session → `/nook` → `loadFamilyData` Path 3 sees no configured pod and no in-memory doc → just `initDoc()`s an **empty** doc → the post-init `getDoc()` health check passes → `/nook` renders with zero members (Shaun's screenshot). `CreatePodView.handleStep2Next`'s `else` branch (storage "saved" but `syncStore.isConfigured` false) **advances to step 3 without writing a pod file** — a second route to the same state.

3. **Onboarding failures don't page Slack, and `🎉 pod created` is unreliable.** `reportError → slackPost(getWebhookUrl())` reads `VITE_BEANIES_ERROR_WEBHOOK_URL` (GitHub repo _variable_ `vars.BEANIES_ERROR_WEBHOOK_URL`, distinct from the working `VITE_SLACK_WEBHOOK_URL`) — if unset it no-ops. The iOS 400 produces a _hang_, not a throw, so even a working webhook sees nothing. Several catches on the auth/Drive/init path only `console.warn` (`App.vue:550` failed `completeRedirectAuth`; `App.vue:686` post-init "no data"). The `🎉 Family pod created!` ping fires from exactly one component method (`CreatePodView.handleStep2Next`); greg confirmed it doesn't arrive for local-file pods, and it won't fire on the recovery path this plan adds.

**Outcome:** (a) iPhone users get the working full-page-redirect Drive flow standalone-PWA users already get; (b) the app can _never_ render a functional-looking-but-empty `/nook` — a half-finished onboarding routes to a clear recovery screen; (c) every onboarding/auth/Drive failure pages `#beanies-errors` with a dev-actionable message; (d) `🎉 pod created` fires for every completed pod (local or Drive) from one place; (e) the iOS-OAuth knowledge is captured as an ADR + memory.

Decisions with greg (2026-05-13): **iOS → redirect-auth everywhere** (re-validate the old "Picker iframe broke after ITP redirect" worry separately). **Zombie state → "Both"**: recovery screen + route guard _and_ a durable invariant.

---

## Design stance (for maintainability, not just this fix)

- **No `mode` flags forking big components.** The recovery screen is a _new small component_ (`ResumePodSetup.vue`) that composes a _newly-extracted shared component_ (`PodStorageStep.vue`), not a boolean fork of the 1200-line `CreatePodView`. The extraction makes `CreatePodView` _smaller_; `PodStorageStep` becomes the one home for "connect Drive / pick a local file" and the iOS-redirect branch, reused by `CreatePodView` step 2, `ResumePodSetup`, and (later) the "Move to Drive" migration.
- **One chokepoint each, at the layer that already owns the concern** — not a new wrapper layer: the `🎉 pod created` ping fires inside `syncStore.createNewFile()` on success (that's _already_ the "the `.beanpod` exists now" event); the "is the app ready for `/nook`?" decision lives in the **router guard** (a single source of truth — `App.vue` stops duplicating it); timeout-wrapping is one tiny `withTimeout()` util; the owner-doc setup shared by signup and resume is one extracted private helper.
- **No silent failures** (already a project memory — `feedback_no_silent_failures.md`): every `catch`/`.catch()` on a setup/onboarding/auth/Drive path either re-throws to a reporting boundary or classifies + `reportError({ surface: '<prefix>', ... })`. Critical → user-facing message with the actual error **and** a "what to do" line (retry / try a local file / contact support); non-critical → `console.warn` with the documented fallback. No bare `catch {}` on these paths.
- **Simplest correct flow.** The iOS create-pod redirect stashes **nothing** (no password, no wizard blob): the user re-enters their password on the recovery screen (honest after a full-page bounce to Google); the Google token survives in `googleAuth.ts`'s in-memory state (set by `completeRedirectAuth` on App init); "I'm mid-recovery" rides in one URL query param (`?resume=setup`) and "finalize on Drive vs. show the picker" is _inferred_ from `isTokenValid()`, not a second param. The only durable new state is one boolean: `authStore.podCreated`.

---

## Approach (phased — Phase 1 alone makes the broken state impossible & loud, even before the iOS auth change)

### Phase 0 — config + a loud guard against this class of bug

- Greg: confirm the GitHub repo **variable** `BEANIES_ERROR_WEBHOOK_URL` is set to the `#beanies-errors` webhook. The channel's silence since May 11 suggests it isn't — if so, that single fix restores all error reporting.
- Code (`src/config/features.ts`): one-time `console.warn` on import if `features.errorReporter === false` while a cloud feature (`features.drive`/`features.registry`) is true — a cloud build with no error webhook is a misconfiguration and should be loud.

### Phase 1 — P0 hardening

**1a. One durable invariant + the recovery screen.** Replace "authenticated ⇒ allowed into the app" with "authenticated **and a pod file exists** ⇒ allowed":

- `authStore`: add `podCreated: boolean` to the persisted session object (`AuthUser` already round-trips through `persistSession`/`restoreSession` — extend it; default `false`). `signUp()` leaves it `false`. `createNewFile()` success (1f) sets it `true` and re-persists. `signOut()` clears it.
- `router/index.ts`: the existing `requiresAuth` guard additionally requires `authStore.podCreated`; otherwise → `{ name: 'Welcome', query: { resume: 'setup' }, replace: true }`. **This is the single source of truth for "ready for the app".**
- `App.vue` (no longer re-derives the readiness check — it defers to the guard): in `loadFamilyData` Path 3, if authenticated-but-`!podCreated`, return early without `initDoc()`-ing an empty doc (the guard will have rerouted, or will when navigation settles); in the post-init `getDoc()` health check, skip the "no data" error overlay when `!podCreated` (recovery, not error). That's the whole App.vue change for the invariant.
- `LoginPage.vue`: when `route.query.resume === 'setup'`, set `activeView = 'resume-setup'` → renders `<ResumePodSetup>` (mirrors the existing `activeView`/`initialView` pattern; no new route). Add a quiet "start over (sign out)" affordance on that view — it just `signOut()`s; the empty registry entry left behind is harmless.
- New **`src/components/login/ResumePodSetup.vue`** (~small, single-purpose): "Finish setting up [Family]" (family name read-only from `familyContextStore.activeFamilyName`). One owner-name field (pre-filled from `authStore.currentUser` if available — see 2b — else asked) + password + confirm. On submit → `await authStore.rehydrateOwnerDoc(name, password)` (2b — no-ops if the doc already has the owner) → render `<PodStorageStep>` (1e): if `isTokenValid()` (we just came back from a Drive redirect with a fresh token), it auto-finalizes on Drive; otherwise it shows the Drive/local picker → on `connected` → `syncStore.createNewFile(...)` → on success the app routes to `/nook` (the guard now passes). No "add members" step here — the recovery path's job is to get the user to a working `/nook`; members are added from the Pod page (the empty-nook screenshot literally shows "+ add a beanie").
- `reportError({ surface: 'app.onboardingZombieState', severity: 'error', context: { route_path } })` once when the guard reroutes for `!podCreated`.

**1b. `handleStep2Next` else-branch must block, not advance** (`CreatePodView.vue:344-354`): when `storageSaved` is true but `syncStore.isConfigured` is false, set a hard `formError` (with a dev hint in the console), `reportError({ surface: 'createPod.createNewFile', severity: 'error' })`, **return without advancing**. The pod file must physically exist before step 3 is reachable. (Step 2's "Next" is already `:disabled="!storageSaved"` — this closes the other leak.)

**1c. Timeouts so nothing hangs — via one util.** Add `src/utils/withTimeout.ts`: `withTimeout<T>(promise, ms, message): Promise<T>` (`Promise.race` against a `setTimeout` that rejects `new Error(message)`; clears on settle). Refactor `App.vue`'s existing `completeRedirectAuth` `Promise.race` onto it. New uses:

- `waitForAuthCode(popup, url)` (`googleAuth.ts:1098`): wrap in `withTimeout(..., ~120_000, "Google sign-in didn't return — the sign-in window may have been closed or blocked. Try again, or use a local file.")`; on timeout the existing `cleanup()` still runs and the caller gets a real, reported, recoverable error.
- `PodStorageStep`'s Drive-connect call: `withTimeout(..., ~150_000, ...)` (longer than the inner one so the inner wins) so its `isSavingStorage` can never stick `true`; on timeout treat exactly like a thrown failure (the recovery modal — 1e — + `reportError`).
  (`oauthProxy.ts`'s `fetchWithTimeout` keeps its `AbortController` — that one must actually cancel the fetch; different semantics, leave it.)

**1d. Close the error-reporting gaps** — every onboarding/auth/Drive failure pages Slack:

- `App.vue:~550` failed `completeRedirectAuth()` during init → `reportError({ surface: 'app.redirectAuthCompletion', severity: 'error' })`.
- `App.vue:~684` post-init "no Automerge doc" on a non-login route (and `podCreated`) → `reportError({ surface: 'app.postInitNoData', severity: 'error', context: { route_path } })` (+ a _compact_ breadcrumb tail — the allowlist truncates to 200 chars).
- `PodStorageStep`'s Drive-connect catch: `severity: 'error'` unless `isUserCancellation(e)` (then `'warning'`).
- Audit `try/catch` / `.catch(` across `src/services/google/*`, `src/services/sync/*`, `src/components/login/*`, `src/composables/useJoinFlow.ts`, `src/composables/useInviteFlow.ts`, `src/stores/syncStore.ts`, `src/stores/authStore.ts`: anything that swallows a failure on a setup/onboarding/Drive path must report it or re-throw to a boundary that does. (Background silent-refresh catches already escalate via `firePermanentFailureCallbacks` — leave those.)

**1e. Extract `src/components/login/PodStorageStep.vue`** — the cohesive "where does this pod live?" unit, lifted verbatim from `CreatePodView` step 2 and made reusable:

- Owns its own state (`storageSaved`, `storageType`, `isSavingStorage`, `driveResultError`, `showDriveResultModal`, `showLocalFileWarning`, `driveCardState`) and handlers (`handleChooseGoogleDriveStorage`, `handleChooseLocalStorage`, `handleLocalFileClick`, `handleUseDriveFromWarning`, `handleDriveModalContinue`), plus the new redirect-mode branch (2b) and the `withTimeout` wrap (1c). Renders the Drive hero card + the "prefer a local file?" link + `LocalFileSyncWarning` (existing component, reused) + the result modal.
- **Props:** `googleEmail?: string` (Drive `login_hint`), `podFileBaseName: string` (the `.beanpod` filename). **Emits:** `connected: [{ type: 'local' | 'google_drive' }]` (the provider is already set on `syncService` as a side-effect, as today).
- Drive-result-modal **failure** state: a `BaseModal` with the error message + three `BaseButton`s — "Try again" (re-run connect) / "Use a local file instead" (open the local path) / "Get help" (link to the Help Center setup-trouble article or contact form). The `×` stays; closing always lands back on the picker, never on a route into the app. (No new modal type — plain `BaseModal` usage.)
- `CreatePodView` step 2 becomes `<PodStorageStep :google-email="email" :pod-file-base-name="familyName || 'my-family'" @connected="onStorageConnected" />`; `onStorageConnected` does what `handleStep2Next`'s success branch does today (call `syncStore.createNewFile(...)` with the step-1 password, then advance to step 3 — `createNewFile` now fires the ping, see 1f). `ResumePodSetup` uses the same component.

**1f. `🎉 pod created` fires from `syncStore.createNewFile()` on success** — move the ping out of `CreatePodView.handleStep2Next` and into `createNewFile` itself (right before `return true`). `createNewFile` already has `familyName`; it looks up the owner name from the just-built doc (`familyStore.members.find(m => m.id === memberId)?.name`) and the storage type from `syncService.getProviderType()`. Every caller — `CreatePodView`, `ResumePodSetup`, and any future one — gets it for free; `slackNotify`'s existing no-op-with-warn on a missing webhook still applies. Also set `authStore.podCreated = true` here (1a). (We keep the existing `setupAutoSync`/`ensureRegistered` call sites in `SetupProgressModal` step 4 and `LoginPage.handleSignedIn` as-is — they're idempotent and pre-existing; consolidating them is out of scope.) Dev check: `npm run dev:all` → a fresh local-file pod fires the ping (greg's reported gap — a stubbed `slackNotify` assert pins down whether it was a missing call or a quiet `no-cors` POST failure).

### Phase 2 — iOS uses full-page redirect OAuth (not popups)

**2a. `shouldUseRedirectAuth()`** (`googleAuth.ts:191`) returns `true` for all iOS WebKit, not just standalone PWAs: keep the two standalone checks; add iOS detection — `/iP(hone|od|ad)/.test(navigator.userAgent)` **or** `navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1` (iPadOS-as-Mac). Rewrite the docstring's "Why not iOS regular Safari?" paragraph (the popup path's cross-tab `postMessage` + OAuth-continuation-under-ITP fragility outweighs the old Picker concern; the Picker concern is 2d).

**2b. `PodStorageStep` honours redirect mode** — in `handleChooseGoogleDriveStorage`: if `shouldUseRedirectAuth()`, `startRedirectAuth('/welcome?resume=setup', googleEmail)` (full-page nav to Google — no popup/tab) instead of calling `GoogleDriveProvider.createNew()`. Optionally also write the _owner name_ (non-secret) to a small sessionStorage key so `ResumePodSetup` can pre-fill it; otherwise it re-asks. On return: `App.vue` consumes the token via the existing `completeRedirectAuth()` → `LoginPage` sees `?resume=setup` → `<ResumePodSetup>` → name+password → `rehydrateOwnerDoc` → `<PodStorageStep>` sees `isTokenValid()` → calls `GoogleDriveProvider.createNew()` (returns the cached token, _no second auth_) → `syncService.setProvider` → `provider.persist(familyId)` → emits `connected` → `createNewFile(...)` → `/nook`. The `!podCreated` guard (1a) is the safety net for "closed the OAuth tab / came back days later / sessionStorage gone" — same `?resume=setup` → `<ResumePodSetup>`, which simply re-picks storage.

- **`authStore.rehydrateOwnerDoc(name, password)`** — the in-memory doc doesn't survive a full-page redirect, but `createNewFile` assumes "doc already has the owner". Extract the doc-building lines of `signUp()` (`initDoc()` + `familyStore.resetState()` + create the owner member) into a private `buildOwnerDoc(ownerInput)` returning the member; `signUp()` calls it with a fresh id; `rehydrateOwnerDoc()` calls it with `{ ...ownerInput, id: authStore.currentUser.memberId, passwordHash: await hashPassword(password) }` (name from the arg; email/role from `authStore.currentUser`). No-ops if `familyStore.owner` already exists. The only plumbing this needs: make `id` an _optional_ field on `CreateFamilyMemberInput`, used by `familyRepo.createFamilyMember` if present (else generated) — one optional field, no new method through the layers.

**2c. "Move to Google Drive" migration on iOS — out of scope** (existing-pod maintenance, not onboarding; a correct fix needs the same redirect+re-auth with the family key). Two-line defensive change: hide/disable the "Move to Google Drive" row in Settings → Family Data when `shouldUseRedirectAuth()`, and add a `docs/STATUS.md` pending-block note to wire it later.

**2d. Re-validate the Google Picker on iOS redirect-auth** (validation task, not necessarily code) — the Picker is only used by **load-existing-pod** (`usePickBeanpodFile` → `drivePicker.ts`), never create-pod. Test on a real iOS Safari browser after 2a. If it still breaks ("API developer key invalid" after the ITP top-level nav): on iOS, swap the Picker for an in-app `.beanpod` chooser (we hold a `drive.file` token → `files.list` over our app-folder → render our own list; invitees never hit this — the invite link carries the `fileId`; "owner on a new device with no invite link" has the local-file fallback). If it works fine now: no change.

### Phase 3 — honest copy

- 3a (the durable invariant) is **1a** — nothing extra.
- 3b. `SetupProgressModal` "Continue anyway" — keep it, fix the copy. After Phase 1 the pod file _always_ physically exists by the time this modal shows (step 2 can't advance otherwise), so "Continue anyway" only ever skips the _re-sync_ (step 3) / _arming auto-sync_ (step 4), both of which retry on next launch. Update `setupProgress.error.*` strings to say that ("Your pod is created — we just couldn't finish a background step; it'll retry next time you open the app"). Greg's "no option to continue past a failed data-file write" requirement is satisfied at the _real_ fatal point (the Drive connect / `handleStep2Next`), not here.

### Phase 4 — docs & memory

- **ADR** (`docs/adr/0XX-ios-redirect-oauth.md`): the popup/postMessage/ITP failure mode; redirect-for-all-iOS; the recovery mechanism (URL param + in-memory token + re-enter password — explicitly _no_ secrets in sessionStorage); the Picker caveat. Supersedes the "Why not iOS regular Safari?" rationale in the `shouldUseRedirectAuth` docstring.
- **Memory** `reference_ios_oauth.md` (type `reference`), indexed in `MEMORY.md`. The "surface friction only when it happens" rule (`[[feedback_no_predictive_warnings]]`) still holds — this is UA-sniff _routing_, not UA-sniff _warnings_.
- Help Center: light touch-up if the iPhone-setup story changes.
- On ship: `docs/STATUS.md` + `CHANGELOG.md`; copy this plan to `docs/plans/2026-05-13-onboarding-iphone-drive-hardening.md`; GitHub issue(s) `bug` + `priority: critical` + `area: sync`/`auth` + `page: login`, through the `in-progress` → `ready-for-testing` workflow.

---

## Files affected

**New:** `src/utils/withTimeout.ts`; `src/components/login/PodStorageStep.vue`; `src/components/login/ResumePodSetup.vue`; `docs/adr/0XX-ios-redirect-oauth.md`; `reference_ios_oauth.md` memory; `docs/plans/2026-05-13-onboarding-iphone-drive-hardening.md`.
**Changed:**

- `src/services/google/googleAuth.ts` — `shouldUseRedirectAuth()` (all-iOS) + docstring; `waitForAuthCode()` via `withTimeout`.
- `src/components/login/CreatePodView.vue` — step 2 becomes `<PodStorageStep>` (~150 lines move out); `handleStep2Next` else-branch blocks; ping/`podCreated` no longer here (moved to `createNewFile`).
- `src/pages/LoginPage.vue` — `route.query.resume === 'setup'` → `activeView = 'resume-setup'` (`<ResumePodSetup>`); the create-pod success path unchanged otherwise.
- `src/router/index.ts` — `requiresAuth` guard also requires `authStore.podCreated` → reroute to `?resume=setup`.
- `src/App.vue` — `withTimeout` for the `completeRedirectAuth` race; `reportError` on failed `completeRedirectAuth` + post-init no-data; `loadFamilyData` Path 3 / post-init health check defer to the guard for `!podCreated` (don't init an empty doc, don't show the error overlay).
- `src/stores/authStore.ts` — `podCreated` on the persisted session; `signOut` clears it; `buildOwnerDoc()` private helper factored out of `signUp`; `rehydrateOwnerDoc(name, password)`.
- `src/stores/syncStore.ts` — `createNewFile()` fires the `🎉` ping + sets `authStore.podCreated` on success.
- `src/stores/familyStore.ts` + `src/types/models.ts` (or the input type's home) + the family repo — optional `id` on `CreateFamilyMemberInput`, used by `createFamilyMember` if present.
- `src/config/features.ts` — startup `console.warn` if `errorReporter` off in a cloud build.
- `src/components/settings/...` (Family Data section) — hide "Move to Google Drive" when `shouldUseRedirectAuth()`.
- `src/components/login/SetupProgressModal.vue` — honest `setupProgress.error.*` copy.
- `.github/workflows/deploy.yml` — confirm `VITE_BEANIES_ERROR_WEBHOOK_URL` wiring (greg verifies the repo var).
- `docs/STATUS.md`, `CHANGELOG.md`.
  **Tests:** `withTimeout` unit; `googleAuth` (iOS UA → redirect; `waitForAuthCode` timeout); `PodStorageStep` (Drive-connect failure → recovery actions; redirect mode → `startRedirectAuth`); migrate the existing `CreatePodView` storage-step assertions onto `PodStorageStep` + keep a thin `CreatePodView` test; `syncStore.createNewFile` (fires the ping for both storage types; flips `authStore.podCreated`); the router `podCreated` guard; `authStore.rehydrateOwnerDoc`; `ResumePodSetup`. E2E: extend the existing create-pod spec to assert an owner member exists in the doc after a completed _local-file_ create — stay within the ADR-007 25-test cap (no new spec without removing one).

---

## Verification

**Local (`npm run validate` + `npm run dev:all`)**

- Type-check / lint / format / unit / build all green.
- Create a **local-file** pod end-to-end → `.beanpod` written, doc has the owner member, `slackNotify` called with `🎉 Family pod created!` (stubbed-`slackNotify` assert in a test; if `.env` has `VITE_SLACK_WEBHOOK_URL`, also eyeball Slack); `authStore.podCreated === true`.
- Create a **Drive** pod end-to-end (desktop) → same.
- **Zombie-state repro:** complete step 1 (signup), then via devtools clear the in-memory doc and reload (or kill + reopen the tab) → land on `<ResumePodSetup>` (re-enter password → pick storage → finish), **not** an empty `/nook`; finishing produces a working pod + the `🎉` ping; `app.onboardingZombieState` was reported. Also: directly visiting `/nook` while `isAuthenticated && !podCreated` → guard reroutes to `?resume=setup`.
- **Else-branch repro:** force `syncStore.isConfigured` to read `false` in `handleStep2Next` → it **blocks** with an error + `severity:'error'` report, never reaches step 3.
- **Hang repro:** throttle/abort the OAuth (devtools) → `waitForAuthCode` rejects with the clear timeout message after ~120 s, it's reported, the Drive-failure modal offers Try again / Use a local file / Get help, and `PodStorageStep`'s `isSavingStorage` resets.

**iOS device (greg, real iPhone)**

- Safari, _browser_ (not installed): create a Drive pod → **full-page redirect** to Google (no popup/tab), returns to `?resume=setup`, re-enter password, finishes, lands on `/nook` with data. Close the OAuth tab mid-flow and reopen → `<ResumePodSetup>` via the guard.
- Chrome on iOS: same.
- Standalone PWA (installed): regression — create + load both still work.
- Load an existing pod on iOS Safari browser: the Google Picker still works (or the in-app `.beanpod` list, if 2d replaced it).
- After the runs, check `#beanies-errors`: every surfaced failure has a message; a clean run has none.

**Diff vs `main`**

- A user who abandons onboarding after step 1 (or hits the Drive 400) can never reach a functional-looking-but-empty `/nook` — always `<ResumePodSetup>`, always a Slack alert. iPhone-browser users get the redirect Drive flow standalone-PWA users already had. `🎉 pod created` fires for every completed pod (local or Drive) from one place. `CreatePodView` is _smaller_ than before (the storage step is now a reusable component).
