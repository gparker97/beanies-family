# #90 Tier 2 — code-review findings (partially verified)

> Date: 2026-09-05
> Source: `/code-review max` (Fable 5.1, premise-scoped) over `913d22c7^..ce3e8d32`.
> The review's candidate-generation phase COMPLETED; the verification phase was
> killed by a usage limit. The full ledger of ~70 candidates is preserved at
> `scratchpad/candidates.md` (session 1d9a0a66). The items below are the ones
> re-verified by hand afterwards.
>
> **Status: Tier 2 is NOT safe to deploy until the CONFIRMED items are fixed.**

## CONFIRMED — premises that were wrong

### P1-2 — the "50% coin flip" model is wrong; loss is DETERMINISTIC per collection

Probe (`scratchpad/probeA3_compactor_loss.mjs`, 60 trials): a clean old-lineage
peer merging a compacted pod destroys the compactor's post-compaction edits
**60/60 in `recipes`** (a collection added by a later `migrateDoc` change) and
**29/60 in `accounts`** (created in change 1).

Mechanism: `Automerge.from` assigns opId counters in insertion order. In the OLD
lineage a later-added collection carries a HIGH counter; in the compacted pod it
carries a LOW one. Counter beats actor id, so the old lineage's map wins every
time. Only where the counters tie does the actor-id tiebreak produce the ~50%
figure — which is the single-collection shape both earlier probes used.

Consequences:

- The risk of an old build (or any unguarded path, see S1) is not "half the
  time"; it **deterministically reverts every post-compaction edit** in every
  later-added collection and republishes the hybrid fleet-wide.
- `lineageProtectsPeerEdits.test.ts`'s 20-80% bound is green on a shape that
  cannot exhibit the deterministic case.
- **The Tier 3 rebase design rests on this model and must be re-derived.**

### P1-1 — the lease does not close the duplicate-seq collision

Probe (`scratchpad/dupseq.mjs`): `merge`, `applyChanges` and `loadIncremental`
all throw `duplicate seq` for a SINGLE realm whose local doc lacks changes
already on Drive under its own pinned actor. Reachable via increment-tail prefix
recovery (`cache.ts:358-382`), a failed cache persist after a successful Drive
save, and a respawn rehydrating from a cache behind the in-memory doc.
`noteMergeFailed` then pages CRITICAL "two realms share one actor" — a
misdiagnosis — and the copy tells the user to close other tabs. Pre-Phase-A a
random actor per load made this harmless.

### P1-3 — three incompatible loss models in one tree

`podLineage.ts:13-17`, `syncFileV4.ts:105-107` and `podLineage.test.ts:49` still
say "200 runs out of 200"; the plan Outcome says 50.3%; the truth is P1-2.

## CONFIRMED — structural

- **S1** `syncStore.loadFromFile`'s merging branch (~1144) calls
  `mergeRemoteEnvelope` with **no `guardLineage`**. Only two guard calls exist in
  the store (935, 983); the Drive poll path (`backgroundSyncFromFile`,
  `reloadIfFileChanged`) is unguarded. `lineageWiring.test.ts` asserts three
  termini and this is a fourth.
- **S3** Termini 1 and 2 test `act === 'adopt'` only, so **`publish-local`
  falls through to a cross-lineage `mergeRemoteEnvelope`**.
- **C-7** `src/services/sync/__mocks__/syncService.ts` defines none of
  `docPushedAgainst` / `isFullySynced` / `noteLineageBlocked` / `noteMergeFailed`
  → in store tests the call throws inside a `try`, the context silently stays
  `clean`, and the dirty→block cell is untestable through the store.
- **Sim-5** `protocol.ts:225` `lineageCodec` is dead: `PodLineageError` is only
  ever thrown on main.

## HIGH-severity, NOT yet verified (from the ledger)

A1-1 (terminus 1 reads a null envelope on cold decrypt → wrong verdict both
ways), A3-1/B-2/C-1 (a lineage block is flattened to "password may have changed"
by every `PayloadLoadError`-only catch → 10s re-download loop, and
`noteLineageBlocked` has no reachable production caller), S4 (terminus-3 guard
outside the try → `PodLineageError` reaches "save local anyway"), L-1 (sign-out
force-save refused but the local DB still deleted), L-4 (`parseBeanpodV4` throw
after the read reaches "save local anyway"), A2-1/A2-3/C-2 (the unfenced window
between `compactDoc` and the lineage stamp), R-1 (two Slack pages per corrupt
pod), Eff-1/Eff-3.

## FIXED (2026-09-05, all mutation-checked)

Each fix was removed again after it landed and the suite re-run; every one has a
test that fails without it. Two of them had NO coverage at all beforehand.

| #         | Fix                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S4 + A3-1 | `isRemoteBlocker()` type guard replaces the `instanceof PayloadLoadError` chain at every latch site and at `doSave`'s refusal; one `noteRemoteBlocked()` dispatcher replaces the three-way `instanceof` that was written twice. `noteLineageBlocked` now has a reachable caller.                                                                                                                              |
| S1        | `loadFromFile`'s merging branch — a FOURTH terminus, reached by both Drive poll paths — now consults the guard and can adopt, via a new `getRemoteBaselineHeadsFp()` accessor rather than a second copy of the baseline.                                                                                                                                                                                      |
| S3        | Termini 1 and 2 tested `=== 'adopt'` only, so `publish-local` fell into a cross-lineage merge. All three termini now name every non-blocking action.                                                                                                                                                                                                                                                          |
| C-7       | The `syncService` mock gained the five missing exports; the resume suite's `docClient` mock gained `adoptRemoteEnvelope`.                                                                                                                                                                                                                                                                                     |
| P1-2/P1-3 | Stale "200/200" and "coin flip" comments replaced with the measured result. `lineageProtectsPeerEdits.test.ts` used a ONE-collection document, which can only exhibit the tie case; it now adds a collection in a later change and asserts the deterministic 60/60 outcome.                                                                                                                                   |
| L-1       | The sign-out latch snapshot is taken before any step so it survives `resetSyncState` — but step ONE is the force-save, which can arm the breaker itself. That step now refreshes the snapshot (`??`, so a pre-existing latch is never overwritten), which is what stops `deleteFamilyDb` destroying the only copy of refused edits.                                                                           |
| L-4       | `parseBeanpodV4` throwing AFTER the read produced a plain `Error` that reached "save local anyway", overwriting a torn upload or a newer-format pod. A new `'parse'` step makes it a `CorruptPayloadError`, i.e. a `RemoteBlocker`.                                                                                                                                                                           |
| A2-1      | `compactDoc` installed the compacted document BEFORE serialising it, with the tail outside the try. An OOM there reported "nothing moved" while the worker held the compacted doc, unstamped, which the next save published under the OLD lineage. Everything that can throw now runs before the install.                                                                                                     |
| C-4       | `guardLineage` throws OUTSIDE `fetchAndMergeRemote`'s try, so a block armed nothing — the local-file poll watcher's `if (remoteBlocked)` gate stayed open and it re-downloaded, re-parsed and re-threw the whole pod every tick. It now latches at the throw.                                                                                                                                                 |
| A1-6      | Only the Drive provider has a revision, so every local-file family hit `commitRemoteBaseline`'s early return and never recorded a heads fingerprint. `isFullySynced()` could then never be true (compaction refused "not synced" on a synced pod) and the lineage context was permanently `dirty`, so those families would BLOCK where they should adopt. The fingerprint is now recorded without a revision. |
| C-3 + C-5 | `adoptRemoteEnvelope` was `dropDoc()` then `mergeRemoteEnvelope()` on main, documented as atomic and not: the merge is RETRYABLE, and a respawn's rehydrator reinstalls the cached old-lineage doc before the retry, so the retry MERGED across lineages. It is now one RPC, and the worker drops only after the decrypt resolves — so a decrypt failure no longer leaves the worker with no document at all. |

## ALSO FIXED — the lower-severity set

| #     | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1-5  | Nothing cleared the breaker on `disconnect`, `selectSyncFile` or `selectNativeLocalFile` (the last two assign `currentProvider` directly, bypassing `setProvider`). A latch armed against the OLD pod survived a rebind to a DIFFERENT one; only a page reload cleared it.                                                                                                                                                                               |
| E-3   | `syncService` arms the breaker on paths the store never sees (its own local-file poll, the pre-save merge), but `podUnopenable` — the only thing `BackgroundSyncBar` reads — was written in exactly one place. A latch armed down there stopped polling SILENTLY. The poll tick now mirrors the service's answer (one-way: it only turns the mirror on; clearing stays with `clearPodUnopenable`, which also nulls the message so the watcher re-fires). |
| Eff-1 | Compaction called `syncNow(false)` BEFORE `isFullySynced()`, and `doSave` has no clean short-circuit — so an already-synced device paid a full export + encrypt + upload of a multi-megabyte pod for nothing, on exactly the low-memory device the feature exists for. Cheapest proof first.                                                                                                                                                             |

## DELIBERATELY NOT FIXED (with reasons)

- **B-5** — the unconditional `rollbackRemoteMarker()` in `loadFromFile`'s
  `finally` costs a redundant re-download on each PIN/password open. It is also
  the guard that makes every exit path safe by construction. Trading a
  data-loss guard for a performance win is the wrong direction; if the cost
  matters, the fix is to have the password/PIN paths CONFIRM the marker after a
  successful merge, which is its own change with its own tests.
- **Sim-5** — `lineageCodec` looks dead (`PodLineageError` is only thrown on
  main today). Removing it is the hazard, not keeping it: without a codec a
  future worker-side throw degrades to `DocWorkerError`, which `isRemoteBlocker`
  does NOT recognise, so it would reach "save local anyway". Its `?? 'conflict'`
  default is the safe direction (conflict blocks everywhere but `user-file`).
- **E-4** — `keyMayBeWrong` deliberately does not latch (a peer rotating the key
  is routine and recoverable), so the service's local-file poll re-downloads
  each tick. Fixing it needs a bounded backoff for that class, i.e. new
  machinery, and the failure is noise rather than loss.
- **E-6** — family creation calls `initDoc()` before any `setFamilyKey`, so the
  owner's first session writes under a random actor and `docActor` warns. The
  cost is exactly one extra lane, once per family, and the create path is the
  highest-risk path in the app. Not worth touching for that.
- **R-1** — a corrupt pod files two `critical` reports (`noteRemoteUnreadable`
  plus `surfacePayloadFatal`). Real noise, but every candidate fix risks going
  dark on the Drive read path, which reaches no surface. Needs its own pass.

## Next

1. Verify the remaining ledger items (A1-1, A1-7, C-6, and the R/Sim/Eff cleanup set).
2. Re-derive the Tier 3 rebase design against P1-2's deterministic model.
3. Re-review the fixes with a different model.
