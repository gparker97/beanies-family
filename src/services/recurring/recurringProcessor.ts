import * as accountRepo from '@/services/indexeddb/repositories/accountRepository';
import * as recurringRepo from '@/services/indexeddb/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/indexeddb/repositories/transactionRepository';
import type { RecurringItem, CreateTransactionInput } from '@/types/models';
import {
  toDateInputValue,
  addDays,
  addMonths,
  addYears,
  getStartOfDay,
  parseLocalDate,
} from '@/utils/date';

export interface ProcessResult {
  processed: number;
  errors: string[];
}

/**
 * Process all due recurring items and generate transactions.
 * Should be called on app startup.
 */
export async function processRecurringItems(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, errors: [] };

  try {
    const activeItems = await recurringRepo.getActiveRecurringItems();
    const now = new Date();
    const today = getStartOfDay(now);

    for (const item of activeItems) {
      try {
        // Skip if end date has passed
        if (item.endDate && parseLocalDate(item.endDate) < today) {
          // Deactivate the item since it's expired
          await recurringRepo.updateRecurringItem(item.id, { isActive: false });
          continue;
        }

        // Calculate all due dates since last processed
        const dueDates = getDueDatesSince(item, today);

        for (const dueDate of dueDates) {
          // Create transaction for this due date
          const success = await createTransactionFromRecurring(item, dueDate);
          if (success) {
            result.processed++;
          }
        }

        // Update last processed date
        if (dueDates.length > 0) {
          const lastDue = dueDates[dueDates.length - 1];
          if (lastDue) {
            await recurringRepo.updateLastProcessedDate(item.id, toDateInputValue(lastDue));
          }
        }
      } catch (e) {
        result.errors.push(`Failed to process ${item.description}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    result.errors.push(`Failed to load recurring items: ${(e as Error).message}`);
  }

  return result;
}

/**
 * Calculate all due dates between last processed and today (inclusive).
 */
function getDueDatesSince(item: RecurringItem, today: Date): Date[] {
  const dueDates: Date[] = [];
  const startDate = parseLocalDate(item.startDate);

  // Determine the starting point for calculation
  let checkDate: Date;
  if (item.lastProcessedDate) {
    checkDate = getNextDueDate(item, parseLocalDate(item.lastProcessedDate));
  } else {
    checkDate = getFirstDueDate(item, startDate);
  }

  // Collect all due dates up to and including today
  while (checkDate <= today) {
    // Check end date
    if (item.endDate && checkDate > parseLocalDate(item.endDate)) {
      break;
    }

    dueDates.push(new Date(checkDate));
    checkDate = getNextDueDate(item, checkDate);
  }

  return dueDates;
}

/**
 * Get the first due date on or after start date.
 */
function getFirstDueDate(item: RecurringItem, startDate: Date): Date {
  switch (item.frequency) {
    case 'daily':
      return getStartOfDay(startDate);

    case 'monthly': {
      const result = new Date(startDate);
      result.setDate(Math.min(item.dayOfMonth, getDaysInMonth(result)));
      result.setHours(0, 0, 0, 0);
      // If the day has passed this month, move to next month
      if (result < startDate) {
        result.setMonth(result.getMonth() + 1);
        result.setDate(Math.min(item.dayOfMonth, getDaysInMonth(result)));
      }
      return result;
    }

    case 'yearly': {
      const result = new Date(startDate);
      const month = (item.monthOfYear ?? 1) - 1; // monthOfYear is 1-12, JS months are 0-11
      result.setMonth(month);
      result.setDate(Math.min(item.dayOfMonth, getDaysInMonth(result)));
      result.setHours(0, 0, 0, 0);
      // If the date has passed this year, move to next year
      if (result < startDate) {
        result.setFullYear(result.getFullYear() + 1);
        result.setMonth(month);
        result.setDate(Math.min(item.dayOfMonth, getDaysInMonth(result)));
      }
      return result;
    }

    default:
      return getStartOfDay(startDate);
  }
}

/**
 * Get the next due date after a given date.
 */
function getNextDueDate(item: RecurringItem, afterDate: Date): Date {
  switch (item.frequency) {
    case 'daily':
      return addDays(afterDate, 1);

    case 'monthly': {
      const next = addMonths(afterDate, 1);
      next.setDate(Math.min(item.dayOfMonth, getDaysInMonth(next)));
      next.setHours(0, 0, 0, 0);
      return next;
    }

    case 'yearly': {
      const next = addYears(afterDate, 1);
      const month = (item.monthOfYear ?? 1) - 1;
      next.setMonth(month);
      next.setDate(Math.min(item.dayOfMonth, getDaysInMonth(next)));
      next.setHours(0, 0, 0, 0);
      return next;
    }

    default:
      return addDays(afterDate, 1);
  }
}

/**
 * Calculate the balance adjustment for an account based on transaction type.
 * Income adds to balance, expense subtracts from balance.
 */
function calculateBalanceAdjustment(
  type: 'income' | 'expense' | 'transfer',
  amount: number
): number {
  switch (type) {
    case 'income':
      return amount;
    case 'expense':
      return -amount;
    default:
      return 0;
  }
}

/**
 * Create a transaction from a recurring item.
 */
async function createTransactionFromRecurring(item: RecurringItem, date: Date): Promise<boolean> {
  const input: CreateTransactionInput = {
    accountId: item.accountId,
    type: item.type,
    amount: item.amount,
    currency: item.currency,
    category: item.category,
    date: toDateInputValue(date),
    description: item.description,
    isReconciled: false,
    recurringItemId: item.id,
  };

  try {
    await transactionRepo.createTransaction(input);

    // Update account balance
    const account = await accountRepo.getAccountById(item.accountId);
    if (account) {
      const adjustment = calculateBalanceAdjustment(item.type, item.amount);
      await accountRepo.updateAccountBalance(item.accountId, account.balance + adjustment);
    }

    return true;
  } catch (e) {
    console.error('Failed to create transaction from recurring:', e);
    return false;
  }
}

/**
 * Get number of days in a month.
 */
function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * Preview upcoming transaction dates for a recurring item.
 * Useful for displaying in the UI.
 */
export function previewUpcomingDates(item: RecurringItem, count: number = 5): Date[] {
  const dates: Date[] = [];
  const now = new Date();
  const today = getStartOfDay(now);

  let nextDate = item.lastProcessedDate
    ? getNextDueDate(item, parseLocalDate(item.lastProcessedDate))
    : getFirstDueDate(item, parseLocalDate(item.startDate));

  // If next date is in the past, advance to future
  while (nextDate < today) {
    nextDate = getNextDueDate(item, nextDate);
  }

  for (let i = 0; i < count; i++) {
    if (item.endDate && nextDate > parseLocalDate(item.endDate)) {
      break;
    }
    dates.push(new Date(nextDate));
    nextDate = getNextDueDate(item, nextDate);
  }

  return dates;
}

/**
 * Get the next due date for a recurring item (for display purposes).
 */
export function getNextDueDateForItem(item: RecurringItem): Date | null {
  const dates = previewUpcomingDates(item, 1);
  return dates.length > 0 ? (dates[0] ?? null) : null;
}

/**
 * Format frequency for display.
 */
export function formatFrequency(item: RecurringItem): string {
  switch (item.frequency) {
    case 'daily':
      return 'Daily';
    case 'monthly':
      return `Monthly (${getOrdinalSuffix(item.dayOfMonth)})`;
    case 'yearly': {
      const month = getMonthName(item.monthOfYear ?? 1);
      return `Yearly (${month} ${getOrdinalSuffix(item.dayOfMonth)})`;
    }
    default:
      return item.frequency;
  }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  const suffix = s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th';
  return n + suffix;
}

function getMonthName(month: number): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return months[(month - 1) % 12] ?? 'Jan';
}
