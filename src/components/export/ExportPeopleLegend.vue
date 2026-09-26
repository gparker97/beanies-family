<script setup lang="ts">
/**
 * ExportPeopleLegend — the footer-left legend for an export sheet: a label, the
 * distinct people on the sheet (initial chip + name) plus a muted key. Slotted
 * into `ExportSheet`'s `#legend` by every sheet (the meal plan's cooks, the
 * responsibility deck's holders). Dumb/px-pinned like the other export views;
 * all text arrives resolved.
 */
import type { ExportPerson } from '@/utils/mealExportModel';

defineProps<{
  /** e.g. "Cooks". */
  label: string;
  people: ExportPerson[];
  /**
   * A sheet-specific key, e.g. "⏰ serve time · 👥 guests" — or only one half, or empty.
   *
   * The caller builds it from what the sheet contains, so a key is never printed for a
   * symbol that is not on the page.
   */
  hint: string;
}>();
</script>

<template>
  <div class="legend">
    <span v-if="people.length" class="people">
      <b class="people-label">{{ label }}</b>
      <span v-for="c in people" :key="c.initial + c.name" class="chip">
        <span class="dot" :style="{ background: c.color || '#2C3E50' }">{{ c.initial }}</span>
        <span>{{ c.name }}</span>
      </span>
    </span>
    <span v-if="hint" class="hint">{{ hint }}</span>
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

.people {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.people-label {
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
   * people share a first letter — which is the whole reason the printed chip can lose its
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
