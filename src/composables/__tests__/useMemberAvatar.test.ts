import { describe, it, expect } from 'vitest';
import { ref } from 'vue';
import {
  getAvatarVariant,
  getMemberAvatarVariant,
  useMemberAvatar,
  useFilterAvatar,
} from '@/composables/useMemberAvatar';
import type { FamilyMember } from '@/types/models';

describe('getAvatarVariant', () => {
  it('returns adult-male for male adult', () => {
    expect(getAvatarVariant('male', 'adult')).toBe('adult-male');
  });

  it('returns adult-female for female adult', () => {
    expect(getAvatarVariant('female', 'adult')).toBe('adult-female');
  });

  it('returns adult-other for other adult', () => {
    expect(getAvatarVariant('other', 'adult')).toBe('adult-other');
  });

  it('returns child-male for male child', () => {
    expect(getAvatarVariant('male', 'child')).toBe('child-male');
  });

  it('returns child-female for female child', () => {
    expect(getAvatarVariant('female', 'child')).toBe('child-female');
  });

  it('returns child-other for other child', () => {
    expect(getAvatarVariant('other', 'child')).toBe('child-other');
  });
});

describe('getMemberAvatarVariant', () => {
  it('returns correct variant for member with gender and ageGroup', () => {
    expect(getMemberAvatarVariant({ gender: 'female', ageGroup: 'child' })).toBe('child-female');
  });

  it('defaults to adult-other when gender is undefined', () => {
    expect(getMemberAvatarVariant({ ageGroup: 'adult' })).toBe('adult-other');
  });

  it('defaults to adult-other when ageGroup is undefined', () => {
    expect(getMemberAvatarVariant({ gender: 'other' })).toBe('adult-other');
  });

  it('defaults to adult-other when both are undefined', () => {
    expect(getMemberAvatarVariant({})).toBe('adult-other');
  });
});

describe('useMemberAvatar', () => {
  it('returns adult-other when member is null', () => {
    const memberRef = ref<FamilyMember | null>(null);
    const { variant, color } = useMemberAvatar(memberRef);
    expect(variant.value).toBe('adult-other');
    expect(color.value).toBe('#3b82f6');
  });

  it('returns correct variant and color for a member', () => {
    const memberRef = ref<FamilyMember | null>({
      id: '1',
      name: 'Test',
      email: 'test@example.com',
      gender: 'male',
      ageGroup: 'child',
      role: 'member',
      color: '#ef4444',
      requiresPassword: false,
      createdAt: '',
      updatedAt: '',
    });
    const { variant, color } = useMemberAvatar(memberRef);
    expect(variant.value).toBe('child-male');
    expect(color.value).toBe('#ef4444');
  });
});

describe('useFilterAvatar', () => {
  it('returns family-group when all are selected', () => {
    const allSelected = ref(true);
    const { variant } = useFilterAvatar(allSelected);
    expect(variant.value).toBe('family-group');
  });

  it('returns family-filtered when not all are selected', () => {
    const allSelected = ref(false);
    const { variant } = useFilterAvatar(allSelected);
    expect(variant.value).toBe('family-filtered');
  });
});
