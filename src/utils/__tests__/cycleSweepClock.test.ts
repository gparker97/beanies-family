/**
 * The parametrised sweep cursor (#146). Each retention sweep owns its own key, and the list
 * cycle sweep's key is pinned BYTE-IDENTICAL: renaming it would read as a first run on every
 * device and skip a day of list-history retention.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

import {
  CHORE_MARK_SWEEP_KEY,
  LIST_CYCLE_SWEEP_KEY,
  createSweepClock,
  listCycleSweepClock,
} from '@/utils/cycleSweepClock';

beforeEach(() => {
  localStorage.clear();
  reportError.mockClear();
});

describe('sweep cursors', () => {
  it('the list cycle sweep keeps its storage key byte-identical', () => {
    expect(LIST_CYCLE_SWEEP_KEY).toBe('beanies_cycle_sweep_day');
    expect(listCycleSweepClock.record('2026-11-13')).toBe(true);
    expect(localStorage.getItem('beanies_cycle_sweep_day')).toBe('2026-11-13');
    localStorage.setItem('beanies_cycle_sweep_day', '2026-11-12');
    expect(listCycleSweepClock.read()).toBe('2026-11-12');
  });

  it('two sweeps never share a cursor', () => {
    const chores = createSweepClock(CHORE_MARK_SWEEP_KEY, 'choreboard');
    expect(CHORE_MARK_SWEEP_KEY).not.toBe(LIST_CYCLE_SWEEP_KEY);
    listCycleSweepClock.record('2026-11-13');
    expect(chores.read()).toBeNull();
    chores.record('2026-11-10');
    expect(listCycleSweepClock.read()).toBe('2026-11-13');
  });

  it('a failed write answers false and reports under the given surface and context', () => {
    const clock = createSweepClock('k', 'choreboard', { action: 'x' });
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    try {
      expect(clock.record('2026-11-13')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'choreboard',
        severity: 'warning',
        context: { action: 'x' },
      })
    );
  });

  it('a failed read answers null, never throws', () => {
    const clock = createSweepClock('k', 'choreboard');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(clock.read()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      warn.mockRestore();
    }
  });
});
