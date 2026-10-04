import * as accountRepo from '@/services/automerge/repositories/accountRepository';
import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import type { RecurringItem, CreateTransactionInput, DisplayTransaction } from '@/types/models';
import {
  toDateInputValue,
  addDays,
  addMonths,
  addYears,
  getStartOfDay,
  parseLocalDate,
} from '@/utils/date';
import { firstDueOnOrAfter, nextDueAfter } from '@/services/recurrence/recurrenceEngine';
import { resolveTransactionRule } from '@/services/recurrence/adapters';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import * as perfTiming from '@/utils/perfTiming';
import { recurringInstanceDate, recurringInstanceKey } from '@/utils/recurringInstance';
import { ReadOnlyError, skipWhileReadOnly } from '@/services/automerge/worker/writeGate';
import { NoDocumentLoadedError, WorkerCrashError } from '@/services/automerge/worker/protocol';
import { isRemoteBlocker } from '@/types/sync';

export interface ProcessResult {
  processed: number;
  errors: string[];
}

/**
 * #95: recurring processing PAUSES while the family is read-only, rather than being allowlisted
 * past the write gate. A read-only family does not accumulate auto-generated transactions it
 * never chose, and nothing is lost: once the family is writable again, the next run's
 * `lastProcessedDate` catch-up (`getDueDatesSince`) generates every instance missed meanwhile,
 * exactly as after any absence. Both exported writers check this, so their callers stay as they
 * are. `skipWhileReadOnly` reads the installed gate verdict (`entitlementStore.isReadOnly`)
 * and logs the pause once per session.
 */
const RECURRING_SURFACE = 'recurring';

/**
 * Process all due recurring items and generate transactions.
 * Should be called on app startup. Does nothing while the family is read-only (#95).
 */
export async function processRecurringItems(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, errors: [] };
  if (skipWhileReadOnly(RECURRING_SURFACE)) return result;

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

        // The cursor advances only past dates that are fully accounted for (created, already
        // present, or deliberately skipped) and STOPS at the first failure, so a failed date is
        // retried next run instead of being skipped forever (audit C7).
        let lastSettled: Date | null = null;
        for (const dueDate of dueDates) {
          // Dedup: skip if this due date's instance is already accounted for: a transaction for
          // this item exists ON the due date, or one STANDS FOR it (`recurringDueDate`, #107: a
          // statement line merged into this instance, written on the day the bank took the
          // money). Exact per due date, so a weekly item's other instances are unaffected.
          const dateStr = toDateInputValue(dueDate);
          const alreadyExists = allTransactions.some(
            (tx) => tx.recurringItemId === item.id && recurringInstanceDate(tx) === dateStr
          );
          if (!alreadyExists) {
            const outcome = await createTransactionFromRecurring(item, dueDate);
            if (outcome === 'failed') {
              result.errors.push(`Failed to generate ${item.description} for ${dateStr}`);
              break;
            }
            if (outcome === 'created') result.processed++;
          }
          lastSettled = dueDate;
        }

        if (lastSettled) {
          await recurringRepo.updateLastProcessedDate(item.id, toDateInputValue(lastSettled));
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
 * Ephemeral projected transactions for `items` over [rangeStart, rangeEnd]: one per due date,
 * never written anywhere. The ONE projection loop, shared by `useProjectedTransactions` (the
 * ledger's current/future month), `TransactionsPage` (next month's preview) and the statement
 * import matcher. `idPrefix` exists only because the next-month preview has always used its own
 * id namespace (`next-projected-`) so its rows can never collide with the current month's.
 */
export function projectRecurringTransactions(
  items: readonly RecurringItem[],
  rangeStart: Date,
  rangeEnd: Date,
  opts: { idPrefix?: string } = {}
): DisplayTransaction[] {
  const idPrefix = opts.idPrefix ?? 'projected';
  const projected: DisplayTransaction[] = [];
  for (const item of items) {
    for (const date of getDueDatesInRange(item, rangeStart, rangeEnd)) {
      projected.push({
        id: `${idPrefix}-${item.id}-${toDateInputValue(date)}`,
        accountId: item.accountId,
        type: item.type,
        amount: item.amount,
        currency: item.currency,
        category: item.category,
        date: toDateInputValue(date),
        description: item.description,
        recurringItemId: item.id,
        isReconciled: false,
        isProjected: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return projected;
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
    // A rule-bearing item always resolves; `null` here would mean an unmappable
    // shape (already logged), in which case fall through to the legacy switch.
    const resolved = resolveTransactionRule(item);
    if (resolved) {
      const ymd = firstDueOnOrAfter(resolved.rule, resolved.anchor, toDateInputValue(startDate));
      return ymd ? parseLocalDate(ymd) : null;
    }
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
    const resolved = resolveTransactionRule(item);
    if (resolved) {
      const ymd = nextDueAfter(resolved.rule, resolved.anchor, toDateInputValue(afterDate));
      return ymd ? parseLocalDate(ymd) : null;
    }
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

/** What one due date came to: `skipped` is settled (never retried), `failed` halts the item. */
type InstanceOutcome = 'created' | 'skipped' | 'failed';

/**
 * Consecutive cascade failures per recurring item, this session. A failure stops the cursor so
 * the date is retried next run; but an instance whose cascade fails EVERY run would pin the
 * cursor forever and silently stop the series, so after `MAX_CONSECUTIVE_FAILURES` the date is
 * skipped with a critical report. Reset on success. Only errors the cascade raised for THIS
 * item count: an infrastructure failure (`isInfrastructureError`) says nothing about the item,
 * so it stops the cursor without counting, and a slow week of worker trouble can never skip a
 * payment the family expects.
 */
const MAX_CONSECUTIVE_FAILURES = 3;
const consecutiveFailures = new Map<string, number>();

/** Test seam: forget the per-item failure counts. */
export function __resetRecurringFailureCountsForTesting(): void {
  consecutiveFailures.clear();
}

/**
 * Did the write fail for a reason outside this item: the worker crashed or timed out, has no
 * document loaded, the family is read-only, or the document itself is refused (a remote blocker)? Classified by
 * class/name, since these arrive on main as their real classes or as docClient's own errors.
 */
function isInfrastructureError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e instanceof WorkerCrashError || e.name === 'WorkerCrashError') return true;
  if (e instanceof ReadOnlyError || e.name === 'ReadOnlyError') return true;
  // The worker has no document loaded (boot, family switch, sign-out): a lifecycle state.
  if (e instanceof NoDocumentLoadedError || e.name === 'NoDocumentLoadedError') return true;
  if (isRemoteBlocker(e)) return true;
  // docClient's RPC deadline (`requestCore`) and its no-backend refusal are plain errors.
  return /^doc-worker (unavailable|'[^']*' (timed out|exceeded absolute deadline))/.test(e.message);
}

/**
 * Did the cascade refuse its ARGS (e.g. a non-finite amount)? That is deterministic: a retry
 * sends the same args and fails the same way, so it is a skip, never a retry. The worker names
 * the error `CascadeArgsError` (`transactionOps.CASCADE_ARGS_ERROR`); across the worker
 * boundary an unregistered name survives only as the message prefix, so both are checked.
 */
function isCascadeArgsError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === 'CascadeArgsError' ||
    e.message.includes('CascadeArgsError') ||
    e.message.startsWith('commitTransactionCascade: ')
  );
}

/**
 * Create a transaction from a recurring item: ONE worker cascade (`createTransactionCascade`),
 * so the row, its balance movement, the goal allocation and the loan amortisation (with the
 * linked loan account mirror) land together or not at all. The worker computes the allocation
 * cap and the loan portions on the FOLDED balances; this side only names the links.
 *
 * An item whose account is gone is skipped and logged, never materialised: a row against a
 * deleted account would move no balance and could never be reversed. (`accountsStore.
 * deleteAccount` deactivates such items; this covers data from before it did.)
 */
async function createTransactionFromRecurring(
  item: RecurringItem,
  date: Date
): Promise<InstanceOutcome> {
  if (!(await accountRepo.getAccountById(item.accountId))) {
    logEvent({
      level: 'warn',
      surface: 'recurring-processor',
      message: 'account-missing',
      context: { recur_surface: 'transaction', action: 'skip' },
    });
    return 'skipped';
  }

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
    // The goal link: the worker caps the allocation at what the goal still needs (nothing for
    // a completed or deleted goal) and writes `goalAllocApplied` itself.
    ...(item.goalId && item.goalAllocMode && item.goalAllocValue
      ? {
          goalId: item.goalId,
          goalAllocMode: item.goalAllocMode,
          goalAllocValue: item.goalAllocValue,
        }
      : {}),
    // The loan link: the worker amortises on the folded balance (a paid-off loan earns no
    // portions) and mirrors an asset loan onto its linked account, relatively.
    ...(item.loanId ? { loanId: item.loanId } : {}),
  };

  try {
    await transactionRepo.createTransactionCascade(input);
    consecutiveFailures.delete(item.id);
    return 'created';
  } catch (e) {
    console.error('Failed to create transaction from recurring:', e);
    // Fixed enums only; never the description or the date.
    if (isCascadeArgsError(e)) {
      // Deterministic: the same args fail the same way next run. Skip the date (the cursor
      // advances) rather than pin the series forever.
      consecutiveFailures.delete(item.id);
      reportError({
        surface: 'recurring-processor',
        message: 'recurring-cascade-invalid',
        severity: 'error',
        error: e,
        context: { recur_surface: 'transaction', action: 'skip-invalid' },
      });
      return 'skipped';
    }
    if (isInfrastructureError(e)) {
      // Not this item's fault: the date is retried next run and the give-up count is untouched.
      reportError({
        surface: 'recurring-processor',
        message: 'recurring-cascade-deferred',
        severity: 'warning',
        error: e,
        context: {
          recur_surface: 'transaction',
          action: 'defer-infrastructure',
          error_code: e instanceof Error ? e.name : 'unknown',
        },
      });
      return 'failed';
    }
    const failures = (consecutiveFailures.get(item.id) ?? 0) + 1;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      // The same instance failed every attempt: stop retrying it so the series continues.
      // Critical: a recurring payment the family expects did not land.
      consecutiveFailures.delete(item.id);
      reportError({
        surface: 'recurring-processor',
        message: 'recurring-cascade-gave-up',
        severity: 'critical',
        error: e,
        context: {
          recur_surface: 'transaction',
          action: 'skip-after-retries',
          consecutive_failures: failures,
        },
      });
      return 'skipped';
    }
    consecutiveFailures.set(item.id, failures);
    // This instance is retried next run (the cursor stops here).
    reportError({
      surface: 'recurring-processor',
      message: 'recurring-cascade-failed',
      severity: 'error',
      error: e,
      context: { recur_surface: 'transaction', action: 'create', consecutive_failures: failures },
    });
    return 'failed';
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
  // #95: the sweep deletes, so it is a write; it resumes with processing when writable again.
  if (skipWhileReadOnly(RECURRING_SURFACE)) return 0;
  const allTransactions = await transactionRepo.getAllTransactions();

  // Group recurring transactions by recurringItemId + date
  const groups = new Map<string, { id: string; createdAt: string }[]>();
  for (const tx of allTransactions) {
    // Keyed on the due date a row STANDS FOR (#107): a statement-merged row dated the 24th that
    // stands for the 28th is the 28th's instance, and must never be swept as a duplicate of a
    // real row that happens to be dated the 24th.
    const key = recurringInstanceKey(tx);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push({ id: tx.id, createdAt: tx.createdAt });
    } else {
      groups.set(key, [{ id: tx.id, createdAt: tx.createdAt }]);
    }
  }

  // Delete duplicates (keep the earliest-created transaction per group). Each delete is the
  // cascade in `dedup` mode (audit C7), naming the kept twin: the worker decides PER PAIR
  // (#117 writer flip). When either twin's movements were Counter increments both survived the
  // merge and the duplicate's are reversed; when both were absolute writes they collapsed into
  // ONE, so the worker deletes the row only (reversing would undo the survivor).
  let deleted = 0;
  let reversed = 0;
  let rowOnly = 0;
  let failed = 0;
  for (const entries of groups.values()) {
    if (entries.length <= 1) continue;
    // Sort by createdAt ascending — keep the first, delete the rest
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const survivorId = entries[0]!.id;
    for (let i = 1; i < entries.length; i++) {
      try {
        const res = await transactionRepo.deleteTransactionCascade(entries[i]!.id, {
          dedup: { survivorId },
        });
        if (res.found) {
          deleted++;
          if (res.reversed) reversed++;
          else rowOnly++;
        }
      } catch (e) {
        failed++;
        reportError({
          surface: 'recurring-dedup',
          message: 'duplicate-delete-failed',
          severity: 'error',
          error: e,
          context: { recur_surface: 'transaction', action: 'delete' },
        });
      }
    }
  }

  if (deleted > 0 || failed > 0) {
    console.warn(`[recurringProcessor] Removed ${deleted} duplicate recurring transaction(s)`);
    logEvent({
      level: failed > 0 ? 'warn' : 'info',
      surface: 'recurring-dedup',
      message: 'duplicates swept',
      context: {
        recur_surface: 'transaction',
        action: failed > 0 ? 'partial' : 'complete',
        // Both counts, so a wrong pair decision is countable per sweep.
        detail: `reversed=${reversed},row_only=${rowOnly}`,
        perf_entity_count: deleted,
      },
    });
  }
  return deleted;
}
