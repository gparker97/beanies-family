<script setup lang="ts">
/**
 * The time picker's trigger pill, shared by `BeanieTimePicker` and `BeanieTimeRange` so a
 * single field and a start/end pair render identical pills.
 *
 * The pill focuses ITSELF (without scrolling) before emitting `toggle(el)`. Safari does not
 * focus a tapped button, so without this `useAnchoredOverlay` would record whatever was focused
 * before (the title input) as the restore target and put focus back there on close, raising
 * the iPhone keyboard. The emitted element is the anchor the picker hangs from.
 *
 * The optional clear (✕) is a SIBLING of the trigger, never nested in it: a button inside a
 * button is invalid HTML and steals its clicks.
 */
import { ref } from 'vue';
import { useTranslation } from '@/composables/useTranslation';

interface Props {
  /** The pill text: the formatted time, or the empty-state prompt. */
  label: string;
  /** A time is set: orange outline and tint. */
  isSet: boolean;
  /** The picker this pill opens is showing: rotates the chevron, sets `aria-expanded`. */
  isOpen: boolean;
  /** Show the ✕ beside a set pill. */
  clearable?: boolean;
}

withDefaults(defineProps<Props>(), { clearable: false });

const emit = defineEmits<{
  toggle: [el: HTMLElement];
  clear: [];
}>();

const { t } = useTranslation();

const triggerEl = ref<HTMLElement | null>(null);

function onTriggerClick(): void {
  const el = triggerEl.value;
  if (!el) return;
  el.focus({ preventScroll: true });
  emit('toggle', el);
}

defineExpose({ triggerEl });
</script>

<template>
  <div class="flex items-center gap-1">
    <button
      ref="triggerEl"
      type="button"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      class="font-outfit flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150"
      :class="
        isSet
          ? 'border-primary-500 text-primary-500 dark:text-accent-lift dark:bg-primary-500/15 border-2 bg-[var(--tint-orange-8)]'
          : 'dark:bg-surface-overlay dark:text-ink-soft border-2 border-transparent bg-[var(--tint-slate-5)] text-[var(--color-text-muted)] hover:bg-[var(--tint-slate-10)]'
      "
      data-testid="time-picker-trigger"
      @click="onTriggerClick"
    >
      <span>{{ label }}</span>
      <svg
        class="h-3 w-3 transition-transform motion-reduce:transition-none"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <path d="M19 9l-7 7-7-7" />
      </svg>
    </button>
    <button
      v-if="clearable && isSet"
      type="button"
      data-testid="time-picker-clear"
      :aria-label="t('time.clearAriaLabel')"
      class="dark:text-ink-soft dark:hover:bg-surface-hover flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--tint-slate-10)]"
      @click="emit('clear')"
    >
      <svg
        class="h-3 w-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
