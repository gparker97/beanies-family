import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeAllDaySpans } from '../allDaySpans';
import type { FamilyActivity } from '@/types/models';

/**
 * Minimal FamilyActivity factory — we only care about the fields the span
 * computation reads. Other fields default to falsy/sensible values so
 * TypeScript is happy without us repeating boilerplate per test.
 */
function activity(
  overrides: Partial<FamilyActivity> & { id: string; date: string }
): FamilyActivity {
  return {
    title: `Activity ${overrides.id}`,
    category: 'sports',
    isActive: true,
    createdAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['createdAt'],
    updatedAt: '2026-05-01T00:00:00.000Z' as FamilyActivity['updatedAt'],
    recurrence: 'none',
    ...overrides,
  } as FamilyActivity;
}

const week = (): { dateStr: string }[] => [
  { dateStr: '2026-05-11' }, // Mon
  { dateStr: '2026-05-12' },
  { dateStr: '2026-05-13' },
  { dateStr: '2026-05-14' },
  { dateStr: '2026-05-15' },
  { dateStr: '2026-05-16' },
  { dateStr: '2026-05-17' }, // Sun
];

describe('computeAllDaySpans', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('buckets a single-day all-day activity by date; spans is empty', () => {
    const a = activity({ id: 'a1', date: '2026-05-13', isAllDay: true });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], week());

    expect(result.spans).toEqual([]);
    expect(result.singleByDate.get('2026-05-13')).toEqual([a]);
    expect(result.spanningIds.size).toBe(0);
  });

  it('produces one span entry for a 3-day all-day activity (deduped from 3 daily occurrences)', () => {
    const a = activity({
      id: 'a-multi',
      date: '2026-05-13',
      endDate: '2026-05-15',
      isAllDay: true,
    });
    // monthActivities() yields one occurrence per covered day for multi-day all-day
    const result = computeAllDaySpans(
      [
        { activity: a, date: '2026-05-13' },
        { activity: a, date: '2026-05-14' },
        { activity: a, date: '2026-05-15' },
      ],
      week()
    );

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toEqual({ activity: a, startCol: 2, span: 3 });
    expect(result.spanningIds.has('a-multi')).toBe(true);
    // Multi-day shouldn't bleed into singleByDate.
    expect(result.singleByDate.size).toBe(0);
  });

  it('clamps a multi-day activity that starts before the visible row', () => {
    const a = activity({
      id: 'a-clip-start',
      date: '2026-05-08', // Friday before the visible Mon-Sun row
      endDate: '2026-05-13', // Wed of the visible row
      isAllDay: true,
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], week());

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ startCol: 0, span: 3 }); // Mon-Wed
  });

  it('clamps a multi-day activity that extends past the visible row', () => {
    const a = activity({
      id: 'a-clip-end',
      date: '2026-05-15', // Fri of the visible row
      endDate: '2026-05-22', // outside the visible row
      isAllDay: true,
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-15' }], week());

    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]).toMatchObject({ startCol: 4, span: 3 }); // Fri-Sun
  });

  it('logs and skips an activity with endDate < startDate', () => {
    const a = activity({
      id: 'a-bad',
      date: '2026-05-15',
      endDate: '2026-05-13', // before date
      isAllDay: true,
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-15' }], week());

    expect(result.spans).toEqual([]);
    expect(result.singleByDate.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('a-bad'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid record'));
  });

  it('excludes timed activities (isAllDay falsy) from both buckets', () => {
    const a = activity({
      id: 'a-timed',
      date: '2026-05-13',
      startTime: '14:00',
      endTime: '15:00',
      // isAllDay omitted = falsy
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], week());

    expect(result.spans).toEqual([]);
    expect(result.singleByDate.size).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled(); // normal timed activity, no warn
  });

  it('logs and skips a timed activity with endDate set (hypothetical schema drift)', () => {
    const a = activity({
      id: 'a-drifted',
      date: '2026-05-13',
      endDate: '2026-05-14',
      // isAllDay NOT set — this is the schema-drift case
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], week());

    expect(result.spans).toEqual([]);
    expect(result.singleByDate.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('a-drifted'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Schema drift'));
  });

  it('returns empty buckets for empty input', () => {
    const result = computeAllDaySpans([], week());
    expect(result.spans).toEqual([]);
    expect(result.singleByDate.size).toBe(0);
    expect(result.spanningIds.size).toBe(0);
  });

  it('returns empty buckets when days is empty (no row to render)', () => {
    const a = activity({ id: 'a1', date: '2026-05-13', isAllDay: true });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], []);
    expect(result.spans).toEqual([]);
    expect(result.singleByDate.size).toBe(0);
  });

  it('treats endDate === startDate as single-day (no span)', () => {
    const a = activity({
      id: 'a-edge',
      date: '2026-05-13',
      endDate: '2026-05-13',
      isAllDay: true,
    });
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-13' }], week());

    expect(result.spans).toEqual([]);
    expect(result.singleByDate.get('2026-05-13')).toEqual([a]);
  });

  it('skips a multi-day activity whose entire range falls before the visible row', () => {
    const a = activity({
      id: 'a-pre',
      date: '2026-05-01',
      endDate: '2026-05-03',
      isAllDay: true,
    });
    // monthActivities wouldn't produce an occurrence in this week-row anyway,
    // but defend against the case where it did. Still no span emitted.
    const result = computeAllDaySpans([{ activity: a, date: '2026-05-03' }], week());

    expect(result.spans).toEqual([]);
  });

  it('handles two distinct multi-day activities in the same row', () => {
    const a = activity({
      id: 'first',
      date: '2026-05-11',
      endDate: '2026-05-12',
      isAllDay: true,
    });
    const b = activity({
      id: 'second',
      date: '2026-05-15',
      endDate: '2026-05-17',
      isAllDay: true,
    });
    const result = computeAllDaySpans(
      [
        { activity: a, date: '2026-05-11' },
        { activity: a, date: '2026-05-12' },
        { activity: b, date: '2026-05-15' },
        { activity: b, date: '2026-05-16' },
        { activity: b, date: '2026-05-17' },
      ],
      week()
    );

    expect(result.spans).toHaveLength(2);
    expect(result.spans[0]).toMatchObject({ startCol: 0, span: 2 });
    expect(result.spans[1]).toMatchObject({ startCol: 4, span: 3 });
    expect(result.spanningIds.size).toBe(2);
  });
});
