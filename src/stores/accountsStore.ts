import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { useAssetsStore } from './assetsStore';
import { useMemberFilterStore } from './memberFilterStore';
import { useSettingsStore } from './settingsStore';
import { useTombstoneStore } from './tombstoneStore';
import * as accountRepo from '@/services/indexeddb/repositories/accountRepository';
import type {
  Account,
  CreateAccountInput,
  UpdateAccountInput,
  CurrencyCode,
  ExchangeRate,
} from '@/types/models';

export const useAccountsStore = defineStore('accounts', () => {
  // State
  const accounts = ref<Account[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Helper to get exchange rate
  function getRate(
    rates: ExchangeRate[],
    from: CurrencyCode,
    to: CurrencyCode
  ): number | undefined {
    if (from === to) return 1;

    // Direct rate
    const direct = rates.find((r) => r.from === from && r.to === to);
    if (direct) return direct.rate;

    // Inverse rate
    const inverse = rates.find((r) => r.from === to && r.to === from);
    if (inverse) return 1 / inverse.rate;

    return undefined;
  }

  // Helper to convert amount to base currency
  function convertToBaseCurrency(amount: number, fromCurrency: CurrencyCode): number {
    const settingsStore = useSettingsStore();
    const baseCurrency = settingsStore.baseCurrency;

    if (fromCurrency === baseCurrency) return amount;

    const rate = getRate(settingsStore.exchangeRates, fromCurrency, baseCurrency);
    return rate !== undefined ? amount * rate : amount;
  }

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
  const filteredAccounts = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return accounts.value;
    }
    return accounts.value.filter((a) => memberFilter.isMemberSelected(a.memberId));
  });

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
    isLoading.value = true;
    error.value = null;
    try {
      accounts.value = await accountRepo.getAllAccounts();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load accounts';
    } finally {
      isLoading.value = false;
    }
  }

  async function createAccount(input: CreateAccountInput): Promise<Account | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const account = await accountRepo.createAccount(input);
      accounts.value.push(account);
      if (accounts.value.length === 1) {
        celebrate('first-account');
      }
      return account;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create account';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateAccount(id: string, input: UpdateAccountInput): Promise<Account | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await accountRepo.updateAccount(id, input);
      if (updated) {
        const index = accounts.value.findIndex((a) => a.id === id);
        if (index !== -1) {
          accounts.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update account';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteAccount(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await accountRepo.deleteAccount(id);
      if (success) {
        useTombstoneStore().recordDeletion('account', id);
        accounts.value = accounts.value.filter((a) => a.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete account';
      return false;
    } finally {
      isLoading.value = false;
    }
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
