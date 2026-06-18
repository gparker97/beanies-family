import { describe, it, expect } from 'vitest';
import {
  NAV_ITEMS,
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

  it('total stack items = 16 (Planning: Activities, Travel, To-do, Beanie Lists = 4; Money 6; Pod 6)', () => {
    // MOBILE_NAV_CATEGORIES is built at module load without flag awareness, so
    // the flag-gated Beanie Lists item is always present in the data (the bean
    // stack filters it at render via isItemFlagEnabled).
    const total = MOBILE_NAV_CATEGORIES.reduce((sum, c) => sum + (c.items?.length ?? 0), 0);
    expect(total).toBe(16);
  });

  it('Planning has Activities (first), Travel, To-do, Beanie Lists', () => {
    const planning = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'planning')!;
    expect(planning.items!.map((i) => i.path)).toEqual([
      '/activities',
      '/travel',
      '/todo',
      '/lists',
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

  it('paths in NAV_ITEMS with mobileCategory are unique', () => {
    const paths: string[] = [];
    for (const item of NAV_ITEMS) {
      if (item.mobileCategory) paths.push(item.path);
      if (item.children) {
        for (const child of item.children) {
          if (child.mobileCategory) paths.push(child.path);
        }
      }
    }
    expect(new Set(paths).size).toBe(paths.length);
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

  it('MOBILE_TAGGED_NAV_ITEMS includes parents and children with mobileCategory', () => {
    const paths = MOBILE_TAGGED_NAV_ITEMS.map((i) => i.path);
    // Parents tagged with mobileCategory
    expect(paths).toContain('/todo');
    expect(paths).toContain('/travel');
    expect(paths).toContain('/budgets');
    expect(paths).toContain('/goals');
    // Pod children tagged with mobileCategory
    expect(paths).toContain('/pod/scrapbook');
    expect(paths).toContain('/pod/cookbook');
  });

  it('expands a multi-category route into one entry per category (Activities → calendar + planning)', () => {
    const activities = MOBILE_TAGGED_NAV_ITEMS.filter((i) => i.path === '/activities');
    expect(activities.map((e) => e.mobileCategory).sort()).toEqual(['calendar', 'planning']);
  });
});
