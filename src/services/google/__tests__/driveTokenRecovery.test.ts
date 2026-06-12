// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDoc, resetDoc } from '@/services/automerge/docService';
import {
  upsertDriveConnection,
  getDriveConnectionByAccount,
} from '@/services/automerge/repositories/driveRepository';
import type { StoredRefreshToken } from '@/services/sync/fileHandleStore';

// ── Mock the heavy auth deps; use the REAL docService + driveRepository ────────
const primeRefreshToken = vi.fn();
const attemptSilentRefresh = vi.fn<() => Promise<string | null>>();
let tokenValid = false;
vi.mock('@/services/google/googleAuth', () => ({
  onTokenAcquired: () => () => {},
  primeRefreshToken: (...a: unknown[]) => primeRefreshToken(...a),
  attemptSilentRefresh: () => attemptSilentRefresh(),
  isTokenValid: () => tokenValid,
}));

const storeGoogleRefreshToken = vi
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
let localToken: StoredRefreshToken | null = null;
vi.mock('@/services/sync/fileHandleStore', () => ({
  getGoogleRefreshToken: () => Promise.resolve(localToken),
  storeGoogleRefreshToken: (...a: unknown[]) => storeGoogleRefreshToken(...a),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: () => 'fam-1',
}));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  matchesBoundAccount,
  readDriveTokenFromDoc,
  reconcileDriveTokenWithDoc,
  tryReconnectSilently,
} from '@/services/google/driveTokenRecovery';

beforeEach(() => {
  resetDoc();
  initDoc();
  primeRefreshToken.mockClear();
  attemptSilentRefresh.mockReset();
  storeGoogleRefreshToken.mockClear();
  localToken = null;
  tokenValid = false;
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
});
