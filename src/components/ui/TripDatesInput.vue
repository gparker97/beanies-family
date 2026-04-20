<script setup lang="ts">
/**
 * Reusable trip-dates input — two date pickers plus quick-add chips and
 * a live "N days" summary. Used at wizard Step 1 (new trip) and on the
 * trip summary page (edit-dates affordance). See ADR-023 for why trip
 * dates are user-owned.
 *
 * Props are v-model-friendly (`v-model:start-date`, `v-model:end-date`).
 * The component validates internally and emits `update:isValid` so the
 * parent can gate its Next / Save button without reimplementing the
 * same checks. Error text renders inline with `aria-describedby`
 * wiring so screen readers announce the failure alongside the inputs.
 */
import { computed, watch } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { parseLocalDate, addDays, toDateInputValue } from '@/utils/date';
import { isValidISODate, tripDurationDays } from '@/utils/vacation';

interface Props {
  startDate: string;
  endDate: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  'update:startDate': [value: string];
  'update:endDate': [value: string];
  'update:isValid': [value: boolean];
  'update:errorMessage': [value: string | null];
}>();

const { t } = useTranslation();

// Stable id for aria-describedby linkage — one per component instance.
const errorId = `trip-dates-error-${Math.random().toString(36).slice(2, 9)}`;

const bothSet = computed(() => !!props.startDate && !!props.endDate);
const bothValid = computed(
  () => bothSet.value && isValidISODate(props.startDate) && isValidISODate(props.endDate)
);
const endBeforeStart = computed(() => bothValid.value && props.endDate < props.startDate);

/**
 * Error message for inline display + parent. Stays null when nothing
 * is filled yet (don't yell at a fresh form); kicks in once the user
 * engages with either field and the state is incomplete or invalid.
 */
const errorMessage = computed<string | null>(() => {
  const someEntry = !!props.startDate || !!props.endDate;
  if (!someEntry) return null;
  if (!bothSet.value) return t('travel.dates.errorMissing');
  if (endBeforeStart.value) return t('travel.dates.errorEndBeforeStart');
  return null;
});

const isValid = computed(() => bothValid.value && !endBeforeStart.value);

watch(isValid, (v) => emit('update:isValid', v), { immediate: true });
watch(errorMessage, (m) => emit('update:errorMessage', m), { immediate: true });

const summary = computed(() => {
  if (!isValid.value) return '';
  const days = tripDurationDays(props.startDate, props.endDate);
  const label = days === 1 ? t('travel.dates.dayLabelSingular') : t('travel.dates.dayLabelPlural');
  return `${props.startDate} → ${props.endDate} · ${days} ${label}`;
});

const chipsDisabled = computed(() => !props.startDate || !isValidISODate(props.startDate));

function onStartChange(v: string | number): void {
  emit('update:startDate', String(v));
}
function onEndChange(v: string | number): void {
  emit('update:endDate', String(v));
}

function offsetEndFromStart(days: number): void {
  if (chipsDisabled.value) return;
  try {
    const end = addDays(parseLocalDate(props.startDate), days);
    emit('update:endDate', toDateInputValue(end));
  } catch (err) {
    // Should be unreachable given `chipsDisabled` guard, but never fail silently.
    console.warn('[TripDatesInput] Failed to compute offset end date:', err);
  }
}

const QUICK_ADD_CHIPS = [
  { days: 3, labelKey: 'travel.dates.chip3days' },
  { days: 7, labelKey: 'travel.dates.chip1week' },
  { days: 14, labelKey: 'travel.dates.chip2weeks' },
] as const;

const chipClass = computed(() => [
  'font-outfit rounded-full border px-3 py-1 text-xs font-medium transition-colors',
  'focus:outline-none focus:ring-2 focus:ring-[var(--vacation-teal)]/40',
]);
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-3">
      <FormFieldGroup :label="t('travel.dates.startLabel')" required>
        <BaseInput
          type="date"
          :model-value="startDate"
          :aria-invalid="!!errorMessage"
          :aria-describedby="errorMessage ? errorId : undefined"
          @update:model-value="onStartChange"
        />
      </FormFieldGroup>
      <FormFieldGroup
        :label="t('travel.dates.endLabel')"
        required
        :error="!!errorMessage && (endBeforeStart || !!endDate)"
      >
        <BaseInput
          type="date"
          :model-value="endDate"
          :aria-invalid="!!errorMessage"
          :aria-describedby="errorMessage ? errorId : undefined"
          @update:model-value="onEndChange"
        />
      </FormFieldGroup>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span
        class="font-outfit text-xs font-medium tracking-[0.1em] text-gray-500 uppercase dark:text-gray-400"
      >
        {{ t('travel.dates.quickAdd') }}
      </span>
      <button
        v-for="chip in QUICK_ADD_CHIPS"
        :key="chip.days"
        type="button"
        :class="[
          ...chipClass,
          chipsDisabled
            ? 'cursor-not-allowed border-gray-200 text-gray-300 dark:border-slate-700 dark:text-slate-600'
            : 'border-[var(--vacation-teal)]/30 text-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-5)]',
        ]"
        :disabled="chipsDisabled"
        :aria-disabled="chipsDisabled"
        @click="offsetEndFromStart(chip.days)"
      >
        {{ t(chip.labelKey) }}
      </button>
    </div>

    <p
      v-if="errorMessage"
      :id="errorId"
      class="text-xs text-red-600 dark:text-red-400"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <p v-else-if="summary" class="font-outfit text-xs text-gray-500 dark:text-gray-400">
      {{ summary }}
    </p>
  </div>
</template>
