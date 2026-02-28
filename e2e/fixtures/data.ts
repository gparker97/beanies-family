import type {
  FamilyMember,
  Account,
  Transaction,
  Asset,
  Settings,
  FamilyActivity,
} from '@/types/models';

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

  static createAsset(memberId: string, overrides?: Partial<Asset>): Asset {
    const now = new Date().toISOString();
    return {
      id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      memberId,
      type: 'real_estate',
      name: 'Test Property',
      purchaseValue: 500000,
      currentValue: 550000,
      currency: 'USD',
      includeInNetWorth: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  static createActivity(createdBy: string, overrides?: Partial<FamilyActivity>): FamilyActivity {
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];
    return {
      id: `activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: 'Test Activity',
      date: todayStr,
      recurrence: 'weekly',
      daysOfWeek: [new Date().getDay()],
      category: 'lesson',
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      createdBy,
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
