/**
 * The login-flow driver (2026-08-28 login rethink, Phase 1): owns the machine state,
 * executes the effects each state requests, and reports outcomes back as events.
 *
 * Split of responsibilities:
 *   - `loginFlow.ts` (pure) decides WHERE the flow goes — unit-tested as a matrix.
 *   - this composable does the I/O each state asks for (resolve methods, run the
 *     biometric tail, fetch/decrypt, verify pod access) and NOTHING else.
 *   - `LoginPage.vue` renders `state.kind` → a view component and forwards view events
 *     to the handlers here.
 *
 * The password travels out-of-band in a non-reactive local (never machine state, never
 * a ref) and is cleared the moment the opening attempt consumes it.
 */

import { ref, type Ref } from 'vue';
import {
  transition,
  type LoginFlowEvent,
  type LoginFlowState,
  type OpenFailReason,
  type PersonCard,
  type PersonSource,
} from '@/services/auth/loginFlow';
import { resolveProveMethods } from '@/services/auth/proveMethods';
import { useBiometricSignIn } from '@/composables/useBiometricSignIn';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { getRosterCache } from '@/services/indexeddb/repositories/rosterCacheRepository';
import { resolveDeviceKeys } from '@/services/auth/passkeyService';
import { getMemberAvatarUrl } from '@/composables/useMemberInfo';
import {
  emitOpenFetchRecovery,
  emitProveOutcome,
  emitRosterFallbackUsed,
} from '@/services/telemetry/loginFlowEvents';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { reportError } from '@/utils/errorReporter';

export interface UseLoginFlow {
  state: Ref<LoginFlowState>;
  /** Error text for the prove screen (wrong password, mismatch, …). */
  proveError: Ref<string | null>;
  /** A prove/opening effect is in flight — views disable their affordances. */
  isBusy: Ref<boolean>;
  /**
   * Enter the flow for a family. Returns false when this device has NO person list at
   * all (no open pod, no roster, no credential records) — the caller falls back to the
   * bootstrap load surface, exactly like a brand-new device.
   */
  startForFamily(familyId: string, familyName: string): Promise<boolean>;
  dispatch(event: LoginFlowEvent): void;
  // Prove-screen handlers (wired to ProveView's events)
  onPickPerson(person: PersonCard): void;
  onBiometric(): Promise<void>;
  onTapThrough(): Promise<void>;
  onPasswordSubmit(password: string): void;
  onCreatePassword(password: string): Promise<void>;
  onFellBack(): void;
  // Recovery-panel handlers
  onRecoveryRetry(): void;
  onRecoveryReconnect(): Promise<void>;
  onRecoveryGrantPermission(): Promise<void>;
}

export function useLoginFlow(opts: {
  onSignedIn: (destination: string) => void;
  onExit: () => void;
}): UseLoginFlow {
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();
  const familyContextStore = useFamilyContextStore();
  const syncStore = useSyncStore();
  const { t } = useTranslation();
  const { signIn: biometricSignIn } = useBiometricSignIn();
  const { reconnect: googleReconnect, reconnectError } = useGoogleReconnect();

  const state = ref<LoginFlowState>({ kind: 'idle' });
  const proveError = ref<string | null>(null);
  const isBusy = ref(false);

  /** Out-of-band password for the current opening attempt. Never reactive. */
  let pendingPassword: string | null = null;

  function dispatch(event: LoginFlowEvent): void {
    const next = transition(state.value, event);
    const changed = next !== state.value;
    state.value = next;
    if (changed) void runStateEffect();
  }

  const podOpen = () => familyStore.members.length > 0;

  // ── People-list resolution (roster → credential records → bootstrap) ──────────

  async function buildPeople(
    familyId: string
  ): Promise<{ people: PersonCard[]; source: PersonSource } | null> {
    // 1. Pod already open: the live roster, photos included.
    if (podOpen()) {
      const people: PersonCard[] = familyStore.sortedHumans.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        gender: m.gender,
        ageGroup: m.ageGroup,
        hasCredential: !!m.passwordHash,
        photoUrl: getMemberAvatarUrl(m) ?? undefined,
      }));
      return people.length > 0 ? { people, source: 'open-pod' } : null;
    }

    // 2. Device-local roster cache (the normal pre-decrypt path).
    try {
      const entry = await getRosterCache(familyId);
      if (entry && entry.members.length > 0) {
        return { people: entry.members, source: 'roster' };
      }
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'roster cache read failed — falling back to credential records',
        error: e,
        severity: 'warning',
        context: { action: 'roster_read_failed' },
      });
    }

    // 3. Credential records (roster evicted): whoever has a key here can still be shown.
    try {
      const keys = await resolveDeviceKeys(familyId);
      if (keys.length > 0) {
        emitRosterFallbackUsed();
        const people: PersonCard[] = keys.map((k) => ({
          id: k.memberId,
          name: k.memberName || k.label,
          color: '#2C3E50',
          hasCredential: true,
        }));
        return { people, source: 'credential-records' };
      }
    } catch {
      // resolveDeviceKeys degrades internally and reports; nothing further to add here.
    }

    // 4. Nothing — bootstrap (load the file, decrypt, identity inferred from password).
    return null;
  }

  async function startForFamily(familyId: string, familyName: string): Promise<boolean> {
    // Same family-activation sequence the old handleFamilySelected ran.
    if (familyContextStore.activeFamilyId !== familyId) {
      await familyContextStore.switchFamily(familyId);
      syncStore.resetState();
      await syncStore.initialize();
    }
    const built = await buildPeople(familyId);
    if (!built) return false;
    proveError.value = null;
    dispatch({ type: 'START', familyId, familyName, people: built.people, source: built.source });
    return true;
  }

  // ── State-entry effects ───────────────────────────────────────────────────────

  async function runStateEffect(): Promise<void> {
    const s = state.value;
    if (s.kind === 'prove-loading') {
      const methods = await resolveProveMethods({
        familyId: s.familyId,
        memberId: s.person.id,
        podOpen: podOpen(),
        hasCredential: s.person.hasCredential ?? null,
        rosterSource: s.source,
      });
      // The machine drops stale events itself, but avoid dispatching for a superseded
      // person at all (two quick picks) — check we're still loading the same person.
      const cur = state.value;
      if (cur.kind === 'prove-loading' && cur.person.id === s.person.id) {
        dispatch({ type: 'METHODS_RESOLVED', methods });
      }
      return;
    }
    if (s.kind === 'opening') {
      await runOpening(s.grant.memberId, s.grant.fkAvailable);
      return;
    }
    if (s.kind === 'done') {
      opts.onSignedIn(s.destination);
      return;
    }
    if (s.kind === 'open-recovery') {
      emitOpenFetchRecovery({ reason: s.reason });
      return;
    }
    if (s.kind === 'idle') {
      pendingPassword = null;
      opts.onExit();
    }
  }

  // ── Prove handlers ────────────────────────────────────────────────────────────

  function currentProve(): Extract<LoginFlowState, { kind: 'prove' }> | null {
    return state.value.kind === 'prove' ? state.value : null;
  }

  function classifyLoadFailure(reason?: string): Exclude<OpenFailReason, 'wrong-password'> {
    if (reason === 'auth') return 'auth';
    if (reason === 'not-found' || reason === 'file-not-found') return 'not-found';
    return 'error';
  }

  /**
   * Ensure the envelope is at least STAGED (pending) or the pod open, so a decrypt or a
   * web PRF assert has something to work on. Dispatches OPEN_FAILED and returns false
   * on a transport problem — the caller just stops.
   */
  async function ensureStaged(): Promise<boolean> {
    if (podOpen() || syncStore.hasPendingEncryptedFile) return true;
    if (!syncStore.isConfigured) {
      // No provider and no open pod: this family cannot be opened from here.
      dispatch({ type: 'OPEN_FAILED', reason: 'not-found' });
      return false;
    }
    if (syncStore.needsPermission) {
      dispatch({ type: 'OPEN_FAILED', reason: 'permission' });
      return false;
    }
    try {
      const result = await syncStore.loadFromFile();
      if (result.success || result.needsPassword) return true;
      dispatch({ type: 'OPEN_FAILED', reason: classifyLoadFailure(result.reason) });
      return false;
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'staging the pod file for prove failed',
        error: e,
        severity: 'warning',
        context: { action: 'stage_failed' },
      });
      dispatch({ type: 'OPEN_FAILED', reason: 'error' });
      return false;
    }
  }

  function onPickPerson(person: PersonCard): void {
    proveError.value = null;
    dispatch({ type: 'PICK_PERSON', person });
  }

  async function onBiometric(): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      // Web PRF needs the envelope's passkeyWrappedKeys in reach; native ignores this.
      if (!(await ensureStaged())) return;
      const result = await biometricSignIn(s.familyId, s.person.id);
      emitProveOutcome({
        method: 'biometric',
        ok: result.ok,
        errorCode: result.ok ? undefined : result.message === null ? 'cancelled' : 'error',
        fallbackDepth: s.fallbackDepth,
      });
      if (result.ok) {
        // The tail decrypted (if pending) and completed the session — opening verifies.
        dispatch({
          type: 'PROVE_SUCCEEDED',
          grant: { memberId: s.person.id, fkAvailable: true },
        });
        return;
      }
      // null message = user cancelled — deliberate silence, stay on the prove screen.
      proveError.value = result.message;
    } finally {
      isBusy.value = false;
    }
  }

  async function onTapThrough(): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      const result = await authStore.signInPasswordless(s.person.id);
      emitProveOutcome({
        method: 'tap-through',
        ok: result.success,
        errorCode: result.success ? undefined : 'rejected',
        fallbackDepth: s.fallbackDepth,
      });
      if (result.success) {
        dispatch({
          type: 'PROVE_SUCCEEDED',
          grant: { memberId: s.person.id, fkAvailable: false },
        });
        return;
      }
      proveError.value = result.error ?? t('auth.signInFailed');
    } finally {
      isBusy.value = false;
    }
  }

  function onPasswordSubmit(password: string): void {
    const s = currentProve();
    if (!s || isBusy.value) return;
    proveError.value = null;
    pendingPassword = password;
    dispatch({ type: 'PASSWORD_SUBMITTED', memberId: s.person.id });
  }

  async function onCreatePassword(password: string): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      const result = await authStore.setPassword(s.person.id, password);
      emitProveOutcome({
        method: 'create-password',
        ok: result.success,
        errorCode: result.success ? undefined : 'rejected',
        fallbackDepth: s.fallbackDepth,
      });
      if (result.success) {
        await syncStore.syncNowBounded();
        dispatch({
          type: 'PROVE_SUCCEEDED',
          grant: { memberId: s.person.id, fkAvailable: false },
        });
        return;
      }
      proveError.value = result.error ?? t('auth.signInFailed');
    } finally {
      isBusy.value = false;
    }
  }

  function onFellBack(): void {
    dispatch({ type: 'PROVE_FELL_BACK' });
  }

  // ── Opening effect ────────────────────────────────────────────────────────────

  /**
   * Same contract as LoadPodView's `ensureDurableHome`: verify the loaded family has a
   * durable writable save target; report, never block (the store action pages loudly on
   * a hard no-target case and `PodAccessBanner` renders it app-level).
   */
  async function verifyDurableHome(): Promise<void> {
    try {
      await syncStore.verifyPodAccess();
    } catch (e) {
      reportError({
        surface: 'pod-access',
        severity: 'critical',
        message: 'pod access verification threw at the login-flow open boundary',
        error: e,
        context: { action: 'VERIFY_UNAVAILABLE' },
      });
    }
  }

  async function runOpening(memberId: string, fkAvailable: boolean): Promise<void> {
    isBusy.value = true;
    try {
      // Password path: fetch → decrypt → verify identity against the doc.
      if (!fkAvailable && pendingPassword !== null) {
        const password = pendingPassword;
        pendingPassword = null;
        if (!podOpen()) {
          if (!(await ensureStaged())) return; // dispatched OPEN_FAILED already
          if (syncStore.hasPendingEncryptedFile) {
            const dec = await syncStore.decryptPendingFile(password);
            if (!dec.success) {
              proveError.value = dec.error ?? t('password.decryptionError');
              emitProveOutcome({
                method: 'password',
                ok: false,
                errorCode: 'wrong-password',
                fallbackDepth: 0,
              });
              dispatch({ type: 'OPEN_FAILED', reason: 'wrong-password' });
              return;
            }
            await familyStore.loadMembers();
          }
        }
        const result = await authStore.signIn(memberId, password);
        emitProveOutcome({
          method: 'password',
          ok: result.success,
          errorCode: result.success ? undefined : 'wrong-password',
          fallbackDepth: 0,
        });
        if (!result.success) {
          proveError.value = result.error ?? t('auth.signInFailed');
          dispatch({ type: 'OPEN_FAILED', reason: 'wrong-password' });
          return;
        }
        await verifyDurableHome();
        dispatch({ type: 'OPEN_SUCCEEDED' });
        return;
      }

      // Biometric / tap-through path: the prove tail already opened the pod (or it was
      // open all along). If it somehow is not, that is a defect — recover honestly.
      if (!podOpen()) {
        reportError({
          surface: 'login-flow',
          message: 'opening reached with a proven grant but no open pod',
          severity: 'warning',
          context: { action: 'open_without_pod' },
        });
        dispatch({ type: 'OPEN_FAILED', reason: 'error' });
        return;
      }
      await verifyDurableHome();
      dispatch({ type: 'OPEN_SUCCEEDED' });
    } finally {
      isBusy.value = false;
    }
  }

  function onRecoveryRetry(): void {
    dispatch({ type: 'RECOVERY_RETRY' });
  }

  /** Drive token gone: run the shared Google reconnect, then retry the open. */
  async function onRecoveryReconnect(): Promise<void> {
    if (state.value.kind !== 'open-recovery' || isBusy.value) return;
    isBusy.value = true;
    try {
      const ok = await googleReconnect(syncStore.providerAccountEmail ?? undefined);
      // On redirect surfaces (iOS/PWA) reconnect() navigates away; nothing more to do —
      // the boot path re-enters the flow with a fresh token on return.
      if (!ok) {
        proveError.value = reconnectError.value || t('googleDrive.reconnectFailed');
        return;
      }
      dispatch({ type: 'RECOVERY_RETRY' });
    } finally {
      isBusy.value = false;
    }
  }

  /** Local file-handle permission revoked: re-request, then retry. */
  async function onRecoveryGrantPermission(): Promise<void> {
    if (state.value.kind !== 'open-recovery' || isBusy.value) return;
    isBusy.value = true;
    try {
      const granted = await syncStore.requestPermission();
      if (!granted) {
        proveError.value = t('auth.fileLoadFailed');
        return;
      }
      dispatch({ type: 'RECOVERY_RETRY' });
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'permission re-grant threw during open recovery',
        error: e,
        severity: 'warning',
        context: { action: 'grant_failed' },
      });
      proveError.value = t('auth.fileLoadFailed');
    } finally {
      isBusy.value = false;
    }
  }

  return {
    state,
    proveError,
    isBusy,
    startForFamily,
    dispatch,
    onPickPerson,
    onBiometric,
    onTapThrough,
    onPasswordSubmit,
    onCreatePassword,
    onFellBack,
    onRecoveryRetry,
    onRecoveryReconnect,
    onRecoveryGrantPermission,
  };
}
