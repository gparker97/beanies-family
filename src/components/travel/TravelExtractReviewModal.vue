<script setup lang="ts">
// Review + confirm surface for AI-extracted travel segments (#30). NOT an editor — it shows
// the 1..N extracted segments as read-only summary rows and a trip-target chooser. The auto-logic
// (resolveTripTarget) only SUGGESTS a default (new vs existing); the user always decides — they
// can create a new trip (entering a name) or add to ANY current/upcoming trip (e.g. a one-way
// return flight whose dates fall outside the existing trip's range). Field corrections happen
// AFTER save via the segment edit drawers. On save it emits the chosen target + trip name; the
// page owns persistence + document attachment.

import { computed, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import ExtractedSegmentRow from './ExtractedSegmentRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { formatDateShort } from '@/utils/date';
import { matchTravellerIds, learnableAliases } from '@/utils/segmentTravellers';
import type { TravelReady } from '@/composables/useDocumentToTravel';
import type {
  VacationAccommodation,
  VacationTransportation,
  VacationTravelSegment,
} from '@/types/models';

const props = defineProps<{
  open: boolean;
  ready: TravelReady | null;
  /** True while the parent persists the trip + attaches the document — drives the save spinner. */
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  /** Chosen target + new-trip name + the confirmed traveller name→member map + aliases to learn. */
  submit: [
    payload: {
      target: { kind: 'create' } | { kind: 'attach'; vacationId: string };
      tripName: string;
      travellerMap: Record<string, string>;
      aliasesToLearn: Array<{ memberId: string; alias: string }>;
    },
  ];
}>();

const { t } = useTranslation();
const vacationStore = useVacationStore();
const familyStore = useFamilyStore();

type TargetMode = 'new' | 'existing';

const mode = ref<TargetMode>('new');
const tripName = ref('');
const chosenVacationId = ref<string>('');

// Confirm-and-learn: the distinct (normalized) traveller names found across the document, each
// mapped to a family member. Pre-filled with the local matcher's best guess (the roster is NEVER
// sent to the model); the user corrects any. `autoMatches` snapshots that best guess at open so
// we learn exactly what the user changed.
const distinctNames = computed(() => props.ready?.distinctTravellerNames ?? []);
const nameToMemberId = ref<Record<string, string>>({});
const autoMatches = ref<Record<string, string>>({});

/** Current + upcoming trips (never past) the user can add these segments to. */
/**
 * Trips this extraction can be attached to.
 *
 * Upcoming trips, PLUS the trip the resolver actually matched even when that trip is in the
 * past. Listing only upcoming ones meant a document matching a past trip had no option to
 * select: `hasTripsToJoin` could be false, the mode fell back to 'new', and the user got a
 * SECOND copy of a trip they already had — or, with other upcoming trips present, a select
 * whose bound value was not among its options.
 *
 * A past trip is an ordinary attach target: receipts, boarding passes and confirmations are
 * routinely filed after the fact.
 */
const tripOptions = computed(() => {
  const target = props.ready?.target;
  const matchedId =
    target?.kind === 'attach'
      ? target.vacationId
      : target?.kind === 'choose'
        ? target.candidates[0]?.id
        : undefined;

  const list = [...vacationStore.upcomingVacations];
  if (matchedId && !list.some((v) => v.id === matchedId)) {
    const matched = vacationStore.vacations.find((v) => v.id === matchedId);
    if (matched) list.unshift(matched);
  }

  return list.map((v) => ({
    value: v.id,
    label: v.startDate ? `${v.name} · ${formatDateShort(v.startDate)}` : v.name,
  }));
});
const hasTripsToJoin = computed(() => tripOptions.value.length > 0);

// Seed local state from the auto-determined target whenever a fresh extraction opens the modal —
// then let the user freely override the choice.
watch(
  () => props.ready,
  (ready) => {
    if (!ready) return;
    tripName.value = ready.suggestedTripName.trim() || t('travelExtract.defaultTripName');
    const tgt = ready.target;
    // Default the existing-trip selection to whatever the auto-logic matched (the single attach
    // trip, or the best of the overlapping candidates), else the first upcoming trip.
    chosenVacationId.value =
      tgt.kind === 'attach'
        ? tgt.vacationId
        : tgt.kind === 'choose'
          ? (tgt.candidates[0]?.id ?? '')
          : (vacationStore.upcomingVacations[0]?.id ?? '');
    // Honour the suggestion, but only land on 'existing' when there's actually a trip to join.
    mode.value = tgt.kind !== 'create' && hasTripsToJoin.value ? 'existing' : 'new';
    // Pre-fill the traveller mapping with the local matcher's confident guesses.
    const auto: Record<string, string> = {};
    for (const name of ready.distinctTravellerNames) {
      auto[name] = matchTravellerIds([name], familyStore.sortedHumans)[0] ?? '';
    }
    autoMatches.value = auto;
    nameToMemberId.value = { ...auto };
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

const isNewTrip = computed(() => mode.value === 'new');

const saveLabel = computed(() =>
  isNewTrip.value ? t('travelExtract.createTrip') : t('travelExtract.addToTrip')
);

const saveDisabled = computed(() => {
  if (rows.value.length === 0) return true;
  return isNewTrip.value ? tripName.value.trim() === '' : chosenVacationId.value === '';
});

function onSave(): void {
  const travellerMap = { ...nameToMemberId.value };
  const aliasesToLearn = learnableAliases(
    nameToMemberId.value,
    autoMatches.value,
    familyStore.sortedHumans
  );
  const target =
    !isNewTrip.value && chosenVacationId.value
      ? ({ kind: 'attach', vacationId: chosenVacationId.value } as const)
      : ({ kind: 'create' } as const);
  emit('submit', {
    target,
    tripName: target.kind === 'create' ? tripName.value.trim() : '',
    travellerMap,
    aliasesToLearn,
  });
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
    :is-submitting="submitting"
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

      <!-- Who's travelling — map each name on the booking to a family member (learned for next time) -->
      <div
        v-if="distinctNames.length"
        class="rounded-2xl bg-[var(--tint-slate-3)] p-3.5 ring-1 ring-[var(--tint-slate-10)]"
      >
        <p class="font-inter mb-2.5 text-xs text-gray-400">
          {{ t('travelExtract.travellersHeading') }}
        </p>
        <div class="space-y-3">
          <div v-for="name in distinctNames" :key="name">
            <div class="mb-1.5 flex items-center gap-2">
              <span class="font-outfit dark:text-ink text-sm font-semibold text-gray-900">
                {{ name }}
              </span>
              <span
                v-if="!nameToMemberId[name]"
                class="font-inter text-xs text-[var(--vacation-teal)]"
              >
                {{ t('travelExtract.whoIsThis') }}
              </span>
            </div>
            <FamilyChipPicker
              :model-value="nameToMemberId[name] ?? ''"
              mode="single"
              compact
              @update:model-value="nameToMemberId[name] = $event as string"
            />
          </div>
        </div>
      </div>

      <!-- Trip target — the user chooses: a NEW trip, or add to an EXISTING one -->
      <div
        class="rounded-2xl p-3.5 ring-1"
        :class="
          isNewTrip
            ? 'bg-[var(--vacation-teal-5)] ring-[var(--vacation-teal-15)]'
            : 'bg-[var(--tint-slate-3)] ring-[var(--tint-slate-10)]'
        "
      >
        <p class="font-inter mb-2 text-xs text-gray-400">{{ t('travelExtract.targetHeading') }}</p>

        <!-- New vs Existing toggle -->
        <div class="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            class="font-outfit flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all"
            :class="
              isNewTrip
                ? 'bg-gradient-to-r from-[#00B4D8] to-[#0077B6] text-white shadow-sm'
                : 'dark:bg-surface-overlay dark:text-ink-soft bg-white text-gray-500 ring-1 ring-[var(--tint-slate-10)] hover:text-gray-700'
            "
            @click="mode = 'new'"
          >
            <span aria-hidden="true">✨</span>
            {{ t('travelExtract.newTripBadge') }}
          </button>
          <button
            type="button"
            :disabled="!hasTripsToJoin"
            class="font-outfit flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40"
            :class="
              !isNewTrip
                ? 'bg-gradient-to-r from-[#00B4D8] to-[#0077B6] text-white shadow-sm'
                : 'dark:bg-surface-overlay dark:text-ink-soft bg-white text-gray-500 ring-1 ring-[var(--tint-slate-10)] hover:text-gray-700'
            "
            @click="mode = 'existing'"
          >
            <span aria-hidden="true">🧳</span>
            {{ t('travelExtract.existingTripBadge') }}
          </button>
        </div>

        <!-- New trip: editable name -->
        <div v-if="isNewTrip">
          <label class="font-inter mb-1.5 block text-xs text-gray-400">
            {{ t('travelExtract.newTripNameLabel') }}
          </label>
          <BaseInput v-model="tripName" :placeholder="t('travelExtract.tripNamePlaceholder')" />
        </div>

        <!-- Existing trip: dropdown of current / upcoming trips -->
        <div v-else>
          <label class="font-inter mb-1.5 block text-xs text-gray-400">
            {{ t('travelExtract.addToTripLabel') }}
          </label>
          <BaseSelect
            v-model="chosenVacationId"
            :options="tripOptions"
            :placeholder="t('travelExtract.selectTripPlaceholder')"
          />
        </div>
      </div>
    </div>
  </BeanieFormModal>
</template>
