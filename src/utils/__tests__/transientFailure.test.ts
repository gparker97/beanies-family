import { describe, it, expect } from 'vitest';
import { classifyTransientFailure, isNetworkError, TRANSIENT_FAILURES } from '../transientFailure';

// ─── Real platform strings ──────────────────────────────────────────────────
//
// Pinned as named constants so a future edit to the classifier's regexes is
// checked against what the platforms actually say, not against what a test
// author remembered. Sources: WebKit / Chrome / Firefox `fetch` rejections;
// iOS URLSession (NSURLError) localized descriptions, also pinned in
// `versionPolicy.test.ts` and lessons.md #27.
const WEBKIT_NETWORK = 'Load failed';
const IOS_URLSESSION_TIMEOUT = 'The request timed out.';
const IOS_URLSESSION_OFFLINE = 'The Internet connection appears to be offline.';
const IOS_URLSESSION_DNS = 'A server with the specified hostname could not be found.';
const IOS_URLSESSION_CANNOT_CONNECT = 'Could not connect to the server.';
const CHROME_NETWORK = 'Failed to fetch';
const FIREFOX_NETWORK = 'NetworkError when attempting to fetch resource.';

/** A `DriveApiError`-shaped value, as the hand-written `driveService` mocks build it. */
function httpError(status: number, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Drive API error ${status}`), { status }, extra);
}

describe('isNetworkError', () => {
  it('matches Chrome/Edge "Failed to fetch"', () => {
    expect(isNetworkError(new TypeError(CHROME_NETWORK))).toBe(true);
  });

  it('matches Safari/iOS WebKit "Load failed" (the finding-6 gap)', () => {
    expect(isNetworkError(new TypeError(WEBKIT_NETWORK))).toBe(true);
  });

  it('matches Firefox "NetworkError…"', () => {
    expect(isNetworkError(new TypeError(FIREFOX_NETWORK))).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isNetworkError(new Error('Unauthorized'))).toBe(false);
    expect(isNetworkError(new Error('Out of bounds table access'))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isNetworkError(WEBKIT_NETWORK)).toBe(true);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe('TRANSIENT_FAILURES', () => {
  it('lists exactly the three classes the classifier can return', () => {
    expect([...TRANSIENT_FAILURES]).toEqual(['timeout', 'server', 'network']);
  });
});

describe('classifyTransientFailure', () => {
  describe('timeout', () => {
    it('our sized Drive deadline (DriveTimeoutError-shaped: 408 + timedOut)', () => {
      const e = httpError(408, { name: 'DriveTimeoutError', timedOut: true });
      expect(classifyTransientFailure(e)).toBe('timeout');
    });

    it('timedOut wins over the status, whatever the status', () => {
      expect(classifyTransientFailure(httpError(400, { timedOut: true }))).toBe('timeout');
    });

    it("the platform's own deadline: a status-less TypeError (iOS URLSession)", () => {
      expect(classifyTransientFailure(new TypeError(IOS_URLSESSION_TIMEOUT))).toBe('timeout');
    });
  });

  describe('plain Errors that say "timed out" are NOT platform timeouts', () => {
    it.each([
      ["doc-worker 'merge' timed out"],
      ['cache open timed out after 5000ms (IndexedDB open blocked)'],
    ])('%s → null', (message) => {
      expect(classifyTransientFailure(new Error(message))).toBeNull();
    });
  });

  describe('server', () => {
    it.each([408, 500, 502, 503, 504])('HTTP %i → server', (status) => {
      expect(classifyTransientFailure(httpError(status))).toBe('server');
    });

    it('a genuine Google 408 (timedOut absent or false) is server, not timeout', () => {
      expect(classifyTransientFailure(httpError(408, { timedOut: false }))).toBe('server');
    });
  });

  describe('non-transient HTTP answers', () => {
    it.each([400, 401, 403, 404, 429])('HTTP %i → null', (status) => {
      expect(classifyTransientFailure(httpError(status))).toBeNull();
    });

    it('an HTTP error is never misread as network by its message', () => {
      const e = httpError(400);
      e.message = CHROME_NETWORK;
      expect(classifyTransientFailure(e)).toBeNull();
    });
  });

  describe('network', () => {
    it.each([
      ['WEBKIT_NETWORK', WEBKIT_NETWORK],
      ['CHROME_NETWORK', CHROME_NETWORK],
      ['FIREFOX_NETWORK', FIREFOX_NETWORK],
    ])('%s as a TypeError → network', (_name, message) => {
      expect(classifyTransientFailure(new TypeError(message))).toBe('network');
    });

    it.each([
      ['WEBKIT_NETWORK', WEBKIT_NETWORK],
      ['CHROME_NETWORK', CHROME_NETWORK],
      ['FIREFOX_NETWORK', FIREFOX_NETWORK],
    ])('%s as a plain Error → network (not gated on TypeError)', (_name, message) => {
      expect(classifyTransientFailure(new Error(message))).toBe('network');
    });

    it.each([
      ['IOS_URLSESSION_OFFLINE', IOS_URLSESSION_OFFLINE],
      ['IOS_URLSESSION_DNS', IOS_URLSESSION_DNS],
      ['IOS_URLSESSION_CANNOT_CONNECT', IOS_URLSESSION_CANNOT_CONNECT],
    ])('%s as a TypeError → network', (_name, message) => {
      expect(classifyTransientFailure(new TypeError(message))).toBe('network');
    });
  });

  describe('not transient', () => {
    it('unrelated errors and non-errors → null', () => {
      expect(classifyTransientFailure(new Error('Unauthorized'))).toBeNull();
      expect(classifyTransientFailure(new TypeError('x is not a function'))).toBeNull();
      expect(classifyTransientFailure(null)).toBeNull();
      expect(classifyTransientFailure(undefined)).toBeNull();
      expect(classifyTransientFailure('boom')).toBeNull();
    });

    it('a non-numeric status is ignored, falling through to the message', () => {
      expect(classifyTransientFailure({ status: '503', message: 'nope' })).toBeNull();
    });
  });
});
