# Plan: Fix the ADR-032 worker path timing out on iOS for large family docs (Layer 1 — optimize + stop erroring)

> Date: 2026-07-06
> Related issues: None — direct implementation (branch: `main`, ADR-032 follow-up)
> Plan file (on approval): `docs/plans/2026-07-06-worker-ios-large-doc-load.md`
> **No GitHub issue created.** Direct implementation; full prompt history embedded below.

## User Story

As an iOS user with a large family (a ~2 MB, deep-history `.beanpod`), I want the app to finish loading my data when I sign in — responsively, without freezing and without an error — so I can actually reach my family instead of a "we couldn't update your data" toast that locks me out.

## Context

ADR-032 moved the Automerge doc + persistence into a Web Worker to stop the main-thread freeze on large-doc loads. It is **merged to `main` and deployed with `docWorker` prod-OFF** (prod runs the inline fallback, which greg has fully validated on real iOS + cross-device). We are validating the worker path on greg's own devices in prod via the per-browser `localStorage` override (`beanies:flag:docWorker`, `flags.ts:71`) before flipping `featureFlags.committed.ts` for everyone.

On a real iPhone (iOS 18.7, Safari) loading greg's existing ~2 MB `.beanpod`, the worker's `mergeRemoteEnvelope` RPC **timed out at the fixed 45 s ceiling** at the password/decrypt step → critical `doc-worker` toast + Slack alert. Desktop does the same load in ~2.6 s.

### Root cause (established via a 4-agent code investigation, 2026-07-06)

The 45 s is spent almost entirely **inside the worker on Automerge WASM + whole-doc CPU**, not the postMessage boundary. iOS JSC runs Automerge's WASM core ~5–15× slower than desktop V8; the spike already clocked `Automerge.load` at **8.5 s for a synthetic 2.28 MB doc** on iPhone but reconciled that only against UI responsiveness, never against the fixed 45 s RPC timeout (`docs/plans/2026-07-05-automerge-web-worker.md:217-230`). A real deep-history doc loads slower still (`Automerge.load` cost scales with change-history length, not bytes).

**Two distinct code paths — the fix differs per path:**

- **First cold load (greg's exact failure):** no local cache → `currentDoc` is null → `mergeRemoteEnvelope` takes the _remote-first adopt_ branch (`applyAndProject.ts:256-261`): `decryptToDoc` → `migrateDoc` → `pushProjection`. **No `mergeDocs`, no `Automerge.clone`** on this path. Dominant costs: `Automerge.load` (the WASM floor) + `buildFullProjection` (full materialize of all 27 collections — genuinely needed here, everything is new). The clone-removal and delta-projection below **do not help this path**; it is fixed by the non-erroring timeout + a cheaper projection transfer.
- **Subsequent poll-merges (ongoing responsiveness; desktop already saw `remoteLoad` ×36/session):** `currentDoc` present → `mergeDocs` runs `Automerge.clone(local)` (a redundant second full-doc load, `docOps.ts:75`) then `pushProjection` rebuilds the **entire** projection even for a one-row change, discarding the change delta it just computed (`docOps.ts:76`). These are fixed by clone-removal + delta-projection.

### Confirmed cost centers (file:line)

1. **Redundant `Automerge.clone(local)`** — `docOps.ts:75`. `Automerge.merge` mutates its first arg, so the code clones `local` defensively; but the worker is single-threaded and `currentDoc` is immediately reassigned to the merged doc (`applyAndProject.ts:265`) — the clone is thrown away. ≈ a second full-doc WASM load per poll-merge.
2. **Full projection rebuild on every merge** — `applyAndProject.ts:272` → `buildFullProjection` (`docOps.ts:153-162`) → `materializeCollection` → `toPlain = JSON.parse(JSON.stringify(entity))` per entity across all 27 collections, then chunked `postMessage` (structured-clone) back. O(whole-doc) regardless of change size. The `mutate` path already ships surgical deltas (`applyMutation`/`deltaFor`, `docOps.ts:353-410`) — merges should too.
3. **Inbound `postRaw` JSON round-trip** — `docClient.ts:302-308`; `mergeRemoteEnvelope` ∈ `JSON_SAFE_METHODS`, so the **main thread** runs `JSON.parse(JSON.stringify(envelope))` on the whole envelope including the ~2.7 MB base64 `encryptedPayload`, before `postMessage` structured-clones it again. The round-trip exists only to strip Vue reactive proxies; the big payload is a primitive string (already clone-safe) and does not need it. Small (~hundreds ms) but avoidable + main-thread.
4. **`toPlain`-then-`structuredClone` double walk (outbound, worker-only)** — `docOps.ts:31` + `applyAndProject.ts:148`. Each projection entity is JSON round-tripped (`toPlain`) then structured-clone re-walked by `postMessage`. Inline pays only the first; the worker pays both.
5. **`.slice(IV_LENGTH)` in decrypt** — `familyKeyService.ts:130` copies the full ~2 MB ciphertext; `.subarray` (a view) avoids one memcpy. Trivial.

### The trigger

`DEFAULT_RPC_TIMEOUT_MS = 45_000` is **fixed and uniform** (`docClient.ts:59`), applied in `requestCore` (`docClient.ts:348-352`); every production caller of `mergeRemoteEnvelope`/`initAndLoadCache` passes no `opts.timeoutMs`. A legitimately-slow-but-progressing load is executed and then **discarded** at 45 s. Because the worker's `Automerge.load` is a single synchronous WASM call, a mid-load keepalive can't fire — so the pragmatic fix is a **generous per-op ceiling for the heavy load/merge ops** (they run off-thread; the UI stays responsive), keeping the tight 45 s for ordinary mutations.

### What this plan does and does not solve

- **Solves:** the first-load _lockout_ (it completes instead of erroring), and makes poll-merges O(changed) not O(doc). Cuts avoidable whole-doc CPU/serialization around the WASM floor.
- **Does NOT solve (explicit Layer 2 follow-up):** the residual `Automerge.load` latency floor on a huge deep-history doc — only history compaction / incremental changes-based sync removes that (the `getChangesSince`/`applyChanges` hooks are already stubbed at `applyAndProject.ts:296-308`). A separate ADR + plan. The worker will still show a "counting beans" wait on the very first load of a huge doc; it just won't freeze or error.

## Requirements

1. The worker's first cold load of a large (~2 MB, deep-history) `.beanpod` on iOS **completes without erroring** — no `doc-worker … timed out` toast for a load that is progressing.
2. During that load the UI stays responsive and shows the existing "counting beans" unlock/loading state (no frozen main thread, no blank error).
3. Poll-merges (`currentDoc` present) no longer pay the redundant `Automerge.clone(local)`; the `dirty` flag stays correct.
4. Poll-merges emit a **delta projection** (only entities the merge changed), not a full 27-collection rebuild. First-load (remote-first adopt) may still send a full projection (correct — all entities are new).
5. The inbound `postRaw` plainify no longer JSON-round-trips the large `encryptedPayload` on the main thread; reactive proxies are still stripped correctly.
6. `pushProjection` is wrapped in a `time()` sample so the load-vs-projection split is visible in prod telemetry (survives in the `perfTiming` message field, `perfTiming.ts:71-73`).
7. **No regression to the inline fallback** (same `applyAndProject`/`docOps` code runs inline) or to desktop worker behavior. Full unit suite green; type-check + lint clean.
8. No stuck-worker regression: a genuinely hung worker on a heavy op still surfaces an error within a bounded (generous) ceiling, classified + logged, never silent.

## Important Notes & Caveats

- **First-load vs poll-merge is the load-bearing distinction.** Do not claim the clone/delta fixes help the reported first-load lockout — they don't (that path has no clone/merge). Keep the timeout + pending + transfer fixes as the first-load levers, and clone/delta as the poll-merge levers. Both are in scope; the plan/tests must treat them separately.
- **Reuse the existing delta machinery — do NOT invent a parallel one.** The `mutate` path already computes per-entity `ProjectionDelta`s from a committed doc (`deltaFor`, `docOps.ts:354-385`) and the protocol already has `upsert`/`remove`/`multi`/`bulk` kinds. The merge-delta must produce the same `ProjectionDelta[]` shape consumed by `projection.applyChunk`/`applyOne`. Prefer computing the changed (collection,id) set from Automerge's own change info between `localHeads` and `mergedHeads` — e.g. `Automerge.diff(merged, localHeads, mergedHeads)` patches (each `patch.path` is `[collection, id, …]`) → dedup to touched entities → `upsert` (materialize just those) / `remove` (absent post-merge). This keeps merge and mutate on one projection-delta code path.
- **Delta-projection correctness > cleverness.** The touched-set derivation materializes the _whole_ entity by `(collection, id)`, so it is **nesting-agnostic** — a change to `doc.assets[id].loan.outstandingBalance` still resolves to `upsert assets/<id>`. The ONLY genuine special case is the `settings` singleton (its `diff` path has no `id`). The derivation is modeled as a value: `projectionDeltasBetween(...) → ProjectionDelta[] | null`, where `null` (unexpected shape/unknown key, or any internal throw) means "fall back to the full `buildFullProjection`" — a correct full rebuild is acceptable; a wrong delta is not. The fallback is a normal branch (`?? buildFullProjection`), not an exception path, and any `null` from an internal throw is logged (dev breadcrumb, `reportError` non-critical), never silent. See the half-update-safety invariant in Fix 3.
- **`Automerge.clone` removal — merge into `local`, never invert.** Drop `Automerge.clone(local)` and call `Automerge.merge(local, remote)` directly: verified against 3.2.6 (`dist/cjs/fullfat_node.cjs:5025`), `merge` mutates `local`'s handle in place, returns the converged doc, and only READS `remote` — so `dirty = getChanges(remote, merged).length > 0` (`docOps.ts:76`) is byte-identical (the ADR-032 note at `docOps.ts:69-73` about not using a pre-merge heads compare still holds; this changes nothing there). **Never invert to `Automerge.merge(remote, local)`** — that switches the converged doc's actorId to remote's, changing which actor subsequent local writes use. Safe here because `currentDoc` is immediately reassigned to `merged.doc` and the stale `local` reference is dropped. **Side benefit:** the old `clone(local)` did `fork()` with no actor, minting a fresh random actorId on every poll-merge (actor-list bloat); merging in place keeps one stable actor per device — the intended Automerge model. **Exception-safety note (Pass 4):** `merge` applies changes in place on `local`'s handle, so unlike the old throwaway-clone, a throw could touch `currentDoc`. A throw BEFORE `applyChanges` (the out-of-date guard / `getChangesAdded`) leaves `currentDoc` intact; a throw mid-`applyChanges` (essentially unreachable — the remote already passed `decryptToDoc`→`loadAndVerify`) could leave `currentDoc` subtly advanced. We accept this: a `mergeDocs` throw rejects the RPC (classified `doc-worker` error) and the remote is unchanged, so the recoverability delta vs the clone is negligible; if it ever proves flaky, treat a `mergeDocs` throw as a `needsRehydrate` trigger rather than re-introducing the whole-doc clone. Add a unit test asserting `dirty` is unchanged for: clean local == remote, local ahead, remote ahead, both diverged — plus a merge-throw recoverability test (below).
- **Timeout ceiling is per-op, not global.** Introduce a longer ceiling ONLY for the heavy load/merge family (`mergeRemoteEnvelope`, `initAndLoadCache`, and any op that decrypts+loads the whole doc). Keep `DEFAULT_RPC_TIMEOUT_MS = 45_000` for mutations. Pass it via the existing `opts.timeoutMs` seam (`docClient.ts:315,350`) so no new mechanism is needed. Pick a defensible ceiling (e.g. 120 s) with a one-line rationale comment; do not make it unbounded (a hung worker must still surface). Consider scaling by `encryptedPayload.length` only if a constant proves too blunt — default to a constant for simplicity.
- **Single-string projection transfer (Fix 7) is DEFERRED to Layer 2.** It mutates the shared `ProjectionDelta` contract (`protocol.ts:30-37`) consumed by the correctness-critical **inline** path (the one greg has fully validated in prod) and by `projection.applyOne` (`projection.ts:60-92`), for a worker-only benefit — and it does NOT fix the first-load lockout (that is fully resolved by Fix 1's timeout + Fix 4's narrowed plainify, with Fix 3 removing the recurring per-poll-merge serialization). The dominant first-load cost is the `Automerge.load` WASM floor, not per-entity serialization. Not worth the contract risk in this plan; documented in the Layer 2 follow-up.
- **Do not touch Layer 2 scope.** No history compaction, no incremental `getChangesSince`/`applyChanges` wiring in this plan. Leave the stubs (`applyAndProject.ts:296-308`) as-is; reference them in the follow-up ADR only.
- **No silent failures (project rule).** Every new fallback/timeout path logs with a prefixed `reportError`/console breadcrumb and, where user-facing, a classified toast. The delta→full fallback logs a dev breadcrumb; the heavy-op timeout still throws the classified `doc-worker` error (just at the higher ceiling).
- **Telemetry key survival.** `perf_*` context keys are dropped by the telemetry Lambda allowlist; numbers survive only in the `message` string (`perfTiming.ts:71-73`). The new `pushProjection` `time()` sample must follow the same message-embedding convention as the existing `automerge.remoteLoad`/`mergeClone` samples so the split is readable in CloudWatch.

## Assumptions

> Review before implementation.

1. greg's failure is the **first cold load** (fresh device, empty cache → remote-first adopt). If a cached doc were present it would be a poll-merge; confirm via the repro (fresh Safari website-data on the device).
2. **Confirmed against Automerge 3.2.6** (`node_modules/@automerge/automerge` — the installed version, NOT 2.x): `Automerge.diff(doc, fromHeads, toHeads)` exists and returns `Patch[]` with `path: Prop[]` (actions `put|del|inc|splice|insert|mark|unmark|conflict`). Derivation rule: for each patch — if `path[0] === 'settings'` → emit one `settings` delta; else if `path.length >= 2` and `path[0]` is a known collection → mark `(path[0], path[1])` touched; ignore `path.length < 2` (top-level collection creation from `migrateDoc` — harmless, no entities). For each touched `(collection, id)`: `doc[collection][id]` present → `upsert` (materialize the whole entity via `toPlain`), absent → `remove`. The logged full-rebuild fallback makes an unexpected shape safe.
3. The heavy-op ceiling (≈120 s) is comfortably above the worst realistic iOS first-load for the current user base and below "obviously hung." Revisit if telemetry shows real loads near it (that would be the Layer 2 trigger).
4. Removing `Automerge.clone(local)` and merging in place does not alias `currentDoc` incorrectly — after merge, `currentDoc` is reassigned and the old `local`/`remote` references are dropped.
5. No non-merge caller depends on `pushProjection` always sending a full reset (the delta path is only taken inside the merge; `initDoc`/`initAndLoadCache`/`loadSnapshot`/create still full-project).

## Approach

All production changes are in the worker layer (`applyAndProject.ts`, `docOps.ts`, `docClient.ts`, `protocol.ts`) + a one-liner in `familyKeyService.ts`. The inline fallback inherits every `docOps`/`applyAndProject` change for free.

### Fix 1 — Non-erroring heavy-op timeout (the first-load lockout fix) [highest priority]

- Add a `HEAVY_RPC_TIMEOUT_MS` (≈120 s) constant in `docClient.ts` with a rationale comment (off-thread, UI-responsive → this is a stuck-worker detector, not a UX budget; still bounded so a genuine hang surfaces).
- **Classify heavy ops centrally in a `Set`, do NOT thread `timeoutMs` through four wrappers** (drift prevention — a future 5th whole-doc op that forgets the opt would silently revert to 45 s and re-introduce this exact iOS lockout). Mirror the existing `JSON_SAFE_METHODS` pattern, co-located with it:
  ```ts
  const HEAVY_METHODS = new Set([
    'mergeRemoteEnvelope',
    'initAndLoadCache',
    'verifyEnvelope',
    'exportEncryptedPayload',
  ]);
  ```
  (verified whole-doc: `verifyEnvelope`→`decryptToDoc` load `applyAndProject.ts:279-283`; `exportEncryptedPayload`→`saveDoc`+encrypt `:287-292`.) In `requestCore` (`docClient.ts:348-352`) derive the timeout from the Set, preserving the explicit-override seam:
  ```ts
  const timeoutMs =
    opts.timeoutMs ?? (HEAVY_METHODS.has(method) ? HEAVY_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS);
  ```
  Wrappers stay untouched (no wrapper needs to import the timeout constant). Adding a heavy op later is ONE line in the Set, next to `JSON_SAFE_METHODS` where a dev already sees the related envelope concern.
- **Verified the pending UX needs NO code:** `LoadPodView.vue` sets `isLoadingFile=true` around `syncStore.decryptPendingFile(...)` (`:329/:333/:369`), driving the `BeanieSpinner` "counting beans" state (`BeanieSpinner.vue:9`; `:482`) for the entire decrypt→merge window — exactly the spinner greg saw for 30 s. Raising the timeout keeps that spinner up until the merge completes. No new component, no predictive "this may be slow" warning (project rule).

### Fix 2 — Drop the redundant `Automerge.clone(local)` (poll-merge)

- In `mergeDocs` (`docOps.ts:74-78`): `const merged = migrateDoc(Automerge.merge(local, remote));` (was `Automerge.merge(Automerge.clone(local), remote)`). `dirty = Automerge.getChanges(remote, merged).length > 0` stays exactly as-is — byte-identical semantics. **Merge into `local`, never invert to `merge(remote, local)`** (that would switch the converged doc's actorId to remote's). Return `{ doc, dirty, heads }` unchanged in shape.
- Rename the now-misleading perf label `automerge.mergeClone` → `automerge.merge` (`applyAndProject.ts:264`) and update the Telemetry-key note. (Verified: no in-repo dashboard/alarm references the string — only historical doc tables — so the rename is operationally safe; the historical CloudWatch series simply ends and `automerge.merge` starts fresh, acceptable since the op no longer clones.)
- Unit test the `dirty` matrix (clean / local-ahead / remote-ahead / diverged) equals the old behavior.

### Fix 3 — Delta projection on poll-merge (poll-merge)

- **Capture `localHeads = getHeads(local)` BEFORE calling `mergeDocs`** (the merged doc contains local's history, so `localHeads` is a valid `diff` ancestor of `mergedHeads`).
- In `mergeRemoteEnvelope` (`applyAndProject.ts:262-268`, the `currentDoc != null` branch): after computing `merged`, call `projectionDeltasBetween(merged, localHeads, mergedHeads)` — a new **pure** helper in `docOps.ts` that runs `Automerge.diff`, applies the Assumption-2 derivation rule, and returns `ProjectionDelta[] | null` (`upsert`/`remove`/`settings`, the same shape `deltaFor` emits). Stream via `pushDeltas(deltas ?? buildFullProjection(currentDoc))`.
- **Structural fallback, not exception-as-flow:** the full rebuild is a _legitimate, correct_ answer whenever the diff can't be confidently interpreted — model it as a value. `projectionDeltasBetween` returns `null` for "couldn't confidently derive" (keeps an INTERNAL try/catch that maps any unexpected throw — incl. `Automerge.diff` throwing — to `null` + a dev breadcrumb via `reportError` non-critical). The merge call site is then one readable line: `pushDeltas(deltas ?? buildFullProjection(currentDoc))`.
- **Closed over the known doc shape (schema-drift safety):** for each patch — `path[0] === 'settings'` → settings delta (deduped to a SINGLE settings delta even if several `settings.*` keys changed; re-materializing the singleton is idempotent); else if `COLLECTION_NAMES.includes(path[0])` and `path.length >= 2` → mark `(path[0], path[1])` touched; else if `path.length < 2` → ignore (harmless top-level/migrate create); **else (unknown top-level key / unexpected shape) → return `null`** (full-rebuild fallback) + breadcrumb. `docOps.ts` already imports `COLLECTION_NAMES`, so "what is a collection" stays one imported constant. A future doc-schema change degrades to correct-but-full, never a wrong delta.
- **DRY the streamer:** refactor `pushProjection` (`applyAndProject.ts:131-149`) into `pushDeltas(deltas: ProjectionDelta[])` (the existing bulk-slice + `final`-flag loop); define `pushProjection(doc) = pushDeltas(buildFullProjection(doc))`. Merge + full-load share ONE chunked streamer.
- **Half-update-safety invariant (load-bearing — put this as a code comment on `projectionDeltasBetween` AND the merge branch):** `projectionDeltasBetween` is pure and must NOT call `sink.pushChunk`. It fully derives its `ProjectionDelta[]` (or returns `null`) BEFORE `pushDeltas` streams anything. Therefore a derivation failure can never leave a partially-streamed projection — the projection sees either the complete delta set or the complete full rebuild, never a prefix of a failed delta. The fallback `buildFullProjection` uses `bulk reset:true` per collection (overwrites), so any hypothetical stale prior state is fully resynced. A future refactor must not make the helper stream directly.
- **Empty-delta merge** (remote carried no changes local lacked): `pushDeltas([])` streams nothing → `bumpDocVersion` never fires. Correct (the projection already matches; the RPC response resolves independently of projection chunks) — leave a code comment so it isn't "fixed" into a spurious bump.
- **Two projection strategies, keyed on `currentDoc` — comment the branch:** `// first-load adopt = every entity is new → full projection is correct AND cheaper than diffing against empty. poll-merge = few changed → delta (guarded, falls back to full). Do NOT convert other pushProjection callers (initAndLoadCache/loadSnapshot/applyChanges) to deltas without the same diff+fallback guard — see Assumption 5.` The remote-first adopt branch (`currentDoc == null`) is unchanged — full projection.

### Fix 4 — Narrow the inbound `postRaw` plainify (envelope methods only)

- `postRaw` serves both `mutate` (small reactive entity payloads — MUST keep full stripping) and the envelope methods. So the narrowing is method-specific, NOT a blanket change. Keep `JSON.parse(JSON.stringify(...))` for `mutate`. For the envelope-carrying methods (`mergeRemoteEnvelope`/`verifyEnvelope`/`persistEnvelope`), split the large primitive off before plainifying — at `args.envelope` (the RPC arg is `{ envelope, familyId }`), NOT `args`:
  ```ts
  const { encryptedPayload, ...rest } = args.envelope;
  const safeArgs = { ...args, envelope: { ...JSON.parse(JSON.stringify(rest)), encryptedPayload } };
  ```
  `familyId` is a plain string and needs no handling. This strips reactive proxies from the small fields (`wrappedKeys`/`inviteKeys`/metadata) while passing the ~2.7 MB base64 string (a proxy-free primitive — Vue never wraps primitives, so no proxy-leak risk) straight through. Implement cleanly as a per-method plainify branch in `postRaw`, not duplicated per call site.
- Unit test: a reactive-proxy-wrapped `wrappedKeys` is stripped to a clone-safe plain object; `JSON.stringify` is never called on `encryptedPayload` (spy).

### Fix 5 — `time()` around `pushProjection` (telemetry)

- Wrap the WHOLE-DOC full-projection emits — the first-load-adopt branch of `mergeRemoteEnvelope` and `initAndLoadCache` (where the load-vs-projection split matters) — with the EXISTING sync `time('automerge.pushProjection', () => …, { perf_entity_count })` (`applyAndProject.ts:83-90`). The poll-merge delta emit is below the telemetry floor and need not be timed. No new helper — `perfTiming.record` already message-embeds `perf_entity_count` (`perfTiming.ts:50,73`), and `perf_entity_count` is also in the diagnostic-context allowlist (`diagnosticContext.ts:109`), so the number survives to CloudWatch. Confirm on implementation that the sample actually lands (message-embedded and/or allowlisted). Confirms the load-vs-projection split on-device.

### Fix 6 — DROPPED

- The originally-proposed `.slice(IV_LENGTH)` → `.subarray(IV_LENGTH)` in `decryptPayload` is a **decrypt-breaking bug**: `familyKeyService.ts:135` passes `ciphertext.buffer` to `crypto.subtle.decrypt`; with `.subarray`, `.buffer` is the _entire_ original buffer including the 12-byte IV prefix → every decrypt fails. Doing it correctly would also require dropping the `.buffer` accesses (pass the views directly). Given the `Automerge.load` WASM floor dwarfs one 2 MB memcpy, this micro-win is not worth the risk/churn — **dropped**.

### Fix 7 — DEFERRED to Layer 2

- Single-string projection transfer (JSON.stringify once in the worker, transfer the string, JSON.parse once on main) mutates the shared `ProjectionDelta` contract (`protocol.ts:30-37`) used by the validated inline path and `projection.applyOne`, for a worker-only benefit that does not touch the first-load lockout. Deferred; captured in the Layer 2 follow-up doc.

## Files Affected

- `src/services/automerge/worker/docClient.ts` — `HEAVY_RPC_TIMEOUT_MS` + `HEAVY_METHODS` Set (co-located with `JSON_SAFE_METHODS`); `requestCore` derives the timeout from the Set (override seam preserved); envelope-method-specific `postRaw` plainify (Fix 4). Wrappers untouched.
- `src/services/automerge/worker/docOps.ts` — clone-free `mergeDocs` (Fix 2); new pure `projectionDeltasBetween(doc, fromHeads, toHeads): ProjectionDelta[] | null` helper closed over `COLLECTION_NAMES`+`settings` (Fix 3).
- `src/services/automerge/worker/applyAndProject.ts` — capture `localHeads` pre-merge; merge uses `pushDeltas(projectionDeltasBetween(...))` with logged full-rebuild fallback; `pushProjection` refactored to `pushDeltas`; rename `automerge.mergeClone`→`automerge.merge`; `time('automerge.pushProjection', …)` (Fixes 2, 3, 5).
- **No change** to `protocol.ts`, `projection.ts`, `docWorker.ts`, or `familyKeyService.ts` (Fix 6 dropped, Fix 7 deferred).
- **Tests (add/update):**
  - `docOps` merge tests — `dirty` matrix unchanged after clone removal; `projectionDeltasBetween` emits only changed entities (+ `remove` for deletions); fallback-to-full on a forced derivation error.
  - `applyAndProject`/inline-harness tests — poll-merge emits a delta (not 27-collection reset); first-load (currentDoc null) still full-projects; inline path identical.
  - `docClient` tests — heavy ops use the higher timeout, mutations keep 45 s; a heavy op still errors (classified) past the ceiling.
  - `postRaw` plainify test — reactive proxy stripped; large payload not re-serialized.
- **Follow-up doc (created, not implemented):** `docs/adr/033-...` (or a `docs/plans/` stub) capturing Layer 2 (incremental sync + compaction) referencing the stubs at `applyAndProject.ts:296-308`.

## Acceptance Criteria

- [ ] On a real iPhone with the `docWorker` override on, loading the ~2 MB `.beanpod` completes (reaches the app) without the `doc-worker … timed out` toast.
- [ ] The UI stays responsive during that load (no main-thread freeze) with the existing loading state shown.
- [ ] Poll-merge no longer calls `Automerge.clone(local)`; `dirty` matrix unit test passes (clean/local-ahead/remote-ahead/diverged).
- [ ] Poll-merge emits a delta projection (asserted: only changed entities); first-load still full-projects; a forced delta-derivation error falls back to full + logs a breadcrumb.
- [ ] `postRaw` no longer full-round-trips the large payload; reactive-proxy stripping still verified by test.
- [ ] `automerge.pushProjection` perf sample appears (message-embedded) and `automerge.mergeClone` is renamed `automerge.merge`, so the split is visible in telemetry.
- [ ] Heavy load/save ops (`mergeRemoteEnvelope`/`initAndLoadCache`/`verifyEnvelope`/`exportEncryptedPayload`) use `HEAVY_RPC_TIMEOUT_MS`; mutations keep 45 s; a hung heavy op still surfaces a classified error at the ceiling (no silent hang).
- [ ] Inline fallback + desktop worker unchanged in behavior; full unit suite green; type-check + lint clean.
- [ ] Layer 2 follow-up doc created.

## Testing Plan

1. Unit — `mergeDocs` clone removal: `dirty` matrix parity with prior behavior (clean / local-ahead / remote-ahead / diverged); merged heads correct.
2. Unit — `projectionDeltasBetween`: seed a doc, apply a remote change touching N entities across ≥2 collections (incl. a delete), assert exactly those `upsert`/`remove` deltas; assert `settings`-singleton emits a settings delta.
3. Unit — **half-update safety (most important reliability test):** force `projectionDeltasBetween` to fail (internal throw → `null`), assert the sink receives ONLY the full-projection chunk sequence — never a partial delta followed by a full reset — and a breadcrumb is logged.
4. Unit — **migrate-during-merge:** local missing a collection + remote touching one real entity → the length-1 migrate patches are ignored, only the real entity's delta emitted (or clean fall back to full); never a bogus `remove`/`upsert`.
5. Unit — **unknown-top-level-key fallback:** a patch whose `path[0]` ∉ `COLLECTION_NAMES` and ≠ `settings` **with `path.length >= 2`** → `null` (full rebuild) + breadcrumb (a `length < 2` unknown key correctly hits the _ignore_ branch, so test length ≥ 2). Guards future schema drift.
   6b. Unit — **merge-throw recoverability:** inject a `mergeDocs` that throws; assert `mergeRemoteEnvelope` rejects (classified `doc-worker` error) and a follow-up `mutate` still succeeds against a coherent `currentDoc` (the remote was unchanged).
6. Unit — first-load vs poll-merge: `currentDoc==null` → full projection; `currentDoc!=null` → delta.
7. Unit — **`docClient` timeouts driven by the Set:** a method in `HEAVY_METHODS` uses 120 s and one outside uses 45 s, asserted through the Set (adding to the Set is the only lever); a never-resolving heavy op rejects (classified) at the ceiling; mutation still 45 s.
8. Unit — `postRaw`: reactive-proxy `wrappedKeys` → clone-safe plain; `JSON.stringify` never called on `encryptedPayload` (spy).
9. Manual on a FRESH dev server (`docWorker` ON), desktop: create/edit/sync unaffected; poll-merge sync still converges cross-device (worker device ↔ inline device).
10. Manual on real iPhone via the `localStorage` override: first-load of the large doc completes; then create/edit/sync; sign out/in.
11. Regression: flip `docWorker` OFF → inline path identical; full suite green; type-check + lint clean.

## Review Passes

- **Pass 1 (Initial draft):** Drafted Layer-1 fixes from the 4-agent investigation; separated first-load (timeout + transfer) from poll-merge (clone + delta) levers; guarded the delta path with a logged full-rebuild fallback; scoped the single-string transfer as deferrable.
- **Pass 2 (DRY + error handling):** Corrected two shipped-bug risks (Fix 6 `.subarray` breaks decrypt via `ciphertext.buffer` → dropped; Fix 2 caveat's `merge(remote,local)` inverts actorId → drop the clone via `merge(local,remote)`, `dirty` unchanged); fixed the Automerge version (3.2.6, confirmed `Automerge.diff(doc,before,after):Patch[]`, `path=[collection,id,…]`); made Fix 4 envelope-method-specific so `mutate` keeps full proxy-stripping; folded merge deltas into a shared `pushDeltas` streamer + reused existing `time()`/`perf_entity_count` (no new helpers); verified Fix 1 reuses the existing `BeanieSpinner` window (no UI code) + expanded heavy-op set to 4; deferred Fix 7 (contract-invasive, worker-only, off the lockout path).
- **Pass 3 (Sustainability):** Hardened the two new maintenance surfaces against drift/half-updates — replaced per-wrapper `timeoutMs` threading with a central `HEAVY_METHODS` Set (mirrors `JSON_SAFE_METHODS`, one line to extend, can't silently revert to 45 s); made the delta fallback structural (`projectionDeltasBetween → ProjectionDelta[] | null`, `?? buildFullProjection`) not exception-as-flow, pinned the "derive fully before streaming — never a partial then throw" invariant as a code comment, and closed the derivation over `COLLECTION_NAMES`+`settings` so schema drift degrades to correct-full not wrong-delta; documented the first-load/poll-merge branch in code; noted the safe `mergeClone→merge` CloudWatch discontinuity and confirmed `perf_entity_count` survives (`diagnosticContext.ts:109`); added half-update-safety, migrate-during-merge, unknown-key-fallback, and Set-driven-timeout tests.
- **Pass 4 (Fresh-eyes sweep):** Verified against Automerge 3.2.6 source that `diff(merged, localHeads, mergedHeads)` and the pre-merge `localHeads` snapshot are correct, the narrowed `postRaw` can't leak a proxy (payload is a string primitive), and the 120s `HEAVY_METHODS` ceiling never delays crash recovery (`onWorkerError` drains `pending` on the `onerror` event); surfaced the one missed side-effect — dropping the clone makes `Automerge.merge` mutate `currentDoc` in place, so a (near-unreachable, post-`loadAndVerify`) mid-`applyChanges` throw could leave it half-merged — captured as an accepted caveat + a merge-throw recoverability test (escalate to `needsRehydrate` rather than re-cloning if flaky); tightened Fix 5 to the split projection emit, pinned Fix 4 to `args.envelope`, deduped the `settings` delta, and fixed the unknown-key test to `path.length >= 2`. **Go.**

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Session context leading in

Worker migration merged to main + deployed with `docWorker` prod-off; greg validated iOS onboarding + cross-device sync on the inline path, then enabled the worker on his iPhone via the `localStorage` override to test the worker path.

### Trigger (greg, verbatim)

"I've loaded app.beanies.family on my iphone via safari, completed the google consent screen, and tried loading the large (2MB+) family data file. when i reached the sign-in screen to type my password to decrypt the file the spinner loaded for about 30s+ and then receive an error toast - 'we couldn't update your data' - doc-worker mergeRemoteEnvelope timed out … Note: I'm not sure if the bookmark in mobile safari worked to activate the flag …"

### Direction (greg)

"yes perform the investigation" → after the root-cause synthesis, chose scope **"Optimize + stop erroring"** (Layer 1): remove redundant clone, delta projection on merge, narrow inbound plainify, non-erroring timeout + pending state; Layer 2 (incremental sync / compaction) as a documented follow-up.

### Approval (greg, 2026-07-06)

"approve and implement once the plan is ready - also record the layer 2 (along with the 2nd phase of the autoworker migration plan that was proposed in the previously implemented plan) in status and remind me to create a beanies issue in notion so that can also be planned and implemented properly"

</details>
