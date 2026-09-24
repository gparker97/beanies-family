# Plan: "Sign out and clear data" releases the local cache in every tab

> Date: 2026-09-24
> Related issues: Notion #100 (migrated from GitHub #346). No GitHub issue.
> Plan file: `docs/plans/2026-09-24-clear-data-signout-releases-cache-in-every-tab.md`

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a parent signing out of beanies on a shared or borrowed computer with "Sign Out & Clear All Data From This Browser", I want every trace of my family's data to actually leave the browser, including any other beanies tab I forgot about, so that the promise on the sign-out screen and on the privacy page is true, and so that the next person to sign in on this browser gets a working app rather than one that has quietly stopped saving locally.

## Context

Post-ADR-032 there is one Automerge doc worker per tab, and each worker holds its own IndexedDB connection to the encrypted cache `beanies-automerge-<familyId>` (`src/services/automerge/worker/cache.ts:81,126`). "Sign out and clear data" runs the CLEAR step list (`src/services/auth/signOutSteps.ts:101-122`), whose `deleteFamilyDb` step calls `deleteFamilyDatabase` -> `docClient.clearCache` -> worker `cache.clearCache`, which closes THIS tab's connection and then calls `indexedDB.deleteDatabase` (`cache.ts:502-524`).

Three things go wrong when a second beanies tab is open on the same family:

1. **The delete never completes.** Every other tab's worker still holds a connection, so the delete request fires `onblocked` and stays queued. `cache.clearCache` resolves `{ deleted: false }` (`cache.ts:522`), `docClient.clearCache` logs a warn and returns `void` on purpose (`docClient.ts:1627-1657`), and neither `deleteFamilyDatabase` (`database.ts:66-82`) nor the sign-out flow ever learns. The person is told nothing. The encrypted cache is still on disk.
2. **Every later open times out.** An `openDB` queued behind a pending delete fires no event at all, because the DB is opened at version 1 forever and `blocked` only fires for a version change (`cache.ts:86-90`). So the next sign-in in any tab waits `CACHE_OPEN_TIMEOUT_MS` (10 s, `cache.ts:100`), throws `CacheOpenTimeoutError`, and that session runs with no local persistence. A refresh does not help while the other tab lives.
3. **The other tab stays signed in.** It has the family key in memory and the data on screen, and it keeps writing to the cache. Nothing tells it that the person signed out. There is no `BroadcastChannel`, `storage` listener or `SharedWorker` anywhere in `src/`; the only cross-tab primitive is the per-family actor Web Lock in `src/services/automerge/actorLease.ts`.

The interim mitigation (`f130ac47`) only changed the durability banner copy to say this "often" happens with several tabs, because the failure `kind` stops at telemetry: `onCacheFailureChange` hands subscribers a bare boolean (`syncService.ts:651-666`, `uiStrings.ts:2737-2742`).

Verified facts that bound the exposure: the cache is AES-GCM encrypted with the family key, and the CLEAR tier also removes the device's cached family key and PIN wraps. What survives on disk is ciphertext with no key on the device. The live exposure is the other tab, which stays signed in. The deletion is nevertheless a stated promise (`web/src/pages/privacy.astro`, `CLAUDE.md`), and the open-timeout cascade degrades every later session on the device, so the fix stays High.

Two further silent failures found on the same paths during Pass 2, fixed here because they sit on the exact call sites this plan touches:

- `FamilyPickerView.deleteFamily` (`FamilyPickerView.vue:90-98`) discards the `false` that `familyContextStore.deleteLocalFamily` returns after swallowing a throw (`familyContextStore.ts:158-170`): the row disappears and the person is told nothing.
- `SettingsPage.handleClearData` (`SettingsPage.vue:1328-1356`) calls `window.location.reload()` immediately after `deleteFamilyDatabase`, so no outcome shown there can survive to be read.

## Requirements

1. When any tab deletes the family cache (clear-data sign-out, Settings "Clear Data", "forget this family" in the picker, the Settings delete-family flow, or corruption re-seed), every other tab holding a connection to that database releases it promptly, so the delete completes instead of blocking.
2. A tab whose cache was deleted by another tab ends its session: it stops writing, drops the family key from memory, and lands on the login screen. It must not delete anything itself (the deleting tab owns that) and must not recreate the cache, and that last property is enforced in the worker, not left to timing.
3. The deleting tab waits for the delete to actually complete, with a bounded timeout. A delete that is still blocked after the timeout is a surfaced outcome: the sign-out (or clear / forget action) still finishes, but the person is told the cache could not be cleared and what to do about it, and it is never reported as clean.
4. The result of `clearCache` (`{ deleted: boolean }`) is acted on at every call site instead of being ignored, and an unknown result (an older worker bundle answering `{}`) is treated as not deleted, never as clean. Where a call site cannot show anything (it hard-reloads, or it is a non-interactive teardown), "acted on" means the outcome is logged and the discard is written down at the call site, never a silent `void`.
5. The cache-failure `kind` (`open` / `base` / `increment`) and error name reach the UI, so the durability banner and the Settings warning can say "close your other beanies tabs" when that is the cause, and "your browser may be low on storage or in private mode" when it is a write failure, instead of hedging with "often".
6. Ordinary trusted-device sign-out keeps preserving the cache exactly as today, and other tabs are unaffected by it.
7. No new telemetry context keys. Success and blocked outcomes are emitted on the existing `cache-persist` and `login-flow` surfaces using allowlisted keys.
8. All user-visible copy goes through `uiStrings.ts` with `en` + `beanie` values; `beanie` values on this important surface keep the real nouns ("tab", "data", "browser").
9. No new step list, no new sink chain, no new toast/modal component: every piece of the flow reuses an existing list, helper, or UI element (see Approach for which).

## Important Notes & Caveats

- **The database name is `beanies-automerge-<familyId>`** (`cache.ts:81`), not `beanies-cache-` as the tracker row says. The tracker row's `Current` text should be corrected when the row is closed.
- **`versionchange` is the built-in cross-tab signal.** Per the IndexedDB spec, `deleteDatabase` fires `versionchange` (with `newVersion === null`) on every open connection to that name before it can proceed; `idb`'s `openDB` exposes it as the `blocking(currentVersion, blockedVersion, event)` callback (`node_modules/idb/build/entry.d.ts:24-30`, wired at `node_modules/idb/build/index.js:184-186` as a `versionchange` listener), where `blockedVersion === null` means a delete. A connection that closes inside that handler no longer blocks. No `BroadcastChannel` is needed for the delete itself, and none is added: the delete IS the broadcast, and it reaches exactly the tabs that hold this family open, including a tab in another window or the installed PWA on the same origin.
- **`idb` already ships the wait-for-success delete.** `deleteDB(name, { blocked })` (`node_modules/idb/build/index.js:196-205`) resolves only on `onsuccess`, rejects on `onerror`, and calls `blocked` while it waits. The hand-rolled promise in `cache.clearCache` (`cache.ts:511-523`) is that function with the wrong resolution on `onblocked`; it is replaced, not extended.
- **Closing inside `blocking` is safe mid-save.** `IDBDatabase.close()` sets the close-pending flag: transactions already in flight complete, new ones are refused, and the delete proceeds once the connection is fully closed. The deleting tab's timeout covers the case where that takes a while. A write that started before the release and fails after it is not a durability failure of this device and must not raise the banner or a `cache-persist` warning; the `persistOnce` catch checks `isCacheReady()` for exactly that. The guard belongs ONLY in a catch that follows a successful open: on a failed open `cacheDb` is null by construction, so the same check inside an open catch would swallow every real open failure. `persistSnapshotOnce`'s catch (`applyAndProject.ts:299-303`) is console-only and never raises the signal, so it needs no guard.
- **`versionchange` is delivered as an event task, never a microtask.** So by the time any `blocking` callback can run, the `await openDB(...)` continuation in `initPersistenceDB` has already completed and the open's own handle is known to the closure. That is what lets the handler tell "the module's live connection" from "a stale late-open" with a plain closure variable, without importing `unwrap` or comparing raw `IDBDatabase` objects. The closure handle MUST be assigned before the `await maxIncSeq(...)` that follows (`cache.ts:161`), which is the first task boundary after the open; assigning it beside `cacheDb = db` (`cache.ts:159`) satisfies that.
- **A frozen or discarded background tab cannot answer.** Chrome may freeze a background tab's JS (including its dedicated worker). Its connection stays open until it thaws, so the delete stays blocked. This is the only case left where the deleting tab times out. When the frozen tab later resumes, `versionchange` fires, it closes and ends its session, and the queued delete then completes on its own. Until then, opens in other tabs still queue behind the pending delete, so the timed-out outcome must be surfaced with copy that names the cause (close the other beanies tabs and windows).
- **The deleting tab must not receive its own `versionchange`.** `cache.clearCache` already closes its own connection before calling `deleteDatabase` (`cache.ts:503-508`), so the worker's `blocking` handler never fires for a delete the same worker requested. Keep that order. In the RPC path that close now happens one call earlier, in `applyAndProject.clearCache` -> `reset()` (step 1), so `cache.clearCache`'s own close becomes a no-op there; it stays because `reseedCacheAfterCorruption` (`applyAndProject.ts:370`) calls `cache.clearCache` directly with the handle still open.
- **`clearCache` is in `RETRYABLE_METHODS`** (`docClient.ts:643`) and runs under `DEFAULT_RPC_TIMEOUT_MS` (45 s, `docClient.ts:83`). Verified: the 5 s delete bound sits well inside the RPC ceiling, so the worker classifies the outcome rather than the RPC layer tearing it down; and a re-issue after a worker respawn queues a second `deleteDatabase` on the same name, which settles together with the first, so the retry stays idempotent. No change.
- **`docClient.clearCache` is `Promise<void>` on purpose today** (`docClient.ts:1627-1632`) to keep authStore out of the durability-signal change. This plan brings authStore into scope, so the return type changes. Update the comment, do not work around it. The same block's "it can still over-report in one narrow window" paragraph (`docClient.ts:1640-1647`) is retired with it: the wait is now real and bounded, and a stale late-open connection answers `versionchange` by closing (step 1), so the window it describes no longer exists.
- **Only a delete triggers the evicted-tab teardown, never an upgrade.** The DB is opened at version 1 forever, so `blocking` with a non-null `blockedVersion` cannot happen today. It is handled entirely inside the worker realm: the connection is closed and the existing durability signal is raised (`raiseCachePersistFailure('open', 'CacheUpgradeElsewhere')`), which reaches telemetry and the banner through channels that already exist. The impossible branch therefore never widens the new `cache-released` signal, its handler, or the main-thread session-end path with a `reason` that every layer has to switch on.
- **The inline executor** (`docClient.ts:75-77, 258-263, 399`; wired in `src/services/automerge/worker/bootstrap.ts:18`) runs the same `cache.ts` module on the main thread when the worker cannot spawn. Today its sink (`inlineBridge.ts:30-41`) hand-mirrors the worker's sink (`docWorker.ts:27-37`) and `docClient.handleSignal` (`docClient.ts:311-339`) mirrors both, with a second handler setter (`setInlineCachePersistFailedHandler`) that `syncService.ts:2509-2510` has to wire beside `docClient.setCachePersistFailedHandler`. Adding a fourth signal to five places is the duplication this pass removes (Approach step 3).
- **`syncService` does not import the auth store** (verified: its only store import is `translationStore`), so the "ends the session" reaction cannot be wired there without creating a new store dependency in a service. It is wired in `bootstrap.ts`, the declared one-time home for main-thread `docClient` handler wiring (`setInlineExecutor`, `setRehydrator` already live there; `bootstrap.ts` is imported only by `main.ts`). That keeps the wiring beside its siblings, off the component tree, and without an unmount branch that can never run. Import graph verified: `useSignOut.ts` pulls `@/router` and the stores, none of which import `bootstrap.ts`, and `main.ts` evaluates `./router` (`main.ts:5`) before `bootstrap` (`main.ts:11`), so the static import creates no cycle and no TDZ. A static import is used, not a lazy `import()`: the whole graph is already loaded by the time `bootstrap` evaluates.
- **The evicted tab's step list already exists.** The non-destructive teardown a peer tab needs (bounded force-save, cancel reminders, clear this tab's in-memory Google session but keep stored tokens, reset sync, reset the worker doc, sweep hand-off files, clear kept recipe) is exactly `SIGN_OUT_TRUSTED_STEPS` (`signOutSteps.ts:71-79`). Dropping stored tokens there would be wrong: after a Settings "Clear Data" in tab A (which keeps tokens and reloads), tab B stripping the refresh token would break tab A's silent reconnect. No new list: the evicted path refers to it through a named alias so the two properties it relies on (no delete or key-material step; contains `resetDocClient`, which is what clears the worker latch) are documented and asserted where the lists live.
- **Evicted-tab teardown must not force a Drive save that fights the deleting tab.** The deleting tab already ran `quietTeardownAndForceSave` and, in the CLEAR tier, `clearAllRefreshTokens`. The evicted tab attempts the same bounded best-effort save (unsaved edits are worth 3 s), but a failure there is a `step_failed` warning from `runSignOutSteps`, never a page, and never blocks the teardown.
- **The `versionchange` guard only ends a session when this tab is not already leaving.** If `useSignOut.phase` is `signing-out`, this tab's own sign-out is in flight and will land on login by itself; the signal is logged and otherwise ignored. There is no `isAuthenticated` guard: a tab on the person picker after "switch person" (tier 1), or one whose passkey sign-in never bound to the roster (`abandonThinSession`), still has the pod open in the worker and must tear down too. The "closed here too" toast copy is written so it is true for those tabs as well as for a signed-in one.
- **An open kit guard is parked, not cancelled first.** Resolving the guard as `cancelled` before the evicted teardown would let the parked `signOut()` return in the next microtask and run its `finally`, which resets `phase` to `idle` under the running teardown: the progress overlay would vanish and a second, concurrent user sign-out would become possible. So the evicted path takes `phase = 'signing-out'` (which hides the confirm or the guard modal by `v-if`), runs, and resolves any parked guard as `cancelled` in its own `finally`, after which the parked `signOut()` returns harmlessly into an already-idle phase. No ownership token, no extra state. The `awaitKitGuard` wrapper emits `kit_guard_outcome: cancelled` on that resolve, which is the honest record of an abandoned guard.
- **Two escape-hatch callers of `signOutAndClearData` cannot show an outcome.** `App.vue:1759` (fatal overlay, followed by `hardReload()`) and `demoSeed.ts:111` (review-demo teardown after a failed seed) call it outside `useSignOut`. Neither can surface a toast (one reloads immediately, the other is a non-interactive cleanup on a reviewer path). Their result is deliberately discarded with a comment, and telemetry is still complete: `docClient.clearCache` logs `delete-blocked` at the worker level regardless of caller. No `kind` is added to `emitCacheKept` for them.
- **A blocked "forget this family" holds the picker for up to 5 s.** `familyContext.deleteLocalFamily` now awaits the bounded delete, and the picker has no busy state. A peer that answers `versionchange` releases in milliseconds, so the 5 s wait is reached only for a frozen tab; that is accepted rather than adding a spinner to the picker in this plan.
- **Never a bare `catch {}`.** Every new branch logs with structured context.
- **Do not add a feature gate.** Ship ungated.
- **Native apps are out of scope.** A Capacitor app has a single WebView, so the multi-tab case does not arise; nothing in this plan is gated on platform, it simply never fires there.

## Assumptions

> **Review these before implementation.** These were valid at the time of planning but may have changed.

1. `idb` is at 8.0.3 (`package.json:76`) and `openDB` accepts `blocking` / `blocked` / `terminated` callbacks and `deleteDB` accepts `blocked` (`node_modules/idb/build/entry.d.ts:24-59`). Verified.
2. `fake-indexeddb` 6.2.5 (`package.json:118`, imported per test file via `fake-indexeddb/auto`) delivers `versionchange` to other open connections in the same realm before firing `blocked` on `deleteDatabase` (`node_modules/fake-indexeddb/build/esm/FDBFactory.js:62-90`). Verified, so the cross-connection release is unit-testable without a browser.
3. The worker is one per tab (`docClient.ts:103-104`), there is no `SharedWorker`, and the only existing cross-tab primitive is the actor Web Lock (`actorLease.ts:62`).
4. `syncStore.cachePersistFailed` (`syncStore.ts:993-996`, exported `:6783`) is the only subscriber to `onCacheFailureChange` (plus the `__mocks__/syncService.ts:51` stub), consumed by `DurabilityBanner.vue:26`, `SettingsPage.vue:2667-2672` and `WallStatusStamp.vue:47`.
5. The CLEAR / UNTRUSTED / TRUSTED step lists live as data in `src/services/auth/signOutSteps.ts` and `runSignOutSteps` (`:204-225`) isolates each step's failure and reports it as `step_failed` on `auth-signout`.
6. `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`) already contains `action`, `error_code`, `kind`, `detail`, `stage`, `cache_persist_kind`, `cache_persist_error`. This plan adds none.
7. `bootstrapDocClient()` runs once from `main.ts:20` and `bootstrap.ts` is imported nowhere else (verified). It runs before `app.use(createPinia())` (`main.ts:44`), which is fine for a handler that only calls `useAuthStore()` when it fires, never at wiring time. Toasts render on `/login` (precedent: `LoginPage.vue:362` shows `auth.memberRemoved` via `showToast` after the #77 eviction). `SignOutHost.vue` is mounted once at the App root and renders the `signing-out` overlay for whichever flow set that phase.
8. `useConfirm.alert` (`src/composables/useConfirm.ts:106`) is the existing awaitable info modal, keyed by `UIStringKey` title + message; `showToast` (`useToast.ts:92`) supports a `warning` type that never auto-reports.
9. `emitSignoutTier` (`src/services/telemetry/loginFlowEvents.ts:269-279`) is the existing sign-out telemetry helper on the `login-flow` surface and its `tier` union is a literal type.
10. Every `cache.initPersistenceDB` caller in `applyAndProject.ts` (`:316` in `loadProjectionSnapshot`, `:384`, `:618`, `:635`) re-opens idempotently when the handle is null, and `persistOnce` / `persistSnapshotOnce` early-return on `!isCacheReady()`. Verified, so closing the handle inside `reset()` cannot strand a later write. `loadProjectionSnapshot`'s open sits inside a catch that returns `{ hit: false, reason: 'error' }`, so a `CacheReleasedError` there degrades to a console warn and the authoritative rebuild, never a banner.
11. `SettingsPage.deleteFamily.test.ts:43` mocks `familyContextStore.deleteLocalFamily` as `async () => true`, and `src/composables/__tests__/useSignOut.test.ts:59-62` mocks `loginFlowEvents` with only `emitKitGuard` / `emitKitGuardOutcome`. Both mocks must widen with the code (Files Affected).

## Approach

### 1. Worker: release the connection when another context deletes the DB, and refuse to re-open it (`cache.ts`)

One internal close helper replaces the three copies of "close, null the handle, null the family, reset `incSeq`" at `cache.ts:121-124`, `:503-508` and `:527-534`:

```ts
function closeHandle(): void {
  cacheDb?.close();
  cacheDb = null;
  cacheDbFamilyId = null;
  incSeq = 0;
}
```

The `releasedFamilyId` latch is cleared in exactly ONE function, `closeCacheDB()`, which becomes `closeHandle(); releasedFamilyId = null;`. It is the "this session is over" close. `clearCache` (own delete) and `__resetCacheForTesting` both call `closeCacheDB()` rather than repeating the latch reset; `__resetCacheForTesting` additionally nulls `releasedListener`. `initPersistenceDB`'s family-switch close (`:121-124`) uses `closeHandle()` alone, because a switch to another family must not clear a latch set for the released one.

`initPersistenceDB(familyId)` checks the latch as its first statement, before the existing same-family early return: `if (familyId === releasedFamilyId) throw` an `Error` named `'CacheReleasedError'`. (When the latch is set the handle is already null, so the order does not change behaviour; putting the refusal first makes the invariant readable.)

Add a `blocking` callback to the `openDB` call at `cache.ts:127`. The open's own handle is captured in a closure (`let handle: IDBPDatabase<CacheDB> | null = null`, assigned right where `cacheDb = db` is today, before the `await maxIncSeq`), which is safe because `versionchange` is an event task and cannot run before that assignment (see Notes). A late open from an earlier timeout (`cache.ts:151`) that receives the event closes itself without touching module state:

```ts
blocking(_current, newVersion, event) {
  (event.target as IDBDatabase).close(); // whichever connection got this must stop blocking, stale or not
  if (cacheDb === null || cacheDb !== handle) {
    console.warn(`[cache] versionchange on a stale ${dbName} connection; closed it`);
    return;
  }
  const released = cacheDbFamilyId;
  closeHandle();
  if (newVersion === null) releasedFamilyId = released; // a delete: refuse to re-open until the session ends
  releasedListener?.(newVersion === null ? 'deleted' : 'upgrade');
}
```

- `releasedFamilyId` is a module latch: `initPersistenceDB(familyId)` throws `CacheReleasedError` while `familyId === releasedFamilyId`, so nothing in this realm can recreate the database between the release and the session teardown (requirement 2 as a guarantee). `applyAndProject.reset()` (sign-out / family switch, `applyAndProject.ts:1403-1415`) gains a `cache.closeCacheDB()` call, which is what clears the latch on the evicted tab's `resetDocClient` step and lets the same family sign in again afterwards. (`docClient.reset`'s comment "does NOT delete the cache" stays true; it now closes the handle, which `database.closeDatabase` at `database.ts:55-60` already documents as the intended meaning. Assumption 10 covers why every later open still works. A trusted sign-out therefore no longer leaves a signed-out tab holding a connection, which is strictly better for requirement 1.)
- `releasedListener` is set once by `setCacheReleasedListener(fn: (reason: 'deleted' | 'upgrade') => void)`. The `reason` travels exactly one hop, from `cache.ts` to `applyAndProject.configure()` (`applyAndProject.ts:218-221`), which registers:

  ```ts
  setCacheReleasedListener((reason) => {
    cancelPendingPersists();
    if (reason === 'deleted') sink.cacheReleased();
    else raiseCachePersistFailure('open', 'CacheUpgradeElsewhere'); // cannot happen today; visible through the existing durability signal, never silent
  });
  ```

  reading the current `sink` at call time. `cancelPendingPersists()` is the timer-clearing prefix of `reset()` (`persistTimer` and `snapshotTimer`), extracted so `reset()`, `flush()` and the release share it. The doc and key are NOT dropped here: the evicted tab's bounded force-save still needs them; `resetDocClient` drops them a few seconds later.

- `persistOnce`'s catch (`applyAndProject.ts:499-508`) adds one line before raising: `if (!cache.isCacheReady()) { console.warn('[applyAndProject] cache write failed after the handle was released; the session is ending', e); return; }`. A write that raced the release must not raise the durability banner on a tab that is about to leave, and must not fire a false `cache-persist` warning into CloudWatch. This guard is NOT added to `reseedCacheAfterCorruption`'s open catch (`:383-388`) or `initAndLoadCache`'s (`:635-644`): after a failed open the handle is always null, so the guard there would silence every genuine open failure.

### 2. Worker: wait for the delete with a bounded timeout, then report honestly (`cache.ts`)

`clearCache` becomes:

```ts
export async function clearCache(familyId: string): Promise<CacheClearResult> {
  if (cacheDbFamilyId === familyId) closeCacheDB(); // own connection first, and the latch with it
  const dbName = `${DB_PREFIX}${familyId}`;
  try {
    await withTimeout(
      deleteDB(dbName, {
        blocked: () => console.warn(`[cache] delete of ${dbName} is waiting on another connection`),
      }),
      CACHE_DELETE_TIMEOUT_MS,
      `cache delete still blocked after ${CACHE_DELETE_TIMEOUT_MS}ms: ${dbName} is held open by another tab, window or the installed app`,
      'CacheDeleteTimeoutError'
    );
    return { deleted: true };
  } catch (e) {
    if (e instanceof Error && e.name === 'CacheDeleteTimeoutError') return { deleted: false };
    throw e; // a real IDB error: the caller's step runner reports it
  }
}
```

- `deleteDB` is `idb`'s (`import { openDB, deleteDB } from 'idb'`); `withTimeout` is the same helper the open uses (`src/utils/timing.ts:23-42`). `CACHE_DELETE_TIMEOUT_MS = 5_000`, exported beside `CACHE_OPEN_TIMEOUT_MS` with the same "tests advance by exactly this" note: a peer that answers `versionchange` closes in milliseconds, and a draining transaction is well under a second; 5 s is only ever reached by a frozen tab, and it runs under the sign-out progress overlay (`SignOutHost.vue`).
- `CacheClearResult` (`protocol.ts:221-223`) is unchanged: with a real wait, `deleted: false` has exactly one meaning (still blocked at the deadline), so a `reason` field would carry no information.
- The existing rule that a blocked delete must not immediately re-open (`cache.ts:519-521`) is preserved by `reseedCacheAfterCorruption` unchanged.
- The header comment's `clearCache` bullet (`cache.ts:13-15`) is updated to say "waits for the delete, bounded".

### 3. One signal mapping for both realms (`protocol.ts`, `applyAndProject.ts`, `docWorker.ts`, `inlineBridge.ts`, `docClient.ts`, `bootstrap.ts`, `syncService.ts`)

Add one signal alongside `cache-persist-failed` (`protocol.ts:245`):

```ts
| { signal: 'cache-released' }
```

It carries no payload: the only thing main needs to know is "your cache was deleted elsewhere", and the one other `versionchange` cause never leaves the worker realm (step 1).

Then collapse the three hand-mirrored sinks into one factory so a signal is defined in two places (the `WorkerSink` interface and the factory) instead of five:

- `applyAndProject.ts`: `WorkerSink` gains `cacheReleased(): void`; `NOOP_SINK` gets the no-op. Add and export `postingSink(post: (sig: WorkerSignal) => void): WorkerSink`, which maps `pushChunk` -> `projection`, `perf` -> `perf`, `cachePersistFailed` -> `cache-persist-failed`, `cacheReleased` -> `cache-released`.
- `docWorker.ts:27-38` becomes `configure(postingSink(post))`.
- `inlineBridge.ts`: delete `cachePersistFailedHandler` / `setInlineCachePersistFailedHandler` and the hand-written `mainSink`; replace with `let signalHandler: ((sig: WorkerSignal) => void) | null` plus `setInlineSignalHandler(fn)`, and `configure(postingSink((sig) => { if (signalHandler) signalHandler(sig); else console.warn('[inlineBridge] signal dropped, no handler wired', sig.signal); }))`. `__resetInlineBridgeForTesting` nulls the handler. (Verified: no spec imports `inlineExecutor` directly; every inline test goes through `installInlineBackend`, which wires the handler, so the warn cannot spam test output.)
- `docClient.ts`: export the existing `handleSignal` as `receiveSignal` (the inline path now goes through the same `switch`, which already does the `applyChunk` + `bumpDocVersion` + `recordPerf` work the inline sink duplicated, with the `reportError` guards the inline copy lacked). Add `setCacheReleasedHandler(fn: (() => void) | null)` next to `setCachePersistFailedHandler` (`:272-276`), reset it in `__resetDocClientForTesting`, and add the case:

  ```ts
  case 'cache-released':
    if (cacheReleasedHandler) cacheReleasedHandler();
    else reportError({ surface: 'cache-persist', message: 'cache released but no session handler is registered', severity: 'warning', context: { action: 'cache-released', error_code: 'no-handler' } });
    break;
  ```

- `bootstrap.ts` wires `setInlineSignalHandler(docClient.receiveSignal)` beside `docClient.setInlineExecutor(inlineExecutor)`, and `docClient.setCacheReleasedHandler(() => void endSessionClearedElsewhere())` beside `setRehydrator` (step 4 defines it; it never rejects, so the `void` discards nothing). `__tests__/inlineHarness.ts` wires the inline signal handler the same way.
- `syncService.ts`: remove the `inlineBridge` import (`:27`) and line `:2510`; `docClient.setCachePersistFailedHandler(setCachePersistFailed)` now covers both realms.

### 4. Main thread: end the evicted tab's session (`signOutSteps.ts`, `authStore.ts`, `useSignOut.ts`, `loginFlowEvents.ts`)

**signOutSteps.ts.** One named alias, no new list:

```ts
/**
 * A peer tab deleted this family's cache (#100). Same non-destructive teardown as a
 * trusted sign-out: no delete (the deleting tab owns it), no key-material step (tab A may
 * be reloading into the same family), and `resetDocClient` MUST stay in it, because that
 * step is what clears the worker's CacheReleasedError latch so this family can sign in
 * again in this tab. Asserted by the unit test.
 */
export const SIGN_OUT_CLEARED_ELSEWHERE_STEPS = SIGN_OUT_TRUSTED_STEPS;
```

**authStore.** `signOut()` (`:3034-3054`) and `signOutAndClearData()` (`:3214-3232`) build the same 12-line `ctx` literal. Extract it and the tail into one private runner with a single options object, and express all three session ends through it:

```ts
function buildSignOutCtx(userAskedToClear: boolean) {
  return {
    departedEmail: null as string | null,
    familyId: undefined as string | undefined,
    userAskedToClear,
    remoteWasUnreadable: isRemoteBlocked(),
    unpushedAtSignOut: null as 'clean' | 'dirty' | null,
    // null = no delete was attempted; false = attempted and the cache is still on disk.
    cacheDeleted: null as boolean | null,
  };
}
async function runSignOutTier(opts: {
  tier: 'sign-out' | 'sign-out-clear' | 'cleared-elsewhere';
  steps: readonly SignOutStepName[];
  userAskedToClear: boolean;
  trusted: boolean;
}) {
  const ctx = buildSignOutCtx(opts.userAskedToClear);
  await runSignOutSteps(opts.steps, buildSignOutStepImpls(ctx));
  emitSignoutTier({
    tier: opts.tier,
    trusted: opts.trusted,
    // Read off the list, not off `trusted`: the evicted tier keeps tokens on an
    // untrusted device too, and a hand-passed boolean would mislabel it.
    tokensKept: !opts.steps.includes('clearGoogleSessionDropTokens'),
  });
  finalizeSession();
  return ctx;
}
```

- `signOut()` -> `runSignOutTier({ tier: 'sign-out', steps: signOutStepsFor('sign-out', trusted), userAskedToClear: false, trusted })`.
- `signOutAndClearData(): Promise<{ cacheDeleted: boolean | null }>` -> `runSignOutTier({ tier: 'sign-out-clear', steps: signOutStepsFor('clear', false), userAskedToClear: true, trusted: false })` and returns `{ cacheDeleted: ctx.cacheDeleted }`.
- New `endSessionClearedElsewhere()` -> `runSignOutTier({ tier: 'cleared-elsewhere', steps: SIGN_OUT_CLEARED_ELSEWHERE_STEPS, userAskedToClear: false, trusted: isTrustedDevice })`. No `resolveFamilyId`, no `deleteFamilyDb`, no key-cache / PIN / roster removal: the deleting tab owns those, and a second delete against a name that is mid-delete is exactly the queue this plan removes.
- The `deleteFamilyDb` step (`:2920-2955`) sets `ctx.cacheDeleted = false` immediately before the delete and `ctx.cacheDeleted = result?.deleted === true` after it, so a throw inside the delete (caught and reported by the runner as `step_failed`) still reaches the person as "not cleared", and a result with no `deleted` field follows the same unknown-means-not-deleted rule as requirement 4 rather than throwing a `TypeError` over the real outcome.
- `emitSignoutTier`'s `tier` union (`loginFlowEvents.ts:270`) gains `'cleared-elsewhere'`. Add `emitCacheKept(kind: 'sign-out-clear' | 'clear-data' | 'forget-family' | 'delete-family' | 'evicted')` in the same file: `emit('warn', 'cache_kept', { action: 'cache_kept', kind })`. This is the single telemetry site for the user-visible "cache kept" outcome (the toast type is `warning`, which never auto-reports).

**useSignOut.ts.** Extract the two-line tail of `runTeardown` (`:125-126`) into an exported `leaveToLogin()` (`resetAllAppStores(); await router.replace('/login')`), and the `catch` body of `signOut()` (`:147-159`) into `failSignOut(error, kind)`. Then:

- `runTeardown('clear')` reads the result: `if (cacheDeleted === false) notifyCacheKept('sign-out-clear')`, where `notifyCacheKept(kind)` is exported from this file and is the one toast site: `showToast('warning', t('auth.cacheKeptTitle'), t('auth.cacheKept'), { durationMs: 12_000 }); emitCacheKept(kind);`. The sign-out itself still completes and lands on login first, so the toast is read on the login screen.
- New exported `endSessionClearedElsewhere()`:
  ```ts
  async function endSessionClearedElsewhere(): Promise<void> {
    logEvent({
      level: 'info',
      surface: 'cache-persist',
      message: 'cache released by another context',
      context: { action: 'cache-released' },
    });
    if (phase.value === 'signing-out') return; // this tab is already leaving; its own sign-out lands on login
    // Takes the phase from idle, confirm OR guard. The confirm and guard modals are v-if'd
    // on their phase, so both close here; a parked guard promise is resolved in `finally`,
    // AFTER the teardown, so the waiting signOut() cannot reset the phase under us.
    phase.value = 'signing-out';
    try {
      await useAuthStore().endSessionClearedElsewhere();
      await leaveToLogin();
      showToast('info', useTranslationStore().t('auth.signedOutElsewhere'));
    } catch (error) {
      failSignOut(error, 'cleared-elsewhere');
    } finally {
      resolveGuard?.('cancelled');
      phase.value = 'idle';
      resolveGuard = null;
    }
  }
  ```
  Exported directly (it is wired by `bootstrap.ts`, not by a component), and not part of `useSignOut()` / `useSignOutHost()`. `router.replace('/login')` from a tab already on `/login` (person picker, thin session) is a duplicated navigation that vue-router 4 resolves without throwing.

**SignOutHost.vue** is unchanged: its `signing-out` overlay already renders for whichever flow set the phase, and its `isAuthenticated` watcher calls `abandonSignOut`, which does nothing once the phase is `signing-out`.

### 5. Act on the delete result at every call site

- `docClient.clearCache` (`:1634-1659`) returns `Promise<CacheClearResult>`, keeps its trailing `resetProjection()`, and stays the single log site for the worker-level outcome, so callers do not double-log:
  - `result?.deleted === true` -> `logEvent({ level: 'info', surface: 'cache-persist', message: 'cache deleted', context: { action: 'clear-cache' } })` (the success-path counter), return `{ deleted: true }`.
  - `result?.deleted === false` -> existing warn, message changed to `'cache delete still blocked at the deadline'`, context `{ action: 'clear-cache', error_code: 'delete-blocked' }`, return `{ deleted: false }`.
  - anything else (an older worker bundle answering `{}`) -> `logEvent warn` `'cache delete returned no result'` with `error_code: 'unknown-result'`, return `{ deleted: false }`. Over-reporting is the safe direction for a privacy claim; the "never reported as clean" rule holds.
  - Replace the "STAYS `Promise<void>` ON PURPOSE" comment and the "over-report in one narrow window" paragraph with the new reason (see Notes).
- `deleteFamilyDatabase` (`database.ts:66-82`) returns the `CacheClearResult` (the legacy DB and photo-queue deletes keep their current semantics, and their hand-rolled `deleteDB` at `:85-101` stays as the existing deferred item documents; nothing re-opens those names). Fix the stale comment at `:67-69` that asserts the worker holds the only connection.
- **Sign-out:** covered in step 4 (`runTeardown` -> `notifyCacheKept('sign-out-clear')`).
- **Escape-hatch clears (`App.vue:1759`, `demoSeed.ts:111`):** the result is discarded with a one-line comment at each site ("outcome logged by docClient.clearCache; a reload / non-interactive teardown cannot show it"). No behaviour change, no new `kind`. See Notes.
- **Settings "Clear Data" (`SettingsPage.vue:1328-1356`):** declare `let cacheDeleted: boolean | null = null` before the existing `try` and set `cacheDeleted = (await deleteFamilyDatabase(familyId)).deleted` inside it. After `showClearConfirm.value = false`, `if (cacheDeleted === false) { emitCacheKept('clear-data'); await showAlert({ title: 'auth.cacheKeptTitle', message: 'auth.cacheKept' }); }` then the existing `window.location.reload()`. The reload is what restores a working app (the worker doc and projection were dropped by `clearCache`), so it stays; the awaited alert (the existing `useConfirm` modal, already imported as `showAlert`) is what lets the outcome be read before it. `requireReauth()` has resolved by then, so the one-resolve `useConfirm` singleton (`SettingsPage.vue:682`) is free.
- **Forget family in the picker (`familyContext.ts:149-151` -> `familyContextStore.deleteLocalFamily` -> `FamilyPickerView.vue:90-98`):** `familyContext.deleteLocalFamily` returns the `CacheClearResult` from `deleteFamilyDatabase`; the store returns `Promise<CacheClearResult | null>` (`null` = it threw, message captured in `error.value` as today). The picker (which gains `showToast` and `notifyCacheKept` imports; `t` is already there):
  ```ts
  const result = await familyContextStore.deleteLocalFamily(family.id);
  if (!result) {
    showToast('error', t('familyPicker.forgetFailed'), familyContextStore.error ?? undefined, {
      surface: 'family-context',
      context: { action: 'forget_family_failed' },
    });
    return; // the row stays: nothing was forgotten
  }
  families.value = families.value.filter((f) => f.id !== family.id);
  if (!result.deleted) notifyCacheKept('forget-family');
  ```
- **Settings delete-family (`SettingsPage.vue:1662-1673`):** the existing `kept.push('local-data')` arm widens to `if (!local || !local.deleted)`, with `severity: local ? 'warning' : 'critical'` and `error_code: local ? 'cache-kept-other-tabs' : 'local-delete-failed'`, plus `emitCacheKept('delete-family')` on the kept-cache branch. The farewell screen already lists what was kept; no extra toast. The `authStore.signOutAndClearData()` call that follows (`:1677`) runs `deleteFamilyDb` against a name that is already deleted or already queued, so its `cacheDeleted` is deliberately not read there: the `kept` arm has already recorded the outcome once.
- **Eviction (`authStore.ts` `forgetLocalFamily` step `:3008-3011`):** `const result = await ...deleteLocalFamily(ctx.familyId); if (!result) throw new Error('deleteLocalFamily returned null'); if (!result.deleted) emitCacheKept('evicted');`. No UI: the login page already shows `auth.memberRemoved`, and the key is gone.
- **Corruption re-seed (`applyAndProject.ts:369-387`)** already handles `!result?.deleted`. No behaviour change beyond the timeout now being real.

### 6. Plumb the failure kind to the UI

- `syncService.ts:651-666`: `type CacheFailureCallback = (failed: boolean, detail: CachePersistFailureDetail | null) => void`; `setCachePersistFailed` passes `detail ?? null` through (`null` on recovery and on the silent lifecycle reset at `:971`). syncStore is the only real subscriber (assumption 4); the `__mocks__` stub is untyped and unchanged.
- `syncStore.ts:993-996`: the one subscriber sets `cachePersistFailed.value = failed` and a private `cachePersistFailure.value = failed ? detail : null`; add `const cachePersistCause = computed(() => cacheFailureCause(cachePersistFailure.value))` and export ONLY `cachePersistCause` (nothing consumes the raw detail, and two exported refs named `cachePersistFailed` / `cachePersistFailure` invite the wrong one). `cachePersistFailed` keeps its shape so `WallStatusStamp.vue` does not change.
- New pure helper `src/utils/cacheFailureCause.ts`: `cacheFailureCause(detail: CachePersistFailureDetail | null): 'other-tabs' | 'storage' | 'unknown'`:
  - `kind === 'open'` and `errorName` in `{ CacheOpenTimeoutError, DeleteBlocked, CacheDeleteTimeoutError, CacheReleasedError }` -> `other-tabs`
  - `kind` is `base` or `increment`, or `errorName` in `{ QuotaExceededError, InvalidStateError }` (Firefox private mode throws the latter on open) -> `storage`
  - otherwise (including `null`, and the worker-only `CacheUpgradeElsewhere`) -> `unknown`
- `DurabilityBanner.vue` and the Settings warning (`SettingsPage.vue:2667-2672`) pick the message key from a local `Record<Cause, UIStringKey>`:
  - `sync.durabilityBanner.otherTabs`: "beanies is open in another tab or window, which is stopping this one from saving locally. Close the other beanies tabs, then refresh this one."
  - `sync.durabilityBanner.storage`: "This browser could not write to local storage. It may be low on space or in private mode. Your saved copy is safe."
  - `sync.durabilityBanner` (existing key, `uiStrings.ts:2752`): kept as the `unknown` fallback.
  - Same three for Settings: `settings.cachePersistWarning.otherTabs`, `settings.cachePersistWarning.storage`, existing `settings.cachePersistWarning` as fallback. Retire the "OFTEN, NOT THIS MEANS" comment at `uiStrings.ts:2737-2742` and replace it with a one-line pointer to `cacheFailureCause`.
- New copy (en + beanie, real nouns): `auth.cacheKeptTitle` ("Some data is still cached in this browser"), `auth.cacheKept` ("beanies could not remove this family's cached data. If beanies is open in another tab or window (including the installed app), close it and try again. Otherwise clear this site's data in your browser settings."), `auth.signedOutElsewhere` ("This family's data was cleared from this browser in another tab, so it was closed here too."; true for a signed-in tab and for a tab on the person picker), `familyPicker.forgetFailed` ("Couldn't forget this family").
- `npm run translate` for the new keys.

### 7. Docs

- `CLAUDE.md` "Key Implementation Details" already says the cache is deleted on sign-out; no change, the statement becomes true.
- `docs/STATUS.md`: session entry on implementation.
- Correct the Notion #100 `Current` text (`beanies-cache-` -> `beanies-automerge-`) when closing the row.

## Files Affected

- `src/services/automerge/worker/cache.ts` (`closeHandle`, `closeCacheDB` as the one latch-clearing close, latch check first in `initPersistenceDB`, `blocking` handler with the closure handle, `releasedFamilyId` latch + `CacheReleasedError`, `setCacheReleasedListener`, `deleteDB` + `withTimeout`, `CACHE_DELETE_TIMEOUT_MS`)
- `src/services/automerge/worker/protocol.ts` (`cache-released` signal only, no payload)
- `src/services/automerge/worker/applyAndProject.ts` (`WorkerSink.cacheReleased`, `postingSink`, `cancelPendingPersists`, `reset()` closes the handle, released-handle guard in the `persistOnce` catch only, listener registration in `configure` that folds the upgrade case into the existing durability signal)
- `src/services/automerge/worker/docWorker.ts`, `src/services/automerge/worker/inlineBridge.ts` (both use `postingSink`; inline gets `setInlineSignalHandler`)
- `src/services/automerge/worker/docClient.ts` (`receiveSignal` export, `setCacheReleasedHandler`, `clearCache` returns the result with three logged outcomes, retired comments)
- `src/services/automerge/worker/bootstrap.ts` (wire `setInlineSignalHandler` and `setCacheReleasedHandler`)
- `src/services/sync/syncService.ts` (drop the inline handler import + line; pass `detail` to subscribers)
- `src/stores/syncStore.ts` (private detail ref, exported `cachePersistCause`)
- `src/services/auth/signOutSteps.ts` (`SIGN_OUT_CLEARED_ELSEWHERE_STEPS` alias + doc comment)
- `src/stores/authStore.ts` (`buildSignOutCtx`, `runSignOutTier` with an options object and list-derived `tokensKept`, `endSessionClearedElsewhere`, `ctx.cacheDeleted`, `signOutAndClearData` result, `forgetLocalFamily` null check + emit)
- `src/services/telemetry/loginFlowEvents.ts` (`'cleared-elsewhere'` tier, `emitCacheKept`)
- `src/composables/useSignOut.ts` (`leaveToLogin`, `failSignOut`, `notifyCacheKept`, `endSessionClearedElsewhere` with the parked-guard `finally`)
- `src/services/indexeddb/database.ts` (return the result, fix comment)
- `src/services/familyContext.ts`, `src/stores/familyContextStore.ts`, `src/components/login/FamilyPickerView.vue` (return the result; error toast on `null`, cache-kept toast on `false`)
- `src/pages/SettingsPage.vue` (clear-data alert before reload, delete-family `kept` arm, warning copy by cause)
- `src/App.vue`, `src/services/demo/demoSeed.ts` (one-line comment each at the discarded `signOutAndClearData` result; no logic change)
- `src/components/common/DurabilityBanner.vue` (copy by cause)
- `src/utils/cacheFailureCause.ts` (new)
- `src/services/translation/uiStrings.ts` (new keys, en + beanie)
- Tests: `src/services/automerge/worker/__tests__/cache.test.ts`, `cache.openTimeout.test.ts` (its hoisted `idb` mock must now also stub `deleteDB`, and its two `clearCache` cases are rewritten against that stub: never-settling -> `{ deleted: false }` after `CACHE_DELETE_TIMEOUT_MS`, resolved -> `{ deleted: true }`; it is the only spec that mocks `idb`), new `cache.release.test.ts`, `applyAndProject.test.ts`, `docClient.test.ts`, `__tests__/inlineHarness.ts`, `src/services/auth/__tests__/signOutSteps.test.ts` (unchanged lists; assert `SIGN_OUT_CLEARED_ELSEWHERE_STEPS` has no delete or key-material step AND contains `resetDocClient`, the two properties the evicted path relies on), `src/stores/__tests__/dataClearingSecurity.test.ts` (`mockDeleteFamilyDatabase` and the `docClient.clearCache` mock resolve `{ deleted: true }`; new cases for `false`, for a throw, and for an `undefined` result; `signout_tier` payload asserts `tokensKept` per tier), `src/composables/__tests__/useSignOut.test.ts` (authStore mock gains `endSessionClearedElsewhere`; `signOutAndClearData` resolves `{ cacheDeleted }`; the `loginFlowEvents` mock gains `emitCacheKept`; `@/services/telemetry` `logEvent` mocked), `src/pages/__tests__/SettingsPage.deleteFamily.test.ts` (`deleteLocalFamilyMock` resolves `{ deleted: true }` instead of `true`; a `{ deleted: false }` case asserts `kept` gains `local-data` with the `warning` severity), `src/components/common/__tests__/DurabilityBanner.test.ts` (mock state gains `cachePersistCause`), `src/utils/__tests__/cacheFailureCause.test.ts` (new)
- `docs/STATUS.md`

## Observability Coverage

- **Events (existing surfaces, no new context keys):**
  - `logEvent info` `cache released by another context`, `{ action: 'cache-released' }` on `cache-persist` (main thread, from `useSignOut.endSessionClearedElsewhere`). Answers "which tabs got evicted, and how often".
  - `reportError warning` `cache released but no session handler is registered`, `{ action: 'cache-released', error_code: 'no-handler' }` on `cache-persist` (docClient). Should never fire; if it does, the `bootstrap.ts` wiring regressed.
  - The impossible upgrade branch surfaces as the existing `cache-persist-failed` warning with `cache_persist_error: CacheUpgradeElsewhere`; any occurrence means someone bumped the DB version without a migration plan.
  - `logEvent info` `cache deleted`, `{ action: 'clear-cache' }` on every successful delete (success-path counter so the blocked rate is measurable).
  - `logEvent warn` `cache delete still blocked at the deadline`, `{ action: 'clear-cache', error_code: 'delete-blocked' }` (existing site in `docClient.clearCache`). This is the frozen-tab case after the fix; if it keeps firing at the pre-fix rate, step 1 is not taking effect. It also covers the two escape-hatch callers that cannot show a toast.
  - `logEvent warn` `cache delete returned no result`, `{ action: 'clear-cache', error_code: 'unknown-result' }`: an older worker bundle mid-deploy.
  - `logEvent warn` `cache_kept`, `{ action: 'cache_kept', kind: 'sign-out-clear' | 'clear-data' | 'forget-family' | 'delete-family' | 'evicted' }` on `login-flow` via `emitCacheKept`, so the user-visible outcome is countable separately from the worker-level one.
  - `signout_tier` gains the `'cleared-elsewhere'` tier value (existing event, existing keys); its `detail` (`tokens-kept` / `tokens-cleared`) is now derived from the step list, so it cannot drift from what ran.
  - `reportError` `step_failed` on `auth-signout` (existing, from `runSignOutSteps`) covers a failed force-save or a throwing delete in every tier including the evicted one.
  - Existing `cache-persist-failed` telemetry (`reportError warning` with `cache_persist_kind` / `cache_persist_error`) is unchanged; after the fix the `open` + `CacheOpenTimeoutError` combination should fall to near zero, which is the acceptance signal. Writes that fail after a release are excluded from it by design (step 1).
  - Picker forget failure: the error toast auto-reports on `family-context` with `{ action: 'forget_family_failed' }`; previously nothing.
- **Failure modes covered:** peer tab frozen (timeout warn + `cache_kept`); delete still blocked at sign-out (same); delete throws a real IDB error (`step_failed` + `cache_kept` because `ctx.cacheDeleted` was set to `false` before the attempt); delete result has no `deleted` field (`unknown-result` warn, treated as kept); `blocking` fired for an upgrade that should not exist (durability signal with `CacheUpgradeElsewhere`, banner with the fallback copy); `versionchange` on a stale late-open connection (console warn, connection closed); force-save in the evicted tab fails (`step_failed`); evicted-tab handler invoked while this tab is already signing out (info event, no action); evicted-tab handler invoked under an open confirm or kit guard (modal closes, guard resolved as cancelled after the teardown, no phase race); evicted-tab handler invoked on a tab with no signed-in member (person picker, thin session: same teardown, same toast, duplicate `/login` navigation is harmless); inline signal with no handler (console warn); no cache-released handler registered (`reportError` warning); `endSessionClearedElsewhere` throws (`failSignOut` reports critical + silent error toast, same as a failed user sign-out); `resetDocClient` step fails on the evicted tab (`step_failed`; the latch then surfaces on the next same-family open as `CacheReleasedError`, mapped to the other-tabs copy whose "refresh this tab" advice is the correct recovery); worker respawn mid-delete (`clearCache` re-issued, idempotent). No bare `catch {}`.
- **Success-path signal:** the `clear-cache` info counter and the `cleared-elsewhere` tier event.
- **Critical vs telemetry:** nothing new pages. A blocked delete leaves ciphertext with no key on the device; it is a broken promise, not data at risk. The one critical path is the existing `sign_out_failed` (now also for `kind: 'cleared-elsewhere'`), where a person is stuck with a dead session.
- **Privacy/store gate:** no new context key; nothing to declare.

## Acceptance Criteria

- [ ] Two tabs signed in to the same family; "Sign Out & Clear All Data" in tab A: `beanies-automerge-<familyId>` is gone from IndexedDB within a second, tab B lands on the login screen with the "closed here too" toast, and neither tab recreates the database (tab B's worker refuses a same-family open until its `resetDocClient` step has run).
- [ ] Signing in again in either tab afterwards does not hit `CacheOpenTimeoutError` or `CacheReleasedError`; the durability banner does not appear.
- [ ] Trusted-device sign-out in tab A leaves tab B untouched and the cache intact; tab A's worker no longer holds a connection afterwards.
- [ ] Settings "Clear Data", "forget this family" in the picker, and Settings delete-family evict other tabs the same way; a tab on the person picker (after "switch person") is evicted too.
- [ ] With tab B frozen (simulated in a unit test by a peer connection with no `blocking` handler), tab A's sign-out still completes within `CACHE_DELETE_TIMEOUT_MS + ~1 s`, shows the cache-kept toast on the login screen, and logs `delete-blocked`; tab B, on resuming, releases and lands on login.
- [ ] Tab B with the sign-out confirm or the kit guard open when tab A clears: the modal closes, the progress overlay stays up for the whole teardown, and tab B lands on login once; no second sign-out can be started meanwhile.
- [ ] Settings "Clear Data" with a frozen peer shows the cache-kept alert, and reloads only after it is dismissed.
- [ ] "Forget this family" that throws shows an error toast and keeps the row; one that succeeds with a blocked delete removes the row and shows the cache-kept toast.
- [ ] `signout_tier` reports `tokens-kept` for the evicted tier on an untrusted device.
- [ ] `DurabilityBanner` and the Settings warning show the other-tabs copy for `open` failures, the storage copy for `QuotaExceededError` and for `base` / `increment` failures, and the fallback otherwise.
- [ ] The inline path (`docWorker` flag off) delivers `cache-persist-failed` and `cache-released` through `docClient.receiveSignal`; `syncService` wires one handler, not two.
- [ ] `npm run validate` green; no new `ALLOWED_CONTEXT_KEYS` entries.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified.

## Testing Plan

1. **Unit, `cache.release.test.ts` (new, real `idb` + `fake-indexeddb`):** open two connections to the same name (one via `initPersistenceDB` with a listener registered through `setCacheReleasedListener`, one raw via `openDB`); call `deleteDatabase` from the raw side; assert `isCacheReady()` is false, the listener received `'deleted'`, the delete's promise resolves, and `initPersistenceDB` for the same family now rejects with name `CacheReleasedError` until `closeCacheDB()` runs. A family switch (`initPersistenceDB(otherFamily)`) does NOT clear the latch for the released family. Reverse it: `clearCache` from the module with a raw peer whose `blocking` closes -> `{ deleted: true }` and `isCacheReady()` false. Late-open case: a connection that arrives after a timed-out open receives `versionchange` and closes without nulling a newer handle.
2. **Unit, `cache.openTimeout.test.ts` (idb mocked):** `deleteDB` never settling -> `clearCache` resolves `{ deleted: false }` after exactly `CACHE_DELETE_TIMEOUT_MS`; `deleteDB` resolving -> `{ deleted: true }`; `deleteDB` rejecting -> `clearCache` rejects (a real error is not reported as "blocked").
3. **Unit, `applyAndProject.test.ts`:** `postingSink` maps all four sink methods to the right `WorkerSignal`; the release listener with `'deleted'` calls `sink.cacheReleased()` and with `'upgrade'` raises `cachePersistFailed(true, { kind: 'open', errorName: 'CacheUpgradeElsewhere' })`; a persist failure after the handle is released does not call `sink.cachePersistFailed`; an `initAndLoadCache` open failure still raises it; `reset()` closes the cache handle.
4. **Unit, `docClient.test.ts` / inline harness:** `cache-released` reaches the registered handler on both the worker and inline paths; with no handler registered it reports a warning; `clearCache` returns `{ deleted: true }` / `{ deleted: false }` / `{ deleted: false }` for `true` / `false` / `{}` and logs once per outcome.
5. **Unit, `signOutSteps.test.ts`:** `SIGN_OUT_CLEARED_ELSEWHERE_STEPS` contains neither `deleteFamilyDb` nor any `KEY_MATERIAL_STEPS` member, and contains `resetDocClient`; `SIGN_OUT_CLEAR_STEPS` still contains `deleteFamilyDb`.
6. **Unit, `dataClearingSecurity.test.ts`:** `signOutAndClearData` returns `{ cacheDeleted: false }` when `deleteFamilyDatabase` reports `{ deleted: false }`, when it throws, AND when it resolves `undefined`, and every remaining step still runs; `{ cacheDeleted: true }` on success; `endSessionClearedElsewhere` runs the cleared-elsewhere list, never calls `deleteFamilyDatabase`, emits the `cleared-elsewhere` tier with `tokensKept: true` on an untrusted device, and finalizes the session; `signOut` on an untrusted device still emits `tokensKept: false`.
7. **Unit, `useSignOut.test.ts`:** the cache-kept toast shows (and `emitCacheKept('sign-out-clear')` fires) on `cacheDeleted: false` and not on `true` or `null`; `endSessionClearedElsewhere()` reaches login and shows the elsewhere toast; it is a no-op (beyond the info event) while `phase` is `signing-out`; from `confirm` it closes the confirm; from `guard` the phase stays `signing-out` for the whole teardown and the parked `signOut()` resolves `'cancelled'` only after it; a throw goes through `failSignOut`.
8. **Unit, `SettingsPage.deleteFamily.test.ts`:** `{ deleted: true }` keeps the farewell clean; `{ deleted: false }` adds `local-data` to `kept` at `warning` severity with `cache-kept-other-tabs`; `null` keeps the existing `critical` + `local-delete-failed` arm.
9. **Unit, `cacheFailureCause.test.ts`:** the three mappings plus `null`.
10. **Unit, `DurabilityBanner.test.ts`:** the message key follows `cachePersistCause`.
11. **Browser (Chromium + Firefox, `npm run dev`):** walk the acceptance criteria with two real tabs and with one tab in a separate window; check IndexedDB in devtools after each; check the PWA install on the same origin counts as a tab; confirm the inline path with the `docWorker` flag off.
12. **CloudWatch after deploy:** `cache-persist` `delete-blocked` and `cache_persist_error: CacheOpenTimeoutError` both fall to near zero; `cache-released` events appear when people sign out with several tabs; `no-handler`, `unknown-result` and `CacheUpgradeElsewhere` stay at zero.

## Review Passes

- **Pass 1 (Initial draft)**: `blocking` handler releases the connection in every peer tab; delete waits with a bounded timeout and reports honestly; `cache-released` signal ends the peer tab's session via a non-destructive step list; result acted on at every call site; failure kind plumbed to the banner via a pure `cacheFailureCause` helper.
- **Pass 2 (DRY + error handling)**: Replaced the hand-rolled delete with `idb.deleteDB` + `withTimeout` and dropped the redundant `reason` field; collapsed the three mirrored sinks and the paired handler setters into one `postingSink` + `docClient.receiveSignal`; reused `SIGN_OUT_TRUSTED_STEPS` instead of a new list and a shared `runSignOutTier` instead of a third ctx copy; moved the session-end wiring out of `syncService` (which never imported authStore) into `useSignOut` + `SignOutHost`; added the worker-side `CacheReleasedError` latch so "must not recreate" is enforced; fixed the silent picker failure, the reload that hid the Settings outcome (now the existing `alert` modal), the no-handler and unknown-result branches, and the post-release write that would have raised a false banner.
- **Pass 3 (Sustainability)**: Contained the impossible upgrade branch in the worker (existing durability signal) so `cache-released` carries no `reason` through five layers; replaced the `unwrap` raw-handle compare with a closure handle; made `closeCacheDB()` the single latch-clearing close; removed the `isCacheReady()` guard from the reseed open catch (it would have swallowed every real open failure); fixed the kit-guard phase race by parking the guard and resolving it after the teardown; moved handler wiring from `SignOutHost.vue` to `bootstrap.ts` beside its siblings; gave `runSignOutTier` an options object and the evicted path a documented `SIGN_OUT_CLEARED_ELSEWHERE_STEPS` alias whose `resetDocClient` dependency is now asserted.
- **Pass 4 (Fresh-eyes sweep)**: Derived `signout_tier`'s `tokensKept` from the step list (the hand-passed `opts.trusted` mislabelled the evicted tier on an untrusted device); named the two escape-hatch `signOutAndClearData` callers (`App.vue`, `demoSeed.ts`) and settled them as logged-and-documented discards; made the `forgetLocalFamily` null check explicit and `deleteFamilyDb` tolerant of an `undefined` result; kept the raw failure detail private in syncStore (only `cachePersistCause` is exported); reworded the eviction toast so it is true on a person-picker tab; recorded the verified `RETRYABLE_METHODS` / 45 s RPC ceiling, the `bootstrap.ts` import-graph check, the `loadProjectionSnapshot` open path, the retired over-report comment, and the two test mocks (`SettingsPage.deleteFamily`, `useSignOut` loginFlowEvents) that must widen with the return types.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (greg, 2026-09-24)

> Once done, run /beanies-pre-plan and /beanies-plan on notion issue #100 - first, determine if this is truly a high priority security issue and if there is a clear fix. if so, then proceed with the planning, otherwise stop for my decision to implement or ignore. once planning is done do not proceed to implement yet.

### Pre-plan hand-off (assembled from Notion #100, 2026-09-24)

The `=== BEANIES PRE-PLAN ===` block written to the Notion row's `beanies-plan prompt` property is the verbatim Phase 1 input; it is reproduced in the tracker rather than duplicated here.

</details>

## Outcome (2026-09-24, built via /beanies-build-auto, NOT committed, NOT deployed)

Built to the plan. `validate` green (8658 tests, +62). Browser-verified in real Chromium with two same-context pages (both themes, phone and desktop): another tab's delete now completes and the signed-in tab lands on login with the "closed here too" toast; a frozen tab makes Sign Out & Clear take 5.2 s and shows the cache-kept warning, and the queued delete completes once that tab closes; a healthy tab releases in ~250 ms and a fresh open afterwards takes 2 ms (it used to queue behind the blocked delete until `CACHE_OPEN_TIMEOUT_MS`).

**Deviation from the plan, and why:** the evicted side could not be driven with two real app tabs, because the E2E harness's in-memory provider means a second app tab never opens the pod (a first run "passed" for exactly that reason). Each side was instead driven with the real app on that side and a raw IndexedDB connection playing the other tab.

**Review round 1 (`/code-review high`, 10 findings):** 7 fixed after verifying each against the code: the re-seed path lifting the `CacheReleasedError` refusal (a deviation of mine from the plan's `clearCache`); a kit-guard action resolving after the evicted teardown took the phase; the untrusted ordinary sign-out dropping its delete outcome (a plan gap against requirement 4: `authStore.signOut()` now returns `{ cacheDeleted }`); a second failure cause in one episode never reaching the banner; a release during this tab's own failing sign-out being lost; raw error text in the picker toast; the eviction path's second ctx literal. Not fixed, recorded: a worker reaped across another tab's clear rehydrates and recreates the cache (pre-existing class, needs a cross-tab tombstone: follow-up candidate); a double 5 s wait in delete-family when a tab is frozen; a post-release write failure being console-only.

**Review round 2 (scoped to the fixes, 10 findings) — STOPPED HERE, NOT PATCHED.** The substantiated ones cluster in the two areas round 1 patched, which is the skill's "hand-patching is not converging" signal:

- the `releasedWhileLeaving` flag in `useSignOut` (R2-1: a throw from `leaveToLogin` AFTER a completed teardown triggers a second teardown; R2-2: a critical "sign-out failed" page and toast contradicted moments later by "signed out elsewhere"; R2-5: the release event double-counted, deferral not logged);
- the `CacheReleasedError` latch in `cache.ts` (R2-3: `clearCache` → `closeCacheDB()` can lift a DIFFERENT released family's latch via a re-seed of another family; R2-4: if the swallowed `resetDocClient` step fails, nothing lifts the latch until a reload).
  Also open, smaller: R2-6 `emitCacheKept` runs after navigation, so a navigation throw loses the count; R2-7 the cause re-notify compares raw detail, not the derived cause, and emits no telemetry; R2-8 the picker report rebuilds the error from a string (class and stack lost) and belongs in the store's catch. Fixed without a review round (copy/comment only): R2-9 new copy now says "beanies.family" (12 older strings still say "beanies is open in another tab"), R2-10 the eviction ctx comment.

**Proposed structural fix for greg's decision** (instead of a third patch round): (1) make the latch a per-family set that `clearCache` never touches, cleared only by the session-ending `closeCacheDB(familyId)`, and have `docClient.reset()` clear it on the main side too, so a failed `resetDocClient` RPC cannot strand it; (2) replace the `releasedWhileLeaving` flag with one rule in `endSessionClearedElsewhere`: if a sign-out is running, await its completion and then run only if `authStore.isAuthenticated` is still true, so "did the session end" is asked of the store rather than inferred from a return value.

### Resolution: structural attempt, then option 2 (greg, 2026-09-24)

greg approved the structural fix. It was built (a per-family refusal set with one owner, and a `leaving` promise plus an `isAuthenticated` check replacing the `releasedWhileLeaving` flag) and reviewed at `high`. Part B held up. Part A did not: the refusal lived in the worker, while worker restarts and session identity are owned on the main thread, so a worker respawn during the teardown (R3-2), a worker `reset` from another delete path (R3-3), and the clear tier having no `resetDocClient` (R3-4) each still bypassed it, and the added "discard the worker on a failed reset" was itself unsafe mid-rehydrate or with an edit in flight (R3-1, R3-6). Three review rounds, one mechanism, holes each time.

**greg chose option 2: cut the refusal.** Shipped: every tab releases on `versionchange`; the bounded delete with an honest result at every call site; the cause-specific banner; the evicted tab signing itself out, with part B's rule for a release that lands during this tab's own sign-out (wait for it, then act only if the store still has a signed-in session, one `cache-released` event per release carrying the decision in `detail`); the kept-cache count emitted before navigation; the forget-family report in the store with the real error; a guard closed by another tab recorded as `superseded`, not `cancelled`. Removed: the refusal set, `CacheReleasedError`, and the reset-discard.

**Known limit, accepted and measured:** in the seconds between a release and this tab's own teardown, a pending save or a recovery can recreate the encrypted cache. The other tab's clear has already removed the key that opens it, so the exposure is ciphertext with no key on the device. `authStore.endSessionClearedElsewhere` logs `cache-present-after-eviction` (warn, `cache-persist`) after its teardown, an upper bound since a tab reloading into the same family also counts. The final browser run showed the cache still absent after eviction at both widths. A test pins the documented behaviour.

**Also not fixed, recorded:** R3-5 escape-hatch sign-outs (Google disconnect, start over, Settings Clear Data and delete family, fatal overlay) do not go through the session-end tracking, so a release landing mid-way can start a concurrent teardown (narrow; a single session-end owner in `authStore` would close it); R3-7 a failed forget can produce a `family-context` detail report plus the caller's outcome event (kept: each carries a different meaning, page vs detail vs step); R3-9/R3-10 small races around the handle being nulled mid-open or mid-write, now inside the accepted limit; review round 1's worker-reaped-across-a-clear case.

Final state: `validate` green (8658 tests), browser-verified all three two-tab cases.
