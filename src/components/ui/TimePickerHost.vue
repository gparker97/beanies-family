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
 * The shell, the overlay contract, outside click and focus are `AnchoredSurface` (shared with the
 * Chores Done day summary): the sheet joins the overlay stack with scroll lock, the popover is
 * Escape-only, focus returns to the pill tapped first, and everything unregisters on unmount.
 * The root counts as inside, so a tap on the range's other pill switches step.
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
import { ref } from 'vue';
import AnchoredSurface from '@/components/ui/AnchoredSurface.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
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
const anchorEl = ref<HTMLElement | null>(null);
const { isMobile } = useBreakpoint();

function close(): void {
  isOpen.value = false;
}

function open(el: HTMLElement): void {
  // Already open: re-anchor only (the range's advance and back). The shell repositions on the
  // anchor change; same open, same restore target, no second log.
  anchorEl.value = el;
  if (isOpen.value) return;
  isOpen.value = true;
  logEvent({
    level: 'debug',
    surface: TIME_PICKER_SURFACE,
    message: 'time picker opened',
    context: { action: 'open', kind: isMobile.value ? 'sheet' : 'popover' },
  });
}

defineExpose({ open, close, isOpen });
</script>

<template>
  <div ref="rootEl">
    <slot :is-open="isOpen" :open="open" :close="close" />
    <AnchoredSurface
      :open="isOpen"
      :anchor="anchorEl"
      :label="title"
      :surface="TIME_PICKER_SURFACE"
      :inside-el="rootEl"
      align="start"
      :width-estimate="360"
      :height-estimate="440"
      card-testid="time-picker-card"
      dim-testid="time-picker-dim"
      @close="close"
    >
      <template #default="{ isSheet }">
        <div v-if="isSheet" class="flex items-baseline justify-between gap-3 px-3.5 pt-2">
          <span class="font-outfit dark:text-ink text-base font-bold text-[var(--color-text)]">
            {{ title }}
          </span>
          <span v-if="subtitle" class="dark:text-ink-faint text-sm text-[var(--color-text-muted)]">
            {{ subtitle }}
          </span>
        </div>
        <slot name="panel" :is-sheet="isSheet" :close="close" />
      </template>
    </AnchoredSurface>
  </div>
</template>
