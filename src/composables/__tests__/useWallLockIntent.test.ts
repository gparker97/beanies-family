/**
 * The wall lock's THREE disagreeing predicates (#80 review).
 *
 * `canVerifyIdentity` decided whether to challenge, `canUnlock` decided whether the
 * challenge would open, and `onVerified` unlocked unconditionally. Each was individually
 * defensible; together they produced a permanently dead Leave button on a chrome-free
 * route, and a child's own PIN unlocking a wall the adult-only filter exists to protect.
 *
 * These tests pin the INTENT contract that reconciled them.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useWallLock } from '@/composables/useWallLock';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyMember } from '@/types/models';

vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

function member(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Bean',
    email: 'b@example.com',
    gender: 'other',
    ageGroup: 'adult',
    role: 'member',
    color: '#000',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FamilyMember;
}

beforeEach(() => setActivePinia(createPinia()));

describe('useWallLock — intent decides both the gate and the grant', () => {
  /**
   * The strand. Child Leo has a PIN; both parents are legacy password-only, so
   * `unlockCandidates` (adults WITH a pinHash) is empty and `canUnlock` is false, while
   * `canVerifyIdentity` is true because Leo can prove he is Leo. `WallSetupCard` lets Leo
   * start the wall, so this configuration is reachable, and /wall has no other exit.
   */
  it('opens the challenge to LEAVE even when nobody can unlock edits', () => {
    const familyStore = useFamilyStore();
    const leo = member({ id: 'leo', ageGroup: 'child', pinHash: 'hash-leo' });
    familyStore.members = [
      leo,
      member({ id: 'mum', passwordHash: 'pw' }),
      member({ id: 'dad', passwordHash: 'pw' }),
    ];
    familyStore.currentMemberId = 'leo';

    const lock = useWallLock();
    expect(lock.canUnlock.value).toBe(false);
    expect(lock.canVerifyIdentity.value).toBe(true);

    // Gated on canUnlock, this returned without opening anything — Leave was a no-op
    // forever, on a route with no sidebar, header or nav.
    expect(lock.requestUnlock('leave')).toBe(true);
    expect(lock.challengeOpen.value).toBe(true);
  });

  it('still refuses to open an UNLOCK challenge nobody can satisfy', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [member({ id: 'leo', ageGroup: 'child', pinHash: 'hash-leo' })];
    familyStore.currentMemberId = 'leo';

    const lock = useWallLock();
    expect(lock.requestUnlock('unlock')).toBe(false);
    expect(lock.challengeOpen.value).toBe(false);
  });

  /**
   * Proving identity in order to LEAVE must not also unlock editing. The leave challenge's
   * candidate list is the session member alone — not `unlockCandidates` — so an
   * unconditional unlock handed a child's PIN the adult capability.
   */
  it('verifying to LEAVE does not unlock editing', () => {
    const familyStore = useFamilyStore();
    const leo = member({ id: 'leo', ageGroup: 'child', pinHash: 'hash-leo' });
    familyStore.members = [leo, member({ id: 'mum', pinHash: 'hash-mum' })];
    familyStore.currentMemberId = 'leo';

    const lock = useWallLock();
    expect(lock.isLocked.value).toBe(true);
    lock.onVerified(leo, 'leave');
    expect(lock.isLocked.value).toBe(true);
    expect(lock.challengeOpen.value).toBe(false);
  });

  it('verifying to UNLOCK does unlock editing, and records who did it', () => {
    const familyStore = useFamilyStore();
    const mum = member({ id: 'mum', pinHash: 'hash-mum' });
    familyStore.members = [mum, member({ id: 'dad', pinHash: 'hash-dad' })];
    familyStore.currentMemberId = 'dad';

    const lock = useWallLock();
    lock.onVerified(mum, 'unlock');
    expect(lock.isLocked.value).toBe(false);
    expect(lock.unlockedBy.value?.id).toBe('mum');
  });
});
