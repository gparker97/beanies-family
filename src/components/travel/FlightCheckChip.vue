<script setup lang="ts">
/**
 * Live flight checks (#143): the one chip that answers "can I trust this time?" for a flight.
 *
 * Six states, from `flightStatusStore.verificationFor(id)` (the page passes it in; this stays
 * presentational): green only when a live record agrees with the plan; Heritage Orange for a
 * change or a Conflict (a moved flight is routine, never red); red ONLY for a cancellation;
 * grey when the check could not run; a dashed outline for "Not checked live". The label is
 * `chipLabel` (utils/flightStatus/copy.ts), so the chip says what the briefing and bell say.
 * A flight that is over carries no chip (`hasFlightChip`): this renders nothing for it.
 *
 * Display-only provider statuses (`CanceledUncertain` → "May be cancelled", `Diverted`) ride on
 * a `verified` verification; they are painted orange with the alert glyph, never green.
 *
 * Colour pairs are the plan's Dark Mode Coverage, every accent with its `-lift` partner. The
 * dark-only ink tokens (`ink-soft`, `ink-faint`) take a Deep Slate light partner.
 *
 * LIGHT-mode label inks are one step deeper than the brand swatch, measured on the chip's own
 * tint over a white card: `primary-500` read 2.78 on `--tint-orange-15` (`primary-700` 4.87,
 * 5.29 on `--tint-orange-8`), and `green-700` 4.48 on `--tint-success-10` (`green-800` 6.42).
 * The dashed Conflict EDGE stays `primary-500`: a border is not text. Dark is unchanged.
 */
import { computed } from 'vue';
import type { FlightVerification } from '@/types/flightStatus';
import { useTranslation } from '@/composables/useTranslation';
import { chipLabel } from '@/utils/flightStatus/copy';

const props = defineProps<{
  verification: FlightVerification;
  /** The clock "Checked 12 min ago" is measured against (`flightStatusStore.nowMs`). */
  nowMs: number;
  /** Tighter padding for dense rows (the wall, the desktop rail). */
  compact?: boolean;
}>();

const { t, currentLanguage } = useTranslation();

/** The pulse runs while a check is fresh (under an hour), then the dot sits still. */
const FRESH_MS = 60 * 60 * 1000;

type Look =
  'verified' | 'alert' | 'changed' | 'conflict' | 'cancelled' | 'unavailable' | 'not-live';

const look = computed<Look>(() => {
  const v = props.verification;
  if (v.state === 'verified') {
    const s = v.live?.status;
    return s === 'CanceledUncertain' || s === 'Diverted' ? 'alert' : 'verified';
  }
  return v.state;
});

const LOOK_CLASS: Record<Look, string> = {
  verified: 'border-transparent bg-[var(--tint-success-10)] text-green-800 dark:text-success-lift',
  alert: 'border-transparent bg-[var(--tint-orange-15)] text-primary-700 dark:text-accent-lift',
  changed: 'border-transparent bg-[var(--tint-orange-15)] text-primary-700 dark:text-accent-lift',
  conflict:
    'border-dashed border-primary-500 bg-[var(--tint-orange-8)] text-primary-700 dark:border-accent-lift dark:text-accent-lift',
  cancelled: 'border-transparent bg-[var(--tint-danger-10)] text-red-700 dark:text-danger-lift',
  unavailable: 'border-transparent bg-[var(--tint-slate-10)] text-secondary-400 dark:text-ink-soft',
  'not-live':
    'border-dashed border-[var(--color-border-strong)] bg-transparent text-secondary-400 dark:text-ink-faint',
};

const label = computed(() => chipLabel(t, props.verification, props.nowMs, currentLanguage?.value));

const fresh = computed(
  () =>
    props.verification.checkedAt !== undefined &&
    props.nowMs - props.verification.checkedAt < FRESH_MS
);
</script>

<template>
  <span
    v-if="label !== null"
    class="font-outfit inline-flex max-w-full min-w-0 shrink-0 items-center rounded-full border text-xs leading-tight font-semibold whitespace-nowrap"
    :class="[LOOK_CLASS[look], compact ? 'gap-1 px-2 py-px' : 'gap-1.5 px-2.5 py-0.5']"
    :data-state="verification.state"
  >
    <span
      v-if="look === 'verified'"
      class="inline-block h-2 w-2 shrink-0 rounded-full bg-current"
      :class="{ 'live-dot': fresh }"
      aria-hidden="true"
    />
    <!-- Changed: an arrow ("it moved") -->
    <svg
      v-else-if="look === 'changed'"
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
    <!-- Conflict / may be cancelled / diverted: an exclamation -->
    <svg
      v-else-if="look === 'conflict' || look === 'alert'"
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v6M8 12h.01" />
    </svg>
    <!-- Cancelled: a cross -->
    <svg
      v-else-if="look === 'cancelled'"
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
    <!-- Couldn't check / checks from: a circled exclamation -->
    <svg
      v-else-if="look === 'unavailable'"
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h.01" />
    </svg>
    <span class="min-w-0 truncate">{{ label }}</span>
  </span>
</template>
