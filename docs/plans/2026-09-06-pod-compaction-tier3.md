# Plan: Compaction nobody has to know about — Tier 3, re-derived

> Date: 2026-09-06
> Related issues: #90 (Tier 3). No GitHub issue — direct implementation.
> Supersedes: `docs/plans/2026-09-05-pod-compaction-tier3.md` (drafted against a
> loss model that turned out to be wrong, and before the guard was shown not to
> work). That file stays as a record; do not implement from it.
> Reads with: `docs/plans/2026-09-05-tier2-review-findings.md`,
> `docs/plans/2026-09-05-fix-review-findings.md`

## What the first real test taught us

Two things, and both change the design.

**1. The lineage guard does not work, because it asks the wrong object.**
`podLineage` lives on the ENVELOPE. `setEnvelope` persists the envelope to the
worker cache independently of the document cache, so a device can hold the
compacted file's lineage stamp while its document is still the pre-compaction
one. `guardLineage` then compares two envelopes that agree, returns `same`, and
permits a merge in EVERY context. It is blind by construction.

Observed on greg's first two-session test (2026-09-05): session B went offline,
added a to-do, session A compacted, B reconnected — and B's console shows
`[perf] automerge.merge: 9ms` followed by two saves. No block, no adopt, no
message. A silent cross-lineage merge, which is precisely what the guard exists
to prevent.

**2. The loss is deterministic, and it is the COMPACTOR's edits that die.**
Measured 60/60 (`lineageProtectsPeerEdits.test.ts`): `Automerge.from` renumbers
opIds, and Automerge breaks a map-write tie by opId counter before actor id, so
for every collection added by a later `migrateDoc` the OLD lineage wins.

The consequence is the opposite of what the previous draft assumed. A peer's
unsynced edits mostly SURVIVE a cross-lineage merge; what is destroyed is the
compaction itself (silently undone) and every edit the compacting device made
after it. So R1 is not "rescue the peer's work from a coin flip". It is "let a
peer with unsynced work ADOPT the compacted document instead of being blocked",
which is a usability requirement, not a data-rescue one.

## The standing constraint this plan is written under

This subsystem has been corrected three times, and each correction introduced
regressions in the same shape (`2026-09-05-fix-review-findings.md`: four LIVE
items, two "worse than the defect they replaced"). Three properties therefore
outrank cleverness anywhere they conflict:

1. **A rule the compiler enforces beats a rule written in a comment.** Where
   this plan can turn a "⚠️ if you miss this it fails silently" into a type or
   lint error, it must.
2. **The destructive half goes after the half that can fail, never before it.**
   Already written into `compactDoc`, and re-learnt the hard way as LIVE #3 —
   and re-committed by this plan's own first draft, which Pass 3 caught.
3. **One decision, one place.** Four termini currently re-implement the same
   post-guard tail. Adding a fifth action to four copies is how this breaks
   again.
4. **Moving a throw MOVES ITS CLASSIFICATION.** Added in Pass 4 because three of
   that pass's findings were instances of it: every catch between a new throw
   site and the user is part of the change.

## Requirements

### R0 — the lineage moves INTO the document (everything rests on it)

1. `FamilyDocument` gains `podLineage: PodLineage | null` — a top-level
   non-collection field, exactly the shape `settings: Settings | null` already
   occupies. `| null` rather than optional for a reason: **Automerge refuses to
   store `undefined`** (`RangeError: Cannot assign undefined value at
/podLineage`), which is why `settings` is typed that way too. It travels with
   the history it describes and cannot diverge from it.

   The `PodLineage` TYPE moves from `types/syncFileV4.ts` to `types/models.ts`.
   `FamilyDocument` already imports `Settings` from `./models`; leaving it in the
   file-envelope module would make the document schema import the envelope schema
   it is being decoupled from, in the very change that removes the envelope's
   only reason to know about lineage.

   ⚠️ **The type is a lie on legacy documents, exactly as `settings` already
   is** — `initDoc` seeds only `COLLECTION_NAMES`, so `settings` is ABSENT (not
   null) on every pod ever created. Answer that ONCE, not at each read site:
   `docOps` exports `docLineage(doc): PodLineage | null`, the one place that
   normalises absent-or-null, and `compareLineage` then takes `PodLineage | null`
   only — narrower than a three-state union, with no caller able to pass the
   third state.

2. **ONE declaration says which top-level keys are not collections.** That fact
   is re-encoded by hand in four places today and R0 would add a fifth. In
   `types/automerge.ts`:
   - ```ts
     export const NON_COLLECTION_KEYS = ['settings', 'podLineage'] as const
       satisfies readonly (keyof FamilyDocument)[];
     ```
     The `satisfies` is not decoration: without it a typo (`'podLineag'`) is a
     silent no-op.
   - `CollectionName = Exclude<keyof FamilyDocument, (typeof NON_COLLECTION_KEYS)[number]>`

   Two of the three silent failures become COMPILE ERRORS: `COLLECTION_NAME_SEED`
   stays compile-complete and refuses to compile if `podLineage` is added to it,
   and `migrateDoc` seeds from `COLLECTION_NAMES` so the field is excluded
   automatically. It must NOT be seeded — that would emit a real
   `Automerge.change` into every legacy pod on open, churn in the document this
   tier exists to shrink. Absent and `null` both read as "no lineage";
   `compareLineage` widens to `PodLineage | null | undefined`.
   The third is `projectionDeltasBetween`'s diff-root check, and it needs FOUR
   branches, in this order — not a membership test bolted onto the existing one:
   - `top === 'settings'` → `settingsChanged = true`, continue (unchanged)
   - `top` in `NON_COLLECTION_KEYS` (i.e. `podLineage`) → **continue, IGNORED**
   - `path.length < 2` → continue (unchanged)
   - unknown root → `null`, fail safe to a full rebuild (unchanged)

   ⚠️ `podLineage` must NEVER be folded into `settingsChanged`. It would push a
   spurious settings delta on every compaction and — far worse — make a lineage
   write look like a settings change to R1's rebase, which would then carry the
   peer's settings over the compactor's.

3. **The comparison moves into the worker**, into `mergeRemoteEnvelope`, after
   `decryptToDoc` and before any merge — the one place both documents exist. One
   call site, and no way to reach a merge without passing through it.

4. **The worker computes the CONTEXT too, from HEADS — not from a fingerprint.**
   The basis is ONE required parameter with three exhaustive arms:
   - `{ kind: 'no-local-document' }` — there is no document of THIS family to
     preserve. Install the remote wholesale; the lineage question is moot
     because there is nothing to lose.
   - `{ kind: 'user-file' }` — the human explicitly chose these bytes.
   - `{ kind: 'baseline'; heads: string[] | null }` — the heads Drive HELD as of
     the last durable baseline. `null` means unknown, and reads as `dirty`.

   The worker answers `clean`/`dirty` by comparing those heads against
   `headsOf(currentDoc)` with its own `headsEqual`.

   ⚠️ **`!currentDoc` SHORT-CIRCUITS EVERYTHING, BEFORE THE BASIS IS READ.**
   Today the branch is `if (adopt || !currentDoc)`. Deriving clean/dirty from
   `headsOf(currentDoc)` when there is no document either throws or — with a null
   baseline, the common case on the path that reaches it — answers `dirty` →
   `POLICY['adopt-remote']['dirty']` → **block**. A device whose cache missed
   would be permanently blocked from adopting a compacted pod. That is LIVE #5's
   exact shape, "my fix turned an unguarded merge into a permanent block", and it
   must not be re-committed. "There is no local document" is a FACT the worker
   observes, and it outranks anything the caller asserted.

   ⚠️ **DO NOT name a field on the basis `dirty`.** The function already returns
   a `dirty` meaning something else entirely (the merge left local changes to
   push BACK); its own comment says the two heads-derived booleans "answer
   DIFFERENT questions and must not be conflated". Call the local `lineageCtx`.

   ⚠️ **HEADS, not the fingerprint string.** `remoteBaseline.ts`'s header states
   it is type-imported by worker code and must stay value-free so those imports
   are erased. Sending a fingerprint would force the worker to import
   `hasUnpushedChanges` and a decoder at RUNTIME, silently falsifying that
   invariant and pulling a main-thread module into the worker bundle. Main
   decodes; the worker compares heads. R1 needs the heads array anyway, for
   `Automerge.view`.

   ⚠️ **`no-local-document` is NOT a lineage verdict and must not be smuggled
   through one.** Two store sites force an adopt today because the worker may be
   holding a DIFFERENT family's document. If they passed `user-file`, the `same`
   verdict would return `merge` and the remote would be CRDT-merged into a
   foreign family's document — durable cross-family corruption, which
   `replaceDocWithCacheRecovery`'s own comment already warns about. Two
   orthogonal questions, two arms.

   Asking inside the worker is not merely tidier: today `docPushedAgainst` is
   answered on main BEFORE the merge RPC, so a mutation landing in that window
   yields a stale `clean` and a wrong ADOPT that discards it. Asking at the
   instant the answer is used closes that window, removes a round-trip per
   terminus, and makes the existing respawn-retry correct — the retry re-derives
   against whatever the rehydrator installed rather than re-issuing a decision
   made against a document that no longer exists.

5. **The worker's return says WHAT IT DID**: `{ action: 'merged' | 'adopted' |
'rebased' | 'kept-local'; heads; dirty; changed; remoteHeads }`. Without a
   discriminant the termini would infer the outcome from `dirty`/`changed`,
   which is the ambiguity that produced the original bug. `adoptRemoteEnvelope`
   is DELETED — the basis decides, so there is no second entry point and no
   boolean to forget. `docClient.dropDoc()` calls that exist only to force the
   `!currentDoc` branch go with it: the `no-local-document` arm does the same
   `resetDocCursors()` inside the same RPC, which is the point.

6. **The post-guard `kept-local` tail is ONE helper PER MODULE — two, not one,
   and not four copies.**

   ⚠️ Correcting the earlier draft: `syncStore` imports `syncService`, so a
   single shared helper is a CYCLIC import. There are two owners of an in-memory
   envelope and each keeps its own:
   - `syncStore`: `keepLocalDocumentAndAdoptEnvelopeKeys(remoteEnvelope)` —
     `replaceEnvelope` → `setFamilyKey` → `triggerDebouncedSave`, called from the
     three store termini that carry it verbatim today.
   - `syncService`: `adoptEnvelopeKeys(remoteEnvelope)` —
     `setEnvelope(preserveLocalKeyDicts(remoteEnvelope, currentEnvelope))`,
     called from both the success tail and the `kept-local` return.

   ⚠️ **That second helper closes a still-open instance of finding #7.**
   `syncService`'s `publish-local` branch is a bare `return`, so it never adopts
   the remote's key dicts — and `doSave` then writes the LOCAL envelope over the
   remote, erasing a member, passkey or invite another device added. Dormant only
   because the branch needs a compaction to be reachable.

   ⚠️ **`kept-local` MUST NOT commit the remote baseline, and MUST NOT learn the
   marker.** Today both are avoided structurally, by returning before
   `commitRemoteBaseline` and before `learnRemoteMarker`. The refactor must keep
   `kept-local` an EARLY RETURN at each terminus for exactly that reason:
   recording Drive's heads as a baseline our document provably does not contain
   is a false skip — the class #65 exists to prevent and LIVE #4 already caught
   once.

7. **`BeanpodFileV4.podLineage` is DELETED.** Not demoted to a hint — deleted.
   `preserveLocalKeyDicts` spreads `...incoming`, so the envelope copy is
   GUARANTEED to be overwritten by the remote's. A field documented as "do not
   trust me" is worse than no field: someone will read it. Its only readers today
   are the four `guardLineage` sites and the stamp, all of which R0 removes.
   - No migration, no version bump: additive-optional, and a value already in a
     file is preserved by `reEncryptEnvelope`'s spread and never read again.
   - Delete the stale `syncFileV4.ts` comment with it — it still says "200 times
     out of 200", which the tier-2 P1-3 fix corrected elsewhere and missed here.
   - Delete the stale `syncStore` export comment saying `replaceEnvelope` is
     "Exported for `usePodCompaction`, which stamps the new lineage". It will not.
   - Field evidence: greg's test family already has an envelope stamped `seq: 1`
     over a document with no lineage. After this change that pod reads as
     never-compacted on every device — correct, and the desired un-sticking.

8. `compactDoc` writes the new identity as part of the rebuild, and the order is
   load-bearing — all inside the existing try that keeps the old document:
   `Automerge.from(toJS(before))` → `firstJsonDifference` verify (BEFORE the
   stamp, or it compares a document that differs at `/podLineage`) → one
   `Automerge.change` setting `{id, seq: (prev?.seq ?? 0) + 1}` → only then the
   `saveDoc`/`stats` measurement, so `afterBytes` includes the stamp → only then
   the install.

9. `usePodCompaction` stops stamping the envelope. Steps 5-6 collapse to
   `flush()` then `syncNow(false)`; the ordering hazard and the window between
   them disappear. The flush stays — a flushed but unpublished compaction is now
   SELF-DESCRIBING in the cache, so the `ours-newer → publish-local` recovery
   works by construction rather than by ordering.

10. Backwards compatible by construction: no field on either side → `same` →
    merge, which is the entire fleet today.

11. `docClient.surface()` must stop double-reporting: it computes `expected` from
    `instanceof PayloadLoadError`, so a worker-thrown `PodLineageError` would
    fire a generic report AND toast on top of `noteLineageBlocked`'s. Use
    `isRemoteBlocker(error) || error instanceof WorkerCrashError` — the
    structural predicate the codebase already mandates, and a strict SUPERSET of
    today's set (`PayloadLoadError implements RemoteBlocker`), so nothing
    currently reported goes quiet.

12. **⚠️ MOVING THE THROW MOVES ITS CLASSIFICATION — every catch between the
    worker and the user is part of this change.** Today `guardLineage` throws on
    MAIN, at a call site each terminus wraps itself. After R0 it is raised in the
    worker, serialized by `lineageCodec`, reconstructed by `docClient`, and
    re-thrown out of `await docClient.mergeRemoteEnvelope(...)` — which lands in
    a DIFFERENT catch.

    `syncService`'s merge catch passes `PayloadLoadError` through and wraps
    **everything else** in `RemoteMergeError` → `noteMergeFailed`. So without
    this requirement a lineage block on the poll path is filed as a merge
    failure, `backgroundSyncErrorKind` is `'decrypt'` rather than `'lineage'`,
    and R4's banner — the entire reason Stage 1 includes R4 — never fires. This
    is finding #12's shape exactly: `instanceof` dispatch with no arm for the
    case that now arrives.

    Rule: **every catch between `docClient.mergeRemoteEnvelope` and a user
    surface dispatches on `isRemoteBlocker` FIRST**, before any wrapping.
    Asserted per terminus, not by inspection.

13. `protocol.ts`'s `lineageCodec` stops being dead code, resolving the tier-2
    "Sim-5" note, and its `?? 'conflict'` safe default lands on a live path.

### R1 — rebase a dirty peer onto the new lineage, instead of blocking

1. **`'rebase'` becomes the fifth `LineageAction`, in the same POLICY table.**
   `POLICY['adopt-remote']['dirty']` changes from `block` to `rebase`. One
   table, still exhaustive, `guardLineage` still total. Export a
   `lineageBlockError(verdict)` factory so the private `WHY` copy stays single-
   sourced — the worker raises the same error when a rebase is unavailable.

2. **The baseline heads need NO schema change.** `headsFingerprint` is
   `heads.join(' ')` (`remoteBaseline.ts:106`) and change hashes contain no
   spaces, so the fingerprint is already a LOSSLESS encoding. Add one pure
   sibling in the module that owns the format:
   `decodeHeadsFingerprint(fp): string[] | null` — `null`→`null`, `''`→`[]`,
   else `split(' ')`, returning `null` (with a `console.error` naming the fix)
   if any token is not a 64-char hex hash. Add a load-bearing comment that
   `headsFingerprint` must REMAIN lossless: hashing it would silently disable
   the rebase fleet-wide with no failing test.
   ⚠️ It is called on MAIN, and the decoded `string[]` is what crosses to the
   worker (R0.4), so `remoteBaseline.ts` stays value-free from the worker's
   point of view.
   ⚠️ **Losslessness is pinned by a ROUND-TRIP PROPERTY TEST, not a comment.**
   `decodeHeadsFingerprint(headsFingerprint(h)) === h` over generated head sets.
   Hashing the fingerprint would otherwise disable the rebase fleet-wide with no
   failing test — and this plan exists because a comment was not a guard.
   `cache.ts` is untouched: the row payload is opaque to it by design.

3. **The replay reuses `applyMutation`** (`docOps.ts:599`), which is already
   exactly one `Automerge.change`, already atomic on a `batch`, already builds
   projection deltas. So the new code is a PURE composer, not a mutator:
   `buildRebaseOps(local, baselineHeads, target): {op: MutationOp; count} | null`.
   Per touched entity, reading `before = Automerge.view(local, baselineHeads)`:
   - absent in `local` → `delete`
   - absent in `before`, or absent in `target` → `set` (whole entity)
   - otherwise → `patch` with the changed shallow fields + `deleteKeys`

   ⚠️ Every entity and every field value that becomes an op payload goes through
   `toPlain` first. Reading `local[collection][id]` yields an Automerge PROXY;
   `docOps` already has `toPlain` and every other op payload in the file uses it.
   Assigning a proxy from one document into another document's draft is not a
   supported operation.

   Shallow comparison deliberately: `notificationReads[memberId]`, `asset.loan`
   and friends are written whole, which IS the documented
   last-writer-wins-and-the-peer-wins semantic. A deep differ would be new,
   untested machinery for a case that resolves identically.

4. **`settings` is field-merged, never whole-replaced.** `setSettingsOp` replaces
   the singleton, so emitting the peer's whole settings object would silently
   revert a currency or locale the compactor changed. Compose
   `{...target.settings, ...changedFields}` into ONE `named:setSettings` op.

5. **The touched-entity core is extracted, not copied.**
   `projectionDeltasBetween` already computes exactly
   `Map<CollectionName, Set<string>> + settingsChanged` from `Automerge.diff`.
   Lift it into `touchedBetween(doc, from, to)` and have both callers use it;
   its existing null-on-anything-unexpected contract is what both need.

6. **⚠️ THE REBASE COMPOSES AND APPLIES BEFORE IT INSTALLS. ONE ASSIGNMENT.**
   NOT "three lines inside the adopt branch". The sequence is:
   - `const target = migrateDoc(remote)`
   - `const ops = buildRebaseOps(local, baselineHeads, target)`
   - `const next = applyMutation(target, ops.op).doc`
   - `currentDoc = next` — the FIRST and ONLY write to `currentDoc`

   Writing `currentDoc = migrateDoc(remote)` and THEN mutating it means an
   `applyMutation` throw leaves the worker holding the adopted-but-un-rebased
   document, with the peer's unsynced work silently gone and R1.7's promised
   restore impossible to express. That is LIVE #3 from
   `2026-09-05-fix-review-findings.md` re-committed in the plan that was written
   to avoid it, and it breaks the rule `compactDoc` already states in its own
   comment.

   Everything else is unchanged: no delta plumbing (the adopt branch already
   pushes a FULL projection); no `dirty` flag (the existing
   `!headsEqual(remoteHeads, heads)` becomes true for free because the replay
   moved the heads, so the caller's existing `if (dirty)` pushes it back).

   ⚠️ **The rebase is STRUCTURALLY incapable of writing `podLineage`**, and that
   is why it is safe to compose ops onto the compacted document: `MutationOp` has
   no operation that writes an arbitrary top-level key — the only
   non-collection writer in the union is `named:setSettings`. R0.2's "ignore
   `podLineage`" is the second belt. Both are worth a test, because an op that
   stamped the OLD lineage onto the NEW document would be self-inflicted lineage
   corruption with no external cause.

7. **Every failure falls back to the block, and none is silent**:
   `decodeHeadsFingerprint` → null; `hasHeads` false; `view`/`diff` throws;
   `buildRebaseOps` → null; `applyMutation` throws. All five leave `currentDoc`
   UNTOUCHED — which
   R1.6 makes structural rather than a restore step — log
   `pod-rebase` `unavailable` or `failed`, and raise
   `lineageBlockError('adopt-remote')` — the SAME error the policy would have
   raised, so the termini, the latch, the banner and the telemetry are
   unchanged. The rebase is additive safety and must never lose more than the
   block would.

8. `conflict` still blocks in every context but `user-file`. A machine must not
   pick between two concurrent compactions.

### R2 — an automatic safety copy, beside the pod

1. **Written through the existing `AuxStore` capability, not a new one.**
   `getAuxStore(provider)` (`storageProvider.ts:118`) binds the sibling-object
   methods and returns `null` for providers that cannot write one — that IS the
   capability check, with no `writeSibling?` to add and no UA sniff.
   ⚠️ `getOrCreateAppFolder` would be WRONG, and this is a real bug rather than
   a preference: it returns THIS account's own Beanies folder, whereas a
   JOIN-flow family's pod lives in the owner's. `writeAux` goes through
   `resolveAuxFolder`, which reads the pod's own `parents` — correct for every
   family, by construction.
2. **⚠️ THE AUX STORE CANNOT ADDRESS A `.beanpod`-NAMED SIBLING TODAY. Fix that
   first, in the provider, or nothing else in R2 works.**
   `GoogleDriveProvider.listAux()` queries `listFilesInFolder(..., '.beanchanges')`
   and REPLACES `auxIdByName` with only those files; `readAux` and `deleteAux`
   both refresh through it on a miss. So `deleteAux('…before tidy.beanpod')`
   misses the map, lists only `.beanchanges`, misses again, and returns — a
   SILENT NO-OP. The earlier draft's "delete first, because Drive allows two
   files with one name in a folder" therefore does nothing, and every compaction
   after the first would leave another duplicate.

   The fix is one private helper, and it makes the aux surface honest for any
   name without touching `listAux`'s scope (its only caller must keep seeing
   exactly `.beanchanges`):
   - `resolveAuxId(token, folderId, name)` — the cached map first, then an
     EXACT-name query (Drive's `name contains` is a substring match, so filter
     `f.name === name`).
   - `readAux` / `deleteAux` use it instead of `listAux()` on a miss.
   - `writeAux` uses it to honour **its own documented contract**
     ("Create/overwrite one aux object") — `updateFile` when the name exists,
     `createFile` when it does not. The implementation only ever created; the
     only other caller never reused a name, so nothing depended on the
     divergence.

   **This deletes the delete-then-write step entirely.** One idempotent write,
   one name, no duplicate-name window, one fewer round-trip — and still no
   `listAux(suffix)`, which must NOT be added because it would replace the
   name→id map a different subsystem owns.

3. **The name is derived from the POD'S OWN file name, not a global constant.**
   ⚠️ A single fixed name is NOT unique: the app folder is per-ACCOUNT, so one
   Google account that owns two families keeps BOTH pods in the same folder, and
   each family's compaction would overwrite the other's rollback copy.
   `provider.getDisplayName()` returns the pod's file name, whose uniqueness in
   the folder is already enforced by the create-time collision check. So
   `safetyCopyName(podFileName)` → `<base> <SAFETY_COPY_INFIX>.beanpod`,
   deterministic and stable across compactions of the same pod.

4. **The copy and the manual export share ONE `buildExportEnvelope()` call, and
   it is the PRE-compaction one.** Two whole-doc serialize + AES-GCM passes back
   to back is exactly the wrong thing on the low-memory device this exists for.
   ⚠️ **Do NOT change `exportEncryptedPod`'s return type from `boolean` to an
   object.** `usePodCompaction` reads
   `if (!(await exportEncryptedPod({ errorUi: 'caller' })))` — an object is
   always truthy, TypeScript reports NOTHING for `if (!obj)`, and the backup gate
   on a one-way, history-destroying migration would silently PASS. Split the two
   responsibilities instead, which is DRY-er anyway:
   `syncStore.buildExportEnvelope()` already returns `{json, filename}`;
   `usePodExport` gains `deliverPod(built, opts): Promise<boolean>` (today's body
   minus the build) and `exportEncryptedPod` becomes build + deliver, so the
   manual export is untouched. The compaction builds ONCE, calls `deliverPod`
   for the backup gate, and hands the SAME `json` to the safety-copy writer. It therefore happens at the existing backup step, BEFORE
   `compactDoc()` — after the rebuild there is no pre-compaction document left
   to serialize.
5. **Named from a non-translated constant, shared by writer and filter**
   (`SAFETY_COPY_INFIX` + `isSafetyCopyName` in `constants/compaction.ts`).
   Filenames here are not translated, so a localized marker would be
   unmatchable — and a marker nothing matches is a filter that silently does
   nothing.
6. **Read it back with `docClient.verifyEnvelope`, not a bare read.** It already
   decrypts AND materialize-checks under the family key and throws a classified
   error. "Written" is not "landed", and "landed" is not "opens" — the third is
   the gate that matters.
   ⚠️ The verify is a full decrypt + `Automerge.load` of a multi-megabyte payload
   on the device this feature exists for, and `compactDoc` needs three copies
   resident right after it. So: verify BEFORE `compactDoc`; drop the `json`
   reference before calling it; and a `deviceCannotOpen` failure in the verify
   gets its OWN refusal code — "this device ran out of memory making the safety
   copy" is a different sentence from "the safety copy is unreadable", and only
   the second means the bytes are bad.
7. **The copy must never be auto-selected as a family's pod (ADR-033).** State
   the rule where pods are IDENTIFIED, not at one call site: `isSafetyCopyName`
   is applied inside `driveService`'s pod-listing helpers, and each exclusion is
   logged.
   ⚠️ Correcting the earlier draft: `findBeanpodInFolder` has NO production
   caller today — only a doc comment and its tests. The live name-based
   discovery surface is `searchBeanpodFilesGlobal`, reached from
   `syncStore.listGoogleDriveFiles` and rendered by `LoadPodView`, which never
   auto-selects. Filter BOTH folder-scoped helpers anyway: `findBeanpodInFolder`
   is documented as "the preferred join/recovery entry point", so it is one
   refactor away from being live, and a joiner silently handed the pre-tidy file
   is the ADR-033 failure exactly.
   ⚠️ **`listBeanpodFiles` must NOT be filtered.** Its only production caller is
   the pre-create collision check, which must see EVERY file in the folder or it
   re-opens the 2026-05-15 duplicate-pod incident. Say so in the code, or someone
   will "finish the job".
   The copy stays VISIBLE in the picker, which is what makes it a rollback route
   a human can choose, so its name must read as a backup at a glance.
8. **A provider without an `AuxStore` keeps today's manual export gate.**

### R3 — a "due" note, and a button that is safe at any time

1. **Due** when the payload is ≥ 1MB AND `numChanges` ≥ 5,000. ⚠️ Measuring
   bytes must NEVER cost a `saveDoc` — a whole-doc serialize on every open is
   the regression this tier exists to prevent. Both numbers already exist where
   the document is in hand: `baseBinary.byteLength` on the cache path,
   `decodedSizeOf(envelope.encryptedPayload)` on the cold path, and
   `Automerge.stats` is a handle read, not a serialize.
2. **The note**: a quiet notice in Settings for owner and admin only, linking to
   and highlighting the compaction section. Dismissable for 30 days per device
   via `createPerMemberStore`, which already routes a localStorage failure
   through `reportError`.
3. **ONE computed decides who sees the note, the section, the button and the
   gate**: `canCompactPod`. `usePermissions().canManagePod` is already
   `isOwner || member.canManagePod`, so there is no new permission notion.
   ⚠️ This WIDENS today's gate — `SettingsPage.vue` currently renders the row
   behind `isOwner`. Widening a one-way, family-wide, history-destroying
   migration to admins must be greg's decision, not a side effect of adding a
   note. If the answer is no, the change is that one computed reading `isOwner`,
   and the note follows it automatically, so the two can never disagree and show
   someone a note for a button they cannot press.
4. **No automatic trigger.** Nothing compacts without a click.
5. **The soak gate, inverted so that it CAN fail — and with NO new collection.**
   `FamilyMember` gains two ADDITIVE OPTIONAL fields: `lineageEpoch?: number`
   and `appVersion?: string` (diagnostics ONLY — never load-bearing in the gate,
   because it is absent on exactly the devices the gate is about).

   ⚠️ **The stamp goes in the ONE function that writes `lastLoginAt`, not at the
   call sites.** There are SEVEN `updateMember(id, {lastLoginAt})` calls in
   `authStore`. Adding two fields at seven sites is seven chances to forget and
   seven places to keep in step — the shape this plan's third principle exists to
   prevent. Instead `familyStore.updateMember` adds `lineageEpoch` (and
   `appVersion`) whenever the incoming patch names `lastLoginAt`, and only when
   the stored value differs. One place, and it cannot fire on a background write
   because `lastLoginAt` is only ever in the patch on a genuine login or resume.
   Note `lastLoginAt` is DATE-ONLY, so the window is compared at date
   granularity, and a member who has never logged in has no value and is
   correctly not counted as active.
   Safe against old builds by construction: the repository emits a field-level
   patch with `deleteKeys` only for keys explicitly set to `undefined`, so a
   pre-R3 build writing `lastLoginAt` cannot erase an epoch a newer build wrote.

   The gate: for every member with a `lastLoginAt` inside 30 days, require
   `lineageEpoch >= REQUIRED_EPOCH`. Absent or lower → REFUSE, naming the member.
   Self-healing: the field appears the moment they open an R0 build.

   ⚠️ Three things the earlier design got wrong, recorded so they are not
   reintroduced:
   - **"Refuse while any device is on an old build" can NEVER match**, because a
     pre-R0 build writes no row at all. Positive evidence over `lastLoginAt` is
     the only shape that can refuse.
   - **A `devices` collection would have been self-defeating.** Joining
     `COLLECTION_NAMES` means `migrateDoc` seeds it into every pod — the exact
     churn R0.2 forbids — and it changes the collections fingerprint,
     invalidating the projection snapshot fleet-wide. Worse, a per-device
     heartbeat writes ~365 changes per device per year into the history a
     `numChanges >= 5,000` threshold is meant to measure. Folding the stamp into
     a write that already happens costs ZERO additional changes in steady state.
   - **The 24h-write rule contradicted the freshness requirement.** "Write only
     when something other than the timestamp changed" means `lastSeenAt` never
     advances, so a gate demanding a recent `lastSeenAt` could never pass on a
     long-lived device — a gate that can only refuse, the same defect class as
     one that can only pass.

   Known and accepted limit, to be written in the comment: this is per-MEMBER,
   not per-device, so someone with an upgraded phone and a stale tablet reads as
   soaked. It is the second belt; the braces are that the flag stays OFF until
   R0 has demonstrably soaked, and that R1 makes an unguarded arrival
   recoverable rather than destructive.

6. **The gate ladder, in order.** Pure gates run BEFORE the confirm, so the app
   never asks a question it is going to refuse to honour; I/O runs after.
   1. `canCompactPod` (pure)
   2. every active member soaked (pure, over the `familyMembers` projection)
   3. the destructive confirm (R5)
   4. `flushPendingSave()`
   5. `hasPermission()` — prove we can WRITE before anything moves
   6. an unconditional pull
   7. **the soak check AGAIN** — same pure function, second call
   8. provably level (`isFullySynced`)
   9. backup delivered AND safety copy verified

   ⚠️ Step 7 is not belt-and-braces, it is the AUTHORITATIVE reading. The soak
   check's input is the `familyMembers` projection, and step 6 is what makes that
   projection current — a member who logged in on an old build ten minutes ago on
   another device is not in our copy until the pull lands. Step 2 exists only to
   fail fast before asking the question. One pure function, two calls, no second
   implementation.

   Each refuses in plain language with a distinct code on the existing
   `RefusalCode` union — ONE union, so a new refusal is a compile-checked add.

7. **The pure decisions live OUTSIDE the composable.** `usePodCompaction` is
   already a flat ladder whose header promises "a FLAT sequence of early returns
   with exactly one `try/catch`"; R2 + R3 + R6 would double and nest it.
   Extract, following the pure-module / shell precedent this codebase already
   uses:
   - `services/pod/podSoak.ts` — PURE. Members + epoch in, `{ok}` or
     `{refuse, memberNames}` out. Table-testable with zero mocks, and SHARED by
     the gate (R3.6) and the completion message (R6) so they cannot disagree.
   - `services/pod/podSafetyCopy.ts` — the aux write + verify, and the only place
     that knows the naming rule.

   The composable stays a flat ladder of awaits.

### R4 — make the warning impossible to miss

The lineage message is a transient toast over a 3px bar with NO text node, so
greg missed it entirely during the test. A message that says "this device has
unsaved changes that cannot be combined" must be persistent and dismissed by the
user, not by a timer.

Reuse the chrome that exists for exactly this: `ErrorBanner.vue` via a ~40-line
wrapper on the `DurabilityBanner.vue` pattern, bound to flags that already exist
(`podUnopenable` + `backgroundSyncErrorKind === 'lineage'`), mounted beside
`DurabilityBanner`. No new store state. The dismissal is per-session and local
to the banner: a lineage block latches for the session, so persisting a
dismissal would hide a state the user must act on.

Also add the lineage flag to `WallStatusStamp.vue`, which already aggregates
`driveFileNotFound || podAccessError || cachePersistFailed`. Without it the
beanie wall — a screen a family may leave up all day — stays silent about the
one state that needs a human.

### R5 — the button must look as consequential as it is

greg, 2026-09-06: "'slim down pod' seems to understate the importance and also
riskiness of this feature." Verified: `SettingsPage.vue:1902` renders it as an
ordinary row inside Family Data, immediately beside **Restart Onboarding**, as a
small `secondary` button, with copy "Slim down your family file?" / "Slim it
down". A one-way, family-wide, history-destroying migration currently reads as a
tidy-up.

1. **Its own section**, not a row beside an unrelated one-off.
2. **Named for the problem it solves, not the mechanism.** "Slim down" describes
   the file size. Name it for a family file that has grown too large to open on
   an older device.
3. **A standing warning in the section**, not only in the confirm dialog: use
   this only if the family file is slow to open, or will not open, on one of
   your devices. Not routine maintenance.
4. **Cannot be triggered by accident.** ⚠️ Correcting the earlier draft TWICE
   over. First: the app has NO shared type-to-confirm pattern — `useConfirm`
   offers only `variant: 'danger' | 'info'` and `ConfirmModal` renders no input.
   Second, and this is the Pass-4 correction: **do NOT move delete-family onto a
   `requirePhrase` option on `ConfirmOptions`.** Its phrase gate is not a
   standalone dialog — it is a `BaseInput` inside a `BeanieFormModal` that also
   carries the "export my data first" and "delete the Drive file" checkboxes, and
   the surrounding failure paths reset the text without resetting the checkboxes,
   deliberately. Moving it into `ConfirmModal` means either a second dialog after
   the form, or teaching `ConfirmModal` about checkboxes — restructuring the most
   dangerous flow in the app to add a gate to an unrelated feature.

   **The decision: extract the phrase gate itself.** One small shared component
   (`<TypeToConfirm v-model :label>` exposing a `matches` boolean), with the
   token an UNTRANSLATED constant echoed in the placeholder and the label
   translated — exactly today's behaviour, and the same argument as the
   untranslated filename marker. Delete-family drops its inline comparison onto
   it, in place, with no UX change; the compaction section gets the same gate
   inline before its `confirm({ variant: 'danger' })`. Two users, one
   implementation, no third copy, and `ConfirmModal` untouched.

5. **Pair it with the R3 due note** — the note is the only thing that ever says
   "yes, now", so the section reads differently when the pod is due.
6. Heritage Orange for the standing warning, never Alert Red; Red belongs to the
   final destructive confirm, which legitimately is one.

### R6 — after compaction, say plainly whether anything is left to do

greg, 2026-09-06: "there should not be any action required from the user after
the compaction is done, but to be sure, let the user know if anything needs to
be done."

1. **The goal is zero follow-up**: a clean peer adopts on its next sync, a peer
   with unsynced work rebases (R1). Neither needs a human.
2. **The completion message must be HONEST about the exceptions rather than
   silent**, and it reads from the SAME pure module as the gate (`podSoak.ts`,
   R3.7) — never a second computation of "who is behind".
3. It says one of: "Nothing else to do — your other devices will pick this up on
   their own", or it NAMES the exceptions (a person whose device has not opened
   the app recently, which will pick it up when it next does).
4. **Never a bare "done".** A completion silent about a device that cannot
   converge is the same defect as R4's transient toast: the information exists
   and is withheld.
5. Acceptance: a test drives (a) all members current and (b) one stale member,
   and asserts the two different messages.

### R7 — offer the fix at the moment the family needs it (the OOM surface)

greg, 2026-09-06: "when any system hits an OOM error … one of the recovery
options they are presented with is to compact their data file. it's still a
manual trigger, but it's presented at exactly the time the family needs it."

Right, and it needs one correction to be honest:

⚠️ **THE DEVICE THAT HIT THE OOM IS THE ONE DEVICE THAT CANNOT COMPACT.**
`compactDoc` calls `requireDoc`, and holds THREE copies at peak (`before`, the
`toJS` plain object, the rebuilt `compacted`) — strictly MORE memory than an
open. On the tablet that just failed to open, a compact button would fail too.
Offering it there is a dead end dressed as a fix, which is the exact class of
defect the wall PIN dialog was.

So the recovery is two-sided, and both sides are new copy rather than new
machinery:

1. **On the device that FAILED** (`podTooLarge.inline`, and the fatal payload
   overlay): name the fix and say WHERE it can happen — "your family file has
   grown too large for this device. On a computer or another device that can
   still open it, tidy the file in Settings; this device will then open it
   normally." That converts today's dead end into an instruction. No button,
   because no button can work here.
2. **On a device that CAN open it**: the R3 due note already puts the button in
   front of the person who can press it. The OOM path is the other end of the
   same story, so the two must use the SAME wording for the action, and the due
   threshold should treat "another device reported an OOM" as due regardless of
   the byte threshold — a real failure outranks a heuristic.

   ⚠️ That signal must come from the DOCUMENT, not from telemetry: a
   `podTooLargeSeenAt` on the member's own row, written where R3.5 already
   writes `lineageEpoch` on login, and read by `usePodHealth`. Telemetry cannot
   reach another device, and a fleet-wide CloudWatch query is not something a
   family's Settings page can ask.

3. Acceptance: the OOM surface offers NO button on the failing device, names the
   action, and a family with a device that reported an OOM reads as due on the
   device that can act — asserted both ways.

## Order of work

The demonstrated failure mode of this subsystem is the big batch: nine review
rounds, roughly half of every round's findings being regressions introduced by
the previous round. So these stages ship and are verified independently.

- **Stage 1 — R0 + R4.** The guard, alone, plus the banner that makes its
  verdict visible. `podCompaction` stays OFF. R4 is here rather than later
  because a silent warning is why the field failure went unnoticed at all.
  **Soak before continuing.**
- **Stage 2 — R5 + R2.** UI weight and the safety copy. Neither touches the
  merge path, so neither can regress Stage 1. Flag still OFF.
- **Stage 3 — R1.** The rebase. Flag still OFF.
- **Stage 4 — R3 + R6 + R7.** Due note, gates, completion message, and the OOM
  surface's recovery copy. Only then is enabling the flag on the table.

## Important notes

- **R0 first, alone, and soaked.** Nothing else in this plan is safe until the
  guard actually guards. It is also the only part that must reach every device
  before any compaction is published.
- The `podCompaction` flag stays OFF through R0 and R1.
- **Do not implement from the superseded draft**: its R1 rationale rests on the
  coin-flip model.
- A device that cannot open the file has no unsynced edits and simply adopts.
  The rebase risk is confined to devices that opened it and edited offline.
- Do not attempt op-level replay: the object ids do not exist in the new lineage.
- Extract the "touched entities between two heads" core shared by
  `projectionDeltasBetween` and the rebase. Do not copy it.
- **`docs/adr/036-pod-lineage-lives-in-the-document.md`.** This is the third
  document to state the invariant and the first two are superseded plans; a plan
  is the wrong durable home for a rule the whole sync layer depends on. The ADR
  states: the lineage is a property of the HISTORY, so it lives in the document;
  the comparison has exactly one call site, inside the worker, where both
  documents exist; and the envelope must never carry a copy.
- `CHANGELOG.md` on every push (repo rule; missing entries were finding #15 of
  the last review), and a `docs/lessons.md` entry per stage — at minimum "a
  guard that compares metadata is not a guard on the data" and "a rule enforced
  by a comment is not enforced".

## Assumptions

**Assumption 1 is now VERIFIED, not assumed** (probe, 2026-09-06):

| Property                                     | Result                           |
| -------------------------------------------- | -------------------------------- |
| survives `Automerge.from(toJS(doc))`         | yes, and the data is intact      |
| survives `save` → `load` (the Drive path)    | yes                              |
| a document that predates the field           | reads `null`, never throws       |
| the two are distinguishable BEFORE any merge | yes — this is the whole design   |
| same-lineage peers merging                   | field preserved, both edits kept |
| assigning `undefined`                        | **throws** — hence `             | null`, matching `settings` |

Verified by reading the installed `@automerge/automerge@3.4.1` types, not
assumed: `view` THROWS when a head is absent, `hasHeads(doc, heads)` exists and
answers exactly the precondition R1.3 needs, and `stats` returns
`{numChanges, numOps, numActors, …}`.

Still to re-check before implementing:

1. `Automerge.diff` between two head sets is cheap enough to run at adopt time.
2. `resolveAuxFolder` (the pod's own `parents[0]`) is the pod's folder for
   families created by the JOIN flow as well as by create-pod. This REPLACES the
   earlier assumption about `getOrCreateAppFolder`, which R2.1 shows is the wrong
   folder for a joined family.
3. `Automerge.stats` is cheap enough to call once a session.

## Files affected

- `src/types/automerge.ts` (`podLineage`, `devices`), `src/types/syncFileV4.ts`
  (demote the envelope copy to a hint)
- `src/services/automerge/worker/applyAndProject.ts` (guard inside
  `mergeRemoteEnvelope`; `compactDoc` stamps the doc), `docOps.ts`
  (`touchedEntitiesBetween`, `rebaseOnto`), `cache.ts` + `remoteBaseline.ts`
  (baseline carries `heads`), `protocol.ts`, `docClient.ts`
- `src/services/sync/podLineage.ts` (compare documents, not envelopes),
  `syncService.ts`, `src/stores/syncStore.ts` (termini collapse to passing a
  context), `providers/googleDriveProvider.ts` (`writeSibling`)
- `src/composables/usePodExport.ts`, `usePodCompaction.ts`, new `usePodHealth.ts`
- `src/pages/SettingsPage.vue`, `src/components/common/BackgroundSyncBar.vue`
- `src/services/translation/uiStrings.ts`, `src/content/help/how-it-works.ts`
- `src/constants/compaction.ts` (new)

## Tests that will not compile after R0, and must be MIGRATED not deleted

Deleting the envelope field breaks these, and each is a guard written for a
reason:

- `lineageProtectsPeerEdits.test.ts` — the 60/60 deterministic-loss assertion.
  Re-point at document lineages; the measured outcome must not change.
- `fetchAndMergeRemote.test.ts` — `buildEnvelope({ podLineage: … })` becomes a
  document fixture.
- `usePodCompaction.test.ts` — asserts the ENVELOPE stamp; becomes an assertion
  that `compactDoc` stamped the DOCUMENT.
- `podLineage.test.ts` — signature change to `PodLineage | null`, and the stale
  "200 out of 200" comment.

## Help Center coverage

- **New explainer**, `how-it-works`, slug `why-your-family-file-gets-tidied`.
  What history is, why the file grows, what tidying does, what the "before tidy"
  copy in Drive is and that it is safe to delete, and what happens to changes
  made offline (they are combined; if two people changed the same thing, the
  offline one wins). Update `the-beanpod-file-explained` to link to it.

## Observability coverage

- `pod-lineage`: `action: 'merged' | 'adopted' | 'rebased' | 'kept-local' |
'blocked'`, `error_code` = the verdict, plus the BASIS KIND and, for
  `baseline`, whether the heads were known. Those are the INPUTS to the decision,
  and a fleet where `baseline` heads are always unknown is one where the guard
  can only block — LIVE #5 in telemetry form.
  ⚠️ "Whether the envelope hint DISAGREED with the document" CANNOT be measured,
  because R0.7 deletes the field. The proof is structural (the acceptance
  criteria) plus a one-off `legacy-envelope-stamp-ignored` breadcrumb at the
  first open of a pod whose FILE still carries the old field — greg's test family
  will emit exactly one.
- `pod-rebase`: `'rebased' | 'unavailable' | 'failed'` with counts. A non-zero
  `failed` rate means the field-level replay met a shape it does not understand.
- `pod-safety-copy`: `'written' | 'landed' | 'unsupported' | 'failed'`.
- `pod-compaction`: existing, plus `'due' | 'note-shown' | 'refused'` with the
  refusal reason, and `perf_doc_bytes` + numChanges on every open.
- Critical severity only for "publish failed after the lineage was stamped".
- No new context keys expected; if one ships, allowlist it in `logEvent.ts` and
  update the store data-collection declarations.

## Acceptance criteria

- [ ] `BeanpodFileV4` has NO `podLineage`, and `compareLineage` has exactly ONE
      production call site — inside `mergeRemoteEnvelope`, after the decrypt.
      This is the structural replacement for the terminus-counting test that
      passed for the wrong reason on 2026-09-05.
- [ ] A device whose worker envelope cache disagrees with its document is judged
      on the DOCUMENT. Reproduce the exact field state as a worker test.
- [ ] Rebase apply forced to throw: the pre-adopt document is restored and the
      block raised — asserted, not assumed.
- [ ] The soak gate REFUSES for a member with a recent `lastLoginAt` and no
      qualifying `devices` row. A gate that only ever passes is the defect this
      criterion exists to catch.
- [ ] A cross-lineage merge reaching `docClient` produces exactly ONE report.
- [ ] The compaction section reads as consequential: its own section, a standing
      warning, a destructive-pattern confirm, and it cannot be hit by accident.
- [ ] The completion message either says there is nothing to do, or NAMES every
      device that will not converge unattended. Both asserted.
- [ ] Dirty peer after a compaction: edits survive, are published, one message;
      no block.
- [ ] Dirty peer with no baseline heads: today's block, `unavailable` logged.

- [ ] Safety copy lands in the POD'S folder for a JOINED family (not the
      opener's own), opens under `verifyEnvelope`, prunes to two, and is
      excluded from `findBeanpodInFolder`.
- [ ] Nothing compacts without a click; the note appears only for owner/admin.
- [ ] The lineage warning persists until dismissed.
- [ ] The single-call-site rule is enforced by `no-restricted-imports` (the
      existing precedent in `eslint.config.js`), banning
      `@/services/sync/podLineage` from `src/stores/**` and `syncService.ts`.
      NOT by another source-slicing test.
- [ ] `mergeRemoteEnvelope`'s basis is REQUIRED and exhaustive, and
      `adoptRemoteEnvelope` no longer exists — so a merge cannot be reached
      without stating a basis.
- [ ] The `no-local-document` sites still install wholesale and still cannot
      merge into another family's document. Asserted.
- [ ] The worker imports NOTHING at runtime from `remoteBaseline.ts`.
- [ ] `decodeHeadsFingerprint(headsFingerprint(h))` round-trips, as a property
      test over generated head sets.
- [ ] Rebase apply forced to throw: `currentDoc` is UNCHANGED (not "restored")
      and the block is raised.
- [ ] Adding a top-level non-collection field without listing it in
      `NON_COLLECTION_KEYS` fails to COMPILE. Verified by mutation.
- [ ] `COLLECTION_NAMES` is UNCHANGED by this plan, so the snapshot version is
      unchanged and no device rebuilds its projection.
- [ ] Exactly ONE whole-doc serialize + encrypt happens across the backup and
      the safety copy. Asserted by counting `exportEncryptedPayload` calls.
- [ ] Who may compact is ONE computed, read by the note, the section, the button
      and the gate — and the owner-vs-admin decision is recorded.
- [ ] Full suite green; every new guard mutation-checked; each mutation verified
      to fail for the RIGHT reason (a check that passed for the wrong reason is
      how terminus 1 shipped broken on 2026-09-05).

## Testing plan

1. Unit: `compareLineage` over document pairs; `rebaseOnto` fixtures
   (create / edit / delete / settings / unknown collection → null).
2. Worker integration: two documents through the real merge path, including the
   envelope-disagrees-with-document case.
3. Multi-device on the test family, repeating the 2026-09-05 sequence exactly:
   B offline edit → A compacts → B reconnects. Expect a rebase and a visible,
   persistent message.
4. Tablet: open the compacted pod on the A9+ and the A7.
5. Production: off-platform backup, then the button, watched.

`lineageWiring.test.ts` is RETIRED. It asserted terminus count by slicing the
`syncStore.ts` source, which is how a broken guard shipped green on 2026-09-05.
Its replacement is a LINT RULE — a source-shaped assertion belongs in the
linter, where it runs on every file and cannot silently match the wrong slice —
plus the worker integration tests above.

## Review passes

- **Pass 1 (initial draft)**: this document, re-derived from the field failure
  and the corrected loss model.
- **Pass 2 (DRY + error handling)**: envelope field DELETED rather than demoted;
  the baseline schema change dropped (the fingerprint is already lossless); the
  rebase rebuilt on `applyMutation` + an extracted `touchedBetween`; the safety
  copy moved onto `getAuxStore`/`resolveAuxFolder` (`getOrCreateAppFolder` was
  the wrong folder for joined families) and its filter onto
  `findBeanpodInFolder`; the soak gate inverted to positive evidence over
  `lastLoginAt` because the original could not fail; `appVersion` string compare
  replaced with an integer epoch; R4 moved onto `ErrorBanner`; `surface()`'s
  double-report closed; every new failure path given a user message and a
  developer breadcrumb. Also added R5/R6 from greg.
- **Pass 3 (sustainability)**: the three silent failures collapsed into ONE
  `NON_COLLECTION_KEYS` declaration, two becoming compile errors; `PodLineage`
  moved to `models.ts`; the worker no longer takes a RUNTIME dependency on
  `remoteBaseline.ts` (heads cross the wire, not a fingerprint); ONE merge entry
  point with a REQUIRED three-arm basis, `adoptRemoteEnvelope` deleted, and the
  cross-family forced adopt given its own arm rather than smuggled through
  `user-file` (which would have merged into a FOREIGN family's document); the
  worker's return given an `action` discriminant and the four termini's
  duplicated tail extracted; **R1.6 rewritten** — it installed then mutated, so
  a throw destroyed the peer's work and made the restore inexpressible (LIVE #3
  re-committed in the plan written to avoid it); the `devices` collection
  replaced by two fields on `FamilyMember` (it contradicted R0's own no-seeding
  rule, invalidated every projection snapshot, and wrote ~365 changes/device/year
  into the history this tier shrinks) and its 24h rule shown to make the gate
  unsatisfiable; `listAux(suffix)` dropped (it clobbers a shared name→id map) in
  favour of one fixed-name copy; R2's `findBeanpodInFolder` premise corrected (no
  production caller); R5.4 corrected (no shared type-to-confirm exists); the
  owner-vs-admin widening made an explicit decision on one computed; the
  losslessness comment upgraded to a round-trip test; the retired wiring test
  replaced by a lint rule; the pure decisions pulled out of `usePodCompaction`;
  `WallStatusStamp` added to R4; ADR-036 made explicit; and the whole thing
  sequenced into four independently shippable stages.
- **Pass 4 (fresh eyes)**: six correctness holes closed and four designs found
  not to work against the code as it stands. `!currentDoc` now short-circuits the
  basis (deriving clean/dirty from a document that does not exist yields `dirty`
  → block — LIVE #5 re-committed); **R0.12 added** — moving the throw into the
  worker routes it through a catch that wraps every non-payload throw in
  `RemoteMergeError`, silently reclassifying every lineage block and disabling R4
  entirely; `kept-local` pinned as an early return so it commits no baseline and
  learns no marker; R0.6 split into one helper PER MODULE (a single shared one is
  a cyclic import), which also closes a still-open instance of finding #7;
  `Automerge.hasHeads` made an explicit precondition (a tolerant view would
  replay the whole old lineage over the compacted document); the diff-root check
  spelled out as four branches, because folding `podLineage` into
  `settingsChanged` would carry the peer's settings over the compactor's; op
  payloads required to be `toPlain`'d. Not working as written: the AuxStore
  cannot address a `.beanpod` sibling at all, so the delete-first step was a
  silent no-op; a fixed safety-copy name is not unique across two families in one
  Google account; changing `exportEncryptedPod` to an object silently passes the
  backup gate; the lint rule as written bans an import both files need. Plus the
  epoch stamp folded into one function rather than seven call sites, the soak
  gate re-run after the pull that makes its input current, the byte measure moved
  off the payload-stripped envelope, R3.3 and R5.4 DECIDED rather than left as
  forks in a final plan, and the tests that will fail to compile listed so they
  are migrated rather than deleted.

## Prompt log

<details>
<summary>Full prompt history</summary>

See `docs/prompts/2026-09/2026-09-04-pod-load-oom.md`. Authorising prompt,
2026-09-05: "ok let's redo the tier 3 plan with this design change", following
the field diagnosis that the guard compares envelopes rather than documents.

</details>
