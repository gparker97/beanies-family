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
 * Calculate how a transaction affects an account balance.
 * Income adds, expense subtracts, transfer debits source and credits destination.
 */
export function calculateBalanceAdjustment(
  type: 'income' | 'expense' | 'transfer',
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
    default:
      return 0;
  }
}
