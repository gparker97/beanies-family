# Plan: Apply Nook UI Design Language to Piggy Bank Pages

> Date: 2026-02-25
> Related issues: #60

## Context

The Dashboard page already follows v7 Nook UI patterns (rounded-3xl cards, brand tint backgrounds, Outfit section headers, SummaryStatCard). The other 5 finance pages (Accounts, Transactions, Assets, Goals, Reports) plus Forecast still use older styling — `rounded-xl` cards with borders, full-color gradients for summary stats, scattered Tailwind colors, and missing section headers. This is a **styling-only pass** — no logic changes.

## Approach

### Phase 0: Shared Infrastructure

- `src/style.css` — Add `nook-section-label` utility class
- `src/components/common/StatTile.vue` — New lightweight stat tile for pre-formatted string values (used by ReportsPage)

### Phase 1–5: Page Restyling

Each page follows the same pattern:

1. Replace gradient summary cards with `SummaryStatCard` (or `StatTile` for pre-formatted values)
2. Replace bordered cards with shadow-based Nook cards (`rounded-[var(--sq)]`, `shadow-[var(--card-shadow)]`)
3. Replace section headers with `nook-section-label` class
4. Standardize icon containers to 42px squircle (`rounded-[14px]`)
5. Apply `font-outfit font-extrabold` to key amounts

### Phase 6: ForecastPage

Verified — already uses BaseCard which has Nook styling.

## Files Affected

| File                                 | Action                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `src/style.css`                      | Add `nook-section-label` utility                      |
| `src/components/common/StatTile.vue` | **New** — formatted-value stat tile                   |
| `src/pages/AccountsPage.vue`         | Restyle cards, summary stats, section headers, icons  |
| `src/pages/TransactionsPage.vue`     | Restyle summary stats, tabs, date filters, list icons |
| `src/pages/AssetsPage.vue`           | Restyle cards, summary stats, section headers, icons  |
| `src/pages/GoalsPage.vue`            | Restyle stat cards, goal items                        |
| `src/pages/ReportsPage.vue`          | Replace gradient stats with StatTile                  |
| `src/pages/ForecastPage.vue`         | Verified — no changes needed                          |
