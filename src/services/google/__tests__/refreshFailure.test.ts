import { describe, it, expect } from 'vitest';
import { isPermanentRefreshFailure } from '../refreshFailure';

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
