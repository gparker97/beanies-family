# Plan: Compaction nobody has to know about (#90 Tier 3)

> Date: 2026-09-05
> Related issues: #90 (Tier 3). No GitHub issue — direct implementation.
> Plan file: `docs/plans/2026-09-05-pod-compaction-tier3.md`
> Status: **DRAFT — Pass 1 only.** Passes 2-4 run after the Tier 2 code review lands.
> Builds on: `docs/plans/2026-09-05-pod-load-oom-tier2.md`, `docs/plans/2026-09-05-device-actor-lease.md`

## User Story

As a non-technical family member, I want my family file to stay small enough to
open on every device we own without anyone learning what "compaction" is, so
that a child's tablet keeps working and nobody's offline changes are lost.

## Context

Tier 2 shipped compaction as a **supervised migration**: owner-only, behind a
flag, refusing unless fully synced, forcing a manual encrypted export first,
and — the part that matters here — leaving one user-facing dead end: a peer
that made changes while offline, then syncs after a compaction, is BLOCKED
with "save or export first, then reload". Saving is also refused (that would
merge across lineages), so the only exit is export, reload, and re-enter the
edits by hand. On a family app that dead end lands on whichever device was
offline, which is often a child's tablet or a phone used away from wifi.

greg's direction (2026-09-05): make this invisible. "Will there simply be a
compaction button they can click … can compaction be something that happens
automatically when files reach a certain size?" And: deliver Tier 3 as part of
this work, test it on the test family, then use it on the production family.

Three things stand between Tier 2 and "invisible", in dependency order:

1. **The dead end.** Replace the block with a REBASE of the peer's orphaned
   edits onto the new lineage. This is the only piece that removes user
   knowledge from the flow, and it improves the manual path on its own.
2. **The manual export.** Replace it with an automatic pre-compaction safety
   copy written beside the pod on Drive.
3. **The button.** Keep compaction a deliberate click (greg's decision,
   2026-09-05: no automatic trigger for now), but make the click SAFE at any
   time and make its timing obvious: a note in Settings when the file is due,
   which takes you to the button, and a button that refuses with a plain
   reason if any device in the family has not yet updated to a build that
   honours the lineage guard.

## Requirements

### R1 — Rebase orphaned edits (replaces `adopt-remote × dirty → block`)

1. When the lineage guard would block because this device holds unsynced
   edits against a remote that has been compacted, the device instead:
   a. computes its OWN changes since the last Drive bytes it merged
   (`Automerge.diff(local, baselineHeads, currentHeads)`), classified per
   entity the way `projectionDeltasBetween` already classifies them;
   b. adopts the compacted remote;
   c. replays those changes onto it as ONE Automerge change under this
   device's actor, **field-level three-way**: for a touched entity, only
   the fields that differ between `view(local, baselineHeads)` and `local`
   are written; an entity created locally is inserted whole; an entity
   deleted locally is deleted; `settings` keys likewise;
   d. persists, marks the doc dirty so the next save publishes the rebased
   edits, and tells the user in one toast ("combined N changes made while
   offline").
2. The rebase needs the FULL baseline heads, not the fingerprint the worker
   stores today. The remote-baseline row gains a `heads` array (a few hashes;
   written where `headsFp` is written). An old row without `heads` → the
   rebase is unavailable → today's block, with the reason logged. Never guess.
3. Any failure to compute or apply the rebase (unknown diff path root, an
   entity whose collection no longer exists, a thrown change) → fall back to
   today's block, with the reason logged. The rebase is additive safety; it
   must never be able to lose more than the block would.
4. Conflict semantics are entity-field last-writer-wins, peer wins. Documented
   in the Help Center explainer (below). The `conflict` verdict (two
   concurrent compactions) remains blocked — R3's claim makes it rare, and a
   machine still must not pick between two lineages.
5. All three guard termini use the same rebase path (one function, called
   where `guardLineage` returns `block` for `adopt-remote`).

### R2 — Automatic safety copy (replaces the manual export gate)

1. Before publishing a compaction, write the CURRENT (pre-compaction) envelope
   as `<familyName> — before tidy YYYY-MM-DD.beanpod` **beside the pod, in the
   same Drive folder** (greg: "next to the beanpod file, properly labelled"),
   using the existing `createFile` on `getOrCreateAppFolder`. Same keys, same
   password: it opens like any export, and because it sits beside the pod it
   also appears in the "open your family" picker under that unmistakable name,
   which IS the rollback route.
2. The copy must be READ BACK (list the aux folder and find it) before the
   compaction proceeds — "written" is not "landed", the same discipline as
   today's `confirmBackupLanded`.
3. Providers that cannot write a sibling (the local file-handle provider) keep
   today's manual export gate. Capability, not UA-sniffing: a provider method
   `writeSibling?` that the Drive provider implements.
   ⚠️ `listBeanpodFiles` (the picker) must not treat the copy as a candidate
   for auto-selection; it filters on the "before tidy" marker.
4. Keep the two most recent safety copies per family; delete older ones after
   a successful write. Never delete on a failed write.
5. The Help Center explainer names the file so a person who finds it in Drive
   knows what it is and that it is safe to delete.

### R3 — "Due" note, a button that is safe at any time, and the soak check

1. **Due**: after every successful open, the worker reports the decrypted
   payload size and `Automerge.stats(doc)` (`numChanges`, `numOps`). The pod
   is _due_ when payload ≥ 1MB **and** numChanges ≥ 5,000. (greg's failing pod
   is 2.06MB / 10,707 changes; a 3GB tablet fails near 300MB RSS ≈ 2MB. The
   threshold is half the known-bad.) Both numbers are logged on every open so
   the threshold can be tuned from CloudWatch, not guessed again.
2. **The note**: when due, Settings shows a quiet notice near the top of the
   Family Data section — "your family file is getting large; tidying it makes
   it open faster on every device" — with a link that scrolls to and
   highlights the compaction row. Owner and admin only (nobody else can act
   on it). Dismissable for 30 days per device; reappears if still due.
3. **Owner or admin** may compact (greg, 2026-09-05; Tier 2 was owner-only).
4. **The button is safe at any time.** Its gates, in order, each refusing with
   a plain-language reason: fully synced (`flushPendingSave` + `syncNow` +
   `isFullySynced`, as today); every device in the family is on a
   guard-honouring build (R3.5); the safety copy has landed (R2) or, for a
   provider without sibling writes, the manual export has. Then the existing
   sequence: verify → flush → stamp lineage → publish. With R1 in place,
   a peer that edited offline is rebased rather than blocked, so the click no
   longer needs the person to think about other devices.
5. **Soak**: the doc gains a small `devices` record — `deviceId → { memberId,
appVersion, lastSeenAt }` — written once per open (one tiny change under
   the pinned actor). The button refuses while any device seen in the last 30
   days reports `appVersion < MIN_GUARD_VERSION`, naming the member ("Sam's
   tablet needs updating first"). A device unseen for 30 days is treated as
   retired; if it returns with unsynced edits it gets R1's rebase, and if the
   rebase is unavailable it gets today's block and the safety copy exists.
6. **Two admins clicking at once** is handled by what exists: the `syncNow`
   gate adopts a compaction that landed first, and the `conflict` verdict
   blocks the genuine race. No claim mechanism.
7. **No automatic trigger.** Nothing compacts without the click. The "due"
   signal, the `devices` record and the refusal reasons are exactly the
   inputs an automatic trigger would need later, so adding one is a follow-up
   of one composable, not a redesign.
8. **Flag**: `podCompaction` stays and becomes the gate for the note as well;
   retirement criterion: after ≥ 20 families have compacted with zero
   `pod-rebase failed` and zero `pod-merge` events for 30 days, the flag
   defaults on.

## Important Notes & Caveats

- **Order of delivery is load-bearing.** R1 first: it removes the dead end for
  the manual path and is required before any automatic trigger is acceptable.
  R2 second. R3 last, and behind its own flag.
- **The first production run** is greg's own family, from the button, with
  the dirty-peer scenario exercised on the test family first.
- **A device that cannot open the file at all has no unsynced edits** and
  simply adopts. The rebase risk is confined to devices that opened the file
  and edited offline.
- **Rebase granularity is fields, not ops.** A field the peer changed offline
  overwrites the same field in the compacted pod, even if someone else changed
  it after the peer's baseline. This is the same behaviour as every mainstream
  family app and far better than the dead end. Do not attempt op-level replay:
  the object ids do not exist in the new lineage.
- **Do not reuse `projectionDeltasBetween` by copy.** Extract its "touched
  entities between two heads" core into a shared function used by both.
- **`Automerge.stats` cost** must be measured before R3 reports it on every
  open; if it is not O(1)-ish on a 2M-op doc, compute it once per session.
- **A device that only ever opens from cache** still writes its `devices`
  record; the version is what matters, not whether it read Drive.
- **The `devices` record is a per-open write.** With the actor lease in place
  this is one small change per device per open, not a new lane. Without the
  lease it would be churn; the lease is a prerequisite.

## Assumptions

> Review before implementation.

1. `Automerge.diff` between two head sets on the local doc is cheap enough on
   a 2MB doc to run at adopt time (it already runs on every poll-merge).
2. `getOrCreateAppFolder` is the folder the pod lives in for every Drive
   family (verify against a family created by the join flow, not only by
   create-pod).
3. Owner OR admin may compact — confirmed by greg 2026-09-05.
4. 1MB / 5,000 changes / 30-day device window are starting values, read from
   constants in one file and all logged. `MIN_GUARD_VERSION` is the app
   version that ships Tier 2.

## Approach (files, by requirement)

**R1** — `src/services/automerge/worker/docOps.ts`: extract
`touchedEntitiesBetween(doc, from, to)` from `projectionDeltasBetween`; add
`rebaseOnto(compacted, local, baselineHeads)` (pure: returns the new doc and a
count). `applyAndProject.ts`: `adoptRemoteEnvelopeWithRebase(envelope,
baselineHeads)` = drop + adopt + rebase + persist. `remoteBaseline.ts` +
`worker/cache.ts`: baseline row carries `heads`. `podLineage.ts`: a fourth
action `rebase` replacing `block` for `adopt-remote × dirty` **only when the
caller can supply baseline heads**; otherwise `block` as today (the policy
table gains one cell change and one precondition, documented). The three
termini call one shared `adoptOrRebase()` in `syncService`. uiStrings:
`podRebase.toast` + `.toastOne`.

**R2** — `src/types/sync.ts` `StorageProvider.writeSibling?(name, content)` +
`listSiblings?(prefix)` + `deleteSibling?(id)`; Drive provider implements via
`createFile` / `listFilesInFolder` / `deleteFile` on the aux folder;
`usePodExport.ts` gains `writeSafetyCopy()` returning landed/unsupported/failed;
`usePodCompaction.ts` uses it, falling back to the export gate on
`unsupported`. uiStrings for the file name and the toast.

**R3** — `src/services/automerge/worker/applyAndProject.ts`: report
`{ payloadBytes, numChanges, numOps }` on open; `src/types/automerge.ts`
`devices` collection + migrate, written from the sync store after every open;
`src/composables/usePodHealth.ts` (due / soak status as computed state for the
Settings note and the button's refusal reasons); `SettingsPage.vue` the note +
scroll-and-highlight to the compaction row, gated on owner-or-admin;
`usePodCompaction.ts` gains the soak gate and the R2 safety-copy step;
constants in `src/constants/compaction.ts`.

## Files Affected

- `src/services/automerge/worker/docOps.ts`, `applyAndProject.ts`, `cache.ts`, `protocol.ts`, `docClient.ts`
- `src/services/sync/podLineage.ts`, `remoteBaseline.ts`, `syncService.ts`, `providers/googleDriveProvider.ts`
- `src/stores/syncStore.ts`
- `src/composables/usePodExport.ts`, `usePodCompaction.ts`, new `usePodHealth.ts`; `src/pages/SettingsPage.vue`
- `src/types/sync.ts`, `syncFileV4.ts`, `automerge.ts`; `src/constants/compaction.ts` (new)
- `src/services/translation/uiStrings.ts`
- `src/content/help/how-it-works.ts` (explainer)
- tests beside each, plus a multi-realm rebase test that drives two docs through the real adopt path

## Help Center Coverage

- **Action**: `new article` · **Category**: `how-it-works` · **Type**: `explainer`
- **Slug**: `why-your-family-file-gets-tidied` · **Title**: Why your family file gets tidied
- **Scope**: what the file keeps as history, why it grows, what "tidying" does, that it happens on its own, what the "before tidy" copy in Drive is, and what happens to changes made while offline (they are combined; if two people changed the same thing, the change made offline wins).
- **Notes**: name the safety-copy file; say it is safe to delete; say nothing is uploaded anywhere new.
- **Update**: `the-beanpod-file-explained` gains one paragraph linking to it.

## Observability Coverage

- `pod-rebase` (`logEvent` info / `reportError` warning): `action: 'rebased' | 'unavailable' | 'failed'`, `error_code` (why unavailable/failed), `detail` counts (entities, fields, deletes). A non-zero `failed` rate is the alarm that the field-level replay hit a shape it does not understand.
- `pod-safety-copy`: `action: 'written' | 'landed' | 'unsupported' | 'failed'`; `failed` at `error` severity, never critical (the compaction simply does not proceed).
- `pod-compaction`: existing events plus `action: 'due' | 'note-shown' | 'note-dismissed' | 'refused'` with `error_code` naming the refusal (`not-synced` / `devices-outdated` / `backup-not-delivered`), and `perf_doc_bytes` + `detail` carrying numChanges/numOps on every open so thresholds are tunable from CloudWatch.
- Success-path signal: `due` fires on every open of a due pod, so the fleet's compaction backlog is a countable number, and `refused: devices-outdated` counts the families still soaking.
- Critical: only the existing "publish failed after the lineage was stamped".
- No new context keys planned; if the device window needs one, add it to `ALLOWED_CONTEXT_KEYS` and the store declarations.

## Acceptance Criteria

- [ ] Dirty peer after a compaction: edits survive (created, edited fields, deleted) and publish on the next save; one toast; no block.
- [ ] Dirty peer with no baseline heads: today's block, `pod-rebase unavailable` logged.
- [ ] Safety copy lands in Drive and opens with the family password; older copies pruned to two.
- [ ] Local-file provider: manual export gate still used.
- [ ] A due pod shows the Settings note to owner/admin only; the link lands on and highlights the compaction row; dismissal lasts 30 days on that device.
- [ ] A device below the soak version makes the button refuse, naming the member; once it updates, the button proceeds.
- [ ] Nothing compacts without the click.
- [ ] Old build carrying the `devices` collection through a save untouched.
- [ ] Help article shipped; all events verified in CloudWatch from a dev run.
- [ ] Full suite green; every new guard mutation-checked.

## Testing Plan

1. Unit: `rebaseOnto` on fixtures (create/edit/delete/settings; unknown collection → null).
2. Worker integration: two docs, real `adoptRemoteEnvelopeWithRebase`, assert entities and heads.
3. Multi-realm on the test family (greg, two browsers): owner compacts from the note's link; clean peer adopts; dirty peer (DevTools offline, edit, online) rebases; same-profile second tab merges normally; a peer left on an old build makes the button refuse.
4. Tablet: open the compacted test pod on the A9+ and A7.
5. Production: off-platform backup; button-run; observe; automatic thereafter.

## Review Passes

- **Pass 1 (Initial draft)**: this document.
- **Pass 2 (DRY + error handling)**: pending
- **Pass 3 (Sustainability)**: pending
- **Pass 4 (Fresh-eyes sweep)**: pending

## Prompt Log

<details>
<summary>Full prompt history</summary>

See `docs/prompts/2026-09/2026-09-04-pod-load-oom.md`. Authorising prompts,
2026-09-05: "how can we ensure that users do not need special knowledge or take
special actions to compact their family files? … can compaction be something
that happens automatically when files reach a certain size?" and "the automated
plan sounds like a good approach and something i would like to deliver as part
of this work."

</details>
