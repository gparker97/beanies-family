<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatDateShort } from '@/utils/date';

const { t } = useTranslation();
const todoStore = useTodoStore();
const transactionsStore = useTransactionsStore();

interface ActivityItem {
  id: string;
  type: 'todo' | 'transaction';
  icon: string;
  iconTint: 'green' | 'orange';
  description: string;
  time: string;
  date: string;
}

const activityItems = computed<ActivityItem[]>(() => {
  const items: ActivityItem[] = [];

  // 1. Completed todos from last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const sevenDaysAgoISO = sevenDaysAgo.toISOString();

  for (const todo of todoStore.filteredCompletedTodos) {
    const completedDate = todo.completedAt ?? todo.updatedAt;
    if (completedDate >= sevenDaysAgoISO) {
      items.push({
        id: todo.id,
        type: 'todo',
        icon: '\u2705',
        iconTint: 'green',
        description: todo.title + ' \u2014 ' + t('nook.taskCompleted'),
        time: formatDateShort(completedDate),
        date: completedDate,
      });
    }
  }

  // 2. Recent transactions (last 5)
  for (const tx of transactionsStore.filteredRecentTransactions.slice(0, 5)) {
    items.push({
      id: tx.id,
      type: 'transaction',
      icon: tx.type === 'income' ? '\u{1F4B0}' : '\u{1F4B3}',
      iconTint: tx.type === 'income' ? 'green' : 'orange',
      description: tx.description,
      time: formatDateShort(tx.date) + ' \u00B7 ' + tx.category,
      date: tx.date,
    });
  }

  // Merge, sort by date descending, take first 4
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, 4);
});
</script>

<template>
  <div
    class="nook-activity-card nook-card-dark rounded-[var(--sq)] border-l-4 border-[#27AE60] p-6 shadow-[var(--card-shadow)]"
  >
    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="text-base">{{ '⚡' }}</span>
        <span class="nook-section-label text-secondary-500 dark:text-gray-400">
          {{ t('nook.recentActivity') }}
        </span>
      </div>
      <router-link to="/transactions" class="text-primary-500 text-xs font-medium">
        {{ t('nook.seeAll') }} &rarr;
      </router-link>
    </div>

    <!-- Items list -->
    <div v-if="activityItems.length > 0" class="space-y-0">
      <div
        v-for="item in activityItems"
        :key="item.id"
        class="flex items-center gap-3 border-b border-[var(--tint-slate-5)] py-3 last:border-b-0"
      >
        <!-- Icon container -->
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm"
          :class="{
            'bg-[var(--tint-success-10)]': item.iconTint === 'green',
            'bg-[var(--tint-orange-8)]': item.iconTint === 'orange',
          }"
        >
          {{ item.icon }}
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <div class="text-secondary-500 truncate text-sm font-semibold dark:text-gray-100">
            {{ item.description }}
          </div>
          <div class="text-secondary-500/35 text-xs dark:text-gray-500">
            {{ item.time }}
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="py-8 text-center text-sm text-gray-500">
      {{ t('nook.noActivity') }}
    </div>
  </div>
</template>

<style scoped>
.nook-activity-card {
  background: linear-gradient(135deg, white 85%, rgb(39 174 96 / 4%));
}
</style>
