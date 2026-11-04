<script setup lang="ts">
/**
 * One day of the month grid (#141): numeral row (holiday name, birthday cake, numeral),
 * then the trip / all-day lane and the chip stack sized to the measured row.
 *
 * It has NO switch on item kind: every lane and stack item renders through
 * `MonthDayItem`, and how a chip draws reaches the leaves through the month chip
 * context, provided here (`MONTH_CELL_CHIPS`, the only place grid presentation enters
 * the chips). Geometry arrives as `cssVars` (the `--mg-*` custom properties built from
 * `MONTH_CELL_METRICS`) and every size class here reads them, so the capacity maths
 * and the CSS cannot drift apart.
 *
 * Desktop: the root is a `<div>` that opens the day (a click on empty cell space), and
 * the numeral, cake, holiday name, chips and "+N more" are buttons. Phone: the root is
 * the `<button>` (tap selects the day), so everything inside it is non-interactive:
 * chips render as `aria-hidden` spans through `interactive: false`, and the cake and
 * "+N" are spans. Never nested buttons.
 *
 * Today is marked by its filled numeral only; the grid never draws the today wash or
 * an orange cell border.
 *
 * Phone densities: Titles and Bars are the same stack, drawn by the leaves from the
 * context's `density`. Faces replaces the stack with a wrapped cluster of who is busy that
 * day (`faceCluster` over EVERY `dayItems` entry, the lane winner included); the lane
 * still draws above it.
 */
import { computed, provide } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { formatTodayCaption } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { dayButtonLabel, dayItemKey, dayItems, type DayItem } from '@/utils/monthDayItems';
import { faceCluster, type CellLayout, type MonthGridDisplay } from '@/utils/monthGridLayout';
import { resolveSegmentTravellers } from '@/utils/segmentTravellers';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import { useFamilyStore } from '@/stores/familyStore';
import type { MonthDayCellData } from '@/utils/monthCells';
import type { BirthdayOccurrence } from '@/utils/birthdays';
import type { FamilyMember, HolidayOccurrence } from '@/types/models';
import {
  CALENDAR_TODAY,
  calendarDayBackground,
  type CalendarDayTint,
} from '@/constants/tileStyles';
import { MONTH_CELL_CHIPS } from '@/components/planner/monthCellChipsKey';
import MonthDayItem from '@/components/planner/MonthDayItem.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';

const props = defineProps<{
  cell: MonthDayCellData;
  layout: CellLayout;
  display: MonthGridDisplay;
  capacity: { shown: number; hidden: number };
  cssVars: Record<string, string>;
  tint?: CalendarDayTint;
  /** Phone only: this day's row is open under its week. */
  selected?: boolean;
  /** The id of the grid's one day row, for `aria-controls` while selected. */
  dayRowId: string;
}>();

const emit = defineEmits<{
  'select-date': [date: string];
  /** Phone only: the cell (its root button) was tapped. */
  'tap-day': [date: string];
  more: [date: string, trigger: HTMLElement];
  'view-activity': [activityId: string, date: string];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  'birthday-click': [birthday: BirthdayOccurrence];
}>();

const { t } = useTranslation();

const isPhone = computed(() => props.display.variant === 'phone');

provide(
  MONTH_CELL_CHIPS,
  computed(() => ({
    density: props.display.density,
    muted: !props.cell.isCurrentMonth,
    interactive: !isPhone.value,
    showTime: props.display.variant === 'desktop' && props.display.showTime,
    hideSoloFace: props.display.variant === 'desktop' && props.display.hideSoloFace,
  }))
);

const caption = computed(() => formatTodayCaption(props.cell.date));

const rootLabel = computed(() => {
  if (!isPhone.value) return caption.value + (props.cell.isToday ? `, ${t('planner.today')}` : '');
  // The phone cell has no room for the holiday name, so its label carries it.
  return dayButtonLabel(props.cell, t);
});

/**
 * The month grid marks today by its numeral only, so the today wash is off. The hover wash
 * sits on EVERY cell, tinted ones included (greg, 2026-11-04: a weekend or holiday square
 * must light up like any other, on phones as on desktop). `hover:` outranks the plain tint
 * class, and the slate-10 step is the tile convention (`tileStyles.ts`), visible on both the
 * white card and the phone's page ground; `surface-hover` is its dark partner.
 */
const HOVER_WASH = 'hover:bg-[var(--tint-slate-10)] dark:hover:bg-surface-hover transition-colors';
const backgroundClass = computed(
  () => `${calendarDayBackground(props.tint, false, '')} ${HOVER_WASH}`
);

const rootClass = computed(() =>
  isPhone.value
    ? [
        'px-0.5 text-left',
        props.selected ? 'ring-primary-500 dark:ring-accent-lift ring-2 ring-inset' : '',
      ]
    : 'cursor-pointer border-r border-b border-[var(--color-border)] px-1 last:border-r-0 dark:border-line'
);

const numeralClass = computed(() =>
  props.cell.isToday
    ? `${CALENDAR_TODAY.pill} grid h-[var(--mg-numeral-h)] w-[var(--mg-numeral-h)] place-items-center rounded-full`
    : props.cell.isCurrentMonth
      ? 'text-[var(--muted-text)]'
      : 'text-[var(--color-text-muted)] dark:text-ink-faint'
);

const holidays = computed(() => props.cell.extras.filter((e) => e.kind === 'holiday' && e.holiday));
const birthdays = computed(() =>
  props.cell.extras.filter((e) => e.kind === 'birthday' && e.birthday)
);

const visibleStack = computed(() => props.layout.stack.slice(0, props.capacity.shown));

/** The phone lane never draws a name (the bar is too short); desktop keeps the run's. */
const laneRun = computed(() => {
  const lane = props.layout.lane;
  if (!lane) return null;
  return isPhone.value ? { ...lane.run, showLabel: false } : lane.run;
});

/** Lane slices meet the neighbouring cells; only the true ends inset. */
const laneClass = computed(() => {
  const run = laneRun.value;
  if (!run) return '';
  return [
    'h-[var(--mg-lane-h)] flex-none',
    isPhone.value ? '-mx-0.5' : '-mx-1',
    run.isStart ? 'ml-1' : '',
    run.isEnd ? 'mr-1' : '',
  ];
});

// ── Faces density (phone) ──────────────────────────────────────────────────
const familyStore = useFamilyStore();
const { identityFor } = useActivityIdentity();
const { memberAvatarBindings } = useMemberAvatarBindings();

const isFaces = computed(() => props.display.density === 'faces');

/** Who an item involves: an activity's owners, a trip's or a segment's travellers. */
const rosterById = computed(() => new Map(familyStore.members.map((m) => [m.id, m])));
const pick = (ids: readonly string[]): FamilyMember[] =>
  ids.map((id) => rosterById.value.get(id)).filter((m): m is FamilyMember => !!m);
function membersOf(item: DayItem): FamilyMember[] {
  switch (item.kind) {
    case 'trip':
      return pick(item.vacation.travellerIds);
    case 'allday':
      return identityFor(item.item.activity).stackMembers;
    case 'timed':
      return identityFor(item.occurrence.activity).stackMembers;
    case 'segment':
      return pick(
        resolveSegmentTravellers(item.segment.travellerIds, item.segment.tripAssigneeIds)
      );
  }
}

const faces = computed(() =>
  isFaces.value ? faceCluster(dayItems(props.cell).map(membersOf)) : null
);

const moreLabel = computed(() =>
  fillTemplate(t('planner.moreEvents'), { count: props.capacity.hidden })
);

function onRootClick(): void {
  if (isPhone.value) emit('tap-day', props.cell.date);
  else emit('select-date', props.cell.date);
}

function onMore(event: MouseEvent): void {
  emit('more', props.cell.date, event.currentTarget as HTMLElement);
}

function forwardViewActivity(id: string, date: string): void {
  emit('view-activity', id, date);
}
</script>

<template>
  <component
    :is="isPhone ? 'button' : 'div'"
    :type="isPhone ? 'button' : undefined"
    :role="isPhone ? undefined : 'group'"
    :aria-label="rootLabel"
    :aria-expanded="isPhone ? !!selected : undefined"
    :aria-controls="isPhone && selected ? dayRowId : undefined"
    :aria-current="cell.isToday ? 'date' : undefined"
    :data-date="cell.date"
    :style="cssVars"
    class="relative flex min-w-0 flex-col overflow-hidden pt-[var(--mg-pad-t)] pb-[var(--mg-pad-b)]"
    :class="[rootClass, backgroundClass]"
    @click="onRootClick"
  >
    <!-- Numeral row: holiday name (desktop), cake, numeral. No gap below it. -->
    <div class="flex h-[var(--mg-numeral-h)] flex-none items-center justify-end gap-1">
      <template v-if="!isPhone">
        <button
          v-for="extra in holidays"
          :key="extra.id"
          type="button"
          class="mr-auto min-w-0 truncate text-xs font-medium text-[var(--holiday-clay)]"
          data-testid="month-cell-holiday"
          @click.stop="emit('holiday-click', extra.holiday!)"
        >
          {{ extra.label }}
        </button>
      </template>
      <template v-for="extra in birthdays" :key="extra.id">
        <span v-if="isPhone" class="text-xs leading-none" aria-hidden="true">{{
          extra.emoji
        }}</span>
        <button
          v-else
          type="button"
          class="text-xs leading-none"
          :aria-label="extra.label"
          data-testid="month-cell-birthday"
          @click.stop="emit('birthday-click', extra.birthday!)"
        >
          <span aria-hidden="true">{{ extra.emoji }}</span>
        </button>
      </template>
      <span
        v-if="isPhone"
        class="font-outfit text-xs font-semibold tabular-nums"
        :class="numeralClass"
        >{{ cell.day }}</span
      >
      <button
        v-else
        type="button"
        class="font-outfit text-xs font-semibold tabular-nums"
        :class="numeralClass"
        :aria-label="fillTemplate(t('planner.monthGrid.openDay'), { date: caption })"
        data-testid="month-cell-numeral"
        @click.stop="emit('select-date', cell.date)"
      >
        {{ cell.day }}
      </button>
    </div>

    <div class="flex min-w-0 flex-col gap-[var(--mg-gap)]">
      <MonthDayItem
        v-if="layout.lane && laneRun"
        :item="layout.lane.item"
        :run="laneRun"
        :class="laneClass"
        @view-activity="forwardViewActivity"
        @vacation-click="(vid) => emit('vacation-click', vid)"
        @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
      />
      <!-- Faces (phone): who is busy, wrapped (never overlapped), instead of the stack.
           Decorative here: the cell's own label counts the day and the row names it. -->
      <div
        v-if="faces"
        class="flex flex-wrap items-center justify-center gap-[0.1875rem] pt-1"
        :class="cell.isCurrentMonth ? '' : 'opacity-60'"
        aria-hidden="true"
        data-testid="month-cell-faces"
      >
        <BeanieAvatar
          v-for="member in faces.shown"
          :key="member.id"
          v-bind="memberAvatarBindings(member)"
          fallback="initials"
          size="2xs"
          aria-hidden="true"
        />
        <span v-if="faces.extra > 0" class="text-xs leading-none text-[var(--muted-text)]"
          >+{{ faces.extra }}</span
        >
      </div>
      <template v-else>
        <MonthDayItem
          v-for="item in visibleStack"
          :key="dayItemKey(item)"
          :item="item"
          class="h-[var(--mg-chip-h)] flex-none"
          @view-activity="forwardViewActivity"
          @vacation-click="(vid) => emit('vacation-click', vid)"
          @view-segment="(vid, sidx) => emit('view-segment', vid, sidx)"
        />
        <template v-if="capacity.hidden > 0">
          <span
            v-if="isPhone"
            class="text-xs leading-none text-[var(--muted-text)]"
            data-testid="month-more"
            >+{{ capacity.hidden }}</span
          >
          <button
            v-else
            type="button"
            class="hover:text-primary-500 dark:hover:text-accent-lift h-[var(--mg-more-h)] flex-none self-start text-xs leading-none font-semibold text-[var(--muted-text)]"
            :aria-label="moreLabel"
            aria-haspopup="dialog"
            data-testid="month-more"
            @click.stop="onMore"
          >
            +{{ capacity.hidden }} {{ t('planner.moreEventsShort') }}
          </button>
        </template>
      </template>
    </div>
  </component>
</template>
