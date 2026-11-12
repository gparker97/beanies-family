<script setup lang="ts">
/**
 * The pill beside a value on a flight card (live flight checks, #143): what the airline's
 * latest answer says about that value. One look per status, each the same pair as the flight's
 * own chip (`FlightCheckChip`), so a value and the chip above it never tell different stories:
 *  - `confirmed`: matches the airline. Green with a tick ("Checked N ago" green).
 *  - `conflict`: the plan and the airline disagree on this value. Dashed orange, exclamation.
 *  - `changed`: the airline moved this value and the plan is not updated here. Orange, arrow.
 *  - `live`: a reading from the airline that is not confirmed (a gate on a flight in
 *    Conflict). Sky Silk, no glyph: information, not a verdict.
 *
 * Shared by the detail rows (`TimelineSegmentCard`) and the departs / arrives band
 * (`SegmentWhenBand`).
 */
import { useTranslation } from '@/composables/useTranslation';
import type { FieldCheck } from '@/utils/flightStatus/copy';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type LivePillStatus = FieldCheck | 'live';

defineProps<{ status: LivePillStatus }>();

const { t } = useTranslation();

const LOOK: Record<LivePillStatus, { cls: string; label: UIStringKey; title?: UIStringKey }> = {
  confirmed: {
    cls: 'border-transparent bg-[var(--tint-success-10)] text-green-800 dark:text-success-lift',
    label: 'travel.live.pill',
    title: 'travel.live.pillConfirmed',
  },
  conflict: {
    cls: 'border-dashed border-primary-500 bg-[var(--tint-orange-8)] text-primary-700 dark:border-accent-lift dark:text-accent-lift',
    label: 'flightChecks.chip.conflict',
    title: 'travel.live.pillConflict',
  },
  changed: {
    cls: 'border-transparent bg-[var(--tint-orange-15)] text-primary-700 dark:text-accent-lift',
    label: 'flightChecks.chip.changed',
    title: 'travel.live.pillChanged',
  },
  live: {
    cls: 'border-transparent bg-[var(--tint-silk-20)] text-secondary-500 dark:text-silk-lift',
    label: 'travel.live.pill',
  },
};

/** The glyph path per status (16x16, stroked): tick, exclamation, arrow. */
const GLYPH: Partial<Record<LivePillStatus, string>> = {
  confirmed: 'M3.5 8.5l3 3 6-7',
  conflict: 'M8 3v6M8 12h.01',
  changed: 'M3 8h10M9 4l4 4-4 4',
};
</script>

<template>
  <span
    class="live-pill font-outfit inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 text-xs font-semibold tracking-normal normal-case"
    :class="LOOK[status].cls"
    :data-status="status"
    :title="LOOK[status].title ? t(LOOK[status].title!) : undefined"
  >
    <svg
      v-if="GLYPH[status]"
      class="h-3 w-3 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path :d="GLYPH[status]" />
    </svg>
    {{ t(LOOK[status].label) }}
    <span v-if="LOOK[status].title" class="sr-only">{{ t(LOOK[status].title!) }}</span>
  </span>
</template>
