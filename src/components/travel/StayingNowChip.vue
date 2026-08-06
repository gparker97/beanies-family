<script setup lang="ts">
/**
 * "Staying now" chip shown above an ongoing multi-day segment (a stay/cruise/
 * rental whose span contains today). Heritage Orange — the only orange on the
 * teal travel surface — echoing the "you are here" language of the day-level
 * TodayTimelineMarker, but for a booking that spans the day boundary. The live
 * dot uses the shared `.live-dot` pulse (suppressed under reduced motion).
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatDateShort } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ endDate: string }>();

const { t } = useTranslation();

const untilLabel = computed(() =>
  fillTemplate(t('travel.timeline.until'), { date: formatDateShort(props.endDate) })
);
</script>

<template>
  <div class="staying-now" role="status">
    <span class="live-dot" aria-hidden="true" />
    <span>{{ t('travel.timeline.stayingNow') }}</span>
    <span class="staying-now-sep" aria-hidden="true">·</span>
    <span class="staying-now-until">{{ untilLabel }}</span>
  </div>
</template>

<style scoped>
.staying-now {
  align-items: center;
  background: rgb(241 93 34 / 10%);
  border-radius: 9999px;
  color: var(--heritage-orange, #f15d22);
  display: inline-flex;
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  gap: 0.375rem;
  margin: 0.125rem 0 0.5rem;
  padding: 0.1875rem 0.625rem;
}

.staying-now-sep {
  opacity: 0.5;
}

.staying-now-until {
  font-weight: 600;
}

.live-dot {
  background: var(--heritage-orange, #f15d22);
  border-radius: 50%;
  height: 0.4375rem;
  width: 0.4375rem;
}
</style>
