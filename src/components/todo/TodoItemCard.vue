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
    class="group flex items-center gap-3.5 rounded-2xl p-3.5 opacity-50"
    style="background: var(--tint-slate-5)"
  >
    <!-- Green checkbox -->
    <button
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
      style="background: #27ae60"
      @click="emit('toggle', todo.id)"
    >
      <span class="text-[0.65rem] font-bold text-white">✓</span>
    </button>

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <p class="font-outfit text-[0.85rem] font-semibold line-through">
        {{ todo.title }}
      </p>
      <div class="mt-1 flex items-center gap-2">
        <span v-if="completedByMember" class="text-[0.55rem]">
          ✅ {{ t('todo.doneBy') }} {{ completedByMember.name }}
        </span>
      </div>
    </div>

    <!-- Undo button -->
    <div class="flex shrink-0 gap-1.5">
      <button
        class="flex h-7 w-7 items-center justify-center rounded-[9px] text-[0.6rem] opacity-40 transition-opacity hover:opacity-70"
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
    class="group flex items-center gap-3.5 rounded-2xl border p-3.5 transition-all hover:bg-[var(--tint-orange-8)]"
    :class="todo.dueDate ? 'border-[rgba(241,93,34,0.08)]' : 'border-[var(--tint-slate-5)]'"
    :style="{
      background: todo.dueDate ? 'rgba(241, 93, 34, 0.04)' : 'white',
    }"
  >
    <!-- Checkbox -->
    <button
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
      :class="
        todo.dueDate
          ? 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]'
          : 'border-[rgba(44,62,80,0.15)] hover:border-[rgba(44,62,80,0.3)]'
      "
      @click="emit('toggle', todo.id)"
    />

    <!-- Content -->
    <div class="min-w-0 flex-1">
      <p class="font-outfit text-[0.85rem] font-semibold text-[var(--color-text)]">
        {{ todo.title }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <!-- Date (always first, orange color) -->
        <span
          v-if="formattedDate"
          class="text-[0.6rem] font-semibold"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- No date set -->
        <span v-else class="text-[0.55rem] opacity-35">No date set</span>

        <!-- On calendar badge (only if has date) -->
        <span
          v-if="todo.dueDate"
          class="rounded-md px-2 py-0.5 text-[0.55rem]"
          style="background: var(--tint-silk-20); color: #3a7bad"
        >
          📆 {{ t('todo.onCalendar') }}
        </span>

        <!-- Assignee chip (gradient background with member color) -->
        <span
          v-if="assignee"
          class="rounded-md px-2 py-0.5 text-[0.55rem] font-medium text-white"
          :style="{
            background: `linear-gradient(135deg, ${assignee.color}, ${assignee.color}cc)`,
          }"
        >
          {{ assignee.name }}
        </span>

        <!-- Time ago -->
        <span class="text-[0.5rem] opacity-30">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="flex shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        class="flex h-7 w-7 items-center justify-center rounded-[9px] text-[0.65rem] opacity-30 transition-opacity hover:opacity-60"
        style="background: var(--tint-slate-5)"
        @click="emit('edit', todo)"
      >
        ✏️
      </button>
      <button
        class="flex h-7 w-7 items-center justify-center rounded-[9px] text-[0.65rem] opacity-30 transition-opacity hover:opacity-60"
        style="background: var(--tint-slate-5)"
        @click="emit('delete', todo.id)"
      >
        🗑️
      </button>
    </div>
  </div>
</template>
