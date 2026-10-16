<script setup lang="ts">
/**
 * The beanie wall's weather card (#134, ADR-043): a cut of the shared weather atom that leads
 * the peripheral cards (rail top, first in the band).
 *
 * Three layouts, chosen by the page from this wall's style and height (`wallWeatherSize`):
 * - `full`: now plus the next three days (Large, on a wall 700px or more tall);
 * - `now`: the conditions now (Small);
 * - `line`: one line with no heading (any wall under 700px tall), so Tonight stays in view.
 * The strip's weather cell is NOT a layout of this card: it is the strip's own `STRIP_CELL`
 * span in `WallPeripheralCards`, reading the same atom fields.
 *
 * Not interactive (`WallCard displayOnly`): there is no drill-in for weather, and a card that
 * looks tappable but is not was the wall's loudest complaint.
 *
 * Every value arrives formatted in the atom (`highLow`, `todayHighLow` included), so this card
 * formats nothing and splices no translated fragments.
 * Dark mode: the `WallCard` shell carries `dark:bg-surface-raised`; every string here resolves
 * to `ink` / `ink-soft` / `ink-faint`, and the card paints no background of its own.
 */
import { computed } from 'vue';
import WallCard from '@/components/wall/WallCard.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import WeatherGlyph from '@/components/weather/WeatherGlyph.vue';
import WeatherOutlook from '@/components/weather/WeatherOutlook.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { WeatherAtom } from '@/types/weather';

export type WallWeatherCardLayout = 'line' | 'now' | 'full';

const props = defineProps<{
  atom: WeatherAtom;
  layout: WallWeatherCardLayout;
}>();

const { t } = useTranslation();

const isLine = computed(() => props.layout === 'line');

/** An `aged` reading draws the temperature in the softer ink. */
const tempClass = computed(() =>
  props.atom.state === 'reading' && props.atom.soft
    ? 'text-secondary-400 dark:text-ink-soft'
    : 'text-secondary-500 dark:text-ink'
);
</script>

<template>
  <WallCard
    display-only
    :title="isLine ? undefined : t('weather.title')"
    class="wall-weather-card"
    :data-layout="layout"
    :data-state="atom.state"
  >
    <template v-if="atom.state === 'reading' && !isLine" #aside>
      <span
        class="font-inter wall-weather-where text-secondary-400 dark:text-ink-soft ml-auto min-w-0 truncate font-medium tracking-normal normal-case"
      >
        {{ atom.placeName }}
      </span>
    </template>

    <!-- A reading: the only branch that looks at the layout. -->
    <template v-if="atom.state === 'reading'">
      <span v-if="isLine" class="flex min-w-0 items-center gap-2">
        <WeatherGlyph :kind="atom.glyph" :size="26" class="wall-weather-glyph shrink-0" />
        <template v-if="atom.temp !== null">
          <span
            class="font-outfit wall-weather-temp shrink-0 leading-none font-extrabold tabular-nums"
            :class="tempClass"
            >{{ atom.temp }}</span
          >
          <span
            class="font-outfit wall-weather-cond text-secondary-500 dark:text-ink min-w-0 truncate font-semibold"
            >{{ atom.condition }}</span
          >
        </template>
        <span
          v-else
          class="font-outfit wall-weather-cond text-secondary-500 dark:text-ink min-w-0 truncate font-semibold"
          >{{ atom.todayHighLow }}</span
        >
        <span
          v-if="atom.ageShort"
          class="font-inter wall-card-sub text-secondary-400 dark:text-ink-faint ml-auto shrink-0 whitespace-nowrap"
          >{{ atom.ageShort }}</span
        >
      </span>

      <template v-else>
        <span class="flex min-w-0 items-center gap-2.5">
          <WeatherGlyph :kind="atom.glyph" :size="40" class="wall-weather-glyph shrink-0" />
          <template v-if="atom.temp !== null">
            <span
              class="font-outfit wall-weather-temp shrink-0 leading-none font-extrabold tracking-tight tabular-nums"
              :class="tempClass"
              >{{ atom.temp }}</span
            >
            <span class="min-w-0">
              <span
                class="font-outfit wall-weather-cond text-secondary-500 dark:text-ink block truncate font-semibold"
                >{{ atom.condition }}</span
              >
              <span
                v-if="layout === 'full'"
                class="font-inter wall-weather-hl text-secondary-400 dark:text-ink-soft block whitespace-nowrap"
                >{{ atom.highLow }}</span
              >
            </span>
          </template>
          <span
            v-else
            class="font-outfit wall-weather-cond text-secondary-500 dark:text-ink min-w-0 font-semibold"
            >{{ atom.todayHighLow }}</span
          >
        </span>
        <WeatherOutlook v-if="layout === 'full'" :days="atom.outlook" variant="inline" />
        <span
          v-if="atom.ageText"
          class="font-inter wall-card-sub text-secondary-400 dark:text-ink-faint mt-1.5 block"
          >{{ atom.ageText }}</span
        >
      </template>
    </template>

    <span
      v-else-if="atom.state === 'nudge'"
      class="font-inter wall-card-line text-secondary-400 dark:text-ink-soft flex items-center gap-2"
    >
      <BeanieIcon name="map-pin" size="sm" class="shrink-0" />
      <span class="min-w-0" :class="isLine ? 'truncate' : ''">{{
        isLine ? t('weather.nudgeShort') : t('weather.nudge')
      }}</span>
    </span>

    <span
      v-else
      class="font-inter wall-card-line text-secondary-400 dark:text-ink-soft block"
      :class="isLine ? 'truncate' : ''"
      >{{ isLine ? t('weather.unavailableShort') : t('weather.unavailable') }}</span
    >
  </WallCard>
</template>
