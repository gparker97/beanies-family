import { useFamilyStore } from '@/stores/familyStore';
import { NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { FamilyMember } from '@/types/models';

/**
 * This module deliberately does NOT import a finance store.
 *
 * It used to import `useAccountsStore` for two account-keyed helpers, which put
 * `accountsStore` into the import graph of everything that touched a member
 * name or colour — including the beanie wall, whose lint fence
 * (`eslint.config.js`, FINANCE EXCLUSION) catches direct imports only and could
 * never have seen it. Those two helpers now live in `useAccountMemberInfo`.
 * Keep this module finance-free.
 */
const DEFAULT_COLOR = NEUTRAL_MEMBER_COLOR;

// Re-exported from `useMemberAvatar` (which is store-light and photo-only) so the
// existing import sites here keep working. See that module for why they moved.
export { getMemberAvatarUrl, markMemberAvatarError } from '@/composables/useMemberAvatar';

type TranslateFn = (key: UIStringKey) => string;

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

  /**
   * `?? fallback` let an EMPTY STRING through, so a member whose colour was `''`
   * rendered a transparent chip. Harmless while hue was decorative; a blank card
   * now that hue is the identity signal.
   */
  function getMemberColor(memberId: string | null | undefined, fallback = DEFAULT_COLOR): string {
    const c = getMemberById(memberId)?.color;
    return c && c.trim() ? c : fallback;
  }

  return {
    getMemberById,
    getMemberName,
    getMemberColor,
  };
}
