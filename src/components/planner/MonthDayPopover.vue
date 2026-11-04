<script setup lang="ts">
/**
 * The desktop month grid's "+N more" popover (#141): the whole day at full anatomy,
 * opened in place, never changing view.
 *
 * ONE instance per grid, not one per cell; the cells emit `more(date, trigger)` and the
 * grid calls `openFor`. It is keyed by DATE, never by a cell snapshot: the grid derives
 * `cell` live from the open date, so a store change while it is open (a sync from
 * another device, a background refresh) re-renders it with current data.
 *
 * It closes itself when its day vanishes: `cell` becomes `null` (the month changed, the
 * date left the grid) or its trigger is no longer connected (a sync removed items so the
 * day no longer overflows and its "+N more" unmounted). It never stays anchored to, or
 * returns focus to, a detached element.
 *
 * Positioning, outside click, Escape (focus back to the trigger) and roving arrow-key
 * focus over `[data-day-item]` come from `useAnchoredPopover`, the SortMenu idiom.
 * Teleported to `<body>`, so it sits outside the planner root and
 * `useActivityReveal.findRevealElement` never matches its chips.
 */
import { ref, watch } from 'vue';
import { useAnchoredPopover } from '@/composables/useAnchoredPopover';
import { formatTodayCaption } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { HolidayOccurrence } from '@/types/models';
import MonthDayContents from '@/components/planner/MonthDayContents.vue';

const props = defineProps<{
  /** The open day, derived live by the grid from the date it was opened on. */
  cell: MonthDayCellData | null;
}>();

const emit = defineEmits<{
  /** The date to open; the grid sets the date it derives `cell` from. */
  'update:date': [date: string | null];
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  'birthday-click': [birthday: BirthdayOccurrence];
}>();

const anchorRef = ref<HTMLElement>();
const triggerRef = ref<HTMLElement>();
const popoverRef = ref<HTMLElement | null>(null);

const { show, popoverStyle, open, close, onMenuKeydown } = useAnchoredPopover({
  anchorRef,
  triggerRef,
  popoverRef,
  itemSelector: '[data-day-item]',
  align: 'start',
  widthEstimate: 240,
  heightEstimate: 220,
});

function openFor(date: string, trigger: HTMLElement): void {
  // The trigger is the anchor, so the outside-click guard treats this click as inside
  // and leaves the toggle to us.
  if (show.value && triggerRef.value === trigger) {
    close(true);
    return;
  }
  emit('update:date', date);
  anchorRef.value = trigger;
  triggerRef.value = trigger;
  open();
  logEvent({
    level: 'info',
    surface: 'calendar-month-grid',
    message: 'day_opened',
    context: { action: 'day_opened', format: 'desktop', stage: 'more' },
  });
}

watch(
  () => props.cell,
  (cell) => {
    if (!show.value) return;
    if (cell === null || !triggerRef.value?.isConnected) close(false);
  },
  { flush: 'post' }
);

// Closed by any route (outside click, Escape, a chip, a vanished day): hand the date back
// as null, or the grid keeps resolving a stale cell for a popover nobody can see.
watch(show, (v) => {
  if (!v) emit('update:date', null);
});

/** A chip opens its drawer over the grid: close first, then re-emit. */
function closeThen(fn: () => void): void {
  close(false);
  fn();
}

defineExpose({ openFor, close });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show && cell"
      ref="popoverRef"
      role="dialog"
      :aria-label="formatTodayCaption(cell.date)"
      :style="popoverStyle"
      class="dark:border-line-strong dark:bg-surface-overlay max-h-[min(24rem,70vh)] w-60 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-[var(--soft-shadow)]"
      data-testid="month-day-popover"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <p class="font-outfit text-secondary-500 dark:text-ink mb-1 text-sm font-bold">
        {{ formatTodayCaption(cell.date) }}
      </p>
      <MonthDayContents
        :cell="cell"
        @view-activity="(id, date) => closeThen(() => emit('view-activity', id, date))"
        @vacation-click="(vid) => closeThen(() => emit('vacation-click', vid))"
        @view-segment="(vid, sidx) => closeThen(() => emit('view-segment', vid, sidx))"
        @holiday-click="(h) => closeThen(() => emit('holiday-click', h))"
        @birthday-click="(b) => closeThen(() => emit('birthday-click', b))"
      />
    </div>
  </Teleport>
</template>
