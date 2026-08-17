# Investigation: what actually runs when you open the app

> Date: 2026-08-13
> Tracker: #61 · Plan: `docs/plans/2026-08-13-open-cycle-redundant-loads.md`
> Precedent: `docs/investigations/2026-07-15-cold-load-perf-regression.md`

## Why this exists

30-day production CloudWatch (`docs/PERFORMANCE.md:384-392`, captured 2026-08-12) showed a
2-3MB `.beanpod` costing `automerge.cacheLoad` **p50 ~7.1s / p90 ~24s** and
`automerge.remoteLoad` **p50 ~2.6s / p95 ~4.5s**, while decrypt and projection were both
sub-second. The cost is CRDT reconstruction, and the app was doing it more than once per
open. The 2026-08-12 projection snapshot (`47aa9032`) made the first paint land in ~111ms
but removed no work — so the user can be looking at stale numbers while the app silently
redoes what it has already done.

This document is the definitive map of every full read / decrypt / `Automerge.load` in the
open cycle, with a **necessary / not necessary** verdict for each. Requirement 1 of the plan.

## The open paths

`src/App.vue`'s `loadFamilyData` is the sole open orchestrator. It labels four paths:

| Path   | Condition                                                    | Entry                                                              |
| ------ | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| **1a** | configured, has permission, cached family key present        | `loadFromPersistenceCache` → hands off to `backgroundSyncFromFile` |
| **1b** | configured, has permission, **no** cached key (or 1a missed) | blocking `loadFromFile()`                                          |
| **2**  | configured but needs permission                              | `loadFromPersistenceCache`, no background Drive sync               |
| **3**  | no file configured                                           | `initDoc()` — empty doc, no I/O                                    |

Sign-in (`LoginPage.vue`, `LoadPodView.vue`) and PWA cold relaunch re-enter the same
`loadFamilyData`, so they are not separate paths — they select among these four.

## Path 1a — the common returning-user open (before this work)

| #   | Step                                                                                   | Site                                                      | Full load?                            | Verdict                                                                                                                        |
| --- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `loadProjectionSnapshot` — decrypt + stream the stored projection                      | `applyAndProject.loadProjectionSnapshot`                  | decrypt only, **no** `Automerge.load` | **Necessary.** This is the ~111ms first paint.                                                                                 |
| 2   | `initAndLoadCache` — decrypt base + replay ≤50 encrypted increments + `Automerge.load` | `applyAndProject.initAndLoadCache`                        | **YES** (`automerge.cacheLoad`)       | **Necessary.** Installs the authoritative doc. Until it lands, `requireDoc('mutate')` fails, so the app cannot accept an edit. |
| 3   | `reloadAllStores` ×2 (snapshot paint, then authoritative)                              | `syncStore`                                               | no                                    | **Necessary.** Two genuinely different states are being projected.                                                             |
| 4   | `backgroundSyncFromFile` → full Drive download                                         | `syncService.load`                                        | file read                             | **NOT necessary when the file has not changed.** No pre-check gated this. → Phase C                                            |
| 5   | `mergeRemoteEnvelope` — decrypt + `Automerge.load` of the remote                       | `applyAndProject.mergeRemoteEnvelope`                     | **YES** (`automerge.remoteLoad`)      | **NOT necessary when the file has not changed.** The second full reconstruction. → Phase C                                     |
| 6   | `reloadAllStores` ×1-2 post-merge + dedup scan                                         | `syncStore`                                               | no                                    | **NOT necessary on a no-op merge.** → **fixed (B2)**                                                                           |
| 7   | Drive **write** — full `saveDoc` + encrypt + whole-file upload                         | `syncService.doSave`                                      | write                                 | **NOT necessary when nothing changed.** The one save trigger that was not gated on `dirty`. → **fixed (B1)**                   |
| 8   | Whole-projection re-serialize + AES-encrypt ×2                                         | `applyAndProject.persistSnapshotOnce`                     | no                                    | **NOT necessary when the projection has not moved.** → **fixed (B4)**                                                          |
| 9   | Second `getLastModified()` round-trip                                                  | `syncStore`, after `syncService.load` already captured it | metadata                              | **NOT necessary — pure duplicate.** → **fixed (B5)**                                                                           |

**Decrypts per open (before):** 3 full-payload-class — snapshot, cache base, remote — plus
one per cached increment (≤50).

## Paths 1b / 2 / 3

- **1b** — one full reconstruction via `replaceDocWithCacheRecovery` (`initAndLoadCache` then
  `mergeRemoteEnvelope`). See the withdrawal below: this pair is **necessary**.
- **2** — snapshot + `initAndLoadCache` only; no Drive sync. Already minimal.
- **3** — `initDoc()`, no I/O at all. Already minimal.

## Withdrawn from scope: the `replaceDocWithCacheRecovery` "double reconstruction"

The intake listed `syncStore.ts:775` (`initAndLoadCache`) + `:781` (`mergeRemoteEnvelope`) as a
redundant back-to-back pair to be removed. **It is load-bearing and must not be removed.**

1. `initAndLoadCache` loads _this family's_ cache so the subsequent CRDT merge preserves local
   unsynced changes — e.g. a previous Drive save that failed. Removing it risks **data loss**.
2. Its `{loaded:false}` return is the **sole** authorisation for `dropDoc()`. Without it, a cache
   miss merges the remote into whatever doc the worker still holds — possibly **another
   family's** — producing an A∪B document that is then persisted to that family's cache and
   uploaded to their file. Durable cross-family corruption.

It also already gates its re-upload on `dirty`, so it was never part of the ungated-write
problem. Recorded here per plan Requirement 16.

## Invariants relied on (do not break these)

- **An envelope-only change is still a file write.** A peer's key rotation or member add
  rewrites the same Drive file, so its `version` advances and a change-gated open still reads.
  This is why skipping the read cannot strand a device on a stale envelope.
- **The base is the sole source of a peer's edits** (ADR-032 addendum, 2026-07-15). The
  whole-doc read+merge is how peer changes arrive. Gating it on _"the file has not changed"_ is
  a fact about the file; gating it on _"a delta layer will carry them"_ is forbidden.
- **`dirty` gating is a consistency fix, not write coalescing.** `dirty === false` means local
  and remote already agree, so the write would publish nothing. Three of the four save sites
  always did this; the fourth was the outlier.
- **The doc-worker FIFO is strictly serial**, but `persistInFlight` / `snapshotInFlight` run
  _outside_ it — which is why the snapshot cursor must be captured pre-`await` and guarded on
  `currentDoc === doc`.

## Verified benign side effects

- **`beanpodSizeKb` is not refreshed on an open that skips the read.** `recordPersistedBytes`
  runs only in `syncService.load()` / `doSave()`. The registry's documented contract is
  omit-the-field-and-preserve-the-stored-value, and the file did not change, so the stored size
  is still accurate. Not a regression.
- **The header Refresh button still genuinely refreshes.** It reaches `backgroundSyncFromFile`
  with no telemetry window open, so it emits nothing — and once Phase C lands, its metadata
  probe still always runs, so a changed file is still fetched.

## What PR 1 changed (this commit set)

Instrumentation and the fixes that only ever do _less redundant_ work. **No read is skipped
yet** — that is PR 2.

- **B1** — post-merge re-upload gated on `dirty` (`syncStore`).
- **B2** — post-merge `reloadAllStores` + dedup gated on a new `changed` flag from
  `mergeRemoteEnvelope`, defaulting to `true` so an unknown outcome re-projects.
- **B3** — deleted the dead `decryptBeanpodPayload` from `fileSync.ts`. It had no production
  caller and emitted a duplicate `automerge.remoteLoad` label, so any CloudWatch query on that
  label mixed a live worker metric with a dead main-thread one. **`automerge.remoteLoad` now
  has exactly one emitter** (`applyAndProject.ts`), making the metric trustworthy.
- **B4** — no-op projection-snapshot suppression via a heads cursor, advanced only on a
  successful write and only while the captured doc is still live. The standing win is the
  `pagehide` backgrounding flush, which previously re-encrypted the whole projection on every
  background even in a read-only session.
- **B5** — removed the duplicate `getFileTimestamp()` round-trip; classified and logged the two
  bare `catch {}` blocks that fed it.
- **A1/A2** — `openCycle` per-open counters (reconstructions / reads / writes / store reloads /
  snapshot hit-miss), emitted once per open under surface `open-cycle` on **all four paths**,
  using only pre-existing allowlisted context keys.

## Still to measure (requires a real device — greg)

- [x] **A4 — before-baseline CAPTURED 2026-08-17** on a real ~2-3MB `.beanpod` (family `…fa046620`),
      prod PR 1 build `10d88180` (0.9.10R8), 5 read-only cold opens across iOS + web + Android:
      **consistently `rec=2 reads=1 writes=0 reloads=2-3 snap=hit` (`open-complete`, path1a)**.
      (`writes=0`, not the predicted `writes=1` — PR 1's `dirty` gate already holds on read-only
      opens.) Recorded in `docs/PERFORMANCE.md` §10.
- [ ] Observed `version` / `headRevisionId` values for the `.beanpod` — deferred to the PR 2
      after-capture: the guard's `open-skip` record (and the ABSENCE of `error_code=no-revision`)
      confirms `version` is populated + advancing, which is the safe confirmation path per C12
      (a missing field just fails open to today's always-read behaviour).
- [ ] Confirm every open path emits at least once — path1a confirmed above (all 3 surfaces);
      path 3 easiest via sign-out/fresh-start.

Before-baseline recorded in `docs/PERFORMANCE.md` §10; the after-numbers + version confirmation
land there together from the post-PR-2-deploy capture, at which point #61 closes.
