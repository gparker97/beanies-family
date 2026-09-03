<script setup lang="ts">
/**
 * MealExportLegend — the footer-left legend for the meal export: the distinct
 * cooks (initial chip + name) plus a muted "serve time · guests" key. Slotted
 * into `ExportSheet`'s `#legend`. Dumb/px-pinned like the other export views;
 * all text arrives resolved.
 */
import type { ExportCook } from '@/utils/mealExportModel';

defineProps<{
  /** e.g. "Cooks". */
  cooksLabel: string;
  cooks: ExportCook[];
  /** e.g. "⏰ serve time · 👥 guests". */
  hint: string;
}>();
</script>

<template>
  <div class="legend">
    <span v-if="cooks.length" class="cooks">
      <b class="cooks-label">{{ cooksLabel }}</b>
      <span v-for="c in cooks" :key="c.initial + c.name" class="chip">
        <span class="dot" :style="{ background: c.color || '#2C3E50' }">{{ c.initial }}</span>
        <span>{{ c.name }}</span>
      </span>
    </span>
    <span class="hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
/* stylelint-disable declaration-property-value-disallowed-list -- fixed-size print
   artifact: px is intentional (matches ExportSheet). */
.legend {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}

.cooks {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.cooks-label {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 12px;
}

.chip {
  align-items: center;
  color: rgb(44 62 80 / 60%);
  display: inline-flex;
  font-size: 12px;
  gap: 4px;
}

.dot {
  align-items: center;

  /*
   * A PILL, not a fixed circle. `initialsById` widens an initial to two glyphs whenever two
   * cooks share a first letter — which is the whole reason the printed chip can lose its
   * name and stay readable in greyscale — and "Mi" does not fit a 16px box, so the letters
   * spilled past the coloured ground and read as clipped.
   *
   * One glyph still renders as a circle (min-width == height); two widen the pill and
   * nothing else moves. Same fix the on-screen `MemberChip` took when it grew 16 -> 24px
   * for two-letter initials.
   */
  border-radius: 999px;
  box-sizing: border-box;
  color: #fff;
  display: inline-flex;
  flex: none;
  font-family: Outfit, sans-serif;
  font-size: 10px;
  font-weight: 700;
  height: 16px;
  justify-content: center;
  letter-spacing: 0.01em;
  min-width: 16px;
  padding: 0 3px;
  width: auto;
}

.hint {
  color: rgb(44 62 80 / 42%);
  font-size: 12px;
}
</style>
