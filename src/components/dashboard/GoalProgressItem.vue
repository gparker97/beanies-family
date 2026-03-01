<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

interface Props {
  /** Goal icon emoji */
  icon?: string;
  /** Icon background tint — 'orange' | 'silk' | 'slate' */
  iconTint?: 'orange' | 'silk' | 'slate';
  /** Goal name */
  name: string;
  /** Current amount saved */
  currentAmount: number;
  /** Target amount */
  targetAmount: number;
  /** Currency code */
  currency: CurrencyCode;
  /** Use the silk-coloured progress bar instead of the default orange */
  silkBar?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  icon: '🎯',
  iconTint: 'orange',
  silkBar: false,
});

const { isUnlocked, MASK } = usePrivacyMode();
const { convertToDisplay } = useCurrencyDisplay();

const currentConverted = computed(() => convertToDisplay(props.currentAmount, props.currency));
const targetConverted = computed(() => convertToDisplay(props.targetAmount, props.currency));

const progress = computed(() => {
  if (props.targetAmount <= 0) return 0;
  return Math.min(100, Math.round((props.currentAmount / props.targetAmount) * 100));
});

const tintBg = computed(() => {
  switch (props.iconTint) {
    case 'orange':
      return 'bg-[var(--tint-orange-8)]';
    case 'silk':
      return 'bg-[var(--tint-silk-20)]';
    case 'slate':
      return 'bg-[var(--tint-slate-5)]';
    default:
      return 'bg-[var(--tint-orange-8)]';
  }
});
</script>

<template>
  <div
    class="flex items-center gap-3.5 border-b border-[var(--tint-slate-5)] py-3.5 last:border-b-0"
  >
    <!-- Icon -->
    <div
      class="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[14px] text-xl"
      :class="tintBg"
    >
      {{ icon }}
    </div>

    <!-- Info + progress -->
    <div class="min-w-0 flex-1">
      <div class="font-outfit text-secondary-500 text-sm font-semibold dark:text-gray-100">
        {{ name }}
      </div>
      <div class="text-secondary-500/40 mt-0.5 text-xs dark:text-gray-400">
        <template v-if="isUnlocked">
          {{ currentConverted.displayFormatted }} of {{ targetConverted.displayFormatted }}
        </template>
        <template v-else>{{ MASK }}</template>
      </div>
      <!-- Progress bar -->
      <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--tint-slate-5)]">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="
            silkBar
              ? 'from-sky-silk-300 bg-gradient-to-r to-[#7FB8E0]'
              : 'from-primary-500 to-terracotta-400 bg-gradient-to-r'
          "
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>

    <!-- Percentage -->
    <div
      class="font-outfit text-secondary-500 flex-shrink-0 text-right text-sm font-bold dark:text-gray-200"
    >
      {{ progress }}%
    </div>
  </div>
</template>
