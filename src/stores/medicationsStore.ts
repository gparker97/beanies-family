import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/medicationRepository';
import type { Medication } from '@/types/models';

type CreateInput = Omit<Medication, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useMedicationsStore = defineStore('medications', () => {
  const medications = ref<Medication[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() => medications.value.filter((m) => m.memberId === memberId));
  }

  /**
   * A medication is "active" when it's either ongoing or today is within
   * [startDate, endDate]. Undated medications are treated as active.
   */
  const active = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return medications.value.filter((m) => {
      if (m.ongoing) return true;
      if (m.endDate && m.endDate < today) return false;
      if (m.startDate && m.startDate > today) return false;
      return true;
    });
  });

  async function loadMedications() {
    await wrapAsync(isLoading, error, async () => {
      medications.value = await repo.getAllMedications();
    });
  }

  async function createMedication(input: CreateInput): Promise<Medication | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createMedication(input);
      medications.value = [...medications.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateMedication(id: string, input: UpdateInput): Promise<Medication | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateMedication(id, input);
      if (updated) {
        medications.value = medications.value.map((m) => (m.id === id ? updated : m));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteMedication(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteMedication(id);
      medications.value = medications.value.filter((m) => m.id !== id);
    });
  }

  return {
    medications,
    isLoading,
    error,
    byMember,
    active,
    loadMedications,
    createMedication,
    updateMedication,
    deleteMedication,
  };
});
