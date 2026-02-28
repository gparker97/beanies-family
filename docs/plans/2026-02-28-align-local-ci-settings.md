# Plan: Align Local and CI Test/Build Settings

> Date: 2026-02-28
> Related issues: CI failures on commits 72f088b, 0ee709b

## Context

Tests pass locally but fail in CI because:

1. **No unit tests run before push** — the pre-commit hook only runs lint + type-check, not vitest. Stale mocks reach CI undetected.
2. **Mocks are manually duplicated** across 3 test files with no shared source of truth — when syncService gets a new export, all 3 mocks must be updated independently.
3. **Several CI/local divergences** make it harder to catch issues before pushing.

## Approach

### 1. Fix broken CI (immediate)

**Create a shared syncService mock factory** at `src/services/sync/__mocks__/syncService.ts` that all 3 test files import. This eliminates the root cause — duplicate mocks that drift out of sync.

The factory will export every function from `syncService.ts` as a `vi.fn()` stub, so when new exports are added to the service, only one file needs updating.

Update these 3 test files to use the shared mock:

- `src/stores/__tests__/dataClearingSecurity.test.ts`
- `src/stores/__tests__/syncAutoSave.test.ts`
- `src/stores/__tests__/passwordCache.test.ts`

### 2. Add pre-push hook to run unit tests

Create `.husky/pre-push` that runs `npm run test:run` before any push. This is the single highest-impact change — it catches broken tests before they reach CI.

### 3. Add `npm run validate` script

Add a single command that mirrors exactly what CI checks:

```
npm run validate = type-check && lint && format:check && test:run && build
```

This lets developers run the full CI check locally with one command. Document in `package.json` scripts.

### 4. Add `format:check` to `main-ci.yml`

PR checks run `format:check` but main-ci doesn't. Add it for parity so direct-to-main pushes also catch formatting issues.

### 5. Fix `translation-sync.yml` missing `VITE_GOOGLE_CLIENT_ID`

Add the missing env var to the translation-sync deploy step to match `deploy.yml`.

### 6. Address `serialize-javascript` dependency conflict

Add an npm override in `package.json` to force `serialize-javascript@>=6.0.2` (latest 6.x that has the fix, if available) or document the issue if no 6.x fix exists.

## Files affected

| File                                                | Action                                               |
| --------------------------------------------------- | ---------------------------------------------------- |
| `src/services/sync/__mocks__/syncService.ts`        | **Create** — Vitest auto-mock for syncService        |
| `src/stores/__tests__/dataClearingSecurity.test.ts` | **Edit** — remove inline mock factory, use auto-mock |
| `src/stores/__tests__/syncAutoSave.test.ts`         | **Edit** — remove inline mock factory, use auto-mock |
| `src/stores/__tests__/passwordCache.test.ts`        | **Edit** — remove inline mock factory, use auto-mock |
| `.husky/pre-push`                                   | **Create** — run unit tests before push              |
| `package.json`                                      | **Edit** — add `validate` script                     |
| `.github/workflows/main-ci.yml`                     | **Edit** — add `format:check` step                   |
| `.github/workflows/translation-sync.yml`            | **Edit** — add `VITE_GOOGLE_CLIENT_ID` env var       |

## What's NOT in scope

- **Node version alignment**: `.nvmrc` says 20, local runs 24. The main-ci matrix already tests both 20 and 24. This is a personal dev environment choice, not a config fix.
- **E2E on PRs by default**: Currently label-gated (`run-e2e`). E2E tests are slow and expensive — opt-in is reasonable.
- **Webkit in main CI**: Only tested weekly/on-demand. Reasonable tradeoff for CI speed.
- **Codecov coverage gap**: `test:run` doesn't pass `--coverage`. Separate enhancement.
- **serialize-javascript Dependabot**: Build-time dependency only (not shipped to users). Skip — let upstream resolve naturally.

## Verification

1. Run `npm run test:run` locally — all 3 previously failing test suites should pass
2. Run `npm run validate` — full CI mirror passes locally
3. Push to main — CI should go green
4. Verify `.husky/pre-push` fires on `git push` by temporarily breaking a test
