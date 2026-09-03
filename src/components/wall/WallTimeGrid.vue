<script setup lang="ts">
/**
 * The beanie wall's time grid — one renderer, three views.
 *
 * The days, the bean lanes and today all differ only in WHAT their columns are;
 * the axis, the folds, the all-day band, the now-line and the blocks are one
 * implementation. Three copies of this is three chances for 16:00 to mean three
 * different heights.
 *
 * ⚠️ It draws ONE continuous surface with column dividers, NOT n separate cards.
 * That is what lets a rule drawn at 07:30 be a single line across the whole week
 * — which is the entire point of the grid over the chip stack it replaces.
 *
 * Complexity budget, and it is a review gate rather than a suggestion: this file
 * does exactly four things — MEASURE, call `layoutTimeGrid`, resolve identities,
 * RENDER. Anything derivable from props alone belongs in `wallTimeGrid.ts` or
 * `wallActivities.ts`. If this script grows past ~300 lines, something in it is a
 * pure function that has not been moved out yet.
 */
import { computed, ref, watch } from 'vue';
import WallTimeBlock from '@/components/wall/WallTimeBlock.vue';
import { useActivityIdentity } from '@/composables/useActivityIdentity';
import { useElementSize } from '@/composables/useElementSize';
import { useTranslation } from '@/composables/useTranslation';
import { fillTemplate } from '@/utils/fillTemplate';
import { layoutTimeGrid, type GridLayout } from '@/utils/wallTimeGrid';
import { createChangeGate } from '@/services/telemetry/emitPolicy';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import type { WallAllDaySpan, WallOccurrence } from '@/utils/wallActivities';
import type { FamilyActivity } from '@/types/models';
import type { WallSheetTarget } from '@/types/wall';

const SURFACE = 'wall-time-grid';
/** One frame. A layout slower than this on an old iPad is the actionable case. */
const SLOW_MS = 16;

export interface WallGridColumn {
  key: string;
  occurrences: WallOccurrence[];
  /**
   * Set on a bean lane. Two things follow from it, and they are the same idea:
   * the lane header already names this bean, so a solo card here draws no face —
   * and the LANE carries their colour, so the cards inside it do not.
   */
  laneMemberId?: string;
  /** The lane's own hue. Present on bean lanes, absent on day columns. */
  tint?: string;
  isToday?: boolean;
}

const props = defineProps<{
  columns: WallGridColumn[];
  /**
   * Pre-computed by the view, because "shared" means different things per view:
   * days go through `wallDayAllDay`, lanes and today through `wallSharedAllDay`.
   */
  allDaySpans: WallAllDaySpan[];
  now: Date;
  /** The columns shown ARE today, so what has happened can be dimmed. */
  dimPast: boolean;
  showNow: boolean;
  axisWidth: number;
  /** Names this grid in telemetry — the wall view id. */
  viewId: string;
}>();
const emit = defineEmits<{ open: [WallSheetTarget] }>();

const { t } = useTranslation();
const { identityFor } = useActivityIdentity();

// ── Measure ───────────────────────────────────────────────────────────────
//
// The grid lays out to a HEIGHT, and flexbox only settles that after the first
// paint, so the height cannot be guessed — guessing left a hundred pixels of
// white space under the last event of the day.
//
// ⚠️ "A ResizeObserver drives a computed that renders into the observed element"
// is normally an infinite loop. It is safe here for a STRUCTURAL reason, not an
// incidental one: the plot's height comes from flexbox and everything the grid
// draws is absolutely positioned inside it, so the layout cannot change the box
// it is measured against. Do not make a block affect the plot's own height.
const plot = ref<HTMLElement | null>(null);
const { width: plotWidth, height: plotHeight } = useElementSize(plot, { surface: SURFACE });

/**
 * A measured height of 0 — a hidden tab, or the first frame before flex resolves
 * — must not lay out: it would render a crush that then silently persists until
 * the next resize. Keep the last good height instead.
 */
const lastGoodHeight = ref(0);
const lastGoodWidth = ref(0);
watch(plotHeight, (h) => {
  if (h > 40) lastGoodHeight.value = h;
});
/*
 * ⚠️ The WIDTH needs the same fallback as the height, and for a louder reason.
 * A transient zero height stops the layout; a transient zero width did NOT — it
 * left the grid fully populated while every block computed a lane width of 0,
 * dropped to `sliver` density and threw its title away. A `display:none`
 * ancestor during a view swap, or one early observer frame, produced a complete
 * but entirely unreadable wall.
 */
watch(plotWidth, (w) => {
  if (w > 40) lastGoodWidth.value = w;
});
const layoutHeight = computed(() =>
  plotHeight.value > 40 ? plotHeight.value : lastGoodHeight.value
);
const layoutWidth = computed(() => (plotWidth.value > 40 ? plotWidth.value : lastGoodWidth.value));

// ── Lay out ───────────────────────────────────────────────────────────────

const tierGate = createChangeGate();
const slowGate = createChangeGate();
const rejectedGate = createChangeGate();

/**
 * The computed stays PURE — it returns the outcome, it does not report it.
 *
 * Logging (or flipping a `failed` ref) from inside a computed is a side effect
 * in a derivation: Vue may re-evaluate it whenever it likes, so the telemetry
 * rate stops meaning anything and the flag can be written during another
 * component's render. The reporting hangs off a watcher instead, where a side
 * effect belongs.
 */
interface LayoutOutcome {
  layout: GridLayout | null;
  error: unknown;
  elapsedMs: number;
}

const outcome = computed<LayoutOutcome>(() => {
  if (!layoutHeight.value) return { layout: null, error: null, elapsedMs: 0 };
  const started = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    const layout = layoutTimeGrid(
      props.columns.map((c) => c.occurrences),
      layoutHeight.value
    );
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    return { layout, error: null, elapsedMs: now - started };
  } catch (error) {
    return { layout: null, error, elapsedMs: 0 };
  }
});

const layout = computed(() => outcome.value.layout);
/** A layout that threw. The grid still shows the day — as a labelled static list. */
const failed = computed(() => outcome.value.error !== null);

/**
 * Diagnostics, gated. The wall never unmounts and `logEvent` drops everything on
 * a surface once 50/min is hit, so an event per relayout would saturate the
 * bucket within minutes and then silently lose the events that matter.
 * `createChangeGate` emits on every transition plus a heartbeat — which keeps the
 * rate measurable AND keeps "is this still running?" answerable.
 */
watch(
  outcome,
  ({ layout: result, error, elapsedMs }) => {
    if (error) {
      // The layout is pure and total, so this should be unreachable — which is
      // exactly why it must be loud if it ever happens, and why the fallback
      // still shows the family their day.
      console.error(
        `[${SURFACE}] layout threw — falling back to a static list. The layout is pure: ` +
          `replay this view's column data through layoutTimeGrid in wallTimeGrid.test.ts.`,
        error
      );
      reportError({
        surface: SURFACE,
        message: 'wall_grid_failed',
        severity: 'error',
        error: error instanceof Error ? error : undefined,
        context: { action: 'layout', kind: props.viewId, error_code: 'layout_threw' },
      });
      return;
    }
    if (!result) return;

    if (tierGate(`${props.viewId}:${result.tier}`)) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_grid_tier',
        context: { action: 'layout', kind: props.viewId, stage: result.tier },
      });
    }
    // Not routed through perfTiming: its TELEMETRY_FLOOR_MS = 250 would drop a
    // single-digit-millisecond layout entirely.
    const slow = elapsedMs > SLOW_MS;
    if (slowGate(`${props.viewId}:${slow}`) && slow) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'wall_grid_slow',
        context: { action: 'layout', kind: props.viewId, stage: 'slow' },
      });
    }
    if (result.rejected.length && rejectedGate(`${props.viewId}:${result.rejected.length}`)) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'wall_grid_unreadable_time',
        context: {
          action: 'layout',
          kind: props.viewId,
          error_code: 'unreadable_time',
          count: result.rejected.length,
        },
      });
    }
  },
  { immediate: true }
);

// ── Derived render data ───────────────────────────────────────────────────

const columnWidth = computed(() =>
  props.columns.length ? layoutWidth.value / props.columns.length : layoutWidth.value
);
const columnPercent = computed(() => 100 / Math.max(1, props.columns.length));
const nowMinutes = computed(() => props.now.getHours() * 60 + props.now.getMinutes());

/**
 * An occurrence with an unreadable time is shown in the all-day band rather than
 * dropped: a corrupt `startTime` costs the family a position on the axis, not
 * the event itself.
 */
const bandRows = computed(() => {
  const rows = [...props.allDaySpans];
  // Its OWN column, not the whole width. Spanning every column drew one broken
  // Thursday record as a bar across the entire week.
  for (const { occurrence, column } of layout.value?.rejected ?? []) {
    rows.push({ occurrence, startCol: column, span: 1, everyone: false });
  }
  return rows;
});

/** All-day rows touching a given column — an empty column is one with neither. */
function bandRowsFor(index: number) {
  return bandRows.value.filter((row) => index >= row.startCol && index < row.startCol + row.span);
}

const showNowLine = computed(
  () =>
    props.showNow &&
    !!layout.value &&
    nowMinutes.value >= layout.value.windowStart &&
    nowMinutes.value <= layout.value.windowEnd
);
const nowY = computed(() =>
  layout.value && showNowLine.value ? layout.value.yFor(nowMinutes.value) : 0
);

/**
 * Minutes-since-midnight to a clock face, WRAPPED.
 *
 * An activity with no end time gets the assumed 90 minutes, so a 23:00 start
 * ends at 1470 — and without the wrap this printed "23:00–24:30". A sleepover
 * ending at 01:00 the next day is 1500, which read "25:00".
 */
function hhmm(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function identityOf(activity: FamilyActivity, laneMemberId?: string) {
  return identityFor(activity, laneMemberId ? { laneMemberId } : undefined);
}
function stateOf(start: number, end: number): 'past' | 'running' | 'future' {
  if (!props.dimPast) return 'future';
  if (end <= nowMinutes.value) return 'past';
  return start <= nowMinutes.value ? 'running' : 'future';
}
function progressOf(start: number, end: number): number {
  return Math.round((100 * (nowMinutes.value - start)) / Math.max(1, end - start));
}
/**
 * Two names, then a count. A family dinner belongs to everybody, so the raw list
 * reads "John Doe & Greg & Sofia & Leo & Milo & Theo" — a sentence longer than
 * the event it describes, which then truncates mid-name on any narrower column.
 * The faces already say who; this line only has to say how many.
 */
function ownerNames(activity: FamilyActivity, laneMemberId?: string): string {
  const members = identityOf(activity, laneMemberId).stackMembers;
  if (members.length <= 2) return members.map((m) => m.name).join(' & ');
  const rest = members.length - 2;
  return `${members[0]!.name} & ${members[1]!.name} +${rest}`;
}
function openActivity(occurrence: WallOccurrence): void {
  emit('open', { kind: 'activity', activityId: occurrence.activity.id, ymd: occurrence.date });
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2" :style="{ '--wall-axis-w': `${axisWidth}px` }">
    <!-- all-day band: pinned above the axis, because these have no time -->
    <div
      v-if="bandRows.length"
      class="relative shrink-0"
      :style="{ paddingLeft: `${axisWidth}px` }"
    >
      <span
        class="wall-block-meta font-outfit absolute left-0 mt-2 w-[var(--wall-axis-w)] pr-3 text-right leading-none font-extrabold tracking-[0.12em] uppercase"
        style="color: #2b6ea8"
      >
        {{ t('wall.grid.allDay') }}
      </span>
      <div
        class="grid gap-1.5 rounded-2xl p-1.5"
        style="background: rgb(174 214 241 / 26%)"
        :style="{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }"
      >
        <button
          v-for="(row, i) in bandRows"
          :key="`${row.occurrence.activity.id}:${row.occurrence.date}:${i}`"
          type="button"
          class="wall-allday flex min-w-0 items-center gap-1.5 rounded-[10px] bg-white px-2 py-1 text-left dark:bg-slate-800"
          :class="row.everyone ? 'justify-center' : ''"
          :style="{ gridColumn: `${row.startCol + 1} / span ${row.span}` }"
          @click="openActivity(row.occurrence)"
        >
          <span aria-hidden="true">{{ identityOf(row.occurrence.activity).emoji }}</span>
          <span class="font-outfit truncate font-semibold">{{
            row.occurrence.activity.title
          }}</span>
          <span
            v-if="row.everyone"
            class="wall-block-meta font-outfit shrink-0 rounded-full px-1.5 font-extrabold tracking-[0.11em] uppercase"
            style="background: rgb(174 214 241 / 40%); color: #2b6ea8"
          >
            {{ t('wall.grid.everyone') }}
          </span>
        </button>
      </div>
    </div>

    <!--
      ⚠️ The plot carries a MINIMUM height, and the furniture around it does not.
      Without it the lanes view's jobs row and peripheral cards starved the
      calendar down to about 90px — two fold bands stacked on each other and
      every event an unreadable sliver. On a screen whose entire purpose is the
      plan, the calendar is the last thing that should yield: if the wall is
      genuinely too short for everything, the peripherals clip.
    -->
    <div class="relative flex min-h-[13.75rem] flex-1">
      <!-- the axis: event start times only. An hourly ruler is noise on a folded
           axis, and cannot be drawn inside a fold at all. -->
      <div class="relative shrink-0" :style="{ width: `${axisWidth}px` }">
        <span
          v-for="tick in layout?.ticks ?? []"
          :key="tick.minutes"
          class="wall-axis font-outfit absolute right-3 -translate-y-1/2 leading-none font-extrabold whitespace-nowrap text-[var(--muted-text,#4d5d6c)]"
          :style="{ top: `${tick.y}px` }"
        >
          {{ hhmm(tick.minutes) }}
        </span>
      </div>

      <!--
        ONE surface, dividers not cards. Paint order inside is load-bearing and
        deliberate: wash → rules → folds → dividers → NOW-LINE → columns → fold
        labels. The now-line goes BEHIND the blocks — drawn over them it struck a
        line through the title of the very event it was marking. The fold labels
        go OVER them, because a block nudged down by the height floor may overrun
        a fold and the sentence explaining the fold must stay readable.
      -->
      <div
        ref="plot"
        class="relative min-w-0 flex-1 overflow-hidden rounded-[20px] bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
      >
        <template v-if="layout && !failed">
          <!--
            A lane wears its bean's colour for its whole height. It used to, and
            losing it made six white columns that could only be told apart by
            reading a name at two metres. 8-digit hex rather than `color-mix`,
            which the oldest iPads this is built for do not have.
          -->
          <div
            v-for="(column, i) in columns"
            :key="`w${column.key}`"
            class="absolute top-0 bottom-0"
            :style="{
              left: `${columnPercent * i}%`,
              width: `${columnPercent}%`,
              background: column.tint
                ? `${column.tint}14`
                : column.isToday
                  ? 'rgb(241 93 34 / 4.5%)'
                  : 'transparent',
            }"
          />
          <div
            v-for="tick in layout.ticks"
            :key="`r${tick.minutes}`"
            class="wall-rule absolute right-0 left-0 h-px"
            :style="{ top: `${tick.y}px` }"
          />
          <div
            v-for="fold in layout.folds"
            :key="`f${fold.resumeMinutes}`"
            class="wall-fold absolute right-0 left-0"
            :style="{ top: `${fold.top}px`, height: `${fold.height}px` }"
          />
          <!--
            The dividers do real work at three metres and were far too faint to
            do it: a 7% hairline between seven day columns is invisible from
            across a kitchen, so the week read as one field of cards rather than
            seven days. Wider, darker, and paired with a soft inset shadow so the
            edge reads as a seam rather than a drawn line.
          -->
          <div
            v-for="i in Math.max(0, columns.length - 1)"
            :key="`s${i}`"
            class="wall-colsep absolute top-0 bottom-0"
            :style="{ left: `${columnPercent * i}%` }"
          />
          <div
            v-if="showNowLine"
            class="wall-nowline absolute right-0 left-0"
            :style="{ top: `${nowY}px` }"
            aria-hidden="true"
          />
          <div
            v-for="(column, i) in columns"
            :key="column.key"
            class="wall-blocklayer absolute top-0 bottom-0"
            :style="{ left: `${columnPercent * i}%`, width: `${columnPercent}%` }"
          >
            <WallTimeBlock
              v-for="block in layout.columns[i] ?? []"
              :key="`${block.occurrence.activity.id}:${block.occurrence.date}`"
              :activity="block.occurrence.activity"
              :identity="identityOf(block.occurrence.activity, column.laneMemberId)"
              :width="columnWidth * block.laneWidth"
              :height="block.height"
              :capped="block.capped"
              :washed="!column.tint"
              :state="column.isToday || !dimPast ? stateOf(block.start, block.end) : 'future'"
              :progress="progressOf(block.start, block.end)"
              :time-range="`${hhmm(block.start)}–${hhmm(block.end)}`"
              :owner-names="ownerNames(block.occurrence.activity, column.laneMemberId)"
              :style="{
                top: `${block.top}px`,
                height: `${block.height}px`,
                left: `calc(${block.laneOffset * 100}% + ${block.lane ? 3 : 0}px)`,
                width: `calc(${block.laneWidth * 100}% - ${block.lanes > 1 ? 3 : 0}px)`,
              }"
              @open="openActivity(block.occurrence)"
            />
            <!--
              The day is empty only when NOTHING is on it — the all-day band
              counts. Testing timed blocks alone wrote "nothing on" across a
              column that was, right above it, showing that day's birthday.
            -->
            <p
              v-if="!(layout.columns[i] ?? []).length && !bandRowsFor(i).length"
              class="font-caveat absolute top-1/2 right-0 left-0 -translate-y-1/2 text-center opacity-55 dark:text-gray-300"
            >
              {{ t('wall.day.nothingOn') }}
            </p>
          </div>
          <div
            v-for="fold in layout.folds"
            :key="`l${fold.resumeMinutes}`"
            class="pointer-events-none absolute right-0 left-0 z-[8] flex -translate-y-1/2 justify-center"
            :style="{ top: `${fold.top + fold.height / 2}px` }"
          >
            <span
              class="wall-fold-label font-caveat rounded-full bg-white px-3 font-bold whitespace-nowrap text-[var(--muted-text,#4d5d6c)] dark:bg-slate-800"
            >
              {{ fillTemplate(t('wall.grid.quietUntil'), { time: hhmm(fold.resumeMinutes) }) }}
            </span>
          </div>
        </template>

        <!--
          The fallback. Same block, ordinary static flow — and it SAYS it is a
          fallback, so a degraded layout never looks like a design choice.
        -->
        <div v-else-if="failed" class="flex h-full flex-col gap-1 overflow-y-auto p-3">
          <p class="font-caveat wall-fold-label text-[var(--muted-text,#4d5d6c)]">
            {{ t('wall.grid.fallback') }}
          </p>
          <button
            v-for="occ in columns.flatMap((c) => c.occurrences)"
            :key="`${occ.activity.id}:${occ.date}`"
            type="button"
            class="wall-block-title font-outfit rounded-xl border-l-[5px] bg-white px-2 py-1 text-left dark:bg-slate-800"
            :style="identityOf(occ.activity).edgeStyle"
            @click="openActivity(occ)"
          >
            <span aria-hidden="true">{{ identityOf(occ.activity).emoji }}</span>
            {{ occ.activity.startTime || t('planner.allDay') }} · {{ occ.activity.title }}
          </button>
        </div>
      </div>

      <span
        v-if="showNowLine"
        class="wall-nowpill font-outfit absolute z-[9] -translate-y-1/2 rounded-full px-2 py-0.5 font-extrabold whitespace-nowrap text-white"
        :style="{ top: `${nowY}px`, right: '8px' }"
      >
        {{ fillTemplate(t('wall.grid.nowAt'), { time: hhmm(nowMinutes) }) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
/* The fold: the signature of this design. Not blank space saved — the label
   answers the question the gap poses ("what happens next, and when?"). */
.wall-fold {
  background: rgb(44 62 80 / 3.5%);
  border-bottom: 1px dashed rgb(44 62 80 / 20%);
  border-top: 1px dashed rgb(44 62 80 / 20%);
}

/*
 * The plot is `dark:bg-slate-800`, so Deep Slate ink at 3.5–20% over it is
 * invisible — the family saw a "quiet until 15:20" label floating with no band
 * around it and an axis with no rules. The wall runs on a kitchen tablet that is
 * dark half the time it is looked at.
 */
:global(.dark) .wall-fold {
  background: rgb(255 255 255 / 5%);
  border-bottom-color: rgb(255 255 255 / 24%);
  border-top-color: rgb(255 255 255 / 24%);
}

/*
 * The hour rules are the grid. At 6% they were invisible from across a kitchen —
 * which is why the lanes and today views read as having no grid at all — and
 * they only appeared at irregular event times anyway. On the hour and at this
 * weight they give the eye the ruler it needs to place a block in time.
 */
.wall-rule {
  background: rgb(44 62 80 / 11%);
}

:global(.dark) .wall-rule {
  background: rgb(255 255 255 / 13%);
}

.wall-colsep {
  background: rgb(44 62 80 / 16%);
  box-shadow: 1px 0 0 rgb(255 255 255 / 55%);
  width: 1.5px;
}

:global(.dark) .wall-colsep {
  background: rgb(255 255 255 / 14%);
  box-shadow: 1px 0 0 rgb(0 0 0 / 25%);
}

.wall-nowline {
  background: var(--heritage-orange);
  box-shadow: 0 0 0 3px rgb(241 93 34 / 10%);
  height: 2px;

  /* Behind the blocks, on purpose. See the paint-order note in the template. */
  z-index: 2;
}

.wall-nowpill {
  background: var(--heritage-orange);
  box-shadow: 0 3px 9px rgb(241 93 34 / 34%);
}
</style>
