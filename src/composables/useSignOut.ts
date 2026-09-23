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
import { resetAllAppStores } from '@/utils/resetStores';
import { isDemoSession } from '@/utils/reviewDemo';
import { dropsKeyMaterial, signOutStepsFor, type SignOutTier } from '@/services/auth/signOutSteps';
import { needsKitGuardBeforeSignOut } from '@/services/auth/authPrompts';
import { emitKitGuard, emitKitGuardOutcome } from '@/services/telemetry/loginFlowEvents';

export type SignOutPhase = 'idle' | 'confirm' | 'guard' | 'signing-out';
export type KitGuardOutcome = 'kit_saved' | 'sign_out_anyway' | 'cancelled';
export type SignOutResult = 'signed-out' | 'cancelled' | 'failed';

// One value, so "guard open while signing out" cannot exist.
const phase = ref<SignOutPhase>('idle');
let resolveGuard: ((outcome: KitGuardOutcome) => void) | null = null;

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

/** SignOutKitGuard reports how the guard was resolved. */
function resolveKitGuard(outcome: KitGuardOutcome): void {
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

async function runTeardown(tier: SignOutTier): Promise<void> {
  const authStore = useAuthStore();
  if (tier === 'clear') await authStore.signOutAndClearData();
  else await authStore.signOut();
  resetAllAppStores();
  await router.replace('/login');
}

/**
 * Sign out from the shared confirm. See the header for the order and why it matters.
 * Returns what happened; never throws.
 */
async function signOut(tier: SignOutTier, opts: { trust: boolean }): Promise<SignOutResult> {
  if (phase.value !== 'confirm') return 'cancelled';
  try {
    // Synchronous, before any await: a second tap now fails the check above.
    const guard = evaluateKitGuard(tier, opts.trust);
    phase.value = guard ? 'guard' : 'signing-out';
    if (guard) {
      const outcome = await awaitKitGuard();
      if (outcome === 'cancelled') return 'cancelled';
      phase.value = 'signing-out';
    }
    if (!(await applyTrustTick(tier, opts.trust))) return 'failed';
    await runTeardown(tier);
    return 'signed-out';
  } catch (error) {
    // Report DIRECTLY (stable message), then a SILENT toast: the toast's auto-report is
    // skipped while an identical toast is live, which would under-count repeated failures.
    reportError({
      surface: 'login-flow',
      message: 'sign-out failed',
      error,
      // A user action failed: the person is stuck signed in.
      severity: 'critical',
      context: { action: 'sign_out_failed', kind: tier },
    });
    showToast('error', useTranslationStore().t('auth.signOutFailed'), undefined, { silent: true });
    return 'failed';
  } finally {
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
}
