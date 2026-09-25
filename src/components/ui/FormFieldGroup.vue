<script setup lang="ts">
/**
 * Label + control grouping for every form in the app.
 *
 * ACCESSIBILITY — why this associates the label by script rather than by `for`.
 *
 * The label used to be a bare `<label>` with no `for`, and the control lives in a SIBLING
 * slot, so nothing connected them. A screen reader announced every field in the app as
 * "edit, blank": in the flight drawer that is airline, flight number, terminal, departure
 * time and booking reference, all indistinguishable — and because the field set swaps by
 * trip type, counting positions does not rescue it either. ~86 inputs across the travel
 * drawers alone, and every other form besides.
 *
 * The obvious fix — `for` + `:id` — would mean editing every call site and threading an id
 * through wrappers like BaseInput and BaseSelect. Instead the label carries a generated id
 * and we point the slotted control at it with `aria-labelledby`, which:
 *   • needs no change at any call site;
 *   • works through wrapper components, since we find the real control in the DOM;
 *   • leaves an explicit `aria-label`/`aria-labelledby` alone, so a caller that already did
 *     the work keeps winning.
 *
 * Re-applied on update because fields are `v-if`-swapped (the travel drawers change their
 * whole field set with the segment type), so the control under this group can be replaced
 * after mount.
 *
 * VALIDATION CONTRACT with `useFormValidation`. The root carries `data-form-label` (this
 * group's label, which the "still needed" toast prints verbatim) and receives
 * `data-form-field` by attribute fallthrough from `v-bind="v.bind('x')"`, which is the element
 * the composable scrolls to and pulses. `errorMessage` is the one-line reason under the control.
 * The root is `rounded-2xl` so the attention pulse follows the same shape as the error ring.
 */
import { onMounted, onUpdated, ref, useId } from 'vue';

interface Props {
  label: string;
  optional?: boolean;
  required?: boolean;
  error?: boolean;
  /** Shown under the control while `error` is true. */
  errorMessage?: string;
}

withDefaults(defineProps<Props>(), {
  optional: false,
  required: false,
  error: false,
  errorMessage: undefined,
});

const labelId = useId();
const controlWrap = ref<HTMLElement | null>(null);

function associateLabel(): void {
  const el = controlWrap.value?.querySelector<HTMLElement>(
    'input, select, textarea, [contenteditable="true"]'
  );
  if (!el) return;
  // Never override a caller that has already labelled its control properly.
  if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
  el.setAttribute('aria-labelledby', labelId);
}

onMounted(associateLabel);
onUpdated(associateLabel);
</script>

<template>
  <div class="space-y-2 rounded-2xl" :data-form-label="label">
    <label
      :id="labelId"
      class="font-outfit flex items-center gap-1.5 text-xs font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
      :class="
        error
          ? 'text-primary-500 dark:text-accent-lift opacity-100'
          : 'dark:text-ink-soft text-[var(--color-text)] opacity-35'
      "
    >
      {{ label }}
      <span
        v-if="required"
        class="text-primary-500 dark:text-accent-lift text-sm font-bold opacity-100"
        >*</span
      >
      <slot name="label-extra" />
    </label>
    <div ref="controlWrap" :class="error ? 'ring-primary-500/40 rounded-2xl ring-2' : ''">
      <slot />
    </div>
    <p
      v-if="error && errorMessage"
      class="font-outfit text-primary-500 dark:text-accent-lift mt-1.5 mb-0 text-xs font-semibold"
    >
      {{ errorMessage }}
    </p>
  </div>
</template>
