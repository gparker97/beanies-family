---
date: 2026-09-25
category: feature
issue: 'None, direct implementation'
plan: 'docs/plans/2026-09-25-drawer-save-validation.md'
tags: [forms, validation, ux, drawers]
---

# Drawers: Save tells you what is missing

## Prompts

- **2026-09-25** "Let's make a quick fix to the activity drawer, and extending to other drawers as well as i believe it is a shared component. to improve UI for validation errors. ... 1) the submit button has an enabled style ... even when all required fields are not filled out ... 2) if required fields are missing and the user tries to submit, the UI should auto-scroll on tap to the missing required fields" (full text in the plan's Prompt Log)
- **2026-09-25** "sounds good i'm ok with teh direction and your proposed scope and proposal to bring this into one shared composable for every drawer, please build directly with /beanies-build-auto"
- **2026-09-25** "once done run /end-session"

## Outcome

One shared `useFormValidation` composable across eleven drawers. Save looks not-ready until required fields are filled and stays tappable; a tap while incomplete marks every missing field, scrolls to and pulses the first, and toasts what is still needed. Browser-verified at 360px and desktop (dark verified by forcing the theme class). Two `/code-review high` rounds; 12 findings fixed, 1 cosmetic finding not fixed. Committed at end of session, not deployed.
