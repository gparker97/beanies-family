# Plan: Compaction-primary data layer — retire the change-chunks, compact the cache

> Date: 2026-07-15
> Related issues: Tracker #43 (owns this; retitled "Data loads slowly (10-30s) on login & refresh — store the family data more efficiently (compaction), all devices"). Supersedes/closes #44 (dual-publish base-write retirement — INVERTED by telemetry) and #46 (bound Drive chunk growth — moot once chunks are gone).
> Plan file: `docs/plans/2026-07-15-compaction-primary-retire-change-chunks.md`
> Investigation: `docs/investigations/2026-07-15-cold-load-perf-regression.md` (primary evidence — read alongside)
> No GitHub issue — tracker-only.

## User Story

As a family member opening beanies.family on any device (iPhone/Android app, PWA, or desktop web), I want my data to load in ~1-2 seconds on login and hard-refresh — like it used to — so that I'm not staring at a 10-30 second spinner or placeholder blocks, and my Google Drive isn't filling up with ever-multiplying "change" files.

## Context

### The regression, confirmed from prod telemetry

After the incremental delta-sync (ADR-032 Plan B / #42) shipped 2026-07-07, cold data loading regressed badly. Confirmed from CloudWatch (greg's family `…fa046620`, `/aws/lambda/beanies-family-telemetry-prod`, `load-perf` surface, 3 days):

| Operation              | Meaning                                                 | p50           | p95            |
| ---------------------- | ------------------------------------------------------- | ------------- | -------------- |
| `automerge.cacheLoad`  | **hard-refresh** — rebuild doc from IndexedDB           | **20,971 ms** | **147,101 ms** |
| `automerge.remoteLoad` | **login** — `Automerge.load(base)` from Drive (2861 KB) | 2,236 ms      | 7,244 ms       |

**Two independent problems, both traced to the "change file" approach:**

1. **Local cache increment replay (the dominant cost).** Hard-refresh takes the cache-first path → `initAndLoadCache` → `cache.loadCachedDoc`, which loads the base **plus replays every accumulated encrypted increment** (`cache.ts:143-201`). Increments are only dropped when they cross **`INCREMENT_COMPACTION_THRESHOLD = 200`** (`applyAndProject.ts:70`). Replaying ~200 encrypted deltas on a 2.8 MB doc on iPhone JSC is the ~19 s over the 2.2 s base-load floor. `remoteLoad` (a plain `Automerge.load` of the compacted base) proves size is NOT the driver.

2. **Drive change-chunks are net-negative.** `doSave` writes the whole compacted base (`syncService.ts:911`) and THEN appends a delta chunk (`publishIncremental`, `syncService.ts:919`). But the delta path fails and falls back to a whole-doc reconcile constantly: **446 `pull-fallback` vs 254 `pull-applied` in 3 days; 2,793 base-adopts vs 1 delta-apply fleet-wide** since docWorker prod-on. Chunks accumulate unbounded (`pruneOwnChunks` only prunes this device's own actorId, which rotates per session — #46). So the chunks add a failed-delta-then-full-reconcile tax + Drive-folder bloat while saving essentially nothing.

### The decision (greg-approved): pivot to compaction-primary, retire the change-chunks

Compaction is not lossy — `Automerge.save(doc)` serializes the full document (state + the history needed for merges) into one compact binary; increments/chunks are redundant deltas since the last snapshot. Store the same data more efficiently as a single compacted base; drop the parallel change-file layer.

### The load-bearing safety fact

**`doSave` writes the full compacted base on EVERY save (`syncService.ts:911`), from every build, and #44 (which would have retired that base write) NEVER SHIPPED.** Therefore the base `.beanpod` is always the complete, authoritative, current copy of the family's data — the chunks are pure redundant acceleration. This is what makes retiring them safe even in a mixed-version fleet: no reader can miss another device's edits by ignoring chunks, because those edits are already in the base every reader fetches.

## Requirements

1. **Cut hard-refresh cold-load from ~21 s toward the ~2 s base floor** by aggressively compacting the local IndexedDB cache so `cacheLoad` replays few increments.
2. **Stop producing Drive change-chunk files** — every save writes only the compacted base `.beanpod`; no new `changes/` chunk files are appended.
3. **Stop the change-chunk read/thrash** — no more `pull-fallback` churn.
4. **Lose no data and preserve cross-device convergence** in a mixed-version fleet during and after rollout (older builds + the 0.9.5R7 Android closed-testing build still write chunks for a while).
5. **Clean up residue** — existing `changes/` chunk files should stop accumulating and ideally be tidied (best-effort, non-blocking).
6. **Preserve**: `.beanpod` V4 file compatibility, no re-login, the whole-doc path as the recovery sink, and the docWorker kill-switch's _execution-model_ fallback (inline realm still loads correctly from the authoritative base — the switch is NOT a rollback for this change's threshold/compaction/chunk-retirement; see Rollout).
7. **Verify against live telemetry** (no new context keys expected): `automerge.cacheLoad` p50 → ~2 s; `incremental-sync` `pull-fallback` → ~0; `doc-worker-recovery` / `app.postInitNoData` counts drop.

## Important Notes & Caveats

- **The base is authoritative — this is the whole safety argument.** Do NOT combine this with retiring the every-save base write (#44's inverted, now-dead direction). The base write at `syncService.ts:911` STAYS. If a future change ever wants to reduce base-write frequency (bandwidth), that is a separate, later decision with its own safety analysis — not this plan.
- **Mixed-fleet convergence, both directions** (must hold with chunks off on new builds, on on old builds):
  - Old build writes base + chunk; new build reads the base → gets the old device's edits ✓ (ignores chunks, harmless).
  - New build writes base only; old build reads base + its own residual chunks → gets the new device's edits via the base ✓.
  - Convergence rides the base in BOTH directions because every build writes a complete base every save.
- **Do NOT reintroduce chunk-name reuse.** If the `incrementalTransport` module is kept (deprecated) rather than deleted, its `chunkName` (`<actorId>-<seq>`) invariants must not be disturbed. Prefer stopping the CALL SITES over half-editing the module.
- **Local cache threshold is a load-vs-write tradeoff.** Lowering `INCREMENT_COMPACTION_THRESHOLD` (200 → ~50) makes `cacheLoad` fast (fewer increments to replay) at the cost of ~(200/N)× more local whole-doc base rewrites to IndexedDB (`writeBase`, a full `saveDoc` + encrypt + IDB put). **~50 is the chosen default** (see Part A for the write-amplification math — N≈50 cuts cold-load ~4× at half the write-amplification of 25); pin the exact value against `automerge.saveBase` / `automerge.cacheLoad` timings — it must not turn a fast load into a slow-save regression. The local base rewrite already runs behind the single-flight persist chain (`applyAndProject.ts:88`), debounced off the RPC path.
- **`fetchAndMergeRemote` runs inside `doSave`** (`syncService.ts:893`) and is where `pullIncremental` reads chunks. Removing the chunk read must not remove the base fetch-merge (the overwrite-prevention read of `currentProvider.read()` at `:825`) — only the chunk-specific `pullIncremental` portion goes.
- **Residue cleanup is best-effort and must never block or fail a save/load** — a Drive `files.list`/delete failure is swallowed + logged, never surfaced as a data error.
- **Interaction with R7 provider-config resilience** (`attemptSilentConfigHeal`): the heal re-derives the provider and hands off to `backgroundSyncFromFile` → load. That path reads the base; it never depended on chunks, so it is unaffected. Verify no code path assumes a `changes/` folder exists.
- **docWorker kill-switch:** flipping `docWorker` off must still work after this change (it reverts to inline main-thread Automerge, which also reads the base). Confirm the inline path has no chunk dependency introduced/left dangling.

## Assumptions

> Review before implementation (valid 2026-07-15).

1. `doSave` writes the full compacted base on every save (`syncService.ts:911`) and #44 has NOT shipped — so the base is always authoritative and complete. (Verify at implementation time — this is the safety keystone.)
2. `INCREMENT_COMPACTION_THRESHOLD = 200` at `applyAndProject.ts:70` is the sole lever controlling how many local increments `cacheLoad` replays. (Verify `loadCachedDoc` replays all `inc:*` rows.)
3. The Drive change-chunk write is the single `publishIncremental` call at `syncService.ts:919`, and the read is `pullIncremental` inside `fetchAndMergeRemote`. (Verify these are the only call sites.)
4. Every current/older client that touches a family's file also writes the base every save (dual-publish), so no client relies on chunks as a sole durable home. (True unless #44 shipped — it did not.)
5. The `incremental-sync` telemetry surface will show `pull-fallback` fall to ~0 once the read is removed, and `automerge.cacheLoad` p50 will fall once the threshold drops — the existing instrumentation is sufficient to verify blind.

## Approach

Three coordinated changes, smallest-blast-radius first. Everything lives in the shared worker/sync code (no platform fork).

### Part A — Aggressive local-cache compaction (the dominant win)

1. **Lower the threshold — pin N by measurement, comment the amplification.** `INCREMENT_COMPACTION_THRESHOLD` (`applyAndProject.ts:70`) from **200 → N** where N is pinned against measured `saveBase`/`cacheLoad` timings. Lowering 200→N multiplies full-doc base rewrites by ~(200/N): at N=25 that is ~8× more `saveBase` (encrypt + IDB-put of a ~2 MB doc) cycles during active editing — real CPU/battery cost on the mobile devices this targets. **N≈50 halves the write-amplification vs 25 while still cutting cold-load ~4×** — a better default; go lower only if measurement shows `saveBase` stays well off the critical path. Add a code comment at the constant recording the amplification math (so it isn't lowered further blind) and noting the mitigation: the 120 ms `PERSIST_DEBOUNCE_MS` + single-flight `persistInFlight` chain already coalesces mutation bursts into one increment, capping the worst case. One-constant change behind the existing, tested `persistOnce`/`writeBase` path. No new mechanism.
2. **Compact on load if over-threshold (REQUIRED — closes a real gap), DEBOUNCED so it yields to the cold-load projection.** `persistOnce`'s re-compaction only fires inside the _increment_ branch (`applyAndProject.ts:191`), which only runs on a `mutate` (`:350`). So a device already sitting at ~200 increments that ships the lower threshold would **still replay all ~200 on every hard-refresh until the user happens to make an edit** — defeating Requirement 1 for read-heavy sessions and for every already-deployed device's first post-update load. Fix: in `initAndLoadCache` (`:296-328`), place the check in the **`else` (non-recovered) branch** (`:315-322`) — the `recovered:true` branch already sets `lastPersistedHeads=null` + `enqueuePersist()`, so an unconditional post-install check would double-schedule. In the non-recovered branch, if `cache.incrementCount() > INCREMENT_COMPACTION_THRESHOLD`, trigger a one-time compaction by setting `lastPersistedHeads = null` and calling **`schedulePersist()`** (the 120 ms-debounced path) — NOT the immediate `enqueuePersist()` that the recovered-path uses. Rationale: this compaction runs on every already-deployed device's first cold load, exactly when the worker's single thread is busy pushing the cold-load projection to main; a 2 MB `saveDoc`+encrypt competing with that would slow the very load we're optimizing. The debounced path runs the fresh-base rewrite _after_ the projection push. (The recovered-path uses immediate `enqueuePersist` because dropping corrupt rows ASAP matters there; over-threshold compaction is not urgent.) Reuse of the tested base-write path — no new mechanism; this makes fast loads _stick_ and self-heals deployed devices.
3. **No new failure path.** `persistOnce` already surfaces every write failure (durability banner + `cachePersistFailed` signal + `console.error` + `saveBase`/`saveIncremental` telemetry, `applyAndProject.ts:197-207`) and re-captures the delta next tick (`lastPersistedHeads` not advanced on failure), all behind the single-flight `persistInFlight` chain (`:88`, `:123`) detached from any RPC. Lowering the constant + the load-time compaction add background `saveBase` CPU only — they cannot silently drop data and cannot slow a `mutate` response. Watch `automerge.saveBase` p95 for a save-side regression.

### Part B — Retire the Drive change-chunks (stop writing + reading)

1. **Stop writing chunks:** remove the `publishIncremental(...)` call at `syncService.ts:919` (the base write above it stays). New saves produce no `changes/` files.
2. **Stop reading chunks:** remove the `pullIncremental` block at `syncService.ts:802-812` (inside `fetchAndMergeRemote`), keeping the `currentProvider.read()` overwrite-prevention path (`:825`) + `mergeRemoteEnvelope` (`:834`). Eliminates the 446-fallback thrash. Safe because the base fetched there already carries every device's edits.
3. **Delete the whole orphaned vertical slice in one pass (DECIDED — no deprecation-in-place).** An unused-but-live slice is exactly the orphan a future maintainer trips over, so deprecation is not an option. Once both call sites are gone, `transportDeps` (`syncService.ts:93-98`) is the ONLY production caller of the worker RPCs `applyRemoteChunks` / `exportIncrementalPayload` / `getActorId`, which drag along `remoteChunkDecrypt`/chunk-`saveIncremental` handlers (`applyAndProject.ts:429-516`), their `docClient.ts` wrappers + method allowlists (`:364-396`, `:693-727`), and `encryptChunk`/`decryptChunk` in `docOps` (used only there). **Audit first (per-RPC, the facts differ):** `getActorId` is chunk-only → delete it (no test consumer). `getHeads` (RPC) has no _production_ consumer once `transportDeps` goes, but it is the read-RPC probe `docClient.test.ts` drives its worker-death/recovery suite with (~40 assertions) → **keep it, labelled test-harness-only** so it isn't mistaken for a live prod caller. `getChangesSince` (the **RPC**) is already prod-orphaned AND has no test-harness consumer (tests use the `docOps` helper, not the RPC) → delete the RPC wrapper + dispatch + its `HEAVY_METHODS`/`RETRYABLE_METHODS` entries, AND update the `JSON_SAFE_METHODS` comment at `docClient.ts:342-344` that names it. **CRITICAL: the `docOps.getChangesSince` HELPER stays** — it is used by `persistOnce` (`applyAndProject.ts:178`); only the worker RPC of the same name goes. The DEV/E2E `applyChanges` path STAYS. Then delete: `incrementalTransport.ts`, the `transportDeps`/`transportSession`/`resetTransportSession` wiring + its call (`syncService.ts:412`), the now-orphaned `activeAuxStore()` helper (`:103-106`) + the `isFlagEnabled` import (`:31`, whose sole use is `activeAuxStore`), the chunk-specific worker RPCs + their `docClient` wrappers/allowlist entries + `encryptChunk`/`decryptChunk`, and the co-located ADR-032 "Plan B" comments (`:796-801`, `:914-917`) with their call sites. **If the audit surfaces an unexpected consumer that blocks a clean delete, STOP and file a tracked follow-up — do NOT silently leave the slice deprecated.** Keep the whole-doc merge (`mergeRemoteEnvelope`) — it is the recovery sink and the primary path now.
4. **Best-effort residue cleanup (reuse, ungated, fire-and-forget):** there is no "delete folder" primitive — cleanup lists via `AuxStore.list()` + per-name `AuxStore.delete()` (`storageProvider.ts:77-96`) filtered by **`isChunkName`** (`incrementalTransport.ts:62`). So:
   - **Reuse, don't re-implement:** get the handle via `getAuxStore(currentProvider)` (keep the `getAuxStore` import, `syncService.ts:23`) and reuse `isChunkName`/`CHANGES_PREFIX`/`CHANGES_SUFFIX` for the filter — if the module is deleted (3a), **relocate** these to a small shared util, never hand-roll a second predicate.
   - **Ungated by the `docWorker` flag:** use `getAuxStore(currentProvider)` DIRECTLY, not the flag-gated `activeAuxStore()` (which returns `null` when docWorker is off, `:103-106`) — `changes/` files exist regardless of the kill-switch and must be tidied even after a rollback to inline mode.
   - **ONE trigger site — name the exact seam.** Drive is the only provider with chunk residue, and the Drive read/merge for a session runs through `fetchAndMergeRemote` (`syncService.ts:893`, inside `doSave`) — so fire the detached cleanup (`void cleanup().catch(…)`) from the FIRST `fetchAndMergeRemote` of the session (guarded by the once-per-family Set), NOT from `initAndLoadCache` (that's the worker realm, no Drive handle) and NOT after every `write` (a needless save-path hop). A pure read-only session that never saves simply cleans up next time it does — acceptable for best-effort residue removal (no data risk; the chunks are inert once new writes stop).
   - **Claim the slot + capture the handle SYNCHRONOUSLY (concurrency + family-switch safety):** `if (guard.has(id)) return; guard.add(id); const aux = getAuxStore(currentProvider);` — all before the first `await`, so two near-simultaneous loads can't double-list and a mid-cleanup family switch can't retarget the handle.
   - **Teardown:** the `Set<familyId>` guard means once-per-_session_, so do NOT clear it on `reset()`/family-switch/sign-out (clearing it would turn every family switch back into a cleanup storm). State this explicitly so a maintainer doesn't wire it into teardown.
   - **Never surfaces a data error:** swallow + `console.warn` (developer-actionable: "non-fatal; base is authoritative; residue retried next session") + a queryable breadcrumb (see Observability).
   - **This cleanup is itself a TEMPORARY migration — give it an explicit death.** Add a code comment + a tracked follow-up (new tracker issue): "Remove `chunk-residue-cleanup` + the relocated `isChunkName`/`CHANGES_*` util once the `chunk-residue-cleanup` `action:'deleted'` breadcrumb has fallen to ~0 across the fleet for one full rollout cycle." Otherwise the residue scanner + the shared name-format util (its only remaining consumer) live forever, scanning for a format nobody remembers.

### Part C — Drive base stays the compaction (already true)

No new cadence needed: `doSave` already rewrites the full compacted base every save, so `remoteLoad` stays ~2 s as history grows (history-replay is not the driver — `remoteLoad` is 2.2 s for the 2.8 MB base). Explicitly NOT reducing base-write frequency in this plan (that is #44's dead direction). If bandwidth of the every-save base write becomes a concern later, a base-write coalescer is a separate follow-up.

### Part D — Guard the base-authoritative invariant durably (code + ADR)

The entire safety of retiring chunks rests on "every save writes the full base; every merge reads it." That must be guarded where a future maintainer will actually look — not just in this (ephemeral) plan:

1. **In-code invariant comments** at the base write (`syncService.ts:911`) and the base fetch-merge (`:825/:834`): _"INVARIANT (ADR-032 addendum): every save writes the FULL compacted base, and every remote merge reads it. Delta-sync / change-chunks were retired on the strength of this. Do NOT coalesce, skip, or reduce the frequency of this base write without first re-introducing a delta mechanism AND re-deriving the convergence argument — otherwise a peer can silently miss another device's edits."_
2. **A unit test that asserts the base write is UNCONDITIONAL** (a future refactor that makes it conditional must fail a test), per Acceptance Criteria.
3. **ADR-032 addendum (a real record, dated, not a one-liner)** stating concretely: (a) the telemetry that killed delta-sync (446 `pull-fallback` vs 254 `pull-applied`; 2,793 base-adopts vs 1 delta-apply fleet-wide; `cacheLoad` p50 21 s); (b) the base-authoritative invariant that makes chunks redundant; (c) **"do not re-introduce a delta/change-chunk layer without first proving the every-save base write is the bottleneck AND re-deriving the convergence argument"**; (d) that #44's "reduce base-write frequency" is now a DEAD direction (inverted by telemetry) — so it isn't resurrected as an obvious win.

### Rollout

Ship behind the normal release. **The docWorker kill-switch is NOT a rollback for this change.** The lowered threshold + compaction-on-load live in `applyAndProject.ts`, which the inline (switch-off) realm SHARES (`:72` "one instance per realm — worker OR inline main"), so flipping the switch still runs them; and the chunk code is DELETED, not flag-gated, so the switch can't restore it (nor should it — it was net-negative). The switch only preserves the execution-model fallback (inline still loads correctly from the authoritative base — the invariant Requirement 6 protects). **The rollback lever for the threshold / compaction-on-load / chunk-retirement is git-revert + redeploy** — state this so an operator reaching for the switch under a compaction regression isn't misled. The change is safe in a mixed fleet by the base-authoritative argument regardless. After deploy, watch the telemetry checklist.

## Files Affected

- `src/services/automerge/worker/applyAndProject.ts` — lower `INCREMENT_COMPACTION_THRESHOLD` (`:70`) + a code comment recording the write-amplification math (see Part A); add the over-threshold compaction-on-load in `initAndLoadCache` (debounced `schedulePersist`, not `enqueuePersist`); remove the `applyRemoteChunks`/`exportIncrementalPayload`/`getActorId` + `remoteChunkDecrypt`/chunk-`saveIncremental` handlers (`:429-516`).
- `src/services/sync/syncService.ts` — remove the `publishIncremental` call (`:919`) + its `:914-917` comment, the `pullIncremental` block (`:802-812`) + its `:796-801` comment, the `transportDeps`/`transportSession`/`resetTransportSession` wiring + its call (`:93-98`, `:412`), and the now-orphaned `activeAuxStore()` (`:103-106`) + the `isFlagEnabled` import (`:31`, sole use); retain a bare `getAuxStore(currentProvider)` handle (import `:23`) for the ungated, fire-and-forget residue cleanup; add the base-authoritative INVARIANT comment at the base write (`:911`) and fetch-merge (`:825/:834`).
- `src/services/automerge/worker/docClient.ts` — remove the `applyRemoteChunks`/`exportIncrementalPayload`/`getActorId` wrappers + their entries in the method allowlists (`:364-396`, `:693-727`).
- `src/services/automerge/worker/docOps.ts` — remove `encryptChunk`/`decryptChunk` (used only by the retired handlers; audit-confirmed no other consumer).
- `src/services/sync/incrementalTransport.ts` — DELETE; **relocate** `isChunkName`/`CHANGES_PREFIX`/`CHANGES_SUFFIX` to a small shared util (residue cleanup depends on them — do not re-implement).
- `src/utils/diagnosticContext.ts` — remove the now-orphaned `incr_phase`/`incr_reason`/`incr_chunk_count`/`incr_seq`/`incr_dirty` keys (`:134-138`) + the stale producer comment (`:129-133`); mirror the removal in the Lambda allowlist + its pinned test (`infrastructure/lambda/telemetry/index.mjs` + `__tests__/handler.test.mjs`) — see the rollout-sequencing note in Observability.
- Tests: DELETE `src/services/sync/__tests__/incrementalTransport.test.ts`; prune the `applyRemoteChunks`/`exportIncrementalPayload`/chunk-crypto cases in `applyAndProject.test.ts` + `docOps.test.ts`; ADD worker cache tests (cold-load with few increments; compaction-on-load when over-threshold), a sync test proving a save writes the base UNCONDITIONALLY and NO chunk, a mixed-fleet convergence test (base carries edits with chunks off), and a residue-cleanup resilience test.
- `docs/adr/032-off-main-thread-automerge.md` — add a dated addendum (see Part B; a real record, not a one-liner) so delta-sync isn't re-introduced blind.
- `src/services/automerge/worker/cache.ts` — no change expected; verify `loadCachedDoc`/`incrementCount` at the lower threshold.

## Observability Coverage

The existing telemetry is sufficient — this plan is verified _by_ it, and adds no new context keys.

- **Success/rate signals already live:** `automerge.cacheLoad`, `automerge.remoteLoad`, `automerge.saveBase`, `automerge.saveIncremental` durations (`load-perf` surface, via `sink.perf`); `incremental-sync` `pull-fallback`/`pull-applied`/`publish-ok` counters. After this change: `cacheLoad` p50 → ~2 s; `pull-fallback`/`pull-applied` → ~0 (the path is gone); `saveIncremental` (local) drops in proportion to the lower threshold as `saveBase` (local) rises — watch that `saveBase` does not spike into a save regression.
- **Failure modes triageable blind:** a slow local base rewrite shows as a rising `automerge.saveBase` p95; a load still slow after the threshold drop shows as `cacheLoad` staying high with a low increment count (points elsewhere — worker handshake, out of scope).
- **Residue cleanup emits a queryable breadcrumb on EVERY outcome** (no waffle): `logEvent({ level:'info', surface:'chunk-residue-cleanup', context:{ action:'deleted'|'skipped'|'failed', error_code } })` using ONLY the already-allowlisted `action`/`error_code` keys (`diagnosticContext.ts:68-69`). No `reportError` (high Drive-list false-positive noise). Plus a developer-actionable `console.warn` on failure.
- **`ALLOWED_CONTEXT_KEYS` changes are REMOVALS, not additions:** no new keys ship, but the orphaned `incr_phase`/`incr_reason`/`incr_chunk_count`/`incr_seq`/`incr_dirty` keys (`diagnosticContext.ts:134-138`) become dead when the `incremental-sync` surface is deleted — remove them + the stale comment + the Lambda-allowlist mirror + its pinned test (don't leave dead allowlist entries). No store-declaration change (removing Diagnostics collection only shrinks it). **Rollout-sequencing note:** old builds still emit `incremental-sync` with `incr_*` context while they drain; removing the Lambda allowlist entries strips that context from their stored events (the events still log). Acceptable degradation on a retired path — but sequence deliberately: client key-removal now; the Lambda key-removal can follow once old builds have drained if preserving that telemetry through rollout matters.
- **`doc-worker-recovery` / `app.postInitNoData`** counts are the blind health check — they should fall as `cacheLoad` stops timing out against the worker RPC ceiling.

## Acceptance Criteria

- [ ] `INCREMENT_COMPACTION_THRESHOLD` lowered; a cold `cacheLoad` after ≥ threshold mutations replays ≤ threshold increments (unit test) and completes fast.
- [ ] A device loaded with > threshold cached increments (simulating an already-deployed device) compacts ONCE on `initAndLoadCache` and the NEXT hard-refresh replays ≤ threshold — no edit required to trigger it.
- [ ] The full chunk vertical slice is DELETED (no orphaned RPCs/wrappers/allowlist entries); `incr_*` keys removed from the client allowlist (+ Lambda allowlist + pinned test per the rollout-sequencing note); the base-authoritative INVARIANT comment is present at the base write + fetch-merge.
- [ ] A save writes the compacted base and produces NO new `changes/` chunk file (unit/integration test asserting `publishIncremental` is not called / no chunk write).
- [ ] `fetchAndMergeRemote` still fetch-merges the base; the chunk `pullIncremental` path is gone; no `pull-fallback` can fire.
- [ ] Mixed-fleet convergence test: a doc whose edits arrive only via the base (chunks ignored) converges on all devices.
- [ ] Residue cleanup never blocks/fails a save or load; a simulated Drive-list failure is swallowed + logged.
- [ ] `.beanpod` V4 load/save still works; docWorker off (inline path) still loads from the base; no re-login; R7 `attemptSilentConfigHeal` → load path unaffected.
- [ ] Full unit suite + type-check + lint green; ADR-032 addendum added.
- [ ] Post-deploy telemetry (Observability): `cacheLoad` p50 → ~2 s and `pull-fallback` → ~0 for the same family (verified in CloudWatch, no repro).

## Testing Plan

1. **Unit — local compaction:** apply > threshold mutations, force a cache reload, assert the doc is correct and `incrementCount()` stayed ≤ threshold (re-compaction fired); measure `cacheLoad` replays few increments.
2. **Unit — save writes base, no chunk:** drive a save, assert `currentProvider.write` (base) called and `publishIncremental` NOT called / no chunk artifact.
3. **Unit — read path:** `fetchAndMergeRemote` merges a remote base; assert no `pullIncremental` invocation and correct merge.
4. **Unit — mixed-fleet convergence:** device A (old, writes base+chunk) → device B (new, base-only read) converges; and reverse. Prove edits ride the base with chunks ignored.
5. **Unit — residue cleanup resilience:** stub Drive list/delete to throw; assert save/load still succeed and the error is logged, not surfaced.
6. **Regression — cache correctness:** existing worker cache tests pass at the lower threshold (base + few increments reconstruct the exact doc; corrupt-increment slow-path still recovers).
7. **Manual (post-deploy, live-only per iOS constraint):** greg hard-refreshes on iPhone; confirm skeleton clears in ~1-2 s; confirm no new files appear in the Drive `changes/` folder; watch the CloudWatch checklist.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted the three-part compaction-primary plan (lower local compaction threshold; retire Drive chunk write+read; keep the every-save base as the authoritative compaction), grounded in the confirmed telemetry and the base-authoritative safety argument; folds in/closes #44 (inverted) and #46 (moot).
- **Pass 2 (DRY + error handling)**: Verified all file:line refs (correct); added the REQUIRED compaction-on-load in `initAndLoadCache` (a read-heavy device stuck at ~200 increments would otherwise never re-compact until it mutates — reuses the `:318-319` recovered-path idiom); enumerated the full orphaned vertical slice to remove (worker RPCs `applyRemoteChunks`/`exportIncrementalPayload`/`getActorId` + docClient wrappers/allowlists + `encryptChunk`/`decryptChunk`) and forced an explicit delete-vs-deprecate decision; fixed the residue-cleanup design (reuse `getAuxStore`+`isChunkName`, ungated by the docWorker flag, fire-and-forget off the save path, once-per-session guard); committed to a `chunk-residue-cleanup` `logEvent` breadcrumb (existing keys only); flagged the orphaned `incr_*` allowlist keys + Lambda mirror for removal; reconciled the RPC tests in `applyAndProject.test.ts`/`docOps.test.ts`; noted Part A introduces no new failure path (persistOnce already surfaces failures).
- **Pass 3 (Sustainability)**: Committed to DELETE the chunk slice (removed the delete-vs-deprecate hedging + all conditional "if slice-deleting" language — deprecation-in-place is the orphan the review warns against; STOP+file-follow-up if the audit blocks a clean delete); changed compaction-on-load to the DEBOUNCED `schedulePersist` so it yields to the cold-load projection push instead of racing it; re-defaulted the threshold to N≈50 with the write-amplification math (~200/N× more base rewrites) committed to a code comment; added durable base-authoritative INVARIANT guards (in-code comments at the write + fetch-merge, an unconditional-base-write test, a real dated ADR-032 addendum) so a future maintainer can't resurrect delta-sync / #44 blind; hardened residue cleanup (single on-load trigger, synchronous slot-claim + handle-capture, no-clear-on-teardown, and an explicit end-of-life removal trigger + follow-up); added the Lambda-allowlist rollout-sequencing note.
- **Pass 5 (Robustness sweep — greg-requested, given the stakes)**: Independent fresh-eyes verification of data-reliability / consistency / performance / full-retirement against the code — Q1 (no data-loss: every save path writes a full base, chunks were reader/accelerator only), Q2 (mixed-fleet convergence both directions, no chunk-only edit window), Q3 (perf goal real, no save regression), Q4 (retirement complete per-RPC), Q5 (no new race / no dropped unpersisted edits) all CONFIRMED with file:line evidence. Fixed one real defect: the **rollback story** (the docWorker kill-switch is NOT a rollback — threshold/compaction-on-load are in the shared realm and the chunk code is deleted, not gated; the lever is git-revert+redeploy); named the exact residue-cleanup seam (`fetchAndMergeRemote`); placed compaction-on-load in the non-recovered `else` branch to avoid a double-schedule; and disambiguated that the `docOps.getChangesSince` HELPER stays (used by `persistOnce`) while only the RPC of that name is deleted (+ the `JSON_SAFE_METHODS` comment).
- **Pass 4 (Fresh-eyes sweep)**: Fixed a live threshold contradiction (Important Notes still said ~25 vs Part A's chosen N≈50 — reconciled to ~50); caught a lint-breaking orphan (`activeAuxStore()` + the `isFlagEnabled` import become dead once both chunk call sites go — added to the deletion list); corrected the per-RPC audit rationale (`getActorId` delete; `getHeads` RPC keep as test-harness-only probe, not a live caller; `getChangesSince` RPC is fully orphaned → delete); and added removal of the stale co-located ADR-032 "Plan B" comments (`:796-801`, `:914-917`) with their call sites. Verified internal consistency + all file:line refs; base-authoritative + mixed-fleet convergence hold; compaction-on-load and residue-cleanup lifecycles are race-free.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (this session, performance report)

> as well as my wife on her iphone… loading data and data files now, especially after logging in… takes 30s or more sometimes of spinning… hard refresh… takes way longer than it used to… the data file has not grown that much… it seems like this started at or around the time we started adding beanpod change files… did that work improve things or just introduce side effects… or should we roll it back completely?

### Follow-up — after CloudWatch confirmation

> please write up the full findings and my inclination is to fully retire the change chunk proposal that creates additional data files. but how would compaction work? would we lose data or just store existing data more efficiently? what is your proposal

### Follow-up — scope/sequencing

> let's hold everything for the single compaction plan. … should we fold everything into the plan for issue 43/44/46 … to close out all of those issues?

### Follow-up — kick off

> yes use /beanies-plan and kick off the plan for all 3 and pls also update notion… also issue 43 specifically says iOS but I believe this will apply to everything right? … update that to reflect what it actually is and make the title more readable for non technical ppl

</details>
