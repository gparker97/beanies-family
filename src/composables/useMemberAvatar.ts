import { computed, type Ref } from 'vue';
import { usePhotoStore } from '@/stores/photoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { resolveMemberColor } from '@/constants/memberColors';
import type { AvatarVariant } from '@/constants/avatars';
import type { FamilyMember, Gender, AgeGroup, UUID } from '@/types/models';

/**
 * Public Drive CDN URL for a member's avatar photo, or `null` if the member has
 * no photo or the photo has been flagged unresolved.
 *
 * Lives HERE rather than in `useMemberInfo` (where it was until 2026-09-02)
 * because every avatar in the app needs it, and `useMemberInfo` statically
 * imports `useAccountsStore` — so importing it from there put a finance store
 * into every member face, and into the beanie wall's lint-fenced tree.
 * `useMemberInfo` re-exports both helpers, so existing importers are unaffected.
 *
 * Sync. Deterministic from `driveFileId` via `photoStore.getPublicUrl`.
 */
export function getMemberAvatarUrl(member: { avatarPhotoId?: UUID }): string | null {
  if (!member.avatarPhotoId) return null;
  return usePhotoStore().getPublicUrl(member.avatarPhotoId, 'thumb');
}

/**
 * Flag a member's avatar photo as unresolved when the `<img>` load errors
 * (typically a genuine Drive 404 for a deleted file). No-op when the member has
 * no photo set.
 */
export function markMemberAvatarError(member: { avatarPhotoId?: UUID }): void {
  if (!member.avatarPhotoId) return;
  usePhotoStore().markUnresolved(member.avatarPhotoId);
}

/**
 * Resolve an avatar variant from gender and age group.
 */
export function getAvatarVariant(gender: Gender, ageGroup: AgeGroup): AvatarVariant {
  return `${ageGroup}-${gender}` as AvatarVariant;
}

/**
 * Get avatar variant for a family member, with defaults for missing fields.
 * Pets always resolve to the pet-dog icon regardless of gender/ageGroup.
 */
export function getMemberAvatarVariant(
  member: Partial<Pick<FamilyMember, 'gender' | 'ageGroup' | 'isPet'>>
): AvatarVariant {
  if (member.isPet) return 'pet-dog';
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

  // `?? '#3b82f6'` here was a FOURTH neutral-colour fallback, and the only one that was
  // blue rather than grey — so a colourless bean looked like a real blue bean on some
  // surfaces and grey on others. One rule now.
  const color = computed(() => resolveMemberColor(memberRef.value?.color));

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

/**
 * Everything `BeanieAvatar` needs to draw one member, in one `v-bind`.
 *
 * This is what stops the five-into-one consolidation from replacing one
 * component with five copies of its wiring. `WallMemberFace` resolved the photo
 * and handled the load error INTERNALLY; `BeanieAvatar` takes a resolved
 * `photoUrl` and emits `photo-error`. Without this helper every call site would
 * hand-write photo resolution, variant, colour, initials and the error handler —
 * and a site that forgot `@photo-error` would silently stop marking unresolved
 * photos, so a deleted Drive file would retry forever.
 *
 *   <BeanieAvatar v-bind="memberAvatarBindings(member)" fallback="initials" size="sm" />
 *
 * A COMPOSABLE, not a bare function: it resolves both stores once in `setup()`.
 * Called from a template as a bare function, `usePhotoStore()` and
 * `useFamilyStore()` would run once per face per render, and a month grid paints
 * 100+ faces.
 */
export function useMemberAvatarBindings() {
  const familyStore = useFamilyStore();

  function memberAvatarBindings(member: FamilyMember) {
    return {
      variant: getMemberAvatarVariant(member),
      color: resolveMemberColor(member.color),
      photoUrl: getMemberAvatarUrl(member),
      // Defensive `?.`: this runs inside `v-bind` on the render path, and initials are a
      // display nicety. A partially-stubbed store (several page tests provide one) must
      // degrade to a photo-or-colour circle, never take the whole page down.
      initials: familyStore.initialsById?.get(member.id) ?? '',
      ariaLabel: member.name,
      onPhotoError: () => markMemberAvatarError(member),
    };
  }

  return { memberAvatarBindings };
}
