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
destroys that peer's unsynced changes about HALF the time — a coin flip.**

> ⚠️ CORRECTION (2026-09-05). This was first written as "200 out of 200 runs",
> and that figure was an artefact of the probe: it built the pod and its
> compaction ONCE at module scope and looped 200 times, so every iteration
> inherited a single random actor-id ordering. The same probe reported 200/200
> LOST on one run and 200/200 KEPT on the next. Rebuilding both inside the loop
> gives ~40-50% loss, stable across runs. **Non-deterministic loss is worse than
> deterministic loss, not better** — it survives testing, demos and the first
> few families, and then takes someone's data. The design does not change; the
> claim does. Measured by `src/services/sync/__tests__/lineageProtectsPeerEdits.test.ts`.

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
5. **Cross-lineage handling is a total function, and the POLICY lives in one
   place.** Four verdicts x three CONTEXTS = one exported table in one module.
   No consumer re-derives policy; no default, no fall-through.

   > ⚠️ The context axis is **not** "open vs mid-session" (that was the draft's
   > mistake, and it was fatal). It is _what this device can prove about its own
   > document_: `clean` (our doc provably holds nothing the remote has not seen),
   > `dirty` (it might), `user-file` (the human explicitly chose these bytes).
   > A wall-clock phase gets both ends wrong: a peer's FIRST post-compaction sync
   > arrives through `fetchAndMergeRemote` (which the draft classified `session`,
   > i.e. `block`), so under the draft **every peer in the fleet latches and never
   > adopts** — the compaction could never propagate. And it blocks the rollback
   > route too; see Requirement 8 and B2.

6. **A device on an older lineage ADOPTS through the path that already exists**
   (`dropDoc()` -> `mergeRemoteEnvelope`'s `!currentDoc` adopt branch). No second
   adopt implementation, and no second way to SAY "adopt".
7. **A device that would lose unsynced work never does so silently, and the
   proof is one already-computed fact.** "Unsynced" means
   `hasUnpushedChanges(baselineFp, headsFingerprint(heads))` — the exact #65
   comparison `unpushedLocalChangesCheck` already makes, over the baseline row
   `initAndLoadCache` already returns in the SAME round-trip. Unknown counts as
   dirty (a null `baselineFp`, or a failed heads probe): the same fail-safe
   direction that module already documents. A `dirty` device stops, says so, and
   the only way forward is the existing encrypted-export flow — the same "refuse
   to destroy anything unless a file actually landed" gate the delete-family flow
   already enforces.

   > **The one stated exception, and it is the reason this plan exists.** If
   > `initAndLoadCache` throws `deviceCannotOpen` (OOM) we cannot read our own
   > heads — but a device that cannot load its own cache also cannot push,
   > export or even display those changes; they are already unreachable, and
   > `block` would leave that device permanently broken, which is the exact
   > failure Tier 2 exists to end. So on `deviceCannotOpen` + `adopt-remote` we
   > ADOPT, and say so out loud: `surface: 'pod-lineage', action: 'adopted',
error_code: 'unprovable'`, `severity: 'warning'`. Explicit, measurable, and
   > never the default path.

8. **The compaction is reversible from a file the user holds** — the exported
   `.beanpod`, produced by the shipped export path and proven delivered before
   anything is written. That file is the ONLY rollback route, so the gate on it
   is load-bearing rather than a courtesy.
9. **Nothing changes for a pod that has never been compacted.** No new read, no
   new round-trip, no new IDB row, no behaviour change.
10. **The compaction (write) half is behind a DevFlag**, off in production,
    until it has been run against a real pod on a real tablet — and the flag has
    a written retirement criterion so it does not become permanent furniture.
11. **The local cache is never internally inconsistent.** The cached envelope's
    `podLineage` must never describe a document the cache does not hold. This is
    the invariant that makes a failed publish recoverable rather than a
    dead-end; see the ordering rule in C3.

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
- **The verification compares WHOLE DOCUMENTS, never a list of collections.** A
  per-collection checklist ("all 29 plus settings") is a maintenance trap: it is
  correct only until the next collection is added, and it fails open. One
  `firstJsonDifference(toJS(before), toJS(after))` over the roots covers every
  present and future collection with nothing to keep in step.
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
- **Installing a rebuilt document MUST reset the persist cursors.** Every
  existing install site does it (`loadSnapshot`, the `!currentDoc` adopt branch,
  `dropDoc`) with the same comment: "fresh doc -> first persist writes a base".
  The compacted document shares no ancestry with the cached one, so a persist
  that wrote an INCREMENT against it would produce an unreadable cache. This is
  the single easiest way to get Phase C catastrophically wrong, and it is one
  line: `resetDocCursors()`.
- **The worker cannot telemeter.** `perfTiming`'s queue flushes on
  `window`/`pagehide`, which the worker does not have — which is why heavy ops
  relay through `sink.perf` and `docClient` replays them (`applyAndProject.ts`
  module header). **Every compaction event must be emitted from MAIN**, off the
  values the RPC returns. A `reportError` inside `compactDoc` would be dropped
  on the floor — a silent failure by construction.
- **A new worker method must be classified in all five `docClient` sets.**
  `worker/docClient.ts:352` says so explicitly above `JSON_SAFE_METHODS`.
  `compactDoc` is HEAVY (a whole-doc rebuild), a USER_ACTION (the user pressed a
  button and their data is in doubt if it fails), and **must NOT be RETRYABLE** —
  a transparent re-issue after a respawn would re-compact a doc that has already
  been replaced. It is not JSON_SAFE / ENVELOPE (no args).
- **Old writers preserve unknown envelope fields.** `reEncryptEnvelope`
  (`fileSync.ts`) spreads the parsed envelope, and `preserveLocalKeyDicts`
  spreads `incoming` first, so a pre-Tier-2 build round-trips `podLineage`
  untouched — but it will happily merge across lineages, because it has no
  guard. **This is the whole reason the guard must reach production before any
  compaction is published**, and why Phase C is flagged while Phase B is not.
- **`dropDoc()` is already the way this codebase says "adopt".**
  `worker/applyAndProject.ts` documents it as exactly that, and **three** call
  sites use it as an UNCONDITIONAL `dropDoc()`-then-`mergeRemoteEnvelope()` pair:
  `syncStore.ts:1103+1108` (background sync, no famId), `:1349+1350` and
  `:2162+2163` (the two `decryptPendingFile*` no-famId branches). A second way to
  express adopt — a mode flag threaded through a seven-call-site API — would be a
  synonym, not a safeguard. Give the existing pair a NAME instead (B5).

  ⚠️ **`syncStore.ts:902` is the fourth `dropDoc()` and it is NOT a pair.** It
  reads `if (!loadedFromCache) await docClient.dropDoc();` — a CONDITIONAL drop
  guarding cross-family corruption, immediately followed by the merge on the next
  line. Collapsing it into `adoptRemoteEnvelope()` would turn the cache-recovery
  merge into an unconditional adopt and silently discard every unsynced cached
  change on the one path built to preserve them. It stays exactly as it is.

- **The `remoteUnreadable` latch is the right mechanism and must not be
  duplicated.** `syncService.ts:97-125` already refuses saves, stops the poll and
  reports once per class. A stale-lineage device wants exactly those three
  behaviours. Widen the latch; do not build a second one — and widen it through a
  shared INTERFACE, not a union, so no consumer has to narrow (B6).
- **A compaction costs more memory than an open.** The original doc, the plain
  JS tree and the new doc are all resident at once. A device that cannot open
  the pod cannot compact it — that is fine (compaction is an owner action on
  their own machine), but the failure must be classified through the existing
  `payloadFailure()`/`isAllocationFailure` classifier so an OOM there reads as
  "this device ran out of memory", not "your data is damaged".
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
   supported (see the pure-JSON caveat), and still **gated** by a whole-document
   deep-equality check inside the worker, refusing the compaction on any
   difference.
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

**Use `sha256Hex` from `src/utils/encoding.ts`** — it already exists and is
already `crypto.subtle.digest('SHA-256', …)` + hex, so "derive with
`crypto.subtle.digest` and hex-encode" would be a fourth hand-rolled copy of a
two-line helper this repo has centralised.

**Failure direction, stated because it is not obvious.** `crypto.subtle` is
absent in a non-secure context and `digest` can reject (`hashedCodeGate.ts`
already handles exactly this). `deviceActorId` therefore returns
`Promise<string | null>` and NEVER throws: `null` means "no actor",
`docInitOpts()` returns `undefined`, and Automerge mints a random one —
**precisely today's behaviour**. An actor-derivation failure must never be able
to stop a pod from opening; that would be Phase A, a pure optimisation, causing
the outage Phase C exists to cure. The `null` case emits the `unstable`
device-actor event.

**A3. One realm-scoped holder, so a forgotten call site cannot go silent.**
`src/services/automerge/worker/docActor.ts` — `setDocActor(actor)` /
`docInitOpts()`, imported by `docOps` and `cache`. `docInitOpts()` returns
`{ actor }` or `undefined`, and warns ONCE per realm when it is called with no
actor set, naming the plumbing.

Its own module rather than a corner of `docOps` for one stated reason: `docOps`
is pure doc-in/doc-out and holding realm state in it would break that contract
for every future reader. Three files, one export each, ~60 lines total — the
boundary is "identity (`deviceId`) -> derivation (`deviceActor`) -> realm state
(`docActor`)", and no file spans two of those.

Wired at:

- `docOps.loadDoc` (`docOps.ts:48`)
- `docOps.loadAndVerify` (`docOps.ts:230`) — covers `cache.ts:313` and `:364`
- `applyAndProject.initDoc` (`applyAndProject.ts:447`)
- `applyAndProject.loadSnapshot` (`applyAndProject.ts:854`, DEV/E2E — included so
  the E2E seed path matches production)

**A4. Post it through the seam the key already uses — ONE seam, not a neighbour.**

`docClient.setFamilyKey(key)` becomes `setFamilyKey(key, familyId)`. It derives
the actor, retains it beside `familyKey`, and posts `setActor` **before**
`setKey`, in one awaited sequence. "The neighbour of `setFamilyKey`" would be
**five** main-side call sites, five chances to forget, and five places to
remember forever. One required parameter on the existing seam is
compiler-enforced, touches the same five sites once, and cannot be forgotten by a
future sixth. (Two of those sites compute `famId` just AFTER the call; hoist it
above — a pure move, no behaviour change.) It also fixes a latent gap for free:
`currentFamilyId` is today set only by the cache-open RPCs, so a respawn before
one of those had no rehydrate target.

Re-driven from **`spawn()`** and **`enterInlineMode()`**, which today re-drive
only `familyKey`. Two ordering rules, both load-bearing:

1. `setActor` is posted **before** `setKey` and **before** the rehydrator runs —
   the rehydrator loads the doc, and an actor arriving after that has pinned
   nothing;
2. it is retained in the same module-state block as `familyKey` and cleared by
   the same `reset()`, so there is one lifetime, not two.

**Classify `setActor` in all five `docClient` sets** — the plan's own caveat, and
the draft never applied it to its own new method. `RETRYABLE` (idempotent state
post, exactly like `setKey`, which is already in that set); NOT `HEAVY`, NOT
`ENVELOPE`, NOT `USER_ACTION`; `JSON_SAFE` is moot (a plain string) and it is
left OUT, matching `setKey`'s exclusion, so that set keeps meaning "args that
could carry a Vue proxy".

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

**B2. One pure module: a comparator AND the policy it feeds.**

```
src/services/sync/podLineage.ts   (pure, no I/O, no state — like remoteBaseline.ts)
  export type LineageVerdict = 'same' | 'adopt-remote' | 'ours-newer' | 'conflict';
  export type LineageAction  = 'merge' | 'adopt' | 'publish-local' | 'block';

  export type LineageContext = 'clean' | 'dirty' | 'user-file';

  export function compareLineage(remote, local): LineageVerdict
  export function lineageAction(verdict, ctx: LineageContext): LineageAction
```

`compareLineage`:

- both absent, or ids equal -> `same` (today's behaviour, byte for byte)
- `remote.seq > local.seq`, or remote present and local absent -> `adopt-remote`
- `remote.seq < local.seq`, or local present and remote absent -> `ours-newer`
- equal `seq`, different `id` -> `conflict` (two devices compacted concurrently —
  never guess)

`lineageAction` is the whole policy, as one 12-row table:

| verdict        | `clean`         | `dirty`         | `user-file` |
| -------------- | --------------- | --------------- | ----------- |
| `same`         | `merge`         | `merge`         | `merge`     |
| `adopt-remote` | `adopt`         | `block`         | `adopt`     |
| `ours-newer`   | `publish-local` | `publish-local` | `adopt`     |
| `conflict`     | `block`         | `block`         | `adopt`     |

Three properties this table has and the `open`/`session` one did not:

1. **The whole `same` column is `merge`.** Every action for a never-compacted
   pod is byte-for-byte today's behaviour in every context — Requirement 9,
   discharged by the shape of the table rather than by inspection.
2. **`adopt-remote` + `clean` is `adopt` everywhere**, including inside
   `fetchAndMergeRemote`. That is the ONLY route by which a compaction reaches a
   peer, and the draft closed it.
3. **The `user-file` column never blocks.** The user picked these bytes; that IS
   the human decision the guard exists to demand. Without this column **the
   rollback route is blocked by the guard itself** — a device holding lineage
   N+1 that opens the pre-compaction `.beanpod` (lineage N) reads `ours-newer`
   and refuses the one file Requirement 8 calls the only rollback route. The
   guard would have made the recovery it mandates impossible.

**Why a table rather than an exhaustive switch at each consumer:** there are
three consumers, and a switch at each is the same policy written three times,
drifting independently the first time a fifth verdict or a fourth context
appears. Consumers switch on FOUR actions they can actually perform, which is
the thing they are qualified to decide; the module owns what the verdicts MEAN.
It is table-tested in one place (12 rows), and adding a verdict or a context is
a compile error in exactly one file.

**B3. The local side is the CACHED ENVELOPE — no new storage.**
`docClient.readEnvelope()` already returns it, `syncStore.ts:1553` already reads
it in the same breath as the cached doc and already refuses to proceed unless
BOTH hit (`if (!cachedEnvelope || !loaded) return`). That pairing is precisely
the invariant a lineage record needs, and it already exists. In-session the
answer is `syncService.getEnvelope()?.podLineage`. Nothing new is written,
cached, migrated or cleaned up.

⚠️ This is only sound while Requirement 11 holds — the cached envelope must
never claim a lineage the cached doc is not on. C3's ordering rule is what
guarantees it, and the two must be read together.

**B4. Adopt through the path that already adopts — after `initAndLoadCache`, not
before it, and without deleting anything.**

`syncStore.replaceDocWithCacheRecovery` keeps its existing first step verbatim:
`initAndLoadCache(familyId)`, which returns `{ loaded, remoteBaseline }` in ONE
round-trip. Both inputs the guard needs are already in that reply, so **the
lineage decision costs zero new I/O**:

- the local lineage is `envelope.value?.podLineage` (B3 — the in-memory
  envelope, already populated on every path that reaches here);
- the context is `loaded === false` -> `clean` (there is no local doc, so
  nothing can be lost); otherwise `await docPushedAgainst(remoteBaseline)`
  -> `clean` | `dirty` (Requirement 7's one comparison);
- `deviceCannotOpen` from `initAndLoadCache` -> `clean`, with the
  `error_code: 'unprovable'` warning event (Requirement 7's stated exception).
  Every OTHER throw keeps today's `console.warn` + remote-only fall-through.

On action `adopt`: `docClient.adoptRemoteEnvelope(...)` (B5) — `dropDoc()` then
the `!currentDoc` branch, which installs the remote wholesale, resets cursors
and pushes a full projection. **Nothing else.**

> **Deliberately NOT `clearCache()` + `openCache()`, which the draft specified.**
> Three reasons, all verified: (a) `cache.persistDocBinary` clears every existing
> increment in the same transaction, so the fresh BASE the adopt's
> `resetDocCursors()` guarantees already supersedes every stale-lineage row —
> the delete is redundant; (b) `clearCache` deletes the whole DB, so a failure
> between the delete and a successful adopt (a network drop, a decrypt failure)
> leaves the device with **no local copy of the pod at all** — a data-void
> window this plan has no business opening; (c) it also drops the #61
> open-guard baseline row and the fast-paint snapshot, costing a needless full
> read on the next open. Two RPCs removed, one failure mode removed.

**Not one line of new adopt logic.** Existing RPCs in the order they were built
for.

On action `publish-local` (we hold an unpublished compaction): do NOT merge the
remote, keep the local doc, and republish — but only if
`syncService.remoteChanged()` answers `unchanged` against the DURABLE baseline
(the same check C3 step 2 uses, and the same one #61's open-guard already relies
on). If the remote moved, a peer wrote on the old lineage while our compaction
was unpublished: `block`, and the honest exit is re-opening the `.beanpod` step 3
proved exists — which the `user-file` column keeps open. No new machinery.

The same three lines serve `hydrateFromEnvelope` (terminus 2). The two
`decryptPendingFile*` callers pass `'user-file'` explicitly; every other caller
lets the context be derived. The context is a required argument with no default,
so a future caller cannot inherit `'user-file'` by omission.

**B5. Name the existing adopt idiom; do not add a mode parameter.**
Add one thin main-side composition to `worker/docClient.ts`:

```ts
/** Adopt a remote envelope WHOLESALE (never a CRDT merge). Drops the local doc
 *  first, so `mergeRemoteEnvelope` takes its `!currentDoc` full-adopt branch. */
export async function adoptRemoteEnvelope(envelope, familyId) {
  await dropDoc();
  return mergeRemoteEnvelope(envelope, familyId);
}
```

Then migrate the **three UNCONDITIONAL** `dropDoc()` + `mergeRemoteEnvelope()`
pairs onto it: `syncStore.ts:1103+1108`, `:1349+1350`, `:2162+2163`.

**`syncStore.ts:902-903` is explicitly excluded** — its `dropDoc()` is guarded by
`if (!loadedFromCache)`, and collapsing the guard would convert a cache-recovery
merge into an unconditional adopt. It becomes
`loadedFromCache ? mergeRemoteEnvelope(...) : adoptRemoteEnvelope(...)` — the
same two branches it already has, now naming the second one. A test pins that
a cache HIT still merges.

**This replaces the earlier `mode: 'merge' | 'adopt'` required-parameter design,
for three reasons found by reading the code:**

1. The claim that the compiler would name "three call sites" was wrong — there
   are **seven** (`syncStore.ts:901, 920, 1070, 1098, 1330, 2143` and
   `syncService.ts:1319`). A required mode on the hottest envelope API means
   seven edits, seven chances to answer `'merge'` reflexively to get the build
   green, and a permanent mode argument on every future call.
2. `dropDoc()` ALREADY means adopt, is already used that way at four sites, and
   is already `RETRYABLE`. A mode parameter would be a second vocabulary for one
   concept — the exact duplication Pass 2 deleted three times elsewhere.
3. It needs no protocol change, no new worker method, and no new membership
   decision in the five `docClient` sets. Two existing retry-safe RPCs, composed.

Atomicity: a respawn between the two calls leaves the worker with no doc at all,
so the retried merge adopts — the same outcome, never a cross-lineage merge.

The property the mode parameter was reaching for — "a merge cannot happen
without someone deciding" — is delivered instead by B6: every path that brings
foreign bytes in calls `guardLineage()` first, and the three termini are named in
the module header and pinned by behaviour tests.

**B6. Mid-session and at open: one guard call, then execute the action.**
`podLineage.ts` also exports the throwing form, so no caller re-implements the
mapping:

```ts
/** Compare, apply policy, and THROW `PodLineageError` on `block`.
 *  Returns one of the three NON-blocking actions, so no caller re-maps.
 *  Termini (keep this list in step with the tests):
 *    1. syncStore.replaceDocWithCacheRecovery   (cache recovery + file adopt)
 *    2. syncStore.hydrateFromEnvelope           (background recovery)
 *    3. syncService.fetchAndMergeRemote         (poll + pre-save) */
export function guardLineage(
  remoteEnv,
  localLineage,
  ctx: LineageContext
): Exclude<LineageAction, 'block'>;
```

**`fetchAndMergeRemote` must be able to ACT on the answer, not just refuse it.**
It calls the guard immediately after `parseBeanpodV4(text)` and before the
merge, and its existing single `docClient.mergeRemoteEnvelope(...)` call becomes
a two-branch dispatch on the returned action:

- `merge` -> today's call, unchanged, byte for byte (the whole `same` column);
- `adopt` -> `docClient.adoptRemoteEnvelope(...)`, whose `{ dirty, remoteHeads }`
  reply has the same shape, so **the baseline commit, `setEnvelope`, the latch
  clear and the `if (dirty) triggerDebouncedSave()` tail all stay exactly as
  written**. Adopting after a genuine `changed` probe is sound for precisely the
  reason the `!currentDoc` branch already documents: the doc we install IS the
  remote, so `remoteHeads` describes it exactly;
- `publish-local` -> return WITHOUT merging and without learning the marker, so
  `doSave` proceeds to write our compacted doc (if the remote already answered
  `changed`, the guard returned `block` — see B4).

The context here is `await docPushedAgainst(remoteBaseline)` — the shared helper
B4 uses. `syncService` already owns the only copy of that comparison
(`unpushedLocalChangesCheck`); export a one-line
`docPushedAgainst(baselineFp): Promise<'clean' | 'dirty'>` beside it that reuses
the same private body, rather than a second heads probe in `syncStore`.

`block` throws, and the throw lands in the latch below — which is also how a
`PayloadLoadError` already behaves there, so the surrounding error path needs no
new shape.

The latch: **widen the existing one** rather than adding a second, and widen it
by INTERFACE rather than by union:

```ts
// types/sync.ts
/** Anything that may latch the remote-blocked breaker. */
export interface RemoteBlocker extends Error {
  /** Short, stable code for `error_code` (payload: the step; lineage: the verdict). */
  readonly blockCode: string;
  /** Inline sync-bar message key. */
  readonly inlineMessageKey: PodBlockMessageKey;
}
```

- `PayloadLoadError` implements it with two one-line getters that DELEGATE to
  what already exists (`blockCode -> this.step`, `inlineMessageKey ->
payloadErrorMessageKey(this)`). No logic is copied or moved.
- `PodLineageError` implements it directly, carrying the verdict as `blockCode`,
  and registers in `protocol.ERROR_REGISTRY` through the **existing
  `payloadCodec` factory pattern** (a literal `name`, never `Ctor.name` — the
  minifier caveat still applies), so `instanceof` survives `postMessage`.

**Why an interface and not `PayloadLoadError | PodLineageError`:** the union
forces narrowing at every reader, and the readers are already written —
`authStore.ts:2367` reads `.step`, `syncStore.notePodUnopenable` calls
`payloadErrorMessageKey(err)`, and `noteRemoteUnreadable` reads five
PayloadLoadError members. A union pushes an `instanceof` into all of them and
into every future one; the interface answers the two questions consumers
actually ask and leaves the payload-specific reads behind the ONE `instanceof
PayloadLoadError` that stays inside `noteRemoteBlocked`. It is the same idiom
`deviceCannotOpen` already documents ("prefer this to a bare `instanceof`
wherever the QUESTION is about the device, so a future third subclass has to
state its own answer").

The rename is mechanical and compiler-driven, in one commit:
`remoteUnreadable -> remoteBlocked`, `isRemoteUnreadable -> isRemoteBlocked`,
`noteRemoteUnreadable -> noteRemoteBlocked`, `clearRemoteUnreadable ->
clearRemoteBlock`, `reportedUnreadableSteps -> reportedBlockClasses`. Readers:
`syncStore` x6, `authStore.ts:2366` (`.step -> .blockCode`),
`services/sync/__mocks__/syncService.ts`,
`stores/__tests__/payloadErrorPropagation.test.ts`,
`stores/__tests__/syncStore.resume.test.ts`. Nothing else changes in that commit.

**B7. The user-facing surface reuses everything.**

- `syncStore.podUnopenable` (the existing latch mirror) already drives
  `BackgroundSyncBar`; `notePodUnopenable` takes a `RemoteBlocker` and reads
  `.inlineMessageKey`. Add one inline string per verdict.
- `BackgroundSyncErrorKind` gains `'lineage'`, and **`clearPodUnopenable` must
  clear on `'decrypt' | 'lineage'`, not `'decrypt'` alone** (`syncStore.ts:3120`)
  — otherwise the bar's message never clears after a lineage block resolves and
  the next genuine failure cannot re-fire the watcher.
- For a block raised at OPEN, add `surfaceLineageFatal(err, ctx)` as a SIBLING
  export in `utils/payloadFailureSurface.ts` — that file is already documented as
  "THE one place a payload failure becomes the fatal overlay", so the fatal
  overlay keeps a single home. It is a separate function, NOT a generalisation of
  `surfacePayloadFatal`: making the existing pair generic over two unrelated
  error shapes would push `deviceCannotOpen`/`keyMayBeWrong`/`payloadBytes`
  narrowing into code whose entire value is that it has none.
  `clearDataHelps: false`, for the same reason Tier 1 gave.

### Phase C — publishing a compaction (flagged, ships last)

**C1. The flag.** `src/config/flagRegistry.ts` (not `src/constants/featureFlags.ts`,
which does not exist) + `false` in `featureFlags.committed.ts`. The dev-only
Feature Flags card lists it automatically — no UI work.

**Retirement criterion, written now so the flag cannot become permanent:** the
flag and its branch are DELETED (not defaulted to true) once a compaction has
run end-to-end on greg's real pod on both tablets and one further family has
compacted without a lineage block. Phase B's guard is permanent; the flag is not.

**C2. The UI is a row, and the logic is a composable.**
Owner-only section of the existing Family Data drawer in `SettingsPage.vue`,
beside Pod Ownership (`:1903`), which is already documented as the home for
"rare, owner-only, once-per-pod-lifetime" actions. Label + description +
`BaseButton`. **No new component, no new modal, no new store.**

The orchestration lives in **`src/composables/usePodCompaction.ts`**, returning
`{ busy, compact }`. Not in `syncStore` (4,770 lines) and not inline in
`SettingsPage.vue` (2,172 lines): a seven-step flow with its own failure ladder
is exactly the kind of thing those two files are already too large because of,
it needs no reactive state anyone else reads, and as a composable it is
unit-testable without mounting a page or instantiating a store.

**C2a. Extract the backup gate once, use it twice.**
`SettingsPage.vue` today has `exportReadableJson()` (`:665`) returning
`delivered`, plus a 20-line native "we cannot prove the share saved, so ask a
human" confirm inlined in the delete-family flow (`:812-831`). The compaction
needs the same gate over the ENCRYPTED pod. Copying either would be a third
divergent copy of a data-loss gate.

New `src/composables/usePodExport.ts`:

- `exportEncryptedPod(opts): Promise<boolean>` — `syncStore.buildExportEnvelope()`
  - `deliverFile({ preferDownload: true })`, the body of `handleManualExport`
    (`SettingsPage.vue:592-606`) lifted verbatim, which then calls it;
- `confirmBackupLanded(): Promise<boolean>` — the native-only confirm, lifted
  verbatim from the delete-family flow, which then calls it.

Behaviour-identical by construction; the existing delete-family tests pass
unchanged and are the proof.

**C3. The sequence — every step an existing call, and ONE ordering rule.**

1. **Gate.** Flag on, `isOwner`, provider configured, `canDurablySaveNow()`.
2. **Prove we are current and clean.** `await syncService.flushPendingSave()`,
   then `syncNow(false)`; require `true`. Then `remoteChanged()` must be
   `unchanged` and `hasUnpushedChanges(baselineFp, headsFp)` must be false —
   the exact pair `unpushedLocalChangesCheck` (`syncService.ts:871`) already
   computes. Refuse with `error_code: 'not-synced'` otherwise.
3. **Backup, gated on delivery.** `exportEncryptedPod({ errorUi: 'caller',
critical: true })` then `confirmBackupLanded()`, and **refuse to continue
   unless both return true** — the delete-family discipline, now shared code
   rather than quoted code. The exported `.beanpod` is a complete, openable pod:
   the rollback route is "open this file", which the product already supports.
   Provider-agnostic, so no dated-sibling-file write path is invented.
4. **Compact, in the worker, verified.** One new RPC `compactDoc`:
   `Automerge.from(toJS(doc), docInitOpts())` (A3's holder — never a locally
   sourced actor, or Phase C would re-introduce the churn Phase A removed, in
   the one document that has just been stripped of its history) ->
   `firstJsonDifference(toJS(before),
toJS(after))` over the whole document -> install ONLY on `null`, and on
   install **`resetDocCursors()`** (see the caveat — without it the next persist
   writes an increment against an unrelated document). On any difference, **keep
   the old doc** and throw with the JSON PATH of the first difference (path only,
   never values — the firehose is PII-free). On any throw, classify through the
   existing `payloadFailure()` so an OOM here is a `PayloadTooLargeError` with the
   honest copy already written. Returns `{ beforeBytes, afterBytes, changesBefore,
changesAfter, actorsBefore }`.
   New pure util `src/utils/firstJsonDifference.ts` — order-insensitive for object
   keys, order-sensitive for arrays, returns a dotted path or `null`. Reused by
   the diagnostic spec. (`diffPayload.ts` is explicitly documented as "do not grow
   this into a general object-diff library", so it is correctly not reused.)
5. **Commit LOCALLY, in an order that cannot invert.** First
   `await docClient.flush()` — the compacted doc is written to cache as a fresh
   BASE. Only then `replaceEnvelope({ ...envelope.value, podLineage: { id:
generateUUID(), seq: (old?.seq ?? 0) + 1 } })`, which sets the in-memory
   envelope and (via `syncService.setEnvelope` -> `persistEnvelopeSafely`)
   persists the envelope cache.

   > ⚠️ **This order is Requirement 11 and it is load-bearing.** `setEnvelope`
   > persists the envelope cache immediately and fire-and-forget
   > (`syncService.ts:714`) — it is not deferred to a successful save. So
   > stamping the lineage before caching the document leaves the cached envelope
   > claiming a lineage the cached document is not on. On the next open, B3 would
   > read `local.seq = N+1` against `remote.seq = N` and block a device whose
   > document is in fact perfectly mergeable — a dead end that every subsequent
   > reload reproduces identically. Caching the document first makes the pair
   > always self-consistent, which is the condition B3 assumes.
   >
   > This replaces an earlier "deliberately never persist the compacted doc"
   > design that traded that inconsistency for a cheap reload-rollback. Caching
   > first also removes the plan's only stated deviation from the house pattern:
   > every doc-installing path persists, and now so does this one.

6. **Publish through the existing save.** `syncService.saveNow()`. `doSave` does
   the export, `reEncryptEnvelope`, the write, the revision ack, the baseline
   commit, the failure ladder and the telemetry — all of it already correct. B6's
   guard is what makes the pre-write `fetchAndMergeRemote` safe.
7. **Confirm.** Toast; emit the `published` event with before/after bytes.

**C4. Failure handling, per step — a flat sequence, not a nest.**
`compact()` is a linear sequence of early returns over a discriminated
`{ ok: true } | { ok: false; code }`, with exactly ONE `try/catch`, around steps
5-6. No step is nested inside another step's `try`, and there are no bare
catches.

- Steps 1-3 refuse with a toast carrying `surface: 'pod-compaction'` +
  `error_code`, and change nothing.
- Step 4 leaves the doc untouched by construction.
- Steps 5-6 are the only window where state has moved. On failure: report at
  `severity: 'critical'` (the one place a human should look) and tell the user
  their backup is on disk. The state is a **cached, unpublished compaction**, and
  it is recoverable without any new code: the next open reads `ours-newer`,
  `lineageAction` returns `publish-local`, and B4 republishes it if the remote is
  `unchanged`. If a peer wrote in the meantime, B4 blocks and the honest recovery
  is the exported `.beanpod` — which step 3 proved exists before anything moved.
  That is the whole reason step 3 is a hard gate.

### Files affected

- `src/utils/deviceId.ts` (new, extracted) + `src/stores/calendarSyncStore.ts:162` (import it)
- `src/services/automerge/deviceActor.ts` (new)
- `src/services/automerge/worker/docActor.ts` (new)
- `src/services/automerge/worker/docOps.ts` (`:48`, `:230`)
- `src/services/automerge/worker/applyAndProject.ts` (`:447`, `:854`, `compactDoc`)
- `src/services/automerge/worker/docClient.ts` (`:275`, `:324`, the five method
  sets, `adoptRemoteEnvelope`, `compactDoc`)
- `src/services/automerge/worker/protocol.ts` (`PodLineageError` codec)
- `src/types/syncFileV4.ts` (`podLineage`), `src/types/sync.ts` (`RemoteBlocker`,
  `PodLineageError`, two getters on `PayloadLoadError`)
- `src/services/sync/podLineage.ts` (new, pure — comparator + policy table + guard)
- `src/services/sync/syncService.ts` (latch widened + renamed, `fetchAndMergeRemote` guard)
- `src/stores/syncStore.ts` (`replaceDocWithCacheRecovery`, `hydrateFromEnvelope`,
  the four `dropDoc`+merge pairs -> `adoptRemoteEnvelope`, `notePodUnopenable`,
  `clearPodUnopenable`)
- `src/utils/payloadFailureSurface.ts` (`surfaceLineageFatal`, a sibling export)
- `src/utils/firstJsonDifference.ts` (new, pure)
- `src/composables/usePodCompaction.ts` (new), `src/composables/usePodExport.ts` (new, extracted)
- `src/config/flagRegistry.ts`, `src/config/featureFlags.committed.ts`
- `src/pages/SettingsPage.vue` (one row; `handleManualExport` and the
  delete-family gate delegate to `usePodExport`)
- `src/services/translation/uiStrings.ts` (`en` + `beanie`)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts` (whole-doc equality gate)

**Not touched, and why:** `envelopeMerge.ts` — the remote-wins semantics the
lineage needs already fall out of `preserveLocalKeyDicts`' spread order.
`fileSync.ts` — `reEncryptEnvelope` already carries unknown fields.
`mergeRemoteEnvelope`'s signature — `dropDoc()` already says "adopt" (B5). Any new
IndexedDB store — the cached envelope and `beanies:device-id` already carry
everything. Any new modal or CTA mechanism — `useConfirm`, `deliverFile` and the
fatal overlay's own Reload button cover all three surfaces.

## Observability Coverage

All emitted **from main**, because the worker cannot telemeter.

- **`surface: 'device-actor'`** — `action: minted | reused | unstable`
  (`unstable` = localStorage unavailable, the one case that still churns). If the
  mint rate per session does not fall to near zero, Phase A is not working.
- **`surface: 'pod-lineage'`** — `action` one of `adopted` / `blocked` /
  `republished` / `conflict`, `error_code` = the verdict. `blocked` and `adopted`
  together give the ADOPTION RATE across a family's devices, which is the failure
  mode that loses data quietly. `republished` counts unpublished compactions
  recovered at open — if it is ever non-trivial, step 6 is failing more than it
  should. `conflict` is `critical`; the rest are firehose-only.
- **`surface: 'pod-compaction'`** — `action` one of `refused` / `verified` /
  `published` / `failed`, `error_code` carrying the reason (`not-synced`,
  `backup-not-delivered`, `verify-mismatch`, `write-failed`, `oom`), plus
  `perf_doc_bytes` (after) and `detail` (`before=<kb>,changes=<n>,actors=<n>` —
  the flat-scalar format `web_storage` and Tier 1's device probe already use).
  `critical` ONLY for `failed` after step 5.
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
- [ ] `compareLineage` is total and `lineageAction` covers all 12
      (verdict, context) pairs, table-tested; consumers switch on ACTIONS only
      and contain no verdict-specific policy; every cell of the `same` column is
      `merge`, so a never-compacted pod is byte-identical to today.
- [ ] A peer device on the old lineage adopts a published compaction through its
      ORDINARY Drive sync (`fetchAndMergeRemote`), with no manual step — proven
      end-to-end, because this is the criterion the draft failed.
- [ ] Opening the pre-compaction `.beanpod` on a device already carrying the new
      lineage SUCCEEDS (the `user-file` column), so the mandated rollback route
      is not blocked by the guard that mandates it.
- [ ] No adopt discards unsynced local work: `dirty` blocks; the only adopt
      without proof is the `deviceCannotOpen` case, and it emits
      `error_code: 'unprovable'`.
- [ ] No lineage path calls `clearCache`; the device always holds either its old
      cache or the adopted one, never neither.
- [ ] `syncStore.ts:902`'s conditional `dropDoc` is unchanged in meaning: a cache
      HIT still merges, pinned by a test.
- [ ] `deviceActorId` returning `null` (no `crypto.subtle`) leaves the pod
      opening exactly as it does today, pinned by a test.
- [ ] `setActor` is classified in all five `docClient` sets and is posted before
      both `setKey` and the rehydrator on `spawn()` and `enterInlineMode()`.
- [ ] Phase B ships to production UNGATED and soaks before Phase C is enabled
      anywhere.
- [ ] A device on the old lineage ADOPTS rather than merges — proven by a test
      that reproduces the coin-flip loss without the guard and shows it gone
      with it — and does so through `adoptRemoteEnvelope`, with no new adopt code and
      no mode parameter anywhere.
- [ ] A device with unsynced changes never adopts silently: it latches, is
      visible, and refuses saves.
- [ ] The latch is widened by interface: no consumer of `isRemoteBlocked()`
      contains an `instanceof`, and the only one in `syncService` is inside
      `noteRemoteBlocked`.
- [ ] `Automerge.from(toJS(doc))` verified deep-equal over the WHOLE document
      (no per-collection list anywhere in the code) on greg's real pod before any
      write path is enabled.
- [ ] A compaction refuses unless a `.beanpod` backup actually landed, using the
      same `usePodExport` gate the delete-family flow uses.
- [ ] The cached envelope's lineage never leads the cached doc: a failure between
      steps 5 and 6 leaves a state that the NEXT OPEN republishes automatically
      (remote unchanged) or blocks visibly (remote changed), pinned by two tests.
- [ ] `compactDoc` resets the persist cursors on install, pinned by a test that
      asserts the next persist writes a base, not an increment.
- [ ] `compactDoc` is classified in all five `docClient` method sets and is NOT
      retryable.
- [ ] `usePodCompaction.compact()` is a flat early-return sequence with exactly
      one `try/catch`; `syncStore` and `SettingsPage.vue` each grow by less than
      ~30 lines net.
- [ ] greg's real pod opens on the Galaxy Tab A9+ and the Tab A7 after
      compaction. **This is the criterion the whole plan exists for, and it is
      on-device, not a unit test.**
- [ ] Observability events fire as listed, add zero context keys, and are visible
      in CloudWatch.
- [ ] The Phase C flag and its branch are deleted once the retirement criterion
      in C1 is met.

## Testing Plan

1. Re-run the profiler on greg's current real pod; record the numbers.
2. Phase A units: pinned actor across two loads; across `initDoc`; across a
   cache reconstruct; re-posted after `spawn()` and after `enterInlineMode()`;
   `deviceActorId` is 32 lowercase hex chars, stable per (device, family) and
   different across families; the localStorage-throws path mints a per-session id
   and logs, never a constant.
3. `compareLineage` table test (four verdicts + both-absent + the
   `seq`-equal/`id`-different conflict) and `lineageAction` table test (all 12
   pairs), plus one assertion that the whole `same` column is `merge`.
4. Adopt test: build a doc, compact it, have a simulated peer make an unsynced
   change on the OLD lineage, and assert the guard preserves it (refusal) while a
   naive merge loses it.
5. **Propagation test (the draft's fatal gap):** a clean peer running the
   ordinary poll path adopts the compaction through `fetchAndMergeRemote` and
   ends on the new lineage, with `remoteHeads`, the baseline commit and the
   `dirty` re-push tail behaving exactly as on the merge branch.
6. **Rollback test:** a device on lineage N+1 opens the pre-compaction
   `.beanpod` (lineage N) via `decryptPendingFile` and succeeds.
7. **Context test:** `docPushedAgainst` answers `dirty` for a null `baselineFp`
   and for a failed heads probe; `initAndLoadCache` throwing `deviceCannotOpen`
   adopts and emits `error_code: 'unprovable'`; every other throw keeps today's
   remote-only fall-through.
8. `adoptRemoteEnvelope` drops the doc first — assert the doc is installed
   wholesale and the cursors reset; assert each of the three termini in
   `guardLineage`'s header actually calls it (behaviour, not grep); and assert
   `syncStore.ts:902`'s cache-HIT branch still MERGES.
9. Latch tests: each blocking action refuses `doSave`, stops the poll, reports
   exactly once per class, clears on a successful same-lineage merge, and clears
   the sync-bar message for kind `'lineage'` as well as `'decrypt'`.
10. `firstJsonDifference` — equal trees, key-order-insensitive, array-order-
    sensitive, and a path returned for a nested difference; and `compactDoc`
    refuses + keeps the old doc when it differs.
11. Compaction refusal matrix: not owner, flag off, not synced, backup not
    delivered, remote changed mid-flight — each leaves the doc and the envelope
    untouched.
12. Ordering test (Requirement 11): fail the publish after step 5 and assert (a)
    the cached doc and cached envelope are on the SAME lineage, (b) the next open
    republishes when the remote is unchanged, (c) the next open blocks visibly
    when the remote changed.
13. `usePodExport`: the existing delete-family gate tests pass unchanged against
    the extracted `confirmBackupLanded`, and `exportEncryptedPod` returns false
    on a cancelled share.
14. Deep-equality gate on the real pod via the diagnostic spec (env-gated).
15. On-device: sideload to the Tab A9+ and the Tab A7, open the compacted pod,
    confirm it loads and that a subsequent edit round-trips to another device.
16. Rollback rehearsal: open the pre-compaction export as the pod and confirm the
    family works on it, including merging in a peer edit made after the export.
17. Full battery: type-check, eslint, stylelint, unit suite, build.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the Tier 1 measurements plus the
  compaction/merge hazard measured on 2026-09-05.
- **Pass 2 (DRY + error handling)**: Verified every reuse claim against the code
  and replaced the ones that did not hold. (a) **The epoch design was unsound** —
  a monotonic counter gives direction but not identity, so two concurrent
  compactions produce equal epochs on incompatible lineages and merge, silently,
  which is the exact failure the guard exists to prevent; replaced with `{id, seq}` and a total
  four-verdict comparator with no default branch. (b) **The push-before-adopt
  rule was destructive as written** — pushing an old-lineage doc over a compacted
  remote silently discards every post-compaction edit; replaced with
  adopt-when-clean / latch-when-not, reusing the existing latch rather than
  cloning its three behaviours. (c) **Three claimed new files already exist**:
  the adopt path, the local lineage store (the cached envelope) and the backup
  writer — all three bespoke implementations deleted, and with them a per-family
  IndexedDB actor store, a dated provider-side file write and a new modal. (d)
  `envelopeMerge` needs no change at all. (e) **Two paths would have silently
  un-pinned the actor** (`spawn()` and `enterInlineMode()` re-drive only
  `familyKey`). (f) **A worker-side telemetry call would have been dropped on the
  floor** — `perfTiming` cannot flush in a worker, so all compaction events moved
  to main. (g) **The device identity was about to be duplicated** — `getDeviceId`
  already exists, with an `'unknown-device'` constant fallback that for an ACTOR
  would put every private-mode device in one lane. (h) Wrong flag path, and a new
  worker method must be classified in all five `docClient` sets. (i) Two open
  caveats resolved by grep: nothing reads change authorship, and the document is
  pure JSON. (j) Sequencing corrected: the guard must be in production ungated
  before any compaction is publishable. (k) The compacted doc is deliberately not
  persisted before publication — **later reversed by Pass 3, see below**.
- **Pass 3 (Sustainability)**:
  - **Fixed a permanent dead-end (reliability, load-bearing).** Pass 2's (k) is
    reversed: `setEnvelope` persists the envelope cache immediately and
    fire-and-forget, so stamping the lineage before caching the compacted doc
    left the cached envelope on lineage N+1 and the cached doc on N. Every
    subsequent open would read `ours-newer` and latch, forever. New Requirement
    11 + C3's ordering rule (`flush()` the doc, THEN stamp) makes the cache
    always self-consistent and turns a failed publish into an automatic
    republish at next open.
  - **Added the missing `resetDocCursors()` on compacted-doc install** — without
    it the next persist writes an increment against a document with no shared
    ancestry, corrupting the cache.
  - **Dropped the `mode: 'merge' | 'adopt'` required parameter.** It would have
    touched seven call sites (the plan said three — verified wrong) and
    duplicated `dropDoc()`, which this codebase already documents as the adopt
    idiom. Replaced by one named composition, `adoptRemoteEnvelope()`.
  - **Widened the latch by interface, not by union**, so no consumer needs an
    `instanceof` — matching the existing `deviceCannotOpen` idiom.
  - **Moved the four-verdict policy out of three exhaustive switches into one
    8-row table**; adding a verdict is now a compile error in one file.
    (Pass 4 replaced the phase axis with a provable-safety axis and widened this
    to 12 rows — see below.)
  - **Moved the Phase C orchestration out of the two largest files** into
    `usePodCompaction.ts`, as a flat early-return sequence with exactly one
    `try/catch`.
  - **Extracted the backup gate instead of quoting it** (`usePodExport.ts`), so
    the compaction and delete-family flows share one data-loss gate.
  - **Replaced "all 29 collections plus settings" with a whole-document
    compare** — an enumerated list is correct only until the next collection is
    added, and it fails open.
  - Kept `payloadFailureSurface.ts` un-generalised; added the `'lineage'`
    sync-bar kind and the matching `clearPodUnopenable` fix; gave the DevFlag a
    written retirement criterion; corrected several paths.
- **Pass 4 (Fresh-eyes sweep)**: four defects found by re-reading the code
  rather than the plan; two of them would have shipped a broken feature.
  - **The policy axis was wrong, and it broke propagation (blocking).** With
    context = `open` | `session`, a peer's first post-compaction sync arrives via
    `fetchAndMergeRemote` — classified `session`, verdict `adopt-remote`, action
    `block`. Every peer in the fleet would latch and none would ever adopt: a
    compaction could not spread. Replaced with `clean` | `dirty` | `user-file`
    (what the device can PROVE), a 12-row table, and an `adopt` branch inside
    `fetchAndMergeRemote`.
  - **The guard blocked its own rollback route (blocking).** A device on lineage
    N+1 opening the pre-compaction `.beanpod` (lineage N) reads `ours-newer` and
    refuses — the file Requirement 8 calls the ONLY rollback route. The
    `user-file` column fixes it, and states why a user-chosen file is the human
    decision the guard exists to demand.
  - **Adopt discarded unsynced work silently, contradicting Requirement 7.** The
    draft never checked. It now uses `hasUnpushedChanges` against the baseline
    row `initAndLoadCache` already returns in the same round-trip — zero new I/O
    — with unknown counting as `dirty`, and ONE stated, instrumented exception
    for the OOM device that cannot read its own heads.
  - **`clearCache()` before adopt was a data-void window.** A base write already
    clears every increment, so the delete was redundant; a failure between delete
    and adopt left the device with no local pod at all. Removed, along with two
    RPCs and the loss of the #61 baseline row and fast-paint snapshot.
  - **`syncStore.ts:902` is not a `dropDoc`+merge pair.** It is a CONDITIONAL
    drop guarding cross-family corruption; the draft's "migrate all four" would
    have turned the cache-recovery merge into an unconditional adopt. Three
    unconditional pairs migrate; that one is explicitly excluded.
  - Smaller: `setFamilyKey` gains `familyId` so the actor has ONE seam instead of
    five call sites to remember; `setActor` is classified in all five `docClient`
    sets (the plan mandated this and skipped its own method); `deviceActorId`
    reuses `sha256Hex` and returns `null` rather than throwing, so a preventive
    optimisation can never stop a pod opening; `compactDoc` takes its actor from
    `docInitOpts()`.
  - Line references in this plan are accurate as of 2026-09-05 and drift with
    every commit — treat the NAMED function and the quoted code as the anchor,
    the line number as a hint.

## Prompt Log

<details>
<summary>Full prompt history</summary>

See `docs/prompts/2026-09/2026-09-04-pod-load-oom.md` — this plan continues the
same task. The authorising prompt for Tier 2 is greg's 2026-09-04 ~23:00
message: "once that is compelte, move directly into /beanies-plan for the tier 2
changes as per the results of the script."

</details>

## Outcome (2026-09-05)

Phases A, B and C shipped to `main` as `7a31386c`, `0aaab624`, `067938b2`,
`2bb7e64e` (compaction behind `podCompaction`, off). Not deployed. Compaction
measured on greg's test pod: 2.06MB → 0.17MB, 2768ms → 374ms, 329MB → 51MB
document RSS. Merge-loss without the lineage guard re-measured with a
per-trial rebuild: 50.3% (151/300).

**Phase A amendment.** The pinned actor is shared by every tab of a browser
profile, and two tabs writing under it made Automerge refuse the merge
(`duplicate seq`), after which `doSave`'s transport-failure branch overwrote
the remote. Fixed by a per-family Web Lock lease (only the holding realm pins
the actor) and a `RemoteMergeError` blocker that makes the save path refuse
after the remote was read. See `docs/plans/2026-09-05-device-actor-lease.md`.

**Correction.** The "4,214 actors, 45% single-change" figures came from an
earlier export; the pod in `/tmp` measures 2,607 actors, 24% single-change,
mean 4.1 / median 2 / p90 9 / max 151 changes per actor. Same shape, same
conclusion (a flat tail of session churn), different numbers.
