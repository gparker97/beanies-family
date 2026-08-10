/**
 * Pod-access taxonomy tests.
 *
 * The load-bearing assertion in this file is the LAST one: no entry in
 * `POD_ACCESS_ERRORS` may offer a recovery that creates a `.beanpod`. That is the
 * binding product constraint from the 2026-08-10 incident, and a test is the only
 * thing that keeps it true once someone is deep in a future bug and a "just make
 * a new one" fallback looks tempting.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  POD_ACCESS_ERRORS,
  POD_ACCESS_SEVERITY,
  classifyDriveFailure,
  evaluatePodMetadata,
  type PodAccessErrorCode,
} from '../podAccess';
import { DriveApiError, DriveFileNotFoundError } from '@/services/google/driveService';
import { TokenExpiredError } from '@/services/google/googleAuth';

const ALL_CODES: PodAccessErrorCode[] = [
  'OFFLINE',
  'PERMISSION_DENIED',
  'CONSENT_EXPIRED',
  'FILE_NOT_FOUND',
  'VERIFY_UNAVAILABLE',
  'CANONICAL_MISMATCH',
  'NO_HOME',
];

function setOnline(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('classifyDriveFailure', () => {
  it('classifies offline before anything else', () => {
    setOnline(false);
    // Even a 404 is reported as offline — the file may be perfectly fine and
    // simply unreachable, and telling the user their file is gone would be wrong.
    expect(classifyDriveFailure(new DriveFileNotFoundError('gone', 404))).toBe('OFFLINE');
  });

  it.each([
    ['403 → permission denied', new DriveFileNotFoundError('forbidden', 403), 'PERMISSION_DENIED'],
    ['404 → file not found', new DriveFileNotFoundError('missing', 404), 'FILE_NOT_FOUND'],
    ['401 → consent expired', new DriveApiError('unauthorized', 401), 'CONSENT_EXPIRED'],
    ['408 → verify unavailable', new DriveApiError('Request timed out', 408), 'VERIFY_UNAVAILABLE'],
    ['500 → verify unavailable', new DriveApiError('server error', 500), 'VERIFY_UNAVAILABLE'],
    ['unknown → verify unavailable', new Error('what'), 'VERIFY_UNAVAILABLE'],
  ] as const)('%s', (_label, error, expected) => {
    setOnline(true);
    expect(classifyDriveFailure(error)).toBe(expected);
  });

  it('discriminates 403 from 404 by status, not by class', () => {
    setOnline(true);
    // driveService throws DriveFileNotFoundError for BOTH — switching on
    // instanceof would collapse a sharing-revoked into a file-deleted and send
    // the user hunting for a file that is still exactly where it was.
    const forbidden = new DriveFileNotFoundError('forbidden', 403);
    const missing = new DriveFileNotFoundError('missing', 404);
    expect(forbidden).toBeInstanceOf(DriveFileNotFoundError);
    expect(missing).toBeInstanceOf(DriveFileNotFoundError);
    expect(classifyDriveFailure(forbidden)).not.toBe(classifyDriveFailure(missing));
  });

  it('classifies a token-expiry as consent expired', () => {
    setOnline(true);
    expect(classifyDriveFailure(new TokenExpiredError('silent refresh failed'))).toBe(
      'CONSENT_EXPIRED'
    );
  });
});

describe('evaluatePodMetadata', () => {
  it('accepts a file the member can edit but does NOT own', () => {
    // The whole point: ownership is never consulted. This is every non-owner
    // member's normal, healthy state.
    expect(evaluatePodMetadata({ capabilities: { canEdit: true }, trashed: false })).toBeNull();
  });

  it('reads canEdit from the NESTED capabilities object', () => {
    // `capabilities/canEdit` is nested in the Drive response. Reading a flat
    // `meta.canEdit` yields undefined on every healthy file — a silent, universal
    // false positive. This pins the shape.
    const flatShape = { canEdit: true, trashed: false } as unknown as {
      capabilities?: { canEdit?: boolean };
      trashed?: boolean;
    };
    expect(evaluatePodMetadata(flatShape)).toBe('VERIFY_UNAVAILABLE');
  });

  it('reports a revoked file as permission denied', () => {
    expect(evaluatePodMetadata({ capabilities: { canEdit: false }, trashed: false })).toBe(
      'PERMISSION_DENIED'
    );
  });

  it('reports a trashed file as not found, even when still editable', () => {
    expect(evaluatePodMetadata({ capabilities: { canEdit: true }, trashed: true })).toBe(
      'FILE_NOT_FOUND'
    );
  });

  it('reports unreadable metadata as unavailable, not denied', () => {
    // No arm of the verification mutates anything, so failing closed buys no
    // safety here and would only manufacture false criticals for a parse problem.
    expect(evaluatePodMetadata(null)).toBe('VERIFY_UNAVAILABLE');
    expect(evaluatePodMetadata({})).toBe('VERIFY_UNAVAILABLE');
  });
});

describe('POD_ACCESS_ERRORS registry', () => {
  it('has an entry and a severity for every code', () => {
    for (const code of ALL_CODES) {
      expect(POD_ACCESS_ERRORS[code], code).toBeDefined();
      expect(POD_ACCESS_SEVERITY[code], code).toMatch(/^(warning|critical)$/);
    }
  });

  it('agrees with itself about severity', () => {
    for (const code of ALL_CODES) {
      expect(POD_ACCESS_ERRORS[code].severity, code).toBe(POD_ACCESS_SEVERITY[code]);
    }
  });

  it('treats transient failures as warnings and data-at-risk as critical', () => {
    expect(POD_ACCESS_SEVERITY.OFFLINE).toBe('warning');
    expect(POD_ACCESS_SEVERITY.VERIFY_UNAVAILABLE).toBe('warning');
    // A member writing to a non-canonical pod is live data divergence.
    expect(POD_ACCESS_SEVERITY.CANONICAL_MISMATCH).toBe('critical');
    expect(POD_ACCESS_SEVERITY.NO_HOME).toBe('critical');
  });

  it('NEVER offers a recovery that creates a new file', () => {
    // The binding constraint. Every recovery must restore access to the ORIGINAL
    // file; creating a second copy is what caused the incident this module exists
    // to prevent. If this fails, do not relax the assertion — remove the recovery.
    const ALLOWED = new Set(['retry', 'reconnectAccount', 'pickFamilyFile', 'switchToCanonical']);
    for (const code of ALL_CODES) {
      for (const action of POD_ACCESS_ERRORS[code].recoveries) {
        expect(ALLOWED.has(action), `${code} → ${action}`).toBe(true);
        expect(String(action).toLowerCase()).not.toMatch(/creat|new|duplicat|copy/);
      }
    }
  });
});
