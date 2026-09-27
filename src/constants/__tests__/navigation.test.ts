import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

// Flags default on; a test can switch one off to prove hidden items never match.
const disabledFlags = new Set<string>();
vi.mock('@/config/flags', () => ({ isFlagEnabled: (flag: string) => !disabledFlags.has(flag) }));
import {
  NAV_ITEMS,
  NAV_SECTIONS,
  POD_ANCHOR_SRC,
  activeNavItem,
  navItemsInSection,
  MOBILE_NAV_CATEGORIES,
  MONEY_ROUTE_PATHS,
  KNOWN_BADGE_KEYS,
  getBadgeKeyForPath,
  MOBILE_TAGGED_NAV_ITEMS,
  type MobileCategoryId,
} from '../navigation';

describe('navigation: MOBILE_NAV_CATEGORIES', () => {
  it('exports exactly 5 categories in canonical order (Calendar centred)', () => {
    expect(MOBILE_NAV_CATEGORIES.map((c) => c.id)).toEqual([
      'nook',
      'planning',
      'calendar',
      'money',
      'pod',
    ]);
  });

  it('Nook is a leaf with rootPath, no items', () => {
    const nook = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'nook')!;
    expect(nook.rootPath).toBe('/nook');
    expect(nook.items).toBeUndefined();
  });

  it('Calendar is a leaf → /activities, no items', () => {
    const calendar = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'calendar')!;
    expect(calendar.rootPath).toBe('/activities');
    expect(calendar.items).toBeUndefined();
  });

  it('every stackable category has at least one item', () => {
    const stackable: MobileCategoryId[] = ['planning', 'money', 'pod'];
    for (const id of stackable) {
      const cat = MOBILE_NAV_CATEGORIES.find((c) => c.id === id)!;
      expect(cat.items).toBeDefined();
      expect(cat.items!.length).toBeGreaterThan(0);
    }
  });

  it('total stack items = 18 (Planning: Activities, Travel, To-do, Beanie Lists, Meal Planner, Who Owns What = 6; Money 6; Pod 6)', () => {
    // MOBILE_NAV_CATEGORIES is built at module load without flag awareness, so
    // the flag-gated Beanie Lists item is always present in the data (the bean
    // stack filters it at render via isItemFlagEnabled).
    const total = MOBILE_NAV_CATEGORIES.reduce((sum, c) => sum + (c.items?.length ?? 0), 0);
    expect(total).toBe(18);
  });

  it('Planning has Activities (first), Travel, To-do, Beanie Lists, Meal Planner, Who Owns What', () => {
    const planning = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'planning')!;
    expect(planning.items!.map((i) => i.path)).toEqual([
      '/activities',
      '/travel',
      '/todo',
      '/lists',
      '/meal-planner',
      '/who-owns-what',
    ]);
  });

  it('Activities lives in BOTH the Calendar leaf and the Planning stack', () => {
    const calendar = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'calendar')!;
    const planning = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'planning')!;
    expect(calendar.rootPath).toBe('/activities');
    expect(planning.items!.map((i) => i.path)).toContain('/activities');
  });

  it('Money has 6 finance routes', () => {
    const money = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'money')!;
    expect(money.items!.map((i) => i.path)).toEqual([
      '/dashboard',
      '/accounts',
      '/budgets',
      '/transactions',
      '/goals',
      '/assets',
    ]);
  });

  it('Pod has 6 sub-routes', () => {
    const pod = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'pod')!;
    expect(pod.items!.map((i) => i.path)).toEqual([
      '/pod',
      '/pod/scrapbook',
      '/pod/milestones',
      '/pod/cookbook',
      '/pod/safety',
      '/pod/contacts',
    ]);
  });

  it('every stack item has a labelKey, emoji, and hintKey', () => {
    for (const cat of MOBILE_NAV_CATEGORIES) {
      if (!cat.items) continue;
      for (const item of cat.items) {
        expect(item.labelKey).toBeTruthy();
        expect(item.emoji).toBeTruthy();
        expect(item.hintKey).toMatch(/^mobileNav\.hint\./);
      }
    }
  });

  it('MONEY_ROUTE_PATHS mirrors Money category items', () => {
    expect(MONEY_ROUTE_PATHS).toEqual([
      '/dashboard',
      '/accounts',
      '/budgets',
      '/transactions',
      '/goals',
      '/assets',
    ]);
  });

  it('every NAV_ITEMS path is unique (activeNavItem and the badge lookup assume one item per path)', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('the Pod tab carries the hugging-beanies anchor, with the emoji as its fallback', () => {
    const pod = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'pod')!;
    expect(pod.iconSrc).toBe(POD_ANCHOR_SRC);
    expect(pod.emoji).toBeTruthy();
  });
});

describe('navigation: badge registry', () => {
  it('every NAV_ITEM.badgeKey is in KNOWN_BADGE_KEYS', () => {
    const known = new Set<string>(KNOWN_BADGE_KEYS);
    for (const item of NAV_ITEMS) {
      if (item.badgeKey) {
        expect(known.has(item.badgeKey)).toBe(true);
      }
    }
  });

  it('getBadgeKeyForPath returns the registered key for the 4 wired surfaces', () => {
    expect(getBadgeKeyForPath('/todo')).toBe('overdueTodos');
    expect(getBadgeKeyForPath('/travel')).toBe('unbookedTravel');
    expect(getBadgeKeyForPath('/budgets')).toBe('overBudgets');
    expect(getBadgeKeyForPath('/goals')).toBe('overdueGoals');
  });

  it('getBadgeKeyForPath returns undefined for paths with no badge', () => {
    expect(getBadgeKeyForPath('/nook')).toBeUndefined();
    expect(getBadgeKeyForPath('/dashboard')).toBeUndefined();
    expect(getBadgeKeyForPath('/unknown-path')).toBeUndefined();
  });

  it('MOBILE_TAGGED_NAV_ITEMS includes every item tagged with a mobileCategory', () => {
    const paths = MOBILE_TAGGED_NAV_ITEMS.map((i) => i.path);
    expect(paths).toContain('/todo');
    expect(paths).toContain('/travel');
    expect(paths).toContain('/budgets');
    expect(paths).toContain('/goals');
    expect(paths).toContain('/pod/scrapbook');
    expect(paths).toContain('/pod/cookbook');
    expect(paths).not.toContain('/settings');
  });

  it('expands a multi-category route into one entry per category (Activities → calendar + planning)', () => {
    const activities = MOBILE_TAGGED_NAV_ITEMS.filter((i) => i.path === '/activities');
    expect(activities.map((e) => e.mobileCategory).sort()).toEqual(['calendar', 'planning']);
  });
});

describe('navigation: sidebar sections', () => {
  it('has three accordion sections in the phone tab order, each labelled with a -lift token', () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual(['treehouse', 'piggyBank', 'beanPod']);
    for (const section of NAV_SECTIONS) expect(section.colorClass).toMatch(/^text-[a-z]+-lift$/);
    expect(NAV_SECTIONS.find((s) => s.id === 'piggyBank')!.requiresFinances).toBe(true);
  });

  it('The Bean Pod holds the six Pod pages, flat, in order', () => {
    expect(navItemsInSection('beanPod').map((i) => i.path)).toEqual([
      '/pod',
      '/pod/scrapbook',
      '/pod/milestones',
      '/pod/cookbook',
      '/pod/safety',
      '/pod/contacts',
    ]);
  });

  it('The Treehouse no longer contains any Pod page', () => {
    expect(navItemsInSection('treehouse').some((i) => i.path.startsWith('/pod'))).toBe(false);
  });

  it('The Bean Pod is anchored by the hugging beanies, with an emoji fallback', () => {
    const pod = NAV_SECTIONS.find((s) => s.id === 'beanPod')!;
    expect(pod.labelKey).toBe('nav.section.beanPod');
    expect(pod.iconSrc).toBe(POD_ANCHOR_SRC);
    expect(pod.emoji).toBeTruthy();
  });

  it('the anchor image exists in the brand source (public/brand is build output)', () => {
    expect(existsSync(join('packages/brand/assets/shared', basename(POD_ANCHOR_SRC)))).toBe(true);
  });
});

describe('navigation: activeNavItem', () => {
  const MEMBER = '0f8b6c1e-2d3a-4b5c-8d9e-1a2b3c4d5e6f';

  it('picks the most specific item for a route', () => {
    expect(activeNavItem('/pod/cookbook')?.path).toBe('/pod/cookbook');
    expect(activeNavItem(`/pod/cookbook/${MEMBER}`)?.path).toBe('/pod/cookbook');
    expect(activeNavItem('/pod')?.path).toBe('/pod');
  });

  it('maps a member page to Meet the Beans in The Bean Pod', () => {
    const item = activeNavItem(`/pod/${MEMBER}/overview`);
    expect(item?.path).toBe('/pod');
    expect(item?.section).toBe('beanPod');
  });

  it('returns the owning item for other sections', () => {
    expect(activeNavItem('/settings')?.section).toBe('pinned');
    expect(activeNavItem('/budgets')?.section).toBe('piggyBank');
  });

  it('skips a flag-hidden item (it is never rendered, so it must never win)', () => {
    expect(activeNavItem('/lists')?.path).toBe('/lists');
    disabledFlags.add('familyLists');
    try {
      expect(activeNavItem('/lists')).toBeUndefined();
    } finally {
      disabledFlags.delete('familyLists');
    }
  });

  it('never matches external items or look-alike paths', () => {
    expect(activeNavItem('/help')).toBeUndefined();
    expect(activeNavItem('/discord')).toBeUndefined();
    expect(activeNavItem('/podcast')).toBeUndefined();
    expect(activeNavItem('/')).toBeUndefined();
  });
});
