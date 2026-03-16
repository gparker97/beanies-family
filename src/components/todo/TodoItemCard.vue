<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { normalizeAssignees } from '@/utils/assignees';
import MemberChip from '@/components/ui/MemberChip.vue';
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

const formattedDate = computed(() => {
  if (!props.todo.dueDate) return null;
  const date = new Date(props.todo.dueDate);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday} ${day} ${month}`;
});

const isOverdue = computed(() => {
  if (props.todo.completed || !props.todo.dueDate) return false;
  const now = new Date();
  const dueDate = new Date(props.todo.dueDate);
  if (props.todo.dueTime) {
    const parts = props.todo.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return now > dueDate;
});

const timeAgo = computed(() => {
  const now = new Date();
  const created = new Date(props.todo.createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('todo.addedToday');
  if (diffDays === 1) return t('todo.addedYesterday');
  return t('todo.addedDaysAgo').replace('{days}', String(diffDays));
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
  <div
    v-else
    class="group flex items-center gap-3 rounded-2xl border p-3 transition-all md:gap-4 md:p-4"
    :class="
      isOverdue
        ? 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:hover:bg-red-950/50'
        : 'border-[var(--tint-slate-5)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-800'
    "
  >
    <!-- Checkbox (smaller on mobile) -->
    <button
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors md:h-7 md:w-7"
      :class="
        isOverdue
          ? 'border-red-400 hover:bg-red-100 dark:border-red-500'
          : 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]'
      "
      @click="emit('toggle', todo.id)"
    />

    <!-- Content (clickable for view) -->
    <div class="min-w-0 flex-1 cursor-pointer" @click="emit('view', todo)">
      <p class="font-outfit text-sm font-semibold text-[var(--color-text)] md:text-base">
        {{ todo.title }}
      </p>

      <!-- Description (1 line on mobile, 2 on desktop) -->
      <p
        v-if="todo.description"
        class="mt-0.5 line-clamp-1 text-xs leading-relaxed text-[var(--color-text-muted)] md:line-clamp-2 md:text-sm"
      >
        {{ todo.description }}
      </p>

      <!-- Metadata row — compact on mobile, full on desktop -->
      <div class="mt-1 flex flex-wrap items-center gap-1.5 md:mt-1.5 md:gap-2.5">
        <!-- Date — compact on mobile, full on desktop -->
        <span
          v-if="formattedDate && isOverdue"
          class="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-500)] px-2 py-0.5 text-[10px] font-semibold text-white md:gap-1.5 md:px-2.5 md:text-xs"
        >
          ⏰{{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
          <span
            class="hidden rounded-full bg-white/25 px-1.5 py-px text-xs font-bold uppercase md:inline"
          >
            {{ t('todo.overdue') }}
          </span>
        </span>
        <span
          v-else-if="formattedDate"
          class="text-[10px] font-semibold md:text-xs"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>
        <span v-else class="text-[10px] opacity-35 md:text-xs">{{ t('todo.noDateSet') }}</span>

        <!-- Assignee chip(s) -->
        <MemberChip v-for="mid in normalizeAssignees(todo)" :key="mid" :member-id="mid" />

        <!-- Time ago (desktop only) -->
        <span class="hidden text-xs opacity-35 md:inline">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- Action buttons (hidden on mobile — accessible via view modal) -->
    <div
      class="hidden shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex"
    >
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
