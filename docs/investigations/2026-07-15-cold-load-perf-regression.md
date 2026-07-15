# Investigation: cold-load / hard-refresh performance regression (change-chunks vs compaction)

> Date: 2026-07-15
> Status: CONFIRMED from production CloudWatch telemetry (greg's own family). This supersedes an earlier
> code-only draft whose conclusion ("chunks aren't on the load path") missed that the LOCAL cache replays
> increments on `cacheLoad` — which the telemetry shows is the dominant cost. No code changed.
> Related: ADR-032 (doc worker), roadmap #43 (iOS cold-load compaction), #44 (retire dual-publish base
> write), #46 (bound Drive chunk growth). Feeds the pending data-file compaction plan.

## TL;DR

The regression is real, and the "change file" approach is **net-negative** — proven by greg's own family's
telemetry (`family_id …fa046620`, last 3 days):

- **Hard-refresh** rebuilds the doc from the local IndexedDB cache via `automerge.cacheLoad`, which replays
  a **base + up to 200 encrypted incremental changes** on a ~2.8 MB doc. Measured **p50 = 21 s, p95 = 147 s**.
  A plain load of the compacted base (`automerge.remoteLoad`) is only **p50 = 2.2 s** for the same-size doc —
  so the ~19 s gap is **entirely the accumulated-increment replay**. This is the local-cache version of the
  "multiplying change files," and it IS on the blocking load path.
- **The Drive delta-sync is thrashing:** **446 `pull-fallback` vs 254 `pull-applied`** in 3 days — >60 % of
  delta attempts fail and do a full whole-doc reconcile **anyway**, so the change-chunks add a
  failed-delta-then-full-reconcile tax instead of saving work.
- **Compaction (fresh base, drop the deltas) is the right fix, loses no data**, and matches the long-term
  direction. Recommendation: **retire the Drive change-chunk dual-publish entirely** and **compact
  aggressively** (local cache + Drive base only).

## Confirmed telemetry (surface `load-perf` / `incremental-sync`, family …fa046620, 3 days)

| Operation              | Meaning                                                                | p50           | p95            | max           |
| ---------------------- | ---------------------------------------------------------------------- | ------------- | -------------- | ------------- |
| `automerge.cacheLoad`  | **hard-refresh** — rebuild doc from IndexedDB (base + ≤200 increments) | **20,971 ms** | **147,101 ms** | 9,012,586 ms¹ |
| `automerge.remoteLoad` | **login** — `Automerge.load(base)` from Drive (2861 KB)                | 2,236 ms      | 7,244 ms       | 16,657 ms     |
| `automerge.save`       | a save                                                                 | 664 ms        | 4,463 ms       | 34,722 ms     |
| `automerge.merge`      | poll-merge                                                             | 546 ms        | 4,389 ms       | 4,389 ms      |

¹ the 2.5 h max is a backgrounded/suspended tab, not a real wait — ignore for the median story.

Delta-sync outcomes (surface `incremental-sync`, same window): **`pull-fallback` 446**, `pull-noop` 836,
**`pull-applied` 254**, `publish-ok` 167, `publish-failed` 6. Worker health:
`initAndLoadCache`/`ping`/`flush`/`mergeRemoteEnvelope` timeouts, 12 `doc-worker-recovery` events,
**6 `app.postInitNoData`** recovery overlays. Doc size: base 2861 KB, cached 1982 KB — **stable, not the
driver** (`remoteLoad` of the same-size base is 2.2 s).

## Why `cacheLoad` is ~10× `remoteLoad` (mechanism, confirmed in code)

- Cold hard-refresh takes **path 1a** (`App.vue` cache-first) → `docClient.initAndLoadCache` →
  `cache.loadCachedDoc` (`applyAndProject.ts:301`, timed as `automerge.cacheLoad`).
- `loadCachedDoc` reads the encrypted **base** row plus **every increment row**, then decrypts + unframes +
  `Automerge.applyChanges` for all of them (`cache.ts:143-201`).
- Increments are only dropped when the count crosses **`INCREMENT_COMPACTION_THRESHOLD = 200`**
  (`applyAndProject.ts:70,191-193`) — up to 200 encrypted deltas replayed on every cold cache load. On
  iPhone JSC, decrypt×200 + unframe + apply on a 2.8 MB doc is the ~19 s over the 2.2 s base floor.
  `remoteLoad` avoids this — a single `Automerge.load` of the compacted base.
- When `cacheLoad` exceeds the worker RPC ceiling it trips the `initAndLoadCache` timeout → worker-death
  recovery re-spawns and retries → compounds into the 30 s+ spins and the `postInitNoData` overlays.

## Why the Drive change-chunks are net-negative

- `pullIncremental` runs only inside a save; Drive/native disable the poll watcher, so chunks aren't
  fetched on the blocking cold-load path — BUT the delta path **falls back to a whole-doc reconcile 446
  times in 3 days**, doing the expensive full load anyway plus the wasted list/try-delta work first.
- `pruneOwnChunks` only prunes THIS device's own chunks (`incrementalTransport.ts:247`); cross-device
  chunks accumulate unbounded (#46, never shipped). With the fallback rate, the Drive chunk layer costs
  more than it saves.

## Is it chunk count, base write, or cache path?

**Cache path (local increment replay) is the dominant regression** for hard-refresh; the **Drive
change-chunk thrash** is a second, independent net-negative; the **worker migration** (handshake/timeout
churn) is a third, smaller contributor to the login spins. Base doc history (#43 size) is NOT the driver —
size is flat and `remoteLoad` of the base is 2.2 s.

## What compaction is (and that it loses no data)

`Automerge.save(doc)` serializes the FULL document (state + the history needed for future merges) into one
compact binary; `Automerge.load` reconstructs it. Increments/chunks are deltas since the last snapshot and
are **redundant once folded into a fresh snapshot**. Compaction = load base → apply increments → `save()` a
new base → drop the increments. **No data loss, merges still work** — it re-packs existing data more
efficiently and shortens the load path. The local cache already does this every 200 increments; the fix is
to do it far more often and to stop maintaining the parallel Drive chunk pile.

## Recommendation — retire change-chunks, compact aggressively (keep the worker + CRDT)

1. **Immediate low-risk relief (shippable now):** lower `INCREMENT_COMPACTION_THRESHOLD` **200 → ~25**
   (`applyAndProject.ts:70`). `cacheLoad` then replays ≤25 increments; hard-refresh drops from ~21 s toward
   the ~2 s base floor. One constant, behind the existing tested base-write/compaction path.
2. **Retire the Drive change-chunk dual-publish** (extends #44/#46): every save writes only the compacted
   base `.beanpod`; stop appending + listing + pruning change-log chunk files. Removes the 446-fallback tax
   and the unbounded cross-device pile. The base is authoritative and already dual-written today, so this is
   a removal, not a new mechanism.
3. **Compact the Drive base on a cadence** (or on load past N increments) so the base stays small and
   `remoteLoad` stays ~2 s as history grows.
4. **Worker cold-load (#43), separately/after:** faster handshake-fallback / pre-warm so login isn't gated
   on the worker spawn + 10 s handshake; verify R11 recovery fires for a slow-but-progressing `cacheLoad`
   (its `heavyStillInFlight` guard may not).
5. **NOT a worker rollback:** the worker isn't the dominant cost (`remoteLoad` 2.2 s). Keep it; kill the
   change-chunks; compact.

Fold items 1–3 into the pending data-file **compaction plan**. Item 1 can ship immediately as a quick win if
relief is wanted before the full plan lands.

## Verify-blind checklist (already-live telemetry)

- `automerge.cacheLoad` p50 should fall from ~21 s toward ~2 s after threshold 200→25.
- `incremental-sync` `pull-fallback` count should go to ~0 once chunks are retired.
- `doc-worker-recovery` + `app.postInitNoData` counts should drop as `cacheLoad` stops timing out.
- Re-run the same queries for a second family to confirm it's not iPhone/one-device-specific.

## Appendix — CloudWatch queries used (Logs Insights, `/aws/lambda/beanies-family-telemetry-prod`)

- Surface volumes: `fields surface | stats count(*) as n by surface | sort n desc`.
- Load timings (durations are embedded in `message`, e.g. `automerge.cacheLoad took 20971ms (1982KB)`):
  `filter family_id="…fa046620" and surface="load-perf" | fields message` then parse `X took Nms (KKB)`.
- Delta outcomes: `filter family_id="…fa046620" and surface="incremental-sync" | stats count(*) by message`.
