import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
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
      expect(accountRepo.updateAccount).toHaveBeenCalledWith('test-account-1', { name: 'Updated Account Name' });
    });

    it('should update account balance', async () => {
      const store = useAccountsStore();

      // Setup
      store.accounts.push({ ...mockAccount });

      const updatedAccount = { ...mockAccount, balance: 2500.50 };
      vi.mocked(accountRepo.updateAccount).mockResolvedValue(updatedAccount);

      // Act
      const result = await store.updateAccount('test-account-1', { balance: 2500.50 });

      // Assert
      expect(result).not.toBeNull();
      expect(result!.balance).toBe(2500.50);
      expect(store.accounts[0]!.balance).toBe(2500.50);
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
      expect(result.every(a => a.memberId === 'member-1')).toBe(true);
    });
  });
});
