/**
 * Is now a safe moment to interrupt or reload?
 *
 * Moved VERBATIM out of `usePwaUpdater`, where it was a private `isQuiet`, so
 * the web updater and the native update prompt ask the same question rather
 * than each keeping a definition that can drift. Verbatim on purpose: the web
 * reload path has been tuned against real failures, and a "tidy" rewrite here
 * would change that behaviour as a side effect of adding a caller.
 *
 * ONE DELIBERATE ADDITION since the move (#119, do not "restore" the verbatim version): an
 * open Escape layer also means not quiet. The desktop quick-add composer is non-modal (no
 * scroll lock, so `hasOpenOverlays()` stays false) and can hold a typed draft that a reload
 * would silently discard; popovers and menus register there too, and deferring a reload until
 * they close is equally right (`useKeyboardShortcuts` already treats an open layer as busy).
 * It can only DEFER a reload, never cause one.
 */
import { hasOpenOverlays } from '@/utils/overlayStack';
import { hasOpenEscapeLayer } from '@/composables/useEscapeClose';
import { useSyncStore } from '@/stores/syncStore';

/** Quiet = nothing the user would lose if we reload right now. */
export function isAppQuiet(): boolean {
  try {
    return !hasOpenOverlays() && !hasOpenEscapeLayer() && !useSyncStore().isSyncing;
  } catch {
    // Pre-init / store not ready — treat as NOT quiet (defer the reload).
    return false;
  }
}
