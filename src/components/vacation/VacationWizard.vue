<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import VacationStep1 from './VacationStep1.vue';
import VacationStep2 from './VacationStep2.vue';
import VacationStep3 from './VacationStep3.vue';
import VacationStep4 from './VacationStep4.vue';
import VacationStep5 from './VacationStep5.vue';
import CreatedConfirmModal from '@/components/ui/CreatedConfirmModal.vue';
import type { ConfirmDetail } from '@/components/ui/CreatedConfirmModal.vue';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort } from '@/utils/date';
import { bookingProgress } from '@/utils/vacation';
import { generateUUID } from '@/utils/id';
import type {
  FamilyVacation,
  VacationTripType,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
  VacationIdea,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  vacation?: FamilyVacation | null;
  editStep?: number;
  defaultAssigneeIds?: string[];
  defaultDate?: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [vacation: FamilyVacation];
}>();

const { t } = useTranslation();
const vacationStore = useVacationStore();
const familyStore = useFamilyStore();

// Wizard state
const currentStep = ref(1);
const isSubmitting = ref(false);
const showErrors = ref(false);

// Form data
const name = ref('');
const tripType = ref<VacationTripType>('' as VacationTripType);
const assigneeIds = ref<string[]>([]);
const travelSegments = ref<VacationTravelSegment[]>([]);
const accommodations = ref<VacationAccommodation[]>([]);
const transportation = ref<VacationTransportation[]>([]);
const ideas = ref<VacationIdea[]>([]);

// Celebration modal
const celebration = ref<{
  open: boolean;
  title: string;
  message: string;
  details: ConfirmDetail[];
}>({ open: false, title: '', message: '', details: [] });

const isEditing = computed(() => !!props.vacation);
const currentMemberId = computed(
  () => familyStore.currentMember?.id ?? familyStore.owner?.id ?? ''
);

const modalTitle = computed(() =>
  isEditing.value ? t('vacation.wizardTitleEdit') : t('vacation.wizardTitle')
);

const canGoNext = computed(() => {
  if (currentStep.value === 1) {
    return name.value.trim() && tripType.value && assigneeIds.value.length > 0;
  }
  return true; // Steps 2-5 have no required fields
});

const steps = [
  { num: 1, icon: '✈️', label: 'vacation.step.trip' },
  { num: 2, icon: '🚀', label: 'vacation.step.travel' },
  { num: 3, icon: '🏨', label: 'vacation.step.stay' },
  { num: 4, icon: '🚕', label: 'vacation.step.gettingAround' },
  { num: 5, icon: '🌟', label: 'vacation.step.ideas' },
];

// Reset form when modal opens
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    showErrors.value = false;

    if (props.vacation) {
      // Edit mode — populate from existing
      name.value = props.vacation.name;
      tripType.value = props.vacation.tripType;
      assigneeIds.value = [...props.vacation.assigneeIds];
      travelSegments.value = JSON.parse(JSON.stringify(props.vacation.travelSegments));
      accommodations.value = JSON.parse(JSON.stringify(props.vacation.accommodations));
      transportation.value = JSON.parse(JSON.stringify(props.vacation.transportation));
      ideas.value = JSON.parse(JSON.stringify(props.vacation.ideas));
      currentStep.value = props.editStep ?? 1;
    } else {
      // New mode
      name.value = '';
      tripType.value = '' as VacationTripType;
      assigneeIds.value = props.defaultAssigneeIds ? [...props.defaultAssigneeIds] : [];
      travelSegments.value = [];
      accommodations.value = [];
      transportation.value = [];
      ideas.value = [];
      currentStep.value = 1;
    }
  }
);

function goNext() {
  if (!canGoNext.value) {
    showErrors.value = true;
    return;
  }
  showErrors.value = false;
  if (currentStep.value < 5) {
    currentStep.value++;
  }
}

function goBack() {
  if (currentStep.value > 1) {
    showErrors.value = false;
    currentStep.value--;
  }
}

function splitCombinedFlights(segments: VacationTravelSegment[]): VacationTravelSegment[] {
  const result: VacationTravelSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'flight_outbound' && seg.returnDepartureDate) {
      // Create outbound entry (strip return* fields)
      const {
        returnAirline: _ra,
        returnFlightNumber: _rfn,
        returnDepartureAirport: _rda,
        returnArrivalAirport: _raa,
        returnDepartureDate: _rdd,
        returnDepartureTime: _rdt,
        returnArrivalDate: _rad,
        returnArrivalTime: _rat,
        returnBookingReference: _rbr,
        ...outbound
      } = seg;
      result.push({
        ...outbound,
        title: t('vacation.travel.outboundFlight') as string,
      });
      // Create return entry
      result.push({
        id: generateUUID(),
        type: 'flight_return',
        title: t('vacation.travel.returnFlight') as string,
        status: seg.returnBookingReference ? 'booked' : seg.status,
        sortDate: seg.returnDepartureDate,
        airline: seg.returnAirline,
        flightNumber: seg.returnFlightNumber,
        departureAirport: seg.returnDepartureAirport,
        arrivalAirport: seg.returnArrivalAirport,
        departureDate: seg.returnDepartureDate,
        departureTime: seg.returnDepartureTime,
        arrivalDate: seg.returnArrivalDate,
        arrivalTime: seg.returnArrivalTime,
        bookingReference: seg.returnBookingReference,
      });
    } else {
      result.push(seg);
    }
  }
  return result;
}

async function handleSave() {
  if (!canGoNext.value && currentStep.value === 1) {
    showErrors.value = true;
    return;
  }
  isSubmitting.value = true;

  try {
    let saved: FamilyVacation | null;

    const processedSegments = splitCombinedFlights([...travelSegments.value]);

    if (isEditing.value && props.vacation) {
      saved = await vacationStore.updateVacation(props.vacation.id, {
        name: name.value.trim(),
        tripType: tripType.value,
        assigneeIds: [...assigneeIds.value],
        travelSegments: processedSegments,
        accommodations: [...accommodations.value],
        transportation: [...transportation.value],
        ideas: [...ideas.value],
      });
    } else {
      saved = await vacationStore.createVacation({
        name: name.value.trim(),
        tripType: tripType.value,
        assigneeIds: [...assigneeIds.value],
        travelSegments: processedSegments,
        accommodations: [...accommodations.value],
        transportation: [...transportation.value],
        ideas: [...ideas.value],
        createdBy: currentMemberId.value,
      });
    }

    if (saved) {
      emit('saved', saved);
      showCelebration(saved);
    }
  } finally {
    isSubmitting.value = false;
  }
}

function showCelebration(vacation: FamilyVacation) {
  const progress = bookingProgress(vacation);
  const dateRange =
    vacation.startDate && vacation.endDate
      ? `${formatDateShort(vacation.startDate)} – ${formatDateShort(vacation.endDate)}`
      : t('vacation.status.pending');

  const details: ConfirmDetail[] = [
    { label: t('vacation.celebration.trip'), value: vacation.name },
    { label: t('vacation.celebration.when'), value: dateRange },
    {
      label: t('vacation.celebration.who'),
      value: `${t('vacation.celebration.allBeans')} (${vacation.assigneeIds.length})`,
    },
  ];

  // Add first flight summary
  const firstFlight = vacation.travelSegments.find(
    (s) => s.type === 'flight_outbound' || s.type === 'flight_other'
  );
  if (firstFlight) {
    const flightParts: string[] = [];
    if (firstFlight.airline) flightParts.push(firstFlight.airline);
    if (firstFlight.flightNumber) flightParts.push(firstFlight.flightNumber);
    if (firstFlight.departureDate) flightParts.push(formatDateShort(firstFlight.departureDate));
    if (flightParts.length > 0) {
      details.push({ label: '✈️', value: flightParts.join(' · ') });
    }
  }

  // Add first accommodation summary
  const firstStay = vacation.accommodations[0];
  if (firstStay) {
    const stayParts: string[] = [];
    if (firstStay.name) stayParts.push(firstStay.name);
    if (firstStay.checkInDate && firstStay.checkOutDate) {
      stayParts.push(
        `${formatDateShort(firstStay.checkInDate)} – ${formatDateShort(firstStay.checkOutDate)}`
      );
    }
    if (stayParts.length > 0) {
      details.push({ label: '🏨', value: stayParts.join(' · ') });
    }
  }

  details.push(
    {
      label: t('vacation.celebration.booked'),
      value: `${progress.booked} / ${progress.total}`,
      highlight: true,
    },
    {
      label: t('vacation.celebration.ideas'),
      value: `${vacation.ideas.length}`,
    }
  );

  celebration.value = {
    open: true,
    title: t('vacation.bonVoyage'),
    message: t('vacation.savedMessage'),
    details,
  };
}

function handleCelebrationClose() {
  celebration.value.open = false;
  emit('close');
}

const saveLabel = computed(() => {
  if (currentStep.value < 5) {
    const nextStep = steps[currentStep.value];
    return `${t('vacation.next')}: ${t(nextStep!.label as any)} →`;
  }
  return `🎉 ${t('vacation.saveVacation')}`;
});
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="modalTitle"
    icon="✈️"
    icon-bg="var(--vacation-teal-tint)"
    size="wide"
    save-gradient="teal"
    :save-label="saveLabel"
    :save-disabled="false"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="currentStep < 5 ? goNext() : handleSave()"
    @delete="
      async () => {
        if (vacation) {
          await vacationStore.deleteVacation(vacation.id);
          emit('close');
        }
      }
    "
  >
    <template #footer-start>
      <div class="flex items-center gap-2">
        <button
          v-if="currentStep > 1"
          type="button"
          class="font-outfit rounded-2xl border border-[var(--tint-slate-10)] bg-transparent px-5 py-3 text-sm font-semibold text-[var(--color-text-muted)] transition-all hover:bg-[var(--tint-slate-5)] dark:border-slate-600 dark:text-gray-400"
          @click="goBack"
        >
          ← {{ t('vacation.back') }}
        </button>
        <button
          v-if="isEditing && currentStep < 5"
          type="button"
          class="font-outfit rounded-2xl px-4 py-3 text-xs font-semibold text-white"
          style="background: linear-gradient(135deg, #00b4d8, #0096b7)"
          @click="handleSave"
        >
          {{ t('action.save') }}
        </button>
      </div>
    </template>

    <!-- Wizard progress bar -->
    <div class="mb-4 flex items-center justify-center gap-0">
      <template v-for="(step, i) in steps" :key="step.num">
        <div
          class="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 transition-all"
          @click="step.num <= currentStep ? (currentStep = step.num) : undefined"
        >
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
            :class="
              step.num < currentStep
                ? 'bg-[var(--tint-success-10)] text-[#27AE60]'
                : step.num === currentStep
                  ? 'text-white shadow-md'
                  : 'bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] opacity-40'
            "
            :style="
              step.num === currentStep
                ? 'background: linear-gradient(135deg, var(--vacation-teal), #0077B6)'
                : ''
            "
          >
            <span v-if="step.num < currentStep">✓</span>
            <span v-else>{{ step.num }}</span>
          </div>
          <span
            class="font-outfit hidden text-[10px] font-semibold sm:inline"
            :class="
              step.num < currentStep
                ? 'text-[#27AE60]'
                : step.num === currentStep
                  ? 'text-[var(--vacation-teal)]'
                  : 'text-[var(--color-text-muted)] opacity-30'
            "
          >
            {{ t(step.label as any) }}
          </span>
        </div>
        <div
          v-if="i < steps.length - 1"
          class="mx-1 h-0.5 w-4 flex-shrink-0"
          :class="step.num < currentStep ? 'bg-[#27AE60] opacity-20' : 'bg-[var(--tint-slate-10)]'"
        />
      </template>
    </div>

    <!-- Step content -->
    <VacationStep1
      v-if="currentStep === 1"
      v-model:name="name"
      v-model:trip-type="tripType"
      v-model:assignee-ids="assigneeIds"
      :show-errors="showErrors"
    />
    <VacationStep2
      v-if="currentStep === 2"
      v-model:segments="travelSegments"
      :trip-type="tripType"
    />
    <VacationStep3 v-if="currentStep === 3" v-model:accommodations="accommodations" />
    <VacationStep4 v-if="currentStep === 4" v-model:transportation="transportation" />
    <VacationStep5
      v-if="currentStep === 5"
      v-model:ideas="ideas"
      :current-member-id="currentMemberId"
    />
  </BeanieFormModal>

  <!-- Celebration modal -->
  <CreatedConfirmModal
    :open="celebration.open"
    :title="celebration.title"
    :message="celebration.message"
    :details="celebration.details"
    @close="handleCelebrationClose"
  />
</template>
