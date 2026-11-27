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
 * more, but only while nobody has navigated anywhere else. Every outcome is logged (success
 * too, so the failure RATE is measurable), with the failure's kind, so a real guard rejection
 * is identifiable from CloudWatch.
 *
 * Known limit: a pop that lands later than `POP_WAIT_MS` (a very slow device) can still walk a
 * finished push back. The bound is short because a drawer with no marker never pops.
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

/** What a failed push was, for telemetry: vue-router's failures carry no message in production. */
function failureKind(failure: unknown): string {
  if (isNavigationFailure(failure, NavigationFailureType.aborted)) return 'aborted';
  if (isNavigationFailure(failure, NavigationFailureType.cancelled)) return 'cancelled';
  return 'error';
}

/** One run at a time: a second tap while the first is still navigating joins it. */
let inFlight: Promise<void> | null = null;

/**
 * Call right after closing the drawer. `name` labels the caller in telemetry: the events carry
 * `action: <name>_nav_ok` (it landed; `detail` says whether a retry was needed),
 * `<name>_nav_cancelled` (a retry may follow) and `<name>_nav_failed` (it did not land).
 */
export function pushFromDrawer(
  router: Router,
  target: RouteLocationRaw,
  name: string
): Promise<void> {
  inFlight ??= run(router, target, name).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(router: Router, target: RouteLocationRaw, name: string): Promise<void> {
  // A throw from `push` itself (a target the router cannot resolve) is a failure like any other.
  const attempt = async (): Promise<unknown> => {
    try {
      return await router.push(target);
    } catch (e) {
      return e ?? new Error('navigation failed');
    }
  };
  const landed = (failure: unknown): boolean =>
    !failure || isNavigationFailure(failure, NavigationFailureType.duplicated);
  const log = (level: 'info' | 'warn' | 'error', outcome: string, detail: string): void =>
    logEvent({
      level,
      surface: 'notifications',
      message: `drawer navigation ${outcome}`,
      context: { action: `${name}_nav_${outcome}`, detail: detail.slice(0, 120) },
    });

  await drawerPopSettled();
  const from = router.currentRoute.value.fullPath;
  const failure = await attempt();
  if (landed(failure)) return log('info', 'ok', 'first');
  log('warn', 'cancelled', `${failureKind(failure)}: ${String(failure)}`);

  // Watch for anyone else navigating during the pause: the person tapped somewhere else, and a
  // retry would pull them back (a pending navigation has not changed the route yet).
  let others = 0;
  const stopWatching = router.beforeEach(() => {
    others++;
  });
  await new Promise((r) => setTimeout(r, RETRY_AFTER_MS));
  stopWatching();
  if (others > 0 || router.currentRoute.value.fullPath !== from) return;

  const again = await attempt();
  if (landed(again)) return log('info', 'ok', 'retry');
  log('error', 'failed', `${failureKind(again)}: ${String(again)}`);
}
