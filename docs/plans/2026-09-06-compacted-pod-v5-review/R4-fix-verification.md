# R4 — verification of the fix round (`c4f0c88b`)

> Date: 2026-09-07
> Subject: the single fix commit `c4f0c88b`, read against R1/R2/R3 and the code.
> Method: every hunk read against its target, every caller traced, the full gate
> run, and six mutations applied to see whether the tests actually hold.

## Verdict

**A FIX IS WRONG.** Fix 1 (`cancelled` on `OpenFileResult`) covers only the
File System Access branch of the picker. On iOS, Android, Firefox and Safari —
every platform except Chromium desktop — dismissing the picker still shows an
error. Proven by an executable probe, not inferred. Everything else in the
commit is right or right-with-a-follow-up.

---

## Findings, most severe first

### F1 (HIGH) — the `cancelled` fix covers Chromium desktop only. Native and Safari still show an error on Escape.

**VERIFIED, by code and by a probe test that failed.**

`openAndLoadFile` has two branches; only one was fixed.

- `src/services/sync/syncService.ts:2138-2141` — when the File System Access API
  is absent the entire call delegates:
  `if (!supportsFileSystemAccess()) return openAndLoadFileFallback();`
- `src/services/sync/syncService.ts:2180-2181` — the fallback's cancel arm is
  `const file = await openFilePicker(); if (!file) return { success: false };`
  **No `cancelled`.** This is the exact bare shape R2's F1 identified as the bug.
- `src/services/sync/fileSync.ts:288-299` — `openFilePicker` resolves `null` from
  `input.oncancel`, so a dismissal is precisely this `!file` path.
- The new test says so itself:
  `src/services/sync/__tests__/openFileVersion.test.ts:135-137` — _"Drive the
  File System Access branch, **whose abort arm is the one that changed**"_,
  with `vi.mocked(supportsFileSystemAccess).mockReturnValueOnce(true)`. Note the
  suite's default mock is `false` (`openFileVersion.test.ts:49`), i.e. the
  fallback — the one branch the new test deliberately steps around.

**Which platforms take the fallback.** `supportsFileSystemAccess()`
(`src/services/sync/capabilities.ts:30-36`) requires `showOpenFilePicker`, which
exists only on Chromium desktop. `LoadPodView`'s own dispatch comment states the
routing: `src/components/login/LoadPodView.vue:450-457` — _"Native (iOS/Android):
the OS file picker (`<input type=file>` → `openAndLoadFileFallback`)"_ — and
`LoadPodView.vue:475-478` routes `isNative()` straight into `handleLoadFile()`.

**Probe (written, run, deleted).** A temporary spec in
`src/services/sync/__tests__/` reusing that suite's mocks (so
`supportsFileSystemAccess` is `false`), stubbing `document.createElement` so the
`<input type=file>` fires `oncancel` on click:

```
const r = await syncService.openAndLoadFile();
expect(r.cancelled).toBe(true);   //  Expected true, Received undefined
```

**Reproduction and consequence.** On iOS/Android (or Firefox/Safari desktop):
Settings → Load another Family Data File → confirm → dismiss the OS sheet.
`SettingsPage.vue:542-545` falls through to the final `else` and sets
`importError = t('settings.importFailed')` — a red "import failed" for an
ordinary Escape, which is the regression the commit message says it removed.
Same on `LoadPodView.handleLoadFile` (`LoadPodView.vue:519-545`) and
`JoinPodView.handleLocalLoadResult` (`JoinPodView.vue:161-193`), and on
`SettingsPage.handleManualImport` (`SettingsPage.vue:641-660`) via
`syncStore.manualImport` → `loadFromNewFile`.

On that fallback path `LoadPodView` additionally still has the arm the Settings
fix deleted as unsafe: `else if (syncStore.error) formError.value =
syncStore.error;` (`LoadPodView.vue:536-537`) — the raw, untranslated service
string, which the fallback leaves set from any previous attempt (the fallback's
cancel arm calls no `updateState`, so it clears nothing either).

**Fix:** `return { success: false, cancelled: true };` at `syncService.ts:2181`,
and add a fallback-branch case to the new test (the suite's default mock already
puts you on it). Consider deleting `LoadPodView.vue:536-537` for the same reason
the raw-`syncStore.error` fallback in `SettingsPage.vue:542-545` was deleted.

### F2 (MEDIUM) — fix 3 moved a nullable module deref to _after_ the multi-second write

**VERIFIED.** `src/services/sync/syncService.ts:1881-1885`:

```
const ack = await providerAtWrite.write(fileContent);
// ⚠️ AFTER THE ACK, NOT BEFORE. ...
noteWrittenVersion(versionDetail, currentEnvelope.familyId);
```

`currentEnvelope` is a module-level `let` that `reset()`
(`syncService.ts:925`) and `disconnect()` (`syncService.ts:2363`) null, with no
serialization against an in-flight save. The C1 comment eleven lines above
(`syncService.ts:1869-1877`) names this hazard in terms: _"A sign-out /
family-switch can null or swap `currentProvider` during this multi-second
write"_, and the comment at `:1866-1868`: _"If the catch handler dereferenced it
after that, the handler itself would throw and turn a write that actually
reached Drive into a reported save failure."_

That is now what the **success** path does. A sign-out or family switch landing
during the write makes `currentEnvelope.familyId` throw a `TypeError`, caught by
`doSave`'s catch (`syncService.ts:1964-1969`), which calls `recordSaveFailure`
and returns `false` for a write that landed. `learnRemoteMarker` /
`commitRemoteBaseline` never run, so the next save re-uploads the whole pod, and
`forceSaveWithTimeout` reads the `false` as "nothing was saved".

Before the fix the deref sat before the write, so the fix introduced it.
TypeScript does not catch it: the narrowing from `if (!currentFamilyKey ||
!currentEnvelope) return false` at `:1756` survives the awaits by design
unsoundness. No test covers it (every test in `savePathVersion.test.ts` resolves
the write without a concurrent `reset()`).

**Fix:** capture it beside `providerAtWrite` —
`const familyIdAtWrite = currentEnvelope.familyId;` before `:1881`.

**Related, smaller:** `noteWrittenVersion` runs **before** the family-switch
guard at `:1884` (`if (currentProvider !== providerAtWrite)`), so on a mid-write
switch the old family's `versionDetail` is written into `lastVersionDetail`
_after_ `reset()` cleared it — re-arming the exact suppression fix 4 exists to
remove, for the new family's first save.

### F3 (MEDIUM) — the CHANGELOG still contradicts itself; one of three gate sentences was removed

**VERIFIED.** The commit deleted the "beanies will not compact while someone in
your family is on an older version" bullet. Two further descriptions of the
deleted refusal survive **in the same unreleased 2026-09-06 section**, under
Fixed:

- `CHANGELOG.md:43` — _"**You no longer have to attempt the compaction to find
  out it will not run**, and read a message that named nobody."_
- `CHANGELOG.md:44` — _"The refusal you actually saw first had the names
  available and threw them away; only the second, much later check used them."_

Both describe a gate that `CHANGELOG.md:15` (Added, same section) says does not
exist: _"Settings simply names anyone who last opened beanies on an older
version so you can ask them to update first."_ A reader is told the compaction
can refuse, and that they no longer need to trigger the refusal to see who — in
a build where it never refuses.

`docs/STATUS.md` **is** now internally consistent: `:65` marks the Stage 4 OWED
list superseded and `:66` marks (a) fixed, (b) and (c) moot. One stale figure
remains at `docs/STATUS.md:72` — _"Full gate at the end: 6544 tests"_ — which
this commit's new tests moved to 6549.

### F4 (MEDIUM) — the login funnel now emits two spellings of the same failure

**VERIFIED.** `src/composables/useLoginFlow.ts:452` was converted to
`payloadErrorKind(e)` (`credential-stale | needs-update | unreadable |
too-large | corrupt`). The other two hand-rolled ladders in the **same**
composable, feeding the **same** `emitProveOutcome` on the **same**
`login-flow` surface, were not converted:

- `src/composables/useLoginFlow.ts:691-695` — `dec.payloadError.deviceCannotOpen
? 'too-large' : 'corrupted'`
- `src/composables/useLoginFlow.ts:905` — `errorCode: tooLarge ? 'too-large' :
'corrupted'`

So a damaged pod now files as `corrupt` from the staged branch and `corrupted`
from the PIN-decrypt and password branches. A CloudWatch filter on either
spelling silently under-counts, and the two cannot be summed without knowing
this exists. R2's F3 named only `:444`, so the fix is faithful to the request —
but the request left the surface inconsistent, which is worse than the single
wrong ladder it replaced.

**The widening itself is safe.** `emitProveOutcome`'s `errorCode` is `string`
(`src/services/telemetry/loginFlowEvents.ts:46-53`) — no enum, no union, no
`as const satisfies` table, and no test asserts the outcome set (the other
`'corrupted'` hits in the tree are the unrelated `FileErrorKind` in
`localProvider.ts:27` and the `syncStore` resume `kind` in `types/sync.ts:122`,
neither reachable from this funnel). Nothing else the funnel emits changed.

### F5 (MEDIUM) — the removed test: the argument is sound but points at the wrong sibling, and one thing it claims to cover is genuinely unpinned

**Judged. Mutation-tested both ways.**

The comment at `src/services/automerge/worker/__tests__/rebase.test.ts:835-843`
claims the test it sits on ("mints NOTHING when a user-file choice takes a NEWER
file over a stale local document") covers the `user-file` rebase fallback,
because `stampNewGeneration` is keyed on the verdict rather than on which branch
set `installWholesale`.

**The structural argument is TRUE.** `applyAndProject.ts:861` computes
`stampNewGeneration = act === 'adopt' && verdict === 'ours-newer' && lineageCtx
=== 'user-file'` **once, before any branch**, and the install branch only reads
it (`:976`). The fallback's tuple is `('rebase', 'adopt-remote', 'user-file')`,
failing two of three conjuncts.

**The covering claim is FALSE as written, but harmless.** The test it is
attached to never executes the fallback — `rebaseOntoRemote` is never forced to
return `null` there. However a **different** test in the same file does:
`rebase.test.ts:219-236`, _"still adopts when the rebase cannot run, because the
human said replace"_, passes `heads: null` so `rebaseOntoRemote` is never
called. Mutating `applyAndProject.ts:942` from
`installWholesale = act === 'adopt' || act === 'rebase'` to
`installWholesale = act === 'adopt'` **fails that test** (`expected 'merged' to
be 'adopted'`), which is exactly the cross-lineage-merge hazard. So the fallback
path is not unpinned; the comment simply names the wrong sibling and should say
so.

**One thing on that path IS unpinned, and it is the thing the comment argues
about.** Nothing asserts that the fallback does **not** mint. Mutating
`applyAndProject.ts:861` to

```
stampNewGeneration =
  (act === 'adopt' && verdict === 'ours-newer' && lineageCtx === 'user-file') ||
  (act === 'rebase' && lineageCtx === 'user-file');
```

**survives the whole worker suite** (15 files, 222 tests, all green). Live
consequence: a user-file adopt standing in for a failed rebase would stamp a new
generation on top of a file that already carries the newest one, making this
device `ours-newer` against every peer, which then `publish-local`s a fresh
generation across the fleet — the churn the `stampNewGeneration` doc comment
(`applyAndProject.ts:849-851`) explicitly forbids: _"never on the `user-file`
rebase fallback (`adopt-remote`, a NEWER file: nothing to mint)"_.

Also unpinned on the same path: `applyAndProject.ts:1009`'s
`...(rebaseUnavailable ? { rebaseUnavailable: true as const } : {})` — deleting
it leaves 38 worker+sync suites (510 tests) green. That is the one signal the
soak reads to tell broken rebase machinery from a correct refusal; the two tests
that mention `rebaseUnavailable` (`protocol.test.ts:35`,
`docClient.test.ts:289`) construct it by hand and never run `applyAndProject`.

**Recommendation:** one assertion added to `rebase.test.ts:219-236` —
`expect(lineageOf()).toEqual(<the file's lineage>)` and
`expect(res.rebaseUnavailable).toBe(true)` — closes both, and the comment at
`:835-843` should point at that test instead of arguing from structure.

### F6 (LOW) — the `fileVersion` clamp is correct and completely untested

**VERIFIED both ways.** The regex at `src/types/sync.ts:397` is right:
`/^[\w.+-]{1,16}$/` allows alphanumerics, `_`, `.`, `+`, `-`, length 1-16, with
JS `$` anchoring at true end-of-input (no `m` flag, so no trailing-newline
escape). It is applied **before** `super(...)`, so both the message
(`:398`) and the field (`:403`) carry the clamped value, and
`blockDetail` (`:409-411`) derives from the field. A clamped value renders as
`Unsupported beanpod version: unrecognised` / `version=unrecognised` — both
diagnostic-only strings; the user sees `t('podNewerVersion.inline')`.
`parseBeanpodV4` guarantees a `string` input (`fileSync.ts:129-131`), so `.test`
cannot be handed a non-string.

But replacing the whole line with `const safe = fileVersion;` leaves 29 suites
(408 tests) green. `fileSync.test.ts:161` asserts only the happy `version=6.0`.

### F7 (LOW) — the picker telemetry only fires for classified blockers

**VERIFIED, and probably intended — flagged so it is a decision.**
`openFileFailure` (`syncService.ts:2112-2133`) reports only inside
`if (isRemoteBlocker(e))`. The non-blocker arm (`:2131-2132`) still returns
silently, so "person picked a file that is not a beanpod / is empty / has torn
JSON" (the plain `Error`s thrown by `parseBeanpodV4` at `fileSync.ts:114,124,131`
and the two `File is empty` arms) remains dark. The plan's "five-surface drill"
tests the newer-version case, which does report.

### F8 (LOW) — the new Chinese string calls the app "Bean"

`public/translations/zh.json` `compaction.why.devices` now reads
_"仍然使用较旧版本**Bean**的设备…"_. CLAUDE.md's terminology table forbids
anything but `beanies.family`/`beanies`; the sibling line in the same hunk
(`compaction.confirmMessage`) says _"**Beanies**会先保存"_, also capitalised.
Both hashes are correct — I recomputed `hashString` from
`scripts/updateTranslations.mjs:48-56` and got `u6501` and `4jwhb8`, matching the
file — so the pipeline will **not** retranslate these; the wording has to be
fixed by hand.

### F9 (INFO) — the new copy understates what a stale device can still do

`compaction.why.devices` now says a device on an older version _"stops syncing
until it is updated"_ (`src/services/translation/uiStrings.ts:4307-4312`). True
of the READ direction and a strict improvement on the false sentence it
replaced. `docs/STATUS.md:69` records the other half: _"A stale build can still
OVERWRITE the pod (any save on a warm-cache device …)"_. Not worth adding to the
popover, but it is the reason the notice matters and the copy does not say it.

---

## The two rewritten sentences: both replacements are TRUE

**`compaction.why.devices`.** The old sentence promised a device on an older
version _"shows a message and syncs again once it updates"_. VERIFIED FALSE
against the deployed build: `git show c3a6be98:src/services/sync/fileSync.ts`
line 73-75 is `if (obj.version !== '4.0') throw new Error(...)` — a bare `Error`,
not a `RemoteBlocker`, so no `payloadError` classification and none of the
"update beanies" copy exists in that build. The replacement is true.

**The Help infoBox** (`src/content/help/how-it-works.ts:52-58`). Traced the
rebase policy end to end for the case it describes — a device that was behind,
made changes, then updated:

- verdict `adopt-remote` (the remote carries the newer lineage), context `dirty`
  → policy `rebase`;
- `applyAndProject.ts:889-913` replays the peer's changes onto the compacted
  document and returns `rebased`, so _"beanies brings across what you added"_ is
  true;
- when the replay cannot run (`basis.heads` absent, or `rebaseOntoRemote`
  returns null) and the context is **not** `user-file`,
  `applyAndProject.ts:937-939` throws the block, which surfaces
  `podLineage.unsyncedInline` (`uiStrings.ts:4509-4513`): _"Your family file was
  reorganised on another device, and this one still has changes that were never
  saved to it. Export them from Settings if you want to keep them, then choose
  Use the family file."_ So _"it tells you and keeps your changes until you
  decide"_ is true of exactly that path.

---

## Per-fix table

| #   | Fix                                  | Verified?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `cancelled` on `OpenFileResult`      | **NO — WRONG.** FSA branch only; `openAndLoadFileFallback` (`syncService.ts:2181`) still returns a bare `{success:false}`, so iOS/Android/Firefox/Safari still show an error. Proven by probe. The four callers, the store plumbing (`syncStore.ts:1488-1530`, `:1533-1577`, `:2885-2894`) and the `lastError: null` clear are all correct in themselves. `loadDroppedFile` needs nothing (a drop cannot be cancelled) and correctly sets nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2   | The `pod-version` alarm              | **YES.** `syncService.ts:1856-1857`: `undefined`/`null`/`seq` are three distinct rows. `beanpodVersionFor(lineage ?? null)` cannot mask — `beanpodVersionFor(undefined)` and `(null)` both derive `4.0` (`fileSync.ts:64-69`), so `?? null` is a type coercion only, and the write itself takes the same undefined value through `reEncryptEnvelope`. The comment's claim about the first cut is true: `lineage?.seq ?? 'none'` made `version=4.0` and `seq=none` coextensive. The `ExportedPayload.lineage` type is `PodLineage \| null` (`protocol.ts:34-39`), so `undefined` can only arrive from a boundary that dropped the field — exactly the alarm's stated meaning. Mutant (collapse to `lineage?.seq ?? 'none'`) is CAUGHT.                                                                                                                                                                                                                                                                                  |
| 3   | Emit after the ack                   | **YES for the ordering** — `noteWrittenVersion` is the statement immediately after `await providerAtWrite.write(...)` (`:1881-1885`), there is exactly one `.write(` in the module, and no early return sits between them. Mutant (move it back beside the derivation) is CAUGHT. **But see F2**: the call dereferences `currentEnvelope` after the write.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 4   | `reset()` clears `lastVersionDetail` | **YES.** `syncService.ts:908-913`, first statement in the function; the diff adds nothing else and removes nothing. Mutant (drop the line) is CAUGHT.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | `reportError` in `openFileFailure`   | **YES.** `syncService.ts:2115-2130`: `severity: 'warning'` → firehose + console, no Slack page (`errorReporter.ts:54-59`). No double-report: the only other `pod-load-failure` emitters are `noteRemoteUnreadable` (`:150-162`, poll/merge path) and `reportPayloadFailure` (`payloadFailureSurface.ts:108-121`, the reload/permission path at `SettingsPage.vue:448` and `LoadPodView.vue:424`) — neither runs on the picker path. Dedup bucket is `surface::normalizeMessage(message)` (`errorReporter.ts:145-147`); the message is `Picked file not readable: ${blockCode}`, and `blockCode` is the step/verdict (`sync.ts:307-309`, `podLineage.ts:106-108`) — a small closed set, so the bucket stays constant and differs from both siblings' messages. Context keys `action` / `error_code` / `detail` are all pre-existing allowlist members (`loginFlowEvents.ts:10`), so no store-declaration change is owed. No user data: the per-file value rides `blockDetail` (`version=<clamped>`), never the message. |
| 6   | `fileVersion` clamped                | **YES, correct** (regex, both the field and the message, sensible copy) — **but untested**, see F6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7   | `payloadErrorKind` in `useLoginFlow` | **YES for the conversion, and it broke no other outcome code** — `errorCode` is a bare `string` on `emitProveOutcome`, no enum or test asserts the set. **But see F4**: two sibling ladders in the same composable still emit `corrupted`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | `blockDetail` on `RemoteBlocker`     | **YES.** `sync.ts:228-233`, optional + readonly. `PayloadLoadError` already answered it with a getter (`:335-341`) and `UnsupportedBeanpodVersionError` overrides (`:409-411`); a `readonly` property is satisfied by a getter and `vue-tsc` passes clean. `PodLineageError` declares none, so it reads `undefined` and both consumers' `...(x.blockDetail ? … : {})` spreads omit `detail` — behaviour identical to before at `syncService.ts:159` and `:2127`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | Copy and docs                        | **Copy YES, STATUS YES, CHANGELOG NO.** Both rewritten sentences are true of the code (traced above). STATUS's contradictions are resolved. The CHANGELOG still carries two gate sentences — F3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10  | The removed test                     | **Claim half right.** The minting argument is structurally sound; the "this test covers it" claim is wrong (the sibling never runs the fallback) but harmless, because `rebase.test.ts:219-236` does. The specific thing the comment argues — that the fallback cannot mint — is the one assertion nobody makes, and a mutant that mints only on the fallback survives. See F5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

## Mutations run (all restored; `git status` clean)

| Mutation                                                           | File:line                 | Result                                                                 |
| ------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `installWholesale = act === 'adopt'` (drop the rebase arm)         | `applyAndProject.ts:942`  | **CAUGHT** — `rebase.test.ts:235`, `expected 'merged' to be 'adopted'` |
| `stampNewGeneration` also true for `act === 'rebase' && user-file` | `applyAndProject.ts:861`  | **SURVIVED** — 15 files / 222 tests green                              |
| drop `rebaseUnavailable: true` from the adopted return             | `applyAndProject.ts:1009` | **SURVIVED** — 38 files / 510 tests green                              |
| move `noteWrittenVersion` back before the write                    | `syncService.ts:1881`     | **CAUGHT** — `savePathVersion.test.ts:264`                             |
| `seqDetail = lineage?.seq ?? 'none'`                               | `syncService.ts:1856`     | **CAUGHT** — `savePathVersion.test.ts`                                 |
| drop `lastVersionDetail = null` from `reset()`                     | `syncService.ts:913`      | **CAUGHT** — `savePathVersion.test.ts`                                 |
| drop `cancelled: true` from the FSA abort arm                      | `syncService.ts:2167`     | **CAUGHT** — `openFileVersion.test.ts`                                 |
| drop the `fileVersion` clamp                                       | `sync.ts:397`             | **SURVIVED** — 29 files / 408 tests green                              |

Plus one probe spec (added, run, deleted) proving F1.

The commit's own claim — "four new mutants caught: collapsing the seq, moving
the emit, dropping the reset, dropping `cancelled`" — is accurate. All four are
caught. The gaps are the ones it did not claim.

---

## Gate (run on `main` at `c4f0c88b`, clean tree)

| Command                                     | Result                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | **exit 0**, 0 errors                                                                                                                                            |
| `npx eslint .`                              | **exit 0** — 762 problems, **0 errors**, 762 warnings (all pre-existing `no-explicit-any` / `security/detect-object-injection` / `no-console` in e2e + scripts) |
| `npx vitest run`                            | **exit 0** — 551 files passed, 2 skipped (553); **6549 tests passed**, 2 skipped, 18 todo (6569); 138.02s                                                       |

---

## Things the fixes broke that no test covers

1. **F2** — the post-ack deref of `currentEnvelope`. No test exercises a
   `reset()` concurrent with an in-flight write.
2. **F4** — the two spellings of `corrupted`/`corrupt` on one telemetry surface.
   `errorCode` is an untyped `string`, so nothing can catch this at the gate.
3. **F1** — the fallback branch of the picker has no test at all, in either
   direction (before or after the fix).
