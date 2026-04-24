<script setup lang="ts">
import { ref, computed } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import TogglePillGroup from '@/components/ui/TogglePillGroup.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import {
  useBookingValidation,
  type BookingValidationRules,
} from '@/composables/useBookingValidation';
import { useVacationStore } from '@/stores/vacationStore';
import { buildAccommodationTitle } from '@/utils/vacation';
import type { VacationAccommodation, VacationSegmentStatus } from '@/types/models';

type AccommodationField =
  | 'name'
  | 'address'
  | 'checkInDate'
  | 'checkOutDate'
  | 'confirmationNumber';

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
const link = ref('');
const notes = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.accommodation,
  () => props.open,
  {
    onEdit(acc) {
      validation.reset();
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
      link.value = acc.link ?? '';
      notes.value = acc.notes ?? '';
    },
    onNew() {
      validation.reset();
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
      link.value = '';
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

const autoTitle = computed(() =>
  buildAccommodationTitle({ type: props.accommodation?.type, name: name.value })
);

const isFamilyFriends = computed(() => props.accommodation?.type === 'family_friends');

/**
 * `name` is always required (a nameless accommodation has no useful
 * title). Check-in / check-out / address / confirmation number bite only
 * when status is 'booked'. `confirmationNumber` is skipped for the
 * family-friends type since those stays don't have booking codes.
 */
const rules = computed<BookingValidationRules<AccommodationField>>(() => ({
  alwaysRequired: {
    name: () => !!name.value.trim(),
  },
  requiredWhenBooked: {
    address: () => !!address.value,
    checkInDate: () => !!checkInDate.value,
    checkOutDate: () => !!checkOutDate.value,
    ...(isFamilyFriends.value ? {} : { confirmationNumber: () => !!confirmationNumber.value }),
  },
}));

const validation = useBookingValidation<AccommodationField>(status, rules);
const canSave = validation.canSave;

async function handleSave() {
  if (!props.vacationId || props.accommodationIndex < 0) return;
  await validation.attemptSave(async () => {
    isSubmitting.value = true;
    try {
      const vacation = vacationStore.getVacationById(props.vacationId);
      if (!vacation) return;
      const accommodations = [...vacation.accommodations];
      accommodations[props.accommodationIndex] = {
        ...accommodations[props.accommodationIndex]!,
        title: autoTitle.value,
        status: status.value,
        name: name.value,
        address: address.value,
        checkInDate: checkInDate.value,
        checkOutDate: checkOutDate.value,
        confirmationNumber: confirmationNumber.value,
        roomType: roomType.value,
        contactPhone: contactPhone.value,
        breakfastIncluded: breakfastIncluded.value,
        link: link.value || undefined,
        notes: notes.value,
      };
      await vacationStore.updateVacation(props.vacationId, { accommodations });
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
    :title="isEditing ? t('travel.editAccommodation') : t('travel.editAccommodation')"
    icon="🏨"
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

      <!-- Name (type-specific label) -->
      <FormFieldGroup
        :label="nameFieldLabel"
        :required="validation.isRequired('name')"
        :error="validation.showError('name')"
      >
        <BaseInput v-model="name" :placeholder="nameFieldLabel" />
      </FormFieldGroup>

      <!-- Address -->
      <FormFieldGroup
        :label="t('vacation.field.address')"
        :required="validation.isRequired('address')"
        :error="validation.showError('address')"
      >
        <BaseTextarea v-model="address" :placeholder="t('vacation.field.address')" :rows="2" />
      </FormFieldGroup>

      <!-- Check-in / Check-out dates -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup
          :label="t('vacation.field.checkIn')"
          :required="validation.isRequired('checkInDate')"
          :error="validation.showError('checkInDate')"
        >
          <BeanieDatePicker v-model="checkInDate" />
        </FormFieldGroup>
        <FormFieldGroup
          :label="t('vacation.field.checkOut')"
          :required="validation.isRequired('checkOutDate')"
          :error="validation.showError('checkOutDate')"
        >
          <BeanieDatePicker v-model="checkOutDate" />
        </FormFieldGroup>
      </div>

      <!-- Confirmation number (not applicable for friends/family) -->
      <FormFieldGroup
        v-if="!isFamilyFriends"
        :label="t('vacation.field.confirmationNumber')"
        :required="validation.isRequired('confirmationNumber')"
        :error="validation.showError('confirmationNumber')"
      >
        <BaseInput
          v-model="confirmationNumber"
          :placeholder="t('vacation.field.confirmationNumber')"
        />
      </FormFieldGroup>

      <!-- Contact phone + Link -->
      <div class="grid grid-cols-2 gap-3">
        <FormFieldGroup :label="t('vacation.field.contactPhone')">
          <BaseInput v-model="contactPhone" :placeholder="t('vacation.field.contactPhone')" />
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
