import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from '@/services/sync/capabilities';

/**
 * Native (Capacitor) shell wiring — ADR-029 A5. The single home for runtime
 * native-shell concerns (splash hide, edge-to-edge status bar, the
 * `viewport-fit=cover` opt-in that powers safe-area insets, Android hardware
 * back-button), called once from `App.vue` setup. The `@capacitor/splash-screen`,
 * `@capacitor/status-bar`, and `@capacitor/app` `backButton`/`exitApp` plugin
 * usage is confined to this module. No-op on web.
 *
 * The CSS that consumes those insets (`padding: env(safe-area-inset-*)`) lives in
 * the layout (App.vue content column, MobileBottomNav); app icons / splash
 * artwork (static assets) are out of scope here.
 */

let initialized = false;
let themeObserver: MutationObserver | null = null;

/**
 * Status-bar ICON contrast, tracking the theme. We do NOT paint the bar a
 * colour: the app targets Android 16 (SDK 36), where edge-to-edge is enforced
 * and `setBackgroundColor` is a deprecated no-op — so instead we go edge-to-edge
 * (see `useNativeShell`), let the page background paint behind a transparent bar
 * (the root `bg-gray-50 dark:bg-slate-900` blends + tracks the theme for free),
 * and only set icon contrast here. Capacitor `Style`: Light = dark icons (light
 * background), Dark = light icons (dark background). Keyed off the same `dark`
 * class the settings store toggles.
 */
function applyStatusBarStyle(): void {
  const isDark = document.documentElement.classList.contains('dark');
  void StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
}

export function useNativeShell(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  // Reveal the web shell — hide the native splash now that App.vue is mounting.
  void SplashScreen.hide().catch(() => {});

  // Enable `env(safe-area-inset-*)` for the edge-to-edge layout — set ONLY on
  // native so the PWA/web viewport (and its current insets) are untouched. The
  // App.vue layout reads these insets (top: status bar; bottom: nav bar) so
  // content clears the system bars.
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && !viewport.getAttribute('content')?.includes('viewport-fit')) {
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  }

  // Go edge-to-edge: the WebView draws under a transparent status bar so the page
  // background blends through it (matching the PWA), instead of the system's
  // black bar / translucent scrim. Mandatory on Android 16 (SDK 36) anyway, where
  // a painted bar is impossible — this removes the default scrim. One-time.
  void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});

  // Icon contrast, now and on every light/dark switch. The settings store toggles
  // the `dark` class on <html>; observing that class keeps all StatusBar plugin
  // usage inside this module (mirrors useChartScale, which observes
  // `data-text-size` mutations) rather than coupling the store to Capacitor.
  applyStatusBarStyle();
  themeObserver = new MutationObserver(() => applyStatusBarStyle());
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Android hardware/gesture back. Deliberately thin: it cooperates with the
  // existing overlay-close mechanism rather than adding a second one.
  // `useBackGestureClose` pushes a history entry when an overlay opens, so
  // `canGoBack` is true whenever there's an open overlay OR route history —
  // `history.back()` then triggers that composable's `popstate` handler (closes
  // the overlay) or the SPA route-back. Only at the true root (nothing to go
  // back to) do we exit the app. No duplicate per-overlay close logic here.
  void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void CapacitorApp.exitApp();
    }
  });
}

/** Test-only — reset the singleton guard between cases. */
export function __resetNativeShellForTesting(): void {
  initialized = false;
  themeObserver?.disconnect();
  themeObserver = null;
}
