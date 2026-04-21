# Plan: Account activity log — view modal with derived transaction history + manual balance-adjustment audit trail + account column on transactions page

> Date: 2026-04-21
> Related issues: None — direct implementation
> Plan file: `docs/plans/2026-04-21-account-activity-log.md`

## User Story

As a family member tracking a manually-maintained account, I want to see a chronological log of every credit, debit, and manual balance correction on that account so I can understand exactly how the current balance came to be — which recurring items hit it, which loans amortized against it, which goals pulled from it, and when (and by whom) someone in the family overrode the balance by hand.

## Context

beanies.family does not sync with banks. Balances move via two paths:

1. **Automated** — every recurring materialization, loan payment, activity fee, goal allocation, and transfer already writes a complete `Transaction` row with `accountId` + source links (`recurringItemId`, `loanId`, `activityId`, `goalId`, `toAccountId`).
2. **Manual balance edit** — `AccountModal` → `AccountsPage.handleAccountSave` → `accountsStore.updateAccount({ balance })` mutates the field silently. No row is written, no member is credited, no trail survives.

`TransactionViewEditModal.vue` (580 lines) already exists and is the canonical "view-then-edit drawer" for a single transaction. The medication log pattern shipped 2026-04-21 (`09ff76d`) showed the template for an inline activity log, but medications needed a new `medicationLogs` collection; accounts don't — `Transaction` already IS the event stream. Reusing it avoids a parallel collection and keeps the beanpod lean.

## DRY audit (pre-plan)

This plan was rewritten after auditing against existing code. Concrete findings:

- **`wrapAsync` is THE store-action convention.** `src/composables/useStoreActions.ts`. Auto-toasts errors + flips `isLoading` + sets `error`. Every store action uses it. All new store actions in this plan must use it too.
- **`TransactionViewEditModal.vue` already exists** (name isn't `TransactionViewModal`). It already handles the view-then-edit flow with inline `InlineEditField` edits + `#footer-start` slot for the Edit button. Extend it — don't create a new view component.
- **Tap-to-view pattern is already standard.** `MedicationCard.vue` and `ActivityCard.vue` already tap-to-view + ✏️-to-edit. `AccountsPage.vue:540` taps straight to edit; switching to view-first matches three other surfaces.
- **`<CurrencyAmount>` component exists** (`src/components/common/CurrencyAmount.vue`) — already handles `type: 'income' | 'expense' | 'neutral'` sign + colour. Don't reinvent sign/colour logic.
- **`useMemberInfo()` exists** — `getMemberName`, `getMemberColor`, `getMemberNameByAccountId`, `getMemberColorByAccountId`. Use for "Adjusted by {name}" and the account-column pill.
- **`groupByDate` exists three times, inlined.** `UpcomingActivities.vue:20-34`, `DayAgendaSidebar.vue`, `ScheduleCards.vue` each reimplement it. A shared util is created in this plan and used by `AccountViewModal` only; the three-site refactor is deferred to keep feature + refactor separate.
- **`MemberChipFilter.vue` is member-specific.** No generic chip filter exists. This plan does NOT create a generic `<ChipFilterBar>` — generalising at N=2 is premature. Six fixed chips are inlined in `AccountViewModal` using the existing pill classes. Extract when a third chip-row surface asks for it.
- **All `transactionsStore` aggregates filter by `t.type === 'income'` or `'expense'`** (11 computeds: `thisMonthIncome`, `thisMonthExpenses`, `thisMonthNetCashFlow`, `expensesByCategory`, etc., `transactionsStore.ts:62-129`). A new `'balance_adjustment'` type is **automatically excluded** from every aggregate. **No aggregate audit required** — the type system enforces correctness.
- **Automerge additive changes need zero migration.** Optional fields + union extensions coexist with old documents (`automergeRepository.ts:79-100`).
- **`uiStrings.ts` parser is flat-key only** (`scripts/updateTranslations.mjs:59-76`). Use flat keys like `'accountView.filter.all'`, never nested objects.
- **`?view=id` / `?direction=...` URL filter pattern already exists** on `TransactionsPage.vue:99-130`. Adding `?account=<id>` plugs in cleanly.
- **No centralised transaction-subtitle composer exists** — create `getTransactionSubtitle()` helper so the branching logic for "Recurring: X" / "Loan payment" / "Goal allocation" / "Transfer → Y" / "Adjusted by Z" lives in one place. The helper is a **pure transformer** — takes pre-resolved display names, not stores.
- **No shared `DetailModalShell` component exists** — MedicationViewModal + ActivityViewEditModal each implement header-sections-footer independently. Extracting now would land us at N=3. **Decision: NOT in scope for this plan** — copy the pattern. Flag shell extraction as a follow-up refactor.

## Requirements

1. **Add `'balance_adjustment'` to `TransactionType`.** Extend union at `src/types/models.ts:157`. Additive — zero migration.
2. **Add a nested `adjustment?: BalanceAdjustmentMeta` field to `Transaction`.** Matches the existing `recurring?: RecurringConfig` convention — groups type-conditional fields visually, self-documents the "only set for balance_adjustment" contract, makes future deletion trivial.
   ```ts
   export interface BalanceAdjustmentMeta {
     delta: number; // signed; positive = credit, negative = debit
     updatedBy: UUID; // FamilyMember.id who authored this adjustment
   }
   ```
   `amount` stays absolute-valued (matches existing convention for income/expense).
3. **New composable `useAdjustBalance()`** is the sole entry point for user-initiated balance edits. Responsibilities: resolve current `accountsStore.accounts` → compute delta → call `accountsStore.updateAccount(...)` → if delta !== 0, call `transactionsStore.createTransaction({ type: 'balance_adjustment', adjustment: { delta, updatedBy } })`. Both calls use `wrapAsync`; errors surface as toasts automatically.
4. **`AccountModal.vue` switches to `useAdjustBalance().saveWithAdjustment()` for the save path.** Name-only / institution-only / member-only edits (balance unchanged) emit no adjustment row.
5. **`AccountViewModal.vue` (new)** — read-only drawer (`BeanieFormModal variant="drawer"`) modelled on `MedicationViewModal` + `TransactionViewEditModal`. Header: account name, type chip, institution, currency, balance via `<CurrencyAmount>`. Body: activity section with inline filter chips + date-grouped list + empty state + "View all →" link. Footer: Edit button in `#footer-start` slot that emits `open-edit`.
6. **`AccountsPage.vue` card click re-routed** from `openEditModal(account)` to `openViewModal(account)`. The existing `ActionButtons` ✏️ icon still opens edit (no change). `AccountViewModal` `@open-edit` event triggers `openEditModal` on the same page. Matches `MedicationCard`, `ActivityCard`, `TodoCard` patterns.
7. **Row click in `AccountViewModal` navigates via `router.push({ path: '/transactions', query: { view: txId } })`** and emits `close`. The existing `?view=` handler on `TransactionsPage` (`TransactionsPage.vue:101-103`) opens `TransactionViewEditModal` with the right transaction. **No transaction-view-modal state on `AccountsPage`.** URL is the state machine.
8. **`transactionsStore.transactionsForAccount(accountId: string)`** — new derived getter. Returns `transactions.filter(t => t.accountId === id || t.toAccountId === id)` sorted descending by `(date, createdAt)`. Pure runtime derivation — zero storage cost.
9. **Activity log filter chips** — `All / Manual / Recurring / Loans / Goals / Transfers`. Inlined in `AccountViewModal.vue` using existing pill classes. Bucket assignment rule (each row belongs to exactly one bucket, most-specific-wins order):
   1. `type === 'balance_adjustment'` → Manual
   2. `loanId` set OR `loanInterestPortion`/`loanPrincipalPortion` set → Loans
   3. `goalId` set → Goals
   4. `recurringItemId` set → Recurring
   5. `type === 'transfer'` → Transfers
   6. else → not represented as a chip (counts toward "All" only; appears as normal income/expense in "All" view with description-only subtitle).
10. **Transfers appear in both accounts' logs.** Getter already handles this; subtitle differs by perspective: `Transfer → {toName}` when the account is the source, `Transfer ← {fromName}` when the destination.
11. **`TransactionViewEditModal` gains a single `isEditable` computed** (`type !== 'balance_adjustment'`) that gates all four visibility branches:
    - Edit button (`#footer-start`) hidden
    - Delete button hidden
    - Category inline edit hidden
    - Account inline edit hidden
      Header shows signed delta via `<CurrencyAmount>` (`type="income"` when `adjustment.delta > 0`, `type="expense"` when `< 0`) + `Adjusted by {name}` line.
12. **`transactionsStore.createTransaction` enforces the `isReconciled: true` invariant** for `balance_adjustment` rows automatically. Caller cannot forget.
13. **TransactionsPage account column** at `sm:` breakpoint and up. Pill with member-color background (from `useMemberInfo().getMemberColorByAccountId`). Transfers render as `${fromName} → ${toName}` inline template literal. Below `sm:` the column is replaced by a subtitle beneath the description, produced by `getTransactionSubtitle`.
14. **TransactionsPage `?account=<id>` filter** — follows existing query-param pattern: read on mount → set a local `accountFilter` ref → apply AND-combined with existing filters → `router.replace({ query: {} })` to clear the URL. Dismissible pill: `Filtered: {accountName} ✕`.
15. **Row actions on `TransactionsPage`** — if inline row buttons exist outside the modal, audit and hide for `balance_adjustment`. If row actions live only inside `TransactionViewEditModal`, the `isEditable` gate there is sufficient.
16. **Empty state on activity log** — `<p class="text-sm text-secondary-500/50">` with `t('accountView.noActivity')`. No CTA — users can't "add" automated rows.
17. **No reserved category sentinel.** Balance-adjustment rows set `category: ''`. No code branches on category for flow decisions (all type-based).
18. **Centralised subtitle helper** — new `getTransactionSubtitle(tx, resolved, vantageAccountId?)` in `src/utils/transactionLabel.ts`. Pure transformer — takes pre-resolved display names, not stores. Returns the display subtitle for any transaction, handling all branches in one place. Consumed by `AccountViewModal` rows and `TransactionsPage` mobile subtitle.
19. **No store-level imports of `transactionsStore` from inside `accountsStore`.** Adjustment emission lives in the `useAdjustBalance` composable (component layer), avoiding the circular-store pattern STATUS.md flagged during P3 medication work.
20. **Permission gating** stays at the page level (`AccountsPage` + `TransactionsPage` already gate on `canViewFinances`). `AccountViewModal` trusts the parent.
21. **All new user-visible strings** go through `uiStrings.ts` with `en` + `beanie` variants. Flat keys only.
22. **Shared `groupByDate<T>()` util** added in this plan, used by `AccountViewModal` only. Refactoring the three existing inline groupers (UpcomingActivities, DayAgendaSidebar, ScheduleCards) onto it is deferred to a separate follow-up commit — standard "don't mix refactors with features" hygiene.

## Error handling — explicit guarantees

- **Every store action uses `wrapAsync`.** `transactionsStore.createTransaction` + `accountsStore.updateAccount` + the new composable's calls all funnel through `wrapAsync`, which shows an error toast on throw, sets `error.value`, and returns `undefined`. No bare try/catch in new code.
- **`useAdjustBalance.saveWithAdjustment`** explicitly returns `{ success: boolean, account?, adjustmentTxId? }`. Callers check `success` and bail accordingly. No silent return paths.
- **"No signed-in member" case.** The composable reads `familyStore.currentMember` at save time. If `undefined`, it does not silently skip:
  1. Falls back to `familyStore.owner` (mirrors `AppSidebar.vue:56` convention).
  2. If owner is also `undefined`, logs `console.error('[useAdjustBalance] no authorable member; account: <id>')` and shows error toast `t('accountView.adjustError.noAuthor')` with developer guidance line `t('accountView.adjustError.noAuthorHelp')`.
  3. Returns `{ success: true, account: updated, adjustmentTxId: undefined }` — the account update succeeded, the adjustment row didn't. User knows via toast; data is consistent.
- **Transaction emission failure after account update succeeded.** `wrapAsync` on the transaction call toasts the error. The balance change persists (correctly — the balance mutated, we just failed to record who did it). Composable returns `{ success: true, account: updated, adjustmentTxId: undefined }` and logs `console.warn('[useAdjustBalance] balance updated but adjustment row failed to record for account', id)`.
- **Subtitle helper** — `getTransactionSubtitle` never throws. Unknown/unexpected shape returns `tx.description` as a safe fallback; in dev, logs `console.warn('[getTransactionSubtitle] unrecognised transaction shape:', tx)`.
- **URL filter lookups** — if `?account=<id>` references a deleted/unknown account, toast `t('txn.filter.accountNotFound')` + `console.warn('[TransactionsPage] unknown account filter id:', id)`, then clear the param.
- **AccountViewModal mount with invalid account id** (race: account deleted between list render and modal open) — show error toast `t('accountView.notFound')` and auto-close via `emit('close')`. Console: `console.warn('[AccountViewModal] account not found:', id)`.
- **`isReconciled` invariant** enforced inside `transactionsStore.createTransaction` — for `type === 'balance_adjustment'`, `isReconciled` is always set to `true` regardless of caller input. Prevents drift.

## Assumptions

> **Review before implementation.**

1. `AccountModal.vue` is the sole user-facing balance-edit entry point. Audit confirmed `updateAccount` has two callers: `AccountModal` via `AccountsPage` (user-initiated), and `assetsStore.ts:117` for loan-account sync (automated, must NOT emit adjustments).
2. `assetsStore.ts:117` continues to bypass adjustment emission — it's automated, not user-initiated. Confirms the choice to emit from the composable, not from `updateAccount`.
3. `familyStore.currentMember` + `familyStore.owner` are reliable sources; the owner-fallback pattern from `AppSidebar.vue` applies.
4. `TransactionViewEditModal` is the only place per-transaction row clicks land (`TransactionsPage` uses it; `AccountViewModal` routes into it via URL). If inline row actions exist outside the modal, audit + hide for `balance_adjustment` there too.
5. `<CurrencyAmount>`'s `type="income" | "expense" | "neutral"` props render green/red/neutral respectively. For signed balance adjustments pass `type="income"` when `delta > 0`, `type="expense"` when `< 0`. Verify at implementation; fallback is direct styling.
6. No reports/forecasts iterate `transactions` directly as "all cash flow" — all 11 audited computeds filter by `type === 'income'` or `'expense'`. Re-verify any future reports added between plan approval and implementation.
7. `TransactionViewEditModal`'s existing inline edit fields for category + account will handle hiding cleanly via `isEditable` computed — no structural rewrite needed.
8. The user's earlier note about "by system" was rhetorical; the final convention is: `Adjusted by {name}` for balance_adjustment only, source-specific label (Recurring: X / Loan payment / etc.) for everything else. No literal "by system" string anywhere.
9. Cross-tab concurrent balance edits inherit the existing optimistic read-then-write race; Automerge merges final balance correctly, though the adjustment row records what THIS tab saw. Same risk exists for every balance-edit path today; not worsened by this plan.

## Approach

### 1. Data model (`src/types/models.ts`)

```diff
- export type TransactionType = 'income' | 'expense' | 'transfer';
+ export type TransactionType = 'income' | 'expense' | 'transfer' | 'balance_adjustment';

+ /** Metadata attached to `balance_adjustment` transactions. Never set for other types. */
+ export interface BalanceAdjustmentMeta {
+   /** Signed delta applied to the account balance. Positive = credit, negative = debit. */
+   delta: number;
+   /** FamilyMember.id who initiated the adjustment. */
+   updatedBy: UUID;
+ }

  export interface Transaction {
    id: UUID;
    accountId: UUID;
    // ... existing fields unchanged ...
    type: TransactionType;
    amount: number; // always absolute
    currency: CurrencyCode;
    category: string;
    date: ISODateString;
    description: string;
    recurring?: RecurringConfig;
    recurringItemId?: UUID;
+   /** Only set when type === 'balance_adjustment'. */
+   adjustment?: BalanceAdjustmentMeta;
    isReconciled: boolean;
    createdAt: ISODateString;
    updatedAt: ISODateString;
  }
```

Contract: when `type === 'balance_adjustment'`, `adjustment` is **required** at the semantic level (the creator always sets it), but TypeScript marks it `?` because older transactions and other types don't have it. Unit tests assert the invariant at creation time.

### 2. `transactionsStore.createTransaction` — enforce invariants

```ts
async function createTransaction(input: CreateTransactionInput): Promise<Transaction | undefined> {
  return wrapAsync(isLoading, error, async () => {
    // Invariant: balance_adjustment rows are always reconciled. Never allow caller to override.
    const normalised =
      input.type === 'balance_adjustment' ? { ...input, isReconciled: true } : input;
    return transactionRepo.createTransaction(normalised);
  });
}
```

Single source of truth for the invariant. Caller can't forget.

### 3. `transactionsStore.transactionsForAccount` — derived getter

```ts
function transactionsForAccount(accountId: string): Transaction[] {
  return transactions.value
    .filter((t) => t.accountId === accountId || t.toAccountId === accountId)
    .sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
    });
}
```

Pure. Append to the store's returned object.

### 4. `useAdjustBalance` composable (`src/composables/useAdjustBalance.ts`)

```ts
export function useAdjustBalance() {
  const accountsStore = useAccountsStore();
  const transactionsStore = useTransactionsStore();
  const familyStore = useFamilyStore();
  const { t } = useTranslation();

  interface SaveResult {
    success: boolean;
    account?: Account;
    adjustmentTxId?: string;
  }

  async function saveWithAdjustment(id: string, input: UpdateAccountInput): Promise<SaveResult> {
    const before = accountsStore.accounts.find((a) => a.id === id);
    if (!before) {
      console.error('[useAdjustBalance] account not found:', id);
      showToast('error', t('accountView.notFound'));
      return { success: false };
    }

    const oldBalance = before.balance;
    const updated = await accountsStore.updateAccount(id, input);
    if (!updated) return { success: false }; // wrapAsync already toasted

    const delta = updated.balance - oldBalance;
    if (delta === 0) return { success: true, account: updated };

    const author = familyStore.currentMember?.id ?? familyStore.owner?.id;
    if (!author) {
      console.error('[useAdjustBalance] no authorable member for account', id);
      showToast(
        'error',
        t('accountView.adjustError.noAuthor'),
        t('accountView.adjustError.noAuthorHelp')
      );
      return { success: true, account: updated };
    }

    const tx = await transactionsStore.createTransaction({
      accountId: id,
      type: 'balance_adjustment',
      amount: Math.abs(delta),
      adjustment: { delta, updatedBy: author },
      currency: updated.currency,
      category: '',
      date: toDateInputValue(new Date()),
      description: t('txn.balanceAdjusted'),
      isReconciled: true, // redundant with store invariant but self-documenting
    });

    if (!tx) {
      console.warn(
        '[useAdjustBalance] balance updated but adjustment row failed to record for account',
        id
      );
      return { success: true, account: updated };
    }

    return { success: true, account: updated, adjustmentTxId: tx.id };
  }

  return { saveWithAdjustment };
}
```

Every failure path: toast + console + explicit return shape. No silent skip.

### 5. `getTransactionSubtitle` — pure helper (`src/utils/transactionLabel.ts`)

```ts
interface ResolvedNames {
  authorName?: string;
  recurringItemName?: string;
  transferCounterpartyName?: string;
  currentMemberId?: string;
}

export function getTransactionSubtitle(
  tx: Transaction,
  resolved: ResolvedNames,
  vantageAccountId?: string
): string {
  // 1. balance_adjustment → "Adjusted by {name}" / "Adjusted by you"
  // 2. loanId / loan portions → t('accountView.loanLabel')
  // 3. goalId → t('accountView.goalLabel')
  // 4. recurringItemId → `Recurring: ${resolved.recurringItemName ?? tx.description}`
  // 5. type === 'transfer' → direction by vantageAccountId
  // 6. fallback → tx.description
}
```

Store-free. Testable with plain objects. Branch priority is `balance_adjustment > loan > goal > recurring > transfer > default` — matches the activity log bucket rule.

### 6. `groupByDate` shared util (`src/utils/groupByDate.ts`)

```ts
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => string,
  formatLabel: (dateStr: string) => string
): Array<{ date: string; label: string; items: T[] }> {
  const groups: Array<{ date: string; label: string; items: T[] }> = [];
  let currentDate = '';
  for (const item of items) {
    const d = getDate(item);
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: d, label: formatLabel(d), items: [] });
    }
    groups[groups.length - 1]!.items.push(item);
  }
  return groups;
}
```

**Scope inside this plan: used in `AccountViewModal` only.** Refactoring the three existing inline groupers (`UpcomingActivities`, `DayAgendaSidebar`, `ScheduleCards`) is deferred to a separate follow-up commit.

### 7. `AccountViewModal.vue` (new)

`BeanieFormModal variant="drawer"`. Composition:

- Header: account name, type chip, institution (if present), currency, `<CurrencyAmount size="lg" :amount="account.balance" :currency="account.currency" type="neutral" />`.
- Activity section title + six inline filter chip buttons (no new component; reuse pill classes from `MemberChipFilter`):
  ```ts
  const FILTERS: ReadonlyArray<{ id: ActivityFilter; labelKey: string; emoji: string }> = [
    { id: 'all', labelKey: 'accountView.filter.all', emoji: '📋' },
    { id: 'manual', labelKey: 'accountView.filter.manual', emoji: '✋' },
    { id: 'recurring', labelKey: 'accountView.filter.recurring', emoji: '🔁' },
    { id: 'loans', labelKey: 'accountView.filter.loans', emoji: '🏦' },
    { id: 'goals', labelKey: 'accountView.filter.goals', emoji: '🎯' },
    { id: 'transfers', labelKey: 'accountView.filter.transfers', emoji: '⇄' },
  ];
  ```
- Grouped list via `groupByDate`. Each row: `<CurrencyAmount :amount :currency :type="delta-derived" />` + subtitle from `getTransactionSubtitle`. Row click: `router.push({ path: '/transactions', query: { view: txId }})` + `emit('close')`.
- Empty state when filtered list is empty.
- "View all →" → `router.push({ path: '/transactions', query: { account: props.account.id }})` when total transactions > visible cap (e.g. 20).
- Footer: Edit button in `#footer-start` emits `open-edit`. Default save slot suppressed (read-only drawer).

### 8. `AccountsPage.vue` wiring

```diff
- <AccountCard @click="openEditModal(account)" />
+ <AccountCard @click="openViewModal(account)" />
```

- ActionButtons ✏️: unchanged → `openEditModal`
- `AccountViewModal`: `@open-edit="openEditModal"`
- **No transaction-view-modal state on this page.** Row clicks in the modal route to `/transactions?view=<id>`.

### 9. `TransactionsPage.vue` changes

- New `accountFilter` ref + `?account=<id>` query param in `handleTransactionQueryParam`
- Filter pills row gains `accountFilter` pill when set; dismissible
- Table: `<th>` + `<td>` for Account column with `class="hidden sm:table-cell"` — pill styled with `getMemberColorByAccountId`. Transfers render inline `${fromName} → ${toName}`.
- Mobile (below `sm:`): account name appended as second line subtitle via `getTransactionSubtitle`

### 10. `TransactionViewEditModal.vue` — single gate

```ts
const isEditable = computed(() => transaction.value?.type !== 'balance_adjustment');
```

All four visibility gates (Edit button, Delete button, inline category edit, inline account edit) reference `isEditable`. Header amount: uses `adjustment.delta` (signed) when `!isEditable.value`; render `type="income"` when `delta > 0`, `type="expense"` when `< 0`. Subtitle line `Adjusted by {getMemberName(adjustment.updatedBy)}` when `!isEditable.value`.

If a future read-only variant appears, evolve to a `renderMode` computed with richer values. For now, a single source of truth.

### 11. i18n (`src/services/translation/uiStrings.ts`)

Flat keys only. `en` + `beanie` variants each.

- `accountView.title`, `accountView.activity`, `accountView.noActivity`, `accountView.viewAll`, `accountView.notFound`
- `accountView.filter.all`, `.manual`, `.recurring`, `.loans`, `.goals`, `.transfers`
- `accountView.adjustedBy`, `accountView.adjustedByYou`
- `accountView.adjustError.noAuthor`, `accountView.adjustError.noAuthorHelp`
- `accountView.recurringLabel`, `accountView.loanLabel`, `accountView.goalLabel`
- `accountView.transferTo`, `accountView.transferFrom`
- `txn.balanceAdjusted`, `txn.accountColumn`, `txn.filteredByAccount`, `txn.clearFilter`
- `txn.filter.accountNotFound`

Run `npm run translate` after adding to verify parser integrity.

## Maintenance tradeoffs (explicit)

- **`Transaction` god-object growth.** The type now carries 22 fields, many type-conditional (`loanId`, `loanInterestPortion`, `loanPrincipalPortion`, `goalId`, `goalAllocMode`, `goalAllocValue`, `goalAllocApplied`, `activityId`, `recurringItemId`, `recurring`, new `adjustment`). The nested `adjustment?:` approach is a small step toward grouping concerns. A larger refactor — extracting loan/goal/activity metas into nested objects too — is warranted but strictly out of scope here. Record in `docs/STATUS.md` follow-ups after this ships.
- **Deferred DRY refactors.** Three date-grouping sites + `MemberChipFilter`/`ChipFilterBar` convergence + URL-param handler on `TransactionsPage` — all known debts with specific "extract at N=3" triggers. None are blocking.
- **Cross-tab balance edit races.** Optimistic read-then-write pattern inherited from existing flows. Automerge merges the final balance correctly; the adjustment row records what THIS tab saw. If the user cares about perfect authorship during concurrent edits, it's a separate plan.
- **`useAdjustBalance` author fallback.** Current logic: `currentMember ?? owner`. If both are `undefined`, toast an error + console.error + return without emitting the adjustment row. In practice "no author identifiable" means the pod is in a broken state and editing should have been gated upstream. Logging + user-visible toast + no-silent-fail path covers the edge case.

## Files Affected

**New:**

- `src/composables/useAdjustBalance.ts`
- `src/components/accounts/AccountViewModal.vue`
- `src/utils/groupByDate.ts`
- `src/utils/transactionLabel.ts` (`getTransactionSubtitle` only)
- Tests:
  - `src/composables/__tests__/useAdjustBalance.test.ts`
  - `src/stores/__tests__/transactionsStore.test.ts` (new getter + `isReconciled` invariant cases)
  - `src/components/accounts/__tests__/AccountViewModal.test.ts`
  - `src/utils/__tests__/groupByDate.test.ts`
  - `src/utils/__tests__/transactionLabel.test.ts`

**Modified:**

- `src/types/models.ts` — extend `TransactionType` union + add `BalanceAdjustmentMeta` interface + nested `adjustment?:` field on `Transaction`
- `src/stores/transactionsStore.ts` — add `transactionsForAccount` getter; enforce `isReconciled` invariant inside `createTransaction`
- `src/components/accounts/AccountModal.vue` — swap save path to `useAdjustBalance().saveWithAdjustment`
- `src/pages/AccountsPage.vue` — card tap → view modal; new `openViewModal` handler; no transaction-modal plumbing
- `src/pages/TransactionsPage.vue` — account column at `sm:`+, mobile subtitle via `getTransactionSubtitle`, `?account=<id>` filter + pill, invalid-id handling
- `src/components/transactions/TransactionViewEditModal.vue` — `isEditable` computed; gate Edit/Delete/inline-category/inline-account; header renders `adjustment.delta` signed + `Adjusted by {name}`
- `src/services/translation/uiStrings.ts` — new flat keys (`en` + `beanie`)

No changes to `UpcomingActivities.vue`, `DayAgendaSidebar.vue`, `ScheduleCards.vue` (`groupByDate` refactor deferred). No new `ChipFilterBar.vue`. No new `formatTransferPath` helper.

## Acceptance Criteria

- [ ] Editing an account's balance via `AccountModal` → saves via `useAdjustBalance.saveWithAdjustment` → emits a `balance_adjustment` transaction with `type`, `amount === |delta|`, `adjustment.delta === delta` (signed), `adjustment.updatedBy === currentMember.id ?? owner.id`, `currency === account.currency`, `date === today`, `category === ''`, `isReconciled === true` (enforced by store), `description === t('txn.balanceAdjusted')`.
- [ ] Saving the edit form without changing the balance field emits no transaction.
- [ ] Non-user paths that call `accountsStore.updateAccount` (e.g. `assetsStore.ts:117` loan sync) do NOT emit adjustment transactions.
- [ ] `transactionsStore.createTransaction` with `type: 'balance_adjustment'` and `isReconciled: false` passed in → stores `isReconciled: true` regardless (invariant).
- [ ] `transactionsStore.transactionsForAccount(id)` returns all transactions where the account is source OR destination, sorted desc by (date, createdAt). Transfers appear in both accounts' results.
- [ ] Tapping an account card on `AccountsPage` opens `AccountViewModal` (not `AccountModal`). The ✏️ button on the card opens `AccountModal` directly. The Edit button inside `AccountViewModal` opens `AccountModal`.
- [ ] `AccountViewModal` header renders balance via `<CurrencyAmount>`; activity list groups by date via `groupByDate`; six inline filter chips narrow the list per the bucket rule; empty state renders when no transactions match the active filter; "View all →" routes to `/transactions?account=<id>`.
- [ ] Row click in `AccountViewModal` routes to `/transactions?view=<id>` and closes the modal. The transactions page's existing `?view=` handler opens `TransactionViewEditModal` with the right transaction.
- [ ] Balance-adjustment rows in the activity log render `Adjusted by {name}` (or `by you`) with green/red signed amount. Automated rows render source-specific subtitles via `getTransactionSubtitle`.
- [ ] Transfer rows in a source account's log render `Transfer → {toName}`; the same transfer in the destination account's log renders `Transfer ← {fromName}`.
- [ ] `TransactionViewEditModal` uses a single `isEditable` computed to gate Edit button + Delete button + inline category edit + inline account edit. For `balance_adjustment`, all four are hidden. Header shows signed delta + `Adjusted by {name}`.
- [ ] `TransactionsPage` shows an Account column at `sm:` and up with member-color pills; transfers render `${from} → ${to}`. Below `sm:`, the account name appears as a subtitle under the description.
- [ ] `/transactions?account=<id>` filters the page to that account (including transfers on either side); shows a dismissible `Filtered: {name} ✕` pill; clearing removes only the account filter; invalid id → toast + console.warn + param cleared.
- [ ] Every existing aggregate (`thisMonthIncome`, `thisMonthExpenses`, `thisMonthNetCashFlow`, `expensesByCategory`, etc.) is unchanged by balance_adjustment rows because all filter by `type === 'income'` or `'expense'`.
- [ ] Every new user-visible string in `uiStrings.ts`, flat keys, `en` + `beanie` variants, `npm run translate` passes.
- [ ] Every new store-touching code path uses `wrapAsync`. No bare try/catch introduced.
- [ ] Every failure path in `useAdjustBalance` has: toast + `console.error` / `console.warn` + explicit return shape. No silent returns.
- [ ] `npm run type-check` + `npm run lint` pass.

## Testing Plan

1. **Unit — `transactionsStore.transactionsForAccount`:** (a) single account returns own transactions; (b) transfer with account as source and another as destination — both accounts' getter returns the same transfer row; (c) sort order verified with same-day + different `createdAt`; (d) balance_adjustment rows included.
2. **Unit — `transactionsStore.createTransaction` invariant:** (a) `balance_adjustment` input with `isReconciled: false` → stored as `true`; (b) `balance_adjustment` input with `isReconciled: true` → stored as `true`; (c) non-adjustment types respect caller's `isReconciled` input.
3. **Unit — `useAdjustBalance.saveWithAdjustment`:** (a) balance increase → positive-delta transaction; (b) balance decrease → negative-delta; (c) balance unchanged → no transaction; (d) name-only edit → no transaction; (e) no `currentMember` but `owner` present → owner is author; (f) neither `currentMember` nor `owner` → toast + console.error + `success: true` with no `adjustmentTxId`; (g) `updateAccount` fails → `success: false`; (h) `createTransaction` fails → `success: true` with `adjustmentTxId: undefined` + console.warn.
4. **Unit — `groupByDate`:** empty, single-group, multi-group, custom label formatter, stable order within group.
5. **Unit — `getTransactionSubtitle`:** balance_adjustment (own vs other's), recurring (name resolved vs fallback), loan, goal, transfer (source & destination vantages), plain income/expense, unrecognised shape (fallback + warn).
6. **Unit — aggregate safety:** add a balance_adjustment to `transactionsStore` fixture; assert `thisMonthIncome`, `thisMonthExpenses`, `thisMonthNetCashFlow`, `expensesByCategory`, `thisMonthOneTimeIncome`, `thisMonthRecurringExpenses` (sample across the 11 computeds) all unaffected.
7. **Component — `AccountViewModal`:** empty state; grouped list; each filter chip narrows correctly per bucket rule; tap row routes to `/transactions?view=<id>` and emits close; Edit button emits `open-edit`; invalid account id → toast + auto-close.
8. **Component — `TransactionViewEditModal` `balance_adjustment` branch:** `isEditable` is false; Edit/Delete hidden; category/account inline edits hidden; header shows signed delta + `Adjusted by {name}`.
9. **Component — `TransactionsPage` account column:** visible at `sm:`, hidden below (mobile subtitle renders instead); transfer row renders `${from} → ${to}`; `?account=<id>` applies filter, pill appears + clears cleanly; invalid id toasts + warns + clears.
10. **Manual QA** (required — finance feature):
    - Sign in as member A → Main Checking $1000 → $1200. Activity log shows `+$200 · Adjusted by A`. Transactions page shows row with account pill, no Edit/Delete in the view modal.
    - Switch to member B → $1200 → $1150. `−$50 · Adjusted by B`.
    - Create recurring Netflix $15/mo → materialize → shows `−$15 · Recurring: Netflix` in activity log.
    - Create transfer Main → Savings $500 → shows `−$500 · Transfer → Savings` in Main's log, `+$500 · Transfer ← Main Checking` in Savings' log.
    - Click a row in Account activity log → navigates to `/transactions?view=<id>` with modal open; close modal → stays on TransactionsPage.
    - Resize viewport mobile → sm → md → confirm account column appears/disappears cleanly.
    - Dashboard net worth + monthly summaries unaffected by adjustments.
    - Delete the Main Checking account → confirm filter pill on `/transactions?account=<id>` handles gracefully (toast + clear).
    - With "no signed-in member" forced (devtools edge case) → edit balance → confirm error toast + console.error + balance still updates.
11. **Translation pipeline:** `npm run translate` must succeed after adding keys; spot-check new keys appear in `public/translations/zh.json` queue / output.

## Follow-ups (explicitly out of scope)

- **Three-site `groupByDate` refactor** — migrate `UpcomingActivities`, `DayAgendaSidebar`, `ScheduleCards` to the shared util. Standalone commit after this plan ships clean.
- **`MemberChipFilter` → generic `ChipFilterBar` consolidation** — trigger when a 3rd chip-row surface emerges.
- **`Transaction` god-object decomposition** — nest loan/goal/activity metas the same way `adjustment` now nests. Coordinate with any future transaction-shape work.
- **`useAuthoringMember()` composable** — extract when a 2nd feature needs "currently-signed-in member, with owner fallback."
- **`useUrlFilters` composable on `TransactionsPage`** — trigger when a 5th URL filter param is added.
- **`DetailModalShell`** — shared shell for `MedicationViewModal` / `ActivityViewEditModal` / `AccountViewModal`. N=3 after this ships; warrants a separate refactor plan.
- **`?account=<id>` UI affordance** — a dropdown next to existing filters (current plan only covers the URL-param path, which is sufficient for "View all →" from `AccountViewModal`).
- **Authoring capture for regular income/expense transactions** (add `createdBy?: UUID`) — user explicitly scoped this out ("only manual transactions need updated by").

## Prompt Log

<details>
<summary>Full prompt history</summary>

### Initial Prompt

> I want to make an update to the accounts page to show a log of updates.
>
> As you know we do not sync with banks, so therefore users manually add their accounts and keep them updated manually, with recurring transactions also crediting or debiting account balances. We should show the user in the accounts view modal the most recent updates, including the date, the balance, the update type (i.e. manual- user changing the balance and show the user name, or automatic, based on a recurring transaction or loan, etc.)
>
> I think the first thing to do is create a view account modal, similar to the view transaction modal that already exists.
>
> Then on the view modal, show a log of recent changes/transactions on the account. changes can be classified as manual (i.e. the user just went in and updated the balance) or automated - the balance changed due to transaction xyz. Perhaps we can leverage or follow the history log that we recently implemented for medications, but this should be more financially focused.
>
> On the transactions page, we should also list the account as one of the columns, to indicate which account each transaction belongs to.
>
> what would be the best way to capture this without bloating the beanpod file too much? can any of this be calculated/derived at runtime ratehr than storing a log of everything in the beanpod file perhaps? or a hybrid approach?
>
> Does this make sense? Let me know if any questions.

### Follow-up 1 (in response to clarifying questions)

> no need to create a github issue

### Follow-up 2 (in response to second round of clarifying questions)

> 2. only manual transactions (i.e. balance adjustments) need updated by, when its done by a person. for automatic ones, just indicate it happened automatically (i.e. "system" or "recurring txn" perhaps?)
> 3. i think it would create weird inconsistencies if you could change a manual transactions - how does that work if new transactions are then layered on top of the new balance? you can manually edit the balance anytime you want so i don't think it's necessary to change old manual edits
> 4. tablet+ only, when there is width
> 5. yes

### Follow-up 3

> yes please prepare a plan

### Follow-up 4 (DRY + error-handling review)

> Review the plan again to make sure you are implementing in the most optimal and efficient way, striving for elegance and simplicity, capturing ALL errors and never letting anything fail silently, and following all DRY principles - you are not re-writing or repeating any code.
>
> Check existing helpers, functions, composables, etc or other code where a solution already exists, check existing components and other reusable UI elements. If you are re-implementing any code that already exists elsewhere, including a UI modal or component that exists elsewhere (or a very close version exists), function, helper, composable, etc, considering refactoring this into a generic item now as opposed to duplicating code and refactoring later.
>
> Ensure that there are never any silent failures. Everything with the potential to fail should be handled gracefully (i.e. a try/catch block or something similar as appropriate). Users should be shown informative error message, with direction for developers as well either in the error modal itself or on the console. Nothing should ever fail silently, and guidance on how to fix the error should always be available.
>
> Rewrite the plan ensuring that the design and flow and functionality is implemented in the simplest and most efficient/optimized way without any duplication, silent failures, overly complicated flows, or code bloat where not necessary.

### Follow-up 5 (maintainability + coupling review)

> Let's review the plan again with a focus on long term sustainability, maintainability, and reliability. Ensure we are using strong coding practices and not putting ourselves in a situation where the app will become overly complex or difficult to support or maintain in the future. Check for deep nesting, overly coupled structures, or any other complexity that could lead to supportability, maintenance, or reliability issues that can be simplified.

### Follow-up 6

> approved

</details>
