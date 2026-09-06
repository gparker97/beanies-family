# Plan: Compacted pods are beanpod 5.0, and the soak gate becomes a notice

> Date: 2026-09-06
> Related issues: None (direct implementation; tracker #90 Tier 3 follow-up)
> Plan file: `docs/plans/2026-09-06-compacted-pod-v5.md`
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md` (P1, P5, P6 complete; P2/P3 and P4 checked directly). Every file:line below was pinned by the audit at `33dbef34` (current) or `c3a6be98` (deployed).
> Supersedes: the soak gate half of `docs/plans/2026-09-06-pod-compaction-tier3.md` (Stage 4, R3/R4). Stages 1 to 3 are unchanged.

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family owner, I want to compact our family file without having to find every device anyone in the family has ever opened beanies on, so that the file opens on an old tablet and nobody's data is silently damaged by a device that has not updated yet.

## Context

Compaction rewrites the family document without its history. A compacted document shares no ancestry with the original, so a device on a build that predates the lineage guard (production is `c3a6be98`, 0.16, which has no lineage concept) CRDT-merges the two, deterministically destroys the compactor's edits, and carries the new lineage id forward so that every guarded device then reads the corruption as clean (ADR-036).

Stage 4's defence was a soak gate: refuse to compact until every recently active member has logged in on a guard-honouring build. The gate is per member (`lineageEpoch` on the member row) and cannot see a person's other devices, so its instruction, "open beanies once on every device you use it on", is unverifiable and, per greg, an impossible ask for a normal family. Once Sam logs in once on a current build, Sam passes forever, and Sam's old tablet is still a hazard the gate cannot see.

The audit established a structural replacement. The deployed build's `parseBeanpodV4` (`c3a6be98:src/services/sync/fileSync.ts:73-74`) throws on any envelope `version` other than `'4.0'`, before decrypt, before the worker, and before adopting the remote marker or key dicts; and every Automerge merge entry point in the deployed build sits behind it (P1). So a compacted pod written as **version 5.0** cannot be merged by a pre-guard build. No read-path failure wipes the cache, deletes a credential, or loops on a password prompt (P1, P6 §2). The catastrophic case is gone by construction.

What a stale build can still do is **overwrite** the compacted pod, by two mechanisms (P1 F2, F1): any save on a warm-cache stale device (the baseline skip, not the swallowed throw), and the owner creating a same-named family on a stale build (the deployed stub probe reads a 5.0 file as an empty placeholder). Both are loud, both are bounded by the fleet's `ours-newer → publish-local` self-heal (`src/services/sync/podLineage.ts:176`), and both cost the same: whatever the stale device wrote, plus the wrapped key of any member who joined after that device last synced, until the republish lands. The bump therefore does not replace draining the fleet; it changes what a straggler can do from "silently corrupt everyone" to "loudly revert until the fleet pushes back". The deploy sequence stays the primary control, and the soak gate stops pretending to be one.

The audit also found that the obvious implementation is wrong. Stamping `'5.0'` on the envelope at compaction and letting the spread carry it lasts exactly one round trip: the four `kept-local` termini adopt the REMOTE envelope (including its version) and republish the LOCAL compacted document under it (P5 Trap 1, P6 F1, found independently). The version must describe the payload, and the payload's lineage lives in the document. That is the design centre of this plan.

## Requirements

### R1. The envelope version is derived from the document, never carried by spread

1. `exportEncryptedPayload` (`src/services/automerge/worker/applyAndProject.ts:1039-1044`, client `docClient.ts:1317`) returns `lineage: docLineage(doc)` alongside `{ payload, heads }`.
2. `reEncryptEnvelope(envelope, encryptedPayload, lineage)` (`src/services/sync/fileSync.ts:214`) stamps `version: lineage ? '5.0' : '4.0'`. The parameter is required, not optional, so a new writer cannot forget it.
3. Both writers pass it: `doSave` (`src/services/sync/syncService.ts:1801-1802`) and `buildExportEnvelope` (`src/stores/syncStore.ts:2831-2834`).
4. `usePodCompaction` gains NO envelope stamp. Its "NO ENVELOPE STAMP" note (`usePodCompaction.ts:381-386`) is now true for a stronger reason and is updated to say so.
5. Consequences that follow for free and must be tested rather than assumed: the compaction publish writes 5.0 because the document is compacted; the failed-publish self-repair (`ours-newer → publish-local`) republishes as 5.0 for the same reason; a `kept-local` after a stale overwrite republishes as 5.0; a never-compacted family writes 4.0 byte-for-byte as today.

### R2. Every reader accepts 4.0 and 5.0, from one definition

1. `export type BeanpodVersion = '4.0' | '5.0'` in `src/types/syncFileV4.ts`; `BeanpodFileV4.version: BeanpodVersion` (`:56`). `BeanpodFileV4` is NOT renamed (the V4 names the key model, which does not change; 30+ importers).
2. `KNOWN_BEANPOD_VERSIONS: ReadonlySet<BeanpodVersion>` in `fileSync.ts`, used by `parseBeanpodV4` (`:73-75`), `detectFileVersion` (`:97-105`, return type `BeanpodVersion | null`) and `isStubBeanpod` (`src/services/sync/connectStorage.ts:245-251`) so the three cannot drift.
3. The five literal comparisons become "is a known version": `connectStorage.ts:250`, `syncService.ts:2067`, `:2119`, `:2159`, and the `detectFileVersion !== '4.0'` in the stub probe.
4. `createBeanpodV4` keeps its literal `'4.0'` (`fileSync.ts:40`): a new family is a 4.0 family until it compacts.
5. `isStubBeanpod` returns `true` only for empty, whitespace, or `{}`. A JSON object with a string `version` field is never a stub, whatever the version; `resolveExistingBeanpod` then falls to `adopt-existing`, which is confirm-gated. Its own comment (`connectStorage.ts:220-221`) already says failures fall safe to `adopt-existing`; the code now does.

### R3. A version newer than this build understands is one typed, non-destructive error, thrown at the source

1. `export class UnsupportedBeanpodVersionError extends PayloadLoadError` in `src/types/sync.ts` (which has no imports, so no cycle): `step = 'parse'`, literal `name`, `readonly fileVersion: string`, `override get inlineMessageKey()` returning `'podNewerVersion.inline'` (added to `PodBlockMessageKey`, `:183-190`). Inherited: `latches: false`, `keyMayBeWrong: false`, `deviceCannotOpen: false`. It is NEVER a subclass of `CorruptPayloadError` (which the worker's cache self-heal deletes the cache on).
2. `parseBeanpodV4` throws it when `version` is a string not in the known set. A missing or non-string `version` stays the plain "invalid file" `Error`.
3. `fetchAndMergeRemote`'s wrap (`syncService.ts:1541-1548`) becomes `e instanceof PayloadLoadError ? e : new CorruptPayloadError(...)`, the idiom `payloadFailure` already uses (`docOps.ts:358`), so it does not relabel.
4. `surfacePayloadFatal` (`src/utils/payloadFailureSurface.ts:121-125`) gains a `parse` arm pointing at a new `resumeSetup.podNewerVersion` key instead of landing on "your data may be damaged".
5. `rebindPodFile` (`syncStore.ts:4779`) gains an `isRemoteBlocker` arm before `classifyDriveFailure`; `loadFromGoogleDrive` (`:4458-4468`) sets `error.value = t(e.inlineMessageKey)` for a `RemoteBlocker`; `useJoinFlow` gains a `FILE_NEWER_VERSION` entry (recoveries `[]`, prose says update) mapped when the load error is the typed class.
6. Every other site (`App.vue:830-834`, `useLoginFlow.ts:243/443`, `LoadPodView.vue:388-396`, the sync bar) already dispatches on `PayloadLoadError` and inherits the copy with no change. The new build therefore degrades legibly on the NEXT bump; the deployed build cannot, and the plan does not pretend otherwise.

### R4. A restore is a lineage event, so it sticks

1. Today, restoring the pre-compaction safety copy on device A (Settings → Load another Family Data File → `decryptPendingFile(password, { userChoseThisFile: true })`) adopts under `user-file`, leaving A on the old lineage. Every peer B still holding `{id, seq: 1}` reads `ours-newer → publish-local` and republishes the compacted pod over the restore within one poll (P6 F3). The rollback route the copy promises is undone by the fleet automatically.
2. A new worker op `stampLineage` beside `compactDoc` (`applyAndProject.ts:1187-1312`): stamps `podLineage: { id: generateUUID(), seq: (localSeq ?? 0) + 1 }` into the CURRENT document without the `toJS/from` rebuild, where `localSeq` is the lineage seq of the document this device held BEFORE the `user-file` adopt. `compactDoc` and `stampLineage` share one stamping helper so there is exactly one place that mints a lineage.
3. The `user-file` adopt path calls it when the adopted document's lineage is lower than the one it replaced (a restore), and not otherwise (choosing the live compacted file over a stale local document must not mint a new generation).
4. Peers then read `adopt-remote` and adopt (clean) or rebase (dirty), the propagation the guard was built for. The restored file is written as 5.0 by R1, because it is now stamped, so stale builds stay refused.
5. Known limitation, stated in the plan and the code: a device with no prior document does not know the fleet's seq and cannot reach `user-file` (it reaches `no-local-document`), so it cannot perform a durable restore. A restore is done from a device that holds the family. If that ever needs to change, the restore flow pulls first to learn the seq; not in this plan.

### R5. The pre-compaction backup pair is written as 5.0

1. The compaction flow builds one envelope for both the manual export and the Drive safety copy (`usePodCompaction.ts:230-232`, `:280`), from `buildExportEnvelope()`, BEFORE `compactDoc`. Under R1 that derives 4.0, and a stale build can open it: the deployed picker lists every `.beanpod` Drive-wide with no safety-copy filter, so a stale user reacting to "sync stopped" can pick the copy, be bound to it, and fork the family onto the backup (P6 F5).
2. `buildExportEnvelope({ atLeast: '5.0' })`, used ONLY by the compaction flow: the derived version is raised to 5.0. Every other export (Settings → Export) stays derived. A family that has compacted is a 5.0 family from that moment; a stale build cannot open its backup, a current build can, and the rollback route is unchanged.
3. The byte-compare of the safety copy (`:308-352`) is unaffected: it compares what came back against what went out.

### R6. The soak gate becomes a notice; nobody is asked to enumerate devices

1. `evaluateSoak` (`src/services/pod/podSoak.ts`) stays as the ONE reading, with `lineageEpoch` as the machine test. It returns `behind` as `{ name, appVersion }` items so the words can name the build a person last used, from the member row's `appVersion` (`familyStore.ts:505-512`, written with `lastLoginAt` on every login).
2. `refuseSoak` and the `not-soaked` / `not-soaked.named` refusal codes are DELETED from `usePodCompaction`. Steps 0 and 2d of the ladder become "read the names for the confirm", not gates. `usePodHealth.waitingOn` becomes `olderVersion: { name, appVersion }[]`.
3. The Settings section shows, when `behind` is non-empty, a standing notice naming who last used an older version, and always, once, the rule that beanies can only see the version each person used most recently. The bring-your-devices-online caution remains for the rebase case.
4. The confirm dialog appends the same names when `behind` is non-empty, so the person is told who at the moment they decide.
5. The completion toast names them again; `compaction.doneButBehind` (whose "so their changes come across safely" is no longer true under 5.0) is replaced.
6. Copy (en; beanie and zh through the usual pipeline), lifted from P6 §3 and §4:
   - `compaction.olderVersion.item`: `{name} ({version})`
   - `compaction.olderVersion.notice`: `{list} last opened beanies on an older version. Once you compact, a device that is still on an older version shows a message and stops syncing until it updates, and anything added on it before then is not kept. Ask them to update beanies first if you can. Nothing else changes for anyone.`
   - `compaction.olderVersion.rule`: `beanies can only see the version each person used most recently, not every device they own. Any device that has not updated will say so when it next opens, and will sync again once it does.`
   - `compaction.doneOlderVersion`: `Done. {list} last opened beanies on an older version; that device will show a message and sync again once it updates.`
   - `compaction.confirmMessage` (replaces the current text): `beanies will rebuild your family file without its record of past changes, so it opens faster and works on older tablets. Nothing on this device is lost, and beanies keeps a copy of the current file first. Your other devices pick up the compacted file on their own, and beanies carries across anything they changed while offline. A device still on an older version of beanies shows a message and stops syncing until it updates; anything added on it before then is not kept.`
   - `podNewerVersion.inline` and `resumeSetup.podNewerVersion`: `This family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.`
   - Deleted: `compaction.waitingOn`, `compaction.refused.not-soaked`, `compaction.refused.not-soaked.named`, `compaction.doneButBehind`.
   - The rebase conflict sentence ("the version already saved here is the one kept") moves from the confirm into the "?" popover with `compaction.why.*`.

### R7. Documents

1. ADR-036 addendum (or ADR-037, whichever the implementer judges cleaner): "a compacted document is a 5.0 file, and the version is derived from the document's lineage at write time". States why envelope-carried was rejected (Trap 1) and why the safety copy is 5.0.
2. `docs/STATUS.md`: Tier 3 entry updated; the "OWED before the flag can be flipped" list rewritten around the sequence below; the per-member limitation stated as a property of the notice, not a gate.
3. `docs/lessons.md`: one entry, "a spread carries the field you forgot to think about", from Trap 1.
4. `src/config/flagRegistry.ts` comment: the gate is the fleet drain and the 5.0 refusal, not the stages.
5. `docs/plans/2026-09-06-pod-compaction-tier3.md`: a SUPERSEDED-IN-PART banner pointing here for Stage 4's gate.

## Important Notes & Caveats

- **What the bump does not do.** It does not stop a stale device from overwriting the pod; it stops it from merging into it. The overwrite is loud, reverted by the fleet, and recoverable from the safety copy. The plan's copy says so and never claims more.
- **The person on the stale build gets no message.** The deployed poll swallows the parse error and shows stale data under "Could not refresh". There is no channel into a deployed build (release notes are bundled, no email sender). The family tells them. Do not add a mechanism that pretends to reach them.
- **The stub probe on the deployed build cannot be fixed.** R2.5 fixes the current build's copy so the NEXT stale build does not carry it. The deployed hazard needs the owner's account, a stale build, and a deliberate create with a colliding name; the mitigation is the drain, the safety copy, and Drive revision history.
- **Two compactions in a row stay 5.0** (P6 F9). The version says "compacted", the lineage seq says which generation. Do not introduce 6.0 for a second compaction.
- **Two owners compacting concurrently** resolve to `conflict`, still reachable and still handled (P6 F8). Unchanged.
- **Do not put the version rule in `preserveLocalKeyDicts`.** A local-wins or max rule there is wrong on the adopt/rebase branches and wrong again for the rollback (P5 Trap 1, option 2). The version is derived, full stop.
- **Force-update on native is a follow-up, not this plan.** Under 5.0 a stale device is safe, only cut off; the drain affects how many people the notice names, not safety. Android has Play In-App Updates (immediate mode); iOS has no store mechanism and needs a self-built minimum-version screen. Both are from knowledge, not re-verified against current docs (P4 was stopped for budget). File separately.
- **`beanpodProfile.spec.ts:265`** (env-gated diagnostic) writes a compacted pod with `reEncryptEnvelope(envelope, payload)`; under R1 it must pass the lineage or it produces the forbidden artefact (a compacted 4.0). Update it in the same change.
- **Do not deploy** as part of this work. The flag stays off. The sequence below is greg's to run.

## Assumptions

> **Review these before implementation.**

1. `compareLineage` treats a higher `seq` as newer regardless of `id` (`podLineage.test.ts`: `L('a', 2)` vs `L('b', 1)` → `adopt-remote`). R4 depends on it.
2. `docLineage()` normalises an absent `podLineage` to `null`, so a deployed build's document (no lineage concept) compares as the oldest generation. Verified by P6 F11 at the current build.
3. The IndexedDB envelope cache may say 4.0 for a compacted document after a failed publish; nothing reads the cached version (P5 Q4), and the next write derives it. Acceptable.
4. `app_version` / `build_sha` are available in the telemetry firehose so a login-by-build query per family exists. NOT verified (P4 stopped); the implementer checks `ALLOWED_CONTEXT_KEYS` and `enrichAndRedact`, and if absent, adds nothing here (a new context key triggers the store-declaration rule) and the drain is watched via the member rows' `appVersion` in Settings instead.
5. The deployed picker path that binds a stale device to the safety copy is closed by R5; `CANONICAL_MISMATCH` (`c3a6be98:syncStore.ts:3098`) remains the detector for any fork that predates this change.

## Approach

The centre of the change is R1: one function, `reEncryptEnvelope`, gains one required argument, and the version becomes a fact about the payload rather than a field that rides along. Everything else either widens a reader (R2), types a throw at the one validator all readers funnel through (R3), makes the restore mint a generation using the same helper compaction uses (R4), raises the backup pair (R5), or deletes a gate and replaces it with words (R6).

Order of implementation, each step green before the next:

1. R2 type and known-set; R1 worker return, `reEncryptEnvelope` signature, both writers; `beanpodProfile.spec.ts`. Tests: `fileSync.test.ts` 5.0 accepted, 6.0 typed; a real-`reEncryptEnvelope` save-path test asserting the `kept-local` republish carries 5.0 (the Trap 1 pin); `envelopeMerge.test.ts` asserting `preserveLocalKeyDicts` still copies `incoming.version` (so the derivation, not the spread, is what protects).
2. R3 error class and the six surfacing sites. Tests: `parse` step lands on `podNewerVersion`, not `podCorrupted`; no `clearCache` RPC; `noteRemoteUnreadable` at `warning`; `doSave` refuses.
3. R2.5 stub probe. Test: `connectStorage.test.ts`, a `5.0` file resolves `adopt-existing`; a `6.0` file resolves `adopt-existing`.
4. R4 `stampLineage`, shared helper, `user-file` call site. Test: "restore on A, poll on B, B adopts rather than republishes"; "choose the live compacted file over a stale local document mints nothing".
5. R5 `buildExportEnvelope({ atLeast })`. Test: the safety copy `auxWrite` body and the manual export carry `"version":"5.0"` while the family's ordinary export before compaction carries 4.0.
6. R6 gate deletion, `evaluateSoak` shape, `usePodHealth`, Settings, confirm, toast, strings; delete the four keys; `npm run translate`. Tests: the ladder never refuses on soak; the notice names people with versions; the confirm appends names; the toast names them.
7. R7 documents; CHANGELOG.
8. Full gate; commit; push. No deploy.

DRY audit: one lineage-stamping helper (compaction and restore); one known-version set (validator, detector, probe); one derived-version function (both writers); one soak reading (`evaluateSoak`) feeding notice, confirm and toast; one error class for "newer than I understand" surfaced through the existing `PayloadLoadError` dispatch at every site. Nothing new is added where an existing pattern already has the right shape.

Error handling: every failure path already exists and is classified; this plan changes classifications, it does not add bare catches. The one new throw (R3) is typed at the source so no caller has to classify it. `stampLineage` runs inside the worker's existing single-assignment discipline (compose fully, then install), so a throw leaves the document untouched.

## Files Affected

- `src/types/syncFileV4.ts` (BeanpodVersion)
- `src/types/sync.ts` (UnsupportedBeanpodVersionError, PodBlockMessageKey)
- `src/services/sync/fileSync.ts` (known set, parse, detect, reEncryptEnvelope)
- `src/services/sync/connectStorage.ts` (isStubBeanpod)
- `src/services/sync/syncService.ts` (doSave, three picker readers, fetchAndMergeRemote wrap)
- `src/stores/syncStore.ts` (buildExportEnvelope, rebindPodFile arm, loadFromGoogleDrive error, user-file adopt → stampLineage)
- `src/services/automerge/worker/applyAndProject.ts` (exportEncryptedPayload return, stampLineage, shared stamp helper, dispatch case)
- `src/services/automerge/worker/docClient.ts` (types, stampLineage client)
- `src/services/automerge/worker/protocol.ts` (if the new error crosses the boundary; it should not, it is thrown on main)
- `src/utils/payloadFailureSurface.ts` (parse arm)
- `src/composables/useJoinFlow.ts` (FILE_NEWER_VERSION)
- `src/composables/usePodCompaction.ts` (delete refuseSoak and codes; names for confirm and toast; atLeast on the backup build; note update)
- `src/composables/usePodHealth.ts` (olderVersion)
- `src/services/pod/podSoak.ts` (behind items carry appVersion)
- `src/pages/SettingsPage.vue` (notice and rule)
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via the pipeline)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`
- Tests: `fileSync.test.ts`, `connectStorage.test.ts`, `envelopeMerge.test.ts`, `fetchAndMergeRemote.test.ts`, a new save-path version test, `rebase.test.ts` or a new `stampLineage.test.ts`, `usePodCompaction.test.ts`, `usePodHealth.dueSignal.test.ts`, `podSoak.test.ts`; delete the dead `detectFileVersion` mocks P5 Q9 lists
- `docs/adr/036-...md` (addendum) or `docs/adr/037-...md`, `docs/STATUS.md`, `docs/lessons.md`, `src/config/flagRegistry.ts`, `docs/plans/2026-09-06-pod-compaction-tier3.md` (banner), `CHANGELOG.md`

## Help Center Coverage

- **Action**: new article
- **Category**: how-it-works
- **Article type**: troubleshooting
- **Slug**: `family-file-newer-version`
- **Title**: beanies says my family file was saved by a newer version
- **Scope**: What the message means (someone in the family updated and compacted the file), that nothing on the device is lost, and that updating beanies on this device is the only step. One paragraph on why a device that has not updated stops syncing rather than risking the family's data.
- **Notes**: Must not suggest deleting data, re-entering a password, or picking a different file. Ships in the same change; the message it explains is user-facing the moment 5.0 files exist.

## Observability Coverage

- **Events**
  - `pod-lineage` / `logMergeTerminus` already emits `action: 'kept-local'` at both termini. A repeated `kept-local` on one `family_id` is the signature of a stale device fighting the fleet. No new event; the plan adds a CloudWatch query note to the runbook.
  - `pod-load-failure` (existing) for the new error: `noteRemoteUnreadable` reports `step: 'parse'` at `warning` with `error_code: 'parse'`; the file's version string rides in `detail` (already allowlisted), never in `message`, so the buckets stay constant.
  - `pod-compaction` `published` (existing) gains `detail: version=5.0` so the rate of 5.0 publishes is countable.
  - No new context key. If assumption 4 fails, no key is added in this plan.
- **Failure modes covered**: a compacted pod written as 4.0 (impossible by construction under R1, and pinned by the save-path test); a stale overwrite (the `kept-local` count); a device refusing a 5.0 file (`parse` at warning, non-latching, with the version in `detail`); a restore that did not stick (peers would log `kept-local` instead of `adopted`; the R4 test pins the opposite).
- **Success-path signal**: `published` with `version=5.0`; `adopted` at both termini after a restore.
- **Critical vs telemetry**: nothing here pages. A `parse` failure on the boot overlay currently reaches `reportPayloadFailure` at `critical` via `surfacePayloadFatal`; the R3.4 arm excludes `parse` from paging, because "update beanies" is not an incident.
- **Privacy**: no document content, no names, no filenames in any event. The version string is a two-character constant.

## Acceptance Criteria

- [ ] A never-compacted family writes a byte-identical 4.0 envelope before and after this change (fixture test).
- [ ] The compaction publish writes 5.0; the `kept-local` republish writes 5.0; the safety copy and the compaction export write 5.0; the ordinary Settings export of a never-compacted family writes 4.0.
- [ ] `parseBeanpodV4` accepts 5.0 and throws `UnsupportedBeanpodVersionError` (`instanceof PayloadLoadError`, not `CorruptPayloadError`, `latches === false`, `keyMayBeWrong === false`) for 6.0.
- [ ] Every surfacing site shows `podNewerVersion` copy for a 6.0 file; no site wipes the cache or re-prompts for a password (asserted, not inferred, at the six sites P5 Trap 4 lists).
- [ ] `isStubBeanpod` is false for any JSON object with a string `version`; a 5.0 file at a colliding name resolves `adopt-existing`.
- [ ] Restore on A, poll on B: B adopts. Choosing the live file over a stale local document mints no generation.
- [ ] The ladder has no soak refusal; the notice, confirm and toast name people with the version they last used; the four deleted keys are gone from `uiStrings.ts` and `zh.json`.
- [ ] No string asks anyone to open beanies on every device.
- [ ] `beanpodProfile.spec.ts` passes the lineage.
- [ ] Help Center article added and matches the shipped copy.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key.
- [ ] Documents in R7 updated; CHANGELOG entry.
- [ ] Full gate green (vue-tsc, eslint, stylelint, vitest); every new test mutation-checked against the specific regression it pins.

## Testing Plan

1. Unit, as listed under Approach, each mutation-checked: the Trap 1 pin must fail when `reEncryptEnvelope` reads the envelope's version instead of the lineage; the R4 pin must fail when `stampLineage` is skipped; the stub-probe pin must fail when the `!== '4.0'` returns.
2. Local two-browser soak on `npm run dev` (flag on in dev by default): compact on A; B (offline with an edit) reconnects and rebases; reload A and confirm B's edit arrived (the publish-restore pin from `e395b1d4`); confirm the notice names B's member with a version before compacting.
3. Restore drill: restore the safety copy on A; confirm B ADOPTS rather than reverting (watch B's console for `open terminus adopted`, not `kept-local`); confirm the restored family then compacts again cleanly and stays 5.0.
4. The deploy-and-enable sequence, greg's to run, from P6 §7:
   1. Land this plan, flag OFF. Every pod on Earth is still 4.0.
   2. Deploy web and native. Nothing user-visible changes.
   3. Watch the drain (login-by-build query if assumption 4 holds, else the member rows' `appVersion` in Settings on greg's family). There is no safety threshold to wait for under 5.0; the drain decides how many people the notice will name.
   4. On-device acceptance on greg's family BEFORE enabling for anyone else: the Tab A9+/A7 on the new build adopts and opens in the measured ~50MB; a device pinned to `c3a6be98` (the old open-testing APK, or a browser profile with the service worker disabled) shows stale data under "Could not refresh", an edit plus save overwrites the pod as 4.0, a current device republishes it as 5.0, and the stale device is refused again; a restore from a third device is ADOPTED by the fleet. Nothing in CI can exercise a pinned old build against a live Drive file; this run is the acceptance criterion for the mechanism itself.
   5. Enable `podCompaction` for greg's family via the existing override, then generally.
5. Later, optional: once the stale population reads ~0 for a release cycle, consider writing 5.0 for every family and closing the deployed stub-probe hazard for good.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the premise audit; R1 document-derived version as the centre; R2 to R7 as the audit's four required changes plus the error class, the copy, and the documents.
- **Pass 2 (DRY + error handling)**: _pending_
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

</details>
