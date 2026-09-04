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
import { computed, ref, watch } from 'vue';
import WallTimeGrid from '@/components/wall/WallTimeGrid.vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { wallDayAllDay, wallEvents, wallPeripheralVariant } from '@/utils/wallActivities';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import { dayOfMonth, weekdayShort } from '@/utils/date';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity } from '@/types/models';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  weekDays: string[];
  todayYmd: string;
  portrait: boolean;
  /** Ticks with the page clock, so "happening now" moves through the day. */
  now: Date;
  todosFor: (memberId: string) => WallJob[];
  unassignedTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  visibleMemberIds: string[] | null;
}>();
// `openDay` is deliberately NOT declared: in THIS view tapping a day moves the
// panel to that day rather than opening a sheet over it.
const emit = defineEmits<{
  open: [WallSheetTarget];
  openChores: [];
}>();

const activityStore = useActivityStore();
const { t } = useTranslation();
const { identityFor } = useActivityIdentity();

/**
 * The day the big panel is showing. Tapping the week strip moves this rather
 * than opening a drawer: the drawer covered the very panel that already renders
 * a day in full. Follows `todayYmd` so the midnight rollover pulls the wall back
 * to the real today instead of stranding it on yesterday.
 */
const focusYmd = ref(props.todayYmd);
watch(
  () => props.todayYmd,
  (ymd) => {
    focusYmd.value = ymd;
  }
);
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

const peripheralVariant = computed(() =>
  wallPeripheralVariant(props.portrait ? 'band' : 'rail', events.value.length, props.portrait)
);

/** Memoised for the same reason as view A — see `eventsByDay` there. */
const stripByDay = computed(() => {
  const map = new Map<string, ReturnType<typeof wallEvents>>();
  for (const ymd of props.weekDays) {
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
  <div class="flex min-h-0 flex-1 gap-4" :class="portrait ? 'flex-col' : 'flex-row'">
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <div
        class="flex shrink-0 items-center justify-between gap-3"
        :style="{ paddingLeft: `${AXIS_WIDTH_PX}px` }"
      >
        <p class="font-outfit text-secondary-500 wall-slot-title dark:text-ink font-bold">
          {{ focusLabel }}
        </p>
        <button
          v-if="!isToday"
          type="button"
          class="font-outfit text-primary-500 wall-more shrink-0 rounded-xl bg-[var(--tint-orange-8)] px-2.5 py-1 font-bold"
          @click="focusYmd = todayYmd"
        >
          {{ t('wall.today.backToToday') }}
        </button>
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
          v-for="ymd in weekDays"
          :key="ymd"
          type="button"
          class="rounded-2xl px-2 py-2 text-center shadow-[var(--card-shadow)]"
          :class="
            ymd === focusYmd
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
              : 'dark:bg-surface-raised bg-white'
          "
          :aria-pressed="ymd === focusYmd"
          @click="focusYmd = ymd"
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
    </div>

    <div :class="portrait ? 'shrink-0' : 'w-[296px] shrink-0 overflow-y-auto'">
      <WallPeripheralCards
        :variant="peripheralVariant"
        :portrait="portrait"
        :meals-ymd="focusYmd"
        :todos-for="todosFor"
        :unassigned-todos="unassignedTodos"
        :lists-for="listsFor"
        :orphan-lists="orphanLists"
        :visible-member-ids="visibleMemberIds"
        @open="emit('open', $event)"
        @open-chores="emit('openChores')"
      />
    </div>
  </div>
</template>
