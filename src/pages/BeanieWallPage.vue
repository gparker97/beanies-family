<script setup lang="ts">
/**
 * The beanie wall — a chrome-free display for a tablet on the kitchen wall.
 *
 * This page is a THIN ORCHESTRATOR: it instantiates each wall composable
 * exactly once, provides the lock, and renders whichever screen the registry
 * selects. It holds no business rules — the jobs rule lives in `wallJobs.ts`,
 * orientation in `useWallOrientation`, the lock in `useWallLock`.
 *
 * Everything it starts, it releases through `onScopeDispose`, so turning the
 * wall off leaves nothing behind.
 */
import { computed, onScopeDispose, provide, ref, watch } from 'vue';
import { isNavigationFailure, useRouter } from 'vue-router';
import WallFooter from '@/components/wall/WallFooter.vue';
import WallLockMenu from '@/components/wall/WallLockMenu.vue';
import WallNightScreen from '@/components/wall/WallNightScreen.vue';
import WallSheet from '@/components/wall/WallSheet.vue';
import WallTickBurst from '@/components/wall/WallTickBurst.vue';
import WallStatusStamp from '@/components/wall/WallStatusStamp.vue';
import WallViewSwitcher from '@/components/wall/WallViewSwitcher.vue';
import { DEFAULT_WALL_VIEW, wallViewById } from '@/components/wall/wallViews';
import { WALL_LOCK } from '@/components/wall/wallLockKey';
import { WALL_BURST } from '@/components/wall/wallBurstKey';
import { useMediaQuery } from '@/composables/useMediaQuery';
import { useToday } from '@/composables/useToday';
import { useWakeLock } from '@/composables/useWakeLock';
import { useWallAnchor } from '@/composables/useWallAnchor';
import { useWallJobs } from '@/composables/useWallJobs';
import { useWallLock } from '@/composables/useWallLock';
import { useWallBurst } from '@/composables/useWallBurst';
import { useWallOrientation } from '@/composables/useWallOrientation';
import { resetCelebrationMode, setCelebrationMode } from '@/composables/useCelebration';
import { logEvent } from '@/services/telemetry/logEvent';
import { useActivityStore } from '@/stores/activityStore';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { getWallReturnPath } from '@/router';
import { useToast } from '@/composables/useToast';
import { addDaysYmd, formatDayLong, parseLocalDate } from '@/utils/date';
import { formatWeekRange } from '@/composables/useCalendarNavigation';
import { anchorOffsetDays } from '@/utils/wallAnchor';
import type { WallJob, WallSheetTarget, WallViewId } from '@/types/wall';

const SURFACE = 'beanie-wall';
/** Long enough that a celebration is seen, short enough that it never camps. */
const WALL_CELEBRATION_MS = 6000;

const router = useRouter();
const { today } = useToday();
const { t } = useTranslation();
const { showToast } = useToast();
const activityStore = useActivityStore();

const activeView = ref<WallViewId>(DEFAULT_WALL_VIEW);
/** Where "back" from the jobs board returns to — never the jobs board itself. */
const lastCalendarView = ref<WallViewId>(DEFAULT_WALL_VIEW);
const nightNow = ref(false);
/** Which bean the wall is focused on, or null for everyone. Wall-local. */
const focusedMemberId = ref<string | null>(null);
/** The open drill-in sheet, or null. One at a time — this is a wall, not a desktop. */
const sheet = ref<WallSheetTarget | null>(null);

const jobs = useWallJobs();
const lock = useWallLock();
const orientation = useWallOrientation(SURFACE);
const { bursts, burst } = useWallBurst();
useWakeLock(SURFACE);

/**
 * The wall is a read-from-across-the-room display: bean lanes side by side, a
 * full week of columns, a time axis. It works in BOTH orientations — see
 * `wall-portrait` below — so this is deliberately not an orientation test. What
 * it needs is room on BOTH axes, which is a different question to "is this
 * portrait".
 *
 * A width-only threshold gets it wrong twice, in opposite directions: an iPad
 * mini in portrait is 744px wide and would be refused a wall it renders
 * perfectly well, while a phone held sideways is 844px wide and would be handed
 * one it has only 390px of height to draw.
 *
 * So: a minimum on the smaller side, whichever side that currently is. 600px
 * is Android's own `sw600dp` tablet threshold and the same number
 * `isRotatableFormFactor()` uses, so "big enough to rotate" and "big enough for
 * a wall" stay one idea.
 *
 * Reactive via matchMedia, so rotating a device or resizing a browser window
 * moves between the wall and the gate rather than stranding anyone on either.
 */
const hasRoom = useMediaQuery('(min-width: 600px) and (min-height: 600px)', true);
const tooNarrow = computed(() => !hasRoom.value);

// The wall may rotate; every other screen keeps the declarative default. Not
// worth doing for a screen that is only telling someone to come back wider.
if (!tooNarrow.value) orientation.release();

provide(WALL_LOCK, { isLocked: lock.isLocked, noteActivity: lock.noteActivity });
provide(WALL_BURST, burst);

/**
 * The wall's ONE date concept, owned here so it survives a view switch.
 *
 * Anchored on today it is still a week starting today — the wall is about what is
 * coming, not what has gone — and stepping enters whole calendar weeks from there.
 * `today` stays separate and keeps meaning the real today: it drives the is-today
 * highlight, the now-line and the header, none of which may lie while browsing.
 */
const anchor = useWallAnchor();
const { anchorYmd, weekDays, isAnchoredToToday } = anchor;
const tomorrowYmd = computed(() => addDaysYmd(today.value, 1));

/**
 * `null` means everyone — kept distinct from "an empty list" so a view can tell
 * "no filter" apart from "a filter that matches nobody" without a second flag.
 */
const visibleMemberIds = computed(() =>
  focusedMemberId.value === null ? null : [focusedMemberId.value]
);

const todayCount = computed(() => activityStore.activitiesForDate(today.value).length);
const tomorrowCount = computed(() => activityStore.activitiesForDate(tomorrowYmd.value).length);

/** "Week of 31 August · 6 things on today" — the line the mockup puts under the date. */
const subtitle = computed(() => {
  const week = new Date(`${today.value}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  const things = fillTemplate(
    todayCount.value === 1 ? t('wall.header.things.one') : t('wall.header.things.other'),
    { count: todayCount.value }
  );
  return `${fillTemplate(t('wall.header.weekOf'), { date: week })} · ${things}`;
});
/**
 * Reactive, because this is the ONE route that unlocks rotation — a snapshot
 * taken at setup meant rotating a mounted tablet kept the landscape layout
 * (seven columns crushed into portrait) until someone reloaded it.
 */
const isPortrait = useMediaQuery('(orientation: portrait)');

/**
 * The night clock must actually tick: it is the largest type on screen and the
 * only content the wall shows at night, and a static expression froze it at
 * the minute night mode was entered.
 */
const clockNow = ref(new Date());
const clockTimer = setInterval(() => (clockNow.value = new Date()), 20_000);
const currentView = computed(() => wallViewById(activeView.value));
/** Names the jobs board's back button after the view it returns to. */
const backLabel = computed(() => t(wallViewById(lastCalendarView.value).labelKey).toLowerCase());

/**
 * The navigator's label — what period the wall is currently looking at.
 *
 * `formatWeekRange` is the planner's own week label, shared here rather than
 * re-derived so the wall and the planner cannot describe the same seven days
 * differently. ⚠️ It takes `Date`, not ymd.
 */
const anchorLabel = computed(() => {
  if (currentView.value.stepUnit === 'week') {
    const days = weekDays.value;
    return formatWeekRange(parseLocalDate(days[0]!), parseLocalDate(days[days.length - 1]!));
  }
  return isAnchoredToToday.value ? t('wall.today.today') : formatDayLong(anchorYmd.value);
});

/**
 * `count` is the SIGNED distance from the real today, so the firehose can answer
 * "do families browse forward, or back?" and can show a wall stranded off-today.
 *
 * ⚠️ Emitted UNGATED, deliberately. A `createChangeGate` keyed on the offset would
 * change signature on every single step and so could never suppress anything — a
 * safeguard that reads as one but does nothing is worse than none, because the
 * next reader trusts it. This is a hand-driven event on a wall-mounted tablet;
 * `logEvent`'s 50-per-surface-per-minute floor is the correct backstop.
 */
function logAnchorChange(stage: string) {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'wall_anchor_change',
    context: {
      action: 'anchor',
      kind: activeView.value,
      stage,
      count: anchorOffsetDays(anchorYmd.value, today.value),
    },
  });
}

function onStep(direction: -1 | 1) {
  const unit = currentView.value.stepUnit;
  if (!unit) return;
  anchor.step(unit, direction);
  logAnchorChange(direction === 1 ? 'next' : 'prev');
}

function onGoToToday() {
  anchor.goToToday();
  logAnchorChange('today');
}

/**
 * A day tap places the anchor on that day EXACTLY — not snapped to its calendar
 * week. A week that starts Saturday, with Thursday tapped, redraws starting
 * Thursday. Week *stepping* snaps; a tap is a direct placement.
 */
function onFocusDay(ymd: string) {
  anchor.setAnchor(ymd, 'day_tap');
  logAnchorChange('day_tap');
}

function selectView(id: WallViewId) {
  if (activeView.value !== 'jobs') lastCalendarView.value = activeView.value;
  activeView.value = id;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'wall_view_change',
    context: { action: 'view_change', kind: id },
  });
}

/**
 * Leaving is slow because the destination is a lazily-loaded route chunk, and
 * it used to happen with NO feedback at all: several seconds of a wall that
 * looked ignored, then a jump. Two fixes, because both halves were wrong.
 *
 *  1. Say something immediately. `isExiting` puts a "leaving the wall" screen up
 *     on the same tick as the tap, so the delay reads as progress.
 *  2. Make the delay smaller. The wall sits idle for hours, so the destination
 *     chunk is warmed in the background long before anyone asks for it, and the
 *     destination is now wherever they came FROM rather than the app's heaviest
 *     page.
 */
const isExiting = ref(false);

async function leaveWall() {
  if (isExiting.value) return;
  isExiting.value = true;
  orientation.restore();
  try {
    const failure = await router.push(getWallReturnPath());
    // `push` RESOLVES with a NavigationFailure — it does not throw one. The catch below
    // only ever sees an error thrown inside a guard, so an ABORTED navigation left
    // `isExiting` true forever: the router's own `beforeEach` returns false while a
    // critical write is in flight, and the "leaving the wall" screen is `absolute inset-0
    // z-[70]` with no dismiss control, over an `overflow-hidden h-[100dvh]` root. Tapping
    // Leave mid-save covered the wall permanently (#80 review).
    if (isNavigationFailure(failure)) {
      isExiting.value = false;
      showToast('info', t('wall.leave.busy'));
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'wall_leave_blocked',
        context: { action: 'leave', kind: 'navigation_failed' },
      });
    }
  } catch {
    // A guard threw. The wall is going away either way, so there is nothing to
    // recover — just don't strand the "leaving" screen if we somehow stay.
    isExiting.value = false;
  }
}

/**
 * Warm the return route's chunk while the wall idles. Costs nothing on a screen
 * that is doing nothing for hours, and turns the exit from a cold chunk fetch
 * into a cached one.
 */
function prefetchExit() {
  const path = getWallReturnPath();
  const matched = router.resolve(path).matched;
  for (const record of matched) {
    const component = record.components?.default;
    if (typeof component === 'function')
      void (component as () => Promise<unknown>)().catch(() => {});
  }
}

/**
 * A celebration must never camp on an unattended screen, and a locked wall
 * must not offer Undo — that is an edit, and a child is standing at it.
 * `CelebrationOverlay` lives in App.vue, outside this tree, so we ask the
 * owner rather than reaching into it.
 */
watch(
  lock.isLocked,
  (locked) =>
    setCelebrationMode({
      autoDismissMs: WALL_CELEBRATION_MS,
      allowUndo: !locked,
      // The wall celebrates a tick itself (WallTickBurst), so the app-level
      // routine celebrations are redundant here — and `goal-reached` is a
      // blocking modal that would black out the whole wall on every chore.
      suppressRoutine: true,
    }),
  { immediate: true }
);

logEvent({
  level: 'info',
  surface: SURFACE,
  message: 'wall_enter',
  context: { action: 'enter', kind: activeView.value },
});

// Idle-time, never blocking the wall's own first paint.
if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000));
  idle(() => prefetchExit());
}

onScopeDispose(() => {
  // The two matchMedia listeners that used to be released here now belong to
  // `useMediaQuery`, which disposes them with this same scope.
  clearInterval(clockTimer);
  resetCelebrationMode();
  logEvent({ level: 'info', surface: SURFACE, message: 'wall_exit', context: { action: 'exit' } });
});

function onToggle(job: WallJob) {
  lock.noteActivity();
  void jobs.toggle(job);
}

function openSheet(target: WallSheetTarget) {
  lock.noteActivity();
  sheet.value = target;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'wall_sheet_open',
    context: { action: 'sheet_open', kind: target.kind },
  });
}

/** A view switch must not leave a sheet from the previous view floating. */
watch(activeView, () => (sheet.value = null));
</script>

<template>
  <!--
    Too narrow for a wall. Not an error — the wall is simply somewhere else, so
    this says where and offers the way back rather than apologising.
  -->
  <div
    v-if="tooNarrow"
    class="dark:bg-surface-ground flex h-[100dvh] flex-col items-center justify-center gap-5 bg-[var(--cloud-white,#F8F9FA)] px-8 text-center"
  >
    <span class="text-5xl" aria-hidden="true">🧱</span>
    <h1 class="font-outfit text-secondary-500 dark:text-ink text-xl font-bold">
      {{ t('wall.tooNarrow.title') }}
    </h1>
    <p
      class="font-inter text-secondary-400 dark:text-ink-soft max-w-[46ch] text-sm leading-relaxed"
    >
      {{ t('wall.tooNarrow.body') }}
    </p>
    <button
      type="button"
      class="font-outfit bg-primary-500 hover:bg-primary-600 mt-1 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-colors"
      @click="leaveWall"
    >
      {{ t('wall.tooNarrow.back') }}
    </button>
  </div>

  <div
    v-else
    class="wall-root dark:bg-surface-ground relative flex h-[100dvh] flex-col overflow-hidden bg-[var(--cloud-white,#F8F9FA)]"
    :class="{ 'wall-portrait': isPortrait }"
    @pointerdown="lock.noteActivity"
  >
    <!--
      `relative z-40` so the header outranks the drill-in sheet. The lock menu
      hangs down out of the header into the main region; without this the sheet
      (z-30, and later in the DOM) painted over it and the wall's only exit,
      night-mode and unlock controls were unreachable while a sheet was open.
    -->
    <header class="relative z-40 flex shrink-0 items-center gap-4 px-7 pt-5 pb-3">
      <div class="min-w-0">
        <h1 class="font-outfit text-secondary-500 wall-date dark:text-ink font-extrabold">
          {{
            new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })
          }}
        </h1>
        <p class="font-inter wall-subtitle mt-1.5 text-[var(--muted-text,#4d5d6c)]">
          {{ subtitle }}
        </p>
      </div>
      <div class="ml-auto flex items-center gap-3">
        <!--
          The period navigator. Hidden on the jobs board, which has no date at
          all (`stepUnit: null` in the registry).

          Rendered inline rather than as a shared `PeriodNavigator` component:
          two other clusters exist (`MonthNavigator`, `CalendarCommandBar`), but
          the command bar cannot adopt one — its label sits outside the cluster
          behind a load-bearing Transition — so an extraction would consolidate
          two of three while putting a regression surface on the transactions
          page. Consolidating all three is a follow-up with one owner.
        -->
        <div v-if="currentView.stepUnit" class="flex items-center gap-1.5">
          <button
            type="button"
            class="font-outfit text-secondary-500 wall-nav-arrow dark:bg-surface-raised dark:text-ink rounded-xl bg-white px-2.5 py-1.5 font-bold shadow-[var(--card-shadow)]"
            :aria-label="t('planner.prevPeriod')"
            @click="onStep(-1)"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <p class="font-inter wall-nav-label min-w-0 text-center text-[var(--muted-text,#4d5d6c)]">
            {{ anchorLabel }}
          </p>
          <button
            type="button"
            class="font-outfit text-secondary-500 wall-nav-arrow dark:bg-surface-raised dark:text-ink rounded-xl bg-white px-2.5 py-1.5 font-bold shadow-[var(--card-shadow)]"
            :aria-label="t('planner.nextPeriod')"
            @click="onStep(1)"
          >
            <span aria-hidden="true">›</span>
          </button>
          <!-- Only offered when it would do something. -->
          <button
            v-if="!isAnchoredToToday"
            type="button"
            class="font-outfit text-primary-500 dark:text-primary-lift wall-nav-today rounded-xl bg-[var(--tint-orange-8)] px-2.5 py-1.5 font-bold"
            @click="onGoToToday"
          >
            {{ t('date.today') }}
          </button>
        </div>
        <WallViewSwitcher :active="activeView" @select="selectView" />
        <div class="text-right">
          <p class="font-outfit wall-clock leading-none font-extrabold">
            {{ clockNow.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }}
          </p>
          <WallStatusStamp />
        </div>
        <WallLockMenu
          :is-locked="lock.isLocked.value"
          :can-unlock="lock.canUnlock.value"
          :can-verify-identity="lock.canVerifyIdentity.value"
          :unlock-candidates="lock.unlockCandidates.value"
          :challenge-open="lock.challengeOpen.value"
          :member="lock.member.value"
          @request-unlock="lock.requestUnlock"
          @relock="lock.lock('manual')"
          @verified="lock.onVerified"
          @cancelled="lock.onCancelled"
          @night-now="nightNow = true"
          @leave="leaveWall"
        />
      </div>
    </header>

    <main class="relative flex min-h-0 flex-1 flex-col px-7">
      <component
        :is="currentView.component"
        :week-days="weekDays"
        :anchor-ymd="anchorYmd"
        :today-ymd="today"
        :tomorrow-ymd="tomorrowYmd"
        :portrait="isPortrait"
        :now="clockNow"
        :todos-for="jobs.todosFor"
        :unassigned-todos="jobs.unassignedTodos.value"
        :lists-for="jobs.listsFor"
        :orphan-lists="jobs.orphanLists.value"
        :is-pending="jobs.isPending"
        :visible-member-ids="visibleMemberIds"
        :back-label="backLabel"
        @toggle="onToggle"
        @back="selectView(lastCalendarView)"
        @open-day="openSheet({ kind: 'day', ymd: $event })"
        @focus-day="onFocusDay"
        @open="openSheet"
        @open-chores="selectView('jobs')"
      />

      <WallSheet
        v-if="sheet"
        :target="sheet"
        :is-pending="jobs.isPending"
        :visible-member-ids="visibleMemberIds"
        :todos-for="jobs.todosFor"
        :all-todos="jobs.allTodos.value"
        :lists-for="jobs.listsFor"
        :orphan-lists="jobs.orphanLists.value"
        :add-list-item="jobs.addListItem"
        :add-todo="jobs.addTodo"
        @close="sheet = null"
        @toggle="onToggle"
        @open="openSheet"
      />
    </main>

    <WallFooter :focused="focusedMemberId" @select="focusedMemberId = $event" />

    <WallTickBurst :bursts="bursts" />

    <!-- Leaving takes a moment (a route chunk); never let it look ignored. -->
    <div
      v-if="isExiting"
      class="dark:bg-surface-ground/95 absolute inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-[var(--cloud-white,#F8F9FA)]/95"
      role="status"
      aria-live="polite"
    >
      <span class="wall-exit-spinner" aria-hidden="true" />
      <p class="font-outfit text-secondary-500 wall-sheet-title dark:text-ink font-bold">
        {{ t('wall.exiting') }}
      </p>
    </div>

    <WallNightScreen
      v-if="nightNow"
      :time="clockNow.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })"
      :date="
        new Date(`${today}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })
      "
      :tomorrow-count="tomorrowCount"
      @wake="nightNow = false"
    />
  </div>
</template>

<style scoped>
/**
 * The wall type scale, scoped to this root.
 *
 * Deliberately NOT a third `data-text-size` value: settingsStore owns that
 * attribute with an immediate watcher, so a wall write would be clobbered by
 * any settings change, and "restore on unmount" would leak on a crash. A
 * scoped rule needs no global state and cannot leak.
 */

/**
 * Safe-area insets. This is the app's only full-bleed `h-[100dvh]` route, and
 * the `noChrome` branch inherits none of App.vue's compensation. On an
 * installed iPad PWA the status bar sat over the padlock and the home indicator
 * over the person filter — and `.wall-root` is `overflow-hidden`, so there was
 * no scroll to recover the wall's only exit. Padding is inside the 100dvh
 * (border-box), so nothing overflows.
 */
.wall-root {
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
}

.wall-exit-spinner {
  animation: wall-spin 900ms linear infinite;
  border: 3px solid var(--tint-slate-10);
  border-radius: 50%;
  border-top-color: var(--heritage-orange);
  height: 2.5rem;
  width: 2.5rem;
}

@keyframes wall-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .wall-exit-spinner {
    animation-duration: 2.4s;
  }
}

.wall-root :deep(.wall-date) {
  font-size: 2.6rem;
  line-height: 1;
}

.wall-root :deep(.wall-stamp) {
  font-size: 0.8rem;
}

.wall-root :deep(.wall-subtitle) {
  font-size: 0.92rem;
}

.wall-root :deep(.wall-clock) {
  font-size: 2.3rem;
}

/* The period navigator. rem-based like the rest of the wall scale, so Large
   reading mode carries it too. */
.wall-root :deep(.wall-nav-arrow) {
  font-size: 1.1rem;
  line-height: 1;
}

.wall-root :deep(.wall-nav-label) {
  font-size: 0.92rem;
}

.wall-root :deep(.wall-nav-today) {
  font-size: 0.85rem;
}

.wall-root :deep(.wall-card-title) {
  font-size: 0.78rem;
}

.wall-root :deep(.wall-card-line) {
  font-size: 0.95rem;
}

.wall-root :deep(.wall-card-sub) {
  font-size: 0.75rem;
}

/*
 * Inside a drill-in sheet the same class is doing a different job — booking
 * alerts and leg references, read standing at the screen rather than glanced at
 * from across the room. Phone-sized there was too small to be worth showing.
 */
.wall-root :deep(.wall-sheet-body .wall-card-sub) {
  font-size: 0.88rem;
}

.wall-root :deep(.wall-card-emoji) {
  font-size: 2rem;
}

.wall-root :deep(.wall-card-list-emoji) {
  font-size: 1.35rem;
}

.wall-root :deep(.wall-card-meal) {
  font-size: 1.3rem;
}

.wall-root :deep(.wall-pill) {
  font-size: 0.6rem;
}

.wall-root :deep(.wall-more) {
  font-size: 0.8rem;
}

.wall-root :deep(.wall-stars) {
  font-size: 0.95rem;
}

.wall-root :deep(.wall-chip-person) {
  font-size: 0.9rem;
}

.wall-root :deep(.wall-brand) {
  font-size: 0.82rem;
}

.wall-root :deep(.wall-sheet-title) {
  font-size: 1.75rem;
}

.wall-root :deep(.wall-sheet-close) {
  font-size: 1.25rem;
  height: 2.9rem;
  width: 2.9rem;
}

.wall-root :deep(.wall-sheet-label) {
  font-size: 0.72rem;
}

.wall-root :deep(.wall-sheet-line) {
  font-size: 1rem;
}

.wall-root :deep(.wall-sheet-empty) {
  color: var(--muted-text, #4d5d6c);
  font-size: 1.35rem;
}

.wall-root :deep(.wall-switch-btn) {
  font-size: 1.2rem;
  height: 2.75rem;
  width: 2.9rem;
}

.wall-root :deep(.wall-lock-btn) {
  font-size: 1.35rem;
  height: 3.25rem;
  width: 3.25rem;
}

.wall-root :deep(.wall-lock-heading) {
  font-size: 0.7rem;
}

.wall-root :deep(.wall-dow) {
  font-size: 0.78rem;
}

.wall-root :deep(.wall-dnum) {
  font-size: 1.65rem;
}

.wall-root :deep(.wall-block-title) {
  font-size: 0.95rem;
}

/* ── the time grid ────────────────────────────────────────────────────
 * Every size here is >= 0.75rem (the documented 12px floor). The wall scale
 * already carried SIX sub-floor sizes (verified: .wall-pill 0.6, .wall-nowtag
 * 0.66, .wall-lane-jobs-heading 0.66, .wall-lock-heading 0.7, .wall-strip-day
 * 0.7, .wall-sheet-label 0.72, .wall-strip-count 0.72, .wall-chip-time 0.72).
 * This change REMOVES two of them — .wall-chip-time and .wall-nowtag, deleted
 * with WallEventChip and the today view's hand-rolled now tag — and adds none,
 * so the count goes 6 -> 4. These rem-based sizes are invisible to lint, which
 * polices `text-[Xpx]` only; the remaining four are pre-existing and out of
 * scope here.
 */
.wall-root :deep(.wall-axis) {
  font-size: 0.88rem;
}

.wall-root :deep(.wall-block-title-tight) {
  font-size: 0.85rem;
}

/* One class, three uses: the block's detail line, the all-day "everyone" tag
 * and the all-day label in the gutter. */
.wall-root :deep(.wall-block-meta) {
  font-size: 0.75rem;
}

.wall-root :deep(.wall-block-sliver) {
  font-size: 1.05rem;
}

.wall-root :deep(.wall-fold-label) {
  font-size: 1.15rem;
}

.wall-root :deep(.wall-nowpill) {
  font-size: 0.78rem;
}

.wall-root :deep(.wall-allday) {
  font-size: 0.85rem;
}

.wall-root :deep(.wall-tblock-now) {
  font-size: 0.75rem;
}

.wall-root :deep(.wall-job-title) {
  font-size: 1.05rem;
}

.wall-root :deep(.wall-job-done-at) {
  font-size: 0.78rem;
}

.wall-root :deep(.wall-job-tag) {
  font-size: 0.95rem;
}

.wall-root :deep(.wall-tick) {
  font-size: 1rem;
  height: 2rem;
  width: 2rem;
}

.wall-root :deep(.wall-bean-name) {
  font-size: 1.1rem;
}

.wall-root :deep(.wall-bean-count) {
  font-size: 0.78rem;
}

.wall-root :deep(.wall-lane-jobs-heading) {
  font-size: 0.66rem;
}

.wall-root :deep(.wall-slot-time) {
  font-size: 1.4rem;
}

.wall-root :deep(.wall-slot-title) {
  font-size: 1.4rem;
}

.wall-root :deep(.wall-strip-day) {
  font-size: 0.7rem;
}

.wall-root :deep(.wall-strip-num) {
  font-size: 1.3rem;
}

.wall-root :deep(.wall-strip-count) {
  font-size: 0.72rem;
}

.wall-root :deep(.wall-rest-day) {
  font-size: 0.9rem;
}

.wall-root :deep(.wall-rest-count) {
  font-size: 0.8rem;
}

.wall-root :deep(.wall-back) {
  font-size: 0.95rem;
}

.wall-root :deep(.wall-board-title) {
  font-size: 1.7rem;
}

.wall-root :deep(.wall-board-sum) {
  font-size: 0.95rem;
}

.wall-root :deep(.wall-shared-title) {
  font-size: 0.8rem;
}

.wall-root :deep(.wall-shared-progress) {
  font-size: 0.9rem;
}

.wall-root :deep(.wall-night-time) {
  font-size: 8.5rem;
}

.wall-root :deep(.wall-night-date) {
  font-size: 1.4rem;
}

.wall-root :deep(.wall-night-hint) {
  font-size: 0.9rem;
}

.wall-root :deep(.wall-night-brand) {
  font-size: 1rem;
}

/**
 * Portrait overrides — the mockup's `.port` block. A tablet turned upright has
 * ~60% of the width, so the header furniture has to come down or the date and
 * the clock each wrap onto two lines and eat a third of the screen.
 */
.wall-portrait :deep(.wall-date) {
  font-size: 1.85rem;
}

.wall-portrait :deep(.wall-subtitle) {
  font-size: 0.82rem;
}

.wall-portrait :deep(.wall-clock) {
  font-size: 1.7rem;
}

.wall-portrait :deep(.wall-nav-arrow) {
  font-size: 1rem;
}

.wall-portrait :deep(.wall-nav-label) {
  font-size: 0.82rem;
}

.wall-portrait :deep(.wall-nav-today) {
  font-size: 0.78rem;
}

.wall-portrait :deep(.wall-switch-btn) {
  font-size: 1.05rem;
  height: 2.4rem;
  width: 2.5rem;
}

.wall-portrait :deep(.wall-lock-btn) {
  font-size: 1.15rem;
  height: 2.75rem;
  width: 2.75rem;
}

.wall-portrait :deep(.wall-card-meal) {
  font-size: 1.1rem;
}

.wall-portrait :deep(.wall-card-emoji) {
  font-size: 1.6rem;
}
</style>
