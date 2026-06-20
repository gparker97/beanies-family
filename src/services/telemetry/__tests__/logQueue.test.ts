import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueLogEvent,
  __resetLogQueueForTesting,
  __getLogQueueLengthForTesting,
} from '../logQueue';
import type { LogRecord } from '../logEvent';

const URL = 'https://api.test/logs';
const KEY = 'test-key';

function rec(message = 'm'): LogRecord {
  return { level: 'info', surface: 's', message, timestamp: '2026-05-20T00:00:00.000Z' };
}

/** Flush pending microtasks/macrotasks (real timers). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('logQueue', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let beaconSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetLogQueueForTesting();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    beaconSpy = vi.fn(() => true);
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      value: beaconSpy,
      configurable: true,
      writable: true,
    });
    vi.stubEnv('VITE_BEANIES_LOG_INGEST_URL', URL);
    vi.stubEnv('VITE_BEANIES_LOG_INGEST_API_KEY', KEY);
  });

  afterEach(() => {
    __resetLogQueueForTesting();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  function enqueueN(n: number, message = 'm') {
    for (let i = 0; i < n; i++) enqueueLogEvent(rec(message));
  }

  describe('disabled when no ingest URL', () => {
    it('no-ops, warns once, never fetches', () => {
      vi.stubEnv('VITE_BEANIES_LOG_INGEST_URL', '');
      enqueueN(5);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(__getLogQueueLengthForTesting()).toBe(0);
      const noUrlWarns = warnSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('VITE_BEANIES_LOG_INGEST_URL not set')
      );
      expect(noUrlWarns.length).toBe(1);
    });
  });

  describe('forced flush', () => {
    it('flushes a SINGLE event immediately when flush=true (below the batch threshold)', async () => {
      enqueueLogEvent(rec('critical'), true);
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.events.length).toBe(1);
      expect(__getLogQueueLengthForTesting()).toBe(0);
    });

    it('does NOT flush a single event when flush is omitted (waits for the threshold)', async () => {
      enqueueLogEvent(rec('quiet'));
      await tick();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(__getLogQueueLengthForTesting()).toBe(1);
    });
  });

  describe('batch flush', () => {
    it('flushes at the batch threshold with the right URL, headers, and body', async () => {
      enqueueN(25);
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(URL);
      expect(init.method).toBe('POST');
      expect(init.keepalive).toBe(true);
      expect((init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
      const body = JSON.parse(init.body as string);
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBe(25);
      // 2xx → buffer drained.
      expect(__getLogQueueLengthForTesting()).toBe(0);
    });
  });

  describe('retry classification', () => {
    it('drops the batch terminally on 4xx (no retry-loop)', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));
      enqueueN(25);
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(__getLogQueueLengthForTesting()).toBe(0); // dropped, not retained
      expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('terminal'))).toBe(
        true
      );
    });

    it('keeps the batch on 5xx for a later retry', async () => {
      fetchSpy.mockResolvedValue(new Response(null, { status: 503 }));
      enqueueN(25);
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(__getLogQueueLengthForTesting()).toBe(25); // retained
    });

    it('keeps the batch on a network error', async () => {
      fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
      enqueueN(25);
      await tick();
      expect(__getLogQueueLengthForTesting()).toBe(25);
      expect(
        warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('network error'))
      ).toBe(true);
    });
  });

  describe('bounded buffer', () => {
    it('drops oldest beyond the 500 cap and warns', async () => {
      // Never-resolving fetch so the buffer accumulates instead of draining.
      fetchSpy.mockReturnValue(new Promise(() => {}) as unknown as Promise<Response>);
      enqueueN(600);
      await tick();
      expect(__getLogQueueLengthForTesting()).toBe(500);
      expect(
        warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('buffer overflow'))
      ).toBe(true);
    });
  });

  describe('lifecycle triggers', () => {
    it('flushes when the network comes back online', async () => {
      enqueueN(3); // below threshold — no auto-flush
      expect(fetchSpy).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('online'));
      await tick();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('flushes on the periodic interval', async () => {
      vi.useFakeTimers();
      enqueueN(2);
      expect(fetchSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('beacons on real unload (pagehide, non-persisted) with text/plain + key query', async () => {
      enqueueN(3);
      window.dispatchEvent(new Event('pagehide')); // persisted undefined → real unload
      await tick();
      expect(beaconSpy).toHaveBeenCalledTimes(1);
      const [beaconUrl, blob] = beaconSpy.mock.calls[0] as [string, Blob];
      expect(beaconUrl).toBe(`${URL}?k=${KEY}`);
      expect(blob.type).toBe('text/plain');
    });

    it('does NOT beacon on a bfcache freeze (pagehide persisted=true)', async () => {
      enqueueN(3);
      const e = new Event('pagehide');
      Object.defineProperty(e, 'persisted', { value: true });
      window.dispatchEvent(e);
      await tick();
      expect(beaconSpy).not.toHaveBeenCalled();
    });
  });
});
