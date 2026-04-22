# Plan: Net-worth chart correctness + aggregation hygiene

> Date: 2026-04-22
> Related issues: TBD (file after plan approval)

## Context

Two reported bugs and three latent ones in code paths that aggregate or replay transactions:

1. **Reported (🔴):** The dashboard NetWorth chart shows a flat line through a +$500k manual balance adjustment made yesterday — adjustment is silently dropped from the historical replay.
2. **Latent (🔴):** The Reports "Income vs Expenses" chart treats every non-income transaction as an expense via a binary ternary, double-counting transfers and miscounting balance adjustments as $X expenses.
3. **Latent (🟡):** Loan-payment expenses on the NetWorth chart over-state historical net worth by the cumulative principal paid (the chart reverses the cash-side but not the debt-side).
4. **Latent (🟡):** New accounts/assets created today appear throughout the entire historical chart at their current contribution. Both entity types already carry `createdAt` (set in `automergeRepository.ts:65`), so the data is there — just unused.
5. **Latent (🟢):** Two activity feeds (NookRecentActivity, GlobalSearch) visually misclassify `balance_adjustment` rows as expenses via the same `tx.type === 'income' ? X : Y` ternary pattern.

User confirmed `includeInNetWorth` and `isActive` toggling IS intentionally retroactive — no fix.

## Architecture

### Three-layer separation

```
NetWorthHeroCard.vue                  ← view (3-way flat template: error / empty / chart)
  └── useNetWorthHistory.ts           ← orchestrator (thin: read stores, call helper, return reactive contract)
        └── utils/netWorthHistory.ts  ← pure (event construction, replay, no Vue/Pinia)
              ├── utils/finance.ts    ← pure (sign math, multipliers)
              └── utils/currency.ts   ← pure (FX)
```

### Single abstraction: `NetWorthChange`

A single contribution to net worth that occurred at a point in time. Sign convention: `delta` is the signed change in base currency that the event added to net worth at the moment it occurred. To reconstruct historical net worth by walking backwards, subtract `delta` from the running net worth as we cross each event's `date`.

Examples:

- $100 income on a checking account: `{ date, delta: +100 }`
- $50 loan-payment expense (split: $40 principal, $10 interest): `{ date, delta: -50 + 40 = -10 }` (cash down 50, debt down 40)
- +$500k balance_adjustment on a credit card: `{ date, delta: -500_000 }` (debt up = net worth down; sign flipped by multiplier)
- Account creation with $10k initial balance (asset side): `{ date: createdAt, delta: +10_000 }`

### Pure module API (`utils/netWorthHistory.ts`)

```ts
export interface NetWorthChange {
  readonly date: Date;
  readonly delta: number;
}

export function buildNetWorthChanges(input: {
  accounts: Account[]; // already filtered to active && includeInNetWorth
  assets: Asset[]; // already filtered to includeInNetWorth
  transactions: Transaction[];
  baseCurrency: CurrencyCode;
  rates: ExchangeRate[];
}): NetWorthChange[];

export function replayNetWorthHistory(input: {
  currentNetWorth: number;
  chartPointsNewestFirst: ReadonlyArray<Date>;
  changesNewestFirst: ReadonlyArray<NetWorthChange>;
}): number[];
```

### Composable contract

```ts
const chartResult = computed<{ data: NetWorthDataPoint[]; error: string | null }>(() => {
  try {
    /* build + replay */ return { data, error: null };
  } catch (e) {
    console.error('[useNetWorthHistory] chart construction failed:', e);
    return { data: [], error: 'Could not render net worth history. Check console for details.' };
  }
});
const chartData = computed(() => chartResult.value.data);
const chartError = computed(() => chartResult.value.error);
```

### Compile-time exhaustiveness via `assertNever`

Every place that branches on `tx.type` uses a `switch` with an `assertNever` default. When a fifth `TransactionType` is added, TypeScript fails the build at every site that needs updating.

### Helpers added to `finance.ts`

- `isLiabilityType(type)` — true for credit_card / loan
- `accountNetWorthMultiplier(account)` — +1 for asset accounts, -1 for liability accounts
- `accountBalanceDeltaFromTx(tx, accountId)` — signed amount the transaction historically changed the account's balance. Composes `calculateBalanceAdjustment` for income/expense/transfer; returns raw delta for `balance_adjustment` (different from `calculateBalanceAdjustment` which returns 0 for cascade short-circuit reasons).

### Visual classifier in `transactionLabel.ts`

`getTransactionVisual(tx)` — returns `{ icon, tint }` mirroring the priority chain used by `getTransactionSubtitle`. Single source of truth for transaction-row visuals.

### Bundled side-cleanup: extract `useMonthOverMonthCashFlow`

The current `useNetWorthHistory` mixes net-worth chart logic with last-month income/expense diffs (lines 181-240). Extract these to a new `useMonthOverMonthCashFlow.ts`. Five-minute extraction, zero behavior change. Keeps the chart composable single-responsibility going forward.

## Deliverables

**New files:**

- `src/utils/assertNever.ts`
- `src/utils/netWorthHistory.ts`
- `src/composables/useMonthOverMonthCashFlow.ts`
- `src/utils/__tests__/netWorthHistory.test.ts`
- `src/composables/__tests__/useNetWorthHistory.test.ts`
- `src/composables/__tests__/useMonthOverMonthCashFlow.test.ts`

**Modified:**

- `src/utils/finance.ts` — three new helpers
- `src/utils/transactionLabel.ts` — `getTransactionVisual`
- `src/utils/__tests__/finance.test.ts` — extend
- `src/utils/__tests__/transactionLabel.test.ts` — extend
- `src/composables/useNetWorthHistory.ts` — slim orchestrator + `chartError`
- `src/components/dashboard/NetWorthHeroCard.vue` — flat 3-way template + consume `chartError`
- `src/stores/accountsStore.ts` — use multiplier helper
- `src/services/automerge/repositories/accountRepository.ts` — use multiplier helper
- `src/pages/AccountsPage.vue` — use shared `isLiabilityType`
- `src/pages/DashboardPage.vue` — use shared `isLiabilityType`
- `src/pages/ReportsPage.vue` — Bug B filter + multiplier helper
- `src/components/nook/RecentActivityCard.vue` — use `getTransactionVisual`
- `src/components/common/GlobalSearch.vue` — use `getTransactionVisual`
- `CHANGELOG.md`

**Deletions enabled:**

- 2 local `isLiability(type)` definitions
- 4+ inline `credit_card || loan ? -1 : 1` ternaries
- 2 inline icon ternaries

## Implementation order (commit boundaries)

Each commit must build, type-check, and pass tests. Each commit ships both new tool AND first non-trivial consumer — no pure-churn commits.

1. **C1** — `assertNever` + `finance.ts` helpers + first consumer (`accountsStore`, `accountRepository`)
2. **C2** — Replace remaining inline multipliers (`DashboardPage`, `AccountsPage`, `ReportsPage`)
3. **C3** — `getTransactionVisual` + Bug D fix
4. **C4** — Extract `useMonthOverMonthCashFlow`
5. **C5** — Pure replay module + tests
6. **C6** — Slim composable + error contract + hero card
7. **C7** — ReportsPage Bug B fix
8. **C8** — CHANGELOG + plan archive

## Tests

- **Stable ISO dates** — no relative-from-today timing
- **Latent-bug discovery policy** — if a test of pre-existing behavior fails, file a separate issue, mark `.skip` with `// LATENT BUG (#NNN):` reference, do not quietly fix in this PR
- Coverage targets:
  - `accountBalanceDeltaFromTx` — all four transaction types, source/destination, missing adjustment metadata
  - `replayNetWorthHistory` — empty events, single event before/between points
  - `transactionToChange` (internal) — all types incl. loan-payment principal portion
  - `accountToCreationChange` / `assetToCreationChange` — happy path, missing createdAt
  - `buildNetWorthChanges` — assembles all sources, sorts newest-first
  - Composable integration — Bug A, Bug C, Bug 5 regression scenarios
  - ReportsPage — Bug B excludes balance_adjustment + transfer from totalExpenses

## JSDoc requirements (mandatory)

Every exported function in `utils/netWorthHistory.ts`, `utils/finance.ts`, and `utils/transactionLabel.ts` must include: one-sentence summary, sign convention, one concrete example, `@see` cross-references, caller obligations.

## Long-term considerations / explicit non-goals

Documented as comments at the top of `utils/netWorthHistory.ts`:

> This module solves the historical-replay problem under the constraint that
> we have no daily snapshots — only current state plus an immutable transaction
> log. Some classes of state change (asset re-valuations, accounts toggled
> in/out of net worth) cannot be reconstructed from the transaction log
> alone. They are deliberately out of scope.
>
> If we ever want a fully-correct historical chart that handles those cases,
> the right path is to write a daily `combinedNetWorth` snapshot to a
> separate Automerge collection. That would obsolete most of this module.

## Risks

- Visual shift on first load for users with recently-added accounts (chart drops their contribution from historical points). Strictly more accurate; CHANGELOG frames as a fix.
- Long-existing accounts added today see no historical balance — accurate per the model. Future enhancement: optional `accountStartDate` field. Defer.
- Existing-behavior tests may surface latent bugs in pre-existing code. Policy above (file separately) addresses without scope creep.
- `convertAmount` silent identity-fallback when no FX rate found — out of scope here; chart construction adds per-session warned-pairs cache to avoid spam.

## Out of scope

- Asset value re-valuations (architectural — needs `valueHistory` field)
- Asset-to-liability `transfer` semantics (separate UX decision needed)
- Daily snapshots architecture (long-term direction; not bundled with this fix)
