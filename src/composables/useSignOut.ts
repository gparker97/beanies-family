/**
 * The ONE user-facing sign-out orchestration (2026-09-23), shared by the desktop header
 * (via ProfileMenu) and the mobile menu. Before this, each surface had its own handler
 * pair, mobile signed out with no confirm at all, and neither caught a failure.
 *
 * Flow: `requestSignOut()` opens the shared confirm (SignOutConfirm, rendered by
 * SignOutHost). The confirm carries a "trust this device" tick that reflects the current
 * trust state; choosing an action calls `signOut(tier, { trust })`:
 *   1. The recovery-kit guard is decided SYNCHRONOUSLY, against the tick's CHOSEN trust,
 *      and `phase` leaves 'confirm' in the same tick, which is what blocks a double tap.
 *   2. If the guard fires, SignOutKitGuard asks the user to create a kit; dismissing it
 *      changes nothing (the tick has not been applied yet).
 *   3. Only then is a changed tick applied (`authStore.setDeviceTrust`). A failed write
 *      aborts before any teardown; the action already showed and reported why.
 *   4. The store sign-out for the tier, the store reset, the route to /login.
 * One try/catch/finally around all of it: a throw anywhere is reported once and shown as
 * an error toast, and the user stays where they were.
 *
 * Module-level state, the `useConfirm` pattern: one host renders it, any surface drives it.
 * The escape-hatch sign-outs (fatal overlay, delete family, start over, Google disconnect)
 * deliberately do NOT come through here — they must never be blocked by a guard.
 *
 * The one session end NOT started by this tab also lands here (#100):
 * `endSessionClearedElsewhere`, wired by `bootstrap.ts`, runs when another tab deleted
 * this family's cache, and shares this module's phase so it cannot race a sign-out the
 * person started here.
 */
import { ref, readonly } from 'vue';
import router from '@/router';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslationStore } from '@/stores/translationStore';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { resetAllAppStores } from '@/utils/resetStores';
import { isDemoSession } from '@/utils/reviewDemo';
import { dropsKeyMaterial, signOutStepsFor, type SignOutTier } from '@/services/auth/signOutSteps';
import { needsKitGuardBeforeSignOut } from '@/services/auth/authPrompts';
import {
  emitKitGuard,
  emitKitGuardOutcome,
  emitCacheKept,
} from '@/services/telemetry/loginFlowEvents';

export type SignOutPhase = 'idle' | 'confirm' | 'guard' | 'signing-out';
export type KitGuardOutcome = 'kit_saved' | 'sign_out_anyway' | 'cancelled' | 'superseded';
export type SignOutResult = 'signed-out' | 'cancelled' | 'failed';

// One value, so "guard open while signing out" cannot exist.
const phase = ref<SignOutPhase>('idle');
let resolveGuard: ((outcome: KitGuardOutcome) => void) | null = null;
/**
 * The session end in progress: a sign-out the person started, or a cleared-elsewhere
 * teardown (#100). A release that arrives meanwhile waits for it and then asks the auth
 * store whether anyone is still signed in, rather than guessing from how it returned.
 * Both runs never reject.
 */
let leaving: Promise<unknown> | null = null;

function trackLeaving<T>(run: Promise<T>): Promise<T> {
  leaving = run;
  void run.finally(() => {
    if (leaving === run) leaving = null;
  });
  return run;
}

/** Open the shared sign-out confirm. A no-op unless idle. */
function requestSignOut(): void {
  if (phase.value === 'idle') phase.value = 'confirm';
}

/** Close the confirm without doing anything. */
function cancelSignOut(): void {
  if (phase.value === 'confirm') phase.value = 'idle';
}

/**
 * The session ended under an open confirm or guard (SignOutHost watches for it): close the
 * confirm, or resolve the pending guard as cancelled so no promise is left hanging. A
 * sign-out already running legitimately drops the session, so it is left alone.
 */
function abandonSignOut(): void {
  if (phase.value === 'confirm') phase.value = 'idle';
  else if (phase.value === 'guard') resolveGuard?.('cancelled');
}

/**
 * SignOutKitGuard reports how the guard was resolved. ⚠️ ONLY WHILE THE GUARD OWNS THE
 * PHASE. The guard's actions are async (`confirmStored`, `retrySync`), so one can finish
 * after `endSessionClearedElsewhere` has taken the phase over (#100); resolving the
 * parked guard as `kit_saved` then would start a SECOND, concurrent sign-out. The
 * takeover resolves the parked guard itself, as `cancelled`, once its teardown is done.
 */
function resolveKitGuard(outcome: KitGuardOutcome): void {
  if (phase.value !== 'guard') return;
  resolveGuard?.(outcome);
}

/** Decide the kit guard for this sign-out. Synchronous; emits `kit_guard` either way. */
function evaluateKitGuard(tier: SignOutTier, trust: boolean): boolean {
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();
  const settingsStore = useSettingsStore();
  const syncStore = useSyncStore();
  // Resolve the member the way the prompt watcher does. `familyStore.currentMember` can be
  // null over a loaded roster (see `preselectSessionMember`), which would skip the guard.
  const memberId = authStore.currentUser?.memberId;
  const ctx = {
    member: familyStore.members.find((m) => m.id === memberId),
    owner: familyStore.owner,
    settings: settingsStore.settings,
    envelope: syncStore.envelope,
    dropsKeyMaterial: dropsKeyMaterial(signOutStepsFor(tier, trust)),
    isDemo: isDemoSession.value,
  };
  const shown = needsKitGuardBeforeSignOut(ctx);
  const via = ctx.settings?.recoveryKitConfirmedVia;
  emitKitGuard({
    shown,
    tier,
    trusted: trust,
    via: via ?? (ctx.settings?.recoveryKitConfirmedAt ? 'legacy' : 'none'),
    passphrase: !!ctx.envelope?.recoveryPassphrase,
  });
  return shown;
}

function awaitKitGuard(): Promise<KitGuardOutcome> {
  return new Promise<KitGuardOutcome>((resolve) => {
    resolveGuard = (outcome) => {
      resolveGuard = null;
      emitKitGuardOutcome(outcome);
      resolve(outcome);
    };
  });
}

/**
 * Apply a changed trust tick. Only a keep-data sign-out consults it (clear untrusts anyway),
 * and never in the App Review demo, whose device must not be left trusted (the confirm
 * hides the tick there too; this is the owning-layer guarantee).
 */
async function applyTrustTick(tier: SignOutTier, trust: boolean): Promise<boolean> {
  if (tier !== 'sign-out' || isDemoSession.value) return true;
  if (trust === useSettingsStore().isTrustedDevice) return true;
  return useAuthStore().setDeviceTrust(trust, 'signout-tick');
}

/** Every in-app sign-out ends the same way: the app stores cleared, then `/login`. */
export async function leaveToLogin(): Promise<void> {
  resetAllAppStores();
  await router.replace('/login');
}

/**
 * The ONE place a person is told their family's cached data is still in this browser
 * (#100): another tab or window held it past the deadline. Warning, not error: nothing
 * failed that they did, and the data is encrypted with a key this device no longer
 * holds. Counted separately by `emitCacheKept`, because a `warning` toast never
 * auto-reports.
 */
function showCacheKeptToast(): void {
  const { t } = useTranslationStore();
  showToast('warning', t('auth.cacheKeptTitle'), t('auth.cacheKept'), { durationMs: 12_000 });
}

/** Count the kept cache and tell the person, for callers with nothing in between. */
export function notifyCacheKept(kind: 'forget-family'): void {
  emitCacheKept(kind);
  showCacheKeptToast();
}

/** A sign-out threw: report it once (the person is stuck), then a SILENT toast. */
function failSignOut(error: unknown, kind: SignOutTier | 'cleared-elsewhere'): void {
  // Report DIRECTLY (stable message), then a SILENT toast: the toast's auto-report is
  // skipped while an identical toast is live, which would under-count repeated failures.
  reportError({
    surface: 'login-flow',
    message: 'sign-out failed',
    error,
    // A user action failed: the person is stuck signed in.
    severity: 'critical',
    context: { action: 'sign_out_failed', kind },
  });
  showToast('error', useTranslationStore().t('auth.signOutFailed'), undefined, { silent: true });
}

async function runTeardown(tier: SignOutTier): Promise<void> {
  const authStore = useAuthStore();
  // BOTH tiers can delete the cache: clear-data always, and an ordinary sign-out on an
  // untrusted device (`SIGN_OUT_UNTRUSTED_STEPS` runs `deleteFamilyDb`).
  const { cacheDeleted } =
    tier === 'clear' ? await authStore.signOutAndClearData() : await authStore.signOut();
  // `null` (no delete attempted, e.g. a trusted sign-out) is not "kept"; only a delete
  // that ran and did not finish is. COUNTED before the route, so a navigation that
  // throws cannot lose it; SHOWN after, so it is read on the login screen.
  const kept = cacheDeleted === false;
  if (kept) emitCacheKept(tier === 'clear' ? 'sign-out-clear' : 'sign-out');
  await leaveToLogin();
  if (kept) showCacheKeptToast();
}

/**
 * Sign out from the shared confirm. See the header for the order and why it matters.
 * Returns what happened; never throws.
 */
function signOut(tier: SignOutTier, opts: { trust: boolean }): Promise<SignOutResult> {
  if (phase.value !== 'confirm') return Promise.resolve('cancelled');
  return trackLeaving(runSignOut(tier, opts));
}

async function runSignOut(tier: SignOutTier, opts: { trust: boolean }): Promise<SignOutResult> {
  try {
    // Synchronous, before any await: a second tap now fails the check above.
    const guard = evaluateKitGuard(tier, opts.trust);
    phase.value = guard ? 'guard' : 'signing-out';
    if (guard) {
      const outcome = await awaitKitGuard();
      // `superseded`: another tab ended this session while the guard was open (#100).
      if (outcome === 'cancelled' || outcome === 'superseded') return 'cancelled';
      phase.value = 'signing-out';
    }
    if (!(await applyTrustTick(tier, opts.trust))) return 'failed';
    await runTeardown(tier);
    return 'signed-out';
  } catch (error) {
    failSignOut(error, tier);
    return 'failed';
  } finally {
    phase.value = 'idle';
    resolveGuard = null;
  }
}

/**
 * Another tab deleted this family's cache, and this tab's worker has already let go of
 * it (#100). End this tab's session: the person asked for the family's data to leave
 * this browser, so this tab must not keep showing it or write it back.
 *
 * Wired by `bootstrap.ts` to `docClient.setCacheReleasedHandler`. Never rejects.
 *
 * ⚠️ NO `isAuthenticated` GUARD. A tab on the person picker after "switch person", or
 * one whose passkey sign-in never bound to the roster, still has the pod open in the
 * worker and must tear down too. The toast copy is true for those tabs as well.
 */
export async function endSessionClearedElsewhere(): Promise<void> {
  if (phase.value === 'signing-out') {
    // A session end is already running in this tab. Let it finish, then ask the store
    // whether anyone is still signed in: a sign-out that ended the session but then
    // failed to navigate must NOT be torn down twice, and one that failed before the
    // teardown (a refused trust write) must be finished, because this tab's cache is
    // already gone and it would otherwise stay signed in, saving nothing.
    await leaving;
    if (!useAuthStore().isAuthenticated) return logReleased('deferred-already-ended');
    logReleased('deferred-then-ran');
  } else {
    logReleased('direct');
  }
  await trackLeaving(runClearedElsewhere());
}

/** One event per release, naming the decision taken (CLAUDE.md observability rule 1). */
function logReleased(detail: 'direct' | 'deferred-already-ended' | 'deferred-then-ran'): void {
  logEvent({
    level: 'info',
    surface: 'cache-persist',
    message: 'cache released by another context',
    context: { action: 'cache-released', detail },
  });
}

async function runClearedElsewhere(): Promise<void> {
  // ⚠️ TAKE THE PHASE FIRST, RESOLVE A PARKED GUARD LAST. This closes the confirm or the
  // kit guard (both are v-if'd on their phase) and shows the progress overlay. Resolving
  // the guard BEFORE the teardown would let the parked `signOut()` return
  // in the next microtask and run its `finally`, resetting the phase to idle under the
  // running teardown: the overlay would vanish and a second sign-out would be possible.
  phase.value = 'signing-out';
  try {
    await useAuthStore().endSessionClearedElsewhere();
    await leaveToLogin();
    showToast('info', useTranslationStore().t('auth.signedOutElsewhere'));
  } catch (error) {
    failSignOut(error, 'cleared-elsewhere');
  } finally {
    resolveGuard?.('superseded');
    phase.value = 'idle';
    resolveGuard = null;
  }
}

/** For the menus that start a sign-out and the confirm that carries it through. */
export function useSignOut() {
  return { phase: readonly(phase), requestSignOut, cancelSignOut, signOut };
}

/** For SignOutHost / SignOutKitGuard only. */
export function useSignOutHost() {
  return { phase: readonly(phase), resolveKitGuard, abandonSignOut };
}

/** Test-only: reset the module state between cases. Never called in app code. */
export function __resetSignOutForTests(): void {
  phase.value = 'idle';
  resolveGuard = null;
  leaving = null;
}
