<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import ListShelf from '@/components/lists/ListShelf.vue';
import ListDetailModal from '@/components/lists/ListDetailModal.vue';
import NewListSheet from '@/components/lists/NewListSheet.vue';
import type { FamilyList, ListCategory } from '@/types/models';

const { t } = useTranslation();
const listStore = useListStore();
const { categoryLabel, categoryShortLabel } = useListCategoryLabel();
const route = useRoute();

onMounted(() => {
  void listStore.loadLists();
});

const selectedCategory = ref<ListCategory | null>(null);
const selectedListId = ref<string | null>(null);
const showNew = ref(false);
const completedCollapsed = ref(true);

// Open a list deep-linked via ?view=<id> (e.g. from a notification).
watch(
  () => route.query.view,
  (v) => {
    if (typeof v === 'string' && v) selectedListId.value = v;
  },
  { immediate: true }
);

// Quick-Add deep link (`/lists?action=add-list`) opens the new-list sheet.
useQuickAddIntent((action) => {
  if (action === 'add-list') showNew.value = true;
});

interface Shelf {
  key: string;
  title: string;
  emoji?: string;
  lists: FamilyList[];
}

const dueSoon = computed(() =>
  listStore.dueSoonLists.filter(
    (l) => !selectedCategory.value || l.category === selectedCategory.value
  )
);

const shelves = computed<Shelf[]>(() => {
  const out: Shelf[] = [];
  if (dueSoon.value.length) {
    out.push({ key: 'due', title: t('lists.shelf.dueSoon'), emoji: '⏰', lists: dueSoon.value });
  }
  const dueIds = new Set(dueSoon.value.map((l) => l.id));
  for (const cat of LIST_CATEGORIES) {
    if (selectedCategory.value && cat.id !== selectedCategory.value) continue;
    const lists = (listStore.listsByCategory.get(cat.id) ?? []).filter((l) => !dueIds.has(l.id));
    if (lists.length)
      out.push({ key: cat.id, title: categoryLabel(cat.id), emoji: cat.emoji, lists });
  }
  return out;
});

const completed = computed(() =>
  listStore.completedLists.filter(
    (l) => !selectedCategory.value || l.category === selectedCategory.value
  )
);

const isEmpty = computed(
  () => listStore.activeLists.length === 0 && listStore.completedLists.length === 0
);

function openList(id: string): void {
  selectedListId.value = id;
}
function onCreated(id: string): void {
  selectedListId.value = id;
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <PageWelcomeSubtitle :text="t('lists.welcomeSubtitle')" />
      <BaseButton variant="primary" size="sm" @click="showNew = true">
        ＋ {{ t('lists.newList') }}
      </BaseButton>
    </div>

    <!-- Empty state -->
    <div v-if="isEmpty" class="py-12 text-center">
      <EmptyStateIllustration variant="lists" class="mb-4" />
      <p class="mb-1 text-sm font-semibold text-[var(--color-text)]">
        {{ t('lists.empty.title') }}
      </p>
      <p class="mb-4 text-sm text-[var(--color-text-muted)]">{{ t('lists.empty.body') }}</p>
      <BaseButton variant="primary" @click="showNew = true">＋ {{ t('lists.newList') }}</BaseButton>
    </div>

    <template v-else>
      <!-- Filter chips -->
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            selectedCategory === null
              ? 'border-transparent bg-[var(--color-foundation)] text-white'
              : 'border-[var(--color-border)] bg-white text-[var(--color-text-muted)] dark:bg-slate-800'
          "
          @click="selectedCategory = null"
        >
          {{ t('lists.filter.all') }}
        </button>
        <button
          v-for="cat in LIST_CATEGORIES"
          :key="cat.id"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
          :class="
            selectedCategory === cat.id
              ? 'border-transparent bg-[var(--color-foundation)] text-white'
              : 'border-[var(--color-border)] bg-white text-[var(--color-text-muted)] dark:bg-slate-800'
          "
          @click="selectedCategory = cat.id"
        >
          <span aria-hidden="true">{{ cat.emoji }}</span> {{ categoryShortLabel(cat.id) }}
        </button>
      </div>

      <!-- Shelves -->
      <ListShelf
        v-for="shelf in shelves"
        :key="shelf.key"
        :title="shelf.title"
        :emoji="shelf.emoji"
        :lists="shelf.lists"
        :label-class="shelf.key === 'due' ? 'text-[var(--color-primary-500)]' : ''"
        @open="openList"
      />

      <!-- Completed (collapsible) -->
      <ListShelf
        v-if="completed.length"
        v-model:collapsed="completedCollapsed"
        :title="t('lists.shelf.completed')"
        :lists="completed"
        label-class="text-green-600"
        collapsible
        @open="openList"
      />
    </template>

    <!-- Modals -->
    <NewListSheet :open="showNew" @close="showNew = false" @created="onCreated" />
    <ListDetailModal :list-id="selectedListId" @close="selectedListId = null" />
  </div>
</template>
