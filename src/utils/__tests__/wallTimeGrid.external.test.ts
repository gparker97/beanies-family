/**
 * The time grid's generic path, and the wall's view-only external items (plan
 * 2026-11-17, C4).
 *
 * `layoutTimeGrid` is generic over its item with a `spanOf` option, so the wall lays
 * out activities and view-only events in ONE call and lane packing stays in one place.
 * The guarantee that makes this safe: for activity-only input the wall's `spanOf`
 * (`wallGridSpan`) produces exactly the default output, at every height the ladder
 * distinguishes. `wallTimeGrid.test.ts` stays unchanged and still pins the default.
 */
import { describe, it, expect } from 'vitest';
import { layoutTimeGrid, type GridLayout } from '@/utils/wallTimeGrid';
import {
  isWallExternal,
  wallExternalItems,
  wallGridItemKey,
  wallGridSpan,
  type WallGridItem,
} from '@/utils/wallExternalEvents';
import { externalEvent } from '@/test/monthCellFixtures';
import type { WallOccurrence } from '@/utils/wallActivities';
import type { FamilyActivity } from '@/types/models';

const DAY = '2026-09-03';
/** A view-only event on the test day. */
const xev = (id: string, over: Parameters<typeof externalEvent>[1] = {}) =>
  externalEvent(id, { ymd: DAY, ...over });
let seq = 0;
function ev(startTime: string, endTime?: string, over: Partial<FamilyActivity> = {}) {
  return {
    activity: {
      id: `e${seq++}`,
      title: 'Thing',
      date: DAY,
      category: 'other',
      assigneeIds: [],
      startTime,
      endTime,
      createdAt: '',
      updatedAt: '',
      ...over,
    } as FamilyActivity,
    date: DAY,
  } satisfies WallOccurrence;
}

/** Everything but the `yFor` closure, which cannot be compared by value. */
function comparable<T>(layout: GridLayout<T>) {
  const { yFor, ...rest } = layout;
  return { ...rest, samples: [0, 420, 600, 900, 1200].map((m) => yFor(m)) };
}

describe('layoutTimeGrid generic path', () => {
  const days: WallOccurrence[][][] = [
    // A quiet day, a busy overlapping day, a week with a gap, an all-day + unreadable mix.
    [[ev('09:00', '10:00'), ev('11:00', '11:30')]],
    [[ev('07:30', '08:30'), ev('08:00', '09:00'), ev('08:15', '08:45'), ev('17:00', '19:00')]],
    [[ev('07:30', '08:00')], [ev('15:20', '15:50')], [], [ev('06:30', '07:00'), ev('21:00')]],
    [[ev('', '', { isAllDay: true }), ev('nonsense'), ev('12:00', '13:00')]],
  ];

  it('lays activity-only input out exactly as the default does, at every height', () => {
    for (const columns of days) {
      for (const height of [200, 320, 480, 900, 1500]) {
        const byDefault = layoutTimeGrid(columns, height);
        const generic = layoutTimeGrid<WallGridItem>(columns, height, { spanOf: wallGridSpan });
        expect(comparable(generic)).toEqual(comparable(byDefault));
      }
    }
  });

  it('packs an external that overlaps an activity into a second lane, side by side', () => {
    const activity = ev('15:00', '16:00');
    const external = wallExternalItems([xev('Bridge club', { start: '15:30', end: '17:00' })], DAY);
    const layout = layoutTimeGrid<WallGridItem>([[activity, ...external]], 480, {
      spanOf: wallGridSpan,
    });
    const blocks = layout.columns[0]!;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.lanes)).toEqual([2, 2]);
    expect(new Set(blocks.map((b) => b.lane))).toEqual(new Set([0, 1]));
    // Rule 3: a real overlap never displaces; both start at their own time.
    const [a, x] = [
      blocks.find((b) => !isWallExternal(b.occurrence))!,
      blocks.find((b) => isWallExternal(b.occurrence))!,
    ];
    expect(x.top).toBeGreaterThan(a.top);
    expect(
      x.laneOffset + x.laneWidth <= a.laneOffset || a.laneOffset + a.laneWidth <= x.laneOffset
    ).toBe(true);
  });

  it('two activities overlapping get the same two lanes, so the external packs like one', () => {
    const asExternal = layoutTimeGrid<WallGridItem>(
      [
        [
          ev('15:00', '16:00'),
          ...wallExternalItems([xev('x', { start: '15:30', end: '17:00' })], DAY),
        ],
      ],
      480,
      { spanOf: wallGridSpan }
    );
    const asActivity = layoutTimeGrid([[ev('15:00', '16:00'), ev('15:30', '17:00')]], 480);
    const geometry = (l: GridLayout<unknown>) =>
      l.columns[0]!.map(({ top, height, lane, lanes, laneOffset, laneWidth }) => ({
        top,
        height,
        lane,
        lanes,
        laneOffset,
        laneWidth,
      }));
    expect(geometry(asExternal)).toEqual(geometry(asActivity));
  });

  it('skips an all-day activity silently and still rejects an unreadable one', () => {
    const allDay = ev('', '', { isAllDay: true });
    const broken = ev('nonsense');
    const external = wallExternalItems([xev('Busy block', { start: '09:00' })], DAY);
    const layout = layoutTimeGrid<WallGridItem>([[allDay, broken, ...external]], 480, {
      spanOf: wallGridSpan,
    });
    expect(layout.columns[0]!.map((b) => b.occurrence)).toEqual(external);
    expect(layout.rejected.map((r) => r.occurrence)).toEqual([broken]);
  });
});

describe('wallExternalItems', () => {
  it('reads a timed event as minutes since the column day midnight', () => {
    const [item] = wallExternalItems([xev('a', { start: '15:00', end: '17:30' })], DAY);
    expect(item).toMatchObject({ kind: 'external', ymd: DAY, start: 900, end: 1050 });
  });

  it('skips all-day events: those reach the band through useDayExtras', () => {
    expect(wallExternalItems([xev('trip', { allDay: true })], DAY)).toEqual([]);
  });

  it('clamps an overnight event per day, the way the planner does', () => {
    const late = xev('late', { start: '22:00' });
    const overnight = {
      ...late,
      endMs: new Date('2026-09-04T02:00:00').getTime(),
      endYmd: '2026-09-04',
    };
    expect(wallExternalItems([overnight], DAY)[0]).toMatchObject({ start: 1320, end: 1440 });
    expect(wallExternalItems([overnight], '2026-09-04')[0]).toMatchObject({ start: 0, end: 120 });
  });

  it('gives a zero-length event a positive span, and drops non-finite instants', () => {
    const point = xev('ping', { start: '10:00', end: '10:00' });
    expect(wallExternalItems([point], DAY)[0]).toMatchObject({ start: 600, end: 601 });
    expect(wallExternalItems([{ ...point, startMs: Number.NaN }], DAY)).toEqual([]);
  });

  it('keys an external apart from an activity and from its own other days', () => {
    const e = xev('a');
    const [onDay] = wallExternalItems([e], DAY);
    expect(wallGridItemKey(onDay!)).toBe(`x:vc-1:a:${DAY}`);
    expect(wallGridItemKey(ev('09:00'))).toMatch(/^e\d+:2026-09-03$/);
  });
});
