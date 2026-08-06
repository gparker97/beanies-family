<script setup lang="ts">
/**
 * "When" hero band shown at the top of an expanded travel-segment card. Leads
 * with the segment's date/time — the info you scan for first — as one cell
 * ("starts") or two ("departs → arrives" / "check-in → check-out" etc). Purely
 * presentational: it formats the raw values the composable put on `item.timing.band`.
 * Stays inside the ocean-teal travel identity.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort, formatTime12 } from '@/utils/date';
import type { WhenBand, WhenCell } from '@/utils/vacation';

const props = defineProps<{ band: WhenBand }>();

const { t } = useTranslation();

/** big line = the time when present, else the date; sub = the date under a time. */
function primary(cell: WhenCell): string {
  if (cell.time) return formatTime12(cell.time);
  if (cell.date) return formatDateShort(cell.date);
  return '';
}
function secondary(cell: WhenCell): string {
  return cell.time && cell.date ? formatDateShort(cell.date) : '';
}

const hasEnd = computed(() => !!props.band.end);
</script>

<template>
  <div class="when-band" :class="{ 'when-band--single': !hasEnd }">
    <div class="when-cell">
      <div class="when-cap">{{ t(band.start.captionKey) }}</div>
      <div class="font-outfit when-big">{{ primary(band.start) }}</div>
      <div v-if="secondary(band.start)" class="when-sub">{{ secondary(band.start) }}</div>
    </div>

    <template v-if="band.end">
      <div class="when-arrow" aria-hidden="true">→</div>
      <div class="when-cell">
        <div class="when-cap">
          {{ t(band.end.captionKey) }}
          <span v-if="band.end.nextDay" class="when-nextday">{{
            t('travel.timeline.nextDay')
          }}</span>
        </div>
        <div class="font-outfit when-big">{{ primary(band.end) }}</div>
        <div v-if="secondary(band.end)" class="when-sub">{{ secondary(band.end) }}</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.when-band {
  align-items: stretch;
  border: 1px solid rgb(0 180 216 / 28%);
  border-radius: 0.875rem;
  display: flex;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.when-cell {
  background: rgb(0 180 216 / 6%);
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.875rem;
}

.when-cell + .when-cell {
  border-left: 1px solid rgb(0 180 216 / 18%);
}

.when-cap {
  align-items: center;
  color: #0077b6;
  display: flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.375rem;
  letter-spacing: 0.08em;
  margin-bottom: 0.125rem;
  text-transform: uppercase;
}

.when-nextday {
  color: var(--heritage-orange, #f15d22);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: normal;
  text-transform: none;
}

.when-big {
  color: var(--color-text, #1f2b38);
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.15;
}

.when-sub {
  color: var(--color-text-muted, #7a8b99);
  font-size: 0.75rem;
  margin-top: 0.0625rem;
}

.when-arrow {
  align-items: center;
  background: rgb(0 180 216 / 6%);
  color: #00b4d8;
  display: flex;
  font-size: 1rem;
  padding: 0 0.375rem;
}

:global(.dark) .when-cell,
:global(.dark) .when-arrow {
  background: rgb(0 180 216 / 10%);
}
</style>
