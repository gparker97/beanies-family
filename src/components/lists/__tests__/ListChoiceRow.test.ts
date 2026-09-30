/**
 * One family list as a row (#116, extracted from the recipe sheet's review rows).
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'lists.progress' ? '{done}/{total}' : k) }),
}));

import ListChoiceRow from '../ListChoiceRow.vue';

const LIST = {
  id: 'l1',
  title: 'Weekly Groceries',
  emoji: '🛒',
  completed: false,
  items: [{ completed: true }, { completed: false }],
} as never;

describe('ListChoiceRow', () => {
  it('shows the emoji, title and progress, with the "open" affordance by default', () => {
    const w = mount(ListChoiceRow, { props: { list: LIST } });
    expect(w.text()).toContain('Weekly Groceries');
    expect(w.text()).toContain('1/2');
    expect(w.text()).toContain('lists.embed.open');
    expect(w.attributes('aria-pressed')).toBeUndefined();
  });

  it('as a pick, drops the affordance and says whether it is chosen', () => {
    const off = mount(ListChoiceRow, { props: { list: LIST, selectable: true } });
    expect(off.text()).not.toContain('lists.embed.open');
    expect(off.attributes('aria-pressed')).toBe('false');
    const on = mount(ListChoiceRow, { props: { list: LIST, selectable: true, selected: true } });
    expect(on.attributes('aria-pressed')).toBe('true');
    expect(on.classes()).toContain('border-primary-500');
  });

  it('the click is the caller’s', async () => {
    let clicked = 0;
    const w = mount(ListChoiceRow, { props: { list: LIST }, attrs: { onClick: () => clicked++ } });
    await w.trigger('click');
    expect(clicked).toBe(1);
  });
});
