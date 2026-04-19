import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/sayingRepository';
import type { SayingItem } from '@/types/models';

type CreateInput = Omit<SayingItem, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useSayingsStore = defineStore('sayings', () => {
  const sayings = ref<SayingItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() =>
      sayings.value.filter((s) => s.memberId === memberId || s.aboutMemberId === memberId)
    );
  }

  const recent = computed(() =>
    [...sayings.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  async function loadSayings() {
    await wrapAsync(isLoading, error, async () => {
      sayings.value = await repo.getAllSayings();
    });
  }

  async function createSaying(input: CreateInput): Promise<SayingItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createSaying(input);
      sayings.value = [...sayings.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateSaying(id: string, input: UpdateInput): Promise<SayingItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateSaying(id, input);
      if (updated) {
        sayings.value = sayings.value.map((s) => (s.id === id ? updated : s));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteSaying(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteSaying(id);
      sayings.value = sayings.value.filter((s) => s.id !== id);
    });
  }

  return {
    sayings,
    isLoading,
    error,
    byMember,
    recent,
    loadSayings,
    createSaying,
    updateSaying,
    deleteSaying,
  };
});
