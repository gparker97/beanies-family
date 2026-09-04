import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { initAnalytics } from './services/analytics/plausible';
import { reportError } from './utils/errorReporter';
import { hardReload, isChunkLoadError, CHUNK_RELOAD_FLAG } from './utils/hardReload';
import { isIdbTransientError } from './utils/idbTransient';
import { isBenignBrowserError } from './utils/benignBrowserError';
import { bootstrapDocClient } from './services/automerge/worker/bootstrap';
import { applyOrientationPolicy } from './composables/useWallOrientation';
import './style.css';

initAnalytics();

// ADR-032: wire the doc worker / inline fallback before anything touches the
// data layer (docClient lazily spawns the worker on first use, or runs inline
// when the docWorker flag is off / the worker can't spawn).
bootstrapDocClient();

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
    // A Vue render/lifecycle throw breaks the UI (blank/broken component) — fatal.
    severity: 'critical',
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
  // Benign browser-platform signals (e.g. the ResizeObserver "loop" notification)
  // are not app faults and carry no user impact — surface to console for devs but
  // skip the Slack reporter. Same allowlist discipline as the `isChunkLoadError` /
  // `isIdbTransientError` guards on the `unhandledrejection` handler below. The
  // signal lives in `event.message` (ResizeObserver's `event.error` is often null).
  if (isBenignBrowserError(event.message)) {
    console.warn('[main] benign browser signal — not reporting:', event.message);
    return;
  }
  reportError({
    surface: 'unhandled-error',
    // An uncaught synchronous error escaped every call-site catch — fatal.
    severity: 'critical',
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
  // iOS WebKit's "internal error" IDB transient — call sites that matter
  // wrap with `withIdbRetry`, but anything that slips past a catch should
  // not pollute #beanies-errors with a non-actionable browser-platform
  // signal. Same shape as the `isChunkLoadError` suppression above.
  if (isIdbTransientError(reason)) {
    console.warn('[main] IDB transient — call-site retry should handle, leaving alone:', reason);
    return;
  }
  // Deliberately NON-paging (no `severity: 'critical'`): unhandled rejections
  // are background-prone and the dominant historical noise source. They're
  // captured in telemetry + console; a genuinely-fatal async failure should be
  // caught at its call site and reported `critical` there, not rely on this
  // catch-all. The two allowlists above keep known browser transients out.
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
//
// MUST use the same counter-style logic as App.vue + router.onError —
// previously this used `=== '1'` / `set '1'`, which actively RESET the
// shared retry counter on every fire. With the dynamic import's rejection
// also routing through App.vue's catch (which increments), the counter
// cycled 1→2→reset to 1→2 indefinitely and never tripped the "exhausted"
// branch — so the loop ran for minutes with no `app.chunkRecoveryFailed`
// alert (greg's iPhone, 2026-05-13).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const attempts = parseInt(sessionStorage.getItem(CHUNK_RELOAD_FLAG) ?? '0', 10) || 0;
  if (attempts >= 3) return;
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(attempts + 1));
  void hardReload();
});

// E2E data bridge (dev-only, tree-shaken from production)
if (import.meta.env.DEV) {
  import('./services/e2e/dataBridge').then((m) => m.initDataBridge());
}

// Native biometric no longer shims WebAuthn — it uses the hardware Keystore via the
// `BiometricKeystore` Capacitor plugin (registered natively; see nativeBiometric.ts,
// ADR-029 2026-07-14). Nothing to install at boot; web/PWA use the real browser
// WebAuthn untouched.
// Orientation policy: portrait on a phone (the installed PWA manifest says
// `portrait`, which overrides the OS rotation lock — that is deliberate), free
// rotation on a tablet, where landscape is arguably the better way to hold the
// app. The manifest is one static file and cannot vary by device, so the tablet
// half has to be done here. Guarded internally; orientation is a nice-to-have.
applyOrientationPolicy();

app.mount('#app');
