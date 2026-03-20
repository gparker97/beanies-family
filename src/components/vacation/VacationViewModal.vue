<script setup lang="ts">
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
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
import { bookingProgress, daysUntilTrip } from '@/utils/vacation';
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
interface DetailRow {
  label: string;
  value: string;
  copyable?: boolean;
  mapLink?: boolean;
}

interface TimelineItem {
  id: string;
  kind: 'travel' | 'accommodation' | 'transportation';
  icon: string;
  title: string;
  keyValue: string;
  status: 'booked' | 'pending' | 'not_booked' | 'researching';
  sortDate: string;
  stepNumber: number;
  detailRows: DetailRow[];
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

function buildTravelKeyValue(seg: {
  type?: string;
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  departureTime?: string;
  cruiseLine?: string;
  shipName?: string;
  operator?: string;
  route?: string;
}): string {
  const p: string[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    if (seg.airline) {
      const code = seg.airline.match(/\(([A-Z0-9]{2})\)/)?.[1] ?? seg.airline.split(' ')[0];
      p.push(seg.flightNumber ? `${code} ${seg.flightNumber}` : code!);
    }
    if (seg.departureAirport && seg.arrivalAirport) {
      const from = seg.departureAirport.match(/\(([A-Z]{3})\)/)?.[1] ?? seg.departureAirport;
      const to = seg.arrivalAirport.match(/\(([A-Z]{3})\)/)?.[1] ?? seg.arrivalAirport;
      p.push(`${from}→${to}`);
    }
    if (seg.departureTime) p.push(seg.departureTime);
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine) p.push(seg.cruiseLine);
    if (seg.shipName) p.push(seg.shipName);
  } else {
    if (seg.operator) p.push(seg.operator);
    if (seg.route) p.push(seg.route);
    if (seg.departureTime) p.push(seg.departureTime);
  }
  return p.join(' · ');
}

/** Build detail rows for a travel segment — only includes populated fields */
function travelDetailRows(seg: import('@/types/models').VacationTravelSegment): DetailRow[] {
  const rows: DetailRow[] = [];
  const isF = seg.type?.startsWith('flight');
  if (isF) {
    if (seg.airline) rows.push({ label: 'airline', value: seg.airline });
    if (seg.flightNumber) rows.push({ label: 'flight #', value: seg.flightNumber, copyable: true });
    if (seg.departureAirport) rows.push({ label: 'from', value: seg.departureAirport });
    if (seg.arrivalAirport) rows.push({ label: 'to', value: seg.arrivalAirport });
    if (seg.departureDate)
      rows.push({
        label: 'departs',
        value: `${formatDateShort(seg.departureDate)}${seg.departureTime ? ' · ' + seg.departureTime : ''}`,
      });
    if (seg.arrivalDate)
      rows.push({
        label: 'arrives',
        value: `${formatDateShort(seg.arrivalDate)}${seg.arrivalTime ? ' · ' + seg.arrivalTime : ''}`,
      });
  } else if (seg.type === 'cruise') {
    if (seg.cruiseLine) rows.push({ label: 'cruise line', value: seg.cruiseLine });
    if (seg.shipName) rows.push({ label: 'ship', value: seg.shipName });
    if (seg.departurePort) rows.push({ label: 'port', value: seg.departurePort });
    if (seg.cabinNumber) rows.push({ label: 'cabin', value: seg.cabinNumber, copyable: true });
    if (seg.embarkationDate)
      rows.push({ label: 'embark', value: formatDateShort(seg.embarkationDate) });
    if (seg.disembarkationDate)
      rows.push({ label: 'disembark', value: formatDateShort(seg.disembarkationDate) });
  } else {
    if (seg.operator) rows.push({ label: 'operator', value: seg.operator });
    if (seg.route) rows.push({ label: 'route', value: seg.route });
    if (seg.departureStation) rows.push({ label: 'from', value: seg.departureStation });
    if (seg.arrivalStation) rows.push({ label: 'to', value: seg.arrivalStation });
    if (seg.departureDate)
      rows.push({
        label: 'departs',
        value: `${formatDateShort(seg.departureDate)}${seg.departureTime ? ' · ' + seg.departureTime : ''}`,
      });
  }
  if (seg.bookingReference)
    rows.push({ label: 'booking ref', value: seg.bookingReference, copyable: true });
  if (seg.notes) rows.push({ label: 'notes', value: seg.notes });
  return rows;
}

const timelineItems = computed<TimelineItem[]>(() => {
  if (!vacation.value) return [];
  const items: TimelineItem[] = [];

  for (const seg of vacation.value.travelSegments) {
    const date = seg.sortDate ?? seg.departureDate ?? seg.embarkationDate ?? '';
    items.push({
      id: seg.id,
      kind: 'travel',
      icon: travelIcons[seg.type] ?? '✈️',
      title: seg.title,
      keyValue: buildTravelKeyValue(seg),
      status: seg.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 2,
      detailRows: travelDetailRows(seg),
    });
  }

  for (const acc of vacation.value.accommodations) {
    const date = acc.checkInDate ?? '';
    const rows: DetailRow[] = [];
    if (acc.name) rows.push({ label: 'name', value: acc.name });
    if (acc.address) rows.push({ label: 'address', value: acc.address, mapLink: true });
    if (acc.checkInDate) rows.push({ label: 'check-in', value: formatDateShort(acc.checkInDate) });
    if (acc.checkOutDate)
      rows.push({ label: 'check-out', value: formatDateShort(acc.checkOutDate) });
    if (acc.roomType) rows.push({ label: 'room', value: acc.roomType });
    if (acc.confirmationNumber)
      rows.push({ label: 'confirmation', value: acc.confirmationNumber, copyable: true });
    if (acc.contactPhone) rows.push({ label: 'phone', value: acc.contactPhone, copyable: true });
    if (acc.breakfastIncluded) rows.push({ label: 'breakfast', value: 'included' });
    if (acc.notes) rows.push({ label: 'notes', value: acc.notes });

    const kvParts: string[] = [];
    if (acc.name) kvParts.push(acc.name);
    if (acc.checkInDate && acc.checkOutDate)
      kvParts.push(
        `${formatDateShort(acc.checkInDate).toLowerCase()} – ${formatDateShort(acc.checkOutDate).toLowerCase()}`
      );
    if (acc.confirmationNumber) kvParts.push(acc.confirmationNumber);

    items.push({
      id: acc.id,
      kind: 'accommodation',
      icon: accomIcons[acc.type] ?? '🏨',
      title: acc.title,
      keyValue: kvParts.join(' · '),
      status: acc.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 3,
      detailRows: rows,
    });
  }

  for (const trans of vacation.value.transportation) {
    const date = trans.pickupDate ?? trans.departureDate ?? '';
    const rows: DetailRow[] = [];
    if (trans.agencyName) rows.push({ label: 'company', value: trans.agencyName });
    if (trans.agencyAddress)
      rows.push({ label: 'address', value: trans.agencyAddress, mapLink: true });
    if (trans.operator) rows.push({ label: 'operator', value: trans.operator });
    if (trans.route) rows.push({ label: 'route', value: trans.route });
    if (trans.departureStation) rows.push({ label: 'from', value: trans.departureStation });
    if (trans.arrivalStation) rows.push({ label: 'to', value: trans.arrivalStation });
    if (trans.pickupDate)
      rows.push({
        label: 'pickup',
        value: `${formatDateShort(trans.pickupDate)}${trans.pickupTime ? ' · ' + trans.pickupTime : ''}`,
      });
    if (trans.returnDate)
      rows.push({
        label: 'return',
        value: `${formatDateShort(trans.returnDate)}${trans.returnTime ? ' · ' + trans.returnTime : ''}`,
      });
    if (trans.departureDate && !trans.pickupDate)
      rows.push({
        label: 'departs',
        value: `${formatDateShort(trans.departureDate)}${trans.departureTime ? ' · ' + trans.departureTime : ''}`,
      });
    if (trans.bookingReference)
      rows.push({ label: 'booking ref', value: trans.bookingReference, copyable: true });
    if (trans.notes) rows.push({ label: 'notes', value: trans.notes });

    const kvParts: string[] = [];
    if (trans.agencyName) kvParts.push(trans.agencyName);
    else if (trans.operator) kvParts.push(trans.operator);
    if (trans.pickupTime) kvParts.push(trans.pickupTime);
    if (trans.bookingReference) kvParts.push(trans.bookingReference);

    items.push({
      id: trans.id,
      kind: 'transportation',
      icon: transportIcons[trans.type] ?? '🚐',
      title: trans.title,
      keyValue: kvParts.join(' · '),
      status: trans.status,
      sortDate: date ? extractDatePart(date) : '9999-12-31',
      stepNumber: 4,
      detailRows: rows,
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
  <BeanieFormModal
    :open="open"
    :title="vacation?.name ?? ''"
    size="wide"
    save-gradient="teal"
    :save-label="t('vacation.editAll' as any)"
    :save-disabled="false"
    custom-header
    @close="$emit('close')"
    @save="vacation && emit('edit', vacation, 1)"
  >
    <!-- Custom teal hero header (fixed, non-scrolling) -->
    <template v-if="vacation" #custom-header>
      <div
        class="relative overflow-hidden rounded-t-3xl px-6 py-4"
        style="background: linear-gradient(135deg, #00b4d8, #0077b6)"
      >
        <div class="relative z-10 flex items-center gap-3">
          <!-- Trip emoji -->
          <div
            class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[14px] bg-white/15 text-xl"
          >
            {{ tripEmoji }}
          </div>
          <!-- Title -->
          <h2 class="font-outfit flex-1 text-lg font-bold text-white">
            {{ vacation.name }}
          </h2>
          <!-- Close button -->
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/15 hover:text-white"
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
            v-if="countdown !== null && countdown > 0"
            class="font-outfit inline-flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
          >
            ✈️ in {{ countdown }} {{ t('vacation.days' as any) || 'days' }}!
          </span>
        </div>

        <!-- Assignee chips -->
        <div
          v-if="assignees.length"
          class="relative z-10 mt-2.5 flex flex-wrap items-center gap-1.5"
        >
          <span
            v-for="member in assignees"
            :key="member!.id"
            class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur"
          >
            <span
              class="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
              :style="{ backgroundColor: member!.color }"
            >
              {{ member!.name.charAt(0).toUpperCase() }}
            </span>
            {{ member!.name }}
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

      <!-- Accommodation gap warning — click to edit accommodation (step 3) -->
      <button
        v-if="accommodationGaps.length > 0"
        class="mb-4 flex w-full cursor-pointer items-start gap-2 rounded-xl border border-dashed border-[rgba(241,93,34,0.2)] bg-[var(--tint-orange-8)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--tint-orange-15)] dark:bg-orange-900/10"
        @click="handleEditInWizard(3)"
      >
        <span class="mt-0.5 text-sm">🏨</span>
        <div class="flex-1">
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
        <span class="mt-0.5 text-xs text-[var(--heritage-orange)] opacity-50">✏️</span>
      </button>

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
            :key-value="item.keyValue"
            :collapsed="isCollapsed(item.id)"
            :read-only="true"
            @update:collapsed="setCollapsed(item.id, $event)"
          >
            <!-- Detail rows — compact 2-column grid showing all populated fields -->
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template v-for="row in item.detailRows" :key="row.label">
                <span
                  class="font-outfit self-center text-[10px] font-medium text-gray-400 dark:text-gray-500"
                >
                  {{ row.label }}
                </span>
                <!-- Copyable value -->
                <button
                  v-if="row.copyable"
                  class="font-outfit inline-flex w-fit cursor-pointer items-center gap-1 self-center rounded-lg border border-[var(--tint-slate-10)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-tint)] dark:bg-slate-700 dark:text-white"
                  @click="copy(row.value)"
                >
                  {{ row.value }}
                  <span class="text-[10px] opacity-30">📋</span>
                </button>
                <!-- Map link -->
                <a
                  v-else-if="row.mapLink"
                  :href="`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.value)}`"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-outfit inline-flex w-fit items-center gap-1 self-center rounded-lg border border-[var(--tint-slate-10)] bg-white px-2 py-0.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--vacation-teal)] hover:bg-[var(--vacation-teal-tint)] dark:bg-slate-700 dark:text-white"
                  :title="t('vacation.field.openInMaps')"
                >
                  {{ row.value }}
                  <span class="text-[10px] opacity-40">📍</span>
                </a>
                <!-- Plain value -->
                <span
                  v-else
                  class="self-center text-xs text-[var(--color-text)] dark:text-gray-200"
                >
                  {{ row.value }}
                </span>
              </template>
            </div>
            <!-- Edit in wizard link -->
            <button
              class="font-outfit mt-2 inline-flex items-center gap-1 rounded-lg bg-[var(--vacation-teal-tint)] px-2.5 py-1 text-[10px] font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-15)]"
              @click="handleEditInWizard(item.stepNumber)"
            >
              ✏️ {{ t('vacation.editInWizard' as any) }}
            </button>
          </VacationSegmentCard>
        </template>
      </div>

      <!-- Unbooked items -->
      <div v-if="unbookedItems.length > 0" class="mt-4 space-y-2">
        <div class="font-outfit text-[10px] font-semibold tracking-wide text-[#B8860B] uppercase">
          🤔 {{ t('vacation.stillDeciding' as any) }}
        </div>
        <button
          v-for="item in unbookedItems"
          :key="item.id"
          class="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[rgba(184,134,11,0.18)] bg-[var(--vacation-gold-tint)] px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,217,61,0.2)]"
          @click="handleEditInWizard(item.stepNumber)"
        >
          <span class="text-sm">{{ item.icon }}</span>
          <div class="flex-1">
            <span class="font-outfit text-xs font-semibold text-[#B8860B]">{{ item.title }}</span>
            <small class="block text-[10px] text-[rgba(184,134,11,0.55)]">
              {{ t('vacation.notBookedYet' as any) }}
            </small>
          </div>
          <span class="text-xs text-[#B8860B] opacity-40">✏️</span>
        </button>
      </div>

      <!-- Bucket list -->
      <div v-if="vacation.ideas.length > 0" class="mt-6">
        <div class="mb-3 flex items-center gap-2">
          <button class="flex flex-1 items-center gap-2" @click="bucketListOpen = !bucketListOpen">
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
            <span class="text-xs text-gray-400">{{ vacation.ideas.length }}</span>
            <span
              class="text-xs text-gray-400 transition-transform"
              :class="{ 'rotate-90': !bucketListOpen }"
            >
              ▸
            </span>
          </button>
          <!-- Edit ideas link -->
          <button
            class="font-outfit inline-flex items-center gap-1 rounded-lg bg-[var(--vacation-teal-tint)] px-2.5 py-1 text-[10px] font-semibold text-[var(--vacation-teal)] transition-colors hover:bg-[var(--vacation-teal-15)]"
            @click="handleEditInWizard(5)"
          >
            ✏️ {{ t('vacation.editInWizard' as any) }}
          </button>
        </div>

        <div v-if="bucketListOpen" class="space-y-2">
          <div
            v-for="idea in vacation.ideas"
            :key="idea.id"
            class="cursor-pointer"
            @click="handleEditInWizard(5)"
          >
            <VacationIdeaCard
              :idea="idea"
              :current-member-id="familyStore.currentMemberId ?? ''"
              :read-only="true"
              @vote="handleVote(idea.id)"
            />
          </div>
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
  </BeanieFormModal>
</template>
