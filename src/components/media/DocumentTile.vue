<script setup lang="ts">
/**
 * Boarding-pass-stub visual for a PDF (non-image) attachment tile.
 * Treatment A from docs/mockups/travel-segment-attachments-2026-06-04.html:
 * a Heritage Orange → Terracotta ticket edge, a perforated tear line, and a
 * "PDF · <filename>" footer.
 *
 * Presentational only — it fills its container (the wrapper, e.g.
 * PhotoThumbnail, owns the click / open affordance and the tile footprint).
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{ fileName?: string }>();
const { t } = useTranslation();

const ariaLabel = computed(() =>
  props.fileName
    ? t('photos.document.tileNamed').replace('{name}', props.fileName)
    : t('photos.document.tile')
);
</script>

<template>
  <div
    class="relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-[var(--card-shadow)] dark:bg-slate-700"
    role="img"
    :aria-label="ariaLabel"
  >
    <!-- Heritage Orange → Terracotta ticket edge -->
    <div class="from-primary-500 to-terracotta-400 h-1.5 w-full bg-gradient-to-r"></div>
    <!-- Document glyph -->
    <div class="flex flex-1 items-center justify-center text-2xl" aria-hidden="true">📄</div>
    <!-- Perforated tear line + PDF · filename footer. The sub-text-xs sizing
         matches the existing tile labels in PhotoThumbnail (pending label). -->
    <div
      class="flex items-center gap-1 border-t border-dashed border-[var(--tint-slate-10)] px-1.5 py-1"
    >
      <span class="text-primary-600 dark:text-primary-300 font-outfit text-[0.5rem] font-bold"
        >PDF</span
      >
      <span
        v-if="fileName"
        class="truncate text-[0.5rem] text-[var(--color-text-muted)]"
        :title="fileName"
        >{{ fileName }}</span
      >
    </div>
  </div>
</template>
