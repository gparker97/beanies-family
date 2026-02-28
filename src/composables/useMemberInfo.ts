import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';

const DEFAULT_COLOR = '#6b7280';

/**
 * Composable for looking up family member name/color by ID.
 * Replaces duplicated getMemberName/getMemberColor helpers across pages.
 */
export function useMemberInfo() {
  const familyStore = useFamilyStore();

  function getMemberName(memberId: string | undefined, fallback = 'Unknown'): string {
    if (!memberId) return fallback;
    return familyStore.members.find((m) => m.id === memberId)?.name ?? fallback;
  }

  function getMemberColor(memberId: string | undefined, fallback = DEFAULT_COLOR): string {
    if (!memberId) return fallback;
    return familyStore.members.find((m) => m.id === memberId)?.color ?? fallback;
  }

  function getMemberNameByAccountId(accountId: string, fallback = 'Unknown'): string {
    const accountsStore = useAccountsStore();
    const account = accountsStore.accounts.find((a) => a.id === accountId);
    if (!account) return fallback;
    return getMemberName(account.memberId, fallback);
  }

  function getMemberColorByAccountId(accountId: string, fallback = DEFAULT_COLOR): string {
    const accountsStore = useAccountsStore();
    const account = accountsStore.accounts.find((a) => a.id === accountId);
    if (!account) return fallback;
    return getMemberColor(account.memberId, fallback);
  }

  return {
    getMemberName,
    getMemberColor,
    getMemberNameByAccountId,
    getMemberColorByAccountId,
  };
}
