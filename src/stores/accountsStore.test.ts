import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAccountsStore } from './accountsStore';
import type { Account } from '@/types/models';

// Mock the account repository
vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

import * as accountRepo from '@/services/indexeddb/repositories/accountRepository';

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

describe('accountsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('updateAccount', () => {
    it('should update account name', async () => {
      const store = useAccountsStore();

      // Setup: add an account to the store
      store.accounts.push({ ...mockAccount });

      // Mock the repository to return updated account
      const updatedAccount = { ...mockAccount, name: 'Updated Account Name' };
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(updatedAccount);

      // Act: update the account name
      const result = await store.updateAccount('test-account-1', { name: 'Updated Account Name' });

      // Assert
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated Account Name');
      expect(store.accounts[0]!.name).toBe('Updated Account Name');
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', {
        name: 'Updated Account Name',
      });
    });

    it('should update account balance', async () => {
      const store = useAccountsStore();

      // Setup
      store.accounts.push({ ...mockAccount });

      const updatedAccount = { ...mockAccount, balance: 2500.5 };
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(updatedAccount);

      // Act
      const result = await store.updateAccount('test-account-1', { balance: 2500.5 });

      // Assert
      expect(result).not.toBeNull();
      expect(result!.balance).toBe(2500.5);
      expect(store.accounts[0]!.balance).toBe(2500.5);
    });

    it('should update account memberId (associate with different family member)', async () => {
      const store = useAccountsStore();

      // Setup
      store.accounts.push({ ...mockAccount });

      const updatedAccount = { ...mockAccount, memberId: 'member-2' };
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(updatedAccount);

      // Act
      const result = await store.updateAccount('test-account-1', { memberId: 'member-2' });

      // Assert
      expect(result).not.toBeNull();
      expect(result!.memberId).toBe('member-2');
      expect(store.accounts[0]!.memberId).toBe('member-2');
    });

    it('should update multiple fields at once', async () => {
      const store = useAccountsStore();

      // Setup
      store.accounts.push({ ...mockAccount });

      const updatedAccount = {
        ...mockAccount,
        name: 'New Name',
        balance: 5000,
        memberId: 'member-3',
        institution: 'New Bank',
      };
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(updatedAccount);

      // Act
      const result = await store.updateAccount('test-account-1', {
        name: 'New Name',
        balance: 5000,
        memberId: 'member-3',
        institution: 'New Bank',
      });

      // Assert
      expect(result).not.toBeNull();
      expect(result?.name).toBe('New Name');
      expect(result?.balance).toBe(5000);
      expect(result?.memberId).toBe('member-3');
      expect(result?.institution).toBe('New Bank');
    });

    it('should return null when account not found', async () => {
      const store = useAccountsStore();

      // Mock repository returning undefined (not found)
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(undefined);

      // Act
      const result = await store.updateAccount('non-existent-id', { name: 'Test' });

      // Assert
      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const store = useAccountsStore();

      // Mock repository throwing an error
      vi.mocked(accountRepo.updateAccount).mockRejectedValue(new Error('Database error'));

      // Act
      const result = await store.updateAccount('test-account-1', { name: 'Test' });

      // Assert
      expect(result).toBeNull();
      expect(store.error).toBe('Database error');
    });
  });

  describe('getAccountById', () => {
    it('should return account by id', () => {
      const store = useAccountsStore();
      store.accounts.push({ ...mockAccount });

      const result = store.getAccountById('test-account-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-account-1');
    });

    it('should return undefined for non-existent id', () => {
      const store = useAccountsStore();

      const result = store.getAccountById('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('getAccountsByMemberId', () => {
    it('should return accounts for a specific member', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', memberId: 'member-1' },
        { ...mockAccount, id: 'acc-2', memberId: 'member-1' },
        { ...mockAccount, id: 'acc-3', memberId: 'member-2' }
      );

      const result = store.getAccountsByMemberId('member-1');

      expect(result.length).toBe(2);
      expect(result.every((a) => a.memberId === 'member-1')).toBe(true);
    });
  });
});

describe('accountsStore - Summary Card Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('totalAssets', () => {
    it('should sum balances of all asset accounts (checking, savings, investment, crypto, cash)', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000 },
        { ...mockAccount, id: 'acc-2', type: 'savings', balance: 10000 },
        { ...mockAccount, id: 'acc-3', type: 'investment', balance: 25000 },
        { ...mockAccount, id: 'acc-4', type: 'crypto', balance: 5000 },
        { ...mockAccount, id: 'acc-5', type: 'cash', balance: 500 }
      );

      // Total assets: 5000 + 10000 + 25000 + 5000 + 500 = 45500
      expect(store.totalAssets).toBe(45500);
    });

    it('should NOT include credit card or loan accounts in assets', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000 },
        { ...mockAccount, id: 'acc-2', type: 'credit_card', balance: 2000 }, // Liability
        { ...mockAccount, id: 'acc-3', type: 'loan', balance: 50000 } // Liability
      );

      // Only checking counts as asset
      expect(store.totalAssets).toBe(5000);
    });

    it('should only include active accounts', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000, isActive: true },
        { ...mockAccount, id: 'acc-2', type: 'savings', balance: 10000, isActive: false } // Inactive
      );

      expect(store.totalAssets).toBe(5000);
    });

    it('should only include accounts marked for net worth', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000, includeInNetWorth: true },
        { ...mockAccount, id: 'acc-2', type: 'savings', balance: 10000, includeInNetWorth: false } // Excluded
      );

      expect(store.totalAssets).toBe(5000);
    });
  });

  describe('totalLiabilities', () => {
    it('should sum balances of credit card and loan accounts', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'credit_card', balance: 2000 },
        { ...mockAccount, id: 'acc-2', type: 'loan', balance: 50000 }
      );

      // Total liabilities: 2000 + 50000 = 52000
      expect(store.totalLiabilities).toBe(52000);
    });

    it('should NOT include asset accounts in liabilities', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000 }, // Asset
        { ...mockAccount, id: 'acc-2', type: 'credit_card', balance: 2000 }
      );

      expect(store.totalLiabilities).toBe(2000);
    });

    it('should only include active liability accounts', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'credit_card', balance: 2000, isActive: true },
        { ...mockAccount, id: 'acc-2', type: 'loan', balance: 50000, isActive: false } // Inactive
      );

      expect(store.totalLiabilities).toBe(2000);
    });
  });

  describe('totalBalance (Net Worth)', () => {
    it('should be assets minus liabilities', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 10000 },
        { ...mockAccount, id: 'acc-2', type: 'savings', balance: 20000 },
        { ...mockAccount, id: 'acc-3', type: 'credit_card', balance: 5000 },
        { ...mockAccount, id: 'acc-4', type: 'loan', balance: 15000 }
      );

      // Assets: 10000 + 20000 = 30000
      // Liabilities: 5000 + 15000 = 20000
      // Net worth: 30000 - 20000 = 10000
      expect(store.totalBalance).toBe(10000);
    });

    it('should be negative when liabilities exceed assets', () => {
      const store = useAccountsStore();

      store.accounts.push(
        { ...mockAccount, id: 'acc-1', type: 'checking', balance: 5000 },
        { ...mockAccount, id: 'acc-2', type: 'loan', balance: 50000 }
      );

      // Assets: 5000, Liabilities: 50000
      // Net worth: 5000 - 50000 = -45000
      expect(store.totalBalance).toBe(-45000);
    });
  });
});
