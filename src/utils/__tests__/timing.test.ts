import { describe, it, expect, vi } from 'vitest';
import { delay, withTimeout, raceTimeout } from '@/utils/timing';

describe('utils/timing', () => {
  describe('delay', () => {
    it('resolves after the given time', async () => {
      vi.useFakeTimers();
      const p = delay(100);
      let resolved = false;
      void p.then(() => {
        resolved = true;
      });
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(resolved).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('withTimeout', () => {
    it('resolves with the promise value when it settles in time', async () => {
      await expect(withTimeout(Promise.resolve('ok'), 1000, 'too slow')).resolves.toBe('ok');
    });

    it('rejects with the promise rejection when it rejects in time', async () => {
      await expect(
        withTimeout(Promise.reject(new Error('boom')), 1000, 'too slow')
      ).rejects.toThrow('boom');
    });

    it('rejects with the timeout message when the promise never settles', async () => {
      vi.useFakeTimers();
      const never = new Promise<string>(() => {});
      const p = withTimeout(never, 5000, 'gave up waiting');
      const assertion = expect(p).rejects.toThrow('gave up waiting');
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
      vi.useRealTimers();
    });

    it('clears its timer once the promise settles (no dangling timeout)', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      await withTimeout(Promise.resolve(42), 9999, 'too slow');
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('raceTimeout', () => {
    it('resolves with the promise value when it settles in time', async () => {
      await expect(raceTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
    });

    it('resolves with undefined (not an error) when the promise never settles', async () => {
      vi.useFakeTimers();
      const never = new Promise<string>(() => {});
      const p = raceTimeout(never, 5000);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(p).resolves.toBeUndefined();
      vi.useRealTimers();
    });

    it('still propagates a genuine rejection that beats the timeout', async () => {
      await expect(raceTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
    });

    it('clears its timer once the promise settles (no dangling timeout)', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      await raceTimeout(Promise.resolve(42), 9999);
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
