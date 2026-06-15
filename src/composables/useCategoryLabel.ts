import {
  getCategoryById,
  getGroupName,
  isGroupBudget,
  normalizeCategoryId,
} from '@/constants/categories';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useTranslation } from '@/composables/useTranslation';

/**
 * Resolves transaction-category and category-group names to localized labels.
 *
 * The English source lives in `constants/categories.ts` (the `name`/`group`
 * fields). Those are plain English literals the template lint rule cannot see,
 * so any surface that renders them MUST route through this composable rather
 * than printing `category.name` / `group` directly — otherwise Chinese users
 * see bare English. Mirrors `useActivityCategoryLabel` for activity categories.
 *
 * - English / beanie modes resolve from the source `name` (beanie lowercased),
 *   so they never depend on the translation JSON being loaded.
 * - Other languages resolve via the `category.<id>` / `categoryGroup.<slug>`
 *   keys, falling back to the English source if a key is somehow missing.
 */
export function useCategoryLabel() {
  const { t, isBeanieMode, isEnglish } = useTranslation();

  function categoryLabel(id: string): string {
    const canonicalId = normalizeCategoryId(id);
    const name = getCategoryById(canonicalId)?.name || id;
    if (isBeanieMode.value) return name.toLowerCase();
    if (isEnglish.value) return name;
    return t(`category.${canonicalId}` as UIStringKey) || name;
  }

  function groupLabel(group: string): string {
    if (isBeanieMode.value) return group.toLowerCase();
    if (isEnglish.value) return group;
    return t(`categoryGroup.${group.toLowerCase()}` as UIStringKey) || group;
  }

  /**
   * Resolves a budget-line category id, which may be a group-level budget
   * (`group:<Group>`) or an individual category id, to the right localized label.
   */
  function budgetCategoryLabel(categoryId: string): string {
    return isGroupBudget(categoryId)
      ? groupLabel(getGroupName(categoryId))
      : categoryLabel(categoryId);
  }

  return { categoryLabel, groupLabel, budgetCategoryLabel };
}
