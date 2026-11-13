/**
 * The shared "never nobody" people picker (lists #147, chores #146): an empty pick is refused
 * with a neutral hint, and the hint clears on the next accepted pick and whenever the host sets
 * a selection the roster knows (a chore modal stays mounted while closed, so a refusal must not
 * survive into the next open).
 */
import { describe, it, expect, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: [{ id: 'me' }, { id: 'kid' }] }),
}));

import ListPeoplePicker from '../ListPeoplePicker.vue';

const Chips = defineComponent({
  props: { modelValue: { type: Array, default: () => [] } },
  emits: ['update:modelValue'],
  template: '<div data-testid="chips" />',
});

function mountPicker(modelValue: string[] = ['me']) {
  return mount(ListPeoplePicker, {
    props: { modelValue, hintTestid: 'hint' },
    global: { stubs: { FamilyChipPicker: Chips } },
  });
}

describe('ListPeoplePicker', () => {
  it('refuses an empty pick with the neutral keep-one hint, and emits nothing', async () => {
    const w = mountPicker();
    await w.findComponent(Chips).vm.$emit('update:modelValue', []);
    expect(w.emitted('update:modelValue')).toBeUndefined();
    expect(w.get('[data-testid="hint"]').text()).toBe('lists.people.keepOne');
  });

  it('clears the hint on the next accepted pick', async () => {
    const w = mountPicker();
    await w.findComponent(Chips).vm.$emit('update:modelValue', []);
    await w.findComponent(Chips).vm.$emit('update:modelValue', ['me', 'kid']);
    expect(w.emitted('update:modelValue')).toEqual([[['me', 'kid']]]);
    expect(w.find('[data-testid="hint"]').exists()).toBe(false);
  });

  it('clears the hint when the host sets a valid selection (a reseeded, still-mounted modal)', async () => {
    const w = mountPicker();
    await w.findComponent(Chips).vm.$emit('update:modelValue', []);
    expect(w.find('[data-testid="hint"]').exists()).toBe(true);
    await w.setProps({ modelValue: ['kid'] });
    expect(w.find('[data-testid="hint"]').exists()).toBe(false);
  });

  it('keeps the hint when the host sets only removed members', async () => {
    const w = mountPicker();
    await w.findComponent(Chips).vm.$emit('update:modelValue', []);
    await w.setProps({ modelValue: ['gone'] });
    expect(w.find('[data-testid="hint"]').exists()).toBe(true);
  });
});
