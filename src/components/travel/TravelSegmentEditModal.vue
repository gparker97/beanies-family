<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { BaseCombobox } from '@/components/ui';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useVacationStore } from '@/stores/vacationStore';
import { addHourToTime } from '@/utils/date';
import {
  buildAirlineOptions,
  buildAirportOptions,
  buildCruiseLineOptions,
  buildCruiseShipOptions,
  buildCruisePortOptions,
} from '@/utils/vacation';
import type { VacationTravelSegment, VacationSegmentStatus } from '@/types/models';

interface Props {
  open: boolean;
  segment?: VacationTravelSegment;
  vacationId: string;
  segmentIndex: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const vacationStore = useVacationStore();

// Form fields
const title = ref('');
const status = ref<VacationSegmentStatus>('pending');
const airline = ref('');
const flightNumber = ref('');
const departureAirport = ref('');
const arrivalAirport = ref('');
const departureDate = ref('');
const departureTime = ref('');
const arrivalTime = ref('');
const arrivesNextDay = ref(false);
const cruiseLine = ref('');
const shipName = ref('');
const departurePort = ref('');
const cabinNumber = ref('');
const embarkationDate = ref('');
const embarkationTime = ref('');
const disembarkationDate = ref('');
const operator = ref('');
const route = ref('');
const departureStation = ref('');
const arrivalStation = ref('');
const bookingReference = ref('');
const notes = ref('');
const carType = ref('');
const carLabel = ref('');
const leavingTime = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.segment,
  () => props.open,
  {
    onEdit(seg) {
      title.value = seg.title ?? '';
      status.value = seg.status ?? 'pending';
      airline.value = seg.airline ?? '';
      flightNumber.value = seg.flightNumber ?? '';
      departureAirport.value = seg.departureAirport ?? '';
      arrivalAirport.value = seg.arrivalAirport ?? '';
      departureDate.value = seg.departureDate ?? '';
      departureTime.value = seg.departureTime ?? '';
      arrivalTime.value = seg.arrivalTime ?? '';
      arrivesNextDay.value = seg.arrivesNextDay ?? false;
      cruiseLine.value = seg.cruiseLine ?? '';
      shipName.value = seg.shipName ?? '';
      departurePort.value = seg.departurePort ?? '';
      cabinNumber.value = seg.cabinNumber ?? '';
      embarkationDate.value = seg.embarkationDate ?? '';
      embarkationTime.value = seg.embarkationTime ?? '';
      disembarkationDate.value = seg.disembarkationDate ?? '';
      operator.value = seg.operator ?? '';
      route.value = seg.route ?? '';
      departureStation.value = seg.departureStation ?? '';
      arrivalStation.value = seg.arrivalStation ?? '';
      bookingReference.value = seg.bookingReference ?? '';
      notes.value = seg.notes ?? '';
      carType.value = seg.carType ?? '';
      carLabel.value = seg.carLabel ?? '';
      leavingTime.value = seg.leavingTime ?? '';
    },
    onNew() {
      title.value = '';
      status.value = 'pending';
      airline.value = '';
      flightNumber.value = '';
      departureAirport.value = '';
      arrivalAirport.value = '';
      departureDate.value = '';
      departureTime.value = '';
      arrivalTime.value = '';
      arrivesNextDay.value = false;
      cruiseLine.value = '';
      shipName.value = '';
      departurePort.value = '';
      cabinNumber.value = '';
      embarkationDate.value = '';
      embarkationTime.value = '';
      disembarkationDate.value = '';
      operator.value = '';
      route.value = '';
      departureStation.value = '';
      arrivalStation.value = '';
      bookingReference.value = '';
      notes.value = '';
      carType.value = '';
      carLabel.value = '';
      leavingTime.value = '';
    },
  }
);

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
]);

const airlineOpts = computed(() => buildAirlineOptions());
const airportOpts = computed(() => buildAirportOptions());
const cruiseLineOpts = computed(() => buildCruiseLineOptions());
const cruisePortOpts = computed(() => buildCruisePortOptions());

const carTypeOptions = computed(() => [
  { value: 'family_car', label: t('vacation.carType.family_car') },
  { value: 'rental_car', label: t('vacation.carType.rental_car') },
  { value: 'other', label: t('vacation.carType.other') },
]);

const isFlight = computed(() => props.segment?.type?.startsWith('flight'));
const isCruise = computed(() => props.segment?.type === 'cruise');
const isCar = computed(() => props.segment?.type === 'car');
const isTrainFerry = computed(
  () => props.segment?.type === 'train' || props.segment?.type === 'ferry'
);

function handleDepartureTimeChange(val: string | number) {
  const v = String(val);
  departureTime.value = v;
  if (!arrivalTime.value) {
    arrivalTime.value = addHourToTime(v);
  }
}

/** Compute arrivalDate from departureDate + arrivesNextDay */
const computedArrivalDate = computed(() => {
  if (!departureDate.value) return '';
  if (arrivesNextDay.value) {
    const d = new Date(departureDate.value + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return departureDate.value;
});

async function handleSave() {
  if (!props.vacationId || props.segmentIndex < 0) return;
  isSubmitting.value = true;
  try {
    const vacation = vacationStore.getVacationById(props.vacationId);
    if (!vacation) return;
    const segments = [...vacation.travelSegments];
    const sortDate = departureDate.value || embarkationDate.value || '';
    segments[props.segmentIndex] = {
      ...segments[props.segmentIndex]!,
      title: title.value,
      status: status.value,
      airline: airline.value,
      flightNumber: flightNumber.value,
      departureAirport: departureAirport.value,
      arrivalAirport: arrivalAirport.value,
      departureDate: departureDate.value,
      departureTime: departureTime.value,
      arrivalDate: computedArrivalDate.value,
      arrivalTime: arrivalTime.value,
      arrivesNextDay: arrivesNextDay.value,
      cruiseLine: cruiseLine.value,
      shipName: shipName.value,
      departurePort: departurePort.value,
      cabinNumber: cabinNumber.value,
      embarkationDate: embarkationDate.value,
      embarkationTime: embarkationTime.value,
      disembarkationDate: disembarkationDate.value,
      operator: operator.value,
      route: route.value,
      departureStation: departureStation.value,
      arrivalStation: arrivalStation.value,
      bookingReference: bookingReference.value,
      notes: notes.value,
      carType: (carType.value as 'family_car' | 'rental_car' | 'other') || undefined,
      carLabel: carLabel.value,
      leavingTime: leavingTime.value,
      sortDate,
    };
    await vacationStore.updateVacation(props.vacationId, { travelSegments: segments });
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="isEditing ? t('travel.editSegment') : t('travel.editSegment')"
    icon="✈️"
    icon-bg="bg-[rgba(0,180,216,0.1)]"
    save-gradient="teal"
    :is-submitting="isSubmitting"
    @close="$emit('close')"
    @save="handleSave"
  >
    <div class="space-y-5">
      <!-- Title -->
      <FormFieldGroup :label="t('vacation.field.title')">
        <BaseInput v-model="title" />
      </FormFieldGroup>

      <!-- Status -->
      <FormFieldGroup :label="t('vacation.field.status')">
        <TogglePillGroup
          :model-value="status"
          :options="statusOptions"
          @update:model-value="status = $event as VacationSegmentStatus"
        />
      </FormFieldGroup>

      <!-- ═══ Flight fields — compact layout ═══ -->
      <template v-if="isFlight">
        <div class="grid grid-cols-[1fr_auto] gap-3">
          <FormFieldGroup :label="t('vacation.field.airline')">
            <BaseCombobox
              v-model="airline"
              :options="airlineOpts"
              :placeholder="t('vacation.field.airline')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.flightNumber')">
            <BaseInput v-model="flightNumber" placeholder="e.g. 1842" class="!w-24" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureAirport')">
            <BaseCombobox
              v-model="departureAirport"
              :options="airportOpts"
              :placeholder="t('vacation.field.departureAirport')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalAirport')">
            <BaseCombobox
              v-model="arrivalAirport"
              :options="airportOpts"
              :placeholder="t('vacation.field.arrivalAirport')"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
          <FormFieldGroup :label="t('form.date')">
            <BaseInput v-model="departureDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.departureTime')">
            <BaseInput
              v-model="departureTime"
              type="time"
              @update:model-value="handleDepartureTimeChange"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalTime')">
            <div class="flex items-center gap-2">
              <BaseInput v-model="arrivalTime" type="time" class="flex-1" />
              <label class="flex shrink-0 items-center gap-1.5">
                <input
                  v-model="arrivesNextDay"
                  type="checkbox"
                  class="h-3.5 w-3.5 rounded border-gray-300 text-[#00B4D8] focus:ring-[#00B4D8]"
                />
                <span class="font-outfit text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  +1 day
                </span>
              </label>
            </div>
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
        </FormFieldGroup>
      </template>

      <!-- ═══ Cruise fields ═══ -->
      <template v-if="isCruise">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.cruiseLine')">
            <BaseCombobox
              v-model="cruiseLine"
              :options="cruiseLineOpts"
              :placeholder="t('vacation.field.cruiseLine')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.shipName')">
            <BaseCombobox
              v-model="shipName"
              :options="buildCruiseShipOptions(cruiseLine)"
              :placeholder="t('vacation.field.shipName')"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departurePort')">
            <BaseCombobox
              v-model="departurePort"
              :options="cruisePortOpts"
              :placeholder="t('vacation.field.departurePort')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.cabinNumber')">
            <BaseInput v-model="cabinNumber" :placeholder="t('vacation.field.cabinNumber')" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormFieldGroup :label="t('vacation.field.embarkationDate')">
            <BaseInput v-model="embarkationDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.embarkationTime')">
            <BaseInput v-model="embarkationTime" type="time" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.disembarkationDate')">
            <BaseInput v-model="disembarkationDate" type="date" />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
        </FormFieldGroup>
      </template>

      <!-- ═══ Car fields ═══ -->
      <template v-if="isCar">
        <FormFieldGroup :label="t('vacation.field.carType')">
          <TogglePillGroup
            :model-value="carType"
            :options="carTypeOptions"
            clearable
            @update:model-value="carType = $event"
          />
        </FormFieldGroup>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.leavingTime')">
            <BaseInput v-model="leavingTime" type="time" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.carLabel')">
            <BaseInput v-model="carLabel" placeholder="e.g. Tesla Model Y" />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.departureDate')">
          <BaseInput v-model="departureDate" type="date" />
        </FormFieldGroup>
      </template>

      <!-- ═══ Train/Ferry fields ═══ -->
      <template v-if="isTrainFerry">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="
              segment?.type === 'train'
                ? t('vacation.field.trainCompany')
                : t('vacation.field.operator')
            "
          >
            <BaseInput
              v-model="operator"
              :placeholder="
                segment?.type === 'train'
                  ? t('vacation.field.trainCompany')
                  : t('vacation.field.operator')
              "
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="
              segment?.type === 'train'
                ? t('vacation.field.trainNumber')
                : t('vacation.field.route')
            "
          >
            <BaseInput
              v-model="route"
              :placeholder="
                segment?.type === 'train'
                  ? t('vacation.field.trainNumber')
                  : t('vacation.field.route')
              "
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureStation')">
            <BaseInput
              v-model="departureStation"
              :placeholder="t('vacation.field.departureStation')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalStation')">
            <BaseInput v-model="arrivalStation" :placeholder="t('vacation.field.arrivalStation')" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureDate')">
            <BaseInput v-model="departureDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.departureTime')">
            <BaseInput v-model="departureTime" type="time" />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
        </FormFieldGroup>
      </template>

      <!-- Notes (common) -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseInput v-model="notes" :placeholder="t('vacation.field.notesPlaceholder')" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
