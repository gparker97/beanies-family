/**
 * Pure helpers for reconstructing historical net worth from transactions
 * and entity-creation events.
 *
 * --------------------------------------------------------------------------
 * Architectural note for future maintainers
 * --------------------------------------------------------------------------
 * This module solves the historical-replay problem under the constraint
 * that we have no daily snapshots — only current state plus an immutable
 * transaction log. Some classes of state change cannot be reconstructed
 * from the transaction log alone and are deliberately out of scope:
 *
 *   - Asset re-valuations (changing asset.currentValue today retroactively
 *     rewrites every historical chart point for that asset).
 *   - Toggling `includeInNetWorth` or `isActive` is intentionally retroactive
 *     by product decision (the toggle pretends the entity never existed).
 *
 * If we ever want a fully-correct historical chart that handles those
 * cases, the right path is to write a daily `combinedNetWorth` snapshot to
 * a separate Automerge collection. That would obsolete most of this module.
 * Adding more `if (...)` branches in the replay is NOT the right next step.
 *
 * --------------------------------------------------------------------------
 * Sign convention (load-bearing — read carefully)
 * --------------------------------------------------------------------------
 * Each `NetWorthChange` carries the signed change to net worth in base
 * currency at the moment the event occurred. To reconstruct historical net
 * worth, we walk backwards from today and SUBTRACT each change as we cross
 * it. So:
 *
 *   - $100 income on a checking account → delta = +100
 *     (income added $100 to net worth; reversing means removing $100 from
 *     the running total as we walk past it)
 *   - $50 expense → delta = -50
 *   - $50 loan-payment expense (split: $40 principal + $10 interest)
 *     → delta = -50 + 40 = -10
 *     (cash decreased $50, but debt also decreased $40, so net worth
 *     only fell by the $10 interest portion)
 *   - +$500 balance_adjustment on a CHECKING account → delta = +500
 *   - +$500 balance_adjustment on a CREDIT CARD → delta = -500
 *     (credit card balance going up means more debt = net worth down)
 *   - Account created with $10k initial balance (asset side)
 *     → delta = +10_000 (it added $10k to net worth at creation)
 *   - Liability account created with $1k balance
 *     → delta = -1_000 (it added $1k of debt to net worth at creation)
 */
import type { Account, Asset, CurrencyCode, ExchangeRate, Transaction } from '@/types/models';
import { convertAmount } from '@/utils/currency';
import { getStartOfDay } from '@/utils/date';
import { accountBalanceDeltaFromTx, accountNetWorthMultiplier } from '@/utils/finance';
import { assertNever } from '@/utils/assertNever';

/**
 * A single contribution to net worth that occurred at a point in time.
 * See the file-header comment for the full sign convention.
 */
export interface NetWorthChange {
  readonly date: Date;
  readonly delta: number;
}

/**
 * Walk chart points newest-first, subtracting each change whose date is
 * strictly after the chart point. Returns one number per chart point in
 * the same order as `chartPointsNewestFirst`.
 *
 * Invariants:
 *   - `chartPointsNewestFirst` MUST be sorted newest-first.
 *   - `changesNewestFirst` MUST be sorted newest-first.
 *   - Both inputs are read-only — the function never mutates them.
 *
 * Complexity: O(points + changes). Single linear walk through both arrays.
 *
 * @example
 *   const values = replayNetWorthHistory({
 *     currentNetWorth: 10_000,
 *     chartPointsNewestFirst: [today, yesterday],
 *     changesNewestFirst: [{ date: yesterday, delta: 1_000 }],
 *   });
 *   // values === [10_000, 9_000]
 */
export function replayNetWorthHistory(input: {
  currentNetWorth: number;
  chartPointsNewestFirst: ReadonlyArray<Date>;
  changesNewestFirst: ReadonlyArray<NetWorthChange>;
}): number[] {
  const out: number[] = [];
  let running = input.currentNetWorth;
  let i = 0;

  for (const point of input.chartPointsNewestFirst) {
    while (i < input.changesNewestFirst.length && input.changesNewestFirst[i]!.date > point) {
      running -= input.changesNewestFirst[i]!.delta;
      i++;
    }
    out.push(running);
  }

  return out;
}

/**
 * Build the complete list of net-worth-changing events from store data,
 * sorted newest-first (matching the backward-walk replay direction).
 *
 * Owns all per-entity construction loops and graceful-skip behavior. Logs
 * a `console.warn` for each anomaly (missing fields, unknown types) to aid
 * debugging. Never throws on data anomalies — bad rows are skipped so the
 * chart degrades gracefully rather than failing entirely.
 *
 * Caller is responsible for filtering inputs to net-worth-eligible
 * entities before passing in (`isActive && includeInNetWorth` for accounts,
 * `includeInNetWorth` for assets). Pre-filtering keeps the eligibility rules
 * in one place (the consumer) rather than smearing them across this module.
 */
export function buildNetWorthChanges(input: {
  accounts: ReadonlyArray<Account>;
  assets: ReadonlyArray<Asset>;
  transactions: ReadonlyArray<Transaction>;
  baseCurrency: CurrencyCode;
  rates: ExchangeRate[];
}): NetWorthChange[] {
  const { accounts, assets, transactions, baseCurrency, rates } = input;
  const accountById = new Map<string, Account>(accounts.map((a) => [a.id, a]));
  const initialBalances = deriveAccountInitialBalances(accounts, transactions);

  const changes: NetWorthChange[] = [];

  for (const tx of transactions) {
    const change = transactionToChange(tx, accountById, baseCurrency, rates);
    if (change) changes.push(change);
  }

  for (const account of accounts) {
    const initial = initialBalances.get(account.id) ?? 0;
    const change = accountToCreationChange(account, initial, baseCurrency, rates);
    if (change) changes.push(change);
  }

  for (const asset of assets) {
    const change = assetToCreationChange(asset, baseCurrency, rates);
    if (change) changes.push(change);
  }

  // Newest-first to match the backward-walk replay direction.
  changes.sort((a, b) => b.date.getTime() - a.date.getTime());
  return changes;
}

/**
 * For each account in `accounts`, derive the balance it had immediately
 * after creation (before any transactions hit it).
 *
 * Computed in a single O(transactions) walk: for each tx, attribute its
 * signed effect to whichever account(s) it touches. Initial balance =
 * current balance − sum of all post-creation effects.
 *
 * Accounts not present in `accounts` (e.g. deleted) are ignored — the
 * caller has already decided which accounts contribute to net worth.
 */
export function deriveAccountInitialBalances(
  accounts: ReadonlyArray<Account>,
  transactions: ReadonlyArray<Transaction>
): Map<string, number> {
  const netSignedChange = new Map<string, number>();
  for (const account of accounts) netSignedChange.set(account.id, 0);

  for (const tx of transactions) {
    // Source side
    if (netSignedChange.has(tx.accountId)) {
      const effect = accountBalanceDeltaFromTx(tx, tx.accountId);
      if (effect !== 0) {
        netSignedChange.set(tx.accountId, netSignedChange.get(tx.accountId)! + effect);
      }
    }
    // Destination side (transfers)
    if (tx.toAccountId && netSignedChange.has(tx.toAccountId)) {
      const effect = accountBalanceDeltaFromTx(tx, tx.toAccountId);
      if (effect !== 0) {
        netSignedChange.set(tx.toAccountId, netSignedChange.get(tx.toAccountId)! + effect);
      }
    }
  }

  const initial = new Map<string, number>();
  for (const account of accounts) {
    initial.set(account.id, account.balance - (netSignedChange.get(account.id) ?? 0));
  }
  return initial;
}

// ── Internal: per-entity change construction ──────────────────────────────

/**
 * Convert a single transaction into a `NetWorthChange`, or null if the
 * transaction has no net effect (transfers, zero-delta adjustments) or
 * cannot be classified (data anomalies — logged via console.warn).
 *
 * Exported for unit testing; consumers should use `buildNetWorthChanges`.
 */
export function transactionToChange(
  tx: Transaction,
  accountById: ReadonlyMap<string, Account>,
  baseCurrency: CurrencyCode,
  rates: ExchangeRate[]
): NetWorthChange | null {
  switch (tx.type) {
    case 'income': {
      const delta = convertAmount(tx.amount, tx.currency, baseCurrency, rates);
      return delta === 0 ? null : { date: getStartOfDay(new Date(tx.date)), delta };
    }
    case 'expense': {
      // Cash decreased (delta = -amount). For loan-payment expenses, the
      // principal portion ALSO reduced debt (a liability) — equivalent to
      // adding the principal back to net worth at the moment of payment.
      const cashDelta = -convertAmount(tx.amount, tx.currency, baseCurrency, rates);
      const principalRecovery = tx.loanPrincipalPortion
        ? convertAmount(tx.loanPrincipalPortion, tx.currency, baseCurrency, rates)
        : 0;
      const delta = cashDelta + principalRecovery;
      return delta === 0 ? null : { date: getStartOfDay(new Date(tx.date)), delta };
    }
    case 'transfer':
      // Net-zero across the two accounts when both are the same liability
      // class (asset↔asset or liability↔liability). For mixed-class
      // transfers (e.g. checking → credit-card payoff), the underlying
      // account-update logic in calculateBalanceAdjustment is itself
      // arguably wrong — that's tracked separately. The chart treats all
      // transfers as net-zero here for now.
      return null;
    case 'balance_adjustment': {
      if (!tx.adjustment) {
        console.warn(
          '[netWorthHistory] balance_adjustment missing adjustment metadata; skipping:',
          tx.id
        );
        return null;
      }
      const account = accountById.get(tx.accountId);
      if (!account) {
        console.warn(
          '[netWorthHistory] balance_adjustment references unknown account; skipping:',
          tx.id,
          tx.accountId
        );
        return null;
      }
      const converted = convertAmount(tx.adjustment.delta, tx.currency, baseCurrency, rates);
      const delta = converted * accountNetWorthMultiplier(account);
      return delta === 0 ? null : { date: getStartOfDay(new Date(tx.date)), delta };
    }
    default:
      assertNever(tx.type, 'transactionToChange');
  }
}

/**
 * Convert an account into its creation event. Returns null when the
 * account has no `createdAt` (data anomaly — logged) or when the initial
 * balance is zero (no contribution to chart).
 */
export function accountToCreationChange(
  account: Account,
  initialBalance: number,
  baseCurrency: CurrencyCode,
  rates: ExchangeRate[]
): NetWorthChange | null {
  if (!account.createdAt) {
    console.warn(
      '[netWorthHistory] account missing createdAt; skipping creation event:',
      account.id
    );
    return null;
  }
  const converted = convertAmount(initialBalance, account.currency, baseCurrency, rates);
  const delta = converted * accountNetWorthMultiplier(account);
  if (delta === 0) return null;
  return { date: getStartOfDay(new Date(account.createdAt)), delta };
}

/**
 * Convert an asset into its creation event. Returns null when the asset
 * has no `createdAt` (data anomaly — logged) or when its current value is
 * zero.
 *
 * Assets always contribute positively (no liability multiplier — a "loan"
 * tied to an asset is mirrored as a separate `loan`-type Account with its
 * own creation event, see `syncLinkedLoanAccount` in assetsStore).
 */
export function assetToCreationChange(
  asset: Asset,
  baseCurrency: CurrencyCode,
  rates: ExchangeRate[]
): NetWorthChange | null {
  if (!asset.createdAt) {
    console.warn('[netWorthHistory] asset missing createdAt; skipping creation event:', asset.id);
    return null;
  }
  const delta = convertAmount(asset.currentValue, asset.currency, baseCurrency, rates);
  if (delta === 0) return null;
  return { date: getStartOfDay(new Date(asset.createdAt)), delta };
}
