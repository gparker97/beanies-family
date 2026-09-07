# The welcome-gate sign-in hang

> Investigated 2026-09-07 against the working tree at `c6c8c298` **plus one uncommitted change**:
> `src/config/featureFlags.committed.ts:18` has `podCompaction: true` (committed value is `false`).
> That matters — the reproduction is running with compaction ON.
>
> Reports: greg, on a real build.
>
> 1. "when trying to load the newer file from the welcome gate, the sign in spinner appears to be
>    spinning indefinitely."
> 2. "i've tried to load the dev family again from google drive from the welcome gate (to go back to
>    the previous file in google). After the spinning ran for ~60s or longer, I got this error:
>    `rpc-timeout:initAndLoadCache`"

**Headline: the version guard is not the bug.** Every path that can throw
`UnsupportedBeanpodVersionError` at the welcome gate clears its spinner in a `finally` and renders a
message — I walked all six and quote them below. The spinner that never stops is the **"Sign In"
button on the decrypt panel**, and it is held open by a doc-worker RPC (`initAndLoadCache`) that does
not return. Report 2 is not a second bug; it is the same one, seen after it finally timed out.

---

## The hang

**1. Which component owns the spinner, and which flag drives it.**

`src/components/login/LoadPodView.vue`. Two spinners, one flag:

- the **button** spinner: `src/components/login/LoadPodView.vue:1120-1128` —
  `<BaseButton type="submit" ... :loading="isLoadingFile">{{ t('loginV6.unlockButton') }}</BaseButton>`.
  `loginV6.unlockButton` is **"Sign In"** (`src/services/translation/uiStrings.ts:4054`), and the
  panel's heading is `loginV6.unlockTitle`, also **"Sign In"**
  (`src/services/translation/uiStrings.ts:4045`, used at `LoadPodView.vue:1097`). This is greg's
  "sign in spinner" literally — the panel and the control both say Sign In.
  The kit-entry form's button carries the same binding (`LoadPodView.vue:1188-1194`).
- the **panel** spinner: `LoadPodView.vue:1297-1299`, rendered when
  `viewState === 'auto-loading'`, which is `isLoadingFile.value || isDriveLoading.value`
  (`LoadPodView.vue:787`).

The flag is `const isLoadingFile = ref(false)` — `src/components/login/LoadPodView.vue:76`.

Ruled out, for the record:

- `LoginPage.vue`'s own init spinner (`src/pages/LoginPage.vue:679-684`, flag `isInitializing` at
  `:76`) and its branded `activeView === 'loading'` spinner (`:754-770`).
- `App.vue`'s boot spinner (`src/App.vue:1872-1877`, `isInitializing` at `src/App.vue:171`).
- the login-machine's transitional spinner for `prove-loading` / `opening` / `done`
  (`src/pages/LoginPage.vue:736-745`).

**2. Hypothesis 5 is false, and it is worth saying so explicitly.** The fatal overlay is **not**
rendered under the boot spinner. Both are `fixed inset-0 z-[300]`
(`src/App.vue:1874` and `src/components/common/FatalErrorOverlay.vue:77`), but `FatalErrorOverlay`
is **later in the DOM** (`src/App.vue:1883-1892` vs the spinner at `:1872-1877`), so with equal
z-index it paints on top; the spinner is additionally `pointer-events-none`. If a fatal had been
raised, greg would have seen it.

---

## The call chain

### (a) The 6.0 file — where the throw lands, and why it is _not_ the hang

`parseBeanpodV4` throws at `src/services/sync/fileSync.ts:129-130` for any string `version` outside
`KNOWN_BEANPOD_VERSIONS` (`fileSync.ts:32-35`, which holds exactly `'4.0'` and `'5.0'`).

Every welcome-gate entry point that can reach it:

| #   | User action at the welcome gate                                          | Chain                                                                                                                                                                                                                      | Catch                                                                                                                                                                 | Spinner cleared?                                                                |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Sign In → cards → **Google Drive** → pick file                           | `LoadPodView.handleDriveFileSelected` (`:985`) → `syncStore.loadFromGoogleDrive` (`src/stores/syncStore.ts:4431`) → `parseBeanpodV4` (`:4482`)                                                                             | `syncStore.ts:4503-4517` returns `{success:false, reason, payloadError}` and sets `error.value` to the translated sentence                                            | **yes** — `LoadPodView.vue:1017-1019` `finally { isLoadingFile.value = false }` |
| 2   | Sign In → cards → **saved file** (native / FSA browse / drop-zone click) | `LoadPodView.handleLoadFile` (`:518`) → `syncStore.loadFromNewFile` (`syncStore.ts:1488`) → `syncService.openAndLoadFile` (`src/services/sync/syncService.ts:2143`) → `parseBeanpodV4` (`:2168`)                           | `syncService.openFileFailure` (`:2116-2141`) — typed `payloadError` out, `lastError` set to the SAME translated sentence                                              | **yes** — `LoadPodView.vue:541-543` `finally`                                   |
| 3   | Sign In → **drag-and-drop** a `.beanpod`                                 | `LoadPodView.handleDrop` (`:697`) → `syncStore.loadFromDroppedFile` (`syncStore.ts:1533`) → `syncService.loadDroppedFile` (`:2222`) → `parseBeanpodV4` (`:2237`)                                                           | `openFileFailure` again                                                                                                                                               | **yes** — `LoadPodView.vue:749-751` `finally`                                   |
| 4   | Sign In → family picker → pick a family (configured file is 6.0)         | `LoginPage.handleFamilySelected` (`src/pages/LoginPage.vue:448`) → `syncStore.loadFromFile` (`:470` → `syncStore.ts:1118`) → `parseBeanpodV4` (`syncStore.ts:1234`), rethrown (only a `finally` at `:1470-1487`, no catch) | `LoginPage.vue:519-531` — `e instanceof PayloadLoadError` → `reportPayloadFailure` + `enterGenericLoadFallback(..., { message })`                                     | **yes** — the catch sets `activeView = 'load-pod'` with the honest message      |
| 5   | Sign In → person picker → PIN / password                                 | `useLoginFlow.ensureStaged` (`src/composables/useLoginFlow.ts:426`) → `syncStore.loadFromFile` (`:442`)                                                                                                                    | `useLoginFlow.ts:446-470` — `stagedPayloadFailure = payloadErrorKind(e)`, `proveError = t(payloadErrorMessageKey(e))`, `reportPayloadFailure`, `dispatch OPEN_FAILED` | **yes** — `isBusy` cleared by `finally` at `:535-537` / `:754-756` / `:965-967` |
| 6   | Trusted-device silent probe                                              | `useLoginFlow.tryTrustedAutoOpen` (`:228`) → `loadFromFile` (`:233`)                                                                                                                                                       | `:239-265` — reports, stays silent by design                                                                                                                          | n/a (no spinner)                                                                |

`autoLoadFile` (`LoadPodView.vue:362-410`) is the one without a `finally`, and it does not need one:
it assigns `isLoadingFile.value = false` on **every** exit (`:373`, `:396`, `:408`) and its catch
does not rethrow.

**So: for a 6.0 file the honest "please update beanies" copy renders, the spinner stops, and no
overlay is raised.** I could not construct a path where `UnsupportedBeanpodVersionError` alone leaves
a spinner up.

### (b) What actually hangs

Report 2 names it. The chain, from the "Sign In" button:

```
LoadPodView.handleDecrypt                       src/components/login/LoadPodView.vue:610
  isLoadingFile.value = true                                                       :616
  await syncStore.decryptPendingFile(password)                                     :620
    → tryUnwrapFamilyKey                        src/stores/syncStore.ts:1650
    → docClient.setFamilyKey(fk, famId)                                 :1655
    → replaceDocWithCacheRecovery(...)                                  :1663
        → docClient.initAndLoadCache(familyId)                          :914   ← HANGS HERE
            → request('initAndLoadCache')        src/services/automerge/worker/docClient.ts:1079
                → worker applyAndProject.initAndLoadCache               applyAndProject.ts:504
                    → cache.initPersistenceDB(id)                       applyAndProject.ts:512
                    → cache.loadCachedDoc(key, id)                      applyAndProject.ts:516
  finally { isLoadingFile.value = false }        src/components/login/LoadPodView.vue:671-673
```

The same `replaceDocWithCacheRecovery` → `initAndLoadCache` hop is on the PIN / biometric /
cached-key route too (`syncStore.decryptPendingFileWithKey` → `syncStore.ts:2504`) and on the cold
open (`loadFromFile`'s replace branch → `syncStore.ts:1313`), so this is not specific to the
password form — it is _the_ open path.

**3. Which catch receives `UnsupportedBeanpodVersionError`:** the six in the table above. None of
them is on the hanging path, because by the time `decryptPendingFile` runs the envelope has already
parsed successfully.

---

## Why the flag is never cleared

It is cleared — eventually. `handleDecrypt` does have the `finally`:

```js
  } catch {
    formError.value = t('password.decryptionError');
  } finally {
    isLoadingFile.value = false;
  }
```

`src/components/login/LoadPodView.vue:668-674`

The spinner is not stuck on a missing reset. It is stuck on an `await` that does not return. There
is no clock in the component, in `LoadPodView`, in `LoginPage` or in `syncStore` that bounds it —
**the only bound in the whole chain is the doc-worker RPC ceiling**, and for `initAndLoadCache` that
ceiling is 120 s:

```js
const HEAVY_RPC_TIMEOUT_MS = 120_000;                 docClient.ts:87
const HEAVY_METHODS = new Set([... 'initAndLoadCache' ...]);   docClient.ts:443-451
const timeoutMs = opts.timeoutMs ?? (HEAVY_METHODS.has(method) ? HEAVY_RPC_TIMEOUT_MS : DEFAULT_RPC_TIMEOUT_MS);
                                                      docClient.ts:657-658
```

**5. Is there a watchdog?** Only one, and it does not cover this. `src/App.vue:1001-1014` arms a
35 s `initWatchdog`, but it is armed inside `App.vue`'s own `onMounted` (`:996`), it is cleared in
that function's `finally` (`src/App.vue:1574-1585`), and its guard is
`if (!isInitializing.value && !isLoadingData.value) return` (`:1003`) — App-level flags that are
already false by the time a user is interacting with the welcome gate. Nothing watches
`LoadPodView.isLoadingFile`, and nothing watches `LoginPage.isInitializing`.

So the practical answer to "how long does the sign-in spinner spin": **at least 120 s, and in
practice several multiples of that**, because the timeout path retries — see below.

---

## What the working error paths do differently

This is the useful comparison, and it cuts the opposite way from the brief: **the error paths are
the well-built part of this code.** Four things they do that the hanging path does not.

1. **They fail with a value, not an exception.** `syncService.openFileFailure`
   (`syncService.ts:2116-2141`) converts a `RemoteBlocker` into `{ success: false, payloadError }`
   _and_ writes the same translated sentence into `lastError`, so the two channels a page might read
   (`result.payloadError` and `syncStore.error`) can never disagree. `loadFromGoogleDrive` does the
   same at `syncStore.ts:4503-4517`. A returned value cannot skip a `finally`; there is nothing to
   get wrong.
2. **Where they do throw, the thrower documents it and every caller has an arm.** `loadFromFile`
   deliberately rethrows a payload failure (`syncStore.ts:1289-1296`: "Let it out; App.vue and the
   resume flow both classify it"), and all four call sites classify it — `App.vue:833-847`,
   `LoginPage.vue:519-531`, `useLoginFlow.ts:446-470`, `LoadPodView.vue:398-408`.
3. **Every one of them is bounded by a network or a picker.** A wrong password
   (`handleDecrypt` → `decryptPendingFile` → `tryUnwrapFamilyKey`) is a PBKDF2 round that finishes.
   A corrupt file fails at `parseBeanpodV4`, synchronously. A dead Drive token fails at the fetch.
   None of them queues behind a single-threaded WASM realm.
4. **The `finally` is genuinely universal already.** I checked all seven mutating handlers in
   `LoadPodView` — `handleGrantPermission` (`:436-442`), `handleLoadFile` (`:541-543`),
   `handleKitRedeem` (`:604-606`), `handleDecrypt` (`:671-673`), `handleDrop` (`:749-751`),
   `handleDriveFileSelected` (`:1017-1019`), `handleReconnectAndLoad` (`:844-846`) — every one has
   one. Adding another `finally` would fix nothing.

**The difference that matters is not error handling. It is that `initAndLoadCache` is the only step
on the sign-in path with no upper bound the user can feel, and the layer that does bound it (120 s)
is three modules below the spinner and does not tell it anything while it waits.**

---

## The rpc-timeout, and whether the cache was poisoned

### 1. Did the 6.0 load write anything to the cache? **No — and structurally it cannot.**

I traced every statement executed before the `parseBeanpodV4` throw on all four readers:

- `syncStore.loadFromGoogleDrive` (`:4431`): `requestAccessToken` → `fetchGoogleUserEmail` →
  `GoogleDriveProvider.fromExisting` → `provider.read()` → `parseBeanpodV4` (`:4482`). The only
  writes after the parse are `pendingEncryptedFile.value = …` (`:4497`) and
  `storageProviderType.value` (`:4503`) — both in-memory refs, both unreachable on the throw.
- `syncService.openAndLoadFile` (`:2143`): `cancelPendingSave()` → `showOpenFilePicker` →
  `provider.read()` → `parseBeanpodV4` (`:2168`).
- `syncService.openAndLoadFileFallback` (`:2180`) and `loadDroppedFile` (`:2222`): `file.text()` →
  `parseBeanpodV4` (`:2211`, `:2237`).
- `syncStore.loadFromFile` (`:1118`): `syncService.load()` → `parseBeanpodV4` (`:1234`). The cache
  hop (`replaceDocWithCacheRecovery`, `:1313`) is _after_ the parse and inside the `if (liveKey)`
  branch.

No `docClient.persistEnvelope`, no `flush`, no `persistDocBinary`, no `cacheFamilyKey`,
no `initAndLoadCache` runs before the parse on any of them. `docClient.setFamilyKey` — the call that
would put a key into the worker — lives in `decryptPendingFile` (`syncStore.ts:1655`), which a 6.0
file never reaches.

**So "the 6.0 file poisoned the cache" is not supported by the code.** State that plainly. What I
_cannot_ rule out from the code alone is the premise underneath it: if the file greg picked actually
loaded (i.e. this build accepted it), then it was not a 6.0 to this build and the ordinary write
path ran — see "unproven links" at the end.

The likelier poisoner is the flag: **`podCompaction: true` is on in this working tree.** A
compaction rebuilds the document and rewrites the cache base (`cache.persistDocBinary`,
`cache.ts:132`, which "clears every existing increment"), and greg's own words — "to go back to the
previous file in google" — describe a cache holding the post-compaction document while he asks the
app to open the pre-compaction file. That is the state the lineage guard exists for, and it is a
much better fit for a slow/odd `initAndLoadCache` than a file that never got past `JSON.parse`.

### 2. Which timeout actually applied

`initAndLoadCache` **is** in `HEAVY_METHODS` (`docClient.ts:447`), the tier is derived inside
`requestCore` from the method name (`docClient.ts:657-658`), and the client wrapper passes no
`opts` (`docClient.ts:1076-1082`). **There is no path that gives `initAndLoadCache` the 45 s
budget** — including the worker-respawn rehydrate, which goes through the same
`docClient.initAndLoadCache` (`src/services/automerge/worker/bootstrap.ts:29-36`). So the applicable
ceiling is **120 s**.

That does not match "~60s". Two candidate explanations, and I can only rank them:

- **Most likely: greg is quoting the toast, not the wait.** The exact string
  `rpc-timeout:initAndLoadCache` occurs in exactly one place in the codebase —
  `recoverDeadWorker(\`rpc-timeout:${method}\`)`at`docClient.ts:865`— and it becomes the
**message of the`WorkerCrashError` every *other* in-flight RPC is drained with**
(`docClient.ts:290-293`). That message is then rendered verbatim as the body of a red toast:
`showToast('error', tr('docWorker.updateFailed', "We couldn't update your data"), error.message, …)`
(`docClient.ts:935-963`, `notifyFailure`). So what greg saw is a *sibling* call's rejection, surfaced
after the heavy op was declared dead. A LIGHT sibling queued behind the heavy op has a 45 s first
fire (`DEFAULT_RPC_TIMEOUT_MS`, `:79`) with at most `MAX_DEADLINE_EXTENSIONS = 3` re-arms
(`:565`) — 45 s is the nearest real number to "~60s" anywhere in this system.
- Less likely: an under-estimated wall clock.

I am not going to claim which without a timestamped log. **Unproven.**

### 3. What could make `initAndLoadCache` never return rather than throw

Two concrete mechanisms, both in the code, both consistent with "no error, just silence":

**(a) An IndexedDB `open` queued behind a blocked `deleteDatabase` — a genuinely never-settling
promise.** `cache.clearCache` closes its own handle and then deletes, and on `onblocked`
**resolves as if it had worked**:

```js
request.onblocked = () => resolve();
```

`src/services/automerge/worker/cache.ts:470`

The delete is still pending. The very next statement in the worker's corrupt-cache branch re-opens
the same database:

```js
await cache.clearCache(id).catch(() => {});
await cache.initPersistenceDB(id);
```

`src/services/automerge/worker/applyAndProject.ts:552-553`

and `initPersistenceDB` calls `openDB(dbName, 1, { upgrade })` with **no `blocked` callback and no
timeout** (`src/services/automerge/worker/cache.ts:106-113`). Per the IndexedDB spec an `open`
request queued behind an un-completed `deleteDatabase` does not fire `success` until the delete
completes; if another connection (another tab's worker, another browser window on the same profile)
holds the DB, it never does. `initAndLoadCache` then awaits forever with no error to report. The
same `open`-with-no-blocked-handler is reachable on the _normal_ path too
(`applyAndProject.ts:512`), so any pending delete from an earlier sign-out
(`deleteFamilyDatabase` → `docClient.clearCache`, `src/services/indexeddb/database.ts:70`; the
legacy sibling `deleteDB` resolves on blocked too, `database.ts:87-94`) wedges every later open.
This is the strongest fit for "every later load hangs", because it survives a worker respawn — the
pending delete belongs to the _browser_, not to the worker.

**(b) A long synchronous WASM load that the liveness probe cannot distinguish from death.**
`cache.loadCachedDoc` (`cache.ts:292`) does `loadAndVerify(baseBinary, …)` and then `applyChanges`
over every increment — synchronous Automerge/WASM work on the worker's single thread. While it runs
the worker cannot answer anything. The timeout path then sends a corroboration **ping** with
`PING_TIMEOUT_MS = 5_000` (`docClient.ts:559`, used at `:839`); a busy worker cannot answer it, so
it is "confirmed dead" (`:843-845`), terminated, and the load is killed mid-flight. A
slow-but-progressing load is therefore indistinguishable from a wedged one — which is precisely the
failure `HEAVY_RPC_TIMEOUT_MS` was introduced to prevent, re-opened by the probe that was added
after it. **Plausible, not proven** — it needs a `perf` datapoint for `automerge.cacheLoad`
(`applyAndProject.ts:516`) from the failing device.

I found no third mechanism: the worker's dispatch (`applyAndProject.ts:1366-1367`) is a plain
`await` inside the message handler, and a throw there is posted back as an error response.

### 4. Is it a loop the user cannot get out of? **Yes, and it is worse than a plain retry.**

On the confirmed-dead path:

1. `recoverDeadWorker('rpc-timeout:initAndLoadCache')` (`docClient.ts:865`) drains every pending
   call, terminates the worker, and — because `initAndLoadCache` set `currentFamilyId = familyId`
   at `docClient.ts:1078` — sets `needsRehydrate = true` (`docClient.ts:301`).
2. `initAndLoadCache` is in `RETRYABLE_METHODS` (`docClient.ts:509`), so at `attempt === 1` the
   client re-issues it: `return requestCore(method, args, opts, 2)` (`docClient.ts:876-889`).
3. That retry calls `ensureReady()` → `spawn()`, and `spawn()` sees `needsRehydrate` and **awaits
   the rehydrator first** (`docClient.ts:395-409`) — and the rehydrator _is_
   `docClient.initAndLoadCache` (`bootstrap.ts:29-36`).

So one user tap on "Sign In" runs the failing call **three times**: the original (120 s), the
respawn's rehydrate (another 120 s, rejecting only itself because `rehydrating` is true —
`docClient.ts:800-804`), then the retry (another 120 s). Roughly six minutes of spinner. And every
subsequent RPC that triggers a respawn re-enters the same rehydrate. If the cause is mechanism (a),
respawning changes nothing at all, because the blocked delete is browser-scoped.

---

## Recovery for a user in this state

**The in-app recovery is blocked by the same wedge, and the honest answer is that there is currently
no reliable in-app way out.**

- **The fatal overlay never appears on this path.** A `WorkerCrashError` is not a `PayloadLoadError`,
  so nothing calls `surfacePayloadFatal`; `notifyFailure` shows a _toast_
  (`docClient.ts:935-963`, `notifyFailure`) and `replaceDocWithCacheRecovery` **swallows** the failure
  entirely unless it is `deviceCannotOpen` (`syncStore.ts:935-936`:
  `if (e instanceof PayloadLoadError && e.deviceCannotOpen) throw e; console.warn(...)`). So the
  user gets a red toast and a spinner, and no recovery surface at all.
- **The coordinator's `clearDataHelps` concern is real but does not apply here.** The overlay does
  hide both the advice and the button when it is false
  (`src/components/common/FatalErrorOverlay.vue:101` and `:137`), and `surfacePayloadFatal` passes
  `clearDataHelps: false` for **every** payload class
  (`src/utils/payloadFailureSurface.ts:212-217`) — including `needs-update`, where the _right_
  advice really is "update, don't clear". That is correct for the version block. It is moot for the
  rpc-timeout, because no overlay is raised.
- **"Clear data" itself goes through the wedged worker.** `deleteFamilyDatabase`
  (`src/services/indexeddb/database.ts:65-81`) starts with `await docClient.clearCache(familyId)`,
  and `docClient.clearCache` is an RPC (`docClient.ts:1421-1424`). Reaching it means `ensureReady()`,
  which — with `needsRehydrate` armed — first awaits `initAndLoadCache` again
  (`docClient.ts:395-409`). Sign-out has the same shape (`closeDatabase` → `docClient.reset()`,
  `database.ts:55-59`; `reset` is an RPC at `docClient.ts:1409-1420`).

**What actually works, today, for greg:** clear the site data from the browser, not from the app —
DevTools → Application → Storage → Clear site data, or the browser's own "delete cookies and site
data" for the origin. That removes the `beanies-cache-<familyId>` database _and_ any pending delete
against it, and it is the only step in this list that does not have to go through the worker. On
native there is no such affordance, which makes this worth fixing rather than documenting.

Before doing that, if greg still has the wedged tab open, it is worth grabbing:
`console` for `[docClient] recovering dead worker — …` and `[cache] …` lines, and the
`automerge.cacheLoad` perf timing — that one number decides between mechanism (a) and (b).

---

## Suggested fix

Smallest structural change first; the ordering is deliberate.

**1. Make the IndexedDB open unable to hang (fixes mechanism (a), ~5 lines).** Give
`openDB` its `blocked` handler and a deadline in the one place that opens the cache:

- `src/services/automerge/worker/cache.ts:106` — pass `idb`'s `blocked` / `blocking` callbacks so a
  blocked open is _observable_, and wrap the open in a bounded race that rejects with a classified
  error instead of awaiting forever.
- `src/services/automerge/worker/cache.ts:470` — `onblocked` must not resolve as success. It should
  reject (or resolve a `{ deleted: false }` the caller reads), because the current comment
  ("resolve rather than hang — matches legacy") is exactly what lets a pending delete poison every
  later open. The one honest thing to do on a blocked delete is to _not_ immediately re-open the
  same database at `applyAndProject.ts:553`.

This is the right layer: the timeout belongs to the thing that can hang, not to five callers.

**2. Do not let the liveness probe kill a busy worker (fixes mechanism (b)).** The probe at
`docClient.ts:839` cannot distinguish "wedged" from "executing synchronous WASM", and terminating
mid-load turns a slow open into an unbounded kill-retry loop. The minimal version: have the worker
post a periodic progress signal from around `applyAndProject.ts:516` (before/after `loadCachedDoc`)
and treat a recent progress signal as liveness, so `handleRpcTimeout` extends instead of tearing
down. Without this, fix 1 alone still leaves the loop for large documents.

**3. Break the retry×rehydrate multiplication.** `initAndLoadCache` is both a `RETRYABLE_METHOD`
(`docClient.ts:509`) and _the rehydrator_ (`bootstrap.ts:31`), so one failure runs it three times
(120 s each). Either drop it from `RETRYABLE_METHODS` — the respawn's rehydrate already re-runs it,
so the explicit retry is redundant — or skip the rehydrate when the method being retried _is_ the
rehydrate. One line, and it turns six minutes into two.

**4. Give the spinner an owner-level bound, not a per-catch one.** `handleDecrypt` already has its
`finally`; what it lacks is any reason to believe the await will return. Rather than patching
`LoadPodView`, put the bound where the promise is made: `replaceDocWithCacheRecovery`
(`syncStore.ts:880`) should treat "the cache could not be opened in N seconds" as a cache MISS —
which the function already handles safely (`loadedFromCache = false` → `no-local-document` basis,
`syncStore.ts:958-960`) — instead of waiting on the worker's 120 s ceiling. That converts the hang
into the existing, tested degraded path, for every caller at once (password, PIN, biometric, cold
open), with no new component state.

**5. Separately, and smaller: `replaceDocWithCacheRecovery` swallows a `WorkerCrashError`.**
`syncStore.ts:936` logs a `console.warn` and proceeds. Per the repo's no-silent-failures rule
this should emit a `logEvent` at `warn` with the crash reason in `context`, so "the cache open died
and we adopted the remote wholesale" is visible in CloudWatch. Today the only trace is a toast.

### Explicitly _not_ recommended

Adding a `finally` anywhere in `src/components/login/`. All seven mutating handlers already have
one (`LoadPodView.vue:436-442`, `:541-543`, `:604-606`, `:671-673`, `:749-751`, `:844-846`,
`:1017-1019`), and the hang is an unreturning await, not a skipped reset.

---

## Unproven links, stated plainly

1. **That greg's file was a 6.0 this build rejected.** If the guard truly "did not block it", then
   either the edit did not take, or `version` was written as a JSON _number_ — in which case
   `fileSync.ts:129` (`typeof obj.version === 'string' && …`) is false and `:132` throws a generic
   `Error('Invalid beanpod: missing version')` instead of the typed one. Still a throw, still no
   cache write, but a _worse_ message and no `detail: version=6.0` in CloudWatch. Worth checking the
   file, and worth a test either way.
2. **Which of mechanism (a) or (b) fired.** Both are real; only a log distinguishes them.
3. **The "~60s".** The applicable ceiling is 120 s; 45 s is the light-sibling budget. I could not
   reconcile 60 s to a constant.
4. **Whether the cache was already bad before the 6.0 attempt.** With `podCompaction: true` and a
   deliberate revert to a pre-compaction file, the cache and the file disagree by construction —
   that is the state to reproduce first, not the 6.0 edit.
