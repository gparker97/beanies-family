# ADR-005: Recurring Transactions as Templates

**Status:** Accepted
**Date:** See commit "Update summary cards to include recurring transactions in totals"

## Context

Users need to track recurring income and expenses (salary, rent, subscriptions, etc.). The system needs to automatically generate transactions on their due dates.

## Decision

Implement recurring transactions as **template objects** (`RecurringItem`) that are separate from regular `Transaction` records. A processor runs on app startup to generate actual transactions for all due dates since the last processing.

### Implementation Details

- **Model**: `RecurringItem` in `src/types/models.ts`
  - Frequencies: `daily`, `monthly`, `yearly`
  - `dayOfMonth` (1-28): which day to generate
  - `monthOfYear` (1-12): which month for yearly items
  - `lastProcessedDate`: tracks what's been generated
  - `startDate` / `endDate`: bounds for the recurring schedule
- **Processor**: `src/services/recurring/recurringProcessor.ts`
  - Runs on app startup via the recurring store
  - Calculates all due dates since `lastProcessedDate` (or `startDate` for new items)
  - Creates a `Transaction` for each due date with `recurringItemId` link
  - Updates account balance for each generated transaction
  - Deactivates items past their `endDate`
- **Store**: `src/stores/recurringStore.ts` manages CRUD and triggers processing

### Day-of-Month Handling

The `dayOfMonth` is capped to the actual number of days in the month. For example, a recurring item set to the 31st will generate on the 28th in February.

## Consequences

### Positive

- Clear separation between template and generated transactions
- Catch-up processing handles missed days (e.g., if app wasn't opened for a week)
- Generated transactions are regular transactions — they appear in all reports and summaries
- Easy to preview upcoming dates without generating transactions

### Negative

- Processing on startup can create many transactions at once if app was unused for a long time
- No "skip this occurrence" functionality yet
- Account balance updates happen during processing, not at the actual due date
