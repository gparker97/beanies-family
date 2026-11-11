import { watch, onScopeDispose, effectScope, type EffectScope } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import router from '@/router';
import { usePollWhileVisible } from './usePollWhileVisible';
import { safeServiceWorkerUpdate } from '@/utils/safeServiceWorkerUpdate';
import { hardReload } from '@/utils/hardReload';
import { appQuietBlocker, isAppQuiet } from '@/utils/appQuiet';
import { getBuildSha } from '@/utils/diagnosticContext';
import { setNewerFileHandler, setPreAuthIdleHandler } from '@/utils/appUpdateSignals';
import { isForceInFlight, reconcileForcedRecord } from '@/utils/forcedUpdate';
import {
  currentUpdateScreen,
  errorName,
  logDeferred,
  logUpdaterEvent,
  runUpdateCheck,
  setSwPathHooks,
  sha7,
  type UpdateTrigger,
} from '@/utils/webUpdate';

/**
 * PWA auto-updater. Detects a new service worker and applies it automatically
 * as soon as the app is in a SAFE (quiet) state — no "update available?"
 * prompt. After the reload, `App.vue` shows a one-time confirmation toast
 * (gated on `PWA_POST_UPDATE_ROUTE_KEY`).
 *
 * INVARIANTS (load-bearing — read before changing update behavior):
 *  1. Auto-apply is driven HERE, NOT via `registerType: 'autoUpdate'`. See
 *     `vite.config.ts:52` for why `skipWaiting`/`clientsClaim` stay OFF
 *     (they caused a multi-minute chunk-load loop on iPhone Safari). We keep
 *     `registerType: 'prompt'` and call the update ourselves on a quiet moment.
 *  2. This composable owns the SW update poll — via `usePollWhileVisible`
 *     (which reads `useToday().isVisible`, the app's single `visibilitychange`
 *     sink). It registers NO `visibilitychange` / `setInterval` of its own.
 *  3. Singleton: `useRegisterSW` must run exactly once. Mirrors
 *     `useStaleTabRefresh` (module guard + detached `effectScope`).
 *  4. The SW route can stall (a long precache install inside short visits, or a
 *     screen that never counts as quiet), so the same poll also asks
 *     `webUpdate.runUpdateCheck`, which compares this build with `/version.json`
 *     and, when behind, forces the update under `updatePolicy.decideForce`. This
 *     file is WIRING ONLY: the decision and the reload live in those modules.
 *     Telemetry surface `pwa-updater` (found / installed / applying / applied /
 *     deferred / checked / forced / ...).
 */

const POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * sessionStorage key written before an update reload. Carries TWO meanings:
 * (a) the route to resume after reload, and (b) "this reload was an applied
 * update" — the trigger for the post-update toast in `App.vue`. Do NOT write
 * it for any non-update reason, or `App.vue` will fire a false "updated!" toast.
 */
export const PWA_POST_UPDATE_ROUTE_KEY = 'pwa-post-update-route';

let initialized = false;
let scope: EffectScope | null = null;
let applying = false;
let removeRouteGuard: (() => void) | null = null;
let removeNavCheck: (() => void) | null = null;
/**
 * A newer-version file makes the update URGENT (it waives the idle, focus and cap
 * gates), but only for a short window after the file was last seen. Two earlier
 * shapes were both wrong: a flag sticky for the whole page load let a routine poll
 * minutes later reload a different screen mid-typing, and no carry-over at all meant
 * a check that deferred (mid-sync, a modal open) or could not reach `version.json`
 * lost its urgency for good. The window is bound to the screen by time: the dead-end
 * screen keeps re-reading the file (each "Try again" renews it), and it lapses soon
 * after the person moves on.
 */
const NEWER_FILE_URGENCY_MS = 2 * 60_000;
/** A burst of signals (one per read of the file) runs one immediate check. */
const NEWER_FILE_BURST_MS = 5_000;
let newerFileSeenAt = 0;
let newerFileCheckedAt = 0;
/** When a check last answered `current`: the idle edge does not refetch right after. */
let lastCurrentAt = 0;
const IDLE_RECHECK_SKIP_MS = 60_000;

function isNewerFileUrgent(): boolean {
  return newerFileSeenAt > 0 && Date.now() - newerFileSeenAt < NEWER_FILE_URGENCY_MS;
}

/**
 * Run the freshness check and, once this build is known behind, arm one
 * `afterEach` so every later navigation re-asks (a quiet moment after a route
 * change is when the shell can take the reload). Never rejects.
 */
async function checkFreshness(trigger: UpdateTrigger): Promise<void> {
  const result = await runUpdateCheck({ trigger: isNewerFileUrgent() ? 'newer-file' : trigger });
  if (result === 'current') lastCurrentAt = Date.now();
  if (result === 'deferred' || result === 'failed') armNavCheck();
}

function armNavCheck(): void {
  if (removeNavCheck) return;
  removeNavCheck = router.afterEach(() => {
    void checkFreshness('nav');
  });
}

function logSwUpdateFailed(stage: 'poll' | 'apply' | 'hard-reload', e: unknown): void {
  // A transient `sw.js` fetch failure while offline is expected, not news.
  if (stage === 'poll' && typeof navigator !== 'undefined' && navigator.onLine === false) return;
  logUpdaterEvent({
    level: 'warn',
    action: 'sw-update-failed',
    message: 'service worker update failed',
    detail: `stage=${stage}`,
    errorCode: errorName(e),
    error: e,
  });
}

/**
 * Single, race-guarded apply path. Persists the resume route, asks
 * vite-plugin-pwa to activate the waiting SW (which reloads on the new SW's
 * `controllerchange`), with a backstop reload for the rare no-controllerchange
 * case, and a `hardReload()` fallback if the update call itself throws (a
 * plain reload can't escape a stale SW).
 */
async function applyUpdate(
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>,
  path: string
): Promise<void> {
  if (applying) return; // `needRefresh` + a concurrent navigation can both reach here
  // A forced update is already swapping the page: two reload paths must not race.
  if (isForceInFlight()) return;
  applying = true;
  logUpdaterEvent({
    level: 'info',
    action: 'applying',
    message: 'applying waiting service worker',
    detail: 'via=sw',
  });

  try {
    sessionStorage.setItem(PWA_POST_UPDATE_ROUTE_KEY, path);
  } catch (e) {
    // Private mode / quota — degrade gracefully; the reload still applies the
    // update, the user just won't see the post-update toast (and `applied
    // via=sw` will not be logged for this reload).
    console.warn('[pwa] resume route not saved (no post-update toast):', e);
    logUpdaterEvent({
      level: 'warn',
      action: 'resume-key-failed',
      message: 'post-update resume route not saved',
      errorCode: errorName(e),
    });
  }

  try {
    await updateServiceWorker(); // reloadPage defaults true → reload on controllerchange
  } catch (e) {
    console.warn('[pwa] service worker update failed, hard-reloading', e);
    logSwUpdateFailed('apply', e);
    hardReload().catch((err: unknown) => {
      console.error('[pwa] hard reload after a failed SW update could not start:', err);
      logSwUpdateFailed('hard-reload', err);
    });
    return;
  }

  // Backstop: `updateServiceWorker()` reloads when the new SW takes control;
  // if `controllerchange` never fires (rare), force the reload so the update
  // still applies. The first reload to land wins; the other is a no-op.
  setTimeout(() => window.location.reload(), 2000);
}

function installRouteGuard(updateServiceWorker: (reloadPage?: boolean) => Promise<void>): void {
  if (removeRouteGuard) return;
  removeRouteGuard = router.beforeEach((to, _from, next) => {
    const blocker = appQuietBlocker();
    if (blocker !== null) {
      // Mid-edit / mid-save — let the navigation through; the guard stays armed
      // and applies on the next quiet navigation.
      logDeferred(blocker, currentUpdateScreen());
      next();
      return;
    }
    void applyUpdate(updateServiceWorker, to.fullPath);
    next(false); // cancel the SPA nav; the reload (to.fullPath) supersedes it
  });
}

/**
 * Initialize the PWA auto-updater. Call ONCE from `App.vue` setup. Idempotent.
 */
export function usePwaUpdater(): void {
  if (initialized) return;

  // In the native (Capacitor) shell the app is served from bundled local
  // assets, so the web service worker is unnecessary AND its auto-update/reload
  // machinery fights Capacitor's local asset server. `useRegisterSW` (below) is
  // the ONLY service-worker registration path — vite-plugin-pwa injects no
  // registration into index.html (verified) — so returning here keeps the SW
  // unregistered on iOS/Android. Web behavior is unchanged (`isNativePlatform()`
  // is false in a browser). See ADR-029.
  if (Capacitor.isNativePlatform()) return;

  initialized = true;

  // Detached scope so the poll + watcher live for the app lifetime,
  // independent of any caller's component-setup teardown.
  scope = effectScope(true);
  scope.run(() => {
    let swRegistration: ServiceWorkerRegistration | undefined;
    let foundAt: number | null = null;

    // Did a forced reload from the previous page load take? `applied` removes the
    // record; `failed` keeps it, so the once-per-sha guard holds for this tab.
    const forced = reconcileForcedRecord(getBuildSha());
    if (forced?.kind === 'applied') {
      logUpdaterEvent({
        level: 'info',
        action: 'applied',
        message: 'forced update applied',
        detail: `via=forced,from=${sha7(forced.record.from)}`,
        once: false,
      });
    } else if (forced?.kind === 'failed') {
      logUpdaterEvent({
        level: 'warn',
        action: 'force-failed',
        message: 'forced update did not take',
        detail: `to=${sha7(forced.record.to)},from=${sha7(forced.record.from)}`,
        once: false,
      });
    }

    const { needRefresh, updateServiceWorker } = useRegisterSW({
      onRegisteredSW(_swUrl, registration) {
        swRegistration = registration;
        registration?.addEventListener('updatefound', () => {
          // The very first install (no active worker yet) is not an update.
          if (!registration.active) return;
          foundAt = Date.now();
          logUpdaterEvent({
            level: 'info',
            action: 'found',
            message: 'service worker update found',
          });
        });
      },
    });

    // The runner sees the SW path through these hooks (no import of this file).
    setSwPathHooks({
      isApplying: () => applying,
      applyWaitingIfQuiet: () => {
        if (!needRefresh.value || !isAppQuiet()) return false;
        void applyUpdate(updateServiceWorker, router.currentRoute.value.fullPath);
        return true;
      },
    });

    // A newer-version family file: check at once, and keep later checks urgent for
    // `NEWER_FILE_URGENCY_MS` (see the constant for why it is a window, neither a
    // page-load flag nor nothing).
    setNewerFileHandler(() => {
      const now = Date.now();
      newerFileSeenAt = now; // every sighting renews the urgency window
      if (now - newerFileCheckedAt < NEWER_FILE_BURST_MS) return;
      newerFileCheckedAt = now;
      void checkFreshness('newer-file');
    });

    // The login landing just became idle: ask again NOW. The boot-time check runs
    // before auth has initialised (it defers on `auth-init`), so without this a
    // stale tab would wait a full poll interval on the very screen that may reload
    // freely. One same-origin fetch per idle edge; single-flight joins a check that
    // is still running.
    setPreAuthIdleHandler(() => {
      // Not right after a check that said `current`: every return to the landing
      // (back from the picker, closing a dialog) would otherwise cost a fetch.
      if (Date.now() - lastCurrentAt < IDLE_RECHECK_SKIP_MS) return;
      void checkFreshness('nav');
    });

    // Poll for a new SW AND check build freshness while the tab is visible
    // (reuses the single-visibility sink; owns its own cleanup; fires once on
    // mount when visible and on each hidden→visible). Guard on `swRegistration`
    // — set async via the callback above. RETURNS the freshness promise so the
    // poll's `safeRun` reports anything that escapes it.
    usePollWhileVisible(
      () => {
        if (swRegistration) {
          safeServiceWorkerUpdate(swRegistration, 'pwa-updater-poll', (e) =>
            logSwUpdateFailed('poll', e)
          );
        }
        return checkFreshness('visible');
      },
      POLL_INTERVAL_MS,
      { fireImmediatelyOnVisible: true, surface: 'pwa-updater-poll' }
    );

    watch(needRefresh, (ready) => {
      if (!ready) return;
      logUpdaterEvent({
        level: 'info',
        action: 'installed',
        message: 'service worker update installed',
        ...(foundAt !== null ? { durationMs: Date.now() - foundAt } : {}),
      });
      // Arm the guard for the busy-now → quiet-later (next navigation) case.
      installRouteGuard(updateServiceWorker);
      // And apply immediately if we're already quiet.
      const blocker = appQuietBlocker();
      if (blocker === null) {
        void applyUpdate(updateServiceWorker, router.currentRoute.value.fullPath);
      } else {
        logDeferred(blocker, currentUpdateScreen());
      }
    });

    onScopeDispose(() => {
      removeRouteGuard?.();
      removeRouteGuard = null;
      removeNavCheck?.();
      removeNavCheck = null;
      setNewerFileHandler(null);
      setPreAuthIdleHandler(null);
      setSwPathHooks(null);
    });
  });
}

/**
 * Test-only reset hook — stops the scope and clears the singleton/guard state
 * so unit tests can re-initialize between cases. Production code never calls this.
 */
export function __resetPwaUpdaterForTesting(): void {
  scope?.stop();
  scope = null;
  initialized = false;
  applying = false;
  removeRouteGuard?.();
  removeRouteGuard = null;
  removeNavCheck?.();
  removeNavCheck = null;
  newerFileSeenAt = 0;
  newerFileCheckedAt = 0;
  lastCurrentAt = 0;
}
