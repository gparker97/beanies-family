import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { WALL_SLEEP_CHECK_MS, useWallAutoSleep } from '@/composables/useWallAutoSleep';
import { DEFAULT_WALL_SLEEP } from '@/utils/wallSleep';
import type { WallSleepSettings } from '@/types/models';

function setup(start: string, settings: Partial<WallSleepSettings> = {}) {
  vi.setSystemTime(new Date(`2026-10-09T${start}:00`));
  const target = new EventTarget();
  const asleep = ref(false);
  const sleep = vi.fn(() => (asleep.value = true));
  const wake = vi.fn(() => (asleep.value = false));
  const scope = effectScope();
  scope.run(() =>
    useWallAutoSleep({
      settings: () => ({ ...DEFAULT_WALL_SLEEP, ...settings }),
      asleep,
      sleep,
      wake,
      target,
    })
  );
  return { target, asleep, sleep, wake, scope };
}

describe('useWallAutoSleep', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sleeps after the idle time inside night hours, and not before', () => {
    const { sleep, scope } = setup('21:30');
    vi.advanceTimersByTime(9 * 60_000);
    expect(sleep).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000 + WALL_SLEEP_CHECK_MS);
    expect(sleep).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('a touch resets the idle clock', () => {
    const { sleep, target, scope } = setup('21:30');
    vi.advanceTimersByTime(8 * 60_000);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(8 * 60_000);
    expect(sleep).not.toHaveBeenCalled();
    scope.stop();
  });

  it('never sleeps outside night hours or when switched off', () => {
    const day = setup('14:00');
    vi.advanceTimersByTime(60 * 60_000);
    expect(day.sleep).not.toHaveBeenCalled();
    day.scope.stop();
    const off = setup('22:00', { enabled: false });
    vi.advanceTimersByTime(60 * 60_000);
    expect(off.sleep).not.toHaveBeenCalled();
    off.scope.stop();
  });

  it('wakes at the end of night hours a wall that fell asleep in them', async () => {
    const { asleep, wake, scope } = setup('06:40');
    asleep.value = true;
    await nextTick();
    vi.advanceTimersByTime(25 * 60_000);
    expect(wake).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it('leaves a daytime sleep alone', async () => {
    const { asleep, wake, scope } = setup('14:00');
    asleep.value = true;
    await nextTick();
    vi.advanceTimersByTime(3 * 60 * 60_000);
    expect(wake).not.toHaveBeenCalled();
    scope.stop();
  });
});
