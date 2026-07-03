/**
 * QuickAddFab visibility — the FAB hides when the member has no available
 * quick-add option (previously it always showed and opened an empty sheet).
 */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import QuickAddFab from '../QuickAddFab.vue';

const hideQuickAdd = ref(false);
const hasAnyQuickAddOption = ref(true);

vi.mock('vue-router', () => ({
  useRoute: () => ({
    meta: {
      get hideQuickAdd() {
        return hideQuickAdd.value;
      },
    },
  }),
}));
vi.mock('@/composables/useQuickAdd', () => ({
  useQuickAdd: () => ({ isOpen: ref(false), toggle: vi.fn() }),
}));
vi.mock('@/composables/useQuickAddAvailability', () => ({
  useQuickAddAvailability: () => ({ hasAnyQuickAddOption }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function mountFab() {
  return mount(QuickAddFab);
}

describe('QuickAddFab', () => {
  it('shows when the route allows and the member has an option', () => {
    hideQuickAdd.value = false;
    hasAnyQuickAddOption.value = true;
    expect(mountFab().find('button.fab').exists()).toBe(true);
  });

  it('hides when the member has no quick-add option', () => {
    hideQuickAdd.value = false;
    hasAnyQuickAddOption.value = false;
    expect(mountFab().find('button.fab').exists()).toBe(false);
  });

  it('hides on routes that opt out, even with options', () => {
    hideQuickAdd.value = true;
    hasAnyQuickAddOption.value = true;
    expect(mountFab().find('button.fab').exists()).toBe(false);
  });
});
