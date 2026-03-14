# Plan: Net Worth Breakdown Card for Finance Corner Dashboard

> Date: 2026-03-14

## Context

The Finance Corner Dashboard shows a single net worth hero number but no breakdown. The user wants a prominent visual that splits net worth into 5 categories (Cash, Crypto, Investments, Assets, Retirement) so users can see their wealth composition at a glance.

## Visual Design

A single full-width card placed directly below the NetWorthHeroCard with two sections:

**A) Stacked proportion bar** — Horizontal bar (~28px, `rounded-full`) with colored segments proportional to each category's share. 2px gaps between segments. Animated width transitions. Proportions visible even when privacy-locked (percentages aren't sensitive).

**B) Category rows** — One row per non-zero category, sorted descending by amount:

```
[emoji in tinted circle]  Category Name          $XXX,XXX   XX%
```

- Uses `CurrencyAmount` component for amounts (handles privacy masking, formatting, conversion — no reimplementation)
- Percentage as subtle text
- Zero-value categories hidden
- Clickable rows that navigate to the relevant page (Accounts or Assets)

**C) Liabilities footer** — If any credit cards/loans exist, divider + single deduction row in muted style. Uses `CurrencyAmount` with `type="expense"`.

**Card hidden entirely when no accounts and no assets.**

### Category Config (single const array in the component)

| Category    | Account Types                                               | Color     | Emoji | Route       |
| ----------- | ----------------------------------------------------------- | --------- | ----- | ----------- |
| Cash        | `checking`, `savings`, `cash`                               | `#27AE60` | 💵    | `/accounts` |
| Crypto      | `crypto`                                                    | `#9B59B6` | 🪙    | `/accounts` |
| Investments | `investment`, `education_529`, `education_savings`, `other` | `#3498DB` | 📈    | `/accounts` |
| Retirement  | all `retirement_*`                                          | `#E67E22` | 🏖️    | `/accounts` |
| Assets      | `assetsStore.filteredTotalAssetValue`                       | `#2C3E50` | 🏠    | `/assets`   |
| Liabilities | `credit_card`, `loan`                                       | —         | 🔻    | `/accounts` |

## Reuse Audit — What Already Exists

| Need                        | Existing Solution                                    | Action                 |
| --------------------------- | ---------------------------------------------------- | ---------------------- |
| Amount formatting + privacy | `CurrencyAmount` component                           | Use directly in rows   |
| Currency conversion         | `convertToBaseCurrency()` in `src/utils/currency.ts` | Use in computed        |
| Privacy mode                | `usePrivacyMode()` composable                        | Use for bar visibility |
| Card styling                | BudgetSummaryCard pattern                            | Copy Tailwind classes  |
| Section label               | `nook-section-label` CSS class                       | Reuse                  |
| Translation                 | `useTranslation()`                                   | Use for labels         |
| Member filtering            | Store `filteredActiveAccounts` / `filteredAssets`    | Already filtered       |
| Account type grouping       | `filteredActiveAccounts` + filter by type            | Simple computed        |
| Asset total                 | `assetsStore.filteredTotalAssetValue`                | Use directly           |
| Liabilities total           | `accountsStore.filteredAccountLiabilities`           | Use directly           |

**NOT creating:**

- No separate composable file — the computation is 5 simple `filter().reduce()` calls, fits cleanly as computed properties in the component
- No new ProgressBar component — inline Tailwind divs like BudgetSummaryCard does
- No `useCountUp`/`useAnimatedCurrency` — using `CurrencyAmount` component instead (handles everything, avoids 5+ RAF loops)

## Files

### Create (1 file):

- `src/components/dashboard/NetWorthBreakdownCard.vue` — The card component with all logic inline

### Modify (2 files):

- `src/pages/DashboardPage.vue` — Import + place after NetWorthHeroCard
- `src/services/translation/uiStrings.ts` — Add ~8 translation keys

### Translation keys:

```
dashboard.netWorthBreakdown — "Net Worth Breakdown" / "where your beans live"
dashboard.breakdown.cash — "Cash" / "pocket beans"
dashboard.breakdown.crypto — "Crypto" / "magic beans"
dashboard.breakdown.investments — "Investments" / "planted beans"
dashboard.breakdown.retirement — "Retirement" / "future beans"
dashboard.breakdown.assets — "Assets" / "big beans"
dashboard.breakdown.liabilities — "Liabilities" / "beans owed"
hints.netWorthBreakdown — hint text / hint text
```

## Component Internals (NetWorthBreakdownCard.vue)

```
<script setup>
- Import: useAccountsStore, useAssetsStore, useSettingsStore, usePrivacyMode, useTranslation, CurrencyAmount
- Define CATEGORIES const array (key, types[], color, emoji, labelKey, route)
- Computed: iterate filteredActiveAccounts, group by category via filter+reduce+convertToBaseCurrency
- Computed: assets total from assetsStore.filteredTotalAssetValue
- Computed: liabilities from accountsStore.filteredAccountLiabilities
- Computed: grossTotal, categories with amounts+percentages, sorted desc, filtered to non-zero
</script>

<template>
- Card container (standard Tailwind card classes)
- Section header with label + InfoHintBadge
- Stacked bar (flex container, each segment is a div with dynamic width%)
- Category rows (v-for over non-zero categories)
  - Emoji in tinted circle
  - Label via t()
  - CurrencyAmount component (handles masking+formatting)
  - Percentage text
- Divider + liabilities row (v-if liabilities > 0)
</template>
```

## Edge Cases

- All zeros → card hidden
- Single category → 100% bar
- Category < 1% → min-width 8px, shows `<1%`
- No liabilities → footer hidden
- Privacy locked → bar proportions visible, amounts masked via CurrencyAmount

## Verification

1. `npm run type-check` — no errors
2. Visual check on dev server: bar proportions, category rows, amounts
3. Toggle privacy mode — bar stays, amounts mask/unmask
4. Toggle dark mode — proper contrast
5. Filter by family member — breakdown updates
6. Mobile viewport — responsive layout
