/**
 * Fly an element onto another one (Web Animations API): the deal animation (#109), where a
 * card arcs from the pile into the face of the member who now holds it, or drops into the
 * skipped tray.
 *
 * Contract, and why each part is there:
 *  - Resolves when the flight is over, so the caller can sequence the next step (bounce the
 *    face, show the next card). It NEVER rejects: the animation is cosmetic and must never
 *    block the write it decorates.
 *  - `.finished` rejects with an `AbortError` when the element is detached or the animation
 *    is cancelled mid-flight (a sync re-render, a fast second tap). That is caught, warned
 *    and resolved.
 *  - When it resolves, the element is back where it started (the animation is cancelled,
 *    nothing is left filled). A caller that wants the card to stay gone hides it itself
 *    before flying (the keyframes set their own opacity, so a hiding class has no effect
 *    until the flight ends), which keeps this function free of any "undo my styles" API.
 *  - Under `prefers-reduced-motion` (or without WAAPI, e.g. jsdom) it resolves at once.
 */
import { prefersReducedMotion } from '@/utils/prefersReducedMotion';

export const FLY_DURATION_MS = 560;

export async function flyTo(
  el: HTMLElement | null | undefined,
  target: HTMLElement | null | undefined
): Promise<void> {
  if (!el || !target || prefersReducedMotion() || typeof el.animate !== 'function') return;
  const a = el.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  let animation: Animation | null = null;
  try {
    animation = el.animate(
      [
        { transform: 'translate(0, 0) rotate(-2deg) scale(1)', opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) rotate(6deg) scale(0.6)`,
          opacity: 1,
          offset: 0.55,
        },
        { transform: `translate(${dx}px, ${dy}px) rotate(12deg) scale(0.12)`, opacity: 0.3 },
      ],
      { duration: FLY_DURATION_MS, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' }
    );
    await animation.finished;
  } catch (err) {
    console.warn('[useFlyTo] animation aborted', err);
  } finally {
    animation?.cancel();
  }
}

export function useFlyTo() {
  return { flyTo };
}
