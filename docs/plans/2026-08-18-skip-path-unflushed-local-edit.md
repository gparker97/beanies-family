# Plan: Skipped open must re-push an unflushed local edit

> Date: 2026-08-18
> Related issues: Notion tracker #65 (follow-up to #61). None — direct implementation, no GitHub issue.
> Plan file: `docs/plans/2026-08-18-skip-path-unflushed-local-edit.md`

> **No GitHub issue created.** This plan was approved for direct implementation (tracker #65 `github issue = do not create`). Full prompt history is embedded under `## Prompt Log`.

## User Story

As a member of a multi-device family, I want an edit I made just before the app was force-killed to reach my family as soon as I reopen the app, so that my partner's device isn't showing stale data for up to an hour.

## Context

#61 PR 2 (shipped 2026-08-17 as `0.9.10R9`) added an open-path guard: when Drive's `version` counter hasn't advanced past a durably-cached baseline within a 1-hour trust window, the open skips the whole-file download and the second CRDT reconstruction. On an unchanged open this took `rec=2 reads=1` down to `rec=1 reads=0`.

The guard's correctness rests on one invariant, stated in `src/services/sync/remoteBaseline.ts:10-13`:

> Commit revision R as the baseline only if our doc provably contains the file's content at R.

That invariant is about the **remote→local** direction, and it holds. What the skip path silently dropped is the **local→remote** direction. Pre-#61, every open ran `loadFromFile({ merge: true })`, and `mergeRemoteEnvelope` returned a heads-derived `dirty` flag that triggered `triggerDebouncedSave()` (`syncStore.ts:789-793`, and again at `:~1004`). So every open re-pushed pending local state as a side effect of always merging.

Now, when `shouldSkipOpenRead()` returns `skip`, `backgroundSyncFromFile` runs `runPostLoadDriveHousekeeping()` and returns at `syncStore.ts:2312-2317` — `loadFromFile` is never called, so `dirty` is never computed and nothing is pushed.

The gap opens in a narrow window. `applyAndProject.ts` maintains `lastPersistedHeads` (the IDB cache-persist cursor, `:99`), and the Drive save is debounced. An edit lands in the local worker cache within milliseconds but reaches Drive ~1-2s later. Force-kill or crash in between and the edit is durable locally but absent from Drive — while the baseline still holds the **pre-edit** revision, because the baseline only advances at the three Drive read/write termini (`commitRemoteBaseline`, called at `syncStore.ts:964`, `syncService.ts:1055`, `syncService.ts:1156/1166`), never on a cache persist. The next open therefore sees Drive genuinely unchanged, skips correctly by its own contract, and never uploads the edit.

**No data is lost.** The edit is safe in the device's cache and self-heals on the next edit or at trust-window expiry. The defect is a bounded (≤1h) cross-device _propagation_ delay, and it only bites multi-device families.

## Requirements

1. On the open-guard skip path, an open must not complete while the worker's doc holds changes that have never been pushed to Drive.
2. Detecting "has unpushed changes" must be a cheap local check — no extra Drive round-trip, no download.
3. When there are no unpushed changes, the open must still skip exactly as it does today: `open-skip`, `reads=0`, `writes=0`.
4. The detection must survive a force-kill — it cannot rely on in-memory state that dies with the process, because the crash _is_ the trigger.
5. The concurrent-edit path (Drive `version` advanced) must keep behaving as it does now: read + merge, CRDT preserves both sides.
6. The detection must not force an upload when the local doc already equals what Drive holds, or it defeats the `writes=0` win.
7. Diagnostic telemetry must distinguish "skipped, nothing pending" from "declined to skip because changes were pending", so the rate of the crash-window case is measurable in CloudWatch — and a _correct, intended_ decline must not be counted as an uncertainty fail-open.
8. **No new failure may be silent, and no failure may be reported twice.** Every added step that can throw (a worker RPC, a JSON parse of a widened cache row) must be caught, must degrade toward _reading_, must leave exactly one classified telemetry value, and must leave a console line carrying developer-actionable guidance.
9. **The change must not add structural state.** No new module-level variable with its own lifecycle, no new reset site, no new capture/ordering discipline for a future maintainer to keep in their head.
10. **The recorded fingerprint must describe Drive's content, never our doc's.** Its derivation must not depend on any other flag's semantics remaining true.

## Approach

### The design decision (resolving the tracker's open question)

The tracker asks: a precise "last Drive-pushed heads" cursor in the worker, or a coarser gate on an existing pending-save/offline-queue signal?

**Take the precise option — implemented as extra data inside the existing durable baseline row's payload, with the value supplied by the existing termini rather than by a new cursor with its own lifecycle.**

The coarser option fails Requirement 4 outright. Any in-memory pending-save flag (`cancelPendingSave`'s timer handle, `offlineQueue`) dies with the process, and the process dying is precisely the scenario. A signal that is always `false` after the crash cannot detect the crash.

### Correction carried from review: heads-at-terminus is NOT heads-on-Drive

The naive version of the precise option — "snapshot `headsOf(currentDoc)` inside `noteRemoteBaseline`" — is **unsound in both directions**, and shipping it would recreate the very bug being fixed one level down:

- At the **merge** termini (1 and 2), the merged doc is `local ∪ remote`. If local carried unsynced changes, the merged heads are strictly _ahead_ of Drive. Recording them claims those changes are pushed when they are not.
- At the **write** terminus (3), `doSave` serializes the doc at `syncService.ts:1121` and commits after the ack at `:1156`. A mutation landing in that window makes `currentDoc`'s heads ahead of the bytes actually uploaded.

The over-claim is what must be impossible; an under-claim only costs an extra read. So the rule is:

> **The fingerprint always describes the heads of the document Drive holds. Anything we cannot derive from Drive's own bytes records "unknown", which degrades to a read.**

### Correction from pass 4: derive the fingerprint from Drive's bytes, not from `dirty`

Pass 2/3 committed `dirty ? null : mergeResult.heads` at the merge termini, using `mergeDocs`' `dirty === false` as _proof_ that the merged doc equals remote content. That proof is real for the merge branch (`dirty = getChanges(remote, merged).length > 0`, `docOps.ts:134` ⇒ `dirty === false` means the merged change set equals remote's, so the heads coincide) — but **it does not hold for `mergeRemoteEnvelope`'s adopt branch**, and that branch is reachable from terminus 1:

- `mergeRemoteEnvelope` (`applyAndProject.ts:617-673`) has two branches. When `currentDoc` is absent it _adopts_: `currentDoc = migrateDoc(remote); const heads = headsOf(currentDoc); … return { heads, dirty: false, changed: true }` — `dirty` is **hardcoded** `false`.
- `migrateDoc` (`docOps.ts:38-44`) is not a no-op: when a collection is missing it emits a real `Automerge.change`. So on the adopt branch the returned `heads` can be **strictly ahead of Drive** while `dirty` claims `false` — an over-claim, i.e. exactly the false-skip this plan exists to close (the migrate delta would then sit unpushed for a whole trust window).
- The adopt branch is reachable at terminus 1: `syncStore.ts:789` drops the doc before merging on the cache-recovery path, and `:949` does `dropDoc()` then `mergeRemoteEnvelope` — after which the worker has no `currentDoc`.

Rather than repair `dirty` (which would change the adopt path's save-trigger behaviour) or special-case the branch (which would put the soundness argument back into review vigilance), **take the value directly from Drive's own bytes**:

> `mergeRemoteEnvelope` returns `remoteHeads` — `headsOf(remote)` captured from the **unmigrated** decrypted remote doc, before any merge or migrate. `decryptToDoc` is documented as returning an unmigrated doc (`docOps.ts:247`), so these heads are _exactly_ the heads of the bytes on Drive.

This is strictly better on every axis:

- **Unconditionally sound.** It cannot over-claim regardless of what `dirty`, `migrateDoc`, or a future merge strategy does. Requirement 10 is met by derivation, not by a second flag staying honest.
- **Simpler at every call site.** `commitRemoteBaseline(mergeResult.remoteHeads ?? null)` — no conditional, no `dirty` coupling, nothing to keep in sync with `dirty`'s meaning.
- **Identical skip behaviour.** Clean merge ⇒ `remoteHeads` equals our heads ⇒ skip. Dirty merge ⇒ our heads are ahead of `remoteHeads` ⇒ decline ⇒ read ⇒ merge ⇒ `dirty` ⇒ push. Same outcomes, one fewer inference.
- **It deletes a caveat** rather than adding one: the "don't conflate `dirty` with unpushed-vs-Drive" hazard disappears because `dirty` is no longer load-bearing for the baseline at all.

Each terminus's proof, at essentially zero cost:

| Terminus                                                  | Proof of Drive's content                                                                                                                                                           | Value committed                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1 — `loadFromFile` merge (`syncStore.ts:964`)             | `mergeRemoteEnvelope` returns `remoteHeads` = heads of the unmigrated decrypted remote doc.                                                                                        | `mergeResult.remoteHeads ?? null` |
| 1b — the _replace_ branch (`replaceDocWithCacheRecovery`) | None — it returns nothing, and recovery deliberately re-applies unsynced cache changes.                                                                                            | `null`                            |
| 2 — poll merge (`syncService.ts:1055`)                    | Same `remoteHeads` from the same call at `:1046`.                                                                                                                                  | `remoteHeads ?? null`             |
| 3 — post-write ack (`syncService.ts:1156` / `:1166`)      | The uploaded bytes came from `docClient.exportEncryptedPayload()` at `:1121`. Widening that RPC's return to `{ payload, heads }` yields the heads of _exactly the serialized doc_. | those heads                       |

Terminus 3 detail: capture the heads **immediately** from the same `doc` const `requireDoc` returned, before `encryptDocPayload` runs. `Automerge.getHeads` returns a value snapshot, so it survives a later handle-consuming `mutate`; re-deriving heads after the `await` would both risk a consumed handle and reintroduce the drift this fixes. `requireDoc` → `saveDoc(doc)` has no `await` between them on the worker's single thread, so the captured heads are provably the serialized bytes' heads.

No new worker cursor, no new capture discipline, no new module state — every value is already computed inside the functions involved (or is one `headsOf` on a doc already in hand), just not returned.

### Layering: the worker stores an opaque string; `remoteBaseline.ts` owns the format

The baseline row already documents itself as holding "an opaque namespaced string" (`cache.ts:47-48`), and the worker genuinely does not interpret it — `writeRemoteBaseline` puts it, `readRemoteBaseline` gets it, `commitPendingBaseline` carries it. **Keep that true.** The row's payload becomes a richer encoded string, and the encode/decode pair lives in `remoteBaseline.ts` — the module whose entire stated purpose is "NO I/O, NO module state… table-testable with zero mocks" (`remoteBaseline.ts:3-6`).

Consequences, all in the simplifying direction:

- `pendingRemoteBaseline` stays `string | null`. **`commitPendingBaseline` is not touched at all** — its C4a `pendingRemoteBaseline === pending` identity check (`applyAndProject.ts:290`) keeps its current _value_-equality semantics instead of silently becoming reference identity on a new object type. That subtlety simply never arises.
- `resetDocCursors`, the C18 DB-open clears, and the persist atomicity argument are all **unchanged, byte for byte**. Requirement 9 is satisfied structurally rather than by review vigilance.
- The branchy part of this change (legacy fallback, unparseable payload, absent fingerprint) is **pure and main-side**, testable with no fake IDB and no worker harness.
- One module knows the encoding. The plaintext-privacy justification lives next to the codec that decides what goes in the row, instead of drifting between `cache.ts` and `syncService.ts`.

`readRemoteBaseline` therefore returns the row verbatim: `RemoteBaselineRow` changes shape from `{ revision, checkedAt }` to `{ payload, checkedAt }`, and `seedRemoteBaseline` decodes it main-side. That is a rename-and-forward through `cache.ts` → `applyAndProject.ts` → `docClient.ts` → `syncStore.ts`, with no logic added to any of them.

**Correction from pass 4 — `remoteBaseline.ts` is NOT imported at runtime by the worker.** Pass 3 asserted it would be; that was carried over from an earlier draft where the worker parsed the row. Under this design the worker's references are `import type { RemoteBaselineRow }` only (`cache.ts:25`, `docClient.ts:50`), fully erased — so no main-thread module is pulled into the worker bundle and there is no new bundle edge. The module still _should_ stay runtime-dependency-free (its only import today is `import type { RemoteMarker, WriteAck } from './storageProvider'`), and to keep that list at exactly one type import, `headsFingerprint` takes **`readonly string[]`** rather than importing `Heads` from `worker/protocol`. `Heads` is `string[]` (`protocol.ts:21`), so every caller's value is assignable, and `remoteBaseline.ts` gains no dependency on the worker's wire types at all.

### The three moving parts

1. **`remoteBaseline.ts` gains four pure functions and one decoded type.** Still I/O-free and table-testable:
   - `headsFingerprint(heads: readonly string[]): string` — `heads.join(' ')`. We only ever ask _equal or not_, so a canonical string is strictly simpler than an array plus a comparator: no ordering question, no `every()` loop, plain `===`, and a compact row payload. It is exactly as order-sensitive as the existing private `headsEqual` (`applyAndProject.ts:560`), which already compares by index on the documented "deterministic sorted change-hash arrays" — so **no new assumption is introduced, and nothing is reimplemented**: `headsEqual` is not exported, is unreachable from main without dragging worker/Automerge internals into the main bundle, and stays exactly where it is.
   - `hasUnpushedChanges(baselineFp: string | null, currentFp: string): boolean` — `baselineFp === null || baselineFp !== currentFp`. Absent fingerprint ⇒ unpushed ⇒ read.
   - `encodeBaselinePayload(revision: string, headsFp: string | null): string` — `JSON.stringify({ r, h })`.
   - `decodeBaselinePayload(payload: string): DecodedBaseline | null` — the legacy/unparseable ladder, below. Returns `null` for genuinely unusable input (⇒ no baseline ⇒ read).
   - `interface DecodedBaseline { revision: string; headsFp: string | null }`, and `RemoteBaseline` (in-memory) gains `headsFp: string | null` — documented as _the fingerprint of the heads of the content Drive holds at `revision`_.
   - **One absent-representation throughout: `string | null`.** No optional `?` fields anywhere in this feature — a value that is sometimes `undefined` and sometimes `null` is the classic long-tail source of "worked in the test, declined forever in prod".
2. **`commitRemoteBaseline(driveHeads: readonly string[] | null)` takes the proof as a required argument.** Making it a parameter rather than module state is the load-bearing choice: TypeScript then _forces_ every one of the four call sites to answer "what does Drive hold?", so a future terminus cannot over-claim by omission. It fingerprints and encodes internally (one place knows the encoding) and forwards one opaque string to the worker.
   - **Correction from pass 4: it also updates the in-memory baseline's `headsFp` (and _only_ `headsFp` — never `checkedAt`).** Pass 3 left the in-memory value as a read-side seed only. But `backgroundSyncFromFile` — and therefore `shouldSkipOpenRead` — runs **more than once per process**: the header Refresh button (`AppHeader.vue:193`) and the deferred config-heal (`syncStore.ts:2855`) both call it, a fact `endOpen`'s own token-ownership comment already documents (`telemetry/openCycle.ts:157-159`). With no write-back, every such re-entry after a save would see `headsFp === null` and report `baseline-heads-unknown`, permanently polluting the very metric added in Requirement 7. Writing back one field keeps in-memory ≡ durable, costs one line, and touches nothing the seed/commit hazard is about (that hazard is exclusively `checkedAt`). `learnRemoteMarker` (`:715`) runs immediately before every commit and rebuilds the object with `headsFp: null`, so ordering is already correct at all four sites.
3. **The guard gains one local pre-check, ordered by cost.** `shouldSkipOpenRead()` (`syncService.ts:690`) already runs cheap local checks before spending a metadata probe. The new check slots between them and the probe: two synchronous checks → one worker round-trip → one network probe.

```
no baseline / no revision      → read   (existing)
trust window expired           → read   (existing)
doc heads ≠ baseline headsFp   → read   reason 'unpushed-local-changes'   ← NEW
  (fingerprint absent)         → read   reason 'baseline-heads-unknown'   ← NEW
  (getHeads threw)             → read   reason 'heads-probe-failed'       ← NEW
metadata probe …               → (existing)
```

**Keep `shouldSkipOpenRead` a flat ladder of guard clauses — max one level of nesting.** The new step is one extracted private helper so the ladder does not grow a `try`-block in the middle of it:

```ts
/** null ⇒ nothing blocks a skip. Otherwise the classified decline. */
async function unpushedLocalChangesCheck(baselineFp: string | null): Promise<Decline | null>;
```

`shouldSkipOpenRead` then reads as: two synchronous clauses, `const blocked = await unpushedLocalChangesCheck(...); if (blocked) return blocked;`, then the existing probe clauses. One concern per function; the I/O and its catch are isolated from the decision ladder.

### The heads probe must be `quiet` (pass 4 — would otherwise double-report)

`docClient.getHeads()` currently takes no `RequestOpts`. Every `request()` failure runs through `surface()` (`docClient.ts:793-807`), and because `getHeads` is not in `USER_ACTION_METHODS` (`:422`) a rejection routes to `notifyFailure`'s else-branch → `reportError({ surface: 'doc-worker', severity: 'error' })` (`:781-786`). So an un-quieted probe failure would fire a `doc-worker` error report **in addition to** the guard's own `heads-probe-failed` classification — two events for one benign, self-healing degradation, violating Requirement 8 and adding noise to a paging-adjacent surface.

Therefore: **widen `getHeads` to `getHeads(opts?: RequestOpts)` and have the guard pass `{ quiet: true }`** — the same pattern `collectReferencedPhotoIds` and `loadProjectionSnapshot` already use for fail-safe probes. `WorkerCrashError` is already `expected` (and therefore quiet) inside `surface()`, so this only suppresses the residual classes; the guard remains the single reporter.

**Deliberately _not_ passing a custom `timeoutMs`.** `getHeads` is not in `HEAVY_METHODS`, so it uses `DEFAULT_RPC_TIMEOUT_MS` (45s) with the existing suspension-aware deadline, 5s liveness ping, and respawn machinery. A shorter bespoke budget would risk tearing down a merely-busy live worker (`recoverDeadWorker`) for a probe whose whole point is to be non-disruptive, and the standard path already converts a genuinely wedged worker into a fast recovery via the ping. The guard runs _after_ `initAndLoadCache` has resolved on the same open, so the worker is known-alive and the doc known-loaded; the realistic cost is sub-millisecond. Recorded here so a future reader doesn't add a timeout as an "obvious hardening".

### Rejected alternative: ride the heads on `initAndLoadCache` (would be a silent false-skip)

The obvious optimization is to have the worker return the loaded doc's heads alongside the baseline row in the existing `initAndLoadCache` round-trip (`docClient.ts:827`, consumed at `syncStore.ts:1334`), removing the extra RPC, its try/catch, its telemetry reason and Assumption 1 entirely. It also seems to inherit the existing "read in the SAME round-trip so the two can never be read out of step" argument.

**It is unsafe and must not be adopted.** Those heads are captured at cache-load time, and the guard runs later in the open. In between, `reloadAllStores()` calls `syncService.cancelPendingSave()` (`syncStore.ts:2089`, and again at `:855`) — a documented mechanism (`syncStore.ts:~998-1003`) by which a local mutation can exist with **no armed save**. A stale, cache-load-time heads value in that window compares _equal_ to the baseline and produces a **false skip**: the unsafe direction, and the exact bug class this plan exists to close. Probing at decision time is immune by construction.

The extra RPC is the price of asking the question at the moment the answer is used. Pay it.

### Reuse: what already exists and is used as-is

- **`docClient.getHeads()`** (`docClient.ts:978`) is the current-heads query. It already exists, is already in `RETRYABLE_METHODS` (`:399`), and has had **no production caller since 2026-07-15** — this revives it rather than adding wire surface. Nothing new goes into `protocol.ts`. (Its retryability is correct here: after a worker respawn the re-issue either hits `requireDoc` with no doc and throws — guard reads — or returns the rehydrated cached doc's heads, which is the right answer. Fail-safe either way.) Its doc comment, which currently asserts "no production caller", must be updated to name this one; the `docClient.test.ts` worker-death suite keeps driving it and needs no change beyond the new optional arg being optional.
- **`fireAndForget`** already wraps `noteRemoteBaseline` (`docClient.ts:923-930`) with warn-level reporting; the arg is still one string, so nothing there changes — including the documented C17 rationale for keeping it out of `RETRYABLE_METHODS`.
- **`commitPendingBaseline` + `persistOnce`'s C4a snapshot discipline** (`applyAndProject.ts:285-297, 332-335`) are **untouched**, because the pending value stays a string.
- **`endOpen(..., { failOpenReason })`** (`src/services/telemetry/openCycle.ts:149-186`) already ships the guard's reason to CloudWatch as `error_code` on `surface: 'open-cycle'`, for **every** outcome including `open-skip` and `open-complete` (`:184` is unconditional on outcome). The new reasons ride the existing channel automatically. This deletes the `sync-baseline` surface and the `baseline-heads-missing` event proposed in pass 1: it would have been a _second_ event describing a decision the first event already reports, and it would have fired routinely rather than only on faults.
- **The durability banner** (`sink.cachePersistFailed`) already covers the only failure here that can cost data. Nothing new is wired to it.

### One telemetry classification change in `syncStore` (pass 4)

`backgroundSyncFromFile` classifies any guard reason outside `CLEAN_READ_REASONS = new Set(['changed', 'no-baseline'])` as `open-fail-open` (`syncStore.ts:2320-2329`), which `endOpen` emits at **`warn`** level. `unpushed-local-changes` is not a fail-open on uncertainty — it is the guard working exactly as designed, on a path that then completes successfully. Leaving it out of the set would inflate the fail-open rate the #61 work added specifically to alert on rising _uncertainty_, and would emit a warn per crash-window recovery.

So: **add `'unpushed-local-changes'` to `CLEAN_READ_REASONS`** (one array element). `baseline-heads-unknown` and `heads-probe-failed` stay _outside_ the set — they genuinely are uncertainty. The reason still reaches CloudWatch as `error_code` on the `open-complete` record, so countability is unaffected. Pass 3's claim of "zero telemetry changes in `syncStore.ts`" was wrong on this point.

### Why "decline to skip" rather than "push from the skip path"

- It reuses the existing, already-correct path. Falling through runs `loadFromFile({ merge: true })`, which computes `dirty` and calls `triggerDebouncedSave()` — the exact mechanism that worked pre-#61. Our doc holds changes remote lacks, so `getChanges(remote, merged)` is non-empty and `dirty` is necessarily `true`. **No new push call site**, nothing to keep in sync with the first.
- It is safe under concurrency by construction. Pushing directly from the skip path would upload local state without first merging whatever else is on Drive; declining merges first, so the CRDT converges before the write.
- The cost lands only in the rare case. An open with pending changes pays one download it would have paid pre-#61 anyway.

### Ordering constraints

- `seedRemoteBaseline()` (`syncService.ts:729`) is deliberately a plain setter that does **not** re-commit, so it can't refresh `checkedAt` and silently extend the trust window — the file calls this "the easiest mistake to make in the design". `headsFp` inherits that discipline for `checkedAt` exactly: seeded on open from the persisted row (now via `decodeBaselinePayload`), and only ever written back by `commitRemoteBaseline`, which still never touches `checkedAt`. `learnRemoteMarker()` (`:715`) builds a fresh in-memory baseline from a probe that knows nothing about heads, so it sets `headsFp: null` — the safe direction — and every terminus immediately follows it with a commit.
- **The heads probe can only run when a doc exists.** The `no-baseline` clause returns first, and a baseline can only be present if `loadFromPersistenceCache` seeded it from a row read in the same round-trip as a successfully loaded cached doc (`applyAndProject.ts:555`). So `heads-probe-failed` indicates a genuine worker fault, not a normal cold path — which is what makes it worth counting.

## Files Affected

- **`src/services/sync/remoteBaseline.ts`** — `headsFingerprint`, `hasUnpushedChanges`, `encodeBaselinePayload`, `decodeBaselinePayload` (all pure); `DecodedBaseline`; `headsFp: string | null` on `RemoteBaseline`; `RemoteBaselineRow` reshaped to `{ payload, checkedAt }`. **No new imports** (`headsFingerprint` takes `readonly string[]`). Header gains the "must stay runtime-dependency-free" constraint and the plaintext-row privacy justification.
- **`src/services/sync/syncService.ts`** — the `unpushedLocalChangesCheck` helper (passing `{ quiet: true }`) + its one call in the guard ladder; `commitRemoteBaseline(driveHeads)` incl. the in-memory `headsFp` write-back; `seedRemoteBaseline` decodes the row; `learnRemoteMarker` nulls `headsFp`; terminus 2 passes `remoteHeads ?? null`; the two commits at `:1156`/`:1166` pass the heads returned by `exportEncryptedPayload` at `:1121`.
- **`src/stores/syncStore.ts`** — a hoisted `let driveHeads: readonly string[] | null = null;` beside the existing `let changed`/`let dirty` (`:~918-919`), assigned `mergeResult.remoteHeads ?? null` in the merge branch only, and passed at `:964`; plus `'unpushed-local-changes'` added to `CLEAN_READ_REASONS`. The `?? null` mirrors the block's existing fail-safe-default discipline (`changed ?? true`, `dirty ?? true`) so a partial test double degrades to "unknown ⇒ read", never to a false skip. The replace branch leaves it `null`.
- **`src/services/automerge/worker/applyAndProject.ts`** — `noteRemoteBaseline(payload)` and the RPC dispatch at `:829-830` reading `a.payload` (renames); `initAndLoadCache` returning the reshaped row (rename); `mergeRemoteEnvelope` returns an added `remoteHeads: Heads`, captured as `headsOf(remote)` immediately after `decryptToDoc` resolves and **before** any `migrateDoc`/`mergeDocs`, in both branches; `exportEncryptedPayload` returns `{ payload, heads }` with heads captured from the same `doc` const at `requireDoc` time. `pendingRemoteBaseline`, `commitPendingBaseline`, `resetDocCursors` and the C18 clears are **unchanged**.
- **`src/services/automerge/worker/docClient.ts`** — `noteRemoteBaseline(payload: string)` param rename; `mergeRemoteEnvelope` and `exportEncryptedPayload` return types widened; `getHeads(opts?: RequestOpts)` + updated doc comment.
- **`src/services/automerge/worker/cache.ts`** — `writeRemoteBaseline(payload)` param rename; `readRemoteBaseline` returns `{ payload: entry.payload, checkedAt: entry.updatedAt }`. **No parsing, no branching, no new failure path in the worker.** The row doc comment (`:46-57`) keeps "opaque string" (now accurate rather than aspirational) and points at `remoteBaseline.ts` for the format and the privacy note.
- **`src/services/sync/__mocks__/syncService.ts`** — `commitRemoteBaseline` arity (`:78`).
- **Existing tests that must be updated (mechanical, but they fail otherwise — pass 4 audit):**
  - `src/services/sync/__tests__/fetchAndMergeRemote.test.ts` — its `docClient` mock is an explicit factory with **no `getHeads`** (`:37-46`), so all seven existing `shouldSkipOpenRead` cases would call `undefined` and flip to `heads-probe-failed`; add `getHeads` (and `remoteHeads` on the `mergeRemoteEnvelope` stub). Its seven `seedRemoteBaseline({ revision, checkedAt })` calls (`:281`–`:355`) must pass `{ payload: encodeBaselinePayload(...), checkedAt }` — using the real codec, not a hand-written literal.
  - `src/services/automerge/worker/__tests__/cache.test.ts:93-122` and `__tests__/applyAndProject.test.ts:188,200` assert `readRemoteBaseline()?.revision` → `.payload`.
- **New/extended test coverage:** `src/services/sync/__tests__/remoteBaseline.test.ts` (codec + comparator table tests), `fetchAndMergeRemote.test.ts` (guard + both merge termini), and one assertion in the existing `applyAndProject.test.ts` that `mergeRemoteEnvelope` returns the **remote's** pre-migrate heads (guards the adopt/migrate over-claim). No new test file.

`protocol.ts` is **not** touched — `Heads` is already exported there and RPC args are untyped `Record<string, unknown>`.

### Row format and backward compatibility

Today `payload` is the bare namespaced revision string (`cache.ts:249-255`), with `updatedAt` doubling as the trust clock. It becomes `JSON.stringify({ r: revision, h: headsFp })`. `decodeBaselinePayload` handles all three cases without ever throwing:

- Parses to an object with a string `r` → `{ revision: r, headsFp: typeof h === 'string' ? h : null }`.
- Parse throws (a pre-upgrade bare `ver:` string is not valid JSON) **and** the raw payload is a non-empty string → **legacy row**: `{ revision: payload, headsFp: null }` — skip declines once, then the next terminus rewrites the row in the new format.
- Anything else (valid JSON that isn't the expected shape, empty payload) → `null`, i.e. no baseline ⇒ read, after a `console.error` naming the row key and the fix ("delete the `remote-baseline` row or clear the cache; next open re-reads and re-seeds it").

No migration, no version bump. One trust window after upgrade every row carries a fingerprint and the skip resumes. `writeRemoteBaseline` remains the row's **only** writer — the invariant that nothing else may refresh `updatedAt` is unchanged.

**Privacy note (the row is deliberately plaintext):** the existing justification is "an opaque counter plus a local clock reading carries no family data". Change hashes are SHA-256 digests of change bytes — no content is recoverable and no new class of data is exposed; the row now additionally reveals "the doc has moved", which the revision counter already implied. Recorded next to `encodeBaselinePayload` — the function that decides what enters the row — so the plaintext decision stays justified rather than inherited.

## Error Handling — every added failure path

Nothing here has a user-facing failure mode: no user action fails, no data is at risk, and the worst outcome of _any_ fault below is one extra download the app performed unconditionally before #61. Adding a modal or toast would therefore be noise on a path the user cannot act on — and this codebase already has the right channel for that class of event (`open-cycle`'s classified `error_code`, plus a console line for the developer). The one failure here that _can_ cost data — a cache write failing — is already surfaced by the durability banner and needs nothing new.

| Failure                                                                                                        | Handling                                                                                                                                                                 | Direction            | Developer guidance                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `docClient.getHeads()` rejects (worker crash/respawn, no doc loaded — `requireDoc` throws)                     | called with `{ quiet: true }` so `surface()` does not also `reportError`; try/catch inside `unpushedLocalChangesCheck` → `{ skip: false, reason: 'heads-probe-failed' }` | read                 | `console.warn` with the error + "open-guard fell back to a full read; check the worker RPC log — no data at risk"       |
| Worker wedged (probe hits the 45s default budget)                                                              | existing `request` machinery: 5s liveness ping → extend or `recoverDeadWorker` → rejection → the row above                                                               | read                 | existing worker-death telemetry, unchanged; no bespoke timeout added (see rationale)                                    |
| Baseline row has a revision but no `headsFp` (pre-upgrade, or a terminus that could not prove Drive's content) | `hasUnpushedChanges(null, …) === true` → `reason: 'baseline-heads-unknown'`                                                                                              | read                 | Expected for one trust window post-deploy and on the replace/recovery branch; countable in CloudWatch, no console noise |
| Baseline row payload unparseable / wrong shape                                                                 | `decodeBaselinePayload` returns `null` + `console.error` naming the row key and the remedy; `seedRemoteBaseline(null)`                                                   | read (`no-baseline`) | as above. Pure function — reproduced in a unit test, not a fake IDB                                                     |
| `mergeRemoteEnvelope` double returns no `remoteHeads` (partial test stub)                                      | `?? null` at the call site                                                                                                                                               | read next open       | mirrors the block's `changed ?? true` / `dirty ?? true` discipline                                                      |
| `writeRemoteBaseline` throws                                                                                   | existing `commitPendingBaseline` try/catch (`applyAndProject.ts:291-296`), **unchanged**                                                                                 | read next open       | existing console.error, unchanged                                                                                       |
| `noteRemoteBaseline` RPC fails                                                                                 | existing `fireAndForget(..., 'warning')` (`docClient.ts:924-929`), **unchanged**                                                                                         | read next open       | existing                                                                                                                |
| A terminus is added later and forgets heads                                                                    | **compile error** — `driveHeads` is a required parameter                                                                                                                 | n/a                  | the type is the guardrail                                                                                               |

## Observability Coverage

- **`surface: 'open-cycle'`** (existing; the only `syncStore` change is one entry in `CLEAN_READ_REASONS`). The guard's classified `reason` already rides to CloudWatch as `error_code` via `endOpen`, on every outcome. Three new values become directly countable: `unpushed-local-changes` (the crash-window case this fixes, on `open-complete` at info level), `baseline-heads-unknown` and `heads-probe-failed` (both retain `open-fail-open`/warn, because both are genuine uncertainty).
- **Success-path signal:** the existing `open-skip` with `reads=0 writes=0` remains the common-case counter, so each new reason is measurable as a _ratio_ against it rather than as a bare count. Satisfies the "emit on success too" rule.
- **No new surface, no new event, no new context key.** `error_code` and `action` are already in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61-69`), so **no app-store data-collection declaration update is needed**.
- **No double-reporting.** The `{ quiet: true }` probe means one fault produces exactly one classified event.
- **Failure modes covered:** (a) a terminus over-claiming → structurally impossible (required param + the value is derived from Drive's bytes) plus a worker test that `remoteHeads` is the _pre-migrate_ remote heads; (b) row widened but not persisted → `baseline-heads-unknown` stays at 100% and the skip rate never recovers — visible; (c) comparator inverted → table tests assert both directions; (d) codec regression → `baseline-heads-unknown` or `no-baseline` spikes, both already counted; (e) in-memory `headsFp` not written back → `baseline-heads-unknown` appears on header-Refresh opens — now prevented, and the test asserts it.

## Acceptance Criteria

- [ ] Edit → force-kill before the Drive flush → reopen within the trust window on an otherwise-unchanged file: the edit reaches Drive on **that** open (second device receives it / Drive `version` advances)
- [ ] An open with no pending local changes still emits `open-skip` with `reads=0 writes=0`
- [ ] A concurrent remote edit still reads + merges, both sides preserved
- [ ] A pre-upgrade baseline row (legacy bare `ver:` payload) declines to skip with `baseline-heads-unknown`, and does not throw
- [ ] Termini 1 and 2 commit the **remote doc's pre-migrate heads**, never the merged doc's — asserted with a remote whose migration adds a collection (the adopt-branch over-claim regression)
- [ ] `exportEncryptedPayload`'s heads — not `currentDoc`'s — are what terminus 3 commits
- [ ] `getHeads` rejection ⇒ `heads-probe-failed`, read, console guidance, **exactly one** telemetry event (no `doc-worker` report), no throw escaping the guard
- [ ] The heads probe is issued from the guard at decision time, **not** carried from `initAndLoadCache` (see rejected alternative)
- [ ] A second `backgroundSyncFromFile` in the same process (header Refresh) after a save does **not** report `baseline-heads-unknown` — the in-memory `headsFp` was written back
- [ ] `unpushed-local-changes` classifies as `open-complete` (info), not `open-fail-open` (warn)
- [ ] `pendingRemoteBaseline` is still `string | null` and `commitPendingBaseline` / `resetDocCursors` / the C18 clears are unchanged
- [ ] `remoteBaseline.ts` still has zero runtime imports, and the worker's references to it are still `import type` only
- [ ] Unit coverage: pending changes → declines; no pending changes → skips; missing fingerprint → declines; unparseable row → declines
- [ ] Pure functions covered by table tests with no mocks
- [ ] Diagnostic reasons reach `endOpen` as `error_code` (assert via the existing open-cycle test harness)
- [ ] Full unit suite green (4413+ tests) **including the six pre-existing test files enumerated under Files Affected**, build green (`npm run build`, per `docs/lessons.md` — import-graph changes can break the prod build while type-check and units are green, and this touches the main/worker type boundary)

## Testing Plan

1. **Unit — pure functions** (`remoteBaseline.test.ts`): `headsFingerprint` stability; `hasUnpushedChanges` equal → false, differing → true, `null` baseline → true; `encode`/`decode` round-trip with and without a fingerprint; decode of a legacy bare `ver:` string → revision-only; decode of garbage → `null`, no throw. No mocks, no fake IDB — this is where the whole compatibility ladder is proved.
2. **Unit — guard** (`fetchAndMergeRemote.test.ts`, extending the existing `shouldSkipOpenRead` describe block): differing fingerprint → `{ skip: false, reason: 'unpushed-local-changes' }` **and the metadata probe is never called** (assert call count — this also proves the ordering requirement); absent fingerprint → `baseline-heads-unknown`; `getHeads` rejecting → `heads-probe-failed`, no throw, and `getHeads` was called with `{ quiet: true }`; matching fingerprint → still skips.
3. **Unit — terminus proof** (`fetchAndMergeRemote.test.ts`): terminus 2 commits a payload whose fingerprint is `remoteHeads`, independent of `dirty`; a stub omitting `remoteHeads` commits no fingerprint; terminus 3 commits `exportEncryptedPayload`'s heads, not `currentDoc`'s; a second commit updates the in-memory `headsFp` without moving `checkedAt`.
4. **Unit — worker** (one case in the existing `applyAndProject.test.ts`): `mergeRemoteEnvelope` returns `remoteHeads` equal to the _unmigrated_ remote doc's heads on both the adopt and merge branches — including when `migrateDoc` adds a collection, which is the case that made `dirty`-as-proof unsound.
5. **Manual, real Drive file:** open twice unchanged → confirm `open-skip rec=1 reads=0` still holds (the #61 win is intact). Then edit → force-kill within ~1s → reopen → confirm the edit uploads on that open.
6. **Cross-device:** second device sees the edit without waiting out the hour.
7. **Regression check:** run the new tests against pre-fix `main` and confirm the pending-changes cases fail — a test that can't distinguish the fixed and broken states proves nothing (`docs/lessons.md`, rule 4).

Beyond case 4, no new worker test file: the rest of the worker's diff is renames and one added return field, so the existing `applyAndProject.test.ts` / `cache.test.ts` suites passing (after their mechanical `.payload` updates) _is_ the assertion. Adding parallel worker tests for a rename would be test volume without discriminating power (ADR-007).

## Assumptions

> Review before implementation.

1. `Automerge.getHeads()` is cheap enough to call once per open (it returns a sorted change-hash array, no traversal), and one extra `postMessage` round-trip on the open path is negligible against the Drive probe it precedes. The alternative — reusing a cache-load-time value — is rejected on correctness, not cost.
2. Heads arrays are deterministically ordered — the same assumption the existing `headsEqual` (`applyAndProject.ts:560`) already relies on. `headsFingerprint` introduces no new assumption; if that ever became false, both would break together and the fix is one `sort()` in one place.
3. The cache row payload can be widened to JSON with a legacy-string fallback, so no schema version bump is needed.
4. Comparing "heads now" against "heads Drive last held" at open time is the right question: an edit made _during_ the session schedules its own save through the normal `mutate` path, so the only heads that can be legitimately unpushed at open are those inherited from a previous, force-killed session.
5. `decryptToDoc` continues to return an **unmigrated** doc (documented at `docOps.ts:247`). This is the one external contract `remoteHeads` depends on; if migration were ever moved inside it, `remoteHeads` would over-claim by exactly a migrate delta. Worth a one-line comment at both the capture site and `decryptToDoc`.
6. The 1h trust window stays as-is (greg's directive; out of scope).

## Important Notes & Caveats

- **The fingerprint describes Drive's content, never our doc's.** Termini 1/2 use `remoteHeads` (heads of the unmigrated decrypted remote doc); terminus 3 uses `exportEncryptedPayload`'s heads (heads of the uploaded bytes); the replace/recovery branch uses `null`. `driveHeads` is a required parameter precisely so this cannot be forgotten.
- **Do not reintroduce `dirty` as the proof.** `mergeRemoteEnvelope`'s adopt branch hardcodes `dirty: false` while `migrateDoc` may have moved the doc, so `dirty === false` does not imply "doc equals Drive". Deriving the fingerprint from the remote bytes removes the dependency entirely — and with it the old "don't conflate `dirty` with unpushed-vs-Drive" caveat. `dirty` keeps its existing, separate job: driving the re-upload.
- **Do not move the heads probe onto `initAndLoadCache`.** It looks like a free win and is a silent false-skip, because `reloadAllStores()` cancels pending saves between cache load and the guard. Rationale recorded in the plan and in a code comment at the probe site so the "optimization" isn't rediscovered.
- **The probe must be `{ quiet: true }`.** Without it, `surface()` → `notifyFailure` → `reportError` double-reports every benign probe failure on the `doc-worker` surface.
- **Do not give the probe a bespoke `timeoutMs`.** The default budget plus the existing ping/respawn machinery is the correct behaviour; a short budget can tear down a live-but-busy worker.
- **Keep the worker's baseline payload opaque.** The moment `cache.ts` or `applyAndProject.ts` parses the row, the format has two owners and the pure-function test coverage stops being the whole story.
- **Do not route the heads seed through `commitRemoteBaseline`.** The commit may write back `headsFp` in memory but must never touch `checkedAt` — refreshing it would silently extend the trust window, the design's explicitly-flagged easiest mistake.
- **Do not add a second upload call site.** Declining to skip and letting the existing merge→`dirty`→`triggerDebouncedSave` path run is the whole point.
- **Do not add a second telemetry event.** `endOpen` already ships the guard's reason; a parallel `sync-baseline` event would double-report one decision and fire on healthy paths.
- **`string | null`, never `undefined`.** One absent-representation across the row, the decoded type, the in-memory baseline and the commit parameter.
- **Fail toward reading, always.** Missing fingerprint, unparseable row, absent doc, RPC failure, partial test double — every one declines to skip.
- **`headsEqual` stays private in the worker.** It is unreachable from main without pulling worker/Automerge internals into the main bundle; `headsFingerprint` replaces the _need_ for it on the main side rather than duplicating it.
- **`remoteBaseline.ts` is type-only from the worker's side.** It is not in the worker bundle; keep it import-free anyway so that stays true, and prefer `readonly string[]` over importing `Heads`.
- History compaction / the slow `automerge.cacheLoad` remains out of scope.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the tracker intake plus a read of the #61 guard, the worker's heads cursors, and the baseline module; resolved the open question in favour of extending the existing durable baseline row.
- **Pass 2 (DRY + error handling)**: Caught that pass 1's "snapshot heads inside `noteRemoteBaseline`" was unsound (merged heads exceed Drive when `dirty`; `currentDoc` can move between `exportEncryptedPayload` and the write ack) and replaced it with proof-carrying values the existing termini already compute, passed through a now-required `commitRemoteBaseline(pushedHeads)` parameter; replaced the array+comparator with a pure `headsFingerprint` string (no reimplementation of the worker-private `headsEqual`, no ordering assumption added); reused the existing prod-callerless `getHeads` RPC instead of new wire surface and dropped `protocol.ts` from scope; deleted the redundant `sync-baseline` surface after verifying `endOpen` already ships guard reasons as `error_code`, reducing `syncStore.ts` to a one-expression change; and added an explicit error-handling table covering the RPC rejection, the legacy/unparseable row parse, and why no user-facing error UI is warranted.
- **Pass 3 (Sustainability)**: Moved the row's encode/decode into `remoteBaseline.ts` as pure functions so the worker keeps storing a genuinely opaque string — which drops the worker diff to renames and leaves `pendingRemoteBaseline`, `commitPendingBaseline`'s C4a identity check, `resetDocCursors` and the C18 clears untouched (new Requirement 9: no new structural state); recorded and rejected the tempting "carry heads on `initAndLoadCache`" optimization, which `reloadAllStores`' `cancelPendingSave` turns into a silent false-skip; flattened the guard by extracting `unpushedLocalChangesCheck` so the ladder stays one-level; standardized on `string | null` with no optional fields; added the "`remoteBaseline.ts` must stay runtime-dependency-free" constraint plus an `npm run build` acceptance gate for the main/worker boundary move; and cut the worker test file, since renames need no new assertions.
- **Pass 4 (Fresh-eyes sweep)**: Verified every citation against source and fixed six real defects — replaced `dirty ? null : heads` with `mergeRemoteEnvelope`'s new `remoteHeads` (heads of the _unmigrated_ decrypted remote doc), because the adopt branch hardcodes `dirty: false` while `migrateDoc` can move the doc, making pass 3's proof an over-claim → false skip; required `getHeads(opts)` + `{ quiet: true }` since `surface()` → `reportError` would otherwise double-report every probe failure, and explicitly rejected a bespoke `timeoutMs`; had `commitRemoteBaseline` write `headsFp` back in memory (never `checkedAt`) because `backgroundSyncFromFile` re-runs per process via header Refresh and would otherwise report `baseline-heads-unknown` forever; added `'unpushed-local-changes'` to `CLEAN_READ_REASONS` so a correct decline isn't logged as a warn-level fail-open; corrected the false "worker imports `remoteBaseline.ts` at runtime" constraint (all worker refs are `import type`) and dropped the `Heads` import in favour of `readonly string[]`; fixed the `openCycle.ts` path (`services/telemetry`, not `automerge/worker`) and two line anchors; and enumerated the six pre-existing test files whose `getHeads`/`seedRemoteBaseline`/`.revision` call sites break silently without mechanical updates.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via `/beanies-pre-plan #65`)

> `/beanies-pre-plan` — ARGUMENTS: `#65 - once done approve and create /beanies-plan`

The intake was resolved from Notion tracker row #65 ("Skipped open no longer re-pushes an unflushed local edit — cross-device propagation lags up to the trust window"), which was fully populated — no `TBC` fields, no missing Required or Conditional fields. The assembled pre-plan block handed to `/beanies-plan`:

```
=== BEANIES PRE-PLAN ===

Title:        Skipped open no longer re-pushes an unflushed local edit — cross-device propagation lags up to the trust window
Type:         bug
Priority:     high
Surfaces:     platforms: [All]  •  area: overall
Category:     [data, app]
Objective:    The #61 open-guard skips the Drive read when the file's version counter hasn't advanced past our durably-cached baseline. But an edit that was persisted to the local worker cache yet never flushed to Drive (app force-killed / crashed in the ~1-2s window between the cache persist and the debounced Drive save) leaves the baseline at the PRE-edit revision. The next open within the trust window sees Drive unchanged -> skips -> and, unlike the pre-#61 open which always merged and re-pushed dirty local state, never uploads that edit. The edit is safe locally but does not propagate to other devices/members until the next edit or the trust window (currently 1h) expires. Restore the "always re-push pending local changes on open" guarantee on the skip path. No data is lost today; the goal is to close the <=1h cross-device propagation gap.

# Bug only
Current:      On a skipped open (guard decides the Drive file is unchanged), backgroundSyncFromFile runs runPostLoadDriveHousekeeping and RETURNS without calling loadFromFile. So a local edit sitting in the worker cache that never reached Drive is not re-uploaded on that open. Pre-#61, every open ran loadFromFile({merge:true}), which computed heads-derived `dirty` and re-pushed any pending local changes. The baseline only advances at the three Drive read/write termini, never on a cache persist, so an unflushed edit leaves the baseline at the pre-edit revision and the guard correctly-but-unhelpfully skips.
Expected:     A skipped open still ensures any locally-persisted-but-unflushed changes reach Drive (or the open declines to skip when such changes exist), so cross-device propagation is not delayed beyond normal sync latency. An open with no pending local changes still skips the download (the #61 win). No new data-loss risk — the edit is already safe in the local cache; this closes the propagation delay only.
Repro:        Make an edit; force-kill the app before the debounced Drive save flushes (~1-2s window after the cache persist); reopen within the trust window on an otherwise-unchanged Drive file. Observed: the edit does not reach Drive on that open — it waits for the next edit or trust-window expiry. Multi-device family required to observe the propagation lag.

# Always
Scope (do):
  - Cheaply detect whether the worker's current doc holds changes not yet durably pushed to Drive (e.g. track a "last Drive-pushed heads" cursor, distinct from "last cache-persisted heads").
  - On the open-guard SKIP path (backgroundSyncFromFile), if such pending local changes exist, push them (trigger a save) or decline to skip and fall through to the normal read+merge+re-push — instead of returning early.
  - Preserve the #61 win for the common case: an open with NO pending local changes still skips the whole-file download (open-skip, reads=0, writes=0).
Out of scope (don't):
  - The history-compaction / slow automerge.cacheLoad lever (separate deferred item from the #61 audit).
  - Changing the trust-window duration (greg's 1h directive stands).
Acceptance criteria:
  - Repro closed: make an edit, force-kill before the Drive save flushes, reopen within the trust window on an otherwise-unchanged Drive file -> the edit reaches Drive on THAT open (verified by a second device receiving it, or the .beanpod's Drive `version` advancing), not delayed to the next edit / trust expiry.
  - A skipped open with NO pending local changes still emits open-skip with reads=0 writes=0 (the #61 win is preserved, verified from open-cycle telemetry).
  - Unit coverage for "pending local changes present -> skip path pushes them" and "no pending changes -> still skips".
Edge cases / constraints:
  - Concurrent edit from another device: Drive `version` advances, so the guard already reads+merges (CRDT preserves both edits) — this path is already correct and must stay so.
  - The pending-changes detection must NOT force an upload when the local doc equals what Drive already has, or it defeats the writes=0 win.
  - Multi-device only; single-device users are unaffected (nothing to propagate to).
Reuse hints / affected files:  src/stores/syncStore.ts (backgroundSyncFromFile skip path ~2311, runPostLoadDriveHousekeeping); src/services/sync/syncService.ts (baseline commit termini, remoteBaseline, commitRemoteBaseline); src/services/automerge/worker/applyAndProject.ts (lastPersistedHeads — likely add a "last Drive-pushed heads" cursor); the guard's shouldSkipOpenRead. NOTE: pointers for the DRY pass only, not the chosen approach. Verified present on main 2026-08-18: backgroundSyncFromFile syncStore.ts:2285 (skip path :2312-2316), shouldSkipOpenRead syncService.ts:690, remoteBaseline syncService.ts:90, lastPersistedHeads applyAndProject.ts:99; no lastPushedHeads-style cursor exists yet.
References:                    /code-review max finding on #61 PR 2 (syncStore.ts:2311 — "skip path no longer pushes cache-persisted-but-unflushed local edits"). docs/plans/2026-08-13-open-cycle-redundant-loads.md (Outcome -> Documented limitations (a)). docs/investigations/2026-08-13-open-cycle-load-audit.md. Shipped in 0.9.10R9 (web/PWA + Android prod + iOS TestFlight, 2026-08-17). Follow-up to #61 (App-open load cycle performs redundant full loads — the open-guard whose skip path introduced this gap); this is the accepted limitation recorded in that plan's Outcome.
Open Qs:                       Design decision for beanies-plan: track a "last Drive-pushed heads" cursor in the worker (precise) vs. gate the skip on an existing pending-save/offline-queue signal (cheaper, coarser)? Either must keep writes=0 when nothing is pending.
Notes:                         Severity framing: NO data loss — the edit is safe in the device's local cache. This is a bounded (<=1h), self-healing (next edit or trust-window expiry re-pushes) cross-device PROPAGATION delay, triggered only by a force-kill/crash in a narrow ~1-2s window on a multi-device family. Filed as High at greg's request to address it now rather than let it sit as a documented limitation.

GitHub issue: SKIP — do not create a GitHub issue.
Feature gate: NO — ship ungated (the default; never add a gate that wasn't requested).

=== END PRE-PLAN ===
```

### Follow-up 1

> ok continue with the remaining passes

(Chained Passes 3 and 4 after Pass 2 returned.)

</details>
