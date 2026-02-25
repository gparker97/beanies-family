<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();
const familyStore = useFamilyStore();

const props = defineProps<{
  todo: TodoItem;
}>();

const emit = defineEmits<{
  toggle: [id: string];
  edit: [todo: TodoItem];
  delete: [id: string];
}>();

const assignee = computed(() => {
  if (!props.todo.assigneeId) return null;
  return familyStore.members.find((m) => m.id === props.todo.assigneeId);
});

const completedByMember = computed(() => {
  if (!props.todo.completedBy) return null;
  return familyStore.members.find((m) => m.id === props.todo.completedBy);
});

const formattedDate = computed(() => {
  if (!props.todo.dueDate) return null;
  const date = new Date(props.todo.dueDate);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
});
</script>

<template>
  <div
    class="group flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-white p-3 transition-all dark:bg-[var(--color-surface)]"
    :class="[
      todo.completed ? 'opacity-60' : 'hover:shadow-md',
      !todo.completed ? 'border-l-[3px] border-l-purple-400' : '',
    ]"
    style="box-shadow: var(--card-shadow)"
  >
    <!-- Checkbox -->
    <button
      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
      :class="
        todo.completed
          ? 'border-green-500 bg-green-500 text-white'
          : 'border-purple-400 hover:bg-[var(--tint-purple-8)]'
      "
      @click="emit('toggle', todo.id)"
    >
      <BeanieIcon v-if="todo.completed" name="check" size="xs" />
    </button>

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <p
        class="text-sm font-medium"
        :class="
          todo.completed
            ? 'text-[var(--color-text-muted)] line-through'
            : 'text-[var(--color-text)]'
        "
      >
        {{ todo.title }}
      </p>

      <div class="mt-1 flex flex-wrap items-center gap-2">
        <!-- Assignee chip -->
        <span
          v-if="assignee"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          style="background: var(--tint-slate-5)"
        >
          <span
            class="inline-block h-2.5 w-2.5 rounded-full"
            :style="{ backgroundColor: assignee.color }"
          />
          {{ assignee.name }}
        </span>

        <!-- Date badge -->
        <span
          v-if="formattedDate"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          :style="{
            background: todo.completed ? 'var(--tint-slate-5)' : 'var(--tint-orange-8)',
          }"
        >
          <BeanieIcon name="calendar" size="xs" />
          {{ formattedDate }}
          <span v-if="todo.dueTime" class="text-[var(--color-text-muted)]">{{ todo.dueTime }}</span>
        </span>

        <!-- On calendar badge -->
        <span
          v-if="todo.dueDate && !todo.completed"
          class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          style="background: var(--tint-silk-10); color: var(--color-secondary-500)"
        >
          {{ t('todo.onCalendar') }}
        </span>

        <!-- Completed info -->
        <span
          v-if="todo.completed && completedByMember"
          class="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400"
        >
          <BeanieIcon name="check" size="xs" />
          {{ t('todo.doneBy') }} {{ completedByMember.name }}
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div
      class="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
    >
      <template v-if="todo.completed">
        <button
          class="rounded-md px-2 py-1 text-xs font-medium text-purple-500 transition-colors hover:bg-[var(--tint-purple-8)]"
          @click="emit('toggle', todo.id)"
        >
          {{ t('todo.undo') }}
        </button>
      </template>
      <template v-else>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-5)]"
          @click="emit('edit', todo)"
        >
          <BeanieIcon name="edit" size="sm" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
          @click="emit('delete', todo.id)"
        >
          <BeanieIcon name="trash" size="sm" />
        </button>
      </template>
    </div>
  </div>
</template>
