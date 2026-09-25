/**
 * The statement import store (#107). What must never regress:
 *
 *  1. Nothing is written before `commit()`.
 *  2. ONE decision field per line: totals, bulk actions and the commit all read `decision`,
 *     and already-imported lines are never swept by a bulk action.
 *  3. Commit order is fixed: resolve transfer amounts → atomic add batch → reload → merges.
 *     A batch throw writes nothing (`failed`); an unverifiable batch stops before the reload
 *     and the merges (`unverified`); a merge failure can only ever be `partial`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { commitStatementAddsMock, logEventMock, reportErrorMock, fingerprintSpy } = vi.hoisted(
  () => ({
    commitStatementAddsMock: vi.fn(),
    logEventMock: vi.fn(),
    reportErrorMock: vi.fn(),
    fingerprintSpy: { fail: false },
  })
);

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  commitStatementAdds: commitStatementAddsMock,
}));
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/services/analytics/plausible', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/analytics/plausible')>()),
  trackFeature: vi.fn(),
}));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
vi.mock('@/services/ai/documentExtractionService', () => ({
  extractStatementFromSource: vi.fn(),
  prepareImageSource: vi.fn(),
}));
// The real fingerprint, with a switch to make the planner fail for the plan_failed path.
vi.mock('@/utils/statement/fingerprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/statement/fingerprint')>();
  return {
    ...actual,
    fingerprintLines: (...args: Parameters<typeof actual.fingerprintLines>) => {
      if (fingerprintSpy.fail) return Promise.reject(new TypeError('crypto.subtle unavailable'));
      return actual.fingerprintLines(...args);
    },
  };
});

import { useSettingsStore } from '@/stores/settingsStore';
import { useStatementImportStore } from '../statementImportStore';
import { useAccountsStore } from '../accountsStore';
import { useTransactionsStore } from '../transactionsStore';
import { useRecurringStore } from '../recurringStore';
import { ImportNotVisibleError } from '@/services/automerge/repositories/importErrors';
import { fingerprintLines } from '@/utils/statement/fingerprint';
import { account, line, tx } from '@/utils/statement/__tests__/fixtures';
import type { RecurringItem, Transaction } from '@/types/models';
import type {
  StatementExtractionResult,
  StatementLineDraft,
  StatementReadResult,
} from '@/services/ai/types';
import type { ResultEnvelope } from '@/types/magicPayload';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────

const BANK = account({
  id: 'acc-bank',
  type: 'checking',
  currency: 'SGD',
  institution: 'DBS Bank',
  // A debit card on the current account: the statement's last 4 names it.
  cardLast4: '1234',
});
const CARD = account({
  id: 'acc-card',
  type: 'credit_card',
  currency: 'SGD',
  institution: 'Standard Chartered',
  cardLast4: '0042',
});
const SAVINGS = account({ id: 'acc-savings', type: 'savings', currency: 'SGD' });

const MORTGAGE: RecurringItem = {
  id: 'rec-mortgage',
  accountId: 'acc-bank',
  type: 'expense',
  amount: 2000,
  currency: 'SGD',
  category: 'debt_payment',
  description: 'Mortgage',
  frequency: 'monthly',
  dayOfMonth: 1,
  startDate: '2026-01-01',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const HOME_LOAN = line({
  date: '2026-03-14',
  description: 'HOME LOAN',
  amount: 2305.17,
  categoryHint: 'debt_payment',
});
const NTUC = line({
  date: '2026-03-10',
  description: 'NTUC FAIRPRICE #0423',
  amount: 23.4,
  categoryHint: 'groceries',
});
const COFFEE = line({ date: '2026-03-12', description: 'COFFEE BEAN', amount: 5 });
const BAKERY = line({ date: '2026-03-10', description: 'BAKERY', amount: 10 });

function readOf(
  lines: StatementLineDraft[],
  acc: StatementExtractionResult['account'] = { last4: '1234', currency: 'SGD', kind: 'bank' }
): StatementReadResult {
  return {
    result: {
      isStatement: true,
      account: acc,
      period: { from: '2026-03-01', to: '2026-03-31' },
      balances: {},
      lines,
      confidence: 0.9,
    },
    units: [{ unit: 0, page: 1, status: 'read' }],
    droppedPages: [],
    unitsBeyondCap: 0,
    source: 'pdf',
  };
}

const ENV = {} as ResultEnvelope;
const SHA256_HEX = expect.stringMatching(/^[0-9a-f]{64}$/);
const CARD_ID = { last4: '4000-12XX-XXXX-0042', currency: 'SGD', kind: 'card' as const };

let order: string[];
let stores: {
  accounts: ReturnType<typeof useAccountsStore>;
  transactions: ReturnType<typeof useTransactionsStore>;
  recurring: ReturnType<typeof useRecurringStore>;
};
let spies: {
  loadTransactions: ReturnType<typeof vi.fn>;
  loadAccounts: ReturnType<typeof vi.fn>;
  createTransaction: ReturnType<typeof vi.fn>;
  updateTransaction: ReturnType<typeof vi.fn>;
  resolveTransferToAmount: ReturnType<typeof vi.fn>;
};

function seed(transactions: Transaction[] = [], recurring: RecurringItem[] = [MORTGAGE]) {
  stores.accounts.accounts = [BANK, CARD, SAVINGS];
  stores.transactions.transactions = transactions;
  stores.recurring.recurringItems = recurring;
}

/** The candidate for a given line description. */
function cand(description: string) {
  const c = useStatementImportStore().candidates.find(
    (x) => x.draft.statementDescription === description
  );
  if (!c) throw new Error(`no candidate for ${description}`);
  return c;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  fingerprintSpy.fail = false;
  order = [];
  stores = {
    accounts: useAccountsStore(),
    transactions: useTransactionsStore(),
    recurring: useRecurringStore(),
  };
  spies = {
    loadTransactions: vi
      .spyOn(stores.transactions, 'loadTransactions')
      .mockImplementation(async () => {
        order.push('loadTransactions');
      }) as never,
    loadAccounts: vi.spyOn(stores.accounts, 'loadAccounts').mockImplementation(async () => {
      order.push('loadAccounts');
    }) as never,
    createTransaction: vi
      .spyOn(stores.transactions, 'createTransaction')
      .mockImplementation(async (input) => {
        order.push('createTransaction');
        return { ...input, id: 'tx-new', createdAt: 'x', updatedAt: 'x' } as Transaction;
      }) as never,
    updateTransaction: vi
      .spyOn(stores.transactions, 'updateTransaction')
      .mockImplementation(async (id) => {
        order.push(`updateTransaction:${id}`);
        return tx({ id });
      }) as never,
    resolveTransferToAmount: vi
      .spyOn(stores.transactions, 'resolveTransferToAmount')
      .mockImplementation((_c, _to, amount) => amount) as never,
  };
  commitStatementAddsMock.mockImplementation(async (entries: unknown[]) => {
    order.push('commitStatementAdds');
    return {
      transactions: entries.map((e, i) => ({ ...(e as object), id: `added-${i}` })),
      skippedIncrements: [],
    };
  });
  seed();
});

/** Writes of any kind. */
function expectNothingWritten() {
  expect(commitStatementAddsMock).not.toHaveBeenCalled();
  expect(spies.createTransaction).not.toHaveBeenCalled();
  expect(spies.updateTransaction).not.toHaveBeenCalled();
}

// ── start() ───────────────────────────────────────────────────────────────────────────────

describe('start()', () => {
  it('suggests the account by last 4 and plans one candidate per line with defaults', async () => {
    const lines = [HOME_LOAN, NTUC, COFFEE];
    const fps = await fingerprintLines('acc-bank', lines);
    seed([
      tx({ id: 'tx-old-coffee', accountId: 'acc-bank', amount: 5, importFingerprint: fps[2] }),
    ]);
    const store = useStatementImportStore();

    expect(await store.start(readOf(lines), ENV)).toBe(true);

    expect(store.phase).toBe('reviewing');
    expect(store.accountId).toBe('acc-bank');
    expect(store.candidates).toHaveLength(3);

    // The acceptance example: recurring Mortgage 2,000 on the 1st vs HOME LOAN 2,305.17 on
    // the 14th, linked by the category.
    expect(cand('HOME LOAN')).toMatchObject({
      defaultDecision: 'merge',
      decision: 'merge',
      alreadyImported: false,
      match: { isProjected: true, recurringItemId: 'rec-mortgage', dueDate: '2026-03-01' },
    });
    expect(cand('NTUC FAIRPRICE #0423')).toMatchObject({
      defaultDecision: 'add',
      decision: 'add',
      alreadyImported: false,
    });
    expect(cand('NTUC FAIRPRICE #0423').match).toBeUndefined();
    expect(cand('COFFEE BEAN')).toMatchObject({
      alreadyImported: true,
      defaultDecision: 'skip',
      decision: 'skip',
      fingerprint: fps[2],
    });
    expect(store).toMatchObject({ toAdd: 1, toMerge: 1, skipped: 0, overrides: 0, familiar: 1 });
    expectNothingWritten();
  });

  it('matches the acceptance example against a REAL recurring row on the 1st too', async () => {
    seed([
      tx({
        id: 'tx-mortgage-mar',
        accountId: 'acc-bank',
        amount: 2000,
        category: 'debt_payment',
        description: 'Mortgage',
        date: '2026-03-01',
        recurringItemId: 'rec-mortgage',
      }),
    ]);
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN]), ENV);
    expect(cand('HOME LOAN')).toMatchObject({
      defaultDecision: 'merge',
      match: { id: 'tx-mortgage-mar', isProjected: false },
    });
  });

  it('with no matching account: reviewing, no account, no candidates', async () => {
    const store = useStatementImportStore();
    const ok = await store.start(
      readOf([NTUC], { last4: '0000', currency: 'EUR', institution: 'Nowhere' }),
      ENV
    );
    expect(ok).toBe(true);
    expect(store.phase).toBe('reviewing');
    expect(store.accountId).toBeNull();
    expect(store.candidates).toEqual([]);
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ detail: 'no_account' }) })
    );
  });

  it('a planner throw returns false, leaves the store idle and reports plan_failed', async () => {
    fingerprintSpy.fail = true;
    const store = useStatementImportStore();
    expect(await store.start(readOf([NTUC]), ENV)).toBe(false);
    expect(store.phase).toBe('idle');
    expect(store.candidates).toEqual([]);
    expect(store.read).toBeNull();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ action: 'plan_failed', error_code: 'TypeError' }),
      })
    );
  });
});

// ── decide / decideAll / editDraft ────────────────────────────────────────────────────────

describe('decisions', () => {
  async function started() {
    const lines = [HOME_LOAN, NTUC, COFFEE, BAKERY];
    const fps = await fingerprintLines('acc-bank', lines);
    seed([
      tx({ id: 'tx-old-coffee', accountId: 'acc-bank', amount: 5, importFingerprint: fps[2] }),
    ]);
    const store = useStatementImportStore();
    await store.start(readOf(lines), ENV);
    return store;
  }

  it('totals and overrides derive from the one decision field', async () => {
    const store = await started();
    expect(store).toMatchObject({ toAdd: 2, toMerge: 1, skipped: 0, overrides: 0 });

    store.decide(cand('NTUC FAIRPRICE #0423').fingerprint, 'skip');
    store.decide(cand('HOME LOAN').fingerprint, 'add'); // keep both
    expect(store).toMatchObject({ toAdd: 2, toMerge: 0, skipped: 1, overrides: 2 });
    expect(store.allTicked).toBe(false);
    expectNothingWritten();
  });

  it("decideAll('default') restores merge on a matched line, not add", async () => {
    const store = await started();
    store.decideAll('skip');
    expect(cand('HOME LOAN').decision).toBe('skip');
    store.decideAll('default');
    expect(cand('HOME LOAN').decision).toBe('merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('add');
    expect(store.overrides).toBe(0);
    expect(store.allTicked).toBe(true);
  });

  it('bulk actions never touch already-imported lines', async () => {
    const store = await started();
    store.decideAll('skip');
    // The already-added line is not counted as one of the person's skips.
    expect(store.skipped).toBe(3);
    store.decideAll('add');
    expect(cand('COFFEE BEAN')).toMatchObject({ alreadyImported: true, decision: 'skip' });
    expect(store.toAdd).toBe(3);
  });

  it('matchedOnly reaches only matched lines', async () => {
    const store = await started();
    store.decideAll('skip', { matchedOnly: true });
    expect(cand('HOME LOAN').decision).toBe('skip');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('add');
    expect(cand('BAKERY').decision).toBe('add');

    store.decideAll('add');
    store.decideAll('merge', { matchedOnly: true });
    expect(cand('HOME LOAN').decision).toBe('merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('add');
  });

  it('a possible duplicate is counted apart and never reached by the familiar bulk bar', async () => {
    seed([
      // The same groceries run, added by an EARLIER import under different bank text.
      tx({
        id: 'tx-earlier-ntuc',
        accountId: 'acc-bank',
        amount: 23.4,
        category: 'groceries',
        date: '2026-03-11',
        importFingerprint: 'earlier-statement',
        importPeriod: { from: '2026-03-01', to: '2026-03-15' },
      }),
    ]);
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN, NTUC]), ENV);
    // Same amount a day apart on an overlapping import: the same line read twice → skip.
    expect(cand('NTUC FAIRPRICE #0423')).toMatchObject({
      defaultDecision: 'skip',
      match: {
        id: 'tx-earlier-ntuc',
        strength: 'possible',
        existingImported: true,
        strong: true,
      },
    });
    expect(store).toMatchObject({ familiar: 1, possible: 1 });

    store.decideAll('merge', { matchedOnly: true });
    expect(cand('HOME LOAN').decision).toBe('merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('skip');
    // One card at a time, it can still be merged.
    store.decide(cand('NTUC FAIRPRICE #0423').fingerprint, 'merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('merge');
  });

  it("merge never lands on an unmatched line, even from an unscoped decideAll('merge')", async () => {
    const store = await started();
    store.decideAll('skip');
    store.decideAll('merge');
    expect(cand('HOME LOAN').decision).toBe('merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('skip');
  });

  it('a day scope affects only that date', async () => {
    const store = await started();
    store.decideAll('skip', { day: '2026-03-10' });
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('skip');
    expect(cand('BAKERY').decision).toBe('skip');
    expect(cand('HOME LOAN').decision).toBe('merge');
  });

  it('decide(fp, merge) on an unmatched line is ignored', async () => {
    const store = await started();
    store.decide(cand('NTUC FAIRPRICE #0423').fingerprint, 'merge');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('add');
    store.decide('no-such-fingerprint', 'skip');
    expect(store.overrides).toBe(0);
  });

  it('editDraft refuses a transfer without a destination, applies one with it, and drops it again', async () => {
    const store = await started();
    const fp = cand('BAKERY').fingerprint;
    const before = { ...cand('BAKERY').draft };

    store.editDraft(fp, { type: 'transfer' });
    expect(cand('BAKERY').draft).toEqual(before);

    store.editDraft(fp, { type: 'transfer', toAccountId: 'acc-savings', toAmount: 10 });
    expect(cand('BAKERY').draft).toMatchObject({
      type: 'transfer',
      toAccountId: 'acc-savings',
      toAmount: 10,
    });

    store.editDraft(fp, { type: 'income', category: 'other_income' });
    expect(cand('BAKERY').draft.type).toBe('income');
    expect(cand('BAKERY').draft).not.toHaveProperty('toAccountId');
    expect(cand('BAKERY').draft).not.toHaveProperty('toAmount');
    expectNothingWritten();
  });

  it('setAccount re-plans and restores every default', async () => {
    const store = await started();
    store.decide(cand('NTUC FAIRPRICE #0423').fingerprint, 'skip');
    store.decide(cand('HOME LOAN').fingerprint, 'skip');
    expect(store.overrides).toBe(2);

    expect(await store.setAccount('acc-savings')).toBe(true);
    expect(store.accountId).toBe('acc-savings');
    expect(store.candidates.every((c) => c.decision === c.defaultDecision)).toBe(true);
    expect(store.overrides).toBe(0);
    expect(cand('NTUC FAIRPRICE #0423').draft.accountId).toBe('acc-savings');

    await store.setAccount('acc-bank');
    expect(cand('NTUC FAIRPRICE #0423').decision).toBe('add');
    expect(cand('HOME LOAN').decision).toBe('merge');
    expectNothingWritten();
  });
});

// ── commit() ──────────────────────────────────────────────────────────────────────────────

describe('commit()', () => {
  const COFFEE_ROW = tx({
    id: 'tx-coffee',
    accountId: 'acc-bank',
    amount: 5,
    date: '2026-03-12',
    description: 'Coffee Bean',
    category: 'dining_out',
  });

  async function startedBank() {
    seed([COFFEE_ROW], []);
    const store = useStatementImportStore();
    await store.start(readOf([NTUC, BAKERY, COFFEE]), ENV);
    expect(cand('COFFEE BEAN')).toMatchObject({ decision: 'merge', match: { id: 'tx-coffee' } });
    return store;
  }

  it('runs the batch, THEN the reload, THEN the merges', async () => {
    const store = await startedBank();
    const result = await store.commit();

    expect(order).toEqual([
      'commitStatementAdds',
      'loadTransactions',
      'loadAccounts',
      'updateTransaction:tx-coffee',
    ]);
    expect(result).toEqual({ kind: 'ok', added: 2, merged: 1 });
    expect(store.phase).toBe('idle');

    const [entries, increments] = commitStatementAddsMock.mock.calls[0]!;
    expect(entries.map((e: { description: string }) => e.description)).toEqual([
      NTUC.description,
      BAKERY.description,
    ]);
    // Two expenses on a checking account lower its balance.
    expect(increments).toEqual([{ accountId: 'acc-bank', delta: -33.4 }]);
    expect(spies.updateTransaction).toHaveBeenCalledWith(
      'tx-coffee',
      expect.objectContaining({
        amount: 5,
        isReconciled: true,
        importFingerprint: SHA256_HEX,
        date: '2026-03-12',
      })
    );
  });

  it('an expense on a credit card account raises its (liability) balance', async () => {
    seed([], []);
    const store = useStatementImportStore();
    await store.start(readOf([NTUC, BAKERY], CARD_ID), ENV);
    expect(store.accountId).toBe('acc-card');
    await store.commit();
    expect(commitStatementAddsMock.mock.calls[0]![1]).toEqual([
      { accountId: 'acc-card', delta: 33.4 },
    ]);
  });

  it('a batch throw writes nothing and returns to the review', async () => {
    const store = await startedBank();
    commitStatementAddsMock.mockRejectedValueOnce(new Error('doc worker gone'));

    expect(await store.commit()).toEqual({ kind: 'failed' });
    expect(store.phase).toBe('reviewing');
    expect(store.candidates).toHaveLength(3);
    expect(spies.loadTransactions).not.toHaveBeenCalled();
    expect(spies.updateTransaction).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ error_code: 'batch-write-threw' }),
      })
    );
  });

  it('an unverifiable batch stops before the reload and the merges', async () => {
    const store = await startedBank();
    commitStatementAddsMock.mockRejectedValueOnce(
      new ImportNotVisibleError(1, 2, 'commitStatementAdds')
    );

    expect(await store.commit()).toEqual({ kind: 'unverified' });
    expect(spies.loadTransactions).not.toHaveBeenCalled();
    expect(spies.loadAccounts).not.toHaveBeenCalled();
    expect(spies.updateTransaction).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        context: expect.objectContaining({ error_code: 'verify-missing', count: 1 }),
      })
    );
  });

  it('a merge that returns null is partial', async () => {
    const store = await startedBank();
    spies.updateTransaction.mockResolvedValueOnce(null);

    expect(await store.commit()).toEqual({ kind: 'partial', added: 2, merged: 0, failed: 1 });
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ error_code: 'merge-failed', count: 1 }),
      })
    );
  });

  it('a transfer whose rate cannot be resolved fails with nothing written', async () => {
    const store = await startedBank();
    store.editDraft(cand('BAKERY').fingerprint, { type: 'transfer', toAccountId: 'acc-savings' });
    spies.resolveTransferToAmount.mockImplementation(() => {
      throw new Error('missing rate');
    });

    expect(await store.commit()).toEqual({ kind: 'failed' });
    expect(commitStatementAddsMock).not.toHaveBeenCalled();
    expect(spies.updateTransaction).not.toHaveBeenCalled();
    expect(store.phase).toBe('reviewing');
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ error_code: 'transfer-rate-missing' }),
      })
    );
  });

  it('a transfer add carries its resolved toAmount and moves both balances', async () => {
    const store = await startedBank();
    store.editDraft(cand('BAKERY').fingerprint, { type: 'transfer', toAccountId: 'acc-savings' });
    spies.resolveTransferToAmount.mockImplementation(() => 10);
    await store.commit();
    const [entries, increments] = commitStatementAddsMock.mock.calls[0]!;
    expect(entries[1]).toMatchObject({
      type: 'transfer',
      toAccountId: 'acc-savings',
      toAmount: 10,
    });
    expect(increments).toEqual([
      { accountId: 'acc-bank', delta: -33.4 },
      { accountId: 'acc-savings', delta: 10 },
    ]);
  });

  it("a projection merge keeps the item's loan and activity links and marks the due date it stands for", async () => {
    // Review finding: `recurringToTransactionFields` carries neither link, so a merged mortgage
    // instance lost its loan amortisation; and without `recurringDueDate` the processor would
    // add a second instance on the due date.
    seed([], [{ ...MORTGAGE, loanId: 'loan-1', activityId: 'act-1' }]);
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN]), ENV);
    await store.commit();
    expect(spies.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        loanId: 'loan-1',
        activityId: 'act-1',
        recurringItemId: 'rec-mortgage',
        recurringDueDate: '2026-03-01',
      })
    );
  });

  it('merging into an already-materialised recurring row keeps it standing for its due date', async () => {
    // Review round 2: the merge moved the row's date to the statement day with nothing recording
    // the due date, so the next import's projection filter (and the processor) saw it as open.
    seed(
      [
        tx({
          id: 'tx-mortgage-mar',
          accountId: 'acc-bank',
          type: 'expense',
          amount: 2000,
          date: '2026-03-01',
          description: 'Mortgage',
          category: 'debt_payment',
          recurringItemId: 'rec-mortgage',
        }),
      ],
      [MORTGAGE]
    );
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN]), ENV);
    expect(cand('HOME LOAN').match?.id).toBe('tx-mortgage-mar');
    await store.commit();
    expect(spies.updateTransaction).toHaveBeenCalledWith(
      'tx-mortgage-mar',
      expect.objectContaining({ date: '2026-03-14', recurringDueDate: '2026-03-01' })
    );
  });

  it("merging into a row an earlier import stamped keeps THAT import's provenance", async () => {
    // Review finding: the merge overwrote the one fingerprint, so re-importing the earlier
    // statement no longer recognised the row and added the line again.
    seed([
      tx({
        id: 'tx-from-screenshot',
        accountId: 'acc-bank',
        amount: 23.4,
        category: 'groceries',
        date: '2026-03-10',
        importFingerprint: 'screenshot-fp',
        importId: 'screenshot-import',
        importPeriod: { from: '2026-03-01', to: '2026-03-12' },
      }),
    ]);
    const store = useStatementImportStore();
    await store.start(readOf([NTUC]), ENV);
    store.decide(cand('NTUC FAIRPRICE #0423').fingerprint, 'merge');
    await store.commit();
    const patch = spies.updateTransaction.mock.calls.find(
      (c) => c[0] === 'tx-from-screenshot'
    )?.[1];
    expect(patch).toMatchObject({ isReconciled: true, date: '2026-03-10' });
    expect(patch).not.toHaveProperty('importFingerprint');
    expect(patch).not.toHaveProperty('importId');
  });

  it('a deliberately ticked already-added line is committed, not silently dropped', async () => {
    // Review finding: `toAdd` and `commit()` read only `actionable`, so the tick showed but the
    // line was never written.
    seed([], []);
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN]), ENV);
    const fp = cand('HOME LOAN').fingerprint;
    stores.transactions.transactions = [
      tx({ id: 'tx-prev', accountId: 'acc-bank', importFingerprint: fp }),
    ];
    await store.setAccount('acc-savings');
    await store.setAccount('acc-bank');
    expect(cand('HOME LOAN').alreadyImported).toBe(true);
    store.decide(fp, 'add');
    expect(store.toAdd).toBe(1);
    await store.commit();
    const [entries] = commitStatementAddsMock.mock.calls[0]!;
    expect(entries).toHaveLength(1);
  });

  it('a merge into a projected recurring instance materialises it reconciled', async () => {
    seed([], [MORTGAGE]);
    const store = useStatementImportStore();
    await store.start(readOf([HOME_LOAN]), ENV);
    expect(cand('HOME LOAN').match?.isProjected).toBe(true);

    expect(await store.commit()).toEqual({ kind: 'ok', added: 0, merged: 1 });
    expect(spies.createTransaction).toHaveBeenCalledTimes(1);
    expect(spies.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        recurringItemId: 'rec-mortgage',
        accountId: 'acc-bank',
        type: 'expense',
        amount: 2305.17,
        date: '2026-03-14',
        isReconciled: true,
        importFingerprint: SHA256_HEX,
      })
    );
    expect(spies.updateTransaction).not.toHaveBeenCalled();
  });

  // A draft's amount is in its SOURCE account's currency. A "Paid from?" pick in another
  // currency converts the card amount with the family's own rates, or is refused without one,
  // rather than debiting the payer the card's number in the wrong currency.
  describe('a card-payment offer paid from an account in another currency', () => {
    async function offerPaidFromUsd(): Promise<{
      ok: 'ok' | 'rate-missing' | 'invalid';
      store: ReturnType<typeof useStatementImportStore>;
    }> {
      const usd = account({ id: 'acc-usd', type: 'checking', currency: 'USD' });
      stores.accounts.accounts = [BANK, CARD, SAVINGS, usd];
      stores.transactions.transactions = [];
      stores.recurring.recurringItems = [];
      const store = useStatementImportStore();
      const payment = line({
        date: '2026-03-20',
        description: 'PAYMENT - THANK YOU',
        amount: 500,
        direction: 'in',
        kind: 'payment',
      });
      await store.start(readOf([payment], CARD_ID), ENV);
      expect(cand('PAYMENT - THANK YOU').transfer).toEqual({ kind: 'offer' });
      // Exactly what the row's payer picker emits.
      const ok = store.editDraft(cand('PAYMENT - THANK YOU').fingerprint, {
        type: 'transfer',
        accountId: 'acc-usd',
        toAccountId: 'acc-card',
        category: '',
      });
      return { ok, store };
    }

    it('converts the amount into the payer currency when a rate exists', async () => {
      const cardCurrency = CARD.currency;
      useSettingsStore().settings.exchangeRates = [
        { from: cardCurrency, to: 'USD', rate: 0.5, updatedAt: '2026-03-01T00:00:00.000Z' },
      ];
      const { ok, store } = await offerPaidFromUsd();
      expect(ok).toBe('ok');
      await store.commit();
      const [entries] = commitStatementAddsMock.mock.calls[0]!;
      expect(entries[0]).toMatchObject({ accountId: 'acc-usd', currency: 'USD', amount: 250 });
    });

    it('refuses the edit, and changes nothing, when there is no rate', async () => {
      useSettingsStore().settings.exchangeRates = [];
      const { ok } = await offerPaidFromUsd();
      expect(ok).toBe('rate-missing');
      expect(cand('PAYMENT - THANK YOU').draft).toMatchObject({
        type: 'income',
        accountId: 'acc-card',
      });
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ error_code: 'rate-missing' }),
        })
      );
    });
  });

  it('a card payment merges into its counterpart as ONE transfer from the payer', async () => {
    seed(
      [
        tx({
          id: 'tx-paid-card',
          accountId: 'acc-bank',
          type: 'expense',
          amount: 500,
          date: '2026-03-19',
          description: 'Card bill',
          category: 'other_expense',
        }),
      ],
      []
    );
    const store = useStatementImportStore();
    const payment = line({
      date: '2026-03-20',
      description: 'PAYMENT - THANK YOU',
      amount: 500,
      direction: 'in',
      kind: 'payment',
    });
    await store.start(readOf([payment], CARD_ID), ENV);
    expect(cand('PAYMENT - THANK YOU')).toMatchObject({
      decision: 'merge',
      transfer: { kind: 'counterpart', otherAccountId: 'acc-bank', transactionId: 'tx-paid-card' },
    });

    expect(await store.commit()).toEqual({ kind: 'ok', added: 0, merged: 1 });
    expect(spies.updateTransaction).toHaveBeenCalledWith(
      'tx-paid-card',
      expect.objectContaining({
        type: 'transfer',
        accountId: 'acc-bank',
        toAccountId: 'acc-card',
        amount: 500,
        isReconciled: true,
      })
    );
    // No adds: the batch is handed nothing (the repository returns early on an empty list).
    expect(commitStatementAddsMock).toHaveBeenCalledWith([], []);
  });
});
