<script setup lang="ts">
// Review + confirm surface for AI-extracted travel segments (#30). NOT an editor — it shows
// the 1..N extracted segments as read-only summary rows and a trip-target section reflecting
// the already-decided `target` (attach / choose / create). Field corrections happen AFTER save
// via the existing segment edit drawers. On save it emits the resolved target + trip name; the
// page owns persistence + document attachment.

import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import ExtractedSegmentRow from './ExtractedSegmentRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useVacationStore } from '@/stores/vacationStore';
import type { TravelReady } from '@/composables/useDocumentToTravel';
import type {
  VacationAccommodation,
  VacationTransportation,
  VacationTravelSegment,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  ready: TravelReady | null;
}>();

const emit = defineEmits<{
  close: [];
  /** Resolved target + the (possibly edited) new-trip name. */
  submit: [
    payload: {
      target: { kind: 'create' } | { kind: 'attach'; vacationId: string };
      tripName: string;
    },
  ];
}>();

const { t } = useTranslation();
const vacationStore = useVacationStore();

const tripName = ref('');
const chosenVacationId = ref<string>('');

// Reset local state whenever a fresh extraction opens the modal.
watch(
  () => props.ready,
  (ready) => {
    if (!ready) return;
    tripName.value = ready.suggestedTripName.trim() || t('travelExtract.defaultTripName');
    chosenVacationId.value =
      ready.target.kind === 'choose' ? (ready.target.candidates[0]?.id ?? '') : '';
  },
  { immediate: true }
);

const TRAVEL_EMOJI: Record<string, string> = {
  flight_outbound: '✈️',
  flight_return: '✈️',
  flight_other: '✈️',
  cruise: '🚢',
  train: '🚆',
  ferry: '⛴️',
  car: '🚗',
  activity: '🎟️',
};

interface ReviewRow {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  typeLabel: string;
}

function travelRow(s: VacationTravelSegment): ReviewRow {
  const date = s.departureDate || s.embarkationDate || s.sortDate || '';
  const route = [s.departureAirport || s.departureStation, s.arrivalAirport || s.arrivalStation]
    .filter(Boolean)
    .join(' → ');
  return {
    id: s.id,
    emoji: TRAVEL_EMOJI[s.type] ?? '✈️',
    title: s.title || route || t('travelExtract.kind.travel'),
    detail: [date, route && route !== s.title ? route : ''].filter(Boolean).join(' · '),
    typeLabel: t('travelExtract.kind.travel'),
  };
}
function accommodationRow(a: VacationAccommodation): ReviewRow {
  const dates = [a.checkInDate, a.checkOutDate].filter(Boolean).join(' → ');
  return {
    id: a.id,
    emoji: '🏨',
    title: a.title || a.name || t('travelExtract.kind.accommodation'),
    detail: dates,
    typeLabel: t('travelExtract.kind.accommodation'),
  };
}
function transportationRow(tr: VacationTransportation): ReviewRow {
  const dates = [tr.pickupDate || tr.departureDate, tr.returnDate].filter(Boolean).join(' → ');
  return {
    id: tr.id,
    emoji: '🚐',
    title: tr.title || tr.agencyName || t('travelExtract.kind.transportation'),
    detail: dates,
    typeLabel: t('travelExtract.kind.transportation'),
  };
}

const rows = computed<ReviewRow[]>(() => {
  if (!props.ready) return [];
  const { travelSegments, accommodations, transportation } = props.ready.buckets;
  return [
    ...travelSegments.map(travelRow),
    ...accommodations.map(accommodationRow),
    ...transportation.map(transportationRow),
  ];
});

const target = computed(() => props.ready?.target ?? { kind: 'create' as const });

/** Trip name shown for an attach/choose candidate id. */
function nameFor(vacationId: string): string {
  return vacationStore.getVacationById(vacationId)?.name ?? '';
}

const attachName = computed(() =>
  target.value.kind === 'attach' ? nameFor(target.value.vacationId) : ''
);

const saveLabel = computed(() =>
  target.value.kind === 'create' ? t('travelExtract.createTrip') : t('travelExtract.addToTrip')
);

const saveDisabled = computed(() => {
  if (rows.value.length === 0) return true;
  if (target.value.kind === 'create') return tripName.value.trim() === '';
  if (target.value.kind === 'choose') return chosenVacationId.value === '';
  return false;
});

function onSave(): void {
  const tgt = target.value;
  if (tgt.kind === 'attach') {
    emit('submit', { target: { kind: 'attach', vacationId: tgt.vacationId }, tripName: '' });
  } else if (tgt.kind === 'choose') {
    emit('submit', {
      target: { kind: 'attach', vacationId: chosenVacationId.value },
      tripName: '',
    });
  } else {
    emit('submit', { target: { kind: 'create' }, tripName: tripName.value.trim() });
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('travelExtract.reviewTitle')"
    icon="✈️"
    size="default"
    save-gradient="teal"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-4">
      <p class="font-inter text-xs text-gray-400">
        {{ t('travelExtract.reviewSubtitle') }}
      </p>

      <!-- Extracted segments -->
      <div class="space-y-2">
        <ExtractedSegmentRow
          v-for="row in rows"
          :key="row.id"
          :emoji="row.emoji"
          :title="row.title"
          :detail="row.detail"
          :type-label="row.typeLabel"
        />
      </div>

      <!-- Trip target -->
      <div class="rounded-2xl bg-[var(--tint-slate-3)] p-3">
        <div
          class="font-outfit mb-2 text-[0.625rem] font-bold tracking-[0.06em] text-gray-400 uppercase"
        >
          {{ t('travelExtract.tripLabel') }}
        </div>

        <!-- attach: single match -->
        <p
          v-if="target.kind === 'attach'"
          class="font-outfit text-sm font-semibold text-gray-900 dark:text-gray-100"
        >
          {{ t('travelExtract.addingTo') }} {{ attachName }}
        </p>

        <!-- choose: 2+ matches -->
        <div v-else-if="target.kind === 'choose'" class="space-y-1.5">
          <p class="font-inter mb-1 text-xs text-gray-400">{{ t('travelExtract.chooseTrip') }}</p>
          <label
            v-for="c in target.candidates"
            :key="c.id"
            class="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-white dark:hover:bg-slate-700"
          >
            <input v-model="chosenVacationId" type="radio" :value="c.id" class="accent-[#0077B6]" />
            <span class="font-outfit text-sm font-medium text-gray-900 dark:text-gray-100">{{
              c.name
            }}</span>
          </label>
        </div>

        <!-- create: editable name -->
        <div v-else>
          <p class="font-inter mb-1.5 text-xs text-gray-400">{{ t('travelExtract.newTrip') }}</p>
          <BaseInput v-model="tripName" :placeholder="t('travelExtract.tripNamePlaceholder')" />
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
