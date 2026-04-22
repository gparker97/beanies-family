import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { useAssetsStore } from './assetsStore';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { convertToBaseCurrency } from '@/utils/currency';
import { accountNetWorthMultiplier, isLiabilityType } from '@/utils/finance';
import * as accountRepo from '@/services/automerge/repositories/accountRepository';
import { syncEntityLinkedRecurringItem } from '@/utils/linkedRecurringItem';
import type { Account, CreateAccountInput, UpdateAccountInput, CurrencyCode } from '@/types/models';

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
        return sum + convertedBalance * accountNetWorthMultiplier(account);
      }, 0);
  });

  // Total assets - converts each account to base currency first
  const totalAssets = computed(() => {
    return accounts.value
      .filter((a) => a.isActive && a.includeInNetWorth && !isLiabilityType(a.type))
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Account-based liabilities only (credit cards, loans)
  const accountLiabilities = computed(() => {
    return accounts.value
      .filter((a) => a.isActive && a.includeInNetWorth && isLiabilityType(a.type))
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Total liabilities — all loan-type accounts (including asset-linked) + credit cards
  const totalLiabilities = computed(() => {
    return accountLiabilities.value;
  });

  // Combined net worth: accounts + asset values (loans are already account-type liabilities)
  const combinedNetWorth = computed(() => {
    const assetsStore = useAssetsStore();
    return totalBalance.value + assetsStore.totalAssetValue;
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
        return sum + convertedBalance * accountNetWorthMultiplier(account);
      }, 0);
  });

  // Filtered total assets
  const filteredTotalAssets = computed(() => {
    return filteredAccounts.value
      .filter((a) => a.isActive && a.includeInNetWorth && !isLiabilityType(a.type))
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Filtered account liabilities
  const filteredAccountLiabilities = computed(() => {
    return filteredAccounts.value
      .filter((a) => a.isActive && a.includeInNetWorth && isLiabilityType(a.type))
      .reduce((sum, a) => sum + convertToBaseCurrency(a.balance, a.currency), 0);
  });

  // Filtered total liabilities — all loan-type accounts (including asset-linked) + credit cards
  const filteredTotalLiabilities = computed(() => {
    return filteredAccountLiabilities.value;
  });

  // Filtered combined net worth: filtered accounts + filtered asset values
  const filteredCombinedNetWorth = computed(() => {
    const assetsStore = useAssetsStore();
    return filteredTotalBalance.value + assetsStore.filteredTotalAssetValue;
  });

  // ── Linked recurring payment sync ──────────────────────────────────────────
  async function syncLinkedRecurringPayment(account: Account) {
    if (account.type !== 'loan') return;
    const enabled = !!(account.payFromAccountId && account.monthlyPayment);
    const newItemId = await syncEntityLinkedRecurringItem({
      enabled,
      existingItemId: account.linkedRecurringItemId,
      accountId: account.payFromAccountId,
      amount: account.monthlyPayment ?? 0,
      currency: account.currency as CurrencyCode,
      category: 'loan_payment',
      description: `${account.name} Payment`,
      loanId: account.id,
      startDate: account.loanStartDate,
    });
    if (newItemId !== account.linkedRecurringItemId) {
      await accountRepo.updateAccount(account.id, {
        ...(newItemId ? { linkedRecurringItemId: newItemId } : {}),
      });
      accounts.value = accounts.value.map((a) =>
        a.id === account.id ? { ...a, linkedRecurringItemId: newItemId } : a
      );
    }
  }

  // Actions
  async function loadAccounts() {
    await wrapAsync(isLoading, error, async () => {
      accounts.value = await accountRepo.getAllAccounts();
    });
  }

  async function createAccount(input: CreateAccountInput): Promise<Account | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const account = await accountRepo.createAccount(input);
      const isFirst = accounts.value.length === 0;
      // Immutable update: assign a new array so downstream computeds re-evaluate
      accounts.value = [...accounts.value, account];
      if (isFirst) {
        celebrate('first-account');
      }
      return account;
    });
    if (result) await syncLinkedRecurringPayment(result);
    return result ?? null;
  }

  async function updateAccount(id: string, input: UpdateAccountInput): Promise<Account | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await accountRepo.updateAccount(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        accounts.value = accounts.value.map((a) => (a.id === id ? updated : a));
      }
      return updated;
    });
    if (result) await syncLinkedRecurringPayment(result);
    return result ?? null;
  }

  async function deleteAccount(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await accountRepo.deleteAccount(id);
      if (success) {
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
