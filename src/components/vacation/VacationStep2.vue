<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { generateUUID } from '@/utils/id';
import { addHourToTime } from '@/utils/date';
import VacationSegmentCard from './VacationSegmentCard.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { BaseCombobox } from '@/components/ui';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import {
  buildAirlineOptions,
  buildAirportOptions,
  buildCruiseLineOptions,
  buildCruiseShipOptions,
  buildCruisePortOptions,
  prefillSegmentDates,
} from '@/utils/vacation';
import { buildTravelKeyValue } from '@/composables/useVacationTimeline';
import type {
  VacationTravelSegment,
  VacationTravelType,
  VacationTripType,
  VacationSegmentStatus,
} from '@/types/models';

interface Props {
  segments: VacationTravelSegment[];
  tripType: VacationTripType;
  tripStartDate?: string;
  tripEndDate?: string;
}

const props = withDefaults(defineProps<Props>(), {
  tripStartDate: '',
  tripEndDate: '',
});

const emit = defineEmits<{
  'update:segments': [value: VacationTravelSegment[]];
}>();

const { t } = useTranslation();

const collapsedMap = ref<Record<string, boolean>>({});
const showFlightTypeChoice = ref(false);

const segmentIcons: Record<VacationTravelType, string> = {
  flight_outbound: '✈️',
  flight_return: '🛬',
  flight_other: '✈️',
  cruise: '🚢',
  train: '🚅',
  ferry: '⛴️',
  car: '🚗',
  activity: '🎭',
};

const defaultTitles: Record<VacationTravelType, string> = {
  flight_outbound: 'flight',
  flight_return: 'flight',
  flight_other: 'flight',
  cruise: 'cruise',
  train: 'train',
  ferry: 'ferry',
  car: 'car',
  activity: '',
};

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
]);

const airlineOptions = computed(() => buildAirlineOptions());
const airportOptions = computed(() => buildAirportOptions());
const cruiseLineOptions = computed(() => buildCruiseLineOptions());
const cruisePortOptions = computed(() => buildCruisePortOptions());

const carTypeOptions = computed(() => [
  { value: 'family_car', label: t('vacation.carType.family_car') },
  { value: 'rental_car', label: t('vacation.carType.rental_car') },
  { value: 'other', label: t('vacation.carType.other') },
]);

/** Only show travel segments (not activities) on this step */
const sortedSegments = computed(() =>
  [...props.segments]
    .map((seg, idx) => ({ seg, idx }))
    .filter(({ seg }) => seg.type !== 'activity')
    .sort((a, b) => {
      if (!a.seg.sortDate && !b.seg.sortDate) return 0;
      if (!a.seg.sortDate) return 1;
      if (!b.seg.sortDate) return -1;
      return a.seg.sortDate.localeCompare(b.seg.sortDate);
    })
);

/** Show large selector cards when no travel segments exist yet */
const hasSegments = computed(() => sortedSegments.value.length > 0);

const segmentTypeCards: { type: VacationTravelType; emoji: string; key: string }[] = [
  { type: 'flight_outbound', emoji: '✈️', key: 'vacation.travel.flights' },
  { type: 'cruise', emoji: '🚢', key: 'vacation.segment.cruise' },
  { type: 'car', emoji: '🚗', key: 'vacation.travel.addCar' },
  { type: 'train', emoji: '🚅', key: 'vacation.segment.train' },
  { type: 'ferry', emoji: '⛴️', key: 'vacation.segment.ferry' },
];

function segmentIcon(type: VacationTravelType): string {
  return segmentIcons[type] || '✈️';
}

function buildKeyValue(seg: VacationTravelSegment): string {
  return buildTravelKeyValue(seg);
}

const cruiseShipOptions = buildCruiseShipOptions;

function isFlightType(type: VacationTravelType): boolean {
  return type === 'flight_outbound' || type === 'flight_return' || type === 'flight_other';
}

function isTrainOrFerry(type: VacationTravelType): boolean {
  return type === 'train' || type === 'ferry';
}

// Auto-select car for road_trip, cruise for cruise
watch(
  () => props.tripType,
  (tripType) => {
    if (props.segments.length > 0) return; // don't override existing segments
    if (tripType === 'road_trip') {
      addSegment('car');
    } else if (tripType === 'cruise') {
      addSegment('cruise');
    }
  },
  { immediate: true }
);

/** Wrap `prefillSegmentDates` with the current wizard trip window. */
function withPrefill<T extends VacationTravelSegment>(seg: T): T {
  if (!props.tripStartDate && !props.tripEndDate) return seg;
  return prefillSegmentDates(seg, props.tripStartDate || undefined, props.tripEndDate || undefined);
}

function addSegment(type: VacationTravelType) {
  // For flights, show the one-way/return choice first
  if (type === 'flight_outbound') {
    showFlightTypeChoice.value = true;
    return;
  }

  const id = generateUUID();
  const newSegment: VacationTravelSegment = withPrefill({
    id,
    type,
    title: defaultTitles[type],
    status: 'pending' as VacationSegmentStatus,
  });
  collapsedMap.value[id] = false;
  emit('update:segments', [...props.segments, newSegment]);
}

function addFlightSegments(returnFlight: boolean) {
  showFlightTypeChoice.value = false;
  const outId = generateUUID();
  const outbound: VacationTravelSegment = withPrefill({
    id: outId,
    type: 'flight_outbound',
    title: defaultTitles['flight_outbound'],
    status: 'pending' as VacationSegmentStatus,
  });
  collapsedMap.value[outId] = false;

  if (returnFlight) {
    const retId = generateUUID();
    const ret: VacationTravelSegment = withPrefill({
      id: retId,
      type: 'flight_return',
      title: defaultTitles['flight_return'],
      status: 'pending' as VacationSegmentStatus,
    });
    collapsedMap.value[retId] = false;
    emit('update:segments', [...props.segments, outbound, ret]);
  } else {
    emit('update:segments', [...props.segments, outbound]);
  }
}

function updateSegment(index: number, field: keyof VacationTravelSegment, value: string | boolean) {
  const updated = [...props.segments];
  const current = updated[index]!;
  updated[index] = { ...current, [field]: value };

  // When departureDate or embarkationDate changes, also set sortDate
  if (field === 'departureDate' || field === 'embarkationDate') {
    updated[index] = { ...updated[index]!, sortDate: String(value) };
  }

  // Compute arrivalDate from departureDate + arrivesNextDay
  if (field === 'departureDate' || field === 'arrivesNextDay') {
    const seg = updated[index]!;
    if (seg.departureDate) {
      if (seg.arrivesNextDay) {
        const d = new Date(seg.departureDate + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        updated[index] = { ...updated[index]!, arrivalDate: d.toISOString().slice(0, 10) };
      } else {
        updated[index] = { ...updated[index]!, arrivalDate: seg.departureDate };
      }
    }
  }

  if (field === 'departureTime' && !current.arrivalTime) {
    updated[index] = { ...updated[index]!, arrivalTime: addHourToTime(String(value)) };
  }
  if (field === 'embarkationDate') {
    if (!current.disembarkationDate || current.disembarkationDate === current.embarkationDate) {
      updated[index] = { ...updated[index]!, disembarkationDate: String(value) };
    }
  }

  // Auto-populate return flight from outbound flight data
  // Find the nearest return flight AFTER this outbound (they're created as adjacent pairs)
  if (current.type === 'flight_outbound') {
    let retIdx = -1;
    for (let i = index + 1; i < updated.length; i++) {
      if (updated[i]!.type === 'flight_return') {
        retIdx = i;
        break;
      }
      // Stop if we hit another outbound — the return for this outbound isn't after it
      if (updated[i]!.type === 'flight_outbound') break;
    }
    // Fallback: search before this outbound if no return found after
    if (retIdx < 0) {
      for (let i = index - 1; i >= 0; i--) {
        if (updated[i]!.type === 'flight_return') {
          retIdx = i;
          break;
        }
        if (updated[i]!.type === 'flight_outbound') break;
      }
    }
    if (retIdx >= 0) {
      const ret = updated[retIdx]!;
      const prevValue = current[field as keyof VacationTravelSegment] as string | undefined;

      if (field === 'arrivalAirport') {
        const prev = prevValue ?? '';
        if (!ret.departureAirport || ret.departureAirport === prev) {
          updated[retIdx] = { ...updated[retIdx]!, departureAirport: String(value) };
        }
      }
      if (field === 'departureAirport') {
        const prev = prevValue ?? '';
        if (!ret.arrivalAirport || ret.arrivalAirport === prev) {
          updated[retIdx] = { ...updated[retIdx]!, arrivalAirport: String(value) };
        }
      }
      if (field === 'bookingReference') {
        const prev = prevValue ?? '';
        if (!ret.bookingReference || ret.bookingReference === prev) {
          updated[retIdx] = { ...updated[retIdx]!, bookingReference: String(value) };
        }
      }
      if (field === 'airline') {
        const prev = prevValue ?? '';
        if (!ret.airline || ret.airline === prev) {
          updated[retIdx] = { ...updated[retIdx]!, airline: String(value) };
        }
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

      <!-- ═══ Flight fields — fieldset-grouped: Essentials (always) + Booking details ═══ -->
      <template v-if="isFlightType(seg.type)">
        <fieldset class="rounded-xl border border-[var(--vacation-teal)]/30 px-3 pt-1 pb-3">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--vacation-teal)] uppercase"
          >
            ✈️ {{ t('vacation.essentials') }}
          </legend>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
            <FormFieldGroup :label="t('form.date')" required>
              <BaseInput
                type="date"
                :model-value="seg.departureDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'departureDate', String($event))"
              />
            </FormFieldGroup>
            <BaseCombobox
              :model-value="seg.departureAirport ?? ''"
              :options="airportOptions"
              :label="t('vacation.field.departureAirport')"
              :placeholder="t('vacation.field.departureAirport')"
              :search-placeholder="t('vacation.field.departureAirport')"
              required
              other-value="__other__"
              :other-label="t('form.other' as any) || 'Other'"
              :other-placeholder="t('vacation.field.departureAirport')"
              @update:model-value="updateSegment(idx, 'departureAirport', String($event))"
            />
            <BaseCombobox
              :model-value="seg.arrivalAirport ?? ''"
              :options="airportOptions"
              :label="t('vacation.field.arrivalAirport')"
              :placeholder="t('vacation.field.arrivalAirport')"
              :search-placeholder="t('vacation.field.arrivalAirport')"
              required
              other-value="__other__"
              :other-label="t('form.other' as any) || 'Other'"
              :other-placeholder="t('vacation.field.arrivalAirport')"
              @update:model-value="updateSegment(idx, 'arrivalAirport', String($event))"
            />
          </div>
        </fieldset>

        <fieldset class="rounded-xl border border-gray-200 px-3 pt-1 pb-3 dark:border-slate-700">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-gray-400 uppercase dark:text-gray-500"
          >
            {{ t('vacation.bookingDetails') }}
          </legend>
          <div class="space-y-3">
            <div class="grid grid-cols-[1fr_auto] gap-3">
              <BaseCombobox
                :model-value="seg.airline ?? ''"
                :options="airlineOptions"
                :label="t('vacation.field.airline')"
                :placeholder="t('vacation.field.airline')"
                :search-placeholder="t('vacation.field.airline')"
                :required="seg.status === 'booked'"
                other-value="__other__"
                :other-label="t('form.other' as any) || 'Other'"
                :other-placeholder="t('vacation.field.airline')"
                @update:model-value="updateSegment(idx, 'airline', String($event))"
              />
              <FormFieldGroup
                :label="t('vacation.field.flightNumber')"
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  :model-value="seg.flightNumber ?? ''"
                  :placeholder="'e.g. 1842'"
                  class="vacation-teal-input !w-24"
                  @update:model-value="updateSegment(idx, 'flightNumber', String($event))"
                />
              </FormFieldGroup>
            </div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1.3fr_1fr]">
              <FormFieldGroup
                :label="t('vacation.field.departureTime')"
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  type="time"
                  :model-value="seg.departureTime ?? ''"
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'departureTime', String($event))"
                />
              </FormFieldGroup>
              <FormFieldGroup
                :label="t('vacation.field.arrivalTime')"
                :required="seg.status === 'booked'"
              >
                <div class="flex items-center gap-2">
                  <BaseInput
                    type="time"
                    :model-value="seg.arrivalTime ?? ''"
                    class="vacation-teal-input flex-1"
                    @update:model-value="updateSegment(idx, 'arrivalTime', String($event))"
                  />
                  <label class="flex shrink-0 items-center gap-1.5">
                    <input
                      type="checkbox"
                      :checked="seg.arrivesNextDay ?? false"
                      class="h-3.5 w-3.5 rounded border-gray-300 text-[var(--vacation-teal)] focus:ring-[var(--vacation-teal)]"
                      @change="
                        updateSegment(
                          idx,
                          'arrivesNextDay',
                          ($event.target as HTMLInputElement).checked
                        )
                      "
                    />
                    <span
                      class="font-outfit text-[10px] font-medium text-gray-500 dark:text-gray-400"
                    >
                      +1 day
                    </span>
                  </label>
                </div>
              </FormFieldGroup>
              <FormFieldGroup :label="t('vacation.field.bookingReference')">
                <BaseInput
                  :model-value="seg.bookingReference ?? ''"
                  :placeholder="t('vacation.field.bookingReference')"
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'bookingReference', String($event))"
                />
              </FormFieldGroup>
            </div>
          </div>
        </fieldset>
      </template>

      <!-- ═══ Cruise fields — fieldset-grouped: Essentials + Booking details ═══ -->
      <template v-else-if="seg.type === 'cruise'">
        <fieldset class="rounded-xl border border-[var(--vacation-teal)]/30 px-3 pt-1 pb-3">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--vacation-teal)] uppercase"
          >
            🚢 {{ t('vacation.essentials') }}
          </legend>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
            <FormFieldGroup :label="t('vacation.field.embarkationDate')" required>
              <BaseInput
                type="date"
                :model-value="seg.embarkationDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'embarkationDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.disembarkationDate')" required>
              <BaseInput
                type="date"
                :model-value="seg.disembarkationDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'disembarkationDate', String($event))"
              />
            </FormFieldGroup>
            <BaseCombobox
              :model-value="seg.departurePort ?? ''"
              :options="cruisePortOptions"
              :label="t('vacation.field.departurePort')"
              :placeholder="t('vacation.field.departurePort')"
              :search-placeholder="t('vacation.field.departurePort')"
              required
              other-value="__other__"
              :other-label="t('form.other' as any) || 'Other'"
              :other-placeholder="t('vacation.field.departurePort')"
              @update:model-value="updateSegment(idx, 'departurePort', String($event))"
            />
          </div>
        </fieldset>

        <fieldset class="rounded-xl border border-gray-200 px-3 pt-1 pb-3 dark:border-slate-700">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-gray-400 uppercase dark:text-gray-500"
          >
            {{ t('vacation.bookingDetails') }}
          </legend>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <BaseCombobox
                :model-value="seg.cruiseLine ?? ''"
                :options="cruiseLineOptions"
                :label="t('vacation.field.cruiseLine')"
                :placeholder="t('vacation.field.cruiseLine')"
                :search-placeholder="t('vacation.field.cruiseLine')"
                :required="seg.status === 'booked'"
                other-value="__other__"
                :other-label="t('form.other' as any) || 'Other'"
                :other-placeholder="t('vacation.field.cruiseLine')"
                @update:model-value="updateSegment(idx, 'cruiseLine', String($event))"
              />
              <BaseCombobox
                :model-value="seg.shipName ?? ''"
                :options="cruiseShipOptions(seg.cruiseLine)"
                :label="t('vacation.field.shipName')"
                :placeholder="t('vacation.field.shipName')"
                :search-placeholder="t('vacation.field.shipName')"
                :required="seg.status === 'booked'"
                other-value="__other__"
                :other-label="t('form.other' as any) || 'Other'"
                :other-placeholder="t('vacation.field.shipName')"
                @update:model-value="updateSegment(idx, 'shipName', String($event))"
              />
            </div>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <FormFieldGroup
                :label="t('vacation.field.embarkationTime')"
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  type="time"
                  :model-value="seg.embarkationTime ?? ''"
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'embarkationTime', String($event))"
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
              <FormFieldGroup :label="t('vacation.field.bookingReference')">
                <BaseInput
                  :model-value="seg.bookingReference ?? ''"
                  :placeholder="t('vacation.field.bookingReference')"
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'bookingReference', String($event))"
                />
              </FormFieldGroup>
            </div>
          </div>
        </fieldset>
      </template>

      <!-- ═══ Car fields — date first, then booking details ═══ -->
      <template v-else-if="seg.type === 'car'">
        <FormFieldGroup :label="t('vacation.field.departureDate')" required>
          <BaseInput
            type="date"
            :model-value="seg.departureDate ?? ''"
            class="vacation-teal-input"
            @update:model-value="updateSegment(idx, 'departureDate', String($event))"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.carType')" :required="seg.status === 'booked'">
          <TogglePillGroup
            :model-value="seg.carType ?? ''"
            :options="carTypeOptions"
            clearable
            @update:model-value="updateSegment(idx, 'carType', $event)"
          />
        </FormFieldGroup>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.leavingTime')">
            <BaseInput
              type="time"
              :model-value="seg.leavingTime ?? ''"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'leavingTime', String($event))"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.carLabel')">
            <BaseInput
              :model-value="seg.carLabel ?? ''"
              placeholder="e.g. Tesla Model Y"
              class="vacation-teal-input"
              @update:model-value="updateSegment(idx, 'carLabel', String($event))"
            />
          </FormFieldGroup>
        </div>
      </template>

      <!-- ═══ Train/Ferry fields — fieldset-grouped: Essentials + Booking details ═══ -->
      <template v-else-if="isTrainOrFerry(seg.type)">
        <fieldset class="rounded-xl border border-[var(--vacation-teal)]/30 px-3 pt-1 pb-3">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--vacation-teal)] uppercase"
          >
            {{ seg.type === 'train' ? '🚅' : '⛴️' }} {{ t('vacation.essentials') }}
          </legend>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
            <FormFieldGroup :label="t('vacation.field.departureDate')" required>
              <BaseInput
                type="date"
                :model-value="seg.departureDate ?? ''"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'departureDate', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.departureStation')" required>
              <BaseInput
                :model-value="seg.departureStation ?? ''"
                :placeholder="t('vacation.field.departureStation')"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'departureStation', String($event))"
              />
            </FormFieldGroup>
            <FormFieldGroup :label="t('vacation.field.arrivalStation')" required>
              <BaseInput
                :model-value="seg.arrivalStation ?? ''"
                :placeholder="t('vacation.field.arrivalStation')"
                class="vacation-teal-input"
                @update:model-value="updateSegment(idx, 'arrivalStation', String($event))"
              />
            </FormFieldGroup>
          </div>
        </fieldset>

        <fieldset class="rounded-xl border border-gray-200 px-3 pt-1 pb-3 dark:border-slate-700">
          <legend
            class="font-outfit px-2 text-[10px] font-semibold tracking-[0.14em] text-gray-400 uppercase dark:text-gray-500"
          >
            {{ t('vacation.bookingDetails') }}
          </legend>
          <div class="space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <FormFieldGroup
                :label="
                  seg.type === 'train'
                    ? t('vacation.field.trainCompany')
                    : t('vacation.field.operator')
                "
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  :model-value="seg.operator ?? ''"
                  :placeholder="
                    seg.type === 'train'
                      ? t('vacation.field.trainCompany')
                      : t('vacation.field.operator')
                  "
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'operator', String($event))"
                />
              </FormFieldGroup>
              <FormFieldGroup
                :label="
                  seg.type === 'train' ? t('vacation.field.trainNumber') : t('vacation.field.route')
                "
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  :model-value="seg.route ?? ''"
                  :placeholder="
                    seg.type === 'train'
                      ? t('vacation.field.trainNumber')
                      : t('vacation.field.route')
                  "
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'route', String($event))"
                />
              </FormFieldGroup>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <FormFieldGroup
                :label="t('vacation.field.departureTime')"
                :required="seg.status === 'booked'"
              >
                <BaseInput
                  type="time"
                  :model-value="seg.departureTime ?? ''"
                  class="vacation-teal-input"
                  @update:model-value="updateSegment(idx, 'departureTime', String($event))"
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
          </div>
        </fieldset>
      </template>

      <!-- Notes (all types) -->
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

  <!-- ═══ Initial selector — large cards (shown when no segments yet) ═══ -->
  <div v-if="!hasSegments && !showFlightTypeChoice" class="grid grid-cols-3 gap-2">
    <button
      v-for="card in segmentTypeCards"
      :key="card.type"
      type="button"
      class="relative flex flex-col items-center rounded-xl border border-transparent bg-white p-3 transition-all duration-150 hover:-translate-y-[1px] hover:border-[var(--vacation-teal-15)] dark:bg-slate-800"
      @click="addSegment(card.type)"
    >
      <span class="text-2xl">{{ card.emoji }}</span>
      <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-100">
        {{ t(card.key as any) }}
      </span>
    </button>
  </div>

  <!-- Flight type sub-choice (initial selector variant) -->
  <div v-else-if="!hasSegments && showFlightTypeChoice" class="space-y-3">
    <div class="grid grid-cols-2 gap-2">
      <button
        type="button"
        class="relative flex flex-col items-center rounded-xl border border-transparent bg-white p-4 transition-all duration-150 hover:-translate-y-[1px] hover:border-[var(--vacation-teal-15)] dark:bg-slate-800"
        @click="addFlightSegments(false)"
      >
        <span class="text-2xl">✈️</span>
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t('vacation.travel.oneWay') }}
        </span>
      </button>
      <button
        type="button"
        class="relative flex flex-col items-center rounded-xl border border-transparent bg-white p-4 transition-all duration-150 hover:-translate-y-[1px] hover:border-[var(--vacation-teal-15)] dark:bg-slate-800"
        @click="addFlightSegments(true)"
      >
        <span class="text-2xl">🔄</span>
        <span class="font-outfit text-xs font-semibold text-[var(--color-text)] dark:text-gray-100">
          {{ t('vacation.travel.return') }}
        </span>
      </button>
    </div>
    <button
      type="button"
      class="mx-auto block text-xs text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
      @click="showFlightTypeChoice = false"
    >
      ← {{ t('vacation.back') }}
    </button>
  </div>

  <!-- ═══ Add-more pills (shown after at least one segment exists) ═══ -->
  <div v-if="hasSegments" class="mt-4 flex flex-wrap gap-2">
    <template v-if="showFlightTypeChoice">
      <div
        class="flex items-center gap-1.5 rounded-xl border border-teal-300 bg-teal-50/60 px-2 py-1 dark:border-teal-600 dark:bg-teal-900/20"
      >
        <span class="text-xs text-teal-600 dark:text-teal-400">✈️</span>
        <button
          type="button"
          class="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-100 dark:bg-slate-700 dark:text-teal-300 dark:hover:bg-slate-600"
          @click="addFlightSegments(false)"
        >
          {{ t('vacation.travel.oneWay') }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-sm transition-colors hover:bg-teal-100 dark:bg-slate-700 dark:text-teal-300 dark:hover:bg-slate-600"
          @click="addFlightSegments(true)"
        >
          {{ t('vacation.travel.return') }}
        </button>
        <button
          type="button"
          class="ml-0.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          @click="showFlightTypeChoice = false"
        >
          ✕
        </button>
      </div>
    </template>
    <button
      v-else
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
      @click="addSegment('car')"
    >
      + 🚗 {{ t('vacation.travel.addCar') }}
    </button>
    <button
      type="button"
      class="rounded-xl border border-dashed border-[var(--tint-slate-10)] px-3 py-1.5 text-xs font-semibold text-teal-600 transition-colors hover:border-teal-400 dark:border-slate-600 dark:text-teal-400 dark:hover:border-teal-500"
      @click="addSegment('train')"
    >
      + 🚅 {{ t('vacation.segment.train') }}
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
