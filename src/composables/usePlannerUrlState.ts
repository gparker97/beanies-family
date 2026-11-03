import { watch, type Ref } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { isPlannerView, type PlannerView } from '@/composables/usePlannerNavigation';
import { useToday } from '@/composables/useToday';
import { isRealYmd, parseLocalDate, toDateInputValue } from '@/utils/date';
import { logEvent } from '@/services/telemetry';
import { PLANNER_ROUTE_NAME } from '@/constants/navigation';

/** The query keys this composable owns on `/activities`. */
export interface PlannerQuery {
  view: string | undefined;
  d: string | undefined;
}

export interface ParsedPlannerQuery {
  view: PlannerView;
  /** The reference day as `YYYY-MM-DD`; today when the URL carries none. */
  ymd: string;
  /** Which params were present but rejected (each falls back to its default). */
  invalid: Array<'view' | 'd'>;
}

function todayYmd(): string {
  return toDateInputValue(useToday().startOfToday.value);
}

/**
 * Read `?view=` and `?d=` from a route query. Pure: rejected values are reported in
 * `invalid` for the caller to log, never thrown. `d` is `d`, not `date`, because
 * `date` is already the `?activity=` deep link's companion (it opens one occurrence).
 */
export function parsePlannerQuery(
  query: LocationQuery,
  today: string = todayYmd()
): ParsedPlannerQuery {
  const invalid: Array<'view' | 'd'> = [];
  let view: PlannerView = 'month';
  let ymd = today;
  if (query.view !== undefined) {
    if (isPlannerView(query.view)) view = query.view;
    else invalid.push('view');
  }
  if (query.d !== undefined) {
    if (typeof query.d === 'string' && isRealYmd(query.d)) ymd = query.d;
    else invalid.push('d');
  }
  return { view, ymd, invalid };
}

/**
 * The canonical query for a planner state. Defaults are dropped (`view` when month,
 * `d` when today) so a plain `/activities` stays canonical; a dropped key is
 * `undefined`, which overrides a stale value when spread and which vue-router omits.
 */
export function toPlannerQuery(
  view: PlannerView,
  date: Date,
  today: string = todayYmd()
): PlannerQuery {
  const ymd = toDateInputValue(date);
  return {
    view: view === 'month' ? undefined : view,
    d: ymd === today ? undefined : ymd,
  };
}

/**
 * Mirror the planner's view and (when explicit) its reference date into the URL
 * (`/activities?view=day|week|month&d=YYYY-MM-DD`).
 *
 * State stays the source of truth. Every writer (prev/next/today, the view switcher,
 * the month stream) keeps assigning the refs and the state watch replaces the URL,
 * so none of them adds a history entry and a future writer cannot forget the URL.
 * `drillToDay` is the single place an entry is pushed.
 *
 * **`d` is explicit-only.** It enters the URL through a drill-in push, or is already
 * there because an external link named a day (a widget row tap). Once present it is
 * kept up to date (prev/next inside a drilled day keep the URL honest); a "Today" tap
 * resolves to today, which `toPlannerQuery` drops, so it clears the explicit context.
 * Scrolling the month stream and prev/next in a plain context never add `d`, so Back,
 * a reload or the PWA update replay can never resurrect a day the user merely scrolled
 * past. Consequences: Back from a drilled-in day lands on the month on TODAY, not on
 * the drilled month, and a drill into today itself carries no `d`.
 *
 * URL → state is two single-key watches, one per key, each assigning only when the
 * parsed value differs from state (the whole echo guard). Per-key matters: a tuple
 * watch re-applied BOTH keys on every fire, so writing `view` after scrolling to
 * another month snapped the date back to today. Both are registered before the
 * state → URL watch, so on a navigation that changes both keys (Back from a drill)
 * both assignments land first and the state watch finds nothing to write.
 *
 * Every watcher returns unless the current route is the planner: with the default
 * `pre` flush they run before the render that unmounts the page, so on navigation
 * away they would otherwise see the destination's empty query.
 *
 * `plannerDayLink` (`src/utils/entityDeepLink.ts`) is the external writer of the same
 * keys (widget links); it cannot import this Vue-bound module, so a round-trip test
 * through `parsePlannerQuery` holds the two in step.
 */
export function usePlannerUrlState(options: {
  activeView: Ref<PlannerView>;
  referenceDate: Ref<Date>;
}): { drillToDay: (ymd: string) => void } {
  const { activeView, referenceDate } = options;
  const route = useRoute();
  const router = useRouter();
  let pushNext = false;

  const onPlanner = (): boolean => route.name === PLANNER_ROUTE_NAME;
  const logInvalid = (detail: 'view' | 'd'): void => {
    logEvent({
      level: 'warn',
      surface: 'planner-url',
      message: 'invalid_param',
      context: { action: 'invalid_param', detail },
    });
  };

  watch(
    () => route.query.view,
    () => {
      if (!onPlanner()) return;
      const parsed = parsePlannerQuery(route.query);
      if (parsed.invalid.includes('view')) logInvalid('view');
      if (parsed.view !== activeView.value) activeView.value = parsed.view;
    },
    { immediate: true }
  );

  watch(
    () => route.query.d,
    () => {
      if (!onPlanner()) return;
      const parsed = parsePlannerQuery(route.query);
      if (parsed.invalid.includes('d')) logInvalid('d');
      if (parsed.ymd === toDateInputValue(referenceDate.value)) return;
      referenceDate.value = parseLocalDate(parsed.ymd);
      // A rejected `d` fell back to today and was logged as `invalid_param`; only a
      // date that was actually read from the URL counts as applied.
      if (route.query.d !== undefined && !parsed.invalid.includes('d')) {
        logEvent({
          level: 'debug',
          surface: 'calendar-nav',
          message: 'planner date applied from the URL',
          context: { action: 'date-from-url', detail: 'deep-link' },
        });
      }
    },
    { immediate: true }
  );

  watch([activeView, referenceDate], () => {
    const push = pushNext;
    pushNext = false;
    if (!onPlanner()) return;
    const explicit = push || route.query.d !== undefined;
    const next = toPlannerQuery(activeView.value, referenceDate.value);
    if (!explicit) next.d = undefined;
    if (route.query.view === next.view && route.query.d === next.d) return;
    // Spreading keeps a pending `activity`/`date` deep link until useDeepLinkParam clears it.
    const target = { query: { ...route.query, ...next } };
    (push ? router.push(target) : router.replace(target)).catch((error: unknown) => {
      logEvent({
        level: 'warn',
        surface: 'planner-url',
        message: 'url_write_failed',
        context: { action: 'url_write_failed', detail: push ? 'push' : 'replace' },
        error,
      });
    });
  });

  function drillToDay(ymd: string): void {
    pushNext = true;
    referenceDate.value = parseLocalDate(ymd);
    activeView.value = 'day';
  }

  return { drillToDay };
}
