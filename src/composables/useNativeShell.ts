import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from '@/services/sync/capabilities';

/**
 * Native (Capacitor) shell wiring — ADR-029 A5. The single home for runtime
 * native-shell concerns (splash hide, status-bar style, Android hardware
 * back-button), called once from `App.vue` setup. The `@capacitor/splash-screen`,
 * `@capacitor/status-bar`, and `@capacitor/app` `backButton`/`exitApp` plugin
 * usage is confined to this module. No-op on web.
 *
 * App icons / splash artwork (static assets) and safe-area insets (CSS) are
 * NOT runtime concerns and live elsewhere — out of scope here.
 */

let initialized = false;

export function useNativeShell(): void {
  if (initialized) return;
  if (!isNative()) return;
  initialized = true;

  // Reveal the web shell — hide the native splash now that App.vue is mounting.
  void SplashScreen.hide().catch(() => {});

  // Status bar follows the system light/dark setting (safe default; theme-aware
  // styling is a later refinement).
  void StatusBar.setStyle({ style: Style.Default }).catch(() => {});

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
}
