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
import { ref, computed, watch, onMounted, nextTick } from 'vue';
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
   * An on-screen keypad is supplying the digits, so do not raise the OS keyboard.
   *
   * ⚠️ THIS USED TO REMOVE THE HIDDEN INPUT ENTIRELY, and that cost more than it bought.
   * With no focusable element there was no accessible name (hence a bolted-on sr-only live
   * region), no blur (hence a permanently-on caret), and no way to focus (hence an early
   * return in `focusInput`). It also stranded anyone on a touch device with a hardware
   * keyboard attached — an iPad in a case reports `pointer: coarse`.
   *
   * The input now always exists and this switches `inputmode` to `none`, which is what
   * actually keeps the OS keyboard down. Physical keyboards, paste and focus all keep
   * working, and three special cases went away.
   *
   * ⚠️ NOT derived from `useIsTouchPrimary()` inside this component. There are sixteen
   * `<PinInput>` instances across eight files, and deciding here would put a keypad in the
   * Settings PIN form and the Reset-member-PIN modal, which nobody asked for. The three
   * surfaces that want one pass it.
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
  inputEl.value?.focus();
}

/**
 * ⚠️ IMPERATIVE, BECAUSE THE NATIVE ATTRIBUTE DOES NOTHING HERE. `autofocus` only fires for
 * elements present when the document is parsed; an element inserted into an already-loaded
 * page — which is every modal in this app — is ignored by every browser. Nine call sites
 * passed `autofocus` and not one of them focused anything, which is why "confirm your PIN"
 * always needed a tap before you could type. `BaseModal` has no focus management, so
 * nothing was stealing it; it was simply never being set.
 */
onMounted(async () => {
  // ⚠️ NEVER ON A KEYPAD SURFACE. The wall exists because there is no keyboard and raising
  // the OS one covers the digits; focusing a real input there is the thing `keypad` was
  // invented to avoid, and `inputmode="none"` is only advisory.
  if (!props.autofocus || props.disabled || props.keypad) return;
  await nextTick();
  focusInput();
});

/**
 * ⚠️ `keypad ||` IS LOAD-BEARING. On a keypad surface the taps land on `PinKeypad`'s
 * buttons, which BLURS the hidden input — so keying the caret on `focused` alone removed
 * the next-box ring entirely on the beanie wall and made it vanish on the first press
 * everywhere else. The pad is the input there; the caret should follow the value, not the
 * focus.
 */
const caretActive = computed(() => props.keypad || focused.value);

defineExpose({ focus: focusInput });
</script>

<template>
  <!-- No wrapper `role="group"`/`aria-label` any more: the hidden input is unconditional
       and carries its own `aria-label`, so a group with the same name announced it twice. -->
  <div class="relative" :class="{ 'pin-shake': hasError }" @click="focusInput">
    <!-- ⚠️ KEEP THIS. On a keypad surface focus sits on a `PinKeypad` button, not the hidden
         input, and the digit boxes are `aria-hidden` — so without this a screen-reader user
         on the wall or the phone reauth gate hears nothing at all as digits go in. It is
         independent of the wrapper's removed `role="group"`, which was a duplicated NAME. -->
    <p v-if="keypad" class="sr-only" role="status" aria-live="polite">
      {{ modelValue.length }}/{{ PIN_LENGTH }}
    </p>
    <input
      ref="inputEl"
      type="password"
      :inputmode="keypad ? 'none' : 'numeric'"
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
