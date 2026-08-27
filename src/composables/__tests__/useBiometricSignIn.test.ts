import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// --- Mocks (must precede the import under test) ---
const { authMocks, syncMocks, reportErrorMock } = vi.hoisted(() => ({
  authMocks: {
    signInWithPasskey: vi.fn(),
    updateSessionWithMemberData: vi.fn(),
  },
  syncMocks: {
    hasPendingEncryptedFile: false,
    effectivePasskeySecrets: undefined as unknown,
    decryptPendingFileWithKey: vi.fn(async () => ({ success: true })),
    syncNowBounded: vi.fn(async () => true),
  },
  reportErrorMock: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({ useAuthStore: () => authMocks }));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncMocks }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/composables/useTranslation', () => ({
  // Return the key so assertions name the string rather than its English text.
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { useBiometricSignIn } from '../useBiometricSignIn';
import { MEMBER_MISMATCH, WRONG_FAMILY_CREDENTIAL } from '@/services/auth/biometricShared';

const FAMILY = 'family-1';
const MEMBER = 'member-1';

describe('useBiometricSignIn — the one shared "biometric succeeded, now become this member" tail', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    syncMocks.hasPendingEncryptedFile = false;
    syncMocks.decryptPendingFileWithKey.mockResolvedValue({ success: true });
    syncMocks.syncNowBounded.mockResolvedValue(true);
  });

  it('passes the MEMBER through to the auth store — the whole point of #76', async () => {
    // Without this, dropping `memberId` from the call would leave all the other tests
    // green while per-member sign-in silently reverted to family-level.
    authMocks.signInWithPasskey.mockResolvedValue({ success: true, memberId: MEMBER });
    const { signIn } = useBiometricSignIn();

    await signIn(FAMILY, MEMBER);

    expect(authMocks.signInWithPasskey).toHaveBeenCalledWith({
      familyId: FAMILY,
      memberId: MEMBER,
      passkeySecrets: undefined,
    });
  });

  it('a cancelled prompt is SILENT — a dismissal is a choice, not a failure', async () => {
    authMocks.signInWithPasskey.mockResolvedValue({ success: false, cancelled: true });
    const { signIn } = useBiometricSignIn();

    const result = await signIn(FAMILY, MEMBER);

    expect(result.ok).toBe(false);
    // `null` is how "say nothing" is expressed — the caller renders no banner.
    expect((result as { message: string | null }).message).toBeNull();
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('maps WRONG_FAMILY_CREDENTIAL and MEMBER_MISMATCH to their own copy', async () => {
    const { signIn } = useBiometricSignIn();

    authMocks.signInWithPasskey.mockResolvedValue({
      success: false,
      error: WRONG_FAMILY_CREDENTIAL,
    });
    expect(await signIn(FAMILY, MEMBER)).toEqual({
      ok: false,
      message: 'passkey.wrongFamilyError',
    });

    authMocks.signInWithPasskey.mockResolvedValue({ success: false, error: MEMBER_MISMATCH });
    expect(await signIn(FAMILY, MEMBER)).toEqual({
      ok: false,
      // NOT the re-enrol copy: this bean simply has no key here.
      message: 'passkey.wrongMemberError',
    });
  });

  it('skips decryption entirely when the pod is already open (the #76 path)', async () => {
    syncMocks.hasPendingEncryptedFile = false;
    authMocks.signInWithPasskey.mockResolvedValue({ success: true, memberId: MEMBER });
    const { signIn } = useBiometricSignIn();

    const result = await signIn(FAMILY, MEMBER);

    expect(result.ok).toBe(true);
    // Calling it here would return 'No pending…' and render a file-load error on a
    // perfectly successful unlock — the bug this branch exists to prevent.
    expect(syncMocks.decryptPendingFileWithKey).not.toHaveBeenCalled();
    expect(authMocks.updateSessionWithMemberData).toHaveBeenCalled();
  });

  it('decrypts when a file IS pending', async () => {
    syncMocks.hasPendingEncryptedFile = true;
    const familyKey = {} as CryptoKey;
    authMocks.signInWithPasskey.mockResolvedValue({ success: true, memberId: MEMBER, familyKey });
    const { signIn } = useBiometricSignIn();

    expect(await signIn(FAMILY, MEMBER)).toEqual({ ok: true });
    expect(syncMocks.decryptPendingFileWithKey).toHaveBeenCalledWith(familyKey);
  });

  it('returns the crossDevice variant WITH its message when a file is pending but no key came back', async () => {
    syncMocks.hasPendingEncryptedFile = true;
    authMocks.signInWithPasskey.mockResolvedValue({
      success: true,
      memberId: MEMBER,
      credentialId: 'cred-1',
    });
    const { signIn } = useBiometricSignIn();

    const result = await signIn(FAMILY, MEMBER);

    // The variant carries its own copy so every non-ok outcome has one source of message.
    expect(result).toEqual({
      ok: false,
      message: 'passkey.crossDeviceNoCache',
      crossDevice: { memberId: MEMBER, credentialId: 'cred-1' },
    });
  });

  it('maps a "No pending" decrypt failure to the file-load message', async () => {
    syncMocks.hasPendingEncryptedFile = true;
    authMocks.signInWithPasskey.mockResolvedValue({
      success: true,
      memberId: MEMBER,
      familyKey: {} as CryptoKey,
    });
    syncMocks.decryptPendingFileWithKey.mockResolvedValue({
      success: false,
      error: 'No pending encrypted file',
    } as never);
    const { signIn } = useBiometricSignIn();

    expect(await signIn(FAMILY, MEMBER)).toEqual({
      ok: false,
      message: 'passkey.fileLoadError',
    });
  });

  it('a sync failure does NOT surface an error on an otherwise successful sign-in', async () => {
    authMocks.signInWithPasskey.mockResolvedValue({ success: true, memberId: MEMBER });
    // syncNowBounded owns the bounded-and-swallowed contract; it resolves false rather
    // than rejecting. The unlock has already succeeded and the push rides the next sync.
    syncMocks.syncNowBounded.mockResolvedValue(false);
    const { signIn } = useBiometricSignIn();

    expect(await signIn(FAMILY, MEMBER)).toEqual({ ok: true });
  });

  it('an unexpected throw is REPORTED as well as returned', async () => {
    authMocks.signInWithPasskey.mockRejectedValue(new Error('boom'));
    const { signIn } = useBiometricSignIn();

    const result = await signIn(FAMILY, MEMBER);

    expect(result).toEqual({ ok: false, message: 'boom' });
    // Previously this only set a message, so a genuine crash reached nobody.
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'native-biometric', severity: 'warning' })
    );
  });

  it('clears the spinner on every exit path', async () => {
    authMocks.signInWithPasskey.mockRejectedValue(new Error('boom'));
    const { isAuthenticating, signIn } = useBiometricSignIn();

    await signIn(FAMILY, MEMBER);

    expect(isAuthenticating.value).toBe(false);
  });
});
