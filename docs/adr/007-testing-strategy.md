# ADR-007: Testing Strategy

**Status:** Accepted
**Date:** See commits "Add comprehensive tests..." and "Add Playwright E2E testing framework"

## Context

The application handles financial data where correctness is critical. Both unit-level logic and end-to-end user flows need verification.

## Decision

Use a **two-tier testing strategy**:

1. **Unit tests** with Vitest for stores, services, and utility logic
2. **E2E tests** with Playwright for user-facing flows

### Unit Tests (Vitest)

- **Config**: `vitest.config.ts`
- **Environment**: happy-dom (lightweight DOM implementation)
- **Location**: Co-located with source as `*.test.ts` files (e.g., `accountsStore.test.ts`)
- **Commands**: `npm test` (watch), `npm run test:run` (single run)
- **Coverage**: Store logic, service processors, data transformations

### E2E Tests (Playwright)

- **Config**: `playwright.config.ts`
- **Browsers**: Chromium, Firefox, WebKit
- **Structure**:
  - `e2e/specs/` — Test specifications (numbered for order)
  - `e2e/page-objects/` — Page object model abstractions
  - `e2e/helpers/` — IndexedDB helper utilities
  - `e2e/fixtures/` — Test data
- **Execution**: Sequential (`fullyParallel: false`) — tests depend on ordered setup flow
- **Web server**: Auto-starts `npm run dev` for tests
- **Commands**: `npm run test:e2e`, `npm run test:e2e:headed`, `npm run test:e2e:debug`
- **Reports**: HTML and JUnit XML output

### Test Naming Convention

E2E specs are numbered to enforce execution order:

- `01-setup-flow.spec.ts` — First-run wizard
- `02-accounts.spec.ts` — Account management
- `03-transactions.spec.ts` — Transaction management
- `04-date-filters.spec.ts` — Date filter functionality

### Code Quality

- **ESLint** with Vue + TypeScript plugins
- **Prettier** for formatting
- **Stylelint** for CSS/Vue styles
- **Husky** pre-commit hooks via `lint-staged`

## Consequences

### Positive

- Unit tests catch logic errors early with fast feedback
- E2E tests verify real user flows across browsers
- Page object model makes E2E tests maintainable
- Pre-commit hooks prevent code quality regressions

### Negative

- Sequential E2E tests are slower than parallel execution
- E2E tests can be fragile when UI changes (mitigated by `data-testid` attributes)
- happy-dom doesn't perfectly replicate browser behavior for IndexedDB tests
