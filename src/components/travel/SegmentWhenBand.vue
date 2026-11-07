<script setup lang="ts">
/**
 * "When" hero band shown at the top of an expanded travel-segment card. Leads
 * with the segment's date/time — the info you scan for first — as one cell
 * ("starts") or two ("departs → arrives" / "check-in → check-out" etc). Purely
 * presentational: it formats the raw values the composable put on `item.timing.band`.
 * Stays inside the ocean-teal travel identity.
 *
 * `was` (live flight checks, #143): the values an airline change replaced. When present, a
 * value that moved renders in Heritage Orange with the old one struck beside it, on whichever
 * line it lives (the big time, or the date under it). `start` is the departure and `end` the
 * arrival, which is the flight band's shape; `was` is only ever passed for a flight in the
 * `changed` state. The band shows no terminal, so a terminal change is told by the notice.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort, formatTime12 } from '@/utils/date';
import type { ScheduleTuple } from '@/types/flightStatus';
import type { WhenBand, WhenCell } from '@/utils/vacation';

const props = defineProps<{ band: WhenBand; was?: ScheduleTuple }>();

const { t } = useTranslation();

/** big line = the time when present, else the date; sub = the date under a time. */
function primary(cell: WhenCell): string {
  if (cell.time) return formatTime12(cell.time);
  if (cell.date) return formatDateShort(cell.date);
  return '';
}
function secondary(cell: WhenCell): string {
  return cell.time && cell.date ? formatDateShort(cell.date) : '';
}

/** The struck-out old values of one cell, per line ('' = that line did not move). */
interface CellWas {
  big: string;
  sub: string;
}

/** "9:05" and "09:05:00" are the same time; only a real move is struck out. */
const hhmm = (v: string) => v.trim().padStart(5, '0').slice(0, 5);

function cellWas(cell: WhenCell, time?: string, date?: string): CellWas {
  const oldTime = time && cell.time && hhmm(time) !== hhmm(cell.time) ? formatTime12(time) : '';
  const oldDate = date && cell.date && date.slice(0, 10) !== cell.date ? formatDateShort(date) : '';
  // The date is the big line only when the cell has no time.
  return cell.time ? { big: oldTime, sub: oldDate } : { big: oldDate, sub: '' };
}

const NONE: CellWas = { big: '', sub: '' };
const startWas = computed(() =>
  props.was ? cellWas(props.band.start, props.was.departureTime, props.was.departureDate) : NONE
);
const endWas = computed(() =>
  props.was && props.band.end
    ? cellWas(props.band.end, props.was.arrivalTime, props.was.arrivalDate)
    : NONE
);

const hasEnd = computed(() => !!props.band.end);
</script>

<template>
  <div class="when-band" :class="{ 'when-band--single': !hasEnd }">
    <div class="when-cell">
      <div class="when-cap">{{ t(band.start.captionKey) }}</div>
      <div class="font-outfit when-big" :class="{ 'is-live': startWas.big }">
        {{ primary(band.start) }}
      </div>
      <div v-if="secondary(band.start)" class="when-sub" :class="{ 'is-live': startWas.sub }">
        {{ secondary(band.start) }}
      </div>
      <div v-if="startWas.big || startWas.sub" class="when-was-line">
        <s v-if="startWas.big" class="when-was">{{ startWas.big }}</s>
        <s v-if="startWas.sub" class="when-was">{{ startWas.sub }}</s>
      </div>
    </div>

    <template v-if="band.end">
      <div class="when-arrow" aria-hidden="true">→</div>
      <div class="when-cell">
        <div class="when-cap">
          {{ t(band.end.captionKey) }}
          <span v-if="band.end.nextDay" class="when-nextday">{{
            t('travel.timeline.nextDay')
          }}</span>
        </div>
        <div class="font-outfit when-big" :class="{ 'is-live': endWas.big }">
          {{ primary(band.end) }}
        </div>
        <div v-if="secondary(band.end)" class="when-sub" :class="{ 'is-live': endWas.sub }">
          {{ secondary(band.end) }}
        </div>
        <div v-if="endWas.big || endWas.sub" class="when-was-line">
          <s v-if="endWas.big" class="when-was">{{ endWas.big }}</s>
          <s v-if="endWas.sub" class="when-was">{{ endWas.sub }}</s>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.when-band {
  align-items: stretch;
  border: 1px solid rgb(0 180 216 / 28%);
  border-radius: 0.875rem;
  display: flex;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.when-cell {
  background: rgb(0 180 216 / 6%);
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.875rem;
}

.when-cell + .when-cell {
  border-left: 1px solid rgb(0 180 216 / 18%);
}

.when-cap {
  align-items: center;
  color: var(--when-cap, #0077b6);
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.375rem;
  letter-spacing: 0.08em;
  margin-bottom: 0.125rem;
  text-transform: uppercase;
}

.when-nextday {
  /* primary-700, not the swatch: Heritage Orange read 3.14 on this teal cell (5.49 here). */
  color: var(--color-primary-700, #b33e15);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: normal;
  text-transform: none;
}

.when-big {
  color: var(--color-text, #1f2b38);
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.15;
}

.when-sub {
  color: var(--color-text-muted, #7a8b99);
  font-size: 0.75rem;
  margin-top: 0.0625rem;
}

.when-arrow {
  align-items: center;
  background: rgb(0 180 216 / 6%);
  color: #00b4d8;
  display: flex;
  font-size: 1rem;
  padding: 0 0.375rem;
}

html.dark .when-cell,
html.dark .when-arrow {
  background: rgb(0 180 216 / 10%);
}

/*
 * `#0077B6` is named in the CIG (slide 9) as one of three blue accents that
 * shipped UNDER the AA floor, at 3.46 on a dark surface. It is an accent used as
 * readable text, so it needs its lift partner, and the CIG's own table names
 * `teal-lift` #4FD1BE (8.98 / 7.78) as "Travel teal". Routed through a custom
 * property rather than a second colour declaration, because the rule that sets
 * it must beat the light one without duplicating the whole selector.
 *
 * The wall renders many more of these bands than the travel page ever did, which
 * is what pulled a pre-existing defect into scope.
 */
html.dark .when-band {
  --when-cap: var(--color-teal-lift, #4fd1be);
}

/*
 * Live flight checks (#143): an airline-changed value, and the value it replaced. Heritage
 * Orange with its lift partner on dark (an accent used as text); the struck value recedes to
 * the faint ink tier, never to an opacity. No new background: the cell keeps its teal wash.
 * (0,3,0) beats `.when-big` / `.when-sub` above; the dark rules are plain scoped rules.
 */
.when-big.is-live,
.when-sub.is-live {
  /* primary-700, not the swatch: primary-500 read 3.14 on the teal cell, this reads 5.49. */
  color: var(--color-primary-700, #b33e15);
}

/* The replaced values sit on their OWN small line under the live ones, never inline beside
   the big time: inline, "12:40am" overflowed a 360px phone's cell. */
.when-was-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.375rem;
  margin-top: 0.0625rem;
}

.when-was {
  color: var(--color-secondary-400, #506b7a);
  font-family: Inter, sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
}

html.dark .when-big.is-live,
html.dark .when-sub.is-live {
  color: var(--color-accent-lift, #ff8b5e);
}

html.dark .when-was {
  color: var(--color-ink-faint, #9aa9b4);
}

/* The "+1 day" mark is accent text: its lift on dark (it read 3.73 on the dark teal cell). */
html.dark .when-nextday {
  color: var(--color-accent-lift, #ff8b5e);
}
</style>
