<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import DayTimeline from '@/components/planner/DayTimeline.vue';
import CelebrationConfetti from '@/components/ui/CelebrationConfetti.vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import BeanieAvatar from '@/components/ui/BeanieAvatar.vue';
import { useMemberAvatarBindings } from '@/composables/useMemberAvatar';
import {
  useDayNavigation,
  useTimeGrid,
  groupOverlapping,
} from '@/composables/useCalendarNavigation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useCalendarSlide } from '@/composables/useCalendarSlide';
import { useTranslation } from '@/composables/useTranslation';
import { useActivityStore } from '@/stores/activityStore';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { isDarkNow } from '@/composables/useDarkMode';
import { useFamilyStore } from '@/stores/familyStore';
import { useMemberFilterStore } from '@/stores/memberFilterStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useTodoStore } from '@/stores/todoStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { belongsInMemberColumn, matchesAssigneeFilter } from '@/utils/assignees';
import { extractDatePart, formatTime12, addHourToTime } from '@/utils/date';
import { tripTypeEmoji, splitTimedUntimed, type TravelSegmentOccurrence } from '@/utils/vacation';
import TravelSegmentChip from '@/components/planner/TravelSegmentChip.vue';
import HolidayBanner from '@/components/planner/HolidayBanner.vue';
import ClashIndicator from '@/components/planner/ClashIndicator.vue';
import { useClashLookup } from '@/composables/useClash';
import type { FamilyActivity, FamilyMember, TodoItem, HolidayOccurrence } from '@/types/models';

/**
 * Controlled period — the page owns the canonical date. The day view derives
 * `currentDay`/`dayLabel` from it and never mutates it (one-way data flow);
 * prev/next come from swipe (emitted up) and the command bar.
 */
const props = defineProps<{
  referenceDate: Date;
  /** Bumped by the page on every "Today" tap — re-centres on now even when the
   *  reference date is unchanged (already on today), which a
   *  `watch(referenceDate)` alone would miss. */
  todayTick?: number;
}>();

const emit = defineEmits<{
  'select-date': [date: string];
  'add-activity': [date: string, time?: string, memberId?: string];
  'view-activity': [id: string, date: string];
  'view-todo': [todo: TodoItem];
  'vacation-click': [vacationId: string];
  'view-segment': [vacationId: string, segmentIndex: number];
  'holiday-click': [holiday: HolidayOccurrence];
  /** Swipe navigation — the page advances the shared reference date. */
  prev: [];
  next: [];
}>();

const { t } = useTranslation();
const { isMobile } = useBreakpoint();
const activityStore = useActivityStore();
const { identityFor } = useActivityIdentity();

/**
 * The lane's own background: the bean's hue, flat, for the full height of the day.
 *
 * Deliberately WEAKER than a card's wash and stronger on dark, mirroring the two-value
 * rule `useActivityIdentity` uses for exactly the same reason — a tint that reads on white
 * disappears on slate. A large field also reads stronger than a small one at equal alpha,
 * which is why this sits well under the 13% a card carries elsewhere.
 *
 * Eight-digit hex rather than `color-mix`: the wall runs on old iPads, and this is the same
 * idiom the gradient it replaces already used.
 */
function laneTint(color: string): string {
  return `${color}${isDarkNow() ? '1F' : '14'}`;
}
const { memberAvatarBindings } = useMemberAvatarBindings();
const familyStore = useFamilyStore();
const memberFilterStore = useMemberFilterStore();
const vacationStore = useVacationStore();
const todoStore = useTodoStore();
const holidayStore = useHolidayStore();

const referenceDate = computed(() => props.referenceDate);
// Read-only derivations only — the mutating nav functions are intentionally
// not destructured (the page owns the date; we never write a prop-derived ref).
const { currentDay } = useDayNavigation(referenceDate);

// External-calendar clash lookup (#34) — called inline per timed block (a composable
// can't run inside a v-for). All store coupling stays in useClash.ts.
const clashFor = useClashLookup();

// ── Members (sorted, filtered) ─────────────────────────────────────────────

// Planner columns — humans only (pets aren't activity assignees).
const visibleMembers = computed<FamilyMember[]>(() =>
  familyStore.sortedHumans.filter(
    (m) => memberFilterStore.isAllSelected || memberFilterStore.isMemberSelected(m.id)
  )
);

// ── Data ────────────────────────────────────────────────────────────────────

type Occurrence = { activity: FamilyActivity; date: string };

const dayActivities = computed<Occurrence[]>(() => {
  const dateStr = currentDay.value.dateStr;
  const d = currentDay.value.date;
  const occs = activityStore.monthActivities(d.getFullYear(), d.getMonth());
  return occs.filter((o) => o.date === dateStr && !o.activity.vacationId);
});

// Mobile timeline honors the page-level member filter (same semantics as
// the desktop column hiding) so the in-view filter isn't duplicated.
const mobileDayActivities = computed<Occurrence[]>(() => {
  if (memberFilterStore.isAllSelected) return dayActivities.value;
  // A family-wide activity has NO assignees, and `.some()` on an empty array is always
  // false — so this used to delete family dinner from the timeline whenever a filter was
  // on. The shared predicate keeps ownerless events visible to everyone.
  return dayActivities.value.filter((o) =>
    matchesAssigneeFilter(o.activity, (id) => memberFilterStore.isMemberSelected(id))
  );
});

// Activities for a specific member. A SHARED activity — several owners, or none at all —
// belongs in everyone's column: a two-owner event already appears in both, and one with
// no owner is owned by everybody. The shared style is what keeps a duplicated card from
// reading as a separate personal obligation in each column.
function memberActivities(memberId: string): Occurrence[] {
  return dayActivities.value.filter((o) => belongsInMemberColumn(o.activity, memberId));
}

function memberTimedActivities(memberId: string): FamilyActivity[] {
  return memberActivities(memberId)
    .filter((o) => o.activity.startTime)
    .sort((a, b) => (a.activity.startTime ?? '').localeCompare(b.activity.startTime ?? ''))
    .map((o) => o.activity);
}

function memberUntimedActivities(memberId: string): Occurrence[] {
  return memberActivities(memberId).filter((o) => !o.activity.startTime);
}

// Todos for today
const dayTodos = computed<TodoItem[]>(() =>
  todoStore.filteredScheduledTodos.filter(
    (todo) => (todo.dueDate?.slice(0, 10) ?? '') === currentDay.value.dateStr
  )
);

// Travel-segment occurrences on the visible day (flights, trains, etc).
const daySegments = computed<TravelSegmentOccurrence[]>(() => {
  const dateStr = currentDay.value.dateStr;
  return vacationStore.travelSegmentOccurrencesInRange(dateStr, dateStr);
});
const segmentBuckets = computed(() => splitTimedUntimed(daySegments.value));

// Time grid — caller-side union of activities + segments-as-1h-blocks.
// Keeps useTimeGrid agnostic to segments; the composable just sees a list
// of {startTime, endTime} entries and auto-extends the hour range.
const allTimedActivities = computed(() => {
  const items: { startTime?: string; endTime?: string }[] = dayActivities.value
    .filter((o) => o.activity.startTime)
    .map((o) => o.activity as { startTime?: string; endTime?: string });
  for (const seg of segmentBuckets.value.timed) {
    if (seg.time) items.push({ startTime: seg.time, endTime: addHourToTime(seg.time) });
  }
  return items;
});

const { hours, totalHeight, getPosition, formatHourLabel, ROW_HEIGHT } =
  useTimeGrid(allTimedActivities);

// Vacation bars active on this day
const activeVacations = computed(() =>
  vacationStore.vacations.filter((v) => {
    if (!v.startDate || !v.endDate) return false;
    const start = extractDatePart(v.startDate);
    const end = extractDatePart(v.endDate);
    const day = currentDay.value.dateStr;
    return day >= start && day <= end;
  })
);

// Public holiday on this day (if any) — drives the desktop banner + the
// `holiday` prop passed to the mobile DayTimeline.
const holidayForCurrentDay = computed(() => holidayStore.holidayForDate(currentDay.value.dateStr));

const hasAnyUntimedContent = computed(
  () =>
    activeVacations.value.length > 0 ||
    dayTodos.value.length > 0 ||
    segmentBuckets.value.untimed.length > 0 ||
    visibleMembers.value.some((m) => memberUntimedActivities(m.id).length > 0)
);

// ── Current time indicator ─────────────────────────────────────────────────

const nowMinutes = ref(0);
let nowTimer: ReturnType<typeof setInterval> | null = null;

function updateNow() {
  const now = new Date();
  nowMinutes.value = now.getHours() * 60 + now.getMinutes();
}

const nowIndicatorTop = computed(() => {
  const start = hours.value[0] ?? 7;
  return `${((nowMinutes.value - start * 60) / 60) * ROW_HEIGHT}rem`;
});

const showNowIndicator = computed(() => {
  if (!currentDay.value.isToday) return false;
  const h = Math.floor(nowMinutes.value / 60);
  const start = hours.value[0] ?? 7;
  const end = hours.value[hours.value.length - 1] ?? 19;
  return h >= start && h <= end;
});

const gridRef = ref<HTMLElement | null>(null);

// ── Swipe gesture ──────────────────────────────────────────────────────────
// Horizontal swipe on the calendar surface advances/retreats by one day,
// with an iOS-Calendar-style slide-out / slide-in animation. Container
// needs `touch-action: pan-y` so vertical scroll still works natively
// while horizontal pans reach our pointer-event handler.
const swipeRef = ref<HTMLElement | null>(null);
useCalendarSlide(swipeRef, {
  onNext: () => emit('next'),
  onPrev: () => emit('prev'),
});

// Auto-scroll the timeline to the current hour. On first mount only when the
// user is near the top (don't disturb a deliberate scroll); `force` (the
// command bar's "Today") always re-centres on now.
async function scrollToNow(opts: { force?: boolean } = {}) {
  await nextTick();
  const mainEl = document.querySelector('main');
  if (!gridRef.value || !currentDay.value.isToday || !mainEl) return;
  if (!opts.force && mainEl.scrollTop >= 100) return;
  const scrollHour = Math.max(0, Math.floor(nowMinutes.value / 60) - 1);
  const start = hours.value[0] ?? 7;
  // ROW_HEIGHT is in rem (so the grid participates in Large text-size mode);
  // convert to px here because scrollTop wants pixels.
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const offsetWithinGrid = Math.max(0, (scrollHour - start) * ROW_HEIGHT * rootPx);
  const gridTop = gridRef.value.getBoundingClientRect().top + window.scrollY;
  mainEl.scrollTo({
    top: gridTop - mainEl.getBoundingClientRect().top + offsetWithinGrid - 80,
    behavior: opts.force ? 'smooth' : 'auto',
  });
}

onMounted(() => {
  updateNow();
  nowTimer = setInterval(updateNow, 60000);
  void scrollToNow();
});

// Re-centre the timeline on now on every command-bar "Today" tap. Keyed off
// `todayTick` (not `referenceDate`) so it ALSO fires when already on today,
// where the reference date doesn't change. `scrollToNow` no-ops when the open
// day isn't today, so a stray tick can't scroll a non-today column.
watch(
  () => props.todayTick,
  () => {
    if (currentDay.value.isToday) void scrollToNow({ force: true });
  }
);

onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});

// ── Helpers ────────────────────────────────────────────────────────────────

function handleSlotClick(memberId: string, hour: number) {
  emit('add-activity', currentDay.value.dateStr, `${String(hour).padStart(2, '0')}:00`, memberId);
}

// Grid template columns (dynamic based on member count)
const gridCols = computed(() => `56px repeat(${visibleMembers.value.length}, 1fr)`);
</script>

<template>
  <div
    ref="swipeRef"
    class="rounded-3xl bg-white p-5 pt-3 shadow-[0_4px_20px_rgba(44,62,80,0.05)] dark:bg-slate-800"
    style="touch-action: pan-y; will-change: transform"
  >
    <!-- Public holiday banner (desktop — mobile gets it via DayTimeline) -->
    <HolidayBanner
      v-if="!isMobile && holidayForCurrentDay"
      :holiday="holidayForCurrentDay"
      show-subline
      class="mb-3"
      @click="emit('holiday-click', holidayForCurrentDay!)"
    />

    <!-- ── Desktop: Member Column Grid ──────────────────────────────────── -->
    <template v-if="!isMobile">
      <!-- Member headers — sticky beneath the command bar so you never lose
           which person each column belongs to. Wrapper bleeds over the card
           padding (bg); the inner grid stays aligned with the timeline. -->
      <div
        class="sticky z-20 -mx-5 bg-white px-5 dark:bg-slate-800"
        style="top: var(--planner-cmdbar-h, 0)"
      >
        <div class="mb-0" :style="{ display: 'grid', gridTemplateColumns: gridCols }">
          <div />
          <div
            v-for="member in visibleMembers"
            :key="'header-' + member.id"
            class="relative flex flex-col items-center gap-1 py-2.5"
          >
            <!--
              The lane header is what NAMES this column — so a solo card inside it can
              show no face at all. That makes its initial load-bearing: a hand-rolled
              `charAt(0)` showed "M" for both Max and Mia here while the filter chips
              two rows above correctly showed "MA" and "MI", so the one place the rule
              mattered most was the one place that ignored it.
            -->
            <BeanieAvatar
              v-bind="memberAvatarBindings(member)"
              fallback="initials"
              size="sm"
              aria-hidden="true"
            />
            <span
              class="font-outfit text-secondary-500/55 text-xs font-semibold lowercase dark:text-gray-400"
            >
              {{ member.name }}
            </span>
            <!-- Colored accent bar -->
            <div
              class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full opacity-50"
              :style="{ backgroundColor: member.color }"
            />
          </div>
        </div>
      </div>

      <!-- All-day / untimed row -->
      <div
        v-if="hasAnyUntimedContent"
        class="relative mb-1 rounded-xl border border-gray-200/60 bg-[var(--tint-slate-5)] py-1.5 dark:border-slate-600/40 dark:bg-slate-700/30"
        :style="{ display: 'grid', gridTemplateColumns: gridCols }"
      >
        <div class="flex items-center justify-center">
          <span
            class="font-outfit text-secondary-500/40 text-xs font-semibold uppercase dark:text-gray-500"
          >
            {{ t('planner.allDay') }}
          </span>
        </div>

        <!-- Vacation bars (span all member columns) -->
        <div
          v-for="v in activeVacations"
          :key="'vac-' + v.id"
          class="cursor-pointer truncate rounded-md px-2 py-0.5 text-xs font-semibold text-white transition-opacity hover:opacity-80"
          :style="{
            gridColumn: `2 / span ${visibleMembers.length}`,
            background: 'linear-gradient(to right, var(--vacation-teal), #0077B6)',
            borderLeft: '3px solid var(--vacation-teal)',
            opacity: 0.85,
          }"
          @click="emit('vacation-click', v.id)"
        >
          {{ tripTypeEmoji(v.tripType) }} {{ v.name }}
        </div>

        <!-- Untimed travel segments (span all member columns — segments are family-scope) -->
        <div
          v-for="seg in segmentBuckets.untimed"
          :key="'seg-untimed-' + seg.segmentId + '-' + seg.kind"
          :style="{ gridColumn: `2 / span ${visibleMembers.length}` }"
        >
          <TravelSegmentChip
            :occurrence="seg"
            @click="(vid: string, idx: number) => emit('view-segment', vid, idx)"
          />
        </div>

        <!-- Per-member untimed activities + todos -->
        <template v-for="(member, mi) in visibleMembers" :key="'untimed-' + member.id">
          <div
            v-if="
              memberUntimedActivities(member.id).length > 0 || (mi === 0 && dayTodos.length > 0)
            "
            class="min-w-0 overflow-hidden border-l border-gray-200/40 px-0.5 dark:border-slate-600/30"
            :style="{ gridColumn: `${mi + 2}` }"
          >
            <div
              v-for="occ in memberUntimedActivities(member.id)"
              :key="occ.activity.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 bg-white px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 dark:bg-slate-800"
              :class="[
                identityFor(occ.activity, { laneMemberId: member.id }).dashed
                  ? 'border-dashed'
                  : '',
                identityFor(occ.activity, { laneMemberId: member.id }).celebration.celebrating
                  ? 'is-celebration'
                  : '',
              ]"
              :style="identityFor(occ.activity, { laneMemberId: member.id }).edgeStyle"
              @click="emit('view-activity', occ.activity.id, currentDay.dateStr)"
            >
              <CelebrationConfetti
                v-if="
                  identityFor(occ.activity, { laneMemberId: member.id }).celebration.celebrating
                "
                :activity-id="occ.activity.id"
                density="month"
              />
              {{ occ.activity.title }}
            </div>
            <!-- Todos (show in first member column) -->
            <div
              v-for="todo in mi === 0 ? dayTodos : []"
              :key="todo.id"
              class="mb-0.5 cursor-pointer truncate rounded-md border-l-2 px-1.5 py-0.5 text-xs font-medium transition-opacity hover:opacity-80"
              style="background: rgb(155 89 182 / 8%); border-left-color: #9b59b6"
              @click="emit('view-todo', todo)"
            >
              {{ todo.title }}
            </div>
          </div>
        </template>
      </div>

      <!-- Time grid -->
      <div ref="gridRef" class="relative">
        <!-- Timed travel-segment overlays (spans all member columns; sits above per-column blocks) -->
        <div
          v-for="seg in segmentBuckets.timed"
          :key="'seg-timed-' + seg.segmentId + '-' + seg.kind"
          class="pointer-events-none absolute z-20"
          :style="{
            ...getPosition(seg.time!, addHourToTime(seg.time!)),
            left: '56px',
            right: '0',
          }"
        >
          <div class="pointer-events-auto px-1">
            <TravelSegmentChip
              :occurrence="seg"
              @click="(vid: string, idx: number) => emit('view-segment', vid, idx)"
            />
          </div>
        </div>

        <div
          :style="{ display: 'grid', gridTemplateColumns: gridCols, height: totalHeight + 'rem' }"
        >
          <!-- Hour labels column -->
          <div class="relative">
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="absolute right-0 pr-2"
              :style="{ top: `${hi * ROW_HEIGHT}rem`, height: ROW_HEIGHT + 'rem' }"
            >
              <span class="text-secondary-500/30 text-xs leading-none dark:text-gray-600">
                {{ formatHourLabel(hour) }}
              </span>
            </div>
          </div>

          <!-- Member columns -->
          <div
            v-for="member in visibleMembers"
            :key="'col-' + member.id"
            class="relative border-l border-gray-200/40 dark:border-slate-600/30"
          >
            <!--
              The lane IS the bean, for the whole height of the day.
              It was a 40px gradient fading to transparent, so the column announced its
              owner and then stopped — by mid-morning every lane was white and they blended
              into each other. That matters more here than anywhere else: this is the one
              surface that deliberately hides the owner's face on a solo card (see the lane
              rule on `laneMemberId`), so the lane is carrying the identity alone and has to
              keep carrying it. Flat, not a gradient: a gradient reads as decoration, a
              field reads as structure.
            -->
            <div
              class="pointer-events-none absolute inset-0 z-0"
              :style="{ background: laneTint(member.color) }"
            />

            <!-- Hour row borders (clickable to add activity) -->
            <div
              v-for="(hour, hi) in hours"
              :key="hour"
              class="group/slot absolute inset-x-0 cursor-pointer border-t border-gray-100 transition-all hover:bg-[rgba(241,93,34,0.08)] dark:border-slate-700/50 dark:hover:bg-[rgba(241,93,34,0.12)]"
              :style="{ top: `${hi * ROW_HEIGHT}rem`, height: ROW_HEIGHT + 'rem' }"
              @click="handleSlotClick(member.id, hour)"
            >
              <span
                class="from-primary-500/80 to-terracotta-400/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0 rounded-xl bg-gradient-to-r bg-clip-text text-transparent opacity-0 transition-all group-hover/slot:scale-110 group-hover/slot:opacity-50"
              >
                <span class="text-xl leading-none font-black">+</span>
                <span class="font-outfit text-[0.5625rem] leading-tight font-bold">
                  {{ formatHourLabel(hour) }} &ndash; {{ formatHourLabel(hour + 1) }}
                </span>
              </span>
            </div>

            <!-- Activity blocks -->
            <template
              v-for="(group, gi) in groupOverlapping(memberTimedActivities(member.id))"
              :key="gi"
            >
              <div
                v-for="(activity, ai) in group"
                :key="activity.id"
                class="absolute z-10 flex cursor-pointer flex-col gap-0.5 overflow-hidden rounded-lg border-l-[3px] bg-white px-1.5 py-1 text-xs shadow-sm transition-shadow hover:shadow-md dark:bg-slate-800"
                :class="[
                  identityFor(activity, { laneMemberId: member.id }).dashed ? 'border-dashed' : '',
                  identityFor(activity, { laneMemberId: member.id }).celebration.celebrating
                    ? 'is-celebration'
                    : '',
                ]"
                :style="{
                  ...getPosition(activity.startTime!, activity.endTime),
                  left: `${(ai / group.length) * 100}%`,
                  width: `calc(${100 / group.length}% - 2px)`,
                  ...identityFor(activity, { laneMemberId: member.id }).edgeStyle,
                }"
                @click.stop="emit('view-activity', activity.id, currentDay.dateStr)"
              >
                <!--
                  DESKTOP bean lanes. `DayTimeline` covers the MOBILE path only, so a
                  celebration reached this view on a phone and nowhere else.
                -->
                <CelebrationConfetti
                  v-if="identityFor(activity, { laneMemberId: member.id }).celebration.celebrating"
                  :activity-id="activity.id"
                  density="week"
                />
                <div
                  class="font-outfit flex items-center truncate text-xs font-semibold"
                  style="color: var(--color-text)"
                >
                  <span aria-hidden="true">{{ identityFor(activity).emoji }}</span>
                  <span class="truncate">{{ activity.title }}</span>
                  <ClashIndicator :clash="clashFor(activity.id, currentDay.dateStr)" class="ml-1" />
                </div>
                <div class="flex min-w-0 items-center gap-1">
                  <span class="text-primary-500 truncate text-[0.6875rem] leading-tight opacity-70">
                    {{ formatTime12(activity.startTime!)
                    }}{{ activity.endTime ? `-${formatTime12(activity.endTime)}` : '' }}
                  </span>
                  <span
                    v-if="activity.location"
                    class="text-secondary-500/60 min-w-0 flex-1 truncate text-[0.6875rem] leading-tight dark:text-gray-400"
                  >
                    · 📍 {{ activity.location }}
                  </span>
                  <!--
                    Lane-aware: this IS a member column, so the header already names its
                    bean. A face here therefore always means "someone else is in this
                    too", which is what lets a shared event read as shared with no
                    decoration at all.
                  -->
                  <ActivityOwnerStack
                    :members="identityFor(activity, { laneMemberId: member.id }).stackMembers"
                    size="xs"
                    class="ml-auto"
                  />
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Current time indicator -->
        <div
          v-if="showNowIndicator"
          class="bg-primary-500 pointer-events-none absolute right-0 z-20 h-[2px]"
          :style="{ top: nowIndicatorTop, left: '56px' }"
        >
          <div
            class="bg-primary-500 absolute -top-[4px] -left-[4px] h-[10px] w-[10px] rounded-full"
          />
        </div>
      </div>
    </template>

    <!-- ── Mobile: Unified Timeline (page-level filter drives scope) ─────── -->
    <template v-else>
      <DayTimeline
        :date-str="currentDay.dateStr"
        :activities="mobileDayActivities"
        :vacations="activeVacations"
        :segments="daySegments"
        :todos="dayTodos"
        :members="visibleMembers"
        :is-today="currentDay.isToday"
        :holiday="holidayForCurrentDay"
        @view-activity="(id, date) => emit('view-activity', id, date)"
        @view-todo="(todo) => emit('view-todo', todo)"
        @vacation-click="(vid) => emit('vacation-click', vid)"
        @view-segment="(vid: string, idx: number) => emit('view-segment', vid, idx)"
        @add-activity="(date, time) => emit('add-activity', date, time)"
        @holiday-click="(h) => emit('holiday-click', h)"
      />
    </template>
  </div>
</template>
