# Codebase Deduplication & Cleanup — Summary

> Date: 2026-03-01
> Branch: `refactor/codebase-dedup-cleanup`
> PR: #107

---

## Key Stats

| Metric                            | Value                                                  |
| --------------------------------- | ------------------------------------------------------ |
| Codebase size reviewed            | **243 source files, ~49,700 lines**                    |
| Files changed                     | **84** (72 modified, 10 created, 2 deleted)            |
| Lines added                       | **1,161**                                              |
| Lines removed                     | **1,705**                                              |
| **Net reduction**                 | **544 lines**                                          |
| Duplicate functions consolidated  | **14** (across 15+ files → 3 shared modules)           |
| Dead functions removed            | **6**                                                  |
| Repository boilerplate eliminated | **474 lines** (8 repositories)                         |
| Store boilerplate eliminated      | **484 lines** (8 stores)                               |
| Duplicate components replaced     | **2** (→ 1 unified component)                          |
| Entity modals simplified          | **5** (via shared composable)                          |
| Hardcoded hex colors replaced     | **172 occurrences** across 35 files                    |
| CSS utility duplicates removed    | **8 inline class strings** + 4 scoped dark-mode blocks |
| New shared modules created        | **10**                                                 |
| Unit tests                        | **462/462 passed** (zero regressions)                  |
| E2E tests (Chromium)              | **54/57 passed** (1 pre-existing flaky, 2 skipped)     |

---

## Overview

A comprehensive review of the entire `beanies.family` codebase (243 source files, ~49,700 lines of Vue 3 + TypeScript) identified ~2,000+ lines of duplicated or redundant code across recurring patterns. The refactoring was executed in 6 phases across 5 commits, each verified with full type-checking, linting (via pre-commit hooks), and test suites.

The work focused exclusively on reducing duplication and removing dead code — no features were added or changed, and no visual or behavioral changes were introduced (with the exception of the new toast notification system, which adds error visibility that previously didn't exist).

---

## Phase 1: Shared Utilities

**Commit:** `8b696e9` — _Extract shared currency, member lookup, and date utilities_

### 1A. Currency Conversion (`src/utils/currency.ts`)

`getRate()` and `convertToBaseCurrency()` were copy-pasted across **6 files** with identical logic, totaling ~200 duplicated lines:

- `accountsStore.ts`
- `transactionsStore.ts`
- `assetsStore.ts`
- `recurringStore.ts`
- `useCurrencyDisplay.ts`
- `useNetWorthHistory.ts`

**Solution:** Created `src/utils/currency.ts` with the most complete implementation (the path-finding version from `useCurrencyDisplay` that handles indirect exchange rates via triangulation). All 6 consumers now import from this single source.

### 1B. Member Lookup (`src/composables/useMemberInfo.ts`)

`getMemberName(id)` and `getMemberColor(id)` were reimplemented in **5 pages**, each reading from `familyStore.members` with identical fallback logic.

**Solution:** Created `src/composables/useMemberInfo.ts` providing `getMemberName()`, `getMemberColor()`, and `getMemberNameByAccountId()`. All pages now use this composable.

### 1C. Date Formatting

`toDateInputValue()` (YYYY-MM-DD formatting) was redefined inline in 4 files:

- `activityStore.ts`
- `DayAgendaSidebar.vue`
- `PasskeySettings.vue`
- `GoogleDriveFilePicker.vue`

**Solution:** Moved to `src/utils/date.ts` and replaced all inline definitions with imports.

---

## Phase 2: Generic Repository Factory

**Commit:** `aef0c8d` — _Create generic IndexedDB repository factory_

### Problem

8 IndexedDB repository files contained **identical CRUD functions** — `getAll`, `getById`, `create`, `update`, `delete` — differing only in table name and TypeScript type. This amounted to ~474 lines of pure boilerplate.

**Repositories:** accounts, assets, goals, transactions, familyMembers, todos, activities, recurringItems

### Solution

Created `src/services/indexeddb/createRepository.ts` — a generic factory function:

```typescript
function createRepository<T extends EntityBase>(tableName: TableName);
```

Each repository was refactored to call the factory for standard CRUD and only retain entity-specific methods (e.g., `getTransactionsByAccountId`, `getByMemberId`). Average reduction per file: ~50 lines.

---

## Phase 3: Toast System & Store Helpers

**Commit:** `b903a8f` — _Add toast system, store action helpers, and member filter factory_

### 3A. Toast Notification System

**Problem:** Errors from CRUD operations failed silently. Store `.error` refs were populated but never shown to users. ~50+ `console.warn`/`console.error` calls were developer-only.

**Solution:** Created a module-level singleton toast system:

- **`src/composables/useToast.ts`** — `showToast(type, title, message?)` with types: success, error, warning, info
  - Error toasts are **sticky** (require manual dismiss)
  - Other types auto-dismiss after 5 seconds
  - Maximum 5 visible toasts; oldest auto-dismissed when exceeded
- **`src/components/ui/ToastContainer.vue`** — Renders toast stack (bottom-right), type-based styling, slide-in/out transitions
- Wired into `App.vue` for global availability

### 3B. Store Action Helper (`src/composables/useStoreActions.ts`)

**Problem:** Every entity store repeated the same try/catch/finally pattern for create, update, and delete operations — ~23 identical blocks across 8 stores, totaling ~484 lines.

**Solution:** Created `wrapAsync()` helper:

```typescript
async function wrapAsync<T>(
  isLoading: Ref<boolean>,
  error: Ref<string | null>,
  fn: () => Promise<T>,
  options?: { errorToast?: boolean; successToast?: string }
): Promise<T | undefined>;
```

All 8 stores now use `wrapAsync` for CRUD operations. Failed operations **automatically show a sticky error toast** without any per-store code. Business logic (balance adjustments, celebrations) is passed as the callback.

**Stores updated:** accounts, transactions, assets, goals, family, todo, activity, recurring

### 3C. Member Filter Factory (`src/composables/useMemberFiltered.ts`)

**Problem:** Filtered getters using `useMemberFilterStore()` were repeated 20+ times across 7 stores with identical logic (check if member filter is active, filter items by `memberId`).

**Solution:** Created `createMemberFiltered(items, getMemberId)` factory that returns a computed ref of filtered items. Updated 5 stores that use direct `memberId` filtering (accounts, assets, goals, todo, activity). Transactions and recurring stores kept their inline pattern because they use account-based filtering (different mechanism).

---

## Phase 4: Component Consolidation

**Commit:** `b548dba` — _Consolidate member filter chips, action buttons, and form modals_

### 4A. Unified Member Filter Chips (`src/components/common/MemberChipFilter.vue`)

**Problem:** `MemberFilter.vue` (planner) and `MemberFilterChips.vue` (todo) were 90% identical — both rendered family member avatar chips with active/inactive states.

**Solution:** Created a single props-driven component with support for both use cases:

- Props: `isAllActive`, `isMemberActive`, `showUnassigned`, `isUnassignedActive`, `allLabel`
- Emits: `select-all`, `select-member`, `select-unassigned`
- Each parent (planner page, todo page) provides its own state management via props/events

**Deleted:** `src/components/planner/MemberFilter.vue`, `src/components/todo/MemberFilterChips.vue`

### 4B. Form Modal Composable (`src/composables/useFormModal.ts`)

**Problem:** Every entity modal repeated identical boilerplate: `isEditing` computed, `isSubmitting` ref, watch for `open` prop to reset/load form.

**Solution:** Created `useFormModal<T>()` composable providing shared modal lifecycle management. Integrated into 5 modals:

- `AccountModal.vue`
- `GoalModal.vue`
- `TransactionModal.vue`
- `FamilyMemberModal.vue`
- `ActivityModal.vue` (also fixed a missing `isSubmitting` ref bug)

### 4C. Action Buttons (`src/components/ui/ActionButtons.vue`)

**Problem:** Edit/delete icon button pairs with identical classes and markup appeared in 4+ pages.

**Solution:** Created a reusable component with `@edit` and `@delete` events, `size` prop (sm/md), and `editTestId` prop for testing. Replaced inline button pairs in AccountsPage, TransactionsPage, AssetsPage, and GoalsPage.

---

## Phase 5: CSS & Styling Cleanup

**Commit:** `f820e04` — _Replace hardcoded colors with semantic tokens, consolidate CSS utilities, and remove dead code_

### 5A. Inline Utility Class Deduplication

**Problem:** The `nook-section-label` utility class existed in `style.css` but 8 instances across 6 files duplicated its properties inline instead of using it.

**Solution:** Replaced all 8 inline class strings with the `nook-section-label` utility:

- `DashboardPage.vue` (3 instances)
- `MilestonesCard.vue` (1)
- `RecentActivityCard.vue` (1)
- `NookTodoWidget.vue` (1)
- `NookYourBeans.vue` (1)
- `FamilyBeanRow.vue` (1)

### 5B. Hardcoded Hex Color Replacement

**Problem:** Brand colors appeared as raw hex values in Tailwind arbitrary value syntax (`text-[#F15D22]`, `bg-[#2C3E50]`, etc.) across 35 files, despite having defined Tailwind semantic tokens.

**Solution:** Replaced **172 occurrences** of hardcoded hex colors with their semantic equivalents:

| Hex       | Semantic Token   | Occurrences |
| --------- | ---------------- | ----------- |
| `#F15D22` | `primary-500`    | ~80         |
| `#E67E22` | `terracotta-400` | ~20         |
| `#2C3E50` | `secondary-500`  | ~60         |
| `#AED6F1` | `sky-silk-300`   | ~8          |
| `#d94f1a` | `primary-600`    | ~4          |

SVG `fill`/`stroke` attributes and inline styles were intentionally left unchanged (they can't use Tailwind class syntax). `#27AE60` (green) was also left as-is because it doesn't have an exact semantic token match — replacing it would subtly change the color.

### 5C. Nook Card Dark Mode Consolidation

**Problem:** 4 nook card components each defined identical `:global(.dark)` CSS blocks with `background: rgb(30 41 59)`.

**Solution:** Added a shared `.nook-card-dark` class to `style.css` and applied it to all 4 nook components, removing the scoped dark-mode blocks:

- `ScheduleCards.vue`
- `MilestonesCard.vue`
- `RecentActivityCard.vue`
- `NookTodoWidget.vue`

---

## Phase 6: Dead Code Removal

**Commit:** `f820e04` (combined with Phase 5)

### 6A. Unused Date Utility Functions

Verified zero non-test usage across the codebase and removed 6 functions from `src/utils/date.ts`:

| Function                  | Lines | Reason                                          |
| ------------------------- | ----- | ----------------------------------------------- |
| `formatDateTime()`        | 10    | No usage anywhere                               |
| `getEndOfDay()`           | 5     | No usage anywhere                               |
| `getStartOfYear()`        | 3     | No usage anywhere                               |
| `getEndOfYear()`          | 3     | No usage anywhere                               |
| `daysBetween()`           | 4     | No usage anywhere                               |
| `getRelativeTimeString()` | 19    | No usage — `timeAgo()` implements its own logic |

---

## New Shared Modules Created

| File                                         | Purpose                                | Used by                    |
| -------------------------------------------- | -------------------------------------- | -------------------------- |
| `src/utils/currency.ts`                      | `getRate()`, `convertToBaseCurrency()` | 6 stores/composables       |
| `src/composables/useMemberInfo.ts`           | `getMemberName()`, `getMemberColor()`  | 5 pages                    |
| `src/composables/useToast.ts`                | Toast notification singleton           | All stores via `wrapAsync` |
| `src/composables/useStoreActions.ts`         | `wrapAsync()` async helper             | 8 stores                   |
| `src/composables/useMemberFiltered.ts`       | `createMemberFiltered()` factory       | 5 stores                   |
| `src/composables/useFormModal.ts`            | Modal lifecycle composable             | 5 modals                   |
| `src/services/indexeddb/createRepository.ts` | Generic CRUD factory                   | 8 repositories             |
| `src/components/common/MemberChipFilter.vue` | Unified member filter UI               | 2 pages                    |
| `src/components/ui/ActionButtons.vue`        | Edit/delete button pair                | 4 pages                    |
| `src/components/ui/ToastContainer.vue`       | Toast notification renderer            | `App.vue`                  |

---

## What Was NOT Changed

The following were identified during the review but intentionally excluded due to complexity or risk:

- **Splitting `settingsStore`** (497 lines) — deeply coupled to family vs device settings
- **Breaking down `syncStore`** (52KB) — extremely complex, high regression risk
- **Form validation library** — would require introducing Vee-Validate or similar (scope creep)
- **Splitting large components** like `ActivityModal` (408 lines) or `TodoViewEditModal` (234 lines) — better as separate, focused PRs
- **`#27AE60` green hex replacement** — no exact semantic token exists; replacing would change the visual color
- **SVG hex colors** — SVG `fill`/`stroke` attributes can't use Tailwind class syntax

---

## Verification

Each commit was verified through:

1. **TypeScript type-checking** (`vue-tsc --noEmit`) — zero errors
2. **Linting** (ESLint + Prettier + Stylelint) — enforced via pre-commit hooks
3. **Unit tests** (Vitest) — 462/462 passed on every commit
4. **E2E tests** (Playwright/Chromium) — 54/57 passed; 1 pre-existing flaky test (confirmed same failure on `main`), 2 skipped
