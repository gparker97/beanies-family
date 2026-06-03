import { describe, it, expect } from 'vitest';
import { extractionToActivityPrefill } from '../extractionToActivity';
import type { ExtractionResult } from '@/services/ai/types';

function result(overrides: Partial<ExtractionResult> = {}): ExtractionResult {
  return {
    isEvent: true,
    title: '',
    date: '',
    startTime: '',
    endTime: '',
    isAllDay: false,
    location: '',
    description: '',
    confidence: { title: 0, date: 0, startTime: 0, endTime: 0, location: 0 },
    ...overrides,
  };
}

describe('extractionToActivityPrefill', () => {
  it('maps a full timed event to all corresponding fields', () => {
    const prefill = extractionToActivityPrefill(
      result({
        title: "Mia's 6th Birthday",
        date: '2026-07-12',
        startTime: '14:00',
        endTime: '16:00',
        location: 'Sunshine Hall',
        description: 'Bring a gift',
      })
    );

    expect(prefill).toEqual({
      title: "Mia's 6th Birthday",
      date: '2026-07-12',
      startTime: '14:00',
      endTime: '16:00',
      location: 'Sunshine Hall',
      description: 'Bring a gift',
    });
  });

  it('omits absent fields (empty strings) so ActivityModal defaults fill them', () => {
    expect(extractionToActivityPrefill(result())).toEqual({});
  });

  it('sets only the present fields for a partial extraction', () => {
    const prefill = extractionToActivityPrefill(
      result({ title: 'Swim Lesson', date: '2026-08-01' })
    );
    expect(prefill).toEqual({ title: 'Swim Lesson', date: '2026-08-01' });
  });

  it('all-day event carries isAllDay and drops clock times', () => {
    const prefill = extractionToActivityPrefill(
      result({
        title: 'Sports Day',
        date: '2026-09-10',
        isAllDay: true,
        startTime: '09:00',
        endTime: '15:00',
      })
    );
    expect(prefill).toEqual({ title: 'Sports Day', date: '2026-09-10', isAllDay: true });
    expect(prefill.startTime).toBeUndefined();
    expect(prefill.endTime).toBeUndefined();
  });

  it('never invents an id/category/createdBy — only document-derived fields appear', () => {
    const prefill = extractionToActivityPrefill(result({ title: 'X', date: '2026-01-01' }));
    expect(prefill).not.toHaveProperty('category');
    expect(prefill).not.toHaveProperty('createdBy');
    expect(prefill).not.toHaveProperty('recurrence');
  });
});
