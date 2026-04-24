<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BeanieTimeInput from '@/components/ui/BeanieTimeInput.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import {
  useBookingValidation,
  type BookingValidationRules,
} from '@/composables/useBookingValidation';
import { useVacationStore } from '@/stores/vacationStore';
import { buildTransportationTitle } from '@/utils/vacation';
import type { VacationTransportation, VacationSegmentStatus } from '@/types/models';

type TransportationField =
  | 'agencyName'
  | 'pickupDate'
  | 'pickupTime'
  | 'returnDate'
  | 'departureDate'
  | 'departureTime';

interface Props {
  open: boolean;
  transportation?: VacationTransportation;
  vacationId: string;
  transportationIndex: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const vacationStore = useVacationStore();

// Form fields
const title = ref('');
const status = ref<VacationSegmentStatus>('pending');
const bookingReference = ref('');
const pickupDate = ref('');
const pickupTime = ref('');
const returnDate = ref('');
const returnTime = ref('');
const agencyName = ref('');
const agencyAddress = ref('');
const operator = ref('');
const route = ref('');
const departureStation = ref('');
const arrivalStation = ref('');
const departureDate = ref('');
const departureTime = ref('');
const link = ref('');
const notes = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.transportation,
  () => props.open,
  {
    onEdit(trans) {
      validation.reset();
      title.value = trans.title ?? '';
      status.value = trans.status ?? 'pending';
      bookingReference.value = trans.bookingReference ?? '';
      pickupDate.value = trans.pickupDate ?? '';
      pickupTime.value = trans.pickupTime ?? '';
      returnDate.value = trans.returnDate ?? '';
      returnTime.value = trans.returnTime ?? '';
      agencyName.value = trans.agencyName ?? '';
      agencyAddress.value = trans.agencyAddress ?? '';
      operator.value = trans.operator ?? '';
      route.value = trans.route ?? '';
      departureStation.value = trans.departureStation ?? '';
      arrivalStation.value = trans.arrivalStation ?? '';
      departureDate.value = trans.departureDate ?? '';
      departureTime.value = trans.departureTime ?? '';
      link.value = trans.link ?? '';
      notes.value = trans.notes ?? '';
    },
    onNew() {
      validation.reset();
      title.value = '';
      status.value = 'pending';
      bookingReference.value = '';
      pickupDate.value = '';
      pickupTime.value = '';
      returnDate.value = '';
      returnTime.value = '';
      agencyName.value = '';
      agencyAddress.value = '';
      operator.value = '';
      route.value = '';
      departureStation.value = '';
      arrivalStation.value = '';
      departureDate.value = '';
      departureTime.value = '';
      link.value = '';
      notes.value = '';
    },
  }
);

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
]);

const isBus = computed(() => props.transportation?.type === 'bus');
const isRentalCar = computed(() => props.transportation?.type === 'rental_car');
const isShuttleOrTaxi = computed(
  () =>
    props.transportation?.type === 'airport_shuttle' ||
    props.transportation?.type === 'taxi_rideshare'
);

const autoTitle = computed(() =>
  buildTransportationTitle({
    type: props.transportation?.type,
    agencyName: agencyName.value,
    operator: operator.value,
  })
);

/**
 * Transportation has no "always required" fields at the modal level —
 * the type is fixed when the entry is created, and everything else is
 * booking detail. Per-type rules switch on rental vs bus vs shuttle.
 */
const rules = computed<BookingValidationRules<TransportationField>>(() => {
  if (isRentalCar.value) {
    return {
      alwaysRequired: {},
      requiredWhenBooked: {
        agencyName: () => !!agencyName.value,
        pickupDate: () => !!pickupDate.value,
        returnDate: () => !!returnDate.value,
      },
    };
  }
  if (isBus.value) {
    return {
      alwaysRequired: {},
      requiredWhenBooked: {
        departureDate: () => !!departureDate.value,
        departureTime: () => !!departureTime.value,
      },
    };
  }
  if (isShuttleOrTaxi.value) {
    return {
      alwaysRequired: {},
      requiredWhenBooked: {
        pickupDate: () => !!pickupDate.value,
        pickupTime: () => !!pickupTime.value,
      },
    };
  }
  return { alwaysRequired: {}, requiredWhenBooked: {} };
});

const validation = useBookingValidation<TransportationField>(status, rules);
const canSave = validation.canSave;

async function handleSave() {
  if (!props.vacationId || props.transportationIndex < 0) return;
  await validation.attemptSave(async () => {
    isSubmitting.value = true;
    try {
      const vacation = vacationStore.getVacationById(props.vacationId);
      if (!vacation) return;
      const transportation = [...vacation.transportation];
      transportation[props.transportationIndex] = {
        ...transportation[props.transportationIndex]!,
        title: autoTitle.value,
        status: status.value,
        bookingReference: bookingReference.value,
        pickupDate: pickupDate.value,
        pickupTime: pickupTime.value,
        returnDate: returnDate.value,
        returnTime: returnTime.value,
        agencyName: agencyName.value,
        agencyAddress: agencyAddress.value,
        operator: operator.value,
        route: route.value,
        departureStation: departureStation.value,
        arrivalStation: arrivalStation.value,
        departureDate: departureDate.value,
        departureTime: departureTime.value,
        link: link.value || undefined,
        notes: notes.value,
      };
      await vacationStore.updateVacation(props.vacationId, { transportation });
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
    size="full"
    :open="open"
    :title="isEditing ? t('travel.editTransportation') : t('travel.editTransportation')"
    icon="🚗"
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

      <!-- Auto-generated title -->
      <div
        class="font-outfit rounded-xl bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm font-semibold text-gray-800 dark:bg-slate-700 dark:text-gray-200"
      >
        {{ autoTitle }}
      </div>

      <!-- Bus fields -->
      <template v-if="isBus">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.operator')">
            <BaseInput v-model="operator" :placeholder="t('vacation.field.operator')" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.route')">
            <BaseInput v-model="route" :placeholder="t('vacation.field.route')" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.departureDate')"
            :required="validation.isRequired('departureDate')"
            :error="validation.showError('departureDate')"
          >
            <BeanieDatePicker v-model="departureDate" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.departureTime')"
            :required="validation.isRequired('departureTime')"
            :error="validation.showError('departureTime')"
          >
            <BeanieTimeInput v-model="departureTime" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- Rental car fields -->
      <template v-if="isRentalCar">
        <FormFieldGroup
          :label="t('vacation.field.agencyName')"
          :required="validation.isRequired('agencyName')"
          :error="validation.showError('agencyName')"
        >
          <BaseInput v-model="agencyName" :placeholder="t('vacation.field.agencyName')" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.agencyAddress')">
          <BaseTextarea
            v-model="agencyAddress"
            :placeholder="t('vacation.field.agencyAddress')"
            :rows="2"
          />
        </FormFieldGroup>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.pickupDate')"
            :required="validation.isRequired('pickupDate')"
            :error="validation.showError('pickupDate')"
          >
            <BeanieDatePicker v-model="pickupDate" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.pickupTime')">
            <BeanieTimeInput v-model="pickupTime" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.returnDate')"
            :required="validation.isRequired('returnDate')"
            :error="validation.showError('returnDate')"
          >
            <BeanieDatePicker v-model="returnDate" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.returnTime')">
            <BeanieTimeInput v-model="returnTime" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- Shuttle / Taxi fields -->
      <template v-if="isShuttleOrTaxi">
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup
            :label="t('vacation.field.pickupDate')"
            :required="validation.isRequired('pickupDate')"
            :error="validation.showError('pickupDate')"
          >
            <BeanieDatePicker v-model="pickupDate" />
          </FormFieldGroup>
          <FormFieldGroup
            :label="t('vacation.field.pickupTime')"
            :required="validation.isRequired('pickupTime')"
            :error="validation.showError('pickupTime')"
          >
            <BeanieTimeInput v-model="pickupTime" />
          </FormFieldGroup>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <FormFieldGroup :label="t('vacation.field.returnDate')">
            <BeanieDatePicker v-model="returnDate" />
          </FormFieldGroup>
          <FormFieldGroup :label="t('vacation.field.returnTime')">
            <BeanieTimeInput v-model="returnTime" />
          </FormFieldGroup>
        </div>
      </template>

      <!-- Booking reference + Link -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.field.bookingReference')">
          <BaseInput
            v-model="bookingReference"
            :placeholder="t('vacation.field.bookingReference')"
          />
        </FormFieldGroup>
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
      </div>

      <!-- Notes -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseTextarea
          v-model="notes"
          :placeholder="t('vacation.field.notesPlaceholder')"
          :rows="3"
        />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
