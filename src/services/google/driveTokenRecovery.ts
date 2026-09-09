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
 *    ONE EXCEPTION, 2026-09-09: `tryReconnectSilently`'s third strategy reads the
 *    REMOTE document for a newer token, which needs `syncService`. It is a
 *    DYNAMIC import inside that closure, so the dependency exists only on the
 *    one path that takes it and never at module load. Keep it that way: a
 *    module-scope import would put the whole sync engine in the graph of token
 *    recovery, which is the direction this invariant exists to prevent.
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
 * Mirror a local refresh token UP into the shared doc — the symmetric counterpart
 * to `restoreLocalFromDoc`, so the epoch-guard/ordering can never drift between the
 * two directions. The caller captures `getSessionEpoch()` BEFORE its async read and
 * passes it here; if a sign-out advanced the epoch in between, skip the write so a
 * torn-down session's token is never propagated into the synced beanpod (and thence
 * to every device). Never throws on the guard path. See
 * docs/plans/2026-06-14-code-review-fixes.md.
 */
async function mirrorLocalToDoc(
  boundEmail: string,
  localTok: StoredRefreshToken,
  expectedEpoch: number
): Promise<void> {
  if (expectedEpoch !== getSessionEpoch()) {
    logEvent({
      level: 'info',
      surface: 'auth-epoch-discard',
      message:
        'skipped mirroring the local Drive token into the beanpod — signed out during recovery (epoch advanced)',
    });
    return;
  }
  await upsertDriveConnection({
    provider: 'google',
    accountEmail: boundEmail,
    refreshToken: localTok.token,
    issuedAt: localTok.issuedAt,
  });
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
      // Epoch-guarded, symmetric with the adopt branch above: a sign-out mid-read
      // must not propagate the torn-down session's token into the shared doc.
      await mirrorLocalToDoc(boundEmail, localTok, epochAtStart);
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
 * Prepare for a ONE-SHOT Drive write retry after a transient post-redirect token
 * failure (a freshly-returned access token momentarily rejected because WebKit
 * bounce-tracking cleared the refresh cookie across the cross-origin redirect).
 * Silently re-acquires a token and returns true iff a valid one is now in hand —
 * the caller should then retry its write exactly once. Never throws.
 *
 * Shared by the two setup writes that hit this same failure class: the initial
 * pod write (`ResumePodSetup.finalizePod`) and the end-of-wizard member-sync save
 * (`SetupProgressModal`), so both recover identically (DRY).
 */
export async function reconnectForWriteRetry(email?: string | null): Promise<boolean> {
  let recovered = false;
  try {
    recovered = await tryReconnectSilently(email);
  } catch (e) {
    reportError({
      surface: 'driveTokenRecovery.writeRetry',
      severity: 'warning',
      message: `silent reconnect before a write retry threw: ${e instanceof Error ? e.message : String(e)}`,
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
  return recovered && isTokenValid();
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
    // ⚠️ THIS LINE TRUSTS A LOCAL CLOCK, and that is only safe because the two
    // places that LEARN the grant is bad now clear the cached token themselves:
    // `driveService.driveRequest` on a 401, and `googleDriveProvider` on an
    // account mismatch. Without those, a grant revoked on another device still
    // reads valid here until its own expiry, this returns true without
    // contacting Google, and the caller reports a reconnect that never happened.
    //
    // Do NOT "fix" that by forcing the ladder from here or from a caller: it was
    // tried twice, and both times it destroyed working credentials and drove the
    // escalation counter to its threshold before the consent screen could open.
    if (isTokenValid()) return true; // already connected
    const familyId = getActiveFamilyId();
    if (!familyId) return false;

    // Snapshot before any async read so a sign-out mid-reconnect skips the adopt.
    const epochAtStart = getSessionEpoch();

    // Read once, shared by all three strategies: each must know which tokens
    // this device has ALREADY proved dead, or it re-tries the same string and
    // reports a failure as a different one.
    const local = await getGoogleRefreshToken(familyId);
    const tried = new Set<string>();

    /**
     * Adopt a candidate token and see whether Google accepts it.
     *
     * ⚠️ REFUSES AN OLDER COPY. `restoreLocalFromDoc` writes to IndexedDB and
     * primes memory BEFORE anything validates the candidate, so without this an
     * older mirrored token overwrites a newer local one — and if Google then
     * answers `invalid_grant`, the permanent branch CLEARS the refresh token and
     * the device ends its "recovery" with no credential at all. The module header
     * promises this never clobbers a good local token; `reconcileDriveTokenWithDoc`
     * exists for the same reason and already uses `isStrictlyNewer`.
     *
     * The local token is re-read rather than closed over: step 3 can spend
     * seconds on a multi-MB download, and a redirect return or the wake listener
     * may have installed a fresher credential in that window.
     */
    const adopt = async (tok: StoredRefreshToken): Promise<boolean> => {
      const current = await getGoogleRefreshToken(familyId);
      // ⚠️ REFUSE ONLY WHAT IS PROVABLY OLDER. The first cut used
      // `!isStrictlyNewer(tok, current)`, which coalesces a null `issuedAt` to 0
      // — and `issuedAt: number | null` is a documented live shape on BOTH sides
      // (legacy entries predate the field). So a peer's genuinely-live mirrored
      // token carrying `issuedAt: null` computed `0 > T` = false and was refused
      // WITHOUT ever asking Google, on exactly the straggler devices strategies 2
      // and 3 exist for, pushing them to the consent screen this module exists to
      // avoid. Unknown age is not evidence of staleness: let Google decide.
      const provablyOlder =
        typeof tok.issuedAt === 'number' &&
        typeof current?.issuedAt === 'number' &&
        tok.issuedAt < current.issuedAt;
      if (current?.token && current.token !== tok.token && provablyOlder) {
        logEvent({
          level: 'info',
          surface: 'drive-token-silent-reconnect',
          message: 'declined an older mirrored Drive token',
          context: { action: 'older-token-declined' },
        });
        return false;
      }
      await restoreLocalFromDoc(familyId, tok, epochAtStart);
      return (await attemptSilentRefresh()) !== null;
    };

    // 1. The EXISTING local token. `attemptSilentRefresh` recovers it from the
    //    store when in-memory is empty, so this never overwrites a good local
    //    credential with a copy from anywhere else.
    const fromLocalToken = async (): Promise<boolean> => {
      if (!local?.token) return false;
      tried.add(local.token);
      return (await attemptSilentRefresh()) !== null;
      // A failure here means revoked/exhausted; `attemptSilentRefresh` has
      // already cleared it on invalid_grant. Fall through to the copies.
    };

    // 2. The account-matched copy in OUR OWN document.
    const fromDocCopy = async (account: string): Promise<boolean> => {
      const docTok = await readDriveTokenFromDoc(account);
      if (!docTok?.token || tried.has(docTok.token)) return false;
      tried.add(docTok.token);
      return adopt(docTok);
    };

    // 3. The account-matched copy in the REMOTE document, for the one device
    //    state the two strategies above cannot serve.
    //
    //    WHAT IT FIXES. A pod whose lineage this device refuses to merge (the
    //    state a compaction leaves a straggler in) LATCHES for the session. Our
    //    own document is therefore frozen at whatever it held before the latch,
    //    so strategy 2 keeps re-reading a copy that may predate the token every
    //    other device in the family has already rotated to. The newer token is
    //    sitting in the remote file, readable, and the only route to it used to
    //    be a consent screen — the storm this work exists to stop.
    //
    //    ⚠️ ITS REACHABLE WINDOW IS NARROW, AND SAYING SO PRECISELY MATTERS —
    //    it is easy to expect far more of this than it gives. Reading the remote
    //    file needs a working Drive credential, and steps 1 and 2 have just
    //    failed to refresh one. So the ONLY state this can serve is: the cached
    //    ACCESS token is still live (it has up to an hour), every refresh token
    //    this device can reach is dead, and the pod is lineage-blocked. Outside
    //    that window the fetch fails, this returns false, and behaviour is
    //    exactly today's.
    //
    //    Two things widen it slightly and deliberately: `reconnect()` passes
    //    `assumeStale`, so the clock short-circuit no longer hides a live access
    //    token from steps 1-3; and a peer that rotated recently is exactly the
    //    case where the remote mirror holds something this device has not tried.
    //
    //    `remote-read-unavailable` versus `healed-from-remote` measures the
    //    split, so an inert step 3 shows up as a number rather than being
    //    rediscovered months later and argued about from memory.
    //
    //    Dynamic import, deliberately: this module's header states that it
    //    depends only on `googleAuth`'s public surface, `driveRepository` and
    //    `isDocLoaded`. A module-scope `syncService` import would widen that at
    //    load time and put the sync engine in the dependency graph of token
    //    recovery, which is the direction the header exists to prevent.
    const fromRemoteDocCopy = async (account: string): Promise<boolean> => {
      const syncService = await import('@/services/sync/syncService');

      // ⚠️ THE LINEAGE CLASS ONLY, not any blocker. `isRemoteBlocked()` is true
      // for every latch, including the two this must never act on:
      //
      //   - `PayloadTooLargeError` — the device could not ALLOCATE the document.
      //     The latch exists precisely to stop re-downloading megabytes to fail
      //     the same way, and `readDriveConnections` is a whole-doc decrypt, the
      //     identical allocation that just failed. On a device whose worker never
      //     spawned it runs on the MAIN thread.
      //   - `CorruptPayloadError` — the bytes cannot be decrypted, so this is
      //     guaranteed to fail while burning a multi-MB download per attempt.
      //
      // The target is the device that can READ the file but must not MERGE it,
      // and that is exactly one class.
      // ⚠️ BY NAME, NOT `instanceof`, and the class list is the point. The states
      // to EXCLUDE are the ones where re-reading is itself the harm: a device
      // that could not ALLOCATE the document (re-downloading megabytes to fail
      // the same way is what the latch prevents, and this decrypt is the same
      // allocation) and bytes that cannot be decrypted at all.
      //
      // `RemoteMergeError` belongs IN, not out: it means the remote was read and
      // then could not be merged, which is this step's target state verbatim. An
      // earlier cut used `instanceof PodLineageError` and silently excluded it —
      // and `types/sync.ts` records that exact trap, plus the rule: prefer a
      // duck-typed test to `instanceof` anywhere the question is "should this
      // latch". By name also keeps the class out of this module's import graph,
      // which its header guards.
      const blockerName = (syncService.isRemoteBlocked() as { name?: string } | null)?.name;
      if (blockerName !== 'PodLineageError' && blockerName !== 'RemoteMergeError') return false;

      const connections = await syncService.readRemoteDriveConnections();
      if (!connections) {
        logEvent({
          level: 'info',
          surface: 'drive-token-silent-reconnect',
          message: 'could not read the remote beanpod for a newer Drive token',
          context: { action: 'remote-read-unavailable' },
        });
        return false;
      }

      const entry = connections.find((c) => matchesBoundAccount(c.accountEmail, account));
      if (!entry?.refreshToken || tried.has(entry.refreshToken)) return false;
      tried.add(entry.refreshToken);

      const healed = await adopt({ token: entry.refreshToken, issuedAt: entry.issuedAt });
      if (healed) {
        logEvent({
          level: 'info',
          surface: 'drive-token-silent-reconnect',
          message: 'healed the Drive connection from the remote beanpod',
          context: { action: 'healed-from-remote' },
        });
      }
      return healed;
    };

    // One set of returns. Each strategy answers only "did I connect", so a new
    // one is a line here rather than an early return threaded past the others —
    // which is how step 3 came to be reachable from just one of step 2's three
    // exits in the first draft.
    if (await fromLocalToken()) return true;

    // THE PER-ACCOUNT INVARIANT, and it gates both copy strategies rather than
    // sitting inside one of them. Without a bound account there is nothing to
    // match a stored entry against, and adopting an unmatched one would hand
    // account A's token to a device acting as B. Strategy 1 above needs no
    // match — it is this device's own credential.
    if (!boundEmail) return false;

    if (await fromDocCopy(boundEmail)) return true;
    return await fromRemoteDocCopy(boundEmail);
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
