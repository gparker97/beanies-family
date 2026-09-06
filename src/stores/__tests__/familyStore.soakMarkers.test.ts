/**
 * The compaction soak markers ride the login write.
 *
 * ⚠️ WHY IN `updateMember` AND NOT AT THE CALL SITES. `authStore` writes
 * `lastLoginAt` from SEVEN places. Stamping at each is seven chances to forget
 * and seven places to keep in step; stamping in the one function they all funnel
 * through means the marker cannot drift from the timestamp it describes.
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
import { REQUIRED_EPOCH } from '@/services/pod/podSoak';
import { APP_VERSION } from '@/constants/appVersion';
import type { FamilyMember } from '@/types/models';

const patchOf = () =>
  vi.mocked(familyRepo.updateFamilyMember).mock.calls[0]?.[1] as Record<string, unknown>;

function seed(over?: Partial<FamilyMember>) {
  const store = useFamilyStore();
  store.members = [{ id: 'm1', name: 'Greg', ...over } as FamilyMember];
  vi.mocked(familyRepo.updateFamilyMember).mockResolvedValue({ id: 'm1' } as FamilyMember);
  return store;
}

describe('familyStore.updateMember — soak markers', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('stamps the lineage epoch when a login is recorded', async () => {
    const store = seed();
    await store.updateMember('m1', { lastLoginAt: '2026-09-06' });
    expect(patchOf().lineageEpoch).toBe(REQUIRED_EPOCH);
    expect(patchOf().appVersion).toBe(APP_VERSION);
  });

  it('does NOT stamp an ordinary edit', async () => {
    // The marker describes a login. A name change is not one, and writing it
    // there would grow the very history this tier exists to shrink.
    const store = seed();
    await store.updateMember('m1', { name: 'Gregory' });
    expect(patchOf().lineageEpoch).toBeUndefined();
    expect(patchOf().appVersion).toBeUndefined();
  });

  it('does not rewrite a value that has not changed', async () => {
    // An identical write still emits an Automerge change, and this feature
    // exists to stop the history growing for no reason.
    const store = seed({ lineageEpoch: REQUIRED_EPOCH, appVersion: APP_VERSION });
    await store.updateMember('m1', { lastLoginAt: '2026-09-06' });
    expect(patchOf().lineageEpoch).toBeUndefined();
    expect(patchOf().appVersion).toBeUndefined();
  });

  it('still carries the caller own fields through', async () => {
    const store = seed();
    await store.updateMember('m1', { lastLoginAt: '2026-09-06', name: 'Greg P' });
    expect(patchOf().name).toBe('Greg P');
    expect(patchOf().lastLoginAt).toBe('2026-09-06');
  });
});
