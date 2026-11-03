<script setup lang="ts">
/**
 * The shell both time pickers share: where the panel opens, how it closes, and nothing about
 * times. `BeanieTimePicker` and `BeanieTimeRange` put their pill(s) in the default slot and
 * their `TimePickerPanel` in `#panel`.
 *
 *  - PHONE (`useBreakpoint().isMobile`, under 768px): a bottom sheet over a dim, lifted above an
 *    on-screen keyboard by `inset`. The sheet focuses its own container (`tabindex="-1"`), never
 *    the type box, so the keyboard stays down until someone taps it.
 *  - 768px AND UP: a card anchored under the tapped pill (teleported, fixed, flipped and
 *    clamped by `useAnchoredPosition`), repositioned whenever its height changes (the Night and
 *    5-minute rows appear on demand, the Lasts row replaces Recent on the end step) through the
 *    shared `useElementSize`, not a hand-rolled ResizeObserver.
 *
 * Both shapes, the phone dim included, paint at `ANCHORED_POPOVER_Z_INDEX`, so the picker shows
 * above the modal, drawer or onboarding overlay it was opened from. (Not QuickAddSheet's
 * `z-[45]`: that is a page tier, and a sheet opened from BaseModal would render behind it.)
 *
 * The overlay contract is `useAnchoredOverlay`: the sheet joins the overlay stack with scroll
 * lock, the popover is Escape-only, Escape registers once with hand-across on a breakpoint
 * change, focus returns to the pill tapped first, and everything unregisters on unmount. Outside
 * click is ONE path for both shapes (`useOutsideClick`, capture phase), with the root and the
 * teleported card as inside: the dim is outside both, so tapping it closes through that same
 * handler, and a tap on the range's other pill is inside the root, so it switches step.
 *
 * `open(el)` while already open only swaps the anchor and repositions: no close/reopen, no
 * second `open` log, and the focus-restore target stays the first pill.
 *
 * One root element, so attributes passed at a call site (`class="min-w-0 flex-1"`,
 * `data-testid`) fall through to it.
 *
 * Telemetry (surface `time-picker`): `debug` `{ action: 'open', kind: 'sheet' | 'popover' }`
 * once per open; `keyboard_avoidance` comes from `useAnchoredOverlay`, and
 * `element_size_unobservable` from `useElementSize`.
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useAnchoredOverlay } from '@/composables/useAnchoredOverlay';
import { ANCHORED_POPOVER_Z_INDEX, useAnchoredPosition } from '@/composables/useAnchoredPosition';
import { useElementSize } from '@/composables/useElementSize';
import { useOutsideClick } from '@/composables/useOutsideClick';
import { logEvent } from '@/services/telemetry/logEvent';

const TIME_PICKER_SURFACE = 'time-picker';

interface Props {
  /** The sheet's heading (phone) and the dialog's accessible name (both shapes). */
  title: string;
  /** The current value, shown beside the sheet's heading. */
  subtitle?: string;
}

defineProps<Props>();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const cardEl = ref<HTMLElement | null>(null);
const anchorEl = ref<HTMLElement | null>(null);

function close(): void {
  isOpen.value = false;
}

// Restore focus to the pill only when focus is nowhere useful (on <body>) or still inside the
// picker. A desktop click into another field closes the picker through the outside-click
// handler after that field took focus, and restoring would pull the user's typing back here.
function focusStillOurs(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return !!(rootEl.value?.contains(active) || cardEl.value?.contains(active));
}

const { isMobile, inset } = useAnchoredOverlay(isOpen, close, {
  surface: TIME_PICKER_SURFACE,
  shouldRestoreFocus: focusStillOurs,
});
useOutsideClick(isOpen, [rootEl, cardEl], close);

const popoverOpen = computed(() => isOpen.value && !isMobile.value);
const { popoverStyle, reposition } = useAnchoredPosition({
  anchorRef: anchorEl,
  popoverRef: cardEl,
  active: popoverOpen,
  align: 'start',
  widthEstimate: 360,
  heightEstimate: 440,
});

const { height: cardHeight } = useElementSize(cardEl, { surface: TIME_PICKER_SURFACE });
watch(cardHeight, () => {
  if (popoverOpen.value) reposition();
});

const zIndex = String(ANCHORED_POPOVER_Z_INDEX);
const sheetStyle = computed(() => ({ bottom: `${inset.value}px`, zIndex }));

function open(el: HTMLElement): void {
  anchorEl.value = el;
  if (isOpen.value) {
    // Re-anchor only (the range's advance and back): same open, same restore target.
    nextTick(() => {
      if (popoverOpen.value) reposition();
    });
    return;
  }
  isOpen.value = true;
  logEvent({
    level: 'debug',
    surface: TIME_PICKER_SURFACE,
    message: 'time picker opened',
    context: { action: 'open', kind: isMobile.value ? 'sheet' : 'popover' },
  });
  nextTick(() => {
    if (isMobile.value) cardEl.value?.focus({ preventScroll: true });
    else reposition();
  });
}

defineExpose({ open, close, isOpen });
</script>

<template>
  <div ref="rootEl">
    <slot :is-open="isOpen" :open="open" :close="close" />
    <Teleport to="body">
      <Transition
        enter-active-class="transition-opacity duration-150 motion-reduce:transition-none"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-100 motion-reduce:transition-none"
        leave-to-class="opacity-0"
      >
        <!-- Phone only. No click handler: the outside-click handler closes on it. `cursor-pointer` is
             load-bearing: iOS Safari dispatches no click for a tap on a plain div otherwise. -->
        <div
          v-if="isOpen && isMobile"
          class="fixed inset-0 cursor-pointer bg-[rgb(44_62_80/0.35)] dark:bg-black/50"
          :style="{ zIndex }"
          data-testid="time-picker-dim"
          aria-hidden="true"
        />
      </Transition>
      <Transition
        enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
        :enter-from-class="isMobile ? 'translate-y-3 opacity-60' : '-translate-y-1 opacity-0'"
        leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
        leave-to-class="opacity-0"
      >
        <div
          v-if="isOpen && isMobile"
          ref="cardEl"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          data-testid="time-picker-card"
          class="dark:border-line-strong dark:bg-surface-raised fixed inset-x-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-[var(--tint-slate-10)] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(44,62,80,0.16)] focus:outline-none dark:shadow-[0_-10px_30px_rgba(0,0,0,0.5)]"
          :style="sheetStyle"
        >
          <div
            class="dark:bg-line-strong mx-auto mt-2.5 h-1 w-9 rounded-full bg-[var(--tint-slate-10)]"
            aria-hidden="true"
          />
          <div class="flex items-baseline justify-between gap-3 px-3.5 pt-2">
            <span class="font-outfit dark:text-ink text-base font-bold text-[var(--color-text)]">
              {{ title }}
            </span>
            <span
              v-if="subtitle"
              class="dark:text-ink-faint text-sm text-[var(--color-text-muted)]"
            >
              {{ subtitle }}
            </span>
          </div>
          <slot name="panel" :is-sheet="true" :close="close" />
        </div>
        <div
          v-else-if="isOpen"
          ref="cardEl"
          role="dialog"
          :aria-label="title"
          tabindex="-1"
          data-testid="time-picker-card"
          class="dark:border-line-strong dark:bg-surface-raised max-h-[calc(100dvh-1rem)] w-90 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-3xl border border-[var(--tint-slate-10)] bg-white shadow-lg focus:outline-none"
          :style="popoverStyle"
        >
          <slot name="panel" :is-sheet="false" :close="close" />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
