import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import type { UIStringKey } from '@/services/translation/uiStrings';

const DEFAULT_COLOR = '#6b7280';

type TranslateFn = (key: UIStringKey) => string;

/**
 * Member role label for "Your Beans"-style roster surfaces (Nook + dashboard).
 * Returns the localized "Parent / Little Beanie / Pet Beanie" string. Pet
 * takes precedence over adult/owner classification because an isPet flag
 * overrides ageGroup/role — the pet role pill selected in the Add/Edit
 * Beanie drawer is the source of truth.
 *
 * Exported standalone so components can call it without instantiating
 * useMemberInfo's ID-lookup surface.
 */
export function getMemberRoleLabel(
  member: { role: string; ageGroup?: string; isPet?: boolean },
  t: TranslateFn
): string {
  if (member.isPet) return t('dashboard.rolePet');
  if (member.role === 'owner' || member.ageGroup === 'adult') {
    return t('dashboard.roleParent');
  }
  return t('dashboard.roleLittleBean');
}

/**
 * Composable for looking up family member name/color by ID.
 * Replaces duplicated getMemberName/getMemberColor helpers across pages.
 */
export function useMemberInfo() {
  const familyStore = useFamilyStore();

  function getMemberName(memberId: string | null | undefined, fallback = 'Unknown'): string {
    if (!memberId) return fallback;
    return familyStore.members.find((m) => m.id === memberId)?.name ?? fallback;
  }

  function getMemberColor(memberId: string | null | undefined, fallback = DEFAULT_COLOR): string {
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
