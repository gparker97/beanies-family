/**
 * greg, after 0.20.1: "8 aug is singapore national day, and i also don't see
 * that on the wall. looking forward, christmas (which is a PH in singapore) is
 * also not on the wall."
 *
 * This isolates MY layer from the data layer. If these pass, the composable
 * turns a holiday in the window into a band reference correctly and the problem
 * is upstream (loading, settings, or which days the wall actually asks about).
 * If they fail, it is mine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, effectScope } from 'vue';
import type { FamilyMember } from '@/types/models';

const members: FamilyMember[] = [];
const holidayRows = [{ date: '2026-12-25', name: 'Christmas Day', countryCode: 'SG' }];
const holidaysInRange = vi.fn((a: string, b: string) =>
  holidayRows.filter((h) => h.date >= a && h.date <= b)
);

vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members }) }));
vi.mock('@/stores/holidayStore', () => ({ useHolidayStore: () => ({ holidaysInRange }) }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useWallReferenceDays } from '../useWallReferenceDays';

function run<T>(fn: () => T): T {
  const scope = effectScope();
  return scope.run(fn)!;
}

beforeEach(() => holidaysInRange.mockClear());

describe('a public holiday inside the wall window', () => {
  it('becomes a band reference on its own day', () => {
    const { byDay } = run(() =>
      useWallReferenceDays(computed(() => ['2026-12-24', '2026-12-25', '2026-12-26']))
    );
    expect(byDay.value).toHaveLength(1);
    expect(byDay.value[0]!.reference.label).toBe('Christmas Day (SG)');
    expect(byDay.value[0]!.startCol).toBe(1);
  });

  it('asks the store for exactly the window it was given', () => {
    const { byDay } = run(() => useWallReferenceDays(computed(() => ['2026-12-24', '2026-12-26'])));
    // Touch the computed so it evaluates; it is lazy.
    expect(byDay.value).toBeDefined();
    expect(holidaysInRange).toHaveBeenCalledWith('2026-12-24', '2026-12-26');
  });

  it('⚠️ a NARROW window misses a holiday just outside it', () => {
    // The days view passes only the columns it RENDERS (`weekDays.slice(0,
    // dayColumns)`) - three of seven on a 1280px wall. So a holiday later in the
    // same week is legitimately absent until the wall is paged to it. This is
    // the behaviour, documented as a test so it is a decision rather than a
    // surprise.
    const { byDay } = run(() =>
      useWallReferenceDays(computed(() => ['2026-12-21', '2026-12-22', '2026-12-23']))
    );
    expect(byDay.value).toHaveLength(0);
  });

  it('spans every lane on the member-shaped view', () => {
    const { shared } = run(() => useWallReferenceDays(computed(() => ['2026-12-25'])));
    const rows = run(() =>
      shared(
        computed(() => '2026-12-25'),
        computed(() => 4)
      )
    );
    expect(rows.value[0]).toMatchObject({ startCol: 0, span: 4 });
  });

  it('returns nothing for an empty window instead of asking the store', () => {
    const { byDay } = run(() => useWallReferenceDays(computed(() => [])));
    expect(byDay.value).toEqual([]);
    expect(holidaysInRange).not.toHaveBeenCalled();
  });
});
