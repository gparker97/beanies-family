import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// `useToday` is a MODULE SINGLETON captured at import (its `today` ref lives at
// module scope and is only moved by visibilitychange / pageshow / a midnight
// timer). `vi.setSystemTime` alone will not move it, so it has to be mocked.
// This is the only test in this change that needs a mock — everything else about
// the anchor lives in the pure `wallAnchor.ts` and is table-tested there.
const today = ref('2026-09-06');
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({ today }),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const weekStartDay = ref(1);
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    get weekStartDay() {
      return weekStartDay.value;
    },
  }),
}));

import { useWallAnchor } from '@/composables/useWallAnchor';

function withAnchor<T>(fn: (anchor: ReturnType<typeof useWallAnchor>) => T): T {
  const scope = effectScope();
  try {
    return scope.run(() => fn(useWallAnchor()))!;
  } finally {
    scope.stop();
  }
}

describe('useWallAnchor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    today.value = '2026-09-06';
    weekStartDay.value = 1;
  });

  it('starts on today, showing the rolling seven-day default', () => {
    withAnchor((anchor) => {
      expect(anchor.anchorYmd.value).toBe('2026-09-06');
      expect(anchor.isAnchoredToToday.value).toBe(true);
      expect(anchor.weekDays.value).toHaveLength(7);
      expect(anchor.weekDays.value[0]).toBe('2026-09-06');
      expect(anchor.weekDays.value[6]).toBe('2026-09-12');
    });
  });

  it('rolls to the new day at midnight when the wall is showing today', async () => {
    // Not `withAnchor`: the watcher flushes on the microtask queue ('pre'), so a
    // synchronous assertion inside the scope runs BEFORE it fires. Awaiting
    // nextTick tests the real behaviour rather than a convenient one — an
    // earlier version asserted synchronously and passed with the watcher
    // deleted, which is how it went unnoticed.
    const scope = effectScope();
    try {
      const anchor = scope.run(() => useWallAnchor())!;
      expect(anchor.isAnchoredToToday.value).toBe(true);

      today.value = '2026-09-07';
      await nextTick();

      expect(anchor.anchorYmd.value).toBe('2026-09-07');
      expect(anchor.isAnchoredToToday.value).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it('⚠️ does NOT drag a browsing family home at midnight', async () => {
    // A wall being read at 23:59 must not silently jump to today at 00:00 —
    // that is the same "returned to today with no indication why" this whole
    // change removed from WallTodayView's old local focus.
    const scope = effectScope();
    try {
      const anchor = scope.run(() => useWallAnchor())!;
      anchor.setAnchor('2026-09-20', 'day_tap');
      expect(anchor.anchorYmd.value).toBe('2026-09-20');

      today.value = '2026-09-07';
      await nextTick();

      expect(anchor.anchorYmd.value).toBe('2026-09-20');
      expect(anchor.isAnchoredToToday.value).toBe(false);

      // And "today" still means the NEW today, not the stale one.
      anchor.goToToday();
      expect(anchor.anchorYmd.value).toBe('2026-09-07');
    } finally {
      scope.stop();
    }
  });

  it('saturates at the range limit instead of teleporting home', () => {
    // ⚠️ restored in `finally`: `beforeEach` uses resetAllMocks (mockReset, not
    // mockRestore), so an assertion failure inside would otherwise leave the spy
    // installed and the NEXT test would stack a second one on it, turning one
    // real failure into a cascade of misleading ones.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      withAnchor((anchor) => {
        // Walking the arrow to the boundary is an ordinary gesture — 54 presses of
        // `›` in the days view reaches it. It must not be mistaken for bad input:
        // the wall used to jump silently back to today mid-browse AND file a
        // warning accusing the caller of passing something unparseable.
        let moved = true;
        let presses = 0;
        while (moved && presses < 500) {
          moved = anchor.step(7, 1);
          presses++;
        }

        expect(presses).toBeLessThan(500);
        // Stopped at the edge, still far from today, and still renderable.
        expect(anchor.isAnchoredToToday.value).toBe(false);
        expect(anchor.anchorYmd.value).not.toBe('2026-09-06');
        expect(reportError).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();

        // And it is not stuck: the other direction still works.
        expect(anchor.step(7, -1)).toBe(true);
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('🔴 steps by exactly the days it was given, whatever the weekStartDay', () => {
    // The old rule snapped to calendar weeks, so this same press landed on
    // 2026-09-07 under a Monday-start week and 2026-09-13 under a Sunday-start
    // one. Paging by what is on screen has no business consulting that setting —
    // and a family who changed it would have found their arrows moved differently.
    for (const start of [1, 0]) {
      weekStartDay.value = start;
      withAnchor((anchor) => {
        anchor.step(7, 1);
        expect(anchor.anchorYmd.value).toBe('2026-09-13');
      });
    }
  });

  it('🔴 pages by three when three columns are drawn, and back again exactly', () => {
    withAnchor((anchor) => {
      anchor.step(3, 1);
      expect(anchor.anchorYmd.value).toBe('2026-09-09');
      anchor.step(3, 1);
      expect(anchor.anchorYmd.value).toBe('2026-09-12');
      anchor.step(3, -1);
      anchor.step(3, -1);
      expect(anchor.anchorYmd.value).toBe('2026-09-06'); // exactly where it began
    });
  });

  it('steps by a single day and returns to today on demand', () => {
    withAnchor((anchor) => {
      anchor.step(1, 1);
      expect(anchor.anchorYmd.value).toBe('2026-09-07');

      anchor.step(1, -1);
      expect(anchor.anchorYmd.value).toBe('2026-09-06');

      anchor.step(7, 1);
      anchor.goToToday();
      expect(anchor.anchorYmd.value).toBe('2026-09-06');
      expect(anchor.isAnchoredToToday.value).toBe(true);
    });
  });

  it('places the anchor directly on a tapped day, unsnapped', () => {
    withAnchor((anchor) => {
      // greg's case: the week starts Saturday, Thursday is tapped, the week
      // redraws starting Thursday — NOT snapped to Thursday's calendar week.
      anchor.setAnchor('2026-09-10', 'day_tap');
      expect(anchor.anchorYmd.value).toBe('2026-09-10');
      expect(anchor.weekDays.value[0]).toBe('2026-09-10');
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  it('refuses an unparseable anchor, reports it once, and lands on today', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      withAnchor((anchor) => {
        anchor.setAnchor('NaN-NaN-NaN', 'day_tap');

        // The wall keeps rendering rather than propagating "NaN-NaN-NaN" forever.
        expect(anchor.anchorYmd.value).toBe('2026-09-06');
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(reportError).toHaveBeenCalledWith(
          expect.objectContaining({
            surface: 'beanie-wall',
            message: 'wall_anchor_rejected',
            severity: 'warning',
            context: expect.objectContaining({ error_code: 'bad_anchor', kind: 'day_tap' }),
          })
        );
        // The console line has to name the cause AND the fix — this branch is a
        // developer's only signal, since no toast is shown.
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0]![0])).toContain('parseLocalDate does NOT throw');
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not report anything on a valid step', () => {
    withAnchor((anchor) => {
      anchor.step(7, 1);
      anchor.step(7, 1);
      anchor.step(1, -1);
      anchor.goToToday();
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  it('hands out anchorYmd as readonly, so the clamp cannot be bypassed', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    withAnchor((anchor) => {
      // Vue's readonly() refuses the write and warns rather than throwing, so
      // assert the value is unmoved — that is what makes the clamp structural.
      (anchor.anchorYmd as { value: string }).value = 'NaN-NaN-NaN';
      expect(anchor.anchorYmd.value).toBe('2026-09-06');
    });

    consoleWarn.mockRestore();
  });
});
