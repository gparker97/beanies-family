/**
 * familyContextStore.deleteLocalFamily on the ACTIVE family (2026-10-19).
 *
 * The Start over sign-out tier forgets the family the person is in. That only stops later
 * events carrying its `family_id` (`syncStore` reads `activeFamilyId` into every event's
 * context) because the store nulls `activeFamily` when the forgotten family is the active
 * one. The service clears `lastActiveFamilyId`, so the next boot restores nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const svcDeleteLocalFamily = vi.fn();

vi.mock('@/services/familyContext', () => ({
  deleteLocalFamily: (...args: unknown[]) => svcDeleteLocalFamily(...args),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

import { useFamilyContextStore } from '@/stores/familyContextStore';

const family = (id: string) => ({
  id,
  name: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('familyContextStore.deleteLocalFamily', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    svcDeleteLocalFamily.mockResolvedValue({ deleted: true });
  });

  it('forgetting the active family clears it, so no later event carries its id', async () => {
    const store = useFamilyContextStore();
    store.allFamilies = [family('fam1'), family('fam2')];
    store.activeFamily = family('fam1');

    await expect(store.deleteLocalFamily('fam1')).resolves.toEqual({ deleted: true });

    expect(svcDeleteLocalFamily).toHaveBeenCalledWith('fam1');
    expect(store.activeFamilyId).toBeNull();
    expect(store.allFamilies.map((f) => f.id)).toEqual(['fam2']);
  });

  it('forgetting another family leaves the active one alone', async () => {
    const store = useFamilyContextStore();
    store.allFamilies = [family('fam1'), family('fam2')];
    store.activeFamily = family('fam1');

    await store.deleteLocalFamily('fam2');

    expect(store.activeFamilyId).toBe('fam1');
  });
});
