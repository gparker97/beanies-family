<script lang="ts">
import { createChangeGate } from '@/services/telemetry/emitPolicy';

/**
 * `nook_caption_fit` once per transition for the whole session (module scope, so a Nook
 * remount does not re-report the same answer). No heartbeat: the stage is a layout outcome, and
 * a repeat carries nothing new.
 */
const captionFitGate = createChangeGate(Number.POSITIVE_INFINITY);
</script>

<script setup lang="ts">
/**
 * The Nook's greeting and its one-line caption (#134, ADR-043).
 *
 * Compact (phone and tablet): the caption carries the date, because the compact header does
 * not. With a usable weather reading (fresh or aged) it is a whole translated sentence with the
 * temperature ("It's a rainy 55° Friday, October 16"), and it never wraps: three candidates are
 * measured live (long date, short date, then the plain "It's {date}") and the first that fits
 * wins. With no town, weather off, a reading over 12 hours old or no reading, it is today's
 * caption ("It's Fri, Oct 16 · Your family at a glance"), a single candidate. Translated
 * sentences are never spliced; the date is always ONE localized `formatUiDate` rendering of
 * `useToday().today`, so an open Nook rolls at midnight and zh reads a Chinese date.
 *
 * Desktop: the header carries the date, so the caption is the descriptor, and the weather pill
 * sits right of the greeting.
 */
import { computed, ref, watch } from 'vue';
import NookWeatherPill from '@/components/nook/NookWeatherPill.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useFirstThatFits } from '@/composables/useFirstThatFits';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { logEvent } from '@/services/telemetry';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { useFamilyStore } from '@/stores/familyStore';
import { useWeatherStore } from '@/stores/weatherStore';
import type { WeatherGlyph } from '@/types/weather';
import { splitTemplate, type TemplatePart } from '@/utils/fillTemplate';
import { formatUiDate } from '@/utils/uiLocale';

/** "Friday, October 16": only where the weather ladder has room for it. */
const CAPTION_DATE_LONG: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
};
/** "Fri, Oct 16": the one date shape every caption state shares. */
const CAPTION_DATE_SHORT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
};

/** One whole sentence per glyph (typed, so a missing key fails the type-check). */
const WEATHER_CAPTION_KEY: Record<WeatherGlyph, UIStringKey> = {
  sunny: 'nook.weatherCaption.sunny',
  partly: 'nook.weatherCaption.partly',
  cloudy: 'nook.weatherCaption.cloudy',
  rain: 'nook.weatherCaption.rain',
  thunder: 'nook.weatherCaption.thunder',
  snow: 'nook.weatherCaption.snow',
  fog: 'nook.weatherCaption.fog',
  night: 'nook.weatherCaption.night',
  nightPartly: 'nook.weatherCaption.nightPartly',
};

/** The weather ladder's rungs, in order; the `stage` of `nook_caption_fit`. */
const LADDER_STAGES = ['full', 'short', 'plain'] as const;

/** Every caption line, visible or measured, shares these so the measurement is exact. */
const CAPTION_LINE = 'text-sm whitespace-nowrap';

const { t, currentLanguage } = useTranslation();
const familyStore = useFamilyStore();
const weatherStore = useWeatherStore();
const { isDesktop } = useBreakpoint();
const { today } = useToday();

const memberName = computed(() => familyStore.currentMember?.name || '');

const greetingParts = computed(() =>
  splitTemplate(t('nook.welcomeHome'), { name: memberName.value })
);

const dateLong = computed(() =>
  formatUiDate(today.value, currentLanguage.value, CAPTION_DATE_LONG)
);
const dateShort = computed(() =>
  formatUiDate(today.value, currentLanguage.value, CAPTION_DATE_SHORT)
);

/** The reading the caption may speak: fresh or aged, with a current temperature. */
const captionReading = computed(() => {
  const atom = weatherStore.atom;
  if (atom?.state !== 'reading' || atom.temp === null) return null;
  return atom.freshness === 'fresh' || atom.freshness === 'aged' ? atom : null;
});

/** The candidates, longest first. One candidate (no measuring) without a usable reading. */
const candidates = computed<TemplatePart[][]>(() => {
  const reading = captionReading.value;
  if (!reading) return [splitTemplate(t('nook.todayCaption'), { date: dateShort.value })];
  const sentence = t(WEATHER_CAPTION_KEY[reading.glyph]);
  return [
    splitTemplate(sentence, { temp: reading.temp, date: dateLong.value }),
    splitTemplate(sentence, { temp: reading.temp, date: dateShort.value }),
    splitTemplate(t('nook.todayCaptionPlain'), { date: dateShort.value }),
  ];
});

const isLadder = computed(() => candidates.value.length > 1);

const captionEl = ref<HTMLElement | null>(null);
const measurerEl = ref<HTMLElement | null>(null);
const { index: fitIndex, settled } = useFirstThatFits(captionEl, measurerEl, {
  surface: 'weather',
  deps: () => candidates.value.map((parts) => parts.map((p) => p.text).join('')),
});

const shownParts = computed(() => {
  const list = candidates.value;
  return list[Math.min(fitIndex.value, list.length - 1)] ?? [];
});

/** Date in the accent, the temperature in the strong ink, the words in the soft ink. */
function partClass(part: TemplatePart): string | undefined {
  if (part.key === 'date')
    return 'font-outfit text-primary-500 dark:text-accent-lift font-semibold';
  if (part.key === 'temp') return 'font-outfit text-secondary-500 dark:text-ink font-semibold';
  return undefined;
}

/** The ladder's answer, or null when there is no ladder or nothing was measured yet. */
const fitStage = computed(() =>
  isLadder.value && settled.value && !isDesktop.value
    ? (LADDER_STAGES[fitIndex.value] ?? null)
    : null
);

watch(fitStage, (stage) => {
  if (stage === null || !captionFitGate(stage)) return;
  logEvent({
    level: 'info',
    surface: 'weather',
    message: 'nook_caption_fit',
    context: { action: 'caption-fit', stage, format: 'phone' },
  });
});
</script>

<template>
  <div
    :class="isDesktop ? '@container flex items-start justify-between gap-4' : undefined"
    data-testid="nook-greeting"
  >
    <div class="min-w-0 flex-1">
      <h1 class="font-outfit text-secondary-500 dark:text-ink text-2xl leading-tight font-bold">
        <template v-for="(part, i) in greetingParts" :key="i">
          <span v-if="part.key === 'name'" class="text-primary-500 dark:text-accent-lift">{{
            part.text
          }}</span>
          <template v-else>{{ part.text }}</template>
        </template>
      </h1>
      <!-- Compact (mobile/tablet): the caption carries the date (the compact header does not).
           The measurer lays every candidate out on one line, hidden, so the visible line is the
           first that fits; `truncate` is only a backstop. -->
      <div
        v-if="!isDesktop"
        ref="captionEl"
        class="text-secondary-400 dark:text-ink-soft relative mt-1"
        data-testid="nook-caption"
      >
        <p :class="CAPTION_LINE" class="truncate" data-testid="nook-caption-line">
          <template v-for="(part, i) in shownParts" :key="i">
            <span v-if="part.value" :class="partClass(part)">{{ part.text }}</span>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
        <div
          v-if="isLadder"
          ref="measurerEl"
          class="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
          aria-hidden="true"
          data-testid="nook-caption-measurer"
        >
          <p v-for="(parts, c) in candidates" :key="c" :class="CAPTION_LINE">
            <template v-for="(part, i) in parts" :key="i">
              <span v-if="part.value" :class="partClass(part)">{{ part.text }}</span>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </div>
      </div>
      <!-- Desktop: the header already carries the date; the caption is the descriptor. -->
      <p v-else class="text-secondary-400 dark:text-ink-soft mt-1 text-sm">
        {{ t('nook.familyAtAGlance') }}
      </p>
    </div>
    <NookWeatherPill v-if="isDesktop && weatherStore.atom" :atom="weatherStore.atom" />
  </div>
</template>
