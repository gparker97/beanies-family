// Synthetic statement-import fixtures (#107). Never real statement data.
import type { Account, DisplayTransaction, Transaction } from '@/types/models';
import type { StatementLineDraft } from '@/services/ai/types';

export function account(over: Partial<Account> & { id: string }): Account {
  return {
    memberId: 'm1',
    name: over.id,
    type: 'checking',
    currency: 'USD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function tx(over: Partial<Transaction> & { id: string }): Transaction {
  return {
    accountId: 'acc-bank',
    type: 'expense',
    amount: 10,
    currency: 'USD',
    category: 'groceries',
    date: '2026-03-10',
    description: 'Something',
    isReconciled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

export function projection(over: Partial<DisplayTransaction> & { id: string }): DisplayTransaction {
  return { ...tx(over), isProjected: true, ...over };
}

export function line(over: Partial<StatementLineDraft> = {}): StatementLineDraft {
  return {
    date: '2026-03-10',
    description: 'SHOP 123',
    amount: 10,
    direction: 'out',
    kind: 'purchase',
    ...over,
  };
}
