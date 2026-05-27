import { mount } from '@vue/test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref, computed } from 'vue';
import CalendarCommandBar from '../CalendarCommandBar.vue';

// Drive the reclaim predicate + capture the menu toggle.
const reclaimed = ref(false);
const toggleMenu = vi.fn();
vi.mock('@/composables/useMobileMenu', () => ({
  useMobileMenu: () => ({ isOpen: ref(false), open: vi.fn(), close: vi.fn(), toggle: toggleMenu }),
  useHeaderReclaimed: () => computed(() => reclaimed.value),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Stub the composed children so we don't need their stores / overlays.
const stubs = {
  HamburgerButton: {
    name: 'HamburgerButton',
    emits: ['click'],
    template: '<button class="stub-hamburger" @click="$emit(\'click\')" />',
  },
  SearchButton: { name: 'SearchButton', template: '<button class="stub-search" />' },
  ViewToggle: { name: 'ViewToggle', template: '<div class="stub-viewtoggle" />' },
  MemberChipFilter: { name: 'MemberChipFilter', template: '<div class="stub-chipfilter" />' },
  MemberFilterMobileMenu: {
    name: 'MemberFilterMobileMenu',
    template: '<div class="stub-mobilefilter" />',
  },
  CalendarTripRibbon: {
    name: 'CalendarTripRibbon',
    props: { inline: Boolean },
    template: '<div class="stub-trip" :class="{ \'is-inline\': inline }" />',
  },
};

function mountBar() {
  return mount(CalendarCommandBar, {
    props: {
      label: 'May 2026',
      activeView: 'month' as const,
      canAdd: true,
      isAllActive: true,
      isMemberActive: () => false,
      activeMemberNames: [],
    },
    global: { stubs },
  });
}

describe('CalendarCommandBar', () => {
  beforeEach(() => {
    reclaimed.value = false;
    toggleMenu.mockClear();
  });

  it('mobile reclaim: shows hamburger + search + pinned mobile filter + inline trip chip, hides the desktop chip-filter row', () => {
    reclaimed.value = true;
    const w = mountBar();

    expect(w.find('.stub-hamburger').exists()).toBe(true);
    expect(w.find('.stub-search').exists()).toBe(true);
    expect(w.find('.stub-mobilefilter').exists()).toBe(true);

    const trip = w.find('.stub-trip');
    expect(trip.exists()).toBe(true);
    expect(trip.classes()).toContain('is-inline');

    // Desktop chip-filter row is not rendered on the reclaimed mobile bar.
    expect(w.find('.stub-chipfilter').exists()).toBe(false);
  });

  it('the reclaimed hamburger toggles the shared mobile menu', async () => {
    reclaimed.value = true;
    const w = mountBar();
    await w.find('.stub-hamburger').trigger('click');
    expect(toggleMenu).toHaveBeenCalledTimes(1);
  });

  it('desktop: no hamburger/search, keeps the desktop chip-filter row + the non-inline (own-row) trip ribbon', () => {
    reclaimed.value = false;
    const w = mountBar();

    expect(w.find('.stub-hamburger').exists()).toBe(false);
    expect(w.find('.stub-search').exists()).toBe(false);
    expect(w.find('.stub-chipfilter').exists()).toBe(true);

    const trip = w.find('.stub-trip');
    expect(trip.exists()).toBe(true);
    expect(trip.classes()).not.toContain('is-inline');
  });
});
