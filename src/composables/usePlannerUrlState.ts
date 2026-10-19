import { watch, type Ref } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { isPlannerView, type PlannerView } from '@/composables/usePlannerNavigation';
import { useToday } from '@/composables/useToday';
import { isRealYmd, parseLocalDate, toDateInputValue } from '@/utils/date';
import { logEvent } from '@/services/telemetry';

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
 * Mirror the planner's view and reference date into the URL
 * (`/activities?view=day|week|month&d=YYYY-MM-DD`), so Back from a drilled-into day
 * returns to the month on that date.
 *
 * State stays the source of truth. Every writer (prev/next/today, the view switcher,
 * the month stream) keeps assigning the refs and the state watch replaces the URL,
 * so none of them adds a history entry and a future writer cannot forget the URL.
 * `drillToDay` is the single place an entry is pushed. The URL watch is what makes
 * back/forward work; it assigns only when the parsed values differ, which is the
 * whole echo guard.
 *
 * Both watchers return unless the current route is the planner: with the default
 * `pre` flush they run before the render that unmounts the page, so on navigation
 * away they would otherwise see the destination's empty query.
 */
export function usePlannerUrlState(options: {
  activeView: Ref<PlannerView>;
  referenceDate: Ref<Date>;
}): { drillToDay: (ymd: string) => void } {
  const { activeView, referenceDate } = options;
  const route = useRoute();
  const router = useRouter();
  let pushNext = false;

  watch(
    () => [route.query.view, route.query.d],
    () => {
      if (route.name !== 'Activities') return;
      const parsed = parsePlannerQuery(route.query);
      for (const detail of parsed.invalid) {
        logEvent({
          level: 'warn',
          surface: 'planner-url',
          message: 'invalid_param',
          context: { action: 'invalid_param', detail },
        });
      }
      if (parsed.view !== activeView.value) activeView.value = parsed.view;
      if (parsed.ymd !== toDateInputValue(referenceDate.value)) {
        referenceDate.value = parseLocalDate(parsed.ymd);
      }
    },
    { immediate: true }
  );

  watch([activeView, referenceDate], () => {
    const push = pushNext;
    pushNext = false;
    if (route.name !== 'Activities') return;
    const next = toPlannerQuery(activeView.value, referenceDate.value);
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
