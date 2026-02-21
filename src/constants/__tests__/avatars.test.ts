import { describe, it, expect } from 'vitest';
import {
  AVATAR_IMAGE_PATHS,
  getAvatarImagePath,
  getAllAvatarVariants,
  type AvatarVariant,
} from '@/constants/avatars';

describe('AVATAR_IMAGE_PATHS', () => {
  it('has all 8 expected variants', () => {
    const variants = getAllAvatarVariants();
    expect(variants).toHaveLength(8);
    expect(variants).toContain('adult-male');
    expect(variants).toContain('adult-female');
    expect(variants).toContain('adult-other');
    expect(variants).toContain('child-male');
    expect(variants).toContain('child-female');
    expect(variants).toContain('child-other');
    expect(variants).toContain('family-group');
    expect(variants).toContain('family-filtered');
  });

  it('all variants map to PNG file paths', () => {
    const variants = getAllAvatarVariants();
    for (const variant of variants) {
      const path = AVATAR_IMAGE_PATHS[variant];
      expect(path).toBeTruthy();
      expect(path).toMatch(/\.png$/);
      expect(path).toMatch(/^\/brand\//);
    }
  });
});

describe('getAvatarImagePath', () => {
  it('returns correct path for adult-male', () => {
    expect(getAvatarImagePath('adult-male')).toBe(
      '/brand/beanies_father_icon_transparent_360x360.png'
    );
  });

  it('returns correct path for adult-female', () => {
    expect(getAvatarImagePath('adult-female')).toBe(
      '/brand/beanies_mother_icon_transparent_350x350.png'
    );
  });

  it('returns correct path for child-male', () => {
    expect(getAvatarImagePath('child-male')).toBe(
      '/brand/beanies_baby_boy_icon_transparent_300x300.png'
    );
  });

  it('returns correct path for child-female', () => {
    expect(getAvatarImagePath('child-female')).toBe(
      '/brand/beanies_baby_girl_icon_transparent_300x300.png'
    );
  });

  it('returns correct path for family-group', () => {
    expect(getAvatarImagePath('family-group')).toBe(
      '/brand/beanies_family_icon_transparent_384x384.png'
    );
  });

  it('returns neutral path for unknown variant', () => {
    expect(getAvatarImagePath('unknown' as AvatarVariant)).toBe(
      '/brand/beanies_neutral_icon_transparent_350x350.png'
    );
  });
});
