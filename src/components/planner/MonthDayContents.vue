<script setup lang="ts">
/**
 * A day's full contents as a vertical list (#141): the stream card's events column, the
 * desktop "+N more" popover and the phone day row all render through it. It was
 * EXTRACTED from `MonthDayCard`'s events column, not written fresh.
 *
 * One rendering path over `capDayContents(cell, caps)`, so this component holds no cap
 * logic: with `caps` (the stream's `STREAM_DAY_CAPS`, the phone day row's
 * `PHONE_DAY_ROW_CAPS`) it shows what fits plus the two "+N" counts; without (the
 * popover) it shows everything.
 *
 * Order: birthdays and holidays (inline, so `allDaySurfaces.test.ts` sees them), trips
 * and all-day bars, the all-day "+N" right after the bars it counts, then timed items
 * and travel segments by start time, then one "+N more" for the hidden timeline. An
 * empty day says "Nothing planned"; this is the only place that line is drawn.
 *
 * Every bar renders standalone with its label, because a vertical list has no
 * neighbouring cell to continue into. It provides the month chip context as full
 * anatomy (`DEFAULT_CELL_CHIPS`) with times per `showTime` (default on; the stream card
 * turns them off, independently of its caps), overriding any grid
 * context above it, except `interactive`, which it inherits: inside the stream card
 * (whose root is the button) the chips and the "+N more" are spans, so buttons never
 * nest. Every item and extra carries `data-day-item` for the popover's roving focus.
 */
import { computed, provide } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { capDayContents, dayCount, dayItemKey } from '@/utils/monthDayItems';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { DayCaps } from '@/constants/calendarCaps';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { HolidayOccurrence } from '@/types/models';
import {
  DEFAULT_CELL_CHIPS,
  MONTH_CELL_CHIPS,
  useMonthCellChips,
} from '@/components/planner/monthCellChipsKey';
import BirthdayChip from '@/components/planner/BirthdayChip.vue';
import HolidayChip from '@/components/planner/HolidayChip.vue';
import MonthDayItem from '@/components/planner/MonthDayItem.vue';

const props = withDefaults(
  defineProps<{
    cell: MonthDayCellData;
    /** Fixed caps (the stream card, the phone day row); omitted (the popover) shows everything. */
    caps?: DayCaps;
    /** Start times on the timed chips. Default true; the stream card passes false. */
    showTime?: boolean;
  }>(),
  { caps: undefined, showTime: true }
);

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  /** A derived birthday was tapped; the parent opens the read-only drawer. */
  'birthday-click': [birthday: BirthdayOccurrence];
  /** The capped timeline's "+N more" was pressed. */
  more: [];
}>();

const { t } = useTranslation();

// Read BEFORE providing, so this resolves the parent's context, not our own.
const parentChips = useMonthCellChips();
const interactive = computed(() => parentChips.value.interactive);
provide(
  MONTH_CELL_CHIPS,
  computed(() => ({
    ...DEFAULT_CELL_CHIPS,
    showTime: props.showTime,
    interactive: interactive.value,
  }))
);

const c = computed(() => capDayContents(props.cell, props.caps));

function onMore(event: MouseEvent) {
  // A span lets the tap reach the button around it (the stream card opens the day).
  if (!interactive.value) return;
  event.stopPropagation();
  emit('more');
}
const isEmpty = computed(() => dayCount(props.cell) === 0);
const moreLabel = computed(() =>
  fillTemplate(t('planner.moreEvents'), { count: c.value.hidden.timeline })
);
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <template v-for="extra in c.extras" :key="extra.id">
      <BirthdayChip
        v-if="extra.kind === 'birthday' && extra.birthday"
        :birthday="extra.birthday"
        data-day-item
        class="block w-full"
        @click.stop="emit('birthday-click', extra.birthday)"
      />
      <HolidayChip
        v-else-if="extra.kind === 'holiday' && extra.holiday"
        :holiday="extra.holiday"
        :is-start="true"
        :is-end="true"
        data-day-item
        class="block w-full"
        @click.stop="emit('holiday-click', extra.holiday!)"
      />
    </template>

    <MonthDayItem
      v-for="item in c.allDay"
      :key="dayItemKey(item)"
      :item="item"
      data-day-item
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
    />
    <span
      v-if="c.hidden.allDay > 0"
      class="dark:text-ink-faint px-0.5 text-xs leading-tight text-[var(--color-text-muted)]"
      aria-hidden="true"
    >
      +{{ c.hidden.allDay }}
    </span>

    <MonthDayItem
      v-for="item in c.timeline"
      :key="dayItemKey(item)"
      :item="item"
      data-day-item
      @view-activity="(id, date) => emit('view-activity', id, date)"
      @vacation-click="(vid) => emit('vacation-click', vid)"
      @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
    />
    <component
      :is="interactive ? 'button' : 'span'"
      v-if="c.hidden.timeline > 0"
      :type="interactive ? 'button' : undefined"
      class="font-outfit dark:text-ink-faint self-start rounded-md px-1 py-0.5 text-xs font-semibold tracking-wide text-[var(--color-text-muted)] transition-colors"
      :class="interactive ? 'hover:text-primary-500 dark:hover:text-accent-lift' : ''"
      :aria-label="interactive ? moreLabel : undefined"
      :aria-hidden="interactive ? undefined : 'true'"
      data-day-item
      data-testid="day-contents-more"
      @click="onMore"
    >
      +{{ c.hidden.timeline }} {{ t('planner.moreEventsShort') }}
    </component>

    <span
      v-if="isEmpty"
      class="font-inter dark:text-ink-faint self-start text-xs text-[var(--color-text-muted)] italic"
    >
      {{ t('planner.nothingPlanned') }}
    </span>
  </div>
</template>
