import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';
import { isKnownFlag, type DevFlag } from '@/config/flagRegistry';
import { isFlagEnabled } from '@/config/flags';
import { isRouteActive } from '@/utils/route';

/**
 * Shared visibility test for any flag-gated config item (nav items, quick-add
 * items): true unless the item names a dev flag that is currently off. The ONE
 * place this logic lives — consumed by the sidebar, mobile nav, and quick-add
 * sheet so the four surfaces can't drift.
 */
export function isItemFlagEnabled(item: { requiresFlag?: DevFlag }): boolean {
  return !item.requiresFlag || isFlagEnabled(item.requiresFlag);
}

export type NavSection = 'treehouse' | 'piggyBank' | 'beanPod' | 'pinned';
/** The collapsible sidebar sections (everything except the pinned footer). */
export type AccordionSectionId = Exclude<NavSection, 'pinned'>;

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
  id: AccordionSectionId;
  labelKey: UIStringKey;
  /** Always set: the anchor itself, or the fallback when `iconSrc` fails to load. */
  emoji: string;
  /** Optional image anchor shown in place of the emoji (see ImageGlyph). */
  iconSrc?: string;
  /** Label colour on the Deep Slate sidebar/drawer (both modes): a `-lift` token. */
  colorClass: string;
  /** Hidden from members who cannot view finances. */
  requiresFinances?: boolean;
}

export interface NavItemDef {
  labelKey: UIStringKey;
  path: string;
  emoji: string;
  section: NavSection;
  badgeKey?: string;
  /** Hide this item unless the named dev feature flag is enabled. */
  requiresFlag?: DevFlag;
  external?: boolean;
  externalUrl?: string;
  /**
   * See `MobileCategoryId` for the tagging contract. Accepts an array to place
   * one route in MORE THAN ONE mobile slot — e.g. `/activities` is both the
   * center Calendar leaf AND a Planning-stack bean.
   */
  mobileCategory?: MobileCategoryId | MobileCategoryId[];
}

/** Normalize the single-or-array `mobileCategory` tag to an array (possibly empty). */
function mobileCategoriesOf(item: {
  mobileCategory?: MobileCategoryId | MobileCategoryId[];
}): MobileCategoryId[] {
  if (!item.mobileCategory) return [];
  return Array.isArray(item.mobileCategory) ? item.mobileCategory : [item.mobileCategory];
}

/** The Bean Pod's anchor: the hugging beanies at icon size (source in packages/brand/assets/shared). */
export const POD_ANCHOR_SRC = '/brand/beanies_family_hugging_transparent_64x64.png';

/** Sidebar/drawer accordion sections, in display order (the phone tab order). */
export const NAV_SECTIONS: NavSectionDef[] = [
  {
    id: 'treehouse',
    labelKey: 'nav.section.treehouse',
    emoji: '\u{1F333}',
    colorClass: 'text-accent-lift',
  },
  {
    id: 'piggyBank',
    labelKey: 'nav.section.piggyBank',
    emoji: '\u{1F437}',
    colorClass: 'text-success-lift',
    requiresFinances: true,
  },
  {
    id: 'beanPod',
    labelKey: 'nav.section.beanPod',
    emoji: '\u{1F331}',
    iconSrc: POD_ANCHOR_SRC,
    colorClass: 'text-silk-lift',
  },
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
    badgeKey: 'unbookedTravel',
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
    labelKey: 'nav.lists',
    path: '/lists',
    emoji: '🧾',
    section: 'treehouse',
    requiresFlag: 'familyLists',
    badgeKey: 'dueLists',
    mobileCategory: 'planning',
  },
  {
    labelKey: 'nav.mealPlanner',
    path: '/meal-planner',
    emoji: '\u{1F372}',
    section: 'treehouse',
    mobileCategory: 'planning',
    requiresFlag: 'mealPlanner',
  },
  {
    labelKey: 'nav.whoOwnsWhat',
    path: '/who-owns-what',
    emoji: '🙋',
    section: 'treehouse',
    mobileCategory: 'planning',
    badgeKey: 'stillToDeal',
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
  // The Bean Pod
  {
    labelKey: 'nav.pod.meetBeans',
    path: '/pod',
    emoji: '\u{1F9D1}‍\u{1F91D}‍\u{1F9D1}',
    section: 'beanPod',
    mobileCategory: 'pod',
  },
  {
    labelKey: 'nav.pod.scrapbook',
    path: '/pod/scrapbook',
    emoji: '\u{1F4D6}',
    section: 'beanPod',
    mobileCategory: 'pod',
  },
  {
    labelKey: 'nav.pod.milestones',
    path: '/pod/milestones',
    emoji: '\u{1F31F}',
    section: 'beanPod',
    mobileCategory: 'pod',
  },
  {
    labelKey: 'nav.pod.cookbook',
    path: '/pod/cookbook',
    emoji: '\u{1F35C}',
    section: 'beanPod',
    mobileCategory: 'pod',
  },
  {
    labelKey: 'nav.pod.safety',
    path: '/pod/safety',
    emoji: '\u{1FA7A}',
    section: 'beanPod',
    mobileCategory: 'pod',
  },
  {
    labelKey: 'nav.pod.contacts',
    path: '/pod/contacts',
    emoji: '\u{1F198}',
    section: 'beanPod',
    mobileCategory: 'pod',
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

/** The nav items of one section (or the pinned footer), in display order. */
export function navItemsInSection(id: NavSection): NavItemDef[] {
  return NAV_ITEMS.filter((item) => item.section === id);
}

const ROUTED_NAV_ITEMS = NAV_ITEMS.filter((item) => !item.external);

/**
 * The nav item for a route: the most specific visible, non-external item whose path is
 * the route or an ancestor of it (`/pod/cookbook/<id>` → Family Cookbook,
 * `/pod/<memberId>/overview` → Meet the Beans). The one lookup for both "which
 * row is current" and "which section owns this route".
 */
export function activeNavItem(routePath: string): NavItemDef | undefined {
  let best: NavItemDef | undefined;
  for (const item of ROUTED_NAV_ITEMS) {
    // A flag-hidden item is never rendered, so it must never win the match.
    if (!isRouteActive(routePath, item.path) || !isItemFlagEnabled(item)) continue;
    if (!best || item.path.length > best.path.length) best = item;
  }
  return best;
}

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
  'unbookedTravel',
  'dueLists',
  'stillToDeal',
] as const;
export type KnownBadgeKey = (typeof KNOWN_BADGE_KEYS)[number];
const KNOWN_BADGE_KEY_SET: ReadonlySet<string> = new Set(KNOWN_BADGE_KEYS);

// Module-load invariant — every NAV_ITEM.badgeKey must be a known key.
// Throws on typo / stale reference so it can never ship; the navigation
// unit test exercises this path.
for (const entry of NAV_ITEMS) {
  if (entry.badgeKey && !KNOWN_BADGE_KEY_SET.has(entry.badgeKey)) {
    throw new Error(
      `[navigation] NAV_ITEM "${entry.path}" has badgeKey "${entry.badgeKey}" which is not in KNOWN_BADGE_KEYS. ` +
        `Add it to KNOWN_BADGE_KEYS here AND to the badges map in useNavBadges.ts, then re-run tests.`
    );
  }
}

// Module-load invariant — every NAV_ITEM.requiresFlag must be a registered dev
// flag. `requiresFlag: DevFlag` already makes a literal typo a compile error;
// this is belt-and-suspenders for any non-typed source, mirroring the badge-key
// check above (the navigation unit test exercises it).
for (const item of NAV_ITEMS) {
  if (item.requiresFlag && !isKnownFlag(item.requiresFlag)) {
    throw new Error(
      `[navigation] NAV_ITEM "${item.path}" has requiresFlag "${item.requiresFlag}" which is not in FLAG_REGISTRY. ` +
        `Add it to src/config/flagRegistry.ts (+ featureFlags.committed.ts), then re-run tests.`
    );
  }
}

const NAV_ITEMS_BY_PATH: ReadonlyMap<string, NavItemDef> = new Map(
  NAV_ITEMS.map((entry) => [entry.path, entry])
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
}> = NAV_ITEMS.flatMap((e) =>
  mobileCategoriesOf(e).map((mobileCategory) => ({ path: e.path, mobileCategory }))
);

// =============================================================================
// Mobile nav v3 — derived from NAV_ITEMS
// =============================================================================

export interface MobileNavStackItem {
  path: string;
  labelKey: UIStringKey;
  emoji: string;
  hintKey: UIStringKey;
  /** Gate this stack item behind a dev flag (filtered at render via isItemFlagEnabled). */
  requiresFlag?: DevFlag;
}

/** Tab label + anchor. `emoji` is always set; `iconSrc`, when present, replaces it (emoji = fallback). */
interface MobileCategoryMeta {
  labelKey: UIStringKey;
  emoji: string;
  iconSrc?: string;
}

export interface MobileNavCategory extends MobileCategoryMeta {
  id: MobileCategoryId;
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
  '/lists': 'mobileNav.hint.lists',
  '/meal-planner': 'mobileNav.hint.mealPlanner',
  '/who-owns-what': 'mobileNav.hint.whoOwnsWhat',
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

const CATEGORY_META: Record<MobileCategoryId, MobileCategoryMeta> = {
  nook: { labelKey: 'mobile.nook', emoji: '\u{1F3E1}' },
  planning: { labelKey: 'mobile.planning', emoji: '\u{1F333}' },
  calendar: { labelKey: 'mobile.calendar', emoji: '\u{1F4C5}' },
  money: { labelKey: 'mobile.money', emoji: '\u{1F437}' },
  pod: { labelKey: 'mobile.pod', emoji: '\u{1F331}', iconSrc: POD_ANCHOR_SRC },
};

/**
 * Walk NAV_ITEMS once, collecting every entry with a
 * `mobileCategory` tag. Throws on tagged routes without a hint key —
 * caught by the navigation unit test, never ships.
 */
function collectTaggedRoutes(): Array<{
  path: string;
  labelKey: UIStringKey;
  emoji: string;
  category: MobileCategoryId;
  requiresFlag?: DevFlag;
}> {
  const out: Array<{
    path: string;
    labelKey: UIStringKey;
    emoji: string;
    category: MobileCategoryId;
    requiresFlag?: DevFlag;
  }> = [];
  for (const item of NAV_ITEMS) {
    for (const category of mobileCategoriesOf(item)) {
      out.push({
        path: item.path,
        labelKey: item.labelKey,
        emoji: item.emoji,
        category,
        requiresFlag: item.requiresFlag,
      });
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
      categories.push({ id, ...meta, rootPath: root.path });
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
        requiresFlag: r.requiresFlag,
      };
    });

    categories.push({ id, ...meta, items });
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
