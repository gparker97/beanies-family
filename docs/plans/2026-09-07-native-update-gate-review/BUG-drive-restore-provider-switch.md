# The Drive restore that becomes a local file, and the peer that never follows

> Date: 2026-09-07
> Reporter: product owner, observed while restoring a pre-compaction safety copy
> Status: investigation only. Nothing was changed.
> Related: ADR-033, ADR-036, `docs/plans/2026-09-06-compacted-pod-v5.md` (R4)

**The report, verbatim:**

> "for step 2, i believe there is an issue with the design for loading another
> data file - on desktop, this opens the file picker, and on the app it loads the
> phone's file picker, even though the family pod is on google drive. the result
> works, and the data is restored, but it switches the family to local file.
> Further, session B remained on the google drive (compacted) file and did not
> also switch to local file after the import."

All three observations are real. The third is the serious one, and it is worse
than reported: on the platform the owner was using, session B could not have
followed, by construction, and no amount of waiting would have changed that.

There is also a platform asymmetry that neither the report nor the plan
anticipated: the provider switch happens **only on Chromium desktop**. On
native, and on desktop Firefox/Safari, the same button leaves the family on
Drive and the restore does propagate. So the restore drill in the v5 plan passes
or fails depending on which browser the drill is run in, and nothing in the plan
or the code says so.

---

## A. The picker

### The button, and what it calls

The "Load another Family Data File" row lives in Settings, Family Data Options:

- `src/pages/SettingsPage.vue:1802` renders `t('settings.loadAnotherDataFile')`
  ("Load another Family Data File").
- `src/pages/SettingsPage.vue:1812` wires the Browse button to
  `handleLoadFromFileClick`.
- `src/pages/SettingsPage.vue:516` `handleLoadFromFileClick()` only sets
  `showLoadFileConfirm = true`.
- `src/pages/SettingsPage.vue:520-523` `handleLoadFromFileConfirmed()` calls
  `syncStore.loadFromNewFile()`.
- `src/stores/syncStore.ts:1495` `loadFromNewFile` calls
  `syncService.openAndLoadFile()`.

`openAndLoadFile` has exactly two arms, and neither one is Drive:

```ts
// src/services/sync/syncService.ts:2144-2151
export async function openAndLoadFile(): Promise<OpenFileResult> {
  cancelPendingSave();

  if (!supportsFileSystemAccess()) {
    return openAndLoadFileFallback();
  }
  ...
    const handles = await window.showOpenFilePicker({ multiple: false });   // :2152
```

and the fallback:

```ts
// src/services/sync/syncService.ts:2188
const file = await openFilePicker();
```

`openFilePicker` is a synthesised `<input type="file">`
(`src/services/sync/fileSync.ts:288-301`). The file says which platforms land
where:

> "⚠️ THIS IS THE DISMISSAL PATH ON EVERY SHIPPING PLATFORM. The File System
> Access branch above needs `showOpenFilePicker`, which is Chromium desktop
> only; iOS, Android and Safari all route here"
> (`src/services/sync/syncService.ts:2189-2192`)

So: **Chromium desktop gets the OS FSA picker; iOS, Android and Safari get the
WebView's own file sheet. Neither is Drive.** The pod's actual storage provider
is never consulted at any point in this path. There is no `if (providerType ===
'google_drive')` branch in `openAndLoadFile`, `loadFromNewFile`, or
`handleLoadFromFileConfirmed`.

### The Drive picker path does exist, and this entry point does not reach it

`src/services/google/drivePicker.ts:198` `pickBeanpodFile(accessToken)` opens
the Google Picker with two `*.beanpod` views ("Shared with me" and "My Drive",
`drivePicker.ts:242-253`). Its wrapper is
`src/composables/usePickBeanpodFile.ts:104`.

Every entry point in the app that can open "another data file", and the picker
each one uses:

| #   | Entry point                                                                                                                             | Picker                                                                              | Lineage context passed                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Settings, Family Data Options, **Load another Family Data File** (`SettingsPage.vue:1802`)                                              | OS local picker only (FSA on Chromium desktop, `<input type=file>` everywhere else) | `user-file` (`SettingsPage.vue:558`)                                           |
| 2   | Settings, Family Data Options, "Load existing data file" (unconfigured state, `SettingsPage.vue:1611`)                                  | same handler, same OS picker                                                        | `user-file` (same decrypt call)                                                |
| 3   | Settings, Data Management, manual import (`SettingsPage.vue:644` -> `syncStore.manualImport` -> `loadFromNewFile`, `syncStore.ts:2893`) | same OS picker                                                                      | none (no `userChoseThisFile`)                                                  |
| 4   | Login, "Load a saved family file", **native** (`LoadPodView.vue:475-478`)                                                               | OS file sheet via `handleLoadFile` -> `loadFromNewFile`                             | none (`LoadPodView.vue:620` calls `decryptPendingFile(password)` with no opts) |
| 5   | Login, same button, **Chromium desktop** (`LoadPodView.vue:462-473`)                                                                    | reveals the FSA drag/browse zone                                                    | none                                                                           |
| 6   | Login, same button, **web without FSA** (`LoadPodView.vue:480` -> `loadSavedFileViaPicker`, `:492`)                                     | **Google Picker** (`pickBeanpodFromDrive`)                                          | none                                                                           |
| 7   | Login, Drive file list (`LoadPodView.vue:939`, `:1026` -> `syncStore.listGoogleDriveFiles` -> `searchBeanpodFilesGlobal`)               | Drive list, in-app                                                                  | none                                                                           |
| 8   | Join flow (`useJoinFlow.ts:595`, `:623`)                                                                                                | Google Picker                                                                       | none                                                                           |
| 9   | `rebindPodFile` (`syncStore.ts:4731`), reached from `PodAccessBanner.vue:45` / `SaveFailureBanner.vue:38`                               | Google Picker, at the caller                                                        | n/a. It **refuses** a safety copy outright (`syncStore.ts:4747-4759`)          |

Two things fall out of that table.

**A1. The one entry point that carries restore semantics is the one that cannot
see Drive.** `userChoseThisFile: true` is passed at exactly one call site in the
whole app:

```ts
// src/pages/SettingsPage.vue:552-558
// ⚠️ THE ONE CONFIRMED SITE. Both buttons that reach here go through
// `handleLoadFromFileClick` → a dialog that says "This will replace all local
// data with the contents of the selected file". That is what authorises the
// `user-file` lineage context, and it is passed from here rather than stored,
// so no other flow can inherit it.
const result = await syncStore.decryptPendingFile(password, { userChoseThisFile: true });
```

(The other `user-file` producer is `syncStore.useRemoteFileOverLocalDocument` at
`syncStore.ts:3646`, the lineage banner's action, which reads the _current_
remote, not a picked file.)

**A2. Rows 6 and 7 can see the safety copy but cannot restore it.** They reach
`decryptPendingFile(password)` with no `userChoseThisFile`, so the lineage
context is `baseline` or `no-local-document`, never `user-file`. For a device
that already holds the compacted document, picking the pre-compaction copy from
the Drive list gives verdict `ours-newer` under context `clean`/`dirty`, and:

```ts
// src/services/sync/podLineage.ts:176
  'ours-newer': { clean: 'publish-local', dirty: 'publish-local', 'user-file': 'adopt' },
```

`publish-local` means the worker touches nothing and the caller republishes its
own compacted document. So the Drive-visible route silently does the opposite of
a restore. `podLineage.ts:74-79` states this explicitly:

> "Re-pointing at a pre-compaction `.beanpod` compares `ours-newer`, which under
> any other context resolves to `publish-local` - the device would republish its
> compacted document straight over the file the family just chose, with no block
> and so no banner to recover from."

**A3. The copy points the user at a Drive file the picker cannot open.** The
compaction note says:

```ts
// src/services/translation/uiStrings.ts:4320-4322
  'compaction.safetyCopyNote': {
    en: 'beanies keeps a copy of the current file beside it in your storage, and asks you to save one to this device too. To go back to the saved one, use Load another Family Data File above. ...
```

The "copy beside it in your storage" is written through the aux store
(`usePodCompaction.ts:236`, `getAuxStore` at `storageProvider.ts:119`),
which today only Drive implements. "Load another Family Data File above" is
row 1, the local-only picker. On Chromium desktop it cannot see a Drive file at
all unless the family happens to run Google Drive for Desktop. The route that
actually works on that platform is the _manual_ export the compaction flow also
demands, which lands in Downloads.

`isSafetyCopyName`'s own doc comment assumes the opposite reachability:

```ts
// src/constants/compaction.ts:41-45
 * Used where pods are IDENTIFIED, so a joiner or a recovery flow is never handed
 * the pre-compaction file by mistake. It stays VISIBLE in the human-facing
 * picker — that is what makes it a rollback route someone can choose ...
```

The "human-facing picker" it means is the Drive one (rows 6/7), which per A2
cannot restore. The picker that _can_ restore never lists it.

**Is any of this stated as intentional?** No. The intent that the local picker
is the restore route _is_ recorded, twice:

```ts
// src/stores/syncStore.ts:4744-4746 (rebindPodFile)
// Restoring a backup deliberately is a different flow with a different
// question: Settings → Family Data Options → Load another family data
// file, which confirms "this will replace all local data" first.
```

```
docs/adr/036-pod-lineage-lives-in-the-document.md:91-94
  2. `SettingsPage`'s Load-another-family-data-file decrypt, which passes
     `userChoseThisFile` ... This is the rollback route, so it needs the
     context that can never dead-end.
```

But **the intent that this route should be local-only, on a Drive family, is not
recorded anywhere.** There is no comment, no ADR line, and no plan line saying
"a Drive family restores from a local file". It reads as an unexamined
inheritance: the button predates Drive support, and the compaction copy was
pointed at it without anyone re-deriving what it does to a Drive family.

---

## B. The provider switch

### The exact line

`decryptPendingFile` ends with two mutually exclusive re-homing branches:

```ts
// src/stores/syncStore.ts:1720-1737
      // If loaded from Google Drive, persist the config
      if (pending.driveFileId && pending.driveFileName) {
        ... storeProviderConfig(activeFamilyId, { type: 'google_drive', ... })
        syncService.setProvider(GoogleDriveProvider.fromExisting(...));
      }

      // If file was opened with a provider (local file picker), persist it
      if (pending.provider) {
        if (activeFamilyId) {
          await pending.provider.persist(activeFamilyId);   // :1734
        }
        syncService.setProvider(pending.provider);           // :1736
      }
```

(`decryptPendingFileWithKey` carries the identical pair at `syncStore.ts:2570-2575`.)

`pending.provider` is set only when `openAndLoadFile` took the FSA arm:

```ts
// src/services/sync/syncService.ts:2156-2170
    const provider = LocalStorageProvider.fromHandle(handle);
    ...
    return { success: false, needsPassword: true, fileHandle: handle, provider, envelope };
```

The fallback arm returns no provider (`syncService.ts:2210`:
`return { success: false, needsPassword: true, envelope };`).

**The line that rewrites the durable record is `syncStore.ts:1734`, and the
rewrite itself is inside `LocalStorageProvider.persist`:**

```ts
// src/services/sync/providers/localProvider.ts:212-219
  /**
   * Store the file handle in IndexedDB for session restore.
   * Also clears any stale Google Drive provider config for this family
   * so that syncService.initialize() won't restore the wrong provider.
   */
  async persist(familyId: string): Promise<void> {
    await clearProviderConfig(familyId);
    await storeFileHandle(this.handle);
  }
```

`clearProviderConfig` (`src/services/sync/fileHandleStore.ts:222-237`) deletes
the IndexedDB row _and_ the localStorage mirror, so the Drive binding does not
survive a reboot. On the next cold start, `syncService.initialize` finds no
`google_drive` config (`syncService.ts:1315`) and falls through to the stored
file handle.

`syncService.setProvider` (`syncService.ts:792-822`) then fires `onStateChange`,
and the store recomputes:

```ts
// src/stores/syncStore.ts:496-498
    storageProviderType.value = syncService.getProviderType();
    providerAccountEmail.value = syncService.getProvider()?.getAccountEmail() ?? null;
    ...
    driveFileId.value = syncService.getProvider()?.getFileId() ?? null;
```

`LocalStorageProvider.getFileId()` returns `null` (`localProvider.ts:247-249`),
so `driveFileId` is dropped too. Settings now renders "Move to Google Drive"
where it previously rendered "Move to a local file"
(`SettingsPage.vue:1775-1780`). The family is, durably and in every surface, a
local-file family.

### Is it intentional?

**Partly, and only at the wrong altitude.**

- The `persist()` doc comment (`localProvider.ts:212-215`) states the intent of
  the _clear_: "so that `syncService.initialize()` won't restore the wrong
  provider." That is a correct statement about a family that has genuinely moved
  to a local file. It is not a decision about a Drive family restoring a backup.
- The confirmation copy does say the file is switched:
  ```ts
  // src/services/translation/uiStrings.ts:3428-3429
  'settings.switchFileConfirmation': {
    en: 'This will replace all local data with the contents of the selected file and switch to that file. Continue?',
  ```
  So "switch to that file" is disclosed. What is **not** disclosed is that
  switching to a file also switches the family's storage provider off Google
  Drive, unbinds the Drive pod, and severs the channel every other device reads.
- The button's own label and subtitle frame the feature as a file switch, not a
  restore: `settings.loadAnotherDataFile` = "Load another Family Data File",
  `settings.switchDataFile` = "Switch to a different data file"
  (`uiStrings.ts:3419-3426`). The compaction note (A3) repurposed a
  file-switching feature as a restore route.

**No comment, ADR or plan line anywhere states that a restore should change the
storage provider, or acknowledges that it does.** I searched ADR-036, ADR-033,
`docs/plans/2026-09-06-compacted-pod-v5.md` and its four passes for `provider`
in the neighbourhood of the restore requirement. R4 (plan `:210-232`) discusses
the lineage stamp in detail and never mentions the provider. **The intent is not
recorded.**

### The platform asymmetry, which nobody wrote down

Because `pending.provider` exists only on the FSA arm:

| Platform                       | Picker                   | `pending.provider`     | Provider after restore              |
| ------------------------------ | ------------------------ | ---------------------- | ----------------------------------- |
| Chromium desktop (Chrome/Edge) | FSA `showOpenFilePicker` | `LocalStorageProvider` | **switched to `local`**             |
| iOS / Android native shell     | `<input type=file>`      | `undefined`            | **unchanged: still `google_drive`** |
| Desktop Firefox / Safari       | `<input type=file>`      | `undefined`            | **unchanged: still `google_drive`** |

Drag-and-drop onto the FSA zone behaves like Chromium desktop when a handle is
supplied (`syncService.ts:2238`, `loadDroppedFile`).

This matters for section C, and it also means the owner's two observations came
from two different code paths. The desktop switch is real. On the phone, the
family should still be on Drive.

---

## C. Why the peer never followed

### What is supposed to happen

The restore stamp exists precisely so peers follow. `guardLineage` returns its
verdict so the worker can tell a restore from a resolved conflict:

```ts
// src/services/automerge/worker/applyAndProject.ts:861
stampNewGeneration = act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file';
```

```ts
// src/services/automerge/worker/applyAndProject.ts:975-980
const adopted = migrateDoc(remote);
currentDoc = stampNewGeneration
  ? Automerge.change(adopted, (d) => {
      (d as { podLineage?: PodLineage | null }).podLineage = nextLineage(priorLineage);
    })
  : adopted;
```

and the comment above it states the mechanism in full:

> "⚠️ A RESTORE IS A LINEAGE EVENT. ... Adopting it as-is leaves this device on
> the old lineage, and every peer still holding the newer one reads
> `ours-newer`, republishes, and undoes the restore within one poll. So the
> adopted document is stamped with a NEW generation (`nextLineage` of what we
> held), and peers read `adopt-remote` instead: the propagation the guard was
> built for."
> (`applyAndProject.ts:838-850`)

ADR-036's addendum says the same (`:168-174`), and the plan's R4 says it at
`docs/plans/2026-09-06-compacted-pod-v5.md:210-232`, with step 5 spelling out
the expected fleet behaviour:

> "Peers then read `adopt-remote` and adopt (clean) or rebase (dirty), the
> propagation the guard was built for." (`:227`)

### Did the stamp happen on the owner's restore?

**Yes.** Trace it:

1. `SettingsPage.vue:558` passes `userChoseThisFile: true`.
2. `syncStore.ts:1663` `replaceDocWithCacheRecovery(pending.envelope, famId, fk, true)`.
3. `syncStore.ts:958-964` builds the basis. Device A holds this family and its
   cache loads, so `loadedFromCache` is true and `chosenByUser` is true:
   `{ kind: 'user-file', heads: baselineHeads }`.
4. In the worker, `lineageContextFor` returns `'user-file'`
   (`applyAndProject.ts:742`).
5. `compareLineage(remote=safety copy, local=compacted)` returns `'ours-newer'`
   (`podLineage.ts:137-138`: `remote.seq < local.seq`, or `:135` if the copy
   predates any lineage at all).
6. `POLICY['ours-newer']['user-file'] === 'adopt'` (`podLineage.ts:176`).
7. `stampNewGeneration` is therefore `true` (`applyAndProject.ts:861`), and the
   adopted document is stamped with `nextLineage(priorLineage)`
   (`:976-980`).
8. `dirty` comes back `true`, because the stamp moved heads past the file's
   (`:1004`), and `replaceDocWithCacheRecovery` arms a publish
   (`syncStore.ts:982`: `if (merged.dirty) syncService.triggerDebouncedSave();`).
9. `reloadAllStores` cancels that publish and re-arms it
   (`syncStore.ts:2929`, `:3023`).

So the document on A was correctly stamped, marked dirty, and a publish was
armed. The lineage machinery did its whole job.

### Where it breaks

**The publish had nowhere useful to go.** Ordering inside `decryptPendingFile`:

- `syncStore.ts:1736` `syncService.setProvider(pending.provider)` runs at step
  8.5, before the reload.
- `syncStore.ts:1787` `await reloadAllStores()` re-arms the debounced save at
  `:3023`.
- The save therefore fires against the **`LocalStorageProvider`**, and writes the
  restored, newly-stamped document back into the `.beanpod` the owner just
  picked (the export in Downloads, or wherever the copy was).

Nothing is written to Drive. The Drive pod still holds the compacted document at
generation _N_. Session B polls Drive, reads that unchanged file, compares its
own compacted document against it, gets `same`, and merges to a no-op
(`podLineage.ts:162`: the whole `same` row is `merge`).

**So: is there any mechanism by which B could see the restored data?**

**No. None.** Concretely:

- B reads only through its own provider, which is the Drive pod
  (`syncService.fetchAndMergeRemote`, the poll and pre-save path). There is no
  device-to-device channel in this architecture.
- A no longer writes to Drive at all. Its provider is the local file, its
  `driveFileId` is `null` (`syncStore.ts:499`), and its persisted Drive
  provider config has been deleted (`localProvider.ts:217`).
- The remote family registry pointer is **not** updated by this path.
  `registerCurrentFamily(..., { pointerIntent: true })` is called from
  `installProvider` (`syncStore.ts:745`) and `rebindPodFile`
  (`syncStore.ts:4816`), and `decryptPendingFile` calls neither. So the registry
  still points every device, including any new one, at the compacted Drive pod.
- The stamped generation _N+1_ exists on exactly one device and one local file.
  It is invisible to the fleet.

The only ways back are manual, and the user is not told about either:
Settings, Family Data Options, **Move to Google Drive** (`migrateStorage`,
`syncStore.ts:4366`), which runs `installProvider` and force-writes the local
document to a Drive destination; or re-doing the restore on a device that took
the non-FSA path.

**And the asymmetry bites here too.** Had the owner performed the restore on the
phone (or in Firefox/Safari), `pending.provider` would be `undefined`, the
provider would still be the `GoogleDriveProvider`, the re-armed debounced save
would have published the stamped document to Drive, and B's next poll would have
hit `compareLineage(remote seq N+1, local seq N) === 'adopt-remote'`,
`POLICY['adopt-remote']['clean'] === 'adopt'` (`podLineage.ts:175`), and B would
have adopted the restore. **The restore mechanism is correct. The transport is
what the FSA arm quietly removes.**

There is a second, smaller consequence worth recording: the restored document is
now written into the safety-copy/export file itself. The next compaction from
that state derives its own safety-copy name from the live pod's name, and
`safetyCopyName` deliberately stacks its marker for exactly this reason
(`src/constants/compaction.ts:22-32`: "for a family LIVING on a restored copy
it makes the copy name IDENTICAL to the pod name"). So that hazard was
anticipated. The provider switch that produces "a family living on a restored
copy" was not.

---

## Is the restore drill even testable as written?

The drill is step 6 of the plan's manual verification:

```
docs/plans/2026-09-06-compacted-pod-v5.md:521
6. Restore drill: restore the safety copy on A through Settings, Load another
   Family Data File; confirm B ADOPTS rather than reverting (watch B's console
   for `open terminus adopted`, not `kept-local`); confirm the restored family
   then compacts again cleanly and stays 5.0. ...
```

**As written, on the platform a developer would naturally use, it cannot pass.**
The drill does not name a browser. Run on Chromium desktop (the default for a
two-browser-profile soak, and the platform step 5 of the same list assumes:
"Local two-browser soak on `npm run dev`", `:520`), device A takes the FSA arm,
switches to a local file, and B is structurally unable to adopt. The drill would
report a failure of R4, when R4 is in fact working perfectly.

Run on Firefox or Safari, or on the native shell, the same drill passes.

Three further gaps in testability:

1. **The automated test cannot see this at all.** The R4 tests live in
   `src/services/automerge/worker/__tests__/rebase.test.ts:784-845`. The peer
   test at `:812` constructs the restored envelope by hand and hands it straight
   to `ap.mergeRemoteEnvelope`:
   ```ts
   const res = await ap.mergeRemoteEnvelope(await envelopeFor(restored, key), 'fam', {
     kind: 'baseline',
     heads: Automerge.getHeads(b),
   });
   ```
   It asserts the guard's verdict given that the envelope arrived. It has no
   notion of a provider, a Drive file, or how the envelope got there. Every
   assertion in it is correct and none of them constrains the defect. The whole
   worker layer is transport-blind by design (ADR-036: the guard lives in the
   worker because that is the only place both documents exist), so this is not a
   test that was written badly; it is a seam the tests do not span.
2. **The safety copy the drill names is not reachable from the picker the drill
   names.** Per A3, the Drive-side copy cannot be selected through the Settings
   local picker on Chromium desktop. Whoever runs the drill will substitute the
   manual export without noticing they have changed the scenario, which also
   means the "the one in your storage is there if you ever need support to help
   you back" promise (`uiStrings.ts:4321`) has never been exercised end to end.
3. **Nothing in the firehose distinguishes the two outcomes at A.** On the
   Chromium path A logs a perfectly healthy `adopted` at the open terminus
   (`docClient.logMergeTerminus('open terminus', ...)`, `syncStore.ts:978`) and
   then goes quiet on Drive forever. B logs nothing unusual: it keeps merging
   `same`. The plan's own success signal, "`adopted` at both termini after a
   restore" (`:473`), is satisfied at A and silently absent at B, and absence is
   the one thing the observability rules say you cannot alert on. There is no
   event anywhere that says "this family's provider changed", so a CloudWatch
   reader cannot tell a restore that stuck from one that stranded.

---

## Options

Scoped to what was asked. No recommendation on which to take.

### Option 1: make the picker follow the family's provider

When `storageProviderType === 'google_drive'`, route
`handleLoadFromFileClick` through the Google Picker
(`usePickBeanpodFile().pick()`, the primitive rows 6/8/9 already use) and
through `loadFromGoogleDrive` rather than `openAndLoadFile`, then pass
`userChoseThisFile: true` into the resulting decrypt so it keeps restore
semantics. The provider stays `GoogleDriveProvider`, the stamped document
publishes to Drive, and B adopts on its next poll.

- **For.** It fixes A, B and C in one move. It makes the compaction note truthful:
  the Drive safety copy becomes selectable from the row the copy names. It reuses
  a picker that already exists and is already the join/recovery primitive. It
  removes the platform asymmetry rather than papering over it.
- **Against.** It arms `user-file` on a Drive-sourced file for the first time,
  which widens the blast radius of the one context that never blocks; ADR-036 is
  emphatic that the test is the dialog and not the caller, so the dialog has to
  stay in front of it and the plumbing has to keep passing the flag as an
  argument. It needs `rebindPodFile`'s safety-copy refusal _not_ to be reused
  here (that refusal is correct for a repair and wrong for a restore), so two
  Drive-file entry points would deliberately disagree about safety copies.
  Google Picker reliability on iOS WebKit is the exact reason `LoadPodView`
  routes native to the OS sheet (`LoadPodView.vue:451-454`), so native would
  still need the local arm, and the asymmetry shrinks rather than vanishes.
  Restoring a Drive file _into_ the same Drive file is also a different write
  shape than today's, and the pre-save `fetchAndMergeRemote` would see its own
  source.

### Option 2: keep the local picker, stop it re-homing the family

Leave the picker alone and make the restore not change the provider: on the
`user-file` decrypt path, read the picked file's bytes but do not call
`pending.provider.persist()` / `setProvider()`, so the re-armed publish writes
the stamped document to the family's existing Drive pod.

- **For.** Smallest change, one branch in `decryptPendingFile`. It makes every
  platform behave the way native and Firefox already do, so it _removes_ the
  asymmetry by deleting the odd case rather than by adding a second picker. It
  keeps the drill honest wherever it is run. It preserves the registry pointer,
  the Drive binding and ADR-033's immutable-binding posture, which the current
  behaviour quietly violates for a family that only meant to roll back.
- **Against.** It changes the meaning of the confirmation copy, which currently
  promises "and switch to that file"; that string, and probably the button's own
  "Switch to a different data file" subtitle, would have to be re-written, and
  the genuine "I want to move my family to this other file" use case would need
  somewhere else to live (it already has one: Move to Google Drive / Move to a
  local file, `SettingsPage.vue:1775-1795`). It does not fix A3: the Drive
  safety copy is still not selectable from this row on Chromium desktop, so the
  compaction note stays partly untrue and the drill still has to substitute the
  manual export. It also means the picked local file is read once and then never
  written again, which is a slightly surprising thing for a file picker to do
  and needs saying in the UI.

### Option 3: leave the mechanism, close the loop with disclosure and a signal

Keep both behaviours, but make them legible: state in the confirmation copy that
loading a file moves the family off Google Drive and that other devices will not
follow; after a provider change on the `user-file` path, surface the "Move to
Google Drive" action as the explicit next step; and emit a structured event
(`surface: 'pod-lineage'`, `action: 'restore-provider-changed'`, with `from` /
`to`) so a restore that stranded is visible in CloudWatch rather than
indistinguishable from one that stuck.

- **For.** No behavioural risk to the lineage guard, the join flow, or the
  Picker's platform quirks. It is the only option that also improves the case
  where a family genuinely _does_ want to live on the restored local file. It
  gives the drill a pass/fail signal it currently lacks, and it satisfies the
  observability rule that a rate has to be measurable on the success path too.
- **Against.** It does not fix the reported problem; it documents it. The owner's
  session B is still stranded, and the recovery is still a manual two-step the
  user has to understand. It adds a new allowlisted context key, which per the
  project rules drags in the store data-collection declarations
  (`ALLOWED_CONTEXT_KEYS`, `docs/runbooks/native-store-submission.md`). And a
  confirmation dialog that has to explain a storage-model consequence is usually
  a sign the model, not the dialog, is what needs the change.
