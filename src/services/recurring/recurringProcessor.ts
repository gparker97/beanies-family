import * as accountRepo from '@/services/automerge/repositories/accountRepository';
import * as assetRepo from '@/services/automerge/repositories/assetRepository';
import * as goalRepo from '@/services/automerge/repositories/goalRepository';
import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import type { RecurringItem, CreateTransactionInput } from '@/types/models';
import {
  toDateInputValue,
  addDays,
  addMonths,
  addYears,
  getStartOfDay,
  parseLocalDate,
  extractDatePart,
} from '@/utils/date';
import { computeGoalAllocRaw, signedAccountDelta } from '@/utils/finance';
import { calculateAmortization, findLoanDetails } from '@/utils/loanPayment';
import { firstDueOnOrAfter, nextDueAfter } from '@/services/recurrence/recurrenceEngine';
import { resolveRecurringItemRule } from '@/services/recurrence/adapters';
import { reportError } from '@/utils/errorReporter';
import * as perfTiming from '@/utils/perfTiming';

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

  const startedAt = performance.now();
  try {
    const activeItems = await recurringRepo.getActiveRecurringItems();
    const allTransactions = await transactionRepo.getAllTransactions();
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
          // Dedup: skip if a transaction already exists for this item + date
          const dateStr = toDateInputValue(dueDate);
          const alreadyExists = allTransactions.some(
            (tx) => tx.recurringItemId === item.id && extractDatePart(tx.date) === dateStr
          );
          if (alreadyExists) continue;

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
        // #70: a rule that reaches expansion and throws is a real (rare) defect —
        // surface it to the firehose (non-critical: no data at risk, the item is
        // just skipped this run). Fixed enums only; never the description.
        reportError({
          surface: 'recurrence',
          message: 'expansion-failed',
          severity: 'error',
          error: e,
          context: { recur_surface: 'transaction', recur_reason: item.rule ? 'rule' : 'legacy' },
        });
      }
    }
  } catch (e) {
    result.errors.push(`Failed to load recurring items: ${(e as Error).message}`);
  }

  // Correlates a slow expansion regression by family in CloudWatch. Sub-floor
  // (fast) runs are dropped by the perf floor; only meaningful durations surface.
  perfTiming.record('recurrence.expand', performance.now() - startedAt);

  return result;
}

/**
 * Calculate all due dates between last processed and today (inclusive).
 */
function getDueDatesSince(item: RecurringItem, today: Date): Date[] {
  const dueDates: Date[] = [];
  const startDate = parseLocalDate(item.startDate);

  // Determine the starting point for calculation
  let checkDate: Date | null;
  if (item.lastProcessedDate) {
    checkDate = getNextDueDate(item, parseLocalDate(item.lastProcessedDate));
  } else {
    checkDate = getFirstDueDate(item, startDate);
  }

  // Collect all due dates up to and including today
  while (checkDate && checkDate <= today) {
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
 * Get all due dates for a recurring item within a date range (inclusive).
 * Used for projecting recurring transactions into future months.
 */
export function getDueDatesInRange(item: RecurringItem, rangeStart: Date, rangeEnd: Date): Date[] {
  const dueDates: Date[] = [];
  const startDate = parseLocalDate(item.startDate);

  // Begin from the item's first due date
  let checkDate: Date | null = getFirstDueDate(item, startDate);

  // Advance past rangeStart
  while (checkDate && checkDate < rangeStart) {
    checkDate = getNextDueDate(item, checkDate);
  }

  // Collect dates within range
  while (checkDate && checkDate <= rangeEnd) {
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
 *
 * Dual-path (#70): a rule-bearing item expands through the canonical engine;
 * a legacy item (no `rule`) runs the exact original switch below, unchanged, so
 * existing `.beanpod` data behaves identically. Returns `null` when the rule has
 * no occurrence on/after `startDate` (e.g. an already-elapsed `onDate` end).
 */
function getFirstDueDate(item: RecurringItem, startDate: Date): Date | null {
  if (item.rule) {
    const { rule, anchor } = resolveRecurringItemRule(item);
    const ymd = firstDueOnOrAfter(rule, anchor, toDateInputValue(startDate));
    return ymd ? parseLocalDate(ymd) : null;
  }
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
 * Get the next due date strictly after a given date.
 *
 * Dual-path (#70): rule-bearing items use the engine (which honors interval,
 * weekdays, and `afterCount`/`onDate` ends — returning `null` when the series
 * has ended); legacy items run the original switch unchanged.
 */
function getNextDueDate(item: RecurringItem, afterDate: Date): Date | null {
  if (item.rule) {
    const { rule, anchor } = resolveRecurringItemRule(item);
    const ymd = nextDueAfter(rule, anchor, toDateInputValue(afterDate));
    return ymd ? parseLocalDate(ymd) : null;
  }
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
    ...(item.activityId ? { activityId: item.activityId } : {}),
  };

  // Goal allocation (compute at generation time with guardrail)
  if (item.goalId && item.goalAllocMode && item.goalAllocValue) {
    const goal = await goalRepo.getGoalById(item.goalId);
    if (goal && !goal.isCompleted) {
      const raw = computeGoalAllocRaw(item.goalAllocMode, item.goalAllocValue, item.amount);
      const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
      const applied = Math.min(raw, remaining);
      if (applied > 0) {
        input.goalId = item.goalId;
        input.goalAllocMode = item.goalAllocMode;
        input.goalAllocValue = item.goalAllocValue;
        input.goalAllocApplied = applied;
      }
    }
  }

  // Loan payment allocation (compute amortization at generation time)
  if (item.loanId) {
    const allAssets = await assetRepo.getAllAssets();
    const allAccounts = await accountRepo.getAllAccounts();
    const loan = findLoanDetails(item.loanId, allAssets, allAccounts);
    if (loan && loan.outstandingBalance > 0) {
      const result = calculateAmortization(loan.outstandingBalance, loan.interestRate, item.amount);
      input.loanId = item.loanId;
      input.loanInterestPortion = result.interestPortion;
      input.loanPrincipalPortion = result.principalPortion;
    }
  }

  try {
    await transactionRepo.createTransaction(input);

    // Update account balance
    const account = await accountRepo.getAccountById(item.accountId);
    if (account) {
      // Liability-aware: a recurring expense on a credit card raises what's owed.
      const adjustment = signedAccountDelta(item.type, item.amount, account.type);
      await accountRepo.updateAccountBalance(item.accountId, account.balance + adjustment);
    }

    // Credit goal progress
    if (input.goalAllocApplied && input.goalId) {
      const goal = await goalRepo.getGoalById(input.goalId);
      if (goal) {
        await goalRepo.updateGoalProgress(
          input.goalId,
          goal.currentAmount + input.goalAllocApplied
        );
      }
    }

    // Reduce loan balance
    if (input.loanPrincipalPortion && input.loanId) {
      const allAssets = await assetRepo.getAllAssets();
      const allAccounts = await accountRepo.getAllAccounts();
      const loan = findLoanDetails(input.loanId, allAssets, allAccounts);
      if (loan) {
        const newBalance = Math.max(0, loan.outstandingBalance - input.loanPrincipalPortion);
        if (loan.type === 'asset') {
          const asset = allAssets.find((a) => a.id === loan.entityId);
          if (asset?.loan) {
            await assetRepo.updateAsset(loan.entityId, {
              loan: { ...asset.loan, outstandingBalance: newBalance },
            });
            // syncLinkedLoanAccount won't fire from repo call — sync linked account manually
            if (loan.linkedAccountId) {
              await accountRepo.updateAccountBalance(loan.linkedAccountId, newBalance);
            }
          }
        } else {
          await accountRepo.updateAccountBalance(loan.entityId, newBalance);
        }
      }
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

  let nextDate: Date | null = item.lastProcessedDate
    ? getNextDueDate(item, parseLocalDate(item.lastProcessedDate))
    : getFirstDueDate(item, parseLocalDate(item.startDate));

  // If next date is in the past, advance to future
  while (nextDate && nextDate < today) {
    nextDate = getNextDueDate(item, nextDate);
  }

  for (let i = 0; i < count; i++) {
    if (!nextDate) break;
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
 * Remove duplicate recurring transactions from the Automerge document.
 *
 * CRDT merges can create duplicates when processRecurringItems runs on a
 * stale cache and the background sync later merges in the remote doc that
 * already has transactions for the same recurringItemId + date (but with
 * different UUIDs from a different actor). This function scans all
 * transactions, groups them by recurringItemId + date, and deletes extras
 * — keeping only the earliest-created transaction per group.
 *
 * Should be called after any CRDT merge that could introduce duplicates.
 */
export async function deduplicateRecurringTransactions(): Promise<number> {
  const allTransactions = await transactionRepo.getAllTransactions();

  // Group recurring transactions by recurringItemId + date
  const groups = new Map<string, { id: string; createdAt: string }[]>();
  for (const tx of allTransactions) {
    if (!tx.recurringItemId) continue;
    const key = `${tx.recurringItemId}|${extractDatePart(tx.date)}`;
    const group = groups.get(key);
    if (group) {
      group.push({ id: tx.id, createdAt: tx.createdAt });
    } else {
      groups.set(key, [{ id: tx.id, createdAt: tx.createdAt }]);
    }
  }

  // Delete duplicates (keep the earliest-created transaction per group)
  let deleted = 0;
  for (const entries of groups.values()) {
    if (entries.length <= 1) continue;
    // Sort by createdAt ascending — keep the first, delete the rest
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 1; i < entries.length; i++) {
      await transactionRepo.deleteTransaction(entries[i]!.id);
      deleted++;
    }
  }

  if (deleted > 0) {
    console.warn(`[recurringProcessor] Removed ${deleted} duplicate recurring transaction(s)`);
  }
  return deleted;
}
