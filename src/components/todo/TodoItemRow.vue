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
  /** Move into ("someday · maybe", value=true) / out of (value=false) the parked lane. */
  'set-someday': [id: string, value: boolean];
}>();

const isSomeday = computed(() => !!props.todo.someday);
const isOverdue = computed(() => isTodoOverdue(props.todo));

// Container styling — early returns rather than a deep nested ternary in the
// template. A someday row gets a de-emphasised "parked" look (the soft slate
// idiom the completed-card uses, plus a dashed border) and never the
// overdue-red path (a someday item has no date, so it's never overdue).
const containerClass = computed(() => {
  const pad = props.compact ? 'cursor-pointer p-3.5' : 'p-3 md:gap-4 md:p-4';
  if (isSomeday.value) {
    return `${pad} border-dashed border-[var(--tint-slate-10)] bg-[var(--tint-slate-5)] hover:bg-[var(--tint-slate-10)] dark:border-slate-600/40 dark:bg-slate-700/40 dark:hover:bg-slate-700/60`;
  }
  if (isOverdue.value) {
    return `${pad} border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:hover:bg-red-950/50`;
  }
  if (props.compact) {
    return `${pad} border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-700 dark:hover:bg-slate-600`;
  }
  return `${pad} border-[var(--tint-slate-5)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-800`;
});

const checkboxClass = computed(() => {
  if (isSomeday.value)
    return 'border-[var(--tint-slate-10)] hover:bg-[var(--tint-slate-10)] dark:border-slate-600';
  if (isOverdue.value) return 'border-red-400 hover:bg-red-100 dark:border-red-500';
  return 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]';
});

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
    :class="containerClass"
    @click="emit('view', todo)"
  >
    <!-- Checkbox -->
    <button
      type="button"
      class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
      :class="[compact ? '' : 'md:h-7 md:w-7', checkboxClass]"
      @click.stop="emit('toggle', todo.id)"
    />

    <!-- Content -->
    <div class="min-w-0 flex-1" :class="compact ? '' : 'cursor-pointer'">
      <p
        class="font-outfit text-sm font-semibold text-[var(--color-text)]"
        :class="compact ? 'truncate' : 'md:text-base'"
      >
        <span v-if="isSomeday" aria-hidden="true">💭&nbsp;</span>{{ todo.title }}
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
          class="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-500)] px-2 py-0.5 text-[0.625rem] font-semibold text-white md:gap-1.5 md:px-2.5 md:text-xs"
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
          class="text-[0.625rem] font-semibold md:text-xs"
          :class="compact ? 'font-outfit' : ''"
          :style="{ color: 'var(--color-primary-500)' }"
        >
          📅 {{ formattedDate }}<template v-if="todo.dueTime">, {{ todo.dueTime }}</template>
        </span>

        <!-- No date (full mode only; a someday row's 💭 prefix already conveys "no date") -->
        <span v-else-if="!compact && !isSomeday" class="text-[0.625rem] opacity-35 md:text-xs">
          {{ t('todo.noDateSet') }}
        </span>

        <!-- Assignee chips -->
        <MemberChip v-for="mid in normalizeAssignees(todo)" :key="mid" :member-id="mid" />

        <!-- Time ago (full mode, desktop only) -->
        <span v-if="!compact" class="hidden text-xs opacity-35 md:inline">{{ timeAgo }}</span>
      </div>
    </div>

    <!-- Action buttons (full mode, desktop only; hover-revealed) -->
    <div
      v-if="!compact"
      class="hidden shrink-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 md:flex"
    >
      <button
        class="flex h-8 w-8 items-center justify-center rounded-[10px] text-sm opacity-40 transition-opacity hover:opacity-70"
        style="background: var(--tint-slate-5)"
        :title="isSomeday ? t('todo.makeActive') : t('todo.moveToSomeday')"
        @click.stop="emit('set-someday', todo.id, !isSomeday)"
      >
        {{ isSomeday ? '📋' : '💭' }}
      </button>
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
