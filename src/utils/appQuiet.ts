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
 *
 * A SECOND DELIBERATE ADDITION (2026-11-11, web stale-build plan): `appQuietBlocker()` names
 * WHICH check failed, so the web updater's `deferred` event can say why a reload is waiting.
 * It is the same three checks, in the same order, inside the same one try/catch, and
 * `isAppQuiet()` is now defined as "no blocker". The answer to "quiet or not" is unchanged
 * for every input; only the reason became visible.
 */
import { hasOpenOverlays } from '@/utils/overlayStack';
import { hasOpenEscapeLayer } from '@/composables/useEscapeClose';
import { useSyncStore } from '@/stores/syncStore';

/** Why now is NOT a safe moment, or `null` when it is. */
export type QuietBlocker = 'overlay' | 'escape-layer' | 'syncing' | 'not-ready';

/** The first check that fails, in the original order, or `null` when quiet. */
export function appQuietBlocker(): QuietBlocker | null {
  try {
    if (hasOpenOverlays()) return 'overlay';
    if (hasOpenEscapeLayer()) return 'escape-layer';
    if (useSyncStore().isSyncing) return 'syncing';
    return null;
  } catch {
    // Pre-init / store not ready — classified as 'not-ready', i.e. NOT quiet (defer the
    // reload). Callers log the blocker, so this is not silent.
    return 'not-ready';
  }
}

/** Quiet = nothing the user would lose if we reload right now. */
export function isAppQuiet(): boolean {
  return appQuietBlocker() === null;
}
