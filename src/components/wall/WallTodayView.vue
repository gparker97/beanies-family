<script setup lang="ts">
/**
 * View C — today at full size, on the time axis.
 *
 * The view with room to breathe, so it gets the fullest expression of the grid:
 * full-density blocks, side-by-side overlaps at a readable width, and the
 * now-line as the hero. It answers "are we late?" without anybody doing
 * arithmetic — which is the point of this view over view A.
 *
 * The hand-rolled `minutesOf` / `nowId` / assumed-duration constant this file
 * used to carry are gone: the grid derives the running block from ONE definition
 * (`activitySpanMinutes` + the block's own state), so the marker here and the
 * marker on every other view can no longer disagree.
 */
import { computed } from 'vue';
import WallBackButton from '@/components/wall/WallBackButton.vue';
import WallTimeGrid from '@/components/wall/WallTimeGrid.vue';
import WallViewShell from '@/components/wall/WallViewShell.vue';
import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { wallDayAllDay, wallEvents } from '@/utils/wallActivities';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { dayOfMonth, weekdayShort } from '@/utils/date';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';
import type { WallPeripheralData, WallSheetTarget } from '@/types/wall';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** The calendar week containing the anchor — the strip's seven chips. */
  weekOfAnchor: string[];
  todayYmd: string;
  portrait: boolean;
  /** Ticks with the page clock, so "happening now" moves through the day. */
  now: Date;
  /** The wall's shared anchor — the day this panel renders. */
  anchorYmd: string;
  /** Names the view the back control returns to. */
  backLabel: string;
  /** False when there is nowhere different to go — see `canGoBackFrom`. */
  canGoBack: boolean;
  /** The job/list bundle, forwarded whole to the shell. */
  peripherals: WallPeripheralData;
  /** The wall's person filter, which this view applies to its own content too. */
  visibleMemberIds: string[] | null;
}>();
// `openDay` is deliberately NOT declared: in THIS view tapping a day moves the
// panel to that day rather than opening a sheet over it.
const emit = defineEmits<{
  /** Move the wall's shared anchor to this day. See `useWallAnchor`. */
  focusDay: [string];
  /** Return to the view this one was opened from. */
  back: [];
  open: [WallSheetTarget];
  openChores: [];
}>();

const activityStore = useActivityStore();
const { t } = useTranslation();
const { identityFor } = useActivityIdentity();

/**
 * The day the big panel is showing. Tapping the week strip moves this rather
 * than opening a drawer: the drawer covered the very panel that already renders
 * a day in full.
 *
 * ⚠️ This used to be a LOCAL ref with its own midnight watcher, and that was a
 * bug: all four views render through one `<component :is>`, so moving to Thursday
 * and flicking to another view destroyed it and returned the wall to today with
 * no indication why. It is now the wall's shared anchor, owned by the page in
 * `useWallAnchor` — which also carries the midnight re-anchor this used to do.
 * Do not reintroduce a per-view date.
 */
const focusYmd = computed(() => props.anchorYmd);

/**
 * The CALENDAR week containing the day on screen — supplied by the page.
 *
 * ⚠️ Two wrong answers were tried first, and both broke the picker in opposite
 * directions. `weekDays` (anchor..anchor+6) re-based on every tap: choosing
 * Thursday relabelled the strip Thu–Wed and put Mon–Wed out of reach. Pinning it
 * to today..today+6 fixed that but could not represent its own selection — one
 * press of `‹` moved the anchor outside the window, leaving all seven chips
 * unselected with `aria-pressed="false"` and no way back from the strip.
 *
 * A calendar week satisfies both: every day in it shares the same week, so
 * picking one cannot move the window, and the anchor is always inside it.
 */
const stripDays = computed(() => props.weekOfAnchor);
const isToday = computed(() => focusYmd.value === props.todayYmd);

const events = computed(() =>
  wallEvents(activityStore.activitiesForDate(focusYmd.value), props.visibleMemberIds)
);
const gridColumns = computed(() => [
  {
    key: focusYmd.value,
    isToday: isToday.value,
    occurrences: events.value.filter((e) => !e.activity.isAllDay),
  },
]);
/**
 * This view's single column is a DAY, not a member — so it takes the day-shaped
 * helper, exactly as the week does, with a one-day window.
 *
 * ⚠️ Not `wallSharedAllDay`: that splits by member column and asks
 * `belongsInMemberColumn` of each. Handing it a placeholder id would have hidden
 * every all-day event that HAS an owner (a child's INSET day, a birthday) from
 * the one view whose job is to show the whole day. `wallDayAllDay` also picks up
 * both halves of `computeAllDaySpans`, so a multi-day trip clamps to this column
 * instead of disappearing.
 */
const allDaySpans = computed(() => {
  const days = [focusYmd.value];
  const result = computeAllDaySpans(
    events.value.map((o) => ({ activity: o.activity, date: o.date })),
    days.map((dateStr) => ({ dateStr }))
  );
  return wallDayAllDay(result, days, (activity, ymd) => ({ activity, date: ymd }));
});

/** Content-derived; the shell turns it into a band/rail/strip choice. */
const busiest = computed(() => events.value.length);

/** Memoised for the same reason as view A — see `eventsByDay` there. */
const stripByDay = computed(() => {
  const map = new Map<string, ReturnType<typeof wallEvents>>();
  for (const ymd of stripDays.value) {
    map.set(ymd, wallEvents(activityStore.activitiesForDate(ymd), props.visibleMemberIds));
  }
  return map;
});
function eventsOn(ymd: string) {
  return stripByDay.value.get(ymd) ?? [];
}
function colourFor(activity: FamilyActivity) {
  return identityFor(activity).color;
}

/** Names the day on screen. With the drawer gone, this is what tells you where you are. */
const focusLabel = computed(() =>
  isToday.value
    ? t('wall.today.today')
    : new Date(`${focusYmd.value}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
);
</script>

<template>
  <WallViewShell
    :portrait="portrait"
    :rail="true"
    :busiest="busiest"
    :meals-ymd="focusYmd"
    :peripherals="peripherals"
    @open="emit('open', $event)"
    @open-chores="emit('openChores')"
  >
    <template #main>
      <div
        class="flex shrink-0 items-center justify-between gap-3"
        :style="{ paddingLeft: `${AXIS_WIDTH_PX}px` }"
      >
        <p class="font-outfit text-secondary-500 wall-slot-title dark:text-ink font-bold">
          {{ focusLabel }}
        </p>
        <!--
          The way back, named after where you came from. Reuses the jobs board's
          control and its string — greg's call, over my recommendation that the
          always-visible view switcher made it unnecessary.

          Shown only when there is somewhere different to go: `canGoBack` is a
          READ-side check because no write-side rule can see `today -> jobs ->
          back` coming, which leaves this naming the view you are already in.
        -->
        <WallBackButton v-if="canGoBack" :back-label="backLabel" @back="emit('back')" />
      </div>

      <WallTimeGrid
        :columns="gridColumns"
        :all-day-spans="allDaySpans"
        :now="now"
        :dim-past="isToday"
        :show-now="isToday"
        :axis-width="AXIS_WIDTH_PX"
        view-id="today"
        @open="emit('open', $event)"
      />

      <div class="grid shrink-0 gap-2" style="grid-template-columns: repeat(7, 1fr)">
        <button
          v-for="ymd in stripDays"
          :key="ymd"
          type="button"
          class="rounded-2xl px-2 py-2 text-center shadow-[var(--card-shadow)]"
          :class="
            ymd === focusYmd
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
              : 'dark:bg-surface-raised bg-white'
          "
          :aria-pressed="ymd === focusYmd"
          @click="emit('focusDay', ymd)"
        >
          <span
            class="font-outfit wall-strip-day block font-bold tracking-[0.1em] uppercase opacity-70"
          >
            {{ weekdayShort(ymd) }}
          </span>
          <span class="font-outfit wall-strip-num block leading-tight font-extrabold">
            {{ dayOfMonth(ymd) }}
          </span>
          <span class="mt-1 flex min-h-[7px] justify-center gap-1" aria-hidden="true">
            <i
              v-for="entry in eventsOn(ymd).slice(0, 4)"
              :key="entry.activity.id + entry.date"
              class="block h-1.5 w-1.5 rounded-full"
              :class="ymd === focusYmd ? 'ring-[1.5px] ring-white/55' : ''"
              :style="{ background: colourFor(entry.activity) }"
            />
          </span>
        </button>
      </div>
    </template>
  </WallViewShell>
</template>
