<script setup lang="ts">
/**
 * A flight number that, around the day of travel, opens the flight's FlightAware page so the
 * traveller and the family watching can follow it live.
 *
 * Presentational: the caller resolves `href` (`flightStatusStore.trackUrlFor`, which applies the
 * window rule in `utils/flightStatus/flightAware.ts`). With no `href` the number renders as plain
 * text, inheriting the caller's text style exactly as before. With one it is a real anchor (so
 * keyboard, screen readers and long-press "open in new tab" all work), coloured as an accent
 * with its dark `-lift` partner.
 *
 * The tap goes through `openExternal`, the app's one cross-origin opener (system browser from
 * an installed PWA or the native shell). If that throws, the default is NOT prevented and the
 * anchor's own `href` / `target` opens the page instead, so a failure is logged, never a dead tap.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { openExternal } from '@/utils/openExternal';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

const props = defineProps<{
  /** The flight number as the card shows it ("SQ 321"). */
  label: string;
  /** The FlightAware page, or null/undefined outside the tracking window (plain text). */
  href?: string | null;
}>();

const SURFACE = 'flight-track-link';

const { t } = useTranslation();

const accessibleName = computed(() =>
  fillTemplate(t('travel.flightTrack.ariaLabel'), { flight: props.label })
);

function onClick(event: MouseEvent): void {
  if (!props.href) return;
  // Only the fact of the tap: never the flight number, route or date.
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'flight track link opened',
    context: { action: 'open', kind: 'flightaware' },
  });
  try {
    openExternal(props.href);
    event.preventDefault();
  } catch (error) {
    // Default not prevented: the anchor itself opens the page in a new tab.
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: 'flight track link: openExternal threw, falling back to the anchor',
      error,
      context: { action: 'open-fallback', kind: 'flightaware' },
    });
  }
}
</script>

<template>
  <a
    v-if="href"
    :href="href"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="accessibleName"
    :title="accessibleName"
    class="flight-track-link text-primary-700 dark:text-accent-lift focus-visible:ring-primary-500 dark:focus-visible:ring-accent-lift relative inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus:outline-none focus-visible:underline focus-visible:ring-2"
    data-testid="flight-track-link"
    @click="onClick"
  >
    <span>{{ label }}</span>
    <svg
      class="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"
      />
    </svg>
  </a>
  <span v-else data-testid="flight-track-plain">{{ label }}</span>
</template>

<style scoped>
/* A 44px tap target on touch screens without growing the row: an invisible hit area around the
   inline link. Fine pointers keep the text-sized target. */
@media (pointer: coarse) {
  .flight-track-link::before {
    content: '';
    inset: -0.75rem -0.5rem;
    position: absolute;
  }
}
</style>
