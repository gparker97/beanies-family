/**
 * Stars and rewards (#148): the star glyph and number. One spoken phrase on the root (the week's
 * stars, or a chore's value), the glyph and number hidden from a screen reader, two sizes.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', async () => {
  const { UI_STRINGS } = await import('@/services/translation/uiStrings');
  return { useTranslation: () => ({ t: (k: keyof typeof UI_STRINGS) => UI_STRINGS[k] }) };
});

import StarCount from '../StarCount.vue';

describe('StarCount', () => {
  it("a week's count: the number, and one spoken phrase", () => {
    const w = mount(StarCount, { props: { count: 22 } });
    const root = w.get('[data-testid="star-count"]');
    expect(root.text()).toBe('22');
    expect(root.attributes('role')).toBe('img');
    expect(root.attributes('aria-label')).toBe('22 stars this week');
    expect(root.attributes('data-kind')).toBe('week');
    expect(root.classes()).toContain('text-sm');
    expect(w.find('svg').attributes('aria-hidden')).toBe('true');
  });

  it("a chore's value, singular and plural, at the row size", () => {
    const one = mount(StarCount, { props: { count: 1, kind: 'value', size: 'sm' } });
    expect(one.attributes('aria-label')).toBe('Worth 1 star');
    expect(one.classes()).toContain('text-xs');
    const two = mount(StarCount, { props: { count: 2, kind: 'value' } });
    expect(two.attributes('aria-label')).toBe('Worth 2 stars');
  });

  it('stars saved toward a saved-up award are spoken as saved up, never "this week"', () => {
    const many = mount(StarCount, { props: { count: 64, kind: 'saved' } });
    expect(many.attributes('aria-label')).toBe('64 stars saved up');
    expect(many.attributes('data-kind')).toBe('saved');
    const one = mount(StarCount, { props: { count: 1, kind: 'saved' } });
    expect(one.attributes('aria-label')).toBe('1 star saved up');
  });

  it('pairs the accent glyph with its lift and the number with ink, no opacity modifier', () => {
    const w = mount(StarCount, { props: { count: 3 } });
    expect(w.find('svg').classes()).toEqual(
      expect.arrayContaining(['text-terracotta-600', 'dark:text-terracotta-lift'])
    );
    expect(w.classes()).toEqual(
      expect.arrayContaining(['text-secondary-500', 'dark:text-ink-soft'])
    );
    expect(w.html()).not.toMatch(/text-[a-z-]+-\d+\/\d+/);
  });
});
