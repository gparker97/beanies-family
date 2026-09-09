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
// ⚠️ A FAITHFUL DOUBLE, and the faithfulness is the whole point of these tests.
// The real `tryCandidateRefreshToken` mutates NOTHING on 'rejected' and
// 'transient' — no IndexedDB write, no prime, no counter. A double that quietly
// wrote the candidate anyway would hide exactly the bug this work fixes, which is
// the fourth unfaithful-mock shape `docs/lessons.md` records. So this default
// never touches `localToken`; only the 'accepted' arm installs, mirroring the
// real commit path.
const tryCandidateRefreshToken =
  vi.fn<() => Promise<{ outcome: 'accepted' | 'rejected' | 'transient'; errorCode?: string }>>();
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
  tryCandidateRefreshToken: (...a: unknown[]) => tryCandidateRefreshToken(...(a as [])),
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
  tryCandidateRefreshToken.mockReset();
  // Default: Google refuses. The safe default for these tests — an accidental
  // `undefined` return would otherwise read as a falsy non-'accepted' outcome and
  // silently take the same branch, hiding a wiring mistake.
  tryCandidateRefreshToken.mockResolvedValue({ outcome: 'rejected', errorCode: 'invalid_grant' });
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
  // ⚠️ INVERTED 2026-09-09, and the inversion IS the fix. This used to assert that
  // a strictly-newer doc token replaces the local one. Reconcile did that without
  // asking Google anything, so a mirrored token that was newer BUT DEAD silently
  // destroyed a working credential — and because the mirror is shared, it did so
  // on every device in the family, costing each one a consent screen. A device
  // that holds a token now keeps it; the heal moved to `tryReconnectSilently`,
  // which validates first.
  it('doc newer than a PRESENT local token → adopts nothing and asks Google nothing', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    localToken = { token: 'local-tok', issuedAt: 1000 };

    await reconcileDriveTokenWithDoc('greg@example.com');

    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(tryCandidateRefreshToken).not.toHaveBeenCalled();
    // The doc copy is left alone too — it may be the good one for another device.
    expect((await getDriveConnectionByAccount('greg@example.com'))?.refreshToken).toBe('doc-tok');
  });

  // The ONLY surviving adopt branch in reconcile, and it was previously untested:
  // the existing cross-account case has `localToken = null` but a non-matching doc
  // entry, so it proved nothing about the adopt itself.
  it('no local token at all → adopts the doc copy (blind, as before — nothing to lose)', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    localToken = null;

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

  it('doc token present + Google ACCEPTS it → true; googleAuth owns the install', async () => {
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'accepted' });

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    // This module no longer persists or primes on the accept path — the candidate
    // is handed to googleAuth, which commits it only after Google says yes.
    expect(tryCandidateRefreshToken).toHaveBeenCalledWith(
      'fam-1',
      {
        token: 'doc-tok',
        issuedAt: 2000,
      },
      expect.any(Number)
    );
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ context: { action: 'candidate-accepted' } })
    );
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
    attemptSilentRefresh.mockResolvedValue(null); // step 1: the local token is dead
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'accepted' });

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(tryCandidateRefreshToken).toHaveBeenCalledWith(
      'fam-1',
      {
        token: 'doc-tok',
        issuedAt: 2000,
      },
      expect.any(Number)
    );
    // Step 1 laddered once; the accept path does NOT ladder again (the probe
    // already got a live token), so this stays at one.
    expect(attemptSilentRefresh).toHaveBeenCalledTimes(1);
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
    attemptSilentRefresh.mockResolvedValue(null); // step 1, local: dead
    // No doc entry is seeded here, so step 2 never probes: the single probe call
    // IS the remote copy, and Google accepts it.
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'accepted' });

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(tryCandidateRefreshToken).toHaveBeenLastCalledWith(
      'fam-1',
      {
        token: 'remote-tok',
        issuedAt: 3000,
      },
      expect.any(Number)
    );
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

  it('does not overwrite a local token with a mirrored one GOOGLE REFUSES', async () => {
    // ⚠️ THE GUARD THAT REPLACED THREE FAILED ONES. It used to be an age
    // comparison — "strictly newer", then "provably older", then a rollback — and
    // each traded one failure mode for another, because age was never the
    // question: `issuedAt: null` is a live shape on both sides, so an unknown-age
    // candidate could still displace a good local token, and the following
    // `invalid_grant` then CLEARED the store, leaving the device with nothing and
    // forcing a consent screen it did not need.
    //
    // Now Google decides, and a refused candidate costs nothing.
    localToken = { token: 'local-tok', issuedAt: 5000 };
    attemptSilentRefresh.mockResolvedValue(null);
    remoteBlocked = new PodLineageError('adopt-remote', 'lineage mismatch');
    readRemoteDriveConnections.mockResolvedValue([
      { accountEmail: 'greg@example.com', refreshToken: 'refused-tok', issuedAt: 1000 },
    ]);
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'rejected' });

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);
    // The local credential is untouched: not overwritten, not primed, not cleared.
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
    expect(localToken).toEqual({ token: 'local-tok', issuedAt: 5000 });
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        context: { action: 'candidate-refused', error_code: 'invalid_grant' },
      })
    );
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
    attemptSilentRefresh.mockResolvedValue(null); // step 1, local: dead
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'accepted' }); // the peer copy works

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    // The unknown-age candidate is PROBED, not refused unread — that is the point.
    expect(tryCandidateRefreshToken).toHaveBeenCalledWith(
      'fam-1',
      {
        token: 'peer-tok',
        issuedAt: null,
      },
      expect.any(Number)
    );
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
    attemptSilentRefresh.mockResolvedValue(null); // step 1: dead
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'accepted' }); // step 2 succeeds

    expect(await tryReconnectSilently('greg@example.com')).toBe(true);
    expect(readRemoteDriveConnections).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE REGRESSION TESTS FOR THE RE-CONSENT STORM.
//
// These two reproduce, against the real code, the defect that manufactured
// Google consent screens across a whole family. Both FAILED before the fix.
//
// ⚠️ THE DOUBLES HERE ARE FAITHFUL ON PURPOSE, and that is the only reason these
// tests can see the bug. `attemptSilentRefresh` CLEARS the stored token on
// `invalid_grant` (the real permanent branch does exactly that) and leaves it
// alone on a transient failure; `storeGoogleRefreshToken` writes through into the
// same `localToken` the reader returns. A convenient double that merely returned
// null would have shown a passing test over a destroyed credential — the shape
// `docs/lessons.md` records four times over.
// ─────────────────────────────────────────────────────────────────────────────
describe('re-consent storm — a mirrored token must never destroy a working one', () => {
  /** Write-through, so the test observes what the device would actually hold. */
  function persistWritesThrough() {
    storeGoogleRefreshToken.mockImplementation(async (_fam, token, opts) => {
      localToken = {
        token: token as string,
        issuedAt: (opts as { issuedAt: number | null }).issuedAt,
      };
    });
  }

  it('tryReconnectSilently: a REFUSED doc token leaves the good local one intact', async () => {
    // The device holds a good local token of known age; the shared beanpod holds a
    // dead one of UNKNOWN age (a legacy mirrored entry — `issuedAt: null` is a live
    // shape). Before the fix the age heuristic could not refuse the unknown-age
    // candidate, so it was written to IndexedDB and primed BEFORE validation, and
    // the resulting `invalid_grant` then cleared the store: the device ended the
    // "recovery" with no credential at all and was shown a consent screen.
    localToken = { token: 'good-local', issuedAt: 5000 };
    await seedDoc('greg@example.com', 'dead-doc', null);
    persistWritesThrough();
    // Step 1 fails TRANSIENTLY (a network blip) — the real code leaves the store
    // alone here, which is what makes the local token still worth protecting.
    attemptSilentRefresh.mockResolvedValue(null);
    tryCandidateRefreshToken.mockResolvedValue({ outcome: 'rejected' });

    expect(await tryReconnectSilently('greg@example.com')).toBe(false);

    // THE ASSERTION THIS FILE EXISTS FOR: the good credential survived.
    expect(localToken).toEqual({ token: 'good-local', issuedAt: 5000 });
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    expect(primeRefreshToken).not.toHaveBeenCalled();
  });

  it('reconcile: a newer-but-dead doc token never displaces a live local one', async () => {
    // The cold-start path, and the worse of the two: reconcile used to overwrite
    // local with a strictly-newer doc copy while asking Google NOTHING AT ALL, so
    // the destruction was one step removed rather than absent — the next refresh's
    // `invalid_grant` cleared the store. It now adopts only when there is nothing
    // to lose, which needs no network call.
    localToken = { token: 'good-local', issuedAt: 1000 };
    await seedDoc('greg@example.com', 'dead-doc', 2000); // strictly newer
    persistWritesThrough();

    await reconcileDriveTokenWithDoc('greg@example.com');

    expect(localToken).toEqual({ token: 'good-local', issuedAt: 1000 });
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
    // And it stays off the cold-start critical path: zero OAuth exchanges.
    expect(tryCandidateRefreshToken).not.toHaveBeenCalled();
  });

  it('a token minted DURING the probe is not overwritten by the blind adopt', async () => {
    // ⚠️ THE STALE-SNAPSHOT RACE. `adoptDocToken` reads the local token before the
    // probe, and the probe can burn a 15s fetch timeout. If it decided the
    // blind-adopt arm from that stale read, an interactive reconnect that minted
    // and committed a token in the meantime would be overwritten by the
    // unvalidated doc copy — the exact harm this function exists to prevent,
    // through a narrower window. The epoch guard does NOT cover it: no sign-out
    // happened, so the epoch never advances.
    localToken = null; // nothing to lose, at the moment the probe starts
    await seedDoc('greg@example.com', 'doc-tok', 2000);
    persistWritesThrough();
    attemptSilentRefresh.mockResolvedValue(null);
    tryCandidateRefreshToken.mockImplementation(async () => {
      // A reconnect completes mid-probe and commits a fresh credential.
      localToken = { token: 'freshly-minted', issuedAt: 9999 };
      return { outcome: 'transient' };
    });

    await tryReconnectSilently('greg@example.com');

    expect(localToken).toEqual({ token: 'freshly-minted', issuedAt: 9999 });
    expect(storeGoogleRefreshToken).not.toHaveBeenCalled();
  });
});
