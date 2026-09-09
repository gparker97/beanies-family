/**
 * `stagePendingFile` — the non-dispatching staging core.
 *
 * The contract worth pinning is what it must NOT do: never throw (so the early-staging
 * path can treat offline as an ordinary answer), and never dispatch or write UI state
 * (so an early failure cannot be swallowed by the machine while poisoning `proveError`
 * for the later, real attempt).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CorruptPayloadError } from '@/types/sync';

const syncMocks = vi.hoisted(() => ({
  hasPendingEncryptedFile: false,
  isConfigured: true,
  needsPermission: false,
  loadFromFile: vi.fn(),
}));

vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncMocks }));

import { stagePendingFile } from '@/services/auth/stagePendingFile';

beforeEach(() => {
  syncMocks.hasPendingEncryptedFile = false;
  syncMocks.isConfigured = true;
  syncMocks.needsPermission = false;
  syncMocks.loadFromFile = vi.fn();
});

describe('stagePendingFile', () => {
  it('short-circuits without I/O when the pod is already open', async () => {
    await expect(stagePendingFile(true)).resolves.toEqual({ ok: true });
    expect(syncMocks.loadFromFile).not.toHaveBeenCalled();
  });

  it('short-circuits without I/O when an envelope is already staged', async () => {
    syncMocks.hasPendingEncryptedFile = true;
    await expect(stagePendingFile(false)).resolves.toEqual({ ok: true });
    expect(syncMocks.loadFromFile).not.toHaveBeenCalled();
  });

  it('maps the transport preconditions without fetching', async () => {
    syncMocks.isConfigured = false;
    await expect(stagePendingFile(false)).resolves.toEqual({ ok: false, reason: 'not-found' });

    syncMocks.isConfigured = true;
    syncMocks.needsPermission = true;
    await expect(stagePendingFile(false)).resolves.toEqual({ ok: false, reason: 'permission' });
    expect(syncMocks.loadFromFile).not.toHaveBeenCalled();
  });

  it('treats needsPassword as a successful stage — the envelope IS in reach', async () => {
    syncMocks.loadFromFile.mockResolvedValue({ success: false, needsPassword: true });
    await expect(stagePendingFile(false)).resolves.toEqual({ ok: true });
  });

  it('classifies a load failure into the machine transport vocabulary', async () => {
    for (const [reason, expected] of [
      ['auth', 'auth'],
      ['permission', 'permission'],
      ['not-found', 'not-found'],
      ['file-not-found', 'not-found'],
      ['something-else', 'error'],
      [undefined, 'error'],
    ] as const) {
      syncMocks.loadFromFile.mockResolvedValue({ success: false, reason });
      await expect(stagePendingFile(false)).resolves.toEqual({ ok: false, reason: expected });
    }
  });

  it('NEVER throws, and carries the payload error instance for the wrapper', async () => {
    // `loadFromFile` throws the latched remote blocker, so the try/catch is mandatory,
    // not defensive. The wrapper needs the INSTANCE (payloadErrorKind /
    // payloadErrorMessageKey / reportPayloadFailure all take it), not a classification.
    // A REAL subclass, not a hand-rolled fake: the wrapper branches on
    // `instanceof PayloadLoadError`, so a stand-in would pass a test the wrapper fails.
    const payload = new CorruptPayloadError('boom', 'decrypt', 'fam1');
    syncMocks.loadFromFile.mockRejectedValue(payload);
    const outcome = await stagePendingFile(false);
    expect(outcome).toEqual({ ok: false, reason: 'error', payload });

    syncMocks.loadFromFile.mockRejectedValue(new Error('network died'));
    await expect(stagePendingFile(false)).resolves.toEqual({ ok: false, reason: 'error' });
  });
});
