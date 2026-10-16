<script setup lang="ts">
/**
 * One weather glyph (#134, ADR-043), drawn from the shared geometry in
 * `constants/weatherGlyphs.json`. Decorative: the condition is always spelled out in text
 * beside it, so the SVG is `aria-hidden`.
 *
 * Colour is by ROLE, not by part: every part carries a role class whose stroke and fill read a
 * `--wx-*` custom property set on the root, with the dark partners in one plain
 * `html.dark .weather-glyph` rule, all pointing at `packages/brand/theme.css` tokens (CIG slides
 * 8-9: sun, water and bolt use their `-lift` tokens on dark). `mono` repaints every stroke in
 * `currentColor` and drops every fill, for the night screen and the tinted widgets.
 *
 * It does not extend `BeanieIcon`: that paints every path in `currentColor` with a single
 * `filled` flag and has no per-part roles. `mono` is the `BeanieIcon`-like mode.
 *
 * Size: `size` is the nominal px size, which picks the stroke step (thinner as it grows). The
 * box itself is set in rem from it (so Large reading mode scales a glyph beside its text) as SVG
 * presentation attributes, so a parent can still size it from CSS (`.weather-glyph { width:
 * var(--wx-glyph) }`) without fighting an inline style.
 */
import { computed } from 'vue';
import {
  WEATHER_GLYPH_PARTS,
  WEATHER_GLYPH_VIEWBOX,
  weatherGlyphStrokeWidth,
  type WeatherGlyphRole,
} from '@/constants/weatherGlyphs';
import type { WeatherGlyph } from '@/types/weather';

const props = withDefaults(
  defineProps<{
    kind: WeatherGlyph;
    /** Nominal size in px (the stroke rule's input); rendered in rem. */
    size?: number;
    /** Every stroke `currentColor`, every fill transparent. */
    mono?: boolean;
  }>(),
  { size: 24, mono: false }
);

/** One class per role, so the stylesheet below has exactly one rule per role. */
const ROLE_CLASS: Record<WeatherGlyphRole, string> = {
  ink: 'wx-ink',
  sun: 'wx-sun',
  sunRays: 'wx-sun-rays',
  water: 'wx-water',
  bolt: 'wx-bolt',
  snow: 'wx-snow',
  fog: 'wx-fog',
  moon: 'wx-moon',
  star: 'wx-star',
};

const parts = computed(() => WEATHER_GLYPH_PARTS[props.kind] ?? WEATHER_GLYPH_PARTS.cloudy);
const box = computed(() => `${props.size / 16}rem`);
const strokeWidth = computed(() => weatherGlyphStrokeWidth(props.size));
</script>

<template>
  <svg
    class="weather-glyph"
    :class="{ 'weather-glyph-mono': mono }"
    :data-kind="kind"
    :width="box"
    :height="box"
    :viewBox="WEATHER_GLYPH_VIEWBOX"
    :stroke-width="strokeWidth"
    aria-hidden="true"
    focusable="false"
  >
    <template v-for="(part, i) in parts" :key="i">
      <circle
        v-if="part.circle"
        :class="ROLE_CLASS[part.role]"
        :cx="part.circle.cx"
        :cy="part.circle.cy"
        :r="part.circle.r"
        :transform="part.transform"
        :stroke-width="part.strokeWidth"
      />
      <path
        v-else
        :class="ROLE_CLASS[part.role]"
        :d="part.d"
        :transform="part.transform"
        :stroke-width="part.strokeWidth"
      />
    </template>
  </svg>
</template>

<style scoped>
/* Light: deep slate strokes (Sky Silk is 1.4:1 on white, so water is slate too), Heritage
   Orange sun (3.32 on white clears the 3:1 graphics floor), Terracotta bolt with the ink
   outline carrying its shape. `#eaf4fc` is the wall chores-card tint (WallCard.vue), which has
   no theme token. */
.weather-glyph {
  --wx-bolt: var(--color-terracotta-400);
  --wx-fill: #eaf4fc;
  --wx-fog: var(--color-secondary-400);
  --wx-ink: var(--color-secondary-500);
  --wx-moonfill: var(--color-sky-silk-100);
  --wx-snow: var(--color-secondary-500);
  --wx-sun: var(--color-primary-500);
  --wx-sunfill: var(--color-primary-100);
  --wx-water: var(--color-secondary-500);

  display: block;
  flex: none;
  overflow: visible;
}

/* Dark (CIG slides 8-9): strokes step to ink-soft, every meaningful accent to its -lift. */
html.dark .weather-glyph {
  --wx-bolt: var(--color-terracotta-lift);
  --wx-fill: var(--color-surface-hover);
  --wx-fog: var(--color-ink-faint);
  --wx-ink: var(--color-ink-soft);
  --wx-moonfill: var(--color-surface-overlay);
  --wx-snow: var(--color-ink);
  --wx-sun: var(--color-accent-lift);
  --wx-sunfill: color-mix(in srgb, var(--color-accent-lift) 20%, transparent);
  --wx-water: var(--color-silk-lift);
}

/* Mono wins in both themes: it sits after the dark rule at the same specificity. */
.weather-glyph-mono,
html.dark .weather-glyph-mono {
  --wx-bolt: transparent;
  --wx-fill: transparent;
  --wx-fog: currentcolor;
  --wx-ink: currentcolor;
  --wx-moonfill: transparent;
  --wx-snow: currentcolor;
  --wx-sun: currentcolor;
  --wx-sunfill: transparent;
  --wx-water: currentcolor;
}

.wx-ink {
  fill: var(--wx-fill);
  stroke: var(--wx-ink);
  stroke-linecap: round;
  stroke-linejoin: round;
}

.wx-sun {
  fill: var(--wx-sunfill);
  stroke: var(--wx-sun);
  stroke-linecap: round;
}

.wx-sun-rays {
  fill: none;
  stroke: var(--wx-sun);
  stroke-linecap: round;
}

.wx-water {
  fill: none;
  stroke: var(--wx-water);
  stroke-linecap: round;
}

.wx-bolt {
  fill: var(--wx-bolt);
  stroke: var(--wx-ink);
  stroke-linejoin: round;
}

.wx-snow {
  fill: none;
  stroke: var(--wx-snow);
  stroke-linecap: round;
}

.wx-fog {
  fill: none;
  stroke: var(--wx-fog);
  stroke-linecap: round;
}

.wx-moon {
  fill: var(--wx-moonfill);
  stroke: var(--wx-ink);
  stroke-linejoin: round;
}

.wx-star {
  fill: none;
  stroke: var(--wx-ink);
  stroke-linecap: round;
}
</style>
