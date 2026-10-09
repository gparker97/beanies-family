import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RESUME_SETUP,
  RESUME_LOAD_DRIVE,
  isPodlessRecoveryQuery,
  stashResumeReasonFor,
  consumeResumeReason,
  setResumeReason,
  isResumeSetupSearch,
} from '../resumePaths';
import { DriveConsentDeniedError } from '@/types/sync';

describe('isPodlessRecoveryQuery', () => {
  it('is true for the resume-setup continuation token', () => {
    expect(isPodlessRecoveryQuery(RESUME_SETUP)).toBe(true);
    expect(isPodlessRecoveryQuery('setup')).toBe(true);
  });

  it('is true for the Drive-load picker re-open token (ADR-029)', () => {
    expect(isPodlessRecoveryQuery(RESUME_LOAD_DRIVE)).toBe(true);
    expect(isPodlessRecoveryQuery('load-drive')).toBe(true);
  });

  it('is false for an absent / unrelated / non-string resume value', () => {
    expect(isPodlessRecoveryQuery(undefined)).toBe(false);
    expect(isPodlessRecoveryQuery(null)).toBe(false);
    expect(isPodlessRecoveryQuery('')).toBe(false);
    expect(isPodlessRecoveryQuery('something-else')).toBe(false);
    // Vue Router can hand back an array for repeated query keys — not a match.
    expect(isPodlessRecoveryQuery(['setup'])).toBe(false);
  });
});

describe('stashResumeReasonFor', () => {
  beforeEach(() => {
    try {
      sessionStorage.clear();
    } catch {
      /* storage unavailable — the helper is best-effort by design */
    }
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('on the create return path, stashes the classified code and returns it', () => {
    window.history.replaceState(null, '', '/welcome?resume=setup');
    expect(stashResumeReasonFor(new DriveConsentDeniedError('unticked'))).toBe('consent-denied');
    expect(consumeResumeReason()).toBe('consent-denied');
    // Only Google's explicit policy codes are a block; a described access_denied is its own
    // neutral `access-denied`, and only the bare code is the person's Cancel.
    expect(stashResumeReasonFor(new Error('admin_policy_enforced'))).toBe('app-blocked');
    expect(consumeResumeReason()).toBe('app-blocked');
    expect(stashResumeReasonFor(new Error('access_denied: admin policy'))).toBe('access-denied');
    expect(consumeResumeReason()).toBe('access-denied');
    expect(stashResumeReasonFor(new Error('access_denied'))).toBe('cancelled');
    expect(consumeResumeReason()).toBe('cancelled');
  });

  it('off the create return path, returns the code and stashes NOTHING (reconnect, load)', () => {
    // App.vue's boot catch runs for every Drive grant; only the create return may leave a hint
    // for the next create screen.
    window.history.replaceState(null, '', '/welcome?resume=load-drive');
    expect(stashResumeReasonFor(new DriveConsentDeniedError('unticked'))).toBe('consent-denied');
    expect(consumeResumeReason()).toBeNull();
    window.history.replaceState(null, '', '/settings');
    expect(stashResumeReasonFor(new Error('boom'))).toBe('unknown');
    expect(consumeResumeReason()).toBeNull();
  });
});

describe('setResumeReason / consumeResumeReason (#128, the create registry code)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('round-trips a code once', () => {
    setResumeReason('cancelled');
    expect(consumeResumeReason()).toBe('cancelled');
    expect(consumeResumeReason()).toBeNull();
    setResumeReason('drive-full');
    expect(consumeResumeReason()).toBe('drive-full');
    expect(consumeResumeReason()).toBeNull();
  });

  it('drops (and clears) a legacy reason left mid-redirect across the deploy', () => {
    for (const legacy of ['drive-declined', 'drive-consent']) {
      sessionStorage.setItem('beanies:resume-reason', legacy);
      expect(consumeResumeReason()).toBeNull();
      expect(sessionStorage.getItem('beanies:resume-reason')).toBeNull();
    }
  });

  it('rejects (and clears) a value that is not a registry code', () => {
    sessionStorage.setItem('beanies:resume-reason', 'something-else');
    expect(consumeResumeReason()).toBeNull();
    expect(sessionStorage.getItem('beanies:resume-reason')).toBeNull();
    // An inherited property name is not a code either.
    sessionStorage.setItem('beanies:resume-reason', 'toString');
    expect(consumeResumeReason()).toBeNull();
  });

  it('warns instead of swallowing silently when sessionStorage throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('sessionStorage', {
      setItem: () => {
        throw new Error('quota');
      },
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    });
    expect(() => setResumeReason('cancelled')).not.toThrow();
    expect(consumeResumeReason()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.every((c) => String(c[0]).startsWith('[resumePaths]'))).toBe(true);
  });
});

describe('isResumeSetupSearch (App.vue boot catch, #128)', () => {
  it('is true only for the resume-setup return', () => {
    expect(isResumeSetupSearch('?resume=setup')).toBe(true);
    expect(isResumeSetupSearch('?resume=setup&utm_source=chatgpt')).toBe(true);
    expect(isResumeSetupSearch('?utm_source=x&resume=setup')).toBe(true);
  });

  it('is false for every other return (load-drive, calendar, reconnect, none)', () => {
    expect(isResumeSetupSearch('?resume=load-drive')).toBe(false);
    expect(isResumeSetupSearch('?open=calendar-sync&calResume=connect')).toBe(false);
    expect(isResumeSetupSearch('')).toBe(false);
    expect(isResumeSetupSearch('?resume=setupx')).toBe(false);
  });
});
