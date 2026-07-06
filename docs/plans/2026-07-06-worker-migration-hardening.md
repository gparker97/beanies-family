# Plan: ADR-032 worker-migration hardening — fix 10 verified code-review findings

> Date: 2026-07-06
> Related issues: None — direct implementation (branch `feat/automerge-web-worker`)
> Plan file (on approval): `docs/plans/2026-07-06-worker-migration-hardening.md`

## User Story

As a beanies family member syncing across devices, I want the worker data layer to handle concurrent-delete races, worker crashes, and no-op cascades without spurious errors, lost balance adjustments, silent cache failures, or stale timestamps — so my data stays correct and the app stays quiet when nothing is wrong.

## Context

Max-effort review of the ADR-032 worker migration surfaced 10 verified findings (F1-F10). This plan fixes all 10 before merge. Verified mechanisms:

- `docOps.mutateDraft` (docOps.ts:294): `patch` throws unless `createIfMissing` (:308); `increment` throws unconditionally (:323), stamps NO `updatedAt`; `patch` stamps `updatedAt` only if caller passes `op.updatedAt` (:314).
- `docOps.deltaFor` (:343): patch/increment `toPlain((after[collection])[id])` (:350) → bad `upsert` with `undefined` when id absent.
- Named ops (`applyGoalContribution`, loan ops via `writeLoanBalance`) ALREADY stamp `updatedAt` and ALREADY return `{applied:false, deltas:[]}` on missing host — so F3/F4 are scoped to the bare `increment` op + `automergeRepository.update`'s `patch` only.
- `docClient.onWorkerError` (:179) resolves every pending `ok:false`; `request()` (:306) → `surface()` (:336) = one critical toast per non-quiet failure. `surface()` ALREADY classifies expected-degradation by `instanceof CorruptPayloadError` (:338) and stays quiet — the extension point F5 reuses. Inline-mode `request()` returns before the surface block (:312) → inline failures never toast.
- `docClient.mutate` (:382) fires `localChangeHandler` unconditionally. `persistEnvelope` (:434) takes no opts (no `{quiet}`) so worker-mode persist failure already toasts critically.
- `initAndLoadCache` LOADS a cached doc; `cache.initPersistenceDB` opens without loading. `createNewFile` step5 (syncStore.ts:1283) uses `initAndLoadCache` (can install a stale doc over the fresh owner doc).
- `projection.ts` already keeps per-collection `shallowRef<Map>` (:21, private `mapFor` :40); `photoStore.photos` (:181) rebuilds a whole Record on every `docVersion` bump.
- `protocol.ts` `patch` op ALREADY carries `createIfMissing?` (:53); the typed-error registry `SerializedError.data` (:124) is documented as "extra allowlisted fields for typed errors" — a wire-transport concern, not a UI-dedup channel.

## Requirements

1. Patch/increment on concurrently-deleted entity = graceful no-op, no spurious critical toast (F2,F3). 2. `increment` advances `account.updatedAt` (F4). 3. `createNewFile` opens cache WITHOUT loading a stale doc (F1). 4. One crash → ≤1 toast (F5). 5. delete-then-patch/increment batch doesn't emit bad `upsert` (F6). 6. No silent failures: envelope-cache failures classified+logged, not double-toasted; no bare `.catch(()=>{})`; no inline-mode-silent `void mutate`; concurrent-delete skips leave a breadcrumb, never a silent success (F7,F8). 7. No-op mutation → no Drive save + no cache persist (F10). 8. `photos` doesn't re-materialize on unrelated bumps (F9). 9. Genuine inconsistencies surfaced. 10. Suite green.

## Important Notes & Caveats

### F2/F3/F4 — atomic-op missing-entity behavior (single `onMissing` field, not stacked booleans)

- The `patch` op today branches on `createIfMissing?` (throw vs create). F2/F3 add a THIRD behavior (skip). Rather than add a second boolean (`skipIfMissing`) — which introduces the invalid `{createIfMissing:true, skipIfMissing:true}` state with undefined precedence — **collapse the missing-entity behavior into one tri-state discriminant**:
  - `patch`: `onMissing?: 'throw' | 'create' | 'skip'` (default `'throw'`, preserving current behavior).
  - `increment`: `onMissing?: 'throw' | 'skip'` (default `'throw'`; `'create'` is nonsensical for a numeric bump).
  - Illegal states unrepresentable; one `switch(onMissing)` in `mutateDraft`'s missing branch; self-documenting call sites.
- Migrate the one existing `createIfMissing:true` caller (the two-level `notificationReads[memberId]` sub-map path) to `onMissing:'create'`. Grep-confirmed sole consumer; no external contract.
- `automergeRepository.update` (:86) already existence-checks the projection up front (:89 → returns `undefined`). The residual gap is a TOCTOU race → worker `patch` throws → critical toast for a benign concurrent delete. Pass `onMissing:'skip'` so ONLY the missing-entity case becomes a no-op; every other patch error still throws+toasts (precision over a blanket `{quiet:true}`, which would swallow genuine errors).
- **Consistency (req 6/9):** both concurrent-delete skip paths leave the SAME breadcrumb — neither is a silent success:
  - `accountsStore.incrementBalance`: on skip `mutate` echoes `undefined`; existing `accounts.value.map(...updated)` (:205) would splice `undefined` — guard `if (!updated)` BEFORE the map → `reportError` warning breadcrumb (no toast) + `return null`.
  - `automergeRepository.update`: on the TOCTOU skip the echoed `result` is `undefined` → existing `result ? transform : undefined` (:110) already returns `undefined`; ADD a `reportError` warning breadcrumb on that `undefined` branch (no toast) so a worker/projection divergence is observable, matching `incrementBalance`.

### F6 — `deltaFor` undefined guard (prerequisite for the skip path)

- `deltaFor` (:343) does `toPlain((after[collection])[id])`. When the entity is absent (delete-then-patch batch OR a skipped op) it emits an `upsert` with `entity:undefined`. Guard: if the post-change entity is absent, emit `remove` (syncs the projection to reality) instead of `toPlain(undefined)`. Land with F2/F3.

### F5 — one crash → ≤1 toast (reuse the `instanceof`-classify idiom; do NOT overload `SerializedError.data`)

- Root cause: `onWorkerError` (:179) resolves EVERY pending `ok:false`; each awaiting `request()` calls `surface()` → N toasts.
- **Do not** smuggle a UI-dedup boolean into `SerializedError.data` (that's the wire allowlist for typed-error reconstruction). **Reuse the pattern already in `surface()`**: add `WorkerCrashError extends DocWorkerError`, register it in the existing `ERROR_REGISTRY` (the intended extension point — one-line codec add):
  - `onWorkerError` shows exactly ONE toast, then resolves every pending with `error:{ name:'WorkerCrashError', message }`.
  - `request()` reconstructs it via the registry; `surface()`'s `expected` check gains `|| error instanceof WorkerCrashError` → stays quiet.
  - One toast at the crash site, zero per-request re-toasts, no new wire fields.

### F7 — envelope-cache persist (shared safe helper, no bare catches)

- Add `{quiet}` to `persistEnvelope` (docClient). Introduce ONE shared `persistEnvelopeSafely(envelope)` used by both `setFamilyKey` (syncService:339) and `setEnvelope` (:372): calls `persistEnvelope(envelope, {quiet:true})` and, on rejection, a `reportError` warning breadcrumb. Delete BOTH bare `.catch(()=>{})`.

### F8 — no inline-silent fire-and-forget mutate

- Add `fireAndForgetMutate(op) = mutate(op).catch(e => reportError({surface:'doc-mutate-fire-forget', severity:'error', error:e}))` (must `reportError` itself — inline mode never reaches `surface()`). Route the only two `void mutate(` sites — `photoStore.markDeleted` (:789) and `linkPhotoToEntity` (:919) — through it. Grep-confirmed only two.

### F10 — no-op mutation → no save/persist (single field; emergent skip reuse)

- Add `changed?: boolean` to `RpcOk` (mutate-only). `applyAndProject.mutate` computes `changed = !headsEqual(before, after)` (Automerge records no change for a genuine no-op) and skips `schedulePersist()` when unchanged; `dispatch` + `docWorker` + inline forward it. `docClient` reads it via a thin `requestMutate` returning `{result, changed}` (generic `request` returns only `result`) and fires `localChangeHandler` ONLY when `changed`.
- **Emergent simplification:** a concurrent-delete SKIP (F2/F3), and a named-op early-return (loan not applied), produce an EMPTY `Automerge.change` → the same doc object → heads unchanged → `changed:false` → no save/persist/`localChangeHandler` automatically. F10 subsumes skip-suppression; the skip's only signal is the F2/F3 breadcrumb.
- **⚠️ F10 test guard (Automerge semantics, verified):** a same-value `patch` (setting a field to its current value) still records a `put` and DOES advance heads → `changed:true` → a harmless extra save. That is NOT a no-op and MUST NOT be asserted as heads-unchanged. The only reliable no-op signal F10 relies on is the skipped/empty-change path. Write the F10 tests against a skipped op, not a same-value write. Thread `changed?` through `RpcOk`, the `InlineExecutor` return type, `dispatch`'s return type, the `docWorker` post, and `inlineRequest`.

### F1 — open cache WITHOUT loading (a separate named method, not a boolean toggle)

- Add `applyAndProject.openCache(id)` = `cache.initPersistenceDB` only (no `loadCachedDoc`) + a `dispatch` case + `docClient.openCache(familyId)` (sets `currentFamilyId` for rehydration). Prefer a distinct named method over a `{load:boolean}` toggle on `initAndLoadCache` — the name documents intent and there's no shared load/corrupt-clear branch to duplicate. `createNewFile` step5 → `openCache`; fix the "(no cached doc yet)" comment. Leave load/resume callers (`syncStore.ts:551,:976`, `bootstrap.ts:21` rehydrator) on `initAndLoadCache`.

### F9 — photos stable across unrelated bumps

- Export `collectionRef(collection)` from `projection.ts` (a thin public wrapper over the private `mapFor` — reuses the existing per-collection `shallowRef`, no new state). ONLY the `photos` computed (`photoStore.ts:181`) switches to `collectionRef('photos').value` instead of `docVersion.value`, so it re-materializes only when the photos map changes. Keep the `Record` output shape (consumers use `photos.value[id]`). **`photoIdsFor` (`photoStore.ts:901`) reads ARBITRARY collections via `projectionGetById` and MUST stay on `docVersion`** — do not touch it.

- Do NOT change `.beanpod` V4 / encryption / envelope semantics.

## Assumptions

1. `onMissing:'skip'` (no-op returning a distinguishable `undefined`) is acceptable for the `update`/`increment` contract under the atomic race. 2. Adding optional `MutationOp` fields + `RpcOk.changed` is backward-compat (inline+worker share `docOps`/`dispatch`). 3. F4 uses caller-supplied `updatedAt`. 4. F9 hot-path cost is real per PERFORMANCE.md. 5. Nothing relies on N-toasts-on-crash, on `deltaFor` throwing, or on a no-op mutation triggering a save. 6. `notificationReads` is the only `createIfMissing` consumer (grep-confirmed).

## Approach (5 tested commits)

- **A — atomic-op & repo (F2,F3,F4,F6):** protocol `patch.onMissing?:'throw'|'create'|'skip'` + `increment.onMissing?:'throw'|'skip'` + `increment.updatedAt?`; migrate the one `createIfMissing` caller → `onMissing:'create'`; `mutateDraft` single `switch(onMissing)`, `increment` stamps `updatedAt`; `deltaFor` absent→`remove` guard; `automergeRepository.update` `onMissing:'skip'` + breadcrumb on `undefined`; `incrementBalance` `onMissing:'skip'` + `updatedAt` + `if(!updated)` guard/breadcrumb; named-op verify-only regression test.
- **B — crash dedup (F5):** `WorkerCrashError` + registry codec; `onWorkerError` one toast + resolves pending as `WorkerCrashError`; `surface()` treats it expected (quiet).
- **C — open-without-load (F1):** `applyAndProject.openCache` + dispatch + `docClient.openCache`; `createNewFile` step5 → `openCache`; fix comment.
- **D — no-op save skip (F10):** `RpcOk.changed` threaded; `requestMutate` returns `{result,changed}`; `docClient.mutate` conditional handler; worker skips `schedulePersist` on no-op.
- **E — silent-failure+perf (F7,F8,F9):** `persistEnvelopeSafely`; `fireAndForgetMutate`; `collectionRef` for photos.

## Files Affected

`protocol.ts`, `docOps.ts`, `applyAndProject.ts`, `docWorker.ts`, `docClient.ts`, `projection.ts`, `automergeRepository.ts`, `accountsStore.ts`, `photoStore.ts`, `syncStore.ts`, `syncService.ts`, the one `createIfMissing` caller (notificationReads path — likely `notificationsStore.ts`) + matching tests.

## Acceptance Criteria

- [ ] Concurrent-delete no-op + breadcrumb on BOTH `incrementBalance` and `update` TOCTOU paths (no toast); `update` returns `undefined`.
- [ ] `increment` advances `updatedAt`; named cascades verified still stamped (regression test).
- [ ] `onMissing` tri-state covers throw/create/skip; no invalid-combination path; the one `createIfMissing` caller migrated.
- [ ] `createNewFile` opens cache without installing a stale doc; comment fixed.
- [ ] One crash → exactly one toast (`WorkerCrashError` classified quiet); all pending still rejected.
- [ ] Delete-then-patch/increment batch emits `remove`, not a bad `upsert`.
- [ ] No bare `.catch(()=>{})`; envelope-persist failure logged once (warning), not double-toasted; no inline-mode-silent `void mutate`.
- [ ] A no-op mutation (incl. a skipped op) triggers no Drive save, no cache persist, no `localChangeHandler`.
- [ ] `photos` recomputes only on a photos delta (stable across unrelated bumps).
- [ ] Suite + type-check + lint green.

## Testing Plan

- `docOps`: `onMissing` throw/create/skip (patch) + throw/skip (increment); `increment` `updatedAt` stamping; `deltaFor` `remove`-on-absent; delete-then-patch batch.
- `automergeRepository`: concurrent-delete update → `undefined` + breadcrumb.
- `accountsStore`: `incrementBalance` skip → `null` + breadcrumb + array untouched; success stamps `updatedAt`.
- named-op regression: goal/loan cascades stamp `updatedAt` and no-op on missing host.
- `docClient`: crash → single toast + all pending rejected (`WorkerCrashError` quiet); no-op mutate → no `localChangeHandler`; `openCache` sets `currentFamilyId` without loading.
- `applyAndProject`: `openCache` opens DB without installing a doc; `mutate` skips persist when `changed===false`.
- `syncService`: envelope-persist failure → warning breadcrumb, no critical toast, `{quiet}` passed.
- `photoStore`: `markDeleted`/`linkPhotoToEntity` failure → `reportError` (worker + inline); `photos` stable identity across a non-photos delta.
- Full suite + type-check + lint.

## Review Passes

- **Pass 1 (Initial draft):** Grouped the 10 findings into 5 tested commits.
- **Pass 2 (DRY + error handling, source-verified):** Narrowed F3/F4 scope (named ops already stamp `updatedAt` + no-op on missing host); `incrementBalance` map guard; F7 `{quiet}`; F8 inline `reportError`; F9 `collectionRef` reuse; F10 real `RpcOk.changed`; F5 flag mechanism.
- **Pass 3 (Sustainability):** Collapsed stacked `createIfMissing`+`skipIfMissing` booleans → one `onMissing` tri-state (illegal states unrepresentable; migrate the one `createIfMissing` caller); reworked F5 to reuse the existing `instanceof`-classify + `ERROR_REGISTRY` idiom (`WorkerCrashError`) instead of overloading `SerializedError.data`; made both concurrent-delete skip paths breadcrumb consistently (no silent `update` TOCTOU); confirmed F1's separate-named-method and F9's `collectionRef` avoid behavior-toggling boolean params; noted F10 subsumes skip-suppression.
- **Pass 4 (Fresh-eyes sweep):** Validated all 5 self-introduced-risk points against source — (a) `notificationsStore.ts:212` is the sole `createIfMissing` caller, already `{quiet}` + own try/catch → `onMissing:'create'` is behavior-identical; (b) `deltaFor`'s absent→`remove` branch is unreachable for a live entity (only a skipped/deleted target); (c) corrected F10 — a same-value patch DOES advance heads (harmless save, not a no-op); the no-op signal is the skipped/empty-change path only, tests must not assert otherwise; (d) `surface()` returns the error even when quiet → awaiting callers still reject on a crash; (e) only `photos` moves to `collectionRef('photos')`, `photoIdsFor` stays on `docVersion`. Made F10 wire-plumbing explicit.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial

"let's do ii run the full set through /beanies-plan and fix" — following a max-effort code review producing 10 verified findings (F1–F10) across the ADR-032 worker migration.

</details>
