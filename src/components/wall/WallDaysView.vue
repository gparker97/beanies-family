<script setup lang="ts">
/**
 * View A — the week, on one shared time axis.
 *
 * Landscape: all seven days as columns. Portrait: three days as columns (NOT
 * stacked rows) with the rest as a tappable strip.
 *
 * This is the view where the grid pays for itself. Because the axis carries the
 * time, a block no longer prints `07:30` — and that reclaimed line of text per
 * event is what makes seven columns readable at tablet width. It also means a
 * rule drawn at 07:30 is ONE line across the whole week, so "the 8am crunch" is
 * a shape you see rather than seven times you read.
 *
 * Nothing truncates any more: the grid fits the day by folding empty stretches
 * and, in the last resort, by squeezing — so the old `+N more` button and its
 * cap have gone. A silently truncated column was the worst failure this screen
 * could have, and now it cannot happen.
 */
import { computed } from 'vue';
import WallTimeGrid from '@/components/wall/WallTimeGrid.vue';
import WallNavArrow from '@/components/wall/WallNavArrow.vue';
import WallViewShell from '@/components/wall/WallViewShell.vue';
import { ARROW_GUTTER_PX } from '@/components/wall/wallLayout';
import { useActivityStore } from '@/stores/activityStore';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { wallDayAllDay, wallEvents } from '@/utils/wallActivities';
import { dayOfMonth, weekdayShort } from '@/utils/date';
import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';
import type { WallPeripheralData, WallSheetTarget } from '@/types/wall';

// The page renders all four views through one `<component :is>` with a single
// prop bag, so every view receives props it does not declare.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  weekDays: string[];
  todayYmd: string;
  portrait: boolean;
  /**
   * How many day columns to draw. Decided by the page from the viewport, after
   * the rail has taken its width — see `daysLayoutFor`.
   */
  dayColumns: number;
  now: Date;
  /**
   * Whether the peripheral cards sit beside the grid rather than under it.
   * Decided together with `dayColumns` by `daysLayoutFor` — the rail takes its
   * width first and the count absorbs what is left, which is what removed the
   * old fixed threshold.
   */
  rail: boolean;
  /** The job/list bundle, forwarded whole to the shell. */
  peripherals: WallPeripheralData;
  /** The wall's person filter, which this view applies to its own content too. */
  visibleMemberIds: string[] | null;
  /** Whether each arrow can still move — the range boundary, from the page. */
  canStepBack: boolean;
  canStepForward: boolean;
}>();
const emit = defineEmits<{
  /**
   * A day the wall is NOT already drawing in full — a chip in the strip below —
   * RE-ANCHORS the week to start at that day. The tapped day is used AS-IS,
   * never snapped to its calendar week: a week starting Saturday, with Thursday
   * tapped, redraws starting Thursday. Week STEPPING snaps; a tap is a direct
   * placement.
   */
  focusDay: [string];
  /**
   * A day the wall IS already drawing — a column header — opens the today view
   * anchored on it. The day is on screen, so the useful next step is depth.
   *
   * The rule belongs to the AFFORDANCE, not to this view, and is stated once on
   * `onOpenDay` in the page — which is why the registry no longer carries a
   * per-view version of it that could go stale again.
   */
  openDay: [string];
  /** A step arrow was pressed. The page owns the anchor, so it owns the move. */
  step: [-1 | 1];
  open: [WallSheetTarget];
  openChores: [];
}>();

const activityStore = useActivityStore();
const { identityFor } = useActivityIdentity();

/**
 * As many days as fit at a READABLE width; the rest go to the strip below.
 *
 * ⚠️ One rule for both orientations now. It was `portrait ? slice(0,3) : all`,
 * which meant landscape always drew seven however narrow the glass — the
 * squeeze this replaces — and portrait always drew three however wide it was.
 * The count arrives as a prop because it depends on the rail, and the rail
 * decision belongs to the page.
 *
 * ⭐ The now-line cannot be hidden by this. `weekDays` starts AT the anchor, so
 * a wall anchored to today — its default and its resting state — always has
 * today in column 0.
 */
const visible = computed(() => props.weekDays.slice(0, props.dayColumns));
const rest = computed(() => props.weekDays.slice(props.dayColumns));

/**
 * One expansion per day, memoised in a computed — NOT a function the template
 * calls repeatedly. `activitiesForDate` expands a whole MONTH of recurrences and
 * then filters to the one day, on a screen that re-renders every 20s forever.
 */
const eventsByDay = computed(() => {
  const map = new Map<string, ReturnType<typeof wallEvents>>();
  for (const ymd of [...visible.value, ...rest.value]) {
    map.set(ymd, wallEvents(activityStore.activitiesForDate(ymd), props.visibleMemberIds));
  }
  return map;
});
function eventsFor(ymd: string) {
  return eventsByDay.value.get(ymd) ?? [];
}

const gridColumns = computed(() =>
  visible.value.map((ymd) => ({
    key: ymd,
    // Timed only — the all-day items go to the band, via `wallDayAllDay`. All
    // three views pass the same shape, so the grid's contract does not vary.
    occurrences: eventsFor(ymd).filter((e) => !e.activity.isAllDay),
    isToday: ymd === props.todayYmd,
  }))
);

/**
 * ⚠️ BOTH halves of `computeAllDaySpans` are required. `spans` is multi-day ONLY;
 * every single-day all-day item — a birthday, an INSET day, bin night — is in
 * `singleByDate`. Passing `spans` alone would drop all of those from this view
 * entirely: they are not timed, so they never reach the plot either. See
 * `wallDayAllDay` and its test.
 */
const allDaySpans = computed(() => {
  const occurrences = visible.value.flatMap((ymd) => eventsFor(ymd));
  const result = computeAllDaySpans(
    occurrences.map((o) => ({ activity: o.activity, date: o.date })),
    visible.value.map((dateStr) => ({ dateStr }))
  );
  return wallDayAllDay(result, visible.value, (activity, ymd) => ({ activity, date: ymd }));
});

/**
 * The now-line belongs to the real today, not to whatever week is on screen.
 * Without this the wall drew a red line through an arbitrary column of next
 * week. `dim-past` needs no equivalent: the grid already gates dimming per
 * column on `column.isToday`.
 *
 * ⚠️ Tested against `visible`, NOT `weekDays`. Portrait renders three columns of
 * the seven, so a week that contains today but does not SHOW it would otherwise
 * paint a now-line and a live "now at HH:MM" pill across three days that have
 * already happened.
 */
const showsToday = computed(() => visible.value.includes(props.todayYmd));

/** Content-derived, never layout-derived — see `wallPeripheralVariant`. */
const busiest = computed(() => Math.max(0, ...visible.value.map((ymd) => eventsFor(ymd).length)));

/** The rest-of-week strip still needs a colour per pip. */
function colourFor(activity: FamilyActivity) {
  return identityFor(activity).color;
}
</script>

<template>
  <WallViewShell
    :portrait="portrait"
    :rail="rail"
    :busiest="busiest"
    :meals-ymd="todayYmd"
    :peripherals="peripherals"
    @open="emit('open', $event)"
    @open-chores="emit('openChores')"
  >
    <template #main>
      <!--
        ⚠️ ONE wrapper carries the arrow gutter, so the date row, the plot and
        the strip all lose the same width. Reserving it on the date row alone
        would put every day header off the column it labels — which is the one
        thing the markup comment below says it exists to guarantee.

        The arrows are absolutely positioned INSIDE it: the back one over the
        axis gutter, which is empty at this height, and the forward one in the
        reserved space. Both sit outside the header row's own grid track, so
        neither can overlap a day button. The padding is viewport-derived and
        stable, so the plot's ResizeObserver cannot be fed a width that depends
        on what it measured.
      -->
      <div
        class="relative flex min-h-0 flex-1 flex-col gap-2.5"
        :style="{ paddingRight: `${ARROW_GUTTER_PX}px` }"
      >
        <WallNavArrow
          class="absolute top-0 left-0 z-10"
          :style="{ width: `${AXIS_WIDTH_PX}px` }"
          :direction="-1"
          :enabled="canStepBack"
          @step="emit('step', $event)"
        />
        <WallNavArrow
          class="absolute top-0 right-0 z-10"
          :style="{ width: `${ARROW_GUTTER_PX}px` }"
          :direction="1"
          :enabled="canStepForward"
          @step="emit('step', $event)"
        />

        <!-- day headers, on the same column track as the plot below -->
        <div
          class="grid shrink-0 gap-0"
          :style="{
            paddingLeft: `${AXIS_WIDTH_PX}px`,
            gridTemplateColumns: `repeat(${visible.length}, 1fr)`,
          }"
        >
          <button
            v-for="ymd in visible"
            :key="ymd"
            type="button"
            class="rounded-t-2xl px-2 py-1.5 text-center"
            :class="
              ymd === todayYmd
                ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
                : 'text-secondary-500 dark:text-ink'
            "
            @click="emit('openDay', ymd)"
          >
            <span
              class="font-outfit wall-dow block font-bold tracking-[0.11em] uppercase opacity-70"
            >
              {{ weekdayShort(ymd) }}
            </span>
            <span class="font-outfit wall-dnum block leading-tight font-extrabold">
              {{ dayOfMonth(ymd) }}
            </span>
          </button>
        </div>

        <WallTimeGrid
          :columns="gridColumns"
          :all-day-spans="allDaySpans"
          :now="now"
          :dim-past="true"
          :show-now="showsToday"
          :axis-width="AXIS_WIDTH_PX"
          view-id="days"
          @open="emit('open', $event)"
        />

        <!-- the days that did not fit as columns, tappable. Landscape too, now. -->
        <div
          v-if="rest.length"
          class="grid shrink-0 gap-2"
          :style="{ gridTemplateColumns: `repeat(${rest.length}, 1fr)` }"
        >
          <button
            v-for="ymd in rest"
            :key="ymd"
            type="button"
            class="dark:bg-surface-raised flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-left shadow-[var(--card-shadow)]"
            @click="emit('focusDay', ymd)"
          >
            <span
              class="font-outfit text-secondary-500 wall-rest-day dark:text-ink font-bold uppercase"
            >
              {{ weekdayShort(ymd) }} {{ dayOfMonth(ymd) }}
            </span>
            <span class="ml-auto flex gap-1" aria-hidden="true">
              <i
                v-for="entry in eventsFor(ymd).slice(0, 4)"
                :key="entry.activity.id + entry.date"
                class="block h-1.5 w-1.5 rounded-full"
                :style="{ background: colourFor(entry.activity) }"
              />
            </span>
            <span
              class="font-outfit text-primary-500 wall-rest-count rounded-full bg-[var(--tint-orange-8)] px-2 py-0.5 font-bold"
            >
              {{ eventsFor(ymd).length }}
            </span>
          </button>
        </div>
      </div>
    </template>
  </WallViewShell>
</template>
