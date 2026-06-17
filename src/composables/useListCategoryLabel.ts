// Beanie Lists (#33) — id → translated category label, the render-site resolver
// (mirrors `useActivityCategoryLabel`). Each category's display name lives in
// the i18n layer with authored `en` + `beanie` values, so `t(labelKey)` already
// covers English, beanie mode, and other locales — no manual casing here.
// Never throws: an unknown id falls back to the id string.
import { getListCategory } from '@/constants/listCategories';
import { useTranslation } from '@/composables/useTranslation';
import type { ListCategory } from '@/types/models';

export function useListCategoryLabel() {
  const { t } = useTranslation();

  function categoryLabel(id: ListCategory): string {
    const cat = getListCategory(id);
    return cat ? t(cat.labelKey) : id;
  }

  return { categoryLabel };
}
