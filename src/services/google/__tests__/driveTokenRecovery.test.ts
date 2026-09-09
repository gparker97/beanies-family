// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import {
  upsertDriveConnection,
  getDriveConnectionByAccount,
} from '@/services/automerge/repositories/driveRepository';
import type { StoredRefreshToken } from '@/services/sync/fileHandleStore';
import { PodLineageError } from '@/services/sync/podLineage';
import { PayloadTooLargeError } from '@/types/sync';

// ── Mock the heavy auth deps; use the REAL docService + driveRepository ────────
const primeRefreshToken = vi.fn();
const attemptSilentRefresh = vi.fn<() => Promise<string | null>>();
let tokenValid = false;
// Controllable session epoch — bump mid-flight to simulate a sign-out between the
// async doc read and the adopt (the session-epoch guard).
let mockSessionEpoch = 0;
let mockLiveAccount: string | null = 'greg@example.com';
vi.mock('@/services/google/googleAuth', () => ({
  onTokenAcquired: () => () => {},
  primeRefreshToken: (...a: unknown[]) => primeRefreshToken(...a),
  attemptSilentRefresh: () => attemptSilentRefresh(),
  isTokenValid: () => tokenValid,
  getSessionEpoch: () => mockSessionEpoch,
  // A refresh that restores the WRONG account is not a reconnect: the pod stays
  // unreachable. Defaults to the bound account so the ordinary tests describe an
  // ordinary device.
  getGoogleAccountEmail: () => mockLiveAccount,
}));
const logEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...a: unknown[]) => logEvent(...a) }));

const storeGoogleRefreshToken = vi
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
let localToken: StoredRefreshToken | null = null;
// Optional side-effect fired when the local refresh token is read — lets a test
// simulate a sign-out (epoch bump) landing DURING reconcile's Promise.all read.
let onLocalRead: (() => void) | null = null;
vi.mock('@/services/sync/fileHandleStore', () => ({
  getGoogleRefreshToken: () => {
    onLocalRead?.();
    return Promise.resolve(localToken);
  },
  storeGoogleRefreshToken: (...a: unknown[]) => storeGoogleRefreshToken(...a),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: () => 'fam-1',
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

// Step 3 reaches `syncService` through a DYNAMIC import, so the factory is only
// ever evaluated on the path that takes it.
// ⚠️ A REAL `PodLineageError`, not `{ blockCode: 'lineage' }`. Step 3 gates on the
// CLASS, because `isRemoteBlocked()` is also true for an out-of-memory or corrupt
// latch — states where re-downloading a multi-MB pod and re-running the same
// whole-doc decrypt is precisely what the latch exists to prevent.
let remoteBlocked: object | null = null;
const readRemoteDriveConnections = vi.fn<() => Promise<unknown[] | null>>();
vi.mock('@/services/sync/syncService', () => ({
  isRemoteBlocked: () => remoteBlocked,
  readRemoteDriveConnections: () => readRemoteDriveConnections(),
}));

import {
  matchesBoundAccount,
  readDriveTokenFromDoc,
  reconcileDriveTokenWithDoc,
  tryReconnectSilently,
} from '@/services/google/driveTokenRecovery';

beforeEach(async () => {
  await installInlineBackend();
  primeRefreshToken.mockClear();
  attemptSilentRefresh.mockReset();
  storeGoogleRefreshToken.mockClear();
  logEvent.mockClear();
  localToken = null;
  onLocalRead = null;
  tokenValid = false;
  mockSessionEpoch = 0;
  mockLiveAccount = 'greg@example.com';
  remoteBlocked = null;
  readRemoteDriveConnections.mockReset();
  readRemoteDriveConnections.mockResolvedValue(null);
});

async function seedDoc(accountEmail: string, refreshToken: string, issuedAt: number | null) {
  await upsertDriveConnection({ provider: 'google', accountEmail, refreshToken, issuedAt });
}

describe('matchesBoundAccount (the cross-account guard)', () => {
  it('matches case-insensitively and trims', () => {
    expect(matchesBoundAccount('Greg@Example.com', '  greg@example.com ')).toBe(true);
  });
  it('rejects a different account', () => {
    expect(matchesBoundAccount('a@example.com', 'b@example.com')).toBe(false);
  });
  it('rejects when either side is null/undefined/missing', () => {
    expect(matchesBoundAccount(null, 'a@example.com')).toBe(false);
    expect(matchesBoundAccount('a@example.com', undefined)).toBe(false);
    expect(matchesBoundAccount(undefined, undefined)).toBe(false);
  });
  it('rejects when either side normalizes to empty/whitespace', () => {
    expect(matchesBoundAccount('', '')).toBe(false);
    expect(matchesBoundAccount('   ', '   ')).toBe(false);
    expect(matchesBoundAccount('a@example.com', '   ')).toBe(false);
  });
});

describe('readDriveTokenFromDoc', () => {
  it('returns null when no doc entry exists', async () => {
    expect(await readDriveTokenFromDoc('greg@example.com')).toBeNull();
  });
  it('returns the token for the matching account', async () => {
    await seedDoc('greg@example.com', 'tok', 1234);
    expect(await readDriveTokenFromDoc('GREG@example.com')).toEqual({
      token: 'tok',
      issuedAt: 1234,
    });
  });
  it('returns null for a non-matching/absent bound account', async () => {
    await seedDoc('a@example.com', 'a-tok', 1);
    expect(await readDriveTokenFromDoc('b@example.com')).toBeNull();
    expect(await readDriveTokenFromDoc(undefined)).toBeNull();
    expect(await readDriveTokenFromDoc('')).toBeNull();
  });
});

describe('reconcileDriveTokenWithDoc', () => {
  it('doc newer than local → restores local + primes in-memory', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    localToken = { token: 'local-tok', issuedAt: 1000 };

    await reconcileDriveTokenWithDoc('greg@example.com');

    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'doc-tok', { issuedAt: 2000 });
    expect(primeRefreshToken).toHaveBeenCalledWith('fam-1', { token: 'doc-tok', issuedAt: 2000 });
  });

  it('local newer than doc → mirrors local into the doc; never primes', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 1000);
    localToken = { token: 'local-tok', issuedAt: 2000 };

    await reconcileDriveTokenWithDoc('greg@example.com');

    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect((await getDriveConnectionByAccount('greg@example.com'))?.refreshToken).toBe('local-tok');
  });

  it('A3: a sign-out mid-read does NOT mirror the local token into the shared doc', async () => {
    // Local strictly newer than doc → the mirror branch. A sign-out (epoch bump)
    // lands during the Promise.all read; the symmetric mirrorLocalToDoc guard must
    // skip the upsert so a torn-down session's token never reaches the synced doc.
    await seedDoc('greg@example.com', 'doc-tok', 1000);
    localToken = { token: 'local-tok', issuedAt: 2000 };
    onLocalRead = () => {
      mockSessionEpoch = 1;
    };

    await reconcileDriveTokenWithDoc('greg@example.com');

    // Doc copy untouched — still the seeded value, not the (signed-out) local token.
    expect((await getDriveConnectionByAccount('greg@example.com'))?.refreshToken).toBe('doc-tok');
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'auth-epoch-discard' })
    );
  });

  it('cross-account: a doc entry for another account is never used', async () => {
    await seedDoc('other@example.com', 'other-tok', 9999);
    localToken = null;

    await reconcileDriveTokenWithDoc('greg@example.com');

    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
  });

  it('no bound email → no-op', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    await reconcileDriveTokenWithDoc(undefined);
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
  });

  it('identical tokens → no-op, no CRDT churn (#4)', async () => {
    await seedDoc('greg@example.com', 'same-tok', 1000);
    localToken = { token: 'same-tok', issuedAt: 2000 };
    await reconcileDriveTokenWithDoc('greg@example.com');
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
  });

  it('null/null issuedAt tie with differing tokens → leaves the doc copy untouched (#2)', async () => {
    await seedDoc('greg@example.com', 'doc-tok', null);
    localToken = { token: 'local-tok', issuedAt: null };
    await reconcileDriveTokenWithDoc('greg@example.com');
    // Neither side strictly newer → no clobber in either direction.
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect((await getDriveConnectionByAccount('greg@example.com'))?.refreshToken).toBe('doc-tok');
  });
});

describe('tryReconnectSilently', () => {
  it('already valid → true without touching the doc', async () => {
    tokenValid = true;
    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(primeRefreshToken).not.toHaveBeenCalled();
  });

  it('doc token present + silent refresh succeeds → true, seeds local + in-memory', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    attemptSilentRefresh.mockResolvedValue('fresh-access');

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'doc-tok', { issuedAt: 2000 });
    expect(primeRefreshToken).toHaveBeenCalledWith('fam-1', { token: 'doc-tok', issuedAt: 2000 });
  });

  it('doc token present but silent refresh fails → false (caller forces consent)', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    attemptSilentRefresh.mockResolvedValue(null);
    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
  });

  it('no bound email → false, no silent attempt (B5 no-regression on the iPhone path)', async () => {
    expect(await tryReconnectSilently(undefined)).toBe(false);
    expect(attemptSilentRefresh).not.toHaveBeenCalled();
  });

  it('no doc token for the bound account → false', async () => {
    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(attemptSilentRefresh).not.toHaveBeenCalled();
  });

  it('valid local token succeeds → true WITHOUT adopting the doc copy (#1 no-clobber)', async () => {
    localToken = { token: 'good-local', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'STALE-doc', 1); // older/different doc token
    attemptSilentRefresh.mockResolvedValue('fresh-access');

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    // The good local token was used; the stale doc token was NEVER written to local.
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(attemptSilentRefresh).toHaveBeenCalledTimes(1);
  });

  it('local token fails, different doc token present → recovers from the doc copy', async () => {
    localToken = { token: 'dead-local', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    attemptSilentRefresh.mockResolvedValueOnce(null).mockResolvedValueOnce('fresh-access');

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'doc-tok', { issuedAt: 2000 });
    expect(primeRefreshToken).toHaveBeenCalledWith('fam-1', { token: 'doc-tok', issuedAt: 2000 });
    expect(attemptSilentRefresh).toHaveBeenCalledTimes(2);
  });

  it('local fails and the doc holds the SAME token → false, no pointless retry', async () => {
    localToken = { token: 'same-tok', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'same-tok', 1000);
    attemptSilentRefresh.mockResolvedValue(null);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    // Step 1 tried it once; step 2 short-circuits because the doc token is identical.
    expect(attemptSilentRefresh).toHaveBeenCalledTimes(1);
  });

  it('session-epoch advances mid-reconnect (sign-out) → does NOT adopt the doc token', async () => {
    localToken = { token: 'dead-local', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    // The first silent-refresh (local) fails AND simulates a sign-out by bumping
    // the session epoch — so when restoreLocalFromDoc checks, the snapshot is stale.
    attemptSilentRefresh.mockImplementation(async () => {
      mockSessionEpoch = 1;
      return null;
    });

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    // The doc token must NOT have been written to local IDB or primed in memory.
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'auth-epoch-discard' })
    );
  });
});

describe('tryReconnectSilently — step 3, healing from the REMOTE beanpod', () => {
  const REMOTE_ENTRY = {
    accountEmail: 'greg@example.com',
    refreshToken: 'remote-tok',
    issuedAt: 3000,
  };

  /** Local dead, our own doc copy dead too — the state step 3 exists for. */
  function bothLocalCopiesDead() {
    localToken = { token: 'local-tok', issuedAt: 1000 };
    attemptSilentRefresh.mockResolvedValue(null);
  }

  it('adopts a newer token from the remote pod when the pod is LATCHED', async () => {
    bothLocalCopiesDead();
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue([REMOTE_ENTRY]);
    // The adopt attempt is the one that succeeds.
    attemptSilentRefresh
      .mockResolvedValueOnce(null) // step 1, local
      .mockResolvedValueOnce('access-token'); // step 3, remote copy

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'remote-tok', {
      issuedAt: 3000,
    });
    expect(primeRefreshToken).toHaveBeenCalledWith('fam-1', {
      token: 'remote-tok',
      issuedAt: 3000,
    });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'healed-from-remote' } })
    );
  });

  it('does NOT read the remote pod on a MEMORY or CORRUPT latch', async () => {
    // ⚠️ THE LATCH IS NOT ONE THING. `isRemoteBlocked()` is true for every
    // blocker class, and two of them are states where a second full download plus
    // another whole-doc decrypt is exactly what must not happen: the device that
    // could not ALLOCATE the document, and bytes that cannot be decrypted at all.
    // The first is the Galaxy Tab case that started this investigation, and on a
    // device whose worker never spawned it would run on the main thread.
    bothLocalCopiesDead();
    remoteBlocked = new PayloadTooLargeError('too big', 'load', null);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(readRemoteDriveConnections).not.toHaveBeenCalled();
  });

  it('does NOT read the remote pod when the pod is not latched', async () => {
    // Everywhere else the ordinary merge is about to deliver the same document,
    // so a second full download would be pure waste.
    bothLocalCopiesDead();
    remoteBlocked = null;

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(readRemoteDriveConnections).not.toHaveBeenCalled();
  });

  it('a WHOLLY DEAD credential changes nothing, and says so once', async () => {
    // The honest limit of step 3: a device that cannot read Drive at all gets
    // today's behaviour. Without the event, an inert step 3 would be invisible.
    bothLocalCopiesDead();
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue(null);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'remote-read-unavailable' } })
    );
  });

  it('never re-tries a token this device has already proved dead', async () => {
    bothLocalCopiesDead();
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    // The remote mirrors the very token step 1 just failed on.
    readRemoteDriveConnections.mockResolvedValue([
      { accountEmail: 'greg@example.com', refreshToken: 'local-tok', issuedAt: 9000 },
    ]);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(attemptSilentRefresh).toHaveBeenCalledTimes(1); // step 1 only
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
  });

  it('PUTS THE LOCAL TOKEN BACK when a candidate is refused', async () => {
    // ⚠️ `restoreLocalFromDoc` WRITES BEFORE ANYTHING VALIDATES, so a candidate
    // that turns out to be dead has already displaced the local one — and on
    // `invalid_grant` the permanent branch then CLEARS the stored refresh token,
    // leaving the device with no credential at all. Two age-based guards were
    // tried here first and each was wrong in one direction, because age is not
    // the question: `issuedAt` is legitimately null on both sides. Rolling back
    // makes a failed attempt free, which is what the module header promises.
    localToken = { token: 'local-tok', issuedAt: 5000 };
    attemptSilentRefresh.mockResolvedValue(null);
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue([
      { accountEmail: 'greg@example.com', refreshToken: 'peer-tok', issuedAt: 1000 },
    ]);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);

    // The candidate went in, then the original came back — last write wins, and
    // the last write must be the token the device arrived with.
    const written = storeGoogleRefreshToken.mock.calls.map((c) => c[1]);
    expect(written).toContain('peer-tok');
    expect(written.at(-1)).toBe('local-tok');
    expect(primeRefreshToken.mock.calls.at(-1)?.[1]).toEqual({
      token: 'local-tok',
      issuedAt: 5000,
    });
  });

  it('tries an UNKNOWN-AGE peer token rather than refusing it unread', async () => {
    // `issuedAt: null` is a live shape — legacy entries predate the field — and
    // a "strictly newer" rule read it as 0, refusing genuinely-live peer tokens
    // on exactly the straggler devices this exists for.
    localToken = { token: 'local-tok', issuedAt: 5000 };
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue([
      { accountEmail: 'greg@example.com', refreshToken: 'peer-tok', issuedAt: null },
    ]);
    attemptSilentRefresh
      .mockResolvedValueOnce(null) // step 1, local
      .mockResolvedValueOnce('access-token'); // step 3, the peer copy works

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(storeGoogleRefreshToken).toHaveBeenCalledWith('fam-1', 'peer-tok', {
      issuedAt: null,
    });
  });

  it('never adopts a token belonging to a DIFFERENT Google account', async () => {
    // The per-account invariant holds on the remote read exactly as it does on
    // the local one — a device acting as B must never take A's credential.
    bothLocalCopiesDead();
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue([
      { accountEmail: 'someone-else@example.com', refreshToken: 'other-tok', issuedAt: 9000 },
    ]);

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
  });

  it('does not reach step 3 at all when there is no bound account', async () => {
    localToken = { token: 'local-tok', issuedAt: 1000 };
    attemptSilentRefresh.mockResolvedValue(null);
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');

    expect(await tryReconnectSilently(undefined)).toBe(false);
    expect(readRemoteDriveConnections).not.toHaveBeenCalled();
  });

  it('prefers our own doc copy — the remote read is a last resort, not a first', async () => {
    localToken = { token: 'local-tok', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    attemptSilentRefresh
      .mockResolvedValueOnce(null) // step 1
      .mockResolvedValueOnce('access-token'); // step 2 succeeds

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(readRemoteDriveConnections).not.toHaveBeenCalled();
  });
});

describe('tryReconnectSilently — a refresh onto the WRONG account is not a reconnect', () => {
  it('reports false when the live session is a different Google account', async () => {
    // ⚠️ THE ACCOUNT-MISMATCH LOOP. The reconnect prompt is also raised when the
    // session is signed in as B while the pod is bound to A — and B's grant is
    // usually perfectly live, so the silent refresh SUCCEEDS. Reporting that as
    // a reconnect cleared the banner and the next Drive call 404'd identically,
    // once per tap. No token can fix a binding; only signing in as A can.
    localToken = { token: 'local-tok', issuedAt: 1000 };
    attemptSilentRefresh.mockResolvedValue('access-token');
    mockLiveAccount = 'someone-else@example.com';

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
  });

  it('still reports true when the refreshed session IS the bound account', async () => {
    localToken = { token: 'local-tok', issuedAt: 1000 };
    attemptSilentRefresh.mockResolvedValue('access-token');
    mockLiveAccount = 'Greg@Example.com'; // case drift must not read as a mismatch

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
  });

  it('does not manufacture a mismatch when the live account is unknown', async () => {
    localToken = { token: 'local-tok', issuedAt: 1000 };
    attemptSilentRefresh.mockResolvedValue('access-token');
    mockLiveAccount = null;

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
  });
});
