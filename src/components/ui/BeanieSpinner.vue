<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface Props {
  size?: SpinnerSize;
  label?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  label: false,
});

const { t } = useTranslation();

const sizeClasses = computed(() => {
  const sizes: Record<SpinnerSize, string> = {
    xs: 'h-4 w-4',
    sm: 'h-6 w-6',
    md: 'h-10 w-10',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24',
  };
  return sizes[props.size];
});

const labelClasses = computed(() => {
  const sizes: Record<SpinnerSize, string> = {
    xs: 'text-xs',
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-sm',
    xl: 'text-base',
  };
  return sizes[props.size];
});
</script>

<template>
  <div class="inline-flex flex-col items-center gap-2">
    <img
      src="/brand/beanies_spinner_transparent_192x192.png"
      :alt="t('action.loading')"
      :class="sizeClasses"
      class="animate-spin"
      style="animation-duration: 1.8s"
    />
    <p v-if="label" :class="labelClasses" class="text-secondary-500/50 dark:text-[#BDC3C7]/50">
      {{ t('action.loading') }}
    </p>
  </div>
</template>
