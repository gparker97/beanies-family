/**
 * Telling a Google THROTTLE from a Google REFUSAL.
 *
 * Both Google clients hit the same trap — Google answers rate limiting with 403,
 * not 429 — and each turned it into a different wrong answer: Calendar parked the
 * connection as broken and paged Slack, Drive reported the file as missing. This
 * is the one rule they now share.
 */
import { describe, it, expect } from 'vitest';
import {
  extractGoogleError,
  isGoogleThrottleReason,
  isGoogleRetryableThrottleReason,
} from '../googleApiError';

describe('extractGoogleError', () => {
  it('pulls the reason and message out of a real Google error body', () => {
    expect(
      extractGoogleError({
        error: { message: 'Rate Limit Exceeded', errors: [{ reason: 'rateLimitExceeded' }] },
      })
    ).toEqual({
      reason: 'rateLimitExceeded',
      message: 'Rate Limit Exceeded',
      detail: 'rateLimitExceeded: Rate Limit Exceeded',
    });
  });

  it('🔴 is TOTAL — it never throws on a body that is not the expected shape', () => {
    // Callers hand it whatever they managed to parse, inside a catch. A throw
    // here would replace a classified API error with a parse error.
    for (const junk of [null, undefined, 'a string', 42, {}, { error: null }, { error: {} }]) {
      expect(() => extractGoogleError(junk)).not.toThrow();
      expect(extractGoogleError(junk).detail).toBe('');
    }
  });

  it('ignores non-string reason/message rather than stringifying them', () => {
    const out = extractGoogleError({ error: { message: { a: 1 }, errors: [{ reason: 7 }] } });
    expect(out.reason).toBeUndefined();
    expect(out.message).toBeUndefined();
  });

  it('survives an errors array that is present but empty', () => {
    expect(extractGoogleError({ error: { message: 'Boom', errors: [] } })).toEqual({
      reason: undefined,
      message: 'Boom',
      detail: 'Boom',
    });
  });
});

describe('which 403s are throttles', () => {
  it.each(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded'])(
    '%s is a throttle',
    (reason) => {
      expect(isGoogleThrottleReason(reason)).toBe(true);
    }
  );

  it.each(['insufficientPermissions', 'forbidden', 'appNotAuthorizedToFile', 'domainPolicy'])(
    '🔴 %s is a genuine refusal, not a throttle',
    (reason) => {
      // The other half of the split. Treating a dropped scope as a throttle would
      // retry it three times a poll forever and never surface the real problem.
      expect(isGoogleThrottleReason(reason)).toBe(false);
    }
  );

  it('🔴 an absent reason is NOT a throttle', () => {
    // Conservative default: an unreadable body must keep the pre-fix answer
    // (terminal), never be guessed into a retry.
    expect(isGoogleThrottleReason(undefined)).toBe(false);
  });
});

describe('which throttles are worth retrying', () => {
  it.each(['rateLimitExceeded', 'userRateLimitExceeded'])('%s backs off and retries', (reason) => {
    expect(isGoogleRetryableThrottleReason(reason)).toBe(true);
  });

  it.each(['quotaExceeded', 'dailyLimitExceeded'])(
    '🔴 %s is a throttle but is NOT retried',
    (reason) => {
      // Project-level: the allowance cannot return inside a two-second backoff, so
      // retrying spends guaranteed-futile requests against an exhausted SHARED
      // quota, from every device at once.
      expect(isGoogleThrottleReason(reason)).toBe(true);
      expect(isGoogleRetryableThrottleReason(reason)).toBe(false);
    }
  );
});
