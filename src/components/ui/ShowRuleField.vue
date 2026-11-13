<script setup lang="ts">
/**
 * "Show from": when a dated to-do or list starts showing on the daily briefing, the Nook and
 * the widgets. v-model is a `TodoShowRule` (`utils/todoPlate`); the field's date and the stored
 * rule convert through `fieldShowRule` / `showRuleField` only, so the date picker never writes a
 * date that should have been a flag. The rule logic is kind-free; `kind` only picks the accent
 * and the page named in the hint (`SHOW_KIND_PRESENTATION`), and the host passes the kind's own
 * rule (a list defaults to "on the due date", a to-do to "right away").
 *
 * One-off: "Show from [date]", with a one-tap shortcut that flips between "On the due date"
 * and "Today" (the field reads the due date for a list's default rule, so its shortcut reads
 * "Today"). Repeating: three choices, "On each due date" (the default), "Days before" (1 to
 * 30, starting at 3, bounded by the cadence) and "Every day". Nothing renders without a due
 * date: an undated subject always shows.
 *
 * The optional `due` slot is a host's due-date control (the list drawer). When given, a one-off
 * lays it and "Show from" side by side, with the hint below both; the slot still renders on
 * its own when there is no show choice to offer.
 *
 * `readonly` swaps the controls for the plain-language hint (a completed or card-made to-do).
 */
import { computed, useSlots, watch } from 'vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import ChipButton from '@/components/ui/ChipButton.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import NumberStepper from '@/components/ui/NumberStepper.vue';
import { SHOW_KIND_PRESENTATION } from '@/components/ui/showRuleKinds';
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
  type ShowKind,
  type TodoShowRule,
} from '@/utils/todoPlate';

const props = withDefaults(
  defineProps<{
    modelValue: TodoShowRule;
    repeating: boolean;
    dueDate: string;
    readonly?: boolean;
    /** The repeat's cadence: it bounds "days before" (`maxShowLead`). */
    cadence?: Cadence | null;
    /** What is being shown: picks the accent and the page the hint names. */
    kind?: ShowKind;
  }>(),
  { readonly: false, cadence: null, kind: 'todo' }
);

const emit = defineEmits<{ 'update:modelValue': [rule: TodoShowRule] }>();

const { t } = useTranslation();
const { today } = useToday();
const slots = useSlots();

const presentation = computed(() => SHOW_KIND_PRESENTATION[props.kind]);
const due = computed(() => props.dueDate.slice(0, 10));

/** A one-off due today or earlier already shows: there is nothing to choose. */
const shown = computed(() => showFieldApplies(props.repeating, due.value, today.value));
/** The host's due control sits beside "Show from" (one-off, with a choice to offer). */
const split = computed(() => !!slots.due && shown.value && !props.repeating && !props.readonly);

/** The one-off field's date: today unless the rule holds the subject back. */
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
// picked) follows the repeat. A saved subject never reaches here over the limit: `showRuleOf`
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
  const page = t(presentation.value.pageKey);
  if (props.repeating) {
    const rule = props.modelValue;
    if (rule.kind === 'now') return t('todo.show.hint.repeat.now');
    if (rule.kind === 'lead') {
      const key =
        rule.days === 1 ? 'todo.show.hint.repeat.lead.one' : 'todo.show.hint.repeat.lead.other';
      return fillTemplate(t(key), { n: rule.days, page });
    }
    return fillTemplate(t('todo.show.hint.repeat.due'), { page });
  }
  if (isDueDate.value && due.value !== today.value) {
    return fillTemplate(t('todo.show.hint.once.due'), { due: dueLabel, page });
  }
  if (fieldDate.value === today.value) {
    return fillTemplate(t('todo.show.hint.once.now'), { due: dueLabel });
  }
  return fillTemplate(t('todo.show.hint.once.from'), {
    date: formatNookDate(fieldDate.value),
    due: dueLabel,
    page,
  });
});
</script>

<template>
  <div
    v-if="shown || $slots.due"
    class="space-y-2"
    :data-testid="shown ? 'show-rule-field' : undefined"
  >
    <div
      v-if="$slots.due || (shown && !readonly)"
      :class="split ? 'grid grid-cols-2 items-start gap-3' : 'space-y-2'"
    >
      <div v-if="$slots.due" class="min-w-0"><slot name="due" /></div>
      <template v-if="shown && !readonly">
        <!-- One-off: a date, reading today unless the rule holds the subject back -->
        <FormFieldGroup v-if="!repeating" :label="t('todo.show.label')" class="min-w-0">
          <div class="flex flex-wrap items-center gap-2" data-testid="show-rule-once">
            <!-- Beside a due field the column is half width: the picker takes the whole row
                 and the shortcut wraps under it, or the date is squeezed down to its icon. -->
            <div :class="split ? 'w-full min-w-0' : 'min-w-0 flex-1'">
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
              :accent="presentation.accent"
              data-testid="show-rule-shortcut"
              @click="onShortcut"
            />
          </div>
        </FormFieldGroup>

        <!-- Repeating: when each occurrence starts showing -->
        <FormFieldGroup v-else :label="t('todo.show.repeat.label')">
          <div class="space-y-2" data-testid="show-rule-repeat">
            <FrequencyChips
              :model-value="repeatChoice"
              :options="repeatOptions"
              :accent="presentation.accent"
              @update:model-value="onRepeatChoice"
            />
            <div v-if="repeatChoice === 'lead'" data-testid="show-rule-lead">
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
    </div>

    <p
      v-if="shown"
      class="dark:text-ink-soft text-xs text-[var(--color-text-muted)]"
      data-testid="show-rule-hint"
    >
      {{ hint }}
    </p>
  </div>
</template>
