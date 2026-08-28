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
  | 'reArmTrustPrompt';

/** Tier 2, trusted device: silent-reconnect sign-out — tokens, caches, wraps all kept. */
export const SIGN_OUT_TRUSTED_STEPS: readonly SignOutStepName[] = [
  'quietTeardownAndForceSave',
  'cancelReminders',
  'clearGoogleSessionKeepTokens',
  'resetSyncState',
  'resetDocClient',
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
