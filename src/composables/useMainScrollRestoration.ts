/**
 * Scroll restoration for the app's real scroller, `<main>` in `App.vue`.
 *
 * The window never scrolls (`App.vue`'s shell is `h-screen overflow-hidden`), so Vue Router's
 * `scrollBehavior` could never have any effect. This module saves `<main>`'s `scrollTop` per
 * history entry and gives it back on a back/forward step (browser, Android hardware back, or an
 * in-app back button through `useAppBack`), so returning from a recipe lands on the recipe card,
 * not the top of the cookbook. A new forward navigation always opens at the top.
 *
 * Entries are keyed by Vue Router's `history.state.position` (one integer per history entry, kept
 * on `router.replace`), held in memory only: this is per-tab session state, a reload is a fresh
 * open, and a saved position older than an hour is discarded (the NN/g freshness rule).
 *
 * The decision is pure (`decide`, `sweep`) so the cases are unit-tested with plain numbers; the
 * router hooks and the DOM wait are thin wiring around it.
 */
import { nextTick, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { waitForElement } from '@/utils/waitForElement';
import { logEvent } from '@/services/telemetry';

/** A saved position older than this is not restored (NN/g: one session, roughly an hour). */
export const SCROLL_RESTORE_MAX_AGE_MS = 60 * 60 * 1000;
/** How long a restore waits for lazy content to grow tall enough to hold the saved offset. */
export const SCROLL_RESTORE_WAIT_MS = 2000;

export interface SavedScroll {
  top: number;
  at: number;
}
export type ScrollMap = Map<number, SavedScroll>;

/** What the router told us about one finished navigation, reduced to plain values. */
export interface NavigationFacts {
  /** `history.state.position` of the entry being left (undefined before the first read). */
  leaving: number | undefined;
  /** `history.state.position` of the entry arrived at. */
  arrived: number;
  /** `to.path === from.path`. */
  samePath: boolean;
  /**
   * The navigation was a history traversal (back/forward). Only a pop may restore: a push after
   * a back reuses the position of the discarded forward entry, which may still be in the map.
   */
  popped: boolean;
  /** `to.meta.scrollRestore !== false`; the planner positions its own scroller. */
  restorable: boolean;
}

/** Map entries to forget: the arrived one, or it and every later one (dead forward history). */
export type ScrollDrop = 'entry' | 'forward';

export type ScrollDecision =
  | { kind: 'noop'; drop?: ScrollDrop }
  | { kind: 'top'; stale?: boolean; drop?: ScrollDrop }
  | { kind: 'restore'; top: number };

/** Decide what `<main>` should do after a navigation. Pure: never touches the map. */
export function decide(map: ScrollMap, nav: NavigationFacts, now: number): ScrollDecision {
  // A replace keeps the position: same path is a query rewrite (planner prev/next, a deep-link
  // param clear) and keeps its place; a new path (delete-then-replace) starts at the top.
  if (nav.arrived === nav.leaving) {
    return nav.samePath ? { kind: 'noop' } : { kind: 'top', drop: 'entry' };
  }
  const isPush = !nav.popped;
  // A page that owns its scroller (the planner's month stream) is never moved while it stays
  // mounted, whatever the navigation: a chip pushing `?activity=`, or Back from a day to the month.
  if (!nav.restorable && nav.samePath) {
    return { kind: 'noop', drop: isPush ? 'forward' : 'entry' };
  }
  // A push. The browser has discarded every forward entry from here on.
  if (isPush) return { kind: 'top', drop: 'forward' };
  const saved = map.get(nav.arrived);
  if (!saved) return { kind: 'top' };
  if (!nav.restorable) return { kind: 'top', drop: 'entry' };
  if (now - saved.at > SCROLL_RESTORE_MAX_AGE_MS) {
    return { kind: 'top', stale: true, drop: 'entry' };
  }
  return { kind: 'restore', top: saved.top };
}

/** Forget every entry older than the freshness window. */
export function sweep(map: ScrollMap, now: number): void {
  for (const [position, saved] of map) {
    if (now - saved.at > SCROLL_RESTORE_MAX_AGE_MS) map.delete(position);
  }
}

/** Apply a decision's `drop` to the map. */
export function applyDrop(map: ScrollMap, arrived: number, drop: ScrollDrop | undefined): void {
  if (drop === 'entry') map.delete(arrived);
  if (drop === 'forward') {
    for (const position of [...map.keys()]) if (position >= arrived) map.delete(position);
  }
}

export type RestoreOutcome = 'restored' | 'unreachable' | 'cancelled';

/**
 * Set `scroller.scrollTop = top` once the content is tall enough to hold it, checking once per
 * frame (lazy pages, store hydration and late images grow the list after first paint). Gives up
 * the moment the person scrolls (or `signal` aborts: the next navigation started), so they are
 * never fought; at the deadline it sets the offset anyway, which clamps to the bottom.
 *
 * Expects `scrollTop` to be 0 when called (the caller resets it). Wheel, touch and keys on the
 * scroller are caught as they start; a `scroll` that leaves the top catches the rest (PageDown or
 * Space with focus on the body, a scrollbar drag). The reset's own `scroll` event arrives after
 * the listener is attached but finds `scrollTop` still 0, so it never cancels.
 */
export async function restoreScroll(
  scroller: HTMLElement,
  top: number,
  signal?: AbortSignal
): Promise<RestoreOutcome> {
  let cancelled = signal?.aborted ?? false;
  const listeners = new AbortController();
  const cancel = () => {
    cancelled = true;
  };
  for (const type of ['wheel', 'touchmove', 'keydown'] as const) {
    scroller.addEventListener(type, cancel, { signal: listeners.signal, passive: true });
  }
  scroller.addEventListener(
    'scroll',
    () => {
      if (scroller.scrollTop !== 0) cancel();
    },
    { signal: listeners.signal, passive: true }
  );
  signal?.addEventListener('abort', cancel, { signal: listeners.signal });
  const found = await waitForElement(
    () => (cancelled || scroller.scrollHeight - scroller.clientHeight >= top ? scroller : null),
    SCROLL_RESTORE_WAIT_MS
  );
  listeners.abort();
  if (cancelled) return 'cancelled';
  scroller.scrollTop = top;
  return found ? 'restored' : 'unreachable';
}

/** Vue Router's position for the current entry; absent under memory history and in a test DOM. */
function readPosition(): number | undefined {
  const position = (window.history.state as { position?: unknown } | null)?.position;
  return typeof position === 'number' ? position : undefined;
}

function emit(action: 'restored' | 'stale' | 'unreachable', routeName: unknown): void {
  logEvent({
    level: 'info',
    surface: 'scroll-restore',
    message: 'restore',
    context: { action, route_name: String(routeName) },
  });
}

/**
 * Wire scroll restoration onto the router, once, from `App.vue`'s setup. `mainEl` is null on the
 * `noChrome` routes (wall, login) and in the `afterEach` of the navigation that first shows the
 * shell; both are skipped quietly (a dead mechanism shows as the `restored` count going to zero).
 */
export function installMainScrollRestoration(
  router: Pick<Router, 'beforeEach' | 'afterEach'>,
  mainEl: Ref<HTMLElement | null>
): void {
  const saved: ScrollMap = new Map();
  // Maintained here, never read from `history.state` in `beforeEach`: on a back/forward step Vue
  // Router's popstate handler has already written the DESTINATION's state before any guard runs.
  let currentPosition = readPosition();
  // The position a pop was heading to, seen in `beforeEach` as a state that already moved.
  let poppedTo: number | undefined;
  // The restore still waiting for content, and the entry it belongs to. A navigation that moves
  // `<main>` to other content aborts it so it cannot land there; one that leaves it in place (a
  // same-entry query replace, a failed navigation) lets it finish.
  let pending: { controller: AbortController; position: number } | undefined;
  const abortPending = () => {
    pending?.controller.abort();
    pending = undefined;
  };

  router.beforeEach(() => {
    const position = readPosition();
    poppedTo = position !== currentPosition ? position : undefined;
    const scroller = mainEl.value;
    if (!scroller || currentPosition === undefined) return;
    // While its restore waits, the entry's `scrollTop` is the reset 0, not where the person was:
    // keep the saved offset rather than overwrite it.
    if (pending?.position === currentPosition) return;
    const now = Date.now();
    saved.set(currentPosition, { top: scroller.scrollTop, at: now });
    sweep(saved, now);
  });

  router.afterEach(async (to, from, failure) => {
    const leaving = currentPosition;
    // An aborted pop reverts history with an async `history.go`, so `history.state` still holds
    // the aborted destination here; keep `currentPosition` until a navigation succeeds.
    if (failure) return;
    currentPosition = readPosition();
    const arrived = currentPosition;
    const popped = arrived !== undefined && poppedTo === arrived;
    poppedTo = undefined;
    const scroller = mainEl.value;
    if (arrived === undefined || !scroller) {
      abortPending();
      return;
    }

    const decision = decide(
      saved,
      {
        leaving,
        arrived,
        samePath: to.path === from.path,
        popped,
        restorable: to.meta.scrollRestore !== false,
      },
      Date.now()
    );
    if (decision.kind !== 'restore') applyDrop(saved, arrived, decision.drop);
    if (decision.kind === 'noop') return;
    abortPending();
    scroller.scrollTop = 0;
    if (decision.kind === 'top') {
      if (decision.stale) emit('stale', to.name);
      return;
    }

    // `afterEach` runs before Vue patches `<router-view>`: `<main>` still holds the page being
    // left, which must not satisfy the height check below.
    const controller = new AbortController();
    pending = { controller, position: arrived };
    await nextTick();
    const outcome = await restoreScroll(scroller, decision.top, controller.signal);
    if (pending?.controller === controller) pending = undefined;
    if (outcome !== 'cancelled') emit(outcome, to.name);
  });
}
