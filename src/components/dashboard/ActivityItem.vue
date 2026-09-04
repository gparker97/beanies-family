<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';
import { useCurrencyDisplay } from '@/composables/useCurrencyDisplay';
import type { CurrencyCode } from '@/types/models';

interface Props {
  /** Icon emoji */
  icon?: string;
  /** Icon background tint — 'orange' | 'silk' | 'green' | 'slate' */
  iconTint?: 'orange' | 'silk' | 'green' | 'slate';
  /** Transaction name */
  name: string;
  /** Subtitle (e.g., "Tomorrow, auto-debit") */
  subtitle: string;
  /** Amount (positive or negative) */
  amount: number;
  /** Currency code */
  currency: CurrencyCode;
  /** Amount colour type */
  type?: 'income' | 'expense' | 'neutral';
}

const props = withDefaults(defineProps<Props>(), {
  icon: '💰',
  iconTint: 'orange',
  type: 'neutral',
});

const { isUnlocked, MASK } = usePrivacyMode();
const { convertToDisplay } = useCurrencyDisplay();

const converted = computed(() => convertToDisplay(Math.abs(props.amount), props.currency));

const tintBg = computed(() => {
  switch (props.iconTint) {
    case 'orange':
      return 'bg-[var(--tint-orange-8)]';
    case 'silk':
      return 'bg-[var(--tint-silk-20)]';
    case 'green':
      return 'bg-[var(--tint-success-10)]';
    case 'slate':
      return 'bg-[var(--tint-slate-5)]';
    default:
      return 'bg-[var(--tint-orange-8)]';
  }
});

const amountPrefix = computed(() => {
  if (props.type === 'expense') return '-';
  if (props.type === 'income') return '+';
  return props.amount < 0 ? '-' : '';
});
</script>

<template>
  <div class="flex items-center gap-3 border-b border-[var(--tint-slate-5)] py-3 last:border-b-0">
    <!-- Icon -->
    <div
      class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm"
      :class="tintBg"
    >
      {{ icon }}
    </div>

    <!-- Info -->
    <div class="min-w-0 flex-1">
      <div class="text-secondary-500 dark:text-ink text-sm font-semibold">
        {{ name }}
      </div>
      <div class="text-secondary-500/35 dark:text-ink-faint text-xs">
        {{ subtitle }}
      </div>
    </div>

    <!-- Amount -->
    <div class="font-outfit text-secondary-500 dark:text-ink flex-shrink-0 text-sm font-bold">
      <template v-if="isUnlocked">{{ amountPrefix }}{{ converted.displayFormatted }}</template>
      <template v-else>{{ MASK }}</template>
    </div>
  </div>
</template>
