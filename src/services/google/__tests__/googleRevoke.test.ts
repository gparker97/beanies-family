import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockLogEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...a: unknown[]) => mockLogEvent(...a) }));

import { revokeGrant, logTokenLifecycle } from '../googleRevoke';

function stubFetch(responder: () => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => responder());
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('googleRevoke.revokeGrant (whole-grant, immediate best-effort, no retry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('is an idempotent no-op for a null/empty token (no network)', async () => {
    const spy = stubFetch(() => new Response(null, { status: 200 }));
    expect(await revokeGrant(null, { grant: 'drive', trigger: 'signout' })).toEqual({
      ok: true,
      reason: 'no-token',
    });
    expect(await revokeGrant('', { grant: 'calendar', trigger: 'disconnect' })).toEqual({
      ok: true,
      reason: 'no-token',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports revoked + logs ok when Google returns 2xx', async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    const res = await revokeGrant('rt-live', { grant: 'drive', trigger: 'reconnect' });
    expect(res).toEqual({ ok: true, reason: 'revoked' });
    expect(mockLogEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'google-token-lifecycle',
        level: 'info',
        context: expect.objectContaining({
          token_grant: 'drive',
          token_op: 'revoke',
          token_outcome: 'ok',
          token_trigger: 'reconnect',
        }),
      })
    );
  });

  it('treats 400 (already-invalid) as done (ok)', async () => {
    stubFetch(() => new Response(null, { status: 400 }));
    expect(await revokeGrant('rt-dead', { grant: 'drive', trigger: 'signout' })).toEqual({
      ok: true,
      reason: 'revoked',
    });
  });

  it('DROPS a transient failure (403/429/5xx/throw) without retrying, logs failed', async () => {
    for (const status of [403, 429, 503]) {
      vi.clearAllMocks();
      const spy = stubFetch(() => new Response(null, { status }));
      const res = await revokeGrant('rt-x', { grant: 'calendar', trigger: 'disconnect' });
      expect(res).toEqual({ ok: false, reason: 'failed' });
      expect(spy).toHaveBeenCalledTimes(1); // no durable retry (whole-grant safety)
      expect(mockLogEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          context: expect.objectContaining({
            token_outcome: 'failed',
            token_reason: 'transient-dropped',
          }),
        })
      );
    }
    // Network throw
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    expect(await revokeGrant('rt-y', { grant: 'drive', trigger: 'reconnect' })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('sends the token url-encoded with keepalive so it survives a navigation', async () => {
    const spy = stubFetch(() => new Response(null, { status: 200 }));
    await revokeGrant('a b/c', { grant: 'drive', trigger: 'reconnect' });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toContain('token=a%20b%2Fc');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('logTokenLifecycle maps failed → warn, ok → info', () => {
    logTokenLifecycle({ grant: 'drive', op: 'mint', outcome: 'ok', trigger: 'interactive' });
    expect(mockLogEvent).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'info' }));
    logTokenLifecycle({
      grant: 'calendar',
      op: 'revoke',
      outcome: 'failed',
      reason: 'transient-dropped',
      trigger: 'disconnect',
    });
    expect(mockLogEvent).toHaveBeenLastCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});
