import { describe, it, expect } from 'vitest';
import { getDailyDoseStatus } from '../doseLimit';

describe('getDailyDoseStatus', () => {
  it('treats null/undefined dosesPerDay as limitless ("as needed")', () => {
    for (const dpd of [null, undefined]) {
      expect(getDailyDoseStatus(99, dpd)).toEqual({ limit: null, isOver: false, over: 0 });
    }
  });

  it('treats out-of-range / corrupt dosesPerDay as limitless (only 1–4 is a real limit)', () => {
    for (const dpd of [0, 5, 7, NaN, 2.5, -1]) {
      const s = getDailyDoseStatus(99, dpd);
      expect(s.limit).toBeNull();
      expect(s.isOver).toBe(false);
      expect(s.over).toBe(0);
    }
  });

  it('reports within-limit when count is at or below the limit', () => {
    expect(getDailyDoseStatus(2, 3)).toEqual({ limit: 3, isOver: false, over: 0 });
    expect(getDailyDoseStatus(3, 3)).toEqual({ limit: 3, isOver: false, over: 0 });
    expect(getDailyDoseStatus(0, 2)).toEqual({ limit: 2, isOver: false, over: 0 });
  });

  it('reports over-limit with the correct overage when count exceeds the limit', () => {
    expect(getDailyDoseStatus(4, 3)).toEqual({ limit: 3, isOver: true, over: 1 });
    expect(getDailyDoseStatus(6, 3)).toEqual({ limit: 3, isOver: true, over: 3 });
    expect(getDailyDoseStatus(2, 1)).toEqual({ limit: 1, isOver: true, over: 1 });
  });
});
