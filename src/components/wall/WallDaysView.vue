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
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { useActivityStore } from '@/stores/activityStore';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { wallDayAllDay, wallEvents, wallPeripheralVariant } from '@/utils/wallActivities';
import { dayOfMonth, weekdayShort } from '@/utils/date';
import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

// The page renders all four views through one `<component :is>` with a single
// prop bag, so every view receives props it does not declare.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  weekDays: string[];
  todayYmd: string;
  portrait: boolean;
  now: Date;
  todosFor: (memberId: string) => WallJob[];
  unassignedTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  visibleMemberIds: string[] | null;
}>();
const emit = defineEmits<{
  openDay: [string];
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

/** Content-derived, never layout-derived — see `wallPeripheralVariant`. */
const busiest = computed(() => Math.max(0, ...visible.value.map((ymd) => eventsFor(ymd).length)));
const peripheralVariant = computed(() =>
  wallPeripheralVariant('band', busiest.value, props.portrait)
);

/** The rest-of-week strip still needs a colour per pip. */
function colourFor(activity: FamilyActivity) {
  return identityFor(activity).color;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5">
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
      :show-now="true"
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
        @click="emit('openDay', ymd)"
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

    <WallPeripheralCards
      :variant="peripheralVariant"
      :portrait="portrait"
      :meals-ymd="todayYmd"
      :todos-for="todosFor"
      :unassigned-todos="unassignedTodos"
      :lists-for="listsFor"
      :orphan-lists="orphanLists"
      :visible-member-ids="visibleMemberIds"
      @open="emit('open', $event)"
      @open-chores="emit('openChores')"
    />
  </div>
</template>
