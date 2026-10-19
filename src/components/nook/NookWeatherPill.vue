<script setup lang="ts">
/**
 * The desktop Nook's weather pill (#134, ADR-043), right of the greeting: the conditions now
 * (glyph, temperature, condition, then today's high/low or the age) and the next three days.
 *
 * One cut of the store's atom, rendered from the `atom` prop (the parent reads the store), so
 * the states are exactly the atom's: `reading` (fresh, aged with the softer temperature, or old
 * with "Today H L" in place of the temperature), `nudge` (a link to Region & Holidays) and
 * `unavailable` (one line, never a silent blank). Weather off is a null atom, which the parent
 * never renders.
 *
 * It never wraps under the greeting: it is `flex-none` and `whitespace-nowrap`, and below the
 * greeting row's `@3xl` container width (about a 1072px desktop window, and scaled with Large
 * reading mode since container queries resolve rem against the root) the outlook hides first.
 *
 * Dark: a raised card on the page; every readable string is `ink` / `ink-soft` / `ink-faint`,
 * and the nudge link takes `accent-lift`.
 */
import { computed } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import WeatherGlyph from '@/components/weather/WeatherGlyph.vue';
import WeatherOutlook from '@/components/weather/WeatherOutlook.vue';
import { useTranslation } from '@/composables/useTranslation';
import { REGION_HOLIDAYS_OPEN } from '@/constants/settingsDeepLinks';
import type { WeatherAtom } from '@/types/weather';
import { splitTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ atom: WeatherAtom }>();

const { t } = useTranslation();

const reading = computed(() => (props.atom.state === 'reading' ? props.atom : null));

/** Under the condition: the age when there is one, otherwise today's high and low. */
const subLine = computed(() => {
  const r = reading.value;
  if (!r) return '';
  return r.ageText ?? r.highLow;
});

const nudgeParts = computed(() =>
  splitTemplate(t('weather.nudgeNook'), { link: t('weather.nudgeNookLink') })
);

const settingsLink = { path: '/settings', query: { open: REGION_HOLIDAYS_OPEN } };
</script>

<template>
  <div
    class="dark:bg-surface-raised flex flex-none items-center gap-3.5 rounded-3xl bg-white px-3.5 py-2.5 whitespace-nowrap shadow-[var(--card-shadow)]"
    :data-state="atom.state"
    data-testid="nook-weather-pill"
  >
    <template v-if="reading">
      <div class="flex items-center gap-2.5">
        <WeatherGlyph :kind="reading.glyph" :size="38" />
        <span
          v-if="reading.temp !== null"
          class="font-outfit text-2xl leading-none font-extrabold tabular-nums"
          :class="
            reading.soft
              ? 'text-secondary-400 dark:text-ink-soft'
              : 'text-secondary-500 dark:text-ink'
          "
          data-testid="nook-weather-temp"
          >{{ reading.temp }}</span
        >
        <span class="flex flex-col gap-0.5">
          <span
            class="font-outfit text-secondary-500 dark:text-ink text-sm leading-tight font-semibold"
            >{{ reading.temp !== null ? reading.condition : reading.todayHighLow }}</span
          >
          <span
            class="text-xs leading-tight"
            :class="
              reading.ageText
                ? 'text-secondary-400 dark:text-ink-faint'
                : 'text-secondary-400 dark:text-ink-soft'
            "
            data-testid="nook-weather-sub"
            >{{ subLine }}</span
          >
        </span>
      </div>
      <div
        v-if="reading.outlook.length"
        class="dark:border-line hidden border-l border-[var(--color-border)] pl-3.5 @3xl:block"
        data-testid="nook-weather-outlook"
      >
        <WeatherOutlook :days="reading.outlook" variant="tiles" />
      </div>
    </template>

    <span
      v-else-if="atom.state === 'nudge'"
      class="text-secondary-400 dark:text-ink-soft inline-flex items-center gap-2 text-sm"
    >
      <BeanieIcon name="map-pin" size="sm" class="text-primary-500 dark:text-accent-lift" />
      <span>
        <template v-for="(part, i) in nudgeParts" :key="i">
          <router-link
            v-if="part.key === 'link'"
            :to="settingsLink"
            class="text-primary-500 dark:text-accent-lift font-semibold hover:underline"
            data-testid="nook-weather-nudge-link"
            >{{ part.text }}</router-link
          >
          <template v-else>{{ part.text }}</template>
        </template>
      </span>
    </span>

    <span v-else class="text-secondary-400 dark:text-ink-soft text-sm">{{
      t('weather.unavailable')
    }}</span>
  </div>
</template>
