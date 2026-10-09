import { onScopeDispose, watch, type Ref } from 'vue';
import type { WallSleepSettings } from '@/types/models';
import { isWithinNightHours, localHHmm } from '@/utils/wallSleep';

/** How often the wall checks whether to sleep or wake. Coarse on purpose: minutes matter here. */
export const WALL_SLEEP_CHECK_MS = 30_000;

/** Anything a person does at the wall counts as being there. */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Puts the beanie wall to sleep on its own during night hours, once nobody has touched it for
 * `idleMinutes`, and wakes it when the night hours end.
 *
 * Idle, never a plain schedule: the wall must not go dark under a parent who is reading it at
 * 21:05. Only a night that STARTED inside the night hours is ended at the morning boundary, so
 * someone who put the wall to sleep by hand at 14:00 keeps it asleep until they touch it. With
 * the setting off this does nothing at all, which is the wall's behaviour before it existed.
 *
 * The caller owns the night state and the logging; this decides only WHEN.
 */
export function useWallAutoSleep(options: {
  settings: () => WallSleepSettings;
  asleep: Ref<boolean>;
  sleep: () => void;
  wake: () => void;
  now?: () => Date;
  target?: EventTarget;
}) {
  const now = options.now ?? (() => new Date());
  const target = options.target ?? window;
  let lastActivity = now().getTime();
  let sleptInHours = false;

  const noteActivity = () => {
    lastActivity = now().getTime();
  };
  for (const type of ACTIVITY_EVENTS) {
    target.addEventListener(type, noteActivity, { capture: true, passive: true });
  }

  watch(options.asleep, (asleep) => {
    const s = options.settings();
    if (asleep) sleptInHours = isWithinNightHours(localHHmm(now()), s.startTime, s.endTime);
    // Waking is activity: without this the next check could put it straight back to sleep.
    else noteActivity();
  });

  function check() {
    const s = options.settings();
    if (!s.enabled) return;
    const at = now();
    const inHours = isWithinNightHours(localHHmm(at), s.startTime, s.endTime);
    if (options.asleep.value) {
      if (sleptInHours && !inHours) options.wake();
      return;
    }
    if (inHours && at.getTime() - lastActivity >= s.idleMinutes * 60_000) options.sleep();
  }

  const timer = setInterval(check, WALL_SLEEP_CHECK_MS);

  onScopeDispose(() => {
    clearInterval(timer);
    for (const type of ACTIVITY_EVENTS) {
      target.removeEventListener(type, noteActivity, { capture: true });
    }
  });

  return { check };
}
