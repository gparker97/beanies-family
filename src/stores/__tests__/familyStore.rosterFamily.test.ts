/**
 * The roster carries the family it was read for (#82).
 *
 * This is the load-bearing guard against cross-family key deletion, and it had no
 * store-side coverage: the reconcile's own tests exercise the guard thoroughly and the
 * wiring that feeds it not at all. Without these cases, replacing the pre-read capture
 * with a post-await `getActiveFamilyId()` — which reintroduces exactly the divergence
 * the guard exists to close — leaves the whole suite green.
 *
 * Why the divergence is real: `activateFamily` flips the active family and then awaits an
 * IndexedDB write, so for that window the registry says B while the roster in the store
 * still describes A. Judging A's roster against B's adopted keys would delete B's live
 * biometric enrolments.
 */
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
vi.mock('@/services/automerge/projection', () => ({ getById: vi.fn(() => ({})) }));
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/services/auth/rosterCache', () => ({ refreshRosterCache: vi.fn(async () => {}) }));

const { reconcileMock } = vi.hoisted(() => ({
  reconcileMock: vi.fn(
    async (
      _familyId: string | null,
      _roster: { id: string; name: string }[],
      _signedInMemberId: string | null
    ) => {}
  ),
}));
vi.mock('@/services/auth/passkeyService', () => ({
  reconcileDeviceKeysWithRoster: reconcileMock,
}));

const { activeFamilyId } = vi.hoisted(() => ({ activeFamilyId: { value: 'family-A' } }));
vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => activeFamilyId.value),
}));

const authState = vi.hoisted(() => ({
  currentUser: { memberId: 'member-1' } as { memberId: string } | null,
  isAuthenticated: true,
  invalidateSession: vi.fn(),
  confirmSessionMember: vi.fn(),
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: vi.fn(() => authState) }));

import { useFamilyStore } from '@/stores/familyStore';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';

function member(id: string, role: FamilyMember['role'] = 'owner'): FamilyMember {
  return {
    id,
    name: `Bean ${id}`,
    email: `${id}@example.com`,
    role,
    color: '#F15D22',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  } as FamilyMember;
}

/** Let Vue's pre-flush watcher queue drain. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('rosterFamilyId — the roster names its own family (#82)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    activeFamilyId.value = 'family-A';
    authState.currentUser = { memberId: 'member-1' };
    vi.mocked(familyRepo.getAllFamilyMembers).mockResolvedValue([member('member-1')]);
  });

  it('is captured at load and handed to the keystore reconcile', async () => {
    const store = useFamilyStore();
    await store.loadMembers();
    await flush();

    expect(store.rosterFamilyId).toBe('family-A');
    expect(reconcileMock).toHaveBeenCalled();
    expect(reconcileMock.mock.calls.at(-1)![0]).toBe('family-A');
  });

  it('names the family the members were READ for, not whatever became active during the read', async () => {
    // This is the case the pre-read capture exists for. If the id were resolved after the
    // await, this roster would arrive labelled `family-B` and family B's adopted keys
    // would be judged against family A's members.
    vi.mocked(familyRepo.getAllFamilyMembers).mockImplementation(async () => {
      activeFamilyId.value = 'family-B'; // a switch lands mid-read
      return [member('member-1')];
    });

    const store = useFamilyStore();
    await store.loadMembers();
    await flush();

    expect(store.rosterFamilyId).toBe('family-A');
    expect(reconcileMock.mock.calls.at(-1)![0]).toBe('family-A');
  });

  it('is cleared by resetState, so a post-sign-out fire names no family at all', async () => {
    const store = useFamilyStore();
    await store.loadMembers();
    expect(store.rosterFamilyId).toBe('family-A');

    store.resetState();
    await flush();

    expect(store.rosterFamilyId).toBeNull();
  });

  it('is null before any load, so nothing can be reconciled against an unnamed roster', () => {
    const store = useFamilyStore();
    expect(store.rosterFamilyId).toBeNull();
  });

  it('passes the signed-in member, so the reconcile can tell a real roster from a partial paint', async () => {
    const store = useFamilyStore();
    await store.loadMembers();
    await flush();

    const [, roster, signedInMemberId] = reconcileMock.mock.calls.at(-1)!;
    expect(roster.map((m) => m.id)).toEqual(['member-1']);
    // The whole reason `currentMemberId` is a watcher source: the roster is published
    // before the session member resolves, so watching the roster alone always ran with
    // this null and the reconcile was deterministically skipped on the first publish.
    expect(signedInMemberId).toBe('member-1');
  });
});
