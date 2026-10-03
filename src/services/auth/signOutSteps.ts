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
 *   - `resetDocClient` runs in tier 2 only — tier 3's `deleteAllLocalFamilies` →
 *     `clearCache` resets the worker doc anyway; running both is redundant churn.
 *   - `deleteFamilyDb` runs in tier 2 only — tier 3 runs `deleteAllLocalFamilies`, its
 *     every-family superset (C6: tier 3 used to clear only the ACTIVE family's cache). Only
 *     the menu's "sign out and clear all data" runs that list; every other clear runs
 *     `SIGN_OUT_CLEAR_ACTIVE_STEPS`, which keeps `deleteFamilyDb` (round 3).
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
  /** `clearAllRefreshTokens` for the resolved family only (the active-scope clear's twin). */
  | 'clearFamilyRefreshToken'
  | 'resetSyncState'
  | 'clearDepartedArtifacts'
  | 'resetDocClient'
  | 'resolveFamilyId'
  | 'deleteFamilyDb'
  /**
   * Tier 3 (C6): forget EVERY family this device holds — the registry's families plus any
   * `beanies-automerge-*` / photo-queue database the registry no longer lists — through
   * `familyContext.deleteLocalFamily`, recording each outcome into `cacheDeleted`. The
   * active-family-only `deleteFamilyDb` left every other family's cache on a "clean" device.
   */
  | 'deleteAllLocalFamilies'
  /**
   * Tell this family's other tabs the session ended here (C10), WHETHER OR NOT the cache
   * delete ran: a kept cache must not leave the person signed in next door. The untrusted
   * and clear tiers run it; the trusted, cleared-elsewhere and eviction tiers never do (a
   * trusted sign-out keeps the device's sessions by design, an echo would ping-pong, and an
   * eviction must not sign out the family's remaining members in other tabs).
   */
  | 'announceSessionEnded'
  | 'clearKeyCacheFamily'
  | 'clearKeyCacheAll'
  | 'removePinWrapsFamily'
  | 'removePinWrapsAll'
  | 'removeRosterFamily'
  | 'removeRosterAll'
  | 'reclaimAllPasskeys'
  /** `reclaimAllPasskeys` for the resolved family only: its keystore blobs and passkey records. */
  | 'reclaimFamilyPasskeys'
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
  | 'clearKeptRecipe'
  /**
   * The campaign tag from the link that brought this device here (#118). ON TIER 3 ONLY, the
   * opposite of `clearKeptRecipe`, and on purpose. A kept recipe is CONTENT that would leak
   * into the next person's pod; the tag names an ad, not a person, and its 30-day TTL plus
   * consume-once at pod creation already bound it. The deciding fact is that tier 2 runs
   * INSIDE the create flow: LoginPage's "Start over" calls `authStore.signOut()` (tier 2)
   * and then routes back to `/welcome`, so a tagged visitor who hits a Drive hiccup, starts
   * over and then creates would lose the attribution at exactly the moment it matters. The
   * eviction tiers skip it for the same reason. Tier 3 keeps the clean-device promise.
   */
  | 'clearAttribution';

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

/**
 * Another tab deleted this family's cache (#100). The same non-destructive teardown as a
 * trusted sign-out, deliberately, and two properties of it are load-bearing (both asserted
 * by the unit test):
 *   - NO delete and NO key-material step. The deleting tab owns those, a second delete
 *     against a name that is mid-delete is exactly the queue #100 removed, and the other
 *     tab may be reloading into this same family (Settings "Clear Data" keeps tokens).
 *   - `resetDocClient` MUST stay in it. That step drops this tab's doc and key from the
 *     worker and closes its cache connection, which is what ends the session there.
 */
export const SIGN_OUT_CLEARED_ELSEWHERE_STEPS: readonly SignOutStepName[] = SIGN_OUT_TRUSTED_STEPS;

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
  'announceSessionEnded',
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
  'deleteAllLocalFamilies',
  'announceSessionEnded',
  'untrustDevice',
  // Right after `untrustDevice`, which marks the trust question ANSWERED as a side effect
  // of `setTrustedDevice(false)`. Without the re-arm, the next person to sign in on a
  // wiped device would never be asked whether to trust it (2026-09-23: "always ask").
  'reArmTrustPrompt',
  'clearKeyCacheAll',
  'removePinWrapsAll',
  'reclaimAllPasskeys',
  'removeRosterAll',
  'sweepHandoffFiles',
  'clearKeptRecipe',
  'clearAttribution',
];

/**
 * Tier 3 scoped to the ACTIVE family: the same clean-device teardown, but the cache delete is
 * `deleteFamilyDb` (this family only) instead of the every-family sweep. The default for every
 * `signOutAndClearData` caller that is NOT the person choosing "sign out and clear all data"
 * from the menu: delete-family, the fatal overlay's clear, and the demo seed's teardown. None
 * of them asked about the device's OTHER families, so none may delete them (round 3), and
 * that covers their key material too: every `*All` step runs as its family-scoped twin, or
 * deleting one family would drop every other family's refresh token, trusted-open key, PIN
 * wraps, passkeys and roster on this device.
 *
 * A `null` entry DROPS the step from the active scope. `untrustDevice` / `reArmTrustPrompt`
 * have no family twin: device trust is one GLOBAL setting, and the active scope keeps every
 * other family's key material on this device, so untrusting it would silently change how
 * those families open (and re-ask a trust question the person already answered for them).
 */
const ACTIVE_SCOPE_STEP: Partial<Record<SignOutStepName, SignOutStepName | null>> = {
  clearAllRefreshTokens: 'clearFamilyRefreshToken',
  deleteAllLocalFamilies: 'deleteFamilyDb',
  untrustDevice: null,
  reArmTrustPrompt: null,
  clearKeyCacheAll: 'clearKeyCacheFamily',
  removePinWrapsAll: 'removePinWrapsFamily',
  reclaimAllPasskeys: 'reclaimFamilyPasskeys',
  removeRosterAll: 'removeRosterFamily',
};
export const SIGN_OUT_CLEAR_ACTIVE_STEPS: readonly SignOutStepName[] = SIGN_OUT_CLEAR_STEPS.flatMap(
  (s): SignOutStepName[] => {
    const twin = ACTIVE_SCOPE_STEP[s];
    if (twin === null) return [];
    return [twin ?? s];
  }
);

/** Which families a tier-3 clear deletes: the open one (default) or every one on the device. */
export type ClearScope = 'active' | 'all';

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
  // NO `announceSessionEnded` (round 3): the channel is per FAMILY, and the people still in
  // the family keep using this device. Announcing would sign every other tab out, including
  // a member who was never removed. The removed member's own tabs end through the eviction.
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

/**
 * Every step that removes this device's ability to open a pod unattended (2026-09-23).
 * The sign-out kit guard asks `dropsKeyMaterial` rather than re-deriving "is this the
 * untrusted tier", so the guard and the teardown can never disagree. A new step that
 * drops a key, wrap, or the family itself MUST be added here, or the guard will let a
 * manager with an unsaved recovery kit sign out of their only way back in.
 */
export const KEY_MATERIAL_STEPS: ReadonlySet<SignOutStepName> = new Set<SignOutStepName>([
  'clearKeyCacheFamily',
  'clearKeyCacheAll',
  'removePinWrapsFamily',
  'removePinWrapsAll',
  'forgetLocalFamily',
  'deleteAllLocalFamilies',
]);

/** Whether running these steps leaves this device unable to reopen the pod unattended. */
export function dropsKeyMaterial(steps: readonly SignOutStepName[]): boolean {
  return steps.some((s) => KEY_MATERIAL_STEPS.has(s));
}

/** The user-facing menu sign-out tiers: a keep-data sign-out, or the clear-all option. */
export type SignOutTier = 'sign-out' | 'clear';

/**
 * The ONE place a user-facing sign-out picks its step list. `authStore.signOut` /
 * `signOutAndClearData` and the kit guard (`useSignOut`) all select through it.
 */
export function signOutStepsFor(
  tier: SignOutTier,
  trusted: boolean,
  scope: ClearScope = 'all'
): readonly SignOutStepName[] {
  // The menu's clear tier is the all-families sweep; other clears pass `active`.
  if (tier === 'clear') return scope === 'all' ? SIGN_OUT_CLEAR_STEPS : SIGN_OUT_CLEAR_ACTIVE_STEPS;
  return trusted ? SIGN_OUT_TRUSTED_STEPS : SIGN_OUT_UNTRUSTED_STEPS;
}

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
