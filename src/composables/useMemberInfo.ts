import { useFamilyStore } from '@/stores/familyStore';
import { useAccountsStore } from '@/stores/accountsStore';
import { usePhotoStore } from '@/stores/photoStore';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FamilyMember, UUID } from '@/types/models';

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
 * Whether a member is a grown-up (a "Parent" bean): a human whose
 * ageGroup is `adult`, plus the pod owner as a safety belt (the owner
 * is always an adult even if ageGroup were somehow unset). Pets are
 * never adults — the isPet flag overrides ageGroup/role.
 *
 * Exported standalone so module-level code (e.g. the daily-briefing
 * visibility rule in useCriticalItems) can use it without instantiating
 * a composable.
 */
export function isAdultMember(member: {
  role?: string;
  ageGroup?: string;
  isPet?: boolean;
}): boolean {
  return !member.isPet && (member.role === 'owner' || member.ageGroup === 'adult');
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
  if (isAdultMember(member)) return t('dashboard.roleParent');
  return t('dashboard.roleLittleBean');
}

/**
 * Composable for looking up family member name/color by ID.
 * Replaces duplicated getMemberName/getMemberColor helpers across pages.
 */
export function useMemberInfo() {
  const familyStore = useFamilyStore();

  /** The family member with this ID, or `undefined` (unknown / removed / nullish ID). */
  function getMemberById(memberId: string | null | undefined): FamilyMember | undefined {
    if (!memberId) return undefined;
    return familyStore.members.find((m) => m.id === memberId);
  }

  function getMemberName(memberId: string | null | undefined, fallback = 'Unknown'): string {
    return getMemberById(memberId)?.name ?? fallback;
  }

  function getMemberColor(memberId: string | null | undefined, fallback = DEFAULT_COLOR): string {
    return getMemberById(memberId)?.color ?? fallback;
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
    getMemberById,
    getMemberName,
    getMemberColor,
    getMemberNameByAccountId,
    getMemberColorByAccountId,
  };
}
