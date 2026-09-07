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

### 2026-09-07 — closing out

> let me know the steps to follow to complete the testing. note that i've also
> added some capabilities to lists which are now also committed to main

> let's end this session and restart in the next session with the testing in a
> new context. note that i'm also creating a plan for recipe related changes,
> will commit and push those changes once the plans are done

## Acceptance run

⚠️ **Written to be run by a session that did NOT write this code**, which is why
it is here rather than only in a conversation. Deliberate: the context that made
the change is the worst one to judge whether it works.

### Before starting

```bash
git pull --ff-only && npm install && npm run dev
```

Start from a **reset dev family**. The tier-3 plan flagged greg's current one as
possibly contaminated by the earlier experiments, and a stale pod makes Part 2
ambiguous. Export a `.beanpod` first as a rollback point.

Two browser sessions on the desktop: **A** = normal window, **B** = a separate
profile (NOT incognito — it has to survive a reload). Keep `#beanies-errors`
visible; two steps assert it stays **quiet**.

### Part 1 — the lockout (the one that stranded greg)

1. Two tabs on the same app. Sign in as A, let the second tab load, then hard-reload
   the first. ✅ It opens. No full-screen error whose only button is Reload.
   ❌ If that overlay appears, capture the console line beginning
   `[syncStore] Refusing to adopt` — its `cacheErrorName` is the diagnosis.
2. Sign out in tab 2 while tab 1 is open, then reload tab 1. Same expectation.
   This is the variant that queues a cache delete behind a live connection.

### Part 2 — the offline drill (the data-loss path)

3. Take **B** offline (DevTools → Network → Offline). Add a to-do in B.
4. In **A**: Settings → Compact Family File.
   - ✅ Progress modal: four steps, current one spinning, **no close control while
     it runs**.
   - ✅ On success: old size → new size, and a **Done** button. It does not
     self-dismiss.
   - ✅ Anyone on an older build is listed BY NAME with what they must do. A member
     whose name contains a comma appears **once**.
5. Bring **B** online. ✅ B's offline to-do survives and reaches A.
   ✅ **Slack stays quiet** — an offline save being re-queued must not page. A
   `critical` here means the `'requeued'` split regressed.

### Part 3 — loading another family's file (the crippled pod)

6. Settings → Family Data → Load another Family Data File. Pick a `.beanpod` from a
   DIFFERENT family, enter its password.
   - ✅ Opens **with the sidebar and the Family Data section present**, no refresh.
     This is the defect greg reported twice.
   - ✅ If identity is ambiguous (a password opening two members' keys), the modal
     **closes** and the message survives — not a stuck dialog that says
     "No pending encrypted file" on retry.
7. Restore into your OWN family from a backup.
   - ✅ Two buttons (Drive / this device); the one pressed is the one that runs.
   - ✅ The confirmation is **red** and says the file wins where the two disagree.
     It must no longer claim "Nothing is deleted".
   - ✅ Afterwards the family is on the **same storage** as before. A Drive family
     must not silently become a local-file family.
8. Load a pre-4.0 `.beanpod`. ✅ It says the file is from a much OLDER beanies —
   not "damaged", not "update beanies".

### Part 4 — quick single checks

9. Sign-in screen → pick an empty or corrupt Drive file. ✅ It says something.
   Silence is the bug.
10. Switch to Chinese, open Settings → Compact. ✅ Nothing renders "beanies" as
    帽子 or 豆子.
11. Dark mode on the compaction modal. ✅ The struck-through old size and the
    "still to do" footnote are readable.

### Part 5 — lists (shipped from the parallel session, `f55921a4` + `68cae7c1`)

12. Copy and Delete sit on the list tile itself.
13. Copy → select two or more beans. ✅ One list per bean, all created, none
    half-done. Nothing ticked, no due dates carried over.
14. Copy a recurring list. ✅ The copy is recurring, cycle starts fresh.
15. ✅ No "it failed" toast after a copy that visibly succeeded.

### Then, before deploying

- Bump `APP_VERSION` **0.16 → 0.17** (NOT `0.16R1` — the store strips the `R` and
  Apple has taken 0.16).
- Leave `promptBelowVersion` at `0.16`; raise it in a later web deploy only once
  the new build is live on BOTH stores (runbook § 7).

### If a step fails

The `pod-open-degrade` CloudWatch event now carries a real `error_code` (a named
failure, not the anonymous `Error` that caused the lockout) and `detail` as
`<stage>/<verdict>` — which says exactly which arm the classifier took.
