# Plan: View-First Modals for Activities and Transactions

> Date: 2026-03-06

## Context

Activities and transactions currently open directly into full edit modals (ActivityModal: 514 lines, 20+ fields; TransactionModal: 630 lines, 19+ fields). This is overwhelming for quick viewing. TodoViewEditModal already implements a view-first pattern with inline field editing. We need the same for activities and transactions -- clean view of key info, inline edits for common fields, "Edit" button for the full form.

## Approach

1. Extract shared `useInlineEdit` composable (field-switching state machine)
2. Extract shared `InlineEditField` component (click-to-edit wrapper + pencil icon)
3. Refactor TodoViewEditModal to use both (264 -> ~195 lines)
4. Create ActivityViewEditModal (~210 lines) and TransactionViewEditModal (~180 lines)
5. Wire into FamilyPlannerPage, TransactionsPage, FamilyNookPage

## Files affected

- `src/composables/useInlineEdit.ts` (NEW)
- `src/components/ui/InlineEditField.vue` (NEW)
- `src/components/todo/TodoViewEditModal.vue` (refactor)
- `src/components/planner/ActivityViewEditModal.vue` (NEW)
- `src/components/transactions/TransactionViewEditModal.vue` (NEW)
- `src/services/translation/uiStrings.ts` (add ~10 strings)
- `src/pages/FamilyPlannerPage.vue` (wire view modal)
- `src/pages/TransactionsPage.vue` (wire view modal)
- `src/pages/FamilyNookPage.vue` (wire both view modals)
