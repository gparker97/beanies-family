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
const dismissItem = vi.fn(async () => true);
vi.mock('@/composables/useCriticalItems', () => ({
  CRITICAL_ITEMS_INITIAL_VISIBLE: 5,
  useCriticalItems: () => ({ criticalItems: items, dismissItem }),
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
      dismissKey: 'card-move:x',
      route: { path: '/who-owns-what', query: { card: 'laundry' } },
    },
  ];
});

describe('FamilyStatusToast generic card rows', () => {
  it('has no tick; its ✕ dismisses the row and never opens or completes anything', async () => {
    dismissItem.mockClear();
    const wrapper = mount(FamilyStatusToast);
    // The only nested button is the ✕ (the card row is not completable).
    expect(wrapper.findAll('.critical-item button')).toHaveLength(1);
    await wrapper.get('[data-testid="briefing-dismiss"]').trigger('click');
    expect(dismissItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'card-move:x' }),
      expect.any(Function) // the toast's tap target: this row's own route
    );
    expect(wrapper.emitted('complete-todo')).toBeUndefined();
    expect(wrapper.emitted('open-route')).toBeUndefined();
  });

  it('shows a ✕ on a hint row and on a plain row, and none on a row with no dismiss target', () => {
    items.value = [
      { id: 'h1', type: 'todo', message: 'hint', icon: '🎁', time: '', dismissHint: true },
      { id: 'a1', type: 'activity', message: 'swim', icon: '🏊', time: '09:00', dismissKey: 'k' },
      { id: 'x1', type: 'meal', message: 'meal', icon: '🍲', time: '' },
    ];
    const wrapper = mount(FamilyStatusToast);
    const rows = wrapper.findAll('.critical-item');
    expect(rows[0]!.find('[data-testid="briefing-dismiss"]').exists()).toBe(true);
    expect(rows[1]!.find('[data-testid="briefing-dismiss"]').exists()).toBe(true);
    expect(rows[2]!.find('[data-testid="briefing-dismiss"]').exists()).toBe(false);
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
