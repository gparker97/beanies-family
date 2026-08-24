---
date: 2026-08-24
category: bug
issue: Notion tracker #69
plan: docs/plans/2026-08-24-refresh-read-freshness-honest-feedback.md
tags: [sync, auth, observability, refresh, scope-cut]
---

# Notion #69 — honest manual-refresh feedback (read-freshness cut)

## Prompts

**~13:20 —** `/beanies-pre-plan 69 let's plan and implement #69 once pre-plan is done move on to /beanies-plan`

**~13:35 —** (scope decision, via question) When the trace showed #69's reported symptom — a false "your beans are fresh" toast on a dead-token refresh — was **already fixed** (shipped 2026-05-03, `e74f6b5d`, three months before the issue was filed) and the real gap was the _absent failure branch_ in `handleRefreshAll`, greg chose: **"Reframe around read-freshness"** — treat "when did we last successfully READ from Drive" as first-class state, surface it app-wide, drive both the toast and a staleness badge from it.

**~13:50 —** "once plan is complete move direct to implementation. once implementation is complete run a /code-review max on the implemented code"

**~15:05 —** (after review round 1, 15 findings) "Redesign per my recommendation" — drop the custom toasts and lean on the already-mounted `BackgroundSyncBar`, make freshness robust across the poll/reconnect/join paths, `decrypt → stale`.

**~16:20 / ~16:40 —** "run the code review once more" (×2; several attempts failed on transient API 529s)

**~17:00 —** (after review round 3) "let's do (1) and let me know what command to run to remove the untracked file(s)" — i.e. **revert the read-freshness half, ship the refresh-honesty half**.

**~17:05 —** "deleted the test file, go ahead and commit"

## Outcome

**Scope cut.** Three `/code-review max` rounds (15 → 19 → 15 findings) established that the read-freshness half did not deliver its guarantee and was not converging; greg cut it. Full detail, including the six hard-won constraints for anyone who picks read-freshness up again, is in the plan's `## OUTCOME` section.

**Shipped:** `backgroundSyncFromFile` returns a `RefreshOutcome` and owns the manual-refresh telemetry (MVO); `AppHeader` presents it via a pure `presentRefreshOutcome` (success confirms · auth warns · network/decrypt defer to `BackgroundSyncBar` · in-flight stays silent rather than claiming success); auth-masked-404 classified from `loadResult.reason`; read-error state cleared on disconnect/reset.

**Reverted:** `lastSuccessfulRead`, `dataFreshness`, `markDriveReadSuccess`, all poll-path marking, the `SaveStatusIndicator` freshness UI, the help-doc rewrite, and the `immediate` escalation mode.

**Notable process lessons**

- The tracker row was **stale at filing** — the reported symptom had been fixed months earlier. Tracing the actual current behaviour before planning changed the whole shape of the work, and should be the default for any bug report older than a few weeks.
- I twice introduced regressions the reviews caught: raising the reconnect banner from the view suppressed a `severity: 'critical'` Slack page (it tripped `scheduleColdStartReconnectEscalation`'s guard), and the passive-staleness branch keyed on a reason string that the primary failure mode never produces — evidence I had _already read_ and failed to connect.
- Green tests meant little: they asserted a computed's ternary by assigning its own inputs, so they'd have passed if every failure returned `'refreshed'`. Tests must drive the real function.
- Review subagents wrote into the working tree **and committed** (`a471acd4`, `fba6cf4e`) plus left a stray `.tw-check.mjs`. Check `git status` and `git log origin/main..HEAD` before committing after a review run.
