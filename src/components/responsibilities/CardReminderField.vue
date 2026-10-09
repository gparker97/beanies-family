<script setup lang="ts">
/**
 * Who Owns What (#123): the reminder control for ONE card part in the card edit drawer.
 * Presentational: it edits the draft value it is given and emits the next one; the drawer
 * saves the whole card once.
 *
 *  - A `ToggleRow` ("Remind the Holder", or "Remind {holder}" on a split part) whose hint
 *    names who it reminds today, or says nobody holds the part yet.
 *  - Expanded: What to Say (placeholder = the card name, which is also what a blank saves),
 *    How Often (`RecurrencePicker`, no Ends row) and At (`TimePresetPicker`).
 *  - Collapsed with a reminder (a split part another part's control is open over): the
 *    summary, what it says, and Change.
 *
 * Every change emits `buildCardReminder(...)`, the ONE place a reminder (and its anchor) is
 * built. The picker's start date is `reminderStartDate` of the value seen when the control
 * opened, frozen while it stays open, so the date the picker drew with and the anchor a
 * cadence change stores are the same date.
 */
import { computed, ref, watch } from 'vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import ConditionalSection from '@/components/ui/ConditionalSection.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import RecurrencePicker from '@/components/ui/RecurrencePicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import { useToday } from '@/composables/useToday';
import { cadenceToRule } from '@/services/recurrence/cadence';
import { buildCardReminder, reminderStartDate } from '@/utils/cardReminders';
import { fillTemplate } from '@/utils/fillTemplate';
import type { CardReminder } from '@/types/models';
import type { RecurrenceRule } from '@/types/recurrence';

const props = withDefaults(
  defineProps<{
    modelValue: CardReminder | null;
    /** Who holds this part today; null when nobody does. */
    holderName: string | null;
    /** The card's name: the What to Say placeholder, and what a blank saves. */
    cardName: string;
    /** The holder is a child (adults see the to-do too). */
    childHolder: boolean;
    /** Set on a split card's part ("for Leo", "upstairs"): the per-part look. */
    partLabel?: string;
    expanded: boolean;
  }>(),
  { partLabel: undefined }
);

const emit = defineEmits<{
  'update:modelValue': [value: CardReminder | null];
  'update:expanded': [value: boolean];
}>();

const { t } = useTranslation();
const { describeWithTime } = useRecurrenceLabel();
const { today } = useToday();

const isPart = computed(() => props.partLabel !== undefined);

/** Switched on, waiting for the picker's first rule (it emits its default on mount). */
const turningOn = ref(false);
const isOn = computed(() => !!props.modelValue || turningOn.value);
const showBox = computed(() => isOn.value && props.expanded);

/** What to Say, as typed. Kept locally so clearing the box never snaps to the card name. */
const say = ref(props.modelValue?.say ?? '');
/** The picker's start date: frozen per opening (see the header). */
const startYmd = ref(reminderStartDate(props.modelValue, today.value));
watch(
  () => props.expanded,
  (open) => {
    if (!open) {
      turningOn.value = false;
      return;
    }
    startYmd.value = reminderStartDate(props.modelValue, today.value);
    say.value = props.modelValue?.say ?? say.value;
  }
);

/** The stored cadence as a rule (the picker recognises its own echo by `ruleKey`). */
const rule = computed<RecurrenceRule | null>(() => {
  const stored = props.modelValue?.cadence;
  return stored ? cadenceToRule(stored) : null;
});
const time = computed(() => props.modelValue?.time ?? '');

const summary = computed(() =>
  props.modelValue && rule.value
    ? describeWithTime(rule.value, props.modelValue.anchor, props.modelValue.time, 'card')
    : ''
);

const title = computed(() =>
  isPart.value && props.holderName
    ? fillTemplate(t('whoOwnsWhat.reminder.togglePart'), { name: props.holderName })
    : t('whoOwnsWhat.reminder.toggle')
);

const hint = computed(() => {
  if (!props.holderName) return t('whoOwnsWhat.reminder.hintNobody');
  // A split part's hint is said once, above the parts, by the drawer.
  if (isPart.value) return '';
  const key = isOn.value ? 'whoOwnsWhat.reminder.hintOn' : 'whoOwnsWhat.reminder.hintOff';
  return fillTemplate(t(key), { name: props.holderName });
});

function emitWith(next: { rule?: RecurrenceRule; time?: string }): void {
  const r = next.rule ?? rule.value;
  if (!r) return;
  emit(
    'update:modelValue',
    buildCardReminder(
      props.modelValue,
      { say: say.value, rule: r, time: next.time ?? time.value },
      props.cardName,
      startYmd.value
    )
  );
}

function onToggle(on: boolean): void {
  if (on) {
    // The picker mounts on the next render and publishes its default rule (today's weekday).
    startYmd.value = reminderStartDate(null, today.value);
    turningOn.value = true;
    emit('update:expanded', true);
    return;
  }
  turningOn.value = false;
  emit('update:modelValue', null);
  emit('update:expanded', false);
}

function onRule(next: RecurrenceRule): void {
  turningOn.value = false;
  emitWith({ rule: next });
}

function onSay(value: string | number): void {
  say.value = String(value);
  emitWith({});
}

function onTime(value: string): void {
  emitWith({ time: value });
}
</script>

<template>
  <div class="space-y-3" :data-testid="isPart ? 'card-reminder-part' : 'card-reminder'">
    <ToggleRow
      :model-value="isOn"
      :title="title"
      :hint="hint"
      testid="card-reminder-toggle"
      @update:model-value="onToggle"
    >
      <p
        v-if="isOn && childHolder"
        class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
        data-testid="card-reminder-adults"
      >
        {{ t('whoOwnsWhat.reminder.adultsSee') }}
      </p>
      <div
        v-if="modelValue && !expanded"
        class="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2"
        data-testid="card-reminder-summary"
      >
        <span
          class="font-outfit dark:text-ink min-w-0 text-sm font-semibold text-[var(--color-text)]"
          ><span class="text-primary-500 dark:text-accent-lift" aria-hidden="true">🔔</span>
          {{ summary }}</span
        >
        <span class="dark:text-ink-faint min-w-0 truncate text-xs text-[var(--color-text-muted)]"
          >"{{ modelValue.say }}"</span
        >
        <button
          type="button"
          class="font-outfit text-primary-500 dark:text-accent-lift dark:hover:bg-surface-hover rounded-lg px-1 text-xs font-semibold transition-colors hover:bg-[var(--tint-orange-8)]"
          data-testid="card-reminder-change"
          @click="emit('update:expanded', true)"
        >
          {{ t('whoOwnsWhat.reminder.change') }}
        </button>
      </div>
    </ToggleRow>

    <p
      v-if="!isOn && !isPart"
      class="dark:border-line-strong dark:text-ink-soft flex items-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-[var(--color-border)] px-3.5 py-3 text-sm text-[var(--color-text-muted)]"
      data-testid="card-reminder-off"
    >
      <span aria-hidden="true">🔕</span>{{ t('whoOwnsWhat.reminder.none') }}
    </p>

    <ConditionalSection :show="showBox">
      <div class="space-y-4">
        <FormFieldGroup :label="t('whoOwnsWhat.reminder.say')">
          <BaseInput
            :model-value="say"
            :placeholder="cardName"
            data-testid="card-reminder-say"
            @update:model-value="onSay"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('whoOwnsWhat.reminder.howOften')">
          <RecurrencePicker
            v-if="showBox"
            :model-value="rule"
            hide-end
            accent="orange"
            default-cadence="weekly"
            :start-date="startYmd"
            :time="time || undefined"
            @update:model-value="onRule"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('whoOwnsWhat.reminder.at')">
          <TimePresetPicker :model-value="time" clearable @update:model-value="onTime" />
        </FormFieldGroup>
      </div>
    </ConditionalSection>
  </div>
</template>
