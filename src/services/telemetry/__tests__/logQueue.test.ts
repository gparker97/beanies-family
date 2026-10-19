import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import {
  enqueueLogEvent,
  registerPageHideHook,
  restoreSpooledEvents,
  __resetLogQueueForTesting,
  __getLogQueueLengthForTesting,
} from '../logQueue';
import type { LogRecord } from '../logEvent';
import { SPOOL_PREFIX, writeSpool } from '../logSpool';

const URL = 'https://api.test/logs';
const KEY = 'test-key';

function rec(message = 'm'): LogRecord {
  return { level: 'info', surface: 's', message, timestamp: '2026-05-20T00:00:00.000Z' };
}

/** Flush pending microtasks/macrotasks (real timers). */
const tick = () => new Promise((r) => setTimeout(r, 0));

function setOnline(onLine: boolean) {
  Object.defineProperty(globalThis.navigator, 'onLine', { value: onLine, configurable: true });
}

function spoolKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(SPOOL_PREFIX)) keys.push(k);
  }
  return keys;
}

function spooledMessages(): string[] {
  return spoolKeys().flatMap((k) =>
    (JSON.parse(localStorage.getItem(k) ?? '[]') as LogRecord[]).map((r) => r.message)
  );
}

function hide() {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
}

/** A fetch that stays pending until the returned resolver is called. */
function pendingFetch(spy: ReturnType<typeof vi.spyOn>) {
  let resolve!: (r: Response) => void;
  spy.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
  return (status = 200) => resolve(new Response(null, { status }));
}

describe('logQueue', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let beaconSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetLogQueueForTesting();
    // Failed-flush cases leave spool keys behind; a later restore case must not claim them.
    localStorage.clear();
    setOnline(true);
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

    it('drains a backlog larger than one request without waiting for the interval', async () => {
      const finish = pendingFetch(fetchSpy);
      enqueueN(25); // threshold flush: these 25 are in flight
      await tick();
      enqueueN(205); // backlog builds behind it
      finish(200);
      for (let i = 0; i < 8; i++) await tick();
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
  describe('pre-beacon pagehide hooks', () => {
    function realUnload() {
      window.dispatchEvent(new Event('pagehide')); // persisted undefined → real unload
    }

    it('runs a hook BEFORE the beacon, so an event it enqueues rides that beacon', async () => {
      enqueueN(1, 'earlier');
      registerPageHideHook(() => enqueueLogEvent(rec('from-hook')));
      realUnload();
      await tick();
      expect(beaconSpy).toHaveBeenCalledTimes(1);
      const blob = beaconSpy.mock.calls[0]![1] as Blob;
      const body = JSON.parse(await blob.text()) as { events: LogRecord[] };
      expect(body.events.map((e) => e.message)).toEqual(['earlier', 'from-hook']);
    });

    it('attaches the listener on registration, so a page that enqueued nothing still runs it', async () => {
      registerPageHideHook(() => enqueueLogEvent(rec('only-event')));
      realUnload();
      await tick();
      expect(beaconSpy).toHaveBeenCalledTimes(1);
      const blob = beaconSpy.mock.calls[0]![1] as Blob;
      const body = JSON.parse(await blob.text()) as { events: LogRecord[] };
      expect(body.events.map((e) => e.message)).toEqual(['only-event']);
    });

    it('a throwing hook is skipped with a warn; later hooks and the beacon still run', async () => {
      const later = vi.fn();
      registerPageHideHook(() => {
        throw new Error('boom');
      });
      registerPageHideHook(later);
      enqueueN(1);
      realUnload();
      await tick();
      expect(later).toHaveBeenCalledTimes(1);
      expect(beaconSpy).toHaveBeenCalledTimes(1);
      expect(
        warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('pagehide hook threw'))
      ).toBe(true);
    });

    it('does NOT run hooks on a bfcache freeze (pagehide persisted=true)', () => {
      const hook = vi.fn();
      registerPageHideHook(hook);
      const e = new Event('pagehide');
      Object.defineProperty(e, 'persisted', { value: true });
      window.dispatchEvent(e);
      expect(hook).not.toHaveBeenCalled();
    });

    it('the test reset clears registered hooks', () => {
      const hook = vi.fn();
      registerPageHideHook(hook);
      __resetLogQueueForTesting();
      enqueueN(1); // re-attaches the listener without the hook
      realUnload();
      expect(hook).not.toHaveBeenCalled();
    });
  });

  describe('offline spool', () => {
    it('online hide with unsent events writes nothing', async () => {
      enqueueN(3);
      hide();
      await tick();
      expect(spoolKeys()).toEqual([]);
    });

    it('offline hide keeps the buffer on the device', async () => {
      fetchSpy.mockRejectedValue(new TypeError('offline'));
      setOnline(false);
      enqueueN(3, 'offline');
      hide();
      await tick();
      expect(spooledMessages()).toEqual(['offline', 'offline', 'offline']);
    });

    it('a network error spools, and the next successful flush removes the spool', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
      enqueueLogEvent(rec('a'), true);
      await tick();
      expect(spooledMessages()).toEqual(['a']);

      window.dispatchEvent(new Event('online'));
      await tick();
      expect(spoolKeys()).toEqual([]);
      expect(__getLogQueueLengthForTesting()).toBe(0);
    });

    it('a 5xx spools', async () => {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
      enqueueLogEvent(rec('a'), true);
      await tick();
      expect(spooledMessages()).toEqual(['a']);
    });

    it('a 4xx drop after a spool removes it', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
      enqueueLogEvent(rec('a'), true);
      await tick();
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 400 }));
      window.dispatchEvent(new Event('online'));
      await tick();
      expect(spoolKeys()).toEqual([]);
    });

    it('repeated failures with an unchanged buffer write once', async () => {
      fetchSpy.mockRejectedValue(new TypeError('offline'));
      const setSpy = vi.spyOn(localStorage, 'setItem');
      onTestFinished(() => setSpy.mockRestore());
      enqueueLogEvent(rec('a'), true);
      await tick();
      window.dispatchEvent(new Event('online'));
      await tick();
      hide();
      await tick();
      expect(setSpy.mock.calls.filter((c) => String(c[0]).startsWith(SPOOL_PREFIX))).toHaveLength(
        1
      );
    });

    it('a successful send drops the spool even with events still queued (recovered = online again)', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
      enqueueLogEvent(rec('first'), true);
      await tick();
      const finish = pendingFetch(fetchSpy);
      const drain = pendingFetch(fetchSpy);
      enqueueN(149); // the 25-event threshold sends the first 25; 125 more wait
      await tick();
      // Enqueueing does not write; the spool catches up at the next failure, hide or removal.
      expect(spooledMessages()).toEqual(['first']);

      finish(200);
      await tick();
      expect(__getLogQueueLengthForTesting()).toBe(125);
      expect(spoolKeys()).toEqual([]);

      drain(200); // 100 more; the last 25 go on the next tick
      await tick();
      await tick();
      await tick();
      expect(__getLogQueueLengthForTesting()).toBe(0);
      expect(spoolKeys()).toEqual([]);
    });

    it('online pagehide beacons and does not spool', async () => {
      enqueueN(2);
      window.dispatchEvent(new Event('pagehide'));
      await tick();
      expect(beaconSpy).toHaveBeenCalledTimes(1);
      expect(spoolKeys()).toEqual([]);
    });

    it('offline pagehide spools instead of beaconing', async () => {
      setOnline(false);
      enqueueN(2, 'unload');
      window.dispatchEvent(new Event('pagehide'));
      await tick();
      expect(beaconSpy).not.toHaveBeenCalled();
      expect(spooledMessages()).toEqual(['unload', 'unload']);
    });

    it('pagehide after a failed flush spools even when the browser reports online', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('weak network'));
      enqueueLogEvent(rec('a'), true);
      await tick();
      enqueueLogEvent(rec('b'));
      window.dispatchEvent(new Event('pagehide'));
      await tick();
      expect(beaconSpy).not.toHaveBeenCalled();
      expect(spooledMessages()).toEqual(['a', 'b']);
    });

    it('one blip does not leave a recovered session failing: pagehide beacons again', async () => {
      fetchSpy.mockRejectedValueOnce(new TypeError('blip'));
      enqueueLogEvent(rec('a'), true);
      await tick();
      expect(spoolKeys()).toHaveLength(1);
      const finish = pendingFetch(fetchSpy);
      window.dispatchEvent(new Event('online')); // retry sends 'a'
      await tick();
      enqueueLogEvent(rec('b')); // arrives while the retry is in flight
      finish(200);
      await tick();
      expect(spoolKeys()).toEqual([]); // buffer still holds 'b', but delivery works again

      const setSpy = vi.spyOn(localStorage, 'setItem');
      onTestFinished(() => setSpy.mockRestore());
      hide();
      window.dispatchEvent(new Event('pagehide'));
      await tick();
      expect(beaconSpy).toHaveBeenCalled();
      expect(setSpy.mock.calls.filter((c) => String(c[0]).startsWith(SPOOL_PREFIX))).toEqual([]);
    });

    it('pagehide while failing beacons when the spool write is refused', async () => {
      setOnline(false);
      // happy-dom's Storage methods live on the instance; restore explicitly (as storedJson.test does).
      const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      enqueueN(2);
      window.dispatchEvent(new Event('pagehide'));
      await tick();
      setSpy.mockRestore();
      expect(beaconSpy).toHaveBeenCalledTimes(1);
    });

    it('request bodies carry sentAt beside the events', async () => {
      enqueueLogEvent(rec('a'), true);
      await tick();
      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)) as {
        sentAt: string;
        events: LogRecord[];
      };
      expect(Number.isNaN(Date.parse(body.sentAt))).toBe(false);
      expect(body.events.map((e) => e.message)).toEqual(['a']);
    });
  });

  describe('restore', () => {
    function fresh(message: string, ageMs = 60_000): LogRecord {
      return { ...rec(message), timestamp: new Date(Date.now() - ageMs).toISOString() };
    }

    it('puts earlier spools back oldest first, re-spools them under its own key, and flushes', async () => {
      writeSpool(SPOOL_PREFIX + 'earlier', [fresh('new', 1_000), fresh('old', 50_000)]);
      const hang = pendingFetch(fetchSpy);

      const r = restoreSpooledEvents();

      expect(r).toEqual({
        keys: 1,
        restored: 2,
        stale: 0,
        malformed: 0,
        unremovable: 0,
        capped: 0,
      });
      expect(localStorage.getItem(SPOOL_PREFIX + 'earlier')).toBeNull();
      expect(spooledMessages()).toEqual(['old', 'new']);
      const body = JSON.parse(String(fetchSpy.mock.calls[0]![1]!.body)) as { events: LogRecord[] };
      expect(body.events.map((e) => e.message)).toEqual(['old', 'new']);

      hang(200);
      await tick();
      expect(spoolKeys()).toEqual([]);
    });

    it('does nothing without an ingest URL', () => {
      vi.stubEnv('VITE_BEANIES_LOG_INGEST_URL', '');
      writeSpool(SPOOL_PREFIX + 'earlier', [fresh('x')]);
      expect(restoreSpooledEvents().keys).toBe(0);
      expect(localStorage.getItem(SPOOL_PREFIX + 'earlier')).not.toBeNull();
    });

    it('caps at 500, keeping the newest, and reports the rest as capped', () => {
      fetchSpy.mockReturnValue(new Promise(() => {}) as unknown as Promise<Response>);
      const many = Array.from({ length: 600 }, (_, i) => fresh(`e${i}`, 600_000 - i * 100));
      writeSpool(SPOOL_PREFIX + 'earlier', many);
      const r = restoreSpooledEvents();
      expect(r).toMatchObject({ restored: 500, capped: 100 });
      expect(__getLogQueueLengthForTesting()).toBe(500);
    });

    it('a restore during an in-flight flush keeps the restored events', async () => {
      const finish = pendingFetch(fetchSpy);
      enqueueLogEvent(rec('in-flight'), true);
      await tick();
      fetchSpy.mockReturnValue(new Promise(() => {}) as unknown as Promise<Response>);
      writeSpool(SPOOL_PREFIX + 'earlier', [fresh('restored-1'), fresh('restored-2')]);
      restoreSpooledEvents();

      finish(200);
      await tick();

      // Exactly the sent batch left; the restored events stay queued.
      expect(__getLogQueueLengthForTesting()).toBe(2);
    });
  });

  describe('removal by identity', () => {
    it('an overflow trim during an in-flight flush removes exactly the sent batch', async () => {
      const finish = pendingFetch(fetchSpy);
      fetchSpy.mockReturnValue(new Promise(() => {}) as unknown as Promise<Response>);
      enqueueN(25, 'batch'); // threshold flush takes these 25
      await tick();
      enqueueN(490, 'later'); // 515 → trimmed to 500, dropping 15 of the in-flight batch
      expect(__getLogQueueLengthForTesting()).toBe(500);

      finish(200);
      await tick();

      // Only the 10 batch records still present leave; every 'later' record stays.
      expect(__getLogQueueLengthForTesting()).toBe(490);
    });
  });
});
