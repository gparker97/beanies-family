<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import {
  tripTypeEmoji,
  bookingProgress,
  daysUntilTrip,
  tripCountdownKey,
  computeAccommodationGaps,
  tripPhase,
  tripDayProgress,
} from '@/utils/vacation';
import { formatDateShort } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import NookSectionCard from './NookSectionCard.vue';

const router = useRouter();
const vacationStore = useVacationStore();
const { t } = useTranslation();
const { today } = useToday();

const vacation = computed(() => vacationStore.upcomingVacations[0]);

const progress = computed(() => (vacation.value ? bookingProgress(vacation.value) : null));
const gapCount = computed(() =>
  vacation.value ? computeAccommodationGaps(vacation.value).length : 0
);

const phase = computed(() =>
  vacation.value ? tripPhase(vacation.value, today.value) : 'upcoming'
);

/**
 * Single source of truth for the card's badge, so exactly one badge (or none)
 * renders by construction — no parallel phase-gated `v-if`s to keep in sync.
 *  - 'countdown': the upcoming hero badge (big day count + trip-type label)
 *  - 'status':    a calmer pill for a trip happening today / in progress
 */
type BadgeView =
  | { kind: 'countdown'; n: number; labelKey: string; emoji: string }
  | { kind: 'status'; text: string }
  | null;

const badge = computed<BadgeView>(() => {
  const v = vacation.value;
  if (!v) return null;

  if (phase.value === 'upcoming') {
    const n = v.startDate ? daysUntilTrip(v.startDate) : null;
    if (n === null || n <= 0) return null; // preserves the existing hero-badge gate
    return {
      kind: 'countdown',
      n,
      labelKey: tripCountdownKey(v.tripType, v.tripPurpose),
      emoji: tripTypeEmoji(v.tripType, v.tripPurpose),
    };
  }

  if (phase.value === 'today') {
    return { kind: 'status', text: t('vacation.startsToday') };
  }

  if (phase.value === 'ongoing') {
    const prog = tripDayProgress(v, today.value);
    const text = prog
      ? t('vacation.dayOfTrip')
          .replace('{n}', String(prog.day))
          .replace('{total}', String(prog.total))
      : t('vacation.onNow'); // graceful fallback — never a blank/NaN badge
    return { kind: 'status', text };
  }

  return null; // 'past' never reaches the nook, but the branch is total
});

const dateRange = computed(() => {
  const v = vacation.value;
  if (!v?.startDate) return '';
  const start = formatDateShort(v.startDate);
  const end = v.endDate ? formatDateShort(v.endDate) : '';
  return end ? `${start} – ${end}` : start;
});

function handleClick() {
  if (vacation.value) {
    router.push({ path: '/travel', query: { vacation: vacation.value.id } });
  }
}
</script>

<template>
  <NookSectionCard
    v-if="vacation"
    class="nook-vacation-tint cursor-pointer"
    :title="phase === 'upcoming' ? t('vacation.upcoming') : t('vacation.happeningNow')"
    border-color="#00B4D8"
    @click="handleClick"
  >
    <!-- Row 1: Trip name + emoji + date -->
    <div class="flex items-center gap-2.5">
      <span class="text-xl">{{ tripTypeEmoji(vacation.tripType, vacation.tripPurpose) }}</span>
      <div class="min-w-0 flex-1">
        <div class="font-outfit text-sm font-bold text-gray-900 dark:text-gray-100">
          {{ vacation.name }}
        </div>
        <div class="font-outfit mt-0.5 text-xs text-gray-400">📅 {{ dateRange }}</div>
      </div>
    </div>

    <!-- Row 2: Booking progress -->
    <div v-if="progress && progress.total > 0" class="mt-3 flex items-center gap-2.5">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(0,180,216,0.1)]">
        <div
          class="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6]"
          :style="{ width: progress.percent + '%' }"
        />
      </div>
      <span class="font-outfit text-[0.625rem] font-semibold whitespace-nowrap text-[#00B4D8]">
        {{
          t('vacation.bookedCount')
            .replace('{n}', String(progress.booked))
            .replace('{total}', String(progress.total))
        }}
      </span>
    </div>

    <!-- Accommodation gap warning -->
    <div v-if="gapCount > 0" class="mt-2">
      <span
        class="font-outfit inline-flex items-center gap-1 rounded-full bg-[var(--tint-orange-8)] px-2.5 py-0.5 text-[0.5625rem] font-semibold text-[var(--heritage-orange)]"
      >
        🏨
        {{
          (gapCount === 1
            ? t('vacation.nightsUnaccommodated.one')
            : t('vacation.nightsUnaccommodated.other')
          ).replace('{n}', String(gapCount))
        }}
      </span>
    </div>

    <!-- Row 3: Countdown hero badge (upcoming) -->
    <div
      v-if="badge?.kind === 'countdown'"
      class="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] px-4 py-2 shadow-[0_4px_12px_rgba(0,180,216,0.2)]"
    >
      <span class="font-outfit text-lg leading-none font-extrabold text-white">
        {{ badge.n }}
      </span>
      <span class="font-outfit text-[0.6875rem] font-semibold text-white/80">
        {{ t(badge.labelKey as any) }}! {{ badge.emoji }}
      </span>
    </div>

    <!-- Row 3: Status pill (happening today / in progress) -->
    <div
      v-else-if="badge?.kind === 'status'"
      class="font-outfit mt-3 inline-flex items-center gap-1 rounded-full bg-[rgba(0,180,216,0.1)] px-3 py-1 text-xs font-semibold text-[#0077B6]"
    >
      {{ badge.text }}
    </div>
  </NookSectionCard>
</template>

<style scoped>
/* Vue scoped styles get a [data-v] specificity boost (0,2,0) over Tailwind's
 * `bg-white` utility (0,1,0) on the wrapped NookSectionCard root, so no
 * !important needed. If specificity ever stops being sufficient, prefer
 * reinstating !important here over restructuring the wrapper component. */
.nook-vacation-tint {
  background: linear-gradient(180deg, rgb(0 180 216 / 6%), rgb(0 180 216 / 14%));
}

:global(.dark) .nook-vacation-tint {
  background: linear-gradient(180deg, rgb(0 180 216 / 8%), rgb(0 180 216 / 18%));
}
</style>
