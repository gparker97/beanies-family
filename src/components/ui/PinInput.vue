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
  /**
   * Render the boxes WITHOUT the hidden input, for surfaces that supply their
   * own on-screen keypad (the beanie wall). A wall-mounted tablet has no
   * keyboard to raise, and raising the OS one covers half the screen — so the
   * caller drives `modelValue` and this stays a pure display.
   */
  keypad?: boolean;
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
  if (props.keypad) return;
  inputEl.value?.focus();
}

/** With no hidden input there is no blur, so the caret is always live. */
const caretActive = computed(() => props.keypad || focused.value);

defineExpose({ focus: focusInput });
</script>

<template>
  <div
    class="relative"
    :class="{ 'pin-shake': hasError }"
    :role="keypad ? 'group' : undefined"
    :aria-label="keypad ? label : undefined"
    @click="focusInput"
  >
    <!--
      With no hidden input there is no focusable element and no accessible name,
      and the boxes are aria-hidden — a screen-reader user would get silence
      while typing on the on-screen keypad. This announces progress instead.
    -->
    <p v-if="keypad" class="sr-only" role="status" aria-live="polite">
      {{ modelValue.length }}/{{ PIN_LENGTH }}
    </p>
    <input
      v-if="!keypad"
      ref="inputEl"
      type="password"
      inputmode="numeric"
      autocomplete="one-time-code"
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
              ? 'dark:bg-surface-overlay border-[#F15D22]/60 bg-white'
              : caretActive && i === modelValue.length
                ? 'dark:bg-surface-overlay border-[#AED6F1] bg-white ring-2 ring-[#AED6F1]/40'
                : 'dark:border-line-strong dark:bg-surface-overlay border-gray-200 bg-white',
          disabled ? 'opacity-50' : '',
        ]"
      >
        <span class="dark:text-ink text-gray-900">{{ digit ? '●' : '' }}</span>
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
