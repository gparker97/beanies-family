<script setup lang="ts">
/**
 * The live to-do a Who Owns What card reminder made (#123), as a tappable row that opens the
 * to-do. The mirror of `LinkedCardChip`: the card side's ONE resolver for to-do data, so the
 * card drawers never import `todoStore` themselves.
 *
 * `todoId` is a soft reference (`cardTodoId(cardId, partKey)`): it resolves through
 * `todoStore.todos`, and on a miss (nobody holds the part yet, or the orchestrator has not
 * made the to-do) this renders NOTHING.
 *
 * The row is `LinkedItemLink variant="row"`: the to-do's title, and its next due day and time
 * ("Today, 8:00 PM") under it.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { useTodoStore } from '@/stores/todoStore';
import { entityDeepLink } from '@/utils/entityDeepLink';
import { dueDayLabel } from '@/utils/todo';
import { extractDatePart, formatTime12 } from '@/utils/date';
import LinkedItemLink from '@/components/ui/LinkedItemLink.vue';

const props = defineProps<{ todoId: string }>();

const emit = defineEmits<{
  /** Fired after navigation starts, so a host drawer can close itself. */
  open: [todoId: string];
}>();

const { t } = useTranslation();
const { today } = useToday();
const todoStore = useTodoStore();
const router = useRouter();

const todo = computed(() => todoStore.todos.find((x) => x.id === props.todoId));

const sub = computed(() => {
  const item = todo.value;
  if (!item?.dueDate) return '';
  const day = dueDayLabel(extractDatePart(item.dueDate), today.value, t);
  return item.dueTime ? `${day}, ${formatTime12(item.dueTime)}` : day;
});

// One bound object: `aria-label` on a component tag is typed as the native attribute, not
// `LinkedItemLink`'s required `ariaLabel` prop.
const linkProps = computed(() =>
  todo.value
    ? {
        icon: '✅',
        title: todo.value.title,
        sub: sub.value,
        ariaLabel: t('whoOwnsWhat.reminder.openTodo'),
        variant: 'row' as const,
      }
    : null
);

function open(): void {
  if (!todo.value) return;
  void router.push(entityDeepLink('todo', todo.value.id));
  emit('open', todo.value.id);
}
</script>

<template>
  <LinkedItemLink v-if="linkProps" v-bind="linkProps" @click="open" />
</template>
