/**
 * Quick-add FAB config.
 *
 * `QUICK_ADD_ITEMS` is the single source of truth. The `QuickAddAction`
 * union, the `VALID_ACTIONS` runtime set, and the per-group index are
 * all DERIVED from it — adding a new action is one edit, everything
 * else propagates.
 *
 * `as const satisfies readonly QuickAddItemShape[]` gives:
 * - literal-type inference on every string (so the derived union is
 *   narrow and precise)
 * - compile-time check that every entry matches the shape (so a typo
 *   in `group` or `contextKey` fails the build)
 *
 * Emoji values use Unicode escapes, matching `navigation.ts`. This
 * keeps the source file ASCII and rendering consistent across
 * Chromium / WebKit / Firefox.
 */
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { DevFlag } from '@/config/flagRegistry';

export type QuickAddGroup = 'everyday' | 'family' | 'money' | 'care';

/**
 * Permission bucket a quick-add item belongs to. Consumed by
 * `QuickAddSheet` to filter items the current member isn't allowed
 * to act on, so e.g. a member without `canViewFinances` never sees
 * "Transaction" in the sheet. `activities` maps to `canEditActivities`
 * and covers every non-finance add (recipes, todos, medications, etc).
 * `adult` maps to `isAdult`: things only a grown-up may create (a chore, #146).
 */
export type QuickAddPermission = 'finance' | 'activities' | 'adult';

/** Parent id key pre-filled into the target modal when the user is on the parent's detail route. */
export type QuickAddContextKey = 'memberId' | 'recipeId' | 'vacationId' | 'medicationId';

/** The four context-key names as a runtime tuple — reused by intent parsing + stripping. */
export const QUICK_ADD_CONTEXT_KEYS = [
  'memberId',
  'recipeId',
  'vacationId',
  'medicationId',
] as const satisfies readonly QuickAddContextKey[];

interface QuickAddItemShape {
  readonly id: string;
  readonly group: QuickAddGroup;
  readonly order: number;
  readonly emoji: string;
  readonly labelKey: UIStringKey;
  readonly hintKey: UIStringKey;
  readonly route: string;
  readonly action: string;
  readonly tab?: string;
  readonly contextKey?: QuickAddContextKey;
  readonly requiredPermission: QuickAddPermission;
  /** Hide this item unless the named dev feature flag is enabled. */
  readonly requiresFlag?: DevFlag;
  /**
   * Keep the action valid (pages and in-page buttons still dispatch it) but leave the tile
   * OUT of the main FAB menu: it shows only when a caller opens the sheet with a filter that
   * names this action (e.g. the Family Scrapbook's sheet).
   */
  readonly onlyWhenFiltered?: true;
  /**
   * Where this tile sits when a caller opens the sheet with a filter (the Family Scrapbook),
   * when that differs from its main-menu `group` / `order`. Recipe and milestone moved to the
   * main menu's Everyday group on 2026-11-13; a filtered sheet still lists them where it did
   * before the move, so the scrapbook's Milestone never lands alone under the Everyday kicker.
   */
  readonly filteredPlacement?: QuickAddPlacement;
}

/** A tile's section and position within it. */
export interface QuickAddPlacement {
  readonly group: QuickAddGroup;
  readonly order: number;
}

export const QUICK_ADD_ITEMS = [
  // — Everyday (jar-pop): keep to 6 tiles, two rows —
  {
    id: 'activity',
    group: 'everyday',
    order: 1,
    emoji: '\u{1F4C5}', // 📅
    labelKey: 'quickAdd.activity.label',
    hintKey: 'quickAdd.activity.hint',
    route: '/activities',
    action: 'add-activity',
    requiredPermission: 'activities',
  },
  {
    id: 'todo',
    group: 'everyday',
    order: 2,
    emoji: '✅', // ✅
    labelKey: 'quickAdd.todo.label',
    hintKey: 'quickAdd.todo.hint',
    route: '/todo',
    action: 'add-todo',
    requiredPermission: 'activities',
  },
  {
    id: 'list',
    group: 'everyday',
    order: 6,
    emoji: '\u{1F9FE}', // 🧾
    labelKey: 'quickAdd.list.label',
    hintKey: 'quickAdd.list.hint',
    route: '/lists',
    action: 'add-list',
    requiredPermission: 'activities',
    requiresFlag: 'familyLists',
  },
  {
    // #146. Grown-ups only: kids tick chores, grown-ups make them. A 7th Everyday tile while the
    // `choreboard` gate is on; which tile makes room for it is decided at gate removal.
    id: 'chore',
    group: 'everyday',
    order: 7,
    emoji: '\u{1F9F9}', // 🧹
    labelKey: 'quickAdd.chore.label',
    hintKey: 'quickAdd.chore.hint',
    route: '/choreboard',
    action: 'add-chore',
    requiredPermission: 'adult',
    requiresFlag: 'choreboard',
  },
  {
    id: 'transaction',
    group: 'everyday',
    order: 3,
    emoji: '\u{1F4B3}', // 💳
    labelKey: 'quickAdd.transaction.label',
    hintKey: 'quickAdd.transaction.hint',
    route: '/transactions',
    action: 'add-transaction',
    requiredPermission: 'finance',
  },
  {
    id: 'trip',
    group: 'everyday',
    order: 4,
    emoji: '✈️', // ✈️
    labelKey: 'quickAdd.trip.label',
    hintKey: 'quickAdd.trip.hint',
    route: '/travel',
    action: 'add-trip',
    requiredPermission: 'activities',
  },
  {
    id: 'cook-log',
    group: 'everyday',
    order: 5,
    emoji: '\u{1F468}‍\u{1F373}', // 👨‍🍳
    labelKey: 'quickAdd.cookLog.label',
    hintKey: 'quickAdd.cookLog.hint',
    route: '/pod/cookbook',
    action: 'add-cooklog',
    contextKey: 'recipeId',
    requiredPermission: 'activities',
  },
  {
    id: 'saying',
    group: 'family',
    order: 2,
    emoji: '\u{1F4AC}', // 💬
    labelKey: 'quickAdd.saying.label',
    hintKey: 'quickAdd.saying.hint',
    route: '/pod/scrapbook',
    action: 'add-saying',
    contextKey: 'memberId',
    requiredPermission: 'activities',
  },

  // — Family —
  {
    id: 'favorite',
    group: 'family',
    order: 1,
    emoji: '\u{1F49D}', // 💝
    labelKey: 'quickAdd.favorite.label',
    hintKey: 'quickAdd.favorite.hint',
    route: '/pod/scrapbook',
    action: 'add-favorite',
    contextKey: 'memberId',
    requiredPermission: 'activities',
  },
  {
    id: 'note',
    group: 'family',
    order: 5,
    emoji: '\u{1F4DD}', // 📝
    labelKey: 'quickAdd.note.label',
    hintKey: 'quickAdd.note.hint',
    route: '/pod/scrapbook',
    action: 'add-note',
    contextKey: 'memberId',
    requiredPermission: 'activities',
    // Out of the main menu (greg, 2026-09-30). Since 2026-11-13 Everyday holds nine tiles and
    // Family two (saying, favorite).
    // Still offered by the Family Scrapbook's filtered sheet and the member hero's button.
    onlyWhenFiltered: true,
  },
  {
    // Everyday since 2026-11-13 (greg: Everyday grows to nine tiles, three full rows).
    id: 'recipe',
    group: 'everyday',
    order: 8,
    emoji: '\u{1F35C}', // 🍜
    labelKey: 'quickAdd.recipe.label',
    hintKey: 'quickAdd.recipe.hint',
    route: '/pod/cookbook',
    action: 'add-recipe',
    requiredPermission: 'activities',
    filteredPlacement: { group: 'family', order: 3 },
  },
  {
    // Everyday since 2026-11-13, with recipe (see above).
    id: 'milestone',
    group: 'everyday',
    order: 9,
    emoji: '\u{1F31F}', // 🌟
    labelKey: 'quickAdd.milestone.label',
    hintKey: 'quickAdd.milestone.hint',
    route: '/pod/milestones',
    action: 'add-milestone',
    contextKey: 'memberId',
    requiredPermission: 'activities',
    filteredPlacement: { group: 'family', order: 4 },
  },

  // — Money (setup) —
  {
    id: 'account',
    group: 'money',
    order: 1,
    emoji: '\u{1F4B0}', // 💰
    labelKey: 'quickAdd.account.label',
    hintKey: 'quickAdd.account.hint',
    route: '/accounts',
    action: 'add-account',
    requiredPermission: 'finance',
  },
  {
    id: 'budget',
    group: 'money',
    order: 2,
    emoji: '\u{1F4CA}', // 📊
    labelKey: 'quickAdd.budget.label',
    hintKey: 'quickAdd.budget.hint',
    route: '/budgets',
    action: 'add-budget',
    requiredPermission: 'finance',
  },
  {
    id: 'asset',
    group: 'money',
    order: 3,
    emoji: '\u{1F3E2}', // 🏢
    labelKey: 'quickAdd.asset.label',
    hintKey: 'quickAdd.asset.hint',
    route: '/assets',
    action: 'add-asset',
    requiredPermission: 'finance',
  },
  {
    id: 'goal',
    group: 'money',
    order: 4,
    emoji: '\u{1F3AF}', // 🎯
    labelKey: 'quickAdd.goal.label',
    hintKey: 'quickAdd.goal.hint',
    route: '/goals',
    action: 'add-goal',
    requiredPermission: 'finance',
  },

  // — Care —
  {
    id: 'medication',
    group: 'care',
    order: 1,
    emoji: '\u{1F48A}', // 💊
    labelKey: 'quickAdd.medication.label',
    hintKey: 'quickAdd.medication.hint',
    route: '/pod/safety',
    action: 'add-medication',
    contextKey: 'memberId',
    requiredPermission: 'activities',
  },
  {
    id: 'dose-log',
    group: 'care',
    order: 2,
    emoji: '⏱️', // ⏱️
    labelKey: 'quickAdd.doseLog.label',
    hintKey: 'quickAdd.doseLog.hint',
    route: '/pod/safety',
    action: 'add-dose-log',
    contextKey: 'medicationId',
    requiredPermission: 'activities',
  },
  {
    id: 'allergy',
    group: 'care',
    order: 3,
    emoji: '⚠️', // ⚠️
    labelKey: 'quickAdd.allergy.label',
    hintKey: 'quickAdd.allergy.hint',
    route: '/pod/safety',
    action: 'add-allergy',
    contextKey: 'memberId',
    requiredPermission: 'activities',
  },
  {
    id: 'emergency',
    group: 'care',
    order: 4,
    emoji: '\u{1F198}', // 🆘
    labelKey: 'quickAdd.emergency.label',
    hintKey: 'quickAdd.emergency.hint',
    route: '/pod/contacts',
    action: 'add-emergency',
    requiredPermission: 'activities',
  },
] as const satisfies readonly QuickAddItemShape[];

// === DERIVED — single source of truth is QUICK_ADD_ITEMS ===

/**
 * Literal union of every action string the FAB can dispatch. Narrow
 * (e.g. `'add-activity' | 'add-todo' | ...`), derived directly from
 * the `as const` array above so the union and the config can't drift.
 */
export type QuickAddAction = (typeof QUICK_ADD_ITEMS)[number]['action'];

/**
 * Public item type. Uses `QuickAddAction` for the narrow union, keeps
 * `tab` and `contextKey` as optional so code can branch on their
 * presence (`if (item.tab)`) without TS narrowing them away on items
 * that don't set them.
 */
export interface QuickAddItem {
  readonly id: string;
  readonly group: QuickAddGroup;
  readonly order: number;
  readonly emoji: string;
  readonly labelKey: UIStringKey;
  readonly hintKey: UIStringKey;
  readonly route: string;
  readonly action: QuickAddAction;
  readonly tab?: string;
  readonly contextKey?: QuickAddContextKey;
  readonly requiredPermission: QuickAddPermission;
  readonly requiresFlag?: DevFlag;
  readonly onlyWhenFiltered?: true;
  readonly filteredPlacement?: QuickAddPlacement;
}

/**
 * Runtime set used by `useQuickAddIntent` to validate incoming query
 * strings against the known action vocabulary. Strings outside this
 * set are treated as "unknown action" and surfaced to the user rather
 * than handed to per-page handlers.
 */
export const VALID_ACTIONS: ReadonlySet<string> = new Set(QUICK_ADD_ITEMS.map((i) => i.action));

/**
 * A tile's placement: its `group` / `order` in the main menu, or its `filteredPlacement` (when
 * it has one) in a filtered sheet. The ONE answer to "which section is this tile in", so the
 * sheet's tiles and its inline member picker cannot disagree.
 */
export function quickAddPlacement(item: QuickAddItem, filtered: boolean): QuickAddPlacement {
  return (filtered && item.filteredPlacement) || { group: item.group, order: item.order };
}

function indexByGroup(filtered: boolean): Record<QuickAddGroup, readonly QuickAddItem[]> {
  const items: readonly QuickAddItem[] = QUICK_ADD_ITEMS;
  const inGroup = (g: QuickAddGroup) =>
    items
      .filter((i) => quickAddPlacement(i, filtered).group === g)
      .sort((a, b) => quickAddPlacement(a, filtered).order - quickAddPlacement(b, filtered).order);
  return {
    everyday: inGroup('everyday'),
    family: inGroup('family'),
    money: inGroup('money'),
    care: inGroup('care'),
  };
}

/** Pre-computed group index for the main menu: the sheet renders sections directly from this. */
export const QUICK_ADD_BY_GROUP: Record<QuickAddGroup, readonly QuickAddItem[]> =
  indexByGroup(false);

/** The same index for a filtered sheet (`openQuickAdd({ filter })`): `filteredPlacement` applies. */
export const QUICK_ADD_BY_GROUP_FILTERED: Record<QuickAddGroup, readonly QuickAddItem[]> =
  indexByGroup(true);
