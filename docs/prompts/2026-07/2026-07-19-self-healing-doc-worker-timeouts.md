---
date: 2026-07-19
category: bug-fix / reliability
issue: none — direct implementation
plan: docs/plans/2026-07-19-self-healing-doc-worker-timeouts.md
tags: [doc-worker, telemetry, error-review, self-healing, toasts, slack-paging]
---

# 2026-07-19 — Self-healing doc-worker timeouts

## Prompt 1 (via /error-review, ~09:00)

> I've been getting these errors across all app surfaces regularly over the past few days. they don't appear to impact the app but I'm not sure if data integrity or saving is impacted. i can also see these toasts being shown to users, but usually i can close it and do not see any impact. can you do a comprehensive dig into these errors to see if there is any actual issue and propose a fix if so? it is very distracting to see toast errors if thee is no recovery path or actual impact to the user, and degrades confidence
>
> [six #beanies-errors alerts from 2026-07-18: `doc-worker 'flush'/'initAndLoadCache'/'exportEncryptedPayload' timed out` (Windows Chrome, Android Chrome PWA, Pixel 10 Pro native WebView) + two `save-failure-banner` criticals]

## Prompt 2 (via /beanies-plan)

> yes please plan this change. the goal is to self-heal these issues as much as possible. only show an error toast to the user on a genuine, fatal, unrecoverable error that impacts data integrity, with an error path (i.e. reconnect data file). otherwise self-heal, log an error if needed to cloudwatch, but do not bother the user.

## Prompt 3

> approve pls implement

## Outcome

Triage verdict: GENUINE (UX/classification defect, no data-integrity impact) — wall-clock RPC deadlines counted suspended/background time, false-declaring a healthy worker dead on resume; every doc-worker toast paged Slack `critical`. Implemented per the 4-pass plan: suspension-aware deadlines (`wasHiddenSince` on the existing `visibilityTracker`, hidden-exempt re-arms, 3-extension visible cap, 10-min absolute ceiling), probe-alive transparent retry, wait-behind-heavy extension with the spare-the-worker backstop retained, single `notifyFailure` toast-vs-firehose policy (toast only when `mutate`/`initDoc` implicated, never paging, i18n'd via relocated `tr()`), bootstrap flush rejection dedup. `save-failure-banner` remains the single paging escalation. Full suite 3906 green, type-check/lint/build/translate clean.
