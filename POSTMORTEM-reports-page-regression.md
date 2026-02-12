# Post-Mortem: ReportsPage.vue Regression

**Date:** 2026-02-13
**Severity:** High — Full feature loss (Reports page reverted to placeholder)
**Duration:** ~2 days (Feb 11 – Feb 13, 2026)

## Summary

The fully-implemented Reports page (742 lines with Net Worth projection charts, Income vs Expenses stacked bar charts, category breakdowns, and multiple filters) was replaced with a 12-line placeholder component. Users visiting the Reports page saw only "Reports feature coming soon..." instead of the working charts and data.

## Timeline

| Commit    | Date   | What happened                                                                                                                                                                                                                                                                                                        |
| --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cedd76b` | Feb 8  | **Last known good state.** Translation support added to ReportsPage; page fully functional.                                                                                                                                                                                                                          |
| `b368596` | Feb 11 | **Root cause.** "feat: add ESLint, Prettier, and Stylelint configuration" — This commit ran Prettier/ESLint auto-formatting across the entire codebase. The ReportsPage.vue file was **emptied to 0 bytes** (git hash `e69de29`).                                                                                    |
| `26ce1ee` | Feb 11 | **Compounding error.** "fix: resolve all TypeScript build errors" — An AI assistant (Claude Sonnet 4.5) found the empty file, and rather than restoring it from git history, created a placeholder component. The commit message explicitly states: "Create placeholder ReportsPage.vue component (was empty file)". |

## Root Cause

**Commit `b368596`** introduced ESLint, Prettier, and Stylelint with a bulk `--fix` pass across the entire codebase. During this process, ReportsPage.vue was truncated to an empty file. The most likely cause:

1. The ReportsPage had pre-existing TypeScript strict mode issues (unused imports, `noUncheckedIndexedAccess` violations, Chart.js callback type mismatches, side effects in computed properties).
2. When the automated formatting/linting pipeline ran, it likely encountered errors it couldn't auto-fix, and the file was left empty — possibly due to a tool crash, a write-on-error behavior, or a race condition during the bulk formatting pass.

**Commit `26ce1ee`** compounded the problem. When an AI assistant was tasked with fixing all TypeScript build errors, it observed the empty file and assumed it was intentionally empty, creating a placeholder instead of investigating git history to restore the original content.

## Resolution

1. Restored ReportsPage.vue content from commit `cedd76b` using `git show`.
2. Fixed all TypeScript strict mode errors that the original code had:
   - Removed unused imports (`INCOME_CATEGORIES`, `EXPENSE_CATEGORIES`).
   - Fixed `noUncheckedIndexedAccess` violations on Map.get() and array index access.
   - Used `any` types for Chart.js tooltip callbacks (complex Chart.js types don't align cleanly with custom callback signatures).
   - Refactored side effect in computed property (moved `netWorthBreakdownData` from a mutated ref to a derived computed).
   - Added nullish coalescing fallbacks for potentially undefined array accesses.
3. Ran Prettier auto-fix to align with the project's formatting rules.
4. Verified build (`npm run build`) and lint (`npx eslint`) pass.

## Lessons Learned & Preventive Measures

### 1. Never bulk auto-fix without reviewing diffs

Running `eslint --fix` or `prettier --write` across an entire codebase in a single commit is risky. Always review the resulting `git diff` before committing, especially for large files. An empty diff for a 742-line file should have been a red flag.

**Action:** Add a pre-commit check that warns when a file is reduced to 0 bytes or loses more than 90% of its content.

### 2. AI assistants should check git history before creating placeholders

When an AI assistant encounters an unexpectedly empty file, it should run `git log -- <file>` to check if the file previously had content, rather than assuming it was always empty.

**Action:** Add guidance to project CLAUDE.md instructing AI assistants to investigate git history when encountering empty or placeholder files that may have had previous implementations.

### 3. TypeScript errors should be fixed, not worked around by deleting code

The original TypeScript errors in ReportsPage.vue were fixable. The correct response to a file that fails type-checking is to fix the type errors, not to replace the file with a placeholder.

### 4. Add integration/E2E tests for critical pages

If there had been an E2E test verifying that the Reports page renders charts, this regression would have been caught immediately by CI.

**Action:** Add Playwright E2E tests for the Reports page that verify chart components render.

### 5. Incremental linting adoption is safer than bulk formatting

When adding linting to an existing codebase, consider formatting files incrementally (per-PR or per-directory) rather than in a single bulk pass, to reduce the blast radius of any formatting tool issues.
