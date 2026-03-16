<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { normalizeAssignees } from '@/utils/assignees';
import { formatNookDate } from '@/utils/date';
import { isTodoOverdue } from '@/utils/todo';
import MemberChip from '@/components/ui/MemberChip.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();

const props = withDefaults(
  defineProps<{
    todo: TodoItem;
    compact?: boolean;
  }>(),
  { compact: false }
);

const emit = defineEmits<{
  toggle: [id: string];
  view: [todo: TodoItem];
  edit: [todo: TodoItem];
  delete: [id: string];
}>();

const isOverdue = computed(() => isTodoOverdue(props.todo));

const formattedDate = computed(() => {
  if (!props.todo.dueDate) return null;
  return formatNookDate(props.todo.dueDate);
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
  <div
    class="group flex items-center gap-3 rounded-2xl border transition-all"
    :class="[
      compact ? 'cursor-pointer p-3.5' : 'p-3 md:gap-4 md:p-4',
      isOverdue
        ? 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:hover:bg-red-950/50'
        : compact
          ? 'border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-700 dark:hover:bg-slate-600'
          : 'border-[var(--tint-slate-5)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-800',
    ]"
    @click="emit('view', todo)"
  >
    <!-- Checkbox -->
    <button
      type="button"
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
      :class="[
        compact ? '' : 'md:h-7 md:w-7',
        isOverdue
          ? 'border-red-400 hover:bg-red-100 dark:border-red-500'
          : 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]',
      ]"
      @click.stop="emit('toggle', todo.id)"
    />

    <!-- Content -->
    <div class="min-w-0 flex-1" :class="compact ? '' : 'cursor-pointer'">
      <p
        class="font-outfit text-sm font-semibold text-[var(--color-text)]"
        :class="compact ? 'truncate' : 'md:text-base'"
      >
        {{ todo.title }}
      </p>

      <p
        v-if="todo.description"
        class="mt-0.5 line-clamp-1 text-xs leading-relaxed text-[var(--color-text-muted)]"
        :class="compact ? '' : 'md:line-clamp-2 md:text-sm'"
      >
        {{ todo.description }}
      </p>

      <!-- Metadata row -->
      <div
        class="mt-1 flex flex-wrap items-center gap-1.5"
        :class="compact ? 'md:gap-2' : 'md:mt-1.5 md:gap-2.5'"
      >
        <!-- Overdue date badge -->
        <span
          v-if="formattedDate && isOverdue"
          class="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-500)] px-2 py-0.5 text-[10px] font-semibold text-white md:gap-1.5 md:px-2.5 md:text-xs"
          :class="compact ? 'font-outfit' : ''"
        >
          ⏰{{ compact ? ' ' : '' }}{{ formattedDate
          }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
          <span
            class="hidden rounded-full bg-white/25 px-1.5 py-px text-xs font-bold uppercase md:inline"
          >
            {{ t('todo.overdue') }}
          </span>
        </span>

        <!-- Normal date -->
        <span
          v-else-if="formattedDate"
          class="text-[10px] font-semibold md:text-xs"
          :class="compact ? 'font-outfit' : ''"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- No date (full mode only) -->
        <span v-else-if="!compact" class="text-[10px] opacity-35 md:text-xs">
          {{ t('todo.noDateSet') }}
        </span>

        <!-- Assignee chips -->
        <MemberChip v-for="mid in normalizeAssignees(todo)" :key="mid" :member-id="mid" />

        <!-- Time ago (full mode, desktop only) -->
        <span v-if="!compact" class="hidden text-xs opacity-35 md:inline">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- Action buttons (full mode, desktop only) -->
    <div
      v-if="!compact"
      class="hidden shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex"
    >
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: var(--tint-slate-5)"
        @click.stop="emit('edit', todo)"
      >
        ✏️
      </button>
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: var(--tint-slate-5)"
        @click.stop="emit('delete', todo.id)"
      >
        🗑️
      </button>
    </div>
  </div>
</template>
