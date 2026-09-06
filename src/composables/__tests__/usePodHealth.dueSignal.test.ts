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

/**
 * ⚠️ THE ANSWER BELONGS ON THE PAGE, NOT BEHIND A BUTTON PRESS. The soak gate
 * used to be discoverable only by attempting a one-way, family-wide migration
 * and reading a toast that vanished a few seconds later. `olderVersion` puts the
 * same names in the section itself, before anything is pressed.
 */
describe('usePodHealth — who the soak gate is waiting on', () => {
  const TODAY = new Date().toISOString().slice(0, 10);

  beforeEach(() => {
    setActivePinia(createPinia());
    Object.assign(hooks, { isOwner: true, bytes: 0, members: [] });
  });

  it('names the members who have not been seen on a guard-honouring build', () => {
    hooks.members = [
      { id: 'm1', name: 'Greg', lastLoginAt: TODAY, lineageEpoch: 1 },
      { id: 'm2', name: 'Sam', lastLoginAt: TODAY },
      { id: 'm3', name: 'Alex', lastLoginAt: TODAY },
    ];
    expect(usePodHealth().olderVersion.value).toEqual(['Sam', 'Alex']);
  });

  it('is empty when everyone recently active has been seen', () => {
    // Anti-vacuity: a `olderVersion` that always listed everyone would satisfy the
    // test above and put a permanent caution on the page.
    hooks.members = [
      { id: 'm1', name: 'Greg', lastLoginAt: TODAY, lineageEpoch: 1 },
      { id: 'm2', name: 'Sam', lastLoginAt: TODAY, lineageEpoch: 1 },
    ];
    expect(usePodHealth().olderVersion.value).toEqual([]);
  });

  it('does not wait on someone who has not signed in for months', () => {
    // A child's account created and never opened, or a member who left, must
    // not hold their family's compaction open forever.
    hooks.members = [
      { id: 'm1', name: 'Greg', lastLoginAt: TODAY, lineageEpoch: 1 },
      { id: 'm2', name: 'Sam', lastLoginAt: '2024-01-01' },
    ];
    expect(usePodHealth().olderVersion.value).toEqual([]);
  });
});
