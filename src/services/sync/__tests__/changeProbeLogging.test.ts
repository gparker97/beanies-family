/**
 * `remoteChanged()` degradation logging (see syncService `probeFailureReason`).
 *
 * WHY THIS EXISTS: `syncStore`'s 10s poll re-probes 6x/min, so a token that dies
 * while a tab sits open used to emit one identical warn PER TICK — 386 events in
 * a day from one real family, 1392 from another, and past `logEvent`'s
 * 50/surface/min rate limit, which drops the overflow silently and makes the true
 * failure count unknowable. These tests pin the contract that replaced it:
 * ONE warn per degradation, a closing recovery event carrying the attempt count,
 * and no hiding of a reclassified failure.
 *
 * The probe's DECISION logic (compareMarkers) is covered by remoteBaseline.test.ts;
 * this file is only about what reaches the firehose.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

vi.mock('@/services/google/driveService', () => ({
  DriveApiError: class extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
    }
  },
}));

vi.mock('@/services/google/googleAuth', () => ({
  TokenExpiredError: class extends Error {
    constructor(message = 'token expired') {
      super(message);
      this.name = 'TokenExpiredError';
    }
  },
}));

vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => 'fam-1') }));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn() }));
vi.mock('@/services/sync/fileHandleStore', () => ({
  getFileHandle: vi.fn(),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(),
}));
vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: class {
    static fromExisting() {
      return null;
    }
  },
}));
vi.mock('@/services/sync/providers/localProvider', () => ({
  LocalStorageProvider: class {
    getHandle() {
      return null;
    }
  },
}));
vi.mock('@/services/sync/capabilities', () => ({ supportsFileSystemAccess: vi.fn(() => false) }));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'p==', heads: ['h'] })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false, remoteHeads: ['h'] })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h'] })),
}));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/beanpodFilename', () => ({ isConflictFilename: vi.fn(() => false) }));

import * as syncService from '../syncService';
import { TokenExpiredError } from '@/services/google/googleAuth';
import { DriveApiError } from '@/services/google/driveService';

/** Provider whose marker probe is driven by a swappable impl. */
function makeProbeProvider(getMarker: () => Promise<{ revision: string | null }>) {
  return {
    type: 'google_drive' as const,
    read: vi.fn(),
    write: vi.fn(),
    getLastModified: vi.fn(async () => '2026-08-24T00:00:00Z'),
    getRemoteMarker: vi.fn(async () => {
      const m = await getMarker();
      return { revision: m.revision, modifiedTime: '2026-08-24T00:00:00Z' };
    }),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file-1',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
}

/** Only the events this surface emits — other surfaces are noise here. */
function probeEvents() {
  return logEventMock.mock.calls
    .map((c) => c[0] as { level: string; surface: string; context?: Record<string, unknown> })
    .filter((e) => e.surface === 'sync-change-detect');
}

describe('remoteChanged — degradation logging', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): these tests queue mockImplementationOnce,
    // and leftover queued impls would leak across cases.
    vi.resetAllMocks();
    syncService.reset();
  });

  it('logs ONE warn across many consecutive identical failures', async () => {
    const provider = makeProbeProvider(async () => {
      throw new TokenExpiredError();
    });
    syncService.setProvider(provider as never);

    // 20 ticks == ~3.3 minutes of the 10s poll; pre-fix this was 20 warns.
    for (let i = 0; i < 20; i++) {
      const r = await syncService.remoteChanged();
      expect(r.status).toBe('unknown');
      expect(r.reason).toBe('auth');
    }

    const warns = probeEvents().filter((e) => e.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].context).toMatchObject({
      action: 'remote-changed-unknown',
      error_code: 'auth',
    });
  });

  it('emits a recovery event carrying the exact attempt count, then re-arms', async () => {
    let failing = true;
    const provider = makeProbeProvider(async () => {
      if (failing) throw new TokenExpiredError();
      return { revision: 'ver:1' };
    });
    syncService.setProvider(provider as never);

    for (let i = 0; i < 5; i++) await syncService.remoteChanged();
    failing = false;
    await syncService.remoteChanged();

    const evts = probeEvents();
    expect(evts.filter((e) => e.level === 'warn')).toHaveLength(1);

    const recovered = evts.filter((e) => e.level === 'info');
    expect(recovered).toHaveLength(1);
    expect(recovered[0].context).toMatchObject({
      action: 'remote-changed-recovered',
      error_code: 'auth',
      consecutive_failures: 5, // the 5 failed ticks, not the successful one
    });

    // A LATER degradation must warn again — recovery clears the latch.
    failing = true;
    await syncService.remoteChanged();
    expect(probeEvents().filter((e) => e.level === 'warn')).toHaveLength(2);
  });

  it('does not emit a recovery event when the probe never failed', async () => {
    const provider = makeProbeProvider(async () => ({ revision: 'ver:1' }));
    syncService.setProvider(provider as never);

    for (let i = 0; i < 3; i++) await syncService.remoteChanged();

    expect(probeEvents()).toHaveLength(0);
  });

  it('re-warns when the failure is RECLASSIFIED, so a new fault is never hidden', async () => {
    let mode: 'auth' | 'notfound' = 'auth';
    const provider = makeProbeProvider(async () => {
      if (mode === 'auth') throw new TokenExpiredError();
      throw new DriveApiError('gone', 404);
    });
    syncService.setProvider(provider as never);

    await syncService.remoteChanged();
    await syncService.remoteChanged();
    mode = 'notfound';
    await syncService.remoteChanged();

    const warns = probeEvents().filter((e) => e.level === 'warn');
    expect(warns).toHaveLength(2);
    expect(warns[0].context).toMatchObject({ error_code: 'auth' });
    expect(warns[1].context).toMatchObject({ error_code: 'file-not-found' });
  });

  it('reset() clears the latch so a new session warns again', async () => {
    const provider = makeProbeProvider(async () => {
      throw new TokenExpiredError();
    });
    syncService.setProvider(provider as never);

    await syncService.remoteChanged();
    expect(probeEvents().filter((e) => e.level === 'warn')).toHaveLength(1);

    syncService.reset();
    syncService.setProvider(provider as never);
    await syncService.remoteChanged();

    expect(probeEvents().filter((e) => e.level === 'warn')).toHaveLength(2);
  });
});
