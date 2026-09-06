## Pass 3 changes

- **R4.3's condition cannot be read where the plan puts it, so `guardLineage` now returns the verdict alongside the action.** `guardLineage` returns `Exclude<LineageAction, 'block'>` only (`src/services/sync/podLineage.ts:202-211`), and `POLICY` maps BOTH `ours-newer` x `user-file` and `conflict` x `user-file` to `adopt` (`podLineage.ts:176-177`). The single production call site is `const act = guardLineage(...)` at `src/services/automerge/worker/applyAndProject.ts:846`, so "adopt from an `ours-newer` verdict" is not expressible there. `compareLineage` is lint-banned outside `applyAndProject.ts` and `podLineage.ts` (`eslint.config.js:371-399`), so it cannot be recomputed elsewhere either. R4.3 now specifies `guardLineage` returning `{ action, verdict }`: one production caller, and the plan's "never a hand-rolled comparison" rule survives intact.
- **The install branch is SHARED with the first-load adopt, so the stamp is a flag, never a property of the branch.** `installWholesale` is seeded `!currentDoc || basis.kind === 'no-local-document'` at `applyAndProject.ts:839`; the install runs at `:951-987`; `act` is block-scoped inside `if (currentDoc && basis.kind !== 'no-local-document')` (`:842-928`) and is NOT in scope at `:956`. Read literally, "stamp inside the adopt branch" would make every fresh device mint a generation on its first sync and republish, forcing the whole fleet to `adopt-remote`. R4.2 now specifies a `stampNewGeneration` flag declared beside `rebaseUnavailable` (`:841`), set only inside the guarded block, with a test that the first-load adopt mints nothing.
- **R4 states that the restore stamp is an `Automerge.change`, deliberately unlike `compactDoc`'s stamp-into-source.** `compactDoc` documents "STAMPED INTO THE SOURCE, not applied as a second `Automerge.change`" (`applyAndProject.ts:1218-1223`). Copying that idiom for the restore would rebuild the restored document through `Automerge.from` and silently compact away the history the restore exists to recover. `nextLineage`'s doc comment now names both callers and why they apply it differently.
- **NEW, and the reason this pass is not "no changes": `surfacePayloadFatal`'s overlay ladder has ALREADY drifted from `payloadErrorMessageKey`, and the plan was about to add a fourth arm to both by hand.** `payloadErrorMessageKey` has FOUR answers (`src/types/sync.ts:385-392`) under a comment that says "THREE answers" (`:376`); `surfacePayloadFatal`'s ternary is a THREE-way (`src/utils/payloadFailureSurface.ts:121-125`) under a comment claiming "THREE-way, matching `payloadErrorMessageKey`" (`:116`). A `parse` failure therefore renders `podUnreadable.inline` inline and `resumeSetup.podCorrupted` full-screen, which is exactly the split that comment says it exists to prevent, and it is reachable (`syncService.ts:1542-1546` produces it; `App.vue:585`, `ResumePodSetup.vue:320` and `useLoginFlow.ts:993` raise the overlay). R3.3 and R3.6 now derive all three decisions from ONE discriminator, `payloadErrorKind(err)`, through `as const satisfies Record<PayloadErrorKind, ...>` tables, the idiom `POD_ACCESS_ERRORS` already uses (`src/utils/podAccess.ts:97`). A fifth class then breaks the build in three places instead of taking a silent default.
- **`opts.atLeast` was documented as a floor and implemented as `=== '5.0'`, so it silently downgrades at the next bump.** Replaced with an intent-shaped option, `opts.compactionBackup`, plus one named `COMPACTED_VERSION` constant. The writer still cannot choose a version, there is no ordering to get wrong at 6.0, and the acceptance criterion stops pinning a string comparison (R1.2, R5.2).
- **`createBeanpodV4`'s hardcoded `'4.0'` becomes the same derivation, so there is ONE.** `fileSync.ts:40`; sole caller `syncStore.ts:2284`, which already holds `exportEncryptedPayload()`'s result from `:2283`. The literal is safe only because a create-time document has no lineage, and nothing enforces that; the create path has an `adopt-stub` sibling (`connectStorage.ts:234-236`), so a future reuse over an existing document would write a compacted payload labelled 4.0, the forbidden artefact (R1.6, R2.4).
- **The worker and client declare `exportEncryptedPayload`'s result shape TWICE, and nothing cross-checks them.** `applyAndProject.ts:1039` and `docClient.ts:1317` each hand-write `Promise<{ payload: string; heads: Heads }>`; `protocol.ts` types the op name but not its result. If the client learns `lineage` and the worker forgets to return it, the destructure yields `undefined` typed as `PodLineage | null` and every save writes 4.0, silently. R1.1 now puts the shared result type in `protocol.ts` (a TYPE, not an op; the "no new op" rule is unchanged) so a missing field is a worker-side compile error.
- **R3.7 was incomplete: `loadFromNewFile` has FOUR callers and the plan fixed two.** `syncStore.ts:1570-1572` names them. `JoinPodView.vue:164` and `:177` funnel through `handleLocalLoadResult` (`:186-201`), which falls to `t('auth.fileLoadFailed')`; `manualImport` (`syncStore.ts:2847-2852`) flattens to a raw English string that `SettingsPage.vue:640` renders via `result.error ?? 'Import failed'`, itself a bare English literal. All four are now enumerated, with `JoinPodView`'s one chokepoint covering both of its entry points.
- **R3.10's mapper now owns the narrowing, so the second call site cannot re-derive it.** `asJoinDecryptError` guards on `instanceof PayloadLoadError` (`useJoinFlow.ts:98`) and `!payload.keyMayBeWrong` (`:99`), while `doPickAndLoad` (`:589-597`) will receive a `RemoteBlocker` that may be a `PodLineageError`. The extracted helper is `joinCodeForBlocker(blocker): JoinErrorCode | null` and holds the `instanceof`, the guard and the three-way together.
- **The Observability section promised the version rides in `detail`, and no code put it there.** `noteRemoteUnreadable`'s context is `{ action, error_code }` only (`syncService.ts:135-141`). Without it a 6.0 refusal is indistinguishable from a torn read in CloudWatch, which is the one query the plan says it needs. Added `PayloadLoadError.blockDetail` (default `undefined`, overridden by the new class), forwarded by `noteRemoteUnreadable`. One member, no `instanceof`, `message` untouched so the dedup bucket is unchanged.
- **`reEncryptEnvelope` is mocked in thirteen suites, most returning the literal `'{"version":"4.0"}'`.** Listed in the Testing Plan with the requirement that the Trap 1 pin uses the REAL function, or it asserts the mock's literal and stays green through the exact regression it exists to catch. `usePodCompaction.test.ts:34-36` mocks `usePodHealth` returning only `{ canCompactPod }`, so R6.3's new fields would arrive as `undefined`; the mock is typed against `ReturnType<typeof usePodHealth>`.
- **R6 renames `evaluateSoak`, because deleting the gate leaves a module documented as one.** `podSoak.ts:1-21` describes a gate that "refuses"; `evaluateSoak` (`:69`), `SoakVerdict` (`:35`). A display function under a gate's doc comment is how the refusal gets re-added. Renamed to `membersOnOlderVersions` with a rewritten header; `SOAK_WINDOW_DAYS` and `REQUIRED_EPOCH` stay.
- **R3.8 no longer asks the implementer to state one fact twice without saying so.** `POD_ACCESS_ERRORS[code].severity` (`podAccess.ts:61-97`) and `POD_ACCESS_SEVERITY[code]` (`:107-115`) are two tables of the same fact, but `podAccess.test.ts:128` already loops every code asserting they agree, so the new row is covered automatically. Recorded rather than refactored.

---

# Plan: Compacted pods are beanpod 5.0, and the soak gate becomes a notice

> Date: 2026-09-06
> Related issues: None (direct implementation; tracker #90 Tier 3 follow-up)
> Plan file: `docs/plans/2026-09-06-compacted-pod-v5-pass3.md` (Pass 3 of `docs/plans/2026-09-06-compacted-pod-v5.md`)
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md` (P1, P5, P6 complete; P2/P3 and P4 checked directly). Every file:line below was pinned by the audit at `33dbef34` (current) or `c3a6be98` (deployed), or re-verified in Pass 2 or Pass 3 against the working tree.
> Supersedes: the soak gate half of `docs/plans/2026-09-06-pod-compaction-tier3.md` (Stage 4, R3/R4). Stages 1 to 3 are unchanged.

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family owner, I want to compact our family file without having to find every device anyone in the family has ever opened beanies on, so that the file opens on an old tablet and nobody's data is silently damaged by a device that has not updated yet.

## Context

Compaction rewrites the family document without its history. A compacted document shares no ancestry with the original, so a device on a build that predates the lineage guard (production is `c3a6be98`, 0.16, which has no lineage concept) CRDT-merges the two, deterministically destroys the compactor's edits, and carries the new lineage id forward so that every guarded device then reads the corruption as clean (ADR-036).

Stage 4's defence was a soak gate: refuse to compact until every recently active member has logged in on a guard-honouring build. The gate is per member (`lineageEpoch` on the member row) and cannot see a person's other devices, so its instruction, "open beanies once on every device you use it on", is unverifiable and, per greg, an impossible ask for a normal family. Once Sam logs in once on a current build, Sam passes forever, and Sam's old tablet is still a hazard the gate cannot see.

The audit established a structural replacement. The deployed build's `parseBeanpodV4` (`c3a6be98:src/services/sync/fileSync.ts:73-74`) throws on any envelope `version` other than `'4.0'`, before decrypt, before the worker, and before adopting the remote marker or key dicts; and every Automerge merge entry point in the deployed build sits behind it (P1). So a compacted pod written as **version 5.0** cannot be merged by a pre-guard build. No read-path failure wipes the cache, deletes a credential, or loops on a password prompt (P1, P6 section 2). The catastrophic case is gone by construction.

What a stale build can still do is **overwrite** the compacted pod, by two mechanisms (P1 F2, F1): any save on a warm-cache stale device (the baseline skip, not the swallowed throw), and the owner creating a same-named family on a stale build (the deployed stub probe reads a 5.0 file as an empty placeholder). Both are loud, both are bounded by the fleet's `ours-newer` to `publish-local` self-heal (`src/services/sync/podLineage.ts:176`), and both cost the same: whatever the stale device wrote, plus the wrapped key of any member who joined after that device last synced, until the republish lands. The bump therefore does not replace draining the fleet; it changes what a straggler can do from "silently corrupt everyone" to "loudly revert until the fleet pushes back". The deploy sequence stays the primary control, and the soak gate stops pretending to be one.

The audit also found that the obvious implementation is wrong. Stamping `'5.0'` on the envelope at compaction and letting the spread carry it lasts exactly one round trip: the four `kept-local` termini adopt the REMOTE envelope (including its version) and republish the LOCAL compacted document under it (P5 Trap 1, P6 F1, found independently). Pass 2 re-verified the mechanism: `preserveLocalKeyDicts` returns `{ ...incoming, ...key dicts }` (`src/services/sync/envelopeMerge.ts:68-96`), so `version` is carried from the remote by a spread nobody was looking at. The version must describe the payload, and the payload's lineage lives in the document. That is the design centre of this plan.

## Requirements

### R1. The envelope version is derived from the document, never carried by spread, and derived in ONE place

1. `exportEncryptedPayload` (`src/services/automerge/worker/applyAndProject.ts:1039-1045`, client `src/services/automerge/worker/docClient.ts:1317`) returns `lineage: docLineage(doc)` alongside `{ payload, heads }`. Read from the SAME `doc` const the heads are read from, so it describes exactly the bytes being exported.
   - **The result shape becomes ONE exported type in `protocol.ts`**, `export interface ExportedPayload { payload: string; heads: Heads; lineage: PodLineage | null }`, imported by both the worker function and the `docClient` wrapper. Today the two sides hand-write the same object literal independently (`applyAndProject.ts:1039` and `docClient.ts:1317`) and `protocol.ts` types only the op NAME, so nothing cross-checks them. If the client learns `lineage` and the worker forgets to return it, the destructure yields `undefined`, typed `PodLineage | null` by the lying declaration, and every save writes 4.0 for a compacted pod: the exact forbidden artefact, silently. This is a TYPE in `protocol.ts`, not an op; the "no new op crosses the boundary" rule (R4.2) is unchanged.
2. **`beanpodVersionFor` is the ONE derivation**, a small pure function in `fileSync.ts` beside the two writers that call it:

   ```ts
   /** A compacted document is a 5.0 file. Nothing else decides this. */
   const COMPACTED_VERSION: BeanpodVersion = '5.0';
   const LEGACY_VERSION: BeanpodVersion = '4.0';

   export function beanpodVersionFor(
     lineage: PodLineage | null,
     opts?: { compactionBackup?: true }
   ): BeanpodVersion {
     // `compactionBackup` is the ONE deliberate exception, and it is stated as an
     // INTENT rather than as a version: the pre-compaction safety pair carries an
     // un-compacted payload, so the derivation would say 4.0, and a build that
     // predates the lineage guard could then open it from a picker and fork the
     // family onto the backup (R5). The writer still does not get to name a
     // version, and there is no ordering here to get wrong at the next bump.
     return lineage || opts?.compactionBackup ? COMPACTED_VERSION : LEGACY_VERSION;
   }
   ```

   Written this way rather than as an `atLeast: BeanpodVersion` floor. A floor whose body is `opts?.atLeast === '5.0' ? '5.0' : derived` is not a floor: at the 6.0 bump `atLeast: '6.0'` would silently fall through to the derived value, and the test that "proves" it ("cannot lower a derived 5.0") would still pass. An option that is not a version cannot express a downgrade at all.

3. `reEncryptEnvelope(envelope, encryptedPayload, lineage, opts?)` (`src/services/sync/fileSync.ts:214-222`) stamps `beanpodVersionFor(lineage, opts)`. The `lineage` parameter is REQUIRED and is a `PodLineage | null`, not a version string: a writer cannot pass the wrong version because it does not get to choose one.
4. **`createBeanpodV4` calls the same helper** (`fileSync.ts:27-52`), taking `lineage: PodLineage | null` immediately after `encryptedPayload`. Its sole caller is `createNewFile` (`src/stores/syncStore.ts:2284`), which already holds `exportEncryptedPayload()`'s result one line above at `:2283`, so passing it is free. The old literal `'4.0'` (`fileSync.ts:40`) was correct only because a create-time document has no lineage, and nothing enforced that; the create path already has an `adopt-stub` sibling (`connectStorage.ts:234-236`), so a future reuse over an existing document would have written a compacted payload labelled 4.0. A new family still writes 4.0, now because the document says so rather than because a literal does. After this there are ZERO version literals outside `beanpodVersionFor`.
5. Both re-encrypt writers pass the lineage: `doSave` (`src/services/sync/syncService.ts:1801-1802`, which already destructures `{ payload, heads: exportedHeads }` from the same call) and `buildExportEnvelope` (`src/stores/syncStore.ts:2826-2837`).
6. `usePodCompaction` gains NO envelope stamp. Its "NO ENVELOPE STAMP" note (`src/composables/usePodCompaction.ts:381-386`) is now true for a stronger reason and is updated to say so.
7. Consequences that follow for free and must be tested rather than assumed: the compaction publish writes 5.0 because the document is compacted; the failed-publish self-repair (`ours-newer` to `publish-local`) republishes as 5.0 for the same reason; a `kept-local` after a stale overwrite republishes as 5.0; a never-compacted family writes 4.0 byte-for-byte as today.

### R2. Every reader accepts 4.0 and 5.0, from one definition

1. `export type BeanpodVersion = '4.0' | '5.0'` in `src/types/syncFileV4.ts`; `BeanpodFileV4.version: BeanpodVersion` (`:56`). `BeanpodFileV4` is NOT renamed (the V4 names the key model, which does not change; 30+ importers).
2. `KNOWN_BEANPOD_VERSIONS: ReadonlySet<BeanpodVersion>` in `fileSync.ts`, with exactly ONE reader: `parseBeanpodV4` (`fileSync.ts:73-75`). Under R2.3 and R2.5 there is no second version test left in the app, so there is nothing for it to drift from.
3. **The three picker readers lose their `detectFileVersion` pre-call entirely** rather than widening its literal. `openAndLoadFile` (`syncService.ts:2065-2084`), `openAndLoadFileFallback` (`:2117-2133`) and `loadDroppedFile` (`:2157-2176`) are three byte-similar copies of the same shape: `detectFileVersion(text)`, then `parseBeanpodV4(text)` on `'4.0'`, then a hand-rolled `lastError: 'Unsupported file version: ...'` on anything else, all inside a try that already catches. Each becomes a plain `parseBeanpodV4(text)` inside that try. The reasoning is already written in this codebase at `src/stores/syncStore.ts:1230-1234`: "`parseBeanpodV4` validates the version itself and throws a BETTER message, so the old `detectFileVersion` pre-call was a second full JSON.parse of the whole multi-megabyte file purely to read one field, then thrown away."
   - `rawText`, the only value the deleted arm returned (`syncService.ts:71`, written at `:2084`, `:2133`, `:2176`), has NO reader anywhere in `src/`. It is removed with the arm. Its comment calls it "raw file text for V3 fallback detection"; there is no V3 fallback.
   - The three catches gain the `payloadError` carry described in R3.7.
4. `createBeanpodV4` no longer holds a literal; see R1.4. "A new family is a 4.0 family until it compacts" is now a consequence of the derivation rather than a separate rule.
5. `isStubBeanpod` (`src/services/sync/connectStorage.ts:245-251`) returns `true` only for null, empty, whitespace, or `{}`. It no longer consults any version. A JSON object with a string `version` field is never a stub, whatever the version; `resolveExistingBeanpod` then falls to `adopt-existing` (`connectStorage.ts:234-236`), which is confirm-gated. Its own comment (`connectStorage.ts:219-222`) already promises that any failure falls safe to `adopt-existing`; the code now does. The subsequent confirmed open goes through `parseBeanpodV4` like every other read, so it surfaces the R3 copy rather than a bare throw.
6. **`detectFileVersion` is deleted** (`fileSync.ts:94-105`), along with its import in `syncService.ts:24` and `connectStorage.ts:27` and its `fileSync.test.ts` block (`:125-142`). After R2.3 and R2.5 it has no production caller. Leaving an exported version-sniffer that nothing reads is the next person's trap.

### R3. A version newer than this build understands is one typed, non-destructive error, thrown at the source

1. `PayloadLoadError` (`src/types/sync.ts:253-323`) gains TWO members beside `keyMayBeWrong` and `deviceCannotOpen`, in the same idiom the class already documents ("prefer a member that a new subclass must ANSWER to an `instanceof` it can silently inherit the wrong side of", `:204-205`):

   ```ts
   /**
    * Is the file simply NEWER than this build, rather than damaged?
    * Overridden to `true` by `UnsupportedBeanpodVersionError`. The action is
    * "update beanies", which is neither an incident nor a data problem.
    */
   get needsAppUpdate(): boolean { return false; }

   /**
    * One queryable fact for the firehose's `detail`, or `undefined`.
    * Exists so a subclass can carry a discriminating value without any consumer
    * doing an `instanceof` to read it, and without touching `message` (which
    * `errorReporter` buckets on, so a per-file value there would defeat the
    * throttle). `blockCode`'s sibling.
    */
   get blockDetail(): string | undefined { return undefined; }
   ```

2. `export class UnsupportedBeanpodVersionError extends PayloadLoadError` in `src/types/sync.ts` (which has no imports, so no cycle): `step = 'parse'`, literal `name` (never `new.target.name`; the prod build minifies and the worker error registry keys on `err.name`, the rule stated at `sync.ts:333-337`), `readonly fileVersion: string`, `override get needsAppUpdate() { return true; }`, an `override get blockDetail()` returning the string `version=<fileVersion>`. Inherited unchanged: `latches: false` (the base already returns `false` for `step === 'parse'`, `:320-322`), `keyMayBeWrong: false`, `deviceCannotOpen: false`. It is NEVER a subclass of `CorruptPayloadError` (which the worker's cache self-heal deletes the cache on).
3. **ONE discriminator answers "what kind of payload failure is this", and all three decisions read tables keyed on it.** This is a correction, not a preference: the two ladders the plan was about to extend have ALREADY drifted.
   - `payloadErrorMessageKey` (`sync.ts:375-393`) has FOUR answers (`keyMayBeWrong`, `step === 'parse'`, `deviceCannotOpen`, else) under a comment that says "THREE answers" (`:376`).
   - `surfacePayloadFatal`'s `overlayKey` (`src/utils/payloadFailureSurface.ts:121-125`) is a THREE-way under a comment claiming "THREE-way, matching `payloadErrorMessageKey`" (`:116`), whose stated purpose is that "the same error object" must not produce two different messages.
   - So today a `parse` failure renders `podUnreadable.inline` inline and `resumeSetup.podCorrupted` ("your data may be damaged, contact support") full-screen. It is reachable: `syncService.ts:1542-1546` constructs it, and `App.vue:585`, `ResumePodSetup.vue:320` and `useLoginFlow.ts:993` raise the overlay.

   Adding a fourth flag by hand to both ladders does not stop the fifth from drifting. Instead:

   ```ts
   export type PayloadErrorKind =
     | 'credential-stale' // keyMayBeWrong
     | 'needs-update'     // needsAppUpdate
     | 'unreadable'       // step === 'parse' (a torn read)
     | 'too-large'        // deviceCannotOpen
     | 'corrupt';

   export function payloadErrorKind(err: PayloadLoadError): PayloadErrorKind { ... }
   ```

   with three `as const satisfies Record<PayloadErrorKind, ...>` tables, the idiom `POD_ACCESS_ERRORS` already uses (`src/utils/podAccess.ts:97`) for exactly this reason:
   - `PAYLOAD_INLINE_KEY: Record<PayloadErrorKind, PodBlockMessageKey>` in `sync.ts`; `payloadErrorMessageKey` becomes `PAYLOAD_INLINE_KEY[payloadErrorKind(err)]` and keeps its name, its signature and every one of its seventeen consumers.
   - `PAYLOAD_OVERLAY_KEY: Record<PayloadErrorKind, UIStringKey>` in `payloadFailureSurface.ts`, replacing the ternary at `:121-125`.
   - `PAYLOAD_IS_INCIDENT: Record<PayloadErrorKind, boolean>` in `payloadFailureSurface.ts`, replacing `reportPayloadFailure`'s two early returns (`:59`, `:64`) with one. `true` for `unreadable` and `corrupt` only.

   A sixth kind then fails the build in three places rather than taking a silent default. The existing `parse` overlay mismatch is preserved as-is for now (`unreadable` maps to `resumeSetup.podCorrupted`) with a comment naming it and a follow-up issue: fixing the copy is a separate, user-visible change and must not ride in on a version bump. Making it VISIBLE in a table, rather than buried in two hand-written ladders, is this plan's job.

4. **The subclass does NOT override `inlineMessageKey`.** `PayloadLoadError.inlineMessageKey` is a getter that DELEGATES to `payloadErrorMessageKey(this)` with the comment "delegates, so the three-way copy rule lives in one place" (`sync.ts:305-308`). Five sites call `payloadErrorMessageKey(e)` directly (`LoadPodView.vue:395`, `:423`, `useLoginFlow.ts:455`, `LoginPage.vue:526`, `SettingsPage.vue:445`) and a dozen read `.inlineMessageKey` (`LoadPodView.vue:244/581/651`, `SettingsPage.vue:561`, `useLoginFlow.ts:678/881`, `syncStore.ts:3541/3547/3579`, `ResumePodSetup.vue:400`, `useBiometricSignIn.ts:106`). A subclass override would show two different messages for one error, split across those two groups. `'podNewerVersion.inline'` is added to `PodBlockMessageKey` (`sync.ts:183-190`) and is the `needs-update` row of `PAYLOAD_INLINE_KEY`.
5. `parseBeanpodV4` throws `UnsupportedBeanpodVersionError` when `version` is a string not in `KNOWN_BEANPOD_VERSIONS`, carrying that string in `fileVersion` and in the message. A missing or non-string `version` stays the plain "invalid file" `Error` (it is not a newer beanpod; it is not a beanpod).
6. `fetchAndMergeRemote`'s wrap (`syncService.ts:1539-1549`) becomes `e instanceof PayloadLoadError ? e : new CorruptPayloadError(...)`, the idiom `payloadFailure` already uses (`src/services/automerge/worker/docOps.ts:349-353`), so it does not relabel a typed throw as corruption.
7. **The local-file picker path stops failing silently, at all FOUR of its callers.** This is a defect the review found, not a new feature. Today `loadFromNewFile` (`syncStore.ts:1488-1515`) and `loadFromDroppedFile` (`:1520-1550`) return a bare `{ success: false }` with the reason discarded. `syncStore.ts:1570-1572` already enumerates the callers; all four are in scope:
   - `SettingsPage.handleLoadFromFileConfirmed` (`SettingsPage.vue:522-537`) has no failure arm at all. The user picks a file and NOTHING happens.
   - `LoadPodView.handleLoadFile` (`LoadPodView.vue:519-540`) falls through to the generic `t('auth.fileLoadFailed')`.
   - `JoinPodView` reaches both store functions (`:164`, `:177`) through ONE chokepoint, `handleLocalLoadResult` (`:186-201`), which also falls to `t('auth.fileLoadFailed')`. One arm there covers both entry points.
   - `manualImport` (`syncStore.ts:2847-2852`) flattens everything to a developer-facing English string, which `SettingsPage.handleManualImport` renders as `result.error ?? 'Import failed'` (`SettingsPage.vue:640`), itself a bare English literal in a rendered ref. It forwards `payloadError` like the others; the `?? 'Import failed'` fallback is routed through `t()` in the same edit, because it is on the line being touched and a hardcoded English string in a rendered ref is a standing CI-adjacent defect.

   Fix with the field name and idiom that already exist: `OpenFileResult` (`syncService.ts:65-72`) and the store functions gain `payloadError?: RemoteBlocker`, set in the three catches of R2.3 when `isRemoteBlocker(e)`. `decryptPendingFile` already returns exactly this field (`syncStore.ts:1606`) and both pages already render it (`SettingsPage.vue:561`, `LoadPodView.vue:244`), so each surface gains the same `else if (result.payloadError)` arm it already has three lines away. No new pattern, no new component, no new copy beyond the one key.

8. `rebindPodFile` (`syncStore.ts:4778-4795`) is fixed in the CLASSIFIER, not at the call site.
   - `PodAccessErrorCode` gains `'FILE_NEWER_VERSION'`, and `POD_ACCESS_ERRORS` gains its entry (`messageKey: 'podAccess.error.newerVersion'`, `recoveries: []`, `severity: 'warning'`). The registry is `as const satisfies Record<PodAccessErrorCode, PodAccessEntry>` (`src/utils/podAccess.ts:97`), so the type system forces the message, the recovery and the severity. `recoveries: []` is deliberate and has precedent (`JOIN_ERRORS.NO_UNCLAIMED_MEMBERS`, named at `podAccess.ts:58`): no button in the app can update the app.
   - `POD_ACCESS_SEVERITY` (`podAccess.ts:107-115`) also gains the row. It restates `POD_ACCESS_ERRORS[code].severity`, which is two tables of one fact, but `podAccess.test.ts:128` already loops every code asserting they agree, so the new row is covered by an existing test the moment it exists. Recorded here so the implementer does not add the fact twice and wonder whether anything checks it.
   - `classifyDriveFailure` (`podAccess.ts:128-138`) gains one arm: a `PayloadLoadError` whose `needsAppUpdate` is true returns the new code. Both catch sites that call it (`syncStore.ts:3948` and `:4779`) are healed at once, which a hand-rolled `isRemoteBlocker` arm at one of them would not do.
   - `rebindPodFile`'s report reads `severity: POD_ACCESS_SEVERITY[code]` instead of its hardcoded `'critical'` (`syncStore.ts:4785`). The table exists to answer exactly this question as data (`podAccess.ts:99-106`) and is already consulted that way at `syncStore.ts:4028`; a "please update beanies" must not page Slack.
9. `loadFromGoogleDrive` (`syncStore.ts:4458-4468`) sets `error.value = useTranslationStore().t(e.inlineMessageKey)` for an `isRemoteBlocker(e)` and returns it as `payloadError` on the result. Today the catch sets `error.value = (e as Error).message` (`:4459`), a raw English exception string that `LoadPodView.handleLoadFile` renders verbatim (`LoadPodView.vue:531`).
10. The join flow reuses its ONE mapper, and that mapper owns the narrowing. `JOIN_ERRORS` gains `FILE_NEWER_VERSION` (`messageKey: 'join.error.newerVersion'`, `recoveries: []`, `severity: 'warning'`); extract from `asJoinDecryptError` (`useJoinFlow.ts:86-109`):

    ```ts
    /**
     * The join code for a blocker, or null when the blocker is not the join
     * flow's to name (a lineage block carries its own copy; a decrypt-step
     * failure is the rotated-key signature a fresh link genuinely fixes).
     *
     * The `instanceof` and the `keyMayBeWrong` guard live HERE, not at the call
     * sites: `doPickAndLoad` receives a `RemoteBlocker` that may be a
     * `PodLineageError`, so a second site narrowing for itself is a second copy
     * of this decision.
     */
    function joinCodeForBlocker(blocker: RemoteBlocker | undefined): JoinErrorCode | null {
      const payload = blocker instanceof PayloadLoadError ? blocker : null;
      if (!payload || payload.keyMayBeWrong) return null;
      return payload.needsAppUpdate
        ? 'FILE_NEWER_VERSION'
        : payload.deviceCannotOpen
          ? 'FILE_TOO_LARGE'
          : 'FILE_CORRUPT';
    }
    ```

    `asJoinDecryptError` calls it in place of its inline expression (`:98-107`). `doPickAndLoad` (`:589-597`), which today flattens every load failure to `FILE_READ_FAILED` carrying a raw English `syncStore.error` (`:590-595`), calls it against `result.payloadError` from R3.9 and keeps `FILE_READ_FAILED` only as the `null` fallback. One mapper, two call sites; do not write the second copy.

11. Every other site (`App.vue:585`, `useLoginFlow.ts:243/443/993`, `LoadPodView.vue:388-396`, `ResumePodSetup.vue:320/400`, the sync bar via `syncStore.ts:3539-3581`) already dispatches on `PayloadLoadError` or `RemoteBlocker` and inherits the copy with NO change, because R3.3 and R3.4 put the branch in the shared resolver. The new build therefore degrades legibly on the NEXT bump; the deployed build cannot, and the plan does not pretend otherwise.

### R4. A restore is a lineage event, so it sticks

1. Today, restoring the pre-compaction safety copy on device A (Settings, Load another Family Data File, `decryptPendingFile(password, { userChoseThisFile: true })` at `SettingsPage.vue:548`) adopts under `user-file`, leaving A on the old lineage. Every peer B still holding `{id, seq: 1}` reads `ours-newer` to `publish-local` (`podLineage.ts:176`) and republishes the compacted pod over the restore within one poll (P6 F3). The rollback route the copy promises is undone by the fleet automatically.
2. **The stamp happens inside `mergeRemoteEnvelope`. There is no new worker op, no new protocol message, no new `docClient` method and no new store call site.** The guard and both documents exist only there (`applyAndProject.ts:783-792`, and `eslint.config.js:371-399` bans `guardLineage`/`compareLineage`/`lineageAction` everywhere else), so the decision cannot live anywhere but this file.
   - A separate `stampLineage` RPC would be strictly worse: the install branch calls `schedulePersist()`, `scheduleSnapshotPersist()` and `pushProjection` before it returns (`:959-964`), so a save landing between the adopt and the stamp would publish the UNSTAMPED restored document, and the restore would silently fail to stick in exactly the way R4 exists to prevent.
   - **The stamp is a FLAG set in the guarded block, never a property of the install branch.** `installWholesale` is seeded `!currentDoc || basis.kind === 'no-local-document'` at `:839`, and the install at `:951-987` therefore serves the first-load adopt as well; `act` is block-scoped inside `if (currentDoc && basis.kind !== 'no-local-document')` (`:842-928`) and is not even in scope at `:956`. Declare `let stampNewGeneration = false;` beside `rebaseUnavailable` (`:841`), set it only inside the guarded block under R4.3's condition, and read it at the install. A fresh device that stamped on its first sync would mint a generation and republish, forcing the whole fleet to `adopt-remote`: a new phone joining would churn every other device. Pinned by a test.
   - **The stamp is an `Automerge.change` on the migrated remote, deliberately unlike `compactDoc`'s stamp-into-source.** `compactDoc` writes the lineage INTO the plain object before `Automerge.from` and says why (`:1218-1223`); doing that here would rebuild the restored document and destroy the history the restore exists to recover. `nextLineage`'s doc comment names both callers and the difference.
   - Compose, then install, exactly as the branch already does (`:952-956`): build `migrateDoc(remote)`, apply the stamp to that value, assign `currentDoc` ONCE. A throw leaves the old document installed by construction, which is the discipline the surrounding code already enforces and documents (`:860-870`).
3. **The condition is the guard's VERDICT, and `guardLineage` is changed to return it.** Stamp when the verdict was `ours-newer` under `user-file`, and never otherwise.
   - `guardLineage` today returns `Exclude<LineageAction, 'block'>` only (`podLineage.ts:202-211`), and `POLICY` maps BOTH `ours-newer` x `user-file` and `conflict` x `user-file` to `adopt` (`:176-177`). So `act === 'adopt'` cannot distinguish them and the plan's condition is not expressible at `:846` as written. Change the return to `{ action, verdict }`. There is exactly ONE production call site (`applyAndProject.ts:846`) plus the podLineage tests, so this is a small, contained signature change, and it keeps the rule that nothing re-derives the comparison: `compareLineage` already answers the question completely, including the `remote === null` case (`podLineage.ts:135`).
   - Two cases this correctly excludes. `conflict` x `user-file` is also `adopt` (`:177`): two devices compacted concurrently and a human picked one, so adopting the chosen id is the resolution and minting a third generation would be wrong. And `adopt-remote` x `user-file` is `rebase` (`:175`), not `adopt`: choosing a NEWER file over a stale local document must mint nothing.
   - `user-file` has exactly two producers and both pass it as an argument from the site that obtained the consent (`podLineage.ts:48-59`, `syncStore.ts:1562-1580`, `SettingsPage.vue:543-548`). The restore is producer 2. Producer 1, the lineage banner, cannot present an `ours-newer` today (that verdict never blocks, so no banner is raised), but if it ever did, minting there is the same semantics and the condition needs no special case.
4. The publish needs no new plumbing. The install branch already returns `dirty: !headsEqual(remoteHeads, heads)` (`:980`), and the stamp moves `heads` past the file's, so `dirty` is true; `replaceDocWithCacheRecovery` already does `if (merged.dirty) syncService.triggerDebouncedSave()` (`syncStore.ts:987`). The Drive baseline still commits `remoteHeads`, captured from the unmigrated remote at `:939` (the bytes actually on Drive), which is the same shape the existing `migrateDoc` delta case already relies on (`:968-976`).
5. Peers then read `adopt-remote` and adopt (clean) or rebase (dirty), the propagation the guard was built for. The restored file is written as 5.0 by R1, because it is now stamped, so stale builds stay refused.
6. **One minting helper.** `export function nextLineage(prev: PodLineage | null): PodLineage` in `src/services/automerge/worker/docOps.ts`, immediately beside `docLineage` (`:56-70`), which is already documented as "the ONE place absent-or-null is decided". It returns `{ id: generateUUID(), seq: (prev?.seq ?? 0) + 1 }` (`docOps.ts` already imports `PodLineage` at `:19` and gains `generateUUID` from `@/utils/id`, which is pure and worker-safe). Three callers and no fourth: `compactDoc` (`applyAndProject.ts:1226`, replacing its inline literal), the R4 restore stamp, and `beanpodProfile.spec.ts` (see Caveats). Its doc comment states that `compactDoc` stamps it INTO the source before `Automerge.from` while the restore applies it as a change to an already-built document, and why each is right where it is.
7. Known limitation, stated in the plan and the code: a device with no prior document does not know the fleet's seq and cannot reach `user-file` (it reaches the install branch via `!currentDoc || no-local-document`, BEFORE the guard is consulted, `applyAndProject.ts:839`), so it cannot perform a durable restore. A restore is done from a device that holds the family. If that ever needs to change, the restore flow pulls first to learn the seq; not in this plan. See the Caveats for the version consequence.

### R5. The pre-compaction backup pair is written as 5.0

1. The compaction flow builds one envelope for both the manual export and the Drive safety copy (`usePodCompaction.ts:232`, used again at `:252` and `:280`), from `buildExportEnvelope()`, BEFORE `compactDoc` at `:367`. Under R1 that derives 4.0, and a stale build can open it: the deployed picker lists every `.beanpod` Drive-wide with no safety-copy filter, so a stale user reacting to "sync stopped" can pick the copy, be bound to it, and fork the family onto the backup (P6 F5).
2. `buildExportEnvelope({ compactionBackup: true })`, used ONLY by the compaction flow, forwards to `beanpodVersionFor`'s one exception (R1.2). Every other export (Settings, Export) stays purely derived. A family that has compacted is a 5.0 family from that moment; a stale build cannot open its backup, a current build can, and the rollback route is unchanged. The option is named for the INTENT rather than for a version, so it cannot express a downgrade and needs no ordering.
3. The byte-compare of the safety copy (`usePodCompaction.ts:308-352`) is unaffected: it compares what came back against what went out.
4. **What the current build already does, so nobody re-implements it.** `findBeanpodInFolder` already excludes safety copies and is the auto-selecting join/recovery entry point (`src/services/google/driveService.ts:739-757`); `rebindPodFile` already refuses to bind one (`syncStore.ts:4696-4704`). `searchBeanpodFilesGlobal`, which feeds the HUMAN picker, deliberately still shows it (`driveService.ts:745-750`), because that visibility is what makes it a rollback route a person can choose. R5 is therefore aimed at the DEPLOYED build's picker, which has none of these.

### R6. The soak gate becomes a notice; nobody is asked to enumerate devices

1. **The reading is renamed, because deleting the gate leaves a module documented as one.** `podSoak.ts:1-21` describes a gate ("SHARED by the pre-compaction gate", "the gate requires a marker from every recently-active member, and absence refuses"), and `evaluateSoak` / `SoakVerdict` are named for it. A display function living under a gate's doc comment is how the refusal gets re-added by the next person. So:
   - `evaluateSoak` becomes `membersOnOlderVersions(members, opts): OlderVersionMember[]`, where an item is `{ name, appVersion }`. `appVersion` comes from the member row (`src/stores/familyStore.ts:505-512`, written with `lastLoginAt` on every login), so the words can name the build a person last used.
   - `SoakVerdict.ok` is deleted, not kept: it is defined as `behind.length === 0` (`podSoak.ts:82`), and both of its readers (`usePodCompaction`'s step 0 and step 2d gates) are the gates being removed, so keeping it would leave a field nothing reads. This is the same rule `usePodHealth.ts:67-70` already states for itself: an unreachable guard "cannot be tested, and an untestable branch is a place for a bug to live rather than a defence against one".
   - The file header is rewritten: nothing refuses on this reading, `lineageEpoch` is still the machine test, and the per-member limitation is a property of the notice. `SOAK_WINDOW_DAYS` (`:25`), `REQUIRED_EPOCH` (`:33`), `withinWindow` and `anyDeviceReportedTooLarge` are unchanged; the filename stays.
2. `refuseSoak` and the `not-soaked` / `not-soaked.named` refusal codes are DELETED from `usePodCompaction` (`:106-126`, and `'not-soaked'` from the `RefusalCode` union at `:53`). Steps 0 and 2d of the ladder (`:162-163`, `:211-212`) lose their soak gate entirely; the reading becomes display only.
3. **One reading, one formatter, three consumers.** `usePodHealth` is already the single reactive reading (`waitingOn`, `usePodHealth.ts:72`) and `usePodCompaction` already calls `usePodHealth()` (`usePodCompaction.ts:76`). So:
   - `usePodHealth` exposes `olderVersion` (the items) and `olderVersionNames` (a computed string: each item through `fillTemplate(t('compaction.olderVersion.item'), { name, version })`, joined by `formatNames`). `waitingOn` is renamed to `olderVersion`.
   - `usePodCompaction` reads `olderVersionNames` from that same composable for both the confirm and the toast, and DELETES its own `soak()` helper (`:136-138`) and its `evaluateSoak` / `formatNames` / `SoakVerdict` imports (`:29`). A Vue `computed` re-evaluates on read, so the post-pull reading at the toast is still the current projection, which is what step 2d's comment was protecting.
   - `formatNames` stays the ONE joiner (`podSoak.ts:65-67`), rendered at `SettingsPage.vue:2050`; `SettingsPage` drops its direct `formatNames` and `fillTemplate` use for this slab and renders `olderVersionNames`.
4. The Settings section shows, when `olderVersion` is non-empty, a standing notice naming who last used an older version, and always, once, the rule that beanies can only see the version each person used most recently. The bring-your-devices-online caution (`compaction.bringDevicesOnline`, `uiStrings.ts:4307`) remains as the `v-else`, unchanged, for the rebase case. The one-slab-never-two structure at `SettingsPage.vue:2038-2055` is kept as it is.
5. The confirm dialog appends the same names when `olderVersion` is non-empty, so the person is told who at the moment they decide.
6. The completion toast names them again; `compaction.doneButBehind` (`uiStrings.ts:4408`, whose "so their changes come across safely" is no longer true under 5.0) is replaced.
7. Copy (en; beanie and zh through the usual pipeline), lifted from P6 sections 3 and 4:
   - `compaction.olderVersion.item`: `{name} ({version})`
   - `compaction.olderVersion.notice`: `{list} last opened beanies on an older version. Once you compact, a device that is still on an older version shows a message and stops syncing until it updates, and anything added on it before then is not kept. Ask them to update beanies first if you can. Nothing else changes for anyone.`
   - `compaction.olderVersion.rule`: `beanies can only see the version each person used most recently, not every device they own. Any device that has not updated will say so when it next opens, and will sync again once it does.`
   - `compaction.doneOlderVersion`: `Done. {list} last opened beanies on an older version; that device will show a message and sync again once it updates.`
   - `compaction.confirmMessage` (replaces the current text at `uiStrings.ts:4326`): `beanies will rebuild your family file without its record of past changes, so it opens faster and works on older tablets. Nothing on this device is lost, and beanies keeps a copy of the current file first. Your other devices pick up the compacted file on their own, and beanies carries across anything they changed while offline. A device still on an older version of beanies shows a message and stops syncing until it updates; anything added on it before then is not kept.`
   - `podNewerVersion.inline`, `resumeSetup.podNewerVersion`, `podAccess.error.newerVersion` and `join.error.newerVersion` all say the same thing in their own register: `This family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.`
   - Deleted: `compaction.waitingOn` (`uiStrings.ts:4374`), `compaction.refused.not-soaked` (`:4379`), `compaction.refused.not-soaked.named` (`:4386`), `compaction.doneButBehind` (`:4408`).
   - The rebase conflict sentence ("If the same thing was changed in two places, the version already saved here is the one kept") moves out of `compaction.confirmMessage` and into the "?" popover, which already has `compaction.why.record` / `.settled` / `.older` (`uiStrings.ts:4292-4306`); it becomes a fourth `compaction.why.*` key rather than a new mechanism.

### R7. Documents

1. ADR-036 addendum (or ADR-037, whichever the implementer judges cleaner): "a compacted document is a 5.0 file, and the version is derived from the document's lineage at write time". States why envelope-carried was rejected (Trap 1, with `envelopeMerge.ts:73` as the evidence), why the safety copy is 5.0, and that `guardLineage` now returns its verdict so the restore can mint on `ours-newer` alone.
2. `docs/STATUS.md`: Tier 3 entry updated; the "OWED before the flag can be flipped" list rewritten around the sequence below; the per-member limitation stated as a property of the notice, not a gate.
3. `docs/lessons.md`: two entries. "A spread carries the field you forgot to think about" (Trap 1), and "when a decision is written as a ladder in two files, check whether they have already drifted before adding a third arm" (the `payloadErrorMessageKey` / `surfacePayloadFatal` mismatch this pass found).
4. `src/config/flagRegistry.ts` comment: the gate is the fleet drain and the 5.0 refusal, not the stages.
5. `docs/plans/2026-09-06-pod-compaction-tier3.md`: a SUPERSEDED-IN-PART banner pointing here for Stage 4's gate.
6. A follow-up issue for the `unreadable` overlay copy (R3.3): a torn read is shown full-screen as "your data may be damaged, contact support" and should not be. Filed, not fixed here.

## Important Notes & Caveats

- **What the bump does not do.** It does not stop a stale device from overwriting the pod; it stops it from merging into it. The overwrite is loud, reverted by the fleet, and recoverable from the safety copy. The plan's copy says so and never claims more.
- **The person on the stale build gets no message.** The deployed poll swallows the parse error and shows stale data under "Could not refresh". There is no channel into a deployed build (release notes are bundled, no email sender). The family tells them. Do not add a mechanism that pretends to reach them.
- **The stub probe on the deployed build cannot be fixed.** R2.5 fixes the current build's copy so the NEXT stale build does not carry it. The deployed hazard needs the owner's account, a stale build, and a deliberate create with a colliding name; the mitigation is the drain, the safety copy, and Drive revision history.
- **A restore performed from a device with no local document silently returns the family to 4.0.** That path reaches the install branch via `!currentDoc || basis.kind === 'no-local-document'` (`applyAndProject.ts:839`), BEFORE the guard runs, so no verdict is computed and R4's `stampNewGeneration` never becomes true. The adopted document carries the backup's old lineage, and R1 then derives 4.0 on the next save. This is R4.7's limitation with its version consequence made explicit: the supported restore is Settings, Load another Family Data File, on a device that already holds the family. Do NOT "fix" it by deriving the version from the envelope; that is Trap 1 again. Do NOT "fix" it by stamping in the install branch unconditionally; that makes every new device mint a generation on its first sync.
- **Two compactions in a row stay 5.0** (P6 F9). The version says "compacted", the lineage seq says which generation. Do not introduce 6.0 for a second compaction. `beanpodVersionFor`'s `compactionBackup` exception exists for the same reason: a second compaction's backup must not fall back to 4.0.
- **Two owners compacting concurrently** resolve to `conflict`, still reachable and still handled (P6 F8). Unchanged, and R4.3 deliberately mints nothing when a human resolves one.
- **Do not put the version rule in `preserveLocalKeyDicts`.** A local-wins or max rule there is wrong on the adopt/rebase branches and wrong again for the rollback (P5 Trap 1, option 2). The version is derived, full stop. `preserveLocalKeyDicts` keeps its `{ ...incoming }` spread (`envelopeMerge.ts:73`) and the test in step 1 pins that it still carries `incoming.version`, so it is the DERIVATION, not the spread, that protects.
- **`guardLineage`'s new return shape is a contained change, not a refactor.** One production caller (`applyAndProject.ts:846`), the lint rule that keeps it that way (`eslint.config.js:371-399`), and `podLineage.test.ts`. It is preferred to the alternatives because the alternatives are worse: re-calling `compareLineage` at the install site is a second evaluation of one fact, and hoisting the verdict out of `guardLineage` by hand at the call site is the same thing spelled differently.
- **Force-update on native is a follow-up, not this plan.** Under 5.0 a stale device is safe, only cut off; the drain affects how many people the notice names, not safety. Android has Play In-App Updates (immediate mode); iOS has no store mechanism and needs a self-built minimum-version screen. Both are from knowledge, not re-verified against current docs (P4 was stopped for budget). File separately.
- **`beanpodProfile.spec.ts:258-265`** (env-gated diagnostic) builds a compacted copy with `Automerge.from(plain)` (`:261`) and writes it with `reEncryptEnvelope(envelope, payload)` (`:265`). It stamps NO lineage, so under R1 it would produce the forbidden artefact (a compacted 4.0). Fix it the way `compactDoc` does: spread `nextLineage(null)` into `plain` before `Automerge.from`, and pass that lineage to `reEncryptEnvelope`. Same helper, same shape, one more caller.
- **Do not deploy** as part of this work. The flag stays off. The sequence below is greg's to run.

## Assumptions

> **Review these before implementation.**

1. `compareLineage` treats a higher `seq` as newer regardless of `id` (`podLineage.test.ts`: `L('a', 2)` vs `L('b', 1)` gives `adopt-remote`). R4 depends on it. Re-read in Pass 3 at `podLineage.ts:128-141`; the function also answers `ours-newer` for `remote === null` (`:135`), which is the first-compaction restore case.
2. `docLineage()` normalises an absent `podLineage` to `null`, so a deployed build's document (no lineage concept) compares as the oldest generation. Verified by P6 F11 and re-read at `docOps.ts:56-70`.
3. The IndexedDB envelope cache may say 4.0 for a compacted document after a failed publish; nothing reads the cached version (P5 Q4), and the next write derives it. Acceptable.
4. `app_version` / `build_sha` are available in the telemetry firehose so a login-by-build query per family exists. NOT verified (P4 stopped); the implementer checks `ALLOWED_CONTEXT_KEYS` and `enrichAndRedact`, and if absent, adds nothing here (a new context key triggers the store-declaration rule) and the drain is watched via the member rows' `appVersion` in Settings instead.
5. The deployed picker path that binds a stale device to the safety copy is closed by R5; `CANONICAL_MISMATCH` (`c3a6be98:syncStore.ts:3098`) remains the detector for any fork that predates this change.
6. `OpenFileResult`'s `rawText` has no reader in `src/` (Pass 2 grep, re-checked in Pass 3: written at `syncService.ts:2084`, `:2133`, `:2176`, read nowhere). If a consumer appears outside `src/`, keep the field and set it in the catch instead of deleting it; nothing else in R2.3 changes.
7. `detail` is in `ALLOWED_CONTEXT_KEYS` (it is already passed by `usePodCompaction` at `:87` and `:348` and by `refuseSoak` at `:124`), so R3.1's `blockDetail` forwarding needs no allowlist change and no store-declaration update. The implementer confirms before writing the forward.

## Approach

The centre of the change is R1: one derivation, `beanpodVersionFor`, reached by both writers, and the version becomes a fact about the payload rather than a field that rides along. Everything else either widens a reader and deletes its duplicates (R2), routes one new question through a base-class member and three exhaustive tables so the existing dispatch sites answer correctly without being touched (R3), makes the restore mint a generation inside the branch that already adopts (R4), raises the backup pair (R5), or deletes a gate and replaces it with words (R6).

Pass 2 made the shape smaller in four places, each one where the code already had the mechanism: the error class routes through `payloadErrorMessageKey` rather than overriding a getter; the restore stamps inside `mergeRemoteEnvelope` rather than through a new RPC; the three picker readers collapse into `parseBeanpodV4` rather than each learning a new version set; and the notice renders from `usePodHealth`'s existing single reading.

Pass 3 changed five things about the long-term shape rather than the size:

- `guardLineage` returns its verdict, because the condition R4 needs is not otherwise readable at the one place it may be read.
- The stamp is a flag from the guarded block, because the install branch is shared with the first-load adopt and a literal reading would make every new device mint a generation.
- The three payload-failure decisions read tables keyed on ONE discriminator, because the two existing ladders have already drifted and a fourth hand-written arm guarantees a fifth divergence.
- `beanpodVersionFor` takes an intent, not a version floor, and `createBeanpodV4` calls it too, so there are no version literals left outside it.
- The worker/client result shape for `exportEncryptedPayload` becomes one type in `protocol.ts`, because two hand-written copies of it can drop `lineage` on the worker side with no compile error and write a compacted pod as 4.0 silently.

Order of implementation, each step green before the next:

1. R2.1 type and known-set; R1: the `ExportedPayload` type in `protocol.ts`, the worker return, `beanpodVersionFor`, `reEncryptEnvelope`'s and `createBeanpodV4`'s signatures, all three writers; `beanpodProfile.spec.ts` with `nextLineage`. Tests: `fileSync.test.ts` 5.0 accepted, 6.0 typed; a real-`reEncryptEnvelope` save-path test asserting the `kept-local` republish carries 5.0 (the Trap 1 pin); `envelopeMerge.test.ts` asserting `preserveLocalKeyDicts` still copies `incoming.version` (so the derivation, not the spread, is what protects); a `beanpodVersionFor` table test covering null lineage, present lineage, and `compactionBackup` over each.
2. R3.1 to R3.6: the `needsAppUpdate` and `blockDetail` members, the error class, `payloadErrorKind` plus the three tables, the two `payloadFailureSurface` rewrites. Tests: a 6.0 file lands on `podNewerVersion` at BOTH `payloadErrorMessageKey(e)` and `e.inlineMessageKey` (the divergence pin); `reportPayloadFailure` emits nothing for it; `surfacePayloadFatal` uses the new overlay key; a `parse` `CorruptPayloadError` still pages, so the torn-read signal is not lost; `noteRemoteUnreadable` reports it at `warning` with `error_code: 'parse'` and `detail: version=6.0`, and does not latch; no `clearCache` RPC; `doSave` refuses.
3. R2.3, R2.5, R2.6, R3.7: collapse the three picker readers, make the stub probe structural, delete `detectFileVersion`, carry `payloadError` out to all four callers. Tests: `connectStorage.test.ts`, a `5.0` file resolves `adopt-existing` and a `6.0` file resolves `adopt-existing`; a picker load of a 6.0 file surfaces `podNewerVersion` copy in `SettingsPage` (where today it surfaces NOTHING), in `LoadPodView`, and in `JoinPodView`.
4. R3.8 to R3.10: the `podAccess` code plus classifier arm plus `POD_ACCESS_SEVERITY[code]` in the rebind report; `joinCodeForBlocker` and its two call sites. Tests: `podAccess.test.ts` classifies the typed error and its two severity tables agree (the existing loop at `:118-138` covers the new row); a rebind onto a 6.0 file returns the new code and does not page; `useJoinFlow` maps both the decrypt and the pick-and-load path to `FILE_NEWER_VERSION`, and a `PodLineageError` through the same helper returns `null`.
5. R4: `guardLineage` returning `{ action, verdict }`, `nextLineage` in `docOps.ts`, the `stampNewGeneration` flag and the stamp inside the install, `compactDoc` switched to the helper. Tests: "restore on A, poll on B, B adopts rather than republishes"; "choosing the live compacted file over a stale local document mints nothing"; "the LineageBanner's conflict adopt mints nothing"; "a first-load adopt with no local document mints nothing"; "the stamped adopt returns `dirty: true`, so the caller publishes".
6. R5: `buildExportEnvelope({ compactionBackup: true })`. Test: the safety copy `aux.write` body and the manual export carry `"version":"5.0"` while the family's ordinary Settings export before compaction carries 4.0.
7. R6: gate deletion, the `membersOnOlderVersions` rename and header rewrite, `usePodHealth.olderVersion` + `olderVersionNames`, Settings, confirm, toast, strings; delete the four keys; `npm run translate`. Tests: the ladder never refuses on soak; the notice names people with versions; the confirm appends names; the toast names them; `usePodCompaction` no longer imports the reading at all.
8. R7 documents; Help Center article; CHANGELOG.
9. Full gate; commit; push. No deploy.

DRY audit, each entry naming the ONE thing and where it lives:

- One lineage mint: `nextLineage` in `worker/docOps.ts`, beside `docLineage`, used by `compactDoc`, the restore stamp and the diagnostic.
- One version derivation: `beanpodVersionFor` in `fileSync.ts`, reached by `reEncryptEnvelope` AND `createBeanpodV4`. No version literal exists anywhere else after this change.
- One known-version set with ONE reader: `parseBeanpodV4`. `detectFileVersion` and the three duplicated picker branches are deleted rather than taught the set.
- One boundary shape for the export RPC: `ExportedPayload` in `protocol.ts`, imported by the worker function and the client wrapper instead of each hand-writing it.
- One "newer than I understand" question: `PayloadLoadError.needsAppUpdate`, answered by the class and read by `payloadErrorKind`, `classifyDriveFailure` and `joinCodeForBlocker`. No `instanceof UnsupportedBeanpodVersionError` anywhere outside the class itself.
- One payload-failure discriminator: `payloadErrorKind`, with three exhaustive tables over it (inline key, overlay key, is-it-an-incident) replacing three hand-written ladders that had already drifted.
- One inline-copy resolver: `payloadErrorMessageKey`, which `PayloadLoadError.inlineMessageKey` already delegates to. No subclass overrides it.
- One picker-failure carry: `payloadError` on the result, the field `decryptPendingFile` already returns and both pages already render, now reaching all four callers.
- One pod-access taxonomy: `POD_ACCESS_ERRORS` plus `POD_ACCESS_SEVERITY`, extended by one row rather than by an arm at a call site, with their agreement already pinned by `podAccess.test.ts:128`.
- One join mapper: `joinCodeForBlocker`, which owns the `instanceof` and the `keyMayBeWrong` guard so neither call site re-derives them.
- One reading of who is behind: `membersOnOlderVersions`, surfaced once through `usePodHealth`, consumed by the notice, the confirm and the toast.
- One name joiner: `formatNames`.
- One lineage decision: `guardLineage`, now returning both halves of its answer so no caller recomputes either.

Nothing new is added where an existing pattern already has the right shape, and three things pass 1 proposed to add (a worker op, a protocol message, a getter override) are still not added.

Error handling: every failure path already exists and is classified; this plan changes classifications and closes places where a classification was DROPPED (`loadFromNewFile`'s bare `{success:false}` at all four callers, `loadFromGoogleDrive`'s raw English `error.value`, `manualImport`'s developer string rendered as UI). It adds no bare catches. The one new throw (R3.5) is typed at the source so no caller has to classify it, and the three catches in R2.3 that used to synthesise an "Unsupported file version" string now re-surface the typed error instead of inventing a second vocabulary for it. `beanpodVersionFor`, `payloadErrorKind`, `joinCodeForBlocker` and `nextLineage` are pure. The restore stamp runs inside the worker's existing single-assignment discipline (compose fully, then install), so a throw leaves the document untouched.

## Files Affected

- `src/types/syncFileV4.ts` (`BeanpodVersion`)
- `src/types/sync.ts` (`needsAppUpdate` and `blockDetail` on `PayloadLoadError`, `UnsupportedBeanpodVersionError`, `PodBlockMessageKey`, `PayloadErrorKind` + `payloadErrorKind` + `PAYLOAD_INLINE_KEY`, `payloadErrorMessageKey` rewritten over the table)
- `src/services/sync/fileSync.ts` (`beanpodVersionFor`, known set, parse throw, `reEncryptEnvelope` and `createBeanpodV4` signatures; `detectFileVersion` DELETED)
- `src/services/sync/connectStorage.ts` (`isStubBeanpod` structural; `detectFileVersion` import removed)
- `src/services/sync/podLineage.ts` (`guardLineage` returns `{ action, verdict }`)
- `src/services/sync/syncService.ts` (`doSave`, the three picker readers collapsed, `OpenFileResult.payloadError`, `rawText` removed, `fetchAndMergeRemote` wrap, `noteRemoteUnreadable` forwards `blockDetail`)
- `src/stores/syncStore.ts` (`createNewFile` passes the lineage, `buildExportEnvelope` + `compactionBackup`, `loadFromNewFile` / `loadFromDroppedFile` / `manualImport` carry `payloadError`, `loadFromGoogleDrive` translated error + `payloadError`, `rebindPodFile` severity from the table)
- `src/utils/podAccess.ts` (`FILE_NEWER_VERSION` code, registry entry, severity entry, `classifyDriveFailure` arm)
- `src/services/automerge/worker/protocol.ts` (the `ExportedPayload` result TYPE only; still no new op)
- `src/services/automerge/worker/docOps.ts` (`nextLineage`)
- `src/services/automerge/worker/applyAndProject.ts` (`exportEncryptedPayload` returns the lineage; `compactDoc` uses `nextLineage`; the `stampNewGeneration` flag and the `ours-newer` x `user-file` stamp at the install)
- `src/services/automerge/worker/docClient.ts` (return type of `exportEncryptedPayload`, now imported rather than restated)
- `src/utils/payloadFailureSurface.ts` (`PAYLOAD_OVERLAY_KEY` and `PAYLOAD_IS_INCIDENT` tables replacing the two ladders)
- `src/composables/useJoinFlow.ts` (`FILE_NEWER_VERSION` entry, `joinCodeForBlocker`, its second call site in `doPickAndLoad`)
- `src/composables/usePodCompaction.ts` (delete `refuseSoak`, the `not-soaked` code and the local `soak()`; read the names from `usePodHealth`; `compactionBackup` on the backup build; note update)
- `src/composables/usePodHealth.ts` (`olderVersion`, `olderVersionNames`)
- `src/services/pod/podSoak.ts` (`evaluateSoak` renamed to `membersOnOlderVersions`, returns the item array; `SoakVerdict` deleted; header rewritten)
- `src/pages/SettingsPage.vue` (notice and rule; the missing failure arm on `handleLoadFromFileConfirmed`; `handleManualImport`'s bare `'Import failed'`)
- `src/components/login/LoadPodView.vue` (the `payloadError` arm in `handleLoadFile`)
- `src/components/login/JoinPodView.vue` (the `payloadError` arm in `handleLocalLoadResult`, covering both of its entry points)
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via the pipeline)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`
- NOT changed, and deliberately: `src/services/sync/envelopeMerge.ts` (the spread stays; the derivation is what protects), `src/components/common/LineageBanner.vue`, `src/composables/useLoginFlow.ts`, `src/pages/LoginPage.vue`, `src/components/login/ResumePodSetup.vue`, `src/composables/useBiometricSignIn.ts` (all inherit the copy through `payloadErrorMessageKey`), `eslint.config.js` (the lineage import ban already scopes the guard to the one file this plan edits)
- Tests: `fileSync.test.ts`, `connectStorage.test.ts`, `envelopeMerge.test.ts`, `fetchAndMergeRemote.test.ts`, `podAccess.test.ts`, `podLineage.test.ts` (the `guardLineage` return shape), a new save-path version test that does NOT mock `fileSync`, `rebase.test.ts` or a new `restoreStamp.test.ts`, `usePodCompaction.test.ts` (its `usePodHealth` mock at `:34-36` must now be typed against `ReturnType<typeof usePodHealth>`), `usePodHealth.dueSignal.test.ts`, `podSoak.test.ts`, `useJoinFlow` tests, `LoadPodView.test.ts`; delete the dead `detectFileVersion` mocks P5 Q9 lists along with the function
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
  - `pod-load-failure` for the new error is ALREADY correct in its classification and needs no change there: `PayloadLoadError.latches` is already `false` for `step === 'parse'` (`src/types/sync.ts:320-322`), and `noteRemoteUnreadable` already reports every non-latching blocker at `severity: 'warning'` with `error_code: err.step`, under a comment that already names "a pod from a newer build" (`syncService.ts:127-142`). That half is a TEST that pins it, not a change.
    - It does need ONE line: today the context is `{ action, error_code }` only (`syncService.ts:140`), so a 6.0 refusal is indistinguishable in CloudWatch from a torn read, which is the one query this plan says it needs. `noteRemoteUnreadable` forwards `detail: err.blockDetail` when present (R3.1). The version rides in `detail`, never in `message`, so the (surface, message) dedup bucket is unchanged. No `instanceof` is involved, so the DRY rule holds.
  - `pod-compaction` `published` (existing) gains `detail: version=5.0` so the rate of 5.0 publishes is countable.
  - No new context key: `detail` is already carried by `usePodCompaction` (`:87`, `:348`) and is therefore already allowlisted and already declared. Assumption 7 has the implementer confirm before writing the forward.
- **Failure modes covered**: a compacted pod written as 4.0 (impossible by construction under R1, pinned by the save-path test, and the one remaining silent route, a dropped `lineage` across the worker boundary, is closed by the shared `ExportedPayload` type); a stale overwrite (the `kept-local` count); a device refusing a 5.0 or 6.0 file (`parse` at warning, non-latching, with the version in `detail`); a restore that did not stick (peers would log `kept-local` instead of `adopted`; the R4 test pins the opposite); a new device minting a spurious generation on first sync (the first-load-adopt test pins that it does not; in the field it would show as a burst of `adopted` across the fleet after one device joined); a picker load that fails with no message (now impossible: the three catches carry `payloadError` and all four callers render it).
- **Success-path signal**: `published` with `version=5.0`; `adopted` at both termini after a restore.
- **Critical vs telemetry**: nothing about a newer version pages. Three sites are made to agree on that through ONE member: `PAYLOAD_IS_INCIDENT['needs-update']` is `false`, so `reportPayloadFailure` returns early; `rebindPodFile` reads `POD_ACCESS_SEVERITY['FILE_NEWER_VERSION'] === 'warning'` instead of its hardcoded `critical`; `JOIN_ERRORS.FILE_NEWER_VERSION` is `severity: 'warning'`, not the `critical` that `FILE_CORRUPT` carries. A genuine torn-read `parse` failure still pages, because it is still an incident.
- **Privacy**: no document content, no names, no filenames in any event. The version string is a two-character constant.

## Acceptance Criteria

- [ ] A never-compacted family writes a byte-identical 4.0 envelope before and after this change (fixture test), including the `createNewFile` path now that its literal is gone.
- [ ] The compaction publish writes 5.0; the `kept-local` republish writes 5.0; the safety copy and the compaction export write 5.0; the ordinary Settings export of a never-compacted family writes 4.0.
- [ ] `beanpodVersionFor` is the only place a version string is chosen: no `'4.0'` or `'5.0'` literal remains in a writer (`createBeanpodV4` and `reEncryptEnvelope` both call it).
- [ ] `exportEncryptedPayload`'s result shape is declared ONCE, in `protocol.ts`, and both the worker function and the `docClient` wrapper reference it.
- [ ] `parseBeanpodV4` accepts 5.0 and throws `UnsupportedBeanpodVersionError` (`instanceof PayloadLoadError`, not `CorruptPayloadError`, `latches === false`, `keyMayBeWrong === false`, `needsAppUpdate === true`) for 6.0.
- [ ] `payloadErrorMessageKey(err)` and `err.inlineMessageKey` return the SAME key for the new class (the divergence pin), and no subclass overrides `inlineMessageKey`.
- [ ] All three payload-failure decisions (inline key, overlay key, is-it-an-incident) are exhaustive tables over `PayloadErrorKind`, so adding a kind fails the build in three places. A test asserts each table has an entry for every kind.
- [ ] Every surfacing site shows `podNewerVersion` copy for a 6.0 file; no site wipes the cache or re-prompts for a password (asserted, not inferred, at the six sites P5 Trap 4 lists).
- [ ] Picking a 6.0 file from Settings shows a message; today it shows nothing at all. The same file in `LoadPodView` and in `JoinPodView` shows the same message rather than `auth.fileLoadFailed`, and `manualImport` no longer renders a raw English developer string.
- [ ] Nothing about a newer version pages Slack: `reportPayloadFailure` is silent for it, the rebind report is `warning`, and the join code is `warning`. A `parse` `CorruptPayloadError` still pages. A 6.0 refusal reaches CloudWatch with `detail: version=6.0`.
- [ ] `detectFileVersion` no longer exists, and no production file imports it.
- [ ] `isStubBeanpod` is false for any JSON object with a string `version`; a 5.0 file at a colliding name resolves `adopt-existing`.
- [ ] Restore on A, poll on B: B adopts. Choosing the live file over a stale local document mints no generation; the LineageBanner's conflict adopt mints no generation; a first-load adopt on a device with no local document mints no generation. No new worker RPC and no new protocol OP was added.
- [ ] `guardLineage` returns `{ action, verdict }` and has exactly one production caller.
- [ ] The ladder has no soak refusal; the notice, confirm and toast name people with the version they last used, all three from `usePodHealth`; the four deleted keys are gone from `uiStrings.ts` and `zh.json`; `podSoak.ts`'s header no longer describes a gate.
- [ ] No string asks anyone to open beanies on every device.
- [ ] `beanpodProfile.spec.ts` stamps through `nextLineage` and passes the lineage.
- [ ] Help Center article added and matches the shipped copy in all four registers.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key.
- [ ] Documents in R7 updated, including the follow-up issue for the `unreadable` overlay copy; CHANGELOG entry.
- [ ] Full gate green (vue-tsc, eslint, stylelint, vitest); every new test mutation-checked against the specific regression it pins.

## Testing Plan

1. Unit, as listed under Approach, each mutation-checked. The six that matter most, and the mutation each must fail on:
   - Trap 1 pin: must fail when `reEncryptEnvelope` reads `envelope.version` instead of the lineage.
   - Boundary pin: must fail when the worker's `exportEncryptedPayload` stops returning `lineage` (a `4.0` write for a compacted document, with no type error to catch it).
   - Divergence pin: must fail when the `needs-update` row is removed from `PAYLOAD_INLINE_KEY` and re-added as a subclass `inlineMessageKey` override.
   - R4 stamp pin: must fail when the stamp is skipped; must ALSO fail when it is applied on every `user-file` adopt (the conflict case); must ALSO fail when it is applied at the install branch unconditionally (the first-load case).
   - Stub-probe pin: must fail when the `!== '4.0'` returns.
   - Table-exhaustiveness pin: must fail when a sixth `PayloadErrorKind` is added without rows in all three tables.
2. **The version tests must not run against a mocked `fileSync`.** `reEncryptEnvelope` is currently mocked in thirteen suites, most returning the literal `'{"version":"4.0"}'`: `createNewFile.test.ts:213`, `syncAutoSave.test.ts:213`, `syncStore.verifyPodAccess.test.ts:188`, `syncStore.migrate.test.ts:136`, `selectNativeLocalFile.test.ts:43`, `saveFailureTracking.test.ts:18`, `persistedBytes.test.ts:18`, `syncStore.saveStatus.test.ts:89`, `syncStore.bannerVisibility.test.ts:127`, `syncStore.openBaselineTerminus.test.ts:93`, `authStore.passwordRotation.test.ts:106`, `syncStore.export.test.ts:54`, `fetchAndMergeRemote.test.ts:28`. A Trap 1 pin written in any of those files would assert the MOCK's hardcoded 4.0 and stay green through the exact regression it exists to catch. The new save-path test either lives in a file that does not mock `@/services/sync/fileSync`, or uses `importActual` for it, and the test says so in a comment. Similarly, `usePodCompaction.test.ts:34-36` mocks `usePodHealth` returning only `{ canCompactPod }`; type its return as `ReturnType<typeof usePodHealth>` so R6.3's new fields cannot silently arrive as `undefined`.
3. Local two-browser soak on `npm run dev` (flag on in dev by default): compact on A; B (offline with an edit) reconnects and rebases; reload A and confirm B's edit arrived (the publish-restore pin from `e395b1d4`); confirm the notice names B's member with a version before compacting.
4. Restore drill: restore the safety copy on A through Settings, Load another Family Data File; confirm B ADOPTS rather than reverting (watch B's console for `open terminus adopted`, not `kept-local`); confirm the restored family then compacts again cleanly and stays 5.0. Then sign in on a THIRD, cache-free browser profile and confirm it adopts without minting (no `adopted` burst on A and B afterwards).
5. Newer-version drill on the CURRENT build, which is the half CI cannot fake convincingly on its own: hand-edit a `.beanpod` to `"version":"6.0"` and walk it through all five surfaces (Settings picker, `LoadPodView` picker, `JoinPodView` drop zone, a Drive rebind, a join link). Each must show the update message, none may clear data or re-prompt for a password, and CloudWatch must show a `warning` with `detail: version=6.0` and no page.
6. The deploy-and-enable sequence, greg's to run, from P6 section 7:
   1. Land this plan, flag OFF. Every pod on Earth is still 4.0.
   2. Deploy web and native. Nothing user-visible changes.
   3. Watch the drain (login-by-build query if assumption 4 holds, else the member rows' `appVersion` in Settings on greg's family). There is no safety threshold to wait for under 5.0; the drain decides how many people the notice will name.
   4. On-device acceptance on greg's family BEFORE enabling for anyone else: the Tab A9+/A7 on the new build adopts and opens in the measured ~50MB; a device pinned to `c3a6be98` (the old open-testing APK, or a browser profile with the service worker disabled) shows stale data under "Could not refresh", an edit plus save overwrites the pod as 4.0, a current device republishes it as 5.0, and the stale device is refused again; a restore from a third device is ADOPTED by the fleet. Nothing in CI can exercise a pinned old build against a live Drive file; this run is the acceptance criterion for the mechanism itself.
   5. Enable `podCompaction` for greg's family via the existing override, then generally.
7. Later, optional: once the stale population reads ~0 for a release cycle, consider writing 5.0 for every family and closing the deployed stub-probe hazard for good.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the premise audit; R1 document-derived version as the centre; R2 to R7 as the audit's four required changes plus the error class, the copy, and the documents.
- **Pass 2 (DRY + error handling)**: verified every reuse claim in the tree. Removed three additions the code already had a place for (a worker op for the restore stamp, a subclass `inlineMessageKey` override, a widened `detectFileVersion`), collapsed the three duplicated picker readers and deleted `detectFileVersion` and the unread `rawText` with them, routed the new "newer than I understand" question through ONE base-class member read by five dispatchers, moved the rebind arm into `classifyDriveFailure` and the structured `POD_ACCESS_ERRORS` registry, gave the join flow one mapper instead of two, collapsed `SoakVerdict` to its array and rendered the notice from `usePodHealth`'s existing single reading, and closed a genuine silent failure the plan had not covered: a picked file with an unreadable version shows the user NOTHING in Settings today.
- **Pass 3 (Sustainability)**: found R4's stamp condition unreadable where the plan put it (`guardLineage` discards the verdict, and its install branch is shared with the first-load adopt, so a literal reading would make every new device mint a generation), found that the two payload-failure ladders R3 was about to extend have ALREADY drifted and replaced them with one discriminator plus three exhaustive tables, replaced the `atLeast` "floor" that silently downgrades at the next bump with an intent-shaped option, folded `createBeanpodV4`'s literal into the same single derivation, made the worker/client export shape one type so a dropped `lineage` is a compile error rather than a silent 4.0, extended the silent-failure fix to all four callers of `loadFromNewFile`, gave the join mapper ownership of its own narrowing, made the "version rides in `detail`" observability promise actually implementable, listed the thirteen suites whose `reEncryptEnvelope` mock would keep the Trap 1 pin green, and renamed the soak reading so a deleted gate does not leave its doc comment behind.
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

### Pass 3 review prompt

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

</details>
