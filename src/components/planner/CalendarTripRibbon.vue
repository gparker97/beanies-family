<script setup lang="ts">
/**
 * Slim, collapsible "coming up" trip ribbon for the calendar command bar.
 *
 * Reads `vacationStore.upcomingVacations` (already sorted soonest-first and
 * already filtered to non-ended trips) and renders each as a countdown pill.
 * The big VacationSidebarCard is gone from the page body — the rich detail
 * lives on tap-through to the trip on `/travel` (the page maps our
 * `vacation-click` to its existing handler).
 *
 * Countdown copy branches on the signed day-delta, because `upcomingVacations`
 * deliberately KEEPS in-progress trips (it filters on endDate ≥ today), so
 * `daysUntilTrip` goes 0 on the start day and negative once underway:
 *   > 0 → "{n}d" · 0 → "today" · < 0 → "now"   (never a bare "−2d")
 *
 * Desktop: a labelled row of pills with a Hide/Show toggle (persisted
 * device-local). Mobile: a single summary pill ("✈️ 2 trips · Phuket · 12d")
 * that expands the pill list inline. Renders nothing when there are no trips.
 */
import { computed, ref } from 'vue';
import { useVacationStore } from '@/stores/vacationStore';
import { useTranslation } from '@/composables/useTranslation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { tripTypeEmoji, daysUntilTrip, tripCountdownKey, isValidISODate } from '@/utils/vacation';
import { extractDatePart } from '@/utils/date';
import type { FamilyVacation } from '@/types/models';

defineProps<{
  /**
   * Compact single-chip mode for the planner command bar's controls row (mobile
   * reclaim). Renders just a tappable "✈️ {countdown} ›" chip for the soonest
   * trip (tap → open it on /travel, where the rest are reachable) instead of the
   * summary-pill / labelled-row layouts. Independent of the breakpoint so it
   * works wherever the command bar places it.
   */
  inline?: boolean;
}>();

const emit = defineEmits<{ 'vacation-click': [id: string] }>();

const { t } = useTranslation();
const { isMobile } = useBreakpoint();
const vacationStore = useVacationStore();

// ── Persisted collapse (device-local, guarded — mirrors useTodoSort) ──────────
const STORAGE_KEY = 'beanies:tripRibbonCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch (err) {
    console.warn('[CalendarTripRibbon] could not read collapse preference:', err);
    return false;
  }
}
function writeCollapsed(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch (err) {
    console.warn('[CalendarTripRibbon] could not persist collapse preference:', err);
  }
}

const collapsed = ref(readCollapsed());
const mobileExpanded = ref(false); // session-only; mobile starts as the summary pill

interface TripPill {
  id: string;
  emoji: string;
  name: string;
  countdownText: string;
  ariaCountdown: string;
}

function buildPill(v: FamilyVacation): TripPill | null {
  // Only trips with a real start date can show a countdown — never NaN.
  if (!v.startDate || !isValidISODate(extractDatePart(v.startDate))) return null;
  const days = daysUntilTrip(v.startDate);

  let countdownText: string;
  let ariaCountdown: string;
  if (days > 0) {
    countdownText = t('vacation.inDays').replace('{n}', String(days));
    ariaCountdown = `${days} ${t(tripCountdownKey(v.tripType, v.tripPurpose) as any)}`;
  } else if (days === 0) {
    countdownText = t('planner.today');
    ariaCountdown = t('planner.today');
  } else {
    countdownText = t('vacation.onNow');
    ariaCountdown = t('vacation.onNow');
  }

  return {
    id: v.id,
    emoji: tripTypeEmoji(v.tripType, v.tripPurpose),
    name: v.name,
    countdownText,
    ariaCountdown,
  };
}

const pills = computed<TripPill[]>(() =>
  vacationStore.upcomingVacations.map(buildPill).filter((p): p is TripPill => p !== null)
);

const hasTrips = computed(() => pills.value.length > 0);
const soonest = computed<TripPill | null>(() => pills.value[0] ?? null);
const tripsCountLabel = computed(() =>
  pills.value.length === 1
    ? t('planner.tripsOne')
    : t('planner.tripsMany').replace('{n}', String(pills.value.length))
);

// Whether the pill list is visible (vs. collapsed / summary).
const showPills = computed(() => (isMobile.value ? mobileExpanded.value : !collapsed.value));

function onToggle(): void {
  if (isMobile.value) {
    mobileExpanded.value = false; // collapse back to the summary pill
  } else {
    collapsed.value = !collapsed.value;
    writeCollapsed(collapsed.value);
  }
}

const toggleAria = computed(() =>
  isMobile.value || !collapsed.value ? t('planner.tripRibbonHide') : t('planner.tripRibbonShow')
);
</script>

<template>
  <div v-if="hasTrips" class="font-inter">
    <!-- Inline chip (planner command-bar controls row): the soonest trip's
         countdown as a single tappable chip; tap opens it on /travel. -->
    <button
      v-if="inline"
      type="button"
      class="dark:border-line-strong flex flex-shrink-0 items-center gap-1.5 rounded-full border border-[var(--vacation-teal-15)] py-1.5 pr-2 pl-2.5 transition-colors hover:border-[var(--vacation-teal)]"
      style="background: linear-gradient(135deg, rgb(0 180 216 / 6%), rgb(255 217 61 / 5%))"
      :aria-label="
        soonest ? `${soonest.name}, ${soonest.ariaCountdown}` : t('planner.tripRibbonShow')
      "
      @click="soonest && emit('vacation-click', soonest.id)"
    >
      <span aria-hidden="true" class="text-sm leading-none">✈️</span>
      <span v-if="soonest" class="font-outfit text-secondary-500 dark:text-ink text-xs font-bold">{{
        soonest.countdownText
      }}</span>
      <span aria-hidden="true" class="text-xs font-bold text-[var(--vacation-teal)]">&rsaquo;</span>
    </button>

    <!-- Mobile, collapsed: a single tappable summary pill -->
    <button
      v-else-if="isMobile && !mobileExpanded"
      type="button"
      class="dark:border-line-strong flex w-full items-center gap-2 rounded-full border border-[var(--vacation-teal-15)] px-3 py-2 text-left transition-colors hover:border-[var(--vacation-teal)]"
      style="background: linear-gradient(135deg, rgb(0 180 216 / 6%), rgb(255 217 61 / 5%))"
      :aria-label="t('planner.tripRibbonShow')"
      @click="mobileExpanded = true"
    >
      <span aria-hidden="true" class="text-sm">✈️</span>
      <span class="font-outfit text-secondary-500 dark:text-ink text-sm font-bold">{{
        tripsCountLabel
      }}</span>
      <span
        v-if="soonest"
        class="text-secondary-500/70 dark:text-ink-soft truncate text-xs font-medium"
      >
        · {{ soonest.name }} · {{ soonest.countdownText }}
      </span>
      <span aria-hidden="true" class="ml-auto text-sm font-bold text-[var(--vacation-teal)]"
        >&rsaquo;</span
      >
    </button>

    <!-- Expanded (mobile) or the standard desktop row -->
    <div v-else class="flex w-full min-w-0 items-center gap-3">
      <span
        class="font-outfit text-secondary-500/60 dark:text-ink-soft flex flex-shrink-0 items-center gap-1.5 text-xs font-bold tracking-[0.06em] uppercase"
      >
        <span aria-hidden="true">✈️</span>{{ t('planner.tripRibbonLabel') }}
      </span>

      <div v-if="showPills" class="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
        <button
          v-for="p in pills"
          :key="p.id"
          type="button"
          class="group dark:border-line-strong flex flex-shrink-0 items-center gap-2 rounded-full border border-[var(--vacation-teal-15)] py-1 pr-1.5 pl-3 transition-all hover:-translate-y-px hover:border-[var(--vacation-teal)] hover:shadow-sm"
          style="background: linear-gradient(135deg, rgb(0 180 216 / 6%), rgb(255 217 61 / 5%))"
          :aria-label="`${p.name}, ${p.ariaCountdown}`"
          @click="emit('vacation-click', p.id)"
        >
          <span aria-hidden="true" class="text-sm leading-none">{{ p.emoji }}</span>
          <span class="font-outfit text-secondary-500 dark:text-ink text-sm font-semibold">{{
            p.name
          }}</span>
          <span
            class="font-outfit rounded-full px-2 py-0.5 text-xs font-bold text-white"
            style="background: linear-gradient(135deg, var(--vacation-teal), #0096c7)"
            >{{ p.countdownText }}</span
          >
        </button>
      </div>
      <div v-else class="flex-1" />

      <button
        type="button"
        class="font-outfit text-secondary-500/50 hover:text-secondary-500 hover:bg-secondary-500/5 dark:text-ink-faint dark:hover:text-ink-soft flex-shrink-0 rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
        :aria-label="toggleAria"
        @click="onToggle"
      >
        <template v-if="isMobile">&#x25B4;</template>
        <template v-else
          >{{ collapsed ? t('planner.tripRibbonShow') : t('planner.tripRibbonHide') }}
          {{ collapsed ? '&#x25BE;' : '&#x25B4;' }}</template
        >
      </button>
    </div>
  </div>
</template>
