<script setup lang="ts">
/**
 * ExportSheet — the reusable one-page "paper" shell for a shareable export.
 *
 * A landscape Cloud-White sheet with a soft Heritage-Orange→Terracotta header
 * (heading + Caveat accent on the left; "week of" + the date range, then the
 * family-hugging mark, on the right) and a brand footer (a slotted legend on the
 * left; the father-son logo mark + right-justified wordmark with the tagline
 * stacked below it, on the right — a different mark from the header so the two
 * don't repeat). The body is a `<slot>`, so #66's weekly agenda reuses this
 * shell unchanged.
 *
 * All strings arrive already-resolved via `t()` from the caller, so this stays
 * i18n-agnostic and pure. It is rendered OFF-SCREEN and rasterised by
 * `useSheetExport`; never part of the normal interactive tree.
 *
 * Height is content-driven (fixed WIDTH only, no fixed height / overflow clip)
 * so a packed week can never clip a cell; the PDF path scales-to-fit one page.
 * Fixed-size print artifact — type is px-pinned on purpose so the export never
 * rescales with the app's text-size mode (documented decorative opt-out).
 */
withDefaults(
  defineProps<{
    /** Left heading, e.g. "This week's meals". Already t()-resolved. */
    heading: string;
    /** Optional Caveat accent beside the heading, e.g. "what's cooking? 🌱". */
    accent?: string;
    /** Small kicker above the range, e.g. "week of". */
    dateLabel: string;
    /** The anchor line — the week the sheet covers, e.g. "17 – 23 Aug 2026". */
    dateRange: string;
    /** Wordmark tagline (t('app.tagline')). */
    tagline?: string;
  }>(),
  { accent: '', tagline: '' }
);
</script>

<template>
  <div class="export-sheet">
    <header class="export-header">
      <h2 class="export-heading">{{ heading }}</h2>
      <span v-if="accent" class="export-accent">{{ accent }}</span>
      <span class="export-spacer" />
      <span class="export-dates">
        <span class="export-dates-label">{{ dateLabel }}</span>
        <span class="export-dates-range">{{ dateRange }}</span>
      </span>
      <img
        class="export-mark"
        src="/brand/beanies_family_hugging_transparent_192x192.png"
        alt="beanies.family"
      />
    </header>

    <main class="export-body">
      <slot />
    </main>

    <footer class="export-footer">
      <div class="export-legend"><slot name="legend" /></div>
      <span class="export-spacer" />
      <div class="export-brand">
        <img
          class="export-brand-mark"
          src="/brand/beanies_logo_transparent_logo_only_192x192.png"
          alt="beanies.family"
        />
        <span class="export-brand-text">
          <span class="export-wordmark">beanies<span class="export-tld">.family</span></span>
          <span v-if="tagline" class="export-tagline">{{ tagline }}</span>
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* stylelint-disable declaration-property-value-disallowed-list -- fixed-size print
   artifact: px is intentional so the export never rescales with the app text-size
   mode (documented decorative opt-out). */
.export-sheet {
  background: #f8f9fa;
  box-sizing: border-box;
  color: #2c3e50;
  display: flex;
  flex-direction: column;
  font-family: Inter, system-ui, sans-serif;
  width: 1123px;
}

.export-header {
  align-items: center;
  background: linear-gradient(135deg, rgb(241 93 34 / 8%), rgb(230 126 34 / 12%));
  border-bottom: 1px solid rgb(241 93 34 / 14%);
  display: flex;
  gap: 14px;
  padding: 22px 30px;
}

.export-mark {
  flex-shrink: 0;
  height: 54px;
  object-fit: contain;
  width: 54px;
}

.export-heading {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
  margin: 0;
}

.export-accent {
  color: #f15d22;
  font-family: Caveat, cursive;
  font-size: 22px;
  font-weight: 700;
}

.export-spacer {
  flex: 1;
}

.export-dates {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}

.export-dates-label {
  color: #d14d1a;
  font-family: Outfit, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.export-dates-range {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.export-body {
  display: flex;
  flex-direction: column;
  padding: 16px 20px 8px;
}

.export-footer {
  align-items: center;
  border-top: 1px solid rgb(44 62 80 / 8%);
  display: flex;
  gap: 16px;
  padding: 12px 30px 16px;
}

.export-legend {
  align-items: center;
  color: rgb(44 62 80 / 55%);
  display: flex;
  flex-wrap: wrap;
  font-size: 12px;
  gap: 14px;
}

.export-brand {
  align-items: center;
  display: flex;
  gap: 10px;
}

.export-brand-mark {
  height: 36px;
  object-fit: contain;
  width: 36px;
}

.export-brand-text {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}

.export-wordmark {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 16px;
  font-weight: 700;
}

.export-tld {
  color: #f15d22;
}

.export-tagline {
  color: rgb(44 62 80 / 42%);
  font-family: Outfit, sans-serif;
  font-size: 12px;
  font-style: italic;
  letter-spacing: 0.04em;
}
</style>
