import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockRoute = { fullPath: '/' };
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

const mockAuthStore = {
  joinFamily: vi.fn(async () => ({ success: true })),
};
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => mockAuthStore,
}));

const familyMembers: Array<{
  id: string;
  requiresPassword: boolean;
  isPet: boolean;
  name?: string;
  email?: string;
}> = [];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get members() {
      return familyMembers;
    },
  }),
}));

const familyContextStore = {
  activeFamilyId: null as string | null,
};
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => familyContextStore,
}));

const mockSyncStore = {
  loadFromGoogleDrive: vi.fn(async () => ({ success: true })),
  decryptPendingFile: vi.fn(async () => ({ success: true })),
  decryptPendingFileWithKey: vi.fn(async () => ({ success: true })),
  wrapFamilyKeyForMember: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  pendingEncryptedFile: null as { envelope?: { inviteKeys?: Record<string, unknown> } } | null,
  envelope: null as { familyId?: string } | null,
  error: null as string | null,
};
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => mockSyncStore,
}));

const mockRegistry = {
  isConfigured: true,
  entry: null as { provider?: string; displayPath?: string; familyName?: string } | null,
};
vi.mock('@/services/registry/registryService', () => ({
  isRegistryConfigured: () => mockRegistry.isConfigured,
  lookupFamily: vi.fn(async () => mockRegistry.entry),
}));

const mockInvite = {
  hash: vi.fn(async (token: string) => `hash:${token}`),
  redeem: vi.fn(async () => 'family-key'),
  expired: vi.fn(() => false),
};
vi.mock('@/services/crypto/inviteService', async () => {
  const actual = await vi.importActual<typeof import('@/services/crypto/inviteService')>(
    '@/services/crypto/inviteService'
  );
  return {
    ...actual,
    hashInviteToken: (token: string) => mockInvite.hash(token),
    redeemInviteToken: () => mockInvite.redeem(),
    isInviteExpired: () => mockInvite.expired(),
  };
});

const mockGoogleAuth = {
  completeRedirect: vi.fn(async () => null),
  silent: vi.fn(async () => null as string | null),
  email: 'actual@example.com' as string | null,
  redirectAuth: false,
};
vi.mock('@/services/google/googleAuth', () => ({
  completeRedirectAuth: () => mockGoogleAuth.completeRedirect(),
  tryGetSilentToken: () => mockGoogleAuth.silent(),
  getGoogleAccountEmail: () => mockGoogleAuth.email,
  shouldUseRedirectAuth: () => mockGoogleAuth.redirectAuth,
}));

type PickResult =
  | { kind: 'picked'; fileId: string; fileName: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: 'script' | 'iframe' | 'timeout' };
type PickOpts = { forceConsent?: boolean; loginHint?: string } | undefined;
const mockPick = vi.fn<(opts?: PickOpts) => Promise<PickResult>>(async () => ({
  kind: 'cancelled',
}));
vi.mock('@/composables/usePickBeanpodFile', () => ({
  usePickBeanpodFile: () => ({
    isPicking: { value: false },
    pickError: { value: null },
    pick: (opts?: PickOpts) => mockPick(opts),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setUrl(path: string): void {
  // The composable reads `${window.location.origin}${route.fullPath}` and
  // hands it to parseInviteLink. jsdom's location is `http://localhost:3000/`
  // by default, which is fine.
  mockRoute.fullPath = path;
}

function reset(): void {
  vi.clearAllMocks();
  familyMembers.length = 0;
  familyContextStore.activeFamilyId = null;
  mockSyncStore.pendingEncryptedFile = null;
  mockSyncStore.envelope = null;
  mockSyncStore.error = null;
  mockRegistry.isConfigured = true;
  mockRegistry.entry = null;
  mockInvite.hash = vi.fn(async (token: string) => `hash:${token}`);
  mockInvite.redeem = vi.fn(async () => 'family-key');
  mockInvite.expired = vi.fn(() => false);
  mockGoogleAuth.completeRedirect = vi.fn(async () => null);
  mockGoogleAuth.silent = vi.fn(async () => null);
  mockGoogleAuth.email = 'actual@example.com';
  mockGoogleAuth.redirectAuth = false;
  setUrl('/');
}

import type { JoinErrorCode } from '../useJoinFlow';

const ALL_ERROR_CODES: JoinErrorCode[] = [
  'OAUTH_REDIRECT_FAILED',
  'OAUTH_SCOPE_DENIED',
  'OAUTH_POPUP_BLOCKED',
  'PICKER_SCRIPT_LOAD_FAILED',
  'PICKER_FAILED',
  'PICKER_TIMEOUT',
  'FILE_READ_FAILED',
  'FILE_DECRYPT_FAILED',
  'FILE_FAMILY_MISMATCH',
  'INVITE_TOKEN_EXPIRED',
  'INVITE_TOKEN_INVALID',
  'NO_UNCLAIMED_MEMBERS',
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useJoinFlow', () => {
  beforeEach(reset);

  describe('JOIN_ERRORS registry', () => {
    it('has an entry for every JoinErrorCode (exhaustiveness guard)', async () => {
      const { JOIN_ERRORS } = await import('../useJoinFlow');
      const keys = Object.keys(JOIN_ERRORS).sort();
      expect(keys).toEqual([...ALL_ERROR_CODES].sort());
    });

    it('every entry has a non-empty messageKey, ≥1 recovery, and a valid severity', async () => {
      const { JOIN_ERRORS } = await import('../useJoinFlow');
      for (const code of ALL_ERROR_CODES) {
        const entry = JOIN_ERRORS[code];
        expect(entry.messageKey, `entry ${code}.messageKey`).toBeTruthy();
        expect(entry.recoveries.length, `entry ${code}.recoveries`).toBeGreaterThan(0);
        expect(['warning', 'critical'], `entry ${code}.severity`).toContain(entry.severity);
      }
    });
  });

  describe('init — URL parsing', () => {
    it('parses familyId, provider, fileId, fileName, token, hint from the URL', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      const url = buildInviteLink({
        familyId: 'fam-123',
        token: 'tok-abc',
        provider: 'google_drive',
        fileId: 'drive-file-1',
        fileName: 'family.beanpod',
        inviteeEmail: 'wife@example.com',
      });
      setUrl(url.replace('http://localhost:3000', ''));

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      // No silent token → init defers to user-gesture CTA.
      mockGoogleAuth.silent = vi.fn(async () => null);
      await flow.init();

      expect(flow.targetFamilyId.value).toBe('fam-123');
      expect(flow.targetProvider.value).toBe('google_drive');
      expect(flow.targetFileId.value).toBe('drive-file-1');
      expect(flow.targetFileName.value).toBe('family.beanpod');
      expect(flow.inviteToken.value).toBe('tok-abc');
      expect(flow.inviteEmailHint.value).toBe('wife@example.com');
    });

    it('with no URL params, lands on awaiting-auth (instructions screen)', async () => {
      setUrl('/join');
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();
      expect(flow.currentStep.value).toBe('awaiting-auth');
      expect(flow.currentError.value).toBeNull();
    });
  });

  describe('init — happy path with silent auto-load', () => {
    it('loads file directly when fileId is in URL and silent token works', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false, name: 'wife' });
      mockSyncStore.envelope = { familyId: 'fam' };

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(mockSyncStore.loadFromGoogleDrive).toHaveBeenCalledWith('drive-1', expect.any(String));
      expect(mockSyncStore.decryptPendingFileWithKey).toHaveBeenCalled();
      expect(flow.currentStep.value).toBe('pick-member');
      expect(flow.currentError.value).toBeNull();
    });

    it('defers to user gesture when no silent token is available', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => null);

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentStep.value).toBe('awaiting-auth');
      expect(mockPick).not.toHaveBeenCalled();
    });
  });

  describe('init — auto-load 404 → silent picker fallback (deferred)', () => {
    it('a 404-shaped error from auto-load defers to user gesture, not auto-Picker', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({ success: false }));
      mockSyncStore.error = 'File not found: drive-1';

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      // 404 is treated as "needs pick" → defers to gesture (non-gesture init).
      expect(flow.currentStep.value).toBe('awaiting-auth');
      expect(mockPick).not.toHaveBeenCalled();
    });
  });

  describe('handleAuthTap — Picker fires on user gesture', () => {
    it('opens Picker, loads file, decrypts, advances to pick-member', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          inviteeEmail: 'wife@example.com',
        }).replace('http://localhost:3000', '')
      );
      mockPick.mockResolvedValueOnce({
        kind: 'picked',
        fileId: 'picked-1',
        fileName: 'family.beanpod',
      });
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockSyncStore.envelope = { familyId: 'fam' };
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();
      await flow.handleAuthTap();

      expect(mockPick).toHaveBeenCalledWith({
        forceConsent: false,
        loginHint: 'wife@example.com',
      });
      expect(flow.currentStep.value).toBe('pick-member');
      expect(flow.currentError.value).toBeNull();
    });

    it('cancelled Picker (null return) re-shows the awaiting-auth CTA without an error', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({ familyId: 'fam', provider: 'google_drive' }).replace(
          'http://localhost:3000',
          ''
        )
      );
      mockPick.mockResolvedValueOnce({ kind: 'cancelled' });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();
      await flow.handleAuthTap();

      expect(flow.currentError.value).toBeNull();
      expect(flow.currentStep.value).toBe('awaiting-auth');
    });
  });

  describe('Picker discriminated-union → JoinErrorCode mapping', () => {
    async function setupAndTap(pickResult: {
      kind: 'failed';
      reason: 'script' | 'iframe' | 'timeout';
    }) {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({ familyId: 'fam', provider: 'google_drive' }).replace(
          'http://localhost:3000',
          ''
        )
      );
      mockPick.mockResolvedValueOnce(pickResult);

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();
      await flow.handleAuthTap();
      return flow;
    }

    it("'script' reason → PICKER_SCRIPT_LOAD_FAILED", async () => {
      const flow = await setupAndTap({ kind: 'failed', reason: 'script' });
      expect(flow.currentError.value?.code).toBe('PICKER_SCRIPT_LOAD_FAILED');
    });

    it("'iframe' reason → PICKER_FAILED", async () => {
      const flow = await setupAndTap({ kind: 'failed', reason: 'iframe' });
      expect(flow.currentError.value?.code).toBe('PICKER_FAILED');
    });

    it("'timeout' reason → PICKER_TIMEOUT", async () => {
      const flow = await setupAndTap({ kind: 'failed', reason: 'timeout' });
      expect(flow.currentError.value?.code).toBe('PICKER_TIMEOUT');
    });
  });

  describe('FILE_READ_FAILED error context (mismatch composition)', () => {
    it('includes hintEmail and actualEmail when load fails AND emails differ', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          provider: 'google_drive',
          fileId: 'drive-1',
          inviteeEmail: 'wife@example.com',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockGoogleAuth.email = 'someone-else@example.com';
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({ success: false }));
      mockSyncStore.error = 'Permission denied';

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('FILE_READ_FAILED');
      expect(flow.currentError.value?.context).toMatchObject({
        hintEmail: 'wife@example.com',
        actualEmail: 'someone-else@example.com',
        error: 'Permission denied',
      });
    });

    it('stays silent (no error) when load succeeds even if emails differ', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
          inviteeEmail: 'wife@example.com',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockGoogleAuth.email = 'someone-else@example.com';
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockSyncStore.envelope = { familyId: 'fam' };
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value).toBeNull();
      expect(flow.currentStep.value).toBe('pick-member');
    });
  });

  describe('FILE_FAMILY_MISMATCH', () => {
    it('fires when the loaded file belongs to a different family', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam-A',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockSyncStore.envelope = { familyId: 'fam-B' }; // different family!
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('FILE_FAMILY_MISMATCH');
      expect(flow.currentError.value?.context).toMatchObject({
        expected: 'fam-A',
        actual: 'fam-B',
      });
    });
  });

  describe('INVITE_TOKEN_EXPIRED / INVITE_TOKEN_INVALID', () => {
    it('expired invite token fires INVITE_TOKEN_EXPIRED', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: {
          inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'past' } },
        },
      };
      mockInvite.expired = vi.fn(() => true);

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('INVITE_TOKEN_EXPIRED');
    });

    it('unknown invite-token hash fires INVITE_TOKEN_INVALID', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'wrong-token',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: {
          // Different hash than the URL's token will produce.
          inviteKeys: { 'hash:other-token': { wrapped: 'w', salt: 's', expiresAt: 'never' } },
        },
      };

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('INVITE_TOKEN_INVALID');
    });
  });

  describe('FILE_DECRYPT_FAILED', () => {
    it('fires when redeemInviteToken throws', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockInvite.redeem = vi.fn(async () => {
        throw new Error('redeem boom');
      });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('FILE_DECRYPT_FAILED');
      expect(flow.currentError.value?.context?.error).toContain('redeem boom');
    });
  });

  describe('NO_UNCLAIMED_MEMBERS', () => {
    it('fires when every member is already claimed', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
        }).replace('http://localhost:3000', '')
      );
      mockGoogleAuth.silent = vi.fn(async () => 'silent-token');
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockSyncStore.envelope = { familyId: 'fam' };
      // No unclaimed members.
      familyMembers.push({ id: 'm1', requiresPassword: false, isPet: false });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('NO_UNCLAIMED_MEMBERS');
    });
  });

  describe('handleSelectMember + handleSubmitPassword', () => {
    it('selecting a member moves to set-password; submitting succeeds and finishes', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      // Skip init — directly drive the post-load steps.
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false, name: 'wife' });

      flow.handleSelectMember(familyMembers[0]! as never);
      expect(flow.currentStep.value).toBe('set-password');
      expect(flow.selectedMember.value?.id).toBe('m1');

      const ok = await flow.handleSubmitPassword('hunter2');
      expect(ok).toBe(true);
      expect(mockAuthStore.joinFamily).toHaveBeenCalledWith({
        memberId: 'm1',
        password: 'hunter2',
        familyId: '',
      });
      expect(mockSyncStore.wrapFamilyKeyForMember).toHaveBeenCalledWith('m1', 'hunter2');
      expect(mockSyncStore.syncNow).toHaveBeenCalledWith(true);
    });

    it('regresses to set-password if joinFamily fails', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });
      mockAuthStore.joinFamily = vi.fn(async () => ({ success: false, error: 'wrong password' }));

      flow.handleSelectMember(familyMembers[0]! as never);
      const ok = await flow.handleSubmitPassword('wrong');

      expect(ok).toBe(false);
      expect(flow.currentStep.value).toBe('set-password');
      expect(flow.currentError.value?.code).toBe('FILE_DECRYPT_FAILED');
    });
  });

  describe('handleSubmitDecryptPassword (no-invite-token fallback)', () => {
    it('decrypts with password and advances on success', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });
      mockSyncStore.envelope = { familyId: 'fam' };

      const ok = await flow.handleSubmitDecryptPassword('p');
      expect(ok).toBe(true);
      expect(mockSyncStore.decryptPendingFile).toHaveBeenCalledWith('p');
      expect(flow.currentStep.value).toBe('pick-member');
    });

    it('sets FILE_DECRYPT_FAILED when the password is wrong', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      mockSyncStore.decryptPendingFile = vi.fn(async () => ({ success: false, error: 'no' }));

      const ok = await flow.handleSubmitDecryptPassword('p');
      expect(ok).toBe(false);
      expect(flow.currentError.value?.code).toBe('FILE_DECRYPT_FAILED');
    });
  });

  describe('handleTryAnotherDevice + currentInviteUrl', () => {
    it('toggles showShareFallback and exposes a buildable invite URL', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          fileId: 'drive-1',
          inviteeEmail: 'wife@example.com',
        }).replace('http://localhost:3000', '')
      );
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.showShareFallback.value).toBe(false);
      flow.handleTryAnotherDevice();
      expect(flow.showShareFallback.value).toBe(true);
      expect(flow.currentInviteUrl.value).toContain('fam=fam');
      expect(flow.currentInviteUrl.value).toContain('t=tok');
    });
  });

  describe('handleRetry', () => {
    it('clears the error and re-runs the last failed action', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({ familyId: 'fam', provider: 'google_drive' }).replace(
          'http://localhost:3000',
          ''
        )
      );
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      // First tap: Picker fails to load file.
      mockPick.mockResolvedValueOnce({ kind: 'picked', fileId: 'picked-1', fileName: 'f.beanpod' });
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({ success: false }));
      mockSyncStore.error = 'boom';
      await flow.handleAuthTap();
      expect(flow.currentError.value?.code).toBe('FILE_READ_FAILED');

      // Retry: Picker now picks something else and load succeeds.
      mockPick.mockResolvedValueOnce({ kind: 'picked', fileId: 'picked-2', fileName: 'f.beanpod' });
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = null; // no pending → just advanceAfterFileLoaded
      mockSyncStore.envelope = { familyId: 'fam' };
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });

      await flow.handleRetry();
      expect(flow.currentError.value).toBeNull();
      expect(flow.currentStep.value).toBe('pick-member');
    });
  });

  describe('handleSignInDifferent', () => {
    it('forces consent + login_hint and re-attempts the load', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({
          familyId: 'fam',
          token: 'tok',
          provider: 'google_drive',
          inviteeEmail: 'wife@example.com',
        }).replace('http://localhost:3000', '')
      );
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      mockPick.mockResolvedValueOnce({ kind: 'picked', fileId: 'p', fileName: 'f.beanpod' });
      mockSyncStore.loadFromGoogleDrive = vi.fn(async () => ({
        success: false,
        needsPassword: true,
      }));
      mockSyncStore.pendingEncryptedFile = {
        envelope: { inviteKeys: { 'hash:tok': { wrapped: 'w', salt: 's', expiresAt: 'never' } } },
      };
      mockSyncStore.envelope = { familyId: 'fam' };
      familyMembers.push({ id: 'm1', requiresPassword: true, isPet: false });

      await flow.handleSignInDifferent();

      expect(mockPick).toHaveBeenCalledWith({
        forceConsent: true,
        loginHint: 'wife@example.com',
      });
      expect(flow.currentStep.value).toBe('pick-member');
    });
  });

  describe('OAUTH_REDIRECT_FAILED', () => {
    it('fires when completeRedirectAuth throws during init', async () => {
      const { buildInviteLink } = await import('@/services/crypto/inviteService');
      setUrl(
        buildInviteLink({ familyId: 'fam', provider: 'google_drive' }).replace(
          'http://localhost:3000',
          ''
        )
      );
      mockGoogleAuth.completeRedirect = vi.fn(async () => {
        throw new Error('redirect oh no');
      });

      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      await flow.init();

      expect(flow.currentError.value?.code).toBe('OAUTH_REDIRECT_FAILED');
      expect(flow.currentError.value?.context?.error).toContain('redirect oh no');
    });
  });

  describe('buildDiagnosticReport', () => {
    it('returns valid JSON with device + step + error fields', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      const blob = flow.buildDiagnosticReport();
      const parsed = JSON.parse(blob);
      expect(parsed.device.userAgent).toBeDefined();
      expect(parsed.step).toBe('lookup');
      expect(parsed.error).toBeNull();
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('clearError', () => {
    it('resets currentError to null', async () => {
      const { useJoinFlow } = await import('../useJoinFlow');
      const flow = useJoinFlow();
      flow.currentError.value = { code: 'FILE_READ_FAILED' };
      flow.clearError();
      expect(flow.currentError.value).toBeNull();
    });
  });
});
