import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logEventMock, reportErrorMock, getMock, hasSessionMock } = vi.hoisted(() => ({
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
  getMock: vi.fn(),
  hasSessionMock: vi.fn(),
}));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/services/native/installReferrerPlugin', () => ({
  InstallReferrer: { get: getMock },
}));
vi.mock('@/stores/authStore', () => ({ hasPersistedSession: hasSessionMock }));

import {
  ATTRIBUTION_STORAGE_KEY,
  ATTRIBUTION_TTL_MS,
  makeEnvelope,
} from '@beanies/brand/attribution';
import { readInstallReferrerOnce } from '../installReferrer';

const MARKER = 'beanies:attribution:referrer-read';
const TAGGED = 'utm_source=chatgpt&utm_campaign=sg-pilot-oct26&utm_content=calm-ad1';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch seconds `ms` ago, the unit Play reports `installBeginSeconds` in. */
function secondsAgo(ms: number): number {
  return Math.floor((Date.now() - ms) / 1000);
}

function actions(): unknown[] {
  return logEventMock.mock.calls.map((c) => c[0].context?.action);
}

describe('readInstallReferrerOnce', () => {
  beforeEach(() => {
    localStorage.clear();
    logEventMock.mockReset();
    reportErrorMock.mockReset();
    getMock.mockReset();
    hasSessionMock.mockReset().mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does not ask Play again once the marker is set, and logs nothing', async () => {
    localStorage.setItem(MARKER, JSON.stringify({ at: 1 }));
    await readInstallReferrerOnce();
    expect(getMock).not.toHaveBeenCalled();
    expect(logEventMock).not.toHaveBeenCalled();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('logs `referrer-absent` and sets the marker when Play has no referrer', async () => {
    getMock.mockResolvedValue({ referrer: null });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['referrer-absent']);
    expect(localStorage.getItem(MARKER)).not.toBeNull();
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });

  it("ignores Google's organic pair: nothing captured, marker set", async () => {
    getMock.mockResolvedValue({ referrer: 'utm_source=google-play&utm_medium=organic' });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['referrer-organic']);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('captures a tagged referrer as `captured-referrer` and sets the marker', async () => {
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: secondsAgo(60_000) });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['captured-referrer']);
    const env = JSON.parse(localStorage.getItem(ATTRIBUTION_STORAGE_KEY) ?? 'null');
    expect(env.fields.utm_source).toBe('chatgpt');
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('captures a referrer from an install that began just inside the tag lifetime', async () => {
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: secondsAgo(29 * DAY_MS) });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['captured-referrer']);
  });

  it('ignores a referrer from an install older than the tag lifetime (the upgrade case)', async () => {
    getMock.mockResolvedValue({
      referrer: TAGGED,
      installBeginSeconds: secondsAgo(ATTRIBUTION_TTL_MS + DAY_MS),
    });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['referrer-stale']);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it.each([0, undefined])(
    'with no install time (%s), treats a device that already has a session as stale',
    async (installBeginSeconds) => {
      hasSessionMock.mockReturnValue(true);
      getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds });
      await readInstallReferrerOnce();
      expect(actions()).toEqual(['referrer-stale']);
      expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
      expect(localStorage.getItem(MARKER)).not.toBeNull();
    }
  );

  it('with no install time, captures on a device with no session yet (a fresh install)', async () => {
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: 0 });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['captured-referrer']);
  });

  it('treats a recent install as stale once a session exists (a retry after the pod)', async () => {
    hasSessionMock.mockReturnValue(true);
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: secondsAgo(60_000) });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['referrer-stale']);
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('leaves the marker unset when the tag write is refused, and the next launch retries', async () => {
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: secondsAgo(60_000) });
    const quota = new Error('quota');
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quota;
    });
    await readInstallReferrerOnce();
    spy.mockRestore();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: quota,
        context: { action: 'storage-failed', stage: 'write' },
      })
    );
    expect(localStorage.getItem(MARKER)).toBeNull();

    await readInstallReferrerOnce();
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(actions()).toEqual(['captured-referrer']);
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('sets the marker when a first touch is kept (a tag is stored, just not this one)', async () => {
    localStorage.setItem(
      ATTRIBUTION_STORAGE_KEY,
      JSON.stringify(makeEnvelope({ utm_source: 'reddit' }, Date.now()))
    );
    getMock.mockResolvedValue({ referrer: TAGGED, installBeginSeconds: secondsAgo(60_000) });
    await readInstallReferrerOnce();
    expect(actions()).toEqual(['kept-first-touch']);
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('sets the marker for a referrer that carries no usable tag', async () => {
    getMock.mockResolvedValue({ referrer: 'foo=bar', installBeginSeconds: secondsAgo(60_000) });
    await readInstallReferrerOnce();
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MARKER)).not.toBeNull();
  });

  it('reports a refused marker write once through the stash reporter', async () => {
    getMock.mockResolvedValue({ referrer: null });
    const quota = new Error('quota');
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw quota;
    });
    await readInstallReferrerOnce();
    spy.mockRestore();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'attribution',
        severity: 'warning',
        error: quota,
        context: { action: 'storage-failed', stage: 'write' },
      })
    );
  });

  it('reports a thrown read as `referrer-failed` and leaves the marker unset', async () => {
    getMock.mockRejectedValue(new Error('install referrer SERVICE_UNAVAILABLE'));
    await readInstallReferrerOnce();
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'attribution',
        severity: 'warning',
        context: { action: 'referrer-failed' },
      })
    );
    expect(localStorage.getItem(MARKER)).toBeNull();
  });
});
