import type { UIStringKey } from '@/services/translation/uiStrings';
import { MARKETING_URL } from '@/utils/marketing';

export type NavSection = 'treehouse' | 'piggyBank' | 'pinned';

/**
 * Tag a NAV_ITEMS entry with a mobile category to make it appear in the
 * v3 mobile bottom nav. `'nook'` is a leaf (Nook tab navigates directly).
 * The other three are stacks — tapping the tab opens a vertical bean
 * column with the tagged routes as children.
 *
 * Items WITHOUT a mobileCategory (Settings, Help) intentionally do not
 * appear on mobile — desktop-sidebar / hamburger-only.
 *
 * Adding a route: tag it here once; the derived `MOBILE_NAV_CATEGORIES`
 * picks it up automatically. Adding a hint: extend `HINT_KEY_BY_PATH`.
 */
export type MobileCategoryId = 'nook' | 'planning' | 'money' | 'pod';

/** Categories that open a bean stack (Nook is a single-tap leaf). */
export type StackableCategoryId = Exclude<MobileCategoryId, 'nook'>;

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
  /** See `MobileCategoryId` for tagging contract. */
  mobileCategory?: MobileCategoryId;
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
  mobileCategory?: MobileCategoryId;
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
    mobileCategory: 'planning',
  },
  {
    labelKey: 'nav.travel',
    path: '/travel',
    emoji: '✈️',
    section: 'treehouse',
    mobileCategory: 'planning',
  },
  {
    labelKey: 'nav.todo',
    path: '/todo',
    emoji: '✅',
    section: 'treehouse',
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
    badgeKey: 'activeGoals',
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
  { labelKey: 'nav.settings', path: '/settings', emoji: '⚙️', section: 'pinned' },
];

export const TREEHOUSE_ITEMS = NAV_ITEMS.filter((item) => item.section === 'treehouse');
export const PIGGY_BANK_ITEMS = NAV_ITEMS.filter((item) => item.section === 'piggyBank');
export const PINNED_ITEMS = NAV_ITEMS.filter((item) => item.section === 'pinned');

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
  /** A leaf category (Nook) renders as a direct router-push tab. */
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
  '/pod/cookbook': 'mobileNav.hint.cookbook',
  '/pod/safety': 'mobileNav.hint.safety',
  '/pod/contacts': 'mobileNav.hint.contacts',
};

/** Display order for the 4 mobile tabs. Nook always first. */
const CATEGORY_ORDER: MobileCategoryId[] = ['nook', 'planning', 'money', 'pod'];

const CATEGORY_META: Record<MobileCategoryId, { labelKey: UIStringKey; emoji: string }> = {
  nook: { labelKey: 'mobile.nook', emoji: '\u{1F3E1}' },
  planning: { labelKey: 'mobile.planning', emoji: '\u{1F333}' },
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
    if (item.mobileCategory) {
      out.push({
        path: item.path,
        labelKey: item.labelKey,
        emoji: item.emoji,
        category: item.mobileCategory,
      });
    }
    if (item.children) {
      for (const child of item.children) {
        if (child.mobileCategory) {
          out.push({
            path: child.path,
            labelKey: child.labelKey,
            emoji: child.emoji,
            category: child.mobileCategory,
          });
        }
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

    if (id === 'nook') {
      // Nook is a leaf: take the FIRST tagged route as the destination.
      const root = routes[0];
      if (!root) {
        throw new Error(
          `[navigation] mobile category "nook" has no tagged route; expected exactly one`
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
 * The 4 mobile bottom-nav categories, derived from NAV_ITEMS at module
 * load. Module-load throw on misconfiguration; never ships broken.
 */
export const MOBILE_NAV_CATEGORIES: MobileNavCategory[] = buildMobileNavCategories();

/** All FINANCE_ROUTES paths the Money category exposes — kept in sync. */
export const MONEY_ROUTE_PATHS: ReadonlyArray<string> = (
  MOBILE_NAV_CATEGORIES.find((c) => c.id === 'money')?.items ?? []
).map((i) => i.path);
