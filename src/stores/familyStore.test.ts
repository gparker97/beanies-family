import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';

vi.mock('@/services/automerge/repositories/removedMemberRepository', () => ({
  getAllRemovedMembers: vi.fn(async () => []),
  removeMemberAndRecord: vi.fn(async () => {}),
}));
vi.mock('@/services/automerge/repositories/familyMemberRepository', async (importOriginal) => ({
  // The REAL defaults: the loader re-applies them to a row it heals in memory.
  applyDefaults: (
    await importOriginal<
      typeof import('@/services/automerge/repositories/familyMemberRepository')
    >()
  ).applyDefaults,
  getAllFamilyMembers: vi.fn(),
  getFamilyMemberById: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  deleteFamilyMember: vi.fn(),
  getFamilyMemberByEmail: vi.fn(),
  getOwner: vi.fn(),
}));

// ADR-032: the role heal and transferOwnership read the projection (the stored row, and
// whether a member is present), then write via a single docClient.mutate batch op. Mock both;
// mutate is asserted for the batch shape. `isAuthoritativeLoaded` lets load maintenance run.
vi.mock('@/services/automerge/projection', () => ({
  getById: vi.fn(),
  isAuthoritativeLoaded: () => true,
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
import { reportError } from '@/utils/errorReporter';
import {
  __resetLoadMaintenanceForTesting,
  __whenLoadMaintenanceIdleForTesting,
  runLoadMaintenance,
} from '@/services/automerge/loadMaintenance';

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

/** The roster the document holds: the repository read AND the projection's stored rows. */
function holdRoster(list: FamilyMember[]): void {
  vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue(list);
  vi.mocked(projectionGetById).mockImplementation(((_c: string, id: string) =>
    list.find((m) => m.id === id)) as never);
}

/** What `reloadAllStores` does after its read-only loaders. */
async function runMaintenance(): Promise<void> {
  runLoadMaintenance('reload');
  await __whenLoadMaintenanceIdleForTesting();
}

// 2026-11-15: `loadMembers` is READ-ONLY. It applies the role heal IN MEMORY (so an ownerless
// or two-owner roster is never published) and the load-maintenance task `writeRolePatches`
// writes it after the authoritative reload. Each case asserts both halves.
describe('familyStore — the role heal (computeRolePatches + writeRolePatches)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
    __resetLoadMaintenanceForTesting();
    vi.mocked(mutate).mockResolvedValue(undefined as never);
  });

  it('no-ops when exactly one owner exists', async () => {
    const owner = makeMember({ id: 'owner-1', role: 'owner', requiresPassword: false });
    const member = makeMember({ id: 'm-2', role: 'member' });
    holdRoster([owner, member]);

    const store = useFamilyStore();
    await store.loadMembers();
    await runMaintenance();

    expect(mutate).not.toHaveBeenCalled();
    expect(store.owner?.id).toBe('owner-1');
  });

  it('demotes later owner when two are present (keeps earliest createdAt): in memory at load, written by maintenance', async () => {
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
    holdRoster([earlier, later]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(mutate).not.toHaveBeenCalled(); // the loader is read-only
    expect(store.owner?.id).toBe('owner-old');
    expect(store.members.find((m) => m.id === 'owner-new')?.role).toBe('member');

    await runMaintenance();
    expect(mutate).toHaveBeenCalledOnce();
    // #95: the roster heal is unattended, so it must pass the read-only write gate.
    expect(mutate).toHaveBeenCalledWith(
      {
        op: 'batch',
        ops: [
          { op: 'patch', collection: 'familyMembers', id: 'owner-new', patch: { role: 'member' } },
        ],
      },
      { quiet: true, system: true }
    );
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
    holdRoster([creator, joinedLater]);

    const store = useFamilyStore();
    await store.loadMembers();
    expect(mutate).not.toHaveBeenCalled();
    expect(store.owner?.id).toBe('creator'); // never an ownerless roster, even before the write

    await runMaintenance();
    expect(mutate).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ context: { candidateId: 'creator', memberCount: 2 } })
    );
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
    holdRoster([m1, m2]);

    const store = useFamilyStore();
    await store.loadMembers();

    expect(store.owner?.id).toBe('a');
  });

  it('migrates legacy admin → member preserving canManagePod=true default', async () => {
    const owner = makeMember({ id: 'o', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' });
    // No STORED flag at all (`makeMember` would default it to false).
    const legacyAdmin = {
      ...makeMember({ id: 'admin', role: 'admin' }),
      canManagePod: undefined as unknown as boolean,
    };
    holdRoster([owner, legacyAdmin]);

    const store = useFamilyStore();
    await store.loadMembers();

    const adminAfter = store.members.find((m) => m.id === 'admin');
    expect(adminAfter?.role).toBe('member');
    expect(adminAfter?.canManagePod).toBe(true);
    expect(mutate).not.toHaveBeenCalled();

    await runMaintenance();
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('a rejected batch is reported, never thrown; the roster still shows the heal', async () => {
    const owner = makeMember({ id: 'o', role: 'owner' });
    const legacyAdmin = makeMember({ id: 'admin', role: 'admin' });
    holdRoster([owner, legacyAdmin]);
    vi.mocked(mutate).mockRejectedValue(new Error('boom'));

    const store = useFamilyStore();
    await store.loadMembers();
    await runMaintenance();

    expect(store.members).toHaveLength(2);
    expect(store.members.find((m) => m.id === 'admin')?.role).toBe('member');
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'mutation batch rejected during role normalization' })
    );
  });

  it('handles empty member list', async () => {
    holdRoster([]);

    const store = useFamilyStore();
    await store.loadMembers();
    await runMaintenance();

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
