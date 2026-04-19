<script setup lang="ts">
/**
 * Favorites tab — grid of FavoriteItem cards for this bean, plus an
 * AddTile to open the FavoriteFormModal. Cards are clickable and open
 * the same modal in edit mode.
 */
import { computed, ref } from 'vue';
import AddTile from '@/components/pod/shared/AddTile.vue';
import EmptyState from '@/components/pod/shared/EmptyState.vue';
import FavoriteFormModal from '@/components/pod/FavoriteFormModal.vue';
import { useAutoOpenOnQuery } from '@/composables/useAutoOpenOnQuery';
import { useTranslation } from '@/composables/useTranslation';
import { useFavoritesStore } from '@/stores/favoritesStore';
import type { FavoriteCategory, FavoriteItem, UUID } from '@/types/models';

const props = defineProps<{
  memberId: UUID;
}>();

const { t } = useTranslation();
const favoritesStore = useFavoritesStore();

const favorites = computed(() => favoritesStore.byMember(props.memberId).value);

const modalOpen = ref(false);
const editing = ref<FavoriteItem | null>(null);
useAutoOpenOnQuery(modalOpen);

const CATEGORY_EMOJI: Record<FavoriteCategory, string> = {
  food: '\u{1F35C}',
  place: '\u{1F4CD}',
  book: '\u{1F4DA}',
  song: '\u{1F3B5}',
  toy: '\u{1F9F8}',
  other: '\u2728',
};

function openAdd(): void {
  editing.value = null;
  modalOpen.value = true;
}

function openEdit(f: FavoriteItem): void {
  editing.value = f;
  modalOpen.value = true;
}

function closeModal(): void {
  modalOpen.value = false;
  editing.value = null;
}
</script>

<template>
  <div>
    <div v-if="favorites.length" class="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      <button
        v-for="f in favorites"
        :key="f.id"
        type="button"
        class="flex flex-col items-start gap-2 rounded-[var(--sq)] bg-white p-4 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
        @click="openEdit(f)"
      >
        <span class="text-2xl" aria-hidden="true">{{ CATEGORY_EMOJI[f.category] }}</span>
        <h4 class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
          {{ f.name }}
        </h4>
        <p
          v-if="f.description"
          class="font-outfit text-secondary-500/70 line-clamp-3 text-sm dark:text-gray-400"
        >
          {{ f.description }}
        </p>
        <span
          class="font-outfit text-secondary-500/50 mt-auto text-[11px] font-semibold tracking-wide uppercase"
        >
          {{ t(`favorites.category.${f.category}`) }}
        </span>
      </button>
      <AddTile :label="t('favorites.addTile')" @click="openAdd" />
    </div>
    <div
      v-else
      class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <EmptyState
        emoji="💝"
        :message="t('favorites.empty')"
        :action-label="t('favorites.emptyCTA')"
        @action="openAdd"
      />
    </div>

    <FavoriteFormModal
      :open="modalOpen"
      :member-id="memberId"
      :favorite="editing"
      @close="closeModal"
    />
  </div>
</template>
