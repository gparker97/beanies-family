import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as familyContext from '@/services/familyContext';
import type { Family } from '@/types/models';

export const useFamilyContextStore = defineStore('familyContext', () => {
  // State
  const activeFamily = ref<Family | null>(null);
  const allFamilies = ref<Family[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const activeFamilyId = computed(() => activeFamily.value?.id ?? null);
  const activeFamilyName = computed(() => activeFamily.value?.name ?? null);
  const hasFamilies = computed(() => allFamilies.value.length > 0);

  // Actions

  /**
   * Load all families and resolve the last active family.
   * Returns the active family, or null if none exists.
   */
  async function initialize(): Promise<Family | null> {
    isLoading.value = true;
    error.value = null;
    try {
      allFamilies.value = await familyContext.getAllFamilies();

      const lastActive = await familyContext.getLastActiveFamily();
      if (lastActive) {
        activeFamily.value = lastActive;
        await familyContext.activateFamily(lastActive.id);
      }

      return activeFamily.value;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to initialize family context';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Switch to a different family.
   */
  async function switchFamily(familyId: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const family = await familyContext.activateFamily(familyId);
      if (family) {
        activeFamily.value = family;
        return true;
      }
      error.value = 'Family not found';
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to switch family';
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Create a new family and activate it.
   */
  async function createFamily(name: string): Promise<Family | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const family = await familyContext.createNewFamily(name);
      activeFamily.value = family;
      allFamilies.value.push(family);
      return family;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create family';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Create a family with a specific ID and activate it.
   * Used when auth resolves a familyId that isn't in the local registry.
   */
  async function createFamilyWithId(familyId: string, name: string): Promise<Family | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const family = await familyContext.createFamilyWithId(familyId, name);
      activeFamily.value = family;
      if (!allFamilies.value.some((f) => f.id === family.id)) {
        allFamilies.value.push(family);
      }
      return family;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create family';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Update the active family's name.
   */
  async function updateFamilyName(name: string): Promise<boolean> {
    if (!activeFamily.value) {
      error.value = 'No active family';
      return false;
    }

    try {
      const updated = await familyContext.updateFamilyName(activeFamily.value.id, name);
      if (updated) {
        activeFamily.value = updated;
        const index = allFamilies.value.findIndex((f) => f.id === updated.id);
        if (index !== -1) {
          allFamilies.value[index] = updated;
        }
        return true;
      }
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update family name';
      return false;
    }
  }

  /**
   * Delete all local data for a family and remove it from the registry.
   * Cannot delete the currently active family.
   */
  async function deleteLocalFamily(familyId: string): Promise<boolean> {
    try {
      await familyContext.deleteLocalFamily(familyId);
      allFamilies.value = allFamilies.value.filter((f) => f.id !== familyId);
      if (activeFamily.value?.id === familyId) {
        activeFamily.value = null;
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete family';
      return false;
    }
  }

  /**
   * Reload the families list.
   */
  async function reload(): Promise<void> {
    allFamilies.value = await familyContext.getAllFamilies();
  }

  return {
    // State
    activeFamily,
    allFamilies,
    isLoading,
    error,
    // Getters
    activeFamilyId,
    activeFamilyName,
    hasFamilies,
    // Actions
    initialize,
    switchFamily,
    createFamily,
    createFamilyWithId,
    updateFamilyName,
    deleteLocalFamily,
    reload,
  };
});
