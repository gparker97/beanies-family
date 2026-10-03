import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * How far an on-screen keyboard overlaps the layout viewport (#119), so a fixed surface can
 * lift itself above it.
 *
 * `inset` is the px the VISUAL viewport's bottom sits above the LAYOUT viewport's bottom. On
 * iOS Safari / WKWebView and Android Chrome (`resizes-visual`, the default) the keyboard
 * shrinks the visual viewport and leaves the layout viewport alone, so this is the keyboard's
 * overlap. On a WebView that resizes the whole window (Capacitor Android `adjustResize`) it
 * is ~0, and a fixed surface is already above the keyboard because the layout viewport shrank.
 * Without `visualViewport` it stays 0 and the browser's own scroll-into-view applies.
 *
 * PINCH ZOOM IS NOT A KEYBOARD. Zooming shrinks `visualViewport.height` by the zoom factor
 * with no keyboard present (at 2x it reads as half the viewport), which would lift the
 * surface to mid-screen for anyone who zooms; while zoomed the inset stays 0.
 *
 * Pure measurement: it logs only its own listener failures. What counts as "a keyboard" for
 * telemetry is the host's call, against `KEYBOARD_INSET_MIN_PX`.
 *
 * Listens only while `active` is true; rAF-throttled (iOS fires resize/scroll many times per
 * second while the keyboard animates); recomputes once on activation; resets to 0 and detaches
 * on deactivation; `onScopeDispose` is the safety net.
 */

/** An inset at or above this is a keyboard, not iOS toolbar wobble (for host telemetry). */
export const KEYBOARD_INSET_MIN_PX = 120;

/** Above this scale the visual viewport is pinch-zoomed and its height says nothing about a keyboard. */
const ZOOM_SCALE_EPSILON = 1.01;

export function useVisualViewportInset(
  active: Ref<boolean>,
  opts: { surface: string }
): { inset: Readonly<Ref<number>>; supported: boolean } {
  const vv: VisualViewport | null =
    typeof window !== 'undefined' && window.visualViewport ? window.visualViewport : null;
  const supported = vv !== null;
  const inset = ref(0);

  let attached = false;
  let rafToken: number | null = null;

  function measure(): void {
    if (!vv) return;
    if (vv.scale > ZOOM_SCALE_EPSILON) {
      inset.value = 0;
      return;
    }
    inset.value = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  }

  function onViewportChange(): void {
    if (rafToken !== null) return;
    rafToken = requestAnimationFrame(() => {
      rafToken = null;
      measure();
    });
  }

  function reportListenerFailure(phase: 'attach' | 'detach', err: unknown): void {
    console.warn(`[useVisualViewportInset] could not ${phase} visualViewport listeners:`, err);
    logEvent({
      level: 'warn',
      surface: opts.surface,
      message: 'visual viewport listener failed',
      context: { action: 'viewport_listen_failed' },
    });
  }

  function attach(): void {
    if (!vv || attached) return;
    try {
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
      attached = true;
    } catch (err) {
      reportListenerFailure('attach', err);
      return;
    }
    measure();
  }

  function detach(): void {
    if (rafToken !== null) {
      cancelAnimationFrame(rafToken);
      rafToken = null;
    }
    inset.value = 0;
    if (!vv || !attached) return;
    attached = false;
    try {
      vv.removeEventListener('resize', onViewportChange);
      vv.removeEventListener('scroll', onViewportChange);
    } catch (err) {
      reportListenerFailure('detach', err);
    }
  }

  watch(
    active,
    (on) => {
      if (on) attach();
      else detach();
    },
    { immediate: true }
  );

  onScopeDispose(detach);

  return { inset: readonly(inset), supported };
}
