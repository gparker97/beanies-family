import { describe, it, expect } from 'vitest';
import { matchInstanceForDate } from '../matchInstanceForDate';

describe('matchInstanceForDate', () => {
  it('matches a timed instance by the date slice of originalStartTime (offset-bearing, no tz math)', () => {
    const instances = [
      { id: 'a', originalStartTime: { dateTime: '2026-03-10T15:00:00+08:00' } },
      { id: 'b', originalStartTime: { dateTime: '2026-03-11T15:00:00+08:00' } },
      { id: 'c', originalStartTime: { dateTime: '2026-03-12T15:00:00+08:00' } },
    ];
    expect(matchInstanceForDate(instances, '2026-03-11')?.id).toBe('b');
  });

  it('matches an all-day instance by originalStartTime.date', () => {
    const instances = [{ id: 'x', originalStartTime: { date: '2026-03-11' } }];
    expect(matchInstanceForDate(instances, '2026-03-11')?.id).toBe('x');
  });

  it('matches a MOVED instance by originalStartTime, ignoring its moved start', () => {
    // A rescheduled instance: start moved to the 14th, but originalStartTime stays the 11th.
    const instances = [
      {
        id: 'moved',
        originalStartTime: { dateTime: '2026-03-11T15:00:00+08:00' },
        start: { dateTime: '2026-03-14T15:00:00+08:00' },
      },
    ];
    expect(matchInstanceForDate(instances, '2026-03-11')?.id).toBe('moved');
    expect(matchInstanceForDate(instances, '2026-03-14')).toBeNull(); // matched by original, not moved
  });

  it('falls back to start when originalStartTime is absent (unmodified instance)', () => {
    const instances = [{ id: 'virt', start: { dateTime: '2026-03-11T15:00:00+08:00' } }];
    expect(matchInstanceForDate(instances, '2026-03-11')?.id).toBe('virt');
  });

  it('handles a DST-boundary occurrence day by pure date string (no offset math)', () => {
    // US "spring forward" day — an offset shift on this date must not move the wall date.
    const instances = [{ id: 'dst', originalStartTime: { dateTime: '2026-03-08T02:30:00-05:00' } }];
    expect(matchInstanceForDate(instances, '2026-03-08')?.id).toBe('dst');
  });

  it('still matches even when a cancelled instance is present in the list', () => {
    const instances = [
      {
        id: 'cancelled',
        status: 'cancelled',
        originalStartTime: { dateTime: '2026-03-04T15:00:00+08:00' },
      },
      { id: 'target', originalStartTime: { dateTime: '2026-03-11T15:00:00+08:00' } },
    ];
    expect(matchInstanceForDate(instances, '2026-03-11')?.id).toBe('target');
  });

  it('returns null when no instance matches', () => {
    const instances = [{ id: 'a', originalStartTime: { date: '2026-03-04' } }];
    expect(matchInstanceForDate(instances, '2026-03-11')).toBeNull();
    expect(matchInstanceForDate([], '2026-03-11')).toBeNull();
  });
});
