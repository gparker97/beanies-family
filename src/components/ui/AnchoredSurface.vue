<script setup lang="ts">
/**
 * The ONE anchored overlay shell: a card hung from an element on a wide screen, a bottom sheet
 * over a dim on a phone. It knows nothing about its content. Consumers: `TimePickerHost` (both
 * time pickers) and `ChoreDayPopover` (the Chores Done day summary).
 *
 *  - PHONE (`useBreakpoint().isMobile`, under 768px): a bottom sheet over a dim, lifted above an
 *    on-screen keyboard by `inset`, with a grab handle. With no `initialFocus` the sheet focuses
 *    its own container (`tabindex="-1"`), so a type box inside does not raise the keyboard.
 *  - 768px AND UP: a card anchored to `anchor` (teleported, fixed, flipped and clamped by
 *    `useAnchoredPosition`, `align` and `side`), repositioned when the anchor changes and when
 *    the card's height changes (the shared `useElementSize`, never a hand-rolled observer).
 *
 * Both shapes, the dim included, paint at `ANCHORED_POPOVER_Z_INDEX`, so the surface shows above
 * the modal, drawer or onboarding overlay it was opened from.
 *
 * The overlay contract is `useAnchoredOverlay`: the sheet joins the overlay stack with scroll
 * lock, the card is Escape-only, Escape registers once with hand-across on a breakpoint change,
 * and focus returns to what had it at open, unless focus has since moved somewhere useful
 * outside the surface (an outside click into another field). Outside click is ONE path for both
 * shapes (`useOutsideClick`, capture phase) with the card and `insideEls` as inside: the dim is
 * outside both, so tapping it closes through that same handler. Every close is an emitted
 * `close`; `open` is the parent's.
 *
 * Telemetry: `keyboard_avoidance` (from `useAnchoredOverlay`) and `element_size_unobservable`
 * (from `useElementSize`), both on the consumer's `surface`. The consumer logs its own open.
 */
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { useAnchoredOverlay } from '@/composables/useAnchoredOverlay';
import { ANCHORED_POPOVER_Z_INDEX, useAnchoredPosition } from '@/composables/useAnchoredPosition';
import { useElementSize } from '@/composables/useElementSize';
import { useOutsideClick } from '@/composables/useOutsideClick';

const props = withDefaults(
  defineProps<{
    open: boolean;
    /** The element the wide card hangs from. */
    anchor: HTMLElement | null;
    /** The dialog's accessible name (both shapes). */
    label: string;
    /** The firehose surface for the shell's own diagnostics. */
    surface: string;
    /** An element that counts as inside for the outside click (the trigger's own root). */
    insideEl?: HTMLElement | null;
    align?: 'start' | 'end';
    side?: 'below' | 'start';
    widthEstimate?: number;
    heightEstimate?: number;
    /** A selector inside the surface to focus on open (both shapes). */
    initialFocus?: string;
    cardTestid?: string;
    dimTestid?: string;
    /** The sheet's look (position and stacking are the shell's). */
    sheetClass?: string;
    /** The wide card's look and size (position and stacking are the shell's). */
    cardClass?: string;
  }>(),
  {
    insideEl: null,
    align: 'start',
    side: 'below',
    widthEstimate: 360,
    heightEstimate: 440,
    initialFocus: undefined,
    cardTestid: undefined,
    dimTestid: undefined,
    sheetClass:
      'dark:border-line-strong dark:bg-surface-raised max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-[var(--tint-slate-10)] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(44,62,80,0.16)] dark:shadow-[0_-10px_30px_rgba(0,0,0,0.5)]',
    cardClass:
      'dark:border-line-strong dark:bg-surface-raised max-h-[calc(100dvh-1rem)] w-90 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-3xl border border-[var(--tint-slate-10)] bg-white shadow-lg',
  }
);

const emit = defineEmits<{ close: [] }>();

// Call-site attributes (a `data-*` on the dialog) land on the card, not on the Teleport.
defineOptions({ inheritAttrs: false });

const isOpen = toRef(props, 'open');
const cardEl = ref<HTMLElement | null>(null);
const anchorRef = toRef(props, 'anchor');
const insideRef = toRef(props, 'insideEl');

function close(): void {
  emit('close');
}

// Restore focus only when it is nowhere useful (on <body>) or still inside the surface or its
// trigger. A click into another field closes the surface after that field took focus, and
// restoring would pull the user's typing back here.
function focusStillOurs(): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return !!(cardEl.value?.contains(active) || insideRef.value?.contains(active));
}

const { isMobile, inset } = useAnchoredOverlay(isOpen, close, {
  surface: props.surface,
  shouldRestoreFocus: focusStillOurs,
});
useOutsideClick(isOpen, [cardEl, insideRef], close);

const cardOpen = computed(() => isOpen.value && !isMobile.value);
const { popoverStyle, reposition } = useAnchoredPosition({
  anchorRef,
  popoverRef: cardEl,
  active: cardOpen,
  align: props.align,
  side: () => props.side,
  widthEstimate: props.widthEstimate,
  heightEstimate: props.heightEstimate,
});

const { height: cardHeight } = useElementSize(cardEl, { surface: props.surface });
watch([cardHeight, anchorRef], () => {
  if (cardOpen.value) reposition();
});

watch(isOpen, (open) => {
  if (!open) return;
  void nextTick(() => {
    if (cardOpen.value) reposition();
    const target = props.initialFocus
      ? cardEl.value?.querySelector<HTMLElement>(props.initialFocus)
      : isMobile.value
        ? cardEl.value
        : null;
    target?.focus({ preventScroll: true });
  });
});

const zIndex = String(ANCHORED_POPOVER_Z_INDEX);
const sheetStyle = computed(() => ({ bottom: `${inset.value}px`, zIndex }));

defineExpose({ isMobile });
</script>

<template>
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
        v-if="open && isMobile"
        class="fixed inset-0 cursor-pointer bg-[rgb(44_62_80/0.35)] dark:bg-black/50"
        :style="{ zIndex }"
        :data-testid="dimTestid"
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
        v-if="open && isMobile"
        ref="cardEl"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
        :data-testid="cardTestid"
        class="fixed inset-x-0 focus:outline-none"
        :class="sheetClass"
        :style="sheetStyle"
        v-bind="$attrs"
      >
        <div
          class="dark:bg-line-strong mx-auto mt-2.5 h-1 w-9 rounded-full bg-[var(--tint-slate-10)]"
          aria-hidden="true"
        />
        <slot :is-sheet="true" :close="close" />
      </div>
      <div
        v-else-if="open"
        ref="cardEl"
        role="dialog"
        :aria-label="label"
        tabindex="-1"
        :data-testid="cardTestid"
        class="focus:outline-none"
        :class="cardClass"
        :style="popoverStyle"
        v-bind="$attrs"
      >
        <slot :is-sheet="false" :close="close" />
      </div>
    </Transition>
  </Teleport>
</template>
