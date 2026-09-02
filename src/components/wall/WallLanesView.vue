<script setup lang="ts">
import type { FamilyActivity } from '@/types/models';
/**
 * View B — one lane per bean, carrying that person's events AND their jobs.
 *
 * A child finds their own column and reads their whole day in one place: what
 * they have on, and what they owe. Lanes wrap (auto-fit) rather than shrinking
 * past legibility, so a family of five reads 3+2 and a larger family wraps
 * again instead of producing seven unreadable slivers.
 *
 * Humans only. Pets belong on the family roster, but a lane headed "Bella · 0
 * today" with an empty jobs list is dead space on the one screen that cannot
 * afford it.
 */
import { computed } from 'vue';
import WallBeanColumn from '@/components/wall/WallBeanColumn.vue';
import WallEventChip from '@/components/wall/WallEventChip.vue';
import WallJobList from '@/components/wall/WallJobList.vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { belongsInMemberColumn } from '@/utils/assignees';
import { sortByTime } from '@/utils/wallActivities';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { jobsProgress } from '@/utils/wallJobs';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

/** Two to-dos plus a "+N more" reads better than three crammed rows. */
const LANE_JOBS = 2;
/**
 * A lane carries a header, events AND jobs in one column height, so only about
 * two event chips fit. The overflow is NOT silent: the header reads "3 today"
 * and is itself the drill-in to the full day, which is a better use of the few
 * remaining pixels than a "+1 more" button that would not fit either.
 */
const LANE_EVENTS = 2;

// The page renders all four views through one `<component :is>` with a single
// prop bag, so every view receives props it does not declare. Without this they
// would land on the root element as stray DOM attributes.
defineOptions({ inheritAttrs: false });

const props = defineProps<{
  todayYmd: string;
  tomorrowYmd: string;
  portrait: boolean;
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
/**
 * Each lane IS a bean, so `laneMemberId` is passed: the lane header already names
 * them, which is what lets a solo chip carry no face at all.
 */
function identityOf(activity: FamilyActivity, memberId: string) {
  return identityFor(activity, { laneMemberId: memberId });
}
/**
 * Computed once per render, not per call. The template asks `todosFor` four
 * times per member (the heading count, the rows, the overflow test, the
 * overflow count), each re-filtering every to-do and re-sorting. `WallChoreBoard`
 * memoises the same shape; this is the surface where it regressed.
 */
const todosByMember = computed(() => {
  const map = new Map<string, WallJob[]>();
  // MUST call the prop, not `todosOf` — reading the memo from inside its own getter makes
  // the computed self-referential, which Vue bails out of. That threw during render and
  // blanked the entire lanes view (every bean disappeared), rather than merely losing the
  // memoisation it was added for.
  for (const member of members.value) map.set(member.id, props.todosFor(member.id));
  return map;
});
function todosOf(memberId: string): WallJob[] {
  // Recompute on a miss rather than returning empty, matching WallChoreBoard: a silently
  // empty lane is indistinguishable from "nothing to do", which is the failure this view
  // just had.
  return todosByMember.value.get(memberId) ?? props.todosFor(memberId);
}

const todayEvents = computed(() => activityStore.activitiesForDate(props.todayYmd));
const tomorrowEvents = computed(() => activityStore.activitiesForDate(props.tomorrowYmd));

/**
 * A lane is a person's column, and a SHARED event belongs in everyone's: an event with
 * two owners already appears in both their lanes, and one with no owner is owned by
 * everybody, so it appears in all of them. The shared style is what stops a duplicated
 * chip reading as five separate personal obligations.
 *
 * Still deliberately NOT `matchesWallFilter`, which answers the different question of
 * what the whole wall is showing.
 */
function eventsFor(memberId: string) {
  return sortByTime(todayEvents.value.filter((e) => belongsInMemberColumn(e.activity, memberId)));
}
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
/**
 * A lane shows this bean's TO-DOS, not their chores. Chores get the whole chore
 * board — folding them in here too was what made the lane's heading ambiguous
 * ("jobs" being neither word the app uses).
 */
function jobsHeading(memberId: string) {
  const { done, total } = jobsProgress(todosOf(memberId));
  return `${t('wall.jobs.heading')} · ${done}/${total}`;
}

const { identityFor } = useActivityIdentity();
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2.5">
    <div
      class="grid min-h-0 flex-1 gap-2.5"
      style="grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))"
    >
      <WallBeanColumn
        v-for="member in members"
        :key="member.id"
        :member="member"
        :subtitle="subtitleFor(member.id)"
        compact
        header-action
        @header-click="emit('openDay', todayYmd)"
      >
        <WallEventChip
          v-for="entry in eventsFor(member.id).slice(0, LANE_EVENTS)"
          :key="entry.activity.id + entry.date"
          :activity="entry.activity"
          :identity="identityOf(entry.activity, member.id)"
          :time="entry.activity.startTime || t('planner.allDay')"
          @open="emit('open', { kind: 'activity', activityId: entry.activity.id, ymd: entry.date })"
        />
        <p
          v-if="!eventsFor(member.id).length"
          class="font-caveat m-auto text-[var(--muted-text,#4d5d6c)] opacity-70"
        >
          {{ t('wall.day.nothingOn') }}
        </p>

        <template #footer>
          <div
            v-if="todosOf(member.id).length"
            class="mt-auto border-t border-dashed border-[rgba(44,62,80,0.12)] px-3 pt-2 pb-2 dark:border-slate-700"
          >
            <p
              class="font-outfit wall-lane-jobs-heading mb-1 font-bold tracking-[0.1em] text-[var(--muted-text,#4d5d6c)] uppercase"
            >
              {{ jobsHeading(member.id) }}
            </p>
            <WallJobList
              :jobs="todosOf(member.id).slice(0, LANE_JOBS)"
              :is-pending="isPending"
              @toggle="emit('toggle', $event)"
            />
            <button
              v-if="todosOf(member.id).length > LANE_JOBS"
              type="button"
              class="font-outfit text-primary-500 wall-more font-bold"
              @click="emit('open', { kind: 'todos' })"
            >
              {{
                fillTemplate(t('wall.card.more'), {
                  count: todosOf(member.id).length - LANE_JOBS,
                })
              }}
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </template>
      </WallBeanColumn>
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
