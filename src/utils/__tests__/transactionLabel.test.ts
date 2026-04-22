import { describe, it, expect, vi } from 'vitest';
import type { Transaction } from '@/types/models';
import { getTransactionSubtitle, getTransactionVisual } from '../transactionLabel';

/** i18n stub that returns the key with any {placeholders} still embedded for inspection. */
const tStub = (key: string) => {
  const map: Record<string, string> = {
    'accountView.adjustedBy': 'Adjusted by {name}',
    'accountView.adjustedByYou': 'Adjusted by you',
    'accountView.loanLabel': 'Loan payment',
    'accountView.goalLabel': 'Goal allocation',
    'accountView.recurringLabel': 'Recurring: {name}',
    'accountView.transferTo': 'Transfer → {account}',
    'accountView.transferFrom': 'Transfer ← {account}',
    'family.unknownMember': 'Unknown',
    'family.unknownAccount': 'Unknown account',
  };
  return map[key] ?? key;
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    accountId: 'acc-1',
    type: 'expense',
    amount: 10,
    currency: 'USD',
    category: 'groceries',
    date: '2026-04-21',
    description: 'Test',
    isReconciled: false,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('getTransactionSubtitle', () => {
  it('balance_adjustment by another member: "Adjusted by {name}"', () => {
    const t = tx({
      type: 'balance_adjustment',
      adjustment: { delta: 50, updatedBy: 'member-a' },
    });
    const result = getTransactionSubtitle(t, {
      t: tStub,
      authorName: 'Alice',
      currentMemberId: 'member-b',
    });
    expect(result).toBe('Adjusted by Alice');
  });

  it('balance_adjustment by the current member: "Adjusted by you"', () => {
    const t = tx({
      type: 'balance_adjustment',
      adjustment: { delta: 50, updatedBy: 'member-a' },
    });
    const result = getTransactionSubtitle(t, {
      t: tStub,
      authorName: 'Alice',
      currentMemberId: 'member-a',
    });
    expect(result).toBe('Adjusted by you');
  });

  it('balance_adjustment with no authorName falls back to Unknown', () => {
    const t = tx({
      type: 'balance_adjustment',
      adjustment: { delta: 50, updatedBy: 'member-missing' },
    });
    const result = getTransactionSubtitle(t, { t: tStub, currentMemberId: 'member-other' });
    expect(result).toBe('Adjusted by Unknown');
  });

  it('loan payment (loanId set) wins over goal/recurring', () => {
    const t = tx({ loanId: 'loan-1', goalId: 'goal-1', recurringItemId: 'r-1' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Loan payment');
  });

  it('loan payment (amortization portions set, no loanId)', () => {
    const t = tx({ loanInterestPortion: 10, loanPrincipalPortion: 90 });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Loan payment');
  });

  it('goal allocation wins over recurring', () => {
    const t = tx({ goalId: 'goal-1', recurringItemId: 'r-1' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Goal allocation');
  });

  it('recurring with resolved name', () => {
    const t = tx({ recurringItemId: 'r-1', description: 'Netflix charge' });
    const result = getTransactionSubtitle(t, { t: tStub, recurringItemName: 'Netflix' });
    expect(result).toBe('Recurring: Netflix');
  });

  it('recurring falls back to description when name is missing', () => {
    const t = tx({ recurringItemId: 'r-1', description: 'Netflix charge' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Recurring: Netflix charge');
  });

  it('transfer from the source-account perspective: "Transfer → {dest}"', () => {
    const t = tx({
      type: 'transfer',
      accountId: 'acc-1',
      toAccountId: 'acc-2',
      description: 'Monthly top-up',
    });
    const result = getTransactionSubtitle(
      t,
      { t: tStub, transferCounterpartyName: 'Savings' },
      'acc-1'
    );
    expect(result).toBe('Transfer → Savings');
  });

  it('transfer from the destination-account perspective: "Transfer ← {source}"', () => {
    const t = tx({
      type: 'transfer',
      accountId: 'acc-1',
      toAccountId: 'acc-2',
    });
    const result = getTransactionSubtitle(
      t,
      { t: tStub, transferCounterpartyName: 'Main Checking' },
      'acc-2'
    );
    expect(result).toBe('Transfer ← Main Checking');
  });

  it('transfer with no vantage defaults to source direction', () => {
    const t = tx({ type: 'transfer', accountId: 'acc-1', toAccountId: 'acc-2' });
    const result = getTransactionSubtitle(t, { t: tStub, transferCounterpartyName: 'Savings' });
    expect(result).toBe('Transfer → Savings');
  });

  it('transfer with no counterparty name falls back to Unknown account', () => {
    const t = tx({ type: 'transfer', accountId: 'acc-1', toAccountId: 'acc-2' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Transfer → Unknown account');
  });

  it('plain income returns the description', () => {
    const t = tx({ type: 'income', description: 'Salary payout' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Salary payout');
  });

  it('plain expense returns the description', () => {
    const t = tx({ type: 'expense', description: 'Coffee' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('Coffee');
  });

  it('warns in dev when description is empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = tx({ type: 'expense', description: '' });
    expect(getTransactionSubtitle(t, { t: tStub })).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      '[getTransactionSubtitle] transaction has no description:',
      t.id,
      'expense'
    );
    warnSpy.mockRestore();
  });
});

describe('getTransactionVisual', () => {
  it('income → money-bag icon, green tint', () => {
    expect(getTransactionVisual(tx({ type: 'income' }))).toEqual({
      icon: '\u{1F4B0}',
      tint: 'green',
    });
  });

  it('expense → credit-card icon, orange tint', () => {
    expect(getTransactionVisual(tx({ type: 'expense' }))).toEqual({
      icon: '\u{1F4B3}',
      tint: 'orange',
    });
  });

  it('transfer → arrows icon, blue tint', () => {
    expect(getTransactionVisual(tx({ type: 'transfer' }))).toEqual({
      icon: '\u{1F504}',
      tint: 'blue',
    });
  });

  it('balance_adjustment with positive delta → scale icon, green tint', () => {
    const t = tx({
      type: 'balance_adjustment',
      adjustment: { delta: 500, updatedBy: 'm-1' },
    });
    expect(getTransactionVisual(t)).toEqual({ icon: '⚖️', tint: 'green' });
  });

  it('balance_adjustment with negative delta → scale icon, orange tint', () => {
    const t = tx({
      type: 'balance_adjustment',
      adjustment: { delta: -300, updatedBy: 'm-1' },
    });
    expect(getTransactionVisual(t)).toEqual({ icon: '⚖️', tint: 'orange' });
  });

  it('balance_adjustment with zero/missing delta → scale icon, slate tint', () => {
    const tZero = tx({
      type: 'balance_adjustment',
      adjustment: { delta: 0, updatedBy: 'm-1' },
    });
    expect(getTransactionVisual(tZero)).toEqual({ icon: '⚖️', tint: 'slate' });

    const tMissing = tx({ type: 'balance_adjustment' });
    expect(getTransactionVisual(tMissing)).toEqual({ icon: '⚖️', tint: 'slate' });
  });
});
