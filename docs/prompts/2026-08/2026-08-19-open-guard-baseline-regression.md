---
date: 2026-08-19
category: bug-fix / performance
issue: Notion tracker #65 (validation), #61 (the win it regressed)
plan: none — diagnosis from prod telemetry, direct implementation
tags: [open-cycle, sync, cloudwatch, telemetry, automerge, regression, '#61', '#65']
---

# 2026-08-19 — #65 regressed #61's open-read skip (open-guard baseline never recorded)

## Prompt 1 (via /good-morning)

> capture #61 after numbers now

## Prompt 2

> ok go ahead

(In response to an offer of: (a) find which terminus drops the fingerprint, (b) write the capture into `PERFORMANCE.md` / `STATUS.md`, or (c) both.)

## Prompt 3

> if you feel it's safe then go ahead and implement

## Prompt 4

> commit the change

## Outcome

**Two stale STATUS claims corrected first.** #65 was recorded as "NOT deployed" — it was live (the 08-18 deploy ran `70f03983`, which has `46f1c79a` as an ancestor). `PERFORMANCE.md` §10's after-column was recorded as empty — it had been filled in `025e0c67`. Steps 1-2 of the saved validation plan were therefore already done.

**Validation returned the BAD case.** CloudWatch `open-cycle`, 2026-08-17 00:00Z → 2026-08-19, n=24 across R8/R9/R10: zero `unchanged-revision-in-window` on R10 (R9 had 3 at `rec=1 reads=0 writes=0`), and `baseline-heads-unknown` on the same client 19.4h apart (03:23:17, 03:23:19, 22:46:55) rather than decaying within the hour as the one-shot upgrade cohort is specified to.

**Root cause.** `merging = !!options.merge`, and every cold-open/sign-in call site (`App.vue:527`, `LoadPodView.vue:295`, `LoginPage.vue:341`/`:478`, `syncStore.ts:579`) calls `loadFromFile()` with no options — only the poll paths pass `{ merge: true }`. So every cold open took the replace branch, which left `driveHeads = null`, and terminus 1 committed `commitRemoteBaseline(null)`. Since the commit is last-write-wins (C10b), it also clobbered the good fingerprint `doSave`'s terminus 3 had recorded, so the skip could never fire on the open path. #61's win was inert in production from the R10 deploy onward.

The branch's justifying comment ("our doc is knowably AHEAD of Drive, so no fingerprint may be claimed") was itself the defect: the fingerprint records what **Drive** holds, and being ahead is what #65's own `unpushedLocalChangesCheck` already reports as `unpushed-local-changes`.

**Fix.** `replaceDocWithCacheRecovery` returns the `remoteHeads` it was already computing and discarding; terminus 1 commits it on both branches. Safe because `remoteHeads` is captured in the worker from the unmigrated decrypted remote (documented there as the only value recordable as the Drive baseline), the revision it pairs with is sampled strictly before the download (a peer write in the gap advances the revision → next open reads), and a doc ahead of Drive is caught by the strict-inequality `hasUnpushedChanges`.

**Verification.** New `src/stores/__tests__/syncStore.openBaselineTerminus.test.ts` (4 cases) asserts the ARGUMENT rather than the call — the old code did call `commitRemoteBaseline`, just with `null`, so a call-count assertion would have passed throughout the regression. Confirmed RED against the old code with exactly the diagnosed value, green after. Full suite 4456 green; type-check + lint 0 errors.

**Left open:** the R10 `unpushed-local-changes` event reporting `writes=0` (unexplained); the tokenless `open-cycle` emission gap (deferred per the original #65 decision). **The fix is unvalidated in prod** — needs a deploy, then a re-run of the same query 24h later confirming organic `unchanged-revision-in-window` at `rec=1 reads=0`.
