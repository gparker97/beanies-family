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
