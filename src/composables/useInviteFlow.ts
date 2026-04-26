import { ref, type Ref } from 'vue';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useTranslation } from '@/composables/useTranslation';
import { generateInviteQR } from '@/utils/qrCode';
import { shareFileWithEmail, resolveCanonicalFolderId } from '@/services/google/driveService';
import { getValidToken } from '@/services/google/googleAuth';
import { isValidEmail, isUnshareableEmail } from '@/utils/email';
import type { InviteLinkParams } from '@/services/crypto/inviteService';

export type InviteFlowErrorCode =
  | 'invalid-email'
  | 'unshareable-email'
  | 'drive-share-failed'
  | 'invalid-google-email'
  | 'link-generation-failed';

export type InviteFlowRecovery = 'retry' | 'edit-email';

export interface InviteFlowError {
  code: InviteFlowErrorCode;
  message: string;
  recovery: InviteFlowRecovery;
}

export interface InviteFlow {
  inviteLink: Ref<string>;
  inviteQrUrl: Ref<string>;
  error: Ref<InviteFlowError | null>;
  isGenerating: Ref<boolean>;
  lastSharedEmail: Ref<string | null>;
  shareDriveAccess: (email: string) => Promise<boolean>;
  /**
   * Regenerate the invite link, optionally embedding `email` as a `loginHint`
   * for Google's account chooser. Pass undefined / empty for a hint-less link
   * (used for local-provider pods where there's no Drive account to pre-fill).
   */
  regenerateLinkForEmail: (email?: string) => Promise<boolean>;
  /** Clear the current error without resetting the rest of the flow state. */
  clearError: () => void;
  reset: () => void;
}

/**
 * Single owner of invite-link state for the family pod. Wraps:
 *   1. Drive permission share (`shareFileWithEmail` for the .beanpod + parent folder)
 *   2. Token generation + caching (one envelope slot reused per recipient)
 *   3. Link rendering (with `loginHint` for the Google account chooser)
 *   4. QR generation
 *
 * Returns refs the wizard can render directly + actions that resolve to a
 * boolean success indicator (errors are surfaced via the `error` ref, not
 * thrown — the wizard reads `error` to decide what to display).
 *
 * Failure handling:
 *   - Every operation that can fail logs `[useInviteFlow] <op> failed` with
 *     full context to the console for dev diagnostics.
 *   - User-facing messages come from `inviteWizard.error.*` i18n keys.
 *   - QR generation is non-critical — if it fails, the link is still usable
 *     and the wizard's QR area shows a fallback.
 *   - Folder-share is best-effort — failure is logged warn and ignored.
 */
export function useInviteFlow(): InviteFlow {
  const syncStore = useSyncStore();
  const familyContextStore = useFamilyContextStore();
  const { t } = useTranslation();

  const inviteLink = ref('');
  const inviteQrUrl = ref('');
  const error = ref<InviteFlowError | null>(null);
  const isGenerating = ref(false);
  const lastSharedEmail = ref<string | null>(null);

  // Cache the underlying token separately from the rendered URL so we can
  // re-render with a different `inviteeEmail` hint per member without burning
  // a fresh token / consuming a new invite slot in the envelope.
  const cachedInviteToken = ref<string | null>(null);
  const cachedInviteExpiry = ref<string | null>(null);

  function currentInviteParams(): InviteLinkParams {
    const provider = syncStore.storageProviderType;
    return {
      familyId: familyContextStore.activeFamilyId ?? '',
      provider: provider === 'google_drive' || provider === 'local' ? provider : undefined,
      fileName: syncStore.fileName ?? undefined,
      fileId: syncStore.driveFileId ?? undefined,
    };
  }

  /**
   * Generate a fresh crypto invite link with a token-wrapped family key,
   * and store the package in the V4 envelope. Optionally embeds an
   * `inviteeEmail` so Google's account chooser can be pre-populated via
   * `login_hint` on the joiner side.
   *
   * Caller is responsible for try/catch — this function may throw on
   * envelope-write failure or missing family key.
   */
  async function generateFreshInviteLink(inviteeEmail?: string): Promise<string> {
    const fk = syncStore.familyKey;
    const { buildInviteLink, generateInviteToken, createInvitePackage, hashInviteToken } =
      await import('@/services/crypto/inviteService');

    if (!fk) {
      // No family key — fall back to a token-less URL (V3 or unconfigured).
      cachedInviteExpiry.value = null;
      cachedInviteToken.value = null;
      return buildInviteLink({ ...currentInviteParams(), inviteeEmail });
    }

    const token = generateInviteToken();
    const pkg = await createInvitePackage(fk, token);
    const tokenHash = await hashInviteToken(token);
    await syncStore.addInvitePackage(tokenHash, pkg);

    cachedInviteExpiry.value = pkg.expiresAt;
    cachedInviteToken.value = token;

    return buildInviteLink({ ...currentInviteParams(), token, inviteeEmail });
  }

  /**
   * Render (or regenerate) the invite link for a specific invitee email,
   * embedding it as `login_hint`. Reuses the cached token when valid to
   * avoid burning a new envelope slot per recipient.
   *
   * Always best-effort: on cache-or-generate failure, falls back to a
   * token-less URL with the email hint so the user is never left empty-handed.
   * Sets `error.value` and returns `false` on failure; returns `true` on success.
   */
  async function regenerateLinkForEmail(email?: string): Promise<boolean> {
    const hint = email?.trim() || undefined;
    const { isInviteExpired, buildInviteLink } = await import('@/services/crypto/inviteService');
    const hasCachedToken =
      cachedInviteToken.value &&
      cachedInviteExpiry.value &&
      !isInviteExpired(cachedInviteExpiry.value);

    isGenerating.value = true;
    error.value = null;
    try {
      if (hasCachedToken) {
        inviteLink.value = buildInviteLink({
          ...currentInviteParams(),
          token: cachedInviteToken.value!,
          inviteeEmail: hint,
        });
      } else {
        inviteLink.value = await generateFreshInviteLink(hint);
      }

      // QR is non-critical — if it fails the link is still usable.
      try {
        inviteQrUrl.value = await generateInviteQR(inviteLink.value);
      } catch (qrErr) {
        console.error('[useInviteFlow] QR generation failed', {
          link: inviteLink.value,
          error: qrErr,
        });
        inviteQrUrl.value = '';
      }

      return true;
    } catch (e) {
      console.error('[useInviteFlow] regenerateLinkForEmail failed', { email: hint, error: e });
      cachedInviteExpiry.value = null;
      cachedInviteToken.value = null;
      // Best-effort fallback URL so the user isn't left empty-handed.
      try {
        inviteLink.value = buildInviteLink({ ...currentInviteParams(), inviteeEmail: hint });
      } catch {
        inviteLink.value = '';
      }
      inviteQrUrl.value = '';
      error.value = {
        code: 'link-generation-failed',
        message: t('inviteWizard.error.linkGenerationFailed'),
        recovery: 'retry',
      };
      return false;
    } finally {
      isGenerating.value = false;
    }
  }

  /**
   * Share the .beanpod (and best-effort the parent folder) with the given
   * email via the Drive permissions API, then regenerate the invite link
   * with that email as the `login_hint`.
   *
   * Returns `false` and sets `error` on:
   *   - invalid email format
   *   - unshareable email (placeholder, reserved domain)
   *   - Drive API rejection (network, 403 not-a-google-account, permission denied)
   *   - link-regeneration failure
   *
   * Returns `true` on full success.
   */
  async function shareDriveAccess(email: string): Promise<boolean> {
    const trimmed = email.trim().toLowerCase();

    // Sync validations — fast path, no API call.
    if (!isValidEmail(trimmed)) {
      error.value = {
        code: 'invalid-email',
        message: t('inviteWizard.error.invalidEmail'),
        recovery: 'edit-email',
      };
      return false;
    }
    if (isUnshareableEmail(trimmed)) {
      error.value = {
        code: 'unshareable-email',
        message: t('inviteWizard.error.invalidGoogleEmail'),
        recovery: 'edit-email',
      };
      return false;
    }

    if (!syncStore.driveFileId) {
      console.error('[useInviteFlow] shareDriveAccess called with no driveFileId', {
        email: trimmed,
      });
      error.value = {
        code: 'drive-share-failed',
        message: t('inviteWizard.error.driveShareFailed'),
        recovery: 'retry',
      };
      return false;
    }

    isGenerating.value = true;
    error.value = null;

    try {
      const token = await getValidToken();

      // Share .beanpod (mandatory)
      await shareFileWithEmail(token, syncStore.driveFileId, trimmed, 'writer');

      // Best-effort: share parent folder so photos uploaded to it by any
      // member are accessible to everyone. Folder-share failure is non-fatal.
      try {
        const folderId = await resolveCanonicalFolderId(token, syncStore.driveFileId);
        if (folderId) {
          await shareFileWithEmail(token, folderId, trimmed, 'writer');
        }
      } catch (folderErr) {
        console.warn('[useInviteFlow] Folder share failed (non-fatal)', folderErr);
      }

      lastSharedEmail.value = trimmed;
      isGenerating.value = false;

      // Regenerate the link with the new login_hint baked in.
      return await regenerateLinkForEmail(trimmed);
    } catch (e) {
      console.error('[useInviteFlow] shareDriveAccess failed', { email: trimmed, error: e });
      isGenerating.value = false;

      // Distinguish Google "not a Google account" 403 from generic network
      // / API failures. The Drive API surfaces this in a few shapes.
      const msg = (e as Error).message?.toLowerCase() ?? '';
      const isInvalidGoogleEmail =
        msg.includes('not a google account') ||
        msg.includes('invitee') ||
        msg.includes('invalid email') ||
        msg.includes('invalid_email');

      error.value = {
        code: isInvalidGoogleEmail ? 'invalid-google-email' : 'drive-share-failed',
        message: t(
          isInvalidGoogleEmail
            ? 'inviteWizard.error.invalidGoogleEmail'
            : 'inviteWizard.error.driveShareFailed'
        ),
        recovery: isInvalidGoogleEmail ? 'edit-email' : 'retry',
      };
      return false;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  function reset(): void {
    inviteLink.value = '';
    inviteQrUrl.value = '';
    error.value = null;
    isGenerating.value = false;
    lastSharedEmail.value = null;
    // Note: do NOT clear cachedInviteToken / cachedInviteExpiry — they're
    // still valid across modal sessions. Token slots are precious.
  }

  return {
    inviteLink,
    inviteQrUrl,
    error,
    isGenerating,
    lastSharedEmail,
    shareDriveAccess,
    regenerateLinkForEmail,
    clearError,
    reset,
  };
}
