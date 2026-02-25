<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';

const { t } = useTranslation();
const todoStore = useTodoStore();

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
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <!-- Filter chips -->
    <div class="flex flex-wrap gap-1.5">
      <button
        class="font-outfit rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
        :class="
          activeFilter === 'all' ? 'text-white shadow-sm' : 'text-[var(--color-text)] opacity-60'
        "
        :style="
          activeFilter === 'all'
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : 'background: var(--tint-slate-5)'
        "
        @click="emit('update:activeFilter', 'all')"
      >
        {{ t('todo.filter.all') }} ({{ todoStore.todos.length }})
      </button>
      <button
        class="font-outfit rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
        :class="
          activeFilter === 'open' ? 'text-white shadow-sm' : 'text-[var(--color-text)] opacity-60'
        "
        :style="
          activeFilter === 'open'
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : 'background: var(--tint-slate-5)'
        "
        @click="emit('update:activeFilter', 'open')"
      >
        {{ t('todo.filter.open') }} ({{ todoStore.openTodos.length }})
      </button>
      <button
        class="font-outfit rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
        :class="
          activeFilter === 'done' ? 'text-white shadow-sm' : 'text-[var(--color-text)] opacity-60'
        "
        :style="
          activeFilter === 'done'
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : 'background: var(--tint-slate-5)'
        "
        @click="emit('update:activeFilter', 'done')"
      >
        {{ t('todo.filter.done') }} ({{ todoStore.completedTodos.length }})
      </button>
      <button
        class="font-outfit rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
        :class="
          activeFilter === 'scheduled'
            ? 'text-white shadow-sm'
            : 'text-[var(--color-text)] opacity-60'
        "
        :style="
          activeFilter === 'scheduled'
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : 'background: var(--tint-slate-5)'
        "
        @click="emit('update:activeFilter', 'scheduled')"
      >
        📅 {{ t('todo.filter.scheduled') }}
      </button>
      <button
        class="font-outfit rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all"
        :class="
          activeFilter === 'noDate' ? 'text-white shadow-sm' : 'text-[var(--color-text)] opacity-60'
        "
        :style="
          activeFilter === 'noDate'
            ? 'background: linear-gradient(135deg, #9b59b6, #8e44ad)'
            : 'background: var(--tint-slate-5)'
        "
        @click="emit('update:activeFilter', 'noDate')"
      >
        ⚡ {{ t('todo.filter.noDate') }}
      </button>
    </div>

    <!-- Sort -->
    <div class="flex items-center gap-1.5">
      <span class="font-outfit text-xs font-medium text-[var(--color-text)] opacity-50">
        Sort:
      </span>
      <select
        :value="sortBy"
        class="beanies-input font-outfit cursor-pointer rounded-lg border-gray-200 py-1.5 pr-7 pl-2 text-xs font-semibold text-[var(--color-text)] dark:border-slate-600"
        @change="emit('update:sortBy', ($event.target as HTMLSelectElement).value as TodoSort)"
      >
        <option value="newest">{{ t('todo.sort.newest') }}</option>
        <option value="oldest">{{ t('todo.sort.oldest') }}</option>
        <option value="dueDate">{{ t('todo.sort.dueDate') }}</option>
      </select>
    </div>
  </div>
</template>
