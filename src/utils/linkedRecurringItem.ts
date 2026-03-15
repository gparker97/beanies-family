/**
 * Shared helper for managing entity-linked recurring items.
 * Called by assetsStore, accountsStore, and activityStore to create/update/delete
 * linked recurring payment items when entities are saved.
 *
 * Uses useRecurringStore() internally — must be called from within Vue's setup context
 * (store actions satisfy this requirement).
 */

import { useRecurringStore } from '@/stores/recurringStore';
import { toDateInputValue } from '@/utils/date';
import type { CurrencyCode, CreateRecurringItemInput, RecurringFrequency } from '@/types/models';

/**
 * Create, update, or delete a linked recurring item based on entity state.
 *
 * @returns The recurring item ID (new or existing), or undefined if deleted/not created.
 */
export async function syncEntityLinkedRecurringItem(opts: {
  enabled: boolean;
  existingItemId?: string;
  accountId?: string;
  amount: number;
  currency: CurrencyCode;
  category: string;
  description: string;
  loanId?: string;
  activityId?: string;
  startDate?: string;
  frequency?: 'monthly' | 'yearly';
}): Promise<string | undefined> {
  const recurringStore = useRecurringStore();

  // Disabled or no pay-from account — delete existing if any
  if (!opts.enabled || !opts.accountId) {
    if (opts.existingItemId) {
      await recurringStore.deleteRecurringItem(opts.existingItemId);
    }
    return undefined;
  }

  const startDateObj = opts.startDate ? new Date(opts.startDate + 'T00:00:00') : new Date();
  const dayOfMonth = startDateObj.getDate();
  const freq: RecurringFrequency = opts.frequency ?? 'monthly';

  const itemData: CreateRecurringItemInput = {
    accountId: opts.accountId,
    type: 'expense',
    amount: opts.amount,
    currency: opts.currency,
    category: opts.category,
    description: opts.description,
    frequency: freq,
    dayOfMonth: Math.min(dayOfMonth, 28),
    ...(freq === 'yearly' ? { monthOfYear: startDateObj.getMonth() + 1 } : {}),
    startDate: opts.startDate || toDateInputValue(new Date()),
    isActive: true,
    ...(opts.loanId ? { loanId: opts.loanId } : {}),
    ...(opts.activityId ? { activityId: opts.activityId } : {}),
  };

  if (opts.existingItemId) {
    // Update existing — preserve fields not in our control
    await recurringStore.updateRecurringItem(opts.existingItemId, itemData);
    return opts.existingItemId;
  } else {
    // Create new
    const item = await recurringStore.createRecurringItem(itemData);
    return item?.id;
  }
}
