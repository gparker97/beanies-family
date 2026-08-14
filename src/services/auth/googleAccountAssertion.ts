/**
 * Google account assertion — defense-in-depth against silent account drift.
 *
 * Subscribes to `onTokenAcquired` from googleAuth and validates that
 * every newly-acquired access token belongs to the Google account we
 * expect for the currently-authenticated FamilyMember.
 *
 * Three behaviors per acquisition:
 *   1. **First-time backfill** — member has no `googleAccountEmail` yet.
 *      Write the OAuth-verified email to their record. Verified by the
 *      member's own OAuth response; we never infer from indirect signals.
 *   2. **Match** — member's `googleAccountEmail` equals the OAuth email.
 *      No-op.
 *   3. **Mismatch** — record a silent diagnostic event and do NOTHING user-facing
 *      (2026-08-14). A nominal email mismatch is NOT itself an error: the session
 *      account may legitimately have shared access to the file. We no longer show
 *      a "wrong account" toast here (it fired on every hard refresh for a
 *      multi-account user whose data loaded fine). The genuine can't-access case
 *      is surfaced by the provider's 404 classifier (reconnect banner), and the
 *      stale binding self-heals on the next proven Drive access (see
 *      `healAccountBindingIfNeeded` in syncStore). We also never auto-force a
 *      re-consent: that silently MINTED a fresh refresh token on every mismatched
 *      (often background) acquisition and was a real driver of Google's
 *      per-account token-cap churn (#62).
 *
 * The "switch Google account" flow opts out of assertion via
 * `armAccountSwitch()` — the next acquisition's email is treated as
 * the new ground truth and written to the member record.
 */

import { onTokenAcquired } from '@/services/google/googleAuth';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry';

let registered = false;
let unsubscribe: (() => void) | null = null;

// One-shot flag set by the "switch Google account" flow. When set, the
// next *interactive* token acquisition's email is written to the member
// record as the new googleAccountEmail (no assertion).
//
// Also mirrored to sessionStorage so the flag survives a full-page
// redirect-auth round-trip on PWA / iOS Safari (the in-memory flag is
// lost when the page navigates to Google's consent screen and back).
let pendingAccountSwitch = false;
const PENDING_SWITCH_STORAGE_KEY = 'beanies_pending_account_switch';

function readPendingSwitchFromStorage(): boolean {
  try {
    return sessionStorage.getItem(PENDING_SWITCH_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePendingSwitchToStorage(value: boolean): void {
  try {
    if (value) sessionStorage.setItem(PENDING_SWITCH_STORAGE_KEY, '1');
    else sessionStorage.removeItem(PENDING_SWITCH_STORAGE_KEY);
  } catch {
    // Best-effort; sessionStorage may be unavailable in some contexts.
  }
}

function isPendingAccountSwitch(): boolean {
  return pendingAccountSwitch || readPendingSwitchFromStorage();
}

/**
 * Arm the next interactive token acquisition to be treated as a
 * deliberate account switch — the new email becomes the member's
 * googleAccountEmail. Called by the Settings UI's "Switch Google
 * account" button before triggering a forced re-consent.
 */
export function armAccountSwitch(): void {
  pendingAccountSwitch = true;
  writePendingSwitchToStorage(true);
}

/**
 * Clear the pending-switch flag without consuming it. Called on switch
 * cancellation (popup dismissed, redirect bailed out via back button)
 * so the flag doesn't poison the next legitimate token acquisition by
 * silently overwriting the bound googleAccountEmail.
 */
export function disarmAccountSwitch(): void {
  pendingAccountSwitch = false;
  writePendingSwitchToStorage(false);
}

/**
 * Register the account-assertion subscriber. Idempotent — calling more
 * than once is a no-op. Call once during app boot, after auth and family
 * stores are initialized.
 */
export function registerGoogleAccountAssertion(): void {
  if (registered) return;
  registered = true;

  unsubscribe = onTokenAcquired(async (email, _token, interactive) => {
    // Userinfo failed — cannot assert anything. Fail-open.
    if (!email) return;

    const auth = useAuthStore();
    const memberId = auth.currentUser?.memberId;
    if (!memberId) return; // not yet authenticated to a family

    const fam = useFamilyStore();
    const member = fam.members.find((m) => m.id === memberId);
    if (!member) return; // race: user signed out mid-acquisition

    // Deliberate switch — only consume the flag on an *interactive*
    // acquisition. A background silent refresh that happens to fire
    // during the switch flow must not consume the arming, otherwise
    // the user's actual chooser-pick a moment later would be treated
    // as a mismatch and trigger a re-consent loop.
    if (interactive && isPendingAccountSwitch()) {
      disarmAccountSwitch();
      await fam.updateMember(memberId, { googleAccountEmail: email });
      return;
    }

    // First-time backfill — verified by own OAuth response.
    if (!member.googleAccountEmail) {
      await fam.updateMember(memberId, { googleAccountEmail: email });
      return;
    }

    // Match — happy path.
    if (member.googleAccountEmail === email) {
      return;
    }

    // Mismatch — the acquired token is for a DIFFERENT Google account than this
    // member is bound to. This is NOT surfaced to the user (2026-08-14): a nominal
    // mismatch where the session can still access the file is benign, and toasting
    // it fired on every hard refresh for a multi-account user whose data loaded
    // fine. Record a silent diagnostic and defer to the access-based path — the
    // provider's 404 classifier surfaces a genuine can't-access as a reconnect
    // banner, and the stale binding self-heals on the next proven Drive access
    // (`healAccountBindingIfNeeded` in syncStore). `logEvent` is client-side
    // rate-limited (50/surface/min), so a repeating silent refresh cannot spam it.
    logEvent({
      level: 'info',
      surface: 'account-mismatch-benign',
      message: 'Token account differs from the member binding; deferring to access-based heal',
      context: { action: 'deferred-to-access-path' },
    });
  });
}

/**
 * Test helper: tear down the subscriber. Production code does not need
 * this — the subscriber lives for the application lifetime.
 */
export function _resetGoogleAccountAssertionForTests(): void {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  registered = false;
  pendingAccountSwitch = false;
  writePendingSwitchToStorage(false);
}
