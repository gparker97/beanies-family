<script setup lang="ts">
/**
 * A labelled switch row: title, optional hint, and a `ToggleSwitch` on the right whose
 * accessible name is the title. Markup and tokens are `CardEditDrawer`'s skip row, lifted
 * unchanged. The default slot renders under the hint, inside the text column (for a short
 * summary line beside the switch).
 */
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';

withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    hint?: string;
    disabled?: boolean;
    /** `data-testid` for the switch itself. */
    testid?: string;
  }>(),
  { hint: '', disabled: false, testid: undefined }
);

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <div class="flex items-center justify-between gap-4">
    <div class="min-w-0">
      <p class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]">
        {{ title }}
      </p>
      <p v-if="hint" class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        {{ hint }}
      </p>
      <slot />
    </div>
    <ToggleSwitch
      :model-value="modelValue"
      :disabled="disabled"
      :aria-label="title"
      :data-testid="testid"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>
