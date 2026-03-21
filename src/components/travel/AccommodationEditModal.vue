<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useVacationStore } from '@/stores/vacationStore';
import type { VacationAccommodation, VacationSegmentStatus } from '@/types/models';

interface Props {
  open: boolean;
  accommodation?: VacationAccommodation;
  vacationId: string;
  accommodationIndex: number;
}

const props = defineProps<Props>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const vacationStore = useVacationStore();

// Form fields
const title = ref('');
const status = ref<VacationSegmentStatus>('pending');
const name = ref('');
const address = ref('');
const checkInDate = ref('');
const checkOutDate = ref('');
const confirmationNumber = ref('');
const roomType = ref('');
const contactPhone = ref('');
const breakfastIncluded = ref(false);
const notes = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.accommodation,
  () => props.open,
  {
    onEdit(acc) {
      title.value = acc.title ?? '';
      status.value = acc.status ?? 'pending';
      name.value = acc.name ?? '';
      address.value = acc.address ?? '';
      checkInDate.value = acc.checkInDate ?? '';
      checkOutDate.value = acc.checkOutDate ?? '';
      confirmationNumber.value = acc.confirmationNumber ?? '';
      roomType.value = acc.roomType ?? '';
      contactPhone.value = acc.contactPhone ?? '';
      breakfastIncluded.value = acc.breakfastIncluded ?? false;
      notes.value = acc.notes ?? '';
    },
    onNew() {
      title.value = '';
      status.value = 'pending';
      name.value = '';
      address.value = '';
      checkInDate.value = '';
      checkOutDate.value = '';
      confirmationNumber.value = '';
      roomType.value = '';
      contactPhone.value = '';
      breakfastIncluded.value = false;
      notes.value = '';
    },
  }
);

const statusOptions = computed(() => [
  { value: 'booked', label: t('vacation.status.booked') },
  { value: 'pending', label: t('vacation.status.pending') },
]);

const nameFieldLabel = computed(() => {
  const type = props.accommodation?.type;
  if (type === 'hotel') return t('vacation.field.hotelName');
  if (type === 'airbnb') return t('vacation.field.propertyName');
  if (type === 'campground') return t('vacation.field.campgroundName');
  if (type === 'family_friends') return t('vacation.field.hostName');
  return t('vacation.field.hotelName');
});

async function handleSave() {
  if (!props.vacationId || props.accommodationIndex < 0) return;
  isSubmitting.value = true;
  try {
    const vacation = vacationStore.getVacationById(props.vacationId);
    if (!vacation) return;
    const accommodations = [...vacation.accommodations];
    accommodations[props.accommodationIndex] = {
      ...accommodations[props.accommodationIndex]!,
      title: title.value,
      status: status.value,
      name: name.value,
      address: address.value,
      checkInDate: checkInDate.value,
      checkOutDate: checkOutDate.value,
      confirmationNumber: confirmationNumber.value,
      roomType: roomType.value,
      contactPhone: contactPhone.value,
      breakfastIncluded: breakfastIncluded.value,
      notes: notes.value,
    };
    await vacationStore.updateVacation(props.vacationId, { accommodations });
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="isEditing ? t('travel.editAccommodation') : t('travel.editAccommodation')"
    icon="🏨"
    icon-bg="bg-[rgba(0,180,216,0.1)]"
    save-gradient="teal"
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

      <!-- Title -->
      <FormFieldGroup :label="t('vacation.field.title')" required>
        <BaseInput v-model="title" />
      </FormFieldGroup>

      <!-- Name (type-specific label) -->
      <FormFieldGroup :label="nameFieldLabel">
        <BaseInput v-model="name" :placeholder="nameFieldLabel" />
      </FormFieldGroup>

      <!-- Address -->
      <FormFieldGroup :label="t('vacation.field.address')">
        <BaseInput v-model="address" :placeholder="t('vacation.field.address')" />
      </FormFieldGroup>

      <!-- Check-in / Check-out dates -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.field.checkIn')">
          <BaseInput v-model="checkInDate" type="date" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('vacation.field.checkOut')">
          <BaseInput v-model="checkOutDate" type="date" />
        </FormFieldGroup>
      </div>

      <!-- Confirmation number -->
      <FormFieldGroup :label="t('vacation.field.confirmationNumber')">
        <BaseInput
          v-model="confirmationNumber"
          :placeholder="t('vacation.field.confirmationNumber')"
        />
      </FormFieldGroup>

      <!-- Contact phone -->
      <FormFieldGroup :label="t('vacation.field.contactPhone')">
        <BaseInput v-model="contactPhone" :placeholder="t('vacation.field.contactPhone')" />
      </FormFieldGroup>

      <!-- Notes -->
      <FormFieldGroup :label="t('vacation.field.notes')">
        <BaseInput v-model="notes" :placeholder="t('vacation.field.notesPlaceholder')" />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
