# Plan: Speed up app open — instant render from a persisted projection snapshot

> Date: 2026-08-12
> Related issues: None — direct implementation (no GitHub issue; one-dev project)
> Plan file: `docs/plans/2026-08-12-app-open-instant-projection-snapshot.md`
> **Status: IMPLEMENTED 2026-08-12.** Two implementation-time corrections: (1) the worker FIFO is serial, so the snapshot RPC is posted **first** (fast paint) and the rebuild **second** — both before the UI is interactive (mutation-safe); posting the rebuild first, as an earlier pass had it, would have made the fast paint wait behind the 2.6–7s rebuild. (2) `INCREMENT_COMPACTION_THRESHOLD` was **left at 50**: the in-code warning ("do not lower without re-checking `saveBase` p95") plus the snapshot now hiding the rebuild latency make the secondary threshold tweak unwarranted. Landed in `cache.ts`, `applyAndProject.ts`, `docClient.ts`, `syncStore.ts` (+ worker/cache tests); gates green (type-check, lint, format, 4232 tests, build).

## User Story

As a family member opening beanies (especially on my phone or an older device), I want my data to appear almost immediately instead of watching the "counting beans" placeholder for 5-10+ seconds, while the app quietly refreshes to the latest in the background.

## Context

App open is slow: a ~3.3MB family `.beanpod` takes 5-10s to become usable (10+s on older Android), every open, on native and PWA. 30-day production `load-perf` CloudWatch telemetry (measured 2026-08-12) pinpoints the cause — it is **Automerge document reconstruction**, not decrypt, not projection:

| Open-path op                                                                        | p50    | p90/p95   | samples               |
| ----------------------------------------------------------------------------------- | ------ | --------- | --------------------- |
| `automerge.remoteLoad` (Drive fetch + decrypt + `Automerge.load` of compacted base) | ~2.6s  | p95 ~4.5s | 25,555                |
| `automerge.cacheLoad` (base + **replay accumulated increments**)                    | ~7.1s  | p90 ~24s  | 509                   |
| `automerge.pushProjection` (materialize + stream to UI)                             | <0.27s | —         | 2 (usually sub-floor) |
| `stores.reloadAll` (hydrate Pinia from projection)                                  | ~0.55s | —         | 105                   |

Two conclusions drive this plan:

1. **Building the UI state is cheap.** `pushProjection` almost never crosses the 250ms telemetry floor; `stores.reloadAll` p50 is ~0.55s. The multi-second cost is the CRDT engine rebuild. **Decrypt is negligible** — a 2.6s `remoteLoad` includes an AES-GCM decrypt of tens of ms.
2. **The current cache doesn't help open latency.** The app _already_ does cache-first-then-background-refresh (`syncStore.isBackgroundSyncing` → `BackgroundSyncBar.vue`), but the "cache" it loads (`automerge.cacheLoad`) is the **encrypted Automerge binary**, which must be _rebuilt_ — and worse, the increment-replay path (p50 7.1s) is ~2.7× **slower** than a fresh `remoteLoad`.

**The fix:** add a faster tier _below_ the Automerge cache — a **persisted materialized projection snapshot**. On open, hydrate the stores directly from that snapshot (sub-second, since projection + hydrate are cheap) and paint immediately, while the existing worker path rebuilds the real Automerge doc in the background and the authoritative projection overwrites the snapshot. The existing `BackgroundSyncBar` covers the "refreshing in background" window — no new indicator.

This is purely additive: the snapshot is a **display-only fast first paint**. The Automerge doc remains the sole source of truth for mutations and saves; the existing `readyPromise` gate already blocks mutations until the worker's doc is ready.

(This measurement predates the hexane v1 / automerge 3.4.0 upgrade shipped 2026-08-12, ~−17% load — still multi-second, so it doesn't change the conclusion.)

## Requirements

1. Persist a materialized **projection snapshot** (the main-thread `projection.ts` read model — per-collection entity maps + settings) to the per-family IndexedDB cache after the authoritative projection is applied, **encrypted with the family key**, debounced.
2. On open, when a snapshot exists and the family key is available, **hydrate the stores from it and paint before the Automerge rebuild completes** (target well under 1s), then rebuild the real Automerge doc in the background and let its authoritative projection overwrite the snapshot-hydrated state.
3. Show the "refreshing" state for the entire snapshot→authoritative window by **reusing the existing `BackgroundSyncBar.vue` + `syncStore.isBackgroundSyncing`** — never a second indicator, never stale data without the bar visible.
4. A mutation issued during the snapshot-only window must not throw `no document loaded`. `readyPromise` gates only on **worker-ready, not doc-loaded**, so it does NOT cover this — the protection is the worker's **serial FIFO**: the open sequence enqueues the doc-load RPC (`initAndLoadCache`) _before_ the snapshot paint makes the UI interactive, so any later `mutate` queues behind it and `requireDoc('mutate')` succeeds.
5. **Secondary:** reduce the increment-replay cost so the _background_ rebuild is also fast (tighten compaction so `cacheLoad` approaches `remoteLoad`, not 2.7× worse).
6. **Secondary:** add snapshot hit/miss + reconcile telemetry so the real cache-hit rate (and the win) is measurable, and decide native-durability work from data rather than assumption.
7. Never worse than today: any snapshot read/decrypt/parse failure falls back cleanly to the current `initAndLoadCache`/`remoteLoad` path.

## Important Notes & Caveats

- **The snapshot is display-only. It never feeds a save or a mutation.** Saves and mutations operate exclusively on the worker's Automerge doc. The snapshot must never be adopted as the source of truth, never uploaded, never merged.
- **`readyPromise` does NOT protect mutation-before-ready — worker FIFO ordering does.** `readyPromise` resolves at worker-ready (handshake), _before_ the doc is loaded; a `mutate` arriving before the doc is installed throws `docWorker: no document loaded` (a recoverable toast, but a failed edit). The real guarantee: `hydrateFromSnapshotWithRebuild` **posts BOTH the snapshot RPC and the `initAndLoadCache` rebuild RPC synchronously, before the snapshot's chunks paint and make the UI interactive** (Approach 1d step 1). The snapshot is posted first (so it paints first — the rebuild is slow), the rebuild second; a user `mutate` can therefore only enqueue _third_, after the rebuild installs the doc. Never let a mutation path be reachable before both RPCs are posted; if one could be, add an explicit doc-ready await there.
- **Reconciliation needs no diff logic, but DOES need a store re-hydrate.** The worker's `pushProjection` sends `bulk reset:true` deltas for _every_ collection — including ones empty in the rebuilt doc (`docOps.buildFullProjection` maps over all `COLLECTION_NAMES`; `projection.applyOne` bulk+reset assigns a fresh `Map`), so a remote deletion since the snapshot was written (empty-in-rebuild, non-empty-in-snapshot) is fully cleared. That converges the **projection maps** with no custom diff. **But the Pinia stores the UI renders are a _copy_ of the projection taken at `reloadAllStores()` time (e.g. `accountsStore.loadAccounts`: `accounts.value = await …getAllAccounts()`), not a reactive binding — so overwriting the maps alone does not update the screen.** The authoritative rebuild must therefore be followed by a second `reloadAllStores()` (as every existing post-merge path and `backgroundSyncFromFile` do), and `isBackgroundSyncing` clears only _after_ that re-hydrate — never on the raw map overwrite. The "free" part is the absence of diff code, not the store hydrate.
- **The refreshing bar must be visible for the entire window** in which snapshot (possibly-stale) data is shown without authoritative confirmation. `isBackgroundSyncing` goes true at snapshot-paint and clears only when the authoritative projection has landed. This satisfies greg's "only if visibly correct" — data is never shown as settled until it is authoritative.
- **`isLoaded()` (display) vs doc-ready (mutation) must stay distinct.** Hydrating the projection flips `projection.isLoaded()` true so the UI renders — but mutations must still gate on `docClient`'s `readyPromise` (worker doc rebuilt), which they already do. A user who taps "edit" during the snapshot-only window waits briefly (spinner) rather than mutating a doc that doesn't exist yet. Do NOT let any mutation path treat `isLoaded()` as "safe to write."
- **Cross-family safety.** The snapshot is a row in the per-family cache DB (`cache.initPersistenceDB(familyId)`), alongside `BASE_KEY`/`ENVELOPE_KEY`. It is dropped by `clearCache`'s whole-DB `deleteDatabase` (not a per-key clear) on sign-out / family-switch — which is exactly why it must live in the worker cache DB and not a separate main-thread store (a separate DB would survive teardown and leak family A's data into family B's session).
- **Schema/version guard.** A snapshot carries `SNAPSHOT_VERSION`. On mismatch, **ignore the snapshot and fall back** — never render a structurally-incompatible shape; the authoritative rebuild fixes it regardless. **Ownership:** `SNAPSHOT_VERSION` lives next to `COLLECTION_NAMES` / the persisted entity shapes, doc-commented as the required bump on _any_ change to collection names or persisted entity shape; derive part of it from a stable fingerprint of `COLLECTION_NAMES` (so a rename/add/remove bumps it automatically) plus a manual rev for in-shape entity changes. **Defense-in-depth:** a forgotten bump would make `applyOne`→`mapFor` throw `[projection] unknown collection` mid-stream (half-applied, `loaded` still false), so `loadProjectionSnapshot` must wrap the delta push in try/catch and treat _any_ throw — unknown-collection included — as `{ hit: false }` (log + fall back). A stale-shape snapshot can never crash open.
- **Family key availability.** Snapshot hydration is gated on `familyKey.value` being present (post-unlock). First-run / password-needed / trusted-device-not-yet-unlocked → no snapshot hydration, fall back to today's path. No new key material, no new unlock step.
- **Do NOT change** the `.beanpod` V4 format or the encryption model. The snapshot is a _new local cache artifact_, encrypted with the _existing_ family key via the _existing_ `encryptPayload`/`decryptPayload`.
- **The `remoteLoad` 50× `cacheLoad` count is not by itself proof of eviction** — `remoteLoad` also fires on the always-runs background Drive refresh, so it over-counts relative to cold opens. The native-durability question needs the new hit/miss telemetry (Req 6) before any eviction fix — treat it as investigate-with-data, not an assumed bug.

## Assumptions

> **Review these before implementation.** Valid at planning time (2026-08-12).

1. The main-thread `projection.ts` maps + settings are a faithful, complete representation of what the stores render (confirmed: `docClient` applies all worker deltas into this module; `reloadAllStores` re-reads it).
2. The worker's `pushProjection` continues to send full `bulk reset:true` deltas on load (confirmed in `applyAndProject` / `docOps.buildFullProjection`), so the authoritative apply overwrites the snapshot with no diff code.
3. The worker message queue is a **serial FIFO**, so enqueuing `initAndLoadCache` before the snapshot paint guarantees the doc is installed before any user `mutate` runs. (Verified in Pass 2: `readyPromise` gates worker-ready only; `requireDoc('mutate')` throws `no document loaded` if a mutate beats the load — so the FIFO ordering, not `readyPromise`, is the guarantee. This is enforced structurally by keeping both RPCs inside one `hydrateFromSnapshotWithRebuild` function (Approach 1d) rather than two reorderable `syncStore` statements; Testing Plan 5's control test is the regression guard for that structure.)
4. The family key is unwrapped and available (`syncStore.familyKey`) at the point open would hydrate a snapshot in the common returning-user case.
5. `INCREMENT_COMPACTION_THRESHOLD` and the over-threshold self-heal compaction in `applyAndProject.initAndLoadCache` are the levers for the secondary compaction work (confirmed present).

## Approach

### Part 1 — The projection snapshot (the headline fix)

> **Cross-thread invariant (drives this whole design).** The cache IndexedDB (`beanies-automerge-<familyId>`) is **worker-owned** — `cache.ts` documents that two openers on one DB deadlock on `onblocked`, and `docClient` never imports `cache.ts`. Therefore the snapshot is persisted and loaded **entirely in the worker**, exposed to the main thread only via two thin `docClient` RPCs. There is **no main-thread serializer, no main-thread cache open, no `docVersion` subscription** — those are removed in favour of reusing paths that already exist.

**1a. Serialize on the worker from `buildFullProjection` (no new serializer).**
The worker already computes `buildFullProjection(currentDoc)` — the full `bulk reset:true` `[id, entity]` deltas + settings — every time it pushes a projection. Wrap that same array as `{ version: SNAPSHOT_VERSION, deltas }` and persist it. No walk of the main-thread `projection.ts` maps and no `serializeProjection`/`hydrateProjection` pair — the snapshot is just the delta array the worker already builds, so there is exactly one projection-emit path.

**1b. Persist + load in the worker (`src/services/automerge/worker/cache.ts`).**

- `persistProjectionSnapshot(familyKey, snap)` — `JSON.stringify({version, deltas})` → `encryptPayload(familyKey, bytes)` → `bufferToBase64` → `db.put(STORE_NAME, { id: SNAPSHOT_KEY, payload, updatedAt })` (a single-row `put`, atomic per record — a torn/half-written payload simply hits the decrypt/parse fallback). Mirrors `persistDocBinary` exactly (same store, same encryption). **Because this is a whole-projection re-serialize+encrypt (not a cheap `inc:` delta), it must NOT fire per-mutate** — it rides its OWN coarse coalescing timer (`scheduleSnapshotPersist`, debounce ≥ the base `PERSIST_DEBOUNCE_MS`, single-flight so two never overlap), plus a one-shot flush on `visibilitychange`→hidden / `pagehide` so a backgrounded session leaves a fresh snapshot. The snapshot only needs to be _good enough for next open's first paint_, so a few seconds' staleness is fine and coarse coalescing is the point. A write failure routes through the **existing** `cachePersistFailed` handling — never a bare catch. Owner: the debounce lives in `applyAndProject.ts` next to `schedulePersist`.
- `loadProjectionSnapshot(familyKey): Promise<{ version: number; deltas: ProjectionDelta[] } | null>` — `db.get(SNAPSHOT_KEY)` → `decryptPayload` → `JSON.parse`. Returns `null` on absent; **throws** on decrypt/parse failure so the caller logs + falls back (never a silent empty).
- `SNAPSHOT_KEY` is a new row in the same `'doc'` store. **`clearCache(familyId)` deletes the entire per-family DB (`indexedDB.deleteDatabase`), so the snapshot is dropped automatically on sign-out / family-switch — no change to `clearCache`, no per-key "clear set" exists.** (This is also _why_ it must live in the worker DB: a separate main-thread DB would survive teardown and leak across families.)

**1c. Two `docClient` RPCs (the only main-thread surface).**

- `docClient.loadProjectionSnapshot(familyId)` — worker decrypts + parses + validates `version === SNAPSHOT_VERSION`, then streams the stored `deltas` back through the **existing chunked-projection transport** (`pushChunk` → `applyChunk` → `bumpDocVersion`). Returns `{ hit: boolean }`. Because this RPC does only decrypt+parse+push (**no `Automerge.load`**), it returns well under a second. **Any** failure — version mismatch, decrypt/parse error, or a push throw (`[projection] unknown collection` from a forgotten `SNAPSHOT_VERSION` bump) — is caught and returns `{ hit: false }` after logging (see Observability), so the caller falls back and the main thread never sees a raw throw it must special-case.
- Snapshot **persist** is folded into the worker's existing post-`pushProjection` / post-mutate flow — no new main-thread call.

**1d. Open sequence — enqueue the rebuild FIRST, then paint from the snapshot (`syncStore`).**
The ordering matters for correctness (see the mutation-before-ready caveat):

1. **Both RPCs are posted synchronously, in one indivisible function (`hydrateFromSnapshotWithRebuild(familyId)`), before any paint — so no refactor can reorder or interpose a mutation.** The worker is a **serial FIFO** (`docWorker.ts`: `tail = tail.then(...)`), so ordering is by post order, and `initAndLoadCache` takes 2.6–7s. Therefore post the **snapshot RPC FIRST** (fast) and the **rebuild RPC SECOND** — `const snap = docClient.loadProjectionSnapshot(familyId); const rebuild = docClient.initAndLoadCache(familyId);` (neither awaited before both are posted). The snapshot runs first and paints; the rebuild runs behind it. **Mutation-safety invariant:** both are posted before the snapshot's chunks arrive and make the UI interactive, so any user `mutate` necessarily enqueues _third_ — after the rebuild installs the doc — and `requireDoc('mutate')` succeeds. (A mutate issued during the rebuild simply waits in the FIFO until the doc lands, with the bar showing — no throw, no lost write.) The snapshot RPC itself calls `cache.initPersistenceDB(familyId)` (idempotent) so it doesn't depend on the rebuild having opened the DB.
2. `await snap`; on `hit`: `reloadAllStores()` → paint, set `isBackgroundSyncing = true`. The snapshot RPC installs **no** `currentDoc` (display-only); the rebuild is the sole installer of the authoritative doc.
3. When the authoritative rebuild resolves (its `bulk reset` projection has overwritten the maps), **`await reloadAllStores()` to copy the authoritative projection into the Pinia stores the UI renders, and only then clear `isBackgroundSyncing`** — mirroring `backgroundSyncFromFile`'s `finally` (clears the bar after `reloadAllStores`, not on the map overwrite). Clearing the bar on the map overwrite alone would settle the UI while the stores still hold the snapshot copy — a remotely-deleted row would stay visible — violating "never stale data without the bar visible."
4. On snapshot miss / version mismatch / decrypt failure (`hit: false`): skip hydration, proceed with today's path exactly (never worse than today).

### Part 2 — Reuse the existing refreshing bar (no new UI)

- Drive the snapshot→authoritative window through the **existing** `syncStore.isBackgroundSyncing`, which `BackgroundSyncBar.vue` already renders (orange indeterminate top bar, fill-then-fade on completion, error toast on failure). Set it true at snapshot-paint; the existing "sync finished" watcher clears it when the authoritative projection has landed.
- If the background rebuild _fails_ (offline + no Automerge cache), route through the **existing** `backgroundSyncError` / `backgroundSyncErrorKind` path — do NOT clear the bar into a settled state. The snapshot data remains the user's real last-known data (correct for offline); this is a resilience win, surfaced with the existing error affordance, never a silent "fresh" claim.
- No new component, no second spinner. This is the whole of the UI change.

### Part 3 — Secondary: make the background rebuild fast too (compaction)

- The background rebuild should hit the compacted `remoteLoad`-class path (~2.6s), not the increment-replay `cacheLoad` path (~7.1s). Investigate the current `INCREMENT_COMPACTION_THRESHOLD` value and the over-threshold self-heal in `applyAndProject.initAndLoadCache`; lower the threshold and/or compact-on-close so a device rarely accumulates many increments. Keep the base-write debounced (`schedulePersist`) so the ~2MB `saveDoc`+encrypt never competes with the projection push. This is tuning + measurement, bounded — not a rewrite.

### Part 4 — Secondary: telemetry-first native durability

- Add the hit/miss + timing telemetry (Observability Coverage below) and read it on greg's real `.beanpod` post-deploy before doing any native-eviction work. The `remoteLoad` 50× `cacheLoad` figure conflates the always-runs background refresh with cold opens, so the true cache-hit rate is unknown until measured. If the data then shows genuine native eviction of the snapshot/cache, address durability; otherwise the snapshot's graceful fallback already covers it.

## Files Affected

- `src/services/automerge/worker/cache.ts` — `persistProjectionSnapshot` / `loadProjectionSnapshot` / `SNAPSHOT_KEY` / `SNAPSHOT_VERSION` (worker-side; mirror `persistDocBinary`/`loadCachedDoc`). No change to `clearCache` (whole-DB delete already drops the row). No main-thread serializer, no `projection.ts` changes, no `docVersion`-subscription writer — all removed per Pass 2 (reuse `buildFullProjection` + the existing chunk transport).
- `src/services/automerge/worker/docClient.ts` + `protocol.ts` — two thin RPCs: `loadProjectionSnapshot(familyId)` (worker decrypt+push via existing `pushChunk`) returning `{ hit }`; snapshot persist folded into the existing post-`pushProjection`/post-mutate flow.
- `src/services/automerge/worker/applyAndProject.ts` — call the snapshot persist after `pushProjection`; the secondary compaction-threshold tuning (`INCREMENT_COMPACTION_THRESHOLD` + the over-threshold self-heal).
- `src/stores/syncStore.ts` — the open sequence: enqueue rebuild → snapshot paint → drive `isBackgroundSyncing`; the miss/failure fallback.
- `src/utils/perfTiming.ts` consumers — new `snapshot.hydrate` timing label (reuses allowlisted `perf_op`/`perf_duration_ms`/`perf_doc_bytes`) and a `snapshot.miss` `perf_op` on miss (so hit-rate is a queryable ratio with **no new context key**).
- `src/services/automerge/worker/applyAndProject.ts` / `cache.ts` — the secondary compaction-threshold tuning.
- Tests: `projection` serialize/hydrate round-trip + version-guard; snapshot persist/load + decrypt-failure fallback; a store-hydration-from-snapshot test; a "mutation before ready waits" guard test.
- `CHANGELOG.md` — a user-facing "app opens much faster" entry.
- `docs/PERFORMANCE.md` — document the snapshot tier + the measured baseline/target.

## Observability Coverage

The whole feature is justified by measurement, so its telemetry is first-class.

- **`perfTiming` labels (success-path, for the win + regression alerting):**
  - `snapshot.hydrate` — snapshot read + decrypt + `hydrateProjection` + `reloadAllStores` (the new time-to-first-usable-screen). Reuses the allowlisted `perf_op` / `perf_duration_ms` / `perf_doc_bytes` context keys.
  - `snapshot.persist` — serialize + encrypt + IndexedDB write.
  - Keep `automerge.cacheLoad` / `remoteLoad` (now the _background_ rebuild) and `pushProjection` — the split between `snapshot.hydrate` and `remoteLoad`/`cacheLoad` is exactly the paint-vs-rebuild separation the acceptance criteria need. Mind `TELEMETRY_FLOOR_MS = 250` — `snapshot.hydrate` on a 3.3MB file should clear it; if it lands sub-floor that IS the win, so the miss/hit ratio below is the primary rate signal regardless.
  - **Window-close breadcrumb (per-session triage).** A display-only, plausible-looking data path creates a "which representation am I looking at, and did the real one ever arrive?" burden. Emit a floor-exempt `logEvent` `info` (`surface: 'open-snapshot'`) at snapshot-paint ("painted from snapshot") and a matching one when the authoritative `bulk reset` overwrites it and `isBackgroundSyncing` clears ("authoritative landed, snapshot superseded"). The pair bookends the possibly-stale window in the firehose, so triage can tell per-session whether the user saw snapshot vs authoritative data — and a rebuild that never lands (offline) shows as a paint with no close, matching the `backgroundSyncError` path. No new context key.
- **Hit/miss as two perf ops — no new context key.** Emit `snapshot.hydrate` (with `perf_duration_ms`, `perf_doc_bytes`) on a hit and a distinct `snapshot.miss` `perf_op` on a miss/incompatible/decrypt-fail. Both ride the already-allowlisted `perf_op`, so the hit-rate is a queryable ratio (`snapshot.hydrate` count / (`snapshot.hydrate` + `snapshot.miss`)) with **zero** allowlist / Lambda-mirror / store-declaration churn. (Chosen over a `snapshot_hit` boolean context key, which would require a coupled change across `src/utils/diagnosticContext.ts` — where `ALLOWED_CONTEXT_KEYS` actually lives, NOT `logEvent.ts` — plus the Lambda allowlist + its pinned mirror test + the store data-collection declarations.)
- **Failure modes (no silent fallback):**
  - Snapshot decrypt/parse failure → `logEvent({ surface: 'open-snapshot', level: 'warn', message: 'snapshot load failed — falling back to rebuild', context: {...} })`, then the current path runs. Not `critical` — data is safe, open is just as slow as today.
  - Version mismatch OR a push throw (`[projection] unknown collection` from a forgotten `SNAPSHOT_VERSION` bump) → `loadProjectionSnapshot` catches it, `logEvent` `warn` (surface `open-snapshot`) with version-seen-vs-expected / the collection name, returns `{ hit: false }`, then fall back. Expected after a shape change; queryable so a spike (a shipped-without-bump regression) is visible.
  - Snapshot **write** failure → `logEvent` `warn`, non-blocking (the doc + Drive are the durable copies; a missing snapshot only costs a slow next open). Never a bare `catch {}`.
  - Background rebuild failure after a snapshot paint → the **existing** `backgroundSyncError` path (already fires the toast + keeps the bar in an error state); no new critical.
- **Critical vs telemetry:** nothing here is `severity: 'critical'` — no user action fails and no data is at risk (the snapshot is display-only; the doc + `.beanpod` remain authoritative). All events are firehose `info`/`warn`.

## Acceptance Criteria

- [ ] Returning-user open (snapshot hit) paints usable data in well under 1s p50 on a ~3.3MB file; older-phone p90 materially reduced from the current 10s+.
- [ ] The refreshing state reuses the existing `BackgroundSyncBar` (no second indicator) and is visible for the entire snapshot→authoritative window; data is never shown as settled until authoritative. Reconciliation is correct: the authoritative `bulk reset` overwrites all collections (incl. remote deletions), a post-rebuild `reloadAllStores()` re-hydrates the Pinia stores, and the bar clears only after that — no lost or silently-wrong values.
- [ ] The snapshot is display-only: never uploaded, never merged, never fed to a save; verified by test + code review.
- [ ] A mutation issued during the snapshot-only window queues behind the FIFO-enqueued `initAndLoadCache` and applies correctly — no `no document loaded` throw, no lost writes, no write against a non-existent doc.
- [ ] Snapshot is encrypted with the family key, per-family, and cleared on sign-out / family switch (parity with the cache).
- [ ] Snapshot miss / incompatible-version / decrypt-failure falls back to today's path — never worse than today (test-covered).
- [ ] The background rebuild no longer routinely hits the 7s increment-replay path (compaction tuning verified via `cacheLoad` telemetry trending toward `remoteLoad`).
- [ ] Telemetry distinguishes `snapshot.hydrate` (first paint) from `remoteLoad`/`cacheLoad` (background rebuild) and exposes snapshot hit-rate; measurable on greg's real `.beanpod` post-deploy.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; hit/miss is measurable via the `snapshot.hydrate` / `snapshot.miss` `perf_op` split with **no new context key** (no allowlist/Lambda/store-declaration change).

## Testing Plan

1. **Snapshot round-trip (unit, worker):** `buildFullProjection(doc)` → wrap `{version, deltas}` → `persistProjectionSnapshot` → `loadProjectionSnapshot` → push via `applyChunk` reproduces the exact per-collection maps + settings; `bumpDocVersion` fires once; a wrong `version` yields `{ hit: false }` (fall back), never a partial render.
2. **Snapshot persist/load failure (unit):** a corrupt/undecryptable payload makes `loadProjectionSnapshot` throw inside the worker and the RPC returns `{ hit: false }` (asserted) so the caller falls back; a write failure routes through `cachePersistFailed`, non-blocking.
3. **Open fast-path (integration, mocked worker):** with a stored snapshot, stores hydrate + paint before the (delayed) worker `pushProjection`; `isBackgroundSyncing` is true across the window and clears on authoritative apply; the authoritative `bulk reset` overwrites the snapshot state.
4. **Fallback (integration):** no snapshot / incompatible / decrypt-fail → today's path runs, one usable render, correct data.
5. **Mutation-before-ready (integration):** with `initAndLoadCache` enqueued first, issue a mutation during the snapshot-only window → it runs _after_ the load in the FIFO and lands on the real doc (no `no document loaded` throw); and a control test proving the throw DOES occur if the load is not enqueued first (guards the ordering invariant).
6. **Cross-family (integration):** family A snapshot present, switch to B → B never renders A's data; `clearCache` drops the snapshot on sign-out.
7. **Compaction (unit + measure):** over-threshold increments trigger the self-heal compaction; the next background load takes the compacted path.
8. **Full gates:** `npm run type-check && npm run lint && npm run format:check && npm run test:run && npm run build`.
9. **Manual smoke:** open the dev app against a real large `.beanpod` — data appears near-instantly, orange bar shows briefly, then settles; make an edit immediately on open and confirm it lands. Offline open: snapshot shows, error affordance appears, no false "fresh".
10. **Post-deploy (greg, real device/file):** compare `snapshot.hydrate` vs `remoteLoad` in CloudWatch on the real `.beanpod`; confirm first paint <1s and snapshot hit-rate.

## Review Passes

- **Pass 1 (Initial draft)**: Designed the projection-snapshot tier (serialize/hydrate the existing `projection.ts` read model, encrypted per-family, debounced write on `docVersion`), hydrate-then-background-rebuild open with reconciliation free via the existing `bulk reset` apply, reused `BackgroundSyncBar`/`isBackgroundSyncing` and the existing `readyPromise` mutation gate (no new queue/UI), plus secondary compaction tuning and telemetry-first native-durability; observability with one new context key.
- **Pass 2 (DRY + error handling)**: Moved snapshot persist/load **into the worker** (the cache DB is worker-owned — a main-thread opener would deadlock); reuse `buildFullProjection` + the existing chunk transport + `clearCache`'s whole-DB delete, deleting the redundant main-thread serializer / `hydrateProjection` / `docVersion`-writer. Corrected mutation-before-ready from the non-gating `readyPromise` to **worker-FIFO enqueue-load-before-paint** (`requireDoc` throws otherwise). Fixed the allowlist to `diagnosticContext.ts` (+ Lambda mirror) and dropped the new `snapshot_hit` key in favour of a `snapshot.miss` `perf_op` (zero allowlist churn).
- **Pass 3 (Sustainability)**: Pinned the snapshot write to its own coarse coalescing timer + `pagehide` flush (never per-mutate — it's a whole-projection re-encrypt, unlike `inc:` deltas); made the FIFO enqueue-before-paint invariant _structural_ by wrapping both RPCs in one `hydrateFromSnapshotWithRebuild` function instead of two reorderable `syncStore` statements; gave `SNAPSHOT_VERSION` a named owner + a `COLLECTION_NAMES` fingerprint and made `loadProjectionSnapshot` catch any push throw (incl. unknown-collection) as `{ hit: false }`; added a paired snapshot-paint / authoritative-landed breadcrumb for per-session triage.
- **Pass 4 (Fresh-eyes sweep)**: Confirmed snapshot security parity (same family key / worker DB / `clearCache` lifecycle; JSON-safe by `toPlain` construction) and complete projection-map overwrite incl. remote deletions (`buildFullProjection` resets all collections). Caught one correctness risk: Pinia stores are a _copy_ of the projection, so the authoritative rebuild must be followed by a second `reloadAllStores()` and `isBackgroundSyncing` must clear only after it — otherwise a remotely-deleted row stays visible on a settled UI (edits to the reconciliation note + Approach 1d step 3 + acceptance).

## Prompt Log

> No GitHub issue created — approved for direct implementation. Full prompt history below.

<details>
<summary>Full prompt history</summary>

### Initial context (user, verbatim)

> ok - now let's discuss app slowness on open. As you know, all beanpod data is encrypted, and it gets decrypted when you open the app or site, unless the data is cached. But it seems like nearly every time I open the native app app on ios or android, or even the PWA, it always takes four or five seconds to decrypt the data, especially when I have a larger data file, so i assume cache is being ejected, more so for the native app. this is a serious issue as my family data file, which is currently only about 3.3MB, takes anywhere from 5-10 seconds to load when opening the app, and 10+ seconds on slower phones (for example, on an older android phone for one of my family members, it takes more than 10s).
>
> what options do we have to improve performance here, perhaps by caching more aggressively, which should be fine as data can be updated after the app is opened, or other alternatives that could make the initial open faster. is it possible to avoid decrypting the data (or the full data) every time, or are there other options to make the inital open faster? And if not, should we try to at least hide the loading behind a splash screen or something kind of animation, rather than watching the placeholder animation for 5-10s (or more)?

### Decisions (user)

- Proceed: **measure first, then plan**.
- Staleness: stale-then-fresh acceptable **only if visibly correct** (a visible refresh indicator; never silent staleness).
- Scope: **Option A + secondary cache fixes** (instant render from a persisted projection AND tighten cache compaction + native durability).
- Refresh affordance: **no mockup**; an indeterminate orange top loading bar already exists (`BackgroundSyncBar.vue`) — the new refreshing indicator must reuse/extend it and represent the same thing, not add a second/overwhelming indicator.
- Snapshot at rest: **encrypt with the family key** (parity with the existing cache).

### Measurement (30-day prod CloudWatch load-perf, 2026-08-12)

- `automerge.cacheLoad` p50 ~7.1s / p90 ~24s (n=509); `automerge.remoteLoad` p50 ~2.6s / p95 ~4.5s (n=25,555); `automerge.pushProjection` <0.27s (n=2, usually sub-floor); `stores.reloadAll` p50 ~0.55s. Bottleneck = Automerge reconstruction; decrypt + projection are cheap; the increment-replay cache path is slower than a fresh remote load.

</details>
