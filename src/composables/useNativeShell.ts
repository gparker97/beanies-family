import { App as CapacitorApp } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from '@/services/sync/capabilities';

/**
 * Custom Android-only plugin (#53): paints the Activity window background so the
 * edge-to-edge status-bar / notch strip matches the IN-APP theme, not the OS
 * DayNight resource. Unimplemented on iOS/web → the `.catch` at the call site
 * swallows the rejection. Native impl: `WindowBackgroundPlugin.java`.
 */
interface WindowBackgroundPlugin {
  setColor(options: { color: string }): Promise<void>;
}
const WindowBackground = registerPlugin<WindowBackgroundPlugin>('WindowBackground');

// #53 keep-in-sync: these MUST equal the App.vue root `bg-gray-50` / `dark:bg-slate-900`
// and the native android .../colors.xml `windowBackground` (Tailwind gray-50 / slate-900).
const APP_BG_LIGHT = '#F9FAFB';
const APP_BG_DARK = '#0F172A';

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
 * Native theme application, tracking the in-app `dark` class. Two parts:
 *  1. Status-bar ICON contrast (`StatusBar.setStyle`) — Light = dark icons (light
 *     background), Dark = light icons (dark background).
 *  2. #53: the Activity window background (`WindowBackground.setColor`, Android-only)
 *     so the edge-to-edge status-bar / notch strip shows the IN-APP theme colour
 *     even when it diverges from the OS DayNight setting (the static
 *     values-night/colors.xml default only follows the OS). Without this the strip
 *     and the WebView content could show two different colours (a seam).
 * Both keyed off the same `dark` class the settings store toggles, so icon contrast
 * and strip colour always agree.
 */
function applyNativeTheme(): void {
  const isDark = document.documentElement.classList.contains('dark');
  void StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
  void WindowBackground.setColor({ color: isDark ? APP_BG_DARK : APP_BG_LIGHT }).catch(() => {});
}

export function useNativeShell(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  // Reveal the web shell — hide the native splash now that App.vue is mounting.
  void SplashScreen.hide().catch(() => {});

  // `env(safe-area-inset-*)` is powered by `viewport-fit=cover`, which is now set
  // STATICALLY in index.html — iOS WKWebView computes safe-area insets at page
  // load and does NOT recompute them when the viewport meta is changed afterward,
  // so injecting it here left every inset at 0 and put top controls under the
  // status bar on the first native iOS build (build 9). This runtime set is kept
  // only as a harmless fallback (the guard makes it a no-op once the static meta
  // is present) for any build/environment where the static meta is stripped.
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
  applyNativeTheme();
  themeObserver = new MutationObserver(() => applyNativeTheme());
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
