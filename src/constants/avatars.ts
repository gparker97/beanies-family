/**
 * Beanie Character Avatar Definitions
 *
 * 8 avatar variants rendered as inline SVGs.
 * Each avatar is a bean/pill-shaped character with simple features.
 * All children wear a beanie hat (the brand signature).
 *
 * ViewBox: 0 0 64 64 for all variants.
 * Body is filled with the member's profile color.
 * Eyes, smile, and accessories are rendered in Deep Slate (#2C3E50).
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

export interface BeanieAvatarDef {
  /** SVG path for the bean body (filled with member color) */
  body: string;
  /** SVG paths for eyes (filled with Deep Slate) */
  eyes: string[];
  /** SVG path for smile (stroked in Deep Slate) */
  smile: string;
  /** SVG paths for accessories like hats, bows (filled/stroked in Deep Slate) */
  accessories: string[];
}

/**
 * Avatar definitions for each variant.
 * All paths use a 64x64 viewBox coordinate system.
 */
const BEANIE_AVATARS: Record<AvatarVariant, BeanieAvatarDef> = {
  // Adult male: taller bean body + small cap/visor at top
  'adult-male': {
    body: 'M32 12 C20 12 14 22 14 36 C14 50 20 56 32 56 C44 56 50 50 50 36 C50 22 44 12 32 12Z',
    eyes: [
      'M25 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 40 Q32 45 37 40',
    accessories: [
      // Cap visor
      'M20 16 Q22 10 32 10 Q42 10 44 16 L42 18 Q36 14 32 14 Q28 14 22 18 Z',
    ],
  },

  // Adult female: taller bean body + full hair (dome + sides) + bowtie on hairline
  'adult-female': {
    body: 'M32 12 C20 12 14 22 14 36 C14 50 20 56 32 56 C44 56 50 50 50 36 C50 22 44 12 32 12Z',
    eyes: [
      'M25 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 40 Q32 45 37 40',
    accessories: [
      // Hair dome — covers top of head from side to side
      'M16 18 C17 10 23 5 32 4 C41 5 47 10 48 18 C44 13 38 10 32 10 C26 10 20 13 16 18 Z',
      // Hair — left side, shoulder length
      'M16 18 C11 24 6 34 5 44 C4 50 12 49 14 44 C14 36 14 28 16 18 Z',
      // Hair — right side, shoulder length
      'M48 18 C53 24 58 34 59 44 C60 50 52 49 50 44 C50 36 50 28 48 18 Z',
      // Bow — left triangle (sits on hairline, right side)
      'M45 12 L40 8 L40 16 Z',
      // Bow — right triangle
      'M45 12 L50 8 L50 16 Z',
      // Bow — center knot
      'M43.5 10.5 a2 2 0 1 0 3 3 a2 2 0 1 0 -3 -3',
    ],
  },

  // Adult other: clean bean body, no gendered accessories
  'adult-other': {
    body: 'M32 12 C20 12 14 22 14 36 C14 50 20 56 32 56 C44 56 50 50 50 36 C50 22 44 12 32 12Z',
    eyes: [
      'M25 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 32 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 40 Q32 45 37 40',
    accessories: [],
  },

  // Child male: shorter/rounder bean + beanie hat
  'child-male': {
    body: 'M32 20 C18 20 12 30 12 40 C12 52 20 58 32 58 C44 58 52 52 52 40 C52 30 46 20 32 20Z',
    eyes: [
      'M25 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 46 Q32 50 37 46',
    accessories: [
      // Beanie hat dome
      'M18 24 Q20 10 32 8 Q44 10 46 24 Q40 20 32 19 Q24 20 18 24Z',
      // Beanie hat brim
      'M16 26 Q18 22 32 21 Q46 22 48 26 Q44 24 32 23 Q20 24 16 26Z',
      // Beanie pom-pom
      'M29 7 a4 4 0 1 0 6 0 a4 4 0 1 0 -6 0',
    ],
  },

  // Child female: shorter/rounder bean + beanie hat + hair peeking out + prominent bow on hat
  'child-female': {
    body: 'M32 20 C18 20 12 30 12 40 C12 52 20 58 32 58 C44 58 52 52 52 40 C52 30 46 20 32 20Z',
    eyes: [
      'M25 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 46 Q32 50 37 46',
    accessories: [
      // Hair from under beanie — left side, shoulder length
      'M17 26 C12 30 8 38 7 46 C6 52 12 50 14 46 C15 38 16 32 17 26 Z',
      // Hair from under beanie — right side, shoulder length
      'M47 26 C52 30 56 38 57 46 C58 52 52 50 50 46 C49 38 48 32 47 26 Z',
      // Beanie hat dome
      'M18 24 Q20 10 32 8 Q44 10 46 24 Q40 20 32 19 Q24 20 18 24Z',
      // Beanie hat brim
      'M16 26 Q18 22 32 21 Q46 22 48 26 Q44 24 32 23 Q20 24 16 26Z',
      // Beanie pom-pom
      'M29 7 a4 4 0 1 0 6 0 a4 4 0 1 0 -6 0',
      // Bow — left triangle (on forehead, right side)
      'M48 28 L44 24 L44 32 Z',
      // Bow — right triangle
      'M48 28 L52 24 L52 32 Z',
      // Bow — center knot
      'M46.5 26.5 a2 2 0 1 0 3 3 a2 2 0 1 0 -3 -3',
    ],
  },

  // Child other: shorter/rounder bean + beanie hat only
  'child-other': {
    body: 'M32 20 C18 20 12 30 12 40 C12 52 20 58 32 58 C44 58 52 52 52 40 C52 30 46 20 32 20Z',
    eyes: [
      'M25 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
      'M34 38 a2.5 2.5 0 1 0 5 0 a2.5 2.5 0 1 0 -5 0',
    ],
    smile: 'M27 46 Q32 50 37 46',
    accessories: [
      // Beanie hat dome
      'M18 24 Q20 10 32 8 Q44 10 46 24 Q40 20 32 19 Q24 20 18 24Z',
      // Beanie hat brim
      'M16 26 Q18 22 32 21 Q46 22 48 26 Q44 24 32 23 Q20 24 16 26Z',
      // Beanie pom-pom
      'M29 7 a4 4 0 1 0 6 0 a4 4 0 1 0 -6 0',
    ],
  },

  // Family group: 2-3 overlapping bean silhouettes (no eyes/smile/accessories — just bodies)
  'family-group': {
    body: '',
    eyes: [],
    smile: '',
    accessories: [],
  },

  // Family filtered: single bean + funnel overlay
  'family-filtered': {
    body: '',
    eyes: [],
    smile: '',
    accessories: [],
  },
};

/**
 * Get avatar definition for a variant.
 * Returns undefined for unknown variants.
 */
export function getAvatarDef(variant: AvatarVariant): BeanieAvatarDef | undefined {
  return BEANIE_AVATARS[variant];
}

/**
 * Get all defined avatar variants.
 */
export function getAllAvatarVariants(): AvatarVariant[] {
  return Object.keys(BEANIE_AVATARS) as AvatarVariant[];
}

export { BEANIE_AVATARS };
