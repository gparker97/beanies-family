<script setup lang="ts">
/**
 * A compact search pill: a magnifier, the text, and a clear button once there is text. The
 * shared one (#152, the category pickers' search). Four hand-rolled search inputs predate it
 * (`MealPickerSheet`, `RecipeRail`, `DealBoard`, `EmergencyContactsPage`); moving them onto this
 * is a recorded follow-up.
 *
 * Sized to sit INSIDE a row of chips as one more chip: the same 32px height and radius, so it
 * adds no row of its own. The text is `text-base` (16px), never the chips' `text-xs`: iOS zooms
 * the WKWebView in when a sub-16px control takes focus and does not reliably zoom back (the
 * floor in `style.css`). The height is held by the box instead: a 1px border, 3px padding and a
 * 24px line (`leading-6`) make the chip's 2px border, `py-1.5` and 16px line. Narrow while empty
 * and unfocused, just wide enough for the short placeholder (the `aria-label` carries the whole
 * name); focused or holding text it widens, to the full row on a narrow drawer (`max-w-full`).
 * It is a real input the whole time: no tap to open it first.
 *
 * `type="text"` with `inputmode="search"`, never `type="search"`: WebKit and Chromium draw
 * their own cancel button on a search input, and it would sit beside ours. The keyboard still
 * shows a search key (`enterkeyhint`).
 *
 * Transparent: it sits on whatever surface its parent paints, so it needs no dark partner for
 * a background. The clear button paints one and carries its pair.
 */
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

defineProps<{
  placeholder?: string;
  ariaLabel?: string;
}>();

const query = defineModel<string>({ default: '' });

const { t } = useTranslation();
const input = ref<HTMLInputElement | null>(null);

/** Clear and keep the focus in the field, so the next word can be typed straight away. */
function clear(): void {
  query.value = '';
  input.value?.focus();
}
</script>

<template>
  <label
    class="focus-within:border-primary-500 dark:border-line flex max-w-full min-w-0 flex-none cursor-text items-center gap-1.5 rounded-full border border-[var(--tint-slate-10)] bg-transparent px-3 py-[0.1875rem] focus-within:w-[11rem] motion-safe:transition-[width,border-color] motion-safe:duration-150"
    :class="query ? 'w-[11rem]' : 'w-[7rem]'"
  >
    <svg
      class="dark:text-ink-faint h-3 w-3 flex-none text-[var(--color-text-muted)]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.75"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
    <input
      ref="input"
      v-model="query"
      type="text"
      inputmode="search"
      enterkeyhint="search"
      autocomplete="off"
      class="font-outfit dark:text-ink dark:placeholder:text-ink-faint min-w-0 flex-1 border-none bg-transparent p-0 text-base leading-6 font-semibold text-ellipsis text-[var(--color-text)] outline-none placeholder:font-medium placeholder:text-[var(--color-text-muted)]"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
    />
    <button
      v-if="query"
      type="button"
      class="dark:bg-surface-overlay dark:text-ink-soft flex h-4 w-4 flex-none items-center justify-center rounded-full bg-[var(--tint-slate-5)] text-xs leading-none text-[var(--color-text-muted)]"
      :aria-label="t('action.clear')"
      @click="clear"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </label>
</template>
