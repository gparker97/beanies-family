/**
 * The managed-tier proxy client.
 *
 * Two things here were entirely untested and both are load-bearing for #83:
 *
 *  1. the 429 → `rate_limited` mapping, which is what keeps an intentional abuse refusal off
 *     `#beanies-errors` — and which also closes a PRE-EXISTING bug, because the API-Gateway
 *     route throttle returns a bare 429 with no `code` and has been classified as
 *     `provider_error` (and therefore reported) ever since it was added;
 *  2. `familyId` riding on the wire as an ADDED field, never a rename — the request body is a
 *     frozen contract, because the bundle and the Lambda deploy independently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubEnv('VITE_AI_EXTRACT_URL', 'https://api.example.test/ai-extract');
vi.stubEnv('VITE_AI_EXTRACT_API_KEY', 'soft-key');

import { managedProvider } from '../managedProvider';
import { ExtractionProviderError } from '../../types';

const originalFetch = globalThis.fetch;

/** A minimal share-task success body, so the happy path can be asserted too. */
const OK_RESULT = { kind: 'none' };

function respond(status: number, body: unknown, ok = status < 400) {
  return {
    ok,
    status,
    json: async () => body,
    headers: { get: () => undefined },
  } as unknown as Response;
}

const request = {
  source: { kind: 'text' as const, text: 'a school fair' },
  todayIso: '2026-09-03',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function runExpectingError(response: Response) {
  globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch;
  try {
    await managedProvider.run('share', request);
  } catch (err) {
    return err as ExtractionProviderError;
  }
  throw new Error('expected the provider to throw');
}

describe('managedProvider — the 429 mapping (#83)', () => {
  it('maps OUR proxy 429 (which carries a code) to rate_limited', async () => {
    const err = await runExpectingError(
      respond(429, { error: 'Too many requests', code: 'rate_limited', retryAfterSeconds: 900 })
    );
    expect(err).toBeInstanceOf(ExtractionProviderError);
    expect(err.code).toBe('rate_limited');
  });

  it('maps a BARE 429 with no code to rate_limited too', async () => {
    // ⚠️ This is the pre-existing bug the status match closes. The API-Gateway route throttle
    // returns `{"message":"Too Many Requests"}` and no `code`, which fell through to
    // `provider_error` — reported WITH an error surface, i.e. paging #beanies-errors whenever
    // two families extracted at once.
    const err = await runExpectingError(respond(429, { message: 'Too Many Requests' }));
    expect(err.code).toBe('rate_limited');
  });

  it('maps a 429 whose body is unreadable to rate_limited', async () => {
    const unreadable = {
      ok: false,
      status: 429,
      json: async () => {
        throw new SyntaxError('not json');
      },
      headers: { get: () => undefined },
    } as unknown as Response;
    const err = await runExpectingError(unreadable);
    expect(err.code).toBe('rate_limited');
  });

  it('tells a developer which limit to look at, without inventing user copy', async () => {
    await runExpectingError(respond(429, { code: 'rate_limited' }));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[ai-extract]'));
  });

  it('does not swallow the neighbouring status mappings', async () => {
    // 503 and 504 are checked before the 429 branch; a greedy match would capture them.
    expect((await runExpectingError(respond(503, {}))).code).toBe('upstream_busy');
    expect((await runExpectingError(respond(504, {}))).code).toBe('timeout');
    expect((await runExpectingError(respond(500, {}))).code).toBe('provider_error');
  });
});

describe('managedProvider — the frozen wire format', () => {
  async function bodySentFor(req: Parameters<typeof managedProvider.run>[1]) {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      void init;
      return respond(200, { result: OK_RESULT });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await managedProvider.run('share', req);
    const init = fetchMock.mock.calls[0][1];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it('sends familyId as an ADDED field beside todayIso', async () => {
    const body = await bodySentFor({ ...request, familyId: 'fam-1' });
    expect(body).toMatchObject({ text: 'a school fair', todayIso: '2026-09-03', task: 'share' });
    expect(body.familyId).toBe('fam-1');
  });

  it('OMITS familyId entirely when absent, so an old body stays byte-identical', async () => {
    // The wire contract is additive in both directions: a bundle without a family id must
    // produce exactly the request it produced before #83, and the Lambda falls back to its IP
    // limit rather than 400ing.
    const body = await bodySentFor(request);
    expect('familyId' in body).toBe(false);
  });

  it('never renames the existing fields', async () => {
    const body = await bodySentFor({ ...request, familyId: 'fam-1' });
    expect(Object.keys(body).sort()).toEqual(['familyId', 'task', 'text', 'todayIso']);
  });
});
