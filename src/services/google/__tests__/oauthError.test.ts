/**
 * `classifyOAuthError`: the one bare-vs-described `access_denied` rule shared by the web callback
 * page and the native deep link (#128).
 */
import { describe, it, expect } from 'vitest';
import { classifyOAuthError, MAX_OAUTH_ERROR_DESCRIPTION } from '../oauthError';

describe('classifyOAuthError', () => {
  it('no error is null, whatever the description says', () => {
    expect(classifyOAuthError(null, null)).toBeNull();
    expect(classifyOAuthError('', 'anything')).toBeNull();
  });

  it('a BARE access_denied is a decline', () => {
    expect(classifyOAuthError('access_denied', null)).toEqual({
      message: 'access_denied',
      kind: 'declined',
    });
    // A whitespace-only description is no description.
    expect(classifyOAuthError('access_denied', '   ')).toEqual({
      message: 'access_denied',
      kind: 'declined',
    });
  });

  it('a DESCRIBED access_denied is a policy block: an error, forwarded with its description', () => {
    expect(classifyOAuthError('access_denied', ' Access blocked by your admin ')).toEqual({
      message: 'access_denied: Access blocked by your admin',
      kind: 'error',
    });
  });

  it('caps the attacker-controllable description', () => {
    const r = classifyOAuthError('access_denied', 'x'.repeat(5000));
    expect(r?.kind).toBe('error');
    expect(r?.message).toBe(`access_denied: ${'x'.repeat(MAX_OAUTH_ERROR_DESCRIPTION)}`);
  });

  it('every other error is an error, forwarded unchanged (its description is not appended)', () => {
    expect(classifyOAuthError('server_error', 'Google had a moment')).toEqual({
      message: 'server_error',
      kind: 'error',
    });
    expect(classifyOAuthError('invalid_scope', null)).toEqual({
      message: 'invalid_scope',
      kind: 'error',
    });
  });
});
