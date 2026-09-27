import { describe, it, expect } from 'vitest';
import { clusterOverlapping, MINUTES_PER_DAY, timedSpanMinutes } from '@/utils/calendar/timeSpans';

describe('timedSpanMinutes', () => {
  it('reads a normal span', () => {
    expect(timedSpanMinutes('09:00', '10:30', 60)).toEqual({
      start: 540,
      end: 630,
      overnight: false,
      endUnreadable: false,
    });
  });

  it('assumes the caller-supplied duration when there is no end', () => {
    expect(timedSpanMinutes('09:00', undefined, 60)!.end).toBe(600);
    expect(timedSpanMinutes('09:00', undefined, 90)!.end).toBe(630);
  });

  it('flags an unreadable end instead of falling back silently', () => {
    const span = timedSpanMinutes('09:00', 'nope', 60)!;
    expect(span.end).toBe(600);
    expect(span.endUnreadable).toBe(true);
  });

  it('returns null for an unreadable start', () => {
    expect(timedSpanMinutes('abc', '10:00', 60)).toBeNull();
    expect(timedSpanMinutes(undefined, '10:00', 60)).toBeNull();
  });

  it('treats equal times as zero-length, not overnight', () => {
    expect(timedSpanMinutes('10:00', '10:00', 60)).toMatchObject({
      start: 600,
      end: 600,
      overnight: false,
    });
  });

  it('carries an overnight end (strictly before the start) past midnight', () => {
    expect(timedSpanMinutes('22:00', '01:00', 60)).toMatchObject({
      start: 1320,
      end: 1500,
      overnight: true,
    });
  });

  it('accepts 24:00 as the end of the day', () => {
    expect(timedSpanMinutes('24:00', undefined, 60)!.start).toBe(MINUTES_PER_DAY);
    expect(timedSpanMinutes('23:00', '24:00', 60)).toMatchObject({ end: 1440, overnight: false });
  });
});

describe('clusterOverlapping', () => {
  it('handles disjoint, touching, nested, identical, unsorted and empty', () => {
    expect(clusterOverlapping([])).toEqual([]);
    expect(
      clusterOverlapping([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ])
    ).toHaveLength(2);
    expect(
      clusterOverlapping([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ])
    ).toHaveLength(2);
    expect(
      clusterOverlapping([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
      ])
    ).toHaveLength(1);
    expect(
      clusterOverlapping([
        { start: 5, end: 9 },
        { start: 5, end: 9 },
      ])
    ).toHaveLength(1);
    // Unsorted input must not change the answer.
    expect(
      clusterOverlapping([
        { start: 20, end: 30 },
        { start: 0, end: 10 },
      ])
    ).toHaveLength(2);
  });

  it('orders a cluster by start, then longest first', () => {
    const [cluster] = clusterOverlapping([
      { id: 'short', start: 0, end: 30 },
      { id: 'long', start: 0, end: 90 },
    ]);
    expect(cluster!.map((c) => c.id)).toEqual(['long', 'short']);
  });
});
