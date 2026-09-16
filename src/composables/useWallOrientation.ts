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
import { deviceCanRotate } from '@/components/wall/wallRoom';

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
 * True on a device big enough that landscape is a reasonable way to hold the
 * whole app, not just the wall.
 *
 * ⚠️ The threshold and the `screen` read now live in `wallRoom.ts`, shared with
 * the wall's admission gate. They were two separate literals both called 600,
 * and on a 601px device they contradicted each other: this said "tablet, rotate
 * freely" while the wall's viewport test said "too small to be a wall".
 *
 * ⚠️ Lowering that shared floor to 500 means devices between 500 and 600 on
 * their smaller side — small tablets, and an unfolded foldable's inner screen —
 * now rotate freely EVERYWHERE in the app, not just on the wall, because
 * `applyOrientationPolicy()` runs at boot from `main.ts`. That is intended (they
 * are tablets, and a mounted wall tablet must be able to be landscape), but it
 * is an app-wide consequence of a wall change and is pinned by tests.
 *
 * `deviceCanRotate()` returns FALSE when `screen` cannot be read, which is the
 * opposite of the wall gate's default and correct here: do not unlock what you
 * cannot measure. The 2026-06-12 regression was phones rotating against a
 * locked OS setting.
 */
export function isRotatableFormFactor(): boolean {
  return deviceCanRotate();
}

/**
 * The orientation the app returns to when it is not on the wall.
 *
 * On a phone that is portrait, because every layout is portrait-first and the
 * installed PWA manifest overrides the OS rotation lock (the 2026-06-12
 * regression). On a tablet it is "whatever the device wants" — landscape is
 * arguably the better way to use the app there, and the manifest cannot say
 * so per-device because it is one static file.
 */
function applyBaseOrientation(onFail?: () => void): void {
  const o = screenOrientation();
  if (!o) return;
  try {
    if (isRotatableFormFactor()) {
      o.unlock?.();
      return;
    }
    // `lock()` REJECTS routinely — on desktop, when superseded, or where the
    // API wants fullscreen. Swallow it explicitly or it surfaces unhandled.
    o.lock?.('portrait')?.catch(() => onFail?.());
  } catch {
    onFail?.();
  }
}

/**
 * Called once at boot. On a phone this is a no-op beyond re-stating the
 * declarative default; on a tablet it releases the manifest's portrait lock so
 * the app can be held either way.
 */
export function applyOrientationPolicy(): void {
  applyBaseOrientation();
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
  // Back to the app's base orientation for THIS device — portrait on a phone,
  // free on a tablet. Restoring to portrait unconditionally would have fought
  // the tablet policy every time someone left the wall.
  applyBaseOrientation();
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
    // Same policy as a cold start: portrait on a phone, free on a tablet. A
    // failed restore is reported (the app is left rotatable until the next
    // cold start) but must never throw at a user.
    applyBaseOrientation(() => report('orientation_restore_failed'));
  }

  onScopeDispose(restore);

  return { supported, released, release, restore };
}
