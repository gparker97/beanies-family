import { describe, it, expect } from 'vitest';
import {
  isPermanentRefreshFailure,
  isRefreshRejection,
  googleOAuthErrorCode,
} from '../refreshFailure';

describe('isPermanentRefreshFailure', () => {
  it.each([
    'Token refresh failed: invalid_grant',
    'invalid_grant — Token has been expired or revoked.',
    // googleAuth historically matched only the full phrase; the calendar client
    // matched the shorter substring. The consolidated rule must cover both,
    // because Google's wording varies across endpoints.
    'Token has been expired or revoked.',
    'The refresh token is expired or revoked',
  ])('treats %s as permanent', (message) => {
    expect(isPermanentRefreshFailure(message)).toBe(true);
    expect(isPermanentRefreshFailure(new Error(message))).toBe(true);
  });

  it.each([
    'Failed to fetch',
    'OAuth proxy fetch timed out after 15000ms — silent refresh failed',
    'HTTP 503',
    'NetworkError when attempting to fetch resource',
  ])('treats %s as transient', (message) => {
    expect(isPermanentRefreshFailure(message)).toBe(false);
  });

  it('never mistakes a non-Error, non-string throw for a revocation', () => {
    // Misclassifying here would clear a WORKING refresh token and force the
    // user to re-consent. Fail closed.
    expect(isPermanentRefreshFailure(undefined)).toBe(false);
    expect(isPermanentRefreshFailure(null)).toBe(false);
    expect(isPermanentRefreshFailure({ error: 'invalid_grant' })).toBe(false);
  });
});

describe('isRefreshRejection', () => {
  // Added 2026-09-08 with the silent-refresh escalation gate. Each case below is
  // a hole a review found in the first cut, and any one of them alone defeats
  // the gate — either by never escalating a real refusal, or by escalating
  // something the module header declares transient.
  it('matches a 4xx, which is Google refusing the exchange', () => {
    expect(isRefreshRejection('Token refresh failed: HTTP 400 — invalid_request')).toBe(true);
    expect(isRefreshRejection(new Error('Token refresh failed: HTTP 401 — unauthorized'))).toBe(
      true
    );
  });

  it('does NOT match a 5xx — that is our proxy failing, not the grant', () => {
    expect(isRefreshRejection('Token refresh failed: HTTP 500 — boom')).toBe(false);
    expect(isRefreshRejection('Token refresh failed: HTTP 503 — upstream unavailable')).toBe(false);
  });

  it('does NOT match 408 or 429, which the module header calls transient', () => {
    // An API Gateway usage-plan throttle returns a JSON 429. Counting it would
    // force a Google consent screen for a rate limit, which is the exact harm
    // the gate exists to prevent, and would disagree with `googleRevoke`.
    expect(isRefreshRejection('Token refresh failed: HTTP 429 — Too Many Requests')).toBe(false);
    expect(isRefreshRejection('Token refresh failed: HTTP 408 — Request Timeout')).toBe(false);
    // 403 too: our proxy returns it for a missing API key and for a WAF block,
    // and Google for rateLimitExceeded. `googleRevoke` classes it transient and
    // these two predicates must agree.
    expect(isRefreshRejection('Token refresh failed: HTTP 403 — forbidden')).toBe(false);
  });

  it('does NOT match a message with no status at all', () => {
    expect(isRefreshRejection('Token refresh failed: network error')).toBe(false);
    expect(isRefreshRejection(undefined)).toBe(false);
    expect(isRefreshRejection(null)).toBe(false);
  });
});

describe('googleOAuthErrorCode — the code a CloudWatch filter can key on (2026-09-23)', () => {
  it('lifts the code out of the thrown refresh message', () => {
    expect(
      googleOAuthErrorCode(
        'Token refresh failed: HTTP 400 — invalid_grant: Token has been expired or revoked.'
      )
    ).toBe('invalid_grant');
  });

  it('tells a REVOKED GRANT apart from a BROKEN OAUTH CLIENT', () => {
    // ⚠️ THE WHOLE POINT. One is a single family reconnecting; the other is every family in the
    // fleet failing at once because our client is misconfigured. Before this they were the same
    // string in CloudWatch, because only `error_description` survived.
    expect(googleOAuthErrorCode('Token refresh failed: HTTP 400 — invalid_grant: …')).toBe(
      'invalid_grant'
    );
    expect(googleOAuthErrorCode('Token refresh failed: HTTP 401 — invalid_client: …')).toBe(
      'invalid_client'
    );
  });

  it('never shadows a longer code with a shorter one', () => {
    // `invalid_request` must not be reported for `invalid_requested_scope`-style prose, and a
    // shorter member must not win by ordering.
    expect(googleOAuthErrorCode('HTTP 400 — unsupported_grant_type: nope')).toBe(
      'unsupported_grant_type'
    );
  });

  it('returns null rather than inventing a code', () => {
    // The old production message shape, from release 0.16, which carried no code at all.
    expect(googleOAuthErrorCode('Token refresh failed: Bad Request')).toBeNull();
    expect(googleOAuthErrorCode('Failed to fetch')).toBeNull();
    expect(googleOAuthErrorCode(undefined)).toBeNull();
    expect(googleOAuthErrorCode(new Error('Token refresh failed: empty response'))).toBeNull();
  });
});
