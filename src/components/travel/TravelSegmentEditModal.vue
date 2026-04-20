<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { BaseCombobox } from '@/components/ui';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import {
  useBookingValidation,
  type BookingValidationRules,
} from '@/composables/useBookingValidation';
import { useVacationStore } from '@/stores/vacationStore';
import { addHourToTime } from '@/utils/date';
import {
  buildAirlineOptions,
  buildAirportOptions,
  buildCruiseLineOptions,
  buildCruiseShipOptions,
  buildCruisePortOptions,
  buildTravelSegmentTitle,
} from '@/utils/vacation';
import type { VacationTravelSegment, VacationSegmentStatus } from '@/types/models';

type SegmentField =
  | 'airline'
  | 'flightNumber'
  | 'departureAirport'
  | 'arrivalAirport'
  | 'departureDate'
  | 'departureTime'
  | 'arrivalTime'
  | 'cruiseLine'
  | 'shipName'
  | 'departurePort'
  | 'embarkationDate'
  | 'embarkationTime'
  | 'disembarkationDate'
  | 'operator'
  | 'route'
  | 'departureStation'
  | 'arrivalStation'
  | 'carType'
  | 'title';

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
const activityCategory = ref('');
const description = ref('');
const location = ref('');
const link = ref('');
const startTime = ref('');
const activityDuration = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.segment,
  () => props.open,
  {
    onEdit(seg) {
      validation.reset();
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
      activityCategory.value = seg.activityCategory ?? '';
      description.value = seg.description ?? '';
      location.value = seg.location ?? '';
      link.value = seg.link ?? '';
      startTime.value = seg.startTime ?? '';
      activityDuration.value = seg.duration ?? '';
    },
    onNew() {
      validation.reset();
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
      activityCategory.value = '';
      description.value = '';
      location.value = '';
      link.value = '';
      startTime.value = '';
      activityDuration.value = '';
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
const isActivity = computed(() => props.segment?.type === 'activity');
const isTrainFerry = computed(
  () => props.segment?.type === 'train' || props.segment?.type === 'ferry'
);

const activityCategoryOptions = computed(() => [
  { value: 'show_musical', label: `🎭 ${t('vacation.activityCategory.show_musical')}` },
  { value: 'theme_park', label: `🎢 ${t('vacation.activityCategory.theme_park')}` },
  { value: 'sporting_event', label: `🏟️ ${t('vacation.activityCategory.sporting_event')}` },
  { value: 'concert', label: `🎵 ${t('vacation.activityCategory.concert')}` },
  { value: 'excursion', label: `🚤 ${t('vacation.activityCategory.excursion')}` },
  { value: 'other', label: `✨ ${t('vacation.activityCategory.other')}` },
]);

/** Auto-generated title based on current form fields (non-activity types) */
const autoTitle = computed(() =>
  buildTravelSegmentTitle({
    type: props.segment?.type,
    departureAirport: departureAirport.value,
    arrivalAirport: arrivalAirport.value,
    operator: operator.value,
    route: route.value,
    departureStation: departureStation.value,
    arrivalStation: arrivalStation.value,
    cruiseLine: cruiseLine.value,
    carType: carType.value,
    carLabel: carLabel.value,
    title: title.value,
    activityCategory: activityCategory.value,
  })
);

/** The title to save — auto-generated for non-activities, user-entered for activities */
const effectiveTitle = computed(() =>
  props.segment?.type === 'activity' ? title.value : autoTitle.value
);

/**
 * Rules for the shared useBookingValidation composable, switched by segment
 * type. `alwaysRequired` fields define the trip shape (must be filled even
 * when planning without bookings); `requiredWhenBooked` fields are booking
 * details that only bite when status flips to 'booked'.
 */
const rules = computed<BookingValidationRules<SegmentField>>(() => {
  if (isFlight.value) {
    return {
      alwaysRequired: {
        departureAirport: () => !!departureAirport.value,
        arrivalAirport: () => !!arrivalAirport.value,
        departureDate: () => !!departureDate.value,
      },
      requiredWhenBooked: {
        airline: () => !!airline.value,
        flightNumber: () => !!flightNumber.value,
        departureTime: () => !!departureTime.value,
        arrivalTime: () => !!arrivalTime.value,
      },
    };
  }
  if (isCruise.value) {
    return {
      alwaysRequired: {
        embarkationDate: () => !!embarkationDate.value,
        disembarkationDate: () => !!disembarkationDate.value,
      },
      requiredWhenBooked: {
        cruiseLine: () => !!cruiseLine.value,
        shipName: () => !!shipName.value,
        departurePort: () => !!departurePort.value,
        embarkationTime: () => !!embarkationTime.value,
      },
    };
  }
  if (isTrainFerry.value) {
    return {
      alwaysRequired: {
        departureStation: () => !!departureStation.value,
        arrivalStation: () => !!arrivalStation.value,
        departureDate: () => !!departureDate.value,
      },
      requiredWhenBooked: {
        operator: () => !!operator.value,
        route: () => !!route.value,
        departureTime: () => !!departureTime.value,
      },
    };
  }
  if (isCar.value) {
    return {
      alwaysRequired: {
        departureDate: () => !!departureDate.value,
      },
      requiredWhenBooked: {
        carType: () => !!carType.value,
      },
    };
  }
  if (isActivity.value) {
    return {
      alwaysRequired: {
        title: () => !!title.value.trim(),
      },
      requiredWhenBooked: {
        departureDate: () => !!departureDate.value,
      },
    };
  }
  return { alwaysRequired: {}, requiredWhenBooked: {} };
});

const validation = useBookingValidation<SegmentField>(status, rules);
const canSave = validation.canSave;

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
  await validation.attemptSave(async () => {
    isSubmitting.value = true;
    try {
      const vacation = vacationStore.getVacationById(props.vacationId);
      if (!vacation) return;
      const segments = [...vacation.travelSegments];
      const sortDate = departureDate.value || embarkationDate.value || '';
      segments[props.segmentIndex] = {
        ...segments[props.segmentIndex]!,
        title: effectiveTitle.value,
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
        activityCategory: activityCategory.value
          ? (activityCategory.value as import('@/types/models').VacationActivityCategory)
          : undefined,
        description: description.value || undefined,
        location: location.value || undefined,
        link: link.value || undefined,
        startTime: startTime.value || undefined,
        duration: activityDuration.value || undefined,
        sortDate,
      };
      // Auto-populate return flight from outbound flight data.
      // Find the nearest return flight after this outbound (they're created as adjacent pairs).
      const currentSeg = segments[props.segmentIndex]!;
      if (currentSeg.type === 'flight_outbound') {
        let retIdx = -1;
        for (let i = props.segmentIndex + 1; i < segments.length; i++) {
          if (segments[i]!.type === 'flight_return') {
            retIdx = i;
            break;
          }
          if (segments[i]!.type === 'flight_outbound') break;
        }
        if (retIdx < 0) {
          for (let i = props.segmentIndex - 1; i >= 0; i--) {
            if (segments[i]!.type === 'flight_return') {
              retIdx = i;
              break;
            }
            if (segments[i]!.type === 'flight_outbound') break;
          }
        }
        if (retIdx >= 0) {
          const ret = segments[retIdx]!;
          const prev = vacation.travelSegments[props.segmentIndex]!;
          if (!ret.departureAirport || ret.departureAirport === (prev.arrivalAirport ?? '')) {
            segments[retIdx] = { ...segments[retIdx]!, departureAirport: arrivalAirport.value };
          }
          if (!ret.arrivalAirport || ret.arrivalAirport === (prev.departureAirport ?? '')) {
            segments[retIdx] = { ...segments[retIdx]!, arrivalAirport: departureAirport.value };
          }
          if (!ret.airline || ret.airline === (prev.airline ?? '')) {
            segments[retIdx] = { ...segments[retIdx]!, airline: airline.value };
          }
          if (!ret.bookingReference || ret.bookingReference === (prev.bookingReference ?? '')) {
            segments[retIdx] = {
              ...segments[retIdx]!,
              bookingReference: bookingReference.value,
            };
          }
          // Regenerate return flight title with updated airports
          const retSeg = segments[retIdx]!;
          segments[retIdx] = {
            ...retSeg,
            title: buildTravelSegmentTitle({
              type: retSeg.type,
              departureAirport: retSeg.departureAirport,
              arrivalAirport: retSeg.arrivalAirport,
            }),
          };
        }
      }

      await vacationStore.updateVacation(props.vacationId, { travelSegments: segments });
      emit('close');
    } finally {
      isSubmitting.value = false;
    }
  });
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="isEditing ? t('travel.editSegment') : t('travel.editSegment')"
    icon="✈️"
    icon-bg="bg-[rgba(0,180,216,0.1)]"
    save-gradient="teal"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    @close="$emit('close')"
    @save="handleSave"
  >
    <div class="space-y-5">
      <!-- Status (top) -->
      <FormFieldGroup :label="t('vacation.field.status')">
        <TogglePillGroup
          :model-value="status"
          :options="statusOptions"
          @update:model-value="status = $event as VacationSegmentStatus"
        />
      </FormFieldGroup>

      <!-- Activity type (above title, only for activities) -->
      <FormFieldGroup v-if="isActivity" :label="t('vacation.field.activityCategory')">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="cat in activityCategoryOptions"
            :key="cat.value"
            type="button"
            class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
            :class="
              activityCategory === cat.value
                ? 'border-[var(--vacation-teal)] bg-[var(--vacation-teal-15)] text-[var(--vacation-teal)]'
                : 'border-gray-200 text-gray-500 dark:border-slate-600 dark:text-slate-400'
            "
            @click="activityCategory = cat.value"
          >
            {{ cat.label }}
          </button>
        </div>
      </FormFieldGroup>

      <!-- Title: editable for activities, auto-generated for others -->
      <FormFieldGroup
        v-if="isActivity"
        :label="t('vacation.field.title')"
        :required="validation.isRequired('title')"
        :error="validation.showError('title')"
      >
        <BaseInput v-model="title" />
      </FormFieldGroup>
      <div
        v-else
        class="font-outfit rounded-xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold text-gray-800 dark:bg-slate-700 dark:text-gray-200"
      >
        {{ autoTitle }}
      </div>

      <!-- ═══ Flight fields — compact layout ═══ -->
      <template v-if="isFlight">
        <div class="grid grid-cols-[1fr_auto] gap-3">
          <FormFieldGroup
            :label="t('vacation.field.airline')"
            :required="validation.isRequired('airline')"
            :error="validation.showError('airline')"
          >
            <BaseCombobox
              v-model="airline"
              :options="airlineOpts"
              :placeholder="t('vacation.field.airline')"
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.flightNumber')"
            :required="validation.isRequired('flightNumber')"
            :error="validation.showError('flightNumber')"
          >
            <BaseInput v-model="flightNumber" placeholder="e.g. 1842" class="!w-24" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.departureAirport')"
            :required="validation.isRequired('departureAirport')"
            :error="validation.showError('departureAirport')"
          >
            <BaseCombobox
              v-model="departureAirport"
              :options="airportOpts"
              :placeholder="t('vacation.field.departureAirport')"
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.arrivalAirport')"
            :required="validation.isRequired('arrivalAirport')"
            :error="validation.showError('arrivalAirport')"
          >
            <BaseCombobox
              v-model="arrivalAirport"
              :options="airportOpts"
              :placeholder="t('vacation.field.arrivalAirport')"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.3fr]">
          <FormFieldGroup
            :label="t('form.date')"
            :required="validation.isRequired('departureDate')"
            :error="validation.showError('departureDate')"
          >
            <BaseInput v-model="departureDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.departureTime')"
            :required="validation.isRequired('departureTime')"
            :error="validation.showError('departureTime')"
          >
            <BaseInput
              v-model="departureTime"
              type="time"
              @update:model-value="handleDepartureTimeChange"
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.arrivalTime')"
            :required="validation.isRequired('arrivalTime')"
            :error="validation.showError('arrivalTime')"
          >
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
          <FormFieldGroup
            :label="t('vacation.field.cruiseLine')"
            :required="validation.isRequired('cruiseLine')"
            :error="validation.showError('cruiseLine')"
          >
            <BaseCombobox
              v-model="cruiseLine"
              :options="cruiseLineOpts"
              :placeholder="t('vacation.field.cruiseLine')"
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.shipName')"
            :required="validation.isRequired('shipName')"
            :error="validation.showError('shipName')"
          >
            <BaseCombobox
              v-model="shipName"
              :options="buildCruiseShipOptions(cruiseLine)"
              :placeholder="t('vacation.field.shipName')"
            />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.departurePort')"
            :required="validation.isRequired('departurePort')"
            :error="validation.showError('departurePort')"
          >
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
          <FormFieldGroup
            :label="t('vacation.field.embarkationDate')"
            :required="validation.isRequired('embarkationDate')"
            :error="validation.showError('embarkationDate')"
          >
            <BaseInput v-model="embarkationDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.embarkationTime')"
            :required="validation.isRequired('embarkationTime')"
            :error="validation.showError('embarkationTime')"
          >
            <BaseInput v-model="embarkationTime" type="time" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.disembarkationDate')"
            :required="validation.isRequired('disembarkationDate')"
            :error="validation.showError('disembarkationDate')"
          >
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
        <FormFieldGroup
          :label="t('vacation.field.carType')"
          :required="validation.isRequired('carType')"
          :error="validation.showError('carType')"
        >
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
        <FormFieldGroup
          :label="t('vacation.field.departureDate')"
          :required="validation.isRequired('departureDate')"
          :error="validation.showError('departureDate')"
        >
          <BaseInput v-model="departureDate" type="date" />
        </FormFieldGroup>
      </template>

      <!-- ═══ Activity fields ═══ -->
      <template v-if="isActivity">
        <!-- Description -->
        <FormFieldGroup :label="t('vacation.field.description')">
          <textarea
            v-model="description"
            rows="2"
            class="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[var(--vacation-teal)] dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          />
        </FormFieldGroup>

        <!-- Date + Time + Duration -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormFieldGroup
            :label="t('form.date')"
            :required="validation.isRequired('departureDate')"
            :error="validation.showError('departureDate')"
          >
            <BaseInput v-model="departureDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.startTime')">
            <BaseInput v-model="startTime" type="time" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.duration')">
            <BaseInput v-model="activityDuration" placeholder="e.g. 2 hours" />
          </FormFieldGroup>
        </div>

        <!-- Location (own row, with maps link) -->
        <FormFieldGroup :label="t('vacation.field.location')">
          <div class="relative">
            <BaseInput v-model="location" />
            <a
              v-if="location"
              :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`"
              target="_blank"
              rel="noopener noreferrer"
              class="absolute top-1/2 right-2 -translate-y-1/2 text-sm opacity-40 transition-opacity hover:opacity-80"
              title="Open in Maps"
              @click.stop
            >
              📍
            </a>
          </div>
        </FormFieldGroup>

        <!-- Booking reference -->
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
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
            :required="validation.isRequired('operator')"
            :error="validation.showError('operator')"
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
            :required="validation.isRequired('route')"
            :error="validation.showError('route')"
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
          <FormFieldGroup
            :label="t('vacation.field.departureStation')"
            :required="validation.isRequired('departureStation')"
            :error="validation.showError('departureStation')"
          >
            <BaseInput
              v-model="departureStation"
              :placeholder="t('vacation.field.departureStation')"
            />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.arrivalStation')"
            :required="validation.isRequired('arrivalStation')"
            :error="validation.showError('arrivalStation')"
          >
            <BaseInput v-model="arrivalStation" :placeholder="t('vacation.field.arrivalStation')" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <FormFieldGroup
            :label="t('vacation.field.departureDate')"
            :required="validation.isRequired('departureDate')"
            :error="validation.showError('departureDate')"
          >
            <BaseInput v-model="departureDate" type="date" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.departureTime')"
            :required="validation.isRequired('departureTime')"
            :error="validation.showError('departureTime')"
          >
            <BaseInput v-model="departureTime" type="time" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.arrivalTime')">
            <BaseInput v-model="arrivalTime" type="time" />
          </FormFieldGroup>
        </div>
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
        </FormFieldGroup>
      </template>

      <!-- Link (common) -->
      <FormFieldGroup :label="t('vacation.field.link')">
        <div class="flex items-center gap-2">
          <BaseInput v-model="link" type="url" placeholder="https://..." class="flex-1" />
          <a
            v-if="link"
            :href="link.startsWith('http') ? link : `https://${link}`"
            target="_blank"
            rel="noopener noreferrer"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(0,180,216,0.08)] text-sm transition-colors hover:bg-[rgba(0,180,216,0.15)]"
            title="Visit link"
          >
            🔗
          </a>
        </div>
      </FormFieldGroup>

      <!-- Notes (common) -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseInput v-model="notes" :placeholder="t('vacation.field.notesPlaceholder')" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
