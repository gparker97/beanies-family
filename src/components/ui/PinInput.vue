<script setup lang="ts">
/**
 * The ONE PIN entry surface (login rethink Phase 2). Six digit boxes, numeric keyboard,
 * paste-safe, error shake. Used by ProveView, PIN set/change in Settings, and (later)
 * ReauthChallenge — no view renders its own digit boxes, per the plan's single-surface
 * rule.
 *
 * Implementation: ONE invisible input drives six display boxes — real focus/IME/paste
 * behavior for free, no per-box focus juggling. Emits `complete` once six digits are in;
 * the parent clears via v-model.
 */
import { ref, computed, watch } from 'vue';
import { PIN_LENGTH } from '@/services/auth/deviceUnlock';

const props = defineProps<{
  modelValue: string;
  /** Render the error state (red boxes + shake). Cleared by the next keystroke. */
  hasError?: boolean;
  disabled?: boolean;
  /** Autofocus the hidden input on mount. */
  autofocus?: boolean;
  /** Accessible label for the hidden input (applied as aria-label). */
  label: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  /** Six digits are in. Fired once per fill. */
  complete: [pin: string];
}>();

const inputEl = ref<HTMLInputElement | null>(null);
const focused = ref(false);
let completedFor = '';

const digits = computed(() => {
  const chars = props.modelValue.split('');
  return Array.from({ length: PIN_LENGTH }, (_, i) => chars[i] ?? '');
});

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  const clean = raw.replace(/\D/g, '').slice(0, PIN_LENGTH);
  if (clean !== raw && inputEl.value) inputEl.value.value = clean;
  emit('update:modelValue', clean);
}

watch(
  () => props.modelValue,
  (v) => {
    if (inputEl.value && inputEl.value.value !== v) inputEl.value.value = v;
    if (v.length === PIN_LENGTH && completedFor !== v) {
      completedFor = v;
      emit('complete', v);
    }
    if (v.length < PIN_LENGTH) completedFor = '';
  }
);

function focusInput() {
  inputEl.value?.focus();
}

defineExpose({ focus: focusInput });
</script>

<template>
  <div class="relative" :class="{ 'pin-shake': hasError }" @click="focusInput">
    <input
      ref="inputEl"
      type="password"
      inputmode="numeric"
      autocomplete="one-time-code"
      :maxlength="PIN_LENGTH"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="label"
      class="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      v-bind="autofocus ? { autofocus: true } : {}"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
    />
    <div class="pointer-events-none flex justify-center gap-2" aria-hidden="true">
      <div
        v-for="(digit, i) in digits"
        :key="i"
        class="flex h-12 w-10 items-center justify-center rounded-xl border-2 text-lg font-bold transition-colors"
        :class="[
          hasError
            ? 'border-red-400 bg-red-50 dark:border-red-500 dark:bg-red-900/20'
            : digit
              ? 'border-[#F15D22]/60 bg-white dark:bg-slate-700'
              : focused && i === modelValue.length
                ? 'border-[#AED6F1] bg-white ring-2 ring-[#AED6F1]/40 dark:bg-slate-700'
                : 'border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-700',
          disabled ? 'opacity-50' : '',
        ]"
      >
        <span class="text-gray-900 dark:text-gray-100">{{ digit ? '●' : '' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pin-shake {
  animation: pin-shake 0.3s ease-in-out;
}

@keyframes pin-shake {
  0%,
  100% {
    transform: translateX(0);
  }

  25% {
    transform: translateX(-6px);
  }

  75% {
    transform: translateX(6px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pin-shake {
    animation: none;
  }
}
</style>
