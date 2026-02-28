# Plan: Modal Redesign — beanies.family Form System Refactor

> Date: 2026-02-28
> Reference: `docs/brand/beanies-modals-framework-proposal-v1.html`

## Context

All add/edit modals across the app currently use generic BaseModal + BaseInput + BaseSelect in a standard form layout. The new design proposal makes data entry feel fun, visual, and engaging — leading with emoji pickers, toggle pills, and chip selectors instead of dry dropdowns and text fields. This is a critical UX improvement since inputting information is a core activity in the app.

## Summary of Changes

- **12 new shared UI components** (emoji picker, toggle pills, family chips, amount input, day selector, time preset picker, etc.)
- **1 new modal wrapper** (`BeanieFormModal`) — themed form modal shell
- **6 modals refactored** (Activity, Todo, Account, Transaction, Goal, Family Member)
- **4 inline modals extracted** to standalone components (Account, Transaction, Goal, Family Member)
- **3 data model additions** (`icon` on Activity/Account, `daysOfWeek` on Activity, `activityId` on Transaction)
- **Multi-day weekly recurrence** engine update

## Implementation Order

```
Phase 0 → Data model updates (types + activity store recurrence engine)
Phase 1 → 12 shared components + BeanieFormModal
Phase 2 → Activity Modal refactor
Phase 3 → Todo Modal refactor
Phase 4 → Account + Transaction modals (extract + refactor)
Phase 5 → Goal + Family Member modals (extract + refactor)
```

## Files Affected

### New (16)

- `src/components/ui/BeanieFormModal.vue`
- `src/components/ui/EmojiPicker.vue`
- `src/components/ui/TogglePillGroup.vue`
- `src/components/ui/FamilyChipPicker.vue`
- `src/components/ui/AmountInput.vue`
- `src/components/ui/FrequencyChips.vue`
- `src/components/ui/DayOfWeekSelector.vue`
- `src/components/ui/TimePresetPicker.vue`
- `src/components/ui/ColorCircleSelector.vue`
- `src/components/ui/FormFieldGroup.vue`
- `src/components/ui/ConditionalSection.vue`
- `src/components/ui/ActivityLinkDropdown.vue`
- `src/components/accounts/AccountModal.vue`
- `src/components/transactions/TransactionModal.vue`
- `src/components/goals/GoalModal.vue`
- `src/components/family/FamilyMemberModal.vue`

### Modified (10)

- `src/types/models.ts`
- `src/stores/activityStore.ts`
- `src/components/planner/ActivityModal.vue`
- `src/components/todo/TodoViewEditModal.vue`
- `src/components/recurring/RecurringItemForm.vue`
- `src/pages/AccountsPage.vue`
- `src/pages/TransactionsPage.vue`
- `src/pages/GoalsPage.vue`
- `src/pages/FamilyPage.vue`
- `src/services/translation/uiStrings.ts`
