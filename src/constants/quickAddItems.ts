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

export type QuickAddGroup = 'everyday' | 'family' | 'money' | 'care';

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
}

export const QUICK_ADD_ITEMS = [
  // — Everyday (jar-pop) —
  {
    id: 'activity',
    group: 'everyday',
    order: 1,
    emoji: '\u{1F4C5}', // 📅
    labelKey: 'quickAdd.activity.label',
    hintKey: 'quickAdd.activity.hint',
    route: '/activities',
    action: 'add-activity',
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
  },
  {
    id: 'saying',
    group: 'everyday',
    order: 6,
    emoji: '\u{1F4AC}', // 💬
    labelKey: 'quickAdd.saying.label',
    hintKey: 'quickAdd.saying.hint',
    route: '/pod/scrapbook',
    action: 'add-saying',
    contextKey: 'memberId',
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
  },
  {
    id: 'note',
    group: 'family',
    order: 2,
    emoji: '\u{1F4DD}', // 📝
    labelKey: 'quickAdd.note.label',
    hintKey: 'quickAdd.note.hint',
    route: '/pod/scrapbook',
    action: 'add-note',
    contextKey: 'memberId',
  },
  {
    id: 'recipe',
    group: 'family',
    order: 3,
    emoji: '\u{1F35C}', // 🍜
    labelKey: 'quickAdd.recipe.label',
    hintKey: 'quickAdd.recipe.hint',
    route: '/pod/cookbook',
    action: 'add-recipe',
  },
  {
    id: 'trip-idea',
    group: 'family',
    order: 4,
    emoji: '\u{1F4A1}', // 💡
    labelKey: 'quickAdd.tripIdea.label',
    hintKey: 'quickAdd.tripIdea.hint',
    route: '/travel',
    action: 'add-trip-idea',
    contextKey: 'vacationId',
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
}

/**
 * Runtime set used by `useQuickAddIntent` to validate incoming query
 * strings against the known action vocabulary. Strings outside this
 * set are treated as "unknown action" and surfaced to the user rather
 * than handed to per-page handlers.
 */
export const VALID_ACTIONS: ReadonlySet<string> = new Set(QUICK_ADD_ITEMS.map((i) => i.action));

/** Pre-computed group index — the sheet renders sections directly from this. */
export const QUICK_ADD_BY_GROUP: Record<QuickAddGroup, readonly QuickAddItem[]> = {
  everyday: QUICK_ADD_ITEMS.filter((i) => i.group === 'everyday').sort((a, b) => a.order - b.order),
  family: QUICK_ADD_ITEMS.filter((i) => i.group === 'family').sort((a, b) => a.order - b.order),
  money: QUICK_ADD_ITEMS.filter((i) => i.group === 'money').sort((a, b) => a.order - b.order),
  care: QUICK_ADD_ITEMS.filter((i) => i.group === 'care').sort((a, b) => a.order - b.order),
};
