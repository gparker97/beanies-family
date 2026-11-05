import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const native = vi.hoisted(() => ({ value: false }));
const impact = vi.hoisted(() => vi.fn());
const logEvent = vi.hoisted(() => vi.fn());

vi.mock('@/services/sync/capabilities', () => ({ isNative: () => native.value }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

import { hapticTick } from '@/utils/haptics';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('hapticTick', () => {
  let vibrate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    native.value = false;
    impact.mockReset();
    logEvent.mockReset();
    vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
  });

  it('vibrates 10 ms on the web', () => {
    hapticTick();
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(impact).not.toHaveBeenCalled();
  });

  it('does nothing (and does not throw) on a web browser without vibrate', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    expect(() => hapticTick()).not.toThrow();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('swallows a throwing vibrate and logs it at debug', () => {
    vibrate.mockImplementation(() => {
      throw new Error('blocked by permissions policy');
    });
    expect(() => hapticTick()).not.toThrow();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        surface: 'calendar-drag',
        context: { action: 'haptic', detail: 'unavailable' },
      })
    );
  });

  it('uses a light Capacitor impact on native, not vibrate', async () => {
    native.value = true;
    impact.mockResolvedValue(undefined);
    hapticTick();
    await flush();
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('swallows a native failure and logs it at debug', async () => {
    native.value = true;
    impact.mockRejectedValue(new Error('plugin not implemented'));
    expect(() => hapticTick()).not.toThrow();
    await flush();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        surface: 'calendar-drag',
        context: { action: 'haptic', detail: 'unavailable' },
      })
    );
  });
});
