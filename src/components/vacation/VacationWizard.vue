<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import VacationStep1 from './VacationStep1.vue';
import VacationStep2 from './VacationStep2.vue';
import VacationStep3 from './VacationStep3.vue';
import VacationStep4 from './VacationStep4.vue';
import VacationStep5 from './VacationStep5.vue';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort } from '@/utils/date';
import { bookingProgress, tripTypeEmoji, daysUntilTrip, tripCountdownKey } from '@/utils/vacation';
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
const tripPurpose = ref<import('@/types/models').VacationTripPurpose>('vacation');
const assigneeIds = ref<string[]>([]);
const travelSegments = ref<VacationTravelSegment[]>([]);
const accommodations = ref<VacationAccommodation[]>([]);
const transportation = ref<VacationTransportation[]>([]);
const ideas = ref<VacationIdea[]>([]);

// Celebration modal
const celebrationOpen = ref(false);
const savedVacation = ref<FamilyVacation | null>(null);

const celebrationEmoji = computed(() =>
  tripTypeEmoji(savedVacation.value?.tripType, savedVacation.value?.tripPurpose)
);
const celebrationDateRange = computed(() => {
  const v = savedVacation.value;
  if (!v?.startDate || !v?.endDate) return t('vacation.status.pending');
  return `${formatDateShort(v.startDate)} – ${formatDateShort(v.endDate)}`;
});
const celebrationCountdown = computed(() => {
  const v = savedVacation.value;
  if (!v?.startDate) return null;
  const days = daysUntilTrip(v.startDate);
  return days > 0 ? days : null;
});
const celebrationProgress = computed(() => {
  if (!savedVacation.value) return { booked: 0, total: 0 };
  return bookingProgress(savedVacation.value);
});
const celebrationTodoCount = computed(() => {
  const p = celebrationProgress.value;
  return p.total - p.booked;
});

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
      tripPurpose.value = props.vacation.tripPurpose ?? 'vacation';
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
      tripPurpose.value = 'vacation';
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

async function handleSave() {
  if (!canGoNext.value && currentStep.value === 1) {
    showErrors.value = true;
    return;
  }
  isSubmitting.value = true;

  try {
    let saved: FamilyVacation | null;

    if (isEditing.value && props.vacation) {
      saved = await vacationStore.updateVacation(props.vacation.id, {
        name: name.value.trim(),
        tripType: tripType.value,
        tripPurpose: tripType.value === 'fly_and_stay' ? tripPurpose.value : undefined,
        assigneeIds: [...assigneeIds.value],
        travelSegments: [...travelSegments.value],
        accommodations: [...accommodations.value],
        transportation: [...transportation.value],
        ideas: [...ideas.value],
      });
    } else {
      saved = await vacationStore.createVacation({
        name: name.value.trim(),
        tripType: tripType.value,
        tripPurpose: tripType.value === 'fly_and_stay' ? tripPurpose.value : undefined,
        assigneeIds: [...assigneeIds.value],
        travelSegments: [...travelSegments.value],
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
  savedVacation.value = vacation;
  celebrationOpen.value = true;
}

function handleCelebrationClose() {
  celebrationOpen.value = false;
  savedVacation.value = null;
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
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="✈️"
    icon-bg="var(--vacation-teal-tint)"
    size="wide"
    save-gradient="teal"
    :save-label="saveLabel"
    :save-disabled="false"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="currentStep < 5 ? goNext() : handleSave()"
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
          class="font-outfit from-primary-500 to-terracotta-400 hover:from-primary-600 hover:to-terracotta-500 rounded-2xl bg-gradient-to-r px-4 py-3 text-xs font-semibold text-white shadow-sm transition-all hover:shadow-md"
          @click="handleSave"
        >
          {{ t('action.saveAndClose') }}
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
      v-model:trip-purpose="tripPurpose"
      v-model:assignee-ids="assigneeIds"
      :show-errors="showErrors"
    />
    <VacationStep2
      v-if="currentStep === 2"
      v-model:segments="travelSegments"
      :trip-type="tripType"
    />
    <VacationStep3
      v-if="currentStep === 3"
      v-model:accommodations="accommodations"
      :travel-segments="travelSegments"
    />
    <VacationStep4 v-if="currentStep === 4" v-model:transportation="transportation" />
    <VacationStep5
      v-if="currentStep === 5"
      v-model:ideas="ideas"
      :current-member-id="currentMemberId"
    />
  </BeanieFormModal>

  <!-- Celebration modal -->
  <BaseModal :open="celebrationOpen" size="md" layer="overlay" :closable="false">
    <div class="cele-body relative text-center">
      <!-- Confetti -->
      <div class="confetti-container">
        <div class="confetti-piece" style="animation-delay: 0s; background: #00b4d8; left: 5%" />
        <div class="confetti-piece" style="animation-delay: 0.2s; background: #ffd93d; left: 15%" />
        <div class="confetti-piece" style="animation-delay: 0.4s; background: #f15d22; left: 28%" />
        <div class="confetti-piece" style="animation-delay: 0.1s; background: #27ae60; left: 40%" />
        <div class="confetti-piece" style="animation-delay: 0.5s; background: #00b4d8; left: 52%" />
        <div class="confetti-piece" style="animation-delay: 0.3s; background: #ffd93d; left: 65%" />
        <div class="confetti-piece" style="animation-delay: 0.6s; background: #f15d22; left: 75%" />
        <div
          class="confetti-piece"
          style="animation-delay: 0.15s; background: #27ae60; left: 85%"
        />
        <div
          class="confetti-piece"
          style="animation-delay: 0.45s; background: #00b4d8; border-radius: 50%; left: 92%"
        />
        <div
          class="confetti-piece"
          style="animation-delay: 0.7s; background: #ffd93d; border-radius: 50%; left: 48%"
        />
      </div>

      <!-- Trip emoji circle -->
      <div class="cele-img">{{ celebrationEmoji }}</div>

      <!-- Title & subtitle -->
      <div class="font-outfit mb-1 text-xl font-bold">{{ t('vacation.bonVoyage') }}</div>
      <div class="mb-4 text-sm text-[rgba(44,62,80,0.45)] dark:text-gray-400">
        {{ t('vacation.savedMessage') }}
      </div>

      <!-- Countdown pill -->
      <div v-if="celebrationCountdown" class="mb-4">
        <span class="cele-countdown">
          {{ celebrationEmoji }} {{ celebrationCountdown }}
          {{ t(tripCountdownKey(savedVacation?.tripType, savedVacation?.tripPurpose) as any) }}
        </span>
      </div>

      <!-- Details grid -->
      <div class="w-full rounded-[14px] bg-white p-3.5 text-left dark:bg-[var(--tint-slate-5)]">
        <div class="cele-row">
          <span class="cele-emoji">🚢</span>
          <span class="cele-lbl">{{ t('vacation.celebration.trip') }}</span>
          <span class="cele-val">{{ savedVacation?.name }}</span>
        </div>
        <div class="cele-row">
          <span class="cele-emoji">📅</span>
          <span class="cele-lbl">{{ t('vacation.celebration.when') }}</span>
          <span class="cele-val">{{ celebrationDateRange }}</span>
        </div>
        <div class="cele-row">
          <span class="cele-emoji">👨‍👩‍👧‍👦</span>
          <span class="cele-lbl">{{ t('vacation.celebration.who') }}</span>
          <span class="cele-val">
            {{ t('vacation.celebration.allBeans') }} ({{ savedVacation?.assigneeIds.length }}
            {{ t('vacation.celebration.going') }})
          </span>
        </div>
        <div class="cele-row">
          <span class="cele-emoji">✅</span>
          <span class="cele-lbl">{{ t('vacation.celebration.booked') }}</span>
          <span class="cele-val text-[#27ae60]">
            {{ celebrationProgress.booked }} of {{ celebrationProgress.total }} items
          </span>
        </div>
        <div v-if="celebrationTodoCount > 0" class="cele-row">
          <span class="cele-emoji">⏳</span>
          <span class="cele-lbl">{{ t('vacation.celebration.todo') }}</span>
          <span class="cele-val text-[#b8860b]">
            {{ celebrationTodoCount }} {{ t('vacation.celebration.itemsNeedBooking') }}
          </span>
        </div>
        <div class="cele-row border-b-0!">
          <span class="cele-emoji">💡</span>
          <span class="cele-lbl">{{ t('vacation.celebration.ideas') }}</span>
          <span class="cele-val">
            {{ savedVacation?.ideas.length ?? 0 }} {{ t('vacation.celebration.onBucketList') }}
          </span>
        </div>
      </div>
    </div>

    <!-- Footer with teal button -->
    <div class="flex justify-center px-6 pt-2 pb-6">
      <button
        type="button"
        class="font-outfit w-full max-w-[260px] cursor-pointer rounded-2xl border-none px-6 py-3 text-sm font-bold text-white shadow-md transition-all hover:opacity-90"
        style="background: linear-gradient(135deg, #00b4d8, #0096b7)"
        @click="handleCelebrationClose"
      >
        {{ t('vacation.celebration.letsGo') }} 🌴
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
/* Celebration body */
.cele-body {
  background: linear-gradient(180deg, white, var(--cloud-white));
  overflow: hidden;
  padding: 28px 24px 8px;
}

:is(.dark) .cele-body {
  background: linear-gradient(180deg, var(--tint-slate-5), transparent);
}

/* Trip emoji circle with bounce-in */
.cele-img {
  align-items: center;
  animation: cele-bounce 0.6s ease-out;
  background: linear-gradient(135deg, rgb(0 180 216 / 8%), rgb(255 217 61 / 8%));
  border-radius: 50%;
  display: flex;
  font-size: 56px;
  height: 120px;
  justify-content: center;
  margin: 0 auto 16px;
  width: 120px;
}

@keyframes cele-bounce {
  0% {
    opacity: 0;
    transform: scale(0.3) rotate(-15deg);
  }

  50% {
    transform: scale(1.15) rotate(5deg);
  }

  100% {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

/* Countdown pill */
.cele-countdown {
  align-items: center;
  background: linear-gradient(135deg, #00b4d8, #0096b7);
  border-radius: 12px;
  color: white;
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 14px;
  font-weight: 700;
  gap: 5px;
  padding: 6px 16px;
}

/* Detail rows */
.cele-row {
  align-items: center;
  border-bottom: 1px solid rgb(44 62 80 / 4%);
  display: flex;
  gap: 8px;
  padding: 6px 0;
}

:is(.dark) .cele-row {
  border-bottom-color: rgb(255 255 255 / 6%);
}

.cele-emoji {
  font-size: 14px;
  text-align: center;
  width: 22px;
}

.cele-lbl {
  color: rgb(44 62 80 / 35%);
  font-family: Outfit, sans-serif;
  font-size: 10px;
  font-weight: 600;
  min-width: 50px;
  text-transform: uppercase;
}

:is(.dark) .cele-lbl {
  color: rgb(255 255 255 / 35%);
}

.cele-val {
  flex: 1;
  font-family: Outfit, sans-serif;
  font-size: 12px;
  font-weight: 600;
}

/* Confetti */
.confetti-container {
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
}

.confetti-piece {
  animation: confetti-fall 2s ease-out forwards;
  border-radius: 2px;
  height: 8px;
  opacity: 0;
  position: absolute;
  top: -10px;
  width: 8px;
}

@keyframes confetti-fall {
  0% {
    opacity: 1;
    transform: translateY(-20px) rotate(0deg);
  }

  100% {
    opacity: 0;
    transform: translateY(300px) rotate(720deg);
  }
}
</style>
