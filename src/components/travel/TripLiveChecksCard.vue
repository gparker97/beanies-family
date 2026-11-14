<script setup lang="ts">
/**
 * Live flight checks (#143): the desktop rail's "Live checks" card for one trip. Lists every
 * flight with its chip, when this device last heard from an airline about any of them, and one
 * line saying what is and is not checked, so a parent can see at a glance that every flight is
 * accounted for, plus a quiet "Check now" link that reads "Checking..." while a request for one
 * of them is in flight. Presentational: the page resolves the rows from `flightStatusStore` and
 * owns the tap.
 */
import { computed } from 'vue';
import FlightCheckChip from '@/components/travel/FlightCheckChip.vue';
import FlightTrackLink from '@/components/travel/FlightTrackLink.vue';
import type { FlightVerification } from '@/types/flightStatus';
import { useTranslation } from '@/composables/useTranslation';
import { agoText, shortDate } from '@/utils/flightStatus/copy';

interface LiveCheckRow {
  id: string;
  /** "SQ318" */
  label: string;
  departureDate?: string;
  verification: FlightVerification;
  /** The flight's FlightAware page while it is worth following, else null (plain label). */
  trackUrl?: string | null;
}

const props = defineProps<{
  rows: LiveCheckRow[];
  nowMs: number;
  /** A request for one of this trip's flights is in flight: the link reads "Checking...". */
  checking?: boolean;
}>();

const emit = defineEmits<{
  /** "Check now": ask the airline again about this trip's flights. The store decides whether
   *  anything is due (five-minute floor per flight); the page tells the person when not. */
  'check-now': [];
}>();

const { t, currentLanguage } = useTranslation();

/** The newest check among THIS trip's flights (not the device's newest of any trip). */
const lastCheckedAt = computed<number | null>(() => {
  let latest: number | null = null;
  for (const r of props.rows) {
    const at = r.verification.checkedAt;
    if (at !== undefined && (latest === null || at > latest)) latest = at;
  }
  return latest;
});

/** " · 13 Dec" after the flight label, or nothing without a date. */
function rowDateSuffix(r: LiveCheckRow): string {
  const date = shortDate(r.departureDate, currentLanguage?.value);
  return date ? ` · ${date}` : '';
}
</script>

<template>
  <section
    class="dark:border-line dark:bg-surface-raised rounded-3xl border border-[var(--tint-slate-10)] bg-white p-4 shadow-[var(--card-shadow)]"
    :aria-label="t('travel.live.railTitle')"
  >
    <div class="flex items-center justify-between gap-3">
      <h3 class="font-outfit text-secondary-500 dark:text-ink text-base font-semibold">
        {{ t('travel.live.railTitle') }}
      </h3>
      <button
        type="button"
        class="font-outfit text-primary-700 dark:text-accent-lift focus-visible:ring-primary-500 disabled:text-secondary-400 dark:disabled:text-ink-faint inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold hover:bg-[var(--tint-orange-8)] focus:outline-none focus-visible:ring-2 disabled:cursor-default disabled:hover:bg-transparent"
        data-testid="live-check-now"
        :disabled="checking"
        :aria-busy="checking"
        @click="emit('check-now')"
      >
        <svg
          class="h-3.5 w-3.5 shrink-0"
          :class="{ 'animate-spin': checking }"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v2.6h-2.6" />
        </svg>
        <span aria-live="polite">{{
          checking ? t('travel.live.checking') : t('travel.live.checkNow')
        }}</span>
      </button>
    </div>
    <ul class="dark:divide-line mt-2 divide-y divide-[var(--tint-slate-10)]">
      <li
        v-for="r in rows"
        :key="r.id"
        class="flex items-center justify-between gap-3 py-2 text-sm"
        data-testid="live-check-row"
      >
        <span class="text-secondary-500 dark:text-ink min-w-0 truncate"
          ><FlightTrackLink :label="r.label" :href="r.trackUrl" />{{ rowDateSuffix(r) }}</span
        >
        <FlightCheckChip :verification="r.verification" :now-ms="nowMs" compact />
      </li>
      <li
        v-if="lastCheckedAt !== null"
        class="flex items-center justify-between gap-3 py-2 text-sm"
      >
        <span class="text-secondary-400 dark:text-ink-soft">{{
          t('travel.live.railLastCheck')
        }}</span>
        <span class="font-outfit text-secondary-500 dark:text-ink font-semibold">{{
          agoText(t, lastCheckedAt, nowMs)
        }}</span>
      </li>
    </ul>
    <p class="text-secondary-400 dark:text-ink-faint mt-2 text-xs">
      {{ t('travel.live.railNote') }}
    </p>
  </section>
</template>
