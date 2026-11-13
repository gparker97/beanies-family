/**
 * The one chore clock (#146): device-local day and minute, re-evaluated on the minute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useChoreClock', () => {
  it('reads the local day and minute, and moves on the minute boundary', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 9, 0, 30));
    const { useChoreClock } = await import('../useChoreClock');
    const { choreClock } = useChoreClock();
    expect(choreClock.value).toEqual({ ymd: '2026-11-13', hhmm: '09:00' });
    await vi.advanceTimersByTimeAsync(30_000 + 60);
    expect(choreClock.value.hhmm).toBe('09:01');
  });

  it('rolls the day at midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 10));
    const { useChoreClock } = await import('../useChoreClock');
    const { choreClock } = useChoreClock();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(choreClock.value).toEqual({ ymd: '2026-11-14', hhmm: '00:00' });
  });

  it('is one shared clock', async () => {
    vi.setSystemTime(new Date(2026, 10, 13, 9, 0, 0));
    const { useChoreClock } = await import('../useChoreClock');
    expect(useChoreClock().choreClock).toBe(useChoreClock().choreClock);
  });
});
