/**
 * The planner's time grid: what a card occupies, what it groups with, and how
 * tall the day is. Covers the three shapes the 2026-09-27 review found drawn
 * wrong: a short card over the next one, a zero-length pair, and an overnight
 * event (docs/plans/2026-09-27-calendar-time-grid-span-fixes.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: (e: unknown) => logEvent(e) }));

import {
  groupOverlapping,
  plannerExtent,
  timedCards,
  useTimeGrid,
} from '@/composables/useCalendarNavigation';
import type { FamilyActivity } from '@/types/models';

const at = (id: string, startTime?: string, endTime?: string) => ({ id, startTime, endTime });
const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((i) => i.id));

describe('plannerExtent', () => {
  it('floors a short card to the 24-minute minimum it is drawn at', () => {
    expect(plannerExtent(at('a', '09:00', '09:15'))).toEqual({ start: 540, end: 564 });
  });

  it('clamps an overnight card to midnight', () => {
    expect(plannerExtent(at('a', '22:00', '01:00'))).toEqual({ start: 1320, end: 1440 });
  });

  it('is null for an unreadable start', () => {
    expect(plannerExtent(at('a', 'junk', '10:00'))).toBeNull();
  });
});

describe('groupOverlapping', () => {
  it('⭐ groups a short card with the one it visually covers', () => {
    // 9:00-9:15 is drawn 24 minutes tall, over the top of 9:15-10:00.
    expect(ids(groupOverlapping([at('a', '09:00', '09:15'), at('b', '09:15', '10:00')]))).toEqual([
      ['a', 'b'],
    ]);
  });

  it('⭐ groups two zero-length events instead of hiding one', () => {
    expect(ids(groupOverlapping([at('a', '10:00', '10:00'), at('b', '10:00', '10:00')]))).toEqual([
      ['a', 'b'],
    ]);
  });

  it('⭐ groups a late event with an overnight one', () => {
    expect(ids(groupOverlapping([at('a', '22:00', '01:00'), at('b', '22:30', '23:00')]))).toEqual([
      ['a', 'b'],
    ]);
  });

  it('keeps touching cards that are both tall enough sequential', () => {
    expect(ids(groupOverlapping([at('a', '09:00', '10:00'), at('b', '10:00', '11:00')]))).toEqual([
      ['a'],
      ['b'],
    ]);
  });

  it('puts the longer of two same-start cards first (left)', () => {
    expect(
      ids(groupOverlapping([at('short', '09:00', '09:30'), at('long', '09:00', '11:00')]))
    ).toEqual([['long', 'short']]);
  });

  it('never drops unreadable starts: one shared group, after the rest, in input order', () => {
    const groups = groupOverlapping([at('x', 'junk'), at('a', '09:00', '10:00'), at('y', '99:99')]);
    expect(ids(groups)).toEqual([['a'], ['x', 'y']]);
  });

  it('treats a 24:00 start as unreadable instead of drawing it below the grid', () => {
    expect(plannerExtent(at('a', '24:00'))).toBeNull();
  });

  it('still skips items with no start at all (all-day)', () => {
    expect(groupOverlapping([at('a')])).toEqual([]);
  });
});

describe('useTimeGrid', () => {
  beforeEach(() => logEvent.mockClear());

  it('does not stretch the day to midnight for an overnight event', () => {
    const { timeRange } = useTimeGrid(ref([at('a', '22:00', '01:00')]), 'week');
    expect(timeRange.value).toEqual({ start: 6, end: 23 });
  });

  it('grows the day by the assumed hour of a late event with no end', () => {
    const { timeRange } = useTimeGrid(ref([at('a', '20:30')]), 'week');
    expect(timeRange.value.end).toBe(22);
  });

  it('ignores an unreadable time instead of poisoning the range', () => {
    const { timeRange } = useTimeGrid(ref([at('a', 'junk'), at('b', '09:00', '10:00')]), 'week');
    // Same as with 'b' alone (the default day, padded as before), not NaN.
    expect(timeRange.value).toEqual({ start: 6, end: 20 });
  });

  it('never draws a negative height, and clamps overnight at the grid bottom', () => {
    const { getPosition, timeRange } = useTimeGrid(ref([at('a', '22:00', '01:00')]), 'week');
    const { top, height } = getPosition('22:00', '01:00');
    expect(top).toBe(`${(22 - timeRange.value.start) * 3.75}rem`);
    expect(height).toBe(`${2 * 3.75}rem`);
  });

  it('returns rem strings for an unreadable start', () => {
    const { getPosition } = useTimeGrid(ref([]), 'week');
    expect(getPosition('junk')).toEqual({ top: '0rem', height: '1.5rem' });
  });

  it('reports overnight, bad starts and bad ends separately, tagged with the view', async () => {
    const items = ref([at('a', '22:00', '01:00'), at('b', 'junk'), at('c', '09:00', 'nope')]);
    useTimeGrid(items, 'day-lanes');
    await nextTick();
    const events = logEvent.mock.calls.map(([e]) => e as { message: string; context: object });
    expect(events.map((e) => e.message)).toEqual([
      'planner_grid_overnight_clamped',
      'planner_grid_unreadable_time',
      'planner_grid_unreadable_time',
    ]);
    expect(events[0]!.context).toMatchObject({ kind: 'day-lanes', count: 1 });
    expect(events[1]!.context).toMatchObject({ error_code: 'unreadable_time', stage: 'start' });
    expect(events[2]!.context).toMatchObject({ error_code: 'unreadable_time', stage: 'end' });

    // Same records again: deduped.
    items.value = [...items.value];
    await nextTick();
    expect(logEvent).toHaveBeenCalledTimes(3);

    // A DIFFERENT bad record with the same count is reported, not suppressed.
    items.value = [at('d', 'other-junk')];
    await nextTick();
    expect(logEvent).toHaveBeenCalledTimes(4);
  });
});

describe('timedCards', () => {
  const night = {
    id: 'n',
    date: '2026-06-10',
    startTime: '22:00',
    endTime: '01:00',
  } as FamilyActivity;

  it("⭐ draws a tail from midnight, keyed apart from the same day's start", () => {
    const cards = timedCards([
      { activity: night, date: '2026-06-11', repeatStart: '2026-06-10' },
      { activity: night, date: '2026-06-11', repeatStart: '2026-06-11' },
    ]);
    expect(cards.map((c) => [c.startTime, c.endTime, c.eventDate])).toEqual([
      ['00:00', '01:00', '2026-06-10'],
      ['22:00', '01:00', '2026-06-11'],
    ]);
    expect(new Set(cards.map((c) => c.key)).size).toBe(2);
    // They do not overlap on the grid, so they never split a column.
    expect(groupOverlapping(cards)).toHaveLength(2);
  });

  it('drops all-day occurrences', () => {
    const allDay = { id: 'a', date: '2026-06-10', isAllDay: true } as FamilyActivity;
    expect(timedCards([{ activity: allDay, date: '2026-06-10' }])).toEqual([]);
  });
});
