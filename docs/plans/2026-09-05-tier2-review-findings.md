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

## Next

1. Fix the CONFIRMED set; re-derive the Tier 3 rebase design against P1-2.
2. Verify the HIGH set (the ledger has file:line for each).
3. Re-run the review over the fixes.
