# Plan: iPhone Onboarding Round 2 — create-redirect resume + re-login reconnect

> Date: 2026-06-19
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-19-ios-onboarding-round2.md`
> Follows: `docs/plans/2026-06-19-onboarding-hardening.md` (round 1, shipped `b353807`)

## User Story

As someone setting up or signing back into beanies.family on an iPhone, I want create-a-family to finish smoothly after the Google redirect (no second password, no recovery-screen detour, no stray drawers) and re-login to reconnect to Drive without bouncing — so onboarding actually completes on iOS the way it does on desktop.

## Context

Round 1 (`b353807`, confirmed live via the new welcome-gate version marker) fixed the orphan-collision loop, but greg's iPhone retest surfaced two **control-flow** bugs that round 1 didn't touch. **Nothing fired to Slack during either repro** — confirming these are routing/timing bugs, not thrown-and-reported errors.

A 2-agent investigation produced the root causes below. Cluster 1 is fully confirmed against source. Cluster 2's _shape_ is confirmed but its exact trigger needs pinning during implementation (candidates documented).

### Cluster 1 — iOS create-pod detours through the generic recovery screen

On iOS, the create wizard can't finish inline — connecting Drive needs a full-page redirect to Google (no popups). The redirect's return path is hard-coded to `RESUME_SETUP_PATH` (`connectStorage.ts:135`), so on return App.vue's `needsPodSetup` branch (~820-875) routes **every** podless-authenticated session into the **generic** `ResumePodSetup`. There is no "resume the create wizard" path; step-1 state (family name, owner, members, password) lives in `CreatePodView` local refs (`:44-78`) and dies on the page reload. `ResumePodSetup.runProbe` → `no-registry-entry` → `phase='identity'`, which re-collects name **and password** (the confusing second password). The "error flash" is a transient render during the boot→`safeRouterReplace` handoff (no Slack = not a real error). The what's-new + notifications drawers auto-open because `useNotifications.ready()` (`:47-117`) flips true the instant the new family completes setup and a brand-new user has no `lastSeenWhatsNew` marker, so the Beanie Lists spotlight (`2026.06.18.2`) auto-opens.

### Cluster 2 — iOS re-login after trusted-device "log out (save data)"

Repro: create → sign out keeping data → "Welcome back" → prompted to reconnect Google (despite preserved token) → reconnect+consent → bounced back to the same reconnect screen → hit back, sign in again → pod decrypts. So the first post-consent return fails to load; a second entry (token settled) succeeds.

**Important nuance found during planning:** `handleFamilySelected` (`LoginPage.vue:438`) calls `syncStore.initialize()`, which **does** restore the refresh token into memory via `initializeAuth(activeFamilyId)` (`syncStore.ts:390`). So the reconnect prompt is **not** simply "no silent attempt." The likely triggers are (to be pinned): (a) the silent **refresh network call** to the OAuth proxy failing/timing out on iOS cold-start (the same Lambda cold-start / wake-network race as prod error #3) → `getValidTokenSilent` throws → `loadFromFile` returns `reason:'auth'` → reconnect panel; and/or (b) `restored`/`providerType` not yet `google_drive` when `initialize()` runs, so `initializeAuth` is skipped. The **post-consent bounce** is a timing race: `isTokenValid()` (`googleAuth.ts:~877`) checks only in-memory `accessToken`, and the resume picker (`LoadPodView` `autoOpenDrivePicker` → `openDrivePicker({isResume:true})`) can run before `completeRedirectAuth()` has set it.

### Decision locked with greg (2026-06-19)

For cluster-1's double password: **persist the in-progress create-wizard state (including the password) in sessionStorage across the redirect and resume `CreatePodView`** so the user is NOT re-asked. greg explicitly accepted the transient-sessionStorage tradeoff over the (more secure) re-enter option. The storage must be transient + minimal (see Security section).

## Requirements

### Cluster 1 — create-pod resume

1. **Persist + resume the create wizard across the iOS redirect.** Before `CreatePodView` triggers the Drive redirect, persist the wizard state (family name; owner name/email/role; added members; password; newsletter opt-in; the chosen storage type) to a dedicated sessionStorage key. On return, detect the create-resume and route back into the create flow, restore state + the now-valid Drive token, and run `createNewFile` **without re-prompting for the password**.
2. **Wipe the persisted state** the instant the pod is created successfully, AND on any abort/error/cancel, AND it must never be logged. (See Security.)
3. **No generic-recovery detour for the create case.** A create-in-progress return must not land on `ResumePodSetup`'s `identity` phase. (The generic `ResumePodSetup` recovery path stays intact for its real scenario-(b) data-loss case and for `?resume=load-drive`.)
4. **No error flash** on the redirect return for the create case (a clean resume removes the transient paint).
5. **No stray drawers for brand-new families.** A freshly-created family must NOT auto-open the what's-new / notifications drawer. Seed all existing release versions as "read" for a new family (nothing is "new" to a brand-new user) and/or suppress auto-open in the same session a pod was just created. Must NOT regress the normal what's-new auto-open for returning users on a genuine update.

### Cluster 2 — re-login reconnect

6. **Pin the exact trigger first** (instrument or trace) — confirm whether the welcome-back reconnect prompt is the silent-refresh network failure vs a skipped `initializeAuth`, and whether the post-consent bounce is the `isTokenValid()` timing race. Fix the confirmed cause(s); don't blanket-patch.
7. **Silent reconnect before prompting** on the welcome-back path: attempt the preserved-token silent reconnect (with bounded retry for the cold-start race) before surfacing the reconnect panel.
8. **Post-consent return loads, not bounces:** ensure the resume picker/load runs only after the just-committed token is observable (consult the committed token / await `completeRedirectAuth` before the resume dispatch, or make the resume check token-recoverable rather than only in-memory `isTokenValid()`).

## Important Notes & Caveats

- **Security (locked sessionStorage decision):** the persisted create-wizard blob contains the password. Constraints: a dedicated key (e.g. `beanies:pending-create`); written **only** immediately before the redirect; **wiped** on (a) successful `createNewFile`, (b) any thrown/abort/cancel in the resume, (c) the user navigating away/starting over; **never** logged or sent to telemetry/Slack; same-origin + same-tab (sessionStorage) only; consider storing the password under a separate sub-key wiped independently as soon as `createNewFile` consumes it, even if the rest of the blob lingers a tick. Document the exposure window (redirect round-trip only) and that the password is already in the page's memory during normal create, so the marginal risk is the transient at-rest copy in sessionStorage (cleared on tab close regardless).
- **Redirect-surface path:** the persist/resume path is gated on `shouldUseRedirectAuth()`, which is true on BOTH iOS web/PWA AND native Capacitor (ADR-029) — native routes through the same `RESUME_SETUP_PATH` deep-link return (connectStorage.ts:145-147), so native create-pod is a POSITIVE create-resume path that exercises the same blob persist/consume + fast-path, NOT a leave-alone case. Only desktop (popup, no page reload) bypasses it. Verify: iOS web AND native both resume cleanly via the blob; desktop is untouched.
- **Idempotency / re-entry:** the redirect can return more than once (back button, double-trigger). Restoring + resuming must be idempotent; a second consume of the pending state must no-op (it was wiped on first success).
- **Do NOT break the generic `ResumePodSetup`** for its real recovery cases (scenario-(b) IndexedDB eviction with an existing pod; `?resume=load-drive`). The create-resume is an additional, more specific path — not a replacement.
- **What's-new seeding must be precise:** only a _genuinely new_ family (just created here) seeds-all-read; a returning user on a real update must still get the auto-open. Tie the seed to pod-creation, not merely to "no localStorage marker" (which is also true for a returning user on a fresh browser who loaded an existing pod).
- **Cluster 2 fix must not regress** the round-1 change (the `beginDriveAuthRedirectIfNeeded` guard now in `attemptResumeFromRegistry`) or the trusted-device preserve behavior (ADR-031).
- **Reuse-in-place over extraction (DRY, verified):** the create-resume must NOT duplicate or extract the finalize logic. Call ResumePodSetup's existing `handleIdentityNext()` (which chains `rehydrateOwnerDoc` → `finishOnDrive` → `finalizePod` → `createNewFile`, incl. the adopt-existing collision recovery). The only new code in ResumePodSetup is the `onMounted` fast-path branch (restore the owner name from the blob; obtain the password via the single atomic `consumePendingCreatePassword()` read-and-delete so the at-rest copy is gone before `handleIdentityNext()` runs; **set BOTH `password.value` AND `confirmPassword.value` to the consumed password** — `handleIdentityNext` calls `validateIdentity()` first, which requires `confirmPassword` present and equal to `password`; the restored password already passed these checks in step 1, so the mirror is a no-op re-validation; call `handleIdentityNext()`) wrapped in a try/finally that calls `clearPendingCreate()` on every resolution. No separate "wipe the password sub-key" step for the component to forget — consumption deletes it.

## Assumptions

> Review before implementation — valid at planning time (2026-06-19).

1. sessionStorage survives the full-page Google OAuth redirect round-trip in iOS Safari + installed PWAs (it is tab-session scoped; the redirect stays in the same tab). The shipped `RESUME_REASON_KEY` (resumePaths.ts:63) already relies on sessionStorage surviving this exact redirect, so there is prod evidence it holds for Safari. If a PWA DOES drop the tab session, the fallback is **automatic and lossless and needs NO new code**: `hasPendingCreate()` returns false → the fast-path doesn't fire → `runProbe()` → `no-registry-entry` → `identity` phase → the user re-enters name+password (today's behavior). The only cost in that edge case is the re-entry the plan otherwise avoids.
2. After `signUp` in create step 1, the auth/session is established such that, on resume, restoring the password lets `createNewFile` derive the family key and write the pod without a fresh `signUp`. Confirm what `ResumePodSetup.handleIdentityNext` does today (`rehydrateOwnerDoc` + `createNewFile`) and reuse that exact sequence in the create-resume rather than duplicating it.
3. `syncStore.initialize()` restoring the refresh token via `initializeAuth` is reached on the welcome-back path (provider is `google_drive`, `restored===true`). If not, that's cluster-2 cause (b).
4. The OAuth proxy silent-refresh cold-start can take up to ~15s (observed). A bounded retry / await is acceptable UX on re-login (spinner) vs a wrong reconnect prompt.

## Approach

### Cluster 1

**Create-resume sessionStorage contract (DRY).** Add the contract to the existing `resumePaths.ts` (which already owns transient-sessionStorage resume state via `RESUME_REASON_KEY`/`setResumeReason`/`consumeResumeReason`, lines 67-87) rather than a new file/composable — mirror that exact `try/catch`-swallow idiom. Exports: `savePendingCreate(state)`, `loadPendingCreate(): PendingCreate | null`, `clearPendingCreate()`, `hasPendingCreate()`, plus `consumePendingCreatePassword(): string | null` (reads-and-deletes the password sub-key atomically — the single consume site). Typed `PendingCreate`. Keeps all create-resume state in one already-imported, dependency-light module and is the single read/write/wipe site.

**Persist before redirect.** In `CreatePodView.handleChooseGoogleDriveStorage`, just before `connectDriveStorage` can redirect (iOS), call `savePendingCreate(...)`. `connectDriveStorage` already returns `{status:'redirecting'}` on iOS — the persist must happen before that return.

**Resume on return.** No change to App.vue's boot routing or to `resumePaths.ts` routing: a create-in-progress return is still a podless-authenticated session, so App.vue's existing `safeRouterReplace(RESUME_SETUP_PATH, ...)` branch (~870) already lands it on `ResumePodSetup` with no new branch. The create-vs-generic decision lives in **exactly one place** — `ResumePodSetup.onMounted` (the fast-path below) — so there is a single `hasPendingCreate()` decision site, not three that must be kept in agreement. Do NOT add a `hasPendingCreate()` branch to App.vue and do NOT add a create-resume detector to `resumePaths.ts`.

The create-finish reuses `ResumePodSetup`'s **existing** finalize chain unchanged. Verified against source: that chain is NOT a single extractable function — it is `handleIdentityNext()` (ResumePodSetup.vue:314, calls `authStore.rehydrateOwnerDoc`, then on `isTokenValid()` → `finishOnDrive()` → `finalizePod()` → `syncStore.createNewFile`), with name-collision/adopt-existing recovery interleaved in `finishOnDrive` (:409). When we return from the redirect we hold a fresh token, so `handleIdentityNext`'s `isTokenValid()` branch already does exactly the create-finish we need. **Do NOT extract a new shared helper** — there is no clean `rehydrateOwnerDoc + createNewFile` seam to lift, and the collision recovery must stay inline. Reuse by calling the existing function.

**Where the resume UI lives — locked to a `ResumePodSetup` fast-path.** In `onMounted`, before `runProbe()`, check `hasPendingCreate()`; if set, restore `ownerName`/`password`/`confirmPassword` from the blob (set `confirmPassword === password` so `handleIdentityNext`'s leading `validateIdentity()` passes) and call the existing `handleIdentityNext()` directly (which renders `finishing` and runs the full finalize + collision chain). No second component, no duplicated finalize. On success the existing `finalizePod` already does `emit('signed-in','/nook')`. Rather than hand-threading `clearPendingCreate()` into each of the chain's ~8 terminal branches (`finishOnDrive` alone has: collision `declined`, `reject-different-account`, adopt `failed`, `collision-check-unavailable`, cancelled, generic-failure; plus `finalizePod`'s `existing-pod` and critical-failure) — fragile, and a future branch would silently leak the blob — wrap the fast-path invocation so the blob is cleared by ONE structural guard: a try/finally around the fast-path's `handleIdentityNext()` call that clears the blob on every resolution (success navigates away; all error branches funnel to `phase='storage'`). The password is already gone before the chain runs (consumed atomically — see below), so this guard governs only the non-secret blob.

**What's-new seeding.** Verified discriminator: `markPodCreated` is called by **5 loaders** (authStore.ts:260-267); only `createNewFile` (syncStore.ts:1289) is a brand-new family — the other four (`completeAutoLoad`, `loadFromFile`, `loadFromPersistenceCache`, `decryptPendingFileWithKey`) are returning-user loads. Tying the seed to `markPodCreated` would suppress the what's-new auto-open for returning users — the exact regression the caveats warn against. **Tie the seed to `createNewFile` only.** Mechanism (confirmed identical to the migration loop, `useNotifications.ts:91-92`): iterate `getAllReleaseNotes()` and call `notificationsStore.markRead(whatsNewId(release.version))`. At `createNewFile`'s point-of-no-return the doc is loaded and `familyStore.currentMember` is set, so `markRead`'s `applyReducer` guard (notificationsStore.ts:178-186) is satisfied. Each `markRead` is wrapped in try/catch + reportError inside `applyReducer`, so a seed failure is reported, never silent, and never blocks pod creation. Lock the decoupled mechanism (do NOT have syncStore import notificationsStore mid-write — that inverts the existing store dependency direction and adds cross-store coupling). `createNewFile` sets a one-shot "family just created here" flag on a store it already owns; the `useNotifications` ready-watcher (which already imports the stores) consumes it once, runs the seed loop (`getAllReleaseNotes()` → `store.markRead(whatsNewId(release.version))`) **before** `openToLatestAutoOpen()` at useNotifications.ts:114, then clears the flag. Keeps the dependency arrow pointing the existing way (useNotifications → stores) and keeps the seed beside the migration loop (lines 50-67) so the two read-seeding paths stay consistent. The seed MUST complete before `openToLatestAutoOpen` runs in the same flush.

### Cluster 2

**Pin first (Requirement 6).** Add minimal, targeted console diagnostics (dev + a one-release breadcrumb) at: the welcome-back `loadFromFile` `reason:'auth'` branch (was the token restored? did silent refresh throw? what error?), and the post-consent resume (`isTokenValid()` at `openDrivePicker` time). Confirm the exact trigger before finalizing the fix. (No Slack spam — console/breadcrumb only.)

**Silent reconnect before prompt (Requirement 7).** Verified exact seam: `LoginPage.handleFamilySelected`'s auth-failure branch (LoginPage.vue:483) sets `reconnectDriveFile` with **no** silent-reconnect attempt — `loadFromFile` returns `reason:'auth'` even though `syncStore.initialize()` (called at :448) already restored the refresh token. Fix here: when `loadResult.reason === 'auth'` and the provider is `google_drive`, call `tryReconnectSilently(providerAccountEmail)` (with a bounded retry for the ~15s cold-start) and, on success, re-run `syncStore.loadFromFile()` once before deciding; only set `reconnectDriveFile` if the silent path genuinely fails. Reuse `tryReconnectSilently` from `@/services/google/driveTokenRecovery` directly (do NOT route through `beginDriveAuthRedirectIfNeeded` here — that bundles a full-page redirect we don't want on this non-redirect seam). Note: the create/resume redirect path already does silent-before-redirect inside `beginDriveAuthRedirectIfNeeded` (connectStorage.ts:70) — no change needed there.

**Post-consent settle (Requirement 8).** Verified exact seam: `LoadPodView.openDrivePicker`'s resume guard (LoadPodView.vue:590) does `if (opts.isResume && !isTokenValid())` → surface error. `isTokenValid()` checks only in-memory `accessToken`, so a return where `completeRedirectAuth` hasn't yet committed the token errors out (the bounce). Fix in place at line 590: before surfacing the error, attempt `tryReconnectSilently(syncStore.providerAccountEmail)`; only error if that also fails. This keeps the existing loop-guard intent (don't re-redirect) while making it token-_recoverable_ aware rather than in-memory-only. Prefer this over re-ordering the LoginPage dispatch (smaller blast radius, no boot-sequence change). Keep `formError = t('googleDrive.authFailed')` as the genuine-failure fallback so nothing fails silently.

## Files Affected

- `src/components/login/pendingCreate.ts` (new) — sessionStorage contract for the create-resume blob (`savePendingCreate`/`loadPendingCreate`/`clearPendingCreate`/`hasPendingCreate`; password under a separately-wiped sub-key). **Mirror the existing transient-sessionStorage idiom in `resumePaths.ts:67-87`** (`RESUME_REASON_KEY` + `set`/`consume` with try/catch swallow). Consider co-locating in `resumePaths.ts` rather than a new file, since that module already owns resume-return sessionStorage state.
- `src/components/login/CreatePodView.vue` — persist wizard state before the iOS Drive redirect; clear on abort.
- `src/components/login/ResumePodSetup.vue` — create-resume fast-path: `onMounted` (before `runProbe`) restores `ownerName` + `password` + `confirmPassword` (confirmPassword mirrors password so the leading `validateIdentity()` in `handleIdentityNext()` passes) from the pending blob and calls the **existing** `handleIdentityNext()` in place, wrapped in a try/finally that calls `clearPendingCreate()` on every resolution.
- `src/components/login/resumePaths.ts` — **add the `pendingCreate` sessionStorage contract here** (co-located with the existing `RESUME_REASON_KEY` idiom, lines 67-87), NOT a new file. No create-resume routing/detector helper — routing stays a single decision in `ResumePodSetup.onMounted`.
- (no new finalize helper — verified there is no single extractable `rehydrateOwnerDoc + createNewFile` seam in ResumePodSetup; the create-resume calls the existing `handleIdentityNext()`/`finishOnDrive()`/`finalizePod()` chain in place.)
- `src/App.vue` — **no change** (reviewed, left untouched). The existing podless→`RESUME_SETUP_PATH` boot branch already delivers the create-resume return to `ResumePodSetup`; the fast-path there handles it.
- `src/pages/LoginPage.vue` — welcome-back silent-reconnect-before-prompt (Req 7); resume dispatch ordering (Req 8); cluster-2 diagnostics.
- `src/components/login/LoadPodView.vue` — post-consent resume token-settle (Req 8); cluster-2 diagnostics.
- `src/composables/useNotifications.ts` and/or the new-family creation path — seed-all-read for brand-new families (Req 5).
- `src/services/translation/uiStrings.ts` — any new copy (create-resume "finishing setup" messaging, reconnect-in-progress) `en` + `beanie`; then `npm run translate`.
- Tests — see Testing Plan.

## Acceptance Criteria

- [ ] On a real iPhone, create-a-family after the Google consent screen finishes **without** a second password prompt and **without** landing on the generic recovery screen.
- [ ] No error flash on the create redirect return.
- [ ] A brand-new family (seeded **only** via the `createNewFile` path, not the shared `markPodCreated`) does NOT get the what's-new / notifications drawer auto-opening after setup; all four returning-user loaders (`completeAutoLoad`, `loadFromFile`, `loadFromPersistenceCache`, `decryptPendingFileWithKey`) still trigger the normal what's-new auto-open on a genuine update.
- [ ] The persisted create blob is wiped on success, on abort/cancel, and on error; never logged; gone after tab close.
- [ ] Desktop popup create is unaffected (regression-checked). Native Capacitor create exercises the SAME blob persist/consume + resume fast-path as iOS web and finishes without a second password (positive path, not just a regression check).
- [ ] On iPhone, re-login after trusted-device "log out (save data)" reconnects to Drive and loads the pod on the **first** post-consent return (no bounce); silent reconnect is attempted before any reconnect prompt.
- [ ] The exact cluster-2 trigger is identified and the fix addresses the confirmed cause (documented in the plan/PR).
- [ ] `npm run validate` green (lint incl. i18n, type-check, unit suite, build).

## Testing Plan

### Unit / component (Vitest)

1. `pendingCreate` module — save/load round-trip; `clear` wipes both blob + password sub-key; `load` after `clear` returns null; malformed JSON → null (no throw).
2. `CreatePodView` — on iOS (`shouldUseRedirectAuth` mocked true), choosing Drive persists the pending blob before the redirecting return; on a non-redirect (desktop) it does NOT persist.
3. `ResumePodSetup` create-resume fast-path — with `hasPendingCreate()`, `onMounted` skips the `identity` form and invokes the existing `handleIdentityNext()` (assert no password input rendered; assert `validateIdentity()` passes because `confirmPassword` was restored, so the chain is NOT short-circuited; assert `createNewFile` called with the restored password). Assert the blob is cleared on success AND on each terminal error branch (`finalizePod` failure, `finishOnDrive` cancel, collision `declined`, `existing-pod` refusal, thrown error) via the single structural try/finally guard — table-drive these so no error path leaves the blob at rest, and so the guard (not per-branch calls) is exercised. Assert the password sub-key is already gone after `consumePendingCreatePassword()` returns (before `handleIdentityNext` runs), independent of outcome.
4. New-family what's-new seeding — assert the seed runs on the `createNewFile` path and `openToLatestAutoOpen` then opens nothing; assert each of the four returning-user loaders (`completeAutoLoad`/`loadFromFile`/`loadFromPersistenceCache`/`decryptPendingFileWithKey`) does NOT seed and a genuine update still auto-opens. Assert a `markRead` write failure during seeding is reported (via `applyReducer`) and does not throw out of `createNewFile`.
5. Cluster 2 — welcome-back auth-failure branch attempts `tryReconnectSilently` before setting the reconnect panel; post-consent resume treats a recoverable token as valid (no re-redirect) — model the first-vs-second-return ordering.

### Why existing tests didn't catch these

There is no test exercising the **iOS create-redirect→resume** round-trip (create tests stop at the inline/desktop path), nor the **trusted-relogin reconnect ordering** (resume tests cover registry probe outcomes, not the welcome-back `loadFromFile`→reconnect→post-consent sequence). Tests 2-5 close exactly those gaps.

### Manual / device (the real gate)

6. iPhone (iOS Safari + installed PWA): full create-a-family → confirm single password, clean finish, no drawers, no flash; verify `sessionStorage` is empty afterward.
7. iPhone: trusted-device "log out (save data)" → welcome back → first post-consent return loads the pod.
8. Desktop + native: regression-check create + re-login still work.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted both clusters; locked sessionStorage create-resume (reuse ResumePodSetup finalize fast-path + shared finalize helper); what's-new seed-for-new-family; cluster-2 pin-first then silent-reconnect-before-prompt + post-consent token-settle; security section for the password blob; tests + why-missed + device gate.
- **Pass 2 (DRY + error handling)**: Verified all reuse claims against source. Corrected the central DRY claim — there is NO single `rehydrateOwnerDoc + createNewFile` seam to extract in ResumePodSetup (the chain is `handleIdentityNext` → `finishOnDrive` → `finalizePod` with collision recovery interleaved); create-resume now reuses `handleIdentityNext()` in place via a `ResumePodSetup` onMounted fast-path instead of a phantom helper. Pinned the what's-new seed to the `createNewFile` path ONLY (not the shared `markPodCreated`, which 5 loaders call) to avoid regressing returning-user auto-open. Anchored `pendingCreate` to the existing `resumePaths.ts` transient-sessionStorage idiom. Corrected both cluster-2 fix sites to exact lines: silent-reconnect-before-prompt → `LoginPage.handleFamilySelected` `reason:'auth'` branch (:483); post-consent settle → `LoadPodView.openDrivePicker:590` (token-recoverable not in-memory-only). Hardened error paths so every terminal create-resume branch wipes the blob + password sub-key (table-driven tests); seed-write failures reported, never silent.
- **Pass 3 (Sustainability)**: Removed a 3-site routing-decision spread — the create-vs-generic-resume choice now lives in EXACTLY ONE place (`ResumePodSetup.onMounted` fast-path); App.vue boot + `resumePaths.ts` get no `hasPendingCreate()` branch (App.vue's existing podless→`RESUME_SETUP_PATH` already delivers the return). Locked the sessionStorage contract into existing `resumePaths.ts` (no new file) and made password consumption atomic via `consumePendingCreatePassword()` (read-and-delete in one call) so the secret's at-rest lifetime is structurally bounded. Replaced "thread `clearPendingCreate()` into every error branch" (~8 terminal branches, fragile) with a SINGLE structural try/finally guard covering all current + future branches. Locked the what's-new seed to the decoupled one-shot-flag mechanism (consumed by `useNotifications`), explicitly rejecting a store→store mid-write import that would invert the dependency direction. Confirmed the in-place `handleIdentityNext()` reuse + the two cluster-2 in-place seams are the right low-coupling calls — left unchanged.
- **Pass 4 (Fresh-eyes sweep)**: Caught one latent bug — the create-resume fast-path must restore `confirmPassword` (not just name+password): `handleIdentityNext()` calls `validateIdentity()` first, which hard-requires `confirmPassword` non-empty AND equal to `password`; restoring only password would short-circuit the chain and strand the user. Fixed to mirror `confirmPassword === password` (no-op re-validation, since step 1 already passed). Corrected the native framing: `shouldUseRedirectAuth()` is true on native (ADR-029) and native routes through the same `RESUME_SETUP_PATH` deep-link return, so native create-pod is a POSITIVE create-resume path, not a leave-alone regression. Made the sessionStorage-drop fallback explicit: degradation to the `identity` re-entry phase is automatic, needs no new code, with prod precedent (`RESUME_REASON_KEY`). Confirmed the LoadPodView:590 `tryReconnectSilently` fix cannot loop (single silent refresh, no redirect/recursion). Otherwise solid — single-decision routing, reuse-in-place, atomic password consume, single try/finally guard, `createNewFile`-only seed all verified against source.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial report (greg, 2026-06-19, on confirmed build b353807)

Onboarding on iPhone still not fully working. (1) After Google consent the create flow flashes an error, lands on the recovery page, and asks to create a password again (already created in step 1). (2) After the 2nd password, the what's-new + notifications drawers pop up unprompted, then a spinner, then setup completes. (3) Re-login is inconsistent: after creating a family + logging out (save data), tapping "welcome back" prompts a Google reconnect despite a valid token; reconnecting + consenting bounces back to the same reconnect screen; only after hitting back then sign-in again does the pod decrypt and members load. Suggested running another code-review on this process.

### Follow-up

"Note that nothing was triggered to slack during these two onboarding processes" → confirms control-flow/timing bugs, not thrown errors.

### Decision — iOS double password

greg chose "Persist wizard state, skip re-entry": stash the in-progress create-wizard state (incl. password) in sessionStorage across the redirect and resume CreatePodView so the user is not re-asked; accepted the transient-sessionStorage tradeoff (cleared immediately after pod creation).

</details>
