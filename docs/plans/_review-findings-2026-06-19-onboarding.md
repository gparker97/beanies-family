# Onboarding review findings — 2026-06-19 (source for the plan)

> Workflow-backed `/code-review max` over the onboarding surface. 70 candidates → 53 verified → 15 reported. Anchored by 4 prod errors from a real iPhone (iOS 18.7 Safari) onboarding failure (daphne@seror.it) that took 4+ attempts and never succeeded.

## Anchoring prod errors (triaged)

1. `app.onboardingZombieState` (build 8f8cbbf1, 55 behind, desktop Edge) — NOISE/stale build (CreateFamily already in PODLESS_EXPECTED_ROUTE_NAMES; boot guard sound — both route.name theories REFUTED).
2. `createPod.connectDrive` (042bad13, Android) — GENUINE: granular-consent `drive.file` deselection hard-fails (→ finding 3).
3. `cold-start-reconnect-escalation` (7013035c, greg's own Android, existing-family load) — transient Lambda 15s cold-start; telemetry working as designed (but feeds finding 4's loop).
4. `unhandled-error` "Script error." (7013035c, iPhone, the failing session) — GENUINE but opaque; observability blind spot (→ finding 12).

## CONFIRMED findings (ranked)

### 🔴 Critical — iOS onboarding dead-end (the 4-attempt failure)

1. **Name-collision loop on recovery** — `src/components/login/ResumePodSetup.vue:396` — `finishOnDrive()` has no `errorKind==='name-collision'` case; routes back to `phase='storage'` whose only action re-runs the same collision. No "adopt your own file" path. Root cluster also touches: connectStorage.ts:145, googleDriveProvider.ts:372, syncStore.ts:1228/1229/1309/2332, ResumePodSetup.vue:355/389/391.
2. **Non-gesture popup on resume probe** — `src/stores/syncStore.ts:2232` — `attemptResumeFromRegistry` runs from `onMounted` (no gesture); lapsed token → `requestAccessToken()` opens popup → iOS blocks it → "Try again" re-triggers blocked popup. Resume _read_ path lacks the `shouldUseRedirectAuth` guard the connect path has.
3. **Granular-consent denial routes silently to recovery** — `src/services/google/googleAuth.ts:1768` — throw caught in App.vue boot (≈764, try/catch ≈780), console.warn + Slack only, routes to `?resume=setup` with no formError carried → user retries blindly. Also googleAuth.ts:840/842, CreatePodView.vue:333, ResumePodSetup.vue:312.
4. **Registry-error retry loop** — `src/components/login/ResumePodSetup.vue:161` (also syncStore.ts:2348) — persistent registry-error (15s cold-start/outage) → "Try again" loops; only escape is destructive "start a new pod".
5. **Second orphan `.beanpod` on transient list failure** — `src/services/sync/connectStorage.ts:145` — `createNew` swallows `listBeanpodFiles` failure → falls through to create → second empty `.beanpod`.

### 🔴 iOS data-loss & join failures

6. **Safari "Load failed" skips offline queue** — `src/services/sync/providers/googleDriveProvider.ts:177` — network branch matches `'fetch'`; WebKit throws `TypeError: Load failed` (no "fetch") → save not enqueued → edit lost. `withRetry` at :63 uses `/fetch|network/i`; this catch doesn't.
7. **iOS join recovery matches localized substrings** — `src/composables/useJoinFlow.ts:433` — branches on `'File not found'`/`'404'`/`'403'` vs raw localized message, not HTTP status; misses → never offers Picker → join dead-ends. Status available via `DriveApiError` (syncStore.ts:2280) but discarded.

### 🟠 Auth correctness & security

8. **Trusted-device sign-out skips grant revoke** _(security)_ — `src/services/google/googleAuth.ts:1323` — `preserveRefreshToken` made network revoke conditional → live grant remains at Google after sign-out. From `1e8090f7`.
9. **Token from global session not bound account** — `src/services/sync/providers/googleDriveProvider.ts:191` (also :124) — account drift → B's token reads A's file → spurious 404/403 reconnect loop.
10. **Null-deref in silent refresh on concurrent sign-out** — `src/services/google/googleAuth.ts:1058` — `currentRefreshToken!.token` can throw mid-backoff; miscounts toward false reconnect-banner escalation.
11. **Read-only provider triggers flush write** — `src/services/sync/providers/googleDriveProvider.ts:402` — `fromExisting()` calls `setFlushProvider()` → resume _read_ can flush stale queued bytes into the inspected file.

### 🟡 Observability & i18n

12. **Google API script missing `crossorigin`** — `src/services/google/drivePicker.ts:22` — `apis.google.com/js/api.js` injected without `crossOrigin='anonymous'` → throws redacted to "Script error." (prod #4). Google serves `ACAO:*`; adding it surfaces real message+stack on iOS.
13. **Raw untranslated error + internal fileId shown** — `src/components/login/ResumePodSetup.vue:406` — non-English users see English; everyone sees internal `fileId`. CreatePodView uses `t('createPod.duplicateFile')`; recovery doesn't.

### Quality / DRY

14. **Decrypt/biometric handoff copy-pasted 6×** — `src/components/login/LoadPodView.vue:184` (autoLoadFile ×2 184/202, handleGrantPermission 233, handleLoadFile 278, handleDrop 444, handleDriveFileSelected 701) — extract one `handlePendingPassword(fileName)`.

## REFUTED (checked, not real)

- App.vue:845 route.name unresolved → re-fires zombie alert (refuted ×2 — boot guard sound).
- CreatePodView.vue:469 birthday `parseInt` NaN.
- driveTokenRecovery.ts:280 step-1 no account-match (guarded elsewhere).
- offlineQueue.ts:68/111 cross-file flush / dangling provider.
- googleAuth.ts:1490 `login_hint` CRLF injection; :528 wake-refresh expiresAt=0; :934 English-substring classification.
- oauthProxy.ts:93 exchange/refresh duplication; ResumePodSetup.vue:266 finally-block dup; resumePaths predicate overlap; SaveFailureBanner.vue:29 `.replace` vs fillTemplate.

## Design steer for the plan

Findings 1–5 are facets of one root cause: **onboarding has no idempotent recovery when its own prior attempt left Drive state behind.** Centerpiece fix = an **adopt-existing path**: when the authenticating account meets a same-name `.beanpod` it owns, load/adopt it instead of dead-ending (dissolves 1, 4, 5). Safety constraints to design: wrong-account adoption, never overwrite a real family's file, confirm-before-adopt semantics. 2/3/6/7 = iOS transport correctness; 8–11 = auth layer; 12–14 = standalone high-value.
