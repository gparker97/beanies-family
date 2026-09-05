# ADR-036: The pod lineage lives in the document, never on the envelope

**Status:** Accepted (2026-09-06)
**Supersedes the design in:** `docs/plans/2026-09-05-pod-load-oom-tier2.md` (#90 Phase B)
**Implemented by:** #90 Tier 3, Stage 1

## Context

Compaction (`Automerge.from(Automerge.toJS(doc))`) is the only way to drop
history in Automerge 3.x, and it mints brand-new object ids. A compacted
document therefore shares NO ancestry with the original, so merging the two is a
map-level conflict rather than a reconciliation.

The loss that produces is **deterministic, not probabilistic**. Automerge breaks
a map-write tie by opId COUNTER before it falls back to the actor id, so a
collection added by a later `migrateDoc` carries a high counter in the old
lineage and a low one in the compacted copy: the OLD lineage wins every time.
Measured 60/60 in `recipes` against 29/60 in `accounts`, where the counters tie.
Two earlier figures — "200 out of 200" and "roughly half, a coin flip" — were
both measured on single-collection fixtures, which can only exhibit the tie.

So a guard is required: a document may be CRDT-merged only with a document of
the same lineage. Anything else is adopted wholesale, rebased, or refused.

## The decision

**The lineage identity is a field on the Automerge document, and the comparison
happens inside the doc worker, at the single point where both documents exist.**

Concretely:

1. `FamilyDocument.podLineage: PodLineage | null`. Null, not optional, because
   Automerge refuses to store `undefined`. Read it through `docOps.docLineage`,
   which normalises the legacy absent case in one place.
2. `BeanpodFileV4` carries NO lineage field, and must never carry one again.
3. `compareLineage` has exactly ONE production call site, inside
   `applyAndProject.mergeRemoteEnvelope`, after the decrypt and before any
   merge. A `no-restricted-imports` rule enforces that.
4. Callers pass a required, exhaustive `LineageBasis` describing what THEY can
   prove (`no-local-document` / `user-file` / `baseline` + heads). There is no
   default, because a default is a decision nobody made.

## Why the envelope was wrong, in the terms it actually failed

This is not a preference. It shipped, and it did not work.

The envelope is maintained on THREE tracks that are independent of the document:
`syncStore.envelope`, `syncService.currentEnvelope`, and the worker's envelope
cache, which `setEnvelope` writes on its own. So a device can hold the compacted
file's stamp while its document is still the pre-compaction one.

Worse, the divergence was guaranteed rather than accidental:
`preserveLocalKeyDicts` spreads `...incoming`, so every envelope replacement
overwrites the local stamp with the remote's — INCLUDING on the branch that
exists precisely because our lineage is the newer one.

The guard then compared two envelopes that agreed, returned `same`, and
permitted the merge it exists to prevent. Observed in the field on 2026-09-05:
one session edited offline, another compacted, and the first reconnected and
CRDT-merged across lineages with no block, no adopt and no message.

A lineage is a fact about a HISTORY. Storing it beside the history, in a
structure with its own lifecycle, means the two can disagree — and the guard
believes the metadata.

## Consequences

- **Backwards compatible by construction.** No field on either side compares
  equal, which is the whole fleet today: `same` → `merge`, unchanged behaviour.
- **The envelope's old value is inert.** `reEncryptEnvelope` spreads it through
  untouched and nothing reads it, so a pod already stamped reads as
  never-compacted on every device — which is correct, and un-sticks the one test
  family that had a stamped envelope over an unstamped document.
- **The worker gains a runtime dependency on `podLineage.ts`.** Acceptable: it
  already imported it for the error codec, and that module is pure.
- **`remoteBaseline.ts` must stay value-free from the worker's point of view.**
  The basis therefore carries HEADS, not a fingerprint: main decodes, the worker
  compares.
- **A retry is now correct.** `mergeRemoteEnvelope` is retryable, and the
  verdict is re-derived inside the worker against whatever the rehydrator
  installed, rather than re-issuing a decision main made against a document that
  no longer exists.

## Alternatives rejected

- **Keep the field on the envelope as a "hint".** A field documented as
  untrustworthy is worse than no field: someone reads it. Deleted instead.
- **Make the three envelope copies converge.** That is a larger invariant to
  maintain forever, in service of storing a fact somewhere it does not belong.
- **Compare on main after loading the remote document.** Main does not hold the
  remote document; loading it there would duplicate the decrypt this feature
  exists to make affordable on a low-memory device.
