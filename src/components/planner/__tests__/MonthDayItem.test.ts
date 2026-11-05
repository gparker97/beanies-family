/**
 * `MonthDayItem` (#141): the one dispatcher from a `DayItem` to its chip.
 */
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'planner.moreEventsShort') return 'more';
      if (key === 'planner.moreEvents') return '{count} more activities';
      return key;
    },
    isBeanieMode: { value: false },
    isEnglish: { value: true },
  }),
}));

const MEMBERS = [member('m-aria', 'Aria'), member('m-bo', 'Bo')];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: MEMBERS, humans: MEMBERS }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string) => MEMBERS.find((m) => m.id === id),
    getMemberName: (id: string) => MEMBERS.find((m) => m.id === id)?.name ?? 'Unknown',
    getMemberColor: (id: string, fallback = '#6b7280') =>
      MEMBERS.find((m) => m.id === id)?.color ?? fallback,
  }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => {
  document.body.innerHTML = '';
});

import { ref } from 'vue';
import MonthDayItem from '../MonthDayItem.vue';
import { DEFAULT_CELL_CHIPS, MONTH_CELL_CHIPS } from '@/components/planner/monthCellChipsKey';
import { useActivityDragAttrs } from '@/composables/drag/useActivityDragAttrs';
import type { DayItem } from '@/utils/monthDayItems';
import { allDay, segment, timed, trip, FIXTURE_DATE } from '@/test/monthCellFixtures';

const timedItem = (id = 't1'): DayItem => ({ kind: 'timed', occurrence: timed(id) });
const allDayItem = (id = 'ad1'): DayItem => ({
  kind: 'allday',
  item: allDay(id),
  date: FIXTURE_DATE,
});
const tripItem = (id = 'trip1'): DayItem => ({ kind: 'trip', vacation: trip(id) });
const segmentItem = (id = 's1'): DayItem => ({ kind: 'segment', segment: segment(id) });

describe('MonthDayItem dispatch', () => {
  it.each([
    ['timed', timedItem(), 'month-chip'],
    ['segment', segmentItem(), 'month-segment-chip'],
    ['trip', tripItem(), 'trip-chip'],
    ['allday', allDayItem(), 'all-day-activity-chip'],
  ] as const)('a %s item renders its chip', (_kind, item, testid) => {
    const w = mount(MonthDayItem, { props: { item } });
    expect(w.attributes('data-testid')).toBe(testid);
  });

  it('renders exactly one root, so a parent class and attribute reach the chip', () => {
    for (const item of [timedItem(), segmentItem(), tripItem(), allDayItem()]) {
      const w = mount(MonthDayItem, {
        props: { item },
        attrs: { class: 'h-[var(--mg-chip-h)]', 'data-day-item': '' },
      });
      expect(w.classes()).toContain('h-[var(--mg-chip-h)]');
      expect(w.attributes('data-day-item')).toBeDefined();
    }
  });

  it('data-activity-id and data-occurrence-date land on timed and all-day roots', () => {
    const t = mount(MonthDayItem, { props: { item: timedItem('t9') } });
    expect(t.attributes('data-activity-id')).toBe('t9');
    expect(t.attributes('data-occurrence-date')).toBe(FIXTURE_DATE);
    const a = mount(MonthDayItem, { props: { item: allDayItem('ad9') } });
    expect(a.attributes('data-activity-id')).toBe('ad9');
    expect(a.attributes('data-occurrence-date')).toBe(FIXTURE_DATE);
  });

  it('has no reveal attributes on a trip or a segment', () => {
    expect(
      mount(MonthDayItem, { props: { item: tripItem() } }).attributes('data-activity-id')
    ).toBeUndefined();
    expect(
      mount(MonthDayItem, { props: { item: segmentItem() } }).attributes('data-activity-id')
    ).toBeUndefined();
  });

  it('run reaches the bar chips (rounding and label)', () => {
    const mid = { isStart: false, isEnd: false, showLabel: false };
    const trp = mount(MonthDayItem, { props: { item: tripItem(), run: mid } });
    expect(trp.classes()).not.toContain('rounded-l-md');
    expect(trp.text()).not.toContain('trip1');
    const ad = mount(MonthDayItem, { props: { item: allDayItem(), run: mid } });
    expect(ad.classes()).not.toContain('rounded-r-md');
    expect(ad.text()).not.toContain('ad1');
  });

  it('the default run is a standalone labelled bar', () => {
    const trp = mount(MonthDayItem, { props: { item: tripItem() } });
    expect(trp.classes()).toEqual(expect.arrayContaining(['rounded-l-md', 'rounded-r-md']));
    expect(trp.text()).toContain('trip1');
  });
});

describe('MonthDayItem emits', () => {
  it('forwards view-activity from a timed chip', async () => {
    const w = mount(MonthDayItem, { props: { item: timedItem('t1') } });
    await w.trigger('click');
    expect(w.emitted('view-activity')).toEqual([['t1', FIXTURE_DATE]]);
  });

  it('forwards view-activity from an all-day bar', async () => {
    const w = mount(MonthDayItem, { props: { item: allDayItem('ad1') } });
    await w.trigger('click');
    expect(w.emitted('view-activity')).toEqual([['ad1', FIXTURE_DATE]]);
  });

  it('forwards vacation-click from a trip', async () => {
    const w = mount(MonthDayItem, { props: { item: tripItem('trip1') } });
    await w.trigger('click');
    expect(w.emitted('vacation-click')).toEqual([['trip1']]);
  });

  it('forwards view-segment with the vacation id and index', async () => {
    const item: DayItem = {
      kind: 'segment',
      segment: segment('s1', { vacationId: 'v7', segmentIndex: 2 }),
    };
    const w = mount(MonthDayItem, { props: { item } });
    await w.trigger('click');
    expect(w.emitted('view-segment')).toEqual([['v7', 2]]);
  });

  it.each([
    ['timed', timedItem()],
    ['segment', segmentItem()],
    ['trip', tripItem()],
    ['allday', allDayItem()],
  ] as const)('a %s click does not propagate to a parent click listener', async (_k, item) => {
    const parent = vi.fn();
    const w = mount(
      {
        components: { MonthDayItem },
        setup: () => ({ item, parent }),
        template: '<div @click="parent"><MonthDayItem :item="item" /></div>',
      },
      {}
    );
    await w.get('button').trigger('click');
    expect(parent).not.toHaveBeenCalled();
  });
});

describe('MonthDayItem drag source (#142)', () => {
  const NOT_INTERACTIVE = {
    global: {
      provide: {
        [MONTH_CELL_CHIPS as symbol]: ref({ ...DEFAULT_CELL_CHIPS, interactive: false }),
      },
    },
  };

  it('the two activity chips carry the move source and the Space hint where they are controls', () => {
    for (const item of [timedItem(), allDayItem()]) {
      const w = mount(MonthDayItem, { props: { item } });
      expect(w.attributes('data-drag')).toBe('move');
      expect(w.attributes('aria-description')).toBe('planner.drag.a11y.dragHint');
    }
  });

  it("binds exactly the shared useActivityDragAttrs output (one definition of a source's attributes)", () => {
    const item = timedItem();
    const expected = useActivityDragAttrs()(
      (item as Extract<DayItem, { kind: 'timed' }>).occurrence.activity
    );
    const w = mount(MonthDayItem, { props: { item } });
    for (const [name, value] of Object.entries(expected)) {
      expect(w.attributes(name)).toBe(value);
    }
  });

  it('trips and segments never get a source', () => {
    for (const item of [tripItem(), segmentItem()]) {
      const w = mount(MonthDayItem, { props: { item } });
      expect(w.attributes('data-drag')).toBeUndefined();
      expect(w.attributes('aria-description')).toBeUndefined();
    }
  });

  it('inside a phone cell (not a control) no chip is a source', () => {
    for (const item of [timedItem(), allDayItem()]) {
      const w = mount(MonthDayItem, { props: { item }, ...NOT_INTERACTIVE });
      expect(w.attributes('data-drag')).toBeUndefined();
    }
  });

  it('a vacation-linked activity belongs to its trip and never lifts', () => {
    const occurrence = timed('t-trip');
    occurrence.activity = { ...occurrence.activity, vacationId: 'v1' };
    const w = mount(MonthDayItem, { props: { item: { kind: 'timed', occurrence } } });
    expect(w.attributes('data-drag')).toBeUndefined();
  });

  it('an interactive chip opts out of the long-press callout and text selection', () => {
    for (const item of [timedItem(), allDayItem()]) {
      expect(mount(MonthDayItem, { props: { item } }).classes()).toContain('select-none');
    }
  });
});
