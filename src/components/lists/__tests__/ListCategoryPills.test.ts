import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import ListCategoryPills from '../ListCategoryPills.vue';
import { LIST_CATEGORIES } from '@/constants/listCategories';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useListCategoryLabel', () => ({
  useListCategoryLabel: () => ({
    categoryLabel: (id: string) => `cat:${id}`,
    categoryShortLabel: (id: string) => `short:${id}`,
  }),
}));

const EXTRAS = [
  { id: 'nobody' as const, label: 'Nobody yet', emoji: '🙋' },
  { id: 'skipped' as const, label: 'Skipped · 3' },
];

describe('ListCategoryPills', () => {
  it('without extras renders exactly the categories', () => {
    const w = mount(ListCategoryPills, { props: { modelValue: null } });
    expect(w.findAll('button')).toHaveLength(LIST_CATEGORIES.length);
  });

  it('renders extras after the categories with the same pill classes', () => {
    const w = mount(ListCategoryPills, { props: { modelValue: null, extras: EXTRAS } });
    const buttons = w.findAll('button');
    expect(buttons).toHaveLength(LIST_CATEGORIES.length + 2);
    const nobody = buttons[LIST_CATEGORIES.length]!;
    expect(nobody.text()).toContain('Nobody yet');
    expect(nobody.text()).toContain('🙋');
    expect(buttons.at(-1)!.text()).toBe('Skipped · 3');
    expect(nobody.classes()).toEqual(buttons[0]!.classes());
  });

  it('selecting an extra emits its id, and it renders active when selected', async () => {
    const w = mount(ListCategoryPills, {
      props: { modelValue: 'skipped' as 'nobody' | 'skipped', extras: EXTRAS, tone: 'filter' },
    });
    const buttons = w.findAll('button');
    expect(buttons.at(-1)!.classes()).toContain('text-white');

    await buttons[LIST_CATEGORIES.length]!.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['nobody']);
  });

  it('a clearable extra clears to null when tapped again', async () => {
    const w = mount(ListCategoryPills, {
      props: { modelValue: 'nobody' as 'nobody' | 'skipped', extras: EXTRAS, clearable: true },
    });
    await w.findAll('button')[LIST_CATEGORIES.length]!.trigger('click');
    expect(w.emitted('update:modelValue')?.[0]).toEqual([null]);
  });
});
