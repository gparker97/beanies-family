/**
 * App-level toast for an unhealthy view-only calendar (plan 2026-11-17).
 *
 * `calendarViewStore` reports the unhealthy kinds present right now
 * (`unhealthyStates`: `unavailable` when sharing stopped or the calendar is gone,
 * `needs_reconnect` when the view account needs a new sign-in). This composable
 * turns them into ONE toast per session per kind, with an action that opens the
 * calendar settings drawer.
 *
 * It lives in the view layer because it navigates: the store must have no path
 * to the router, since the doc worker bundle reaches the store's import graph
 * and the router pulls in every page.
 *
 * Rules:
 *  - never on the wall (an unattended, locked tablet cannot act on a toast); a
 *    kind first seen there toasts once the member is on another route;
 *  - nothing until the router's first navigation has resolved, so a cold load of
 *    the wall is not mistaken for another route;
 *  - "session" ends when the store is torn down (`stop()` on sign-out / family
 *    switch resets `standingSettled`), so the next session toasts afresh;
 *  - zero-cost when the feature is off: this composable returns before it touches
 *    the store. (Other readers, such as search and the widget snapshot, do
 *    instantiate it; with the flag off it stays inert: no poll, no Google read, no
 *    doc write.)
 */
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isFlagEnabled } from '@/config/flags';
import { useCalendarViewStore, type UnhealthyState } from '@/stores/calendarViewStore';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';
import type { UIStringKey } from '@/services/translation/uiStrings';

const WALL_ROUTE_NAME = 'BeanieWall';
const TOAST_DURATION_MS = 8000;

const TOASTS: ReadonlyArray<readonly [UnhealthyState, UIStringKey, UIStringKey]> = [
  ['unavailable', 'calendarView.toast.unavailable.title', 'calendarView.toast.unavailable.message'],
  [
    'needs_reconnect',
    'calendarView.toast.needsReconnect.title',
    'calendarView.toast.needsReconnect.message',
  ],
];

export function useCalendarViewHealthToast(): void {
  if (!isFlagEnabled('viewOnlyCalendars')) return;

  const store = useCalendarViewStore();
  const route = useRoute();
  const router = useRouter();
  const { t } = useTranslation();

  /** Unhealthy kinds already toasted this session. */
  const toasted = new Set<UnhealthyState>();
  const routerReady = ref(false);

  router.isReady().then(
    () => {
      routerReady.value = true;
    },
    (err: unknown) => {
      // The first navigation failed; the app shows its own error. Toast anyway once
      // a later navigation lands (the route watcher below re-checks).
      routerReady.value = true;
      reportError({
        surface: 'calendar-view',
        severity: 'warning',
        message: 'calendar view health toast: initial navigation failed',
        error: err,
      });
    }
  );

  function openCalendarSettings(): void {
    router.push({ path: '/settings', query: { open: CALENDAR_SYNC_OPEN } }).catch((err) =>
      reportError({
        surface: 'calendar-view',
        severity: 'warning',
        message: 'calendar view health toast: could not open calendar settings',
        error: err,
        context: { action: 'open-settings' },
      })
    );
  }

  watch(
    [() => store.unhealthyStates, routerReady, () => route.name] as const,
    ([present, ready, name]) => {
      if (!ready || name === WALL_ROUTE_NAME) return;
      for (const [state, title, message] of TOASTS) {
        if (!present.has(state) || toasted.has(state)) continue;
        toasted.add(state);
        showToast('warning', t(title), t(message), {
          actionLabel: t('calendarView.toast.openSettings'),
          actionFn: openCalendarSettings,
          durationMs: TOAST_DURATION_MS,
        });
      }
    },
    { immediate: true }
  );

  // A new session (sign-out / family switch tears the store down) toasts afresh.
  watch(
    () => store.standingSettled,
    (settled, was) => {
      if (was && !settled) toasted.clear();
    }
  );
}
