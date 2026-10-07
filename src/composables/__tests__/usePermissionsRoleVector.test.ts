/**
 * The `role` forgery vector (#80).
 *
 * `usePermissions` used to fall back to the SESSION's `role` whenever `currentMember` was
 * null, so editing one localStorage field to `"role": "owner"` granted owner rights
 * outright — without touching `memberId`, and without needing the forged id to name a real
 * member. The fallback now survives only until a load attempt settles
 * (`familyStore.rosterLoadSettled`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { usePermissions } from '@/composables/usePermissions';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import type { FamilyMember } from '@/types/models';

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

describe('usePermissions — the forged-role vector', () => {
  it('does NOT confer owner from the session role once a roster is loaded', () => {
    const familyStore = useFamilyStore();
    const authStore = useAuthStore();
    // A real pod, and the forger is not in it (or is not the owner).
    familyStore.members = [member({ id: 'owner-1', role: 'owner' }), member({ id: 'm1' })];
    familyStore.currentMemberId = null;
    authStore.currentUser = { memberId: 'ghost', email: 'x@y.z', role: 'owner' };

    expect(usePermissions().isOwner.value).toBe(false);
  });

  it('still confers owner before a load settles (boot window / signup)', () => {
    const familyStore = useFamilyStore();
    const authStore = useAuthStore();
    familyStore.members = [];
    authStore.currentUser = { memberId: 'm1', email: 'x@y.z', role: 'owner' };

    expect(usePermissions().isOwner.value).toBe(true);
  });

  it('does NOT confer owner from the session role once a load settles on an empty roster (#85)', () => {
    const familyStore = useFamilyStore();
    const authStore = useAuthStore();
    // The pod failed to open (lost file access, lost provider config): the load settled
    // and found nothing, so the forgeable session `role` must not stand in for the doc.
    familyStore.members = [];
    familyStore.settleRosterLoad();
    authStore.currentUser = { memberId: 'm1', email: 'x@y.z', role: 'owner' };

    const { isOwner, canManagePod, canViewFinances, canEditActivities } = usePermissions();
    expect(isOwner.value).toBe(false);
    expect(canManagePod.value).toBe(false);
    expect(canViewFinances.value).toBe(false);
    expect(canEditActivities.value).toBe(false);
  });

  it('reads owner from the loaded doc, not the session', () => {
    const familyStore = useFamilyStore();
    const authStore = useAuthStore();
    familyStore.members = [member({ id: 'm1', role: 'owner' })];
    familyStore.currentMemberId = 'm1';
    // Session claims nothing; the doc is the authority.
    authStore.currentUser = { memberId: 'm1', email: 'x@y.z', role: 'member' };

    expect(usePermissions().isOwner.value).toBe(true);
  });
});
