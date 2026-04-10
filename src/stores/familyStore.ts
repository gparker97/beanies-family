import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import * as familyRepo from '@/services/automerge/repositories/familyMemberRepository';
import { wrapAsync } from '@/composables/useStoreActions';
import type {
  FamilyMember,
  CreateFamilyMemberInput,
  UpdateFamilyMemberInput,
} from '@/types/models';

export const useFamilyStore = defineStore('family', () => {
  // State
  const members = ref<FamilyMember[]>([]);
  const currentMemberId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const currentMember = computed(() => members.value.find((m) => m.id === currentMemberId.value));

  const owner = computed(() => members.value.find((m) => m.role === 'owner'));

  const hasOwner = computed(() => !!owner.value);

  const isSetupComplete = computed(() => hasOwner.value || members.value.length > 0);

  /** Members sorted: adults first (oldest→youngest), then children, alphabetical fallback */
  const sortedMembers = computed(() =>
    [...members.value].sort((a, b) => {
      if (a.ageGroup !== b.ageGroup) return a.ageGroup === 'adult' ? -1 : 1;
      const yearA = a.dateOfBirth?.year ?? Infinity;
      const yearB = b.dateOfBirth?.year ?? Infinity;
      if (yearA !== yearB) return yearA - yearB;
      return a.name.localeCompare(b.name);
    })
  );

  // Diagnostic: track permission changes on currentMember
  watch(currentMember, (newMember, oldMember) => {
    if (!oldMember || !newMember) return;
    if (oldMember.id !== newMember.id) {
      console.warn(
        '[familyStore] currentMember changed identity:',
        oldMember.id,
        '→',
        newMember.id
      );
    }
    if (oldMember.canViewFinances !== newMember.canViewFinances) {
      console.warn(
        '[familyStore] canViewFinances changed:',
        oldMember.canViewFinances,
        '→',
        newMember.canViewFinances,
        'member:',
        newMember.id,
        newMember.name
      );
    }
    if (oldMember.canEditActivities !== newMember.canEditActivities) {
      console.warn(
        '[familyStore] canEditActivities changed:',
        oldMember.canEditActivities,
        '→',
        newMember.canEditActivities,
        'member:',
        newMember.id,
        newMember.name
      );
    }
    if (oldMember.canManagePod !== newMember.canManagePod) {
      console.warn(
        '[familyStore] canManagePod changed:',
        oldMember.canManagePod,
        '→',
        newMember.canManagePod,
        'member:',
        newMember.id,
        newMember.name
      );
    }
  });

  // Actions
  async function loadMembers() {
    await wrapAsync(isLoading, error, async () => {
      const prevMemberId = currentMemberId.value;
      members.value = await familyRepo.getAllFamilyMembers();

      // Restore currentMemberId: prefer authStore session, then previous value, then owner
      if (!currentMemberId.value) {
        // Try restoring from authStore session (survives page refresh via localStorage)
        try {
          const { useAuthStore } = await import('@/stores/authStore');
          const authStore = useAuthStore();
          const sessionMemberId = authStore.currentUser?.memberId;
          if (sessionMemberId && members.value.some((m) => m.id === sessionMemberId)) {
            currentMemberId.value = sessionMemberId;
            return;
          }
        } catch {
          // authStore not available yet — fall through
        }
        // Fallback to owner
        if (owner.value) {
          currentMemberId.value = owner.value.id;
        }
      } else if (!members.value.some((m) => m.id === currentMemberId.value)) {
        // currentMemberId no longer in members array — this shouldn't happen
        console.warn(
          '[familyStore] currentMemberId not found in members after reload:',
          currentMemberId.value,
          'members:',
          members.value.map((m) => m.id)
        );
        // Try authStore session
        try {
          const { useAuthStore } = await import('@/stores/authStore');
          const authStore = useAuthStore();
          const sessionMemberId = authStore.currentUser?.memberId;
          if (sessionMemberId && members.value.some((m) => m.id === sessionMemberId)) {
            currentMemberId.value = sessionMemberId;
            return;
          }
        } catch {
          // fall through
        }
        // Last resort: owner
        currentMemberId.value = owner.value?.id ?? prevMemberId;
      }
    });
  }

  async function createMember(input: CreateFamilyMemberInput): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const member = await familyRepo.createFamilyMember(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      members.value = [...members.value, member];
      return member;
    });
    return result ?? null;
  }

  async function updateMember(
    id: string,
    input: UpdateFamilyMemberInput
  ): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await familyRepo.updateFamilyMember(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        members.value = members.value.map((m) => (m.id === id ? updated : m));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteMember(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await familyRepo.deleteFamilyMember(id);
      if (success) {
        members.value = members.value.filter((m) => m.id !== id);
        if (currentMemberId.value === id) {
          currentMemberId.value = owner.value?.id ?? null;
        }
      }
      return success;
    });
    return result ?? false;
  }

  async function updateMemberRole(
    id: string,
    role: 'admin' | 'member'
  ): Promise<FamilyMember | null> {
    const member = members.value.find((m) => m.id === id);
    if (!member || member.role === 'owner') {
      return null;
    }
    return updateMember(id, { role });
  }

  function setCurrentMember(id: string) {
    if (members.value.some((m) => m.id === id)) {
      currentMemberId.value = id;
    }
  }

  function resetState() {
    members.value = [];
    currentMemberId.value = null;
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    members,
    currentMemberId,
    isLoading,
    error,
    // Getters
    currentMember,
    owner,
    hasOwner,
    isSetupComplete,
    sortedMembers,
    // Actions
    loadMembers,
    createMember,
    updateMember,
    deleteMember,
    updateMemberRole,
    setCurrentMember,
    resetState,
  };
});
