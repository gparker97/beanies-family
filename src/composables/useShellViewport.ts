/**
 * Keeps the app shell glued to the VISIBLE viewport on phone browsers (web only).
 *
 * Two mechanisms can push the header off-screen in iOS Safari / Android Chrome; this composable
 * covers the second, and `App.vue`'s `h-dvh` / `min-h-dvh` (plus `style.css` `100dvh`) the first:
 *
 *  1. `100vh` is the LARGE viewport, taller than the visible area while the browser toolbar is
 *     showing, so a `h-screen` shell overflowed the window and the window could scroll.
 *  2. A window left scrolled, or a visual viewport left panned (`visualViewport.offsetTop > 0`),
 *     after the on-screen keyboard closes, leaves the header above the fold. The login screens
 *     take keyboard input right before the shell mounts.
 *
 * When the shell is shown, a scrolled window or panned visual viewport is reset to the top, and
 * checked once more about a second later (a post-flush watch runs before the keyboard has
 * finished closing).
 *
 * TEMPORARY: the `shell-geometry` event (one per page load, touch devices) exists to tell the two
 * mechanisms apart in CloudWatch. Remove it after two weeks of events showing `sy=0` and `hdr>=0`.
 * Plan: docs/plans/2026-11-11-web-stale-build-and-phone-browser-header.md (Part B).
 */
import { getCurrentScope, onScopeDispose, watch, type Ref } from 'vue';
import { isNative } from '@/services/sync/capabilities';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

const SURFACE = 'app-shell';
/** Delay before the second sample: the keyboard is still closing when a post-flush watch runs. */
export const SHELL_RESAMPLE_MS = 1000;

/** Module-level so geometry is emitted once per page load, however often the shell remounts. */
let geometryEmitted = false;

/** Test hook: lets each test start as a fresh page load. */
export function resetShellGeometryForTests(): void {
  geometryEmitted = false;
}

function round(n: number | undefined): number {
  return Math.round(n ?? 0);
}

/** Resets a scrolled window / panned visual viewport. Returns true when a reset was needed. */
function resetIfScrolled(pass: 1 | 2): boolean {
  const sy = window.scrollY;
  const vvt = window.visualViewport?.offsetTop ?? 0;
  if (!(sy > 0 || vvt > 0)) return false;
  window.scrollTo(0, 0);
  logEvent({
    level: 'warn',
    surface: SURFACE,
    message: 'window-scroll-reset',
    context: {
      action: 'window-scroll-reset',
      detail: `sy=${round(sy)},vvt=${round(vvt)},pass=${pass}`,
    },
  });
  return true;
}

function emitGeometry(): void {
  const vv = window.visualViewport;
  // From `<main>`, not the header: the planner reclaims the header on phones.
  const shell = document.querySelector('main')?.closest('.h-dvh');
  const header = document.querySelector('header');
  const detail = [
    `ih=${round(window.innerHeight)}`,
    `vvh=${round(vv?.height)}`,
    `vvt=${round(vv?.offsetTop)}`,
    `pt=${round(vv?.pageTop)}`,
    `ch=${round(document.documentElement.clientHeight)}`,
    `shell=${shell ? round(shell.getBoundingClientRect().height) : -1}`,
    `sy=${round(window.scrollY)}`,
    `hdr=${header ? round(header.getBoundingClientRect().top) : -1}`,
  ].join(',');
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'shell-geometry',
    context: { action: 'shell-geometry', detail },
  });
}

function isTouchDevice(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function guarded(step: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    reportError({
      surface: SURFACE,
      severity: 'warning',
      message: `shell viewport ${step} failed`,
      error: e,
      context: { action: step },
    });
  }
}

export function useShellViewport(showLayout: Ref<boolean>): void {
  if (isNative()) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  watch(
    showLayout,
    (shown) => {
      // Clear FIRST: a shell hidden within the second (boot flipping to pod setup, a
      // fast sign-out) must not let the resample fire on the sign-in page, which is
      // legitimately scrollable.
      clear();
      if (!shown) return;
      guarded('window-scroll-reset', () => resetIfScrolled(1));
      timer = setTimeout(() => {
        timer = undefined;
        guarded('window-scroll-reset', () => resetIfScrolled(2));
        if (geometryEmitted || !isTouchDevice()) return;
        geometryEmitted = true;
        guarded('shell-geometry', emitGeometry);
      }, SHELL_RESAMPLE_MS);
    },
    { immediate: true, flush: 'post' }
  );

  if (getCurrentScope()) onScopeDispose(clear);
}
