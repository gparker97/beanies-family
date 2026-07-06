import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';
import type { FamilyMember, OverlapAck } from '@/types/models';
import { overlapAckKey } from '@/utils/calendar/clashDetection';

// ── Mutable mocks (ADR-032: store reads projection, writes via docClient) ─────
const viewer = {
  id: 'v',
  name: 'V',
  ageGroup: 'adult',
  role: 'member',
  isPet: false,
} as FamilyMember;
let currentMember: FamilyMember | undefined = viewer;
const acks: Record<string, OverlapAck> = {};
let docLoaded = true;
const reportErrorSpy = vi.fn();

vi.mock('@/services/automerge/docService', () => ({
  docVersion: ref(0),
  isDocLoaded: () => docLoaded,
}));
vi.mock('@/services/automerge/projection', () => ({
  getById: (collection: string, id: string) =>
    collection === 'overlapAcknowledgments' ? acks[id] : undefined,
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  mutate: async (op: { op: string; id: string; entity?: OverlapAck }) => {
    if (op.op === 'set') acks[op.id] = op.entity!;
    else if (op.op === 'delete') delete acks[op.id];
  },
}));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return currentMember;
    },
  }),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: (i: unknown) => reportErrorSpy(i) }));

import { useOverlapAckStore } from '@/stores/overlapAckStore';

const KEY = overlapAckKey('a1', '2026-06-11', 'conn-1');
// The store's acknowledge/unacknowledge are fire-and-forget (void applyChange
// awaiting docClient.mutate) — flush microtasks to observe the async write.
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  setActivePinia(createPinia());
  currentMember = viewer;
  docLoaded = true;
  for (const k of Object.keys(acks)) delete acks[k];
  reportErrorSpy.mockClear();
});

describe('overlapAckStore', () => {
  it('acknowledge writes one keyed entry; isAcknowledged matches only the same fingerprint', async () => {
    const s = useOverlapAckStore();
    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-1')).toBe(false);

    s.acknowledge('a1', '2026-06-11', 'conn-1', 'fp-1');
    await flush();
    const entry = acks[KEY]!;
    expect(entry).toMatchObject({
      activityId: 'a1',
      occurrenceDate: '2026-06-11',
      connectionId: 'conn-1',
      fingerprint: 'fp-1',
      acknowledgedBy: 'v',
    });
    expect(entry.acknowledgedAt).toBeTruthy();

    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-1')).toBe(true);
    // Rescheduled → fingerprint changed → re-raises (not acknowledged).
    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-2')).toBe(false);
  });

  it('unacknowledge removes the entry (Undo re-raises)', async () => {
    const s = useOverlapAckStore();
    s.acknowledge('a1', '2026-06-11', 'conn-1', 'fp-1');
    await flush();
    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-1')).toBe(true);

    s.unacknowledge('a1', '2026-06-11', 'conn-1');
    await flush();
    expect(acks[KEY]).toBeUndefined();
    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-1')).toBe(false);
  });

  it('isAcknowledged is a throw-free no-op for empty-string args / no doc', () => {
    const s = useOverlapAckStore();
    expect(s.isAcknowledged('', '', '', '')).toBe(false);
    docLoaded = false;
    expect(s.isAcknowledged('a1', '2026-06-11', 'conn-1', 'fp-1')).toBe(false);
  });

  it('acknowledge with no loaded doc reports a warning and does not write', async () => {
    docLoaded = false;
    const s = useOverlapAckStore();
    expect(() => s.acknowledge('a1', '2026-06-11', 'conn-1', 'fp-1')).not.toThrow();
    await flush();
    expect(acks[KEY]).toBeUndefined();
    expect(reportErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', surface: 'overlap-ack-acknowledge' })
    );
  });

  it('acknowledge with no current member reports a warning and does not write', async () => {
    currentMember = undefined;
    const s = useOverlapAckStore();
    s.acknowledge('a1', '2026-06-11', 'conn-1', 'fp-1');
    await flush();
    expect(acks[KEY]).toBeUndefined();
    expect(reportErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', surface: 'overlap-ack-acknowledge' })
    );
  });
});
