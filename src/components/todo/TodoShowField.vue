<script setup lang="ts">
/**
 * "Show from": when a dated to-do starts showing on the daily briefing, the Nook and the
 * widgets. v-model is a `TodoShowRule` (`utils/todoPlate`); the field's date and the stored rule
 * convert through `fieldShowRule` / `showRuleField` only, so the date picker never writes a
 * date that should have been a flag.
 *
 * One-off: "Show from [date]", defaulting to today, up to the due date, with a one-tap
 * "On the due date" (which reads "Today" once the date is the due date). Repeating: three
 * choices, "On each due date" (the default), "Days before" (1 to 30, starting at 3) and
 * "Every day". Nothing renders without a due date: an undated to-do always shows.
 *
 * `readonly` swaps the controls for the plain-language hint (a completed or card-made to-do).
 */
import { computed, watch } from 'vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useToday } from '@/composables/useToday';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import type { Cadence } from '@/types/recurrence';
import {
  fieldShowRule,
  showFieldApplies,
  showRuleField,
  SHOW_LEAD_DEFAULT,
  maxShowLead,
  type TodoShowRule,
} from '@/utils/todoPlate';

const props = defineProps<{
  modelValue: TodoShowRule;
  repeating: boolean;
  dueDate: string;
  readonly?: boolean;
  /** The repeat's cadence: it bounds "days before" (`maxShowLead`). */
  cadence?: Cadence | null;
}>();

const emit = defineEmits<{ 'update:modelValue': [rule: TodoShowRule] }>();

const { t } = useTranslation();
const { today } = useToday();

const due = computed(() => props.dueDate.slice(0, 10));

/** A one-off due today or earlier already shows: there is nothing to choose. */
const shown = computed(() => showFieldApplies(props.repeating, due.value, today.value));

/** The one-off field's date: today unless the rule holds the to-do back. */
const fieldDate = computed(() => showRuleField(props.modelValue, due.value, today.value));
const isDueDate = computed(() => fieldDate.value === due.value);

function onDate(date: string): void {
  emit('update:modelValue', fieldShowRule(date, due.value, today.value));
}

function onShortcut(): void {
  emit('update:modelValue', isDueDate.value ? { kind: 'now' } : { kind: 'due' });
}

/** A repeating rule is `due`, `lead` or `now`; a stray one-off `from` reads as `due`. */
const repeatChoice = computed(() => {
  const kind = props.modelValue.kind;
  return kind === 'from' ? 'due' : kind;
});
/** The longest lead that fits between two occurrences; 0 on a daily repeat (not offered). */
const leadMax = computed(() => maxShowLead(props.cadence));
const repeatOptions = computed(() => [
  { value: 'due', label: t('todo.show.repeat.due') },
  ...(leadMax.value >= 1 ? [{ value: 'lead', label: t('todo.show.repeat.lead') }] : []),
  { value: 'now', label: t('todo.show.repeat.now') },
]);

const leadDays = computed(() =>
  Math.min(
    props.modelValue.kind === 'lead' ? props.modelValue.days : SHOW_LEAD_DEFAULT,
    Math.max(1, leadMax.value)
  )
);

// A draft lead the repeat no longer leaves room for (the repeat was shortened after it was
// picked) follows the repeat. A saved to-do never reaches here over the limit: `todoShowRule`
// already reads it clamped.
watch(
  [leadMax, () => props.modelValue],
  ([max, rule]) => {
    if (props.readonly || !props.repeating || rule.kind !== 'lead' || rule.days <= max) return;
    emit('update:modelValue', max >= 1 ? { kind: 'lead', days: max } : { kind: 'due' });
  },
  { immediate: true }
);

function onRepeatChoice(value: string): void {
  if (value === 'lead') emit('update:modelValue', { kind: 'lead', days: leadDays.value });
  else emit('update:modelValue', { kind: value === 'now' ? 'now' : 'due' });
}

function onLead(days: number | undefined): void {
  // A blank stepper is mid-edit; keep the last whole number.
  if (days !== undefined) emit('update:modelValue', { kind: 'lead', days });
}

const hint = computed(() => {
  const dueLabel = due.value ? formatNookDate(due.value) : '';
  if (props.repeating) {
    const rule = props.modelValue;
    if (rule.kind === 'now') return t('todo.show.hint.repeat.now');
    if (rule.kind === 'lead') {
      const key =
        rule.days === 1 ? 'todo.show.hint.repeat.lead.one' : 'todo.show.hint.repeat.lead.other';
      return fillTemplate(t(key), { n: rule.days });
    }
    return t('todo.show.hint.repeat.due');
  }
  if (isDueDate.value && due.value !== today.value) {
    return fillTemplate(t('todo.show.hint.once.due'), { due: dueLabel });
  }
  if (fieldDate.value === today.value) {
    return fillTemplate(t('todo.show.hint.once.now'), { due: dueLabel });
  }
  return fillTemplate(t('todo.show.hint.once.from'), {
    date: formatNookDate(fieldDate.value),
    due: dueLabel,
  });
});
</script>

<template>
  <div v-if="shown" class="space-y-2" data-testid="todo-show-field">
    <template v-if="!readonly">
      <!-- One-off: a date, defaulting to today -->
      <FormFieldGroup v-if="!repeating" :label="t('todo.show.label')">
        <div class="flex flex-wrap items-center gap-2" data-testid="todo-show-once">
          <div class="min-w-0 flex-1">
            <BeanieDatePicker
              :model-value="fieldDate"
              :min="today"
              :max="due"
              @update:model-value="onDate"
            />
          </div>
          <ChipButton
            :label="isDueDate ? t('todo.show.today') : t('todo.show.onDueDate')"
            :selected="false"
            accent="purple"
            data-testid="todo-show-shortcut"
            @click="onShortcut"
          />
        </div>
      </FormFieldGroup>

      <!-- Repeating: when each occurrence starts showing -->
      <FormFieldGroup v-else :label="t('todo.show.repeat.label')">
        <div class="space-y-2" data-testid="todo-show-repeat">
          <FrequencyChips
            :model-value="repeatChoice"
            :options="repeatOptions"
            accent="purple"
            @update:model-value="onRepeatChoice"
          />
          <div v-if="repeatChoice === 'lead'" data-testid="todo-show-lead">
            <NumberStepper
              :model-value="leadDays"
              :min="1"
              :max="leadMax"
              :label="t('todo.show.lead.aria')"
              :unit="
                leadDays === 1 ? t('todo.show.lead.suffix.one') : t('todo.show.lead.suffix.other')
              "
              @update:model-value="onLead"
            />
          </div>
        </div>
      </FormFieldGroup>
    </template>

    <p
      class="dark:text-ink-soft text-xs text-[var(--color-text-muted)]"
      data-testid="todo-show-hint"
    >
      {{ hint }}
    </p>
  </div>
</template>
