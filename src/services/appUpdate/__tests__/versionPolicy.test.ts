/**
 * The update floor's fetch, and every way it can fail.
 *
 * ⚠️ THE CASE THAT MATTERS MOST IS THE HAPPY ONE WITH AN ALREADY-PARSED BODY.
 * `CapacitorHttp` parses `application/json` for you, which is what S3 serves for
 * a `.json` key, so a naive `JSON.parse(res.data)` throws on every real device.
 * Because the floor fails open, that would have looked exactly like a healthy
 * fleet forever. Fail-open plus a broken transport is indistinguishable from
 * fail-open plus nothing to say, which is why each failure gets its own class.
 *
 * `@capacitor/core` is mocked: `CapacitorHttp` falls back to the platform fetch
 * on web, so an unmocked test would make a real network call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: http }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { logEvent } from '@/services/telemetry/logEvent';
import { fetchUpdateFloor, __resetVersionPolicyForTesting } from '../versionPolicy';

function lastFailure(): string | undefined {
  const call = vi
    .mocked(logEvent)
    .mock.calls.map((c) => c[0])
    .filter((e) => e.surface === 'app-update')
    .at(-1);
  return call?.context?.detail as string | undefined;
}

describe('fetchUpdateFloor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetVersionPolicyForTesting();
  });

  it('reads the version from an ALREADY-PARSED body, which is what a device gets', () => {
    // The regression this whole file exists for.
    http.get.mockResolvedValueOnce({ status: 200, data: { promptBelowVersion: '0.17' } });
    return expect(fetchUpdateFloor()).resolves.toBe('0.17');
  });

  it('reads the version from a string body too', async () => {
    http.get.mockResolvedValueOnce({ status: 200, data: '{"promptBelowVersion":"0.17"}' });
    await expect(fetchUpdateFloor()).resolves.toBe('0.17');
  });

  it('asks the apex for the right file, with an hour bucket', async () => {
    http.get.mockResolvedValueOnce({ status: 200, data: { promptBelowVersion: '0.17' } });
    await fetchUpdateFloor();
    const arg = http.get.mock.calls[0]![0] as { url: string; params: Record<string, string> };
    expect(arg.url).toMatch(/\/min-app-version\.json$/);
    expect(Number(arg.params.h)).toBe(Math.floor(Date.now() / 3_600_000));
  });

  it('memoises for the process, so resume does not re-fetch', async () => {
    http.get.mockResolvedValue({ status: 200, data: { promptBelowVersion: '0.17' } });
    await fetchUpdateFloor();
    await fetchUpdateFloor();
    await fetchUpdateFloor();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a non-200', { status: 404, data: '' }, 'http-404'],
    ['a body that is not JSON', { status: 200, data: 'not json {' }, 'malformed'],
    ['a body of the wrong shape', { status: 200, data: { nope: true } }, 'malformed'],
    [
      'a version-shaped-but-unparseable string',
      { status: 200, data: { promptBelowVersion: 'v0.17-beta' } },
      'unparseable-version',
    ],
  ])('fails OPEN on %s, with its own class', async (_label, response, expected) => {
    http.get.mockResolvedValueOnce(response);
    await expect(fetchUpdateFloor()).resolves.toBeNull();
    expect(lastFailure()).toBe(expected);
  });

  it.each([
    ['a network error', 'Network request failed', 'offline'],
    ['a timeout', 'Request timeout', 'timeout'],
  ])('fails OPEN when the request throws (%s)', async (_label, message, expected) => {
    http.get.mockRejectedValueOnce(new Error(message));
    await expect(fetchUpdateFloor()).resolves.toBeNull();
    expect(lastFailure()).toBe(expected);
  });

  it('never throws, whatever comes back', async () => {
    http.get.mockRejectedValueOnce('a string, not an Error');
    await expect(fetchUpdateFloor()).resolves.toBeNull();
  });

  it('reports at warn and never pages', async () => {
    http.get.mockRejectedValueOnce(new Error('Network request failed'));
    await fetchUpdateFloor();
    const ev = vi.mocked(logEvent).mock.calls.map((c) => c[0])[0]!;
    expect(ev.level).toBe('warn');
    expect(ev.surface).toBe('app-update');
    // A constant message, so the (surface, message) rate limiter buckets these
    // together rather than giving every failing device its own bucket.
    expect(ev.message).toBe('update floor unavailable');
  });
});
