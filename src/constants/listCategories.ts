// Beanie Lists (#33) — the 9 categories (the ninth, `people`, is shared with
// Who Owns What, #109) (Fair-Play-inspired, renamed, not
// copied). Display names live in the i18n layer (`labelKey`); resolve them via
// `useListCategoryLabel`. `color` is a decorative category-dot / tint accent —
// never an alert color (alerts are Heritage Orange per the CIG).
import type { ListCategory } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface ListCategoryDef {
  id: ListCategory;
  labelKey: UIStringKey; // full name — tiles, meta band
  shortLabelKey: UIStringKey; // short name — filter chips, new-list pills
  emoji: string;
  color: string;
}

export const LIST_CATEGORIES: ListCategoryDef[] = [
  {
    id: 'home',
    labelKey: 'lists.category.home',
    shortLabelKey: 'lists.categoryShort.home',
    emoji: '🏠',
    color: '#E67E22',
  },
  {
    id: 'out',
    labelKey: 'lists.category.out',
    shortLabelKey: 'lists.categoryShort.out',
    emoji: '🛒',
    color: '#5B9BD5',
  },
  {
    id: 'kids',
    labelKey: 'lists.category.kids',
    shortLabelKey: 'lists.categoryShort.kids',
    emoji: '🧒',
    color: '#F15D22',
  },
  {
    id: 'health',
    labelKey: 'lists.category.health',
    shortLabelKey: 'lists.categoryShort.health',
    emoji: '🩺',
    color: '#27AE60',
  },
  {
    id: 'celebrations',
    labelKey: 'lists.category.celebrations',
    shortLabelKey: 'lists.categoryShort.celebrations',
    emoji: '🎉',
    color: '#E84393',
  },
  {
    id: 'people',
    labelKey: 'lists.category.people',
    shortLabelKey: 'lists.categoryShort.people',
    emoji: '💞',
    color: '#E17055',
  },
  {
    id: 'trips',
    labelKey: 'lists.category.trips',
    shortLabelKey: 'lists.categoryShort.trips',
    emoji: '🧳',
    color: '#2A9D8F',
  },
  {
    id: 'projects',
    labelKey: 'lists.category.projects',
    shortLabelKey: 'lists.categoryShort.projects',
    emoji: '✅',
    color: '#6C5CE7',
  },
  {
    id: 'me',
    labelKey: 'lists.category.me',
    shortLabelKey: 'lists.categoryShort.me',
    emoji: '✨',
    color: '#8E7CC3',
  },
];

const _byId = new Map(LIST_CATEGORIES.map((c) => [c.id, c]));

export function getListCategory(id: ListCategory): ListCategoryDef | undefined {
  return _byId.get(id);
}

/**
 * Is this a category this build knows? A list or card synced from a NEWER client can
 * carry a category added after this build shipped; every surface that groups by
 * category must treat such a value as "unknown" (fallback shelf, fail-closed wall)
 * rather than dropping the record.
 */
export function isKnownListCategory(id: unknown): id is ListCategory {
  return typeof id === 'string' && _byId.has(id as ListCategory);
}
