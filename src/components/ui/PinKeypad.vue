<script setup lang="ts">
/**
 * An on-screen numeric keypad.
 *
 * Built for the beanie wall: a tablet bolted to a wall has no keyboard, and
 * raising the OS one covers the digits you are trying to read. Targets are
 * 4.5rem so a thumb (or a seven-year-old's whole hand) hits them reliably at
 * arm's length.
 *
 * Presentational and PIN-agnostic — it emits digits and backspaces, and knows
 * nothing about length, hashing or verification.
 */
import { useTranslation } from '@/composables/useTranslation';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ digit: [string]; backspace: [] }>();

const { t } = useTranslation();
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
</script>

<template>
  <div class="mx-auto grid w-full max-w-xs grid-cols-3 gap-3">
    <button
      v-for="key in KEYS"
      :key="key"
      type="button"
      :disabled="disabled"
      class="font-outfit pin-key text-secondary-500 dark:bg-surface-raised dark:text-ink rounded-2xl bg-white font-bold shadow-[var(--card-shadow)] transition-transform active:scale-95 disabled:opacity-40"
      @click="emit('digit', key)"
    >
      {{ key }}
    </button>
    <span aria-hidden="true" />
    <button
      type="button"
      :disabled="disabled"
      class="font-outfit pin-key text-secondary-500 dark:bg-surface-raised dark:text-ink rounded-2xl bg-white font-bold shadow-[var(--card-shadow)] transition-transform active:scale-95 disabled:opacity-40"
      @click="emit('digit', '0')"
    >
      0
    </button>
    <button
      type="button"
      :disabled="disabled"
      class="pin-key text-secondary-500 dark:bg-surface-raised dark:text-ink rounded-2xl bg-white shadow-[var(--card-shadow)] transition-transform active:scale-95 disabled:opacity-40"
      :aria-label="t('pin.backspace')"
      @click="emit('backspace')"
    >
      <span aria-hidden="true">⌫</span>
    </button>
  </div>
</template>

<style scoped>
.pin-key {
  font-size: 1.75rem;
  height: 4.5rem;
}
</style>
