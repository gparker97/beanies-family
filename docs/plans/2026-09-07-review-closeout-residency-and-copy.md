# Plan: The layer that knows says so — closing the review on today's fixes

> Date: 2026-09-07
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-09-07-review-closeout-residency-and-copy.md`
> Reviews this range: `b308150d..HEAD` (six commits, 41 files)

> **No GitHub issue created.** This plan was approved for direct implementation.

> **⚠️ MOST OF THESE ARE REGRESSIONS FROM TODAY'S OWN FIXES**, several in code written specifically to prevent the class of failure it then caused. Type-check, lint and 6773 tests are GREEN, so every finding is behavioural — which is the first thing the plan has to answer for.

## User Story

As someone whose device hit a transient cache problem, I want beanies to keep working rather than locking me out — and when it does refuse, I want the message it shows me to be true.

## Context

Six commits today fixed a real data-loss path (an offline peer's work destroyed by a compaction) and a real lockout. A `/code-review max` over the range then found fifteen findings plus a runners-up list, and the majority are regressions those same commits introduced.

**The pattern, stated plainly, because it is the reason this plan exists.** The STRUCTURAL changes held: the positive-assertion premise in `applyAndProject`, the single `describeBlockerOnBar` writer, the exhaustive `satisfies Record<…>` tables (which immediately forced `too-old` into four sites and caught a subclass override the repo forbids). What failed, repeatedly, was POINT FIXES on the cache-classification and session/permission layers — each patched a symptom one call too late and introduced roughly as much as it removed. Two of the three lockout-class findings below are in code added this morning to fix a lockout.

**So the governing design rule for this plan:** where the current code INFERS a fact, move the fact to the layer that actually holds it. L1 and L2 are the same bug wearing two hats — main guessing whether the worker holds a document — and they get one fix, not two.

**Pass 2 changed WHICH layer that is, on evidence.** Pass 1 proposed a per-family, three-state residency variable inside `applyAndProject`. The code does not support it and the codebase already forbids it:

- The worker holds **one** document (`applyAndProject.ts:106` `let currentDoc: Doc | null`) and **one** key (`familyKey`). There is no per-family map and no family id at module scope — `mergeRemoteEnvelope(envelope, id, basis)` receives an id it never keys state on. "Per-family residency" has nowhere to live.
- Worker module state **does not survive a respawn**, and `mergeRemoteEnvelope` is in `RETRYABLE_METHODS` (`docClient.ts:560`) precisely so it can be replayed after one. That entry carries an explicit prohibition — `docClient.ts:552-559`: _"Do NOT add a method whose meaning depends on worker state the rehydrate can change underneath it."_ A residency flag in the worker is exactly that state: after a respawn it reads `'never-loaded'` whether the document was never installed or was lost with the dead realm, which is the one distinction the fix needs.

So the fact moves to **`docClient` on the main thread**, which is per-family by construction (`currentFamilyId`, `docClient.ts:157`), survives every respawn, and is where the rehydrator's own answer already lands and is currently thrown away. The worker keeps its positive-assertion refusal EXACTLY as written — it is correct and it is the guard three review passes kept re-breaking.

**Pass 3 kept that placement and cut what was unsustainable about the mechanism.** Three changes, each removing a thing that could drift rather than adding a guard against drift:

1. **The wire carries a LOSS VERDICT, not a stage and not a residency measurement.** Pass 3 was right that a measured `docResident` duplicates something the code already determines, and right to reject it. But it drew the wrong conclusion from that: `stage` is a **constant per code path**, so it cannot distinguish the two situations that actually reach the open-stage catch — a cold boot where nothing was ever loaded (`currentDoc === null`) and an open failure with this family's document already resident. That distinction IS L1(a), the case that stranded a user behind an unclosable overlay. A field that is constant where the decision varies is not a simplification, it is the bug re-encoded. So the error carries the one thing main needs and cannot derive:

   ```ts
   export type CacheInitLoss = 'nothing-to-lose' | 'something-to-lose';
   ```

   computed by **one expression, written once and used at both throw sites**: `currentDoc || cache.isCacheReady() ? 'something-to-lose' : 'nothing-to-lose'`. `stage` still rides along for diagnostics (it is free and it is real), but nothing branches on it.

2. **The docClient fact is keyed by family id, not a boolean, and has exactly ONE reader.** A `string | null` that must equal the family being merged cannot answer for the wrong family even if a clear is missed; a boolean can. And Pass 2 had two writers for it — `docClient.initAndLoadCache` _and_ `bootstrap.ts`'s rehydrator — which is the drift this plan's own governing rule forbids. `bootstrap.ts` does not change at all: the rehydrator calls `docClient.initAndLoadCache`, which already reads `res.loaded` (`docClient.ts:1130`), so it learns the fact for free. **Pass 4 corrected what the value MEANS**: not "was a document ever installed here" (monotone, and vacuous on L2's own device) but "did the worker most recently report this family's cache EMPTY" — the last answer, cleared by every install.
3. **The re-issue is bounded in writing.** `docClient.mergeRemoteEnvelope` already carries one transparent replay (`RETRYABLE_METHODS`, `:888`/`:919`); adding a second, differently-motivated re-issue in the same call needs a stated bound or one poll can dispatch four merges.

## Requirements

### Group 1 — lockout-class (these strand users)

**L1 + L2 (ONE FIX). The failure says which stage it came from; `docClient` says which family it has installed a document for. Neither layer guesses.**

Today:

- `syncStore.ts:1183` derives "this device still holds a document" from `!(e instanceof PayloadLoadError)`. That test is wrong in **both** directions, and the reason is structural rather than a missing arm:
  - `applyAndProject.ts:610` calls `dropDoc()` **unconditionally** in `initAndLoadCache`'s `loadCachedDoc` catch — _before_ the `PayloadLoadError` branch at `:611`. So **every** rejection from the load stage leaves the worker docless, including a raw `DOMException` or a key error, and main then refuses over a document that was already dropped and (on the corrupt arm) a cache that was already wiped: it tells the user "anything you have not saved yet is still here" over a deleted document and dead-ends the self-heal `App.vue` mandates.
  - The `initPersistenceDB` catch at `:566-577` rethrows **without** dropping — so the cache-open deadline is the one class where a resident document genuinely survives. But on a **cold boot with a second tab** nothing was ever loaded, `currentDoc` is null, and `withTimeout` (`utils/timing.ts:16-24`) rejects with a plain `new Error(message)` whose `name` is `'Error'`. Main classifies it as "doc intact", refuses, throws `LocalDocUnreadableError`, the blocker latches, and `App.vue:858 → surfaceFatal` raises `FatalErrorOverlay` — `fixed inset-0 z-[300]` (`FatalErrorOverlay.vue:77`), whose only action is Reload, which reproduces the timeout while the second tab is open. The shell never mounts, so `LocalDocUnreadableBanner` (`App.vue:2215`) and its "Use the family file" exit are unreachable.
- `applyAndProject.ts:933` refuses whenever `!currentDoc` and the basis is not `no-local-document`. **Three** call sites can meet that refusal, not one — every site that sends `{kind:'baseline'}`: `syncStore.ts:1392` (`hydrateFromEnvelope`), `syncStore.ts:1602` (the merging branch of `loadFromFile`) and `syncService.ts:1639-1642 → :1656` (the poll). A worker whose rehydrate resolved `{loaded:false}` latches all three and every save for the session, where it used to self-heal. (The open path at `syncStore.ts:1275` can never meet it: `loadedFromCache === true` means the worker holds the document, and `false` already sends `no-local-document`. **Three call sites, not four, and one place to fix them is the DRY reason `docClient` is the right home** — the per-family/survives-respawn reasoning above is why the worker is the _wrong_ home, which is a different argument.)

Requirements:

1. **One typed error carries the LOSS VERDICT across the boundary.** A rejection cannot carry a field unless its class is in `protocol.ts`'s `ERROR_REGISTRY` (`:308-335`); an unregistered class arrives on main as a bare `DocWorkerError` with everything stripped. So `initAndLoadCache`'s two non-payload throw sites raise:

   ```ts
   export type CacheInitStage = 'open' | 'load';
   export type CacheInitLoss = 'nothing-to-lose' | 'something-to-lose';
   export class CacheInitError extends Error {
     readonly stage: CacheInitStage; // diagnostics only — nothing branches on it
     readonly loss: CacheInitLoss; // the decision
     readonly cause: string; // the underlying err.name
   }
   ```

   registered with **one** codec entry beside the existing five (`CorruptPayloadError`, `PayloadTooLargeError`, `WorkerCrashError`, `PodLineageError`, `LocalDocUnreadableError`).
   - **`loss` is computed by ONE helper, called at both sites.** `function cacheInitLoss(): CacheInitLoss { return currentDoc || cache.isCacheReady() ? 'something-to-lose' : 'nothing-to-lose'; }`, declared next to `currentDoc`. Two throw sites calling one expression cannot drift; two inline copies of it can.
   - **`cache.isCacheReady()` is part of the question, not decoration.** ⚠️ This is Pass 3's near-miss and it is a **data-loss** path, so it is written out in full. Pass 3 proposed `load ⇒ adopt` unconditionally, reasoning that `dropDoc()` at `:610` runs before any branch so nothing survives the load stage. `dropDoc()` clears **memory**. But the load stage is only reached because `initPersistenceDB` **succeeded** — the cache DB for this family is open, writeable, and holds `inc:*` rows nobody has read. A wholesale install onto that DB leaves `lastPersistedHeads` null, and the next persist deletes every one of those rows as stale. The verdict must therefore ask about the cache as well as the document, which is exactly what `isCacheReady()` answers.
   - **NO `docResident` field, and no branching on `stage`.** Residency alone is also the wrong question at the open-stage throw: `initPersistenceDB(id)` has just FAILED, so the DB was never re-pointed and `currentDoc` may hold a **different family's** document (the hazard `applyAndProject.ts:595-608` and `syncStore.ts:1113-1125` are written about). `loss` is deliberately coarser than residency — it says _whether anything of value is at risk here_, which is the only question the refusal turns on, and it is true across families.
   - **Named `CacheInitError`, not `CacheOpenError`.** It covers both stages of `initAndLoadCache`; a class called "open" carrying `stage: 'load'` is a contradiction the next reader has to resolve.
   - **`PayloadLoadError` is NOT wrapped.** `syncStore.ts:1166` needs `e instanceof PayloadLoadError && e.deviceCannotOpen` to keep working, and wrapping would break the OOM rethrow. The load catch becomes `if (e instanceof PayloadLoadError) throw e; throw new CacheInitError('load', cacheInitLoss(), name)`.
   - **No new field on the success shape.** It would duplicate `loaded`, which already answers "is a document for this family installed" on every resolved path.

2. **`cacheErrorName` gets a real code by NAMING THE THROW, not by inferring on main.** The cache-open deadline is currently indistinguishable from a generic failure because `withTimeout` rejects with `name === 'Error'`. Fix it where the fact is known: give `withTimeout` an optional fourth `errorName` parameter (defaulting to today's behaviour, so `docClient.ts:404` and every other caller is unchanged) and pass `'CacheOpenTimeoutError'` at the one site that knows it is a cache-open deadline, `cache.ts:137-141`. Then the existing `raiseCachePersistFailure('open', e.name)` (`applyAndProject.ts:576`) **and** `CacheInitError.cause` both carry a real code with no message parsing anywhere. Requirement 4 of pass 1, delivered by naming a throw rather than by a second mechanism.
3. **`syncStore`'s classification reads the LOSS VERDICT, never the class and never the stage.** In `replaceDocWithCacheRecovery`, `:1183`'s `!(e instanceof PayloadLoadError)` becomes:

   ```ts
   /** Is there anything of ours to lose if we install the remote wholesale?
    *  The WORKER answers this — it is the only layer that can see both
    *  `currentDoc` and the cache handle. Main classifies, it does not measure. */
   const CACHE_INIT_LOSS = {
     'something-to-lose': true, // refuse, latch, offer the family file
     'nothing-to-lose': false, // adopt — there is nothing here to protect
   } as const satisfies Record<CacheInitLoss, boolean>;
   ```

   - `CacheInitError` → `CACHE_INIT_LOSS[e.loss]`
   - `PayloadLoadError` → `false` (dropped **and** reseeded by the worker; the honest answer is `no-local-document`)
   - anything else (an RPC deadline, a worker crash — no worker-side error object exists) → `true`, the fail-safe direction. That arm is only survivable because the overlay it can reach now has an exit: `BLOCKER_OVERLAY_KEY['podLocalUnreadable.inline']` already resolves to `resumeSetup.podLocalUnreadable` (`payloadFailureSurface.ts:293`), whose copy names "close other tabs, reload" and whose Reload button resolves it.
   - ⚠️ **EXACTLY ONE ROW OF TODAY'S MATRIX CHANGES**, and saying which one is the cheapest way to keep a reviewer from over-reading this fix. Today every non-`PayloadLoadError` refuses. After: the open-stage throw with **`currentDoc === null` and no ready cache** — the cold boot behind a second tab — **adopts** instead of refusing. Every other cell keeps its current verdict: an open-stage throw with a document resident still refuses (correctly — that is the case the refusal was written for), a load-stage throw over a live cache DB still refuses (this is the Pass-3 near-miss above), `PayloadLoadError` still adopts, an unknown still refuses. It is a one-cell fix; the machinery exists so that cell is decided by the layer that can see it.

4. **`docClient` records the LAST answer it got about this family's cache, and re-states the instruction when the worker refuses.** One module value beside `currentFamilyId`:

   ```ts
   /** The family whose cache the worker most recently reported EMPTY, or null.
    *  ⚠️ NOT a mirror of the worker's `currentDoc`, and deliberately NOT monotone.
    *  It records the LAST answer, not "ever": a rehydrate that resolved
    *  `{loaded:false}` sets it, and any install for that family clears it.
    *  Read in exactly ONE place: the refusal handler below. Keyed by id rather
    *  than a boolean so a missed clear cannot answer for the wrong family. */
   let cacheProvenEmptyFor: string | null = null;
   ```

   - ⚠️ **Pass 3's `installedDocForFamily` was monotone ("was a document ever installed here"), and that made L2 vacuous on the exact case L2 exists for.** The L2 device is one whose worker rehydrate resolved `{loaded:false}` _after_ an earlier session had installed a document — the flag reads "yes, installed" from that earlier session, `installedDocForFamily === familyId`, the substitution never fires, and the merge latches for the session exactly as it does today. The fact main can actually hold is not a history, it is the most recent answer.
   - **Set** where the worker reports an empty cache: `initAndLoadCache` when `res.loaded === false` (the same expression `bumpOpenCycle('reconstruction')` already reads, `:1130`).
   - **Cleared** on every install: `initDoc`, `initAndLoadCache` when `res.loaded === true`, `loadSnapshot`, and a merge resolving `adopted`/`merged`/`rebased`/`kept-local`.
   - **Also cleared inside `setCurrentFamily` when the id changes** — the function whose own doc-comment (`:173-178`) says it is _"the ONE writer of `currentFamilyId`, so the flags that describe 'the document we hold for that family' cannot fall out of step with it."_ That covers the family switch AND sign-out, because `reset()` routes through it (`:1469`). `__resetDocClientForTesting` (`:1519-1539`) nulls it, so the existing reset-invariant test keeps its meaning.
   - **No change to `bootstrap.ts`.** The rehydrator calls `docClient.initAndLoadCache`, which sets the value itself. A second writer in another module is the drift this plan exists to remove.
   - Then in `docClient.mergeRemoteEnvelope`'s existing `catch` (`:1281-1290`): on `LocalDocUnreadableError` with `cause === 'worker-holds-no-document'`, **if `cacheProvenEmptyFor === familyId`**, re-issue the merge **once** with an explicit `{kind:'no-local-document'}` and log the substitution; otherwise rethrow untouched.
     - **Bounded, in writing and in code.** A local `let substituted = false`; the re-issue is a single non-recursive `request(...)` and is never itself substituted. It rides the normal `RETRYABLE_METHODS` path, so worst case is two dispatches each with their own one respawn replay — stated here so nobody has to derive it, and pinned by a test that a second refusal rethrows.
     - The replay carries an **explicit instruction**, so `RETRYABLE_METHODS`' rule is honoured rather than bent; the worker's assertion is untouched; and `no-local-document`'s cross-family meaning (`applyAndProject.ts:861-870`) is preserved because main is asserting a fact about **this** `familyId`.
     - **⚠️ WHY NOT THE OBVIOUS SIMPLIFICATION, recorded because the next reviewer will propose it.** The tempting version computes the basis at the call site — `cacheProvenEmptyFor === familyId ? {kind:'no-local-document'} : {kind:'baseline'}`. It is strictly worse: it sends the wholesale-install instruction on **main's belief alone**, so a stale value while the worker genuinely holds this family's document destroys a resident document with no guard, no rebase and no banner — the exact failure the whole commit range exists to stop. Overriding only _after_ a proven `worker-holds-no-document` means main never asserts absence, it only **corroborates** it. Put that paragraph next to the code.
     - A device whose cache was NOT proven empty still refuses and latches, which is correct and now visible: the banner renders and its one button works.

5. **The refusal keeps its meaning — _there is something to lose_ — and gains a true premise.**
6. **Both realms are covered and proven.** In inline mode `applyAndProject` and `docClient` share a realm, the worker never dies, and `initAndLoadCache` still resolves `{loaded}` — so the value behaves identically and the re-issue is a plain second dispatch. Pin it with one case in the existing inline harness (`worker/__tests__/inlineHarness.ts`); "the fix only works in worker mode" is exactly the gap 6773 green tests would not show.

**L3. The cross-family load must not leave a rejected session, and its failure exits must not leave a half-state.**

`familyStore.loadMembers` (**not** `reloadMembers` — no such function exists; `familyStore.ts:351-411`) takes its second branch (`:381`): `currentMemberId` still holds the PREVIOUS family's member, that id is absent from the new roster, `resolveSessionMember` returns `reject`, `rejectSession()` → `authStore.invalidateSession` (`authStore.ts:2272`) sets a sticky `sessionRejected` and calls `finalizeSession()`, and `usePermissions` reports every permission false (deliberately, #80 — `usePermissions.ts:48-54`).

The binding added in `cbb9a123` runs in `SettingsPage.handleDecryptFile` **after** `decryptPendingFile` has already called `reloadAllStores()`, i.e. after the rejection. Pass 2 correction: `authStore.signIn` **does** clear `sessionRejected` (`:809`) and **does** call `familyStore.setCurrentMember` (`:812`), so on the happy path the late binding repairs the state a tick later. What is genuinely broken is:

- **the two failure exits** (`signIn` fails, or `memberIds.length !== 1` — `SettingsPage.vue:810-813` and `:821-822`): both `return` with an error string into a still-open, still-submittable password modal over a **consumed** `pendingEncryptedFile`, so a retry renders "No pending encrypted file" and closing erases the instruction. That is C5, and it is the reachable half of the bug greg reported.
- **a fire-and-forget race**: `invalidateSession` calls `void revokeUnattendedReopen(rejectedFamilyId)` (`authStore.ts:2296`), which awaits two dynamic imports before `clearCachedFamilyKey`. It can land AFTER the subsequent `signIn`, silently revoking trusted auto-open for the family the user just signed into.

Requirements: settle the identity as part of adopting the file's family, BEFORE `reloadAllStores()`, so the rejection never fires; make the two failure exits close the modal and state what happened (C5); and make `revokeUnattendedReopen` awaited (or ordered) so it cannot revoke a session established after it.

### Group 2 — silenced alerts and false telemetry

6. **T1.** `flushQueue` returning `false` must not reset the failure streak. `tryFlush`'s resolve handler (`offlineQueue.ts:309-314`) zeroes `consecutiveFlushFailures` on ANY resolution, so a permanently declined resave (`:157-163`) never advances the streak, `reportFlushFailure` never runs, and `#beanies-errors` never pages for a stuck queue holding unsaved family data.
   - ⚠️ **The fix must not conflate the two falses.** `flushQueue` also returns `false` at `:114` for "nothing to flush", which `tryFlush` can still reach if a sign-out lands inside the auth gate — reporting that as a failure would manufacture false pages. So `flushQueue` returns a **named, exported discriminated result**:

     ```ts
     export type FlushOutcome = 'flushed' | 'nothing-to-flush' | 'declined';
     ```

     `tryFlush` consumes it with a `switch` whose `default` is `assertNever(outcome)` (or the repo's equivalent), so a fourth outcome **fails the build** instead of silently landing in the reset arm — the same discipline this plan applies to C3, applied here too. Resets on `'flushed'`, no-ops on `'nothing-to-flush'`, calls `reportFlushFailure` on `'declined'`. The now-false doc-comment at `:104-111` is rewritten to the new contract.
7. **T2.** `noteWrittenVersion` and `recordPersistedBytes` (`syncService.ts:1923-1924`) move BELOW the `ack?.queued` early return (`:1933-1942`), so a queued write cannot consume the one-shot version memo (`noteWrittenVersion` early-returns on `detail === lastVersionDetail`, `:2396`) or report bytes that never left the device. `familyIdAtWrite` stays the captured value, for the reason `:1917-1922` gives.
8. **T3.** The dev echo destructures a shape that does not exist. `LogRecord` is FLAT with an index signature (`logEvent.ts:56-63`, built by spreading `enrichAndRedact`'s output at `:123-130`); there is no `context` property, so `record.context` is `undefined` and every echoed event prints `{}` (`logQueue.ts:82-88`). Fix: `const { level, surface, message, timestamp, stack, ...ctx } = record`.
   - `import.meta.env?.DEV` becomes a bare `import.meta.env.DEV` **hoisted to one module const**, so Vite's `define` substitutes a literal and esbuild drops the branch from production. ⚠️ The file guards `typeof import.meta === 'undefined'` twice (`:48`, `:54`); confirm that guard is not load-bearing for the echo site (every importer is Vite-bundled, worker included) and state the finding in the commit, rather than silently removing a defence.
   - The same const excludes Vitest. Use **`import.meta.env.VITEST`** rather than `MODE === 'test'`: Vitest sets it, and it cannot be confused with a production build run under `--mode test`. There is no existing test-detection idiom in `src/`, so the const carries a comment saying it is the only sanctioned one and lives in exactly one place — this is a seam that becomes a pattern if it is copied.
9. **T4.** Two call sites pass `'poll terminus'` to `logMergeTerminus`: `syncStore.ts:1621` and `syncService.ts:1740`. `where` is documented as the thing that "separates the buckets for the 50/surface/min limiter, which keys on (surface, message)" (`docClient.ts:1315-1316`), so they currently share a bucket — which defeats the point of adding the third one. Give the new site its own label.
10. **T5.** `checkCanonicalPod` (`syncStore.ts:4318`) sets its latch (`:4337`) above the Drive gate so the provider-mismatch diagnostic can run for every provider, which means **every** local-file and Capacitor family now makes an uncached registry GET (`registryService.ts:74-103`) once per session where it previously made none.
    - ⚠️ Pass-1's T5 as written is self-contradictory: the diagnostic **is** the registry lookup, so "keep the diagnostic and make no network call" cannot both hold. Decide and record it. **Recommendation: keep the lookup, gate it on `navigator.onLine !== false`, and downgrade its cost honestly** — it is one small GET per family per session, it is the only signal that would catch a re-homed family, and the comment at `:4327-4336` is right that moving the gate back above the latch re-opens the "Move to Google Drive" hole.
    - ⚠️ **The gate must go ABOVE the latch assignment, or it is vacuous.** `checkedCanonicalFor = familyId` (`:4337`) latches for the session. An offline check placed _below_ it latches the family as "checked" while offline and the lookup then never runs for the rest of the session — the signal is lost precisely on the devices that most need it later. Order: `if (navigator.onLine === false) return;` **then** the latch, then the lookup.
    - **Write the trade where the latch is.** Both halves — why the latch sits here, and what the request costs — must be readable together at `:4337`, or the cost gets re-litigated by someone who only reads one of them. One sentence beside the existing comment. If greg wants the request gone, the alternative is folding the provider check into the registry write a local family already performs, and that is a separate change, not a gate move.

### Group 3 — false or missing copy

11. **C1.** The restore confirmation must not claim "Nothing is deleted". `settings.switchFileConfirmation` ends with that sentence, and `SettingsPage.runLoadFromFile` passes `variant: hasPod ? 'info' : 'danger'` (`:633-644`). But the same call passes `userChoseThisFile: true`, and `POLICY` (`podLineage.ts:176-177`) maps **`ours-newer × user-file → adopt`** and **`conflict × user-file → adopt`** — wholesale replacement of this device's document, in exactly the flow the feature exists for. The copy states what actually happens on those arms, and the variant becomes **`'danger'` unconditionally**.
    - ⚠️ **Not `hasPod ? 'danger' : 'info'` either.** Nothing available at confirm time knows which `POLICY` arm the load will take — the verdict comes from `compareLineage` on a file that has not been decrypted yet. A variant that is only sometimes honest is worse than one that is always cautious, and every arm of this flow replaces or rewrites the device's document, so `danger` is the truthful answer in all of them.
    - The dialog **title** is hard-coded `settings.switchDataFile` ("Restore your family's data from a file") while the first-load body (`settings.loadFileConfirmation`) says the picked file "**becomes** your data file". Title and body must be chosen by the same `hasPod` predicate that already chooses the body and `keepCurrentPod` — one predicate, three consequences, read in one place.
12. **C2.** The publish failure renders `compactionProgress.failedTitle` ("That did not finish") + `failedSubtitle` ("Your family file has not been changed.") — but at that point the document IS compacted, IS on a new lineage and IS persisted to cache; only the cloud copy is stale (`usePodCompaction.ts:395-396`).
    - ⚠️ **The false sentence is the SUBTITLE, not the title.** "That did not finish" is arguably true of the run as a whole; "Your family file has not been changed" is flatly false and is the sentence that would stop someone re-publishing. Pass 3's `progressErrorTitleKey` would therefore have left the actual lie on screen. Both must be overridable.
    - Mechanism: replace `progressErrorKey` (`usePodCompaction.ts:94`) with **one `progressFailure` object** — `{ titleKey, subtitleKey, helpKey } | null` — so a failure's three pieces of copy are set by one assignment and cannot be set apart. That subsumes Pass 3's `failWith()` pair-setter: with a single object there is no pair to keep in step. All three current setters (`:101`, `:396`, `:444`) write the object; the modal reads `progressFailure?.titleKey ?? …` in three places and its `errorKey` prop becomes `failure`.
    - **Zero new strings.** `compaction.publishFailed` ("The compacted file was not saved to the cloud", `uiStrings.ts:4616-4619`) is orphaned (grep: only `publishFailedHelp` has a consumer) and is exactly the subtitle; `publishFailedHelp` is the help line; the title stays `compactionProgress.failedTitle`.
13. **C3.** `needsAppUpdate` flipping to `false` for `direction === 'older'` (`types/sync.ts:454-455`) broke both other consumers named in that getter's own doc-comment (`:348-353`):
    - `joinCodeForBlocker` (`useJoinFlow.ts:97-105`) falls through to `'FILE_CORRUPT'` — the code that tells a joiner the family's data is damaged and pages Slack.
    - `classifyDriveFailure` (`podAccess.ts:145`) falls through past the typed arm to `'VERIFY_UNAVAILABLE'` — a retryable warning, i.e. endless retry on a file no retry can open.
    - ⚠️ Not "add a fourth `instanceof`". Both consumers are asking the question `payloadErrorKind` already answers exhaustively (`types/sync.ts:521-536`, which has a `'too-old'` arm and a divergence pin forbidding a subclass override). **Both switch to `payloadErrorKind`**, so a seventh kind fails the build at both sites instead of taking a silent default. `needsAppUpdate` keeps its single legitimate reader (the resolver itself) and its doc-comment is corrected.
14. **C4.** An empty `.beanpod` says nothing on the sign-in screen. `loadFromGoogleDrive` correctly stopped writing raw English into `error` (`syncStore.ts:4850-4857`) and returns `{success:false, reason:'error'}`; `LoadPodView`'s handler (`:1034-1040`) has arms for `success`, `needsPassword` and `syncStore.error`, and **no final else**. Add one, reusing `googleDrive.loadError` — the key its own `catch` at `:1045` already uses. No new string.
15. **C5.** The `switchedFamily` failure exits (`SettingsPage.vue:808-822`) must close the decrypt modal and clear the consumed pending file, so a retry cannot overwrite the correct instruction with a false "could not decrypt" and closing cannot erase it. Paired with L3.
16. **C6 — WITHDRAWN, with the reason recorded.** Pass 1 claimed "`refuse()` must open the progress surface before writing to it, or a refusal renders nothing", and that the pinning test must be re-pointed. Verified: the only `refuse()` reachable before `progressOpen.value = true` (`usePodCompaction.ts:158`) is `refuse('not-owner')` at the step-0 gate, and the entire compaction card is `v-if="isFlagEnabled('podCompaction') && canCompactPod"` (`SettingsPage.vue:2295`) with `canCompactPod = isOwner` (`usePodHealth.ts:43`) — so that refusal is unreachable defence-in-depth. Every reachable refusal already runs with the modal open. The existing assertion (`usePodCompaction.test.ts:406`) pins that deliberately, with a stated reason ("a refusal decided BEFORE the confirm must not flash a progress surface at someone who was never asked a question"), and it is correct. **No change.** The refusal is not silent either way: it `logEvent`s at `:102-107`.
17. **C7.** The "still to do" list splits a joined string on `','` (`SettingsPage.vue:887-892`), so a member named "Nana, Mum's side" becomes two people. The fix is a **deletion**: `membersOnOlderVersions` already returns `string[]` of names (`src/services/pod/podSoak.ts:74`), `usePodHealth` exposes it as `olderVersion` (`:73`) and `usePodCompaction` re-exports it (`:466`). Destructure `olderVersion: compactionBehind` from `usePodCompaction()` and delete the computed. ⚠️ `olderVersion` is ALSO destructured from `usePodHealth()` twelve lines below (`SettingsPage.vue:894`) — the alias is required, not cosmetic.

### Group 4 — correctness and hygiene

18. **H1.** `createNewFile` ignores `provider.write`'s return (`syncStore.ts:2650`) and advances to `recordPersistedBytes` and `verifyJustWritten` on bytes that may only be queued — surfacing offline as a confusing `'verify'` failure (`classifyCreateFailure`, `:2444`). Check `ack?.queued === true` and throw at the already-set `step = 'write'`, reusing the existing `'write'` `CreatePodFailureReason` (`types/sync.ts:43`). No new union member, no new copy.
19. **H2 — WITHDRAWN AT IMPLEMENTATION, and the plan's premise was the thing that was wrong.** ⚠️ Pass 4 asserted that "both arms of the branch now call the same `noteRemoteBaseline(...)` with the same arguments" and that the condition only selects a log line. Reading `syncService.ts:1240-1291` before touching it: the arms are NOT identical (the revision-less arm builds its own `remoteBaseline` with `modifiedTime: null, checkedAt: null`, and passes `null` rather than a revision), and there are no log lines in either. Pass 3's remedy was also rejected: if the in-memory baseline is null we do not KNOW the revision, so keying on the provider would either write null anyway or skip the write — and skipping is precisely the bug the long comment there records fixing, which cost local-file families the rebase path entirely. The objection is real and is the FAIL-SAFE direction (one extra read, never a false skip). Kept as-is; the reasoning now lives at `:1228-1238` so a third review round does not re-litigate it. Superseded text follows for the record:

    ~~The fix is a DELETION.~~ `commitRemoteBaseline`'s revision-less branch (`syncService.ts:1228-1229`) keys on the IN-MEMORY value. ⚠️ Pass 3's remedy ("key it on whether the provider can produce a revision") is rejected on reading the code: **both** arms of the branch now call the same `noteRemoteBaseline(...)` with the same arguments — the only thing the condition still selects is which of two log lines is emitted. There is no behavioural fork left to key correctly. Delete the condition, keep the unconditional write, and fold the two log lines into one that carries `hadRevision` in its context. A branch whose arms are identical is not a bug to be re-keyed; it is scaffolding left behind by the fix that removed the fork (`:1256-1268`), and re-keying it would reintroduce a decision the code no longer needs to make.

20. **H3.** `disposePicker` (`drivePicker.ts:32-39`) wraps `setVisible(false)` and `dispose?.()` in ONE `try`, so a throwing `setVisible` skips `dispose` and leaks the picker iframe. Two guarded calls (one tiny local `attempt(label, fn)` used twice — not two copy-pasted try blocks), both still warning to console.
21. **H4.** `formatBytes(0)` returns `"1 KB"` (`CompactionProgressModal.vue:73-77`, `Math.max(1, …)`), so a compaction that saved nothing reports "1 KB smaller". Move the function to `src/utils/format.ts` — whose header says it exists for exactly this ("Add new helpers as inline-avoidance") — and **state the zero contract in the doc-comment, because it is the one behavioural decision in the fix**: `0 ⇒ "0 KB"`, while a non-zero sub-KB value still floors to `"1 KB"` so a 400-byte saving does not render as nothing. Unit-test both. It is the only user-facing byte formatter in the app; `perfTiming.ts:52` and `syncStore.ts:5611` are diagnostic KB integers and are deliberately left alone.
22. **H5.** Two tinted panels use `text-gray-400` (~2.3:1 — an AA failure and a CIG violation): the struck-through before-size on the green stat panel (`CompactionProgressModal.vue:180`) and the `todoFoot` line on the orange panel (`:207`).
    - ⚠️ **Pass-2's remedy was wrong.** `ink-faint`/`ink-soft` are **dark-mode-only** values (`src/style.css:533`, used exclusively under `.dark`), and the `dark:` classes already beside these lines are already correct. The failing classes are the LIGHT-mode ones. The fix is the light-mode value the sibling lines in the same panels already use (`text-gray-500`), contrast-checked against the **tinted** backgrounds — `rgba(39,174,96,0.09)` and `rgba(241,93,34,0.08)` — not against white.
23. **H6.** `encodeBaselinePayload(null, '')` does not round-trip: `decodeBaselinePayload`'s revision-less arm reads `typeof h === 'string' && h !== '' ? h : null` (`remoteBaseline.ts:221`) while the revision arm reads `typeof h === 'string' ? h : null` (`:224`), and `decodeHeadsFingerprint('')` deliberately answers `[]` ("a document with no heads is a real, empty answer"). The two arms share **one** `headsFpOf(h)` helper so they cannot disagree again.
24. **H7.** `BLOCKER_BANNER_KIND['podMerge.failedInline'] = 'decrypt'` with a long, correct justification (`syncStore.ts:222-232`: a `RemoteMergeError` that latches is an actor-collision bug, not a compaction, and lineage copy would tell the user a false story and offer a data-destroying remedy) — while `BLOCKER_OVERLAY_KEY['podMerge.failedInline'] = 'resumeSetup.podLineageBlocked'` (`payloadFailureSurface.ts:286`) tells the user exactly that story full-screen. ⚠️ Pass-1's "the two tables must agree" is imprecise: they are different key spaces (banner kind vs UI string) and cannot be literally equal. The requirement is that the **overlay copy must not contradict the banner's classification** — point it at the generic corrupt/blocked copy, and carry the banner table's reasoning into a comment there so the next editor cannot re-diverge.

### Group 5 — DRY (assessed, with verdicts)

25. **`LocalDocUnreadableBanner` vs `LineageBanner` — FIX, but do not merge the components, and extract TWO files, not three.** `LocalDocUnreadableBanner`'s own header explains why it is a separate component and the reason is good (the house pattern is one thin `ErrorBanner` wrapper per condition). What is genuinely duplicated is **behaviour**, verbatim: `useTheFamilyFile()` is the same busy-guard → `confirm` → `useRemoteFileOverLocalDocument` → toast → `catch` → `finally` in both files with only two message keys differing (`LineageBanner.vue:73-106`, `LocalDocUnreadableBanner.vue:63-89`), plus the identical `dismissed`/`blocked`/`watch` re-arm block and three identical Tailwind class strings on the action buttons.
    - ⚠️ **ONE composable, not two.** Pass 2 proposed `useAdoptRemoteFile` _and_ `useBlockerBanner`. Verified: these two components are the **only** two in the repo that carry `dismissed` (`DurabilityBanner`, `PodAccessBanner`, `OfflineBanner`, `ReviewDemoBanner` do not) and the **only** two that call `useRemoteFileOverLocalDocument`. So the second composable's consumer set is exactly the first's, and its output is only ever read alongside the first's (`:show="blocked && !dismissed"`, `:disabled="busy"`). Two composables where the second is only ever used by the first's consumers costs a file and buys nothing. Extract one:

      ```ts
      useBlockerBanner({ kind, confirmTitleKey, confirmMessageKey })
        → { blocked, dismissed, busy, useTheFamilyFile }
      ```

      The `watch(blocked, …)` re-arm then lives in the same file as the `blocked` it watches, and the `catch` keeps the comment both files carry explaining why a bare `finally` is not enough (the latch clears before the download, so a silent throw leaves the user believing it worked).

    - `BannerActionButton` for the shared chrome, in **`src/components/common/`** beside `ErrorBanner` — not `src/components/ui/`. Every banner in this family lives in `common/`; a shared child in another directory splits one feature across two trees. It carries `:aria-busy`, which `LineageBanner`'s export button (`:114-122`) is currently missing — the extraction must close that drift, not preserve it.
    - Both components stay, each still readable in one screen, and a future third condition (`PodAccessBanner` already carries the same `catch` for the same reason) gets the behaviour for free.
26. **`CompactionProgressModal` vs `SetupProgressModal` — DEFER, with the reason recorded.** Verified: the step LISTS are genuinely different (5 per-step statuses with gradient badges, an animated check SVG and per-step active/done copy, vs 4 index-derived steps with emoji glyphs), and unifying them would produce exactly the "decision nested inside a decision" the banner comment warns about. The only real duplication is the **bar**, which has already drifted on three attributes — `bg-[rgba(44,62,80,0.05)]` vs `0.06`, `duration-600` vs `duration-500`, and the `progress-shimmer` class present on one only. A shared `ProgressBar` is the right eventual answer, but there are **14** files in `src/components/` carrying a track+fill with different semantics (goal progress, budget, list cycles), so doing it for two of them now is the worse half of the refactor. Recorded as a follow-up; the drift note added to **both** files must **name the three attributes and which file is authoritative**, or it ages into "there is drift somewhere".
27. **Orphaned `compaction.*` keys — the sweep found FIVE, and each needs a verdict.** `compaction.publishFailed` is consumed by C2. The other four (`compaction.backupFailed`, `compaction.rebuildFailed`, `compaction.pullFailed`, `compaction.confirmBody2` — confirm the exact set by grepping each key in `src/` before landing) are the copy the toast era wrote and the modal era never wired. Each gets one of two verdicts **in this commit**, recorded in the commit message: wired into `progressFailure` as the subtitle for the step that raises it, or deleted from `uiStrings.ts` **and** `public/translations/zh.json` together. Leaving them is how the next feature "reuses" a string that describes a surface that no longer exists.

## Important Notes & Caveats

- **Do not solve L1 by widening the error-class test.** That is the same inference with more arms, and it is what produced two wrong answers already. The layer that knows says so.
- **Do not put residency in the worker.** `docClient.ts:552-559` forbids it by name, and a respawn makes `'lost'` and `'never-loaded'` indistinguishable there — which is precisely the distinction the fix needs. Main is per-family and survives the realm.
- **The error carries a LOSS VERDICT, not a stage and not a residency measurement.** `stage` is constant per code path, so branching on it cannot separate a cold boot from an open failure over a resident document — the one distinction L1(a) turns on. `docResident` is the wrong question at the open-stage throw, where the resident document may belong to a DIFFERENT family. `loss` is coarser than both on purpose: _is anything of ours at risk here_, computed by one helper called at both throw sites.
- **`loss` must consult the CACHE, not only `currentDoc`.** The load stage is reached only because `initPersistenceDB` succeeded, so the cache DB is open and holds unread `inc:*` rows. `dropDoc()` clears memory; it does not make those rows worthless. A wholesale install over them leaves `lastPersistedHeads` null and the next persist deletes them. This is a data-loss path and it is the reason `cache.isCacheReady()` is in the expression.
- ~~**Exactly one matrix cell changes.**~~ ⚠️ **THIS CRITERION WAS WRONG, and the final review is what proved it.** Pass 4's model of the code had `cache.isCacheReady()` answering "does the cache hold anything". It answers "is a DB HANDLE open" — and at the load stage those come apart in the worst direction, because `clearCache` CLOSES the handle before deleting. A delete blocked by another tab (the normal state after a two-session soak) therefore left every `inc:*` row on disk with the handle null, and one shared expression read that as `nothing-to-lose`: a wholesale install over rows the next persist would delete. As shipped, the two throw sites answer their own question — the open stage asks about `currentDoc`, the load stage asks whether the reseed actually DELETED the database — and **two** cells move, both toward the answer the `PayloadLoadError` arm has always given. The cell that must never move (a load-stage failure whose reseed was blocked) still refuses, and has its own test.
- **`cacheProvenEmptyFor` records the LAST answer, not "ever".** A monotone "was a document ever installed here" reads true from a previous session on the exact device L2 describes, and the substitution never fires. Any install clears it; a `{loaded:false}` rehydrate sets it. One writer per direction, read in exactly ONE place — assert the single read site in a test, so a second reader has to argue for itself.
- **Main never asserts absence; it only corroborates the worker's.** The substitution fires only after a proven `worker-holds-no-document`. Pre-computing the basis from main's belief would destroy a resident document on a stale-false value — the exact failure this range exists to stop.
- **The substitution is bounded to one, and never recursive.** `mergeRemoteEnvelope` already has a transparent respawn replay; a second unbounded re-issue in the same catch would multiply.
- **`no-local-document` must keep its cross-family meaning.** Three store sites send it because the worker may hold a DIFFERENT family's document (`applyAndProject.ts:861-870` records the corruption that resulted from deriving it). The install instruction is a separate fact from what main has recorded and must not be replaced by it — which is why L1's item 4 has main **re-state the instruction**, not the worker re-derive it.
- **A rejection can only carry data through `ERROR_REGISTRY`.** Any plan that says "returns X on the rethrow path" without a codec entry ships a field that arrives as `undefined` on main, typed by a lying declaration — the exact failure `ExportedPayload` (`protocol.ts:34-39`) was created to prevent.
- **`PayloadLoadError` must not be wrapped.** `syncStore.ts:1166` and four other sites dispatch on it; the OOM rethrow is the one that protects a device that cannot allocate.
- **The refusal must never reach a surface where it cannot be dismissed.** L1(a) is exactly that. `FatalErrorOverlay` is `fixed inset-0 z-[300]` with Reload as its only action for this class; the classification fix is what makes Reload actually resolve it.
- **`latches: true` is still correct for a genuine loss** — retrying inside the session cannot conjure the document back. What was wrong is which cases reach it.
- **C3 is not "add a fourth `instanceof`".** Route both consumers through the existing exhaustive `payloadErrorKind`.
- **T1's outcome union gets an exhaustive consumer**, for the same reason C3 does: a fourth outcome must fail the build, not land silently in the reset arm.
- **H2's branch has two identical arms.** The fork it used to select was already removed (`:1256-1268`); what is left selects a log line. Delete the condition rather than re-keying it — re-keying reintroduces a decision the code no longer makes, and a naive `return` reinstates yesterday's fail-unsafe stale row.
- **C2's lie is the subtitle.** One `progressFailure` object, not a title ref beside a body ref — with a single object there is no pair to keep in step, which is why this subsumes rather than extends Pass 3's `failWith()`.
- **T5's offline gate goes above the latch.** Below it, the family latches as "checked" while offline and the lookup never runs again that session.
- **C1's variant is `danger` in every arm.** Nothing at confirm time knows which `POLICY` arm the load will take; a sometimes-honest variant is worse than an always-cautious one.
- **Nothing added by this plan may fail silently.** Every new arm either surfaces to the user with an action, or logs with a developer-facing next step: the `CacheInitError` throw already routes through `raiseCachePersistFailure('open', …)`; the `docClient` re-issue logs the substitution with the family id; T1's `'declined'` arm reports and pages at threshold; H3's two attempts each warn; C4's else arm speaks. A `catch {}` with no console line is not acceptable anywhere in this change set.
- **Reuse before writing.** Every user-facing string in this plan already exists (`compaction.publishFailed`, `googleDrive.loadError`, `settings.loadFileConfirmation`, `resumeSetup.podLocalUnreadable`) except the C1 rewrite and the C2 body, which need `zh.json` entries by hand — machine translation reads "beanies" as headwear, as three commits today record.
- **One test-detection idiom, in one place.** `import.meta.env.VITEST` appears exactly once in `src/`, in T3's module const, with a comment saying so. This is the kind of seam that becomes a pattern the moment it is copied.
- Every fix needs a test that would have caught it, and every new guard must be mutation-checked with the mutation verified to fail for the right reason.

## Assumptions

1. `podCompaction` stays `true` in `featureFlags.committed.ts`; nothing here changes the flag.
2. `APP_VERSION` is still `0.16`; the bump to `0.17` is part of the release, not this plan.
3. greg's dev family may still be the contaminated one the tier-3 plan flagged; acceptance runs should start from a reset family.
4. The offline-queue fix greg confirmed working stays as designed — T1 changes only the ALERTING around a declined flush, never the flush semantics.
5. Every importer of `logQueue.ts` is Vite-bundled (main and worker), so a bare `import.meta.env.DEV` cannot hit the `typeof import.meta === 'undefined'` case that file guards elsewhere. Verify before landing T3; if it is not true, keep the optional chain and accept the dead branch in production.
6. `withTimeout` has no caller today that depends on the timeout error's `name` being `'Error'`. Its new fourth parameter is optional and defaults to current behaviour, so this is a widening, not a change — verify by grepping its call sites before landing L1(2).

## Approach

### Step 1 — the fact and its carrier (L1 + L2), the structural core

Four small, independently testable pieces, none of them new state in the worker and none of them a mirror of it:

1. **`utils/timing.ts` + `cache.ts`**: optional `errorName` on `withTimeout`; `'CacheOpenTimeoutError'` at the cache-open site. Nothing else changes.
2. **`protocol.ts`**: `CacheInitStage`, `CacheInitLoss`, `CacheInitError`, and one `ERROR_REGISTRY` entry. **`applyAndProject`**: the `cacheInitLoss()` helper beside `currentDoc`, and `CacheInitError(stage, cacheInitLoss(), name)` at the two non-payload throw sites in `initAndLoadCache` (`:567-577` and the load-stage catch at `:610-620`). `docClient`: no wrapper change — the class reconstructs by itself.
3. **`syncStore.replaceDocWithCacheRecovery`**: the classification at `:1183` reads `CACHE_INIT_LOSS[e.loss]`; `cacheErrorName` reads `e.cause`. The three-arm `pod-open-degrade` event keeps its shape and gains both `loss` and `stage` in `detail`.
4. **`docClient`**: `cacheProvenEmptyFor` beside `currentFamilyId`, set on a `{loaded:false}` rehydrate, cleared on every install and in `setCurrentFamily`, nulled in `__resetDocClientForTesting`; plus the single bounded re-issue inside the existing `mergeRemoteEnvelope` catch.

`applyAndProject.mergeRemoteEnvelope` is **not modified**. Its assertion, its comment block at `:903-935` and its `no-local-document` contract stand exactly as written. `bootstrap.ts` is **not modified** — the rehydrator learns the fact through `docClient.initAndLoadCache`.

**Commit boundary:** this is its own commit and must be independently revertable.

### Step 2 — L3 + C5, identity before roster

Settle the member binding as part of adopting the file's family, BEFORE `reloadAllStores()`, so `loadMembers` never sees a stale id over a new roster. Where the identity cannot be settled (several members share the password, or none was reported), refuse the switch, say so, and close the modal — the pending file is consumed either way. Make `revokeUnattendedReopen` ordered so it cannot revoke a session established after it.

### Step 3 — sync correctness (H1, H2) and telemetry (T1-T5)

H1 and H2 ride with the sync work, not with the UI hygiene: they are save-path correctness changes, and bundling them with a component refactor means a revert of the refactor also reverts a fail-unsafe baseline fix. Telemetry follows as its own commit.

### Step 4 — copy (C1-C5, C7)

Grouped into one commit so a copy revert does not take a telemetry or sync fix with it. C6 is withdrawn with its reason recorded here.

### Step 5 — UI hygiene (H3-H7) and the Group 5 DRY work

The one banner composable and `BannerActionButton` (item 25) land here; the progress-bar extraction is deferred with its reason and its three drifted attributes recorded in item 26.

## Files Affected

- `src/utils/timing.ts` — optional `errorName` on `withTimeout` (default unchanged)
- `src/services/automerge/worker/cache.ts` — name the cache-open deadline at the one site that knows it is one
- `src/services/automerge/worker/applyAndProject.ts` — the `cacheInitLoss()` helper + `CacheInitError` at the two throw sites (the refusal itself is untouched)
- `src/services/automerge/worker/protocol.ts` — `CacheInitStage`/`CacheInitLoss`/`CacheInitError` + one `ERROR_REGISTRY` entry
- `src/services/automerge/worker/docClient.ts` — `cacheProvenEmptyFor`, its set/clear sites, the single bounded merge re-issue, the test-reset null
- `src/stores/syncStore.ts` — classification + `CACHE_INIT_LOSS`, `createNewFile`, `checkCanonicalPod` (offline gate above the latch), the terminus label
- `src/stores/familyStore.ts` / `src/stores/authStore.ts` — the stale binding + the revoke ordering (Step 2)
- `src/services/sync/syncService.ts` — `ack.queued` ordering, `commitRemoteBaseline` (branch deleted), the terminus label
- `src/services/sync/offlineQueue.ts` — the exported `FlushOutcome` + the streak
- `src/services/sync/remoteBaseline.ts` — the shared `headsFpOf` arm
- `src/services/telemetry/logQueue.ts` — the dev echo + the one test-detection const
- `src/services/google/drivePicker.ts` — teardown ordering
- `src/composables/useJoinFlow.ts`, `src/utils/podAccess.ts`, `src/types/sync.ts` — both consumers onto `payloadErrorKind`
- `src/composables/usePodCompaction.ts` — `progressFailure` replacing `progressErrorKey`, and the orphan-key verdicts
- `src/composables/useBlockerBanner.ts` (new), `src/components/common/BannerActionButton.vue` (new), `src/components/common/LineageBanner.vue`, `src/components/common/LocalDocUnreadableBanner.vue`
- `src/utils/format.ts` — `formatBytes`, with the zero contract in its doc-comment
- `src/components/settings/CompactionProgressModal.vue` — publish copy, light-mode contrast, the moved formatter, the item-26 drift note
- `src/components/onboarding/SetupProgressModal.vue` — the item-26 drift note only
- `src/pages/SettingsPage.vue` — confirm copy/variant/title, the `behind` binding (a deletion, aliased), the switched-family exits
- `src/components/login/LoadPodView.vue` — the empty-file fallback arm
- `src/utils/payloadFailureSurface.ts` — the `podMerge.failedInline` overlay copy
- `src/services/translation/uiStrings.ts` + `public/translations/zh.json` — C1 and C2 only
- Tests for each of the above

**Deliberately NOT changed:** `src/services/automerge/worker/bootstrap.ts` (a second writer of the docClient fact), `src/services/pod/podSoak.ts` (C7 is a deletion at the consumer).

## Observability Coverage

- **The cache-init failure** rides the existing `pod-open-degrade` event: `error_code` becomes a real failure code (`CacheInitError.cause`, including the newly-named `CacheOpenTimeoutError`) and `detail` carries the stage and the resulting verdict, so a refusal and a wholesale install are separable in CloudWatch. `docClient`'s merge re-issue emits its own `pod-lineage` line naming the family, so "main corroborated the worker's refusal and re-stated the instruction" is countable rather than invisible.
- **T1** restores the `offline-queue-flush` failure path and its `critical` page at threshold — the alert this whole module exists to raise — and the new `'nothing-to-flush'` arm guarantees it cannot fire falsely.
- **T2** restores the version-transition memo to the moment the write actually lands.
- **T3** makes every event legible locally, which is the only environment a sync bug can be reproduced in.
- **T4** gives the new terminus its own label so it stops sharing a `(surface, message)` limiter bucket.
- **T5** keeps the provider-mismatch diagnostic and records its cost explicitly, beside the latch, rather than removing the signal.
- **No new `ALLOWED_CONTEXT_KEYS` entry is needed** — `error_code` (`diagnosticContext.ts:69`) and `detail` (`:188`) are both allowlisted. If one proves necessary it must be added to the allowlist, its Lambda mirror, and the store data-collection declarations.

## Acceptance Criteria

- [ ] Cold boot with a second tab open completes a remote-only open — no fatal overlay, no latch — and the firehose names the failure `CacheOpenTimeoutError`, not `Error`.
- [ ] A worker whose rehydrate resolved empty installs the remote on the next poll instead of latching, and the substitution is in the firehose.
- [ ] The substitution fires at most once per call: a second `worker-holds-no-document` from the re-issued merge rethrows.
- [ ] A cache read that failed at the OPEN stage while a document IS resident still refuses, with the banner reachable and its button working.
- [ ] A corrupt cache (worker already dropped + wiped) still adopts, and is not told its work is safe.
- [ ] A `loadCachedDoc` rejection that is NOT a `PayloadLoadError`, over a cache DB that opened successfully, still REFUSES — the unread `inc:*` rows are the thing being protected, and a test pins that this cell did not move.
- [ ] Exactly one cell of the classification matrix changed verdict versus `main`; a table-driven test enumerates all of them.
- [ ] `cacheProvenEmptyFor` is set by a `{loaded:false}` rehydrate, cleared by every install and by a family switch, and is read in exactly one place.
- [ ] A device that installed a document in a PREVIOUS session and whose rehydrate now resolves empty still gets the substitution (the monotone-flag regression is pinned).
- [ ] The fix behaves identically on the inline executor path (worker flagged off / spawn failure).
- [ ] Loading another family's pod leaves a working app — sidebar and permissions present — or refuses with a clear message, a closed modal and no half-state.
- [ ] A permanently declining flush advances the streak and pages at threshold; a "nothing to flush" resolution does neither; a hypothetical fourth `FlushOutcome` fails type-check.
- [ ] A queued write emits no version-transition event and no persisted-bytes signal, and a queued create fails as `'write'`, not `'verify'`.
- [ ] The dev echo prints real context fields, and does not fire in Vitest or ship to production.
- [ ] The restore confirm states what actually happens, is `danger` in every arm, and its title matches its body.
- [ ] The publish failure does not claim the file is unchanged — the SUBTITLE is the sentence that changed — and no site can set one piece of failure copy without the other two.
- [ ] `commitRemoteBaseline` writes unconditionally; the deleted branch left no behavioural change, only one merged log line carrying `hadRevision`.
- [ ] `checkCanonicalPod` makes no registry request while offline AND does not latch, so the check still runs later in the session.
- [ ] Every orphaned `compaction.*` key is either wired or deleted from `uiStrings.ts` and `zh.json` together; none is left unreferenced.
- [ ] A pre-4.0 file classifies correctly in both `payloadErrorKind` consumers.
- [ ] "Nana, Mum's side" appears as one person in the compaction to-do list.
- [ ] Both tinted panels pass AA in LIGHT mode against their tinted backgrounds, and dark mode is unchanged.
- [ ] `formatBytes(0)` is `"0 KB"` and `formatBytes(400)` is `"1 KB"`.
- [ ] Every finding above is fixed or explicitly deferred with a reason recorded in this plan (C6 withdrawn, item 26 deferred).
- [ ] Each fix has a test that would have caught it; every new guard mutation-checked, each mutation failing for the right reason.
- [ ] No new `catch` in this change set is silent; each has a user-facing message, a console line naming the developer next step, or both.
- [ ] Gates: type-check, ESLint, stylelint, build, full suite.

## Testing Plan

1. Unit: `CacheInitError`'s codec round-trip through `serializeError`/`reconstructError` — `stage`, `loss` and `cause` all survive, and `PayloadLoadError` still reconstructs to its own class.
2. Unit: the FULL classification matrix as a table — `{open,load} × {loss verdict} × {PayloadLoadError, unknown} × chosenByUser` — over `replaceDocWithCacheRecovery`, driven off `CACHE_INIT_LOSS` so a third `CacheInitLoss` member fails the build. The table doubles as the "exactly one cell moved" record.
3. Unit: `cacheInitLoss()` itself — `currentDoc` set / cache ready / both null — including the load-stage case where `dropDoc()` has run but `isCacheReady()` is still true, which must answer `'something-to-lose'`.
4. Unit: `withTimeout`'s new `errorName` (default unchanged; named at the cache-open site), and that `raiseCachePersistFailure` receives the real code.
5. Worker/client integration: a rehydrate that resolves empty followed by a poll merge — the worker refuses, `docClient` re-issues once with `no-local-document`, the merge installs, nothing latches. Negatives: (a) a family whose `cacheProvenEmptyFor` does NOT match rethrows untouched; (b) a second refusal from the re-issued merge rethrows rather than looping.
6. Unit: `cacheProvenEmptyFor` lifecycle — set on `initAndLoadCache({loaded:false})`; cleared by `initAndLoadCache({loaded:true})`, `initDoc`, `loadSnapshot`, an `adopted` merge, a family switch, `reset()`, and `__resetDocClientForTesting`. Explicitly: install-then-empty-rehydrate still substitutes.
7. Inline-realm case in `worker/__tests__/inlineHarness.ts`: the same refuse-then-re-issue sequence with the worker forced off.
8. Mounted: the refusal banner renders and its action resolves; the two banners still behave identically after the single-composable extraction.
9. Unit: `flushQueue`'s three outcomes and the streak/paging behaviour of each.
10. Unit: `formatBytes(0)` / `formatBytes(400)`, `encodeBaselinePayload(null, '')` round-trip, `payloadErrorKind` at both new consumers, `commitRemoteBaseline` writing on both former arms, and `checkCanonicalPod` offline (no request, no latch).
11. Mutation checks for every new guard.
12. Two-browser soak, from a reset dev family: the offline-edit drill both directions.
13. The cross-family load, and the restore drill on Chromium and Firefox.
14. A cold boot with a second tab open — the L1(a) case, which is the one that stranded a user.

## Review Passes

- **Pass 1 (Initial draft)**: Grouped the fifteen findings by consequence, and merged L1/L2 into a single residency fix on the principle that both are main inferring a fact the worker holds.
- **Pass 2 (DRY + error handling)**: Verified every citation against the code — moved residency out of the worker (single `currentDoc`, and `RETRYABLE_METHODS` forbids rehydrate-mutable state) onto `docClient`, carried the fact on ONE registered typed error instead of two mechanisms, withdrew C6 as unreachable, split T1's two `false`s so alerting cannot fire falsely, routed C3 through the existing exhaustive `payloadErrorKind`, and replaced three rewrites with reuse or deletion.
- **Pass 3 (Sustainability)**: Removed the second source of truth — the error now carries `stage` (a property of which code ran) instead of a measured `docResident` that duplicated it and lied across families; made main's record a family-keyed monotone value with ONE writer on the seam that already exists for it (`setCurrentFamily`), dropping the `bootstrap.ts` second writer entirely; bounded the merge re-issue against the retry it already has and recorded why the "simpler" pre-computed basis is unsafe; collapsed the banner extraction from three new files to two; corrected H5's remedy (`ink-*` are dark-mode-only) and H4's zero contract; made T1's union exhaustively consumed; and split the sync-correctness fixes out of the UI hygiene commit.
- **Pass 4 (Fresh-eyes sweep)**: Replaced the `stage` carrier with a `CacheInitLoss` verdict computed by one worker-side helper — `stage` is constant per code path and so could not separate the cold boot from a resident-document failure, which is the case L1 exists for; caught that Pass 3's `load ⇒ adopt` arm was a NEW data-loss path (the cache DB is open and holds unread `inc:*` rows that a wholesale install would strand); pinned that exactly one matrix cell changes; replaced the monotone `installedDocForFamily` with `cacheProvenEmptyFor` after finding the monotone version made L2 vacuous on its own case; found C2's false sentence is the subtitle and collapsed the copy into one `progressFailure` object; moved T5's offline gate above the latch; reduced H2 to a deletion (both arms are already identical); made C1's variant unconditionally `danger`; and widened the orphan-key sweep from one key to five with a verdict required for each.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt (this plan)

> go ahead to prepare the plan to fix all identified issues. once the plan is written, proceed to implement the plan. once the implementation is done, run a final code review against all implemented code to ensure it was implemented accurately and as designed against the plan and works as expected, tests are valid, and does not introduce any new bugs, side effects or security issues. fix all issues found.

### Preceding context

> i'm still actually seeing that when i load another family's data file, it loads a crippled pod (no sidebar, no permissions) - perhaps something went wrong in the implementaiton?
>
> given we've performed a bunch of fixes in these last few sessions, would you propose to run anotehr code review over those to find these and other issues?

### Pass 2 review prompt (verbatim)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code.
>
> Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later.
>
> Ensure that there are never any silent failures. Everything with the potential to fail should be handled gracefully (i.e. a try/catch block or something similar as appropriate). Users should be shown informative error message, with direction for developers as well either in the error modal itself or on the console. Nothing should ever fail silently, and guidance on how to fix the error should always be available.
>
> Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Pass 4 review prompt (verbatim)

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.

### Pass 3 review prompt (verbatim)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

</details>
