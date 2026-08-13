# Plan: Eliminate redundant full loads in the app-open cycle

> Date: 2026-08-13
> Related issues: Notion tracker #61 (None on GitHub — direct implementation)
> Plan file: `docs/plans/2026-08-13-open-cycle-redundant-loads.md`
>
> **Line anchors in this plan are indicative** (verified against the tree on 2026-08-13, ±a few lines).
> Re-locate by symbol name, never by number, when implementing.

> **No GitHub issue created.** This plan was approved for direct implementation; the full prompt history is embedded below.

## User Story

As a family member opening beanies on any device, I want the app to read, decrypt and rebuild my family's data file only as many times as correctness genuinely requires, so that opening the app is as fast as it can technically be and I am never left looking at stale numbers while the app silently redoes work it has already done.

## Design in one page (read this first)

_Everything below this section is rationale. This is the design. A maintainer who reads only this section should be able to find every moving part._

**The idea.** Google Drive tells us a file's `version` — a server-side counter that advances on every change. If the counter we durably recorded alongside our cached document still matches the file's counter, the file's bytes cannot have changed since we last merged them, so the open-path download is pure waste and we skip it.

**Five moving parts, and nothing else:**

| Part                                        | Where                                                   | Job                                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `remoteBaseline` (pure logic)               | `src/services/sync/remoteBaseline.ts` (**new**, no I/O) | Compare two markers; evaluate the trust window; decide `changed`/`unchanged`/`unknown`. Pure functions, table-testable, zero mocks. |
| `remoteChanged()` / `shouldSkipOpenRead()`  | `syncService`                                           | The I/O shell: probe the provider, hand the values to the pure module, own every failure classification.                            |
| `getRemoteMarker?()` + `write() → WriteAck` | `StorageProvider` / `GoogleDriveProvider`               | One metadata round-trip returning the marker; the write returns its own resulting marker.                                           |
| `remote-baseline` row                       | `worker/cache.ts`                                       | One additive plaintext row, written **only** by the same persist that durably stores the doc state it describes.                    |
| `openCycle` counters                        | `src/services/telemetry/openCycle.ts`                   | Per-open counts of reconstructions / reads / writes / reloads, so redundancy returning is visible without a repro.                  |

**The one invariant everything serves:**

> Commit revision R as the baseline only if our doc provably contains the file's content at R.
> Exactly two ways to establish that: (a) we sampled R from metadata _strictly before_ downloading and merging the bytes, or (b) R is the ack of our own write.
> Every other outcome degrades to "baseline not advanced" → **an extra read, never a missed one**.

**The three commit termini** (and nowhere else): after `loadFromFile`'s merge/replace succeeds; after `fetchAndMergeRemote`'s merge resolves; after `doSave`'s write resolves.

**The failure direction is always the same:** every uncertainty — no baseline, no revision, a provider without a marker, a thrown probe, an expired or unparseable trust window — results in a normal full read. The optimisation can silently stop working; it cannot silently serve stale data.

**Complexity budget.** This plan adds **one** new source module (a pure one), **one** new telemetry module, **one** worker RPC method, **one** optional provider method, and **three** worker module vars (`lastSnapshotHeads`, `pendingRemoteBaseline`, plus the `resetDocCursors()` funnel that owns them and `lastPersistedHeads`). It _deletes_ one dead function and three redundant exports, and removes one network round-trip per save. Net exported-symbol count is roughly flat. See "Simplifications considered and deliberately rejected" before adding anything to this list.

## Context

Opening the app reconstructs the family's Automerge document more times than correctness requires.

30-day production CloudWatch (`docs/PERFORMANCE.md:384-392`, captured 2026-08-12):

| label                      | p50    | p90/p95     |
| -------------------------- | ------ | ----------- |
| `automerge.cacheLoad`      | ~7.1s  | ~24s (p90)  |
| `automerge.remoteLoad`     | ~2.6s  | ~4.5s (p95) |
| `automerge.pushProjection` | <0.27s | —           |
| `stores.reloadAll`         | ~0.55s | —           |

Decrypt is tens of ms of a 2.6s load. **The multi-second cost is the CRDT engine rebuild, not crypto or projection.**

The 2026-08-12 projection snapshot (`47aa9032`, `2ce1716b`) made the app _paint_ in ~111ms but removed no work. The wait is hidden, not gone — and the user may be looking at stale numbers for 5–10s. That is the trust problem this issue exists to fix.

### Corrections carried forward from planning (do not implement the intake verbatim)

_This is a rationale appendix. Each item records a mistake a reasonable implementer would otherwise make. Read the one-page design above first; come here when a step looks arbitrary._

**C1 — `replaceDocWithCacheRecovery`'s double reconstruction is LOAD-BEARING. Do not remove it.**
Verified at `syncStore.ts:756-786`. `initAndLoadCache` (`:775`) loads _this family's_ cache so the CRDT merge preserves local unsynced changes; its `{loaded:false}` return is the sole authorisation for `dropDoc()` (`:780`), without which a cache miss merges the remote into whatever doc the worker still holds — possibly another family's — producing a durable A∪B corruption. It already gates its re-upload on `dirty` (`:785`). **Withdrawn from scope.**

**C2 — Heads are not available pre-download.** They live inside the encrypted payload. The only cheap pre-read signals are file metadata (mtime / revision id).

**C3 — `automerge.remoteLoad` is NOT a dead label; `decryptBeanpodPayload` is a dead _function_.**
The live emitter is `applyAndProject.ts:465` (`time2('automerge.remoteLoad', …)` inside `mergeRemoteEnvelope`, `:460-470`) — that is where the 2.6s p95 comes from and it must stay. The duplicate emitter is inside `decryptBeanpodPayload` (`fileSync.ts:116-156`), which has **no production caller** (re-verified 2026-08-13: exactly 13 references — its own definition, `docOps.ts`, `types/sync.ts`, two comments in `syncStore.ts`, and 8 in tests). Reference set to clean: **six** `vi.mock` entries (`createNewFile.test.ts`, `syncStore.bannerVisibility.test.ts`, `syncStore.verifyPodAccess.test.ts`, `syncStore.saveStatus.test.ts`, `syncStore.migrate.test.ts`, `authStore.passwordRotation.test.ts`), **two** narrative comments in `syncStore.resume.test.ts`, two stale source comments (`syncStore.ts:1317`, `:1424`), a doc-comment in `types/sync.ts:121`, and `docOps.ts:217`. **Delete the whole dead function**, not just the label. Its corrupt-payload guarantees are already provided live by `docOps.loadAndVerify` (used by `cache.loadCachedDoc`), so nothing is lost.
**Do NOT touch the historical records** that also name it — `docs/STATUS.md:3255`, `docs/plans/2026-03-04-crdt-merge-safety-tests.md`, `docs/plans/2026-07-05-*`. They are dated accounts of what was true then; rewriting them destroys the audit trail. Only _live_ source/doc-comments get updated.

**C4 — The baseline must be persisted by the _worker_, committed with the cache write it describes — not by main.**
If main persists "we are current as of R" while the worker's cache persist is still inside its 120ms debounce (`applyAndProject.ts:65`) and the tab dies, the next open loads a cache _behind_ R, sees a baseline saying "current", skips the read, and shows stale data indefinitely. (Verified the 10s poll does not rescue this today: `reloadIfFileChanged` → `checkForConflicts` compares the file's mtime against `lastSync.value`, which `loadFromPersistenceCache` has just set to _now_ — `syncStore.ts:1281` — so `hasConflict` is false and the poll skips too.) Fix: the worker holds the value as pending and writes the row **inside `persistOnce`'s successful paths**, under C4a/C4b/C10/C11.

**C4a — "committed inside `persistOnce`" is not sufficient alone; the pending value must be captured in the SAME entry snapshot as `doc`/`captureHeads`.**
`persistOnce` computes everything from one pre-`await` snapshot precisely so a mutation landing mid-write is not skipped (`applyAndProject.ts:236-244` doc-comment, `:246-247` capture). A pending baseline read _after_ the awaits re-opens the exact hole C4 closes:

> A persist for doc-state S1 enters and awaits the IDB write. Main then merges remote@R2 and calls the setter, so `pendingRemoteBaseline = R2`. The in-flight persist (holding only S1) completes and, reading the module var at commit time, writes baseline R2. The S2 persist is still inside its 120ms debounce. Tab dies → cache holds S1, baseline claims R2 → the next open skips the read and is permanently stale.

**Rule:** `persistOnce` reads `const pending = pendingRemoteBaseline` **before its first `await`**, commits only that captured value, and clears the module var only if it still `===` the captured value. Same shape as the existing `currentDoc === doc` cursor guard (`:271`). Comment this at the capture site — it is a non-obvious invariant of the design.

**C4b — The baseline write must not be able to raise the durability banner.**
`persistOnce`'s `catch` sets `cachePersistFailed` and fires the persistent local-durability banner (`applyAndProject.ts:277-288`). A failed _baseline_ write is advisory (worst case: one extra Drive read) and must not tell the user their local data is at risk. Wrap the baseline put in its own `try/catch` with a `console.error` naming the function and the consequence ("baseline not advanced — next open will re-read, no data at risk"), placed **after** the doc write has succeeded and **before** `markPersistOk()`. Never `await` it before the doc write.

**C4c — the two commit points are exactly the two `markPersistOk()` call sites.**
Verified: `markPersistOk()` is called from precisely two places, both inside `persistOnce` — the `changes.length === 0` early return (`:261`) and the end of the try (`:277`) — and from nowhere else in the file. Those two calls therefore _are_ the function's success termini, covering all three write shapes (fresh base, increment, increment + re-compaction `writeBase`). Put `await commitPendingBaseline(pending, doc)` immediately before each. Two call sites, no restructuring of the delicate snapshot logic, nothing to enumerate. Do **not** move the commit inside `markPersistOk()` — it is sync and shared-looking; keeping it explicit at the two sites keeps the ordering (doc write → baseline → markPersistOk) readable.
Note the `changes.length === 0` terminus is reached with **no preceding `await` in the function body**, so C4a's pre-`await` capture is trivially satisfied there; it is still the same captured local, so both sites read identically.

**C5 — No new RPC method for the read side, no protocol change on the read path.**
`initAndLoadCache` already returns `{ loaded: boolean }` (`docClient.ts:821`, `applyAndProject.ts:378`). Widen to `{ loaded, remoteBaseline }` — reading the cache and reading the baseline that describes it is _one_ question and should stay one round-trip, so the two can never be read out of step. The write side adds exactly one fire-and-forget RPC (`noteRemoteBaseline`) — see C10 for why it cannot ride an existing setter. `syncService` already imports `docClient` — no new module edge.

**C5a — the fire-and-forget RPC must reuse ONE detached-call idiom, extracted rather than copied.**
`docClient.fireAndForgetMutate` (`docClient.ts:862-873`) is the house pattern: `void call().catch(e => reportError({surface, message, error, severity}))`, with a doc-comment explaining that in INLINE mode a rejection has no other signal. But it is hard-wired to `mutate(op)` — verified — so `noteRemoteBaseline` cannot call it, and writing "the same shape" by hand would leave **two** copies of the only thing standing between us and an unhandled rejection.
**Do this instead:** extract the body into a generic private helper in `docClient.ts`:

```
function fireAndForget(run: () => Promise<unknown>, surface: string, message: string,
                       severity: 'warning' | 'error'): void
```

`fireAndForgetMutate` becomes a two-line delegation (its existing doc-comment and behaviour unchanged), and `noteRemoteBaseline` is a second delegation with `surface: 'doc-baseline-fire-forget'`, `severity: 'warning'` (a lost baseline costs one extra read; it is not an error). One idiom, one place to fix it, no naked floating promises.

**C6 — `checkForConflicts` is not the pattern to reuse; it compares a server mtime against a local wall clock.**
`syncStore.ts:630-647` compares `syncService.getFileTimestamp()` (the file's `modifiedTime`, server clock on Drive) against `lastSync.value`, set from `new Date()` locally (`:918`, `:1281`). Clock-skew-prone. **Verified it has exactly two callers — `syncNow` (`:724`) and `reloadIfFileChanged` (`:2282`) — both of which use only `hasConflict`, and its export (`:3691`) has zero consumers anywhere in `src/` or `e2e/`.** So it is not merely "not the pattern": it is a _deletable duplicate_ of the comparison this plan is building. See C14 — one comparator, three callers, `checkForConflicts` / `getFileTimestamp` / `setLastKnownFileTimestamp` all deleted. The one correct comparison today is the mtime-vs-mtime fast path at `syncService.ts:875-883`; that is what gets extracted and upgraded.

**C7 — There is already a redundant metadata round-trip on every load.**
`syncService.load()` captures the timestamp at `:1052-1058`, then `syncStore.ts:915-916` immediately calls `getFileTimestamp()` → a **second** `getLastModified()` network call setting the same variable to the same value. Delete the second. Note `syncService.ts:1057` and `:989` (post-write capture in `doSave`) are both bare `catch { }` — no longer "non-critical" once they feed a persisted baseline.

**C8 — No new telemetry context keys are needed; the draft targeted the wrong file and missed the Lambda mirror.**
`ALLOWED_CONTEXT_KEYS` lives in `src/utils/diagnosticContext.ts:61`, **not** `logEvent.ts` (whose header at `:19-22` states `level`/`surface`/`message` are explicitly _not_ allowlist-filtered; `surface` is a free-form kebab-case string, so `'open-cycle'` needs no type change). Every key is mirrored in `infrastructure/lambda/telemetry/index.mjs` and pinned by its handler test — new keys would be silently stripped server-side (the 2026-07-10 `severity` failure, `diagnosticContext.ts:88-96`). Verified allowlisted on **both** sides: `action` (`:68` / `index.mjs:74`), `error_code` (`:69`/`:75`), `provider_type` (`:71`/`:77`), `detail` (`:161`/`:121`). Encode per-open counts into `message` plus those four keys. **Zero** allowlist, Lambda, `PrivacyInfo.xcprivacy`, Data-Safety and `privacy.astro` churn.

**C9 — One name, one owner for the baseline concept.**
**Name:** `remoteBaseline` everywhere (worker var `pendingRemoteBaseline`, cache row `REMOTE_BASELINE_KEY`, syncService var `remoteBaseline`, pure module `remoteBaseline.ts`).
**Owner (decision logic):** the pure module `src/services/sync/remoteBaseline.ts` (C15) — no I/O, no module state.
**Owner (I/O + policy application):** `syncService`. The worker returns the raw row; it never interprets it.
**Owner (storage):** `worker/cache.ts` owns the row and exposes exactly three functions (`readRemoteBaseline` / `writeRemoteBaseline` / `clearRemoteBaseline`) — **no new module**; it is ~25 lines and belongs beside the rows it sits next to.
**One variable, not two:** `syncService` replaces `lastKnownFileTimestamp` (`:76`) with a single
`remoteBaseline: { revision: string | null; modifiedTime: string | null; checkedAtMs: number } | null`.
`modifiedTime` is the in-memory-only fallback basis for providers with no revision (C14); only `revision` + `checkedAt` are persisted. Two parallel variables for one fact is exactly the rot C9 exists to prevent.

**C10 — The pending baseline may only be set once the doc actually contains that remote state.**
C4a's pre-`await` capture protects against a value arriving _during_ a write. It does **not** protect against a value that was set _before_ the merge landed:

> `pendingRemoteBaseline = R2` is set at t=0 (read time). A persist scheduled by an earlier mutation fires at t=5 holding the _pre-merge_ doc S1 and, capturing pending pre-`await` exactly as C4a requires, commits baseline R2 against a cache holding S1. Permanently stale.

**Rule — separate the two concerns that were conflated:**

- _Learning_ the marker is a **read-time** fact and stays in memory only, no RPC: `syncService.load()`, `fetchAndMergeRemote()`, `doSave()`'s write ack.
- _Committing_ it as a durable baseline happens only at a terminus where the worker's `currentDoc` provably contains that remote state. Exactly three such termini, each a one-line zero-network `syncService.commitRemoteBaseline()`:
  1. `syncStore.loadFromFile` after the merge/replace branch succeeds (`~:917`, where the deleted `getFileTimestamp` call used to sit)
  2. `syncService.fetchAndMergeRemote` after `mergeRemoteEnvelope` resolves (`~:900`)
  3. `syncService.doSave` after `currentProvider.write()` resolves (`~:980`) — here the doc _is_ what we wrote

Ordering is then guaranteed by the worker's serialized RPC FIFO (`docWorker.ts:40-55`): `noteRemoteBaseline` is dispatched strictly after the already-resolved `mergeRemoteEnvelope`, so `currentDoc` already holds the merge, and any persist entering afterwards holds a doc ⊇ that state.

**C10b — termini 2 and 3 both fire within a single `doSave`; the commit is LAST-WRITE-WINS.**
Verified: `doSave` calls `fetchAndMergeRemote()` itself (`syncService.ts:953-957`, inside its own non-fatal try) before writing. So one save can commit terminus 2 (the merged peer revision) and then terminus 3 (our write's ack) in sequence. Both are correct at the moment they fire, the FIFO orders them, and the later one wins. **Do not add an "only if newer" guard** — that would require ordering revision strings, which C12 forbids. `commitRemoteBaseline` is an unconditional set of whatever the current in-memory `remoteBaseline.revision` is; correctness comes from _where_ it is called, never from comparing values.

**C10a — `noteRemoteBaseline` must schedule a persist.**
`mergeRemoteEnvelope` calls `schedulePersist()` on both branches (`applyAndProject.ts:483`, `:499`), but that 120ms timer can fire before main's fire-and-forget RPC arrives (main runs `reloadAllStores`, ~550ms, in between). Without this the pending value sits uncommitted until the _next_ unrelated mutation — on a read-only session, forever, and the optimisation silently never engages. Fix: `noteRemoteBaseline` sets the var **and** calls `schedulePersist()`. A no-change persist costs the cheap `changes.length === 0` early return (`:260-262`), which per C4c is itself a commit point.

**C11 — The baseline commit must carry the same `currentDoc === doc` guard as the cursor advance.**
Without it: a persist for family A enters holding `pending = R_A`; a family switch runs `dropDoc()`/`reset()` (which `resetDocCursors()` clears the module var on) and `initPersistenceDB(B)` re-points `cacheDb`; the in-flight persist completes, still holding its _captured_ `pending = R_A`, and writes it into **B's** database. B then skips reads for up to the trust window. Reuse the existing idiom verbatim (`applyAndProject.ts:271`): commit only `if (currentDoc === doc)`. One condition, one invariant, no new concept.

**C18 — `pendingRemoteBaseline` must ALSO be cleared at the two DB-open entry points, not only in `resetDocCursors()`.**
C11 closes the _in-flight_ leak. It does **not** close this one, which is a fresh find:

> `initAndLoadCache(B)` is reached without a preceding `reset()`/`dropDoc()`. A leftover `pendingRemoteBaseline = R_A` survives. The **next** persist — one for B's doc — captures it pre-`await`, finds `currentDoc === doc` **true** (it is B's doc, unchanged since capture), and writes A's revision into B's cache DB.

Today this is unreachable because every family switch goes through `docClient.reset()` (verified: `authStore.ts:672`, `:1328`; `indexeddb/database.ts:59`). But that is _caller_ discipline in another module, and the guard belongs at the boundary that actually defines the row's scope: `cache.initPersistenceDB` re-points `cacheDb`, and its only two callers in `applyAndProject` are `initAndLoadCache` (`:378`) and `openCache` (`:373`). **Clear `pendingRemoteBaseline` as the first statement of both** — two lines, both in functions this plan is already editing (C-5/C16), and the leak becomes structurally impossible rather than contingent on `authStore`.

**C17 — `noteRemoteBaseline` is deliberately NOT added to `RETRYABLE_METHODS`.**
`docClient.ts:394-411` is an affirmative allowlist of methods safe to transparently re-issue after a worker respawn, with an explicit contract: _"any FUTURE method is likewise non-retryable until explicitly vetted and added here."_ Record the vetting decision rather than leaving it to silence:

> A respawned worker has no `currentDoc` and rebuilds from cache. Re-issuing `noteRemoteBaseline(R)` would seed a pending baseline against a doc the worker is about to reconstruct from a cache that may be _behind_ R — the exact C10 failure, re-created by the auto-heal.

So: **not retryable**. A dropped baseline costs one extra read on the next open (the safe direction). Also confirm it needs no membership in `HEAVY_METHODS` (it is a variable set, not a megabyte payload), `ENVELOPE_METHODS` (`:382`), `JSON_SAFE_METHODS` or `USER_ACTION_METHODS` (`:419` — no user edit is in doubt; a failure is firehose-only via `notifyFailure`, which is exactly right). State all five decisions in one comment beside the method.
The widened `initAndLoadCache` **stays** retryable: reading the cache and its baseline row is still a pure, idempotent read.

### The hard invariant this plan must not break

`syncService.ts:884-887` and the save-path comment (`:971-977`) carry ADR-032-addendum invariants: the base is the sole source of a peer's edits — _do not gate or skip the whole-doc read_ on the assumption a delta layer carries them; and every save writes the FULL compacted base — do not coalesce or reduce its frequency.

This plan stays inside both. It gates the read on **"the file's own revision counter has not advanced past the state we have durably cached"** — a fact about the file itself, not an assumption about a delta layer. It gates the write on **`dirty`** (heads-derived, `applyAndProject.ts:504`), which only skips writes that publish nothing. Three of the four save sites already do this (`syncStore.ts:785`, `syncService.ts:910`).

Verified safety note for the `dirty` gate: doc-changing mutations made _after_ the merge (the recurring dedup at `syncStore.ts:925`) still trigger a save independently — `docClient.mutate` fires `localChangeHandler` on any change (`docClient.ts:853-856`), wired to `triggerDebouncedSave`. Gating `:930` cannot drop a dedup write.

### C12 — Compare a REVISION COUNTER, not a modification time (greg's directive, 2026-08-13)

An earlier draft compared `modifiedTime` and accepted a bounded divergence window as the price. **greg rejected that**, correctly: "if a device diverges, that's a legitimate reason to reload the data file", and a daily user sitting out-of-sync across multiple opens erodes exactly the trust this issue exists to protect. The divergence is not merely boundable — it is **eliminable**, because it was an artifact of staking correctness on a clock.

**Both divergence paths came from mtime:**

1. `doSave` writes the file, then makes a **separate** metadata read to learn the new mtime (`syncService.ts:985-991`). A peer's write landing in that window is recorded as _our_ baseline — we never merged their content, but the baseline claims we are current.
2. "mtime always advances" is an assumption about Drive's clock. Unverified, and unverifiable from here.

**The fix — a monotonic, server-assigned counter instead of a timestamp.**

**Use Drive's `version`, and only `version`.** An earlier draft used `headRevisionId` with `version` as a runtime fallback and a `head:` / `ver:` namespace prefix to keep the two apart. That is **two production code paths, two field semantics and a namespace-collision guard for one boolean question**, plus a "MUST VERIFY against a real file before implementing" blocker on the critical path — all to buy a slightly narrower change trigger. Collapse it:

- `version` is defined for **every** Drive file (no binary-content caveat, so no pre-implementation blocker) and advances on **any** server-side change, including the content writes we care about. It is strictly more conservative than `headRevisionId`: it can only ever trigger an _extra_ read (e.g. on a permission change), never miss one. Given C12's whole design is "degrade towards reading", the conservative field is the correct one _and_ the simpler one.
- **One field, one code path, no runtime preference, no dual-namespace reasoning.** Keep only the `ver:` prefix on the stored string, as a one-line forward-compatibility guard so a future build that switches fields can never compare two namespaces as if they were one.
- **The stored value is an opaque string. Compare it with `!==` only — never `<`/`>`.** Drive returns int64 fields as JSON strings; ordering comparisons on them are a silent-wrong-answer trap and buy nothing (we only ever ask "same or not"). This is also why C10b forbids an "only if newer" commit guard.
- `headRevisionId` is still _requested_ in the same `fields=` list and **recorded in the audit doc and in the `open-cycle` `detail` string as evidence only**. If field data later shows a meaningful volume of `version`-advanced-but-content-unchanged reads, switching to it is a one-line change behind the existing prefix. Do not pre-build that.

Verified this costs **no extra network call and no new driveService function**:

- `getFileMetadata(token, fileId, fields)` is already a generic field fetcher (`driveService.ts:250-265`). `getFileModifiedTime` (`:242-247`) just hardcodes `fields=modifiedTime`. We ask the same endpoint for `modifiedTime,version,headRevisionId` in **one** request — so the probe returns the counter _and_ the mtime fallback together (C14). No `getFileRevision()` wrapper is needed; adding one would duplicate `getFileMetadata`.
- The write is `PATCH …/files/{fileId}?uploadType=media` and today **discards its response** (`driveService.ts:186-197`). Adding `&fields=version,headRevisionId` returns **our own write's counter in the write response** — deleting hazard 1 outright, because there is no longer a separate post-write metadata read for a peer to race.

**The single invariant that makes every case checkable:**

> **Commit revision R as the baseline only if our doc provably contains the file's content at R.**
> There are exactly two ways to establish that: (a) we sampled R from metadata _strictly before_ downloading and merging the bytes, or (b) R is the ack of our own write.
> Every other outcome (no revision, a stale revision, a failed probe) must degrade to "baseline not advanced" → **an extra read, never a missed one**.

| Baseline source                                       | If a peer writes concurrently                   | Result                         |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| Metadata sampled **before** a download+merge          | remote counter advances past our recorded value | we read next open — extra read |
| **Our own write's ack**                               | their write yields a strictly later counter     | we read next open              |
| Probe failed / provider has no counter / parse failed | baseline untouched or null                      | we read next open              |

There is no third path, and no case in which remote content differs while the committed counter matches.

**C13 — `syncService.load()` samples metadata AFTER the download — that violates C12's invariant and must be reordered.**
Verified: `load()` calls `currentProvider.read()` at `:1046`, and only then reads `getLastModified()` at `:1054-1059`. A peer write landing between those two lines yields a marker describing content we **did not download**. Committed at terminus 1, that is precisely the "stale forever" bug this design exists to prevent (bounded only by the 1-hour backstop). `fetchAndMergeRemote` already has the correct order (probe `:875`, read `:885`).
**Fix:** in `load()`, move the marker probe to **immediately before** `currentProvider.read()` — i.e. _after_ the `LocalStorageProvider` permission check (`:1034-1043`) and _inside the same `try`_, so the existing `NotFoundError` / `DriveApiError 404` classification at `:1063-1072` still governs. Two hard sub-rules, both easy to get wrong:

- A probe failure must leave the baseline **null** (→ read next open) and must **never fall through to a post-read sample**.
- A probe throw must **not fail the load**. Wrap the probe so any error nulls the baseline and returns; the read then proceeds exactly as today. (Auth errors still surface — the following `provider.read()` raises the same `TokenExpiredError`/401/404 into the existing classification. Nothing is swallowed; the signal simply arrives one line later.)
  Comment the ordering as load-bearing at both sites, because it looks like a harmless reordering and it is not.

**Provider split.** `LocalStorageProvider` opts into `supportsLocalPolling()`; `GoogleDriveProvider` returns **false** (`googleDriveProvider.ts:354-356`) so it stays out of `syncService`'s `usePollWhileVisible` loop. Note (correcting an earlier draft) that Drive is **not** unpolled: `syncStore` runs its own provider-agnostic 10s `startFilePolling` → `reloadIfFileChanged` (`syncStore.ts:2269`, `:2338-2343`), which is why the net metadata-call count at open is unchanged by this plan. The guard is enabled **only when the probe returns a counter**; anything else always reads.

### The 1-hour backstop (insurance, not compensation)

With C12 the guard is exact, so the backstop is no longer covering a known hole — it is unknown-unknown insurance, and it can only ever cause an _extra_ read. **greg's directive: 1 hour**, on the reasoning that a 1-day or 7-day bound is indistinguishable from having none, because a daily user would sit stale across many opens before it fired.

- The baseline row stores the revision plus the local wall clock at which it was committed (`checkedAt`).
- The guard skips **only** when the revision matches **and** `Date.now() - checkedAt < BASELINE_MAX_TRUST_MS` (**1 hour**, one exported constant in the pure module carrying this reasoning in its doc-comment).
- `checkedAt` is the row's existing `updatedAt` ISO string; parse with `Date.parse` and treat **NaN or a future timestamp as expired** (→ read). A malformed clock value must never grant trust. (The overload is safe because `writeRemoteBaseline` is the _only_ writer of that row — state this in the row's comment, so nobody later "refreshes" it for an unrelated reason and silently extends trust.)
- Wall clock here is a _self-heal bound_, never a correctness comparison (C6's objection does not apply) — it can only trigger work, never skip it.
- **At most one extra read per device per hour**, not per open: the read that the expiry triggers refreshes `checkedAt`, so subsequent opens within the next hour skip normally.

Cost: bounded at one full background read per device per hour. Benefit: even a total, silent failure of the entire design self-heals within an hour rather than persisting across a day of opens.

### C14 — ONE change-comparator, three callers, three deletions

The codebase currently answers "has the remote file changed?" **twice, differently**: the mtime-vs-mtime fast path in `fetchAndMergeRemote` (`syncService.ts:875-883`, correct) and the mtime-vs-wall-clock `checkForConflicts` (`syncStore.ts:630-647`, skew-prone). Adding a third comparator for the open guard would be exactly the duplication this review exists to prevent — and C6 verified `checkForConflicts` has two callers that use only `hasConflict` and zero external consumers.

**One function owns the question — and answers only that question:**

```
// syncService.ts (I/O shell; the comparison itself lives in remoteBaseline.ts — C15)
export async function remoteChanged(): Promise<ChangeResult>;

// remoteBaseline.ts (pure)
type ChangeStatus = 'changed' | 'unchanged' | 'unknown';
interface ChangeResult {
  status: ChangeStatus;
  basis: 'revision' | 'mtime' | 'none';
  revision: string | null;
  modifiedTime: string | null;
  reason?: string;      // set whenever status/basis is degraded — always logged
}
```

Rules inside it (nowhere else):

- Probe the provider once (C14a). Any throw → `{status:'unknown', basis:'none', reason:'provider-error:<name>'}` + `console.warn` naming the function and the fix. Never rethrows.
- Revision present on both sides → `basis:'revision'`, strict `!==` comparison.
- No revision, mtime present → `basis:'mtime'`, mtime-vs-**mtime** against the in-memory baseline (today's exact semantics: no baseline + evidence ⇒ `changed`).
- No evidence at all → `basis:'none'`, `status:'unknown'`.

**`remoteChanged` deliberately does NOT know about the trust window.** Two of its three callers have no concept of trust, and a caller that has to `&&` three predicates together is a caller that will one day `&&` two. So the composition lives in exactly one place, next to it:

```
/** The ONLY place that decides an open-path read may be skipped. */
export async function shouldSkipOpenRead(): Promise<{ skip: boolean; reason: string }>;
```

It calls `remoteChanged()`, applies `basis === 'revision' && status === 'unchanged' && withinTrustWindow(...)`, and returns a classified `reason` on every non-skip. `BASELINE_MAX_TRUST_MS` never leaves `syncService`/`remoteBaseline.ts`; `syncStore` never sees `status`, `basis` or a clock.

**Callers, each one line, zero try/catch, zero nesting:**

| Caller                                | Call                                                   | On `unknown`      | Why                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open guard (`backgroundSyncFromFile`) | `shouldSkipOpenRead()`                                 | **reads**         | One-shot per open; a spurious read costs one download.                                                                                                                                  |
| `fetchAndMergeRemote`                 | `remoteChanged()`, download iff `status === 'changed'` | **does not read** | Byte-for-byte today's behaviour, incl. "null mtime ⇒ don't read" for `memoryProvider` (`memoryProvider.ts:48`).                                                                         |
| `reloadIfFileChanged` / `syncNow`     | `remoteChanged()`, act iff `status === 'changed'`      | **does not read** | 10s poll: reading on every unknown would turn a persistent provider error into a read storm. Matches today (`getLastModified` returns null on transient failure → `hasConflict:false`). |

That asymmetry is deliberate and is the single behavioural difference between the guard and the polls — write it in `shouldSkipOpenRead`'s doc-comment, because "unknown means read" is _only_ true there.

**Deleted by this consolidation:** `syncStore.checkForConflicts` (+ its export), `syncService.getFileTimestamp` (`:1014-1019` — after the migration its last caller is gone), `syncService.setLastKnownFileTimestamp` (`:569-571` — after B5 its only production caller is gone). Three dead exports removed, one comparator left. `src/services/sync/__mocks__/syncService.ts:69` and `src/stores/__tests__/syncStore.migrate.test.ts:109` are the only test-side references to update.
**Risk note (state it in the PR):** the poll/`syncNow` basis changes from wall-clock to file-metadata. Semantics get _stricter and more correct_; the "no baseline yet" case still returns `changed` (as `hasConflict:true` did), so first-tick behaviour is unchanged. Covered by tests 1 and 7. Ships in PR 2 as its own revertable commit.

**C14a — ONE provider probe method, and only Drive implements it.**
Add a single optional method to `StorageProvider` (`storageProvider.ts` — note it already carries the optional-method-with-shared-fallback pattern for `supportsLocalPolling?()` and the four aux methods, so this is the house shape, not a new one):

```
/** Cheap metadata probe: monotonic revision counter (null when the backend has none)
 *  plus mtime, in ONE round-trip. Absent ⇒ the shared fallback uses getLastModified(). */
getRemoteMarker?(): Promise<{ revision: string | null; modifiedTime: string | null }>;
```

- `GoogleDriveProvider` implements it via `getFileMetadata(token, fileId, 'modifiedTime,version,headRevisionId')` — **one** call replacing today's `getFileModifiedTime`, so no added round-trip anywhere.
- `localProvider` / `capacitorFileProvider` / `memoryProvider` are **not touched**: when the method is absent, `remoteChanged` falls back to `getLastModified()` (one place, in the helper). Zero churn, zero duplicated fallbacks, and their existing "return null on failure" behaviour (`localProvider.ts:171-186`, `capacitorFileProvider.ts:93-101`, `memoryProvider.ts:48`) is preserved.
- **DRY inside the Drive provider:** `getLastModified` (`googleDriveProvider.ts:261-274`) already carries the _only_ correct classification of Drive metadata failures (rethrow `TokenExpiredError` / 401 / 404, return null on transient/5xx). Extract that try/catch into a private `metadataProbe<T>(fn)` used by **both** `getLastModified` and `getRemoteMarker`. Do not copy-paste the classifier.
- Auth errors still surface: `remoteChanged` converts a rethrown `TokenExpiredError`/401/404 into `status:'unknown'` (+ classified reason + telemetry), the caller reads, and the subsequent `provider.read()` raises the same error into the existing `loadFromFile` classification / reconnect banner. Nothing is swallowed; the signal simply arrives from the read rather than the probe. Assert this in the tests.

**C14b — capturing our own write's revision, without churning four providers.**
`StorageProvider.write` is `Promise<void>` and has three callers (`syncService.ts:980`, `offlineQueue.ts:101`, `syncStore.ts:1588`). Widen the interface to:

```
write(content: string): Promise<WriteAck | void>;   // WriteAck = { revision: string | null }
```

A `void`-returning implementation still satisfies it, so **`localProvider`, `capacitorFileProvider`, `memoryProvider` and every test double need no edit**. Only `GoogleDriveProvider.write` returns an ack.

Hard requirements on the Drive write path — each is a silent-failure or data-cost trap:

- **Read the ack through an explicit truthiness narrow, at exactly one site.** `WriteAck | void` is the right _interface_ type (it is what keeps three providers and every double untouched) but it is an awkward _value_ type — optional chaining across a `void` union does not narrow the way `?.` usually does. `doSave` is the only reader: `const ack = await currentProvider.write(fileContent); const ackRevision = ack ? ack.revision : null;`. Nothing else in the codebase ever touches the union.
- `driveService.updateFile` gains `&fields=version,headRevisionId` and returns `{revision}`. **Parsing the response body must never throw**: wrap `res.json()` in try/catch → `{revision: null}` + `console.warn`. A parse failure must not turn a _successful_ 2–3MB save into a save-failure banner, and — because the call is wrapped in `withRetry` (`googleDriveProvider.ts:157`) — must never trigger a **re-upload of the whole file**.
- **There are exactly TWO `updateFile` call sites in `googleDriveProvider.write`** (verified 2026-08-13 by grep over `src/`): the primary at `:157` and the silent-refresh retry at `:166`. **Both must propagate the ack** — the retry branch currently does a bare `return;` and missing it silently disables the optimisation for every token-refresh save. (An earlier draft said "three sites, including the returned path"; there is no third — the primary path's `return` _is_ the value of the outer expression.) `withRetry<T>` (`googleDriveProvider.ts:57`) is **already generic and returns `T`**, so the ack flows through it with no change to the retry helper.
- `offlineQueue.ts:101` and `syncStore.ts:1588` (create-path envelope write) deliberately **ignore** the ack: they write outside `doSave`, so no baseline is set and the next open re-reads. Safe direction by C12's invariant — say so in a one-line comment at both, otherwise someone "helpfully" wires them up later and breaks it.
- In `doSave`, if the ack carries no revision (non-Drive provider, or a parse failure), fall back to today's post-write `getLastModified()` **only to refresh the in-memory mtime basis** (this is what stops a local-file poll re-reading its own write); it never becomes a persisted baseline. The bare `catch {}` at `:989` becomes a classified `console.warn` + `logEvent`. For Drive the post-write metadata call disappears entirely — **one fewer network round-trip per save**.

**C15 — the decision logic is a PURE module; `syncService` stays a thin I/O shell.**
`syncService.ts` is already 1384 lines, holds ~12 module-level mutable vars, and is the most-mocked module in the codebase (`src/services/sync/__mocks__/syncService.ts`). Adding the comparator, the trust window, the marker parsing, the namespace prefix and every degradation case _into_ it would mean the trickiest reasoning in this plan is only testable through a provider mock, a fake clock and a module reset — which is how such logic stops being tested at all.

**New file `src/services/sync/remoteBaseline.ts` — pure, no imports from `syncService`, no I/O, no module state:**

```
export const BASELINE_MAX_TRUST_MS = 60 * 60 * 1000;   // 1 hour — see "the 1-hour backstop"
export interface RemoteMarker { revision: string | null; modifiedTime: string | null }
export interface RemoteBaseline { revision: string | null; modifiedTime: string | null; checkedAtMs: number }
export interface WriteAck { revision: string | null }
export type ChangeResult = { status; basis; revision; modifiedTime; reason? }

export function toStoredRevision(version: string | null): string | null;   // `ver:` prefix
export function compareMarkers(baseline: RemoteBaseline | null, probe: RemoteMarker): ChangeResult;
export function withinTrustWindow(checkedAtIso: string | null, nowMs: number): boolean;  // NaN/future ⇒ false
```

`syncService` keeps only: the module var, the probe call, the fallback to `getLastModified()`, the three commit termini, the seed setter, and the telemetry. Every branch of the comparison and the clock handling is a table-driven unit test with **zero mocks** (Testing 1a). This is the single highest-leverage maintainability decision in the plan: the part most likely to be changed later is the part that is cheapest to change safely.

**C16 — `openCache` must CLEAR the baseline row.**
`docClient.openCache(familyId)` (`syncStore.ts:1617`) is the deliberate "open the DB but do **not** load" path used by `createNewFile`, precisely because a pre-existing cache row from a prior/interrupted create must not be loaded over the fresh owner doc (ADR-032 F1). Verified it is the only caller. That same prior attempt can also have left a `remote-baseline` row behind — a row describing a doc state we have just deliberately discarded. Today's revision comparison would still catch it (the fresh Drive write yields a new counter), but relying on that is relying on a _second_ mechanism to cover a broken invariant.
**Rule, stated once and applied uniformly:** _a baseline row may only exist alongside a cache that was actually loaded and verified._ Three enforcement points, all one-liners: `openCache` clears it, the `recovered` path clears it (C-5), and `clearCache`'s whole-DB delete takes it. Do not add a fourth mechanism; do not weaken the rule to "usually fine".

**C19 — the snapshot no-op cursor (B4) must advance only on SUCCESS, from the entry snapshot.**
`persistSnapshotOnce` (`applyAndProject.ts:167-182`) captures `const doc = currentDoc` pre-`await` and **swallows every failure into a `console.warn`** (`:178-181`) — deliberately, because the snapshot is display-only. Two consequences for the new `lastSnapshotHeads` cursor, both of which turn a benign transient into a silent permanent regression if missed:

- **Derive the heads from the captured `doc`, before the awaits** (`const heads = headsOf(doc)`), never from a post-`await` `currentDoc` — same reason as C4a.
- **Assign `lastSnapshotHeads = heads` only after `cache.persistProjectionSnapshot` resolves, inside the `try`.** Assigning before (or in a `finally`) means one transient IDB failure suppresses every later snapshot persist for the session — the fast-paint snapshot silently rots and the 2026-08-12 win quietly reverses, with no signal because the failure path is a `console.warn`.
- Guard the assignment with `if (currentDoc === doc)` for the same reason as `persistOnce`'s cursor (`:271`).

**C20 — the open-cycle measurement window has ONE owner: `App.vue`'s `loadFamilyData`.**
The A1/A2 draft put both `beginOpen` and `endOpen` inside `backgroundSyncFromFile`. Verified that is wrong on two counts:

1. **`backgroundSyncFromFile` is not the open path — it is only path 1a's tail.** `loadFamilyData` (`App.vue:408`) is the sole open orchestrator, and it labels its own paths in breadcrumbs: `path1a` (`:441`), `path1b` (`:479`), `path2` (`:566`), `path3` (`:602`). Only path 1a hands off to `backgroundSyncFromFile` (fire-and-forget at `:468`, then `return`). Instrumenting only `backgroundSyncFromFile` means **paths 1b, 2 and 3 never emit an open record**, which silently reduces Requirement 11 and the "exactly one reconstruction per open" acceptance criterion to path 1a alone.
2. **`backgroundSyncFromFile` has two non-open callers** — the header Refresh button (`AppHeader.vue:193`) and the deferred config-heal (`syncStore.ts:2710`). Opening a window there would count manual refreshes as app opens and corrupt the baseline PR 2 is measured against.

**Rule:**

- `beginOpen(path)` is called **only** from `loadFamilyData`, once, as soon as the path is known.
- `endOpen(outcome)` is called at **every** `loadFamilyData` terminal **except** the path-1a hand-off (`App.vue:468-469`), where `backgroundSyncFromFile` owns the terminal instead (its success, skip and every failure branch).
- `bump()` and `endOpen()` are **no-ops when no window is open**, so the Refresh-button and deferred-heal calls into `backgroundSyncFromFile` emit nothing — no caller-side conditionals needed.
- `beginOpen` called while a window is already open emits the previous one as `open-abandoned` before resetting. Three lines, and it converts "someone added a terminal and forgot `endOpen`" from a silently-lost record plus leaked counters into a visible rate.

**C21 — on the skip path the envelope comes from the cache, and that is only sound because envelope writes advance `version`.**
`loadFromFile`'s success terminus calls `replaceEnvelope(remoteEnvelope)` + `syncService.setFamilyKey(familyKey, merged)` (`syncStore.ts:908-911`). Skipping it means `syncService`'s envelope is whatever `loadFromPersistenceCache` installed from the worker's persisted envelope cache (`syncStore.ts:1273-1275`) — and the guard is only reachable after that, so `currentEnvelope` is never null and `doSave` is never blocked. Verified.
The reason this is _correct_ rather than merely non-crashing: an envelope-only change (peer key rotation, member add, invite key) rewrites the same Drive file, so its `version` advances and the guard reads. **Write this link explicitly at the guard**, because "we skipped the read, so where did our envelope come from?" is the first question a reviewer will ask, and the answer depends on a fact three files away.

### Simplifications considered and deliberately rejected

_Recorded so the next reviewer does not re-litigate them, and so the ones that were rejected on cost can be revisited if the cost changes._

- **Group the worker's three cursors into one `docCursors` object** (making "forgot one" structurally impossible rather than merely centralised). **Rejected:** it would edit `lastPersistedHeads`'s read sites inside `persistOnce` — the most delicate code this plan touches — for a benefit `resetDocCursors()` already delivers at zero risk. Revisit only if a fourth cursor appears.
- **A separate `readRemoteBaseline` RPC instead of widening `initAndLoadCache`.** **Rejected:** the cache and the baseline that describes it must be read in the same round-trip or they can be read out of step; one method, one answer (C5).
- **A `remoteBaseline` module inside the worker for the cache row.** **Rejected:** ~25 lines living beside the rows they sit next to is not a module (C9).
- **`headRevisionId` with a `version` fallback and dual namespaces.** **Rejected** in favour of `version` alone — one field, one path, no pre-implementation blocker, strictly-safer failure direction (C12).
- **Keeping `checkForConflicts` and filing its clock-skew bug as a follow-up.** **Rejected:** a follow-up nobody runs is a second comparator forever (C14).
- **Skipping the `openCycle` counters and relying on the pass-count unit tests alone.** **Rejected for now**, but the module carries an explicit removal criterion (A1) so this decision is re-evaluated on evidence rather than by accretion.
- **Clearing `pendingRemoteBaseline` inside `cache.initPersistenceDB` (the true boundary).** **Rejected:** `cache.ts` owns rows, not orchestrator state; the two-line clear belongs in `applyAndProject`'s two DB-open entry points, which are the only callers (C18).
- **Making `noteRemoteBaseline` retryable so a worker respawn cannot lose a baseline.** **Rejected:** a re-issue against a not-yet-rebuilt doc re-creates the C10 bug; losing a baseline costs one extra read (C17).

## Requirements

1. **Committed load-cycle audit** at `docs/investigations/2026-08-13-open-cycle-load-audit.md` (precedent: `2026-07-15-cold-load-perf-regression.md`), mapping every full read / decrypt / `Automerge.load` per open path — 1a, 1b, path 2 (configured-but-needs-permission), path 3, sign-in, PWA cold relaunch — each marked necessary or not, with reasoning; plus the observed `version` / `headRevisionId` values for a real `.beanpod`.
2. **Persist the remote baseline in the worker cache DB**, committed by the same successful persist that durably stores the doc state it describes, under C4a (entry snapshot), C4b (own try/catch), C4c (the two `markPersistOk` sites), C10/C10b (post-merge ordering, last-write-wins), C11 (`currentDoc === doc`) and C18 (cleared at both DB-open entry points).
3. **Gate the open-path Drive read** on the single `shouldSkipOpenRead()` composition over `remoteChanged()` (C14), revision-basis only (C12), with the 1-hour trust bound.
4. **Gate the post-merge save on `dirty`** at `syncStore.ts:930` — capture the value discarded at `:893`.
5. **Make the post-merge `reloadAllStores` / dedup conditional on the merge actually changing the doc**, via a `changed` flag that **defaults to `true`** (mirrors `mutate`'s contract, `applyAndProject.ts:444-450`).
6. **Suppress no-op projection-snapshot persists** by heads comparison rather than timer restructuring, with the cursor advancing only on success (C19).
7. **Delete the dead `decryptBeanpodPayload`** (C3) and its _live_ stale references — historical docs untouched.
8. **Remove the duplicate `getFileTimestamp()` round-trip** at `syncStore.ts:915-916`, the Drive post-write metadata read (C14b), and log the swallowed failures at `syncService.ts:1057` and `:989` (C7).
9. **Reorder `syncService.load()`'s marker probe to precede the download** (C13), non-throwing.
10. **Collapse three change-detectors into one** `remoteChanged()`, with the decision logic in a pure `remoteBaseline.ts` (C15), deleting `checkForConflicts`, `getFileTimestamp` and `setLastKnownFileTimestamp` (C14).
11. **Emit one structured per-open record** on success and failure under surface `open-cycle`, using existing allowlisted keys only (C8), with the window owned by `loadFamilyData` and covering **all four** open paths (C20).
12. **Extract `runPostLoadDriveHousekeeping()`** covering the _whole_ success terminus `syncStore.ts:933-942` so the skip path cannot drift from the load path.
13. **Enforce the baseline-row lifecycle rule** (C16): the row exists only alongside a loaded+verified cache — cleared by `openCache`, by the `recovered` path, and by `clearCache`.
14. **Extract one detached-call helper** in `docClient` and route both `fireAndForgetMutate` and `noteRemoteBaseline` through it (C5a); record the `RETRYABLE_METHODS` non-membership decision (C17).
15. **Re-measure before and after** on a real 2-3MB `.beanpod`; record in `docs/PERFORMANCE.md`.
16. **Withdraw** the intake's "remove the double reconstruction" item (C1), recording why in the audit.

## Important Notes & Caveats

- **Correctness outranks speed, always.** A load that can only go by weakening a guarantee stays, and the reasoning is written down.
- **Do not touch `replaceDocWithCacheRecovery`'s cache-then-merge structure** (`syncStore.ts:756-786`).
- **Do not weaken the ADR-032 write invariant.** Gating on `dirty` is a consistency fix, not a frequency reduction — say so in the code comment.
- **Skipping the background sync must not skip its side effects — and the naive list is incomplete.** Verified the Drive success terminus of `loadFromFile` runs: `setupTokenExpiryHandler()` (`:934`), **`updateProviderEmailAfterLoad()` (`:935`** — called from exactly one place, sets `providerAccountEmail` + re-persists provider config), `reconcileDriveTokenForMember()` (`:936`), `setupAutoSync()` (`:939`) and `markPodCreated()` (`:942`). The first three are inside an `if (providerType === 'google_drive')` gate — the gate moves **into** the extracted function, not to its call sites.
  Verified nuance: `loadFromPersistenceCache` already calls `reconcileDriveTokenForMember()` + `markPodCreated()` (`syncStore.ts:1294-1297`), and the skip path can only be reached after it, so those two are idempotent re-calls; the ones genuinely at risk of being dropped are `setupTokenExpiryHandler`, **`updateProviderEmailAfterLoad`** and `setupAutoSync`. Extract the block whole anyway — `markPodCreated`'s own contract (`authStore.ts:467-472`: "call this at EVERY terminus that successfully creates OR reads a pod… A loader that forgets it strands the user on the create-recovery screen and false-fires `app.onboardingZombieState`") makes inclusion the safe default, and an enumerated caveat rots the first time someone adds a line to that block.
  Note `backgroundSyncFromFile` also calls `setupAutoSync()` on its own success path (`:2211`) — leave it; it is idempotent and removing it is out of scope.
- **The header Refresh button still genuinely refreshes.** `AppHeader.vue:193` calls `backgroundSyncFromFile()` and toasts `header.refreshSuccess` when no error is set. The guard skips only the _download_: the metadata probe always runs and is always fresh, so a changed file is still fetched and the toast stays honest. The trust window can only force _more_ reads, never fewer. Assert this in a test — it is the most likely "the app stopped refreshing" bug report.
- **`lastSync.value` is already fresh on the skip path.** `loadFromPersistenceCache` sets it to now (`:1281`) and the skip can only be reached after it, so `SaveStatusIndicator` is correct without the guard touching it. Do not add a second write.
- **`beanpodSizeKb` is not refreshed on a skipped open — verified benign.** `recordPersistedBytes` runs in `syncService.load()` (`:1052`) and `doSave` (`:981`); a skipped, read-only open calls neither, so `getLastPersistedBytes()` stays null and `currentBeanpodSizeKb()` returns null. That is already the documented contract — the registry **omits the field and preserves the stored value** (`syncStore.ts:3518-3527`). Correct by construction: the file did not change, so the stored size is still accurate. Record it in the audit so it is not mistaken for a regression later.
- **Envelope-only changes are still file writes.** A peer's key rotation / member add rewrites the same Drive file, so its `version` advances and the guard reads. This is what makes C21 sound. Record it in the audit — it is why skipping cannot strand a device on a stale envelope.
- **Net metadata calls at open: zero added.** One probe added at the guard, one `getFileTimestamp()` removed at `syncStore.ts:915`; the 10s `startFilePolling` loop (`:2269`) already issues one per tick for every provider, so the guard's probe is noise against it. Net calls per _save_: **one fewer** on Drive (C14b).
- **The worker FIFO (`docWorker.ts:40-55`) is strictly serial** — this is what makes C10's ordering argument sound. But `persistInFlight` / `snapshotInFlight` run _outside_ the FIFO, which is why C4a, C11 and C19 are all necessary.
- **`applyAndProject` already carries 8 module-level mutable vars** (`currentDoc`, `familyKey`, `sink`, `persistTimer`, `cachePersistFailed`, `lastPersistedHeads`, `persistInFlight`, `snapshotTimer`/`snapshotInFlight`). This plan adds two more cursors, and every cursor must be nulled in `dropDoc` (`:599`), `reset` (`:607`), `loadSnapshot` (`:627`), `initDoc` (`:351`) and `__resetApplyAndProjectForTesting` (`:726`). Five sites × three cursors is a "forgot one" bug waiting to happen. **Introduce a single `resetDocCursors()` and call it from all five** — plus the two DB-open clears of C18, which are a different concern (scope, not lifecycle) and stay explicit. (The object-literal alternative was considered and rejected — see "Simplifications considered".)
- **`perfTiming.record()` early-returns below `CONSOLE_FLOOR_MS = 1`** (`perfTiming.ts:24`, `:46-47`; the floor is applied to `Math.round(durationMs)`). The reconstruction counter bump must be the **first statement in the function, above that return** — otherwise a sub-millisecond or fake-timer-mocked load reports zero reconstructions and the acceptance criterion silently passes on a lie.
- **`TELEMETRY_FLOOR_MS = 250`** (`perfTiming.ts:26`) drops sub-floor events. Success must be counted, not timed.
- **Dependency direction:** `perfTiming` (a util) → `openCycle` (a service) is the one new upward edge, and it is acceptable only because `perfTiming` already imports `@/services/telemetry` (`perfTiming.ts:22`) and `openCycle` imports nothing but `logEvent`. `openCycle` must have **no import-time side effects** and must never import a store or a util, or the edge becomes a cycle. `App.vue` importing it is a view→service edge, which is ordinary.
- **Ships ungated** at greg's direction, on the path that produced both the 2026-07-15 cold-load regression and the 2026-08-12 save-storm. Hence staged verification, a soak gate between the two PRs, and per-commit revertability.

## Assumptions

1. ~~Drive's `modifiedTime` advances on every write.~~ **RETIRED by C12.** Replaced by: Drive's `version` is present on every file and advances on every server-side change. Documented behaviour, no binary-content caveat — so this is **no longer a pre-implementation blocker**; confirm the observed values in the audit doc alongside the first real-file measurement. If `version` is ever absent or unparseable, the probe returns `revision: null` and the guard always reads.
2. The cache DB takes one more row without a version bump — **verified**: `openDB(dbName, 1, …)`, single `keyPath: 'id'` store (`cache.ts:73-90`). Additive, no migration. `loadCachedDoc` reads `BASE_KEY`, `LEGACY_DOC_KEY` and the `inc:*` range only (`cache.ts:235-248`), and `persistDocBinary` deletes only the `IDBKeyRange.bound('inc:','inc;')` cursor plus `LEGACY_DOC_KEY` (`:112-126`) — so a `remote-baseline` key sorts outside every range that is read or cleared (`'r' > 'i'`, and the other reads are exact-key `get`s). Verify this explicitly in a test.
   **Row shape — no type change.** The store's value type is `{ id, payload, updatedAt }` (`cache.ts:57-60`). Store the prefixed revision string as `payload` and reuse the existing `updatedAt: nowIso()` (`cache.ts:350`) as `checkedAt`. Zero schema widening, zero JSON parse, one fewer invented field. The row is **plaintext** where every other payload is ciphertext — an opaque counter plus a local clock reading carries no family data; comment beside the key so the exception is deliberate, not drift.
   **The DB is per-family** (`DB_PREFIX + familyId`, `cache.ts:72`), so the row itself cannot leak across families; C11 and C18 together close the only paths that could write into the wrong open handle.
3. `mergeRemoteEnvelope` returns `dirty` on **both** branches — **verified**: `{dirty:false}` adopt branch (`applyAndProject.ts:487`), `merged.dirty` merge branch (`:504`); both call `schedulePersist()` (`:483`, `:499`).
4. The 30-day numbers still hold post-`4403b89c` (automerge 3.4.0). _Re-baseline before claiming an improvement._
5. No consumer depends on `reloadAllStores()` running its current number of times per open as an implicit refresh. Note it calls `syncService.cancelPendingSave()` (`:2004`) — verified that making it conditional cannot drop a save, because the post-merge `triggerDebouncedSave` (`:930`) runs _after_ it.
6. Worker RPC dispatch is **by string** (`docWorker.ts:47` → `applyAndProject.dispatch`, switch at `:661`); `protocol.ts` carries no method-name union — **verified**, so adding `noteRemoteBaseline` requires no `protocol.ts` change. The only method _registries_ are the four `Set`s in `docClient.ts` (`ENVELOPE_METHODS:382`, `RETRYABLE_METHODS:394`, `HEAVY_METHODS`, `USER_ACTION_METHODS:419`), and C17 records the non-membership decision for each.

## Approach

### Decision D1 — do NOT defer the local rebuild

Eliminate the redundant _Drive-side_ reconstruction instead.

- The local `cacheLoad` rebuild installs the authoritative doc; the snapshot deliberately installs none (`applyAndProject.ts:188-190`). Until it lands, `requireDoc('mutate')` fails — so deferring moves ~7s onto the user's first tap, converting a predictable background cost into an unpredictable foreground one.
- The _Drive_ side on an unchanged file — download + `remoteLoad` + merge + extra store reloads + an ungated upload — is ~2.6s p50 plus a full 2-3MB upload for zero new information.

Target: **one full local reconstruction per open (necessary), zero remote reconstructions when the file has not changed.**

### Delivery shape — two PRs with a soak gate

- **PR 1 = Phase A + Phase B.** Instrumentation, dead-code removal, and gates that only ever do _less redundant_ work. No skipped reads. Individually revertable commits.
- **Soak gate:** PR 1 in production for **≥3 days** or until `open-cycle` telemetry has covered every open path at least once, whichever is later. Its counters are the before-baseline PR 2's claims are measured against, so the gate is not ceremony — PR 2 is unmeasurable without it.
- **PR 2 = Phase C + Phase D.** The marker plumbing, the comparator consolidation, the guard. One behaviour change, one review, one revert button.

### Phase A — Measure and audit first (no behaviour change)

- **A1 — one counter module, tightly scoped.** `src/services/telemetry/openCycle.ts`. Explicit lifecycle, because module-level counters with no window leak across opens (family switch, re-login, PWA resume) and quietly lie:
  - `beginOpen(path)` — resets all counters and opens the window. If a window is **already** open, emit it first as `open-abandoned` (C20) rather than silently discarding it.
  - `bump(kind)` — **no-op when no window is open** (so a poll-tick merge at 03:00, or a header Refresh, cannot inflate an open's numbers).
  - `endOpen(outcome, extra?)` — emits once and closes the window; a second call, or a call with no window open, is a no-op.
  - Counters: full reconstructions, Drive reads, Drive writes, store reloads, snapshot hit/miss.
  - Constraints, enforced at review: ≤100 lines, imports **only** `logEvent`, imports **no store** (`syncStore` imports it, so the reverse would cycle), no async, never throws, no import-time side effects.
  - **Window ownership (C20).** `beginOpen` is called **only** from `App.vue`'s `loadFamilyData` (`:408`), once, as soon as the path is known (`path1a`/`path1b`/`path2`/`path3` — its own breadcrumb labels at `:441`/`:479`/`:566`/`:602`). `endOpen` is called at every `loadFamilyData` terminal **except** the path-1a hand-off (`:468-469`), where `backgroundSyncFromFile` owns the terminal (success, skip, and every failure branch). The Refresh button (`AppHeader.vue:193`) and the deferred config-heal (`syncStore.ts:2710`) also reach `backgroundSyncFromFile` but with no window open, so they emit nothing — no caller-side conditionals required.
  - **Reconstruction counting goes in `perfTiming.record()`, as its first statement (`perfTiming.ts:45-47`), not `docClient.ts:183`.** There are **two** relay sites for worker perf samples — `docClient.ts:183` (worker realm) and `inlineBridge.ts:34-36` (inline-fallback realm, `mainSink.perf → recordPerf`) — and both funnel into `perfTiming.record`. Bumping at `docClient` alone silently reports zero reconstructions on every inline-fallback device. One `if (label === 'automerge.cacheLoad' || label === 'automerge.remoteLoad') bump(...)` **above the `CONSOLE_FLOOR_MS` early return** covers worker, inline, and any future in-process `measureSync` caller, with no drift.
  - Drive reads/writes bump in `syncService.load()` and `doSave()`; store reloads in `syncStore.reloadAllStores()` (`:2002`).
  - **Removal criterion**, in the file header: the _durable_ regression guard is the pass-count unit test (Testing 3); these counters are the _field_ guard. If after two quarters no counter has ever caught something the unit test did not, delete the module.
- **A2 — emit once per open** across all four paths, on success _and_ on every failure/skip terminal. One `logEvent({level, surface:'open-cycle', message, context})`; `message` carries the numbers; `action` = `open-complete`|`open-skip`|`open-fail-open`|`open-abandoned`; `error_code` = fail-open reason; `detail` = flat scalar; `provider_type` for slicing. **No new allowlist keys.**
- **A3 — write the audit doc** with the per-path map, the C1 withdrawal, the envelope-write-advances-the-counter invariant (C21), the `beanpodSizeKb` skip-path note, the observed `version`/`headRevisionId` evidence, and the housekeeping-side-effect verification.
- **A4 — capture the before-baseline** on a real 2-3MB `.beanpod`.

### Phase B — Mechanical fixes (each independently revertable)

- **B1 — `dirty` gate.** `syncStore.ts:893` capture `{dirty, changed}`; `:930` `if (dirty) triggerDebouncedSave()`. Comment the invariant argument.
- **B2 — conditional post-merge reload.** Return `changed` from `mergeRemoteEnvelope` (`applyAndProject.ts:487`/`:504`; `changed = !headsEqual(localHeads, merged.heads)`, `true` on the adopt branch) reusing existing `headsEqual` (`:427`).
  **`syncStore.ts:918-928` is shared by the merge and replace branches** — the replace branch goes through `replaceDocWithCacheRecovery`, which returns nothing, so `changed` is not in scope there. Declare `let changed = true;` before the branch and let **only** the merging branch narrow it to `false`. Fail-safe default: an unknown outcome reloads. Do not plumb `changed` out of `replaceDocWithCacheRecovery` in this PR (cross-family-safety path — C1).
  `lastSync.value` (`:918`) still updates unconditionally — we did verify currency, and it feeds `SaveStatusIndicator`.
- **B3 — delete dead code (C3).** Remove `decryptBeanpodPayload` (`fileSync.ts:116-156`) and its now-unused imports (check each; `CorruptPayloadError` stays, still thrown from `docOps`), the six `vi.mock` entries; update the two stale source comments (`syncStore.ts:1317`, `:1424`), `types/sync.ts:121`, `docOps.ts:217`, and the two narrative comments in `syncStore.resume.test.ts`. **Historical docs untouched.**
- **B4 — no-op snapshot suppression.** In `persistSnapshotOnce` (`applyAndProject.ts:167-182`) track `lastSnapshotHeads` and early-return on unchanged heads — same shape as `persistOnce`'s `changes.length === 0` return (`:260-262`). **Advance the cursor only on success, from the pre-`await` entry snapshot, under `currentDoc === doc` (C19)** — the function swallows failures into a `console.warn`, so an eagerly-advanced cursor would silently disable snapshots for the session. Register it in `resetDocCursors()`.
  **Rationale:** verified callers of `scheduleSnapshotPersist` are `initAndLoadCache` (`:421`), `initDoc` (`:352`), `mutate` (only when `changed`, `:447`), both `mergeRemoteEnvelope` branches (`:486`, `:498`), and the backgrounding flush (`:553`). There is no idle timer, and the double open-time persist largely disappears once Phase C lands. **The standing win is the backgrounding flush**, which today re-serialises + re-encrypts the whole projection on every `pagehide` even when nothing changed. Write _that_ in the comment.
- **B5 — remove the duplicate metadata call (C7).** Delete `syncStore.ts:915-916`. Replace the bare `catch {}` at `syncService.ts:1057` **and** `:989` with a classified `console.warn` + `logEvent`.
  Safe standalone today: `syncService.load()` already sets the same variable at `:1057` from the same source. Note for the reviewer: Phase C puts a **zero-network** `syncService.commitRemoteBaseline()` back at this exact spot (C10) — B5 removes a _network_ round-trip, C-2 adds a local commit; they are not undoing each other.

### Phase C — The marker, the comparator, the guard (the main win)

Order matters; each step is a commit.

- **C-0 — the pure module (C15).** Add `src/services/sync/remoteBaseline.ts`: types, `BASELINE_MAX_TRUST_MS`, `toStoredRevision`, `compareMarkers`, `withinTrustWindow`. No imports from `syncService`, no I/O, no module state. Lands with its own zero-mock test table and **no callers yet** — a pure, trivially-reviewable first commit.
- **C-1 — the probe (C12/C14a).** `driveService.updateFile` gains `&fields=version,headRevisionId` and a **non-throwing** body parse returning `{revision}`; `StorageProvider` gains optional `getRemoteMarker?()` and the widened `write(): Promise<WriteAck | void>`; `GoogleDriveProvider` implements both on **both** `updateFile` call sites (`:157`, `:166`), with the metadata failure classifier extracted into one private `metadataProbe` helper shared with `getLastModified`. No other provider file changes. Revision values carry the `ver:` prefix from `toStoredRevision`.
- **C-2 — the comparator (C14).** Add `remoteChanged()` and `shouldSkipOpenRead()` to `syncService` as thin shells over C-0: own the probe call, the fallback to `getLastModified()` when `getRemoteMarker` is absent, and **every** failure classification. Migrate `fetchAndMergeRemote` onto it (behaviour-identical), then `reloadIfFileChanged` + `syncNow`, then delete `checkForConflicts`, `getFileTimestamp`, `setLastKnownFileTimestamp` (and their two test-side references).
- **C-3 — the marker is learned before the bytes (C13).** Reorder `syncService.load()` so a **non-throwing** probe sits immediately before `currentProvider.read()`, inside the same try, after the permission check; drop the Drive post-write metadata read in favour of the write ack (C14b); collapse `lastKnownFileTimestamp` into the single `remoteBaseline` object (C9). `reset()` (`:594`) already nulls it; keep that.
- **C-4 — persist the baseline in the worker (C4/C4a/C4b/C4c/C10/C10a/C10b/C11/C17/C18).**
  - `commitRemoteBaseline()` fires `docClient.noteRemoteBaseline(revision)` through the extracted `fireAndForget` helper (C5a), called from **exactly the three termini in C10** and nowhere else. Assert that list in its doc-comment — it is the ordering invariant. It is a no-op when `remoteBaseline.revision` is null (never persist an mtime), and it is an unconditional last-write-wins set (C10b) — never compare two revisions for ordering.
  - `noteRemoteBaseline` is **not** added to `RETRYABLE_METHODS` / `ENVELOPE_METHODS` / `HEAVY_METHODS` / `USER_ACTION_METHODS`; record all four decisions in one comment (C17).
  - The worker's `noteRemoteBaseline` sets `pendingRemoteBaseline` **and** calls `schedulePersist()` (C10a).
  - `persistOnce` captures `const pending = pendingRemoteBaseline` **before its first `await`** (C4a) and, immediately before **each** of its two `markPersistOk()` calls (C4c), commits it **only if `currentDoc === doc`** (C11), in its **own try/catch** with a `console.error` (C4b), clearing the module var only if it still `=== pending`.
  - Clear `pendingRemoteBaseline` in `resetDocCursors()` (lifecycle) **and** as the first statement of `initAndLoadCache` and `openCache` (scope — C18).
- **C-5 — read the baseline back with the cache (C5), under the C16 lifecycle rule.** Widen `initAndLoadCache`'s return to `{loaded, remoteBaseline}` (`docClient.ts:821`, `applyAndProject.ts:378-422`):
  - cache **miss** (`:392` early return) → `{loaded:false, remoteBaseline:null}` — explicitly, not by omission
  - `loaded.recovered` (`:397-403`) → **`await cache.clearRemoteBaseline()`** _and_ return null. Returning null alone is not enough: the row would survive on disk, and if the tab dies before a fresh baseline is committed, the _next_ open reads a row describing state the recovered cache no longer holds — stale-forever, exactly the bug this design prevents. **Deleting the row is the fix; the return value is only the fast path.**
  - the `incrementCount > threshold` compaction branch (`:404-419`) → **keeps its baseline**; it is a clean, complete load and only the _cursor_ is reset
  - clean load → the row as read
  - corrupt-cache throw path (`:384-388`) → already `clearCache`s the whole DB, taking the row with it — self-healing, no extra code
  - `openCache` (`:373`, the deliberate don't-load path) → **`await cache.clearRemoteBaseline()`** (C16)
    `loadFromPersistenceCache` already awaits `initAndLoadCache` (`syncStore.ts:1265`); seed `syncService.remoteBaseline` there via a dedicated **non-committing** seed setter. Routing the seed through `commitRemoteBaseline` would re-write the row we just read and refresh `checkedAt`, defeating the 1-hour bound — **this is the easiest mistake to make in this plan.** The other `initAndLoadCache` callers — `replaceDocWithCacheRecovery` (`syncStore.ts:775`) and the respawn rehydrator (`bootstrap.ts:21`, which already discards the result) — must ignore the field.
- **C-6 — apply the guard at the top of `backgroundSyncFromFile`'s `try`** (`syncStore.ts:2206`): one call to `shouldSkipOpenRead()`; on skip → `runPostLoadDriveHousekeeping()`, `endOpen('open-skip')`, `return` (existing `finally` starts polling; `setupAutoSync` is inside the extracted function). Otherwise fall through to today's `loadFromFile({merge:true})` unchanged. **The guard body is ≤6 lines, one `if`, no nesting, no try/catch, and no knowledge of revisions, clocks or bases** — because C-2 owns the composition and C-0 owns the logic. Carry C21's one-line comment: the envelope on this path came from `loadFromPersistenceCache` (`:1273-1275`) and stays correct because an envelope rewrite advances `version`.
- **C-7 — fail open on every uncertainty**, each with a classified reason emitted from `remoteChanged`/`shouldSkipOpenRead` and a `console.warn` naming the fix: no baseline, `null`/absent revision, provider without a marker, thrown provider error, trust-bound expiry, unparseable `checkedAt`. **No bare catches anywhere in the guard.**

### Phase D — Verify and record

Re-measure on the same real `.beanpod`; record before/after in `docs/PERFORMANCE.md`; state honestly whether redundancy removal alone reached the halving stretch goal and whether history compaction therefore becomes mandatory.

### Rollback safety (required — ships ungated)

- Two PRs; within each, commits are individually revertable (C-0…C-7, B1…B5).
- Reverting PR 2 restores exactly today's always-read behaviour; the persisted row is additive and simply becomes unread.
- A missing/unknown row means "no baseline → always read", so older and mid-rollout builds degrade to today's behaviour.
- The widened `write()` return type is additive (`WriteAck | void`), so a partial revert cannot break a provider.
- The 1-hour trust bound means even a _silent_ failure of the whole design self-limits to one stale hour, and C12+C13 make such a failure structurally unreachable in the first place.

## Files Affected

**Created**

- `docs/investigations/2026-08-13-open-cycle-load-audit.md`
- `src/services/sync/remoteBaseline.ts` — **pure**, no I/O, no module state: types (`RemoteMarker`, `RemoteBaseline`, `WriteAck`, `ChangeResult`), `BASELINE_MAX_TRUST_MS`, `toStoredRevision`, `compareMarkers`, `withinTrustWindow` (C15)
- `src/services/telemetry/openCycle.ts` (≤100 lines, `logEvent`-only imports)

**Modified**

- `src/stores/syncStore.ts` — `dirty`/`changed` capture (`:893`, `changed` defaults `true`), conditional reload + gated save (`:918-930`), delete duplicate `getFileTimestamp` (`:915-916`) and add `commitRemoteBaseline()` there, extract `runPostLoadDriveHousekeeping()` from `:933-942` (provider-type gate moves inside), delete `checkForConflicts` (`:630-647`) + its export (`:3691`) and migrate `syncNow` (`:724`) / `reloadIfFileChanged` (`:2282`) onto `remoteChanged()`, baseline seed (`~:1265`), guard via `shouldSkipOpenRead()` (`~:2206`) + `endOpen` at `backgroundSyncFromFile`'s terminals, classify the bare catches (`:2117`, `:2222`, `:2298`), counter bumps (`:2002`), one comment at the create-path envelope write (`:1588`), stale comments (`:1317`, `:1424`)
- `src/App.vue` — `beginOpen(path)` at `loadFamilyData` (`:408-411`) and `endOpen(...)` at every terminal **except** the path-1a hand-off (`:468-469`) (C20)
- `src/services/sync/syncService.ts` — **thin I/O shell only**: `remoteChanged()` + `shouldSkipOpenRead()` over `remoteBaseline.ts` (replacing `:875-883`), collapse `lastKnownFileTimestamp` (`:76`) into one `remoteBaseline` object, delete `getFileTimestamp` (`:1014-1019`) and `setLastKnownFileTimestamp` (`:569-571`), add `commitRemoteBaseline()` + a non-committing seed setter, call it at `~:900` / `~:980` / (from syncStore) `~:917`, **move a non-throwing `load()` probe above `currentProvider.read()` (C13)**, consume the write ack via an explicit truthiness narrow and drop the Drive post-write metadata read (`:985-991`), log the swallowed catches (`:989`, `:1057`), read/write counter bumps
- `src/services/sync/storageProvider.ts` — optional `getRemoteMarker?()` (same optional-method shape as `supportsLocalPolling?()`); `write()` widened to `Promise<WriteAck | void>`, `WriteAck` re-exported from `remoteBaseline.ts`
- `src/services/sync/providers/googleDriveProvider.ts` — `getRemoteMarker()`, ack-returning `write()` on **both** `updateFile` paths (`:157`, `:166`; `withRetry<T>` at `:57` is already generic and needs no change), shared private `metadataProbe` classifier extracted from `getLastModified` (`:261-274`)
- `src/services/google/driveService.ts` — `updateFile` gains `&fields=version,headRevisionId` + a non-throwing body parse returning `{revision}` (`:186-197`); no new metadata function (reuse `getFileMetadata`, `:250-265`)
- `src/services/sync/offlineQueue.ts` (`:101`) — one comment: ack deliberately ignored, never sets a baseline
- `src/services/sync/fileSync.ts` — delete `decryptBeanpodPayload` (`:116-156`) + now-unused imports
- `src/services/automerge/worker/cache.ts` — one additive plaintext row (`REMOTE_BASELINE_KEY` beside `SNAPSHOT_KEY:44`) reusing the existing `{id, payload, updatedAt}` shape + `readRemoteBaseline` / `writeRemoteBaseline` / `clearRemoteBaseline` (all via the existing `withIdbRetry` idiom); comment that `writeRemoteBaseline` is the row's ONLY writer, because `updatedAt` doubles as the trust clock
- `src/services/automerge/worker/applyAndProject.ts` — `resetDocCursors()` used by all five reset sites; `noteRemoteBaseline` (sets pending + `schedulePersist`) + its dispatch case (`~:661`); `pendingRemoteBaseline` captured pre-`await` and committed at both `markPersistOk()` sites under `currentDoc === doc`, in its own try/catch; cleared as the first statement of `initAndLoadCache` **and** `openCache` (C18); `remoteBaseline` on `initAndLoadCache` (`:378-422`) with miss → null, `recovered` → clear row + null; `openCache` (`:373`) clears the row (C16); `changed` on `mergeRemoteEnvelope` (`:487`/`:504`); no-op snapshot suppression with success-only cursor advance (`:167-182`, C19)
- `src/services/automerge/worker/docClient.ts` — widen `initAndLoadCache` type (`:821`), extract the generic `fireAndForget` helper from `fireAndForgetMutate` (`:862-873`) and delegate both it and the new `noteRemoteBaseline` through it (C5a); comment `noteRemoteBaseline`'s non-membership in all four method `Set`s (C17)
- `src/utils/perfTiming.ts` — reconstruction counter bump as the **first statement** of `record()` (`:45`), above the `CONSOLE_FLOOR_MS` return
- `docs/PERFORMANCE.md` — before/after
- Tests: new `src/services/sync/__tests__/remoteBaseline.test.ts` (pure, zero mocks), `src/services/sync/__tests__/fetchAndMergeRemote.test.ts`, `src/services/automerge/worker/__tests__/applyAndProject.test.ts` (`:300` asserts `automerge.remoteLoad` — must still pass, it is the live worker label), `src/services/sync/__mocks__/syncService.ts` (drop `getFileTimestamp:69`, add `remoteChanged` + `shouldSkipOpenRead`), `src/stores/__tests__/syncStore.migrate.test.ts:109` (drop the `getFileTimestamp` stub), new guard + pass-count coverage

**Explicitly NOT modified**: `localProvider.ts` / `capacitorFileProvider.ts` / `memoryProvider.ts` (optional method + `void`-compatible write ⇒ zero churn — C14a/C14b), `src/services/automerge/worker/protocol.ts` (**verified**: RPC dispatch is by string, no method-name union lives there — Assumption 6), `logEvent.ts` (allowlist is in `diagnosticContext.ts`; `surface` is a free string), `diagnosticContext.ts` / `infrastructure/lambda/telemetry/index.mjs` / `docs/runbooks/native-store-submission.md` / `PrivacyInfo.xcprivacy` / `privacy.astro` (no new context keys — C8), `docs/STATUS.md` and `docs/plans/2026-03-04-*` / `2026-07-05-*` (historical records — C3), `e2e/` (ADR-007's three gates, `docs/adr/007-testing-strategy.md:46-51`, are not met; this is unit-testable).

## Observability Coverage

**Events** (all on the existing allowlist, verified in both mirrors)

| surface      | level    | keys                                                                                                                                                        |
| ------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-cycle` | `info`   | `action:'open-complete'`, `provider_type`, `detail`=`path=1a rec=1 reads=0 writes=0 reloads=2 snap=hit`; counts also in `message`                           |
| `open-cycle` | `info`   | `action:'open-skip'`, `detail`=`path=1a baseline_age_ms=…`                                                                                                  |
| `open-cycle` | `warn`   | `action:'open-fail-open'`, `error_code` ∈ `no-baseline`\|`no-revision`\|`provider-unsupported`\|`provider-error`\|`auth`\|`trust-expired`\|`bad-checked-at` |
| `open-cycle` | `warn`   | `action:'open-abandoned'` — a window was opened and never closed (a missing `endOpen` terminal); makes C20's ownership rule self-policing                   |
| `load-perf`  | existing | unchanged labels — the before/after basis                                                                                                                   |

**Failure modes covered**

- _Guard skips a read it should have done_ → structurally excluded by C12's commit invariant (a baseline is only ever a counter we sampled **before** the bytes we merged — C13 — or the ack of our own write), bounded on the durability axis by C4/C4a/C4c/C10/C11/C18 and the C16 lifecycle rule, and bounded in time by the 1-hour window; every skip emits `baseline_age_ms`, so a stale-data report is diagnosable from the skip record alone.
- _Guard never engages_ → every fail-open emits a classified reason, visible as a rate. A rising `trust-expired` rate signals the bound is binding; a flat `no-baseline` rate signals C10a's `schedulePersist` is not committing; `no-revision` signals the `version` assumption failed in the field.
- _Redundancy silently returns_ → per-open counts make it visible without a repro; pass-count tests fail first.
- _An open path stops being measured_ → `open-abandoned` (C20); and because `beginOpen` lives at the single `loadFamilyData` entry, a new path cannot be added without passing through it.
- _Improvement invisible_ → counts, not timings, and the counter bump sits above the console floor.
- _A save silently fails because of the new ack parsing_ → the parse is try/caught to `{revision:null}` + `console.warn`; the write result is never allowed to fail the save or trigger a `withRetry` re-upload.
- _Fast-paint snapshot silently stops being written_ → C19's success-only cursor advance; covered by test 10b.
- _Local durability lost_ → already surfaced by the `cachePersistFailed` banner (`applyAndProject.ts:277-288`); the baseline simply is not advanced, and per C4b a baseline-write failure can never raise that banner spuriously.
- _Poll read-storm on a persistent provider error_ → structurally excluded: `unknown` means "don't read" for the two polling callers (C14 caller table); only the once-per-open guard reads on `unknown`.
- _Refresh button appears to stop working_ → the probe always runs; only the download is conditional. Asserted (test 3b).
- **No bare `catch {}` in new code**, and this plan _removes_ two existing ones (`syncService.ts:989`, `:1057`) and classifies three more (`syncStore.ts:2117`, `:2222`, `:2298`).

**User-facing errors** — no new user-visible failure mode: every guard failure degrades to today's read. Existing surfaces stay responsible — `backgroundSyncError` + reconnect banner, cache-persist durability banner, save-failure banner. Each new `console.warn`/`console.error` names the failing function, the consequence, and the fix. Nothing warrants `severity: 'critical'`.

## Acceptance Criteria

- [ ] `docs/investigations/2026-08-13-open-cycle-load-audit.md` committed, mapping every full load per open path with a verdict and reasoning, including the observed real-file `version` / `headRevisionId` evidence
- [ ] A cold open performs exactly **one** full CRDT reconstruction — demonstrated from the counters, not asserted, **on both the worker and inline-fallback realms**, with the bump proven to survive a sub-`CONSOLE_FLOOR_MS` sample
- [ ] Every open path (1a/1b/2/3) emits exactly one `open-cycle` record; a header Refresh or a deferred config-heal emits **none**; a window left unclosed emits `open-abandoned` (C20)
- [ ] No Drive download on an open where `version` has not changed and the baseline is within the trust window
- [ ] The header Refresh button still fetches when the file has changed (probe always runs), and its success toast is never shown for an unchecked file
- [ ] No Drive write on a read-only open (open, change nothing, close → zero writes)
- [ ] Exactly **one** metadata round-trip per save on Drive is removed (write ack replaces the post-write read), and a malformed ack body neither fails the save nor re-uploads
- [ ] `syncService.load()` samples the marker **before** `provider.read()`, proven by a test that mutates the remote between the two and asserts no baseline is committed (C13); a throwing probe does not fail the load
- [ ] The persisted baseline can never claim a state the cache does not hold — covered by (a) kill-the-persist → next open reads, (b) `noteRemoteBaseline` interleaved with an in-flight persist → the _older_ value is committed (C4a), (c) pending set before a merge is never committed against the pre-merge doc (C10), (d) doc replaced mid-persist → nothing committed (C11), (e) `recovered:true` **and** `openCache` → the row is **deleted from disk**, not merely reported null (C-5/C16), (f) a pending value cannot survive a DB re-point into another family's cache (C18)
- [ ] `noteRemoteBaseline` is absent from `RETRYABLE_METHODS` and the other three `docClient` method sets, with the decision documented (C17)
- [ ] A read-only open with **no** doc changes still commits its baseline (C10a — proves `schedulePersist` fires and the `changes.length === 0` path is a commit point)
- [ ] A baseline-write failure does not raise the local-durability banner (C4b)
- [ ] A failing snapshot persist does not permanently suppress later snapshot persists (C19)
- [ ] The guard skips only on `basis === 'revision'`; no provider ever skips on a timestamp, and providers without a marker always read
- [ ] `syncStore` contains **no** reference to `basis`, `status`, `BASELINE_MAX_TRUST_MS` or any clock arithmetic — the guard is one call to `shouldSkipOpenRead()` (C14/C15)
- [ ] All comparison + trust-window logic lives in the pure `remoteBaseline.ts` and is covered by tests that mock **nothing** (C15)
- [ ] Exactly one change-comparator exists: `checkForConflicts`, `getFileTimestamp` and `setLastKnownFileTimestamp` are deleted and `grep` finds no second mtime comparison (C14)
- [ ] Exactly one detached-call idiom exists in `docClient`: `fireAndForgetMutate` and `noteRemoteBaseline` both delegate to one helper; `grep` finds no second `void …catch(reportError)` block (C5a)
- [ ] Only `version` drives the decision; `headRevisionId` appears in telemetry/audit only; the stored value is compared with `!==` — `grep` finds no `<`/`>` on a revision string, and no "only if newer" commit guard (C12/C10b)
- [ ] The guard always reads once the baseline is older than `BASELINE_MAX_TRUST_MS` (1 hour) or `checkedAt` is unparseable/future, and that read refreshes `checkedAt` so the cost is at most one extra read per device per hour
- [ ] `unknown` reads on the open guard and does **not** read on `reloadIfFileChanged`/`syncNow` — asserted, so a provider outage cannot become a 10s read storm
- [ ] `reloadAllStores` / `pushProjection` / snapshot-persist each run the documented minimum per open, with a test that fails if a pass returns
- [ ] The skip path and the load path run the same Drive housekeeping — enforced by both calling one `runPostLoadDriveHousekeeping()` covering `:933-942`, not by a comment
- [ ] The `noteRemoteBaseline` RPC cannot produce an unhandled rejection (asserted by a rejecting-worker test)
- [ ] The `remote-baseline` row is untouched by `persistDocBinary`'s increment sweep and unread by `loadCachedDoc` (explicit test)
- [ ] The guard fails open on every uncertainty, with the reason emitted; no bare catches added, two removed, three classified
- [ ] `decryptBeanpodPayload` deleted; `automerge.remoteLoad` has exactly one emitter; historical docs unmodified
- [ ] `replaceDocWithCacheRecovery`'s cache-then-merge structure unchanged; the C1 withdrawal recorded in the audit
- [ ] Every worker cursor is nulled from one `resetDocCursors()` reachable from all five reset sites
- [ ] Exactly one `remoteBaseline` variable in `syncService`; no parallel `lastKnownFileTimestamp` field survives
- [ ] `openCycle.ts` ≤100 lines, no store imports, no import-time side effects, no-ops outside an open window, documents its removal criterion
- [ ] Before/after on a real 2-3MB `.beanpod` in `docs/PERFORMANCE.md`, with an honest halving-goal statement
- [ ] `open-cycle` queryable in CloudWatch on success **and** failure paths, with **no** new allowlist keys (verified against `diagnosticContext.ts` and the Lambda mirror test)
- [ ] Multi-device convergence unregressed: a change on A reaches B; the guard never strands a diverged device beyond the trust window
- [ ] Skipping the sync still calls `setupTokenExpiryHandler()`, `updateProviderEmailAfterLoad()`, `setupAutoSync()`, `markPodCreated()` and starts polling; and a save issued after a skipped open still succeeds using the cache-sourced envelope (C21)

## Testing Plan

Unit-first per ADR-007 (`docs/adr/007-testing-strategy.md:46-51` — E2E requires all three gates; none are met here). **No new E2E specs.**

1. **Unit — `remoteBaseline.ts`, pure, zero mocks** (the primary safety net, and the cheapest to keep green). Table-driven over `compareMarkers`: revision differs → `changed`/`revision`; matches → `unchanged`/`revision`; no baseline → `changed`; no revision + mtime → `mtime` basis with today's exact semantics (incl. null mtime → `unknown`); no evidence → `none`/`unknown`. `withinTrustWindow`: inside, outside, exactly at the bound, `null`, unparseable, future ⇒ false. `toStoredRevision`: prefixing, null passthrough.
2. **Unit — `remoteChanged()` / `shouldSkipOpenRead()` (the I/O shell).** Provider without `getRemoteMarker` → falls back to `getLastModified` (assert **one** call, not two). Provider throws (`TokenExpiredError`, 401, 404, generic) → `unknown` + classified reason emitted + no rethrow, and the subsequent `provider.read()` still raises the auth error into the existing classification. `shouldSkipOpenRead` skips only on revision+unchanged+in-window and returns a reason otherwise. Extend `src/services/sync/__tests__/fetchAndMergeRemote.test.ts`.
3. **Unit — caller semantics.** (a) Open guard reads on `unknown`; `reloadIfFileChanged` and `syncNow` do **not** (no read storm); `fetchAndMergeRemote` behaviour is byte-for-byte today's for every input. (b) **Refresh button:** `backgroundSyncFromFile` invoked with a _changed_ remote still downloads; with an unchanged remote it skips and sets no `backgroundSyncError` (so the success toast is honest) and opens **no** `open-cycle` window.
4. **Unit — the write ack (C14b).** Drive write returns `ver:<n>` → committed as baseline. Malformed/empty body → `{revision:null}`, save still succeeds, no re-upload, warn logged. **Silent-refresh retry path (`:166`) returns the ack.** `offlineQueue` / create-path envelope write set no baseline.
5. **Unit — probe ordering (C13).** `load()` calls the marker probe strictly before `read()` (assert call order on the spies); a remote change between them leaves the baseline describing the _older_ revision → next open reads; a throwing probe leaves the baseline null and the load still returns the file.
6. **Unit — baseline durability (C4/C4a/C4c/C10/C10a/C10b/C11/C16/C18).** (a) Merge remote@R, fail/suppress the cache persist, restart → `initAndLoadCache` returns `remoteBaseline: null` → next open reads. (b) `recovered:true` → row **deleted** from the DB and null returned; cache **miss** → null; `openCache` → row **deleted**; over-threshold compaction branch → baseline **preserved**. (c) _Interleaving:_ persist enters at S1, `noteRemoteBaseline(R2)` lands mid-write → committed baseline is R1, R2 survives to the next persist. (d) _Ordering:_ pending set before the merge is never committed against the pre-merge doc. (e) _Cross-family (in-flight):_ `dropDoc()` mid-persist → nothing committed. (f) _Cross-family (scope):_ `noteRemoteBaseline(R_A)`, then `initAndLoadCache(B)` **without** a `reset()` → B's next persist commits nothing (C18). (g) _No-change commit:_ `noteRemoteBaseline` alone schedules a persist that commits via the `changes.length === 0` path. (h) Baseline write throws → no `cachePersistFailed` signal. (i) A `doSave` that merges then writes commits the write's ack last (C10b).
7. **Unit — cache row isolation.** `persistDocBinary` (base + increment sweep) leaves `remote-baseline` intact; `loadCachedDoc` ignores it; `clearCache` removes it.
8. **Unit — pass counts.** Exact `reloadAllStores` / `pushProjection` / snapshot-persist counts per open path. This is the durable regression guard.
9. **Unit — `dirty`/`changed` gates.** `dirty:false` → no save; `dirty:true` → save; `changed:false` → no reload/dedup; **replace branch (no `changed` in scope) → reload still runs**; dedup mutation → save still fires via `localChangeHandler`.
10. **Unit — cursors.** (a) After `dropDoc`/`reset`, `lastSnapshotHeads` and `pendingRemoteBaseline` are null. (b) A rejecting `persistProjectionSnapshot` leaves `lastSnapshotHeads` unchanged, so the next scheduled snapshot persist still runs (C19).
11. **Unit — housekeeping parity.** The skip path calls `runPostLoadDriveHousekeeping()` and therefore `setupTokenExpiryHandler` + `updateProviderEmailAfterLoad` + `setupAutoSync`; assert on the spies, not on a comment. Plus: a `doSave` after a skipped open succeeds with the cache-sourced envelope (C21).
12. **Unit — counter placement + window ownership.** `record('automerge.cacheLoad', 0.4)` still bumps (proves the bump sits above `CONSOLE_FLOOR_MS`), via both the `docClient` and `inlineBridge` relays. `bump`/`endOpen` with no open window are no-ops; a second `beginOpen` emits `open-abandoned`.
13. **Unit — detached-call idiom.** A rejecting `noteRemoteBaseline` produces a `reportError`, not an unhandled rejection; `fireAndForgetMutate`'s existing behaviour is unchanged by the extraction.
14. **Convergence.** A mutates and saves; B opens → downloads and converges. B opens again unchanged → skips. Both asserted.
15. **Cross-family safety unchanged.** Existing `replaceDocWithCacheRecovery` coverage passes untouched.
16. **Dead-code removal.** Suite green after deleting `decryptBeanpodPayload`; `applyAndProject.test.ts:300` still asserts the live worker label.
17. **Manual, real 2-3MB `.beanpod`, ONE client only** (2026-08-12 save-storm lesson): confirm `version` is populated and advances on a write; cold open → count events; second open unchanged → zero Drive read/write; mutate → exactly one write and one metadata call fewer than before; Drive file size does not grow on read-only opens; a peer key-rotation forces a read on the next open. Repeat once with the worker kill-switch off (inline realm).
18. **Offline / token-expired open** still paints from snapshot and degrades honestly.
19. Full suite + `type-check` + `lint` + `build` green before each deploy.
20. **Staged verification** (required, ungated): PR 1 → web/PWA → 3-day soak on `open-cycle` counters → PR 2 → web/PWA → watch skip-rate and fail-open-rate for a day before cutting native builds.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the pre-plan intake plus first-hand code reading; corrected two intake items (C1 `replaceDocWithCacheRecovery` is load-bearing — item withdrawn; C2 heads unavailable pre-download, so the guard must be timestamp-based with a persisted cold-open baseline); resolved Open Q1 by recommending the local rebuild stays and the redundant Drive-side reconstruction goes; structured as measure-first Phases A–D.
- **Pass 2 (DRY + error handling)**: Found the "dead label" was actually a dead _function_ (`decryptBeanpodPayload`) while `automerge.remoteLoad` is live; found the telemetry allowlist lives in `diagnosticContext.ts` with a Lambda mirror, so the drafted context keys would have been silently stripped server-side — reworked onto existing keys for zero churn; cut the invented RPC/protocol work by widening `initAndLoadCache`'s existing return; replaced "delete the redundant reloadAllStores" with a `changed` flag (deleting it would have broken the changed-remote path); found a duplicate `getFileTimestamp()` round-trip and three bare catches.
- **Pass 3 (Sustainability)**: Found C4a — committing the baseline inside `persistOnce` is insufficient without capturing the pending value in the same pre-`await` entry snapshot, else an in-flight persist commits a newer baseline against older doc state (the stale-forever bug the design exists to prevent); added C4b so an advisory baseline-write failure cannot raise the local-durability banner; added the 24h `BASELINE_MAX_TRUST_MS` bound after identifying that the guard removes the app's only self-heal for mtime anomalies on an explicitly unverified assumption; found `updateProviderEmailAfterLoad` would be silently dropped by the skip path and replaced the caveat with an extracted `runPostLoadDriveHousekeeping()`; added `resetDocCursors()`; split delivery into two PRs with a soak gate.
- **Pass 4 (Fresh-eyes sweep)**: Found C10 — routing `syncService.load()`'s timestamp capture through the persistence funnel would commit a baseline against the _pre-merge_ doc, which C4a does not protect against; split "learn in memory" from "commit at post-merge termini". Found C10a (`noteRemoteBaseline` must call `schedulePersist()`, else on a read-only session the pending value never commits and the guard silently never engages) and C11 (the baseline commit needs the existing `currentDoc === doc` guard, else a family switch writes A's baseline into B's DB). Found a missed assignment site (`syncService.ts:905`), that `markPodCreated()` belongs in the extracted housekeeping per its explicit contract, and that the reconstruction counter must hook `perfTiming.record()` rather than `docClient.ts` — there are two relay sites, so the draft would have reported zero on every inline-fallback device. Simplified the cache row onto the existing `{id, payload, updatedAt}` shape.
- **Pass 5 (Post-C12 review — the revision mechanism, DRY, silent failures)**: Scrutinised the newly-introduced revision guard against the source. Found **C13**: `syncService.load()` reads the file at `:1046` and only samples metadata at `:1054-1059`, so under C12 a peer write landing between them would be committed as _our_ baseline against content we never downloaded — the exact stale-forever failure C12 was introduced to eliminate; the probe must be reordered above the read. Found **C14**: the plan would have created a _third_ change-comparator while `checkForConflicts` (whose two callers use only `hasConflict`, and whose export has zero consumers) duplicates it on a skew-prone wall-clock basis — consolidated to one `remoteChanged()` with an explicit `status`/`basis` tri-state so "never skip on a timestamp" is structural, and deleted `checkForConflicts` / `getFileTimestamp` / `setLastKnownFileTimestamp`. Found **C14a/C14b**: capturing the write's own revision requires widening `StorageProvider.write` (the plan listed no provider or `driveService` file at all) — made it `Promise<WriteAck | void>` so the three non-Drive providers and every test double stay untouched, required every `updateFile` call site (including the silent-refresh retry) to propagate the ack, and required the response parse to be non-throwing so a malformed body cannot fail a save or trigger a `withRetry` re-upload of a 2–3MB file; replaced the proposed `getFileRevision()` with a single `getRemoteMarker?()` probe reusing the existing generic `getFileMetadata`, sharing one extracted failure classifier with `getLastModified`. Found the `recovered:true` path must **delete** the baseline row, not merely return null (the row would otherwise outlive the state that justified it). Found `markPersistOk()` is called from exactly two places, both in `persistOnce` — making them the two commit points, no restructuring needed (C4c). Found the counter bump must sit **above** `perfTiming.record()`'s `CONSOLE_FLOOR_MS` early return or it silently under-counts. Required `noteRemoteBaseline` to reuse `fireAndForgetMutate`'s `.catch(reportError)` idiom rather than a floating promise. Corrected the C12 claim that Drive has no polling safety net (`syncStore.startFilePolling` is provider-agnostic, 10s) and the `markPodCreated` rationale (`loadFromPersistenceCache` already calls it). Added namespace-prefixed revision values, NaN/future `checkedAt` handling, and a cache-row-isolation test.
- **Pass 6 (Long-term sustainability, maintainability, reliability)**: Attacked the plan's own accumulated complexity rather than its correctness. **Collapsed the dual revision field**: `headRevisionId`-with-`version`-fallback meant two production code paths, two field semantics, a dual-namespace guard and a "MUST VERIFY against a real file" blocker on the critical path — replaced with `version` alone (always present, monotonic, strictly-safer failure direction), keeping the `ver:` prefix as a one-line forward-compat guard and demoting `headRevisionId` to audit/telemetry evidence; also required equality-only comparison, since Drive returns int64 as a string and `<`/`>` on it is a silent-wrong-answer trap. **Split `remoteChanged`'s two jobs (C14/C15)**: the drafted signature owned the trust window yet exposed no trust field, and the guard had to `&&` three predicates in `syncStore` — added one `shouldSkipOpenRead()` as the sole composition point so the store never sees `status`, `basis` or a clock, and the guard body drops to ~6 lines. **Moved the decision logic out of `syncService` into a new pure `remoteBaseline.ts`** — `syncService` is already 1384 lines and the most-mocked module in the tree (`__mocks__/syncService.ts`), so the trickiest reasoning in the plan (every degradation case, NaN/future clock, prefixing) would only have been reachable through provider mocks and fake timers; it is now a zero-mock table test, and `syncService` stays a thin I/O shell. **Found the drafted C5a would create a second detached-call copy**: `fireAndForgetMutate` (`docClient.ts:862-873`) is hard-wired to `mutate(op)`, so `noteRemoteBaseline` cannot call it — required extracting one generic `fireAndForget` helper both delegate to, rather than duplicating the only thing preventing an unhandled rejection. **Found C16, a third baseline-lifecycle hole**: `openCache` (`syncStore.ts:1617`, `createNewFile`'s deliberate don't-load path) can inherit a baseline row from a prior interrupted create; generalised the `recovered` fix into one stated rule — a baseline row may exist only alongside a cache that was actually loaded and verified — with three one-line enforcement points and no fourth mechanism. **Made the `unknown`-status asymmetry explicit** (guard reads on unknown; the 10s poll and `syncNow` do not), because the drafted "anything else reads" would, if applied uniformly, have turned a persistent Drive metadata failure into a read storm every 10s. Added the `WriteAck | void` narrowing trap (`ack ? ack.revision : null`, one read site). Added a **one-page design summary** at the top so the plan reads as a design rather than a correction log, an explicit **complexity budget**, and a **"simplifications considered and deliberately rejected"** section (cursors-as-object, separate baseline RPC, worker baseline module, `headRevisionId` fallback, deferring the `checkForConflicts` fix, dropping the counters) so the next reviewer neither re-litigates them nor re-adds them by accretion. Verified against source: `markPersistOk` call sites, the five cursor-reset sites, `checkForConflicts`/`getFileTimestamp`/`setLastKnownFileTimestamp` caller sets, `openCache`'s single caller, and `perfTiming`'s existing `@/services/telemetry` import (making the new util→service edge acceptable, with a no-cycle constraint written down).
- **Pass 7 (Final fresh-eyes sweep — instrumentation scope, worker-state scope, and two source corrections)**: Re-read every claim against the tree. Found **C20**, the largest remaining gap: `beginOpen`/`endOpen` were both scoped to `backgroundSyncFromFile`, which is **only path 1a's tail** — `App.vue:loadFamilyData` (`:408`) is the sole open orchestrator and labels four paths (`:441`/`:479`/`:566`/`:602`), so paths 1b/2/3 would never have emitted an open record and the "exactly one reconstruction per open" criterion would have been provable for one path only; worse, `backgroundSyncFromFile` has **two non-open callers** (the header Refresh button `AppHeader.vue:193` and the deferred config-heal `syncStore.ts:2710`) that would have been counted as app opens, corrupting the very baseline PR 2 is measured against. Gave the window one owner, an explicit terminal list, and an `open-abandoned` emission so a forgotten terminal is visible rather than silent. Found **C18**: C11's `currentDoc === doc` guard does **not** close the case where a leftover `pendingRemoteBaseline` survives a DB re-point and is committed by a _later_ persist for the new family's doc (the guard passes — it is that family's own doc); today only `authStore`'s discipline (`:672`, `:1328`) prevents it, so moved the clear to the two `initPersistenceDB` entry points (`initAndLoadCache`, `openCache`) where the row's scope is actually defined. Found **C19**: B4's new `lastSnapshotHeads` cursor sits in a function that **swallows all failures into a `console.warn`** (`applyAndProject.ts:178-181`), so an eagerly-advanced cursor would let one transient IDB error silently disable the fast-paint snapshot for the session and quietly reverse the 2026-08-12 win — required success-only, entry-snapshot, `currentDoc === doc`-guarded assignment. Found **C17**: `docClient.ts:394-411` is an affirmative retry allowlist whose doc-comment demands every new method be vetted; a retryable `noteRemoteBaseline` would re-seed a baseline against a respawned worker's not-yet-rebuilt doc (C10 again, via the auto-heal) — recorded the non-membership decision for all four method `Set`s. Found **C10b**: `doSave` calls `fetchAndMergeRemote` itself (`syncService.ts:953-957`), so termini 2 and 3 both fire in one save — made last-write-wins explicit and forbade an "only if newer" guard, which would have required ordering revision strings that C12 forbids. Added **C21** after verifying the skip path's envelope comes from `loadFromPersistenceCache`'s `setFamilyKey(fk, cachedMerged)` (`syncStore.ts:1273-1275`) — so `doSave` is never blocked, and correctness rests on envelope writes advancing `version`; that link now sits at the guard rather than three files away. **Two source corrections:** `googleDriveProvider.write` has exactly **two** `updateFile` call sites (`:157`, `:166`), not three as Pass 5 wrote (and `withRetry<T>` at `:57` is already generic, so the ack propagates unchanged); and **`protocol.ts` needs no edit at all** — RPC dispatch is by string (`docWorker.ts:47` → `applyAndProject.dispatch` switch `:661`) with no method-name union, so it moved to "Explicitly NOT modified" as Assumption 6. Also verified and recorded that a skipped open leaves `beanpodSizeKb` unrefreshed and that this is benign by the registry's own documented omit-and-preserve contract (`syncStore.ts:3518-3527`), and that the C4c `changes.length === 0` terminus is reached with no preceding `await`. Raised the `openCycle.ts` cap 80 → 100 lines to fit the window-ownership rules honestly rather than shaving the safety checks.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (via /beanies-new-issue, 2026-08-13)

> Let's file the issue related to redundance cache+drive double loads and really perform a proper analysis on the caching and loading process to make it as optimized and efficient as possible. I am very concerned to hear that there may be double/redundnt and/or unnecessary loading of the data file and we are seeing times of 10s and more on files that are just 2-3MB, as this would end up being a major impact to families int he future and is already impacting my own family and potentially others. Let's ensure that the data file is only accessed and loaded in full exactly as many times as needed and never unnecessarily or redundantly during the load cycle, especially on the initial load when opening the app. evenm though we have put a snapshot in place to reduce imapct to the customer, staring at stale data for 5-10s or more is also a major concern and could cause users to lose trust in what they are looking at on the screen.

### Follow-up 1 — dedupe decision (after being shown the #57 merge conflict)

> ok underdstand, pls split this into a separate issue and filoe as it's own issue

### Follow-up 2 — pre-plan intake answers

> **Success target:** "Let's attempt to at least halve the number, but the main goal is (4) - to eliminate all probable redundancy and ensure the load is as quick as technically possible without sacrificing data quality or accuracy"
> **Snapshot defer:** "Let the plan decide with a recommendation"
> **Audit output:** "Committed investigation doc"
> **Rollout:** "Ungated — as currently set"

### Follow-up 3

> proceed to /beanies-plan

### Follow-up 4 — revision-vs-mtime directive (2026-08-13)

> Compare a monotonic revision identifier rather than a modification time; a diverged device is a legitimate reason to reload. Trust backstop: 1 hour.

</details>
