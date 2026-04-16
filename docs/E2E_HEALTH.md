# E2E Health Log

Track E2E test failures to measure signal-to-noise ratio. See `docs/adr/007-testing-strategy.md` for the full E2E testing strategy.

## How to Log

After each CI E2E failure, add a row:

- **(a) Bug caught** — real code defect discovered by E2E
- **(b) Intentional change** — test updated to match new app behavior
- **(c) Flake** — passed on retry, no code change needed

## Targets

- **Signal-to-noise ratio (a / b):** > 2.0
- **Review frequency:** Quarterly
- **Cull threshold:** Any test logged as (b) or (c) more than twice should be rewritten or removed

## Log

| Date       | Test                                                                                                                              | Category | Notes                                                                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-03-25 | —                                                                                                                                 | —        | E2E suite overhauled: 87 → 21 tests, 15 → 7 files. Tracking begins.                                                                                                                                                                                                                  |
| 2026-04-13 | OnboardingWizard overlay + 10 cascading webkit tests                                                                              | (a)      | Real Safari bug: `<Transition>` + `backdrop-filter: blur()` on the transitioning element stalls webkit's leave transition, leaving an invisible click-blocking overlay. Fixed in #153 by moving blur to `::before`. WebKit restored to main-branch CI.                               |
| 2026-04-13 | 10 webkit-only timeouts (stable-check + `/transactions` goto)                                                                     | (a)      | Vue modal enter transitions kept dialog buttons "unstable" on webkit, and `/transactions` page.goto hung on `load` event. Fixed in #156: reduced-motion rule also zeroes `transition-duration`, page-objects use `waitUntil: 'domcontentloaded'`, webkit project timeout set to 40s. |
| 2026-04-13 | 5 webkit tests on duplicate PR run (Add Account click, `/planner` goto internal error, Onboarding add-account waitFor, OK button) | (c)      | Parallel run on identical commit passed all tests. One run flaked under Linux-CI resource contention + one transient "WebKit encountered an internal error" browser crash on page.goto. Hardened: webkit timeout 40→60s and webkit retries 1→2 in #157.                              |
| 2026-04-16 | 3 chromium flakes (Account Institution Combobox, Loan/Activity recurring monthly fee, Dashboard net worth)                        | (c)      | Local run during the help-center consolidation PR. All 3 passed on retry with `--retries=2`. None touch `/help` routes; unrelated to the change. Flakiness likely from combobox open() timing + dashboard load timing. Watch for recurrence; if > 2 occurrences, consider hardening. |
