/**
 * Sign-out tiers as ORDERED STEP LISTS (Phase 4 of the 2026-08-28 login rethink —
 * the deferred Pass-3 decomposition, now that the tier semantics are settled).
 *
 * The three tiers used to be two ~100-line store functions with ~7 byte-identical
 * blocks and a 5-line teardown tail repeated three times. Here the tier DIFFERENCES
 * are expressed as list membership (which steps run), never as conditionals inside a
 * step — scoping differences are separate step names (`clearKeyCacheFamily` vs
 * `clearKeyCacheAll`). The store still owns the step IMPLEMENTATIONS (it holds the
 * session refs and the bounded-timeout helpers); this module owns the ORDER and the
 * runner, so the superset property is unit-testable as data without mounting a store.
 *
 * Documented exceptions to "tier N+1 is a strict superset of tier N" (asserted, as
 * exceptions, by the unit test):
 *   - `resetDocClient` runs in tier 2 only — tier 3's `deleteFamilyDb` →
 *     `clearCache` resets the worker doc anyway; running both is redundant churn.
 *   - `reArmTrustPrompt` runs on the UNTRUSTED tier 2 only — tier 3 sets the trust
 *     flag itself (`untrustDevice`), which supersedes re-arming the prompt.
 *
 * Every step is individually caught by the runner: a hung Drive call or broken
 * IndexedDB must never block the sign-out (a user who can't sign out is much worse
 * than a missed cleanup step). Failures are logged with the step name — never silent.
 */

import { reportError } from '@/utils/errorReporter';

export type SignOutStepName =
  | 'quietTeardownAndForceSave'
  | 'cancelReminders'
  | 'captureDepartingAccount'
  | 'clearGoogleSessionKeepTokens'
  | 'clearGoogleSessionDropTokens'
  | 'clearAllRefreshTokens'
  | 'resetSyncState'
  | 'clearDepartedArtifacts'
  | 'resetDocClient'
  | 'resolveFamilyId'
  | 'deleteFamilyDb'
  | 'clearKeyCacheFamily'
  | 'clearKeyCacheAll'
  | 'removePinWrapsFamily'
  | 'removePinWrapsAll'
  | 'removeRosterFamily'
  | 'removeRosterAll'
  | 'reclaimAllPasskeys'
  | 'untrustDevice'
  | 'reArmTrustPrompt'
  | 'sweepHandoffFiles'
  /**
   * `quietTeardownAndForceSave` WITHOUT the save (#77 eviction): a removed member's device
   * has nothing legitimate to push, and in a Drive family it can no longer reach the file.
   */
  | 'beginQuietTeardown'
  /**
   * Forget the family on this device entirely (#77 eviction) — `familyContext
   * .deleteLocalFamily`: its database, roster cache, keystore blobs, passkey records, PIN
   * wraps, trusted-open wrap, file handles and provider config. THROWS on failure so the
   * runner reports it (the store action it wraps swallows errors and returns false).
   */
  | 'forgetLocalFamily'
  /**
   * A recipe kept from a share link but never reviewed (#92). ON EVERY TIER, and the
   * reasoning matters: an earlier version put it on tier 3 alone, arguing the 60-minute TTL
   * and single-consume already bounded it. They bound DURATION and REPETITION; they do not
   * bind IDENTITY. The envelope names no account, and the consumer is whoever signs in next
   * — so on a shared device, a recipe one person kept and abandoned could pre-fill the next
   * person's recipe form, inside a different family's pod. Clearing it is idempotent and
   * cannot fail, so there is no reason for any tier to skip it.
   */
  | 'clearKeptRecipe';

/** Tier 2, trusted device: silent-reconnect sign-out — tokens, caches, wraps all kept. */
export const SIGN_OUT_TRUSTED_STEPS: readonly SignOutStepName[] = [
  'quietTeardownAndForceSave',
  'cancelReminders',
  'clearGoogleSessionKeepTokens',
  'resetSyncState',
  'resetDocClient',
  'sweepHandoffFiles',
  'clearKeptRecipe',
];

/** Tier 2, untrusted device: full family-scoped local teardown (still NO revoke). */
export const SIGN_OUT_UNTRUSTED_STEPS: readonly SignOutStepName[] = [
  'quietTeardownAndForceSave',
  'cancelReminders',
  'captureDepartingAccount',
  'clearGoogleSessionDropTokens',
  'resetSyncState',
  'clearDepartedArtifacts',
  'resetDocClient',
  'resolveFamilyId',
  'deleteFamilyDb',
  'clearKeyCacheFamily',
  'removePinWrapsFamily',
  'removeRosterFamily',
  'reArmTrustPrompt',
  'sweepHandoffFiles',
  'clearKeptRecipe',
];

/** Tier 3: clean-device promise — everything, every family (still NO revoke). */
export const SIGN_OUT_CLEAR_STEPS: readonly SignOutStepName[] = [
  'quietTeardownAndForceSave',
  'cancelReminders',
  'captureDepartingAccount',
  'clearGoogleSessionDropTokens',
  'clearAllRefreshTokens',
  'resetSyncState',
  'clearDepartedArtifacts',
  'resolveFamilyId',
  'deleteFamilyDb',
  'untrustDevice',
  'clearKeyCacheAll',
  'removePinWrapsAll',
  'reclaimAllPasskeys',
  'removeRosterAll',
  'sweepHandoffFiles',
  'clearKeptRecipe',
];

/**
 * Lock (tracker #77): a REMOVED member proved themselves on this device, but the family
 * cannot be forgotten here — someone still in it uses the device, or this copy holds work
 * the family file has not got. Close the pod and drop the key this device can open it with
 * unattended, KEEPING the encrypted cache. The removed member's own credentials are already
 * gone by now, so they are left with ciphertext they have no way to open, and nobody's
 * unsaved work is lost. Everyone still in the family signs in as usual.
 *
 * The caller pre-sets `familyId` to the REMOVED member's family, so there is no
 * `resolveFamilyId` step: by now the session is already gone, and resolving from "the
 * active family" is the one way this could act on the wrong one. `clearKeyCacheFamily`
 * drops the trusted auto-open wrap (settingsStore's in-memory copy with it).
 */
export const SIGN_OUT_EVICTION_LOCK_STEPS: readonly SignOutStepName[] = [
  'beginQuietTeardown',
  'cancelReminders',
  'resetSyncState',
  'resetDocClient',
  'clearKeyCacheFamily',
  'sweepHandoffFiles',
  'clearKeptRecipe',
];

/**
 * Eviction (tracker #77): as the lock, then FORGET the family on this device — nobody still
 * in it uses the device and there is no unsaved work to lose. `forgetLocalFamily` runs after
 * `clearKeyCacheFamily` so the in-memory key copy is not left stale for a later write to
 * re-persist; there is no `removeRosterFamily`, because `deleteLocalFamily` already deletes
 * the roster cache.
 */
export const SIGN_OUT_EVICTED_STEPS: readonly SignOutStepName[] = [
  ...SIGN_OUT_EVICTION_LOCK_STEPS.slice(
    0,
    SIGN_OUT_EVICTION_LOCK_STEPS.indexOf('clearKeyCacheFamily') + 1
  ),
  'forgetLocalFamily',
  ...SIGN_OUT_EVICTION_LOCK_STEPS.slice(
    SIGN_OUT_EVICTION_LOCK_STEPS.indexOf('clearKeyCacheFamily') + 1
  ),
];

export type SignOutStepImpls = Record<SignOutStepName, () => Promise<void> | void>;

/**
 * Run a tier's steps in order, each individually caught. The impl record comes from
 * the auth store (it owns the session refs); this runner owns the no-step-can-block
 * guarantee and the per-step failure logging.
 */
export async function runSignOutSteps(
  steps: readonly SignOutStepName[],
  impls: SignOutStepImpls
): Promise<void> {
  for (const name of steps) {
    try {
      await impls[name]();
    } catch (e) {
      console.warn(`[signOutSteps] step '${name}' failed — continuing sign-out:`, e);
      // Never console-only (review R2-F6): a failed security-critical clear
      // (family DB, key cache, PIN wraps, passkeys) on a shared device is exactly
      // the class of failure that must be triageable from CloudWatch alone.
      reportError({
        surface: 'auth-signout',
        message: `sign-out step '${name}' failed — sign-out continued`,
        error: e,
        severity: 'warning',
        context: { action: 'step_failed', kind: name },
      });
    }
  }
}
