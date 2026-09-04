<script setup lang="ts">
// One labelled toggle row (title + hint + switch), the pattern repeated across the
// Quick Toggles card and the beanies AI settings. The border treatment is left to the
// parent (some contexts divide between rows, others put a divider above) — this owns only
// the duplicated inner content. Extra content (e.g. a warning line) goes in the default slot.
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';

withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    hint?: string;
    disabled?: boolean;
    /** Forwarded onto the ToggleSwitch root (Vue attribute fallthrough) for test selectors. */
    testid?: string;
    /** Draw a bottom divider (between-rows style). Off for the last row / divider-above contexts. */
    divider?: boolean;
  }>(),
  { disabled: false, divider: false }
);

defineEmits<{ 'update:modelValue': [boolean] }>();
</script>

<template>
  <div
    :class="[
      'flex items-center justify-between py-3.5',
      divider ? 'dark:border-line border-b border-[var(--tint-slate-05)]' : '',
    ]"
  >
    <div>
      <p class="dark:text-ink text-[0.8rem] font-semibold text-[var(--deep-slate)]">
        {{ title }}
      </p>
      <p
        v-if="hint"
        class="dark:text-ink-faint text-[0.65rem] leading-snug text-[var(--deep-slate)]/40"
      >
        {{ hint }}
      </p>
      <slot />
    </div>
    <ToggleSwitch
      :data-testid="testid"
      :model-value="modelValue"
      :disabled="disabled"
      @update:model-value="$emit('update:modelValue', $event)"
    />
  </div>
</template>
