<script setup lang="ts">
/**
 * A start and an end time in one picker: two pills side by side, one host, one panel. The only
 * time component that knows the word "step".
 *
 *  - START step: Recent (the family's last start times) and, with `allDayAffordance`, All day.
 *    Picks stay in the sheet (`holdPicks`): nothing moves on by itself, so the person sees the
 *    time they built before anything changes. "End time ›" writes the start and turns the same
 *    sheet to the END step; Done writes and closes. Whether the END moves with the start is
 *    the form's call (`endFollowsStart` in its start watcher), never this component's.
 *  - END step: Lasts (durations counted from `start`), a "‹ Start 4:15pm" link back, and Clear
 *    with `clearableEnd`. Picks are held here too; Done writes and closes. The end pill itself
 *    has no ✕: Clear lives in the sheet.
 *
 * Tapping the other pill while open switches step and re-anchors; tapping the open step's pill
 * closes. The panel is keyed by step, so its private state resets on advance and on back.
 *
 * Leaving the start step with a written value (finish or Done) records it as a recent start
 * time (`settingsStore.rememberStartTime`, the only writer).
 *
 * Labels: each column is a `FormFieldGroup` labelled `startLabel` / `endLabel`, unless the
 * caller fills `#label="{ text }"`, which then renders above each pill instead.
 *
 * Telemetry: `debug` `{ action: 'range_step', kind: 'advanced' | 'closed' | 'back' }` on surface
 * `time-picker`, so the start-to-end flow rate is measurable beside the panel's `time_set`.
 */
import { computed, ref } from 'vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import TimePickerHost from '@/components/ui/TimePickerHost.vue';
import TimePickerPanel from '@/components/ui/TimePickerPanel.vue';
import TimePickerPill from '@/components/ui/TimePickerPill.vue';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry/logEvent';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatTime12, isWallClockTime } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';

type Step = 'start' | 'end';

interface Props {
  /** `HH:mm` or `''`. */
  start: string;
  /** `HH:mm` or `''`. */
  end: string;
  /** Offer All day on the start step. */
  allDayAffordance?: boolean;
  /** Offer Clear on the end step (an optional end time). */
  clearableEnd?: boolean;
  /** Default: "Start Time". */
  startLabel?: string;
  /** Default: "End Time". */
  endLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  allDayAffordance: false,
  clearableEnd: false,
  startLabel: undefined,
  endLabel: undefined,
});

const emit = defineEmits<{
  'update:start': [value: string];
  'update:end': [value: string];
  'all-day': [];
}>();

defineSlots<{
  label?: (props: { text: string }) => unknown;
}>();

const { t } = useTranslation();
const settingsStore = useSettingsStore();

const host = ref<InstanceType<typeof TimePickerHost> | null>(null);
const pills: Record<Step, InstanceType<typeof TimePickerPill> | null> = { start: null, end: null };
const step = ref<Step>('start');

function pillLabel(value: string): string {
  return isWallClockTime(value) ? formatTime12(value) : t('modal.selectTime');
}

const columns = computed(() => [
  {
    step: 'start' as const,
    text: props.startLabel ?? t('modal.startTime'),
    value: props.start,
  },
  {
    step: 'end' as const,
    text: props.endLabel ?? t('modal.endTime'),
    value: props.end,
  },
]);

const activeColumn = computed(() => columns.value.find((c) => c.step === step.value)!);
const subtitle = computed(() =>
  isWallClockTime(activeColumn.value.value) ? formatTime12(activeColumn.value.value) : undefined
);
const backLabel = computed(() =>
  isWallClockTime(props.start)
    ? fillTemplate(t('time.backToStart'), { time: formatTime12(props.start) })
    : undefined
);

// The panel has no mode: each step is just a different set of props (Recent and All day on the
// start, Lasts, the back link and Clear on the end).
const panelProps = computed(() =>
  step.value === 'start'
    ? {
        value: props.start,
        recent: settingsStore.recentStartTimes,
        allDayAffordance: props.allDayAffordance,
        nextLabel: t('time.nextEndTime'),
      }
    : {
        value: props.end,
        durationsFrom: props.start,
        backLabel: backLabel.value,
        clearable: props.clearableEnd,
      }
);

function setPill(which: Step, el: unknown): void {
  pills[which] = (el as InstanceType<typeof TimePickerPill> | null) ?? null;
}

function logStep(kind: 'advanced' | 'closed' | 'back'): void {
  logEvent({
    level: 'debug',
    surface: 'time-picker',
    message: 'time range step',
    context: { action: 'range_step', kind },
  });
}

/** Open (or re-anchor) the shared host on `which`'s pill. */
function showStep(which: Step): void {
  step.value = which;
  const el = pills[which]?.triggerEl;
  if (el) host.value?.open(el);
}

function onPill(which: Step, el: HTMLElement): void {
  if (host.value?.isOpen && step.value === which) {
    host.value.close();
    return;
  }
  step.value = which;
  host.value?.open(el);
}

/** The single caller of `rememberStartTime`: the start step was left with this value. */
function leaveStartStep(value: string): void {
  void settingsStore.rememberStartTime(value);
}

/** Write the start (when it changed) and record it as a recent start time. */
function writeStart(value: string | null): void {
  if (value === null) return;
  emit('update:start', value);
  leaveStartStep(value);
}

function onNext(value: string | null): void {
  writeStart(value);
  logStep('advanced');
  showStep('end');
}

function onDone(value: string | null): void {
  if (step.value === 'start') {
    writeStart(value);
    logStep('closed');
  } else if (value !== null) {
    emit('update:end', value);
  }
  host.value?.close();
}

function onClear(): void {
  emit('update:end', '');
  host.value?.close();
}

function onBack(): void {
  logStep('back');
  showStep('start');
}

function onAllDay(): void {
  // Close first, so the normal close path runs before the caller folds this range away.
  host.value?.close();
  emit('all-day');
}
</script>

<template>
  <TimePickerHost ref="host" :title="activeColumn.text" :subtitle="subtitle">
    <template #default="{ isOpen }">
      <div class="grid grid-cols-2 gap-3">
        <component
          :is="$slots.label ? 'div' : FormFieldGroup"
          v-for="col in columns"
          :key="col.step"
          class="min-w-0"
          v-bind="$slots.label ? {} : { label: col.text }"
          :data-time-range-column="col.step"
        >
          <slot v-if="$slots.label" name="label" :text="col.text" />
          <TimePickerPill
            :ref="(el) => setPill(col.step, el)"
            :label="pillLabel(col.value)"
            :is-set="isWallClockTime(col.value)"
            :is-open="isOpen && step === col.step"
            @toggle="(el) => onPill(col.step, el)"
          />
        </component>
      </div>
    </template>
    <template #panel="{ isSheet }">
      <TimePickerPanel
        :key="step"
        v-bind="panelProps"
        :autofocus-typed="!isSheet"
        hold-picks
        @next="onNext"
        @done="onDone"
        @clear="onClear"
        @all-day="onAllDay"
        @back="onBack"
      />
    </template>
  </TimePickerHost>
</template>
