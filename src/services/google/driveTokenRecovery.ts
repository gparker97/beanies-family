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
  tryCandidateRefreshToken,
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
 * store holds. Precedence lives in the two READERS, and they now answer different
 * questions: `reconcileDriveTokenWithDoc` adopts only when this device has no
 * token at all, and `adoptDocToken` adopts only what Google has just accepted.
 * Neither READER compares ages any more.
 *
 * ⚠️ THE MIRROR-UP DIRECTION STILL DOES, and it is a known open item rather than
 * an oversight. `reconcileDriveTokenWithDoc`'s `mirrorLocalToDoc` branch takes a
 * strictly-newer LOCAL token and writes it over the shared doc entry WITHOUT
 * validating it, so a device holding a token Google has already killed (an
 * individual revoke, or FIFO eviction at the per-client cap) whose `issuedAt` is
 * newer can still overwrite the family's live shared copy. That hazard predates
 * this change and is unchanged by it; a consent on any device repairs the entry
 * via this mirror. Fixing it means probing on the write path too — a separate
 * decision, deliberately not bundled here. See
 * `docs/plans/2026-09-09-adopt-only-a-token-google-accepted.md` § follow-ups.
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
 * What the CALLER must do next — nothing more.
 *
 * The four telemetry `action` values live at the emit sites inside
 * `adoptDocToken`; they are the observability contract, and the return type is
 * not the place to re-encode them. No caller needs to tell "Google refused" from
 * "we kept the local one" apart: both mean the connection is not live and there
 * is nothing further to try here.
 */
type AdoptOutcome =
  /** Google accepted the candidate. It is installed and the connection is LIVE. */
  | 'accepted'
  /** Persisted WITHOUT validation, because there was no local token to lose. Not live. */
  | 'unverified-adopted'
  /** Nothing was written. The local credential, if any, is untouched. */
  | 'not-adopted';

/**
 * The one shared, VALIDATED "adopt the doc token" step.
 *
 * ⚠️ THE WHOLE POINT IS THAT IT ASKS GOOGLE FIRST. Adopting a mirrored token
 * before validating it is what destroyed working credentials across a whole
 * family (see `tryCandidateRefreshToken`). A candidate Google refuses now leaves
 * the local credential exactly where it was.
 *
 * Three epoch guards exist on this path and they are NOT redundant — do not
 * "de-duplicate" them, they guard three different instants:
 *   1. the fast path below (a sign-out that already happened — skip the exchange),
 *   2. `commitAcquiredToken`'s pre-commit + post-persist checks (accept arm),
 *   3. `restoreLocalFromDoc`'s check, re-evaluated AT WRITE TIME (blind arm).
 */
async function adoptDocToken(
  familyId: string,
  docTok: StoredRefreshToken,
  expectedEpoch: number
): Promise<AdoptOutcome> {
  // Fast path only. It also carries the `auth-epoch-discard` event, because after
  // this change the probe short-circuits before `restoreLocalFromDoc` is reached,
  // and that event is the only production signal that a sign-out cancelled an
  // adopt. Same observable, emitted one layer up.
  if (expectedEpoch !== getSessionEpoch()) {
    logEvent({
      level: 'info',
      surface: 'auth-epoch-discard',
      message:
        'skipped adopting the beanpod Drive token — signed out during recovery (epoch advanced)',
    });
    return 'not-adopted';
  }

  // Re-read HERE, once, for every caller. This is the read `tryReconnectSilently`
  // used to do inline, and its rationale is unchanged: step 3 can spend seconds on
  // a multi-MB download, and a redirect return or the wake listener may have
  // installed a fresher credential in that window. Owning it here rather than
  // taking a "has a local token" parameter is what makes "one place" true — a
  // caller could otherwise pass a value read before its own await.
  const current = await getGoogleRefreshToken(familyId);
  if (current?.token === docTok.token) return 'not-adopted'; // already ours; no probe, no noise

  const { outcome, errorCode } = await tryCandidateRefreshToken(familyId, docTok, expectedEpoch);

  if (outcome === 'accepted') {
    logEvent({
      level: 'info',
      surface: 'drive-token-adopt',
      message: 'adopted a mirrored Drive token that Google accepted',
      context: { action: 'candidate-accepted' },
    });
    return 'accepted';
  }

  if (outcome === 'rejected') {
    // THE signal this whole class of bug lacked. A poisoned shared entry shows up
    // as this line rising across distinct devices in one family.
    logEvent({
      level: 'warn',
      surface: 'drive-token-adopt',
      message: 'Google refused the mirrored Drive token — local credential left untouched',
      // ⚠️ THE CODE GOOGLE ACTUALLY USED, not a hardcoded guess.
      // `isPermanentRefreshFailure` matches `invalid_grant` OR `expired or
      // revoked`, and this is the one event triage keys on — a guess dressed as a
      // fact here would misdirect exactly when it matters most.
      context: { action: 'candidate-refused', error_code: errorCode ?? 'invalid_grant' },
    });
    return 'not-adopted';
  }

  // Transient: we could not get an answer.
  //
  // ⚠️ RE-READ. `current` was captured BEFORE the probe, and the probe can burn a
  // full 15s fetch timeout. In that window an interactive reconnect can mint and
  // commit a fresh token, so a stale "this device has nothing to lose" would let
  // the arm below overwrite a credential Google had just issued — with an
  // unvalidated copy, which is the exact harm this whole function exists to stop.
  // The epoch guard does NOT cover it: no sign-out happened, so the epoch is
  // unchanged. `error_code` rides along so a proxy defect (an HTTP 4xx that is not
  // a grant refusal) stays queryable here rather than only in `reportError`.
  const afterProbe = await getGoogleRefreshToken(familyId);
  if (afterProbe?.token) {
    logEvent({
      level: 'info',
      surface: 'drive-token-adopt',
      message: 'could not verify the mirrored Drive token — kept the local one',
      context: {
        action: 'candidate-unverified-kept-local',
        ...(errorCode ? { error_code: errorCode } : {}),
      },
    });
    return 'not-adopted';
  }

  // Nothing to lose, so adopt blind — today's exact behaviour, unchanged.
  // ⚠️ VIA `restoreLocalFromDoc` SPECIFICALLY, because its epoch check runs at
  // WRITE TIME. `tryCandidateRefreshToken` returns 'transient' both for a network
  // failure AND for a sign-out that landed mid-probe (a torn-down session), and
  // those are indistinguishable here. Without that write-time guard this arm would
  // persist a token into a dead session: the cold-start zombie the guard prevents.
  await restoreLocalFromDoc(familyId, docTok, expectedEpoch);
  logEvent({
    level: 'info',
    surface: 'drive-token-adopt',
    message: 'adopted a mirrored Drive token unverified — this device had no token to lose',
    context: {
      action: 'candidate-unverified-adopted',
      ...(errorCode ? { error_code: errorCode } : {}),
    },
  });
  return 'unverified-adopted';
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
 * for the bound account:
 *  - identical tokens → nothing to do (no CRDT churn).
 *  - **local MISSING and a doc copy exists → restore local + prime (the recovery).**
 *  - local strictly newer / doc missing → mirror local → doc.
 *  - local present and a doc copy exists → **NOTHING**, whatever their ages.
 *
 * ⚠️ THIS BRANCH NO LONGER ADOPTS OVER A PRESENT LOCAL TOKEN, and that is the fix.
 * It used to take the strictly-newer doc copy and overwrite local with it WITHOUT
 * ASKING GOOGLE ANYTHING — so a mirrored token that was newer but dead silently
 * replaced a working credential, and the next refresh's `invalid_grant` then
 * cleared the store, costing that device a consent screen it did not need. Since
 * the mirror is shared, every device did it.
 *
 * The heal for a device whose local token is genuinely dead has NOT been lost; it
 * moved to where the badness is actually OBSERVED. `attemptSilentRefresh` fails →
 * `firePermanentFailureCallbacks` → `attemptSilentSelfRecovery` →
 * `tryReconnectSilently` → `adoptDocToken`, which asks Google before it writes.
 *
 * Deliberately NOT solved by probing here. This function is AWAITED on the load
 * path, ahead of `setupAutoSync()` and `markPodCreated()` (`syncStore`), and a
 * probe is bounded only by the OAuth proxy's 15s fetch timeout — so a dead network
 * would add up to 15s of cold-start stall to a path that today issues zero
 * exchanges. Not adopting costs nothing and needs no network at all.
 *
 * The trade, stated plainly: a device whose local token is still alive stops
 * eagerly converging on a newer mirrored token at cold start, and converges on
 * the next reconnect instead. Eager convergence on one shared token is precisely
 * what propagated the dead token across the fleet, so this is the direction of
 * travel rather than a regression.
 *
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

    // ⚠️ `!localTok` ONLY — no `isStrictlyNewer` on this side any more. There is
    // nothing to destroy when the device holds no token, so the blind adopt is
    // safe and is exactly today's behaviour for that case. When the device DOES
    // hold one, we leave it alone: see the header.
    if (docTok && !localTok) {
      await restoreLocalFromDoc(familyId, docTok, epochAtStart);
    } else if (localTok && (!docTok || isStrictlyNewer(localTok, docTok))) {
      // Epoch-guarded, symmetric with the adopt branch above: a sign-out mid-read
      // must not propagate the torn-down session's token into the shared doc.
      await mirrorLocalToDoc(boundEmail, localTok, epochAtStart);
    }
    // else: both present and differing → leave BOTH copies untouched. The doc
    // copy is not destroyed (it may be the good one for another device), and the
    // local copy is not displaced by something Google has not vouched for. A
    // device whose local token really is dead heals via `tryReconnectSilently`,
    // which asks Google first.
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
     * Adopt a candidate token — Google decides, this device does not guess.
     *
     * The `provablyOlder`/`isStrictlyNewer` heuristics that used to live here are
     * GONE, and their own comment said why they had to: `issuedAt: number | null`
     * is a documented live shape on both sides, so unknown age is not evidence of
     * staleness, and refusing on it pushed exactly the straggler devices this
     * exists for to a consent screen. `adoptDocToken` asks Google instead, and
     * writes nothing that Google has not accepted.
     */
    const adopt = async (tok: StoredRefreshToken): Promise<boolean> => {
      const outcome = await adoptDocToken(familyId, tok, epochAtStart);
      if (outcome === 'accepted') return true;
      // ⚠️ ONLY on the blind-adopt arm do we run the ladder, and it must stay.
      // That arm means this device had NO token to lose, so it is the straggler
      // this whole module exists for — and the ladder is its documented ~22.5s
      // recovery budget (5 attempts, sized for Chrome-on-Windows wake-from-sleep).
      // Cutting it to the single exchange the probe just made would hand that
      // device a consent screen for one wake-time network blip.
      //
      // ⚠️ NOTE THE ARITHMETIC, because a comment here used to claim the 30s
      // `syncStore.SELF_RECOVERY_TIMEOUT_MS` outlasts this, and it no longer does:
      // the probe can spend up to 15s before the 22.5s ladder even starts, so
      // self-recovery's `raceTimeout` can cut the wait at 30s and raise the
      // reconnect banner while the ladder is still running. The late success then
      // clears it via `onTokenAcquired`, so the cost is a banner flash rather than
      // a forced consent — but it is a real, if minor, regression against that
      // pin, recorded rather than silently absorbed.
      if (outcome === 'unverified-adopted') return (await attemptSilentRefresh()) !== null;
      // 'not-adopted': either Google refused (it has answered) or we kept the
      // local token (which strategy 1 just tried). A ladder here is a guaranteed
      // duplicate.
      return false;
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
    //    One thing widens it slightly: a peer that rotated recently is exactly
    //    the case where the remote mirror holds something this device has not
    //    tried. (An earlier note here claimed `reconnect()` passes `assumeStale`
    //    to skip the clock short-circuit — that parameter was reverted in
    //    `db105529` and never existed after it.)
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
