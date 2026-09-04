---
date: 2026-09-04
category: accessibility
issue: null
plan: docs/plans/2026-09-04-dark-mode-remediation.md
tags: [dark-mode, accessibility, contrast, wcag, brand, cig, lint]
---

# Dark mode remediation

## Prompts

**~11:00** — "let's address the first piece of feedback from discord around dark mode."
Pasted the report from Brendan: dark mode makes text difficult to read, specifically the
recipe tab on both the app and the website; text is gray. Asked for a comprehensive,
holistic review of dark mode styles _taking screenshots and viewing them_, and a proposal
to improve look, feel and legibility while staying true to the theme and CIG. Extensions
to the CIG were explicitly welcome "as long as we stick with them consistently".

**~11:05** — "feel free to update the CIG itself to fix the rules if needed."

**~12:30** — "go ahead to implement as per your recommendation, once done run a
/code-review max across all surfaces as well as taking screenshots and viewing them to
ensure that everything implemented matches and is aligned with your mockup proposal and is
faithful to the mockup, and no new bugs or side effects were introduced. fix any issues
found."

## Outcome

Proposal published as an artifact (measured, with live before/after specimens), then
implemented in five steps. See `docs/plans/2026-09-04-dark-mode-remediation.md`.

`/code-review max` returned 15 findings; all were triaged and the real ones fixed,
including two regressions the review caught in my own work (a half-converted `:global`
selector that painted a cyan wash on `<html>`, and a `padding-right` that slipped into a
dark-only block and cost light mode its select-chevron gutter).

The most valuable finding came from neither the plan nor the review, but from reading a
screenshot: the fix appeared to do nothing on the nook, which led to discovering that
`:global(X) Y` had never worked anywhere in the codebase.
