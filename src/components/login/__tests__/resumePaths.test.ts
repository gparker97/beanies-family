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

  it('stashes and reports true ONLY for a consent denial', () => {
    expect(stashResumeReasonFor(new DriveConsentDeniedError('unticked'))).toBe(true);
    expect(consumeResumeReason()).toBe('drive-consent');
  });

  it('reports false and stashes nothing for any other failure', () => {
    // `App.vue`'s web boot catch classifies its report on this boolean, so a false positive
    // would downgrade a genuine code fault from `error` to `warning`.
    expect(stashResumeReasonFor(new Error('network'))).toBe(false);
    expect(stashResumeReasonFor(undefined)).toBe(false);
    expect(consumeResumeReason()).toBeNull();
  });
});

describe('setResumeReason / consumeResumeReason (#128 reason union)', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('round-trips both reasons once', () => {
    setResumeReason('drive-declined');
    expect(consumeResumeReason()).toBe('drive-declined');
    expect(consumeResumeReason()).toBeNull();
    setResumeReason('drive-consent');
    expect(consumeResumeReason()).toBe('drive-consent');
    expect(consumeResumeReason()).toBeNull();
  });

  it('rejects (and clears) a value outside the union', () => {
    sessionStorage.setItem('beanies:resume-reason', 'something-else');
    expect(consumeResumeReason()).toBeNull();
    expect(sessionStorage.getItem('beanies:resume-reason')).toBeNull();
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
    expect(() => setResumeReason('drive-declined')).not.toThrow();
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
