/**
 * Localized labels for activity categories + their groups.
 *
 * Category/group display names live in the constant `ACTIVITY_CATEGORIES`
 * (`src/constants/activityCategories.ts`) as English. This composable resolves
 * a category id or group name to the language-appropriate label:
 *
 *   - **beanie mode** (English only): the English name, lowercased — exactly the
 *     prior behavior, so the cosmetic beanie overlay is unchanged.
 *   - **English**: the constant name (via the `planner.category.<id>` /
 *     `planner.group.<slug>` key, whose `en` value mirrors the constant — a sync
 *     test in `activityCategories.test.ts` enforces that).
 *   - **other languages (zh, …)**: the translated string from the i18n pipeline,
 *     falling back to the English constant name if a translation is missing.
 *
 * The constant remains the source of truth for English; the i18n keys add the
 * translation layer. A missing key can never throw — it falls back to the name.
 */
import { getActivityCategoryName } from '@/constants/activityCategories';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslation } from '@/composables/useTranslation';

export function useActivityCategoryLabel() {
  const { t, isBeanieMode } = useTranslation();

  /** Language-appropriate label for a category id. */
  function categoryLabel(id: string): string {
    const name = getActivityCategoryName(id);
    if (isBeanieMode.value) return name.toLowerCase();
    return t(`planner.category.${id}` as UIStringKey) || name;
  }

  /** Language-appropriate label for a group name (e.g. `'Fun'`). */
  function groupLabel(group: string): string {
    if (isBeanieMode.value) return group.toLowerCase();
    return t(`planner.group.${group.toLowerCase()}` as UIStringKey) || group;
  }

  return { categoryLabel, groupLabel };
}
