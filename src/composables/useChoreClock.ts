import { readonly, shallowRef, watch, type Ref } from 'vue';
import { useToday } from '@/composables/useToday';
import { plateClock } from '@/utils/todoPlate';
import type { ChoreClock } from '@/utils/chores';

/**
 * THE clock every choreboard surface reads (#146): the device-local day and minute.
 *
 * Module-scoped singleton in the `useToday` pattern: lazy `init()` on first access, one timer
 * for the app lifetime. Nothing else in the app ticks per minute (`plateClock()` is a plain
 * function and `useToday` ticks only at midnight and on wake), and a chore block changes on a
 * minute boundary, so this re-evaluates:
 *   1. on a self-rearming timer aligned to the next minute boundary (recomputed every time,
 *      since `setTimeout` drifts and is unreliable across device sleep);
 *   2. whenever `useToday` sees the day change or the page become visible again.
 *
 * Because every surface (the wall included) reads this one clock, moving chores to the family
 * home time zone later is a one-place change.
 */

// Filled on first use, never at module load: `plateClock` lives in a module that can still be
// initializing when an import cycle reaches this one, and every read goes through
// `useChoreClock()`, which updates before it returns.
const clock = shallowRef<ChoreClock>({ ymd: '', hhmm: '' });

let initialized = false;
let minuteTimer: ReturnType<typeof setTimeout> | null = null;

function update(): void {
  const next = plateClock();
  if (next.ymd !== clock.value.ymd || next.hhmm !== clock.value.hhmm) clock.value = next;
}

function rearmMinuteTimer(): void {
  if (minuteTimer !== null) clearTimeout(minuteTimer);
  // A small margin past the boundary so the new minute has definitely begun.
  const delay = 60_000 - (Date.now() % 60_000) + 50;
  minuteTimer = setTimeout(() => {
    update();
    rearmMinuteTimer();
  }, delay);
}

function init(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  const { today, lastVisibleAt } = useToday();
  watch([today, lastVisibleAt], () => {
    update();
    rearmMinuteTimer();
  });
  rearmMinuteTimer();
}

export function useChoreClock(): { choreClock: Readonly<Ref<ChoreClock>> } {
  init();
  // Read on every access so a caller that has been idle sees the minute it is called in.
  update();
  return { choreClock: readonly(clock) as Readonly<Ref<ChoreClock>> };
}
