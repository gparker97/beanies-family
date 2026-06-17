import { describe, it, expect, vi } from 'vitest';

// t() echoes the key so we can assert the resolver routes id → labelKey.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => `t:${k}` }),
}));

import { useListCategoryLabel } from '../useListCategoryLabel';

describe('useListCategoryLabel', () => {
  it('resolves a known category id to its labelKey via t()', () => {
    const { categoryLabel } = useListCategoryLabel();
    expect(categoryLabel('home')).toBe('t:lists.category.home');
    expect(categoryLabel('me')).toBe('t:lists.category.me');
  });

  it('falls back to the id string for an unknown category (never throws)', () => {
    const { categoryLabel } = useListCategoryLabel();
    // @ts-expect-error — exercising the defensive fallback path
    expect(categoryLabel('bogus')).toBe('bogus');
  });
});
