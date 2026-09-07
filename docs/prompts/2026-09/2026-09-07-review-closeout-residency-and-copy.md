---
date: 2026-09-07
category: bugfix
issue: none
plan: docs/plans/2026-09-07-review-closeout-residency-and-copy.md
tags: [sync, automerge, cache, session, telemetry, copy, i18n, dry]
---

# Review close-out: residency, session identity, and copy that was not true

Continues `2026-09-07-cache-read-failure-and-provider-aware-restore.md`. A
`/code-review max` over that session's six commits returned fifteen findings, most
of them regressions those commits introduced. This file logs the prompts that
drove the close-out.

## Prompts

### 2026-09-07 — the report that started it

> i'm still actually seeing that when i load another family's data file, it loads
> a crippled pod (no sidebar, no permissions) - perhaps something went wrong in
> the implementaiton?
>
> given we've performed a bunch of fixes in these last few sessions, would you
> propose to run anotehr code review over those to find these and other issues?

### 2026-09-07 — plan, implement, review, fix

> go ahead to prepare the plan to fix all identified issues. once the plan is
> written, proceed to implement the plan. once the implementation is done, run a
> final code review against all implemented code to ensure it was implemented
> accurately and as designed against the plan and works as expected, tests are
> valid, and does not introduce any new bugs, side effects or security issues.
> fix all issues found.

### 2026-09-07 — parallel session

> note that i'm starting a parallel claude code session alongside this session to
> work on some of the other features such as recipe sharing and list duplication,
> ultimately we should merge these changes and deploy all together

Consequence for this work: every commit stages EXPLICIT paths, never `git add -A`,
and the final review is scoped to `cbb9a123..HEAD` rather than the working tree.
One test failure and two lint errors observed during the gates belong to the
parallel session's uncommitted list-duplication work and were left alone.

## Outcome

Five commits on `main`, one per plan step, each independently revertable:

- `e7d14661` — `CacheInitError` carries a `loss` verdict from the worker;
  `docClient` corroborates a refusal with `cacheProvenEmptyFor`.
- `37c23b1d` — identity bound before the roster loads; the two switched-family
  failure exits close their modal; the session-revoke race is ordered.
- `dc57f7a0` — `FlushOutcome`, the queued-write ordering, the queued create, the
  dev telemetry echo, the terminus label, the offline gate, the baseline
  round-trip.
- `652c7669` — the restore confirm, the publish-failure subtitle, `too-old` at
  both `payloadErrorKind` consumers, the empty-file arm, the comma-split names,
  and a `compaction.*` orphan sweep.
- `792738a3` — `useBlockerBanner`, `BannerActionButton`, `formatBytes`, the
  contradicting overlay copy, the picker teardown, two light-mode contrast fixes.

Three findings were closed WITHOUT a code change, each with the reasoning written
at the code rather than here: `commitRemoteBaseline`'s in-memory key (two review
rounds proposed opposite fixes; neither helps and the current behaviour is the
fail-safe direction), the progress-bar extraction (14 other components carry a
track+fill), and the `refuse('not-owner')` render-order finding (unreachable —
the whole card is gated on `isOwner`).

Gates: type-check, ESLint, stylelint, 6847 tests, production build — all green.
