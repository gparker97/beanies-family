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
        logEvent({
          level: 'info',
          surface,
          message: 'wall_wakelock_released',
          context: { action: 'wakelock_released', kind: 'browser' },
        });
      });
      sentinel = granted;
      active.value = !granted.released;
      lastError.value = null;
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

  const { isVisible } = useToday();

  watch(
    isVisible,
    (visible) => {
      if (visible) {
        void acquire();
      } else if (active.value) {
        // The browser drops it for us; record so re-acquire can be reported.
        releasedAt = Date.now();
        active.value = false;
        sentinel = null;
      }
    },
    { immediate: true }
  );

  onScopeDispose(() => {
    void release();
  });

  return { supported, active, lastError, acquire, release };
}
