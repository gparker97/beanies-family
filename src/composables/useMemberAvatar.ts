import { computed, type Ref } from 'vue';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember, Gender, AgeGroup } from '@/types/models';

/**
 * Resolve an avatar variant from gender and age group.
 */
export function getAvatarVariant(gender: Gender, ageGroup: AgeGroup): AvatarVariant {
  return `${ageGroup}-${gender}` as AvatarVariant;
}

/**
 * Get avatar variant for a family member, with defaults for missing fields.
 */
export function getMemberAvatarVariant(
  member: Partial<Pick<FamilyMember, 'gender' | 'ageGroup'>>
): AvatarVariant {
  const gender: Gender = member.gender ?? 'other';
  const ageGroup: AgeGroup = member.ageGroup ?? 'adult';
  return getAvatarVariant(gender, ageGroup);
}

/**
 * Reactive composable for a single member's avatar.
 */
export function useMemberAvatar(memberRef: Ref<FamilyMember | null | undefined>) {
  const variant = computed<AvatarVariant>(() => {
    if (!memberRef.value) return 'adult-other';
    return getMemberAvatarVariant(memberRef.value);
  });

  const color = computed(() => memberRef.value?.color ?? '#3b82f6');

  return { variant, color };
}

/**
 * Reactive composable for the member filter avatar.
 * Shows 'family-group' when all members are selected, 'family-filtered' otherwise.
 */
export function useFilterAvatar(allSelectedRef: Ref<boolean>) {
  const variant = computed<AvatarVariant>(() =>
    allSelectedRef.value ? 'family-group' : 'family-filtered'
  );

  return { variant };
}
