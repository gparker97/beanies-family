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

import type { TransactionType } from '@/types/models';

/**
 * Calculate how a transaction affects an account balance.
 * Income adds, expense subtracts, transfer debits source and credits destination.
 * Balance adjustments return 0 — they are audit echoes of an already-applied
 * balance change and must NEVER cascade a second time.
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
      return 0;
  }
}
