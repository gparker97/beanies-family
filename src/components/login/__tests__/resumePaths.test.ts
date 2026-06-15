import { describe, it, expect } from 'vitest';
import { RESUME_SETUP, RESUME_LOAD_DRIVE, isPodlessRecoveryQuery } from '../resumePaths';

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
