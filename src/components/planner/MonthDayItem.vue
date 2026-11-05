<script setup lang="ts">
/**
 * The ONE dispatcher from a `DayItem` to its chip (#141). Every surface that shows a
 * month item renders through it: the grid cell's lane and stack, the desktop popover,
 * the phone day row and the stream card (the last three via `MonthDayContents`). So
 * the switch on an item's kind, the reveal hooks and the click wiring are written once.
 *
 *  - The reveal hooks `data-activity-id` / `data-occurrence-date` land on the chip's
 *    root (`useActivityReveal.findRevealElement` relies on them).
 *  - A chip click never also opens the day under it: `MonthChipFrame` stops propagation
 *    itself, and the two bar chips are stopped here (`AllDayChip` passes the native
 *    event through, so `.stop` works).
 *  - A single root (a `v-if` chain), so the parent's height class and attributes fall
 *    through to the rendered chip.
 *
 * `run` is the cell's slice of a lane run; the default is a standalone bar (rounded at
 * both ends and labelled), which is what a stack or a vertical day list wants.
 *
 * Drag and drop (#142): the two ACTIVITY chips (`MonthChip`, `AllDayActivityChip`) carry the
 * drag source and the "Press Space to move" description (`useActivityDragAttrs`), by
 * fallthrough beside the reveal hooks, and only where the month chip context says the chip
 * is a control (`interactive`): a drag source is a control. So a phone grid cell's chips
 * (inside the cell's button) never lift; the open day row's and the desktop chips do. Trips,
 * segments, birthdays and holidays are not activities and never get a source, and neither
 * does a vacation-linked activity (it belongs to its trip).
 */
import { computed } from 'vue';
import type { FamilyActivity } from '@/types/models';
import { useMonthCellChips } from '@/components/planner/monthCellChipsKey';
import { useActivityDragAttrs } from '@/composables/drag/useActivityDragAttrs';
import type { DayItem } from '@/utils/monthDayItems';
import type { LaneRun } from '@/utils/monthGridLayout';
import MonthChip from '@/components/planner/MonthChip.vue';
import MonthSegmentChip from '@/components/planner/MonthSegmentChip.vue';
import TripChip from '@/components/planner/TripChip.vue';
import AllDayActivityChip from '@/components/planner/AllDayActivityChip.vue';

const props = withDefaults(defineProps<{ item: DayItem; run?: LaneRun }>(), {
  run: () => ({ isStart: true, isEnd: true, showLabel: true }),
});

const emit = defineEmits<{
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
}>();

const chips = useMonthCellChips();
const activityDragAttrs = useActivityDragAttrs();

const activity = computed<FamilyActivity | null>(() => {
  const item = props.item;
  if (item.kind === 'timed') return item.occurrence.activity;
  return item.kind === 'allday' ? item.item.activity : null;
});

const dragAttrs = computed(() =>
  activity.value ? activityDragAttrs(activity.value, chips.value.interactive) : {}
);
</script>

<template>
  <MonthChip
    v-if="item.kind === 'timed'"
    :occurrence="item.occurrence"
    :data-activity-id="item.occurrence.activity.id"
    :data-occurrence-date="item.occurrence.date"
    v-bind="dragAttrs"
    @view-activity="(id, date) => emit('view-activity', id, date)"
  />
  <MonthSegmentChip
    v-else-if="item.kind === 'segment'"
    :occurrence="item.segment"
    @click="(vid, sidx) => emit('view-segment', vid, sidx)"
  />
  <TripChip
    v-else-if="item.kind === 'trip'"
    :vacation="item.vacation"
    v-bind="run"
    @click.stop="emit('vacation-click', item.vacation.id)"
  />
  <AllDayActivityChip
    v-else
    :activity="item.item.activity"
    :date="item.date"
    v-bind="{ ...run, ...dragAttrs }"
    :with-faces="true"
    :data-activity-id="item.item.activity.id"
    :data-occurrence-date="item.date"
    @click.stop="emit('view-activity', item.item.activity.id, item.date)"
  />
</template>
