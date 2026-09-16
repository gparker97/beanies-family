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
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { ExtractionProviderError } from '../../types';
import type { managedProvider as ManagedProvider } from '../managedProvider';

// ⚠️ `managedProvider` reads `import.meta.env.VITE_AI_EXTRACT_URL` at MODULE LOAD, and ESM
// hoists static imports above every top-level statement — so a static `import` here would
// capture the environment BEFORE `vi.stubEnv` ran. It only appeared to work locally because a
// developer's `.env.local` supplies that variable; CI has no `.env`, so `PROXY_URL` was
// undefined and every 429 assertion got `not_available` instead. A test that passes only on a
// machine with the right dotfile is not a test.
//
// Stub first, then import dynamically inside `beforeAll` (which runs after top-level code).
vi.stubEnv('VITE_AI_EXTRACT_URL', 'https://api.example.test/ai-extract');
vi.stubEnv('VITE_AI_EXTRACT_API_KEY', 'soft-key');

// The enclave is mocked, not reached. Verification is a real network round trip against Tinfoil
// plus a GitHub release lookup, and a unit test must not depend on either being up. The live
// path has its own proof: `scripts/spikes/enclave-attestation.mjs` runs the real verifier.
const verifyEnclave = vi.fn(async (_signal?: AbortSignal) => ({
  hpkePublicKey: 'deadbeef',
  enclave: 'inference.tinfoil.sh',
  verified: true as const,
}));
const invalidateEnclaveVerification = vi.fn();
vi.mock('../../enclave/attestation', () => ({
  verifyEnclave: (signal?: AbortSignal) => verifyEnclave(signal),
  invalidateEnclaveVerification: () => invalidateEnclaveVerification(),
}));

const sealForEnclave = vi.fn(async (_key: string, _payload: unknown) => ({
  ciphertext: new Uint8Array([1, 2, 3, 4]),
  headers: { 'ehbp-encapsulated-key': 'KEY' },
  context: { marker: 'ctx' } as unknown as never,
}));
const openSealed = vi.fn(async (_ctx: unknown, _bytes: Uint8Array, _headers: unknown) => ({
  choices: [{ message: { content: JSON.stringify({ kind: 'none' }) } }],
}));
vi.mock('../../enclave/seal', () => ({
  sealForEnclave: (key: string, payload: unknown) => sealForEnclave(key, payload),
  openSealed: (ctx: unknown, bytes: Uint8Array, headers: unknown) =>
    openSealed(ctx, bytes, headers),
}));

let managedProvider: typeof ManagedProvider;
beforeAll(async () => {
  ({ managedProvider } = await import('../managedProvider'));
});

const originalFetch = globalThis.fetch;

/** What the proxy returns now: the enclave's reply, still sealed. `openSealed` is mocked above. */
const OK_SEALED = { sealed: 'AQIDBA==', ehbp: { 'ehbp-response-nonce': 'n' } };

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

describe('managedProvider — the sealed wire format (#49)', () => {
  async function bodySentFor(req: Parameters<typeof managedProvider.run>[1]) {
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      void init;
      return respond(200, OK_SEALED);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await managedProvider.run('share', req);
    const init = fetchMock.mock.calls[0][1];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  it('sends the sealed envelope, and the document is NOT in it', async () => {
    const body = await bodySentFor({ ...request, familyId: 'fam-1' });

    expect(body.protocol).toBe('ehbp-1');
    expect(body.sealed).toBe('AQIDBA==');
    expect(body.familyId).toBe('fam-1');
    expect(body.task).toBe('share');
    expect(typeof body.srcHash).toBe('string');
    // The whole point: the plaintext the old contract carried is gone from the wire.
    expect('text' in body).toBe(false);
    expect('imageDataUrls' in body).toBe(false);
    expect(JSON.stringify(body)).not.toContain('a school fair');
  });

  it('omits todayIso — the client builds the prompt now, so the server has no use for it', async () => {
    const body = await bodySentFor(request);
    expect('todayIso' in body).toBe(false);
  });

  it('sends a correction TOKEN only, never the asserted kind', async () => {
    // Asserts the WIRE, so it deliberately does not care what happens downstream: with a
    // correction in play the moved kind-guard may well reject the mocked reply, and that is the
    // guard working. Capture the request body and let the rest fall where it falls.
    const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => respond(200, OK_SEALED));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await managedProvider
      .run('share', {
        ...request,
        familyId: 'fam-1',
        correction: { token: '11111111-2222-3333-4444-555555555555', to: 'travel' as const },
      })
      .catch(() => undefined);

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    // `to` would put the family's own assertion about their document on the wire in cleartext,
    // and nothing server-side needs it any more: consumeGrant stopped conditioning on the kind,
    // and the closed-set check existed only because `to` reached the model's instruction, which
    // it cannot do now that the CLIENT builds the prompt.
    expect(body.correction).toEqual({ token: '11111111-2222-3333-4444-555555555555' });
    expect(JSON.stringify(body)).not.toContain('travel');
  });

  it('OMITS familyId entirely when absent', async () => {
    const body = await bodySentFor(request);
    expect('familyId' in body).toBe(false);
  });

  it('hashes the source into srcHash rather than sending it', async () => {
    const a = await bodySentFor(request);
    const b = await bodySentFor({ ...request, source: { kind: 'text', text: 'something else' } });
    expect(a.srcHash).not.toBe(b.srcHash);
    // Same input, same hash: the grant binding depends on it being stable.
    const again = await bodySentFor(request);
    expect(again.srcHash).toBe(a.srcHash);
  });
});

describe('managedProvider — verification gates the send', () => {
  it('REFUSES to send when the enclave does not verify, and makes no proxy call at all', async () => {
    const fetchMock = vi.fn(async () => respond(200, OK_SEALED));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    verifyEnclave.mockRejectedValueOnce(new ExtractionProviderError('attestation_failed', 'nope'));

    await expect(managedProvider.run('share', request)).rejects.toMatchObject({
      code: 'attestation_failed',
    });

    // The assertion that matters. There is no degrade-to-plaintext path, so an unverified
    // enclave must produce ZERO network traffic carrying the document.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears the verification memo after ANY failed sealed request', async () => {
    invalidateEnclaveVerification.mockClear();
    globalThis.fetch = vi.fn(async () =>
      respond(500, { error: 'boom' }, false)
    ) as unknown as typeof fetch;

    await expect(managedProvider.run('share', request)).rejects.toBeInstanceOf(
      ExtractionProviderError
    );

    // Not "on a stale-key-shaped failure": we have never observed what a Tinfoil key rotation
    // looks like on the wire, so clearing unconditionally is what covers every shape.
    expect(invalidateEnclaveVerification).toHaveBeenCalled();
  });

  it('marks the result verified from OUR verification, not a server header', async () => {
    globalThis.fetch = vi.fn(async () => respond(200, OK_SEALED)) as unknown as typeof fetch;
    const result = await managedProvider.run('share', request);
    expect(result.attestation).toEqual({ enclave: 'inference.tinfoil.sh', verified: true });
  });
});
