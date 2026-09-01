/**
 * Store-level enforcement of the tap-through rule (#79).
 *
 * The prove engine decides what to OFFER; this decides what to ALLOW. These tests pin
 * the ALLOW half, so a caller that bypasses `resolveProveMethods` is still refused —
 * and pin that no refusal is silent, which two of the three guards previously were.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks for authStore's transitive deps (mirrors authStoreChangePassword.test.ts) ──

const updateMemberMock = vi.fn(async (id: string) => ({ id, updated: true }));
const setCurrentMemberMock = vi.fn();
const membersRef = { value: [] as Array<Record<string, unknown>> };

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    members: membersRef.value,
    updateMember: updateMemberMock,
    setCurrentMember: setCurrentMemberMock,
    resetState: vi.fn(),
    createMember: vi.fn(),
    loadMembers: vi.fn(),
  }),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ familyKey: null, envelope: null, resetState: vi.fn() }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-1', allFamilies: [] }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

const reportErrorMock = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...a: unknown[]) => reportErrorMock(...a),
}));

vi.mock('@/services/analytics/plausible', () => ({ track: vi.fn() }));

vi.mock('@/services/google/googleAuth', () => ({
  initializeAuth: vi.fn(),
  isGoogleAuthAvailable: vi.fn(() => false),
  getGoogleAccountEmail: vi.fn(() => null),
  signOutFromGoogle: vi.fn(),
  setUserMeta: vi.fn(),
  clearUserMeta: vi.fn(),
}));

vi.mock('@/services/registry/registryService', () => ({
  getRegistryDatabase: vi.fn(),
  isRegistryConfigured: vi.fn(() => false),
}));

vi.mock('@/services/auth/passkeyService', () => ({
  authenticateWithPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  registerPasskeyForMember: vi.fn(),
  resolveDeviceKeys: vi.fn(async () => []),
  hasRegisteredPasskeys: vi.fn(async () => false),
  listRegisteredPasskeys: vi.fn(async () => []),
  MEMBER_MISMATCH: 'member_mismatch',
  WRONG_FAMILY_CREDENTIAL: 'wrong_family_credential',
}));

vi.mock('@/services/sync/passwordCache', () => ({
  isPasswordCacheValid: vi.fn(() => false),
  getCachedPassword: vi.fn(),
  cachePassword: vi.fn(),
  clearPasswordCache: vi.fn(),
}));

import { useAuthStore } from '../authStore';

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    name: 'Bean',
    email: 'bean@example.com',
    gender: 'other',
    ageGroup: 'child',
    role: 'member',
    color: '#000',
    requiresPassword: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The single refusal report the store emits, or undefined if it stayed silent. */
function refusalCalls() {
  return reportErrorMock.mock.calls
    .map((c) => c[0] as { message?: string; context?: { kind?: string } })
    .filter((a) => a?.message === 'passwordless sign-in refused');
}

describe('authStore.signInPasswordless', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    membersRef.value = [];
  });

  it('signs in a credential-less CHILD (the deliberate tap-through feature)', async () => {
    membersRef.value = [member({ ageGroup: 'child' })];
    const store = useAuthStore();
    const result = await store.signInPasswordless('m1');
    expect(result.success).toBe(true);
    expect(store.isAuthenticated).toBe(true);
    expect(setCurrentMemberMock).toHaveBeenCalledWith('m1');
    expect(refusalCalls()).toHaveLength(0);
  });

  it('refuses a credential-less ADULT — an invite is required (#79)', async () => {
    membersRef.value = [member({ ageGroup: 'adult' })];
    const store = useAuthStore();
    const result = await store.signInPasswordless('m1');
    expect(result.success).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(setCurrentMemberMock).not.toHaveBeenCalled();
    expect(refusalCalls()).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ kind: 'adult' }) }),
    ]);
  });

  it('still refuses a credentialed member (PIN-only included — review F6)', async () => {
    membersRef.value = [member({ ageGroup: 'child', pinHash: 'x' })];
    const store = useAuthStore();
    const result = await store.signInPasswordless('m1');
    expect(result.success).toBe(false);
    expect(store.isAuthenticated).toBe(false);
    expect(refusalCalls()).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ kind: 'credentialed' }) }),
    ]);
  });

  it('still refuses a member missing from the loaded doc', async () => {
    const store = useAuthStore();
    const result = await store.signInPasswordless('nope');
    expect(result.success).toBe(false);
    expect(refusalCalls()).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ kind: 'not-found' }) }),
    ]);
  });

  it('reports every refusal exactly once, at warning severity, on login-flow', async () => {
    membersRef.value = [member({ ageGroup: 'adult' })];
    const store = useAuthStore();
    await store.signInPasswordless('m1');
    expect(refusalCalls()).toHaveLength(1);
    expect(refusalCalls()[0]).toMatchObject({ surface: 'login-flow', severity: 'warning' });
  });
});
