import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';

export type NavSection = 'treehouse' | 'piggyBank' | 'pinned';

/**
 * Tag a NAV_ITEMS entry with a mobile category to make it appear in the
 * v3 mobile bottom nav. `'nook'` and `'calendar'` are leaves (the tab
 * navigates directly). The others are stacks — tapping the tab opens a
 * vertical bean column with the tagged routes as children.
 *
 * Items WITHOUT a mobileCategory (Settings, Help) intentionally do not
 * appear on mobile — desktop-sidebar / hamburger-only.
 *
 * Adding a route: tag it here once; the derived `MOBILE_NAV_CATEGORIES`
 * picks it up automatically. Adding a hint: extend `HINT_KEY_BY_PATH`.
 */
export type MobileCategoryId = 'nook' | 'planning' | 'money' | 'pod' | 'calendar';

/**
 * The ONE source of truth for which categories are leaves (navigate
 * directly, no bean stack). Both the runtime set and the stackable type
 * derive from this tuple, so adding/removing a leaf is a one-line edit.
 */
const LEAF_CATEGORY_IDS = ['nook', 'calendar'] as const;
type LeafCategoryId = (typeof LEAF_CATEGORY_IDS)[number];
/** Categories that open a bean stack (leaves navigate directly). */
export type StackableCategoryId = Exclude<MobileCategoryId, LeafCategoryId>;
const LEAF_ID_SET: ReadonlySet<MobileCategoryId> = new Set(LEAF_CATEGORY_IDS);

export interface NavSectionDef {
  id: NavSection;
  labelKey: UIStringKey;
  emoji: string;
}

export interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  section: NavSection;
  comingSoon?: boolean;
  badgeKey?: string;
  external?: boolean;
  externalUrl?: string;
  /**
   * See `MobileCategoryId` for the tagging contract. Accepts an array to place
   * one route in MORE THAN ONE mobile slot — e.g. `/activities` is both the
   * center Calendar leaf AND a Planning-stack bean.
   */
  mobileCategory?: MobileCategoryId | MobileCategoryId[];
  /**
   * Optional nested sub-items. When present, the parent renders as an
   * expandable group in the sidebar — clicking the parent navigates to its
   * own `path` and reveals the children. Children are rendered via
   * AppSidebarSubNav at an indented scale.
   */
  children?: NavSubItemDef[];
}

export interface NavSubItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  /** See `MobileCategoryId` for tagging contract. */
  mobileCategory?: MobileCategoryId | MobileCategoryId[];
}

/** Normalize the single-or-array `mobileCategory` tag to an array (possibly empty). */
function mobileCategoriesOf(item: {
  mobileCategory?: MobileCategoryId | MobileCategoryId[];
}): MobileCategoryId[] {
  if (!item.mobileCategory) return [];
  return Array.isArray(item.mobileCategory) ? item.mobileCategory : [item.mobileCategory];
}

export const NAV_SECTIONS: NavSectionDef[] = [
  { id: 'treehouse', labelKey: 'nav.section.treehouse', emoji: '\u{1F333}' },
  { id: 'piggyBank', labelKey: 'nav.section.piggyBank', emoji: '\u{1F437}' },
];

export const NAV_ITEMS: NavItemDef[] = [
  // The Treehouse
  {
    labelKey: 'nav.nook',
    path: '/nook',
    emoji: '\u{1F3E1}',
    section: 'treehouse',
    mobileCategory: 'nook',
  },
  {
    labelKey: 'nav.activities',
    path: '/activities',
    emoji: '\u{1F4C5}',
    section: 'treehouse',
    // Both the center Calendar hero (leaf) AND a Planning-stack bean — greg wants
    // it reachable from both. Order in NAV_ITEMS puts it first in the stack.
    mobileCategory: ['calendar', 'planning'],
  },
  {
    labelKey: 'nav.travel',
    path: '/travel',
    emoji: '✈️',
    section: 'treehouse',
    badgeKey: 'openTravelIdeas',
    mobileCategory: 'planning',
  },
  {
    labelKey: 'nav.todo',
    path: '/todo',
    emoji: '✅',
    section: 'treehouse',
    badgeKey: 'overdueTodos',
    mobileCategory: 'planning',
  },
  {
    labelKey: 'nav.pod',
    path: '/pod',
    emoji: '\u{1F331}',
    section: 'treehouse',
    // mobileCategory intentionally omitted on the parent — its first
    // child (`nav.pod.meetBeans`) shares path '/pod' and carries the
    // mobile tag, avoiding a duplicate bean for the same route.
    children: [
      {
        labelKey: 'nav.pod.meetBeans',
        path: '/pod',
        emoji: '\u{1F9D1}‍\u{1F91D}‍\u{1F9D1}',
        mobileCategory: 'pod',
      },
      {
        labelKey: 'nav.pod.scrapbook',
        path: '/pod/scrapbook',
        emoji: '\u{1F4D6}',
        mobileCategory: 'pod',
      },
      {
        labelKey: 'nav.pod.milestones',
        path: '/pod/milestones',
        emoji: '\u{1F31F}',
        mobileCategory: 'pod',
      },
      {
        labelKey: 'nav.pod.cookbook',
        path: '/pod/cookbook',
        emoji: '\u{1F35C}',
        mobileCategory: 'pod',
      },
      {
        labelKey: 'nav.pod.safety',
        path: '/pod/safety',
        emoji: '\u{1FA7A}',
        mobileCategory: 'pod',
      },
      {
        labelKey: 'nav.pod.contacts',
        path: '/pod/contacts',
        emoji: '\u{1F198}',
        mobileCategory: 'pod',
      },
    ],
  },
  // The Piggy Bank
  {
    labelKey: 'nav.overview',
    path: '/dashboard',
    emoji: '\u{1F3E0}',
    section: 'piggyBank',
    mobileCategory: 'money',
  },
  {
    labelKey: 'nav.accounts',
    path: '/accounts',
    emoji: '\u{1F4B0}',
    section: 'piggyBank',
    mobileCategory: 'money',
  },
  {
    labelKey: 'nav.budgets',
    path: '/budgets',
    emoji: '\u{1F4B5}',
    section: 'piggyBank',
    badgeKey: 'overBudgets',
    mobileCategory: 'money',
  },
  {
    labelKey: 'nav.transactions',
    path: '/transactions',
    emoji: '\u{1F4B3}',
    section: 'piggyBank',
    mobileCategory: 'money',
  },
  {
    labelKey: 'nav.goals',
    path: '/goals',
    emoji: '\u{1F3AF}',
    section: 'piggyBank',
    badgeKey: 'overdueGoals',
    mobileCategory: 'money',
  },
  {
    labelKey: 'nav.assets',
    path: '/assets',
    emoji: '\u{1F3E2}',
    section: 'piggyBank',
    mobileCategory: 'money',
  },
  // Pinned (no mobileCategory — desktop-sidebar / hamburger only)
  {
    labelKey: 'nav.help',
    path: '/help',
    emoji: '\u{1F4DA}',
    section: 'pinned',
    external: true,
    externalUrl: `${MARKETING_URL}/help`,
  },
  {
    labelKey: 'nav.community',
    path: '/discord',
    emoji: '\u{1F4AC}',
    section: 'pinned',
    external: true,
    externalUrl: `${MARKETING_URL}/discord`,
  },
  { labelKey: 'nav.settings', path: '/settings', emoji: '⚙️', section: 'pinned' },
];

export const TREEHOUSE_ITEMS = NAV_ITEMS.filter((item) => item.section === 'treehouse');
export const PIGGY_BANK_ITEMS = NAV_ITEMS.filter((item) => item.section === 'piggyBank');
export const PINNED_ITEMS = NAV_ITEMS.filter((item) => item.section === 'pinned');

// =============================================================================
// Badge registry — single source of truth for which attention/info badges
// can attach to nav items. Adding a new badge:
//   1. Add the key here (KNOWN_BADGE_KEYS).
//   2. Add a `badges[<key>]` entry in src/composables/useNavBadges.ts.
//   3. Tag the relevant NAV_ITEM with `badgeKey: '<key>'`.
// The module-load invariant below catches mismatches; the navigation unit
// test exercises it on every build.
// =============================================================================

export const KNOWN_BADGE_KEYS = [
  'overdueTodos',
  'overBudgets',
  'overdueGoals',
  'openTravelIdeas',
] as const;
export type KnownBadgeKey = (typeof KNOWN_BADGE_KEYS)[number];
const KNOWN_BADGE_KEY_SET: ReadonlySet<string> = new Set(KNOWN_BADGE_KEYS);

/**
 * Flat list of every nav entry (parents AND children), carrying only the
 * fields downstream lookups need. Built once at module load. Drives
 * `getBadgeKeyForPath`, `MOBILE_TAGGED_NAV_ITEMS`, and the badge-key
 * invariant check below.
 */
const NAV_ITEMS_FLAT: ReadonlyArray<{
  path: string;
  badgeKey?: string;
  mobileCategories: MobileCategoryId[];
}> = (() => {
  const flat: Array<{
    path: string;
    badgeKey?: string;
    mobileCategories: MobileCategoryId[];
  }> = [];
  for (const item of NAV_ITEMS) {
    flat.push({
      path: item.path,
      badgeKey: item.badgeKey,
      mobileCategories: mobileCategoriesOf(item),
    });
    for (const child of item.children ?? []) {
      flat.push({ path: child.path, mobileCategories: mobileCategoriesOf(child) });
    }
  }
  return flat;
})();

// Module-load invariant — every NAV_ITEM.badgeKey must be a known key.
// Throws on typo / stale reference so it can never ship; the navigation
// unit test exercises this path.
for (const entry of NAV_ITEMS_FLAT) {
  if (entry.badgeKey && !KNOWN_BADGE_KEY_SET.has(entry.badgeKey)) {
    throw new Error(
      `[navigation] NAV_ITEM "${entry.path}" has badgeKey "${entry.badgeKey}" which is not in KNOWN_BADGE_KEYS. ` +
        `Add it to KNOWN_BADGE_KEYS here AND to the badges map in useNavBadges.ts, then re-run tests.`
    );
  }
}

const NAV_ITEMS_BY_PATH: ReadonlyMap<string, (typeof NAV_ITEMS_FLAT)[number]> = new Map(
  NAV_ITEMS_FLAT.map((entry) => [entry.path, entry])
);

/** Look up the badge key registered for a route path, if any. */
export function getBadgeKeyForPath(path: string): KnownBadgeKey | undefined {
  const key = NAV_ITEMS_BY_PATH.get(path)?.badgeKey;
  return key && KNOWN_BADGE_KEY_SET.has(key) ? (key as KnownBadgeKey) : undefined;
}

/** Every nav entry tagged with a mobile category, flattened. Used by the
 *  mobile tab-level attention aggregator. */
export const MOBILE_TAGGED_NAV_ITEMS: ReadonlyArray<{
  path: string;
  mobileCategory: MobileCategoryId;
}> = NAV_ITEMS_FLAT.flatMap((e) =>
  e.mobileCategories.map((mobileCategory) => ({ path: e.path, mobileCategory }))
);

// =============================================================================
// Mobile nav v3 — derived from NAV_ITEMS
// =============================================================================

export interface MobileNavStackItem {
  path: string;
  labelKey: UIStringKey;
  emoji: string;
  hintKey: UIStringKey;
}

export interface MobileNavCategory {
  id: MobileCategoryId;
  labelKey: UIStringKey;
  emoji: string;
  /** A leaf category (Nook, Calendar) renders as a direct router-push tab. */
  rootPath?: string;
  /** A stackable category (Planning, Money, Pod) renders as a bean stack. */
  items?: MobileNavStackItem[];
}

/**
 * Path → hint translation key. Maintained alongside `mobileCategory` tags
 * on NAV_ITEMS. If a route is tagged with a stackable mobileCategory but
 * has no entry here, the derivation throws at module load (caught by the
 * navigation unit test) — making typos impossible to ship.
 */
const HINT_KEY_BY_PATH: Record<string, UIStringKey> = {
  '/activities': 'mobileNav.hint.activities',
  '/todo': 'mobileNav.hint.todo',
  '/travel': 'mobileNav.hint.travel',
  '/dashboard': 'mobileNav.hint.overview',
  '/accounts': 'mobileNav.hint.accounts',
  '/budgets': 'mobileNav.hint.budgets',
  '/transactions': 'mobileNav.hint.transactions',
  '/goals': 'mobileNav.hint.goals',
  '/assets': 'mobileNav.hint.assets',
  '/pod': 'mobileNav.hint.meetBeans',
  '/pod/scrapbook': 'mobileNav.hint.scrapbook',
  '/pod/milestones': 'mobileNav.hint.milestones',
  '/pod/cookbook': 'mobileNav.hint.cookbook',
  '/pod/safety': 'mobileNav.hint.safety',
  '/pod/contacts': 'mobileNav.hint.contacts',
};

/** Display order for the 5 mobile tabs. Nook first; Calendar centred. */
const CATEGORY_ORDER: MobileCategoryId[] = ['nook', 'planning', 'calendar', 'money', 'pod'];

const CATEGORY_META: Record<MobileCategoryId, { labelKey: UIStringKey; emoji: string }> = {
  nook: { labelKey: 'mobile.nook', emoji: '\u{1F3E1}' },
  planning: { labelKey: 'mobile.planning', emoji: '\u{1F333}' },
  calendar: { labelKey: 'mobile.calendar', emoji: '\u{1F4C5}' },
  money: { labelKey: 'mobile.money', emoji: '\u{1F437}' },
  pod: { labelKey: 'mobile.pod', emoji: '\u{1F331}' },
};

/**
 * Walk NAV_ITEMS (and their children) once, collecting every entry with a
 * `mobileCategory` tag. Throws on tagged routes without a hint key —
 * caught by the navigation unit test, never ships.
 */
function collectTaggedRoutes(): Array<{
  path: string;
  labelKey: UIStringKey;
  emoji: string;
  category: MobileCategoryId;
}> {
  const out: Array<{
    path: string;
    labelKey: UIStringKey;
    emoji: string;
    category: MobileCategoryId;
  }> = [];
  for (const item of NAV_ITEMS) {
    for (const category of mobileCategoriesOf(item)) {
      out.push({ path: item.path, labelKey: item.labelKey, emoji: item.emoji, category });
    }
    for (const child of item.children ?? []) {
      for (const category of mobileCategoriesOf(child)) {
        out.push({ path: child.path, labelKey: child.labelKey, emoji: child.emoji, category });
      }
    }
  }
  return out;
}

function buildMobileNavCategories(): MobileNavCategory[] {
  const tagged = collectTaggedRoutes();
  const byCategory = new Map<MobileCategoryId, typeof tagged>();
  for (const route of tagged) {
    const list = byCategory.get(route.category) ?? [];
    list.push(route);
    byCategory.set(route.category, list);
  }

  const categories: MobileNavCategory[] = [];
  for (const id of CATEGORY_ORDER) {
    const meta = CATEGORY_META[id];
    const routes = byCategory.get(id) ?? [];

    if (LEAF_ID_SET.has(id)) {
      // Leaf (Nook, Calendar): take the FIRST tagged route as the destination.
      const root = routes[0];
      if (!root) {
        throw new Error(
          `[navigation] mobile leaf category "${id}" has no tagged route; expected exactly one`
        );
      }
      categories.push({
        id,
        labelKey: meta.labelKey,
        emoji: meta.emoji,
        rootPath: root.path,
      });
      continue;
    }

    // Stackable category: every route must have a hint key.
    const items: MobileNavStackItem[] = routes.map((r) => {
      const hintKey = HINT_KEY_BY_PATH[r.path];
      if (!hintKey) {
        throw new Error(
          `[navigation] mobile route "${r.path}" tagged "${r.category}" has no hint key in HINT_KEY_BY_PATH`
        );
      }
      return {
        path: r.path,
        labelKey: r.labelKey,
        emoji: r.emoji,
        hintKey,
      };
    });

    categories.push({
      id,
      labelKey: meta.labelKey,
      emoji: meta.emoji,
      items,
    });
  }

  return categories;
}

/**
 * The 5 mobile bottom-nav categories, derived from NAV_ITEMS at module
 * load. Module-load throw on misconfiguration; never ships broken.
 */
export const MOBILE_NAV_CATEGORIES: MobileNavCategory[] = buildMobileNavCategories();

/** All FINANCE_ROUTES paths the Money category exposes — kept in sync. */
export const MONEY_ROUTE_PATHS: ReadonlyArray<string> = (
  MOBILE_NAV_CATEGORIES.find((c) => c.id === 'money')?.items ?? []
).map((i) => i.path);
