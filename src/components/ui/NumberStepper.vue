<script setup lang="ts">
/**
 * A whole-number field with −/+ buttons: "[− 4 +] people" (#116).
 *
 * Blank is a real value (`undefined` = "not set"), so the field can be cleared by deleting
 * the digits. Anything but digits is dropped as it is typed. The EMITTED value is always
 * inside [min, max] (or `undefined`), even mid-typing, so a form saved without the field
 * ever losing focus can never persist an out-of-range count; the TEXT on screen is only
 * snapped to that value on blur, so typing "12" is not interrupted at "1".
 */
import { ref, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    modelValue: number | undefined;
    min?: number;
    max: number;
    /** Shown after the stepper ("people"). Already translated. */
    unit?: string;
    /** Accessible name of the number input. Already translated. */
    label: string;
    id?: string;
  }>(),
  { min: 1, unit: '', id: undefined }
);

const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>();

const { t } = useTranslation();

const text = ref(toText(props.modelValue));

function toText(n: number | undefined): string {
  return n === undefined ? '' : String(n);
}

function clamp(n: number): number {
  return Math.min(props.max, Math.max(props.min, n));
}

/**
 * The value this component last emitted while typing. The echo of our own emit must not
 * rewrite the text (that would snap "150" to "99" mid-typing); any OTHER change comes from
 * the parent (a form reopened for another recipe) and must show.
 */
let typed: { value: number | undefined } | null = null;

watch(
  () => props.modelValue,
  (n) => {
    if (typed && typed.value === n) return;
    typed = null;
    text.value = toText(n);
  }
);

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, '');
  // Write the filtered text back so a typed letter never shows.
  if (digits !== input.value) input.value = digits;
  text.value = digits;
  const value = digits === '' ? undefined : clamp(Number(digits));
  typed = { value };
  emit('update:modelValue', value);
}

function onBlur(): void {
  typed = null;
  text.value = toText(props.modelValue);
}

function step(delta: 1 | -1): void {
  const next = props.modelValue === undefined ? props.min : clamp(props.modelValue + delta);
  typed = null;
  text.value = toText(next);
  emit('update:modelValue', next);
}

const buttonClass =
  'font-outfit flex h-10 w-10 flex-none items-center justify-center bg-[var(--tint-slate-5)] text-base font-bold text-secondary-500 transition-colors hover:bg-[var(--tint-slate-10)] disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)] dark:bg-surface-overlay dark:text-ink-soft dark:hover:bg-surface-hover dark:disabled:text-ink-faint';
</script>

<template>
  <div class="flex flex-nowrap items-center gap-2.5">
    <div
      class="focus-within:border-primary-500 focus-within:ring-sky-silk-100 dark:border-line-strong dark:bg-surface-raised dark:focus-within:ring-primary-700 inline-flex items-center overflow-hidden rounded-xl border-2 border-[var(--tint-slate-10)] bg-white focus-within:ring-2"
    >
      <button
        type="button"
        :class="buttonClass"
        :aria-label="t('common.stepper.fewer')"
        :disabled="modelValue !== undefined && modelValue <= min"
        data-testid="stepper-decrease"
        @click="step(-1)"
      >
        −
      </button>
      <input
        :id="id"
        :value="text"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        :aria-label="label"
        class="font-outfit dark:text-ink text-secondary-500 w-14 border-0 bg-transparent px-1 py-2 text-center text-base font-bold tabular-nums focus:outline-none"
        v-bind="$attrs"
        @input="onInput"
        @blur="onBlur"
      />
      <button
        type="button"
        :class="buttonClass"
        :aria-label="t('common.stepper.more')"
        :disabled="modelValue !== undefined && modelValue >= max"
        data-testid="stepper-increase"
        @click="step(1)"
      >
        +
      </button>
    </div>
    <span
      v-if="unit"
      class="font-inter dark:text-ink-soft text-sm whitespace-nowrap text-[var(--color-text-muted)]"
      >{{ unit }}</span
    >
  </div>
</template>
