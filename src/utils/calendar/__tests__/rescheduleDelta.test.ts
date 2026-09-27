import { describe, it, expect } from 'vitest';
import { rescheduleDelta } from '../rescheduleDelta';

describe('rescheduleDelta', () => {
  const base = { date: '2026-05-01', endDate: '2026-05-03' };

  it('⭐ keeps the end shown on screen when an all-day start moves', () => {
    // Fri-Sun moved to Saturday, end left on Sunday: Sat-Sun, not Sat-Mon.
    expect(rescheduleDelta(base, { date: '2026-05-02', endDate: '2026-05-03' }, true)).toEqual({
      date: '2026-05-02',
      endDate: '2026-05-03',
    });
  });

  it('sends only what changed when the start stays put', () => {
    expect(rescheduleDelta(base, { date: '2026-05-01', endDate: '2026-05-04' }, true)).toEqual({
      endDate: '2026-05-04',
    });
  });

  it('leaves a timed reschedule to the plain diff', () => {
    const timedBase = { date: '2026-05-01', startTime: '09:00', endTime: '10:00' };
    expect(
      rescheduleDelta(
        timedBase,
        { date: '2026-05-02', startTime: '09:00', endTime: '10:00' },
        false
      )
    ).toEqual({ date: '2026-05-02' });
  });
});
