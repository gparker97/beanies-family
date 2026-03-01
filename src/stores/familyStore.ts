import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as familyRepo from '@/services/indexeddb/repositories/familyMemberRepository';
import { useTombstoneStore } from './tombstoneStore';
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

  // Actions
  async function loadMembers() {
    await wrapAsync(isLoading, error, async () => {
      members.value = await familyRepo.getAllFamilyMembers();
      // Set current member to owner if not set
      if (!currentMemberId.value && owner.value) {
        currentMemberId.value = owner.value.id;
      }
    });
  }

  async function createMember(input: CreateFamilyMemberInput): Promise<FamilyMember | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const member = await familyRepo.createFamilyMember(input);
      members.value.push(member);
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
        const index = members.value.findIndex((m) => m.id === id);
        if (index !== -1) {
          members.value[index] = updated;
        }
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteMember(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await familyRepo.deleteFamilyMember(id);
      if (success) {
        useTombstoneStore().recordDeletion('familyMember', id);
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
