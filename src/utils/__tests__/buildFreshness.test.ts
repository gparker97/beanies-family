import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBuildFreshness, FRESHNESS_TIMEOUT_MS } from '../buildFreshness';

const LOCAL = { sha: 'aaaaaaa111', builtAt: '2026-11-10T10:00:00.000Z' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('checkBuildFreshness', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches /version.json past every cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sha: LOCAL.sha, builtAt: LOCAL.builtAt }));
    await checkBuildFreshness(LOCAL);
    expect(fetchMock).toHaveBeenCalledWith(
      '/version.json',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('is current when the remote sha matches', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sha: LOCAL.sha, builtAt: '2027-01-01T00:00:00Z' }));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'current' });
  });

  it('is behind when the sha differs and the remote build is strictly later', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sha: 'bbbbbbb222', builtAt: '2026-11-11T10:00:00Z' })
    );
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'behind', remoteSha: 'bbbbbbb222' });
  });

  it('is NOT behind when the remote is an older build (a rollback must not drag a tab back)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sha: 'bbbbbbb222', builtAt: '2026-11-09T10:00:00Z' })
    );
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'current' });
  });

  it('is NOT behind when the remote build time equals ours', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ sha: 'bbbbbbb222', builtAt: LOCAL.builtAt }));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'current' });
  });

  it('cannot prove behind with no local build time', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sha: 'bbbbbbb222', builtAt: '2026-11-11T10:00:00Z' })
    );
    expect(await checkBuildFreshness({ sha: LOCAL.sha, builtAt: null })).toEqual({
      kind: 'current',
    });
  });

  it("treats CloudFront's index.html answer (200, HTML) as a shape failure", async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'shape' });
  });

  it.each([
    ['missing sha', { builtAt: '2026-11-11T10:00:00Z' }],
    ['empty sha', { sha: '', builtAt: '2026-11-11T10:00:00Z' }],
    ['unparseable builtAt', { sha: 'bbbbbbb222', builtAt: 'yesterday-ish' }],
    ['numeric builtAt', { sha: 'bbbbbbb222', builtAt: 12345 }],
    ['an array', ['bbbbbbb222']],
    ['null', null],
  ])('treats a body with %s as a shape failure', async (_label, body) => {
    fetchMock.mockResolvedValue(jsonResponse(body));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'shape' });
  });

  it('treats truncated JSON as a shape failure', async () => {
    fetchMock.mockResolvedValue(new Response('{"sha": "bb', { status: 200 }));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'shape' });
  });

  it('reports an HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'http' });
  });

  it('reports a network failure while online', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'network' });
  });

  it('does not even fetch while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await checkBuildFreshness(LOCAL)).toEqual({ kind: 'unavailable', reason: 'offline' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('times out a hung request', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError'))
          );
        })
    );
    const pending = checkBuildFreshness(LOCAL);
    await vi.advanceTimersByTimeAsync(FRESHNESS_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ kind: 'unavailable', reason: 'timeout' });
  });

  it('never throws, whatever fetch does', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('synchronous explosion');
    });
    await expect(checkBuildFreshness(LOCAL)).resolves.toEqual({
      kind: 'unavailable',
      reason: 'network',
    });
  });
});
