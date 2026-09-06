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
import WallViewShell from '@/components/wall/WallViewShell.vue';
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
  now: Date;
  /**
   * Whether there is room for the side rail. Days view is the only one with
   * SEVEN columns, so the rail's 296px comes out of theirs — see
   * `DAYS_RAIL_MIN_VIEWPORT_PX`. Decided by the page, from a media query.
   */
  rail: boolean;
  /** The job/list bundle, forwarded whole to the shell. */
  peripherals: WallPeripheralData;
  /** The wall's person filter, which this view applies to its own content too. */
  visibleMemberIds: string[] | null;
}>();
const emit = defineEmits<{
  /**
   * A day tap RE-ANCHORS the week to start at that day — the today view's
   * convention, applied here. A week starting Saturday, with Thursday tapped,
   * redraws starting Thursday: the tapped day is used AS-IS, never snapped to
   * its calendar week. Week stepping snaps; a tap is a direct placement.
   *
   * `openDay` is deliberately NOT declared: this view can render the day itself,
   * so covering it with a sheet would be the lesser answer. The sheet is still
   * reachable from the lanes view's header and from any individual event.
   */
  focusDay: [string];
  open: [WallSheetTarget];
  openChores: [];
}>();

const activityStore = useActivityStore();
const { identityFor } = useActivityIdentity();

/** Portrait cannot hold seven readable columns; three plus a strip is the honest fit. */
const visible = computed(() => (props.portrait ? props.weekDays.slice(0, 3) : props.weekDays));
const rest = computed(() => (props.portrait ? props.weekDays.slice(3) : []));

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
 */
const showsToday = computed(() => props.weekDays.includes(props.todayYmd));

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
          @click="emit('focusDay', ymd)"
        >
          <span class="font-outfit wall-dow block font-bold tracking-[0.11em] uppercase opacity-70">
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

      <!-- portrait only: the rest of the week, tappable -->
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
    </template>
  </WallViewShell>
</template>
