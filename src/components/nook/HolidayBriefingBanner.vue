<script setup lang="ts">
import { computed } from 'vue';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToday } from '@/composables/useToday';
import { useTranslation } from '@/composables/useTranslation';
import { getHolidayGreeting, getHolidayEmoji } from '@/utils/holidayGreeting';

const holidayStore = useHolidayStore();
const settingsStore = useSettingsStore();
const { today } = useToday();
const { t } = useTranslation();

const holiday = computed(() => {
  if (!settingsStore.showPublicHolidays) return undefined;
  return holidayStore.holidayForDate(today.value);
});

const greeting = computed(() => (holiday.value ? getHolidayGreeting(holiday.value, t) : ''));
const emoji = computed(() => (holiday.value ? getHolidayEmoji(holiday.value) : ''));
</script>

<template>
  <div v-if="holiday" class="holiday-banner" role="status">
    <span class="holiday-banner-emoji" aria-hidden="true">{{ emoji }}</span>
    <div class="min-w-0 flex-1">
      <p class="font-outfit text-secondary-700 dark:text-secondary-200 text-sm font-semibold">
        {{ greeting }}
      </p>
      <p class="text-secondary-500/80 dark:text-secondary-300/70 mt-0.5 text-xs">
        {{ t('nook.holiday.banner.caption') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.holiday-banner {
  align-items: center;
  animation: holiday-banner-fade-in 320ms ease-out;
  background: linear-gradient(
    135deg,
    var(--color-sky-silk-100, #daeef9) 0%,
    var(--color-sky-silk-50, #ebf6fc) 100%
  );
  border: 1px solid var(--color-sky-silk-200, #c5e2f5);
  border-radius: 1rem;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
}

.holiday-banner-emoji {
  align-items: center;
  background: rgb(255 255 255 / 60%);
  border-radius: 50%;
  display: inline-flex;
  flex-shrink: 0;
  font-size: 1.25rem;
  height: 2.25rem;
  justify-content: center;
  width: 2.25rem;
}

@keyframes holiday-banner-fade-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .holiday-banner {
    animation: none;
  }
}

:global(.dark) .holiday-banner {
  background: linear-gradient(135deg, rgb(174 214 241 / 12%) 0%, rgb(174 214 241 / 6%) 100%);
  border-color: rgb(174 214 241 / 22%);
}

:global(.dark) .holiday-banner-emoji {
  background: rgb(255 255 255 / 10%);
}
</style>
