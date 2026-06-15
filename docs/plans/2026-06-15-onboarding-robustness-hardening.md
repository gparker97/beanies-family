# Plan: Onboarding robustness hardening (15 review findings)

> Date: 2026-06-15 · Direct implementation, no GitHub issue · Final file: `docs/plans/2026-06-15-onboarding-robustness-hardening.md`

## Context

A max-effort multi-agent `/code-review` of the just-shipped onboarding remount-race fix (`4d2e6bc0`) plus the **whole onboarding flow** surfaced 15 findings. The remount fix is sound; these are **pre-existing onboarding-robustness gaps** (data integrity + cross-platform) plus minor polish on the new code. greg asked to fix all 15 "in a clean and definitive manner ... without introducing additional bugs or side effects."

**Shared root cause — the `podCreated` invariant.** `authStore.podCreated` should mean "this session has a real `.beanpod`." Today it's a localStorage flag (`beanies_pod_created`) only set `false` by `signUp` (authStore.ts:527) and `true` by `markPodCreated()` (authStore.ts:254) — called from `createNewFile` (syncStore.ts:1252) and `completeAutoLoad` (2373) but **NOT** the join/invite decrypt (`decryptPendingFileWithKey`) or routine `loadFromFile`/`loadFromPersistenceCache` termini. So it drifts (join leaves it stale; iOS ITP evicts the key independently of the actual pod). `needsPodSetup = !needsAuth && !podCreated` then mis-routes. **Definitive fix: establish `podCreated` at every point a pod is actually loaded/created.**

## Requirements

**Group A — Data integrity (HIGH):**

1. `signUp` idempotent — re-entering create step 1 (in-wizard Back, browser-back, WelcomeGate→Create again) must NOT mint a second family / orphan the first / dup the Slack ping / re-submit newsletter.
2. `ResumePodSetup` must NOT destructively re-create over a real pod when a registry `fileId` is known: `load-failed`/`registry-error` get a non-destructive "Try again"; `createNewFile` hard-refuses when a known `fileId` exists (covers the name-mismatch + local-fallback gaps the Drive-only name-collision guard misses).
3. Every pod load/create success terminus establishes `podCreated = true` (join, invite-decrypt, file-load, auto-load) so a joinee is never mis-routed to create recovery and `app.onboardingZombieState` doesn't false-fire.

**Group B — Cross-platform (MEDIUM; the headline ask):** 4. Local-file option capability-gated (hidden where File System Access is unavailable); fallback copy points iOS users to Drive (never names desktop-only browsers). 5. Session restore must not depend on the IndexedDB registry surviving when the session lives in localStorage (iOS ITP evicts independently). 6. iOS Safari Private Browsing (IndexedDB blocked) → clear specific message during signup, not a generic failure. 7. Redirect-auth callback must not silently discard the OAuth code when `sessionStorage` is unavailable/lost (iOS private tabs). 8. Create-wizard primary CTAs reachable when the mobile keyboard is up. 9. No sub-16px native form control in onboarding (avoid iOS focus auto-zoom).

**Group C — Polish + a11y (LOW; some on the new code):** 10. Zombie-alert suppression keys on "podless-expected here", not `meta.noChrome` (which also covers NotFound/PlausibleExclude). 11. `LoginPage.replaceOrSurface` handles the `router.replace` _throw_ case without stranding the user. 12. No onboarding text below the 12px (`text-xs`) floor. 13. `RESUME_SETUP_PATH` lives in lightweight `resumePaths.ts`, not heavy `connectStorage.ts`. 14. App.vue boot doesn't evaluate `isPodlessRecoveryQuery` twice. 15. The numeric-`type` NavigationFailure check duplicated in `safeRouterReplace` + `replaceOrSurface` becomes a shared pure predicate.

## Important Notes & Caveats

- **None introduced by `4d2e6bc0`** except #10/#11/#13/#14/#15 (polish on it). #1–#9 are pre-existing.
- **Idempotent signUp (verified):** the `🫘 New family pod started` Slack ping AND the Substack newsletter both live in `handleStep1Next` (CreatePodView.vue:152–188), AFTER `signUp`, gated on `result.success`. The new top guard `if (authStore.currentUser) { currentStep.value = 2; formError.value = null; return; }` returns BEFORE the signUp call + ping/newsletter, so re-entry duplicates neither. `signUp` has exactly one caller (CreatePodView.vue:144). The legitimate first-time call has `currentUser === null` (signOut nulls it, authStore.ts:936) → guard skipped, `freshSignIn` set normally. The defensive `signUp` early-return does NOT re-set `freshSignIn` (correct — re-navigation isn't a fresh sign-in). Accepted caveat: editing the family name on Back after creation advances with the original family (renaming mid-create is out of scope; documented, not a regression).
- **A3 chokepoint (verified).** No single `isConfigured=true` chokepoint covers all loaders (`loadFromFile:676` doesn't set it; `loadFromPersistenceCache:973` skips it on `preservePermissionState` though a pod was read). The faithful invariant is each loader's **function-return success terminus**: `loadFromFile:676`, `decryptPendingFileWithKey:1427`, and the single end `return {success:true}` of `loadFromPersistenceCache:981` (both permission branches → one call). `createNewFile:1252`/`completeAutoLoad:2373` already mark. No destructive double-fire: `completeAutoLoad`→`decryptPendingFile` (password path) is DISTINCT from `decryptPendingFileWithKey` (cached-key path) — separate paths, and `markPodCreated` is idempotent anyway. `useAuthStore()` is already called inside syncStore (1252/2373) — no circular-init. **Future-loader-forgets mitigation:** a contract doc-comment above `markPodCreated` enumerating the 5 termini + one invariant test (`syncStore.podCreatedTermini.test.ts`). No wrapper abstraction (premature).
- **A2 reason union (verified).** `CreatePodFailureReason` = `precondition|write|verify|persist|register|concurrent-write` (sync.ts:31); CreatePodView maps each via an exhaustive `Record` (:406) → adding typed `'existing-pod'` is type-safe (omission = compile error), cleaner than overloading `'precondition'`.
- **A2 phase fit (verified).** ResumePodSetup is a flat `v-else-if`/`switch` machine (template :455–552). Today `load-failed` (~:148) AND `registry-error` (~:136) both fall through to `phase='identity'`→`storage`→`createNewFile` — confirming the destructive risk. `phase='retry'` is one flat block + one arm, no new nesting.
- **🔴 CRITICAL ordering (verified — the A2 correctness crux).** Inside `createNewFile` (syncStore.ts:1126–1264) the family is registered with its `fileId` at step `register` (line 1217), INSIDE the try, AFTER write/verify/persist and BEFORE `markPodCreated` (1252). Therefore: (1) **first-ever create is never blocked** — no registry entry exists until line 1217, so the A2 pre-write `lookupFamily` returns null; the guard MUST scope to `entry?.fileId` (not entry presence), which the plan specifies. (2) `lookupFamily` already returns null-on-error AND when `features.registry` is off (registryService.ts:23) → the A2 try/catch is **defence-in-depth, not load-bearing**; self-host is unaffected. (3) **Partial-register retry is intended recovery, not a regression:** `handleCreateFailure` does not delete the registry entry, and the only awaits after `register` are non-fatal cache + synchronous mark — so a single call cannot fail with a `fileId` already present. A "registered-but-create-failed" state is only reachable across a reload, where the pod file was already written + verified before register — so a later attempt SHOULD recover that real pod, which is exactly what the A2 refusal + the new `retry` phase (Try again → re-probe → auto-load) achieve.
- **B6 — no existing IDB-availability probe (verified).** `classifyFileError` is FS-Access-specific. Introduce ONE `isStorageBlockedError(e)` (`InvalidStateError`/`SecurityError`/`QuotaExceededError`) in `registryDatabase.ts`, reused by BOTH `signUp` registry writes.
- **B8 — no keyboard/visualViewport composable or sticky-footer pattern exists (verified).** Simplest robust fix: `scrollIntoView({block:'center'})` on input focus — not a premature composable.
- **C15/C10 home (verified).** No `src/utils/router.ts`. `appChrome.ts` already imports vue-router types + is shared by App.vue + LoginPage → put `isNavigationCancelled` (C15) AND `isPodlessExpectedRoute` (C10) there.
- **C10 — one concept, not two flags (verified).** `meta.noChrome` ("render the shell?") is on the 5 onboarding routes AND NotFound + PlausibleExclude. The alert needs "is no-pod normal here?" — true for onboarding, false for a podless 404. Use a derived `isPodlessExpectedRoute(route)` keyed on `route.name` (Welcome/Login/JoinFamily/CreateFamily/OpenFromDrive) — no 2nd persisted flag (avoids overlapping-boolean drift), no router change. Recovery `/welcome?resume=setup` resolves to name `Welcome` (router:64) → covered by the name list WITHOUT the query, so the current `isPodlessRecoveryQuery` disjunct in App.vue suppression (835–836) is redundant and dropped from suppression.
- **C11 scope (verified).** `replaceOrSurface` (LoginPage:142) is module-scope and references the module-level `activeView` ref (`'welcome'` valid, :39) — setting `activeView.value='welcome'` in its throw branch is in scope + type-valid.
- **B5 additive guard (verified).** `initializeAuth` (:283) has an early-returning `families.length > 0` branch (:294–304) and a bare no-family else path (:306–307). B5's new branch slots into the bare else BEFORE `isInitialized=true`, leaving the families branch byte-for-byte untouched.
- **Reuse:** `canUseLocalFiles()` (capabilities.ts:101) for #4; `BaseSelect.vue` for #9; `useConfirm` for the A2 destructive opt-in.
- **Cross-platform reasoning mandatory per fix.** Ship ungated (bug fixes). Do NOT deploy — greg deploys explicitly.
- **Sequencing:** four commits — A → B-core (B4/B6/B7/B8/B9) → B5 (isolated, blast-radius) → C.

## Assumptions

1. **(Verified)** Join decrypts the pod BEFORE `joinFamily` (`tryInviteTokenDecrypt`→`decryptPendingFileWithKey` useJoinFlow.ts:539; `joinFamily` :700) → mark at the decrypt terminus covers join; the `joinFamily` belt-and-braces call is DROPPED.
2. **(Verified)** `attemptResumeFromRegistry`→`auto-loadable`/`load-failed` means a registry `fileId` exists; `lookupFamily` is cheap + null-safe.
3. **(Verified)** `canUseLocalFiles()` false on all iOS WebKit + Firefox, true on Chromium desktop + native.
4. `BaseSelect` preserves the `parent`/`child` values + styling parity.
5. **(Verified)** `markPodCreated()` idempotent + cheap → safe at multiple termini.
6. **(Verified)** `loadFromPersistenceCache` reaches its single end `return {success:true}` (:981) on BOTH permission branches.

## Approach

### GROUP A — Data integrity

**A1 — Idempotent signUp.** `CreatePodView.handleStep1Next`: first statement (after `formError.value = null`) `if (authStore.currentUser) { currentStep.value = 2; formError.value = null; return; }` — above field-validation/signUp/ping/newsletter. `authStore.signUp`: first statement in `try` `if (currentUser.value) return { success: true };` (defensive; does not re-set `freshSignIn`).

**A2 — Non-destructive resume recovery.**

- `types/sync.ts`: add `'existing-pod'` to `CreatePodFailureReason`.
- `syncStore.createNewFile`: before `criticalWriteState = {kind:'creating'}`, `const entry = await registry.lookupFamily(familyId)` in try/catch; if `entry?.fileId`, return `{ ok:false, reason:'existing-pod', error }` (any provider). On lookup throw (already null-on-error): log + `reportError` (warning) + PROCEED. Comment: guard scopes to `fileId` so first-create is never blocked; partial-register retry landing here is the intended recovery funnel.
- `CreatePodView` reasonKey (:406): add `'existing-pod': 'createPod.failedReasonExistingPod'`.
- `ResumePodSetup`: `load-failed`/`registry-error` → flat `phase='retry'` (Try again re-invokes `attemptResumeFromRegistry`; secondary "start a new pod instead" via `useConfirm`). `no-registry-entry` keeps `phase='identity'`. `existing-pod` → "couldn't safely create — Try again / contact support".
- _Cross-platform:_ `load-failed` most common on iOS (ITP evicts the provider-config row); retry works on redirect + popup.

**A3 — `podCreated` tracks real pod-load.** Add `useAuthStore().markPodCreated()` at `decryptPendingFileWithKey:1427`, `loadFromFile:676` (decrypt-with-current-FK success only), `loadFromPersistenceCache:981` (single end return). Add the contract doc-comment + `syncStore.podCreatedTermini.test.ts`.

### GROUP B-core — Cross-platform

**B4 — Gate local-file + copy.** `CreatePodView` + `ResumePodSetup`: wrap the local-file control in `v-if="canUseLocalFiles()"`; keep the self-host "Drive-unavailable→local-only" branch but show the reworded message, not a dead button. Reword `setup.localFileUnsupported` so iOS isn't told to use Chrome/Edge (point to Drive; Chrome/Edge "on a computer" only). en+beanie, `npm run translate`.

**B6 — iOS private-mode signup error.** New `isStorageBlockedError(e)` in `registryDatabase.ts`. `signUp`: wrap both registry writes; storage-blocked throw → `{success:false, error:t('auth.storageBlocked')}` + `reportError` (warning). New `auth.storageBlocked`.

**B7 — Don't drop the OAuth code.** `OAuthCallbackPage` (~:32–49): wrap the `sessionStorage` read in try/catch; `code` present but state missing/throws → route to `/welcome?authError=storage` + `reportError` (warning), not silent `window.location.href='/'`.

**B8 — Keyboard-aware CTAs.** `CreatePodView`: on focus of step-1/step-3 inputs, `el.scrollIntoView({block:'center', behavior:'smooth'})`. Rem-based, no new composable.

**B9 — BaseSelect for owner role.** `CreatePodView`: replace the raw `<select v-model="ownerRole">` with `<BaseSelect>` (parent/child). ≥16px → no iOS auto-zoom.

### GROUP B5 (isolated commit) — Decouple session restore from registry count

`authStore.initializeAuth`: in the bare no-family path (:306–307), before `isInitialized=true`, attempt `restoreSession()`; if a session exists with an empty registry, restore it (defer authoritative `podCreated` to the A3 load) and route to recovery rather than WelcomeGate-as-new. `hasFamilies` = OR(registry families, restored session). Log + `reportError` on unexpected restore failures.

- **Additive + guarded:** the `families.length>0` branch is byte-for-byte untouched; the new branch activates only when `restoreSession()` returns a user AND the registry is empty; any throw falls through to today's WelcomeGate (never throws out of boot) + telemetry.
- **Own commit (3rd of 4)**, 4-case coverage: (i) families+session unchanged; (ii) no session → WelcomeGate; (iii) session+empty-registry → restore+recovery; (iv) `restoreSession` throws → safe fall-through + telemetry. Not flagged (revert-one-commit rollback).

### GROUP C — Polish + a11y

**C10 — Podless-expected (derived predicate).** `appChrome.ts`: `isPodlessExpectedRoute(route)` true for the named onboarding routes, false otherwise (incl. NotFound/PlausibleExclude). App.vue suppression (835–837) switches `expectedPodless` to `isPodlessExpectedRoute(route)`; the redundant `isPodlessRecoveryQuery` disjunct is dropped there.

**C11 — throw case.** `LoginPage`: catch reports + finally clears spinner. For the throw case (URL unchanged → watchEffect can't rescue), after reporting set `activeView.value = 'welcome'`. Use C15's predicate for the cancelled (non-throw) case.

**C12 — Typography floor.** Raise to ≥`text-xs`: `LoginBackground:57` (8px), `CreatePodView:914`/`:942` (10px), `WelcomeGate:104` (10px), `WelcomeGate:158` (~11px). (`WelcomeGate:120` = 12px, leave.)

**C13 — Move `RESUME_SETUP_PATH`.** Define in `resumePaths.ts` as `` `/welcome?resume=${RESUME_SETUP}` `` (+ fix doc-comments :9/:26); `connectStorage.ts` re-exports (current source :28); App.vue/LoginPage import the light source; drop the connectStorage test-mock for it.

**C14 — Single eval.** App.vue boot: `const onRecoveryQuery = isPodlessRecoveryQuery(route.query.resume)` once, feeding only the redirect-target guard (:851) after C10.

**C15 — Shared predicate.** `isNavigationCancelled(result): result is {type:number}` in `appChrome.ts`; both `safeRouterReplace` (App.vue:309) and `replaceOrSurface` (LoginPage:142) use it.

## Files Affected

- `src/stores/authStore.ts` — A1, B5, B6, A3 (doc-comment).
- `src/components/login/CreatePodView.vue` — A1, A2 (reasonKey), B4, B8, B9, C12.
- `src/components/login/ResumePodSetup.vue` — A2 (retry+confirm), B4.
- `src/stores/syncStore.ts` — A2 (existing-pod refusal), A3 (markPodCreated termini).
- `src/types/sync.ts` — A2.
- `src/services/indexeddb/registryDatabase.ts` — B6.
- `src/components/login/resumePaths.ts` / `src/services/sync/connectStorage.ts` — C13.
- `src/pages/OAuthCallbackPage.vue` — B7.
- `src/pages/LoginPage.vue` — C11, C13, C15.
- `src/App.vue` — C10, C14, C13, C15.
- `src/utils/appChrome.ts` — C10, C15.
- `src/components/login/WelcomeGate.vue` (incl. :158), `LoginBackground.vue` — C12.
- `src/services/translation/uiStrings.ts` — B4/B6/B7/A2 (+ `npm run translate`).
- (`src/router/index.ts` — no change for C10; names verified.)
- Tests (below).

## Acceptance Criteria

- [ ] A1: Back→step1→resubmit (and WelcomeGate→Create again) → exactly one family/mapping/ping/newsletter; guard returns before signUp + Slack/newsletter.
- [ ] A2: known `fileId` → `createNewFile` refuses (`existing-pod`) for Drive-mismatch AND local-file; first-create (no entry) + self-host (registry off) proceed; lookup throw proceeds (logged); ResumePodSetup `load-failed`/`registry-error` → non-destructive Try again; start-new requires confirm; retry is a flat `v-else-if`; partial-register retry funnels to recovery (intended).
- [ ] A3: joinee (incl. stale `='0'`) lands in-app, not create recovery; no false zombie alert; `podCreated` true after any successful load/decrypt/cache-hit; invariant test asserts each loader marks; no destructive double-fire.
- [ ] B4: local option absent on iOS WebKit + Firefox, present on Chromium desktop + native; copy never tells iOS to use Chrome/Edge.
- [ ] B5: localStorage session + evicted IDB restores; common non-evicted path unchanged; `restoreSession` throw → safe fall-through + telemetry (own commit, 4-case).
- [ ] B6: iOS Private signup → `auth.storageBlocked` + telemetry, both writes.
- [ ] B7: missing/throwing sessionStorage + code → `/welcome?authError=storage` + telemetry, not silent `/`.
- [ ] B8: 320–360px + keyboard up → step-1/step-3 CTAs reachable.
- [ ] B9: owner-role is `BaseSelect` (≥16px).
- [ ] C10: `isPodlessExpectedRoute` from route name (no new meta); onboarding true, NotFound/PlausibleExclude false; recovery (`Welcome`) covered; podless 404 still alerts.
- [ ] C11–C15 applied; `isNavigationCancelled` single predicate; throw → `activeView='welcome'`.
- [ ] C12: no sub-12px text (incl. WelcomeGate:158).
- [ ] `npm run validate` green; no new arbitrary-px / sub-12px text.

## Testing Plan

1. **Unit authStore:** signUp idempotency (currentUser set → early success, no 2nd family, freshSignIn untouched); storage-blocked classification, both writes.
2. **Unit initializeAuth (B5):** 4 cases (families+session unchanged / no session→WelcomeGate / session+empty-registry→restore / throw→safe fall-through+telemetry).
3. **Unit registryDatabase:** `isStorageBlockedError` true for the 3 names, false otherwise.
4. **Unit syncStore:** createNewFile refuses on known `fileId` (both providers); first-create (no entry) proceeds; registry-off proceeds; thrown lookup logs+proceeds.
5. **Unit syncStore.podCreatedTermini (A3):** decrypt / loadFromFile / loadFromPersistenceCache (both branches) each mark on success.
6. **Component capability gating:** `canUseLocalFiles()` matrix drives local-option visibility.
7. **Component ResumePodSetup:** load-failed/registry-error→retry (no createNewFile); Try again re-probes; start-new requires confirm; no-registry-entry→identity.
8. **Component CreatePodView:** Back→resubmit advances without 2nd signUp/ping/newsletter; BaseSelect renders roles; existing-pod message renders.
9. **Component OAuthCallback:** missing/throwing sessionStorage + code → `/welcome?authError=storage` + reportError.
10. **Unit appChrome:** `isNavigationCancelled`; `isPodlessExpectedRoute` (onboarding true, NotFound false); both call sites use each.
11. **Manual cross-platform matrix:** create+join+recovery on iPhone Safari tab / installed PWA / Safari Private / Android Chrome / desktop Chrome / desktop Safari. Then `npm run validate`.
12. **E2E (within 25-budget):** extend a create-pod E2E for no-duplicate-on-back; else skip per three-gate filter. Log E2E_HEALTH.md if changed.

## Review Passes

- **Pass 1 (Initial draft)**: Grouped the 15 findings into Data-integrity / Cross-platform / Polish on the shared `podCreated`-invariant + nav-failure-predicate roots, per-fix cross-platform reasoning, reuse of `canUseLocalFiles`/`BaseSelect`, unit/component/manual/E2E tests.
- **Pass 2 (DRY + error handling)**: Shared `isStorageBlockedError` (B6) + `isNavigationCancelled`/`isPodlessExpectedRoute` into existing `appChrome.ts`; typed `existing-pod` reason; A2 lookup fail-open with telemetry; B7 sessionStorage read wrapped; dropped redundant `joinFamily` mark; B8 single `scrollIntoView`; every new branch logs + reportError.
- **Pass 3 (Sustainability)**: Confirmed A3's 3 termini are minimal (no single `isConfigured` chokepoint) + contract doc-comment & invariant test; split B5 into its own guarded commit (4 commits) with 4-case coverage; A2 retry phase fits the flat switch; replaced the 2nd-meta-flag idea with a route-name-derived `isPodlessExpectedRoute`.
- **Pass 4 (Fresh-eyes sweep)**: Validated all 7 checks vs the code. Documented createNewFile's register-before-mark ordering (guard scopes to `entry?.fileId`; partial-register retry is intended recovery, NOT a regression); noted `lookupFamily` is already null-on-error (A2 try/catch is defence-in-depth); dropped the redundant recovery-query disjunct from C10 suppression (recovery = name `Welcome`); added WelcomeGate:158 (~11px) to C12; confirmed signUp has one caller + no `freshSignIn` regression + `activeView`/B5-guard scope.

## Prompt Log

<details><summary>Full prompt history</summary>

### Initial (after the max-effort /code-review)

greg: "first commit the fix and then run /beanies-plan and plan to fix all of the above identified issues in a clean and definitive manner so they are fully resolved and do not introduce any additional bugs or unintended side effects."

### Source — the 15 findings

Review findings #1–#15: signUp idempotency; ResumePodSetup destructive fallback; join markPodCreated; iOS local-file gating + copy; iOS ITP session-restore asymmetry; iOS private-mode signup error; OAuth sessionStorage dependency; mobile keyboard CTAs; raw select auto-zoom; expectedPodless over-suppression; replaceOrSurface throw case; sub-12px fonts; RESUME_SETUP_PATH home; double isPodlessRecoveryQuery eval; shared NavigationFailure predicate.

</details>
