/**
 * useJoinFlow — owns the joiner-side state machine.
 *
 * `JoinPodView.vue` binds to this composable and renders. All async work
 * (registry lookup, OAuth, Drive read, decrypt, member selection, join
 * commit) routes through `tryStep` so every failure has a structured
 * `JoinErrorCode` with a single source of truth in `JOIN_ERRORS`.
 *
 * MVO note: the composable is the orchestrator; the view binds reactive
 * state and emits user intents (`handleAuthTap`, `handleSelectMember`,
 * `handleSubmitPassword`, etc.). Stores and services are imported at
 * module scope so tests can `vi.mock` them — no DI plumbing.
 */

import { ref, computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useSyncStore } from '@/stores/syncStore';
import { lookupFamily, isRegistryConfigured } from '@/services/registry/registryService';
import {
  parseInviteLink,
  hashInviteToken,
  redeemInviteToken,
  isInviteExpired,
  buildInviteLink,
} from '@/services/crypto/inviteService';
import {
  completeRedirectAuth,
  tryGetSilentToken,
  shouldUseRedirectAuth,
  getGoogleAccountEmail,
} from '@/services/google/googleAuth';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { getDeviceInfo, tail } from '@/utils/diagnostics';
import { reportError } from '@/utils/errorReporter';
import type { FamilyMember, RegistryEntry } from '@/types/models';

// ─── State machine + error registry ──────────────────────────────────────────

export type JoinStep =
  | 'lookup' // parsing URL, registry lookup, post-redirect-auth probe
  | 'awaiting-auth' // user must tap "Choose your data file"
  | 'authenticating' // OAuth in flight (popup or redirect)
  | 'loading' // file fetch / Picker / decrypt / familyId validate
  | 'pick-member' // unclaimed-member grid
  | 'set-password' // password form
  | 'joining'; // final commit

export type JoinErrorCode =
  | 'OAUTH_REDIRECT_FAILED'
  | 'OAUTH_SCOPE_DENIED'
  | 'OAUTH_POPUP_BLOCKED'
  | 'PICKER_SCRIPT_LOAD_FAILED'
  | 'PICKER_FAILED'
  | 'PICKER_TIMEOUT'
  | 'FILE_READ_FAILED'
  | 'FILE_DECRYPT_FAILED'
  | 'FILE_FAMILY_MISMATCH'
  | 'INVITE_TOKEN_EXPIRED'
  | 'INVITE_TOKEN_INVALID'
  | 'NO_UNCLAIMED_MEMBERS';

export type RecoveryAction =
  | 'retry'
  | 'signInDifferentAccount'
  | 'tryAnotherDevice'
  | 'pickDifferentBean'
  | 'askForNewInvite';

export interface JoinErrorEntry {
  messageKey: string;
  recoveries: readonly RecoveryAction[];
  severity: 'warning' | 'critical';
}

export interface JoinError {
  code: JoinErrorCode;
  context?: Record<string, unknown>;
}

/**
 * Single source of truth for join-flow errors. Every code maps to one
 * i18n message key + an ordered list of recovery actions (rendered as
 * buttons) + a severity. Adding a new `JoinErrorCode` to the union and
 * forgetting to add a registry entry fails the build (`as const
 * satisfies` enforces exhaustiveness).
 */
export const JOIN_ERRORS = {
  OAUTH_REDIRECT_FAILED: {
    messageKey: 'join.error.oauthRedirect',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  OAUTH_SCOPE_DENIED: {
    messageKey: 'join.error.scopeDenied',
    recoveries: ['retry'],
    severity: 'critical',
  },
  OAUTH_POPUP_BLOCKED: {
    messageKey: 'join.error.popupBlocked',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_SCRIPT_LOAD_FAILED: {
    messageKey: 'join.error.pickerScript',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_FAILED: {
    messageKey: 'join.error.pickerFailed',
    recoveries: ['retry', 'signInDifferentAccount', 'tryAnotherDevice'],
    severity: 'critical',
  },
  PICKER_TIMEOUT: {
    messageKey: 'join.error.pickerTimeout',
    recoveries: ['retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_READ_FAILED: {
    messageKey: 'join.error.fileRead',
    recoveries: ['signInDifferentAccount', 'retry', 'tryAnotherDevice'],
    severity: 'critical',
  },
  FILE_DECRYPT_FAILED: {
    messageKey: 'join.error.fileDecrypt',
    recoveries: ['askForNewInvite'],
    severity: 'critical',
  },
  FILE_FAMILY_MISMATCH: {
    messageKey: 'join.error.familyMismatch',
    recoveries: ['signInDifferentAccount', 'askForNewInvite'],
    severity: 'critical',
  },
  INVITE_TOKEN_EXPIRED: {
    messageKey: 'join.error.tokenExpired',
    recoveries: ['retry', 'askForNewInvite'],
    severity: 'critical',
  },
  INVITE_TOKEN_INVALID: {
    // Most common cause is a stale Drive read — the inviter just generated
    // the link, but the iPhone read a CDN-cached version of the .beanpod
    // from before the new inviteKey was persisted. `retry` re-runs the
    // load, which typically picks up the freshest version.
    messageKey: 'join.error.tokenInvalid',
    recoveries: ['retry', 'askForNewInvite'],
    severity: 'critical',
  },
  NO_UNCLAIMED_MEMBERS: {
    messageKey: 'join.error.noUnclaimed',
    recoveries: ['askForNewInvite'],
    severity: 'warning',
  },
} as const satisfies Record<JoinErrorCode, JoinErrorEntry>;

const log = (msg: string, ctx?: Record<string, unknown>): void => {
  console.warn(`[useJoinFlow] ${msg}`, ctx ?? {});
};

// ─── Composable ──────────────────────────────────────────────────────────────

export function useJoinFlow() {
  const route = useRoute();
  const authStore = useAuthStore();
  const familyStore = useFamilyStore();
  const familyContextStore = useFamilyContextStore();
  const syncStore = useSyncStore();
  const { pick: pickBeanpod } = usePickBeanpodFile();

  // ─── State ────────────────────────────────────────────────────────────────

  const currentStep = ref<JoinStep>('lookup');
  const currentError = ref<JoinError | null>(null);

  // Parsed from URL on mount.
  const targetFamilyId = ref('');
  const targetProvider = ref<'google_drive' | 'local'>('local');
  const targetFileId = ref('');
  const targetFileName = ref('');
  const inviteToken = ref('');
  const inviteEmailHint = ref<string | null>(null);

  // Discovered during the flow.
  const registryEntry = ref<RegistryEntry | null>(null);
  const selectedMember = ref<FamilyMember | null>(null);

  // Tracks the last failed step so `handleRetry` knows what to re-fire.
  let lastFailedAction: (() => Promise<void>) | null = null;

  // ─── Computed ─────────────────────────────────────────────────────────────

  const expectedFileName = computed(() => {
    if (registryEntry.value?.displayPath) return registryEntry.value.displayPath;
    return targetFileName.value || null;
  });

  const unclaimedMembers = computed(() =>
    familyStore.members.filter((m) => m.requiresPassword && !m.isPet)
  );

  const currentInviteUrl = computed(() => {
    if (!targetFamilyId.value) return '';
    return buildInviteLink({
      familyId: targetFamilyId.value,
      token: inviteToken.value || undefined,
      provider: targetProvider.value,
      fileName: targetFileName.value || undefined,
      fileId: targetFileId.value || undefined,
      inviteeEmail: inviteEmailHint.value || undefined,
    });
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Run an async step with structured error handling. On throw: log,
   * set `currentError` with the given code, return null. On success:
   * return the value. Never throws to callers.
   */
  async function tryStep<T>(
    code: JoinErrorCode,
    fn: () => Promise<T>,
    contextExtra?: Record<string, unknown>
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`step ${code} failed`, { err: message });
      currentError.value = {
        code,
        context: { error: message, ...contextExtra },
      };
      // Auto-notify support — the join flow shows its own structured error
      // UI to the user, so we don't double-surface here. Just fire the
      // Slack message with the registry code as the surface so we can
      // group onboarding failures by error code in #beanies-errors.
      reportError({
        surface: `join-flow:${code}`,
        message: message || code,
        error: err,
        context: { error_code: code },
      });
      return null;
    }
  }

  function buildDiagnosticReport(): string {
    // Capture inviteKey hash prefixes from the loaded (or pending) envelope
    // so debugging can correlate the URL token's hash against what's
    // actually in the file. Hashes are non-secret (storage keys derived
    // via SHA-256), but we truncate anyway for log readability.
    const envelopeWithKeys = syncStore.envelope ?? syncStore.pendingEncryptedFile?.envelope ?? null;
    const inviteKeyHashes = envelopeWithKeys?.inviteKeys
      ? Object.keys(envelopeWithKeys.inviteKeys).map((h) => `${h.slice(0, 8)}…`)
      : [];

    return JSON.stringify(
      {
        device: getDeviceInfo(),
        step: currentStep.value,
        error: currentError.value,
        url: {
          familyId: targetFamilyId.value || null,
          provider: targetProvider.value,
          fileIdTail: tail(targetFileId.value),
          fileName: targetFileName.value || null,
          inviteTokenTail: tail(inviteToken.value),
          inviteEmailHint: inviteEmailHint.value,
        },
        registry: {
          familyName: registryEntry.value?.familyName ?? null,
          provider: registryEntry.value?.provider ?? null,
        },
        envelope: {
          familyIdMatchesUrl:
            envelopeWithKeys?.familyId && targetFamilyId.value
              ? envelopeWithKeys.familyId === targetFamilyId.value
              : null,
          inviteKeyCount: inviteKeyHashes.length,
          inviteKeyHashes,
        },
        redirectAuth: shouldUseRedirectAuth(),
        googleEmail: getGoogleAccountEmail(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  function clearError(): void {
    currentError.value = null;
  }

  // ─── Step orchestration ───────────────────────────────────────────────────

  /** Read URL params into reactive state. */
  function parseUrl(): void {
    const url = `${window.location.origin}${route.fullPath}`;
    const parsed = parseInviteLink(url);
    if (!parsed) return;
    targetFamilyId.value = parsed.familyId;
    targetProvider.value = parsed.provider ?? 'local';
    targetFileName.value = parsed.fileName ?? '';
    targetFileId.value = parsed.fileId ?? '';
    inviteToken.value = parsed.token ?? '';
    inviteEmailHint.value = parsed.inviteeEmail ?? null;
  }

  /**
   * If we're returning from a full-page redirect-auth, complete the
   * exchange so subsequent silent-token calls find a cached token.
   * Errors here mean the redirect round-trip failed cleanly — we surface
   * `OAUTH_REDIRECT_FAILED` and let the user retry. No-op if there's no
   * pending redirect to consume.
   */
  async function consumePendingRedirectAuth(): Promise<void> {
    await tryStep('OAUTH_REDIRECT_FAILED', () => completeRedirectAuth());
  }

  /**
   * Look up the family in the registry. Failures here aren't fatal —
   * the user can still proceed with the URL params we already have.
   * Logs but does not set `currentError`.
   */
  async function performLookup(): Promise<void> {
    if (!targetFamilyId.value) return;
    if (!isRegistryConfigured()) return;
    try {
      const entry = await lookupFamily(targetFamilyId.value);
      registryEntry.value = entry;
      if (entry?.provider) {
        const provider = entry.provider;
        if (provider === 'google_drive' || provider === 'local') {
          targetProvider.value = provider;
        }
      }
    } catch (err) {
      // Registry being offline is acceptable — log and continue with
      // whatever the URL provided. The cloud-load step will fail with
      // a more specific code if applicable.
      log('registry lookup failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Try a silent direct read by fileId. Returns 'loaded' on success,
   * 'needs-pick' on a 404/403 / "File not found" symptom (drive.file
   * scope hasn't granted API-level access yet — Picker is the recovery
   * path), or 'auth' if no silent token is available. Errors set
   * `FILE_READ_FAILED`.
   */
  async function tryAutoLoadByFileId(): Promise<'loaded' | 'needs-pick' | 'auth' | 'error'> {
    if (targetProvider.value !== 'google_drive' || !targetFileId.value) {
      return 'auth';
    }
    const silent = await tryGetSilentToken();
    if (!silent) return 'auth';

    const fileName = expectedFileName.value || 'family.beanpod';
    const result = await syncStore.loadFromGoogleDrive(targetFileId.value, fileName);

    if (result.success) {
      return 'loaded';
    }

    if (result.needsPassword) {
      // File read OK, just needs decryption — handled downstream.
      return 'loaded';
    }

    const storeError = (syncStore.error as string | null) ?? '';
    const looksLikeMissingAccess =
      storeError.includes('File not found') ||
      storeError.includes('not found') ||
      storeError.includes('404') ||
      storeError.includes('403');

    if (looksLikeMissingAccess) return 'needs-pick';

    // Some other error — surface it.
    currentError.value = {
      code: 'FILE_READ_FAILED',
      context: {
        error: storeError || 'Unknown file-load error',
        hintEmail: inviteEmailHint.value,
        actualEmail: getGoogleAccountEmail(),
      },
    };
    return 'error';
  }

  /**
   * Open the Picker, read the picked file. Returns `true` only when the
   * file was picked AND loaded into `syncStore.pendingEncryptedFile`.
   * Returns `false` for any non-progressing outcome — caller decides
   * whether to advance or bail.
   *
   * Maps the `PickBeanpodFileResult` discriminated union to the right
   * `JoinErrorCode`: `failed/script` → PICKER_SCRIPT_LOAD_FAILED,
   * `failed/iframe` → PICKER_FAILED, `failed/timeout` → PICKER_TIMEOUT.
   * `cancelled` is silent (no error; step regresses to `awaiting-auth`).
   */
  async function doPickAndLoad(forceConsent = false): Promise<boolean> {
    const picked = await pickBeanpod({
      forceConsent,
      loginHint: inviteEmailHint.value ?? undefined,
    });

    if (picked.kind === 'cancelled') {
      currentStep.value = 'awaiting-auth';
      return false;
    }

    if (picked.kind === 'failed') {
      const code: JoinErrorCode =
        picked.reason === 'script'
          ? 'PICKER_SCRIPT_LOAD_FAILED'
          : picked.reason === 'timeout'
            ? 'PICKER_TIMEOUT'
            : 'PICKER_FAILED';
      currentError.value = { code, context: { reason: picked.reason } };
      return false;
    }

    targetFileId.value = picked.fileId;
    targetFileName.value = picked.fileName;

    const fileName = expectedFileName.value || picked.fileName;
    const result = await syncStore.loadFromGoogleDrive(picked.fileId, fileName);

    if (!result.success && !result.needsPassword) {
      const storeError = (syncStore.error as string | null) ?? '';
      currentError.value = {
        code: 'FILE_READ_FAILED',
        context: {
          error: storeError || 'Picked file could not be loaded',
          hintEmail: inviteEmailHint.value,
          actualEmail: getGoogleAccountEmail(),
        },
      };
      return false;
    }
    return true;
  }

  /**
   * Try to decrypt the pending V4 file using the cached invite token.
   * Returns true if decryption succeeded; false if a password modal is
   * needed instead (no invite token, or the token isn't recognized).
   * Sets `INVITE_TOKEN_EXPIRED` / `INVITE_TOKEN_INVALID` /
   * `FILE_DECRYPT_FAILED` as appropriate.
   */
  async function tryInviteTokenDecrypt(): Promise<boolean> {
    if (!inviteToken.value) return false;
    const pending = syncStore.pendingEncryptedFile;
    if (!pending?.envelope?.inviteKeys) return false;

    const tokenHash = await hashInviteToken(inviteToken.value);
    const pkg = pending.envelope.inviteKeys[tokenHash];

    if (!pkg) {
      currentError.value = { code: 'INVITE_TOKEN_INVALID' };
      return false;
    }
    if (isInviteExpired(pkg.expiresAt)) {
      currentError.value = { code: 'INVITE_TOKEN_EXPIRED' };
      return false;
    }

    const decrypted = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const fk = await redeemInviteToken(pkg.wrapped, pkg.salt, inviteToken.value);
      const result = await syncStore.decryptPendingFileWithKey(fk);
      if (!result.success) throw new Error(result.error ?? 'Decryption failed');
      return true;
    });

    return decrypted ?? false;
  }

  /**
   * Validate the loaded file's familyId, then move into member-pick.
   * Handles `FILE_FAMILY_MISMATCH` and `NO_UNCLAIMED_MEMBERS`.
   */
  function advanceAfterFileLoaded(): void {
    const loadedFamilyId =
      syncStore.envelope?.familyId ?? familyContextStore.activeFamilyId ?? null;
    if (targetFamilyId.value && loadedFamilyId && loadedFamilyId !== targetFamilyId.value) {
      currentError.value = {
        code: 'FILE_FAMILY_MISMATCH',
        context: { expected: targetFamilyId.value, actual: loadedFamilyId },
      };
      return;
    }

    if (unclaimedMembers.value.length === 0) {
      currentError.value = { code: 'NO_UNCLAIMED_MEMBERS' };
      return;
    }

    clearError();
    currentStep.value = 'pick-member';
  }

  /**
   * The full cloud join sequence, kicked off either from `init()` (when
   * a silent token is already available) or from `handleAuthTap()` (when
   * the user explicitly taps the CTA).
   */
  async function runCloudFlow(triggeredByGesture: boolean): Promise<void> {
    currentStep.value = 'loading';

    // 1. Try silent direct-load by fileId, if applicable.
    const autoResult = await tryAutoLoadByFileId();

    if (autoResult === 'loaded') {
      // File read OK — try invite-token decrypt.
      if (syncStore.pendingEncryptedFile && inviteToken.value) {
        const ok = await tryInviteTokenDecrypt();
        if (!ok && !currentError.value) {
          // No invite token, or token didn't match: caller should show
          // the password modal. Step stays as 'loading' until the view
          // shows the modal; once the user decrypts via password, the
          // view calls the password-submit handler (below) which advances.
          currentStep.value = 'loading'; // unchanged but explicit
          return;
        }
        if (!ok) return; // error already set
        advanceAfterFileLoaded();
        return;
      }
      // Already decrypted (no pending) — just advance.
      advanceAfterFileLoaded();
      return;
    }

    if (autoResult === 'error') return; // FILE_READ_FAILED already set

    // 'auth' or 'needs-pick' — both require an interactive Picker tap.
    if (!triggeredByGesture) {
      // We were called from init() without a user gesture (e.g. fresh
      // load on a redirect-auth-completed session). Defer to the user's
      // explicit CTA tap so popups aren't blocked.
      currentStep.value = 'awaiting-auth';
      return;
    }

    currentStep.value = 'authenticating';
    const picked = await doPickAndLoad();
    if (!picked) return; // cancel, redirect, or file-read-error — no advance

    // File loaded; reflect that in the step before any decrypt-stage
    // failures fire. Without this update, INVITE_TOKEN_INVALID would
    // appear in the diagnostic blob with step='authenticating', which
    // is misleading — the auth + file read succeeded, only the
    // invite-key match failed.
    currentStep.value = 'loading';

    if (syncStore.pendingEncryptedFile && inviteToken.value) {
      const ok = await tryInviteTokenDecrypt();
      if (!ok) return; // either error set or password modal needed
    }

    advanceAfterFileLoaded();
  }

  // ─── Intent handlers (called by view) ─────────────────────────────────────

  /** Primary CTA: "Choose your data file". */
  async function handleAuthTap(): Promise<void> {
    clearError();
    lastFailedAction = handleAuthTap;
    if (targetProvider.value !== 'google_drive') {
      // Local provider — view shows drop zone; nothing to do here.
      return;
    }
    await runCloudFlow(true);
  }

  /** "Sign in with a different Google account" recovery. */
  async function handleSignInDifferent(): Promise<void> {
    clearError();
    lastFailedAction = handleSignInDifferent;
    currentStep.value = 'authenticating';
    const picked = await doPickAndLoad(/* forceConsent */ true);
    if (!picked) return;
    currentStep.value = 'loading';
    if (syncStore.pendingEncryptedFile && inviteToken.value) {
      const ok = await tryInviteTokenDecrypt();
      if (!ok) return;
    }
    advanceAfterFileLoaded();
  }

  /** Re-fire whichever step set the last error. */
  async function handleRetry(): Promise<void> {
    if (lastFailedAction) {
      const action = lastFailedAction;
      clearError();
      await action();
    }
  }

  /** Submit the decrypt-modal password (used when no invite token). */
  async function handleSubmitDecryptPassword(password: string): Promise<boolean> {
    const ok = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const result = await syncStore.decryptPendingFile(password);
      if (!result.success) throw new Error(result.error ?? 'Decryption failed');
      return true;
    });
    if (!ok) return false;
    advanceAfterFileLoaded();
    return true;
  }

  /** User picks a bean to claim. */
  function handleSelectMember(member: FamilyMember): void {
    selectedMember.value = member;
    clearError();
    currentStep.value = 'set-password';
  }

  /** Final commit: set the member's password and join. Returns true on success. */
  async function handleSubmitPassword(password: string): Promise<boolean> {
    if (!selectedMember.value) return false;
    currentStep.value = 'joining';
    const ok = await tryStep('FILE_DECRYPT_FAILED', async () => {
      const result = await authStore.joinFamily({
        memberId: selectedMember.value!.id,
        password,
        familyId: familyContextStore.activeFamilyId ?? targetFamilyId.value,
      });
      if (!result.success) throw new Error(result.error ?? 'Join failed');
      // Wrap the family key with the member's password so they can
      // decrypt from any browser/device on subsequent visits.
      await syncStore.wrapFamilyKeyForMember(selectedMember.value!.id, password);
      // Persist password hash + wrapped key to the file before handing off.
      await syncStore.syncNow(true);
      return true;
    });
    if (!ok) {
      // Step regresses so the user can retry from the same form.
      currentStep.value = 'set-password';
      return false;
    }
    return true;
  }

  // ─── View-side modal toggle for the "Continue on another device" recovery ──
  const showShareFallback = ref(false);
  function handleTryAnotherDevice(): void {
    showShareFallback.value = true;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init(): Promise<void> {
    parseUrl();
    if (!targetFamilyId.value) {
      // No URL params — view shows the "how to join" instructions.
      currentStep.value = 'awaiting-auth';
      return;
    }
    await consumePendingRedirectAuth();
    await performLookup();

    if (targetProvider.value === 'google_drive') {
      // Try a silent auto-load; if it can't, defer to user gesture.
      await runCloudFlow(false);
    } else {
      // Local provider — wait for drop-zone interaction.
      currentStep.value = 'awaiting-auth';
    }
  }

  return {
    // init (called from the view's onMounted)
    init,
    // state
    currentStep,
    currentError,
    targetFamilyId,
    targetProvider,
    targetFileId,
    targetFileName,
    inviteToken,
    inviteEmailHint,
    registryEntry,
    selectedMember,
    showShareFallback,
    // computed
    expectedFileName,
    unclaimedMembers,
    currentInviteUrl,
    // actions
    handleAuthTap,
    handleSignInDifferent,
    handleRetry,
    handleSubmitDecryptPassword,
    handleSelectMember,
    handleSubmitPassword,
    handleTryAnotherDevice,
    clearError,
    // diagnostics
    buildDiagnosticReport,
  };
}
