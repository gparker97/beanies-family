/**
 * The single implementation of "a biometric/passkey unlock succeeded — now become that
 * member and get into the app".
 *
 * Two surfaces need this exact sequence: `BiometricLoginView` (pod-level, usually with a
 * file still to decrypt) and `PickBeanView` (the member picker, where the pod is normally
 * already open). Copying it would duplicate the cancel handling, the sentinel mapping,
 * the decrypt branch, the session update and the bounded sync — five things that must
 * agree, in two files that would drift.
 *
 * DESIGN NOTES, because each of these was a deliberate narrowing:
 *
 * - The outcome is the RETURN VALUE, not a shared `errorMessage` ref. Both callers
 *   already own an error surface (`errorMessage` / `formError`); a ref here would give
 *   each of them two places a message can live and force them to check both.
 * - `crossDevice` is a result VARIANT carrying its own message, not a ref. Only the
 *   pod-level view can hit it, so the picker narrows it away at the type level instead
 *   of inheriting a permanently-null ref.
 * - No route literal. Both views already emit `('signed-in', '/nook')`; where to go next
 *   is the view's contract with the router, not this orchestrator's business.
 * - `message: null` means "say nothing" — used for a user cancel, which is a deliberate
 *   gesture and not a failure. That is why the failure variant's message is nullable
 *   rather than there being a second `silent` flag.
 */
import { ref, type Ref } from 'vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { MEMBER_MISMATCH, WRONG_FAMILY_CREDENTIAL } from '@/services/auth/passkeyService';
import { reportError } from '@/utils/errorReporter';

export type BiometricSignInResult =
  | { ok: true }
  | { ok: false; message: string | null }
  | {
      ok: false;
      message: string;
      crossDevice: { memberId: string; credentialId?: string };
    };

export function useBiometricSignIn(): {
  isAuthenticating: Ref<boolean>;
  signIn: (familyId: string, memberId: string) => Promise<BiometricSignInResult>;
} {
  const authStore = useAuthStore();
  const syncStore = useSyncStore();
  const { t } = useTranslation();
  const isAuthenticating = ref(false);

  async function signIn(familyId: string, memberId: string): Promise<BiometricSignInResult> {
    isAuthenticating.value = true;
    try {
      const result = await authStore.signInWithPasskey({
        familyId,
        memberId,
        passkeySecrets: syncStore.effectivePasskeySecrets,
      });

      if (!result.success) {
        // A dismissed prompt is a choice, not a failure — exit silently so the user can
        // reach for their password without being accused of anything.
        if (result.cancelled) {
          console.warn('[passkey] authentication cancelled by user');
          return { ok: false, message: null };
        }
        if (result.error === WRONG_FAMILY_CREDENTIAL) {
          return { ok: false, message: t('passkey.wrongFamilyError') };
        }
        if (result.error === MEMBER_MISMATCH) {
          return { ok: false, message: t('passkey.wrongMemberError') };
        }
        return { ok: false, message: result.error ?? t('passkey.signInError') };
      }

      // Only decrypt when there is actually something to decrypt. Arriving here with the
      // pod ALREADY open is the whole point of #76 (the member-picker path), and calling
      // decryptPendingFileWithKey then would return 'No pending…' and render a file-load
      // error on a perfectly successful unlock.
      if (syncStore.hasPendingEncryptedFile) {
        if (!result.familyKey) {
          // Verified the member but no family key — cross-device, or no PRF and no cache.
          // Web only: native always returns the key it just unwrapped.
          return {
            ok: false,
            message: t('passkey.crossDeviceNoCache'),
            crossDevice: { memberId: result.memberId!, credentialId: result.credentialId },
          };
        }
        const fkResult = await syncStore.decryptPendingFileWithKey(result.familyKey);
        if (!fkResult.success) {
          console.warn('[useBiometricSignIn] decryptPendingFileWithKey failed:', fkResult.error);
          return {
            ok: false,
            message: fkResult.error?.includes('No pending')
              ? t('passkey.fileLoadError')
              : t('passkey.signInError'),
          };
        }
      }

      // Fills in the thin session created by signInWithPasskey AND sets the current
      // member AND stamps lastLoginAt — so there is no separate setCurrentMember call
      // to keep in step with it.
      authStore.updateSessionWithMemberData();

      // Best-effort Drive push — never hang the spinner on it. The unlock has already
      // succeeded and the doc is in memory + cache; the push rides the next auto-sync.
      // `syncNowBounded` is the single home for this bounded-and-swallowed pattern, so a
      // rejection here cannot surface as an error on an otherwise successful sign-in.
      await syncStore.syncNowBounded();

      // NOT setupAutoSync(): LoginPage.handleSignedIn is the one place auto-sync is armed
      // and the device registered, for every entry path.
      return { ok: true };
    } catch (err) {
      // Today this case sets a message and reaches nobody. A throw here is a real defect
      // (the expected failures are all handled above), so it must be reported too.
      reportError({
        surface: 'native-biometric',
        message: 'biometric sign-in threw',
        error: err,
        severity: 'warning',
        context: { action: 'sign_in', member_id_tail: memberId.slice(-8) },
      });
      return {
        ok: false,
        message: err instanceof Error ? err.message : t('passkey.signInError'),
      };
    } finally {
      isAuthenticating.value = false;
    }
  }

  return { isAuthenticating, signIn };
}
