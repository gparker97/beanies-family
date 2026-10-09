<script setup lang="ts">
/**
 * A to-do's completion checkbox: the to-do list row's control, shared with the To-do Details
 * drawer (#123) so both read and behave the same. Purely presentational; the host calls
 * `todoStore.toggleComplete`, which completes a normal to-do or rolls a repeating one.
 *
 * Its look follows the to-do's state: done (filled green), someday (Sky Silk), overdue (red,
 * never for a hint, whose due date is only a nudge date), otherwise Heritage Orange.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { isTodoOverdue } from '@/utils/todo';
import { isHint } from '@/utils/helpfulHints';
import type { TodoItem } from '@/types/models';

const props = withDefaults(
  defineProps<{
    todo: TodoItem;
    /** The row's compact look stays 24px at every width; otherwise it grows to 28px on md+. */
    compact?: boolean;
  }>(),
  { compact: false }
);

const emit = defineEmits<{ toggle: [id: string] }>();

const { t } = useTranslation();

const isDone = computed(() => !!props.todo.completed);

const checkboxClass = computed(() => {
  // Filled controls keep the true brand colour with white ink in both themes.
  if (isDone.value) return 'border-[#27ae60] bg-[#27ae60] text-white';
  if (props.todo.someday)
    return 'border-[var(--color-sky-silk-300)] hover:bg-[var(--tint-silk-20)] dark:border-sky-400/70';
  if (!isHint(props.todo) && isTodoOverdue(props.todo))
    return 'border-red-400 hover:bg-red-100 dark:border-red-500';
  return 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]';
});
</script>

<template>
  <button
    type="button"
    class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
    :class="[compact ? '' : 'md:h-7 md:w-7', checkboxClass]"
    :aria-pressed="isDone"
    :aria-label="isDone ? t('todo.reopenTask') : t('action.markCompleted')"
    data-testid="todo-complete-checkbox"
    @click.stop="emit('toggle', todo.id)"
  >
    <span v-if="isDone" class="text-xs font-bold" aria-hidden="true">✓</span>
  </button>
</template>
