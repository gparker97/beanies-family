# Plan: Budget Page — Family Budget Tracking

> Date: 2026-03-01
> Related issues: #68

## Context

The Budget page is one of the last fundamental pages needed to complete the core functionality of beanies.family. It transforms raw transaction data into actionable budget tracking — showing families how their spending compares to their plans, with motivational feedback and category-level breakdowns.

## Approach

- **Quick Add only** for transaction entry (Batch Add + CSV Upload shown with "beanies in development" badge)
- **Both budget modes**: percentage-of-income and fixed amount
- **Monthly period only** (weekly/quarterly deferred)
- **Keep /transactions separate** — budget page shows summaries with "View All" links

## Implementation Steps

1. Data model: Budget types in models.ts
2. Database schema: Bump DB version, add budgets store
3. Repository: budgetRepository.ts with standard createRepository pattern
4. Translation strings: ~35-40 new strings under budget.\* namespace
5. Store: budgetStore.ts with spending analysis computed getters
6. BudgetSettingsModal: BeanieFormModal with mode toggle, category allocations
7. QuickAddTransactionModal: Simplified transaction entry
8. BudgetPage: Hero card, summary cards, spending by category, upcoming transactions
9. Router + navigation: Wire up /budgets route, remove comingSoon
10. Sync infrastructure: mergeService, fileSync, syncStore, App.vue
11. Empty state illustration: Add budget variant

## Files affected

| File                                                      | Action  |
| --------------------------------------------------------- | ------- |
| `src/types/models.ts`                                     | Modify  |
| `src/services/indexeddb/database.ts`                      | Modify  |
| `src/services/indexeddb/repositories/budgetRepository.ts` | **New** |
| `src/stores/budgetStore.ts`                               | **New** |
| `src/services/translation/uiStrings.ts`                   | Modify  |
| `src/components/budget/BudgetSettingsModal.vue`           | **New** |
| `src/components/budget/QuickAddTransactionModal.vue`      | **New** |
| `src/pages/BudgetPage.vue`                                | **New** |
| `src/router/index.ts`                                     | Modify  |
| `src/constants/navigation.ts`                             | Modify  |
| `src/services/sync/mergeService.ts`                       | Modify  |
| `src/services/sync/fileSync.ts`                           | Modify  |
| `src/stores/syncStore.ts`                                 | Modify  |
| `src/App.vue`                                             | Modify  |
| `src/components/ui/EmptyStateIllustration.vue`            | Modify  |
