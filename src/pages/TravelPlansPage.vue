<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/common/PageHeader.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import VacationSegmentCard from '@/components/vacation/VacationSegmentCard.vue';
import VacationIdeaCard from '@/components/vacation/VacationIdeaCard.vue';
import VacationWizard from '@/components/vacation/VacationWizard.vue';
import TravelSegmentEditModal from '@/components/travel/TravelSegmentEditModal.vue';
import AccommodationEditModal from '@/components/travel/AccommodationEditModal.vue';
import TransportationEditModal from '@/components/travel/TransportationEditModal.vue';
import IdeaEditModal from '@/components/travel/IdeaEditModal.vue';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import { confirm } from '@/composables/useConfirm';
import { useVacationTimeline } from '@/composables/useVacationTimeline';
import type { TimelineItem } from '@/composables/useVacationTimeline';
import { formatDateShort, formatNookDate } from '@/utils/date';
import {
  tripTypeEmoji,
  bookingProgress,
  daysUntilTrip,
  tripCountdownKey,
  computeAccommodationGaps,
  computeTimelineHints,
} from '@/utils/vacation';
import type { FamilyVacation, VacationIdea } from '@/types/models';

const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const vacationStore = useVacationStore();
const familyStore = useFamilyStore();
const { copied, copy } = useClipboard();

// ── State ────────────────────────────────────────────────────────────────────

const selectedVacationId = ref<string | null>(null);
const showPastTrips = ref(false);
const showVacationWizard = ref(false);
const editingVacation = ref<FamilyVacation | null>(null);
const editVacationStep = ref<number | undefined>(undefined);

// Add menu state (timeline bottom)
const showAddMenu = ref(false);

// Edit modal state
const editModalType = ref<'travel' | 'accommodation' | 'transportation' | null>(null);
const editingItemIndex = ref(-1);

// Collapsible segment cards
const collapsedCards = ref<Record<string, boolean>>({});

// Ideas state
const quickIdeaText = ref('');
const editingIdeaId = ref<string | null>(null);
const ideasPanelRef = ref<HTMLElement | null>(null);

function scrollToIdeas() {
  ideasPanelRef.value?.scrollIntoView({ behavior: 'smooth' });
}

// ── Query param: auto-select vacation from ?vacation=ID ──────────────────────

function handleVacationQueryParam() {
  const vacationId = route.query.vacation as string | undefined;
  if (vacationId) {
    selectedVacationId.value = vacationId;
    router.replace({ query: {} });
  }
}
watch(
  () => route.query.vacation,
  (val) => {
    if (val) handleVacationQueryParam();
  }
);
onMounted(handleVacationQueryParam);

// ── Computed ─────────────────────────────────────────────────────────────────

const selectedVacation = computed(() =>
  selectedVacationId.value ? vacationStore.getVacationById(selectedVacationId.value) : undefined
);

const { groupedByDate, accommodationGaps, undatedItems } = useVacationTimeline(selectedVacation);

/** Merged timeline: interleave date groups with gap warnings at correct positions */
type TimelineEntry =
  | { type: 'group'; data: (typeof groupedByDate)['value'][number] }
  | { type: 'gap'; date: string; label: string };

/** Split ideas into unplanned and planned */
const unplannedIdeas = computed(
  () => selectedVacation.value?.ideas.filter((i) => !i.isPlanned) ?? []
);
const plannedIdeas = computed(() => selectedVacation.value?.ideas.filter((i) => i.isPlanned) ?? []);

/** Hints keyed by item ID — used to tint affected segment cards */
const hintMap = computed(() =>
  selectedVacation.value ? computeTimelineHints(selectedVacation.value) : new Map()
);

/** Which hint tooltip is currently expanded */

const mergedTimeline = computed<TimelineEntry[]>(() => {
  const entries: TimelineEntry[] = [];
  for (const g of groupedByDate.value) {
    entries.push({ type: 'group', data: g });
  }
  for (const gapDate of accommodationGaps.value) {
    entries.push({ type: 'gap', date: gapDate, label: formatNookDate(gapDate) });
  }
  entries.sort((a, b) => {
    const dateA = a.type === 'group' ? a.data.date : a.date;
    const dateB = b.type === 'group' ? b.data.date : b.date;
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return a.type === 'group' ? -1 : 1;
  });
  return entries;
});

const upcomingVacations = computed(() => vacationStore.upcomingVacations);

const pastVacations = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  return vacationStore.vacations
    .filter((v) => v.endDate && v.endDate < today)
    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''));
});

const hasTrips = computed(
  () => upcomingVacations.value.length > 0 || pastVacations.value.length > 0
);

function vacationProgress(v: FamilyVacation) {
  return bookingProgress(v);
}

function vacationCountdown(v: FamilyVacation) {
  return v.startDate ? daysUntilTrip(v.startDate) : null;
}

function vacationDateRange(v: FamilyVacation) {
  if (!v.startDate) return '';
  const start = formatDateShort(v.startDate);
  const end = v.endDate ? formatDateShort(v.endDate) : '';
  return end ? `${start} – ${end}` : start;
}

function vacationAssignees(v: FamilyVacation) {
  return (v.assigneeIds ?? [])
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter(Boolean) as Array<{ id: string; name: string; color: string }>;
}

// ── Navigation ───────────────────────────────────────────────────────────────

function selectTrip(id: string) {
  selectedVacationId.value = id;
  collapsedCards.value = {};
}

function backToList() {
  selectedVacationId.value = null;
}

async function deleteTrip() {
  if (!selectedVacation.value) return;
  const confirmed = await confirm({
    title: 'vacation.deleteTitle',
    message: 'vacation.deleteMessage',
    variant: 'danger',
  });
  if (confirmed) {
    await vacationStore.deleteVacation(selectedVacation.value.id);
    selectedVacationId.value = null;
  }
}

function startWizard() {
  editingVacation.value = null;
  editVacationStep.value = undefined;
  showVacationWizard.value = true;
}

function editInWizard(step: number) {
  if (selectedVacation.value) {
    editingVacation.value = selectedVacation.value;
    editVacationStep.value = step;
    showVacationWizard.value = true;
  }
}

function addSegmentViaWizard(step: number) {
  showAddMenu.value = false;
  editInWizard(step);
}

async function addActivitySegment() {
  if (!selectedVacation.value) return;
  showAddMenu.value = false;
  const id = selectedVacation.value.id;
  const newSeg = {
    id: crypto.randomUUID(),
    type: 'activity' as const,
    title: '',
    status: 'pending' as const,
  };
  const travelSegments = [...selectedVacation.value.travelSegments, newSeg];
  await vacationStore.updateVacation(id, { travelSegments });
  // Open the edit modal for the new segment
  editingItemIndex.value = travelSegments.length - 1;
  editModalType.value = 'travel';
}

// ── Collapsible cards ────────────────────────────────────────────────────────

function isCollapsed(id: string): boolean {
  return collapsedCards.value[id] !== false;
}

function setCollapsed(id: string, val: boolean) {
  collapsedCards.value[id] = val;
}

// ── Edit modals ──────────────────────────────────────────────────────────────

/** Date fields that should also update sortDate on travel segments */
const TRAVEL_DATE_FIELDS = new Set(['departureDate', 'embarkationDate']);

/** Inline-edit a single field on a timeline item and save immediately */
function saveInlineField(item: TimelineItem, field: string, value: string) {
  if (!selectedVacation.value) return;
  const id = selectedVacation.value.id;
  if (item.kind === 'travel') {
    const travelSegments = [...selectedVacation.value.travelSegments];
    const updated = { ...travelSegments[item.arrayIndex]!, [field]: value };
    // Keep sortDate in sync when a primary date field changes
    if (TRAVEL_DATE_FIELDS.has(field)) {
      updated.sortDate = value;
    }
    travelSegments[item.arrayIndex] = updated;
    vacationStore.updateVacation(id, { travelSegments });
  } else if (item.kind === 'accommodation') {
    const accommodations = [...selectedVacation.value.accommodations];
    accommodations[item.arrayIndex] = { ...accommodations[item.arrayIndex]!, [field]: value };
    vacationStore.updateVacation(id, { accommodations });
  } else if (item.kind === 'transportation') {
    const transportation = [...selectedVacation.value.transportation];
    transportation[item.arrayIndex] = { ...transportation[item.arrayIndex]!, [field]: value };
    vacationStore.updateVacation(id, { transportation });
  }
}

function openEditModal(item: TimelineItem) {
  editingItemIndex.value = item.arrayIndex;
  editModalType.value = item.kind;
}

async function deleteTimelineItem(item: TimelineItem) {
  if (!selectedVacation.value) return;
  const id = selectedVacation.value.id;
  if (item.kind === 'travel') {
    const travelSegments = selectedVacation.value.travelSegments.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { travelSegments });
  } else if (item.kind === 'accommodation') {
    const accommodations = selectedVacation.value.accommodations.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { accommodations });
  } else if (item.kind === 'transportation') {
    const transportation = selectedVacation.value.transportation.filter(
      (_, i) => i !== item.arrayIndex
    );
    await vacationStore.updateVacation(id, { transportation });
  }
}

function closeEditModal() {
  editModalType.value = null;
  editingItemIndex.value = -1;
}

// Current editing items for modals
const editingTravelSegment = computed(() => {
  if (editModalType.value !== 'travel' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.travelSegments[editingItemIndex.value]
    : undefined;
});

const editingAccommodation = computed(() => {
  if (editModalType.value !== 'accommodation' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.accommodations[editingItemIndex.value]
    : undefined;
});

const editingTransportation = computed(() => {
  if (editModalType.value !== 'transportation' || !selectedVacation.value) return undefined;
  return editingItemIndex.value >= 0
    ? selectedVacation.value.transportation[editingItemIndex.value]
    : undefined;
});

// ── Ideas ────────────────────────────────────────────────────────────────────

function handleVote(ideaId: string) {
  if (!selectedVacation.value || !familyStore.currentMemberId) return;
  vacationStore.toggleIdeaVote(selectedVacation.value.id, ideaId, familyStore.currentMemberId);
}

function handleIdeaUpdate(updatedIdea: VacationIdea) {
  if (!selectedVacation.value) return;
  const ideas = selectedVacation.value.ideas.map((i) =>
    i.id === updatedIdea.id ? updatedIdea : i
  );
  vacationStore.updateVacation(selectedVacation.value.id, { ideas });
}

async function handleIdeaDelete(ideaId: string) {
  if (!selectedVacation.value) return;
  const confirmed = await confirm({
    title: 'vacation.deleteSegmentTitle',
    message: 'vacation.deleteSegmentMessage',
    variant: 'danger',
  });
  if (!confirmed) return;
  const ideas = selectedVacation.value.ideas.filter((i) => i.id !== ideaId);
  vacationStore.updateVacation(selectedVacation.value.id, { ideas });
}

const editingIdea = computed(() =>
  editingIdeaId.value && selectedVacation.value
    ? selectedVacation.value.ideas.find((i) => i.id === editingIdeaId.value)
    : undefined
);

function openIdeaEdit(ideaId: string) {
  editingIdeaId.value = ideaId;
}

function closeIdeaEdit() {
  editingIdeaId.value = null;
}

function addQuickIdea() {
  const text = quickIdeaText.value.trim();
  if (!text || !selectedVacation.value || !familyStore.currentMemberId) return;
  const newIdea: VacationIdea = {
    id: crypto.randomUUID(),
    title: text,
    votes: [],
    createdBy: familyStore.currentMemberId,
    createdAt: new Date().toISOString(),
  };
  const ideas = [...selectedVacation.value.ideas, newIdea];
  vacationStore.updateVacation(selectedVacation.value.id, { ideas });
  quickIdeaText.value = '';
}
</script>

<template>
  <div class="space-y-6">
    <!-- ═══════════════════════════════════════════════════════════════════════
         LIST VIEW — when no trip is selected
         ═══════════════════════════════════════════════════════════════════════ -->
    <template v-if="!selectedVacationId">
      <PageHeader icon="airplane" :title="t('travel.title')" :subtitle="t('travel.subtitle')">
        <button
          type="button"
          class="font-outfit inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(0,180,216,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(0,180,216,0.3)]"
          @click="startWizard"
        >
          {{ t('travel.planATrip') }} 🌴
        </button>
      </PageHeader>

      <!-- Upcoming trip cards -->
      <div
        v-if="upcomingVacations.length > 0"
        class="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
      >
        <div
          v-for="vacation in upcomingVacations"
          :key="vacation.id"
          class="cursor-pointer overflow-hidden rounded-3xl border-[1.5px] border-[var(--tint-slate-5)] bg-white shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(0,180,216,0.2)] hover:shadow-[0_6px_24px_rgba(0,180,216,0.08)] dark:bg-slate-800"
          @click="selectTrip(vacation.id)"
        >
          <!-- Hero gradient with floating emoji -->
          <div
            class="relative flex h-24 items-center justify-center overflow-hidden"
            style="background: linear-gradient(135deg, rgb(0 180 216 / 8%), rgb(255 217 61 / 6%))"
          >
            <span class="relative z-10 animate-bounce text-5xl" style="animation-duration: 3s">
              {{ tripTypeEmoji(vacation.tripType, vacation.tripPurpose) }}
            </span>
          </div>

          <!-- Card body -->
          <div class="p-4">
            <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
              {{ vacation.name }}
            </h3>
            <div
              v-if="vacationDateRange(vacation)"
              class="font-outfit mt-1 flex items-center gap-1.5 text-xs text-gray-400"
            >
              📅 {{ vacationDateRange(vacation) }}
            </div>

            <!-- Countdown + members -->
            <div class="mt-2.5 flex flex-wrap items-center gap-2">
              <span
                v-if="vacationCountdown(vacation) !== null && vacationCountdown(vacation)! > 0"
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-3 py-1 text-[11px] font-bold text-white"
              >
                {{ tripTypeEmoji(vacation.tripType, vacation.tripPurpose) }}
                {{ vacationCountdown(vacation) }}
                {{ t(tripCountdownKey(vacation.tripType, vacation.tripPurpose) as any) }}!
              </span>
              <span
                v-else-if="
                  vacationCountdown(vacation) !== null && vacationCountdown(vacation)! <= 0
                "
                class="font-outfit inline-flex items-center gap-1 rounded-lg bg-[var(--tint-slate-5)] px-2.5 py-1 text-[11px] font-semibold text-gray-400"
              >
                ✓ {{ t('travel.completed') }}
              </span>
            </div>

            <!-- Member chips -->
            <div v-if="vacationAssignees(vacation).length" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="member in vacationAssignees(vacation)"
                :key="member.id"
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-slate-5)] px-2.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-slate-700 dark:text-gray-300"
              >
                <span
                  class="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-bold text-white"
                  :style="{ backgroundColor: member.color }"
                >
                  {{ member.name.charAt(0).toUpperCase() }}
                </span>
                {{ member.name }}
              </span>
            </div>

            <!-- Progress bar -->
            <div v-if="vacationProgress(vacation).total > 0" class="mt-3 flex items-center gap-2">
              <div class="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
                <div
                  class="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6]"
                  :style="{ width: vacationProgress(vacation).percent + '%' }"
                />
              </div>
              <span class="font-outfit text-[10px] font-semibold whitespace-nowrap text-[#00B4D8]">
                {{ vacationProgress(vacation).booked }}/{{ vacationProgress(vacation).total }}
                booked
              </span>
            </div>

            <!-- Needs booking badge -->
            <div
              v-if="vacationProgress(vacation).total - vacationProgress(vacation).booked > 0"
              class="mt-1.5"
            >
              <span
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-[rgba(255,217,61,0.12)] px-2.5 py-0.5 text-[9px] font-semibold text-[#B8860B]"
              >
                ⏳
                {{ vacationProgress(vacation).total - vacationProgress(vacation).booked }}
                {{ t('travel.needsBooking').toLowerCase() }}
              </span>
            </div>

            <!-- Accommodation gap warning -->
            <div v-if="computeAccommodationGaps(vacation).length > 0" class="mt-1.5">
              <span
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-8)] px-2.5 py-0.5 text-[9px] font-semibold text-[var(--heritage-orange)]"
              >
                🏨 {{ computeAccommodationGaps(vacation).length }}
                {{ computeAccommodationGaps(vacation).length === 1 ? 'night' : 'nights' }}
                {{ t('travel.accommodationGap').toLowerCase() }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Past trips (collapsible) -->
      <div v-if="pastVacations.length > 0" class="mt-2">
        <button
          type="button"
          class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          @click="showPastTrips = !showPastTrips"
        >
          <span class="text-xs opacity-50">{{ showPastTrips ? '▲' : '▼' }}</span>
          <span class="font-outfit text-sm font-semibold text-gray-400">
            {{ t('travel.pastTrips') }} ({{ pastVacations.length }})
          </span>
        </button>

        <div
          v-if="showPastTrips"
          class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
        >
          <div
            v-for="vacation in pastVacations"
            :key="vacation.id"
            class="cursor-pointer overflow-hidden rounded-3xl border-[1.5px] border-[var(--tint-slate-5)] bg-white opacity-50 shadow-[var(--card-shadow)] transition-all duration-200 hover:opacity-100 dark:bg-slate-800"
            @click="selectTrip(vacation.id)"
          >
            <div
              class="relative flex h-20 items-center justify-center overflow-hidden"
              style="background: linear-gradient(135deg, rgb(0 180 216 / 4%), rgb(44 62 80 / 3%))"
            >
              <span class="relative z-10 text-4xl">
                {{ tripTypeEmoji(vacation.tripType, vacation.tripPurpose) }}
              </span>
            </div>
            <div class="p-4">
              <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
                {{ vacation.name }}
              </h3>
              <div
                v-if="vacationDateRange(vacation)"
                class="font-outfit mt-1 text-xs text-gray-400"
              >
                📅 {{ vacationDateRange(vacation) }}
              </div>
              <span
                class="font-outfit mt-2 inline-block rounded-lg bg-[var(--tint-slate-5)] px-2.5 py-1 text-[11px] font-semibold text-gray-400"
              >
                ✓ {{ t('travel.completed') }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty state (only when no trips at all) -->
      <BaseCard v-if="!hasTrips">
        <div
          class="rounded-3xl border-2 border-dashed border-[rgba(0,180,216,0.15)] py-16 text-center"
        >
          <span class="mb-3 block text-5xl">✈️</span>
          <h3 class="font-outfit mb-1 text-lg font-bold text-gray-900 dark:text-gray-100">
            {{ t('travel.empty') }}
          </h3>
          <p class="mx-auto mb-5 max-w-sm text-sm text-gray-400 dark:text-gray-500">
            {{ t('travel.emptySubtitle') }}
          </p>
          <button
            type="button"
            class="font-outfit inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-5 py-2.5 text-sm font-semibold whitespace-nowrap text-white shadow-[0_4px_12px_rgba(0,180,216,0.2)] transition-all hover:shadow-[0_6px_16px_rgba(0,180,216,0.3)]"
            @click="startWizard"
          >
            {{ t('travel.planATrip') }} 🌴
          </button>
        </div>
      </BaseCard>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════
         EXPANDED VIEW — when a trip is selected
         ═══════════════════════════════════════════════════════════════════════ -->
    <template v-else-if="selectedVacation">
      <!-- Back to all trips -->
      <button
        type="button"
        class="font-outfit mb-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        @click="backToList"
      >
        ← {{ t('travel.allTrips') }}
      </button>

      <!-- Hero banner -->
      <div
        class="relative overflow-hidden rounded-3xl shadow-[var(--card-shadow)]"
        style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
      >
        <!-- Decorative -->
        <div
          class="absolute -top-10 -right-8 h-44 w-44 rounded-full"
          style="background: radial-gradient(circle, rgb(255 217 61 / 14%), transparent 70%)"
        />

        <div class="relative z-10 px-6 py-5">
          <!-- Actions row -->
          <div class="mb-3 flex items-center justify-end">
            <div class="flex gap-1.5">
              <button
                type="button"
                class="font-outfit inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-white/20 bg-white/15 px-4 py-1.5 text-xs font-semibold text-white/90 shadow-sm backdrop-blur transition-all hover:border-white/30 hover:bg-white/25 hover:text-white"
                @click="editInWizard(1)"
              >
                ✏️ {{ t('travel.editTravelPlans') }}
              </button>
              <button
                type="button"
                class="font-outfit inline-flex items-center justify-center rounded-full border-[1.5px] border-white/30 bg-white/15 px-2.5 py-1.5 text-xs text-white transition-all hover:border-red-400/40 hover:bg-red-500/20 hover:text-red-200"
                :title="t('vacation.deleteTitle')"
                @click="deleteTrip"
              >
                🗑️
              </button>
            </div>
          </div>

          <!-- Row 2: emoji + name -->
          <div class="flex items-center gap-3.5">
            <span
              class="shrink-0 text-[40px] drop-shadow-lg"
              style="animation: hero-float 4s ease-in-out infinite"
            >
              {{ tripTypeEmoji(selectedVacation.tripType, selectedVacation.tripPurpose) }}
            </span>
            <div class="min-w-0 flex-1">
              <h2 class="font-outfit text-xl font-extrabold text-white sm:text-[22px]">
                {{ selectedVacation.name }}
              </h2>
              <div class="mt-0.5 text-xs text-white/50">
                📅 {{ vacationDateRange(selectedVacation) }}
              </div>
            </div>
          </div>

          <!-- Row 3: countdown + members -->
          <div class="mt-3 flex flex-wrap items-center gap-2.5">
            <div
              v-if="vacationCountdown(selectedVacation) !== null"
              class="inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-white/10 bg-white/16 px-4 py-1.5 backdrop-blur"
            >
              <template v-if="vacationCountdown(selectedVacation)! > 0">
                <span class="font-outfit text-xl leading-none font-extrabold text-[#FFD93D]">
                  {{ vacationCountdown(selectedVacation) }}
                </span>
                <span class="font-outfit text-[11px] font-semibold text-white/70">
                  {{
                    t(
                      tripCountdownKey(
                        selectedVacation.tripType,
                        selectedVacation.tripPurpose
                      ) as any
                    )
                  }}!
                  {{ tripTypeEmoji(selectedVacation.tripType, selectedVacation.tripPurpose) }}
                </span>
              </template>
              <template v-else>
                <span class="font-outfit text-[11px] font-semibold text-white/70">
                  ✓ {{ t('travel.completed') }}
                </span>
              </template>
            </div>

            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="member in vacationAssignees(selectedVacation)"
                :key="member.id"
                class="font-outfit inline-flex items-center gap-1 rounded-full bg-white/8 px-2.5 py-0.5 text-[11px] font-medium text-white/75"
              >
                <span
                  class="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] font-bold text-white"
                  :style="{ backgroundColor: member.color }"
                >
                  {{ member.name.charAt(0).toUpperCase() }}
                </span>
                {{ member.name }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Two-column layout -->
      <div class="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_340px]">
        <!-- LEFT: Timeline -->
        <div class="min-w-0 pr-0 lg:pr-6">
          <!-- Progress banner -->
          <div
            v-if="vacationProgress(selectedVacation).total > 0"
            class="mb-5 flex items-center gap-3 rounded-2xl bg-[var(--tint-slate-5)] p-3 dark:bg-slate-800"
          >
            <span class="text-base">📋</span>
            <div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
              <div
                class="h-full rounded-full transition-all duration-500"
                style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
                :style="{ width: vacationProgress(selectedVacation).percent + '%' }"
              />
            </div>
            <span class="font-outfit text-xs font-semibold whitespace-nowrap text-[#00B4D8]">
              {{ vacationProgress(selectedVacation).booked }} of
              {{ vacationProgress(selectedVacation).total }} booked
            </span>
          </div>

          <!-- Ideas teaser (responsive: hidden on lg, visible on mobile/tablet) -->
          <div
            v-if="selectedVacation.ideas.length > 0"
            class="mb-5 flex cursor-pointer items-center gap-3 rounded-2xl border-[1.5px] border-[rgba(255,217,61,0.12)] p-3 transition-all hover:shadow-[0_4px_14px_rgba(255,217,61,0.1)] lg:hidden"
            style="background: linear-gradient(135deg, rgb(255 217 61 / 8%), rgb(0 180 216 / 6%))"
            @click="scrollToIdeas"
          >
            <span class="text-2xl">🌟</span>
            <div class="font-outfit flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ selectedVacation.ideas.length }} {{ t('travel.ideasTeaser').toLowerCase() }}
              <span class="mt-0.5 block text-[11px] font-normal text-gray-400">
                {{ t('travel.ideasTeaserHint') }}
              </span>
            </div>
            <span class="text-sm text-gray-300">↓</span>
          </div>

          <!-- Timeline header -->
          <div class="mb-4 flex items-center gap-1.5">
            <span class="font-outfit text-sm font-bold text-gray-900 dark:text-gray-100">
              📅 {{ t('travel.timeline') }}
            </span>
          </div>

          <!-- Visual timeline -->
          <div class="relative space-y-2 pl-10">
            <!-- Vertical line -->
            <div
              class="absolute top-0 bottom-0 left-[15px] w-0.5 rounded-full"
              style="background: linear-gradient(180deg, #00b4d8, rgb(0 180 216 / 30%))"
            />

            <template v-for="(entry, ei) in mergedTimeline" :key="ei">
              <!-- ── Gap warning (inline at correct date) ── -->
              <template v-if="entry.type === 'gap'">
                <div class="relative flex items-center pt-3 pb-1">
                  <div
                    class="absolute -left-10 z-[2] flex h-8 w-8 items-center justify-center rounded-full border-[2.5px] border-dashed border-[var(--heritage-orange)] bg-white text-xs dark:bg-slate-800"
                  >
                    🏨
                  </div>
                  <span class="font-outfit text-[13px] font-bold text-[var(--heritage-orange)]">
                    {{ entry.label }}
                  </span>
                </div>
                <div class="relative mb-2">
                  <div
                    class="absolute top-4 -left-[33px] z-[2] h-2 w-2 rounded-full bg-[var(--heritage-orange)] opacity-25"
                  />
                  <div
                    class="absolute top-[18px] -left-[25px] z-[1] h-0.5 w-[18px] bg-[rgba(241,93,34,0.12)]"
                  />
                  <button
                    class="flex w-full cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-[rgba(241,93,34,0.2)] bg-[var(--tint-orange-8)] px-4 py-3 text-left transition-colors hover:bg-[var(--tint-orange-15)] dark:bg-orange-900/10"
                    @click="addSegmentViaWizard(3)"
                  >
                    <div class="flex-1">
                      <span class="font-outfit text-xs font-semibold text-[var(--heritage-orange)]">
                        {{ t('travel.accommodationGap') }}
                      </span>
                    </div>
                    <span class="font-outfit text-[10px] font-semibold text-[#00B4D8]">
                      {{ t('travel.addSegment') }}
                    </span>
                  </button>
                </div>
              </template>

              <!-- ── Date group with segment cards ── -->
              <template v-else>
                <!-- Date node -->
                <div class="relative flex items-center pt-3 pb-1">
                  <div
                    class="absolute -left-10 z-[2] flex h-8 w-8 items-center justify-center rounded-full border-[2.5px] border-[#00B4D8] bg-white text-xs shadow-[0_2px_8px_rgba(0,180,216,0.12)] dark:bg-slate-800"
                  >
                    📅
                  </div>
                  <span class="font-outfit text-[13px] font-bold text-gray-900 dark:text-gray-100">
                    {{ entry.data.label }}
                  </span>
                </div>

                <!-- Segment cards within this date -->
                <div v-for="item in entry.data.items" :key="item.id" class="relative mb-2">
                  <!-- Connector dot -->
                  <div
                    class="absolute top-4 -left-[33px] z-[2] h-2 w-2 rounded-full bg-[#00B4D8] opacity-25"
                  />
                  <div
                    class="absolute top-[18px] -left-[25px] z-[1] h-0.5 w-[18px] bg-[rgba(0,180,216,0.12)]"
                  />

                  <VacationSegmentCard
                    :icon="item.icon"
                    :title="item.title"
                    :status="item.status"
                    :key-value="item.keyValue"
                    :collapsed="isCollapsed(item.id)"
                    :read-only="false"
                    show-edit
                    deletable
                    :hint="hintMap.get(item.id)?.message"
                    @update:title="saveInlineField(item, 'title', $event)"
                    @update:collapsed="setCollapsed(item.id, $event)"
                    @edit="openEditModal(item)"
                    @delete="deleteTimelineItem(item)"
                  >
                    <!-- Detail rows — divided, compact, inline-editable with pencil -->
                    <div class="divide-y divide-gray-100 dark:divide-slate-700/40">
                      <div
                        v-for="row in item.detailRows"
                        :key="row.label"
                        class="flex items-center gap-3 py-1 first:pt-0 last:pb-0"
                      >
                        <!-- Label -->
                        <span
                          class="font-outfit w-20 shrink-0 text-xs font-semibold text-gray-400 uppercase dark:text-gray-500"
                        >
                          {{ row.label }}
                        </span>

                        <!-- Copyable value (booking ref only) -->
                        <button
                          v-if="row.copyable"
                          class="font-outfit inline-flex items-center gap-1.5 rounded-lg border border-[var(--tint-slate-10)] bg-white px-2.5 py-0.5 text-sm font-semibold text-[var(--color-text)] transition-colors hover:border-[#00B4D8] hover:bg-[rgba(0,180,216,0.08)] dark:bg-slate-700 dark:text-white"
                          @click="copy(row.value)"
                        >
                          {{ row.value }}
                          <span class="text-xs opacity-30">📋</span>
                        </button>

                        <!-- Inline-editable field with pencil hint -->
                        <div v-else-if="row.field" class="group/field relative min-w-0 shrink">
                          <input
                            :type="row.inputType ?? 'text'"
                            :value="row.value"
                            :size="
                              row.inputType === 'date' || row.inputType === 'time'
                                ? undefined
                                : Math.max(String(row.value).length, 8)
                            "
                            class="font-outfit w-auto border-0 border-b border-dashed border-transparent bg-transparent pr-5 text-sm font-medium text-gray-900 transition-colors outline-none hover:border-gray-300 focus:border-[var(--vacation-teal)] dark:text-gray-100 dark:hover:border-slate-500"
                            @change="
                              saveInlineField(
                                item,
                                row.field!,
                                ($event.target as HTMLInputElement).value
                              )
                            "
                          />
                          <span
                            class="pointer-events-none absolute top-1/2 right-0 -translate-y-1/2 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover/field:opacity-100 dark:text-slate-500"
                          >
                            ✏️
                          </span>
                        </div>

                        <!-- Map link (entire row clickable) -->
                        <a
                          v-else-if="row.mapLink"
                          :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.value)}`"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="flex min-w-0 items-center gap-1.5"
                        >
                          <span class="truncate text-sm text-[#00B4D8] hover:underline">
                            {{ row.value }}
                          </span>
                          <span class="shrink-0 text-xs opacity-40">📍</span>
                        </a>

                        <!-- Clickable link -->
                        <div v-else-if="row.isLink" class="flex min-w-0 items-center gap-1.5">
                          <a
                            :href="
                              row.value.startsWith('http') ? row.value : `https://${row.value}`
                            "
                            target="_blank"
                            rel="noopener noreferrer"
                            class="truncate text-sm text-[#00B4D8] hover:underline"
                          >
                            {{ row.value.replace(/^https?:\/\//, '') }}
                          </a>
                          <span class="shrink-0 text-xs opacity-40">🔗</span>
                        </div>

                        <!-- Plain read-only value -->
                        <span v-else class="text-sm text-gray-900 dark:text-gray-100">
                          {{ row.value }}
                        </span>
                      </div>
                    </div>
                  </VacationSegmentCard>
                </div>
              </template>
            </template>
          </div>

          <!-- Add segment to timeline -->
          <div class="mt-4 flex items-center gap-2 pl-10">
            <button
              class="font-outfit inline-flex items-center gap-1 rounded-full border-[1.5px] border-[#00B4D8]/30 bg-[rgba(0,180,216,0.06)] px-4 py-2 text-xs font-semibold text-[#00B4D8] shadow-sm transition-all hover:border-[#00B4D8]/50 hover:bg-[rgba(0,180,216,0.12)]"
              @click="showAddMenu = !showAddMenu"
            >
              {{ showAddMenu ? '✕ close' : '+ add a plan' }}
            </button>
            <Transition
              enter-active-class="transition-all duration-150 ease-out"
              enter-from-class="opacity-0 -translate-x-2"
              leave-active-class="transition-all duration-100 ease-in"
              leave-to-class="opacity-0 -translate-x-2"
            >
              <div v-if="showAddMenu" class="flex flex-wrap gap-1.5">
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(2)"
                >
                  ✈️ {{ t('vacation.step.travel') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(3)"
                >
                  🏨 {{ t('vacation.step.stay') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addSegmentViaWizard(4)"
                >
                  🚗 {{ t('vacation.step.gettingAround') }}
                </button>
                <button
                  class="rounded-full bg-[var(--tint-slate-5)] px-2.5 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-[rgba(0,180,216,0.08)] hover:text-[#00B4D8] dark:bg-slate-700 dark:text-gray-300"
                  @click="addActivitySegment"
                >
                  🎭 {{ t('vacation.segment.activity') }}
                </button>
              </div>
            </Transition>
          </div>

          <!-- Unbooked items -->
          <div v-if="undatedItems.length > 0" class="mt-4 space-y-2">
            <div
              class="font-outfit text-[10px] font-semibold tracking-wide text-[#B8860B] uppercase"
            >
              🤔 {{ t('vacation.stillDeciding' as any) }}
            </div>
            <VacationSegmentCard
              v-for="item in undatedItems"
              :key="item.id"
              :icon="item.icon"
              :title="item.title"
              :status="item.status"
              :key-value="item.keyValue"
              :collapsed="isCollapsed(item.id)"
              :read-only="false"
              show-edit
              deletable
              @update:title="saveInlineField(item, 'title', $event)"
              @update:collapsed="setCollapsed(item.id, $event)"
              @edit="openEditModal(item)"
              @delete="deleteTimelineItem(item)"
            />
          </div>
        </div>

        <!-- RIGHT: Ideas panel -->
        <div
          ref="ideasPanelRef"
          class="mt-6 min-w-0 rounded-3xl border-t border-gray-100 p-5 lg:mt-0 lg:border-t-0 lg:border-l lg:border-gray-100 dark:border-slate-700"
          style="background: linear-gradient(180deg, rgb(255 217 61 / 3%), rgb(0 180 216 / 2%))"
        >
          <!-- Ideas header -->
          <div
            class="-mx-5 -mt-5 flex items-center gap-3 rounded-t-3xl border-b-[1.5px] border-[rgba(255,217,61,0.12)] px-4 py-3.5"
            style="background: linear-gradient(135deg, rgb(255 217 61 / 10%), rgb(0 180 216 / 6%))"
          >
            <div
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/70 text-[22px] shadow-[0_2px_8px_rgba(44,62,80,0.06)]"
            >
              🌟
            </div>
            <div>
              <h3 class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
                {{ t('travel.ideas') }}
              </h3>
              <div class="text-[11px] text-gray-400">{{ selectedVacation.ideas.length }} ideas</div>
            </div>
          </div>

          <!-- Ideas section -->
          <div
            class="font-outfit mt-4 mb-2 text-[10px] font-semibold tracking-[0.08em] text-gray-300 uppercase"
          >
            ideas & wishes
          </div>

          <div class="space-y-2">
            <VacationIdeaCard
              v-for="idea in unplannedIdeas"
              :key="idea.id"
              :idea="idea"
              :current-member-id="familyStore.currentMemberId ?? ''"
              :expanded="false"
              @vote="handleVote(idea.id)"
              @update:expanded="openIdeaEdit(idea.id)"
              @delete="handleIdeaDelete(idea.id)"
            />
          </div>

          <!-- Empty ideas -->
          <div
            v-if="unplannedIdeas.length === 0 && plannedIdeas.length === 0"
            class="py-6 text-center text-sm text-gray-400"
          >
            {{ t('vacation.ideas.empty') }}
          </div>

          <!-- Planned section -->
          <template v-if="plannedIdeas.length > 0">
            <div
              class="font-outfit mt-5 mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-green-600 uppercase dark:text-green-400"
            >
              ✓ {{ t('vacation.ideas.plannedSection') }}
            </div>
            <div class="space-y-2">
              <VacationIdeaCard
                v-for="idea in plannedIdeas"
                :key="idea.id"
                :idea="idea"
                :current-member-id="familyStore.currentMemberId ?? ''"
                :expanded="false"
                @vote="handleVote(idea.id)"
                @update:expanded="openIdeaEdit(idea.id)"
                @delete="handleIdeaDelete(idea.id)"
              />
            </div>
          </template>

          <!-- Quick-add input -->
          <div class="mt-3 flex gap-1.5">
            <input
              v-model="quickIdeaText"
              type="text"
              :placeholder="t('travel.quickAddIdea')"
              class="flex-1 rounded-xl border-[1.5px] border-[var(--tint-slate-5)] bg-white px-3.5 py-2.5 text-sm text-gray-900 transition-all outline-none focus:border-[#00B4D8] focus:shadow-[0_0_0_3px_rgba(0,180,216,0.08)] dark:bg-slate-800 dark:text-gray-100"
              @keydown.enter="addQuickIdea"
            />
            <button
              type="button"
              class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-[#00B4D8] to-[#0077B6] text-lg text-white"
              @click="addQuickIdea"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════════════════════
         MODALS
         ═══════════════════════════════════════════════════════════════════════ -->

    <!-- Vacation wizard -->
    <VacationWizard
      :open="showVacationWizard"
      :vacation="editingVacation"
      :edit-step="editVacationStep"
      @close="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
      @saved="
        showVacationWizard = false;
        editingVacation = null;
        editVacationStep = undefined;
      "
    />

    <!-- Segment edit modals -->
    <TravelSegmentEditModal
      :open="editModalType === 'travel'"
      :segment="editingTravelSegment"
      :vacation-id="selectedVacationId ?? ''"
      :segment-index="editingItemIndex"
      @close="closeEditModal"
    />

    <AccommodationEditModal
      :open="editModalType === 'accommodation'"
      :accommodation="editingAccommodation"
      :vacation-id="selectedVacationId ?? ''"
      :accommodation-index="editingItemIndex"
      @close="closeEditModal"
    />

    <TransportationEditModal
      :open="editModalType === 'transportation'"
      :transportation="editingTransportation"
      :vacation-id="selectedVacationId ?? ''"
      :transportation-index="editingItemIndex"
      @close="closeEditModal"
    />

    <!-- Idea edit modal -->
    <IdeaEditModal
      :open="editingIdeaId !== null"
      :idea="editingIdea"
      @close="closeIdeaEdit"
      @save="
        handleIdeaUpdate($event);
        closeIdeaEdit();
      "
      @delete="
        editingIdeaId && handleIdeaDelete(editingIdeaId);
        closeIdeaEdit();
      "
    />

    <!-- Copied toast -->
    <Transition
      enter-active-class="transition-all duration-200"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition-all duration-200"
      leave-to-class="opacity-0 translate-y-2"
    >
      <div
        v-if="copied"
        class="font-outfit fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-lg bg-[var(--color-text)] px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
      >
        copied!
      </div>
    </Transition>
  </div>
</template>

<style>
@keyframes hero-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-3px);
  }
}
</style>
