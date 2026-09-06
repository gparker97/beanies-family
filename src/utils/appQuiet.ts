/**
 * Is now a safe moment to interrupt or reload?
 *
 * Moved VERBATIM out of `usePwaUpdater`, where it was a private `isQuiet`, so
 * the web updater and the native update prompt ask the same question rather
 * than each keeping a definition that can drift. Verbatim on purpose: the web
 * reload path has been tuned against real failures, and a "tidy" rewrite here
 * would change that behaviour as a side effect of adding a caller.
 */
import { hasOpenOverlays } from '@/utils/overlayStack';
import { useSyncStore } from '@/stores/syncStore';

/** Quiet = nothing the user would lose if we reload right now. */
export function isAppQuiet(): boolean {
  try {
    return !hasOpenOverlays() && !useSyncStore().isSyncing;
  } catch {
    // Pre-init / store not ready — treat as NOT quiet (defer the reload).
    return false;
  }
}
