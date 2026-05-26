import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import WeekStripNav, { type WeekStripWeek } from '../WeekStripNav.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      // Surface keys verbatim so we can assert on them
      return key;
    },
  }),
}));

function makeDay(overrides: Partial<WeekStripWeek['days'][number]> = {}) {
  return {
    dateStr: '2026-05-19',
    dayNum: 19,
    dowLabel: 'tue',
    isToday: false,
    memberColors: [],
    moreCount: 0,
    ...overrides,
  };
}

function makeWeek(overrides: Partial<WeekStripWeek> = {}): WeekStripWeek {
  return {
    labelKey: 'planner.weekThis',
    isFocused: true,
    days: Array.from({ length: 7 }, (_, i) =>
      makeDay({ dateStr: `2026-05-${18 + i}`, dayNum: 18 + i })
    ),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WeekStripNav', () => {
  it('renders 7 day pills per week row', () => {
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [makeWeek()] },
    });
    // 7 pill buttons in the week (excluding the row label which is a div)
    expect(wrapper.findAll('button').length).toBe(7);
  });

  it('renders 2 weeks when 2 are passed', () => {
    const wrapper = mount(WeekStripNav, {
      props: {
        weeks: [
          makeWeek({ labelKey: 'planner.weekThis', isFocused: true }),
          makeWeek({ labelKey: 'planner.weekNext', isFocused: false }),
        ],
      },
    });
    // 14 day pills across the two rows (the peek toggle has no day aria-label)
    expect(wrapper.findAll('button[aria-label]').length).toBe(14);
    expect(wrapper.text()).toContain('planner.weekThis');
    expect(wrapper.text()).toContain('planner.weekNext');
  });

  it('collapsed → shows only the focused week, and the peek toggle emits', async () => {
    const wrapper = mount(WeekStripNav, {
      props: {
        collapsed: true,
        weeks: [
          makeWeek({ labelKey: 'planner.weekThis', isFocused: true }),
          makeWeek({ labelKey: 'planner.weekNext', isFocused: false }),
        ],
      },
    });
    // Only the focused (this) week's 7 day pills render when collapsed.
    expect(wrapper.findAll('button[aria-label]').length).toBe(7);
    expect(wrapper.text()).toContain('planner.weekThis');
    expect(wrapper.text()).not.toContain('planner.weekNext');
    // The peek toggle (the one button without a day aria-label) emits.
    const peek = wrapper.findAll('button').find((b) => !b.attributes('aria-label'));
    await peek!.trigger('click');
    expect(wrapper.emitted('toggle-peek')).toBeTruthy();
  });

  it('marks today with the primary-500 styling', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      makeDay({ dateStr: `2026-05-${18 + i}`, dayNum: 18 + i, isToday: i === 1 })
    );
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [{ ...makeWeek(), days }] },
    });
    const html = wrapper.html();
    expect(html).toContain('border-primary-500');
  });

  it('marks the focused week with the orange accent strip', () => {
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [makeWeek({ isFocused: true })] },
    });
    // Vertical accent bar is an orange span with bg-primary-500 inside the
    // focused-week label cell.
    expect(wrapper.html()).toContain('bg-primary-500');
  });

  it('emits select-date with the clicked day', async () => {
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [makeWeek()] },
    });
    const pills = wrapper.findAll('button');
    expect(pills.length).toBe(7);
    await pills[2]!.trigger('click');
    // 3rd day in the fixture is 2026-05-20
    expect(wrapper.emitted('select-date')).toEqual([['2026-05-20']]);
  });

  it('highlights selected-date with the filled-orange treatment (distinct from today)', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      // i=0 → may 18 (today), i=4 → may 22 (selected)
      makeDay({ dateStr: `2026-05-${18 + i}`, dayNum: 18 + i, isToday: i === 0 })
    );
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [{ ...makeWeek(), days }], selectedDate: '2026-05-22' },
    });
    const pills = wrapper.findAll('button');
    // Selected pill: filled orange + white text + shadow
    expect(pills[4]!.classes()).toContain('bg-primary-500');
    expect(pills[4]!.classes()).toContain('text-white');
    // Today pill: outline-only orange (no white text, no shadow)
    expect(pills[0]!.classes()).toContain('border-primary-500');
    expect(pills[0]!.classes()).not.toContain('text-white');
  });

  it('renders event-density dots when memberColors are present', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      makeDay({
        dateStr: `2026-05-${18 + i}`,
        dayNum: 18 + i,
        memberColors: i === 1 ? ['#6AA84F', '#F15D22'] : [],
      })
    );
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [{ ...makeWeek(), days }] },
    });
    // Look for inline style with one of the colors as backgroundColor
    const html = wrapper.html();
    expect(html.toLowerCase()).toContain('background-color: #6aa84f');
  });

  it('renders a "+N" overflow indicator when moreCount > 0', () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      makeDay({
        dateStr: `2026-05-${18 + i}`,
        dayNum: 18 + i,
        memberColors: ['#000', '#111', '#222'],
        moreCount: i === 1 ? 2 : 0,
      })
    );
    const wrapper = mount(WeekStripNav, {
      props: { weeks: [{ ...makeWeek(), days }] },
    });
    expect(wrapper.text()).toContain('+2');
  });

  it('renders nothing when weeks array is empty', () => {
    const wrapper = mount(WeekStripNav, { props: { weeks: [] } });
    expect(wrapper.findAll('button').length).toBe(0);
  });
});
