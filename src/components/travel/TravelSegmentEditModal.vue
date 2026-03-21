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
const status = ref<VacationSegmentStatus>('not_booked');
const airline = ref('');
const flightNumber = ref('');
const departureAirport = ref('');
const arrivalAirport = ref('');
const departureDate = ref('');
const departureTime = ref('');
const arrivalDate = ref('');
const arrivalTime = ref('');
const cruiseLine = ref('');
const shipName = ref('');
const departurePort = ref('');
const cabinNumber = ref('');
const embarkationDate = ref('');
const disembarkationDate = ref('');
const operator = ref('');
const route = ref('');
const departureStation = ref('');
const arrivalStation = ref('');
const bookingReference = ref('');
const notes = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.segment,
  () => props.open,
  {
    onEdit(seg) {
      title.value = seg.title ?? '';
      status.value = seg.status ?? 'not_booked';
      airline.value = seg.airline ?? '';
      flightNumber.value = seg.flightNumber ?? '';
      departureAirport.value = seg.departureAirport ?? '';
      arrivalAirport.value = seg.arrivalAirport ?? '';
      departureDate.value = seg.departureDate ?? '';
      departureTime.value = seg.departureTime ?? '';
      arrivalDate.value = seg.arrivalDate ?? '';
      arrivalTime.value = seg.arrivalTime ?? '';
      cruiseLine.value = seg.cruiseLine ?? '';
      shipName.value = seg.shipName ?? '';
      departurePort.value = seg.departurePort ?? '';
      cabinNumber.value = seg.cabinNumber ?? '';
      embarkationDate.value = seg.embarkationDate ?? '';
      disembarkationDate.value = seg.disembarkationDate ?? '';
      operator.value = seg.operator ?? '';
      route.value = seg.route ?? '';
      departureStation.value = seg.departureStation ?? '';
      arrivalStation.value = seg.arrivalStation ?? '';
      bookingReference.value = seg.bookingReference ?? '';
      notes.value = seg.notes ?? '';
    },
    onNew() {
      title.value = '';
      status.value = 'not_booked';
      airline.value = '';
      flightNumber.value = '';
      departureAirport.value = '';
      arrivalAirport.value = '';
      departureDate.value = '';
      departureTime.value = '';
      arrivalDate.value = '';
      arrivalTime.value = '';
      cruiseLine.value = '';
      shipName.value = '';
      departurePort.value = '';
      cabinNumber.value = '';
      embarkationDate.value = '';
      disembarkationDate.value = '';
      operator.value = '';
      route.value = '';
      departureStation.value = '';
      arrivalStation.value = '';
      bookingReference.value = '';
      notes.value = '';
    },
  }
);

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
  { value: 'not_booked', label: t('vacation.status.not_booked') },
  { value: 'researching', label: t('vacation.status.researching') },
]);

const airlineOpts = computed(() => buildAirlineOptions());
const airportOpts = computed(() => buildAirportOptions());
const cruiseLineOpts = computed(() => buildCruiseLineOptions());
const cruisePortOpts = computed(() => buildCruisePortOptions());

const isFlight = computed(() => props.segment?.type?.startsWith('flight'));
const isCruise = computed(() => props.segment?.type === 'cruise');
const isTrainFerry = computed(
  () => props.segment?.type === 'train' || props.segment?.type === 'ferry'
);

function handleDepartureDateChange(val: string | number) {
  const v = String(val);
  departureDate.value = v;
  if (!arrivalDate.value || arrivalDate.value === departureDate.value) {
    arrivalDate.value = v;
  }
}

function handleDepartureTimeChange(val: string | number) {
  const v = String(val);
  departureTime.value = v;
  if (!arrivalTime.value) {
    arrivalTime.value = addHourToTime(v);
  }
}

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
      arrivalDate: arrivalDate.value,
      arrivalTime: arrivalTime.value,
      cruiseLine: cruiseLine.value,
      shipName: shipName.value,
      departurePort: departurePort.value,
      cabinNumber: cabinNumber.value,
      embarkationDate: embarkationDate.value,
      disembarkationDate: disembarkationDate.value,
      operator: operator.value,
      route: route.value,
      departureStation: departureStation.value,
      arrivalStation: arrivalStation.value,
      bookingReference: bookingReference.value,
      notes: notes.value,
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

      <!-- Flight fields -->
      <template v-if="isFlight">
        <FormFieldGroup :label="t('vacation.field.airline')">
          <BaseCombobox
            v-model="airline"
            :options="airlineOpts"
            :placeholder="t('vacation.field.airline')"
          />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.flightNumber')">
          <BaseInput v-model="flightNumber" :placeholder="t('vacation.field.flightNumber')" />
        </FormFieldGroup>
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
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureDate')">
            <BaseInput
              v-model="departureDate"
              type="date"
              @update:model-value="handleDepartureDateChange"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.departureTime')">
            <BaseInput
              v-model="departureTime"
              type="time"
              @update:model-value="handleDepartureTimeChange"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.arrivalDate')">
            <BaseInput v-model="arrivalDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalTime')">
            <BaseInput v-model="arrivalTime" type="time" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- Cruise fields -->
      <template v-if="isCruise">
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
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.embarkationDate')">
            <BaseInput v-model="embarkationDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.disembarkationDate')">
            <BaseInput v-model="disembarkationDate" type="date" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- Train/Ferry fields -->
      <template v-if="isTrainFerry">
        <FormFieldGroup :label="t('vacation.field.operator')">
          <BaseInput v-model="operator" :placeholder="t('vacation.field.operator')" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.route')">
          <BaseInput v-model="route" :placeholder="t('vacation.field.route')" />
        </FormFieldGroup>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.departureAirport')">
            <BaseInput
              v-model="departureStation"
              :placeholder="t('vacation.field.departureAirport')"
            />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalAirport')">
            <BaseInput v-model="arrivalStation" :placeholder="t('vacation.field.arrivalAirport')" />
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
      </template>

      <!-- Common fields -->
      <FormFieldGroup :label="t('vacation.field.bookingReference')">
        <BaseInput v-model="bookingReference" :placeholder="t('vacation.field.bookingReference')" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseInput v-model="notes" :placeholder="t('vacation.field.notesPlaceholder')" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
