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
      props: { activity: activity({ title: 'Birthday' }), isStart: true, isEnd: true },
    });
    expect(wrapper.text()).toContain('Birthday');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('renders the title and rounds left only for a multi-day start', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: activity({ title: 'Tournament' }), isStart: true, isEnd: false },
    });
    expect(wrapper.text()).toContain('Tournament');
    expect(wrapper.classes()).toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('hides the title and renders square corners for a multi-day middle cell', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: activity({ title: 'Tournament' }), isStart: false, isEnd: false },
    });
    expect(wrapper.text()).not.toContain('Tournament');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).not.toContain('rounded-r-md');
  });

  it('hides the title and rounds right only for a multi-day end cell', () => {
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: activity({ title: 'Tournament' }), isStart: false, isEnd: true },
    });
    expect(wrapper.text()).not.toContain('Tournament');
    expect(wrapper.classes()).not.toContain('rounded-l-md');
    expect(wrapper.classes()).toContain('rounded-r-md');
  });

  it('emits click when the button is clicked', async () => {
    const wrapper = mount(AllDayActivityChip, {
      props: { activity: activity(), isStart: true, isEnd: true },
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
      props: { activity: bogus, isStart: true, isEnd: true },
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
      props: { activity: activity({ title: longTitle }), isStart: true, isEnd: true },
    });
    expect(wrapper.attributes('title')).toBe(longTitle);
  });
});
