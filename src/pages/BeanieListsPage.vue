<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useListStore } from '@/stores/listStore';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { LIST_CATEGORIES } from '@/constants/listCategories';
import { groupByRecency, groupCompletedByRecency } from '@/utils/completedListBands';
import { useToday } from '@/composables/useToday';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import AddEntityButton from '@/components/ui/AddEntityButton.vue';
import ListShelf from '@/components/lists/ListShelf.vue';
import ListCycleShelf from '@/components/lists/ListCycleShelf.vue';
import ListCycleModal from '@/components/lists/ListCycleModal.vue';
import ListCategoryPills from '@/components/lists/ListCategoryPills.vue';
import ListDetailModal from '@/components/lists/ListDetailModal.vue';
import NewListSheet from '@/components/lists/NewListSheet.vue';
import type { FamilyList, ListCategory } from '@/types/models';

const { t, currentLanguage } = useTranslation();
const listStore = useListStore();
const { categoryLabel } = useListCategoryLabel();
const route = useRoute();
const router = useRouter();

onMounted(() => {
  void listStore.loadLists();
});

const selectedCategory = ref<ListCategory | null>(null);
const selectedListId = ref<string | null>(null);
const showNew = ref(false);
const completedCollapsed = ref(true);
const historyCollapsed = ref(true);
const selectedCycleId = ref<string | null>(null);

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

/**
 * The completed shelf is the one that grows without bound (a daily chore list files a copy
 * every day), so it is banded by recency rather than shown as one flat grid. The store
 * already sorts newest-first; banding preserves that inside each band.
 */
const { today } = useToday();
// The month headings are formatted by the platform, so they must be told which language
// the rest of the shelf's headings are in — otherwise 「本周」 sits above "August 2026".
const completedBands = computed(() =>
  groupCompletedByRecency(completed.value, today.value, currentLanguage.value)
);

/**
 * Archived cycles get their OWN banded section rather than being interleaved with
 * completed one-off lists. They are different things with different lifetimes — a list a
 * person finished and the app keeps, versus a snapshot the app generated — and mixing
 * them would hide that difference at exactly the moment it matters.
 */
const cycles = computed(() =>
  listStore.archivedCycles.filter(
    (c) => !selectedCategory.value || c.category === selectedCategory.value
  )
);
const cycleBands = computed(() =>
  groupByRecency(cycles.value, today.value, (c) => c.endedOn, currentLanguage.value)
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
/**
 * Close the detail drawer AND strip the `?view=` query. Without clearing it, the
 * URL stays `/lists?view=<id>`, so re-tapping the same notification is a
 * no-op navigation and the modal never reopens (the watch only fires on change).
 */
function closeDetail(): void {
  selectedListId.value = null;
  if (route.query.view !== undefined) {
    void router.replace({ query: { ...route.query, view: undefined } });
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <PageWelcomeSubtitle :text="t('lists.welcomeSubtitle')" />
      <AddEntityButton :label="t('lists.newList')" @click="showNew = true" />
    </div>

    <!-- Empty state -->
    <div v-if="isEmpty" class="py-12 text-center">
      <EmptyStateIllustration variant="lists" class="mb-4" />
      <p class="mb-1 text-sm font-semibold text-[var(--color-text)]">
        {{ t('lists.empty.title') }}
      </p>
      <p class="mb-4 text-sm text-[var(--color-text-muted)]">{{ t('lists.empty.body') }}</p>
      <AddEntityButton :label="t('lists.newList')" @click="showNew = true" />
    </div>

    <template v-else>
      <!-- Filter chips -->
      <ListCategoryPills v-model="selectedCategory" tone="filter" show-all short />

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

      <!-- Repeating list history (collapsible) -->
      <ListCycleShelf
        v-if="cycles.length"
        v-model:collapsed="historyCollapsed"
        :title="t('lists.history.title')"
        :bands="cycleBands"
        :count="cycles.length"
        @open="selectedCycleId = $event"
      />

      <!-- Completed (collapsible) -->
      <ListShelf
        v-if="completed.length"
        v-model:collapsed="completedCollapsed"
        :title="t('lists.shelf.completed')"
        :lists="completed"
        :bands="completedBands"
        label-class="text-green-600"
        collapsible
        @open="openList"
      />
    </template>

    <!-- Modals -->
    <ListCycleModal :cycle-id="selectedCycleId" @close="selectedCycleId = null" />
    <NewListSheet :open="showNew" @close="showNew = false" @created="onCreated" />
    <ListDetailModal :list-id="selectedListId" @close="closeDetail" />
  </div>
</template>
