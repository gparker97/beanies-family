/**
 * Drive refresh-token recovery (B) — the additive layer that mirrors the Google
 * Drive refresh token into the encrypted `.beanpod` (per Google account) and
 * uses it to self-heal a lost local token + smooth reconnects.
 *
 * Design invariants (do not break — this guards a live auth flow):
 *  - PURELY ADDITIVE. The local IndexedDB store (`fileHandleStore`) remains the
 *    PRIMARY token home. Every function here is best-effort and, on ANY failure,
 *    falls through to today's exact behavior (forced consent / existing flow).
 *  - PER-ACCOUNT. A device only ever reads/uses the doc entry whose account
 *    matches the bound Google account (`matchesBoundAccount`). A token for
 *    account A is never used by a device acting as account B.
 *  - This module depends ONLY on `googleAuth`'s public surface (it never reaches
 *    into its private state) + `driveRepository` + `isDocLoaded`. `googleAuth`
 *    itself imports nothing from here and gains no recovery logic.
 *
 * See docs/plans/2026-06-12-drive-connectivity-robustness.md.
 */

import {
  onTokenAcquired,
  primeRefreshToken,
  attemptSilentRefresh,
  isTokenValid,
  getSessionEpoch,
} from './googleAuth';
import { logEvent } from '@/services/telemetry';
import {
  getGoogleRefreshToken,
  storeGoogleRefreshToken,
  type StoredRefreshToken,
} from '@/services/sync/fileHandleStore';
import {
  getDriveConnectionByAccount,
  upsertDriveConnection,
  removeDriveConnectionByAccount,
} from '@/services/automerge/repositories/driveRepository';
import { isDocLoaded } from '@/services/automerge/docService';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { reportError } from '@/utils/errorReporter';

/**
 * The one correctness guard, kept PURE (no I/O, no store access) so it is
 * exhaustively unit-testable. Returns false unless both emails normalize to the
 * SAME non-empty value — so an unbound device can never read an unbound (`''`)
 * doc entry via `'' === ''`.
 */
export function matchesBoundAccount(
  entryEmail: string | null | undefined,
  boundEmail: string | null | undefined
): boolean {
  const a = (entryEmail ?? '').trim().toLowerCase();
  const b = (boundEmail ?? '').trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}

/** Is `a` strictly newer than `b`? A null `issuedAt` is treated as oldest. */
function isStrictlyNewer(a: StoredRefreshToken | null, b: StoredRefreshToken | null): boolean {
  if (!a) return false;
  if (!b) return true;
  return (a.issuedAt ?? 0) > (b.issuedAt ?? 0);
}

/**
 * The single doc-read primitive (used by reconcile + reconnect). Reads the
 * `driveConnections` entry for the bound account and returns it in the local
 * store's `{ token, issuedAt }` shape — or null if the doc isn't loaded, the
 * account isn't bound, no entry exists, or the account-match guard rejects it.
 * Never throws.
 */
export async function readDriveTokenFromDoc(
  boundEmail: string | null | undefined
): Promise<StoredRefreshToken | null> {
  try {
    if (!boundEmail || !isDocLoaded()) return null;
    const entry = await getDriveConnectionByAccount(boundEmail);
    if (!entry || !entry.refreshToken) return null;
    if (!matchesBoundAccount(entry.accountEmail, boundEmail)) return null;
    return { token: entry.refreshToken, issuedAt: entry.issuedAt };
  } catch (error) {
    reportError({
      surface: 'drive-token-doc-read',
      severity: 'warning',
      message: 'Failed to read Drive refresh token from the beanpod (recovery skipped)',
      error,
    });
    return null;
  }
}

/**
 * B2 — best-effort mirror of the just-acquired refresh token into the doc, keyed
 * by account. Registered as an `onTokenAcquired` subscriber (see
 * `registerDriveTokenMirror`). A DUMB mirror: it persists whatever the local
 * store holds; precedence/newer-wins lives ONLY in `reconcileDriveTokenWithDoc`.
 * Gated on `interactive` because silent refreshes don't rotate the refresh token
 * (re-mirroring them would churn the CRDT every ~hour for no value).
 */
async function mirrorRefreshTokenToDoc(email: string | null, interactive: boolean): Promise<void> {
  try {
    if (!interactive || !email) return;
    if (!isDocLoaded()) return; // local write already succeeded; syncs next acquisition
    const familyId = getActiveFamilyId();
    if (!familyId) return;
    const stored = await getGoogleRefreshToken(familyId);
    if (!stored?.token) return;
    await upsertDriveConnection({
      provider: 'google',
      accountEmail: email,
      refreshToken: stored.token,
      issuedAt: stored.issuedAt,
    });
  } catch (error) {
    reportError({
      surface: 'drive-token-doc-mirror',
      severity: 'warning',
      message: 'Failed to mirror Drive refresh token into the beanpod (local copy unaffected)',
      error,
    });
  }
}

let mirrorRegistered = false;

/**
 * Register the B2 mirror once. Idempotent. Returns the unsubscribe (mainly for
 * tests). Call from app/sync startup.
 */
export function registerDriveTokenMirror(): () => void {
  if (mirrorRegistered) return () => {};
  mirrorRegistered = true;
  return onTokenAcquired((email, _token, interactive) => {
    void mirrorRefreshTokenToDoc(email, interactive);
  });
}

/** Test-only: reset the one-shot registration guard. */
export function __resetMirrorRegistrationForTesting(): void {
  mirrorRegistered = false;
}

/**
 * Restore the local primary copy from a doc token + prime in-memory so the next
 * silent refresh uses it. The single "adopt the doc token" step, shared by B3
 * and B5 so the persist/prime ordering can never drift between the two paths.
 *
 * Session-epoch guard: the caller captures `getSessionEpoch()` BEFORE its async
 * doc read and passes it here. If a sign-out advanced the epoch in between, skip
 * BOTH the local IDB store AND the in-memory prime — otherwise a token for a
 * torn-down session would be written to disk (a cold-start zombie) as well as
 * memory. See docs/plans/2026-06-14-session-epoch-guard-google-token.md.
 */
async function restoreLocalFromDoc(
  familyId: string,
  docTok: StoredRefreshToken,
  expectedEpoch: number
): Promise<void> {
  if (expectedEpoch !== getSessionEpoch()) {
    logEvent({
      level: 'info',
      surface: 'auth-epoch-discard',
      message:
        'skipped adopting the beanpod Drive token — signed out during recovery (epoch advanced)',
    });
    return;
  }
  await storeGoogleRefreshToken(familyId, docTok.token, { issuedAt: docTok.issuedAt });
  primeRefreshToken(familyId, docTok);
}

/**
 * B3 — cold-start reconciliation. Keeps the doc copy and the local copy in sync
 * for the bound account, **strictly-newer-`issuedAt` wins** (a tie is a no-op):
 *  - identical tokens → nothing to do (no CRDT churn).
 *  - doc strictly newer / local missing → restore local + prime (the recovery).
 *  - local strictly newer / doc missing → mirror local → doc.
 *  - tokens differ but neither is strictly newer (e.g. both `issuedAt: null`) →
 *    leave the shared doc copy UNTOUCHED — an unknown-age local must not clobber
 *    it; a later fresh acquisition (real timestamp) breaks the tie.
 * Call AFTER the stores are loaded (so `boundEmail` is resolvable). If the
 * account isn't bound yet, the doc mirror on the next acquisition is the backstop.
 * Never throws.
 */
export async function reconcileDriveTokenWithDoc(
  boundEmail: string | null | undefined
): Promise<void> {
  try {
    if (!boundEmail || !isDocLoaded()) return;
    const familyId = getActiveFamilyId();
    if (!familyId) return;

    // Snapshot before the async reads so a sign-out mid-read skips the adopt.
    const epochAtStart = getSessionEpoch();

    const [docTok, localTok] = await Promise.all([
      readDriveTokenFromDoc(boundEmail),
      getGoogleRefreshToken(familyId),
    ]);

    // Steady state — same token on both sides → no write, no churn.
    if (docTok && localTok && docTok.token === localTok.token) return;

    if (docTok && (!localTok || isStrictlyNewer(docTok, localTok))) {
      await restoreLocalFromDoc(familyId, docTok, epochAtStart);
    } else if (localTok && (!docTok || isStrictlyNewer(localTok, docTok))) {
      await upsertDriveConnection({
        provider: 'google',
        accountEmail: boundEmail,
        refreshToken: localTok.token,
        issuedAt: localTok.issuedAt,
      });
    }
    // else: both present, tokens differ, neither strictly newer → ambiguous tie;
    // leave the doc copy untouched (do not destroy a possibly-good shared token).
  } catch (error) {
    reportError({
      surface: 'drive-token-reconcile',
      severity: 'warning',
      message: 'Drive refresh-token reconcile failed (falling back to existing behavior)',
      error,
    });
  }
}

/**
 * B5 — try to restore the Drive connection silently BEFORE a caller falls back to
 * a forced-consent screen. Returns true only if the connection is now live.
 *
 * Crucially, this NEVER clobbers a good local token: it tries the **existing
 * local credential first** (`attemptSilentRefresh` self-recovers it from the
 * store), and only adopts the beanpod copy if local is absent or just failed —
 * so a stale/revoked doc token can't overwrite-then-destroy a working local one.
 * On false (no usable token, unbound, any error) the caller proceeds with its
 * unchanged forced-consent flow. Never throws.
 */
export async function tryReconnectSilently(
  boundEmail: string | null | undefined
): Promise<boolean> {
  try {
    if (isTokenValid()) return true; // already connected
    const familyId = getActiveFamilyId();
    if (!familyId) return false;

    // Snapshot before any async read so a sign-out mid-reconnect skips the adopt.
    const epochAtStart = getSessionEpoch();

    // 1. Try the EXISTING local token first. attemptSilentRefresh recovers it
    //    from the store when in-memory is empty; this path never overwrites a
    //    good local credential with the doc copy.
    const local = await getGoogleRefreshToken(familyId);
    if (local?.token) {
      if ((await attemptSilentRefresh()) !== null) return true;
      // Local failed (revoked/exhausted). attemptSilentRefresh already cleared
      // it on invalid_grant; fall through to the beanpod copy as recovery.
    }

    // 2. Local missing or just failed → recover from the account-matched doc copy.
    if (!boundEmail) return false;
    const docTok = await readDriveTokenFromDoc(boundEmail);
    if (!docTok?.token) return false;
    if (local?.token === docTok.token) return false; // same token already failed
    await restoreLocalFromDoc(familyId, docTok, epochAtStart);
    return (await attemptSilentRefresh()) !== null;
  } catch (error) {
    reportError({
      surface: 'drive-token-silent-reconnect',
      severity: 'warning',
      message: 'Silent Drive reconnect failed (falling back to forced consent)',
      error,
    });
    return false;
  }
}

/**
 * B6 — clear the doc copy for an account. Call ONLY from the DELIBERATE
 * disconnect/sign-out callers — never from the shared `clearGoogleSessionState`
 * chokepoint or a transient `invalid_grant`, which would delete a still-valid
 * shared token (mirrors the calendar "park, don't delete" rule). Never throws.
 */
export async function clearDriveConnectionForAccount(
  boundEmail: string | null | undefined
): Promise<void> {
  try {
    if (!boundEmail || !isDocLoaded()) return;
    await removeDriveConnectionByAccount(boundEmail);
  } catch (error) {
    reportError({
      surface: 'drive-token-doc-clear',
      severity: 'warning',
      message: 'Failed to clear Drive refresh token from the beanpod',
      error,
    });
  }
}
