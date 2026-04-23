/**
 * Pure-function tests for `buildIntentQuery`. No router, no components,
 * no Pinia — just a function of (item, route).
 */
import { describe, it, expect } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { buildIntentQuery } from '../useQuickAdd';
import type { QuickAddItem } from '@/constants/quickAddItems';

function makeRoute(
  overrides: Partial<RouteLocationNormalizedLoaded> = {}
): RouteLocationNormalizedLoaded {
  return {
    path: '/somewhere',
    fullPath: '/somewhere',
    hash: '',
    query: {},
    params: {},
    name: undefined,
    matched: [],
    meta: {},
    redirectedFrom: undefined,
    ...overrides,
  } as RouteLocationNormalizedLoaded;
}

function makeItem(overrides: Partial<QuickAddItem> = {}): QuickAddItem {
  const base = {
    id: 'test',
    group: 'everyday' as const,
    order: 1,
    emoji: '✅',
    labelKey: 'quickAdd.activity.label' as const,
    hintKey: 'quickAdd.activity.hint' as const,
    route: '/target',
    action: 'add-activity' as const,
  };
  return { ...base, ...overrides } as QuickAddItem;
}

describe('buildIntentQuery', () => {
  it('returns { action } when the item has no contextKey or tab', () => {
    const out = buildIntentQuery(makeItem(), makeRoute());
    expect(out).toEqual({ action: 'add-activity' });
  });

  it('includes `tab` when the item sets one', () => {
    // `tab` is a generic passthrough — any item that sets one carries
    // it into the query. No production item currently uses it, so this
    // synthesises one to keep the mechanism regression-tested.
    const out = buildIntentQuery(
      makeItem({ action: 'add-activity', tab: 'archived' }),
      makeRoute()
    );
    expect(out).toEqual({ action: 'add-activity', tab: 'archived' });
  });

  it('includes contextKey from route.params when present', () => {
    const out = buildIntentQuery(
      makeItem({ action: 'add-saying', contextKey: 'memberId' }),
      makeRoute({ params: { memberId: 'bean-123' } })
    );
    expect(out).toEqual({ action: 'add-saying', memberId: 'bean-123' });
  });

  it('omits contextKey when the route has no matching param', () => {
    const out = buildIntentQuery(
      makeItem({ action: 'add-saying', contextKey: 'memberId' }),
      makeRoute({ params: {} })
    );
    expect(out).toEqual({ action: 'add-saying' });
  });

  it('omits contextKey when the route param is an array (rare, not supported)', () => {
    const out = buildIntentQuery(
      makeItem({ action: 'add-saying', contextKey: 'memberId' }),
      // Vue Router can return `string[]` for repeated params — ignore those.
      makeRoute({ params: { memberId: ['a', 'b'] } as unknown as { memberId: string } })
    );
    expect(out).toEqual({ action: 'add-saying' });
  });

  it('omits contextKey when the route param is an empty string', () => {
    const out = buildIntentQuery(
      makeItem({ action: 'add-saying', contextKey: 'memberId' }),
      makeRoute({ params: { memberId: '' } })
    );
    expect(out).toEqual({ action: 'add-saying' });
  });

  describe('override argument (picker-commit path)', () => {
    it('uses override value when provided', () => {
      const out = buildIntentQuery(
        makeItem({ action: 'add-saying', contextKey: 'memberId' }),
        makeRoute({ params: {} }),
        { memberId: 'picked-123' }
      );
      expect(out).toEqual({ action: 'add-saying', memberId: 'picked-123' });
    });

    it('override wins over a route param for the same key', () => {
      const out = buildIntentQuery(
        makeItem({ action: 'add-saying', contextKey: 'memberId' }),
        makeRoute({ params: { memberId: 'from-route' } }),
        { memberId: 'from-picker' }
      );
      expect(out.memberId).toBe('from-picker');
    });

    it('falls through to route params when override is empty for the key', () => {
      const out = buildIntentQuery(
        makeItem({ action: 'add-saying', contextKey: 'memberId' }),
        makeRoute({ params: { memberId: 'fallback' } }),
        { memberId: '' } // empty string does not count as an override
      );
      expect(out.memberId).toBe('fallback');
    });

    it("ignores override keys that don't match the item's contextKey", () => {
      const out = buildIntentQuery(
        makeItem({ action: 'add-saying', contextKey: 'memberId' }),
        makeRoute({ params: {} }),
        { recipeId: 'r-1' } // wrong key for this item
      );
      expect(out).toEqual({ action: 'add-saying' });
    });
  });
});
