/**
 * The App.vue init watchdog: the last resort against a silent "counting beans" wedge.
 *
 * Armed at mount. If the shell has not become visible within `firstMs`, it paints the
 * existing recovery overlay (via `onFire`) and reports at `'error'`: a slow first load on a
 * contended device is common and usually finishes on its own, so the first firing never pages.
 * It then waits `followUpMs` more on the SAME timer handle and pages `critical` only when init
 * has still not settled.
 *
 * Both arms count VISIBLE time only (a hidden tab or a sleeping laptop is not a stall): an arm
 * whose window saw the page hidden re-arms for a fresh full window instead of acting.
 * `wasHiddenSince` stays true forever once the page hid after its argument, so each re-arm
 * resets `armedAt`. Re-arms are capped per arm
 * (`MAX_HIDDEN_REARMS`); after the cap the arm acts as if visible, so a real wedge in a tab that
 * keeps flickering still surfaces.
 *
 * Lifecycle, owned by App.vue's root `onMounted`:
 *  - `clear()` where the shell becomes visible; the data-load timeout owns the rest. Also called
 *    from the `finally`, so an early return or a thrown init stops both arms.
 *  - `settle()` when init has actually completed, on EVERY non-throwing exit: after
 *    `loadFamilyData` (before the health check can paint its own overlay) and again from the
 *    `finally` unless the body threw, which covers the early returns (`/welcome`, resume-setup).
 *    Idempotent, so the second call is a no-op. It stops any pending arm itself, so it does not
 *    depend on `clear()` having run first. If the watchdog had already fired, the overlay
 *    it painted is cleared through `onLateSettle` and a `'completed after watchdog'` warn
 *    records how late init landed (the false-alarm rate).
 *
 * ⚠️ `clear()` NEVER SETTLES. It also runs from the `finally` after a THROWN init, whose catch
 * has just painted the real failure; a settling `clear()` would wipe that overlay and log a
 * false completion.
 *
 * ⚠️ `initSettled` IS THE ONLY "DID INIT FINISH" FACT. `onFire` flips App.vue's
 * `isInitializing` / `isLoadingData` to false itself, so after a firing those refs say nothing
 * about whether init completed. The follow-up must never read them.
 *
 * ⚠️ ONE TIMER HANDLE. The follow-up reassigns `watchdogTimer`; a second handle would be a
 * second thing every exit path has to remember to clear.
 *
 * Extracted from App.vue (2026-10-15) so the two-arm timing is unit-testable without mounting
 * the root component.
 */

import { logEvent } from '@/services/telemetry/logEvent';
import { breadcrumbsForReport } from '@/utils/diagnosticContext';
import { reportError } from '@/utils/errorReporter';
import {
  ensureVisibilityTracking,
  getHiddenDurationMs,
  wasHiddenSince,
} from '@/utils/visibilityTracker';

const SURFACE = 'app.onboardingStallTimeout';
/** Hidden-window re-arms allowed per arm before it acts as if the page had stayed visible. */
const MAX_HIDDEN_REARMS = 3;

export interface InitWatchdogOptions {
  /** ms from arming to the first (non-paging) firing. */
  firstMs: number;
  /** ms from the first firing to the critical re-check. */
  followUpMs: number;
  /** The live init breadcrumb trail (read at fire time; redacted before it ships). */
  breadcrumbs: () => readonly string[];
  /** The current route path (`path`, never `fullPath`: a shared recipe rides in the hash). */
  routePath: () => string;
  /** True while a chunk-load hardReload is swapping the page: neither arm acts. */
  isStandingDown: () => boolean;
  /** Paint the recovery overlay and dismiss the init spinners. */
  onFire: () => void;
  /** Clear the overlay `onFire` painted, after init completed late. */
  onLateSettle: () => void;
}

export interface InitWatchdog {
  /** Stop whichever arm is pending. Idempotent. */
  clear: () => void;
  /** Init completed. Clears a stale overlay when the watchdog had already fired. Idempotent. */
  settle: () => void;
}

export function useInitWatchdog(options: InitWatchdogOptions): InitWatchdog {
  // `mountedAt` dates the whole stall (every reported duration); `armedAt` opens the current
  // visible window and moves on each re-arm.
  const mountedAt = Date.now();
  let armedAt = mountedAt;
  // One record per arm: its window, its handler and its own re-arm count.
  interface Arm {
    readonly ms: number;
    readonly fire: () => void;
    readonly action: 'rearmed-hidden' | 'rearmed-hidden-follow-up';
    hiddenRearms: number;
  }
  const firstArm: Arm = {
    ms: options.firstMs,
    fire: firstFiring,
    action: 'rearmed-hidden',
    hiddenRearms: 0,
  };
  const followUpArm: Arm = {
    ms: options.followUpMs,
    fire: followUp,
    action: 'rearmed-hidden-follow-up',
    hiddenRearms: 0,
  };
  ensureVisibilityTracking();

  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogFired = false;
  let initSettled = false;

  function stallContext(): Record<string, unknown> {
    const crumbs = [...options.breadcrumbs()];
    const last = crumbs[crumbs.length - 1];
    return {
      // The `auth:` crumb embeds an email, so the single-crumb stage goes through the same
      // redaction as the trail.
      stage: last === undefined ? null : breadcrumbsForReport([last]),
      breadcrumbs: breadcrumbsForReport(crumbs),
      visibility_state: typeof document === 'undefined' ? null : document.visibilityState,
      page_hidden_for_ms: getHiddenDurationMs(),
      perf_duration_ms: Date.now() - mountedAt,
      route_path: options.routePath(),
    };
  }

  /**
   * True (and the arm re-scheduled for a fresh window) when the page was hidden during the
   * current window and the arm still has re-arms left.
   */
  function rearmedForHidden(arm: Arm): boolean {
    if (arm.hiddenRearms >= MAX_HIDDEN_REARMS || !wasHiddenSince(armedAt)) return false;
    arm.hiddenRearms++;
    armedAt = Date.now();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'page was hidden during the watchdog window; re-armed',
      context: {
        action: arm.action,
        perf_duration_ms: armedAt - mountedAt,
        page_hidden_for_ms: getHiddenDurationMs(),
      },
    });
    watchdogTimer = setTimeout(arm.fire, arm.ms);
    return true;
  }

  function followUp(): void {
    watchdogTimer = null;
    if (initSettled || options.isStandingDown()) return;
    if (rearmedForHidden(followUpArm)) return;
    reportError({
      surface: SURFACE,
      severity: 'critical',
      message: `App init still stalled ${options.followUpMs / 1000}s after watchdog`,
      context: stallContext(),
    });
  }

  function firstFiring(): void {
    watchdogTimer = null;
    if (options.isStandingDown()) return;
    if (rearmedForHidden(firstArm)) return;
    watchdogFired = true;
    console.error('[App] init watchdog fired: setup stalled; surfacing recovery overlay');
    options.onFire();
    reportError({
      surface: SURFACE,
      severity: 'error',
      message: `App init stalled, watchdog fired after ${options.firstMs}ms`,
      context: stallContext(),
    });
    // The follow-up's window opens now.
    armedAt = Date.now();
    watchdogTimer = setTimeout(followUp, options.followUpMs);
  }

  function clearTimer(): void {
    if (watchdogTimer !== null) clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  watchdogTimer = setTimeout(firstFiring, options.firstMs);

  return {
    clear: clearTimer,
    settle() {
      if (initSettled) return;
      initSettled = true;
      // Settled init needs neither arm, whether or not `clear()` ran first.
      clearTimer();
      if (!watchdogFired) return;
      options.onLateSettle();
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'completed after watchdog',
        context: { perf_duration_ms: Date.now() - mountedAt },
      });
    },
  };
}
