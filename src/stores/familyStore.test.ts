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

// ADR-032: normalizeRoles/transferOwnership now read the projection to confirm a
// member is present, then write via a single docClient.mutate batch op (was a
// changeDoc closure). Mock both — getById returns truthy so patched members are
// included in the batch; mutate is asserted for the batch shape.
vi.mock('@/services/automerge/projection', () => ({
  getById: vi.fn(),
}));

vi.mock('@/services/automerge/worker/docClient', () => ({
  mutate: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(() => ({
    currentUser: null,
    updateCurrentUserRole: vi.fn(),
  })),
}));

import { useFamilyStore } from './familyStore';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import { getById as projectionGetById } from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';
import { useAuthStore } from '@/stores/authStore';

function makeMember(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    id: overrides.id ?? 'm-1',
    name: overrides.name ?? 'Member',
    email: overrides.email ?? 'm@example.com',
    gender: overrides.gender ?? 'other',
    ageGroup: overrides.ageGroup ?? 'adult',
    role: overrides.role ?? 'member',
    color: overrides.color ?? '#000',
    requiresPassword: overrides.requiresPassword ?? true,
    canViewFinances: overrides.canViewFinances ?? true,
    canEditActivities: overrides.canEditActivities ?? true,
    canManagePod: overrides.canManagePod ?? false,
    isPet: overrides.isPet,
    passwordHash: overrides.passwordHash,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('familyStore — normalizeRoles', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
    // Re-establish defaults after resetAllMocks: every member is present in the
    // projection (truthy) and the mutate batch resolves.
    vi.mocked(projectionGetById).mockReturnValue({ id: 'present' } as never);
    vi.mocked(mutate).mockResolvedValue(undefined as never);
  });

  it('no-ops when exactly one owner exists', async () => {
    const owner = makeMember({ id: 'owner-1', role: 'owner', requiresPassword: false });
    const member = makeMember({ id: 'm-2', role: 'member' });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, member]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).not.toHaveBeenCalled();
    expect(store.owner?.id).toBe('owner-1');
  });

  it('demotes later owner when two are present (keeps earliest createdAt)', async () => {
    const earlier = makeMember({
      id: 'owner-old',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const later = makeMember({
      id: 'owner-new',
      role: 'owner',
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    vi.mocked(familyRepo.getAllFamilyMembers)
      .mockResolvedValueOnce([earlier, later])
      .mockResolvedValueOnce([earlier, { ...later, role: 'member' }]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).toHaveBeenCalledOnce();
    // The mocked second getAllFamilyMembers returns the demoted state.
    expect(store.owner?.id).toBe('owner-old');
  });

  it('promotes earliest non-password-required human when no owner exists', async () => {
    const creator = makeMember({
      id: 'creator',
      role: 'member',
      requiresPassword: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const joinedLater = makeMember({
      id: 'joiner',
      role: 'member',
      requiresPassword: true,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    vi.mocked(familyRepo.getAllFamilyMembers)
      .mockResolvedValueOnce([creator, joinedLater])
      .mockResolvedValueOnce([{ ...creator, role: 'owner', canManagePod: true }, joinedLater]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).toHaveBeenCalledOnce();
    expect(store.owner?.id).toBe('creator');
  });

  it('falls back to earliest human when no requiresPassword=false candidate exists', async () => {
    const m1 = makeMember({
      id: 'a',
      role: 'member',
      requiresPassword: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const m2 = makeMember({
      id: 'b',
      role: 'member',
      requiresPassword: true,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
    vi.mocked(familyRepo.getAllFamilyMembers)
      .mockResolvedValueOnce([m1, m2])
      .mockResolvedValueOnce([{ ...m1, role: 'owner' }, m2]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.owner?.id).toBe('a');
  });

  it('migrates legacy admin → member preserving canManagePod=true default', async () => {
    const owner = makeMember({ id: 'o', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' });
    const legacyAdmin = makeMember({
      id: 'admin',
      role: 'admin',
      canManagePod: undefined as unknown as boolean,
    });
    vi.mocked(familyRepo.getAllFamilyMembers)
      .mockResolvedValueOnce([owner, legacyAdmin])
      .mockResolvedValueOnce([owner, { ...legacyAdmin, role: 'member', canManagePod: true }]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).toHaveBeenCalledOnce();
    const adminAfter = store.members.find((m) => m.id === 'admin');
    expect(adminAfter?.role).toBe('member');
    expect(adminAfter?.canManagePod).toBe(true);
  });

  it('returns input unchanged when the mutate batch throws', async () => {
    const owner = makeMember({ id: 'o', role: 'owner' });
    const legacyAdmin = makeMember({ id: 'admin', role: 'admin' });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, legacyAdmin]);
    vi.mocked(mutate).mockRejectedValue(new Error('boom'));

    const store = useFamilyStore();
    await store.loadMembers();

    // Pod still functions: store.members has the original (un-normalized) list.
    expect(store.members).toHaveLength(2);
    // No throw bubbles up.
  });

  it('handles empty member list', async () => {
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).not.toHaveBeenCalled();
    expect(store.members).toEqual([]);
  });
});

describe('familyStore — transferOwnership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
    // Re-establish defaults after resetAllMocks: every member is present in the
    // projection (truthy) and the mutate batch resolves.
    vi.mocked(projectionGetById).mockReturnValue({ id: 'present' } as never);
    vi.mocked(mutate).mockResolvedValue(undefined as never);
  });

  it('demotes current owner and promotes target with full permissions', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner', requiresPassword: false });
    const target = makeMember({
      id: 'target',
      role: 'member',
      requiresPassword: false,
      canManagePod: false,
      canViewFinances: false,
      canEditActivities: false,
    });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, target]);

    const store = useFamilyStore();
    await store.loadMembers();

    const result = await store.transferOwnership('target');

    expect(result).toBe(true);
    // One atomic batch: demote the old owner + promote the target with full perms.
    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'batch',
        ops: expect.arrayContaining([
          expect.objectContaining({
            op: 'patch',
            collection: 'familyMembers',
            id: 'owner',
            patch: expect.objectContaining({ role: 'member' }),
          }),
          expect.objectContaining({
            op: 'patch',
            collection: 'familyMembers',
            id: 'target',
            patch: expect.objectContaining({
              role: 'owner',
              canManagePod: true,
              canViewFinances: true,
              canEditActivities: true,
            }),
          }),
        ]),
      })
    );

    // In-place local state reflects the swap.
    expect(store.owner?.id).toBe('target');
    expect(store.members.find((m) => m.id === 'owner')?.role).toBe('member');
  });

  it('rejects pet target', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner' });
    const pet = makeMember({ id: 'pet', role: 'member', isPet: true });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, pet]);

    const store = useFamilyStore();
    await store.loadMembers();
    vi.mocked(mutate).mockClear();

    const result = await store.transferOwnership('pet');

    expect(result).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(store.owner?.id).toBe('owner');
  });

  it('rejects same-owner target', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner' });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner]);

    const store = useFamilyStore();
    await store.loadMembers();
    vi.mocked(mutate).mockClear();

    const result = await store.transferOwnership('owner');

    expect(result).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('rejects non-existent target', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner' });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner]);

    const store = useFamilyStore();
    await store.loadMembers();
    vi.mocked(mutate).mockClear();

    const result = await store.transferOwnership('ghost');

    expect(result).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('rejects unjoined target (requiresPassword === true)', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner', requiresPassword: false });
    const unjoined = makeMember({
      id: 'unjoined',
      role: 'member',
      requiresPassword: true,
    });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, unjoined]);

    const store = useFamilyStore();
    await store.loadMembers();
    vi.mocked(mutate).mockClear();

    const result = await store.transferOwnership('unjoined');

    expect(result).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(store.owner?.id).toBe('owner');
  });

  it('updates authStore role when current session is the outgoing owner', async () => {
    const owner = makeMember({ id: 'owner', role: 'owner', requiresPassword: false });
    const target = makeMember({ id: 'target', role: 'member', requiresPassword: false });
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([owner, target]);
    const updateRole = vi.fn();
    vi.mocked(useAuthStore).mockReturnValue({
      currentUser: { memberId: 'owner', email: '', familyId: 'fam', role: 'owner' },
      updateCurrentUserRole: updateRole,
    } as unknown as ReturnType<typeof useAuthStore>);

    const store = useFamilyStore();
    await store.loadMembers();

    await store.transferOwnership('target');

    expect(updateRole).toHaveBeenCalledWith('member');
  });
});
