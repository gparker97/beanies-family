import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  eventDateOf,
  isTimedContinuation,
  occurrenceKey,
  occurrenceWindow,
} from '@/utils/calendar/occurrence';

const night = {
  id: 'n',
  date: '2026-06-10',
  startTime: '22:00',
  endTime: '01:00',
} as FamilyActivity;
const trip = {
  id: 't',
  date: '2026-06-10',
  endDate: '2026-06-12',
  isAllDay: true,
} as FamilyActivity;

describe('occurrence helpers', () => {
  it('a timed tail draws from midnight and belongs to its start day', () => {
    const tail = { activity: night, date: '2026-06-11', repeatStart: '2026-06-10' };
    expect(isTimedContinuation(tail)).toBe(true);
    expect(occurrenceWindow(tail)).toEqual({ startTime: '00:00', endTime: '01:00' });
    expect(eventDateOf(tail)).toBe('2026-06-10');
  });

  it('the start day draws its own times on its own date', () => {
    const start = { activity: night, date: '2026-06-10', repeatStart: '2026-06-10' };
    expect(isTimedContinuation(start)).toBe(false);
    expect(occurrenceWindow(start)).toEqual({ startTime: '22:00', endTime: '01:00' });
    expect(eventDateOf(start)).toBe('2026-06-10');
  });

  it("an all-day trip's later day is a real day of its own", () => {
    const day2 = { activity: trip, date: '2026-06-11', repeatStart: '2026-06-10' };
    expect(isTimedContinuation(day2)).toBe(false);
    expect(eventDateOf(day2)).toBe('2026-06-11');
  });

  it('keys two cards of one activity on one date apart (a daily overnight series)', () => {
    const tail = { activity: night, date: '2026-06-11', repeatStart: '2026-06-10' };
    const start = { activity: night, date: '2026-06-11', repeatStart: '2026-06-11' };
    expect(occurrenceKey(tail)).not.toBe(occurrenceKey(start));
  });
});
