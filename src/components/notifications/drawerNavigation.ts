/**
 * Navigating out of the notifications drawer.
 *
 * Closing the drawer pops its history marker with `history.back()` (`useBackGestureClose`),
 * which is asynchronous. vue-router sees that popstate as a navigation of its own: it cancels a
 * `router.push` still in flight (and `push` reports the cancellation as a RESOLVED
 * NavigationFailure, so unhandled it reads as "tapping Open does nothing"), and a push that
 * finished first could be walked back by the late pop.
 *
 * So the order is fixed by the event, not by a timer: wait for the marker's popstate (bounded,
 * for a drawer that pushed no marker), then push. A push that is still cancelled is tried once
 * more, but only while the user is still where they were. Every outcome is logged, so a real
 * guard rejection is identifiable from CloudWatch.
 */
import {
  isNavigationFailure,
  NavigationFailureType,
  type RouteLocationRaw,
  type Router,
} from 'vue-router';
import { logEvent } from '@/services/telemetry/logEvent';

/** The longest the push waits for the drawer's history pop before going ahead anyway. */
const POP_WAIT_MS = 250;
/** The pause before the one retry of a cancelled push. */
const RETRY_AFTER_MS = 400;

/** Resolves on the next popstate (the drawer's marker leaving), or after `POP_WAIT_MS`. */
function drawerPopSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener('popstate', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, POP_WAIT_MS);
    window.addEventListener('popstate', done, { once: true });
  });
}

/**
 * Call right after closing the drawer. `name` labels the caller in telemetry: the events carry
 * `action: <name>_nav_cancelled` (a retry followed) and `<name>_nav_failed` (it did not land).
 */
export async function pushFromDrawer(
  router: Router,
  target: RouteLocationRaw,
  name: string
): Promise<void> {
  // A throw from `push` itself (a target the router cannot resolve) is a failure like any other.
  const attempt = async (): Promise<unknown> => {
    try {
      return await router.push(target);
    } catch (e) {
      return e ?? new Error('navigation failed');
    }
  };
  const log = (level: 'warn' | 'error', outcome: string, failure: unknown): void =>
    logEvent({
      level,
      surface: 'notifications',
      message: `drawer navigation ${outcome}`,
      context: { action: `${name}_nav_${outcome}`, detail: String(failure).slice(0, 120) },
    });

  await drawerPopSettled();
  const from = router.currentRoute.value.fullPath;
  const failure = await attempt();
  // Already on the target: nothing to do, and nothing went wrong.
  if (!failure || isNavigationFailure(failure, NavigationFailureType.duplicated)) return;
  log('warn', 'cancelled', failure);
  await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
  // The user moved on meanwhile (or the navigation landed after all): do not pull them back.
  if (router.currentRoute.value.fullPath !== from) return;
  const again = await attempt();
  if (again && !isNavigationFailure(again, NavigationFailureType.duplicated)) {
    log('error', 'failed', again);
  }
}
