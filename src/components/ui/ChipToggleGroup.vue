<script setup lang="ts">
import { computed } from 'vue';
import ChipButton from './ChipButton.vue';
import type { ChipOption } from './FrequencyChips.vue';

/**
 * MULTI-select chips — the sibling of `FrequencyChips`, sharing its `ChipOption` shape and its
 * `ChipButton` rendering, differing only in that `modelValue` is an array and a second tap
 * removes.
 *
 * A separate component rather than a `multiple` flag on `FrequencyChips`: see `ChipButton`'s
 * header for why, and note the app already splits single from multi this way
 * (`FrequencyChips`/`TogglePillGroup` vs `DayOfWeekSelector`/`BaseMultiSelect`).
 *
 * ⚠️ Emits a NEW array; it never mutates `modelValue` in place. The parent may be holding an
 * Automerge-projected array, and mutating one of those in place skips the CRDT write entirely.
 */
interface Props {
  modelValue: readonly string[];
  options: ChipOption[];
  disabled?: boolean;
  accent?: 'orange' | 'purple';
  layout?: 'wrap' | 'scroll';
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const rowClass = computed(() =>
  props.layout === 'scroll'
    ? 'flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    : 'flex flex-wrap gap-1.5'
);

function toggle(value: string) {
  const next = props.modelValue.includes(value)
    ? props.modelValue.filter((v) => v !== value)
    : [...props.modelValue, value];
  emit('update:modelValue', next);
}
</script>

<template>
  <div :class="rowClass">
    <ChipButton
      v-for="opt in options"
      :key="opt.value"
      :label="opt.label"
      :icon="opt.icon"
      :badge="opt.badge"
      :selected="modelValue.includes(opt.value)"
      :disabled="disabled || opt.disabled"
      :disabled-hint="opt.disabledHint"
      :accent="accent"
      class="shrink-0"
      @click="toggle(opt.value)"
    />
  </div>
</template>
