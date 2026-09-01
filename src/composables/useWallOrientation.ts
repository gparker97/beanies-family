/**
 * The ONLY module in the codebase that knows the wall wants a different
 * orientation to the rest of the app.
 *
 * Why release/restore rather than lock-at-boot: the PWA manifest
 * (`orientation: 'portrait'`) and the Android Activity attribute are the
 * DECLARATIVE default, and they are authoritative on every cold start, process
 * death and Activity re-creation with no code involved. We only ever step out
 * of that default for one route, then put it back. Locking at boot would
 * invert the safety property — every non-wall screen would then depend on our
 * code having succeeded.
 *
 * Note the manifest lock exists because in an INSTALLED PWA the manifest
 * orientation overrides the user's OS rotation lock (a real 2026-06-12
 * regression). That is a web-manifest behaviour; it is not a reason to keep
 * native portrait-locked, and native is handled separately below.
 *
 * Every path is guarded. Orientation is a nice-to-have: a failure is reported
 * and swallowed, and must never block entering or leaving the wall.
 */
import { onScopeDispose, ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

type OrientationLike = {
  /** Returns a promise that rejects routinely — always attach a handler. */
  lock?: (o: string) => Promise<void>;
  unlock?: () => void;
};

function screenOrientation(): OrientationLike | null {
  if (typeof screen === 'undefined') return null;
  return (screen as Screen & { orientation?: OrientationLike }).orientation ?? null;
}

/**
 * Restore the declarative default from OUTSIDE a component scope.
 *
 * The router calls this on every navigation away from the wall, because "we
 * left by a path that did not dispose cleanly" (back button, deep link,
 * session expiry, an error boundary) is exactly the case the global default
 * has to survive. Idempotent, so running alongside the scope dispose is a
 * no-op rather than a conflict.
 */
export function restoreWallOrientation(): void {
  const o = screenOrientation();
  try {
    // `lock()` returns a promise and REJECTS routinely — on desktop, when a
    // newer lock/unlock supersedes this one, or where the API needs
    // fullscreen. A sync try/catch cannot catch that, so the rejection must be
    // swallowed explicitly or it becomes an unhandled rejection.
    o?.lock?.('portrait')?.catch(() => {
      /* orientation is a nice-to-have; never let it break a navigation */
    });
  } catch {
    // `lock` itself threw synchronously (very old engines).
  }
}

export function useWallOrientation(surface = 'beanie-wall') {
  const o = screenOrientation();
  const supported = !!o && typeof o.unlock === 'function';
  /** True once we have stepped out of the declarative default. */
  const released = ref(false);

  function report(action: string) {
    logEvent({
      level: 'warn',
      surface,
      message: 'wall_orientation_lock_failed',
      context: { action },
    });
  }

  /** Allow the device to rotate for the wall. Safe to call twice. */
  function release(): void {
    if (!supported || released.value) return;
    try {
      o?.unlock?.();
      released.value = true;
      logEvent({
        level: 'info',
        surface,
        message: 'wall_orientation_released',
        context: { action: 'orientation_released' },
      });
    } catch {
      report('orientation_release_failed');
    }
  }

  /**
   * Put the declarative default back. Idempotent — it is called from BOTH the
   * scope dispose and a router `afterEach`, because "we navigated away by a
   * path that did not dispose cleanly" is exactly the case the default has to
   * survive.
   */
  function restore(): void {
    if (!supported || !released.value) return;
    released.value = false;
    try {
      // See restoreWallOrientation: the rejection is asynchronous, so it needs
      // its own handler. A failed restore is reported (the app is left
      // rotatable until the next cold start) but must never throw at a user.
      o?.lock?.('portrait')?.catch(() => report('orientation_restore_failed'));
    } catch {
      report('orientation_restore_failed');
    }
  }

  onScopeDispose(restore);

  return { supported, released, release, restore };
}
