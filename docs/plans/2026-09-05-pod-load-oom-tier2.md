# Plan: Make a history-heavy pod openable on a 3GB tablet (#90 Tier 2)

> Date: 2026-09-05
> Related issues: Notion #90 (Tier 2). Tier 1 shipped as `docs/plans/2026-09-04-pod-load-oom-tier1.md`.
> Plan file: `docs/plans/2026-09-05-pod-load-oom-tier2.md`
>
> **No GitHub issue created.** Direct implementation, in three separately-shippable phases.

## User Story

As a family running the beanie wall on a cheap or second-hand tablet, I want my
pod to actually open on it — so that the promise the wall is built on (any old
tablet will do) is true, rather than something the app apologises about.

## Context

Tier 1 made the failure honest, non-destructive and measurable, and said plainly
that it could not make the pod load. This is that part.

### The numbers, measured rather than argued

`src/services/automerge/__diagnostics__/beanpodProfile.spec.ts` (added in Tier 1)
against greg's **real production pod**:

```
decrypted binary    3.20MB
changes             14,570
ops                 3,725,253
actors              4,214
save() full         3.20MB
save() compacted    0.21MB      -> 15.1x history multiple
load time           4,269ms
peak RSS            ~707MB
```

And against his **test family** (same shape, ~2/3 the size), profiled full and
then compacted **in a clean process** via the spec's `BEANPOD_COMPACT_OUT=`:

|                    | full      | compacted | ratio |
| ------------------ | --------- | --------- | ----- |
| decrypted          | 2.06 MB   | 0.17 MB   | 12.2x |
| ops                | 2,365,481 | 225,303   | 10.5x |
| changes            | 10,707    | 1         |       |
| actors             | 2,607     | 1         |       |
| load time          | 3,167 ms  | 314 ms    | 10.1x |
| RSS, document only | 334 MB    | 52 MB     | 6.4x  |

334MB is not available to a WebView on a 3GB tablet. 52MB is. Extrapolating to
greg's real pod (1.55x larger) puts a compacted open at roughly 80-100MB, which
still fits. **That is the whole case for this work, and it is measured.**

### Two drivers, and only one of them is safe to fix

**Actor churn (preventive).** `Automerge.load()` mints a fresh random actorId on
every call — verified empirically, and confirmed against the 3.4.1 typings
(`implementation.d.ts:326`: `load<T>(data, _opts?: ActorId | InitOptions<T>)` —
"if the actor ID is null a random actor ID will be created"). So the actor count
grows with SESSIONS, not with data: 4,214 actors for one family, 45% of which
made exactly one change.

**History volume (remedial).** 93% of the file is history. Compaction removes
it. Pinning the actor cannot: it prevents future growth on a pod that is already
too big.

So Tier 2 needs BOTH.

### ⚠️ The finding that shapes this entire plan

**A compacted pod merged into a peer that still holds the original history
destroys that peer's unsynced changes — 200 out of 200 runs.**

`Automerge.from(Automerge.toJS(doc))` mints brand-new object ids, so the
compacted document shares no ancestry with the original. A merge is therefore a
map-level conflict, not a CRDT reconciliation.

Everything below follows from one invariant:

> **A document may only be CRDT-merged with a document of the same LINEAGE.
> Anything else must be adopted wholesale, or refused — never merged.**

## Requirements

1. **A stable per-(device, family) actorId**, passed to every document-creating
   Automerge call in production, and **re-posted after a worker respawn and in
   the inline fallback** — otherwise the churn silently resumes after the first
   worker crash.
2. **No new persisted device identity.** The device already has one
   (`beanies:device-id`); a second one is a DRY violation and a second thing to
   lose.
3. **A pod carries a LINEAGE marker in its envelope.** Absent means "legacy,
   never compacted".
4. **The lineage guard is universal and ships FIRST, ungated.** Every device in
   the fleet must be refusing cross-lineage merges before any device is allowed
   to publish a compaction. The guard is a no-op for a family that never
   compacts (Requirement 9).
5. **Cross-lineage handling is a total function.** Four cases — same, remote
   newer, ours newer, concurrent-conflict — each with an explicit branch. No
   default, no fall-through, no guess.
6. **A device on an older lineage ADOPTS through the path that already exists**
   (`replaceDocWithCacheRecovery`'s cache-miss branch ->
   `mergeRemoteEnvelope`'s `!currentDoc` adopt branch). No second adopt
   implementation.
7. **A device that would lose unsynced work never does so silently.** It stops,
   says so, and the only way forward is through the existing encrypted-export
   flow — the same "refuse to destroy anything unless a file actually landed"
   gate the delete-family flow already enforces.
8. **The compaction is reversible from a file the user holds**, produced by the
   shipped export path before anything is written.
9. **Nothing changes for a pod that has never been compacted.** No new read, no
   new round-trip, no new IDB row, no behaviour change.
10. **The compaction (write) half is behind a DevFlag**, off in production,
    until it has been run against a real pod on a real tablet.

## Important Notes & Caveats

- **`Automerge.from()` is not a compactor, it is a re-creation.** Re-verified
  against `implementation.d.ts` at 3.4.1: `load/init/from/clone` all accept an
  actor; `anonymize` retains history; `saveSince`/`hasHeads` are a transport, not
  a way to drop ancestry. There is no history-trimming primitive.
- **The document is pure JSON.** No `Counter`, no `Text`/`RawString`/
  `ImmutableString` anywhere in `src/` (grep verified), and the projection
  already round-trips every entity through `JSON.parse(JSON.stringify(...))`
  (`docOps.toPlain`). So `toJS -> from` is type-safe by construction. That makes
  the deep-equality gate a verification, not a gamble — but it stays a gate.
- **Nothing derives user-visible data from change authorship.** Grep-verified:
  `getAllChanges`, `decodeChange`, `getHistory` and `inspectChange` appear
  nowhere in `src/` outside `__diagnostics__`. `CreatedMeta`, the activity log
  and the timeline all read fields on the document. **The Tier-2 caveat about
  provenance is therefore RESOLVED, not outstanding.** The only consumers of
  history are `getChanges`/`diff` between two heads of the SAME doc
  (`docOps.ts:61`, `:161`), which a lineage change resets, not corrupts.
- **`mergeDocs` already preserves the local actor.** `Automerge.merge(local,
remote)` keeps `local`'s actorId, and `docOps.ts:125-138` documents why it
  must never be inverted. Phase A therefore has to pin the actor at the three
  CREATION sites only; the merge path is already correct.
- **The worker cannot telemeter.** `perfTiming`'s queue flushes on
  `window`/`pagehide`, which the worker does not have — which is why heavy ops
  relay through `sink.perf` and `docClient` replays them (`applyAndProject.ts`
  module header). **Every compaction event must be emitted from MAIN**, off the
  values the RPC returns. A `reportError` inside `compactDoc` would be dropped
  on the floor — a silent failure by construction.
- **A new worker method must be classified in all five `docClient` sets.** The
  file says so explicitly above `JSON_SAFE_METHODS`. `compactDoc` is HEAVY (a
  whole-doc rebuild), a USER_ACTION (the user pressed a button and their data is
  in doubt if it fails), and **must NOT be RETRYABLE** — a transparent re-issue
  after a respawn would re-compact a doc that has already been replaced. It is
  not JSON_SAFE / ENVELOPE (no args).
- **Old writers preserve unknown envelope fields.** `reEncryptEnvelope`
  (`fileSync.ts`) spreads the parsed envelope, and `preserveLocalKeyDicts`
  spreads `incoming` first, so a pre-Tier-2 build round-trips `podLineage`
  untouched — but it will happily merge across lineages, because it has no
  guard. **This is the whole reason the guard must reach production before any
  compaction is published**, and why Phase C is flagged while Phase B is not.
- **The `remoteUnreadable` latch is the right mechanism and must not be
  duplicated.** `syncService.ts:82-100` already refuses saves, stops the poll and
  reports once per class. A stale-lineage device wants exactly those three
  behaviours. Widen the latch; do not build a second one.
- **A compaction costs more memory than an open.** The original doc, the plain
  JS tree and the new doc are all resident at once. A device that cannot open
  the pod cannot compact it — that is fine (compaction is an owner action on
  their own machine), but the failure must be classified through the existing
  `payloadFailure`/`isAllocationFailure` classifier so an OOM there reads as
  "this device ran out of memory", not "your data is damaged".
- **The compacted doc must NOT be persisted to cache before it is published.**
  Every other doc-installing path schedules a persist; this one deliberately does
  not, so that a failed publish is recoverable by a reload (cache and remote both
  still hold the pre-compaction lineage). This is the single deviation from the
  house pattern in the whole plan; it is load-bearing and must be commented.
- **The actorId must be a valid Automerge actor** — an even-length lowercase hex
  string. Derive with `crypto.subtle.digest` and hex-encode; never a dashed UUID.
- **Do not pin the actor to the MEMBER id.** Two devices sharing a lane
  interleave changes into one sequence and defeat the run-length compression
  Automerge relies on.

## Assumptions

> Review these before implementation.

1. The measurements above hold at implementation time. Re-run the profiler
   first; the pod grows daily.
2. `Automerge.from(toJS(doc))` preserves every field the app reads. Structurally
   supported (see the pure-JSON caveat), and still **gated** by a deep-equality
   check across all 29 collections plus `settings`, inside the worker, refusing
   the compaction on any difference.
3. Drive keeps a version history that could serve as a second recovery route.
   Not relied on — the user-held export is the primary route.

## Approach

### Phase A — the stable actor (independent, unflagged, ships first)

**A1. One device identity, extracted, not re-invented.**
`getDeviceId()` already exists as a private function in
`calendarSyncStore.ts:162` (localStorage `beanies:device-id`). Move it verbatim
to `src/utils/deviceId.ts`, import it back into `calendarSyncStore`, and fix the
one defect it has:

> its `catch` returns the constant `'unknown-device'`. For calendar
> reconciliation that is merely lossy; for an ACTOR it is a correctness bug —
> every private-mode device in the fleet would share one lane. Replace with:
> mint a random id, memoise it in module state, `logEvent` a warning naming
> localStorage as the cause. Same failure direction as today (a per-session id),
> never a shared one, and never silent.

**A2. Derive the actor — persist nothing new.**

```
src/services/automerge/deviceActor.ts
  export async function deviceActorId(familyId: string): Promise<string>
  //  hex(SHA-256(deviceId + '\0' + familyId)).slice(0, 32)
```

Deterministic, per-(device, family) by construction, valid hex, 128 bits, and
**zero new storage, zero migration, zero fallback ladder**. A cleared
localStorage simply produces a new device id and therefore one new lane — the
same cost as a re-install, which is correct. Memoised per familyId.

**A3. One realm-scoped holder, so a forgotten call site cannot go silent.**
`src/services/automerge/worker/docActor.ts` — `setDocActor(actor)` /
`docInitOpts()`, imported by `docOps` and `cache`. `docInitOpts()` returns
`{ actor }` or `undefined`, and warns ONCE per realm when it is called with no
actor set, naming the plumbing. (Module-level realm identity, not document
state — `docOps`'s purity contract is about the doc, and Automerge itself keeps
the actor at exactly this scope.)

Wired at:

- `docOps.loadDoc` (`docOps.ts:48`)
- `docOps.loadAndVerify` (`docOps.ts:230`) — covers `cache.ts:313` and `:364`
- `applyAndProject.initDoc` (`applyAndProject.ts:447`)
- `applyAndProject.loadSnapshot` (`applyAndProject.ts:854`, DEV/E2E — included so
  the E2E seed path matches production)

**A4. Post it the way the key is posted, including the two re-drive paths.**
New `setActor` RPC beside `setKey` in the dispatch table, set from
`docClient.setFamilyKey`'s neighbour and — the part the first draft missed —
re-posted from **`spawn()` (`docClient.ts:324`)** and **`enterInlineMode()`
(`docClient.ts:275`)**, which today re-drive only `familyKey`. Without both, the
first worker crash silently un-pins the actor for the rest of the session.
Retained in the same module-state block as `familyKey`, cleared by `reset()`.

**A5. Ship Phase A alone.** No migration risk; its benefit compounds from the day
it lands; and its effect is directly measurable as `numActors` in the profiler.

### Phase B — the lineage guard (independent, unflagged, ships second)

Read-side only. Nothing in this phase can produce a compaction; it can only
refuse to merge one. It must be in production and soaked before Phase C is
enabled anywhere.

**B1. One additive optional envelope field.**

```ts
// types/syncFileV4.ts — ADDITIVE OPTIONAL on '4.0', never a version bump
// (same contract as recoveryKeys). Absent => legacy, never compacted.
podLineage?: { id: string; seq: number };
```

`id` is a UUID minted per compaction; `seq` is monotonic and exists ONLY to give
direction. **No `envelopeMerge` change is needed and none should be added**:
`preserveLocalKeyDicts` spreads `incoming` first (so the remote's lineage wins,
which is correct — the file is the authority), `withoutPayload` preserves it, and
`reEncryptEnvelope` spreads it onto every write. Verified by reading all three.

**B2. One pure comparator, one exhaustive switch.**

```
src/services/sync/podLineage.ts        (pure, no I/O, no state — like remoteBaseline.ts)
  export type LineageVerdict = 'same' | 'adopt-remote' | 'ours-newer' | 'conflict';
  export function compareLineage(remote, local): LineageVerdict
```

- both absent, or ids equal -> `same` (today's behaviour, byte for byte)
- `remote.seq > local.seq`, or remote present and local absent -> `adopt-remote`
- `remote.seq < local.seq`, or local present and remote absent -> `ours-newer`
- equal `seq`, different `id` -> `conflict` (two devices compacted concurrently —
  never guess; see B5)

**B3. The local side is the CACHED ENVELOPE — no new storage.**
`docClient.readEnvelope()` already returns it, `syncStore.ts:1553` already reads
it in the same breath as the cached doc and already refuses to proceed unless
BOTH hit (`if (!cachedEnvelope || !loaded) return`). That pairing is precisely
the invariant a lineage record needs, and it already exists. In-session the
answer is `syncService.getEnvelope()?.podLineage`. Nothing new is written,
cached, migrated or cleaned up.

**B4. Adopt through the path that already adopts.**
`syncStore.replaceDocWithCacheRecovery` — read the cached envelope's lineage
BEFORE `initAndLoadCache`. On `adopt-remote`:

1. `docClient.clearCache(familyId)` — drops the doc and deletes the stale-lineage
   cache DB in one existing call (`applyAndProject.clearCache`);
2. `docClient.openCache(familyId)` — the existing "open the DB, deliberately do
   not load" primitive built for `createNewFile`, which is exactly this
   situation;
3. fall into the existing `mergeRemoteEnvelope(..., 'adopt')`, whose `!currentDoc`
   branch installs the remote wholesale, resets cursors and pushes a full
   projection.

**Not one line of new adopt logic.** Three existing RPCs in the order they were
built for.

**B5. Make the merge/adopt choice a REQUIRED argument, so it cannot be defaulted.**
`docClient.mergeRemoteEnvelope(envelope, familyId, mode: 'merge' | 'adopt')` —
required third parameter, the same discipline `commitRemoteBaseline(driveHeads)`
uses and for the same stated reason ("any future terminus is forced by the
compiler to answer the question rather than over-claiming by omission"). In
`'adopt'` mode the worker drops its doc first, so a cross-lineage merge becomes
structurally impossible rather than conventionally avoided. The compiler names
the three call sites (`syncStore.ts:901`, `syncStore.hydrateFromEnvelope`,
`syncService.fetchAndMergeRemote`).

**B6. Mid-session: reuse the latch, do not clone it.**
`fetchAndMergeRemote` compares before merging:

- `same` -> unchanged behaviour.
- `adopt-remote` -> **do not merge, do not adopt mid-session.** The doc is live and
  ~21 stores are projecting from it; swapping it underneath them is a far larger
  change than this problem justifies. Latch instead, and let the reload do the
  adopt through B4 — one adopt implementation, one instruction to the user.
- `ours-newer` -> only reachable in the seconds between compacting and publishing.
  Do not merge. If the remote actually CHANGED (the only way we got here), refuse
  the save too: a peer wrote during the compaction and overwriting them would be
  silent loss. Latch, report, and tell the owner to reload and retry — the
  compacted doc was never persisted (see the caveat), so the reload is a clean
  rollback.
- `conflict` -> refuse both directions, latch, report at `critical`. Two lineages
  claim the same generation; a machine cannot pick and must not.

The latch: **widen the existing one** rather than adding a second. `remoteUnreadable`
becomes `remoteBlocked: PayloadLoadError | PodLineageError`, `isRemoteUnreadable()`
is renamed `isRemoteBlocked()` (the compiler finds all eight readers — `syncStore`
x6, `authStore.ts:2366`, the mock), and `noteLineageBlocked(err)` sits beside
`noteRemoteUnreadable` sharing its once-per-class `reportedUnreadableSteps`
throttle. `PodLineageError` carries the verdict as `code` and registers in
`protocol.ERROR_REGISTRY` through the **existing `payloadCodec` factory pattern**
(a literal key, never `Ctor.name` — the minifier caveat still applies), so
`instanceof` survives `postMessage`.

**B7. The user-facing surface reuses everything.** `syncStore.podUnopenable` (the
existing latch mirror) already drives `BackgroundSyncBar` with
`sync.podUnopenable` + a per-class inline reason string, exactly as
`podTooLarge.inline` does today. Add one inline string per verdict. For a
verdict raised at OPEN (not mid-session), `surfacePayloadFatal`'s sibling in
`utils/payloadFailureSurface.ts` raises the existing fatal overlay whose Reload
button is the action — the same "the overlay's own button IS the CTA" conclusion
Tier 1 reached, with `clearDataHelps: false` for the same reason.

### Phase C — publishing a compaction (flagged, ships last)

**C1. The flag.** `src/config/flagRegistry.ts` (not `src/constants/featureFlags.ts`,
which does not exist) + `false` in `featureFlags.committed.ts`. The dev-only
Feature Flags card lists it automatically — no UI work.

**C2. The UI is a row, not a modal.** Owner-only section of the existing Family
Data drawer in `SettingsPage.vue`, beside Pod Ownership (`:1907`), which is
already documented as the home for "rare, owner-only, once-per-pod-lifetime"
actions. Label + description + `BaseButton`, a busy ref (the file's stated
convention for every delivery call site), and `useConfirm.confirm()` for the
warning — the branded dialog that already exists. **No new component, no new
modal, no new store.**

**C3. The sequence — every step an existing call.**

1. **Gate.** Flag on, `isOwner`, provider configured, `canDurablySaveNow()`.
2. **Prove we are current and clean.** `await syncService.flushPendingSave()`,
   then `syncNow(false)`; require `true`. Then `remoteChanged()` must be
   `unchanged` and `hasUnpushedChanges(baselineFp, headsFp)` must be false —
   the exact pair `unpushedLocalChangesCheck` (`syncService.ts:871`) already
   computes. Refuse with `error_code: 'not-synced'` otherwise.
3. **Backup, gated on delivery.** `syncStore.buildExportEnvelope()` +
   `deliverFile({ preferDownload: true })`, and **refuse to continue unless
   `result.delivered`** — verbatim the delete-family gate at
   `SettingsPage.ts:791`, including its native "we cannot prove the share saved,
   so ask a human" confirm. The exported `.beanpod` is a complete, openable pod:
   the rollback route is "open this file", which the product already supports.
   Provider-agnostic, so no dated-sibling-file write path is invented.
4. **Compact, in the worker, verified.** One new RPC `compactDoc`:
   `Automerge.from(toJS(doc), { actor })` -> deep-compare
   `toJS(before)` vs `toJS(after)` -> install only on equality. On any difference,
   **keep the old doc** and throw with the JSON PATH of the first difference
   (path only, never values — the firehose is PII-free). On any throw, classify
   through the existing `payloadFailure()` so an OOM here is a
   `PayloadTooLargeError` with the honest copy already written. Returns
   `{ beforeBytes, afterBytes, changesBefore, changesAfter, actorsBefore }`.
   **Schedules no persist** (see the caveat).
   New pure util `src/utils/firstJsonDifference.ts` — order-insensitive for object
   keys, order-sensitive for arrays, returns a dotted path or `null`. Reused by
   the diagnostic spec. (`diffPayload.ts` is explicitly documented as "do not grow
   this into a general object-diff library", so it is correctly not reused.)
5. **Stamp the lineage.** `replaceEnvelope({ ...envelope.value, podLineage: { id:
generateUUID(), seq: (old?.seq ?? 0) + 1 } })` — the mandated write path,
   which also re-persists the envelope cache.
6. **Publish through the existing save.** `syncService.saveNow()`. `doSave` does
   the export, `reEncryptEnvelope`, the write, the revision ack, the baseline
   commit, the failure ladder and the telemetry — all of it already correct. B6's
   `ours-newer` branch is what makes the pre-write `fetchAndMergeRemote` safe.
7. **Persist and confirm.** `docClient.flush()` on success; toast; emit the
   `published` event with before/after bytes.

**C4. Failure handling, per step, no bare catches.** Steps 1-3 refuse with a
toast carrying `surface: 'pod-compaction'` + `error_code`, and change nothing.
Step 4 leaves the doc untouched by construction. Steps 5-6 are the only window
where state has moved: on failure, report at `severity: 'critical'` (the one
place a human should look), tell the user their backup is on disk and to reload,
and leave the latch to B6. There is no partial state a reload cannot resolve,
because the cache still holds the pre-compaction doc.

### Files affected

- `src/utils/deviceId.ts` (new, extracted) + `src/stores/calendarSyncStore.ts:162` (import it)
- `src/services/automerge/deviceActor.ts` (new)
- `src/services/automerge/worker/docActor.ts` (new)
- `src/services/automerge/worker/docOps.ts` (`:48`, `:230`), `applyAndProject.ts`
  (`:447`, `:854`, `mergeRemoteEnvelope`, `compactDoc`), `docClient.ts` (`:275`,
  `:324`, the five method sets, `mergeRemoteEnvelope`'s required mode,
  `compactDoc`), `protocol.ts` (`PodLineageError` codec)
- `src/types/syncFileV4.ts` (`podLineage`), `src/types/sync.ts` (`PodLineageError`)
- `src/services/sync/podLineage.ts` (new, pure)
- `src/services/sync/syncService.ts` (widened latch + rename, `fetchAndMergeRemote` verdict)
- `src/stores/syncStore.ts` (`replaceDocWithCacheRecovery`, `hydrateFromEnvelope`, `compactPod`)
- `src/utils/payloadFailureSurface.ts` (lineage variant of the fatal surface)
- `src/utils/firstJsonDifference.ts` (new, pure)
- `src/config/flagRegistry.ts`, `src/config/featureFlags.committed.ts`
- `src/pages/SettingsPage.vue`, `src/services/translation/uiStrings.ts` (`en` + `beanie`)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts` (deep-equality gate)

**Not touched, and why:** `envelopeMerge.ts` — the remote-wins semantics the
lineage needs already fall out of `preserveLocalKeyDicts`' spread order.
`fileSync.ts` — `reEncryptEnvelope` already carries unknown fields. Any new
IndexedDB store — the cached envelope and `beanies:device-id` already carry
everything. Any new modal or CTA mechanism — `useConfirm`, `deliverFile` and the
fatal overlay's own Reload button cover all three surfaces.

## Observability Coverage

All emitted **from main**, because the worker cannot telemeter.

- **`surface: 'device-actor'`** — `action: minted | reused | unstable`
  (`unstable` = localStorage unavailable, the one case that still churns). If the
  mint rate per session does not fall to near zero, Phase A is not working.
- **`surface: 'pod-lineage'`** — `action` one of `adopted` / `blocked` /
  `conflict`, `error_code` = the verdict. `blocked` and `adopted` together give
  the ADOPTION RATE across a family's devices, which is the failure mode that
  loses data quietly. `conflict` is `critical`; the rest are firehose-only.
- **`surface: 'pod-compaction'`** — `action` one of `refused` / `verified` /
  `published` / `failed`, `error_code` carrying the reason (`not-synced`,
  `backup-not-delivered`, `verify-mismatch`, `write-failed`, `oom`), plus
  `perf_doc_bytes` (after) and `detail` (`before=<kb>,changes=<n>,actors=<n>` —
  the flat-scalar format `web_storage` and Tier 1's device probe already use).
  `critical` ONLY for `failed` after the lineage was stamped.
- **No new allowlisted context keys.** `action`, `error_code`, `perf_doc_bytes`,
  `detail`, `family_id`, `severity` are all already in `ALLOWED_CONTEXT_KEYS`
  (verified in `diagnosticContext.ts`), so no Lambda-mirror, runbook,
  `PrivacyInfo.xcprivacy` or Data-Safety change is owed. One comment line at the
  `detail` declaration records the new per-surface meaning, as Tier 1 did.
- **Every message is constant per class** — sizes ride in `perf_doc_bytes` — so
  `errorReporter`'s `(surface, normalizeMessage)` dedup buckets instead of
  fragmenting per pod.
- **No silent failures:** the compaction verify names the differing path; the
  actor holder warns once per realm if it is ever called unset; the refusals are
  all user-visible; and the only `catch {}`-shaped code is the existing
  best-effort cache cleanup.

## Acceptance Criteria

- [ ] Phase A: two `load` cycles on one device produce ONE actor, and the actor
      survives a simulated worker crash + respawn and the inline fallback.
- [ ] Phase A ships independently and is on in production.
- [ ] `getDeviceId` exists once, in `src/utils/deviceId.ts`, and never returns a
      shared constant.
- [ ] `compareLineage` is total: every one of the four verdicts has a test and an
      explicit branch at every consumer; the "both absent" case is byte-identical
      to today.
- [ ] Phase B ships to production UNGATED and soaks before Phase C is enabled
      anywhere.
- [ ] A device on the old lineage ADOPTS rather than merges — proven by a test
      that reproduces the 200/200 loss without the guard and shows it gone with
      it — and does so through the existing cache-miss adopt branch, with no new
      adopt code.
- [ ] A device with unsynced changes never adopts silently: it latches, is
      visible, and refuses saves.
- [ ] `Automerge.from(toJS(doc))` verified deep-equal across all 29 collections
      and `settings` on greg's real pod before any write path is enabled.
- [ ] A compaction refuses unless a `.beanpod` backup actually landed.
- [ ] A failed publish is fully recoverable by a reload (the compacted doc was
      never persisted to cache), pinned by a test.
- [ ] `compactDoc` is classified in all five `docClient` method sets and is NOT
      retryable.
- [ ] greg's real pod opens on the Galaxy Tab A9+ and the Tab A7 after
      compaction. **This is the criterion the whole plan exists for, and it is
      on-device, not a unit test.**
- [ ] Observability events fire as listed, add zero context keys, and are visible
      in CloudWatch.

## Testing Plan

1. Re-run the profiler on greg's current real pod; record the numbers.
2. Phase A units: pinned actor across two loads; across `initDoc`; across a
   cache reconstruct; re-posted after `spawn()` and after `enterInlineMode()`;
   `deviceActorId` is 32 lowercase hex chars, stable per (device, family) and
   different across families; the localStorage-throws path mints a per-session id
   and logs, never a constant.
3. `compareLineage` table test — all four verdicts, plus both-absent, plus the
   `seq`-equal/`id`-different conflict.
4. Adopt test: build a doc, compact it, have a simulated peer make an unsynced
   change on the OLD lineage, and assert the guard preserves it (refusal) while a
   naive merge loses it.
5. `mergeRemoteEnvelope`'s `'adopt'` mode drops the doc first — assert the doc is
   installed wholesale and the cursors reset.
6. Latch tests: each blocking verdict refuses `doSave`, stops the poll, reports
   exactly once per class, and clears on a successful same-lineage merge.
7. `firstJsonDifference` — equal trees, key-order-insensitive, array-order-
   sensitive, and a path returned for a nested difference; and `compactDoc`
   refuses + keeps the old doc when it differs.
8. Compaction refusal matrix: not owner, flag off, not synced, backup not
   delivered, remote changed mid-flight — each leaves the doc and the envelope
   untouched.
9. Deep-equality gate on the real pod via the diagnostic spec (env-gated).
10. On-device: sideload to the Tab A9+ and the Tab A7, open the compacted pod,
    confirm it loads and that a subsequent edit round-trips to another device.
11. Rollback rehearsal: open the pre-compaction export as the pod and confirm the
    family works on it.
12. Full battery: type-check, eslint, stylelint, unit suite, build.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the Tier 1 measurements plus the
  compaction/merge hazard measured on 2026-09-05.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code
  and replaced the ones that did not hold. (a) **The epoch design was unsound** —
  a monotonic counter gives direction but not identity, so two concurrent
  compactions produce equal epochs on incompatible lineages and merge, silently,
  which is the exact 200/200 failure; replaced with `{id, seq}` and a total
  four-verdict comparator with no default branch. (b) **The push-before-adopt
  rule was destructive as written** — pushing an old-lineage doc over a compacted
  remote silently discards every post-compaction edit; replaced with adopt-when-
  clean / latch-when-not, reusing the existing `remoteUnreadable` latch rather
  than cloning its three behaviours. (c) **Three claimed new files already
  exist**: the adopt path (`replaceDocWithCacheRecovery`'s cache-miss branch +
  `openCache` + `clearCache`), the local lineage store (the cached envelope,
  already read in the same breath as the cached doc), and the backup writer
  (`buildExportEnvelope` + `deliverFile`, with the delete-family "refuse unless
  delivered" gate as precedent) — all three bespoke implementations deleted, and
  with them a per-family IndexedDB actor store, a dated provider-side file write
  and a new modal. (d) **`envelopeMerge` needs no change at all** —
  `preserveLocalKeyDicts` already spreads `incoming` first and `reEncryptEnvelope`
  already spreads unknown fields, so remote-wins lineage propagation is free. (e)
  **Two paths would have silently un-pinned the actor** — `spawn()` and
  `enterInlineMode()` re-drive only `familyKey`; both now re-post the actor, and a
  realm-scoped holder warns once if it is ever asked for an unset actor. (f) **A
  worker-side telemetry call would have been dropped on the floor** (`perfTiming`
  cannot flush in a worker) — all compaction events moved to main. (g) **The
  device identity was about to be duplicated** — `getDeviceId` already exists in
  `calendarSyncStore.ts:162`; extracted, reused, and its `'unknown-device'`
  constant fallback fixed, since for an actor it would put every private-mode
  device in one lane. (h) **Wrong path**: `src/constants/featureFlags.ts` does not
  exist (`src/config/flagRegistry.ts` + `featureFlags.committed.ts` do), and a new
  worker method must be classified in all five `docClient` sets — `compactDoc`
  must not be retryable. (i) **Two open caveats resolved by grep rather than left
  to implementation**: nothing in `src/` reads change authorship
  (`getAllChanges`/`decodeChange`/`getHistory` appear only in `__diagnostics__`),
  and the document is pure JSON (no `Counter`/`Text`), so `toJS -> from` is
  type-safe. (j) Sequencing corrected: the guard must be in production ungated
  before any compaction is publishable, because old writers preserve the lineage
  field but do not honour it. (k) The compacted doc is deliberately not persisted
  to cache before publication, which turns a failed publish into a reload.
- **Pass 3 (Sustainability)**: pending.
- **Pass 4 (Fresh-eyes sweep)**: pending.

## Prompt Log

<details>
<summary>Full prompt history</summary>

See `docs/prompts/2026-09/2026-09-04-pod-load-oom.md` — this plan continues the
same task. The authorising prompt for Tier 2 is greg's 2026-09-04 ~23:00
message: "once that is compelte, move directly into /beanies-plan for the tier 2
changes as per the results of the script."

</details>
