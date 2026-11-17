/**
 * Timed view-only events on the planner grids (plan 2026-11-17, C2): `externalCards`
 * clamps an event to each day like `timedCards` clamps an overnight activity, and the
 * shared packers (`groupOverlapping` + `assignLanes`) put an activity and an external
 * event that overlap side by side.
 */
import { describe, it, expect } from 'vitest';
import {
  assignLanes,
  externalCards,
  groupOverlapping,
  isExternalCard,
  type PlannerCard,
  type TimedFields,
} from '@/composables/useCalendarNavigation';
import { externalEvent } from '@/test/monthCellFixtures';

const DAY = '2026-11-17';
const NEXT = '2026-11-18';
const at = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00`).getTime();

describe('externalCards', () => {
  it('turns a timed event into a card with its local times and a unique key', () => {
    const e = externalEvent('Bridge club', { ymd: DAY, start: '15:00', end: '17:00' });
    const [card] = externalCards([e], DAY);
    expect(card).toMatchObject({
      startTime: '15:00',
      endTime: '17:00',
      isTail: false,
      external: e,
    });
    expect(card!.key).toBe(`external:vc-1:Bridge club:${DAY}`);
  });

  it('drops all-day events (they ride the all-day row)', () => {
    expect(externalCards([externalEvent('Away', { ymd: DAY, allDay: true })], DAY)).toEqual([]);
  });

  it('clamps an overnight event: the start day draws to midnight, the next day is a tail from 00:00', () => {
    const e = externalEvent('Night shift', {
      ymd: DAY,
      startMs: at(DAY, '22:00'),
      endMs: at(NEXT, '06:00'),
      endYmd: NEXT,
    });
    expect(externalCards([e], DAY)[0]).toMatchObject({
      startTime: '22:00',
      endTime: '24:00',
      isTail: false,
    });
    expect(externalCards([e], NEXT)[0]).toMatchObject({
      startTime: '00:00',
      endTime: '06:00',
      isTail: true,
    });
  });

  it('is told apart from an activity card', () => {
    const [card] = externalCards([externalEvent('x', { ymd: DAY })], DAY);
    expect(isExternalCard(card as PlannerCard)).toBe(true);
  });
});

describe('assignLanes', () => {
  const span = (startTime: string, endTime: string): TimedFields => ({ startTime, endTime });

  it('reuses a lane once it is free, and opens a new one for an overlap', () => {
    const { lanes, laneCount } = assignLanes([
      span('09:00', '11:00'),
      span('10:00', '12:00'),
      span('11:00', '12:00'),
    ]);
    expect(lanes).toEqual([0, 1, 0]);
    expect(laneCount).toBe(2);
  });

  it('gives an unreadable start its own lane rather than dropping it', () => {
    const { lanes, laneCount } = assignLanes([span('bad', ''), span('nope', '')]);
    expect(lanes).toEqual([0, 1]);
    expect(laneCount).toBe(2);
  });

  it('an activity overlapping an external block: one cluster, two lanes, side by side', () => {
    const activityCard = { startTime: '15:30', endTime: '16:30', key: 'a-1' };
    const [ext] = externalCards(
      [externalEvent('Bridge club', { ymd: DAY, start: '15:00', end: '17:00' })],
      DAY
    );
    const clusters = groupOverlapping<TimedFields & { key: string }>([activityCard, ext!]);
    expect(clusters).toHaveLength(1);
    const { lanes, laneCount } = assignLanes(clusters[0]!);
    expect(laneCount).toBe(2);
    expect(new Set(lanes)).toEqual(new Set([0, 1]));
  });
});
