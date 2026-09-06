## Pass 4 changes

- **R6's notice would have printed "Sam (undefined)" for every person it names, so the version is dropped from the copy and `membersOnOlderVersions` returns names.** `appVersion` and `lineageEpoch` are written by the SAME function on the SAME login (`src/stores/familyStore.ts:505-512`), and a member is named only when `(m.lineageEpoch ?? 0) < REQUIRED_EPOCH` (`src/services/pod/podSoak.ts:79`), which is exactly "no build that writes `appVersion` has ever written this row". The field's own doc comment says so in as many words: "DIAGNOSTICS ONLY, never load-bearing in the soak gate, because it is absent on exactly the devices the gate is about" (`src/types/models.ts:347-352`). The audit's P4 note that a notice could say "Sam last used beanies 0.16" is wrong for the only population that can be named. `compaction.olderVersion.item` is deleted from the plan, the reading returns `string[]` exactly as `evaluateSoak(...).behind` does today, and the rule sentence is recast to a fact that is true (beanies sees people, not devices). This also removes a per-item `fillTemplate` and keeps `formatNames` the ONE joiner.
- **R4.3's `guardLineage` signature change breaks two test files the plan did not name, and one of them fails SILENTLY.** `lineageBasis.test.ts:22` hoists `guardHook.force` as `string | null` and `:28` returns it in place of the guard's result; `:126` sets `force = 'rebase'`. With the call site destructuring `{ action }`, a forced string yields `action === undefined`, so the one test that pins "a rebase must never become a merge" would stop forcing a rebase and pass for the wrong reason. `lineageProtectsPeerEdits.test.ts:113` and `:132` assert `toBe('rebase')` / `toBe('adopt')` directly. Both are now in the files list with the exact edit.
- **The `payloadError` arm must sit BEFORE the `syncStore.error` arm, or it can never be reached.** `syncService`'s three catches set `lastError: (e as Error).message` (`syncService.ts:2090`, `:2135`, `:2178`), `syncStore.ts:500` mirrors `lastError` into `syncStore.error`, and both render sites test that ref first: `LoadPodView.vue:530-531` and `JoinPodView.vue:196-198`. R3.7 now states the order and, so the two channels cannot disagree at all, has the three catches set `lastError` to the TRANSLATED inline key for a blocker (`useTranslationStore` is already imported and used in that file at `syncService.ts:62`, `:492`).
- **R3.8's claim that the new severity row is "covered by an existing test the moment it exists" is false.** `podAccess.test.ts:22-30` defines `ALL_CODES` as a HAND-WRITTEN array, so the two agreement loops at `:120` and `:127` would simply skip `FILE_NEWER_VERSION`. R3.8 now requires adding the code to `ALL_CODES` plus a one-line completeness assertion against `Object.keys(POD_ACCESS_ERRORS)`, which closes the drift permanently instead of for one row.
- **The Observability promise "`published` gains `detail: version=5.0`" is not emittable honestly where the plan put it.** `usePodCompaction` never sees the envelope version: `reEncryptEnvelope` builds a local object and discards it (`fileSync.ts:214-222`), and the long-lived in-memory envelope keeps its OLD version, which Assumption 3 already records as stale. A hardcoded `version=5.0` would report 5.0 during the exact regression it exists to detect. Replaced with a transition-gated `pod-version` event emitted by `doSave`, the one place that holds both the lineage and the derived version (R1.8).
- **Assumptions 4 and 7 are resolved rather than left for the implementer.** `build_sha` is in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:98`) and is auto-injected onto EVERY event (`:499`), so the login-by-build drain query exists today with no new key; `app_version` is not a context key and is not needed. `'detail'` is allowlisted at `diagnosticContext.ts:185`, so R3.1's forward and R1.8's event need no store-declaration change.
- **`payloadErrorKind`'s arm ORDER is load-bearing and was unstated.** `UnsupportedBeanpodVersionError` has `step === 'parse'` AND `needsAppUpdate === true`, so `needs-update` must be tested before `unreadable` or every 6.0 file resolves to `podUnreadable.inline` and the new copy is dead. Written out as code in R3.3, with the mutation the test must fail on.
- **`classifyDriveFailure`'s new arm goes FIRST, before the `navigator.onLine` check** (`src/utils/podAccess.ts:128-131`). A typed, definite classification must not be overridden by ambient network state; an offline flag flipping mid-read would otherwise turn "update beanies" into "you are offline".
- **Moving the mint into `docOps.nextLineage` leaves `generateUUID` unused in `applyAndProject.ts`.** Its only use is the literal at `:1226` that R4.6 replaces (`grep` confirms one occurrence), so the import at `:29` AND the eleven-line warning comment above it (`:24-28`, "NOT a bare `crypto.randomUUID()`", which explains a real field failure on a non-secure origin) must MOVE to `docOps.ts`, or the reasoning is lost and the build fails on an unused import.
- **`createBeanpodV4`'s new positional parameter breaks two test files the plan did not name**: `src/services/sync/fileSync.test.ts:38` and `:53`, and `src/services/sync/__tests__/fileSync.writerVersion.test.ts:12`. Added.
- **R6.5 needs no confirm-API change**, and now says so: `confirm()` already takes `detail?: string`, documented as "Additional detail text shown below the message (plain string, not translated)" (`src/composables/useConfirm.ts:8-9`). The names go there as an already-translated string.
- **R6.7 is now complete copy.** Every key the plan adds or changes carries both `en` and `beanie` per CLAUDE.md. Three keys the plan referred to without naming are named and written: the fourth popover key (`compaction.why.conflict`), the replacement for `SettingsPage`'s bare `'Import failed'` (`settings.importFailed`), and the second bare English string on that same line, `manualImport`'s `'Encrypted file requires password'` (`settings.importNeedsPassword`). No string asks anyone to open beanies on every device.
- **The test files R6 actually breaks are named.** `usePodCompaction.test.ts:452-475` and `:476-497` assert the soak REFUSAL and must be deleted with the gate; the `t` stub at `:47-52` special-cases two keys that no longer exist; `podSoak.test.ts` asserts `v.ok` at eight sites. `connectStorage.test.ts:34-37` and `:212` drive `isStubBeanpod` THROUGH the `detectFileVersion` mock, so those tests are rewritten rather than having a mock deleted.
- **R6 said `SettingsPage` drops `fillTemplate` while the notice it renders holds a `{list}` placeholder, which cannot both be true.** Resolved by putting the fill in `usePodHealth` as `olderVersionNotice`, which is also more DRY: the Settings slab and the confirm dialog show the SAME sentence, so it is composed once instead of at two sites. The toast keeps its own `fillTemplate` because its key differs.
- **The completion toast holds a SECOND hand-rolled joiner and a comment that this plan makes false.** `usePodCompaction.ts:443` joins with `after.behind.join(', ')` rather than `formatNames`, so "one name joiner" was not true before this change; and the comment at `:437-442` says a person on an older build "will merge across lineages, the fleet-wide destruction the soak gate exists to prevent", which under 5.0 is exactly what can no longer happen. Both are now named in R6.6, the comment as a rewrite rather than a deletion.
- **R2.5 is restated as "no JSON parse at all".** The stub probe returning `true` only for null / empty / whitespace / `{}` means it never parses, which is the same reason R2.3 gives for deleting the pre-call: a second full parse of a multi-megabyte file to read one field.
- Everything else was checked and stands. R1 to R7's substance, the four audit-required changes, the DRY audit and the deploy sequence are unchanged.

---

# Plan: Compacted pods are beanpod 5.0, and the soak gate becomes a notice

> Date: 2026-09-06
> Related issues: None (direct implementation; tracker #90 Tier 3 follow-up)
> Plan file: `docs/plans/2026-09-06-compacted-pod-v5-pass4.md` (Pass 4, the final pass, of `docs/plans/2026-09-06-compacted-pod-v5.md`)
> Premise audit: `docs/plans/2026-09-06-compacted-pod-v5-audit/README.md` (P1, P5, P6 complete; P2/P3 and P4 checked directly). Every file:line below was pinned by the audit at `33dbef34` (current) or `c3a6be98` (deployed), or re-verified in Pass 2, Pass 3 or Pass 4 against the working tree.
> Supersedes: the soak gate half of `docs/plans/2026-09-06-pod-compaction-tier3.md` (Stage 4, R3/R4). Stages 1 to 3 are unchanged.

> **No GitHub issue created.** This plan was approved for direct implementation.

## User Story

As a family owner, I want to compact our family file without having to find every device anyone in the family has ever opened beanies on, so that the file opens on an old tablet and nobody's data is silently damaged by a device that has not updated yet.

## Context

Compaction rewrites the family document without its history. A compacted document shares no ancestry with the original, so a device on a build that predates the lineage guard (production is `c3a6be98`, 0.16, which has no lineage concept) CRDT-merges the two, deterministically destroys the compactor's edits, and carries the new lineage id forward so that every guarded device then reads the corruption as clean (ADR-036).

Stage 4's defence was a soak gate: refuse to compact until every recently active member has logged in on a guard-honouring build. The gate is per member (`lineageEpoch` on the member row) and cannot see a person's other devices, so its instruction, "open beanies once on every device you use it on", is unverifiable and, per greg, an impossible ask for a normal family. Once Sam logs in once on a current build, Sam passes forever, and Sam's old tablet is still a hazard the gate cannot see.

The audit established a structural replacement. The deployed build's `parseBeanpodV4` (`c3a6be98:src/services/sync/fileSync.ts:73-74`) throws on any envelope `version` other than `'4.0'`, before decrypt, before the worker, and before adopting the remote marker or key dicts; and every Automerge merge entry point in the deployed build sits behind it (P1). So a compacted pod written as **version 5.0** cannot be merged by a pre-guard build. No read-path failure wipes the cache, deletes a credential, or loops on a password prompt (P1, P6 section 2). The catastrophic case is gone by construction.

What a stale build can still do is **overwrite** the compacted pod, by two mechanisms (P1 F2, F1): any save on a warm-cache stale device (the baseline skip, not the swallowed throw), and the owner creating a same-named family on a stale build (the deployed stub probe reads a 5.0 file as an empty placeholder). Both are loud, both are bounded by the fleet's `ours-newer` to `publish-local` self-heal (`src/services/sync/podLineage.ts:176`), and both cost the same: whatever the stale device wrote, plus the wrapped key of any member who joined after that device last synced, until the republish lands. The bump therefore does not replace draining the fleet; it changes what a straggler can do from "silently corrupt everyone" to "loudly revert until the fleet pushes back". The deploy sequence stays the primary control, and the soak gate stops pretending to be one.

The audit also found that the obvious implementation is wrong. Stamping `'5.0'` on the envelope at compaction and letting the spread carry it lasts exactly one round trip: the four `kept-local` termini adopt the REMOTE envelope (including its version) and republish the LOCAL compacted document under it (P5 Trap 1, P6 F1, found independently). Pass 2 re-verified the mechanism: `preserveLocalKeyDicts` returns `{ ...incoming, ...key dicts }` (`src/services/sync/envelopeMerge.ts:68-96`, the spread at `:73`), so `version` is carried from the remote by a spread nobody was looking at. The version must describe the payload, and the payload's lineage lives in the document. That is the design centre of this plan.

## Requirements

### R1. The envelope version is derived from the document, never carried by spread, and derived in ONE place

1. `exportEncryptedPayload` (`src/services/automerge/worker/applyAndProject.ts:1039-1045`, client `src/services/automerge/worker/docClient.ts:1317`) returns `lineage: docLineage(doc)` alongside `{ payload, heads }`. Read from the SAME `doc` const the heads are read from (`applyAndProject.ts:1040`), so it describes exactly the bytes being exported.
   - **The result shape becomes ONE exported type in `protocol.ts`**, `export interface ExportedPayload { payload: string; heads: Heads; lineage: PodLineage | null }`, imported by both the worker function and the `docClient` wrapper. Today the two sides hand-write the same object literal independently (`applyAndProject.ts:1039` and `docClient.ts:1317`) and `protocol.ts` types only the op NAME, so nothing cross-checks them. If the client learns `lineage` and the worker forgets to return it, the destructure yields `undefined`, typed `PodLineage | null` by the lying declaration, and every save writes 4.0 for a compacted pod: the exact forbidden artefact, silently. This is a TYPE in `protocol.ts` (which already exports `Heads` at `:23`), not an op; the "no new op crosses the boundary" rule (R4.2) is unchanged.
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
4. **`createBeanpodV4` calls the same helper** (`fileSync.ts:27-52`), taking `lineage: PodLineage | null` immediately after `encryptedPayload`. Its sole production caller is `createNewFile` (`src/stores/syncStore.ts:2284`), which already holds `exportEncryptedPayload()`'s result one line above at `:2283`, so passing it is free. The old literal `'4.0'` (`fileSync.ts:40`) was correct only because a create-time document has no lineage, and nothing enforced that; the create path already has an `adopt-stub` sibling (`connectStorage.ts:234-236`), so a future reuse over an existing document would have written a compacted payload labelled 4.0. A new family still writes 4.0, now because the document says so rather than because a literal does. After this there are ZERO version literals outside `beanpodVersionFor`.
   - The new parameter sits in the middle of a seven-argument positional signature, so it breaks the three existing positional callers in tests: `src/services/sync/fileSync.test.ts:38`, `:53`, and `src/services/sync/__tests__/fileSync.writerVersion.test.ts:12`. All three are compile errors (`Record<string, WrappedMemberKey>` is not assignable to `PodLineage | null`), not silent shifts, and all three are updated in the same edit.
5. Both re-encrypt writers pass the lineage: `doSave` (`src/services/sync/syncService.ts:1801-1802`, which already destructures `{ payload, heads: exportedHeads }` from the same call) and `buildExportEnvelope` (`src/stores/syncStore.ts:2826-2837`, which today destructures `{ payload }` only, at `:2831`). The third caller, the env-gated diagnostic `beanpodProfile.spec.ts:265`, is covered in the Caveats.
6. `usePodCompaction` gains NO envelope stamp. Its "NO ENVELOPE STAMP" note (`src/composables/usePodCompaction.ts:381-386`) is now true for a stronger reason and is updated to say so.
7. Consequences that follow for free and must be tested rather than assumed: the compaction publish writes 5.0 because the document is compacted; the failed-publish self-repair (`ours-newer` to `publish-local`) republishes as 5.0 for the same reason; a `kept-local` after a stale overwrite republishes as 5.0; a never-compacted family writes 4.0 byte-for-byte as today.
8. **The writer emits the version it actually chose, on transition only.** This is the plan's central invariant and the one field failure it has no other signal for: a compacted pod written as 4.0 looks healthy to the whole fleet, because a guarded peer parses it, reads `adopt-remote` and adopts. So `doSave`, which now holds both the lineage and the derivation, logs it:

   ```ts
   // Module scope, beside the other save-path state.
   let lastVersionDetail: string | null = null;
   // In doSave, immediately after reEncryptEnvelope:
   const detail = `version=${beanpodVersionFor(lineage)},seq=${lineage?.seq ?? 'none'}`;
   if (detail !== lastVersionDetail) {
     lastVersionDetail = detail;
     logEvent({
       level: 'info',
       surface: 'pod-version',
       message: 'pod written at version',
       context: {
         action: 'wrote',
         detail,
         ...(currentEnvelope.familyId ? { family_id: currentEnvelope.familyId } : {}),
       },
     });
   }
   ```

   Transition-gated for the reason the save-status telemetry states for itself (`syncStore.ts:509-533`): a family saves constantly, so a per-save event would be a large fraction of the firehose while carrying one constant. On transition it answers both questions that matter, "when did this family become 5.0" and "is any device writing `version=4.0` while `seq` is present", and the second is impossible under `beanpodVersionFor` and therefore is the alarm for a dropped `lineage` across the worker boundary. `detail` is already allowlisted (`src/utils/diagnosticContext.ts:185`), so no context key is added. Calling the pure `beanpodVersionFor` a second time here is not a DRY violation: the LOGIC has one home, and a second call cannot disagree with the first.

### R2. Every reader accepts 4.0 and 5.0, from one definition

1. `export type BeanpodVersion = '4.0' | '5.0'` in `src/types/syncFileV4.ts`; `BeanpodFileV4.version: BeanpodVersion` (`:56`). `BeanpodFileV4` is NOT renamed (the V4 names the key model, which does not change; 30+ importers).
2. `KNOWN_BEANPOD_VERSIONS: ReadonlySet<BeanpodVersion>` in `fileSync.ts`, with exactly ONE reader: `parseBeanpodV4` (`fileSync.ts:73-75`). Under R2.3 and R2.5 there is no second version test left in the app, so there is nothing for it to drift from.
3. **The three picker readers lose their `detectFileVersion` pre-call entirely** rather than widening its literal. `openAndLoadFile` (`syncService.ts:2065-2084`), `openAndLoadFileFallback` (`:2117-2133`) and `loadDroppedFile` (`:2157-2176`) are three byte-similar copies of the same shape: `detectFileVersion(text)`, then `parseBeanpodV4(text)` on `'4.0'`, then a hand-rolled `lastError: 'Unsupported file version: ...'` on anything else, all inside a try that already catches. Each becomes a plain `parseBeanpodV4(text)` inside that try. The reasoning is already written in this codebase at `src/stores/syncStore.ts:1230-1234`: "`parseBeanpodV4` validates the version itself and throws a BETTER message, so the old `detectFileVersion` pre-call was a second full JSON.parse of the whole multi-megabyte file purely to read one field, then thrown away."
   - `rawText`, the only value the deleted arm returned (`syncService.ts:71`, written at `:2084`, `:2133`, `:2176`), has NO reader anywhere in `src/`. It is removed with the arm. Its comment calls it "raw file text for V3 fallback detection"; there is no V3 fallback.
   - The three catches gain the `payloadError` carry and the translated `lastError` described in R3.7. `openAndLoadFile`'s `AbortError` arm (`syncService.ts:2085-2088`) is untouched and stays first.
4. `createBeanpodV4` no longer holds a literal; see R1.4. "A new family is a 4.0 family until it compacts" is now a consequence of the derivation rather than a separate rule.
5. **`isStubBeanpod` (`src/services/sync/connectStorage.ts:244-251`) stops parsing anything.** It returns `true` for null, empty, whitespace, or the literal `{}`, and `false` otherwise. It consults no version and performs no `JSON.parse`, which is the same objection R2.3 raises against the pre-call: a second full parse of a multi-megabyte file to read one field. Any real envelope, whatever its version, therefore falls to `adopt-existing` (`connectStorage.ts:234-236`), which is confirm-gated; its own comment (`:219-222`) already promises that any failure falls safe to `adopt-existing`, and the code now does. The subsequent confirmed open goes through `parseBeanpodV4` like every other read, so it surfaces the R3 copy rather than a bare throw.
   - `connectStorage.test.ts` drives this function THROUGH the mock it is losing: `:34-37` mocks `@/services/sync/fileSync` to expose only `detectFileVersion`, and `:212` sets its return value to steer the assertion at `:210-215`. Those tests are rewritten to feed `mockProbeRead` real text (a 4.0 envelope, a 5.0 envelope, a 6.0 envelope, `'{}'`, `''`, `null`) with no `fileSync` mock at all, which is both simpler and an actual test of the predicate.
6. **`detectFileVersion` is deleted** (`fileSync.ts:94-105`), along with its imports in `syncService.ts:24` and `connectStorage.ts:27`, its `fileSync.test.ts` block (`:125-142`) and its import at `fileSync.test.ts:13`. After R2.3 and R2.5 it has no production caller. Leaving an exported version-sniffer that nothing reads is the next person's trap. The `vi.mock` entries for it in thirteen suites go with it: twelve are dead stubs, and the thirteenth (`connectStorage.test.ts:36`) is load-bearing and is rewritten under R2.5. All thirteen are listed in the Testing Plan.

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

   Adding a fourth flag by hand to both ladders does not stop the fifth from drifting. Instead, in `sync.ts`:

   ```ts
   export type PayloadErrorKind =
     | 'credential-stale' // keyMayBeWrong
     | 'needs-update' // needsAppUpdate
     | 'unreadable' // step === 'parse' (a torn read)
     | 'too-large' // deviceCannotOpen
     | 'corrupt';

   /**
    * ⚠️ ORDER IS LOAD-BEARING. `UnsupportedBeanpodVersionError` is BOTH
    * `step === 'parse'` and `needsAppUpdate`, so the update question must be
    * asked first or every newer-version file resolves to `unreadable` and the
    * new copy is dead code. `keyMayBeWrong` stays first because it is the
    * existing precedence and a `parse` error can never set it (it is
    * `step === 'decrypt'` by definition, `sync.ts:290-292`).
    */
   export function payloadErrorKind(err: PayloadLoadError): PayloadErrorKind {
     if (err.keyMayBeWrong) return 'credential-stale';
     if (err.needsAppUpdate) return 'needs-update';
     if (err.step === 'parse') return 'unreadable';
     return err.deviceCannotOpen ? 'too-large' : 'corrupt';
   }
   ```

   with three `as const satisfies Record<PayloadErrorKind, ...>` tables, the idiom `POD_ACCESS_ERRORS` already uses (`src/utils/podAccess.ts:97`) for exactly this reason:
   - `PAYLOAD_INLINE_KEY: Record<PayloadErrorKind, PodBlockMessageKey>` in `sync.ts`; `payloadErrorMessageKey` becomes `PAYLOAD_INLINE_KEY[payloadErrorKind(err)]` and keeps its name, its signature and every one of its seventeen consumers. The existing per-arm reasoning (why a decrypt failure is not "damaged", why `parse` is not damage) moves onto the table rows rather than being deleted.
   - `PAYLOAD_OVERLAY_KEY: Record<PayloadErrorKind, UIStringKey>` in `payloadFailureSurface.ts`, replacing the ternary at `:121-125`. `UIStringKey` arrives as an `import type` from `@/services/translation/uiStrings`, exactly as `useConfirm.ts:2` and `structuredError.ts:29` already do; `sync.ts` keeps its no-imports rule and keeps using its own `PodBlockMessageKey` union.
   - `PAYLOAD_IS_INCIDENT: Record<PayloadErrorKind, boolean>` in `payloadFailureSurface.ts`, replacing `reportPayloadFailure`'s two early returns (`:59`, `:64`) with one guard. `true` for `unreadable` and `corrupt` only. The two comments that justify the current early returns (the `docClient.surface()` double-count for too-large, the rotated-key noise for credential-stale) move onto the table rows.

   A sixth kind then fails the build in three places rather than taking a silent default. The existing `parse` overlay mismatch is preserved as-is for now (`unreadable` maps to `resumeSetup.podCorrupted`) with a comment naming it and a follow-up issue: fixing the copy is a separate, user-visible change and must not ride in on a version bump. Making it VISIBLE in a table, rather than buried in two hand-written ladders, is this plan's job.

4. **The subclass does NOT override `inlineMessageKey`.** `PayloadLoadError.inlineMessageKey` is a getter that DELEGATES to `payloadErrorMessageKey(this)` with the comment "delegates, so the three-way copy rule lives in one place" (`sync.ts:305-308`). Five sites call `payloadErrorMessageKey(e)` directly (`LoadPodView.vue:395`, `:423`, `useLoginFlow.ts:455`, `LoginPage.vue:526`, `SettingsPage.vue:445`) and a dozen read `.inlineMessageKey` (`LoadPodView.vue:244/581/651`, `SettingsPage.vue:561`, `useLoginFlow.ts:678/881`, `syncStore.ts:3541/3547/3579`, `ResumePodSetup.vue:400`, `useBiometricSignIn.ts:106`). A subclass override would show two different messages for one error, split across those two groups. `'podNewerVersion.inline'` is added to `PodBlockMessageKey` (`sync.ts:183-190`) and is the `needs-update` row of `PAYLOAD_INLINE_KEY`.
5. `parseBeanpodV4` throws `UnsupportedBeanpodVersionError` when `version` is a string not in `KNOWN_BEANPOD_VERSIONS`, carrying that string in `fileVersion` and in the message. A missing or non-string `version` stays the plain "invalid file" `Error` (it is not a newer beanpod; it is not a beanpod).
6. `fetchAndMergeRemote`'s wrap (`syncService.ts:1539-1549`) becomes `e instanceof PayloadLoadError ? e : new CorruptPayloadError(...)`, the idiom `payloadFailure` already uses (`src/services/automerge/worker/docOps.ts:349-353`), so it does not relabel a typed throw as corruption. `noteRemoteUnreadable(err)` and the rethrow are unchanged, so `doSave`'s existing blocker handling (`syncService.ts:1764`) refuses the save exactly as it does for a torn read.
7. **The local-file picker path stops failing silently, at all FOUR of its callers.** This is a defect the review found, not a new feature. Today `loadFromNewFile` (`syncStore.ts:1488-1515`) and `loadFromDroppedFile` (`:1520-1550`) return a bare `{ success: false }` with the reason discarded. `syncStore.ts:1570-1572` already enumerates the callers; all four are in scope:
   - `SettingsPage.handleLoadFromFileConfirmed` (`SettingsPage.vue:522-537`) has no failure arm at all. The user picks a file and NOTHING happens.
   - `LoadPodView.handleLoadFile` (`LoadPodView.vue:519-540`) falls through to `syncStore.error` and then `t('auth.fileLoadFailed')`.
   - `JoinPodView` reaches both store functions (`:164`, `:177`) through ONE chokepoint, `handleLocalLoadResult` (`:186-200`), which does the same. One arm there covers both entry points; its inline parameter type widens with the result type.
   - `manualImport` (`syncStore.ts:2845-2852`) flattens everything to a developer-facing English string, which `SettingsPage.handleManualImport` renders as `result.error ?? 'Import failed'` (`SettingsPage.vue:640`), itself a bare English literal in a rendered ref.

   Fix with the field name and idiom that already exist: `OpenFileResult` (`syncService.ts:65-72`) and the store functions gain `payloadError?: RemoteBlocker`, set in the three catches of R2.3 when `isRemoteBlocker(e)` (already imported at `syncService.ts:17`). `decryptPendingFile` already returns exactly this field (`syncStore.ts:1606`) and both pages already render it (`SettingsPage.vue:561`, `LoadPodView.vue:244`), so each surface gains the same `else if (result.payloadError)` arm it already has three lines away. No new pattern, no new component, no new copy beyond the one key.

   Two things about this that are NOT optional, because without them the arm is unreachable or the raw string wins:
   - **The new arm goes BEFORE the `syncStore.error` arm.** `syncStore.ts:500` mirrors `syncService`'s `lastError` into `syncStore.error`, and both render sites test that ref first (`LoadPodView.vue:530-531`, `JoinPodView.vue:196-198`). An arm added after it would never run.
   - **The three catches set `lastError` to the translated message, not the raw one.** They currently write `lastError: (e as Error).message` (`syncService.ts:2090`, `:2135`, `:2178`), a raw English exception string that reaches the user through that same mirror. For an `isRemoteBlocker(e)` they write `useTranslationStore().t(e.inlineMessageKey)` instead; `useTranslationStore` is already imported and called in this file (`:62`, `:492`). Non-blocker errors keep the existing behaviour. The two channels then carry the same sentence and cannot disagree whichever arm runs.
   - `manualImport` forwards `payloadError` like the others. Both bare English strings on that path are routed through `t()` in the same edit, because they are on the lines being touched and a hardcoded English string in a rendered ref is a standing CI-adjacent defect: `SettingsPage.vue:640`'s `?? 'Import failed'` becomes `t('settings.importFailed')`, and the `error: 'Encrypted file requires password'` sentinel at `syncStore.ts:2850` is rendered through `t('settings.importNeedsPassword')` at the page rather than printed raw. The store keeps returning its developer-facing `error` string for logs; the page stops rendering it verbatim, exactly as `handleDecryptFile` already does three lines away (`SettingsPage.vue:563-570`).

8. `rebindPodFile` (`syncStore.ts:4778-4795`) is fixed in the CLASSIFIER, not at the call site.
   - `PodAccessErrorCode` gains `'FILE_NEWER_VERSION'`, and `POD_ACCESS_ERRORS` gains its entry (`messageKey: 'podAccess.error.newerVersion'`, `recoveries: []`, `severity: 'warning'`). The registry is `as const satisfies Record<PodAccessErrorCode, PodAccessEntry>` (`src/utils/podAccess.ts:97`), so the type system forces the message, the recovery and the severity, and `StructuredErrorEntry.messageKey` is typed `UIStringKey` (`structuredError.ts:37`), so a key that does not exist in `uiStrings.ts` fails the build. `recoveries: []` is deliberate and has precedent (`JOIN_ERRORS.NO_UNCLAIMED_MEMBERS`, named at `podAccess.ts:58`): no button in the app can update the app.
   - `POD_ACCESS_SEVERITY` (`podAccess.ts:107-115`) also gains the row.
   - **The existing agreement test does NOT cover the new row on its own.** `podAccess.test.ts:22-30` defines `ALL_CODES` as a hand-written array, and the two loops at `:120` and `:127` iterate it, so a code absent from that array is silently skipped by both. So: add `'FILE_NEWER_VERSION'` to `ALL_CODES`, and add one assertion that closes the drift for good, `expect([...ALL_CODES].sort()).toEqual(Object.keys(POD_ACCESS_ERRORS).sort())`. A future code that forgets the array then fails rather than passing vacuously.
   - `classifyDriveFailure` (`podAccess.ts:128-138`) gains one arm, **placed FIRST, above the `navigator.onLine` check at `:130`**: a `PayloadLoadError` whose `needsAppUpdate` is true returns the new code. A typed, definite classification must outrank ambient network state, or a connection blip mid-read turns "update beanies" into "you are offline". Both catch sites that call it (`syncStore.ts:3948` and `:4779`) are healed at once, which a hand-rolled `isRemoteBlocker` arm at one of them would not do. `rebindPodFile` reaches it because it calls `parseBeanpodV4(text)` inside its try (`syncStore.ts:4718`); `verifyPodAccess` reads metadata only and can never produce one, which is why the arm is a no-op there rather than a hazard.
   - `rebindPodFile`'s report reads `severity: POD_ACCESS_SEVERITY[code]` instead of its hardcoded `'critical'` (`syncStore.ts:4785`). The table exists to answer exactly this question as data (`podAccess.ts:99-106`) and is already consulted that way at `syncStore.ts:4028`; a "please update beanies" must not page Slack.
9. `loadFromGoogleDrive` (`syncStore.ts:4458-4468`) sets `error.value = useTranslationStore().t(e.inlineMessageKey)` for an `isRemoteBlocker(e)` and returns it as `payloadError` on the result. Today the catch sets `error.value = (e as Error).message` (`:4459`), a raw English exception string that `LoadPodView.handleLoadFile` renders verbatim (`LoadPodView.vue:531`). The `reason` / `status` classification below it (`:4465-4467`) is untouched.
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

    `asJoinDecryptError` calls it in place of its inline expression (`:98-107`). `doPickAndLoad` (`:587-598`), which today flattens every load failure to `FILE_READ_FAILED` carrying a raw English `syncStore.error` (`:589-595`), calls it against `result.payloadError` from R3.9 and keeps `FILE_READ_FAILED` only as the `null` fallback. One mapper, two call sites; do not write the second copy.

11. Every other site (`App.vue:585`, `useLoginFlow.ts:243/443/993`, `LoadPodView.vue:388-396`, `ResumePodSetup.vue:320/400`, the sync bar via `syncStore.ts:3539-3581`) already dispatches on `PayloadLoadError` or `RemoteBlocker` and inherits the copy with NO change, because R3.3 and R3.4 put the branch in the shared resolver. The new build therefore degrades legibly on the NEXT bump; the deployed build cannot, and the plan does not pretend otherwise.

### R4. A restore is a lineage event, so it sticks

1. Today, restoring the pre-compaction safety copy on device A (Settings, Load another Family Data File, `decryptPendingFile(password, { userChoseThisFile: true })` at `SettingsPage.vue:550`) adopts under `user-file`, leaving A on the old lineage. Every peer B still holding `{id, seq: 1}` reads `ours-newer` to `publish-local` (`podLineage.ts:176`) and republishes the compacted pod over the restore within one poll (P6 F3). The rollback route the copy promises is undone by the fleet automatically.
2. **The stamp happens inside `mergeRemoteEnvelope`. There is no new worker op, no new protocol message, no new `docClient` method and no new store call site.** The guard and both documents exist only there (`applyAndProject.ts:783-792`, and `eslint.config.js:371-399` bans `guardLineage`/`compareLineage`/`lineageAction` everywhere outside that one file and `podLineage.ts`), so the decision cannot live anywhere but this file.
   - A separate `stampLineage` RPC would be strictly worse: the install branch calls `schedulePersist()`, `scheduleSnapshotPersist()` and `pushProjection` before it returns (`:959-964`), so a save landing between the adopt and the stamp would publish the UNSTAMPED restored document, and the restore would silently fail to stick in exactly the way R4 exists to prevent.
   - **The stamp is a FLAG set in the guarded block, never a property of the install branch.** `installWholesale` is seeded `!currentDoc || basis.kind === 'no-local-document'` at `:839`, and the install at `:951-987` therefore serves the first-load adopt as well; `act` is block-scoped inside `if (currentDoc && basis.kind !== 'no-local-document')` (`:842-928`) and is not even in scope at `:956`. Declare `let stampNewGeneration = false;` beside `rebaseUnavailable` (`:841`), set it only inside the guarded block under R4.3's condition, and read it at the install. A fresh device that stamped on its first sync would mint a generation and republish, forcing the whole fleet to `adopt-remote`: a new phone joining would churn every other device. Pinned by a test.
   - **The stamp is an `Automerge.change` on the migrated remote, deliberately unlike `compactDoc`'s stamp-into-source.** `compactDoc` writes the lineage INTO the plain object before `Automerge.from` and says why (`:1218-1225`); doing that here would rebuild the restored document and destroy the history the restore exists to recover. `nextLineage`'s doc comment names both callers and the difference.
   - Compose, then install, exactly as the branch already does (`:951-956`): build `migrateDoc(remote)`, apply the stamp to that value, assign `currentDoc` ONCE. A throw leaves the old document installed by construction, which is the discipline the surrounding code already enforces and documents (`:860-870`).
3. **The condition is the guard's VERDICT, and `guardLineage` is changed to return it.** Stamp when the verdict was `ours-newer` under `user-file`, and never otherwise.
   - `guardLineage` today returns `Exclude<LineageAction, 'block'>` only (`podLineage.ts:202-211`), and `POLICY` maps BOTH `ours-newer` x `user-file` and `conflict` x `user-file` to `adopt` (`:176-177`). So `act === 'adopt'` cannot distinguish them and the plan's condition is not expressible at `:846` as written. Change the return to `{ action, verdict }`. There is exactly ONE production call site (`applyAndProject.ts:846`), which becomes `const { action: act, verdict } = guardLineage(...)`, so the body below is untouched. It keeps the rule that nothing re-derives the comparison: `compareLineage` already answers the question completely, including the `remote === null` case (`podLineage.ts:135`).
   - **Three test files call it and all three must change; one of them fails silently if missed.**
     - `podLineage.test.ts:100-102` asserts `toBe('merge')` / `toBe('adopt')` / `toBe('publish-local')`; `:123` asserts `not.toThrow()`. Update to read `.action`, and add one case asserting `.verdict` so the new half is pinned rather than merely compiled.
     - `lineageProtectsPeerEdits.test.ts:113` and `:132` assert `toBe('rebase')` and `toBe('adopt')`. Same edit.
     - `lineageBasis.test.ts:22` hoists `guardHook.force` as `string | null` and `:28` returns it in place of the real result; `:126` sets `force = 'rebase'`. Retype the hook as `ReturnType<typeof actual.guardLineage> | null` and set `{ action: 'rebase', verdict: 'adopt-remote' }`. **If this is missed the suite stays green and stops testing anything**: the call site would destructure `action` off a string, get `undefined`, and the one test that pins "a rebase must never silently become a merge" would exercise a path it was not written for.
   - Two cases the condition correctly excludes. `conflict` x `user-file` is also `adopt` (`:177`): two devices compacted concurrently and a human picked one, so adopting the chosen id is the resolution and minting a third generation would be wrong. And `adopt-remote` x `user-file` is `rebase` (`:175`), not `adopt`: choosing a NEWER file over a stale local document must mint nothing. Note the `user-file` rebase FALLBACK also lands in the install branch (`:927`, `installWholesale = act === 'adopt' || act === 'rebase'`), and it too must mint nothing, which the flag gives for free because it is set only under the `ours-newer` verdict.
   - `user-file` has exactly two producers and both pass it as an argument from the site that obtained the consent (`podLineage.ts:48-59`, `syncStore.ts:1562-1580`, `SettingsPage.vue:543-550`). The restore is producer 2. Producer 1, the lineage banner, cannot present an `ours-newer` today (that verdict never blocks, so no banner is raised), but if it ever did, minting there is the same semantics and the condition needs no special case.
4. The publish needs no new plumbing. The install branch already returns `dirty: !headsEqual(remoteHeads, heads)` (`:980`), and the stamp moves `heads` past the file's, so `dirty` is true; `replaceDocWithCacheRecovery` already does `if (merged.dirty) syncService.triggerDebouncedSave()` (`syncStore.ts:987`). The Drive baseline still commits `remoteHeads`, captured from the unmigrated remote at `:939` (the bytes actually on Drive), which is the same shape the existing `migrateDoc` delta case already relies on (`:968-976`).
5. Peers then read `adopt-remote` and adopt (clean) or rebase (dirty), the propagation the guard was built for. The restored file is written as 5.0 by R1, because it is now stamped, so stale builds stay refused.
6. **One minting helper.** `export function nextLineage(prev: PodLineage | null): PodLineage` in `src/services/automerge/worker/docOps.ts`, immediately beside `docLineage` (`:56-70`), which is already documented as "the ONE place absent-or-null is decided". It returns `{ id: generateUUID(), seq: (prev?.seq ?? 0) + 1 }` (`docOps.ts` already imports `PodLineage` at `:19`). Three callers and no fourth: `compactDoc` (`applyAndProject.ts:1226`, replacing its inline literal), the R4 restore stamp, and `beanpodProfile.spec.ts` (see Caveats). Its doc comment states that `compactDoc` stamps it INTO the source before `Automerge.from` while the restore applies it as a change to an already-built document, and why each is right where it is.
   - **`generateUUID` moves with it.** `applyAndProject.ts:1226` is its ONLY use in that file, so after the replacement the import at `:29` is unused and the build fails. Move the import to `docOps.ts` AND move the five-line warning above it (`:24-28`, "NOT a bare `crypto.randomUUID()`", which records a real field failure: `crypto.randomUUID` is undefined on a non-secure origin, which is exactly how a tablet is tested over a LAN IP, and the resulting TypeError was classified as corruption). Deleting that comment loses the reason; leaving it behind orphans it.
7. Known limitation, stated in the plan and the code: a device with no prior document does not know the fleet's seq and cannot reach `user-file` (it reaches the install branch via `!currentDoc || no-local-document`, BEFORE the guard is consulted, `applyAndProject.ts:839`), so it cannot perform a durable restore. A restore is done from a device that holds the family. If that ever needs to change, the restore flow pulls first to learn the seq; not in this plan. See the Caveats for the version consequence.

### R5. The pre-compaction backup pair is written as 5.0

1. The compaction flow builds one envelope for both the manual export and the Drive safety copy (`usePodCompaction.ts:232`, used again at `:252` and `:280`), from `buildExportEnvelope()`, BEFORE `compactDoc` at `:367`. Under R1 that derives 4.0, and a stale build can open it: the deployed picker lists every `.beanpod` Drive-wide with no safety-copy filter, so a stale user reacting to "sync stopped" can pick the copy, be bound to it, and fork the family onto the backup (P6 F5).
2. `buildExportEnvelope({ compactionBackup: true })`, used ONLY by the compaction flow, forwards to `beanpodVersionFor`'s one exception (R1.2). The other caller, `usePodExport.ts:84` (the Settings Export button), passes nothing and stays purely derived. A family that has compacted is a 5.0 family from that moment; a stale build cannot open its backup, a current build can, and the rollback route is unchanged. The option is named for the INTENT rather than for a version, so it cannot express a downgrade and needs no ordering.
3. The byte-compare of the safety copy (`usePodCompaction.ts:308-352`) is unaffected: it compares what came back against what went out.
4. **What the current build already does, so nobody re-implements it.** `findBeanpodInFolder` already excludes safety copies and is the auto-selecting join/recovery entry point (`src/services/google/driveService.ts:739-757`); `rebindPodFile` already refuses to bind one (`syncStore.ts:4696-4704`). `searchBeanpodFilesGlobal`, which feeds the HUMAN picker, deliberately still shows it (`driveService.ts:745-750`), because that visibility is what makes it a rollback route a person can choose. R5 is therefore aimed at the DEPLOYED build's picker, which has none of these.

### R6. The soak gate becomes a notice; nobody is asked to enumerate devices

1. **The reading is renamed, because deleting the gate leaves a module documented as one.** `podSoak.ts:1-21` describes a gate ("SHARED by the pre-compaction gate", "the gate requires a marker from every recently-active member, and absence refuses"), and `evaluateSoak` / `SoakVerdict` are named for it. A display function living under a gate's doc comment is how the refusal gets re-added by the next person. So:
   - `evaluateSoak` becomes `membersOnOlderVersions(members, opts): string[]`, returning the names, which is byte-for-byte what `evaluateSoak(...).behind` returns today (`podSoak.ts:77-82`). The body, the filters and the options are unchanged; only the name, the return shape and the header change.
   - **It does NOT return the app version, and the copy does not name one.** This is a correction to the audit's P4 note, which assumed `member.appVersion` could say "Sam last used beanies 0.16". It cannot, for the only people this can name: `appVersion` and `lineageEpoch` are written by the same `withLoginStamps` on the same login (`src/stores/familyStore.ts:505-512`), and a member is listed only when `(m.lineageEpoch ?? 0) < REQUIRED_EPOCH` (`podSoak.ts:79`), which is exactly "no build that writes `appVersion` has written this row". The field's own comment says it: "DIAGNOSTICS ONLY, never load-bearing in the soak gate, because it is absent on exactly the devices the gate is about" (`src/types/models.ts:347-352`). Rendering `{name} ({version})` would print "Sam (undefined)" for every person named, for every family, today. A branch that can only be reached by a future `REQUIRED_EPOCH` bump is the unreachable guard `usePodHealth.ts:67-70` already refuses on its own behalf; if that bump ever happens, the item template is one string away.
   - `SoakVerdict` is deleted, not kept: `ok` is defined as `behind.length === 0` (`podSoak.ts:82`), and both of its readers (`usePodCompaction`'s step 0 and step 2d gates) are the gates being removed, so keeping the wrapper would leave a type nothing needs.
   - The file header is rewritten: nothing refuses on this reading, `lineageEpoch` is still the machine test, and the per-member limitation is a property of the notice. `SOAK_WINDOW_DAYS` (`:25`), `REQUIRED_EPOCH` (`:33`, still imported by `familyStore.ts:14`), `withinWindow` and `anyDeviceReportedTooLarge` are unchanged; the filename stays.
2. `refuseSoak` and the `not-soaked` / `not-soaked.named` refusal codes are DELETED from `usePodCompaction` (`:106-126`, and `'not-soaked'` from the `RefusalCode` union at `:53`). Steps 0 and 2d of the ladder (`:161-163`, `:211-212`) lose their soak gate entirely; the reading becomes display only.
3. **One reading, one formatter, three consumers.** `usePodHealth` is already the single reactive reading (`waitingOn`, `usePodHealth.ts:72`) and `usePodCompaction` already calls `usePodHealth()` (`usePodCompaction.ts:76`). So:
   - `usePodHealth` renames `waitingOn` to `olderVersion` (the names) and adds two computeds beside it, all three returned (`usePodHealth.ts:78`):
     - `olderVersionNames`, a plain `formatNames(olderVersion.value)`;
     - `olderVersionNotice`, `fillTemplate(t('compaction.olderVersion.notice'), { list: olderVersionNames.value })`. The Settings slab and the confirm dialog show the SAME sentence, so it is filled once here rather than at both sites. `usePodHealth` gains `useTranslation` and `fillTemplate` imports; `usePodHealth.dueSignal.test.ts` already calls `setActivePinia(createPinia())` (`:29`), so the translation store resolves and that suite needs no new mock.
   - `usePodCompaction` reads `olderVersion` and `olderVersionNotice` for the confirm and `olderVersionNames` for the toast's own key, and DELETES its own `soak()` helper (`:129-138`) and its `evaluateSoak` / `formatNames` / `SoakVerdict` imports (`:29`). It keeps `fillTemplate` (`:30`), whose remaining use is the toast at `:443`. A Vue `computed` re-evaluates on read, so the post-pull reading at the toast is still the current projection, which is what step 2d's comment was protecting.
   - `formatNames` stays the ONE joiner (`podSoak.ts:65-67`). `SettingsPage` renders `olderVersionNotice` and `t('compaction.olderVersion.rule')`, and drops BOTH now-unused imports, `formatNames` (`:45`) and `fillTemplate` (`:46`), whose only use in the file is the line being replaced (`:2050`).
4. The Settings section shows, when `olderVersion` is non-empty, a standing notice naming who last used an older version, and always, once, the rule that beanies can only see when each person last opened beanies. The bring-your-devices-online caution (`compaction.bringDevicesOnline`, `uiStrings.ts:4307`) remains as the `v-else`, unchanged, for the rebase case. The one-slab-never-two structure at `SettingsPage.vue:2038-2055` is kept as it is.
5. The confirm dialog carries the same names when `olderVersion` is non-empty. **This needs no API change**: `confirm()` already takes `detail?: string`, documented as "Additional detail text shown below the message (plain string, not translated)" (`src/composables/useConfirm.ts:8-9`), so the call at `usePodCompaction.ts:167-172` gains `detail: olderVersion.value.length ? olderVersionNotice.value : undefined`, reading the already-filled string from `usePodHealth` (R6.3) so the sentence is composed once. Do not widen `ConfirmOptions`.
6. The completion toast names them again. Three specifics at `usePodCompaction.ts:431-445`:
   - `const after = soak()` (`:431`) becomes a read of `olderVersion.value` from `usePodHealth`, and `after.ok` becomes `olderVersion.value.length === 0`. It still runs AFTER `clearTooLargeMarks()`, so it is still the post-compaction projection.
   - `after.behind.join(', ')` (`:443`) is a HAND-ROLLED second joiner beside `formatNames`; it is replaced by `olderVersionNames.value`, so `formatNames` is genuinely the only one. The key becomes `compaction.doneOlderVersion` with `{list}`, replacing `compaction.doneButBehind` (`uiStrings.ts:4408`), whose "so their changes come across safely" is no longer true under 5.0.
   - **The comment above it (`:437-442`) is now false and must be rewritten, not kept.** It says a person on an older build "will merge across lineages, the fleet-wide destruction the soak gate exists to prevent". Under 5.0 that build cannot merge at all; it is refused at parse. Leaving the comment tells the next reader the hazard is still live and invites the gate back.
7. Copy. Every entry carries `en` and `beanie` (CLAUDE.md, non-negotiable); `zh` follows through `npm run translate`. `en` is lifted from P6 sections 3 and 4, with the version references removed per R6.1.

   Added:

   ```ts
   'compaction.olderVersion.notice': {
     en: '{list} last opened beanies on an older version. Once you compact, a device that is still on an older version shows a message and stops syncing until it updates, and anything added on it before then is not kept. Ask them to update beanies first if you can. Nothing else changes for anyone.',
     beanie:
       '{list} last opened beanies on an older version. once you compact, a bean that is still on an older version shows a message and stops syncing until it updates, and anything added on it before then is not kept. ask them to update beanies first if you can. nothing else changes for anyone.',
   },
   'compaction.olderVersion.rule': {
     en: 'beanies can only see when each person last opened it, not every device they own. Any device that has not updated will say so when it next opens, and will sync again once it does.',
     beanie:
       'beanies can only see when each bean last opened it, not every device they own. any device that has not updated will say so when it next opens, and will sync again once it does.',
   },
   'compaction.doneOlderVersion': {
     en: 'Done. {list} last opened beanies on an older version; that device will show a message and sync again once it updates.',
     beanie:
       'done. {list} last opened beanies on an older version; that device will show a message and sync again once it updates.',
   },
   'compaction.why.conflict': {
     en: 'If the same thing was changed in two places, the version already saved here is the one kept.',
     beanie:
       'if the same thing was changed in two places, the version already saved here is the one kept.',
   },
   'podNewerVersion.inline': {
     en: 'This family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.',
     beanie:
       'this pod was saved by a newer version of beanies. update beanies on this bean to open it. nothing on this bean is lost.',
   },
   'resumeSetup.podNewerVersion': {
     en: 'This family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.',
     beanie:
       'this pod was saved by a newer version of beanies. update beanies on this bean to open it. nothing on this bean is lost.',
   },
   'podAccess.error.newerVersion': {
     en: 'That family file was saved by a newer version of beanies. Update beanies on this device to open it. Nothing on this device is lost.',
     beanie:
       'that pod was saved by a newer version of beanies. update beanies on this bean to open it. nothing on this bean is lost.',
   },
   'join.error.newerVersion': {
     en: 'That family file was saved by a newer version of beanies. Update beanies on this device, then open your invite link again. Nothing on this device is lost.',
     beanie:
       'that pod was saved by a newer version of beanies. update beanies on this bean, then open your invite link again. nothing on this bean is lost.',
   },
   'settings.importFailed': {
     en: 'That file could not be imported.',
     beanie: 'that file could not be imported.',
   },
   'settings.importNeedsPassword': {
     en: 'That file is encrypted. Enter its password to import it.',
     beanie: 'that file is locked. enter its password to import it.',
   },
   ```

   Changed:

   ```ts
   'compaction.confirmMessage': {
     en: 'beanies will rebuild your family file without its record of past changes, so it opens faster and works on older tablets. Nothing on this device is lost, and beanies keeps a copy of the current file first. Your other devices pick up the compacted file on their own, and beanies carries across anything they changed while offline. A device still on an older version of beanies shows a message and stops syncing until it updates; anything added on it before then is not kept.',
     beanie:
       'beanies will rebuild your pod without its record of past changes, so it opens faster and works on older tablets. nothing on this bean is lost, and beanies keeps a copy of your current pod first. your other beans pick up the compacted pod on their own, and beanies carries across anything they changed while offline. a bean still on an older version of beanies shows a message and stops syncing until it updates; anything added on it before then is not kept.',
   },
   ```

   Deleted: `compaction.waitingOn` (`uiStrings.ts:4374`), `compaction.refused.not-soaked` (`:4379`), `compaction.refused.not-soaked.named` (`:4386`), `compaction.doneButBehind` (`:4408`). Delete the `beanie` half of each too, and re-run `npm run translate` so `public/translations/zh.json` loses them.

   Notes on the copy:
   - The rebase conflict sentence leaves `compaction.confirmMessage` and becomes `compaction.why.conflict`, a fourth key in the "?" popover beside `compaction.why.record` / `.settled` / `.older` (`uiStrings.ts:4292-4306`). It is a new key in an existing group, not a new mechanism, and the popover component renders the four in order.
   - `settings.importFailed` and `settings.importNeedsPassword` exist only because R3.7 touches the two lines that render bare English (`SettingsPage.vue:640`, and the sentinel from `syncStore.ts:2850`). The store keeps its developer-facing `error` string for logs.
   - **No string in this plan asks anyone to open beanies on every device.** That sentence is the thing being deleted; grep the four deleted keys and the new ones for "each device" before shipping.

### R7. Documents

1. ADR-036 addendum (or ADR-037, whichever the implementer judges cleaner): "a compacted document is a 5.0 file, and the version is derived from the document's lineage at write time". States why envelope-carried was rejected (Trap 1, with `envelopeMerge.ts:73` as the evidence), why the safety copy is 5.0, and that `guardLineage` now returns its verdict so the restore can mint on `ours-newer` alone.
2. `docs/STATUS.md`: Tier 3 entry updated; the "OWED before the flag can be flipped" list rewritten around the sequence below; the per-member limitation stated as a property of the notice, not a gate.
3. `docs/lessons.md`: three entries. "A spread carries the field you forgot to think about" (Trap 1); "when a decision is written as a ladder in two files, check whether they have already drifted before adding a third arm" (the `payloadErrorMessageKey` / `surfacePayloadFatal` mismatch); and "a loop over a hand-written list of codes is not an exhaustiveness test" (`podAccess.test.ts:22-30`, which would have skipped the new row in silence).
4. `src/config/flagRegistry.ts` comment: the gate is the fleet drain and the 5.0 refusal, not the stages.
5. `docs/plans/2026-09-06-pod-compaction-tier3.md`: a SUPERSEDED-IN-PART banner pointing here for Stage 4's gate.
6. A follow-up issue for the `unreadable` overlay copy (R3.3): a torn read is shown full-screen as "your data may be damaged, contact support" and should not be. Filed, not fixed here.

## Important Notes & Caveats

- **What the bump does not do.** It does not stop a stale device from overwriting the pod; it stops it from merging into it. The overwrite is loud, reverted by the fleet, and recoverable from the safety copy. The plan's copy says so and never claims more.
- **The person on the stale build gets no message.** The deployed poll swallows the parse error and shows stale data under "Could not refresh". There is no channel into a deployed build (release notes are bundled, no email sender). The family tells them. Do not add a mechanism that pretends to reach them.
- **The stub probe on the deployed build cannot be fixed.** R2.5 fixes the current build's copy so the NEXT stale build does not carry it. The deployed hazard needs the owner's account, a stale build, and a deliberate create with a colliding name; the mitigation is the drain, the safety copy, and Drive revision history.
- **A restore performed from a device with no local document silently returns the family to 4.0.** That path reaches the install branch via `!currentDoc || basis.kind === 'no-local-document'` (`applyAndProject.ts:839`), BEFORE the guard runs, so no verdict is computed and R4's `stampNewGeneration` never becomes true. The adopted document carries the backup's old lineage, and R1 then derives 4.0 on the next save. This is R4.7's limitation with its version consequence made explicit: the supported restore is Settings, Load another Family Data File, on a device that already holds the family. Do NOT "fix" it by deriving the version from the envelope; that is Trap 1 again. Do NOT "fix" it by stamping in the install branch unconditionally; that makes every new device mint a generation on its first sync.
- **The notice names people, never versions or devices.** `appVersion` cannot describe anyone the notice can name (R6.1, `src/types/models.ts:347-352`), and beanies has no per-device identity at all. If a future `REQUIRED_EPOCH` bump makes `appVersion` meaningful for a listed member, add the item template then, with a test that a member lacking the field still renders.
- **Two compactions in a row stay 5.0** (P6 F9). The version says "compacted", the lineage seq says which generation. Do not introduce 6.0 for a second compaction. `beanpodVersionFor`'s `compactionBackup` exception exists for the same reason: a second compaction's backup must not fall back to 4.0.
- **Two owners compacting concurrently** resolve to `conflict`, still reachable and still handled (P6 F8). Unchanged, and R4.3 deliberately mints nothing when a human resolves one.
- **Do not put the version rule in `preserveLocalKeyDicts`.** A local-wins or max rule there is wrong on the adopt/rebase branches and wrong again for the rollback (P5 Trap 1, option 2). The version is derived, full stop. `preserveLocalKeyDicts` keeps its `{ ...incoming }` spread (`envelopeMerge.ts:73`) and the test in step 1 pins that it still carries `incoming.version`, so it is the DERIVATION, not the spread, that protects.
- **`guardLineage`'s new return shape is a contained change, not a refactor.** One production caller (`applyAndProject.ts:846`), the lint rule that keeps it that way (`eslint.config.js:371-399`), and three test files (R4.3). It is preferred to the alternatives because the alternatives are worse: re-calling `compareLineage` at the install site is a second evaluation of one fact, and hoisting the verdict out of `guardLineage` by hand at the call site is the same thing spelled differently.
- **Force-update on native is a follow-up, not this plan.** Under 5.0 a stale device is safe, only cut off; the drain affects how many people the notice names, not safety. Android has Play In-App Updates (immediate mode); iOS has no store mechanism and needs a self-built minimum-version screen. Both are from knowledge, not re-verified against current docs (P4 was stopped for budget). File separately.
- **`beanpodProfile.spec.ts:258-265`** (env-gated diagnostic) builds a compacted copy with `Automerge.from(plain)` (`:261`) and writes it with `reEncryptEnvelope(envelope, payload)` (`:265`). It stamps NO lineage, so under R1 it would produce the forbidden artefact (a compacted 4.0). Fix it the way `compactDoc` does: spread `nextLineage(null)` into `plain` before `Automerge.from`, and pass that lineage to `reEncryptEnvelope`. Same helper, same shape, one more caller.
- **Do not deploy** as part of this work. The flag stays off. The sequence below is greg's to run.

## Assumptions

> **Review these before implementation.**

1. `compareLineage` treats a higher `seq` as newer regardless of `id` (`podLineage.test.ts:37`: `L('a', 2)` vs `L('b', 1)` gives `adopt-remote`). R4 depends on it. Re-read in Pass 4 at `podLineage.ts:128-141`; the function also answers `ours-newer` for `remote === null` (`:135`), which is the first-compaction restore case.
2. `docLineage()` normalises an absent `podLineage` to `null`, so a deployed build's document (no lineage concept) compares as the oldest generation. Verified by P6 F11 and re-read in Pass 4 at `docOps.ts:56-70`.
3. The IndexedDB envelope cache may say 4.0 for a compacted document after a failed publish; nothing reads the cached version (P5 Q4), and the next write derives it. Acceptable. Note that this is also why R1.8's version signal is emitted by the WRITER and not read back off the in-memory envelope, which `reEncryptEnvelope` never updates (`fileSync.ts:214-222`).
4. **RESOLVED in Pass 4, no longer an open question.** A login-by-build CloudWatch query exists today with no new context key: `build_sha` is in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:98`) and `enrichAndRedact` stamps it onto EVERY event (`:499`), correlated by `family_id`. `app_version` is not a context key, is not needed, and must not be added (a new key triggers the store-declaration rule).
5. The deployed picker path that binds a stale device to the safety copy is closed by R5; `CANONICAL_MISMATCH` (`c3a6be98:syncStore.ts:3098`) remains the detector for any fork that predates this change.
6. `OpenFileResult`'s `rawText` has no reader in `src/` (Pass 2 grep, re-checked in Pass 3 and Pass 4: written at `syncService.ts:2084`, `:2133`, `:2176`, read nowhere). If a consumer appears outside `src/`, keep the field and set it in the catch instead of deleting it; nothing else in R2.3 changes.
7. **RESOLVED in Pass 4.** `'detail'` is in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:185`), so R3.1's `blockDetail` forwarding and R1.8's `pod-version` event need no allowlist change and no store-declaration update.

## Approach

The centre of the change is R1: one derivation, `beanpodVersionFor`, reached by both writers, and the version becomes a fact about the payload rather than a field that rides along. Everything else either widens a reader and deletes its duplicates (R2), routes one new question through a base-class member and three exhaustive tables so the existing dispatch sites answer correctly without being touched (R3), makes the restore mint a generation inside the branch that already adopts (R4), raises the backup pair (R5), or deletes a gate and replaces it with words (R6).

Pass 2 made the shape smaller in four places, each one where the code already had the mechanism: the error class routes through `payloadErrorMessageKey` rather than overriding a getter; the restore stamps inside `mergeRemoteEnvelope` rather than through a new RPC; the three picker readers collapse into `parseBeanpodV4` rather than each learning a new version set; and the notice renders from `usePodHealth`'s existing single reading.

Pass 3 changed five things about the long-term shape rather than the size: `guardLineage` returns its verdict; the stamp is a flag from the guarded block; the three payload-failure decisions read tables keyed on ONE discriminator; `beanpodVersionFor` takes an intent rather than a version floor, and `createBeanpodV4` calls it too; and the worker/client export shape becomes one type in `protocol.ts`.

Pass 4 changed what the plan would have SHIPPED WRONG or left unverifiable: the notice would have printed "(undefined)" beside every name, three of the tests that were supposed to pin the change would have failed to compile or, worse, passed vacuously, the new picker arm would have been unreachable behind an arm three lines above it, the pod-access severity row would not have been checked by the loop the plan cited, and the observability promise could not be emitted honestly from the place the plan named.

Order of implementation, each step green before the next:

1. R2.1 type and known-set; R1: the `ExportedPayload` type in `protocol.ts`, the worker return, `beanpodVersionFor`, `reEncryptEnvelope`'s and `createBeanpodV4`'s signatures, all three writers, the `pod-version` transition event; `beanpodProfile.spec.ts` with `nextLineage`. Tests: `fileSync.test.ts` 5.0 accepted, 6.0 typed; the three positional `createBeanpodV4` callers updated (`fileSync.test.ts:38`, `:53`, `fileSync.writerVersion.test.ts:12`); a real-`reEncryptEnvelope` save-path test asserting the `kept-local` republish carries 5.0 (the Trap 1 pin); `envelopeMerge.test.ts` asserting `preserveLocalKeyDicts` still copies `incoming.version` (so the derivation, not the spread, is what protects); a `beanpodVersionFor` table test covering null lineage, present lineage, and `compactionBackup` over each; and one test that `doSave` emits `pod-version` once for a run of identical saves and again when the derived version changes.
2. R3.1 to R3.6: the `needsAppUpdate` and `blockDetail` members, the error class, `payloadErrorKind` plus the three tables, the two `payloadFailureSurface` rewrites. Tests: a 6.0 file lands on `podNewerVersion` at BOTH `payloadErrorMessageKey(e)` and `e.inlineMessageKey` (the divergence pin); `payloadErrorKind` returns `needs-update` and not `unreadable` for it (the arm-order pin); `reportPayloadFailure` emits nothing for it; `surfacePayloadFatal` uses the new overlay key; a `parse` `CorruptPayloadError` still pages, so the torn-read signal is not lost; `noteRemoteUnreadable` reports it at `warning` with `error_code: 'parse'` and `detail: version=6.0`, and does not latch; no `clearCache` RPC; `doSave` refuses.
3. R2.3, R2.5, R2.6, R3.7: collapse the three picker readers, make the stub probe structural, delete `detectFileVersion` and its twelve dead mocks (plus the load-bearing thirteenth, rewritten), carry `payloadError` out to all four callers with the arm ordered ahead of the `syncStore.error` arm and the translated `lastError`. Tests: `connectStorage.test.ts` rewritten off the `fileSync` mock, with a `4.0`, a `5.0` and a `6.0` envelope all resolving `adopt-existing` and `'{}'` / `''` / `null` resolving `adopt-stub`; a picker load of a 6.0 file surfaces `podNewerVersion` copy in `SettingsPage` (where today it surfaces NOTHING), in `LoadPodView`, and in `JoinPodView`; `manualImport` renders a translated key rather than a raw string.
4. R3.8 to R3.10: the `podAccess` code plus classifier arm plus `POD_ACCESS_SEVERITY[code]` in the rebind report; `joinCodeForBlocker` and its two call sites. Tests: `ALL_CODES` gains the code and the new completeness assertion; `classifyDriveFailure` returns it for the typed error even when `navigator.onLine` is false (the ordering pin); a rebind onto a 6.0 file returns the new code and does not page; `useJoinFlow` maps both the decrypt and the pick-and-load path to `FILE_NEWER_VERSION`, and a `PodLineageError` through the same helper returns `null`.
5. R4: `guardLineage` returning `{ action, verdict }` and its three test files, `nextLineage` in `docOps.ts` with `generateUUID` and its warning comment moved, the `stampNewGeneration` flag and the stamp inside the install, `compactDoc` switched to the helper. Tests: "restore on A, poll on B, B adopts rather than republishes"; "choosing the live compacted file over a stale local document mints nothing"; "the LineageBanner's conflict adopt mints nothing"; "a first-load adopt with no local document mints nothing"; "a user-file rebase FALLBACK adopt mints nothing"; "the stamped adopt returns `dirty: true`, so the caller publishes".
6. R5: `buildExportEnvelope({ compactionBackup: true })`. Test: the safety copy `aux.write` body and the manual export carry `"version":"5.0"` while the family's ordinary Settings export before compaction carries 4.0.
7. R6: gate deletion, the `membersOnOlderVersions` rename and header rewrite, `usePodHealth.olderVersion` + `olderVersionNames`, Settings, confirm, toast, strings; delete the four keys; `npm run translate`. Tests: the ladder never refuses on soak (with a stale member present, `compactDoc` IS called); the notice names people; the confirm's `detail` carries them; the toast names them; `usePodCompaction` no longer imports the reading at all; the two soak-refusal tests are deleted and the `t` stub's two special cases go with them.
8. R7 documents; Help Center article; CHANGELOG.
9. Full gate; commit; push. No deploy.

DRY audit, each entry naming the ONE thing and where it lives:

- One lineage mint: `nextLineage` in `worker/docOps.ts`, beside `docLineage`, used by `compactDoc`, the restore stamp and the diagnostic.
- One version derivation: `beanpodVersionFor` in `fileSync.ts`, reached by `reEncryptEnvelope` AND `createBeanpodV4`, and read once more (not re-implemented) by R1.8's log line. No version literal exists anywhere else after this change.
- One known-version set with ONE reader: `parseBeanpodV4`. `detectFileVersion` and the three duplicated picker branches are deleted rather than taught the set.
- One boundary shape for the export RPC: `ExportedPayload` in `protocol.ts`, imported by the worker function and the client wrapper instead of each hand-writing it.
- One "newer than I understand" question: `PayloadLoadError.needsAppUpdate`, answered by the class and read by `payloadErrorKind`, `classifyDriveFailure` and `joinCodeForBlocker`. No `instanceof UnsupportedBeanpodVersionError` anywhere outside the class itself.
- One payload-failure discriminator: `payloadErrorKind`, with three exhaustive tables over it (inline key, overlay key, is-it-an-incident) replacing three hand-written ladders that had already drifted.
- One inline-copy resolver: `payloadErrorMessageKey`, which `PayloadLoadError.inlineMessageKey` already delegates to. No subclass overrides it.
- One picker-failure carry: `payloadError` on the result, the field `decryptPendingFile` already returns and both pages already render, now reaching all four callers, ahead of the raw-string arm.
- One pod-access taxonomy: `POD_ACCESS_ERRORS` plus `POD_ACCESS_SEVERITY`, extended by one row rather than by an arm at a call site, with their agreement pinned by a loop whose input list is now itself checked for completeness.
- One join mapper: `joinCodeForBlocker`, which owns the `instanceof` and the `keyMayBeWrong` guard so neither call site re-derives them.
- One reading of who is behind: `membersOnOlderVersions`, surfaced once through `usePodHealth`, consumed by the notice, the confirm and the toast.
- One name joiner: `formatNames`.
- One lineage decision: `guardLineage`, now returning both halves of its answer so no caller recomputes either.

Nothing new is added where an existing pattern already has the right shape, and three things pass 1 proposed to add (a worker op, a protocol message, a getter override) are still not added.

Error handling: every failure path already exists and is classified; this plan changes classifications and closes places where a classification was DROPPED (`loadFromNewFile`'s bare `{success:false}` at all four callers, `loadFromGoogleDrive`'s raw English `error.value`, `manualImport`'s developer string rendered as UI, the three picker catches' raw English `lastError`). It adds no bare catches. The one new throw (R3.5) is typed at the source so no caller has to classify it, and the three catches in R2.3 that used to synthesise an "Unsupported file version" string now re-surface the typed error instead of inventing a second vocabulary for it. `beanpodVersionFor`, `payloadErrorKind`, `joinCodeForBlocker`, `nextLineage` and `membersOnOlderVersions` are pure. The restore stamp runs inside the worker's existing single-assignment discipline (compose fully, then install), so a throw leaves the document untouched.

## Files Affected

- `src/types/syncFileV4.ts` (`BeanpodVersion`)
- `src/types/sync.ts` (`needsAppUpdate` and `blockDetail` on `PayloadLoadError`, `UnsupportedBeanpodVersionError`, `PodBlockMessageKey`, `PayloadErrorKind` + `payloadErrorKind` + `PAYLOAD_INLINE_KEY`, `payloadErrorMessageKey` rewritten over the table)
- `src/services/sync/fileSync.ts` (`beanpodVersionFor`, known set, parse throw, `reEncryptEnvelope` and `createBeanpodV4` signatures; `detectFileVersion` DELETED)
- `src/services/sync/connectStorage.ts` (`isStubBeanpod` structural, no parse; `detectFileVersion` import removed)
- `src/services/sync/podLineage.ts` (`guardLineage` returns `{ action, verdict }`)
- `src/services/sync/syncService.ts` (`doSave` passes the lineage and emits the `pod-version` transition; the three picker readers collapsed with translated `lastError` + `payloadError`; `OpenFileResult.payloadError`; `rawText` removed; `fetchAndMergeRemote` wrap; `noteRemoteUnreadable` forwards `blockDetail`)
- `src/stores/syncStore.ts` (`createNewFile` passes the lineage, `buildExportEnvelope` destructures the lineage + takes `compactionBackup`, `loadFromNewFile` / `loadFromDroppedFile` / `manualImport` carry `payloadError`, `loadFromGoogleDrive` translated error + `payloadError`, `rebindPodFile` severity from the table)
- `src/utils/podAccess.ts` (`FILE_NEWER_VERSION` code, registry entry, severity entry, `classifyDriveFailure` arm placed FIRST)
- `src/services/automerge/worker/protocol.ts` (the `ExportedPayload` result TYPE only; still no new op)
- `src/services/automerge/worker/docOps.ts` (`nextLineage`; `generateUUID` import and its warning comment moved here)
- `src/services/automerge/worker/applyAndProject.ts` (`exportEncryptedPayload` returns the lineage; `compactDoc` uses `nextLineage`; `generateUUID` import removed; the `stampNewGeneration` flag and the `ours-newer` x `user-file` stamp at the install)
- `src/services/automerge/worker/docClient.ts` (return type of `exportEncryptedPayload`, now imported rather than restated)
- `src/utils/payloadFailureSurface.ts` (`PAYLOAD_OVERLAY_KEY` and `PAYLOAD_IS_INCIDENT` tables replacing the two ladders; `import type { UIStringKey }`)
- `src/composables/useJoinFlow.ts` (`FILE_NEWER_VERSION` entry, `joinCodeForBlocker`, its second call site in `doPickAndLoad`)
- `src/composables/usePodCompaction.ts` (delete `refuseSoak`, the `not-soaked` code and the local `soak()`; read `olderVersion` / `olderVersionNames` / `olderVersionNotice` from `usePodHealth`; `detail` on the confirm; `compactionBackup` on the backup build; note update)
- `src/composables/usePodHealth.ts` (`waitingOn` renamed `olderVersion`; `olderVersionNames` and `olderVersionNotice` added; gains `useTranslation` + `fillTemplate`)
- `src/services/pod/podSoak.ts` (`evaluateSoak` renamed to `membersOnOlderVersions`, returns `string[]`; `SoakVerdict` deleted; header rewritten)
- `src/pages/SettingsPage.vue` (notice and rule; the missing failure arm on `handleLoadFromFileConfirmed`; `handleManualImport`'s two bare English strings; `formatNames` and `fillTemplate` imports removed)
- `src/components/login/LoadPodView.vue` (the `payloadError` arm in `handleLoadFile`, placed above the `syncStore.error` arm)
- `src/components/login/JoinPodView.vue` (the `payloadError` arm in `handleLocalLoadResult`, above the `syncStore.error` arm, covering both entry points; its inline result type widened)
- `src/services/translation/uiStrings.ts` (+ `public/translations/zh.json` via the pipeline)
- `src/services/automerge/__diagnostics__/beanpodProfile.spec.ts`
- NOT changed, and deliberately: `src/services/sync/envelopeMerge.ts` (the spread stays; the derivation is what protects), `src/components/common/LineageBanner.vue`, `src/composables/useLoginFlow.ts`, `src/pages/LoginPage.vue`, `src/components/login/ResumePodSetup.vue`, `src/composables/useBiometricSignIn.ts` (all inherit the copy through `payloadErrorMessageKey`), `src/composables/useConfirm.ts` (`detail` already exists), `src/composables/usePodExport.ts` (its `buildExportEnvelope()` call stays argument-free), `src/stores/familyStore.ts` (still imports `REQUIRED_EPOCH`), `eslint.config.js` (the lineage import ban already scopes the guard to the one file this plan edits)
- Tests, named because each one BREAKS or must be added, not as a category:
  - `src/services/sync/fileSync.test.ts` (5.0 accepted, 6.0 typed; the `detectFileVersion` block `:125-142` and its import `:13` deleted; the two positional `createBeanpodV4` calls `:38`, `:53`)
  - `src/services/sync/__tests__/fileSync.writerVersion.test.ts:12` (positional `createBeanpodV4`)
  - `src/services/sync/__tests__/connectStorage.test.ts` (`:34-37` mock deleted, `:210-215` rewritten against real text)
  - `src/services/sync/__tests__/envelopeMerge.test.ts` (`incoming.version` still copied)
  - `src/services/sync/__tests__/fetchAndMergeRemote.test.ts` (the typed throw is not relabelled)
  - `src/utils/__tests__/podAccess.test.ts` (`ALL_CODES:22-30` gains the code, plus the completeness assertion, plus the classifier-ordering case)
  - `src/services/sync/__tests__/podLineage.test.ts` (`:100-102`, `:123` read `.action`; one new `.verdict` case)
  - `src/services/sync/__tests__/lineageProtectsPeerEdits.test.ts` (`:113`, `:132` read `.action`)
  - `src/services/automerge/worker/__tests__/lineageBasis.test.ts` (`:22`, `:28`, `:126`; the forced-guard hook retyped, and missing this leaves the suite green and inert)
  - a new save-path version test that does NOT mock `@/services/sync/fileSync` (the Trap 1 pin), plus a boundary pin for the dropped `lineage`
  - `rebase.test.ts` or a new `restoreStamp.test.ts` for R4's four minting cases
  - `src/composables/__tests__/usePodCompaction.test.ts` (`:34-36` mock typed as `ReturnType<typeof usePodHealth>`; the `t` stub `:47-52` loses its two special cases; the soak-refusal tests `:452-475` and `:476-497` DELETED; `:500-...` retargeted at `compaction.doneOlderVersion`; one new test that a stale member no longer blocks the ladder)
  - `src/composables/__tests__/usePodHealth.dueSignal.test.ts` (`:101`, `:111`, `:121` renamed to `olderVersion`)
  - `src/services/pod/__tests__/podSoak.test.ts` (eight `evaluateSoak` sites renamed; the `v.ok` assertions become array assertions)
  - `useJoinFlow` tests, `LoadPodView.test.ts`
  - the thirteen suites that mock `reEncryptEnvelope` and the thirteen that mock `detectFileVersion` (listed in the Testing Plan)
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
  - `pod-lineage` / `logMergeTerminus` already emits `action: 'kept-local'` and `action: 'adopted'` at both termini (`docClient.ts:1262-1285`). A repeated `kept-local` on one `family_id` is the signature of a stale device fighting the fleet; a burst of `adopted` across a family after one device restored is the signature of a restore that stuck. No new event; the plan adds a CloudWatch query note to the runbook.
  - `pod-load-failure` for the new error is ALREADY correct in its classification and needs no change there: `PayloadLoadError.latches` is already `false` for `step === 'parse'` (`src/types/sync.ts:320-322`), and `noteRemoteUnreadable` already reports every non-latching blocker at `severity: 'warning'` with `error_code: err.step`, under a comment that already names "a pod from a newer build" (`syncService.ts:120-142`). That half is a TEST that pins it, not a change.
    - It does need ONE line: today the context is `{ action, error_code }` only (`syncService.ts:140`), so a 6.0 refusal is indistinguishable in CloudWatch from a torn read, which is the one query this plan says it needs. `noteRemoteUnreadable` forwards `detail: err.blockDetail` when present (R3.1). The version rides in `detail`, never in `message`, so the (surface, message) dedup bucket is unchanged. No `instanceof` is involved, so the DRY rule holds.
  - **`pod-version`, new, emitted by `doSave` on transition (R1.8).** `detail: version=<v>,seq=<n|none>`. This replaces the Pass 3 promise that `usePodCompaction`'s `published` event would carry `version=5.0`, which was not emittable: that composable never sees the envelope version (`reEncryptEnvelope` builds a local object and discards it, `fileSync.ts:214-222`, and the in-memory envelope is deliberately stale per Assumption 3), so the string would have been a constant that reported 5.0 during the exact regression it existed to detect. Emitted from the writer, it is a measurement: `version=4.0,seq=none` on a family whose peers report a seq is the alarm for a `lineage` dropped across the worker boundary, which is this plan's only remaining silent failure route.
  - `pod-compaction` `published` (existing, `usePodCompaction.ts:409-418`) is UNCHANGED. The version claim moves to `pod-version`; the rate of compactions is already countable from `action: 'published'`.
  - No new context key anywhere: `detail` is allowlisted (`src/utils/diagnosticContext.ts:185`) and already used by `usePodCompaction` (`:348`, `:375`); `build_sha` and `family_id` are auto-injected (`diagnosticContext.ts:499`, `:508`). No store-declaration update is required, and none may be made.
- **Failure modes covered**: a compacted pod written as 4.0 (impossible by construction under R1, pinned by the save-path test, closed at the boundary by the shared `ExportedPayload` type, and now VISIBLE in the field through `pod-version`); a stale overwrite (the `kept-local` count); a device refusing a 5.0 or 6.0 file (`parse` at warning, non-latching, with the version in `detail`); a restore that did not stick (peers would log `kept-local` instead of `adopted`; the R4 test pins the opposite); a new device minting a spurious generation on first sync (the first-load-adopt test pins that it does not; in the field it would show as a burst of `adopted` across the fleet after one device joined); a picker load that fails with no message (now impossible: the three catches carry `payloadError`, all four callers render it, and the arm sits above the raw-string arm).
- **Success-path signal**: `pod-version` with `version=5.0` at the first save after a compaction; `adopted` at both termini after a restore; `published` for the compaction itself.
- **Critical vs telemetry**: nothing about a newer version pages. Three sites are made to agree on that through ONE member: `PAYLOAD_IS_INCIDENT['needs-update']` is `false`, so `reportPayloadFailure` returns early; `rebindPodFile` reads `POD_ACCESS_SEVERITY['FILE_NEWER_VERSION'] === 'warning'` instead of its hardcoded `critical`; `JOIN_ERRORS.FILE_NEWER_VERSION` is `severity: 'warning'`, not the `critical` that `FILE_CORRUPT` carries. A genuine torn-read `parse` failure still pages, because it is still an incident. `pod-version` is `info`.
- **Privacy**: no document content, no names, no filenames in any event. The version string is a two-character constant and the seq is a small integer.

## Acceptance Criteria

- [ ] A never-compacted family writes a byte-identical 4.0 envelope before and after this change (fixture test), including the `createNewFile` path now that its literal is gone.
- [ ] The compaction publish writes 5.0; the `kept-local` republish writes 5.0; the safety copy and the compaction export write 5.0; the ordinary Settings export of a never-compacted family writes 4.0.
- [ ] `beanpodVersionFor` is the only place a version string is chosen: no `'4.0'` or `'5.0'` literal remains in a writer (`createBeanpodV4` and `reEncryptEnvelope` both call it).
- [ ] `exportEncryptedPayload`'s result shape is declared ONCE, in `protocol.ts`, and both the worker function and the `docClient` wrapper reference it.
- [ ] `doSave` emits `pod-version` on the first save of a session and again only when the derived version or seq changes, with `detail: version=5.0,seq=1` after a compaction, and never per save.
- [ ] `parseBeanpodV4` accepts 5.0 and throws `UnsupportedBeanpodVersionError` (`instanceof PayloadLoadError`, not `CorruptPayloadError`, `latches === false`, `keyMayBeWrong === false`, `needsAppUpdate === true`) for 6.0.
- [ ] `payloadErrorKind` returns `needs-update` (not `unreadable`) for the new class, and `payloadErrorMessageKey(err)` and `err.inlineMessageKey` return the SAME key for it (the divergence pin), with no subclass override of `inlineMessageKey`.
- [ ] All three payload-failure decisions (inline key, overlay key, is-it-an-incident) are exhaustive tables over `PayloadErrorKind`, so adding a kind fails the build in three places. A test asserts each table has an entry for every kind.
- [ ] Every surfacing site shows `podNewerVersion` copy for a 6.0 file; no site wipes the cache or re-prompts for a password (asserted, not inferred, at the six sites P5 Trap 4 lists).
- [ ] Picking a 6.0 file from Settings shows a message; today it shows nothing at all. The same file in `LoadPodView` and in `JoinPodView` shows the same message rather than `auth.fileLoadFailed` or a raw exception string, and `manualImport` no longer renders a raw English developer string. In all four, the arm that renders it sits ABOVE the `syncStore.error` arm.
- [ ] Nothing about a newer version pages Slack: `reportPayloadFailure` is silent for it, the rebind report is `warning`, and the join code is `warning`. A `parse` `CorruptPayloadError` still pages. A 6.0 refusal reaches CloudWatch with `detail: version=6.0`.
- [ ] `classifyDriveFailure` returns `FILE_NEWER_VERSION` for the typed error even with `navigator.onLine === false`, and `ALL_CODES` in `podAccess.test.ts` is asserted complete against `POD_ACCESS_ERRORS`.
- [ ] `detectFileVersion` no longer exists, and no production file or test mock references it.
- [ ] `isStubBeanpod` performs no `JSON.parse` and is false for any non-empty text other than `{}`; a 5.0 and a 6.0 file at a colliding name both resolve `adopt-existing`.
- [ ] Restore on A, poll on B: B adopts. Choosing the live file over a stale local document mints no generation; the LineageBanner's conflict adopt mints no generation; the `user-file` rebase fallback adopt mints no generation; a first-load adopt on a device with no local document mints no generation. No new worker RPC and no new protocol OP was added.
- [ ] `guardLineage` returns `{ action, verdict }`, has exactly one production caller, and all three test files that call it were updated (including `lineageBasis.test.ts`'s forced-guard hook, which would otherwise pass while testing nothing).
- [ ] `generateUUID` and its non-secure-origin warning comment live in `docOps.ts`, and `applyAndProject.ts` no longer imports it.
- [ ] The ladder has no soak refusal; the notice, confirm and toast name people, all three from `usePodHealth`; the four deleted keys are gone from `uiStrings.ts` and `zh.json`; `podSoak.ts`'s header no longer describes a gate.
- [ ] No string names an app version for a member (it would always be absent), and no string asks anyone to open beanies on every device.
- [ ] Every string this plan adds or changes has both `en` and `beanie` values, and `npm run translate` parses `uiStrings.ts` cleanly.
- [ ] `beanpodProfile.spec.ts` stamps through `nextLineage` and passes the lineage.
- [ ] Help Center article added and matches the shipped copy in all four registers.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; no new context key.
- [ ] Documents in R7 updated, including the follow-up issue for the `unreadable` overlay copy; CHANGELOG entry.
- [ ] Full gate green (vue-tsc, eslint, stylelint, vitest); every new test mutation-checked against the specific regression it pins.

## Testing Plan

1. Unit, as listed under Approach, each mutation-checked. The eight that matter most, and the mutation each must fail on:
   - Trap 1 pin: must fail when `reEncryptEnvelope` reads `envelope.version` instead of the lineage.
   - Boundary pin: must fail when the worker's `exportEncryptedPayload` stops returning `lineage` (a `4.0` write for a compacted document, with no type error to catch it).
   - Arm-order pin: must fail when `payloadErrorKind` tests `step === 'parse'` before `needsAppUpdate` (every 6.0 file would resolve to `podUnreadable.inline` and the new copy would be dead).
   - Divergence pin: must fail when the `needs-update` row is removed from `PAYLOAD_INLINE_KEY` and re-added as a subclass `inlineMessageKey` override.
   - R4 stamp pin: must fail when the stamp is skipped; must ALSO fail when it is applied on every `user-file` adopt (the conflict case); must ALSO fail when it is applied at the install branch unconditionally (the first-load case).
   - Classifier-order pin: must fail when the `needsAppUpdate` arm is placed after the `navigator.onLine` check.
   - Registry-completeness pin: must fail when a code is added to `POD_ACCESS_ERRORS` without being added to `ALL_CODES`.
   - Stub-probe pin: must fail when the `!== '4.0'` returns.
   - Table-exhaustiveness pin: must fail when a sixth `PayloadErrorKind` is added without rows in all three tables.
2. **The version tests must not run against a mocked `fileSync`.** `reEncryptEnvelope` is currently mocked in thirteen suites, most returning the literal `'{"version":"4.0"}'`: `createNewFile.test.ts:213`, `syncAutoSave.test.ts:213`, `syncStore.verifyPodAccess.test.ts:188`, `syncStore.migrate.test.ts:136`, `selectNativeLocalFile.test.ts:43`, `saveFailureTracking.test.ts:18`, `persistedBytes.test.ts:18`, `syncStore.saveStatus.test.ts:89`, `syncStore.bannerVisibility.test.ts:127`, `syncStore.openBaselineTerminus.test.ts:93`, `authStore.passwordRotation.test.ts:106`, `syncStore.export.test.ts:54`, `fetchAndMergeRemote.test.ts:28`. A Trap 1 pin written in any of those files would assert the MOCK's hardcoded 4.0 and stay green through the exact regression it exists to catch. The new save-path test either lives in a file that does not mock `@/services/sync/fileSync`, or uses `importActual` for it, and the test says so in a comment.
3. **The `detectFileVersion` mocks are deleted in the same sweep**, in the same thirteen-ish set: `authStore.passwordRotation.test.ts:107`, `syncStore.saveStatus.test.ts:91`, `syncStore.openBaselineTerminus.test.ts:94`, `syncAutoSave.test.ts:215`, `syncStore.bannerVisibility.test.ts:129`, `syncStore.verifyPodAccess.test.ts:192`, `syncStore.export.test.ts:59`, `selectNativeLocalFile.test.ts:45`, `saveFailureTracking.test.ts:20`, `syncStore.migrate.test.ts:140`, `persistedBytes.test.ts:20`, `fetchAndMergeRemote.test.ts:29` (twelve dead stubs), plus `connectStorage.test.ts:34-37`, which is NOT dead: it drives `isStubBeanpod`, so that suite is rewritten against real envelope text under R2.5. Note several of these stubs return the NUMBER `4` rather than `'4.0'`, which is itself evidence nothing was reading them.
4. **`usePodCompaction.test.ts` needs four separate edits, not one.** `:34-36` mocks `usePodHealth` returning only `{ canCompactPod }`, so R6.3's new fields would arrive as `undefined`; type the mock's return as `ReturnType<typeof usePodHealth>` so a missing field is a compile error. `:47-52`'s `t` stub special-cases `compaction.refused.not-soaked.named` and `compaction.doneButBehind`, both deleted keys. `:452-475` ("NAMES who it is waiting on from the FIRST reading too") and `:476-497` ("names who it is waiting for once the projection is current") assert a refusal that no longer exists and are DELETED, replaced by one test that a stale member does NOT block: with `hooks.members` holding a behind member, `docClient.compactDoc` IS called. The completion test that follows retargets `compaction.doneButBehind` to `compaction.doneOlderVersion`.
5. Local two-browser soak on `npm run dev` (flag on in dev by default): compact on A; B (offline with an edit) reconnects and rebases; reload A and confirm B's edit arrived (the publish-restore pin from `e395b1d4`); confirm the notice names B's member before compacting.
6. Restore drill: restore the safety copy on A through Settings, Load another Family Data File; confirm B ADOPTS rather than reverting (watch B's console for `open terminus adopted`, not `kept-local`); confirm the restored family then compacts again cleanly and stays 5.0. Then sign in on a THIRD, cache-free browser profile and confirm it adopts without minting (no `adopted` burst on A and B afterwards).
7. Newer-version drill on the CURRENT build, which is the half CI cannot fake convincingly on its own: hand-edit a `.beanpod` to `"version":"6.0"` and walk it through all five surfaces (Settings picker, `LoadPodView` picker, `JoinPodView` drop zone, a Drive rebind, a join link). Each must show the update message, none may clear data or re-prompt for a password, and CloudWatch must show a `warning` with `detail: version=6.0` and no page.
8. The deploy-and-enable sequence, greg's to run, from P6 section 7:
   1. Land this plan, flag OFF. Every pod on Earth is still 4.0.
   2. Deploy web and native. Nothing user-visible changes.
   3. Watch the drain with the login-by-build CloudWatch query (Assumption 4: `build_sha` is on every event and `family_id` is the correlation key). There is no safety threshold to wait for under 5.0; the drain decides how many people the notice will name.
   4. On-device acceptance on greg's family BEFORE enabling for anyone else: the Tab A9+/A7 on the new build adopts and opens in the measured ~50MB; a device pinned to `c3a6be98` (the old open-testing APK, or a browser profile with the service worker disabled) shows stale data under "Could not refresh", an edit plus save overwrites the pod as 4.0, a current device republishes it as 5.0 (visible as a `pod-version` transition), and the stale device is refused again; a restore from a third device is ADOPTED by the fleet. Nothing in CI can exercise a pinned old build against a live Drive file; this run is the acceptance criterion for the mechanism itself.
   5. Enable `podCompaction` for greg's family via the existing override, then generally.
9. Later, optional: once the stale population reads ~0 for a release cycle, consider writing 5.0 for every family and closing the deployed stub-probe hazard for good.

## Review Passes

- **Pass 1 (Initial draft)**: drafted from the premise audit; R1 document-derived version as the centre; R2 to R7 as the audit's four required changes plus the error class, the copy, and the documents.
- **Pass 2 (DRY + error handling)**: verified every reuse claim in the tree. Removed three additions the code already had a place for (a worker op for the restore stamp, a subclass `inlineMessageKey` override, a widened `detectFileVersion`), collapsed the three duplicated picker readers and deleted `detectFileVersion` and the unread `rawText` with them, routed the new "newer than I understand" question through ONE base-class member read by five dispatchers, moved the rebind arm into `classifyDriveFailure` and the structured `POD_ACCESS_ERRORS` registry, gave the join flow one mapper instead of two, collapsed `SoakVerdict` to its array and rendered the notice from `usePodHealth`'s existing single reading, and closed a genuine silent failure the plan had not covered: a picked file with an unreadable version shows the user NOTHING in Settings today.
- **Pass 3 (Sustainability)**: found R4's stamp condition unreadable where the plan put it (`guardLineage` discards the verdict, and its install branch is shared with the first-load adopt, so a literal reading would make every new device mint a generation), found that the two payload-failure ladders R3 was about to extend have ALREADY drifted and replaced them with one discriminator plus three exhaustive tables, replaced the `atLeast` "floor" that silently downgrades at the next bump with an intent-shaped option, folded `createBeanpodV4`'s literal into the same single derivation, made the worker/client export shape one type so a dropped `lineage` is a compile error rather than a silent 4.0, extended the silent-failure fix to all four callers of `loadFromNewFile`, gave the join mapper ownership of its own narrowing, made the "version rides in `detail`" observability promise implementable, listed the thirteen suites whose `reEncryptEnvelope` mock would keep the Trap 1 pin green, and renamed the soak reading so a deleted gate does not leave its doc comment behind.
- **Pass 4 (Fresh-eyes sweep)**: caught seven things the plan would have shipped wrong and fixed each against the code. The notice would have rendered "Sam (undefined)" for every person, because `appVersion` is absent on exactly the members `lineageEpoch` can name (`models.ts:347-352`), so the version is dropped from the reading and the copy. The `guardLineage` signature change breaks three test files, one of which (`lineageBasis.test.ts`'s forced-guard hook) would have stayed green while testing nothing. The new `payloadError` arm would have been unreachable behind the `syncStore.error` arm three lines above it, which mirrors a raw English exception string. `podAccess.test.ts`'s "every code" loop iterates a hand-written array, so the new severity row would not have been checked at all. The promised `version=5.0` observability could not be emitted honestly from `usePodCompaction`, so it moved to a transition-gated `pod-version` event in the writer. R6 asked `SettingsPage` to drop `fillTemplate` while rendering a string that needs it, resolved by composing the notice once in `usePodHealth`. And the completion toast turned out to hold a second hand-rolled name joiner plus a comment asserting the very hazard 5.0 removes. Also resolved Assumptions 4 and 7 against the allowlist, pinned the load-bearing order in `payloadErrorKind` and `classifyDriveFailure`, moved `generateUUID` and its warning with the mint, named the three positional `createBeanpodV4` callers and the four `usePodCompaction.test.ts` edits, and completed R6's copy with `en` and `beanie` for every added, changed and deleted key.

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

### Pass 4 review prompt

> Take one more pass at the plan and review again with fresh eyes. Review all activities proposed and confirm again that we are applying the most simple, secure, robust, and elegant solution, strictly following DRY principles, ensuring a focus on long term sustainability, maintenance, and reliability, and avoiding introducing any bugs or side effects. This will probably be the final iteration of the plan, so please ensure we have captured any relevant issues and are implementing the most robust and sustainable version of this plan.

</details>
