# R3 — Copy, i18n, the UI, the tests, the documents

> Range: `1f2e5d8b..6baba006` (10 commits)
> Reviewer scope: user-facing copy and i18n, the notice/confirm/toast, the deleted gate,
> `SettingsPage` + `ConfirmModal`, whether the tests pin what they claim, and the documents.
> Method: every claim below was read in the tree at `6baba006`. Mutation experiments were run
> and the tree restored (`git status` clean at the end of the review).

## VERDICT: SHIP WITH FIXES

The mechanism is sound and the tests that matter are honest — three separate mutation
experiments confirmed the load-bearing pins fail on the regression they name, and
`npm run type-check` confirms the `satisfies` guard is a real compile error. Nothing here
is a correctness bug in the shipped feature.

What needs fixing before this reaches a user is **truth**: three shipped sentences and two
documents describe behaviour the code does not have, and the two most-read status documents
(`CHANGELOG.md`, `docs/STATUS.md`) still assert the deleted soak gate as live, immediately
beside the entry that deletes it. All of it is copy and prose; none of it needs a code change
beyond one string and one arm.

---

## Findings, most severe first

### F1 — HIGH (copy is false). "shows a message" is a promise to people who will not see one

`src/services/translation/uiStrings.ts:4307-4311` (`compaction.why.devices`, rendered in the
Settings "?" popover at `src/pages/SettingsPage.vue:2007`):

> "A device still on an older version of beanies shows a message and syncs again once it updates."

The people this sentence is about are exactly those named by
`membersOnOlderVersions` — members whose `lineageEpoch < REQUIRED_EPOCH`
(`src/services/pod/podSoak.ts:84`), i.e. last seen on a build that predates the lineage guard.
I read the deployed build: `git show c3a6be98:src/services/sync/fileSync.ts` throws a bare
`new Error(\`Unsupported beanpod version: ${obj.version}. Expected 4.0.\`)`and has no`podNewerVersion` key at all. It cannot show this message. The plan says so itself, twice:

- Caveats: "**The person on the stale build gets no message.** The deployed poll swallows the
  parse error and shows stale data under 'Could not refresh'. … Do not add a mechanism that
  pretends to reach them." (`docs/plans/2026-09-06-compacted-pod-v5.md`, Important Notes)
- STATUS, the new entry: "The person on the stale build gets no message; the family tells them."
  (`docs/STATUS.md:73`)

**Consequence:** the owner reads that the straggler will be told, so does not chase them. The
straggler sees stale data under a generic refresh failure, keeps working, and (per the plan's own
F2) can overwrite the pod on any save from a warm cache. This is the one hazard the notice exists
to get a human to close, and the copy talks the owner out of closing it.

**Fix:** say what actually happens — the device stops syncing until beanies is updated on it, and
the person will not necessarily be told why. One string.

VERIFIED (deployed build read at `c3a6be98`; current strings read at `uiStrings.ts:4307`).

---

### F2 — HIGH (doc is false). The Help Center article states data loss the rebase exists to prevent

`src/content/help/how-it-works.ts:56-61`, the `infoBox`:

> **"Anything added on an older version before it updates is not kept."**
> "If someone keeps using an out-of-date device after the family file was compacted, what they
> add on it cannot be brought across once it updates."

That is not what the code does. When the stale device updates, its document is on the old
lineage and the remote is compacted, so `compareLineage` returns `adopt-remote`
(`src/services/sync/podLineage.ts:135`) and `POLICY['adopt-remote'].dirty` is **`'rebase'`**
(`podLineage.ts:176`). `rebaseOntoRemote` then replays exactly those post-baseline changes onto
the compacted document (`src/services/automerge/worker/applyAndProject.ts:886-916`,
`src/services/automerge/worker/docOps.ts:730-855`). Stage 3 was built for this case, and
`CHANGELOG.md:33` advertises it: "A device that was offline while the family file was compacted
no longer has to give up its work."

When the rebase genuinely cannot run (no usable baseline), the fallback is the **block**, not
loss: `throw lineageBlockError('adopt-remote', { rebaseUnavailable: true })`
(`applyAndProject.ts:938`), which raises the lineage banner and the device keeps everything
until a human decides. So the sentence is false on both branches.

This claim also appears in **no** in-app register — the shipped `compaction.olderVersion.notice`,
`compaction.why.devices` and `compaction.doneOlderVersion` say nothing about loss. So the article
does not "agree with the four in-app registers"; it goes beyond them with a claim the code
contradicts.

**Consequence:** a family member reads the Help Center, believes their offline work is gone, and
re-enters it (duplicates) or abandons the device. The owner reads it and delays compacting on a
false premise.

**Fix:** delete or invert the infoBox. If a caution is wanted, the true one is narrower: work done
on a stale device may be **overwritten on the shared file** by the fleet's `ours-newer →
publish-local` self-heal until that device updates; the device's own copy is replayed or the
person is asked.

VERIFIED.

---

### F3 — MEDIUM-HIGH (docs contradict the shipped code, in the two files read first)

**`docs/STATUS.md`.** R7.2 of the plan asked for the Tier 3 entry to be _updated_ and the "OWED"
list _rewritten_. Instead a new entry was appended at `:66-73` and the old one left standing
untouched at `:55-64`, with no superseded marker. It still asserts, as current status:

- `:63` "⏳ **OWED before the flag can be flipped:** the whole fleet on a guard-honouring build,
  **verified device-by-device by hand** (the soak gate is per-MEMBER…)" — the new entry at `:71`
  says the drain "is no longer a safety gate".
- `:64` "(a) **An un-updated device still defeats the guard, and nothing in code can change
  that.** … every guarded device computes `same` and merges the corruption silently" — flatly
  contradicted by `:68` ("the catastrophic case … is gone by construction").
- `:64` "(c) A family with a genuinely un-upgradable device can be refused forever with no
  override" — there is no refusal any more.
- `:62` "Stage 4 — … **a gate that refuses to compact while a device is behind**. `podSoak.ts` is
  a pure gate … read once before the confirm to fail fast and again after the pull as the
  authoritative reading." — both readings are deleted (`src/composables/usePodCompaction.ts:110-120`).
- `:55` "The whole fleet must be on a guard-honouring build BEFORE `podCompaction` is flipped."

`docs/STATUS.md` is the file `CLAUDE.md` instructs every session to read before starting work.
A future session reads "nothing in code can change that" as live.

**`CHANGELOG.md`.** All of this is in the **same unreleased `## 2026-09-06` section**, so a user
would read both halves in one release note:

- `:21` Added: "**beanies will not compact while someone in your family is on an older version.**
  It waits until every device that has been used recently has seen a version that can handle a
  compacted file, and names who it is waiting for." — three lines below `:15`, which says beanies
  "no longer asks you to find every device your family has ever used before compacting".
- `:22` Added: "…or which person's device is still to catch up. Never a bare 'done'." — the toast
  no longer says a device is "to catch up".
- `:43` Fixed: "**Settings now says who beanies is waiting on before you press anything** … You no
  longer have to attempt the compaction to find out it will not run" — it always runs now.
- `:44` Fixed: "**The message about waiting for a family member said 'someone in your family'…**"
  — describes `compaction.refused.not-soaked`, a key deleted in this range.

**Fix:** rewrite the old STATUS entry (or mark it SUPERSEDED and move the falsified bullets into
the new entry's history), and collapse the four stale CHANGELOG bullets — they describe work that
shipped to `main` and was removed again before any release.

VERIFIED.

---

### F4 — MEDIUM (informed consent). The confirm no longer says what happens to the people it names

The confirm's detail is `olderVersionNotice` — "{list} last opened beanies on an older version.
Ask them to update beanies before you compact." (`uiStrings.ts:4431`, passed at
`src/composables/usePodCompaction.ts:126`). That is the _entire_ consequence copy on the consent
surface. `compaction.confirmMessage` (`uiStrings.ts:4334`) now says only "…your other devices
switch over on their own", with no exception.

The plan's R6.5/R6.7 draft for this exact sentence carried the consequence ("…a device that is
still on an older version shows a message and stops syncing until it updates, and anything added
on it before then is not kept"). The shortening rounds removed it from the notice **and** the
confirm; it survives only behind the "?" badge, in the sentence F1 shows is false, and in the
completion toast, which fires after the one-way migration is done.

This is a judgement call the user drove ("shorter"), so it is not a defect to reverse
unilaterally — but the surface that takes consent for a one-way, family-wide migration now names
people without saying why it matters, and the one place that does say is wrong. Flagging for
greg's call.

VERIFIED.

---

### F5 — MEDIUM (copy over-claims). "your other devices switch over on their own" ignores the block

`compaction.confirmMessage` (`uiStrings.ts:4334`) and `compaction.why.devices`
(`uiStrings.ts:4308`) both promise unconditional automatic switchover. The block path is still
live: when `rebaseOntoRemote` returns null on an ordinary poll, `applyAndProject.ts:938` throws
`lineageBlockError('adopt-remote')`, the peer raises the lineage banner
(`podLineage.bannerTitle`, `uiStrings.ts:4476`) and a human must press "Export my changes" or
"Use the family file".

The _previous_ `compaction.confirmMessage` covered this ("If a device's changes cannot be carried
across at all, that device is told and keeps all of them until someone decides"). That sentence
was deleted in `de47dd14` and nothing replaced it.

Note this is the mirror image of the defect the previous review round found (a confirm promising
conflict behaviour the merge did not deliver). The conflict sentence was correctly removed —
`threeWayFields` does keep the target's value on an unmergeable field (`docOps.ts:944-948`,
`docOps.ts:970`), so the old sentence was in fact true, but it described a rare mechanism and its
removal is fine. The problem is that the _block_ sentence went with it while the block did not.

**Consequence:** the owner is told the migration is silent for everyone; a family member gets a
persistent orange banner asking them to choose.

VERIFIED.

---

### F6 — MEDIUM (raw developer English reaches the user, in an i18n-enforced app)

`src/pages/SettingsPage.vue:539`:

```
importError.value = syncStore.error || t('settings.importFailed');
```

`syncStore.error` mirrors `syncService.getState().lastError`, which for a non-beanpod file is the
developer string from `parseBeanpodV4` — `openFileVersion.test.ts:110` asserts exactly
`expect(syncStore… lastError).toMatch(/Invalid JSON/)`. So picking a non-`.beanpod` file in
Settings → Load another Family Data File renders untranslated English ("Invalid beanpod file:
Invalid JSON…") into a user-facing error slab.

The sibling handler added in the same commit disagrees with itself about this. Ten lines below,
`handleManualImport` (`SettingsPage.vue:645-651`) carries the comment "_The store's `error` is a
developer string for logs; the page renders a key_" and never renders it. Two arms, one commit,
opposite policies.

**Fix:** make `:539` `t('settings.importFailed')` unconditionally (the classified `payloadError`
arm above it already handles everything that has a real message).

VERIFIED.

---

### F7 — MEDIUM-LOW (copy dead-ends). "Enter its password to import it" — there is no password field

`SettingsPage.vue:647-651` renders `settings.importNeedsPassword`
("That file is encrypted. Enter its password to import it.", `uiStrings.ts:4391`) when
`manualImport` returns `needsPassword` (`src/stores/syncStore.ts:2876-2878`). Unlike
`handleLoadFromFileConfirmed` (`SettingsPage.vue:524-527`, which sets
`showDecryptFileModal.value = true`), `handleManualImport` opens no modal. The user is instructed
to do something the surface does not offer, and every real `.beanpod` is encrypted, so this is the
common outcome of that button.

Mitigating: `handleManualImport` lives in the `v-else` "Fallback for older browsers" branch
(`SettingsPage.vue:1901-1935`) — no File System Access API and no Drive — so it is rarely reached.
The dead end pre-existed (the old line rendered `result.error ?? 'Import failed'` → the developer
string "Encrypted file requires password"); this change promoted it into a translated
_instruction_, which reads as a promise.

**Fix:** either open the decrypt modal on this path too, or word the string as a statement
("That file is encrypted and cannot be imported here").

VERIFIED.

---

### F8 — MEDIUM-LOW (a euphemism survived on the surface that was de-euphemised)

`uiStrings.ts:4467`:

```ts
'settings.compactPod': { en: 'Compact Family File', beanie: 'compact pod' },
```

Every sibling on this surface was flattened in `b79790d6` — `settings.compactSection` →
"compact your family file", `compaction.confirmTitle` → "compact your family file?",
`compaction.done` → "your family file is compacted". The **primary button of the section** was
missed. In beanie mode the section header, the description, the confirm and the toast all say
"family file" and the button says "compact pod".

Adjacent, and arguably out of the user's stated scope: `podLineage.bannerTitle` /
`podLineage.bannerCta` / `podLineage.adoptedToast` (`uiStrings.ts:4476`, `:4483`, `:4492`) still
carry "beans" in their `beanie` values. That banner is the surface a _peer_ sees as a direct
result of a compaction, so it may be worth including; flagging rather than asserting.

**Checked and clean:** the de-euphemisation did **not** leak beyond this feature. Every hunk in
the `uiStrings.ts` diff is inside `4290-4470` (the compaction block), and a scan of `beanie`
values elsewhere (`recovery.kitPromptBody`, `googleDisconnect.*`, `storage.driveSyncsWithFamily`,
…) shows the bean/pod language intact. No global find-and-replace happened.

VERIFIED.

---

### F9 — MEDIUM-LOW (deleted-gate documentation left behind, in four places)

This is precisely the hazard R6.1 names ("deleting the gate leaves a module documented as one …
that is how the refusal gets re-added by the next person"). The module header was fixed; four
other homes were not:

1. **`src/pages/SettingsPage.vue:2036-2049`** — the comment above the caution slab still reads
   "_While the soak gate is unsatisfied the answer to 'why can't I' outranks the advice for when
   you can_" and "_nobody should have to attempt a one-way family-wide migration to discover they
   cannot do it yet_". Neither is true; there is nothing to be refused. Its last line —
   "_The notice describes the fallback, because that is the case a human has to act on_" — was
   true of the old `compaction.bringDevicesOnline`, which described the block; the shortened
   string (`uiStrings.ts:4313`) no longer mentions it.
2. **`src/services/pod/podSoak.ts:63`** — `formatNames`' comment: "_The refusal toast and the
   standing Settings notice render the same list_". There is no refusal toast.
3. **`src/composables/__tests__/usePodHealth.dueSignal.test.ts:82,87`** — the block comment and
   the `describe` title are still "_who the soak gate is waiting on_".
4. **`src/services/pod/__tests__/podSoak.test.ts:2,24`** — header "_The soak gate, as a pure
   table_" and a test titled "_REFUSES on an absent marker_" for a function that refuses nothing.

Also stale, from the same sweep: `src/stores/__tests__/syncStore.resume.test.ts:200` ("_keep
parseBeanpodV4 + detectFileVersion real-shape_" — `detectFileVersion` is deleted) and
`src/composables/__tests__/usePodCompaction.test.ts:25` ("_`evaluateSoak([])` passes_" — the
function no longer exists; this is the only surviving reference to the name anywhere in `src/`).

Pre-existing but worth a line while someone is in there: `SettingsPage.vue:1991-1993` says "_Red
belongs to the final confirm, which legitimately is destructive_", but the confirm is
`variant: 'info'` (`usePodCompaction.ts:124`), which paints Heritage Orange.

VERIFIED.

---

### F10 — LOW-MEDIUM (test titles claim more than the assertions)

Two cases, both in otherwise-honest suites:

1. **`src/services/sync/__tests__/savePathVersion.test.ts:127`** — "_writes 4.0 for a
   never-compacted family, **byte-for-byte as before**_" asserts only
   `JSON.parse(written).version === '4.0'`. There is no byte-identity fixture anywhere
   (`grep -rn "byte-identical\|byte-for-byte" src/**/__tests__` returns this line and nothing
   else), so the first acceptance criterion's "(fixture test)" is not met. The derivation itself
   is well pinned elsewhere, so the risk is low — the title is the problem.
2. **`src/composables/__tests__/usePodCompaction.test.ts:271-275`** — asserts
   `deliverPod` was called with `{ json: '{"version":"4.0"}', … }`, which is the mocked
   `buildExportEnvelope`'s own return value sitting two lines under a comment about 5.0. The
   assertion is a legitimate wiring check (the built envelope reaches `deliverPod`) and the
   comment says the version pin lives in `fileSync.test.ts` — but a literal `4.0` inside the
   backup test is exactly the shape that would read as a passing 4.0 assertion to the next person.

VERIFIED.

---

### F11 — LOW (the "gate is gone" pin only covers a gate that reads `usePodHealth`)

The replacement test asserts `docClient.compactDoc` **is** called with `hooks.behind = ['Sam']`
(`usePodCompaction.test.ts:456-464`). I mutated the source to re-add a gate
(`if (olderVersion.value.length) return refuse('not-owner')` at `usePodCompaction.ts:110`) and
**three tests failed** — so it does prove the gate is gone _for a gate reading `olderVersion`_.

The deleted gate did not read that. It read `evaluateSoak(useFamilyStore().members)`, and the
rewritten tests no longer populate `hooks.members` (the old ones set `hooks.members = stale`;
`beforeEach` now resets it to `[]`, `:151`). A gate re-added against the member projection
directly would pass this suite silently. A one-line addition (`hooks.members = stale` beside
`hooks.behind = ['Sam']` in the first test) would close it.

VERIFIED by mutation.

---

### F12 — LOW (the `satisfies` guard is real, but weaker than the plan asked for)

`usePodCompaction.test.ts:44-50` uses
`satisfies Record<keyof ReturnType<typeof usePodHealth>, unknown>`. I removed
`someoneCannotOpenIt` from the mock and ran `npm run type-check`:

```
src/composables/__tests__/usePodCompaction.test.ts(47,8): error TS1360:
  Property 'someoneCannotOpenIt' is missing … but required in type 'Record<…>'
```

So **a missing field is a compile error — VERIFIED.** The plan (Testing Plan §4) asked for
`ReturnType<typeof usePodHealth>` itself, which would also have checked the _value_ types;
`Record<K, unknown>` does not. `olderVersion: { value: hooks.behind }` is a plain object where the
real return is a `ComputedRef`, and a field that changed shape (say `olderVersionNames` becoming
`string[]`) would compile. Worth a note, not a blocker.

VERIFIED.

---

### F13 — LOW (grammar / pluralisation)

`compaction.doneOlderVersion` (`uiStrings.ts:4424`):

> "Done. {list} will need to update beanies before **it** syncs again."

`{list}` is `formatNames(olderVersion)` — people's names. "Sam, Alex will need to update beanies
before it syncs again" has no antecedent for "it". CLAUDE.md requires explicit `.one`/`.other`
pairs for pluralised copy; this key has neither and reads wrong at both counts. Sibling
`compaction.olderVersion.notice` handles it correctly with singular "them".

VERIFIED.

---

### F14 — LOW ("is filed as a follow-up" cannot be verified, and no GitHub issue exists)

`src/utils/payloadFailureSurface.ts:57-58` asserts the `unreadable` overlay copy "_is filed as a
follow-up_", with no tracker reference. `gh issue list --state all` shows nothing matching, and no
issue number appears in the code, the plan or `docs/STATUS.md` (which repeats the claim at `:73`).
The project's tracker is Notion, so it may exist there — but an unreferenced "is filed" is a claim
a reader cannot check, and R7.6 made filing it an explicit deliverable.

INFERRED (absence of a GitHub issue is VERIFIED; a Notion row was not checked).

---

### F15 — LOW (the "?" popover keys no longer describe their contents)

`compaction.why.settled` (`uiStrings.ts:4297`) now says what compaction _keeps_, and
`compaction.why.older` (`:4302`) now describes the _safety copy_. The "older phones" content moved
into `settings.compactSectionDesc`. The keys are stable identifiers, so renaming costs a
`npm run translate` pass — but two of four keys in this group now name the wrong thing, and the
next person editing the popover will reach for the wrong one.

VERIFIED.

---

### F16 — LOW (nothing pins the Settings notice rendering)

`SettingsPage.vue:2059-2061` renders `olderVersionNotice`, and `:2007` adds
`compaction.why.devices` as the fourth popover item. There is no `SettingsPage` test covering the
compaction section (`src/pages/__tests__/` has only `SettingsPage.deleteFamily.test.ts`), so the
one surface a person actually reads before consenting is unpinned. The confirm's detail _is_
pinned (`usePodCompaction.test.ts:466-475`). Noting the gap, not asking for a component test.

VERIFIED.

---

## Mutation experiments run (source restored; `git status` clean)

| Mutation                                                                                   | File                                                   | Result                                                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `reEncryptEnvelope` reads `envelope.version` instead of `beanpodVersionFor(lineage, opts)` | `src/services/sync/fileSync.ts:269`                    | **2 tests failed** in `savePathVersion.test.ts` (the Trap 1 pin and the kept-local round-trip). Pin is real. |
| Stamp on every `user-file` adopt (drop the `verdict === 'ours-newer'` clause)              | `src/services/automerge/worker/applyAndProject.ts:861` | **1 test failed** — "mints NOTHING when a human resolves a CONFLICT". Pin is real.                           |
| Stamp unconditionally at the install branch (`currentDoc = true ? …`)                      | `applyAndProject.ts:976`                               | **2 tests failed** — the CONFLICT case and "mints NOTHING on a first-load adopt". Pins are real.             |
| Re-add a soak gate reading `olderVersion`                                                  | `src/composables/usePodCompaction.ts:110`              | **3 tests failed** in `usePodCompaction.test.ts`. Pin is real (see F11 for its limit).                       |
| Remove one field from the `usePodHealth` mock                                              | `usePodCompaction.test.ts:47`                          | `npm run type-check` **errors TS1360**. The `satisfies` guard is real.                                       |

One thing the mutations also revealed: the third restore test, "_mints NOTHING when a user-file
choice takes a NEWER file over a stale local document_" (`rebase.test.ts:833-847`), **passed**
under the unconditional-install mutation. That means it never reaches the install branch — it
takes the successful `rebase` return at `applyAndProject.ts:892-916`. So the acceptance criterion
"_the `user-file` rebase **fallback** adopt mints no generation_" is **not** pinned; the test
covers the rebase, not the fallback. Its own comment hedges ("or its adopt fallback"), which is
honest, but the criterion should not be read as met.

---

## Acceptance criteria (the ones in R3's scope)

| #         | Criterion (abridged)                                                                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | Never-compacted family writes a byte-identical 4.0 envelope (**fixture test**), incl. `createNewFile`                                                                                                     | **PARTIAL** — `createNewFile` passes `lineage` (`syncStore.ts:2292-2299`) and `fileSync.test.ts:120-124` pins the derivation, but no byte-identity fixture exists; the test titled "byte-for-byte" asserts only `version` (F10)                                                                                                                                                                                                                                              |
| 17        | Ladder has no soak refusal; notice/confirm/toast name people, all three from `usePodHealth`; four deleted keys gone from `uiStrings.ts` **and** `zh.json`; `podSoak.ts` header no longer describes a gate | **MET** — mutation-checked; `grep` finds zero references to the four keys anywhere in `src/`, `public/`, `scripts/`; `zh.json` confirmed clean by direct parse; header rewritten (`podSoak.ts:1-24`). Residual gate prose elsewhere → F9                                                                                                                                                                                                                                     |
| 18        | No string names an app version for a member; no string asks anyone to open beanies on every device                                                                                                        | **MET** — VERIFIED. No `{version}` template exists; `grep` for "each device"/"every device"/"every bean they"/"open it once" across `uiStrings.ts` and `zh.json` returns only unrelated surfaces (recovery kit, Google disconnect, Plausible, Drive marketing)                                                                                                                                                                                                               |
| 19        | Every added/changed string has `en` **and** `beanie`; `npm run translate` parses cleanly                                                                                                                  | **MET** — `npm run translate` reports "Parsed 4554 strings … All 4554 up to date", no file modified. A full parse of `STRING_DEFS` finds only 4 entries lacking `beanie`, all pre-existing brand terms (`app.name`, `app.tagline`, `app.taglineAccent`, `onboarding.welcomeBrand`). Consistency of the flattening → F8                                                                                                                                                       |
| 22        | Help Center article added and **matches the shipped copy in all four registers**                                                                                                                          | **PARTIAL** — article exists at `src/content/help/how-it-works.ts:4-72`, `category: 'how-it-works'` is a valid `HelpCategory` (`types.ts:1-2`), every section conforms to `ArticleSection` (type-check clean), reachable via `ALL_ARTICLES` (`index.ts:19-26`), and the title/body agree with the four `*.newerVersion` strings. But its infoBox asserts data loss no register claims and the code contradicts → F2                                                          |
| 24        | Documents in R7 updated, **including the follow-up issue** for the `unreadable` overlay copy; CHANGELOG entry                                                                                             | **NOT MET** — ADR-036 addendum (`docs/adr/036…:126-181`), lessons 23-25 (`docs/lessons.md:974-994`, numbering continuous), `flagRegistry.ts:14-28` and the tier3 SUPERSEDED banner are all accurate and were spot-checked against the code. But STATUS was **appended to, not updated** (R7.2 asked for the old entry rewritten) and now contradicts itself, the CHANGELOG contradicts itself in the same unreleased section (F3), and no follow-up issue can be found (F14) |
| 25        | Full gate green; every new test mutation-checked                                                                                                                                                          | **MET (for what I ran)** — `npm run type-check` clean; `npx eslint` on the seven touched UI/composable/content files → 0 errors (3 pre-existing warnings); the seven compaction/version/rebase/soak suites → 104 passed. Five mutations confirm the load-bearing pins. Exception: the `user-file` rebase-fallback clause of criterion 15 is not actually pinned (above)                                                                                                      |
| 15 (part) | "…the `user-file` rebase fallback adopt mints no generation"                                                                                                                                              | **NOT PINNED** — `rebase.test.ts:833-847` exercises the successful rebase, never the fallback (proved by mutation)                                                                                                                                                                                                                                                                                                                                                           |
| —         | R6.3/R6.4: Settings renders `olderVersionNotice` **and** `compaction.olderVersion.rule`                                                                                                                   | **SUPERSEDED** — the `.rule` key was never added and the section renders only the notice (`SettingsPage.vue:2059`). Dropped by the two user-requested shortening rounds (`de47dd14`, `b79790d6`); recording it as a deliberate deviation, not a miss. Its content ("beanies can only see when each person last opened it, not every device they own") is now unsaid anywhere in the app                                                                                      |
| —         | R6.7: `compaction.why.conflict` as a fourth "?" item                                                                                                                                                      | **SUPERSEDED** — replaced by `compaction.why.devices`. The conflict sentence was dropped entirely; `threeWayFields` does behave as it described (`docOps.ts:944-948`), so nothing false was left behind by that removal                                                                                                                                                                                                                                                      |

Criteria 2-14, 16, 20, 21, 23 are R1/R2 scope and are not assessed here.

---

## Checked and CORRECT

**Copy truth (traced to code):**

- `compaction.why.record` / `.settled` (`uiStrings.ts:4292`, `:4297`) — `compactDoc` rebuilds from
  the current document value, so "keeps every account, transaction, task and memory. Only the
  record of past changes is removed" is true.
- `compaction.why.older` (`:4302`) — a copy is always made before compaction: the Drive sibling
  (`usePodCompaction.ts:252-352`, byte-compared on read-back) and/or the manual export, whose
  non-delivery refuses with `backup-not-delivered` (`:209`, `:220`). Minor personification
  ("beanies saves") for a manual-provider family, where the human saves it.
- `compaction.safetyCopyNote` / `…Manual` (`:4321`, `:4326`) — **the route is real and the "above"
  is literal.** "Load another Family Data File" is `settings.loadAnotherDataFile` rendered at
  `SettingsPage.vue:1795`, in the same Family Data drawer, above the compaction section at `:1993`.
  It reaches `handleLoadFromFileClick` → `handleDecryptFile` →
  `decryptPendingFile(password, { userChoseThisFile: true })` (`:551`), which is the `user-file`
  context R4's restore stamp keys on. The two-variant split is correct: `podKeepsSiblingCopy`
  (`:613-626`) is a genuine reactive read of `storageProviderType` + `getAuxStore(provider)`, so a
  local-file family is not promised a sibling copy it will not get.
- `compaction.olderVersion.notice` (`:4431`) — true and correctly singular/plural.
- `settings.compactSectionDesc` (`:4469`), `compaction.dueBecauseLarge` / `…Failed` (`:4412`,
  `:4416`) — all true of `DUE_BYTES` / `anyDeviceReportedTooLarge`.
- The four `*.newerVersion` registers (`podNewerVersion.inline`, `resumeSetup.podNewerVersion`,
  `podAccess.error.newerVersion`, `join.error.newerVersion`) are one sentence in four registers,
  none asks for a password, none suggests deleting data, and `join.*` correctly adds "then open
  your invite link again".

**i18n:**

- `zh.json` in sync: `npm run translate` → "All 4554 translations up to date", **no tracked file
  modified**. All four deleted keys are absent from `translations`; all nine new keys present with
  `hash` + `lastUpdated: 2026-09-06`; `podNewerVersion.inline` and `resumeSetup.podNewerVersion`
  correctly share hash `bbzle2` (identical source).
- No de-euphemisation leak: every `uiStrings.ts` hunk is inside the compaction block.

**The UI:**

- `ConfirmModal.vue:38-53` — the caution branch has a dark partner for **every** painted surface
  (`dark:bg-accent-lift/10`, `dark:border-accent-lift/40`), the accent used as an icon has its
  lift (`text-primary-500 dark:text-accent-lift`), the readable text has one
  (`text-orange-900 dark:text-ink-soft`), the only opacity modifiers are on background and border,
  and no raw `dark:` grey ramp is introduced. Heritage Orange, not Alert Red, per the CIG.
  `BeanieIcon` is imported (`:3`) and `exclamation-circle` exists (`src/constants/icons.ts:252`).
  It is a byte-for-byte match for the Settings slab at `SettingsPage.vue:2050-2057`, which is the
  stated point.
- **`detail` absent** → neither branch renders (`v-if` requires `state.detail`), even though
  `usePodCompaction.ts:128` passes `detailTone: 'caution'` unconditionally. Correct.
- **`detailTone` absent** → falls to the unchanged `v-else-if` caption. Correct.
- **The other four `confirm()` callers that pass `detail`** — `RecipeFormModal.vue:512`,
  `MealPlannerPage.vue:193`, `FamilyPlannerPage.vue:285` and `:655` — pass no `detailTone` and are
  behaviourally unchanged. No state leak between dialogs: `confirm()` assigns `detailTone`
  explicitly on every call (`useConfirm.ts:63`), so a later dialog cannot inherit the caution slab.
- `ConfirmOptions` gaining `detailTone?: 'caution'` (`useConfirm.ts:11-16`) is done cleanly — a
  literal union rather than a boolean, documented at the type, threaded through `ConfirmState`
  (`:30`), the initial state (`:47`) and the assignment (`:63`), with no other call site touched.
  A departure from R6.5's "Do not widen `ConfirmOptions`", made at the user's request; as
  executed it is the right shape.
- The four-item popover renders fine (`InfoHintBadge` takes `items: string[]`); the DUE note keeps
  its Sky Silk / `ink-soft` hierarchy; the one-slab-never-two structure is preserved.
- `npx eslint` on the seven touched files: 0 errors.

**Tests:**

- `savePathVersion.test.ts` and `openFileVersion.test.ts` **genuinely do not mock**
  `@/services/sync/fileSync` — VERIFIED by grep, and by mutating the real `reEncryptEnvelope` and
  watching them fail. They exercise the real derivation end to end (the save path writes through a
  fake provider and the written JSON is parsed back).
- **All 17 `vi.mock('@/services/sync/fileSync')` sites keep `beanpodVersionFor` real.** Fourteen
  name it explicitly via `(await importOriginal<…>()).beanpodVersionFor`; the other three
  (`createNewFile.test.ts:209`, `syncStore.resume.test.ts:202`,
  `payloadErrorPropagation.test.ts:79`) spread `...actual`. **None returns a constant** — a grep
  for every `beanpodVersionFor` reference in `src/` finds no stub anywhere.
- The four "mints NOTHING" restore tests genuinely distinguish minting from not minting: each
  asserts the _exact_ post-merge lineage (`{id:'L-1',seq:1}`, `{id:'L-theirs',seq:1}`,
  `toBeUndefined()`), and a mint would change both id and seq. Two of the three mutations above
  failed on them.
- `usePodCompaction.test.ts`'s replacement suite would fail if a gate came back (mutation-checked)
  and its `t` stub returns a real `{list}` template for `compaction.doneOlderVersion`, so the
  naming test cannot pass with `fillTemplate` removed — the anti-vacuity trick the old suite used
  is preserved.
- `connectStorage.test.ts:243-275` is a real rewrite: it feeds `mockProbeRead` genuine 4.0/5.0/6.0
  envelope text with no `fileSync` behaviour mocked, and covers `''`, `'  \n'`, `'{}'` and `null`.
  No mock-value assertion.
- `podAccess.test.ts:121-126` now asserts `ALL_CODES` against `Object.keys(POD_ACCESS_ERRORS)` and
  `POD_ACCESS_SEVERITY`, which makes lesson 25's claim true of the shipped code.
- `fileSync.test.ts:81-145` pins the derivation in both directions (a compacted document written
  from a 4.0 envelope → 5.0; a lineage-less document written from a **5.0** envelope → 4.0, the
  restore direction), plus both `compactionBackup` cases and `createBeanpodV4`.

**Documents that are correct:**

- ADR-036 addendum (`docs/adr/036-pod-lineage-lives-in-the-document.md:126-181`) — every claim
  checked against code: `beanpodVersionFor` is the one chooser and both writers call it
  (`fileSync.ts:85`, `:269`); `envelopeMerge.ts:73` is the spread it names; `guardLineage` returns
  `{ action, verdict }` (`podLineage.ts:202-211`) with exactly one production caller
  (`applyAndProject.ts:846`); and its three "never" clauses (first-load, resolved conflict, rebase
  fallback) are all true of `stampNewGeneration = act === 'adopt' && verdict === 'ours-newer' &&
lineageCtx === 'user-file'` (`applyAndProject.ts:861`) — two of the three are mutation-pinned.
- `docs/lessons.md:974-994` — entries 23/24/25, numbering continuous from 22, and 25's claim
  matches the shipped `podAccess.test.ts`.
- `src/config/flagRegistry.ts:14-28` — the rewritten comment states the gate correctly (drain
  decides how many people the notice names, not whether data is safe) and keeps the
  `localStorage`-override warning.
- `docs/plans/2026-09-06-pod-compaction-tier3.md:3-7` — SUPERSEDED-IN-PART banner is accurate and
  correctly scoped to Stage 4's gate.
- The new STATUS entry itself (`docs/STATUS.md:66-73`) is accurate; the problem is the old one
  left beside it.

---

## Suggested fix list, in order

1. Rewrite `compaction.why.devices` so it does not promise a message the older build cannot show (F1).
2. Delete or invert the Help article's "not kept" infoBox (F2).
3. Reconcile `docs/STATUS.md` and `CHANGELOG.md` with the shipped behaviour (F3).
4. `SettingsPage.vue:539` → `t('settings.importFailed')`, dropping the raw `syncStore.error` (F6).
5. `settings.compactPod` beanie value → "compact your family file" (F8).
6. Sweep the four stale soak-gate comments and the two stale test titles (F9).
7. greg's call: whether the confirm should say what happens to the people it names (F4), and
   whether "switch over on their own" needs its block-path exception back (F5).
8. Housekeeping: `compaction.doneOlderVersion` pronoun (F13); `hooks.members` in the gate-gone
   test (F11); a test for the `user-file` rebase **fallback** mint; `settings.importNeedsPassword`
   dead end (F7); confirm the `unreadable` follow-up is really filed and reference it (F14).
