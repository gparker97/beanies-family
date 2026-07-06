# Plan: Fix cross-family data leakage & last-edit loss in the create-new-family flow (ADR-032)

> Date: 2026-07-06
> Related issues: None — direct implementation (branch `feat/automerge-web-worker`, ADR-032 worker migration)
> Plan file (on approval): `docs/plans/2026-07-06-create-family-state-teardown.md`

## User Story

As someone creating a new family in beanies while already signed into another family (or after using one this session), I want the new family to start completely empty and everything I create in it to be saved durably — so I never see another family's data mixed in, and I never lose data I just entered.

## Context

While validating the ADR-032 worker migration, greg created a new family ("test new worker") from an active dev session and hit three data-integrity defects:

1. **Cross-family mixing** — the previous dev family's accounts/activities appeared inside the new family's UI. Gone after a full sign-out + reload, and NOT present in the new `.beanpod`.
2. **(latent) cache/key pollution** — the new family's early doc can persist into the _previous_ family's encrypted IndexedDB cache.
3. **Lost last edit** — an activity greg created via the onboarding wizard (right after pod creation) was gone after sign-out + clear-data + sign-in, while bank accounts he created earlier survived.

### Root causes (verified in code)

- **D1:** Entity stores hold persistent `ref<T[]>` arrays (`activityStore.activities` `src/stores/activityStore.ts:39`, `accountsStore.accounts` `:16`) re-derived only by `syncStore.reloadAllStores()` (`syncStore.ts:1646`) on family LOAD. `buildOwnerDoc` (`authStore.ts:475`) resets only `familyStore.resetState()` (`:483`) after `docClient.initDoc()` (`:480`); `createNewFile` never `reloadAllStores`; `signOut` (`:1048`) resets only sync state (`:1079`). So old rows stay resident and render mixed in. Not written to the new `.beanpod` (worker doc reset by `initDoc`) → gone after full sign-out + reload.
- **D2:** During `buildOwnerDoc` the worker still holds the previous family key + open cache DB; `createMember` → `persistNow` (`applyAndProject.ts:104`, guard `:105` bails only on null key / cache-not-ready) writes the new family's early doc into the old family's cache — corrupting it on a trusted device (cache retained across sign-out).
- **D3:** `signOut` → `flushPendingSaveWithTimeout(3000)` (`:1053`) → `flushPendingSave()` (`syncService.ts:1113`) is `if (saveDebounceTimer) { await save() }` with no else. Every mutation fires `triggerDebouncedSave` (`syncService.ts:1060`) which only _schedules_ a debounced Drive upload. If the activity's debounced save fired-and-failed (`recordSaveFailure`, timer cleared) or elapsed, there's no pending timer, the flush no-ops, and the freshest edit lives only in the worker cache — which sign-out then deletes. Accounts survived because their earlier save reached Drive.

## Requirements

1. New family starts with ALL entity stores empty.
2. No pre-pod mutation persists into a different family's cache/key.
3. Data created right after pod creation reaches the durable `.beanpod` before the cache is torn down on sign-out.
4. Must not break the `buildOwnerDoc` resume-after-redirect path (iOS OAuth → `rehydrateOwnerDoc`/`ResumePodSetup`).
5. No silent failures; teardown always completes (never trap the user).
6. No behavioural change to normal load / family-switch. (Sign-out gains a bounded force-save attempt — an owned, in-scope trade-off; see Notes.)

## Important Notes & Caveats

- **Reuse `reloadAllStores()` — no parallel reset path.** It already maps the projection onto exactly ~21 entity stores. After `docClient.reset()` + `docClient.initDoc()` the projection is empty, so `reloadAllStores()` re-derives every store to empty — correct-by-construction, cannot drift as stores are added. No bespoke `resetAllStores`/new `resetState()` needed.
- **Encapsulate the ordered teardown in ONE documented private helper** `resetInMemoryFamilyState()` in `authStore.ts` (steps `docClient.reset()` → `docClient.initDoc()` → `familyStore.resetState()` → `reloadAllStores()`). This is an **order-dependent correctness contract** (reset-before-init-before-reload); inlining it invites a future reorder that silently reintroduces D1/D2. Document the ordering rationale once at the helper; reuse it from `buildOwnerDoc` (and the optional signOut hardening).
- **Ordering is load-bearing (verified — concern b):** in `buildOwnerDoc` the reset+reload run BEFORE `createMember`. `familyStore.createMember` (`familyStore.ts:224-228`) appends directly to the reactive ref (`members.value = [...members.value, member]`), and there is NO later reload in `buildOwnerDoc` to clobber it — so the owner write survives. `setOnboardingCompleted(false)` also writes after the reload and is not re-derived away.
- **Two `buildOwnerDoc` callers:** (a) fresh create at step-1 `signUp` (old family may be active → teardown needed); (b) resume-after-redirect (`rehydrateOwnerDoc` iOS branch `authStore.ts:554-558`, worker respawned fresh). Teardown is cheap+safe for (b): keyless `docClient.reset()` is a trivial RPC, and `reloadAllStores()` over an empty projection runs ~21 store loads plus its highlight-snapshot / permission-diagnostic branches — both guarded (`if (prevMember && …)`; `isCrossDeviceReload` false on create), harmless with no prior member (`syncStore.ts:1678-1690`).
- **Do NOT touch the desktop in-place branch** (`rehydrateOwnerDoc` "owner still in doc" `authStore.ts:544-552`): it stamps the hash in place via `updateMember`, never calls `buildOwnerDoc`. **Verified safe against the new reset (concern a):** the only `reset()` in the deferred-password desktop flow runs during step-1 `signUp`→`buildOwnerDoc`, whose `createMember` immediately repopulates the doc/projection; step-2 `rehydrateOwnerDoc` never re-invokes `buildOwnerDoc`, and its in-place branch issues a keyless `updateMember` mutate (exactly as `createMember` does today) — it depends on no key/projection the reset cleared.
- **`docClient.reset()` (`docClient.ts:451-459`)** nulls `currentFamilyId`+`familyKey`, sends the worker `reset` RPC, `resetProjection()` on main; does NOT delete/close the previous cache DB (correct — with key null `persistNow` early-returns; `createNewFile`'s later `initAndLoadCache(newFamilyId)` re-points the handle).
- **Keep `familyStore.resetState()`** inside the helper, before `reloadAllStores()`: `loadMembers` restores rather than nulls `currentMemberId`; `resetState` nulls the sentinel, then `createMember`+`setCurrentMember` set it fresh.
- **Fix B changes normal sign-out behaviour — own it explicitly.** `flushPendingSave()` saves ONLY when a timer is pending; `saveNow()` (after cancelling the timer) attempts a full `save()` unconditionally. This is the intended fix (D3's trigger is exactly "no pending timer, but unsaved data in cache") and is safe/bounded: `saveNow()` guard (`syncService.ts:1090`: no key OR no envelope → `false` no-op), `doSave` merges remote first (additive CRDT — cannot drop the local activity), all inside the existing 3 s race. **Verified against mid-create sign-out (concern c):** before `createNewFile` derives the key + assembles the envelope, `currentFamilyKey`/`currentEnvelope` are null → `saveNow()` returns `false` and writes nothing, so a partial/empty doc can never be uploaded. Cost: one extra bounded Drive round-trip per sign-out; a dirty-flag was rejected (syncService tracks no reliable dirtiness signal — the unconditional save is the robust choice). No effect on load / family-switch (requirement 6).
- **Do NOT** refactor stores to read the projection reactively (~21-store change) — future consideration only.

## Assumptions

> Review before implementation.

1. Defects reproduce on create-from-an-active-session (not fresh-app create, where stores already start empty). greg's repro fits.
2. `reloadAllStores()` mid-`buildOwnerDoc` is safe (reads only the projection; no provider guard; guarded diagnostics; side effects harmless with no prior member).
3. D3's exact trigger (failed vs elapsed debounce) is a hypothesis; the bounded-`saveNow`-before-delete fix is robust regardless. Add a one-line dev log at the sign-out force-save to confirm in the repro.
4. No create-family entry point bypasses `buildOwnerDoc` (join / import go through the load path, which already `reloadAllStores`).

## Approach

Two DRY fixes, both from existing primitives — no new stores, one small private helper local to `authStore.ts`. All production edits in `src/stores/authStore.ts`.

### Fix A — full in-memory teardown in `buildOwnerDoc`, via `resetInMemoryFamilyState()` (D1 + D2)

Add a private helper `resetInMemoryFamilyState()` in `authStore.ts` that runs, in documented order:

1. `await docClient.reset();` — drop previous worker doc + key + persist debounce, reset projection (key now null → pre-pod `persistNow` early-returns → can't write to old cache).
2. `await docClient.initDoc();` — fresh empty doc + empty projection.
3. `useFamilyStore().resetState();` — null the stale `currentMemberId` sentinel.
4. `await useSyncStore().reloadAllStores();` — re-derive all ~21 stores from the empty projection (clears leftovers). Use the existing dynamic `import('./syncStore')` pattern (`authStore.ts:1078`) already used for `syncStore.resetState()` in sign-out — no new cross-store coupling class.

`buildOwnerDoc` replaces its current `initDoc()` + lone `resetState()` (`:480-483`) with a single `await resetInMemoryFamilyState()`, then `createMember`/`setCurrentMember`/`setOnboardingCompleted(false)` as today. Safe for resume; do not touch the in-place branch.

### Fix B — force durable save before cache teardown on sign-out (D3)

In `flushPendingSaveWithTimeout` (`:1107`): call `saveNow()` instead of `flushPendingSave()` inside the existing `Promise.race`. Covers both `signOut` (`:1053`) and `signOutAndClearData` (`:1177`) via the one wrapper (DRY). Add `saveNow` to the `syncService` import; drop the `flushPendingSave` import if unused. Keep the 3 s timeout + trailing `cancelPendingSave()`. Log when `saveNow()` resolves `false` (no silent path). Contract: bounded force-save, log on failure/skip, then proceed. See the owned behaviour-change note above.

**Rename (isolated, cosmetic — keep scope tight):** rename the wrapper to `forceSaveWithTimeout` to match its new contract; update both call sites + the two comment blocks in the same commit and nothing else. If it pulls in unrelated churn, drop the rename and keep the behaviour change.

### Optional hardening (default skip)

Not required (next sign-in goes through the load path, which `reloadAllStores`). If wanted: `await resetInMemoryFamilyState()` in `signOut` after the force-save — reuses the exact Fix-A helper, zero duplicated logic.

## Files Affected

- `src/stores/authStore.ts` — new private `resetInMemoryFamilyState()` helper; `buildOwnerDoc` calls it; `flushPendingSaveWithTimeout` → `saveNow` (rename to `forceSaveWithTimeout` + logging); import update.
- **Tests to UPDATE (existing — will break otherwise):**
  - `src/stores/__tests__/dataClearingSecurity.test.ts` — **REQUIRED.** It imports `flushPendingSave` and asserts it was called before `deleteFamilyDatabase` in BOTH the `signOut` and `signOutAndClearData` "flushes pending save before clearing" tests (≈ lines 4, 458, 460, 504). Fix B swaps the wrapper's inner call to `saveNow()`, so `flushPendingSave` is no longer invoked and those assertions fail. Switch the import + assertions to `saveNow`, keep the `< deleteOrder` ordering check. The module is auto-mocked (`vi.mock('@/services/sync/syncService')`), so `saveNow` is already a mock — no manual factory needed.
- **Tests to ADD:**
  - `src/stores/__tests__/createNewFile.test.ts` — create-from-active resets the ~21 stores to empty (owner present); a `resetInMemoryFamilyState()` ordering assertion (reset before init before reload).
  - A sign-out force-save ordering test (`saveNow` before `deleteFamilyDatabase`; a `saveNow` rejection and a `saveNow` → `false` both still complete + log).

> No changes to `syncStore.ts`, `syncService.ts`, the worker, or any entity store — the fix is built from existing exports (`reloadAllStores`, `docClient.reset`, `saveNow`).

## Acceptance Criteria

- [ ] New family from an active session → empty entity stores (in-app + unit).
- [ ] Pre-pod `createMember` mutations don't write to the previous family's cache DB.
- [ ] Onboarding activity created immediately before sign-out is present after sign-out + sign-in.
- [ ] Accounts + activities created in a new family all persist across a full sign-out + reload.
- [ ] iOS/redirect resume-to-create still completes correctly (device check).
- [ ] Desktop in-place hand-off (`rehydrateOwnerDoc`) unchanged; never calls `buildOwnerDoc`; unaffected by the new keyless reset.
- [ ] Sign-out mid-create (before key/envelope set) uploads nothing (`saveNow` guard returns `false`).
- [ ] Normal load/switch unchanged; sign-out gains only the bounded force-save.
- [ ] Teardown ordering lives in one documented helper reused by every caller.
- [ ] No silent failures; both `signOut` and `signOutAndClearData` complete on a failed/skipped force-save.
- [ ] `dataClearingSecurity.test.ts` updated to assert `saveNow`; full unit suite green; type-check + lint clean.

## Testing Plan

1. Unit — create resets stores: seed several entity stores, run create via the inline backend, assert all ~21 empty afterwards (owner present in familyStore).
2. Unit — `resetInMemoryFamilyState()` ordering: assert `docClient.reset` before `initDoc` before `reloadAllStores` (correctness depends on it).
3. Unit — sign-out force-save ordering: `saveNow` awaited before `deleteFamilyDatabase`; a `saveNow` rejection and a `saveNow` → `false` both still let sign-out complete and are logged.
4. Unit — update `dataClearingSecurity.test.ts` flush-before-clear tests to `saveNow` (both `signOut` and `signOutAndClearData`), keeping the pre-`deleteFamilyDatabase` ordering assertion.
5. Manual on a FRESH dev server (lessons.md #15), `docWorker` ON + OFF: create-from-active-family shows no old data; onboarding activity persists across sign-out; iPhone redirect resume creates correctly.
6. Regression: full create/sign-out/switch suite green; confirm no behavioural change on normal load.

## Review Passes

- **Pass 1 (Initial draft):** Drafted three targeted fixes from a full create/sign-out/worker-cache code trace.
- **Pass 2 (DRY + error handling):** Collapsed the proposed new `resetAllStores`/`getResettableStores`/per-store `resetState()` work into reuse of the existing `reloadAllStores` (all edits in `authStore.ts`); folded D3 into a single edit in the shared `flushPendingSaveWithTimeout` wrapper covering both sign-out paths; ensured skip/failure is logged; kept `familyStore.resetState()` for the `currentMemberId` sentinel; corrected line numbers.
- **Pass 3 (Sustainability):** Extracted the load-bearing 4-step teardown into one documented private helper (`resetInMemoryFamilyState`) so the ordering contract is explicit, unduplicated, and reused; explicitly owned Fix B's sign-out behaviour change (always-attempt bounded save) with the safety rationale and why a dirty-flag was rejected; corrected the "no-op" overstatement on the resume path.
- **Pass 4 (Fresh-eyes sweep):** Traced all four self-introduced-risk concerns against source — (a) desktop in-place rehydrate is independent of the reset (keyless mutate, no `buildOwnerDoc` re-entry) — safe; (b) reload runs before `createMember`, which appends to the reactive ref with no later reload — owner survives; (c) `saveNow`'s null-key/envelope guard blocks any partial/empty upload mid-create; (d) **found a real gap** — `dataClearingSecurity.test.ts` asserts the OLD `flushPendingSave` sign-out behaviour at 3 sites and would break; added it as a required test update with a matching acceptance criterion. No changes to the production approach — it holds up as the simplest DRY solution.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial (investigation request)

"I've just created a new family from scratch and something very odd happened - the data from my previous dev family is mixed in with the data from the new family. I created a family called test new worker … I can also see data from my previous family mixed in. Once I signed out (and cleared data) and signed in again … the data from the previous family was gone and the family data was mostly empty. The bank accounts I created are still there, but the activities I created seem to be missing … can you look into this and do an investigation?"

### Follow-up (confirming symptom 2)

"yes, i created one new activity with the new family using the onboarding wizard (activity creating step), but i didn't confirm it existed in the calendar before signing out and clearing data. after i signed in again, i definitely did not see it."

### Instruction

"plan the fix with /beanies-plan"

</details>
