import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import AllDayActivityChip from '../AllDayActivityChip.vue';
import type { FamilyActivity } from '@/types/models';

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: "Beau's birthday",
    date: '2026-05-13',
    category: 'sports',
    isActive: true,
    isAllDay: true,
    createdAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['createdAt'],
    updatedAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['updatedAt'],
    recurrence: 'none',
    ...overrides,
  } as FamilyActivity;
}

describe('AllDayActivityChip', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // PhotoIndicator (now embedded in the chip) reaches into the
    // translation store, so the test environment needs an active Pinia.
    setActivePinia(createPinia());
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('renders the title for a single-day chip (isStart && isEnd)', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Birthday' }),
        date: '2026-05-13',
        isStart: true,
        isEnd: true,
      },
    });
    expect(wrapper.text()).toContain('Birthday');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('renders the title and rounds left only for a multi-day start', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Tournament' }),
        date: '2026-05-13',
        isStart: true,
        isEnd: false,
      },
    });
    expect(wrapper.text()).toContain('Tournament');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('hides the title and renders square corners for a multi-day middle cell', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Tournament' }),
        date: '2026-05-13',
        isStart: false,
        isEnd: false,
      },
    });
    expect(wrapper.text()).not.toContain('Tournament');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('hides the title and rounds right only for a multi-day end cell', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Tournament' }),
        date: '2026-05-13',
        isStart: false,
        isEnd: true,
      },
    });
    expect(wrapper.text()).not.toContain('Tournament');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('emits click when the button is clicked', async () => {
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: activity(), date: '2026-05-13', isStart: true, isEnd: true },
    });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('falls back to neutral grey when the owner has no usable colour', () => {
    // Rewritten 2026-09-02. This used to exercise `getActivityColor`'s category-colour
    // fallback and asserted only that the chip rendered at all — it could not fail.
    // Hue now means WHOSE, so the case that matters is a member whose stored colour is
    // blank: previously that produced a transparent chip, because every call site used
    // `?? fallback`, which passes an empty string straight through.
    const bogus = activity({
      color: undefined as unknown as FamilyActivity['color'],
      category: '__missing_category__' as FamilyActivity['category'],
    });
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: bogus, date: '2026-05-13', isStart: true, isEnd: true },
    });
    const chip = wrapper.find('[data-testid="all-day-activity-chip"]');
    expect(chip.exists()).toBe(true);
    // Never empty, never transparent — a colour always resolves to something visible.
    expect(wrapper.findComponent({ name: 'AllDayChip' }).props('color')).toBeTruthy();
  });

  it('renders the photo indicator on the title cell when activity has photos', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Trip', photoIds: ['p-1', 'p-2'] }),
        date: '2026-05-13',
        isStart: true,
        isEnd: false,
      },
    });
    expect(wrapper.text()).toContain('📷');
  });

  it('does not render the photo indicator when activity has no photos', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'No-photos', photoIds: [] }),
        date: '2026-05-13',
        isStart: true,
        isEnd: true,
      },
    });
    expect(wrapper.text()).not.toContain('📷');
  });

  it('does not render the photo indicator on multi-day middle/end cells (no title cell)', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: 'Spans', photoIds: ['p-1'] }),
        date: '2026-05-13',
        isStart: false,
        isEnd: true,
      },
    });
    expect(wrapper.text()).not.toContain('📷');
    expect(wrapper.text()).not.toContain('Spans');
  });

  it('keeps the chip clickable on the title attribute (full title even when truncated)', () => {
    const longTitle = 'A very long activity title that will definitely truncate in a calendar cell';
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({ title: longTitle }),
        date: '2026-05-13',
        isStart: true,
        isEnd: true,
      },
    });
    expect(wrapper.attributes('title')).toBe(longTitle);
  });

  it("names an occasion's milestone for the chip's own date", () => {
    const wrapper = mount(AllDayActivityChip, {
      props: {
        activity: activity({
          title: "Uncle Bob's birthday",
          category: 'occasion_birthday',
          occasionYear: 1966,
        }),
        date: '2026-05-13',
        isStart: true,
        isEnd: true,
      },
    });
    expect(wrapper.text()).toContain("Uncle Bob's birthday (turns 60)");
    expect(wrapper.attributes('title')).toBe("Uncle Bob's birthday (turns 60)");
  });
});

describe('AllDayActivityChip month grid options (#141)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const props = { activity: activity(), date: '2026-05-13', isStart: true, isEnd: true };
  const inner = (w: ReturnType<typeof mount>) => w.findComponent({ name: 'AllDayChip' });

  it('faces are off by default (the week view is unchanged)', () => {
    expect(inner(mount(AllDayActivityChip, { props })).props('faces')).toBeUndefined();
  });

  it('withFaces passes the identity stack members and the solo flag', () => {
    const w = mount(AllDayActivityChip, { props: { ...props, withFaces: true } });
    expect(Array.isArray(inner(w).props('faces'))).toBe(true);
    expect(typeof inner(w).props('solo')).toBe('boolean');
  });

  it('draws neutral ink on every surface, not the owner hue', () => {
    expect(inner(mount(AllDayActivityChip, { props })).props('ink')).toBe('var(--color-text)');
  });

  it('takes the theme-aware flat wash from identity, never a hue-suffixed alpha', () => {
    const w = mount(AllDayActivityChip, { props });
    const bg = String(inner(w).props('bgColor'));
    expect(bg).toBeTruthy();
    expect(bg).not.toContain('gradient');
    // The old `${color}22` hex-alpha wash had no dark partner.
    expect(bg).not.toMatch(/^#[0-9a-f]{6}22$/i);
  });

  it('the flat wash is theme-aware: light alpha, then the deeper dark alpha', () => {
    const light = String(inner(mount(AllDayActivityChip, { props })).props('bgColor'));
    expect(light).toMatch(/^rgba\(\d+, \d+, \d+, 0\.13\)$/);
    document.documentElement.classList.add('dark');
    try {
      const dark = String(inner(mount(AllDayActivityChip, { props })).props('bgColor'));
      expect(dark).toMatch(/^rgba\(\d+, \d+, \d+, 0\.24\)$/);
    } finally {
      document.documentElement.classList.remove('dark');
    }
  });

  it('showLabel passes through, and unset still follows isStart', () => {
    expect(
      mount(AllDayActivityChip, { props: { ...props, isStart: false, isEnd: false } }).text()
    ).not.toContain("Beau's birthday");
    expect(
      mount(AllDayActivityChip, {
        props: { ...props, isStart: false, isEnd: false, showLabel: true },
      }).text()
    ).toContain("Beau's birthday");
  });
});
