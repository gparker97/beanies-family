/**
 * `classifyOAuthError`: the one bare-vs-described `access_denied` rule shared by the web callback
 * page and the native deep link (#128). Plus the three OAuth string predicates that live beside
 * it (`isUserCancellation` and `isPopupBlocked`, moved here from `googleAuth` with their cases,
 * `isOAuthPolicyBlock` and `isOAuthDescribedAccessDenied`).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyOAuthError,
  isOAuthDescribedAccessDenied,
  isOAuthPolicyBlock,
  isPopupBlocked,
  isUserCancellation,
  MAX_OAUTH_ERROR_DESCRIPTION,
  POPUP_BLOCKED_MESSAGE,
} from '../oauthError';

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

  it('a DESCRIBED access_denied is forwarded with its description, not as the bare decline', () => {
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

describe('isUserCancellation', () => {
  it('treats an AbortError (file-picker cancel) as a cancellation', () => {
    const e = new Error('The user aborted a request.');
    e.name = 'AbortError';
    expect(isUserCancellation(e)).toBe(true);
  });

  it('treats popup-closed / dismiss / user_cancel messages as cancellations', () => {
    expect(isUserCancellation(new Error('popup_closed_by_user'))).toBe(true);
    expect(isUserCancellation(new Error('User cancelled the flow'))).toBe(true);
    expect(isUserCancellation(new Error('Account chooser dismissed'))).toBe(true);
    expect(isUserCancellation('user_cancel')).toBe(true);
  });

  it("treats Google's BARE access_denied (Cancel/Back on the consent screen) as a cancellation (#128)", () => {
    expect(isUserCancellation(new Error('access_denied'))).toBe(true);
    expect(isUserCancellation('access_denied')).toBe(true);
    expect(isUserCancellation(new Error(' ACCESS_DENIED '))).toBe(true);
  });

  it('does NOT treat a message that merely contains access_denied as a cancellation', () => {
    // A described denial may be an unverified app's test-user restriction, which the join and
    // settings flows must report. The create flow matches it with `isOAuthDescribedAccessDenied`.
    expect(
      isUserCancellation(new Error('access_denied: Access blocked by your administrator'))
    ).toBe(false);
    expect(isUserCancellation(new Error('OAuth error: access_denied'))).toBe(false);
  });

  it('does not treat genuine failures as cancellations', () => {
    expect(isUserCancellation(new Error('Network request failed'))).toBe(false);
    expect(isUserCancellation(new Error('403 Forbidden'))).toBe(false);
    expect(isUserCancellation(null)).toBe(false);
    expect(isUserCancellation(undefined)).toBe(false);
  });
});

describe('isPopupBlocked', () => {
  it('matches the message the popup opener throws, and only a refusal', () => {
    expect(isPopupBlocked(new Error(POPUP_BLOCKED_MESSAGE))).toBe(true);
    expect(isPopupBlocked(POPUP_BLOCKED_MESSAGE)).toBe(true);
    // A CLOSED popup is a cancel, not a block.
    expect(isPopupBlocked(new Error('Authentication cancelled'))).toBe(false);
    expect(isPopupBlocked(new Error('popup_closed_by_user'))).toBe(false);
  });

  it('a blocked popup is NOT a cancellation: the person can fix it and must be told', () => {
    expect(isUserCancellation(new Error(POPUP_BLOCKED_MESSAGE))).toBe(false);
  });
});

describe('isOAuthPolicyBlock', () => {
  it("matches only Google's explicit policy codes", () => {
    expect(isOAuthPolicyBlock('admin_policy_enforced')).toBe(true);
    expect(isOAuthPolicyBlock(new Error(' org_internal '))).toBe(true);
    expect(isOAuthPolicyBlock('ADMIN_POLICY_ENFORCED')).toBe(true);
  });

  it('does NOT match any access_denied, bare or described (a description does not prove a block)', () => {
    expect(isOAuthPolicyBlock('access_denied')).toBe(false);
    expect(isOAuthPolicyBlock(new Error('access_denied'))).toBe(false);
    // The #128 fixture is a localized plain decline that carries a description.
    expect(isOAuthPolicyBlock(new Error('access_denied: Access blocked by your admin'))).toBe(
      false
    );
    expect(isOAuthPolicyBlock(classifyOAuthError('access_denied', 'blocked')!.message)).toBe(false);
  });

  it('does NOT match anything else', () => {
    expect(isOAuthPolicyBlock(new Error('admin_policy_enforced by someone'))).toBe(false);
    expect(isOAuthPolicyBlock(new Error('OAuth error: org_internal'))).toBe(false);
    expect(isOAuthPolicyBlock(null)).toBe(false);
  });
});

describe('isOAuthDescribedAccessDenied', () => {
  it('matches a described access_denied (the classifyOAuthError forward)', () => {
    expect(isOAuthDescribedAccessDenied(new Error('access_denied: Zugriff verweigert'))).toBe(true);
    expect(isOAuthDescribedAccessDenied(' ACCESS_DENIED: blocked ')).toBe(true);
    // Round-trips the one producer of the described form, including a multi-line description.
    expect(
      isOAuthDescribedAccessDenied(
        classifyOAuthError('access_denied', 'line one\nline two')!.message
      )
    ).toBe(true);
  });

  it("does NOT match the bare code: that is the person's own Cancel (isUserCancellation)", () => {
    expect(isOAuthDescribedAccessDenied('access_denied')).toBe(false);
    expect(isOAuthDescribedAccessDenied(new Error(' access_denied '))).toBe(false);
    expect(isUserCancellation('access_denied')).toBe(true);
  });

  it('does NOT match a message that merely contains it, a policy code, or nothing', () => {
    expect(isOAuthDescribedAccessDenied(new Error('OAuth error: access_denied: x'))).toBe(false);
    expect(isOAuthDescribedAccessDenied('access_denied_by_proxy')).toBe(false);
    expect(isOAuthDescribedAccessDenied('admin_policy_enforced')).toBe(false);
    expect(isOAuthDescribedAccessDenied(null)).toBe(false);
  });

  it('is kept apart from isUserCancellation, whose exact match the join flow relies on', () => {
    const described = new Error('access_denied: app has not completed verification');
    expect(isOAuthDescribedAccessDenied(described)).toBe(true);
    expect(isUserCancellation(described)).toBe(false);
  });
});
