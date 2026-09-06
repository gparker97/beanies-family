---
date: 2026-09-04
category: bug
issue: Notion #90
plan: docs/plans/2026-09-04-pod-load-oom-tier1.md
tags: [automerge, memory, android, tablet, error-handling, observability]
---

# Pod load runs out of memory on a 3GB tablet

## Prompts

**2026-09-04, ~10:40** (after the 0.16 deploy)

> One more issue i'd like to investigate and fix (hopefully) before doing a push
> of all work done today (in both sessions): I tried installing the android app
> and opening beanies.family on my son's android tablet... a picture of the issue
> is in google drive Projects/beanies.family/temp/android-tablet-memory-error.jpg
> ... Can you investigate and determine if we can optimize or make this process
> more efficient in any way so that we use minimal resources/mem in general so we
> don't run into issues on older hardware or tablets.

**Follow-ups** — device details: `Galaxy Tab A9+ SM-X210`, then `Galaxy Tab A7
SM-T500`.

> I would like to do a full investigation to see if there is any way we can
> improve or optimize this process to ensure that we do not hit this or other
> errors when decrypting or loading the pod on older hardware... The idea is that
> older / used tablets can be used for the beanie wall, so to be able to deliver
> on that promise the app should be usable on these tablets.

> i believe we may also have an existing issue in the issue tracker on notion
> related to compaction - can you pls check the issue tracker, compare it with
> your investigation if it exists, and merge the items and actions required

Scope answers (via the pre-plan): **Tier 1 only** for now; floor is a **3GB
Android tablet**; on failure show an **honest error plus a recovery action**;
gate **Tier 2** behind a flag.

> once the plan is done begin implementation. once done run a /code-review max
> against all code to ensure it runs as designed against the plan and does not
> introduce new bugs, side effects, or security issues

**2026-09-04, ~23:00** (before sleeping, authorising autonomous work)

> once the code review fixes are complete then run one more code review against
> those changes just to provide extra safety... once that is compelte, move
> directly into /beanies-plan for the tier 2 changes as per the results of the
> script... once the plan is done, move direct to implementation, and once
> complete run a /code-review max against the implementation once more, and fix
> any issues found. If there were multiple issues found, run another /code-review
> against those changes, and repeat until you have full confidence...

**2026-09-05, ~00:00**

> Would it help that I've exported an encrypted backup of my main test family
> file to the tmp dir as well, for which you can run the test yourself at any
> time? The password is 'testtest'

## Outcome

Tier 1 shipped to `main` (not deployed) across eight commits. The failure is now
classified (`PayloadTooLargeError` vs `CorruptPayloadError`, by step),
non-destructive, and honest on every entry path. Four review rounds were needed:
the classification was right in the worker from the first cut, and the work was
getting it OUT — eight separate catch blocks flattened it on the way, two of them
destructively.

Measured on greg's test pod: compaction takes it 2.06MB → 0.17MB, load 3,167ms →
314ms, and document-attributable RSS **334MB → 52MB**. That is the Tier 2 case.

Also established, and it reshapes Tier 2: a compacted pod merged into a peer that
still holds the original history destroys that peer's unsynced changes 200/200
times. Compaction must be a coordinated migration with an epoch marker, not a
background optimisation.

### 2026-09-05 (Fable 5.1 premise audit + fix)

**~11:30** — "i've updated the model to fable - please review the full context and run a /code-review max against all code implemented, pay particular attention to the code review angle and parameters proposed earlier by the opus model … In addition, given the serious and risky nature of this change, perform a general review of the plan, test results, and overall implementation to ensure it works as designed and as expected, and does not introduce any issues with existing users or backwards compatibility, and achieves the ultimate goal of being able to open on an older tablet (i.e. galaxy a7+) without hitting memory or other issues, and does not introduce any new bugs or side effects or security issues."

**~12:20** — "go ahead and implement the fix once the review lands"

Outcome: premise audit reproduced compaction (2.06→0.17MB, 329→51MB) and the
merge-loss coin flip (50.3%); found Phase A's shared-actor collision across
tabs (Automerge `duplicate seq` → `doSave` overwrote the remote). Fixed with
the device-actor lease + `RemoteMergeError`; see
`docs/plans/2026-09-05-device-actor-lease.md`.

### 2026-09-06 (Tier 3 Stage 1 — the lineage moves into the document)

**~09:10** — "ok let's redo the tier 3 plan with this design change"

**~09:40** — "once the plan is complete and verified, proceed to implementation
directly and implement carefully and deliberately. once complete, run a
/code-review max across the full implementation … one other thing regarding the
design of the compaction button - 'slim down pod' seems to understate the
importance and also riskiness of this feature … label it clearly, put the
compaction setting in it's own section and provide a clear warning around it to
only hit this button if you are experiencing performance or memory issues
loading the pod … to ensure it cannot be activated by accident … once tier 3 is
done there should not be any action required from the user after the compaction
is done, but to be sure, let the user know if anything needs to be done after
running compaction."

**~10:05** — "go ahead and implement stage 1"

**~11:15** — "one thing i wanted to add is that when any system hits an OOM error
and gets the error message i got on the android tablet, one of the recovery
options they are presented with is to compact their data file. it's still a
manual trigger, but it's presented at exactly the time the family needs it. can
this be added to the error modal?"

**~12:00** — "finish the rest of stage 1"

**~13:10** — "push it and run the code review"

**~14:00** — "fix any issues found"

**~14:20** — "note that you can increase the number of fan out reviewers if
needed for completeness or to perform a proper investigation … please ensure you
perform a full and complete review and investigation. if you feel fable would be
beneficial at any point then we can run a limited review"

**~14:40** — "Confirm all findings and if fully validated then go ahead to fix
directly and run one more review over the newly implemented fixes"

Outcome: Stage 1 shipped in two commits. The root cause of the field failure was
that `podLineage` lived on the ENVELOPE, which is maintained on three tracks
independent of the document (the store's copy, the service's copy, the worker's
envelope cache), so a device could hold the compacted file's stamp over a
pre-compaction document and the guard read `same`. The lineage now lives in the
document (ADR-036) and the comparison runs in the worker, the only place both
documents exist.

Review round 1 returned 27 findings; all were confirmed against the code and
fixed. The four that mattered:

- a `no-local-document` basis was being re-derived from `!currentDoc`, so a
  respawn (which rehydrates a document) turned the instruction into a merge — an
  A∪B document persisted to the wrong family's cache and uploaded to the wrong
  family's file;
- the POLICY table's `user-file` column had **zero producers**, so the rollback
  route it exists to keep open resolved to `publish-local` and wrote the
  compacted document back over the pre-compaction file the user had just chosen;
- the banner's prescribed recovery ("export, then reload") could never clear the
  block, because a reload re-opens the same cached document against the same
  baseline and the save path refuses on any blocker by design;
- files compacted by the Tier-2 code carry their stamp only on the retired
  envelope field, so post-Stage-1 they read as never-compacted. The worker now
  reads that field for the REMOTE side only (sound, because envelope and payload
  are bytes from one blob) and writes it into the document as it adopts, so the
  reader extinguishes itself after one sync per family.

### 2026-09-06 (Stage 1 review, round 2)

**~15:10** — "agreed to remove the legacy reader if that is yor suggestion, but
lets wait until all agents and reviews come back, comprehensively validate all
findings, and then determine the best approach for the fixes and go ahead to
implement"

**~15:40** — "proceed with the comprehensive validation and fixes once the test
auditor finishes"

Round 2 ran six parallel reviewers over `25e2fc73` (legacy reader, the
`user-file` one-shot, key threading + save arming, UI/brand, test quality,
backwards compat + security). Every finding was validated against the code
before any fix. **Four of round 1's own fixes were defects:**

1. **The legacy-envelope reader is REMOVED.** It read the retired stamp for the
   REMOTE side only; the local side has no sound equivalent (our envelope copy
   drifts from our document — that drift IS ADR-036), so
   `compareLineage(legacy, null)` answers `adopt-remote` even when the truth is
   `same`. The device that RAN the compaction therefore blocked on its own file,
   and the block's only recovery ADOPTS — destroying real same-lineage edits a
   plain merge would have kept. Strictly worse than reading nothing.
2. **The `user-file` arm is removed from `rebindPodFile`.** Round 1 fixed "zero
   producers" by reaching for the nearest plausible call site. `rebindPodFile`
   is the shared access repair for four `POD_ACCESS_ERRORS` codes plus the
   save-failure banner; `user-file` never blocks and `adopt` replaces the local
   document wholesale, so a canonical-mismatch repair would have silently
   discarded work living only in the private copy.
3. **The banner recovery had no `catch`** around a `loadFromFile` that throws by
   design, after the latch had already been cleared — banner gone, no toast,
   nothing reported. It also left the poller stopped on success and raced a
   debounced save.
4. **`ResumePodSetup` never got the `lineage-blocked` case** and had no
   `default`, so the resume screen came back as a blank password form — the one
   surface where the banner cannot render.

Test audit: three of round 1's new tests could not fail for the reasons they
stated, the mounted banner rewrite had lost two assertions the grep version
carried, and eleven behaviours had no test at all — including both `user-file`
producers, which could be deleted outright with 875 tests green. Fixed, and every
fix mutation-checked. Two of my own new tests were wrong on the first attempt
(the watcher is not `immediate`, and the re-entrancy guard was claimed after an
await) — both caught by mutation, and the second one was a real component bug.

Raised for greg rather than changed: `ErrorBanner`'s white-on-Heritage-Orange
title is 3.32:1 and no ink fixes it (the ground is too light; `primary-700` gives
5.81:1, across four banners); `flags.ts` reads the localStorage override before
the prod gate, so `podCompaction` is enable-able on production.
