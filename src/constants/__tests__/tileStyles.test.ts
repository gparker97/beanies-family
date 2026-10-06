import { describe, it, expect } from 'vitest';
import { CALENDAR_DAY_TINT, CALENDAR_TODAY, calendarDayBackground } from '../tileStyles';

const RESTING = 'resting-surface-class';

describe('calendarDayBackground', () => {
  it('lets a vacation tint win, even on today', () => {
    expect(calendarDayBackground('vacation', true, RESTING)).toBe(CALENDAR_DAY_TINT.vacation);
  });

  it('lets a holiday tint win, even on today', () => {
    expect(calendarDayBackground('holiday', true, RESTING)).toBe(CALENDAR_DAY_TINT.holiday);
  });

  it('paints the today wash on an untinted today', () => {
    expect(calendarDayBackground(undefined, true, RESTING)).toBe(CALENDAR_TODAY.wash);
  });

  it('falls back to the resting surface on an untinted ordinary day', () => {
    expect(calendarDayBackground(undefined, false, RESTING)).toBe(RESTING);
  });
});
