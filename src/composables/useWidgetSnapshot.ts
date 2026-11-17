import { computed, shallowRef, watch } from 'vue';
import { isNative } from '@/services/sync/capabilities';
import { useScheduledReminders } from '@/composables/useScheduledReminders';
import { useToday } from '@/composables/useToday';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTranslationStore } from '@/stores/translationStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useWeatherStore } from '@/stores/weatherStore';
import { useChoreStore } from '@/stores/choreStore';
import { useCalendarViewStore } from '@/stores/calendarViewStore';
import { isFlagEnabled } from '@/config/flags';
import { addDaysYmd, daysBetweenYmd } from '@/utils/date';
import { WIDGET_DAYS } from '@/types/widgetSnapshot';
import { measureSync } from '@/utils/perfTiming';
import { reportError } from '@/utils/errorReporter';
import {
  createTrailingSingleFlight,
  type TrailingSingleFlight,
} from '@/utils/trailingSingleFlight';
import { buildWidgetSnapshot, type WidgetSnapshotInput } from '@/utils/widgetSnapshot';
import { WidgetBridge, type WidgetPublishResult } from '@/services/native/widgetBridgePlugin';
import {
  circleOptionsToken,
  emitPlacements,
  emitReadOutcome,
  emitExternalRowsWaitExpired,
  emitSignOutHaltIncomplete,
  emitSnapshotPublished,
  splitPlacements,
  type WidgetRefreshReason,
} from '@/services/telemetry/homeWidgetEvents';

/**
 * Publishes the home-screen widget snapshot (#130, ADR-042). Native only.
 *
 * The reminders precedent (`useLocalNotifications`), on the same input: the snapshot is
 * built from `useScheduledReminders().reminderInput` plus the widget-only stores, by the
 * pure `buildWidgetSnapshot`, and handed to the `WidgetBridge` plugin, which writes it into
 * the app's shared container and refreshes the widgets. Nothing polls: a data or settings
 * change (including the midnight roll, which is a `today` change) or a return to the
 * foreground queues a publish.
 *
 * Entry points, outermost first:
 *   watch(snapshotInput) / watch(isVisible) → queue(reason)  (1 s debounce,
 *     ONE pending-reason slot: the last reason wins)
 *     → flight.call(reason)  (`createTrailingSingleFlight`: one publish in flight, one trailing)
 *       → publishWidgetSnapshot(input, reason, now)  ← EXPORTED SEAM. Holds the not-ready
 *         guard: a null input means the family is not loaded, which is NOT "an empty day".
 *         Publishing then would blank a placed widget on every cold start. Sign-out's wipe
 *         is the explicit `clearWidgetSnapshot` step, never a side effect of an empty input.
 *
 * PUBLISHER STATES. Invariants:
 *  P1. `snapshotInput === null` means exactly one thing: NO SESSION (the family is not
 *      loaded). It is the only signal the session-boundary rule reads.
 *  P2. Holding for the view-only calendars' first read is a SEPARATE state (`holding`),
 *      never a null input: a hold starting or ending is not a session boundary, so it can
 *      never clear `halted`. While holding, a queued publish is skipped; the hold ending
 *      queues one.
 *  P3. `halted` (set by sign-out before the file is deleted) blocks every publish until
 *      the watcher sees a session boundary: the input going null, or null to non-null.
 *  P4. Sign-out cancels the hold timer, so nothing scheduled in the departing session
 *      fires into it.
 *  P5. A publish happens only when the input's VALUE changes (or on a return to the
 *      foreground): every input reference must be stable while its content is (the view
 *      store's `widgetEvents` keeps its array when nothing changed).
 *
 * Every failure is reported (`reportError`, surface `home-widget`, severity `error`: the app
 * still works), the console names the fix, and the person is told once per session.
 *
 * Weather (#134) enters the input as its TIME-INDEPENDENT parts only (the reading, the unit,
 * the home zone, and whether weather is on with a town), never `weatherStore.atom`: the atom's
 * age text changes on every 5-minute tick, this publisher has no identical-JSON dedupe, and
 * every publish reloads every widget, so an atom input would spend WidgetKit's reload budget
 * every 5 minutes. The age is drawn natively from `weather.ageFrom` / `currentUntil` instead.
 */

const PUBLISH_DEBOUNCE_MS = 1000;
/**
 * The longest sign-out waits for an in-flight publish before deleting anyway. A wedged
 * native bridge must not hold sign-out (and every step after it) hostage; the delete that
 * follows still runs, and a publish landing later is caught by the next sign-in's republish.
 */
const HALT_WAIT_MS = 3000;
/**
 * How long a launch holds the snapshot for the view-only calendars' first read. Past
 * this the family's own rows publish without those events (and again once the read
 * settles): a read that is slow, or never starts because the app woke hidden, must
 * never keep to-dos, activities and meals off the home screen.
 */
const EXTERNAL_ROWS_WAIT_MS = 4000;

/** The reject codes the plugin documents (`widgetBridgePlugin.ts`); anything else is unknown. */
const PLUGIN_ERROR_CODES = ['app_group_unavailable', 'write_failed', 'reload_failed'] as const;
type PublishStage = 'build' | 'write' | 'reload';

// ── Module-scoped state ───────────────────────────────────────────────────────
// All of it lives here, NOT inside the composable, so `__resetUseWidgetSnapshotForTesting`
// can reach every piece (the `useLocalNotifications` rule).
let initialized = false;
let debounce: ReturnType<typeof setTimeout> | null = null;
/** The reason the queued publish will carry; the last trigger before the debounce fires wins. */
let pendingReason: WidgetRefreshReason | null = null;
let flight: TrailingSingleFlight<WidgetRefreshReason, void> | null = null;
/** One failure toast per session; reset by the next successful publish. */
let publishFailureToasted = false;
/** The placements last logged (sorted `size:count` pairs), so they log only on change. */
let lastPlacementsKey: string | null = null;
/**
 * Set by sign-out (`haltWidgetPublishingForSignOut`) BEFORE the snapshot file is deleted, so
 * no queued or trailing publish can write the departing family's day back afterwards.
 * Cleared at the next SESSION BOUNDARY seen by the watcher: the input going null (the old
 * session is gone) or going from null to non-null (a new session started). The second case
 * matters for an eviction, where the member is cleared BEFORE the halt runs, so the input is
 * already null when it is halted and the next change it sees is the next member signing in.
 */
let halted = false;
/** Whether the watcher last saw a null input (no session); drives the boundary rule above. */
let lastInputNull = true;
/** The bounded hold's timer (`EXTERNAL_ROWS_WAIT_MS`). Module scope so sign-out can cancel it (P4). */
let externalWaitTimer: ReturnType<typeof setTimeout> | null = null;

function cancelExternalWait(): void {
  if (externalWaitTimer) clearTimeout(externalWaitTimer);
  externalWaitTimer = null;
}

/** The plugin's reject code when it is one we know, else a fixed fallback. */
function pluginErrorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (PLUGIN_ERROR_CODES as readonly string[]).includes(code)
    ? code
    : 'publish_failed';
}

/** Report one failed publish: firehose, console guidance, and a once-per-session toast. */
function reportPublishFailure(stage: PublishStage, errorCode: string, error: unknown): void {
  reportError({
    surface: 'home-widget',
    severity: 'error',
    message: 'snapshot publish failed',
    error,
    context: { stage, error_code: errorCode },
  });
  console.warn(
    `[home-widget] ${errorCode}: check the App Group entitlement and portal registration (runbook §6c)`
  );
  if (publishFailureToasted) return;
  publishFailureToasted = true;
  // `silent`: reported above under a precise surface; a warning toast must not log it twice.
  const t = useTranslationStore().t;
  showToast('warning', t('widget.publishFailed'), t('widget.publishFailedHelp'), { silent: true });
}

/** Log placements once per session, and again only when the set (or a circle's option) changes. */
function logPlacementsOnChange(placements: WidgetPublishResult['placements']): void {
  const { sizes, circle, todos } = splitPlacements(placements);
  const key = [
    ...Object.entries(sizes)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([size, n]) => `${size}:${n}`)
      .sort(),
    circle ? circleOptionsToken(circle) : '',
    ...Object.entries(todos)
      .filter(([, n]) => (n ?? 0) > 0)
      .map(([size, n]) => `todos:${size}:${n}`)
      .sort(),
  ].join(',');
  if (key === lastPlacementsKey) return;
  lastPlacementsKey = key;
  emitPlacements(placements ?? {});
}

/**
 * Whole days from the app's `today` to the day the native widgets painted (`0` = today,
 * `-1` = still on yesterday), or undefined when the native side reported none (iOS) or
 * something that is not a `YYYY-MM-DD` day (never trusted into the firehose).
 */
function renderedDayOffset(today: string, renderedYmd: unknown): number | undefined {
  if (typeof renderedYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(renderedYmd)) return undefined;
  return daysBetweenYmd(today, renderedYmd);
}

/**
 * Build, publish and log one snapshot. Never throws: every failure is reported here.
 * Exported so the not-ready guard and the failure paths are testable with a plain input.
 */
export async function publishWidgetSnapshot(
  input: WidgetSnapshotInput | null,
  reason: WidgetRefreshReason,
  now: Date
): Promise<void> {
  if (input === null || halted) return;

  let json: string;
  let rowsToday: number;
  let tasksToday: number;
  let aheadRows: number;
  let skipped: number;
  let hasWeather: boolean;
  try {
    const built = measureSync('widget-snapshot-build', () => buildWidgetSnapshot(input, now), {
      perf_entity_count: input.occurrencesByDate[input.today]?.length ?? 0,
    });
    json = JSON.stringify(built.snapshot);
    const [today, ...ahead] = built.snapshot.days;
    rowsToday = today?.view.rows.length ?? 0;
    const tasks = today?.view.tasks;
    tasksToday = tasks ? tasks.items.length + tasks.overflow.due + tasks.overflow.hint : 0;
    aheadRows = ahead.reduce((n, d) => n + d.view.rows.length, 0);
    skipped = built.skipped;
    hasWeather = !!built.snapshot.weather;
  } catch (e) {
    reportPublishFailure('build', 'build_failed', e);
    return;
  }

  let result: WidgetPublishResult;
  try {
    result = await WidgetBridge.publish({ json });
  } catch (e) {
    const code = pluginErrorCode(e);
    reportPublishFailure(code === 'reload_failed' ? 'reload' : 'write', code, e);
    return;
  }

  publishFailureToasted = false; // recovered
  emitSnapshotPublished({
    reason,
    rowsToday,
    tasksToday,
    aheadRows,
    kb: Math.ceil(new TextEncoder().encode(json).length / 1024),
    skipped,
    weather: hasWeather,
    renderedDayOffset: renderedDayOffset(input.today, result?.renderedYmd),
  });
  if (result?.readOutcome) emitReadOutcome(result.readOutcome);
  logPlacementsOnChange(result?.placements ?? {});
}

export function useWidgetSnapshot(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  const { reminderInput } = useScheduledReminders();
  const { today, isVisible } = useToday();
  const familyStore = useFamilyStore();
  const familyContextStore = useFamilyContextStore();
  const mealPlanStore = useMealPlanStore();
  const recipesStore = useRecipesStore();
  const settingsStore = useSettingsStore();
  const todoStore = useTodoStore();
  const translationStore = useTranslationStore();
  const vacationStore = useVacationStore();
  const weatherStore = useWeatherStore();
  const choreStore = useChoreStore();
  const calendarViewStore = useCalendarViewStore();

  const lockScreenTitles = computed(() => settingsStore.widgetLockScreenTitles);

  // A viewed calendar is in the widgets and its first read has not finished yet.
  const awaitingExternal = computed(
    () => calendarViewStore.calendars.some((c) => c.inWidgets) && !calendarViewStore.standingSettled
  );
  const externalWaitExpired = shallowRef(false);
  watch(
    awaitingExternal,
    (waiting) => {
      if (waiting) {
        if (externalWaitTimer || externalWaitExpired.value) return;
        externalWaitTimer = setTimeout(() => {
          externalWaitTimer = null;
          externalWaitExpired.value = true;
          emitExternalRowsWaitExpired();
        }, EXTERNAL_ROWS_WAIT_MS);
        return;
      }
      // Settled (or no calendar in the widgets): the next wait, after a sign-out, is fresh.
      cancelExternalWait();
      externalWaitExpired.value = false;
    },
    { immediate: true }
  );
  /**
   * Holding the snapshot for the view-only calendars' first read (P2). When any viewed
   * calendar is in the widgets, a launch waits until the first standing fetch has settled
   * (success or failure: `standingSettled` is "attempt finished"), so it publishes once WITH
   * the rows rather than once without and again with them. BOUNDED (`EXTERNAL_ROWS_WAIT_MS`):
   * past it the family's own rows publish without the events, and again when the read
   * settles. With no calendar in the widgets this adds no wait at all.
   */
  const holding = computed(() => awaitingExternal.value && !externalWaitExpired.value);

  /** The reminders' input plus the widget-only stores; null until the family is loaded. */
  const snapshotInput = computed<WidgetSnapshotInput | null>(() => {
    const base = reminderInput.value;
    // Null is "no session" and nothing else (P1); a hold is `holding` (P2).
    if (!base) return null;
    const day = today.value;
    const days = Array.from({ length: WIDGET_DAYS }, (_, i) => addDaysYmd(day, i));
    const mealsByDate = Object.fromEntries(days.map((d) => [d, mealPlanStore.mealsForDate(d)]));
    // Only what the builder reads: the watcher below is deep (it must see in-place edits),
    // so every field here is traversed on each trigger. The look-ahead's seven days of
    // occurrences, not the reminders' fourteen; the recipes those meals name, not the whole
    // cookbook.
    const recipeIds = new Set(
      Object.values(mealsByDate)
        .flat()
        .map((m) => m.recipeId)
        .filter(Boolean)
    );
    return {
      occurrencesByDate: Object.fromEntries(days.map((d) => [d, base.occurrencesByDate[d] ?? []])),
      todos: base.todos,
      lists: base.lists,
      currentMember: base.currentMember,
      resolveMember: base.resolveMember,
      t: base.t,
      today: day,
      days,
      members: familyStore.members,
      initialsById: familyStore.initialsById,
      mealsByDate,
      recipes: recipesStore.recipes.filter((r) => recipeIds.has(r.id)),
      vacations: vacationStore.vacations,
      hintTodos: todoStore.visibleHintTodos(base.currentMember, base.resolveMember),
      flags: {
        mealPlanner: isFlagEnabled('mealPlanner'),
        helpfulHints: isFlagEnabled('helpfulHints'),
      },
      lockScreenTitles: lockScreenTitles.value,
      language: translationStore.currentLanguage,
      familyId: familyContextStore.activeFamilyId ?? '',
      // Never `weatherStore.atom` (see the module docblock): a tick must not republish.
      weather: weatherStore.isActive
        ? {
            reading: weatherStore.reading,
            unit: settingsStore.temperatureUnit,
            zone: weatherStore.homeZone,
          }
        : null,
      // The choreboard (#146), read once here (the builder stays flag-free). Raw chores and
      // marks, never `choreDayFor`: that reads the one-minute chore clock, and an input that
      // changed every minute would republish every minute.
      chores: isFlagEnabled('choreboard')
        ? {
            chores: choreStore.chores,
            marks: choreStore.choreMarks,
            starts: choreStore.starts,
            beanIds: [...choreStore.livingIds],
          }
        : null,
      // The widget's one external-content path (ADR-048): only calendars whose widget switch
      // is on, and `buildWidgetSnapshot` drops them again for a child session.
      externalEvents: calendarViewStore.widgetEvents,
    };
  });

  // A fresh `now` per run; the trailing run takes the newest reason. Skipped while holding
  // (P2): the hold ending queues the publish below.
  const run = (reason: WidgetRefreshReason): Promise<void> =>
    holding.value
      ? Promise.resolve()
      : publishWidgetSnapshot(snapshotInput.value, reason, new Date());
  flight = createTrailingSingleFlight(run, (_queued, incoming) => incoming);

  // Deep on purpose: a store may edit an item in place (a renamed to-do) without changing any
  // reference this computed reads; the reminders watcher is deep for the same reason.
  watch(
    snapshotInput,
    (input) => {
      const isNull = input === null;
      if (isNull || lastInputNull) halted = false; // a session boundary: resume
      lastInputNull = isNull;
      queue('data-change');
    },
    { immediate: true, deep: true }
  );
  watch(holding, (held) => {
    if (!held) queue('data-change');
  });
  // `useToday` owns the app's only visibilitychange listener; watch it, never add another.
  watch(isVisible, (visible) => {
    if (visible) queue('foreground');
  });
}

/** Debounce every trigger into one publish; the single reason slot keeps the latest. */
function queue(reason: WidgetRefreshReason): void {
  pendingReason = reason;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    const next = pendingReason;
    pendingReason = null;
    if (next && flight) void flight.call(next);
  }, PUBLISH_DEBOUNCE_MS);
}

/**
 * Sign-out, BEFORE `WidgetBridge.clear()`: stop publishing, drop any queued publish, and
 * wait for one already in flight to land. Without this a debounced publish can finish its
 * native write after the delete and leave the family's day on the home screen (ADR-042).
 * Never throws, and never waits longer than `HALT_WAIT_MS`.
 */
export async function haltWidgetPublishingForSignOut(): Promise<void> {
  halted = true;
  cancelExternalWait(); // P4
  if (debounce) clearTimeout(debounce);
  debounce = null;
  pendingReason = null;
  const inFlight = flight?.pending();
  if (!inFlight) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), HALT_WAIT_MS);
  });
  const outcome = await Promise.race([inFlight.then(() => 'landed' as const), timedOut]).catch(
    () => 'failed' as const
  );
  clearTimeout(timer);
  if (outcome !== 'landed') emitSignOutHaltIncomplete(outcome);
}

/** Test-only: reset ALL module state between cases. */
export function __resetUseWidgetSnapshotForTesting(): void {
  initialized = false;
  if (debounce) clearTimeout(debounce);
  debounce = null;
  pendingReason = null;
  flight = null;
  publishFailureToasted = false;
  lastPlacementsKey = null;
  halted = false;
  lastInputNull = true;
  cancelExternalWait();
}
