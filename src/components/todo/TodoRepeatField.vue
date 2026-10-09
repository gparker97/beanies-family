<script setup lang="ts">
/**
 * The "Repeats" block of To-do Details (#123). The drawer (`TodoViewEditModal`) owns only the
 * inline-edit wiring: it passes `editing` and the draft rule, and saves through
 * `todoStore.setRepeat` on its ✓. Everything shown here derives from the to-do itself.
 *
 * View, repeating: the cadence with its time, "Done or skipped, it moves to {date}" (or "This is
 * the last one."), and a Recent strip of the newest handled or missed occurrences (Skip This
 * Time sits beside the title in the drawer). A card-made to-do gets the locked look with
 * "Set on the {card} card", which opens the card (emits `open-card` so the drawer closes).
 *
 * View, not repeating: one quiet "Repeat This To-do" row; a tap on the field starts editing.
 *
 * Edit (never for a card-made to-do, whose repeat is the card's): the `RecurrencePicker` with
 * its Ends row, started on `repeatStartDate` (the date `setRepeat` stores as the anchor, so the
 * summary shown is the rule saved), and "Turn off repeat" (emits `turn-off`).
 *
 * Every button here stops its click, so it never also starts the field's inline edit.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useToday } from '@/composables/useToday';
import { useTodoCardLink } from '@/composables/useTodoCardLink';
import { resolveTodoRule } from '@/services/recurrence/adapters';
import { nextDueAfter } from '@/services/recurrence/recurrenceEngine';
import {
  isCardTodo,
  recentOccurrences,
  repeatStartDate,
  todoCapabilities,
  type RecentOccurrence,
} from '@/utils/todoRecurrence';
import { extractDatePart, formatDateShort, formatNookDate } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import RepeatGlyph from '@/components/todo/RepeatGlyph.vue';
import type { RecurrenceRule, TodoItem } from '@/types/models';

/** How many occurrences the Recent strip shows. */
const RECENT_SHOWN = 5;

const props = defineProps<{
  todo: TodoItem;
  editing: boolean;
  draftRule: RecurrenceRule | null;
}>();

const emit = defineEmits<{
  'turn-off': [];
  'update:draftRule': [rule: RecurrenceRule];
  'open-card': [cardId: string];
}>();

const { t } = useTranslation();
const { describeTodo } = useRecurrenceLabel();
const { getMemberName } = useMemberInfo();
const { today } = useToday();
const { resolveCardLink, openCard } = useTodoCardLink();

const resolved = computed(() => resolveTodoRule(props.todo));
const caps = computed(() => todoCapabilities(props.todo));
const cardMade = computed(() => isCardTodo(props.todo));
const summary = computed(() => describeTodo(props.todo));
const card = computed(() => resolveCardLink(props.todo));

const dueYmd = computed(() => (props.todo.dueDate ? extractDatePart(props.todo.dueDate) : ''));

/** Where the next roll lands: null when the rule has no occurrence after this one. */
const nextYmd = computed(() => {
  const r = resolved.value;
  if (!r || !dueYmd.value) return null;
  return nextDueAfter(r.rule, r.anchor, dueYmd.value);
});

/** "Done or skipped, it moves to {date}", split around the date so the date can be bold. */
const nextParts = computed(() => {
  const [before = '', after = ''] = t('todo.repeat.next').split('{date}');
  return { before, after };
});

const recent = computed(() => recentOccurrences(props.todo, RECENT_SHOWN));

function recentLabel(o: RecentOccurrence): string {
  const date = formatDateShort(o.date);
  if (o.outcome === 'missed') return fillTemplate(t('todo.repeat.recentMissed'), { date });
  if (o.outcome === 'skipped') return fillTemplate(t('todo.repeat.recentSkipped'), { date });
  const name = o.by ? getMemberName(o.by, '') : '';
  return name ? fillTemplate(t('todo.repeat.recentDone'), { date, name }) : date;
}

const RECENT_CHIP_CLASS: Record<RecentOccurrence['outcome'], string> = {
  done: 'dark:bg-surface-hover dark:text-success-lift bg-[var(--tint-success-10)] text-green-700',
  skipped:
    'dark:bg-surface-hover dark:text-ink-soft dark:border-line-strong border border-dashed border-[var(--tint-slate-10)] bg-[var(--tint-slate-5)] text-[var(--color-text-muted)]',
  missed:
    'dark:bg-surface-hover dark:text-accent-lift dark:border-line-strong border border-dashed border-[var(--tint-orange-15)] bg-[var(--tint-slate-5)] text-primary-700',
};

const startDate = computed(() => repeatStartDate(props.todo, today.value));

function onOpenCard(): void {
  if (!card.value) return;
  openCard(card.value.cardId);
  emit('open-card', card.value.cardId);
}
</script>

<template>
  <!-- Edit: the picker, then turn off (only when there is a repeat to turn off) -->
  <div
    v-if="editing && caps.editRepeat"
    class="w-full min-w-0 space-y-3"
    data-testid="todo-repeat-edit"
  >
    <RecurrencePicker
      :model-value="draftRule"
      accent="purple"
      default-cadence="weekly"
      :start-date="startDate"
      :time="todo.dueTime"
      @update:model-value="emit('update:draftRule', $event)"
    />
    <button
      v-if="resolved"
      type="button"
      class="font-outfit text-primary-600 dark:text-accent-lift text-sm font-semibold hover:underline"
      data-testid="todo-repeat-turn-off"
      @click.stop="emit('turn-off')"
    >
      {{ t('todo.repeat.turnOff') }}
    </button>
  </div>

  <!-- View, repeating -->
  <div
    v-else-if="resolved"
    class="dark:bg-surface-overlay w-full min-w-0 flex-1 space-y-2.5 rounded-[16px] px-3.5 py-3"
    :class="cardMade ? 'bg-[var(--tint-slate-5)]' : 'bg-[var(--tint-purple-8)]'"
    data-testid="todo-repeat-view"
  >
    <div class="flex items-center gap-3">
      <RepeatGlyph />
      <div class="min-w-0 flex-1">
        <p class="font-outfit dark:text-ink text-sm text-[var(--color-text)]">
          {{ t('recurrence.repeats') }} <b class="font-semibold">{{ summary }}</b>
        </p>
        <p v-if="cardMade" class="flex items-center gap-1 text-xs" data-testid="todo-repeat-locked">
          <span class="dark:text-ink-faint text-[var(--color-text-muted)]" aria-hidden="true"
            >🔒</span
          >
          <button
            v-if="card"
            type="button"
            class="font-outfit text-primary-600 dark:text-accent-lift font-semibold hover:underline"
            data-testid="todo-repeat-card-link"
            @click.stop="onOpenCard"
          >
            {{ fillTemplate(t('todo.repeat.setOnCard'), { card: card.name }) }}
          </button>
        </p>
      </div>
    </div>

    <!-- Dark: level with the block plus a line edge, never below it (CIG slide 8). -->
    <div
      class="dark:bg-surface-overlay dark:border-line rounded-xl border border-transparent bg-white px-3 py-2"
    >
      <p
        class="dark:text-ink-soft min-w-0 text-sm text-[var(--color-text-muted)]"
        data-testid="todo-repeat-next"
      >
        <template v-if="nextYmd"
          >{{ nextParts.before
          }}<b class="dark:text-ink font-semibold text-[var(--color-text)]">{{
            formatNookDate(nextYmd)
          }}</b
          >{{ nextParts.after }}</template
        >
        <template v-else>{{ t('todo.repeat.lastOne') }}</template>
      </p>
    </div>

    <div v-if="recent.length" data-testid="todo-repeat-recent">
      <p
        class="font-outfit dark:text-ink-faint mb-1.5 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase"
      >
        {{ t('todo.repeat.recent') }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="o in recent"
          :key="o.date"
          class="font-outfit inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="RECENT_CHIP_CLASS[o.outcome]"
          :data-outcome="o.outcome"
        >
          <template v-if="o.outcome === 'done'">
            <span aria-hidden="true">✓</span>
            <span class="sr-only">{{ t('todo.status.completed') }}</span>
          </template>
          {{ recentLabel(o) }}
        </span>
      </div>
    </div>
  </div>

  <!-- View, not repeating: the quiet offer (a tap on the field opens the picker) -->
  <div v-else class="flex items-center gap-3" data-testid="todo-repeat-off">
    <RepeatGlyph />
    <div class="min-w-0">
      <p class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]">
        {{ t('todo.repeat.toggle') }}
      </p>
      <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ t('todo.repeat.toggleHintOff') }}
      </p>
    </div>
  </div>
</template>
