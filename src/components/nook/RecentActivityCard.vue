<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import { formatNookDate } from '@/utils/date';
import { getTransactionVisual, type TransactionVisual } from '@/utils/transactionLabel';
import NookSectionCard from './NookSectionCard.vue';

const emit = defineEmits<{
  'open-todo': [id: string];
  'open-transaction': [id: string];
}>();

const { t } = useTranslation();
const todoStore = useTodoStore();
const transactionsStore = useTransactionsStore();

interface ActivityItem {
  id: string;
  type: 'todo' | 'transaction';
  icon: string;
  iconTint: TransactionVisual['tint'];
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
        time: formatNookDate(completedDate),
        date: completedDate,
      });
    }
  }

  // 2. Recent transactions (last 5)
  for (const tx of transactionsStore.filteredRecentTransactions.slice(0, 5)) {
    const visual = getTransactionVisual(tx);
    items.push({
      id: tx.id,
      type: 'transaction',
      icon: visual.icon,
      iconTint: visual.tint,
      description: tx.description,
      time: formatNookDate(tx.date) + ' \u00B7 ' + tx.category,
      date: tx.date,
    });
  }

  // Merge, sort by date descending, take first 4
  items.sort((a, b) => b.date.localeCompare(a.date));
  return items.slice(0, 4);
});
</script>

<template>
  <NookSectionCard
    class="nook-activity-card"
    :title="t('nook.recentActivity')"
    border-color="#27AE60"
  >
    <template #header-right>
      <router-link to="/transactions" class="text-primary-500 text-xs font-medium">
        {{ t('nook.seeAll') }} &rarr;
      </router-link>
    </template>

    <!-- Items list -->
    <div v-if="activityItems.length > 0" class="space-y-0">
      <div
        v-for="item in activityItems"
        :key="item.id"
        class="flex cursor-pointer items-center gap-3 rounded-xl border-b border-[var(--tint-slate-5)] py-3 transition-colors last:border-b-0 hover:bg-[var(--tint-success-10)]"
        @click="
          item.type === 'todo' ? emit('open-todo', item.id) : emit('open-transaction', item.id)
        "
      >
        <!-- Icon container -->
        <div
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm"
          :class="{
            'bg-[var(--tint-success-10)]': item.iconTint === 'green',
            'bg-[var(--tint-orange-8)]': item.iconTint === 'orange',
            'bg-[var(--tint-slate-8)]': item.iconTint === 'slate',
            'bg-[var(--tint-blue-8)]': item.iconTint === 'blue',
          }"
        >
          {{ item.icon }}
        </div>

        <!-- Content -->
        <div class="min-w-0 flex-1">
          <div class="text-secondary-500 truncate text-sm font-semibold dark:text-gray-100">
            {{ item.description }}
          </div>
          <div
            class="font-outfit text-secondary-500/50 mt-0.5 text-xs font-medium dark:text-gray-400"
          >
            {{ item.time }}
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="py-8 text-center text-sm text-gray-500">
      {{ t('nook.noActivity') }}
    </div>
  </NookSectionCard>
</template>

<style scoped>
.nook-activity-card {
  background: linear-gradient(135deg, white 85%, rgb(39 174 96 / 4%));
}
</style>
