<script setup lang="ts">
/**
 * Night: dim the room, keep the time readable, and say what tomorrow holds.
 *
 * The look-ahead line is the reason to glance at a dark kitchen at 11pm — it
 * is the last thing a parent checks before bed, and the mockup puts it right
 * under the clock for exactly that reason.
 *
 * An OVERLAY above the live view rather than a replacement, so the wall does
 * not remount (and re-fetch) every morning. Brand sits in the corner
 * deliberately — it reinforces whose display this is without competing with
 * the only information that matters at 2am.
 *
 * WEATHER (#134): always the full treatment whatever this wall's card style
 * (the conditions now with tonight's low, then the next three days with
 * "Tomorrow" first), because that is what a parent checks before bed. The page
 * passes `null` when this wall's style is Off, and the store's atom is already
 * `null` when the family switch is off, so this block only draws what it gets.
 *
 * ONE DIM INK. The clock is the only white on the screen; the date, the weather
 * (glyphs `mono`, so they take `currentColor`) and the hint all use the date's
 * `text-[#8ea3b8]` utility, 6.33:1 on `#16202C` and 7.12:1 on `#0D141D`. The
 * hint was `#63798f` (3.65:1, under AA) until #134. No `html.dark` partner is
 * needed anywhere here: the overlay is fixed-dark in both themes, a dimmed
 * room rather than the app theme, so its surface never changes with the theme.
 */
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import WeatherGlyph from '@/components/weather/WeatherGlyph.vue';
import WeatherOutlook from '@/components/weather/WeatherOutlook.vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import type { WeatherAtom } from '@/types/weather';

defineProps<{
  time: string;
  date: string;
  /** How many things are on tomorrow — drives the look-ahead line. */
  tomorrowCount: number;
  /** The weather atom, or null/absent to draw no weather (wall Off, or the family switch). */
  weather?: WeatherAtom | null;
}>();
defineEmits<{ wake: [] }>();
const { t } = useTranslation();
</script>

<template>
  <div
    class="absolute inset-0 z-[50] flex flex-col items-center justify-center bg-[radial-gradient(120%_90%_at_50%_30%,#16202c,#0d141d)] text-[#e7edf3]"
    @click="$emit('wake')"
  >
    <p class="font-outfit wall-night-time leading-none font-extrabold tracking-tight">{{ time }}</p>
    <p class="font-outfit wall-night-date mt-1 font-semibold text-[#8ea3b8]">{{ date }}</p>

    <div
      v-if="weather"
      class="wall-night-weather mt-5 flex flex-col items-center gap-3 text-[#8ea3b8]"
      :data-state="weather.state"
    >
      <template v-if="weather.state === 'reading'">
        <!-- An `old` reading has no "now": only its age and the days ahead. -->
        <p v-if="weather.temp !== null" class="flex items-center gap-3">
          <WeatherGlyph :kind="weather.glyph" :size="34" mono />
          <span class="font-outfit wall-night-wx-temp leading-none font-bold tabular-nums">{{
            weather.temp
          }}</span>
          <span class="font-inter wall-night-wx-cond font-medium">{{
            fillTemplate(t('weather.night.nowLine'), {
              condition: weather.condition,
              temp: weather.tonightLow,
            })
          }}</span>
        </p>
        <p v-if="weather.ageText" class="font-inter wall-night-wx-age">{{ weather.ageText }}</p>
        <WeatherOutlook :days="weather.outlook" variant="night" />
      </template>
      <p v-else class="font-inter wall-night-wx-line flex items-center gap-2">
        <BeanieIcon v-if="weather.state === 'nudge'" name="map-pin" size="sm" />
        {{ weather.state === 'nudge' ? t('weather.nudge') : t('weather.unavailable') }}
      </p>
    </div>

    <p class="font-inter wall-night-hint mt-5 text-[#8ea3b8]">
      <template v-if="tomorrowCount">
        {{
          fillTemplate(
            tomorrowCount === 1 ? t('wall.night.tomorrow.one') : t('wall.night.tomorrow.other'),
            { count: tomorrowCount }
          )
        }}
        <span aria-hidden="true">·</span>
      </template>
      {{ t('wall.night.wake') }}
    </p>

    <div class="absolute bottom-8 left-8 flex items-center gap-3 opacity-55">
      <img
        src="/brand/beanies_family_icon_transparent_384x384.png"
        alt=""
        class="h-8 w-8 object-contain"
      />
      <span class="font-outfit wall-night-brand font-bold text-[#8ea3b8]">
        beanies<span class="text-[var(--heritage-orange)]">.family</span>
      </span>
    </div>
  </div>
</template>
