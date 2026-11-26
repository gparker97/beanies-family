<script setup lang="ts">
/**
 * "When" hero band shown at the top of an expanded travel-segment card. Leads
 * with the segment's date/time — the info you scan for first — as one cell
 * ("starts") or two ("departs → arrives" / "check-in → check-out" etc). Purely
 * presentational: it formats the raw values the composable put on `item.timing.band`.
 * Stays inside the ocean-teal travel identity.
 *
 * Place line (flights only): when the composable set `cell.place`, the cell ends with its
 * airport and that side's terminal ("from SIN" / "Terminal 3", "at LHR" / "Terminal 2"), so a
 * terminal always sits under the end it belongs to. A side with no terminal says "Terminal
 * not known yet"; with no airport entered, the caption is dropped and the terminal stands
 * under its Departs / Arrives caption alone. `buildWhenBand` decides whether there is a place
 * line at all (only when either terminal is known).
 *
 * `was` (live flight checks, #143): the values an airline change replaced. When present, a
 * value that moved renders in Heritage Orange with the old one struck under it, on whichever
 * line it lives (the big time, the date under it, or the terminal on the place line). `start`
 * is the departure and `end` the arrival, which is the flight band's shape; `was` is only ever
 * passed for a flight in the `changed` state.
 *
 * `checks`: what the airline's latest answer says about each cell (`bandChecks`): confirmed,
 * in conflict, or changed and not yet in the plan. The cell carries the matching `LivePill` on
 * its date line (beside the big line when there is no date line), and each place line's
 * terminal carries its own (`startPlace` / `endPlace`). Not beside the caption: with "+1 day"
 * there, the pill wrapped onto its own line in a 360px phone's cell and pushed the two times
 * out of line.
 */
import { computed } from 'vue';
import LivePill from '@/components/travel/LivePill.vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort, formatTime12 } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { planTerminal } from '@/utils/flightStatus/copy';
import { normaliseTerminal } from '@/utils/flightStatus/schedule';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ScheduleTuple } from '@/types/flightStatus';
import type { FieldCheck } from '@/utils/flightStatus/copy';
import type { WhenBand, WhenCell } from '@/utils/vacation';

const props = defineProps<{
  band: WhenBand;
  was?: ScheduleTuple;
  checks?: {
    start?: FieldCheck;
    end?: FieldCheck;
    startPlace?: FieldCheck;
    endPlace?: FieldCheck;
  };
}>();

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
  place: string;
}

/** "9:05" and "09:05:00" are the same time; only a real move is struck out. */
const hhmm = (v: string) => v.trim().padStart(5, '0').slice(0, 5);

function cellWas(cell: WhenCell, time?: string, date?: string, terminal?: string): CellWas {
  const oldTime = time && cell.time && hhmm(time) !== hhmm(cell.time) ? formatTime12(time) : '';
  const oldDate = date && cell.date && date.slice(0, 10) !== cell.date ? formatDateShort(date) : '';
  // "T2" and "2" are the same terminal; only a real move is struck out.
  const oldPlace =
    terminal && cell.place && normaliseTerminal(terminal) !== normaliseTerminal(cell.place.terminal)
      ? planTerminal(t, terminal)
      : '';
  // The date is the big line only when the cell has no time.
  return cell.time
    ? { big: oldTime, sub: oldDate, place: oldPlace }
    : { big: oldDate, sub: '', place: oldPlace };
}

const NONE: CellWas = { big: '', sub: '', place: '' };

/** One rendered cell: its values, what it replaced, and its checks. */
interface BandCell {
  key: 'start' | 'end';
  cell: WhenCell;
  was: CellWas;
  check?: FieldCheck;
  placeCheck?: FieldCheck;
  /** "from {code}" under Departs, "at {code}" under Arrives. */
  placeCaptionKey: UIStringKey;
  /** The place line's terminal as shown ("Terminal 3"); '' = not known yet. */
  terminal: string;
}

const cells = computed<BandCell[]>(() => {
  const { band, was, checks } = props;
  const out: BandCell[] = [
    {
      key: 'start',
      cell: band.start,
      was: was ? cellWas(band.start, was.departureTime, was.departureDate, was.terminal) : NONE,
      check: checks?.start,
      placeCheck: checks?.startPlace,
      placeCaptionKey: 'travel.band.from',
      terminal: planTerminal(t, band.start.place?.terminal),
    },
  ];
  if (band.end) {
    out.push({
      key: 'end',
      cell: band.end,
      was: was ? cellWas(band.end, was.arrivalTime, was.arrivalDate, was.arrivalTerminal) : NONE,
      check: checks?.end,
      placeCheck: checks?.endPlace,
      placeCaptionKey: 'travel.band.at',
      terminal: planTerminal(t, band.end.place?.terminal),
    });
  }
  return out;
});

const hasEnd = computed(() => !!props.band.end);
</script>

<template>
  <div class="when-band" :class="{ 'when-band--single': !hasEnd }">
    <template v-for="(c, i) in cells" :key="c.key">
      <div v-if="i > 0" class="when-arrow" aria-hidden="true">→</div>
      <div class="when-cell">
        <div class="when-cap">
          {{ t(c.cell.captionKey) }}
          <span v-if="c.cell.nextDay" class="when-nextday">{{ t('travel.timeline.nextDay') }}</span>
        </div>
        <div class="font-outfit when-big" :class="{ 'is-live': c.was.big }">
          {{ primary(c.cell) }}
          <LivePill v-if="c.check && !secondary(c.cell)" :status="c.check" />
        </div>
        <div v-if="secondary(c.cell)" class="when-sub" :class="{ 'is-live': c.was.sub }">
          {{ secondary(c.cell) }}
          <LivePill v-if="c.check" :status="c.check" />
        </div>
        <div v-if="c.was.big || c.was.sub" class="when-was-line">
          <s v-if="c.was.big" class="when-was">{{ c.was.big }}</s>
          <s v-if="c.was.sub" class="when-was">{{ c.was.sub }}</s>
        </div>
        <div v-if="c.cell.place" class="when-place">
          <div v-if="c.cell.place.code" class="when-place-cap">
            {{ fillTemplate(t(c.placeCaptionKey), { code: c.cell.place.code }) }}
          </div>
          <div
            v-if="c.terminal"
            class="font-outfit when-place-term"
            :class="{ 'is-live': c.was.place }"
          >
            {{ c.terminal }}
            <LivePill v-if="c.placeCheck" :status="c.placeCheck" />
          </div>
          <div v-else class="when-place-unknown">{{ t('travel.band.terminalUnknown') }}</div>
          <div v-if="c.was.place" class="when-was-line">
            <s class="when-was">{{ c.was.place }}</s>
          </div>
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

.when-big,
.when-sub {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.375rem;
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
 * The place line (flights): the airport caption, then the terminal. No background of its own;
 * it sits on the cell's teal wash. Its divider is the band's own sky edge by day and `line`
 * by night. The caption and the "not known yet" line recede to the faint ink tier, never to
 * an opacity.
 */
.when-place {
  border-top: 1px dashed rgb(0 180 216 / 28%);
  display: flex;
  flex-direction: column;
  gap: 0.0625rem;
  margin-top: 0.375rem;
  padding-top: 0.375rem;
}

.when-place-cap,
.when-place-unknown {
  color: var(--color-secondary-400, #506b7a);
  font-size: 0.75rem;
}

.when-place-term {
  align-items: center;
  color: var(--color-text, #1f2b38);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.875rem;
  font-weight: 600;
  gap: 0 0.375rem;
}

html.dark .when-place {
  border-top-color: var(--color-line, #4a5b69);
}

html.dark .when-place-cap,
html.dark .when-place-unknown {
  color: var(--color-ink-faint, #9aa9b4);
}

html.dark .when-place-term {
  color: var(--color-ink, #f2f5f7);
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
 * (0,3,0) beats `.when-big` / `.when-sub` / `.when-place-term` above; the dark rules are plain
 * scoped rules, and (0,4,1) beats `html.dark .when-place-term`.
 */
.when-big.is-live,
.when-sub.is-live,
.when-place-term.is-live {
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
html.dark .when-sub.is-live,
html.dark .when-place-term.is-live {
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
