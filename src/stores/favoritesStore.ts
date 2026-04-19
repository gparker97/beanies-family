import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as repo from '@/services/automerge/repositories/favoriteRepository';
import type { FavoriteItem } from '@/types/models';

type CreateInput = Omit<FavoriteItem, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<FavoriteItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  function byMember(memberId: string) {
    return computed(() => favorites.value.filter((f) => f.memberId === memberId));
  }

  async function loadFavorites() {
    await wrapAsync(isLoading, error, async () => {
      favorites.value = await repo.getAllFavorites();
    });
  }

  async function createFavorite(input: CreateInput): Promise<FavoriteItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const created = await repo.createFavorite(input);
      favorites.value = [...favorites.value, created];
      return created;
    });
    return result ?? null;
  }

  async function updateFavorite(id: string, input: UpdateInput): Promise<FavoriteItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await repo.updateFavorite(id, input);
      if (updated) {
        favorites.value = favorites.value.map((f) => (f.id === id ? updated : f));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteFavorite(id: string): Promise<void> {
    await wrapAsync(isLoading, error, async () => {
      await repo.deleteFavorite(id);
      favorites.value = favorites.value.filter((f) => f.id !== id);
    });
  }

  return {
    favorites,
    isLoading,
    error,
    byMember,
    loadFavorites,
    createFavorite,
    updateFavorite,
    deleteFavorite,
  };
});
