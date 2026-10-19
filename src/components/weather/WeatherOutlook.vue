<script setup lang="ts">
/**
 * The next few days of the forecast (#134, ADR-043), one shared row in three dresses (`tiles` and
 * `night` share one template branch driven by `ROW`; `inline` keeps its own):
 *
 * - `tiles`: the Nook desktop pill. One compact line per day (weekday, glyph, high, low) with
 *   no painted background, so the raised pill needs no surface step on dark.
 * - `inline`: the wall weather card (Large). Three equal columns under a hairline, divided by
 *   hairlines, glyph + high + low on one line under the day.
 * - `night`: the wall night screen. One dim row, every glyph `mono`, the first day labelled
 *   `date.tomorrow`. The night overlay is fixed-dark in BOTH themes, so this variant has no
 *   `dark:` partners on purpose: `#8ea3b8` is the night screen's one dim ink (6.33:1 on
 *   `#16202C`, 7.12:1 on `#0D141D`), the same utility the night date carries.
 *
 * Every value arrives formatted in `WeatherOutlookDay` (`weekday`, `high`, `low`), so this
 * component formats nothing and renders nothing for an empty list.
 */
import { computed } from 'vue';
import WeatherGlyph from '@/components/weather/WeatherGlyph.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { WeatherOutlookDay } from '@/types/weather';

export type WeatherOutlookVariant = 'tiles' | 'inline' | 'night';

const props = defineProps<{
  days: readonly WeatherOutlookDay[];
  variant: WeatherOutlookVariant;
}>();

const { t } = useTranslation();

/**
 * The two one-line-per-day dresses, as complete class strings so Tailwind's scanner sees every
 * utility. `tiles` carries the dark partners; `night` has none on purpose (see the doc above).
 */
const ROW = {
  tiles: {
    root: 'weather-outlook flex items-center gap-3.5',
    day: 'flex items-center gap-1.5',
    label: 'font-outfit text-secondary-400 dark:text-ink-soft text-xs leading-none font-bold',
    high: 'font-outfit text-secondary-500 dark:text-ink text-sm leading-none font-bold tabular-nums',
    low: 'font-inter text-secondary-400 dark:text-ink-faint text-xs leading-none font-medium tabular-nums',
    glyph: 18,
  },
  night: {
    root: 'weather-outlook flex gap-7 border-t border-[rgb(142_163_184/22%)] pt-3 text-[#8ea3b8]',
    day: 'flex items-center gap-2 text-base',
    label: 'font-outfit leading-none font-bold',
    high: 'font-outfit leading-none font-bold tabular-nums',
    low: 'font-inter leading-none font-medium tabular-nums',
    glyph: 22,
  },
} as const;

/** Index through a computed: inside the `!== 'inline'` branch the prop is still all three. */
const row = computed(() => ROW[props.variant === 'night' ? 'night' : 'tiles']);

/** The night row names its first day "Tomorrow"; the others keep their weekday. */
const labels = computed(() =>
  props.days.map((day, i) =>
    props.variant === 'night' && i === 0 ? t('date.tomorrow') : day.weekday
  )
);
</script>

<template>
  <div v-if="days.length && variant !== 'inline'" :class="row.root" :data-variant="variant">
    <div v-for="(day, i) in days" :key="day.ymd" :class="row.day">
      <span :class="row.label">{{ labels[i] }}</span>
      <WeatherGlyph :kind="day.glyph" :size="row.glyph" :mono="variant === 'night'" />
      <span :class="row.high">{{ day.high }}</span>
      <span :class="row.low">{{ day.low }}</span>
    </div>
  </div>

  <div
    v-else-if="days.length && variant === 'inline'"
    class="weather-outlook dark:border-line mt-2 grid grid-cols-3 border-t border-[var(--color-border)] pt-2"
    data-variant="inline"
  >
    <div
      v-for="(day, i) in days"
      :key="day.ymd"
      class="flex flex-col items-center gap-0.5"
      :class="i > 0 ? 'dark:border-line border-l border-[var(--color-border)]' : ''"
    >
      <span
        class="font-outfit text-secondary-400 dark:text-ink-soft text-xs leading-none font-bold"
        >{{ labels[i] }}</span
      >
      <span
        class="font-outfit text-secondary-500 dark:text-ink flex items-center gap-1 text-sm leading-none font-bold tabular-nums"
      >
        <WeatherGlyph :kind="day.glyph" :size="18" />
        {{ day.high }}
        <span
          class="font-inter text-secondary-400 dark:text-ink-faint text-xs leading-none font-medium"
          >{{ day.low }}</span
        >
      </span>
    </div>
  </div>
</template>
