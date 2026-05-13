---
date: 2026-05-13
category: bug
issue: 213
plan: docs/plans/2026-05-13-onboarding-iphone-drive-hardening.md
tags: [onboarding, oauth, ios, google-drive, error-reporting, recovery, adr-026]
---

# Onboarding hardening — iPhone Drive 400, zombie state, Slack error reporting

## Prompts

**[~10:50]** (paraphrase) There's a user (Shaun, Hong Kong) trying to create a pod on iPhone who ran into errors. We absolutely need to understand and nail down these iPhone pod-creation issues — the app can NEVER load into a bad/inconsistent state (no data file, no family members). Suspect the last few people who reached out were also iPhones (onboarding "started", pod never created). Confirmed personally that selecting "local file" never sends the "family pod created" Slack message — fix so ANY pod creation (incl. local) triggers it. Shaun got a Google 400 ("The server cannot process the request because it is malformed. It should not be retried") while connecting Drive. Screenshots in `/tmp/shaun-onboarding-errors/` (google chooser, the 400, /nook with no members, settings with no data file). Several issues to fix together: (1) no Slack errors triggered despite the failures — ALL onboarding errors (esp. Drive connect / file create) must always page `#beanies-errors`; (2) the app must never ignore errors and drop the user into the app in a broken state — not being able to create a data file is fatal, no "continue" option — retry until successful / gather+send diagnostics / show troubleshooting / anything except pretend it worked; (3) nail down the iPhone errors — clear honest error message + multiple defense-in-depth fallbacks — understand why it works on some iPhones not others, and capture that as memories. Perform a full, complete, comprehensive, holistic review across the FULL codebase (all family-creation/setup/onboarding paths), trace all paths, propose solid/robust/sustainable/maintainable fixes.

**[plan-mode]** (clarifying-question answers) iOS OAuth fix: "Redirect-auth for ALL iOS" (re-validate the old Picker concern separately). Zombie state: "Both" (recovery screen + route guard _and_ the durable invariant).

**[plan-mode, after first draft]** Review again: simplest/most-efficient/optimized, no duplication, no silent failures, no code bloat. Check existing helpers/components/composables — refactor into a generic item now rather than duplicate later. Users shown informative error messages with dev guidance; nothing fails silently; guidance on how to fix always available.

**[plan-mode, after second draft]** Review again with a focus on long-term sustainability/maintainability/reliability — strong coding practices, avoid overly complex/hard-to-support structures, deep nesting, overly coupled structures.

(Plan approved on the third draft.)

## Outcome

Implemented on `main` (commit on 2026-05-13; **not deployed** — awaiting greg's iOS device smoke test). `npm run validate` green. Issue #213. ADR-026. Full details in the plan + ADR + STATUS.md. Key shape: `shouldUseRedirectAuth()` true for all iOS WebKit; new `src/services/sync/connectStorage.ts` (shared by the create-pod wizard + the new `ResumePodSetup.vue` recovery screen); `authStore.podCreated` persisted invariant gating `requiresAuth` routes; `🎉 pod created` ping moved into `syncStore.createNewFile()`; `withTimeout` util on `waitForAuthCode`; every onboarding/auth/Drive failure now `reportError`s; `features.ts` warns in prod if the error webhook is unset. Follow-ups: verify the `BEANIES_ERROR_WEBHOOK_URL` repo variable; wire the Drive-migration-on-iOS path; re-validate the Google Picker on iOS under redirect-auth; `npm run translate` for the new zh strings.
