---
date: 2026-09-24
category: bugfix
issue: 'Notion #100 (migrated from GitHub #346)'
plan: 'docs/plans/2026-09-24-clear-data-signout-releases-cache-in-every-tab.md'
tags: [security, indexeddb, sign-out, multi-tab, cache, durability-banner]
---

# "Sign out and clear data" leaves the local cache behind when another tab is open

## Prompt 1 — 2026-09-24

> Once done, run /beanies-pre-plan and /beanies-plan on notion issue #100 - first, determine if this is truly a high priority security issue and if there is a clear fix. if so, then proceed with the planning, otherwise stop for my decision to implement or ignore. once planning is done do not proceed to implement yet.

## Prompt 2 — 2026-09-24

> Looks good and onk with the 5 sec cap. Go ahead to implement with /beanies-build-auto and only stop for a genuine blocker

## Prompt 3 — 2026-09-24

> regasrding the structural fit can you explain more clearly what you mean when you say 'make the refusal a per family set' - what refusal are you talking about? and when you say 'drop the flag' - what flag are you talking about?

## Prompt 4 — 2026-09-24

> yes go ahead with the structural fix

## Prompt 5 — 2026-09-24

> go with option 2, once done run /end-session to commit and push all changes

## Outcome

Assessed as a real High issue (the leftover cache is ciphertext with the key removed, but the other tab stayed signed in, the deletion is a stated promise, and every later open timed out) with a clear fix. Four-pass plan, then built: every tab answers `versionchange` by releasing the cache, the delete waits (5 s cap) and reports honestly at every call site, the evicted tab signs itself out, and the durability banner names the cause. Two review rounds found defects in round 1's fixes; a structural fix was built and reviewed; its worker-side "refuse to recreate" latch still did not hold, so greg chose option 2 and it was cut, leaving a logged, accepted limit. `validate` green (8658), browser-verified. Committed, not deployed. Full record in the plan's Outcome.
