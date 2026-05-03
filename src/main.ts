import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { initAnalytics } from './services/analytics/plausible';
import { reportError } from './utils/errorReporter';
import { hardReload, isChunkLoadError } from './utils/hardReload';
import './style.css';

const CHUNK_RELOAD_FLAG = 'chunkReloadAttempted';

initAnalytics();

const app = createApp(App);

// Install plugins
app.use(createPinia());
app.use(router);

// ─── Global error reporting (Layers B + C from the plan) ─────────────────────
// Layer A — error toasts auto-report via the `useToast` wrapper. These two
// layers cover everything else: Vue render exceptions and unhandled JS errors.
// All three layers route through the same `reportError` utility, which owns
// dedup, allowlist enforcement, and the Slack POST.

// Vue render / lifecycle errors
app.config.errorHandler = (err, instance, info) => {
  reportError({
    surface: 'vue-render',
    message: err instanceof Error ? err.message : String(err),
    error: err,
    context: {
      vue_info: info,
      component: (instance as { $options?: { __name?: string } } | null)?.$options?.__name ?? null,
    },
  });
  // Preserve the existing console error trail for devs.
  console.error('[vue]', err, info);
};

// Synchronous JS errors that escape the call stack
window.addEventListener('error', (event) => {
  reportError({
    surface: 'unhandled-error',
    message: event.message || 'Uncaught error',
    error: event.error,
  });
});

// Unhandled promise rejections (the dominant source of "where did this come from?" errors)
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  // Stale-chunk failures self-heal via `router.onError` + `vite:preloadError`
  // below — surface them to console for devs but skip the Slack reporter.
  if (isChunkLoadError(reason)) {
    console.warn('[main] chunk load failure — recovering via hardReload:', reason);
    return;
  }
  reportError({
    surface: 'unhandled-promise-rejection',
    message: reason instanceof Error ? reason.message : String(reason),
    error: reason instanceof Error ? reason : undefined,
  });
});

// Vite emits `vite:preloadError` when a `<link rel="modulepreload">` fails —
// same root cause as `router.onError`'s chunk-load failures (stale precached
// index.html points at rotated hashed filenames after a deploy), but a
// different code path that doesn't go through the router. `event.preventDefault()`
// tells Vite we're handling the recovery; `hardReload()` evicts the SW
// precache and replaces the URL.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1') return;
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
  void hardReload();
});

// E2E data bridge (dev-only, tree-shaken from production)
if (import.meta.env.DEV) {
  import('./services/e2e/dataBridge').then((m) => m.initDataBridge());
}

// Mount app
app.mount('#app');
