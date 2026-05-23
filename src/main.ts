import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { initAnalytics } from './services/analytics/plausible';
import { isNative } from './services/sync/capabilities';
import { reportError } from './utils/errorReporter';
import { hardReload, isChunkLoadError, CHUNK_RELOAD_FLAG } from './utils/hardReload';
import { isIdbTransientError } from './utils/idbTransient';
import './style.css';

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
  // iOS WebKit's "internal error" IDB transient — call sites that matter
  // wrap with `withIdbRetry`, but anything that slips past a catch should
  // not pollute #beanies-errors with a non-actionable browser-platform
  // signal. Same shape as the `isChunkLoadError` suppression above.
  if (isIdbTransientError(reason)) {
    console.warn('[main] IDB transient — call-site retry should handle, leaving alone:', reason);
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

// Mount app. On native, first install the passkey shim so the app's existing
// WebAuthn calls (navigator.credentials.create/get + window.PublicKeyCredential)
// route to the native Android Credential Manager / iOS ASAuthorization instead of
// the WebView's own WebAuthn (which dead-ended — FOR_APP errored, FOR_BROWSER
// crashed; see ADR-029). PRF round-trips on Android (Credential Manager + Google
// Password Manager), keeping the local family-key unwrap intact. The shim is
// native-only (dynamic import gated on isNative), so web/PWA use the real browser
// WebAuthn untouched. Origin/domains come from capacitor.config. A failed install
// is non-fatal — biometric just falls back to password.
async function bootstrap(): Promise<void> {
  if (isNative()) {
    try {
      const { CapacitorPasskey } = await import('@capgo/capacitor-passkey');
      await CapacitorPasskey.autoShimWebAuthn();
    } catch (e) {
      console.warn('[main] native passkey shim init failed; biometric → password fallback', e);
      reportError({
        surface: 'passkey-shim-init',
        message: 'native passkey shim install failed',
        error: e,
        severity: 'warning',
      });
    }
  }
  app.mount('#app');
}

void bootstrap();
