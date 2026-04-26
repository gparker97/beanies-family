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

| Date       | Test                                                                                                                              | Category | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-25 | —                                                                                                                                 | —        | E2E suite overhauled: 87 → 21 tests, 15 → 7 files. Tracking begins.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-04-13 | OnboardingWizard overlay + 10 cascading webkit tests                                                                              | (a)      | Real Safari bug: `<Transition>` + `backdrop-filter: blur()` on the transitioning element stalls webkit's leave transition, leaving an invisible click-blocking overlay. Fixed in #153 by moving blur to `::before`. WebKit restored to main-branch CI.                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-04-13 | 10 webkit-only timeouts (stable-check + `/transactions` goto)                                                                     | (a)      | Vue modal enter transitions kept dialog buttons "unstable" on webkit, and `/transactions` page.goto hung on `load` event. Fixed in #156: reduced-motion rule also zeroes `transition-duration`, page-objects use `waitUntil: 'domcontentloaded'`, webkit project timeout set to 40s.                                                                                                                                                                                                                                                                                                                                                              |
| 2026-04-13 | 5 webkit tests on duplicate PR run (Add Account click, `/planner` goto internal error, Onboarding add-account waitFor, OK button) | (c)      | Parallel run on identical commit passed all tests. One run flaked under Linux-CI resource contention + one transient "WebKit encountered an internal error" browser crash on page.goto. Hardened: webkit timeout 40→60s and webkit retries 1→2 in #157.                                                                                                                                                                                                                                                                                                                                                                                           |
| 2026-04-16 | 3 chromium flakes (Account Institution Combobox, Loan/Activity recurring monthly fee, Dashboard net worth)                        | (c)      | Local run during the help-center consolidation PR. All 3 passed on retry with `--retries=2`. None touch `/help` routes; unrelated to the change. Flakiness likely from combobox open() timing + dashboard load timing. Watch for recurrence; if > 2 occurrences, consider hardening.                                                                                                                                                                                                                                                                                                                                                              |
| 2026-04-16 | 3 chromium flakes (Account Institution Combobox again, Loan/Activity recurring again, Google Drive Create Pod step 2)             | (c)      | Second local run during the stale-PWA reinstall modal PR. All 3 passed on retry. Combobox + recurring are now recurring flakes (2nd occurrence today) — should be hardened next. Google Drive step 2 is a known webkit flake from #165 that's now also flaked on chromium once.                                                                                                                                                                                                                                                                                                                                                                   |
| 2026-04-19 | invite-join "Invite flow: add member" (chromium + webkit)                                                                         | (b)      | Pod renamed: `/family` now redirects to `/pod`, and the "+ Add a Beanie" button was renamed to "Add Bean" as part of the Meet the Beans redesign. Test updated to navigate `/pod` directly and use a tolerant regex `/add (bean\|a beanie)/i` that covers both old and new labels.                                                                                                                                                                                                                                                                                                                                                                |
| 2026-04-19 | cross-entity "Onboarding wizard: complete all steps" (webkit only)                                                                | (c)      | WebKit-only timeout on `onboarding-add-account` testid after clicking `onboarding-start`. Chromium passes cleanly. No onboarding code changed between the last green run and this one — consistent with WebKit's slower timer handling under CI contention. Watching; will harden if recurring.                                                                                                                                                                                                                                                                                                                                                   |
| 2026-04-22 | cross-entity "Data integrity: add then remove linked payment" + "Activity with monthly fee" (webkit only)                         | (c)      | Hard-fail + 2 flakes on webkit CI. Trace showed "Add Activity" save click succeeded but the `[role="dialog"] >> button "OK"` locator timed out at 5s — CreatedConfirmModal rendered later than the tight window allowed. Hardened by extracting `dismissActivityCreatedConfirm` to `e2e/helpers/activity-modal.ts`: waits for the "Activity Created" heading (15s) first, then clicks OK. Also deduplicates the inline helper that was copied across planner.spec.ts and cross-entity.spec.ts.                                                                                                                                                    |
| 2026-04-23 | cross-entity "Onboarding wizard" + planner "Recurring: edit this and all future" / "edit all occurrences" (webkit only)           | (c)      | Recurring webkit flake hitting 4 of last 5 pushes. All three tests share the same pattern: modal-to-modal transitions with explicit `timeout: 5000` on `waitFor` / `toBeVisible`, overriding the 60s webkit project timeout. Chromium passes consistently. Hardened all the tight 5s timeouts → 15s in cross-entity.spec.ts (onboarding) and planner.spec.ts (`openEditModal` helper), matching the 15s pattern already standardised in `activity-modal.ts`. Onboarding flake is now at 2nd logged occurrence — if it recurs after this harden, revisit the underlying modal timing on webkit (possibly `<Transition>` `enter-active` durations). |

---

## Joiner onboarding hardening (#185) — manual cross-browser test matrix

Recorded as part of the rev-3 plan (`docs/plans/2026-04-26-joiner-onboarding-hardening-rev3.md`). Run after the joiner-flow refactor ships and before closing #185. Use a real invite URL generated from the Meet The Beans share modal (must include `t=`, `f=`/`fam=`, `p=google_drive`, `fileId=`, and ideally `hint=`). Each cell records a verdict:

- `works` — happy path completes through to pick-member + set-password.
- `works with caveat` — completes but with a noticeable hiccup (note the caveat).
- `needs different device` — the floor; user must complete first-load on another device, then iPhone works thereafter.
- `broken — bug filed` — link the issue.

### Phase 0.5 + Phase 4 verdict matrix

| Device / Browser             | Fresh first-load (cookies cleared) | Returning user (warm cookies) | Picker iframe error path | Wrong-account picked |
| ---------------------------- | ---------------------------------- | ----------------------------- | ------------------------ | -------------------- |
| iOS Safari (latest, regular) | _pending greg's iPhone_            | _pending_                     | _pending_                | _pending_            |
| iOS Safari (standalone PWA)  | _pending_                          | _pending_                     | _pending_                | _pending_            |
| iOS Chrome (regular)         | _pending_                          | _pending_                     | _pending_                | _pending_            |
| Android Chrome               | _pending_                          | _pending_                     | _pending_                | _pending_            |
| Android Chrome (standalone)  | _pending_                          | _pending_                     | _pending_                | _pending_            |
| Desktop Chrome               | _pending_                          | _pending_                     | _pending_                | _pending_            |
| Desktop Firefox              | _pending_                          | _pending_                     | _pending_                | _pending_            |
| Desktop Safari               | _pending_                          | _pending_                     | _pending_                | _pending_            |

Verdict notes go below the row. Phase 11 (iOS Storage Access workaround) only runs if iOS Safari standalone PWA still fails after Phase 0.5; document the result here whether kept or removed.

### Diagnostic snapshot pre-Phase-0.5 (greg, 2026-04-26)

Real invite URL on iPhone iOS 26.4.2 regular Safari, before the Phase 0.5 fix:

- Picker CTA tap → Google consent → 2FA → "Allow Google access to your necessary cookies" → user allows → "The API developer key is invalid." inside the popup/tab.
- iOS Chrome: same failure.
- "Block All Cookies" = OFF; Cross-Site Tracking Prevention = ON (default); Storage Access API = ON.
- The same flow had worked for greg's wife on iPhone 17 a few weeks prior, when iOS regular Safari was using popup-based OAuth (before the over-correction in commit `a8f1a24`).

Phase 0.5 reverts `shouldUseRedirectAuth()` so iOS regular Safari uses popup again. The matrix above captures whether that fix actually resolves the cookie/API-key chain on each combo.
