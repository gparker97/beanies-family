import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));

import {
  setNewerFileHandler,
  signalNewerFileSeen,
  setPreAuthIdle,
  setPreAuthIdleHandler,
  isPreAuthIdle,
} from '../appUpdateSignals';

describe('appUpdateSignals', () => {
  beforeEach(() => {
    logEvent.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    setNewerFileHandler(null);
    setPreAuthIdleHandler(null);
    setPreAuthIdle(false);
    vi.restoreAllMocks();
  });

  describe('newer-file signal', () => {
    it('is a no-op with no handler (native, tests)', () => {
      expect(() => signalNewerFileSeen()).not.toThrow();
    });

    it('calls the installed handler', () => {
      const handler = vi.fn();
      setNewerFileHandler(handler);
      signalNewerFileSeen();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('holds ONE handler: a second install replaces the first', () => {
      const first = vi.fn();
      const second = vi.fn();
      setNewerFileHandler(first);
      setNewerFileHandler(second);
      signalNewerFileSeen();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('stops calling after the handler is cleared', () => {
      const handler = vi.fn();
      setNewerFileHandler(handler);
      setNewerFileHandler(null);
      signalNewerFileSeen();
      expect(handler).not.toHaveBeenCalled();
    });

    it('contains and reports a throwing handler, so the caller’s real error still propagates', async () => {
      setNewerFileHandler(() => {
        throw new TypeError('boom');
      });
      expect(() => signalNewerFileSeen()).not.toThrow();
      await vi.waitFor(() => expect(logEvent).toHaveBeenCalledTimes(1));
      expect(logEvent.mock.calls[0]![0]).toMatchObject({
        surface: 'pwa-updater',
        context: { action: 'signal-failed', error_code: 'TypeError' },
      });
    });
  });

  describe('pre-auth idle signal', () => {
    it('defaults to not idle and follows the publisher', () => {
      expect(isPreAuthIdle()).toBe(false);
      setPreAuthIdle(true);
      expect(isPreAuthIdle()).toBe(true);
      setPreAuthIdle(false);
      expect(isPreAuthIdle()).toBe(false);
    });

    it('calls the subscriber on the false -> true edge only', () => {
      const handler = vi.fn();
      setPreAuthIdleHandler(handler);
      setPreAuthIdle(true);
      setPreAuthIdle(true);
      expect(handler).toHaveBeenCalledTimes(1);
      setPreAuthIdle(false);
      expect(handler).toHaveBeenCalledTimes(1);
      setPreAuthIdle(true);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('contains a throwing subscriber and still records the state', () => {
      setPreAuthIdleHandler(() => {
        throw new Error('boom');
      });
      expect(() => setPreAuthIdle(true)).not.toThrow();
      expect(isPreAuthIdle()).toBe(true);
    });
  });
});
