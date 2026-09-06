import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, ref } from 'vue';
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

  it('re-anchors to the new day at midnight rollover', () => {
    withAnchor((anchor) => {
      anchor.step('week', 1);
      expect(anchor.isAnchoredToToday.value).toBe(false);

      // The wall is left running; `useToday` ticks over at midnight. Without
      // this watcher a wall would sit on a stale week indefinitely.
      today.value = '2026-09-07';

      expect(anchor.anchorYmd.value).toBe('2026-09-07');
      expect(anchor.isAnchoredToToday.value).toBe(true);
    });
  });

  it('honours the family’s weekStartDay when stepping by week', () => {
    withAnchor((anchor) => {
      anchor.step('week', 1);
      expect(anchor.anchorYmd.value).toBe('2026-09-07'); // Monday-start
    });

    weekStartDay.value = 0;
    withAnchor((anchor) => {
      anchor.step('week', 1);
      // 2026-09-06 IS a Sunday, so a Sunday-start week is already aligned.
      expect(anchor.anchorYmd.value).toBe('2026-09-13');
    });
  });

  it('steps by a single day and returns to today on demand', () => {
    withAnchor((anchor) => {
      anchor.step('day', 1);
      expect(anchor.anchorYmd.value).toBe('2026-09-07');

      anchor.step('day', -1);
      expect(anchor.anchorYmd.value).toBe('2026-09-06');

      anchor.step('week', 1);
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

    consoleError.mockRestore();
  });

  it('does not report anything on a valid step', () => {
    withAnchor((anchor) => {
      anchor.step('week', 1);
      anchor.step('week', 1);
      anchor.step('day', -1);
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
