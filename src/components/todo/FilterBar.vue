<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import type { UIStringKey } from '@/services/translation/uiStrings';

const { t } = useTranslation();

export type TodoFilter = 'all' | 'open' | 'done' | 'scheduled' | 'noDate';
export type TodoSort = 'newest' | 'oldest' | 'dueDate';

defineProps<{
  activeFilter: TodoFilter;
  sortBy: TodoSort;
}>();

const emit = defineEmits<{
  'update:activeFilter': [filter: TodoFilter];
  'update:sortBy': [sort: TodoSort];
}>();

const filters: { value: TodoFilter; labelKey: UIStringKey }[] = [
  { value: 'all', labelKey: 'todo.filter.all' },
  { value: 'open', labelKey: 'todo.filter.open' },
  { value: 'done', labelKey: 'todo.filter.done' },
  { value: 'scheduled', labelKey: 'todo.filter.scheduled' },
  { value: 'noDate', labelKey: 'todo.filter.noDate' },
];
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <!-- Filter chips -->
    <div class="flex flex-wrap gap-1.5">
      <button
        v-for="filter in filters"
        :key="filter.value"
        class="rounded-full px-3 py-1.5 text-xs font-medium transition-all"
        :class="
          activeFilter === filter.value
            ? 'text-white shadow-sm'
            : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
        "
        :style="
          activeFilter === filter.value
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : undefined
        "
        @click="emit('update:activeFilter', filter.value)"
      >
        {{ t(filter.labelKey) }}
      </button>
    </div>

    <!-- Sort dropdown -->
    <select
      :value="sortBy"
      class="rounded-lg border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs text-[var(--color-text-muted)] transition-colors outline-none focus:border-purple-400 dark:text-white"
      @change="emit('update:sortBy', ($event.target as HTMLSelectElement).value as TodoSort)"
    >
      <option value="newest">{{ t('todo.sort.newest') }}</option>
      <option value="oldest">{{ t('todo.sort.oldest') }}</option>
      <option value="dueDate">{{ t('todo.sort.dueDate') }}</option>
    </select>
  </div>
</template>
