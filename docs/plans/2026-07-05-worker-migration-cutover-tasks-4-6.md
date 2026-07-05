# Plan: Automerge Web Worker Migration — Data-Layer Cutover (ADR-032 Tasks #4–#6)

> Date: 2026-07-05
> Related issues: None — direct implementation (continuation of the approved master plan `docs/plans/2026-07-05-automerge-web-worker.md`)
> Plan file (on approval): `docs/plans/2026-07-05-worker-migration-cutover-tasks-4-6.md`
> Branch: `feat/automerge-web-worker` (Tasks #1–#3b already committed + tested; suite 3496 green)

## User Story

As a family member opening beanies after time away — or syncing across my phone and laptop — I want the app to stay responsive while my data loads and merges in the background, so it never freezes or trips the browser's "page unresponsive" dialog, and I can start using it immediately.

## Context

Production `load-perf` telemetry proved the "app freezes while the orange sync bar slides" report is the JS main thread pinned by synchronous whole-document Automerge WASM (`cacheLoad` ~4.7 s cold start, `remoteLoad` ~2.6 s ×36/session, `save` ~470 ms). The only fix for a load freeze is to run Automerge off the main thread. ADR-032 / Plan A does this: the Automerge doc + persistence pipeline live in a dedicated Web Worker; the main thread keeps a read-only reactive projection and issues mutations via async RPC.

**Tasks #1–#3b are done** on `feat/automerge-web-worker`: the worker infra (`worker/protocol.ts`, `worker/docClient.ts`, `projection.ts`), pure ops (`worker/docOps.ts`), the stateful crypto+IDB cache (`worker/cache.ts`), the orchestrator (`worker/applyAndProject.ts`), and real worker dispatch (`worker/docWorker.ts`) are built and unit-tested. **The worker is not yet wired into the app** — stores still use the old synchronous `docService`/`persistenceService` path, so nothing is broken but nothing is off-thread yet.

This plan covers the remaining **atomic cutover** of the data layer:

- **Task #4** — migrate `automergeRepository` + the 3 bespoke repos + the direct-`changeDoc`/`getDoc` stores + the reactive readers to `docClient`/`projection`; move the photo hook registry into the worker as static registration + `named` attach ops; make the financial read-modify-write ops atomic.
- **Task #5** — migrate the doc-lifecycle orchestrators (`syncStore`, `syncService`, `fileSync`, `authStore`, `App.vue`) from `replaceDoc`/`mergeDoc`/`initDoc`/`persistDoc`/`loadCachedDoc` to worker RPC sequences; route Drive save via the worker's heads-derived `dirty`; keep envelope assembly on main.
- **Task #6** — wire the inline fallback + worker-death re-hydration seams; solve the `dataBridge` synchronous-`beforeunload` snapshot; land the `docWorker` kill-switch flag.

**Why atomic:** the master plan retires `docService`'s `changeDoc`/`getDoc`/`mergeDoc`/`replaceDoc`/`initDoc`, which `syncStore`/`authStore`/`App.vue` import — so the build won't pass until #4 and #5 land together. The app won't _boot_ on the new path until #6's inline fallback exists. There is no partial-runnable increment; the whole layer flips at once, gated by the `docWorker` kill-switch (inline fallback is the safety net, not the old `docService`). **"Green at each commit" means typecheck + the unit suite (driven with injected `docClient`/worker fakes) stays green — achieved by migrating every caller ahead of removing an API (see the Approach discipline). The _app itself_ only boots on the new path after Task #6.** These are not in tension: units pass throughout; end-to-end boot arrives at #6.

**Rollout stays behind `docWorker`** (auto-on in dev; committed staged value in prod). The inline path is retained for one release; the real-worker Playwright smoke + device validation are Task #7 (separate). This plan ends at "app boots + round-trips locally on the worker path behind the flag."

## Requirements

1. `automergeRepository` generic CRUD (`getAll/getById/create/createWithId/update/remove`) reads from `projection`, writes via awaited `docClient.mutate`; public signatures unchanged (already `Promise`-returning); array-ref stores untouched.
2. Every direct `changeDoc(fn)` closure (11 files, 29 sites) is re-expressed as a declarative op (`set`/`patch`/`delete`/`increment`/`batch`/`named`); the only genuine `named` family is photo attach/collect.
3. Every `getDoc()` read (10 files, 17 sites) reads from `projection` (`list`/`getById`/`getSettings`), or from the re-backed `isDocLoaded()` for existence probes.
4. Photo collection hooks (`flatHooks`/`avatarPhotoHooks`/`vacationPhotoHooks`) + registry move into the worker as **static** compile-time registration; the `App.vue` runtime registration is removed. A `named` `attachPhotoToEntity` op covers both `finalizeUpload`'s set+attach and standalone `linkPhotoToEntity`. `gcOrphans` stays a main-driven loop using a worker `collectReferencedPhotoIds` RPC + a single-id `deletePhotoRecord`.
5. The financial read-modify-write ops (`adjustAccountBalance`, `adjustGoalProgress`, `applyLoanPayment` + reversers) are made atomic against a concurrent poll-merge — no lost balance/goal/loan write introduced by the async boundary.
6. `syncStore` / `syncService` / `fileSync` doc-lifecycle sites become worker RPC sequences; decrypt/encrypt of the Drive payload moves into the worker (envelope assembly stays on main — worker returns only the base64 `encryptedPayload`).
7. Drive auto-save fires exactly when needed: after a local edit, and after a poll-merge that left local heads not covered by remote (worker `dirty`); a no-op/remote-ahead merge does NOT re-upload.
8. No silent failures — every RPC can reject and surfaces via the existing `docClient` `showToast('error', …, {surface:'doc-worker'})` fan-out, EXCEPT the expected-degradation class (`CorruptPayloadError`) AND callers that classify locally with `{quiet:true}` and keep their own `reportError` (overlapAck, notifications, `normalizeRoles`). Projection-apply failures in `docClient` route through `reportError` (not bare `console.warn`).
9. Inline fallback: worker spawn/handshake failure (or `docWorker` off) runs the identical op set inline via the same `applyAndProject`/`docOps`; degradation logged.
10. Worker mid-session death re-hydrates from the encrypted cache with no re-unlock, no data loss; in-flight RPCs reject + surface.
11. E2E `dataBridge` UI-created data survives a `page.goto()` reload without a synchronous main-thread `saveDoc`.
12. `.beanpod` V4 / encryption / envelope semantics unchanged; sign-out still deletes the cache.
13. Full unit suite stays green at each commit; app boots + create/edit/delete round-trips locally behind the flag.

## Important Notes & Caveats

### Op-design refinements (found during exploration — extend the master plan's `increment` design)

**Governing op rule:** _generic ops (`set`/`patch`/`delete`/`batch`) for structural writes; `named` worker ops for atomic domain read-modify-writes or nested-structure walks._ This keeps the op surface bounded — `increment` stays a plain counter with exactly one consumer (account balance); the two domain read-modify-writes (goals, loans) and the photo attach/collect family are `named` ops.

- **Atomic ops route through the OWNING array-ref store, never `docClient.mutate` directly.** `accountsStore.accounts`, `goalsStore.goals`, `assetsStore.assets` are static `ref<T[]>` arrays updated surgically from each store method's echoed return (`accountsStore.ts:174`, `goalsStore.ts:160`). If `transactionsStore` called `docClient.mutate` directly it would bypass those arrays → the UI balance/goal wouldn't update until a full reload. So: add atomic-op-backed methods on the owning stores — `accountsStore.incrementBalance(id, delta)` (plain `increment`), `goalsStore.applyContribution(id, delta)` + a loan-balance method on `accounts`/`assets` (both `named` ops) — that call `docClient.mutate(...)` and then run the store's existing surgical array-update from the echoed entity. `transactionsStore` calls those. Keeps the O(1) array-ref contract and the store-array logic in one place (DRY).
- **Goals — one atomic `named` op (`applyGoalContribution`), not `increment`.** `goalsStore.updateGoal` sets `isCompleted` **before** its single write; after a bare `increment` the write has already happened, so "reuse `updateGoal`'s branch" isn't literally achievable without a second completion write. Cleaner: a `named` worker op `applyGoalContribution` reads the goal → `currentAmount = max(0, current + delta)` → sets `isCompleted` when `>= targetAmount`, all in one `Automerge.change`, and returns the fully-updated goal. `goalsStore.applyContribution` does the array-map + fires `celebrate('debt-free'/'goal-reached')` only on the `!isCompleted → isCompleted` transition (celebrate is inherently main-side). This means the generic `increment` op needs **no `clampMin` flag** — its sole consumer is account balance.
- **Loans — a `named` op scoped to the balance-host write only.** `applyLoanPayment` computes `result.newBalance` via `calculateAmortization`/`calculateExtraPayment` (verified pure — `src/utils/loanPayment.ts` imports only `@/types/models` → worker-safe). The ONLY thing that must be atomic against a concurrent merge is the loan-host balance read-modify-write (`accounts[id].balance` OR the nested `assets[id].loan.outstandingBalance`). So the `named` op `applyLoanPayment`/`reverseLoanPayment` reads the loan host, runs the pure math in the worker, writes the new balance atomically in one `Automerge.change`, and **returns** `{echoedHostEntity, interestPortion, principalPortion}`. Main folds `echoedHostEntity` into `accountsStore.accounts`/`assetsStore.assets`, then writes the interest/principal portions through the existing `transactionRepo.updateTransaction` path (as today — the just-created transaction has no concurrent writer, so no race, and the transaction write stays in `transactionsStore` where it belongs). This keeps each `named` op single-collection and removes the cross-store fan-out. Today these ops swallow all errors to `console.error` only (`transactionsStore.ts:307,335`) — a near-silent failure; post-cutover the `docClient` auto-toast fires independent of that `try/catch` (`docClient.ts:263`), so keep the `console.error` for developers but the failure now surfaces. _(Alternatives rejected: computing the balance on main + absolute write reintroduces exactly the concurrent lost-update Requirement #5 exists to remove — the interest/principal split and new balance both derive from the same atomically-read balance.)_
- **`notificationReads` is a two-level map.** `notificationReads[memberId][notificationId] = iso`. The per-key diff (set changed keys, delete removed keys) is expressible as `patch` with `id = memberId` operating on the member sub-map — BUT the worker `patch` op currently throws if the target is absent, and the member sub-map may not exist yet. Resolution: add a `createIfMissing?: boolean` to the `patch` op (default false, preserving throw-on-missing for real entities like transactions); pass `createIfMissing:true` for `notificationReads` so the worker inits `notificationReads[memberId] = {}` before applying. Preserves the concurrent-merge-clean per-key semantics (do NOT replace the whole slice).

### Error-handling: the guarded fire-and-forget writers keep their own reporting + go `quiet`

`overlapAckStore.applyChange` (`overlapAckStore.ts:60`), `notificationsStore.applyReducer` (`notificationsStore.ts:187`), and `familyStore.normalizeRoles` (`familyStore.ts:348`) deliberately wrap their write in `try/catch → reportError` at `warning`/`error` severity with a specific surface and **no user-facing toast** (they fire from taps / load paths where a critical toast is wrong). If they became a bare `docClient.mutate(op)`, `docClient.surface()` would (a) double-report (its `showToast`→`reportError` AND the store's `reportError`) and (b) escalate a deliberately-warning, user-invisible failure into a critical "We couldn't update your data" toast. Resolution: these three `await docClient.mutate(op, {quiet:true})` **inside their existing `try/catch`** and keep their `reportError`. Requirement #8's `quiet` scope is broadened accordingly (see below). Also upgrade the two projection-apply catches in `docClient` (`onMessage` `applyDelta` `:112`, `applyChunk` `:137`) from bare `console.warn` to `reportError({surface:'doc-worker-projection', severity:'error'})` — post-cutover the projection is the sole main-thread read model, so a delta that fails to apply after a successful `mutate` silently diverges the UI from the worker's doc with no telemetry.

### Read-side caveats

- **Two whole-doc readers:** `photoStore.gcOrphans`/`collectReferencedPhotoIds` (walks arbitrary + nested hosts via the registered `collect` hooks) and `SettingsPage.handleExportAsJson` (many hardcoded top-level collections). `gcOrphans` is resolved by moving `collectReferencedPhotoIds` into the worker (RPC returns the referenced-id Set — the collect hooks live where the doc lives). `SettingsPage` export iterates `projection.list(name)` across `COLLECTION_NAMES` + `projection.getSettings()` — no new API.
- **`getDoc()` as a throwing existence-probe** (`App.vue:584`, `dataBridge:38`) becomes a `projection.isLoaded()` check, not a thrown-and-caught `getDoc()`.
- **`isDocLoaded()` is kept** (re-backed against a projection `loaded` flag) so its ~14 consumers (`driveTokenRecovery`, `listStore`, `settingsStore`, `useCalendarNudge`, `useNotifications`, the `docVersion` stores) need no import change.

### Sync-lifecycle caveats

- **`replaceDocWithCacheRecovery`** (`syncStore:550`: `initPersistenceDB → loadCachedDoc → replaceDoc(remote) → mergeDoc(cached) → dedup → persistDoc → triggerDebouncedSave`) collapses to a worker RPC sequence. CRDT merge is commutative, so `initAndLoadCache(familyId)` (worker loads cache as currentDoc) followed by `mergeRemoteEnvelope(remoteEnvelope)` (merge remote into it) yields the same converged doc as replace-then-merge. Sites `645/816/1393` already **call** `replaceDocWithCacheRecovery`, so migrating that one helper covers all three. Sites `1854/1943` are two near-identical **open-coded** `decryptBeanpodPayload → mergeDoc → replaceEnvelope → setFamilyKey` blocks that bypass the helper — extract them into ONE shared `hydrateFromEnvelope(envelope, key, familyId)` helper (the 2-RPC `mergeRemoteEnvelope` + `dirty→triggerDebouncedSave` sequence) so we don't ship two hand-maintained RPC sequences that drift. The post-merge `deduplicateRecurringTransactions()` reads `projection.transactions` after the merge RPC resolves (the chunk barrier guarantees the complete set).
- **Decrypt moves into the worker.** Today `syncStore`/`syncService` call `decryptBeanpodPayload(envelope, key)` on main then `mergeDoc`/`replaceDoc`. Post-migration they pass the **envelope** to `docClient.mergeRemoteEnvelope(envelope, familyId)`; the worker decrypts + materialize-checks + merges. So `syncStore`'s `loadFromFile`/`decryptPendingFile*` stop importing `decryptBeanpodPayload` for the merge path.
- **`onDocPersistNeeded` fan-out disappears.** Today every mutation fires a main callback that does `persistDoc` + `persistEnvelope` + `triggerDebouncedSave` (`syncService:1047`). Post-migration the worker owns cache persist (debounced, internal); main triggers Drive save explicitly: after each `mutate` (local change → dirty) call `triggerDebouncedSave()`, and after a `mergeRemoteEnvelope` that returns `dirty:true`. The `persistEnvelope`-on-every-change coupling is replaced by an explicit `setEnvelope`→`docClient.persistEnvelope` RPC on every `currentEnvelope` mutation (incl. `syncService:693` `preserveLocalKeyDicts`).
- **`suppressAutoSave` bracket** (`syncService:677`) is no longer needed the same way — the worker doesn't fire a main persist callback, so the re-entrant-save guard collapses into "main decides when to `triggerDebouncedSave`."
- **`createBeanpodV4`/`reEncryptEnvelope`** (`fileSync`) split: the worker returns the base64 `encryptedPayload` via `docClient.exportEncryptedPayload()`; main assembles `{...envelope, encryptedPayload}` + `JSON.stringify`. `wrappedKeys`/`inviteKeys` never leave main.
- **`authStore.buildOwnerDoc` `initDoc()`** → `docClient.initDoc()`. The in-place `rehydrateOwnerDoc` path (owner still in doc → `updateMember`) stays as-is (it already avoids `initDoc`), now writing via the migrated repo → `mutate`.
- **`App.vue` Path 3** seed/init: `getDoc()` probe → `projection.isLoaded()`; `initDoc()` → `docClient.initDoc()`; the DEV `__e2eSeedDoc` `loadDoc(binary)` → a new `docClient.loadSnapshot(binary)` RPC (worker loads+migrates+projects a raw binary).

### Pre-existing limitation (not a new regression)

`applyGoalAllocation` (`transactionsStore.ts:251`) computes its `remaining`/`applied` clamp from a possibly-stale main-thread `projection` goal. This was always computed from a main read — the atomic `applyGoalContribution` op closes the lost-_write_ (Requirement #5's target); the stale-_read_ clamp is a pre-existing multi-device CRDT limitation for Plan B, not something this cutover introduces or must fix.

### Do NOT

- Do NOT move Drive auth/token logic into the worker.
- Do NOT implement incremental delta sync (Plan B) — only Plan A whole-doc transport.
- Do NOT replace the whole `notificationReads` member slice (breaks concurrent-device merge).
- Do NOT keep the old `docService` mutation/read path alive as a parallel path (two diverging docs). The flag chooses worker-vs-inline `applyAndProject`, both new.
- Validate against a **fresh** dev server (lessons.md #15 — a warm server serves stale worker code and false-greens).

## Assumptions

> Review before implementation.

1. Tasks #1–#3b as committed are correct and stable (suite 3496 green); this plan builds directly on them.
2. `src/utils/loanPayment.ts` is pure (types-only import) and safe to import into the worker if option A is chosen.
3. The `docWorker` flag defaulting on-in-dev / off-in-prod is the desired rollout (per master plan).
4. Vite 6 `worker.plugins` (already added) bundles the worker WASM into the prod build + precaches it; `worker-src 'self'` is allowed if a CSP is set (verified end-to-end in Task #7).
5. No store synchronously consumes a repo return as a non-promise (repos are already async).
6. The inline fallback runs `applyAndProject` on the main thread as a separate module realm from the worker — module-singleton state is per-realm, so there is no cross-contamination.

## Approach

Sequenced in commit-sized steps, each keeping typecheck + the unit suite green. Steps 4.x precede 5.x precede 6.x; within #4 the pure/leaf pieces come first. **Discipline: the `docService` API-removal step (5a) always lands LAST, after every caller is migrated** — the master plan forbids deprecated async shims, so migration-order (not shims) is what keeps the tree compiling. Deleting an export before its callers migrate red-fails typecheck.

### Task #4 — data-layer migration

**4a. Op-schema extensions (`worker/protocol.ts` + `worker/docOps.ts`).** Add `createIfMissing?: boolean` to the `patch` op (worker inits `draft[collection][id] = {}` when absent + flag set, else throw as today). Add the three `named` handlers — `applyGoalContribution` (read → `max(0, current+delta)` → auto-complete → return updated goal), `applyLoanPayment`/`reverseLoanPayment` (read loan host → amortization → write balance → return `{host, interest, principal}`) — moving `calculateAmortization`/`calculateExtraPayment`/`findLoanDetails` into worker-shared code. The generic `increment` op is unchanged (plain counter; no `clampMin`). Unit-test each in `docOps.test.ts`.

**4b. Photo hooks → worker static registration (RELOCATE, don't copy — mind the dependency inversion).** Today `photoCollectionHooks.ts` imports `PhotoCollectionHooks`/`PhotoCollectHookError` **from `photoStore.ts`** (a Pinia/vue module). Relocating inverts that: create a new worker-shared module **`worker/photoOps.ts`** that OWNS `PhotoCollectionHooks`/`PhotoCollectHookError`/`flatHooks`/`registerPhotoCollection`/`photoCollections` + `avatarPhotoHooks`/`vacationPhotoHooks`; `photoStore.ts` and `photoCollectionHooks.ts` import _from_ it. Critical: `photoOps.ts` must NOT transitively import `photoStore`/`vue`/`pinia` (else the whole main graph is dragged into the worker bundle) — add an acceptance check: grep the built worker chunk for `vue`/`pinia` → none. Register statically at worker module load; delete the `App.vue:111-117` runtime registration. Register the `named` op `attachPhotoToEntity` — it MUST preserve both existing behaviors or they regress: (a) unregistered collection → `flatHooks(collection)` fallback (`photoStore.ts:958`); (b) a throwing attach hook is **caught inside the handler and logged via the worker's own `console.warn`, never re-thrown** (mirrors `photoStore.ts:959-963`; the built `NamedOpHandler` signature `(draft,args)→{result?,deltas}` has no log-sink channel, and a re-throw would reject the whole `Automerge.change` batch) — critically, in `finalizeUpload`'s batch a benign attach miss (mid-wizard vacation, `photoCollectionHooks.ts:67`) must NOT reject the batch or trigger the Drive-file rollback. Keep `vacationSegmentEntityId` (`photoCollectionHooks.ts:40`) exported **main-side** (callers build the composite id on main); only the doc-walking `attach`/`collect` move into the worker. Add worker methods `collectReferencedPhotoIds()` (runs all `collect` hooks on the worker doc; if any throws, the whole collect throws → GC deletes nothing, fail-safe preserved) and a single-id `deletePhotoRecord` (a plain `delete` op). Document "adding a photo host = edit the worker registry."

**4c. `automergeRepository.ts` internals.** `getAll`→`projection.list(collection).map(transform)`; `getById`→`transform(projection.getById(collection,id))`; `create`/`createWithId`→`await docClient.mutate({op:'set',…})` returning the echoed entity; `update`→existence-check via `projection.getById` then `mutate({op:'patch', patch:cleanInput, deleteKeys, updatedAt})` returning the echoed entity; `remove`→existence-check then `mutate({op:'delete',…})`. Signatures unchanged. Existing repo tests updated to drive projection + a fake docClient.

**4d. The 3 bespoke repos.**

- `settingsRepository.saveSettings` → `mutate({op:'set',collection:'settings',id:'app_settings',entity:updated})`; reads → `projection.getSettings()`.
- `recipeRepository.deleteRecipeCascade` / `medicationRepository.deleteMedicationCascade` → resolve child ids via `projection.list('cookLogs'|'medicationLogs')`, then `mutate({op:'batch',ops:[…delete children, delete parent]})`.

**4e. Direct-`changeDoc` stores** (the three guarded writers keep their `try/catch → reportError` and pass `{quiet:true}` — see the error-handling caveat).

- `familyStore.normalizeRoles` → `await mutate({op:'batch', ops:[patch per member]}, {quiet:true})` inside its existing try/catch, keeping the return-unmodified-on-failure fallback (`familyStore.ts:371`). Note: the worker `patch` throws on a missing entity (vs today's per-member `if(!target) continue` skip), so one absent member rejects the whole batch — acceptable since patches derive from already-loaded members; call it out. `transferOwnership` → check target exists (main), then `mutate({op:'batch', ops:[patch old owner, patch new owner]})`; its `members.value` array update (`familyStore.ts:432`) is preserved.
- `overlapAckStore`: `acknowledge`→`await mutate(set, {quiet:true})`, `unacknowledge`→`await mutate(delete, {quiet:true})` inside `applyChange`'s try/catch; reads → `projection.getById('overlapAcknowledgments', key)`.
- `notificationsStore.applyReducer` → compute the per-key diff on main from `projection.getById('notificationReads', memberId)`, then `await mutate({op:'patch', collection:'notificationReads', id:memberId, patch:changedKeys, deleteKeys:removedKeys, createIfMissing:true}, {quiet:true})` inside its try/catch; reads → `projection.getById('notificationReads', memberId)`.
- `photoStore`: `finalizeUpload`→`mutate({op:'batch',ops:[set(photos), named(attach)]})` (Drive-rollback on reject stays on main); `addAvatarPhoto`→`mutate(set)`; `replacePhotoFile`/`markDeleted`→`mutate(patch)`; `linkPhotoToEntity`→`mutate(named(attach))`; `gcOrphans`→ main loop using `docClient.collectReferencedPhotoIds()` + per-survivor `mutate(delete)`; `photos` computed → `projection.list('photos')` as record; `photoIdsFor`→`projection.getById(entityCollection, entityId)?.photoIds`.

**4f. Reactive readers + financial ops.**

- `calendarSyncStore.connections` → `projection.list('calendarConnections')`; `notificationsStore.snapshot` read → `projection.getById('notificationReads', memberId)`; keep the `void docVersion.value` subscription (now from `projection.docVersion`, re-exported by `docService`).
- `transactionsStore` calls the owning stores' new atomic methods (NOT `docClient` directly): `adjustAccountBalance`→`accountsStore.incrementBalance(id, adjustment)` (plain `increment`); `adjustGoalProgress`→`goalsStore.applyContribution(id, delta)` (`named` op; store does array-map + transition-gated `celebrate`); `applyLoanPayment`/`reverseLoanPayment`→ `accountsStore`/`assetsStore` loan-balance methods backed by the `named` op, with the interest/principal portions written afterwards via the existing `transactionRepo.updateTransaction`. Each owning method runs its surgical `ref<T[]>` array-update from the echoed entity. `createTransaction`'s cascade (`transactionsStore:355`) is unchanged in structure — each helper now awaits an atomic store method; celebrations stay on main.

### Task #5 — doc-lifecycle orchestrators

**5a. `docService.ts` slimmed — LAND LAST (after 5b–5e migrate every caller).** Retire `changeDoc`/`getDoc`/`loadDoc`/`mergeDoc`/`replaceDoc`/`initDoc`/`onDocPersistNeeded`/`saveDoc`. Keep + re-back: `isDocLoaded()` → `projection.isLoaded()`; `docVersion` → re-export `projection.docVersion`; `resetDoc()` → `docClient.reset()`. Add `projection.isLoaded()`: flips **true in `bumpDocVersion()`** (the single "final chunk applied" hook that `initDoc`/`initAndLoadCache`/`mergeRemoteEnvelope` all end with) and in `initDoc`'s push; **false in `resetProjection`**. Pinning it to `bumpDocVersion` (not `applyDelta`) guarantees a stray first `mutate` can't leave `loaded` false.

**5b. `fileSync.ts`.** `createBeanpodV4`/`reEncryptEnvelope` → main calls `docClient.exportEncryptedPayload()` and assembles the envelope; remove `saveDoc` import. `decryptBeanpodPayload` for the merge path moves into the worker (already in `docOps.decryptToDoc`); keep `parseBeanpodV4`/`tryUnwrapFamilyKey`/`unwrapWrappedKey` (pure, main-side) as-is.

**5c. `syncService.ts`.** `fetchAndMergeRemote`: fetch text → `parseBeanpodV4` → `docClient.mergeRemoteEnvelope(envelope, familyId)` → if `dirty` `triggerDebouncedSave()`; drop the `suppressAutoSave` bracket + `decryptBeanpodPayload` call. Route the `preserveLocalKeyDicts` envelope mutation (`:693`) through a `setEnvelope(...)` helper that also RPCs `docClient.persistEnvelope`. **Remove the entire `registerDocPersistCallback`/`onDocPersistNeeded` block (`:1047-1068`) — the worker owns cache persistence (debounced internally after every `mutate`/merge), so the main persist-callback disappears and the synchronous `isCacheReady()` guard at `:1052` is DELETED with it, not replaced** (main can't synchronously query worker cache state; no other consumer needs a main-visible readiness flag — if one surfaces, expose a `docClient`-cached boolean updated from `initAndLoadCache`, never a cross-thread sync call). `doSave` gets the payload via `docClient.exportEncryptedPayload()`. `triggerDebouncedSave` unchanged.

**5d. `syncStore.ts`.** Replace the import block (`replaceDoc`/`mergeDoc` + `initPersistenceDB`/`persistDoc`/`persistEnvelope`/`loadCachedDoc`/`loadCachedEnvelope`) with `docClient` calls. `replaceDocWithCacheRecovery` → `initAndLoadCache(familyId)` + `mergeRemoteEnvelope(remoteEnvelope, familyId)` + `deduplicateRecurringTransactions()` + (dirty ? `triggerDebouncedSave()`). The decrypt/background-recovery sites (`645/816/1393/1854/1943`) adopt the same envelope-based sequence. `loadFromPersistenceCache` → `initAndLoadCache`. `createNewFile` persist step → worker auto-persists after the mutations; explicit `persistDoc`/`persistEnvelope` become `docClient.exportEncryptedPayload` (for the file write) + `docClient.persistEnvelope` (cache). Every `currentEnvelope` write funnels through `setEnvelope`/`replaceEnvelope` (already centralized) → envelope-cache RPC.

**5d′. `services/indexeddb/database.ts` — the sign-out cache teardown (privacy-critical, do NOT omit).** `database.ts` is the third `persistenceService` importer (`:14`, `clearCache`/`closeCacheDB`), used by `deleteFamilyDatabase` (`:63`) and `closeDatabase` (`:55`) — the central sign-out / family-switch teardown called from `authStore:1088/1194`, `SettingsPage:539`, `familyContext:150`. Post-migration the only open cache connection lives in the worker, so `deleteFamilyDatabase` MUST route through `docClient.clearCache(familyId)` (worker close-then-delete) — else `indexedDB.deleteDatabase` on a now-null main connection fires `onblocked`, the handler `resolve()`s "successfully," and **the encrypted cache silently survives sign-out** (privacy break, Requirement #12). `closeDatabase` → the worker close path (`docClient.reset` already closes via `applyAndProject`, or a dedicated close RPC). Wiring only — `docClient.clearCache`/`applyAndProject.clearCache`/`cache.clearCache` already do close-then-delete. Land in Task #5, before the persistenceService deletion.

**5e. `authStore.ts` + `App.vue`.** `buildOwnerDoc`: `initDoc()`→`docClient.initDoc()`. `App.vue` Path 3: `getDoc()` probe → `projection.isLoaded()`; `initDoc()`→`docClient.initDoc()`; `__e2eSeedDoc` `loadDoc(binary)`→`docClient.loadSnapshot(binary)` (new RPC). Remove the `App.vue:111-117` photo registration (now static in the worker).

### Task #6 — inline fallback, lifecycle, dataBridge, flag

**6a. Inline fallback (`docClient.setInlineExecutor`).** Wire an executor that dispatches `method`→the matching `applyAndProject` function **on the main thread** (same module, imported on main), with a main-side sink: `pushChunk`→`projection.applyChunk`/`bumpDocVersion`, `perf`→`perfTiming.record`, `cachePersistFailed`→the durability-banner handler. `applyAndProject.configure(mainSink)` on init. `setCachePersistFailedHandler` wired to `syncService.setCachePersistFailed`. **Critical inline-realm init:** today `spawn()` re-posts the retained key via `postRaw` (worker-only) and runs the rehydrator via `request()` (worker-only) — so when `mode` flips to `'inline'` (spawn/handshake failure, forced-off flag, OR the mid-session fall-through in `onWorkerError`) the inline `applyAndProject` realm has never received `setKey` or a loaded doc → every crypto op throws `family key not set` and the app wedges despite a "working" fallback. So on entering inline mode, `docClient` MUST re-drive `inlineExecutor('setKey', {key})` from the retained `familyKey` and run the rehydrator through the inline path before resuming the queue — symmetric to the worker re-spawn path. (Note: the _first-unlock_ spawn-failure case is already covered by the normal `setFamilyKey → request → ensureReady → inlineRequest('setKey')` flow; the fix is needed only for the _mid-session fall-through_ in `onWorkerError` where the key was delivered to a now-dead worker — guard against double-posting `setKey` on the already-covered path.)

**6b. Worker-death re-hydration (`docClient.setRehydrator`).** Wire the rehydrator to `initAndLoadCache(familyId)` (re-hydrate from cache after respawn; key already re-posted by `docClient`). Acceptance tests: (1) force `terminate()` mid-session → re-hydrates from cache, in-flight RPCs reject; (2) force spawn failure **after unlock** → an inline `mutate` succeeds (asserts the inline realm got the key, not `family key not set`).

**6c. `dataBridge` synchronous snapshot.** Add `docClient.exportSnapshot()` (worker returns the raw `Automerge.save()` binary, unencrypted) and `docClient.loadSnapshot(binary)`. **Security: both worker handlers throw under `!import.meta.env.DEV`** — they return/accept plaintext doc bytes and are only driven by the DEV-gated `dataBridge`, so a prod guard closes the surface even though nothing calls them in prod. On `visibilitychange:hidden` (E2E-auth only) main pre-fetches + stashes the binary in a module var; the existing `beforeunload` handler writes the stashed binary to `sessionStorage` synchronously (no `await`). `App.vue` restore path uses `docClient.loadSnapshot(binary)`. Migrate `dataBridge`'s `exportData`/`seedData` `getDoc`/`changeDoc` to `projection`/`docClient`.

**6f. Production backgrounding cache-flush (restore the master-plan durability guard).** `docClient.flush()` is built (`docClient.ts:345`) but has no caller in this plan → the ≤120 ms debounce last-edit-loss window is wider than intended. Wire `visibilitychange:hidden` → `docClient.flush()` at App.vue's existing visibility save point (distinct from the E2E snapshot above; note App.vue's current `saveNow()` there is the _Drive_ upload, not the worker cache flush). This narrows the last-edit-loss window per the master plan's backgrounding-flush design.

**6d. `docWorker` kill-switch flag.** Register `docWorker` in `config/flagRegistry.ts` + `config/featureFlags.committed.ts` (auto-on dev, staged-off prod). `docClient` reads it at init: flag off → force `mode='inline'`. Log the mode + fallback rate.

**6e. `isDocLoaded` consumers + `vitest`.** Verify all ~14 `isDocLoaded()` consumers work against the re-backed `projection.isLoaded()`. Ensure `docClient` lazy-spawns (never `new Worker` at module scope) so existing tests importing the store/doc chain don't throw; inject fakes via `setWorkerFactory`/`setInlineExecutor` in tests. (Real-worker Playwright smoke + vite/CSP/precache validation are Task #7.)

## Files Affected

**Modified — Task #4:** `src/services/automerge/worker/{protocol,docOps}.ts` (op extensions, photo hooks, collect/attach), `src/services/automerge/automergeRepository.ts`, `src/services/automerge/repositories/{settings,recipe,medication}Repository.ts`, `src/services/photos/photoCollectionHooks.ts`, `src/stores/{familyStore,overlapAckStore,notificationsStore,photoStore,calendarSyncStore,transactionsStore}.ts`, `src/utils/loanPayment.ts` (ensure worker-safe — verified pure), and the associated `*.test.ts`.

**Modified — Task #5:** `src/services/automerge/docService.ts` (slim to `isDocLoaded`/`docVersion`/`resetDoc`), `src/services/automerge/projection.ts` (`isLoaded`), `src/services/automerge/worker/{applyAndProject,docClient,docWorker,protocol}.ts` (`loadSnapshot`, `exportSnapshot`, `collectReferencedPhotoIds`, `deletePhotoRecord` methods), `src/services/sync/{syncService,fileSync}.ts`, `src/stores/{syncStore,authStore}.ts`, `src/services/indexeddb/database.ts` (teardown → `docClient.clearCache`), `src/App.vue`.

**Modified — Task #6:** `src/services/automerge/worker/docClient.ts` (inline executor, rehydrator, flag, snapshot), `src/services/e2e/dataBridge.ts`, `src/pages/SettingsPage.vue` (export via `projection`), `src/config/{flagRegistry,featureFlags.committed}.ts`, `src/services/automerge/persistenceService.ts` (**delete last** — superseded by `worker/cache.ts`; the import removals in `syncService.ts:25-26` (`onDocPersistNeeded`, `persistDoc`/`persistEnvelope`/`isCacheReady`), `fileSync.ts:17` (`saveDoc`), and `database.ts:14` (`clearCache`/`closeCacheDB`) land in Task #5 BEFORE this deletion, else the build breaks; the `isCacheReady` guard is DELETED with the persist-callback block per 5c, not replaced).

**Also (Task #4/#5):** add `accountsStore.incrementBalance` + loan-balance method, `goalsStore.applyContribution`, `assetsStore` loan-balance method to `src/stores/{accounts,goals,assets}Store.ts`.

**New:** `src/services/automerge/worker/photoOps.ts` (owns `PhotoCollectionHooks`/`PhotoCollectHookError`/`flatHooks`/registry + avatar/vacation hooks; `photoStore`/`photoCollectionHooks` import from it).

**New tests:** extend `worker/__tests__/{docOps,applyAndProject,docClient}.test.ts` (the three named ops, `createIfMissing`, photo attach/collect parity); a worker-death recovery test; an inline-fallback parity test + inline-realm-got-the-key test.

## Acceptance Criteria

- [ ] No `Automerge.*` load/save/change/merge on the main-thread bundle (grep-verified; worker + inline-fallback-via-worker-module excepted).
- [ ] Every `changeDoc`/`getDoc`/`mergeDoc`/`replaceDoc`/`initDoc` call site migrated; `docService` exposes only `isDocLoaded`/`docVersion`/`resetDoc`.
- [ ] Data integrity: create/edit/delete across accounts/transactions/todos/activities/goals round-trips to `.beanpod` and reloads identically behind the flag.
- [ ] Atomic balance/goal/loan: a transaction added while a poll-merge lands a peer's change does not lose either write; goal `max(0,…)` floor + auto-complete preserved (`applyGoalContribution`); loan balance correct via the atomic `named` op.
- [ ] `notificationReads` per-key merge preserved (two devices marking different notifications read for one member both survive).
- [ ] Photo attach (finalize + link), avatar, replace, markDeleted, and GC all work; `gcOrphans` deletes nothing if any `collect` hook throws; Drive-delete-before-record-delete coupling preserved.
- [ ] Drive auto-save fires after a local edit and after a `dirty` poll-merge; a no-op/remote-ahead merge does not re-upload.
- [ ] Envelope-cache stays fresh: after a peer key-add/password-change, a cold start unlocks from cache (every `currentEnvelope` mutation RPC'd to the worker).
- [ ] Inline fallback: `docWorker` off (or forced spawn error) → app works end-to-end via inline `applyAndProject`, including AFTER unlock (inline realm received the key — no `family key not set` wedge); degradation logged.
- [ ] Worker bundle purity: the built worker chunk contains no `vue`/`pinia` (grep-verified) — `worker/photoOps.ts` didn't drag the main graph in.
- [ ] Worker mid-session death → re-hydrate from cache, no re-unlock, no data loss; in-flight RPCs reject + surface.
- [ ] E2E `dataBridge` UI-created data survives `page.goto()` reload (snapshot via `exportSnapshot`/`loadSnapshot`, no sync main-thread `saveDoc`).
- [ ] Sign-out / family-switch deletes the cache DB via `database.ts → docClient.clearCache` (worker close-then-delete); `indexedDB.databases()` no longer lists `beanies-automerge-{familyId}`; no cross-session projection bleed.
- [ ] Backgrounding flush: a local edit immediately followed by `visibilitychange:hidden` is persisted to cache (`docClient.flush()` wired; no lost last-edit inside the debounce window).
- [ ] `CorruptPayloadError` still surfaces with class + `phase`/`familyId`; expected decrypt failures stay quiet.
- [ ] Full unit suite green at each commit; type-check + lint clean.

## Testing Plan

1. **Per-step unit tests** (docOps op extensions, photo attach/collect parity, repository against projection+fake docClient, each migrated store).
2. **Inline parity test:** identical op sequence (create→patch→attachPhoto→merge→delete) through worker vs inline yields deep-equal materialized projection snapshots + identical `Object.values()` per collection.
3. **Integration:** create-family → add data → reload from cache → merge remote change, asserting IndexedDB export equality (ADR-007 data-not-DOM), worker active.
4. **Financial:** concurrent-merge lost-update tests for account/goal/loan; goal `max(0,…)` floor + auto-complete + transition-gated celebrate; loan amortization via the atomic `named` op (nested asset-loan + account-loan hosts).
5. **Lifecycle:** worker-death recovery; sign-out cache deletion; `isDocLoaded` consumers pre-load.
6. **Manual (fresh dev server, flag on):** cold start on desktop Chrome — shell interactive, no long task > ~200 ms while a large doc loads; create/edit/delete round-trips; flag-off → inline path still works. (Device + Playwright real-worker smoke = Task #7.)

## Review Passes

- **Pass 1 (Initial draft):** Drafted the #4–#6 cutover from the master plan + three Explore-agent inventories (mutation-closure→op map, sync-lifecycle sequences, read-side + financial ops); surfaced the goal-clamp/auto-complete, loan non-linear+nested, and `notificationReads` two-level-map refinements to the `increment` design; committed to the atomic-cutover-behind-flag rollout with the inline fallback as safety.
- **Pass 2 (DRY + error handling):** Routed atomic financial ops through the owning `ref<T[]>` stores (`accountsStore.incrementBalance`/`goalsStore.incrementProgress`/loan method) instead of `docClient.mutate` directly (else the UI arrays don't update); reused `goalsStore.updateGoal`'s completion+celebrate branch (dropped `maybeCompleteGoal`); committed loan option A with array-feedback; made the three guarded writers (overlapAck/notifications/normalizeRoles) `{quiet:true}` inside their own try/catch + keep `reportError` (no double-report / no warning→critical escalation); required the `named` attach handler to catch+log hook throws (never reject the batch / trigger Drive rollback) and keep `vacationSegmentEntityId` main-side; upgraded `docClient` projection-apply catches from `console.warn`→`reportError`; pinned the `persistenceService` deletion to land AFTER its Task-#5 import removals.
- **Pass 3 (Sustainability):** Consolidated the two domain read-modify-writes (goals, loans) as `named` worker ops and DELETED the `clampMin` flag from `increment` (now a plain counter with one consumer = account balance), adding a governing op rule (generic ops for structural writes; named ops for atomic domain RMW / nested walks); scoped the loan named op to the balance-host write only (returns `{host,interest,principal}`; transaction portions written via the existing `transactionRepo.updateTransaction` — removed the tri-store fan-out); pinned `docService` slim (5a) to land LAST after all callers migrate and clarified "green at each commit" = typecheck+units with fakes (app boots at #6); pinned `projection.isLoaded()` to flip in `bumpDocVersion`; named the worker photo module `worker/photoOps.ts` with a no-vue/pinia bundle-purity check (dependency inversion); closed the inline-realm re-init gap (re-drive `setKey`+rehydrate on entering inline mode, else `family key not set` wedge); de-duped the two open-coded background-merge blocks into a shared `hydrateFromEnvelope` helper.
- **Pass 4 (Fresh-eyes sweep):** Added the omitted `services/indexeddb/database.ts` teardown migration (`deleteFamilyDatabase → docClient.clearCache`) — a build-break AND a sign-out privacy regression (a main-thread delete on a null connection `onblocked`s and silently keeps the encrypted cache); deleted the `syncService` persist-callback block + its synchronous `isCacheReady()` guard outright (worker owns persistence) rather than "replacing" it; wired the dead-but-built `docClient.flush()` on `visibilitychange:hidden` to restore the master-plan backgrounding durability guard; DEV-gated the plaintext `exportSnapshot`/`loadSnapshot` worker handlers; pinned the photo-attach hook-throw handling to worker `console.warn` (the built `NamedOpHandler` has no log-sink); noted the inline `setKey` fix targets only the mid-session fall-through (avoid double-post) and that `applyGoalAllocation`'s stale-read clamp is a pre-existing Plan-B limitation, not a new regression. Confirmed the op/RPC contract, heads-`dirty`, chunk barrier, and key/envelope privacy all match the built modules.

## Prompt Log

> No GitHub issue created — direct implementation.

<details>
<summary>Full prompt history</summary>

### Initial (session)

"resume automerge worker migration" → completed Task #3b (worker crypto+cache, applyAndProject, real dispatch).

### Follow-up

"continue to task 4" → surfaced that Task #4 is the front half of an atomic cutover; asked scope; user chose **"Plan-doc first"** (write a detailed #4–#6 execution sub-plan to `docs/plans/` for review, execute next session, no code changes this block).

### Follow-up

"be sure to use /beanies-plan skill to use the 4-pass discipline" → this plan runs the mandatory 4-pass review.

</details>
