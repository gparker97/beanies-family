import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the durable queue + telemetry so revokeGrant is tested in isolation.
const mockPostRevoke = vi.fn(async (_t: string): Promise<'ok' | 'transient'> => 'ok');
const mockEnqueueRevoke = vi.fn(async (_t: string, _g: string) => {});
vi.mock('@/services/sync/revokeQueue', () => ({
  postRevoke: (t: string) => mockPostRevoke(t),
  enqueueRevoke: (t: string, g: string) => mockEnqueueRevoke(t, g),
}));
const mockLogEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...a: unknown[]) => mockLogEvent(...a) }));

import { revokeGrant, logTokenLifecycle } from '../googleRevoke';

describe('googleRevoke.revokeGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is an idempotent no-op for a null/empty token (no network, no queue)', async () => {
    expect(await revokeGrant(null, { grant: 'drive', trigger: 'signout' })).toEqual({
      ok: true,
      reason: 'no-token',
    });
    expect(await revokeGrant(undefined, { grant: 'drive', trigger: 'signout' })).toEqual({
      ok: true,
      reason: 'no-token',
    });
    expect(await revokeGrant('', { grant: 'calendar', trigger: 'disconnect' })).toEqual({
      ok: true,
      reason: 'no-token',
    });
    expect(mockPostRevoke).not.toHaveBeenCalled();
    expect(mockEnqueueRevoke).not.toHaveBeenCalled();
  });

  it('reports revoked + logs an ok lifecycle event when the revoke lands', async () => {
    mockPostRevoke.mockResolvedValueOnce('ok');
    const res = await revokeGrant('rt-live', { grant: 'drive', trigger: 'reconnect' });
    expect(res).toEqual({ ok: true, reason: 'revoked' });
    expect(mockPostRevoke).toHaveBeenCalledWith('rt-live');
    expect(mockEnqueueRevoke).not.toHaveBeenCalled();
    // A google-token-lifecycle revoke/ok event was emitted with the right context.
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'google-token-lifecycle',
        context: expect.objectContaining({
          token_grant: 'drive',
          token_op: 'revoke',
          token_outcome: 'ok',
          token_trigger: 'reconnect',
        }),
      })
    );
  });

  it('enqueues for durable retry (never drops) when the revoke is transient', async () => {
    mockPostRevoke.mockResolvedValueOnce('transient');
    const res = await revokeGrant('rt-offline', { grant: 'calendar', trigger: 'disconnect' });
    expect(res).toEqual({ ok: false, reason: 'queued' });
    expect(mockEnqueueRevoke).toHaveBeenCalledWith('rt-offline', 'calendar');
  });

  it('logTokenLifecycle maps a failed outcome to warn level, ok to info', () => {
    logTokenLifecycle({ grant: 'drive', op: 'mint', outcome: 'ok', trigger: 'interactive' });
    expect(mockLogEvent).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info' }));
    logTokenLifecycle({
      grant: 'drive',
      op: 'revoke',
      outcome: 'failed',
      reason: 'enqueue-failed',
      trigger: 'enqueue',
    });
    expect(mockLogEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: expect.objectContaining({ token_reason: 'enqueue-failed' }),
      })
    );
  });
});
