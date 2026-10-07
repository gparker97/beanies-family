/**
 * `usePodRecovery` truth table (#85). The Family Data recovery surfaces are shown by
 * `recoveryNeeded` once the session-role owner fallback is closed, so it must be true in
 * exactly the states the drawer can recover from (a settled load, empty roster, and a
 * pure-recovery sync status) and false in the boot window, on a loaded roster, and on a
 * configured pod whose drawer branch is the management section.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import type { FamilyMember } from '@/types/models';

const syncStatus = ref<string>('ready');

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    get syncStatus() {
      return syncStatus.value;
    },
  }),
}));

import { usePodRecovery } from '@/composables/usePodRecovery';
import { useFamilyDataAccess } from '@/composables/useFamilyDataAccess';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';

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

beforeEach(() => {
  setActivePinia(createPinia());
  syncStatus.value = 'ready';
});

describe('usePodRecovery — recoveryNeeded', () => {
  it('is true once a load has settled on an empty roster whose file permission was lost', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.settleRosterLoad();
    syncStatus.value = 'needs-permission';

    expect(usePodRecovery().recoveryNeeded.value).toBe(true);
  });

  it('is true once a load has settled on an empty roster with no provider config', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.settleRosterLoad();
    syncStatus.value = 'not-configured';

    expect(usePodRecovery().recoveryNeeded.value).toBe(true);
  });

  it('is false in the boot window, before any load settles, even while not configured', () => {
    useFamilyStore().members = [];
    syncStatus.value = 'not-configured';

    expect(usePodRecovery().recoveryNeeded.value).toBe(false);
  });

  it('is false for a settled empty roster on a configured pod that failed to load (the drawer would show management)', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.settleRosterLoad();
    syncStatus.value = 'error';

    expect(usePodRecovery().recoveryNeeded.value).toBe(false);
  });

  it('is false once a roster is loaded, even while permission is lost', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [member({ id: 'owner-1', role: 'owner' })];
    familyStore.settleRosterLoad();
    syncStatus.value = 'needs-permission';

    expect(usePodRecovery().recoveryNeeded.value).toBe(false);
  });

  it('is false again after resetState (a family switch)', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.settleRosterLoad();
    syncStatus.value = 'not-configured';
    const { recoveryNeeded } = usePodRecovery();
    expect(recoveryNeeded.value).toBe(true);

    familyStore.resetState();
    expect(recoveryNeeded.value).toBe(false);
  });
});

describe('useFamilyDataAccess — familyDataReachable', () => {
  it('is true for a forged owner session on a settled, unconfigured empty roster, while canManagePod is false', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [];
    familyStore.settleRosterLoad();
    syncStatus.value = 'not-configured';
    useAuthStore().currentUser = { memberId: 'ghost', email: 'x@y.z', role: 'owner' };

    const access = useFamilyDataAccess();
    expect(access.canManagePod.value).toBe(false);
    expect(access.familyDataReachable.value).toBe(true);
  });

  it('is false for a non-manager member on a loaded roster', () => {
    const familyStore = useFamilyStore();
    familyStore.members = [member({ id: 'owner-1', role: 'owner' }), member({ id: 'm1' })];
    familyStore.currentMemberId = 'm1';
    familyStore.settleRosterLoad();

    expect(useFamilyDataAccess().familyDataReachable.value).toBe(false);
  });
});
