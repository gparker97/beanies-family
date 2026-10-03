/**
 * QuickAddFab visibility — the FAB hides when the member has no available
 * quick-add option (previously it always showed and opened an empty sheet).
 */
import { describe, it, expect, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import QuickAddFab from '../QuickAddFab.vue';

const hideQuickAdd = ref(false);
const hasAnyQuickAddOption = ref(true);
const isOpen = ref(false);

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
  useQuickAdd: () => ({ isOpen, toggle: vi.fn() }),
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

  it('names the surface it opens, for assistive tech (#119)', async () => {
    hideQuickAdd.value = false;
    hasAnyQuickAddOption.value = true;
    isOpen.value = false;
    const fab = mountFab().find('button.fab');
    // The surface is v-if'd, so a closed FAB must not point at an id that is not in the DOM.
    expect(fab.attributes('aria-controls')).toBeUndefined();
    expect(fab.attributes('aria-haspopup')).toBe('dialog');
    expect(fab.attributes('aria-label')).toBe('quickAdd.fab.label');

    isOpen.value = true;
    await nextTick();
    expect(fab.attributes('aria-controls')).toBe('quick-add-surface');
    isOpen.value = false;
  });
});
