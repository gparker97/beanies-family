# The 6.0 file that says "update beanies" and then changes nothing

> Date: 2026-09-07
> Reporter: product owner, on a real build, during the newer-version drill
> Status: investigation only. Nothing was changed.
> Related: `docs/plans/2026-09-06-compacted-pod-v5.md` (Testing Plan step 7, "all five surfaces"),
> `docs/plans/2026-09-07-native-update-gate.md` (R3, the block), and the sibling
> report `BUG-drive-restore-provider-switch.md`

**The report, verbatim:**

> "during step 4, when trying to import a new family file, i received a message that the file
> version was newer, but it did not prevent me from loading the file. i can confirm the version
> in the file is still reading at 6.0."

## Summary, stated up front

**`parseBeanpodV4` is not bypassed.** I walked every path by which `.beanpod` text can reach the
Automerge document, and every one of them calls it, and every one of them aborts on the throw.
There is exactly one version test in the app (`src/services/sync/fileSync.ts:129-130`) and no
reader that skips it. A 6.0 envelope never becomes a document.

**What is bypassed is the message.** On the surface greg used — Settings → Family Data Options →
Load another Family Data File — the refusal is written to `importError`
(`src/pages/SettingsPage.vue:541`), and `importError` is rendered in exactly one place
(`src/pages/SettingsPage.vue:1947-1949`), inside a `v-else` branch that **can never render**,
because its condition is `syncStore.supportsAutoSync` and `canAutoSync()` returns `true`
unconditionally (`src/services/sync/capabilities.ts:144-146`).

So the only thing that reaches the screen is the _other_ channel: `syncStore.error`
(`src/pages/SettingsPage.vue:1838-1841`), which mirrors the service's `lastError`
(`src/stores/syncStore.ts:500`), which `openFileFailure` set to the same translated sentence
(`src/services/sync/syncService.ts:2122`). That slab is the app's generic **sync-failure**
slab. It is not attached to the file the person just picked, it says nothing about the pick
having been refused, and it renders **Reconnect Drive** and **Force Save** beside the message
(`src/pages/SettingsPage.vue:1843-1855`).

The app is meanwhile still running, fully painted, on the document it already had. Nothing was
blocked because nothing needed to be: the file was refused before decrypt, the pod on screen is
the one that was already open, and no overlay is raised on this path by design. From the user's
chair that is indistinguishable from "it warned me and then carried on anyway", and the file on
disk is untouched — which is why it still reads `6.0`.

The one _structural_ hole (a route to the document with no version test at all) is the worker's
IndexedDB cache, §"Every beanpod read path" row 12. It is not what greg hit, but it is the
reason the app stays "loaded" through a refusal, and it is the only place a genuinely newer
envelope could be adopted without being asked about.

---

## The path that bypasses the guard

The guard is not bypassed. The _notice_ is. Here is the exact chain, click to screen.

1. `src/pages/SettingsPage.vue:1802-1815` — the "Load another Family Data File" row; the Browse
   button is wired to `handleLoadFromFileClick`. (The unconfigured-state twin is
   `src/pages/SettingsPage.vue:1611-1613`, same handler.)
2. `src/pages/SettingsPage.vue:516-518` — `handleLoadFromFileClick()` only sets
   `showLoadFileConfirm = true`.
3. `src/pages/SettingsPage.vue:1817-1833` — the confirm slab; "Yes, load file" calls
   `handleLoadFromFileConfirmed`.
4. `src/pages/SettingsPage.vue:520-523` — `handleLoadFromFileConfirmed()` clears `importError`
   and calls `syncStore.loadFromNewFile()`.
5. `src/stores/syncStore.ts:1488-1493` — `loadFromNewFile()` calls
   `syncService.openAndLoadFile()`.
6. `src/services/sync/syncService.ts:2144-2149` — `openAndLoadFile()`; on anything that is not
   Chromium desktop it delegates to `openAndLoadFileFallback()` (`:2199`), which is the arm iOS,
   Android and Safari take (the file says so at `:2189-2192`).
7. `src/services/sync/syncService.ts:2212` (fallback) or `:2168` (FSA arm) —
   `const envelope = parseBeanpodV4(text);`
8. `src/services/sync/fileSync.ts:129-130` — `version` is `"6.0"`, not in
   `KNOWN_BEANPOD_VERSIONS` (`fileSync.ts:32-35`), so it throws
   `UnsupportedBeanpodVersionError`. **The guard fires correctly, here, before decrypt and
   before any merge.**
9. `src/services/sync/syncService.ts:2120-2138` — `openFileFailure(e)`:
   - `:2122` sets `lastError` to `t('podNewerVersion.inline')`;
   - `:2127-2137` reports a `warning` to the firehose with `detail: version=6.0`;
   - `:2138` returns `{ success: false, payloadError: e }`. **No provider installed, no envelope
     staged, no document touched.**
10. `src/stores/syncStore.ts:1523-1527` — `loadFromNewFile` returns the classified failure
    through (`success:false`, `payloadError` set, no `needsPassword`).
11. `src/pages/SettingsPage.vue:539-541` — the caller takes the `result.payloadError` arm and
    writes the sentence to `importError`.
12. **The chain dead-ends here.** `importError` has exactly one render site,
    `src/pages/SettingsPage.vue:1947-1949`, and that block lives inside
    `<div v-else class="space-y-4">` at `src/pages/SettingsPage.vue:1909`, whose `v-if` partner
    is `<div v-if="syncStore.supportsAutoSync">` at `src/pages/SettingsPage.vue:1575`.
    `supportsAutoSync` is `computed(() => canAutoSync())` (`src/stores/syncStore.ts:452`), and
    `canAutoSync()` is:

    ```ts
    // src/services/sync/capabilities.ts:143-146
    export function canAutoSync(): boolean {
      return true;
    }
    ```

    with its own doc comment saying "Returns true unconditionally". **The `v-else` branch is
    dead on every platform, so `importError` is never rendered anywhere in the app.**

13. What the user sees instead is `src/pages/SettingsPage.vue:1836-1855`, the amber
    "Error display" slab bound to `syncStore.error`, which `src/stores/syncStore.ts:500` mirrors
    from `lastError` — the same sentence, put there at step 9. Beside it:
    `settings.reconnectDrive` (`:1845-1851`) and `settings.forceSave` (`:1852-1854`, →
    `handleForceSave` → `syncStore.forceSyncNow()`, `src/pages/SettingsPage.vue:396-398`).

So the sequence the product owner experienced is: confirm dialog closes → an amber slab appears
in the _sync status_ area saying the file version is newer → the app is exactly as it was, still
showing the family that was already open, still saving to the pod it was already bound to, with
a **Force Save** button offered. Nothing announces "the file you picked was refused", and nothing
blocks, because there is nothing to block: the import simply did not happen.

### Two collateral casualties of the same dead branch

- `handleManualImport` (`src/pages/SettingsPage.vue:641-658`) writes its failures to the same
  dead `importError`, and its own button (`src/pages/SettingsPage.vue:1942-1944`, Data
  Management → "Load") is _also_ inside the dead `v-else`. That entry point is unreachable in
  the UI on every platform, which is worth knowing because the sibling report
  (`BUG-drive-restore-provider-switch.md`, table row 3) lists it as a live surface.
- `importSuccess` is rendered in _both_ branches (`:1875-1879` in the live one, `:1950` in the
  dead one), so a successful load says "Data loaded" and a refused one says nothing in the same
  place. The asymmetry is the defect: success has a slot on the live surface, failure does not.

---

## Why the message appeared anyway

From `src/services/sync/syncService.ts:2122`:

```ts
if (isRemoteBlocker(e)) {
  updateState({ isSyncing: false, lastError: useTranslationStore().t(e.inlineMessageKey) });
```

`e.inlineMessageKey` resolves through `payloadErrorKind` → `'needs-update'` →
`PAYLOAD_INLINE_KEY['needs-update']` = `'podNewerVersion.inline'`
(`src/types/sync.ts:475-479`, `:495-501`), whose copy is

> "This family file was saved by a newer version of beanies. Update beanies on this device to
> open it. Nothing on this device is lost."
> (`src/services/translation/uiStrings.ts:4377-4381`)

That string lands in `syncService`'s `lastError`, `syncStore.error` mirrors it
(`src/stores/syncStore.ts:500`), and `src/pages/SettingsPage.vue:1838-1841` renders it.

This is deliberate — `src/services/sync/__tests__/openFileVersion.test.ts:104-114` pins that
`lastError` and `payloadError` carry _the same_ sentence, precisely so "whichever arm a page
tests first" cannot win with a different message. The test is right about the sentence and
blind to the slot: it asserts the two channels agree, not that the surface renders the one tied
to the action.

The consequence is that a **refusal of a foreign file the user just picked** is published into
the state that describes **the family's own configured pod**. The two are different facts, and
conflating them is what makes the message read as "your sync is unhappy" rather than "that file
was rejected" — and what puts a **Force Save** button underneath it.

Note also that nothing on this path calls `surfacePayloadFatal`
(`src/utils/payloadFailureSurface.ts:153-219`), so the native update gate's block, its store
link and its `app-update / blocked` event (`:193-203`) never fire here.
`PayloadFailureSource` (`src/utils/payloadFailureSurface.ts:36-44`) has members for `boot`,
`resume`, `reload`, `background-sync`, `trusted-auto-open`, `pin-unlock`, `password-unlock` and
`biometric-unlock` — **there is no member for a deliberate file import**, and no call site in
`SettingsPage.vue`'s load-a-file path. The plan's manual criterion 12 ("open it on a native
build, confirm the block appears") is only satisfiable on the cold paths.

---

## Every beanpod read path

Every row was read; every `parseBeanpodV4` call site in `src/` is accounted for.

| #   | Path (entry → reader)                                                                                                                                                                                       | Calls `parseBeanpodV4`?                                    | Catch behaviour                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Settings → "Load another Family Data File" / "Load existing data file" (`SettingsPage.vue:1611`, `:1812` → `:520` → `syncStore.ts:1488` → `syncService.ts:2144`)                                            | **yes** — `syncService.ts:2168` (FSA) / `:2212` (fallback) | `openFileFailure` (`syncService.ts:2120-2138`) **aborts**; returns `payloadError`. Caller writes it to a ref that is never rendered (`SettingsPage.vue:541` → dead `:1947`). Message reaches the user only via `syncStore.error`.                                                                                                                                               |
| 2   | Settings → Data Management → "Load" (`SettingsPage.vue:1942` → `:641` → `syncStore.ts:2885` → `loadFromNewFile`)                                                                                            | **yes** (same readers)                                     | **aborts**. Renders to the same dead `importError` — and the button itself is in the dead branch.                                                                                                                                                                                                                                                                               |
| 3   | Login → LoadPodView → "Load a saved family file", native + FSA browse (`LoadPodView.vue:519` → `syncStore.ts:1488`)                                                                                         | **yes** (same readers)                                     | **aborts**; `LoadPodView.vue:532-535` renders `result.payloadError.inlineMessageKey` in `formError`. Correct.                                                                                                                                                                                                                                                                   |
| 4   | Login → LoadPodView → drag-and-drop (`LoadPodView.vue:698`, `:738` → `syncStore.ts:1533` → `syncService.ts:2226`)                                                                                           | **yes** — `syncService.ts:2237`                            | **aborts**, but the handler has **no `payloadError` arm** (`LoadPodView.vue:739-748`); it falls to `syncStore.error`, which happens to hold the same sentence. Benign today, fragile by construction.                                                                                                                                                                           |
| 5   | Join flow → local drop zone / pick (`JoinPodView.vue:161`, `:174` → `syncStore.ts:1488` / `:1533`)                                                                                                          | **yes** (same readers)                                     | **aborts**; `JoinPodView.vue:203-206` renders `payloadError.inlineMessageKey`. Correct.                                                                                                                                                                                                                                                                                         |
| 6   | Join flow → Google Picker (`useJoinFlow.ts:594` `doPickAndLoad` → `syncStore.ts:4431`)                                                                                                                      | **yes** — `syncStore.ts:4482`                              | **aborts**, but `useJoinFlow.ts:625-633` reports `FILE_READ_FAILED` instead of routing through `joinCodeForBlocker` (`useJoinFlow.ts:97-105`) as its sibling `tryAutoLoadByFileId` does (`:556-565`). The joiner is told to ask for a new invite link, which cannot help.                                                                                                       |
| 7   | Join flow → silent read by fileId (`useJoinFlow.ts:527` → `syncStore.ts:4431`)                                                                                                                              | **yes** — `syncStore.ts:4482`                              | **aborts**; maps to `FILE_NEWER_VERSION` correctly (`useJoinFlow.ts:557-565`).                                                                                                                                                                                                                                                                                                  |
| 8   | Login → Drive file list / `/open` landing (`LoadPodView.vue:939`, `OpenFromDrivePage.vue` → `syncStore.ts:4431`)                                                                                            | **yes** — `syncStore.ts:4482`                              | **aborts**; `LoadPodView.vue:417-424` renders the inline key and latches `podUnopenableHere`. Correct.                                                                                                                                                                                                                                                                          |
| 9   | Drive rebind (`PodAccessBanner.vue:44-53`, `SaveFailureBanner.vue:34-47` → `syncStore.ts:4731`)                                                                                                             | **yes** — `syncStore.ts:4769`                              | **aborts**; returns `{ok:false, code:'FILE_NEWER_VERSION'}` (`syncStore.ts:4829-4846`). `SaveFailureBanner.vue:45` renders it. **`PodAccessBanner.pickFamilyFile` (`:49-53`) discards the result entirely** — no message, no state change, the banner keeps showing the old error.                                                                                              |
| 10  | Boot / poll / stale-tab reload (`App.vue:736`, `syncStore.ts:3399`, `:3154` → `syncStore.ts:1118`)                                                                                                          | **yes** — `syncStore.ts:1234`                              | **aborts**; the outer `try` at `syncStore.ts:1179` has only a `finally` (`:1468`), so it propagates. `App.vue:845-849` raises the fatal overlay; `backgroundSyncFromFile` latches via `notePodUnopenable` (`syncStore.ts:3341-3346`).                                                                                                                                           |
| 11  | Save-time pre-merge (`syncService.ts:1519` `fetchAndMergeRemote` ← `doSave`)                                                                                                                                | **yes** — `syncService.ts:1575`                            | **aborts**; typed throw passes through untouched (`:1576-1590`), `noteRemoteUnreadable` latches, `doSave` rethrows on a blocker (`syncService.ts:1806-1828`) rather than taking its "save local anyway" branch.                                                                                                                                                                 |
| 12  | **Boot from the IndexedDB persistence cache** (`App.vue:674`, `:871` → `syncStore.ts:1844` → `docClient.initAndLoadCache` / `docClient.readEnvelope` → `applyAndProject.ts:1122-1124` → `cache.ts:431-443`) | **NO**                                                     | **N/A — there is no version test on this route at all.** `cache.loadCachedEnvelope()` is a bare `JSON.parse(entry.payload) as BeanpodFileV4` (`cache.ts:439`). It structurally _cannot_ use `parseBeanpodV4`, because `persistEnvelope` strips the payload (`cache.ts:421`, `withoutPayload`) and `parseBeanpodV4` rejects an empty `encryptedPayload` (`fileSync.ts:137-139`). |
| 13  | **Boot fast-paint from the projection snapshot** (`syncStore.ts:1866` `docClient.loadProjectionSnapshot`)                                                                                                   | **NO**                                                     | **N/A** — paints the whole UI from a cached projection (`cache.ts:238`) with no envelope involved.                                                                                                                                                                                                                                                                              |
| 14  | Post-write verify (`syncStore.ts:1974` `verifyJustWritten` ← `createNewFile` step `'verify'`)                                                                                                               | **yes** — `syncStore.ts:1983`                              | **aborts**; `createNewFile`'s catch classifies and returns `{ok:false}` (`syncStore.ts:2426-2452`). Write path, not a read of foreign bytes.                                                                                                                                                                                                                                    |
| 15  | Create-time commit (`syncStore.ts:2350`)                                                                                                                                                                    | **yes**                                                    | Parses the envelope this build _just wrote_. Not a foreign-file route.                                                                                                                                                                                                                                                                                                          |
| 16  | Drive collision probe (`connectStorage.ts:223-241`)                                                                                                                                                         | **no, deliberately**                                       | `isStubBeanpod` (`connectStorage.ts:256-260`) is structural (`''` or `'{}'`); anything else falls to `adopt-existing`, which is confirm-gated and whose confirmed open goes through row 8. The old `!== '4.0'` sniff here is documented as the bug this replaced (`connectStorage.ts:246-254`).                                                                                 |
| 17  | `syncService.loadAndParseV4` (`syncService.ts:2068`)                                                                                                                                                        | **yes** — `:2084`                                          | **Dead code.** No production caller remains (only `__mocks__/syncService.ts:82`).                                                                                                                                                                                                                                                                                               |

Worth stating explicitly, because it is what the report's premise turns on: **rows 12 and 13 are
the only routes to a live document that never ask the version question**, and neither can be
reached with foreign bytes. Every writer into that cache
(`docClient.persistEnvelope`, and the worker's own persist after `mergeRemoteEnvelope`) is fed an
envelope that main already validated. The cache is therefore not an _entry_ for a 6.0 file — but
it is why the app stays fully loaded and usable while a refusal is on screen, and it is the one
place a newer envelope could be adopted silently if it ever did get in (a build downgrade on the
same device, or a hand-edited cache row).

---

## Suggested fix

Three changes, smallest first. Only the first is needed to close what the product owner hit.

### 1. Delete the dead branch, not the symptom (the owning layer is the template's own condition)

`canAutoSync()` returns `true` unconditionally and says so (`src/services/sync/capabilities.ts:143-146`).
Everything under `<div v-else>` at `src/pages/SettingsPage.vue:1909-1954` is therefore
unreachable — including the only render of `importError` and the only button for
`handleManualImport`.

Delete the `v-if="syncStore.supportsAutoSync"` / `v-else` split, keep the live branch, and move
the two things the dead branch was carrying into it:

- the `importError` slab, placed **immediately under the confirm slab** at
  `src/pages/SettingsPage.vue:1833` (and under the unconfigured twin at `:1631`), so the refusal
  renders where the action happened and beside the `importSuccess` slab that already lives there
  (`:1875`);
- Data Management's manual-import button, if it is still wanted — otherwise delete
  `handleManualImport` and `syncStore.manualImport` with it rather than leaving a store action
  whose only caller is unreachable UI.

Then remove `supportsAutoSync` (`src/stores/syncStore.ts:452`, `:5343`) and `canAutoSync`
if nothing else reads them — the other reader is `src/stores/syncStore.ts:3817`, a guard that is
likewise always true.

This is a template fix, but it is the structural one: the defect is that a `ref` written on
every failure path had no mounted render site, and no test can catch that while the component
under test is the script.

### 2. Stop a refused _pick_ from being published as the _pod's_ state

`openFileFailure` (`src/services/sync/syncService.ts:2120-2138`) writes the refusal into
`lastError`, which is the configured pod's error channel (`src/stores/syncStore.ts:500`), which
`src/pages/SettingsPage.vue:1838` renders as a sync failure with **Force Save** and **Reconnect
Drive** beside it. A file the user declined to open is not a fact about the file the app is
bound to, and offering "Force Save" in response to it is actively wrong.

The smallest honest change once (1) lands: in the blocker arm, set `lastError: null` and let the
returned `payloadError` be the only channel — every caller already has an arm for it (rows 1, 3,
5 of the table), and row 4 needs the one-line arm it is missing
(`src/components/login/LoadPodView.vue:739-748`). `src/services/sync/__tests__/openFileVersion.test.ts:104-114`
pins the current behaviour and would be updated in the same change: the assertion becomes "the
refusal travels as `payloadError` and does **not** touch the pod's `lastError`", which is the
invariant actually worth pinning.

### 3. Give the import surfaces the block's way out (or say why they do not get one)

`surfacePayloadFatal` is unreachable from any import surface: `PayloadFailureSource`
(`src/utils/payloadFailureSurface.ts:36-44`) has no member for it, and nothing in
`SettingsPage.vue`'s load-a-file path calls it. That is defensible — the app is painting real
data behind the button, and `payloadFailureSurface.ts:143-152` states the rule — but it means
the native update gate's store link and its `app-update / blocked` event exist only on cold
boot, resume and grant-permission.

Either:

- add an `'import'` source and, for `kind === 'needs-update'` **only**, render the store link
  inline beside the refusal (the URL already comes from `storeUrlFor(getPlatform())`,
  `src/services/appUpdate/storeUrl.ts`, and is data, not a callback — so a shared
  `<PodBlockNotice>` can render the same `{ labelKey, url }` the overlay does); or
- record in the plan that the block is a cold-path-only guarantee, and change manual criterion
  12 (`docs/plans/2026-09-07-native-update-gate.md:422`) to name the surface it is actually
  testable on, so the next drill does not fail the same way.

### Also worth fixing while the file is open (found in the sweep, not what greg hit)

- `src/components/common/PodAccessBanner.vue:49-53` — `pickFamilyFile()` discards
  `rebindPodFile`'s typed result. A refused rebind (including `FILE_NEWER_VERSION`) produces no
  message at all. Mirror `SaveFailureBanner.vue:38-46`, which renders
  `POD_ACCESS_ERRORS[recovery.code].messageKey`.
- `src/composables/useJoinFlow.ts:625-633` — `doPickAndLoad` reports `FILE_READ_FAILED` for a
  classified blocker. Route it through `joinCodeForBlocker` exactly as
  `tryAutoLoadByFileId` does at `:556-565`, so a 6.0 file in the join flow says "update
  beanies" rather than "ask the inviter for a new link".
- `src/components/login/LoadPodView.vue:739-748` — the drop handler has no `payloadError` arm
  and relies on `syncStore.error` holding the same string. If fix (2) lands, this arm becomes
  load-bearing.
- `src/services/sync/syncService.ts:2068-2105` — `loadAndParseV4` has no production caller.
  Delete it and its mock (`src/services/sync/__mocks__/syncService.ts:82`).
- `src/services/automerge/worker/cache.ts:431-443` — the one route to a document with no version
  test. A cheap boundary check (`loadCachedEnvelope` refuses an envelope whose `version` is a
  string outside the known set, and the caller treats it as a cache miss so the file re-seeds)
  would close it without touching `parseBeanpodV4`, which cannot be used here because the cached
  envelope is payload-stripped by design (`cache.ts:421`, `fileSync.ts:137-139`).
