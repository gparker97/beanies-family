<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  modelValue: number | undefined;
  currencySymbol?: string;
  fontSize?: string;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currencySymbol: '$',
  fontSize: '1.4rem',
  label: undefined,
});

const emit = defineEmits<{
  'update:modelValue': [value: number | undefined];
}>();

const displayValue = computed(() => {
  if (props.modelValue === undefined || props.modelValue === null) return '';
  return String(props.modelValue);
});

// iOS auto-zooms the WKWebView when a focused text field computes to < 16px and
// does not reliably zoom back (a stuck zoom that only a force-quit clears). Floor
// the applied size at 1rem (16px in default mode) so focusing the amount field
// never triggers it, WITHOUT capping intentionally-larger callers (default 1.4rem
// stays 1.4rem). rem-based, so Large reading mode still scales via the root; never
// uses maximum-scale/user-scalable=no (would kill pinch-zoom + regress WCAG 1.4.4).
const clampedFontSize = computed(() => `max(1rem, ${props.fontSize})`);

function handleInput(event: Event) {
  const target = event.target as HTMLInputElement;
  const val = target.value;
  if (val === '') {
    emit('update:modelValue', undefined);
  } else {
    const num = parseFloat(val);
    if (!isNaN(num)) {
      emit('update:modelValue', num);
    }
  }
}
</script>

<template>
  <div>
    <label
      v-if="label"
      class="font-outfit dark:text-ink-soft mb-2 block text-xs font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35"
    >
      {{ label }}
    </label>
    <div
      class="focus-within:border-primary-500 dark:bg-surface-overlay flex items-center gap-2 rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 transition-all duration-200 focus-within:shadow-[0_0_0_3px_rgba(241,93,34,0.1)]"
    >
      <span
        class="font-outfit dark:text-ink-soft flex-shrink-0 font-bold text-[var(--color-text)] opacity-25"
        :style="{ fontSize: clampedFontSize }"
      >
        {{ currencySymbol }}
      </span>
      <input
        type="number"
        step="0.01"
        min="0"
        class="font-outfit dark:text-ink w-full border-none bg-transparent font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30"
        :style="{ fontSize: clampedFontSize }"
        :value="displayValue"
        placeholder="0.00"
        @input="handleInput"
      />
    </div>
  </div>
</template>
