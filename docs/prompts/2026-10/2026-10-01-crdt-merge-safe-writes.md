---
date: 2026-10-01
category: bug
issue: Notion #117
plan: docs/plans/2026-10-01-crdt-merge-safe-writes.md
tags: [automerge, crdt, merge, data-loss, worker]
---

# Concurrent edits survive the CRDT merge (#117)

## Prompts

**14:40** — "Ok - let's move forward with item #117 with /beanies-plan and then /beanies-build-auto"

**14:55** — "let's implement the same way we implemented #95 in-app pricing - the fable model acts as the planner and overall coordinator and starts agents as necessary with the appropriate models to save tokens where possible (opus, etc) and oversees the overall implementation"

**15:50** — (plan approved via ExitPlanMode) "implement with /beanies-build-auto"

**20:05** — "once the reviews are done and all fixes are done, pls perform testing yourself to the extent possible you can test and validate these new data related changes, as it is hard to test these issues in real life as it's hard to generate the conditions that these fixes are aiming to fix i think. is it possible to test these yourself, and then let me know anything i can do myself to ensure the testing did not revert anything or cause new bugs or side effects"

**22:00** — "ok let's deploy to prod with /deploy-prod-auto, release note but NO spotlight,do not auto-open the drawer, both apps to production, ios autorelease, increment minor version to 0.90.0. ensure all CI runs successfully (seems main CI might be failing). once done run /end-session"

## Outcome

Deployed as 0.90.0 (web `483513a9`, Android production, iOS submitted auto-release). Phase 1 built, reviewed twice and verified the same day: nine commits `328599a3`..`6988ce63` on `main`, not deployed. Full record in the plan's Outcome section (`docs/plans/2026-10-01-crdt-merge-safe-writes.md`). Phase 2 (Automerge Counters) is still to plan.
