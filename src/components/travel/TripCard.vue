<script setup lang="ts">
/**
 * One upcoming trip in the list.
 *
 * Extracted from TravelPlansPage, where it was ~110 lines of inline template. Two things
 * came out better than a straight move:
 *
 *  • PERFORMANCE. The inline version called `vacationProgress(vacation)` EIGHT times and
 *    `computeAccommodationGaps(vacation)` THREE times per card per render — each walking
 *    every night of the trip — because a template expression cannot memoize. They are
 *    computeds here, so each runs once per trip and only when the trip changes.
 *
 *  • i18n. The night/nights plural was a hardcoded English ternary inside a template
 *    EXPRESSION, where the CI-blocking bare-string rule cannot see it. It now uses the
 *    explicit `.one`/`.other` key pair the project's pluralization convention specifies.
 *
 * Presentational: it renders a trip and emits `open`. No store writes, no navigation.
 */
import { computed } from 'vue';
import TripBadgeChip from '@/components/vacation/TripBadgeChip.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFamilyStore } from '@/stores/familyStore';
import { bookingProgress, computeAccommodationGaps, tripTypeEmoji } from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import type { FamilyVacation } from '@/types/models';
import type { TripBadge } from '@/utils/vacation';

const props = defineProps<{
  vacation: FamilyVacation;
  badge: TripBadge | null;
}>();

const emit = defineEmits<{ open: [] }>();

const { t } = useTranslation();
const familyStore = useFamilyStore();

const progress = computed(() => bookingProgress(props.vacation));
const gaps = computed(() => computeAccommodationGaps(props.vacation));
const unbooked = computed(() => progress.value.total - progress.value.booked);

const dateRange = computed(() => {
  const v = props.vacation;
  if (!v.startDate) return '';
  const start = formatDateShort(v.startDate);
  const end = v.endDate ? formatDateShort(v.endDate) : '';
  return end ? `${start} – ${end}` : start;
});

const assignees = computed(
  () =>
    (props.vacation.assigneeIds ?? [])
      .map((id) => familyStore.members.find((m) => m.id === id))
      .filter(Boolean) as Array<{ id: string; name: string; color: string }>
);

const openIdeas = computed(
  () => props.vacation.ideas.filter((i) => !i.isPlanned && !i.isSkipped).length
);

const bookedLabel = computed(() =>
  fillTemplate(t('travel.bookedShort'), {
    booked: String(progress.value.booked),
    total: String(progress.value.total),
  })
);

const gapLabel = computed(() =>
  fillTemplate(t(gaps.value.length === 1 ? 'travel.gapNights.one' : 'travel.gapNights.other'), {
    count: String(gaps.value.length),
  })
);
</script>

<template>
  <div
    class="focus-visible:ring-primary-500 dark:bg-surface-raised cursor-pointer overflow-hidden rounded-3xl border-[1.5px] border-[var(--tint-slate-5)] bg-white shadow-[var(--card-shadow)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(0,180,216,0.2)] hover:shadow-[0_6px_24px_rgba(0,180,216,0.08)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    role="button"
    tabindex="0"
    :aria-label="fillTemplate(t('travel.openTrip'), { name: vacation.name })"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
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

    <div class="p-4">
      <h3 class="font-outfit dark:text-ink text-base font-bold text-gray-900">
        {{ vacation.name }}
      </h3>
      <div
        v-if="dateRange"
        class="font-outfit mt-1 flex items-center gap-1.5 text-xs text-gray-400"
      >
        📅 {{ dateRange }}
      </div>

      <div class="mt-2.5 flex flex-wrap items-center gap-2">
        <TripBadgeChip :badge="badge" variant="card" />
      </div>

      <div v-if="assignees.length" class="mt-2 flex flex-wrap gap-1.5">
        <span
          v-for="member in assignees"
          :key="member.id"
          class="font-outfit dark:bg-surface-overlay dark:text-ink-soft inline-flex items-center gap-1 rounded-full bg-[var(--tint-slate-5)] px-2.5 py-0.5 text-[0.6875rem] font-medium text-gray-600"
        >
          <span
            class="flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{ backgroundColor: member.color }"
          >
            {{ member.name.charAt(0).toUpperCase() }}
          </span>
          {{ member.name }}
        </span>
      </div>

      <div v-if="progress.total > 0" class="mt-3 flex items-center gap-2">
        <div class="h-[5px] flex-1 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
          <div
            class="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6]"
            :style="{ width: progress.percent + '%' }"
          />
        </div>
        <span class="font-outfit text-[0.625rem] font-semibold whitespace-nowrap text-[#00B4D8]">
          {{ bookedLabel }}
        </span>
      </div>

      <div v-if="unbooked > 0" class="mt-1.5">
        <span
          class="font-outfit inline-flex items-center gap-1 rounded-full bg-[rgba(255,217,61,0.12)] px-2.5 py-0.5 text-xs font-semibold text-[#B8860B]"
        >
          ⏳ {{ unbooked }} {{ t('travel.needsBooking').toLowerCase() }}
        </span>
      </div>

      <div v-if="openIdeas > 0" class="mt-1.5">
        <span
          class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--vacation-teal-15)] px-2.5 py-0.5 text-xs font-semibold text-[var(--vacation-teal)]"
        >
          💡 {{ openIdeas }} {{ t('travel.openIdeas') }}
        </span>
      </div>

      <div v-if="gaps.length > 0" class="mt-1.5">
        <span
          class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-8)] px-2.5 py-0.5 text-xs font-semibold text-[var(--heritage-orange)]"
        >
          🏨 {{ gapLabel }} {{ t('travel.accommodationGap').toLowerCase() }}
        </span>
      </div>
    </div>
  </div>
</template>
