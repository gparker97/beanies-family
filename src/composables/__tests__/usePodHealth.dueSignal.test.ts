/**
 * ⚠️ THE DUE SIGNAL SHIPPED DEAD, IN BOTH HALVES, AND NO TEST NOTICED.
 *
 * `podBytes` read `syncStore.envelope.encryptedPayload`, which is ALWAYS blank —
 * every write to the long-lived envelope goes through `withoutPayload()`, an
 * invariant with its own dedicated test file. And the out-of-memory mark was
 * written from a code path that by definition has no document, so it could never
 * land. `compactionIsDue` was therefore `false` for every family at every pod
 * size. The old test file only exercised `decodedSizeOf`, which is why three
 * simultaneous mutations to this composable left the whole suite green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const { hooks } = vi.hoisted(() => ({
  hooks: { isOwner: true, bytes: 0 as number | null, members: [] as unknown[] },
}));

vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ isOwner: { value: hooks.isOwner } }),
}));
vi.mock('@/stores/syncStore', () => ({ useSyncStore: () => ({ lastSync: null }) }));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: hooks.members }) }));
vi.mock('@/services/sync/syncService', () => ({ getLastPersistedBytes: () => hooks.bytes }));

import { usePodHealth, DUE_BYTES } from '../usePodHealth';

describe('usePodHealth', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.assign(hooks, { isOwner: true, bytes: 0, members: [] });
  });

  it('reads a REAL byte size, not the stripped envelope', () => {
    hooks.bytes = DUE_BYTES + 1;
    expect(usePodHealth().podBytes.value).toBe(DUE_BYTES + 1);
    expect(usePodHealth().compactionIsDue.value).toBe(true);
  });

  it('is not due below the threshold', () => {
    hooks.bytes = DUE_BYTES - 1;
    expect(usePodHealth().compactionIsDue.value).toBe(false);
  });

  it('is due at the threshold exactly', () => {
    hooks.bytes = DUE_BYTES;
    expect(usePodHealth().compactionIsDue.value).toBe(true);
  });

  it('is due when a device could not open it, whatever the size says', () => {
    // A real failure outranks the heuristic: the threshold is a guess about
    // when this will happen, and the report is the thing itself.
    hooks.bytes = 1000;
    hooks.members = [{ id: 'm', name: 'Sam', podTooLargeSeenAt: new Date().toISOString() }];
    expect(usePodHealth().someoneCannotOpenIt.value).toBe(true);
    expect(usePodHealth().compactionIsDue.value).toBe(true);
  });

  it('ignores an out-of-memory report from years ago', () => {
    hooks.bytes = 1000;
    hooks.members = [{ id: 'm', name: 'Sam', podTooLargeSeenAt: '2024-03-04' }];
    expect(usePodHealth().compactionIsDue.value).toBe(false);
  });

  it('is OWNER-ONLY — greg decided that explicitly', () => {
    // One computed governs the note, the section and the button, so a note can
    // never appear for someone who cannot press what it points at.
    hooks.bytes = DUE_BYTES * 10;
    hooks.isOwner = false;
    expect(usePodHealth().canCompactPod.value).toBe(false);
    expect(usePodHealth().compactionIsDue.value).toBe(false);
  });

  it('survives an unknown size rather than reading it as zero-and-fine', () => {
    hooks.bytes = null;
    expect(usePodHealth().podBytes.value).toBe(0);
    expect(usePodHealth().compactionIsDue.value).toBe(false);
  });
});
