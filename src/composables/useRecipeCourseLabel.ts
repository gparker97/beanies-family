// Recipe courses (#87) — id → translated course label, the render-site resolver
// (mirrors `useListCategoryLabel` / `useActivityCategoryLabel`). Each course's display name
// lives in the i18n layer with authored `en` + `beanie` values, so `t(labelKey)` already
// covers English, beanie mode and other locales — no manual casing here.
//
// Never throws: an unknown id falls back to the id string.
//
// ⚠️ Unlike `useListCategoryLabel`, an unknown id also WARNS — once per id. A course only
// becomes unknown through genuine data drift (a corrupt doc, a downgrade, a model value that
// slipped past validation), and a silent fallback would render that as a lowercase id in the
// UI with nothing pointing at the cause. The module-level `Set` guard is what keeps a single
// bad value from spamming a render loop.
import { getRecipeCourse } from '@/constants/recipeCourses';
import { useTranslation } from '@/composables/useTranslation';
import type { RecipeCourse } from '@/types/models';

const warned = new Set<string>();

export function useRecipeCourseLabel() {
  const { t } = useTranslation();

  function courseLabel(id: RecipeCourse | string): string {
    const course = getRecipeCourse(id);
    if (course) return t(course.labelKey);
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(
        `[useRecipeCourseLabel] unknown course "${id}" — showing the raw id. ` +
          'Add it to RECIPE_COURSES + COURSE_DEFS, or clear the field on the affected recipe.'
      );
    }
    return id;
  }

  function courseEmoji(id: RecipeCourse | string): string {
    return getRecipeCourse(id)?.emoji ?? '';
  }

  return { courseLabel, courseEmoji };
}
