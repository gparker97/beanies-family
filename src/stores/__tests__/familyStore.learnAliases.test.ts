/**
 * `learnAliases` — grouping per member is LOAD-BEARING, not tidiness.
 *
 * The same member can appear several times in one confirmation (a passenger listed per leg),
 * and a second sequential updateMember for that member reads the aliases from BEFORE the
 * first write and clobbers it. That invariant previously existed only as a comment inside a
 * 123-line handler in the view, so any future caller learning aliases from elsewhere would
 * have re-broken it with nothing to catch them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/services/automerge/repositories/familyMemberRepository', () => ({
  getAllFamilyMembers: vi.fn(),
  getFamilyMemberById: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  deleteFamilyMember: vi.fn(),
  getFamilyMemberByEmail: vi.fn(),
  getOwner: vi.fn(),
}));
vi.mock('@/services/automerge/projection', () => ({ getById: vi.fn() }));
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyMember } from '@/types/models';

function member(id: string, over?: Partial<FamilyMember>): FamilyMember {
  return {
    id,
    name: id,
    role: 'member',
    color: '#000',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyMember;
}

describe('familyStore.learnAliases', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(familyRepo.updateFamilyMember).mockImplementation(
      async (id, input) => ({ ...member(id), ...input }) as FamilyMember
    );
  });

  it('writes ONCE per member even when that member appears several times', async () => {
    const store = useFamilyStore();
    store.members = [member('m-1')];

    await store.learnAliases([
      { memberId: 'm-1', alias: 'Smith John' },
      { memberId: 'm-1', alias: 'J Smith' },
    ]);

    // Two writes would mean the second read stale aliases and dropped the first.
    expect(familyRepo.updateFamilyMember).toHaveBeenCalledTimes(1);
    expect(familyRepo.updateFamilyMember).toHaveBeenCalledWith('m-1', {
      aliases: ['Smith John', 'J Smith'],
    });
  });

  it('keeps the aliases a member already had', async () => {
    const store = useFamilyStore();
    store.members = [member('m-1', { aliases: ['Existing'] })];
    await store.learnAliases([{ memberId: 'm-1', alias: 'New One' }]);
    expect(familyRepo.updateFamilyMember).toHaveBeenCalledWith('m-1', {
      aliases: ['Existing', 'New One'],
    });
  });

  it('does not duplicate an alias the member already has', async () => {
    const store = useFamilyStore();
    store.members = [member('m-1', { aliases: ['Smith John'] })];
    await store.learnAliases([{ memberId: 'm-1', alias: 'Smith John' }]);
    expect(familyRepo.updateFamilyMember).toHaveBeenCalledWith('m-1', {
      aliases: ['Smith John'],
    });
  });

  it('writes each DIFFERENT member separately', async () => {
    const store = useFamilyStore();
    store.members = [member('m-1'), member('m-2')];
    const written = await store.learnAliases([
      { memberId: 'm-1', alias: 'A' },
      { memberId: 'm-2', alias: 'B' },
    ]);
    expect(written).toBe(2);
    expect(familyRepo.updateFamilyMember).toHaveBeenCalledTimes(2);
  });

  it('skips a member removed on another device rather than recreating them', async () => {
    const store = useFamilyStore();
    store.members = [member('m-1')];
    const written = await store.learnAliases([{ memberId: 'gone', alias: 'X' }]);
    expect(written).toBe(0);
    expect(familyRepo.updateFamilyMember).not.toHaveBeenCalled();
  });

  it('is a no-op for an empty list', async () => {
    const store = useFamilyStore();
    expect(await store.learnAliases([])).toBe(0);
    expect(familyRepo.updateFamilyMember).not.toHaveBeenCalled();
  });
});
