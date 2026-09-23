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

vi.mock('@/services/automerge/repositories/removedMemberRepository', () => ({
  getAllRemovedMembers: vi.fn(async () => []),
  removeMemberAndRecord: vi.fn(async () => {}),
}));
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

// The sync store surface `deleteMember` orchestrates (#77). A local-file family by default,
// so the Drive branch stays off unless a test turns it on.
const syncState = vi.hoisted(() => ({
  storageProviderType: 'local' as string | null,
  driveFileId: null as string | null,
  envelope: null as unknown,
  canDurablySaveNow: vi.fn(() => true),
  observeRemote: vi.fn(async () => true),
  stageMemberLinkTombstone: vi.fn(() => ({ committed: true })),
  retireMemberKeyMaterial: vi.fn(() => ({
    tombstonesWritten: 2,
    entriesDropped: 1,
    unattributedPasskeys: 0,
    passkeySecretsCleared: 0,
    noEnvelope: false,
  })),
  syncNowDurable: vi.fn(async () => 'saved' as string),
  CREDENTIAL_PUBLISH_TIMEOUT_MS: 20000,
  holdsKeyMaterialFor: vi.fn(() => false),
}));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => syncState }));
vi.mock('@/services/auth/deviceCredentials', () => ({
  retireMemberDeviceCredentials: vi.fn(async () => {}),
  membersWithDeviceCredentials: vi.fn(async () => new Set()),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => 'fam-1') }));

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
import * as removedRepo from '@/services/automerge/repositories/removedMemberRepository';
import { retireMemberDeviceCredentials } from '@/services/auth/deviceCredentials';

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
  syncState.storageProviderType = 'local';
  syncState.canDurablySaveNow.mockReturnValue(true);
  syncState.syncNowDurable.mockResolvedValue('saved');
  vi.mocked(removedRepo.getAllRemovedMembers).mockResolvedValue([]);
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

  it('leaves the unauthenticated signup path alone (an onboarding draft)', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    vi.mocked(familyRepo.deleteFamilyMember).mockResolvedValue(true);
    const store = useFamilyStore();
    await store.loadMembers();
    store.setCurrentMember('me-1');

    expect(await store.discardDraftMember('me-1')).toBe(true);

    expect(store.currentMemberId).toBeNull();
    expect(authState.invalidateSession).not.toHaveBeenCalled();
  });
});

describe('familyStore — a REMOVED member (#77)', () => {
  const removedRecord = (id: string) => ({
    id,
    removedAt: '2026-09-23T00:00:00.000Z',
    removedByMemberId: 'owner-1',
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  });

  it('rejects their session as a removal, not as tampering', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER]);
    vi.mocked(removedRepo.getAllRemovedMembers).mockResolvedValue([removedRecord('me-1')]);
    authState.currentUser = { memberId: 'me-1' };
    authState.isAuthenticated = true;

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.currentMemberId).toBeNull();
    expect(authState.invalidateSession).toHaveBeenCalledWith('member-removed');
    expect(store.memberStatus('me-1')).toBe('removed');
  });

  it('filters a resurrected row whose id the pod records as removed', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    vi.mocked(removedRepo.getAllRemovedMembers).mockResolvedValue([removedRecord('me-1')]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.members.map((m) => m.id)).toEqual(['owner-1']);
  });

  it('says `absent`, never `removed`, for a member merely missing from the roster', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER]);
    const store = useFamilyStore();
    await store.loadMembers();
    expect(store.memberStatus('someone')).toBe('absent');
  });
});

describe('familyStore.deleteMember — revokes access (#77)', () => {
  async function loaded() {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([OWNER, ME]);
    const store = useFamilyStore();
    await store.loadMembers();
    store.setCurrentMember('owner-1');
    return store;
  }

  it('observes, stages, records the removal, revokes, and saves ONCE', async () => {
    const store = await loaded();

    const outcome = await store.deleteMember('me-1');

    expect(outcome).toEqual({
      removed: true,
      save: 'saved',
      drive: 'not-applicable',
      manualCheckEmail: null,
    });
    expect(syncState.observeRemote).toHaveBeenCalledTimes(1);
    expect(syncState.stageMemberLinkTombstone).toHaveBeenCalledWith('me-1');
    expect(removedRepo.removeMemberAndRecord).toHaveBeenCalledWith('me-1', 'owner-1');
    expect(syncState.retireMemberKeyMaterial).toHaveBeenCalledWith('me-1', 'remove');
    expect(retireMemberDeviceCredentials).toHaveBeenCalledWith('fam-1', 'me-1');
    expect(syncState.syncNowDurable).toHaveBeenCalledTimes(1);
    // The observe is the one pre-merge, and it comes BEFORE anything is staged.
    expect(syncState.observeRemote.mock.invocationCallOrder[0]).toBeLessThan(
      syncState.stageMemberLinkTombstone.mock.invocationCallOrder[0]
    );
    expect(store.memberStatus('me-1')).toBe('removed');
  });

  it('refuses an OFFLINE Google Drive family before changing anything', async () => {
    const store = await loaded();
    syncState.storageProviderType = 'google_drive';
    syncState.canDurablySaveNow.mockReturnValue(false);

    expect(await store.deleteMember('me-1')).toEqual({ removed: false, refusal: 'offline' });
    expect(removedRepo.removeMemberAndRecord).not.toHaveBeenCalled();
    expect(syncState.observeRemote).not.toHaveBeenCalled();
  });

  it('reports a save that did not land as pending — the removal stands', async () => {
    const store = await loaded();
    syncState.syncNowDurable.mockResolvedValue('timeout');

    const outcome = await store.deleteMember('me-1');

    expect(outcome).toMatchObject({ removed: true, save: 'pending' });
  });

  it('refuses a member that does not exist', async () => {
    const store = await loaded();
    expect(await store.deleteMember('nobody')).toEqual({ removed: false, refusal: 'not-found' });
  });

  it('discardDraftMember refuses a member the envelope holds key material for', async () => {
    const store = await loaded();
    syncState.holdsKeyMaterialFor.mockReturnValueOnce(true);
    expect(await store.discardDraftMember('me-1')).toBe(false);
    expect(familyRepo.deleteFamilyMember).not.toHaveBeenCalled();
  });

  it('discardDraftMember refuses a member who holds credentials', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([
      OWNER,
      member({ id: 'me-1', pinHash: 'x' } as Partial<FamilyMember>),
    ]);
    const store = useFamilyStore();
    await store.loadMembers();

    expect(await store.discardDraftMember('me-1')).toBe(false);
    expect(familyRepo.deleteFamilyMember).not.toHaveBeenCalled();
  });
});
