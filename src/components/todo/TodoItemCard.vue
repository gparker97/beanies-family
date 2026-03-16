<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import TodoItemRow from '@/components/todo/TodoItemRow.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();
const familyStore = useFamilyStore();

const props = defineProps<{
  todo: TodoItem;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  view: [todo: TodoItem];
  edit: [todo: TodoItem];
  delete: [id: string];
}>();

const completedByMember = computed(() => {
  if (!props.todo.completedBy) return null;
  return familyStore.members.find((m) => m.id === props.todo.completedBy);
});
</script>

<template>
  <!-- Completed task card -->
  <div
    v-if="todo.completed"
    class="group flex items-center gap-3 rounded-2xl p-3 opacity-50 md:gap-4 md:p-4"
    style="background: var(--tint-slate-5)"
  >
    <!-- Green checkbox -->
    <button
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg md:h-7 md:w-7"
      style="background: #27ae60"
      @click="emit('toggle', todo.id)"
    >
      <span class="text-[10px] font-bold text-white md:text-xs">✓</span>
    </button>

    <!-- Content (clickable for view) -->
    <div class="min-w-0 flex-1 cursor-pointer" @click="emit('view', todo)">
      <p class="font-outfit text-sm font-semibold line-through md:text-base">
        {{ todo.title }}
      </p>
      <p
        v-if="todo.description"
        class="mt-0.5 line-clamp-1 text-xs leading-relaxed text-[var(--color-text-muted)] md:line-clamp-2 md:text-sm"
      >
        {{ todo.description }}
      </p>
      <div class="mt-1 flex items-center gap-2">
        <span v-if="completedByMember" class="text-xs">
          ✅ {{ t('todo.doneBy') }} {{ completedByMember.name }}
        </span>
      </div>
    </div>

    <!-- Undo button -->
    <div class="flex shrink-0 gap-1.5">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: rgb(255 255 255 / 50%)"
        @click="emit('toggle', todo.id)"
      >
        ↩️
      </button>
    </div>
  </div>

  <!-- Open task card -->
  <TodoItemRow
    v-else
    :todo="todo"
    @toggle="emit('toggle', $event)"
    @view="emit('view', $event)"
    @edit="emit('edit', $event)"
    @delete="emit('delete', $event)"
  />
</template>
