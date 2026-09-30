// Beanie Lists (#33) — id → translated category label, the render-site resolver
// (mirrors `useActivityCategoryLabel`). Each category's display name lives in
// the i18n layer with authored `en` + `beanie` values, so `t(labelKey)` already
// covers English, beanie mode, and other locales — no manual casing here.
// Never throws: an unknown id falls back to the id string.
import { getListCategory, isKnownListCategory } from '@/constants/listCategories';
import { useTranslation } from '@/composables/useTranslation';
import type { ListCategory } from '@/types/models';

export function useListCategoryLabel() {
  const { t } = useTranslation();

  function categoryLabel(id: ListCategory): string {
    const cat = getListCategory(id);
    return cat ? t(cat.labelKey) : id;
  }

  /** Short label for filter chips + new-list pills (full names stay on tiles). */
  function categoryShortLabel(id: ListCategory): string {
    const cat = getListCategory(id);
    return cat ? t(cat.shortLabelKey) : id;
  }

  /**
   * The label wherever a card or row names its category: a missing id, or one from a newer
   * client this build does not know, reads "Other", never its raw id. One source, so the
   * pile's position line and its chip (and any other caption) cannot disagree.
   */
  function categoryLabelOrOther(id: string | null | undefined): string {
    const cat = isKnownListCategory(id) ? getListCategory(id) : undefined;
    return cat ? t(cat.labelKey) : t('lists.category.other');
  }

  return { categoryLabel, categoryShortLabel, categoryLabelOrOther };
}
