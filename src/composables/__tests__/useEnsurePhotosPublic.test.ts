// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * C11: the session mark is written only after a sweep that ran against a LOADED doc and
 * completed, and the success path emits `photo-public-link` outcome counts.
 */

const mocks = vi.hoisted(() => ({
  isDocLoaded: vi.fn(() => true),
  setPublicLinkPermission: vi.fn(async () => undefined),
  requestAccessToken: vi.fn(async () => 'tok'),
  logEvent: vi.fn(),
  photos: {} as Record<string, { id: string; driveFileId: string; deletedAt?: string }>,
}));

vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: mocks.isDocLoaded,
  docVersion: { value: 0 },
}));
vi.mock('@/services/google/driveService', () => {
  class DriveApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  class DriveFileNotFoundError extends DriveApiError {}
  return {
    setPublicLinkPermission: mocks.setPublicLinkPermission,
    DriveApiError,
    DriveFileNotFoundError,
  };
});
vi.mock('@/services/google/googleAuth', () => ({ requestAccessToken: mocks.requestAccessToken }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ driveFileId: 'pod-1' }) }));
vi.mock('@/stores/photoStore', () => ({ usePhotoStore: () => ({ photos: mocks.photos }) }));

import { runSweep } from '../useEnsurePhotosPublic';

const session = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => session.set(k, v),
  },
});

function events(action: string): Array<Record<string, unknown>> {
  return mocks.logEvent.mock.calls
    .map((c) => c[0] as { surface: string; context?: Record<string, unknown> })
    .filter((e) => e.surface === 'photo-public-link' && e.context?.action === action)
    .map((e) => e.context ?? {});
}

describe('useEnsurePhotosPublic.runSweep', () => {
  let fileId = 0;
  let id: string;

  beforeEach(() => {
    id = `pod-${++fileId}`;
    session.clear();
    mocks.isDocLoaded.mockReturnValue(true);
    mocks.setPublicLinkPermission.mockReset().mockResolvedValue(undefined);
    mocks.requestAccessToken.mockReset().mockResolvedValue('tok');
    mocks.logEvent.mockClear();
    for (const k of Object.keys(mocks.photos)) delete mocks.photos[k];
    mocks.photos.a = { id: 'a', driveFileId: 'file-a' };
    mocks.photos.b = { id: 'b', driveFileId: 'file-b' };
    mocks.photos.gone = { id: 'gone', driveFileId: 'file-gone', deletedAt: 'x' };
  });

  it('does nothing (and does not mark the session) before the doc is loaded', async () => {
    mocks.isDocLoaded.mockReturnValue(false);
    expect(await runSweep(id)).toBe(false);
    expect(mocks.setPublicLinkPermission).not.toHaveBeenCalled();
    expect(session.size).toBe(0);

    // Once the doc arrives the same id sweeps.
    mocks.isDocLoaded.mockReturnValue(true);
    expect(await runSweep(id)).toBe(true);
    expect(mocks.setPublicLinkPermission).toHaveBeenCalledTimes(2); // live photos only
  });

  it('marks the session only after a completed sweep and emits granted counts', async () => {
    expect(await runSweep(id)).toBe(true);
    expect(session.get(`beanies:publicPhotoSweep:${id}`)).toBe('1');
    expect(events('sweep-complete')).toEqual([
      { action: 'sweep-complete', kind: 'granted', file_count: 2 },
    ]);

    // Second call this session: nothing.
    mocks.setPublicLinkPermission.mockClear();
    expect(await runSweep(id)).toBe(false);
    expect(mocks.setPublicLinkPermission).not.toHaveBeenCalled();
  });

  it('a token failure leaves the session unmarked so the next trigger retries', async () => {
    mocks.requestAccessToken.mockRejectedValueOnce(new Error('no session'));
    expect(await runSweep(id)).toBe(false);
    expect(session.size).toBe(0);
    expect(events('sweep-skipped')).toEqual([{ action: 'sweep-skipped', error_code: 'no-token' }]);

    expect(await runSweep(id)).toBe(true);
    expect(session.get(`beanies:publicPhotoSweep:${id}`)).toBe('1');
  });

  it('counts per-photo failures by class and still completes', async () => {
    const { DriveFileNotFoundError, DriveApiError } =
      await import('@/services/google/driveService');
    mocks.setPublicLinkPermission
      .mockRejectedValueOnce(new DriveFileNotFoundError('403', 403))
      .mockRejectedValueOnce(new DriveApiError('500', 500));

    expect(await runSweep(id)).toBe(true);
    expect(events('sweep-complete')).toEqual([
      { action: 'sweep-complete', kind: 'not-owner', file_count: 1 },
      { action: 'sweep-complete', kind: 'failed', file_count: 1 },
    ]);
    expect(events('grant-failed')).toEqual([
      { action: 'grant-failed', stage: 'sweep', http_status: 500 },
    ]);
  });
});
