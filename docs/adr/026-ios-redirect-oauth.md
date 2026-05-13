# ADR-026: iOS uses full-page redirect OAuth (not popups), and onboarding can never strand a "logged in but no pod" state

> Date: 2026-05-13
> Status: Accepted
> Supersedes the "Why not iOS regular Safari?" rationale in `shouldUseRedirectAuth()`'s docstring (ADR-020 era).

## Context

A real user (Shaun, Hong Kong, iPhone / Chrome-on-iOS, app loaded in the browser — **not** a standalone PWA) tried to create a pod on Google Drive. The Google account chooser appeared correctly ("to continue to beanies.family"), he picked his account, then **Google itself returned a generic 400** — _"The server cannot process the request because it is malformed. It should not be retried."_ — on `accounts.google.com`. He ended up at `/nook` with **zero family members and no `.beanpod` file**, and **nothing reached `#beanies-errors`**. Several earlier pilots' onboarding "started" (the `🫘 started` Slack ping fired) but never produced a pod — likely the same thing, also on iPhones.

Three faults compounded:

1. **Popup/new-tab OAuth is fragile on iOS.** `requestAccessToken()` opens `window.open('about:blank', …)` then navigates that window to Google. On iOS that opens a _new tab_, not a true popup; `postMessage` from the callback page back to the opener is unreliable, and `popup.closed` doesn't reliably flip — so `waitForAuthCode()` could hang forever. Worse, the OAuth _continuation_ after the account chooser runs into iOS cookie / ITP partitioning in the new-tab context and Google returns the generic `invalid_request` 400. **Standalone-PWA iOS users already worked** because `shouldUseRedirectAuth()` routed them through the full-page redirect flow — that's the "works on some iPhones, not others" split. And `CreatePodView`'s Drive connect called `requestAccessToken()` _directly_, never consulting `shouldUseRedirectAuth()` at all.

2. **A half-finished onboarding could render an empty `/nook`.** `authStore.signUp()` persists the session + sets `isAuthenticated` _before_ storage is chosen. The router guard only checked `isAuthenticated`. So a failed Drive connect (the 400) or just walking away left an authenticated session with no pod file — and the next load routed straight to `/nook`, where `loadFamilyData` Path 3 `initDoc()`'d an empty doc, the `getDoc()` health check passed (an empty doc is still a doc), and `/nook` rendered with nothing.

3. **Onboarding failures didn't page Slack, and `🎉 pod created` was unreliable.** `reportError → slackPost(getWebhookUrl())` reads `VITE_BEANIES_ERROR_WEBHOOK_URL` (a GitHub repo _variable_, distinct from the working `VITE_SLACK_WEBHOOK_URL`) — if unset it no-ops. The iOS 400 produced a _hang_, not a thrown error, so even a working webhook saw nothing. And the `🎉 Family pod created!` ping fired from one component method, didn't fire for local-file pods, and wouldn't fire on the recovery path.

## Decision

1. **`shouldUseRedirectAuth()` (`src/services/google/googleAuth.ts`) returns `true` for all iOS / iPadOS WebKit** (`/iP(hone|od|ad)/` in the UA, or `navigator.platform === 'MacIntel' && maxTouchPoints > 1` for iPadOS-as-Mac), not just standalone PWAs. The popup path's failure modes outweigh the old worry that redirect-auth's ITP top-level navigation breaks the Google Picker iframe — and that worry only ever affected the _load-existing-pod_ picker, never create-pod. If it resurfaces it's handled at the picker, not by reverting this.

2. **The create-pod / connect-Drive paths honour redirect mode.** The shared `connectDriveStorage()` helper (`src/services/sync/connectStorage.ts`) does `startRedirectAuth('/welcome?resume=setup', email)` when `shouldUseRedirectAuth()` and we don't already hold a valid token — a full-page redirect to Google, no popup. On return the **resume-setup recovery screen** (`ResumePodSetup.vue`, reached via `?resume=setup`) re-asks for the owner's password, rebuilds the in-memory Automerge doc (which the full-page redirect destroyed) via `authStore.rehydrateOwnerDoc()`, then finishes on the Drive token already in memory. **No secrets are stashed across the redirect** — the user re-enters the password (honest UX after a full-page bounce to Google); the Google token survives in `googleAuth.ts`'s in-memory state (set by `completeRedirectAuth()` on App init); "I'm mid-recovery" rides in one URL query param.

3. **One durable invariant: `authStore.podCreated`.** A persisted boolean (per-browser, `beanies_pod_created`) — `'1'` ⇒ pod exists; `'0'` ⇒ pod pending (set the moment `signUp` succeeds, flipped to `'1'` by `syncStore.createNewFile`); absent ⇒ treated as `'1'` (migration: users who created a pod before this flag, and the moment of `signIn`/`joinFamily` into an already-built pod). The router guard + App.vue require `isAuthenticated && podCreated` for `requiresAuth` routes; otherwise → `/welcome?resume=setup`. So "authenticated" alone never routes to `/nook`; the recovery screen is the half-finished-onboarding state's normal home, and the guard reroute reports `app.onboardingZombieState` so we see how often it fires.

4. **`waitForAuthCode()` has a hard timeout** (120 s), via the shared `withTimeout()` util — a stuck/orphaned popup converts to a reported, recoverable error instead of a hang. The create-pod Drive connect wraps `GoogleDriveProvider.createNew()` in a longer timeout so its "connecting…" state can never wedge.

5. **Every onboarding/auth/Drive failure pages `#beanies-errors`**: failed `completeRedirectAuth` (`app.redirectAuthCompletion`), post-init no-doc on a non-login route (`app.postInitNoData`), the zombie-state reroute (`app.onboardingZombieState`), Drive connect / local-file failures (`createPod.connectDrive` / `createPod.selectLocalFile`, severity `error` unless a genuine user cancellation), `createPod.createNewFile`, and the resume-screen equivalents (`resumeSetup.*`). The Drive-failure modal offers **Try again** / **Use a local file instead** (the diagnostic is already on its way to Slack) and never lands the user in the app. `features.ts` logs a loud `console.warn` in production builds if `errorReporter` is off while a cloud feature is on (so an unset `BEANIES_ERROR_WEBHOOK_URL` repo variable can't masquerade as working error reporting).

6. **`🎉 Family pod created!` fires from `syncStore.createNewFile()` on success** — that's _already_ the "the `.beanpod` exists now" event — so every caller (create-pod wizard, resume screen, any future one) gets it for free, for every storage type.

## Consequences

- iPhone-browser users get the same working full-page-redirect Drive flow standalone-PWA users already had.
- The app can never render a functional-looking-but-empty `/nook` for a half-finished onboarding — always the resume screen, always a Slack alert.
- One extra round-trip (re-enter password) on the recovery path. Acceptable: it's a recovery path, and re-confirming the password before encrypting a family's data is reasonable after a full-page bounce.
- **Out of scope (follow-up):** "Move to Google Drive" migration of an _existing_ pod on iOS — it would need the same redirect+re-auth dance with the family key. The Settings → Family Data "Move to Google Drive" row is hidden on iOS / PWAs until that's wired (so users don't hit the broken popup). "Move to a local file" (Drive → local, no OAuth) still shows.
- **To re-validate:** the Google Picker (load-existing-pod) on iOS Safari under redirect-auth. If it still breaks ("API developer key invalid" after the ITP top-level nav), swap it on iOS for an in-app `.beanpod` chooser (`files.list` over our app-folder with the `drive.file` token — no third-party iframe). Invitees never hit the picker (the invite link carries the `fileId`); only "owner on a new device with no invite link" does, and they have the local-file fallback.

## Key files

- `src/services/google/googleAuth.ts` — `shouldUseRedirectAuth()` (all-iOS), `waitForAuthCode()` timeout.
- `src/services/sync/connectStorage.ts` — `connectDriveStorage()` / `connectLocalStorage()` (shared by the create-pod wizard + the resume screen; owns the popup-vs-redirect decision).
- `src/components/login/ResumePodSetup.vue` — the recovery screen.
- `src/stores/authStore.ts` — `podCreated` flag; `buildOwnerDoc()` / `rehydrateOwnerDoc()`.
- `src/stores/syncStore.ts` — `createNewFile()` fires the ping + flips `podCreated`.
- `src/router/index.ts`, `src/App.vue` — the `podCreated` routing guard.
- `src/utils/timing.ts` — `withTimeout()`.
- `src/config/features.ts` — the loud warn for a missing error webhook.
