<script setup lang="ts">
import { computed } from 'vue';
import ChipButton from './ChipButton.vue';

export interface ChipOption {
  value: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  disabledHint?: string;
  /** Dimmed trailing count. `0` renders; only an absent badge is hidden. */
  badge?: string | number;
}

interface Props {
  modelValue: string;
  options: ChipOption[];
  disabled?: boolean;
  /** Selected-chip accent. Defaults to Heritage Orange; 'purple' for to-do surfaces. */
  accent?: 'orange' | 'purple';
  /**
   * `'wrap'` (default) is the original behaviour: chips flow onto more rows.
   *
   * `'scroll'` keeps them on ONE row that scrolls horizontally inside itself. Wrapping an
   * `flex-wrap` row in `overflow-x-auto` does not do this — it still wraps — so a row that
   * must not grow taller on a 375px phone needs this mode, not a wrapper div.
   */
  layout?: 'wrap' | 'scroll';
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const rowClass = computed(() =>
  props.layout === 'scroll'
    ? 'flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    : 'flex flex-wrap gap-1.5'
);
</script>

<template>
  <div :class="rowClass">
    <ChipButton
      v-for="opt in options"
      :key="opt.value"
      :label="opt.label"
      :icon="opt.icon"
      :badge="opt.badge"
      :selected="modelValue === opt.value"
      :disabled="disabled || opt.disabled"
      :disabled-hint="opt.disabledHint"
      :accent="accent"
      class="shrink-0"
      @click="emit('update:modelValue', opt.value)"
    />
  </div>
</template>
