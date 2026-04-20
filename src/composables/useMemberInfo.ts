import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { usePhotoStore } from '@/stores/photoStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { UUID } from '@/types/models';

const DEFAULT_COLOR = '#6b7280';

type TranslateFn = (key: UIStringKey) => string;

/**
 * Public Drive CDN URL for a member's avatar photo, or `null` if the
 * member has no photo or the photo has been flagged unresolved.
 * Shared helper for the dozen-ish avatar call sites across the app —
 * previously each site either skipped `photo-url` entirely (breaking
 * rendering) or re-implemented the same 2-line lookup.
 *
 * Sync. Deterministic from `driveFileId` via `photoStore.getPublicUrl`.
 */
export function getMemberAvatarUrl(member: { avatarPhotoId?: UUID }): string | null {
  if (!member.avatarPhotoId) return null;
  return usePhotoStore().getPublicUrl(member.avatarPhotoId, 'thumb');
}

/**
 * Flag a member's avatar photo as unresolved when the `<img>` load
 * errors (typically a genuine Drive 404 for a deleted file). Call from
 * the `@photo-error` handler on `<BeanieAvatar>`. No-op when the
 * member has no photo set.
 */
export function markMemberAvatarError(member: { avatarPhotoId?: UUID }): void {
  if (!member.avatarPhotoId) return;
  usePhotoStore().markUnresolved(member.avatarPhotoId);
}

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
