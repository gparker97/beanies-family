# Investigation: compaction fallout, 2026-09-08

> Date: 2026-09-08
> Status: IN PROGRESS
> Trigger: greg ran a real compaction across all his devices this morning (browser on 0.17,
> some native apps on 0.17, some deliberately left on 0.16) and reported nine distinct
> observations. This file is the resumable context: if usage runs out, restart from here.

## Scope decisions (greg, 2026-09-08)

- **Fix policy:** investigate all nine; implement only the low-risk, clearly-correct fixes
  (euphemism sweep, retry button, doc/CIG/skill updates). Anything touching sync, compaction
  lineage, or Google auth gets a written finding plus a proposed fix for approval, NOT a commit.
- **Priority if usage runs out:** Google auth (item 6) first.

## Environment of the report

- Compaction performed from the **desktop browser on 0.17**.
- Family data file went from **4MB+ to ~350KB**. Compaction itself SUCCEEDED and the file
  opens and views fine afterwards.
- Mary's phone was deliberately left on **0.16** during compaction, then upgraded after.
- Older **Android tablet (Samsung A7)** in the mix.
- Sister was invited to the pod 1 to 2 days ago.
- Registry row "Parker Meng Beanies" was rewritten at 02:07 UTC 2026-09-08 (seen in the
  morning metrics run): `createdAt` reset to today from August, `beanpodSizeKb` 4559 -> 373,
  `country` SG -> null, `ownerEmail` -> joymaryministerio@gmail.com. CloudWatch still shows
  the same ~195k events on that family id, so the pod is alive; the registry metadata changed.

---

## The nine items

### 1. Compaction falsely blocked by "ongoing changes being saved"

Greg was refused compaction several times with a message about changes still being saved to
the file, even though everything appeared saved and the sidebar saved-dot was green.
Eventually it went through.

**Asks:** (a) is the validation check implemented correctly and accurately? (b) add a retry
button so the user can re-check rather than being stuck.

**Prior suspicion (from docs/STATUS.md, 2026-09-07 code review of the compaction session):**
`offlineQueue.ts:175` — the queue became a "device has unsaved work" flag but only
`flushQueue` clears it, so `hasPendingSave()` may stay true forever after an ordinary save.
That is the most likely root cause and must be confirmed or eliminated first.

### 2. "not enough memory to sync" toast on the older Android tablet

On the A7, after adding two chore lists on desktop and waiting ~5 min with no sync, greg hit
the manual refresh in the dropdown and got an ephemeral toast roughly:
"this bean does not have enough memory to sync your beans/data but you can continue using..."
A few seconds later the lists DID sync and the tablet has been fine since.

**Asks:** what triggers that message? Is the trigger configured correctly and accurately?
Was this a legitimate memory condition or an inadvertent warning? After compacting to <500KB,
can genuine memory issues still exist?

(Also flagged: "bean" euphemism on an important message. See item 8.)

### 3. Family owner appears to have changed to mary. NOT expected. Possibly destructive.

Registry `ownerEmail` now reads joymaryministerio@gmail.com. Greg never initiated an
ownership transfer. He compacted from his own desktop under his own account. He updated the
app on mary's phone and confirmed it could open the new file, nothing more.

**Counter-evidence:** on greg's 0.17 app he still sees himself as "pod owner" in the family
member list, and he still sees the pod compaction option in Settings, both of which suggest
he IS still the owner.

**Asks:** did the owner actually change, or is the REGISTRY attribution wrong? What writes
`ownerEmail` on that registry row, and under what identity?

### 4. A todo created on 0.16 after compaction vanished when that device upgraded to 0.17

Sequence: compaction done from 0.17 browser -> mary's phone still on 0.16 -> greg created a
test todo from her 0.16 app -> then upgraded her app to 0.17 -> app opened and connected to
the new compacted file -> the todo disappeared on the first sync, roughly 10 to 20s later.

**Asks:** is this expected? Should data created before the upgrade but after compaction be
kept and synced? Note: the 0.17-on-both-sides case was tested and worked; the mixed
0.16/0.17 case was NOT tested.

**Relevant memory:** project_compaction_merge_hazard — a compacted pod merged into a peer on
old history destroys that peer's unsynced edits roughly half the time.

### 5. Constant Google grant revocations and forced re-consent (PRIORITY)

Since the fixes of the past few days, greg is getting Drive and Calendar disconnection toasts
and forced Google consent every few hours, sometimes more often. It tends to happen after a
hard refresh or any compaction-type activity. Grants seem to be lost across devices.

**Asks:** what broke, and when? Prior art to read first:
`docs/investigations/2026-08-13-google-token-churn-audit.md`.

### 6. Beanie euphemisms on important surfaces

Live example, the orange banner on greg's desktop:
"some beans on this device are waiting / your family file was reorganised on another bean,
and this one still has beans that were never saved to it. nothing has been lost. export them
first if you want to keep them, then choose use the family file."

"bean" is standing in for BOTH device and data in one sentence, which destroys the meaning.

**Asks:** (a) sweep for ANY other important surface where a bean euphemism obscures meaning
(bean for device, bean for data, etc); (b) fix the existing beanie-mode strings; (c) codify
the rule in the project instructions, the CIG, and the beanies-theme skill so it holds going
forward.

### 7. Native app cannot restore a family data file from Google Drive

In the native app, Settings -> Family Data -> "load another family data file" offers only
"Load file" (local file picker). Browser and PWA offer both Google Drive and local file.

**Ask:** is this expected? Why can the native app not restore from Drive?

### 8. "Signed in with" showed his SISTER's gmail account

On the desktop, alongside the orange banner, Settings -> Family Data showed
"Pod lineage blocked: the remote pod has been compacted and this device has unsaved changes"
AND showed the signed-in user under "Signed in with" as another family member's gmail
account, specifically his sister's. Greg never signed in as her. He had invited her to the
pod 1 to 2 days earlier.

**Ask:** thorough investigation. This is an identity-display bug at minimum and possibly an
identity-resolution bug. Likely related to item 3.

### 9. The bad state cleared on hard refresh, but transiently

After a hard refresh the orange banner disappeared, "Signed in with" corrected itself to
greg's own email, and the Google reconnection toast stopped, with NO reconnection performed.
Greg notes this is not always the case; sometimes a reconnect toast persists after refresh.

**Ask:** these look transient, but they are very confusing to users, especially right after
compaction. Establish whether the underlying state was wrong or only the display, and make
the surface honest.

---

## Findings

(to be filled in as each thread reports)

### Item 5 — Google auth (PRIORITY). COMPLETE, awaiting greg's approval to fix.

**Root cause 1 (primary): whole-grant revoke on every Drive reconnect, ping-ponging across
devices.** `googleRevoke.ts:33,96` POSTs to Google's revoke endpoint, which (proven in the
08-13 audit, `googleRevoke.ts:10-19`) kills EVERY token for the (user, client_id) pair, and
Drive + Calendar share one client_id. That revoke fires on every forced consent: popup
`googleAuth.ts:1017-1023`, redirect `:2103-2113`, and redirect auth ALWAYS forces
`prompt=consent` (`:2074-2077`). Calendar got a shared-grant guard
(`calendarSyncStore.ts:951-989`); Drive got none. The comment at `googleAuth.ts:2106-2108`
("a Drive reconnect never disturbs a live calendar grant") is false. Since #62 all of one
account's devices converge on ONE mirrored refresh token per family
(`driveTokenRecovery.ts`), so one revoke kills N devices: A fails silent refresh -> banner ->
greg re-consents on A -> revoke kills B, C and the calendar token -> B banners -> greg
re-consents on B -> kills A. Both toasts, every few hours, every device.
_Fix:_ drop the two `trigger: 'reconnect'` revokes (keep revoke only for
`disconnectGoogleEverywhere` `:1641` and a genuine departed-account teardown), and stop
forcing `prompt=consent` on reconnect (try `select_account`/`prompt=none`, escalate only when
no refresh token returns).

**Root cause 2 (why it started last week): the lineage guard cut the token-healing channel.**
Auth code is unchanged since 08-28 (last lifecycle commits `5225e48b`/`de1dc0cc`/`618cce05`,
08-13/14). What changed: `067938b2` (09-05, lineage guard on every merge path), `3891c4ee`
(09-05, refuse a save after a merge refuses), `142d25a8` (09-07, compaction on). A
lineage-blocked device cannot merge remote, so never receives the freshly mirrored token, is
forced to consent, which fires cause 1. Hard refresh + compaction is exactly when lineage
blocks fire, matching greg's report. _Fix:_ on permanent failure, read `driveConnections`
from the remote envelope (read-only fetch, no merge) before prompting.

**Root cause 3: transient failures escalate to "permanent" after 2 exhausted silent-refresh
runs** (`SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD = 2`, `googleAuth.ts:338`, `:1395-1421`),
counter persisted in sessionStorage, and `network`/`timeout`/`unknown` all count. Each false
permanent costs a consent = a whole-grant revoke. _Fix:_ escalate only on a classified
`permanent` or 4xx; never on network/timeout/unknown.

**Root cause 4 (feeds items 3 + 8): wrong-member token adoption.** `reconcileDriveTokenForMember`
keys the doc token on `currentMember.googleAccountEmail` (`syncStore.ts:2234-2237`), and
`37c23b1d` (09-07) now `preselectSessionMember`s before the roster loads. If the bound member
is wrong the device adopts the SISTER's mirrored token, userinfo verifies as her, and
`healAccountBindingIfNeeded` (`syncStore.ts:5412-5470`, `action: changed` only) then writes
her email into greg's provider binding and `member.googleAccountEmail` = "Signed in with:
sister". A hard refresh re-runs `reconcileDriveTokenWithDoc` (`syncStore.ts:1475-1477`) and
adopts whichever token is newest, which is why it self-corrected. _Fix:_ the heal must refuse
to bind a `verifiedEmail` another roster member already owns; `readDriveTokenFromDoc` must
require the entry's email to match the provider's bound account.
**ACTION: check greg's roster row `googleAccountEmail` for the sister's address.**

**Root cause 5 (minor):** untrusted/clear sign-outs drop tokens + the doc mirror
(`authStore.ts:2400-2408, 2151-2162`), so the next open is a forced consent = revoke.

**Not the cause:** compaction (`compactDoc` `applyAndProject.ts:1392-1430` round-trips the doc
and throws on any JSON diff, so `driveConnections` survive), lineage adopt, IndexedDB cache
clear (tokens live in `beanies-file-handles` + `beanies_grt_` localStorage), the heal.

**Toast raisers** (not only `invalid_grant`): `syncStore.ts:5582-5590`/`5537-5560` on
permanent-failure callback (real `invalid_grant` at `googleAuth.ts:1381` OR threshold-2
escalation at `:1420`); cold-start `syncStore.ts:3480-3491`; calendar
`calendarSyncStore.ts:699-707` writes `needs_reconnect` INTO THE SHARED DOC so every device
of every member shows it.

**CloudWatch (log group `/aws/lambda/beanies-family-telemetry-prod`, context keys flattened):**

```
fields @timestamp, family_id, surface, action, token_op, token_outcome, token_trigger
| filter surface in ["google-token-lifecycle","unified-reconnect","account-switch-reset","account-binding-heal","google-self-recovery"]
| stats count() by bin(1h), surface, action, token_op, token_trigger, token_outcome
```

Ping-pong signature: `token_op="revoke" and token_trigger="reconnect" and token_outcome="ok"`
on one device followed within minutes by `token_op="recovery" and token_outcome="failed"` on
another device of the same `family_id`. Heal signal: `action="changed"` only.

### Item 1 — compaction `not-synced` gate. COMPLETE.

**The STATUS.md suspicion was wrong: `offlineQueue.hasPendingSave()` is never called** (only
its definition at `offlineQueue.ts:112`). Nothing in the gate reads it.

**Predicate** (`usePodCompaction.ts:211-220`): refuses `not-synced` if
`loadFromFile({merge:true})` fails, or `syncNow(false)` returns false, or
`syncService.isFullySynced()` is false afterwards. `isFullySynced` (`syncService.ts:1081-1085`)
= remote unchanged AND worker heads byte-equal to the fingerprint of what Drive holds.

**Root cause, deterministic:** `syncStore.syncNow` (`syncStore.ts:974-994`) calls
`syncService.save()` (commits the baseline as the exported heads, `syncService.ts:1975-1981`)
and THEN writes `settingsRepo.saveSettings({ lastSyncTimestamp })` at `:987-991`, which is an
Automerge change (`settingsRepository.ts:80`). Heads advance past the baseline just
committed; the next line of the gate, `isFullySynced()` at `usePodCompaction.ts:219`, reads
`dirty` and refuses. Fires whenever step 2c enters the `syncNow` branch (any unflushed edit,
a `migrateDoc` delta, the `deduplicateRecurringTransactions` sweep at `syncStore.ts:1771`,
`envelopeGainedLocalKeys`). The mutation also arms the 2000ms debounced save, which goes
through `syncService.save()` with no settings write after it, so the device levels a couple
of seconds later = "eventually it went through".
**Second false-refusal path:** `remoteChanged()` returning `status:'unknown'` on a transient
probe error (`syncService.ts:999-1034`) refuses with copy claiming changes have not reached
the cloud, which is untrue.

**Sidebar dot disagrees by construction:** `SaveStatusIndicator.vue:42` reads
`syncStore.saveStatus` (`syncStore.ts:623-629`) = "a save completed and the failure streak is
under 2". It knows nothing about heads. The refusal COPY is what misleads.

**Proposed fix:** (b, minimal) in step 2c call `syncService.save()`/`saveNow()`
(`syncService.ts:2384`) instead of `syncStore.syncNow(false)`, then
`await syncService.flushPendingSave()` before the final `isFullySynced()`. (a, structural)
stop writing `lastSyncTimestamp` into the CRDT at all; it is derived state (`lastSync` ref
already carries it). Add a `cannot-verify` refusal code for `status:'unknown'` with honest copy.
**Retry button:** `CompactionProgressModal.vue:249-258`, only button is Done at `:256`. Add a
"Check again" `BaseButton` when the failure is `not-synced`, emitting `retry`; Settings wires
it to `compact()` (the `busy` guard at `usePodCompaction.ts:147` makes a double-press safe).

### Item 2 — memory toast. COMPLETE.

**Copy:** `BackgroundSyncBar.vue:47-51` toasts title `sync.podUnopenable` with detail
`podTooLarge.inline` ("this bean ran out of memory opening your family file... a computer or
a newer bean will still open it", now fixed to "device"). The "you can continue using" part is
`header.refreshUnopenable`, shown on a SECOND refresh tap while latched.

**Predicate:** a caught throw whose message matches `ALLOCATION_FAILURE`
(`isAllocationFailure.ts:87-93`: out of memory / memory allocation failed / array buffer
allocation failed / allocation size overflow / wasm memory|cannot grow memory|memory.grow, one
hop into `cause`). `payloadFailure()` (`docOps.ts:372-393`) maps it to `PayloadTooLargeError`;
anything else is `CorruptPayloadError`. Not `navigator.deviceMemory`, not IDB quota, not a
size heuristic. Raise site on refresh: `decryptToDoc` (`docOps.ts:396`) via
`mergeRemoteEnvelope` (`applyAndProject.ts:914`). **So it was a genuine allocation failure,
accurately classified.**

**It aborts AND latches:** `notePodUnopenable` (`syncStore.ts:3985-4003`) ->
`noteRemoteUnreadable`; polling stops, every merge throws at entry, saves refuse. Manual
Refresh is a one-shot half-open retry (`retryAfterRemoteBlock` `syncStore.ts:3562`). So "it
synced seconds later" was a SECOND attempt succeeding (another tap, or a rebind), not the same
one. If CloudWatch shows only one `manual-refresh` in that window the trace is incomplete:
filter `surface = pod-load-memory` (`action: pod-load-oom`, `perf_doc_bytes`, `detail = mem=`)
and `surface = pod-load-failure` for family ae92950b around the tap.

**Why it can still happen after compaction:** file size is the SMALLEST driver. (1) the WASM
linear heap never shrinks (`usePodCompaction.ts:311-313`), so a worker that once held the 4MB
history-heavy doc keeps that heap all session; (2) a merge holds base64 + decoded bytes +
plaintext + remote doc + local doc + merged doc at once (`docOps.ts:398-401`,
`applyAndProject.ts:1195-1199`); (3) history replay on `Automerge.load`, which is what
compaction removes. A 350KB pod merged into a heap already at the A7's ceiling can still fail
`memory.grow`; a page reload (fresh worker) fixes it, consistent with the second attempt
succeeding. **Expect this to fade on the A7 once every session starts from the compacted
pod, but not to be impossible.**

**Defect:** a 4s toast is the ONLY place a session-ending latch reaches the user
(`BackgroundSyncBar.vue:40-45` admits it). Should be a banner like `LineageBanner.vue`.

### Items 3 + 8 — identity / ownership attribution

**LIVE REGISTRY EVIDENCE (gathered in main session, 2026-09-08, read-only scan of
`beanies-family-registry-prod`, ap-southeast-1). This is ground truth, not inference.**

The current row:

```
familyId        ae92950b-68c7-462a-b5b9-5f98fa046620
familyName      Parker Meng Beanies
ownerEmail      joymaryministerio@gmail.com     <-- WRONG, should be greg
ownerMemberId   1698adcc-a022-464a-9e5c-4e9cbdc58244
createdAt       2026-09-08T02:07:56.140Z        <-- reset, was August
updatedAt       2026-09-08T02:07:56.140Z        <-- IDENTICAL to createdAt
country         NULL                            <-- was SG
signupPlatform  NULL
subscribeNewsletter NULL
memberCount     8
beanpodSizeKb   373                             <-- legitimate, compaction worked
fileId          1uKgSinpVah-rKQsMqIP_OcbwDA0WjUd0
```

**Finding 1: the row was REPLACED, not updated.** `createdAt` is byte-identical to
`updatedAt`. Confirmed against the rest of the table: the normal update path DOES preserve
`createdAt` (for example "m&j's home" has createdAt 2026-06-07 and updatedAt 2026-09-05, and
"The White House" has createdAt 2026-08-20 and updatedAt 2026-09-07). So there is a second
write path that issues a full `PutItem` instead of an `UpdateItem`, and it clobbers every
field it does not itself supply.

**Finding 2: the corruption signature is `createdAt == updatedAt` AND `country` null AND
`signupPlatform` null.** Across all 75 rows, exactly 5 match. Four of them are from May 2026
and are false positives: they pre-date the `signupPlatform` field (added in the 2026-08-24
platform-attribution deploy) and also have `memberCount` null, i.e. an older schema.
**Parker Meng Beanies is the ONLY modern row with this signature** (it carries `memberCount`
8, so it is written by current code). Blast radius today is therefore ONE row, greg's own.
The defective code path exists and will hit other families, but has not yet.

**Finding 3: `ownerMemberId` is populated**, `1698adcc-a022-464a-9e5c-4e9cbdc58244`. Whoever
wrote the row had access to a member id. The open question the code investigation must settle
is whether `ownerEmail` and `ownerMemberId` are sourced from the SAME resolution (the pod's
actual owner) or from two different places (member id from the doc, email from the currently
signed-in Google account). If they disagree in source, that is the bug.

**Working hypothesis to confirm or refute in code:** greg upgraded mary's phone to 0.17 and
opened it; on open, the 0.17 client re-registered the family in the registry via a full
`PutItem`, supplying the _currently signed-in Google account on that device_ as `ownerEmail`
and "now" as `createdAt`, with no signup context (hence the null `country` /
`signupPlatform`). Under this hypothesis **the pod owner did NOT change**; only the registry
attribution is wrong. This is consistent with greg still seeing himself as pod owner and
still seeing the compaction option in his own 0.17 app.

**REGISTRY WRITE PATH, COMPLETE.** The Lambda (`infrastructure/lambda/registry/index.mjs`)
does a read-merge-put: `:99-105` reads, `:178` `createdAt: existing.createdAt || now`,
`ownerEmail` `:184` and `ownerMemberId` `:188-189` are write-once. **So the row can only look
like this if it was DELETED first, then re-PUT by the next device to write.** All client
writes go through `buildRegistryPayload` (`syncStore.ts:2424-2452`) -> `PUT /family/{id}`
(`registryService.ts:161`); `ownerEmail`/`ownerMemberId` both come from
`authStore.currentUser` = whoever is signed in on THIS device (`:2436-2437`, member PROFILE
email, not the Google account). Correctness rests entirely on the server's write-once merge.
`signupPlatform` is stamped only on `isSignupEvent` (`index.mjs:251-253`), so a recreated row
can never get it; `country` comes from `settingsStore.country` which likely lived only in
greg's device `globalSettings`, so mary's phone sent null.
**The only live DELETE:** `familyContext.deleteLocalFamily` step 8 (`familyContext.ts:252-257`,
"Unregister from remote registry"), reached from **`FamilyPickerView.vue:97` "Delete Local
Family Data"** on the login picker (its confirm copy, `uiStrings.ts:6131-6134`, says "The
original file is not affected", yet it deletes the SHARED registry row) and from the
owner-gated full deletion `SettingsPage.vue:1232`. Compaction touches no registry code.
**Most plausible sequence:** on mary's 0.16 phone (4.0 doc, could not open the 5.0 pod),
"Delete Local Family Data" was used, then the 0.17 app re-opened/re-joined ->
`handleSignedIn` -> `ensureRegistered(true)` (`LoginPage.vue:671`) PUT with mary's session.
**QUESTION FOR GREG: did you use "Delete Local Family Data" on mary's phone?**
Neither PUT nor DELETE emits a client telemetry event (`registerFamily` only console.warns).
Lambda log group `/aws/lambda/beanies-family-registry-prod` would show two invocations at
02:07:5x. After the takeover greg's own pointer writes are REFUSED (`index.mjs:160`
"[registry] pointer write refused"), which is a live side effect until repaired.
**Proposed fix:** (1) remove the remote delete from the per-device `deleteLocalFamily`; keep it
only in the owner-gated full deletion; delete dead `syncStore.disconnect()` `:3199`.
(2) Lambda: tombstone (`deletedAt`) instead of delete, restore on PUT preserving
createdAt/owner; gate DELETE on `ownerMemberId`. (3) `UpdateItem` with `if_not_exists`.
(4) send `writerMemberId` for the pointer guard and `ownerMemberId`/`ownerEmail` from the
roster's `role === 'owner'`. (5) `logEvent({surface:'registry', action:'put'|'delete'})`.
(6) One-off repair of `ae92950b`: `ownerMemberId` = greg's memberId, `ownerEmail` =
`gpsp2001@gmail.com` (the profile email; `scripts/migrate-registry-dev-rows.mjs:6-7` treats it
as greg's identity), `country='SG'`, `signupPlatform='web'`, `createdAt` = August value if a
prior dashboard snapshot has it. No PITR on the table.
**Symptom B ("Signed in with") is NOT the registry:** it renders
`syncStore.sessionAccountEmail ?? providerAccountEmail` (`SettingsPage.vue:2033-2046`), the
OAuth-verified email of the live token. See item 5 root cause 4.

**Still to determine:** whether Symptom B ("Signed in with" showing the sister's email on
greg's desktop, self-correcting after a hard refresh) shares this root cause, i.e. a
"current member" resolver that returns the wrong record while the roster is mid-merge or
while lineage is blocked.

### Item 4 — cross-version loss. CONFIRMED, exact line found.

1. **0.16 uploaded the todo, unconditionally.** In `c3a6be98` the debounced save -> `save()`
   -> `doSave` (`syncService.ts:1228`); `fetchAndMergeRemote` throws
   `Unsupported beanpod version: 5.0` (`fileSync.ts:73-74`), the catch at `:1270-1272` logs
   "non-fatal" and CONTINUES; `:1309` PATCHes the 4.0 envelope over the 5.0 file with no
   precondition (`driveService.ts:193-201`, no `If-Match`); `:1325` `commitRemoteBaseline`
   records HER OWN heads (todo included) as Drive's baseline.
2. **The fleet reverted it.** The 0.17 browser polled, saw a 4.0 file, `compareLineage` =
   `ours-newer` (`podLineage.ts:135`) -> `publish-local` -> `kept-local`
   (`applyAndProject.ts:1040-1050`) -> the 5.0 pod was written back. The todo bytes were on
   Drive for one poll interval and nobody merged them.
3. **Her phone on 0.17, first open:** warm cache, `baselineHeads` = her own exported heads
   (`syncStore.ts:1198-1206`); `lineageContextFor` (`applyAndProject.ts:876-886`) finds
   basis heads == current heads and answers `clean`; `compareLineage(remote=5.0, local=null)`
   = `adopt-remote`; `POLICY['adopt-remote'].clean = 'adopt'` (`podLineage.ts:175`). The
   rebase never runs. `installWholesale = true` at `:1119`, and
   **`applyAndProject.ts:1152-1153` (`currentDoc = adopted`) is the line where the todo dies.**
4. **The cruel part:** the rebase WOULD have saved it. Context was `clean` only because 0.16's
   upload "succeeded" and certified her own heads as the baseline. Had the upload failed
   (offline), context would be `dirty`, `adopt-remote x dirty = rebase`, and `buildRebaseOps`
   (`docOps.ts:730`) would have replayed the todo onto the 5.0 pod. A 0.17 device cannot fix
   this from its side; the false `clean` is a fact 0.16 wrote.

**Verdict: expected under the shipped design, and the design's own plan documents it, but
it is silent data loss for exactly the real-world straggler case.** Mitigations: a Drive-side
precondition so a client that cannot parse the remote cannot overwrite it (0.16 is already
shipped, so this is server/Drive-side or nothing); refuse compaction while
`membersOnOlderVersions()` is non-empty (currently advisory only); or accept and document.

### Item 6 — euphemisms. APPLIED, see 'Actions taken'.

### Item 7 — native Drive restore. COMPLETE, see 'COMPLETED: native Drive restore gap' above.

### Item 9 — transient state. COVERED by items 5 (root cause 4) and 1.

The banner is in-memory; a reload re-runs `reconcileDriveTokenWithDoc`
(`syncStore.ts:1475-1477`) and adopts a newer mirrored token, so silent refresh succeeds and
the reconnect toast clears with no consent. The lineage banner cleared because the reload's
merge succeeded once the desktop's own heads matched. Both are honest-but-badly-timed
surfaces, fixed by the item-5 and item-1 proposals.

---

## Actions taken

(nothing yet)

---

## Confirmed from CloudWatch (main session, targeted at family_id ae92950b, 02:00-02:20 UTC)

- Devices actively syncing that morning: **`SM-T500` on Android 12** (that is the Galaxy Tab
  A7, item 2's device) and a **Windows desktop**, both on `build_sha 36a76042` (= 0.17).
- The pod was in a healthy loop: repeated `automerge.remoteLoad` (250ms to 2000ms,
  `perf_doc_bytes` climbing 312820 -> 317660) then `action: merged` then
  `action: noop-steady-state`. So sync was working normally on both devices at that time.
- `save_failure_level: none`, `drive_file_not_found: false`, `online: true` throughout this
  window. **No auth or save failure is visible in this slice**, which means the Google
  grant-revocation symptom (item 5) happened outside 02:00-02:20 UTC and needs its own
  targeted query once the code thread names the surface.
- ⚠️ Method note for whoever resumes: do NOT `filter-log-events` on the bare family_id, it
  returns thousands of routine `noop-steady-state` / `job_toggled` lines and floods context.
  Filter on the specific `action` or `surface` string instead, and cap `--max-items` low.

---

## Run log

- **2026-09-08 ~10:30 SGT:** six parallel investigation threads launched. Weekly usage limit
  hit while they ran; all six primary threads died mid-flight. Three sub-threads completed and
  their findings are recorded below. Model switched to Fable 5.1 afterwards.
- **Died before reporting (need re-running):** Google auth regression (item 5, PRIORITY),
  compaction pending-save gate (item 1), memory toast (item 2), euphemism audit (item 6),
  registry write path (item 3, partial lead below), cross-version data loss mechanism
  (item 4, partial lead below).
- **Two leads captured from dying threads, unverified:**
  - ~~`account-binding-heal` fired 212 times~~ **CLOSED, dud.** Checked: 400 events, ALL
    `action: noop-steady-state` / "account binding already correct", all 4 to 5 Sep on 0.16
    builds (`6964211a`, `c3a6be98`), zero today. It is a heartbeat at `syncStore.ts:5419`,
    not a heal that fired. Do not chase it.
  - Cross-version thread's last words: "The smoking gun. Now let me verify the
    `publish-local` tail on the 0.17 side." So the mechanism for item 4 is in the
    `ours-newer -> publish-local` self-heal path. Start there.

---

## COMPLETED: pod ownership mutation trace (feeds items 3 + 8)

**Verdict: no path silently reassigns pod ownership by email, index, or first-match.** The
cross-family "works out who you are" code (CHANGELOG 2026-09-07) is cryptographic: it binds
only the member whose wrapped key the entered password actually unwrapped, and refuses if
that set is not exactly one (`fileSync.ts:243-249`, contract at `:186-192`;
`syncStore.ts:2182-2187`; `SettingsPage.vue:816-839`; `LoadPodView.vue:662-678`).
`resolveSessionMember` matches by `memberId` only and never falls through to the owner
(`familyStore.ts:247-289`). **This strengthens the conclusion that greg's pod ownership did
NOT change; the registry row is the thing that is wrong.**

Exactly three writers of `role: 'owner'` into the doc:

1. `authStore.ts:991` `buildOwnerDoc` (pod creation only).
2. `familyStore.ts:743-756` `transferOwnership` (explicit, reauth-gated).
3. **`familyStore.ts:615-647` `normalizeRoles`, runs automatically on EVERY `loadMembers()`.**
   When the doc has zero owners it PROMOTES a member: preferred pool is claimed humans, but
   at `:624` it degrades to ALL humans, so **an unclaimed pending invitee can be promoted to
   owner** with `canManagePod: true`. Tie-break is `createdAt` ascending.

Pre-existing defects found in passing (not today's bug, but real):

- `familyStore.ts:739-747` `transferOwnership` demote is conditional on a projection lookup;
  if it misses, the demote is silently dropped, two owners result, and the next
  `normalizeRoles` demotes the LATER-created one, i.e. reverses the transfer the user just
  made while the UI reported success.
- `familyStore.ts:514-537` `deleteMember` has no owner guard (guard lives only in
  `useMemberRemoval.ts:58`); `CreateMembersStep.vue:108` bypasses it.
- `useJoinFlow.ts:336-338` unclaimed-member filter has no `role !== 'owner'` clause, so an
  owner row that reads as unclaimed is claimable via any valid invite link.
- `usePermissions.ts:47-55` grants owner from the session role pre-roster (documented hole).

## COMPLETED: native Drive restore gap (item 7)

**Verdict: accidental carry-over, a bug to fix, not a platform limitation.**

- Gate: `SettingsPage.vue:581-583` `canRestoreFromDrive = hasPod && provider==='google_drive'
&& !isNative()`. Hides the "Google Drive..." button at `:2125-2135`.
- The `!isNative()` was added in `02c2e347` (2026-09-07) because the restore was going to use
  the **Google Picker** (unreliable in iOS WebKit, ADR-026). In the same commit the mechanism
  was swapped to `GoogleDriveFilePicker` (REST `files.list` + a plain BaseModal, no gapi, no
  iframe), which works fine in a WebView. The guard outlived its reason; the comment at
  `:571-575` even contradicts `:576`. No test covers the predicate.
- Residual real gap: `openDriveRestorePicker` (`:679-696`) calls `listGoogleDriveFiles()` ->
  `requestAccessToken()` which is the desktop POPUP path (`googleAuth.ts:835`
  `openBlankPopup()`). Actively-syncing families hit `isTokenValid()`/silent refresh first so
  it usually never reaches the popup, but it can.
- **Proposed fix (small):** drop `&& !isNative()`; add `silent?: boolean` to
  `syncStore.listGoogleDriveFiles` (`syncStore.ts:5350`) using `getValidTokenSilent()`; on
  `TokenExpiredError` route to the existing `useGoogleReconnect` (already imported at
  `SettingsPage.vue:53`), which handles native via `startRedirectAuth`. Add a unit test with
  `isNative` mocked true asserting the Drive button renders. Lesson: when a review changes a
  mechanism, re-audit guards that existed only because of the old one.

## COMPLETED: compaction design + history (feeds items 4, 1, 9)

- **Compacted pods are envelope version 5.0** (plan `2026-09-06-compacted-pod-v5.md`). A 0.16
  client's `parseBeanpodV4` throws on any version other than `'4.0'` BEFORE decrypt, so a
  0.16 device **cannot merge into** a compacted pod. The plan states 0.16 "gets no message",
  sees stale data under "Could not refresh", and the family is expected to tell them.
- **What 0.16 CAN still do is OVERWRITE the pod** (plan `:23`, `:342-344`): any save on a
  warm-cache stale device uploads its 4.0 doc straight over the 5.0 file. The fleet's
  `ours-newer -> publish-local` self-heal then puts the compacted pod back. **This is the
  mechanism that ate mary's todo (item 4):** her 0.16 device wrote the todo into its local
  4.0 doc and may have uploaded it over the 5.0 pod; a 0.17 peer then reverted that upload;
  the 0.16 doc was never mergeable into the new lineage, so when her phone upgraded to 0.17
  and pulled the 5.0 pod, the local 4.0 doc was on a foreign lineage. Whether the rebase
  (`applyAndProject.ts:823-844` `rebaseOntoRemote`) ran and dropped it, or the wholesale
  install path did, is the part still to confirm (the dying thread was checking the
  `publish-local` tail).
- **So item 4 is EXPECTED BY DESIGN and the design accepts it.** The plan's position is that
  the deploy-and-drain sequence is the primary control and there is deliberately no version
  gate. Judgement call for greg: real families WILL have a straggler device, and the current
  outcome for that device's post-compaction edits is silent loss.
- **No release/version gate on compaction exists.** The soak gate was explicitly removed
  (`usePodCompaction.ts:155-160`). `membersOnOlderVersions()` (`podSoak.ts:73-88`) produces
  advisory names only. Per-device app versions are not recorded anywhere; `appVersion` is a
  per-member field stamped at login and documented as diagnostics-only (`models.ts:347-352`).
  Refusal codes are `usePodCompaction.ts:42-65`: `not-owner`, `not-synced`,
  `backup-not-delivered`, `no-envelope`, `no-permission`, `safety-copy-failed`,
  `safety-copy-damaged`, `backup-too-large`. **`not-synced` is the one greg hit in item 1**
  (`usePodCompaction.ts:217-224`); its predicate is still to be traced.
- **Backups:** manual export gated on a "did it land" confirm (`usePodCompaction.ts:262-275`)
  plus an automatic sibling `<name> (before compacting).beanpod` in the pod's own Drive
  folder, read back and byte-compared (`:280-361`). Only one safety copy is retained; a second
  compaction overwrites it. The pod itself is PATCHed in place on the same `fileId`
  (`driveService.ts:187-220`) so Drive keeps default revision history, but nothing pins it
  and there is no in-app revision UI. **Mary's lost todo is not in any backup**: it was
  written after the safety copy was taken.
- **No quarantine of orphaned changes on lineage mismatch.** `LineageBanner.vue:70-85` offers
  export (whole-document, not a diff), "Use the family file" (= discard, after a danger
  confirm, `useBlockerBanner.ts:72-102` -> `syncStore.ts:4056-4106`), or dismiss. On the
  `conflict` verdict only dismiss is offered. Nothing writes the discarded changes anywhere.
- Flag: `podCompaction: true` since `142d25a8` (2026-09-07), still true at HEAD. STATUS.md
  `:130` still lists on-device drills as "OWED before the flag can be flipped", a doc/code
  contradiction.
- `cacheInitLoss` (STATUS `:2112` finding) has since been split into per-site helpers
  (`applyAndProject.ts:110-141`, `openStageLoss()` at `:139`); STATUS still lists it open.
- Related open bug: `BUG-drive-restore-provider-switch.md`, restore re-homes to a LOCAL file
  on Chromium desktop, and that is the compaction ROLLBACK route (STATUS `:49`).

- **2026-09-08 evening, resumed on Fable 5.1.** greg asked to limit concurrency for usage.
  Four threads relaunched (auth / registry write path / compaction gate + memory toast +
  rebase mechanism / euphemism audit). No further spawning after these; remaining work runs
  in the main session sequentially.

## Actions taken (updated)

- **Item 6 APPLIED (safe fix), uncommitted:** 115 `beanie` values in `uiStrings.ts` rewritten
  to real nouns on important surfaces (only `beanie` changed, `en` untouched). Guard test added:
  `uiStrings.test.ts` "important-surface beanie values" fails when a `beanie` value under an
  important-surface prefix introduces a bean-word its `en` lacks. Rule added to `CLAUDE.md`
  Code Conventions, `.claude/skills/beanies-theme/SKILL.md` § "Beanie mode: playful, never
  opaque", and the CIG beanie-mode blurb. Test green (10/10), eslint clean.
- **Item 1 retry APPLIED (safe fix), uncommitted:** `CompactionProgressModal.vue` now shows a
  primary "Check Again" button (new key `compaction.refused.checkAgain`) when the refusal is
  `not-synced`, Done demotes to secondary; `usePodCompaction.progressFailure` carries
  `retryable: code === 'not-synced'`; `SettingsPage.vue` wires `@retry="compactPod"` (the
  `busy` guard makes a double press safe, `compact()` resets the failure at `:190`). 29/29
  composable tests green. The underlying `syncNow` timestamp write is NOT changed (sync
  layer, needs approval).

## Status: INVESTIGATION COMPLETE, 2026-09-08 evening. All nine items root-caused.

**Awaiting greg's decisions:**

1. Approve the item-5 auth fix (drop reconnect revokes, no forced consent, escalate only on 4xx).
2. Approve the item-1 sync fix (stop `syncNow` writing `lastSyncTimestamp` into the CRDT).
3. Approve the item-3 registry fix (no shared delete from a per-device action; tombstone;
   owner from roster) and the one-off repair of row `ae92950b`.
4. Approve the item-7 native Drive restore fix (drop `!isNative()`, silent token + reconnect).
5. Decide item-4 policy: precondition on overwrite, refuse compaction with stragglers, or accept.
6. Answer: was "Delete Local Family Data" used on mary's phone?
7. Item 2: promote the memory latch from a 4s toast to a banner.

---

## 2026-09-08 evening: the DELETE is CONFIRMED, and the row is REPAIRED

**Lambda logs settle it.** `/aws/lambda/beanies-family-registry-prod`, two invocations
412ms apart: `02:07:55.728` and `02:07:56.140`. The row's `createdAt` == `updatedAt` ==
`02:07:56.140Z`, i.e. the SECOND invocation. No `[registry] pointer write refused` line in the
window, because after the row was gone `existing` was empty and the owner check falls to
tier 3 ("row has neither -> fall open"). Earlier pairs at 01:51:34 and 01:55:14 mean the
DELETE may have been at either of those, with 02:07:55.7 being a GET that 404'd. Immaterial:
the fix is the same for all three orderings.

⚠️ **greg says he did NOT press "Delete Local Family Data".** `syncStore.disconnect()` (the
other `removeFamily` caller) has no prod caller. So either the picker action was used without
being recognised as destructive (its confirm copy says "The original file is not affected",
`uiStrings.ts:6134`, which is FALSE for the shared registry row), or there is a fourth path
not yet found. The fix must therefore be defence in depth, not a single-door patch:
per-device actions never delete the shared row, the Lambda tombstones instead of deleting,
`GetItem` uses `ConsistentRead`, and owner fields come from the roster.

**REPAIR APPLIED 2026-09-08 (authorised by greg, "fix my family's registry row asap").**
`UpdateItem` on `ae92950b-68c7-462a-b5b9-5f98fa046620`:

- `createdAt` 2026-09-08T02:07:56.140Z -> **2026-03-04T11:35:25.796Z**. Reconstructed from the
  Drive `createdTime` of the pod file `1uKgSinpVah…` (owner `gregsophia@gmail.com`), which is
  the earliest hard evidence of this family. The true original is UNRECOVERABLE: no
  pre-corruption registry snapshot survived on disk. The pre-clobber value observed by the
  morning metrics run was "an August date", but the local CloudWatch metrics cache has this
  family active from 2026-06-10, so that August value was probably itself a clobber artefact.
  This is a documented reconstruction, not the original. Reversible.
- `country` NULL -> **SG** (restoring an observed value, not inventing one).
- `ownerEmail` and `ownerMemberId` **REMOVED**, deliberately.
  Do NOT set these by hand. They are write-once in the Lambda, so a WRONG `ownerMemberId`
  would refuse greg's own pointer writes forever with no way back (the trap the Lambda's own
  comment at `index.mjs:121-138` warns about). greg's memberId is not knowable from here (the
  pod is encrypted; `1698adcc…` is mary's). Nulled, the Lambda falls open and stamps whoever
  writes next; once the roster-sourced fix below ships, that stamp is the ROSTER OWNER, i.e.
  greg, regardless of which device writes. Until then there is a small window where another
  member's device could re-claim it, which is no worse than the state it was already in.
- `signupPlatform` left NULL on purpose. 63 of 75 rows are null (the field postdates them);
  stamping `web` would be fabricating data.

---

# HANDOFF — read this before touching anything (written 2026-09-09)

The plan is `docs/plans/2026-09-08-compaction-fallout-remediation.md`. It has a
seven-stage table; this section says what is actually done, what is deliberately
NOT done, and the traps.

## Stage status

| Stage                | What it is                                                                               | Status                                              |
| -------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1 Auth               | remove reconnect revokes, escalation gate, heal a blocked device's token                 | **DONE** (§1d shipped 2026-09-09, `b80adc69`)       |
| 2 Registry server    | Lambda `ConsistentRead`, tombstone, `writerMemberId` guard, + `pull_registry.mjs` filter | **DONE** (`f9e3bda6`) — NOT DEPLOYED                |
| 3 Client fixes       | registry delete, compaction refusal, native Drive, invite link, telemetry                | **DONE**                                            |
| 4 Registry wire      | client sends `writerMemberId` (additive no-op)                                           | **DONE** (`623b908d`)                               |
| 5 Registry semantics | owner fields from the roster + the ops step that finishes greg's row repair              | **DONE** (`623b908d`) — the ops re-verify is OWED   |
| 6 Preservation       | carry local-only entities on adopt                                                       | **Not started, and that is a DECISION — see below** |
| 7 Surfaces           | recipe-page toast, blocker banner, version floor, DELETE enforcement                     | **§8 §9 + floor DONE (`4a9b524e`); §2d-ii GATED**   |

### Updated 2026-09-09 (second session)

Every stage except 6 has shipped to `main`. **Nothing is deployed.** Three things
are deliberately still open, and none of them is an oversight:

- **§2d-ii, the DELETE 403.** Gated on a MEASUREMENT, not on effort. The stage-2
  Lambda logs `[registry] delete would be refused` and still deletes; enforce only
  once that line is quiet for real families for a full release cycle. Every client
  older than stage 4 sends no writer id at all — including the Playwright teardown
  hook, silently, because it is fire-and-forget.
- **The version floor stays `0.16`.** Unchanged and still correct: 0.17 is
  TestFlight + Play open testing only. Raise it on the first WEB deploy after 0.17
  is live on BOTH stores.
- **Stage 6.** greg's decision, twice — see below, and
  `docs/plans/2026-09-09-stage-6-preservation-brief.md` for the ready-to-execute
  version.

⚠️ **DEPLOY ORDER IS NOT OPTIONAL. The stage-2 LAMBDA MUST GO FIRST.** Stage 5
sources the registry's owner fields from the pod roster. Against the OLD Lambda,
whose guard compares `body.ownerMemberId` to the stored owner, every device now
sends the roster owner and therefore every device MATCHES — the pointer guard is
neutered rather than tightened, on every family, for as long as the client is
ahead of the server. Deploy `f9e3bda6`'s Lambda, confirm it in prod, then ship the
web bundle.

**Offered, not done: drop `dynamodb:DeleteItem` from the registry Lambda's IAM
policy** (`infrastructure/modules/registry/main.tf:80`). The tombstone is a
`PutItem`, so the permission is now unused, and removing it would make a hard
delete structurally impossible rather than merely absent from the code — which is
the same "make loss impossible" argument stage 2 rests on. It was NOT done because
it creates a cross-system ordering constraint the plan spent Pass 3 removing: the
Terraform apply must follow the Lambda code deploy, or the old code's DeleteItem
502s. Worth doing as its own small change once the Lambda is live.

⚠️ **STILL OWED: greg's row `ae92950b`.** Both owner fields were deliberately
NULLed by hand and the row is re-claimable by whichever device writes next. Once
the Lambda AND the client are both live, re-check `ownerMemberId`: it should be
greg's roster-owner id. If a pre-stage-5 device re-claimed it with something else,
NULL it again and let a current client stamp it.

A FIFTH round then ran over that work and found fifteen more, fixed in
`6b0e455a` — **two of them security regressions the stage-4/5 work itself
created**, and they are the reason this file now carries a rule in
`docs/lessons.md`:

- Sourcing `ownerEmail` from the roster INVERTED the Lambda's legacy pointer tier.
  That tier compares emails, and once every device sent the owner's address rather
  than its own, it matched for everyone: any member could re-point a legacy row,
  reported as accepted so nothing paged. `writerEmail` now rides beside
  `writerMemberId`.
- The tombstone could be LIFTED by a refused write, because `PutItem` replaces the
  whole item. A member's ordinary background register after a deletion brought the
  family back as live with a null pointer — a state the hard delete could not
  produce. Only a write that may set the pointer lifts it now.

A fourth `/code-review max` round ran over the third round's fixes and found
fourteen findings, all fixed in `4a9b524e`. The headline: `reconnect()`'s widening
from boolean to a string union had been applied to four of its six call sites, and
because every arm of the union is truthy, the two that kept `if (!ok)` went from
wrong on one arm to wrong on two with nothing to signal it — type-check clean,
eslint clean, tests green, and the app-wide reconnect prompt showing "Reconnected"
in green on a failed reconnect. **There is no type-aware linting in this repo**, so
that class cannot be caught by the compiler; the call sites carry tests instead,
and each was verified by experiment to fail against the old code.

Shipped commits: `a21f2bb6`, `4fff34e5`, `94f4a30d`, `1db5f446`, `87bfc738`,
`675602e7`, `31a90180`, `e6d445af` (+ two docs commits). NOT DEPLOYED.

## ⚠️ STAGE 6 — DO NOT "DISCOVER" THIS IS ALREADY FIXED. IT IS NOT.

greg asked exactly the right question and it is worth writing out, because the two
paths look identical and a reader will otherwise either re-fix a working path or
dismiss a real gap.

**Path A — ALREADY FIXED, WORKS, DO NOT TOUCH.** Both devices on 0.17. Device B is
offline, makes edits, comes back online after a compaction. Its baseline is
HONEST (it genuinely has not pushed), so `lineageContextFor` answers `dirty`,
`POLICY['adopt-remote'].dirty = 'rebase'`, and `rebaseOntoRemote` replays the
edits onto the compacted document. This was implemented and tested before this
investigation. Nothing in this work changed it.

**Path B — mary's case, NOT fixed.** Her phone was on 0.16, which cannot READ a
5.0 pod (`parseBeanpodV4` throws before decrypt) but whose save path writes over
it anyway and then calls `commitRemoteBaseline` with ITS OWN heads. That baseline
is a lie. When the phone later upgraded to 0.17, the 0.17 code compared
`basis.heads` against `headsOf(currentDoc)`, found them equal, answered `clean`,
and took `POLICY['adopt-remote'].clean = 'adopt'` — the wholesale install at
`applyAndProject.ts:1152`. The rebase never ran, not because it is broken but
because the device believed it had nothing to replay.

Same code. Different entry condition. Path A's fix is sound; Path B walks past
its trigger.

**It IS fixable in code, and 0.16 does nothing.** The todo lives in her local
Automerge document in IndexedDB, which survives the app upgrade. At the moment of
loss 0.17 is running and holds BOTH her document (with the todo) and the compacted
pod. It discards the todo by choice, not by inability.

**What can never be recovered, and this is the honest limit.** Compaction builds a
fresh document from a snapshot, so there is NO common ancestor between the old
lineage and the new one and a true three-way merge is impossible. Entity-level is
the best available:

- new items created on the stale device -> recoverable (mary's todo is this case)
- edits to an item that exists in both -> NOT (the adopt replaces the entity and
  there is no basis to pick a winner)
- deletions made on the stale device -> NOT (they would resurrect)

**greg's decision, 2026-09-09: leave stage 6 exactly as the plan has it, do not
implement it now.** Reasoning: it touches `applyAndProject`'s adopt path, the
highest-risk code in the plan, and BOTH Pass 3 and Pass 4 found serious defects in
earlier drafts of this very change (one would have closed the lineage banner's
only exit, one would have republished dead refresh tokens that §1d then reads to
heal). Set against that, it rescues new items on a straggler device — a window
that shrinks as the fleet updates. If it is built, it gets its OWN session and its
OWN review, never appended to other work.

**The cheaper alternative, NOT done, offered for a future session.**
`compaction.olderVersion.notice` (`uiStrings.ts:4595`) already names the members on
older versions: "{list} last opened beanies on an older version. Ask them to update
beanies before you compact." It is decent but it is the soak-gate framing greg
rejected, and it never says what happens if they do NOT update. Tightening it to
state the consequence in one brief line is far smaller and far safer than stage 6.
Not done because greg said make no changes.

## Other things deliberately NOT done, with reasons

- **§1d (heal a lineage-blocked device's token from the remote envelope).** Needs a
  read-only decrypt the Automerge worker does not expose; that is a new worker
  protocol op, larger than the plan's sketch implied. Not attempted.
- **The persisted escalation counter's re-fire** (`consecutiveSilentRefreshFailures`,
  `googleAuth.ts`). A review round argued it should reset after firing. Left alone:
  it is long-standing behaviour pinned by a test that states the reasoning
  ("subscribers are idempotent"), and establishing whether a dismissal survives a
  re-fire needs a behavioural check nobody ran. The reasoning is in the code.
- **`promptBelowVersion` stays `0.16`.** greg asked for 0.17; it was raised and then
  REVERTED, because 0.17 is TestFlight + Play open testing only and both
  `STATUS.md` and runbook section 7 say not to prompt before a version is live on
  BOTH stores. Raise it on the first WEB deploy after 0.17 goes live. Both deploy
  skills and `scripts/deploy/check-version-floor.sh` now ask, with store-liveness
  as precondition 1.
- **`ownerMemberId` on greg's registry row is NULL on purpose.** It is write-once in
  the Lambda, so a wrong value permanently refuses his own pointer writes, and his
  memberId is not readable from here (the pod is encrypted). It is re-claimable by
  whichever device writes next until stage 5 ships. Stage 5 carries the re-verify.

## ⚠️ The compaction dirty-document class is NOT closed

`lastSyncTimestamp` was ONE writer. Verified still open:
`calendarSyncStore.ts` — `RECONCILE_POLL_MS = 300_000` (`:102`) against
`FRESHNESS_WINDOW_MS = 120_000` (`:105`). The guard at `:767` exists, per its own
comment, "to stop a no-op reconcile from churning the CRDT", but the poll interval
is larger than the window so `Date.now() - lastAt` is always bigger and the guard
can never fire on that path. The write at `:777` therefore runs every 5 minutes,
putting per-device sync bookkeeping into the SHARED document. Any calendar-connected
family goes dirty within minutes of every save, so the compaction gate pays a full
re-push each attempt.

The fix is the one already applied to `lastSyncTimestamp` and to `installProvider`:
device-local bookkeeping does not belong in the family document. It is a schema
change and was NOT made unilaterally. **Before touching the compaction gate again,
sweep for other writers of this class rather than fixing one more site.**

## How this session went, because it should change how the next one runs

Three `/code-review max` rounds found 45 issues and a large share were caused by
the fixes themselves, not pre-existing: an unbounded infinite loop, the
owner-resurrection reintroduced TWICE at a new caller, three guard tests that could
not fail, and a contract flip that silently broke its caller. Two lessons are in
`docs/lessons.md`. The pattern to watch: **fixing one instance of a defect is not
fixing the defect**, and twice a comment was shipped asserting a survivor was safe.

Round three changed approach — decisions moved into the owning layer
(`reconnect()` returns an outcome, the registry gate proves deletion) rather than
patching call sites a fourth time. That is the approach to continue.

**Recommended first action in the new session, BEFORE any new work:**
`/code-review max e6d445af` with fresh eyes over everything shipped. The
convergence is real but unproven — three rounds each found defects in the last
round's fixes, and round three has not been independently reviewed at all.

Then one stage per chunk, each with its own commit and its own review. Stage 2
before stage 5 (it is the prerequisite); stage 4 before stage 5 and before stage
7's DELETE enforcement. Stages 2/4/5/7 are a deliberately ordered ladder in which
each step is a no-op alone — do not merge them.
