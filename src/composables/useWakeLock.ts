/**
 * Screen Wake Lock — generic, not wall-specific, because any future full-screen
 * surface (cook mode, a presentation view) wants the same thing.
 *
 * Three facts drive the design:
 *  - The lock is dropped by the browser whenever the document is hidden, so it
 *    must be RE-ACQUIRED on becoming visible again. We reuse `useToday().isVisible`
 *    rather than registering another `visibilitychange` listener.
 *  - Safari only gained it in 16.4, and it was broken for installed PWAs until
 *    iOS 18.4 — and old iPads are exactly this feature's target device. So an
 *    unsupported or denied lock is a FIRST-CLASS state, never an error.
 *  - Every path is guarded: a rejection must never break the screen that asked.
 */
import { onScopeDispose, ref, watch } from 'vue';
import { useToday } from '@/composables/useToday';
import { logEvent } from '@/services/telemetry/logEvent';

type WakeLockLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

export function useWakeLock(surface: string) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const active = ref(false);
  const lastError = ref<string | null>(null);

  let sentinel: WakeLockLike | null = null;
  let releasedAt = 0;

  // Declared here rather than beside the watch below: the release handler and the backoff
  // both read it, and both are defined above that point.
  const { isVisible } = useToday();

  /**
   * Backoff for an unprompted re-acquire.
   *
   * The platform drops the lock for reasons it does not tell us, and some of them (low
   * battery, an OS power-save mode) will refuse every retry. Retrying flat-out would spin
   * a request loop on the one device that is least able to afford it, so the delay doubles
   * to a ceiling and only a SUCCESS resets it.
   */
  const REACQUIRE_BASE_MS = 2_000;
  const REACQUIRE_MAX_MS = 60_000;
  let reacquireDelay = REACQUIRE_BASE_MS;
  let reacquireTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleReacquire(): void {
    if (reacquireTimer) return;
    reacquireTimer = setTimeout(() => {
      reacquireTimer = undefined;
      // Conditions may have changed while we waited — a hidden document is the browser's
      // to re-arm, not ours.
      if (!isVisible.value || active.value) return;
      reacquireDelay = Math.min(reacquireDelay * 2, REACQUIRE_MAX_MS);
      void acquire().then(() => {
        if (!active.value && isVisible.value) scheduleReacquire();
      });
    }, reacquireDelay);
  }

  function cancelReacquire(): void {
    if (reacquireTimer) clearTimeout(reacquireTimer);
    reacquireTimer = undefined;
    reacquireDelay = REACQUIRE_BASE_MS;
  }

  async function acquire(): Promise<void> {
    if (!supported || active.value) return;
    try {
      const nav = navigator as Navigator & {
        wakeLock: { request: (type: 'screen') => Promise<WakeLockLike> };
      };
      const granted = await nav.wakeLock.request('screen');
      /**
       * Trust the SENTINEL, not the fact that the request resolved.
       *
       * The browser drops the lock whenever the document hides, and if that
       * happened while this request was in flight the promise still resolves —
       * setting `active = true` for a lock that is already gone. `acquire()`
       * early-returns on `active`, so every later visible transition bailed and
       * the iPad quietly went back to sleeping while telemetry said healthy.
       * Subscribing to `release` is what closes that hole: it is the browser's
       * own signal, and it fires for a mid-flight drop as well as a later one.
       */
      granted.addEventListener?.('release', () => {
        if (sentinel !== granted) return;
        active.value = false;
        releasedAt = Date.now();
        sentinel = null;
        logEvent({
          level: 'info',
          surface,
          message: 'wall_wakelock_released',
          context: { action: 'wakelock_released', kind: 'browser' },
        });
        // Re-acquire if the document is STILL VISIBLE. Re-acquisition used to be driven
        // solely by `isVisible` transitions, which never fire on a wall-mounted tablet
        // whose document never hides — so when the platform dropped the lock for its own
        // reasons (Android power-save, low battery, a WebView reattach) nothing took it
        // back and the kitchen wall slept permanently, with a lone `wall_wakelock_released`
        // and no matching reacquire in telemetry (#78 review). A hidden document is the
        // ordinary case and is left to the watch below.
        if (isVisible.value) scheduleReacquire();
      });
      sentinel = granted;
      active.value = !granted.released;
      lastError.value = null;
      // Only a real re-acquisition resets the backoff. A request that resolved against an
      // already-released sentinel is not one, and must keep the delay growing.
      if (active.value) cancelReacquire();
      if (releasedAt) {
        logEvent({
          level: 'info',
          surface,
          message: 'wall_wakelock_reacquired',
          context: { action: 'wakelock_reacquired' },
        });
        releasedAt = 0;
      }
    } catch (error) {
      active.value = false;
      lastError.value = error instanceof Error ? error.message : String(error);
      // Denied is normal (unsupported browser, low battery, backgrounded tab) —
      // it degrades the screen, it does not break it.
      logEvent({
        level: 'warn',
        surface,
        message: 'wall_wakelock_denied',
        context: { action: 'wakelock_denied' },
      });
    }
  }

  async function release(): Promise<void> {
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {
      // Already released by the browser — nothing to do and nothing to tell.
    } finally {
      sentinel = null;
      active.value = false;
    }
  }

  watch(
    isVisible,
    (visible) => {
      if (visible) {
        // A fresh visible transition is a new chance, not a continuation of the old
        // backoff — reset before asking.
        cancelReacquire();
        void acquire();
      } else if (active.value) {
        // The browser drops it for us; record so re-acquire can be reported. Any pending
        // retry is pointless while hidden — the watch re-arms on the way back.
        cancelReacquire();
        releasedAt = Date.now();
        active.value = false;
        sentinel = null;
      }
    },
    { immediate: true }
  );

  onScopeDispose(() => {
    cancelReacquire();
    void release();
  });

  return { supported, active, lastError, acquire, release };
}
