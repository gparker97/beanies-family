# Plan: The cache open that never returns, and the refusal nobody can see

> Date: 2026-09-07
> Related issues: None, direct implementation
> Plan file: `docs/plans/2026-09-07-cache-open-hang-and-unrenderable-refusal.md`
> Investigations: `docs/plans/2026-09-07-native-update-gate-review/BUG-welcome-gate-hang.md`, `BUG-6.0-import-bypass.md`, `BUG-drive-restore-provider-switch.md`

> **No GitHub issue created.** Approved for direct implementation.

> **No mockup.** Group B adds one slab in the branch that renders; Group C deletes a dead one. Nothing new is designed.

> **⚠️ THIS IS FOUR COMMITS, NOT ONE.** A user is locked out right now. The lockout fix (Group A) and the refusal fix (Group B) must each be revertable without taking the other down with it, and the two cleanups (Group C) must not ride along on a hotfix at all. See **Commit boundaries** under Approach; it is a requirement, not a preference.

## User Story

As someone whose family file will not open, I want beanies to fail in a way I can act on, so that I am never left watching a spinner with no message, no button, and no way out of the app.

## Context

Greg hit three symptoms while running the compaction acceptance drills. Three investigations found that **none of them is the beanpod version guard**, and none is a regression from this release cycle.

**The hang (Group A).** `initAndLoadCache` can await forever. The mechanism is two lines on the corrupt-cache recovery path:

```ts
// src/services/automerge/worker/applyAndProject.ts:552-553
await cache.clearCache(id).catch(() => {});
await cache.initPersistenceDB(id);
```

`clearCache` resolves `onblocked` as **success** (`cache.ts:470`, under a comment that says "resolve rather than hang, matches legacy") while the delete stays queued in the browser's connection queue. `initPersistenceDB` then calls `openDB` on the same name with no deadline (`cache.ts:106`).

⚠️ **The open does not fire `blocked`; it fires nothing at all.** Per the IndexedDB connection-queue rules, `blocked` on an open request fires only when the open needs a _version change_, and this DB is opened at version 1 always, so it never upgrades. What actually happens is that the open request queues _behind the still-pending delete_ and sits there silently until every other connection closes. There is no event to listen for. **A deadline is the only thing that can save this call**, which is why A1 is a timeout and not a callback.

Both lines came in with `57d7d64d` (2026-07-05, ADR-032) and are **live in prod today** (`git merge-base --is-ancestor 57d7d64d c3a6be98` passes). This release did not cause it. What this release does is put it in front of native users, who have no "clear site data" equivalent.

Four things make it worse than a slow load:

1. **It is browser-scoped**, so terminating and respawning the worker does not clear it.
2. **One tap runs it three times, roughly 6 minutes.** `initAndLoadCache` is HEAVY (`docClient.ts:447` → `HEAVY_RPC_TIMEOUT_MS = 120_000` at `docClient.ts:87`). The original call burns 120 s, the teardown retry (`docClient.ts:889`) respawns, the respawn's rehydrate (`bootstrap.ts:29-36`) runs `initAndLoadCache` again, then the retry runs it a third time. `initAndLoadCache` is both a retryable method and the rehydrator.
3. **In INLINE mode there is no bound at all.** `requestCore`'s inline branch (`docClient.ts:617-635`) awaits `inlineExecutor(method, args)` with **no deadline whatsoever**: no `HEAVY_RPC_TIMEOUT_MS`, no `ABSOLUTE_DEADLINE_CEILING_MS`. Inline is the fallback when the worker cannot spawn, i.e. disproportionately the low-memory devices this class of failure finds first. So the RPC layer is not a bound that covers the fleet.
4. **There is no in-app recovery.** Both "clear data" and sign-out route through the wedged worker (`database.ts:70` → `docClient.ts:1422`).

One correction to the investigation report worth recording, because it changes what A6 has to do: **the failure is not telemetry-invisible today.** The teardown path already fires `reportError({surface:'doc-worker-recovery', severity:'warning'})` unconditionally (`docClient.ts:866`), and a non-`RemoteBlocker` rejection from `initAndLoadCache` is reported by `surface()` (`docClient.ts:971`) through `notifyFailure`'s background arm (`docClient.ts:959`, `surface: 'doc-worker'`). What is genuinely uncounted is the **outcome**: that `replaceDocWithCacheRecovery` then swallowed it (`syncStore.ts:936`) and adopted the remote wholesale. That is the event to add, and only that one.

**The refusal nobody can see (Group B).** `importError` has exactly one render site, `SettingsPage.vue:1947`, inside a `<div v-else>` at `:1909` (its comment at `:1908`). Its `v-if` partner at `:1575` tests `syncStore.supportsAutoSync`, which is `canAutoSync()`, which is:

```ts
// src/services/sync/capabilities.ts:144-146
export function canAutoSync(): boolean {
  return true; // "Returns true unconditionally."
}
```

The branch is dead on every platform. And it is worse than the report said: the **reachable** load-a-file buttons (`handleLoadFromFileClick` at `:1611` and `:1812` → `handleLoadFromFileConfirmed`) set `importError` at `:541` and `:545`, into a ref with no render site in the branch the user is standing in. Its sibling `importSuccess` **does** render there (`:1875`). So the success arm speaks and the failure arm is mute, on the path a real person actually takes.

⚠️ **The live branch is itself split in two, and this pass found that a single slab does not cover it.** Inside `<div v-if="syncStore.supportsAutoSync">` (`:1575`) there are two sibling states:

| Sub-branch                             | Lines        | Contains                                                                                                                                                      | Renders `importSuccess` / `syncStore.error`?         |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `<div v-if="!syncStore.isConfigured">` | `:1577-1635` | the `:1611` "Load Existing Data File" button + its own `showLoadFileConfirm` dialog (`:1618`)                                                                 | **NO — it has no error or success slab of any kind** |
| `<div v-else class="space-y-4">`       | `:1636-1905` | the `:1812` "Browse" button, `showLoadFileConfirm` (`:1820`), the `syncStore.error` slab (`:1838`), `cachePersistFailed` (`:1866`), `importSuccess` (`:1875`) | yes                                                  |

A locked-out user is very plausibly in the **not-configured** state, which is the one with nothing at all. So a slab placed only beside `importSuccess` at `:1875` would leave the `:1611` button exactly as mute as it is today. B1a is written against this fact.

Worse still, the sentence is also written into the **pod's** error channel (`syncService.ts:2122` → `syncStore.error` → the amber slab at `SettingsPage.vue:1838`), which renders **Reconnect Drive** and **Force Save** beside it, over a family that is still open. Greg read that, correctly, as "it warned me and then loaded the file anyway". The file was never loaded.

**The sweep findings (Group C).** Removing the dead `v-else` branch, deleting the predicate that cannot be false, and closing three collateral silences on the Drive rebind and join surfaces are all real and all worth doing. **None of them is a symptom anybody reported.** They are held back from the hotfix commits and land afterwards on their own review, for the reasons in Commit boundaries.

## Requirements

### Group A: the hang (Commit 1)

> **Minimum viable revert target.** A1 + A2 + A3 + A3b are the lockout fix; everything after is hardening that rides along because it is cheap and touches the same files. If A4, A6 or A7 turns fiddly during implementation, **cut it to a follow-up rather than delay the commit**. Do not cut A1-A3b: A3 depends on A2's return value and A3b is what stops A3 from trading a hang for a silent durability hole.

**A1. The IndexedDB open must be incapable of hanging, and the bound belongs in `cache.ts`.**

- Wrap the `openDB` at `cache.ts:106` in the **existing** `withTimeout` from `@/utils/timing`. ⚠️ Do **not** write a new timeout helper, and do not reach for `withIdbRetry` (`utils/idbTransient.ts:48`); that is a retry for transient iOS _rejections_, and this failure never rejects.
- **`export const CACHE_OPEN_TIMEOUT_MS = 10_000;`** — exported so the unit tests advance by exactly this and cannot drift from a hard-coded literal. Beside it, a comment saying: a healthy `openDB` is sub-100 ms; 10 s mirrors `READY_TIMEOUT_MS` (`docClient.ts:78`); it must stay far below `HEAVY_RPC_TIMEOUT_MS` (120 s, `docClient.ts:87`) so the _worker_ decides, not the RPC ceiling; and it is the **only** bound on the inline path, which has none.
- The rejection message must name the DB and the cause so a device console is enough to triage: `` `cache open timed out after ${CACHE_OPEN_TIMEOUT_MS}ms: ${dbName} is queued behind another connection or a pending delete` ``.

⚠️ **A1's real hazard is the abandoned open, and the first draft of this requirement did not handle it.** `withTimeout` (verified, `src/utils/timing.ts:16`) is `withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T>`. It races against a `setTimeout` that rejects with a plain `new Error(message)`, clears the timer in a `.finally`, and **explicitly does not cancel the underlying work** (its own JSDoc says so). So a timed-out `openDB` request stays queued, and if it later succeeds nobody holds the handle and nobody closes it. **An orphan connection to `beanies-automerge-<id>` blocks every future `deleteDatabase` on that name** (`DB_PREFIX` is `'beanies-automerge-'`, `cache.ts:79`), which is precisely the privacy invariant this file's header comment exists to protect (`cache.ts:13-15`). Left unhandled, A1 converts a hang into a permanent, silent inability to clear the cache on sign-out. That is a worse failure than the one being fixed. The shape must therefore be:

```ts
const dbName = `${DB_PREFIX}${familyId}`;
const opening = openDB<CacheDB>(dbName, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  },
});
let db: IDBPDatabase<CacheDB>;
try {
  db = await withTimeout(opening, CACHE_OPEN_TIMEOUT_MS, `cache open timed out …`);
} catch (e) {
  // ⚠️ withTimeout stops WAITING; it cannot cancel the request. If this open
  // later succeeds nobody holds the handle, and an orphan connection blocks
  // every future deleteDatabase on this name (the privacy invariant in the
  // header comment above). Close it on arrival, whenever that is.
  void opening.then((late) => late.close()).catch(() => {});
  throw e;
}
// Assign ONLY on success: a timeout must leave `cacheDb` null so
// `isCacheReady()` is false and no write targets a DB we do not hold.
cacheDb = db;
cacheDbFamilyId = familyId;
incSeq = await maxIncSeq(cacheDb);
```

The local-then-assign ordering is load-bearing twice over: it keeps `cacheDb` null on failure (`isCacheReady()` is exactly `cacheDb !== null`, `cache.ts:446-448`), and it closes the family-switch race (a late open cannot install itself as another family's handle minutes later).

⚠️ On a timeout, `cacheDbFamilyId` is left holding the **previous** family's id, because the pre-open switch block (`cache.ts:100-103`) nulls `cacheDb` but not the id. That is pre-existing and benign — every consumer gates on `cacheDb`, and `initPersistenceDB`'s early return requires BOTH — so **do not "tidy" it in this commit**; it is a second behaviour change with no test behind it.

- **No `blocked` / `blocking` callback.** `blocked` cannot fire (no version change, ever; see Context). `blocking` _can_ fire, but acting on it by closing our connection would leave `cache.isCacheReady()` false mid-session, and `persistOnce` (`applyAndProject.ts:340`) **silently early-returns** in that state, trading a hang for an invisible durability loss. Adding either would be code that no test can make fail.

**A1b. No new error class, and no `ERROR_REGISTRY` entry.** A plain `Error` from the worker is reconstructed on main as a `DocWorkerError` (`protocol.ts:314-321`), which is not a `RemoteBlocker`, so `surface()` already routes it to `notifyFailure` → `reportError({surface:'doc-worker', severity:'error'})` (`docClient.ts:959`). It is firehosed for free.

A new subclass would have to be added to `ERROR_REGISTRY` (`protocol.ts:288`) or it silently degrades to `DocWorkerError` anyway; it would have to answer `blockCode`/`inlineMessageKey` if it were a `PayloadLoadError`, which would be a lie (a blocked open is not a payload step and is not `latches`-worthy); and no consumer needs to `instanceof` it, because every catch on this path treats "anything that is not a `deviceCannotOpen` `PayloadLoadError`" identically. **The class does not earn itself. Do not add one.**

⚠️ One consequence to carry into A3b: a `withTimeout` rejection is `new Error(...)`, whose `.name` is the string `'Error'`. Anything that reports `e.name` as a triage field gets `'Error'` from this path, which tells a reader nothing. A3b's detail therefore has to discriminate on `kind`, not on the error name.

**A2. `clearCache` must not report success when it was blocked, and the flag must not become a bare boolean on the wire.** `cache.ts:470` resolves `onblocked`. A blocked delete means the encrypted cache survives sign-out, which the file header states as an invariant, and it has been resolving as success since ADR-032.

⚠️ **Not `Promise<boolean>`.** The value crosses four layers (`cache.clearCache` → `applyAndProject.clearCache` facade → the `'clearCache'` dispatch → the RPC → `docClient.clearCache` → `database.deleteFamilyDatabase`), and a naked `true` on a postMessage boundary is unreadable at every one of them. `await docClient.clearCache(id)` returning `boolean` at `database.ts:70` reads as "did what?" in three years, and a bool is the signature that quietly acquires a second meaning later ("true = deleted, or was already absent, or…"). The `ping` dispatch already sets the house precedent by returning `{ ok: true }` rather than `true`.

Use a **named result type declared once in `protocol.ts`**, beside `CachePersistFailureDetail` (`protocol.ts:155-163`), because that file is the declared worker-boundary contract:

```ts
/** Outcome of a cache-DB delete. `deleted: false` means the delete was BLOCKED
 *  by another connection and the encrypted cache is still on disk. */
export interface CacheClearResult {
  deleted: boolean;
}
```

Call sites then read `const result = await cache.clearCache(id)`, and a future field (an error name, a retry count) joins the object instead of forcing a fifth signature change.

**`docClient.clearCache` stays `Promise<void>`.** It reads `result?.deleted` internally and emits the single `logEvent` there. That keeps `database.ts` and the sign-out path in `authStore` completely untouched, which matters: sign-out is the highest-consequence caller in the chain and the one you least want to churn in a hotfix. Every caller, verified this pass:

| Caller                                                                                                                                                 | Today                | After                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `applyAndProject.ts:552` (recovery)                                                                                                                    | `.catch(() => {})`   | A3 below                                                                                                                                             |
| `applyAndProject.ts:1168-1171` (worker `clearCache` facade, sign-out / family-switch)                                                                  | ignores              | returns the result; the dispatch at `:1415-1417` becomes `return { result: await clearCache(a.familyId as string) };`                                |
| `docClient.ts:1422`                                                                                                                                    | `Promise<void>`      | **stays `Promise<void>`**; reads `deleted` and, on `false`, emits ONE `logEvent` at `warn` (surface `cache-persist`, `error_code: 'delete-blocked'`) |
| `database.ts:70` `deleteFamilyDatabase` and everything above it (sign-out)                                                                             | `await`              | **unchanged, not in the diff**                                                                                                                       |
| tests calling the REAL `clearCache`: `cache.test.ts:66/165/315`, `applyAndProject.test.ts:88`, `compactDoc.test.ts:289`, `cache.replayOom.test.ts:102` | `await`              | unchanged (return value ignorable)                                                                                                                   |
| ⚠️ **`initAndLoadCache.oom.test.ts:29` MOCKS it** as `clearCache: vi.fn(async () => {})`                                                               | resolves `undefined` | **MUST become `vi.fn(async () => ({ deleted: true }))`** — see the hazard below                                                                      |

⚠️ **The mocked caller is a real break, and it was missing from the previous draft.** `initAndLoadCache.oom.test.ts` replaces the whole `../cache` module (it is the only `vi.mock` of that module in the tree, verified). Its `clearCache` mock resolves `undefined`. Under A3 as previously drafted (`const { deleted } = await cache.clearCache(id).catch(…)`) that destructure throws `TypeError: Cannot destructure property 'deleted' of 'undefined'` **out of a helper documented as never throwing**, replacing the original classification and failing three of that file's four tests ("STILL clears the cache for genuine corruption", "STILL clears for an unrecognised error", and the `rejects.toBe(oom)` case on its corruption sibling). Two things are therefore required, not one:

1. Update the mock to `clearCache: vi.fn(async () => ({ deleted: true }))`.
2. **Read the flag optionally, never by destructuring** — `if (!result?.deleted)` — so that a future mock or a stale bundle returning `undefined` degrades to "skip the re-open", which is the safe direction, instead of throwing a TypeError over the error the caller must classify.

Sign-out must still complete when `deleted` is `false`. Report, do not block; throwing instead would make a blocked delete _fail sign-out_, which is worse than the privacy leak it would be announcing.

⚠️ `docClient.clearCache` must test `result?.deleted === false`, **not** `!result?.deleted`: the inline dispatch path and any older worker return `{}`, and a bare falsy test would firehose a false "delete-blocked" on every inline sign-out.

**A3. `applyAndProject.ts:552-553` must not re-open a database whose delete was blocked, must not go silent doing it, and must not add a fourth level of nesting to do either.** Three faults in two lines:

1. `.catch(() => {})` is a bare swallow. Replace with the A2 result.
2. If the delete was blocked, **skip the re-open** (that pairing _is_ the hang).
3. ⚠️ **The re-open currently sits un-caught inside a `catch` whose whole job is `throw e`.** Once A1 makes `initPersistenceDB` able to reject, a failing re-open would replace the `CorruptPayloadError`, and App.vue's cache-corrupt self-heal dispatches on that class.

⚠️ **Do not write this inline.** The site is already inside a `catch (e)` carrying a ~34-line comment (`applyAndProject.ts:518-551`, the OOM denylist), then an `if (!(e instanceof PayloadLoadError) || !e.deviceCannotOpen)` at `:551`. Adding an `if/else` with a nested `try/catch` puts four levels of control flow under a comment block, and leaves the "the original error always wins" invariant enforced only by whoever reads to the bottom. Extract a named helper whose contract is the invariant:

```ts
/**
 * Re-seed a clean cache DB after a corrupt-cache clear.
 *
 * ⚠️ NEVER THROWS. The only caller is inside a `catch` whose job is to rethrow
 * the original classification (App.vue's self-heal dispatches on that class),
 * so every failure in here is reported through the durability signal instead of
 * being raised. Do not "improve" this by letting it propagate.
 */
async function reseedCacheAfterCorruption(id: string): Promise<void> {
  const result = await cache.clearCache(id).catch(() => null);
  // `?.` deliberately: a null (threw) and a `{deleted:false}` (blocked) both mean
  // "do not re-open", and an undefined from a stale mock must not throw here.
  if (!result?.deleted) {
    // The delete is queued behind another connection; re-opening now IS the hang.
    raiseCachePersistFailure('open', 'DeleteBlocked');
    return;
  }
  try {
    await cache.initPersistenceDB(id);
  } catch (openErr) {
    console.error('[applyAndProject] cache re-open after clear failed', openErr);
    raiseCachePersistFailure('open', openErr instanceof Error ? openErr.name : 'UnknownError');
  }
}
```

The call site is then two flat lines inside the existing `if`:

```ts
await reseedCacheAfterCorruption(id); // never throws; see its contract
…
throw e; // ⚠️ ALWAYS the original classification
```

Nesting drops from four levels to one, the invariant lives on the function that owns it, and the helper is unit-testable without constructing the whole corrupt-load path.

**A3b. Skipping the re-open must not create a silent durability hole, and the existing signal has ONE writer.** With no open DB, `persistOnce` hits `if (!currentDoc || !familyKey || !cache.isCacheReady()) return;` (`applyAndProject.ts:340`) and **silently persists nothing for the rest of the session**. Nothing counts it and nothing tells the user. The app already has the whole answer:

- `sink.cachePersistFailed(true, { kind, errorName })` → `cache-persist-failed` signal → `syncService.setCachePersistFailed` (`syncService.ts:652`) → edge-triggered `reportError({surface:'cache-persist', severity:'warning'})` (`syncService.ts:674-682`) + `syncStore.cachePersistFailed` → **`DurabilityBanner.vue`** (`src/components/common/DurabilityBanner.vue`), an existing user-visible banner with a CTA that deep-links to Settings → Family Data.

⚠️ **A defect in the previous draft, found in pass 3: the banner would never have cleared.** `markPersistOk()` (`applyAndProject.ts:274-280`) fires `sink.cachePersistFailed(false)` **only if the worker-local `cachePersistFailed` flag is already true**. A `reportCacheUnavailable` that called the sink directly, as drafted, would raise the banner on main (whose `setCachePersistFailed` is edge-triggered on its own copy) while leaving the worker unable to ever send the clearing edge: a permanently stuck durability banner after any later recovery. The fix is also the DRY move, one writer for the signal:

```ts
/** The ONE writer of the durability signal: keeps the worker-local flag and the
 *  main-thread banner on the same edge, so `markPersistOk()` can clear it later. */
function raiseCachePersistFailure(
  kind: CachePersistFailureDetail['kind'],
  errorName: string
): void {
  cachePersistFailed = true;
  sink.cachePersistFailed(true, { kind, errorName });
}
```

`persistOnce`'s catch (`applyAndProject.ts:388-391`) replaces its inline `cachePersistFailed = true` / `sink.cachePersistFailed(true, { kind: writeKind, errorName })` pair with `raiseCachePersistFailure(writeKind, errorName)`. Two producers, one function, one flag. Leave the `console.error` beneath it in place; it is the worker's only local channel.

**The type widening, and what consumes it.** `CachePersistFailureDetail.kind` (`protocol.ts:160`) widens from `'base' | 'increment'` to `'base' | 'increment' | 'open'`. The full consumer set was enumerated and re-verified:

| Consumer                                                                               | What it does with `kind`                          | Forced to change? |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------- |
| `protocol.ts:160`, `:185`                                                              | declares it, carries it on the signal union       | the edit itself   |
| `applyAndProject.ts:67`, `:390`                                                        | sink interface, producer                          | A3b's own edits   |
| `docClient.ts:175/204/268`, `inlineBridge.ts:21/25/38`                                 | pass-through, never inspects it                   | no                |
| `syncService.ts:652`, `:674-682`                                                       | `detail?.kind` straight into `cache_persist_kind` | no                |
| `syncStore.ts:605-607`, `DurabilityBanner`, `WallStatusStamp`, `SettingsPage.vue:1866` | read the **boolean** only, never the detail       | no                |
| `applyAndProject.test.ts:78`                                                           | captures the detail in a spy                      | no                |

**There is no exhaustive `switch` or `Record` keyed on `kind` anywhere in the tree** (re-grepped this pass), so widening cannot break a consumer. Record that fact in the plan and in the type's JSDoc, because it is the exact question the next person who wants to widen it will ask.

Two comments go stale with the widening and must be fixed in the same commit, or this change creates the drift it elsewhere complains about:

- `protocol.ts:155-158` says "Which cache write failed" and "Only `e.name` crosses the postMessage boundary". `'open'` is not a write, and `'DeleteBlocked'` is not an `e.name`. Reword to "which cache operation failed" and "the failing error's `name`, or a fixed sentinel where the failure has no `Error` (a blocked delete)".
- `diagnosticContext.ts:159` says the value is "which write failed (base/increment)". Update the parenthetical. The context **key** already exists and is already allowlisted, so no Lambda mirror and no store data-collection change is needed; only the comment (the "MIRROR in the Lambda allowlist" note on `:160` stays true and untouched).

**No new banner, no new component, no new store state, no new context key, no new surface.**

**A4. Break the retry x rehydrate multiplication: remove `initAndLoadCache` from `RETRYABLE_METHODS` (`docClient.ts:509`).** Read the comment block above the set (**`docClient.ts:499-507`** — the previous draft cited `:479-488`, which is inside `assertEnvelopeHasPayload`'s JSDoc and has nothing to do with retries) before touching it; it is emphatic, and it is on our side here. Its stated failure-direction is: _"Forgetting to add a safe method costs a missed auto-heal (visible, recoverable); the opposite default would risk silent data corruption."_ Removing a method is the safe direction by the allowlist's own reasoning. And `initAndLoadCache` is the one method for which the retry buys nothing on **either** branch of `handleRpcTimeout`:

- **Teardown branch (`:889`)**: the respawn's rehydrator _is_ `initAndLoadCache` (`bootstrap.ts:29-36`), awaited inside `spawn()` before the retry is dispatched. The explicit retry is a literal duplicate of the work `ensureReady()` just did.
- **Alive-but-busy branch (`:851-854`)**: the worker is mid-WASM on a serial FIFO. Re-issuing a _whole-doc rebuild_ onto it queues a second full load behind the first, competing for the one thread. That is the pathology, not the cure.

Three consequences to state explicitly in the comment left in the set, because each one has been misread once already:

1. **The rehydrator still runs.** `bootstrap.setRehydrator` calls `initAndLoadCache` directly (`bootstrap.ts:29-36`); the retry allowlist governs only the transparent re-issue in `handleRpcTimeout`. Removing the method from the set does not disable cache rehydration after a respawn.
2. **The liveness false-positive branch changes behaviour too.** At `docClient.ts:851-854`, a probe that answers now falls through to `throw surface(timeoutErr, …)` for `initAndLoadCache` instead of re-issuing. That is the intended outcome (it becomes the cache-MISS path of A5), but it is a second behaviour change on a second code path and belongs in the comment, not left implicit.
3. It also removes a re-entry into `requestCore` from inside `spawn()`'s awaited rehydrator after a teardown has nulled `worker`, a path whose safety depends on the `readyPromise` state at that instant (`docClient.ts:607-616`). Not the reason to do A4, but a second reason it is the safe direction.

**Verified this pass: no existing test pins this.** Every retry test in `docClient.test.ts` (`:607`, `:735`, `:921`, `:958`) drives `getHeads`, and no test in that file drives `initAndLoadCache` at all. Behaviour after removal: the rejection reaches `surface(timeoutErr, method, quiet, [method, ...drained])`; `initAndLoadCache` is not in `USER_ACTION_METHODS` (`docClient.ts:552`), so firehose-only; a drained `mutate` still gets its toast; `syncStore`'s catch takes the cache-MISS path. Nothing hangs.

**A5. Verification only, no production code.** A cache that will not open is a cache MISS, and that path already exists untouched.

⚠️ **The previously-drafted second timeout in `syncStore` is deleted from this plan.** Two deadlines on one path is the exact "overly complicated flow" this pass exists to remove, and this one would have been actively harmful: any bound shorter than `HEAVY_RPC_TIMEOUT_MS` re-introduces the iOS large-doc lockout that `120_000` was deliberately raised to fix (`docClient.ts:80-87`, `docs/plans/2026-07-06-worker-ios-large-doc-load.md`). **A1 owns the bound**, because it is the only layer that (a) sits below the RPC ceiling, (b) covers the unbounded inline path, and (c) can tell "blocked open" from "slow-but-progressing WASM", which is precisely the distinction the liveness probe cannot make (A9).

What A5 is: `replaceDocWithCacheRecovery` (`syncStore.ts:880`) already catches (`:923-937`), already leaves `loadedFromCache = false`, and already produces a `no-local-document` basis (`:958-959`) whose full-adopt branch installs a clean document from the remote, for every caller at once (password, PIN, biometric, cold open), with no new component state. **Pin it with a test; add no mechanism.** It carries a requirement number only so the acceptance criterion has something to point at.

**A6. No silent failure, but exactly one new event, not four.** `syncStore.ts:936` swallows the rejection with a `console.warn`. `surface()` has already reported the _failure_ (see Context), so a second report there would be a duplicate the `(surface, message)` dedup cannot collapse. What is missing is the **decision**: emit one `logEvent` on **both** arms of the cache read, so the rate of "we adopted the remote wholesale" is measurable against the rate of normal hits.

⚠️ **The previous draft's snippet referenced an undeclared `errName` and did not say where the call goes.** Concretely: declare `let cacheErrorName: string | null = null;` beside `loadedFromCache`, set it in the catch (`cacheErrorName = e instanceof Error ? e.name : 'UnknownError';`) immediately after the existing `console.warn`, and place the single `logEvent` **after the try/catch closes and before the `const basis: LineageBasis = …` at `:958`**:

```ts
logEvent({
  level: loadedFromCache ? 'info' : 'warn',
  surface: 'pod-open-degrade',
  message: loadedFromCache
    ? 'cache hit — merging'
    : 'cache unavailable — adopting remote wholesale',
  context: {
    action: 'cache-recovery',
    error_code: loadedFromCache ? 'hit' : (cacheErrorName ?? 'miss'),
  },
});
```

Note the two arms this deliberately does **not** cover, and say so in a comment: the `deviceCannotOpen` OOM rethrow at `:935` exits above this line (it is its own reported failure, not a degrade), and a genuine empty-cache MISS resolves without throwing, so it lands on the `'miss'` branch with a null error name — which is correct, and is the denominator the rate needs.

Keep the `console.warn` (it is the device-console trail); it is no longer the _only_ trace.

**A7. The rehydrate failure paths must not stay console-only.** `spawn()` (`docClient.ts:405-407`) and `enterInlineMode()` (`:349-355`) each swallow a failed rehydrate into `console.error`. This is the exact path the hang travels: a rehydrate that hangs 120 s and then dies leaves a worker holding no document and nothing in CloudWatch. One shared `reportError({surface:'doc-worker-recovery', severity:'warning', context:{ action:'rehydrate-failed', recovery_method:'rehydrate' }})` at both sites, keeping each `console.error`. Existing surface, existing allowlisted keys, roughly 6 lines.

### Group B: the refusal (Commit 2)

This is the smallest set that fixes what greg actually reported: a file refused with a message he could not see, beside a Force Save button that made it read as loaded. Roughly 45 lines net.

**B1a. Make `importError` render where the user actually is — in BOTH sub-states, from ONE render site.** As the Context table shows, the two buttons that reach `handleLoadFromFileConfirmed` live in different sibling `<div>`s, and the not-configured one has no slab of any kind. Two copies of the markup would work and would be exactly the duplication that produced this bug in the first place. So:

- Insert **one** slab as the **last child of the `supportsAutoSync` div** — between the current `:1905` (`        </div>`, 8 spaces, closing the configured `v-else`) and `:1906` (`      </div>`, 6 spaces, closing `v-if="syncStore.supportsAutoSync"`), at **8-space indentation**:

```html
<div v-if="importError" class="mt-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
  <p class="dark:text-danger-lift text-sm text-red-600">{{ importError }}</p>
</div>
```

- The markup is the dead branch's (`:1947-1949`), which is already correctly themed for both modes, **plus `mt-4`** to match the spacing of its live `importSuccess` sibling at `:1875` (the dead copy has no top margin because it sat in a `space-y-4` parent; the new position does not).
- Do **not** move or duplicate `importSuccess`. It already renders on the reachable path; the failure arm is the whole bug.
- Both refs are set by `handleLoadFromFileConfirmed` (`:522`/`:534`/`:541`/`:545`), reachable from `:1611` (not-configured) and `:1812` (configured). One site now covers both.
- This placement survives B1b: after the `supportsAutoSync` wrapper is unwrapped the slab simply becomes the last element of the section, still one site, still rendering in both states.

⚠️ Deleting the dead branch is **B1b, and it is not in this commit.** See Group C.

**B3. A refused PICK must not be written into the POD's error channel.** In `openFileFailure` (`syncService.ts:2120-2142`), the `isRemoteBlocker` arm at `:2122` becomes `updateState({ isSyncing: false, lastError: null })`.

- ⚠️ **`isSyncing: false` is load-bearing.** Dropping it wedges the picker spinner.
- ⚠️ **`lastError: null`, not omitted.** A stale string from a previous attempt is mirrored into `syncStore.error` and would render the amber Reconnect-Drive/Force-Save slab behind the refusal. This is the same reasoning the `AbortError` arm already states at `:2173-2174`.
- ⚠️ **`openFileFailure`'s own JSDoc (`syncService.ts:2113-2119`) states the invariant being inverted**, verbatim: "`lastError` is set to that SAME translated sentence rather than the raw exception: `syncStore.error` mirrors `lastError` and both pages test it first, so the two channels must not disagree." **Rewrite it in this commit.** The new contract: a blocker leaves `lastError` null and travels out as `payloadError` alone, so every reader MUST have a `payloadError` arm ahead of its `syncStore.error` arm; the non-blocker arm below still sets `lastError`, which is what keeps a torn/non-JSON file speaking. Leaving this comment saying the opposite of the code is the exact drift Commit 1 spends three edits fixing.
- The `reportError({surface:'pod-load-failure', action:'picked-file-unreadable'})` at `:2127-2137` **stays**; it is the only telemetry on the picker surfaces.
- The returned `payloadError` is then the sole channel, which requires every reader to have a `payloadError` arm. **Three of the four do. `LoadPodView.handleDroppedFile` (`:738-751`) does not**; it jumps from `needsPassword` straight to `syncStore.error` (`:743`), so removing the `lastError` write would regress a dropped newer-version file from the correct sentence to the generic `auth.fileLoadFailed`. Verified that the store already carries the classification on this path (`syncStore.loadFromDroppedFile` returns `payloadError`, `:1533-1574`), so the fix is entirely in the view.
- ⚠️ **The two ladders are not identical, and the extraction must be scoped accordingly.** `handleLoadFile` (`:525-540`) has a `cancelled` early return and a four-rung ladder (success → needsPassword → payloadError → `syncStore.error` → fallback); `handleDroppedFile` has three rungs and different arguments to the success/needsPassword arms (`syncStore.fileName` vs `file.name`). Only the **failure tail** is shared. Extract exactly that, as one file-local helper:

```ts
/** The three-rung failure tail shared by the picked-file and dropped-file loads.
 *  ⚠️ `payloadError` FIRST: since 2026-09-07 `syncService.openFileFailure` no
 *  longer mirrors a blocker into `lastError`, so `syncStore.error` is empty for
 *  exactly the files that most need a sentence. */
function applyFileLoadFailure(result: { payloadError?: RemoteBlocker }): void {
  formError.value = result.payloadError
    ? t(result.payloadError.inlineMessageKey)
    : syncStore.error || t('auth.fileLoadFailed');
}
```

Both call sites become `} else { applyFileLoadFailure(result); }` after their `needsPassword` arm. A cross-file abstraction is not warranted: `JoinPodView.handleLocalLoadResult` (`:187-213`) and `SettingsPage.handleLoadFromFileConfirmed` each write to a different error ref and already have their own correct copy.

- `openFileVersion.test.ts:103-115` currently pins the conflation, under a four-line comment explaining it. Rewrite it to pin the **separation**: `payloadError` is an `UnsupportedBeanpodVersionError` with `inlineMessageKey === 'podNewerVersion.inline'`, and `getState().lastError` is `null`. Update the comment to say why the two channels must now disagree. Its two siblings in that file (the 4.0/5.0 accept case at `:93-101` and the non-beanpod case at `:117-122`) must stay green untouched — the latter is what proves the non-blocker arm still sets `lastError`.

**B4. A non-string `version` is an UNKNOWN version, not a missing one.** `fileSync.ts:129-134` tests `typeof obj.version === 'string'` before the known-set check, so a hand-edited `"version": 6.0` (a JSON _number_) falls through to a generic `Error('Invalid beanpod: missing version')`: worse copy, no `FILE_NEWER_VERSION` classification, and no `detail` in CloudWatch. **This is in the urgent commit because greg's file reads `6.0`; if it parsed as a number, B1a and B3 alone do nothing for him.** Restructure to:

```ts
if (obj.version === undefined || obj.version === null) {
  throw new Error('Invalid beanpod: missing version'); // not a beanpod at all
}
if (typeof obj.version !== 'string' || !KNOWN_BEANPOD_VERSIONS.has(obj.version)) {
  throw new UnsupportedBeanpodVersionError(String(obj.version));
}
```

⚠️ **Rewrite the four-line comment at `fileSync.ts:125-128` in the same edit.** It currently ends "A missing or non-string version is still simply not a beanpod", which B4 makes false for the non-string half. New wording: a version that is present but not a known string is a file from a NEWER beanies (or a hand-edited one) and gets the typed error; only an absent version means "not a beanpod at all".

The clamp is **already** in the constructor (`types/sync.ts:397-406`, `const safe = /^[\w.+-]{1,16}$/.test(fileVersion) ? fileVersion : 'unrecognised'`); do not re-clamp at the call site. `String(obj.version)` satisfies the constructor's `fileVersion: string` parameter.

⚠️ **Correction to the earlier acceptance criterion:** `String(6.0) === '6'` in JavaScript. A JSON number `6.0` is indistinguishable from `6` after `JSON.parse`, so `blockDetail` will read `version=6`, **not** `version=6.0`. That is correct and unavoidable. Pin it as `version=6` in the test with a comment, so nobody later "fixes" it into a lie.

### Group C: the dead branch and the collateral silences (Commits 3 and 4, not urgent)

Everything here was found by the sweep, not by a user. It is worth doing and it must not ride on a hotfix. **Two commits, because these share no files and no reasoning:** C-template (B1b + B2) and C-banners (B5).

**B1b. Delete the dead split (Commit 3).** Remove `<div v-if="syncStore.supportsAutoSync">` at `SettingsPage.vue:1575` and its matching `</div>` at `:1906`, unwrapping its children (every one of them is live UI and must be kept verbatim, including the not-configured state at `:1577-1635`, the configured state at `:1636-1905`, `showLoadFileConfirm`, the `syncStore.error` slab, `cachePersistFailed`, `importSuccess`, and B1a's new `importError`), and delete the `<div v-else class="space-y-4">` block at `:1909-1955` (with its `:1908` comment) entirely.

⚠️ **Why this is not in the hotfix.** The unwrap is a roughly 330-line indentation-only diff plus a 48-line deletion, in the most-reviewed page in the app, and the branch being deleted renders on nobody's device. It is the single largest source of review cost and merge-conflict risk in this plan, and it buys the locked-out user nothing. Sequencing matters: this commit rebases over B1a, so **confirm the new `importError` slab survives the unwrap** before pushing.

⚠️ **Do NOT "bring the manual-import button back".** An earlier draft said to; that was verified wrong. The dead branch's two buttons are:

- `handleManualExport` (`:1928`), an exact duplicate of the reachable Export row.
- `handleManualImport` (`:1942`) → `syncStore.manualImport()` (`syncStore.ts:2885-2899`), which is **literally `loadFromNewFile()` with the result reshaped**. Restoring it would add a _second_ "replace all your local data" button that (a) skips the `showLoadFileConfirm` dialog that is the documented authorisation for `userChoseThisFile: true` ("⚠️ THE ONE CONFIRMED SITE", `SettingsPage.vue:553-557`), and (b) has no decrypt-modal arm, so on `needsPassword`, i.e. **every real beanpod**, it dead-ends on a "needs password" string with no way to enter one.

So delete `handleManualImport` (`SettingsPage.vue:641-660`) and `syncStore.manualImport` (`:2885-2899`, its only caller at `SettingsPage.vue:644`, exported at `:5411`).

⚠️ **Delete a translation key only when its ONLY reference is the deleted branch — and count with an EXACT-key grep, not a substring one.** Corrected this pass: the previous draft claimed `settings.loadDataFile` had 4 references and must stay. It does not. Those four hits were `loadDataFileDescription` matching the substring `loadDataFile`. Grepping the exact key `'settings.loadDataFile'` returns **one** call site (`SettingsPage.vue:1936`, inside the deleted branch) plus its definition (`uiStrings.ts:3461`). Verified this pass, all six keys have exactly one call site and all of them are in the deleted branch, so **all six go**:

| Key                                | Sole call site                                                   | Definition          |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------- |
| `settings.noAutoSyncWarning`       | `SettingsPage.vue:1911`                                          | `uiStrings.ts:3451` |
| `settings.downloadYourData`        | `SettingsPage.vue:1918`                                          | `uiStrings.ts:3456` |
| `settings.downloadDataDescription` | `SettingsPage.vue:1921`                                          | `uiStrings.ts:3457` |
| `settings.loadDataFile`            | `SettingsPage.vue:1936`                                          | `uiStrings.ts:3461` |
| `settings.loadDataFileDescription` | `SettingsPage.vue:1939`                                          | `uiStrings.ts:3462` |
| `settings.importNeedsPassword`     | `SettingsPage.vue:657` (inside the deleted `handleManualImport`) | `uiStrings.ts:4420` |

`action.download` and `action.load` are shared and stay. Re-grep each key with the quotes included at implementation time rather than trusting these counts; a parallel session may have added a reference.

**B2. Delete `canAutoSync()` and `supportsAutoSync` (Commit 3, after B1b).** Both call sites are dead: `SettingsPage.vue:1575` (removed by B1b) and `syncStore.ts:3817` (`if (!supportsAutoSync.value) return;` inside `setupAutoSync`, a guard that cannot fire). Remove `canAutoSync` and its JSDoc from `capabilities.ts:139-146`, its import at `syncStore.ts:34`, `supportsAutoSync` from `syncStore.ts:452` and its export at `:5343`, and the now-unreferenced `canAutoSync: () => true` line from the **13** test mocks (count re-verified this pass: 13 `canAutoSync:` mock lines across 13 test files, plus `capabilities.ts` and `syncStore.ts` = the 15 files that mention the name). Mechanical, one line each; the import and the mock key must go in the same commit or a factory mock will complain. A predicate that cannot be false is a trap for the next person who writes a `v-else` against it; this one already cost us an unrenderable error slab.

**B5. The three collateral silences (Commit 4).** Fixed by extracting the duplication, not by patching each site.

- **`PodAccessBanner.vue:44-53`** discards `rebindPodFile`'s typed `{ ok: false, code }` entirely (`rebindTo` returns `result.ok` and both callers ignore the code), so a refused Drive rebind shows nothing at all. Its sibling **`SaveFailureBanner.vue:34-47` already does this correctly**: `t(POD_ACCESS_ERRORS[recovery.code].messageKey)`, from the shared registry.
- **Both banners also swallow a failed pick**: each does `if (result.kind !== 'picked') return;` (`PodAccessBanner.vue:51`, `SaveFailureBanner.vue:37`), which cannot tell `cancelled` (say nothing, correct) from `failed` (picker script died, must say something).
- The two components run the identical eight-line sequence: `pick()` → guard → `rebindPodFile` → ok/else-message.

  **Extract `useRebindPodFile()` beside `usePickBeanpodFile.ts`**, wrapping `usePickBeanpodFile` and `syncStore.rebindPodFile`, exposing `{ isPicking, rebindError, pickAndRebind(): Promise<boolean>, rebindTo(fileId, name): Promise<boolean> }`. `PodAccessBanner` renders `rebindError` under `#message`; `SaveFailureBanner` replaces its local `reselectError` with it. Net: one new small composable, roughly 25 duplicated lines deleted from two components, three silences closed. `switchToCanonical`'s deliberate fall-through to `pickFamilyFile` on `!ok` is preserved; only the terminal failure surfaces a message.

  ⚠️ **Two corrections found in pass 3, and together they are why B5 is its own commit rather than "one small composable" in a hotfix:**

  1. **`pickError` is not populated on the failure B5 exists to surface.** Re-verified this pass: `usePickBeanpodFile` touches `pickError` in exactly three places — the declaration (`:25`), the reset at the top of `pick()` (`:65`), and the auth `catch` (`:98`). `pickBeanpodFile(token)`'s structured `{ kind: 'failed', reason: 'config' | 'load' | 'open' | 'iframe' | 'timeout' }` returns straight through at `:105` with `pickError` still `null`. So "map a `failed` pick to `pickError`" would render an **empty message** for exactly the case it names (the picker script dying). The composable must derive the message from `result.reason` itself.
  2. **`pickError` holds a raw English `e.message`** from Google's auth chain. Rendering it ships untranslated English into the UI, and the CI-enforced i18n lint covers templates, not a ref's contents. Map `reason` → a translation key. The nearest precedent is `useJoinFlow.ts:605-616`, which maps the same `reason` union onto a `JoinErrorCode` whose registry entry carries the message key — mirror that shape (reason → key, message kept for telemetry context only), not a raw-string passthrough.

  ⚠️ **Do NOT instead set `podAccessError` from inside `rebindPodFile`.** It looks tidier and it is a trap: `shouldShowSaveFailureBanner` is computed as false whenever `shouldShowPodAccessBanner` is true (`syncStore.ts:328-331`), so the SaveFailureBanner would vanish mid-recovery and be replaced by a different banner. Keep the failure local to the surface that asked.

- **`useJoinFlow.doPickAndLoad`** reports `FILE_READ_FAILED` at `:625-633` instead of routing through `joinCodeForBlocker`, which its sibling `tryAutoLoadByFileId` (`:554-572`) does correctly seventy lines earlier. A joiner handed a newer-version file is told to ask for a new invite link instead of to update beanies. `joinCodeForBlocker` (`:97-105`) is already the shared mapper and needs no change; extract the shared **recordError** block into one local `recordFileLoadFailure(result, fallbackMessage)` in that composable and call it from both sites. Do not paste the blocker branch a second time, and do not confuse this with `asJoinDecryptError` (`:107-128`), which is the decrypt path and stays as it is.

### Deliberately not in this change

Grouped here so the requirement list above contains only work that produces a diff.

**A8. No `finally` in `src/components/login/`.** The seven mutating handlers in `LoadPodView.vue` that matter already have one (`:440`, `:543`, `:605`, `:672`, `:750`, `:846`, `:1018`; the file has ten `} finally {` in total), re-verified at `c6c8c298`. The hang is an unreturning await, not a skipped reset. Patching there would look like a fix and change nothing.

**A9. The liveness probe killing a busy worker.** `docClient.ts:839` cannot distinguish "wedged" from "executing synchronous WASM", so a large-but-progressing load can be declared dead and terminated. The honest fix is a progress signal posted from the worker around `loadCachedDoc` (`applyAndProject.ts:516`). That is a protocol change on the worker boundary and does not belong in a fix that has to ship quickly. A1 removes the unbounded wait; A4 narrows this path's blast radius for `initAndLoadCache` specifically (see A4, consequence 2); the general defect remains.

**A10. `database.ts:85-95`'s `deleteDB`.** Same `onblocked → resolve()` shape for the legacy entity DB. It is at least not _silent_ (it `console.warn`s at `:91`), those DBs are pre-migration remnants, and widening this change into them buys nothing for the reported symptom.

**B6. An `'import'` `PayloadFailureSource`.** `PayloadFailureSource` (`payloadFailureSurface.ts:36-44`) has no member for an import, so `surfacePayloadFatal`'s store link and its `app-update / blocked` event never fire from a pick. Adding one would put a full-screen fatal overlay on a _pick_ the user can simply retry, which is the wrong register, and the picker is **not** dark: `openFileFailure` already emits `pod-load-failure` with `action: 'picked-file-unreadable'` and `error_code: e.blockCode` (`syncService.ts:2127-2137`).

⚠️ **Where these deferrals are recorded matters, and "`docs/STATUS.md`" alone is not good enough.** `docs/STATUS.md` is 1.5 MB; a note in it is a note nobody re-reads, which is exactly the half-fixed-system failure mode this review is meant to catch. Each deferral gets **a two-line comment at the code it defers**, pointing at this plan, so the next reader of the _code_ finds it:

- A9 → `docClient.ts:839`, above the probe `request('ping', …)` call.
- A10 → **`database.ts:90-93`**, inside the `request.onblocked` handler beside the existing `console.warn`. (The previous draft said `:87`, which is `const request = indexedDB.deleteDatabase(dbName);` — the wrong line.)
- B6 → **not a comment but an edit**: correct manual criterion 12 in **`docs/plans/2026-09-07-native-update-gate.md:422`**, which today asserts the full-screen block appears for a hand-edited newer-version file without saying which surface opens it. Scope it to a cold-open / unlock path (where `surfacePayloadFatal` genuinely runs) and note that a Settings pick or a drag-drop shows the inline sentence instead. The archived copy at `docs/plans/2026-09-07-native-update-gate-pass4.md:447` is a historical pass record and is **left untouched**.

`docs/STATUS.md` gets the one-line summary as well, as the index. The comment is the primary record.

### Not in this plan

The Drive restore provider switch (`BUG-drive-restore-provider-switch.md`). It is a genuine defect and it makes the compaction rollback route strand a Chromium desktop user, but it is a design question with three viable answers and it does not block anyone from using the app today. It gets its own plan.

## Important Notes & Caveats

- **Group A is a fix to code that is already in production.** The bar is "does not make the deployed behaviour worse", and the degraded path it routes into is the one the suite already covers.
- **`withTimeout` verified, signature and all** (`src/utils/timing.ts:16`): `withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T>`, rejecting with a plain `new Error(message)` after `ms`, timer always cleared in a `.finally`. Its JSDoc is explicit that it does **not** cancel the underlying work. Both consequences are handled in A1 (close the late connection) and A1b (`e.name` is `'Error'`, so discriminate on `kind`).
- **A1's `CACHE_OPEN_TIMEOUT_MS` must stay well below `HEAVY_RPC_TIMEOUT_MS`** (`docClient.ts:87`) or the RPC ceiling fires first and the worker never gets to classify. It must also stay _above_ any plausible cold open; 10 s is roughly 100x the healthy figure.
- **Do not "fix" the light-sibling 45 s timeout.** The `rpc-timeout:initAndLoadCache` string greg saw came from a drained sibling carrying the crash reason (`docClient.ts:865`, `:289-291`). That is working as designed; the message is honest about the cause.
- **The cross-family safety comment at `syncStore.ts:891-901` is load-bearing.** Anything that changes when `loadedFromCache` is false must preserve the `dropDoc`/`no-local-document` reasoning, or a merge can produce durable cross-family corruption. A5 changes nothing there by design.
- **The OOM denylist at `applyAndProject.ts:518-551` says "Do not simplify this".** A3 edits the _body_ of that branch (the two lines at `:552-553`), never its condition at `:551`.
- **The worker cannot emit telemetry.** There is no `logEvent`/`reportError` in the worker realm, only a `{signal:'log'}` that `console`s on main (`docClient.ts:247-250`). Every observability requirement therefore lands on the main thread or rides an existing signal. This is also why the A2 flag has to cross the boundary at all.
- **`bootstrap.ts:38-39`'s comment is stale.** It says the `docWorker` flag is "off (prod default)", but `COMMITTED_FLAGS.docWorker` is `true` (verified, `featureFlags.committed.ts:13`). Prod runs the worker; inline is the spawn-failure fallback. Fix the comment in Commit 1; it misled the first draft of this plan, and A3b/B3/B4 fix four more stale comments for the same reason.
- **Five comments in this change state invariants the change inverts.** Fixing them is not tidying, it is the difference between a codebase that documents itself and one that lies: `bootstrap.ts:38-39`, `protocol.ts:155-158`, `diagnosticContext.ts:159` (Commit 1), `syncService.ts:2113-2119`, `fileSync.ts:125-128` (Commit 2).

## Assumptions

1. `podCompaction: true` is uncommitted in greg's tree (re-confirmed this pass: `git status` shows only `src/config/featureFlags.committed.ts` modified, and its diff is exactly the one line `podCompaction: false → true`). These fixes are independent of it and must not touch it.
2. No other session is editing `cache.ts`, `docClient.ts`, `applyAndProject.ts`, `syncStore.ts` or `SettingsPage.vue`.
3. Every file:line in this plan was re-verified against the working tree at `c6c8c298` during pass 4. Re-check before editing; a parallel session may have moved them.
4. `fake-indexeddb` implements the connection queue and fires `onblocked` on `deleteDatabase` with a live connection, which tests 1 and 3 require. `cache.test.ts` already runs `@vitest-environment node` with `import 'fake-indexeddb/auto'` (`:1-2`), so the harness exists. **Confirm on the first test, and if the queue is not modelled: do not improvise.** The stated fallback is to inject a seam, routing `indexedDB.deleteDatabase` through a module-local indirection that tests can substitute with a hand-rolled request object, rather than discovering the gap mid-implementation. An unstated fallback for a load-bearing assumption is how a hotfix acquires an afternoon.
5. **Timer control in the cache tests.** `withTimeout` uses a real `setTimeout`, so a naive test waits 10 real seconds. Drive it with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` — narrow on purpose, so `fake-indexeddb`'s own microtask/`setImmediate` scheduling is untouched — and advance by the exported `CACHE_OPEN_TIMEOUT_MS`. If the narrow fake still perturbs `fake-indexeddb`, fall back to a temporary override of the constant rather than to a real 10-second wait.

## Approach

### Commit boundaries

This is not optional, and it is not "one commit or two siblings" as an earlier draft allowed. Four commits, in this order:

| #   | Contents                  | Why it is its own commit                                                                                                                                                                                                             |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Group A** (A1-A7)       | The lockout. Must be revertable on its own: if the new bound misbehaves on a real device, reverting it must not also take away the refusal fix. A1-A3b are the load-bearing subset; A4/A6/A7 drop to a follow-up if they fight back. |
| 2   | **Group B** (B1a, B3, B4) | The reported refusal, roughly 45 lines net. Independently revertable, and independently verifiable by greg without a worker in a bad state.                                                                                          |
| 3   | **B1b + B2**              | A 330-line indentation-only unwrap plus a dead-predicate deletion in the app's most-reviewed page. No user symptom. Rebases over commit 2, so re-check B1a's slab.                                                                   |
| 4   | **B5**                    | A new composable and two component rewrites, with two defects found only in review. Shares no files with commit 3. Wants its own review, not a slot in a hotfix.                                                                     |

Commits 1 and 2 share no files at all. Commit 1 touches `syncStore.ts` only in `replaceDocWithCacheRecovery` (A6); commits 3 and 4 touch it only to delete `manualImport` and `supportsAutoSync`. Different regions of a 5,400-line file, trivially separable.

Each commit must be independently green on the full gate. Do not batch the gate at the end.

### Within Commit 1

Bottom-up, so each layer is correct before the one above it depends on it: `protocol.ts` (the `CacheClearResult` type and the `kind` widening, both pure type edits, plus the stale JSDoc), then `cache.ts` (A1, A2), then `applyAndProject.ts` (A3, A3b, the facade at `:1168-1171`, the dispatch at `:1415-1417`), then `docClient.ts` + `bootstrap.ts` (A2's read, A4, A7, the stale comment), then `syncStore.ts` (A6). Update `initAndLoadCache.oom.test.ts:29`'s mock in the same step as the `cache.ts` signature change, not later — it is the only mock of that module and it fails loudly if forgotten.

### Within Commit 2

B1a is standalone. B3 and B4 land together, because B4 widens what B3 must carry (a numeric version has to reach `openFileFailure` as a typed blocker before B3's separation means anything for greg's file).

## Files Affected

**Commit 1 (Group A)**

- `src/services/automerge/worker/protocol.ts` (A2's `CacheClearResult`; A3b's `kind: … | 'open'` + the `:155-158` JSDoc)
- `src/services/automerge/worker/cache.ts` (A1 incl. the exported `CACHE_OPEN_TIMEOUT_MS`, A2)
- `src/services/automerge/worker/applyAndProject.ts` (A3, A3b: `reseedCacheAfterCorruption` + `raiseCachePersistFailure`, the facade at `:1168-1171`, the dispatch at `:1415-1417`)
- `src/services/automerge/worker/docClient.ts` (A2's read + `logEvent`, A4, A7) + `bootstrap.ts` (stale comment)
- `src/stores/syncStore.ts` (A6 only)
- `src/utils/diagnosticContext.ts` (A3b: the stale `cache_persist_kind` comment at `:159`)
- Comments only: `docClient.ts:839` (A9 marker), `database.ts:90-93` (A10 marker)
- ⚠️ **`src/services/indexeddb/database.ts` is NOT modified beyond the A10 marker comment.** An earlier draft listed it; keeping `docClient.clearCache` at `Promise<void>` removes it, and the sign-out path, from the diff.
- Tests: `cache.test.ts`, a new `cache.openTimeout.test.ts` (the late-open case needs `vi.mock('idb')`, which cannot live in `cache.test.ts` — that file imports the real `openDB` at `:7` for its own assertions), `applyAndProject.test.ts`, **`initAndLoadCache.oom.test.ts` (the `clearCache` mock — REQUIRED, not optional)**, `docClient.test.ts`, a `syncStore` cache-recovery test

**Commit 2 (Group B)**

- `src/pages/SettingsPage.vue` (B1a, 3 lines of markup at one site)
- `src/services/sync/syncService.ts` (B3, including the `:2113-2119` JSDoc rewrite)
- `src/components/login/LoadPodView.vue` (B3: `applyFileLoadFailure` + both call sites)
- `src/services/sync/fileSync.ts` (B4, including the `:125-128` comment rewrite)
- Tests: `openFileVersion.test.ts`, `fileSync` tests, a new `SettingsPage.importError` component test

**Commit 3 (B1b + B2)**

- `src/pages/SettingsPage.vue`, `src/stores/syncStore.ts`, `src/services/sync/capabilities.ts`, `src/services/translation/uiStrings.ts` (six keys), the 13 `canAutoSync` mock lines

**Commit 4 (B5)**

- `src/composables/useRebindPodFile.ts` (**new**), `src/components/common/PodAccessBanner.vue`, `src/components/google/SaveFailureBanner.vue`, `src/composables/usePickBeanpodFile.ts` (only if the reason→key mapping is placed there rather than in the new composable), `src/composables/useJoinFlow.ts`, `src/services/translation/uiStrings.ts` (pick-failure keys), `useJoinFlow` tests

**All commits**

- `CHANGELOG.md`, `docs/prompts/2026-09/2026-09-07-native-update-gate.md` (append), `docs/STATUS.md` (the A9/A10/B6 index line), plus the one-off `docs/plans/2026-09-07-native-update-gate.md:422` edit (B6)

## Observability Coverage

Everything below reuses an existing surface. **No new `logEvent` surface for the cache open, and no new context keys**: `error_code` (`diagnosticContext.ts:69`), `detail` (`:185`), `action` (`:68`), `cache_persist_kind` (`:162`), `cache_persist_error` (`:163`), `recovery_method` (`:171`), `recovery_attempt` (`:172`) are all already in `ALLOWED_CONTEXT_KEYS` (declared at `:61`), re-verified this pass, so no Lambda-allowlist mirror and no store data-collection-table update is needed. Only a stale comment beside two of those keys changes. `level`, `surface` and `message` are system fields and are not allowlist-filtered (`logEvent.ts:19-22`).

| Fact                                                               | Channel                                                                                                    | New code?                                                        | Commit |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------ |
| The cache open timed out                                           | `surface()` → `notifyFailure` → `reportError({surface:'doc-worker', severity:'error'})`                    | **none**, automatic for any non-`RemoteBlocker` worker rejection | 1      |
| The RPC gave up and tore the worker down                           | `reportError({surface:'doc-worker-recovery'})`, `docClient.ts:866`                                         | **none**, already unconditional                                  | 1      |
| A blocked delete left the cache alive after sign-out (**privacy**) | `logEvent` at `warn`, surface `cache-persist`, `error_code:'delete-blocked'`                               | 1 call in `docClient.clearCache` (A2)                            | 1      |
| The cache DB is unavailable, so nothing is persisting              | existing `cache-persist-failed` signal → `reportError({surface:'cache-persist'})` **+ `DurabilityBanner`** | `kind:'open'` via `raiseCachePersistFailure` (A3b)               | 1      |
| We adopted the remote wholesale instead of merging                 | `logEvent`, surface `pod-open-degrade`, **both arms** so the rate is measurable                            | 1 call (A6)                                                      | 1      |
| A rehydrate after respawn/inline-fallback failed                   | `reportError({surface:'doc-worker-recovery', action:'rehydrate-failed'})`                                  | 1 shared call, 2 sites (A7)                                      | 1      |
| A picked file is unreadable                                        | `reportError({surface:'pod-load-failure', action:'picked-file-unreadable'})`                               | **none**, already there (`syncService.ts:2127`)                  | 2      |
| A rebind was refused                                               | rendered by B5's composable; the catch already reports                                                     | **none** in the catch                                            | 4      |

**Nothing here pages.** A cache that will not open degrades to a remote load; it is not data loss.

## Acceptance Criteria

**Commit 1 (Group A)**

- [ ] `initPersistenceDB` cannot wait forever: a queued-behind-delete open rejects inside `CACHE_OPEN_TIMEOUT_MS`, using the shared `withTimeout`. **No second timeout helper exists in the tree afterwards**, and **no new error class was added**.
- [ ] **An open that arrives late, after its timeout, is closed and never installed as `cacheDb`.** Otherwise the fix trades a hang for a cache that can never be deleted.
- [ ] `clearCache` returns `{ deleted: false }` on a blocked delete; no caller re-opens the DB in that case; `docClient.clearCache` still returns `void` and `database.ts`'s sign-out path is unchanged; and one `warn` event is emitted instead of resolving as success.
- [ ] `initAndLoadCache.oom.test.ts`'s `clearCache` mock returns `{ deleted: true }` and all four of that file's tests are green — the reseed helper must not throw a TypeError over the classification they assert.
- [ ] A failed re-open after a clear never replaces the original `CorruptPayloadError`, and the invariant is stated on `reseedCacheAfterCorruption` rather than inferred from the call site.
- [ ] A worker left with no cache DB raises the **existing** `DurabilityBanner` and the `cache-persist` report, and **`markPersistOk()` can still clear it** (the worker-local flag was set by the same writer).
- [ ] One failed `initAndLoadCache` runs it at most twice, not three times, and no existing docClient retry test needed changing.
- [ ] A cache that will not open produces the existing cache-MISS path, with the document loaded from the remote and the spinner cleared, **without any bound in `syncStore`**.
- [ ] No `console.warn`/`console.error`-only failure remains on the cache-recovery or rehydrate path.
- [ ] The three stale comments are corrected: `bootstrap.ts:38-39`, `protocol.ts:155-158`, `diagnosticContext.ts:159`.
- [ ] A9 and A10 markers exist **at the code** (`docClient.ts:839`, `database.ts:90-93`), not only in `docs/STATUS.md`.

**Commit 2 (Group B)**

- [ ] `importError` renders for **both** entry buttons, from **one** render site — including the `!syncStore.isConfigured` state, which today has no slab at all. **Verified by triggering it in a mounted component test in that state, not by reading the template.**
- [ ] A refused pick no longer sets the pod's `lastError`, Force Save is not offered beside it, the picker spinner still clears, and a **dropped** newer-version file shows the same sentence as a picked one.
- [ ] A non-beanpod (non-JSON) file still reports through `lastError` with no `payloadError` — the non-blocker arm was not collateral damage.
- [ ] `"version": 6.0` as a JSON number produces an `UnsupportedBeanpodVersionError` with `detail` = `version=6` (documented as the correct, unavoidable value).
- [ ] The two comments B3 and B4 invert are rewritten in the same commit (`syncService.ts:2113-2119`, `fileSync.ts:125-128`).
- [ ] The native-update-gate plan's manual criterion 12 is corrected (B6) at `docs/plans/2026-09-07-native-update-gate.md:422`.

**Commits 3 and 4 (Group C)**

- [ ] `syncStore.manualImport`, `handleManualImport`, `canAutoSync` and `supportsAutoSync` are gone, and the tree greps clean for all four.
- [ ] Commit 2's `importError` slab still renders after the unwrap, in both former sub-states.
- [ ] All six translation keys whose sole reference was the deleted branch are removed (`noAutoSyncWarning`, `downloadYourData`, `downloadDataDescription`, `loadDataFile`, `loadDataFileDescription`, `importNeedsPassword`); `action.download` and `action.load` survive. Each was re-checked with a quoted, exact-key grep, not a substring one.
- [ ] A refused Drive rebind and a _failed_ (not cancelled) Drive pick each show a **translated, non-empty** message on both banners, through one shared composable; a newer-version file in the join flow tells the joiner to update.

**Every commit**

- [ ] Full gate green **on that commit**, not batched at the end; every new test mutation-checked against the regression it pins.

## Testing Plan

**Commit 1**

1. **Unit, the bound (`cache.test.ts`):** hold a second `openDB` connection, call `clearCache` → expect `{ deleted: false }`; then `initPersistenceDB` rejects within the deadline rather than pending, and `isCacheReady()` is still false afterwards. Drive the clock with the narrow fake timers of assumption 5 and the exported `CACHE_OPEN_TIMEOUT_MS`. Mutation-check by removing `withTimeout` (the test must hang or fail).
2. **Unit, the late open (new `cache.openTimeout.test.ts`):** `vi.mock('idb')` with an `openDB` that resolves a spy object carrying `close()` _after_ the timeout has fired; assert `close()` was called and `cacheDb` is still null (via `isCacheReady()`). This is the criterion that stops the fix from creating an undeletable cache. It needs its own file because `cache.test.ts` imports the real `openDB`.
3. **Unit, the pairing (`applyAndProject.test.ts`):** a blocked `clearCache` does NOT call `initPersistenceDB`, **and** the thrown error is still the original `CorruptPayloadError`, **and** `sink.cachePersistFailed(true, {kind:'open', errorName:'DeleteBlocked'})` fired, **and** a subsequent successful persist clears it via `markPersistOk()` (the sink receives `false`). All four must fail when the guard is removed; the fourth must fail if `raiseCachePersistFailure` forgets the worker-local flag.
4. **Unit, the multiplication (`docClient.test.ts`):** one `initAndLoadCache` timeout results in at most two worker invocations, and the rejection reaches the caller. Add the liveness-false-positive case (A4 consequence 2): a probe that answers now rejects rather than re-issuing. Mutation-check by putting `initAndLoadCache` back in `RETRYABLE_METHODS` — the count must become three.
5. **Unit, the degrade (`syncStore`):** a rejected `initAndLoadCache` produces `loadedFromCache = false` and a `no-local-document` basis, the promise resolves, and the `pod-open-degrade` `logEvent` fired on the failure arm carrying the error name, and on the success arm too with `error_code: 'hit'`.

**Commit 2**

6. **Component, the slab (`SettingsPage`):** mount with the harness pattern from `SettingsPage.deleteFamily.test.ts` (its `vi.hoisted` mock set is the template), with `syncStore.isConfigured` **false** so the test stands in the sub-branch that has no slab today. Open the confirm dialog from the `:1611` button, confirm, drive `loadFromNewFile` to a `payloadError` result, assert the red slab renders with the blocker's message. Mutation-check by deleting the new slab — the test must fail. This is the one that source-grepping cannot prove, and it is the reported bug.
7. **Unit, the channels (`openFileVersion.test.ts`):** a 6.0 file yields `payloadError` **and** `lastError === null`; the existing 4.0/5.0 and non-JSON cases stay green unchanged (the latter still yields `lastError` with no `payloadError`).
8. **Unit, the version (`fileSync`):** `6.0` (number), `"6.0"` (string) and `"7"` all throw `UnsupportedBeanpodVersionError`; `undefined` and `null` still throw the plain "missing version" error; the number case pins `detail === 'version=6'`.

**Commit 4**

9. **Unit, the join mapping (`useJoinFlow`):** `doPickAndLoad` with a newer-version file records `FILE_NEWER_VERSION`, not `FILE_READ_FAILED`.
10. **Component, the pick failure:** a `{ kind: 'failed', reason: 'load' }` pick renders a **non-empty, translated** message on both banners. This is the case an earlier draft would have rendered blank.

**Manual, greg, on the real dev family** (the point of the exercise). Run the first two after commit 1, the rest after commit 2, so a failure points at one commit:

- With a second tab open on the app, force the corrupt-cache path and confirm the app degrades to a remote load instead of spinning, and that the durability banner appears if the cache stayed shut.
- Confirm sign-out and clear-data still work after a cache failure, and that the cache is genuinely gone afterwards (not merely reported as gone).
- Pick **and** drag-drop a hand-edited newer-version file from Settings and the welcome gate; confirm the refusal renders in the right place, with no Force Save beside it. **Do the Settings pick twice: once with a family open (configured) and once from the not-configured state**, because those are two different render paths and only one of them had any slab before this change.
- Confirm the spinner clears and a message appears.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from three investigation reports; scoped to the hang and the unrenderable refusal, with the Drive restore split out and the liveness probe explicitly deferred.
- **Pass 2 (DRY + error handling)**: reuse `withTimeout`/`DurabilityBanner`/`POD_ACCESS_ERRORS` instead of three new mechanisms; dropped A5's duplicate timeout and A1's unfirable `blocked` callback and its unearned error class; caught that A3 as written would have silenced `persistOnce`, that B1's "restore the manual-import button" would have added a confirmation-less duplicate import, and that B3 would have regressed the drag-drop path; extracted `useRebindPodFile` over two banners.
- **Pass 3 (Sustainability)**: split one commit into four so the lockout fix is revertable alone and the 330-line template unwrap, the dead-predicate deletion and the new banner composable leave the hotfix entirely (Group C); found three defects (an abandoned `openDB` that would leave an undeletable cache, a `markPersistOk()` that could never clear the durability banner, and a `pickError` that is null for the very failure B5 renders); replaced A2's `Promise<boolean>` with a named `CacheClearResult` that keeps `docClient.clearCache` and the whole sign-out path out of the diff; flattened A3 into a named never-throwing helper; enumerated every consumer of the widened `kind` union (no exhaustive switch exists, so nothing else changes) plus the two comments it makes stale; and moved the A9/A10/B6 deferral markers from `docs/STATUS.md` into comments at the deferred code.
- **Pass 4 (Fresh-eyes sweep)**: re-verified every file:line against `c6c8c298` and found three things that would have broken during implementation — B1a's single slab at `:1875` would have left the `!isConfigured` button (the state a locked-out user is in) exactly as mute as today, so it moves to one site covering both sub-branches; `initAndLoadCache.oom.test.ts:29` mocks `clearCache` as returning `undefined`, so A3's destructure would have thrown a TypeError out of a "never throws" helper and failed three tests, fixed by updating the mock and reading `result?.deleted`; and `settings.loadDataFile`'s "4 references, keep it" was a substring match on `loadDataFileDescription` — it has one call site, in the deleted branch, so all six keys go. Also corrected four wrong citations (`docClient.ts:479-488`→`:499-507`, `database.ts:87`→`:90-93`, `capabilities.ts:143-146`→`:139-146`, `useJoinFlow.ts:618-628`→`:625-633`), supplied A6's missing `errName` declaration and placement, added the two comments B3 and B4 invert (`syncService.ts:2113-2119`, `fileSync.ts:125-128`) to the required edits, named the B6 file and line, added fake-timer and `vi.mock('idb')` guidance so tests 1 and 2 are writable, scoped B3's LoadPodView helper to the three genuinely shared failure rungs, and marked A1-A3b as the minimum revert target so A4/A6/A7 cannot delay the lockout fix.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial prompt

> go ahead to fully plan and implement these fixes. at the moment i'm locked out of the dev family as even if i try to open the local file, the spinner spins forever. once the plan is complete proceed with implementation. once implementation is done, run a code review against the implemented code to ensure all changes were implemented correctly, then provide a test plan for me to test once more

### The reports it acts on

> for step 2, i believe there is an issue with the design for loading another data file [...] it switches the family to local file. Further, session B remained on the google drive (compacted) file and did not also switch to local file after the import.

> during step 4, when trying to import a new family file, i received a message that the file version was newer, but it did not prevent me from loading the file. i can confirm the version in the file is still reading at 6.0. in addition, when trying to load the newer file from the welcome gate, the sign in spinner appears to be spinning indefinitely.

> i've tried to load the dev family again from google drive from the welcome gate (to go back to the previous file in google). After the spinning ran for ~60s or longer, I got this error: rpc-timeout:initAndLoadCache

### Pass 2 review prompt

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code. [...] Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Pass 4 review prompt

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.

</details>
