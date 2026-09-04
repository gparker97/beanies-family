/**
 * Recipe courses (#87) — the constant half of the id→label pair, in the `listCategories.ts`
 * shape so the resolver pattern is the one already used everywhere else.
 *
 * Display names live in the i18n layer (`labelKey`); resolve them via `useRecipeCourseLabel`.
 * The STORED value is always the id — never the label — so a translation change can never
 * orphan a recipe's course.
 *
 * The emoji is decorative and travels with the definition so the chip, the badge and the
 * shelf heading cannot pick different ones.
 */
import { RECIPE_COURSES, type RecipeCourse } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface RecipeCourseDef {
  id: RecipeCourse;
  labelKey: UIStringKey;
  emoji: string;
}

/** In menu order — starter through to the catch-all. Drives every course list in the UI. */
export const COURSE_DEFS: readonly RecipeCourseDef[] = [
  { id: 'starter', labelKey: 'recipes.course.starter', emoji: '🥗' },
  { id: 'main', labelKey: 'recipes.course.main', emoji: '🍲' },
  { id: 'side', labelKey: 'recipes.course.side', emoji: '🥔' },
  { id: 'dessert', labelKey: 'recipes.course.dessert', emoji: '🍰' },
  { id: 'drink', labelKey: 'recipes.course.drink', emoji: '🥤' },
  { id: 'baking', labelKey: 'recipes.course.baking', emoji: '🥖' },
  { id: 'sauce', labelKey: 'recipes.course.sauce', emoji: '🥣' },
  { id: 'other', labelKey: 'recipes.course.other', emoji: '🍴' },
];

const BY_ID = new Map(COURSE_DEFS.map((c) => [c.id, c]));

export function getRecipeCourse(id: string): RecipeCourseDef | undefined {
  return BY_ID.get(id as RecipeCourse);
}

/** Narrows an unknown (a stored value, a model response) to a real course. */
export function isRecipeCourse(value: unknown): value is RecipeCourse {
  return typeof value === 'string' && (RECIPE_COURSES as readonly string[]).includes(value);
}
