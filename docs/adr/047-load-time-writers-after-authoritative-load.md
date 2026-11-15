# ADR-047: Load-time writers run after the authoritative load

- **Status:** Accepted
- **Date:** 2026-11-15
- **Related:** ADR-032 (projection snapshot), ADR-039 (fine-grained CRDT writes)
- **Plan:** `~/projects/beanies-ops/docs/plans/2026-11-15-instant-open-and-no-needless-reloads.md`
- **Implementation:** `src/services/automerge/loadMaintenance.ts`, `src/stores/syncStore.ts` (`reloadAllStores`, `loadFromPersistenceCache`), `src/services/telemetry/openPaint.ts`

## Context

ADR-032 paints the stores from a projection snapshot while the worker rebuilds the Automerge document. Several store loaders also wrote to the document on load (a daily list reset, a repeating to-do roll, recurring transactions, a retention sweep, one-shot migrations). Every `mutate` queues behind `initAndLoadCache` in the serial worker FIFO, so on a snapshot hit `await loader()` meant "wait for the whole rebuild" (5 to 70 seconds on a large family). The snapshot paint was fast, and the open still waited. A write issued before the authoritative load also acts on snapshot copies of the data, which is the wrong thing to write from.

## Decision

1. **A store loader is read-only.** It reads the projection and fills its store; it never awaits a document write.
2. **Load-time writers register with `registerLoadMaintenance(name, task)`.** The registry runs them one at a time, in registration order, after the stores were reloaded from the authoritative document. `reloadAllStores` calls `runLoadMaintenance` after its loaders, and only when the document was already authoritative when that reload began. The call returns at once; a reload never waits for a write.
3. **Runs are single-flight and coalesced.** A request during a run becomes one rerun. The boot Drive read on path 1a holds maintenance (`holdLoadMaintenance`) so the writers run once, after the merged result. A hold that is never released lapses after two minutes and warns.
4. **`storesAuthoritative` guards automatic writers' own entry points.** It is true once the stores were reloaded from the authoritative document and false again at every projection reset.
5. **A load-phase guard keeps it true.** `reloadAllStores` and the direct-loader path wrap loaders in `beginLoadPhase` / `endLoadPhase`. A `docClient.mutate` inside a phase throws and is recorded in unit tests (a shared setup fails the test), and in production still sends the write and reports `load-phase-write` once per session, only while the document is not yet authoritative.
6. **The open is measured.** One `open-paint` event per app open, when the stores first hold family data (see PERFORMANCE.md).

## Consequences

- A snapshot-hit open no longer waits for the rebuild; load-time writes land a moment after the authoritative reload instead.
- A new load-time writer has one obvious home, and a loader that writes fails its own unit test.
- A task failure is reported (`load-maintenance`) and retried on the next reload; it can no longer fail an open.
- Writers must be idempotent: a coalesced rerun or a later reload runs them again.

## Revisit when

- A writer needs a result before first paint (none does today); it would need its own explicit, bounded wait.
