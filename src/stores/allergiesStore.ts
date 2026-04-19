import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/allergyRepository';
import type { Allergy, AllergySeverity } from '@/types/models';

type CreateInput = Omit<Allergy, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

const SEVERITY_ORDER: Record<AllergySeverity, number> = { severe: 0, moderate: 1, mild: 2 };

export const useAllergiesStore = defineStore('allergies', () => {
  const allergies = ref<Allergy[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() => allergies.value.filter((a) => a.memberId === memberId));
  }

  /** All allergies across the family, sorted by severity (severe first). */
  const bySeverity = computed(() =>
    [...allergies.value].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  );

  async function loadAllergies() {
    await wrapAsync(isLoading, error, async () => {
      allergies.value = await repo.getAllAllergies();
    });
  }

  async function createAllergy(input: CreateInput): Promise<Allergy | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createAllergy(input);
      allergies.value = [...allergies.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateAllergy(id: string, input: UpdateInput): Promise<Allergy | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateAllergy(id, input);
      if (updated) allergies.value = allergies.value.map((a) => (a.id === id ? updated : a));
      return updated;
    });
    return result ?? null;
  }

  async function deleteAllergy(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteAllergy(id);
      allergies.value = allergies.value.filter((a) => a.id !== id);
    });
  }

  return {
    allergies,
    isLoading,
    error,
    byMember,
    bySeverity,
    loadAllergies,
    createAllergy,
    updateAllergy,
    deleteAllergy,
  };
});
