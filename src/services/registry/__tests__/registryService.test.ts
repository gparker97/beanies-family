/**
 * The registry WIRE CONTRACT, which had no direct coverage at all — and it is
 * one half of a two-sided migration whose other half deploys on its own cadence.
 * The Lambda's tests pin what the server does with each shape; these pin that
 * the client actually sends those shapes.
 *
 * The two that matter most:
 *   - `writerMemberId` must be PRESENT on every write, even when null. The server
 *     distinguishes absent (a pre-split client, judged on `ownerMemberId` for
 *     compatibility) from present-and-null (nobody signed in, which must not be
 *     able to move the pointer). Sending nothing takes the legacy path forever.
 *   - The DELETE must carry it as a QUERY parameter. A body on DELETE is legal
 *     and is dropped by enough intermediaries to be a bad bet, and when the
 *     server starts refusing, a caller that sends none is refused every time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/config/features', () => ({ features: { registry: true } }));

import {
  removeFamily,
  registerFamily,
  registerFamilyOrThrow,
  type RegistryWritePayload,
} from '../registryService';

const FAMILY = '11111111-2222-4333-8444-555555555555';
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function payload(over: Partial<RegistryWritePayload> = {}): RegistryWritePayload {
  return {
    provider: 'google_drive',
    fileId: 'file-1',
    displayPath: 'pod.beanpod',
    familyName: 'The Parkers',
    ownerEmail: 'owner@example.com',
    ownerMemberId: OWNER,
    writerMemberId: OWNER,
    subscribeNewsletter: null,
    country: 'SG',
    beanpodSizeKb: 350,
    memberCount: 4,
    signupPlatform: null,
    lastLoginAt: null,
    createdAt: null,
    ...over,
  } as RegistryWritePayload;
}

function okFetch(body: Record<string, unknown> = { success: true }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function failFetch(status: number) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'nope',
    json: async () => ({}),
  });
}

/** The URL the last fetch was called with. */
function lastUrl(f: ReturnType<typeof okFetch>): string {
  return f.mock.calls[0]![0] as string;
}

/** The parsed JSON body the last fetch was called with. */
function lastBody(f: ReturnType<typeof okFetch>): Record<string, unknown> {
  return JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string);
}

describe('registry PUT — the writer/owner split on the wire', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends writerMemberId', async () => {
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;

    await registerFamilyOrThrow(FAMILY, payload());

    expect(lastBody(f).writerMemberId).toBe(OWNER);
  });

  it('sends writerMemberId as an explicit NULL, never omitted, when nobody is signed in', async () => {
    // ⚠️ THE WHOLE POINT OF THE FIELD BEING REQUIRED. `JSON.stringify` drops
    // `undefined`, so an optional field left unset would reach the server as
    // ABSENT — which the server reads as "a client from before the split" and
    // judges on `ownerMemberId` instead. That is the roster owner, a value any
    // device holding the decrypted pod can compute, so an unauthenticated writer
    // would be handed the guard's own answer.
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;

    await registerFamilyOrThrow(FAMILY, payload({ writerMemberId: null }));

    const body = lastBody(f);
    expect('writerMemberId' in body).toBe(true);
    expect(body.writerMemberId).toBeNull();
  });

  it('counts where the owner fields came from, on the SUCCESS path', async () => {
    // A counter that only fires on failure cannot give you a rate.
    global.fetch = okFetch({ success: true, pointerAccepted: true });
    await registerFamilyOrThrow(FAMILY, payload());
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'put', count: 1 } })
    );

    vi.clearAllMocks();
    global.fetch = okFetch({ success: true, pointerAccepted: true });
    await registerFamilyOrThrow(FAMILY, payload({ ownerMemberId: null, ownerEmail: null }));
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'put', count: 0 } })
    );
  });

  it('counts a refused pointer at warn', async () => {
    global.fetch = okFetch({ success: true, pointerAccepted: false });

    const result = await registerFamilyOrThrow(FAMILY, payload());

    expect(result.pointerAccepted).toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', context: { action: 'refused' } })
    );
  });

  it('treats an ABSENT pointerAccepted as accepted, for an older Lambda', async () => {
    global.fetch = okFetch({ success: true });

    const result = await registerFamilyOrThrow(FAMILY, payload());

    expect(result.pointerAccepted).toBe(true);
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'refused' } })
    );
  });

  it('counts a swallowed write failure — the caller learns nothing, the firehose does', async () => {
    global.fetch = failFetch(500);

    expect(await registerFamily(FAMILY, payload())).toBeNull();

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', context: { action: 'put-failed' } })
    );
  });
});

describe('registry DELETE — the writer id rides the query string', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends writerMemberId as a query parameter, not a body', async () => {
    const f = okFetch();
    global.fetch = f;

    await removeFamily(FAMILY, OWNER);

    expect(lastUrl(f)).toContain(`?writerMemberId=${OWNER}`);
    expect((f.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
  });

  it('omits the parameter entirely when there is no writer to name', async () => {
    // Better than sending an empty one: the server validates it as a UUID and
    // logs "no-writer-id", which is the honest state.
    const f = okFetch();
    global.fetch = f;

    await removeFamily(FAMILY, null);

    expect(lastUrl(f)).not.toContain('writerMemberId');
  });

  it('still keeps the familyId in the PATH, not smuggled through the query', async () => {
    const f = okFetch();
    global.fetch = f;

    await removeFamily(FAMILY, OWNER);

    expect(lastUrl(f)).toContain(`/family/${FAMILY}?`);
  });

  it('reports a refusal rather than discarding the response', async () => {
    // The response used to be thrown away, so a 403 from the coming enforcement
    // would have been perfectly silent while the user was told their family was
    // deleted from everywhere.
    global.fetch = failFetch(403);

    expect(await removeFamily(FAMILY, OWNER)).toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: { action: 'delete-failed', http_status: 403 },
      })
    );
  });

  it('reports success', async () => {
    global.fetch = okFetch();

    expect(await removeFamily(FAMILY, OWNER)).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'delete' } })
    );
  });
});
