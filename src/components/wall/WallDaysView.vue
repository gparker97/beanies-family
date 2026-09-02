<script setup lang="ts">
import type { FamilyActivity } from '@/types/models';
/**
 * View A — the week.
 *
 * Landscape: all seven days as columns. Portrait: three days as columns (NOT
 * stacked rows) with the rest as a tappable strip. Events always read
 * VERTICALLY, because down is how time reads; wrapping a day into a horizontal
 * grid destroys the "what's next" scan this whole surface exists for.
 *
 * Days are CAPPED and overflow into a "+N more" button rather than being
 * clipped by `overflow: hidden`. A silently truncated column is the worst
 * failure this screen can have — the family believes they have seen the day.
 */
import { computed } from 'vue';
import WallEventChip from '@/components/wall/WallEventChip.vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { wallEvents } from '@/utils/wallActivities';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

// The page renders all four views through one `<component :is>` with a single
// prop bag, so every view receives props it does not declare. Without this they
// would land on the root element as stray DOM attributes.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  weekDays: string[];
  todayYmd: string;
  portrait: boolean;
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
const { t } = useTranslation();

/** Columns here are DAYS, not bean lanes, so nothing names an owner — every one shows. */
function identityOf(activity: FamilyActivity) {
  return identityFor(activity);
}

/** The dot pips still need a single colour. */
function colourFor(activity: FamilyActivity) {
  return identityFor(activity).color;
}

/** Portrait cannot hold seven readable columns; three plus a strip is the honest fit. */
const visible = computed(() => (props.portrait ? props.weekDays.slice(0, 3) : props.weekDays));
const rest = computed(() => (props.portrait ? props.weekDays.slice(3) : []));
/** Three wide columns fit more rows than seven narrow ones. */
const cap = computed(() => (props.portrait ? 8 : 6));

/**
 * One expansion per day, memoised in a computed — NOT a function the template
 * calls repeatedly.
 *
 * `activitiesForDate` expands a whole MONTH of recurrences and then filters to
 * the one day. The template asks each column three times (the chips, the
 * overflow count, the empty state), so seven columns cost ~21 month-expansions
 * per render — on a screen that re-renders every 20s, forever, on a tablet.
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
function shownFor(ymd: string) {
  return eventsFor(ymd).slice(0, cap.value);
}
function overflowFor(ymd: string) {
  return Math.max(0, eventsFor(ymd).length - cap.value);
}
function dayLabel(ymd: string) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}
function dayNumber(ymd: string) {
  return new Date(`${ymd}T00:00:00`).getDate();
}
/** Times are already stored as display-ready HH:mm; all-day items have none. */
function timeLabel(entry: { activity: { startTime?: string } }) {
  return entry.activity.startTime || t('planner.allDay');
}

const { identityFor } = useActivityIdentity();
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5">
    <div
      class="grid min-h-0 flex-1 gap-2.5"
      :style="{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }"
    >
      <div
        v-for="ymd in visible"
        :key="ymd"
        class="flex min-h-0 flex-col overflow-hidden rounded-[20px] bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
        :class="ymd === todayYmd ? 'ring-[3px] ring-[var(--heritage-orange)]' : ''"
      >
        <button
          type="button"
          class="w-full px-3 py-2 text-center"
          :class="
            ymd === todayYmd
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
              : 'border-b border-[rgba(44,62,80,0.06)] dark:border-slate-700'
          "
          @click="emit('openDay', ymd)"
        >
          <span class="font-outfit wall-dow block font-bold tracking-[0.11em] uppercase opacity-70">
            {{ dayLabel(ymd) }}
          </span>
          <span class="font-outfit wall-dnum block leading-none font-extrabold">
            {{ dayNumber(ymd) }}
          </span>
        </button>
        <!--
          `overflow-y-auto`, not `hidden`: the cap is a fixed COUNT, not a
          measured fit, so on a 4:3 tablet, with two-line titles, or under Large
          text size the last chips and the "+N more" button itself can still be
          pushed out. Scrolling keeps them reachable rather than silently gone.
        -->
        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
          <WallEventChip
            v-for="entry in shownFor(ymd)"
            :key="entry.activity.id + entry.date"
            :activity="entry.activity"
            :identity="identityOf(entry.activity)"
            :time="timeLabel(entry)"
            @open="
              emit('open', { kind: 'activity', activityId: entry.activity.id, ymd: entry.date })
            "
          />
          <button
            v-if="overflowFor(ymd)"
            type="button"
            class="font-outfit text-primary-500 wall-more shrink-0 rounded-xl bg-[var(--tint-orange-8)] px-2 py-1.5 font-bold"
            @click="emit('openDay', ymd)"
          >
            {{ fillTemplate(t('wall.card.more'), { count: overflowFor(ymd) }) }}
            <span aria-hidden="true">›</span>
          </button>
          <p
            v-if="!eventsFor(ymd).length"
            class="font-caveat m-auto text-[var(--muted-text,#4d5d6c)] opacity-70"
          >
            {{ t('wall.day.nothingOn') }}
          </p>
        </div>
      </div>
    </div>

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
        class="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-left shadow-[var(--card-shadow)] dark:bg-slate-800"
        @click="emit('openDay', ymd)"
      >
        <span
          class="font-outfit text-secondary-500 wall-rest-day font-bold uppercase dark:text-gray-100"
        >
          {{ dayLabel(ymd) }} {{ dayNumber(ymd) }}
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
      variant="band"
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
