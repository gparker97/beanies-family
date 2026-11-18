import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractionToActivityPrefill, inferActivityCategory } from '../extractionToActivity';
import type { ExtractionResult } from '@/services/ai/types';
import { logEvent } from '@/services/telemetry/logEvent';

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

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

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

/**
 * The keyword table AI capture used to keep (`CATEGORY_KEYWORDS`, 29 regexes) now lives on each
 * category's own definition and is read through `suggestActivityCategory`. One phrase per old
 * row, so nothing the capture path recognised is lost. Its regex prefixes (`swim\w*`,
 * `optometr\w*`, `after[- ]school`) became explicit forms, each pinned here.
 */
describe('inferActivityCategory: the ported keyword table', () => {
  it.each([
    ['Birthday party', 'birthday'],
    ['Wedding', 'wedding'],
    ['Bar Mitzvah', 'bar_mitzvah'],
    ['Bat Mitzvah', 'bar_mitzvah'],
    ['Piano recital', 'school_recital'],
    ['Award ceremony', 'school_recital'],
    ['Class presentation', 'school_recital'],
    ['Concert', 'concert'],
    ['The play', 'show'],
    ['Show', 'show'],
    ['Musical', 'show'],
    ['Theatre', 'show'],
    ['Theater', 'show'],
    ['Movie', 'movie'],
    ['Cinema', 'movie'],
    ['Film screening', 'movie'],
    ['Festival', 'festival'],
    ['Carnival', 'festival'],
    ['County fair', 'festival'],
    ['Museum', 'museum'],
    ['Art exhibit', 'museum'],
    ['Theme park', 'theme_park'],
    ['Amusement park', 'theme_park'],
    ['Game', 'sporting_event'],
    ['Match', 'sporting_event'],
    ['Tournament', 'sporting_event'],
    ['Soccer', 'soccer'],
    ['Softball', 'softball'],
    ['Tennis', 'tennis'],
    ['Swim', 'swimming'],
    ['Swimming', 'swimming'],
    ['Swimmer meet-up', 'swimming'],
    ['Gymnastics', 'gymnastics'],
    ['Dentist', 'dentist'],
    ['Dental cleaning', 'dentist'],
    ['Doctor', 'doctor'],
    ['Clinic', 'doctor'],
    ['Pediatric visit', 'doctor'],
    ['Appointment', 'doctor'],
    ['Eye exam', 'eye_exam'],
    ['Optometrist', 'eye_exam'],
    ['Optometry', 'eye_exam'],
    ['Optician', 'eye_exam'],
    ['Haircut', 'haircut'],
    ['Salon', 'haircut'],
    ['Barber', 'haircut'],
    ['Dinner', 'dining_out'],
    ['Dining', 'dining_out'],
    ['Restaurant', 'dining_out'],
    ['Lunch', 'dining_out'],
    ['Brunch', 'brunch'],
    ['Coffee', 'coffee'],
    ['Café', 'coffee'],
    ['Cafe', 'coffee'],
    ['Drinks', 'drinks'],
    ['Cocktail', 'drinks'],
    ['Happy hour', 'drinks'],
    ['Picnic', 'picnic'],
    ['Field trip', 'field_trip'],
    ['Excursion', 'field_trip'],
    ['Learning journey', 'field_trip'],
    ['School outing', 'field_trip'],
    ['School visit', 'field_trip'],
    ['After school club', 'after_school'],
    ['After-school club', 'after_school'],
    ['Afterschool club', 'after_school'],
    ['Spelling bee', 'spelling_bee'],
    ['Cubing', 'cubing'],
  ])('%s -> %s', (title, want) => {
    expect(inferActivityCategory(result({ title }))).toBe(want);
  });

  it('a specific word beats a generic one (the old first-match order put "game" first)', () => {
    expect(inferActivityCategory(result({ title: 'Soccer game' }))).toBe('soccer');
    expect(inferActivityCategory(result({ title: 'Dinner show' }))).toBe('dining_out');
  });

  it('matches the title before the description, each on its own', () => {
    expect(
      inferActivityCategory(result({ title: 'Tennis', description: 'Lunch provided after' }))
    ).toBe('tennis');
    expect(inferActivityCategory(result({ title: 'Saturday', description: 'Tennis' }))).toBe(
      'tennis'
    );
  });
});

describe('inferActivityCategory — occasions', () => {
  it('files "Anniversary dinner" as an anniversary, not dining out', () => {
    expect(inferActivityCategory(result({ title: 'Anniversary dinner' }))).toBe('anniversary');
  });

  it('maps birthday text to the birthday party category, never occasion_birthday', () => {
    expect(inferActivityCategory(result({ title: "Mia's birthday" }))).toBe('birthday');
  });

  it('maps a model-picked occasion_birthday to birthday', () => {
    expect(inferActivityCategory(result({ category: 'occasion_birthday' }))).toBe('birthday');
  });

  it('maps a hint-only occasion_birthday match to birthday', () => {
    expect(inferActivityCategory(result({ categoryHint: 'birthday' }))).toBe('birthday');
  });

  it('files "In memory of Grandpa" as remembrance', () => {
    expect(inferActivityCategory(result({ title: 'In memory of Grandpa' }))).toBe('remembrance');
  });

  it('does not treat "Memorial Day BBQ" as remembrance', () => {
    expect(inferActivityCategory(result({ title: 'Memorial Day BBQ' }))).not.toBe('remembrance');
  });

  it('logs a category-fallback warning for an unknown model id', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    inferActivityCategory(result({ category: 'not_a_real_id', title: 'Soccer game' }));
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'ai-extract',
        context: { action: 'category-fallback' },
      })
    );
  });
});
