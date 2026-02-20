import { describe, it, expect } from 'vitest';
import {
  BEANIE_AVATARS,
  getAvatarDef,
  getAllAvatarVariants,
  type AvatarVariant,
} from '@/constants/avatars';

describe('BEANIE_AVATARS', () => {
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

  const characterVariants: AvatarVariant[] = [
    'adult-male',
    'adult-female',
    'adult-other',
    'child-male',
    'child-female',
    'child-other',
  ];

  it.each(characterVariants)('%s has body, eyes, smile fields', (variant) => {
    const def = BEANIE_AVATARS[variant];
    expect(def.body).toBeTruthy();
    expect(def.eyes.length).toBeGreaterThanOrEqual(2);
    expect(def.smile).toBeTruthy();
  });

  it('child variants have beanie hat accessories', () => {
    const childVariants: AvatarVariant[] = ['child-male', 'child-female', 'child-other'];
    for (const variant of childVariants) {
      const def = BEANIE_AVATARS[variant];
      // All children should have at least 3 accessories (dome, brim, pom-pom)
      expect(def.accessories.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('adult-other has no accessories', () => {
    const def = BEANIE_AVATARS['adult-other'];
    expect(def.accessories).toHaveLength(0);
  });

  it('adult-male has cap accessory', () => {
    const def = BEANIE_AVATARS['adult-male'];
    expect(def.accessories.length).toBeGreaterThanOrEqual(1);
  });

  it('adult-female has hair and bow accessories', () => {
    const def = BEANIE_AVATARS['adult-female'];
    // Hair dome (1) + hair strands (2) + bow triangles (2) + knot (1) = 6
    expect(def.accessories.length).toBeGreaterThanOrEqual(6);
  });

  it('child-female has hair peeking from beanie and bow', () => {
    const def = BEANIE_AVATARS['child-female'];
    // Hair (2) + hat dome + brim + pom-pom + bow (2 petals + knot) = 8
    expect(def.accessories.length).toBeGreaterThanOrEqual(8);
  });
});

describe('getAvatarDef', () => {
  it('returns definition for valid variant', () => {
    const def = getAvatarDef('adult-male');
    expect(def).toBeDefined();
    expect(def?.body).toBeTruthy();
  });

  it('returns undefined for unknown variant', () => {
    const def = getAvatarDef('unknown' as AvatarVariant);
    expect(def).toBeUndefined();
  });
});
