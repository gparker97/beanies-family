<script setup lang="ts">
/**
 * Live flight checks (#143): the desktop rail's "Live checks" card for one trip. Lists every
 * flight with its chip, when this device last heard from an airline about any of them, and one
 * line saying what is and is not checked, so a parent can see at a glance that every flight is
 * accounted for. Presentational: the page resolves the rows from `flightStatusStore`.
 */
import { computed } from 'vue';
import FlightCheckChip from '@/components/travel/FlightCheckChip.vue';
import type { FlightVerification } from '@/types/flightStatus';
import { useTranslation } from '@/composables/useTranslation';
import { agoText, shortDate } from '@/utils/flightStatus/copy';

interface LiveCheckRow {
  id: string;
  /** "SQ318" */
  label: string;
  departureDate?: string;
  verification: FlightVerification;
}

const props = defineProps<{ rows: LiveCheckRow[]; nowMs: number }>();

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

function rowLabel(r: LiveCheckRow): string {
  const date = shortDate(r.departureDate, currentLanguage?.value);
  return date ? `${r.label} · ${date}` : r.label;
}
</script>

<template>
  <section
    class="dark:border-line dark:bg-surface-raised rounded-3xl border border-[var(--tint-slate-10)] bg-white p-4 shadow-[var(--card-shadow)]"
    :aria-label="t('travel.live.railTitle')"
  >
    <h3 class="font-outfit text-secondary-500 dark:text-ink text-base font-semibold">
      {{ t('travel.live.railTitle') }}
    </h3>
    <ul class="dark:divide-line mt-2 divide-y divide-[var(--tint-slate-10)]">
      <li
        v-for="r in rows"
        :key="r.id"
        class="flex items-center justify-between gap-3 py-2 text-sm"
        data-testid="live-check-row"
      >
        <span class="text-secondary-500 dark:text-ink min-w-0 truncate">{{ rowLabel(r) }}</span>
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
