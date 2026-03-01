import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { useAssetsStore } from './assetsStore';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { useTombstoneStore } from './tombstoneStore';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import * as accountRepo from '@/services/indexeddb/repositories/accountRepository';
import type { Account, CreateAccountInput, UpdateAccountInput } from '@/types/models';

export const useAccountsStore = defineStore('accounts', () => {
  // State
  const accounts = ref<Account[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activeAccounts = computed(() => accounts.value.filter((a) => a.isActive));

  const accountsByMember = computed(() => {
    const grouped = new Map<string, Account[]>();
    for (const account of accounts.value) {
      const memberAccounts = grouped.get(account.memberId) || [];
      memberAccounts.push(account);
      grouped.set(account.memberId, memberAccounts);
    }
    return grouped;
  });

  // Total balance (net worth) - converts each account to base currency first
  const totalBalance = computed(() => {
    return accounts.value
      .filter((a) => a.isActive && a.includeInNetWorth)
      .reduce((sum, account) => {
        const convertedBalance = convertToBaseCurrency(account.balance, account.currency);
        const multiplier = account.type === 'credit_card' || account.type === 'loan' ? -1 : 1;
        return sum + convertedBalance * multiplier;
      }, 0);
  });

  // Total assets - converts each account to base currency first
  const totalAssets = computed(() => {
    return accounts.value
      .filter(
        (a) => a.isActive && a.includeInNetWorth && a.type !== 'credit_card' && a.type !== 'loan'
      )
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Account-based liabilities only (credit cards, loans)
  const accountLiabilities = computed(() => {
    return accounts.value
      .filter(
        (a) => a.isActive && a.includeInNetWorth && (a.type === 'credit_card' || a.type === 'loan')
      )
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Total liabilities including asset loans
  const totalLiabilities = computed(() => {
    const assetsStore = useAssetsStore();
    return accountLiabilities.value + assetsStore.totalLoanValue;
  });

  // Combined net worth: accounts + assets - all liabilities
  const combinedNetWorth = computed(() => {
    const assetsStore = useAssetsStore();
    // totalBalance already subtracts account liabilities, so add net asset value (assets - asset loans)
    return totalBalance.value + assetsStore.netAssetValue;
  });

  // ========== FILTERED GETTERS (by global member filter) ==========

  // Accounts filtered by global member filter
  const filteredAccounts = createMemberFiltered(accounts, (a) => a.memberId);

  const filteredActiveAccounts = computed(() => filteredAccounts.value.filter((a) => a.isActive));

  // Filtered total balance (net worth from accounts only)
  const filteredTotalBalance = computed(() => {
    return filteredAccounts.value
      .filter((a) => a.isActive && a.includeInNetWorth)
      .reduce((sum, account) => {
        const convertedBalance = convertToBaseCurrency(account.balance, account.currency);
        const multiplier = account.type === 'credit_card' || account.type === 'loan' ? -1 : 1;
        return sum + convertedBalance * multiplier;
      }, 0);
  });

  // Filtered total assets
  const filteredTotalAssets = computed(() => {
    return filteredAccounts.value
      .filter(
        (a) => a.isActive && a.includeInNetWorth && a.type !== 'credit_card' && a.type !== 'loan'
      )
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Filtered account liabilities
  const filteredAccountLiabilities = computed(() => {
    return filteredAccounts.value
      .filter(
        (a) => a.isActive && a.includeInNetWorth && (a.type === 'credit_card' || a.type === 'loan')
      )
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Filtered total liabilities including asset loans
  const filteredTotalLiabilities = computed(() => {
    const assetsStore = useAssetsStore();
    return filteredAccountLiabilities.value + assetsStore.filteredTotalLoanValue;
  });

  // Filtered combined net worth: filtered accounts + filtered assets - filtered liabilities
  const filteredCombinedNetWorth = computed(() => {
    const assetsStore = useAssetsStore();
    return filteredTotalBalance.value + assetsStore.filteredNetAssetValue;
  });

  // Actions
  async function loadAccounts() {
    await wrapAsync(isLoading, error, async () => {
      accounts.value = await accountRepo.getAllAccounts();
    });
  }

  async function createAccount(input: CreateAccountInput): Promise<Account | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const account = await accountRepo.createAccount(input);
      accounts.value.push(account);
      if (accounts.value.length === 1) {
        celebrate('first-account');
      }
      return account;
    });
    return result ?? null;
  }

  async function updateAccount(id: string, input: UpdateAccountInput): Promise<Account | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await accountRepo.updateAccount(id, input);
      if (updated) {
        const index = accounts.value.findIndex((a) => a.id === id);
        if (index !== -1) {
          accounts.value[index] = updated;
        }
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteAccount(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await accountRepo.deleteAccount(id);
      if (success) {
        useTombstoneStore().recordDeletion('account', id);
        accounts.value = accounts.value.filter((a) => a.id !== id);
      }
      return success;
    });
    return result ?? false;
  }

  function getAccountById(id: string): Account | undefined {
    return accounts.value.find((a) => a.id === id);
  }

  function getAccountsByMemberId(memberId: string): Account[] {
    return accounts.value.filter((a) => a.memberId === memberId);
  }

  function resetState() {
    accounts.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    accounts,
    isLoading,
    error,
    // Getters
    activeAccounts,
    accountsByMember,
    totalBalance,
    totalAssets,
    accountLiabilities,
    totalLiabilities,
    combinedNetWorth,
    // Filtered getters (by global member filter)
    filteredAccounts,
    filteredActiveAccounts,
    filteredTotalBalance,
    filteredTotalAssets,
    filteredAccountLiabilities,
    filteredTotalLiabilities,
    filteredCombinedNetWorth,
    // Actions
    loadAccounts,
    createAccount,
    updateAccount,
    deleteAccount,
    getAccountById,
    getAccountsByMemberId,
    resetState,
  };
});
