# Follow-up: ADR-032 worker — Layer 2 (large-doc durability) + Plan B (incremental sync)

> Date: 2026-07-06
> Status: **NOT STARTED — needs its own beanies (Notion) issue → `/beanies-plan` → implement.**
> Related: `docs/plans/2026-07-06-worker-ios-large-doc-load.md` (Layer 1, implemented), `docs/plans/2026-07-05-automerge-web-worker.md` (Plan A, shipped), `docs/adr/032-off-main-thread-automerge.md`.

This is a **scope anchor**, not a plan. It records the two related follow-ups deferred out of the Layer-1 iOS fix so they get planned properly. Do not implement from this file — open a Notion issue and run `/beanies-plan` first.

## Why this exists

Layer 1 (`docs/plans/2026-07-06-worker-ios-large-doc-load.md`) stopped the worker from _erroring_ on a large iOS load and made poll-merges O(changed). But it explicitly does **not** remove the residual `Automerge.load` latency floor: loading/merging a large **deep-history** `.beanpod` still replays the whole change history (cost scales with history length, not bytes), so a big doc still has a long — if now non-freezing, non-erroring — first load on iOS.

## The two follow-ups (plan together — they share the incremental-changes machinery)

### 1. Layer 2 — worker large-doc durability

- **History compaction / snapshotting** so `Automerge.load` doesn't replay an ever-growing change graph (the real ceiling).
- **Incremental changes-based sync**: apply only `getChangesSince`/`applyChanges` deltas instead of decrypting + `Automerge.load` + whole-doc merge on every poll. The hooks are already **stubbed** at `applyAndProject.ts:296-308` (`getHeads`/`getChangesSince`/`applyChanges`) and unused by Plan A's transport.

### 2. ADR-032 Plan B — incremental delta sync (the migration's 2nd phase)

- Plan A shipped a **change-aware RPC surface specifically so Plan B is a transport swap** (see `docs/plans/2026-07-05-automerge-web-worker.md`): sync Automerge change-deltas over Drive rather than re-encrypting/merging the whole envelope each time. This is the natural companion to Layer 2.

## Definition of done for the (future) plan

- A large deep-history doc loads on iOS in a comfortable time (target from the perf telemetry Layer 1 added — `automerge.remoteLoad` / `automerge.pushProjection`).
- Poll sync no longer re-loads/re-merges the whole doc.
- Backward compatible with existing `.beanpod` V4 files; no re-login; kill-switch-gated like Plan A.

## Next action

**✅ Beanies issue FILED (2026-07-07): [#42](https://app.notion.com/p/ADR-032-Plan-B-Layer-2-incremental-Automerge-delta-sync-worker-large-doc-durability-396247d9a99f81c78996f4559d52d377) — "ADR-032 Plan B / Layer 2 — incremental Automerge delta sync (worker large-doc durability)"** (`Not started`, High, Feature). Covers both items above; scoped around incremental delta sync as the sanctioned lever, with **history compaction explicitly out-of-scope** (ADR-032 rejected it as merge-breaking). Gated on Part A (worker migration + Layer 1 + prod `docWorker` verification) being fully verified.

**Remaining next action:** once Part A is verified, run `/beanies-pre-plan #42` → `/beanies-plan`.
