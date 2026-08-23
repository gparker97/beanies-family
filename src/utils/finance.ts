/**
 * Shared financial calculation utilities.
 * Pure functions used by transactionsStore, recurringProcessor, and TransactionModal.
 */

/**
 * Compute the raw goal allocation amount from mode, value, and transaction amount.
 * Does NOT apply the guardrail (capping to remaining) — callers handle that.
 */
export function computeGoalAllocRaw(
  allocMode: 'percentage' | 'fixed',
  allocValue: number,
  txAmount: number
): number {
  return allocMode === 'percentage' ? (txAmount * allocValue) / 100 : allocValue;
}

/**
 * Calculate the monthly equivalent of a fee charged at any frequency.
 * Used by ActivityModal (UI preview) and activityStore (recurring item sync).
 */
export function calculateMonthlyFee(opts: {
  feeSchedule: string;
  feeAmount: number;
  /**
   * How many times the activity actually happens per month — from
   * `monthlyFactor(rule)` (#70). REQUIRED for `per_session`: it previously took
   * a `sessionsPerWeek` that was only ever populated for weekly activities, so
   * every other cadence silently billed as if it happened every week (a
   * fortnightly class at 2x, a monthly one at 4.33x, a yearly one at 52x).
   */
  monthlyOccurrences: number;
  feeCustomPeriod?: number;
  feeCustomPeriodUnit?: 'weeks' | 'months';
}): number {
  const { feeSchedule, feeAmount, monthlyOccurrences, feeCustomPeriod, feeCustomPeriodUnit } = opts;
  if (!feeAmount || feeAmount <= 0) return 0;

  let monthly: number;
  switch (feeSchedule) {
    case 'per_session':
      monthly = feeAmount * Math.max(monthlyOccurrences, 0);
      break;
    case 'weekly':
      monthly = (feeAmount * 52) / 12;
      break;
    case 'monthly':
      monthly = feeAmount;
      break;
    case 'quarterly':
      monthly = feeAmount / 3;
      break;
    case 'yearly':
      monthly = feeAmount / 12;
      break;
    case 'all':
      // Total for all sessions — not a per-period charge, return full amount
      monthly = feeAmount;
      break;
    case 'custom':
      if (feeCustomPeriodUnit === 'weeks' && feeCustomPeriod && feeCustomPeriod > 0) {
        monthly = (feeAmount / feeCustomPeriod) * (52 / 12);
      } else if (feeCustomPeriodUnit === 'months' && feeCustomPeriod && feeCustomPeriod > 0) {
        monthly = feeAmount / feeCustomPeriod;
      } else {
        monthly = feeAmount;
      }
      break;
    default:
      // Legacy 'termly' and unknown — passthrough
      monthly = feeAmount;
  }
  return Math.round(monthly * 100) / 100;
}

import type { Account, AccountType, Transaction, TransactionType } from '@/types/models';
import { assertNever } from '@/utils/assertNever';

/**
 * Calculate how a transaction affects an account balance at write time
 * (cascade-time semantics). Income adds, expense subtracts, transfer debits
 * source and credits destination. Balance adjustments return 0 — they are
 * audit echoes of an already-applied balance change and must NEVER cascade
 * a second time.
 *
 * @see accountBalanceDeltaFromTx — for the historical-reconstruction path
 *   that DOES count the balance_adjustment delta (since the delta IS the
 *   historical effect, even though the cascade was short-circuited at write).
 */
export function calculateBalanceAdjustment(
  type: TransactionType,
  amount: number,
  isSourceAccount: boolean = true
): number {
  switch (type) {
    case 'income':
      return amount;
    case 'expense':
      return -amount;
    case 'transfer':
      return isSourceAccount ? -amount : amount;
    case 'balance_adjustment':
      return 0;
    default:
      assertNever(type, 'calculateBalanceAdjustment');
  }
}

/**
 * The signed amount by which a transaction changes ONE account's stored
 * `balance`, accounting for whether that account is an asset or a liability.
 *
 * This is THE single source of truth for balance signs across the app — the
 * cascade (`transactionsStore`), the recurring processor, and historical
 * reconstruction (`accountBalanceDeltaFromTx`) all route through it. Do NOT
 * re-derive the liability sign at call sites.
 *
 * Liability balances (`credit_card`, `loan`) are stored as a positive "amount
 * owed", so the effect is the INVERSE of the asset-perspective primitive:
 * - Expense on a card (a purchase) → owed increases (`+amount`).
 * - Income/refund on a card → owed decreases (`−amount`).
 * - Transfer TO a card (a payoff, this account is the destination) → owed
 *   decreases; transfer FROM a card (a cash advance, this account is the
 *   source) → owed increases.
 * Asset accounts are unchanged (multiplier `+1`).
 *
 * `balance_adjustment` is 0 here (cascade short-circuit), same as the primitive.
 */
export function signedAccountDelta(
  type: TransactionType,
  amount: number,
  accountType: AccountType,
  isSourceAccount: boolean = true
): number {
  const base = calculateBalanceAdjustment(type, amount, isSourceAccount);
  if (base === 0) return 0; // normalize (avoid -0 for balance_adjustment / zero amounts)
  return isLiabilityType(accountType) ? -base : base;
}

/**
 * True when an account's balance represents money owed (subtracts from net
 * worth) rather than money held. Currently `credit_card` and `loan`.
 *
 * @example
 *   isLiabilityType('checking')    // false
 *   isLiabilityType('credit_card') // true
 *   isLiabilityType('loan')        // true
 */
export function isLiabilityType(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan';
}

/**
 * The sign multiplier to apply to an account's balance when summing into
 * net worth. `+1` for asset accounts, `-1` for liability accounts (so a
 * $1,000 credit card balance contributes `-$1,000` to net worth).
 *
 * @example
 *   const netWorthContribution = balance * accountNetWorthMultiplier(account);
 */
export function accountNetWorthMultiplier(account: Account): -1 | 1 {
  return isLiabilityType(account.type) ? -1 : 1;
}

/**
 * The signed amount by which `tx` historically changed the stored balance of
 * `accountId`, accounting for whether the account is an asset or a liability.
 * Returns 0 if the transaction doesn't reference this account.
 *
 * Sign convention (via `signedAccountDelta`, so it matches the live cascade):
 * - Income/expense/transfer on an asset account → the asset-perspective sign.
 * - The same on a liability account → inverted (a card purchase raises owed).
 * - The destination leg of a cross-currency transfer uses `toAmount` (the
 *   amount actually credited in the destination's currency), falling back to
 *   `amount` for same-currency transfers.
 * - Balance adjustment on this account → `adjustment.delta` (the raw signed
 *   stored-balance change — NOT re-signed; it already IS the effect).
 *
 * `accountsById` supplies each account's type. Logs a warn and returns 0 if a
 * referenced account can't be resolved, or if a `balance_adjustment` row is
 * missing its `adjustment` metadata (data anomalies — no silent miscount).
 *
 * @see signedAccountDelta — the cascade-time application path (same signs)
 */
export function accountBalanceDeltaFromTx(
  tx: Transaction,
  accountId: string,
  accountsById: ReadonlyMap<string, Account>
): number {
  switch (tx.type) {
    case 'balance_adjustment': {
      if (tx.accountId !== accountId) return 0;
      if (!tx.adjustment) {
        console.warn(
          '[accountBalanceDeltaFromTx] balance_adjustment missing adjustment metadata:',
          tx.id
        );
        return 0;
      }
      return tx.adjustment.delta;
    }
    case 'income':
    case 'expense':
    case 'transfer': {
      const isSource = tx.accountId === accountId;
      const isDest = tx.toAccountId === accountId;
      if (!isSource && !isDest) return 0;
      const account = accountsById.get(accountId);
      if (!account) {
        console.warn('[accountBalanceDeltaFromTx] account not found for tx:', accountId, tx.id);
        return 0;
      }
      // Destination of a transfer is credited the converted `toAmount`.
      const magnitude = isDest ? (tx.toAmount ?? tx.amount) : tx.amount;
      return signedAccountDelta(tx.type, magnitude, account.type, isSource);
    }
    default:
      assertNever(tx.type, 'accountBalanceDeltaFromTx');
  }
}
