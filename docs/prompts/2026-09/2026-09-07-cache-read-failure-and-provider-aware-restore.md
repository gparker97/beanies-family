---
date: 2026-09-07
category: bug
issue: none
plan: docs/plans/2026-09-07-cache-read-failure-and-provider-aware-restore.md
tags: [sync, compaction, data-loss, lineage, restore, drive, observability]
---

# A failed read is not an empty device, and a restore is not a move

Two defects found during the compaction acceptance drill, fixed as one plan
because the v5 plan already recorded where they meet: _"a restore from a device
with NO local document reaches `no-local-document` before the guard, mints
nothing, and silently returns the family to 4.0."_

## Prompts

### 13:0x — running the drill

> Ok - let's run the compaction test now, pls list the steps

### 13:1x — the exported pod

> ok - note i've exported the current pod file to /tmp/gp-test-family-v3.beanpod - note that this is after compaction that took place already in the previous testing session

### 13:2x — the field report

> sorry, i meant to type v2, which is the pre-compacted version of the gp dev fam beanpod file. v3 is on my other computer (which i'm using to ssh to my desktop now). I've done most of the testing already, the main issue i'm seeing is that in drill 1, after i brought session B back online, the todo item i had created in session B while offline was deleted (which seems to match what you were expecting - session B was rebased) - but given that, of course that item did not move to session A as it had already been overwritten by the remote beanpod. i was also not able to confirm an orange banner on session B after going back online - it came back online, the offline todo item disappeared once it synced with the remote beanpod, and from what i could tell the offline entry was not merged with the beanpod
>
> one other issue i'm seeing is that it seems loading anotehr family data file still just opens a file picker - i thought that the whole point of the plan we just wrote and implemented was to fix that surface so that loading another family file can be from the storage provider (i.e. google drive), since now, loading another family data file just moves the family to local file. did i misunderstand the purpose of the previous plan and impelemntation?

### 13:3x — it worked earlier

> What's interesting is in the compaction testing just this morning this functionality worked perfectly - i added a todo while offline in session B, ran compaction on session A, and when session B came online the change in session B propogated to session A with no issues. Perhaps something just implemented broke that? the only difference is that previously i was testing on my desktop and now i'm on my laptop

### 13:4x — the variable that mattered

> note that i'm running the code on my desktop in both cases. previously i was working directly on my desktop, and now i'm working on a port-forwarded session from my laptop. i did the testing on my laptop before 9am, before we started the new plan and implemented these changes. A and B were both always on the same machine

### 13:5x — the plan request

> Ok - let's put this fix through /beanies-plan and at the same time plan and implement the fi to the 'load another family data file' option - the recovery method. these are both required for us to go live, and given the research done in the previous plan to understand the surface hopefully we can tackle both and complete them in this plan. moving to another data file should respect the storage provider (either local file or google drive) and other devices on the same family should not be abandoned. switching to a backup file makes the change across the whole family, which should be straightforward given that every family member and device should check the registry to see which data file they should be pointing to. perhaps the only change or fix required is that for family members currently logged in, they may need to logout/login to move to the new data file, or perhaps they are already checking the registry periodically and could load the new data if the file changes (maybe with a prompt) - will leave it to you to determine the best way to handle this

### 14:0x — implement + review

> Once the planning is complete please go ahead to carefully implement completed against the plan covering all surfaces, once done run a /code-review max against the code implemented to ensure it was compelte and accurate and works as expected and as per plan, and does not introduce any new bugs, side effects, or security issues. fix any issues found by the code review.
>
> once done print the steps for testing once more

## Outcome

Implemented as planned, with one deliberate departure from greg's stated design
and one correction to an earlier claim of mine.

**The departure.** greg described pointing the whole family at the backup file
via the registry pointer. The plan does NOT do that: `rebindPodFile` already
refuses a file matching `isSafetyCopyName`, because pointing a family at its own
backup is the ADR-033 fork that refusal exists to prevent. Instead the picked
file's CONTENT is installed and published back to the family's existing pod —
provider, `fileId` and registry pointer all unchanged — and peers converge
through the lineage generation the restore already stamps. greg's registry
instinct became the safety net (a diagnostic provider-mismatch event), not the
mechanism.

**The correction.** I told greg the lineage banner had no render site during
login/resume. That was wrong: `surfaceLineageFatal` → `FatalErrorOverlay` sits
outside `showLayout` and was already wired at three sites. The real gap was that
the routing was `instanceof`, class by class, at those three sites.

**The pattern worth recording.** Every one of the four plan passes produced a
refusal that could not render, by a different door — a dead `v-if` (fixed
yesterday in `564b0662`), a non-latching blocker, and finally a SECOND copy of
the kind ternary in `mirrorServiceLatch` that the 10s poll runs immediately after
`notePodUnopenable`. The structural answer was to collapse the three refs onto
ONE writer (`describeBlockerOnBar`) so the duplication cannot recur, rather than
to test that two copies agree.

**Mutation verification.** Eight mutations run, all caught — including one that
was NOT caught on the first attempt: the family-change clear for
`rehydrateFailed` was driven through `initAndLoadCache`, which clears the flag
itself, so the test passed with the clear deleted. Re-pointed at `openCache`,
which is a plain `setCurrentFamily` writer.
