import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractionToActivityPrefill,
  inferActivityCategory,
  CATEGORY_KEYWORDS,
} from '../extractionToActivity';
import type { ExtractionResult } from '@/services/ai/types';
import { ACTIVITY_CATEGORIES } from '@/constants/activityCategories';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractionToActivityPrefill', () => {
  it('maps a full timed event to all corresponding fields (+ inferred category)', () => {
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
      // The model's overflow `description` routes to the activity's VISIBLE `notes` field.
      notes: 'Bring a gift',
      category: 'birthday',
    });
  });

  it('omits absent fields (empty strings) so ActivityModal defaults fill them', () => {
    expect(extractionToActivityPrefill(result())).toEqual({});
  });

  it('sets only the present fields for a partial extraction (no category match)', () => {
    const prefill = extractionToActivityPrefill(
      result({ title: 'Catch-up time', date: '2026-08-01' })
    );
    expect(prefill).toEqual({ title: 'Catch-up time', date: '2026-08-01' });
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

  it('never invents an id/createdBy/recurrence — recurrence is left to the modal', () => {
    const prefill = extractionToActivityPrefill(result({ title: 'X', date: '2026-01-01' }));
    expect(prefill).not.toHaveProperty('createdBy');
    expect(prefill).not.toHaveProperty('recurrence');
    expect(prefill).not.toHaveProperty('category'); // 'X' matches no keyword
  });
});

describe('inferActivityCategory', () => {
  it('uses the AI hint as the primary signal (hint beats the title)', () => {
    // The hint says dentist; the title would otherwise infer birthday — hint wins.
    const category = inferActivityCategory(
      result({ categoryHint: 'dentist appointment', title: "Mia's Birthday note" })
    );
    expect(category).toBe('dentist');
  });

  it('falls back to title + description when no hint is present', () => {
    expect(inferActivityCategory(result({ title: 'Swim Lesson' }))).toBe('swimming');
    expect(inferActivityCategory(result({ description: 'Annual school recital' }))).toBe(
      'school_recital'
    );
  });

  it('matches every term in a grouped-alternation pattern (word-bounded)', () => {
    expect(inferActivityCategory(result({ title: "Noah's Bat Mitzvah" }))).toBe('bar_mitzvah');
    expect(inferActivityCategory(result({ title: 'Bar Mitzvah celebration' }))).toBe('bar_mitzvah');
  });

  it('returns undefined when neither hint nor title/description matches', () => {
    expect(
      inferActivityCategory(result({ categoryHint: 'misc gathering', title: 'Catch-up' }))
    ).toBeUndefined();
  });

  it('uses the model-picked category id when it is a real category (beats hint + title)', () => {
    // The model returns a valid id; even a conflicting hint/title must not override it.
    const category = inferActivityCategory(
      result({ category: 'field_trip', categoryHint: 'birthday', title: 'Party time' })
    );
    expect(category).toBe('field_trip');
  });

  it('ignores an unknown model id (logs a warning) and falls back to keyword inference', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const category = inferActivityCategory(
      result({ category: 'not_a_real_id', categoryHint: 'dentist appointment' })
    );
    expect(category).toBe('dentist'); // fell back to the hint keyword
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('categorizes a "learning journey" (SG term) as a field trip via the keyword fallback', () => {
    expect(inferActivityCategory(result({ title: 'School Learning Journey to the Zoo' }))).toBe(
      'field_trip'
    );
    expect(inferActivityCategory(result({ categoryHint: 'school excursion' }))).toBe('field_trip');
  });
});

describe('CATEGORY_KEYWORDS integrity', () => {
  it('every mapped id is a real ACTIVITY_CATEGORIES entry', () => {
    const valid = new Set(ACTIVITY_CATEGORIES.map((c) => c.id));
    for (const [, id] of CATEGORY_KEYWORDS) {
      expect(valid.has(id)).toBe(true);
    }
  });
});
