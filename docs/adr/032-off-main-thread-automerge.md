# ADR-032: Off-Main-Thread Automerge (Worker-Owned Document) + Incremental Sync

- **Status:** Proposed
- **Date:** 2026-07-05
- **Implementation:** Plan A — `docs/plans/2026-07-05-automerge-web-worker.md` (the Worker). Plan B (incremental delta sync) planned separately.

## Context

Production `load-perf` telemetry (2026-07-05, a real ~2 MB family document across several devices) proved the long-standing "app freezes while the orange sync bar slides" report is the **JS main thread being pinned by synchronous, whole-document Automerge WASM**:

| Op                     | Count / 4h | Duration                | When                                                     |
| ---------------------- | ---------- | ----------------------- | -------------------------------------------------------- |
| `automerge.cacheLoad`  | 5          | **4.3–5.2 s** (avg 4.7) | every cold start (IndexedDB cache → `Automerge.load`)    |
| `automerge.remoteLoad` | 36         | **1.8–3.9 s** (avg 2.6) | every cross-device sync (whole 2 MB doc re-deserialized) |
| `automerge.save`       | 93         | 0.44–0.59 s             | every debounced persist (full `Automerge.save`)          |
| `automerge.mergeClone` | 10         | 0.28–0.71 s             | each merge (balloons on a stale/return-from-trip doc)    |

The orange `BackgroundSyncBar` is a non-blocking 3 px strip; it animates on the compositor thread while the main thread is frozen, which is why it keeps sliding during the hang and sometimes trips Chrome's "page unresponsive" dialog. `Automerge.save()` already produces a _compressed_ document, so the 2 MB is genuine state + history — **compaction is not a lever** (dropping history breaks CRDT merge with the family's other devices). Chunking a single `Automerge.load`/`merge` is impossible (one atomic WASM call). The **only** way a load stops freezing the UI is to run it **off the main thread**.

## Decision

Adopt a two-phase architecture, captured here as one target so both phases point at the same boundary.

**Phase 1 (Plan A) — the Automerge document lives in a dedicated Web Worker.** The main thread never runs Automerge WASM. The worker owns the in-memory `Automerge.Doc` (source of truth) and the whole synchronous persistence pipeline: `load/save/clone/merge/change`, AES-GCM encrypt/decrypt, base64, and the IndexedDB **cache** (doc + envelope). The main thread keeps a **read-only reactive projection** of materialized collections (updated by an entity-level delta carried in each worker response); Pinia stores read it synchronously and issue mutations via async RPC. Google Drive network I/O (which needs OAuth tokens) stays on the main thread — the split is "ciphertext bytes in / ciphertext bytes out."

**Phase 2 (Plan B) — incremental delta sync.** Exchange Automerge _changes_ (`getChanges`/`applyChanges`) with Drive and the cache instead of whole documents, so a cross-device edit applies a few KB of deltas (~ms) rather than re-loading 2 MB, and persistence appends increments rather than re-serializing the whole doc.

**Binding constraint on Plan A:** the worker's RPC surface is **change-aware from day one** — `getHeads()`, `getChangesSince(heads)`, `applyChanges(bytes)` — even though Plan A still moves whole docs. Plan B is then a transport swap, not a re-architecture. This is the single decision that lets the two phases ship separately.

### Key sub-decisions

- **Dedicated Worker, not SharedWorker** — beanies is a PWA used heavily on iOS, where `SharedWorker` is historically unreliable/absent. A per-tab dedicated worker is portable; cross-tab coherence already comes from the Drive-poll + cache path.
- **Wrap the existing `docService`, do NOT adopt `@automerge/automerge-repo`** — automerge-repo would force replacing the bespoke encryption model, the V4 `.beanpod` envelope, and the Google-Drive storage/auth layer with its own adapters — a far larger, higher-risk rewrite touching the crypto core.
- **Hand-rolled typed correlation-id RPC over `postMessage`, not Comlink** — the boundary is small and data-integrity-critical (family finances); explicit, auditable message types beat an opaque proxy, and add no dependency on a critical path.

## Consequences

**Positive.** Cold-start load, cross-device sync, save, and merge all stop blocking the UI, at any document size — directly delivers the product goal ("usable while data loads in the background"). The change-aware boundary makes Plan B a transport swap. Encryption/base64/serialization also move off the main thread.

**Negative / risk.** The data layer becomes async end-to-end. The repository's generic CRUD is _already_ `Promise`-returning (low friction), but `changeDoc(fn)` mutation closures cannot cross `postMessage` and must be re-expressed as declarative ops (mostly generic `set`/`patch`/`delete`/`batch`/`increment`; a small enumerated set of nested-structure handlers for photos). The main thread still pays a structured-clone cost to receive projection snapshots — far cheaper than Automerge materialization, kept incremental (entity deltas per edit; chunked per-collection on first load/merge), reduced further by Plan B. Worker lifecycle, error propagation, mid-session re-hydration after an iOS kill, and a **retained inline fallback** must be first-class — no silent failures on the data path. Two residual limitations are documented rather than hidden: a ≤coalesce-window last-edit loss on a hard iOS process kill (true closure is a Plan-B exit criterion via incremental persist), and cross-device register-merge semantics (a pre-existing CRDT trait, not introduced here).

**Rollout.** Ship Plan A behind a `docWorker` kill-switch with the inline path retained for one release, so a regression is one toggle away from the current behavior. Confirm via the worker-side `load-perf` telemetry that `cacheLoad`/`remoteLoad`/`save` no longer block the main thread, then remove the inline path in a follow-up.

## Alternatives considered

1. **Doc compaction / history truncation** — rejected: `Automerge.save` is already compressed; truncating history breaks multi-device merge.
2. **Main-thread chunking with `await` / `requestIdleCallback`** — rejected: a single `Automerge.load`/`merge` is one atomic WASM call and cannot be yielded mid-call.
3. **`@automerge/automerge-repo` with its storage/network adapters** — rejected for Plan A: it would require re-doing the crypto/envelope/Drive layers; revisitable long-term.
4. **SharedWorker (one doc shared across tabs)** — rejected: iOS support is unreliable; not worth the portability risk.
