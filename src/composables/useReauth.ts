/**
 * The step-up gate (#80).
 *
 * A forged session is the thing the session seal cannot fully stop, because the devtools
 * console can call any key the app can call. What a forger does NOT have is the member's
 * PIN — so the irreversible actions ask for it. This is the actual security boundary of
 * #80; the seal is the speed bump in front of it.
 *
 * Deliberately shaped exactly like `useConfirm.ts`: module-level state, a promise-returning
 * `requireReauth()` for callers, a `useReauth()` for the single host component mounted in
 * App.vue. One gate, one shape, one place to reason about.
 *
 * SCOPE IS THE FEATURE. This is wired to a handful of once-a-year actions only — transfer
 * ownership, remove a member, reset another member's credentials, clear all data. If a
 * routine action ever starts asking for a PIN, that is a defect, not a hardening.
 */
import { ref } from 'vue';
import { alert as showAlert } from '@/composables/useConfirm';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember } from '@/types/models';

interface ReauthState {
  open: boolean;
  member: FamilyMember | null;
  resolve: ((value: boolean) => void) | null;
  /** Optional override for the gate's heading, as a `uiStrings` key. */
  titleKey?: string;
  /**
   * Optional one-line explanation of WHY the PIN is being asked for, as a `uiStrings` key.
   *
   * Exists so a caller does not need an extra modal in front of the gate purely to explain
   * itself — that is three taps to reach a PIN pad, two of them ceremony. The gate is the
   * right place for the sentence, because it is the screen the question is being asked on.
   */
  reasonKey?: string;
}

// Module-level state — shared across all callers, exactly as useConfirm does it.
const state = ref<ReauthState>({ open: false, member: null, resolve: null });

function record(kind: 'verified' | 'cancelled' | 'no-credential' | 'unavailable'): void {
  // Emitted on the SUCCESS path too, so a cancel *rate* is measurable rather than just a
  // cancel count.
  logEvent({
    level: 'info',
    surface: 'reauth-gate',
    message: 'reauth_outcome',
    context: { action: 'reauth_outcome', kind },
  });
}

/**
 * Can this device actually run a step-up right now?
 *
 * For RECOVERY paths only. "Clear all data" is where people go when the pod is broken —
 * which is exactly the state where `currentMember` may be unresolved or the member has no
 * credential, so a hard gate would lock them out of the escape hatch. Those callers skip
 * the gate rather than fail closed. The other three actions stay hard-gated.
 */
export function canStepUp(): boolean {
  const member = useFamilyStore().currentMember;
  return !!member && (!!member.pinHash || !!member.passwordHash);
}

/**
 * Demand a fresh proof of identity. Resolves `true` only when the user actually proved it.
 *
 * FAILS CLOSED AND NEVER HANGS: every path that cannot run the gate resolves `false` and
 * says why — to the user in a dialog, and to a developer through the firehose.
 */
export function requireReauth(
  opts: { titleKey?: string; reasonKey?: string } = {}
): Promise<boolean> {
  const familyStore = useFamilyStore();
  const member = familyStore.currentMember;

  if (!member) {
    // Nothing to verify against. Without this the four call sites would await forever.
    reportReauthUnavailable();
    void showAlert({ title: 'reauth.unavailableTitle', message: 'reauth.unavailable' });
    return Promise.resolve(false);
  }

  if (state.value.open) {
    // Re-entrancy is a caller bug, not a UX state to design for.
    record('cancelled');
    logEvent({
      level: 'warn',
      surface: 'reauth-gate',
      message: 'reauth_reentrant',
      context: { action: 'reauth_outcome', kind: 'cancelled' },
    });
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    state.value = { open: true, member, resolve, ...opts };
  });
}

/**
 * A step-up that could not run: no resolved member to verify. Shared by `requireReauth` and
 * inline hosts, so both feed the same `reauth_outcome` stream.
 */
export function reportReauthUnavailable(): void {
  record('unavailable');
  reportError({
    surface: 'reauth-gate',
    message: 'reauth gate needs a resolved currentMember — called before the roster loaded',
    severity: 'warning',
    context: { action: 'reauth_outcome', kind: 'unavailable' },
  });
}

/**
 * Record how a step-up ended. THE one reporter, shared by the modal gate below and by any
 * host that embeds `ReauthChallenge` inline (the device-approval sheet), so an inline
 * step-up is as visible in the firehose as a modal one.
 */
export function reportReauthOutcome(value: boolean, reason?: 'no-credential'): void {
  record(value ? 'verified' : (reason ?? 'cancelled'));
  if (reason === 'no-credential') {
    // A dead end, not a decision: this member has no biometric, no PIN and no password,
    // so they cannot complete ANY gated action until they set one. Say so plainly and
    // report it — recorded as a plain cancel it would be invisible.
    reportError({
      surface: 'reauth-gate',
      message:
        'member has no credential to step up with — every gated action is unreachable for them until a PIN is set in Settings → Security',
      severity: 'warning',
      context: { action: 'reauth_outcome', kind: 'no-credential' },
    });
  }
}

/** Composable for the ReauthGateModal renderer component. */
export function useReauth() {
  function settle(value: boolean, reason?: 'no-credential') {
    reportReauthOutcome(value, reason);
    state.value.resolve?.(value);
    state.value = { open: false, member: null, resolve: null };
  }
  return {
    state,
    handleVerified: () => settle(true),
    handleCancelled: (reason?: 'no-credential') => settle(false, reason),
  };
}
