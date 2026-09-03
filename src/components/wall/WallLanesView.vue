<script setup lang="ts">
/**
 * View B — one lane per bean, on one shared time axis.
 *
 * This is the view a time grid changes most. As five independent stacks, the
 * lanes could not answer the single most valuable question a family screen has:
 * *are two of these at the same time, and is anybody free?* On a shared axis
 * 16:00 is the SAME line in every lane, so Leo's football colliding with Milo's
 * swimming — and nobody left to drive both — is a shape you see rather than six
 * timestamps you compare.
 *
 * Humans only. Pets belong on the family roster, but a lane headed "Bella · 0
 * today" is dead space on the one screen that cannot afford it.
 */
import { computed } from 'vue';
import WallBeanHeader from '@/components/wall/WallBeanHeader.vue';
import WallTimeGrid from '@/components/wall/WallTimeGrid.vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { AXIS_WIDTH_PX } from '@/utils/wallTimeGrid';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { belongsInMemberColumn } from '@/utils/assignees';
import { sortByTime, wallPeripheralVariant, wallSharedAllDay } from '@/utils/wallActivities';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  todayYmd: string;
  tomorrowYmd: string;
  portrait: boolean;
  now: Date;
  todosFor: (memberId: string) => WallJob[];
  unassignedTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  isPending: (job: WallJob) => boolean;
  visibleMemberIds: string[] | null;
}>();
const emit = defineEmits<{
  toggle: [WallJob];
  open: [WallSheetTarget];
  openDay: [string];
  openChores: [];
}>();

const activityStore = useActivityStore();
const familyStore = useFamilyStore();
const { t } = useTranslation();

const members = computed(() => {
  const humans = familyStore.sortedHumans;
  if (!props.visibleMemberIds) return humans;
  const allowed = new Set(props.visibleMemberIds);
  return humans.filter((m) => allowed.has(m.id));
});
const memberIds = computed(() => members.value.map((m) => m.id));

const todayEvents = computed(() => activityStore.activitiesForDate(props.todayYmd));
const tomorrowEvents = computed(() => activityStore.activitiesForDate(props.tomorrowYmd));

/**
 * Memoised per member rather than recomputed per template read.
 *
 * NOT the `activitiesForDate` month-expansion bug `WallDaysView` guards against
 * — `todayEvents` is already a computed, so that runs once. This is the cheaper
 * filter-and-sort, which the template previously asked for three times per bean.
 */
const eventsByMember = computed(() => {
  const map = new Map<string, ReturnType<typeof sortByTime>>();
  for (const member of members.value) {
    map.set(
      member.id,
      sortByTime(todayEvents.value.filter((e) => belongsInMemberColumn(e.activity, member.id)))
    );
  }
  return map;
});
function eventsFor(memberId: string) {
  return eventsByMember.value.get(memberId) ?? [];
}

/**
 * ⚠️ A lane is a person's column, and a SHARED event belongs in everyone's: an
 * event with two owners appears in both their lanes, one with no owner in all of
 * them. `belongsInMemberColumn` is the same predicate the all-day band uses, so
 * the band and the plot can never disagree about whose column something is in.
 *
 * Timed events only reach the grid; the all-day ones go to the band.
 */
const gridColumns = computed(() =>
  members.value.map((member) => ({
    key: member.id,
    laneMemberId: member.id,
    // The lane wears the bean's colour for its whole height — which is also why
    // the cards inside it do not. See `WallTimeBlock`'s `washed` prop.
    tint: member.color,
    isToday: true,
    occurrences: eventsFor(member.id).filter((e) => !e.activity.isAllDay),
  }))
);
const allDaySpans = computed(() =>
  wallSharedAllDay(
    todayEvents.value.filter((e) => e.activity.isAllDay),
    memberIds.value
  )
);

/**
 * ⚠️ No per-lane jobs row. To-dos live in the DRAWER, as they do everywhere else.
 *
 * A row of jobs pinned under the lanes was tried and removed. It cost a whole
 * band of height — enough that the grid, the jobs and the peripheral cards
 * together crushed the calendar to about 90px — and it put to-dos somewhere they
 * appear nowhere else in the app, uncoloured and detached from the bean whose
 * lane they sat under. The cards keep their full height and their titles, and a
 * tap opens the same to-do drawer every other screen uses. One place for to-dos,
 * and the height goes back to the calendar.
 *
 * Landscape puts them BESIDE the lanes, as the today view does. Stacked under
 * the grid they cost about 250px — more than the jobs row they replaced — and
 * squeezed the calendar into a 230px strip. Sideways they cost nothing vertical,
 * and six lanes across the remaining ~920px still leave 150px each. Portrait has
 * no width to spare, so it keeps the band.
 */
const busiest = computed(() => Math.max(0, ...members.value.map((m) => eventsFor(m.id).length)));
const peripheralVariant = computed(() =>
  wallPeripheralVariant(props.portrait ? 'band' : 'rail', busiest.value, props.portrait)
);

/**
 * A face beside a name needs room. Six lanes across a landscape tablet is ~153px
 * each, which truncates the subtitle to "3 today · 1..." — so the plate stacks
 * once the family is large enough, exactly as it does in portrait. Derived from
 * the lane COUNT rather than a measured width, so it cannot flicker.
 */
const inlineHeaders = computed(() => !props.portrait && members.value.length <= 4);

function tomorrowCount(memberId: string) {
  return tomorrowEvents.value.filter((e) => belongsInMemberColumn(e.activity, memberId)).length;
}
/** "2 today · 1 tomorrow" — the second half is what makes a lane worth reading tonight. */
function subtitleFor(memberId: string) {
  const today = eventsFor(memberId).length;
  const tomorrow = tomorrowCount(memberId);
  const head = today
    ? fillTemplate(t('wall.lane.today'), { count: today })
    : t('wall.day.nothingOn');
  return tomorrow
    ? `${head} · ${fillTemplate(t('wall.lane.tomorrow'), { count: tomorrow })}`
    : head;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 gap-4" :class="portrait ? 'flex-col' : 'flex-row'">
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <!-- lane headers, on the same column track as the plot -->
      <div
        class="grid shrink-0 gap-0"
        :style="{
          paddingLeft: `${AXIS_WIDTH_PX}px`,
          gridTemplateColumns: `repeat(${members.length}, 1fr)`,
        }"
      >
        <!--
        `min-w-0` is load-bearing: a grid `1fr` track will not shrink below its
        content's min-content width, so without it six inline headers pushed the
        track wider than the plot and Milo and Theo fell off the right edge of a
        portrait tablet — while the grid below them still drew six columns.
        Portrait stacks the plate instead of running it inline; 123px of column
        is not enough for a face and a name side by side.
      -->
        <button
          v-for="member in members"
          :key="member.id"
          type="button"
          class="min-w-0 px-1.5 py-1"
          @click="emit('openDay', todayYmd)"
        >
          <WallBeanHeader
            :member="member"
            :subtitle="subtitleFor(member.id)"
            compact
            :inline="inlineHeaders"
          />
        </button>
      </div>

      <WallTimeGrid
        :columns="gridColumns"
        :all-day-spans="allDaySpans"
        :now="now"
        :dim-past="true"
        :show-now="true"
        :axis-width="AXIS_WIDTH_PX"
        view-id="lanes"
        @open="emit('open', $event)"
      />
    </div>

    <div :class="portrait ? 'shrink-0' : 'w-[296px] shrink-0 overflow-y-auto'">
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
  </div>
</template>
