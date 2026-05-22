import { watch, onScopeDispose, effectScope, type EffectScope } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import router from '@/router';
import { useSyncStore } from '@/stores/syncStore';
import { hasOpenOverlays } from '@/utils/overlayStack';
import { usePollWhileVisible } from './usePollWhileVisible';
import { safeServiceWorkerUpdate } from '@/utils/safeServiceWorkerUpdate';
import { hardReload } from '@/utils/hardReload';

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

/** Quiet = nothing the user would lose if we reload right now. */
function isQuiet(): boolean {
  try {
    return !hasOpenOverlays() && !useSyncStore().isSyncing;
  } catch {
    // Pre-init / store not ready — treat as NOT quiet (defer the reload).
    return false;
  }
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
  applying = true;

  try {
    sessionStorage.setItem(PWA_POST_UPDATE_ROUTE_KEY, path);
  } catch {
    // Private mode / quota — degrade gracefully; the reload still applies the
    // update, the user just won't see the post-update toast.
  }

  try {
    await updateServiceWorker(); // reloadPage defaults true → reload on controllerchange
  } catch (e) {
    console.warn('[pwa] service worker update failed, hard-reloading', e);
    hardReload();
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
    if (!isQuiet()) {
      // Mid-edit / mid-save — let the navigation through; the guard stays armed
      // and applies on the next quiet navigation.
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

    const { needRefresh, updateServiceWorker } = useRegisterSW({
      onRegisteredSW(_swUrl, registration) {
        swRegistration = registration;
      },
    });

    // Poll for a new SW while the tab is visible (reuses the single-visibility
    // sink; owns its own cleanup). Guard on `swRegistration` — set async via
    // the callback above.
    usePollWhileVisible(
      () => {
        if (swRegistration) safeServiceWorkerUpdate(swRegistration, 'pwa-updater-poll');
      },
      POLL_INTERVAL_MS,
      { fireImmediatelyOnVisible: true, surface: 'pwa-updater-poll' }
    );

    watch(needRefresh, (ready) => {
      if (!ready) return;
      // Arm the guard for the busy-now → quiet-later (next navigation) case.
      installRouteGuard(updateServiceWorker);
      // And apply immediately if we're already quiet.
      if (isQuiet()) {
        void applyUpdate(updateServiceWorker, router.currentRoute.value.fullPath);
      }
    });

    onScopeDispose(() => {
      removeRouteGuard?.();
      removeRouteGuard = null;
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
}
