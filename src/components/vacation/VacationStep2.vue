<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { generateUUID } from '@/utils/id';
import { formatDateShort, addHourToTime } from '@/utils/date';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import type {
  VacationTravelSegment,
  VacationTravelType,
  VacationTripType,
  VacationSegmentStatus,
} from '@/types/models';

interface Props {
  segments: VacationTravelSegment[];
  tripType: VacationTripType;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:segments': [value: VacationTravelSegment[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});

const segmentIcons: Record<VacationTravelType, string> = {
  flight_outbound: '✈️',
  flight_return: '🛬',
  flight_other: '✈️',
  cruise: '🚢',
  train: '🚂',
  ferry: '⛴️',
};

const defaultTitles: Record<VacationTravelType, string> = {
  flight_outbound: 'outbound flight',
  flight_return: 'return flight',
  flight_other: 'flight',
  cruise: 'cruise',
  train: 'train',
  ferry: 'ferry',
};

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
  { value: 'not_booked', label: t('vacation.status.not_booked') },
  { value: 'researching', label: t('vacation.status.researching') },
]);

const sortedSegments = computed(() =>
  [...props.segments]
    .map((seg, idx) => ({ seg, idx }))
    .sort((a, b) => {
      if (!a.seg.sortDate && !b.seg.sortDate) return 0;
      if (!a.seg.sortDate) return 1;
      if (!b.seg.sortDate) return -1;
      return a.seg.sortDate.localeCompare(b.seg.sortDate);
    })
);

function segmentIcon(type: VacationTravelType): string {
  return segmentIcons[type] || '✈️';
}

function buildKeyValue(seg: VacationTravelSegment): string {
  const parts: string[] = [];
  if (seg.bookingReference) parts.push(seg.bookingReference);
  if (seg.sortDate) parts.push(formatDateShort(seg.sortDate).toLowerCase());
  return parts.join(' · ');
}

function isFlightType(type: VacationTravelType): boolean {
  return type === 'flight_outbound' || type === 'flight_return' || type === 'flight_other';
}

function isTrainOrFerry(type: VacationTravelType): boolean {
  return type === 'train' || type === 'ferry';
}

function addSegment(type: VacationTravelType) {
  // When adding a flight, create both outbound and return as separate entries
  if (type === 'flight_outbound') {
    const outId = generateUUID();
    const retId = generateUUID();
    const outbound: VacationTravelSegment = {
      id: outId,
      type: 'flight_outbound',
      title: defaultTitles['flight_outbound'],
      status: 'not_booked' as VacationSegmentStatus,
    };
    const ret: VacationTravelSegment = {
      id: retId,
      type: 'flight_return',
      title: defaultTitles['flight_return'],
      status: 'not_booked' as VacationSegmentStatus,
    };
    collapsedMap.value[outId] = false;
    collapsedMap.value[retId] = false;
    emit('update:segments', [...props.segments, outbound, ret]);
    return;
  }

  const id = generateUUID();
  const newSegment: VacationTravelSegment = {
    id,
    type,
    title: defaultTitles[type],
    status: 'not_booked' as VacationSegmentStatus,
  };
  collapsedMap.value[id] = false;
  emit('update:segments', [...props.segments, newSegment]);
}

function updateSegment(index: number, field: keyof VacationTravelSegment, value: string) {
  const updated = [...props.segments];
  const current = updated[index]!;
  updated[index] = { ...current, [field]: value };
  // When departureDate or embarkationDate changes, also set sortDate
  if (field === 'departureDate' || field === 'embarkationDate') {
    updated[index] = { ...updated[index]!, sortDate: value };
  }
  // Auto-populate arrival from departure when arrival is empty
  if (field === 'departureDate' && !current.arrivalDate) {
    updated[index] = { ...updated[index]!, arrivalDate: value };
  }
  if (field === 'departureTime' && !current.arrivalTime) {
    updated[index] = { ...updated[index]!, arrivalTime: addHourToTime(value) };
  }
  if (field === 'embarkationDate' && !current.disembarkationDate) {
    updated[index] = { ...updated[index]!, disembarkationDate: value };
  }

  // Auto-populate return flight from outbound flight data
  if (current.type === 'flight_outbound') {
    const retIdx = updated.findIndex((s) => s.type === 'flight_return');
    if (retIdx >= 0) {
      const ret = updated[retIdx]!;
      // Invert from/to: outbound arrival → return departure, outbound departure → return arrival
      if (field === 'arrivalAirport' && !ret.departureAirport) {
        updated[retIdx] = { ...ret, departureAirport: value };
      }
      if (field === 'departureAirport' && !ret.arrivalAirport) {
        updated[retIdx] = { ...updated[retIdx]!, arrivalAirport: value };
      }
      // Copy booking reference
      if (field === 'bookingReference' && !ret.bookingReference) {
        updated[retIdx] = { ...updated[retIdx]!, bookingReference: value };
      }
      // Copy airline
      if (field === 'airline' && !ret.airline) {
        updated[retIdx] = { ...updated[retIdx]!, airline: value };
      }
    }
  }

  emit('update:segments', updated);
}

function updateSegmentTitle(index: number, value: string) {
  updateSegment(index, 'title', value);
}

function updateSegmentStatus(index: number, value: string) {
  updateSegment(index, 'status', value as VacationSegmentStatus);
}

function removeSegment(index: number) {
  const updated = props.segments.filter((_, i) => i !== index);
  emit('update:segments', updated);
}
</script>

<template>
  <!-- Step header -->
  <div class="mb-5 text-center">
    <div class="text-3xl">✈️</div>
    <h2 class="font-outfit text-lg font-bold text-[var(--color-text)] dark:text-gray-100">
      {{ t('vacation.step2.title') }}
    </h2>
    <p class="text-xs text-[var(--color-text-muted)]">
      {{ t('vacation.step2.subtitle') }}
    </p>
  </div>

  <!-- Segments list -->
  <div class="space-y-3">
    <VacationSegmentCard
      v-for="{ seg, idx } in sortedSegments"
      :key="seg.id"
      :icon="segmentIcon(seg.type)"
      :title="seg.title"
      :status="seg.status"
      :key-value="buildKeyValue(seg)"
      :collapsed="collapsedMap[seg.id] ?? true"
      :deletable="true"
      @update:title="updateSegmentTitle(idx, $event)"
      @update:collapsed="collapsedMap[seg.id] = $event"
      @delete="removeSegment(idx)"
    >
      <!-- Status selector -->
      <div class="mb-3">
        <FormFieldGroup :label="t('vacation.field.status')">
          <TogglePillGroup
            :model-value="seg.status"
            :options="statusOptions"
            @update:model-value="updateSegmentStatus(idx, $event)"
          />
        </FormFieldGroup>
      </div>

      <!-- Flight fields (all flight types use the same standard fields) -->
      <template v-if="isFlightType(seg.type)">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.airline')" required>
            <BaseInput
              :model-value="seg.airline ?? ''"
              :placeholder="t('vacation.field.airline')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'airline', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.flightNumber')" required>
            <BaseInput
              :model-value="seg.flightNumber ?? ''"
              :placeholder="t('vacation.field.flightNumber')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'flightNumber', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureAirport')" required>
            <BaseInput
              :model-value="seg.departureAirport ?? ''"
              :placeholder="t('vacation.field.departureAirport')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureAirport', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalAirport')" required>
            <BaseInput
              :model-value="seg.arrivalAirport ?? ''"
              :placeholder="t('vacation.field.arrivalAirport')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'arrivalAirport', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureDate')">
            <BaseInput
              type="date"
              :model-value="seg.departureDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureDate', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.departureTime')">
            <BaseInput
              type="time"
              :model-value="seg.departureTime ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureTime', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.arrivalDate')">
            <BaseInput
              type="date"
              :model-value="seg.arrivalDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'arrivalDate', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalTime')">
            <BaseInput
              type="time"
              :model-value="seg.arrivalTime ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'arrivalTime', String($event))"
            />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            :model-value="seg.bookingReference ?? ''"
            :placeholder="t('vacation.field.bookingReference')"
            class="vacation-teal-input"
            @update:model-value="updateSegment(idx, 'bookingReference', String($event))"
          />
        </FormFieldGroup>
      </template>

      <!-- Cruise fields -->
      <template v-else-if="seg.type === 'cruise'">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.cruiseLine')">
            <BaseInput
              :model-value="seg.cruiseLine ?? ''"
              :placeholder="t('vacation.field.cruiseLine')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'cruiseLine', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.shipName')">
            <BaseInput
              :model-value="seg.shipName ?? ''"
              :placeholder="t('vacation.field.shipName')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'shipName', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departurePort')">
            <BaseInput
              :model-value="seg.departurePort ?? ''"
              :placeholder="t('vacation.field.departurePort')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departurePort', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.cabinNumber')">
            <BaseInput
              :model-value="seg.cabinNumber ?? ''"
              :placeholder="t('vacation.field.cabinNumber')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'cabinNumber', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.embarkationDate')">
            <BaseInput
              type="date"
              :model-value="seg.embarkationDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'embarkationDate', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.disembarkationDate')">
            <BaseInput
              type="date"
              :model-value="seg.disembarkationDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'disembarkationDate', String($event))"
            />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            :model-value="seg.bookingReference ?? ''"
            :placeholder="t('vacation.field.bookingReference')"
            class="vacation-teal-input"
            @update:model-value="updateSegment(idx, 'bookingReference', String($event))"
          />
        </FormFieldGroup>
      </template>

      <!-- Train/Ferry fields -->
      <template v-else-if="isTrainOrFerry(seg.type)">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.operator')">
            <BaseInput
              :model-value="seg.operator ?? ''"
              :placeholder="t('vacation.field.operator')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'operator', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.route')">
            <BaseInput
              :model-value="seg.route ?? ''"
              :placeholder="t('vacation.field.route')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'route', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureStation')">
            <BaseInput
              :model-value="seg.departureStation ?? ''"
              :placeholder="t('vacation.field.departureStation')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureStation', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalStation')">
            <BaseInput
              :model-value="seg.arrivalStation ?? ''"
              :placeholder="t('vacation.field.arrivalStation')"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'arrivalStation', String($event))"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureDate')">
            <BaseInput
              type="date"
              :model-value="seg.departureDate ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureDate', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.departureTime')">
            <BaseInput
              type="time"
              :model-value="seg.departureTime ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'departureTime', String($event))"
            />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            :model-value="seg.bookingReference ?? ''"
            :placeholder="t('vacation.field.bookingReference')"
            class="vacation-teal-input"
            @update:model-value="updateSegment(idx, 'bookingReference', String($event))"
          />
        </FormFieldGroup>
      </template>

      <!-- Notes -->
      <div class="mt-3">
        <FormFieldGroup :label="t('vacation.field.notes')">
          <textarea
            :value="seg.notes ?? ''"
            :placeholder="t('vacation.field.notesPlaceholder')"
            rows="2"
            class="w-full rounded-xl border border-[var(--tint-slate-10)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-gray-400 focus:border-[var(--vacation-teal)] focus:ring-2 focus:ring-[var(--vacation-teal-tint)] focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            @input="updateSegment(idx, 'notes', ($event.target as HTMLTextAreaElement).value)"
          />
        </FormFieldGroup>
      </div>
    </VacationSegmentCard>
  </div>

  <!-- Add segment pills -->
  <div class="mt-4 flex flex-wrap gap-2">
    <button
      type="button"
      class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
      @click="addSegment('flight_outbound')"
    >
      + ✈️ {{ t('vacation.travel.flights') }}
    </button>
    <button
      type="button"
      class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
      @click="addSegment('cruise')"
    >
      + 🚢 {{ t('vacation.segment.cruise') }}
    </button>
    <button
      type="button"
      class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
      @click="addSegment('train')"
    >
      + 🚂 {{ t('vacation.segment.train') }}
    </button>
    <button
      type="button"
      class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
      @click="addSegment('ferry')"
    >
      + ⛴️ {{ t('vacation.segment.ferry') }}
    </button>
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
