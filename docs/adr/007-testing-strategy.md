# ADR-007: Testing Strategy

**Status:** Accepted (revised 2026-03-25)
**Date:** Original — see early commits. Revised — 2026-03-25 (E2E overhaul).

## Context

The application handles financial data where correctness is critical. Both unit-level logic and end-to-end user flows need verification.

The original E2E suite grew to 87 tests across 15 files, taking 10+ minutes per CI run. Most failures were caused by intentional UI changes requiring test updates, not actual bugs. The suite was overhauled in March 2026 to focus exclusively on critical user journeys.

## Decision

Use a **two-tier testing strategy**:

1. **Unit tests** with Vitest for stores, services, utility logic, and component behavior
2. **E2E tests** with Playwright for critical user journeys only

### Unit Tests (Vitest)

- **Config**: `vitest.config.ts`
- **Environment**: happy-dom (lightweight DOM implementation)
- **Location**: Co-located with source as `*.test.ts` files (e.g., `accountsStore.test.ts`)
- **Commands**: `npm test` (watch), `npm run test:run` (single run)
- **Coverage**: Store logic, service processors, data transformations, route guards, form validation, component behavior

### E2E Tests (Playwright)

- **Config**: `playwright.config.ts`
- **CI browsers**:
  - Per-PR: none (kept fast; opt in by labelling a PR `run-e2e`)
  - Push to `main`: Chromium + WebKit (Safari/iOS is a large share of real users — see issue #155 for the stability work that made this viable)
  - `run-e2e` label on a PR: Chromium + WebKit (opt-in)
  - Weekly schedule: Chromium + Firefox + WebKit (full sweep)
- **Structure**:
  - `e2e/specs/` — Test specifications (descriptive names, no numbered prefixes)
  - `e2e/page-objects/` — Page object model abstractions
  - `e2e/helpers/` — IndexedDB helper, auth, combobox, UI string resolver
  - `e2e/fixtures/` — Test data factory and custom Playwright fixture
- **Execution**: Fully parallel (`fullyParallel: true`) with test isolation via `clearAllData()` per test
- **Web server**: Auto-starts `npm run dev` for tests
- **Commands**: `npm run test:e2e`, `npm run test:e2e:headed`, `npm run test:e2e:debug`
- **Reports**: HTML and JUnit XML output
- **Retries**: 1 in CI (catches genuine flakes), 0 locally

### The Three-Gate Filter

Every E2E test must pass **all three gates** to exist. If any gate fails, use a unit test instead.

1. **Business-critical outcome** — Would a real user be blocked, lose data, or hit a broken workflow if this broke in production?
2. **Full-stack integration required** — Does it cross multiple layers (UI + store + CRDT/IndexedDB + routing) in a way a Vitest unit test cannot replicate?
3. **Stable and deterministic** — Can it run without `waitForTimeout`, timing hacks, or copy-dependent selectors?

### E2E Conventions

1. **Budget cap: 25 tests max** — Adding a new test requires consolidating or removing an existing one to stay under the cap. This forces prioritization.
2. **One test per user journey** — E2E tests follow a user through a multi-step workflow. They do not test individual UI elements, toggles, or navigation links. Minimum 3 meaningful steps per test.
3. **Assert data, not DOM** — Primary assertions should be on persisted data (IndexedDB export via `dbHelper.exportData()`), URLs, or API state. Avoid assertions on element counts, text visibility of decorative elements, or CSS classes.
4. **No testing your own mocks** — Tests that only verify `page.route()` returns the mocked response are banned. Mock infrastructure is validated by the tests that use it, not by dedicated tests.
5. **No `waitForTimeout`** — Use Playwright auto-waiting, `waitForURL`, `waitForSelector`, or `toBeVisible()`. Timing hacks indicate race conditions that must be fixed, not papered over.
6. **Short and focused** — 5–8 steps max per test. One clear user goal per test.
7. **Separate tests for separate outcomes** — When the same UI flow produces different data outcomes (e.g., recurring edit scope options), keep tests separate for failure diagnosis clarity.
8. **Don't test what you don't own** — Don't E2E test framework routing, browser behavior, or UI library internals. Those are already tested by Vue/Playwright/browser vendors.

### E2E Health Tracking

After each CI E2E failure, log the outcome in `docs/E2E_HEALTH.md`:

- **(a) Bug caught** — real code defect discovered
- **(b) Intentional change** — test updated to match new app behavior
- **(c) Flake** — passed on retry, no code change needed

Review quarterly. Target signal-to-noise ratio (a / b) > 2.0. Any test logged as (b) or (c) more than twice should be culled or rewritten.

### Code Quality

- **ESLint** with Vue + TypeScript plugins
- **Prettier** for formatting
- **Stylelint** for CSS/Vue styles
- **Husky** pre-commit hooks via `lint-staged`

## Consequences

### Positive

- Unit tests catch logic errors early with fast feedback
- E2E tests focused on critical paths provide high signal with low maintenance
- Three-Gate Filter prevents suite bloat over time
- Budget cap forces intentional test design
- Chromium-only CI cuts E2E time by ~50% with negligible coverage loss
- Health tracking enables data-driven decisions about test ROI

### Negative

- Removing browser diversity from CI means cross-browser bugs may slip through (mitigated by periodic local multi-browser runs)
- Strict budget cap may require difficult prioritization decisions when adding features
- Fewer E2E tests means more reliance on unit tests catching integration issues
