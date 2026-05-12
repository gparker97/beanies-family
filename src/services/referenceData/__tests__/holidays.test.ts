// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadHolidays } from '@/services/referenceData/holidays';
import * as cache from '@/services/indexeddb/repositories/referenceDataCacheRepository';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const goodFile = {
  meta: {
    country: 'SG',
    name: 'Singapore',
    generatedAt: '2026-05-12',
    yearRange: [2025, 2029],
    source: 'date-holidays@3.28.0',
    primaryLanguage: 'en',
    types: ['public'],
  },
  holidays: [
    { date: '2026-01-01', name: "New Year's Day", type: 'public' },
    { date: '2026-05-31', name: 'Vesak Day', type: 'public' },
  ],
};

describe('referenceData/holidays loadHolidays', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await cache.clearAll();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches, validates, caches and returns records on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(goodFile));
    vi.stubGlobal('fetch', fetchMock);

    const result = await loadHolidays('SG');
    expect(result.ok).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.records.map((r) => r.name)).toEqual(["New Year's Day", 'Vesak Day']);
    expect(fetchMock).toHaveBeenCalledWith('/holidays/SG.json');

    // Second call within the TTL is served from cache — no second fetch.
    fetchMock.mockClear();
    const cached = await loadHolidays('SG');
    expect(cached.ok).toBe(true);
    expect(cached.records).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] gracefully on a 404 (country not covered), not retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const result = await loadHolidays('XX');
    expect(result).toEqual({ records: [], ok: false, retryable: false });
  });

  it('returns [] but retryable on a network error with no cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await loadHolidays('SG');
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to a stale cache (not retryable) when a later fetch fails', async () => {
    // Seed a stale cache entry (cachedAt well outside the 7-day TTL).
    await cache.saveCachedHolidays({
      country: 'SG',
      generatedAt: '2025-01-01',
      yearRange: [2024, 2028],
      cachedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      holidays: [{ date: '2026-01-01', name: "New Year's Day", type: 'public' }],
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await loadHolidays('SG');
    expect(result.ok).toBe(true);
    expect(result.retryable).toBe(false);
    expect(result.records).toHaveLength(1);
  });

  it('returns [] when the file shape is wrong (build bug)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ nope: true })));
    const result = await loadHolidays('SG');
    expect(result).toEqual({ records: [], ok: false, retryable: false });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('drops individual malformed records but keeps the good ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...goodFile,
          holidays: [
            { date: '2026-01-01', name: "New Year's Day", type: 'public' },
            { date: 'not-a-date', name: 'Bad', type: 'public' },
            { date: '2026-12-25', name: '', type: 'public' },
            { date: '2026-12-25', name: 'Christmas Day', type: 'public' },
          ],
        })
      )
    );
    const result = await loadHolidays('SG');
    expect(result.records.map((r) => r.name)).toEqual(["New Year's Day", 'Christmas Day']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does not crash when the cache write throws — still returns the fetched records', async () => {
    vi.spyOn(cache, 'saveCachedHolidays').mockRejectedValue(new Error('quota'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(goodFile)));
    const result = await loadHolidays('SG');
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(2);
  });
});
