<script setup lang="ts">
/**
 * View C — today at full size.
 *
 * Built for the glance you actually take walking past, which is why this is
 * the most legible of the layouts: one day, large type, and the rest of the
 * week reduced to a strip you can tap.
 *
 * The "happening now" marker is the point of this view over view A — it
 * answers "are we late?" without anybody doing arithmetic.
 */
import { computed, ref, watch } from 'vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import WallPeripheralCards from '@/components/wall/WallPeripheralCards.vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';

import { wallEvents } from '@/utils/wallActivities';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import type { FamilyActivity, FamilyMember } from '@/types/models';
import type { WallJob, WallListGroup, WallSheetTarget } from '@/types/wall';

/** How long an untimed-end activity is assumed to run, for the "now" marker. */
const ASSUMED_DURATION_MIN = 90;

// The page renders all four views through one `<component :is>` with a single
// prop bag, so every view receives props it does not declare. Without this they
// would land on the root element as stray DOM attributes.
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
// `openDay` is deliberately NOT declared here. The three wall views share one parent
// binding (`<component :is>`), and in THIS view tapping a day moves the view to that day
// rather than opening a sheet over it — so the emit stays with the two views that still
// mean "open a sheet", and the shared listener simply never fires for this one.
const emit = defineEmits<{
  open: [WallSheetTarget];
  openChores: [];
}>();

const activityStore = useActivityStore();
const { t } = useTranslation();

/**
 * One rule, so the SAME event cannot be violet on the week view and orange here. This
 * used `wallActivityColour`, which returns Heritage Orange for anything with 2+ owners,
 * while every migrated surface returns the first owner's hue.
 */
function colourFor(activity: FamilyActivity) {
  return identityFor(activity).color;
}

/**
 * The day the big panel is showing. Tapping the week strip moves this rather than opening
 * a drawer: the drawer covered the very panel that already renders a day in full, so it
 * was a second, smaller copy of this view sitting on top of it.
 *
 * Follows `todayYmd` when that changes, so the midnight rollover pulls the wall back to
 * the real today instead of stranding it on yesterday.
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

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
const nowMinutes = computed(() => props.now.getHours() * 60 + props.now.getMinutes());

/**
 * The activity currently running. Only one is marked, and a later start wins,
 * so overlapping events resolve to the one you most recently should have been
 * at rather than lighting up two rows.
 */
const nowId = computed(() => {
  let best: { id: string; start: number } | null = null;
  for (const { activity } of events.value) {
    if (!activity.startTime) continue;
    const start = minutesOf(activity.startTime);
    const end = activity.endTime ? minutesOf(activity.endTime) : start + ASSUMED_DURATION_MIN;
    if (nowMinutes.value < start || nowMinutes.value >= end) continue;
    if (!best || start > best.start) best = { id: activity.id, start };
  }
  return best?.id ?? null;
});

function subtitleFor(activity: FamilyActivity): string {
  return activity.location || activity.description || '';
}
/**
 * Whose event this is. Delegates to `classifyActivityChip`, the documented single
 * source of truth — this used to map RAW `normalizeAssignees` through `.find()`
 * with no dedupe, so an id written twice by two merging devices drew the same
 * bean twice. The classifier resolves and dedupes in one pass.
 */
/** Whose event this is. `ActivityOwnerStack` caps the row at three plus a count. */
function membersFor(activity: FamilyActivity): FamilyMember[] {
  return identityFor(activity).stackMembers;
}
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

function dayLabel(ymd: string) {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}
function dayNumber(ymd: string) {
  return new Date(`${ymd}T00:00:00`).getDate();
}

const { identityFor } = useActivityIdentity();
</script>

<template>
  <div class="flex min-h-0 flex-1 gap-4" :class="portrait ? 'flex-col' : 'flex-row'">
    <div class="flex min-h-0 flex-1 flex-col gap-2.5">
      <div
        class="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[26px] bg-white px-5 py-1 shadow-[var(--card-shadow)] dark:bg-slate-800"
      >
        <div
          class="sticky top-0 z-[1] flex shrink-0 items-center justify-between gap-3 border-b border-[rgba(44,62,80,0.06)] bg-white py-2 dark:border-slate-700 dark:bg-slate-800"
        >
          <p class="font-outfit text-secondary-500 wall-slot-title font-bold dark:text-gray-100">
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
        <button
          v-for="entry in events"
          :key="entry.activity.id + entry.date"
          type="button"
          class="flex w-full items-center gap-4 border-b border-[rgba(44,62,80,0.06)] py-3 text-left last:border-b-0 dark:border-slate-700"
          :class="[
            isToday && entry.activity.id === nowId
              ? 'rounded-2xl border-b-0 bg-gradient-to-r from-[var(--tint-orange-8)] to-transparent px-3'
              : '',
            // Today's list is rows rather than cards, so it had no celebration treatment at
            // all — the one wall view that stayed plain while the others celebrated.
            identityFor(entry.activity).celebration.celebrating
              ? 'is-celebration rounded-2xl border-b-0 px-3'
              : '',
          ]"
          @click="
            emit('open', { kind: 'activity', activityId: entry.activity.id, ymd: entry.date })
          "
        >
          <CelebrationConfetti
            v-if="identityFor(entry.activity).celebration.celebrating"
            :activity-id="entry.activity.id"
            density="week"
          />
          <span class="w-24 shrink-0">
            <span class="font-outfit wall-slot-time block font-extrabold">
              {{ entry.activity.startTime || t('planner.allDay') }}
            </span>
          </span>
          <span class="min-w-0 flex-1">
            <span
              v-if="isToday && entry.activity.id === nowId"
              class="font-outfit wall-nowtag text-primary-500 block font-extrabold tracking-[0.11em] uppercase"
            >
              {{ t('wall.today.now') }}
            </span>
            <span
              class="font-outfit text-secondary-500 wall-slot-title block font-bold dark:text-gray-100"
            >
              {{ entry.activity.title }}
            </span>
            <span
              v-if="subtitleFor(entry.activity)"
              class="font-inter wall-slot-sub block truncate text-[var(--muted-text,#4d5d6c)]"
            >
              {{ subtitleFor(entry.activity) }}
            </span>
          </span>
          <span class="flex shrink-0">
            <ActivityOwnerStack :members="membersFor(entry.activity)" size="sm" />
          </span>
        </button>
        <p v-if="!events.length" class="font-caveat m-auto text-[var(--muted-text,#4d5d6c)]">
          {{ t('wall.day.nothingOn') }}
        </p>
      </div>

      <div class="grid shrink-0 gap-2" style="grid-template-columns: repeat(7, 1fr)">
        <button
          v-for="ymd in weekDays"
          :key="ymd"
          type="button"
          class="rounded-2xl px-2 py-2 text-center shadow-[var(--card-shadow)]"
          :class="
            ymd === focusYmd
              ? 'from-primary-500 to-terracotta-400 bg-gradient-to-br text-white'
              : 'bg-white dark:bg-slate-800'
          "
          :aria-pressed="ymd === focusYmd"
          @click="focusYmd = ymd"
        >
          <span
            class="font-outfit wall-strip-day block font-bold tracking-[0.1em] uppercase opacity-70"
          >
            {{ dayLabel(ymd) }}
          </span>
          <span class="font-outfit wall-strip-num block leading-tight font-extrabold">
            {{ dayNumber(ymd) }}
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
        :variant="portrait ? 'band' : 'rail'"
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
