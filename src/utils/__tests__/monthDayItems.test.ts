import { describe, it, expect } from 'vitest';
import {
  allDayItems,
  byStartTime,
  capDayContents,
  dayCount,
  dayCountLabel,
  dayItemKey,
  dayItems,
} from '../monthDayItems';
import { STREAM_DAY_CAPS } from '@/constants/calendarCaps';
import {
  allDay,
  birthday,
  cell,
  holiday,
  itemIds,
  segment,
  timed,
  trip,
} from '@/test/monthCellFixtures';
import type { UIStringKey } from '@/services/translation/uiStrings';

// A stub translator: returns the key, with a {count} template for the two counts.
const t = (key: UIStringKey): string => {
  if (key === 'planner.dayRow.count.one') return '1 thing on';
  if (key === 'planner.dayRow.count.other') return '{count} things on';
  return key;
};

describe('dayItems order', () => {
  it('is trips, then all-day, then the timeline by start time (untimed last)', () => {
    const c = cell({
      vacations: [trip('t1')],
      allDayItems: [allDay('ad1')],
      timedOccurrences: [timed('late', '17:00'), timed('none', null), timed('early', '08:00')],
      segments: [segment('s1', { time: '12:00' })],
    });
    expect(itemIds(dayItems(c))).toEqual([
      'trip:t1',
      'allday:ad1',
      'timed:early',
      'segment:s1-departure',
      'timed:late',
      'timed:none',
    ]);
  });

  it('allDayItems is trips then all-day activities', () => {
    const c = cell({ vacations: [trip('t1'), trip('t2')], allDayItems: [allDay('ad1')] });
    expect(itemIds(allDayItems(c))).toEqual(['trip:t1', 'trip:t2', 'allday:ad1']);
  });

  it('is empty for an empty day', () => {
    expect(dayItems(cell())).toEqual([]);
  });
});

describe('byStartTime', () => {
  it('interleaves timed activities and segments by time', () => {
    const c = cell({
      timedOccurrences: [timed('a', '10:00'), timed('c', '14:00')],
      segments: [segment('s', { time: '12:00' })],
    });
    expect(itemIds(byStartTime(c))).toEqual(['timed:a', 'segment:s-departure', 'timed:c']);
  });

  it('keeps input order on ties (timed before segments)', () => {
    const c = cell({
      timedOccurrences: [timed('a', '10:00'), timed('b', '10:00')],
      segments: [segment('s', { time: '10:00' })],
    });
    expect(itemIds(byStartTime(c))).toEqual(['timed:a', 'timed:b', 'segment:s-departure']);
  });

  it('puts untimed items of both kinds last, keeping their order', () => {
    const c = cell({
      timedOccurrences: [timed('u1', null), timed('t', '09:00')],
      segments: [segment('su', { time: undefined })],
    });
    expect(itemIds(byStartTime(c))).toEqual(['timed:t', 'timed:u1', 'segment:su-departure']);
  });
});

describe('dayItemKey', () => {
  it('follows the key rule per kind', () => {
    expect(dayItemKey({ kind: 'trip', vacation: trip('v') })).toBe('trip:v');
    expect(dayItemKey({ kind: 'allday', item: allDay('x'), date: '2026-05-19' })).toBe(
      'allday:x:2026-05-19'
    );
    expect(dayItemKey({ kind: 'timed', occurrence: timed('x', '09:00') })).toBe(
      'timed:x:2026-05-19'
    );
    expect(dayItemKey({ kind: 'segment', segment: segment('sg', { kind: 'arrival' }) })).toBe(
      'segment:sg-arrival'
    );
  });

  it('is unique within a day, even when ids repeat across kinds and both ends of a segment', () => {
    const c = cell({
      vacations: [trip('same')],
      allDayItems: [allDay('same')],
      timedOccurrences: [timed('same', '09:00')],
      segments: [segment('same', { kind: 'departure' }), segment('same', { kind: 'arrival' })],
    });
    const keys = dayItems(c).map(dayItemKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('dayCount and dayCountLabel', () => {
  it('counts extras plus items; 0 for an empty day', () => {
    expect(dayCount(cell())).toBe(0);
    expect(
      dayCount(
        cell({
          extras: [birthday(), holiday()],
          vacations: [trip('t')],
          allDayItems: [allDay('a')],
          timedOccurrences: [timed('x')],
          segments: [segment('s')],
        })
      )
    ).toBe(6);
  });

  it('labels zero as nothing planned', () => {
    expect(dayCountLabel(cell(), t)).toBe('planner.nothingPlanned');
  });

  it('labels one, counting an extra', () => {
    expect(dayCountLabel(cell({ extras: [holiday()] }), t)).toBe('1 thing on');
  });

  it('labels many with the count filled in', () => {
    const c = cell({ extras: [birthday()], timedOccurrences: [timed('a'), timed('b')] });
    expect(dayCountLabel(c, t)).toBe('3 things on');
  });
});

describe('capDayContents with no caps', () => {
  it('returns everything and hides nothing', () => {
    const c = cell({
      extras: [birthday(), holiday()],
      vacations: [trip('t')],
      allDayItems: [allDay('a1'), allDay('a2'), allDay('a3')],
      timedOccurrences: Array.from({ length: 7 }, (_, i) => timed(`x${i}`, `0${i}:00`)),
      segments: [segment('s1'), segment('s2'), segment('s3')],
    });
    const out = capDayContents(c);
    expect(out.extras).toHaveLength(2);
    expect(out.allDay).toHaveLength(4);
    expect(out.timeline).toHaveLength(10);
    expect(out.hidden).toEqual({ allDay: 0, timeline: 0 });
  });
});

describe('capDayContents with STREAM_DAY_CAPS', () => {
  const caps = STREAM_DAY_CAPS;

  it('leaves the family an event when the day carries a birthday AND a holiday', () => {
    const out = capDayContents(
      cell({ extras: [birthday(), holiday()], allDayItems: [allDay('bin')] }),
      caps
    );
    expect(out.extras.map((e) => e.kind)).toEqual(['birthday']);
    expect(itemIds(out.allDay)).toEqual(['allday:bin']);
    expect(out.hidden.allDay).toBe(1);
  });

  it('shows both reference days when there are no events of its own', () => {
    const out = capDayContents(cell({ extras: [birthday(), holiday()] }), caps);
    expect(out.extras.map((e) => e.kind)).toEqual(['birthday', 'holiday']);
    expect(out.hidden.allDay).toBe(0);
  });

  it('behaves as before on a day with no reference days', () => {
    const out = capDayContents(
      cell({ allDayItems: [allDay('a1'), allDay('a2'), allDay('a3')] }),
      caps
    );
    expect(out.extras).toEqual([]);
    expect(itemIds(out.allDay)).toEqual(['allday:a1', 'allday:a2']);
    expect(out.hidden.allDay).toBe(1);
  });

  it('caps timed activities at caps.timed', () => {
    const out = capDayContents(
      cell({ timedOccurrences: Array.from({ length: 6 }, (_, i) => timed(`x${i}`, `0${i}:00`)) }),
      caps
    );
    expect(out.timeline).toHaveLength(4);
    expect(out.hidden.timeline).toBe(2);
  });

  it('caps segments at 2', () => {
    const out = capDayContents(
      cell({ segments: [segment('s1'), segment('s2'), segment('s3'), segment('s4')] }),
      caps
    );
    expect(out.timeline).toHaveLength(2);
    expect(out.hidden.timeline).toBe(2);
  });

  it('hidden.timeline is hidden timed plus hidden segments', () => {
    const out = capDayContents(
      cell({
        timedOccurrences: Array.from({ length: 5 }, (_, i) => timed(`x${i}`, `1${i}:00`)),
        segments: [segment('s1'), segment('s2'), segment('s3')],
      }),
      caps
    );
    expect(out.timeline).toHaveLength(6);
    expect(out.hidden.timeline).toBe(2);
  });

  it('never caps trips', () => {
    const out = capDayContents(
      cell({
        vacations: [trip('t1'), trip('t2'), trip('t3')],
        allDayItems: [allDay('a1'), allDay('a2'), allDay('a3')],
      }),
      caps
    );
    expect(itemIds(out.allDay).filter((i) => i.startsWith('trip:'))).toHaveLength(3);
  });

  it('preserves day order after capping, so a cap never reorders a day', () => {
    const c = cell({
      timedOccurrences: [
        timed('t1', '08:00'),
        timed('t2', '09:00'),
        timed('t3', '11:00'),
        timed('t4', '13:00'),
        timed('t5', '15:00'),
      ],
      segments: [segment('s1', { time: '10:00' }), segment('s2', { time: '12:00' })],
    });
    const out = capDayContents(c, caps);
    const times = out.timeline.map((i) =>
      i.kind === 'timed'
        ? i.occurrence.activity.startTime
        : i.kind === 'segment'
          ? i.segment.time
          : ''
    );
    expect(times).toEqual([...times].sort());
    expect(itemIds(out.timeline)).toEqual([
      'timed:t1',
      'timed:t2',
      'segment:s1-departure',
      'timed:t3',
      'segment:s2-departure',
      'timed:t4',
    ]);
  });
});
