# Plan: Finance Corner (Dashboard) Card Reorganization

> Date: 2026-03-07

## Context

The Dashboard page (`/dashboard`, "Finance Corner") has redundant cards and missing overview information. The Recurring Summary card duplicates data from the summary stats + upcoming transactions. Users need quick overviews of their assets and accounts. All list rows should be clickable to navigate directly to the item's detail view.

## Approach

### Remove from Dashboard (keep component files):

- `RecurringSummaryWidget` — redundant
- Savings Goals card — retained in codebase for future customizable layout

### New card layout (after hero + stats + bean row):

- **Row 1:** Coming Up | Recent Transactions
- **Row 2:** Your Assets (new) | Your Accounts (new)

### Clickable rows:

All card rows navigate to the relevant page with `?view={id}` query param to auto-open the view/edit modal for the clicked item. Target pages (`TransactionsPage`, `AccountsPage`, `AssetsPage`) read `route.query.view` on mount and open the matching modal.

### New cards:

- **Your Assets:** Top 5 by value, BeanieIcon + name + type + CurrencyAmount
- **Your Accounts:** Top 5 by balance, account icon/BeanieIcon + name + institution + CurrencyAmount

## Files affected

1. `src/pages/DashboardPage.vue` — Restructure cards, add assets/accounts, make rows clickable
2. `src/pages/TransactionsPage.vue` — Add `?view=` query param support
3. `src/pages/AccountsPage.vue` — Add `?view=` query param support
4. `src/pages/AssetsPage.vue` — Add `?view=` query param support
5. `src/services/translation/uiStrings.ts` — Add 4 new translation keys
