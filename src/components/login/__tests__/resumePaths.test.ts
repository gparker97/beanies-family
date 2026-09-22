import { describe, it, expect, beforeEach } from 'vitest';
import {
  RESUME_SETUP,
  RESUME_LOAD_DRIVE,
  isPodlessRecoveryQuery,
  stashResumeReasonFor,
  consumeResumeReason,
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
