/**
 * Session-member resolution and self-removal (#80).
 *
 * Two escalations lived in familyStore, both of the same shape: "this session names
 * nobody real, so fall back to the OWNER". One fired on reload, the other when a member
 * deleted their own bean — and the second needed no devtools at all, only a `canManagePod`
 * non-owner using a supported button.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';

vi.mock('@/services/automerge/repositories/familyMemberRepository', () => ({
  getAllFamilyMembers: vi.fn(),
  getFamilyMemberById: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  deleteFamilyMember: vi.fn(),
  getFamilyMemberByEmail: vi.fn(),
  getOwner: vi.fn(),
}));
vi.mock('@/services/automerge/projection', () => ({ getById: vi.fn(() => ({})) }));
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const authState = vi.hoisted(() => ({
  currentUser: null as { memberId: string } | null,
  isAuthenticated: false,
  invalidateSession: vi.fn(),
  confirmSessionMember: vi.fn(),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(() => authState),
}));

import { useFamilyStore } from '@/stores/familyStore';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Bean',
    email: 'b@e.c',
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#000',
    canManagePod: false,
    canViewFinances: true,
    canEditActivities: true,
    requiresPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FamilyMember;
}

const OWNER = member({ id: 'owner-1', role: 'owner' });
const ME = member({ id: 'me-1', canManagePod: true });

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.currentUser = null;
  authState.isAuthenticated = false;
});

describe('familyStore — session member resolution', () => {
  it('adopts a session member who is genuinely in the roster', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    authState.currentUser = { memberId: 'me-1' };
    authState.isAuthenticated = true;

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.currentMemberId).toBe('me-1');
    expect(authState.invalidateSession).not.toHaveBeenCalled();
  });

  it('REJECTS an authenticated session naming a member who is not in the pod', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    authState.currentUser = { memberId: 'ghost' };
    authState.isAuthenticated = true;

    const store = useFamilyStore();
    await store.loadMembers();

    // The old code fell through to the owner here.
    expect(store.currentMemberId).toBeNull();
    expect(authState.invalidateSession).toHaveBeenCalledWith('roster-switched');
  });

  it('does NOT break signup: an unauthenticated load still falls back to the owner', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    authState.currentUser = null;
    authState.isAuthenticated = false;

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.currentMemberId).toBe('owner-1');
    expect(authState.invalidateSession).not.toHaveBeenCalled();
  });
});

describe('familyStore.deleteMember — self-removal (the no-devtools vector)', () => {
  it('signs a manager out when they delete their own bean, instead of promoting them', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    vi.mocked(familyRepo.deleteFamilyMember).mockResolvedValue(true);
    authState.currentUser = { memberId: 'me-1' };
    authState.isAuthenticated = true;

    const store = useFamilyStore();
    await store.loadMembers();
    expect(store.currentMemberId).toBe('me-1');

    await store.deleteMember('me-1');

    // Previously: currentMemberId became owner-1, and usePermissions then read owner.
    expect(store.currentMemberId).toBeNull();
    expect(authState.invalidateSession).toHaveBeenCalledWith('self-removed');
  });

  it('leaves the unauthenticated signup delete path alone', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    vi.mocked(familyRepo.deleteFamilyMember).mockResolvedValue(true);
    const store = useFamilyStore();
    await store.loadMembers();
    store.setCurrentMember('me-1');

    await store.deleteMember('me-1');

    expect(store.currentMemberId).toBeNull();
    expect(authState.invalidateSession).not.toHaveBeenCalled();
  });
});
