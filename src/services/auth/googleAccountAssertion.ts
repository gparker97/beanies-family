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
 *   3. **Mismatch** — silent self-correction. Wipe Google session state
 *      and force a fresh consent screen, pre-filling the chooser with
 *      the *expected* email via `login_hint`. A subtle toast informs
 *      the user that the account was switched.
 *
 * Re-entry guard prevents the assertion → re-consent → assertion loop
 * from spinning if the user keeps picking the wrong account at Google's
 * chooser.
 *
 * The "switch Google account" flow opts out of assertion via
 * `armAccountSwitch()` — the next acquisition's email is treated as
 * the new ground truth and written to the member record.
 */

import {
  onTokenAcquired,
  clearGoogleSessionState,
  requestAccessToken,
} from '@/services/google/googleAuth';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

let registered = false;
let unsubscribe: (() => void) | null = null;

// Re-entry guard — prevents an infinite assertion loop if the user keeps
// picking the wrong account at Google's chooser. Reset to false when the
// next acquisition either matches or is consumed by an account switch.
let correcting = false;

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
      correcting = false;
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
      correcting = false;
      return;
    }

    // Mismatch.
    if (correcting) {
      // We've already attempted a re-consent in this cycle and the user
      // (or Google) is still returning the wrong account. Stop the loop;
      // surface a one-time toast so the user knows what's happening.
      correcting = false;
      const t = useTranslationStore();
      showToast(
        'warning',
        t.t('auth.accountMismatchTitle'),
        t.t('auth.accountMismatchBody').replace('{email}', member.googleAccountEmail)
      );
      return;
    }

    correcting = true;
    console.warn(
      `[accountAssertion] Token returned ${email}, expected ${member.googleAccountEmail}. Forcing re-consent.`
    );
    try {
      await clearGoogleSessionState();
      await requestAccessToken({
        forceConsent: true,
        loginHint: member.googleAccountEmail,
      });
      // The next acquisition will re-fire this subscriber with either
      // the corrected email (match — correcting cleared above) or the
      // same wrong email again (the re-entry guard above stops the loop).
    } catch (e) {
      correcting = false;
      console.warn('[accountAssertion] Re-consent failed:', e);
      // Silent — user can retry via Settings → Reconnect.
    }
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
  correcting = false;
  pendingAccountSwitch = false;
  writePendingSwitchToStorage(false);
}
