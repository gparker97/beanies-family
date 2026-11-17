/**
 * View-only external events in the month pipeline (plan 2026-11-17, C2): timed ones join
 * the timeline by start time, all-day ones ride `extras`, and only the GRID's stack turns
 * the all-day ones into items. Caps never push the family's own plans behind "+N".
 */
import { describe, it, expect } from 'vitest';
import {
  byStartTime,
  capDayContents,
  dayCount,
  dayItems,
  gridDayItems,
  mergeTimeline,
} from '@/utils/monthDayItems';
import { assignMonthLayout } from '@/utils/monthGridLayout';
import { monthCells, prepareCellData } from '@/utils/monthCells';
import {
  cell,
  externalEvent,
  externalExtra,
  FIXTURE_DATE,
  holiday,
  itemIds,
  timed,
} from '@/test/monthCellFixtures';

describe('mergeTimeline with view-only events', () => {
  it('merges them by start time, after an activity at the same time', () => {
    const items = mergeTimeline(
      [timed('soccer', '16:00'), timed('piano', '15:00')],
      [],
      [externalEvent('bridge', { start: '15:00' }), externalEvent('early', { start: '09:00' })],
      FIXTURE_DATE
    );
    expect(itemIds(items)).toEqual([
      'external:early',
      'timed:piano',
      'external:bridge',
      'timed:soccer',
    ]);
  });

  it('places an overnight tail at 00:00 on the day after it started', () => {
    const next = '2026-05-20';
    const tail = externalEvent('night', {
      startMs: new Date(`${FIXTURE_DATE}T22:00:00`).getTime(),
      endMs: new Date(`${next}T03:00:00`).getTime(),
      endYmd: next,
    });
    const items = mergeTimeline([timed('swim', '07:00', next)], [], [tail], next);
    expect(itemIds(items)).toEqual(['external:night', 'timed:swim']);
  });
});

describe('a day with view-only events', () => {
  const allDayEvent = externalEvent('away', { allDay: true });
  const day = cell({
    timedOccurrences: [timed('piano', '15:00')],
    timedExternals: [externalEvent('bridge', { start: '14:00' })],
    extras: [holiday('Deepavali'), externalExtra(allDayEvent)],
  });

  it('counts both kinds once: all-day ones as extras, timed ones as items', () => {
    expect(itemIds(byStartTime(day))).toEqual(['external:bridge', 'timed:piano']);
    expect(itemIds(dayItems(day))).toEqual(['external:bridge', 'timed:piano']);
    expect(dayCount(day)).toBe(4);
  });

  it('the grid stack adds the all-day one before the timeline', () => {
    expect(itemIds(gridDayItems(day))).toEqual(['external:away', 'external:bridge', 'timed:piano']);
    const [layout] = assignMonthLayout([day]);
    expect(itemIds(layout!.stack)).toEqual(['external:away', 'external:bridge', 'timed:piano']);
    expect(layout!.lane).toBeNull();
  });

  it('caps: view-only events only take timed slots the activities leave free', () => {
    const busy = cell({
      timedOccurrences: [timed('a', '10:00'), timed('b', '11:00')],
      timedExternals: [externalEvent('x', { start: '09:00' })],
    });
    const capped = capDayContents(busy, { allDay: 2, timed: 2, segments: 1 });
    expect(itemIds(capped.timeline)).toEqual(['timed:a', 'timed:b']);
    expect(capped.hidden.timeline).toBe(1);

    const roomy = capDayContents(busy, { allDay: 2, timed: 3, segments: 1 });
    expect(itemIds(roomy.timeline)).toEqual(['external:x', 'timed:a', 'timed:b']);
    expect(roomy.hidden.timeline).toBe(0);
  });

  it('caps: an all-day view-only event shares the reference days’ half of the all-day lane', () => {
    const capped = capDayContents(day, { allDay: 2, timed: 3, segments: 1 });
    // No all-day activities, so both reference slots are free: holiday, then the view-only one.
    expect(capped.extras.map((e) => e.kind)).toEqual(['holiday', 'external']);
  });

  it('a day with nothing viewed is unchanged', () => {
    const plain = cell({ timedOccurrences: [timed('piano', '15:00')] });
    expect(itemIds(gridDayItems(plain))).toEqual(itemIds(dayItems(plain)));
  });
});

describe('monthCells with view-only events', () => {
  it('puts each timed event on the days it covers, inside the grid span only', () => {
    const e = externalEvent('bridge', { ymd: '2026-05-19', start: '15:00' });
    const away = externalEvent('away', { ymd: '2026-05-19', allDay: true });
    const result = monthCells({
      year: 2026,
      month: 4,
      weekStartDay: 0,
      todayStr: '2026-05-01',
      occurrences: [],
      segments: [],
      vacations: [],
      extras: [],
      externalsByDate: new Map([
        ['2026-05-19', [away, e]],
        ['2027-01-01', [externalEvent('far', { ymd: '2027-01-01' })]],
      ]),
    });
    const d19 = result.days.find((d) => d.date === '2026-05-19')!;
    expect(d19.timedExternals.map((x) => x.id)).toEqual(['bridge']);
    expect(result.days.every((d) => d.date === '2026-05-19' || d.timedExternals.length === 0)).toBe(
      true
    );
  });

  it('with no external input every cell has none', () => {
    const prepared = prepareCellData({
      occurrences: [],
      segments: [],
      vacations: [],
      extras: [],
      spanStart: '2026-05-01',
      spanEnd: '2026-05-31',
    });
    expect(prepared.externalTimed.size).toBe(0);
  });
});
