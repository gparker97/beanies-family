# Plan: A failed read is not an empty device, and a restore is not a move

> Date: 2026-09-07
> Related issues: None — direct implementation (tracker #90 follow-up)
> Plan file: `docs/plans/2026-09-07-cache-read-failure-and-provider-aware-restore.md`
> Investigation input (read, not re-derived): `docs/plans/2026-09-07-native-update-gate-review/BUG-drive-restore-provider-switch.md`
> Supersedes nothing. Blocks: the `podCompaction` prod rollout.

> **No GitHub issue created.** This plan was approved for direct implementation.

> **⚠️ RELEASE BLOCKER.** `podCompaction` is `true` in `featureFlags.committed.ts:18` (`142d25a8`), so the next prod deploy ships compaction to every family. Group A below is a silent-data-loss path that compaction makes reachable, and Group B is compaction's documented rollback route. Neither may ship after the other; both must land before the deploy.

> **Pass 2 note — the design got SMALLER.** Pass 1 proposed a third `LineageBasis` kind and a new refusal arm inside `applyAndProject.ts`. Verification showed that is unnecessary churn in the highest-risk file in the repo: every fact needed to refuse is known **on main, before the worker is called**. Group A is now a main-thread-only change with **zero** worker-protocol, error-codec or `applyAndProject.ts` edits. Pass 2 also corrects nine factual errors in the Pass-1 citations — including one that would have shipped the ADR-033 fork the plan says it prevents. See **Pass-1 Corrections** below.

> **Pass 4 note — the refusal had nowhere to render, a THIRD time, and this one is the subtlest.** Pass 3 fixed the latch and gave the refusal a banner. But the kind ternary `err instanceof PodLineageError ? 'lineage' : 'decrypt'` exists **twice**: at `:3610` (which Pass 3 converts) and again at `:3648` inside `mirrorServiceLatch` — which the 10-second poll's own `.finally()` (`:3790`) runs _immediately after_ `notePodUnopenable`. So the poll path — the exact path this bug travels — sets `'local-unreadable'` and then overwrites it with `'decrypt'` a moment later, leaving `podUnopenable` true and the new banner hidden. The same clobber fires from `useRemoteFileOverLocalDocument`'s `finally` (`:3718`), so a _failed_ recovery also loses the banner. Pass 4 also found `clearPodUnopenable:3749` would never clear the new kind, that `keepCurrentPod` would strand an **unconfigured** family with no provider at all, that S2's remedy is not implementable without a `remoteBaseline` codec change, that B8's non-Drive comparison is vacuous by construction, and that S3 is a hard **prerequisite** for Group A rather than a tidy-up. See **Pass-3 Corrections** below.
>
> **Pass 3 note — the refusal had nowhere to render, again.** Pass 2's Group A specified `latches = false` and "one new arm in `LineageBanner`". Reading the code shows that combination renders **nothing**: `notePodUnopenable` (`syncStore.ts:3605-3606`) mirrors `syncService.isRemoteBlocked()` and **early-returns** when the blocker did not latch, so `podBlockMessageKey` is never set; and `LineageBanner`'s gate (`:51`) is `backgroundSyncErrorKind === 'lineage'`, which `:3610` assigns only for `instanceof PodLineageError`. That is the same class of defect `564b0662` fixed yesterday — a refusal with no render site — arriving by a different door. Pass 3 fixes it, re-scopes S3 away from a generalisation the code explicitly argues against, moves the new "composable" into the module that already owns the question, corrects the `decryptPendingFileWithKey` signature claim (it has **no** `opts` bag, deliberately), and adds a **Complexity Budget**. See **Pass-2 Corrections** below.

## User Story

As a family member whose device could not read its own local copy, I want beanies to stop and tell me rather than quietly replace my unsaved work with the version from the family file, so that going offline for an afternoon never costs me what I wrote.

And as the family owner rolling back a compaction, I want "Load another Family Data File" to restore our family without moving it off Google Drive and stranding everyone else's device.

## Context

Two defects, found on the same afternoon, that meet at one line of code.

### Group A — a failed cache read is treated as "no local document"

greg reproduced this in the compaction acceptance drill. Session B, offline with an unsynced to-do, reconnected after session A compacted the pod. The to-do vanished. No banner, no rebase, nothing reached A.

The chain, verified against current `main`:

1. `cd7d3dd7` (today 10:26) removed `initAndLoadCache` from `RETRYABLE_METHODS` (`docClient.ts:528`) and bounded the cache open at `CACHE_OPEN_TIMEOUT_MS = 10_000` (**`src/services/automerge/worker/cache.ts:100`** — not `docClient.ts`, which Pass 1 implied). `cb936a19` (11:21) wrapped the opening call so `initAndLoadCache` now **rejects** instead of degrading quietly. `reseedCacheAfterCorruption` additionally refuses to re-open a database whose delete is queued — and an IndexedDB delete is blocked whenever another connection is open, which is the normal state with a second tab, and after any sign-out or family-switch.
2. The rejection lands in the catch at `syncStore.ts:924`, which records `cacheErrorName` (`:938`) and leaves `loadedFromCache = false`.
3. `syncStore.ts:980-981` then sends `basis = { kind: 'no-local-document' }` — the same value a genuinely empty device sends.
4. `applyAndProject.ts:898` sets `installWholesale = true`, and `:919` gates the **entire** lineage-guard block on `basis.kind !== 'no-local-document'`. `guardLineage` never runs, no rebase is attempted, no `PodLineageError` is thrown, so no banner renders. The resident document — which `initAndLoadCache` did **not** drop on this branch — is replaced wholesale at `:1030-1074`.

**The root cause predates today's commits.** The code conflates _"there is no local document"_ with _"we could not read the local document"_. `applyAndProject.ts:859` states the assumption outright: _"The lineage question is moot when there is nothing to lose."_ That is true for a fresh device and false for a device whose document exists but sits behind a blocked or timed-out handle. Today's lockout fix did not create the conflation; it changed the failure from a six-minute hang into a ten-second silent overwrite.

**The regression is pinned as expected behaviour.** `cb936a19` added a test asserting exactly this shape at `syncStore.resume.test.ts:505-507`:

```ts
expect(vi.mocked(docClient.mergeRemoteEnvelope).mock.calls[0]![2]).toEqual({
  kind: 'no-local-document',
});
```

inside `it('a cache that will NOT OPEN degrades to the remote instead of hanging')` (`:476`). The suite stays green while the app loses data. **That** test must be re-pointed.

> ⚠️ **There are THREE tests in this file that drive a cache rejection, and they mean three different things.** Pass 1 named one, Pass 2 named two. All three, precisely:
>
> - **`:471-473` — MUST NOT CHANGE.** The no-`familyId` cross-family test, whose comment (`:465-468`) says the basis must be `no-local-document` precisely so a `same` verdict cannot CRDT-merge the remote into a foreign family's document. Re-pointing it would reintroduce cross-family corruption.
> - **`:505-507` — the regression pin, re-pointed at the refusal.**
> - **`:510-538` — `it('counts the wholesale adopt, so a fleet-wide cache failure is not invisible')`.** It also mocks `initAndLoadCache` rejecting, `await`s `completeAutoLoad`, and asserts the `pod-open-degrade` `warn`. The event still fires (it is emitted at `:950`, **before** the basis at `:980`), but the test's name, its comment ("silently abandoning this device's document") and the event's own message string all become false. It must be re-pointed too — see **Observability Coverage → the message split**.
>   > ⚠️ **Pass-4 correction — this test will NOT fail on its own under Group A**, so the re-point is unenforced unless it is made so. It asserts only `surface`, `level: 'warn'`, `action` and `error_code: 'Error'` — every one of which stays true after the message split, because the **message string is not asserted**. The re-pointed test MUST assert the new message constant, or the split ships unverified and the third arm's telemetry is never proven to differ from the second's.

**A second route reaches the same install.** An RPC timeout tears the worker down; `spawn()` awaits the rehydrator, which _is_ `initAndLoadCache` (`src/services/automerge/worker/bootstrap.ts:29-35`); if that rejects, `reportRehydrateFailure` fires (`docClient.ts:355` / `:426`, reporter at `:368`), the client holds no document, and the auto-retried merge hits `!currentDoc` at the same `applyAndProject.ts:898` and installs wholesale — with nothing lineage-related logged at all.

**The counter-pressure is real and must be preserved.** `applyAndProject.ts:855-859` records why the arm exists: a device whose cache genuinely missed must still be able to adopt a compacted pod, or it is permanently stuck. And `:861-870` records that the arm is an _instruction, not a hint_ — three store paths rely on it because the worker may be holding a **different family's** document, and deriving the install from `!currentDoc` alone once caused a remote to be CRDT-merged into a foreign family's document and uploaded to the wrong file. Any fix must keep both properties.

> The four live `{ kind: 'no-local-document' }` producers are `syncStore.ts:981` (the buggy one), `:1367` (poll replace, no active family), `:1691` (`decryptPendingFile`, no `familyId`) and `:2532` (`decryptPendingFileWithKey`, no `familyId`). **Only `:981` changes.** The other three are the cross-family arm and are correct as written.

**The throw already has catchers — verified, and this bounds the change.** `replaceDocWithCacheRecovery` has exactly **three** callers: `syncStore.ts:1335` (`loadFromFile`'s replace branch), `:1685` (`decryptPendingFile`) and `:2526` (`decryptPendingFileWithKey`). Both decrypt functions already end in a catch that dispatches **structurally** on `isRemoteBlocker(e)` and calls `notePodUnopenable(e)` (`:1820-1832` and `:2665-2668`), and `loadFromFile`'s throw propagates to callers that do the same (`:3359-3365`, `:3468`, `:3510`). **So Group A's new throw needs no new catch anywhere.** It inherits the existing blocker plumbing end to end. What it _does_ need is a render site — see the next paragraph, which is the Pass-3 correction.

**⚠️ But the existing plumbing swallows a non-latching blocker.** `notePodUnopenable` (`syncStore.ts:3586`) does:

```ts
syncService.noteRemoteBlocked(err);
podUnopenable.value = !!syncService.isRemoteBlocked();
if (!podUnopenable.value) return; // recoverable: leave polling and the bar alone
```

and `noteRemoteBlocked`'s generic arm (`syncService.ts`) only sets the latch `if (err.latches)`. So a blocker with `latches = false` returns **before** `backgroundSyncError`, `backgroundSyncErrorKind` and `podBlockMessageKey` are assigned — nothing renders. And even with the latch set, `LineageBanner`'s gate is `podUnopenable && backgroundSyncErrorKind === 'lineage'` (`:51`), and `:3610` assigns `'lineage'` only for `instanceof PodLineageError`. Pass 2's "`latches = false` + one arm in `LineageBanner`" therefore produces a silent refusal — data preserved, but the user told nothing, which is half of A2 missing. The Approach section fixes this.

### Group B — "Load another Family Data File" ignores the provider and abandons every peer

This is compaction's **rollback route**. If a compaction goes wrong, restoring the pre-compaction safety copy is the documented way out. It does not work on the platform a developer would naturally test on.

`openAndLoadFile` (`syncService.ts:2162`) has two arms — `window.showOpenFilePicker` on Chromium desktop, an `<input type=file>` everywhere else — and neither consults the provider. Line `:2174` does `LocalStorageProvider.fromHandle(handle)` unconditionally and returns it as `result.provider`.

> ⚠️ **Pass-1 correction — the re-home is NOT in `syncService`.** `openAndLoadFile` only _carries_ a provider; it never installs one (it always returns `needsPassword: true` for a valid file). The durable re-home happens in **`syncStore.decryptPendingFile`**, in two branches at the tail of the function:
>
> - `:1733-1751` — `storeProviderConfig(activeFamilyId, { type: 'google_drive', driveFileId, … })` + `syncService.setProvider(GoogleDriveProvider.fromExisting(…))`, taken whenever `pending.driveFileId && pending.driveFileName`;
> - `:1754-1759` — `await pending.provider.persist(activeFamilyId)` + `syncService.setProvider(pending.provider)`, taken whenever `pending.provider` is set.
>
> **The identical pair is duplicated verbatim in `decryptPendingFileWithKey` at `:2571-2589` and `:2592-2597`.** The investigation names both (`BUG-drive-restore-provider-switch.md:203-222`); Pass 1 named neither and pointed the fix at the wrong file.
>
> ⚠️ **Pass-3 addendum — the duplication is ~58 lines, not ~25.** `syncStore.ts:1703-1760` and `:2540-2597` are byte-identical: the family-identity adoption (`createFamilyWithId` / `switchFamily`), the `initializeAuth` binding **and** both provider branches. Pass 2 proposed extracting only the provider tail. See **Approach → Group B step 2** for the scoping decision.

On Chromium desktop the family silently re-homes to a local file; peers stay on Drive and can never follow. On native, Firefox and Safari the same button leaves the family on Drive and the restore propagates correctly.

So the v5 plan's restore drill (`docs/plans/2026-09-06-compacted-pod-v5.md:521`) **passes or fails purely on which browser runs it, and it names none.**

The investigation found three further gaps, all confirmed:

- **A2.** The Drive-visible entry points (the login Drive list at `LoadPodView.vue:847`, the Google Picker via `loadSavedFileViaPicker` at `:488`) reach `decryptPendingFile(password)` / `decryptPendingFileWithKey(fk)` with no `userChoseThisFile` — `LoadPodView.vue:223`, `:586`, `:630` all pass nothing — so their lineage context is `baseline`, never `user-file`. For a device already holding the compacted document, picking the pre-compaction copy gives verdict `ours-newer` under `clean`/`dirty`, and `podLineage.ts:176` resolves that to `publish-local` — the device republishes its compacted document straight over the file the family just chose. **The Drive-visible route silently does the opposite of a restore.**
- **A3.** `compaction.safetyCopyNote` (`uiStrings.ts:4320`) tells the user the copy is "beside it in your storage" and to use "Load another Family Data File". On Chromium desktop that picker cannot see a Drive file at all. The note is untrue on that platform. (Its sibling `compaction.safetyCopyNoteManual` at `:4325` carries the same instruction and has the same problem.)
- **C3.** Nothing in the firehose distinguishes a restore that stuck from one that stranded. A logs a healthy `adopted` and then goes quiet on Drive forever; B keeps merging `same`. Absence is the one thing you cannot alert on.

**The safety copy IS selectable from the Google Picker — verified.** `isSafetyCopyName` filtering is applied in exactly one place, `driveService.ts:752` inside `findBeanpodInFolder`, which auto-selects. `pickBeanpodFile`'s views use `setQuery('*.beanpod')` (`drivePicker.ts:245`, `:252`) with no safety-copy filter, and `constants/compaction.ts:40-47` states the copy "stays VISIBLE in the human-facing picker — that is what makes it a rollback route someone can choose". B1's premise holds.

### Where the two groups meet

`docs/plans/2026-09-06-compacted-pod-v5.md` already records the known limitation: _"a restore from a device with NO local document reaches `no-local-document` before the guard, mints nothing, and silently returns the family to 4.0."_ That is the **same conflation as Group A**, on the restore path. Fixing A is a precondition for B being trustworthy. This is why they are one plan.

### What already exists, and must be wired rather than rebuilt

greg's instinct — "every family member and device should check the registry to see which data file they should be pointing to" — is correct, and most of the machinery is already built:

- The registry stores the family's canonical pointer (`provider` / `fileId` / `displayPath`, `registryService.ts:9`). Only the registered **owner** may move it; the guard is server-side in `infrastructure/lambda/registry/index.mjs`. `RegistryWriteResult.pointerAccepted` reports the outcome.
- `registerCurrentFamily(overrides, { pointerIntent: true })` (`syncStore.ts:5269`) is the existing deliberate pointer move, and already reports `severity: 'critical'` at `:5299` when a deliberate write is refused, because _"the registry now disagrees with where the pod actually is."_
- `checkCanonicalPod()` (`syncStore.ts:4029`, called from `verifyPodAccess` at `:3969`) already compares the device's `fileId` against the registry pointer and raises `CANONICAL_MISMATCH` carrying `canonicalFileId` + `canonicalName`, which `PodAccessBanner.vue:55`'s `switchToCanonical` consumes to call `rebindPodFile`.
- `attemptSilentConfigHeal` (`syncStore.ts:4255`) heals a device onto the registry pointer — **but only one with no provider installed**; it early-returns as idempotent at `:4256-4260` when a valid provider is already bound. That is precisely why peers did not follow.

Three gaps stop that chain working for a restore:

1. `checkCanonicalPod` returns early unless `getProviderType() === 'google_drive'` (`:4035`) — Drive-only.
2. It runs at most once per family per session (`checkedCanonicalFor`, `:408`, set at `:4036`), so a peer never notices a mid-session move.
3. The restore never moves the pointer, and on Chromium desktop actively re-homes the owner to a local file.

**And one existing refusal reframes the whole design.** `rebindPodFile` (`syncStore.ts:4753`) explicitly refuses a file whose name matches `isSafetyCopyName` (`:4769`):

> _"Accepting one would persist it as the provider and then move the REGISTRY POINTER to it, so every other member would be healed onto the backup. That is the ADR-033 fork this file exists to prevent."_

That refusal is correct, and it tells us what a restore must **not** be. A family must never end up living _on_ its own backup file: the backup would then be the pod, a future compaction would write a second backup beside it (`constants/compaction.ts:22-33` documents that the marker deliberately **stacks** for exactly this case), and the naming convention that identifies safety copies would be load-bearing for the family's real data. This directly shapes the Group B design below and is the reason this plan does **not** implement greg's literal "point the whole family at the backup file" mechanism.

> ⚠️ **And it is why Pass 1's Group B, as written, would have caused that fork.** Pass 1's B1 routes a Drive family through `usePickBeanpodFile` — whose only existing handoff is `syncStore.loadFromGoogleDrive(fileId, fileName)` (`:4453`), which sets `pending.driveFileId` / `pending.driveFileName` (`:4519-4523`). `decryptPendingFile:1733` then `storeProviderConfig`s the family onto **the safety copy's Drive fileId** and moves the pointer behind it. Combining Option 1 with Option 2 is only safe if the no-re-home suppression covers the **Drive** branch as well as the local one. Pass 1 never said so, and would have shipped a Chromium/Firefox restore that forks the family onto its own backup.

## Requirements

### Group A — a read failure is not an empty device

**A1.** The three states must be distinguished: a device that **has** a document, a device that **has none** (fresh install, family switch, genuine cache miss), and a device whose document **could not be read**. The third must never reach the wholesale-install branch.

> **Design change from Pass 1.** Pass 1 required a third `LineageBasis` kind. Pass 2 achieves the same guarantee **without touching `LineageBasis`, `protocol.ts`, the error codec or `applyAndProject.ts`** — see **Approach → Group A**. The requirement is the behaviour, not the mechanism.

**A2.** The unreadable case takes the **fail-safe** direction: refuse the merge, raise the existing blocker machinery so the user gets the persistent banner (or, before the shell exists, the fatal overlay) and a real choice, and log a triageable event. It must never install the remote wholesale, and it must never silently keep going.

> **Pass-3 addition — "gets the banner" is a testable claim, not a comment.** A2 is only satisfied if a mounted test renders the banner from the store state the refusal actually produces. Pass 2's `latches = false` design produced no render at all (see Context). The acceptance criteria now assert the rendered output, not the source.

**A3.** The genuine-miss case is **unchanged**: a device whose cache truly holds nothing still adopts, including a compacted pod. `applyAndProject.ts:855-859`'s constraint is preserved _by not editing that file at all_.

**A4.** The cross-family protection at `applyAndProject.ts:861-870` is preserved: the install decision remains an explicit instruction carried **in the request**, never re-derived from worker state a respawn can change underneath it. The three legitimate `no-local-document` producers (`:1367`, `:1691`, `:2532`) are untouched.

**A5.** The `!currentDoc` route at `:898` must be covered too. If the client holds no document _because a rehydrate failed_, that is an unreadable state, not an empty one. This is enforced at the **one main-thread chokepoint** (`docClient.mergeRemoteEnvelope`, `docClient.ts:1225`), so it covers every caller including ones that do not exist yet.

**A6.** `syncStore.resume.test.ts:505` (the "cache that will NOT OPEN" test) and `:510` (the "counts the wholesale adopt" test) are re-pointed at the refusal. **`:471` (the no-`familyId` cross-family test) is left exactly as it is, and a comment says why.** The new behaviour is mutation-checked, and each mutation verified to fail for the right reason.

**A7.** The refusal must not be a dead end. The banner's recovery action `useRemoteFileOverLocalDocument` (`syncStore.ts:3668`) re-enters `loadFromFile({ userChoseThisFile: true })` (`:3691`) and would hit the same unreadable cache. **The refusal is skipped when `chosenByUser` is true**, which mirrors the existing `user-file`-never-blocks policy (`podLineage.ts:161-178`) exactly rather than inventing a second rule. Without this the banner's only action re-raises the block it offers to resolve.

**A8b (new, Pass 4 — the kind must survive the poll).** `BackgroundSyncErrorKind` is assigned from the same `instanceof` ternary in **two** places: `syncStore.ts:3610` (inside `notePodUnopenable`) and `:3648` (inside `mirrorServiceLatch`). The 10-second poll calls `mirrorServiceLatch()` from its `.finally()` at `:3790`, which runs immediately after `notePodUnopenable` on the refusal path, so converting only `:3610` leaves `'local-unreadable'` overwritten by `'decrypt'` within the same tick and the banner never renders. `useRemoteFileOverLocalDocument`'s `finally` at `:3718` does the same, so a failed recovery also loses the banner. **Both sites must call one shared `blockerErrorKind(err)`** backed by the `satisfies Record<PodBlockMessageKey, BackgroundSyncErrorKind>` table. Mutation test: revert `:3648` alone — the mounted banner test must fail.

**A9 (new, Pass 4 — the latch must clear).** `clearPodUnopenable` (`syncStore.ts:3749`) nulls `backgroundSyncError` / `backgroundSyncErrorKind` only for `'decrypt' | 'lineage'`. A new kind leaves the stale message behind, so the next genuine failure re-assigns an identical string and `BackgroundSyncBar`'s watcher does not re-fire — precisely the bug the comment at `:3745-3748` records. Without this, the acceptance criterion "after the recovery action the banner is gone" **passes vacuously** via `podUnopenable = false` while the stale kind and message persist. The clear must cover every kind; make it exhaustive over the union rather than an `||` list.

**A8 (new, Pass 3).** The refusal must **latch**, and the latch must have exactly one exit. `latches: false` leaves `notePodUnopenable` early-returning at `:3606` with nothing rendered, and leaves the 10s poller re-downloading the whole pod against a device that cannot read its own copy — the download loop `notePodUnopenable`'s own comment exists to stop. `latches: true` is also the honest answer to the interface's question (`types/sync.ts:216-227`): while another connection holds the IndexedDB handle, retrying _within this session_ cannot help, and a save would write this device's absent-or-foreign document over the family file. The exits are the banner's action (`useRemoteFileOverLocalDocument` → `clearPodUnopenable()` + `retryAfterRemoteBlock()`) and a page reload, and the copy names both.

### Group B — a restore restores; it does not move the family

**B1.** On a family whose provider is Google Drive, "Load another Family Data File" must offer **Drive** files, so the safety copy the compaction note names is actually selectable.

**B2.** Native keeps the OS file sheet. `LoadPodView.vue:451-453` already records that Google Picker reliability on iOS WebKit is why native routes to the OS sheet; this plan does not relitigate that.

> **Pass-2 note on B1/B2 — reconcile with the surface that already does this.** `LoadPodView.handleOpenSavedFile` (`:459-479`) already dispatches by capability: native → OS sheet, web+FSA (Chromium) → local FSA picker, web without FSA → Google Picker. Settings must **not** copy that rule, because on Chromium it chooses the arm that cannot see Drive — the A3 defect. The Settings rule is _provider-first_: **Drive family + Picker available → Picker; otherwise the existing local/OS arm.** The two surfaces answer different questions (LoadPodView: "which picker can this platform run?"; Settings: "where does this family's data live?"), so the dispatch is factored into one **pure function** with the _reason_ as a parameter rather than duplicated or wrongly shared.
>
> **Pass-3 correction — it is not a composable, and only three lines move.** `handleOpenSavedFile` is not a pure dispatcher: its Chromium arm _toggles view state_ (`selectedSource.value`) and emits its own `logEvent`, and it returns nothing. The only thing extractable is the capability decision over `isNative()` / `supportsFileSystemAccess()` — which has no refs and no lifecycle, so it is not a composable. It goes in **`src/services/sync/capabilities.ts`**, the module that already exports `isNative`, `supportsFileSystemAccess` and `canUseLocalFiles`, and that both `LoadPodView` and `syncService` already import for exactly this question. See **Approach → Group B step 1**.

**B3.** The restore must **not change the family's storage provider, `fileId`, or Drive binding.** Reading a picked file replaces the _document_; it does not re-home the family. This must hold on **both** re-home branches (Drive and local).

> ⚠️ **Pass-4 correction — `keepCurrentPod` unconditionally would STRAND AN UNCONFIGURED FAMILY.** `handleLoadFromFileClick` / `handleLoadFromFileConfirmed` / `handleDecryptFile` are shared by **two mutually exclusive slabs**: the **unconfigured** one (`SettingsPage.vue:1625-1646`, the first-load "Load existing data file" case) and the **configured** one (`:1826-1848`, the restore case). On the unconfigured path there is no pod yet, so skipping `storeProviderConfig` + `setProvider` opens the document with **nowhere to save it** — a fresh, silent config-loss bug introduced by the fix for a data-loss bug.
>
> **The predicate is `hasPod = syncStore.isConfigured && !!syncStore.storageProviderType`, computed ONCE in the click handler** and used for _both_ the confirmation string (S5) and the `keepCurrentPod` argument. It is additionally **enforced inside `installPendingProvider`**: honour `keepCurrentPod` only when a provider is actually bound; otherwise re-home anyway and log, so a future caller cannot reintroduce this by passing the flag from the wrong slab. Mutation test: pass `keepCurrentPod` from the unconfigured path and assert a provider is still installed.

> **Pass-3 correction to Pass 2's mechanism.** Pass 2 said both decrypt functions "gain `keepCurrentPod?: boolean` on the **existing** `opts` object beside `userChoseThisFile`". **`decryptPendingFileWithKey` has no `opts` parameter** (`syncStore.ts:2504-2506`), and its body carries an explicit instruction not to add one: _"⚠️ NEVER `user-file` HERE, and deliberately no parameter to pass one. This is the passkey / biometric / trusted-device / PIN path"_ (`:2527-2531`). Its five callers are `LoadPodView` ×2, `useJoinFlow`, `useLoginFlow` ×2 and `useBiometricSignIn` — **none is a restore surface**, so the parameter would be dead on arrival _and_ would re-open the door that comment closes. The guard therefore lives in the extracted helper, `decryptPendingFile` passes it, and `decryptPendingFileWithKey` passes nothing.

**B4.** Consequently the registry pointer does **not** move on a restore, and `isSafetyCopyName`'s refusal in `rebindPodFile` stands unchanged. A family never lives on its own backup.

**B5.** Peers adopt through the **existing lineage mechanism**, not a new one. The restore stamps a new generation (`stampNewGeneration`, declared `applyAndProject.ts:917`, assigned `:925` when `act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file'`, applied `:1040`); peers read `adopt-remote` on their next poll and adopt. This already works — B3 is what lets it be reached.

**B6.** `userChoseThisFile: true` must continue to be passed as an **argument** from the confirmed dialog (`SettingsPage.vue:572`), never stored or inferred. ADR-036 is emphatic that the dialog is the authorisation, not the caller. The new restore-intent flag travels the **same way, on the same call, from the same site**.

**B7.** A genuine **move** (local ⇄ Drive) remains a separate, already-existing flow — "Move to Google Drive" / "Move to a local file" (`SettingsPage.vue:1778-1798`). This plan does not merge the two; it separates them properly, and the restore dialog's copy must stop promising to "switch to that file".

**B8 (re-scoped by Pass 4 — the non-Drive comparison is vacuous by construction).** `RegistryEntry.fileId` is documented "Google Drive file ID (future)" and `StorageProvider.getFileId()` returns `null` for a local provider, so `entry.fileId === provider.getFileId()` is **always equal** on a local family: dropping the Drive-only early return would add a comparison that can never fire. Switching the comparison to `displayPath` is worse — it false-positives on every device with a different local path, and then offers `switchToCanonical` → `rebindPodFile(fileId)`, which cannot act on a local pointer at all.

So B8 is: **keep the Drive `fileId` → `CANONICAL_MISMATCH` banner path exactly as it is**, and add **one diagnostic-only firehose arm** on `entry.provider !== syncService.getProviderType()` — a family whose registry says Drive while this device is on a local file is exactly the stranding C3 cannot see today. **No new banner state, no new recovery action, no new user-facing surface.** The `checkedCanonicalFor` latch is kept and invalidated by the events that can actually invalidate it, via one named function.

**B9.** Every failure arm of the new picker path is handled and speaks. `usePickBeanpodFile.pick()` never throws and returns a discriminated result (`PickBeanpodFileResult`, `drivePicker.ts:173-180`): `picked` | `cancelled` | `failed` with `reason: 'config' | 'load' | 'open' | 'auth' | 'iframe' | 'timeout'`. `loadFromGoogleDrive` returns `{ success, needsPassword, reason, status, payloadError }`. Both must be exhaustively handled in Settings, with `cancelled` saying nothing and every other arm producing translated user copy plus a `console.warn` naming the developer-facing cause.

> ⚠️ **Pass-4 correction — `describePickFailure` is a NEW table, not a de-duplication.** `LoadPodView.loadSavedFileViaPicker` (`:490-514`) has **no per-`reason` copy**: it is `formError.value = picked.message || t('auth.fileLoadFailed')`, which for `reason: 'config'` renders the raw English `'VITE_GOOGLE_API_KEY is not configured'` to the user — an existing, separate bug. So adopting the shared table in `LoadPodView` is a **deliberate copy change** that also fixes that leak, not a no-op refactor. The acceptance criterion "LoadPodView's existing behaviour unchanged" must therefore narrow to **the `selectedSource` toggle and the arm dispatch only**, and the copy change must be called out in the CHANGELOG.

> **Pass-3 addition — the reason→copy mapping is written ONCE.** `LoadPodView.loadSavedFileViaPicker` (`:490-514`) already contains a `picked`/`cancelled`/`failed` switch with its own `reportError`. Adding a second one in Settings is two copies of one table, which drift the first time `PickBeanpodFileResult` gains a `reason`. Extract `describePickFailure(result): { messageKey, errorCode }` (a pure function beside `PickBeanpodFileResult` in `drivePicker.ts`, `satisfies Record<PickFailureReason, …>` so a new reason is a compile error) and let each surface keep its own error ref and telemetry surface.

### Named secondary defects

**S1 (fix).** Terminus 4 — the live-poll merge path at `syncStore.ts:1292-1330`, which is the path a reconnecting peer actually takes — never calls `logMergeTerminus`. The only two call sites in the whole app are `syncStore.ts:1000` and `syncService.ts:1711` (verified by grep). This is why the reported bug produced no telemetry. Fix in this change; it is the observability requirement for Group A.

**S2 (fix — and Pass 4 found the remedy is not implementable as written).**

> ⚠️ **The durable write needs a `remoteBaseline` CODEC change, not just moving a `return`.** `encodeBaselinePayload(revision: string, …)` (`remoteBaseline.ts:151`) requires a non-null revision, and `decodeBaselinePayload` (`:186-190`) returns `null` unless `typeof r === 'string' && r !== ''`. So a revision-less row would decode to "no baseline" **and `console.error` on every open** — worse than not writing it. Required, in order: widen `DecodedBaseline.revision` to `string | null` (`:91`); widen `encodeBaselinePayload`'s parameter; add **one** decode arm `(r == null && typeof h === 'string' && h !== '')` → `{ revision: null, headsFp: h }` placed **before** the existing arm; and write only when `fpOnly !== null`. `RemoteBaseline.revision` (`:70`) is already nullable and `shouldSkipOpenRead:1148` already gates on `revision === null`, so no false open-skip is introduced. The early `return` is at **`:1251`**, not `:1250`.

`commitRemoteBaseline` (`syncService.ts:1222`) has a `revision === null` branch (`:1224-1251`) that **already** maintains the in-memory `remoteBaseline.headsFp` — that half was fixed. What it still does is `return` at `:1251`, **before** `docClient.noteRemoteBaseline(...)` at `:1268`. So the **durable** row is never written for a local-file or Capacitor family. Within a session the lineage context is correct; after any reload `initAndLoadCache` returns no `remoteBaseline`, the open terminus gets `heads: null`, and the rebase is structurally unavailable. Pass 1 said these families "never persist a baseline row" and implied the context was permanently wrong — half right, and the narrower statement is the one to test against.

**S3 (fix — and Pass 4 upgrades it from a tidy-up to a HARD PREREQUISITE for Group A).**

> ⚠️ **Group A cannot ship without S3, and the reason is a wrong-copy bug, not neatness.** `completeAutoLoad:4706` routes any non-`PayloadLoadError` blocker to `{ kind: 'lineage-blocked' }`, and `ResumePodSetup.vue`'s `else` arm renders `t(result.error.inlineMessageKey)` straight into `formError`. Group A's inline copy names _"Use the family file" below_ and _"export from Settings"_ — **neither control exists on the resume screen.** Shipping Group A before S3 therefore puts instructions on screen that point at buttons the user cannot see, which is verbatim the defect `ResumePodSetup.vue:381-390` warns about and the same class as `564b0662`. S3 must land first, and `BLOCKER_OVERLAY_KEY` must give `local-unreadable` its own **overlay** copy naming only actions that exist on that screen (close other tabs, reload).

> ⚠️ Pass 1 claimed _"A lineage block raised during login or resume has no render site."_ **That is false.** `surfaceLineageFatal` (`src/utils/payloadFailureSurface.ts:230`) exists precisely for this, calls `fatalErrorStore.setFatal` with `resumeSetup.podLineageBlocked` and `{ clearDataHelps: false }`, and renders through `<FatalErrorOverlay>` at **`App.vue:1883` — outside `showLayout`**. It is already wired at `App.vue:769` (cached-key decrypt failure), `App.vue:842` (the `loadFamilyData` catch) and `ResumePodSetup.vue:396`. The `ResumePodSetup.vue:377-390` comment Pass 1 cited as "acknowledging the bug" in fact **documents the existing solution**.

The real gap is narrower and structural: **that routing is `instanceof PodLineageError`, class by class, at three separate sites.** A new blocker class (Group A's) added to those sites by hand is three chances to forget one, and a forgotten one is a refusal with no render site — the exact failure `564b0662` fixed yesterday.

> ⚠️ **Pass-3 correction — Pass 2's remedy contradicted the file it was editing, twice.**
>
> 1. Pass 2 said "collapse the three per-class dispatches onto one `surfaceBlockerFatal`… with `surfacePayloadFatal` / `surfaceLineageFatal` kept as thin named wrappers." But `payloadFailureSurface.ts:222-229` argues explicitly _against_ generalising the two: _"A SEPARATE function, not a generalisation of the pair above: making those generic over two unrelated error shapes would push `deviceCannotOpen`/`keyMayBeWrong`/`payloadBytes` narrowing into code whose entire value is that it has none."_
> 2. Pass 2 said the new function "derives its copy from `err.inlineMessageKey`". Neither existing function does that: `surfacePayloadFatal` reads `PAYLOAD_OVERLAY_KEY[payloadErrorKind(err)]` (`:171-175`) and `surfaceLineageFatal` uses the fixed `resumeSetup.podLineageBlocked` (`:246`). And `:163-170` records a **shipped drift bug** caused by exactly that kind of copy reuse — the inline ladder and the full-screen copy are deliberately _different strings resolved through a table_, never the same key.
>
> S3 is therefore a **dispatcher, not a generalisation**. See **Approach → S3**.

**S4 (defer, with reason).** The liveness probe that cannot distinguish a wedged worker from one executing synchronous WASM (`docClient.ts:895-900`, already marked deferred in code). Out of scope: the honest fix is a progress signal posted from the worker around `loadCachedDoc`, which is a worker-protocol change and does not belong in a release blocker.

**S5 (fix — DRY, discovered in Pass 2).** The load-file confirmation is **hand-rolled twice** in `SettingsPage.vue` (`:1631-1646` and `:1832-1848`) as identical yellow slabs bound to one `showLoadFileConfirm` ref, backed by **two different strings** — `settings.loadFileConfirmation` (`uiStrings.ts:3402`) and `settings.switchFileConfirmation` (`:3428`). Meanwhile `useConfirm()` + `<ConfirmModal />` already exist and are globally mounted at `App.vue:1917`, with `detail` / `detailTone: 'caution'` / `variant` support built for exactly this kind of warning (`useConfirm.ts:16`, `:31`). B7 requires rewriting this copy; rewriting it twice in two places is how it drifts. Collapse both onto `confirm({ … })`.

> ⚠️ **Pass-4 correction — one `confirm()` CALL, but TWO strings.** Pass 3 said "one dialog, one string". That is wrong on the merits: the two slabs are the unconfigured and configured cases (see B3's Pass-4 correction) and they legitimately say different things — _first load_ = "this file becomes your family's data file", _restore_ = "this replaces your family's data; your family keeps using the same storage". Collapsing to a single string would tell a first-time user their family "keeps using the same storage" when it has none. **One `confirm()` call site, two message strings selected by the same `hasPod` predicate that selects `keepCurrentPod`** — so the words and the behaviour can never disagree.

**S6 (new, Pass 4 — name the limitation this plan does NOT close).** Group A changes only the **error** arm of the cache classification. The combination `!loadedFromCache && !cacheErrorName && chosenByUser` — a _genuine_ miss on a restore — still sends `no-local-document`, still skips `stampNewGeneration` (`applyAndProject.ts:925`), and still silently returns the family to the old lineage. **The v5 plan's known limitation survives this plan**, narrowed from "any cache failure" to "a genuinely empty device". That is the correct outcome (a device holding nothing has no generation to mint _from_), but it must be named rather than assumed fixed. Emit `pod-lineage` `warn`, `action: 'restore-unstamped'`, so the case is countable — and mint **no new UI string**, because on that path there is no render site and a string with no render site is the defect this plan keeps finding.

**S7 (new, Pass 4 — verified benign, recorded so it is not rediscovered as a bug).** On a restore, `replaceEnvelope` → `preserveLocalKeyDicts` (`envelopeMerge.ts:68-96`) **unions** the restoring device's current `wrappedKeys` / `passkeyWrappedKeys` / `inviteKeys` into the restored envelope, so members who joined _after_ the safety copy was written keep their wraps and are not locked out. It cannot cover a full **family-key rotation** performed after the copy was taken — in that case the restored envelope's `keyId` is the old one. No code change; record it as a known limitation in the v5 restore drill.

## Important Notes & Caveats

- **Do not "fix" Group A by making `initAndLoadCache` retry again.** That reintroduces the six-minute lockout `cd7d3dd7` fixed. The bug is the classification of the failure, not the promptness of it.
- **Do not derive the install decision from `!currentDoc`.** `applyAndProject.ts:861-870` records that this exact "simplification" caused a cross-family merge and an upload to the wrong family's file. Pass 2's design does not go near it — `applyAndProject.ts` is not edited.
- **Do not add a `LineageBasis` kind unless a later finding forces it.** A fourth kind obliges every existing producer and every worker-side reader to be re-reasoned, requires a `protocol.ts` codec entry (`:320`), and the worker still cannot observe _why_ the cache failed. The classification lives where the knowledge is: main.
- **A new blocker class must implement `RemoteBlocker`, not just extend `Error`.** `isRemoteBlocker` (`types/sync.ts:259`) is a structural check on `blockCode` + `inlineMessageKey`; a class missing either is invisible to every dispatch in the app and fails silently everywhere. Model it on `RemoteMergeError` (`types/sync.ts:606`). Set `this.name` to a **literal** string — `types/sync.ts:613` records that the prod build minifies class names.
- **`latches` is a real decision, not a default.** `noteRemoteBlocked`'s generic arm sets the latch only `if (err.latches)`, and `notePodUnopenable:3606` early-returns without it — so `latches: false` means _no banner, no message key, and the 10s poller keeps downloading_. See A8. Pass 2 cited `RemoteMergeError.latches` as the precedent for `false`; that getter actually returns `this.isActorCollision` — it latches on the invariant violation and declines only for genuinely transient timeouts. A blocked IndexedDB handle is not transient within the session.
- **Thrown on MAIN, so no worker error codec entry is needed.** `protocol.ts:287-320` registers codecs by `err.name` for errors crossing the worker boundary. Group A's refusal never crosses it. If a later change moves it into the worker, `protocol.ts:320` must gain an entry or the class degrades to a bare `Error` and the dispatch silently stops working.
- **Do not reuse `podUnreadable.inline`.** That key (`types/sync.ts:195`, copy at `uiStrings.ts:4553`) means _the remote file_ could not be read and tells the user to update the app. Group A is about _this device's own copy_. A new key is required; reusing this one would give wrong advice.
- **Do not widen `LineageBanner`.** Its entire doc-comment, its `isConflict` two-way ternary and its mounted test are about _lineage_. The house pattern is **one thin `ErrorBanner` wrapper per condition** (`DurabilityBanner.vue` is 39 lines; `LineageBanner.vue` is 142 and already carries two). See **Approach → Group A step 5**.
- **Do not reuse `rebindPodFile` for the restore.** Its safety-copy refusal is correct for a repair and wrong for a restore, and it moves the registry pointer, which B3/B4 say a restore must not do. Two Drive-file entry points deliberately disagreeing about safety copies would be a landmine.
- **Do not relax `isSafetyCopyName` anywhere.** The refusal is load-bearing. Do not "finish the job" by filtering safety copies out of `searchBeanpodFilesGlobal` or `listBeanpodFiles` either — `driveService.ts:745-750` says why both must keep seeing them.
- **The once-per-session guard exists for a reason.** `syncStore.ts:405-408` warns that an unguarded canonical check turns a retry loop into a registry request loop, because `verifyPodAccess` runs on every load path including `retry`. B8 therefore **keeps the latch and clears it on the two events that can invalidate it** — a completed restore and a completed `rebindPodFile` — rather than adding a timer.
- **`user-file` never blocks.** Widening what can carry it widens the blast radius of the one context with no safety net. B6 keeps it argument-passed from the confirmed dialog only. A7's skip is the same policy, not a new exception.
- **A restore writing into the same Drive file it was read from is a new write shape.** The pre-save `fetchAndMergeRemote` would see its own source. The restore publishes the _installed, generation-stamped_ document, and the pre-save merge must not merge the pod's current (compacted) content back into it before it lands. `useRemoteFileOverLocalDocument:3679`'s `cancelPendingSave()` is the existing precedent for standing the other writers down.
- **Group A's fix changes what a device does when its cache is unreadable, on every load path, not just compaction.** The blast radius is wider than the bug that motivated it. Every acceptance run must include a plain non-compaction sign-in.
- **There are ZERO `satisfies Record<PodBlockMessageKey, …>` tables today** (Pass 4). `types/sync.ts:501` uses the union as a _value_ type, not a table key. Pass 3's claim that "every such table becomes a compile error" is true **only after S3 creates the first one** — which is another reason S3 must land before Group A, not after.
- **Do not add a "Picker available" predicate to the dispatch** (Pass 4). It would never fail in dev, making it a guard nobody has seen fail — the repo's top lesson. Dispatch on **provider only**, and let `describePickFailure`'s `config` arm handle a missing `VITE_GOOGLE_API_KEY` at runtime with an offer to fall back to the local picker.
- **Two stale comments to correct in the docs commit** (Pass 4, one line each): `applyAndProject.ts:~887` still asserts _"`podCompaction` is OFF and has never shipped enabled"_, untrue since `142d25a8`; and `types/sync.ts:151-157`'s `lineage-blocked` doc-comment ("its history cannot be combined") no longer describes every blocker routed through it.
- **`app.beanies.family` prod is 0.16 and has none of this.** Nothing here helps a device that is stale today; it is correctness for the rollout.

## Complexity Budget (new, Pass 3)

This plan touches two unrelated defects in the three largest files in the repo (`syncStore.ts` 5,465 lines; `syncService.ts` 2,425; `SettingsPage.vue` 2,356). Four rules keep it from making them worse. Each is checkable in review.

1. **Net new files: two.** One blocker class (goes in the existing `types/sync.ts`), one thin banner component. **No new composable** — the picker dispatch is a pure function and belongs in `src/services/sync/capabilities.ts`, which already owns that question and already has both callers importing it. `src/composables/` has 156 entries; a 157th with no refs and no lifecycle is a file nobody will find.
2. **Net line count in `syncStore.ts` should be near zero or negative.** `installPendingProvider` removes more duplication than the guards add. If the diff grows the file by more than ~40 lines, something is being written twice.
3. **No branch deeper than two.** The three-way cache classification is a flat ladder at one site; the picker dispatch is a `switch` on a three-value union; the blocker fatal routing is one `instanceof` chain in one file. Nothing nests a decision inside a decision.
4. **Every new closed union gets a `satisfies Record<…>` table, not an `if`/`else` ladder.** Applies to `describePickFailure`, the blocker→`BackgroundSyncErrorKind` mapping, and the blocker→overlay-key mapping. This is the house idiom (`PAYLOAD_OVERLAY_KEY`, `POD_ACCESS_SEVERITY`, `POLICY` in `podLineage.ts`) and it is what makes "a new blocker class cannot be forgotten" a compiler guarantee rather than a review habit.

**Shippability split.** Group A is the data-loss path; Group B is the rollback route. If Group B slips, **Group A alone is shippable and still unblocks the deploy's worst risk** — Group A is reachable without compaction (any two-tab sign-in after a family switch). The commit boundaries below preserve that option. Group B alone is not shippable, because the v5 plan's known limitation makes a restore untrustworthy until A lands.

## Assumptions

> **Review these before implementation.**

1. `podCompaction` remains `true` in `featureFlags.committed.ts:18` and the intent is still to ship it in the next deploy. If compaction is deferred instead, Group B's urgency drops but Group A's does not — see the shippability split above.
2. The registry Lambda's owner-only pointer guard is unchanged and still server-side. This plan does not modify `infrastructure/lambda/registry/index.mjs`.
3. `usePickBeanpodFile` is usable from Settings without new OAuth scope work — `LoadPodView`, `PodAccessBanner`, `SaveFailureBanner` and `useJoinFlow` already call it in an authenticated session.
4. `APP_VERSION` is still `0.16` and the bump to `0.17` (per STATUS) happens as part of the release, not this plan.
5. greg's dev family may be the contaminated one the tier-3 plan warned about (`podLineage {seq: 1}` on the envelope over an unstamped document; the v2 export carries exactly that shape). The acceptance runs below should start from a **reset** dev family, or the results are not trustworthy — this plan's own testing depends on it.
6. The 2026-09-06 Stage 1 soak result (banner + adopt + offline-error-keeps-banner) still holds; this plan changes the paths _into_ that machinery, not the machinery itself.
7. **(new)** Latching on an unreadable local cache (A8) is acceptable UX for the session. The two exits are the banner's "Use the family file" action and a page reload; the copy names both. If a later finding shows a common case where the handle frees mid-session and a reload is a poor answer, the correct follow-up is a targeted re-arm (a `visibilitychange`-driven single retry), **not** flipping `latches` to `false` — which silently removes the banner entirely.

## Approach

### Group A — refuse where the knowledge is, in two places, on main

The fact that decides everything — _did the cache read fail, or was it genuinely empty?_ — is known **on the main thread, before `mergeRemoteEnvelope` is ever posted**. `cacheErrorName` (`syncStore.ts:914`, set at `:938`) was added by `cd7d3dd7` for telemetry and already carries exactly it. So the refusal goes on main, and the worker is not touched.

**1. The classification site — `syncStore.replaceDocWithCacheRecovery` (`:980-981`).** A flat three-arm ladder, replacing the existing two-arm ternary:

```
loadedFromCache          → basis as today (user-file | baseline)
!loadedFromCache, no err → { kind: 'no-local-document' }   ← unchanged; A3 preserved
!loadedFromCache, err    → THROW the blocker; never call mergeRemoteEnvelope
```

The throw is skipped when `chosenByUser` is true (A7): the human has already been shown "this will replace all local data" and chosen the family's file, which is the same authorisation `user-file` carries everywhere else.

**No new catch is required anywhere** — verified: the three callers (`:1335`, `:1685`, `:2526`) already terminate in `isRemoteBlocker` dispatches that call `notePodUnopenable` (`:1820`, `:2665`) or rethrow to callers that do (`:3365`, `:3510`).

**2. The backstop — `docClient.mergeRemoteEnvelope` (A5), at `docClient.ts:1225`.**

`docClient` latches a module-level `rehydrateFailed` flag inside the existing `reportRehydrateFailure` (`:368` — the single reporter both call sites at `:355` and `:426` already funnel through). `mergeRemoteEnvelope` throws the same blocker while that flag is set.

This is one `if` at the one main-thread wrapper every merge already passes through, so it covers `syncService.fetchAndMergeRemote`, the poll paths, and any future caller — without re-deriving anything from worker state, and without a protocol change. It cannot fire on a genuinely empty device: the rehydrator only runs when `needsRehydrate && currentFamilyId` (`docClient.ts:350`, `:415`), i.e. only when a document was expected.

> **Pass-3 additions — the flag needs a lifetime and a reset, or it is a second, invisible latch.**
>
> - **Cleared** on the next successful `initAndLoadCache` **and** wherever `needsRehydrate` / `currentFamilyId` are managed. Without the second half, a family switch or a sign-out leaves it armed and every merge for the rest of the session is refused on a device that is now perfectly healthy.
> - **Added to `__resetDocClientForTesting` (`docClient.ts:1497-1518`)**, which enumerates every module flag one per line. Omitting it leaks state between tests, and this file already carries a reset-invariant test (see the `rehydrating` comment at `:169-171`) that the new flag joins.

**3. The blocker class.** `LocalDocUnreadableError extends Error implements RemoteBlocker`, in `src/types/sync.ts` beside `RemoteMergeError` (`:606`) — same ~20-line shape:

- `blockCode = 'local-unreadable'` → lands in `error_code` with no new allowlist key;
- `inlineMessageKey = 'podLocalUnreadable.inline'` → **one** new `PodBlockMessageKey` (`types/sync.ts:188-196`), which is a closed union, so every `satisfies Record<PodBlockMessageKey, …>` table in the app becomes a compile error until it answers;
- `latches = true` — **changed from Pass 2, see A8.** Without it there is no banner, no message key and no stop to the 10s poller. The exits are the banner action and a reload;
- `this.name = 'LocalDocUnreadableError'` as a **literal** (minification, per `types/sync.ts:613`).

**4. The copy.** `podLocalUnreadable.inline` (`en` + `beanie`) says what happened and what to do: _beanies could not open this device's own copy of your family data, so it has not been replaced with the family file — your unsaved changes are still here. Close any other beanies tabs or windows and reload. If the message stays, use "Use the family file" below (your unsaved changes on this device will be let go) or export from Settings and contact support@beanies.family._ Developer direction goes to the console at the throw site with the `cacheErrorName` class.

**5. The render sites — one new thin banner, and one shared fatal dispatch.**

- _Shell up_ → a **new `LocalDocUnreadableBanner.vue`**, a fourth thin `ErrorBanner` wrapper modelled line-for-line on `DurabilityBanner.vue` (39 lines), gated on `podUnopenable && backgroundSyncErrorKind === 'local-unreadable'`, with its own title/message and the one existing action (`syncStore.useRemoteFileOverLocalDocument`, which A7 makes succeed). Mounted beside `<LineageBanner />` at `App.vue:2204`.

  > **Why not "one more arm in `LineageBanner`", which Pass 2 proposed.** That component's gate is `=== 'lineage'`, its `title` and `message` are two-way ternaries on `isConflict`, and its entire doc-comment is about combining histories. Adding a third condition makes every one of those three-way and makes the comment false — a decision nested inside a decision inside a component that already carries two. The house pattern is one thin wrapper per condition (`DurabilityBanner`, `SaveFailureBanner`, `PodAccessBanner`, `LineageBanner`), each ~40 lines, each independently testable. `LineageBanner` and its mounted test (`lineageBanner.test.ts`, which already asserts it does _not_ render for kind `'decrypt'`) are then **untouched**.

- `BackgroundSyncErrorKind` (`syncStore.ts:151-157`) gains `'local-unreadable'`. The assignment at `:3610` — today `err instanceof PodLineageError ? 'lineage' : 'decrypt'` — becomes a lookup in a `satisfies Record<PodBlockMessageKey, BackgroundSyncErrorKind>` table, so a future blocker key is a compile error at exactly one place instead of silently inheriting `'decrypt'`. (`WallStatusStamp.vue:61` reads `=== 'lineage'` and is unaffected; verified.)

- _Shell not up (login / resume / cold boot)_ → `surfaceBlockerFatal` → `FatalErrorOverlay` (`App.vue:1883`), with `clearDataHelps: false` — clearing local data is exactly wrong when the local copy may hold the only copy of unsaved work. See **S3** for how that routing stops being three hand-maintained `instanceof` sites.

**Why not the three-kind `LineageBasis`.** It requires a `protocol.ts` type change, a codec entry, a new arm inside `applyAndProject.ts` (the file whose comments record three prior data-loss regressions), and re-reasoning three unrelated `no-local-document` producers — to encode a fact the worker cannot observe and main already holds. Rejected on blast radius, not on effort.

**Commit boundary:** Group A is its own commit, revertable without touching Group B.

### S3 — a dispatcher, not a generalisation

`payloadFailureSurface.ts` gains **one** exported function; the two existing bodies are **not touched**, so no existing overlay copy changes:

```
surfaceBlockerFatal(err: RemoteBlocker, ctx: { fileId, familyId, source }):
  err instanceof PayloadLoadError → surfacePayloadFatal(err, ctx)          // reads .step/.keyMayBeWrong/.payloadBytes
  err instanceof PodLineageError  → surfaceLineageFatal(err, { familyId }) // reads .verdict
  otherwise                       → generic arm
```

This is exactly the discipline `types/sync.ts:250-258` prescribes — _"Prefer this to `instanceof` ANYWHERE the question is 'should this latch / should the save refuse'. Keep `instanceof PayloadLoadError` only where a payload-specific member is read"_ — with the chain confined to **one** file instead of three.

The generic arm resolves its overlay copy from `BLOCKER_OVERLAY_KEY`, a `satisfies Record<PodBlockMessageKey, TranslationKey>` table. Keyed on `inlineMessageKey` because that **is** a closed union; `blockCode` is typed `string` (`types/sync.ts:263`) and a table over it can never be exhaustive. The table maps to _overlay_ keys, never to the inline key itself — `:163-170` records the shipped drift bug that reusing the inline string caused. A one-line test asserts the table's payload and lineage rows agree with what the two specific arms already produce, so the tables cannot drift.

The three call sites — `App.vue:768-769`, `App.vue:837-842`, `ResumePodSetup.vue:395-396` — each collapse to a single `surfaceBlockerFatal(...)` call. `LineageBanner`, `FatalErrorOverlay` and `App.vue`'s render tree are **not** moved.

**Why this ordering matters:** because the table is exhaustive over `PodBlockMessageKey`, adding Group A's new key in step 3 **fails the build** until the overlay copy exists. That is the "render site by construction" S3 promised, delivered by the compiler.

### Group B — the picker follows the provider; the restore stays home

This is the investigation's **Option 1 for the picker** combined with its **Option 2 for the provider**. Option 1 makes the Drive safety copy selectable (fixing A3), Option 2 stops the re-homing (fixing B and C), and — the correction Pass 1 missed — Option 2's suppression must cover the **Drive** re-home branch too, or Option 1 forks the family onto its backup.

**1. Picker selection — one pure function, two callers.** Add to `src/services/sync/capabilities.ts`:

```ts
export type PodFileSourceArm = 'drive-picker' | 'fsa-local' | 'os-sheet';
export function podFileSourceArm(opts?: {
  preferProvider?: 'google_drive' | 'local';
}): PodFileSourceArm;
```

Three lines of predicate over `isNative()` and `supportsFileSystemAccess()`, plus the provider-first pre-check. `LoadPodView.handleOpenSavedFile` (`:459-479`) calls it with **no argument** and keeps today's platform-first answer verbatim — including its `selectedSource` toggle and its own `logEvent`, which stay in the component because they are view state, not a decision. Settings calls it with the family's provider and gets Drive-first. The Picker call itself stays `usePickBeanpodFile().pick()` — unchanged, already the join/recovery primitive, four existing callers.

> This is a **pure function in the module that already owns the question**, not a new composable. It has no refs and no lifecycle; `capabilities.ts` is already imported by both `LoadPodView.vue:26` and `syncService.ts:12` for exactly these predicates.

`SettingsPage.handleLoadFromFileConfirmed` (`:534`) switches on the returned arm. On `'drive-picker'` it hands `{ fileId, fileName }` to `syncStore.loadFromGoogleDrive` — the existing handoff — then opens the same decrypt modal it already opens. The other two arms keep today's `syncStore.loadFromNewFile()` call unchanged.

**2. The read is a read — one helper, one guard.**

_Step 2a (pure refactor, its own commit)._ Extract the duplicated tail into `installPendingProvider(pending, activeFamilyId, opts)` in `syncStore` and call it from both decrypt functions. **Scope decision:** extract the **provider half only** — `syncStore.ts:1732-1759` / `:2570-2597` — not the full 58-line identical span. The family-identity preamble (`createFamilyWithId` / `switchFamily` / `initializeAuth`) is also byte-identical and also wants extracting, but it mutates the active-family context on a release-blocker path, and a pure refactor is only pure if it is small enough to read as one. Record the wider duplication as a follow-up and land, in this plan, an equivalence test that drives both decrypt functions through the same fixture and asserts the same provider/config outcome — so the two halves cannot drift while the follow-up waits.

_Step 2b (the behavioural change, a one-line guard)._ `installPendingProvider` gains `keepCurrentPod?: boolean`. When set, **both** re-home branches are skipped: no `storeProviderConfig`, no `clearFileHandleForFamily`, no `provider.persist()`, no `setProvider` — Drive branch and local branch alike. The family's provider, `fileId`, Drive binding and registry pointer are untouched.

_Who passes it._ `decryptPendingFile` gains `keepCurrentPod?: boolean` on its **existing** `opts` object beside `userChoseThisFile` and forwards it, passed from the **same confirmed site** (`SettingsPage.vue:572`). **`decryptPendingFileWithKey` passes nothing** — it has no `opts` bag, its body says "deliberately no parameter to pass one" (`:2527-2531`), and none of its five callers is a restore surface. A one-line comment there mirrors that reasoning so nobody "completes" the symmetry later.

> Net effect: **one** guard, in **one** function, with **one** test — instead of Pass 2's "four re-home call sites asserted independently", and without an opts bag on the identity path.

**3. The publish goes home.** The restored, generation-stamped document (B5) is published to the existing pod. `cancelPendingSave()` before the install (the `useRemoteFileOverLocalDocument:3679` pattern) so the pre-save `fetchAndMergeRemote` cannot merge the pod's current compacted content back into the restored document before it lands.

**4. Copy — one dialog (S5).** Both hand-rolled slabs (`SettingsPage.vue:1631-1646`, `:1832-1848`) are replaced by a single `confirm({ title, message, detailTone: 'caution', variant: 'danger', confirmLabel })` call, and the `showLoadFileConfirm` ref is deleted. `settings.loadFileConfirmation` becomes the one message and says what actually happens: _this replaces your family's data with the contents of this file, for everyone — your family keeps using the same storage._ `settings.switchFileConfirmation` (`:3428`) and `settings.switchDataFile` (`:3423`, "Switch to a different data file") are retired or re-worded away from "switch to that file" (B7); `compaction.safetyCopyNote` (`:4320`) and `compaction.safetyCopyNoteManual` (`:4325`) become true on every platform. Both `en` and `beanie` values, per the i18n rule, then `npm run translate`.

**5. Failure handling (B9).** One `switch` over `PickBeanpodFileResult` and one over `loadFromGoogleDrive`'s `reason` / `status`, both exhaustive. The `reason` → copy mapping comes from the shared `describePickFailure` so `LoadPodView` and Settings cannot diverge:

| outcome                                                | user sees                                                                            | console                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `cancelled`                                            | nothing                                                                              | nothing                                                                |
| `failed: 'auth'`                                       | reconnect-your-Google-account copy                                                   | `pick failed: auth — <message>`                                        |
| `failed: 'config'`                                     | generic "we could not open Google Drive"; this is a build misconfiguration           | `VITE_GOOGLE_API_KEY missing` (already logged at `drivePicker.ts:201`) |
| `failed: 'load' \| 'open' \| 'iframe' \| 'timeout'`    | "we could not open the Google file picker — try again, or use Load from this device" | `pick failed: <reason>`                                                |
| `loadFromGoogleDrive reason: 'not-found'` (status 404) | "that file is no longer in your Drive" — the safety copy was deleted                 | `restore source 404`                                                   |
| `payloadError`                                         | `t(payloadError.inlineMessageKey)` — the existing arm at `SettingsPage.vue:553`      | already classified                                                     |
| decrypt wrong password                                 | existing `password.decryptionError` arm                                              | —                                                                      |

Every arm sets `importError` (which `closeFamilyData` (`:214`) already clears) and emits a firehose event. Nothing returns silently.

**6. Safety net (B8).** `checkCanonicalPod` drops the Drive-only early return at `:4035` and compares against whichever provider the registry names. The `checkedCanonicalFor` latch (`:408`) is **kept** and **cleared** at the two points that can invalidate it — after a completed restore and after a successful `rebindPodFile` — instead of being replaced by a time-bounded re-check.

> **Pass-3 addition — name the invalidation, do not scatter the assignment.** `checkedCanonicalFor` is written raw at `:4036` (set) and `:3879` (clear) today; B8 would make that four raw writes to one module-level string, which is how a latch quietly stops being cleared. Add `function invalidateCanonicalCheck(): void { checkedCanonicalFor = null; }` beside the declaration at `:408` with the reason in one comment, and make all three clear sites call it.

Same detection, no timer, no extra registry traffic, and it cannot regress into the request loop `:405-407` warns about. Explicitly **not** the propagation mechanism — B5 is.

**Commit boundaries:** (i) `installPendingProvider` extraction (pure refactor, no behaviour change, its own commit so the next one is a one-line diff), (ii) the `keepCurrentPod` suppression, (iii) the picker dispatch + `capabilities.ts` function + `describePickFailure`, (iv) the confirm-dialog consolidation + copy, (v) the canonical safety net. S1/S2/S3 are each their own commit — S3 in particular is a UI/dispatch fix that must not ride along on a data-path change.

### Order of work

1. **S1** (terminus 4 telemetry) — first, so the rest of the work is observable while being tested.
2. **S3** (`surfaceBlockerFatal` dispatcher + `BLOCKER_OVERLAY_KEY` table) — second, so Group A's new `PodBlockMessageKey` **cannot compile** without an overlay entry.
3. **Group A** (classification + chokepoint + blocker class + `BackgroundSyncErrorKind` + banner + copy).
4. **S2** (durable baseline row on non-Drive providers) — needed before the restore drill can pass on a local-file family.
5. **S5 + Group B step 2a** (`installPendingProvider` extraction, confirm-dialog consolidation) — pure refactors that shrink the next two steps.
6. **Group B** (picker dispatch, `keepCurrentPod` guard, copy, failure arms).
7. **B8** (canonical safety net).

## Files Affected

**Group A**

- `src/types/sync.ts` — `LocalDocUnreadableError` (beside `RemoteMergeError`, `:606`), one new `PodBlockMessageKey` (`:188-196`)
- `src/stores/syncStore.ts` — the classification at `:980-981`; the `chosenByUser` skip (A7); `BackgroundSyncErrorKind` (`:151-157`); the kind lookup replacing the ternary at `:3610`
- `src/services/automerge/worker/docClient.ts` — `rehydrateFailed` latch in `reportRehydrateFailure` (`:368`), refusal in `mergeRemoteEnvelope` (`:1225`), reset entry in `__resetDocClientForTesting` (`:1497-1518`)
- `src/services/translation/uiStrings.ts` — `podLocalUnreadable.inline` + banner title + overlay copy (`en` + `beanie`)
- `src/components/common/LocalDocUnreadableBanner.vue` — **new**, ~40 lines, modelled on `DurabilityBanner.vue`
- `src/App.vue` — mount the new banner beside `<LineageBanner />` (`:2204`)
- `src/stores/__tests__/syncStore.resume.test.ts` — re-point `:505` and `:510`; annotate `:471` (A6)
- **Not touched:** `applyAndProject.ts`, `protocol.ts`, `podLineage.ts`, `LineageBanner.vue`

**Group B**

- `src/pages/SettingsPage.vue` — `handleLoadFromFileClick` (`:530`), `handleLoadFromFileConfirmed` (`:534`), `handleDecryptFile` (`:566`, the `userChoseThisFile` site at `:572`), the two inline confirm slabs (`:1631-1646`, `:1832-1848`) and the `showLoadFileConfirm` ref
- `src/services/sync/capabilities.ts` — `podFileSourceArm()` (**not** a new composable)
- `src/services/google/drivePicker.ts` — `describePickFailure()` beside `PickBeanpodFileResult` (`:173-180`)
- `src/components/login/LoadPodView.vue` — consume `podFileSourceArm()` + `describePickFailure()`; no behaviour change (the `selectedSource` toggle and its `logEvent` stay put)
- `src/stores/syncStore.ts` — `installPendingProvider` extraction (`:1732-1759`, `:2570-2597`), `keepCurrentPod` on `decryptPendingFile`'s existing `opts` only, `loadFromNewFile` (`:1510`), `checkCanonicalPod` (`:4029`, `:4035`), `invalidateCanonicalCheck` (`:408`, `:3879`, `:4036`)
- `src/composables/usePickBeanpodFile.ts` — reuse, **unchanged**
- `src/services/translation/uiStrings.ts` — `settings.loadFileConfirmation` (`:3402`), `settings.switchFileConfirmation` (`:3428`), `settings.switchDataFile` (`:3423`), `compaction.safetyCopyNote` (`:4320`), `compaction.safetyCopyNoteManual` (`:4325`), plus `zh.json` via `npm run translate`
- **Not touched:** `src/services/sync/syncService.ts` for the re-home (Pass 1 had this wrong — `openAndLoadFile` carries a provider, it does not install one); `decryptPendingFileWithKey`'s signature (Pass 2 had this wrong — it has no `opts` bag, deliberately)

**Secondary**

- `src/stores/syncStore.ts` — S1 (`:1292-1330`)
- `src/services/sync/syncService.ts` — S2 (`:1224-1251`, the early `return` at `:1250` before `:1268`)
- `src/utils/payloadFailureSurface.ts` — S3 (`surfaceBlockerFatal` + `BLOCKER_OVERLAY_KEY`; `surfacePayloadFatal` `:153` and `surfaceLineageFatal` `:230` bodies unchanged)
- `src/App.vue` (`:768-769`, `:837-842`), `src/components/login/ResumePodSetup.vue` (`:395-396`) — S3 call sites

**Docs**

- `docs/plans/2026-09-07-cache-read-failure-and-provider-aware-restore.md`
- `docs/prompts/2026-09/2026-09-07-cache-read-failure-and-provider-aware-restore.md`
- `CHANGELOG.md`, `docs/STATUS.md`
- `docs/plans/2026-09-06-compacted-pod-v5.md` — the restore drill must name the browser

## Observability Coverage

**S1 — the gap that made this bug invisible.** Terminus 4 (`syncStore.ts:1292-1330`) gains the `logMergeTerminus` call the other two termini already have, with the same level rule and the same `replayed` / `conflicts` fields. Without it, the path a reconnecting peer actually takes reports nothing.

> **Privacy correction (Pass 2).** `provider` is **not** in `ALLOWED_CONTEXT_KEYS` (`src/utils/diagnosticContext.ts:61`); the allowlisted key is **`provider_type`** (`:95`), which `logPodAccessResult` and `syncService` already use. Pass 1's "no new context keys" claim was false as written. Every event below uses `action`, `error_code`, `provider_type`, `file_id_tail` and `detail` — all already allowlisted (`:95`, `:96`, `:188`), and the Lambda mirror (`infrastructure/lambda/telemetry/index.mjs:65`) needs no change.
>
> **Level vs severity.** `logEvent` takes `LogLevel = 'debug' | 'info' | 'warn' | 'error'` (`logEvent.ts:28`); `reportError` takes `ErrorSeverity = 'critical' | 'error' | 'warning'` (`errorReporter.ts:42`). Pass 1's tables used `warning` as a level, which does not type-check. The tables below are corrected.

**The `pod-open-degrade` message must split into three (new, Pass 3).** `syncStore.ts:950-959` today logs one of two constant messages — `'cache hit — merging'` or `'cache unavailable — adopting remote wholesale'` — and it fires at `:950`, **before** the basis is decided at `:980`. After Group A the error arm no longer adopts wholesale; it refuses. The message string is also the dedup/limiter bucket key (buckets key on `(surface, message)` — see `docClient.ts:1293-1296`), so leaving it alone would make the one event that is supposed to make Group A filterable read as data loss forever. Three constant messages, one per arm:

| arm          | `error_code`     | message                                   |
| ------------ | ---------------- | ----------------------------------------- |
| hit          | `'hit'`          | `cache hit — merging` (unchanged)         |
| genuine miss | `'miss'`         | `cache empty — adopting remote wholesale` |
| read failed  | `cacheErrorName` | `cache unreadable — refusing the merge`   |

The `:510` test re-points onto the third message. `error_code` already carries the classification, so the split adds no context key.

**Group A events.**

| event                                                 | surface            | level                               | context                                                                | why                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------ | ----------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cache read classified (existing, message split above) | `pod-open-degrade` | `info` on hit, `warn` on miss/error | `action: 'cache-recovery'`, `error_code`                               | Separates "genuine miss" from "could not read" — the whole point of Group A, and it must be filterable. Emitted on **all three** arms so the rate has a denominator                                                         |
| merge refused, local document unreadable              | `pod-lineage`      | `warn`                              | `action: 'local-unreadable-refused'`, `error_code` = the failure class | Per-occurrence rate. The new fail-safe firing — the event that replaces silent data loss                                                                                                                                    |
| (automatic) blocked once per class                    | `pod-load-failure` | `reportError` `severity: 'error'`   | `action: 'blocked'`, `error_code: 'local-unreadable'`                  | **Already emitted** by `noteRemoteBlocked`'s generic arm, throttled by `reportedBlockClasses`. Do **not** add a second `reportError` — the throw site emits the firehose `logEvent` above and lets the latch own the report |
| refusal skipped, user chose the family file (A7)      | `pod-lineage`      | `info`                              | `action: 'user-file-recovery'`                                         | Already emitted by `useRemoteFileOverLocalDocument:3669` — reuse, do not duplicate                                                                                                                                          |
| rehydrate-failed chokepoint refusal (A5)              | `pod-lineage`      | `warn`                              | `action: 'local-unreadable-refused'`, `detail: 'rehydrate'`            | Same event, `detail` separates the two routes so the dedup bucket stays constant                                                                                                                                            |

**Group B events** — on the existing `pod-lineage` / `pod-access` surfaces, matching the investigation's own suggestion (`BUG-…md:570-573`) rather than minting `pod-restore`:

| event              | surface            | level                                                                    | context                                                                       | why                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| restore started    | `pod-lineage`      | `info`                                                                   | `action: 'restore-started'`, `provider_type`                                  | Denominator                                                                                                                                                                                                                                                                                                             |
| restore completed  | `pod-lineage`      | `info`                                                                   | `action: 'restore-completed'`, `provider_type`                                | The success rate                                                                                                                                                                                                                                                                                                        |
| restore failed     | `pod-lineage`      | `warn` (`reportError` `severity: 'warning'` where a human should see it) | `action: 'restore-failed'`, `error_code`                                      | Not `critical` unless data is at risk                                                                                                                                                                                                                                                                                   |
| re-home suppressed | `pod-access`       | `info`                                                                   | `action: 'restore-kept-pod'`, `provider_type`, `file_id_tail`                 | The C3 gap: today nothing distinguishes a restore that stuck from one that stranded. Emitted from `installPendingProvider`, so it cannot drift from the branch it describes — **guarded on `keepCurrentPod`**, because three of that helper's four call paths are ordinary join/login and must not emit a restore event |
| picker failed      | `pod-load-failure` | `warn`                                                                   | `action: 'picker-failed'`, `error_code` = `describePickFailure`'s `errorCode` | Reuses the surface `syncService.ts:2146` already opened for "a person picked a file this build cannot read"                                                                                                                                                                                                             |

**Critical vs. firehose.** Only one thing here warrants `severity: 'critical'`: a **deliberate** registry pointer write that the server refuses, because the registry then disagrees with where the pod is. That already exists at `syncStore.ts:5299` and is unchanged — and B4 means a restore never makes one. Everything else is firehose `warn`/`error` — a blocked merge is the system working.

**Privacy gate.** The intent is to ship **no new context keys**. If implementation finds a genuinely new key is needed, it must be added to `ALLOWED_CONTEXT_KEYS` (`diagnosticContext.ts:61`) **and** its Lambda mirror (`infrastructure/lambda/telemetry/index.mjs:65`, pinned by a drift test) **and** the data-collection table in `docs/runbooks/native-store-submission.md`, `PrivacyInfo.xcprivacy`, the store Data-Safety answers and `privacy.astro`. Never log a full `file_id`; `logPodAccessResult` already derives `file_id_tail` explicitly (`syncStore.ts:4048-4051`) and that pattern is followed.

**No silent catches.** Every new `try`/`catch` logs with `action` + `error_code` and a `console.warn` naming the fix. The one existing intentional swallow — `checkCanonicalPod`'s catch (`:4057-4068`) — already logs and is kept as-is. `docClient.noteRemoteBaseline` is fire-and-forget through a reporting wrapper (`docClient.ts:1209-1215`); S2's fix routes through it so a failed durable write is still reported.

## Acceptance Criteria

- [ ] A cache **rejection** never produces `{ kind: 'no-local-document' }`; a genuine miss still does, and `applyAndProject.ts` is unmodified.
- [ ] A device that genuinely holds nothing still adopts a compacted pod — `applyAndProject.ts:855-859`'s constraint provably preserved, with a test.
- [ ] The cross-family protection at `:861-870` is preserved: `syncStore.ts:1367`, `:1691` and `:2532` still send `no-local-document`, asserted.
- [ ] The `!currentDoc`-after-failed-rehydrate route is refused at the `docClient` chokepoint (`:1225`), not installed (A5), with a test. The `rehydrateFailed` flag clears on a successful `initAndLoadCache` **and** on family change, and appears in `__resetDocClientForTesting`.
- [ ] `LocalDocUnreadableError` satisfies `isRemoteBlocker` — asserted directly, so it can never be invisible to a dispatch — and `latches === true`.
- [ ] **The banner actually renders.** A mounted test drives the real store state a refusal produces (`podUnopenable` + `backgroundSyncErrorKind === 'local-unreadable'` + `podBlockMessageKey`) and asserts `LocalDocUnreadableBanner` shows the new copy and its action calls `useRemoteFileOverLocalDocument`. A second case asserts `LineageBanner` does **not** render for that state. (A2/A8 — this is the criterion Pass 2 was missing.)
- [ ] The refusal is **skipped** when `userChoseThisFile` is true, so the banner's "Use the family file" action resolves rather than re-raises (A7), with a test — and after it succeeds the latch is cleared (`clearPodUnopenable` + `retryAfterRemoteBlock`) and the banner is gone.
- [ ] `syncStore.resume.test.ts:505` **and** `:510` are re-pointed; **`:471` is unchanged** and carries a comment saying why. The new behaviour is mutation-checked — **each mutation verified to fail for the right reason**, per `docs/lessons.md`'s top entry.
- [ ] **The kind survives the poll (A8b).** `blockerErrorKind()` is used at **both** `syncStore.ts:3610` and `:3648`; a mounted test drives `notePodUnopenable` followed by `mirrorServiceLatch` (the poll's real order) and asserts the banner still renders. Mutation: revert `:3648` alone → the test fails.
- [ ] **The latch clears completely (A9).** After the recovery action, `backgroundSyncErrorKind` and `backgroundSyncError` are both null for the new kind — asserted directly, not inferred from `podUnopenable === false`.
- [ ] **`keepCurrentPod` cannot strand a first-load family.** `hasPod` is computed once and drives both the confirm string and the flag; `installPendingProvider` re-homes anyway (and logs) if the flag arrives with no provider bound. Mutation: pass the flag from the unconfigured slab → a provider is still installed.
- [ ] Exactly one `confirm()` call site with **two** message strings selected by `hasPod` (S5, as corrected by Pass 4).
- [ ] The genuine-miss restore emits `action: 'restore-unstamped'` and mints **no new UI string** (S6).
- [ ] S2's codec widening is in place: `DecodedBaseline.revision` is `string | null`, the revision-less decode arm precedes the existing one, and opening a local-file family logs **no** `console.error`.
- [ ] `pod-open-degrade` emits three distinct constant messages (hit / genuine-miss / unreadable) and still fires on every arm — **and the re-pointed `:510` test asserts the message constant**, not only surface/level/action.
- [ ] Drill 1 passes: B's offline to-do survives, is published, reaches A, and B shows the persistent banner. Run on `main` at HEAD, two profiles, same machine.
- [ ] On a Drive family, "Load another Family Data File" offers **Drive** files and the compaction safety copy is selectable — on Chromium desktop, not only on Firefox.
- [ ] A restore does **not** change the provider, the `fileId`, the Drive binding or the registry pointer — asserted on **both** re-home branches through `installPendingProvider`, plus an equivalence test driving both decrypt functions through one fixture.
- [ ] `decryptPendingFileWithKey`'s signature is **unchanged** (no `opts` bag), asserted by the equivalence test's call shape.
- [ ] After a restore, a peer adopts on its next poll with no sign-out, and its unsynced edits are rebased rather than dropped.
- [ ] `rebindPodFile`'s `isSafetyCopyName` refusal is unchanged and still covered.
- [ ] Terminus 4 emits `logMergeTerminus` (S1); the app has four call sites, not two.
- [ ] A blocker raised during login/resume reaches `FatalErrorOverlay` through **one** dispatch (S3) — asserted by a mounted test per blocker class, not by reading source. `BLOCKER_OVERLAY_KEY` is exhaustive over `PodBlockMessageKey`, and a test pins its payload/lineage rows against what `surfacePayloadFatal` / `surfaceLineageFatal` already produce.
- [ ] A local-file family persists a **durable** baseline row, so the rebase is available after a reload (S2).
- [ ] Exactly **one** load-file confirmation dialog exists in `SettingsPage.vue` (S5), rendered by `ConfirmModal`, and `showLoadFileConfirm` is gone.
- [ ] Every `PickBeanpodFileResult` arm and every `loadFromGoogleDrive` failure `reason` produces user copy + a console line; `cancelled` produces neither (B9). Covered by a test that enumerates the union, and the mapping lives in **one** place shared with `LoadPodView`.
- [ ] `podFileSourceArm` lives in `capabilities.ts`, dispatches on **provider only** (no "Picker available" predicate), and has a unit test per arm. `LoadPodView`'s `selectedSource` toggle and arm dispatch are unchanged; its pick-failure **copy does change** (the raw `VITE_GOOGLE_API_KEY` string stops reaching users) and that is noted in the CHANGELOG.
- [ ] **Complexity budget met:** two net new files, no new composable, `syncStore.ts` net line delta ≤ +40, no decision nested inside a decision, and every new closed union backed by a `satisfies Record<…>` table.
- [ ] The restore drill in `docs/plans/2026-09-06-compacted-pod-v5.md` names the browser.
- [ ] Copy updated in `uiStrings.ts` with both `en` and `beanie`; `npm run translate` run and the Chinese spot-checked for brand-term mistranslation.
- [ ] Gates: type-check, ESLint, **stylelint**, `npm run build`, full unit suite.
- [ ] Diagnostic logging in **Observability Coverage** implemented and verified; **no new `ALLOWED_CONTEXT_KEYS` entry** (`provider_type`, not `provider`), or the allowlist, its Lambda mirror and the store declarations all updated if one proves necessary.

## Testing Plan

1. **Unit.** The three-way classification (hit / genuine miss / rejection); the `chosenByUser` skip; the `rehydrateFailed` chokepoint refusal and its clear-on-family-change; `isRemoteBlocker(new LocalDocUnreadableError(…))` and `latches === true`; `installPendingProvider` with and without `keepCurrentPod` on both branches; the decrypt-function equivalence fixture; `isSafetyCopyName` still refused by `rebindPodFile`; `podFileSourceArm` per arm; `describePickFailure` over the full `reason` union.
2. **Mounted.** `LocalDocUnreadableBanner` renders and acts (A2); `LineageBanner` does not render for the new kind; each blocker class reaches `FatalErrorOverlay` through `surfaceBlockerFatal` with the right copy and `clearDataHelps: false`.
3. **Mutation checks.** For each new guard, introduce the mutation and confirm the test fails **for the right reason**. A guard that has never been seen to fail is not yet a guard. Specifically: flip the classification back to `no-local-document`; drop the `chosenByUser` skip; flip `latches` to `false` (**the banner must disappear — this is the Pass-2 defect**); **revert `mirrorServiceLatch:3648` alone, leaving `:3610` converted** (the banner must disappear — this is the Pass-3 defect, and it is the subtlest of the three); drop the `keepCurrentPod` guard on the Drive branch only (the ADR-033 fork); pass `keepCurrentPod` from the unconfigured slab (the first-load stranding); remove the `local-unreadable` arm from `clearPodUnopenable` (the stale-kind latch); remove the `rehydrateFailed` refusal.
4. **Worker integration.** Two documents through the real merge path, asserting the worker's existing behaviour is unchanged — Group A must be provably a no-op inside `applyAndProject.ts`.
5. **Two-browser local soak (Drill 1), from a RESET dev family** (Assumption 5): B offline edit → A compacts → B reconnects → expect rebase, publish to A, persistent banner; and the offline-press case where the banner must stay up.
6. **Restore drill, run twice and named both times:** once on **Chromium desktop** (the arm that re-homes today) and once on **Firefox**. Both must now behave identically, both must select the Drive safety copy, and after both the owner's provider config must still name the original pod. Confirm the peer adopts without a sign-out.
7. **Two-tab lockout drill (new).** Open the app in two tabs of the same profile, force the second tab's cache open to be blocked, and confirm: no data loss, the new banner appears, the poller stops, closing the other tab + reload clears it, and the banner's action also clears it.
8. **Plain sign-in regression** (no compaction involved), including a two-tab sign-in and a sign-out/sign-in cycle, because Group A changes behaviour on every load path.
9. **On-device**, deferred to the release: the Tab A9+/A7 run and the stale-build matrix from the v5 plan §8.4. Not gating this plan; gating the deploy.

## Pass-1 Corrections

Errors found by reading the code, in descending order of consequence.

1. **Group B would have caused the ADR-033 fork it forbids.** Routing Drive families through `usePickBeanpodFile` → `loadFromGoogleDrive` sets `pending.driveFileId`, and `decryptPendingFile:1733` re-homes the family onto the **safety copy's** Drive file. The suppression must cover the Drive branch; Pass 1 only discussed the local one.
2. **The re-home is in `syncStore`, not `syncService`.** `decryptPendingFile:1732-1759` and `decryptPendingFileWithKey:2570-2597`. Pass 1's "Files Affected" pointed at `syncService.openAndLoadFile` and omitted `decryptPendingFileWithKey` entirely.
3. **S3's premise is false.** `surfaceLineageFatal` (`payloadFailureSurface.ts:230`) → `FatalErrorOverlay` (`App.vue:1883`, outside `showLayout`) already renders lineage blocks at login/resume, wired at `App.vue:769`, `:842` and `ResumePodSetup.vue:396`. The `ResumePodSetup.vue:377` comment Pass 1 cited as acknowledging the bug documents the fix.
4. **`provider` is not an allowed context key.** `diagnosticContext.ts:95` has `provider_type`. Pass 1's "no new context keys" claim was false as written.
5. **Two pinned assertions, not one** (Pass 3: three tests, see below). `syncStore.resume.test.ts:471` (cross-family, must NOT change) and `:505` (the regression pin). A6 as written licensed changing the wrong one.
6. **S2 is narrower than claimed.** `syncService.ts:1224-1251` already maintains the in-memory `headsFp`; only the durable `noteRemoteBaseline` write (`:1268`) is skipped. The context is correct within a session and lost across a reload.
7. **`level` vs `severity`.** `LogLevel` is `'debug'|'info'|'warn'|'error'`; Pass 1's Group B table used `warning` as a level.
8. **Two confirmation strings and two render sites.** `settings.loadFileConfirmation` (`:3402`) and `settings.switchFileConfirmation` (`:3428`), duplicated at `SettingsPage.vue:1631` and `:1832`; plus `settings.switchDataFile` (`:3423`) and `compaction.safetyCopyNoteManual` (`:4325`) carry the same promise.
9. **Line drift** (all corrected in this document): `handleLoadFromFileClick` `:530` (not `:516`); `userChoseThisFile: true` `:572` (not `:552-558`); `loadFromNewFile` `:1510` (not `:1495`); the `no-local-document` basis `:980-981` (not `:986`); `pod-open-degrade` `:950` (not `:944`); `LocalStorageProvider.fromHandle` `syncService.ts:2174` (not `:2173`); `attemptSilentConfigHeal` `:4255` (not `~4200`); `checkedCanonicalFor` `:408`; `RETRYABLE_METHODS` `docClient.ts:528`; `CACHE_OPEN_TIMEOUT_MS` `worker/cache.ts:100` (not `docClient.ts`); `stampNewGeneration` assigned `applyAndProject.ts:925`, declared `:917` (not `~905`); "Move to Google Drive" `SettingsPage.vue:1778-1798`.

## Pass-2 Corrections

Errors and unsustainable structures found by reading the code in Pass 3, in descending order of consequence.

1. **Group A's refusal would have rendered nothing.** `latches = false` + "one new arm in `LineageBanner`" cannot work: `notePodUnopenable` early-returns at `:3606` before `podBlockMessageKey` is assigned when the blocker did not latch, and `LineageBanner`'s gate (`:51`) is `backgroundSyncErrorKind === 'lineage'`, which `:3610` assigns only for `instanceof PodLineageError`. Fixed by A8 (`latches = true`), a new `BackgroundSyncErrorKind` value assigned through a table, and a dedicated thin banner.
2. **`decryptPendingFileWithKey` has no `opts` object, deliberately.** Pass 2 said the flag goes "on the **existing** `opts` object" in both decrypt functions. `syncStore.ts:2504-2506` takes only `fk`, and `:2527-2531` says _"deliberately no parameter to pass one"_ about that very path. None of its five callers is a restore surface. Fixed: the guard lives in `installPendingProvider`; only `decryptPendingFile` forwards it.
3. **S3's remedy contradicted the file it was editing.** `payloadFailureSurface.ts:222-229` argues explicitly against generalising the two surfaces, and `:163-170` records a shipped drift bug caused by reusing an inline key as full-screen copy — which is exactly what Pass 2's "derives its copy from `err.inlineMessageKey`" would have done. Neither existing function reads `inlineMessageKey`. Re-scoped to a dispatcher plus a `Record<PodBlockMessageKey, …>` overlay table; both bodies untouched.
4. **A third pinned test, not two.** `syncStore.resume.test.ts:510` (`'counts the wholesale adopt…'`) also drives a cache rejection through `completeAutoLoad`. Its name, comment and the event message it asserts all become false under Group A.
5. **`pod-open-degrade`'s message becomes a lie.** It fires at `:950`, before the basis at `:980`, with the constant string `'cache unavailable — adopting remote wholesale'` — which is also the limiter/dedup bucket key. Pass 2 said "extend it, do not add a sibling" but never split the message. Fixed: three constant messages.
6. **`rehydrateFailed` was a second latch with no lifetime.** Cleared only "on the next successful `initAndLoadCache`", it would survive a family switch or sign-out and refuse every merge on a healthy device for the rest of the session. It also has to be added to `__resetDocClientForTesting` (`:1497-1518`), which enumerates every module flag, or it leaks between tests.
7. **`usePodFileSource.ts` should not be a composable.** No refs, no lifecycle — a pure predicate. `src/services/sync/capabilities.ts` already exports `isNative` / `supportsFileSystemAccess` / `canUseLocalFiles` and is already imported by both callers. Also, Pass 2 overstated the extraction: `handleOpenSavedFile`'s Chromium arm toggles `selectedSource` and emits its own `logEvent`, so only the three-line decision moves.
8. **B9 would have duplicated the pick-result mapping.** `LoadPodView.loadSavedFileViaPicker` (`:488-514`) already has the full switch. Fixed with a shared `describePickFailure`.
9. **The duplication is ~58 lines, not ~25.** `syncStore.ts:1703-1760` and `:2540-2597` are byte-identical including the family-adoption preamble and `initializeAuth`. Pass 3 scopes the extraction to the provider half (release-blocker risk control) and adds an equivalence test so the rest cannot drift.
10. **`installPendingProvider`'s restore event would fire on the join path.** Three of four call paths through it are ordinary join/login. The `restore-kept-pod` event must be guarded on `keepCurrentPod`.
11. **`checkedCanonicalFor` would gain a third and fourth raw assignment.** Wrapped in `invalidateCanonicalCheck()` beside the declaration.
12. **`docClient.mergeRemoteEnvelope` is at `:1225`, not `:1016`.** `:1016` is inside `surface()` and is about `isRemoteBlocker`, not about the merge chokepoint. The chokepoint claim itself is correct.
13. **Minor line drift** (all corrected above): `loadSavedFileViaPicker` `LoadPodView.vue:488` (not `:495`); `handleOpenSavedFile` spans `:459-479` (not `:459-481`); the native-picker comment `:451-453` (not `:451-454`); `drivePicker` shared view `setQuery('*.beanpod')` `:252` (not `:251`); `pod-load-failure` for an unreadable picked file `syncService.ts:2146` (not `:2144`); `noteRemoteBaseline` fire-and-forget `docClient.ts:1209-1215` (not `:1210-1213`); `commitRemoteBaseline`'s early `return` `:1250` (not `:1251`); the safety-copy "stacks" comment `constants/compaction.ts:22-33` and `isSafetyCopyName`'s doc `:40-47`; `bootstrap.ts:29-35`; `checkCanonicalPod`'s catch `:4057-4068`; `ALLOWED_CONTEXT_KEYS` members at `:95`/`:96`/`:188` (the `Set` opens at `:61`); the `no-local-document` literal in the cross-family test is on `:472`.
14. **A useful non-error, worth recording** (it bounds the change): `replaceDocWithCacheRecovery` has exactly three callers, and both decrypt functions already dispatch structurally on `isRemoteBlocker` and call `notePodUnopenable` (`:1820`, `:2665`). **Group A's throw needs no new catch anywhere.**

**Verified correct in Pass 2** (unchanged here): `applyAndProject.ts:855-870`, `:898`, `:917`, `:919`, `:925`, `:1030-1074`; `podLineage.ts:161-178` and `:176`; `rebindPodFile` `syncStore.ts:4753` and the `isSafetyCopyName` refusal `:4769`; `checkCanonicalPod` `:4029`, `:4035`, `:4036`; `checkedCanonicalFor` `:408`; `registerCurrentFamily` `:5269` and the critical report `:5299`; `attemptSilentConfigHeal` `:4255` and its idempotent return `:4256-4260`; `commitRemoteBaseline` `:1222` and `noteRemoteBaseline` `:1268`; `RETRYABLE_METHODS` `docClient.ts:528`; `CACHE_OPEN_TIMEOUT_MS` `worker/cache.ts:100`; `reportRehydrateFailure` `:368` with call sites `:355`/`:426`; `RemoteMergeError` `types/sync.ts:606`; `isRemoteBlocker` `:259`; `PodBlockMessageKey` `:188-196`; `protocol.ts:287-320` and `:320`; `PickBeanpodFileResult` `drivePicker.ts:173-180` and the config log `:201`; `driveService.ts:752`; `registryService.ts:9`; `featureFlags.committed.ts:18`; `uiStrings.ts` `:3402`/`:3423`/`:3428`/`:4320`/`:4325`/`:4553`; `App.vue:375`, `:1883`, `:1917`, `:2169`, `:2204`; `ResumePodSetup.vue:396`; `payloadFailureSurface.ts:153`/`:230`; `SettingsPage.vue:530`/`:534`/`:566`/`:572`/`:1778-1798`/`:1631-1646`/`:1832-1848`; `useConfirm.ts` `detailTone`/`variant` support; exactly two `logMergeTerminus` call sites.

## Pass-3 Corrections

Found by reading the code in Pass 4, in descending order of consequence.

1. **The refusal STILL had no render site — third instance, subtlest door.** The kind ternary exists twice: `syncStore.ts:3610` (which Pass 3 converts) and `:3648` inside `mirrorServiceLatch`, which the 10s poll's `.finally()` (`:3790`) runs immediately after `notePodUnopenable`. Converting only `:3610` means the poll path — the path this bug travels — overwrites `'local-unreadable'` with `'decrypt'` in the same tick, hiding the banner while `podUnopenable` stays true. `useRemoteFileOverLocalDocument`'s `finally` (`:3718`) clobbers it too, so a failed recovery also loses the banner. Fixed by A8b: one shared `blockerErrorKind()` at both sites.
2. **`clearPodUnopenable:3749` would never clear the new kind**, so the "banner is gone" criterion passed vacuously via `podUnopenable = false` while a stale kind and an identical message string persisted — re-triggering the non-re-firing-watcher bug its own comment at `:3745-3748` records. Fixed by A9.
3. **`keepCurrentPod` would strand an unconfigured family with no provider at all.** The click/confirm/decrypt handlers are shared by the unconfigured slab (`SettingsPage.vue:1625-1646`) and the configured one (`:1826-1848`). A first load with the flag set skips `storeProviderConfig` + `setProvider` and opens a document with nowhere to save it. Fixed with the `hasPod` predicate, enforced inside `installPendingProvider`.
4. **S5's "one string" was wrong on the merits** — the two slabs legitimately differ. One `confirm()` call, two strings, selected by the same `hasPod` predicate.
5. **S2's remedy is not implementable as written** — it needs a `remoteBaseline` codec widening (`DecodedBaseline.revision: string | null`, a new decode arm placed first, `encodeBaselinePayload`'s param widened), or a revision-less row decodes to "no baseline" and `console.error`s on every open. Early `return` is `:1251`, not `:1250`.
6. **B8's non-Drive comparison is vacuous by construction** — `RegistryEntry.fileId` is Drive-only and `getFileId()` is null for local, so the comparison is always equal; `displayPath` would false-positive and then offer a recovery that cannot act. Re-scoped to a diagnostic-only provider-mismatch arm, no new banner state.
7. **S3 is a hard prerequisite for Group A, not a tidy-up.** `completeAutoLoad:4706` routes non-`PayloadLoadError` blockers to `lineage-blocked` and `ResumePodSetup` renders `inlineMessageKey` into `formError`; Group A's copy names controls that screen does not have.
8. **`resume.test.ts:510` will not fail under Group A**, because it never asserts the message string — the re-point is unenforced unless the new test asserts the message constant.
9. **`describePickFailure` is a new table, not a de-duplication.** `LoadPodView:490-514` has no per-`reason` copy; it renders `picked.message`, which for `config` leaks the raw `VITE_GOOGLE_API_KEY` string to users. Adopting the table there is a deliberate copy change (and a bug fix).
10. **Zero `satisfies Record<PodBlockMessageKey, …>` tables exist today** — `types/sync.ts:501` uses the union as a value type. The compile-error guarantee begins with S3.
11. **A "Picker available" predicate would never fail in dev** — a guard nobody has seen fail. Dropped; dispatch on provider only.
12. **The genuine-miss restore still mints nothing** (S6) and **`preserveLocalKeyDicts` unions key dicts but cannot survive a post-copy key rotation** (S7) — both named rather than assumed.
13. **Minor:** `decryptPendingFileWithKey` has **six** callers, not five (conclusion unchanged — none is a restore surface); its "deliberately no parameter" comment is at `:2520-2523`; the byte-identical span is `:1703-1759` ≡ `:2541-2597` (57 lines); `BackgroundSyncErrorKind` is `:151-156`.
14. **Two stale comments** to fix in the docs commit: `applyAndProject.ts:~887` ("`podCompaction` is OFF and has never shipped enabled") and `types/sync.ts:151-157`'s `lineage-blocked` doc-comment.

## Post-implementation: what the code review and the field changed

The plan was implemented, reviewed at `max`, and then corrected twice — once by
the review, once by greg testing the result. Both rounds are recorded here
because the corrections are more instructive than the plan.

### The plan's central technical decision was wrong

**"Do not touch `applyAndProject.ts`."** Passes 2-4 all endorsed keeping the
refusal on main. The review showed that produced two hand-placed guards in two
layers with different rules, and found three separate leaks:

1. The `docClient` gate was a synchronous pre-check that ran BEFORE
   `request()` → `ensureReady()` → `spawn()` — which is where the rehydrate
   happens and where the latch would be set. It could not fire on the merge it
   was written to stop. Its tests passed only because they called merge a second
   time, after a prior call had armed the latch.
2. The retryable re-issue went through `requestCore`, bypassing the wrapper and
   its gate entirely.
3. A rehydrate that RESOLVED `{loaded:false}` — which `initAndLoadCache` does
   whenever the cache row is absent — armed nothing at all.

**The fix is the one `applyAndProject.ts:861-870` already argued for:** make the
install a POSITIVE ASSERTION (`basis.kind === 'no-local-document'`) and refuse a
docless worker that was not told to install. That subsumes all three, deletes the
main-thread latch, and means there is no longer a _route_ into the wholesale
install that can be forgotten — there is one instruction. `LocalDocUnreadableError`
now crosses the worker boundary, so it needed a `protocol.ts` codec entry; without
one it degrades to a bare `DocWorkerError`, `isRemoteBlocker` returns false, and
every dispatch silently stops seeing it. That entry had no test until a mutation
proved it was unguarded.

### Two data-loss paths the implementation introduced

- **Cross-family corruption.** `installPendingProvider`'s `hasPod` read the
  SESSION's provider, but the family-identity block has already switched to the
  picked file's family — so "keep the current pod" meant "keep the previous
  family's pod" while holding this one's document, and the next save would write
  over it. Now gated on `getProviderFamilyId() === activeFamilyId`.
- **The lost-provider cohort.** `isConfigured && !storageProviderType` is the
  cache-only state after a config eviction — the state someone is most likely to
  restore FROM. A two-valued `hasPod` called it a first load, showed the wrong
  wording and re-homed a Drive family onto the backup. Now a third state that
  REFUSES: if we cannot see where the family's pod is, we must not move it.

### The copy promised something the policy does not do

`same × user-file` resolves to `merge` (`podLineage.ts:162`), so for a pod that
has never been compacted a restore UNIONS with the live document. The dialog said
"replaces your family's data everywhere", on a red destructive confirm. It now
describes the union, says nothing is deleted, and is no longer red.

### The field found what neither the plan nor the review did

greg tested and hit three things:

1. **The picker guessed the source.** Also review finding 8 — and when the Picker
   failed, the copy named a local-file control that no longer existed.
2. **Restoring revoked the family's Google grant.** `usePickBeanpodFile.pick()`
   defaults `forceConsent: true`, and `googleAuth.ts:1019` does revoke-before-mint.
3. **An unclosable dialog that cost a browser restart.** `picker.setVisible(true)`
   had NO counterpart anywhere in `drivePicker.ts` — no dispose on timeout, on
   iframe failure, or on throw. When Google rejected the developer key its own
   modal, which has no close control, stayed up permanently.

**greg's question was the better fix:** use `GoogleDriveFilePicker`, the component
the sign-in screen already uses, instead of the Google Picker. It lists only
`.beanpod` files (so a non-beanpod file cannot be chosen because it is never
offered), needs no `VITE_GOOGLE_API_KEY`, renders no third-party modal, and was
already built. The teardown fix stays, because the folder picker still uses the
Picker and had the same defect plus no timeout at all.

### Mutation results

Thirteen mutations across both rounds; all caught. Two were NOT caught first
time and are worth naming, because both were guards written specifically to
avoid this failure mode:

- The `rehydrateFailed` family-change clear was driven through
  `initAndLoadCache`, which clears the flag itself, so the test passed with the
  clear deleted. (Moot now — the latch is gone.)
- The `protocol.ts` codec entry had no test at all.

## Review Passes

- **Pass 1 (Initial draft)**: Drafted from the confirmed field repro, the 586-line provider-switch investigation, and a direct read of the registry/canonical/rebind machinery; chose restore-in-place over greg's literal pointer-move after finding `rebindPodFile`'s safety-copy refusal and the ADR-033 reasoning behind it.
- **Pass 2 (DRY + error handling)**: Verified every citation against the code and corrected nine — including that Pass-1's Group B would itself have caused the ADR-033 fork; replaced the `LineageBasis` third kind with a main-thread-only refusal that leaves `applyAndProject.ts` and the worker protocol untouched; folded new work onto existing machinery (`useConfirm`/`ConfirmModal`, `surfaceBlockerFatal`, `pod-open-degrade`, `LoadPodView`'s picker dispatch, `installPendingProvider`) instead of duplicating it; and made every picker/decrypt/restore failure arm speak.
- **Pass 3 (Sustainability)**: Found Group A's refusal had no render site (`latches: false` dead-ends at `notePodUnopenable:3606`, and `LineageBanner` gates on `'lineage'`) and fixed it with a latching blocker plus a fourth thin banner rather than a third arm in a two-arm component; corrected the `decryptPendingFileWithKey` signature claim and moved the restore guard into one extracted helper; re-scoped S3 from a generalisation the file argues against into a one-file dispatcher with a compiler-enforced overlay table; moved the picker dispatch out of a new composable into `capabilities.ts` and de-duplicated the pick-failure copy; gave `rehydrateFailed` a lifetime and a reset entry; named the canonical-latch invalidation; split the now-untrue `pod-open-degrade` message; and added a **Complexity Budget** with a Group-A-alone shippability split.
- **Pass 4 (Fresh-eyes sweep)**: Verified every load-bearing citation against `main` and found the refusal _still_ had a clobbered render site — `mirrorServiceLatch:3648` carries a second copy of the kind ternary that the 10s poll runs immediately after `notePodUnopenable`, hiding the new banner on the exact path the bug travels; also found `clearPodUnopenable:3749` would never clear the new kind, that `keepCurrentPod` would leave a first-load family with no provider at all, that S2's remedy needs a `remoteBaseline` codec change, that B8's non-Drive comparison is vacuous by construction, that S3 is a hard prerequisite for Group A rather than a tidy-up, and that the `:510` test re-point is unenforced unless it asserts the message constant.

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt (session start, compaction testing)

> Ok - let's run the compaction test now, pls list the steps

### Follow-up 1

> ok - note i've exported the current pod file to /tmp/gp-test-family-v3.beanpod - note that this is after compaction that took place already in the previous testing session

### Follow-up 2

> sorry, i meant to type v2, which is the pre-compacted version of the gp dev fam beanpod file. v3 is on my other computer (which i'm using to ssh to my desktop now). I've done most of the testing already, the main issue i'm seeing is that in drill 1, after i brought session B back online, the todo item i had created in session B while offline was deleted (which seems to match what you were expecting - session B was rebased) - but given that, of course that item did not move to session A as it had already been overwritten by the remote beanpod. i was also not able to confirm an orange banner on session B after going back online - it came back online, the offline todo item disappeared once it synced with the remote beanpod, and from what i could tell the offline entry was not merged with the beanpod
>
> one other issue i'm seeing is that it seems loading anotehr family data file still just opens a file picker - i thought that the whole point of the plan we just wrote and implemented was to fix that surface so that loading another family file can be from the storage provider (i.e. google drive), since now, loading another family data file just moves the family to local file. did i misunderstand the purpose of the previous plan and impelemntation?

### Follow-up 3

> What's interesting is in the compaction testing just this morning this functionality worked perfectly - i added a todo while offline in session B, ran compaction on session A, and when session B came online the change in session B propogated to session A with no issues. Perhaps something just implemented broke that? the only difference is that previously i was testing on my desktop and now i'm on my laptop

### Follow-up 4

> note that i'm running the code on my desktop in both cases. previously i was working directly on my desktop, and now i'm working on a port-forwarded session from my laptop. i did the testing on my laptop before 9am, before we started the new plan and implemented these changes. A and B were both always on the same machine

### Follow-up 5 (the plan request)

> Ok - let's put this fix through /beanies-plan and at the same time plan and implement the fi to the 'load another family data file' option - the recovery method. these are both required for us to go live, and given the research done in the previous plan to understand the surface hopefully we can tackle both and complete them in this plan. moving to another data file should respect the storage provider (either local file or google drive) and other devices on the same family should not be abandoned. switching to a backup file makes the change across the whole family, which should be straightforward given that every family member and device should check the registry to see which data file they should be pointing to. perhaps the only change or fix required is that for family members currently logged in, they may need to logout/login to move to the new data file, or perhaps they are already checking the registry periodically and could load the new data if the file changes (maybe with a prompt) - will leave it to you to determine the best way to handle this

</details>
