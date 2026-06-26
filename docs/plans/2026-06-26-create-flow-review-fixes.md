# Plan: Unified create-a-family flow — code-review remediation

> Date: 2026-06-26
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-06-26-create-flow-review-fixes.md`

> **No GitHub issue created.** This plan was approved for direct implementation. Full prompt history is embedded under `## Prompt Log`.

## User Story

As the maintainer of beanies.family, I want every confirmed and plausible issue from the max-effort code review of the unified create-a-family flow fixed, so that CI stays green, no user-facing regressions ship, the new code is DRY and maintainable, and the iOS create path is defensively hardened against the very symptoms the rework set out to eliminate.

## Context

The unified create-a-family flow (commit `10736cb6`) moved the password entry and add-members step out of `CreatePodView`'s deleted 3-step wizard onto the shared `ResumePodSetup` finish surface, with `signUp` deferring the password via a `DEFERRED_PASSWORD_HASH` sentinel. A follow-up commit (`5919240f`) already fixed the two highest-impact issues a max-effort review found:

- **Finding 6** (`rehydrateOwnerDoc` did a full `initDoc()` doc-wipe + rebuild mid-create) → now updates the owner's hash **in place** on desktop.
- **Finding 9** (the `/nook` onboarding wizard not appearing until navigation) → `handleSetupComplete` now refreshes `settingsStore.loadSettings()` before routing.

This plan covers the **13 remaining findings**. One is CI-breaking, several are user-facing regressions introduced by the rework, several are DRY/quality cleanups (some pre-existing, surfaced by the new file), two are iOS-defensive items reasoned from code (greg cannot test on a device right now), and one is a design-level "evaluate and recommend."

**Pre-existing vs introduced (so we fix the right scope):**

- _Introduced by this rework_: 1 (E2E helpers), 2 (per-reason error copy), 3 (subtitle), 4 (owner-role prop), 12 (`isConfigured` guard), 13 (`deleteMember` silent failure), 14 (test mock), 15 (sentinel design).
- _Pre-existing, but this is the right moment to fix_: 5 (member-color palette — `CreateMembersStep` had the same array), 7 (month/day option triplication), 8 (double `setupAutoSync`/`ensureRegistered`).
- _Latent/plausible, hardening_: 10, 11 (iOS).

## Requirements

Grouped into workstreams. Each fix is independently shippable; group commits by workstream.

### WS-A — Restore E2E (CI-BREAKING, do first)

1. `e2e/helpers/auth.ts` `navigateToSetupStep3` + `bypassLoginIfNeeded` must drive the **new** flow. Today (verified `e2e/helpers/auth.ts:25-44, 77-104`) they fill `Family Name`/`Your Name`/`Email`/`Password`/`Confirm password` at "step 1" (the `Password`/`Confirm password` fields are GONE — password is now collected on `ResumePodSetup`), then call `__e2eCreatePod.setStep(3)`. But `CreatePodView` now exposes only `__e2eCreatePod.setStep` which **just sets `currentStep`** (`CreatePodView.vue:77-83`), `totalSteps === 2` (`:72`), and pod creation no longer happens in this component at all — so `setStep(3)` renders nothing and the `loginV6.finish` button (now inside `CreateMembersStep` on the finish surface) never appears. Every authenticated spec that calls these (`setup-flow`, `trusted-device`, `planner`, `invite-join`, `cross-entity`, `financial-data`, `google-drive`) currently cannot reach `/nook`.
2. Because pod creation moved OFF `CreatePodView` (the OS file picker / Drive OAuth still can't be automated headless), the test must now drive the whole create on the `ResumePodSetup` surface, which needs a headless-installable storage provider injected by a DEV-gated dev hook (see Approach WS-A — the hook installs ONLY the provider; the real UI does the rest). **Verified gap:** there is NO headless-installable provider today. `__e2eSeedDoc` (`App.vue:592-597`) only loads a binary into `docService` — it does NOT install a `StorageProvider`. The real providers (`src/services/sync/providers/`) all need a real file handle / OAuth token, and `createNewFile` hard-fails with reason `write` if no provider is configured (`syncStore.ts:1246-1247`). So WS-A must add a minimal in-memory dev/E2E `StorageProvider` (see Approach WS-A).
3. `npm run validate` does not run Playwright, so this regression is invisible locally. The plan must note a manual `npx playwright test` (Chromium) gate as part of acceptance.

### WS-B — User-facing regressions (introduced by the rework)

4. **Per-reason create-error copy (finding 2):** `ResumePodSetup.finalizePod` (`ResumePodSetup.vue:406-460`) must map every `createNewFile` failure reason to its specific `createPod.failedReason*` message. Today only `existing-pod` is special-cased (`:426-442`); everything else collapses to generic `setup.fileCreateFailed` (`:443`). The `createPod.failedReason*` keys (`uiStrings.ts:2917-2948`) are currently orphaned. The reason union is `CreatePodFailureReason = 'precondition' | 'write' | 'verify' | 'persist' | 'register' | 'concurrent-write' | 'existing-pod'` (`src/types/sync.ts:36-43`).
5. **Recovery subtitle (finding 3):** `resumeSetup.subtitle` was reworded to create-oriented copy ("One last step: set your password to finish") but renders for ALL phases, including the genuine recovery/`auto-load` phase where a RETURNING user must re-enter an EXISTING password. Make the heading/subtitle **phase-aware**: create (`identity`) → "set your password to finish"; recovery (`auto-load`) → re-entry wording.
6. **Owner-role on the members step (finding 4):** `CreateMembersStep` is rendered at `ResumePodSetup.vue:817` **without `:owner-role`**, so its `ownerRole` prop (default `'parent'`, `CreateMembersStep.vue:30-32`) always shows the owner as adult "Parent bean" even if they picked "Little bean" (child). Resolve by deriving the owner display from the owner member itself — `buildOwnerDoc` stores the owner as `ageGroup: 'adult'` regardless, so the `ownerRole` prop was already cosmetic-only and dangling (never wired by the host).
7. **Lost `isConfigured` guard (finding 12):** the old `CreatePodView.handleStep2Next` had a critical guard — `storageSaved===true` but `syncStore.isConfigured===false` ⇒ refuse + critical `reportError`. The current `handleStorageConnected` (`CreatePodView.vue:363-383`) only checks `storageSaved` (`:365`) and `authStore.currentUser` (`:369`); it does NOT check `isConfigured`. Restore an equivalent "provider actually wired" precondition + critical `reportError` before emitting `finish-storage`.
8. **`deleteMember` silent failure (finding 13):** `CreateMembersStep.handleRemoveMember` (`:129-134`) `await`s `familyStore.deleteMember` but ignores its `Promise<boolean>` result (`familyStore.ts:265-277` returns `false` on failure) and removes the row unconditionally. This is the exact silent-failure class we closed for `createMember` (`CreateMembersStep.vue:115-125`). On `false`: keep the row, show an error, `reportError` (surface `createMembers.removeMember`, severity `warning`).

### WS-C — DRY extractions (pre-existing, fix now)

9. **Shared member-color palette (finding 5):** verified arrays —
   - `FamilyMemberModal.MEMBER_COLORS` (`:42-49`) is `{ value, gradient }[]` with values `#3b82f6, #ef4444, #22c55e, #f59e0b, #8b5cf6, #ec4899`.
   - `CreateMembersStep.memberColors` (`:145`) is a bare `string[]`: `#ef4444, #10b981, #8b5cf6, #f59e0b, #ec4899, #06b6d4`.
   - 4 of 6 overlap; the **divergent** colors are `#10b981`/`#06b6d4` (only in `CreateMembersStep`) and `#3b82f6`/`#22c55e` (only in `FamilyMemberModal`). A member auto-assigned `#10b981`/`#06b6d4` during onboarding renders as "nothing selected" when later opened in `FamilyMemberModal`'s `ColorCircleSelector` (`:378`), and one tap silently overwrites the member's color.
     Extract ONE shared source of truth and consume it in both. `getNextColor` (`CreateMembersStep.vue:147-150`) needs only the value strings; `ColorCircleSelector` needs `{value, gradient}[]`.
10. **Shared month/day option builders (finding 7):** `MONTH_KEYS`/`monthOptions`/`dayOptions` are copied verbatim into `CreateMembersStep` (`:49-74`) from `FamilyMemberModal` (`:65-90`) — both DOB pickers, both 31-day, both rendered via `BaseSelect`. A **third, semantically different** copy lives in `TransactionModal`: `monthOptions` (`:292-304`, a flat hardcoded 12-month list for **yearly-recurrence month-of-year**, rendered via native `<option>` at `:814`) and `dayOfMonthOptions` (`:285-289`, **length 28**, for day-of-month recurrence — NOT a birthday and NOT 31). So the truly-shared bit is the **12-month option list** (identical i18n `month.*` keys in all three); the day list is shared only as a parameterized generator (31 for DOB, 28 for recurrence). Extract a generic options builder (NOT DOB-named — see Notes) and consume it in all three; keep each site's own markup.

### WS-D — Redundancy cleanup (pre-existing)

11. **Double `setupAutoSync`/`ensureRegistered` (finding 8):** verified **three** call sites. `SetupProgressModal` runs them in its E2E fast-path `runRealWork` (`:129-130`) AND in finalize step 4 (`:188-189`); `LoginPage.handleSignedIn` runs them again (`:606-607`). The create finish path routes THROUGH `handleSignedIn` (`ResumePodSetup.vue:488` emits `signed-in '/nook'` → `LoginPage` `@signed-in="handleSignedIn"`), so every create currently fires `ensureRegistered` (a registry **network write**, `syncStore.ts:2770-2772 → registerCurrentFamily`) twice. `setupAutoSync` is already idempotent (`syncStore.ts:2021-2022` early-returns if armed). Remove the redundancy **without** breaking the load/join/reconnect paths that also route through `handleSignedIn`.

### WS-E — iOS-defensive hardening (plausible; reasoned from code, not device-verified)

12. **Token-invalid re-redirect → second password (finding 10):** in `ResumePodSetup.handleIdentityNext` (`:355-403`), after a successful `rehydrateOwnerDoc`, the branch is `getProvider()` → finalize (`:378`); else `isTokenValid()` → `finishOnDrive` (`:381`); else `phase='storage'` (`:387`). On iOS, when the Drive token isn't live (`getProvider()` null + `isTokenValid()` false), tapping Connect fires a SECOND full-page redirect that reloads and forces a SECOND password entry. Add a defensive silent-recovery attempt before falling to `phase='storage'`, and never lose the entered password.
13. **Members phase skippable via `/welcome` re-entry (finding 11):** `createNewFile` sets `podCreated=true` and resets `criticalWriteState` to `idle` (`syncStore.ts:1343`) before the `members` phase renders. The ALREADY_AUTH guard (`router/index.ts:336-348`) redirects `/welcome → /nook` once `needsPodSetup` is false. No nav to `/welcome` was found during `members`, so it's conditional, but any re-entry would skip add-members. The first router guard already short-circuits while `criticalWriteState.kind !== 'idle'` (`router/index.ts:329-334`) — reuse that mechanism (see Approach WS-E).

### WS-F — Test hygiene

14. **`resetAllMocks` (finding 14):** `CreateMembersStep.test.ts` `beforeEach` uses `vi.clearAllMocks()` while a test queues `mockResolvedValueOnce(null)`. Per the documented project lesson ([[feedback_vitest_resetallmocks]]), switch to `vi.resetAllMocks()` and re-establish any always-on mock return values in `beforeEach`.

### WS-G — Design evaluation (recommend, then decide)

15. **`DEFERRED_PASSWORD_HASH` sentinel (finding 15):** the empty-string sentinel overloads `passwordHash` and forces three lockstep special-cases (deferred `signUp`, fail-closed `createNewFile` at `syncStore.ts:1180-1189`, the `rehydrateOwnerDoc` non-early-return) plus an `applyDefaults` contradiction (owner reads `requiresPassword:true` mid-flow). The reviewer's deeper fix: **don't create the owner member until the password is known** — pre-generate `memberId` in `signUp`, create the owner via `createMemberWithId` (`familyStore.ts:238`) on the finish surface. This plan **evaluates** that vs. keeping the current working-and-tested sentinel and makes a recommendation; it does not pre-commit to the refactor (see Approach WS-G).

## Important Notes & Caveats

- **Order matters: WS-A first.** CI is red until the E2E helpers + dev provider are fixed; do that workstream first and verify with a real Playwright run before the others.
- **Don't regress the wizard fix (`5919240f`).** WS-E/WS-G touch `rehydrateOwnerDoc` / `markPodCreated` ordering — preserve the in-place update + `loadSettings()` refresh.
- **`handleSignedIn` is shared.** WS-D must not strip `setupAutoSync`/`ensureRegistered` from the load/join/reconnect paths — only de-duplicate the create path. **Verified safe direction:** remove from BOTH `SetupProgressModal` sites and keep the single canonical call in `handleSignedIn`, because (a) the create path provably reaches `handleSignedIn` via the `signed-in '/nook'` emit, and (b) `SetupProgressModal` is only used by the create flow (imported solely by `ResumePodSetup.vue`).
- **Shape reconciliation for colors (WS-C).** `MEMBER_COLORS` is `{value, gradient}[]`. The shared constant exposes the canonical `MEMBER_COLORS` AND a derived `MEMBER_COLOR_VALUES: string[] = MEMBER_COLORS.map(c => c.value)`, so neither consumer re-declares colors. `FamilyMemberModal`'s random-default fallback (`:180`) and `CreateMembersStep.getNextColor` both consume `MEMBER_COLOR_VALUES`.
- **Generic month/day options, NOT a DOB composable (WS-C).** Verified: one of the three consumers (`TransactionModal`) uses these for **recurrence scheduling** (month-of-year + day-of-month, 28 days), not a date of birth. Naming the composable `useDateOfBirthOptions` would be a semantic lie. Name it generically — `useCalendarSelectOptions(daysInMonth = 31)` returning `{ monthOptions, dayOptions }` — and call it with `28` in `TransactionModal`, default `31` in the two DOB sites. Share the **options builder only**; the three sites render differently (BaseSelect vs native `<option>`). A `<DateOfBirthFields>` component is out of scope.
- **WS-C abstractions stay at data altitude (confirmed not over-generalized).** Both new modules are thin data/builders, not framework: `memberColors.ts` is a constant plus a `.map` derivation (no logic, no consumer coupling); `useCalendarSelectOptions` returns two `computed` arrays and takes a single `daysInMonth` number — no options object, no DOB-vs-recurrence branching, no import back into either consumer. A future caller varies behaviour by passing a different `daysInMonth`, not by adding a flag. Do not grow either module into a `<MemberColorPicker>`/`<DateOfBirthFields>` component in this plan.
- **Workstream ordering — mostly independent, two real edges.** WS-A lands first (CI is red). WS-C's two shared modules are consumed by WS-B's finding-4/finding-13 edits and by WS-F's new tests, so land WS-C before (or in the same commit family as) those consumers, or a partial landing references a not-yet-created module. Everything else (WS-B, WS-D, WS-E, WS-G) is independently shippable in any order. Make these two edges explicit in the commit sequence.
- **i18n (WS-B finding 3 / 13).** Phase-aware copy needs a second subtitle key (keep `resumeSetup.subtitle` for create, add `resumeSetup.subtitleRecovery` for `auto-load`); finding 13 needs `loginV6.removeMemberFailed`. Add both `en` + `beanie`, then `npm run translate` + zh spot-check ([[reference_translate_mymemory_review]]).
- **iOS items are not device-verified.** WS-E fixes must be defensive and provably safe-by-reasoning; do not over-engineer. If a fix risks the desktop happy path, prefer the smaller guard.
- **`markPodCreated` is the data-safety point of no return.** For finding 11, deferring `markPodCreated` past the members step is risky (it gates "pod exists, safe to enter"); prefer extending the existing `criticalWriteState` machine the router already respects (see Approach WS-E).
- **No silent failures anywhere** (WS-B/WS-C/WS-D): every new branch surfaces a translated message + `reportError` with a focused surface; never a bare `catch {}`. The new in-memory E2E provider (WS-A) must throw typed errors on misuse, never swallow.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-06-26).

1. The wizard fix (`5919240f`) is on `main`: `rehydrateOwnerDoc` updates in place on desktop; `handleSetupComplete` calls `loadSettings()`.
2. The `createPod.failedReason*` keys (`uiStrings.ts:2917-2948`) still exist and are still correct copy — **verified**; only the call site (`finalizePod`) needs to reference them. The comment at `uiStrings.ts:2916` still points at the now-deleted `CreatePodView.handleStep2Next` — update it to point at `finalizePod`.
3. `FamilyMemberModal.MEMBER_COLORS` is the canonical palette; making `CreateMembersStep` match it is the desired direction (not the reverse). **Verified the two diverge only on `#10b981`/`#06b6d4` vs `#3b82f6`/`#22c55e`.**
4. ~~The E2E suite can install a deterministic test storage provider in dev~~ **CORRECTED:** no such provider exists today. `__e2eSeedDoc` (`App.vue:592`) only seeds a doc; `__e2eCreatePod.setStep` only flips the step counter. WS-A must add a minimal in-memory `StorageProvider` (implementing the provider interface) installed via `syncStore.installProvider`/`syncService.setProvider`. A real headless OS file-picker / Drive OAuth remains un-automatable.
5. On iOS, `tryReconnectSilently` (imported in `connectStorage.ts:21` from `@/services/google/driveTokenRecovery`, and used inside `beginDriveAuthRedirectIfNeeded` at `connectStorage.ts:72`) is the existing silent-recovery primitive available to WS-E finding 10.
6. `needsPodSetup` = `!needsAuth && !podCreated` (authStore) drives the ALREADY_AUTH redirect (`router/index.ts:340`) relevant to WS-E finding 11.

## Approach

### WS-A — E2E harness for the new flow

The blocker: the create no longer finishes inside `CreatePodView`; it finishes on `ResumePodSetup` after a real storage connect + password + members, and `createNewFile` requires a configured provider that cannot be installed headless today.

**Recommended: a single dev-only "complete create" hook backed by a minimal in-memory provider.**

1. Add a tiny dev/E2E in-memory provider implementing the `StorageProvider` interface — keep the bytes in a module-level `Uint8Array`, implement `read`/`write`/`getFileId`/`getDisplayName`/`persist` honestly, and **throw typed errors on genuine misuse** (never swallow). Gate construction behind `import.meta.env.DEV`. Put it next to the other providers (e.g. `src/services/sync/providers/memoryProvider.ts`) so it's discoverable but tree-shaken from prod.
2. Keep the dev hook as narrow as the un-automatable gap and NOTHING more. The ONLY thing E2E can't do headless is satisfy the OS file-picker / Drive-OAuth provider install, so expose a single DEV-gated `__e2eCreatePod.installMemoryProvider()` from `CreatePodView` (where the hook already lives, `:77-83`) that calls `syncStore.installProvider(memoryProvider, 'local')` (the same store entrypoint the real local/Drive paths use, `syncStore.ts:438`) and does nothing else. Do NOT reimplement the create. `signUp`, `rehydrateOwnerDoc`, `createNewFile`, the `members` advance, `SetupProgressModal`, and the `signed-in '/nook'` emit must ALL run through the real `ResumePodSetup` UI driven by Playwright. A `completeCreate` that re-runs signUp+rehydrate+createNewFile itself would fork a parallel create sequence — the exact ordering surface this whole plan is repairing — so E2E could pass green while prod's real `handleIdentityNext`/`finalizePod` ordering breaks. With the provider installed, `getProvider()` is non-null, so the real `handleIdentityNext` takes its `if (getProvider())` branch (`ResumePodSetup.vue:378`) and the harness exercises the production path end-to-end. Surface a provider-install failure as a thrown error so the Playwright step fails loudly, not silently.
3. Rewrite `e2e/helpers/auth.ts` to drive the REAL UI: drop the `Password`/`Confirm password` fills (fields gone), fill `Family Name`/`Your Name`/`Email`, call `installMemoryProvider()`, then fill the password on the `ResumePodSetup` finish surface and click Next (the real `handleIdentityNext`→`finalizePod`→`createNewFile` runs from here), optionally add a member, click `loginV6.finish` (inside `CreateMembersStep`), let `SetupProgressModal` complete, wait for `/nook`. Rename `navigateToSetupStep3` → `navigateToAddMembers`. Remove the now-false "Name & Password" / "step 3" comments. Update any spec referencing step-3 semantics.
4. Verify with a real Chromium `npx playwright test` run for the affected specs.

(Optional lighter path for specs that don't care about onboarding: extend the `__e2eSeedDoc` path to seed a pod-created session. Keep `google-drive`/`setup-flow` on the full real-UI create path for real coverage.)

### WS-B — Regressions

- **Finding 2:** in `finalizePod`'s non-`existing-pod` branch (`ResumePodSetup.vue:443`), replace the bare `t('setup.fileCreateFailed')` with a `reasonKey` lookup over the verified union:
  `write→createPod.failedReasonWrite`, `verify→...Verify`, `persist→...Persist`, `register→...Register`, `precondition→...Precondition`, `concurrent-write→createPod.failedReasonConcurrent` (note the key drops the `-write`). Keep the existing critical `reportError` (`:445-451`). Fall back to `setup.fileCreateFailed` for any unmapped reason (defensive). Inline the record in `finalizePod` (the old `CreatePodView.handleStep2Next` no longer exists — `CreatePodView` no longer creates pods, so no shared helper is warranted).
- **Finding 3:** add `resumeSetup.subtitleRecovery`; bind the subtitle to `phase === 'auto-load' ? t('resumeSetup.subtitleRecovery') : t('resumeSetup.subtitle')`. Audit the title — "Finish setting up your pod" reads fine for both, so likely subtitle-only.
- **Finding 4:** drop the `ownerRole` prop from `CreateMembersStep` (it is never passed — `ResumePodSetup.vue:817`). Replace the two `props.ownerRole === 'child'` branches (`:177`, `:193-195`) with the owner's own `ageGroup` via `getMemberAvatarVariant(familyStore.owner)` and the owner's `ageGroup` for the label. Since `buildOwnerDoc` stores the owner as adult, this is consistent and removes a dangling prop. (If greg wants the picked child-role to actually persist, that's a separate change to `buildOwnerDoc` — out of scope; note it.)
- **Finding 12:** in `handleStorageConnected` (`CreatePodView.vue:363`), after the `currentUser` check, add `if (!syncStore.isConfigured) { formError = t('setup.fileCreateFailed'); reportError({ surface: 'createPod.handOff', severity: 'critical', ... }); return; }` mirroring the old guard — reusing the existing `createPod.handOff` surface already used for the no-owner case (`:374-379`).
- **Finding 13:** `handleRemoveMember` (`:129`) checks the boolean: `const ok = await familyStore.deleteMember(memberId); if (!ok) { formError = t('loginV6.removeMemberFailed'); reportError({ surface: 'createMembers.removeMember', severity: 'warning', ... }); return; }` — keep the row, do NOT mutate `addedMembers`.

### WS-C — Shared constants/composables

- **Finding 5:** create `src/constants/memberColors.ts` exporting canonical `MEMBER_COLORS: { value: string; gradient: string }[]` (moved verbatim from `FamilyMemberModal.vue:42-49`) plus `MEMBER_COLOR_VALUES = MEMBER_COLORS.map(c => c.value)`. `FamilyMemberModal` imports `MEMBER_COLORS` (selector + random-default fallback at `:180`); `CreateMembersStep.getNextColor` cycles `MEMBER_COLOR_VALUES`. Delete both local arrays.
- **Finding 7:** create `src/composables/useCalendarSelectOptions.ts` (generic, NOT DOB-named) returning `{ monthOptions, dayOptions }`, with `dayOptions` length parameterized (`useCalendarSelectOptions(daysInMonth = 31)`). `monthOptions` is built from the shared `MONTH_KEYS` through `t()` for reactivity. Consume in `CreateMembersStep` (31), `FamilyMemberModal` (31), `TransactionModal` (28, for `dayOfMonthOptions`; and its `monthOptions`). Keep each site's own markup (BaseSelect vs native `<option>`). Delete the three local `monthOptions`/`MONTH_KEYS` copies and the two 31-day + one 28-day local day arrays.

### WS-D — De-dup finalize

**Decision (now firm, verified safe):** remove `setupAutoSync()` + `ensureRegistered()` from BOTH `SetupProgressModal` call sites — the E2E fast-path `runRealWork` (`:129-130`) and finalize step 4 (`:188-189`) — and keep the single canonical pair in `LoginPage.handleSignedIn` (`:606-607`). Rationale: the create finish provably reaches `handleSignedIn` (`ResumePodSetup.vue:488` → `LoginPage @signed-in`), `setupAutoSync` is already idempotent (`syncStore.ts:2021-2022`), `ensureRegistered` is a real registry network write, and `SetupProgressModal` is used only by the create flow. Step 4's visual "register" beat becomes a timer-only perceived step (the real register fires a tick later in `handleSignedIn`, still before `/nook` renders). Verify step 4's i18n copy (`setupProgress.step4.*`) is forward-looking (e.g. "Finishing up") and does NOT assert a completed action it no longer performs (e.g. a literal "Pod registered ✓"); a forward-looking beat stays truthful precisely because `ensureRegistered` runs a tick later in `handleSignedIn`, still before `/nook` renders. Keep step 4's existing try/catch shape if any residual work remains; otherwise the step is pure animation. Add a one-line comment at `handleSignedIn` noting it is the single canonical arm-and-register point for ALL entry paths (create/load/join/reconnect).

### WS-E — iOS hardening

- **Finding 10:** in `handleIdentityNext`, before the final `phase='storage'` (`ResumePodSetup.vue:387`), attempt `await tryReconnectSilently(expectedEmail)` (from `@/services/google/driveTokenRecovery`); if it returns true, re-check `isTokenValid()` and route to `finishOnDrive()` (`:385`) so a held refresh token finishes without a second redirect. Only fall to `phase='storage'` when silent recovery genuinely fails. Per ADR-026 no secret crosses the redirect, so the honest residual is: if a redirect is truly unavoidable, accept ONE documented password re-entry (not a regression vs. today) — but never double-redirect on a token we can silently recover. Wrap the recovery in try/catch and `reportError` (severity `warning`) on throw — never swallow.
- **Finding 11:** do NOT extend the block-first `CriticalWriteState` machine for this. That guard (`router/index.ts:329-334`) blocks ALL navigation while non-idle — right for a sub-second in-flight write, but the `members` phase is an open-ended, user-paced interactive screen. Parking `criticalWriteState` at a new `{ kind: 'members' }` for that whole window means any path that fails to return it to `idle` bricks ALL app navigation with no write in flight, and it forces a fragile lockstep claim/release in `SetupProgressModal` (its claim at `:150-152` and release at `:234-236` are two SEPARATE `kind === 'idle'` checks that would each need broadening to also accept `members` — broaden the claim, forget the release, and the app is stranded). The actual threat is narrow and not even reproduced: a conditional ALREADY_AUTH `/welcome → /nook` redirect (`router/index.ts:336-348`) skipping add-members. Fix it with a small dedicated flag owned in ONE place — `syncStore.membersStepActive` (default `false`) — checked ONLY inside the second (ALREADY_AUTH) guard to suppress that one redirect, never in the block-first guard. Set it `true` in exactly one place (`finalizePod` when advancing to `phase='members'`, `ResumePodSetup.vue:458`) and clear it `false` on the GENUINE exits only: `handleSetupComplete` (success → `/nook`) and an `onBeforeUnmount` safety net so no error path can leave it stuck. Do NOT clear it in `handleSetupBack` (`ResumePodSetup.vue:491`): that handler only closes `SetupProgressModal` and returns to the still-active `members` phase (`CreateMembersStep` re-renders via `v-else-if="phase === 'members'"`), so clearing there would reopen the `/welcome → /nook` window while the user is still adding members — `onBeforeUnmount` remains the catch-all if they then abandon the tab. `SetupProgressModal`'s existing idle-only `creating` claim/release is left untouched. Do NOT defer `markPodCreated` (data-safety invariant). Document the flag at its declaration and at the guard.

### WS-F — Test hygiene

Switch `CreateMembersStep.test.ts` `beforeEach` to `vi.resetAllMocks()`; re-establish the default `useTranslation`/`familyStore` mock return values inside `beforeEach` (since `resetAllMocks` clears implementations too). Add tests for the new `deleteMember`-failure path (finding 13) and owner-derivation (finding 4).

### WS-G — Sentinel evaluation (recommendation)

**Recommendation: keep the current sentinel for now; do NOT do the create-owner-late refactor in this plan.** Rationale: the sentinel approach is shipped, unit-tested, and the fail-closed guard (`syncStore.ts:1180-1189`) makes the dangerous failure mode (a pod whose owner can't authenticate) structurally impossible. The reviewer's "create the owner only once the password is known" is cleaner but is an auth-layer refactor that touches `signUp`'s contract, the registry mapping, the iOS rehydrate path, and the `🫘 started` ping ordering — high blast radius for a flow we JUST stabilized and can't yet device-test on iOS. **Action in this plan:** add a single doc-comment block at `DEFERRED_PASSWORD_HASH` enumerating the three lockstep invariants (so a future edit can't silently drop one), and leave a `// FUTURE:` note pointing at the create-owner-late design. Revisit after iOS is device-verified.

## Files Affected

- `e2e/helpers/auth.ts` — rewrite both helpers for the new flow; rename `navigateToSetupStep3` → `navigateToAddMembers` (WS-A).
- `src/services/sync/providers/memoryProvider.ts` — **new** dev/E2E in-memory `StorageProvider` (WS-A).
- `src/components/login/CreatePodView.vue` — replace `__e2eCreatePod.setStep` with a DEV-gated `__e2eCreatePod.installMemoryProvider()` hook that ONLY installs the in-memory provider (no `completeCreate` reimplementation — see Approach WS-A) (WS-A); restore `isConfigured` guard in `handleStorageConnected` (finding 12).
- `src/components/login/ResumePodSetup.vue` — per-reason error mapping in `finalizePod` (finding 2); phase-aware subtitle binding (finding 3); set `syncStore.membersStepActive = true` on entering members + clear on every exit (finding 11); silent-recovery-before-storage-fallback in `handleIdentityNext` (finding 10).
- `src/components/login/CreateMembersStep.vue` — derive owner display, remove `ownerRole` prop (finding 4); `deleteMember` failure handling (finding 13); consume shared `MEMBER_COLOR_VALUES` (finding 5) + `useCalendarSelectOptions` (finding 7).
- `src/components/family/FamilyMemberModal.vue` — consume shared `MEMBER_COLORS` (finding 5) + `useCalendarSelectOptions` (finding 7).
- `src/components/transactions/TransactionModal.vue` — consume `useCalendarSelectOptions(28)` for `monthOptions` + `dayOfMonthOptions` (finding 7).
- `src/constants/memberColors.ts` — **new** shared palette (finding 5).
- `src/composables/useCalendarSelectOptions.ts` — **new** shared month/day option builder (finding 7).
- `src/components/login/SetupProgressModal.vue` — remove `setupAutoSync`/`ensureRegistered` from `runRealWork` + step 4; verify step-4 i18n copy isn't a stale claim (finding 8). Finding 11 no longer touches this file — the existing idle-only `creating` claim/release is left intact.
- `src/pages/LoginPage.vue` — keep `setupAutoSync`/`ensureRegistered` as the single canonical call; add comment (finding 8).
- `src/router/index.ts` — suppress the ALREADY_AUTH `/welcome → /nook` redirect while `syncStore.membersStepActive` is true; document it (finding 11).
- `src/stores/syncStore.ts` — add a dedicated `membersStepActive` ref (default `false`) + doc-comment for the members-phase redirect guard (finding 11). No change to `src/types/sync.ts` / `CriticalWriteState` — the block-first machine is intentionally left untouched.
- `src/stores/authStore.ts` — `DEFERRED_PASSWORD_HASH` invariant doc-comment + FUTURE note (finding 15).
- `src/services/translation/uiStrings.ts` — `resumeSetup.subtitleRecovery`, `loginV6.removeMemberFailed`; fix the stale `CreatePodView.handleStep2Next` comment at `:2916` (+ `npm run translate`, zh spot-check).
- `src/components/login/__tests__/CreateMembersStep.test.ts` — `resetAllMocks` (finding 14); add `deleteMember`-failure + owner-derivation tests.
- `src/stores/__tests__/createNewFile.test.ts` — no change expected; add a per-reason `finalizePod` assertion only if a store-level seam exists, else cover via component test.

## Acceptance Criteria

- [ ] **WS-A:** `npx playwright test` (Chromium) passes for the previously-affected specs; `e2e/helpers/auth.ts` drives the new flow through the real `ResumePodSetup` UI plus a DEV-gated `installMemoryProvider` seam (no parallel `completeCreate` reimplementation); no references to deleted step-1 password fields / `setStep(3)`; the in-memory provider is DEV-gated and never reachable in prod.
- [ ] **Finding 2:** each `createNewFile` failure reason shows its specific message on the finish surface (verified by forcing each reason in a component/unit test); `createPod.failedReason*` keys have live references again; `concurrent-write` maps to `failedReasonConcurrent`.
- [ ] **Finding 3:** the `auto-load` recovery phase shows re-entry copy; the create `identity` phase shows "set your password to finish"; i18n checks pass.
- [ ] **Finding 4:** the dangling `ownerRole` prop is removed; an owner who is a child shows a consistent (adult, per `buildOwnerDoc`) avatar/label with no dangling prop.
- [ ] **Finding 5:** one `MEMBER_COLORS` source; a member added during onboarding opens in `FamilyMemberModal` with its swatch correctly selected (no off-palette "nothing selected").
- [ ] **Finding 7:** one `useCalendarSelectOptions`; all three sites consume it (TransactionModal with 28); no duplicated `MONTH_KEYS`/`monthOptions`/day arrays.
- [ ] **Finding 8:** `ensureRegistered`/`setupAutoSync` run once per create finish (asserted by spy or reasoning + log check); load/join/reconnect still arm correctly.
- [ ] **Finding 12:** a wired-but-not-configured (`isConfigured===false`) hand-off is refused with a critical `reportError`.
- [ ] **Finding 13:** a failed `deleteMember` keeps the row + reports; no silent divergence.
- [ ] **Finding 14:** `CreateMembersStep.test.ts` uses `resetAllMocks`; suite green with no cross-test leakage.
- [ ] **Findings 10/11:** code-level defensive guards in place with comments; reasoned safe; `syncStore.membersStepActive` suppresses the `/welcome → /nook` re-entry during add-members and is provably cleared on every exit (success/back/unmount); the block-first critical-write machine is untouched; do not regress the desktop happy path.
- [ ] **Finding 15:** invariant doc-comment + FUTURE note added; recommendation recorded; no behavior change.
- [ ] `npm run validate` green (lint + type-check + unit + build); `npm run translate` clean.

## Testing Plan

1. **WS-A:** run `npx playwright test --project=chromium` for `setup-flow`, `trusted-device`, `google-drive`, `invite-join`; confirm all reach `/nook`.
2. **Unit/component:** force each `createNewFile` reason → assert specific copy (finding 2); `deleteMember` returns false → row kept + report (finding 13); owner derivation (finding 4); `getNextColor` only yields canonical palette values (finding 5); `useCalendarSelectOptions` returns 12 months + N days for N∈{28,31} (finding 7).
3. **De-dup (finding 8):** spy `ensureRegistered`/`setupAutoSync`; assert one `ensureRegistered` call across a create finish; assert load/join still arm.
4. **Manual — desktop Chrome (greg):** full create → password once → members → `/nook` with the wizard showing immediately (regression guard for `5919240f`); exercise member-add and member-remove failure paths if feasible.
5. **i18n:** `npm run translate`; spot-check the two new zh keys.
6. `npm run validate` + build.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the seven-workstream remediation (CI-breaking E2E first; user-facing regressions; DRY extractions of MEMBER_COLORS + a DOB options composable; finalize de-dup; iOS-defensive guards; test hygiene; sentinel evaluate-and-recommend), noting pre-existing vs introduced per finding.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against source and corrected four that were wrong or unsafe: (a) WS-A — no installable test provider exists (`__e2eSeedDoc` only seeds a doc; `createNewFile` needs a provider), so added a DEV-gated in-memory `StorageProvider` + a real `completeCreate` hook; (b) finding 7 — renamed `useDateOfBirthOptions`→`useCalendarSelectOptions` and parameterized day length, because TransactionModal's third copy is a 28-day recurrence picker, not a birthday; (c) finding 8 — found a THIRD call site (`runRealWork`) and firmed the de-dup to "remove from both SetupProgressModal sites, keep handleSignedIn" after verifying the create path reaches it and `setupAutoSync` is already idempotent; (d) anchored findings 2/4/5/10/11/12/13 to exact verified file/line/symbols (reason union, `{value,gradient}` shape, the dangling `ownerRole`, `deleteMember`'s boolean, `tryReconnectSilently`'s real module, and reusing the existing `criticalWriteState` router short-circuit).
- **Pass 3 (Sustainability)**: Narrowed WS-A's dev hook to inject ONLY the in-memory provider and drive the create through the real `ResumePodSetup` UI (dropped the `completeCreate` that forked a parallel create path and could pass while prod ordering breaks); replaced WS-E finding-11's `{ kind: 'members' }` `CriticalWriteState` variant + `SetupProgressModal` claim/release handoff with a single dedicated `syncStore.membersStepActive` flag checked only in the ALREADY_AUTH guard (the block-first machine would otherwise block ALL nav for an open-ended phase and the lockstep release was strand-prone); added a step-4 i18n-truthfulness check (WS-D), a WS-C 'stay at data altitude' guardrail, and an explicit cross-workstream ordering note (WS-C before its WS-B/WS-F consumers).
- **Pass 4 (Fresh-eyes sweep)**: Fixed a stale Files-Affected reference (`CreatePodView` still said `completeCreate` dev hook — superseded by `installMemoryProvider` in Pass 3) and corrected finding-11's flag-clear list (`handleSetupBack` returns to the live `members` phase, so clearing `membersStepActive` there would reopen the redirect window — clear only on `handleSetupComplete` + `onBeforeUnmount`). Confirmed finding-4's owner display is already `v-if="familyStore.owner"`-guarded (no null-render risk), finding-8's de-dup safe (both `SetupProgressModal` sites removable; it is create-only and the path provably reaches `handleSignedIn`), and finding-15's keep-the-sentinel call. All 13 findings have matching approach + acceptance steps.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Run /beanies-plan and prepare a full plan to fix all issues identified in the max-effort code review of the unified create-a-family flow (commits 10736cb6 + wizard fix 5919240f). Findings 6 and 9 are already fixed. Cover the remaining 13 findings (full list with verdicts and file/line anchors supplied), grouped CI-breaking first → user-facing regressions → DRY/quality → iOS-defensive → finding 15 evaluate-and-recommend, with the 4-pass discipline, DRY audit (findings 5 + 7 create shared constants/composables), unit + E2E tests (finding 1), edge cases, and pre-existing-vs-introduced notes.

</details>
