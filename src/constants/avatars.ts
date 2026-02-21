/**
 * Beanie Character Avatar Definitions
 *
 * 8 avatar variants mapped to hand-crafted PNG brand assets.
 * Each variant maps to a transparent PNG in public/brand/.
 *
 * Member color differentiation uses a colored ring border + soft pastel
 * background behind each avatar (handled by BeanieAvatar.vue).
 */

export type AvatarVariant =
  | 'adult-male'
  | 'adult-female'
  | 'adult-other'
  | 'child-male'
  | 'child-female'
  | 'child-other'
  | 'family-group'
  | 'family-filtered';

/**
 * Map each avatar variant to its PNG asset path (relative to public/).
 */
const AVATAR_IMAGE_PATHS: Record<AvatarVariant, string> = {
  'adult-male': '/brand/beanies_father_icon_transparent_360x360.png',
  'adult-female': '/brand/beanies_mother_icon_transparent_350x350.png',
  'adult-other': '/brand/beanies_neutral_icon_transparent_350x350.png',
  'child-male': '/brand/beanies_baby_boy_icon_transparent_300x300.png',
  'child-female': '/brand/beanies_baby_girl_icon_transparent_300x300.png',
  'child-other': '/brand/beanies_neutral_icon_transparent_350x350.png',
  'family-group': '/brand/beanies_family_icon_transparent_384x384.png',
  'family-filtered': '/brand/beanies_neutral_icon_transparent_350x350.png',
};

/**
 * Get the PNG image path for an avatar variant.
 */
export function getAvatarImagePath(variant: AvatarVariant): string {
  return AVATAR_IMAGE_PATHS[variant] ?? AVATAR_IMAGE_PATHS['adult-other'];
}

/**
 * Get all defined avatar variants.
 */
export function getAllAvatarVariants(): AvatarVariant[] {
  return Object.keys(AVATAR_IMAGE_PATHS) as AvatarVariant[];
}

export { AVATAR_IMAGE_PATHS };
