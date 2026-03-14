<script setup lang="ts">
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useTranslation } from '@/composables/useTranslation';
import InfoHintBadge from '@/components/ui/InfoHintBadge.vue';

defineProps<{
  /** Use light-on-dark styling for dark card backgrounds */
  dark?: boolean;
}>();

const { unlock } = usePrivacyMode();
const { t } = useTranslation();
</script>

<template>
  <div class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
    <button
      class="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
      :class="
        dark
          ? 'bg-white/10 text-white/80 hover:bg-white/20'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-slate-600 dark:text-gray-300 dark:hover:bg-slate-500'
      "
      @click="unlock"
    >
      <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
        <path
          fill-rule="evenodd"
          d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
          clip-rule="evenodd"
        />
      </svg>
      {{ t('nook.showFigures') }}
    </button>
    <InfoHintBadge :text="t('hints.nookFiguresHidden')" :dark="dark" />
  </div>
</template>
