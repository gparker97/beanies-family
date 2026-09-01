/**
 * The data-loss guard suite.
 *
 * `expiredCycleIds` is the one function in this feature that decides to destroy a
 * family's history, and it runs unattended on a background wake. Everything here exists
 * because the failure mode is silent and irreversible.
 */
import { describe, it, expect } from 'vitest';
import {
  expiredCycleIds,
  CYCLE_KEEP_DAYS,
  MAX_SWEEP_DELETES,
  MAX_TRUSTED_CLOCK_JUMP_DAYS,
} from '@/utils/listCycles';
import { clockVerdict } from '@/utils/cycleSweepClock';
import type { ListCycle } from '@/types/models';

const TODAY = '2026-09-01';
/** 90 days before TODAY is 2026-06-03, so that day is the boundary. */
const CUTOFF = '2026-06-03';

function cycle(id: string, endedOn: string, createdAt = `${endedOn}T09:00:00.000Z`): ListCycle {
  return { id, listId: 'l1', endedOn, createdAt } as ListCycle;
}

const ids = (cs: ListCycle[]) => expiredCycleIds(cs, TODAY);

describe('expiredCycleIds — what gets deleted', () => {
  it('pins the boundary, so a future edit cannot silently shift the window', () => {
    expect(CYCLE_KEEP_DAYS).toBe(90);
    // Strictly older than the cutoff expires; the cutoff day itself does not.
    expect(ids([cycle('old', '2026-06-02')])).toEqual(['old']);
    expect(ids([cycle('edge', CUTOFF)])).toEqual([]);
    expect(ids([cycle('fresh', '2026-08-30')])).toEqual([]);
  });

  it('deletes only when BOTH dates are expired', () => {
    // endedOn expired, createdAt not — a malformed or merged record, keep it.
    expect(ids([cycle('a', '2026-01-01', '2026-08-30T09:00:00.000Z')])).toEqual([]);
    // createdAt expired, endedOn not.
    expect(ids([cycle('b', '2026-08-30', '2026-01-01T09:00:00.000Z')])).toEqual([]);
    expect(ids([cycle('c', '2026-01-01', '2026-01-01T09:00:00.000Z')])).toEqual(['c']);
  });

  it('KEEPS anything with a missing, empty or malformed date, on either field', () => {
    // A plain string compare would treat '' as older than any cutoff — which is exactly
    // how a partially-loaded document would silently lose a whole history.
    for (const bad of ['', 'not-a-date', '2026', '2026-13-45']) {
      expect(ids([cycle('x', bad)])).toEqual([]);
      expect(ids([cycle('y', '2026-01-01', bad)])).toEqual([]);
    }
    expect(ids([{ id: 'z', listId: 'l1' } as ListCycle])).toEqual([]);
  });

  it('KEEPS a future-dated cycle — that is a clock artefact, not expired data', () => {
    expect(ids([cycle('future', '2027-01-01')])).toEqual([]);
  });

  it('caps a single sweep, oldest first', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      // All comfortably expired; ordered so the oldest are unambiguous.
      cycle(`c${i}`, `2025-${String((i % 12) + 1).padStart(2, '0')}-01`)
    );
    const out = expiredCycleIds(many, TODAY);
    expect(out).toHaveLength(MAX_SWEEP_DELETES);
    // Oldest first: every returned id must be from January, the earliest month present.
    const returned = new Set(out);
    const januaries = many.filter((c) => c.endedOn.startsWith('2025-01')).map((c) => c.id);
    expect(out.every((id) => januaries.includes(id))).toBe(true);
    expect(returned.size).toBe(MAX_SWEEP_DELETES);
  });

  it('returns nothing for an empty collection, or an unusable today', () => {
    expect(expiredCycleIds([], TODAY)).toEqual([]);
    expect(expiredCycleIds([cycle('old', '2020-01-01')], 'nonsense')).toEqual([]);
  });

  it('takes exactly two arguments — the orphan rule must never come back', () => {
    // An earlier draft also took the live list ids, which meant an empty or
    // partially-loaded `lists` collection marked EVERY cycle for deletion.
    expect(expiredCycleIds.length).toBe(2);
  });
});

describe('clockVerdict — a wrong clock may only ever delay a deletion', () => {
  it('never sweeps on a device that has no stored day', () => {
    expect(clockVerdict(TODAY, null)).toBe('skip-first-run');
    expect(clockVerdict(TODAY, 'garbage')).toBe('skip-first-run');
  });

  it('separates the silent same-day repeat from a genuinely backwards clock', () => {
    // Same-day fires on every app open and every remote merge — it must stay silent.
    expect(clockVerdict(TODAY, TODAY)).toBe('skip-same-day');
    // Backwards is rare and worth a warning, and must NOT move the cursor back.
    expect(clockVerdict('2026-08-31', TODAY)).toBe('skip-regressed');
  });

  it('calls a cursor far in the future corrupt, so a poisoned cursor can unstick', () => {
    // The sequence that produced it: a flat-battery RTC reads 2027, the sweep skips as
    // 'jumped' but records the day, NTP corrects the clock — and every run afterwards
    // read as a plain regression, silently disabling retention until the real calendar
    // caught up a year later.
    expect(clockVerdict(TODAY, '2027-09-01')).toBe('skip-corrupt');
    // Just inside the trusted bound is an ordinary regression, not corruption.
    expect(clockVerdict(TODAY, '2026-09-08')).toBe('skip-regressed');
    expect(clockVerdict(TODAY, '2026-09-09')).toBe('skip-corrupt');
  });

  it('sweeps on a normal advance, up to the trusted jump', () => {
    expect(clockVerdict('2026-09-02', TODAY)).toBe('sweep');
    expect(clockVerdict('2026-09-08', TODAY)).toBe('sweep'); // exactly 7 days
    expect(MAX_TRUSTED_CLOCK_JUMP_DAYS).toBe(7);
  });

  it('refuses a jump it cannot trust', () => {
    expect(clockVerdict('2026-09-09', TODAY)).toBe('skip-jumped');
    expect(clockVerdict('2027-09-01', TODAY)).toBe('skip-jumped');
  });
});
