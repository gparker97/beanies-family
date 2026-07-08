import { describe, it, expect } from 'vitest';
import type { Account } from '@/types/models';
import { accountGroupForType, buildAccountOptionGroups } from '../accountOptions';

function acc(overrides: Partial<Account>): Account {
  return {
    id: overrides.id ?? 'a',
    memberId: 'm',
    name: 'Acc',
    type: 'checking',
    currency: 'USD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}

describe('accountGroupForType', () => {
  it('separates cards and loans from cash/bank', () => {
    expect(accountGroupForType('checking')).toBe('cash');
    expect(accountGroupForType('savings')).toBe('cash');
    expect(accountGroupForType('cash')).toBe('cash');
    expect(accountGroupForType('credit_card')).toBe('cards');
    expect(accountGroupForType('loan')).toBe('loans');
    expect(accountGroupForType('investment')).toBe('investments');
    expect(accountGroupForType('crypto')).toBe('investments');
    expect(accountGroupForType('other')).toBe('other');
  });
});

describe('buildAccountOptionGroups', () => {
  const label = (a: Account) => a.name;
  const groupLabel = (id: string) => id;

  it('orders groups (cash, cards, investments, loans, other) and sorts names A→Z within', () => {
    const accounts = [
      acc({ id: 'l1', name: 'Mortgage', type: 'loan' }),
      acc({ id: 'c2', name: 'Zeta Card', type: 'credit_card' }),
      acc({ id: 'b2', name: 'Bravo Checking', type: 'checking' }),
      acc({ id: 'b1', name: 'Alpha Savings', type: 'savings' }),
      acc({ id: 'c1', name: 'Amex Card', type: 'credit_card' }),
    ];
    const groups = buildAccountOptionGroups(accounts, label, groupLabel);
    expect(groups.map((g) => g.id)).toEqual(['cash', 'cards', 'loans']); // empty groups omitted
    expect(groups[0].options.map((o) => o.label)).toEqual(['Alpha Savings', 'Bravo Checking']);
    expect(groups[1].options.map((o) => o.label)).toEqual(['Amex Card', 'Zeta Card']); // sorted
  });

  it('omits empty groups', () => {
    const groups = buildAccountOptionGroups(
      [acc({ id: 'x', type: 'checking' })],
      label,
      groupLabel
    );
    expect(groups.map((g) => g.id)).toEqual(['cash']);
  });
});
