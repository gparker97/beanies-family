<script setup lang="ts">
/**
 * One candidate in the import review list (#94).
 *
 * Built for 200 of itself. The first mockup put the outcome EXPLANATION on every
 * row ("Your edits here will update this event in Google. No second copy."), which
 * at 200 rows is 200 copies of one sentence and is why the row measured 130px. The
 * explanation now lives once in the modal's legend and the row keeps only the chip,
 * which still states the outcome per event as the tracker requires. Measured 42px.
 *
 * Deliberately NOT built on `travel/ExtractedSegmentRow`: that is a two-line
 * display card with no selection, a different chip and a different ground. Forcing
 * both through one component would mean six optional props serving two surfaces
 * with no shared future, and would restyle the travel modal for this feature's
 * benefit.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useRecurrenceLabel } from '@/composables/useRecurrenceLabel';
import type { ImportCandidate } from '@/utils/calendar/planImport';

const props = defineProps<{
  candidate: ImportCandidate;
  selected: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const { t } = useTranslation();
// The app's ONE recurrence summariser. The planner deliberately ships no string
// of its own: a local one would be a fourth formatter and, living in a `.ts`
// file, would have shipped hardcoded English past the template i18n lint.
const { describe } = useRecurrenceLabel();

const repeats = computed(() => {
  const { rule, date } = props.candidate.draft;
  return rule ? describe(rule, date) : '';
});

/**
 * Chip tones. Kept local rather than shared: the only other chip in the app that
 * looks like this is the travel row's, which uses a different hue on a different
 * ground, so a shared map would restyle that surface for no reason.
 *
 * ⚠️ The text colour is NOT the accent colour. Heritage Orange on its own 50-tint
 * measures 3.06:1, which fails AA for a 12px semibold chip; primary-700 on the
 * same tint is 5.14:1. Dark mode uses the `-lift` accents, which are built for
 * that ladder. Do not "simplify" these to `text-primary-500`.
 */
const TONES = {
  accent: 'bg-primary-50 text-primary-700 dark:bg-accent-lift/15 dark:text-accent-lift',
  silk: 'bg-sky-silk-50 text-[#1f5f80] dark:bg-silk-lift/15 dark:text-silk-lift',
  muted: 'bg-secondary-50 text-secondary-400 dark:bg-surface-hover dark:text-ink-faint',
} as const;

const chip = computed(() => {
  if (props.candidate.alreadyImported) {
    return { label: t('calendarImport.chip.already'), tone: TONES.muted };
  }
  if (props.candidate.outcome === 'adopt') {
    return { label: t('calendarImport.chip.adopt'), tone: TONES.accent };
  }
  if (props.candidate.outcome === 'unsupported-recurrence') {
    return { label: t('calendarImport.chip.once'), tone: TONES.muted };
  }
  return { label: t('calendarImport.chip.copy'), tone: TONES.silk };
});

/** Local `HH:mm` for a timed event, or the all-day label. */
const when = computed(() => {
  const d = props.candidate.draft;
  if (d.isAllDay) return t('calendarImport.allDay');
  return d.startTime ?? '';
});

const title = computed(() => props.candidate.draft.title || t('calendarImport.noTitle'));
</script>

<template>
  <!-- The row sits ON the drawer body, so it must be one step UP the elevation
       ladder from it. The drawer is `bg-white dark:bg-surface-raised`
       (BeanieFormModal), so a row painting those same tokens would be invisible
       against its own container. -->
  <li class="dark:bg-surface-overlay flex items-center gap-3 rounded-[14px] bg-[#f8f9fa] px-3 py-2">
    <button
      type="button"
      class="grid h-6 w-6 shrink-0 place-items-center rounded-lg border-2 text-xs"
      :class="
        selected
          ? 'border-primary-500 bg-primary-500 dark:border-accent-lift dark:bg-accent-lift dark:text-surface-ground text-white'
          : 'border-secondary-100 dark:border-line-strong text-transparent'
      "
      :disabled="candidate.alreadyImported"
      :aria-pressed="selected"
      :aria-label="title"
      @click="emit('toggle')"
    >
      <span aria-hidden="true">✓</span>
    </button>

    <!-- `items-start` in the column layout, or the chip and the location stretch
         to the full row width instead of hugging their text. -->
    <div
      class="flex min-w-0 flex-1 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2"
    >
      <!-- ⚠️ An already-imported row is de-emphasised with a FAINTER INK, never an
           opacity modifier: `opacity-50` composites the ink against the row ground
           and drops dark-mode body text to roughly 1.2:1 (the CIG's fourth trap).

           `flex-auto`, NOT `flex-1`. `flex-1` is `flex: 1 1 0%`, which starts the
           title at ZERO width and grows it only from leftover space, so a long
           location next to it truncates the title to a couple of characters.
           `flex-auto` keeps a content-sized basis. The location below is the exact
           opposite (`flex-1`, a ZERO basis) so it can only ever occupy LEFTOVER
           space — see its own comment. -->
      <span
        class="font-outfit min-w-0 flex-auto truncate text-base font-semibold"
        :class="
          candidate.alreadyImported
            ? 'text-secondary-400 dark:text-ink-faint'
            : 'text-secondary-500 dark:text-ink'
        "
        :title="title"
        >{{ title }}</span
      >
      <span
        v-if="repeats"
        class="bg-primary-50 text-primary-700 dark:bg-accent-lift/15 dark:text-accent-lift font-outfit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      >
        <!-- `whitespace-nowrap`: on the stacked phone layout "every 2 weeks on thu"
             wrapped to two lines and turned a 40px row into a 100px one, exactly
             where density matters most. -->
        <span aria-hidden="true">↻</span> {{ repeats }}
      </span>
      <!-- ⚠️ Shown only when there is NO repeat chip, and gated on `sm:` rather than
           `lg:`. Both corrections come from measuring the real thing: this sits in a
           fixed-width DRAWER (464px on a 1280px screen), so a viewport breakpoint
           answers the wrong question, and a row carrying "every 2 weeks on thu"
           simply has no room left for a place name. Sharing the line three ways
           produced either a two-character title or a one-character location — a
           stray "k" beside the time. At 40px density the place is supplementary;
           the repeat pattern is what the import decision turns on, so the chip
           wins and the location steps aside. The full title stays available in the
           title attribute's tooltip either way. -->
      <span
        v-if="candidate.draft.location && !repeats"
        class="text-secondary-400 dark:text-ink-faint hidden max-w-[8rem] min-w-0 shrink-[6] truncate text-xs sm:inline"
        >{{ candidate.draft.location }}</span
      >
    </div>

    <span class="text-secondary-400 dark:text-ink-soft shrink-0 text-xs tabular-nums">{{
      when
    }}</span>
    <span
      class="font-outfit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      :class="chip.tone"
      >{{ chip.label }}</span
    >
  </li>
</template>
