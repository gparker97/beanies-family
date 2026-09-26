/**
 * FamilyStatusToast — the generic `dismissKey` / `route` branches (#109): ticking a
 * row with a dismiss key emits `dismiss`, tapping a row with a route emits
 * `open-route` and never falls through to `open-activity`.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import type { CriticalItem } from '@/composables/useCriticalItems';

const items = ref<CriticalItem[]>([]);
vi.mock('@/composables/useCriticalItems', () => ({
  CRITICAL_ITEMS_INITIAL_VISIBLE: 5,
  useCriticalItems: () => ({ criticalItems: items }),
}));

import FamilyStatusToast from '../FamilyStatusToast.vue';

beforeEach(() => {
  setActivePinia(createPinia());
  items.value = [
    {
      id: 'card-move:x',
      type: 'card',
      message: 'Laundry moved',
      icon: '🙋',
      time: '',
      completable: true,
      completed: false,
      dismissKey: 'card-move:x',
      route: { path: '/who-owns-what', query: { card: 'laundry' } },
    },
  ];
});

describe('FamilyStatusToast generic card rows', () => {
  it('the tick emits dismiss with the key, not a to-do completion', async () => {
    const wrapper = mount(FamilyStatusToast);
    await wrapper.get('.critical-item button').trigger('click');
    expect(wrapper.emitted('dismiss')).toEqual([['card-move:x']]);
    expect(wrapper.emitted('complete-todo')).toBeUndefined();
    expect(wrapper.emitted('open-route')).toBeUndefined();
  });

  it('a tap emits open-route and never open-activity', async () => {
    const wrapper = mount(FamilyStatusToast);
    await wrapper.get('.critical-item').trigger('click');
    expect(wrapper.emitted('open-route')).toEqual([
      [{ path: '/who-owns-what', query: { card: 'laundry' } }],
    ]);
    expect(wrapper.emitted('open-activity')).toBeUndefined();
  });
});
