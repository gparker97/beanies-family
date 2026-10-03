import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  processRecurringItems,
  deduplicateRecurringTransactions,
  projectRecurringTransactions,
} from './recurringProcessor';
import type { RecurringItem, Account, Transaction, CreateTransactionInput } from '@/types/models';
import type { TransactionCascadeResult } from '@/services/automerge/repositories/transactionRepository';

// #95: the read-only pause reads the REAL write-gate slot; tests install a verdict and clear it.
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

// Mock the repositories. Every money movement goes through the ONE cascade op (audit C7), so
// the processor only names the links; the worker's arithmetic is covered in
// `worker/__tests__/transactionOps.test.ts`.
vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getActiveRecurringItems: vi.fn(),
  updateRecurringItem: vi.fn(),
  updateLastProcessedDate: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn().mockResolvedValue([]),
  createTransactionCascade: vi.fn(),
  deleteTransactionCascade: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAccountById: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import * as recurringRepo from '@/services/automerge/repositories/recurringItemRepository';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import * as accountRepo from '@/services/automerge/repositories/accountRepository';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { setWriteGate, __resetWriteGateForTesting } from '@/services/automerge/worker/writeGate';

const mockAccount: Account = {
  id: 'test-account-1',
  memberId: 'member-1',
  name: 'Test Checking',
  type: 'checking',
  currency: 'USD',
  balance: 1000,
  institution: 'Test Bank',
  isActive: true,
  includeInNetWorth: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const item = (overrides: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'recurring-1',
  accountId: 'test-account-1',
  type: 'expense',
  amount: 50,
  currency: 'USD',
  category: 'subscription',
  description: 'Netflix',
  frequency: 'monthly',
  dayOfMonth: 15,
  startDate: '2024-01-01T00:00:00.000Z',
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

/** A cascade echo for the input the processor sent (the worker stamps the id). */
function echoCreate(input: CreateTransactionInput): TransactionCascadeResult {
  return {
    mode: 'create',
    found: true,
    transaction: {
      ...input,
      id: `tx-${input.date}`,
      createdAt: input.date,
      updatedAt: input.date,
    } as Transaction,
    accounts: [],
    goals: [],
    assets: [],
    skipped: [],
  };
}
const echoDelete = (found = true): TransactionCascadeResult => ({
  mode: 'delete',
  found,
  accounts: [],
  goals: [],
  assets: [],
  skipped: [],
});

const sentInputs = () =>
  vi.mocked(transactionRepo.createTransactionCascade).mock.calls.map(([input]) => input);

function arm(items: RecurringItem[]): void {
  vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue(items);
  vi.mocked(accountRepo.getAccountById).mockResolvedValue({ ...mockAccount });
  vi.mocked(transactionRepo.createTransactionCascade).mockImplementation(async (input) =>
    echoCreate(input)
  );
  vi.mocked(recurringRepo.updateLastProcessedDate).mockResolvedValue(undefined);
}

describe('recurringProcessor - one cascade per instance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a recurring expense as ONE cascade naming the account; the worker moves the balance', async () => {
    arm([item()]);

    const result = await processRecurringItems();

    expect(result).toEqual({ processed: 1, errors: [] });
    expect(accountRepo.getAccountById).toHaveBeenCalledWith('test-account-1');
    expect(sentInputs()).toEqual([
      expect.objectContaining({
        accountId: 'test-account-1',
        type: 'expense',
        amount: 50,
        date: '2024-01-15',
        recurringItemId: 'recurring-1',
        isReconciled: false,
      }),
    ]);
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledWith('recurring-1', '2024-01-15');
  });

  it('processes several items, one cascade each', async () => {
    arm([
      item({ id: 'recurring-1', type: 'income', amount: 3000, category: 'salary' }),
      item({ id: 'recurring-2', type: 'expense', amount: 100, category: 'utilities' }),
    ]);

    const result = await processRecurringItems();

    expect(result.processed).toBe(2);
    expect(sentInputs().map((i) => [i.recurringItemId, i.type, i.amount])).toEqual([
      ['recurring-1', 'income', 3000],
      ['recurring-2', 'expense', 100],
    ]);
  });

  it('names the goal link; the worker caps and records the allocation itself', async () => {
    arm([
      item({
        type: 'income',
        amount: 1000,
        goalId: 'goal-1',
        goalAllocMode: 'percentage',
        goalAllocValue: 20,
      }),
    ]);

    await processRecurringItems();

    const [input] = sentInputs();
    expect(input).toMatchObject({
      goalId: 'goal-1',
      goalAllocMode: 'percentage',
      goalAllocValue: 20,
    });
    expect(input).not.toHaveProperty('goalAllocApplied');
  });

  it("names the loan link only; the portions and the linked account mirror are the worker's", async () => {
    arm([item({ amount: 1500, category: 'loan_payment', loanId: 'asset-loan-1' })]);

    await processRecurringItems();

    const [input] = sentInputs();
    expect(input.loanId).toBe('asset-loan-1');
    expect(input.recurringItemId).toBe('recurring-1'); // → amortisation, not an extra payment
    expect(input).not.toHaveProperty('loanInterestPortion');
    expect(input).not.toHaveProperty('loanPrincipalPortion');
  });

  it('passes activityId through to the generated transaction', async () => {
    arm([item({ category: 'lesson_fees', activityId: 'activity-swim-1' })]);

    await processRecurringItems();

    expect(sentInputs()[0]).toMatchObject({
      activityId: 'activity-swim-1',
      recurringItemId: 'recurring-1',
    });
  });

  it('an item whose account is gone is skipped and logged, never materialised; the cursor still advances', async () => {
    arm([item()]);
    vi.mocked(accountRepo.getAccountById).mockResolvedValue(undefined);

    const result = await processRecurringItems();

    expect(result).toEqual({ processed: 0, errors: [] });
    expect(transactionRepo.createTransactionCascade).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'recurring-processor',
        message: 'account-missing',
        context: { recur_surface: 'transaction', action: 'skip' },
      })
    );
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledWith('recurring-1', '2024-01-15');
  });
});

describe('recurringProcessor - the cursor stops at the first failure (audit C7)', () => {
  // Last generated on 15 July; "today" is 15 October, so three instances are due.
  const salary = item({
    id: 'recurring-cursor',
    type: 'income',
    amount: 3000,
    category: 'salary',
    lastProcessedDate: '2024-07-15',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-10-15T12:00:00.000Z'));
    arm([salary]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances only past the dates that landed and reports the failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(transactionRepo.createTransactionCascade).mockImplementation(async (input) => {
      if (input.date === '2024-09-15') throw new Error('worker down');
      return echoCreate(input);
    });

    const result = await processRecurringItems();

    expect(result.processed).toBe(1);
    expect(result.errors).toHaveLength(1);
    // August landed, September threw, October was never attempted.
    expect(sentInputs().map((i) => i.date)).toEqual(['2024-08-15', '2024-09-15']);
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledTimes(1);
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledWith(
      'recurring-cursor',
      '2024-08-15'
    );
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'recurring-processor',
        message: 'recurring-cascade-failed',
        severity: 'error',
        context: { recur_surface: 'transaction', action: 'create' },
      })
    );
    consoleError.mockRestore();
  });

  it('does not touch the cursor when the FIRST due date fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(transactionRepo.createTransactionCascade).mockRejectedValue(new Error('worker down'));

    const result = await processRecurringItems();

    expect(result.processed).toBe(0);
    expect(transactionRepo.createTransactionCascade).toHaveBeenCalledTimes(1);
    expect(recurringRepo.updateLastProcessedDate).not.toHaveBeenCalled();
  });

  it('a date already accounted for counts as settled, so the cursor passes it', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      {
        ...echoCreate({
          accountId: 'test-account-1',
          type: 'income',
          amount: 3000,
          currency: 'USD',
          category: 'salary',
          date: '2024-08-15',
          description: 'x',
          isReconciled: false,
          recurringItemId: 'recurring-cursor',
        }).transaction!,
      },
    ]);

    const result = await processRecurringItems();

    expect(result.processed).toBe(2);
    expect(sentInputs().map((i) => i.date)).toEqual(['2024-09-15', '2024-10-15']);
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledWith(
      'recurring-cursor',
      '2024-10-15'
    );
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([]);
  });
});

describe('deduplicateRecurringTransactions', () => {
  const dup = (id: string, createdAt: string, extra: Partial<Transaction> = {}): Transaction => ({
    id,
    accountId: 'acc-1',
    type: 'income',
    amount: 5000,
    currency: 'EUR',
    category: 'salary',
    date: '2026-04-01',
    description: 'Salary',
    recurringItemId: 'rec-1',
    isReconciled: false,
    createdAt,
    updatedAt: createdAt,
    ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transactionRepo.deleteTransactionCascade).mockResolvedValue(echoDelete());
  });

  it('removes the later-created duplicates THROUGH the delete cascade (effects reversed) and logs the sweep', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      dup('tx-1', '2026-04-01T08:00:00.000Z'),
      dup('tx-2', '2026-04-01T09:00:00.000Z'),
      dup('tx-3', '2026-04-01T10:00:00.000Z'),
    ]);

    const deleted = await deduplicateRecurringTransactions();

    expect(deleted).toBe(2);
    expect(transactionRepo.deleteTransactionCascade).toHaveBeenCalledWith('tx-2');
    expect(transactionRepo.deleteTransactionCascade).toHaveBeenCalledWith('tx-3');
    expect(transactionRepo.deleteTransactionCascade).not.toHaveBeenCalledWith('tx-1');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        surface: 'recurring-dedup',
        context: { recur_surface: 'transaction', action: 'complete', perf_entity_count: 2 },
      })
    );
  });

  it('a duplicate deleted meanwhile is not counted; a failed delete is reported and the sweep goes on', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      dup('tx-1', '2026-04-01T08:00:00.000Z'),
      dup('tx-2', '2026-04-01T09:00:00.000Z'),
      dup('tx-3', '2026-04-01T10:00:00.000Z'),
      dup('tx-4', '2026-04-01T11:00:00.000Z'),
    ]);
    vi.mocked(transactionRepo.deleteTransactionCascade)
      .mockResolvedValueOnce(echoDelete(false))
      .mockRejectedValueOnce(new Error('worker down'))
      .mockResolvedValueOnce(echoDelete());

    const deleted = await deduplicateRecurringTransactions();

    expect(deleted).toBe(1);
    expect(transactionRepo.deleteTransactionCascade).toHaveBeenCalledTimes(3);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'recurring-dedup', message: 'duplicate-delete-failed' })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'recurring-dedup',
        context: { recur_surface: 'transaction', action: 'partial', perf_entity_count: 1 },
      })
    );
  });

  it('should not delete non-recurring transactions', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      dup('tx-1', '2026-04-01T08:00:00.000Z', { recurringItemId: undefined, type: 'expense' }),
      dup('tx-2', '2026-04-01T09:00:00.000Z', { recurringItemId: undefined, type: 'expense' }),
    ]);

    expect(await deduplicateRecurringTransactions()).toBe(0);
    expect(transactionRepo.deleteTransactionCascade).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('should handle different recurring items on same date independently', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      dup('tx-1', '2026-04-01T08:00:00.000Z'),
      dup('tx-2', '2026-04-01T08:00:00.000Z', { recurringItemId: 'rec-2', accountId: 'acc-2' }),
    ]);

    expect(await deduplicateRecurringTransactions()).toBe(0);
    expect(transactionRepo.deleteTransactionCascade).not.toHaveBeenCalled();
  });
});

describe('recurringProcessor - a row that stands for a due date (#107)', () => {
  const mortgage = item({
    id: 'recurring-mortgage',
    amount: 2000,
    category: 'mortgage',
    description: 'Mortgage',
    dayOfMonth: 1,
    startDate: '2024-01-01',
  });

  function existing(date: string, isReconciled: boolean, recurringDueDate?: string): Transaction {
    return {
      ...(recurringDueDate ? { recurringDueDate } : {}),
      id: `tx-${date}`,
      accountId: 'test-account-1',
      type: 'expense',
      amount: 2305.17,
      currency: 'USD',
      category: 'mortgage',
      date,
      description: 'Mortgage',
      recurringItemId: mortgage.id,
      isReconciled,
      createdAt: '2024-01-14T00:00:00.000Z',
      updatedAt: '2024-01-14T00:00:00.000Z',
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Due date in range: 2024-01-01 only.
    vi.setSystemTime(new Date('2024-01-20T12:00:00.000Z'));
    arm([mortgage]);
    vi.mocked(transactionRepo.deleteTransactionCascade).mockResolvedValue(echoDelete());
  });

  afterEach(() => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([]);
    vi.useRealTimers();
  });

  it('suppresses the due date a merged statement row stands for', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      existing('2024-01-14', true, '2024-01-01'),
    ]);
    const result = await processRecurringItems();
    expect(result.processed).toBe(0);
    expect(transactionRepo.createTransactionCascade).not.toHaveBeenCalled();
  });

  it('a reconciled row in the month with NO due date does not suppress anything', async () => {
    // The old month-wide rule would have skipped this; for a weekly item it skipped every other
    // instance in the month.
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([existing('2024-01-14', true)]);
    const result = await processRecurringItems();
    expect(result.processed).toBe(1);
  });

  it('a weekly item keeps its other instances when one is merged', async () => {
    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([
      { ...mortgage, frequency: 'daily', startDate: '2024-01-18' },
    ]);
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      // Charged the day before it was due, merged into the 18th's instance.
      existing('2024-01-17', true, '2024-01-18'),
    ]);
    const result = await processRecurringItems();
    // 18th stood for by the merged row; 19th and 20th still materialise.
    expect(result.processed).toBe(2);
  });

  it('one merged row stands for ONE due date: its own date is not also treated as done', async () => {
    // Review round 2: `date === d || recurringDueDate === d` let a row dated the 19th that
    // stands for the 20th also suppress the 19th.
    vi.mocked(recurringRepo.getActiveRecurringItems).mockResolvedValue([
      { ...mortgage, frequency: 'daily', startDate: '2024-01-19' },
    ]);
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      existing('2024-01-19', true, '2024-01-20'),
    ]);
    const result = await processRecurringItems();
    // The 20th is stood for; the 19th still materialises.
    expect(result.processed).toBe(1);
  });

  it('the duplicate sweep keys on the due date a row stands for', async () => {
    // A merged row dated the 24th standing for the 28th, and a real row ON the 24th: two
    // different instances, neither may be deleted.
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      { ...existing('2024-01-24', true, '2024-01-28'), id: 'merged' },
      { ...existing('2024-01-24', false), id: 'real-24' },
    ]);
    expect(await deduplicateRecurringTransactions()).toBe(0);
    // And a merged row standing for the 28th plus a device-created row ON the 28th ARE the
    // same instance: one is swept.
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      {
        ...existing('2024-01-24', true, '2024-01-28'),
        id: 'merged',
        createdAt: '2024-01-24T00:00:00.000Z',
      },
      { ...existing('2024-01-28', false), id: 'device-b', createdAt: '2024-01-28T00:00:00.000Z' },
    ]);
    expect(await deduplicateRecurringTransactions()).toBe(1);
    expect(transactionRepo.deleteTransactionCascade).toHaveBeenCalledWith('device-b');
  });

  it('keeps the original same-date rule', async () => {
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([
      existing('2024-01-01', false),
    ]);
    const result = await processRecurringItems();
    expect(result.processed).toBe(0);
  });
});

describe('projectRecurringTransactions', () => {
  const netflix = item({ id: 'rec-1', accountId: 'acc-1', startDate: '2024-01-01' });

  it('emits one projected row per due date with the stable id shape', () => {
    const rows = projectRecurringTransactions(
      [netflix],
      new Date(2024, 1, 1),
      new Date(2024, 2, 31)
    );
    expect(rows.map((r) => r.id)).toEqual([
      'projected-rec-1-2024-02-15',
      'projected-rec-1-2024-03-15',
    ]);
    expect(rows[0]).toMatchObject({
      accountId: 'acc-1',
      type: 'expense',
      amount: 50,
      currency: 'USD',
      category: 'subscription',
      date: '2024-02-15',
      description: 'Netflix',
      recurringItemId: 'rec-1',
      isReconciled: false,
      isProjected: true,
    });
  });

  it('honours an id prefix (the next-month preview namespace)', () => {
    const rows = projectRecurringTransactions(
      [netflix],
      new Date(2024, 1, 1),
      new Date(2024, 1, 29),
      { idPrefix: 'next-projected' }
    );
    expect(rows.map((r) => r.id)).toEqual(['next-projected-rec-1-2024-02-15']);
  });
});

describe('recurringProcessor - paused while read-only, caught up after (#95)', () => {
  // Last generated on 15 July; "today" is 15 October, so three instances are due.
  const salary = item({
    id: 'recurring-ro',
    type: 'income',
    amount: 3000,
    category: 'salary',
    lastProcessedDate: '2024-07-15',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-10-15T12:00:00.000Z'));
    arm([salary]);
    vi.mocked(transactionRepo.getAllTransactions).mockResolvedValue([]);
  });

  /** What the installed gate reports; flipped by each test. */
  let readOnly = false;

  beforeEach(() => {
    readOnly = false;
    __resetWriteGateForTesting();
    setWriteGate(() => ({ block: readOnly, wouldBlock: false }));
  });

  afterEach(() => {
    __resetWriteGateForTesting();
    vi.useRealTimers();
  });

  const skippedEvents = () =>
    vi
      .mocked(logEvent)
      .mock.calls.filter(
        ([e]) =>
          e.surface === 'recurring' &&
          (e.context as { action?: string })?.action === 'skipped_read_only'
      );

  it('generates and deletes nothing while read-only, logging the pause once per session', async () => {
    readOnly = true;

    await expect(processRecurringItems()).resolves.toEqual({ processed: 0, errors: [] });
    await expect(deduplicateRecurringTransactions()).resolves.toBe(0);
    await expect(processRecurringItems()).resolves.toEqual({ processed: 0, errors: [] });

    // Nothing was even read, so nothing could be written.
    expect(recurringRepo.getActiveRecurringItems).not.toHaveBeenCalled();
    expect(transactionRepo.getAllTransactions).not.toHaveBeenCalled();
    expect(transactionRepo.createTransactionCascade).not.toHaveBeenCalled();
    expect(transactionRepo.deleteTransactionCascade).not.toHaveBeenCalled();
    expect(recurringRepo.updateLastProcessedDate).not.toHaveBeenCalled();
    expect(skippedEvents()).toHaveLength(1);
  });

  it('catches up every missed instance on the first writable run', async () => {
    readOnly = true;
    await processRecurringItems();
    readOnly = false;

    const result = await processRecurringItems();

    expect(result.processed).toBe(3);
    expect(sentInputs().map((i) => i.date)).toEqual(['2024-08-15', '2024-09-15', '2024-10-15']);
    expect(recurringRepo.updateLastProcessedDate).toHaveBeenCalledWith(
      'recurring-ro',
      '2024-10-15'
    );
  });
});
