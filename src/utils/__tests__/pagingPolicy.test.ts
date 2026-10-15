import { describe, it, expect, vi, afterEach } from 'vitest';
import { PAGING_SURFACES, severityFor } from '../pagingPolicy';
import { POD_ACCESS_ERRORS } from '../podAccess';
import { CREATE_DRIVE_ERRORS } from '@/services/sync/createDriveErrors';
import { JOIN_ERRORS } from '@/composables/useJoinFlow';
import type { CreateDriveSurface } from '@/services/sync/connectStorage';
import type { Impact } from '../pagingPolicy';

describe('PAGING_SURFACES', () => {
  it('is the reviewed list of surfaces that may page', () => {
    // A change here is a change to who gets woken up. Update the Lambda's
    // SLACK_ESCALATE_SURFACES in the same diff (telemetryAllowlistDrift.test.ts checks).
    expect(Object.keys(PAGING_SURFACES)).toMatchInlineSnapshot(`
      [
        "boot-integrity",
        "vue-render",
        "app.loadFamilyData.replaceLoopDetected",
        "app.postInitNoData",
        "app.chunkRecoveryFailed",
        "app.onboardingStallTimeout",
        "app.redirectAuthCompletion",
        "wrapAsync:engine-panic",
        "pod-access",
        "pod-load-failure",
        "pod-lineage",
        "pod-merge",
        "pod-compaction",
        "sync-envelope",
        "storage-migration-failed",
        "cache-replay",
        "offline-queue-flush",
        "syncStore.deferredHashLeak",
        "registry",
        "createPod.connectDrive",
        "createPod.adoptExisting",
        "createPod.handOff",
        "resumeSetup.connectDrive",
        "resumeSetup.probeDriveAuth",
        "resumeSetup.write",
        "resumeSetup.verify",
        "resumeSetup.persist",
        "resumeSetup.register",
        "resumeSetup.precondition",
        "resumeSetup.concurrent-write",
        "resumeSetup.finalize",
        "resumeSetup.adoptExisting",
        "setupProgress.firstSync",
        "setupProgress.unexpected",
        "join-flow:FILE_DECRYPT_FAILED",
        "join-flow:FILE_CORRUPT",
        "join-flow:FILE_TOO_LARGE",
        "join-flow:FILE_READ_FAILED",
        "login-flow",
        "change-password",
        "reset-member-password",
        "signin-heal",
        "kdf-upgrade",
        "ai-enclave",
        "list-copy",
        "responsibilities",
        "statement-import",
        "calendar-import",
        "photo-upload",
        "recipe-extract",
        "beanie-wall",
        "recurring-processor",
        "quick-add-composer",
        "calendar-sync",
        "feedback-submit",
        "billing-ui",
        "review-demo",
        "delete-family",
        "file-delivery",
      ]
    `);
  });

  it('records a paging impact and a reason for every surface', () => {
    for (const [surface, entry] of Object.entries(PAGING_SURFACES)) {
      expect(['data-at-risk', 'journey-blocked', 'security'], surface).toContain(entry.impact);
      expect(entry.why.length, surface).toBeGreaterThan(10);
    }
  });
});

describe('severityFor', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports a degraded impact at warning on any surface', () => {
    expect(severityFor('pod-access', 'degraded')).toEqual({
      severity: 'warning',
      surface: 'pod-access',
    });
  });

  it('pages a non-degraded impact on an allowlisted surface', () => {
    expect(severityFor('pod-access', 'data-at-risk')).toEqual({
      severity: 'critical',
      surface: 'pod-access',
    });
  });

  it('downgrades to error, marked demoted, with one console warning, on a surface that may not page', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(severityFor('not-a-paging-surface', 'journey-blocked')).toEqual({
      severity: 'error',
      surface: 'not-a-paging-surface',
      demoted: true,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[pagingPolicy] non-paging surface asked to page',
      'not-a-paging-surface'
    );
  });

  it('marks ONLY the fallback as demoted: a warning or a page is the policy working', () => {
    expect('demoted' in severityFor('pod-access', 'degraded')).toBe(false);
    expect('demoted' in severityFor('not-a-paging-surface', 'degraded')).toBe(false);
    expect('demoted' in severityFor('pod-access', 'data-at-risk')).toBe(false);
  });

  it('does not treat an inherited property name as allowlisted', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(severityFor('constructor', 'security').severity).toBe('error');
    expect(severityFor('toString', 'security').severity).toBe('error');
  });
});

/**
 * Every registry entry that intends to page must report on a surface that may page, or
 * `severityFor` downgrades it at runtime and it silently goes quiet. This is the check the
 * compiler cannot make for a registry site (its surface is computed).
 */
describe('registry table: every non-degraded entry maps to an allowlisted surface', () => {
  const unpageable = (surface: string, code: string, impact: Impact): string | null =>
    impact !== 'degraded' && !Object.prototype.hasOwnProperty.call(PAGING_SURFACES, surface)
      ? `${surface} (${code})`
      : null;

  it('JOIN_ERRORS report on join-flow:<code>', () => {
    const bad = Object.entries(JOIN_ERRORS)
      .map(([code, e]) => unpageable(`join-flow:${code}`, code, e.impact))
      .filter(Boolean);
    expect(bad).toEqual([]);
  });

  it('POD_ACCESS_ERRORS report on pod-access', () => {
    const bad = Object.entries(POD_ACCESS_ERRORS)
      .map(([code, e]) => unpageable('pod-access', code, e.impact))
      .filter(Boolean);
    expect(bad).toEqual([]);
  });

  it('CREATE_DRIVE_ERRORS report on every create-flow surface and app.redirectAuthCompletion', () => {
    // `satisfies` keeps this list in step with `CreateDriveSurface`: a fifth value added there
    // fails the build here until it is listed.
    const createSurfaces = {
      'createPod.connectDrive': true,
      'resumeSetup.connectDrive': true,
      'resumeSetup.probeDriveAuth': true,
      'resumeSetup.write': true,
    } as const satisfies Record<CreateDriveSurface, true>;
    const surfaces = [...Object.keys(createSurfaces), 'app.redirectAuthCompletion'];
    const bad = surfaces.flatMap((surface) =>
      Object.entries(CREATE_DRIVE_ERRORS)
        .map(([code, e]) => unpageable(surface, code, e.impact))
        .filter(Boolean)
    );
    expect(bad).toEqual([]);
  });

  it('pages only the reviewed registry codes', () => {
    const paging = (registry: Record<string, { impact: Impact }>) =>
      Object.entries(registry)
        .filter(([, e]) => e.impact !== 'degraded')
        .map(([code]) => code)
        .sort();
    expect(paging(JOIN_ERRORS)).toEqual([
      'FILE_CORRUPT',
      'FILE_DECRYPT_FAILED',
      'FILE_READ_FAILED',
      'FILE_TOO_LARGE',
    ]);
    expect(paging(POD_ACCESS_ERRORS)).toEqual(['CANONICAL_MISMATCH']);
    expect(paging(CREATE_DRIVE_ERRORS)).toEqual(['drive-api-disabled', 'unknown']);
  });
});
