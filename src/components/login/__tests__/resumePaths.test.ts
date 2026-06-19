import { describe, it, expect, beforeEach } from 'vitest';
import {
  RESUME_SETUP,
  RESUME_LOAD_DRIVE,
  isPodlessRecoveryQuery,
  savePendingCreate,
  loadPendingCreate,
  hasPendingCreate,
  consumePendingCreatePassword,
  clearPendingCreate,
} from '../resumePaths';

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

describe('pendingCreate contract (iOS create-resume — 2026-06-19)', () => {
  beforeEach(() => {
    clearPendingCreate();
  });

  it('round-trips the marker + password', () => {
    expect(hasPendingCreate()).toBe(false);
    expect(loadPendingCreate()).toBeNull();

    savePendingCreate({ ownerName: 'Greg' }, 'hunter2pw');

    expect(hasPendingCreate()).toBe(true);
    expect(loadPendingCreate()).toEqual({ ownerName: 'Greg' });
  });

  it('consumePendingCreatePassword reads AND deletes atomically — marker survives', () => {
    savePendingCreate({ ownerName: 'Greg' }, 'hunter2pw');

    expect(consumePendingCreatePassword()).toBe('hunter2pw');
    // Password is gone after a single consume...
    expect(consumePendingCreatePassword()).toBeNull();
    // ...but the (non-secret) marker still says a create-resume is in progress,
    // so the try/finally guard can still clear it on the chain's resolution.
    expect(hasPendingCreate()).toBe(true);
  });

  it('clearPendingCreate wipes BOTH the marker and any lingering password', () => {
    savePendingCreate({ ownerName: 'Greg' }, 'hunter2pw');
    clearPendingCreate();

    expect(hasPendingCreate()).toBe(false);
    expect(loadPendingCreate()).toBeNull();
    expect(consumePendingCreatePassword()).toBeNull();
  });

  it('loadPendingCreate returns null on a malformed marker (no throw)', () => {
    sessionStorage.setItem('beanies:pending-create', '{not json');
    expect(loadPendingCreate()).toBeNull();
  });
});
