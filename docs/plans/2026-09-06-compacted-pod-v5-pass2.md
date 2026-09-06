## Pass 2 changes

- **R3.1 no longer overrides `inlineMessageKey` on the subclass; the base class answers a new `needsAppUpdate` member and `payloadErrorMessageKey` owns the branch.** `PayloadLoadError.inlineMessageKey` DELEGATES to `payloadErrorMessageKey(this)` with the comment "delegates, so the three-way copy rule lives in one place" (`src/types/sync.ts`, the `get inlineMessageKey()` on the abstract class), and five live sites call `payloadErrorMessageKey(e)` DIRECTLY while a dozen read `.inlineMessageKey`: `src/components/login/LoadPodView.vue:395`, `:423`, `src/composables/useLoginFlow.ts:455`, `src/pages/LoginPage.vue:526`, `src/pages/SettingsPage.vue:445` versus `LoadPodView.vue:244/581/651`, `SettingsPage.vue:561`, `useLoginFlow.ts:678/881`, `src/stores/syncStore.ts:3541/3547/3579`, `src/components/login/ResumePodSetup.vue:400`, `src/composables/useBiometricSignIn.ts:106`. A subclass override would have made those two groups show different copy for the same error. The member idiom is also the one the file states for itself ("prefer a member that a new subclass must ANSWER to an `instanceof` it can silently inherit the wrong side of", `src/types/sync.ts`, the `RemoteBlocker` doc block).
- **R3.4 keys the overlay and the paging decision on `needsAppUpdate`, not on `step === 'parse'`.** `surfacePayloadFatal`'s `overlayKey` ternary branches on FLAGS (`keyMayBeWrong`, `deviceCannotOpen`) and carries the comment "THREE-way, matching `payloadErrorMessageKey`" (`src/utils/payloadFailureSurface.ts:112-121`); a `step`-keyed arm would break that pairing by construction. It would also silence the genuine torn-upload page, which is a real incident. One flag, three consumers (`payloadErrorMessageKey`, the overlay ternary, and a third early return in `reportPayloadFailure` beside the two that already exist at `payloadFailureSurface.ts:60-66`).
- **The Observability line for `noteRemoteUnreadable` needs no code, only a test.** `PayloadLoadError.latches` is already `this.step !== 'parse' && !this.keyMayBeWrong` (`src/types/sync.ts`), and `noteRemoteUnreadable` already reports every non-latching blocker at `severity: 'warning'` with `error_code: err.step`, with a comment that already names "a pod from a newer build" (`src/services/sync/syncService.ts:120-143`). Restated as a pin rather than as work.
- **R2.3 collapses the three picker readers instead of widening their literals.** `syncService.ts:2065-2090`, `:2117-2138` and `:2157-2180` are three byte-similar copies of `detectFileVersion` then `parseBeanpodV4` then a hand-rolled "Unsupported file version" exit, each inside a try that already catches. The codebase already carries both the precedent and the reasoning for deleting the pre-call, at `src/stores/syncStore.ts:1230-1234` ("a second full JSON.parse of the whole multi-megabyte file purely to read one field"). `rawText`, the only thing the unsupported arm returns, is written at exactly those three lines and read NOWHERE in `src/`, so it goes with them.
- **`detectFileVersion` is deleted, not widened.** After the collapse above and R2.5 it has zero production consumers (its only two were `connectStorage.ts:250` and those three sites). The known-version set then has ONE reader, `parseBeanpodV4`, so R2.2's "so the three cannot drift" problem is retired rather than managed.
- **NEW, and the reason this pass exists: the local-file picker path fails silently on an unreadable version.** `loadFromNewFile` and `loadFromDroppedFile` return a bare `{ success: false }` with the reason dropped (`syncStore.ts:1488-1513`, `:1517-1547`), and `SettingsPage.handleLoadFromFileConfirmed` (`SettingsPage.vue:522-537`) has NO failure arm at all: the user picks a file and nothing happens. `LoadPodView.handleLoadFile` (`LoadPodView.vue:519-539`) shows the generic `auth.fileLoadFailed`. Fixed by carrying the blocker on the result as `payloadError`, the field name and idiom `decryptPendingFile` already returns (`syncStore.ts:1590-1600`) and both pages already render (`SettingsPage.vue:561`, `LoadPodView.vue:244`).
- **R3.5's `rebindPodFile` arm moves into `classifyDriveFailure` and the structured registry.** `src/utils/podAccess.ts:128` is the sole classifier at both catch sites (`syncStore.ts:3948` and `:4779`), and `POD_ACCESS_ERRORS` is `as const satisfies Record<PodAccessErrorCode, PodAccessEntry>` so a new code forces a message, a recovery and a severity (`podAccess.ts:60-95`). One arm there heals both sites. `rebindPodFile`'s report also hardcodes `severity: 'critical'` (`syncStore.ts:4783`) while `POD_ACCESS_SEVERITY` exists precisely to answer that question as data (`podAccess.ts:107`), so it reads the table instead and "please update beanies" stops paging Slack.
- **R3.5's join arm reuses the one mapper that already exists.** `asJoinDecryptError` already maps `payload.deviceCannotOpen ? 'FILE_TOO_LARGE' : 'FILE_CORRUPT'` (`src/composables/useJoinFlow.ts:106`); the new code is a third arm there. `doPickAndLoad` (`useJoinFlow.ts:586-596`) today flattens every load failure to `FILE_READ_FAILED` carrying a raw English `syncStore.error`, so it reuses the same mapper rather than growing a second one.
- **R4 needs no worker op, no protocol case, no client method and no store call site.** The `user-file` adopt already happens inside `mergeRemoteEnvelope`'s `installWholesale` branch (`src/services/automerge/worker/applyAndProject.ts:940-1000`), which is the only place both lineages exist and where `guardLineage` has already computed the verdict. The branch already derives `dirty: !headsEqual(remoteHeads, heads)`, and `replaceDocWithCacheRecovery` already does `if (merged.dirty) syncService.triggerDebouncedSave()` (`syncStore.ts:987`), so a stamped restore publishes itself with zero new plumbing. A separate `stampLineage` RPC would also open a window: the adopt branch calls `schedulePersist()` and `pushProjection` before returning, so a save landing between the two calls would publish the unstamped document.
- **R4.3's condition is the guard's verdict, not a re-derived comparison.** `compareLineage` already answers "the adopted document is older" including the `remote === null` case (`src/services/sync/podLineage.ts`), so the stamp fires on `ours-newer` under `user-file` and nowhere else. That also makes the LineageBanner route correct without a second rule: `conflict` x `user-file` is `adopt` in the same POLICY table and must mint nothing.
- **R4.2's shared helper lands in `worker/docOps.ts` beside `docLineage`.** `docLineage` is documented as "the ONE place absent-or-null is decided" (`docOps.ts:56-70`); `nextLineage(prev)` belongs next to it, and then `compactDoc` (`applyAndProject.ts:1226`), the restore stamp, and `beanpodProfile.spec.ts` all mint through one function.
- **R5's `atLeast` is specified as a floor, and its blind spot is stated.** Written as an override it would write a SECOND compaction's backup as 4.0. And the backup's document still carries the old lineage, so a device with no cache that picks the safety copy at login reaches `no-local-document` (no guard, no stamp, `applyAndProject.ts:840`) and republishes the family as 4.0. That is R4.5's limitation with its version consequence spelled out; it is now a caveat rather than a surprise.
- **R5 also records what the current build already does, so nobody re-implements it.** `findBeanpodInFolder` already excludes safety copies (`src/services/google/driveService.ts:739-753`) and `rebindPodFile` already refuses to bind one (`syncStore.ts:4694-4703`). The human picker deliberately still shows it. R5 is therefore aimed at the DEPLOYED build's picker only.
- **R6 collapses `SoakVerdict` to its array and renders the list once.** `ok` is defined as `behind.length === 0` (`src/services/pod/podSoak.ts`) and both readers of `ok` are the gates being deleted, so it becomes an unread field. And `usePodHealth` is already the single reactive reading (`waitingOn`, `usePodHealth.ts:72`) and `usePodCompaction` already calls `usePodHealth()` (`usePodCompaction.ts:76`), so the item formatting is one computed there and `usePodCompaction`'s own `soak()` plus its `evaluateSoak` import go (`usePodCompaction.ts:29`, `:137`). `formatNames` stays the ONE joiner (`podSoak.ts`, rendered at `SettingsPage.vue:2050`).
- **`beanpodProfile.spec.ts` is specified concretely.** It calls `Automerge.from(plain)` with no stamp (`:261-265`), so "pass the lineage" means stamping `plain` through `nextLineage` first, exactly as `compactDoc` does, or the diagnostic keeps producing a compacted 4.0.
- Files Affected, Approach, Acceptance Criteria and Testing Plan updated to match; `protocol.ts` and the `docClient` stampLineage entry removed, `src/utils/podAccess.ts`, `src/services/automerge/worker/docOps.ts` and `src/components/login/LoadPodView.vue` added.

---

# Plan: Compacted pods are beanpod 5.0, and the soak gate becomes a notice

> Date: 2026-09-06
> Related issues: None (direct implementation; tracker #90 Tier 3 follow-up)
> Plan file: `docs/plans/2026-09-06-compacted-pod-v5-pass2.md` (Pass 2 of `docs/plans/2026-09-06-compacted-pod-v5.md`)
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md` (P1, P5, P6 complete; P2/P3 and P4 checked directly). Every file:line below was pinned by the audit at `33dbef34` (current) or `c3a6be98` (deployed), or re-verified in Pass 2 against the working tree.
> Supersedes: the soak gate half of `docs/plans/2026-09-06-pod-compaction-tier3.md` (Stage 4, R3/R4). Stages 1 to 3 are unchanged.

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family owner, I want to compact our family file without having to find every device anyone in the family has ever opened beanies on, so that the file opens on an old tablet and nobody's data is silently damaged by a device that has not updated yet.

## Context

Compaction rewrites the family document without its history. A compacted document shares no ancestry with the original, so a device on a build that predates the lineage guard (production is `c3a6be98`, 0.16, which has no lineage concept) CRDT-merges the two, deterministically destroys the compactor's edits, and carries the new lineage id forward so that every guarded device then reads the corruption as clean (ADR-036).

Stage 4's defence was a soak gate: refuse to compact until every recently active member has logged in on a guard-honouring build. The gate is per member (`lineageEpoch` on the member row) and cannot see a person's other devices, so its instruction, "open beanies once on every device you use it on", is unverifiable and, per greg, an impossible ask for a normal family. Once Sam logs in once on a current build, Sam passes forever, and Sam's old tablet is still a hazard the gate cannot see.

The audit established a structural replacement. The deployed build's `parseBeanpodV4` (`c3a6be98:src/services/sync/fileSync.ts:73-74`) throws on any envelope `version` other than `'4.0'`, before decrypt, before the worker, and before adopting the remote marker or key dicts; and every Automerge merge entry point in the deployed build sits behind it (P1). So a compacted pod written as **version 5.0** cannot be merged by a pre-guard build. No read-path failure wipes the cache, deletes a credential, or loops on a password prompt (P1, P6 section 2). The catastrophic case is gone by construction.

What a stale build can still do is **overwrite** the compacted pod, by two mechanisms (P1 F2, F1): any save on a warm-cache stale device (the baseline skip, not the swallowed throw), and the owner creating a same-named family on a stale build (the deployed stub probe reads a 5.0 file as an empty placeholder). Both are loud, both are bounded by the fleet's `ours-newer` to `publish-local` self-heal (`src/services/sync/podLineage.ts`, the `POLICY` table), and both cost the same: whatever the stale device wrote, plus the wrapped key of any member who joined after that device last synced, until the republish lands. The bump therefore does not replace draining the fleet; it changes what a straggler can do from "silently corrupt everyone" to "loudly revert until the fleet pushes back". The deploy sequence stays the primary control, and the soak gate stops pretending to be one.

The audit also found that the obvious implementation is wrong. Stamping `'5.0'` on the envelope at compaction and letting the spread carry it lasts exactly one round trip: the four `kept-local` termini adopt the REMOTE envelope (including its version) and republish the LOCAL compacted document under it (P5 Trap 1, P6 F1, found independently). Pass 2 re-verified the mechanism: `preserveLocalKeyDicts` returns `{ ...incoming, ...key dicts }` (`src/services/sync/envelopeMerge.ts:68-96`), so `version` is carried from the remote by a spread nobody was looking at. The version must describe the payload, and the payload's lineage lives in the document. That is the design centre of this plan.

## Requirements

### R1. The envelope version is derived from the document, never carried by spread

1. `exportEncryptedPayload` (`src/services/automerge/worker/applyAndProject.ts:1039-1045`, client `src/services/automerge/worker/docClient.ts:1317`) returns `lineage: docLineage(doc)` alongside `{ payload, heads }`. Read from the SAME `doc` const the heads are read from, so it describes exactly the bytes being exported.
2. `reEncryptEnvelope(envelope, encryptedPayload, lineage, opts?)` (`src/services/sync/fileSync.ts:214-222`) stamps the version. The `lineage` parameter is REQUIRED and is a `PodLineage | null`, not a version string: a writer cannot pass the wrong version because it does not get to choose one. `opts.atLeast?: BeanpodVersion` is a FLOOR used by exactly one caller (R5) and can only raise:

   ```ts
   const derived: BeanpodVersion = lineage ? '5.0' : '4.0';
   const version: BeanpodVersion = opts?.atLeast === '5.0' ? '5.0' : derived;
   ```

   Written as an override rather than a floor it would write a SECOND compaction's backup as 4.0, which is the forbidden artefact.

3. Both writers pass it: `doSave` (`src/services/sync/syncService.ts:1801-1802`, which already destructures `{ payload, heads: exportedHeads }` from the same call) and `buildExportEnvelope` (`src/stores/syncStore.ts:2822-2837`).
4. `usePodCompaction` gains NO envelope stamp. Its "NO ENVELOPE STAMP" note (`src/composables/usePodCompaction.ts:381-386`) is now true for a stronger reason and is updated to say so.
5. Consequences that follow for free and must be tested rather than assumed: the compaction publish writes 5.0 because the document is compacted; the failed-publish self-repair (`ours-newer` to `publish-local`) republishes as 5.0 for the same reason; a `kept-local` after a stale overwrite republishes as 5.0; a never-compacted family writes 4.0 byte-for-byte as today.

### R2. Every reader accepts 4.0 and 5.0, from one definition

1. `export type BeanpodVersion = '4.0' | '5.0'` in `src/types/syncFileV4.ts`; `BeanpodFileV4.version: BeanpodVersion` (`:56`). `BeanpodFileV4` is NOT renamed (the V4 names the key model, which does not change; 30+ importers).
2. `KNOWN_BEANPOD_VERSIONS: ReadonlySet<BeanpodVersion>` in `fileSync.ts`, with exactly ONE reader: `parseBeanpodV4` (`fileSync.ts:73-75`). Under R2.3 and R2.5 there is no second version test left in the app, so there is nothing for it to drift from.
3. **The three picker readers lose their `detectFileVersion` pre-call entirely** rather than widening its literal. `openAndLoadFile` (`syncService.ts:2065-2090`), `openAndLoadFileFallback` (`:2117-2138`) and `loadDroppedFile` (`:2157-2180`) are three byte-similar copies of the same shape: `detectFileVersion(text)`, then `parseBeanpodV4(text)` on `'4.0'`, then a hand-rolled `lastError: 'Unsupported file version: ...'` on anything else, all inside a try that already catches. Each becomes a plain `parseBeanpodV4(text)` inside that try. The reasoning is already written in this codebase at `src/stores/syncStore.ts:1230-1234`: "`parseBeanpodV4` validates the version itself and throws a BETTER message, so the old `detectFileVersion` pre-call was a second full JSON.parse of the whole multi-megabyte file purely to read one field, then thrown away."
   - `rawText`, the only value the deleted arm returned (`syncService.ts:71`, written at `:2084`, `:2133`, `:2176`), has NO reader anywhere in `src/`. It is removed with the arm. Its comment calls it "raw file text for V3 fallback detection"; there is no V3 fallback.
   - The three catches gain the `payloadError` carry described in R3.7.
4. `createBeanpodV4` keeps its literal `'4.0'` (`fileSync.ts:40`): a new family is a 4.0 family until it compacts.
5. `isStubBeanpod` (`src/services/sync/connectStorage.ts:245-251`) returns `true` only for null, empty, whitespace, or `{}`. It no longer consults any version. A JSON object with a string `version` field is never a stub, whatever the version; `resolveExistingBeanpod` then falls to `adopt-existing`, which is confirm-gated. Its own comment (`connectStorage.ts:219-222`) already promises that any failure falls safe to `adopt-existing`; the code now does.
6. **`detectFileVersion` is deleted** (`fileSync.ts:94-105`), along with its import in `syncService.ts:24` and `connectStorage.ts:27` and its `fileSync.test.ts` block (`:125-142`). After R2.3 and R2.5 it has no production caller. Leaving an exported version-sniffer that nothing reads is the next person's trap.

### R3. A version newer than this build understands is one typed, non-destructive error, thrown at the source

1. `PayloadLoadError` (`src/types/sync.ts`) gains ONE member beside `keyMayBeWrong` and `deviceCannotOpen`, in the same idiom the class already documents ("prefer a member that a new subclass must ANSWER to an `instanceof` it can silently inherit the wrong side of"):

   ```ts
   /**
    * Is the file simply NEWER than this build, rather than damaged?
    * Overridden to `true` by `UnsupportedBeanpodVersionError`. The action is
    * "update beanies", which is neither an incident nor a data problem.
    */
   get needsAppUpdate(): boolean { return false; }
   ```

2. `export class UnsupportedBeanpodVersionError extends PayloadLoadError` in `src/types/sync.ts` (which has no imports, so no cycle): `step = 'parse'`, literal `name` (never `new.target.name`; the prod build minifies and the worker error registry keys on `err.name`), `readonly fileVersion: string`, `override get needsAppUpdate() { return true; }`. Inherited unchanged: `latches: false` (the base already returns `false` for `step === 'parse'`), `keyMayBeWrong: false`, `deviceCannotOpen: false`. It is NEVER a subclass of `CorruptPayloadError` (which the worker's cache self-heal deletes the cache on).
3. **`payloadErrorMessageKey` owns the branch, and the subclass does NOT override `inlineMessageKey`.** Add `if (err.needsAppUpdate) return 'podNewerVersion.inline';` above the existing `parse` arm in `payloadErrorMessageKey` (`src/types/sync.ts`), and add `'podNewerVersion.inline'` to `PodBlockMessageKey`. `podUnreadable.inline` stays for the torn-read half of `parse`.
   - This is not a style preference. `PayloadLoadError.inlineMessageKey` is a getter that DELEGATES to `payloadErrorMessageKey(this)`, with the comment "delegates, so the three-way copy rule lives in one place". Five sites call `payloadErrorMessageKey(e)` directly (`LoadPodView.vue:395`, `:423`, `useLoginFlow.ts:455`, `LoginPage.vue:526`, `SettingsPage.vue:445`) and a dozen read `.inlineMessageKey` (`LoadPodView.vue:244/581/651`, `SettingsPage.vue:561`, `useLoginFlow.ts:678/881`, `syncStore.ts:3541/3547/3579`, `ResumePodSetup.vue:400`, `useBiometricSignIn.ts:106`). A subclass override would show two different messages for one error, split across those two groups.
4. `parseBeanpodV4` throws it when `version` is a string not in `KNOWN_BEANPOD_VERSIONS`, carrying that string in `fileVersion` and in the message. A missing or non-string `version` stays the plain "invalid file" `Error` (it is not a newer beanpod; it is not a beanpod).
5. `fetchAndMergeRemote`'s wrap (`syncService.ts:1537-1548`) becomes `e instanceof PayloadLoadError ? e : new CorruptPayloadError(...)`, the idiom `payloadFailure` already uses (`src/services/automerge/worker/docOps.ts:354-358`), so it does not relabel a typed throw as corruption.
6. **`payloadFailureSurface.ts` branches on the same member, in both of its decisions.**
   - `reportPayloadFailure` gains a third early return beside the two that already exist (`:60-66`): `if (err.needsAppUpdate) return;`. "Update beanies" is not an incident and must not page.
   - `surfacePayloadFatal`'s `overlayKey` ternary (`:112-121`) gains a `needsAppUpdate` arm returning `'resumeSetup.podNewerVersion'`. It must stay keyed on flags, not on `step`: its own comment is "THREE-way, matching `payloadErrorMessageKey`", and a `step === 'parse'` arm would both break that pairing and silence the genuine torn-upload page, which IS an incident.
7. **The local-file picker path stops failing silently.** This is a defect the pass found, not a new feature. Today `loadFromNewFile` (`syncStore.ts:1488-1513`) and `loadFromDroppedFile` (`:1517-1547`) return a bare `{ success: false }` with the reason discarded, so:
   - `SettingsPage.handleLoadFromFileConfirmed` (`SettingsPage.vue:522-537`) has no failure arm at all. The user picks a file and NOTHING happens.
   - `LoadPodView.handleLoadFile` (`LoadPodView.vue:519-539`) falls through to the generic `t('auth.fileLoadFailed')`.

   Fix with the field name and idiom that already exist: `OpenFileResult` (`syncService.ts:60-75`) and both store functions gain `payloadError?: RemoteBlocker`, set in the three catches of R2.3 when `isRemoteBlocker(e)`. `decryptPendingFile` already returns exactly this field (`syncStore.ts:1590-1600`) and both pages already render it (`SettingsPage.vue:561`, `LoadPodView.vue:244`), so each page gains the same `else if (result.payloadError)` arm it already has three lines away. No new pattern, no new component, no new copy beyond the one key.

8. `rebindPodFile` (`syncStore.ts:4779`) is fixed in the CLASSIFIER, not at the call site.
   - `PodAccessErrorCode` gains `'FILE_NEWER_VERSION'`, and `POD_ACCESS_ERRORS` gains its entry (`messageKey: 'podAccess.error.newerVersion'`, `recoveries: []`, `severity: 'warning'`). The registry is `as const satisfies Record<PodAccessErrorCode, PodAccessEntry>` (`src/utils/podAccess.ts:60-95`), so the type system forces the message, the recovery and the severity. `recoveries: []` is deliberate and has precedent (`NO_HOME`'s sibling `NO_UNCLAIMED_MEMBERS`): no button in the app can update the app.
   - `classifyDriveFailure` (`podAccess.ts:128-137`) gains one arm: a `PayloadLoadError` with `needsAppUpdate` returns the new code. Both catch sites that call it (`syncStore.ts:3948` and `:4779`) are healed at once, which a hand-rolled `isRemoteBlocker` arm at one of them would not do.
   - `rebindPodFile`'s report reads `severity: POD_ACCESS_SEVERITY[code]` instead of its hardcoded `'critical'` (`syncStore.ts:4783`). The table exists to answer exactly this question as data (`podAccess.ts:100-114`) and is already consulted that way at `syncStore.ts:4028`; a "please update beanies" must not page Slack.
9. `loadFromGoogleDrive` (`syncStore.ts:4385-4470`) sets `error.value = useTranslationStore().t(e.inlineMessageKey)` for an `isRemoteBlocker(e)` and returns it as `payloadError` on the result. Today the catch sets `error.value = (e as Error).message`, a raw English exception string that `LoadPodView.handleLoadFile` renders verbatim (`LoadPodView.vue:531`).
10. The join flow reuses its ONE mapper. `JOIN_ERRORS` gains `FILE_NEWER_VERSION` (`messageKey: 'join.error.newerVersion'`, `recoveries: []`, `severity: 'warning'`); `asJoinDecryptError`'s existing ternary (`useJoinFlow.ts:106`) gains the third arm:

    ```ts
    err.joinCode = payload.needsAppUpdate
      ? 'FILE_NEWER_VERSION'
      : payload.deviceCannotOpen
        ? 'FILE_TOO_LARGE'
        : 'FILE_CORRUPT';
    ```

    Extract that expression as `joinCodeForPayload(payload)` and call it from `doPickAndLoad` too (`useJoinFlow.ts:586-596`), which today flattens every load failure to `FILE_READ_FAILED` carrying a raw `syncStore.error`. One mapper, two call sites; do not write the second copy.

11. Every other site (`App.vue:830-834`, `useLoginFlow.ts:243/443`, `LoadPodView.vue:388-396`, `ResumePodSetup.vue:400`, the sync bar via `syncStore.ts:3539-3581`) already dispatches on `PayloadLoadError` or `RemoteBlocker` and inherits the copy with NO change, because R3.3 put the branch in the shared resolver. The new build therefore degrades legibly on the NEXT bump; the deployed build cannot, and the plan does not pretend otherwise.

### R4. A restore is a lineage event, so it sticks

1. Today, restoring the pre-compaction safety copy on device A (Settings, Load another Family Data File, `decryptPendingFile(password, { userChoseThisFile: true })` at `SettingsPage.vue:548`) adopts under `user-file`, leaving A on the old lineage. Every peer B still holding `{id, seq: 1}` reads `ours-newer` to `publish-local` and republishes the compacted pod over the restore within one poll (P6 F3). The rollback route the copy promises is undone by the fleet automatically.
2. **The stamp happens inside `mergeRemoteEnvelope`'s existing adopt branch. There is no new worker op, no new protocol message, no new `docClient` method and no new store call site.** The `user-file` adopt already runs at `applyAndProject.ts:940-1000`, the only place both documents exist, immediately after `guardLineage` has computed the verdict from `docLineage(remote)` and `docLineage(currentDoc)`. `localSeq` (R4's "the seq of the document this device held BEFORE the adopt") is therefore already in hand as a local const; it does not need to be recovered later by a second call.
   - Compose, then install, exactly as the branch already does: build the migrated document, apply the stamp to that value, and assign `currentDoc` ONCE. A throw leaves the old document installed by construction, which is the discipline the surrounding code already enforces and documents.
   - A separate `stampLineage` RPC would be strictly worse: the adopt branch calls `schedulePersist()`, `scheduleSnapshotPersist()` and `pushProjection` before it returns, so a save landing between the adopt and the stamp would publish the UNSTAMPED restored document, and the restore would silently fail to stick in exactly the way R4 exists to prevent.
3. **The condition is the guard's verdict, not a hand-rolled seq comparison.** Stamp when `guardLineage` answered `adopt` from an `ours-newer` verdict under `user-file`, and never otherwise. `compareLineage` already answers that question completely, including the `remote === null` case (`podLineage.ts`, `if (!remote) return 'ours-newer'`), so nothing re-derives "lower than". Two cases this correctly excludes:
   - `conflict` x `user-file` is also `adopt` in the POLICY table (the LineageBanner's "Use the family file"). Two devices compacted concurrently and a human picked one; adopting the chosen id is the resolution, and minting a third generation would be wrong.
   - `adopt-remote` x `user-file` is `rebase`, not `adopt`; choosing a NEWER file over a stale local document must mint nothing.
4. The publish needs no new plumbing. The adopt branch already returns `dirty: !headsEqual(remoteHeads, heads)`, and the stamp moves `heads` past the file's, so `dirty` is true; `replaceDocWithCacheRecovery` already does `if (merged.dirty) syncService.triggerDebouncedSave()` (`syncStore.ts:987`). The Drive baseline still commits `remoteHeads` (the bytes actually on Drive), which is the same shape the existing `migrateDoc` delta case already relies on.
5. Peers then read `adopt-remote` and adopt (clean) or rebase (dirty), the propagation the guard was built for. The restored file is written as 5.0 by R1, because it is now stamped, so stale builds stay refused.
6. **One minting helper.** `export function nextLineage(prev: PodLineage | null): PodLineage` in `src/services/automerge/worker/docOps.ts`, immediately beside `docLineage` (`:56-70`), which is already documented as "the ONE place absent-or-null is decided". It returns `{ id: generateUUID(), seq: (prev?.seq ?? 0) + 1 }`. Three callers and no fourth: `compactDoc` (`applyAndProject.ts:1226`, replacing its inline literal), the R4 restore stamp, and `beanpodProfile.spec.ts` (see Caveats).
7. Known limitation, stated in the plan and the code: a device with no prior document does not know the fleet's seq and cannot reach `user-file` (it reaches `no-local-document`, which installs wholesale BEFORE the guard is consulted, `applyAndProject.ts:840`), so it cannot perform a durable restore. A restore is done from a device that holds the family. If that ever needs to change, the restore flow pulls first to learn the seq; not in this plan. See the Caveats for the version consequence.

### R5. The pre-compaction backup pair is written as 5.0

1. The compaction flow builds one envelope for both the manual export and the Drive safety copy (`usePodCompaction.ts:232`, used again at `:252` and `:280`), from `buildExportEnvelope()`, BEFORE `compactDoc`. Under R1 that derives 4.0, and a stale build can open it: the deployed picker lists every `.beanpod` Drive-wide with no safety-copy filter, so a stale user reacting to "sync stopped" can pick the copy, be bound to it, and fork the family onto the backup (P6 F5).
2. `buildExportEnvelope({ atLeast: '5.0' })`, used ONLY by the compaction flow, forwards to `reEncryptEnvelope`'s `opts.atLeast` (R1.2). The derived version is RAISED to 5.0, never lowered. Every other export (Settings, Export) stays purely derived. A family that has compacted is a 5.0 family from that moment; a stale build cannot open its backup, a current build can, and the rollback route is unchanged.
3. The byte-compare of the safety copy (`usePodCompaction.ts:308-352`) is unaffected: it compares what came back against what went out.
4. **What the current build already does, so nobody re-implements it.** `findBeanpodInFolder` already excludes safety copies and is the auto-selecting join/recovery entry point (`src/services/google/driveService.ts:739-753`); `rebindPodFile` already refuses to bind one (`syncStore.ts:4694-4703`). `searchBeanpodFilesGlobal`, which feeds the HUMAN picker, deliberately still shows it, because that visibility is what makes it a rollback route a person can choose. R5 is therefore aimed at the DEPLOYED build's picker, which has none of these.

### R6. The soak gate becomes a notice; nobody is asked to enumerate devices

1. `evaluateSoak` (`src/services/pod/podSoak.ts`) stays as the ONE reading, with `lineageEpoch` as the machine test, and returns the array DIRECTLY: `evaluateSoak(members): OlderVersionMember[]` where an item is `{ name, appVersion }`. `SoakVerdict.ok` is deleted, not kept: it is defined as `behind.length === 0`, and both of its readers (`usePodCompaction`'s step 0 and step 2d gates) are the gates being removed, so keeping it would leave a field nothing reads. `appVersion` comes from the member row (`src/stores/familyStore.ts:505-512`, written with `lastLoginAt` on every login), so the words can name the build a person last used.
2. `refuseSoak` and the `not-soaked` / `not-soaked.named` refusal codes are DELETED from `usePodCompaction` (`:104-126`, and `'not-soaked'` from the `RefusalCode` union at `:52`). Steps 0 and 2d of the ladder lose their soak gate entirely; the reading becomes display only.
3. **One reading, one formatter, three consumers.** `usePodHealth` is already the single reactive reading (`waitingOn`, `usePodHealth.ts:72`) and `usePodCompaction` already calls `usePodHealth()` (`usePodCompaction.ts:76`). So:
   - `usePodHealth` exposes `olderVersion` (the items) and `olderVersionNames` (a computed string: each item through `fillTemplate(t('compaction.olderVersion.item'), { name, version })`, joined by `formatNames`). `waitingOn` is renamed to `olderVersion`.
   - `usePodCompaction` reads `olderVersionNames` from that same composable for both the confirm and the toast, and DELETES its own `soak()` helper and its `evaluateSoak` / `formatNames` / `SoakVerdict` imports (`usePodCompaction.ts:29`, `:128-138`). A Vue `computed` re-evaluates on read, so the post-pull reading at the toast is still the current projection, which is what step 2d's comment was protecting.
   - `formatNames` stays the ONE joiner (`podSoak.ts`), rendered at `SettingsPage.vue:2050`; `SettingsPage` drops its direct `formatNames` and `fillTemplate` use for this slab and renders `olderVersionNames`.
4. The Settings section shows, when `olderVersion` is non-empty, a standing notice naming who last used an older version, and always, once, the rule that beanies can only see the version each person used most recently. The bring-your-devices-online caution (`compaction.bringDevicesOnline`) remains as the `v-else`, unchanged, for the rebase case. The one-slab-never-two structure at `SettingsPage.vue:2038-2055` is kept as it is.
5. The confirm dialog appends the same names when `olderVersion` is non-empty, so the person is told who at the moment they decide.
6. The completion toast names them again; `compaction.doneButBehind` (whose "so their changes come across safely" is no longer true under 5.0) is replaced.
7. Copy (en; beanie and zh through the usual pipeline), lifted from P6 sections 3 and 4:
   - `compaction.olderVersion.item`: `{name} ({version})`
   - `compaction.olderVersion.notice`: `{list} last opened beanies on an older version. Once you compact, a device that is still on an older version shows a message and stops syncing until it updates, and anything added on it before then is not kept. Ask them to update beanies first if you can. Nothing else changes for anyone.`
   - `compaction.olderVersion.rule`: `beanies can only see the version each person used most recently, not every device they own. Any device that has not updated will say so when it next opens, and will sync again once it does.`
   - `compaction.doneOlderVersion`: `Done. {list} last opened beanies on an older version; that device will show a message and sync again once it updates.`
   - `compaction.confirmMessage` (replaces the current text at `uiStrings.ts:4326-4330`): `beanies will rebuild your family file without its record of past changes, so it opens faster and works on older tablets. Nothing on this device is lost, and beanies keeps a copy of the current file first. Your other devices pick up the compacted file on their own, and beanies carries across anything they changed while offline. A device still on an older version of beanies shows a message and stops syncing until it updates; anything added on it before then is not kept.`
   - `podNewerVersion.inline`, `resumeSetup.podNewerVersion`, `podAccess.error.newerVersion` and `join.error.newerVersion` all say the same thing in their own register: `This family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.`
   - Deleted: `compaction.waitingOn` (`uiStrings.ts:4374`), `compaction.refused.not-soaked` (`:4379`), `compaction.refused.not-soaked.named` (`:4386`), `compaction.doneButBehind` (`:4408`).
   - The rebase conflict sentence ("If the same thing was changed in two places, the version already saved here is the one kept") moves out of `compaction.confirmMessage` and into the "?" popover, which already has `compaction.why.record` / `.settled` / `.older` (`uiStrings.ts:4292-4306`); it becomes a fourth `compaction.why.*` key rather than a new mechanism.

### R7. Documents

1. ADR-036 addendum (or ADR-037, whichever the implementer judges cleaner): "a compacted document is a 5.0 file, and the version is derived from the document's lineage at write time". States why envelope-carried was rejected (Trap 1, with `envelopeMerge.ts:73` as the evidence) and why the safety copy is 5.0.
2. `docs/STATUS.md`: Tier 3 entry updated; the "OWED before the flag can be flipped" list rewritten around the sequence below; the per-member limitation stated as a property of the notice, not a gate.
3. `docs/lessons.md`: one entry, "a spread carries the field you forgot to think about", from Trap 1.
4. `src/config/flagRegistry.ts` comment: the gate is the fleet drain and the 5.0 refusal, not the stages.
5. `docs/plans/2026-09-06-pod-compaction-tier3.md`: a SUPERSEDED-IN-PART banner pointing here for Stage 4's gate.

## Important Notes & Caveats

- **What the bump does not do.** It does not stop a stale device from overwriting the pod; it stops it from merging into it. The overwrite is loud, reverted by the fleet, and recoverable from the safety copy. The plan's copy says so and never claims more.
- **The person on the stale build gets no message.** The deployed poll swallows the parse error and shows stale data under "Could not refresh". There is no channel into a deployed build (release notes are bundled, no email sender). The family tells them. Do not add a mechanism that pretends to reach them.
- **The stub probe on the deployed build cannot be fixed.** R2.5 fixes the current build's copy so the NEXT stale build does not carry it. The deployed hazard needs the owner's account, a stale build, and a deliberate create with a colliding name; the mitigation is the drain, the safety copy, and Drive revision history.
- **A restore performed from a device with no local document silently returns the family to 4.0.** That path reaches `no-local-document`, which installs wholesale BEFORE the guard runs (`applyAndProject.ts:840`), so no verdict is computed and R4's stamp never fires. The adopted document carries the backup's old lineage, and R1 then derives 4.0 on the next save. This is R4.7's limitation with its version consequence made explicit: the supported restore is Settings, Load another Family Data File, on a device that already holds the family. Do NOT "fix" it by deriving the version from the envelope; that is Trap 1 again.
- **Two compactions in a row stay 5.0** (P6 F9). The version says "compacted", the lineage seq says which generation. Do not introduce 6.0 for a second compaction. R1.2's `atLeast` is a floor for the same reason: a second compaction's backup must not fall back to 4.0.
- **Two owners compacting concurrently** resolve to `conflict`, still reachable and still handled (P6 F8). Unchanged, and R4.3 deliberately mints nothing when a human resolves one.
- **Do not put the version rule in `preserveLocalKeyDicts`.** A local-wins or max rule there is wrong on the adopt/rebase branches and wrong again for the rollback (P5 Trap 1, option 2). The version is derived, full stop. `preserveLocalKeyDicts` keeps its `{ ...incoming }` spread (`envelopeMerge.ts:73`) and the test in step 1 pins that it still carries `incoming.version`, so it is the DERIVATION, not the spread, that protects.
- **Force-update on native is a follow-up, not this plan.** Under 5.0 a stale device is safe, only cut off; the drain affects how many people the notice names, not safety. Android has Play In-App Updates (immediate mode); iOS has no store mechanism and needs a self-built minimum-version screen. Both are from knowledge, not re-verified against current docs (P4 was stopped for budget). File separately.
- **`beanpodProfile.spec.ts:257-265`** (env-gated diagnostic) builds a compacted copy with `Automerge.from(plain)` and writes it with `reEncryptEnvelope(envelope, payload)`. It stamps NO lineage, so under R1 it would produce the forbidden artefact (a compacted 4.0). Fix it the way `compactDoc` does: spread `nextLineage(null)` into `plain` before `Automerge.from`, and pass that lineage to `reEncryptEnvelope`. Same helper, same shape, one more caller.
- **Do not deploy** as part of this work. The flag stays off. The sequence below is greg's to run.

## Assumptions

> **Review these before implementation.**

1. `compareLineage` treats a higher `seq` as newer regardless of `id` (`podLineage.test.ts`: `L('a', 2)` vs `L('b', 1)` gives `adopt-remote`). R4 depends on it. Re-read in Pass 2 at `src/services/sync/podLineage.ts`; the function also answers `ours-newer` for `remote === null`, which is the first-compaction restore case.
2. `docLineage()` normalises an absent `podLineage` to `null`, so a deployed build's document (no lineage concept) compares as the oldest generation. Verified by P6 F11 at the current build and re-read at `docOps.ts:68-70`.
3. The IndexedDB envelope cache may say 4.0 for a compacted document after a failed publish; nothing reads the cached version (P5 Q4), and the next write derives it. Acceptable.
4. `app_version` / `build_sha` are available in the telemetry firehose so a login-by-build query per family exists. NOT verified (P4 stopped); the implementer checks `ALLOWED_CONTEXT_KEYS` and `enrichAndRedact`, and if absent, adds nothing here (a new context key triggers the store-declaration rule) and the drain is watched via the member rows' `appVersion` in Settings instead.
5. The deployed picker path that binds a stale device to the safety copy is closed by R5; `CANONICAL_MISMATCH` (`c3a6be98:syncStore.ts:3098`) remains the detector for any fork that predates this change.
6. `OpenFileResult`'s `rawText` has no reader in `src/` (Pass 2 grep: written at `syncService.ts:2084`, `:2133`, `:2176`, read nowhere). If a consumer appears outside `src/`, keep the field and set it in the catch instead of deleting it; nothing else in R2.3 changes.

## Approach

The centre of the change is R1: one function, `reEncryptEnvelope`, gains one required argument, and the version becomes a fact about the payload rather than a field that rides along. Everything else either widens a reader and deletes its duplicates (R2), adds one member to a base class so the six existing dispatch sites answer correctly without being touched (R3), makes the restore mint a generation inside the branch that already adopts (R4), raises the backup pair (R5), or deletes a gate and replaces it with words (R6).

The pass-2 shape of that is smaller than the pass-1 shape in four places, and each reduction is a place where the code already had the mechanism: the error class routes through `payloadErrorMessageKey` rather than overriding a getter; the restore stamps inside `mergeRemoteEnvelope` rather than through a new RPC; the three picker readers collapse into `parseBeanpodV4` rather than each learning a new version set; and the notice renders from `usePodHealth`'s existing single reading rather than from a second one in `usePodCompaction`.

Order of implementation, each step green before the next:

1. R2.1 type and known-set; R1 worker return, `reEncryptEnvelope` signature (lineage required, `atLeast` floor), both writers; `beanpodProfile.spec.ts` with `nextLineage`. Tests: `fileSync.test.ts` 5.0 accepted, 6.0 typed; a real-`reEncryptEnvelope` save-path test asserting the `kept-local` republish carries 5.0 (the Trap 1 pin); `envelopeMerge.test.ts` asserting `preserveLocalKeyDicts` still copies `incoming.version` (so the derivation, not the spread, is what protects); an `atLeast` test proving it raises 4.0 and cannot lower 5.0.
2. R3.1 to R3.6: the `needsAppUpdate` member, the error class, the `payloadErrorMessageKey` arm, the two `payloadFailureSurface` arms. Tests: a 6.0 file lands on `podNewerVersion` at BOTH `payloadErrorMessageKey(e)` and `e.inlineMessageKey` (the divergence pin); `reportPayloadFailure` emits nothing for it; `surfacePayloadFatal` uses the new overlay key; a `parse` `CorruptPayloadError` still pages, so the torn-read signal is not lost; `noteRemoteUnreadable` reports it at `warning` with `error_code: 'parse'` and does not latch (existing behaviour, pinned not written); no `clearCache` RPC; `doSave` refuses.
3. R2.3, R2.5, R2.6, R3.7: collapse the three picker readers, make the stub probe structural, delete `detectFileVersion`, carry `payloadError` out to both pages. Tests: `connectStorage.test.ts`, a `5.0` file resolves `adopt-existing` and a `6.0` file resolves `adopt-existing`; a picker load of a 6.0 file surfaces `podNewerVersion` copy in `SettingsPage` (where today it surfaces NOTHING) and in `LoadPodView`.
4. R3.8 to R3.10: the `podAccess` code plus classifier arm plus `POD_ACCESS_SEVERITY[code]` in the rebind report; the join mapper and its second call site. Tests: `podAccess.test.ts` classifies the typed error; a rebind onto a 6.0 file returns the new code and does not page; `useJoinFlow` maps both the decrypt and the pick-and-load path to `FILE_NEWER_VERSION`.
5. R4: `nextLineage` in `docOps.ts`, the stamp inside `mergeRemoteEnvelope`'s adopt branch, `compactDoc` switched to the helper. Tests: "restore on A, poll on B, B adopts rather than republishes"; "choosing the live compacted file over a stale local document mints nothing"; "the LineageBanner's conflict adopt mints nothing"; "the stamped adopt returns `dirty: true`, so the caller publishes".
6. R5: `buildExportEnvelope({ atLeast })`. Test: the safety copy `aux.write` body and the manual export carry `"version":"5.0"` while the family's ordinary Settings export before compaction carries 4.0.
7. R6: gate deletion, `evaluateSoak` shape, `usePodHealth.olderVersion` + `olderVersionNames`, Settings, confirm, toast, strings; delete the four keys; `npm run translate`. Tests: the ladder never refuses on soak; the notice names people with versions; the confirm appends names; the toast names them; `usePodCompaction` no longer imports `evaluateSoak`.
8. R7 documents; Help Center article; CHANGELOG.
9. Full gate; commit; push. No deploy.

DRY audit, each entry naming the ONE thing and where it lives:

- One lineage mint: `nextLineage` in `worker/docOps.ts`, beside `docLineage`, used by `compactDoc`, the restore stamp and the diagnostic.
- One version derivation: `reEncryptEnvelope`'s lineage-to-version rule, reached by both writers; `createBeanpodV4`'s literal is the deliberate third case (a brand-new family).
- One known-version set with ONE reader: `parseBeanpodV4`. `detectFileVersion` and the three duplicated picker branches are deleted rather than taught the set.
- One "newer than I understand" question: `PayloadLoadError.needsAppUpdate`, answered by the class and read by `payloadErrorMessageKey`, `reportPayloadFailure`, `surfacePayloadFatal`, `classifyDriveFailure` and `joinCodeForPayload`. No `instanceof UnsupportedBeanpodVersionError` anywhere outside the class itself.
- One inline-copy resolver: `payloadErrorMessageKey`, which `PayloadLoadError.inlineMessageKey` already delegates to. No subclass overrides it.
- One picker-failure carry: `payloadError` on the result, the field `decryptPendingFile` already returns and both pages already render.
- One pod-access taxonomy: `POD_ACCESS_ERRORS` plus `POD_ACCESS_SEVERITY`, extended by one row rather than by an arm at a call site.
- One join mapper: `joinCodeForPayload`, called by `asJoinDecryptError` and `doPickAndLoad`.
- One soak reading: `evaluateSoak`, surfaced once through `usePodHealth`, consumed by the notice, the confirm and the toast.
- One name joiner: `formatNames`.
- One user-file adopt: `mergeRemoteEnvelope`'s `installWholesale` branch, which now also stamps.

Nothing new is added where an existing pattern already has the right shape, and three things pass 1 proposed to add (a worker op, a protocol case, a getter override) are not added at all.

Error handling: every failure path already exists and is classified; this plan changes classifications and closes two places where a classification was DROPPED (`loadFromNewFile`'s bare `{success:false}`, `loadFromGoogleDrive`'s raw English `error.value`). It adds no bare catches. The one new throw (R3.4) is typed at the source so no caller has to classify it, and the three catches in R2.3 that used to synthesise an "Unsupported file version" string now re-surface the typed error instead of inventing a second vocabulary for it. `nextLineage` is pure. The restore stamp runs inside the worker's existing single-assignment discipline (compose fully, then install), so a throw leaves the document untouched.

## Files Affected

- `src/types/syncFileV4.ts` (BeanpodVersion)
- `src/types/sync.ts` (`needsAppUpdate` on `PayloadLoadError`, `UnsupportedBeanpodVersionError`, `PodBlockMessageKey`, the `payloadErrorMessageKey` arm)
- `src/services/sync/fileSync.ts` (known set, parse throw, `reEncryptEnvelope` signature; `detectFileVersion` DELETED)
- `src/services/sync/connectStorage.ts` (`isStubBeanpod` structural; `detectFileVersion` import removed)
- `src/services/sync/syncService.ts` (`doSave`, the three picker readers collapsed, `OpenFileResult.payloadError`, `rawText` removed, `fetchAndMergeRemote` wrap)
- `src/stores/syncStore.ts` (`buildExportEnvelope` + `atLeast`, `loadFromNewFile` / `loadFromDroppedFile` carry `payloadError`, `loadFromGoogleDrive` translated error + `payloadError`, `rebindPodFile` severity from the table)
- `src/utils/podAccess.ts` (`FILE_NEWER_VERSION` code, registry entry, severity entry, `classifyDriveFailure` arm)
- `src/services/automerge/worker/docOps.ts` (`nextLineage`)
- `src/services/automerge/worker/applyAndProject.ts` (`exportEncryptedPayload` returns the lineage; `compactDoc` uses `nextLineage`; the `user-file` `ours-newer` stamp inside the adopt branch)
- `src/services/automerge/worker/docClient.ts` (return type of `exportEncryptedPayload` only)
- `src/utils/payloadFailureSurface.ts` (`reportPayloadFailure` early return, `surfacePayloadFatal` overlay arm)
- `src/composables/useJoinFlow.ts` (`FILE_NEWER_VERSION` entry, `joinCodeForPayload`, its second call site in `doPickAndLoad`)
- `src/composables/usePodCompaction.ts` (delete `refuseSoak`, the `not-soaked` code and the local `soak()`; read the names from `usePodHealth`; `atLeast` on the backup build; note update)
- `src/composables/usePodHealth.ts` (`olderVersion`, `olderVersionNames`)
- `src/services/pod/podSoak.ts` (`evaluateSoak` returns the item array; `SoakVerdict.ok` deleted)
- `src/pages/SettingsPage.vue` (notice and rule; the missing failure arm on `handleLoadFromFileConfirmed`)
- `src/components/login/LoadPodView.vue` (the `payloadError` arm in `handleLoadFile`)
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via the pipeline)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`
- NOT changed, and deliberately: `src/services/automerge/worker/protocol.ts` (no new op crosses the boundary), `src/services/sync/envelopeMerge.ts` (the spread stays; the derivation is what protects), `src/components/common/LineageBanner.vue`, `src/composables/useLoginFlow.ts`, `src/pages/LoginPage.vue`, `src/components/login/ResumePodSetup.vue`, `src/composables/useBiometricSignIn.ts` (all inherit the copy through `payloadErrorMessageKey`)
- Tests: `fileSync.test.ts`, `connectStorage.test.ts`, `envelopeMerge.test.ts`, `fetchAndMergeRemote.test.ts`, `podAccess.test.ts`, a new save-path version test, `rebase.test.ts` or a new `restoreStamp.test.ts`, `usePodCompaction.test.ts` (its `usePodHealth` mock at `:33-35` must now also return `olderVersion` / `olderVersionNames`), `usePodHealth.dueSignal.test.ts`, `podSoak.test.ts`, `useJoinFlow` tests, `LoadPodView.test.ts`; delete the dead `detectFileVersion` mocks P5 Q9 lists along with the function
- `docs/adr/036-...md` (addendum) or `docs/adr/037-...md`, `docs/STATUS.md`, `docs/lessons.md`, `src/config/flagRegistry.ts`, `docs/plans/2026-09-06-pod-compaction-tier3.md` (banner), `CHANGELOG.md`

## Help Center Coverage

- **Action**: new article
- **Category**: how-it-works
- **Article type**: troubleshooting
- **Slug**: `family-file-newer-version`
- **Title**: beanies says my family file was saved by a newer version
- **Scope**: What the message means (someone in the family updated and compacted the file), that nothing on the device is lost, and that updating beanies on this device is the only step. One paragraph on why a device that has not updated stops syncing rather than risking the family's data.
- **Notes**: Must not suggest deleting data, re-entering a password, or picking a different file. Ships in the same change; the message it explains is user-facing the moment 5.0 files exist. The same sentence appears in four registers (sync bar, boot overlay, pod-access, join), so the article is written once and the four keys agree with it.

## Observability Coverage

- **Events**
  - `pod-lineage` / `logMergeTerminus` already emits `action: 'kept-local'` at both termini. A repeated `kept-local` on one `family_id` is the signature of a stale device fighting the fleet. No new event; the plan adds a CloudWatch query note to the runbook.
  - `pod-load-failure` for the new error is ALREADY correct and needs no code: `PayloadLoadError.latches` is already `false` for `step === 'parse'` (`src/types/sync.ts`), and `noteRemoteUnreadable` already reports every non-latching blocker at `severity: 'warning'` with `error_code: err.step`, with a comment that already names "a pod from a newer build" (`syncService.ts:120-143`). The work here is a TEST that pins it, not a change. The file's version string rides in `detail` (already allowlisted), never in `message`, so the buckets stay constant.
  - `pod-compaction` `published` (existing) gains `detail: version=5.0` so the rate of 5.0 publishes is countable.
  - No new context key. If assumption 4 fails, no key is added in this plan.
- **Failure modes covered**: a compacted pod written as 4.0 (impossible by construction under R1, and pinned by the save-path test); a stale overwrite (the `kept-local` count); a device refusing a 5.0 or 6.0 file (`parse` at warning, non-latching, with the version in `detail`); a restore that did not stick (peers would log `kept-local` instead of `adopted`; the R4 test pins the opposite); a picker load that fails with no message (now impossible: the three catches carry `payloadError` and both pages render it).
- **Success-path signal**: `published` with `version=5.0`; `adopted` at both termini after a restore.
- **Critical vs telemetry**: nothing about a newer version pages. Three sites are made to agree on that through ONE member: `reportPayloadFailure` returns early on `needsAppUpdate`; `rebindPodFile` reads `POD_ACCESS_SEVERITY['FILE_NEWER_VERSION'] === 'warning'` instead of its hardcoded `critical`; `JOIN_ERRORS.FILE_NEWER_VERSION` is `severity: 'warning'`, not the `critical` that `FILE_CORRUPT` carries. A genuine torn-read `parse` failure still pages, because it is still an incident.
- **Privacy**: no document content, no names, no filenames in any event. The version string is a two-character constant.

## Acceptance Criteria

- [ ] A never-compacted family writes a byte-identical 4.0 envelope before and after this change (fixture test).
- [ ] The compaction publish writes 5.0; the `kept-local` republish writes 5.0; the safety copy and the compaction export write 5.0; the ordinary Settings export of a never-compacted family writes 4.0; `atLeast` raises 4.0 to 5.0 and cannot lower a derived 5.0.
- [ ] `parseBeanpodV4` accepts 5.0 and throws `UnsupportedBeanpodVersionError` (`instanceof PayloadLoadError`, not `CorruptPayloadError`, `latches === false`, `keyMayBeWrong === false`, `needsAppUpdate === true`) for 6.0.
- [ ] `payloadErrorMessageKey(err)` and `err.inlineMessageKey` return the SAME key for the new class (the divergence pin), and no subclass overrides `inlineMessageKey`.
- [ ] Every surfacing site shows `podNewerVersion` copy for a 6.0 file; no site wipes the cache or re-prompts for a password (asserted, not inferred, at the six sites P5 Trap 4 lists).
- [ ] Picking a 6.0 file from Settings shows a message; today it shows nothing at all. The same file in `LoadPodView` shows the same message rather than `auth.fileLoadFailed`.
- [ ] Nothing about a newer version pages Slack: `reportPayloadFailure` is silent for it, the rebind report is `warning`, and the join code is `warning`. A `parse` `CorruptPayloadError` still pages.
- [ ] `detectFileVersion` no longer exists, and no production file imports it.
- [ ] `isStubBeanpod` is false for any JSON object with a string `version`; a 5.0 file at a colliding name resolves `adopt-existing`.
- [ ] Restore on A, poll on B: B adopts. Choosing the live file over a stale local document mints no generation, and the LineageBanner's conflict adopt mints no generation. No new worker RPC was added.
- [ ] The ladder has no soak refusal; the notice, confirm and toast name people with the version they last used, all three from `usePodHealth`; the four deleted keys are gone from `uiStrings.ts` and `zh.json`.
- [ ] No string asks anyone to open beanies on every device.
- [ ] `beanpodProfile.spec.ts` stamps through `nextLineage` and passes the lineage.
- [ ] Help Center article added and matches the shipped copy in all four registers.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key.
- [ ] Documents in R7 updated; CHANGELOG entry.
- [ ] Full gate green (vue-tsc, eslint, stylelint, vitest); every new test mutation-checked against the specific regression it pins.

## Testing Plan

1. Unit, as listed under Approach, each mutation-checked. The four that matter most, and the mutation each must fail on:
   - Trap 1 pin: must fail when `reEncryptEnvelope` reads `envelope.version` instead of the lineage.
   - Divergence pin: must fail when `payloadErrorMessageKey`'s arm is moved into a subclass `inlineMessageKey` override.
   - R4 pin: must fail when the stamp is skipped, and must ALSO fail when the stamp is applied unconditionally on every `user-file` adopt (the conflict case).
   - Stub-probe pin: must fail when the `!== '4.0'` returns.
2. Local two-browser soak on `npm run dev` (flag on in dev by default): compact on A; B (offline with an edit) reconnects and rebases; reload A and confirm B's edit arrived (the publish-restore pin from `e395b1d4`); confirm the notice names B's member with a version before compacting.
3. Restore drill: restore the safety copy on A through Settings, Load another Family Data File; confirm B ADOPTS rather than reverting (watch B's console for `open terminus adopted`, not `kept-local`); confirm the restored family then compacts again cleanly and stays 5.0.
4. Newer-version drill on the CURRENT build, which is the half CI cannot fake convincingly on its own: hand-edit a `.beanpod` to `"version":"6.0"` and walk it through all four surfaces (Settings picker, `LoadPodView` picker, a Drive rebind, a join link). Each must show the update message, none may clear data or re-prompt for a password, and CloudWatch must show a `warning` and no page.
5. The deploy-and-enable sequence, greg's to run, from P6 section 7:
   1. Land this plan, flag OFF. Every pod on Earth is still 4.0.
   2. Deploy web and native. Nothing user-visible changes.
   3. Watch the drain (login-by-build query if assumption 4 holds, else the member rows' `appVersion` in Settings on greg's family). There is no safety threshold to wait for under 5.0; the drain decides how many people the notice will name.
   4. On-device acceptance on greg's family BEFORE enabling for anyone else: the Tab A9+/A7 on the new build adopts and opens in the measured ~50MB; a device pinned to `c3a6be98` (the old open-testing APK, or a browser profile with the service worker disabled) shows stale data under "Could not refresh", an edit plus save overwrites the pod as 4.0, a current device republishes it as 5.0, and the stale device is refused again; a restore from a third device is ADOPTED by the fleet. Nothing in CI can exercise a pinned old build against a live Drive file; this run is the acceptance criterion for the mechanism itself.
   5. Enable `podCompaction` for greg's family via the existing override, then generally.
6. Later, optional: once the stale population reads ~0 for a release cycle, consider writing 5.0 for every family and closing the deployed stub-probe hazard for good.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the premise audit; R1 document-derived version as the centre; R2 to R7 as the audit's four required changes plus the error class, the copy, and the documents.
- **Pass 2 (DRY + error handling)**: verified every reuse claim in the tree. Removed three additions the code already had a place for (a worker op for the restore stamp, a subclass `inlineMessageKey` override, a widened `detectFileVersion`), collapsed the three duplicated picker readers and deleted `detectFileVersion` and the unread `rawText` with them, routed the new "newer than I understand" question through ONE base-class member read by five dispatchers, moved the rebind arm into `classifyDriveFailure` and the structured `POD_ACCESS_ERRORS` registry, gave the join flow one mapper instead of two, collapsed `SoakVerdict` to its array and rendered the notice from `usePodHealth`'s existing single reading, and closed a genuine silent failure the plan had not covered: a picked file with an unreadable version shows the user NOTHING in Settings today.
- **Pass 3 (Sustainability)**: _pending_
- **Pass 4 (Fresh-eyes sweep)**: _pending_

## Prompt Log

<details>
<summary>Full prompt history (this topic, 2026-09-06)</summary>

### Initial prompt (the objection that started this)

> Ok - first of all, i just want to ensure i am understanding the limitation correctly: [...] i'm not seeing how it is a reasonable request to ask a user to find every device where beanies was ever opened. let me know if i misunderstood something or if my understanding is not correct.

### Follow-up 1

> It sounds like the right thing to do to increment the version number on a compacted data file, but just to correct one thing you said, the browser and PWA _will_ auto-update [...] the apps (ios/android) on the other hand i believe need to be updated by hand, although i believe there is a way i can force users to update via the respective app stores [...] given that, does that logic + the updated version on the beanpod eliminate the risk of the compacted file being reverted back, or of users losing data? what are your thoughts

### Follow-up 2

> let's plan and implement this change, but before we do that, note that i've done some work in another session to make updates to the beanie wall [...] should we pull those updates now and rebase so the repos are in sync? also would yo usuggest i give this whole discussion we've just had one more review pass with the fable model to confirm the approach and prepare the plan?

### Follow-up 3

> Let's perform the premise audit above as has been recommended with the fable model to ensure that everything we have proposed is fully valid and complete and is the best and more efficient approach that is the smoothest for users, does not require them to locate all their previous devices, and allows older version to fail as expected, and updates can be forced on all surfaces as needed, and anything else. note that if we are getting close to running out of tokens on this cycle then stop and let me know to change models. always save all work, especially in background agents, to a file [...]

### Follow-up 4

> note that i'm at 80% of usage limit for fable model now. please ensure parallel sessions and additional spawn are limited to what is absolutely needed

### Follow-up 5

> go ahead to start /beanies-plan. usage is now at 85%. agree with yout proposal to run the subagents on opus 5 and keep context in files.

### Pass 2 review prompt

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code. [...] Check existing helpers, functions, composables, etc or other code where a solution already exists [...] Ensure that there are never any silent failures. [...] Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

</details>
