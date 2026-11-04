import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import CalendarCommandBar from '../CalendarCommandBar.vue';
import { publishedHeight } from '@/composables/usePublishedHeight';

// A tablet flips the Hide Times toggle off (times are always hidden there).
const tablet = ref(false);
vi.mock('@/composables/useBreakpoint', () => ({
  useBreakpoint: () => ({
    isMobile: ref(false),
    isTablet: tablet,
    isDesktop: ref(true),
  }),
}));

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

// The command bar reads syncStore.saveStatus to drive the hamburger's save cue.
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ saveStatus: 'saved' }),
}));

// Stub the composed children so we don't need their stores / overlays.
/**
 * The door renders its trigger through a slot and self-gates on permission, so an unstubbed
 * one renders nothing and takes the trigger with it. This stands in for it.
 */
const MagicBeansDoorStub = {
  name: 'MagicBeansDoor',
  props: ['claim'],
  template: '<div><slot name="trigger" :open="() => {}" /></div>',
};

const stubs = {
  MagicBeansDoor: MagicBeansDoorStub,
  HamburgerButton: {
    name: 'HamburgerButton',
    emits: ['click'],
    template: '<button class="stub-hamburger" @click="$emit(\'click\')" />',
  },
  SearchButton: { name: 'SearchButton', template: '<button class="stub-search" />' },
  NotificationsBell: { name: 'NotificationsBell', template: '<button class="stub-bell" />' },
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

function mountBar(
  extra: {
    note?: string;
    activeView?: 'month' | 'week' | 'day';
    monthPrefs?: object;
    timesRoom?: boolean;
  } = {},
  attach = false
) {
  const { monthPrefs, activeView, ...rest } = extra;
  return mount(CalendarCommandBar, {
    ...(attach ? { attachTo: document.body } : {}),
    props: {
      ...rest,
      label: 'May 2026',
      activeView: activeView ?? ('month' as const),
      canAdd: true,
      isAllActive: true,
      isMemberActive: () => false,
      activeMemberNames: [],
      monthPrefs: {
        density: 'compact' as const,
        times: 'shown' as const,
        soloFaces: 'shown' as const,
        phoneMode: 'grid' as const,
        phoneDensity: 'titles' as const,
        ...monthPrefs,
      },
    },
    global: { stubs },
  });
}

describe('CalendarCommandBar', () => {
  beforeEach(() => {
    reclaimed.value = false;
    tablet.value = false;
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

  it('renders the optional note as a caption, and nothing when absent', () => {
    expect(mountBar().find('p.text-xs').exists()).toBe(false);

    const w = mountBar({ note: 'Times are in Singapore Standard Time' });
    const note = w.find('p.text-xs');
    expect(note.text()).toBe('Times are in Singapore Standard Time');
    // Readable ink with a dark partner, no opacity modifier.
    expect(note.classes()).toEqual(
      expect.arrayContaining(['text-secondary-500', 'dark:text-ink-soft'])
    );
  });
});

describe('CalendarCommandBar month menu (#141)', () => {
  const mounted: VueWrapper[] = [];
  const bar = (...args: Parameters<typeof mountBar>) => {
    const w = mountBar(args[0], true);
    mounted.push(w);
    return w;
  };
  beforeEach(() => {
    reclaimed.value = false;
    tablet.value = false;
  });
  afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
  });

  const menuEl = () => document.body.querySelector<HTMLElement>('[role="menu"]');
  const row = (testid: string) =>
    document.body.querySelector<HTMLElement>(`[data-testid="${testid}"]`);

  async function openMenu(w: VueWrapper) {
    await w.get('[data-testid="month-density-menu"] button[aria-haspopup="menu"]').trigger('click');
    await nextTick();
  }

  it('shows the menu in Month on desktop only', () => {
    expect(bar().find('[data-testid="month-density-menu"]').exists()).toBe(true);
    expect(bar({ activeView: 'week' }).find('[data-testid="month-density-menu"]').exists()).toBe(
      false
    );
    expect(bar({ activeView: 'day' }).find('[data-testid="month-density-menu"]').exists()).toBe(
      false
    );
    reclaimed.value = true;
    expect(bar().find('[data-testid="month-density-menu"]').exists()).toBe(false);
  });

  it('offers Hide Times and Hide Faces on Solo Chips in Compact', async () => {
    const w = bar();
    await openMenu(w);
    expect(row('month-density-hide-times')).not.toBeNull();
    expect(row('month-density-hide-solo-faces')).not.toBeNull();
    expect(menuEl()!.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(2);
  });

  it('omits Hide Times in Comfortable, keeping the solo-faces toggle', async () => {
    const w = bar({ monthPrefs: { density: 'comfortable' } });
    await openMenu(w);
    expect(row('month-density-hide-times')).toBeNull();
    expect(row('month-density-hide-solo-faces')).not.toBeNull();
  });

  it('omits Hide Times in Compact when the cells have no room for times', async () => {
    const w = bar({ timesRoom: false });
    await openMenu(w);
    expect(row('month-density-hide-times')).toBeNull();
    expect(row('month-density-hide-solo-faces')).not.toBeNull();
  });

  it('keeps Hide Times in Compact when timesRoom is not reported', async () => {
    const w = bar();
    await openMenu(w);
    expect(row('month-density-hide-times')).not.toBeNull();
  });

  it('omits Hide Times on a tablet, where times are always hidden', async () => {
    tablet.value = true;
    const w = bar();
    await openMenu(w);
    expect(row('month-density-hide-times')).toBeNull();
    expect(row('month-density-hide-solo-faces')).not.toBeNull();
  });

  it('reflects the saved toggles as aria-checked', async () => {
    const w = bar({ monthPrefs: { times: 'hidden', soloFaces: 'shown' } });
    await openMenu(w);
    expect(row('month-density-hide-times')!.getAttribute('aria-checked')).toBe('true');
    expect(row('month-density-hide-solo-faces')!.getAttribute('aria-checked')).toBe('false');
  });

  it('emits set-month-pref for a density choice, via the menu', async () => {
    const w = bar();
    await openMenu(w);
    row('month-density-comfortable')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.emitted('set-month-pref')).toEqual([
      [{ name: 'density', value: 'comfortable' }, 'menu'],
    ]);
  });

  it('emits the flipped value for each toggle, and keeps the menu open', async () => {
    const w = bar();
    await openMenu(w);
    row('month-density-hide-times')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    row('month-density-hide-solo-faces')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.emitted('set-month-pref')).toEqual([
      [{ name: 'times', value: 'hidden' }, 'menu'],
      [{ name: 'soloFaces', value: 'hidden' }, 'menu'],
    ]);
    expect(menuEl()).not.toBeNull();
  });

  it('flips back from hidden to shown', async () => {
    const w = bar({ monthPrefs: { times: 'hidden', soloFaces: 'hidden' } });
    await openMenu(w);
    row('month-density-hide-times')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    expect(w.emitted('set-month-pref')![0]).toEqual([{ name: 'times', value: 'shown' }, 'menu']);
  });
});

describe('CalendarCommandBar published height', () => {
  it('still publishes --planner-cmdbar-h from the root offsetHeight', async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 96,
    });
    const w = mountBar({}, true);
    try {
      await nextTick();
      expect(document.documentElement.style.getPropertyValue('--planner-cmdbar-h')).toBe('96px');
      expect(publishedHeight('--planner-cmdbar-h')).toBe(96);
    } finally {
      w.unmount();
      if (desc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
    expect(document.documentElement.style.getPropertyValue('--planner-cmdbar-h')).toBe('');
  });
});

describe('CalendarCommandBar M pill (phone month mode)', () => {
  it('on phone, the M pill flip emits set-month-pref via m_pill with the other mode', () => {
    reclaimed.value = true;
    const w = mountBar();
    const toggle = w.findComponent({ name: 'ViewToggle' });
    expect(toggle.attributes('month-mode')).toBe('grid');
    toggle.vm.$emit('toggle-month-mode');
    expect(w.emitted('set-month-pref')).toEqual([[{ name: 'phoneMode', value: 'list' }, 'm_pill']]);
  });

  it('flips back from list to grid', () => {
    reclaimed.value = true;
    const w = mountBar({ monthPrefs: { phoneMode: 'list' } });
    w.findComponent({ name: 'ViewToggle' }).vm.$emit('toggle-month-mode');
    expect(w.emitted('set-month-pref')).toEqual([[{ name: 'phoneMode', value: 'grid' }, 'm_pill']]);
  });

  it('on desktop the toggle gets no monthMode, so the pill cannot flip the mode', () => {
    reclaimed.value = false;
    const w = mountBar();
    const attrs = w.findComponent({ name: 'ViewToggle' }).attributes();
    expect(attrs['month-mode']).toBeUndefined();
  });
});
