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
