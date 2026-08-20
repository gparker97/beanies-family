/**
 * familyContextStore.updateFamilyName — durable-persist wiring.
 *
 * Regression guard for the bug where renaming a family (Meet the Beans → edit
 * icon) changed the name in the local registry but never reached the durable
 * .beanpod envelope, so a fresh load (new device / cleared cache / review demo)
 * rebuilt the old name from `envelope.familyName`. The store must now push every
 * successful rename through `syncStore.persistFamilyName`, and a persist failure
 * must not revert the local rename.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { Family } from '@/types/models';

const persistFamilyName = vi.fn();
const svcUpdateFamilyName = vi.fn();

vi.mock('@/services/familyContext', () => ({
  updateFamilyName: (...args: unknown[]) => svcUpdateFamilyName(...args),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ persistFamilyName }),
}));

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import { useFamilyContextStore } from '@/stores/familyContextStore';

const family = (name: string): Family => ({
  id: 'fam1',
  name,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('familyContextStore.updateFamilyName — durable persist', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    persistFamilyName.mockResolvedValue(true);
  });

  it('persists a successful rename to the durable envelope', async () => {
    svcUpdateFamilyName.mockResolvedValue(family('New Name'));
    const store = useFamilyContextStore();
    store.activeFamily = family('Old Name');

    const ok = await store.updateFamilyName('New Name');

    expect(ok).toBe(true);
    expect(svcUpdateFamilyName).toHaveBeenCalledWith('fam1', 'New Name');
    // The crux of the fix: the rename is handed to the durable-persist path.
    expect(persistFamilyName).toHaveBeenCalledWith('New Name');
    expect(store.activeFamilyName).toBe('New Name');
  });

  it('keeps the local rename even when the durable persist throws (offline)', async () => {
    svcUpdateFamilyName.mockResolvedValue(family('New Name'));
    persistFamilyName.mockRejectedValue(new Error('offline'));
    const store = useFamilyContextStore();
    store.activeFamily = family('Old Name');

    const ok = await store.updateFamilyName('New Name');

    expect(ok).toBe(true); // not reverted by a persist failure
    expect(store.activeFamilyName).toBe('New Name');
  });

  it('does nothing durable when there is no active family', async () => {
    const store = useFamilyContextStore();
    store.activeFamily = null;

    const ok = await store.updateFamilyName('Whatever');

    expect(ok).toBe(false);
    expect(svcUpdateFamilyName).not.toHaveBeenCalled();
    expect(persistFamilyName).not.toHaveBeenCalled();
  });
});
