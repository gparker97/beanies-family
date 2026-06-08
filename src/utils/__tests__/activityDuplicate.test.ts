import { describe, it, expect } from 'vitest';
import {
  titleSimilarity,
  findDuplicateActivity,
  mergeExtractionIntoActivity,
} from '../activityDuplicate';
import type { CreateFamilyActivityInput, FamilyActivity } from '@/types/models';

function activity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Piano Lesson',
    date: '2026-07-12',
    recurrence: 'none',
    category: 'other_activity',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm1',
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    ...overrides,
  };
}

function prefill(
  overrides: Partial<CreateFamilyActivityInput> = {}
): Partial<CreateFamilyActivityInput> {
  return { title: 'Piano Lesson', date: '2026-07-12', ...overrides };
}

describe('titleSimilarity', () => {
  it('is 1 for token-equal titles (punctuation/case ignored)', () => {
    expect(titleSimilarity('Piano Lesson', 'piano lesson!')).toBe(1);
  });
  it('is 0 for fully disjoint titles', () => {
    expect(titleSimilarity('Piano Lesson', 'Soccer Game')).toBe(0);
  });
  it('is the Jaccard ratio for partial overlap', () => {
    // {school, learning, journey} vs {school, learning, journey, zoo} → 3/4
    expect(titleSimilarity('School Learning Journey', 'School Learning Journey Zoo')).toBeCloseTo(
      0.75
    );
  });
  it('is 0 when either side has no tokens', () => {
    expect(titleSimilarity('', 'Piano')).toBe(0);
  });
});

describe('findDuplicateActivity', () => {
  it('returns the single match on same date + similar title', () => {
    const existing = activity();
    expect(findDuplicateActivity(prefill(), [existing])).toBe(existing);
  });

  it('returns null when the date differs', () => {
    const existing = activity({ date: '2026-07-13' });
    expect(findDuplicateActivity(prefill(), [existing])).toBeNull();
  });

  it('returns null when title similarity is below threshold', () => {
    const existing = activity({ title: 'Dentist Appointment' });
    expect(findDuplicateActivity(prefill(), [existing])).toBeNull();
  });

  it('returns null when the prefill has no date', () => {
    expect(findDuplicateActivity(prefill({ date: undefined }), [activity()])).toBeNull();
  });

  it('returns null when the prefill title is blank/whitespace', () => {
    expect(findDuplicateActivity(prefill({ title: '   ' }), [activity()])).toBeNull();
  });

  it('never matches a recurring activity', () => {
    const existing = activity({ recurrence: 'weekly' });
    expect(findDuplicateActivity(prefill(), [existing])).toBeNull();
  });

  it('never matches a recurrence-override child', () => {
    const existing = activity({ parentActivityId: 'parent-1' });
    expect(findDuplicateActivity(prefill(), [existing])).toBeNull();
  });

  it('returns null when 2+ candidates qualify (ambiguous)', () => {
    const a = activity({ id: 'a1' });
    const b = activity({ id: 'a2' });
    expect(findDuplicateActivity(prefill(), [a, b])).toBeNull();
  });
});

describe('mergeExtractionIntoActivity', () => {
  it('keeps the existing id, title, recurrence, and assignees', () => {
    const existing = activity({ id: 'keep-me', recurrence: 'none', assigneeIds: ['m1', 'm2'] });
    const merged = mergeExtractionIntoActivity(
      existing,
      prefill({ title: 'A Different Title', location: 'Hall' })
    );
    expect(merged.id).toBe('keep-me');
    expect(merged.title).toBe('Piano Lesson'); // not overwritten by the prefill's title
    expect(merged.recurrence).toBe('none');
    expect(merged.assigneeIds).toEqual(['m1', 'm2']);
  });

  it('fills a blank field but never overwrites a populated one', () => {
    const blank = activity({ location: undefined });
    expect(
      mergeExtractionIntoActivity(blank, prefill({ location: 'Music Academy' })).location
    ).toBe('Music Academy');
    const populated = activity({ location: 'Home Studio' });
    expect(
      mergeExtractionIntoActivity(populated, prefill({ location: 'Music Academy' })).location
    ).toBe('Home Studio');
  });

  it('appends + de-dupes notes via mergeNotes', () => {
    const existing = activity({ notes: 'Bring water' });
    const merged = mergeExtractionIntoActivity(
      existing,
      prefill({ notes: 'Bring water\nBring a snack' })
    );
    expect(merged.notes).toBe('Bring water\nBring a snack');
  });

  it('generically fills any non-special prefill field (no per-field code)', () => {
    // `icon` is not specially handled — proves the generic loop, not a hardcoded list.
    const existing = activity({ icon: undefined });
    const merged = mergeExtractionIntoActivity(existing, prefill({ icon: '🎹' }));
    expect(merged.icon).toBe('🎹');
  });

  describe('all-day / time consistency guard', () => {
    it('does NOT add isAllDay to a timed activity', () => {
      const timed = activity({ startTime: '14:00', isAllDay: false });
      const merged = mergeExtractionIntoActivity(timed, prefill({ isAllDay: true }));
      expect(merged.isAllDay).toBe(false);
      expect(merged.startTime).toBe('14:00');
    });

    it('does NOT add times to an all-day activity', () => {
      const allDay = activity({ isAllDay: true });
      const merged = mergeExtractionIntoActivity(
        allDay,
        prefill({ startTime: '09:00', endTime: '10:00' })
      );
      expect(merged.isAllDay).toBe(true);
      expect(merged.startTime).toBeUndefined();
      expect(merged.endTime).toBeUndefined();
    });

    it('adopts the prefill schedule when the existing activity has no time signal', () => {
      const noSchedule = activity({
        isAllDay: undefined,
        startTime: undefined,
        endTime: undefined,
      });
      expect(mergeExtractionIntoActivity(noSchedule, prefill({ isAllDay: true })).isAllDay).toBe(
        true
      );
      const merged = mergeExtractionIntoActivity(
        activity({ isAllDay: undefined, startTime: undefined, endTime: undefined }),
        prefill({ startTime: '09:00', endTime: '10:00' })
      );
      expect(merged.startTime).toBe('09:00');
      expect(merged.endTime).toBe('10:00');
    });
  });
});
