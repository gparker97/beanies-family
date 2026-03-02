<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';

const { t } = useTranslation();
const todoStore = useTodoStore();

export type TodoFilter = 'all' | 'open' | 'done';
export type TodoSort = 'newest' | 'oldest' | 'dueDate';

defineProps<{
  activeFilter: TodoFilter;
}>();

const emit = defineEmits<{
  'update:activeFilter': [filter: TodoFilter];
}>();
</script>

<template>
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
  </div>
</template>
