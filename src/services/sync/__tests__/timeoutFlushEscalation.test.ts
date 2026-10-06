/**
 * A timeout that keeps re-queuing must PAGE, through the existing flush streak (#127).
 *
 * `network` / `server` re-queues are neutral because an offline device self-heals. A pod
 * that has outgrown a device's uplink does not: without this it would show "Waiting to
 * Save" forever and never reach `#beanies-errors`. So a flush whose resave re-queues as
 * `timeout` is `'timeout-requeued'`, and `tryFlush` counts it via `reportFlushFailure`
 * (critical exactly at the second consecutive one).
 *
 * ⚠️ REAL CODE PATHS ONLY. The resave handler drives a REAL `GoogleDriveProvider.write`
 * whose `updateFile` rejects the way `driveService.driveRequest` does when our sized
 * deadline fires, so `enqueueOfflineSave('timeout')` is called by the real `queueWrite`,
 * and `offlineQueue` itself is not mocked. A stub that calls `enqueueOfflineSave` itself
 * would prove nothing about the provider → queue → streak wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/services/google/googleAuth', () => {
  class TokenExpiredError extends Error {
    constructor(message = 'Google access token expired and silent refresh failed') {
      super(message);
      this.name = 'TokenExpiredError';
    }
  }
  return {
    // offlineQueue's imports (`startListening` calls `onTokenAcquired`).
    onTokenAcquired: vi.fn(() => () => {}),
    whenRedirectAuthSettled: vi.fn(async () => {}),
    TokenExpiredError,
    // The provider's.
    getValidTokenSilent: vi.fn(async () => 'mock-token'),
    attemptSilentRefresh: vi.fn(async () => null),
    buildSilentRefreshAlertContext: vi.fn(() => ({})),
    getGoogleAccountEmail: vi.fn(() => null),
  };
});

const { updateFileMock } = vi.hoisted(() => ({ updateFileMock: vi.fn() }));
vi.mock('@/services/google/driveService', () => {
  class DriveApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
    }
  }
  return { DriveApiError, updateFile: updateFileMock };
});

vi.mock('@/services/sync/fileHandleStore', () => ({
  storeProviderConfig: vi.fn(async () => {}),
  clearProviderConfig: vi.fn(async () => {}),
  clearFileHandleForFamily: vi.fn(async () => {}),
}));

vi.mock('@/services/google/driveTokenRecovery', () => ({
  clearDriveConnectionForAccount: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
// `reportFlushFailure` attaches this diagnostic to auth-driven rejections; the real one
// reads googleAuth internals the mock above does not carry.
vi.mock('@/services/google/silentRefreshAlertContext', () => ({
  buildSilentRefreshAlertContext: vi.fn(() => ({})),
}));

import { reportError } from '@/utils/errorReporter';
import { getValidTokenSilent, TokenExpiredError } from '@/services/google/googleAuth';
import { DriveApiError } from '@/services/google/driveService';
import { GoogleDriveProvider } from '../providers/googleDriveProvider';
import {
  clearQueue,
  enqueueOfflineSave,
  hasPendingSave,
  setFlushProvider,
  setResaveHandler,
  enqueueSeqNow,
  noteSaveLanded,
} from '../offlineQueue';

/** What `driveService.driveRequest` throws when OUR sized deadline fires. */
function driveTimeout(): Error {
  return Object.assign(
    new DriveApiError(
      'Drive request timed out after 61000 ms (2850000 bytes sent) — slow or stalled connection',
      408
    ),
    { name: 'DriveTimeoutError', timedOut: true, timeoutMs: 61_000, bodyBytes: 2_850_000 }
  );
}

function reports() {
  return vi.mocked(reportError).mock.calls.map((c) => c[0]);
}

function markerQueuedAt(): string {
  return (JSON.parse(sessionStorage.getItem('beanies_offline_queue')!) as { queuedAt: string })
    .queuedAt;
}

/** Fire a `visible` flush (no 5 s `online` retry) and run it through `ms` of backoff. */
async function visibleFlush(ms: number): Promise<void> {
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(ms);
}

describe('a timed-out resave escalates through the flush streak (#127)', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T06:12:00.000Z'));
    sessionStorage.clear();
    clearQueue();
    vi.mocked(reportError).mockClear();
    updateFileMock.mockReset();
    provider = new GoogleDriveProvider('file-123', 'family.beanpod');
    // ORDER MATTERS: provider and handler BEFORE the seed marker, or `setFlushProvider`
    // fires a `startup` flush that adds a report and shifts the severities.
    setFlushProvider(provider);
    // What `syncService.doSave` does with the ack: a queued write is NOT a landed save.
    setResaveHandler(async () => {
      const ack = await provider.write('pod-bytes');
      return !!ack && !ack.queued;
    });
  });

  afterEach(() => {
    clearQueue();
    setResaveHandler(null);
    vi.useRealTimers();
  });

  it('two independent `online` triggers timing out → [telemetry, critical]; the 5 s retry is SKIPPED after a timeout', async () => {
    updateFileMock.mockRejectedValue(driveTimeout());
    enqueueOfflineSave('timeout');
    const firstQueuedAt = markerQueuedAt();

    window.dispatchEvent(new Event('online'));
    // First flush: attempt, 1 s backoff, retry → queued `timeout` → 'timeout-requeued'.
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateFileMock).toHaveBeenCalledTimes(2);
    expect(reports()).toHaveLength(1);

    // `handleOnline`'s 5 s retry must NOT fire for a timeout marker: a retry on the same
    // link 5 s later is a wasted upload and would page on a single reconnect.
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateFileMock).toHaveBeenCalledTimes(2);
    expect(reports()).toHaveLength(1);

    // A second, independent trigger that times out again is the sustained signal.
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateFileMock).toHaveBeenCalledTimes(4);

    const calls = reports();
    expect(calls.map((c) => c.severity)).toEqual([undefined, 'critical']);
    expect(calls[0]!.message).not.toContain('sustained');
    expect(calls[1]!.message).toContain('(sustained ×2)');
    expect(calls[1]!.message).toContain('resave timed out');
    // The FIRST queuedAt, not the time of either failed resave (the clock moved 7 s).
    expect(calls[1]!.message).toContain(`queued since ${firstQueuedAt}`);
    expect(markerQueuedAt()).toBe(firstQueuedAt);
    expect(hasPendingSave()).toBe(true);
  });

  it('an ordinary landed save clears the marker and resets the streak (no false page later)', async () => {
    updateFileMock.mockRejectedValue(driveTimeout());
    enqueueOfflineSave('timeout');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(reports()).toHaveLength(1); // streak 1

    // The user edits and the debounced save lands through the normal path.
    noteSaveLanded(enqueueSeqNow());
    expect(hasPendingSave()).toBe(false);

    // A new, unrelated timeout much later starts a FRESH streak: telemetry, not a page.
    enqueueOfflineSave('timeout');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(reports().map((c) => c.severity)).toEqual([undefined, undefined]);
  });

  it('a `network` marker still gets the 5 s reconnect retry (the skip is only for timeout-requeued)', async () => {
    updateFileMock.mockRejectedValue(new TypeError('Failed to fetch'));
    enqueueOfflineSave('network');
    window.dispatchEvent(new Event('online'));
    // network budget: 4 attempts with 1 + 2 + 4 s backoff, then queued → 'requeued'
    await vi.advanceTimersByTimeAsync(7000);
    expect(updateFileMock).toHaveBeenCalledTimes(4);
    expect(reports()).toHaveLength(0); // neutral
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(7000);
    expect(updateFileMock).toHaveBeenCalledTimes(8); // the retry fired
  });

  it('a timeout marker whose flush failed for an UNRELATED reason keeps the retry', async () => {
    updateFileMock.mockRejectedValue(driveTimeout());
    vi.mocked(getValidTokenSilent).mockRejectedValueOnce(new TokenExpiredError('token gone'));
    enqueueOfflineSave('timeout');
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(50);
    expect(updateFileMock).toHaveBeenCalledTimes(0); // the auth race rejected the flush
    expect(reports()).toHaveLength(1); // counted, as before
    // The retry still runs: the outcome was 'rejected', not 'timeout-requeued'.
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(updateFileMock).toHaveBeenCalledTimes(2);
  });

  it('a marker queued DURING the save is newer work and survives noteSaveLanded', () => {
    const seqAtEntry = enqueueSeqNow();
    enqueueOfflineSave('network');
    noteSaveLanded(seqAtEntry);
    expect(hasPendingSave()).toBe(true);
  });

  it('a `network` re-queue leaves the streak UNCHANGED; a landed flush RESETS it', async () => {
    enqueueOfflineSave('timeout');

    // 1. Timeout → counted (streak 1).
    updateFileMock.mockRejectedValue(driveTimeout());
    await visibleFlush(1000);
    expect(reports().map((c) => c.severity)).toEqual([undefined]);

    // 2. Offline → neutral: no report, and the streak is neither advanced nor reset.
    updateFileMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await visibleFlush(1000 + 2000 + 4000);
    expect(updateFileMock).toHaveBeenCalledTimes(2 + 4);
    expect(reports()).toHaveLength(1);

    // 3. Timeout again → streak 2 → pages (proves step 2 did not reset it).
    updateFileMock.mockRejectedValue(driveTimeout());
    await visibleFlush(1000);
    expect(reports().map((c) => c.severity)).toEqual([undefined, 'critical']);

    // 4. The upload lands → 'flushed' → streak reset, queue drained.
    updateFileMock.mockReset();
    updateFileMock.mockResolvedValue({ version: '9' });
    await visibleFlush(0);
    expect(hasPendingSave()).toBe(false);
    expect(reports()).toHaveLength(2);

    // 5. A fresh timeout hold starts the streak from 1 again: telemetry, no page.
    enqueueOfflineSave('timeout');
    updateFileMock.mockRejectedValue(driveTimeout());
    await visibleFlush(1000);
    const calls = reports();
    expect(calls).toHaveLength(3);
    expect(calls[2]!.severity).toBeUndefined();
    expect(calls[2]!.message).not.toContain('sustained');
  });
});
