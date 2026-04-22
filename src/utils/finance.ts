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
  sessionsPerWeek?: number;
  feeCustomPeriod?: number;
  feeCustomPeriodUnit?: 'weeks' | 'months';
}): number {
  const {
    feeSchedule,
    feeAmount,
    sessionsPerWeek = 1,
    feeCustomPeriod,
    feeCustomPeriodUnit,
  } = opts;
  if (!feeAmount || feeAmount <= 0) return 0;

  let monthly: number;
  switch (feeSchedule) {
    case 'per_session':
      monthly = (feeAmount * Math.max(sessionsPerWeek, 1) * 52) / 12;
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
 * The signed amount by which `tx` historically changed the balance of
 * `accountId`. Returns 0 if the transaction doesn't reference this account.
 *
 * Sign convention:
 * - Income on this account → `+amount`
 * - Expense on this account → `-amount`
 * - Transfer with this account as source → `-amount`; as destination → `+amount`
 * - Balance adjustment on this account → `adjustment.delta` (signed)
 *
 * For income/expense/transfer, this composes `calculateBalanceAdjustment`
 * with the correct source/destination perspective. For balance_adjustment,
 * it returns the raw delta — which differs from `calculateBalanceAdjustment`
 * (that returns 0 for cascade short-circuit reasons). For *historical
 * reconstruction* the delta IS the effect.
 *
 * Logs a warn and returns 0 if a `balance_adjustment` row is missing its
 * `adjustment` metadata (data corruption — should never happen in practice).
 *
 * @see calculateBalanceAdjustment — for the cascade-time application path
 */
export function accountBalanceDeltaFromTx(tx: Transaction, accountId: string): number {
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
      if (tx.accountId === accountId) return calculateBalanceAdjustment(tx.type, tx.amount, true);
      if (tx.toAccountId === accountId)
        return calculateBalanceAdjustment(tx.type, tx.amount, false);
      return 0;
    }
    default:
      assertNever(tx.type, 'accountBalanceDeltaFromTx');
  }
}
