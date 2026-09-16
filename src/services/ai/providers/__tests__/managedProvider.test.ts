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
import { ExtractionProviderError, type ShareKindHint } from '../../types';
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

/**
 * Answer the `ehbp-config` probe, then the real request.
 *
 * The provider asks the proxy which model to name inside the sealed body, so every test that
 * reaches the network now sees two calls. Memoised per module, hence the reset in beforeEach.
 */
function routed(handler: (body: Record<string, unknown>) => Response) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    if (body.protocol === 'ehbp-config') return respond(200, { model: 'gemma4-31b' });
    return handler(body);
  });
}

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

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const mod = await import('../managedProvider');
  mod.__resetManagedModelForTesting();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function runExpectingError(response: Response) {
  globalThis.fetch = routed(() => response) as unknown as typeof fetch;
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

describe('managedProvider — the memoised model lookup must not bind one caller (#49)', () => {
  // ⚠️ `attestation.ts` documents this exact anti-pattern at length, having already been bitten
  // by it: "Threading a per-caller signal into a memoised promise produced two bugs… the memo
  // bound every later caller to the first caller's signal." `enclaveModel` was then written the
  // same way — `modelPromise ??= (async () => postToProxy({…}, signal))()` — so the FIRST
  // caller's AbortSignal is captured inside a promise every subsequent caller awaits.
  //
  // The consequence is not theoretical: a family who opens the reader, backs out, and opens it
  // again cancels the first extraction, and the second one fails on a signal belonging to a
  // request that no longer exists.
  /**
   * A fetch mock that HONOURS `init.signal`, which the plain one does not.
   *
   * ⚠️ Written this way on purpose. The first version of this test slept and then resolved,
   * ignoring the signal entirely — so aborting a caller did nothing, both assertions passed,
   * and the bug they exist for sailed through. A cancellation test whose transport cannot be
   * cancelled proves only that the test runs.
   */
  function cancellableFetch(onConfigSignal: (s: AbortSignal | null | undefined) => void) {
    // ⚠️ The config probe is held open by an explicit RELEASE, not a timer. With a timer the
    // abort raced the timeout and sometimes landed after the probe had already resolved, so the
    // test passed against the buggy code roughly half the time — a flake that would eventually
    // be "fixed" by weakening the assertion it exists for.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (body.protocol !== 'ehbp-config') return respond(200, OK_SEALED);
      onConfigSignal(init.signal);
      return await new Promise<Response>((resolve, reject) => {
        void gate.then(() => resolve(respond(200, { model: 'gemma4-31b' })));
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true }
        );
      });
    });
    return { fetchMock: fetchMock as unknown as typeof fetch, release: () => release() };
  }

  it('does not let one caller cancel the shared config probe', async () => {
    const a = new AbortController();
    let configSignal: AbortSignal | null | undefined;
    const { fetchMock, release } = cancellableFetch((s) => (configSignal = s));
    globalThis.fetch = fetchMock;

    const first = managedProvider
      .run('share', { ...request, signal: a.signal })
      .catch(() => 'a-failed');
    await vi.waitFor(() => expect(configSignal).toBeDefined());
    a.abort();
    release();
    await first;

    // The shared lookup must outlive the caller that happened to start it.
    expect(configSignal?.aborted).toBe(false);
  });

  it('does not fail a second extraction when the first one is cancelled', async () => {
    const a = new AbortController();
    const b = new AbortController();
    let configSignal: AbortSignal | null | undefined;
    const { fetchMock, release } = cancellableFetch((s) => (configSignal = s));
    globalThis.fetch = fetchMock;

    const first = managedProvider
      .run('share', { ...request, signal: a.signal })
      .catch(() => 'a-failed');
    await vi.waitFor(() => expect(configSignal).toBeDefined());
    const second = managedProvider.run('share', { ...request, signal: b.signal });

    // Abort while the probe is definitively still in flight, THEN let it finish.
    a.abort();
    release();

    // The first caller may fail or may already have got what it needed — the abort races the
    // probe, and which side wins is not the property under test. Deliberately NOT asserted, so
    // this does not become a flake that gets "fixed" by weakening the line below.
    await first;
    // This is the property: B never asked to be cancelled, and A's cancellation is not B's.
    await expect(second).resolves.toBeDefined();
  });
});

describe('managedProvider — a cancel is not a failure (#49)', () => {
  // ⚠️ THE CASE THE CONCURRENCY TESTS DO NOT COVER. Those check a peer that was ALREADY waiting
  // when another caller aborted. This is the sequential one: cancel, then start again — which is
  // the actual story `callerSignal.ts` describes (open the reader, back out, open it again).
  //
  // `run()`'s catch clears both shared memos after any failed sealed request. A cancellation
  // landing in that catch throws away an attestation that is perfectly good, so the re-opened
  // reader pays a full fresh SEV-SNP verification plus a second config round trip — the exact
  // cost the memo exists to avoid, triggered by someone changing their mind.
  it('does not invalidate the shared memos when the caller cancelled', async () => {
    const controller = new AbortController();
    invalidateEnclaveVerification.mockClear();
    controller.abort();

    globalThis.fetch = routed(() => respond(200, OK_SEALED)) as unknown as typeof fetch;

    await expect(
      managedProvider.run('share', { ...request, signal: controller.signal })
    ).rejects.toBeInstanceOf(ExtractionProviderError);

    expect(invalidateEnclaveVerification).not.toHaveBeenCalled();
  });

  it('does not invalidate them when the SEALED POST is cancelled', async () => {
    // ⚠️ THE ONLY CANCELLATION WINDOW A PERSON CAN REALISTICALLY HIT. `raceCallerSignal` wraps
    // the two memo lookups, which are instant after the first read of a session; the long leg
    // is this POST. The other test aborts before `run()` and so never exercises it.
    invalidateEnclaveVerification.mockClear();
    const controller = new AbortController();

    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (body.protocol === 'ehbp-config') return respond(200, { model: 'gemma4-31b' });
      // The sealed POST: hang until the caller's signal aborts, exactly as fetch would.
      return await new Promise<Response>((_, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation was aborted.', 'AbortError')),
          { once: true }
        );
      });
    }) as unknown as typeof fetch;

    const run = managedProvider
      .run('share', { ...request, signal: controller.signal })
      .catch((e: ExtractionProviderError) => e);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await run;

    expect(invalidateEnclaveVerification).not.toHaveBeenCalled();
  });

  it('still invalidates them when something actually failed', async () => {
    // The other half of the branch, so "never invalidate" cannot pass this file.
    invalidateEnclaveVerification.mockClear();
    globalThis.fetch = routed(() =>
      respond(500, { error: 'boom' }, false)
    ) as unknown as typeof fetch;

    await expect(managedProvider.run('share', request)).rejects.toBeInstanceOf(
      ExtractionProviderError
    );

    expect(invalidateEnclaveVerification).toHaveBeenCalled();
  });
});

describe('managedProvider — the envelope-rejection family (#49)', () => {
  // ⚠️ The sealed arm added five `bad_*` refusals — `bad_sealed`, `bad_task`, `bad_srchash`,
  // `bad_ehbp`, `bad_correction` — and NONE of them had a ladder entry, so every one fell
  // through to `provider_error` carrying the detail "Managed proxy returned HTTP 400". For an
  // English-locale family `genericFailure` appends that detail straight into the toast, so a
  // bug in OUR envelope construction read to the family as an HTTP status code, and it reported
  // on `ERROR_SURFACE`, i.e. it paged.
  //
  // These are never a family's fault and never fixable by retrying: they mean this build sent
  // an envelope the proxy could not parse. The branch is keyed on the `bad_` PREFIX rather than
  // on five literals, because the gap was created by the Lambda growing a code the client did
  // not know about — a list of literals would reopen it the next time that happens.
  const CODES = ['bad_sealed', 'bad_task', 'bad_srchash', 'bad_ehbp', 'bad_correction'];

  it('does not put an HTTP status in front of the family for any of them', async () => {
    for (const code of CODES) {
      const err = await runExpectingError(respond(400, { error: 'nope', code }));
      expect(err).toBeInstanceOf(ExtractionProviderError);
      expect(err.message).not.toMatch(/HTTP \d/);
    }
  });

  it('still reports, because a malformed envelope means the feature is broken for everyone', async () => {
    const err = await runExpectingError(respond(400, { error: 'nope', code: 'bad_sealed' }));
    // NOT `not_available`: that renders a friendly info toast with no error surface, which
    // would hide a total client-side breakage from us entirely.
    expect(err.code).toBe('provider_error');
  });

  it('tells a developer WHICH field the proxy rejected', async () => {
    await runExpectingError(respond(400, { error: 'nope', code: 'bad_srchash' }));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('bad_srchash'));
  });

  it('never leaks an HTTP status to the family for ANY unrecognised code', async () => {
    // The prefix branch covers `bad_*`. These five are emitted by the same two files, match no
    // prefix and no status rung, and reached the terminal branch — which used to put the status
    // straight into an English family's toast.
    for (const code of [
      'upstream_badbody',
      'upstream_badjson',
      'upstream_network',
      'model_unparseable',
      'model_shape',
    ]) {
      const err = await runExpectingError(respond(502, { error: 'x', code }));
      expect(err.message, `code ${code} leaked a status`).not.toMatch(/HTTP \d/);
    }
    // And the codeless case, which is how a 401 or 500 arrives.
    expect((await runExpectingError(respond(500, {}))).message).not.toMatch(/HTTP \d/);
  });

  it('still tells a developer the status and code', async () => {
    await runExpectingError(respond(502, { code: 'upstream_badbody' }));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 502 code=upstream_badbody')
    );
  });

  it('leaves the neighbouring 400 mappings alone', async () => {
    // `unknown_protocol` and `unknown_task` are deploy-order problems with their own friendly
    // mapping; a greedy prefix match must not capture them.
    expect((await runExpectingError(respond(400, { code: 'unknown_protocol' }))).code).toBe(
      'not_available'
    );
    expect((await runExpectingError(respond(400, { code: 'unknown_task' }))).code).toBe(
      'not_available'
    );
  });
});

describe('managedProvider — the sealed wire format (#49)', () => {
  async function bodySentFor(req: Parameters<typeof managedProvider.run>[1]) {
    const fetchMock = routed(() => respond(200, OK_SEALED));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await managedProvider.run('share', req);
    // calls[0] is the config probe; the sealed request is the one after it.
    const sealedCall = fetchMock.mock.calls.find(
      (c) => JSON.parse(c[1].body as string).protocol === 'ehbp-1'
    )!;
    return JSON.parse(sealedCall[1].body as string) as Record<string, unknown>;
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
    const fetchMock = routed(() => respond(200, OK_SEALED));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await managedProvider
      .run('share', {
        ...request,
        familyId: 'fam-1',
        correction: { token: '11111111-2222-3333-4444-555555555555', to: 'travel' as const },
      })
      .catch(() => undefined);

    const body = JSON.parse(
      fetchMock.mock.calls.find((c) => JSON.parse(c[1].body as string).protocol === 'ehbp-1')![1]
        .body as string
    ) as Record<string, unknown>;
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

describe('managedProvider — what is actually SEALED', () => {
  // ⚠️ THE TEST THAT WAS MISSING. The first version of this feature omitted `model` from the
  // sealed body, and every test passed because `sealForEnclave` was mocked and its PAYLOAD never
  // asserted. The enclave rejects a body without it (`400 Missing required parameter: 'model'`,
  // checked before auth), so 100% of managed extractions would have failed with a generic toast.
  // Assert the payload, not just that sealing happened.
  it('seals a body carrying the model the proxy named', async () => {
    globalThis.fetch = routed(() => respond(200, OK_SEALED)) as unknown as typeof fetch;
    sealForEnclave.mockClear();

    await managedProvider.run('share', request);

    const [key, payload] = sealForEnclave.mock.calls[0]!;
    expect(key).toBe('deadbeef');
    const sealedBody = payload as { model?: string; messages?: unknown[]; temperature?: number };
    expect(sealedBody.model).toBe('gemma4-31b');
    expect(Array.isArray(sealedBody.messages)).toBe(true);
    expect(sealedBody.temperature).toBe(0);
  });

  it('asks the proxy for the model rather than hardcoding it, so the terraform lever still works', async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // A model retirement is a Lambda env change; the client must follow it without a release.
      if (body.protocol === 'ehbp-config') return respond(200, { model: 'some-new-model' });
      return respond(200, OK_SEALED);
    }) as unknown as typeof fetch;
    sealForEnclave.mockClear();

    await managedProvider.run('share', request);

    expect((sealForEnclave.mock.calls[0]![1] as { model?: string }).model).toBe('some-new-model');
  });

  it('refuses rather than sealing a bodyless model when the proxy will not say', async () => {
    globalThis.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      if (body.protocol === 'ehbp-config') return respond(200, {});
      return respond(200, OK_SEALED);
    }) as unknown as typeof fetch;
    sealForEnclave.mockClear();

    await expect(managedProvider.run('share', request)).rejects.toMatchObject({
      code: 'not_available',
    });
    expect(sealForEnclave).not.toHaveBeenCalled();
  });
});

describe('managedProvider — the client kind-guard (#49)', () => {
  // The guard MOVED from the Lambda to here, because a blind forwarder cannot read the answer.
  // Testing-Plan item 6 asked for it "over every (resultKind, hint) pair" and it was never
  // written, so the move was unverified: three distinct outcomes, no coverage at all.
  //
  // ⚠️ The `none` split is the part that matters and the part most likely to be "simplified"
  // away. A `none` answer to a HINTED prompt is the model DISAGREEING, not failing — the hint
  // leaves it exactly one way out — so reporting "try a clearer photo" for a perfectly legible
  // page is both false and an invitation to a retry that costs a bean.
  /** A share reply the REAL parser accepts — a bare `{ kind }` is rejected before the guard. */
  const EVENT_PAYLOAD = {
    isEvent: true,
    title: 'Sports Day',
    date: '2026-07-12',
    startTime: '09:00',
    endTime: '12:00',
    isAllDay: false,
    location: 'School Field',
    description: '',
    confidence: { title: 0.9, date: 0.9, startTime: 0.8, endTime: 0.8, location: 0.9 },
  };
  function replyOfKind(kind: string) {
    // Only 'event' and 'none' are used. Every case below varies the ASSERTED kind instead of
    // the result kind, so a parser rejection can never be mistaken for the guard firing — both
    // produce `malformed_output`, and an earlier draft of these tests passed on exactly that
    // ambiguity.
    const body = kind === 'none' ? { kind: 'none' } : { kind: 'event', event: EVENT_PAYLOAD };
    openSealed.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(body) } }],
    });
  }

  async function runCorrection({
    to,
    correctionFree,
    resultKind,
  }: {
    to: ShareKindHint;
    correctionFree: boolean;
    resultKind: string;
  }) {
    globalThis.fetch = routed(() =>
      respond(200, { ...OK_SEALED, correctionFree })
    ) as unknown as typeof fetch;
    replyOfKind(resultKind);
    return managedProvider
      .run('share', { ...request, correction: { token: 't', to } })
      .then(() => 'ok')
      .catch((e: ExtractionProviderError) => e.code);
  }

  it('accepts a result that MATCHES the asserted kind', async () => {
    expect(await runCorrection({ to: 'event', correctionFree: true, resultKind: 'event' })).toBe(
      'ok'
    );
  });

  it('reports a `none` answer as a DISAGREEMENT, not a malformed one', async () => {
    expect(await runCorrection({ to: 'event', correctionFree: true, resultKind: 'none' })).toBe(
      'correction_disagreed'
    );
  });

  it('reports a different, non-none kind as malformed', async () => {
    // Asserted `recipe`, model answered `event`: a real disagreement of shape, and the result
    // PARSED cleanly, so `malformed_output` here can only have come from the guard.
    expect(await runCorrection({ to: 'recipe', correctionFree: true, resultKind: 'event' })).toBe(
      'malformed_output'
    );
  });

  it('does NOT fire when no grant was actually spent, whatever the user asserted', async () => {
    // ⚠️ Gated on `correctionFree`, not on the user having asserted a kind. The Lambda's guard
    // ran on `read.kindHint`, which is set only when a grant was SPENT, so it could not fire on
    // the two fall-through outcomes: the CORRECTION_GRANTS kill switch, and a DynamoDB blip.
    // Without this gate, during exactly the incident the kill switch exists for, a family taps
    // a banner labelled free, is charged, and is shown a toast saying nothing was charged.
    // Same mismatch as the case above — asserted `recipe`, answered `event` — differing ONLY in
    // that no grant was spent. It must now pass through untouched.
    expect(await runCorrection({ to: 'recipe', correctionFree: false, resultKind: 'event' })).toBe(
      'ok'
    );
  });
});

describe('managedProvider — the client-side bill bound (#49)', () => {
  it('refuses oversized text BEFORE sealing, and makes no network call at all', async () => {
    // The one validation the Lambda genuinely lost: `MAX_TEXT_CHARS` cannot be enforced on
    // ciphertext. The link arm is why it has to exist — its text comes back from the
    // content-fetch Lambda and nothing else bounds it. Code existed; no test called `run()`
    // with oversized text, so the refusal was unverified.
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      managedProvider.run('share', {
        ...request,
        source: { kind: 'text', text: 'x'.repeat(32_001) },
      })
    ).rejects.toBeInstanceOf(ExtractionProviderError);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sealForEnclave).not.toHaveBeenCalled();
  });

  it('allows text exactly at the bound', async () => {
    globalThis.fetch = routed(() => respond(200, OK_SEALED)) as unknown as typeof fetch;
    await expect(
      managedProvider.run('share', {
        ...request,
        source: { kind: 'text', text: 'x'.repeat(32_000) },
      })
    ).resolves.toBeDefined();
  });
});

describe('managedProvider — verification gates the send', () => {
  it('REFUSES to send when the enclave does not verify, and makes no proxy call at all', async () => {
    const fetchMock = routed(() => respond(200, OK_SEALED));
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
    // ⚠️ This used to fail EVERY fetch with a 500, which meant it never got past the
    // `ehbp-config` probe inside `enclaveModel` — so it exercised the catch block via a failed
    // CONFIG call and proved nothing about the sealed request its name describes. `routed`
    // answers the config probe and fails only the sealed POST, which is the path that matters:
    // `openSealed` failing IS the stale-key symptom, and if the memo survived it the dead key
    // would stay cached for the full TTL while every retry re-sealed to it and cost a bean.
    invalidateEnclaveVerification.mockClear();
    globalThis.fetch = routed(() =>
      respond(500, { error: 'boom' }, false)
    ) as unknown as typeof fetch;

    await expect(managedProvider.run('share', request)).rejects.toBeInstanceOf(
      ExtractionProviderError
    );

    // Not "on a stale-key-shaped failure": we have never observed what a Tinfoil key rotation
    // looks like on the wire, so clearing unconditionally is what covers every shape.
    expect(invalidateEnclaveVerification).toHaveBeenCalled();
  });

  it('clears the memo when OPENING the reply fails, which is the stale-key shape', async () => {
    invalidateEnclaveVerification.mockClear();
    globalThis.fetch = routed(() => respond(200, OK_SEALED)) as unknown as typeof fetch;
    // After a key rotation the seal succeeds against the memoised key and the enclave still
    // answers 200 — the failure lands here, on the open, and nowhere earlier.
    openSealed.mockRejectedValueOnce(new Error('AEAD tag mismatch'));

    await expect(managedProvider.run('share', request)).rejects.toBeInstanceOf(
      ExtractionProviderError
    );

    expect(invalidateEnclaveVerification).toHaveBeenCalled();
  });

  it('maps the proxy 413 to a classified error with a developer console line', async () => {
    // The SERVER's verdict, deliberately, rather than a client-side size guess. Code existed;
    // nothing tested it.
    const err = await runExpectingError(
      respond(413, { error: 'Payload too large', code: 'payload_too_large' })
    );
    expect(err.code).toBe('provider_error');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('body cap'));
  });

  it('marks the result verified from OUR verification, not a server header', async () => {
    globalThis.fetch = routed(() => respond(200, OK_SEALED)) as unknown as typeof fetch;
    const result = await managedProvider.run('share', request);
    expect(result.attestation).toEqual({ enclave: 'inference.tinfoil.sh', verified: true });
  });
});
