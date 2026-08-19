<script setup lang="ts">
/**
 * ExportSheet — the reusable one-page "paper" shell for a shareable export.
 *
 * A fixed landscape-A4 Cloud-White sheet with a soft Heritage-Orange→Terracotta
 * header (kicker + prominent date range + hugging beanies mark) and a brand
 * footer (the Pod + wordmark + tagline). The body is a `<slot>`, so #66's weekly
 * agenda reuses this shell unchanged — only the slotted body differs.
 *
 * All strings arrive already-resolved via `t()` from the caller, so this stays
 * i18n-agnostic and pure. It is rendered OFF-SCREEN and rasterised by
 * `useSheetExport`; it is never part of the normal interactive page tree.
 *
 * Fixed-size print artifact: dimensions and type are px-pinned on purpose so the
 * exported image/PDF is identical regardless of the app's text-size mode and
 * never overflows the A4 box. This is the documented "fixed-size decorative"
 * opt-out from the rem-based text-scale rule.
 */
withDefaults(
  defineProps<{
    /** Small kicker above the date range, e.g. "🍲 Meal plan". Already t()-resolved. */
    title: string;
    /** The hero line — the week the sheet covers, e.g. "Aug 18 – 24". */
    dateRange: string;
    /** Optional line under the date range. */
    subtitle?: string;
    /** Wordmark tagline (t('app.tagline')). */
    tagline?: string;
  }>(),
  { subtitle: '', tagline: '' }
);

/** The Pod — four beans, always Slate → Terracotta → Orange → Sky Silk. */
const POD = ['#2C3E50', '#E67E22', '#F15D22', '#AED6F1'];
</script>

<template>
  <div class="export-sheet">
    <header class="export-header">
      <div class="export-header-text">
        <p class="export-kicker">{{ title }}</p>
        <p class="export-dates">{{ dateRange }}</p>
        <p v-if="subtitle" class="export-subtitle">{{ subtitle }}</p>
      </div>
      <img
        class="export-mark"
        src="/brand/beanies_logo_transparent_192x192.png"
        alt="beanies.family"
      />
    </header>

    <main class="export-body">
      <slot />
    </main>

    <footer class="export-footer">
      <div class="export-pod" aria-hidden="true">
        <span v-for="(c, i) in POD" :key="i" class="export-bean" :style="{ background: c }" />
      </div>
      <p class="export-wordmark"><span>beanies</span><span class="export-tld">.family</span></p>
      <p v-if="tagline" class="export-tagline">{{ tagline }}</p>
    </footer>
  </div>
</template>

<style scoped>
/* stylelint-disable declaration-property-value-disallowed-list -- fixed-size print
   artifact: px is intentional so the export never rescales with the app text-size
   mode and always fits the A4 box (documented decorative opt-out). */
.export-sheet {
  background: #f8f9fa;
  box-sizing: border-box;
  color: #2c3e50;
  display: flex;
  flex-direction: column;
  font-family: Inter, system-ui, sans-serif;
  gap: 20px;
  height: 794px;
  padding: 34px 38px 26px;
  width: 1123px;
}

.export-header {
  align-items: center;
  background: linear-gradient(135deg, rgb(241 93 34 / 14%) 0%, rgb(230 126 34 / 12%) 100%);
  border-radius: 24px;
  display: flex;
  gap: 20px;
  justify-content: space-between;
  padding: 22px 30px;
}

.export-header-text {
  min-width: 0;
}

.export-kicker {
  color: rgb(44 62 80 / 65%);
  font-family: Outfit, sans-serif;
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}

.export-dates {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 40px;
  font-weight: 800;
  line-height: 1.1;
  margin: 2px 0 0;
}

.export-subtitle {
  color: rgb(44 62 80 / 60%);
  font-size: 16px;
  margin: 4px 0 0;
}

.export-mark {
  flex-shrink: 0;
  height: 76px;
  object-fit: contain;
  width: 76px;
}

.export-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.export-footer {
  align-items: center;
  display: flex;
  gap: 10px;
}

.export-pod {
  display: flex;
  gap: 4px;
}

.export-bean {
  border-radius: 999px;
  height: 12px;
  width: 12px;
}

.export-wordmark {
  color: #2c3e50;
  font-family: Outfit, sans-serif;
  font-size: 16px;
  font-weight: 700;
  margin: 0;
}

.export-tld {
  color: #f15d22;
}

.export-tagline {
  color: rgb(44 62 80 / 45%);
  font-family: Outfit, sans-serif;
  font-size: 13px;
  font-style: italic;
  letter-spacing: 0.06em;
  margin: 0;
}
</style>
