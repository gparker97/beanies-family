import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Orientation policy — the rule is device-class, not viewport.
 *
 * The installed PWA manifest says `orientation: 'portrait'`, and in an
 * installed PWA that OVERRIDES the user's OS rotation lock. That was a real
 * regression on 2026-06-12 (phones rotating for users who had rotation locked),
 * so "a phone stays portrait" is the property these tests exist to pin. The
 * tablet half is the new behaviour: landscape is arguably the better way to
 * hold the app on a 10" screen, and the manifest cannot say so per-device.
 */

const lock = vi.fn(() => Promise.resolve());
const unlock = vi.fn();

/** Device dimensions, not viewport — `screen`, not `window.inner*`. */
function setScreen(width: number, height: number, withApi = true) {
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: withApi ? { width, height, orientation: { lock, unlock } } : { width, height },
  });
}

async function load() {
  vi.resetModules();
  return import('@/composables/useWallOrientation');
}

describe('orientation policy', () => {
  beforeEach(() => {
    lock.mockClear();
    unlock.mockClear();
    lock.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isRotatableFormFactor', () => {
    it.each([
      ['iPhone 15 portrait', 393, 852, false],
      ['iPhone 15 held sideways', 852, 393, false],
      ['a large phone', 430, 932, false],
      ['iPad mini', 744, 1133, true],
      ['iPad Pro', 1024, 1366, true],
      ['a 600dp Android tablet, exactly on the threshold', 600, 960, true],
    ])('%s -> %s', async (_name, w, h, expected) => {
      setScreen(w, h);
      const { isRotatableFormFactor } = await load();
      expect(isRotatableFormFactor()).toBe(expected);
    });

    it('uses the SMALLEST side, so a phone in landscape is still a phone', async () => {
      // 852px of width comfortably clears any viewport-based tablet breakpoint;
      // only the smallest-side rule keeps this device locked.
      setScreen(852, 393);
      const { isRotatableFormFactor } = await load();
      expect(isRotatableFormFactor()).toBe(false);
    });

    it('is false when there is no screen API to measure', async () => {
      Object.defineProperty(globalThis, 'screen', { configurable: true, value: undefined });
      const { isRotatableFormFactor } = await load();
      expect(isRotatableFormFactor()).toBe(false);
    });
  });

  describe('applyOrientationPolicy', () => {
    it('locks a phone to portrait', async () => {
      setScreen(393, 852);
      const { applyOrientationPolicy } = await load();
      applyOrientationPolicy();
      expect(lock).toHaveBeenCalledWith('portrait');
      expect(unlock).not.toHaveBeenCalled();
    });

    it('releases a tablet so it can be held either way', async () => {
      setScreen(1024, 1366);
      const { applyOrientationPolicy } = await load();
      applyOrientationPolicy();
      expect(unlock).toHaveBeenCalled();
      expect(lock).not.toHaveBeenCalled();
    });

    it('swallows a lock rejection rather than surfacing it', async () => {
      setScreen(393, 852);
      lock.mockImplementation(() => Promise.reject(new Error('needs fullscreen')));
      const { applyOrientationPolicy } = await load();
      expect(() => applyOrientationPolicy()).not.toThrow();
      // Give the rejected promise a tick to become unhandled if it were going to.
      await new Promise((r) => setTimeout(r, 0));
    });

    it('does nothing when the Screen Orientation API is absent', async () => {
      setScreen(393, 852, false);
      const { applyOrientationPolicy } = await load();
      expect(() => applyOrientationPolicy()).not.toThrow();
    });
  });

  describe('restoreWallOrientation', () => {
    it('puts a phone back to portrait when leaving the wall', async () => {
      setScreen(393, 852);
      const { restoreWallOrientation } = await load();
      restoreWallOrientation();
      expect(lock).toHaveBeenCalledWith('portrait');
    });

    it('leaves a tablet free — it must not fight the tablet policy', async () => {
      setScreen(1024, 1366);
      const { restoreWallOrientation } = await load();
      restoreWallOrientation();
      expect(lock).not.toHaveBeenCalled();
      expect(unlock).toHaveBeenCalled();
    });
  });
});
