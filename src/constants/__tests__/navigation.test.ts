import { describe, it, expect } from 'vitest';
import {
  NAV_ITEMS,
  MOBILE_NAV_CATEGORIES,
  MONEY_ROUTE_PATHS,
  type MobileCategoryId,
} from '../navigation';

describe('navigation: MOBILE_NAV_CATEGORIES', () => {
  it('exports exactly 4 categories in canonical order', () => {
    expect(MOBILE_NAV_CATEGORIES.map((c) => c.id)).toEqual(['nook', 'planning', 'money', 'pod']);
  });

  it('Nook is a leaf with rootPath, no items', () => {
    const nook = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'nook')!;
    expect(nook.rootPath).toBe('/nook');
    expect(nook.items).toBeUndefined();
  });

  it('every stackable category has at least one item', () => {
    const stackable: MobileCategoryId[] = ['planning', 'money', 'pod'];
    for (const id of stackable) {
      const cat = MOBILE_NAV_CATEGORIES.find((c) => c.id === id)!;
      expect(cat.items).toBeDefined();
      expect(cat.items!.length).toBeGreaterThan(0);
    }
  });

  it('total stack items = 14 (matches v3 mockup spec)', () => {
    const total = MOBILE_NAV_CATEGORIES.reduce((sum, c) => sum + (c.items?.length ?? 0), 0);
    expect(total).toBe(14);
  });

  it('Planning has Activities, To-do, Travel', () => {
    const planning = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'planning')!;
    expect(planning.items!.map((i) => i.path)).toEqual(['/activities', '/travel', '/todo']);
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

  it('Pod has 5 sub-routes', () => {
    const pod = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'pod')!;
    expect(pod.items!.map((i) => i.path)).toEqual([
      '/pod',
      '/pod/scrapbook',
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
