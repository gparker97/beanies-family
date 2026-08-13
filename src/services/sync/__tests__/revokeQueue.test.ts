import { describe, it, expect, beforeEach, vi } from 'vitest';

// Keep the module light: stub the lifecycle logger (googleRevoke) so importing
// revokeQueue doesn't pull the telemetry chain, and rely on the boot IIFE's
// localStorage gate (no flag set → it never touches IndexedDB).
vi.mock('@/services/google/googleRevoke', () => ({ logTokenLifecycle: vi.fn() }));

import { postRevoke } from '../revokeQueue';

describe('revokeQueue.postRevoke — retry classification', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  async function classify(responder: () => Response): Promise<'ok' | 'transient'> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => responder())
    );
    return postRevoke('some-token');
  }

  it('2xx → ok (grant gone)', async () => {
    expect(await classify(() => new Response(null, { status: 200 }))).toBe('ok');
  });

  it('400 (already-invalid token) → ok (do not spin forever)', async () => {
    expect(await classify(() => new Response(null, { status: 400 }))).toBe('ok');
  });

  it('403 / 429 / 5xx → transient (token may still be live; retry)', async () => {
    expect(await classify(() => new Response(null, { status: 403 }))).toBe('transient');
    expect(await classify(() => new Response(null, { status: 429 }))).toBe('transient');
    expect(await classify(() => new Response(null, { status: 503 }))).toBe('transient');
  });

  it('network throw (offline) → transient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      })
    );
    expect(await postRevoke('some-token')).toBe('transient');
  });

  it('sends the token url-encoded with keepalive so it survives a navigation', async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 })
    );
    vi.stubGlobal('fetch', fetchSpy);
    await postRevoke('a b/c');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('token=a%20b%2Fc');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });
});
