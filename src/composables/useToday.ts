import { ref, readonly, computed, type ComputedRef, type Ref } from 'vue';
import { getStartOfDay, localToday, parseLocalDate } from '@/utils/date';

/**
 * Reactive "today" for the whole app.
 *
 * Single source of truth for any UI / store / composable that needs to
 * filter, render, or compute by the current local day. Owns the only
 * `visibilitychange` and `pageshow` listeners in the app's wake-detection
 * surface (other consumers — `useStaleTabRefresh`, `App.vue` save-on-hide
 * — read this composable's reactive state via `watch` rather than
 * registering parallel listeners).
 *
 * Module-scoped singleton matching the `useOnline` pattern: lazy `init()`
 * on first access, listeners persist for the app lifetime.
 *
 * Updates fire on:
 *   1. `visibilitychange → visible` (catches PWA wake / tab switch)
 *   2. `pageshow` with `e.persisted` (catches iOS Safari bfcache restore)
 *   3. A self-rearming midnight `setTimeout` (catches tabs that stay
 *      visible across midnight)
 *
 * The midnight delay is always recomputed from a fresh
 * `new Date(y, m, d+1, 0, 0, 0)` — DST-safe, never `prev + 86_400_000`.
 * The timer is also cleared and rearmed on every visibility-becomes-visible
 * since `setTimeout` is unreliable across device sleep.
 */

const today = ref(localToday());
const isVisible = ref(
  typeof document === 'undefined' ? true : document.visibilityState === 'visible'
);
const lastVisibleAt = ref(Date.now());
const lastHiddenAt = ref(0);

const startOfToday: ComputedRef<Date> = computed(() => getStartOfDay(parseLocalDate(today.value)));

let initialized = false;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function update(): void {
  const next = localToday();
  if (next !== today.value) today.value = next;
}

function rearmMidnightTimer(): void {
  if (midnightTimer !== null) clearTimeout(midnightTimer);
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  const delay = nextMidnight.getTime() - now.getTime();
  midnightTimer = setTimeout(() => {
    update();
    rearmMidnightTimer();
  }, delay);
}

function onVisibilityChange(): void {
  const visible = document.visibilityState === 'visible';
  isVisible.value = visible;
  if (visible) {
    lastVisibleAt.value = Date.now();
    update();
    rearmMidnightTimer();
  } else {
    lastHiddenAt.value = Date.now();
  }
}

function onPageShow(e: PageTransitionEvent): void {
  if (!e.persisted) return;
  isVisible.value = true;
  lastVisibleAt.value = Date.now();
  update();
  rearmMidnightTimer();
}

function init(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);
  rearmMidnightTimer();
}

export function useToday(): {
  today: Readonly<Ref<string>>;
  startOfToday: ComputedRef<Date>;
  isVisible: Readonly<Ref<boolean>>;
  lastVisibleAt: Readonly<Ref<number>>;
  lastHiddenAt: Readonly<Ref<number>>;
} {
  init();
  return {
    today: readonly(today),
    startOfToday,
    isVisible: readonly(isVisible),
    lastVisibleAt: readonly(lastVisibleAt),
    lastHiddenAt: readonly(lastHiddenAt),
  };
}
