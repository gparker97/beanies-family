# Review: the cache open that never returned, and the refusal that had nowhere to render

> Date: 2026-09-07
> Commits reviewed: `cd7d3dd7` (Group A), `564b0662` (Group B)
> Plan: `docs/plans/2026-09-07-cache-open-hang-and-unrenderable-refusal.md`
> Reviewer: independent code review, against the working tree at `564b0662`

**Verdict: nothing found that must be fixed before this ships.** Both commits implement
their requirements, the gate is green, and every mutation I ran against the new tests
failed them. Six findings, all Low or Medium-low, listed below. Group C was correctly
left out and is not counted against either commit.

---

## Plan conformance

### Group A — commit `cd7d3dd7`

| Req | Status                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | **MET**               | `cache.ts:100` `export const CACHE_OPEN_TIMEOUT_MS = 10_000` with the four-part rationale comment (`:83-99`) naming `READY_TIMEOUT_MS` and `HEAVY_RPC_TIMEOUT_MS`. `cache.ts:127` hoists `opening`; `:137-141` wraps it in the shared `withTimeout` from `@/utils/timing` (`:26`) with the exact required message; `:148` closes a late arrival; `:156-158` assigns only on success. No new timeout helper; `withIdbRetry` untouched. No `blocked`/`blocking` callback — the `openDB` options carry `upgrade` only (`:127-133`).                                                                                                                                                      |
| A1b | **MET**               | No new error class anywhere in the diff; `ERROR_REGISTRY` (`protocol.ts`) untouched. A1's rejection is a plain `Error`, and A3b's detail discriminates on `kind` (`applyAndProject.ts:327` uses the `'DeleteBlocked'` sentinel, not `e.name`).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A2  | **MET**               | `protocol.ts:181-183` `CacheClearResult`, declared beside `CachePersistFailureDetail` with the "an object, not a bare boolean" rationale (`:174-180`). `cache.ts:499` returns `Promise<CacheClearResult>`; `:519` `onblocked → resolve({ deleted: false })`, still resolving so sign-out cannot fail. `applyAndProject.ts:1221-1224` facade returns it; `:1469` dispatch returns `{ result: await clearCache(...) }`. `docClient.clearCache` stays `Promise<void>` (`:1460`) and tests `result?.deleted === false` (`:1465`), emitting one `warn` `logEvent` (`:1466-1473`). `database.ts` is not in the diff. `initAndLoadCache.oom.test.ts:33` mock updated to `{ deleted: true }`. |
| A3  | **MET**               | `applyAndProject.ts:320-337` `reseedCacheAfterCorruption`, with the "NEVER THROWS" contract and the hang explanation on the function. Call site is one flat line inside the existing `if` (`:606`), and `throw e` (`:608`) still carries the original classification. Reads the flag as `!result?.deleted` (`:326`), never by destructuring. Nesting is one level, not four. The OOM denylist condition at `:605` is untouched.                                                                                                                                                                                                                                                       |
| A3b | **MET**               | `applyAndProject.ts:299-305` `raiseCachePersistFailure` sets the worker-local flag then the sink, in that order, with the `markPersistOk()` rationale on it. `persistOnce`'s catch (`:445`) now routes through it; the `console.error` beneath survives. `protocol.ts:169` widens `kind` to include `'open'`; `protocol.ts:156-168` and `diagnosticContext.ts:158-163` comments rewritten. No new banner/component/store state/context key/surface.                                                                                                                                                                                                                                   |
| A4  | **MET**               | `initAndLoadCache` is absent from `RETRYABLE_METHODS`, replaced by an 11-line comment (`docClient.ts:529-539`) covering both `handleRpcTimeout` branches and the allowlist's own failure-direction argument. Consequence 1 (the rehydrator still runs) is stated; the rehydrator is intact at `bootstrap.ts:31`. Consequence 2 (the liveness-false-positive branch) is stated.                                                                                                                                                                                                                                                                                                        |
| A6  | **MET**               | `syncStore.ts:914` declares `cacheErrorName`, `:938` sets it right after the existing `console.warn` (`:939`, kept), and the single `logEvent` sits after the try/catch and before the `basis` (`:946-959`), firing on both arms with `error_code` `'hit'` / the error name / `'miss'`.                                                                                                                                                                                                                                                                                                                                                                                               |
| A7  | **MET**               | `docClient.ts:361-377` `reportRehydrateFailure`, one shared function, called from `enterInlineMode` (`:355`) and `spawn` (`:426`); each keeps its `console.error` (now inside the helper, `:369`). `surface: 'doc-worker-recovery'`, `severity: 'warning'`, `context: { action: 'rehydrate-failed', recovery_method: where }` — all allowlisted keys.                                                                                                                                                                                                                                                                                                                                 |
| A5  | **PARTIAL (by test)** | Production code correctly unchanged, as required. But the plan's whole content for A5 was "pin it with a test", and no `syncStore` cache-recovery test was added. See Test honesty.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| —   | **NOT MET**           | Acceptance criterion "A9 and A10 markers exist **at the code**". No A9 comment above `docClient.ts:869`; `src/services/indexeddb/database.ts` is not in the commit at all, so no A10 comment beside `:90-93`. `bootstrap.ts:38-42`'s stale comment (the third of the three) **was** fixed.                                                                                                                                                                                                                                                                                                                                                                                            |

### Group B — commit `564b0662`

| Req | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1a | **MET**     | `SettingsPage.vue:1915-1917`, one slab, at 8-space indentation, as the last child of the `supportsAutoSync` div (which closes at `:1918`) — after the configured `v-else` closes at `:1905`. Markup is the dead branch's (`:1959-1961`) plus `mt-4`. `importSuccess` was not moved or duplicated. Both sub-states covered from one site; **proved by mounting with `isConfigured: false` and mutating the slab away** (2 tests fail).                                                                                                                                                                                                                                       |
| B3  | **MET**     | `syncService.ts:2140` blocker arm is now `updateState({ isSyncing: false, lastError: null })`, with the `isSyncing`/`lastError: null` rationale inline (`:2136-2139`). The `reportError({surface:'pod-load-failure'})` below it survives. The JSDoc at `:2113-2133` is fully rewritten and states the new contract ("a `payloadError` arm must come BEFORE the `syncStore.error` arm"). `LoadPodView.vue:519-533` extracts exactly the shared failure tail and both call sites use it (`:549`, `:754`); the drop path gains the `payloadError` arm it lacked. `openFileVersion.test.ts:103-124` rewritten to pin the separation, with the two siblings untouched and green. |
| B4  | **MET**     | `fileSync.ts:138-143` in the required order — absent/null first, then "not a known string" → `UnsupportedBeanpodVersionError(String(obj.version))`. The four-line comment at `:125-137` is rewritten and explicitly records the `String(6.0) === '6'` fact. No re-clamp at the call site; the constructor's clamp (`types/sync.ts:402`) does it. `version=6` is pinned in `openFileVersion.test.ts:135`.                                                                                                                                                                                                                                                                    |
| —   | **NOT MET** | Acceptance criterion B6: `docs/plans/2026-09-07-native-update-gate.md:422` (manual criterion 12) is unchanged. See finding F2 — this one has a real cost, because it misdirects the manual test greg is about to run.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Note on commit hygiene: `CHANGELOG.md` is not in either commit, but the working tree
carries a correct, human-readable entry for both fixes under `## 2026-09-07`. Worth
committing before the release, not a defect in the code.

---

## Findings

### F1 — Medium-low. The _first_ cache open can fail silently; only the _re-seed_ raises the durability signal

**Where:** `src/services/automerge/worker/applyAndProject.ts:566` (and `:550` `openCache`,
`:267` `loadProjectionSnapshot`) versus `:327` / `:334`.

A3b exists because "skipping the re-open must not create a silent durability hole":
with no open DB, `persistOnce` hits `if (!currentDoc || !familyKey || !cache.isCacheReady()) return;`
(`applyAndProject.ts:396`, and the snapshot twin at `:223`) and persists nothing for the
rest of the session. That reasoning is implemented — but only for the re-seed path.
The _opening_ `await cache.initPersistenceDB(id)` at `:566`, which A1 has just made
capable of rejecting, has no such treatment. `raiseCachePersistFailure` has exactly two
call sites (`:327`, `:334`, `:445`) and none of them covers it.

**Failure scenario.** Two tabs of the app are open; a `deleteDatabase` from a prior
sign-out is queued. The user opens beanies. `initPersistenceDB` at `:566` rejects at
10 s. `syncStore.replaceDocWithCacheRecovery` catches (`syncStore.ts:938`), adopts the
remote wholesale, and the app loads — good, that is the fix working. But
`cache.isCacheReady()` stays false for the whole session, so nothing is written to the
local cache, no `DurabilityBanner` appears, and every subsequent cold open pays another
10 s plus a full remote download. The identical state that A3b decided was worth a
banner produces no banner here.

**Why it is not a ship-blocker.** It is not a regression — today that call hangs
forever. It is not telemetry-dark either: `surface()` firehoses the rejection at
`doc-worker`, `doc-worker-recovery` reports the teardown, and the new `pod-open-degrade`
`warn` (`syncStore.ts:946`) counts the outcome. Only the user-visible banner is missing,
and the durable copy (the `.beanpod` / Drive save) is unaffected.

**Suggested fix (2 lines, same one writer, follow-up):**

```ts
// applyAndProject.ts, around :566
try {
  await cache.initPersistenceDB(id);
} catch (e) {
  raiseCachePersistFailure('open', e instanceof Error ? e.name : 'UnknownError');
  throw e;
}
```

### F2 — Medium-low. B6 was skipped, and it will make greg's manual test read as a failure

**Where:** `docs/plans/2026-09-07-native-update-gate.md:422`.

Criterion 12 still says: _"hand-edit a family file to a version this build does not
know … open it on a native build, and confirm the block appears, is not dismissible,
offers a working store link."_ B4 has now made `"version": 6.0` (a JSON number) classify
as `UnsupportedBeanpodVersionError`, whose `needsAppUpdate` is `true` (`types/sync.ts:409`) —
so on a cold-open/unlock path it _does_ raise the full-screen block, but on a **Settings
pick or a drag-drop** it now shows the new inline sentence instead (that is B1a and B3,
working as designed). Greg is about to run exactly that manual sequence with exactly that
fixture, from Settings.

**Fix:** scope criterion 12 to a cold-open / unlock path and add the sentence the plan
specified — that a Settings pick or a drag-drop shows the inline refusal, not the
overlay. Leave `…-pass4.md:447` alone.

### F3 — Low. A stale comment about the inline path, in a commit whose thesis is that stale comments are the bug

**Where:** `src/services/automerge/worker/docClient.ts:1462-1464`.

> `// ⚠️ === false, NOT !result?.deleted. The inline dispatch path and any older worker bundle answer {}`

The inline path no longer answers `{}`. `inlineBridge.inlineExecutor` (`inlineBridge.ts:60`)
calls the **same** `applyAndProject.dispatch`, whose `'clearCache'` case now returns
`{ result: await clearCache(...) }` (`applyAndProject.ts:1469`) — so inline and worker both
carry the real `{ deleted }`. (The plan's premise was true _before_ this commit; changing
the one shared dispatch changed both realms.)

The `=== false` test is still correct and should stay — an older worker chunk left in the
service-worker cache genuinely answers `{}` — but the stated reason is now wrong.
**Fix:** drop "The inline dispatch path and" from the comment; keep the older-bundle half.

### F4 — Low. `docClient.clearCache` can firehose a false "the cache survived sign-out"

**Where:** `src/services/automerge/worker/docClient.ts:1465-1473`, interacting with
`cache.ts:148`.

When the abandoned open from an earlier timeout is still outstanding and a sign-out's
`deleteDatabase` runs, the delete fires `blocked` (our orphan connection is one of the
holders), `clearCache` resolves `{ deleted: false }`, and the event fires with
`error_code: 'delete-blocked'` and a message asserting a privacy fact — _"the encrypted
cache is still on disk after a sign-out that told the person it was gone"_. A tick later
the late-close at `cache.ts:148` runs, the queued delete proceeds, and the cache is in
fact gone. The event over-reports, which is the safe direction, but it is asserted as a
privacy statement in CloudWatch. Worth a sentence in the comment rather than a code
change; there is no cheap way to distinguish the two without awaiting `onsuccess`, which
would re-introduce a wait that can never settle.

### F5 — Low. `importError` is never cleared when the Family Data drawer closes

**Where:** `src/pages/SettingsPage.vue:1567-1568` (`@close` / `@save`), `:522` (the only
reset), `:1915` (the new slab).

`importSuccess` self-clears after 3 s (`:534-537`). `importError` clears only at the top
of the next `handleLoadFromFileConfirmed` (`:522`). Before this commit that did not
matter, because the ref had no reachable render site. Now it does.

**Failure scenario.** User picks a 6.0 file → the red slab appears. They close the
drawer, understand the problem, come back an hour later to load a different file — and
the same red refusal is sitting under the section before they have picked anything.

**Fix:** clear it where the drawer closes, e.g. `@close="showFamilyData = false; importError = null"`,
or a `watch(showFamilyData, ...)` beside the ref.

### F6 — Low / informational. `reseedCacheAfterCorruption`'s "NEVER THROWS" has one theoretical hole

**Where:** `src/services/automerge/worker/applyAndProject.ts:320-337`.

I read every statement. `cache.clearCache` is `async`, so it cannot throw synchronously
and `.catch(() => null)` covers its rejection; `!result?.deleted` is null/undefined-safe;
`console.error` cannot throw; `cache.initPersistenceDB` is inside its own try/catch. The
one uncovered path is `raiseCachePersistFailure` → `sink.cachePersistFailed(...)`. In
**worker** mode that is a `postMessage` of a plain `{ kind, errorName }` — structured-cloneable,
cannot throw. In **inline** mode it is synchronous all the way to main:
`inlineBridge.ts:38-39` → `syncService.setCachePersistFailed` (`syncService.ts:652`) →
`cacheFailureCallbacks.forEach(cb => cb(failed))` → `emitCachePersistTelemetry` →
`reportError`. A throwing subscriber would escape the helper and replace the
`CorruptPayloadError` that App.vue's self-heal dispatches on.

This exposure is not new — `persistOnce`'s catch (`:445`) has had it since before this
commit, and no subscriber throws today. But the function carries an absolute contract in
its JSDoc. If you want it airtight, wrap the body of `raiseCachePersistFailure` in a
`try { … } catch { /* the signal is best-effort; never let it replace a classification */ }`.
One place, both producers.

---

## Test honesty

I mutated the production code for each new test and re-ran it. Results:

| Test                                                                     | Mutation applied                                                 | Result                                           | Honest? |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------ | ------- |
| `cache.openTimeout.test.ts` — "gives up instead of waiting forever" (+2) | `db = await opening` (drop `withTimeout`)                        | **4 failed** (3 assertions + a 5 s test timeout) | yes     |
| `cache.openTimeout.test.ts` — "CLOSES a connection that arrives after…"  | `void opening.catch(() => {})` (drop the `.close()`)             | **1 failed**                                     | yes     |
| `initAndLoadCache.oom.test.ts` — the four new blocked-delete cases       | delete the `if (!result?.deleted) { … return; }` guard           | **3 failed**                                     | yes     |
| `applyAndProject.test.ts:235` (pre-existing)                             | drop `cachePersistFailed = true` from `raiseCachePersistFailure` | **1 failed** — the DRY refactor is covered       | yes     |
| `SettingsPage.importError.test.ts`                                       | delete the new slab from `SettingsPage.vue`                      | **2 failed**                                     | yes     |
| `openFileVersion.test.ts` — the JSON-number case                         | revert `parseBeanpodV4` to the string-first shape                | **1 failed**                                     | yes     |

**`cache.openTimeout.test.ts` — does mocking `idb` make it test the mock?** No. Every
assertion runs the real `initPersistenceDB`/`clearCache` from `cache.ts`; the mock only
supplies the promise the production code races. All three mutations above are mutations
of production code, and all three fail it. **But there is a gap the mocks do create:**
nothing in the tree proves the _premise_ — that a real (or `fake-indexeddb`) `openDB`
genuinely queues silently behind a pending `deleteDatabase`, or that a live second
connection genuinely fires `onblocked`. The `clearCache` cases stub `indexedDB` wholesale
(`:104-112`, `:117-121`) with a hand-rolled request object, i.e. the plan's _fallback_
seam rather than its primary approach; and the plan's testing item 1 (in `cache.test.ts`,
holding a real second connection across a `clearCache` + `initPersistenceDB`) was not
written — `cache.test.ts` is unchanged in the commit. The wiring is pinned; the IndexedDB
behaviour it is wired against is taken on faith. That is acceptable for a hotfix, and
greg's manual step ("with a second tab open on the app, force the corrupt-cache path")
is what actually proves it.

**`SettingsPage.importError.test.ts` — does `shallow: true` reach rendered output?** Yes.
The two modal components that wrap the section are explicitly stubbed with a
slot-rendering stub (`SlotStub`, `:64`), so the drawer body is real DOM. I dumped
`wrapper.text()` during the mutation run and it contains `settings.saveDataToFile` /
`settings.createOrLoadDataFile` — i.e. the **not-configured** sub-branch is genuinely
rendering, which is the half the plan cared about. The two negative tests ("says nothing
at all…", "says nothing when the pick SUCCEEDS") would pass vacuously if the drawer ever
stopped rendering, but the two positive ones guard that, so the file as a whole is sound.

**`docClient.test.ts` — the A4 test is the weakest thing in either commit.** It asserts
_set membership_ (`__RETRYABLE_METHODS_FOR_TESTING.has('initAndLoadCache') === false`)
rather than the behaviour the requirement names. It does fail the plan's stated mutation
(re-adding the method), so it is not a tautology. But it cannot fail if `handleRpcTimeout`
ever starts re-issuing regardless of the allowlist, and it pins neither "one timeout
results in at most two worker invocations" nor "the rejection reaches the caller" — both
of which the plan's testing item 4 asked for, along with the liveness-false-positive
case, which was not written. It also adds a test-only export to a production file
(`docClient.ts:1479`) purely to make a private set assertable. I traced the behaviour by
hand instead; see Verified correct.

**Not written at all** (each is a plan testing item, none is a defect in shipped code):

- Testing item 5, the `syncStore` degrade test. Nothing pins the `pod-open-degrade` event
  on either arm, and A5's acceptance criterion ("a cache that will not open produces the
  existing cache-MISS path, with the spinner cleared") has no test behind it. A5's entire
  content was "pin it with a test; add no mechanism", so A5 is currently unverified.
- Testing item 8's `fileSync.test.ts` cases. The number case is covered end-to-end in
  `openFileVersion.test.ts:126-137`, so the criterion is met; but `"7"`, `"6.0"` as a
  string, and the new `obj.version === null` branch (`fileSync.ts:138`) have no direct test.
- No test covers `markPersistOk()` clearing a `kind: 'open'` raise specifically. The
  shared writer is covered via the `persistOnce` producer (mutation 4 above), which is
  the load-bearing half.

---

## Verified correct

Everything below I attacked deliberately and could not break.

**The `withTimeout` wrap and the late close (`cache.ts:117-159`).**

- **`cacheDb` is guaranteed null after a timeout.** The early return at `:118` requires
  `cacheDbFamilyId === familyId && cacheDb`, so a timeout is only reachable with
  `cacheDb === null` (either it was null, or the family-switch block at `:121-124` just
  nulled it). The only assignment is at `:156`, on the success path, after the `await`
  resolved. `isCacheReady()` is exactly `cacheDb !== null`, so no write can target a
  handle we do not hold.
- **The late close cannot race a legitimate later open for the same family.** Each
  `openDB` call issues its own `indexedDB.open()` and yields a distinct `IDBDatabase`;
  `idb` does not memoise by name. So closing connection #1 in `:148` cannot close
  connection #2 installed at `:156` by a subsequent `initPersistenceDB(sameFamily)`. I
  walked the interleaving where both resolve in the same tick — still safe.
- **Family switch mid-timeout.** `cacheDbFamilyId` is left holding the _previous_ family
  with `cacheDb` null, exactly as the plan predicted and told the implementer not to tidy.
  This cannot break the early return at `:118` (it requires both), nor `clearCache`'s
  guard at `:500` (also both), and every other consumer gates on `cacheDb` (`:177`, `:201`,
  `:258`, `:276`, `:297`, `:312`, `:340`). Verified by grep: `cacheDbFamilyId` appears at
  `:110/118/157/500/503/528/542` and nowhere else.
- No unhandled rejection: a genuinely-rejecting `openDB` is caught at `:143` and its
  `.catch(() => {})` at `:148` swallows the second consumption.

**`clearCache`'s new return value — every caller traced.**

- `cache.clearCache` → `reseedCacheAfterCorruption` (`applyAndProject.ts:321`, reads
  `result?.deleted`), and the facade `applyAndProject.clearCache` (`:1223`, returns it).
- Facade → the `'clearCache'` dispatch (`:1469`), which is shared by **both** realms:
  the worker (`docWorker.ts:48` destructures `{ result, delta, changed }` and posts it —
  `{ deleted: boolean }` is structured-cloneable) and inline (`inlineBridge.ts:60`, same
  `dispatch`). So `docClient.clearCache` receives a real `{ deleted }` on both paths.
  The comment claiming inline answers `{}` is stale (F3), but the `=== false` guard is
  correct either way and cannot misfire on `undefined`.
- `docClient.clearCache` stays `Promise<void>` (`:1460`), so `database.ts:70`
  `deleteFamilyDatabase` and everything above it in the sign-out path see no change and
  are not in the diff — as the plan required.
- Tests calling the real `clearCache` and ignoring its value (`cache.test.ts:66/165/315`,
  `applyAndProject.test.ts:88`, `compactDoc.test.ts:289`, `cache.replayOom.test.ts:102`)
  are unaffected; the one `vi.mock` of the module (`initAndLoadCache.oom.test.ts:33`) was
  updated. Store-level mocks of `docClient.clearCache` (`syncStore.resume.test.ts:96`,
  `dataClearingSecurity.test.ts:134`) mock the `void` layer, so they are unaffected too.
  **No caller receives an object where it expected void.**

**`reseedCacheAfterCorruption` cannot throw** on any path an `async` function can throw
on, with the single theoretical exception in F6. Statement by statement: `:321` async
call + `.catch`; `:326` optional-chained truth test; `:327`/`:334` void calls (F6);
`:333` `console.error`; `:331` inside its own try. The original `CorruptPayloadError` is
always the one that leaves `initAndLoadCache` (`:608`).

**`markPersistOk()` still works.** `raiseCachePersistFailure` sets the worker-local flag
(`:303`) before the sink (`:304`) on every path, and it is the only writer of `true` —
both producers (`:327`/`:334` and `:445`) go through it. A pre-existing test
(`applyAndProject.test.ts:235`) fails if the flag assignment is removed, so the plan's
"banner would never have cleared" defect is genuinely closed and guarded. `reset()`
(`:1214`) still zeroes the flag without an edge, and `syncService.ts:934` clears the main
side silently on the same teardown — the two remain in step.

**Removing `initAndLoadCache` from `RETRYABLE_METHODS` — both branches of `handleRpcTimeout` traced.**

- Alive-but-busy (`docClient.ts:867-885`): the probe answers, the `liveness-false-positive`
  `logEvent` fires, `attempt === 1 && RETRYABLE_METHODS.has(method)` is now false →
  `throw surface(timeoutErr, method, opts.quiet)` at `:884`. **Definite rejection.**
  Note the earlier backstop at `:856` cannot pre-empt it: `initAndLoadCache` is in
  `HEAVY_METHODS` (`:467`), so `!HEAVY_METHODS.has(method)` is false.
- Teardown (`:889-927`): `recoverDeadWorker` + the `doc-worker-recovery` report still run,
  then the retry guard is false → `throw surface(timeoutErr, method, opts.quiet, [method, ...drainedMethods])`
  at `:926`, which keeps the drained-sibling classification (a drained `mutate` still
  gets its toast). **Definite rejection.**
- `initAndLoadCache` is not in `USER_ACTION_METHODS` (`:552`), so it is firehose-only, no
  toast — as the plan predicted.
- **The spinner clears.** Both callers catch and return: `replaceDocWithCacheRecovery`
  (`syncStore.ts:938`) takes the cache-MISS / adopt-remote path, and
  `loadFromPersistenceCache` (`syncStore.ts:1889` → catch at `:1963`) returns
  `{ success: false }` so App.vue falls through to its next path. Nothing awaits forever.
- **The rehydrator still runs** (`bootstrap.ts:29-36` calls `initAndLoadCache` directly;
  the allowlist governs only `handleRpcTimeout`'s transparent re-issue).
- No existing test pinned the old membership: the full suite is green.

**`openFileFailure` returning `lastError: null` — every reader on a file-open path.**
`openFileFailure` (`syncService.ts:2134`) is reached only from `openAndLoadFile` (`:2196`),
`openAndLoadFileFallback` (`:2234`) and `loadDroppedFile` (`:2260`); those are called only
from `syncStore.loadFromNewFile` (`:1517`) and `syncStore.loadFromDroppedFile` (`:1564`),
both of which carry `payloadError` out (`:1546`, `:1592`). The complete reader set, and
each one's `payloadError` arm ahead of its `syncStore.error` arm:

| Reader                                     | `payloadError` arm | `syncStore.error` arm                                                     |
| ------------------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| `SettingsPage.handleLoadFromFileConfirmed` | `:538`             | never uses it (`:543-545` deliberately uses `t('settings.importFailed')`) |
| `LoadPodView.handleLoadFile`               | `:530` (shared)    | `:532`                                                                    |
| `LoadPodView.handleDrop`                   | `:530` (shared)    | `:532` — **this is the arm B3 added**                                     |
| `JoinPodView.handleLocalLoadResult`        | `:203`             | `:208`                                                                    |

No other consumer of `state.lastError` is on this path: `syncStore.ts:1206`/`:3333` and
`syncService.ts:2076` are Drive-404 branches, `SetupProgressModal.vue:195` is pod
creation, `OpenFromDrivePage.vue:83` and `ResumePodSetup.vue:842` are Drive loads, and
`LoadPodView.vue:405` is `autoLoadFile`'s catch (a saved-handle path). **Nothing that
used to show something now shows nothing.** The only display that intentionally goes
quiet is the amber `syncStore.error` slab at `SettingsPage.vue:1838` with its Reconnect
Drive / Force Save buttons, which is precisely the reported bug. And the non-blocker arm
(`syncService.ts:2158`) still writes `lastError`, which is what keeps a torn/non-JSON
file speaking — pinned by `openFileVersion.test.ts:145`.

**`parseBeanpodV4`'s restructure.**

- No existing caller depended on a non-string version throwing the generic `Error`.
  `fileSync.test.ts:189` uses an **absent** version, which still throws `missing version`;
  `openFileVersion.test.ts:139-144` adds an explicit test for the same. Full suite green.
- **`String(obj.version)` is safe for every `JSON.parse` product.** Booleans → `'true'`
  (passes the clamp, harmless); arrays → `'1,2'` and objects → `'[object Object]'` (both
  fail `/^[\w.+-]{1,16}$/` at `types/sync.ts:402` and become `'unrecognised'`). `JSON.parse`
  cannot produce a value with a throwing `toString`, a `Symbol`, or a `BigInt`, so
  `String()` cannot throw here.
- Accepted behaviour change, per the plan: an unrelated JSON file carrying a numeric
  `version` (e.g. `{"version": 2, …}`) is now refused as "saved by a newer beanies"
  rather than "not a beanpod", and on a **cold-open/unlock** path it now reaches
  `surfacePayloadFatal`'s update block, because `UnsupportedBeanpodVersionError.needsAppUpdate`
  is `true` (`types/sync.ts:409`). That is the intent, and it is why F2 matters.

**The new `SettingsPage.vue` slab renders in both sub-states and only when it should.**
Proved by the mounted test with `isConfigured: false` plus the mutation. It is
`v-if="importError"`, and `importError` is written only by `handleLoadFromFileConfirmed`
(`:521`, `:541`, `:545`) and the dead branch's `handleManualImport` (`:642`, `:654`, which
is unreachable), so it cannot render on a cancel, on a `needsPassword` handoff, or on a
success. It is themed for both modes (`bg-red-50 dark:bg-red-900/20`,
`text-red-600 dark:text-danger-lift`), matching the CIG rule. The one wart is F5.

**The gate, run on `564b0662`:**

- `npm run type-check` — clean, no output.
- `npx eslint src` — **0 errors**, 727 warnings, all pre-existing `security/detect-object-injection`.
- `npx vitest run` (full suite) — **6730 passed, 2 skipped, 18 todo, 1 failed**: only
  `src/pages/__tests__/TravelPlansPage.smoke.test.ts` (the known pre-existing
  full-suite-load flake, excluded per the review brief). 561 of 564 files green.
- The eight directly-touched test files run in isolation: **144 passed, 0 failed.**

All mutations were applied to scratchpad-backed copies and reverted; `git status` is back
to `CHANGELOG.md` and `src/config/featureFlags.committed.ts` only, exactly as I found it.
