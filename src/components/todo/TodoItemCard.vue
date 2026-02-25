<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
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
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday} ${day} ${month}`;
});

const timeAgo = computed(() => {
  const now = new Date();
  const created = new Date(props.todo.createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Added today';
  if (diffDays === 1) return 'Added yesterday';
  return `Added ${diffDays} days ago`;
});
</script>

<template>
  <!-- Completed task card -->
  <div
    v-if="todo.completed"
    class="group flex items-center gap-4 rounded-2xl p-4 opacity-50"
    style="background: var(--tint-slate-5)"
  >
    <!-- Green checkbox -->
    <button
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
      style="background: #27ae60"
      @click="emit('toggle', todo.id)"
    >
      <span class="text-xs font-bold text-white">✓</span>
    </button>

    <!-- Content (clickable for view) -->
    <div class="min-w-0 flex-1 cursor-pointer" @click="emit('view', todo)">
      <p class="font-outfit text-[0.95rem] font-semibold line-through">
        {{ todo.title }}
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
  <div
    v-else
    class="group flex items-center gap-4 rounded-2xl border border-[var(--tint-slate-5)] bg-white p-4 transition-all hover:bg-[var(--tint-orange-8)] dark:bg-slate-800"
  >
    <!-- Checkbox -->
    <button
      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
      :class="
        todo.dueDate
          ? 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]'
          : 'border-[rgba(44,62,80,0.2)] hover:border-[rgba(44,62,80,0.4)]'
      "
      @click="emit('toggle', todo.id)"
    />

    <!-- Content (clickable for view) -->
    <div class="min-w-0 flex-1 cursor-pointer" @click="emit('view', todo)">
      <p class="font-outfit text-[0.95rem] font-semibold text-[var(--color-text)]">
        {{ todo.title }}
      </p>
      <div class="mt-1.5 flex flex-wrap items-center gap-2.5">
        <!-- Date (always first, orange color) -->
        <span
          v-if="formattedDate"
          class="text-xs font-semibold"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- No date set -->
        <span v-else class="text-xs opacity-35">No date set</span>

        <!-- On calendar badge (only if has date) -->
        <span
          v-if="todo.dueDate"
          class="rounded-md px-2 py-0.5 text-[0.7rem]"
          style="background: var(--tint-silk-20); color: #3a7bad"
        >
          📆 {{ t('todo.onCalendar') }}
        </span>

        <!-- Assignee chip (gradient background with member color) -->
        <span
          v-if="assignee"
          class="rounded-md px-2.5 py-0.5 text-[0.7rem] font-medium text-white"
          :style="{
            background: `linear-gradient(135deg, ${assignee.color}, ${assignee.color}cc)`,
          }"
        >
          {{ assignee.name }}
        </span>

        <!-- Time ago -->
        <span class="text-[0.65rem] opacity-35">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: var(--tint-slate-5)"
        @click="emit('edit', todo)"
      >
        ✏️
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: var(--tint-slate-5)"
        @click="emit('delete', todo.id)"
      >
        🗑️
      </button>
    </div>
  </div>
</template>
