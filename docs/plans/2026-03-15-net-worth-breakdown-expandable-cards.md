# Plan: Net Worth Breakdown Expandable Cards

> Date: 2026-03-15
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-03-15-net-worth-breakdown-expandable-cards.md`

## User Story

As a user viewing the Finance Nook Dashboard, I want to click a net worth breakdown card and see which accounts/assets make up that total inline, so that I can understand the composition without being unexpectedly navigated away.

## Context

Currently, clicking any Net Worth Breakdown card (Cash, Investments, Crypto, Retirement, Assets, Liabilities) navigates the user to the Accounts or Assets page. This is a confusing UX — users may not intend to leave the dashboard when they click a card. The fix: clicking expands the card to reveal account-level detail inline, with a deliberate "view all" link for navigation.

## Requirements

1. Clicking a breakdown card toggles an expandable detail panel showing the individual accounts/assets in that category
2. Each detail row shows: account/asset name (left), balance in original currency (right), with type label as a muted caption
3. Rows sorted by balance descending (largest first)
4. Clicking the same card again collapses the panel
5. Clicking a different card swaps the detail to that category
6. The expanded card shows a visual "selected" state (ring or persistent shadow in category color)
7. A "View all accounts →" or "View all assets →" link at the bottom navigates to the relevant page
8. Liabilities card gets the same treatment — expands to show credit cards + loans
9. Smooth height + opacity animation for expand/collapse

## Important Notes & Caveats

- Do NOT use `ConditionalSection` — its dashed orange border is designed for form "more details" sections and looks out of place here
- Reuse `getSubtypeLabelKey()` from `accountCategories.ts` for account type labels
- Use `assets.type.*` translation keys for asset type labels
- Match existing "view all" link pattern: `text-primary-500 text-xs font-medium hover:underline` with `→` arrow
- The detail panel appears below the grid as a full-width element, not inside a modal
- No new components needed — self-contained in `NetWorthBreakdownCard.vue`

## Assumptions

1. `accountsStore.filteredActiveAccounts` provides all the account data needed (name, balance, currency, type)
2. `assetsStore.filteredAssets` provides all asset data needed (name, currentValue, currency, type)
3. `getSubtypeLabelKey()` in `accountCategories.ts` covers all account types used in the breakdown
4. Translation keys `assets.type.*` exist for all asset types

## Approach

**Single component change** in `NetWorthBreakdownCard.vue`:

1. Add `expandedCategory` ref to track which card is expanded
2. Replace `router.push()` click handlers with `toggleCategory()` that sets/clears the expanded state
3. Add computed `expandedDetails` that returns the account/asset list for the selected category
4. Render a detail panel below the grid with smooth animation, account rows, and "view all" link
5. Add selected state styling to the active card

**Translation:** 2 new keys in `uiStrings.ts`

## Files Affected

- `src/components/dashboard/NetWorthBreakdownCard.vue` — main implementation
- `src/services/translation/uiStrings.ts` — 2 new translation keys

## Acceptance Criteria

- [ ] Clicking a breakdown card expands detail inline (no navigation)
- [ ] Detail shows account/asset name, type caption, and balance for each item in the category
- [ ] Clicking same card collapses, clicking different card swaps
- [ ] Active card has visual selected state
- [ ] "View all" link navigates to the correct page
- [ ] Liabilities card expands with same treatment
- [ ] Smooth animation on expand/collapse
- [ ] Works on mobile (2-col grid) and desktop (5-col grid)
- [ ] Dark mode support

## Testing Plan

1. Click each category card — verify detail panel shows correct accounts/assets
2. Click same card again — verify it collapses
3. Click a different card while one is open — verify it swaps
4. Verify "view all" link navigates to `/accounts?groupBy=category` or `/assets`
5. Verify liabilities card expands to show credit cards and loans
6. Test on mobile viewport — verify layout works in 2-col grid
7. Toggle dark mode — verify all elements render correctly
8. Test with privacy mode on — verify amounts are masked

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> Let's make a minor improvement to the Finance Nook Dashboard UI to make it more useful for users. In the Net Worth Breakdown section, clicking on any of the cards takes you to the relevant view, either accounts or assets, however this could be a confusing UX for users as they may not be intending to jump to a new view when they click on the card. Propose to make the below changes:
>
> - When clicking on any of the net worth breakdown or liabilities cards, rather than jumping to another screen, show a breakdown in a lightweight, engaging way of the accounts/cards/assets etc making up the breakdown so the user can understand which accounts, assets, loans, etc make up the total number of their net worth breakdown. This should help to make the breakdown calculation clear and transparent for the user.
> - Add an element (i.e. "view all" or something to that effect) that the user can click on to jump to the relevant view

### Follow-up 1

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, and following all DRY principles - you are not re-writing or repeating any code. Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later. Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, overly complicated flows, or code bloat where not necessary.

### Follow-up 2

> yes proceed

</details>
