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
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';
import {
  unlockWithPin,
  enrollPinUnlock,
  removePinUnlock,
  MAX_PIN_ATTEMPTS,
} from '@/services/auth/deviceUnlock';
import { fillTemplate } from '@/utils/fillTemplate';
import { useSettingsStore } from '@/stores/settingsStore';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry/logEvent';

export interface UseLoginFlow {
  state: Ref<LoginFlowState>;
  /** Error text for the prove screen (wrong password, mismatch, …). */
  proveError: Ref<string | null>;
  /** A prove/opening effect is in flight — views disable their affordances. */
  isBusy: Ref<boolean>;
  /**
   * A family-level recovery secret (kit or passphrase) opened the pod this session: the
   * prove screen offers SET-A-NEW-PIN instead of demanding forgotten credentials. Set by
   * the kit/passphrase redeem paths; cleared on sign-in and on leaving the flow.
   */
  recoveryMode: Ref<boolean>;
  /**
   * Enter the flow for a family. Returns false when this device has NO person list at
   * all (no open pod, no roster, no credential records) — the caller falls back to the
   * bootstrap load surface, exactly like a brand-new device.
   */
  startForFamily(familyId: string, familyName: string): Promise<boolean>;
  /** Trusted-device cached-key decrypt of the STAGED pending file. Shared with the bootstrap branch. */
  tryCachedKeyDecrypt(familyId: string): Promise<boolean>;
  dispatch(event: LoginFlowEvent): void;
  // Prove-screen handlers (wired to ProveView's events)
  onPickPerson(person: PersonCard): void;
  onBiometric(): Promise<void>;
  onTapThrough(): Promise<void>;
  onPasswordSubmit(password: string): void;
  onPinSubmit(pin: string): Promise<void>;
  onResetPin(pin: string): Promise<void>;
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
  const settingsStore = useSettingsStore();
  const { signIn: biometricSignIn } = useBiometricSignIn();
  const { reconnect: googleReconnect, reconnectError } = useGoogleReconnect();

  const state = ref<LoginFlowState>({ kind: 'idle' });
  const proveError = ref<string | null>(null);
  const isBusy = ref(false);
  const recoveryMode = ref(false);

  /**
   * Out-of-band password for the current opening attempt. Never reactive. RETAINED
   * across transport failures (a reconnect retry must be able to re-run the password
   * open without re-asking) — cleared only on success, on a wrong password, and on
   * leaving the flow.
   */
  let pendingPassword: string | null = null;
  /** The prove screen's fallbackDepth captured with the password (telemetry fidelity). */
  let pendingProveDepth = 0;

  function dispatch(event: LoginFlowEvent): void {
    const next = transition(state.value, event);
    const changed = next !== state.value;
    state.value = next;
    if (changed) void runStateEffect();
  }

  const podOpen = () => familyStore.members.length > 0;

  // Phase 4: whether the family's envelope holds ANY password wraps — roster-carried
  // when cold (kit-born families store `false`), read live when warm. Feeds the prove
  // engine's conditional password probe; `null` = unknown → password stays offered.
  const envelopeHasPasswordWraps = ref<boolean | null>(null);

  // ── People-list resolution (roster → credential records → bootstrap) ──────────

  async function buildPeople(
    familyId: string
  ): Promise<{ people: PersonCard[]; source: PersonSource } | null> {
    // 1. Pod already open: the live roster, photos included.
    if (podOpen()) {
      const env = syncStore.envelope;
      envelopeHasPasswordWraps.value = env ? Object.keys(env.wrappedKeys ?? {}).length > 0 : null;
      const people: PersonCard[] = familyStore.sortedHumans.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        gender: m.gender,
        ageGroup: m.ageGroup,
        hasCredential: !!m.passwordHash || !!m.pinHash,
        hasPassword: !!m.passwordHash,
        photoUrl: getMemberAvatarUrl(m) ?? undefined,
      }));
      return people.length > 0 ? { people, source: 'open-pod' } : null;
    }

    // 2. Device-local roster cache (the normal pre-decrypt path).
    try {
      const entry = await getRosterCache(familyId);
      if (entry && entry.members.length > 0) {
        envelopeHasPasswordWraps.value = entry.envelopeHasPasswordWraps ?? null;
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
        envelopeHasPasswordWraps.value = null;
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

  /**
   * Trusted-device fast open: stage the file and decrypt with the cached family key,
   * silently. Restores main's pre-picker auto-decrypt — without it, a passwordless
   * (deferred-password) kid on a trusted device would face a password-only prove
   * screen after a plain sign-out. No-ops (false) when there is no cached key.
   */
  async function tryCachedKeyDecrypt(familyId: string): Promise<boolean> {
    const cachedKeyB64 = await settingsStore.getCachedFamilyKey(familyId);
    if (!cachedKeyB64) return false;
    try {
      const { importFamilyKey } = await import('@/services/crypto/familyKeyService');
      const { base64ToBuffer } = await import('@/utils/encoding');
      const fk = await importFamilyKey(new Uint8Array(base64ToBuffer(cachedKeyB64)));
      const result = await syncStore.decryptPendingFileWithKey(fk);
      return result.success;
    } catch {
      return false;
    }
  }

  /** Silently stage + cached-key-decrypt when a trusted device holds the key. */
  async function tryTrustedAutoOpen(familyId: string): Promise<void> {
    if (podOpen() || !(await settingsStore.getCachedFamilyKey(familyId))) return;
    if (!syncStore.isConfigured || syncStore.needsPermission) return;
    try {
      if (!syncStore.hasPendingEncryptedFile) {
        const result = await syncStore.loadFromFile();
        if (!result.success && !result.needsPassword) return; // stay silent — prove handles it
      }
      if (syncStore.hasPendingEncryptedFile && (await tryCachedKeyDecrypt(familyId))) {
        await familyStore.loadMembers();
      }
    } catch (e) {
      // A fast path, not a gate — the flow works without it. But never silent (repo
      // no-silent-failures rule): a persistent failure here quietly demotes every
      // trusted-device login on this device to manual credentials.
      logEvent({
        level: 'warn',
        surface: 'login-flow',
        message: 'trusted_auto_open_failed',
        context: {
          action: 'auto_open_failed',
          error_code: e instanceof Error ? e.name : 'unknown',
        },
      });
    }
  }

  async function startForFamily(familyId: string, familyName: string): Promise<boolean> {
    try {
      // Same family-activation sequence the old handleFamilySelected ran — PLUS clearing
      // the previous family's resident members: without it, family A's roster would be
      // served as family B's picker and a tap-through could mint a cross-family session
      // (the A∪B corruption class sign-out explicitly guards against).
      //
      // Review F1: a pending encrypted file staged FOR THIS FAMILY (the /open "Open with
      // beanies.family" gesture) must survive the switch — syncStore.resetState() nulls
      // it, silently discarding the file the user explicitly opened. Skip the sync reset
      // in that case; the family-context switch and member clear still run.
      if (familyContextStore.activeFamilyId !== familyId) {
        const pendingIsThisFamily = syncStore.pendingEncryptedFile?.envelope?.familyId === familyId;
        await familyContextStore.switchFamily(familyId);
        familyStore.resetState();
        if (!pendingIsThisFamily) {
          syncStore.resetState();
          await syncStore.initialize();
        }
      }
      // Trusted-device fast path: open silently with the cached key so passwordless
      // members get tap-through and the picker carries live data.
      await tryTrustedAutoOpen(familyId);
      const built = await buildPeople(familyId);
      if (!built) return false;
      proveError.value = null;
      pendingPassword = null;
      dispatch({
        type: 'START',
        familyId,
        familyName,
        people: built.people,
        source: built.source,
      });
      return true;
    } catch (e) {
      // Review F12: an IndexedDB/initialize throw here used to escape into the caller's
      // view logic and strand the user on a textless spinner. Degrade to the bootstrap
      // path instead — it has its own error surfaces.
      reportError({
        surface: 'login-flow',
        message: 'startForFamily failed — degrading to the bootstrap surface',
        error: e,
        severity: 'warning',
        context: { action: 'start_failed' },
      });
      return false;
    }
  }

  // ── State-entry effects ───────────────────────────────────────────────────────

  /**
   * When the pod is OPEN, the live doc — not the roster snapshot — is the truth about a
   * person's credential state. A stale `hasCredential:false` card would otherwise render
   * a wrong prove pane over a member whose credentials changed underneath it, and the
   * reverse staleness would suppress tap-through. Returns null when the member no longer
   * exists in the open doc (removed on another device) — the picker must be rebuilt.
   */
  function liveProjectPerson(person: PersonCard): PersonCard | null {
    if (!podOpen()) return person;
    const live = familyStore.members.find((m) => m.id === person.id);
    if (!live || live.isPet) return null;
    return {
      id: live.id,
      name: live.name,
      color: live.color,
      gender: live.gender,
      ageGroup: live.ageGroup,
      hasCredential: !!live.passwordHash || !!live.pinHash,
      hasPassword: !!live.passwordHash,
      photoUrl: getMemberAvatarUrl(live) ?? undefined,
    };
  }

  async function runStateEffect(): Promise<void> {
    const s = state.value;
    if (s.kind === 'prove-loading') {
      const livePerson = liveProjectPerson(s.person);
      if (!livePerson) {
        // Member vanished from the open doc — rebuild the picker rather than proving
        // a ghost. (START re-enters person-select with fresh people.)
        const rebuilt = await buildPeople(s.familyId);
        if (rebuilt) {
          dispatch({
            type: 'START',
            familyId: s.familyId,
            familyName: s.familyName,
            people: rebuilt.people,
            source: rebuilt.source,
          });
        } else {
          dispatch({ type: 'EXIT' });
        }
        return;
      }
      const liveMember = podOpen()
        ? familyStore.members.find((m) => m.id === livePerson.id)
        : undefined;
      const methods = await resolveProveMethods({
        familyId: s.familyId,
        memberId: livePerson.id,
        podOpen: podOpen(),
        hasCredential: livePerson.hasCredential ?? null,
        hasPin: liveMember !== undefined ? !!liveMember.pinHash : null,
        hasPassword:
          liveMember !== undefined ? !!liveMember.passwordHash : (livePerson.hasPassword ?? null),
        envelopeHasPasswordWraps: envelopeHasPasswordWraps.value,
        rosterSource: s.source,
      });
      // The machine drops stale events itself, but avoid dispatching for a superseded
      // person at all (two quick picks) — check we're still loading the same person.
      const cur = state.value;
      if (cur.kind === 'prove-loading' && cur.person.id === s.person.id) {
        // The event carries the LIVE re-projection so the prove screen renders truth.
        dispatch({ type: 'METHODS_RESOLVED', methods, person: livePerson });
      }
      return;
    }
    if (s.kind === 'opening') {
      await runOpening(s.grant.memberId, s.grant.fkAvailable);
      return;
    }
    if (s.kind === 'done') {
      recoveryMode.value = false;
      opts.onSignedIn(s.destination);
      return;
    }
    if (s.kind === 'open-recovery') {
      emitOpenFetchRecovery({ reason: s.reason });
      return;
    }
    if (s.kind === 'idle') {
      pendingPassword = null;
      recoveryMode.value = false;
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

  /**
   * True when the prove screen the effect started from is still the one on screen.
   * ProveView disables its escape hatches while busy, so a mismatch here is a defect
   * (or a rogue re-entry) — refuse to dispatch a sign-in for a person the user is no
   * longer looking at, and say so loudly.
   */
  function stillProving(personId: string): boolean {
    const cur = state.value;
    const ok = cur.kind === 'prove' && cur.person.id === personId;
    if (!ok) {
      reportError({
        surface: 'login-flow',
        message: 'prove effect completed for a superseded person — result discarded',
        severity: 'warning',
        context: { action: 'stale_prove_result' },
      });
    }
    return ok;
  }

  async function onBiometric(): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      // The pending file must be staged so the native unlock's key has bytes to open.
      if (!(await ensureStaged())) return;
      const result = await biometricSignIn(s.familyId, s.person.id);
      emitProveOutcome({
        method: 'biometric',
        ok: result.ok,
        errorCode: result.ok ? undefined : result.message === null ? 'cancelled' : 'error',
        fallbackDepth: s.fallbackDepth,
      });
      if (result.ok) {
        if (!stillProving(s.person.id)) return;
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
        if (!stillProving(s.person.id)) return;
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

  /**
   * PIN prove. Two shapes, one screen:
   *  - device wrap present: the PIN unlocks the CLOSED pod (unwrap FK → stage → decrypt)
   *    or, on an open pod, signs the member in after a doc-hash verify (catching the
   *    changed-on-another-device case, which re-prompts rather than burning attempts —
   *    the wrap's old-PIN window is bounded exactly like healStaleWrappedKey's).
   *  - doc-side PIN only (open pod): verify against the doc hash, sign in, and silently
   *    enrol this device's wrap so the NEXT login can use the PIN cold.
   */
  async function onPinSubmit(pin: string): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value) return;
    const pinMethod = s.methods.find((m) => m.kind === 'pin');
    if (!pinMethod) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      const emitOutcome = (ok: boolean, errorCode?: string) =>
        emitProveOutcome({ method: 'pin', ok, errorCode, fallbackDepth: s.fallbackDepth });

      // ── Doc-side verify path (pod open) — covers both shapes when the pod is open. ──
      if (podOpen()) {
        const result = await authStore.signInWithPin(s.person.id, pin);
        if (!result.success) {
          // Device-wrap holders whose entered PIN fails the doc hash may be typing the
          // OLD pin of a changed-elsewhere PIN — surface that case's copy explicitly.
          const live = familyStore.members.find((m) => m.id === s.person.id);
          const record =
            pinMethod.hasDeviceWrap && live
              ? await import('@/services/auth/deviceUnlock').then((m) =>
                  m.getPinUnlockRecord(s.familyId, s.person.id)
                )
              : undefined;
          if (record && live?.pinVersion && record.pinVersion !== live.pinVersion) {
            proveError.value = t('pin.changedElsewhere');
          } else {
            proveError.value = result.error ?? t('pin.incorrect');
          }
          emitOutcome(false, 'wrong-pin');
          return;
        }
        // Success: heal the device side — (re-)wrap under the verified current PIN so
        // cold unlocks work and any stale-version wrap is replaced.
        const live = familyStore.members.find((m) => m.id === s.person.id);
        if (live && syncStore.familyKey) {
          await enrollPinUnlock({
            familyId: s.familyId,
            member: { id: live.id, name: live.name, pinVersion: live.pinVersion ?? 1 },
            pin,
            familyKey: syncStore.familyKey,
            keyId: syncStore.envelope?.keyId ?? '',
          });
        }
        emitOutcome(true);
        if (!stillProving(s.person.id)) return;
        dispatch({ type: 'PROVE_SUCCEEDED', grant: { memberId: s.person.id, fkAvailable: true } });
        return;
      }

      // ── Cold path: the device wrap IS the unlock. ──
      if (!pinMethod.hasDeviceWrap) return; // unreachable (probe never offers doc-only cold)

      // Stage FIRST (review F10): the #117 fail-closed keyId check needs the envelope's
      // CURRENT keyId, which only exists once the file is staged — sampling it before
      // staging left the rotation guard dead on the primary cold path.
      if (!(await ensureStaged())) {
        emitOutcome(false, 'transport');
        return; // OPEN_FAILED dispatched; grant-less recovery retries back into prove
      }
      const unlock = await unlockWithPin({
        familyId: s.familyId,
        memberId: s.person.id,
        pin,
        expectedKeyId: syncStore.pendingEncryptedFile?.envelope?.keyId,
      });
      if (!unlock.ok) {
        if (unlock.reason === 'destroyed') {
          proveError.value = t('pin.lockedOut');
          emitOutcome(false, 'destroyed');
          // The PIN method is gone from this device — re-resolve so the screen is honest.
          dispatch({ type: 'BACK' });
          dispatch({ type: 'PICK_PERSON', person: s.person });
          return;
        }
        if (unlock.reason === 'wrong-pin') {
          proveError.value = fillTemplate(t('pin.attemptsLeft'), {
            count: String(unlock.attemptsLeft ?? MAX_PIN_ATTEMPTS - 1),
          });
          emitOutcome(false, 'wrong-pin');
          return;
        }
        if (unlock.reason === 'no-record') {
          // keyId-invalidated (rotation) or vanished between render and tap — the PIN
          // method no longer exists here; re-resolve so the screen is honest.
          proveError.value = t('pin.lockedOut');
          emitOutcome(false, 'no-record');
          dispatch({ type: 'BACK' });
          dispatch({ type: 'PICK_PERSON', person: s.person });
          return;
        }
        proveError.value = t('auth.signInFailed');
        emitOutcome(false, unlock.reason);
        return;
      }

      if (syncStore.hasPendingEncryptedFile) {
        const dec = await syncStore.decryptPendingFileWithKey(unlock.familyKey);
        if (!dec.success) {
          // Review F4: do NOT destroy the wrap here. decryptPendingFileWithKey folds
          // every transient throw in its adoption pipeline (worker RPC, cache writes,
          // registry ops) into success:false — deleting the wrap on that evidence
          // silently removed a VALID credential. Rotation is already handled fail-closed
          // by the keyId check above; anything here is retryable.
          proveError.value = t('auth.signInFailed');
          emitOutcome(false, 'decrypt-failed');
          reportError({
            surface: 'login-flow',
            message: 'PIN unlock decrypt failed after a successful unwrap (wrap retained)',
            severity: 'warning',
            context: { action: 'pin_decrypt_failed' },
          });
          return;
        }
        await familyStore.loadMembers();
      }
      // Doc open now — verify the doc hash, distinguishing the two stale states
      // (review F9): no doc-side pinHash at all means the WRAP is stale (the hash never
      // reached the file) — remove it and say so; a present-but-different hash is the
      // changed-on-another-device window.
      const live = familyStore.members.find((m) => m.id === s.person.id);
      if (live && !live.pinHash) {
        await removePinUnlock(s.familyId, s.person.id);
        proveError.value = t('pin.notSet');
        emitOutcome(false, 'stale-wrap');
        dispatch({ type: 'BACK' });
        dispatch({ type: 'PICK_PERSON', person: s.person });
        return;
      }
      const result = await authStore.signInWithPin(s.person.id, pin);
      if (!result.success) {
        // Old-PIN window: the wrap opened but the doc says the PIN changed. Honest
        // re-prompt; the wrap stays (bounded trust window) until the new PIN re-wraps.
        proveError.value = t('pin.changedElsewhere');
        emitOutcome(false, 'stale-pin');
        return;
      }
      emitOutcome(true);
      if (!stillProving(s.person.id)) return;
      dispatch({ type: 'PROVE_SUCCEEDED', grant: { memberId: s.person.id, fkAvailable: true } });
    } finally {
      isBusy.value = false;
    }
  }

  /**
   * Recovery-mode PIN reset: the kit/passphrase opened the pod, identity is granted by
   * that family-level secret, and the member sets a fresh PIN in place of the forgotten
   * credentials. Only reachable when `recoveryMode` armed the prove screen.
   */
  async function onResetPin(pin: string): Promise<void> {
    const s = currentProve();
    if (!s || isBusy.value || !recoveryMode.value) return;
    proveError.value = null;
    isBusy.value = true;
    try {
      const result = await authStore.resetMemberPinViaRecovery(s.person.id, pin);
      emitProveOutcome({
        method: 'recovery-reset',
        ok: result.success,
        errorCode: result.success ? undefined : 'rejected',
        fallbackDepth: s.fallbackDepth,
      });
      if (result.success) {
        if (!stillProving(s.person.id)) return;
        dispatch({ type: 'PROVE_SUCCEEDED', grant: { memberId: s.person.id, fkAvailable: false } });
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
    pendingProveDepth = s.fallbackDepth;
    dispatch({ type: 'PASSWORD_SUBMITTED', memberId: s.person.id });
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
      // Password path: fetch → decrypt → verify identity against the doc. The password
      // is RETAINED across transport failures (a reconnect retry re-runs this branch);
      // it is cleared on success and on a wrong password.
      if (!fkAvailable && pendingPassword !== null) {
        const password = pendingPassword;
        if (!podOpen()) {
          if (!(await ensureStaged())) return; // dispatched OPEN_FAILED already (password kept)
          if (syncStore.hasPendingEncryptedFile) {
            const dec = await syncStore.decryptPendingFile(password);
            if (dec.success && dec.viaRecoveryPassphrase) {
              // Review F3: the typed secret was the FAMILY RECOVERY PASSPHRASE, not this
              // member's password — the pod is open, but possession of the passphrase
              // identifies NO ONE. Never sign the picked member in on it; return to the
              // prove screen (methods re-resolved against the now-open doc: tap-through
              // for credential-less members, PIN/password for the rest) with copy that
              // says the phrase was accepted rather than "wrong password".
              pendingPassword = null;
              await familyStore.loadMembers();
              recoveryMode.value = true;
              proveError.value = t('recovery.passphraseAcceptedProve');
              emitProveOutcome({
                method: 'password',
                ok: false,
                errorCode: 'recovery-passphrase',
                fallbackDepth: pendingProveDepth,
              });
              dispatch({ type: 'OPEN_FAILED', reason: 'wrong-password' });
              return;
            }
            if (!dec.success) {
              if (dec.corrupted) {
                // NOT a credential failure: the payload is unusable however right the
                // password is. Re-asking loops forever — route to transport recovery,
                // which carries the load-a-file escape.
                proveError.value = t('loginFlow.recoveryCorruptBody');
                emitProveOutcome({
                  method: 'password',
                  ok: false,
                  errorCode: 'corrupted',
                  fallbackDepth: pendingProveDepth,
                });
                dispatch({ type: 'OPEN_FAILED', reason: 'error' });
                return;
              }
              pendingPassword = null;
              proveError.value = dec.error ?? t('password.decryptionError');
              emitProveOutcome({
                method: 'password',
                ok: false,
                errorCode: 'wrong-password',
                fallbackDepth: pendingProveDepth,
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
          fallbackDepth: pendingProveDepth,
        });
        if (!result.success) {
          pendingPassword = null;
          proveError.value = result.error ?? t('auth.signInFailed');
          dispatch({ type: 'OPEN_FAILED', reason: 'wrong-password' });
          return;
        }
        pendingPassword = null;
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
    proveError.value = null;
    dispatch({ type: 'RECOVERY_RETRY' });
  }

  /** Drive token gone: run the shared Google reconnect, then retry the open. */
  async function onRecoveryReconnect(): Promise<void> {
    if (state.value.kind !== 'open-recovery' || isBusy.value) return;
    isBusy.value = true;
    try {
      const ok = await googleReconnect(syncStore.providerAccountEmail ?? undefined);
      // On redirect surfaces (iOS/PWA) reconnect() kicked off a FULL-PAGE navigation and
      // resolves while the page is unloading — dispatching a retry now would churn
      // against the still-dead token and pollute the firehose. The boot path re-enters
      // the flow with a fresh token on return.
      if (shouldUseRedirectAuth()) return;
      if (!ok) {
        proveError.value = reconnectError.value || t('googleDrive.reconnectFailed');
        return;
      }
      proveError.value = null;
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
      proveError.value = null;
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
    recoveryMode,
    startForFamily,
    tryCachedKeyDecrypt,
    dispatch,
    onPickPerson,
    onBiometric,
    onTapThrough,
    onPasswordSubmit,
    onPinSubmit,
    onResetPin,
    onFellBack,
    onRecoveryRetry,
    onRecoveryReconnect,
    onRecoveryGrantPermission,
  };
}
