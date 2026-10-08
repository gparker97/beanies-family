import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { captureHashMarkers, APPROVAL_LINK_HASH } from './services/auth/deepLinks';
import App from './App.vue';
import router from './router';
import { initAnalytics } from './services/analytics/plausible';
import { captureAttributionFromUrl } from './utils/attributionStash';
import { installOnboardingAttempt } from './services/telemetry/onboardingAttempt';
import { readInstallReferrerOnce } from './utils/installReferrer';
import { getPlatform } from '@/services/sync/capabilities';
import { reportError } from './utils/errorReporter';
import { isChunkLoadError, startChunkRecovery } from './utils/hardReload';
import { isIdbTransientError } from './utils/idbTransient';
import { isBenignBrowserError } from './utils/benignBrowserError';
import { bootstrapDocClient } from './services/automerge/worker/bootstrap';
import { applyOrientationPolicy } from './composables/useWallOrientation';
import './style.css';

initAnalytics();

// ⚠️ BEFORE `app.use(router)`. The campaign tag (#118) arrives as `utm_*` / ad-id query keys on
// the landing URL, and the router's signed-in / requiresAuth guards and App.vue's boot
// `router.replace` calls all rebuild the URL without them. Reading `location.search` here, while
// it is still the raw landing URL, is the only point that is guaranteed to see the tag. The same
// read also restores it after the web OAuth hop (the return path carries it; see
// `connectStorage.createReturnPath`). Synchronous and never throws; a no-op on native.
//
// The open pod-creation attempt (#128) is hydrated just before it, so every event from here on
// (the attribution capture's included) carries its `create_attempt_id`. Synchronous and never
// throws (localStorage via `storedJson`); it also drops a stale attempt and registers the
// pre-beacon pagehide hook that records an abandon.
installOnboardingAttempt();
captureAttributionFromUrl();
// Android only: the Play install referrer is the native install's campaign tag (one-shot).
if (getPlatform() === 'android') void readInstallReferrerOnce();

// ADR-032: wire the doc worker / inline fallback before anything touches the
// data layer (docClient lazily spawns the worker on first use, or runs inline
// when the docWorker flag is off / the worker can't spawn).
bootstrapDocClient();

// ⚠️ BEFORE `app.mount()` AND BEFORE THE ROUTER RUNS. An approval link targets `/welcome`,
// and the person scanning it is signed in — so `router.beforeEach` redirects them to the
// Nook by name, which drops the fragment. This is the only point guaranteed to be ahead of
// that. Synchronous and dependency-free, so it cannot wedge startup.
//
// ⚠️⚠️ THE PATH CHECK IS A SECURITY BOUNDARY, NOT TIDINESS. Without it this captured an
// approval marker from ANY url — `/nook#beanies-approve=<attacker key>` included. The
// sheet then opened behind the opaque init overlay, and because `canApprove` is a computed
// that re-evaluates when the family key lands, it silently became a LIVE
// fingerprint-compare panel the moment the pod opened. That shipped in 0.21.3.
//
// Exact match, mirroring `inboundLinkBridge`'s allowlist. `/welcome` is the only path an
// approval link is ever built for (`DeviceApprovalRequest`), so anything else is either a
// mistake or an attack, and both should be dropped on the floor.
const approvalPath = window.location.pathname.replace(/\/$/, '') || '/';
if (approvalPath === '/welcome') {
  captureHashMarkers([APPROVAL_LINK_HASH]);
}

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
// MUST spend the same shared budget as App.vue + router.onError —
// previously this used `=== '1'` / `set '1'`, which actively RESET the
// shared retry counter on every fire. With the dynamic import's rejection
// also routing through App.vue's catch (which increments), the counter
// cycled 1→2→reset to 1→2 indefinitely and never tripped the "exhausted"
// branch — so the loop ran for minutes with no `app.chunkRecoveryFailed`
// alert (greg's iPhone, 2026-05-13).
//
// `startChunkRecovery`, not `tryRecoverChunkLoad`: the event itself is the
// chunk-failure signal, and its payload can be Vite's "Unable to preload CSS for
// <dep>" error, which `isChunkLoadError` does not match. Classifying it would
// stop recovering CSS-preload failures.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  startChunkRecovery(event.payload);
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
