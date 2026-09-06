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
- **The envelope's old value is read ONCE, for the remote side only, and then
  extinguishes itself.** ⚠️ An earlier draft of this ADR said the value was
  inert and that a stamped pod reading as never-compacted was "correct". That
  was wrong, and it was the most dangerous sentence in the document: files
  compacted by the Tier-2 code recorded their lineage ONLY there, so after this
  change they read as never-compacted, compare `same` against a peer still on
  the pre-compaction history, and CRDT-merge across lineages — the exact failure
  this ADR exists to prevent, reintroduced by the fix.
  `docOps.legacyEnvelopeLineage` therefore reads the retired field, and only for
  the REMOTE side. That is sound where the LIVE envelope stamp was not: the
  drift argument is about our own envelope copy being maintained on three tracks
  beside our document, and there is no drift between `podLineage` and
  `encryptedPayload` in a file that has just been fetched — they are bytes out
  of one blob. `mergeRemoteEnvelope` writes the value into the document as it
  adopts, the next publish carries it into the file, and the reader has nothing
  left to do for that family. Nothing writes the envelope field; there is no
  setter. Delete the reader and its call site once no pre-Stage-1 compacted file
  survives.
- **The local side deliberately has NO equivalent fallback**, which leaves one
  ambiguous pairing: an unstamped local document against a legacy-stamped
  remote. We cannot tell whether we already hold that compacted document or are
  still on the pre-compaction history — and we do not need to. Both readings
  resolve to `adopt-remote`, whose policy is safe either way (adopt when clean,
  block when dirty), and the adopt stamps the document, so the ambiguity lasts
  exactly one sync per device.
- **`user-file` needs a producer, or the policy table lies.** The column exists
  so the guard cannot refuse the pre-compaction `.beanpod` a family re-points at
  — the only rollback route there is. `rebindPodFile` merges nothing itself, so
  the choice is recorded as a one-shot (`syncService.noteUserChoseRemoteFile` /
  `consumeUserFileIntent`) that the next real read consumes. Without it the
  rollback arrived as a plain baseline compare, resolved `ours-newer`, and
  published the compacted document straight back over the file the human had
  just chosen: the table promised a recovery the code did the opposite of.
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
