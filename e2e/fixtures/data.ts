import type { FamilyMember, Account, Transaction, Settings } from '@/types/models';

export class TestDataFactory {
  static createFamilyMember(overrides?: Partial<FamilyMember>): FamilyMember {
    const now = new Date().toISOString();
    return {
      id: `member-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: 'Test Owner',
      email: `owner-${Date.now()}@test.com`,
      role: 'owner',
      color: '#3b82f6',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  static createAccount(memberId: string, overrides?: Partial<Account>): Account {
    const now = new Date().toISOString();
    return {
      id: `account-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      memberId,
      name: 'Test Checking',
      type: 'checking',
      currency: 'USD',
      balance: 1000,
      isActive: true,
      includeInNetWorth: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  static createTransaction(accountId: string, overrides?: Partial<Transaction>): Transaction {
    const now = new Date().toISOString();
    return {
      id: `transaction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      accountId,
      type: 'expense',
      amount: 50,
      currency: 'USD',
      category: 'groceries',
      date: now.split('T')[0],
      description: 'Test Expense',
      isReconciled: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  static createSettings(overrides?: Partial<Settings>): Settings {
    const now = new Date().toISOString();
    return {
      id: 'app_settings',
      baseCurrency: 'USD',
      displayCurrency: 'USD',
      exchangeRates: [],
      theme: 'light',
      syncEnabled: false,
      aiProvider: 'none',
      aiApiKeys: {},
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }
}
