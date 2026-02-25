<script setup lang="ts">
import { computed } from 'vue';
import { usePrivacyMode } from '@/composables/usePrivacyMode';

interface Props {
  /** Stat label */
  label: string;
  /** Pre-formatted display value (e.g. from formatMasked) */
  value: string;
  /** Color tint — 'green' | 'orange' | 'slate' | 'purple' */
  tint?: 'green' | 'orange' | 'slate' | 'purple';
  /** Dark variant (inverted colors) */
  dark?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  tint: 'slate',
  dark: false,
});

const { isUnlocked, MASK } = usePrivacyMode();

const displayValue = computed(() => (isUnlocked.value ? props.value : MASK));
</script>

<template>
  <div
    class="rounded-[var(--sq)] p-5 shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]"
    :class="
      dark
        ? 'from-secondary-500 bg-gradient-to-br to-[#3D5368] text-white'
        : 'bg-white dark:bg-slate-800'
    "
  >
    <div
      class="nook-section-label mb-3"
      :class="dark ? 'text-white' : 'text-secondary-500 dark:text-gray-400'"
    >
      {{ label }}
    </div>
    <div
      class="font-outfit text-2xl font-extrabold"
      :class="dark ? '' : 'text-secondary-500 dark:text-gray-100'"
    >
      {{ displayValue }}
    </div>
  </div>
</template>
