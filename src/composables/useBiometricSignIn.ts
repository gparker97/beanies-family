/**
 * The single implementation of "a biometric/passkey unlock succeeded — now become that
 * member and get into the app".
 *
 * The login-flow driver (`useLoginFlow`) is its one consumer since the 2026-08-28
 * rethink — the biometric prove method terminates here whichever surface offered it.
 * Keeping it a separate composable preserves the five agreeing steps (cancel handling,
 * sentinel mapping, decrypt branch, session update, bounded sync) as one unit.
 *
 * DESIGN NOTES, because each of these was a deliberate narrowing:
 *
 * - The outcome is the RETURN VALUE, not a shared `errorMessage` ref. Both callers
 *   already own an error surface (`errorMessage` / `formError`); a ref here would give
 *   each of them two places a message can live and force them to check both.
 * - Phase 4: the `crossDevice` variant is GONE with the web PRF path — biometric is
 *   native-only, and native always returns the key it just unwrapped.
 * - No route literal. Both views already emit `('signed-in', '/nook')`; where to go next
 *   is the view's contract with the router, not this orchestrator's business.
 * - `message: null` means "say nothing" — used for a user cancel, which is a deliberate
 *   gesture and not a failure. That is why the failure variant's message is nullable
 *   rather than there being a second `silent` flag.
 */
import { ref, type Ref } from 'vue';
import { payloadErrorMessageKey } from '@/types/sync';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useTranslation } from '@/composables/useTranslation';
import { MEMBER_MISMATCH, WRONG_FAMILY_CREDENTIAL } from '@/services/auth/passkeyService';
import { reportError } from '@/utils/errorReporter';

export type BiometricSignInResult = { ok: true } | { ok: false; message: string | null };

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
          // Native always returns the key it just unwrapped, so this is defensive:
          // report loudly rather than silently drop into a dead state.
          reportError({
            surface: 'native-biometric',
            message: 'biometric unlock succeeded but returned no family key',
            severity: 'warning',
            context: { action: 'sign_in', member_id_tail: memberId.slice(-8) },
          });
          return { ok: false, message: t('passkey.signInError') };
        }
        const fkResult = await syncStore.decryptPendingFileWithKey(result.familyKey);
        if (!fkResult.success) {
          console.warn('[useBiometricSignIn] decryptPendingFileWithKey failed:', fkResult.error);
          return {
            ok: false,
            // A payload failure is NOT a bad fingerprint. The biometric unwrap
            // already succeeded and returned a valid family key, so
            // `passkey.signInError` reads as "your face/finger didn't work" and
            // the user re-scans forever.
            message: fkResult.payloadError
              ? t(payloadErrorMessageKey(fkResult.payloadError))
              : fkResult.error?.includes('No pending')
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
