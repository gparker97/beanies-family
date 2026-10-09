import { describe, expect, it } from 'vitest';
import { DEFAULT_WALL_SLEEP, isWithinNightHours, resolveWallSleep } from '@/utils/wallSleep';

describe('isWithinNightHours', () => {
  it('wraps past midnight when night starts later than it ends', () => {
    expect(isWithinNightHours('21:00', '21:00', '07:00')).toBe(true);
    expect(isWithinNightHours('23:59', '21:00', '07:00')).toBe(true);
    expect(isWithinNightHours('03:00', '21:00', '07:00')).toBe(true);
    expect(isWithinNightHours('07:00', '21:00', '07:00')).toBe(false);
    expect(isWithinNightHours('20:59', '21:00', '07:00')).toBe(false);
  });

  it('handles a window inside one day, and treats equal times as all day', () => {
    expect(isWithinNightHours('13:30', '13:00', '15:00')).toBe(true);
    expect(isWithinNightHours('15:00', '13:00', '15:00')).toBe(false);
    expect(isWithinNightHours('09:00', '22:00', '22:00')).toBe(true);
  });
});

describe('resolveWallSleep', () => {
  it('is on by default, 21:00 to 07:00 after 10 minutes', () => {
    expect(resolveWallSleep(undefined)).toEqual(DEFAULT_WALL_SLEEP);
  });

  it('keeps valid fields and falls back field by field on bad ones', () => {
    expect(
      resolveWallSleep({ enabled: false, startTime: '22:30', endTime: '25:00', idleMinutes: -4 })
    ).toEqual({ ...DEFAULT_WALL_SLEEP, enabled: false, startTime: '22:30' });
  });
});
