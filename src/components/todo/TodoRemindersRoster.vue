<script setup lang="ts">
/**
 * Every repeating to-do in the family, grouped by who it reminds (#123). One roster for both
 * hosts on /todo: the collapsible Reminders section on a phone and the Family Reminders panel on
 * desktop, so the two can never drift.
 *
 * The page passes the to-dos already filtered (its member lenses) and sorted; this only groups
 * them. A to-do lands under its FIRST assignee who is still in the family (so a to-do for two
 * never counts twice), groups follow `familyStore.sortedHumans`, and the unassigned group comes
 * last. A child's group says adults see it too (the existing audience rules already show a
 * child's to-dos to every adult). It owns the empty state so both hosts share it.
 *
 * A tap on a row emits `view`; the card chip under a card-made row opens the card instead.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { useToday } from '@/composables/useToday';
import { useTodoCardLink } from '@/composables/useTodoCardLink';
import { isAdultMember } from '@/composables/useMemberInfo';
import { useFamilyStore } from '@/stores/familyStore';
import { normalizeAssignees } from '@/utils/assignees';
import { dueDayLabel } from '@/utils/todo';
import { extractDatePart } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import MemberGroupCard from '@/components/ui/MemberGroupCard.vue';
import LinkedCardChip from '@/components/todo/LinkedCardChip.vue';
import RepeatGlyph from '@/components/todo/RepeatGlyph.vue';
import type { FamilyMember, TodoItem } from '@/types/models';

const props = defineProps<{
  /** Repeating to-dos, already member-filtered and sorted by the page. */
  todos: TodoItem[];
}>();

const emit = defineEmits<{ view: [todo: TodoItem] }>();

const { t } = useTranslation();
const { describeTodo } = useRecurrenceLabel();
const { today } = useToday();
const { resolveCardLink } = useTodoCardLink();
const familyStore = useFamilyStore();

interface RosterGroup {
  key: string;
  member: FamilyMember | null;
  todos: TodoItem[];
}

const groups = computed<RosterGroup[]>(() => {
  const humans = familyStore.sortedHumans;
  const known = new Set(humans.map((m) => m.id));
  const byMember = new Map<string, TodoItem[]>();
  const unassigned: TodoItem[] = [];
  for (const todo of props.todos) {
    const owner = normalizeAssignees(todo).find((id) => known.has(id));
    if (!owner) {
      unassigned.push(todo);
      continue;
    }
    byMember.set(owner, [...(byMember.get(owner) ?? []), todo]);
  }
  const result: RosterGroup[] = humans
    .filter((m) => byMember.has(m.id))
    .map((m) => ({ key: m.id, member: m, todos: byMember.get(m.id)! }));
  if (unassigned.length) result.push({ key: 'unassigned', member: null, todos: unassigned });
  return result;
});

function caption(count: number): string {
  const key = count === 1 ? 'todo.reminders.perPerson.one' : 'todo.reminders.perPerson.other';
  return fillTemplate(t(key), { count: String(count) });
}

function nextLabel(todo: TodoItem): string {
  return todo.dueDate ? dueDayLabel(extractDatePart(todo.dueDate), today.value, t) : '';
}

/** The card's emoji for a card-made to-do (when the card still resolves); else the row shows ↻. */
function cardEmoji(todo: TodoItem): string | null {
  return resolveCardLink(todo)?.emoji ?? null;
}
</script>

<template>
  <p
    v-if="todos.length === 0"
    class="dark:text-ink-faint py-4 text-center text-sm text-[var(--color-text-muted)]"
    data-testid="todo-reminders-empty"
  >
    {{ t('todo.reminders.empty') }}
  </p>
  <div v-else class="space-y-3" data-testid="todo-reminders-roster">
    <MemberGroupCard
      v-for="group in groups"
      :key="group.key"
      :member="group.member"
      :name="group.member ? '' : t('todo.unassigned')"
      :caption="caption(group.todos.length)"
      :data-group="group.key"
    >
      <p
        v-if="group.member && !isAdultMember(group.member)"
        class="dark:text-ink-faint -mt-1.5 text-xs text-[var(--color-text-muted)]"
        data-testid="todo-reminders-adults-see"
      >
        {{ t('whoOwnsWhat.reminder.adultsSee') }}
      </p>
      <ul>
        <li
          v-for="todo in group.todos"
          :key="todo.id"
          class="dark:border-line border-t border-[var(--color-border)] py-2.5 last:pb-0"
        >
          <button
            type="button"
            class="flex w-full min-w-0 items-center gap-2.5 text-left"
            :data-roster-todo="todo.id"
            @click="emit('view', todo)"
          >
            <span
              v-if="cardEmoji(todo)"
              class="dark:bg-surface-hover flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--tint-orange-8)] text-base"
              aria-hidden="true"
              >{{ cardEmoji(todo) }}</span
            >
            <RepeatGlyph v-else />
            <span class="min-w-0 flex-1">
              <span
                class="font-outfit dark:text-ink block truncate text-sm font-semibold text-[var(--color-text)]"
                >{{ todo.title }}</span
              >
              <span
                class="dark:text-ink-soft block truncate text-xs text-[var(--color-text-muted)]"
                >{{ describeTodo(todo) }}</span
              >
            </span>
            <span v-if="todo.dueDate" class="shrink-0 text-right">
              <span
                class="font-outfit dark:text-ink-faint block text-xs font-semibold text-[var(--color-text-muted)]"
                >{{ t('todo.reminders.next') }}</span
              >
              <span
                class="font-outfit dark:text-ink block text-xs font-semibold text-[var(--color-text)]"
                >{{ nextLabel(todo) }}</span
              >
            </span>
          </button>
          <div v-if="todo.cardId" class="mt-1 pl-[2.625rem]">
            <LinkedCardChip :card-id="todo.cardId" :part-key="todo.cardPartKey" />
          </div>
        </li>
      </ul>
    </MemberGroupCard>
  </div>
</template>
