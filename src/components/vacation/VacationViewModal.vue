<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import VacationSegmentCard from './VacationSegmentCard.vue';
import VacationIdeaCard from './VacationIdeaCard.vue';
import { useVacationStore } from '@/stores/vacationStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { useClipboard } from '@/composables/useClipboard';
import {
  formatNookDate,
  formatDateShort,
  extractDatePart,
  parseLocalDate,
  addDays,
  toDateInputValue,
} from '@/utils/date';
import { bookingProgress, daysUntilTrip, tripDurationDays } from '@/utils/vacation';
import type { FamilyVacation } from '@/types/models';

interface Props {
  open: boolean;
  vacationId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  edit: [vacation: FamilyVacation, step?: number];
}>();

const { t } = useTranslation();
const vacationStore = useVacationStore();
const familyStore = useFamilyStore();
const { copied, copy } = useClipboard();

const vacation = computed(() =>
  props.vacationId ? vacationStore.getVacationById(props.vacationId) : undefined
);

const tripTypeEmojis: Record<string, string> = {
  fly_and_stay: '✈️',
  cruise: '🚢',
  road_trip: '🚗',
  combo: '🎒',
  camping: '🏕️',
  adventure: '🏔️',
};

const tripEmoji = computed(() => tripTypeEmojis[vacation.value?.tripType ?? ''] ?? '✈️');

const progress = computed(() => (vacation.value ? bookingProgress(vacation.value) : null));

const countdown = computed(() =>
  vacation.value?.startDate ? daysUntilTrip(vacation.value.startDate) : null
);

const duration = computed(() =>
  vacation.value?.startDate && vacation.value?.endDate
    ? tripDurationDays(vacation.value.startDate, vacation.value.endDate)
    : null
);

const dateRange = computed(() => {
  if (!vacation.value?.startDate) return '';
  const start = formatDateShort(vacation.value.startDate);
  const end = vacation.value.endDate ? formatDateShort(vacation.value.endDate) : '';
  return end ? `${start} – ${end}` : start;
});

const assignees = computed(() =>
  (vacation.value?.assigneeIds ?? [])
    .map((id) => familyStore.members.find((m) => m.id === id))
    .filter(Boolean)
);

const accommodationGaps = computed(() => {
  if (!vacation.value?.startDate || !vacation.value?.endDate) return [];
  const start = parseLocalDate(extractDatePart(vacation.value.startDate));
  const end = parseLocalDate(extractDatePart(vacation.value.endDate));
  const coveredDates = new Set<string>();

  for (const acc of vacation.value.accommodations) {
    if (acc.checkInDate && acc.checkOutDate) {
      let d = parseLocalDate(extractDatePart(acc.checkInDate));
      const out = parseLocalDate(extractDatePart(acc.checkOutDate));
      while (d < out) {
        coveredDates.add(toDateInputValue(d));
        d = addDays(d, 1);
      }
    }
  }

  const gaps: string[] = [];
  let d = new Date(start);
  while (d <= end) {
    const dateStr = toDateInputValue(d);
    if (!coveredDates.has(dateStr)) gaps.push(dateStr);
    d = addDays(d, 1);
  }
  return gaps;
});

// Timeline: merge all segments, sort by date, group by date header
interface TimelineItem {
  id: string;
  kind: 'travel' | 'accommodation' | 'transportation';
  icon: string;
  title: string;
  status: 'booked' | 'pending' | 'not_booked' | 'researching';
  sortDate: string;
  stepNumber: number;
  copyFields: { label: string; value: string }[];
  data: Record<string, unknown>;
}

const travelIcons: Record<string, string> = {
  flight_outbound: '🛫',
  flight_return: '🛬',
  flight_other: '✈️',
  cruise: '🚢',
  train: '🚄',
  ferry: '⛴️',
};

const accomIcons: Record<string, string> = {
  hotel: '🏨',
  airbnb: '🏠',
  campground: '⛺',
  family_friends: '👪',
};

const transportIcons: Record<string, string> = {
  airport_shuttle: '🚐',
  rental_car: '🚗',
  taxi_rideshare: '🚕',
  train: '🚄',
  bus: '🚌',
};

const timelineItems = computed<TimelineItem[]>(() => {
  if (!vacation.value) return [];
  const items: TimelineItem[] = [];

  for (const seg of vacation.value.travelSegments) {
    const date = seg.sortDate ?? seg.departureDate ?? seg.embarkationDate ?? '';
    const copyFields: { label: string; value: string }[] = [];
    if (seg.bookingReference) copyFields.push({ label: 'booking', value: seg.bookingReference });
    if (seg.flightNumber) copyFields.push({ label: 'flight', value: seg.flightNumber });
    if (seg.cabinNumber) copyFields.push({ label: 'cabin', value: seg.cabinNumber });

    items.push({
      id: seg.id,
      kind: 'travel',
      icon: travelIcons[seg.type] ?? '✈️',
      title: seg.title,
      status: seg.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 2,
      copyFields,
      data: seg as unknown as Record<string, unknown>,
    });
  }

  for (const acc of vacation.value.accommodations) {
    const date = acc.checkInDate ?? '';
    const copyFields: { label: string; value: string }[] = [];
    if (acc.confirmationNumber)
      copyFields.push({ label: 'confirmation', value: acc.confirmationNumber });
    if (acc.contactPhone) copyFields.push({ label: 'phone', value: acc.contactPhone });

    items.push({
      id: acc.id,
      kind: 'accommodation',
      icon: accomIcons[acc.type] ?? '🏨',
      title: acc.title,
      status: acc.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 3,
      copyFields,
      data: acc as unknown as Record<string, unknown>,
    });
  }

  for (const trans of vacation.value.transportation) {
    const date = trans.pickupDate ?? '';
    const copyFields: { label: string; value: string }[] = [];
    if (trans.bookingReference)
      copyFields.push({ label: 'booking', value: trans.bookingReference });

    items.push({
      id: trans.id,
      kind: 'transportation',
      icon: transportIcons[trans.type] ?? '🚐',
      title: trans.title,
      status: trans.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 4,
      copyFields,
      data: trans as unknown as Record<string, unknown>,
    });
  }

  items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  return items;
});

const bookedItems = computed(() => timelineItems.value.filter((i) => i.status !== 'not_booked'));
const unbookedItems = computed(() => timelineItems.value.filter((i) => i.status === 'not_booked'));

// Group booked items by date
const groupedByDate = computed(() => {
  const groups: { date: string; label: string; items: TimelineItem[] }[] = [];
  for (const item of bookedItems.value) {
    const existing = groups.find((g) => g.date === item.sortDate);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.push({
        date: item.sortDate,
        label: item.sortDate !== '9999-12-31' ? formatNookDate(item.sortDate) : '',
        items: [item],
      });
    }
  }
  return groups;
});

// Collapsible states
const collapsedCards = ref<Record<string, boolean>>({});
const bucketListOpen = ref(true);

function isCollapsed(id: string): boolean {
  return collapsedCards.value[id] !== false;
}

function setCollapsed(id: string, val: boolean) {
  collapsedCards.value[id] = val;
}

function handleEditInWizard(stepNumber: number) {
  if (vacation.value) emit('edit', vacation.value, stepNumber);
}

function handleVote(ideaId: string) {
  if (!vacation.value || !familyStore.currentMemberId) return;
  vacationStore.toggleIdeaVote(vacation.value.id, ideaId, familyStore.currentMemberId);
}
</script>

<template>
  <BaseModal :open="open" size="2xl" :closable="false" fullscreen-mobile @close="$emit('close')">
    <template v-if="vacation" #header>
      <!-- Custom teal hero header -->
      <div class="vacation-view-hero relative w-full overflow-hidden">
        <div class="relative z-10 flex items-start justify-between">
          <div>
            <span class="text-3xl" style="filter: drop-shadow(0 2px 8px rgb(0 0 0 / 15%))">
              {{ tripEmoji }}
            </span>
            <h3 class="font-outfit mt-2 text-xl font-bold text-white">{{ vacation.name }}</h3>
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white/80"
            @click="$emit('close')"
          >
            ✕
          </button>
        </div>

        <!-- Meta pills -->
        <div class="relative z-10 mt-3 flex flex-wrap items-center gap-2">
          <span
            v-if="dateRange"
            class="font-outfit inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
          >
            📅 {{ dateRange }}
          </span>
          <span
            v-if="duration"
            class="font-outfit inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
          >
            🌴 {{ duration }} {{ t('vacation.days' as any) || 'days' }}
          </span>
          <span
            v-if="countdown !== null && countdown > 0"
            class="font-outfit inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
          >
            ✈️ {{ countdown }} {{ t('vacation.days' as any) || 'days' }}!
          </span>
        </div>

        <!-- Assignee avatars -->
        <div v-if="assignees.length" class="relative z-10 mt-3 flex items-center gap-1">
          <span
            v-for="member in assignees"
            :key="member!.id"
            class="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[rgba(0,180,216,0.6)] text-[9px] font-bold text-white"
            :style="{ backgroundColor: member!.color }"
          >
            {{ member!.name.charAt(0).toUpperCase() }}
          </span>
        </div>

        <!-- Decorative circle -->
        <div
          class="absolute -top-10 -right-10 h-36 w-36 rounded-full"
          style="background: radial-gradient(circle, rgb(255 217 61 / 20%), transparent 70%)"
        />
      </div>
    </template>

    <template v-if="vacation" #default>
      <!-- Progress -->
      <div v-if="progress && progress.total > 0" class="mb-4">
        <div
          class="flex items-center gap-3 rounded-xl border border-[var(--tint-slate-5)] bg-white p-3 dark:bg-slate-800"
        >
          <span class="text-sm">📋</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
            <div
              class="h-full rounded-full transition-all duration-500"
              style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
              :style="{ width: progress.percent + '%' }"
            />
          </div>
          <span
            class="font-outfit text-xs font-semibold whitespace-nowrap text-[var(--vacation-teal)]"
          >
            {{ progress.booked }} {{ t('vacation.progress' as any) }}
          </span>
        </div>
      </div>

      <!-- Accommodation gap warning -->
      <div
        v-if="accommodationGaps.length > 0"
        class="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-[rgba(241,93,34,0.2)] bg-[var(--tint-orange-8)] px-3 py-2.5 dark:bg-orange-900/10"
      >
        <span class="mt-0.5 text-sm">🏨</span>
        <div>
          <span class="font-outfit text-xs font-semibold text-[var(--heritage-orange)]">
            {{ accommodationGaps.length }} {{ t('vacation.nightsNoAccommodation' as any) }}
          </span>
          <span class="block text-[10px] text-[var(--color-text-muted)]">
            {{
              accommodationGaps
                .slice(0, 3)
                .map((d) => formatNookDate(d))
                .join(', ')
            }}{{ accommodationGaps.length > 3 ? '...' : '' }}
          </span>
        </div>
      </div>

      <!-- Timeline header -->
      <div class="mb-3 flex items-center gap-2">
        <div
          class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--vacation-teal-tint)] text-sm"
        >
          📅
        </div>
        <div>
          <div
            class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text)] uppercase dark:text-gray-100"
          >
            {{ t('vacation.timeline' as any) }}
          </div>
          <div class="text-[10px] text-gray-400">{{ t('vacation.timelineSortedBy' as any) }}</div>
        </div>
      </div>

      <!-- Chronological timeline grouped by date -->
      <div class="space-y-2">
        <template v-for="group in groupedByDate" :key="group.date">
          <div
            class="font-outfit mt-1 border-t border-dashed border-[var(--tint-slate-5)] pt-2 text-[10px] font-semibold tracking-wide text-gray-400 uppercase"
          >
            {{ group.label }}
          </div>

          <VacationSegmentCard
            v-for="item in group.items"
            :key="item.id"
            :icon="item.icon"
            :title="item.title"
            :status="item.status"
            :collapsed="isCollapsed(item.id)"
            :read-only="true"
            @update:collapsed="setCollapsed(item.id, $event)"
          >
            <!-- Read-only field rows -->
            <div class="space-y-1">
              <!-- Copyable fields -->
              <div
                v-for="field in item.copyFields"
                :key="field.label"
                class="flex items-center gap-2 py-1"
              >
                <span
                  class="font-outfit min-w-[70px] shrink-0 text-[10px] font-medium text-gray-400"
                >
                  {{ field.label }}
                </span>
                <button
                  class="font-outfit inline-flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--tint-slate-10)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-tint)] dark:bg-slate-700 dark:text-white"
                  @click="copy(field.value)"
                >
                  {{ field.value }}
                  <span class="text-[10px] opacity-30">📋</span>
                </button>
              </div>

              <!-- Address link to Google Maps -->
              <div
                v-if="
                  (item.kind === 'accommodation' && item.data.address) ||
                  (item.kind === 'transportation' && item.data.agencyAddress)
                "
                class="flex items-center gap-2 py-1"
              >
                <span
                  class="font-outfit min-w-[70px] shrink-0 text-[10px] font-medium text-gray-400"
                >
                  {{
                    item.kind === 'accommodation'
                      ? t('vacation.field.address' as any)
                      : t('vacation.field.agencyAddress' as any)
                  }}
                </span>
                <a
                  :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(item.kind === 'accommodation' ? item.data.address : item.data.agencyAddress))}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-outfit inline-flex items-center gap-1 rounded-lg border border-[var(--tint-slate-10)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-tint)] dark:bg-slate-700 dark:text-white"
                  :title="t('vacation.field.openInMaps')"
                >
                  {{ item.kind === 'accommodation' ? item.data.address : item.data.agencyAddress }}
                  <span class="text-[10px] opacity-40">📍</span>
                </a>
              </div>

              <!-- Edit in wizard link -->
              <button
                class="font-outfit mt-1 inline-flex items-center gap-1 rounded-lg bg-[var(--vacation-teal-tint)] px-2.5 py-1 text-[10px] font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-tint-15)]"
                @click="handleEditInWizard(item.stepNumber)"
              >
                ✏️ {{ t('vacation.editInWizard' as any) }}
              </button>
            </div>
          </VacationSegmentCard>
        </template>
      </div>

      <!-- Unbooked items -->
      <div v-if="unbookedItems.length > 0" class="mt-4 space-y-2">
        <div class="font-outfit text-[10px] font-semibold tracking-wide text-[#B8860B] uppercase">
          🤔 {{ t('vacation.stillDeciding' as any) }}
        </div>
        <div
          v-for="item in unbookedItems"
          :key="item.id"
          class="flex items-center gap-2 rounded-xl border border-dashed border-[rgba(184,134,11,0.18)] bg-[var(--vacation-gold-tint)] px-3 py-2.5"
        >
          <span class="text-sm">{{ item.icon }}</span>
          <div class="flex-1">
            <span class="font-outfit text-xs font-semibold text-[#B8860B]">{{ item.title }}</span>
            <small class="block text-[10px] text-[rgba(184,134,11,0.55)]">
              {{ t('vacation.notBookedYet' as any) }}
            </small>
          </div>
          <button
            class="font-outfit text-[10px] font-semibold text-[var(--vacation-teal)]"
            @click="handleEditInWizard(item.stepNumber)"
          >
            ✏️
          </button>
        </div>
      </div>

      <!-- Bucket list -->
      <div v-if="vacation.ideas.length > 0" class="mt-6">
        <button
          class="mb-3 flex w-full items-center gap-2"
          @click="bucketListOpen = !bucketListOpen"
        >
          <div
            class="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--vacation-gold-tint)] text-sm"
          >
            🌟
          </div>
          <span
            class="font-outfit text-xs font-semibold tracking-wide text-[var(--color-text)] uppercase dark:text-gray-100"
          >
            {{ t('vacation.bucketList' as any) }}
          </span>
          <span
            class="ml-auto text-xs text-gray-400 transition-transform"
            :class="{ 'rotate-90': !bucketListOpen }"
          >
            ▸
          </span>
        </button>

        <div v-if="bucketListOpen" class="space-y-2">
          <VacationIdeaCard
            v-for="idea in vacation.ideas"
            :key="idea.id"
            :idea="idea"
            :current-member-id="familyStore.currentMemberId ?? ''"
            :read-only="true"
            @vote="handleVote(idea.id)"
          />
        </div>
      </div>

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
          {{ t('vacation.copied' as any) }}
        </div>
      </Transition>
    </template>

    <template v-if="vacation" #footer>
      <div class="flex w-full">
        <button
          class="font-outfit flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-[var(--tint-slate-10)] bg-white px-4 py-3 text-xs font-semibold text-gray-500 transition-colors hover:border-[var(--vacation-teal)] hover:text-[var(--vacation-teal)] dark:bg-slate-800 dark:text-gray-400"
          @click="emit('edit', vacation!, 1)"
        >
          ✏️ {{ t('vacation.editAll' as any) }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.vacation-view-hero {
  background: linear-gradient(135deg, #00b4d8, #0077b6);
  margin: -1rem -1.5rem;
  padding: 1.375rem 1.5rem 1.125rem;
  position: relative;
}
</style>
