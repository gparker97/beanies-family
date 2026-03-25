# Plan: E2E Test Strategy Overhaul

> Date: 2026-03-25
> Related: ADR-007, playwright.config.ts, .github/workflows/main-ci.yml

## Context

The E2E suite has grown to 87 tests across 15 files, taking 10+ minutes per CI run across 2 browsers. Most failures are caused by intentional UI changes requiring test updates, not actual bugs. Many tests check low-value things (UI toggles, navigation links, mock infrastructure) that unit/integration tests handle cheaper. The suite needs to be ruthlessly pruned to only cover critical user journeys.

## The Three-Gate Filter

Every E2E test must pass **all three gates** to exist:

1. **Business-critical outcome** — Would a real user be blocked, lose data, or hit a broken workflow if this broke in production?
2. **Full-stack integration required** — Does it cross multiple layers (UI + store + CRDT/IndexedDB + routing) in a way a Vitest unit test cannot replicate?
3. **Stable and deterministic** — Can it run without `waitForTimeout`, timing hacks, or copy-dependent selectors?

If any gate fails → unit test, not E2E.

## Test-by-Test Classification

### REMOVE ENTIRELY (5 files, ~18 tests)

| File                      | Tests | Why                                                                                          |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------- |
| `00-homepage.spec.ts`     | 4     | Route guard and link tests. Unit test the router guard instead.                              |
| `beanie-avatars.spec.ts`  | 4     | Visual rendering checks. Already covered by `useMemberAvatar.test.ts` and `avatars.test.ts`. |
| `beanie-mode.spec.ts`     | 4     | Settings toggle state. Already covered by `useTranslation.test.ts`.                          |
| `sound-effects.spec.ts`   | 3     | Settings toggle persistence. Already covered by `settingsPersistence.test.ts`.               |
| `04-date-filters.spec.ts` | 3     | Date filter logic is pure computed/store function. No cross-page flow. Unit test.            |

### CONSOLIDATE (remaining files → 8 focused specs, 21 tests)

---

#### `setup-flow.spec.ts` → 1 test (from 4)

| Current test                         | Verdict             | Rationale                                                                       |
| ------------------------------------ | ------------------- | ------------------------------------------------------------------------------- |
| Complete fresh setup                 | **KEEP**            | Core critical path: first-time user creates pod, ends up with data in IndexedDB |
| Validate required fields             | MOVE TO UNIT        | Form validation is pure logic; test uses `evaluate` to manipulate DOM           |
| Add member with birthday (no year)   | CONSOLIDATE into #1 | Add member as part of the happy path, verify in IndexedDB                       |
| Add member with birthday (with year) | REMOVE              | Near-duplicate of above; year vs no-year is a data model concern                |

**Target:** 1 test — "Fresh setup creates pod with family member and persists to IndexedDB"

---

#### `financial-data.spec.ts` → 2 tests (from 5 across accounts + transactions)

| Current test                                 | Verdict                | Rationale                                                          |
| -------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Create account → dashboard net worth updates | **KEEP**               | Cross-page data flow: account creation affects dashboard aggregate |
| Create multiple accounts                     | REMOVE                 | List count check (`toHaveCount(2)`), not a business outcome        |
| Dashboard breakdown → accounts navigation    | REMOVE                 | Just a link click + URL check; routing smoke test                  |
| Create income transaction → dashboard        | **KEEP**               | Cross-page data flow                                               |
| Create expense → dashboard                   | CONSOLIDATE into above | Same pattern, different type; merge into one test doing both       |

**Target:** 2 tests — (1) "Create account, verify net worth on dashboard" (2) "Create income + expense, verify dashboard summary"

---

#### `planner.spec.ts` → 5 tests (from 16)

| Current test                            | Verdict         | Rationale                                                                                                      |
| --------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Display planner page with calendar grid | REMOVE          | UI existence check, not business outcome                                                                       |
| Create one-time activity                | **CONSOLIDATE** | Merge into CRUD lifecycle test                                                                                 |
| Create weekly recurring activity        | **CONSOLIDATE** | Merge into CRUD lifecycle test (recurring variant)                                                             |
| Create multi-day weekly activity        | REMOVE          | Variation of above; test `daysOfWeek` in unit test                                                             |
| Show activity dots on calendar          | REMOVE          | Visual rendering check                                                                                         |
| Display activity in upcoming list       | REMOVE          | List rendering check                                                                                           |
| Edit an existing activity               | **CONSOLIDATE** | Merge into CRUD lifecycle test                                                                                 |
| Delete activity with confirmation       | **CONSOLIDATE** | Merge into CRUD lifecycle test                                                                                 |
| Navigate months                         | REMOVE          | Calendar UI behavior, not data integrity                                                                       |
| Create recurring with advanced fields   | REMOVE          | Field variation; unit test on store                                                                            |
| Create recurring with end date          | REMOVE          | Field variation; unit test on store                                                                            |
| Edit single occurrence (this only)      | **KEEP**        | Recurring override logic crosses CRDT + UI; genuine integration                                                |
| Edit this and all future                | **KEEP**        | Different scope outcome from #12; tests end-dating + new template creation. Keeping separate for debuggability |
| Edit all occurrences                    | **KEEP**        | Different scope outcome: in-place update. Same UI flow but distinct data result                                |
| Reschedule single occurrence            | **KEEP**        | Different code path from edit (reschedule vs field change)                                                     |
| Show legend (SKIPPED)                   | REMOVE          | Dead code                                                                                                      |

**Target:** 5 tests:

1. "Activity CRUD lifecycle: create one-time, create recurring, edit, delete — verify data at each step"
2. "Recurring: edit single occurrence (this only) creates override"
3. "Recurring: edit this and all future creates new template"
4. "Recurring: edit all occurrences updates in-place"
5. "Recurring: reschedule single occurrence"

---

#### `invite-join.spec.ts` → 3 tests (from 9)

| Current test                                | Verdict         | Rationale                                                                                                                                           |
| ------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generate invite link with params            | **CONSOLIDATE** | Merge with #2 into invite flow test                                                                                                                 |
| Auto-open invite modal after adding member  | **CONSOLIDATE** | Part of invite flow                                                                                                                                 |
| Copy invite link via share modal            | REMOVE          | Tests clipboard API; browser-specific, not business outcome                                                                                         |
| Show instructions at /join without params   | REMOVE          | Static content check                                                                                                                                |
| Handle registry lookup when API unavailable | **KEEP**        | Error handling on critical path; graceful degradation                                                                                               |
| Show back button returns to welcome         | REMOVE          | Navigation link test                                                                                                                                |
| Navigate to create pod from join page       | REMOVE          | Navigation link test                                                                                                                                |
| Show loading state with params              | REMOVE          | Shallow error state; unit-testable                                                                                                                  |
| Google Picker prompt when Drive load fails  | **KEEP**        | Critical error recovery cascade (OAuth popup close → Drive 404 → Picker fallback). Hard to mock in unit tests due to cross-cutting async boundaries |

**Target:** 3 tests:

1. "Invite flow: add member, auto-open modal, verify invite link params"
2. "Join flow: graceful degradation when registry unavailable"
3. "Drive join failure: OAuth popup close + Drive 404 triggers Picker fallback"

---

#### `google-drive.spec.ts` → 2 tests (from 8)

| Current test                              | Verdict  | Rationale                                                                           |
| ----------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| Drive text visible on Load Pod view       | **KEEP** | Cheap sanity check (~2 sec). Prevents shipping build with Drive UI missing          |
| Drive option visible on Create Pod step 2 | **KEEP** | Same — cheap smoke test (~3 sec) on different page                                  |
| OAuth mock exchanges code                 | REMOVE   | Tests that `page.route()` returns mock data. Validates test infrastructure, not app |
| OAuth mock refreshes token                | REMOVE   | Same                                                                                |
| Drive mock folder search                  | REMOVE   | Same                                                                                |
| Drive mock file content                   | REMOVE   | Same                                                                                |
| Drive mock file updates                   | REMOVE   | Same                                                                                |
| Drive mock file creation                  | REMOVE   | Same                                                                                |

**Target:** 2 tests — smoke checks that Drive UI exists on both entry points

---

#### `trusted-device.spec.ts` → 1 test (from 4)

| Current test                           | Verdict         | Rationale                                            |
| -------------------------------------- | --------------- | ---------------------------------------------------- |
| Initially has no cached password       | REMOVE          | Default state assertion; unit test                   |
| Cached password persists across reload | **KEEP**        | Critical security/UX: trusted device survives reload |
| Clear all data removes password        | **CONSOLIDATE** | Merge with above: set → persist → clear lifecycle    |
| Trust device modal sets flag           | REMOVE          | Pinia state manipulation; component test             |

**Target:** 1 test — "Password cache lifecycle: set, persist across reload, clear all data removes it"

---

#### `cross-entity.spec.ts` → 5 tests (from 24 across combobox, onboarding, loan-linking)

**From institution combobox (9 → 3):**

| Current test                     | Verdict                      | Rationale                                                      |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| Select predefined institution    | **KEEP**                     | Happy path for custom component                                |
| Search and filter                | **KEEP**                     | Custom component has search logic; regression-worthy           |
| Custom institution via Other     | **KEEP**                     | Different code branch (custom entry + persistence)             |
| Select country alongside         | REMOVE                       | Compound field variant; same combobox                          |
| Pre-select when editing          | REMOVE                       | Form pre-population; component test                            |
| Select predefined lender (asset) | REMOVE                       | Same combobox, different page; redundant                       |
| Custom lender via Other          | REMOVE                       | Same as above                                                  |
| Cross-page data sharing          | **CONSOLIDATE** into test #3 | After custom entry, verify it appears in asset lender dropdown |

**From onboarding (11 → 1):**

| Current test                   | Verdict         | Rationale                                                                      |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------ |
| Shows wizard on /nook          | **CONSOLIDATE** | Setup for happy path                                                           |
| Step 1: welcome screen         | REMOVE          | Element visibility                                                             |
| Step 1→2 navigation            | REMOVE          | Button click                                                                   |
| Step 2: add account            | **CONSOLIDATE** | Uses different account creation form than main Accounts page; genuine coverage |
| Step 2→3 navigation            | REMOVE          | Button click                                                                   |
| Step 3: select activity preset | **CONSOLIDATE** | Part of happy path                                                             |
| Step 3→completion              | REMOVE          | Button click                                                                   |
| Completion closes wizard       | **CONSOLIDATE** | End of happy path                                                              |
| Skip closes wizard             | REMOVE          | Edge case; unit test                                                           |
| Back button                    | REMOVE          | Navigation; unit test                                                          |
| Restart in settings            | REMOVE          | Settings toggle; unit test                                                     |

**Strengthen:** Add `dbHelper.exportData()` verification that account was actually created.

**From loan-activity linking (4 → 3):**

| Current test                                   | Verdict                 | Rationale                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activity with fee creates recurring item       | **KEEP**                | Cross-entity data creation; genuine integration                                                                                                                           |
| View modal shows linked section                | **CONSOLIDATE** with #3 | Merge into "view and navigate" test                                                                                                                                       |
| Click linked → navigate to transactions        | **CONSOLIDATE** with #2 | Merge above                                                                                                                                                               |
| Data integrity: create + delete linked payment | **KEEP**                | 127-line complex state machine (no-payment → add → remove). Keeping separate for debuggability — merging this into a mega-test would make failures impossible to diagnose |

**Target:** 7 tests:

1. "Institution combobox: select predefined institution"
2. "Institution combobox: search and filter"
3. "Institution combobox: custom entry persists and appears in asset lender dropdown"
4. "Onboarding: complete all steps with account + activity preset, verify data persists"
5. "Loan-activity linking: activity with monthly fee creates recurring item"
6. "Loan-activity linking: view linked payment section and navigate to transactions"
7. "Loan-activity linking: data integrity — add then remove linked payment"

---

## Summary

| Metric       | Current                                 | Target                        |
| ------------ | --------------------------------------- | ----------------------------- |
| Test files   | 15                                      | 8                             |
| Test count   | 87                                      | 21                            |
| CI browsers  | 2 (Chromium + Firefox)                  | 1 (Chromium)                  |
| Est. CI time | 10-12 min                               | 3-4 min                       |
| Maintenance  | High (UI copy changes break many tests) | Low (data-focused assertions) |

**Reduction: 87 → 21 tests (76%), 15 → 8 files (47%)**

## Configuration Changes

### `playwright.config.ts`

- Keep only Chromium as default project (keep Firefox/WebKit in config for local `--project=firefox` runs)
- Set `retries: process.env.CI ? 1 : 0` (single retry catches genuine flakes without masking real failures)
- Reduce timeout from 30s → 20s (leaner tests should complete faster)
- Remove numbered file prefix convention (with `fullyParallel: true`, ordering is meaningless)

### `.github/workflows/main-ci.yml`

- Remove browser matrix: `matrix: { browser: [chromium, firefox] }` → single Chromium job
- Rename job to `E2E Tests` (no browser suffix needed)

## Conventions (save to ADR-007 update + CLAUDE.md)

1. **Three-Gate Filter** — every E2E test must pass all three gates (above)
2. **Budget cap: 25 tests max** — adding a new test requires consolidating or removing an existing one
3. **One test per user journey** — test multi-step workflows, not individual features. Minimum 3 meaningful steps
4. **Assert data, not DOM** — primary assertions on IndexedDB exports, URLs, or API state. Avoid element count, text visibility, or CSS class assertions on decorative elements
5. **No testing your own mocks** — if the test only verifies `page.route()` returns what you set, delete it
6. **No `waitForTimeout`** — use Playwright auto-waiting, `waitForURL`, `waitForSelector`. Timing hacks = race conditions
7. **Short and focused** — 5-8 steps max per test. One clear user goal per test
8. **Separate tests for separate outcomes** — when the same UI flow produces different data outcomes (e.g. edit scope options), keep tests separate for failure diagnosis clarity

## E2E Effectiveness Tracking

Add a `## E2E Health Log` to `docs/STATUS.md`. After each CI E2E failure, log:

- **(a) Bug caught** — real code defect discovered by E2E
- **(b) Intentional change** — test updated to match new app behavior
- **(c) Flake** — passed on retry, no code change needed

Review quarterly. Target signal-to-noise ratio (a / b) > 2.0. Any test that's been (b) or (c) more than twice should be culled or rewritten.

## Unit Test Coverage for Removed E2E Tests

Before removing E2E tests, ensure these have unit/integration coverage:

| Logic                                         | Where to test               | Status                       |
| --------------------------------------------- | --------------------------- | ---------------------------- |
| Route guard redirects (homepage/welcome/nook) | `src/router/index.ts`       | **New** — add unit test      |
| Setup wizard form validation                  | Setup page/composable       | **New** — add unit test      |
| Date filter computed logic                    | `transactionsStore.test.ts` | **Verify** existing coverage |
| Recurring edit scopes (this/future/all)       | `activityStore.test.ts`     | **Verify** existing coverage |
| Onboarding step progression                   | Onboarding component        | **Verify** existing coverage |

## Implementation Sequence

1. **Add missing unit tests** for logic being removed from E2E (route guards, form validation, date filters, edit scopes)
2. **Rewrite E2E suite** — create 8 new spec files with 21 consolidated tests
3. **Update config** — `playwright.config.ts` (Chromium-only default, retries, timeout), CI workflow
4. **Update ADR-007** with new strategy, conventions, Three-Gate Filter
5. **Update CLAUDE.md** with E2E rules reference
6. **Delete old files** — remove 7 deleted spec files, clean up unused page objects/helpers
7. **Add E2E Health Log** section to `docs/STATUS.md`

## Files Modified

| File                               | Change                                         |
| ---------------------------------- | ---------------------------------------------- |
| `playwright.config.ts`             | Chromium-only default, retries, timeout        |
| `.github/workflows/main-ci.yml`    | Remove browser matrix                          |
| `docs/adr/007-testing-strategy.md` | New conventions, Three-Gate Filter, budget cap |
| `CLAUDE.md`                        | Add E2E rules reference                        |
| `docs/STATUS.md`                   | Add E2E Health Log section                     |
| `e2e/specs/*.spec.ts`              | 7 files deleted, 8 new files created           |
| `src/router/__tests__/`            | New unit test for route guards                 |
| Various `*.test.ts`                | Verify/add unit coverage for removed E2E logic |

## Verification

- Run `npx playwright test` locally — all 21 tests pass on Chromium
- Run `npm run test:run` — all unit tests pass (including new ones)
- Push to main — CI completes in <5 min total (unit + build + E2E)
- Verify no critical user journey is left uncovered by reviewing the 21 tests against the app's feature list
