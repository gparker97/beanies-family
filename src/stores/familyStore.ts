import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as familyRepo from '@/services/indexeddb/repositories/familyMemberRepository';
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

  const isSetupComplete = computed(() => hasOwner.value);

  // Actions
  async function loadMembers() {
    isLoading.value = true;
    error.value = null;
    try {
      members.value = await familyRepo.getAllFamilyMembers();
      // Set current member to owner if not set
      if (!currentMemberId.value && owner.value) {
        currentMemberId.value = owner.value.id;
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load family members';
    } finally {
      isLoading.value = false;
    }
  }

  async function createMember(input: CreateFamilyMemberInput): Promise<FamilyMember | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const member = await familyRepo.createFamilyMember(input);
      members.value.push(member);
      return member;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create family member';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateMember(
    id: string,
    input: UpdateFamilyMemberInput
  ): Promise<FamilyMember | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await familyRepo.updateFamilyMember(id, input);
      if (updated) {
        const index = members.value.findIndex((m) => m.id === id);
        if (index !== -1) {
          members.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update family member';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteMember(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await familyRepo.deleteFamilyMember(id);
      if (success) {
        members.value = members.value.filter((m) => m.id !== id);
        if (currentMemberId.value === id) {
          currentMemberId.value = owner.value?.id ?? null;
        }
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete family member';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  function setCurrentMember(id: string) {
    if (members.value.some((m) => m.id === id)) {
      currentMemberId.value = id;
    }
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
    setCurrentMember,
  };
});
