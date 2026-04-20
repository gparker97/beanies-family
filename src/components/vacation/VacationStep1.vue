<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';
import type { VacationTripType, VacationTripPurpose } from '@/types/models';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TripDatesInput from '@/components/ui/TripDatesInput.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';

interface Props {
  name: string;
  tripType: VacationTripType | '';
  tripPurpose: VacationTripPurpose;
  assigneeIds: string[];
  tripStartDate: string;
  tripEndDate: string;
  showErrors?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showErrors: false,
});

const emit = defineEmits<{
  'update:name': [value: string];
  'update:tripType': [value: VacationTripType];
  'update:tripPurpose': [value: VacationTripPurpose];
  'update:assigneeIds': [value: string[]];
  'update:tripStartDate': [value: string];
  'update:tripEndDate': [value: string];
  'update:tripDatesValid': [value: boolean];
}>();

const { t } = useTranslation();

const tripTypes: { value: VacationTripType; emoji: string; key: string }[] = [
  { value: 'fly_and_stay', emoji: '✈️', key: 'fly_and_stay' },
  { value: 'cruise', emoji: '🚢', key: 'cruise' },
  { value: 'road_trip', emoji: '🚗', key: 'road_trip' },
  { value: 'combo', emoji: '🎒', key: 'combo' },
  { value: 'camping', emoji: '🏕️', key: 'camping' },
  { value: 'adventure', emoji: '🏔️', key: 'adventure' },
];
</script>

<template>
  <!-- Step header -->
  <div class="mb-5 text-center">
    <div class="text-3xl">🗺️</div>
    <h2 class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
      {{ t('vacation.step1.title') }}
    </h2>
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('vacation.step1.subtitle') }}
    </p>
  </div>

  <div class="space-y-5">
    <!-- Vacation name -->
    <FormFieldGroup :label="t('vacation.field.vacationName')" :error="showErrors && !name">
      <BaseInput
        :model-value="name"
        :placeholder="t('vacation.field.vacationNamePlaceholder')"
        class="vacation-teal-input"
        @update:model-value="emit('update:name', String($event))"
      />
    </FormFieldGroup>

    <!-- Trip type grid -->
    <FormFieldGroup :label="t('vacation.field.tripType')" :error="showErrors && !tripType">
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="tt in tripTypes"
          :key="tt.value"
          type="button"
          class="relative flex flex-col items-center rounded-xl border p-3 transition-all duration-150"
          :class="
            tripType === tt.value
              ? 'border-2 border-[var(--vacation-teal)] bg-[var(--vacation-teal-tint)] dark:bg-[var(--vacation-teal-15)]'
              : 'border-transparent bg-white hover:-translate-y-[1px] hover:border-[var(--vacation-teal-15)] dark:bg-slate-800'
          "
          @click="emit('update:tripType', tt.value)"
        >
          <!-- Selected checkmark -->
          <span
            v-if="tripType === tt.value"
            class="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--vacation-teal)] text-[10px] text-white"
          >
            ✓
          </span>
          <span class="text-2xl">{{ tt.emoji }}</span>
          <span
            class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-100"
          >
            {{ t(`vacation.type.${tt.key}` as any) }}
          </span>
          <span class="text-[10px] text-[var(--color-text-muted)]">
            {{ t(`vacation.type.${tt.key}.desc` as any) }}
          </span>
        </button>
      </div>
    </FormFieldGroup>

    <!-- Trip purpose toggle — only shown for fly_and_stay -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-1"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div v-if="props.tripType === 'fly_and_stay'" class="flex items-center gap-2">
        <button
          v-for="purpose in ['vacation', 'business'] as const"
          :key="purpose"
          type="button"
          class="font-outfit inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all"
          :class="
            tripPurpose === purpose
              ? purpose === 'business'
                ? 'border-[var(--color-text)] bg-[var(--tint-slate-10)] text-[var(--color-text)] dark:border-gray-400 dark:bg-slate-700 dark:text-gray-200'
                : 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-tint)] text-[var(--vacation-teal)]'
              : 'border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
          "
          @click="emit('update:tripPurpose', purpose)"
        >
          {{ purpose === 'vacation' ? '🌴' : '💼' }}
          {{ t(`travel.purpose.${purpose}`) }}
        </button>
      </div>
    </Transition>

    <!-- Trip dates (required — wizard won't advance without them) -->
    <TripDatesInput
      :start-date="tripStartDate"
      :end-date="tripEndDate"
      @update:start-date="emit('update:tripStartDate', $event)"
      @update:end-date="emit('update:tripEndDate', $event)"
      @update:is-valid="emit('update:tripDatesValid', $event)"
    />

    <!-- Who's going -->
    <FormFieldGroup
      :label="t('vacation.field.whosGoing')"
      :error="showErrors && assigneeIds.length === 0"
    >
      <FamilyChipPicker
        :model-value="assigneeIds"
        mode="multi"
        @update:model-value="emit('update:assigneeIds', $event as string[])"
      />
    </FormFieldGroup>
  </div>
</template>

<style scoped>
.vacation-teal-input :deep(input) {
  --tw-ring-color: var(--vacation-teal);
}

.vacation-teal-input :deep(input:focus) {
  border-color: var(--vacation-teal);
  box-shadow: 0 0 0 3px var(--vacation-teal-tint);
}
</style>
