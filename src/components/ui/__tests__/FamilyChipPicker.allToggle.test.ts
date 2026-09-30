/**
 * FamilyChipPicker's optional Clear / Everyone toggle (#116), used by the edit-meal drawer.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const MEMBERS = [
  { id: 'a', name: 'Greg' },
  { id: 'b', name: 'Sofia' },
  { id: 'c', name: 'Leo' },
];

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ sortedHumans: MEMBERS, sortedMembers: MEMBERS }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

import FamilyChipPicker from '../FamilyChipPicker.vue';

function mounted(modelValue: string[] | string, extra: Record<string, unknown> = {}) {
  const w = mount(FamilyChipPicker, {
    props: {
      modelValue,
      mode: 'multi' as 'single' | 'multi',
      allToggle: true,
      'onUpdate:modelValue': (v: string | string[]) => w.setProps({ modelValue: v }),
      ...extra,
    },
    global: { stubs: { BeanieAvatar: true } },
  });
  return w;
}
const toggle = (w: ReturnType<typeof mounted>) => w.find('[data-testid="family-chip-all-toggle"]');

describe('FamilyChipPicker allToggle', () => {
  it('reads Clear when every chip is picked, and clears them all', async () => {
    const w = mounted(['a', 'b', 'c']);
    expect(toggle(w).text()).toBe('action.clear');
    expect(toggle(w).attributes('aria-pressed')).toBeUndefined();
    await toggle(w).trigger('click');
    expect(w.props('modelValue')).toEqual([]);
    expect(toggle(w).text()).toBe('common.everyone');
  });

  it('reads Everyone for a subset or nobody, and picks them all', async () => {
    const w = mounted(['b']);
    expect(toggle(w).text()).toBe('common.everyone');
    await toggle(w).trigger('click');
    expect(w.props('modelValue')).toEqual(['b', 'a', 'c']);
    expect(toggle(w).text()).toBe('action.clear');
  });

  it('measures "all" against the picker’s own members prop', () => {
    const w = mounted(['a'], { members: [MEMBERS[0]] });
    expect(toggle(w).text()).toBe('action.clear');
  });

  it('is off by default and never shown in single mode', () => {
    expect(
      mounted(['a'], { allToggle: false }).find('[data-testid="family-chip-all-toggle"]').exists()
    ).toBe(false);
    expect(
      mounted('a', { mode: 'single' }).find('[data-testid="family-chip-all-toggle"]').exists()
    ).toBe(false);
  });
});
