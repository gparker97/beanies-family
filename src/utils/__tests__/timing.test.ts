import { describe, it, expect, vi, afterEach } from 'vitest';
import { delay, withTimeout, raceTimeout, timeoutSignal } from '@/utils/timing';

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

  describe('withTimeout — naming the deadline', () => {
    /**
     * ⚠️ AN ANONYMOUS `'Error'` IS WHAT LOCKED A USER OUT. A cache-open deadline
     * and a key failure and a DOMException all arrived at the classifier with
     * `name === 'Error'`, so it could not tell them apart and guessed — wrongly,
     * in the direction that latched the session. The name is set at the ONE site
     * that knows what kind of deadline this is.
     */
    it('names the rejection when the caller says what the deadline is', async () => {
      vi.useFakeTimers();
      const never = new Promise(() => {});
      const p = withTimeout(never, 1000, 'took too long', 'CacheOpenTimeoutError').catch((e) => e);
      await vi.advanceTimersByTimeAsync(1000);
      const err = (await p) as Error;
      expect(err.name).toBe('CacheOpenTimeoutError');
      expect(err.message).toBe('took too long');
      vi.useRealTimers();
    });

    it('is a WIDENING — an existing caller that passes no name is unchanged', async () => {
      vi.useFakeTimers();
      const never = new Promise(() => {});
      const p = withTimeout(never, 1000, 'took too long').catch((e) => e);
      await vi.advanceTimersByTimeAsync(1000);
      const err = (await p) as Error;
      expect(err.name).toBe('Error');
      vi.useRealTimers();
    });
  });
});

describe('timeoutSignal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** Old WebKit: an `AbortSignal` with neither `timeout` nor `any`. */
  function stubOldWebKit(): void {
    const Native = globalThis.AbortSignal;
    class OldAbortSignal {}
    Object.setPrototypeOf(OldAbortSignal.prototype, Native.prototype);
    vi.stubGlobal('AbortSignal', OldAbortSignal);
  }

  it('uses AbortSignal.timeout and AbortSignal.any when both exist', () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const anySpy = vi.spyOn(AbortSignal, 'any');
    const caller = new AbortController();
    timeoutSignal(1000, caller.signal);
    expect(timeoutSpy).toHaveBeenCalledWith(1000);
    expect(anySpy).toHaveBeenCalledTimes(1);
    timeoutSpy.mockRestore();
    anySpy.mockRestore();
  });

  describe.each([
    ['without AbortSignal.timeout or AbortSignal.any', stubOldWebKit],
    [
      'with AbortSignal.timeout but without AbortSignal.any (iOS 16)',
      () => {
        const Native = globalThis.AbortSignal;
        class Ios16AbortSignal {
          static timeout = Native.timeout.bind(Native);
        }
        vi.stubGlobal('AbortSignal', Ios16AbortSignal);
      },
    ],
  ])('%s', (_name, stub) => {
    it('aborts after the deadline with a TimeoutError reason', async () => {
      vi.useFakeTimers();
      stub();
      const caller = new AbortController();
      const signal = timeoutSignal(1000, caller.signal);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal.aborted).toBe(true);
      expect((signal.reason as Error).name).toBe('TimeoutError');
    });

    it("forwards the caller's abort, with the caller's reason, and cancels the timer", async () => {
      vi.useFakeTimers();
      stub();
      const caller = new AbortController();
      const signal = timeoutSignal(1000, caller.signal);
      caller.abort(new DOMException('moved on', 'AbortError'));
      expect(signal.aborted).toBe(true);
      expect((signal.reason as Error).name).toBe('AbortError');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('an already-aborted caller signal aborts the result at once', () => {
      stub();
      const caller = new AbortController();
      caller.abort(new DOMException('gone', 'AbortError'));
      const signal = timeoutSignal(1000, caller.signal);
      expect(signal.aborted).toBe(true);
      expect((signal.reason as Error).message).toBe('gone');
    });

    it("removes its listener from the caller's signal when the deadline fires", async () => {
      vi.useFakeTimers();
      stub();
      const caller = new AbortController();
      const add = vi.spyOn(caller.signal, 'addEventListener');
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      timeoutSignal(1000, caller.signal);
      expect(add).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    });
  });

  it('without a caller signal and without AbortSignal.timeout, still times out', async () => {
    vi.useFakeTimers();
    stubOldWebKit();
    const signal = timeoutSignal(500);
    await vi.advanceTimersByTimeAsync(499);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((signal.reason as Error).name).toBe('TimeoutError');
  });
});
