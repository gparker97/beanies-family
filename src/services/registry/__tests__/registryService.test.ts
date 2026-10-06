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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent }));
vi.mock('@/config/features', () => ({ features: { registry: true } }));

import {
  lookupFamilyResult,
  removeFamily,
  registerFamily,
  registerFamilyOrThrow,
  addRegistryEntryObserver,
  type RegistryWritePayload,
} from '../registryService';

const FAMILY = '11111111-2222-4333-8444-555555555555';
const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function payload(over: Partial<RegistryWritePayload> = {}): RegistryWritePayload {
  return {
    provider: 'google_drive',
    fileId: 'file-1',
    displayPath: 'pod.beanpod',
    familyName: 'The Brambleworths',
    ownerEmail: 'owner@example.com',
    ownerMemberId: OWNER,
    writerMemberId: OWNER,
    writerEmail: 'owner@example.com',
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

  it('sends writerEmail, and as an explicit NULL rather than omitted', async () => {
    // ⚠️ SAME PRESENCE RULE AS `writerMemberId`, and forgetting it opened a hole
    // rather than closing one. The server's LEGACY pointer tier compares emails;
    // once `ownerEmail` came from the pod roster, every device sent the OWNER'S
    // address, so that tier matched for everyone and any member could re-point a
    // legacy row. An ABSENT field means "pre-split client" and takes the old
    // path, so the field has to be there even when there is no email to give.
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;
    await registerFamilyOrThrow(FAMILY, payload());
    expect(lastBody(f).writerEmail).toBe('owner@example.com');

    const g = okFetch({ success: true, pointerAccepted: true });
    global.fetch = g;
    await registerFamilyOrThrow(FAMILY, payload({ writerEmail: null }));
    const body = lastBody(g);
    expect('writerEmail' in body).toBe(true);
    expect(body.writerEmail).toBeNull();
  });

  it('sends the campaign tag as one `attribution` map, untouched (#118)', async () => {
    // The Lambda validates and stamps it write-once; the client forwards its stash verbatim.
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;
    const attribution = { utm_source: 'chatgpt', utm_content: 'calm-ad1', oppref: 'o1' };
    await registerFamilyOrThrow(FAMILY, payload({ attribution }));
    expect(lastBody(f).attribution).toEqual(attribution);
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

describe('registry PUT — the owner-sync response', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends ownerSync on the wire when the payload carries it', async () => {
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;

    await registerFamilyOrThrow(FAMILY, payload({ ownerSync: true }));

    expect(lastBody(f).ownerSync).toBe(true);
  });

  it('returns the stored owner from the response, through both write paths', async () => {
    const owner = { memberId: OWNER, email: 'owner@example.com' };
    global.fetch = okFetch({ success: true, pointerAccepted: true, owner });
    expect(await registerFamilyOrThrow(FAMILY, payload())).toEqual({
      pointerAccepted: true,
      owner,
    });

    global.fetch = okFetch({ success: true, pointerAccepted: true, owner });
    expect(await registerFamily(FAMILY, payload())).toEqual({ pointerAccepted: true, owner });
  });

  it('keeps null owner fields as null', async () => {
    global.fetch = okFetch({ success: true, owner: { memberId: OWNER, email: null } });
    const result = await registerFamilyOrThrow(FAMILY, payload());
    expect(result.owner).toEqual({ memberId: OWNER, email: null });
  });

  it('an ownerSync write logs neither the ambient put count nor a refused pointer', async () => {
    global.fetch = okFetch({
      success: true,
      pointerAccepted: false,
      owner: { memberId: null, email: null },
    });
    const result = await registerFamilyOrThrow(FAMILY, payload({ ownerSync: true }));

    expect(result).toEqual({ pointerAccepted: false, owner: { memberId: null, email: null } });
    // `registryOwnerSync` logs its own outcome; this layer stays silent for that write.
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('an ownerSync write returns the outcome; a non-string outcome is dropped', async () => {
    global.fetch = okFetch({
      success: true,
      pointerAccepted: true,
      owner: { memberId: OWNER, email: 'owner@example.com' },
      outcome: 'refused-handover-locked',
    });
    expect(await registerFamilyOrThrow(FAMILY, payload({ ownerSync: true }))).toEqual({
      pointerAccepted: true,
      owner: { memberId: OWNER, email: 'owner@example.com' },
      outcome: 'refused-handover-locked',
    });

    global.fetch = okFetch({ success: true, pointerAccepted: true, outcome: 42 });
    expect(await registerFamilyOrThrow(FAMILY, payload({ ownerSync: true }))).toEqual({
      pointerAccepted: true,
    });
  });

  it('sends ownerSyncReason on the wire with the flag', async () => {
    const f = okFetch({ success: true, pointerAccepted: true });
    global.fetch = f;
    await registerFamilyOrThrow(FAMILY, payload({ ownerSync: true, ownerSyncReason: 'transfer' }));
    expect(lastBody(f).ownerSyncReason).toBe('transfer');
  });

  it('a swallowed ownerSync failure is counted as owner-sync-put-failed, not put-failed', async () => {
    global.fetch = failFetch(500);

    expect(await registerFamily(FAMILY, payload({ ownerSync: true }))).toBeNull();

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', context: { action: 'owner-sync-put-failed' } })
    );
    expect(logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'put-failed' } })
    );
  });

  it('an ambient write still logs its put count and a refused pointer', async () => {
    global.fetch = okFetch({ success: true, pointerAccepted: false });
    await registerFamilyOrThrow(FAMILY, payload());

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'put', count: 1 } })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', context: { action: 'refused' } })
    );
  });

  it('leaves owner absent for an older Lambda or a malformed block', async () => {
    for (const body of [
      { success: true },
      { success: true, owner: null },
      { success: true, owner: 'x' },
      { success: true, owner: { memberId: 42, email: null } },
    ]) {
      global.fetch = okFetch(body);
      const result = await registerFamilyOrThrow(FAMILY, payload());
      expect(result).toEqual({ pointerAccepted: true });
      expect('owner' in result).toBe(false);
    }
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

describe('registry GET: the entry observers (#95, #117)', () => {
  // `entitlementStore` learns the family's plan, and `counterWritesPolicy` the Counter-write
  // policy, from lookups other callers make. The seam must hand every successful one to every
  // observer and must never be able to break one.
  const removers: Array<() => void> = [];
  function observe(fn: (e: unknown) => void): void {
    removers.push(addRegistryEntryObserver(fn));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    while (removers.length) removers.pop()!();
  });

  const entry = { familyId: FAMILY, provider: 'google_drive', updatedAt: '2026-09-30' };

  it('hands every found entry to every observer', async () => {
    global.fetch = okFetch(entry);
    const first = vi.fn();
    const second = vi.fn();
    observe(first);
    observe(second);

    const r = await lookupFamilyResult(FAMILY);

    expect(r).toEqual({ status: 'found', entry });
    expect(first).toHaveBeenCalledWith(entry);
    expect(second).toHaveBeenCalledWith(entry);
  });

  it('a removed observer is no longer called', async () => {
    global.fetch = okFetch(entry);
    const seen = vi.fn();
    const remove = addRegistryEntryObserver(seen);
    remove();

    await lookupFamilyResult(FAMILY);

    expect(seen).not.toHaveBeenCalled();
  });

  it('does not call an observer for an absent or unavailable family', async () => {
    const seen = vi.fn();
    observe(seen);

    global.fetch = failFetch(404);
    expect(await lookupFamilyResult(FAMILY)).toEqual({ status: 'absent' });
    global.fetch = failFetch(503);
    expect((await lookupFamilyResult(FAMILY)).status).toBe('unavailable');

    expect(seen).not.toHaveBeenCalled();
  });

  it('a throwing observer never fails the lookup nor starves the next observer, and is logged', async () => {
    global.fetch = okFetch(entry);
    const after = vi.fn();
    observe(() => {
      throw new Error('observer bug');
    });
    observe(after);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await lookupFamilyResult(FAMILY);

    expect(r).toEqual({ status: 'found', entry });
    expect(after).toHaveBeenCalledWith(entry);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        surface: 'registry',
        context: { action: 'observer_failed' },
      })
    );
    warn.mockRestore();
  });
});
