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
 *   3. **Mismatch** — surface a manual "switch account" toast (once). We do
 *      NOT auto-force a re-consent: that silently MINTED a fresh refresh token
 *      on every mismatched (often background) acquisition and was a real driver
 *      of Google's per-account token-cap churn (#62). The user re-consents on an
 *      explicit gesture via Settings → Reconnect / "Switch Google account"
 *      (`armAccountSwitch`).
 *
 * A warn-once latch keeps a repeating silent refresh from spamming the toast.
 *
 * The "switch Google account" flow opts out of assertion via
 * `armAccountSwitch()` — the next acquisition's email is treated as
 * the new ground truth and written to the member record.
 */

import { onTokenAcquired } from '@/services/google/googleAuth';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';

let registered = false;
let unsubscribe: (() => void) | null = null;

// Warn-once latch — a mismatched session fires the subscriber on every
// (often silent) acquisition; show the manual-switch toast only once. Reset to
// false when the next acquisition matches or is consumed by an account switch.
let mismatchWarned = false;

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
      mismatchWarned = false;
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
      mismatchWarned = false;
      return;
    }

    // Mismatch — the acquired token is for a DIFFERENT Google account than this
    // member is bound to. Do NOT auto-force a re-consent here (#62): that silently
    // MINTED a fresh refresh token on every mismatched background acquisition,
    // which was a real driver of Google's per-account 100-token-cap churn. Surface
    // a manual switch instead — the user resolves it via Settings → Reconnect /
    // "Switch Google account" (armAccountSwitch), which re-consents on an explicit
    // gesture. Warn once so a repeating silent refresh doesn't spam the toast.
    if (mismatchWarned) return;
    mismatchWarned = true;
    console.warn(
      `[accountAssertion] Token returned ${email}, expected ${member.googleAccountEmail}. ` +
        `Surfacing manual switch (no auto re-consent).`
    );
    const t = useTranslationStore();
    showToast(
      'warning',
      t.t('auth.accountMismatchTitle'),
      t.t('auth.accountMismatchBody').replace('{email}', member.googleAccountEmail)
    );
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
  mismatchWarned = false;
  pendingAccountSwitch = false;
  writePendingSwitchToStorage(false);
}
