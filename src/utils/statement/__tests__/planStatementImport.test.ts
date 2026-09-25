import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  planStatementImport,
  suggestAccount,
  type PlanStatementImportInput,
} from '../planStatementImport';
import type { StatementLineDraft } from '@/services/ai/types';
import { account, line, projection, tx } from './fixtures';

const bank = account({ id: 'acc-bank', currency: 'SGD', institution: 'DBS Bank' });
const card = account({
  id: 'acc-card',
  type: 'credit_card',
  currency: 'SGD',
  institution: 'Standard Chartered',
  cardLast4: '4321',
});
const importMeta = {
  importId: 'imp-1',
  importSource: 'pdf' as const,
  importPeriod: { from: '2026-03-01', to: '2026-03-31' },
};

function plan(over: Partial<PlanStatementImportInput> & { lines: StatementLineDraft[] }) {
  return planStatementImport({
    identity: { account: {}, period: { from: '2026-03-01', to: '2026-03-31' } },
    accountId: 'acc-bank',
    accounts: [bank, card],
    transactions: [],
    projections: [],
    fingerprints: over.lines.map((_, i) => `fp-${i}`),
    existingFingerprints: new Set(),
    importMeta,
    ...over,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('planStatementImport: defaults and drafts', () => {
  it('an unmatched line defaults to add with a complete draft', () => {
    const { candidates } = plan({
      lines: [
        line({
          description: 'NTUC FAIRPRICE #0423',
          merchant: 'NTUC FairPrice',
          amount: 23.4,
          categoryHint: 'groceries',
        }),
      ],
    });
    expect(candidates[0]).toMatchObject({
      fingerprint: 'fp-0',
      alreadyImported: false,
      defaultDecision: 'add',
      decision: 'add',
      draft: {
        accountId: 'acc-bank',
        type: 'expense',
        amount: 23.4,
        currency: 'SGD',
        category: 'groceries',
        date: '2026-03-10',
        description: 'NTUC FairPrice',
        statementDescription: 'NTUC FAIRPRICE #0423',
        isReconciled: true,
        importFingerprint: 'fp-0',
        importId: 'imp-1',
        importSource: 'pdf',
        importPeriod: importMeta.importPeriod,
      },
    });
    expect(candidates[0]!.match).toBeUndefined();
    expect(candidates[0]!.transfer).toBeUndefined();
  });

  it('direction in is income', () => {
    const { candidates } = plan({ lines: [line({ direction: 'in', categoryHint: 'salary' })] });
    expect(candidates[0]!.draft).toMatchObject({ type: 'income', category: 'salary' });
  });

  it('an already-imported line defaults to skip and computes no match', () => {
    const existing = tx({ id: 'e', amount: 10, date: '2026-03-10' });
    const { candidates, notices } = plan({
      lines: [line()],
      transactions: [existing],
      existingFingerprints: new Set(['fp-0']),
    });
    expect(candidates[0]).toMatchObject({
      alreadyImported: true,
      defaultDecision: 'skip',
      decision: 'skip',
    });
    expect(candidates[0]!.match).toBeUndefined();
    expect(notices.overlapAlready).toBe(1);
  });

  it('a familiar line defaults to merge against a projection', () => {
    const p = projection({
      id: 'projected-r-2026-03-01',
      recurringItemId: 'r',
      amount: 2000,
      date: '2026-03-01',
      description: 'Mortgage',
      category: 'debt_payment',
    });
    const { candidates, notices } = plan({
      lines: [
        line({
          description: 'HOME LOAN',
          amount: 2305.17,
          date: '2026-03-14',
          categoryHint: 'debt_payment',
        }),
      ],
      projections: [p],
    });
    expect(candidates[0]).toMatchObject({ defaultDecision: 'merge', decision: 'merge' });
    expect(candidates[0]!.match).toMatchObject({
      id: p.id,
      isProjected: true,
      dueDate: '2026-03-01',
    });
    expect(notices.familiar).toBe(1);
  });

  it('a weak possible duplicate is a pair card that defaults to keep both', () => {
    // Typed by hand 15 days away: close amount, same month, dates too far to be familiar.
    const typed = tx({ id: 'typed', amount: 10.1, date: '2026-03-25' });
    const { candidates, notices } = plan({ lines: [line()], transactions: [typed] });
    expect(candidates[0]).toMatchObject({ defaultDecision: 'add', decision: 'add' });
    expect(candidates[0]!.match).toMatchObject({ id: 'typed', strength: 'possible' });
    expect(notices).toMatchObject({ familiar: 0, possible: 1, possibleStrong: 0 });
  });

  it('the same line from an overlapping earlier import defaults to skip, never added twice', () => {
    const earlier = tx({
      id: 'earlier',
      amount: 10,
      date: '2026-03-10',
      importFingerprint: 'from-an-earlier-import',
      importPeriod: { from: '2026-03-01', to: '2026-03-14' },
    });
    const { candidates, notices } = plan({ lines: [line()], transactions: [earlier] });
    expect(candidates[0]).toMatchObject({ defaultDecision: 'skip', decision: 'skip' });
    expect(candidates[0]!.match).toMatchObject({ id: 'earlier', strong: true });
    expect(notices).toMatchObject({ possible: 1, possibleImported: 1, possibleStrong: 1 });
  });

  it("with no printed period, last period's import is not a duplicate (line span is the period)", () => {
    const lastWeek = tx({
      id: 'last-week',
      amount: 10,
      date: '2026-03-03',
      importFingerprint: 'last-week',
      importPeriod: { from: '2026-02-24', to: '2026-03-03' },
    });
    const { candidates } = plan({
      identity: { account: {}, period: {} },
      importMeta: { ...importMeta, importPeriod: { from: '2026-03-10', to: '2026-03-10' } },
      lines: [line()],
      transactions: [lastWeek],
    });
    expect(candidates[0]!.match).toBeUndefined();
  });

  it('throws on a misaligned fingerprint list or an unknown account', () => {
    expect(() => plan({ lines: [line()], fingerprints: [] })).toThrow();
    expect(() => plan({ lines: [line()], accountId: 'nope' })).toThrow();
  });
});

describe('planStatementImport: categories', () => {
  it('an unknown hint is counted, warned with the id, and falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { candidates, notices } = plan({ lines: [line({ categoryHint: 'made_up_id' })] });
    expect(candidates[0]!.draft.category).toBe('other_expense');
    expect(notices.badCategory).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'made_up_id', 'other_expense');
  });

  it('a hint valid only for the other direction falls through to merchant memory', () => {
    const { candidates, notices } = plan({
      lines: [line({ description: 'GRAB 8812', categoryHint: 'salary' })],
      transactions: [
        tx({
          id: 'g',
          accountId: 'acc-other',
          description: 'Grab',
          category: 'taxi',
          date: '2025-12-01',
        }),
      ],
    });
    expect(candidates[0]!.draft.category).toBe('taxi');
    expect(notices.badCategory).toBe(0);
  });

  it('falls back to other_income / other_expense', () => {
    const { candidates } = plan({ lines: [line({ direction: 'in' }), line({ description: 'X' })] });
    expect(candidates.map((c) => c.draft.category)).toEqual(['other_income', 'other_expense']);
  });
});

describe('planStatementImport: transfers', () => {
  const cardPlan = (over: Partial<PlanStatementImportInput> & { lines: StatementLineDraft[] }) =>
    plan({
      accountId: 'acc-card',
      identity: { account: { kind: 'card' }, period: importMeta.importPeriod },
      ...over,
    });
  const payment = line({
    kind: 'payment',
    direction: 'in',
    amount: 1200,
    date: '2026-03-20',
    description: 'PAYMENT THANK YOU',
  });

  it('a counterpart in another account is a merge against that row; the draft stays income', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-bank',
      type: 'expense',
      amount: 1200,
      date: '2026-03-19',
      description: 'Card bill',
    });
    const { candidates, notices } = cardPlan({ lines: [payment], transactions: [paid] });
    expect(candidates[0]).toMatchObject({
      defaultDecision: 'merge',
      transfer: { kind: 'counterpart', otherAccountId: 'acc-bank', transactionId: 'dbs-1' },
      match: { id: 'dbs-1', isProjected: false },
      draft: { type: 'income', accountId: 'acc-card' },
    });
    expect(candidates[0]!.draft.toAccountId).toBeUndefined();
    expect(notices.transfers).toBe(1);
  });

  it('an own-account familiar match wins over a counterpart', () => {
    const recorded = tx({
      id: 'xfer',
      type: 'transfer',
      accountId: 'acc-bank',
      toAccountId: 'acc-card',
      amount: 1200,
      date: '2026-03-20',
    });
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-bank',
      type: 'expense',
      amount: 1200,
      date: '2026-03-20',
    });
    const { candidates, notices } = cardPlan({ lines: [payment], transactions: [recorded, paid] });
    expect(candidates[0]!.match?.id).toBe('xfer');
    expect(candidates[0]!.transfer).toBeUndefined();
    expect(notices).toMatchObject({ familiar: 1, transfers: 0 });
  });

  it('a counterpart wins over a possible own-account match', () => {
    const imported = tx({
      id: 'old-import',
      accountId: 'acc-card',
      type: 'income',
      amount: 1200,
      date: '2026-03-20',
      importFingerprint: 'earlier',
    });
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-bank',
      type: 'expense',
      amount: 1200,
      date: '2026-03-20',
    });
    const { candidates } = cardPlan({ lines: [payment], transactions: [imported, paid] });
    expect(candidates[0]!.transfer?.kind).toBe('counterpart');
    expect(candidates[0]!.match?.id).toBe('dbs-1');
  });

  it('a card payment with no counterpart is an offer, draft income, no destination', () => {
    const { candidates } = cardPlan({ lines: [payment] });
    expect(candidates[0]).toMatchObject({
      transfer: { kind: 'offer' },
      defaultDecision: 'add',
      draft: { type: 'income' },
    });
    expect(candidates[0]!.draft.toAccountId).toBeUndefined();
  });

  it('never emits a transfer draft', () => {
    const paid = tx({
      id: 'dbs-1',
      accountId: 'acc-bank',
      type: 'expense',
      amount: 1200,
      date: '2026-03-19',
    });
    const { candidates } = cardPlan({ lines: [payment, payment, line()], transactions: [paid] });
    expect(candidates.every((c) => c.draft.type !== 'transfer')).toBe(true);
  });
});

describe('suggestAccount', () => {
  const sgdSavings = account({ id: 'sav', currency: 'SGD', institution: 'OCBC' });
  const usd = account({ id: 'usd', currency: 'USD', institution: 'Chase' });
  const closed = account({ id: 'closed', currency: 'EUR', isActive: false });

  it('1. last 4 against cardLast4', () => {
    expect(suggestAccount({ last4: '4321' }, [bank, card, usd])).toBe('acc-card');
  });

  it('2. institution (case-insensitive contains) + currency', () => {
    expect(
      suggestAccount({ institution: 'dbs', currency: 'SGD' }, [bank, card, sgdSavings, usd])
    ).toBe('acc-bank');
    expect(suggestAccount({ institution: 'JPMorgan Chase', currency: 'USD' }, [bank, usd])).toBe(
      'usd'
    );
  });

  it('3. the sole active account in the currency', () => {
    expect(suggestAccount({ currency: 'usd' }, [bank, usd])).toBe('usd');
    expect(suggestAccount({ currency: 'EUR' }, [bank, closed])).toBeNull();
  });

  it('null when nothing decides or a rung is ambiguous', () => {
    expect(suggestAccount({}, [bank, usd])).toBeNull();
    expect(suggestAccount({ currency: 'SGD' }, [bank, card, sgdSavings])).toBeNull();
  });
});
